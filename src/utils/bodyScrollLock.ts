import { useEffect } from "react";

// 모듈 스코프 카운터 — 모달이 여러 개 겹쳐 떠도(예: 등록 모달 위에 확인 다이얼로그) 마지막
// 하나가 닫힐 때만 실제로 스크롤을 풀어준다. 단일 SPA 탭 기준이라 모듈 전역 상태로 충분하다.
let lockCount = 0;
// 잠글 때의 문서 스크롤 위치 — 풀 때 그대로 복원한다.
let savedScrollY = 0;

// 문서 스크롤 전환(사파리 툴바 축소) 이후의 잠금 — overflow:hidden은 iOS 사파리에서
// 문서 스크롤을 확실히 못 막아, 표준 기법(body position:fixed + top 보정)을 쓴다(조사:
// css-tricks/jayfreestone). 고정하는 순간 문서가 0으로 리셋되는 문제를 top:-scrollY로
// 상쇄해 화면이 안 움직이고, 풀 때 저장해둔 위치로 즉시(behavior:instant — html의
// scroll-behavior:smooth가 애니메이션해버리지 않게) 되돌린다.
function lockBodyScroll() {
  if (lockCount === 0) {
    savedScrollY = window.scrollY;
    const b = document.body.style;
    b.position = "fixed";
    b.top = `${-savedScrollY}px`;
    b.left = "0";
    b.right = "0";
    b.width = "100%";
  }
  lockCount++;
}

function unlockBodyScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    const b = document.body.style;
    b.position = "";
    b.top = "";
    b.left = "";
    b.right = "";
    b.width = "";
    window.scrollTo({ top: savedScrollY, behavior: "instant" });
  }
}

// 지금 body 스크롤이 잠겨 있는지(=모달이 하나라도 떠 있는지) 여부. pull-to-refresh 등
// document 레벨 제스처 처리가 모달 위에서는 동작하지 않게 막을 때 쓴다.
export function isBodyScrollLocked(): boolean {
  return lockCount > 0;
}

// 모달이 떠 있는 동안 배경(body)이 스크롤되지 않게 잠근다. active를 false로 주면(예: 조건부로
// 열리는 드로어) 잠그지 않는다 — 항상 마운트된 컴포넌트에서 열림 상태에 따라 켜고 끌 때 쓴다.
export function useLockBodyScroll(active = true): void {
  useEffect(() => {
    if (!active) return;
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, [active]);
}
