import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

// 라이트 테마(흰 배경 + 검은 글씨 토글) — 로그인 화면과 로그인 후 헤더가 각자 독립적으로
// 켜고 끌 수 있는 같은 설정을 공유한다. html에 filter를 걸면 프사 같은 이미지까지 통째로
// 무채색이 돼버려서, 대신 .scr-light-theme 클래스로 테마 변수만 라이트 팔레트 값으로
// 바꿔치기한다(global.css 참고) — 이미지나 변수를 안 쓰는 색은 그대로 남는다.
const LIGHT_THEME_KEY = "scr-light-theme";

// 다크/라이트 각각의 --void(페이지 배경) 값과 정확히 맞춘다 — global.css의 :root/
// html.scr-light-theme 선언과 나란히 둔다.
const VOID_COLOR = { dark: "#060607", light: "#ffffff" };

// <meta name="theme-color">가 index.html에 다크 값(#060607)으로 고정돼 있어서, 라이트
// 테마로 바꿔도 모바일 브라우저의 상태表시줄/주소창 색은 계속 어두운 값 그대로였다 —
// 네이버 등 다른 사이트들은 페이지 배경과 상태바 색이 항상 맞아떨어져 그 경계가 아예
// 안 보이는데, 여기는 라이트 테마에서 흰 페이지 위에 어두운 상태바가 뜬금없이 끼어
// 있는 것처럼 보였다(요청: "네이버같은데 들어가면 노티바와 주소창 영역까지도 페이지가
// 보여... 우리도 이렇게 하면 좋겠어"). 테마를 바꿀 때마다 이 메타 태그도 같이 갱신해
// 상태바/주소창 색이 항상 지금 페이지 배경과 정확히 같게 한다.
function applyThemeColor(on: boolean): void {
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", on ? VOID_COLOR.light : VOID_COLOR.dark);
}

// iOS 26 사파리는 툴바(주소창/내비바) 색을 theme-color 메타보다 "페이지 실제 픽셀 샘플링"
// 으로 정하는데, 그 샘플링이 스크롤 등 화면 변화 때만 다시 돌아서 테마를 바꿔도 툴바가
// 한 박자 늦게 따라오는 버그가 있었다(지적: "화면이 조금이라도 바뀌어야 뒤늦게 변함").
// 새 테마 색이 실제로 그려진 다음(더블 rAF) 스크롤을 1px 움직였다 즉시 되돌려 재샘플링을
// 강제한다 — behavior:instant라 화면에는 보이지 않고, 1px 이동은 탭바 숨김 판정 임계값
// (useHideOnScrollDown, 4px/10px)보다 작아 다른 동작을 건드리지 않는다.
function nudgeToolbarResample(): void {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const y = window.scrollY;
    window.scrollTo({ top: y > 0 ? y - 1 : 1, behavior: "instant" });
    window.scrollTo({ top: y, behavior: "instant" });
  }));
}

function applyLightTheme(on: boolean): void {
  document.documentElement.classList.toggle("scr-light-theme", on);
  applyThemeColor(on);
  localStorage.setItem(LIGHT_THEME_KEY, on ? "1" : "0");
  nudgeToolbarResample();
}

// 새로고침해도, 로그인/로그아웃을 거쳐도 유지되도록 localStorage에 저장한다 — 대부분
// 한 사람이 로그인 화면과 로그인 후 화면을 오가며 쓰므로, 두 화면이 같은 테마 선택을
// 공유한다(로그아웃한다고 되돌리지 않는다). 로그인 화면(AuthScreen)과 헤더 둘 다 이
// 훅으로 마운트되는 즉시 저장된 값을 읽어와 이어서 쓴다.
export function useLightTheme(): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [on, setOn] = useState(() => localStorage.getItem(LIGHT_THEME_KEY) === "1");
  useEffect(() => { applyLightTheme(on); }, [on]);
  return [on, setOn];
}
