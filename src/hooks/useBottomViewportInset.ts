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
    // 키보드가 떠 있는 동안엔 이 보정을 아예 쓰지 않는다.
    //
    // 이 값은 "주소창이 가리는 높이"를 재려는 것인데, 그 계산(innerHeight - vv.height)은
    // 키보드가 뜨면 키보드 높이(~300px)를 그대로 집어삼킨다. iOS 사파리는
    // interactive-widget=resizes-content를 지원하지 않아 키보드가 레이아웃 뷰포트를 줄이지
    // 않고 그냥 덮기 때문이다(그래서 innerHeight는 그대로다). 예전엔 그 이상치를 120px로
    // 자르기만 했는데, 그러면 탭바/등록 FAB이 문서 바닥이 아니라 '키보드 안쪽 120px 위'로
    // 떠올라, 포커스된 입력칸이 놓이는 바로 그 띠를 차지했다(지적: "입력창 위치가 키보드
    // 바로 위가 아니라 위에 남아"). 키보드가 떴을 땐 0으로 두어 하단 UI를 문서 바닥
    // (=키보드 뒤)에 그대로 두고, 그 UI들은 각자 keyboardInset 신호로 숨는다.
    const keyboardOpen = (): boolean => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };
    const update = () => {
      if (!vv) { root.style.setProperty("--vv-bottom-inset", "0px"); return; }
      // (한때 "마지막 정상값 유지"로 바꿔봤다 — 키보드를 닫을 때 시트가 주소창 자리를
      // 모자라게 잡는 줄 알고. 실제로는 자리 계산은 그 전에도 맞았고 타이밍만 어긋난
      // 것이라(지적) 원래대로 되돌렸다. 타이밍은 시트 쪽 padding 트랜지션이 맡는다.)
      if (keyboardOpen()) { root.style.setProperty("--vv-bottom-inset", "0px"); return; }
      // 레이아웃 뷰포트(innerHeight, 주소창 뒤까지 포함) − 실제 보이는 높이 − 위쪽으로 밀린 양.
      const raw = Math.round(window.innerHeight - vv.height - vv.offsetTop);
      // 주소창은 아무리 커도 ~80px이다. 그보다 큰 값은 주소창이 아니라 '아직 내려가는 중인
      // 키보드'라, 예전처럼 120px로 잘라서 쓰면 그 순간 하단 UI가 키보드 안쪽 120px 위로
      // 튀어올랐다 — 포커스가 풀리는 순간(keyboardOpen()이 false로 뒤집히는 순간)엔 키보드가
      // 아직 화면에 남아 있어서 반드시 이 구간을 지난다. 그래서 페이지가 주소창보다 먼저
      // 내려앉는 역전이 보였다(지적). 이상치는 자르지 말고 통째로 무시하고, 값을 이전 상태로
      // 둔 채 키보드가 다 내려가 정상 범위가 될 때 한 번에 반영한다.
      if (raw > 120) return;
      // 음수는 0으로 막는다 — 툴바가 접힐 때 탭바가 따라 내려가라고 잠시 음수를 허용해봤지만,
      // iOS가 레이아웃 뷰포트(innerHeight)도 함께 늘리는 경우 그 성장분과 이중으로 밀려 탭바
      // 아래가 화면 밖으로 잘렸다(신고: "탭바 축소시 아래 잘리는 경우 발생"). 접힘 추적은
      // 레이아웃 뷰포트 성장(bottom:0이 자동으로 따라감)에 맡긴다.
      root.style.setProperty("--vv-bottom-inset", `${Math.max(0, raw)}px`);
    };
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    // 포커스 이동만으로도 위 keyboardOpen() 판정이 뒤집힌다 — 뷰포트 리사이즈가 따라오지
    // 않는 경우(입력칸 사이 이동 등)에도 값이 즉시 맞도록 함께 듣는다.
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);
}
