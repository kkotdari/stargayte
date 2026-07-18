import MatchTeams from "../../components/common/MatchTeams";
import { Spinner } from "../../components/common/Feedback";
import { dateWithDow } from "../../utils/date";
import type { Match, MatchResult, MatchSlot, Member } from "../../types";

interface RankMatchHistoryProps {
  // 서버에서 받은 이 회원(팀)의 경기들(teamMemberIds로 이미 걸러져 옴).
  matches: Match[];
  // 이 상세의 주인공 — 개인이면 한 명, 팀이면 그 구성원 전체. 이들이 어느 편이었는지로
  // "상대"와 "내 승패"를 가른다.
  members: Member[];
  memberOf: (id: string) => Member | undefined;
  loading: boolean;
}

interface HistoryRow {
  id: number;
  date: string;
  // 주인공 편(홈)/상대 편으로 정규화한 결과 — team1=주인공, team2=상대, result는 team1 기준.
  team1: MatchSlot[];
  team2: MatchSlot[];
  result: MatchResult;
}

interface DateGroup {
  date: string;
  items: HistoryRow[];
}

// 주인공(members)이 어느 편이었든 team1(홈)=주인공, team2=상대가 되도록 정규화한다 —
// 랭킹 상세 이력은 "VS 상대 + 승/패"만 보여주므로(홈팀은 아예 뺀다) 상대가 어느 편인지와
// 주인공 기준 승패가 필요하다. 주인공이 team2였던 경기는 팀과 result를 함께 뒤집는다.
function toHistoryRows(matches: Match[], protagonistIds: Set<string>): HistoryRow[] {
  return matches.map((m) => {
    const onTeam1 = m.team1.some((s) => protagonistIds.has(s.memberId));
    const swap = !onTeam1 && m.team2.some((s) => protagonistIds.has(s.memberId));
    const result: MatchResult = swap
      ? (m.result === "team1" ? "team2" : m.result === "team2" ? "team1" : m.result)
      : m.result;
    return {
      id: m.id, date: m.date,
      team1: swap ? m.team2 : m.team1,
      team2: swap ? m.team1 : m.team2,
      result,
    };
  });
}

// 서버가 내려준 순서를 그대로 유지하며 같은 날짜끼리 연속 묶는다(경기 목록과 같은 규칙).
function groupByDate(rows: HistoryRow[]): DateGroup[] {
  const groups: DateGroup[] = [];
  rows.forEach((row) => {
    const last = groups[groups.length - 1];
    if (last && last.date === row.date) last.items.push(row);
    else groups.push({ date: row.date, items: [row] });
  });
  return groups;
}

// 랭킹 상세 모달의 그래프 아래 경기 이력 — 경기 목록(MatchList)과 달리 카드 머리글(N경기·
// 경기번호·삭제/메모/다운로드)도, 홈팀(주인공)도 없이 "VS 상대 팀구성 + 승/패"만 결과 위주로
// 보여준다(요청: "아예 홈팀을 빼고 vs 팀구성 승패 ... 진짜 결과만"). 렌더 규칙이 목록과
// 충분히 달라져 별도 파일로 분리했다(요청: "경기이력쪽 목록 렌더링은 별도 파일로").
export default function RankMatchHistory({ matches, members, memberOf, loading }: RankMatchHistoryProps) {
  const protagonistIds = new Set(members.map((m) => m.id));
  const groups = groupByDate(toHistoryRows(matches, protagonistIds));

  return (
    <div className="scr-match-list-panel-v2">
      {matches.length === 0 && (
        <div className="scr-empty">{loading ? <Spinner size={18} /> : "표시할 경기가 없어요."}</div>
      )}

      <div className="scr-match-cards">
        {groups.map((g) => (
          <div key={g.date} className="scr-match-date-group">
            <div className="scr-match-date-head scr-match-date-head-compact">{dateWithDow(g.date)}</div>
            {g.items.map((r) => (
              <div key={r.id} className="scr-match-card">
                <MatchTeams
                  team1={r.team1} team2={r.team2} memberOf={memberOf} result={r.result}
                  disableProfileLink stackedOutcome compact opponentOnly
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
