import { useState } from "react";
import { X } from "lucide-react";
import { Spinner } from "../../components/common/Feedback";
import Select from "../../components/common/Select";
import Avatar from "../../components/common/Avatar";
import { api } from "../../api/client";
import { cx } from "../../utils/format";
import { formatChallengeSchedule } from "../../utils/date";
import type { League, LeagueMatch, LeagueMatchSide, LeagueTeam } from "../../types";

const MAX_TEAMS_TEAM = 6;
const MAX_TEAMS_INDIVIDUAL = 24;

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
// (세로로)"), 개인리그는 그 팀(=선수 1명)의 이름만 보여준다.
function TeamSlotCard({ team, isWinner, mode }: { team: LeagueTeam; isWinner: boolean; mode: League["mode"] }) {
  return (
    <div className={cx("scr-league-bracket-team-card", isWinner && "scr-league-bracket-team-card-win")}>
      {mode === "team" && <span className="scr-league-bracket-team-card-label">{team.label}</span>}
      {team.roster.length === 0 ? (
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
      )}
    </div>
  );
}

// 비어있는 칸 — 수정 모드면 배정 가능한 팀(이 라운드 다른 칸에 없는 팀)을 고르는
// 드롭다운, 아니면 그냥 "미정".
function EmptySlot({
  league, match, canEdit, onAssign,
}: {
  league: League; match: LeagueMatch; canEdit: boolean;
  onAssign: (teamId: number) => void;
}) {
  if (!canEdit || match.isDead || match.winnerTeamId !== null) {
    return <div className="scr-league-bracket-team-empty">{match.isDead ? "부전(공백)" : "미정"}</div>;
  }
  const usedInRound = new Set(
    league.matches
      .filter((m) => m.round === match.round)
      .flatMap((m) => [m.teamA?.id, m.teamB?.id])
      .filter((id): id is number => id != null),
  );
  const options = league.teams
    .filter((t) => !usedInRound.has(t.id))
    .map((t) => ({ value: String(t.id), label: `${t.label}팀 ${t.roster.map((r) => r.nickname).join(", ")}` }));
  return (
    <Select
      value="" options={options} onChange={(v) => onAssign(Number(v))}
      placeholder={league.mode === "individual" ? "선수 배정" : "팀 배정"}
      size="sm" className="scr-league-bracket-slot-select"
    />
  );
}

function MatchCard({
  league, match, canEdit, busy, onAssign, onClear,
}: {
  league: League; match: LeagueMatch; canEdit: boolean; busy: boolean;
  onAssign: (side: LeagueMatchSide, teamId: number) => void;
  onClear: (side: LeagueMatchSide) => void;
}) {
  const decided = match.winnerTeamId !== null;
  const teamA = match.teamA ? (league.teams.find((t) => t.id === match.teamA!.id) ?? null) : null;
  const teamB = match.teamB ? (league.teams.find((t) => t.id === match.teamB!.id) ?? null) : null;

  const renderSide = (side: LeagueMatchSide, team: LeagueTeam | null, teamRef: { id: number } | null) => {
    if (!team) {
      return <EmptySlot league={league} match={match} canEdit={canEdit} onAssign={(id) => onAssign(side, id)} />;
    }
    return (
      <div className="scr-league-bracket-slot-filled">
        <TeamSlotCard team={team} isWinner={decided && match.winnerTeamId === teamRef?.id} mode={league.mode} />
        {canEdit && !decided && (
          <button
            type="button" className="scr-league-bracket-slot-clear"
            onClick={() => onClear(side)} disabled={busy} aria-label="배정 취소"
          >
            <X size={12} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className={cx("scr-league-bracket-match", match.isDead && "scr-league-bracket-match-dead")}>
      {match.isDead ? (
        <div className="scr-league-bracket-match-empty">공백(부전 없음)</div>
      ) : (
        <>
          {renderSide("a", teamA, match.teamA)}
          {renderSide("b", teamB, match.teamB)}
          {match.setsWonA !== null && match.setsWonB !== null && (
            <div className="scr-league-bracket-score">{match.setsWonA} : {match.setsWonB}</div>
          )}
          {match.scheduledAt && (
            <div className="scr-league-bracket-when">{formatChallengeSchedule(match.scheduledAt)}</div>
          )}
        </>
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
  const maxTeams = league.mode === "individual" ? MAX_TEAMS_INDIVIDUAL : MAX_TEAMS_TEAM;
  const [teamCount, setTeamCount] = useState(() => String(Math.max(2, Math.min(maxTeams, league.teams.length || 2))));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (league.drawSize === null) {
    if (!canEdit) {
      return (
        <div className="scr-league-bracket-panel">
          <h2 className="scr-league-section-title">대진표</h2>
          <div className="scr-empty">아직 대진표가 만들어지지 않았어요</div>
        </div>
      );
    }
    const countOptions = Array.from({ length: maxTeams - 1 }, (_, i) => i + 2)
      .map((n) => ({ value: String(n), label: `${n}${league.mode === "individual" ? "명" : "팀"}` }));
    const generate = async () => {
      setErr("");
      setBusy(true);
      try {
        onUpdated(await api.generateLeagueBracket(league.id, Number(teamCount)));
      } catch (e) {
        setErr(e instanceof Error ? e.message : "대진표를 만들지 못했어요.");
      } finally {
        setBusy(false);
      }
    };
    return (
      <div className="scr-league-bracket-panel">
        <h2 className="scr-league-section-title">대진표</h2>
        {err && <div className="scr-err">{err}</div>}
        <div className="scr-league-bracket-generate-row">
          <Select value={teamCount} options={countOptions} onChange={setTeamCount} size="sm" />
          <button
            type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid scr-btn-sm"
            onClick={generate} disabled={busy}
          >
            {busy && <Spinner size={14} />} 대진표 생성
          </button>
        </div>
        <p className="scr-hint scr-hint-left">
          지금 있는 {league.mode === "individual" ? "선수" : "팀"}과 상관없이 규모를 먼저 정해 빈 대진표를 만들고,
          이후 각 칸에 직접 배정할 수 있어요.
        </p>
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
      <h2 className="scr-league-section-title">대진표 ({league.drawSize}강)</h2>
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
            return (
              <div key={r} className="scr-league-bracket-col">
                <div className="scr-league-bracket-col-head">{roundLabel(r, totalRounds)}</div>
                <div className="scr-league-bracket-col-matches">
                  {isFinal ? (
                    matches.map((m) => (
                      <MatchCard
                        key={m.id} league={league} match={m} canEdit={canEdit} busy={busy}
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
                          m1.winnerTeamId !== null && "scr-league-bracket-pair-top-won",
                          m2.winnerTeamId !== null && "scr-league-bracket-pair-bottom-won",
                        )}
                      >
                        <MatchCard
                          league={league} match={m1} canEdit={canEdit} busy={busy}
                          onAssign={(side, teamId) => handleAssign(m1.id, side, teamId)}
                          onClear={(side) => handleClear(m1.id, side)}
                        />
                        <MatchCard
                          league={league} match={m2} canEdit={canEdit} busy={busy}
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
