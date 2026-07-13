import type { MemberRole } from "../types";

export const ROLE_INFO: Record<MemberRole, string> = {
  "0202": "운영자",
  "0203": "회원",
};

// 운영자 화면에서 회원별로 부여/회수할 수 있는 역할 — 회원 상세/생성의 역할 체크박스
// 순서에 쓴다.
export const ASSIGNABLE_ROLES: MemberRole[] = ["0202", "0203"];

// 여러 역할을 동시에 가질 수 있는 배지/우선순위 표시용 — 앞쪽일수록 더 높은 권한.
// 회원이 가진 역할 중 대표로 하나만 보여줘야 하는 곳(목록 배지 등)에서 사용한다.
const ROLE_PRIORITY: MemberRole[] = ["0202", "0203"];

// 운영자 권한(회원 승인/정지, 종족 아이콘 설정, 타인 경기결과 수정/삭제, 다른 회원 역할
// 부여 등)을 갖는 등급.
export const ADMIN_ROLES: MemberRole[] = ["0202"];

export const hasAnyRole = (roles: MemberRole[], ...targets: MemberRole[]): boolean =>
  roles.some((r) => targets.includes(r));

export const isAdminRole = (roles: MemberRole[]): boolean => hasAnyRole(roles, ...ADMIN_ROLES);

// 목록/배지처럼 대표 역할 하나만 보여줘야 하는 곳에서 쓴다. 역할이 하나도 없으면 null.
export const primaryRole = (roles: MemberRole[]): MemberRole | null =>
  ROLE_PRIORITY.find((r) => roles.includes(r)) ?? null;
