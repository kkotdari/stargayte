import { useEffect } from "react";

// 화면 전체 배경 사진을 "정상 흐름 레이어(.scr-app)"에 얹기 위한 공용 훅.
//
// 배경: iOS에서 position:fixed 레이어는 안전영역(상태바/홈인디케이터)을 뺀 뷰포트에 갇혀
// 크롬 뒤가 검게 남는다(실기기 확인). 반면 정상 흐름/루트 요소(.scr-app)의 배경은 화면
// 전체(안전영역 뒤 포함)로 뻗는다("다른 컨텐츠는 상태바 뒤까지 잘 나온다" — 사용자 확인).
// 그래서 사진을 fixed ::before 대신 .scr-app 배경으로 올려, 크롬/안전영역 뒤까지 채운다.
//
// 사용법: 배경을 원하는 화면이 이 훅을 호출하며 데스크톱/모바일 이미지 URL을 넘긴다.
// 실제 적용 여부는 CSS(html.scr-page-bg …)가 결정한다.
// lightUrl까지 넘기면 라이트 테마에도 배경이 깔린다(요청: 피드 배경을 양 테마 모두 복구)
// — 안 넘기면 다크에서만 얹히는 예전 동작 그대로다(통계 화면이 그렇다). 켜짐 여부를
// 변수 존재로 판단하면 CSS가 IACVT로 무너지므로 전용 클래스를 따로 붙인다.
export function usePageBackground(
  desktopUrl: string | null | undefined,
  mobileUrl?: string,
  lightUrl?: string,
): void {
  useEffect(() => {
    const root = document.documentElement;
    if (!desktopUrl) return;
    root.style.setProperty("--page-bg-image", `url("${desktopUrl}")`);
    root.style.setProperty("--page-bg-image-mobile", `url("${mobileUrl ?? desktopUrl}")`);
    root.classList.add("scr-page-bg");
    if (lightUrl) {
      root.style.setProperty("--page-bg-image-light", `url("${lightUrl}")`);
      root.classList.add("scr-page-bg-light");
    }
    return () => {
      root.classList.remove("scr-page-bg");
      root.classList.remove("scr-page-bg-light");
      root.style.removeProperty("--page-bg-image");
      root.style.removeProperty("--page-bg-image-mobile");
      root.style.removeProperty("--page-bg-image-light");
    };
  }, [desktopUrl, mobileUrl, lightUrl]);
}
