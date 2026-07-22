import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Menu as MenuIcon } from "lucide-react";
import { cx } from "../utils/format";
import { visibleNavMenuItems } from "../constants/menuVersions";
import { smoothScrollRootToTop } from "../utils/scrollRoot";
import { cancelKeyboardScrollRestore } from "../hooks/useRestoreScrollOnKeyboardClose";
import type { ScreenKey } from "../types";

interface MobileTabBarProps {
  screen: ScreenKey;
  menuOpen: boolean;
  // 지금 실제로 보여줄 버전(미리보기 중이면 미리보기 버전) — 이 숫자로 메뉴 배열
  // (constants/menuVersions.ts)을 걸러 노출 여부/순서를 정한다.
  effectiveVersionNumber: number;
  hidden: boolean;
  // 아래로 스크롤 중 — 완전 숨김 대신 60% 축소(요청).
  mini: boolean;
  onNavigate: (screen: ScreenKey) => void;
  onOpenMenu: () => void;
}

// 모바일 전용 하단 탭바 — 자주 쓰는 화면들(랭킹/일정/경기결과/전적통계)을 바로 노출하고,
// 내 정보/로그아웃처럼 자주 안 쓰는 항목은 "메뉴"(햄버거)로 묶어 기존 우측 슬라이드
// 드로어를 연다. 운영자 전용 화면은 탭바에 안 둔다(요청: 모바일에선 서랍에서만) —
// 서랍(햄버거)의 "운영" 아코디언으로만 접근하고, 운영 화면을 보는 동안 탭바엔 활성
// 탭이 없어 물방울 인디케이터도 숨는다(measure()가 active 없음 → null).
// .scr-header가 backdrop-filter로 새 컨테이닝 블록을 만들어서 그 안의 position:fixed가
// 화면 전체가 아니라 헤더 영역 기준으로 잡히므로, 헤더 바깥(App.tsx의 #scr-tabbar-slot)
// 으로 포털링한다 — #scr-app에 직접 포털링하면 React가 포털을 항상 "마지막 자식"으로
// 붙여준다고 가정하기 쉬운데, 실제로는 파이버 트리 형태에 따라 삽입 위치가 달라질 수
// 있다(실제로 겪은 버그 — App.tsx 참고). #scroll-root 바로 다음이라는 확실한 자리를
// App.tsx가 미리 마련해둔 빈 슬롯에 붙인다.
// 아이콘 없이 텍스트만 있는 탭바가 밋밋해 보인다는 피드백 — 인스타그램 탭처럼 활성 탭
// 아래(여기선 탭바 위쪽 가장자리)로 슬라이드하며 이동하는 밑줄 인디케이터를 추가한다.
// 탭마다 폭이 달라도(글자 수가 다름) 항상 맞도록, 하드코딩된 순서/폭 대신 실제 DOM에서
// ".scr-mobile-tab-active"(운영 드롭다운 트리거도 활성일 때 이 클래스를 그대로 받는다)를
// 찾아 그 위치/폭을 그대로 옮겨 붙인다 — 탭 구성이 조건부(운영자 전용/일정 기능 플래그)로
// 바뀌어도 따로 손볼 필요가 없다.
// 알약 세로 인셋(버튼 높이에서 위아래로 이만큼씩 줄인다) — 음수면 버튼보다 더 크게 그린다.
// 납작한 알약처럼 안 보이고 물방울에 가깝게 보이려면 세로로 더 키워야 해서 음수로 둔다(요청).
// 한때 -6까지 키웠지만(세로 길게 요청), 루페 스타일로 바꾼 뒤엔 너무 동그래서 렌즈처럼
// 보였다(지적) — 다시 -3으로 되돌려 납작하고 넓적한 루페 모양으로 둔다.
const INDICATOR_VERTICAL_INSET = -3;
// 알약을 버튼 자신의 폭보다 좌우로 이만큼씩 더 넓게 그린다 — 텍스트에 좌우 패딩이
// 거의 없어서(탭이 많아진 뒤로 줄바꿈 방지 차 없앴다), 버튼 폭에 딱 맞추면 "게임아이디"
// 같은 긴 라벨이 알약 가장자리에 바짝 붙어 보였다. 전체적인 크기감을 키워달라는 요청으로
// 살짝 더 늘렸다.
// 세로를 키운 것과 함께, 가로로만 길쭉해 보이지 않게 좌우 여유는 줄인다(요청: "너무
// 옆으로 긴 모양이 아니게" — 라벨이 문자열이라 가로가 원래 길다). 13 → 8.
const INDICATOR_HORIZONTAL_PAD = 8;

