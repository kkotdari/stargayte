// 문서 스크롤 전환(요청: 사파리 주소창/내비바 축소) — 사파리는 문서 자체가 스크롤될
// 때만 툴바를 접으므로, 내부 컨테이너(#scroll-root) 스크롤을 버리고 window가 유일한
// 스크롤 주체다. 스크롤 관련 코드는 전부 이 헬퍼를 거치므로 여기 하나만 바꾸면 된다.
export type ScrollRoot = Window | HTMLElement;

export function getScrollRoot(): ScrollRoot {
  return window;
}

export function getScrollTop(root: ScrollRoot = getScrollRoot()): number {
  return root instanceof Window ? root.scrollY : root.scrollTop;
}

export function scrollRootTo(opts: ScrollToOptions, root: ScrollRoot = getScrollRoot()): void {
  root.scrollTo(opts);
}

// 부드러운 "맨 위로" 스크롤 — 네이티브 behavior:"smooth"는 iOS에서 관성 스크롤과
// 겹치면 무시되거나 중간에 끊기는 일이 있어(액티브 탭 재탭이 "바로 안됨" 문제의 한
// 원인), rAF로 직접 애니메이션한다. 그렇다고 instant로 두면 순간이동이라 어지럽다
// (요청: "스크롤탑시 좀 부드럽게 올라가기 지금은 거의 순간이동") — 짧은 고정
// 시간(기본 420ms) 동안 easeOutCubic으로 감속하며 올라간다. 애니메이션 중에 사용자가
// 다시 스크롤/터치를 시작하면 즉시 중단해 조작과 싸우지 않는다.
export function smoothScrollRootToTop(duration = 420, root: ScrollRoot = getScrollRoot()): void {
  smoothScrollRootTo(0, duration, { root });
}

/** 이징 — "out"은 처음부터 빠르게 출발해 끝에서 감속한다(탭을 눌러 맨 위로 갈 때처럼
 *  손짓에 바로 반응해야 하는 자리). "inOut"은 시작도 천천히라, 아무도 안 눌렀는데
 *  화면이 스스로 움직이는 자리에 맞다 — 갑자기 튀어나가는 느낌이 없다(요청: 활동 첫
 *  자동 스크롤을 좀 더 부드럽게). */
type ScrollEase = "out" | "inOut";
const EASES: Record<ScrollEase, (t: number) => number> = {
  out: (t) => 1 - Math.pow(1 - t, 3),
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

/** 위와 같은 rAF 애니메이션으로 임의의 자리까지 — 활동에 들어올 때 "현재" 구분선으로
 *  부드럽게 내려가는 데 쓴다(요청). 위 함수와 한 몸이라 취소 규칙도 그대로다. */
export function smoothScrollRootTo(
  target: number, duration = 420,
  opts: { ease?: ScrollEase; root?: ScrollRoot } = {},
): void {
  const root = opts.root ?? getScrollRoot();
  const start = getScrollTop(root);
  const delta = target - start;
  if (delta === 0) return;
  const t0 = performance.now();
  let raf = 0;
  // 이 애니메이션이 도는 동안임을 알린다 — 스크롤 구독자 중 무거운 것(타임라인)이 매
  // 프레임 재는 일을 건너뛰게 해서 스크롤이 끊기지 않게 한다(아래 isProgrammaticScroll).
  programmaticUntil = t0 + duration;
  /** 다 끝났거나 중간에 취소됐을 때 — 표시를 걷고, 구독자들이 마지막으로 한 번은 제대로
   *  잴 수 있게 스크롤 이벤트를 한 번 흘려 준다. 애니메이션이 멈추면 브라우저가 더 이상
   *  scroll을 쏘지 않으므로, 이게 없으면 건너뛴 채로 굳은 값이 그대로 남는다. */
  const done = () => {
    programmaticUntil = 0;
    requestAnimationFrame(() => root.dispatchEvent(new Event("scroll")));
  };
  const removeListeners = () => {
    window.removeEventListener("wheel", cancel);
    window.removeEventListener("touchmove", cancel);
  };
  const cancel = () => { cancelAnimationFrame(raf); removeListeners(); done(); };
  window.addEventListener("wheel", cancel, { passive: true });
  // touchstart가 아니라 touchmove로 취소한다 — 이 스크롤탑을 발동시키는 게 탭(터치)
  // 자체라, touchstart로 취소하면 방금 시작한 애니메이션을 그 탭의 touchstart가 곧바로
  // 취소해 버려 "액티브 탭 눌러도 스크롤탑이 안 먹는" 회귀가 있었다. 탭은 손가락을 끌지
  // 않으므로(touchmove 없음) 발동 탭엔 반응하지 않고, 사용자가 실제로 스크롤하려고
  // 손가락을 움직일 때(touchmove)만 취소한다.
  window.addEventListener("touchmove", cancel, { passive: true });
  const ease = EASES[opts.ease ?? "out"];
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / duration);
    // behavior:"instant"가 핵심이다 — #scroll-root에는 CSS scroll-behavior:smooth가
    // 걸려 있어서(global.css), behavior를 안 주면 매 프레임의 scrollTo가 전부 네이티브
    // 스무스 스크롤로 해석돼 서로 재시작을 반복하며 제자리걸음한다(실제로 이 함수가
    // 처음에 전혀 안 움직였던 원인). 프레임마다는 즉시 이동시키고, "부드러움"은 이
    // rAF 루프의 이징이 만든다.
    root.scrollTo({ top: start + delta * ease(p), behavior: "instant" });
    if (p < 1) raf = requestAnimationFrame(step);
    else { removeListeners(); done(); }
  };
  raf = requestAnimationFrame(step);
}

