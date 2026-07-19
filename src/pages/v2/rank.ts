import { api } from "../../api/client";
import {
  currentPeriodAnchor, periodAnchorToRange, periodAxisLabel, recentPeriodAnchors, shiftPeriodAnchor,
  type PeriodUnit,
} from "../../utils/date";
import type { Member, MemberStats, MemberStatsEntry, MatchType, Race } from "../../types";

// v2 랭킹 — "개인전 / 팀전" 중 하나를 먼저 고른다. 둘 다 목록 모양(개인 카드)과 순위 산정
// 방식이 똑같다 — 팀전은 상대팀 전원을 각각 한 번씩 이긴/진 것으로 풀어(서버 head_to_head가
// 이미 상대별로 전개해준다) 개인 랭킹과 동일하게 점수를 매기기 때문이다(요청: "팀전도 개인
// 환산해서 개인 랭킹처럼, 목록 모양까지"). 그래서 팀전 filter는 모든 팀 인원수(2·3·4인)를
// 한 데 묶는다 — 인원수 구분 없이 그 사람이 팀경기에서 낸 성적 전체가 대상이다.
//
// 집계 기간은 월 또는 연 하나다(요청: "기간 년/월, 화살표 하나로 그 단위만큼 이동") — 그
// 기간만으로 순위를 새로 매기고, 직전 기간과 비교해 순위 변동(화살표)을 보여주며, 카드를
// 누르면 최근 5개 기간 추이 모달이 뜬다.
export type RankMode = "solo" | "team";

// 개인전은 1:1(0101)만, 팀전은 팀경기(0102)만 집계한다.
export const MATCH_TYPE_OF: Record<RankMode, MatchType> = { solo: "0101", team: "0102" };

export interface RankRow {
  member: Member;
  stats: MemberStats;
  // 랭킹 총점(경기마다 가중 합산) — 카드에 큼직하게 보여준다. 음수 가능.
  rankScore: number;
  // 우세/동등/열세 인원 — 상대의 강함(1+우세수)·약함(1+열세수)을 매기는 근거이자, 랭킹
  // 상세에서 경기당 획득 점수를 재구성하는 데 쓴다.
  superiorCount: number;
  equalCount: number;
  inferiorCount: number;
  // 공동순위(완전 동률)면 여러 행이 같은 값을 갖고, 다음 순위는 그만큼 건너뛴다(1,1,3).
  rank: number;
  // 직전 기간 대비 순위 변동 — 양수=상승(숫자가 작아짐), 음수=하락, 0=변동 없음, null=직전
  // 기간 기록이 없어 비교 불가("신규").
  rankDelta: number | null;
  // 실제로 가장 많이 플레이한 종족.
  playedRace: Race | null;
  // 종족 필터가 걸려 있을 때만(race !== "all") 채워지는 "전체 종족" 기준 전적.
  overallStats?: MemberStats;
}

// 완전 동률이면 같은 순위를 주고, 다음 순위는 동률 인원만큼 건너뛴다(1,1,3 — 표준 경쟁 순위).
function competitionRanks<T>(sorted: T[], groupOf: (item: T) => number | string): number[] {
  const ranks: number[] = [];
  let rank = 0;
  sorted.forEach((x, i) => {
    if (i === 0 || groupOf(x) !== groupOf(sorted[i - 1])) rank = i + 1;
    ranks.push(rank);
  });
  return ranks;
}

