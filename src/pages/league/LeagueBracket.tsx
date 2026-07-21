import { useState } from "react";
import { Spinner } from "../../components/common/Feedback";
import Select from "../../components/common/Select";
import Avatar from "../../components/common/Avatar";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import { api } from "../../api/client";
import { cx } from "../../utils/format";
import { formatChallengeSchedule } from "../../utils/date";
import type { League, LeagueMatch, LeagueMatchSide, LeagueTeam } from "../../types";

// 라운드 번호를 결승 기준 상대 이름으로.
function roundLabel(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return "결승";
  if (fromEnd === 1) return "준결승";
  return `${round}라운드`;
}

// 대진표 칸 하나(팀/선수 카드) — 항상 하얀 배경에 검정 글씨 + 아바타로, 다크/라이트
// 테마와 무관하게 또렷하게 보이도록 고정한다(요청: "팀카드는 하얀색 배경에 검은글씨와
// 아바타"). 팀리그는 로스터 전원을 세로로(요청: "팀이름이 아니라 구성원이름 보이게
// (세로로)"), 개인리그는 그 팀(=선수 1명)의 이름만 보여준다. 팀전은 라운드가 진행될수록
// 대진표가 옆으로 넓어지는데, 모바일에서는 2라운드부터 로스터 대신 팀명(라벨)만 보여
// 폭을 아낀다(요청: "팀전, 모바일인 경우 2라운드부터는 팀명만 노출") — 데스크톱은
// 라운드와 무관하게 항상 로스터 전원을 보여준다. editSelect가 있으면(1라운드 수정
// 모드) 팀명 자리(개인전은 로스터 자리)에 드롭다운을 항상 그대로 끼워 넣는다 — 클릭
// 한다고 카드/로스터가 다른 걸로 바뀌지 않고, 그 드롭다운 자체가 열릴 뿐이다(요청:
// "드롭다운 열때 아무것도 바뀔필요 없이 드롭다운만 열려야돼"). team이 없어도(빈 슬롯)
// 하얀 카드에 "미지정"이 선택된 드롭다운만 있고 로스터 자리는 그냥 비어 있다(요청:
// "빈슬롯을 하얀 배경에 팀 드롭다운만 미지정 선택돼 있으면 돼 팀원 목록만 없는
// 거나 똑같아"). 카드 높이는 바깥(포지셔너)이 고정폭으로 맞춰준다 — 좌표 기반 배치가
// 라운드/로스터 인원수와 무관하게 항상 통일된 높이를 전제로 하기 때문이다.
function TeamSlotCard({
  team, isWinner, mode, compact, editSelect,
}: {
  team: LeagueTeam | null; isWinner: boolean; mode: League["mode"]; compact: boolean;
  editSelect?: React.ReactNode;
}) {
  const cardClass = cx(
    "scr-league-bracket-team-card",
    isWinner && "scr-league-bracket-team-card-win",
    compact && "scr-league-bracket-team-card-compact",
  );
  const roster = !team ? null : team.roster.length === 0 ? (
    <span className="scr-league-bracket-team-card-empty-roster">{team.label}팀(로스터 없음)</span>
  ) : (
    <div className="scr-league-bracket-team-card-roster">
      {team.roster.map((r) => (
        <span key={r.memberId} className="scr-league-bracket-team-card-member">
          <Avatar member={{ id: r.memberId, nickname: r.nickname, avatar: r.avatar }} size={18} />
          {r.nickname}
        </span>
      ))}
    </div>
  );
  return (
    <div className={cardClass}>
      {mode === "team" && (editSelect ?? (team && <span className="scr-league-bracket-team-card-label">{team.label}</span>))}
      {mode === "individual" && editSelect ? editSelect : roster}
    </div>
  );
}

