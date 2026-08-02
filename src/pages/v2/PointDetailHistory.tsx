import GameResultTeams, { pointToneClass } from "../../components/common/GameResultTeams";
import { Spinner } from "../../components/common/Feedback";
import { cx } from "../../utils/format";
import { formatWhen } from "../../utils/date";
import { isComputerSlot } from "../../constants/computerSlot";
import { isUnregisteredSlot } from "../../constants/unregisteredSlot";
import type { GameResult, GameOutcome, GameResultSlot, Member } from "../../types";

interface PointDetailHistoryProps {
  // 서버에서 받은 이 회원(팀)의 경기들(teamMemberIds로 이미 걸러져 옴).
  gameResults: GameResult[];
  // 이 상세의 주인공 — 개인이면 한 명, 팀이면 그 구성원 전체. 이들이 어느 편이었는지로
  // "상대"와 "내 승패"를 가른다.
  members: Member[];
  memberOf: (id: string) => Member | undefined;
  loading: boolean;
  // 경기당 보수레이팅(μ−3σ, 카드에 보이는 그 점수) 변화 — matchNo로 조회한다. 레이팅은
  // 시간순 누적이라 클라이언트가 재구성할 수 없어 서버(rating-history)가 계산해 준다. 신규
  // 회원의 초기 보수레이팅이 0이라 이 Δ들의 합이 카드 점수와 정확히 일치한다.
  deltaByMatchNo: Map<string, number>;
  // 팀전 이력이면 "우리팀 대 상대팀"을 함께 보여준다(요청) — 개인전이면 "VS 상대 + 승패"만.
  bothTeams?: boolean;
}

// 경기당 레이팅 변화 병기용 — 양수엔 +를 붙이고(음수는 자연히 -), 0도 그대로.
function deltaLabel(d: number | undefined): string | undefined {
  if (d === undefined) return undefined;
  // 서버가 ×10 스케일로 내려주므로 카드 점수와 똑같이 자연수로 반올림해 보여준다(요청).
  const n = Math.round(d);
  return `${n > 0 ? "+" : ""}${n}점`;
}

// 컴퓨터·비회원이 한 명이라도 낀 경기 — 상대 실력치가 없어 레이팅에 아예 반영되지 않는다
// (통계 화면 "최소 게임수" 안내와 같은 규칙). Δ가 없는 이유가 이거다 싶으면 점수 대신
// "레이팅 제외"라고 밝힌다(요청) — 그냥 숫자를 안 보여주면 "아직 안 됐나?" 헷갈린다.
function isExcludedFromRating(row: { team1: GameResultSlot[]; team2: GameResultSlot[] }): boolean {
  return [...row.team1, ...row.team2].some((s) => isComputerSlot(s.memberId) || isUnregisteredSlot(s.memberId));
}

interface HistoryRow {
  id: number;
  matchNo: string;
  date: string;
  // 주인공 편(홈)/상대 편으로 정규화한 결과 — team1=주인공, team2=상대, result는 team1 기준.
  team1: GameResultSlot[];
  team2: GameResultSlot[];
  result: GameOutcome;
}

interface DateGroup {
  date: string;
  items: HistoryRow[];
}

// 주인공(members)이 어느 편이었든 team1(홈)=주인공, team2=상대가 되도록 정규화한다 —
// 랭킹 상세 이력은 "VS 상대 + 승/패"만 보여주므로(홈팀은 아예 뺀다) 상대가 어느 편인지와
// 주인공 기준 승패가 필요하다. 주인공이 team2였던 경기는 팀과 result를 함께 뒤집는다.
function toHistoryRows(gameResults: GameResult[], protagonistIds: Set<string>): HistoryRow[] {
  return gameResults.map((m) => {
    const onTeam1 = m.team1.some((s) => protagonistIds.has(s.memberId));
    const swap = !onTeam1 && m.team2.some((s) => protagonistIds.has(s.memberId));
    const result: GameOutcome = swap
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

// 랭킹 상세 모달의 그래프 아래 경기 이력 — 경기 목록(GameResultCardBody)과 달리 카드 머리글(N경기·
// 경기번호·삭제/메모/다운로드)도, 홈팀(주인공)도 없이 "VS 상대 팀구성 + 승/패 + 경기당
// 레이팅 변화(Δ)"만 결과 위주로 보여준다(요청: "아예 홈팀을 빼고 vs 팀구성 승패 ... 진짜
// 결과만"). Δ는 서버가 시간순 재생으로 계산한 이 회원의 그 경기 μ 증감이다.
export default function PointDetailHistory({
  gameResults, members, memberOf, loading, deltaByMatchNo, bothTeams = false,
}: PointDetailHistoryProps) {
  const protagonistIds = new Set(members.map((m) => m.id));
  const groups = groupByDate(toHistoryRows(gameResults, protagonistIds));

  return (
    <div className="scr-game-result-list-panel-v2">
      {gameResults.length === 0 && (
        <div className="scr-empty">{loading ? <Spinner size={18} /> : "표시할 경기가 없어요."}</div>
      )}

      <div className="scr-game-result-cards">
        {groups.map((g) => (
          <div key={g.date} className="scr-game-result-date-group">
            {/* 날짜 표기는 앱 공통 규칙(요청: 모두 통일) — 최근이면 "오늘"·"목요일", 그 밖은
                "7월 28일 (화)". */}
            <div className="scr-game-result-date-head scr-game-result-date-head-compact">{formatWhen(g.date)}</div>
            {g.items.map((r) => {
              const dLabel = deltaLabel(deltaByMatchNo.get(r.matchNo));
              // Δ가 안 왔는데 컴퓨터·비회원이 껴 있으면 "레이팅 제외"로 이유를 밝힌다 —
              // 그 밖의 이유(아직 집계 전 등)로 없는 경우는 예전처럼 아무것도 안 보여준다.
              const excluded = !dLabel && isExcludedFromRating(r);
              // 팀전: 우리팀 대 상대팀을 그대로 보여주고, 이 회원의 경기당 Δ를 카드 아래 로우에.
              // 개인전: "VS 상대 + 승패 + Δ"만.
              return bothTeams ? (
                <div key={r.id} className="scr-game-result-card scr-rank-history-team-card">
                  <GameResultTeams
                    team1={r.team1} team2={r.team2} memberOf={memberOf} result={r.result}
                    disableProfileLink compact bothTeamsTail textRoster
                  />
                  {(dLabel || excluded) && (
                    <div className="scr-rank-history-points-line">
                      <span className="scr-rank-history-calc">
                        레이팅 {dLabel
                          ? <strong className={cx(pointToneClass(dLabel))}>{dLabel}</strong>
                          : <strong className="scr-rank-history-excluded">제외</strong>}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div key={r.id} className="scr-game-result-card">
                  <GameResultTeams
                    team1={r.team1} team2={r.team2} memberOf={memberOf} result={r.result}
                    disableProfileLink stackedOutcome compact opponentOnly textRoster
                    outcomeNote={dLabel ?? (excluded ? "레이팅 제외" : undefined)}
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