function rankSorted(entries: MemberStatsEntry[], memberById: Map<string, Member>) {
  return entries
    .filter((e): e is MemberStatsEntry & { sortOrder: number; tieGroup: number } => (
      e.sortOrder !== null && e.tieGroup !== null && memberById.has(e.memberId)
    ))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

// 한 기간의 랭킹에서 회원별 순위만 뽑아둔다 — 직전 기간 대비 rankDelta / 추이 그래프 계산용.
// 그 기간에 한 판이라도 뛴 사람(plays>0)만 '순위'로 친다 — 0경기 회원은 순위 변동 비교
// 대상이 아니다. 경기가 하나도 없던 달은 서버가 전원 0경기·공동 꼴찌(사실상 공동 1위)로
// 내려주는데, 그걸 그대로 순위로 쓰면 이번 달 뛴 사람이 전부 그 "전원 1위" 대비 변동으로
// 떠 버렸다(실제로 지적받은 문제) — 안 뛴 기간엔 순위가 없던 것으로 봐서, 이번에 새로 뛰면
// prevRank가 없어(undefined) rankDelta가 null → "신규"로 뜬다.
function rankByMember(entries: MemberStatsEntry[], memberById: Map<string, Member>): Map<string, number> {
  const sorted = rankSorted(entries, memberById);
  const ranks = competitionRanks(sorted, (e) => e.tieGroup);
  const map = new Map<string, number>();
  sorted.forEach((e, i) => {
    if (e.overall.plays > 0) map.set(e.memberId, ranks[i]);
  });
  return map;
}

// 랭킹 목록 — 집계·정렬을 전부 서버(GET /matches/stats)가 끝내서 sortOrder로 내려준다. 순서는
// '경기마다 가중 합산한 점수'(이김 +2·상대강함 / 비김 +1·상대강함 / 짐 -1·상대약함, 참가자
// 우선)로 가른다. 맞대결 강함/약함은 "누구와 누구를 견주느냐"에 따라 값이 달라지는 쌍 단위
// 계산이라 회원별 숫자 하나로 받아 다시 정렬할 수 없어, 서버 순서를 그대로 쓰고 순위 숫자만
// 붙인다. 개인전이든 팀전이든(matchType만 다름) 완전히 같은 경로다.
//
// unit/anchor는 집계 기간(월 "YYYY-MM" / 연 "YYYY") — 직전 기간도 함께 받아 rankDelta를
// 계산한다. 한 판도 안 뛴 회원(sortOrder null)과 탈퇴 등으로 로컬 목록에 없는 회원은 빠진다.
export async function computeRankRows(
  members: Member[], matchType: MatchType, race: Race | "all", unit: PeriodUnit, anchor: string,
): Promise<RankRow[]> {
  // 집계는 활성 상태인 유저만 대상으로 한다(요청) — 정지/탈퇴/승인대기 회원은 랭킹에서
  // 뺀다. memberById에 없는 회원의 통계 항목은 rankSorted가 자동으로 걸러낸다.
  const memberById = new Map(members.filter((m) => m.status === "active").map((m) => [m.id, m]));
  const period = periodAnchorToRange(unit, anchor);
  const prevPeriod = periodAnchorToRange(unit, shiftPeriodAnchor(unit, anchor, -1));
  const [curResp, prevResp, overallResp] = await Promise.all([
    api.getMatchStats({ dateFrom: period.from, dateTo: period.to, matchType, race }),
    api.getMatchStats({ dateFrom: prevPeriod.from, dateTo: prevPeriod.to, matchType, race }),
    race !== "all"
      ? api.getMatchStats({ dateFrom: period.from, dateTo: period.to, matchType, race: "all" })
      : Promise.resolve(null),
  ]);

  const sorted = rankSorted(curResp.members, memberById);
  const ranks = competitionRanks(sorted, (e) => e.tieGroup);
  const prevRankByMember = rankByMember(prevResp.members, memberById);
  const overallByMember = new Map((overallResp?.members ?? []).map((e) => [e.memberId, e.overall]));

  return sorted.map((entry, i) => {
    const prevRank = prevRankByMember.get(entry.memberId);
    return {
      member: memberById.get(entry.memberId)!,
      stats: entry.overall,
      rankScore: entry.rankScore ?? 0,
      superiorCount: entry.superiorCount ?? 0,
      equalCount: entry.equalCount ?? 0,
      inferiorCount: entry.inferiorCount ?? 0,
      rank: ranks[i],
      rankDelta: prevRank === undefined ? null : prevRank - ranks[i],
      playedRace: entry.mostPlayedRace,
      overallStats: overallByMember.get(entry.memberId),
    };
  });
}

export interface RankTrendPoint {
  // 그래프 x축에 그대로 찍을 라벨(월="7월", 연="26").
  label: string;
  rank: number | null;
}

const TREND_PERIODS = 5;

// 랭킹 카드를 눌렀을 때 뜨는 최근 5개 기간 순위변동 — 지금 걸려 있는 종족 필터를 그대로
// 유지해, 목록에서 보던 순위와 같은 기준으로 과거를 돌아본다. 월 단위면 최근 5개월, 연
// 단위면 최근 5년을 각각 독립 집계해 순위를 뽑는다.
export async function computeRankTrend(
  members: Member[], matchType: MatchType, memberId: string, race: Race | "all",
  unit: PeriodUnit, uptoAnchor: string = currentPeriodAnchor(unit),
): Promise<RankTrendPoint[]> {
  // 목록과 같은 기준(활성 유저만)으로 과거 순위를 다시 매긴다.
  const memberById = new Map(members.filter((m) => m.status === "active").map((m) => [m.id, m]));
  const anchors = recentPeriodAnchors(unit, TREND_PERIODS, uptoAnchor);
  const resps = await Promise.all(anchors.map((a) => {
    const { from, to } = periodAnchorToRange(unit, a);
    return api.getMatchStats({ dateFrom: from, dateTo: to, matchType, race });
  }));
  return anchors.map((a, i) => ({
    label: periodAxisLabel(unit, a),
    rank: rankByMember(resps[i].members, memberById).get(memberId) ?? null,
  }));
}
