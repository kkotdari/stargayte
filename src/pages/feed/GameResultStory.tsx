import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import ReplayMinimap, { ARROW_MIN_TILES, type MinimapArrow, type MinimapMarker } from "../../components/replay/ReplayMinimap";
import ReplayStoryTimeline from "../../components/replay/ReplayStoryTimeline";
import RosterSide, { outcomeFor, resolveSlotName } from "./GameResultSides";
import { useReplayMap } from "../../hooks/useReplayMap";
import { cleanMapName } from "../../utils/mapName";
import { cx } from "../../utils/format";
import { normalizeSearchText } from "../../utils/memberSearch";
import { ATTACK_BEAT_KEYS } from "../../utils/replaySummary";
import { renderReplaySummarySentences } from "../../utils/replaySummaryText";
import type { SummaryPart } from "../../utils/replaySummaryText";
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
/** 프레임 → 초. 자막 앞에 붙이는 "[5분]"을 계산한다(요청: 분까지만). */
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
  /* 입구막기 — 방어탑이 아니라 살림 건물로 앞을 잠근 것이라 방패(막아섰다)와도, 창
     (다투는 땅을 먹었다)과도 다르다. 제 집 앞을 벽돌로 쌓아 올린 그림 그대로 벽돌을 준다. */
  "wall-in": "🧱",
  // 방패는 실제로 방어 건물을 세운 이야기에만 준다(지적: 유닛을 뽑은 것뿐인데 본진에
  // 방패가 뜬다) — 병력으로 맞선 이야기는 싸움이라 검 대결이 맞다.
  stand: "⚔️", "late-hold": "⚔️", standoff: "⚔️",
  // 옆탱은 이름과 달리 방어가 아니라 공격이지만(지적), 병력이 맞붙는 싸움과는 결이 달라
  // 칼 모양이 아니라 자리 잡고 쏘는 느낌으로 구분한다. 탑(🗼)은 건물 느낌만 나고 공격으로
  // 안 읽혀서(지적) 활(🏹)로 바꾼다 — 멀리서 쏘는 공격이라는 게 한눈에 보인다.
  "side-tank": "🏹",
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
  // fallen·gg·greedy-punished·result는 여기 없다 — 전부 주어(who)가 사실 당한 쪽이거나
  // (fallen·gg·greedy-punished) 아바타 얼굴이 이미 전담하는 것(result의 트로피)이라, 무기
  // 이모지·화살표 대상이 아니다(요청: 쨀다가 당한 얼굴도 아바타 얼굴 하나로 통합, 트로피
  // 중복 제거).
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

/** 저장된 자리(pos)·마법 좌표(p.xy)를 화살표 목표로 믿는 최소 요약 버전
 *  (replaySummaryData의 REPLAY_SUMMARY_VERSION 주석 참고). */
const POS_TRUSTED_VERSION = 2;

/** 집에서 한 일 — 병력이 나간 자리가 있어도 화살표를 긋지 않는다. 테크·경제·방어·이사처럼
 *  '어디로 갔다'가 이야기의 뼈대가 아닌 것들이다. */
const HOME_BEAT_KEYS = new Set([
  "expand", "upgrade", "upgrade-signature", "tech", "fast-tech", "vision", "no-detect",
  "greedy-build", "greedy-paid", "greedy-punished", "lodging", "relocate",
  "defense", "front-defense", "late-defense", "wall-in", "side-tank", "revival", "fallen", "gg",
  "stand", "result", "standoff", "attrition", "fast-hands", "pro-like", "worker-gap",
  "prod-gap", "long-run", "late-hold", "lift-off",
]);

/** 주어(who)가 당한 쪽이고, 때린 사람은 p.by에 실린 문장들 — whom에 넣으면 그림이
 *  통째로 뒤집히기 때문이다(그림은 whom을 '당한 사람'으로 읽는다). 이 문장들에서는
 *  by가 공격자이고, 화살표는 by의 집에서 who의 집으로 간다(지적: 태섭이 공격한 건데
 *  화살표가 없고 태섭 얼굴이 당황한 표정이었다). */
