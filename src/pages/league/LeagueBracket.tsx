import { useEffect, useMemo, useState } from "react";
import { Spinner } from "../../components/common/Feedback";
import Select from "../../components/common/Select";
import Avatar from "../../components/common/Avatar";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import { api } from "../../api/client";
import { cx } from "../../utils/format";
import { formatWhen } from "../../utils/date";
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
    // 개인전은 슬롯을 팀 카드 패널로 한 번 더 감싸지 않는다(요청: 유저칩 자체가 패널) —
    // 안의 드롭다운(수정)/멤버 칩(읽기)이 곧 패널이 되도록 카드 배경/테두리를 없앤다.
    mode === "individual" && "scr-league-bracket-team-card-individual",
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
// 채워지는 자리였다. 이제는 어느 라운드의 칸에나 직접 앉힐 수도 있다(요청: 모든 칸에
// 대진을 넣을 수 있게) — 앉히면 그 아래 가지는 확정할 때 사라지고, 안 앉히면 예전처럼
// 아래 경기 결과가 올라와 채운다. 대진이 확정되기
// 전에는 부전승으로만 결정된 자리도 계속 드롭다운으로 재배정할 수 있다(요청: "대진
// 확정 버튼을 누르면 그때부터 시드는 변경 못하게... 그전엔 부전승팀도 수정
// 가능해야해") — 실제로 치른 경기 결과(setsWonA가 있는 경기)만 확정 여부와 무관하게
// 항상 잠긴다. 드래그앤드랍 편집은 폐기 — 이 드롭다운 방식으로 대체한다.
function SlotCell({
  league, match, team, teamRef, editable, busy, mode, compact, onAssign, onClear,
}: {
  league: League; match: LeagueMatch;
  team: LeagueTeam | null; teamRef: { id: number } | null; editable: boolean; busy: boolean;
  mode: League["mode"]; compact: boolean;
  onAssign: (teamId: number) => void; onClear: () => void;
}) {
  const decided = match.winnerTeamId !== null;

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
        // 읽기전용 카드(아바타 18px + 이름)와 같은 모양이 되도록 옵션마다 프사를 넘긴다
        // (요청: 편집 중인 대진표에도 아바타 표시) — Select가 선택된 값(트리거)에도
        // 이 아바타를 그대로 보여준다.
        ...league.teams.map((t) => ({
          value: String(t.id),
          label: t.roster[0]?.nickname ?? `${t.label}(로스터 없음)`,
          avatar: t.roster[0]
            ? <Avatar member={{ id: t.roster[0].memberId, nickname: t.roster[0].nickname, avatar: t.roster[0].avatar }} size={18} />
            : undefined,
        })),
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

// 로컬 시드 편집 상태 — 편집 가능한 자리의 배정을 `${matchId}:${side}` → teamId(미지정
// null)로 담는다. 드롭다운을 만질 때마다 서버에 저장하지 않고 이 로컬 상태만 바꾼 뒤, '시드 저장'
// 버튼을 눌러야 한 번에 서버로 보낸다(요청).
type SeedMap = Record<string, number | null>;

/* 판은 꽉 찬 나무가 아니다 — 우승 자리에서 시작해 필요한 데만 왼쪽으로 가지를 친다(요청).
   (r, s)의 a쪽을 먹이는 아래 경기는 (r-1, 2s), b쪽은 (r-1, 2s+1)이고, 그 칸이 없으면
   그 자리는 팀을 직접 앉히는 자리다. */
function childKey(match: LeagueMatch, side: LeagueMatchSide): string {
  return `${match.round - 1}:${match.slotInRound * 2 + (side === "a" ? 0 : 1)}`;
}

function indexMatches(league: League): Map<string, LeagueMatch> {
  const by = new Map<string, LeagueMatch>();
  league.matches.forEach((m) => by.set(`${m.round}:${m.slotInRound}`, m));
  return by;
}

/* 이 자리에 지금 팀을 앉힐 수 있는지 — 라운드를 안 가린다(요청: 아무 데나 시드 배정).
   단 가지가 달린 자리는 뺀다: 거긴 아래 경기에서 이기고 올라올 자리다. 결과가 들어간
   경기와 확정된 대진도 잠긴다. */
function isEditableSeat(
  league: League, match: LeagueMatch, side: LeagueMatchSide, canEdit: boolean,
  by: Map<string, LeagueMatch>,
): boolean {
  if (!canEdit || league.bracketLocked || match.setsWonA !== null) return false;
  return !by.has(childKey(match, side));
}

// 서버가 내려준 현재 시드(편집 가능한 자리만) → SeedMap. 로컬 편집의 시작점이자
// '변경됨(dirty)' 판정의 기준이다.
function serverSeeding(league: League, canEdit: boolean): SeedMap {
  const by = indexMatches(league);
  const m: SeedMap = {};
  league.matches.forEach((match) => {
    (["a", "b"] as const).forEach((side) => {
      if (!isEditableSeat(league, match, side, canEdit, by)) return;
      m[`${match.id}:${side}`] = (side === "a" ? match.teamA : match.teamB)?.id ?? null;
    });
  });
  return m;
}

// 리그 대진표. canEdit이면 우승 자리에서 시작해 왼쪽으로 가지를 쳐 판을 짜고, 각 자리에
// 팀을 직접 배정할 수 있다(요청: "최종 승리자 한 칸에서 역으로 시작해서 대진을 만드는
// 거야... 그러면 내가 필요한 데만 가지를 늘릴 수 있어"). 아닌 경우(일반 회원/보기 모드)는
// 순수 읽기 전용.
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmingBracket, setConfirmingBracket] = useState(false);
  /* 가지 지우기 확인 — matchId가 null이면 우승 자리, 즉 판 전체를 지운다. 되돌리기 수준의
     작은 삭제(빈 경기 하나)는 묻지 않고 바로 지운다. */
  const [cut, setCut] = useState<
    { matchId: number | null; side: LeagueMatchSide; matches: number; teams: number } | null
  >(null);

  // 시드 편집은 로컬 상태로만 하고 '시드 저장'을 눌러야 서버로 보낸다(요청: 그때그때
  // 저장하면 매번 왕복+리렌더로 느려서). league prop이 실제로 바뀔 때(생성/확정/저장/팀편집
  // 으로 새 리그를 받았을 때)만 로컬 시드를 서버 값으로 리셋한다 — 로컬 편집 중에는 API를
  // 안 부르니 league 참조가 그대로라 편집이 유지된다.
  const [seeds, setSeeds] = useState<SeedMap>(() => serverSeeding(league, canEdit));
  /* canEdit도 함께 본다 — 편집 모드를 켜는 순간 '편집 가능한 칸'의 목록 자체가 생긴다.
     league만 보던 때는 편집을 켜도 seeds가 켜기 전(빈 값) 그대로라, 아무것도 안 고쳤는데
     '저장할 게 있음(dirty)'으로 읽혀 '대진 확정'이 계속 잠겨 있었다(실측). */
  useEffect(() => {
    setSeeds(serverSeeding(league, canEdit));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league, canEdit]);
  const dirty = useMemo(() => {
    const srv = serverSeeding(league, canEdit);
    const keys = new Set([...Object.keys(srv), ...Object.keys(seeds)]);
    for (const k of keys) if ((srv[k] ?? null) !== (seeds[k] ?? null)) return true;
    return false;
  }, [seeds, league, canEdit]);

  // 대진 확정 — 배정을 잠그는 동시에 대진 모양을 굳힌다(요청: 확정을 누르면 필요 없는
  // 칸이 사라진다). 아무도 안 앉은 가지가 이때 죽고, 혼자 남은 팀이 다음 라운드로
  // 올라간다. 되돌릴 수 없는 조작이라 확인창을 거친다.
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

  // '시드 저장' — 편집 가능한 자리 '전체'의 현재 로컬 배정을 한 번에 보낸다(서버가 비우고→
  // 다시 배정→부전승 자동처리). 응답으로 온 리그로 화면이 갱신된다.
  const postSeeding = () => {
    const by = indexMatches(league);
    const assignments: { matchId: number; side: LeagueMatchSide; teamId: number | null }[] = [];
    league.matches.forEach((m) => {
      (["a", "b"] as const).forEach((side) => {
        if (!isEditableSeat(league, m, side, canEdit, by)) return;
        assignments.push({ matchId: m.id, side, teamId: seeds[`${m.id}:${side}`] ?? null });
      });
    });
    return api.setLeagueBracketSeeding(league.id, assignments);
  };
  const saveSeeding = async () => {
    setErr("");
    setBusy(true);
    try {
      onUpdated(await postSeeding());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "시드를 저장하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  /* 가지 치기/지우기는 누르는 즉시 서버로 간다 — 새 칸의 id와 밀린 라운드 번호가 서버에서
     오기 때문에 로컬로 흉내낼 수가 없다. 그래서 아직 저장 안 한 시드 편집이 있으면 먼저
     보낸다: 안 그러면 응답으로 온 리그가 로컬 편집을 덮어써 방금 고른 팀들이 사라진다. */
  const runShapeChange = async (fn: () => Promise<League>, fallback: string) => {
    setErr("");
    setBusy(true);
    try {
      if (dirty) await postSeeding();
      onUpdated(await fn());
      setCut(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : fallback);
    } finally {
      setBusy(false);
    }
  };
  const startBracket = () => runShapeChange(
    () => api.startLeagueBracket(league.id), "대진표를 시작하지 못했어요.",
  );
  const branchSeat = (matchId: number, side: LeagueMatchSide) => runShapeChange(
    () => api.branchLeagueSlot(league.id, matchId, side), "가지를 치지 못했어요.",
  );
  const cutSeat = (matchId: number | null, side: LeagueMatchSide) => runShapeChange(
    () => (matchId === null
      ? api.deleteLeagueBracket(league.id)
      : api.unbranchLeagueSlot(league.id, matchId, side)),
    "가지를 지우지 못했어요.",
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
    /* 아직 아무것도 없을 때 — 우승 자리 한 칸만 놓고, 그 왼쪽 +로 시작한다(요청: "최종
       승리자 한 칸에서 역으로 시작해서 대진을 만드는 거야"). */
    return (
      <div className="scr-league-bracket-panel">
        {err && <div className="scr-err">{err}</div>}
        <div className="scr-league-bracket-start">
          <button
            type="button" className="scr-league-bracket-branch" onClick={startBracket}
            disabled={busy} title="여기서 갈라 대진표를 시작합니다" aria-label="대진표 시작"
          >
            {busy ? <Spinner size={12} /> : "+"}
          </button>
          <div className="scr-league-bracket-champ">우승</div>
        </div>
        <p className="scr-league-bracket-hint">
          우승 자리 왼쪽의 +를 눌러 가지를 칩니다. 필요한 가지에서만 다시 +를 누르면
          한쪽만 깊은 대진도 만들 수 있어요.
        </p>
      </div>
    );
  }

  const totalRounds = league.matches.reduce((n, m) => Math.max(n, m.round), 1);
  const compact = league.mode === "team";

  // 로컬 시드 편집 — 서버에 저장하지 않고 seeds 상태만 바꾼다. 같은 팀을 다른 편집 자리에
  // 골라 넣으면 그 자리를 비워(서버 set_match_slot의 '팀 이동'을 로컬에서도 재현) 한 팀이
  // 두 자리에 동시에 보이지 않게 한다.
  const handleAssign = (matchId: number, side: LeagueMatchSide, teamId: number) => {
    setSeeds((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) if (next[k] === teamId) next[k] = null;
      next[`${matchId}:${side}`] = teamId;
      return next;
    });
  };
  const handleClear = (matchId: number, side: LeagueMatchSide) => {
    setSeeds((prev) => ({ ...prev, [`${matchId}:${side}`]: null }));
  };

  // 카드 높이는 로스터 인원수와 무관하게 고정한다 — 좌표 계산이 이 고정값을 전제로
  // 한다. 개인전은 로스터가 항상 1명이라 훨씬 짧게 잡는다.
  const CARD_H = league.mode === "individual" ? 46 : 96;
  const ROW_GAP = 10;
  const COL_W = 180;
  const COL_GAP = 44;
  // 왼쪽 여백 — 1라운드 카드 왼쪽에도 가지 버튼이 붙는다.
  const PAD_L = 30;
  // 첫 꺾임(카드에서 나온 선이 꺾이는 곳)만 살짝 둥글게(요청). 두 가지가 만나는 지점은
  // elbowPath에서 직각으로 유지한다.
  const CORNER_R = 8;

  const colX = (r: number) => PAD_L + (r - 1) * (COL_W + COL_GAP);
  const byKey = indexMatches(league);
  const rootMatch = byKey.get(`${totalRounds}:0`) ?? null;
  const childOf = (m: LeagueMatch, side: LeagueMatchSide) => byKey.get(childKey(m, side)) ?? null;

  /* 세로 배치 — 판이 꽉 찬 나무가 아니라서 "N라운드엔 칸이 2^k개"라는 계산을 못 쓴다.
     대신 나무를 결승부터 훑어 내려가며, 아래 경기가 달린 자리는 그 경기의 한가운데에
     맞추고 그렇지 않은 자리(=팀을 앉히는 자리)만 한 줄씩 차지하게 한다. 꽉 찬 판에서는
     예전과 똑같은 결과가 나오고, 한쪽만 깊은 판에서도 선이 정확히 이어진다. */
  const rowH = CARD_H + ROW_GAP;
  const seatY = new Map<string, number>();   // `${matchId}:${side}` → 카드 중심 y
  const mergeY = new Map<number, number>();  // matchId → 두 카드가 합쳐지는 y
  let rows = 0;
  const place = (m: LeagueMatch): number => {
    const ys = (["a", "b"] as const).map((side) => {
      const child = childOf(m, side);
      const y = child ? place(child) : rows++ * rowH + CARD_H / 2;
      seatY.set(`${m.id}:${side}`, y);
      return y;
    });
    const mid = (ys[0] + ys[1]) / 2;
    mergeY.set(m.id, mid);
    return mid;
  };
  if (rootMatch) place(rootMatch);
  const totalHeight = Math.max(1, rows) * CARD_H + Math.max(0, rows - 1) * ROW_GAP;
  // 우승 자리가 맨 오른쪽 한 칸을 더 차지한다 — 판을 짤 때의 출발점이자, 다 끝나면
  // 우승 팀이 앉는 자리다.
  const champX = colX(totalRounds + 1);
  const canvasWidth = champX + COL_W;

  const connectors: { path: string; won: boolean }[] = [];
  league.matches.forEach((match) => {
    const mid = mergeY.get(match.id);
    if (mid === undefined) return;
    const x1 = colX(match.round) + COL_W;
    const bendX = x1 + COL_GAP / 2;
    const x2 = colX(match.round + 1);
    const winnerSide = match.winnerTeamId == null
      ? null
      : match.winnerTeamId === match.teamA?.id ? "a" : match.winnerTeamId === match.teamB?.id ? "b" : null;
    (["a", "b"] as const).forEach((side) => {
      const y = seatY.get(`${match.id}:${side}`);
      if (y === undefined) return;
      connectors.push({
        path: elbowPath(x1, y, bendX, x2, mid, CORNER_R), won: winnerSide === side,
      });
    });
  });

  const teamOf = (id: number | null | undefined) => (id == null ? null : league.teams.find((t) => t.id === id) ?? null);
  // 화면에 보이는 배정 — 편집 가능한 자리는 서버 값이 아니라 아직 저장 안 된 로컬 시드를 쓴다.
  const seatTeamId = (m: LeagueMatch, side: LeagueMatchSide): number | null => (
    isEditableSeat(league, m, side, canEdit, byKey)
      ? seeds[`${m.id}:${side}`] ?? null
      : (side === "a" ? m.teamA : m.teamB)?.id ?? null
  );
  // 이 자리에 매달린 가지의 규모 — 지우기 전에 얼마나 날아가는지 알려주려고 센다.
  const subtreeStats = (m: LeagueMatch, side: LeagueMatchSide) => {
    const stack = [childOf(m, side)].filter(Boolean) as LeagueMatch[];
    let matches = 0;
    let teams = 0;
    while (stack.length) {
      const n = stack.pop() as LeagueMatch;
      matches += 1;
      (["a", "b"] as const).forEach((s) => {
        if (seatTeamId(n, s) !== null) teams += 1;
        const c = childOf(n, s);
        if (c) stack.push(c);
      });
    }
    return { matches, teams };
  };
  const askCut = (m: LeagueMatch | null, side: LeagueMatchSide) => {
    if (m === null) {   // 우승 자리 — 판 전체가 날아간다
      const teams = league.matches.reduce(
        (n, x) => n + (["a", "b"] as const).filter((s) => seatTeamId(x, s) !== null).length, 0,
      );
      setCut({ matchId: null, side, matches: league.matches.length, teams });
      return;
    }
    const st = subtreeStats(m, side);
    // 방금 친 가지를 무르는 정도(빈 경기 하나)면 묻지 않는다 — 확인창이 더 성가시다.
    if (st.matches <= 1 && st.teams === 0) {
      void cutSeat(m.id, side);
      return;
    }
    setCut({ matchId: m.id, side, ...st });
  };

  const slots: { key: string; x: number; y: number; node: React.ReactNode }[] = [];
  const branchButtons: { key: string; x: number; y: number; node: React.ReactNode }[] = [];
  const badges: { key: string; x: number; y: number; node: React.ReactNode }[] = [];
  const canShape = canEdit && !league.bracketLocked;
  /* 자리 왼쪽의 +/− — 가지가 없으면 치고(+), 있으면 그 가지를 통째로 지운다(−, 요청). */
  const pushBranchButton = (
    key: string, x: number, y: number, hasChild: boolean,
    onClick: () => void, what: string,
  ) => {
    if (!canShape) return;
    branchButtons.push({
      key, x: x - PAD_L + 4, y: y - 11,
      node: (
        <button
          type="button" className="scr-league-bracket-branch" onClick={onClick} disabled={busy}
          title={hasChild ? `${what}에 달린 가지를 지웁니다` : `${what} 왼쪽에 가지를 칩니다`}
          aria-label={hasChild ? "가지 지우기" : "가지 치기"}
        >
          {hasChild ? "−" : "+"}
        </button>
      ),
    });
  };

  league.matches.forEach((match) => {
    const isCompact = compact && match.round > 1;
    const x = colX(match.round);
    (["a", "b"] as const).forEach((side) => {
      const y = seatY.get(`${match.id}:${side}`);
      if (y === undefined) return;
      const editable = isEditableSeat(league, match, side, canEdit, byKey);
      slots.push({
        key: `${match.id}-${side}`, x, y: y - CARD_H / 2,
        node: (
          <SlotCell
            league={league} match={match} team={teamOf(seatTeamId(match, side))}
            teamRef={side === "a" ? match.teamA : match.teamB}
            editable={editable} busy={busy} mode={league.mode} compact={isCompact}
            onAssign={(id) => handleAssign(match.id, side, id)} onClear={() => handleClear(match.id, side)}
          />
        ),
      });
      const child = childOf(match, side);
      pushBranchButton(
        `${match.id}-${side}-branch`, x, y, child !== null,
        () => (child ? askCut(match, side) : branchSeat(match.id, side)),
        `${roundLabel(match.round, totalRounds)} ${side === "a" ? "위" : "아래"} 자리`,
      );
    });
    if (match.setsWonA !== null || match.scheduledAt) {
      // 두 카드 사이 세로 간격(ROW_GAP)이 배지 내용보다 좁을 수 있어, 카드 사이가
      // 아니라 커넥터가 꺾이는 지점(라운드 오른쪽 여백)에 배지를 둔다 — 공간이
      // 넉넉하고, 실제 브라켓 UI에서도 흔한 위치다.
      badges.push({
        key: `${match.id}-badge`, x: x + COL_W + COL_GAP / 2, y: mergeY.get(match.id) as number,
        node: (
          <>
            {match.setsWonA !== null && match.setsWonB !== null && (
              <div className="scr-league-bracket-score">{match.setsWonA} : {match.setsWonB}</div>
            )}
            {match.scheduledAt && (
              <div className="scr-league-bracket-when">{formatWhen(match.scheduledAt, { clock: true })}</div>
            )}
          </>
        ),
      });
    }
  });

  /* 우승 자리 — 판을 짤 때의 출발점이고, 결승 승자가 여기 앉는다. 왼쪽 버튼은 늘 −다:
     여기 달린 가지가 곧 판 전체라 지우면 대진표가 사라진다. */
  const champY = rootMatch ? mergeY.get(rootMatch.id) as number : CARD_H / 2;
  const champion = rootMatch ? teamOf(rootMatch.winnerTeamId) : null;
  pushBranchButton("champ-branch", champX, champY, true, () => askCut(null, "a"), "우승 자리");

  const heads = Array.from({ length: totalRounds }, (_, i) => i + 1);

  return (
    <div className="scr-league-bracket-panel">
      {/* "대진표" 타이틀 생략(요청: "대진표 타이틀은 없어도 다 아니까 삭제") — 위 요약
          줄에 이미 "대진표 N강"이 있어 중복이었다. */}
      <div className="scr-league-bracket-toolbar">
        <div className="scr-league-bracket-seed-actions">
          {canShape && (
            <span className="scr-league-bracket-rounds-hint">
              {league.matches.length}경기 · 앉힐 자리 {league.plannedTeams ?? 0}
            </span>
          )}
          {/* 시드 편집은 로컬로만 하고 이 버튼으로 한 번에 저장한다(요청). 변경분이 있을 때만 활성화. */}
          {canEdit && !league.bracketLocked && (
            <button
              type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid scr-btn-sm"
              onClick={saveSeeding} disabled={busy || !dirty}
            >
              {busy && <Spinner size={14} />} 시드 저장
            </button>
          )}
        </div>
        {canEdit && !league.bracketLocked && (
          <button
            type="button" className="scr-btn scr-btn-sm"
            onClick={() => setConfirmingBracket(true)} disabled={busy || dirty}
            title={dirty ? "먼저 시드를 저장하세요" : undefined}
          >
            대진 확정
          </button>
        )}
      </div>
      {err && <div className="scr-err">{err}</div>}
      <div className="scr-league-bracket-scroll scr-scroll">
        <div className="scr-league-bracket-heads" style={{ width: canvasWidth, paddingLeft: PAD_L }}>
          {heads.map((r) => (
            <div key={r} className="scr-league-bracket-col-head" style={{ width: COL_W, marginRight: COL_GAP }}>
              {roundLabel(r, totalRounds)}
            </div>
          ))}
          <div className="scr-league-bracket-col-head" style={{ width: COL_W }}>우승</div>
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
          <div
            className="scr-league-bracket-slot"
            style={{ left: champX, top: champY - CARD_H / 2, width: COL_W, height: CARD_H }}
          >
            {champion
              ? <TeamSlotCard team={champion} isWinner mode={league.mode} compact={compact} />
              : <div className="scr-league-bracket-champ">우승</div>}
          </div>
          {branchButtons.map((b) => (
            <div key={b.key} className="scr-league-bracket-branch-slot" style={{ left: b.x, top: b.y }}>
              {b.node}
            </div>
          ))}
          {badges.map((b) => (
            <div key={b.key} className="scr-league-bracket-badge" style={{ left: b.x, top: b.y }}>
              {b.node}
            </div>
          ))}
        </div>
      </div>
      {cut && (
        <ConfirmDialog
          title={cut.matchId === null ? "대진표 지우기" : "가지 지우기"}
          message={(cut.matchId === null
            ? `대진표를 통째로 지웁니다. 경기 ${cut.matches}개가 사라져요.`
            : `이 자리에 매달린 경기 ${cut.matches}개가 통째로 사라져요.`)
            + (cut.teams > 0 ? `\n앉혀 둔 팀 ${cut.teams}팀의 배정도 함께 풀립니다(팀은 남아요).` : "")
            + "\n계속할까요?"}
          confirmLabel={busy ? "지우는 중..." : "지우기"}
          onConfirm={() => cutSeat(cut.matchId, cut.side)}
          onCancel={() => setCut(null)}
        />
      )}
      {confirmingBracket && (
        <ConfirmDialog
          title="대진 확정"
          message={"대진을 확정하면 팀 배정을 더 이상 바꿀 수 없어요.\n"
            + "아무도 안 앉은 가지는 이때 사라지고, 혼자 남은 팀은 다음 라운드로 올라갑니다. 계속할까요?"}
          confirmLabel={busy ? "확정 중..." : "확정"}
          onConfirm={confirmBracket}
          onCancel={() => setConfirmingBracket(false)}
        />
      )}
    </div>
  );
}
