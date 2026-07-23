import { useEffect } from "react";

// 모바일 공통 "아래로 슬라이드해서 닫기" — 모달류(.scr-modal: 일반 모달·제어판·인박스 등,
// 그리고 상성관계 오버레이 .scr-rivalry-overlay-body)를 최상단까지 스크롤한 상태에서
// 아래로 끌면 시트가 손가락을 따라 내려가고, 문턱을 넘기면 슬라이드아웃 후 실제로 닫힌다.
// 문서 레벨 위임 핸들러 하나로 모든 모달에 공통 적용한다(모달마다 배선 불필요) — 닫기는
// 각 모달이 이미 가진 닫기 버튼(aria-label="닫기")을 눌러 원래 onClose를 그대로 태운다.
//
// 핵심(요청): 끄는 동안 touchmove를 preventDefault해서 iOS 고무줄 리바운드/배경 스크롤을
// 막는다 — 안 그러면 "최상단에서 아래로"가 닫기 제스처가 아니라 그냥 튕김으로 새어나간다.

const SHEET_SELECTOR = ".scr-modal, .scr-rivalry-overlay-body";
const OVERLAY_SELECTOR = ".scr-modal-overlay, .scr-rivalry-overlay";
// 손가락 이동 대비 시트 이동 저항(1이면 1:1). 살짝 무겁게 끌리는 느낌.
const DAMP = 0.6;
// 이만큼(시트 실제 이동 px) 이상 내려가고 손을 떼면 닫는다.
const CLOSE_THRESHOLD = 88;
// 방향 판정 전 무시할 작은 흔들림(px).
const DECIDE_AT = 5;

// 터치 지점에서 위로 올라가며 실제로 스크롤되는(overflow-y auto/scroll) 가장 가까운
// 조상을 찾는다 — 이 컨테이너의 scrollTop이 0(최상단)일 때만 닫기 드래그로 본다.
function findScroller(from: Element | null, stopAt: Element): HTMLElement | null {
  let el: Element | null = from;
  while (el && el !== document.body) {
    if (el instanceof HTMLElement) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === "auto" || oy === "scroll") return el;
    }
    if (el === stopAt) break;
    el = el.parentElement;
  }
  return null;
}

// 실제 닫기 — 모달이 이미 가진 닫기 버튼을 누른다(각자의 onClose 로직/애니메이션을 그대로
// 태운다). 없으면 배경(오버레이) 클릭/ESC로 폴백.
function invokeClose(sheet: HTMLElement) {
  const btn = sheet.querySelector<HTMLElement>('[aria-label="닫기"]');
  if (btn) { btn.click(); return; }
  const overlay = sheet.closest<HTMLElement>(OVERLAY_SELECTOR);
  if (overlay) overlay.click();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

function clearSheetStyles(sheet: HTMLElement) {
  sheet.style.transition = "";
  sheet.style.translate = "";
  sheet.style.willChange = "";
}

export function useModalDragDismiss(): void {
  useEffect(() => {
    let sheet: HTMLElement | null = null;
    let scroller: HTMLElement | null = null;
    let startY = 0;
    let startX = 0;
    let sheetShift = 0; // 시트 실제 이동량(저항 적용 후)
    let mode: "idle" | "undecided" | "drag" | "scroll" = "idle";

    const reset = () => { sheet = null; scroller = null; mode = "idle"; sheetShift = 0; };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { reset(); return; }
      const target = e.target as HTMLElement | null;
      const s = target?.closest<HTMLElement>(SHEET_SELECTOR) ?? null;
      if (!s) { mode = "idle"; return; }
      sheet = s;
      scroller = findScroller(target, s);
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      sheetShift = 0;
      mode = "undecided";
    };

    const onMove = (e: TouchEvent) => {
      if (mode === "idle" || mode === "scroll" || !sheet) return;
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;

      if (mode === "undecided") {
        if (Math.abs(dy) < DECIDE_AT && Math.abs(dx) < DECIDE_AT) return;
        const atTop = !scroller || scroller.scrollTop <= 0;
        // 최상단에서 세로 아래 방향으로 움직일 때만 닫기 드래그로 확정한다.
        if (dy > 0 && atTop && Math.abs(dy) >= Math.abs(dx)) {
          mode = "drag";
          sheet.style.transition = "none";
          sheet.style.willChange = "translate";
        } else {
          mode = "scroll"; // 평범한 스크롤/가로 스와이프 — 우리 개입 없음
          return;
        }
      }

      if (mode === "drag") {
        // 끄는 동안은 기본 동작(고무줄 리바운드/스크롤)을 막고 우리가 시트를 끈다(요청).
        e.preventDefault();
        sheetShift = Math.max(0, dy) * DAMP;
        // transform이 아니라 개별 translate 속성을 쓴다 — .scr-modal은 가운데 정렬을
        // transform: translate(-50%,-50%)로 하는데, transform을 덮으면 정렬이 깨진다.
        // 개별 translate는 그 transform과 합성되므로 정렬을 지키며 아래로만 민다.
        sheet.style.translate = `0 ${sheetShift}px`;
      }
    };

    const onEnd = () => {
      if (mode === "drag" && sheet) {
        const s = sheet;
        if (sheetShift >= CLOSE_THRESHOLD) {
          // 문턱 넘김 — 아래로 슬라이드아웃 후 실제 닫기(개별 translate로, 110%=자기 높이).
          s.style.transition = "translate .2s ease";
          s.style.translate = "0 110%";
          window.setTimeout(() => { invokeClose(s); clearSheetStyles(s); }, 190);
        } else {
          // 스냅백.
          s.style.transition = "translate .24s cubic-bezier(0.32, 0.72, 0, 1)";
          s.style.translate = "0 0";
          const clear = () => { clearSheetStyles(s); s.removeEventListener("transitionend", clear); };
          s.addEventListener("transitionend", clear);
        }
      }
      reset();
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, []);
}
