import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import ReplayMinimap, { ARROW_MIN_TILES, type MinimapArrow, type MinimapMarker } from "../../components/replay/ReplayMinimap";
import ReplayStoryTimeline from "../../components/replay/ReplayStoryTimeline";
import RosterSide, { outcomeFor, resolveSlotName } from "./GameResultSides";
import { useReplayMap } from "../../hooks/useReplayMap";
import { cleanMapName } from "../../utils/mapName";
import { cx } from "../../utils/format";
import { normalizeSearchText } from "../../utils/memberSearch";
import { ATTACK_BEAT_KEYS } from "../../utils/replaySummary";
import { renderReplaySummarySentences, UNIT_KO, BUILDING_KO, TECH_KO } from "../../utils/replaySummaryText";
import { SIGNATURE_UPGRADE_KO, UPGRADE_LINE_KO } from "../../utils/replayTechNames";
import type { SummaryPart } from "../../utils/replaySummaryText";
// 이름 뒤 조사는 받침에 따라 갈린다 — "carol가"가 아니라 "carol이"다. 요약 문장이 쓰는
// 것과 같은 유틸을 쓴다(라틴 이름의 받침 판정까지 그쪽이 이미 다룬다).
import { ga, reul } from "../../utils/korean";
import type { GameResult, GameResultSlot, Member } from "../../types";

// 경기 한 판을 '이야기'로 보여주는 부분 — 로스터/미니맵, 타임라인, 요약 문장이 한 상태를
// 함께 쓴다(요청).
//
// 타임라인의 스냅 하나가 요약 문장 하나다. 스냅을 고르면 그 문장이 자막으로 나오고, 미니맵에는
// 그 문장에서 벌어진 일이 본진 → 그 자리 화살표로 그려진다. 본진 표시(아바타+닉네임)는 늘 떠
// 있고, 그 문장에 이름이 나온 사람만 아바타가 커진다(요청).
//
// 로스터는 모바일에서만 감춘다(요청: 카드 하나가 너무 길어졌다) — 편은 미니맵의 색이
// 말해 주고, 종족도 미니맵 표시에 함께 붙는다. PC는 가로로 자리가 남으므로 예전처럼 로스터를
// 양쪽에 두고 미니맵을 그 사이에 둔다(요청). 미니맵을 못 그리는 경기(옛 경기, 맵 정보를 못
// 읽은 리플레이)에서는 모바일에서도 로스터가 유일한 로스터라 그대로 보여준다.

// 자동재생이 한 스냅에 머무는 시간 — 문장 길이에 맞춘다(긴 문장에 같은 시간을 주면 다
// 읽기 전에 넘어간다). 이제 자막이 그 문장을 담는 유일한 자리라, 넘어가기 전에 충분히
// 읽을 수 있어야 한다(요청) — 아래 문단에 전문이 함께 있던 때보다 넉넉하게 잡았다.
// 글자 하나당 0.11초는 초당 아홉 자 남짓 읽는 속도다.
/** 프레임 → 초. 자막 앞에 붙이는 "[07:12]"를 계산한다(요청: 분에 초까지). */
const SECONDS_PER_FRAME = 0.042;

const DWELL_BASE_MS = 1800;
const DWELL_PER_CHAR_MS = 110;
const DWELL_MAX_MS = 12000;

/* 무슨 일인지 알려 주는 이모지(요청) — 공격 화살촉 끝에는 검 대결, 아군 지원은 천사, 핵은
   핵폭발처럼 그 일에 맞는 것을 붙인다. 화살표가 없는 이야기(생산·테크·경제)는 그 사람 본진에
   붙는다(요청: 생산에도 본진에 열심히 생산하는 이모지).

   여기 없는 키는 아래 markOf가 기본값으로 채운다 — 공격 계열이면 검 대결, 그 밖은 생산. */
const BEAT_MARK: Record<string, string> = {
  // 들이친 것.
  "raid-damage": "⚔️", "gang-rush": "⚔️", "duel-rush": "⚔️", breakthrough: "💥",
  // 그 판 최대 교전 — 양쪽에서 화살표가 한 자리로 모인다.
  clash: "💥",
  "zling-rush": "⚔️", "zealot-rush": "⚔️",
  // 남의 땅에 건물을 박는 기습은 병력 러시와 다른 이야기라 아이콘도 따로 준다(요청:
  // 몰래 배럭·포토러시·성큰러시 아이콘과 화살표를 잘 표시).
  "cannon-rush": "🔮", "sunken-rush": "🐙", "sneak-rax": "🥷",
  allin: "🎲", "rush-backfire": "🙃",
  // 실어 나르거나 워프로 간 것.
  dropship: "🪂", shuttle: "🪂", "shuttle-reaver": "🪂", "templar-drop": "🪂", "zerg-drop": "🪂",
  recall: "🌀", nydus: "🕳️", nuke: "☢️",
  // 견제·사냥·잠입.
  "harass-workers": "🎯", "harass-long": "🎯", muta: "🦟", "cloak-wraith": "👻",
  "valk-hunt": "🎯", infested: "🧟", "mind-control": "🧠", "power-unit": "💪",
  // 물량 — 본진에서 쉼 없이 찍어낸 이야기라 공장이 아니라 '쏟아진다'는 느낌이 맞다.
  "mass-army": "🌊",
  // 아군을 도우러 간 것 — 화살촉(도착한 아군 기지)에는 방어를 보탰다는 뜻으로 방패를
  // 준다. 천사 얼굴은 이제 도우러 간 사람 아바타 쪽으로 옮겼다(요청).
  "ally-help": "🛡️", "ally-cannon": "🛡️",
  /* 자리를 잡거나 길을 막은 것.

     포토·성큰·터렛은 그 자체로 방패도 창도 아니다 — 어디에 박았느냐가 가른다(요청:
     맥락에 따라 방패·창 둘 다로 표현 가능). 제 집·아군 집을 지키려고 세운 것은 방패고
     (defense·front-defense·late-defense·ally-cannon), 상대 진영이나 센터처럼 다투는
     땅에 박아 길을 끊고 상대를 가두는 것은 창이다. 센터에 박은 것은 문장부터가
     "센터를 장악함·길목을 아예 틀어막음·가둬 놓음"이라 막아선 이야기가 아니다 —
     포토든 성큰이든 터렛이든 같은 수라 같은 표시를 준다(요청: 터렛도 같은 맥락으로).
     남의 본진에 박는 포토러시·성큰러시는 아예 제 아이콘을 따로 갖고 있다(위 참고).

     센터에 건물을 늘려 판을 넓힌 것(center)도 다투는 땅의 이야기라 창이다 —
     깃발(🚩)은 쓰지 않는다(요청). */
  center: "⚔️", "center-photon": "⚔️", defense: "🛡️", "front-defense": "🛡️",
  "late-defense": "🛡️",
  /* 입구막기 — 막아섰다는 뜻의 방패와도, 다투는 땅을 먹었다는 뜻의 창과도 다르다.
     길을 잠가 못 지나가게 해 둔 것이라 공사중 표지가 그 뜻에 가장 가깝다(요청). */
  "wall-in": "🚧",
  // 방패는 실제로 방어 건물을 세운 이야기에만 준다(지적: 유닛을 뽑은 것뿐인데 본진에
  // 방패가 뜬다) — 병력으로 맞선 이야기는 싸움이라 검 대결이 맞다.
  stand: "⚔️", "late-hold": "⚔️", standoff: "⚔️",
  // 옆탱은 이름과 달리 방어가 아니라 공격이지만(지적), 병력이 맞붙는 싸움과는 결이 달라
  // 칼 모양이 아니라 자리 잡고 쏘는 느낌으로 구분한다. 탑(🗼)은 건물 느낌만 나고 공격으로
  // 안 읽혀서(지적) 활(🏹)로 바꾼다 — 멀리서 쏘는 공격이라는 게 한눈에 보인다.
  "side-tank": "🏹", "center-tank": "🏹",
  // 제 집에서 막아 냄 / 그 뒤 역공(요청) — 방패로 받아 내고, 넘어가서 두들긴다.
  "hold-off": "🛡️", counter: "💥",
  // 본진에서 한 일 — 화살표 없이 본진에 붙는다.
  // 현미경은 무슨 일인지 안 읽힌다(지적) — 테크는 결국 싸우려고 하는 일이라 검 대결로
  // 통일한다. 업그레이드만은 공격보다 연구 쪽이 어울려(지적) 따로 시험관을 준다.
  expand: "🏗️", upgrade: "🧪", "upgrade-signature": "🧪", tech: "⚔️", "fast-tech": "⚔️",
  lodging: "🏠", relocate: "🚚", "greedy-build": "💰", "greedy-paid": "💰", greedy: "💰",
  // 째다 응징당한 문장에서 표시를 받는 건 당한 사람이 아니라 때린 사람(p.by)뿐이라
  // (BY_ATTACKER_KEYS) 검 대결이 맞다 — 당한 사람은 얼굴로만 알린다.
  "greedy-punished": "⚔️",
  carrier: "🛩️", bc: "🛩️", guardian: "🛩️", "lift-off": "🛩️", vision: "👁️", "no-detect": "🙈",
  attrition: "⏳", "fast-hands": "⚡", "pro-like": "🌟", revival: "🔥",
  "worker-gap": "📉", "prod-gap": "📉",
  /* 맺음말(result)은 경기를 끝낸 그 싸움 이야기다(요청: 결론은 전투니까 화살표와 액션
     이모지도 다른 스냅과 동일하게) — 다른 교전 스냅과 같은 표시를 준다. 트로피는 이제
     맺음말이 아니라 그 뒤의 승패 스냅(verdict)이 전담하므로 겹치지 않는다. */
  result: "💥",
  // fallen·gg·greedy-punished는 여기 없다 — 주어(who)가 사실 당한 쪽이라 무기 이모지·
  // 화살표 대상이 아니고 아바타 얼굴로만 알린다(요청: 쨀다가 당한 얼굴도 아바타 얼굴
  // 하나로 통합). 승패 스냅(verdict)도 없다 — 그 스냅은 트로피만 얹는 자리다.
};

/** "tech" beat는 전부 같은 검 대결 이모지였다(지적: 스톰이든 이레디에이트든 구분이 안
 *  된다) — 실제로 쓴 마법 이름(replaySummary의 p.tech, replayTechNames.ts의 TECH_RANK
 *  키와 같은 문자열)으로 더 세분화한다. 여기 없는 마법은 markOf가 tech 기본값(검 대결)로
 *  채운다. */
const TECH_MARK: Record<string, string> = {
  "Psionic Storm": "🌩️", Irradiate: "☣️", "Dark Swarm": "☁️", Hallucination: "🪞",
  "EMP Shockwave": "⚡", "Stasis Field": "🧊", "Stim Packs": "💉",
  Lockdown: "🔒", Plague: "🦠", Consume: "🍽️", Ensnare: "🕸️", Parasite: "🪱",
  "Mind Control": "🧠", Feedback: "💢", Maelstrom: "🗿", "Spawn Broodlings": "🥚",
  "Disruption Web": "🚫", "Yamato Gun": "🎆", Restoration: "💊", "Optical Flare": "🕶️",
  "Defensive Matrix": "🔷", "Spider Mines": "🕷️", "Scanner Sweep": "📡",
  "Archon Warp": "🔱", "Dark Archon Meld": "🌑",
};

/* 스냅 자막을 문장 대신 아주 짧은 타이틀로 바꾼다(요청: "[11:27] 정구가 Rex를 공격" 식).
   그림이 이미 대부분을 말하고 있어서다 — 누가 어디로 갔는지는 화살표가, 무엇으로 갔는지는
   화살표 이름표가, 무슨 일인지는 이모지가 말한다. 거기에 문장까지 얹으면 같은 말을 두 번
   하면서 그림의 절반을 덮는다. 붙일 타이틀이 없으면 시각만 남긴다(요청).

   아래 다섯 갈래는 BEAT_MARK의 이모지 갈래와 같은 눈으로 나눈 것이다 — 창은 공격, 폭발은
   교전, 과녁·낙하산은 견제, 방패는 방어, 나머지 본진 이야기는 살림이다. */
const TITLE_ATTACK = new Set([
  "raid-damage", "gang-rush", "duel-rush", "breakthrough", "zling-rush", "zealot-rush",
  "cannon-rush", "sunken-rush", "sneak-rax", "allin", "counter", "greedy-punished",
  "rush-backfire", "power-unit",
]);
const TITLE_CLASH = new Set(["clash", "result", "stand", "late-hold", "standoff"]);
const TITLE_HARASS = new Set([
  "harass-workers", "harass-long", "muta", "cloak-wraith", "valk-hunt", "infested",
  "dropship", "shuttle", "shuttle-reaver", "templar-drop", "zerg-drop", "recall", "nydus",
  "nuke", "mind-control",
]);
const TITLE_DEFEND = new Set([
  "defense", "front-defense", "late-defense", "hold-off", "wall-in",
]);
const TITLE_SUPPORT = new Set(["ally-help", "ally-cannon"]);
const TITLE_HOLD = new Set(["center", "center-photon", "center-tank", "side-tank"]);
/** 본진에서 한 일 — 상대가 없는 이야기라 "누가 무엇을"로 끝난다. */
const TITLE_SOLO: Record<string, string> = {
  expand: "확장", upgrade: "업그레이드", "upgrade-signature": "업그레이드",
  tech: "테크", "fast-tech": "테크", "mass-army": "물량", lodging: "이사", relocate: "이사",
  greedy: "쨈", "greedy-build": "쨈", "greedy-paid": "쨈",
  carrier: "캐리어", bc: "배틀크루저", guardian: "가디언", "lift-off": "띄우기",
  revival: "부활", attrition: "장기전", "fast-hands": "손속", "pro-like": "프로급",
  /* 나머지 갈래 — 예전에는 표에 없는 키가 그대로 null이 되어 자막 자리에 시각만 남았는데,
     읽는 쪽에서는 "[07:12]"만 덩그러니 있으면 무슨 장면인지 알 수가 없다(지적: 시간만
     나오는 건 불편하다 — 무조건 짧은 타이틀이라도 붙일 것). 그림이 이미 말하는 것을
     되풀이하지 않는 선에서 한 마디씩 붙인다. */
  fallen: "무너짐", gg: "GG", "idle-lead": "굳히기", "long-run": "물량",
  vision: "시야 확보", "no-detect": "디텍터 없음",
  "worker-gap": "일꾼 격차", "prod-gap": "생산 격차",
};

/** 저장된 자리(pos)·마법 좌표(p.xy)를 화살표 목표로 믿는 최소 요약 버전
 *  (replaySummaryData의 REPLAY_SUMMARY_VERSION 주석 참고). */
const POS_TRUSTED_VERSION = 2;

