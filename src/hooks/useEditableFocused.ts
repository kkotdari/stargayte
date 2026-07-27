import { useEffect, useState } from "react";

// 입력칸에 포커스가 있는지 — 모바일에서 "지금 키보드가 뜬다"의 신호로 쓴다.
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

export function useEditableFocused(): boolean {
  const [focused, setFocused] = useState(() => isEditable(document.activeElement));
  useEffect(() => {
    // focusin은 포커스가 옮겨간 뒤에 오지만 focusout은 옮겨가기 '전'에 와서, 그 순간
    // activeElement는 아직 body다 — 입력칸에서 입력칸으로 넘어갈 때 잠깐 false가 됐다가
    // 다시 true가 되며 하단 UI가 깜빡인다. 켜는 건 즉시(숨김이 늦으면 안 된다), 끄는 건
    // 한 프레임 뒤에 실제로 정착한 포커스를 보고 판단한다.
    let raf = 0;
    const on = (e: FocusEvent) => {
      cancelAnimationFrame(raf);
      setFocused(isEditable(e.target as Element | null));
    };
    const off = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setFocused(isEditable(document.activeElement)));
    };
    document.addEventListener("focusin", on);
    document.addEventListener("focusout", off);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("focusin", on);
      document.removeEventListener("focusout", off);
    };
  }, []);
  return focused;
}
