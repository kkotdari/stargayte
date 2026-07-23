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

// 인앱 브라우저 안내 배너(.scr-inapp-notice)는 .scr-app 안에 있지만 모달과 무관한 상시
// 상단 배너다 — 실드가 이걸 "본문"으로 보고 터치/클릭을 막으면 모달(초대장 봉투 등)이
// 떠 있는 동안 "기본 브라우저로 열기"·닫기 버튼이 안 눌린다(지적: "모달 영역 밖 터치가
// 막혀 있음"). 허용 목록에 넣어 실드에서 제외한다.
const INLINE_ALLOW = ".scr-modal, .scr-photo-overlay, .scr-drawer, .scr-inapp-notice";

function isShieldedTarget(t: EventTarget | null): boolean {
  const el = t instanceof Element ? t : null;
  if (!el) return false;
  return !!el.closest(".scr-app") && !el.closest(INLINE_ALLOW);
}

// 대상에서 위로 올라가며(문서 루트 전까지) 실제로 스크롤 가능한 조상이 있는지 — 모달/
// 서랍/드롭다운 "안"이라도 스크롤할 곳이 없으면 iOS가 제스처를 문서(뒷 페이지)로
// 체이닝해 배경이 스크롤됐다(지적: "팝업 내부를 문지르면 뒷 페이지가 스크롤돼").
function canScrollWithin(start: Element): boolean {
  for (let n: Element | null = start; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    if (n.scrollHeight > n.clientHeight + 1) {
      const oy = getComputedStyle(n).overflowY;
      if (oy === "auto" || oy === "scroll") return true;
    }
  }
  return false;
}

function onScrollIntent(e: Event) {
  const el = e.target instanceof Element ? e.target : null;
  if (!el) return;
  if (isShieldedTarget(el)) { e.preventDefault(); return; }
  // 잠금 중엔 문서가 스크롤 주체가 될 일이 없다 — 안쪽에 스크롤 가능한 영역이 있으면
  // 그 스크롤은 브라우저에 맡기고(끝에서의 체이닝은 overscroll-behavior:contain이 차단),
  // 없으면 제스처 자체를 막아 문서로 새지 않게 한다.
  if (!canScrollWithin(el)) e.preventDefault();
}
// "바깥 탭 → 창 닫힘 → 실드 해제 → 뒤따라온 click이 배경 요소에 명중"의 구멍(지적:
// "주변부 터치 시 활성화된 창이 닫히는 용도로만 쓰여야 함") — 닫히기 직전에 다음 click
// 한 번을 문서 캡처에서 삼키는 일회용 가드를 심는다. 실드가 이미 내려간 뒤에 도착하는
// click까지 책임진다. 600ms 안에 click이 안 오면(드래그 등) 스스로 걷힌다.
export function swallowNextClick(): void {
  const swallow = (e: Event) => { e.preventDefault(); e.stopPropagation(); cleanup(); };
  const cleanup = () => { document.removeEventListener("click", swallow, true); window.clearTimeout(timer); };
  document.addEventListener("click", swallow, true);
  const timer = window.setTimeout(cleanup, 600);
}
// touchstart까지 막아야 배경 요소의 :active/터치 하이라이트(눌린 시각 효과)가 아예 안
// 생긴다 — pointerdown/click 차단만으로는 iOS가 시각 반응을 먼저 그려버린다.
function onTouchStart(e: Event) {
  if (isShieldedTarget(e.target)) e.preventDefault();
}
function onPointerDown(e: Event) {
  if (!isShieldedTarget(e.target)) return;
  e.preventDefault();
  e.stopPropagation();
  swallowNextClick();
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
    document.addEventListener("touchstart", onTouchStart, { passive: false, capture: true });
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
      document.removeEventListener("touchstart", onTouchStart, { capture: true } as EventListenerOptions);
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
