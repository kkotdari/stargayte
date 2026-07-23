import { useEffect, useRef } from "react";

// ── 모달 입력 실드(구 body 스크롤 잠금) ──
// 예전에는 body를 position:fixed로 잠갔지만, 문서가 스크롤 불가가 되는 순간 iOS 26
// 사파리가 접었던 툴바(주소창/내비바)를 도로 펼쳐 모달·컨펌이 뜰 때마다 위아래가
// 띠로 채워졌다(지적 — 서랍에서 먼저 같은 문제를 겪고 같은 순서로 해결). 전체 화면
// fixed 오버레이도 같은 이유로 못 쓴다(.scr-modal-overlay는 display:contents로 박스가
// 없다, global.css). 그래서 DOM/레이아웃은 전혀 안 건드리고, document 캡처 리스너로
// "페이지 본문으로 가는 입력"만 막는다:
//  - touchmove/wheel: preventDefault → 배경 스크롤 차단(문서는 여전히 '스크롤 가능'으로
//    보이므로 사파리 크롬이 접힌 채 유지된다)
//  - pointerdown/click: 차단 + 최상단 모달의 바깥-클릭 콜백 호출(오버레이 클릭 닫기 대체)
// 무엇이 "본문"인가는 클래스 나열 대신 구조로 판정한다: 페이지 콘텐츠는 전부
// .scr-app 아래에 있고, 포털(모달/드롭다운/서랍/토스트)은 document.body 직속이라
// .scr-app 밖이다. 본문 안에 인라인으로 뜨는 모달/뷰어만 예외로 허용한다.
let lockCount = 0;
// 겹쳐 뜬 모달들의 바깥-클릭 콜백 스택 — 맨 위(마지막에 잠근) 모달만 반응한다.
const outsideStack: Array<{ onOutside?: () => void }> = [];

const INLINE_ALLOW = ".scr-modal, .scr-photo-overlay, .scr-drawer";

function isShieldedTarget(t: EventTarget | null): boolean {
  const el = t instanceof Element ? t : null;
  if (!el) return false;
  return !!el.closest(".scr-app") && !el.closest(INLINE_ALLOW);
}

function onScrollIntent(e: Event) {
  if (isShieldedTarget(e.target)) e.preventDefault();
}
function onPointerDown(e: Event) {
  if (!isShieldedTarget(e.target)) return;
  e.preventDefault();
  e.stopPropagation();
  outsideStack[outsideStack.length - 1]?.onOutside?.();
}
function onClick(e: Event) {
  if (!isShieldedTarget(e.target)) return;
  e.preventDefault();
  e.stopPropagation();
}

function lockBodyScroll(onOutside?: () => void): () => void {
  if (lockCount === 0) {
    document.addEventListener("touchmove", onScrollIntent, { passive: false, capture: true });
    document.addEventListener("wheel", onScrollIntent, { passive: false, capture: true });
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
  }
  lockCount++;
  const entry = { onOutside };
  outsideStack.push(entry);
  return () => {
    const i = outsideStack.indexOf(entry);
    if (i >= 0) outsideStack.splice(i, 1);
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
      document.removeEventListener("touchmove", onScrollIntent, { capture: true } as EventListenerOptions);
      document.removeEventListener("wheel", onScrollIntent, { capture: true } as EventListenerOptions);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick, true);
    }
  };
}

// 지금 실드가 켜져 있는지(=모달이 하나라도 떠 있는지) 여부. pull-to-refresh 등
// document 레벨 제스처 처리가 모달 위에서는 동작하지 않게 막을 때 쓴다.
export function isBodyScrollLocked(): boolean {
  return lockCount > 0;
}

// 모달이 떠 있는 동안 배경(본문)으로 가는 스크롤/클릭을 막는다. active를 false로 주면
// 잠그지 않는다. onOutside를 주면 배경을 탭했을 때 호출된다(예전 "오버레이 클릭으로
// 닫기"의 대체) — 겹쳐 뜬 경우 맨 위 모달의 것만 불린다.
export function useLockBodyScroll(active = true, onOutside?: () => void): void {
  const cbRef = useRef(onOutside);
  cbRef.current = onOutside;
  useEffect(() => {
    if (!active) return;
    return lockBodyScroll(() => cbRef.current?.());
  }, [active]);
}
