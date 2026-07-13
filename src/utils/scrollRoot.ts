// 지금은 항상 window가 스크롤 컨테이너지만, 앱 셀 마이그레이션(4단계)에서 body 스크롤을
// #scroll-root 컨테이너로 옮기면 이 파일의 getScrollRoot()만 그 엘리먼트를 가리키도록
// 바꾸면 된다 — 나머지 스크롤 관련 코드는 window를 직접 참조하지 않고 전부 이 파일의
// 헬퍼를 거치므로 그때 가서 각자 손볼 필요가 없다.
export type ScrollRoot = Window | HTMLElement;

export function getScrollRoot(): ScrollRoot {
  return document.getElementById("scroll-root") ?? window;
}

export function getScrollTop(root: ScrollRoot = getScrollRoot()): number {
  return root instanceof Window ? root.scrollY : root.scrollTop;
}

export function scrollRootTo(opts: ScrollToOptions, root: ScrollRoot = getScrollRoot()): void {
  root.scrollTo(opts);
}

export function addScrollListener(listener: () => void, root: ScrollRoot = getScrollRoot()): () => void {
  root.addEventListener("scroll", listener, { passive: true });
  return () => root.removeEventListener("scroll", listener);
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
