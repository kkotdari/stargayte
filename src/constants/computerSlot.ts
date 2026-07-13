// 실제 회원이 아니라 "컴퓨터"(AI) 참가자를 나타내는 memberId. 가끔 컴퓨터를 끼고 하는
// 경기가 있어(팀전 인원을 채우는 등) 실제 회원 없이도 슬롯을 채울 수 있게 한다.
// 슬롯마다 고유해야 여러 명을 구분/제거할 수 있어 매번 새로 생성한다 — 백엔드에도 그대로
// 전달되지만 DB에는 저장되지 않고(memberId=None), 다시 조회할 때 team 내 순서로 재생성된다.
export const COMPUTER_ID_PREFIX = "__computer__";

export function isComputerSlot(memberId: string): boolean {
  return memberId.startsWith(COMPUTER_ID_PREFIX);
}

export function newComputerSlotId(): string {
  return `${COMPUTER_ID_PREFIX}${crypto.randomUUID()}`;
}

// 같은 팀 안에서 컴퓨터 슬롯들에 "컴퓨터 1", "컴퓨터 2"처럼 순번을 매긴다(등장 순서 기준).
export function computerSlotLabel(rows: { memberId: string }[], memberId: string): string {
  const computerIds = rows.map((r) => r.memberId).filter(isComputerSlot);
  const index = computerIds.indexOf(memberId);
  return `컴퓨터${computerIds.length > 1 ? ` ${index + 1}` : ""}`;
}
