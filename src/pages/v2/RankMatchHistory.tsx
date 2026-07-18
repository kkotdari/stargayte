import MatchTeams from "../../components/common/MatchTeams";
import { Spinner } from "../../components/common/Feedback";
import { dateWithDow } from "../../utils/date";
import { isComputerSlot } from "../../constants/computerSlot";
import { isUnregisteredSlot } from "../../constants/unregisteredSlot";
import type { Match, MatchResult, MatchSlot, Member } from "../../types";

interface RankMatchHistoryProps {
  // 서버에서 받은 이 회원(팀)의 경기들(teamMemberIds로 이미 걸러져 옴).
  matches: Match[];
  // 이 상세의 주인공 — 개인이면 한 명, 팀이면 그 구성원 전체. 이들이 어느 편이었는지로
  // "상대"와 "내 승패"를 가른다.
  members: Member[];
  memberOf: (id: string) => Member | undefined;
  loading: boolean;
  // 상대의 강함(1+우세수)·약함(1+열세수) 맵 — 경기당 획득 점수를 서버 산식과 똑같이
  // 재구성한다(이김 +2·강함, 비김 +1·강함, 짐 -1·약함, 상대팀 전원 각각 합산).
  strengthByMember: Map<string, number>;
  weaknessByMember: Map<string, number>;
  // 팀전 이력이면 상대만이 아니라 "우리팀 대 상대팀"을 함께 보여준다(요청) — 개인전이면
  // 홈팀 없이 "VS 상대 + 승패"만.
  bothTeams?: boolean;
}

// 이 경기 하나에서 주인공(team1)이 얻은 점수 — 서버의 총점 산식을 경기 단위로 쪼갠 것과
// 같다. 상대팀(team2)의 회원 각각에 대해 이기면 +2·강함, 비기면 +1·강함, 지면 -1·약함을
// 더한다(컴퓨터/비회원은 순위 대상이 아니라 점수에 안 잡힌다 — 서버 head_to_head와 동일).
// 미실시는 점수 자체가 없다(null → 병기 안 함).
function gamePoints(
  row: HistoryRow, strengthByMember: Map<string, number>, weaknessByMember: Map<string, number>,
): number | null {
  if (row.result === "not_held") return null;
  let pts = 0;
  for (const s of row.team2) {
    if (isComputerSlot(s.memberId) || isUnregisteredSlot(s.memberId)) continue;
    if (row.result === "team1") pts += 2 * (strengthByMember.get(s.memberId) ?? 0);
    else if (row.result === "draw") pts += 1 * (strengthByMember.get(s.memberId) ?? 0);
    else if (row.result === "team2") pts += -1 * (weaknessByMember.get(s.memberId) ?? 0);
  }
  return pts;
}

// 병기용 라벨 — 양수엔 +를 붙이고(음수는 자연히 -), 0도 그대로 보여준다.
function pointsLabel(pts: number | null): string | undefined {
  if (pts === null) return undefined;
  return `${pts > 0 ? "+" : ""}${pts}점`;
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
export default function RankMatchHistory({
  matches, members, memberOf, loading, strengthByMember, weaknessByMember, bothTeams = false,
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
              const pts = pointsLabel(gamePoints(r, strengthByMember, weaknessByMember));
              // 팀전: 우리팀 대 상대팀을 그대로 보여주고(홈팀을 빼지 않는다), 그 경기에서 얻은
              // 점수는 카드 아래 오른쪽에 병기한다. 개인전: 예전처럼 "VS 상대 + 승패"만.
              return bothTeams ? (
                <div key={r.id} className="scr-match-card scr-rank-history-team-card">
                  <MatchTeams
                    team1={r.team1} team2={r.team2} memberOf={memberOf} result={r.result}
                    disableProfileLink stackedOutcome compact
                  />
                  {pts && <div className="scr-rank-history-points-line">{pts}</div>}
                </div>
              ) : (
                <div key={r.id} className="scr-match-card">
                  <MatchTeams
                    team1={r.team1} team2={r.team2} memberOf={memberOf} result={r.result}
                    disableProfileLink stackedOutcome compact opponentOnly
                    outcomeNote={pts}
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