const BY_ATTACKER_KEYS = new Set(["fallen", "greedy-punished"]);

/** 실제로 맵 가운데에서 벌어진 일 — 화살표를 센터로 보낸다(요청: 센터 내용은 실제 센터에). */
const CENTER_BEAT_KEYS = new Set(["center", "center-photon"]);

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

/** 카드가 화면에 이만큼 들어와 있으면 재생한다 — 피드에 카드가 여럿인데 전부 동시에
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
  // 자동재생은 꺼 둔다(요청) — 카드가 여럿 뜨는 피드에서 저마다 장면이 넘어가면 어지럽다.
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
  // 넣으면 안 된다: 피드 머리의 카운트다운 때문에 부모가 1초마다 다시 그려지고, 그때마다
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
  /** 그 문장이 가리키는 시각(분) — 문장에 묶인 beat 가운데 가장 이른 것을 쓴다. 시각이
   *  없는 문장(맺음말 등)은 null이라 아무것도 안 붙는다. */
  const capMin = (sn: { beats: number[] }): number | null => {
    const beats = gameResult.summaryData?.beats ?? [];
    let at: number | null = null;
    for (const i of sn.beats) {
      const v = beats[i]?.at;
      if (typeof v === "number" && (at === null || v < at)) at = v;
    }
    return at === null ? null : Math.max(0, Math.round((at * SECONDS_PER_FRAME) / 60));
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
      // 맺음말 스냅에서는 자막에 누가 나오든 이긴 편 전원만 키운다(요청) — 역전패를 말하는
      // 맺음말은 진 편(whom)까지 부르는데, 그걸 그대로 키우면 진 편 아바타가 함께 커졌다.
      if (b.k === "result") {
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
    arrows: MinimapArrow[]; marks: Map<string, string>; faces: Map<string, string>;
  }>(() => {
    const empty = { arrows: [], marks: new Map<string, string>(), faces: new Map<string, string>() };
    const beats = gameResult.summaryData?.beats;
    const idx = sentences[index]?.beats;
    if (!beats || !idx) return empty;
    const spots = gameResult.summaryData?.bases ?? {};
    const teamOf = new Map(slots.map((s) => [s.raw, s.team]));
    /* 저장된 자리 값을 믿어도 되는 요약인가 — 옛 요약(v1)의 pos는 '그 무렵 찍은 명령의
       중심'이라 일꾼의 자원 클릭과 건물의 랠리가 섞여 대부분 제 집을 가리킨다. 새 뜻으로
       읽으면 화살표가 자기 기지로 향한다(지적). 옛 경기는 제어판의 '요약 재분석'을 돌리면
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
        const p = homeOf(s.raw);
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
        const p = homeOf(s.raw);
        if (!p) continue;
        if (best === null || dist(home, p) < dist(home, best)) best = p;
      }
      return best;
    };
    // '입구'는 본진에서 가운데 쪽으로 이만큼 나온 자리로 본다 — 정확한 입구 좌표는 지형 표가
    // 없어 알 수 없지만(ReplayMapCanvas 주석), 입구는 늘 본진과 가운데 사이에 있다.
    const FRONT = 0.24;

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
      return best === Infinity || best <= dist(at, home);
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
        const victimHome = homeOf((b.who ?? [])[0] ?? "");
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
        return pick ? homeOf(pick) : null;
      })();
      /* 리콜·커널처럼 '여기서 저기로 건너간' 수는 화살표가 본진에서 상대에게로 이어져야
         그림이 읽힌다(요청). 마법을 쓴 좌표·문을 뚫은 좌표는 대개 제 진영 언저리라, 그걸
         목표로 삼으면 제 집 옆에서 짧게 끝나는 화살표가 된다(실측 스크린샷: 리콜 회오리가
         제 본진 바로 옆에 붙어 있었고, 커널 화살표는 자막이 부른 타센 쪽으로 가다 중간에
         멈췄다). 자막이 부른 상대가 있으면 그 사람 집이 목표다 — 출발 자리는 아래에서
         회오리·구멍 이모지로 따로 표시한다. */
      if (WARP_BEAT_KEYS.has(b.k) && namedFoe) {
        const to = homeOf(namedFoe);
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
      if (xy) return xy;
      const foeHome = namedFoe ? homeOf(namedFoe) : null;
      // 자리를 모르면 자막이 부른 상대의 집이 목표다.
      if (foeHome && (attack || spot === "enemyBase" || spot === "enemyFront")) {
        return spot === "enemyFront" ? lerp(foeHome, center, FRONT) : foeHome;
      }
      // 센터에서 벌어진 일은 맵 가운데로(요청) — 건물 자리 분류보다 이 판정이 확실하다.
      if (CENTER_BEAT_KEYS.has(b.k)) return center;
      if (named && (spot === "enemyBase" || spot === "enemyFront")) {
        return spot === "enemyBase" ? named : lerp(named, center, FRONT);
      }
      switch (spot) {
        case "enemyBase": return foe;
        case "enemyFront": return foe ? lerp(foe, center, FRONT) : null;
        case "mid": return center;
        case "myBase": return home;
        case "myFront": return lerp(home, center, FRONT);
        case "allyBase": return ally;
        case "allyFront": return ally ? lerp(ally, center, FRONT) : null;
        default: break;
      }
      // 아군을 도우러 간 것 — 목표는 그 아군의 기지다(요청: 아군 헬프). ally-help는
      // 도움받은 아군을 whom에 담고, ally-cannon(포토 지원)은 who2에 담는다 — 만든
      // 자리가 달라서다(지적: 포토 지원은 화살표 없이 제 기지에 얼굴만 떴다 — target()이
      // ally-cannon의 who2를 안 보고 있었다).
      if (b.k === "ally-help" || b.k === "ally-cannon") {
        const mates = b.k === "ally-help" ? (b.whom ?? [])
          : Array.isArray(b.who2) ? b.who2 : typeof b.who2 === "string" ? [b.who2] : [];
        const mate = mates.find((v) => v !== raw && homeOf(v));
        return mate ? homeOf(mate) : ally;
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

    const mark = new Map<string, string>();
    /** 한 사람이 이 스냅에서 실제로 때린 자리들 — 여러 곳을 쳤으면 여러 개가 쌓인다(요청:
     *  한 사람이 여러 곳에 피해를 준 경우 아바타 하나에서 화살표 여러 개로 갈라지게).
     *  예전에는 자리당 하나(Map<raw, target>)만 기억해 마지막 것만 그려졌다. */
    interface RawHit { t: [number, number]; flight: boolean; mark: string; fromMark?: string }
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
    const DEFENDED_ALWAYS_KEYS = new Set(["late-hold", "standoff"]);
    /** 공격하는 얼굴을 붙일 대상 — 옆탱은 이름과 달리 공격이라(지적) 여기 더한다. */
    const ATTACKER_FACE_KEYS = new Set([...ATTACK_BEAT_KEYS, "clash", "allin", "side-tank"]);
    /** 아군을 도우러 간 것 — 도와준 사람은 천사, 도움받은 사람은 감동으로 각자 얼굴이
     *  갈린다(지적: 화살표는 도움받은 기지로 잇고, 천사는 도와준 사람 아바타로, 도움받은
     *  사람 아바타에는 감동 얼굴을 준다). */
    const ALLY_HELP_KEYS = new Set(["ally-help", "ally-cannon"]);
    const HELPER_FACE = "😇";
    const HELPED_FACE = "🥹";
    const severe = new Set<string>();
    const moderate = new Set<string>();
    const defended = new Set<string>();
    const struggling = new Set<string>();
    const attacker = new Set<string>();
    const helper = new Set<string>();
    const helped = new Set<string>();
    /** 제 기지가 싸움터가 된 사람 — 그 자리에 얹는 표시는 공격(💥)이 아니라 방어(🛡️)다.
     *  때린 쪽 화살표가 이미 그 자리에 💥를 찍으므로, 집주인에게도 💥를 주면 같은 자리에
     *  같은 표시가 둘 겹친다. */
    const homeDefender = new Set<string>();
    for (const n of idx) {
      const b = beats[n];
      if (!b) continue;
      const victims = new Set(b.whom ?? []);
      const who = b.who ?? [];
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
      if (b.k === "result") {
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
      for (const raw of [...actors, ...helpers]) {
        if (victims.has(raw)) continue;
        // fallen·gg·greedy-punished는 주어(actors)가 사실 당한 쪽이다(위 표 참고) — 무기
        // 이모지·화살표 대상이 아니라 아바타 얼굴로만 알린다. result(맺음말)도 마찬가지로
        // 트로피는 아바타 얼굴 쪽에서만 준다(지적: 본진에 뜨는 트로피와 아바타 트로피가
        // 겹쳐서 두 개로 보였다). actors로 한정하는 이유는 fallen의 p.by(helpers)까지
        // 걸러지면 안 되기 때문 — 그 사람은 당한 쪽이 아니라 민 쪽이다(byAttacker).
        if (actors.includes(raw)
          && (SEVERE_SUBJECT_KEYS.has(b.k) || MODERATE_SUBJECT_KEYS.has(b.k) || b.k === "result")) continue;
        // 아군 기지의 교전을 도우러 간 것(위에서 helper로 분류됨)은 화살표 끝 표시도
        // 공격(💥)이 아니라 방어(🛡️)로 바꾼다(지적: "정구의 화살표 끝은 공격이라기보다
        // 방어지 — 저렇게 하면 꼭 태섭을 공격한 거 같잖아").
        const em = (b.k === "clash" && (helper.has(raw) || homeDefender.has(raw)))
          ? "🛡️" : markOf(b);
        // 화살표를 못 그리는 경우(자리를 모름·너무 가까움)의 마지막 대비책 — 아래에서
        // hits가 하나도 화살표로 못 그려지면 이 값으로 본진에 이모지를 얹는다.
        mark.set(raw, em);
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
        const list = hits.get(raw) ?? [];
        list.push({
          t, flight: flightVal, mark: arrive,
          ...(WARP_BEAT_KEYS.has(b.k) ? { fromMark: em } : {}),
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
          team: s.team, flight: h.flight, mark: h.mark, deep,
          ...(h.fromMark ? { markFrom: h.fromMark } : {}),
        });
        drawn += 1;
      });
      // 화살표로 그릴 만큼 먼 자리가 하나도 없으면(전부 본진 근처거나 자리를 모름) 본진에
      // 이모지 하나만 띄운다 — 마지막 것의 이모지를 쓴다(요청 이전과 같은 규칙).
      if (drawn === 0 && mark.has(s.raw)) marks.set(s.raw, mark.get(s.raw)!);
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
    }
    return { arrows, marks, faces };
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
  const mapName = cleanMapName(gameResult.mapName);
  const minutes = gameResult.durationSeconds != null
    ? Math.round(gameResult.durationSeconds / 60) : null;
  // 미니맵이 있으면 맵 이름·플레이시간은 그림의 머리로 올라간다 — 아래 따로 한 줄 더 두면
  // 같은 말이 두 번 나온다. 미니맵이 있으면 PC에서도 로스터를 접는다(요청: 로스터 자리를
  // 미니맵에 넘겨 그만큼 더 키운다) — 편·종족은 미니맵의 색·표시가, 닉네임은 이제 지도
  // 가장자리에 붙는 이름표가 맡는다. 미니맵을 못 그리는 경기만 로스터가 유일한 표시라
  // 그대로 보여준다.
  const showRoster = grid === null;
  /* 시작 스냅("게임 시작!") — 자막은 짧은 한 줄뿐이니, 그 대신 미니맵 쪽 아바타·닉네임을
     키워 로스터를 보여준다(요청). 소개 문장은 beat 없이 만들어 넣은 것이라 beats가 비어
     있는 것으로 가려낸다. */
  const introIdx = sentences.length > 1 && (sentences[0]?.beats?.length ?? 0) === 0 ? 0 : -1;
  // 자막으로 보여줄 수 있는 경기인가 — 미니맵이 있고 훑을 문장이 있을 때. 그림이 없으면
  // 자막만 남아 무엇을 보고 읽는 글인지 알 수 없다.
  const caption = grid !== null && sentences.length > 0;
  const showMapLine = grid === null && (mapName || minutes !== null);

  /* 미니맵·자막·타임라인을 눌러도 카드가 접히지 않게 한다(요청) — 이 카드는 눌러서 접는
     동작을 갖고 있어서(피드 묶음), 그림을 짚어 장면을 넘기거나 자막을 읽으려고 누른 것이
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

  const mapBlock = grid && (
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
            {result === "draw" ? "무승부" : "승"}
          </span>
        )}
      </div>
      <ReplayMinimap
        grid={grid} bases={bases} arrows={arrows}
        onStep={sentences.length > 1 ? (d) => {
          // 그림 좌·우 절반으로 장면을 옮긴다(요청). 손으로 옮겼으면 자동재생은 멈춘다 —
          // 타임라인의 눈금을 짚었을 때와 같은 규칙이다.
          setIndex((i) => Math.min(sentences.length - 1, Math.max(0, i + d)));
          setPlaying(false);
        } : undefined}
      />
      {/* 자막은 미니맵과 같은 감싸개 안에 둔다(요청: 미니맵과 자막 사이 갭 완전히 없애기) —
          바깥(.scr-story)의 세로 간격은 24px이라 음수 마진으로 되돌리기엔 값을 짐작해야 했고
          실제로 14px이 남아 있었다(실측). 여기 안의 간격은 6px 하나뿐이라 정확히 지운다. */}

      {sentences.length > 0 && (
      <div className="scr-story-cap">
        {sentences.map((sn, i) => (
          <p
            key={i}
            className={cx("scr-story-cap-line", i === introIdx && "scr-story-cap-intro")}
            aria-hidden={i !== index} data-on={i === index}
          >
            {/* 언제 있었던 일인지 앞에 붙인다(요청: [5분]처럼 분까지만). 시각을 모르는
                문장(맺음말 등)은 아무것도 안 붙인다 — 0분이라고 적으면 거짓말이다. */}
            {capMin(sn) !== null && <span className="scr-story-cap-time">[{capMin(sn)}분]</span>}
            {sn.parts.map((pt, j) => (pt.team
              ? <span key={j} className={pt.team === 1 ? "scr-sum-team1" : "scr-sum-team2"}>{pt.text}</span>
              : <span key={j}>{pt.text}</span>))}
          </p>
        ))}
      </div>
      )}
    </div>
  );

  return (
    <div className="scr-story" ref={rootRef}>
      {showRoster && (
        <div className={cx("scr-challenge-matchup", "scr-feed-game-result-matchup", grid && "scr-story-matchup-wide")}>
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
      {result === "not_held" && <div className="scr-feed-game-result-notheld">미실시</div>}
      {!showRoster && mapBlock}
      {/* 미니맵이 없는 경기는 예전처럼 맵 이름·플레이시간을 한 줄로 적는다. */}
      {showMapLine && (
        <div className="scr-game-result-trow-map-line scr-game-result-trow-map-meta">
          {mapName && <span className="scr-game-result-trow-map">{mapName}</span>}
          {minutes !== null && <span className="scr-game-result-trow-dur">({minutes}분)</span>}
        </div>
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
