import { useEffect, useState } from "react";

// 모바일 폭인지 — 하단 탭바가 뜨는 기준(860px)과 같은 경계를 쓴다. 레이아웃이 아니라
// '동작 자체'가 갈리는 곳에서만 쓴다(예: 댓글을 카드 안에서 쓰느냐 바텀시트로 여느냐).
// 단순 스타일 차이는 CSS 미디어쿼리로 해결하고 이 훅을 부르지 않는다.
const QUERY = "(max-width: 860px)";

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const sync = () => setMobile(mq.matches);
    mq.addEventListener("change", sync);
    sync();
    return () => mq.removeEventListener("change", sync);
  }, []);
  return mobile;
}
