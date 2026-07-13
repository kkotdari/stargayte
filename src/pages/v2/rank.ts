import { api } from "../../api/client";
import { isComputerSlot, computerSlotLabel } from "../../constants/computerSlot";
import { isUnregisteredSlot, unregisteredSlotLabel } from "../../constants/unregisteredSlot";
import type {
  Member, MemberStats, MemberStatsEntry, MatchStatsResponse, Match, MatchResult, MatchSlot, Race, TeamRankEntry,
} from "../../types";

// v2 랭킹 전용 — v1(src/pages/ranking/rank.ts)은 주간/월간 기간과 순위 변동을 그대로 쓰는
// 예전 화면이라 손대지 않는다. v2는 기간 개념을 아예 버리고(클럽 경기 수가 적어 주/월로
// 자르면 표본이 거의 안 남는다) 전체 경기를 대상으로 집계하며, 그래서 비교할 "직전 기간"이
// 없어 순위 변동도 보여주지 않는다.
//
// 화면은 "일대일"과 "팀" 중 하나를 먼저 고르고, 그다음에야 일대일은 종족을, 팀은 유저
// 검색을 쓸 수 있다 — 두 모드는 집계 대상 자체가 달라(1:1 경기 / 팀 구성) 필터를 공유하지 않는다.
export type RankMode = "solo" | "team";

// "일대일"은 말 그대로 1:1 경기만 집계한다(팀전에서의 개인 전적은 섞지 않는다). 최근 경기
// 모달(TeamMatchesModal 재활용)을 열 때도 같은 값으로 걸러야 해서 export한다.
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
  // 실제로 가장 많이 플레이한 종족 (순위표엔 한 판이라도 뛴 사람만 나오므로 사실상 항상 값이 있다).
  playedRace: Race | null;
  // 종족 필터가 걸려 있을 때만(race !== "all") 채워지는 "전체 종족" 기준 전적.
  overallStats?: MemberStats;
  // 가장 최근 일대일 경기 — 아래 최근 표본(LATEST_MATCH_SAMPLE_SIZE)에서 못 찾으면(그보다
  // 오래전에만 뛴 회원) null. 전적 아래 "vs 상대 승/패" 한 줄로 보여주고, 탭하면 그 회원의
  // 일대일 경기 목록 모달(팀랭킹 모달 재활용)이 뜬다.
  latestMatch: LatestMatch | null;
}

// 전체 회원의 최근 일대일 경기 중 이만큼만 가져와서 "회원별 최근 1경기"를 뽑는다 — 회원별로
// 따로 조회하면 회원 수만큼 요청이 나가므로, 한 번에 넉넉히 받아 클라이언트에서 나눠 담는다.
// 이 표본보다 더 오래전에만 뛴 회원은 최근 경기가 없는 것으로 처리된다(허용 가능한 손실 —
// TeamMatchesModal의 100건 캡과 같은 절충). 서버 GET /matches의 limit 상한(le=100)을
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

// 일대일 랭킹 — 집계(전적/승률/최다종족)뿐 아니라 정렬까지 서버(GET /matches/stats)가 끝내서
// sortOrder로 내려준다. 순서는 승자승(맞대결) → 공통상대(간접비교) → 전체 승수 순이고, 승점(승-패)과
// 승률은 정렬 기준이 아니다(화면에 숫자로만 보여준다). 맞대결·공통상대 비교는 "누구와 누구를
// 견주느냐"에 따라 값이 달라지는 쌍 단위 계산이라, 회원별 숫자 하나로 받아서 클라이언트가
// 다시 정렬할 수가 없기 때문이다. 여기서는 순위 숫자만 붙인다.
//
// 순위 대상이 아닌(한 판도 안 뛴, 그래서 sortOrder가 null인) 회원과, 탈퇴 등으로 로컬 회원
// 목록에 이제 없는 회원은 빠진다.
export async function computeRankRows(members: Member[], race: Race | "all"): Promise<RankRow[]> {
  const memberById = new Map(members.map((m) => [m.id, m]));
  const [resp, overallResp, recentPage] = await Promise.all([
    api.getMatchStats({ matchType: SOLO_MATCH_TYPE, race }),
    race !== "all"
      ? api.getMatchStats({ matchType: SOLO_MATCH_TYPE, race: "all" })
      : Promise.resolve(null as MatchStatsResponse | null),
    api.getMatchesPage({ matchType: SOLO_MATCH_TYPE, sort: "latest", limit: LATEST_MATCH_SAMPLE_SIZE }),
  ]);

  const sorted = resp.members
    .filter((e): e is MemberStatsEntry & { sortOrder: number; tieGroup: number } => (
      e.sortOrder !== null && e.tieGroup !== null && memberById.has(e.memberId)
    ))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const ranks = competitionRanks(sorted, (e) => e.tieGroup);
  const overallByMember = new Map((overallResp?.members ?? []).map((e) => [e.memberId, e.overall]));
  const latestByMember = latestMatchByMember(memberById, recentPage.items);

  return sorted.map((entry, i) => ({
    member: memberById.get(entry.memberId)!,
    stats: entry.overall,
    rank: ranks[i],
    playedRace: entry.mostPlayedRace,
    overallStats: overallByMember.get(entry.memberId),
    latestMatch: latestByMember.get(entry.memberId) ?? null,
  }));
}

// 팀 랭킹 — 서버가 승점(승 +1, 무 0, 패 -1) → 승수 → 경기수 순으로 정렬해서 내려준다.
// 구성원 중 한 명이라도 로컬 회원 목록에 없으면(탈퇴 등) 격자를 온전히 그릴 수 없어 그 팀은
// 통째로 뺀다.
export async function computeTeamRankRows(members: Member[]): Promise<TeamRankRow[]> {
  const memberById = new Map(members.map((m) => [m.id, m]));
  const { teams } = await api.getTeamRanking();

  const rows: { entry: TeamRankEntry; members: Member[] }[] = [];
  teams.forEach((entry) => {
    const found = entry.memberIds.map((id) => memberById.get(id));
    if (found.every((m): m is Member => m !== undefined)) rows.push({ entry, members: found as Member[] });
  });

  // 승점·승수·경기수가 전부 같으면 완전 동률로 보고 같은 순위를 준다 — 팀은 승자승을 보지
  // 않아(개인전과 달리) 서버도 여기까지만 가르고 남긴다.
  const ranks = competitionRanks(rows, (r) => `${r.entry.points}/${r.entry.wins}/${r.entry.plays}`);
  return rows.map((r, i) => ({ members: r.members, rank: ranks[i], entry: r.entry }));
}
