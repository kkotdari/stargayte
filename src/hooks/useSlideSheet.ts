import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";

// 아래에서 올라오고 아래로 쓸어내려 닫는 전체화면 시트의 공통 연출/제스처.
//
// 댓글 화면(FeedComments)이 먼저 쓰던 것을 게임결과 모달에도 달라는 요청으로 뽑아냈다.
// 댓글 쪽은 키보드·포커스·배경 스크롤 복원까지 얽혀 있어 그대로 두고, 그 로직 중 "열고
// 닫는 움직임"만 여기로 옮겨 새 모달이 쓴다.
//
// CSS 트랜지션이 아니라 WAAPI인 이유: 닫힐 때는 요소가 사라지므로 트랜지션이 걸릴 대상
// 자체가 없어져 끝을 기다릴 수 없다. 애니메이션이 끝난 뒤에 언마운트해야 툭 사라지지 않는다.

// 시트를 화면 밖으로 완전히 내리는 데 필요한 이동량(px) — 화면 바닥에서 시트 윗변까지.
function hiddenOffset(el: HTMLElement): number {
  return Math.max(0, window.innerHeight - el.getBoundingClientRect().top);
}

// 아래로 이만큼 내려간 채 손을 떼면 닫는다.
const SWIPE_CLOSE_PX = 96;

export function useSlideSheet(
  open: boolean,
  onClosed: () => void,
  refs: { sheet: RefObject<HTMLDivElement | null>; body: RefObject<HTMLDivElement | null> },
): { close: () => void } {
  const closingRef = useRef(false);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // fromY: 쓸어내리다 손을 뗀 위치에서 이어서 내려간다 — 0에서 다시 시작하면 손을 뗀
  // 순간 시트가 위로 튕겼다가 내려간다.
  const closeFrom = useCallback((fromY: number) => {
    const el = refs.sheet.current;
    if (closingRef.current) return;
    if (!el || reducedMotion()) { onClosedRef.current(); return; }
    closingRef.current = true;
    const total = hiddenOffset(el);
    const a = el.animate(
      [{ transform: `translateY(${fromY}px)` }, { transform: `translateY(${total}px)` }],
      {
        // 이미 내려온 만큼은 시간도 줄인다 — 남은 거리를 늘 같은 속도로 마무리한다.
        duration: Math.max(90, Math.round(160 * (1 - Math.min(1, fromY / Math.max(1, total))))),
        easing: "cubic-bezier(0.32, 0, 0.67, 0)", fill: "both",
      },
    );
    void a.finished.then(() => {
      closingRef.current = false;
      onClosedRef.current();
    }).catch(() => { /* 새로 열리며 취소됨 */ });
  }, [refs.sheet]);

  // 이벤트 핸들러에 그대로 넘겨도 인자가 섞이지 않도록 감싼다(onClick은 이벤트를 넘긴다).
  const close = useCallback(() => closeFrom(0), [closeFrom]);

  // 열릴 때 아래에서 올라온다. 시작 위치를 인라인으로 먼저 박는다 — WAAPI fill에만 맡기면
  // iOS가 첫 프레임에 적용하지 않아 열린 자리가 한 번 스쳐 보인다.
  useLayoutEffect(() => {
    const el = refs.sheet.current;
    if (!open || !el) return;
    closingRef.current = false;
    el.style.transform = "";
    if (reducedMotion()) return;
    const dy = hiddenOffset(el);
    el.style.transform = `translateY(${dy}px)`;
    const a = el.animate(
      [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
      { duration: 280, easing: "cubic-bezier(0.32, 0.72, 0, 1)", fill: "both" },
    );
    void a.finished.then(() => {
      try { a.cancel(); } catch { /* 이미 끝남 */ }
      el.style.transform = "";
    }).catch(() => {});
    return () => { try { a.cancel(); } catch { /* 이미 끝남 */ } };
  }, [open, refs.sheet]);

  // 아래로 쓸어내려 닫기. 시트 어디를 잡아도 되지만, 목록이 위로 스크롤될 수 있는
  // 상황이면 그쪽에 양보한다 — 목록이 맨 위에 있을 때만 시트가 따라 내려간다(시트 공통
  // 규칙). 터치 이벤트를 직접 듣는 건 사파리에서 preventDefault로 브라우저 기본 스크롤/
  // 새로고침 제스처를 확실히 끊기 위해서다.
  useEffect(() => {
    const el = refs.sheet.current;
    if (!open || !el) return;
    let startY = 0;
    let dy = 0;
    let tracking = false;
    let dragging = false;
    const onStart = (e: TouchEvent) => {
      if (closingRef.current || e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      dy = 0;
      tracking = true;
      dragging = false;
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const delta = e.touches[0].clientY - startY;
      if (!dragging) {
        if (Math.abs(delta) < 6) return;          // 아직 방향이 정해지지 않음
        const body = refs.body.current;
        const inBody = !!body && body.contains(e.target as Node | null);
        // 위로 미는 중이거나, 목록 안에서 아직 위로 스크롤할 게 남았으면 드래그하지 않는다.
        if (delta < 0 || (inBody && body!.scrollTop > 0)) { tracking = false; return; }
        dragging = true;
        startY = e.touches[0].clientY;            // 문턱만큼의 튐 제거
        return;
      }
      dy = Math.max(0, delta);
      if (e.cancelable) e.preventDefault();
      el.style.transform = `translateY(${dy}px)`;
    };
    const onEnd = () => {
      if (!tracking) return;
      tracking = false;
      if (!dragging) return;
      const moved = dy;
      dy = 0;
      if (moved > SWIPE_CLOSE_PX) { closeFrom(moved); return; }
      // 문턱에 못 미치면 제자리로 되돌린다.
      const back = el.animate(
        [{ transform: `translateY(${moved}px)` }, { transform: "translateY(0)" }],
        { duration: 190, easing: "cubic-bezier(0.32, 0.72, 0, 1)", fill: "both" },
      );
      void back.finished.then(() => {
        try { back.cancel(); } catch { /* 이미 끝남 */ }
        el.style.transform = "";
      }).catch(() => {});
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [open, refs.sheet, refs.body, closeFrom]);

  return { close };
}