// 칸 하나(팀 슬롯) — 1라운드에서 수정 모드면 팀명(개인전은 로스터 자리)이 항상
// 드롭다운으로 나온다(요청: "1라운드 팀슬롯에서 팀이름을 드롭다운으로 바꿔서
// 미지정, 팀목록으로", "수정모드에서 대진표는 읽기전용일때랑 모양은 똑같아야돼").
// 어떤 팀도 목록에서 빼지 않는다 — 지금 이 자리에 배정된 팀은 드롭다운 자체의 체크
// 표시로 활성 상태를 보여준다(요청: "그냥 아무팀도 제거하지말고 대신 지금처럼
// 자신은 액티브 표시" — 반대편 제외 규칙이 의도와 다른 팀을 가리는 걸로 확인돼
// 없앴다). 골라서 다시 배정하면 그 팀이 있던 자리는 서버가 자동으로 미지정 처리한다
// (요청: "이미 지정된 팀도 드롭다운에 나오고 새로 지정하면 기존 지정된 슬롯을
// 미지정으로 지우는 식" — set_match_slot이 이 "옮기기"를 한 번에 처리한다). 2라운드
// 부터는 팀을 직접 배정하는 게 아니라 이전 라운드 결과가 입력되면 이긴 팀이 자동으로
// 채워지는 자리라 드롭다운을 아예 보여주지 않는다(요청: "2라운드 부터는 팀배정으로
// 할게 아니라 경기 결과 입력시 이긴팀을 자동으로 렌더해야지"). 대진이 확정되기
// 전에는 부전승으로만 결정된 자리도 계속 드롭다운으로 재배정할 수 있다(요청: "대진
// 확정 버튼을 누르면 그때부터 시드는 변경 못하게... 그전엔 부전승팀도 수정
// 가능해야해") — 실제로 치른 경기 결과(setsWonA가 있는 경기)만 확정 여부와 무관하게
// 항상 잠긴다. 드래그앤드랍 편집은 폐기 — 이 드롭다운 방식으로 대체한다.
function SlotCell({
  league, match, team, teamRef, canEdit, busy, mode, compact, onAssign, onClear,
}: {
  league: League; match: LeagueMatch;
  team: LeagueTeam | null; teamRef: { id: number } | null; canEdit: boolean; busy: boolean;
  mode: League["mode"]; compact: boolean;
  onAssign: (teamId: number) => void; onClear: () => void;
}) {
  const decided = match.winnerTeamId !== null;
  const realResult = match.setsWonA !== null;
  const editable = canEdit && match.round === 1 && !match.isDead && !realResult && !league.bracketLocked;

  if (!editable) {
    if (!team) {
      if (decided) return <div className="scr-league-bracket-team-empty">부전</div>;
      return <div className="scr-league-bracket-team-empty">{match.isDead ? "공백" : "미정"}</div>;
    }
    return <TeamSlotCard team={team} isWinner={decided && match.winnerTeamId === teamRef?.id} mode={mode} compact={compact} />;
  }

  const handleChange = (v: string) => (v === "" ? onClear() : onAssign(Number(v)));
  const select = mode === "individual" ? (
    <Select
      value={team ? String(team.id) : ""}
      options={[
        { value: "", label: "미지정" },
        ...league.teams.map((t) => ({ value: String(t.id), label: t.roster[0]?.nickname ?? `${t.label}(로스터 없음)` })),
      ]}
      onChange={handleChange}
      placeholder="미지정"
      size="sm" className="scr-league-bracket-slot-select scr-cselect-plain"
      disabled={busy}
    />
  ) : (
    <Select
      value={team ? String(team.id) : ""}
      options={[
        { value: "", label: "미지정", shortLabel: "-" },
        ...league.teams.map((t) => ({
          value: String(t.id), label: `${t.label}팀 ${t.roster.map((r) => r.nickname).join(", ") || "로스터 없음"}`,
          shortLabel: t.label,
        })),
      ]}
      onChange={handleChange}
      size="sm" className="scr-league-bracket-label-select scr-cselect-plain" minDropWidth={280}
      disabled={busy}
    />
  );
  return (
    <TeamSlotCard
      team={team} isWinner={decided && match.winnerTeamId === teamRef?.id} mode={mode} compact={compact}
      editSelect={select}
    />
  );
}

// 커넥터 모서리 처리(요청): "두 가지가 만나는 부분은 직각, 한 선이 그냥 꺾이는 부분은
// 둥글게". (x1,y1)에서 가로로 나와 bendX에서 세로로 꺾여 (x2,y2=두 가지가 만나는 mergeY)로
// 이어진다. 첫 꺾임(카드에서 나온 가로선→세로선)만 반지름 r로 둥글게 하고, 두 가지가
// 합쳐지는 지점(bendX, y2)은 직각 그대로 둔다.
function elbowPath(x1: number, y1: number, bendX: number, x2: number, y2: number, r: number): string {
  if (Math.abs(y1 - y2) < 0.5) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const dir = y2 > y1 ? 1 : -1;
  // r을 실제 가용 구간(가로 여백 / 세로 거리) 안으로 눌러 담아, 작은 브라켓에서도 안 깨지게.
  const rr = Math.max(0, Math.min(r, bendX - x1, Math.abs(y2 - y1)));
  if (rr <= 0) return `M ${x1} ${y1} L ${bendX} ${y1} L ${bendX} ${y2} L ${x2} ${y2}`;
  return [
    `M ${x1} ${y1}`,
    `L ${bendX - rr} ${y1}`,
    `Q ${bendX} ${y1} ${bendX} ${y1 + rr * dir}`, // 첫 꺾임만 둥글게
    `L ${bendX} ${y2}`,                            // 두 가지가 만나는 지점은 직각
    `L ${x2} ${y2}`,
  ].join(" ");
}

