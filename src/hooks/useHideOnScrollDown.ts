import { useEffect, useRef, useState } from "react";
import { addScrollListener, getScrollMetrics } from "../utils/scrollRoot";

// 아래로 스크롤하면 하단 탭바를 숨겨 화면을 넓게 쓰고, 목록 끝(맨 아래)까지 다다르면
// 다시 보여준다(요청: "모바일 아래로 스크롤시 탭바 숨김(단 끝까지 내리면 탭바 보임)").
// 위로 스크롤해도 다시 보여주진 않는다 — 요청에 그 부분은 없었다: 맨 아래 도달 전엔
// 계속 숨어있다가 다 읽으면 나타난다. 이 훅은 마운트 시점에 존재하는 스크롤 루트에
// 한 번만 구독한다 — 로그인 후에만 마운트되는 컴포넌트(Header)에서 호출하면
// #scroll-root가 이미 DOM에 있는 상태로 구독을 시작하므로 별도 "shellReady" 신호가
// 필요 없다.
const HIDE_THRESHOLD = 6;
const EDGE_PX = 10;

export function useHideOnScrollDown(screen: string): boolean {
  const [hidden, setHidden] = useState(false);
  const lastYRef = useRef(0);
  useEffect(() => {
    lastYRef.current = getScrollMetrics().scrollTop;
    const onScroll = () => {
      const { scrollTop: y, clientHeight, scrollHeight } = getScrollMetrics();
      const delta = y - lastYRef.current;
      const atBottom = y + clientHeight >= scrollHeight - EDGE_PX;
      if (atBottom) setHidden(false);
      else if (delta > HIDE_THRESHOLD) setHidden(true);
      lastYRef.current = y;
    };
    return addScrollListener(onScroll);
  }, []);

  // App.tsx가 화면 전환 시 이전 스크롤 위치로 코드로 점프시키는데, 그 점프 자체를
  // "아래로 스크롤"로 착각해 순간 숨어버릴 수 있다 — 점프가 끝난 다음 프레임에 기준
  // 위치를 다시 맞추고 강제로 다시 보이게 한다.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      lastYRef.current = getScrollMetrics().scrollTop;
      setHidden(false);
    });
    return () => cancelAnimationFrame(raf);
  }, [screen]);

  return hidden;
}
