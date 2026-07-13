// 검색 필터의 "유저" 검색창 공용 매칭 로직 — 닉네임/배틀태그뿐 아니라 리플레이 인게임
// 아이디들(replayAliases)로도 찾을 수 있게 한다. 대소문자는 구분하지 않는다.
// 띄어쓰기로 여러 명을 한 번에 검색할 수 있고(OR 매칭), 연속된 공백/앞뒤 공백은 자동으로
// 정리된다 (예: "철수  영희 민수" -> ["철수","영희","민수"]).
import type { Member } from "../types";

// 공백으로 구분된 검색어를 항목별로 다듬는다(소문자 변환, 빈 항목 제외). 경기결과 화면의
// "모두 있는 경기만" 체크박스처럼 항목 하나하나를 따로 다뤄야 할 때 재사용.
export function splitSearchTerms(query: string): string[] {
  return query.trim().split(/\s+/).map((t) => t.toLowerCase()).filter(Boolean);
}

export function memberMatchesTerm(member: Member, term: string): boolean {
  return (
    member.nickname.toLowerCase().includes(term)
    || member.battletag.toLowerCase().includes(term)
    || member.replayAliases.some((a) => a.toLowerCase().includes(term))
  );
}

export function memberMatchesQuery(member: Member, query: string): boolean {
  const terms = splitSearchTerms(query);
  if (terms.length === 0) return true;
  return terms.some((t) => memberMatchesTerm(member, t));
}

// v2 목록(경기결과/전적통계/랭킹)의 유저 검색 자동완성 후보 — 페이지 진입 시 이미 로드된
// 회원 목록에서 한 번만 계산해 쓴다(타이핑마다 서버에 새로 묻지 않음). 탈퇴/정지 회원은
// 검색해도 어차피 목록에 안 나오니 후보에서도 뺀다. 배틀태그는 검색 자체(memberMatchesTerm)는
// 여전히 매칭하지만 실제로 그걸로 찾는 일이 거의 없어 추천 후보에는 안 올린다 — 닉네임/
// 게임아이디(리플레이 별칭)만 추천한다.
export function activeMemberSearchTerms(members: Member[]): string[] {
  return members
    .filter((m) => m.status !== "withdrawn" && m.status !== "suspended")
    .flatMap((m) => [m.nickname, ...m.replayAliases]);
}
