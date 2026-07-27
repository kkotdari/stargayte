import { useEffect, useState } from "react";

// 입력칸에 포커스가 있는지 — 모바일에서 "지금 키보드가 떠 있다"의 신호로 쓴다.
//
// 예전엔 visualViewport로 키보드 높이를 실측해(useKeyboardInset) 하단 UI를 숨겼는데, 그
// 계산엔 100ms 디바운스와 120px 문턱이 있어서 키보드가 이미 올라오는 중에야 숨김이 걸렸다.
// 그 짧은 구간 동안 탭바/FAB이 보인 채로 뷰포트 변화에 따라 위치까지 바뀌어 잔상처럼
// 끌렸다(지적: "키보드가 올라오면서 fab와 탭바가 약간 잔상이 보인다"). 포커스는 키보드보다
// 먼저, 정확히 한 번 일어나는 신호라 그 구간 자체가 없다 — 뷰포트가 실제로 얼마나 줄어드는지는
// 우리가 알 필요도, 따라갈 이유도 없다(OS/브라우저에 맡긴다).
function isEditable(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

// 지금 화면 아래를 키보드가 덮고 있는지 — 레이아웃 뷰포트와 실제 보이는 높이의 차이로 본다.
// iOS 사파리는 키보드가 레이아웃 뷰포트를 줄이지 않고 덮기만 하므로 이 차이가 그대로
// "가려진 높이"다. 주소창도 같은 식으로 잡히지만 아무리 커도 ~80px이라, 그보다 큰 값은
// 키보드로 본다(useBottomViewportInset과 같은 기준).
const COVER_THRESHOLD = 120;
function keyboardCovering(): boolean {
  const vv = window.visualViewport;
  if (!vv) return false;
  return window.innerHeight - vv.height - vv.offsetTop > COVER_THRESHOLD;
}
// 키보드가 다 내려갈 때까지 기다리는 안전장치 — resize가 끝내 안 오는 기기/상황에서도
// 신호가 영원히 붙잡혀 있지 않게 한다.
const SETTLE_TIMEOUT_MS = 700;

export function useEditableFocused(): boolean {
  const [focused, setFocused] = useState(() => isEditable(document.activeElement));
  useEffect(() => {
    // focusin은 포커스가 옮겨간 뒤에 오지만 focusout은 옮겨가기 '전'에 와서, 그 순간
    // activeElement는 아직 body다 — 입력칸에서 입력칸으로 넘어갈 때 잠깐 false가 됐다가
    // 다시 true가 되며 하단 UI가 깜빡인다. 켜는 건 즉시(숨김이 늦으면 안 된다), 끄는 건
    // 한 프레임 뒤에 실제로 정착한 포커스를 보고 판단한다.
    //
    // 끄는 시점은 거기서 한 걸음 더 늦춘다: 포커스가 풀린 '순간'에 되돌리면 키보드가 아직
    // 내려오는 중인데 탭바·FAB·시트 여백이 먼저 제자리로 튀어, 페이지가 주소창보다 먼저
    // 내려앉는 역전이 보인다(지적). 실제로 키보드가 다 내려간 뒤(=뷰포트가 회복된 뒤)에
    // 한 번에 되돌린다.
    let raf = 0;
    let timer = 0;
    let watching = false;
    const vv = window.visualViewport;

    const stopWatch = () => {
      if (!watching) return;
      watching = false;
      vv?.removeEventListener("resize", onSettle);
      window.clearTimeout(timer);
    };
    const finish = () => {
      stopWatch();
      setFocused(isEditable(document.activeElement));
    };
    function onSettle() {
      if (!keyboardCovering()) finish();
    }

    const on = (e: FocusEvent) => {
      cancelAnimationFrame(raf);
      stopWatch();
      setFocused(isEditable(e.target as Element | null));
    };
    const off = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // 다른 입력칸으로 옮겨간 것뿐이면 그대로 유지.
        if (isEditable(document.activeElement)) return;
        // 키보드가 이미 내려가 있으면(또는 애초에 없으면) 바로 되돌린다.
        if (!keyboardCovering()) { setFocused(false); return; }
        if (watching) return;
        watching = true;
        vv?.addEventListener("resize", onSettle);
        timer = window.setTimeout(finish, SETTLE_TIMEOUT_MS);
      });
    };
    document.addEventListener("focusin", on);
    document.addEventListener("focusout", off);
    return () => {
      cancelAnimationFrame(raf);
      stopWatch();
      document.removeEventListener("focusin", on);
      document.removeEventListener("focusout", off);
    };
  }, []);
  return focused;
}
