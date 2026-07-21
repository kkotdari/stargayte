import { useState } from "react";
import { Spinner } from "../../components/common/Feedback";
import { api } from "../../api/client";
import { cx } from "../../utils/format";
import type { League, LeagueMatch } from "../../types";

// 라운드 번호를 결승 기준 상대 이름으로 — draw_size가 최대 8(6팀 상한)이라 3라운드까지만
// 있으면 되고, 그 이상은 그냥 번호로 표시한다(구조적으로 지금은 나올 일이 없다).
function roundLabel(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return "결승";
  if (fromEnd === 1) return "준결승";
  return `${round}라운드`;
}

function MatchCard({ match }: { match: LeagueMatch }) {
  const decided = match.winnerTeamId !== null;
  return (
    <div className={cx("scr-league-bracket-match", match.isDead && "scr-league-bracket-match-dead")}>
      {match.isDead ? (
        <div className="scr-league-bracket-match-empty">공백(부전 없음)</div>
      ) : (
        <>
          <div className={cx(
            "scr-league-bracket-side",
            decided && match.teamA && match.winnerTeamId === match.teamA.id && "scr-league-bracket-side-win",
          )}
          >
            {match.teamA ? `${match.teamA.label}팀` : <span className="scr-league-bracket-side-empty">미정</span>}
          </div>
          <div className={cx(
            "scr-league-bracket-side",
            decided && match.teamB && match.winnerTeamId === match.teamB.id && "scr-league-bracket-side-win",
          )}
          >
            {match.teamB ? `${match.teamB.label}팀` : <span className="scr-league-bracket-side-empty">미정</span>}
          </div>
          {match.setsWonA !== null && match.setsWonB !== null && (
            <div className="scr-league-bracket-score">{match.setsWonA} : {match.setsWonB}</div>
          )}
        </>
      )}
    </div>
  );
}

// 리그 대진표 — 3단계(요청: "기능을 나눠서 조금씩 배포")는 생성 버튼 + 읽기 전용 표시만.
// 슬롯 드래그앤드랍 배정/결과 입력은 다음 단계에서 이어 붙인다.
export default function LeagueBracket({ league, onUpdated }: { league: League; onUpdated: (l: League) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (league.drawSize === null) {
    const canGenerate = league.teams.length >= 2;
    const generate = async () => {
      setErr("");
      setBusy(true);
      try {
        onUpdated(await api.generateLeagueBracket(league.id));
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
        <button
          type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid scr-btn-sm"
          onClick={generate} disabled={busy || !canGenerate}
        >
          {busy && <Spinner size={14} />} 대진표 생성
        </button>
        {!canGenerate && <p className="scr-hint scr-hint-left">최소 2팀이 있어야 대진표를 만들 수 있어요.</p>}
      </div>
    );
  }

  const totalRounds = Math.round(Math.log2(league.drawSize));
  const rounds = Array.from({ length: totalRounds }, (_, i) => i + 1);

  return (
    <div className="scr-league-bracket-panel">
      <h2 className="scr-league-section-title">대진표 ({league.drawSize}강)</h2>
      <div className="scr-league-bracket-scroll">
        <div className="scr-league-bracket-grid">
          {rounds.map((r) => {
            const matches = league.matches
              .filter((m) => m.round === r)
              .sort((a, b) => a.slotInRound - b.slotInRound);
            return (
              <div key={r} className="scr-league-bracket-col">
                <div className="scr-league-bracket-col-head">{roundLabel(r, totalRounds)}</div>
                {matches.map((m) => <MatchCard key={m.id} match={m} />)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
