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
  // 경기당 레이팅 변화(Δμ) — matchNo로 조회한다. 레이팅은 시간순 누적이라 클라이언트가
  // 재구성할 수 없어 서버(rating-history)가 이 회원의 경기별 μ 증감을 계산해 준다.
  deltaByMatchNo: Map<string, number>;
  // 팀전 이력이면 "우리팀 대 상대팀"을 함께 보여준다(요청) — 개인전이면 "VS 상대 + 승패"만.
  bothTeams?: boolean;
}

// 경기당 레이팅 변화 병기용 — 양수엔 +를 붙이고(음수는 자연히 -), 0도 그대로. 없으면(미실시/
// 상대 미회원 등으로 레이팅 미반영) 병기하지 않는다.
function deltaLabel(d: number | undefined): string | undefined {
  if (d === undefined) return undefined;
  return `${d > 0 ? "+" : ""}${d}점`;
}

interface HistoryRow {
  id: number;
  matchNo: string;
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
      id: m.id, matchNo: m.matchNo, date: m.date,
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
// 경기번호·삭제/메모/다운로드)도, 홈팀(주인공)도 없이 "VS 상대 팀구성 + 승/패 + 경기당
// 레이팅 변화(Δ)"만 결과 위주로 보여준다(요청: "아예 홈팀을 빼고 vs 팀구성 승패 ... 진짜
// 결과만"). Δ는 서버가 시간순 재생으로 계산한 이 회원의 그 경기 μ 증감이다.
export default function RankMatchHistory({
  matches, members, memberOf, loading, deltaByMatchNo, bothTeams = false,
}: RankMatchHistoryProps) {
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
            {g.items.map((r) => {
              const dLabel = deltaLabel(deltaByMatchNo.get(r.matchNo));
              // 팀전: 우리팀 대 상대팀을 그대로 보여주고, 이 회원의 경기당 Δ를 카드 아래 로우에.
              // 개인전: "VS 상대 + 승패 + Δ"만.
              return bothTeams ? (
                <div key={r.id} className="scr-match-card scr-rank-history-team-card">
                  <MatchTeams
                    team1={r.team1} team2={r.team2} memberOf={memberOf} result={r.result}
                    disableProfileLink compact bothTeamsTail textRoster
                  />
                  {dLabel && (
                    <div className="scr-rank-history-points-line">
                      <span className="scr-rank-history-calc">
                        레이팅 <strong>{dLabel}</strong>
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div key={r.id} className="scr-match-card">
                  <MatchTeams
                    team1={r.team1} team2={r.team2} memberOf={memberOf} result={r.result}
                    disableProfileLink stackedOutcome compact opponentOnly textRoster
                    outcomeNote={dLabel}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
