import { useEffect, useRef, useState } from "react";
import { addScrollListener, getScrollMetrics, isScrollHideSuppressed } from "../utils/scrollRoot";

// 아래로 스크롤하면 하단 탭바(+ 헤더/플로팅 필터·검색창)를 숨기고, 위로 스크롤하거나
// 맨 위/맨 아래에 있으면 보여준다(요청: "아래로 스크롤시: 탭바 숨겨짐 / 위로 스크롤시:
// 노출 / 페이지 최하단 도달시: 노출") — 예전엔 방향 대신 "스크롤 활동이 멈추면 숨김"
// 방식으로 바꿨던 적이 있는데(스크롤이 맨 위/맨 아래에 닿는 순간마다 탭바가 갑자기
// 나타나거나 사라지는 문제 때문), 그러면 실제로 "아래로 스크롤하는 동안"에는 계속
// 보여서 요청한 동작과 어긋난다(실제로 지적받은 문제 — "아래로 스크롤시 모두 다 숨김
// 안되네"). 다시 방향 기반으로 돌아가되, 그 옛 문제(맨 위/아래에서 깜빡임)는 그대로
// 재발하지 않게 두 가지를 유지한다: (1) 맨 위/맨 아래 근처(EDGE_PX)에서는 항상 노출,
// (2) 아주 작은 스크롤(손떨림/관성 스크롤 잔여값)에는 반응하지 않도록, 방향이 바뀔
// 때마다 누적값을 리셋하고 일정 거리(HIDE_DELTA_PX/SHOW_DELTA_PX) 이상 그 방향으로
// 누적됐을 때만 실제로 토글한다(iOS Safari 주소창이 숨는 방식과 같은 원리).
const EDGE_PX = 24;
const HIDE_DELTA_PX = 10;
const SHOW_DELTA_PX = 4;

export function useHideOnScrollDown(screen: string): boolean {
  const [hidden, setHidden] = useState(false);
  const lastScrollTopRef = useRef(0);
  // 지금 방향으로 누적된 스크롤 거리 — 방향이 바뀌거나 가장자리에 닿으면 0으로 리셋된다.
  const accumRef = useRef(0);

  useEffect(() => {
    lastScrollTopRef.current = getScrollMetrics().scrollTop;
    const onScroll = () => {
      const { scrollTop, clientHeight, scrollHeight } = getScrollMetrics();
      // 프로그램(자동) 스크롤 중엔 숨김 판정을 건너뛴다 — 위치/누적만 최신으로 맞춰 두어,
      // 억제가 끝난 뒤 첫 사용자 스크롤에서 갑자기 큰 delta로 튀지 않게 한다(요청: "next
      // 대결 자동 스크롤하면서 탭바와 아이콘 숨겨지는 문제 해결").
      if (isScrollHideSuppressed()) {
        lastScrollTopRef.current = scrollTop;
        accumRef.current = 0;
        return;
      }
      const atEdge = scrollTop <= EDGE_PX || scrollTop + clientHeight >= scrollHeight - EDGE_PX;
      const delta = scrollTop - lastScrollTopRef.current;
      lastScrollTopRef.current = scrollTop;

      if (atEdge) {
        accumRef.current = 0;
        setHidden(false);
        return;
      }
      if (delta > 0) {
        accumRef.current = accumRef.current > 0 ? accumRef.current + delta : delta;
        if (accumRef.current > HIDE_DELTA_PX) setHidden(true);
      } else if (delta < 0) {
        accumRef.current = accumRef.current < 0 ? accumRef.current + delta : delta;
        if (accumRef.current < -SHOW_DELTA_PX) setHidden(false);
      }
    };
    return addScrollListener(onScroll);
  }, []);

  // 화면(탭)을 전환하면 새 화면은 항상 보이는 상태로 시작해야 한다 — 누적값을 리셋하고
  // 강제로 다시 보이게 한다. 이 리셋 자체가 이전 화면의 숨김 상태와 다르면(예: 이전
  // 화면은 숨겨진 채 전환했는데 새 화면은 보임으로 바뀌는 경우) 탭바/필터창이 슬쩍
  // 미끄러져 나타나는 트랜지션이 화면 전환과 겹쳐 부자연스러워 보였다(요청: "페이지
  // 이동시... 전환효과가 더 부자연스러운듯. 바로 보이거나 숨겨져야해") — 화면이 바뀌는
  // 그 순간만 트랜지션을 꺼서 상태가 즉시(애니메이션 없이) 바뀌게 하고, 실제 스크롤로
  // 인한 숨김/노출에는 그대로 부드러운 트랜지션을 남겨둔다.
  useEffect(() => {
    accumRef.current = 0;
    lastScrollTopRef.current = getScrollMetrics().scrollTop;
    document.documentElement.classList.add("scr-screen-switch-jump");
    setHidden(false);
    const raf = requestAnimationFrame(() => {
      document.documentElement.classList.remove("scr-screen-switch-jump");
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

  return hidden;
}
