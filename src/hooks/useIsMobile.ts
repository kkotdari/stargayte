import { useEffect, useState } from "react";

// 모바일(폰) 폭인지 — 레이아웃이 아니라 '동작 자체'가 갈리는 곳에서만 쓴다(예: 댓글을
// 카드 안에서 쓰느냐 바텀시트로 여느냐). 단순 스타일 차이는 CSS 미디어쿼리로 해결하고
// 이 훅을 부르지 않는다.
//
// 이 앱의 폭 경계는 하나뿐이다(요청: "모두 한 문턱으로 맞춰줘, 딱 2개만 있게") —
// 1160px. 그 위는 왼쪽 기둥이 선 PC 배치, 그 아래는 서랍 + 하단 탭바인 모바일 배치다.
// 한때 경계가 480 / 640 / 720 / 768 / 860 / 900 / 1060으로 흩어져 있었고, 그래서 화면
// 하나를 손볼 때마다 대여섯 폭을 다 확인해야 했다. 지금은 두 배치뿐이라 볼 곳도 둘이다.
// CSS 쪽 경계(styles/global.css의 max-width:1159px / min-width:1160px)와 같은 값이어야
// 한다 — 여기만 어긋나면 한 폭에서 배치는 PC인데 동작만 모바일이 된다.
const QUERY = "(max-width: 1159px)";

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
