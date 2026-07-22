import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { cx } from "../utils/format";
import { attachPopover } from "../utils/popover";
import type { ScreenKey } from "../types";

interface AdminMenuProps {
  screen: ScreenKey;
  onNavigate: (screen: ScreenKey) => void;
  // nav: 데스크톱 상단 네비 탭 스타일 · drawer: 모바일 드로어 세로 목록 스타일 ·
  // mobile: 하단 탭바 아이콘 스타일
  variant: "nav" | "drawer" | "mobile";
  // 드로어(아코디언)에서만 쓰는 제어 상태 — 부모(Header)가 이 상태를 관리해서 넘겨준다.
  // 안 넘기면 내부 상태를 그대로 쓴다.
  drawerOpen?: boolean;
  onDrawerToggle?: () => void;
  // mobile 변형에서만 — 이 열림 상태 자체는 여기서 그대로 내부 관리하지만(제어권은 안
  // 넘김), 부모(MobileTabBar)가 슬라이딩 알약 인디케이터를 다시 계산하려면 "언제 바뀌는지"는
  // 알아야 한다(그 상태가 이 컴포넌트 내부에만 있어 props로는 안 보였다 — 실제로 지적받은
  // 문제: 운영 드롭다운이 열려 있는 동안 알약이 따라오지 않음). 값 자체가 아니라 변화
  // 알림만 위로 올려보낸다.
  onOpenChange?: (open: boolean) => void;
}

interface AdminItem {
  key: string;
  label: string;
  isActive: boolean;
  onSelect: () => void;
}

