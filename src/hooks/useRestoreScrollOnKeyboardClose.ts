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

// "이번 키보드 닫힘은 되돌리지 마라"를 밖에서 알려주는 통로 — 검색창에 키보드가 뜬
// 채로 하단 탭을 누르면 (1) 탭 동작(화면 이동/맨 위로)이 스크롤을 옮기고 (2) 키보드가
// 닫히며, 150ms 뒤 이 훅의 복원이 (1)의 결과를 도로 이전 위치로 되돌려버렸다(실제로
// 지적받은 문제 — "액티브탭 클릭시 최상단으로 가기가 바로 안됨"). 탭바가 자기 동작
// 직전에 이걸 불러 대기 중이거나 곧 생길 복원을 무효화한다. 훅 인스턴스는 앱에 하나뿐
// (App.tsx)이라 모듈 스코프 변수로 충분하다.
let cancelPendingRestore: (() => void) | null = null;
export function cancelKeyboardScrollRestore(): void {
  cancelPendingRestore?.();
}

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
    // 취소 요청이 오면 대기 중인 복원 타이머를 지우고, 아직 타이머가 안 걸렸더라도(키보드가
    // 닫히기 전이라도) keyboardOpen을 꺼서 이번 닫힘에 대한 복원 자체를 건너뛰게 한다.
    cancelPendingRestore = () => {
      keyboardOpen = false;
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = null;
    };
    vv.addEventListener("resize", onResize);
    return () => {
      cancelPendingRestore = null;
      if (settleTimer) clearTimeout(settleTimer);
      vv.removeEventListener("resize", onResize);
    };
  }, []);
}
