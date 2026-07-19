import { useEffect } from "react";

// iOS 사파리(주소창이 화면 하단)에서 하단 고정 탭바가 주소창 뒤로 깔리거나(가림) 반대로
// 너무 높이 뜨던 문제 — CSS 뷰포트 단위(svh/lvh/dvh)는 "하단 주소창"과 잘 안 맞아 값이 어긋난다.
// 실제로 보이는 영역은 visualViewport가 정확히 알려주므로, 그걸로 "레이아웃 뷰포트 바닥과
// 실제 보이는 바닥 사이의 간격(=주소창이 가리는 높이)"을 계산해 CSS 변수(--vv-bottom-inset)로
// 내려준다. 탭바는 bottom: var(--vv-bottom-inset)로 항상 주소창 바로 위에 붙는다.
// PWA(standalone)·데스크톱은 주소창이 없어 innerHeight==visualViewport.height라 자연히 0.
export function useBottomViewportInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    const update = () => {
      let inset = 0;
      if (vv) {
        // 레이아웃 뷰포트(innerHeight, 주소창 뒤까지 포함) − 실제 보이는 높이 − 위쪽으로 밀린 양.
        // interactive-widget=resizes-content라 키보드는 양쪽에서 함께 빠져 주소창 몫만 남는다.
        inset = window.innerHeight - vv.height - vv.offsetTop;
      }
      // 음수 방지 + 주소창은 아무리 커도 ~80px이라, 그 이상(키보드 등 이상치)은 무시한다.
      inset = Math.min(120, Math.max(0, Math.round(inset)));
      root.style.setProperty("--vv-bottom-inset", `${inset}px`);
    };
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
}
