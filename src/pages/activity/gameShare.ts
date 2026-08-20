import { outcomeFor, teamSummaryName } from "./GameResultSides";
import { cleanMapName } from "../../utils/mapName";
import { shareThumb } from "../../utils/kakaoShare";
import { playbackClockOf, playbackViewOf } from "../../components/replay/ReplayMotionPlayer";
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
  const key = String(gameResult.matchNo || gameResult.id);
  const clockSec = playbackClockOf.get(key);
  const tPart = clockSec !== undefined && clockSec >= 5 ? `&t=${Math.floor(clockSec)}` : "";
  /* 보던 자리까지 싣는다(요청: "내가 보고있던 부분의 위치까지 같이 보내서 들어오는
     사람도 거기가 재생되게") — 시각만으로는 같은 장면이 아니다. 확대해서 한 귀퉁이를
     보고 있었으면 받는 쪽도 그 귀퉁이를 봐야 한다.
     기본값과 같은 것은 안 싣는다 — 링크가 길어지기만 하고 뜻이 없다. */
  const view = playbackViewOf.get(key);
  let vPart = "";
  if (view) {
    if (view.z > 1.02) vPart += `&z=${view.z.toFixed(2)}`;
    if (Math.abs(view.cx - 0.5) > 0.005 || Math.abs(view.cy - 0.5) > 0.005) {
      vPart += `&cx=${view.cx.toFixed(3)}&cy=${view.cy.toFixed(3)}`;
    }
    if (view.deg !== 90) vPart += `&a=${view.deg}`;
  }
  return {
    title: `${t1} vs ${t2}`,
    description: `${resultLabel}${mapPart} · ${gameResult.date}`,
    ...shareThumb("gameResult"),
    /* 직접 주소로(요청: 게임은 공유 주소(sv) 말고 페이지 주소) — 게임 상세가 주소를
       가진 페이지가 되면서, 카톡 링크도 그 페이지로 바로 들어간다. */
    link: `${window.location.origin}/?screen=activity&group=gameResult&game=${gameResult.matchNo || gameResult.id}${tPart}${vPart}`,
    fallbackText: `[스타게이트 게임결과]\n${t1} vs ${t2}\n결과: ${resultLabel}${mapPart}\n${gameResult.date}`,
  };
}
