import { useEffect, useMemo, useRef, useState } from "react";
import ReplayMinimap, { ARROW_MIN_TILES, type MinimapArrow, type MinimapMarker } from "../../components/replay/ReplayMinimap";
import ReplayStoryTimeline from "../../components/replay/ReplayStoryTimeline";
import RosterSide, { outcomeFor, resolveSlotName } from "./GameResultSides";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useReplayMap } from "../../hooks/useReplayMap";
import { cleanMapName } from "../../utils/mapName";
import { cx } from "../../utils/format";
import { normalizeSearchText } from "../../utils/memberSearch";
import { ATTACK_BEAT_KEYS } from "../../utils/replaySummary";
import { renderReplaySummarySentences } from "../../utils/replaySummaryText";
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
  "zling-rush": "⚔️", "zealot-rush": "⚔️", "cannon-rush": "⚔️", "sunken-rush": "⚔️",
  "sneak-rax": "🔥", allin: "🎲", "rush-backfire": "🙃",
  // 실어 나르거나 워프로 간 것.
  dropship: "🪂", shuttle: "🪂", "shuttle-reaver": "🪂", "templar-drop": "🪂", "zerg-drop": "🪂",
  recall: "🌀", nydus: "🕳️", nuke: "☢️",
  // 견제·사냥·잠입.
  "harass-workers": "🎯", "harass-long": "🎯", muta: "🦟", "cloak-wraith": "👻",
  "valk-hunt": "🎯", infested: "🧟", "mind-control": "🧠", "power-unit": "💪",
  // 아군을 도우러 간 것(요청: 천사 얼굴).
  "ally-help": "😇", "ally-cannon": "😇",
  // 자리를 잡거나 길을 막은 것.
  center: "🚩", "center-photon": "🚧", defense: "🛡️", "front-defense": "🛡️",
  "late-defense": "🛡️", "side-tank": "🛡️", stand: "🛡️", "late-hold": "🛡️", standoff: "🛡️",
  // 본진에서 한 일 — 화살표 없이 본진에 붙는다.
  expand: "🏗️", upgrade: "🔬", "upgrade-signature": "🔬", tech: "🔬", "fast-tech": "🔬",
  lodging: "🏠", "greedy-build": "🤑", "greedy-paid": "🤑",
  carrier: "🛩️", bc: "🛩️", guardian: "🛩️", "lift-off": "🛩️", vision: "👁️", "no-detect": "🙈",
  scatter: "🌪️", attrition: "⏳", "fast-hands": "⚡", "pro-like": "🌟", revival: "🔥",
  fallen: "💀", gg: "🏳️", "worker-gap": "📉", "prod-gap": "📉", "greedy-punished": "💸",
  result: "🏆",
};

/** 실제로 맵 가운데에서 벌어진 일 — 화살표를 센터로 보낸다(요청: 센터 내용은 실제 센터에). */
const CENTER_BEAT_KEYS = new Set(["center", "center-photon"]);

/** 날아서·워프로 간 수 — 화살표를 곧은 점선으로 그린다. 나머지(지상군)는 곡선(요청). */
const FLIGHT_BEAT_KEYS = new Set([
  "recall", "nydus", "dropship", "shuttle", "shuttle-reaver", "templar-drop", "zerg-drop",
  "muta", "cloak-wraith",
]);

/** 카드가 화면에 이만큼 들어와 있으면 재생한다 — 피드에 카드가 여럿인데 전부 동시에
 *  돌아가면 어지럽고, 보이지도 않는 카드가 타이머를 물고 있을 이유도 없다. */
