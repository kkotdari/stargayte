import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import NavTab from "./NavTab";
import AdminMenu from "./AdminMenu";
import MobileTabBar from "./MobileTabBar";
import Avatar from "../components/common/Avatar";
import InstallGuideModal from "../components/common/InstallGuideModal";
import { usePwaInstall } from "../hooks/usePwaInstall";
import { cx } from "../utils/format";
import { attachPopover } from "../utils/popover";
import { useIsNarrow } from "../utils/useIsNarrow";
import { useHideOnScrollDown } from "../hooks/useHideOnScrollDown";
import { useKeyboardInset } from "../hooks/useKeyboardInset";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { useAppStore } from "../store/appStore";
import { isAdminRole } from "../constants/roles";
import { useLightTheme } from "../utils/theme";
import { versionNumber } from "../utils/appVersion";
import { visibleNavMenuItems } from "../constants/menuVersions";
import type { Member, ScreenKey } from "../types";

interface HeaderProps {
  user: Member;
  screen: ScreenKey;
  onNavigate: (screen: ScreenKey) => void;
  onOpenProfile: () => void;
  onLogout: () => void;
}

export default function Header({
  user, screen, onNavigate, onOpenProfile, onLogout,
}: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  // 운영자가 "이미지 설정"에서 텍스트 대신 이미지로 바꿔둔 경우 그 이미지를, 아니면
  // 기본 텍스트를 그대로 보여준다 (Avatar 컴포넌트의 사진/이니셜 대체 패턴과 동일).
  // 라이트 테마는 배경이 흰색으로 바뀌어 어두운 배경을 전제로 만든 로고가 잘 안 보일 수
  // 있으므로, 완전히 별도로 등록된 home_logo_light를 대신 쓴다(아래 lightTheme 참고).
  const homeLogoDark = useAppStore((s) => s.imageSettings.home_logo);
  const homeLogoLight = useAppStore((s) => s.imageSettings.home_logo_light);
  const booting = useAppStore((s) => s.booting);
  const registerSecretTap = useAppStore((s) => s.registerSecretTap);
  const appVersion = useAppStore((s) => s.appVersion);
  const effectiveVersionNumber = versionNumber(appVersion);
  const isAdmin = isAdminRole(user.roles);
  const scrollHidden = useHideOnScrollDown(screen);
  // 키보드가 뜨면 탭바를 자동으로 숨긴다(요청: "키보드 활성화시 자동으로 탭바 숨기기") —
  // 스크롤 방향과 무관한 별도 신호라 OR로 합친다(둘 중 하나라도 숨김 조건이면 숨김).
  const keyboardInset = useKeyboardInset();
  const tabBarHidden = scrollHidden || keyboardInset > 0;

  // 라이트 테마 — 흰 배경 + 검은 글씨 기조로 바꾸는 토글(발표/인쇄 등에서 색상 없이 보고
  // 싶을 때). 로그인 화면(AuthScreen)에도 같은 토글이 따로 있어 로그인 전에도 켤 수
  // 있다 — 저장/적용 로직은 utils/theme.ts에 공유돼 있다. 예전엔 역할별로 허용 여부를
  // 따로 관리했지만 이제 누구나 쓸 수 있다.
  const [lightTheme, setLightTheme] = useLightTheme();
  const homeLogo = lightTheme ? homeLogoLight : homeLogoDark;

  // 서랍 메뉴의 "홈 화면에 추가" — 안드로이드는 네이티브 설치 창, iOS는 안내 모달을 연다.
  // 이미 설치(standalone)면 canInstall=false라 항목 자체가 안 뜬다.
  const { canInstall, promptInstall } = usePwaInstall();
  const [installGuideOpen, setInstallGuideOpen] = useState(false);
  const onInstallClick = async () => {
    const r = await promptInstall();
    if (r === "ios") setInstallGuideOpen(true);
    else setMenuOpen(false);
  };

  // 드로어를 열 때뿐 아니라 "닫힐 때"도 슬라이드 아웃 트랜지션이 끝까지 재생되도록,
  // menuOpen이 false가 된 뒤에도 트랜지션 시간(.2s) 동안은 DOM에 그대로 남겨둔다 —
  // {menuOpen && ...}로 바로 언마운트하면 닫힐 때만 애니메이션 없이 순간 사라져 버렸다.
  const [drawerRendered, setDrawerRendered] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    if (menuOpen) {
      setDrawerRendered(true);
      const raf = requestAnimationFrame(() => setDrawerOpen(true));
      return () => cancelAnimationFrame(raf);
    }
    setDrawerOpen(false);
    const t = setTimeout(() => setDrawerRendered(false), 220);
    return () => clearTimeout(t);
  }, [menuOpen]);

  // 서랍을 오른쪽으로 밀어서(패널이 오른쪽에서 열리므로 닫히는 방향) 닫을 수 있게(요청:
  // "서랍메뉴 슬라이드로 닫기 가능하게"). 패널 폭의 일정 비율 이상 밀었을 때만 닫힘으로
  // 판정하고, 그 전까지는 손가락을 따라 패널을 직접 옮겨 즉각적인 드래그 반응을 준다.
  // 가로 이동이 세로보다 뚜렷하게 커야 드래그로 확정한다 — 안 그러면 드로어 안의 세로
  // 스크롤(예: 관리자 아코디언이 길어질 때)과 스와이프가 서로 헷갈렸다.
  const drawerPanelRef = useRef<HTMLDivElement>(null);
  const drawerDragRef = useRef<{ startX: number; startY: number; dragging: boolean } | null>(null);
  const DRAWER_CLOSE_RATIO = 0.35;
  const onDrawerPointerDown = (e: React.PointerEvent) => {
    drawerDragRef.current = { startX: e.clientX, startY: e.clientY, dragging: false };
  };
  const onDrawerPointerMove = (e: React.PointerEvent) => {
    const st = drawerDragRef.current;
    if (!st) return;
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    if (!st.dragging) {
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      st.dragging = true;
      drawerPanelRef.current?.setPointerCapture?.(e.pointerId);
    }
    if (dx <= 0) return; // 닫는 방향(오른쪽)으로만 손가락을 따라간다.
    const panel = drawerPanelRef.current;
    if (!panel) return;
    panel.style.transition = "none";
    panel.style.transform = `translateX(${dx}px)`;
  };
  const onDrawerPointerEnd = (e: React.PointerEvent) => {
    const st = drawerDragRef.current;
    drawerDragRef.current = null;
    const panel = drawerPanelRef.current;
    if (!st?.dragging || !panel) return;
    const dx = e.clientX - st.startX;
    const width = panel.getBoundingClientRect().width;
    panel.style.transition = "";
    panel.style.transform = "";
    if (dx > width * DRAWER_CLOSE_RATIO) setMenuOpen(false);
  };

  // 드로어 안의 대카테고리(관리자) 아코디언 — 드로어를 열 때마다 지금 보고 있는 화면
  // 기준으로 미리 펼쳐둔다.
  const [drawerSection, setDrawerSection] = useState<"admin" | null>(null);
  useEffect(() => {
    if (!drawerRendered) return;
    if (["members", "imageSettings", "gameId"].includes(screen)) setDrawerSection("admin");
    else setDrawerSection(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 드로어가 열리는 순간에만 초기화, 그 뒤 screen이 바뀌어도 유저가 직접 연 상태를 건드리지 않는다
  }, [drawerRendered]);

  // 메뉴 열렸을 때 뒤 스크롤 잠금 — 모달들과 같은 공유 카운터를 쓴다 (드로어가 열린 채
  // 모달도 함께 뜨는 경우에도 한쪽이 먼저 닫혀서 스크롤이 풀려버리지 않도록). 닫히는
  // 트랜지션이 재생되는 동안도 잠가둔다(drawerRendered 기준).
  useLockBodyScroll(drawerRendered);

  const go = (s: ScreenKey) => { onNavigate(s); setMenuOpen(false); };

  // 프로필 칩을 누르면 곧장 내 정보로 가는 대신 작은 드롭다운(내 정보/로그아웃)을
  // 띄운다(요청: "프로필 클릭시 드롭다운") — 그러면서 옆의 로그아웃 아이콘 버튼은
  // 이 드롭다운에 흡수돼 더 이상 필요 없다. AdminMenu의 nav 변형과 같은 패턴(트리거에
  // attachPopover로 위치를 붙이고, 바깥 클릭/포커스 이동 시 닫음)을 그대로 따른다.
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileAnchorRef = useRef<HTMLButtonElement>(null);
  const profileDropRef = useRef<HTMLDivElement>(null);
  // "운영" 드롭다운도 모바일 탭바(variant="mobile")에서는 글자/패딩을 1.2~1.5배 키운
  // 별도 클래스(.scr-menu-pop-drop-mobile)를 쓴다 — 이 프로필 드롭다운은 화면폭과
  // 무관하게 헤더에 항상 하나만 있어서 그 변형을 자동으로 못 받았다(요청: "내정보
  // 로그아웃 드롭다운의 크기를 운영과 똑같이 수정") — 같은 폭 기준으로 직접 판단한다.
  const isNarrowHeader = useIsNarrow(640);
  // useLayoutEffect(페인트 전)로 위치를 잡아 프로필 드롭다운이 즉시 제자리에 뜨게 한다(요청).
  useLayoutEffect(() => {
    if (!profileMenuOpen || !profileAnchorRef.current || !profileDropRef.current) return;
    return attachPopover(profileAnchorRef.current, profileDropRef.current, { growToContent: true, maxWidth: 200 });
  }, [profileMenuOpen]);
  useEffect(() => {
    if (!profileMenuOpen) return;
    const closeIfOutside = (e: Event) => {
      const t = e.target as Node;
      if (profileAnchorRef.current?.contains(t)) return;
      if (profileDropRef.current?.contains(t)) return;
      setProfileMenuOpen(false);
    };
    // 탭바는 탭을 pointerdown에서 처리하는데, 바깥 클릭 닫힘을 mousedown으로 잡으면 터치에서
    // pointerdown발 화면 전환 뒤 mousedown이 눌리지 않아 프로필 드롭다운이 안 닫히는 버그가
    // 있었다(신고) — 탭바와 같은 pointerdown으로 잡아 확실히 닫는다.
    document.addEventListener("pointerdown", closeIfOutside);
    document.addEventListener("focusin", closeIfOutside);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside);
      document.removeEventListener("focusin", closeIfOutside);
    };
  }, [profileMenuOpen]);

  // 버전에 따라 노출/순서가 바뀌는 공통 메뉴 — 구성은 constants/menuVersions.ts의
  // 배열 하나로만 관리한다(버전이 늘어나며 메뉴가 바뀌면 그 배열만 고치면 된다).
  const visibleItems = visibleNavMenuItems(effectiveVersionNumber);
  const commonNavItems = (
    <>
      {visibleItems.map((item) => (
        <NavTab key={item.key} label={item.label} active={screen === item.key} onClick={() => go(item.key)} />
      ))}
    </>
  );

  return (
    <header className="scr-header">
      <div className="scr-header-inner">
        {/* 로고를 짧은 시간 안에 여러 번 누르면 숨겨진 제어판이 뜬다 — 홈 이동과 같은
            버튼에 얹어서 평소 쓰는 사람에겐 그냥 홈 버튼일 뿐이라 눈에 띄지 않는다. */}
        <button
          type="button" className="scr-brand"
          onClick={() => { go("ranking"); registerSecretTap(); }}
          aria-label="홈으로"
        >
          {/* 부트스트랩(imageSettings 조회)이 끝나기 전엔 아무것도 안 보여준다 — 그 전에 기본
              텍스트("스타게이트")부터 그렸다가 실제 값(대개 이미지)으로 바뀌면 눈에 띄게
              깜빡였다. 처음 나타날 때만 살짝 페이드인하고(scr-logo-fadein), 이후 화면
              이동은 이 컴포넌트가 계속 마운트된 채라 다시 그려지거나 다시 깜빡이지 않는다. */}
          {!booting && (
            homeLogo?.type === "image" && homeLogo.value ? (
              <img src={homeLogo.value} alt="스타게이트" className="scr-brand-logo-img scr-logo-fadein" />
            ) : (
              <span className="scr-brand-mark scr-logo-fadein">{homeLogo?.value || "스타게이트"}</span>
            )
          )}
          <span className="scr-brand-text"></span>
        </button>

        {/* 데스크톱 네비게이션 */}
        <nav className="scr-nav scr-nav-desktop">
          {commonNavItems}
          {isAdmin && <AdminMenu screen={screen} onNavigate={go} variant="nav" />}
        </nav>

        <div className="scr-user">
          {/* 앱 설치(홈 화면에 추가) — 데스크톱엔 드로어가 없어 헤더에 텍스트로 노출한다(요청).
              이미 설치(standalone)면 canInstall=false라 안 뜬다. iOS는 안내 모달, 그 외는
              네이티브 설치 창을 연다. */}
          {canInstall && (
            <button type="button" className="scr-header-text-btn" onClick={onInstallClick}>
              앱 설치
            </button>
          )}
          {/* 테마 전환 — 아이콘 대신 텍스트로(요청). 프로필 왼쪽. */}
          <button
            type="button"
            className={cx("scr-header-text-btn", lightTheme && "scr-header-text-btn-active")}
            onClick={() => setLightTheme((v) => !v)}
          >
            테마
          </button>
          <button
            className="scr-user-chip" ref={profileAnchorRef}
            onClick={() => setProfileMenuOpen((v) => !v)}
          >
            <Avatar member={user} size={30} />
            <span className="scr-user-name">{user.nickname}</span>
          </button>
          {profileMenuOpen && createPortal(
            <div
              className={cx("scr-menu-pop-drop scr-scroll", isNarrowHeader && "scr-menu-pop-drop-mobile")}
              ref={profileDropRef}
            >
              <button
                type="button" className="scr-menu-pop-opt"
                onClick={() => { onOpenProfile(); setProfileMenuOpen(false); }}
              >
                <span className="scr-menu-pop-opt-label">내 정보</span>
              </button>
              <button
                type="button" className="scr-menu-pop-opt"
                onClick={() => { onLogout(); setProfileMenuOpen(false); }}
              >
                <span className="scr-menu-pop-opt-label">로그아웃</span>
              </button>
            </div>,
            document.body,
          )}
        </div>
      </div>

      {/* 모바일 드로어 — 헤더의 backdrop-filter 가 position:fixed 자식의 컨테이닝 블록이 되어버려서
          (화면 전체가 아니라 헤더 높이만큼만 덮이는 문제) body 에 포털로 렌더링해 완전히 분리한다 */}
      {drawerRendered && createPortal(
        <div className={cx("scr-drawer-overlay", drawerOpen && "scr-drawer-open")} onClick={() => setMenuOpen(false)}>
          <div
            className="scr-drawer" ref={drawerPanelRef}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={onDrawerPointerDown}
            onPointerMove={onDrawerPointerMove}
            onPointerUp={onDrawerPointerEnd}
            onPointerCancel={onDrawerPointerEnd}
          >
            <div className="scr-drawer-head">
              <span className="scr-brand-mark">전체 메뉴</span>
            </div>

            <div className="scr-drawer-user">
              <Avatar member={user} size={40} />
              <div>
                <div className="scr-drawer-user-name">{user.nickname}</div>
                <div className="scr-drawer-user-tag scr-mono">{user.battletag}</div>
              </div>
            </div>

            <nav className="scr-drawer-nav">
              {commonNavItems}
              {isAdmin && (
                <AdminMenu
                  screen={screen} onNavigate={go} variant="drawer"
                  drawerOpen={drawerSection === "admin"} onDrawerToggle={() => setDrawerSection((s) => (s === "admin" ? null : "admin"))}
                />
              )}
            </nav>

            <div className="scr-drawer-actions">
              <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={() => setLightTheme((v) => !v)}>
                테마 바꾸기
              </button>
              <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={() => { onOpenProfile(); setMenuOpen(false); }}>
                내 정보
              </button>
              <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={() => { onLogout(); setMenuOpen(false); }}>
                로그아웃
              </button>
              {canInstall && (
                <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={onInstallClick}>
                  홈 화면에 추가
                </button>
              )}
              <button className="scr-btn scr-btn-ghost scr-btn-sm" onClick={() => setMenuOpen(false)}>
                메뉴 닫기
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {installGuideOpen && (
        <InstallGuideModal onClose={() => { setInstallGuideOpen(false); setMenuOpen(false); }} />
      )}

      <MobileTabBar
        screen={screen}
        menuOpen={menuOpen}
        isAdmin={isAdmin}
        effectiveVersionNumber={effectiveVersionNumber}
        hidden={tabBarHidden}
        onNavigate={go}
        onOpenMenu={() => setMenuOpen(true)}
      />
    </header>
  );
}