/** 집에서 한 일 — 병력이 나간 자리가 있어도 화살표를 긋지 않는다. 테크·경제·방어·이사처럼
 *  '어디로 갔다'가 이야기의 뼈대가 아닌 것들이다. */
/* 집에서 한 일 — 화살표 없이 본진에 이모지만 붙는다.
   물량(mass-army)과 '끝까지 뽑은 유닛'(long-run)은 여기서 뺐다(요청: 진출한 생산에는
   좌표에 화살표를 그릴 것). 이제 그 문장들은 그 사람이 실제로 나간 것이 확인됐을 때만
   남고(replaySummary의 진출 판정), 요약이 나간 자리까지 실어 준다 — 그런 이야기를 계속
   '집에서 한 일'로 묶어 두면 그 자리가 있어도 화살표를 안 그린다. */
const HOME_BEAT_KEYS = new Set([
  "expand", "upgrade", "upgrade-signature", "tech", "fast-tech", "vision", "no-detect",
  "greedy-build", "greedy-paid", "greedy-punished", "lodging", "relocate",
  "defense", "front-defense", "late-defense", "wall-in", "side-tank", "center-tank",
  "revival", "fallen", "gg",
  "stand", "result", "standoff", "attrition", "fast-hands", "pro-like", "worker-gap",
  "prod-gap", "late-hold", "lift-off",
]);

/** 주어(who)가 당한 쪽이고, 때린 사람은 p.by에 실린 문장들 — whom에 넣으면 그림이
 *  통째로 뒤집히기 때문이다(그림은 whom을 '당한 사람'으로 읽는다). 이 문장들에서는
 *  by가 공격자이고, 화살표는 by의 집에서 who의 집으로 간다(지적: 태섭이 공격한 건데
 *  화살표가 없고 태섭 얼굴이 당황한 표정이었다). */
const BY_ATTACKER_KEYS = new Set([
  "fallen", "greedy-punished",
  /* 이사도 여기다(요청: 터를 옮긴 경우 "누구의 공격에 밀려"라는 내용이 있으면 그 내용도
     액션으로 담겨야 한다) — 자막은 민 사람의 이름을 부르는데 그림에는 이삿짐 화살표만
     있어 '누가 밀었나'가 통째로 빠져 있었다. */
  "relocate",
]);

/** 병력 규모 → 화살표 기둥 굵기(요청: 병력 규모에 따라 화살표 두께도 다르게).
 *
 *  규모는 그 무렵 뽑은 전투 유닛 수다(요약의 beat.sizes). 실측(172판)한 급습들의 분포가
 *  중앙 19기·75% 37기·90% 53기·최대 113기라, 그 사분위에 맞춰 네 단계로 끊는다. 비례로
 *  두면 후반의 몇백 기짜리 화살표가 지도를 덮어 버리고, 두 단계로는 차이가 안 읽힌다.
 *  CSS 기본값(1.8)이 가운데 단계가 되게 잡아, 값이 없는 옛 요약과 나란히 놓여도 어색하지
 *  않다. */
const arrowWidth = (n: number): number => (n >= 55 ? 3 : n >= 35 ? 2.4 : n >= 15 ? 1.8 : 1.3);

/** 실제로 맵 가운데에서 벌어진 일 — 화살표를 센터로 보낸다(요청: 센터 내용은 실제 센터에). */
const CENTER_BEAT_KEYS = new Set(["center", "center-photon", "center-tank"]);

/** 맵 한가운데로 볼 반경(타일) — 요약이 진출을 판정할 때 쓰는 값과 같다
 *  (replaySummary의 SORTIE_RADIUS). 두 곳이 갈리면 "나갔다고 판정해 문장은 남겼는데
 *  화살표는 안 그린다"가 된다. */
const CENTER_TILES = 25;

/* 화살표 끝에는 '특별한 기술'일 때만 이모지를 얹는다(요청: 일반 공격과 방어, 헬프의
   화살표 끝에 칼 이모지 더는 안 붙이기). 칼·방패는 그 화살표가 이미 말하고 있는 것을
   한 번 더 말할 뿐이라 — 화살표가 상대 진영으로 가면 공격이고, 아군 기지로 가면 도우러
   간 것이다 — 지도만 시끄러워졌다. 스톰·리콜·커널·드랍처럼 그 자체가 무슨 수인지
   알려 주는 표시들만 남긴다. 본진 이모지(화살표가 없는 이야기)는 여기 해당하지 않는다:
   거기서는 그 이모지가 유일한 표시라 없으면 아무 말도 안 남는다. */
const PLAIN_TIP_MARKS = new Set(["⚔️", "🛡️"]);

/** 본진 안이 아니라 '입구'에서 벌어진 일 — 본진 이모지를 한가운데가 아니라 상대 쪽으로
 *  밀어 그린다(요청: "벽을 쌓는 입구 막기는 입구쪽에 나와야 자연스럽고"). 판정 자체가
 *  '내 본진 안이면서 상대 쪽으로 나가 있는 자리'로 잡은 것들이라(replayTactics의 atFront),
 *  그림도 그 자리에 서는 것이 맞다. */
const FRONT_BEAT_KEYS = new Set(["wall-in", "front-defense"]);

/** '여기서 저기로 건너간' 수 — 화살표를 본진에서 상대에게로 통째로 잇는다(요청).
 *  마법을 쓴 좌표·문을 뚫은 좌표는 대개 제 진영 언저리라 목표로 삼으면 제 집 옆에서 짧게
 *  끝난다. 출발 자리는 회오리·구멍으로, 도착 자리는 반짝임으로 따로 표시한다. */
const WARP_BEAT_KEYS = new Set(["recall", "nydus"]);
/** 건너간 자리에 얹는 표시 — 리콜은 마법으로 나타난 느낌(별 반짝), 커널은 양 끝이 다
 *  구멍이다(지적: 커널은 시작과 끝 둘 다 구멍이 맞다). */
const WARP_ARRIVE_MARK: Record<string, string> = { recall: "✨", nydus: "🕳️" };

/** 날아서·워프로 간 수 — 화살표를 곧은 점선으로 그린다(요청: 드랍이나 공중유닛 이동은 직선).
 *  지상군만 곡선으로 돌아간다. */
const FLIGHT_BEAT_KEYS = new Set([
  "recall", "nydus", "dropship", "shuttle", "shuttle-reaver", "templar-drop", "zerg-drop",
  "muta", "cloak-wraith", "valk-hunt", "carrier", "guardian", "bc", "lift-off", "infested",
]);

/** 그 beat가 공중·워프로 간 것인가 — 피해 문장(raid-damage)은 무슨 수로 때렸는지가 p.k에
 *  들어 있어서, 그것까지 봐야 드랍으로 준 피해가 곡선으로 그려지지 않는다(지적). */
const isFlight = (k: string, cause: unknown): boolean =>
  FLIGHT_BEAT_KEYS.has(k) || (typeof cause === "string" && FLIGHT_BEAT_KEYS.has(cause));

/** 카드가 화면에 이만큼 들어와 있으면 재생한다 — 활동에 카드가 여럿인데 전부 동시에
 *  돌아가면 어지럽고, 보이지도 않는 카드가 타이머를 물고 있을 이유도 없다. */
const VISIBLE_RATIO = 0.4;

/** 이사 간 자리가 다른 사람의 지금 자리와 이만큼(타일) 안쪽이면 '겹친다'로 본다 — 이사
 *  목적지는 실제 시작 지점 좌표를 그대로 쓰므로(replaySummary의 relocations), 같은
 *  자리면 좌표가 정확히 일치한다. 그래도 살짝 여유를 둔다. */
const NATIVE_OVERLAP_TILES = 3;
/** 셋방살이·겹침을 피해 옮겨 앉는 거리(타일) — 128칸 맵에서 1타일은 화면 2~3px뿐이라
 *  (ReplayMinimap 주석), 8타일(16~24px)로는 지금 문장의 주인공이라 커진 아바타(28px)
 *  둘이 마주치면 여전히 겹쳤다(지적: 확대되면 너무 겹쳐서 하나가 안 보인다). 두 아바타가
 *  다 커진 최악의 경우까지 넉넉히 떨어지도록 배로 늘린다. */
const LODGING_OFFSET_TILES = 16;

