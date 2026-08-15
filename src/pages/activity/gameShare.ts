import { outcomeFor, teamSummaryName } from "./GameResultSides";
import { cleanMapName } from "../../utils/mapName";
import { shareThumb } from "../../utils/kakaoShare";
import { playbackClockOf } from "../../components/replay/ReplayMotionPlayer";
import type { KakaoShareContent } from "../../utils/kakaoShare";
import type { GameResult, Member } from "../../types";

/* 경기 한 판의 카카오톡 공유 내용 — 양 팀 이름과 결과/맵/날짜. 케밥 메뉴(GameResultCardBody)와
   재생기 진행바 아래 공유 버튼(GameResultStory)이 함께 쓰므로 따로 산다(순환 임포트 방지). */
export function gameResultShareContent(
  gameResult: GameResult, memberOf: (id: string) => Member | undefined,
): KakaoShareContent {
  const t1 = teamSummaryName(gameResult.team1, memberOf) || "팀1";
  const t2 = teamSummaryName(gameResult.team2, memberOf) || "팀2";
  const resultLabel =
    gameResult.result === "draw" ? "무승부"
    : gameResult.result === "not_held" ? "미실시"
    : `${outcomeFor("team1", gameResult.result) === "win" ? t1 : t2} 승`;
  const cleanedMap = cleanMapName(gameResult.mapName);
  const mapPart = cleanedMap ? ` · ${cleanedMap}` : "";
  /* 특정 시간 공유(요청: 카톡으로 열면 그 시각부터 재생) — 이 경기의 재생기가 적어 둔
     현재 재생 시각을 &t=로 싣는다. 막 시작한 참(5초 미만)이면 굳이 안 싣는다. */
  const clockSec = playbackClockOf.get(String(gameResult.matchNo || gameResult.id));
  const tPart = clockSec !== undefined && clockSec >= 5 ? `&t=${Math.floor(clockSec)}` : "";
  return {
    title: `${t1} vs ${t2}`,
    description: `${resultLabel}${mapPart} · ${gameResult.date}`,
    ...shareThumb("gameResult"),
    /* 직접 주소로(요청: 게임은 공유 주소(sv) 말고 페이지 주소) — 게임 상세가 주소를
       가진 페이지가 되면서, 카톡 링크도 그 페이지로 바로 들어간다. */
    link: `${window.location.origin}/?screen=activity&group=gameResult&game=${gameResult.matchNo || gameResult.id}${tPart}`,
    fallbackText: `[스타게이트 게임결과]\n${t1} vs ${t2}\n결과: ${resultLabel}${mapPart}\n${gameResult.date}`,
  };
}
