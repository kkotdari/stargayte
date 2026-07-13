// 실제 회원은 아니지만(아직 클럽에 가입하지 않은) 실제 사람 참가자를 나타내는 memberId.
// 경기등록/리플레이등록 중에 가입 전인 사람을 끼워야 할 때, 회원을 억지로 만들지 않고
// 이 임시 슬롯으로 채운다 — 컴퓨터(AI) 슬롯과 저장 방식은 동일(회원 없음, team 내 순서로
// 구분)하고, 나중에 그 사람이 가입하면 게임아이디 등으로 수동 연결하면 된다.
// 슬롯마다 고유해야 여러 명을 구분/제거할 수 있어 매번 새로 생성한다 — 백엔드에도 그대로
// 전달되지만 DB에는 저장되지 않고(memberId=None), 다시 조회할 때 team 내 순서로 재생성된다.
export const UNREGISTERED_ID_PREFIX = "__unregistered__";

export function isUnregisteredSlot(memberId: string): boolean {
  return memberId.startsWith(UNREGISTERED_ID_PREFIX);
}

export function newUnregisteredSlotId(): string {
  return `${UNREGISTERED_ID_PREFIX}${crypto.randomUUID()}`;
}

// 같은 팀 안에서 비회원 슬롯들에 "비회원 1", "비회원 2"처럼 순번을 매긴다(등장 순서 기준).
export function unregisteredSlotLabel(rows: { memberId: string }[], memberId: string): string {
  const ids = rows.map((r) => r.memberId).filter(isUnregisteredSlot);
  const index = ids.indexOf(memberId);
  return `비회원${ids.length > 1 ? ` ${index + 1}` : ""}`;
}
