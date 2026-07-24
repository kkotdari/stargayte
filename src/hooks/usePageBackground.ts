import { useEffect } from "react";

// 화면 전체 배경 사진을 "정상 흐름 레이어(.scr-app)"에 얹기 위한 공용 훅.
//
// 배경: iOS에서 position:fixed 레이어는 안전영역(상태바/홈인디케이터)을 뺀 뷰포트에 갇혀
// 크롬 뒤가 검게 남는다(실기기 확인). 반면 정상 흐름/루트 요소(.scr-app)의 배경은 화면
// 전체(안전영역 뒤 포함)로 뻗는다("다른 컨텐츠는 상태바 뒤까지 잘 나온다" — 사용자 확인).
// 그래서 사진을 fixed ::before 대신 .scr-app 배경으로 올려, 크롬/안전영역 뒤까지 채운다.
//
// 사용법: 배경을 원하는 화면이 이 훅을 호출하며 데스크톱/모바일 이미지 URL을 넘긴다.
// 실제 적용 여부(테마 등)는 CSS(html.scr-page-bg …)가 결정한다 — 지금은 다크에서만.
// 다른 화면/라이트 테마로 확장하려면 CSS 게이팅만 늘리면 된다(공통 구조 유지).
export function usePageBackground(
  desktopUrl: string | null | undefined,
  mobileUrl?: string,
  // 라이트 테마 전용 배경(선택) — 다크와 다른 사진을 쓰고 싶을 때. CSS(html.scr-page-bg
  // .scr-light-theme …)가 이 토큰을 읽어 라이트에서만 얹는다(요청: 라이트 랭킹 배경).
  lightUrl?: string,
  lightMobileUrl?: string,
): void {
  useEffect(() => {
    const root = document.documentElement;
    if (!desktopUrl && !lightUrl) return;
    if (desktopUrl) {
      root.style.setProperty("--page-bg-image", `url("${desktopUrl}")`);
      root.style.setProperty("--page-bg-image-mobile", `url("${mobileUrl ?? desktopUrl}")`);
    }
    if (lightUrl) {
      root.style.setProperty("--page-bg-image-light", `url("${lightUrl}")`);
      root.style.setProperty("--page-bg-image-light-mobile", `url("${lightMobileUrl ?? lightUrl}")`);
    }
    root.classList.add("scr-page-bg");
    return () => {
      root.classList.remove("scr-page-bg");
      root.style.removeProperty("--page-bg-image");
      root.style.removeProperty("--page-bg-image-mobile");
      root.style.removeProperty("--page-bg-image-light");
      root.style.removeProperty("--page-bg-image-light-mobile");
    };
  }, [desktopUrl, mobileUrl, lightUrl, lightMobileUrl]);
}
