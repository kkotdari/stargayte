import { Swords } from "lucide-react";
import type { LeagueMatchActivity } from "../../types";
import { ActivityCard } from "./ActivityCard";

/** 리그 경기 카드 — 일정이 적힌 경기가 활동에 뜰 때 펼치면 나오는 본문(요청: 리그 매치에
 *  일정 등록 시 활동에 띄움).
 *
 *  대진표에서 보는 것과는 필요한 것이 다르다. 거기서는 이 경기가 판의 어느 칸인지가 중요해
 *  라운드와 슬롯으로 그리지만, 여기서는 "언제 누가 붙나, 붙었으면 누가 이겼나"뿐이다 —
 *  활동 목록을 보는 사람은 대진표를 펴 놓고 있지 않다.
 *
 *  결과가 아직 없으면 점수 자리에 "vs"만 남는다. 0:0으로 채워 두면 "아직 안 함"과 "0:0으로
 *  끝남"이 같은 그림이 된다. */
export default function LeagueMatchCard({
  match, timeText, dateLabel, footer,
}: {
  match: LeagueMatchActivity;
  timeText?: string;
  dateLabel?: string;
  footer?: React.ReactNode;
}) {
  const played = match.setsWonA !== null && match.setsWonB !== null;
  const wonA = played && match.winnerTeam !== null && match.winnerTeam === match.teamA;
  const wonB = played && match.winnerTeam !== null && match.winnerTeam === match.teamB;
  return (
    <ActivityCard
      dateLabel={dateLabel}
      icon={<Swords size={16} aria-hidden />}
      label={`${match.leagueName} ${match.roundName}`}
      timeText={timeText}
      comment={footer}
    >
      <div className="scr-league-match-card">
        <div className={`scr-league-match-side${wonA ? " scr-league-match-side-won" : ""}`}>
          <span className="scr-league-match-team">{match.teamA ?? "미정"}</span>
        </div>
        <div className="scr-league-match-score">
          {played ? `${match.setsWonA}:${match.setsWonB}` : "vs"}
        </div>
        <div className={`scr-league-match-side${wonB ? " scr-league-match-side-won" : ""}`}>
          <span className="scr-league-match-team">{match.teamB ?? "미정"}</span>
        </div>
      </div>
    </ActivityCard>
  );
}
