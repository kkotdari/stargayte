import { getScrollTop, scrollRootTo } from "./scrollRoot";

// 포커스된 입력칸을 "키보드 바로 위"로 한 번 옮겨준다.
//
// 사파리는 포커스된 요소가 키보드에 가려질 때만 스크롤하고, 안 가려지면 있던 자리에 그냥
// 둔다. 그래서 입력칸이 키보드에서 한참 떨어진 어중간한 높이에 서 있기도 하고(그 사이에
// 카드가 통째로 들어가 보인다), 가려져 있었을 땐 확 점프해 어디를 보고 있었는지 놓친다
// (지적: "인풋창 위치가 너무 어색하고 스크롤이 순간이동해서 헷갈려"). 어느 쪽이든 매번
// 결과가 달라 예측이 안 된다 — 항상 같은 자리(키보드 바로 위)로, 눈이 따라갈 수 있는
// 속도로 옮긴다.
//
// 사파리와 싸우지 않으려고 '사파리가 할 일을 끝낸 뒤'에 움직인다: 포커스 직후가 아니라
// visualViewport 리사이즈(=키보드 애니메이션)가 멎은 다음에 실제 보이는 바닥을 재고 그때
// 목표를 계산한다. 예전에 키보드 닫힘 스크롤을 되돌리려다 사파리와 줄다리기가 돼 결과가
// 랜덤해진 적이 있어(그 훅은 제거), 이번엔 되돌리지 않고 한 방향으로 한 번만 맞춘다.
const GAP = 12;
const DURATION = 260;
// 키보드 애니메이션이 끝났다고 볼 정적 구간. 리사이즈가 여러 번 쪼개져 오므로 마지막
// 이벤트 뒤로 이만큼 조용하면 정착으로 본다.
const SETTLE_MS = 120;
// 이보다 적게 움직여도 되면 그냥 둔다 — 이미 적당한 자리면 굳이 화면을 흔들 이유가 없다.
const MIN_SHIFT = 24;

export function scrollIntoKeyboardView(el: HTMLElement): () => void {
  const vv = window.visualViewport;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let raf = 0;
  let done = false;

  const run = () => {
    if (done) return;
    done = true;
    // 실제로 보이는 바닥 = 비주얼 뷰포트의 아래끝(키보드 위). vv가 없으면 창 높이.
    const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const rect = el.getBoundingClientRect();
    const delta = rect.bottom + GAP - visibleBottom;
    if (Math.abs(delta) < MIN_SHIFT) return;
    const from = getScrollTop();
    const to = Math.max(0, from + delta);
    const t0 = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / DURATION);
      // instant — #scroll-root/html에 걸린 CSS scroll-behavior:smooth가 매 프레임의
      // scrollTo를 네이티브 스무스로 해석해 서로 재시작시키는 걸 막는다(scrollRoot 주석).
      scrollRootTo({ top: from + (to - from) * ease(p), behavior: "instant" as ScrollBehavior });
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };

  const bump = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, SETTLE_MS);
  };
  vv?.addEventListener("resize", bump);
  // 키보드가 원래 떠 있던 상태에서 다른 입력칸으로 옮겨가면 리사이즈가 아예 안 온다 —
  // 그때도 자리를 맞춰야 하므로 한 번은 무조건 예약해 둔다.
  bump();

  return () => {
    done = true;
    if (timer) clearTimeout(timer);
    cancelAnimationFrame(raf);
    vv?.removeEventListener("resize", bump);
  };
}