// 리그 대진표. canEdit이면 팀 수를 미리 정해 빈 대진표를 만들고, 각 칸에 팀을 직접
// 배정할 수 있다(요청: "대진표 생성 누르면 빈 대진표가 생기고 각 칸에 누가 들어갈지
// 정할 수 있는 시스템으로"). 아닌 경우(일반 회원/보기 모드)는 순수 읽기 전용.
//
// 좌표 기반 배치 — CSS flexbox 중첩으로 "짝(pair) 커넥터 중심"을 근사하던 이전 방식은
// 라운드마다 매치 수/카드 높이가 달라질 때마다 계속 어긋났다(요청: "브라켓 수정...
// 이긴팀이 연결된 하나의 선에 안 이어짐", "1,2번 시드 가운데 있어야 하는데 1~4번
// 시드 가운데 있음" 등 반복 보고). React에서 각 팀 슬롯의 %(정확히는 px) 좌표를
// 직접 계산해 position:absolute로 배치하고, 연결선은 SVG로 그 좌표를 그대로 잇는다
// — 로스터 인원수와 무관하게 카드 높이를 통일해서(CARD_H) 쓰므로, N번째 라운드의
// M번째 매치가 반드시 (N-1)라운드의 두 매치 정중앙에 오도록 수학적으로 보장된다.
export default function LeagueBracket({
  league, canEdit, onUpdated,
}: { league: League; canEdit: boolean; onUpdated: (l: League) => void }) {
  // 팀/대진표 규모는 상한이 없다(요청: "팀수 무제한 개인전 선수 무제한 대진표 슬롯
  // 무제한") — 목록 형태 Select 대신 숫자 입력 하나로 받는다. 생성 전/후 UI를 하나로
  // 통일해 항상 왼쪽 위에 "참가팀수(참가선수수) 인풋 + 확인"만 심플하게 둔다(요청:
  // "왼쪽 상단에 참가팀수/참가선수수 인풋 확인 이렇게 심플하게 해줘 장대하게 하지말고",
  // "규모변경 버튼 누를 필요 없이") — 이미 생성된 뒤에도 같은 자리에서 바로 숫자만
  // 바꿔 다시 생성할 수 있다(요청: "팀수, 대진표 슬롯 수 다 수정가능해야돼"). 결과가
  // 하나라도 입력된 뒤엔 서버가 거부하고 에러 메시지로 알려준다.
  // 문자열로 들고 있어야 지우는 중간 상태(빈 문자열)를 허용할 수 있다 — 숫자로 바로
  // clamp하면 지우자마자 2로 튀어버려 새 값을 타이핑할 수 없었다(요청: "참가팀수
  // 지우면 2가 자동 입력되는 버그"). 실제 하한(2 이상) 보정은 저장 시점에만 한다.
  const [teamCountInput, setTeamCountInput] = useState(() => String(Math.max(2, league.teams.length || 2)));
  const teamCount = Math.max(2, Number(teamCountInput) || 2);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmingBracket, setConfirmingBracket] = useState(false);

  const generate = async () => {
    setErr("");
    setBusy(true);
    try {
      onUpdated(await api.generateLeagueBracket(league.id, teamCount));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "대진표를 만들지 못했어요.");
    } finally {
      setBusy(false);
    }
  };
  // 대진 확정 — 그 뒤로는 1라운드 시드를 더 이상 바꿀 수 없다(요청: "대진 확정 버튼을
  // 추가해주고 그걸 누르면 그때부터 시드는 변경 못하게 해줘 그전엔 부전승팀도 수정
  // 가능해야해"). 되돌릴 수 없는 조작이라 확인창을 거친다.
  const confirmBracket = async () => {
    setErr("");
    setBusy(true);
    try {
      onUpdated(await api.confirmLeagueBracket(league.id));
      setConfirmingBracket(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "대진을 확정하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };
  const generateRow = canEdit && !league.bracketLocked && (
    <div className="scr-league-bracket-generate-row">
      <span className="scr-label">{league.mode === "individual" ? "참가선수수" : "참가팀수"}</span>
      <input
        type="number" min={2} value={teamCountInput}
        onChange={(e) => setTeamCountInput(e.target.value)}
        onBlur={() => setTeamCountInput(String(teamCount))}
        className="scr-input scr-league-bracket-count-input"
      />
      <button
        type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid scr-btn-sm"
        onClick={generate} disabled={busy}
      >
        {busy && <Spinner size={14} />} 저장
      </button>
    </div>
  );

  if (league.drawSize === null) {
    if (!canEdit) {
      return (
        <div className="scr-league-bracket-panel">
          <h2 className="scr-league-section-title">대진표</h2>
          <div className="scr-empty">아직 대진표가 만들어지지 않았어요</div>
        </div>
      );
    }
    return (
      <div className="scr-league-bracket-panel">
        {err && <div className="scr-err">{err}</div>}
        {generateRow}
      </div>
    );
  }

  const drawSize = league.drawSize;
  const totalRounds = Math.round(Math.log2(drawSize));
  const compact = league.mode === "team";

  const handleAssign = async (matchId: number, side: LeagueMatchSide, teamId: number) => {
    setErr("");
    setBusy(true);
    try {
      onUpdated(await api.setLeagueMatchSlot(league.id, matchId, side, teamId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "배정하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };
  const handleClear = async (matchId: number, side: LeagueMatchSide) => {
    setErr("");
    setBusy(true);
    try {
      onUpdated(await api.setLeagueMatchSlot(league.id, matchId, side, null));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "배정을 취소하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  // 카드 높이는 로스터 인원수와 무관하게 고정한다 — 좌표 계산이 이 고정값을 전제로
  // 한다. 개인전은 로스터가 항상 1명이라 훨씬 짧게 잡는다.
  const CARD_H = league.mode === "individual" ? 46 : 96;
  const ROW_GAP = 10;
  const COL_W = 180;
  const COL_GAP = 44;
  // 첫 꺾임(카드에서 나온 선이 꺾이는 곳)만 살짝 둥글게(요청). 두 가지가 만나는 지점은
  // elbowPath에서 직각으로 유지한다.
  const CORNER_R = 8;

  const totalHeight = drawSize * CARD_H + (drawSize - 1) * ROW_GAP;
  const totalWidth = totalRounds * COL_W + (totalRounds - 1) * COL_GAP;
  // 마지막 라운드 매치의 점수/일정 배지가 놓일 여유 공간을 캔버스 폭에 더 확보한다 —
  // 없으면 배지가 가로 스크롤 영역 바깥으로 밀려 잘려 보인다.
  const canvasWidth = totalWidth + COL_GAP;
  const slotsInRound = (r: number) => drawSize / 2 ** (r - 1);
  const slotY = (index: number, count: number) => ((index + 0.5) / count) * totalHeight;
  const colX = (r: number) => (r - 1) * (COL_W + COL_GAP);

  const matchByRoundSlot = new Map<string, LeagueMatch>();
  league.matches.forEach((m) => matchByRoundSlot.set(`${m.round}:${m.slotInRound}`, m));

  const connectors: { path: string; won: boolean }[] = [];
  for (let r = 1; r < totalRounds; r++) {
    const count = slotsInRound(r);
    const matchCount = count / 2;
    for (let m = 0; m < matchCount; m++) {
      const match = matchByRoundSlot.get(`${r}:${m}`);
      if (!match) continue;
      const sideAY = slotY(2 * m, count);
      const sideBY = slotY(2 * m + 1, count);
      const mergeY = (sideAY + sideBY) / 2;
      const x1 = colX(r) + COL_W;
      const bendX = x1 + COL_GAP / 2;
      const x2 = colX(r + 1);
      const winnerSide = match.winnerTeamId == null
        ? null
        : match.winnerTeamId === match.teamA?.id ? "a" : match.winnerTeamId === match.teamB?.id ? "b" : null;
      connectors.push({ path: elbowPath(x1, sideAY, bendX, x2, mergeY, CORNER_R), won: winnerSide === "a" });
      connectors.push({ path: elbowPath(x1, sideBY, bendX, x2, mergeY, CORNER_R), won: winnerSide === "b" });
    }
  }

  const slots: { key: string; x: number; y: number; node: React.ReactNode }[] = [];
  const badges: { key: string; x: number; y: number; node: React.ReactNode }[] = [];
  for (let r = 1; r <= totalRounds; r++) {
    const count = slotsInRound(r);
    const matchCount = count / 2;
    for (let m = 0; m < matchCount; m++) {
      const match = matchByRoundSlot.get(`${r}:${m}`);
      if (!match) continue;
      const teamA = match.teamA ? (league.teams.find((t) => t.id === match.teamA!.id) ?? null) : null;
      const teamB = match.teamB ? (league.teams.find((t) => t.id === match.teamB!.id) ?? null) : null;
      const isCompact = compact && r > 1;
      const x = colX(r);
      const sideAY = slotY(2 * m, count);
      const sideBY = slotY(2 * m + 1, count);
      slots.push({
        key: `${match.id}-a`, x, y: sideAY - CARD_H / 2,
        node: (
          <SlotCell
            league={league} match={match} team={teamA} teamRef={match.teamA} canEdit={canEdit} busy={busy}
            mode={league.mode} compact={isCompact}
            onAssign={(id) => handleAssign(match.id, "a", id)} onClear={() => handleClear(match.id, "a")}
          />
        ),
      });
      slots.push({
        key: `${match.id}-b`, x, y: sideBY - CARD_H / 2,
        node: (
          <SlotCell
            league={league} match={match} team={teamB} teamRef={match.teamB} canEdit={canEdit} busy={busy}
            mode={league.mode} compact={isCompact}
            onAssign={(id) => handleAssign(match.id, "b", id)} onClear={() => handleClear(match.id, "b")}
          />
        ),
      });
      if (match.setsWonA !== null || match.scheduledAt) {
        const mergeY = (sideAY + sideBY) / 2;
        // 두 카드 사이 세로 간격(ROW_GAP)이 배지 내용보다 좁을 수 있어, 카드 사이가
        // 아니라 커넥터가 꺾이는 지점(라운드 오른쪽 여백)에 배지를 둔다 — 공간이
        // 넉넉하고, 실제 브라켓 UI에서도 흔한 위치다.
        badges.push({
          key: `${match.id}-badge`, x: x + COL_W + COL_GAP / 2, y: mergeY,
          node: (
            <>
              {match.setsWonA !== null && match.setsWonB !== null && (
                <div className="scr-league-bracket-score">{match.setsWonA} : {match.setsWonB}</div>
              )}
              {match.scheduledAt && (
                <div className="scr-league-bracket-when">{formatChallengeSchedule(match.scheduledAt)}</div>
              )}
            </>
          ),
        });
      }
    }
  }
  const heads = Array.from({ length: totalRounds }, (_, i) => i + 1);

  return (
    <div className="scr-league-bracket-panel">
      {/* "대진표" 타이틀 생략(요청: "대진표 타이틀은 없어도 다 아니까 삭제") — 위 요약
          줄에 이미 "대진표 N강"이 있어 중복이었다. */}
      <div className="scr-league-bracket-toolbar">
        {generateRow}
        {canEdit && !league.bracketLocked && (
          <button
            type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid scr-btn-sm"
            onClick={() => setConfirmingBracket(true)} disabled={busy}
          >
            대진 확정
          </button>
        )}
      </div>
      {err && <div className="scr-err">{err}</div>}
      <div className="scr-league-bracket-scroll scr-scroll">
        <div className="scr-league-bracket-heads" style={{ width: totalWidth }}>
          {heads.map((r) => (
            <div key={r} className="scr-league-bracket-col-head" style={{ width: COL_W, marginRight: r < totalRounds ? COL_GAP : 0 }}>
              {roundLabel(r, totalRounds)}
            </div>
          ))}
        </div>
        <div className="scr-league-bracket-canvas" style={{ width: canvasWidth, height: totalHeight }}>
          <svg
            className="scr-league-bracket-svg" width={canvasWidth} height={totalHeight}
            viewBox={`0 0 ${canvasWidth} ${totalHeight}`}
          >
            {connectors.map((c, i) => (
              <path key={i} d={c.path} className={cx("scr-league-bracket-line", c.won && "scr-league-bracket-line-won")} />
            ))}
          </svg>
          {slots.map((s) => (
            <div key={s.key} className="scr-league-bracket-slot" style={{ left: s.x, top: s.y, width: COL_W, height: CARD_H }}>
              {s.node}
            </div>
          ))}
          {badges.map((b) => (
            <div key={b.key} className="scr-league-bracket-badge" style={{ left: b.x, top: b.y }}>
              {b.node}
            </div>
          ))}
        </div>
      </div>
      {confirmingBracket && (
        <ConfirmDialog
          title="대진 확정"
          message="대진을 확정하면 1라운드 시드(팀 배정)를 더 이상 바꿀 수 없어요. 계속할까요?"
          confirmLabel={busy ? "확정 중..." : "확정"}
          onConfirm={confirmBracket}
          onCancel={() => setConfirmingBracket(false)}
        />
      )}
    </div>
  );
}
