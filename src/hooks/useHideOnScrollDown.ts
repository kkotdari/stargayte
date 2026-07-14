import { useEffect, useRef, useState } from "react";
import { addScrollListener, getScrollMetrics } from "../utils/scrollRoot";

// 아래로 스크롤하면 하단 탭바를 숨겨 화면을 넓게 쓰고, 위로 스크롤하거나 목록 끝(맨
// 아래)까지 다다르면 다시 보여준다(요청: "모바일 위로 스크롤시 탭바가 재노출되어야
// 하는데 안 됨" — 원래는 맨 아래 도달 전엔 위로 스크롤해도 계속 숨어있었다). 이 훅은
// 마운트 시점에 존재하는 스크롤 루트에 한 번만 구독한다 — 로그인 후에만 마운트되는
// 컴포넌트(Header)에서 호출하면 #scroll-root가 이미 DOM에 있는 상태로 구독을
// 시작하므로 별도 "shellReady" 신호가 필요 없다.
const HIDE_THRESHOLD = 6;
const EDGE_PX = 10;
// 검색창+필터창 예약분(136px = 62 + 74, .scr-main 패딩 참고)만큼보다 넉넉히 미리
// 복원해야, 실제로 맨 아래에 닿는 순간과 예약 공간이 늘어나는 순간이 겹치지 않는다
// (아래 --mobile-filterstack-reserve-h 주석 참고).
const NEAR_BOTTOM_PX = 240;

export function useHideOnScrollDown(screen: string): boolean {
  const [hidden, setHidden] = useState(false);
  // 맨 아래서 아직 240px 이상 남았을 때만 true — 탭바처럼 숨김 여부에 그대로 안 묶고
  // 별도로 둔다(아래 --mobile-filterstack-reserve-h 주석 참고).
  const [nearBottom, setNearBottom] = useState(true);
  const lastYRef = useRef(0);
  useEffect(() => {
    lastYRef.current = getScrollMetrics().scrollTop;
    const onScroll = () => {
      const { scrollTop: y, clientHeight, scrollHeight } = getScrollMetrics();
      const delta = y - lastYRef.current;
      const atBottom = y + clientHeight >= scrollHeight - EDGE_PX;
      if (atBottom || delta < -HIDE_THRESHOLD) setHidden(false);
      else if (delta > HIDE_THRESHOLD) setHidden(true);
      setNearBottom(scrollHeight - (y + clientHeight) <= NEAR_BOTTOM_PX);
      lastYRef.current = y;
    };
    return addScrollListener(onScroll);
  }, []);

  // App.tsx가 화면 전환 시 이전 스크롤 위치로 코드로 점프시키는데, 그 점프 자체를
  // "아래로 스크롤"로 착각해 순간 숨어버릴 수 있다 — 점프가 끝난 다음 프레임에 기준
  // 위치를 다시 맞추고 강제로 다시 보이게 한다.
  // 이 리셋 자체가 이전 화면의 숨김 상태와 다르면(예: 이전 화면은 스크롤을 내려
  // 숨겨진 채 전환했는데 새 화면은 맨 위라 보임으로 바뀌는 경우) 탭바/필터창이 슬쩍
  // 미끄러져 나타나는 트랜지션이 함께 재생돼 화면 전환 자체가 부자연스러워 보였다
  // (요청: "페이지 이동시... 전환효과가 더 부자연스러운듯. 바로 보이거나 숨겨져야해") —
  // 화면이 바뀌는 그 순간만 트랜지션을 꺼서 상태가 즉시(애니메이션 없이) 바뀌게 하고,
  // 실제 스크롤로 인한 숨김/노출에는 그대로 부드러운 트랜지션을 남겨둔다.
  useEffect(() => {
    document.documentElement.classList.add("scr-screen-switch-jump");
    const raf = requestAnimationFrame(() => {
      lastYRef.current = getScrollMetrics().scrollTop;
      setHidden(false);
      requestAnimationFrame(() => {
        document.documentElement.classList.remove("scr-screen-switch-jump");
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [screen]);

  // 탭바(min-height 애니메이션으로 접힘)가 실제로 접히는 만큼, 그 위에 fixed로 뜬
  // 플로팅 필터/검색창(.scr-filter-float-stack)도 같이 내려와야 하는데, 그 CSS는
  // 탭바가 항상 떠 있다고 가정한 고정값(--mobile-footer-h)만 참조해서 탭바가 숨어도
  // 그 자리에 그대로 남아 있었다(실제로 지적받은 문제 — "탭바 숨겨질때 필터창과
  // 검색창이 아래로 안내려감"). 이 훅이 탭바 숨김 여부의 단일 출처이니, 여기서 바로
  // CSS 변수를 갱신해 SearchFilterBar가 이 훅을 몰라도 따라오게 한다.
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--mobile-tabbar-visible-h", hidden ? "0px" : "var(--mobile-footer-h)",
    );
  }, [hidden]);

  // 헤더/플로팅 필터·검색창(SearchFilterBar)도 탭바와 같은 신호로 같이 숨긴다(요청:
  // "아래로 스크롤시 헤더, 필터창 검색창 탭바 전부 숨김"). 두 컴포넌트 다 이 훅을
  // 직접 호출하지 않으므로(헤더는 이 훅의 반환값을 tabBarHidden 클래스로 직접 받지만,
  // 화면마다 제각각 마운트되는 SearchFilterBar까지 매번 프로퍼티로 내려주긴 번거롭다)
  // <html> 태그에 클래스를 하나 얹어 CSS로만 동기화한다.
  useEffect(() => {
    document.documentElement.classList.toggle("scr-scroll-hide", hidden);
    return () => document.documentElement.classList.remove("scr-scroll-hide");
  }, [hidden]);

  // .scr-main 하단 예약분 중 탭바 몫(--mobile-footer-h)은 일부러 고정값으로 둔다(탭바가
  // 다시 나타나는 순간 예약 공간이 늘어나면서 "맨 아래인 줄 알았는데 스크롤이 더
  // 생기는" 점프가 났었다 — 이 세션에서 이미 두 번 겪은 버그). 다만 검색창+필터창 몫
  // (136px)까지 항상 고정이면 그것들이 숨어 있는 동안도 빈 공간만 그대로 남아 유독
  // 커 보였다(요청: "탭바만 보일정도의 여백만 있으면 되거든 하단에") — 이 몫만은
  // nearBottom을 따로 둬서(위 NEAR_BOTTOM_PX 참고) 진짜 맨 아래에 닿기 240px 전에
  // 미리 복원해둔다. 그러면 실제로 바닥에 닿는 순간과 예약 공간이 늘어나는 순간이
  // 겹치지 않아(늘어날 때 아직 스크롤할 거리가 충분히 남아 있어) 같은 점프가 재현되지
  // 않는다 — hidden만으로 그대로 묶었으면 탭바 몫과 똑같이 바닥에서 점프가 났을 것.
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--mobile-filterstack-reserve-h", (hidden && !nearBottom) ? "0px" : "136px",
    );
  }, [hidden, nearBottom]);

  return hidden;
}