const VISIBLE_RATIO = 0.4;

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
  const mobile = useIsMobile();
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

  const sentences = useMemo(
    () => renderReplaySummarySentences(
      gameResult.summaryData,
      (raw) => nameByRaw.get(raw) ?? raw,
      (name) => teamByName.get(name),
    ) ?? [],
    [gameResult.summaryData, nameByRaw, teamByName],
  );

  const [index, setIndex] = useState(0);
  // 기본은 자동재생(요청). 사람이 멈추면 그 뜻을 지켜 다시 켜지 않는다.
  const [playing, setPlaying] = useState(true);
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
  const downed: Set<string> = useMemo(() => {
    const beats = gameResult.summaryData?.beats ?? [];
    const upto = Math.max(-1, ...(sentences[index]?.beats ?? []));
    const out = new Set<string>();
    for (let i = 0; i <= upto && i < beats.length; i += 1) {
      const b = beats[i];
      const who = b.who ?? [];
      const whom = b.whom ?? [];
      if (b.k === "fallen" || b.k === "gg") who.forEach((n) => out.add(n));
      else if (b.k === "raid-damage" && (b.p?.out === true || b.p?.early === true)) {
        whom.forEach((n) => out.add(n));
      } else if (b.k === "revival") who.forEach((n) => out.delete(n));
    }
    return out;
  }, [gameResult.summaryData, sentences, index]);

  /** 지금 문장에 이름이 나온 사람들 — 그 사람 본진 아바타를 크게 키운다(요청). 스냅마다
   *  주인공이 바뀌는 것을 아바타 크기로 보여 주는 자리다. */
  const mentioned: Set<string> = useMemo(() => {
    const beats = gameResult.summaryData?.beats ?? [];
    const out = new Set<string>();
    for (const n of sentences[index]?.beats ?? []) {
      const b = beats[n];
      if (!b) continue;
      [...(b.who ?? []), ...(b.whom ?? [])].forEach((raw) => out.add(raw));
      // 맺음말 스냅에서는 이긴 편 전원을 키운다(요청: 결론에선 이긴 팀들 다 아바타 확대하며
      // 마무리) — 맺음말의 who는 대표 몇 명으로 줄어 있을 수 있어서 팀 전체로 넓힌다.
      if (b.k === "result") {
        const team = slots.find((x) => (b.who ?? []).includes(x.raw))?.team;
        if (team) slots.filter((x) => x.team === team).forEach((x) => out.add(x.raw));
      }
    }
    return out;
  }, [gameResult.summaryData, sentences, index, slots]);

  /* 본진을 잃고 아군 기지로 살림을 옮긴 사람(요청: 본진을 버리고 이동한 경우 본진은 흑백
     처리하고 새 기지에 마크를 옮겨야 한다). lodging beat의 who2가 집주인이고, p.lost가 그
     사람이 원래 자리를 잃었다는 표시다(replayTactics의 lodging 주석). 그 스냅부터 계속
     옮겨 둔 채로 본다 — 한 번 쫓겨난 사람이 다음 장면에서 제자리로 돌아오면 안 된다. */
  const moved: Map<string, string> = useMemo(() => {
    const beats = gameResult.summaryData?.beats ?? [];
    const upto = Math.max(-1, ...(sentences[index]?.beats ?? []));
    const out = new Map<string, string>();
    for (let i = 0; i <= upto && i < beats.length; i += 1) {
      const b = beats[i];
      if (b.k !== "lodging" || b.p?.lost !== true) continue;
      const host = typeof b.who2 === "string" ? b.who2 : null;
      if (host) (b.who ?? []).forEach((raw) => out.set(raw, host));
    }
    return out;
  }, [gameResult.summaryData, sentences, index]);

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
  const actions = useMemo<{ arrows: MinimapArrow[]; marks: Map<string, string> }>(() => {
    const empty = { arrows: [], marks: new Map<string, string>() };
    const beats = gameResult.summaryData?.beats;
    const idx = sentences[index]?.beats;
    if (!beats || !idx) return empty;
    const spots = gameResult.summaryData?.bases ?? {};
    const teamOf = new Map(slots.map((s) => [s.raw, s.team]));
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
      const host = moved.get(raw);
      const v = spots[host && spots[host] ? host : raw];
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

    const target = (b: (typeof beats)[number], raw: string): [number, number] | null => {
      const home = homeOf(raw);
      if (!home) return null;
      const foe = nearestFoe(raw);
      const ally = nearestAlly(raw);
      // 센터에서 벌어진 일은 맵 가운데로(요청) — 건물 자리 분류보다 이 판정이 확실하다.
      if (CENTER_BEAT_KEYS.has(b.k)) return center;
      const spot = typeof b.p?.spot === "string" ? b.p.spot : null;
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
      // 아군을 도우러 간 것 — 목표는 그 아군의 기지다(요청: 아군 헬프).
      if (b.k === "ally-help") {
        const mate = (b.whom ?? []).find((v) => v !== raw && homeOf(v));
        return mate ? homeOf(mate) : ally;
      }
      // 여기부터는 '실제로 병력을 몰고 나간' 이야기만 화살표를 받는다(지적: 가끔 내용과
      // 화살표가 반대다 — 공격을 당한 건데 간 것으로 나온다). 막아 냈다·무너졌다·일꾼이
      // 밀렸다 같은 문장에도 whom이 붙어 있어서, 그것을 목표로 삼으면 맞은 사람에서
      // 때린 사람 쪽으로 화살표가 거꾸로 그려졌다.
      if (!ATTACK_BEAT_KEYS.has(b.k) && b.k !== "breakthrough") return null;
      // 당한 사람의 본진 — 여럿이면 상대 편을 먼저 고른다(아군 오사가 아니라 공격 목표).
      const victims = (b.whom ?? []).filter((v) => v !== raw);
      const foeVictim = victims.find((v) => teamOf.get(v) && teamOf.get(v) !== teamOf.get(raw));
      const victim = foeVictim ?? victims[0];
      if (victim && homeOf(victim)) return homeOf(victim);
      // 목표를 모르면 상대 쪽으로 — 리콜·커널·드랍이 여기 걸린다.
      if (foe) return foe;
      // 그 밖(유닛을 뽑았다·물량을 모았다·테크를 올렸다)은 화살표를 그리지 않는다(요청:
      // 유닛 생산에는 화살표 X, 실제로 확실히 공격 나갔을 때만 진출 화살표). 진출 느낌을
      // 주려고 가운데로 짧게 그어 봤지만, 병력을 뽑기만 한 장면에도 화살이 나가서
      // '공격을 갔다'로 읽혔다.
      return null;
    };

    // 한 문장에 여러 beat가 들어가면 같은 사람이 여러 번 나올 수 있다 — 뒤에 오는 것(더
    // 나중의 일)이 이긴다. 당한 사람은 뺀다: 맞은 쪽에서 나가는 화살표는 이야기가 아니다.
    /** 그 beat에 붙일 이모지 — 표에 없으면 공격 계열은 검 대결, 그 밖은 생산으로 채운다. */
    const markOf = (k: string): string =>
      BEAT_MARK[k] ?? (ATTACK_BEAT_KEYS.has(k) ? "⚔️" : "🏭");

    const to = new Map<string, [number, number]>();
    const flight = new Map<string, boolean>();
    const mark = new Map<string, string>();
    for (const n of idx) {
      const b = beats[n];
      if (!b) continue;
      const victims = new Set(b.whom ?? []);
      for (const raw of b.who ?? []) {
        if (victims.has(raw)) continue;
        mark.set(raw, markOf(b.k));
        const t = target(b, raw);
        if (!t) { to.delete(raw); continue; }
        to.set(raw, t);
        flight.set(raw, FLIGHT_BEAT_KEYS.has(b.k));
      }
    }
    // 화살표로 그릴 수 있는 것(자기 집에서 충분히 멀리 간 것)과, 화살표 없이 본진에만 이모지가
    // 붙는 것(생산·테크·경제, 그리고 목표가 자기 집 안인 것)으로 나눈다.
    const arrows: MinimapArrow[] = [];
    const marks = new Map<string, string>();
    for (const s of slots) {
      const em = mark.get(s.raw);
      if (!em) continue;
      const home = homeOf(s.raw);
      const t = to.get(s.raw);
      if (home && t && dist(home, t) >= ARROW_MIN_TILES) {
        arrows.push({
          key: s.raw, x1: home[0], y1: home[1], x2: t[0], y2: t[1],
          team: s.team, flight: flight.get(s.raw) ?? false, mark: em, deep,
        });
      } else {
        marks.set(s.raw, em);
      }
    }
    return { arrows, marks };
  }, [gameResult.summaryData, sentences, index, slots, grid, moved]);
  const arrows = actions.arrows;

  // 미니맵 표시 — 본진 아바타는 늘 떠 있고, 지금 문장의 주인공만 커진다(요청).
  const bases: MinimapMarker[] = useMemo(() => {
    const spots = gameResult.summaryData?.bases;
    if (!spots) return [];
    const w = grid?.width ?? 128;
    const h = grid?.height ?? 128;
    /** 살림을 옮긴 사람의 새 자리 — 집주인 기지에서 가운데 쪽으로 조금 비켜 앉힌다(집주인
     *  아바타와 겹치지 않게). */
    const movedSpot = (host: string): [number, number] | null => {
      const p = spots[host];
      if (!p) return null;
      const dx = w / 2 - p[0];
      const dy = h / 2 - p[1];
      const len = Math.hypot(dx, dy) || 1;
      return [p[0] + (dx / len) * 8, p[1] + (dy / len) * 8];
    };
    const out: MinimapMarker[] = [];
    for (const s of slots) {
      if (!spots[s.raw]) continue;
      const nameLc = normalizeSearchText(s.name);
      const hit = highlightMemberIds?.has(s.slot.memberId)
        || !!highlightTerms?.some((t) => nameLc.includes(t));
      const host = moved.get(s.raw);
      const at = host ? movedSpot(host) : null;
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
        featured: mentioned.has(s.raw),
        // 화살표가 없는 이야기(생산·테크·경제)는 그 사람 본진에 이모지를 붙인다(요청).
        mark: actions.marks.get(s.raw),
      });
    }
    return out;
  }, [gameResult.summaryData, slots, memberOf, highlightMemberIds, highlightTerms, downed, mentioned,
    actions, moved, grid]);

  const o1 = outcomeFor("team1", result);
  const o2 = outcomeFor("team2", result);
  const mapName = cleanMapName(gameResult.mapName);
  const minutes = gameResult.durationSeconds != null
    ? Math.round(gameResult.durationSeconds / 60) : null;
  // 미니맵이 있으면 맵 이름·플레이시간은 그림의 머리로 올라간다 — 아래 따로 한 줄 더 두면
  // 같은 말이 두 번 나온다.
  const showRoster = !mobile || grid === null;
  // 자막으로 보여줄 수 있는 경기인가 — 미니맵이 있고 훑을 문장이 있을 때. 그림이 없으면
  // 자막만 남아 무엇을 보고 읽는 글인지 알 수 없다.
  const caption = grid !== null && sentences.length > 0;
  const showMapLine = grid === null && (mapName || minutes !== null);

  const mapBlock = grid && (
    <div className="scr-story-map">
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
            <span className="scr-challenge-arrow-row">
              <span className={cx("scr-challenge-inline-win", o1 === "draw" && "scr-challenge-inline-draw", o1 !== "win" && o1 !== "draw" && "scr-challenge-inline-win-hidden")}>
                {o1 === "draw" ? "무" : "승"}
              </span>
              <span className="scr-challenge-arrow scr-challenge-arrow-vs" aria-hidden="true">vs</span>
              <span className={cx("scr-challenge-inline-win", o2 === "draw" && "scr-challenge-inline-draw", o2 !== "win" && o2 !== "draw" && "scr-challenge-inline-win-hidden")}>
                {o2 === "draw" ? "무" : "승"}
              </span>
            </span>
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
      {caption && (
        <div className="scr-story-cap">
          {sentences.map((sn, i) => (
            <p key={i} className="scr-story-cap-line" aria-hidden={i !== index} data-on={i === index}>
              {sn.parts.map((pt, j) => (pt.team
                ? <span key={j} className={pt.team === 1 ? "scr-sum-team1" : "scr-sum-team2"}>{pt.text}</span>
                : <span key={j}>{pt.text}</span>))}
            </p>
          ))}
        </div>
      )}
      {/* 타임라인은 스냅이 둘 이상일 때만 쓸모가 있다 — 한 문장짜리 요약에 재생 버튼을 두면
          누를 데는 있는데 아무 일도 안 일어난다. */}
      {grid && sentences.length > 1 && (
        <ReplayStoryTimeline
          snaps={sentences} end={gameResult.summaryData?.end ?? null}
          index={index} playing={playing} finished={finished}
          onSeek={(i) => { setIndex(i); setPlaying(false); }}
          onToggle={() => {
            if (finished) { setIndex(0); setPlaying(true); return; }
            setPlaying((v) => !v);
          }}
        />
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
