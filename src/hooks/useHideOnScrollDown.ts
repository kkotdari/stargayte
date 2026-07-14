import { useEffect, useRef, useState } from "react";
import { addScrollListener, getScrollMetrics } from "../utils/scrollRoot";

// 스크롤하는 동안은 하단 탭바(+ 헤더/플로팅 필터·검색창)를 보여주고, 스크롤이 멈추면
// 잠시 후 숨긴다 — 원래는 "아래로 스크롤하면 숨김, 위로 스크롤하거나 맨 아래 도달하면
// 보임"이었는데, 그 방향/위치 기반 규칙 때문에 스크롤이 맨 위/맨 아래에 닿는 순간마다
// 탭바가 갑자기 나타나거나 사라져 부자연스러웠다(요청: "2단으로 여백 생기는 문제
// 발생.. 탭바를 좀 일찍부터 띄워줘야 이런 문제가 없을듯" → "자동 숨김을 멈춰있으면
// 숨김 스크롤하면 보임으로 수정하자" → "그럼 상하단에서 갑자기 보이지 않으니 해결").
// 스크롤 "활동" 자체를 신호로 쓰면 방향이나 위치를 따질 필요가 없어 더 단순하고,
// 맨 위/맨 아래 특수 취급도 필요 없다 — 그 자리에서도 스크롤 중이면 보이고, 멈추면
// 다른 곳과 똑같이 잠시 후 숨는다. 이 훅은 마운트 시점에 존재하는 스크롤 루트에 한 번만
// 구독한다 — 로그인 후에만 마운트되는 컴포넌트(Header)에서 호출하면 #scroll-root가
// 이미 DOM에 있는 상태로 구독을 시작하므로 별도 "shellReady" 신호가 필요 없다.
const IDLE_DELAY_MS = 500;
// 요청: "검색창/필터창/탭바는 페이지 최상단 최하단에선 항상 노출이야" + "스크롤 안해도"
// — 맨 위/맨 아래에서는 스크롤이 멈춰도(심지어 한 번도 스크롤 안 해도) 숨기지 않는다.
// EDGE_PX는 "정확히 끝"이 아니라 터치가 살짝 덜 붙어도 같은 취급을 받을 여유값이다.
const EDGE_PX = 24;

export function useHideOnScrollDown(screen: string): boolean {
  const [hidden, setHidden] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const atEdgeRef = useRef(true);

  useEffect(() => {
    const onScroll = () => {
      const { scrollTop, clientHeight, scrollHeight } = getScrollMetrics();
      atEdgeRef.current = scrollTop <= EDGE_PX || scrollTop + clientHeight >= scrollHeight - EDGE_PX;
      setHidden(false);
      if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        if (!atEdgeRef.current) setHidden(true);
      }, IDLE_DELAY_MS);
    };
    return addScrollListener(onScroll);
  }, []);

  // 화면(탭)을 전환하면 이전 화면의 숨김 타이머가 아직 남아 있을 수 있다 — 새 화면은
  // 항상 보이는 상태로 시작해야 하므로 타이머를 지우고 강제로 다시 보이게 한다.
  // 이 리셋 자체가 이전 화면의 숨김 상태와 다르면(예: 이전 화면은 숨겨진 채 전환했는데
  // 새 화면은 보임으로 바뀌는 경우) 탭바/필터창이 슬쩍 미끄러져 나타나는 트랜지션이
  // 화면 전환과 겹쳐 부자연스러워 보였다(요청: "페이지 이동시... 전환효과가 더
  // 부자연스러운듯. 바로 보이거나 숨겨져야해") — 화면이 바뀌는 그 순간만 트랜지션을
  // 꺼서 상태가 즉시(애니메이션 없이) 바뀌게 하고, 실제 스크롤로 인한 숨김/노출에는
  // 그대로 부드러운 트랜지션을 남겨둔다.
  useEffect(() => {
    if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
    atEdgeRef.current = true;
    document.documentElement.classList.add("scr-screen-switch-jump");
    setHidden(false);
    const raf = requestAnimationFrame(() => {
      document.documentElement.classList.remove("scr-screen-switch-jump");
    });
    return () => cancelAnimationFrame(raf);
  }, [screen]);

  useEffect(() => () => {
    if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
  }, []);

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
