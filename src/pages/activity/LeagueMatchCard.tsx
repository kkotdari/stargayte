import { Swords } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import { cx } from "../../utils/format";
import { useAppStore } from "../../store/appStore";
import type { LeagueMatchActivity, LeagueMatchTeam } from "../../types";
import { ActivityCard } from "./ActivityCard";

/** 맞붙는 한 편 — 로스터를 세로로 쌓는다(요청). 너 나와 카드의 편과 같은 방식이다:
 *  사람마다 프사 한 장과 닉네임 한 줄, 그게 위에서 아래로 쌓인다. 팀원이 늘어도 줄이
 *  아래로 자랄 뿐이라 가운데의 점수 자리가 흔들리지 않는다.
 *
 *  로스터가 아직 안 짜인 팀은 라벨(A·B)만 남는다 — 대진표에서 부르던 이름이다. */
function LeagueSide({ team, won }: { team: LeagueMatchTeam | null; won: boolean }) {
  const memberOf = useAppStore((s) => s.memberOf);
  if (team === null) {
    return <div className="scr-league-match-side"><span className="scr-league-match-tbd">미정</span></div>;
  }
  if (team.members.length === 0) {
    return (
      <div className={cx("scr-league-match-side", won && "scr-league-match-side-won")}>
        <span className="scr-league-match-label">{team.label}</span>
      </div>
    );
  }
  return (
    <div className={cx("scr-league-match-side", won && "scr-league-match-side-won")}>
      {team.members.map((p) => (
        <div className="scr-league-match-person" key={p.memberId}>
          <Avatar member={memberOf(p.memberId)} size={34} />
          <span className="scr-league-match-name">{p.nickname}</span>
        </div>
      ))}
    </div>
  );
}

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
  return (
    <ActivityCard
      dateLabel={dateLabel}
      icon={<Swords size={16} aria-hidden />}
      label={`${match.leagueName} ${match.roundName}`}
      timeText={timeText}
      comment={footer}
    >
      <div className={cx("scr-league-match-card", played && "scr-league-match-card-played")}>
        <LeagueSide team={match.teamA} won={played && match.winnerSide === "a"} />
        <div className="scr-league-match-score">
          {played ? `${match.setsWonA}:${match.setsWonB}` : "vs"}
        </div>
        <LeagueSide team={match.teamB} won={played && match.winnerSide === "b"} />
      </div>
    </ActivityCard>
  );
}
