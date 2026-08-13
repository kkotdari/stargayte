import { createContext } from "react";

/* 게임 결과 상세 팝업의 "닫기" 통로(요청: PC는 게임 결과만 확대창이 기본이고 기존 상세는
 * 안 쓴다) — 상세 팝업(ActivityScreen)이 값을 채우고, 그 안의 연속 재생 플레이어가 이
 * 값을 받아 마운트되자마자 확대창을 열며, 확대창을 닫으면 이 콜백으로 상세까지 함께
 * 닫는다. 프롭으로 내리면 GameResultCard → CardBody → Story → Player 네 층을 뚫어야
 * 해서 컨텍스트로 둔다. 목록·전체 보기처럼 상세가 아닌 자리에는 값이 없어(null) 예전
 * 그대로다. */
export const GameDetailCloseContext = createContext<(() => void) | null>(null);