export default function GameResultStory({
  gameResult, team1, team2, result, memberOf, highlightMemberIds, highlightTerms, active = true,
}: {
  gameResult: GameResult;
  team1: GameResultSlot[];
  team2: GameResultSlot[];
  result: GameResult["result"];
  memberOf: (id: string) => Member | undefined;
  highlightMemberIds?: Set<string>;
  highlightTerms?: string[];
  /** 지금 실제로 보이는 카드인가 — 접힌 묶음은 카드 본체를 투명하게 깔아 둔 채로 두므로
   *  (자리를 주고받는 애니메이션 때문) 이 값 없이는 안 보이는 카드의 타임라인이 혼자
   *  돌아가 있다가 펼치는 순간 중간 장면부터 보인다. */
  active?: boolean;
}) {
  const grid = useReplayMap(gameResult.mapHash);
  const rootRef = useRef<HTMLDivElement>(null);

  // 이름 풀기 — 요약은 리플레이 원본 게임 아이디로 저장돼 있어서, 볼 때마다 지금의 회원
  // 연결로 이름을 다시 푼다(닉네임을 바꾸면 옛 경기의 요약도 따라온다).
  const { nameByRaw, teamByName, slots } = useMemo(() => {
    const all = [...team1, ...team2];
    const byRaw = new Map<string, string>();
    const byName = new Map<string, 1 | 2>();
    const rows: { raw: string; name: string; slot: GameResultSlot; team: 1 | 2 }[] = [];
    const add = (list: GameResultSlot[], team: 1 | 2) => {
      list.forEach((slot) => {
        const name = resolveSlotName(slot, all, memberOf);
        if (slot.rawName) byRaw.set(slot.rawName, name);
        if (name) byName.set(name, team);
        if (slot.rawName) rows.push({ raw: slot.rawName, name, slot, team });
      });
    };
    add(team1, 1);
    add(team2, 2);
    return { nameByRaw: byRaw, teamByName: byName, slots: rows };
  }, [team1, team2, memberOf]);

  const sentences = useMemo(() => {
    const body = renderReplaySummarySentences(
      gameResult.summaryData,
      (raw) => nameByRaw.get(raw) ?? raw,
      (name) => teamByName.get(name),
    ) ?? [];
    if (body.length === 0) return body;
    // 첫 장면은 로스터 대신 짧게 "게임 시작!"만 알린다(요청: 시작 자막의 로스터가 자막
    // 패널을 세로로 너무 키웠다 — 로스터는 미니맵 쪽 아바타·닉네임이 대신 크게 보여준다).
    // 요약(beat)과 무관한 소개라 beats는 비워 둔다: 시각도 안 붙고, 그림에도 아무 표시가
    // 얹히지 않는 깨끗한 시작이 된다.
    if (!slots.some((x) => x.team === 1) || !slots.some((x) => x.team === 2)) return body;
    const parts: SummaryPart[] = [{ text: "게임 시작!" }];
    // at은 0으로 둔다 — 타임라인은 시각을 모르는 문장(null)을 맨 끝에 놓기 때문에, 소개가
    // 오른쪽 끝 눈금으로 밀려나면 안 된다. beats가 비어 있어 자막에 "[0분]"은 안 붙는다.
    return [{ parts, beats: [], at: 0 }, ...body];
  }, [gameResult.summaryData, nameByRaw, teamByName, slots]);

  const [index, setIndex] = useState(0);
  // 자동재생은 꺼 둔다(요청) — 카드가 여럿 뜨는 활동에서 저마다 장면이 넘어가면 어지럽다.
  // 재생 버튼을 누르거나 그림 좌·우를 짚어 사람이 넘긴다.
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => setVisible(e.isIntersecting),
      { threshold: VISIBLE_RATIO },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const last = sentences.length - 1;
  const finished = index >= last && !playing;
  // 이 문장에 머물 시간 — 아래 타이머의 의존값으로 쓴다. sentences 배열 자체를 의존값에
  // 넣으면 안 된다: 활동 머리의 카운트다운 때문에 부모가 1초마다 다시 그려지고, 그때마다
  // 이 배열이 새 객체로 만들어져 타이머가 매번 끊긴다 — 그래서 3초 뒤에 넘어가야 할 스냅이
  // 영원히 제자리였다(실측: 4.5초를 기다려도 1번째 장면). 숫자로 뽑아 두면 내용이 같은
  // 동안에는 같은 값이라 타이머가 살아남는다.
  const dwell = Math.min(
    DWELL_MAX_MS,
    DWELL_BASE_MS + (sentences[index]?.parts.reduce((n, p) => n + p.text.length, 0) ?? 0) * DWELL_PER_CHAR_MS,
  );
  useEffect(() => {
    if (!playing || !visible || !active || last < 1) return;
    if (index >= last) { setPlaying(false); return; }
    const t = setTimeout(() => setIndex((i) => i + 1), dwell);
    return () => clearTimeout(t);
  }, [playing, visible, active, index, last, dwell]);

  /* 그 시점까지 궤멸됐거나 빈사가 된 사람들 — 본진에 해골을 얹는다(요청).
     저장된 beat만으로 알 수 있다: 무너진 사람(fallen), 얻어맞고 탈락한 사람
     (raid-damage의 p.out), 초반 올인에 빈사가 된 사람(p.early), GG를 친 사람. 되살아난
     사람(revival)은 다시 지운다 — 빈사에서 일어난 경기가 실제로 있다.
     지금 스냅까지의 beat를 시간순으로 훑어 쌓는다: 한 번 쓰러지면 그 뒤 스냅에서도
     쓰러진 채여야 한다(그 스냅의 beat에만 나온다고 그때만 해골을 띄우면, 다음 장면에서
     되살아난 것처럼 보인다). 이 계산은 이미 저장된 값만 쓰므로 옛 경기에도 그대로 붙는다. */
  /* 그 스냅에 붙일 짧은 타이틀(요청) — 문장 대신 "정구가 Rex를 공격" 한 마디다.

     한 스냅에 beat가 여럿이면 첫 번째(가장 이른 것)만 말한다 — 나머지는 그림이 같은
     자리에 함께 그려 주고, 여기서 이어 붙이면 다시 문장이 된다. 갈래에 안 걸리는 beat는
     null이라 자막 자리에 시각만 남는다(요청: 정 타이틀도 없으면 시간만). */
  const sideName = (raws: string[] | undefined): { text: string; team: 1 | 2 | undefined } | null => {
    const names = (raws ?? []).map((r) => nameByRaw.get(r) ?? r).filter(Boolean);
    if (names.length === 0) return null;
    const team = teamByName.get(names[0]);
    // 여럿이 한 일은 이름을 늘어놓지 않고 편으로 부른다 — 짧아야 타이틀이다. 1:1에는
    // 팀이라는 말을 안 쓰므로(카드와 같은 규칙) 그때는 첫 이름만 쓴다.
    if (names.length > 1) {
      const duel = gameResult.summaryData?.duel === true;
      return { text: duel || !team ? names[0] : `${team}팀`, team };
    }
    return { text: names[0], team };
  };
  const titleOf = (sn: { beats: number[]; parts: SummaryPart[] }): SummaryPart[] => {
    const beats = gameResult.summaryData?.beats ?? [];
    const b = sn.beats.map((i) => beats[i]).find(Boolean);
    // beat 없이 만든 자막(시작 인사·맺음의 승패 선언)은 원래 글이 곧 타이틀이다 — 여기서
    // null을 돌려주던 탓에 마지막 "1팀 승리"가 통째로 빈 자막이 됐다(지적).
    if (!b) return sn.parts;
    const who = sideName(b.who);
    const whom = sideName(b.whom);
    const p = (text: string, team?: 1 | 2): SummaryPart => (team ? { text, team } : { text });
    /* 조사는 이름 뒤에 붙지만 색은 이름에만 입힌다 — 조사까지 팀 색으로 칠하면 이름의
       끝이 어디인지가 흐려진다. 그래서 조사만 떼어 다음 조각의 머리에 붙인다. */
    const gaOf = (n: { text: string }) => ga(n.text).slice(n.text.length);
    const reulOf = (n: { text: string }) => reul(n.text).slice(n.text.length);
    if (TITLE_CLASH.has(b.k)) {
      const duel = gameResult.summaryData?.duel === true;
      /* 붙었다는 사실만으로는 장면의 절반만 말한 것이다(요청: 교전에서 결과까지 타이틀에 —
         "양팀 교전" 대신 "1팀이 크게 이김"). 요약이 이미 그 답을 싣고 있다: p.hold가 싸움
         뒤 그 자리를 지킨 쪽이고("a"는 who[0] 쪽, "b"는 who[1] 쪽), 편별 참가자 명단
         (partsA/partsB)이 그 쪽이 누구누구인지를 말한다. 자리를 지킨 쪽이 없으면(draw)
         비긴 싸움이라 이긴 편을 부르지 않는다. */
      const hold = (b.p as { hold?: string } | undefined)?.hold;
      const partsA = (b.p as { partsA?: string[] } | undefined)?.partsA;
      const partsB = (b.p as { partsB?: string[] } | undefined)?.partsB;
      const winnerRaws = hold === "a" ? (partsA ?? (b.who ?? []).slice(0, 1))
        : hold === "b" ? (partsB ?? (b.who ?? []).slice(1, 2)) : null;
      const win = winnerRaws ? sideName(winnerRaws) : null;
      const head = duel ? "교전" : "양팀 교전";
      if (hold === "draw" || !win) return [p(`${head} — 팽팽`)];
      /* 큰 싸움이었나 — 여럿이 얽힌 난전(p.people)이면 "크게"를 붙인다. 둘이 부딪친 것과
         일곱이 엉킨 것을 같은 말로 적으면 그 판의 절정이 어디였는지가 안 보인다. */
      const big = ((b.p as { people?: number } | undefined)?.people ?? 0) >= 4;
      return [p(`${head} — `), p(win.text, win.team), p(`${gaOf(win)} ${big ? "크게 " : ""}이김`)];
    }
    const verb = TITLE_ATTACK.has(b.k) ? "공격"
      : TITLE_HARASS.has(b.k) ? "견제"
        : TITLE_SUPPORT.has(b.k) ? "지원" : null;
    if (verb && who) {
      return whom
        ? [p(who.text, who.team), p(`${gaOf(who)} `), p(whom.text, whom.team), p(`${reulOf(whom)} ${verb}`)]
        : [p(who.text, who.team), p(`${gaOf(who)} ${verb}`)];
    }
    if (TITLE_DEFEND.has(b.k) && who) return [p(who.text, who.team), p(`${gaOf(who)} 방어`)];
    if (TITLE_HOLD.has(b.k) && who) return [p(who.text, who.team), p(`${gaOf(who)} 센터 장악`)];
    const solo = TITLE_SOLO[b.k];
    if (solo && who) return [p(who.text, who.team), p(` ${solo}`)];
    if (solo) return [p(solo)];
    // 어느 갈래에도 안 걸리는 beat — 그래도 시각만 남기지는 않는다(요청). 원래 요약 글을
    // 그대로 쓴다: 길더라도 "무슨 장면인지 모르겠다"보다는 낫다.
    return sn.parts;
  };

  /** 그 문장이 가리키는 시각(분) — 문장에 묶인 beat 가운데 가장 이른 것을 쓴다. 시각이
   *  없는 문장(맺음말 등)은 null이라 아무것도 안 붙는다. */
  const capMin = (sn: { beats: number[] }): string | null => {
    const beats = gameResult.summaryData?.beats ?? [];
    let at: number | null = null;
    for (const i of sn.beats) {
      const v = beats[i]?.at;
      if (typeof v === "number" && (at === null || v < at)) at = v;
    }
    if (at === null) return null;
    /* 분까지만 적던 것을 초까지 적는다(요청) — 한 분 안에 장면이 둘씩 들어가는 구간에서는
       "[12분]"이 연달아 나와 어느 쪽이 먼저인지 시각으로는 알 수 없었다. */
    const sec = Math.max(0, Math.round(at * SECONDS_PER_FRAME));
    return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
  };

  /** 지금 스냅이 가리키는 시점(프레임) — 여기까지 지나온 beat 가운데 가장 늦은 시각. 저장된
   *  '이사·망함' 시점과 견주는 잣대다. 맺음말 스냅은 경기 끝이므로 전부 지난 것으로 본다.
   *
   *  지금 문장의 beat만 보면 안 된다 — 맺음 문장(stand·gg 등)에는 시각이 아예 없어서 그
   *  스냅에서만 시계가 0으로 돌아갔고, 이사한 사람의 아바타가 시작 지점으로 되돌아갔다
   *  (지적). 시각은 한 번 흐르면 되돌아가지 않으므로 처음부터 훑어 가장 늦은 값을 쓴다. */
  const nowAt: number = useMemo(() => {
    if (index >= last) return Infinity;
    const beats = gameResult.summaryData?.beats ?? [];
    const upto = Math.max(-1, ...(sentences[index]?.beats ?? []));
    let at = 0;
    for (let i = 0; i <= upto && i < beats.length; i += 1) {
      const v = beats[i]?.at;
      if (typeof v === "number" && v > at) at = v;
    }
    return at;
  }, [gameResult.summaryData, sentences, index, last]);

  const downed: Set<string> = useMemo(() => {
    const beats = gameResult.summaryData?.beats ?? [];
    const upto = Math.max(-1, ...(sentences[index]?.beats ?? []));
    const out = new Set<string>();
    // 크게 망한 사람 — 건물·유닛 생산이 현저히 떨어져 끝까지 회복하지 못한 시점부터다
    // (요청). 저장된 값이라 beat로 이야기되지 않은 사람도 그림에는 제대로 나온다.
    for (const [raw, f] of Object.entries(gameResult.summaryData?.downs ?? {})) {
      if (f <= nowAt) out.add(raw);
    }
    for (let i = 0; i <= upto && i < beats.length; i += 1) {
      const b = beats[i];
      const who = b.who ?? [];
      const whom = b.whom ?? [];
      if (b.k === "fallen" || b.k === "gg") who.forEach((n) => out.add(n));
      else if (b.k === "raid-damage" && (b.p?.out === true || b.p?.early === true)) {
        whom.forEach((n) => out.add(n));
      // 다시 일어선 사람은 해골을 뗀다(요청: 부활한 거라면 해골을 없애고 부활한 내용이
      // 들어가야 한다) — beat로 붙은 것뿐 아니라 저장된 '망함' 시점으로 붙은 것도 지운다.
      } else if (b.k === "revival") who.forEach((n) => out.delete(n));
    }
    return out;
  }, [gameResult.summaryData, sentences, index, nowAt]);

  /** 지금 문장에 이름이 나온 사람들 — 그 사람 본진 아바타를 크게 키운다(요청). 스냅마다
   *  주인공이 바뀌는 것을 아바타 크기로 보여 주는 자리다. */
  const mentioned: Set<string> = useMemo(() => {
    const beats = gameResult.summaryData?.beats ?? [];
    const out = new Set<string>();
    // 시작 스냅("게임 시작!")은 특정 주인공이 없다 — 로스터가 빠진 자리라 전원을 키워서
    // 보여준다(요청: 아바타 및 닉네임 확대).
    const isIntro = index === 0 && sentences.length > 1 && (sentences[0]?.beats?.length ?? 0) === 0;
    if (isIntro) { slots.forEach((x) => out.add(x.raw)); return out; }
    for (const n of sentences[index]?.beats ?? []) {
      const b = beats[n];
      if (!b) continue;
      // 승패 스냅에서는 이긴 편 전원만 키운다(요청) — 그 자리는 "누가 이겼나"만 말한다.
      // 맺음말(result)은 그 앞의 전투 장면이라 여느 교전 스냅처럼 who·whom을 다 키운다.
      if (b.k === "verdict") {
        const team = slots.find((x) => (b.who ?? []).includes(x.raw))?.team;
        if (team) slots.filter((x) => x.team === team).forEach((x) => out.add(x.raw));
        continue;
      }
      [...(b.who ?? []), ...(b.whom ?? [])].forEach((raw) => out.add(raw));
      // ally-cannon은 도움받은 아군이 whom이 아니라 who2에 실린다(지적: 아군 헬프면 도움
      // 받은 사람 아바타도 커져야 하는데 ally-cannon만 안 커졌다) — ally-help는 whom이라
      // 위 줄에서 이미 잡힌다. clash도 마찬가지로, 누구 기지에서 붙었는지가 who2에 실린다
      // (지적: "태섭의 기지에서 …싸웠다"인데 정작 태섭은 아바타도 안 커지고 표정도 없었다
      // — 제 기지가 싸움터가 된 사람도 이 장면의 주인공이다).
      if (b.k === "ally-cannon" || b.k === "clash") {
        (Array.isArray(b.who2) ? b.who2 : typeof b.who2 === "string" ? [b.who2] : [])
          .forEach((raw) => out.add(raw));
      }
      // 큰 싸움에 상당 부분 참여한 사람은 모두 그 장면의 주인공이다(요청) — 자막이 이름을
      // 다 부르므로 아바타도 다 커져야 글과 그림이 맞는다.
      if (b.k === "clash") {
        for (const key of ["partsA", "partsB"] as const) {
          const v = b.p?.[key];
          if (Array.isArray(v)) v.forEach((raw) => { if (typeof raw === "string") out.add(raw); });
        }
      }
      // 협공에 가세한 사람(who2)도 이 장면의 주인공이다(지적: "○○까지 달려들어"에서
      // 가세한 사람 아바타가 안 커졌다) — actions useMemo의 helpers 계산과 같은 조건.
      if (ATTACK_BEAT_KEYS.has(b.k) || b.k === "breakthrough") {
        (Array.isArray(b.who2) ? b.who2 : typeof b.who2 === "string" ? [b.who2] : [])
          .forEach((raw) => out.add(raw));
      }
    }
    return out;
  }, [gameResult.summaryData, sentences, index, slots]);

  /* 본진을 잃고 아군 기지로 살림을 옮긴 사람(요청: 본진을 버리고 이동한 경우 본진은 흑백
     처리하고 새 기지에 마크를 옮겨야 한다). lodging beat의 who2가 집주인이고, p.lost가 그
     사람이 원래 자리를 잃었다는 표시다(replayTactics의 lodging 주석). 그 스냅부터 계속
     옮겨 둔 채로 본다 — 한 번 쫓겨난 사람이 다음 장면에서 제자리로 돌아오면 안 된다. */
  const movedPair: { to: Map<string, [number, number]>; from: Map<string, [number, number]> } = useMemo(() => {
    const beats = gameResult.summaryData?.beats ?? [];
    const spots = gameResult.summaryData?.bases ?? {};
    const upto = Math.max(-1, ...(sentences[index]?.beats ?? []));
    const out = new Map<string, [number, number]>();
    // 옮겨 오기 직전에 살던 자리 — 이사 화살표의 출발점이다(요청: 하얀 점선 화살표).
    const prev = new Map<string, [number, number]>();
    // 이사 — 주로 건물을 짓는 자리가 바뀌면 옮긴 것이다(요청). 여러 번 옮겼으면 그 시점까지
    // 지나온 마지막 자리가 지금의 집이다(요청: 이사는 여러 번 할 수도 있다).
    for (const [raw, list] of Object.entries(gameResult.summaryData?.moves ?? {})) {
      for (const m of list) {
        if (m[2] > nowAt) continue;
        const before = out.get(raw) ?? (spots[raw] ? [spots[raw][0], spots[raw][1]] as [number, number] : null);
        if (before) prev.set(raw, before);
        out.set(raw, [m[0], m[1]]);
      }
    }
    // 아군 기지로 살림을 옮긴 경우 — 집주인 아바타와 겹치지 않게 가운데 쪽으로 조금 비켜 앉힌다.
    const w = grid?.width ?? 128;
    const h = grid?.height ?? 128;
    for (let i = 0; i <= upto && i < beats.length; i += 1) {
      const b = beats[i];
      if (b.k !== "lodging" || b.p?.lost !== true) continue;
      const host = typeof b.who2 === "string" ? b.who2 : null;
      const at = host ? spots[host] : null;
      if (!at) continue;
      const dx = w / 2 - at[0];
      const dy = h / 2 - at[1];
      const len = Math.hypot(dx, dy) || 1;
      (b.who ?? []).forEach((raw) => {
        const before = out.get(raw) ?? (spots[raw] ? [spots[raw][0], spots[raw][1]] as [number, number] : null);
        if (before) prev.set(raw, before);
        out.set(raw, [at[0] + (dx / len) * LODGING_OFFSET_TILES, at[1] + (dy / len) * LODGING_OFFSET_TILES]);
      });
    }
    // 이사 간 자리에 원주민이 살아 있으면 아바타가 겹친다(지적: 원주민이 살아있는 곳에
    // 이사를 간 경우 원래 주인과 겹치지 않게) — 상대가 지금 사는 자리는 애초에 이사
    // 목적지에서 빠지지만(replaySummary의 relocations 주석), 아군 자리로 옮기는 것은
    // 막지 않으므로 여기서 겹칠 수 있다. 위 셋방살이와 같은 요령으로, 옮겨 온 쪽만 가운데
    // 쪽으로 살짝 비켜 앉힌다. 원주민이 이미 무너진 채라면(downed) 자리를 굳이 비키지
    // 않는다 — 살아 있는 사람과 겹치는 것만 문제다.
    const posOf = (raw: string): [number, number] | null => (
      out.get(raw) ?? (spots[raw] ? [spots[raw][0], spots[raw][1]] : null)
    );
    for (const [raw, pos] of [...out]) {
      const native = slots.find((s) => {
        if (s.raw === raw || downed.has(s.raw)) return false;
        const p = posOf(s.raw);
        return p !== null && Math.hypot(p[0] - pos[0], p[1] - pos[1]) < NATIVE_OVERLAP_TILES;
      });
      if (!native) continue;
      const dx = w / 2 - pos[0];
      const dy = h / 2 - pos[1];
      const len = Math.hypot(dx, dy) || 1;
      out.set(raw, [pos[0] + (dx / len) * LODGING_OFFSET_TILES, pos[1] + (dy / len) * LODGING_OFFSET_TILES]);
    }
    return { to: out, from: prev };
  }, [gameResult.summaryData, sentences, index, nowAt, grid, slots, downed]);
  const moved = movedPair.to;

  /* 지금 스냅에서 벌어진 일을 화살표로 잇는다 — 본진에서 '어디로 갔는가'까지(요청).

     자리를 저장된 명령 좌표(beat.pos)에서 뽑던 것을 걷어냈다 — 지적: 공격인데 화살표가 아군
     기지나 자기 본진에 꽂히는 경우가 더 많고, 아무도 없는 곳으로 가는 경우도 많았다. 원인은
     명령 좌표 자체다: 사람은 병력을 자기 집 앞에 모으고, 화면을 끌면서 빈 땅을 찍고, 리콜은
     '데려올 병력이 있는 자기 기지'를 찍는다(지적: 리콜이 자기 기지로 향한다). 그 좌표 뭉치의
     중심은 '무엇을 쳤는가'와 별로 관계가 없다.

     그래서 확실한 지점만 쓴다. 우선순위:
       ① 건물 자리 분류(p.spot) — 상대 본진/상대 입구/센터/내 입구/아군 기지처럼 이미 판정해
          둔 값이다(replayTactics의 spot()).
       ② 당한 사람의 본진 — 누가 맞았는지 아는 beat는 그 사람 집이 곧 목표다.
       ③ 공격 beat인데 당한 사람을 모르면 가장 가까운 상대 본진 — 틀릴 수는 있어도 최소한
          '상대 쪽'이다. 리콜·커널·드랍이 여기 걸린다.
       ④ 그 밖(병력을 뽑았다·물량을 모았다처럼 목표가 없는 이야기)은 맵 가운데 쪽으로 조금
          나가는 화살표 — 진출하는 느낌만 준다(요청). 특정 지점을 찍지 않으므로 틀릴 것도
          없다. */
  const actions = useMemo<{
    arrows: MinimapArrow[]; marks: Map<string, string>; markTexts: Map<string, string>;
    markSpots: Map<string, [number, number]>; faces: Map<string, string>;
  }>(() => {
    const empty = {
      arrows: [], marks: new Map<string, string>(), markTexts: new Map<string, string>(),
      markSpots: new Map<string, [number, number]>(), faces: new Map<string, string>(),
    };
    const beats = gameResult.summaryData?.beats;
    const idx = sentences[index]?.beats;
    if (!beats || !idx) return empty;
    const spots = gameResult.summaryData?.bases ?? {};
    const hubs = gameResult.summaryData?.hubs ?? {};
    const teamOf = new Map(slots.map((s) => [s.raw, s.team]));
    /* 저장된 자리 값을 믿어도 되는 요약인가 — 옛 요약(v1)의 pos는 '그 무렵 찍은 명령의
       중심'이라 일꾼의 자원 클릭과 건물의 랠리가 섞여 대부분 제 집을 가리킨다. 새 뜻으로
       읽으면 화살표가 자기 기지로 향한다(지적). 옛 경기는 제어판의 '경기 재분석'을 돌리면
       새 값으로 바뀐다. */
    const posTrusted = (gameResult.summaryData?.v ?? 0) >= POS_TRUSTED_VERSION;
    // 일대일이고 아무도 멀티를 늘리지 않은 판이면 화살표를 상대 진영 안까지 과감하게
    // 넣는다(요청) — 목표가 본진 하나뿐이라 어디를 가리키는지 헷갈릴 일이 없다. 멀티가
    // 있으면 실제로 그 멀티를 쳤을 수 있으므로 예전처럼 진영 앞에서 멈춘다.
    const deep = gameResult.summaryData?.duel === true
      && !beats.some((b) => b.k === "expand");
    const w = grid?.width ?? 128;
    const h = grid?.height ?? 128;
    const center: [number, number] = [w / 2, h / 2];
    const homeOf = (raw: string): [number, number] | null => {
      // 살림을 옮긴 사람은 새 자리에서 나간다(요청: 새 기지로 마크를 옮긴다) — 이미 버린
      // 본진에서 화살표가 출발하면 그림이 거짓이 된다.
      const to = moved.get(raw);
      if (to) return to;
      const v = spots[raw];
      return v ? [v[0], v[1]] : null;
    };
    /** 화살표가 '그 사람에게로' 갈 때 겨눌 자리 — 아바타(시작 지점)가 아니라 그 사람
     *  살림의 한가운데다(지적: 타겟이 특정 안 될 때 아바타를 향하는 건 부적절하고 본진
     *  중앙을 향하는 게 자연스럽다). 아바타는 시작 지점에 서 있는 사람 표시라 화살촉이
     *  얼굴을 덮고, 실제로 병력이 향한 곳도 그 사람의 건물이 선 자리다. 살림을 옮겼으면
     *  옮긴 자리, 살림 한가운데를 모르는 옛 요약이면 예전처럼 시작 지점이다. */
    const hubOf = (raw: string): [number, number] | null => {
      const to = moved.get(raw);
      if (to) return to;
      const h = hubs[raw];
      if (h) return [h[0], h[1]];
      return homeOf(raw);
    };
    /** a에서 b쪽으로 t만큼 간 자리. */
    const lerp = (a: [number, number], b: [number, number], t: number): [number, number] =>
      [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const dist = (a: [number, number], b: [number, number]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    /** 그 사람에게 가장 가까운 상대(다른 편) 본진. */
    const nearestFoe = (raw: string): [number, number] | null => {
      const home = homeOf(raw);
      const team = teamOf.get(raw);
      if (!home || !team) return null;
      let best: [number, number] | null = null;
      for (const s of slots) {
        if (s.team === team) continue;
        const p = hubOf(s.raw);
        if (!p) continue;
        if (best === null || dist(home, p) < dist(home, best)) best = p;
      }
      return best;
    };
    /** 그 사람에게 가장 가까운 아군(자기 제외) 본진. */
    const nearestAlly = (raw: string): [number, number] | null => {
      const home = homeOf(raw);
      const team = teamOf.get(raw);
      if (!home || !team) return null;
      let best: [number, number] | null = null;
      for (const s of slots) {
        if (s.raw === raw || s.team !== team) continue;
        const p = hubOf(s.raw);
        if (!p) continue;
        if (best === null || dist(home, p) < dist(home, best)) best = p;
      }
      return best;
    };
    // '입구'는 본진에서 가운데 쪽으로 이만큼 나온 자리로 본다 — 정확한 입구 좌표는 지형 표가
    // 없어 알 수 없지만(ReplayMapCanvas 주석), 입구는 늘 본진과 가운데 사이에 있다.
    const FRONT = 0.24;
    /* 입구 이모지는 화살표가 겨누는 '입구 앞'보다 조금 더 나가 선다(요청: 입구막기는 좀
       더 입구 쪽으로) — 화살표의 FRONT는 '이 언저리를 쳤다'는 넉넉한 겨냥이지만, 이쪽은
       거기 벽이 서 있다는 표시라 본진 살림에서 확실히 떨어져야 벽으로 읽힌다. */
    const MARK_FRONT = 0.38;

    /* 그 자리가 '상대 쪽'인가 — 내 집보다 상대 집에 가까워야 공격으로 읽는다.
       자리 값만으로는 진출과 멀티·집결이 안 갈린다(지적: 견제·드랍인데 화살표가 내 기지
       쪽이다). 실측으로 확인했다: 캐리어를 모은 자리가 내 집에서 22타일, 상대 집에서는
       88타일이었다 — 그건 제 앞마당이지 공격이 아니다. */
    const towardFoe = (raw: string, at: [number, number]): boolean => {
      const home = homeOf(raw);
      if (!home) return false;
      const mine = teamOf.get(raw);
      let best = Infinity;
      for (const s of slots) {
        if (!mine || s.team === mine) continue;
        const h = homeOf(s.raw);
        if (h) best = Math.min(best, dist(at, h));
      }
      // 상대를 못 찾는 판(팀을 못 가른 기록)에서는 막지 않는다 — 근거가 없으면 예전대로 둔다.
      if (best === Infinity || best <= dist(at, home)) return true;
      /* 맵 한가운데도 나간 것으로 본다(요청: 진출은 센터도 진출한 걸로) — 센터 싸움은
         제 본진보다 상대 본진에 더 가깝지 않은 경우가 흔하다. 대칭 맵에서 가운데는 양쪽에서
         같은 거리라, 위 비교만으로는 아슬아슬하게 떨어져 화살표가 통째로 안 그려졌다.
         반경은 요약이 진출을 판정할 때 쓴 것과 같은 값이다(replaySummary의 SORTIE_RADIUS). */
      return dist(at, center) < CENTER_TILES;
    };

    /** 그 집의 '앞마당 안쪽'을 재는 자 — 가장 가까운 다른 본진까지 거리의 이만큼. */
    const YARD = 0.3;
    const yardOf = (h: [number, number]): number => {
      let near = Infinity;
      for (const s2 of slots) {
        const p = homeOf(s2.raw);
        if (p && dist(p, h) > 1) near = Math.min(near, dist(p, h));
      }
      return Number.isFinite(near) ? Math.max(ARROW_MIN_TILES, near * YARD) : ARROW_MIN_TILES;
    };

    const target = (b: (typeof beats)[number], raw: string): [number, number] | null => {
      const home = homeOf(raw);
      if (!home) return null;
      // 때린 사람이 whom이 아니라 p.by에 실린 문장들(replaySummary의 by 주석 — whom으로
      // 실으면 '이 사람이 당했다'가 뒤집힌다) — 그래서 여기서 따로 잡는다. 목표는 당한
      // 사람(who[0])의 집이다.
      if (BY_ATTACKER_KEYS.has(b.k) && b.p?.by === raw) {
        const victim = (b.who ?? [])[0] ?? "";
        /* 이사는 '옮기기 전 집'이 두들겨 맞은 자리다 — 지금 집(hubOf)은 밀려나서 새로
           편 살림이라, 그리로 화살표를 그으면 아직 벌어지지도 않은 일을 가리킨다. */
        const victimHome = (b.k === "relocate" ? movedPair.from.get(victim) : null) ?? hubOf(victim);
        if (victimHome) return victimHome;
      }
      const foe = nearestFoe(raw);
      const ally = nearestAlly(raw);
      const attack = ATTACK_BEAT_KEYS.has(b.k) || b.k === "breakthrough";
      const spot = typeof b.p?.spot === "string" ? b.p.spot : null;
      /** 마법·드랍이 실제로 떨어진 자리 — 리플레이에 좌표가 그대로 적혀 있어(리콜·셔틀 등)
       *  어림한 어떤 값보다 정확하다. */
      const raw_xy = b.p?.xy;
      const xy: [number, number] | null = posTrusted && Array.isArray(raw_xy) && raw_xy.length === 2
        && typeof raw_xy[0] === "number" && typeof raw_xy[1] === "number"
        ? [raw_xy[0], raw_xy[1]] : null;
      /** 자막이 지목한 상대 — 그 사람 집이 곧 목표다. 8인용 맵에서는 '상대 진영'이 여럿이라
       *  자리 분류(enemyBase)만 믿고 가장 가까운 상대를 고르면 자막과 다른 곳을 가리켰다
       *  (지적: 공격 대상을 잘못 타겟팅해서 자막과 다른 곳에 화살표가 향한다). */
      const namedFoe = (b.whom ?? [])
        .find((v) => v !== raw && teamOf.get(v) && teamOf.get(v) !== teamOf.get(raw));
      const named = (() => {
        const vs = (b.whom ?? []).filter((v) => v !== raw);
        const pick = namedFoe ?? vs[0];
        return pick ? hubOf(pick) : null;
      })();
      /* 리콜·커널처럼 '여기서 저기로 건너간' 수는 화살표가 본진에서 상대에게로 이어져야
         그림이 읽힌다(요청). 마법을 쓴 좌표·문을 뚫은 좌표는 대개 제 진영 언저리라, 그걸
         목표로 삼으면 제 집 옆에서 짧게 끝나는 화살표가 된다(실측 스크린샷: 리콜 회오리가
         제 본진 바로 옆에 붙어 있었고, 커널 화살표는 자막이 부른 타센 쪽으로 가다 중간에
         멈췄다). 자막이 부른 상대가 있으면 그 사람 집이 목표다 — 출발 자리는 아래에서
         회오리·구멍 이모지로 따로 표시한다. */
      /* 다만 '싸우고 있는 자리에 부은' 리콜은 다르다(p.fight — replayTactics의 리콜 주석):
         제 진영을 지키러 부른 것이거나 한복판 싸움에 병력을 쏟아 넣은 것이라, 상대 집을
         가리키면 화살표가 자막과 정반대 방향으로 뻗는다. 그런 리콜은 아래 좌표 갈래로
         내려가 그 싸움터를 가리키고, 상대 화살표도 같은 점으로 모인다. */
      if (WARP_BEAT_KEYS.has(b.k) && namedFoe && b.p?.fight !== true) {
        const to = hubOf(namedFoe);
        /* 도착 자리를 정확히 아는 경우 — 상대 진영에 뚫은 커널의 좌표(replayTactics의
           nydus)다. 그 사람 진영 안쪽일 때만 쓴다: 자막이 부른 사람과 다른 곳에 찍힌
           좌표라면 그건 이 수의 도착점이 아니다(지적: 커널의 자막과 실제 도착 위치가
           달랐다). 아니면 그 사람 본진을 목표로 삼는다. */
        if (to && xy && dist(xy, to) <= yardOf(to)) return xy;
        if (to) return to;
      }

      /* 자리를 아는 것이 최우선이다(요청: 위치가 파악된 건 무조건 정확한 위치를 표시).
         p.xy는 어림이 아니라 리플레이에 그대로 적힌 좌표다 — 마법을 쓴 자리, 셔틀이 내린
         자리, 탱크를 세운 자리, 상대 유닛을 찍은 자리. 본진 한복판을 가리키는 것보다 늘
         정확하다.

         한때 이 값을 자막이 부른 사람보다 뒤로 미뤘던 적이 있다. 좌표와 자막이 서로 다른
         곳을 가리키는 일이 있어서였는데, 그 원인은 좌표가 아니라 '누구를'을 엉뚱하게 고른
         쪽이었다 — 이제 그 이름도 같은 좌표에서 나오므로(replayTactics의 castAt·dropSpot,
         replaySummary의 withStrike·placeFits) 둘이 어긋나지 않는다. */
      /* 제 집 안에 부은 리콜·커널은 화살표로 그릴 것이 없다(지적: 리콜 이동 위치가 자기
         본진인 경우가 있어 이상하다) — 출발도 도착도 같은 자리라 화살표가 제자리를 맴돈다.
         실제로 있는 일이다(제 진영을 지키러 부르는 리콜) — 그러니 지우지 않고, 자리
         표시(이모지)만 그 집에 남기고 화살표는 안 그린다. */
      if (WARP_BEAT_KEYS.has(b.k) && xy && dist(home, xy) <= yardOf(home)) return null;
      if (xy) return xy;
      const foeHome = namedFoe ? hubOf(namedFoe) : null;
      // 자리를 모르면 자막이 부른 상대의 집이 목표다.
      if (foeHome && (attack || spot === "enemyBase" || spot === "enemyFront")) {
        return spot === "enemyFront" ? lerp(foeHome, center, FRONT) : foeHome;
      }
      // 센터에서 벌어진 일은 맵 가운데로(요청) — 건물 자리 분류보다 이 판정이 확실하다.
      if (CENTER_BEAT_KEYS.has(b.k)) return center;
      if (named && (spot === "enemyBase" || spot === "enemyFront")) {
        return spot === "enemyBase" ? named : lerp(named, center, FRONT);
      }
      /* 자리 분류만 있고 '누구'가 없으면 가장 가까운 상대·아군으로 때우지 않는다(지적:
         타겟이 확정 안 되는데 화살표가 있는 것도 이상하다). 일대일은 예외다 — 상대가
         한 사람뿐이라 '가장 가까운 상대'가 곧 그 상대다. */
      const only = gameResult.summaryData?.duel === true;
      switch (spot) {
        case "enemyBase": return only ? foe : null;
        case "enemyFront": return only && foe ? lerp(foe, center, FRONT) : null;
        case "mid": return center;
        case "myBase": return home;
        case "myFront": return lerp(home, center, FRONT);
        case "allyBase": return only ? ally : null;
        case "allyFront": return only && ally ? lerp(ally, center, FRONT) : null;
        default: break;
      }
      // 아군을 도우러 간 것 — 목표는 그 아군의 기지다(요청: 아군 헬프). ally-help는
      // 도움받은 아군을 whom에 담고, ally-cannon(포토 지원)은 who2에 담는다 — 만든
      // 자리가 달라서다(지적: 포토 지원은 화살표 없이 제 기지에 얼굴만 떴다 — target()이
      // ally-cannon의 who2를 안 보고 있었다).
      if (b.k === "ally-help" || b.k === "ally-cannon") {
        const mates = b.k === "ally-help" ? (b.whom ?? [])
          : Array.isArray(b.who2) ? b.who2 : typeof b.who2 === "string" ? [b.who2] : [];
        /* 도움받은 아군이 누구인지 모르면 화살표를 안 그린다(지적: 애초에 타겟이 확정
           안 되는데 화살표가 있는 것도 이상하다) — 예전에는 '가장 가까운 아군'으로
           때웠는데, 그건 근거가 아니라 추측이라 옆 사람 쪽으로 잘못 그어졌다. */
        const mate = mates.find((v) => v !== raw && hubOf(v));
        return mate ? hubOf(mate) : null;
      }
      /* 그 사람이 그 무렵 실제로 병력을 보낸 자리(beat.pos) — 이제 이 값이 믿을 만하다.
         명령마다 주인을 짚게 되면서(replayParser의 orderPositions.by) 일꾼이 자원 캐러 찍은
         것과 건물이 랠리를 찍은 것을 빼고, 어택 지정만 따로 골라 쓰기 때문이다. 예전에는
         이 좌표가 집 언저리 클릭에 끌려가 엉뚱한 곳을 가리켜 걷어냈던 자리인데(아래 옛
         주석), 근거가 달라졌으므로 되살린다.

         집에서 화살표를 그릴 만큼 떨어져 있을 때만 쓴다 — 그게 곧 '실제로 나갔다'는
         증거다(요청: 유닛을 뽑기만 한 것에는 화살표 X, 확실히 공격 나갔을 때만). 그래서
         공격 이야기가 아니어도(캐리어를 모았다·물량을 뽑았다) 병력이 실제로 나간 자리가
         있으면 그리로 잇는다 — 지적: 대부분의 병력 운용이 타겟을 못 잡고 본진 아이콘으로
         끝난다. 집에서 한 일(테크·경제·방어·이사)은 아래 표로 빼 둔다. */
      const sent = posTrusted && !HOME_BEAT_KEYS.has(b.k) ? b.pos?.[raw] : undefined;
      if (Array.isArray(sent) && sent.length === 2
        && dist(home, [sent[0], sent[1]]) >= ARROW_MIN_TILES
        && towardFoe(raw, [sent[0], sent[1]])) {
        return [sent[0], sent[1]];
      }
      // 여기부터는 '실제로 병력을 몰고 나간' 이야기만 화살표를 받는다(지적: 가끔 내용과
      // 화살표가 반대다 — 공격을 당한 건데 간 것으로 나온다). 막아 냈다·무너졌다·일꾼이
      // 밀렸다 같은 문장에도 whom이 붙어 있어서, 그것을 목표로 삼으면 맞은 사람에서
      // 때린 사람 쪽으로 화살표가 거꾸로 그려졌다.
      if (!attack) return null;
      // 당한 사람의 본진 — 위에서 이미 골라 뒀다(자막이 지목한 상대가 먼저다).
      if (named) return named;
      // 일대일이면 상대가 한 사람뿐이라, 자막이 이름을 안 불러도 그 사람이 목표다(지적:
      // 공격에 대한 타겟팅이 거의 안 된다).
      if (gameResult.summaryData?.duel === true && foe) return foe;
      /* 팀전에서 자막이 아무도 안 부른 공격(러시·패스트 OO)에는 화살표를 안 그린다.
         한때 '가장 가까운 상대 진영 앞'까지 그어 방향만 말해 봤지만, 그건 근거 없는 추측이라
         (지적) 그럴듯한 만큼 더 잘못 읽힌다 — 옆 사람을 친 러시도 늘 옆집을 가리켰다.
         정말로 누구를 쳤는지는 이제 요약이 안다: 상대 유닛을 직접 찍은 기록이 있으면
         replaySummary의 withStrike가 그 이름과 자리를 beat에 실어 주고, 그러면 위쪽
         '자막이 부른 사람' 갈래에서 정확한 목표로 잡힌다. 그 기록조차 없다는 건 실제로
         부딪친 적이 없다는 뜻이라, 화살표가 없는 것이 맞다. */
      // 그 밖(유닛을 뽑았다·물량을 모았다·테크를 올렸다)은 화살표를 그리지 않는다(요청:
      // 유닛 생산에는 화살표 X, 실제로 확실히 공격 나갔을 때만 진출 화살표). 진출 느낌을
      // 주려고 가운데로 짧게 그어 봤지만, 병력을 뽑기만 한 장면에도 화살이 나가서
      // '공격을 갔다'로 읽혔다.
      return null;
    };

    /** 그 사람이 그 무렵 무엇으로 싸웠나 — 화살표 모양(공중=곧은 점선 / 지상=휜 실선)을
     *  정한다. 협공에 이름만 불린 사람에게 쓰는 값이다: 그 문장의 beat는 주공격자가 무엇으로
     *  갔는지만 담고 있어서, 그것을 그대로 쓰면 뮤탈로 온 사람과 걸어온 사람이 똑같은
     *  점선이 된다(지적). 요약 전체에서 그 사람이 주어인 공격·이동 beat 중 이 시점에 가장
     *  가까운 것을 찾아 그 수의 모양을 준다. 그런 beat가 하나도 없으면(정말 이름만 불린
     *  경우) 지상으로 본다 — 없는 근거로 점선을 그리느니 기본값이 낫다. */
    const styleOf = (raw: string, at: number | null | undefined): boolean => {
      let best: { d: number; f: boolean } | null = null;
      for (const b of beats) {
        if (!(b.who ?? []).includes(raw)) continue;
        if (!ATTACK_BEAT_KEYS.has(b.k) && !isFlight(b.k, b.p?.k)) continue;
        const d = typeof at === "number" && typeof b.at === "number"
          ? Math.abs(b.at - at) : Number.POSITIVE_INFINITY;
        if (!best || d < best.d) best = { d, f: isFlight(b.k, b.p?.k) };
      }
      return best?.f ?? false;
    };

    // 한 문장에 여러 beat가 들어가면 같은 사람이 여러 번 나올 수 있다 — 뒤에 오는 것(더
    // 나중의 일)이 이긴다. 당한 사람은 뺀다: 맞은 쪽에서 나가는 화살표는 이야기가 아니다.
    /** 그 beat에 붙일 이모지 — 표에 없으면 공격 계열은 검 대결, 그 밖은 생산으로 채운다.
     *  b.k가 "tech"면 어떤 마법을 썼는지(p.tech)로 더 세분화한다(요청: 스톰은 번개,
     *  이레디에이트는 독가스처럼 기술마다 맞는 이모지). */
    const markOf = (b: (typeof beats)[number]): string => {
      if (b.k === "tech" && typeof b.p?.tech === "string" && TECH_MARK[b.p.tech]) {
        return TECH_MARK[b.p.tech];
      }
      return BEAT_MARK[b.k] ?? (ATTACK_BEAT_KEYS.has(b.k) ? "⚔️" : "🏭");
    };

    /* 그 표시가 '무엇으로 한 일'인가 — 화살표 기둥 위 이름표와 본진 이모지 밑 캡션이
       똑같이 쓰는 답이다(요청: 모든 화살표에는 유닛이나 건물명이 꼭 들어가야 하고, 공장
       이모지만 덩그러니 있으면 뭔지 모르겠고, 업그레이드에는 스킬 이름(공방업 포함)).

       업그레이드 이야기는 업그레이드 이름이 먼저다(요청: "질럿 하이템플러"가 아니라 "질럿
       속업 하이템플러 에너지업") — 그 장면에서 벌어진 일이 곧 그 연구라, 그때 굴리던 병력
       이름을 적으면 무슨 업그레이드였는지가 통째로 사라진다. 나머지 이야기는 units가
       1순위다(그 자리에 실제로 움직인 것). units가 비어 있는 옛 요약·명령의 주인이 안 잡힌
       경우를 위해, 이미 저장돼 있는 다른 재료로 차례로 메운다: 기술 이름 → 그 이야기의 건물
       → 그 이야기에 실린 병력 목록. 그래도 못 채우면 빈 배열이고, 그때만 이름표가 없다. */
    const labelOf = (b: (typeof beats)[number], raw: string): string[] => {
      const ko = (list: unknown): string[] => (Array.isArray(list) ? list : [])
        .map((u) => (typeof u === "string" ? UNIT_KO[u] ?? BUILDING_KO[u] ?? "" : ""))
        .filter(Boolean);
      const p = b.p as Record<string, unknown> | undefined;
      // 업그레이드는 유닛이 아니라 그 업그레이드 이름이 답이다 — 상징 업그레이드는 제 이름을
      // ("질럿 속업"), 공/방은 무엇을 몇 단계까지 올렸는지를 적는다("보병 3-3업").
      const sig = typeof p?.upgrade === "string" ? SIGNATURE_UPGRADE_KO[p.upgrade as keyof typeof SIGNATURE_UPGRADE_KO] : undefined;
      if (sig) return [sig];
      if (b.k === "upgrade" && typeof p?.w === "number" && typeof p?.a === "number") {
        const line = typeof p.line === "string" ? UPGRADE_LINE_KO[p.line] : undefined;
        return [`${line ? `${line} ` : ""}${p.w}-${p.a}업`];
      }
      const own = ko((b as { units?: Record<string, string[]> }).units?.[raw]);
      if (own.length > 0) return own;
      const tech = typeof p?.tech === "string" ? TECH_KO[p.tech] : undefined;
      if (tech) return [tech];
      const bs = typeof p?.bs === "string" ? ko(p.bs.split(","))
        : typeof p?.b === "string" ? ko([p.b]) : [];
      if (bs.length > 0) return bs;
      /* 큰 싸움은 편별로 나뉘어 실린다 — forceA는 who[0](이긴 편) 쪽, forceB는 who[1] 쪽이다.
         남의 편 병력을 제 이름표로 달면 안 되니 어느 쪽인지를 보고 고른다. */
      if (b.k === "clash") {
        const winSide = (b.p?.partsA as string[] | undefined) ?? [];
        const loseSide = (b.p?.partsB as string[] | undefined) ?? [];
        const pick = winSide.includes(raw) ? p?.forceA
          : loseSide.includes(raw) ? p?.forceB
            : (b.who ?? [])[0] === raw ? p?.forceA : (b.who ?? [])[1] === raw ? p?.forceB : undefined;
        const side = ko(pick);
        if (side.length > 0) return side;
      }
      const listed = ko(p?.units);
      if (listed.length > 0) return listed;
      return typeof p?.unit === "string" ? ko([p.unit]) : [];
    };

    const mark = new Map<string, string>();
    /* 그 이모지가 '무엇으로 한 일'인가 — 화살표가 있으면 기둥 위 이름표가 말해 주는데,
       화살표 없이 본진·입구에 이모지만 서는 이야기(방어·입구막기·생산)는 아무 말도 없었다
       (지적: 방패 이모지에도 유닛명·건물명·기술명을 캡션으로). 같은 재료(요약이 사람별로
       싣는 units)를 써서 이모지 아래에 그대로 붙인다. */
    const markLabel = new Map<string, string>();
    /** 그 이모지를 어느 타일에 세울까 — 위 mark와 짝을 이뤄 같은 자리에서 채운다.
     *  본진에서 한 일은 값이 없고(본진 자리 그대로), 입구 이야기만 진짜 입구 좌표가 들어간다. */
    const markSpot = new Map<string, [number, number]>();
    /** 한 사람이 이 스냅에서 실제로 때린 자리들 — 여러 곳을 쳤으면 여러 개가 쌓인다(요청:
     *  한 사람이 여러 곳에 피해를 준 경우 아바타 하나에서 화살표 여러 개로 갈라지게).
     *  예전에는 자리당 하나(Map<raw, target>)만 기억해 마지막 것만 그려졌다. */
    interface RawHit {
      t: [number, number]; flight: boolean; mark?: string; fromMark?: string; converge?: boolean;
      /** 기둥 굵기 — 그 무렵 그 사람이 굴린 병력 크기(beat.sizes)를 눈에 보이는 두께로. */
      width?: number;
      /** 아군을 도우러 간 길인가 — 목에 천사 날개를 단다(요청). */
      wing?: boolean;
      /** 기둥 위에 붙일 유닛·건물 이름(요청) — 요약이 사람마다 실어 준다(beat.units).
       *  한 줄에 하나씩 쌓이므로 이어 붙이지 않고 목록 그대로 넘긴다(요청). */
      label?: string[];
    }
    const hits = new Map<string, RawHit[]>();
    const hit = new Set<string>();
    // 맺음말 스냅에서는 이긴 편 아바타에 트로피를 겹쳐 얹는다(요청).
    const trophy = new Set<string>();
    /* 아바타에 겹쳐 얹는 상태 얼굴(요청: 해골·트로피 말고는 아바타에 붙는 표시가 없으니
     * 공격자·당한 사람도 아바타로 상태를 알려 달라) — 화살표 끝의 무기 이모지(무엇으로
     * 쳤나)와는 다른 자리다. 이건 "그 사람이 지금 어떤 처지인가"를 말한다.
     * 우선순위: 트로피 > 크게 무너짐 > 적당히 당함 > 잘 막아냄 > 공격자. */
    // 씩씩대는 얼굴(😤)도, 웃는 얼굴(😏)도 어색하다(지적: 웃음이 기분 나빠 보임) —
    // 선글라스로 자신감만 남긴다.
    const ATTACK_FACE = "😎";
    const SEVERE_FACE = "😭";
    const MODERATE_FACE = "😰";
    // 자신감(😎)은 막아낸 상황과는 결이 안 맞아 보여(지적) 경례로 바꾼다 — "막아냈다,
    // 문제없다"는 느낌이 선글라스보다 잘 읽힌다.
    const DEFENDED_FACE = "🫡";
    /** 막아서긴 했지만 결국 역부족이었던 것 — 힘겨워하는 표정(지적: 진 편의 stand까지
     *  자신감 얼굴을 주면 안 된다. "팀원과 함께 막아섰으나 역부족" 문장에 자신감은 어색함). */
    const STRUGGLE_FACE = "😣";
    /** 크게 무너진 것 — 본인이 주어(who)인 궤멸·기권. */
    const SEVERE_SUBJECT_KEYS = new Set(["fallen", "gg"]);
    /** 크게 무너진 것 — 방어가 뚫린 쪽(whom)이 이 사람. */
    const SEVERE_VICTIM_KEYS = new Set(["breakthrough"]);
    /** 적당히 당한 것 — 본인이 주어(who)지만 당한 쪽인 경우(쨀다가 공격당함 등). */
    const MODERATE_SUBJECT_KEYS = new Set(["greedy-punished"]);
    /** 막아낸 것 — 본인이 주어(who)고 버텼다. late-hold·standoff는 항상 승리 쪽 이야기라
     *  그대로 자신감이지만, stand는 진 편에도 붙는 beat라(지적: "…역부족"인데도 자신감
     *  얼굴이 붙었다) won을 봐야 한다. */
    const DEFENDED_ALWAYS_KEYS = new Set(["late-hold", "standoff", "hold-off"]);
    /** 공격하는 얼굴을 붙일 대상 — 옆탱은 이름과 달리 공격이라(지적) 여기 더한다. */
    // 맺음말도 그 마지막 싸움 이야기라 공격하는 얼굴을 준다(요청: 결론은 전투니까 다른
    // 스냅과 동일하게) — 트로피는 그 뒤 승패 스냅이 따로 얹는다.
    const ATTACKER_FACE_KEYS = new Set([
      ...ATTACK_BEAT_KEYS, "clash", "allin", "side-tank", "result",
    ]);
    /** 아군을 도우러 간 것 — 도와준 사람은 천사, 도움받은 사람은 감동으로 각자 얼굴이
     *  갈린다(지적: 화살표는 도움받은 기지로 잇고, 천사는 도와준 사람 아바타로, 도움받은
     *  사람 아바타에는 감동 얼굴을 준다). */
    const ALLY_HELP_KEYS = new Set(["ally-help", "ally-cannon"]);
    const HELPER_FACE = "😇";
    const HELPED_FACE = "🥹";
    /* 타이밍을 흘려보낸 스냅(idle-lead) — 병력을 쌓아 두고도 안 들어간 쪽에는 자는 얼굴을,
       그 사이 살림을 편 쪽에는 열심인 얼굴을 준다(요청). 이 스냅은 화살표가 없는 이야기라
       (아무도 어디로 가지 않았다) 아바타 얼굴이 유일한 그림이다. */
    const IDLE_FACE = "😴";
    const BUSY_FACE = "🔥";
    const severe = new Set<string>();
    const moderate = new Set<string>();
    const defended = new Set<string>();
    const struggling = new Set<string>();
    const attacker = new Set<string>();
    const helper = new Set<string>();
    const helped = new Set<string>();
    /** 타이밍을 놓친 쪽 / 그 사이 발전한 쪽(위 IDLE_FACE·BUSY_FACE). */
    const idling = new Set<string>();
    const busy = new Set<string>();
    /** 제 기지가 싸움터가 된 사람 — 그 자리에 얹는 표시는 공격(💥)이 아니라 방어(🛡️)다.
     *  때린 쪽 화살표가 이미 그 자리에 💥를 찍으므로, 집주인에게도 💥를 주면 같은 자리에
     *  같은 표시가 둘 겹친다. */
    const homeDefender = new Set<string>();
    for (const n of idx) {
      const b = beats[n];
      if (!b) continue;
      const victims = new Set(b.whom ?? []);
      /* 큰 싸움(clash)의 주체는 대표 둘이 아니라 상당 부분 참여한 사람 전부다(요청: 유닛보다
         누가 참여했는지를 다 나열하고 화살표도 그 사람들에게서 모이게) — 일곱이 얽힌
         대난전인데 화살표가 둘뿐이라 1:1처럼 보였다(지적한 스크린샷). 참가자를 안 실은
         옛 요약에서는 예전처럼 대표 둘만 쓴다. */
      const clashParts = b.k === "clash"
        ? [...(Array.isArray(b.p?.partsA) ? b.p.partsA : []),
          ...(Array.isArray(b.p?.partsB) ? b.p.partsB : [])].filter((v): v is string => typeof v === "string")
        : [];
      const who = clashParts.length > 0 ? clashParts : (b.who ?? []);
      // 아군 헬프는 whom(ally-help)/who2(ally-cannon)에 '도움받은 아군'이 실려 있다 —
      // 공격당한 것이 아니므로 아래 당한 사람 후보(hit)에는 넣지 않는다.
      if (!ALLY_HELP_KEYS.has(b.k)) {
        // 당한 사람은 일단 후보로만 잡아 둔다 — 아래에서 심함/적당 중 하나로 정리한다.
        for (const v of victims) if (!who.includes(v)) hit.add(v);
      } else {
        who.forEach((r) => helper.add(r));
        const helpedRaw = b.k === "ally-help" ? (b.whom ?? [])
          : Array.isArray(b.who2) ? b.who2 : typeof b.who2 === "string" ? [b.who2] : [];
        helpedRaw.forEach((r) => helped.add(r));
      }
      /* 타이밍 놓침 — 주어(who)가 쌓아 두고도 안 들어간 쪽이고, whom이 그 사이 멀티를
         늘린 쪽이다(replaySummary의 idleLead). 당한/때린 이야기가 아니라서 아래 표들에는
         안 걸린다 — 여기서 따로 잡는다. */
      if (b.k === "idle-lead") {
        who.forEach((r) => idling.add(r));
        (b.whom ?? []).forEach((r) => busy.add(r));
      }
      if (SEVERE_SUBJECT_KEYS.has(b.k)) who.forEach((r) => severe.add(r));
      if (SEVERE_VICTIM_KEYS.has(b.k)) victims.forEach((r) => severe.add(r));
      if (MODERATE_SUBJECT_KEYS.has(b.k)) who.forEach((r) => moderate.add(r));
      if (DEFENDED_ALWAYS_KEYS.has(b.k)) who.forEach((r) => defended.add(r));
      // stand는 이긴 편·진 편 모두에 붙는다 — won을 봐야 자신감/힘겨움이 갈린다.
      if (b.k === "stand") who.forEach((r) => (b.won ? defended : struggling).add(r));
      /* clash는 누구 기지에서 붙었느냐를 본다(지적: 아군 기지에서 벌어진 전투에 참여한
         것은 공격이 아니라 헬프로 봐야 한다) — 기지 주인(who2)이 같은 편이면 그 싸움에 낀
         사람은 아군을 도우러 온 것이고, 상대 편(또는 기지 없는 한복판 교전)이면 공격이다.

         집주인 자신은 어느 쪽도 아니다. 제 기지가 싸움터가 된 사람은 '도우러 온 아군'이
         아니라 공격받은 당사자다 — 그런데 "같은 편이면 헬프"라는 판정이 집주인 본인까지
         같이 걸어서, 제 본진에서 얻어맞은 사람에게 천사 얼굴이 붙었다(지적: 팍규 본진에서
         팍규와 태섭이 싸운 건데 팍규가 도우러 간 사람처럼 보인다). 직접 싸웠든 아니든
         당황한 얼굴을 준다. */
      if (b.k === "clash") {
        const owners = Array.isArray(b.who2) ? b.who2 : typeof b.who2 === "string" ? [b.who2] : [];
        owners.forEach((r) => { moderate.add(r); homeDefender.add(r); });
        const ownerTeam = owners.length > 0 ? teamOf.get(owners[0]) : undefined;
        who.forEach((r) => {
          if (victims.has(r) || owners.includes(r)) return;
          if (ownerTeam !== undefined && teamOf.get(r) === ownerTeam) helper.add(r);
          else attacker.add(r);
        });
      } else if (ATTACKER_FACE_KEYS.has(b.k)) {
        who.forEach((r) => { if (!victims.has(r)) attacker.add(r); });
      }
      // 맺음말 — 이긴 편 전원에게 트로피를 준다(요청: 승리 트로피는 아바타에 겹쳐서 크게).
      // 트로피는 승패 스냅이 전담한다(요청: 승패는 시작처럼 누가 이겼는지만 표시하는
      // 스냅으로 고정) — 맺음말은 그 앞의 전투 장면이라 다른 교전 스냅과 같은 표시를 받는다.
      if (b.k === "verdict") {
        const team = slots.find((x) => (b.who ?? []).includes(x.raw))?.team;
        if (team) slots.filter((x) => x.team === team).forEach((x) => trophy.add(x.raw));
      }
      // fallen의 p.by(민 사람)는 whom이 아니라 p에 실려 있어(위 SEVERE_SUBJECT_KEYS 주석)
      // 지금까지 화살표 대상에서 통째로 빠져 있었다(지적: "자막엔 정구의 히드라가 있는데
      // 왜 화살표가 없지?" — 자막은 p.by/p.theirs 이름을 쓰는데 그림에는 그 사람이 아예
      // 없었다). 공격자로 잡아 helpers에 끼워 넣는다 — target()에서 "fallen의 by는 무너진
      // 사람 집이 목표"로 따로 잡아 준다.
      const byAttacker = BY_ATTACKER_KEYS.has(b.k) && typeof b.p?.by === "string" ? [b.p.by] : [];
      if (byAttacker.length > 0) byAttacker.forEach((r) => attacker.add(r));
      // 같이 덮친 사람(who2)도 공격자다(지적: "누구도 가세하여 같이 공격한 것"에 화살표가
      // 없다) — 문장은 "○○까지 달려들어"로 이름을 부르는데 그림에는 아무것도 없었다.
      const helpers = ATTACK_BEAT_KEYS.has(b.k) || b.k === "breakthrough"
        ? (Array.isArray(b.who2) ? b.who2 : typeof b.who2 === "string" ? [b.who2] : [])
        : byAttacker;
      const actors = who;
      /* 그 자리에서 맞붙은 상대(p.fight) — 마법도 리콜도 혼자 한 일이 아니다(지적: 스톰을
         지진 경우 거의 100% 적과 교전 중인데 혼자 쓴 것처럼 묘사된다. 그 순간 교전 데이터를
         찾아 화살표 2개가 부딪히게). 요약이 그 자리에서 실제로 싸우고 있던 사람을 whom으로
         실어 주므로(replayTactics의 fightersAt), 그 사람도 같은 점으로 화살표를 낸다.
         당한 사람으로 걸러지면 안 되는 유일한 whom이다 — 마주 싸운 쪽이라 화살표가 있다. */
      // 그 싸움터의 좌표가 있어야 그릴 수 있는 화살표다 — 좌표를 못 믿는 옛 요약에서는
      // 상대 쪽 화살표가 엉뚱한 방향(제 집 → 상대 집)으로 뻗으므로 아예 안 그린다.
      const fightFoes = b.p?.fight === true && posTrusted && Array.isArray(b.p?.xy)
        ? (b.whom ?? []).filter((v) => !actors.includes(v)) : [];
      for (const raw of [...actors, ...helpers, ...fightFoes]) {
        const inFight = fightFoes.includes(raw);
        if (victims.has(raw) && !inFight) continue;
        // fallen·gg·greedy-punished는 주어(actors)가 사실 당한 쪽이다(위 표 참고) — 무기
        // 이모지·화살표 대상이 아니라 아바타 얼굴로만 알린다. result(맺음말)도 마찬가지로
        // 트로피는 아바타 얼굴 쪽에서만 준다(지적: 본진에 뜨는 트로피와 아바타 트로피가
        // 겹쳐서 두 개로 보였다). actors로 한정하는 이유는 fallen의 p.by(helpers)까지
        // 걸러지면 안 되기 때문 — 그 사람은 당한 쪽이 아니라 민 쪽이다(byAttacker).
        // (맺음말은 여기서 빠져 있었다 — 트로피가 본진과 아바타에 두 번 뜨는 것을 막느라
        // 화살표까지 통째로 없앴었다. 이제 트로피는 승패 스냅이 전담하므로, 맺음말은 그
        // 마지막 싸움을 다른 교전 스냅과 똑같이 그린다(요청).)
        if (actors.includes(raw)
          && (SEVERE_SUBJECT_KEYS.has(b.k) || MODERATE_SUBJECT_KEYS.has(b.k)
            || b.k === "verdict")) continue;
        // 아군 기지의 교전을 도우러 간 것(위에서 helper로 분류됨)은 화살표 끝 표시도
        // 공격(💥)이 아니라 방어(🛡️)로 바꾼다(지적: "정구의 화살표 끝은 공격이라기보다
        // 방어지 — 저렇게 하면 꼭 태섭을 공격한 거 같잖아").
        // 맞붙은 상대의 표시는 그 사람이 쓴 마법이 아니라 '싸웠다'는 것뿐이다 — 스톰을
        // 뿌린 쪽의 이모지를 그 사람에게도 주면 둘이 같은 마법을 쓴 것처럼 읽힌다.
        const em = inFight ? "⚔️"
          : (b.k === "clash" && (helper.has(raw) || homeDefender.has(raw))) ? "🛡️"
            /* 민 사람의 화살표에는 그 이야기의 이모지를 그대로 주면 안 된다 — 이사의
               이모지는 이삿짐차라, 밀어낸 사람 화살표 끝에 트럭이 붙는다. */
            : (BY_ATTACKER_KEYS.has(b.k) && b.p?.by === raw) ? "💥" : markOf(b);
        /* 팀원을 도우러 간 화살표에는 목에 천사 날개를 단다(요청) — 촉의 방패는 '그 자리에
           방어를 보탰다'는 뜻이고, 날개는 '이 길이 도우러 간 길'이라는 뜻이라 자리가 다르다.
           집주인 자신(homeDefender)은 도우러 간 것이 아니라 제 집을 지킨 것이라 뺀다. */
        const wing = ALLY_HELP_KEYS.has(b.k)
          || (b.k === "clash" && helper.has(raw) && !homeDefender.has(raw));
        // 화살표를 못 그리는 경우(자리를 모름·너무 가까움)의 마지막 대비책 — 아래에서
        // hits가 하나도 화살표로 못 그려지면 이 값으로 본진에 이모지를 얹는다.
        mark.set(raw, em);
        const emLabel = labelOf(b, raw);
        if (emLabel.length > 0) markLabel.set(raw, emLabel.join(" "));
        /* 입구막기·입구 방어는 본진 안이 아니라 나가는 길목의 이야기라, 이모지도 진짜
           입구 자리에 세운다(지적: "입구도 본진 입구를 말한 거야 아바타 위가 아니라").
           그 '입구'는 위 target()이 myFront에 쓰는 것과 똑같은 자리다 — 본진에서 가운데
           쪽으로 FRONT만큼 나온 지점. 아바타 옆에 살짝 비켜 뜨는 것과는 그림이 다르다. */
        const myHome = homeOf(raw);
        if (FRONT_BEAT_KEYS.has(b.k) && myHome) markSpot.set(raw, lerp(myHome, center, MARK_FRONT));
        /* 본진에서 한 일은 '본진 건물이 실제로 선 자리'에 세운다(요청: 본진 이모지는
           아바타가 아니라 본진 건물 자리에) — 아바타는 시작 지점에 선 사람 표시라,
           거기에 그대로 얹으면 얼굴을 덮는다. hubs는 그 사람 살림의 무게중심이다
           (replaySummary). 살림을 옮긴 사람은 그 값이 옛 자리를 가리키므로 쓰지 않는다. */
        else if (hubs[raw] && !moved.has(raw)) markSpot.set(raw, [hubs[raw][0], hubs[raw][1]]);
        else markSpot.delete(raw);
        if (ATTACKER_FACE_KEYS.has(b.k)) attacker.add(raw);
        const t = target(b, raw);
        if (!t) continue;
        // 화살표 모양은 그 사람이 무엇으로 갔느냐다 — 협공 문장은 도와준 사람을 이름으로만
        // 부를 뿐 '무엇으로' 왔는지는 담고 있지 않아, 예전에는 주공격자의 모양을 그대로
        // 복사해 썼다(지적: 여러 명이 협공하면 점선·실선·곡선·직선이 전부 똑같이 그려진다).
        // 도와준 사람에게는 그 사람 자신의 수를 찾아 그 모양을 준다(styleOf).
        const flightVal = actors.includes(raw) ? isFlight(b.k, b.p?.k) : styleOf(raw, b.at);
        /* 건너간 수는 양 끝이 다 사건이다(요청) — 출발 자리에 회오리·구멍을, 도착 자리에
           반짝임을 얹는다. 화살표 하나로 "여기서 저기로 넘어갔다"가 그대로 읽힌다. */
        const arrive = WARP_BEAT_KEYS.has(b.k) ? (WARP_ARRIVE_MARK[b.k] ?? em) : em;
        /* 무엇으로 갔나 — 화살표 기둥 위에 붙인다(요청: 모든 공격·포토러시·성큰러시·몰래
           배럭·방어타워·옆탱 등에 다 적용). 자막에서 유닛을 빼도 그림만 보고 파악되게 하는
           자리라, 이름은 그 사람 자신의 것이어야 한다(요약의 units가 사람별로 싣는다). */
        const label = labelOf(b, raw);
        /* 병력이 클수록 기둥을 굵게(요청) — 요약이 사람마다 실어 준 규모(beat.sizes)를
           단계로 끊어 쓴다. 수치를 그대로 비례로 놓으면 몇백 기짜리 후반 화살표가 지도를
           덮어 버린다. 옛 요약에는 이 값이 없어 그때는 기본 굵기 그대로다. */
        const size = (b as { sizes?: Record<string, number> }).sizes?.[raw];
        const width = size === undefined ? undefined : arrowWidth(size);
        const list = hits.get(raw) ?? [];
        list.push({
          t, flight: flightVal, ...(label.length > 0 ? { label } : {}),
          ...(width !== undefined ? { width } : {}),
          ...(wing ? { wing: true } : {}),
          // 부딪친 자리의 이모지는 하나면 된다 — 맞붙은 상대 화살표의 촉에까지 얹으면 한
          // 점에 둘이 겹친다(아래 marked 정리와 같은 취지). 마법을 쓴 쪽 것만 남긴다.
          ...(inFight || PLAIN_TIP_MARKS.has(arrive) ? {} : { mark: arrive }),
          // 리콜의 출발 표시(회오리)는 리콜을 쓴 사람 자리에만 얹는다.
          ...(WARP_BEAT_KEYS.has(b.k) && !inFight ? { fromMark: em } : {}),
          // 양 팀이 부딪친 자리는 양쪽 화살표가 한 점에서 만나야 한다(요청) — 큰 싸움도,
          // 마법·리콜이 터진 교전도 마찬가지다(p.fight).
          ...(b.k === "clash" || b.p?.fight === true ? { converge: true } : {}),
        });
        hits.set(raw, list);
      }
    }
    // 후보로 잡아 둔 "당한 사람"(hit) 중 심하게 무너진 쪽에 못 든 나머지는 적당히 당한
    // 것으로 정리한다(요청: 쨀다가 당한 것도 이 적당히 당함 얼굴로 통합).
    for (const r of hit) if (!severe.has(r)) moderate.add(r);
    // 화살표로 그릴 수 있는 것(자기 집에서 충분히 멀리 간 것)과, 화살표 없이 본진에만 이모지가
    // 붙는 것(생산·테크·경제, 그리고 목표가 자기 집 안인 것)으로 나눈다.
    const arrows: MinimapArrow[] = [];
    // 이사는 옛 자리에서 새 자리로 가는 하얀 점선 화살표다(요청) — 팀 색을 주지 않아 공격
    // 화살표와 한눈에 갈리고, 끝에는 이삿짐차를 얹는다. 본진 이모지 자리는 비워 둔다.
    const movers = new Set<string>();
    for (const n of idx) {
      const b = beats[n];
      if (b?.k !== "relocate") continue;
      for (const raw of b.who ?? []) {
        const from = movedPair.from.get(raw);
        const at = movedPair.to.get(raw);
        if (!from || !at) continue;
        arrows.push({
          key: `mv-${raw}`, x1: from[0], y1: from[1], x2: at[0], y2: at[1],
          team: undefined, flight: true, mark: BEAT_MARK.relocate,
        });
        movers.add(raw);
      }
    }
    // 화살표 끝(또는 화살표가 안 나올 만큼 가까우면 본진)에 붙는 무기 이모지 — "무엇으로
    // 쳤나/무엇을 했나"를 말한다. 아바타에 겹쳐 얹는 상태 얼굴(아래)과는 다른 자리다.
    const marks = new Map<string, string>();
    const markTexts = new Map<string, string>();
    for (const s of slots) {
      // 이사 화살표를 이미 그렸으면 이모지는 그 끝에 있다 — 본진에 또 얹지 않는다.
      if (movers.has(s.raw)) continue;
      const home = homeOf(s.raw);
      const list = hits.get(s.raw) ?? [];
      // 한 사람이 여러 곳을 쳤으면 아바타 하나에서 화살표 여러 개로 갈라진다(요청) — 자리마다
      // 화살표 하나씩, 키는 자리 순번을 붙여 갈라 둔다.
      let drawn = 0;
      list.forEach((h, i) => {
        if (!home || dist(home, h.t) < ARROW_MIN_TILES) return;
        arrows.push({
          key: `${s.raw}-${i}`, x1: home[0], y1: home[1], x2: h.t[0], y2: h.t[1],
          team: s.team, flight: h.flight, deep,
          ...(h.mark ? { mark: h.mark } : {}),
          ...(h.label?.length ? { label: h.label } : {}),
          ...(h.width !== undefined ? { width: h.width } : {}),
          ...(h.wing ? { markNeck: "🪽" } : {}),
          ...(h.converge ? { converge: true } : {}),
          ...(h.fromMark ? { markFrom: h.fromMark } : {}),
        });
        drawn += 1;
      });
      // 화살표로 그릴 만큼 먼 자리가 하나도 없으면(전부 본진 근처거나 자리를 모름) 본진에
      // 이모지 하나만 띄운다 — 마지막 것의 이모지를 쓴다(요청 이전과 같은 규칙).
      if (drawn === 0 && mark.has(s.raw)) {
        marks.set(s.raw, mark.get(s.raw)!);
        if (markLabel.has(s.raw)) markTexts.set(s.raw, markLabel.get(s.raw)!);
      }
    }
    /* 한 자리에 여러 화살표가 꽂히면 기둥 위 이름표가 한 점에 겹쳐 글자가 뭉친다(지적:
       "하히드라라 아비터"). 큰 교전은 이미 그런 표시(converge)를 달고 있어 이름표를 더
       뒤로 물리는데, 급습처럼 여러 명이 같은 집을 친 경우에는 그 표시가 없었다. 끝점이
       서로 붙어 있는 화살표들에 같은 표시를 달아 준다 — 그리는 규칙은 하나뿐이라 여기서
       사실만 짚어 주면 된다. */
    const SHARED_TIP_TILES = 8;
    for (const a of arrows) {
      if (a.converge) continue;
      if (!arrows.some((b) => b !== a
        && Math.hypot(b.x2 - a.x2, b.y2 - a.y2) <= SHARED_TIP_TILES)) continue;
      a.converge = true;
    }
    // 같은 점에 모인 것들끼리 순번을 매긴다 — 이름표를 서로 다른 높이에 앉히는 값이다.
    const ranked: MinimapArrow[][] = [];
    for (const a of arrows) {
      if (!a.converge) continue;
      const g = ranked.find((grp) => Math.hypot(grp[0].x2 - a.x2, grp[0].y2 - a.y2) <= SHARED_TIP_TILES);
      if (g) g.push(a); else ranked.push([a]);
    }
    for (const g of ranked) g.forEach((a, i) => { a.rank = i; });
    /* 같은 자리로 모인 화살표들에는 이모지를 하나만 남긴다(요청: 폭발 이모지도 하나만
       있어야 됨) — 양 팀이 부딪친 자리에는 양쪽에서 화살표가 들어오는데, 저마다 촉 앞에
       제 이모지를 얹으면 한 점에 폭발이 두세 개 겹쳐 뭉친다. 그 자리에서 일어난 일은
       하나이므로 표시도 하나다. */
    const marked = new Set<string>();
    for (const a of arrows) {
      if (!a.mark) continue;
      const at = `${Math.round(a.x2)},${Math.round(a.y2)}`;
      if (marked.has(at)) delete a.mark; else marked.add(at);
    }
    /* 아바타에 겹쳐 얹는 상태 얼굴 — "그 사람이 지금 어떤 처지인가"만 말한다(요청: 해골·
     * 트로피 말고는 아바타에 붙는 표시가 없으니 공격자·당한 사람도 아바타로 알려 달라).
     * 우선순위: 트로피 > 크게 무너짐 > 적당히 당함 > 힘겨움(역부족) > 도움받음(감동) >
     * 잘 막아냄 > 공격자 > 도와줌(천사). */
    const faces = new Map<string, string>();
    for (const s of slots) {
      if (trophy.has(s.raw)) { faces.set(s.raw, "🏆"); continue; }
      if (severe.has(s.raw)) { faces.set(s.raw, SEVERE_FACE); continue; }
      if (moderate.has(s.raw)) { faces.set(s.raw, MODERATE_FACE); continue; }
      if (struggling.has(s.raw)) { faces.set(s.raw, STRUGGLE_FACE); continue; }
      if (helped.has(s.raw)) { faces.set(s.raw, HELPED_FACE); continue; }
      if (defended.has(s.raw)) { faces.set(s.raw, DEFENDED_FACE); continue; }
      // 아군 헬프가 공격보다 먼저다(지적: 도우러 아군 기지에 간 사람이 공격 얼굴로
      // 나왔다) — 같은 장면에 다른 beat로 공격 계열에도 이름이 걸렸더라도, 아군을
      // 도우러 간 것이 더 구체적이고 뚜렷한 사실이라 그쪽을 우선한다.
      if (helper.has(s.raw)) { faces.set(s.raw, HELPER_FACE); continue; }
      if (attacker.has(s.raw)) { faces.set(s.raw, ATTACK_FACE); continue; }
      /* 타이밍 이야기는 맨 뒤에 본다(요청) — 같은 스냅에 다른 일이 겹쳐 있으면 그쪽이
         더 구체적인 사실이다. 흘려보낸 쪽은 자는 얼굴, 그 사이 살림을 편 쪽은 불이다
         (지적: 근육보다 불이 낫다) — 근육은 '힘이 세다'로 읽혀 병력 이야기와 헷갈렸다. */
      if (idling.has(s.raw)) { faces.set(s.raw, IDLE_FACE); continue; }
      if (busy.has(s.raw)) { faces.set(s.raw, BUSY_FACE); continue; }
    }
    return { arrows, marks, markTexts, markSpots: markSpot, faces };
  }, [gameResult.summaryData, sentences, index, slots, grid, moved, movedPair]);
  const arrows = actions.arrows;

  // 미니맵 표시 — 본진 아바타는 늘 떠 있고, 지금 문장의 주인공만 커진다(요청).
  const bases: MinimapMarker[] = useMemo(() => {
    const spots = gameResult.summaryData?.bases;
    if (!spots) return [];
    const out: MinimapMarker[] = [];
    // 시작 스냅("게임 시작!")은 로스터가 빠진 자리라, 닉네임도 아바타만큼 키운다(요청).
    const introBig = index === 0 && sentences.length > 1 && (sentences[0]?.beats?.length ?? 0) === 0;
    for (const s of slots) {
      if (!spots[s.raw]) continue;
      const nameLc = normalizeSearchText(s.name);
      const hit = highlightMemberIds?.has(s.slot.memberId)
        || !!highlightTerms?.some((t) => nameLc.includes(t));
      const at = moved.get(s.raw) ?? null;
      const common = {
        name: s.name, memberId: s.slot.memberId,
        avatar: memberOf(s.slot.memberId)?.avatar ?? null,
        race: s.slot.race, team: s.team,
      };
      if (at) {
        // 버린 본진 — 흑백으로만 남긴다(요청). 이름표는 새 자리 쪽에만 단다.
        out.push({
          ...common, key: `${s.raw}-old`, x: spots[s.raw][0], y: spots[s.raw][1],
          withName: false, highlight: false, ghost: true,
        });
      }
      out.push({
        ...common, key: s.raw,
        x: at ? at[0] : spots[s.raw][0], y: at ? at[1] : spots[s.raw][1],
        withName: true, highlight: hit, downed: downed.has(s.raw),
        featured: mentioned.has(s.raw), introBig,
        // 화살표가 없는 이야기(생산·테크·경제)는 그 사람 본진에 이모지를 붙인다(요청).
        mark: actions.marks.get(s.raw),
        // 그 이모지가 무엇으로 한 일인지(요청) — 화살표 이름표와 같은 재료다.
        markText: actions.markTexts.get(s.raw),
        markAt: actions.markSpots.get(s.raw),
        // 아바타에 겹쳐 얹는 상태 얼굴 — 트로피·공격자·당한 정도·아군 헬프(요청).
        face: actions.faces.get(s.raw),
        // 트로피는 다른 얼굴들과 크기·바운스가 다르다(요청: 28px 확대 + 계속 바운스).
        faceIsTrophy: actions.faces.get(s.raw) === "🏆",
      });
    }
    return out;
  }, [gameResult.summaryData, slots, memberOf, highlightMemberIds, highlightTerms, downed, mentioned,
    actions, moved, grid, index, sentences]);

  const o1 = outcomeFor("team1", result);
  const o2 = outcomeFor("team2", result);
  /* 이긴 편을 이름으로 부른다(요청: "승" → "n팀 승") — 미니맵 머리의 이 배지는 로스터를
     감춘 자리에서 승패를 알리는 유일한 표시인데, "승"만으로는 색을 읽어야 어느 편인지
     알 수 있었다. 1:1은 팀 용어를 쓰지 않으므로(요청) 이긴 사람 이름을 그대로 부른다. */
  const winLabel = (() => {
    if (result === "draw") return "무승부";
    const side = o1 === "win" ? team1 : team2;
    if (team1.length === 1 && team2.length === 1) {
      return `${resolveSlotName(side[0], [...team1, ...team2], memberOf)} 승`;
    }
    return `${o1 === "win" ? 1 : 2}팀 승`;
  })();
  const mapName = cleanMapName(gameResult.mapName);
  const minutes = gameResult.durationSeconds != null
    ? Math.round(gameResult.durationSeconds / 60) : null;
  // 미니맵이 있으면 맵 이름·플레이시간은 그림의 머리로 올라간다 — 아래 따로 한 줄 더 두면
  // 같은 말이 두 번 나온다. 미니맵이 있으면 PC에서도 로스터를 접는다(요청: 로스터 자리를
  // 미니맵에 넘겨 그만큼 더 키운다) — 편·종족은 미니맵의 색·표시가, 닉네임은 이제 지도
  // 가장자리에 붙는 이름표가 맡는다. 미니맵을 못 그리는 경기만 로스터가 유일한 표시라
  // 그대로 보여준다.
  /* 이야기를 그릴 수 있는 경기인가 — 운영자가 그 맵에 실제 미니맵 그림을 연결해 둔
     경우뿐이다(요청). 한동안은 그림이 없으면 리플레이의 타일 격자로 개략도를 그려 그
     위에 얹었는데, 타일 번호만으로는 게임과 같은 색을 만들 수 없어(ReplayMapCanvas 주석)
     결국 무슨 지형인지 못 읽는 그림 위에 아바타만 떠 있는 꼴이었다. 그림이 없으면 이야기
     대신 "연결해 달라"는 안내 한 줄만 띄운다.
     (격자 자체는 계속 저장한다 — 운영 > 미니맵 화면이 아직 연결 안 된 맵을 그 개략도
     썸네일로 알아보게 해 준다.) */
  const storyMap = grid?.image ? grid : null;
  const showRoster = storyMap === null;
  /* 맵은 읽었는데 그림만 아직 없는 경우 — 운영자가 연결해 주면 바로 이야기가 붙는다(요청).
     맵 자체를 못 읽은 옛 경기(grid === null)에는 연결할 대상이 없어 안 띄운다. */
  const needMapImage = grid !== null && !grid.image;
  /* 시작 스냅("게임 시작!") — 자막은 짧은 한 줄뿐이니, 그 대신 미니맵 쪽 아바타·닉네임을
     키워 로스터를 보여준다(요청). 소개 문장은 beat 없이 만들어 넣은 것이라 beats가 비어
     있는 것으로 가려낸다. */
  const introIdx = sentences.length > 1 && (sentences[0]?.beats?.length ?? 0) === 0 ? 0 : -1;
  // 자막으로 보여줄 수 있는 경기인가 — 미니맵이 있고 훑을 문장이 있을 때. 그림이 없으면
  // 자막만 남아 무엇을 보고 읽는 글인지 알 수 없다.
  const caption = storyMap !== null && sentences.length > 0;
  const showMapLine = storyMap === null && (mapName || minutes !== null);

  /* 미니맵·자막·타임라인을 눌러도 카드가 접히지 않게 한다(요청) — 이 카드는 눌러서 접는
     동작을 갖고 있어서(활동 묶음), 그림을 짚어 장면을 넘기거나 자막을 읽으려고 누른 것이
     그대로 접기로 새어 나갔다. click만 막으면 pointerdown을 보고 접는 쪽이 먼저 반응하므로
     세 가지를 다 끊는다. */
  const stopBubble = {
    onPointerDown: (e: PointerEvent) => e.stopPropagation(),
    onMouseDown: (e: MouseEvent) => e.stopPropagation(),
    onClick: (e: MouseEvent) => e.stopPropagation(),
  };

  /* 두 팀 사이의 vs 줄(승·무 배지 포함) — 로스터 위쪽(PC)과 시작 스냅의 자막 자리
     (모바일 포함) 두 곳이 같은 것을 쓴다. */
  const vsRow = (
    <span className="scr-challenge-arrow-row">
      <span className={cx("scr-challenge-inline-win", o1 === "draw" && "scr-challenge-inline-draw", o1 !== "win" && o1 !== "draw" && "scr-challenge-inline-win-hidden")}>
        {o1 === "draw" ? "무" : "승"}
      </span>
      <span className="scr-challenge-arrow scr-challenge-arrow-vs" aria-hidden="true">vs</span>
      <span className={cx("scr-challenge-inline-win", o2 === "draw" && "scr-challenge-inline-draw", o2 !== "win" && o2 !== "draw" && "scr-challenge-inline-win-hidden")}>
        {o2 === "draw" ? "무" : "승"}
      </span>
    </span>
  );

  const mapBlock = storyMap && (
    <div className="scr-story-map" {...stopBubble}>
      <div className="scr-story-map-head">
        {mapName && <span className="scr-story-map-name">{mapName}</span>}
        {minutes !== null && <span className="scr-story-map-dur">{minutes}분</span>}
        {/* 로스터를 감춘 자리(모바일)에서는 승패를 여기서 알려야 한다 — vs 양옆의 승/무
            배지가 로스터와 함께 사라지기 때문이다. 색이 곧 이긴 편이다. */}
        {!showRoster && result !== "not_held" && (
          <span
            className={cx("scr-story-win",
              result === "draw" ? "scr-story-win-draw"
                : o1 === "win" ? "scr-story-win-t1" : "scr-story-win-t2")}
          >
            {winLabel}
          </span>
        )}
      </div>
      {/* 그림을 어떻게 넘기는지 한 줄로 일러 둔다(요청) — 좌·우 절반이 누르는 자리라는 건
          보이는 표시가 없어 아무도 모른다. 넘길 장면이 둘 이상일 때만 띄운다. */}
      {sentences.length > 1 && (
        <div className="scr-story-map-hint">미니맵 좌우를 눌러 이전/다음 내용으로 이동</div>
      )}
      <ReplayMinimap
        grid={storyMap} bases={bases} arrows={arrows}
        onStep={sentences.length > 1 ? (d) => {
          // 그림 좌·우 절반으로 장면을 옮긴다(요청). 손으로 옮겼으면 자동재생은 멈춘다 —
          // 타임라인의 눈금을 짚었을 때와 같은 규칙이다.
          setIndex((i) => Math.min(sentences.length - 1, Math.max(0, i + d)));
          setPlaying(false);
        } : undefined}
        // 자막 패널을 없애고 자막을 미니맵 가운데에 얹는다(요청) — ReplayMinimap이
        // 지도 위에 겹쳐서(overlay) 그린다.
        caption={sentences.length > 0 && (
          <div className="scr-story-cap">
            {sentences.map((sn, i) => (
              <p
                key={i}
                className={cx("scr-story-cap-line", i === introIdx && "scr-story-cap-intro")}
                aria-hidden={i !== index} data-on={i === index}
              >
                {/* 언제 있었던 일인지 앞에 붙인다(요청: [07:12]처럼 초까지). 시각을 모르는
                    문장(맺음말 등)은 아무것도 안 붙인다 — 0분이라고 적으면 거짓말이다. */}
                {capMin(sn) !== null && <span className="scr-story-cap-time">[{capMin(sn)}]</span>}
                {/* 문장이 아니라 타이틀 한 마디다(요청) — 그림이 이미 말하는 것을 글로
                    되풀이하지 않는다. 시작 스냅("게임 시작!")처럼 beat 없이 만든 자막은
                    타이틀이 없으니 원래 글을 그대로 쓴다. */}
                {(i === introIdx ? sn.parts : titleOf(sn)).map((pt, j) => (pt.team
                  ? <span key={j} className={pt.team === 1 ? "scr-sum-team1" : "scr-sum-team2"}>{pt.text}</span>
                  : <span key={j}>{pt.text}</span>))}
              </p>
            ))}
          </div>
        )}
      />
    </div>
  );

  return (
    <div className="scr-story" ref={rootRef}>
      {showRoster && (
        <div className={cx("scr-challenge-matchup", "scr-activity-game-result-matchup", grid && "scr-story-matchup-wide")}>
          <RosterSide
            team={team1} memberOf={memberOf}
            highlightMemberIds={highlightMemberIds} highlightTerms={highlightTerms}
          />
          {/* 가운데 — 승/무 배지와 vs, 그리고 PC에서는 그 아래 미니맵(요청: PC에서는
              로스터 사이에). */}
          <div className="scr-story-mid">
            {vsRow}
            {mapBlock}
          </div>
          <RosterSide
            team={team2} memberOf={memberOf}
            highlightMemberIds={highlightMemberIds} highlightTerms={highlightTerms}
          />
        </div>
      )}
      {result === "not_held" && <div className="scr-activity-game-result-notheld">미실시</div>}
      {!showRoster && mapBlock}
      {/* 미니맵이 없는 경기는 예전처럼 맵 이름·플레이시간을 한 줄로 적는다. */}
      {showMapLine && (
        <div className="scr-game-result-trow-map-line scr-game-result-trow-map-meta">
          {mapName && <span className="scr-game-result-trow-map">{mapName}</span>}
          {minutes !== null && <span className="scr-game-result-trow-dur">({minutes}분)</span>}
        </div>
      )}
      {/* 맵은 읽었는데 미니맵 그림이 아직 안 붙은 경우(요청) — 무엇이 빠졌는지, 어디서
          채우는지를 그 자리에 적는다. 운영자가 운영 > 미니맵에서 한 번 연결하면 그
          맵을 쓰는 옛 경기까지 한꺼번에 이야기가 붙는다. */}
      {needMapImage && (
        <div className="scr-story-map-missing">운영메뉴에서 미니맵 이미지를 연결해주세요</div>
      )}
      {/* 자막 — 요약을 문단으로 늘어놓는 대신 지금 스냅의 문장만 보여준다(요청). 미니맵
          바로 아래에 따로 두는 이유는 그림 위에 얹으면 지형과 아바타를 가리기 때문이다
          (요청: 자막이 안 가려지게 하단에 캡션 영역으로).
          문장을 모두 겹쳐 놓고 지금 것만 보이게 한다 — 이러면 칸이 늘 가장 긴 문장 높이라
          재생하는 동안 카드가 위아래로 흔들리지 않는다. 문장마다 높이가 달라 그냥 갈아
          끼우면 매 스냅마다 아래 내용이 밀린다. */}
      {/* 타임라인은 스냅이 둘 이상일 때만 쓸모가 있다 — 한 문장짜리 요약에 재생 버튼을 두면
          누를 데는 있는데 아무 일도 안 일어난다. */}
      {grid && sentences.length > 1 && (
        <div {...stopBubble}>
        <ReplayStoryTimeline
          snaps={sentences} end={gameResult.summaryData?.end ?? null}
          index={index} playing={playing} finished={finished}
          onSeek={(i) => { setIndex(i); setPlaying(false); }}
          onToggle={() => {
            if (finished) { setIndex(0); setPlaying(true); return; }
            setPlaying((v) => !v);
          }}
        />
        </div>
      )}
      {/* 미니맵이 없는 경기(옛 경기, 맵 정보를 못 읽은 리플레이)는 훑을 그림도 자막도 없다 —
          예전처럼 요약 전문을 한 문단으로 보여준다. 이게 없으면 그 카드는 읽을거리가 통째로
          사라진다. */}
      {!caption && sentences.length > 0 && (
        <div className="scr-game-result-trow-summary">
          {sentences.map((sn, i) => (
            <span key={i}>
              {sn.parts.map((pt, j) => (pt.team
                ? <span key={j} className={pt.team === 1 ? "scr-sum-team1" : "scr-sum-team2"}>{pt.text}</span>
                : <span key={j}>{pt.text}</span>))}
              {i < sentences.length - 1 ? ". " : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
