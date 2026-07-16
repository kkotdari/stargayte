import { api } from "../../api/client";
import { isComputerSlot, computerSlotLabel } from "../../constants/computerSlot";
import { isUnregisteredSlot, unregisteredSlotLabel } from "../../constants/unregisteredSlot";
import { currentMonthValue, recentMonthValues, shiftMonthValue } from "../../utils/date";
import type {
  Member, MemberStats, MemberStatsEntry, MemberStatsMonthEntry, Match, MatchResult, MatchSlot, Race, TeamRankEntry,
  TeamRankMonthEntry,
} from "../../types";

// v2 랭킹 — "일대일"과 "팀" 중 하나를 먼저 고르고, 그다음에야 일대일은 종족을, 팀은 인원수
// (2/3/4인)와 유저 검색을 쓸 수 있다 — 세 모드는 집계 대상 자체가 달라(1:1 경기 / 팀 구성)
// 필터를 공유하지 않는다.
//
// 집계 기간은 기본적으로 "이번 달"이다(요청: "개인/팀 랭킹의 집계 기간은 기본적으로 월
// 기준") — 예전엔 기간 개념 자체가 없었지만(클럽 경기 수가 적어 주/월로 자르면 표본이 거의
// 안 남는다는 이유), 지금은 그 대가로 포기했던 순위 변동을 다시 보여줘야 해서 월 단위로
// 되살렸다. 그 대신 "이번 달 표본이 너무 적다"는 문제는 화면에서 안내 문구로만 짚어준다.
export type RankMode = "solo" | "team";
export type TeamSize = 2 | 3 | 4;

// "일대일"은 말 그대로 1:1 경기만 집계한다(팀전에서의 개인 전적은 섞지 않는다). 랭킹 상세
// 모달의 경기 이력을 그 회원의 일대일 경기로만 거를 때도 같은 값을 써서 export한다.
export const SOLO_MATCH_TYPE = "0101";

export interface LatestMatch {
  opponentLabel: string;
  outcome: "win" | "loss" | "draw" | "notHeld";
}

export interface RankRow {
  member: Member;
  stats: MemberStats;
  // 공동순위(완전 동률)면 여러 행이 같은 값을 갖고, 다음 순위는 그만큼 건너뛴다(1,1,3).
  rank: number;
  // 전월 대비 순위 변동 — 양수=순위 상승(숫자가 작아짐), 음수=하락, 0=변동 없음, null=지난달
  // 기록이 없어 비교 불가("신규" — 요청: "목록페이지의 순위 밑에도 랭킹변동 보여주기").
  rankDelta: number | null;
  // 실제로 가장 많이 플레이한 종족 (순위표엔 한 판이라도 뛴 사람만 나오므로 사실상 항상 값이 있다).
  playedRace: Race | null;
  // 종족 필터가 걸려 있을 때만(race !== "all") 채워지는 "전체 종족" 기준 전적.
  overallStats?: MemberStats;
  // 가장 최근 일대일 경기 — 아래 최근 표본(LATEST_MATCH_SAMPLE_SIZE)에서 못 찾으면(그보다
  // 오래전에만 뛴 회원) null. 전적 아래 "vs 상대 승/패" 한 줄로 보여주고, 탭하면 그 회원의
  // 일대일 경기 목록 모달(팀랭킹 모달 재활용)이 뜬다. 랭킹 집계 기간(이번 달)과 무관하게
  // 항상 전체 기간 중 가장 최근 경기다.
  latestMatch: LatestMatch | null;
}

// 전체 회원의 최근 일대일 경기 중 이만큼만 가져와서 "회원별 최근 1경기"를 뽑는다 — 회원별로
// 따로 조회하면 회원 수만큼 요청이 나가므로, 한 번에 넉넉히 받아 클라이언트에서 나눠 담는다.
// 이 표본보다 더 오래전에만 뛴 회원은 최근 경기가 없는 것으로 처리된다(허용 가능한 손실 —
// 랭킹 상세 모달 경기 이력의 100건 캡과 같은 절충). 서버 GET /matches의 limit 상한(le=100)을
// 넘길 수 없다 — 그 이상을 요청하면 422로 거절된다.
const LATEST_MATCH_SAMPLE_SIZE = 100;

function outcomeFor(side: "team1" | "team2", result: MatchResult): LatestMatch["outcome"] {
  if (result === "draw") return "draw";
  if (result === "not_held") return "notHeld";
  return side === result ? "win" : "loss";
}

function slotLabel(memberById: Map<string, Member>, slot: MatchSlot): string {
  if (isComputerSlot(slot.memberId)) return slot.rawName || computerSlotLabel([slot], slot.memberId);
  if (isUnregisteredSlot(slot.memberId)) return slot.rawName || unregisteredSlotLabel([slot], slot.memberId);
  return memberById.get(slot.memberId)?.nickname ?? slot.rawName ?? "알 수 없음";
}

