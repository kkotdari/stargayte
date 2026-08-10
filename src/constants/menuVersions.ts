import type { ScreenKey } from "../types";

// v2 컨셉: 경쟁 요소를 배제하고 커뮤니티의 역사와 활동을 기록한다.
// 유저용 페이지는 활동/통계/리그 셋이다(운영자 전용 화면은 AdminMenu가 별도로 담당).

export interface NavMenuItem {
  key: ScreenKey;
  label: string;
}

// 헤더/모바일 탭바에 나열되는 공통 메뉴 — 배열 순서가 곧 노출 순서.
export const NAV_MENU_ITEMS: NavMenuItem[] = [
  { key: "activity", label: "활동" },
  /* 래더와 내전은 아예 다른 메뉴다(요청) — 한때 "통계" 하나에 유형 라디오로 들어 있었는데,
     같은 표를 거르는 값처럼 보이던 그 자리가 실제로는 서로 다른 두 화면을 감추고 있었다.
     래더는 통계가 아니라 리더보드다: 일대일 레이팅으로 줄을 세운 순위표 하나가 전부이고,
     내전은 반대로 순위가 없는 대신 전적·생산·칭호를 늘어놓는 표다. 진입점부터 갈라 둔다. */
  { key: "ladder", label: "래더 보드" },
  { key: "clan", label: "내전 통계" },
  // 운영 드롭다운에서 정식 메뉴로 나왔다(요청: "리그메뉴를 정식으로 탭바로 이동시키고" +
  // "전체 공개, 읽기는 누구나"). 보는 건 회원 누구나이고, 고치는 건 화면 안의 '수정'
  // 토글이 운영자에게만 보인다 — 실제 경계는 백엔드 라우터가 지킨다.
  { key: "leagues", label: "리그" },
];

// 로그인 직후 보여줄 첫 화면.
export const HOME_SCREEN: ScreenKey = NAV_MENU_ITEMS[0].key;
