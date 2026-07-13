import type { ScreenKey } from "../types";

// "너 나와!" 게시판이 열리는 최소 버전 — 처음엔 3으로 잡지만, 그때그때(배포 일정에 따라)
// 이 숫자만 바꾸면 된다.
export const CHALLENGE_MIN_VERSION = 3;

export interface NavMenuItem {
  key: ScreenKey;
  label: string;
  // 이 버전 이상에서만 메뉴에 노출된다 — 생략하면 항상(버전 1부터) 노출.
  minVersion?: number;
  // 이 버전까지만 노출되고 그 다음 버전부턴 폐지된다 — 생략하면 계속 노출. 메뉴 자체를
  // 배열에서 지워버리면 "제어판 N버전 미리보기"로 미래에 사라질 예정인 상태를 미리 볼
  // 수 없으니, 실제로 지우는 대신 이 값을 채워 특정 버전부터 필터링되게 한다(그 버전이
  // 실제 배포되고 나면 이 항목을 배열에서 완전히 지워도 된다).
  maxVersion?: number;
}

// 헤더/모바일 탭바에 실제로 나열되는 공통 메뉴 — 배열 순서가 곧 노출 순서다(운영자 전용
// 화면은 AdminMenu가 별도로 담당하므로 여기 없음). 랭킹을 계속 홈 화면으로 두고 싶어서
// "너 나와!"를 배열 맨 앞이 아니라 랭킹 바로 다음(옆자리)에 둔다 — minVersion을 만족하는
// 순간 랭킹 뒤에 자연스럽게 끼어든다. 버전에 따라 메뉴 구성을 바꾸고 싶으면 이 배열만
// 편집하면 된다.
export const NAV_MENU_ITEMS: NavMenuItem[] = [
  { key: "ranking", label: "랭킹" },
  { key: "challenge", label: "챌린지", minVersion: CHALLENGE_MIN_VERSION },
  { key: "match", label: "경기" },
  { key: "stats", label: "통계" },
  // 조회는 회원 누구나 가능(수정/삭제만 운영자 전용, 화면 내부에서 처리) — 그래서 운영자
  // 전용 메뉴(AdminMenu)가 아니라 여기 공통 메뉴에 둔다.
  { key: "gameId", label: "게임아이디" },
];

export function visibleNavMenuItems(effectiveVersionNumber: number): NavMenuItem[] {
  return NAV_MENU_ITEMS.filter((item) => (
    effectiveVersionNumber >= (item.minVersion ?? 1)
    && effectiveVersionNumber <= (item.maxVersion ?? Infinity)
  ));
}

// 로그인 직후 보여줄 첫 화면 — 메뉴 배열의 맨 앞에 오는(=노출 조건을 만족하는) 화면을
// 그대로 홈으로 쓴다. 배열 순서가 곧 "무엇이 홈인지"의 유일한 기준이라 여기서 따로
// 화면 키를 하드코딩하지 않는다.
export function homeScreenFor(effectiveVersionNumber: number): ScreenKey {
  return visibleNavMenuItems(effectiveVersionNumber)[0]?.key ?? "ranking";
}

// 버전이 바뀐 뒤 처음 접속했을 때(AppUpdateNoticeModal) 보여줄 변경 내용 — 배포 때마다
// 최신 내용으로 덮어써서 쓴다(버전별로 쌓아두지 않는다. 배포가 잦지 않아 "가장 최근에
// 뭐가 바뀌었는지"만 한 번 보여주면 충분하다).
export const APP_UPDATE_NOTES: string[] = [
  "랭킹이 일대일/팀으로 나뉘었어요.",
  "챌린지 코너가 새로 생겼어요 — 원하는 상대를 지목해 대결을 신청해보세요!",
];