/* 프로그램이 굴리는 스크롤이 도는 중인가 — 손으로 굴릴 때는 브라우저가 스크롤 자체를
   따로 처리해 주지만, 이 rAF 애니메이션은 매 프레임 우리가 scrollTo를 부르는 것이라
   구독자들이 그 프레임에 하는 일이 곧바로 다음 프레임을 늦춘다. 문서 전체를 훑어 재는
   구독자(타임라인)는 그동안 쉬어야 스크롤이 끊기지 않는다(지적: 활동 진입 시 스크롤이
   부드럽지 않음). isScrollHideSuppressed와 창은 비슷하지만 뜻이 다르다 — 그쪽은
   "숨김 방향 판정을 하지 마라"이고, 이쪽은 "지금은 재지 마라"다. */
let programmaticUntil = 0;
export function isProgrammaticScroll(): boolean {
  return programmaticUntil > 0 && performance.now() < programmaticUntil;
}

// 프로그램(자동) 스크롤이 "아래로 스크롤 = 탭바/필터 숨김"으로 오인되지 않게 하는 창구 —
// 너나와 진입 시 NEXT 너 나와로 자동 스크롤할 때 탭바/아이콘이 같이 숨던 문제(요청: "next
// 너 나와로 자동 스크롤하면서 탭바와 아이콘이 숨겨지는 문제 해결")를 막는다. 자동 스크롤 직전에
// suppressScrollHide()를 부르면 그 짧은 구간 동안 useHideOnScrollDown이 숨김 판정을 건너뛴다.
let suppressHideUntil = 0;
export function suppressScrollHide(ms = 900): void {
  const until = performance.now() + ms;
  if (until > suppressHideUntil) suppressHideUntil = until;
}
export function isScrollHideSuppressed(): boolean {
  return performance.now() < suppressHideUntil;
}

// rAF로 프레임당 한 번만 실행되게 묶은 스크롤 구독 — 모바일에서 스크롤 이벤트는 한 프레임에도
// 여러 번 쏟아지는데, 그때마다 리스너가 getScrollMetrics()로 scrollHeight/clientHeight를 읽으면
// (강제 리플로우) 스크롤 도중 메인 스레드가 밀려 탭바/필터·검색창 숨김·노출 반응이 눈에 띄게
// 느려졌다(특히 키보드를 한 번 올렸다 내려 뷰포트가 리사이즈된 뒤로 그 페이지 내내 계속됨,
// 실제로 지적받은 문제). 리스너는 rAF 안에서 실행되므로 항상 그 프레임의 최신 위치를 읽고,
// 마지막(스크롤이 멈추는) 이벤트도 뒤따르는 rAF 한 번으로 확실히 반영된다. 스크롤을 발동하는
// passive 리스너 자체는 아무 일도 안 해 스크롤 성능에 영향을 주지 않는다.
export function addRafScrollListener(listener: () => void, root: ScrollRoot = getScrollRoot()): () => void {
  let scheduled = false;
  let removed = false;
  const onScroll = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (!removed) listener();
    });
  };
  root.addEventListener("scroll", onScroll, { passive: true });
  return () => {
    removed = true;
    root.removeEventListener("scroll", onScroll);
  };
}

export interface ScrollMetrics { scrollTop: number; clientHeight: number; scrollHeight: number }

export function getScrollMetrics(root: ScrollRoot = getScrollRoot()): ScrollMetrics {
  if (root instanceof Window) {
    return {
      scrollTop: root.scrollY,
      clientHeight: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
    };
  }
  return { scrollTop: root.scrollTop, clientHeight: root.clientHeight, scrollHeight: root.scrollHeight };
}
