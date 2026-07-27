import { useEffect, useState } from "react";

// 모바일(폰) 폭인지 — 레이아웃이 아니라 '동작 자체'가 갈리는 곳에서만 쓴다(예: 댓글을
// 카드 안에서 쓰느냐 바텀시트로 여느냐). 단순 스타일 차이는 CSS 미디어쿼리로 해결하고
// 이 훅을 부르지 않는다.
//
// 이 프로젝트엔 폭 경계가 둘 있고 역할이 다르다(지적: "모바일 UI 기준이 2개여?"):
//   860px — 셸(껍데기) 경계. 하단 탭바/등록 FAB이 뜨고 데스크톱 내비·스크롤바가 숨는 폭.
//   640px — 화면(내용) 경계. 폰트 스케일이 --mobile-fs-*로 바뀌고, 모달·사진뷰어가
//           전면(full-screen)으로 바뀌고, 필터/검색이 세로로 쌓이는 폭.
// 바텀시트는 화면을 덮는 모달 계열이라 전면 모달과 같은 640px을 쓴다 — 641~860px(태블릿)
// 구간은 모달이 가운데 정렬 다이얼로그로 남는 구간이라, 거기서만 댓글이 시트로 열리면
// 같은 폭에서 팝업 종류마다 방식이 갈린다.
const QUERY = "(max-width: 640px)";

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
