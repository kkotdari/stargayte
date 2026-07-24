import type { ScreenKey } from "../types";

// "너 나와!" 게시판은 이제 상시 고정 메뉴다(요청) — 버전 게이트를 걷어내 다른 메뉴와 함께
// 처음부터 노출된다. (예전엔 3 이상에서만 열렸고, 버전이 늦게 로드돼 메뉴에 뒤늦게
// 끼어드는 깜빡임이 있었다.) 상수는 App의 접근 게이트 호환을 위해 1로 남긴다.
export const CHALLENGE_MIN_VERSION = 1;

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
  { key: "challenge", label: "너 나와!" },
  { key: "match", label: "기록실" },
  { key: "stats", label: "통계" },
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

// (버전이 바뀐 뒤 처음 접속했을 때 보여줄 안내 내용은 예전엔 여기 상수(APP_UPDATE_NOTES)에
// 있었지만, 이제 버전별로 서버(app_versions.notes)에서 관리하고 관리자 패널의 "버전 안내
// 설정"에서 편집한다 — 코드 배포 없이 버전마다 다른 내용을 넣을 수 있다.)
