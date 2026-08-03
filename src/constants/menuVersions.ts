import type { ScreenKey } from "../types";

// v2 컨셉: 경쟁 요소를 배제하고 커뮤니티의 역사와 활동을 기록한다.
// 유저용 페이지는 활동/통계 둘뿐이다(운영자 전용 화면은 AdminMenu가 별도로 담당).

export interface NavMenuItem {
  key: ScreenKey;
  label: string;
}

// 헤더/모바일 탭바에 나열되는 공통 메뉴 — 배열 순서가 곧 노출 순서.
export const NAV_MENU_ITEMS: NavMenuItem[] = [
  { key: "activity", label: "활동" },
  { key: "stats", label: "통계" },
];

// 로그인 직후 보여줄 첫 화면.
export const HOME_SCREEN: ScreenKey = NAV_MENU_ITEMS[0].key;