function useActiveTabIndicator(navRef: { current: HTMLElement | null }, deps: unknown[]) {
  const [indicator, setIndicator] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  // top/height도 CSS의 top:50%(부모 nav 전체 높이 기준 중앙)에 맡기지 않고 버튼 자신의
  // offsetTop/offsetHeight로 직접 계산한다 — nav 자신은 하단 안전영역(홈 인디케이터)
  // 만큼의 padding-bottom을 갖고 있어서, "부모 기준 50%"로 중앙을 잡으면 그 패딩까지
  // 포함한 전체 높이의 중앙이 되어 버튼 행보다 한참 아래로 처져 보였다(실제로 iOS
  // 홈 화면 웹앱에서 안전영역이 실제로 반영되면서 발견된 문제).
  const measure = () => {
    // "운영"/"메뉴" 드롭다운을 열어도 지금 화면(screen) 자체는 안 바뀌니, 그 화면에
    // 해당하는 일반 탭도 여전히 .scr-mobile-tab-active를 그대로 달고 있다 — 즉 열려
    // 있는 동안은 활성 클래스가 두 곳(원래 탭 + 운영/메뉴 트리거)에 동시에 붙는다.
    // querySelector(첫 번째 일치)는 DOM에서 더 먼저 나오는 일반 탭을 찾아버려서 알약이
    // "운영"으로 안 움직였다(실제로 지적받은 문제) — 일반 탭보다 뒤에 렌더되는
    // 운영/메뉴 트리거가 우선하도록 "마지막 일치"를 쓴다.
    const matches = navRef.current?.querySelectorAll<HTMLElement>(".scr-mobile-tab-active");
    const active = matches && matches.length > 0 ? matches[matches.length - 1] : null;
    if (!active) { setIndicator(null); return; }
    // 탭은 전부 flex:1로 폭이 균등하니(글자 수와 무관), 버튼 자신의 offsetWidth를 그대로
    // 쓰면 "기록"처럼 짧은 라벨도 "게임아이디"와 똑같이 넓은 알약을 두르게 된다 —
    // 실제 글자(span) 폭을 재서 그 글자 수만큼만 알약이 좁아지고 넓어지게 한다. 버튼이
    // 세로 flex로 글자를 가운데 정렬하니, 글자의 진짜 왼쪽 위치는 "버튼 왼쪽 +
    // (버튼 폭 - 글자 폭)/2"로 계산한다.
    const label = active.querySelector<HTMLElement>("span");
    const labelWidth = label?.offsetWidth ?? active.offsetWidth;
    const labelLeft = active.offsetLeft + (active.offsetWidth - labelWidth) / 2;
    setIndicator({
      left: labelLeft - INDICATOR_HORIZONTAL_PAD,
      width: labelWidth + INDICATOR_HORIZONTAL_PAD * 2,
      top: active.offsetTop + INDICATOR_VERTICAL_INSET,
      height: active.offsetHeight - INDICATOR_VERTICAL_INSET * 2,
    });
  };

  useLayoutEffect(() => {
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    window.addEventListener("resize", measure);
    // 한글 커스텀 폰트가 이 시점에 아직 로딩 중이면(특히 첫 렌더), 버튼 글자가
    // 폴백 폰트 기준 폭으로 측정된다 — 폰트가 실제로 적용되면 글자 폭이 달라지면서
    // 텍스트는 새 폭에 맞게 다시 그려지지만, 알약은 리사이즈/딥스 변화가 없으면
    // 다시 측정되지 않아 옛 폭 기준 위치에 그대로 남아 글자와 어긋나 보인다.
    document.fonts?.ready.then(measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navRef]);

  useEffect(() => {
    const root = navRef.current;
    if (!root) return;
    // "운영" 드롭다운은 자기 열림/닫힘 상태를 AdminMenu 내부에서만 들고 있어서
    // (props로 안 넘어옴), 그게 바뀌어 .scr-mobile-tab-active 클래스가 옮겨 붙어도
    // 위 deps([screen, menuOpen, ...])만으로는 이 인디케이터가 다시 계산되지 않았다
    // (실제로 지적받은 문제 — 하위 메뉴가 열려 있는 동안 알약이 안 따라옴). deps에
    // 굳이 그 내부 상태를 끌어올려 전달하는 대신, 클래스 변화 자체를 직접 감시한다.
    const observer = new MutationObserver(measure);
    observer.observe(root, { attributes: true, attributeFilter: ["class"], subtree: true });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navRef]);

  return indicator;
}

export default function MobileTabBar({ screen, menuOpen, effectiveVersionNumber, hidden, mini, onNavigate, onOpenMenu }: MobileTabBarProps) {
  const navRef = useRef<HTMLElement>(null);
  const visibleItems = visibleNavMenuItems(effectiveVersionNumber);

  // 탭 동작을 click이 아니라 pointerdown 시점에 실행한다 — 검색창에 키보드가 뜬 채로
  // 탭을 누르면 blur → 키보드 닫힘 → 뷰포트 리사이즈로 탭바 자신이 움직여, 브라우저가
  // click 이벤트를 아예 발생시키지 않는 경우가 있었다(실제로 지적받은 문제 — "필터창
  // 검색창 열린상태에서 탭바 버튼 클릭시 닫힘+메뉴이동"이 첫 탭에 안 됨). pointerdown은
  // 그 어떤 레이아웃 변화보다 먼저 발생하므로 첫 탭에 항상 동작한다. 같은 탭이면 맨
  // 위로 — 네이티브 smooth(iOS 관성 스크롤과 겹치면 무시됨, "바로 안됨" 문제)도
  // instant(순간이동이라 어지러움, 요청: "스크롤탑시 좀 부드럽게 올라가기")도 아닌,
  // rAF로 직접 굴리는 짧은 감속 애니메이션을 쓴다(smoothScrollRootToTop). 어느 쪽이든
  // 실행 전에 키보드 닫힘 복원(useRestoreScrollOnKeyboardClose)을 취소한다 — 안 그러면
  // 150ms 뒤 복원이 방금 옮긴 스크롤을 이전 위치로 도로 되돌려버린다.
  const activate = (key: ScreenKey) => {
    cancelKeyboardScrollRestore();
    if (screen === key) smoothScrollRootToTop();
    else onNavigate(key);
  };
  // pointerdown으로 이미 처리한 탭이 만들어내는 후속 click은 무시한다 — click 경로는
  // 키보드(Enter/Space)나 pointer 이벤트가 없는 환경의 접근성용으로만 남긴다.
  const pointerHandledRef = useRef(false);
  const onTabPointerDown = (e: React.PointerEvent, run: () => void) => {
    // 마우스 오른쪽/가운데 버튼은 무시 — 탭 활성화가 아니라 컨텍스트 메뉴 등의 몫이다.
    if (e.button !== 0) return;
    pointerHandledRef.current = true;
    run();
  };
  const onTabClick = (run: () => void) => {
    if (pointerHandledRef.current) { pointerHandledRef.current = false; return; }
    run();
  };
  const indicator = useActiveTabIndicator(navRef, [screen, menuOpen, effectiveVersionNumber]);

  return createPortal(
    <nav
      ref={navRef}
      className={cx("scr-mobile-tabbar", hidden && "scr-mobile-tabbar-hidden", !hidden && mini && "scr-mobile-tabbar-mini")}
      aria-label="하단 메뉴"
    >
      {indicator && (
        <span
          // 루페 물방울(scr-mobile-tab-indicator)은 테스트로 CSS만 남기고, 실사용은
          // 은은한 우주 라이팅(다크 흰빛/라이트 블루)으로(요청).
          className="scr-mobile-tab-glow"
          style={{
            transform: `translateX(${indicator.left}px)`,
            width: indicator.width, top: indicator.top, height: indicator.height,
          }}
        />
      )}
      {visibleItems.map((item) => (
        <button
          key={item.key}
          type="button"
          className={cx("scr-mobile-tab", screen === item.key && "scr-mobile-tab-active")}
          // 이미 보고 있는 탭을 다시 누르면(같은 화면이라 navigate()가 아무 효과가
          // 없으므로) 맨 위로 이동 버튼 대신 이걸로 스크롤을 맨 위로 올린다 — 실제
          // 동작은 activate()가 pointerdown 시점에 처리한다(위 주석 참고).
          onPointerDown={(e) => onTabPointerDown(e, () => activate(item.key))}
          onClick={() => onTabClick(() => activate(item.key))}
        >
          <span>{item.label}</span>
        </button>
      ))}
      {/* 메뉴 탭은 글자 대신 햄버거 아이콘으로(요청). 드로어가 열려도 활성 클래스
          (.scr-mobile-tab-active)를 달지 않는다 — 물방울 인디케이터가 이 탭으로는
          이동하지 않고(요청: 열려도 물방울 적용 X) 지금 화면 탭에 그대로 남는다. */}
      <button
        type="button"
        className="scr-mobile-tab scr-mobile-tab-menu"
        onPointerDown={(e) => onTabPointerDown(e, onOpenMenu)}
        onClick={() => onTabClick(onOpenMenu)}
        aria-label="메뉴 열기"
        aria-expanded={menuOpen}
      >
        <MenuIcon size={19} aria-hidden />
      </button>
    </nav>,
    document.getElementById("scr-tabbar-slot") ?? document.body,
  );
}