// 운영자 전용 화면(회원 화면/이미지 설정/유저연결)을 낱개 탭으로 늘어놓는 대신 "운영"
// 드롭다운 하나로 묶는다 — 이 컴포넌트는 호출부(Header)가 이미 운영자에게만 렌더링하므로
// 역할/권한 체크 없이 항상 전체 항목을 보여준다. 위치 계산은 커스텀 셀렉트(Select.tsx)와
// 동일하게 attachPopover를 재사용 — 하단 탭바에 놓였을 때도 아래쪽 공간이 부족하면 자동으로
// 위로 뒤집어 열린다.
export default function AdminMenu({ screen, onNavigate, variant, drawerOpen, onDrawerToggle, onOpenChange }: AdminMenuProps) {
  const items: AdminItem[] = [
    { key: "members", label: "회원", isActive: screen === "members", onSelect: () => onNavigate("members") },
    { key: "imageSettings", label: "이미지 설정", isActive: screen === "imageSettings", onSelect: () => onNavigate("imageSettings") },
    { key: "gameId", label: "게임아이디", isActive: screen === "gameId", onSelect: () => onNavigate("gameId") },
    { key: "leagues", label: "리그", isActive: screen === "leagues", onSelect: () => onNavigate("leagues") },
    { key: "rivalry", label: "상성맵", isActive: screen === "rivalry", onSelect: () => onNavigate("rivalry") },
  ];
  const activeInAdmin = items.some((i) => i.isActive);
  // 햄버거 드로어는 열 때마다 새로 마운트되므로(Header가 menuOpen일 때만 렌더), 지금 보고
  // 있는 화면이 운영 화면이면 드로어 안 드롭다운은 처음부터 펼쳐진 채로 보여준다.
  const [internalOpen, setInternalOpen] = useState(() => variant === "drawer" && activeInAdmin);
  const open = variant === "drawer" && drawerOpen !== undefined ? drawerOpen : internalOpen;
  const toggleOpen = () => {
    if (variant === "drawer" && onDrawerToggle) onDrawerToggle();
    else setInternalOpen((v) => !v);
  };
  const setOpen = setInternalOpen;
  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);
  // 트리거 버튼에 직접 앵커를 건다 — 감싸는 바깥 div는 display:contents라 레이아웃 박스가
  // 없어서(getBoundingClientRect가 0크기를 반환) 거기에 걸면 팝오버 위치가 엉뚱한 곳(주로
  // 뷰포트 좌상단)으로 계산됐다.
  const anchorRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // 드로어(햄버거 메뉴) 안에서는 이 서브메뉴가 굳이 화면 위에 붕 뜬 팝오버일 필요가 없다 —
  // 드로어 자체가 이미 세로 목록이라, 그냥 그 자리에서 펼쳐지는 아코디언으로 두면 위치 계산도
  // 필요 없고 "떠서 움직이는" 어색함도 없다. nav/mobile 변형만 실제로 다른 요소 위로 떠야
  // 해서 계속 포털+Floating UI를 쓴다.
  // useLayoutEffect(페인트 전)로 위치를 잡아 드롭다운이 즉시 제자리에 뜨게 한다(요청).
  useLayoutEffect(() => {
    if (variant === "drawer" || !open || !anchorRef.current || !dropRef.current) return;
    return attachPopover(anchorRef.current, dropRef.current, { growToContent: true, maxWidth: 200 });
  }, [open, variant]);

  // mousedown이 아니라 pointerdown으로 바깥 클릭을 잡는다 — 터치에서 mousedown은
  // touchend 이후에야(그것도 스크롤/제스처 없이 탭했을 때만) 뒤늦게 합성되는 호환 이벤트라,
  // 다른 탭 버튼이 자기 pointerdown 시점에 바로 화면을 전환해버리면(MobileTabBar 참고 —
  // 같은 이유로 이미 click 대신 pointerdown을 쓴다) 이 드롭다운은 그보다 한참 늦게(또는
  // 아예 안) 닫혔다(실제로 지적받은 문제 — "운영 드롭다운 켠 채 다른 메뉴 터치시 안 닫힘").
  useEffect(() => {
    if (variant === "drawer" || !open) return;
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (dropRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open, variant]);

  // 마우스 클릭(mousedown) 말고도 키보드 Tab이나 다른 UI로 포커스가 바깥으로 옮겨가는
  // 경우도 바로 닫혀야 한다(실제로 지적받은 문제 — 포커스를 잃어도 드롭다운이 계속
  // 떠있었음). focusin은 포커스가 어디로 이동하든 즉시 발생하므로 mousedown보다 더
  // 포괄적으로 잡는다.
  useEffect(() => {
    if (variant === "drawer" || !open) return;
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (dropRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [open, variant]);

  // 메뉴(드롭다운 트리거/옵션)에서는 아이콘을 전부 뺀다 — 텍스트만으로 충분하고, 아이콘
  // 있는 곳/없는 곳이 섞여 있었다는 피드백. 하단 탭바(mobile)도 이제 텍스트만 쓴다(전체
  // 탭바에서 아이콘을 없애 달라는 요청).
  const optionButtons = items.map((item) => (
    <button
      type="button"
      key={item.key}
      className={cx("scr-menu-pop-opt", item.isActive && "scr-menu-pop-opt-active")}
      onClick={() => { item.onSelect(); setOpen(false); }}
    >
      <span className="scr-menu-pop-opt-label">{item.label}</span>
    </button>
  ));

  if (variant === "drawer") {
    return (
      <div className="scr-menu-pop scr-menu-pop-drawer">
        {/* "운영" 자체는 화면이 아니라 카테고리 이름이라, 그 안의 회원/이미지 설정 중
            하나가 활성이어도 이 트리거는 반전 효과를 받지 않는다 — 실제 활성 표시는
            펼쳐진 하위 항목(scr-menu-pop-opt-active) 쪽에서만 보여준다. */}
        <button type="button" className="scr-nav-tab" onClick={toggleOpen}>
          <span>운영</span>
          <ChevronDown size={12} className={cx("scr-menu-pop-caret", open && "scr-menu-pop-caret-open")} />
        </button>
        {open && <div className="scr-menu-pop-drop-inline">{optionButtons}</div>}
      </div>
    );
  }

  // 데스크톱 상단 드롭다운은 "눌린" 상태도 활성 표시로 보여준다 — 눌러도 아무 반응이
  // 없어 보인다는 피드백. 모바일 하단 탭바는 다르다: 이 클래스가 슬라이딩 알약
  // (.scr-mobile-tab-indicator)이 따라붙는 기준이기도 해서, open만으로 켜버리면 아직
  // 실제로 운영 화면으로 넘어가지 않았는데도(그냥 펼쳐만 본 것) 알약이 운영 쪽으로
  // 옮겨가 버렸다(실제로 지적받은 문제 — "운영 드롭다운 열었다고 운영이 액티브탭은
  // 아닌데 알약이 거기로 가네"). 모바일에서는 실제 화면 기준(activeInAdmin)일 때만
  // 활성 표시를 준다.
  const triggerClass = variant === "mobile"
    ? cx("scr-mobile-tab", activeInAdmin && "scr-mobile-tab-active")
    : cx("scr-nav-tab", (open || activeInAdmin) && "scr-nav-tab-active");

  return (
    <div className={cx("scr-menu-pop", `scr-menu-pop-${variant}`)}>
      <button type="button" className={triggerClass} ref={anchorRef} onClick={() => setOpen((v) => !v)}>
        <span>운영</span>
        {variant !== "mobile" && <ChevronDown size={14} className={cx("scr-menu-pop-caret", open && "scr-menu-pop-caret-open")} />}
      </button>

      {open && createPortal(
        <div
          className={cx("scr-menu-pop-drop scr-scroll", variant === "mobile" && "scr-menu-pop-drop-mobile")}
          ref={dropRef}
        >
          {optionButtons}
        </div>,
        document.body,
      )}
    </div>
  );
}
