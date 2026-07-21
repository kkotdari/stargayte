import { useState } from "react";
import { Spinner } from "../../components/common/Feedback";
import Select from "../../components/common/Select";
import Avatar from "../../components/common/Avatar";
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
// 거나 똑같아").
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
// 이미 이 라운드 다른 자리에 배정된 팀도 목록에서 빠지지 않고 그대로 나오고, 골라서
// 다시 배정하면 그 팀이 있던 자리는 서버가 자동으로 미지정 처리한다(요청: "이미
// 지정된 팀도 드롭다운에 나오고 새로 지정하면 기존 지정된 슬롯을 미지정으로 지우는
// 식" — set_match_slot이 이 "옮기기"를 한 번에 처리한다). 2라운드부터는 팀을 직접
// 배정하는 게 아니라 이전 라운드 결과가 입력되면 이긴 팀이 자동으로 채워지는
// 자리라 드롭다운을 아예 보여주지 않는다(요청: "2라운드 부터는 팀배정으로 할게
// 아니라 경기 결과 입력시 이긴팀을 자동으로 렌더해야지"). 이미 결과가 정해진(부전승
// 포함) 경기의 빈 자리는 "미정"이 아니라 "부전"으로 다르게 표시한다. 드래그앤드랍
// 편집은 폐기 — 이 드롭다운 방식으로 대체한다.
function SlotCell({
  league, match, team, teamRef, canEdit, busy, mode, compact, onAssign, onClear,
}: {
  league: League; match: LeagueMatch;
  team: LeagueTeam | null; teamRef: { id: number } | null; canEdit: boolean; busy: boolean;
  mode: League["mode"]; compact: boolean;
  onAssign: (teamId: number) => void; onClear: () => void;
}) {
  const decided = match.winnerTeamId !== null;
  const editable = canEdit && match.round === 1 && !match.isDead && !decided;

  if (!editable) {
    if (!team) {
      if (decided) return <div className="scr-league-bracket-team-empty">부전</div>;
      return <div className="scr-league-bracket-team-empty">{match.isDead ? "공백" : "미정"}</div>;
    }
    return <TeamSlotCard team={team} isWinner={decided && match.winnerTeamId === teamRef?.id} mode={mode} compact={compact} />;
  }

  // 이 라운드의 다른 자리에 이미 배정된 팀은 목록에서 뺀다(요청: "드롭다운에 현재
  // 지정된 팀은 안나와야지 그래도") — 지금 이 자리에 배정된 팀 자신은 당연히 남긴다.
  const usedElsewhereInRound = new Set(
    league.matches
      .filter((m) => m.round === match.round && m.id !== match.id)
      .flatMap((m) => [m.teamA?.id, m.teamB?.id])
      .filter((id): id is number => id != null),
  );
  const pickableTeams = league.teams.filter((t) => !usedElsewhereInRound.has(t.id));

  const handleChange = (v: string) => (v === "" ? onClear() : onAssign(Number(v)));
  const select = mode === "individual" ? (
    <Select
      value={team ? String(team.id) : ""}
      options={[
        { value: "", label: "미지정" },
        ...pickableTeams.map((t) => ({ value: String(t.id), label: t.roster[0]?.nickname ?? `${t.label}(로스터 없음)` })),
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
        ...pickableTeams.map((t) => ({
          value: String(t.id), label: `${t.label}팀 ${t.roster.map((r) => r.nickname).join(", ") || "로스터 없음"}`,
          shortLabel: t.label,
        })),
      ]}
      onChange={handleChange}
      size="sm" className="scr-league-bracket-label-select scr-cselect-plain" minDropWidth={280}
      disabled={busy}
    />
  );
  return <TeamSlotCard team={team} isWinner={false} mode={mode} compact={compact} editSelect={select} />;
}

function MatchCard({
  league, match, canEdit, busy, stretch, onAssign, onClear,
}: {
  league: League; match: LeagueMatch; canEdit: boolean; busy: boolean; stretch: boolean;
  onAssign: (side: LeagueMatchSide, teamId: number) => void;
  onClear: (side: LeagueMatchSide) => void;
}) {
  const decided = match.winnerTeamId !== null;
  const teamA = match.teamA ? (league.teams.find((t) => t.id === match.teamA!.id) ?? null) : null;
  const teamB = match.teamB ? (league.teams.find((t) => t.id === match.teamB!.id) ?? null) : null;
  const compact = league.mode === "team" && match.round > 1;
  const winnerSide = decided
    ? (match.winnerTeamId === match.teamA?.id ? "a" : match.winnerTeamId === match.teamB?.id ? "b" : null)
    : null;

  const renderSide = (side: LeagueMatchSide, team: LeagueTeam | null, teamRef: { id: number } | null) => (
    <SlotCell
      league={league} match={match} team={team} teamRef={teamRef} canEdit={canEdit} busy={busy}
      mode={league.mode} compact={compact}
      onAssign={(id) => onAssign(side, id)} onClear={() => onClear(side)}
    />
  );

  // 죽은(is_dead) 칸도 실제 경기와 같은 크기의 상자로 그린다 — 짝(pair) 커넥터가 두
  // 자식의 높이를 반반(25%/75%)으로 가정하고 위치를 잡기 때문에, 죽은 쪽만 모양이
  // 다르면(예전엔 텍스트 한 줄) 그 계산이 어긋나 연결선이 이상한 자리를 가리켰다.
  if (match.isDead) {
    return (
      <div className={cx("scr-league-bracket-match-wrap", stretch && "scr-league-bracket-match-wrap-stretch")}>
        <div className="scr-league-bracket-match scr-league-bracket-match-void">
          <div className="scr-league-bracket-team-empty">공백</div>
        </div>
      </div>
    );
  }

  return (
    <div className={cx("scr-league-bracket-match-wrap", stretch && "scr-league-bracket-match-wrap-stretch")}>
      {/* 맞붙는 두 팀은 상자로 묶지 않고, .scr-league-bracket-pair와 같은 방식(위/아래
          절반이 가운데서 만나는 선)으로 두 팀 사이를 브라켓 선으로 잇는다(요청: "대결팀끼리
          묶는 테두리를 없애고 대결팀끼리 브라켓으로 연결해야돼") — 이 연결점이 그대로
          .scr-league-bracket-pair 커넥터의 시작점이 돼(margin-right로 폭 확보) 두 단계
          선이 한 줄처럼 이어져 보인다. */}
      <div
        className={cx(
          "scr-league-bracket-match",
          winnerSide === "a" && "scr-league-bracket-match-a-won",
          winnerSide === "b" && "scr-league-bracket-match-b-won",
        )}
      >
        {renderSide("a", teamA, match.teamA)}
        {renderSide("b", teamB, match.teamB)}
      </div>
      {match.setsWonA !== null && match.setsWonB !== null && (
        <div className="scr-league-bracket-score">{match.setsWonA} : {match.setsWonB}</div>
      )}
      {match.scheduledAt && (
        <div className="scr-league-bracket-when">{formatChallengeSchedule(match.scheduledAt)}</div>
      )}
    </div>
  );
}

