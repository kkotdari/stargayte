import { useEffect } from "react";
import { getScrollRoot } from "./scrollRoot";

// 모듈 스코프 카운터 — 모달이 여러 개 겹쳐 떠도(예: 등록 모달 위에 확인 다이얼로그) 마지막
// 하나가 닫힐 때만 실제로 스크롤을 풀어준다. 단일 SPA 탭 기준이라 모듈 전역 상태로 충분하다.
let lockCount = 0;
// 잠글 때 실제로 건드린 엘리먼트를 기억해뒀다가 풀 때 그대로 재사용한다 — 잠근 채로
// #scroll-root가 통째로 사라지는(예: 모달이 떠 있는 동안 로그아웃) 극단적인 경우에도
// unlock이 그 사이 새로 계산한 다른 엘리먼트를 잘못 건드리지 않게.
let lockedEl: HTMLElement | null = null;

// 앱 셀 마이그레이션 이후 html/body는 항상 overflow:hidden이라(global.css) 더 이상 잠글
// 대상이 아니다 — 실제로 스크롤되는 건 #scroll-root 하나뿐이라 그것만 잠그면 된다.
// (예전엔 body 자체를 position:fixed로 고정했다 되돌리는 방식이라 스크롤 위치를
// 저장/복원해야 했는데, 그 방식 자체가 웹뷰에서 탭바/모달이 밀렸다 자리잡는 문제를
// 일으켜 overflow:hidden 토글로 이미 바꿔뒀었다 — 여기서는 그 토글 대상만 옮긴다.)
function lockBodyScroll() {
  if (lockCount === 0) {
    const root = getScrollRoot();
    lockedEl = root instanceof Window ? document.body : root;
    lockedEl.style.overflow = "hidden";
  }
  lockCount++;
}

function unlockBodyScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0 && lockedEl) {
    lockedEl.style.overflow = "";
    lockedEl = null;
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