// matches는 최신순으로 정렬돼 있다고 가정 — 회원별로 처음 발견되는(=가장 최근) 경기만 담는다.
function latestMatchByMember(memberById: Map<string, Member>, matches: Match[]): Map<string, LatestMatch> {
  const result = new Map<string, LatestMatch>();
  for (const m of matches) {
    const [s1] = m.team1;
    const [s2] = m.team2;
    if (!s1 || !s2) continue; // 일대일 필터라 항상 각 팀 한 명씩이어야 정상이지만, 방어적으로 스킵.
    for (const [self, opp, side] of [[s1, s2, "team1"], [s2, s1, "team2"]] as const) {
      if (result.has(self.memberId) || !memberById.has(self.memberId)) continue;
      result.set(self.memberId, { opponentLabel: slotLabel(memberById, opp), outcome: outcomeFor(side, m.result) });
    }
  }
  return result;
}

export interface TeamRankRow {
  // 서버가 개인 승점 높은 순으로 정렬해준 순서 그대로 — 화면이 격자를 이 순서로 채운다.
  members: Member[];
  rank: number;
  // RankRow.rankDelta와 같은 뜻.
  rankDelta: number | null;
  entry: TeamRankEntry;
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

function soloSorted(entries: MemberStatsEntry[], memberById: Map<string, Member>) {
  return entries
    .filter((e): e is MemberStatsEntry & { sortOrder: number; tieGroup: number } => (
      e.sortOrder !== null && e.tieGroup !== null && memberById.has(e.memberId)
    ))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

// 전월 랭킹에서 회원별 순위만 뽑아둔다 — 이번 달 목록에 그대로 붙일 rankDelta 계산용.
function soloRankByMember(entries: MemberStatsEntry[], memberById: Map<string, Member>): Map<string, number> {
  const sorted = soloSorted(entries, memberById);
  const ranks = competitionRanks(sorted, (e) => e.tieGroup);
  return new Map(sorted.map((e, i) => [e.memberId, ranks[i]]));
}

// 일대일 랭킹 — 집계(전적/승률/최다종족)뿐 아니라 정렬까지 서버(GET /matches/stats)가 끝내서
// sortOrder로 내려준다. 순서는 승자승(맞대결) → 공통상대(간접비교) → 승점(승-패) 순이고,
// 승률은 정렬 기준이 아니다(화면에 숫자로만 보여준다). 맞대결·공통상대 비교는 "누구와 누구를
// 견주느냐"에 따라 값이 달라지는 쌍 단위 계산이라, 회원별 숫자 하나로 받아서 클라이언트가
// 다시 정렬할 수가 없기 때문이다. 여기서는 순위 숫자만 붙인다.
//
// 순위 대상이 아닌(한 판도 안 뛴, 그래서 sortOrder가 null인) 회원과, 탈퇴 등으로 로컬 회원
// 목록에 이제 없는 회원은 빠진다. month는 "YYYY-MM"(기본 이번 달) — 전월도 함께 받아
// rankDelta를 계산한다(요청: "api로 랭킹 목록 가져올때 배열형태로 파라미터 추가"로 한
// 번에 두 달을 묶어 받는다).
export async function computeRankRows(
  members: Member[], race: Race | "all", month: string = currentMonthValue(),
): Promise<RankRow[]> {
  const memberById = new Map(members.map((m) => [m.id, m]));
  const prevMonth = shiftMonthValue(month, -1);
  const [monthlyResp, overallResp, recentPage] = await Promise.all([
    api.getMatchStatsMonthly({ months: [month, prevMonth], matchType: SOLO_MATCH_TYPE, race }),
    race !== "all"
      ? api.getMatchStatsMonthly({ months: [month], matchType: SOLO_MATCH_TYPE, race: "all" })
      : Promise.resolve(null),
    api.getMatchesPage({ matchType: SOLO_MATCH_TYPE, sort: "latest", limit: LATEST_MATCH_SAMPLE_SIZE }),
  ]);

  const monthOf = (m: string): MemberStatsMonthEntry | undefined => monthlyResp.months.find((x) => x.month === m);
  const currentEntries = monthOf(month)?.members ?? [];
  const prevEntries = monthOf(prevMonth)?.members ?? [];

  const sorted = soloSorted(currentEntries, memberById);
  const ranks = competitionRanks(sorted, (e) => e.tieGroup);
  const prevRankByMember = soloRankByMember(prevEntries, memberById);
  const overallByMember = new Map((overallResp?.months[0]?.members ?? []).map((e) => [e.memberId, e.overall]));
  const latestByMember = latestMatchByMember(memberById, recentPage.items);

  return sorted.map((entry, i) => {
    const prevRank = prevRankByMember.get(entry.memberId);
    return {
      member: memberById.get(entry.memberId)!,
      stats: entry.overall,
      rank: ranks[i],
      rankDelta: prevRank === undefined ? null : prevRank - ranks[i],
      playedRace: entry.mostPlayedRace,
      overallStats: overallByMember.get(entry.memberId),
      latestMatch: latestByMember.get(entry.memberId) ?? null,
    };
  });
}

// 팀 하나를 매달에 걸쳐 같은 팀으로 알아보기 위한 키 — 서버는 개인 승점 순으로
// memberIds를 정렬해서 주는데 그 순서가 달마다 바뀔 수 있어(승점이 달마다 다시 계산되므로),
// 순서와 무관한 정렬된 조합으로 비교한다.
function teamKeyOf(memberIds: string[]): string {
  return [...memberIds].sort().join("|");
}

function teamRowsOfSize(teams: TeamRankEntry[], memberById: Map<string, Member>, teamSize: TeamSize) {
  const rows: { entry: TeamRankEntry; members: Member[] }[] = [];
  teams.forEach((entry) => {
    if (entry.memberIds.length !== teamSize) return;
    const found = entry.memberIds.map((id) => memberById.get(id));
    if (found.every((m): m is Member => m !== undefined)) rows.push({ entry, members: found as Member[] });
  });
  return rows;
}

function teamRankByKey(rows: { entry: TeamRankEntry }[]): Map<string, number> {
  const ranks = competitionRanks(rows, (r) => `${r.entry.points}/${r.entry.wins}/${r.entry.plays}`);
  return new Map(rows.map((r, i) => [teamKeyOf(r.entry.memberIds), ranks[i]]));
}

// 팀 랭킹 — 서버가 승점(승 +1, 무 0, 패 -1) → 승수 → 경기수 순으로 정렬해서 내려준다.
// 구성원 중 한 명이라도 로컬 회원 목록에 없으면(탈퇴 등) 격자를 온전히 그릴 수 없어 그 팀은
// 통째로 뺀다. teamSize(2/3/4인)로 걸러진 팀끼리만 다시 순위를 매긴다(요청: "해당 인원수에
// 맞는 팀만 노출... 랭킹 집계도 별도임") — 인원수 구분 자체는 서버 응답의 memberIds 길이로
// 이미 알 수 있어 서버에 따로 물을 필요가 없다.
export async function computeTeamRankRows(
  members: Member[], month: string = currentMonthValue(), teamSize: TeamSize = 4,
): Promise<TeamRankRow[]> {
  const memberById = new Map(members.map((m) => [m.id, m]));
  const prevMonth = shiftMonthValue(month, -1);
  const { months } = await api.getTeamRankingMonthly([month, prevMonth]);
  const monthOf = (m: string): TeamRankMonthEntry | undefined => months.find((x) => x.month === m);

  const currentRows = teamRowsOfSize(monthOf(month)?.teams ?? [], memberById, teamSize);
  const prevRows = teamRowsOfSize(monthOf(prevMonth)?.teams ?? [], memberById, teamSize);
  const ranks = competitionRanks(currentRows, (r) => `${r.entry.points}/${r.entry.wins}/${r.entry.plays}`);
  const prevRankByKey = teamRankByKey(prevRows);

  return currentRows.map((r, i) => {
    const prevRank = prevRankByKey.get(teamKeyOf(r.entry.memberIds));
    return {
      members: r.members,
      rank: ranks[i],
      rankDelta: prevRank === undefined ? null : prevRank - ranks[i],
      entry: r.entry,
    };
  });
}

export interface RankTrendPoint {
  month: string;
  rank: number | null;
}

const TREND_MONTHS = 5;

// 개인 랭킹 카드를 눌렀을 때 뜨는 최근 5개월 순위변동(요청: "랭킹 카드 클릭시 최근 5개월
// 순위변동 모달창 노출") — 지금 걸려 있는 종족 필터를 그대로 유지해, 목록에서 보던 순위와
// 같은 기준으로 과거를 돌아본다.
export async function computeSoloRankTrend(
  members: Member[], memberId: string, race: Race | "all", uptoMonth: string = currentMonthValue(),
): Promise<RankTrendPoint[]> {
  const memberById = new Map(members.map((m) => [m.id, m]));
  const monthList = recentMonthValues(TREND_MONTHS, uptoMonth);
  const { months } = await api.getMatchStatsMonthly({ months: monthList, matchType: SOLO_MATCH_TYPE, race });
  return monthList.map((month) => {
    const entries = months.find((m) => m.month === month)?.members ?? [];
    const rankByMember = soloRankByMember(entries, memberById);
    return { month, rank: rankByMember.get(memberId) ?? null };
  });
}

// 팀 랭킹 카드를 눌렀을 때 뜨는 최근 5개월 순위변동 — 지금 걸려 있는 인원수(teamSize)
// 필터를 유지한다(같은 팀이라도 인원수 그룹이 달라지면 비교 자체가 성립하지 않는다).
export async function computeTeamRankTrend(
  members: Member[], memberIds: string[], teamSize: TeamSize, uptoMonth: string = currentMonthValue(),
): Promise<RankTrendPoint[]> {
  const memberById = new Map(members.map((m) => [m.id, m]));
  const monthList = recentMonthValues(TREND_MONTHS, uptoMonth);
  const { months } = await api.getTeamRankingMonthly(monthList);
  const key = teamKeyOf(memberIds);
  return monthList.map((month) => {
    const rows = teamRowsOfSize(months.find((m) => m.month === month)?.teams ?? [], memberById, teamSize);
    const rankByKey = teamRankByKey(rows);
    return { month, rank: rankByKey.get(key) ?? null };
  });
}