// 리그 대진표. canEdit이면 팀 수를 미리 정해 빈 대진표를 만들고, 각 칸에 팀을 직접
// 배정할 수 있다(요청: "대진표 생성 누르면 빈 대진표가 생기고 각 칸에 누가 들어갈지
// 정할 수 있는 시스템으로"). 아닌 경우(일반 회원/보기 모드)는 순수 읽기 전용.
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
  const [teamCount, setTeamCount] = useState(() => Math.max(2, league.teams.length || 2));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

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
  const generateRow = canEdit && (
    <div className="scr-league-bracket-generate-row">
      <span className="scr-label">{league.mode === "individual" ? "참가선수수" : "참가팀수"}</span>
      <input
        type="number" min={2} value={teamCount}
        onChange={(e) => setTeamCount(Math.max(2, Number(e.target.value) || 2))}
        className="scr-input scr-league-bracket-count-input"
      />
      <button
        type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid scr-btn-sm"
        onClick={generate} disabled={busy}
      >
        {busy && <Spinner size={14} />} 확인
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

  const totalRounds = Math.round(Math.log2(league.drawSize));
  const rounds = Array.from({ length: totalRounds }, (_, i) => i + 1);

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

  return (
    <div className="scr-league-bracket-panel">
      {/* "대진표" 타이틀 생략(요청: "대진표 타이틀은 없어도 다 아니까 삭제") — 위 요약
          줄에 이미 "대진표 N강"이 있어 중복이었다. */}
      {generateRow}
      {err && <div className="scr-err">{err}</div>}
      <div className="scr-league-bracket-scroll scr-scroll">
        <div className="scr-league-bracket-grid">
          {rounds.map((r) => {
            const matches = league.matches
              .filter((m) => m.round === r)
              .sort((a, b) => a.slotInRound - b.slotInRound);
            const isFinal = r === totalRounds;
            // 마지막 라운드가 아니면 다음 라운드로 이어지는 연결선을 그릴 수 있게 인접한
            // 두 경기씩 짝(pair)으로 묶는다 — 짝 상자 하나에 커넥터 하나(요청: "토너먼트
            // 답게 선으로 이어서... 가운데로 타고타고 올라가는 식").
            const pairs = isFinal
              ? null
              : Array.from({ length: matches.length / 2 }, (_, i) => [matches[2 * i], matches[2 * i + 1]] as const);
            // 1라운드는 카드 내용물 높이 그대로 grid 전체 높이의 기준이 되고(natural),
            // 2라운드부터는 그 기준 높이에 맞춰 늘어난 칸 안에서 flex:1로 정확히
            // 등분해야(stretch) 1라운드 커넥터 중심과 어긋나지 않는다.
            const stretch = r !== 1;
            return (
              <div key={r} className="scr-league-bracket-col">
                <div className="scr-league-bracket-col-head">{roundLabel(r, totalRounds)}</div>
                <div className="scr-league-bracket-col-matches">
                  {isFinal ? (
                    matches.map((m) => (
                      <MatchCard
                        key={m.id} league={league} match={m} canEdit={canEdit} busy={busy} stretch={stretch}
                        onAssign={(side, teamId) => handleAssign(m.id, side, teamId)}
                        onClear={(side) => handleClear(m.id, side)}
                      />
                    ))
                  ) : (
                    pairs!.map(([m1, m2], i) => (
                      <div
                        key={i}
                        className={cx(
                          "scr-league-bracket-pair",
                          stretch && "scr-league-bracket-pair-stretch",
                          m1.winnerTeamId !== null && "scr-league-bracket-pair-top-won",
                          m2.winnerTeamId !== null && "scr-league-bracket-pair-bottom-won",
                        )}
                      >
                        <MatchCard
                          league={league} match={m1} canEdit={canEdit} busy={busy} stretch={stretch}
                          onAssign={(side, teamId) => handleAssign(m1.id, side, teamId)}
                          onClear={(side) => handleClear(m1.id, side)}
                        />
                        <MatchCard
                          league={league} match={m2} canEdit={canEdit} busy={busy} stretch={stretch}
                          onAssign={(side, teamId) => handleAssign(m2.id, side, teamId)}
                          onClear={(side) => handleClear(m2.id, side)}
                        />
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
