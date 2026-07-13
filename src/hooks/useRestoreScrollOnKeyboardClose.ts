import { useEffect } from "react";
import { getScrollTop, scrollRootTo } from "../utils/scrollRoot";

// interactive-widget=resizes-content라서 키보드가 뜨면 브라우저가 포커스된 입력칸을
// 보여주려고 스크롤을 올리는데, 키보드가 다시 내려가도 그 스크롤 위치를 원래대로
// 돌려주지는 않는다(실제로 지적받은 문제 — "키보드 내려가면 다시 안 돌아와"). 키보드가
// 뜬 시점의 스크롤 위치를 저장해뒀다가, 키보드가 완전히 닫히는 순간(visualViewport가
// 원래 높이로 돌아옴) 그 자리로 되돌린다.
const KEYBOARD_GAP_THRESHOLD = 120;
// 닫히는 순간(gap이 문턱 아래로 내려가는 첫 프레임)엔 아직 뷰포트가 다 자라지
// 않았을 수 있다(리사이즈가 한 번에 안 끝나고 몇백ms에 걸쳐 여러 번 일어난다 —
// 다른 곳에서도 이미 확인된 동작) — 그 상태에서 바로 스크롤을 되돌리면 뷰포트가
// 마저 자라는 도중에 스크롤이 튀어 보인다. 리사이즈가 잠깐 멎은 뒤에 되돌린다.
const SETTLE_MS = 150;

export function useRestoreScrollOnKeyboardClose(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let keyboardOpen = false;
    let savedScrollY = 0;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      const gap = window.innerHeight - vv.height - vv.offsetTop;
      if (gap > KEYBOARD_GAP_THRESHOLD) {
        if (!keyboardOpen) {
          keyboardOpen = true;
          savedScrollY = getScrollTop();
        }
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = null;
      } else if (keyboardOpen) {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          keyboardOpen = false;
          scrollRootTo({ top: savedScrollY, left: 0 });
        }, SETTLE_MS);
      }
    };
    vv.addEventListener("resize", onResize);
    return () => {
      if (settleTimer) clearTimeout(settleTimer);
      vv.removeEventListener("resize", onResize);
    };
  }, []);
}
