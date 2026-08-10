// 통계 표와 회원 프로필의 닉네임에 붙는 칭호 한 줄(요청) — "물량퀸", "옆탱의 여왕",
// "공포의 독거미 부대", "닥치고 캐리어"처럼 그 사람이 어떻게 게임하는지를 한마디로 부르는 말.
//
// 규칙 하나만 지킨다: 칭호는 반드시 그 사람의 기록에서 나와야 한다. 무작위로 돌리거나
// 돌아가며 나눠 주면 재미는 잠깐이고 그다음부터는 아무도 안 읽는 글자가 된다 — 읽는 사람이
// "왜 저게 붙었지?" 하고 표를 다시 보게 만드는 것이 이 줄의 값어치다.
//
// 재료는 셋이다.
//   1) 전술 — 리플레이 요약이 자막으로 말하던 그 사실 그대로다(요청: 자막에서 강조되는
//      옆탱·센포 같은 것들을 칭호에도). 서버가 요약의 문장 틀 키를 사람별로 세어 준다.
//   2) 맵 — 유독 잘하는 맵이 있으면 "○○의 지배자"(요청).
//   3) 수치 — 물량·APM·공중 비중처럼 표에 이미 있는 값들.
//
// 뽑는 차례는 두 단계다.
//   왕관: 아래 TITLES를 위에서부터 훑어 그 값의 1등에게 하나씩. 한 칭호는 한 사람만,
//         한 사람은 한 칭호만. 위쪽에 있을수록 '그 사람다움'을 많이 말하는 칭호다.
//   특징: 왕관을 못 받은 사람은 남과 견주지 않고 제 기록에서 가장 튀는 것(많이 뽑은
//         유닛, 많이 쓴 마법)으로 짓는다 — 이름이 들어가는 말이라 사람마다 저절로 갈린다.
// 둘 다 못 잡으면 전적만 보고 무난한 말 하나를 준다. 한 판도 안 뛴 사람은 아예 안 붙인다 —
// 없는 사실로 별명을 지을 수는 없다.

import { PER_WINDOW_SECONDS } from "./replayBuildMix";
import { BUILDING_KO, TECH_KO, UNIT_KO } from "./replaySummaryText";
import type { MemberStats } from "../types";

/** 칭호를 붙일 최소 경기 수 — 한두 판으로 무엇의 "왕"을 부를 수는 없다. */
const MIN_PLAYS = 3;
/** 승률만은 더 본다 — 3판 3승이 곧 "정점"이 되면 그 칭호는 아무 말도 안 하는 것과 같다. */
const MIN_PLAYS_RATE = 8;
/** 수치 칭호는 겨룰 사람이 이만큼은 있어야 뜻이 선다 — 둘 중 1등은 1등이 아니다. */
const MIN_POOL = 3;
/** 수치 칭호의 1등 값이 무리 한가운데보다 이만큼은 커야 왕관이다. 다들 비슷한데 소수점이
 *  조금 컸을 뿐인 1등에 "끝판왕"을 씌우면, 그 표의 모든 칭호가 같이 거짓말이 된다. */
const CROWN_EDGE = 1.15;

export interface EpithetSubject {
  id: string;
  stats: MemberStats;
}

/** 주요시간대 1분당 값 — 총합은 오래 뛴 사람이 늘 크다(MemberStatRow의 perMin과 같은 자). */
function perMin(total: number, seconds: number | null | undefined): number | null {
  return seconds && seconds > 0 ? (total / seconds) * PER_WINDOW_SECONDS : null;
}

/** 두 갈래의 비율 — 표본이 너무 적으면(min) 비율이 우연이라 안 센다. */
function share(a: number, b: number, min: number): number | null {
  const total = a + b;
  return total >= min ? a / total : null;
}

/** 전술 횟수 — 여러 키를 한 칭호로 묶을 때가 있다(드랍은 종족마다 키가 다르다). */
function did(s: MemberStats, ...keys: string[]): number | null {
  const t = s.tactics;
  if (!t) return null;
  const n = keys.reduce((sum, k) => sum + (t[k] ?? 0), 0);
  return n > 0 ? n : null;
}

function median(vals: number[]): number {
  const s = [...vals].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* ── 유독 잘하는 맵 ──────────────────────────────────────────────────────────── */
/** 한 맵을 '잘한다'고 부르려면 이만큼은 뛰어야 한다 — 두 판 다 이겼다고 지배자는 아니다. */
const MAP_MIN_PLAYS = 5;
/** 그리고 이만큼은 이겨야 한다. */
const MAP_MIN_RATE = 0.6;

/** 그 사람이 가장 잘하는 맵과 그 승수. 문턱을 못 넘으면 null.
 *  값(승수)으로 겨루는 이유: 승률만 보면 딱 문턱만큼 뛴 사람이 늘 이긴다. */
function bestMap(s: MemberStats): { name: string; wins: number } | null {
  let best: { name: string; wins: number } | null = null;
  for (const [name, record] of Object.entries(s.maps ?? {})) {
    const [plays, wins] = record;
    if (plays < MAP_MIN_PLAYS || wins / plays < MAP_MIN_RATE) continue;
    if (!best || wins > best.wins) best = { name, wins };
  }
  return best;
}

/* ── 칭호 표 ──────────────────────────────────────────────────────────────────
   위에 있을수록 먼저 나간다. 차례를 이렇게 잡은 이유:

     전술 → 맵 → 스타일(무엇을 어떻게 뽑나) → 양(얼마나 했나)

   전술이 맨 위인 것은 그것이 '그 판에서 실제로 벌인 일'이라 사람을 가장 많이 말해 주기
   때문이다(요청: 자막에서 강조되는 것들). 게임 수·APM 같은 양은 누구나 시간을 들이면
   올라가는 값이라 맨 뒤에 둔다.

   전술·맵 칭호는 겨룰 사람 수(MIN_POOL)도, 한가운데와의 차이(CROWN_EDGE)도 안 따진다 —
   성큰러시를 한 사람이 클럽에 혼자뿐이라면 그게 바로 그 사람의 칭호다. 대신 min으로
   "한 번은 우연"을 걸러 낸다. */
interface Title {
  /** 화면에 적히는 말. name이 있는 줄은 {n} 자리에 그 이름이 들어간다. */
  label: string;
  /** 클수록 이 칭호에 가깝다. null이면 후보 아님. */
  value: (s: MemberStats) => number | null;
  /** 1등이라도 이 값은 넘어야 씌운다.
   *
   *  이 문턱을 value 안에서 걸면 안 된다(초기 구현의 버그): 문턱에 못 미치는 사람을 null로
   *  떨어뜨리면 후보 수가 줄어 pool을 못 넘기고, 그러면 공중 비중 89%짜리 한 명이 있어도
   *  "하늘의 여전사"가 아예 안 나간다. 겨룰 사람이 몇인가와 1등이 그럴 만한가는 서로 다른
   *  질문이라 따로 물어야 한다. */
  min?: number;
  /** 후보가 이만큼은 돼야 매긴다(기본 MIN_POOL). 전술·맵은 1. */
  pool?: number;
  /** 1등이 한가운데의 몇 배는 돼야 하나(기본 CROWN_EDGE). 전술·맵은 1(안 따짐). */
  edge?: number;
  /** {n}에 꽂을 이름 — 맵 칭호처럼 말 자체에 그 사람의 값이 들어가는 경우. */
  name?: (s: MemberStats) => string | null;
}

/** 전술 칭호 한 줄 — 겨룰 사람 수도 한가운데와의 차이도 안 따지고(위 주석), 최소 횟수만
 *  본다. 여러 키를 묶는 것은 종족마다 이름이 다른 전술 때문이다(드랍이 그렇다). */
const tactic = (label: string, keys: string[], min = 2): Title => ({
  label, value: (s) => did(s, ...keys), pool: 1, edge: 1, min,
});
/** 어지간해선 두 번 나오기 어려운 것들 — 한 번으로도 그 사람의 표식이 된다. */
const rare = (label: string, keys: string[]): Title => tactic(label, keys, 1);

const TITLES: Title[] = [
  /* ── 사람 노릇(요청: 꼭 넣을 것) ────────────────────────────────────────────
     맨 위에 둔다 — 혼자 잘하는 것보다 판을 함께 굴린 쪽이 먼저 불릴 자격이 있다.
     헬프(ally-help)는 제 살림을 놔두고 남의 집으로 병력을 돌린 대목이라, 이기고 지는
     것과 상관없이 그 사람이 어떤 사람인지를 가장 잘 말해 준다. */
  tactic("헬프 퀸", ["ally-help"]),
  tactic("동맹의 수호신", ["ally-cannon"]),
  /* 입구막기는 '막았다'가 아니라 '막아 놓고 뒤에서 컸다'가 값어치다(판정도 발전까지 함께
     본다 — replayTactics의 WALL_IN_GROW_MIN). 그래서 칭호도 막은 쪽이 아니라 그다음을
     부른다(요청: 후반 도모 퀸). */
  tactic("후반 도모 퀸", ["wall-in"]),
  /* 조이기(요청) — 센터에 탱크를 박아 길목을 잠근 대목이다. 자막에서도 "중앙을 걸어
     잠그고 그 자리를 내주지 않았다"로 말하는 그 수다. */
  tactic("조이기의 달인", ["center-tank"]),

  // ── 전술(리플레이 자막이 말하던 그 사실) ────────────────────────────────────
  tactic("옆탱의 여왕", ["side-tank"]),
  tactic("센포의 지배자", ["center-photon"]),
  tactic("포토러시의 퀸", ["cannon-rush"]),
  tactic("성큰러시의 절대자", ["sunken-rush"]),
  // 드랍은 종족마다 키가 다르다 — 하나로 묶어야 "드랍 잘하는 사람"이라는 말이 된다.
  tactic("드랍의 여신", ["dropship", "shuttle", "zerg-drop", "templar-drop", "shuttle-reaver"]),
  tactic("일꾼 사냥꾼", ["harass-workers"]),
  tactic("지긋지긋한 견제러", ["harass-long"]),
  tactic("남의 집 헤집기 장인", ["base-raid"]),
  rare("땅굴의 설계자", ["nydus"]),
  rare("리콜의 마술사", ["recall"]),
  rare("마인드 컨트롤러", ["mind-control"]),
  tactic("캐리어 퀸", ["carrier"]),
  tactic("공포의 독거미 부대", ["lurker"]),
  tactic("보이지 않는 손", ["cloak-wraith"]),
  tactic("뮤탈 조련사", ["muta"]),
  tactic("오버로드 사냥꾼", ["valk-hunt"]),
  tactic("몰래 배럭의 대가", ["sneak-rax"]),
  tactic("저글링 폭풍", ["zling-rush"]),
  tactic("질럿 돌격대장", ["zealot-rush"]),
  tactic("맞러시 승부사", ["duel-rush"]),
  tactic("협공의 선봉", ["gang-rush"]),
  rare("다크스웜의 여신", ["swarm"]),
  rare("감염술사", ["infested"]),
  tactic("가디언 함대 사령관", ["guardian"]),
  tactic("배틀 퀸", ["bc"]),
  tactic("발키리 지휘관", ["valkyrie"]),
  tactic("목동 저그", ["moka"]),
  tactic("우리 집 문지기", ["front-defense"]),
  tactic("메카닉 진격대장", ["mech"]),
  tactic("바이오닉 지휘관", ["bionic"]),
  tactic("테크의 연금술사", ["fast-tech"]),

  /* ── 판을 어떻게 끌고 갔나 ──────────────────────────────────────────────────
     여기부터는 '무엇을 뽑았나'가 아니라 '어떤 판을 만들었나'다. 지는 쪽으로 읽히는 키
     (rush-backfire·greedy-punished·fallen 같은 것)는 아예 안 쓴다 — 칭호는 놀리는
     자리가 아니다. 반대로 밀리고도 버틴 이야기(revival·relocate·lodging·lift-off)는
     쓴다: 그건 진 이야기가 아니라 끝까지 앉아 있었다는 이야기다. */
  tactic("수성의 여왕", ["hold-off"]),
  tactic("받아치기의 정석", ["counter"]),
  tactic("벽을 뚫는 자", ["breakthrough"]),
  tactic("한타의 지배자", ["clash"]),
  tactic("올인의 화신", ["allin"]),
  tactic("째기의 달인", ["greedy-paid"]),
  tactic("배짱의 화신", ["greedy-build"]),
  tactic("멀티 부동산왕", ["expand"]),
  tactic("자원 부자", ["worker-gap"]),
  tactic("생산 공장장", ["prod-gap"]),
  tactic("한 방 병력의 주인", ["power-unit"]),
  tactic("병력 사재기", ["mass-army"]),
  tactic("업글 덕후", ["upgrade-signature"]),
  tactic("소모전의 화신", ["attrition"]),
  tactic("눈치 싸움의 강자", ["standoff"]),
  tactic("지구전의 화신", ["long-run"]),
  tactic("끝까지 버티는 사람", ["late-hold", "late-defense", "stand"]),
  rare("좀비 모드", ["revival"]),
  rare("이사 퀸", ["relocate"]),
  rare("셋방살이 전문", ["lodging"]),
  /* (삭제) 건물 띄우기(lift-off)로 짓던 "공중부양 마스터" — 뺐다(지적). 이 키는 자리를
     다 내주고 건물만 띄워 쫓겨 다닌 대목이라, 버틴 이야기로 넣었지만 칭호로 굳으면
     "집을 잃은 사람"이라는 딱지로 읽힌다. 자막에서 한 번 지나가는 말과, 이름 아래
     늘 붙어 있는 말은 무게가 다르다. */
  rare("노엘을 외치는 자", ["no-elim"]),
  rare("프로 지망생", ["pro-like"]),

  // ── 맵 ─────────────────────────────────────────────────────────────────────
  {
    label: "{n}의 지배자",
    pool: 1, edge: 1,
    value: (s) => bestMap(s)?.wins ?? null,
    name: (s) => bestMap(s)?.name ?? null,
  },

  // ── 스타일(무엇을 어떻게 뽑나) ─────────────────────────────────────────────
  { label: "물량퀸", value: (s) => (s.buildMix ? perMin(s.buildMix.coreUnit, s.mixSeconds) : null) },
  { label: "번개같은 손놀림", value: (s) => s.avgApm },
  {
    label: "하늘의 여전사",
    // 공중 비중은 30%를 넘어야 '탄다'고 할 수 있다 — 드랍십 한 기로 하늘을 지배할 수는 없다.
    value: (s) => (s.buildMix ? share(s.buildMix.uAir, s.buildMix.uGround, 20) : null),
    min: 0.3,
  },
  {
    label: "마법의 화신",
    // 마법 유닛은 원래 수가 적다 — 5%만 넘어도 그 판을 마법으로 푼 사람이다.
    value: (s) => (s.buildMix ? share(s.buildMix.uCaster, s.buildMix.uBasic + s.buildMix.uAdv, 20) : null),
    min: 0.05,
  },
  {
    label: "고급 유닛 수집가",
    value: (s) => (s.buildMix ? share(s.buildMix.uAdv, s.buildMix.uBasic, 30) : null),
    min: 0.45,
  },
  {
    label: "철벽의 수호자",
    value: (s) => (s.buildMix ? share(s.buildMix.bDef, s.buildMix.bProd, 20) : null),
    min: 0.12,
  },
  { label: "다산의 아이콘", value: (s) => s.avgWorker5 },
  { label: "쉴 새 없이 짓는 자", value: (s) => (s.buildMix ? perMin(s.buildMix.coreBuild, s.mixSeconds) : null) },
  {
    label: "풀업 신봉자",
    value: (s) => {
      const m = s.buildMix;
      if (!m) return null;
      const n = Object.values(m.upCounts ?? {}).reduce((a, b) => a + b, 0);
      if (n <= 0) return null;
      return Object.values(m.ups ?? {}).reduce((a, b) => a + b, 0) / n;
    },
  },

  // ── 양(얼마나 했나) ────────────────────────────────────────────────────────
  { label: "승률의 정점", value: (s) => (s.plays >= MIN_PLAYS_RATE ? s.winRate : null) },
  { label: "BEST 수집가", value: (s) => (s.bests > 0 ? s.bests : null) },
  { label: "쉬지 않는 손가락", value: (s) => s.avgCmd },
  { label: "개근의 여왕", value: (s) => s.plays },
];

/* ── 특징 ──────────────────────────────────────────────────────────────────────
   왕관을 못 받은 사람은 남과 견주지 않고 제 기록에서만 뽑는다 — 무리에서 1등이 아니어도
   "이 사람 하면 저것"은 있다. 이름(럴커·스톰)이 들어가는 말이라 사람마다 저절로 달라진다. */

/** 한국어 받침 — 조사(은/는)를 고른다. 유닛·기술 이름은 사전(UNIT_KO 등)이 한국어로 옮긴
 *  값이라 여기서 한글만 보면 된다. */
function hasFinal(word: string): boolean {
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}
const sub = (w: string) => (hasFinal(w) ? "은" : "는");

/* "~를 부르는 자"는 뺐다(지적: 뜻이 명확하지 않다) — 부른다는 말이 '많이 쓴다'인지 '불러
   낸다'인지 읽는 사람마다 갈렸다. 대신 무엇을 했는지가 바로 읽히는 말만 남긴다. */
/* 그냥 "많이 뽑았다"는 재미가 없다(지적) — 수가 아니라 그 사람의 고집으로 읽히는 말만
   남긴다. "닥치고 ○○"·"○○ 없인 못 산다"처럼 한 유닛만 파는 그림이 이 자리의 웃음이다. */
const UNIT_SAYS: ((n: string) => string)[] = [
  (n) => `닥치고 ${n}`,
  (n) => `공포의 ${n} 부대`,
  (n) => `난 ${n}만 뽑는다`,
  (n) => `${n} 없인 못 산다`,
  (n) => `${n} 중독`,
  (n) => `${n}${sub(n)} 내 운명`,
  (n) => `${n} 사재기`,
  (n) => `${n}밖에 몰라`,
  (n) => `${n}${sub(n)} 나의 것`,
  (n) => `${n} 하나로 간다`,
];
const SKILL_SAYS: ((n: string) => string)[] = [
  (n) => `${n} 한 방의 여왕`,
  (n) => `${n}의 대가`,
  (n) => `${n} 장인`,
  (n) => `${n} 없으면 손이 떨림`,
];
const BUILD_SAYS: ((n: string) => string)[] = [
  (n) => `${n} 애호가`,
  (n) => `${n}의 주인`,
];

/** 원장에서 가장 많이 나온 이름과 그 비중. 이름은 한국어 사전을 거친 뒤에 합친다 —
 *  탱크처럼 영문명 둘이 한국어 하나인 경우가 있어 먼저 세면 제 몫이 갈린다. */
function topOf(d: Record<string, number> | undefined, ko: Record<string, string>) {
  const merged: Record<string, number> = {};
  let total = 0;
  for (const [key, v] of Object.entries(d ?? {})) {
    const name = ko[key];
    if (!name || !(v > 0)) continue;
    merged[name] = (merged[name] ?? 0) + v;
    total += v;
  }
  const best = Object.entries(merged).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (!best || total <= 0) return null;
  return { name: best[0], count: best[1], share: best[1] / total };
}

/** 같은 글자가 표에 두 번 서지 않도록 문틀을 하나씩 밀어 가며 고른다 — 두 사람이 똑같이
 *  럴커를 모아도 한 명은 "공포의 럴커 부대", 다른 한 명은 "닥치고 럴커"가 된다.
 *  시작 자리는 회원 id로 정해 조회할 때마다 말이 바뀌지 않게 한다. */
function pick(says: ((n: string) => string)[], name: string, seed: number, used: Set<string>): string | null {
  for (let i = 0; i < says.length; i++) {
    const text = says[(seed + i) % says.length](name);
    if (!used.has(text)) return text;
  }
  return null;
}

function seedOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

function signature(id: string, s: MemberStats, used: Set<string>): string | null {
  const seed = seedOf(id);
  const m = s.buildMix;
  if (m) {
    /* 마법을 유닛보다 먼저 본다(지적: 단순히 많이 뽑은 유닛은 재미가 없다) — 스톰·리콜처럼
       쓰기 어려운 것은 한 번만 나와도 그 사람 이야기가 되지만, 많이 뽑은 유닛은 대개 그
       종족의 주력이라 종족이 같으면 다 같은 말이 된다.
       비중을 안 따지는 것도 그래서다 — 가장 많이 쓴 것 하나면 충분하다. */
    const skill = topOf(m.skills, TECH_KO);
    if (skill && skill.count >= 5) {
      const t = pick(SKILL_SAYS, skill.name, seed, used);
      if (t) return t;
    }
    /* 병력의 3분의 1을 한 유닛이 차지하면 그건 주력이 아니라 고집이다 — 4분의 1에서 올렸다:
       그 정도는 어느 종족에나 있는 주력 비중이라 "닥치고 ○○"이라 부를 만한 그림이 아니다.
       일꾼·보급은 애초에 이 원장에 없다(replayBuildMix) — 그래서 이 비율이 곧 병력 구성이다. */
    const unit = topOf(m.units, UNIT_KO);
    if (unit && unit.share >= 0.33 && unit.count >= 10) {
      const t = pick(UNIT_SAYS, unit.name, seed, used);
      if (t) return t;
    }
    /* 건물은 마지막이다 — 종족이 정해지면 짓는 것도 대체로 정해져서, 유닛·마법만큼 그
       사람을 가르지 못한다. */
    const build = topOf(m.buildings, BUILDING_KO);
    if (build && build.share >= 0.3 && build.count >= 10) {
      const t = pick(BUILD_SAYS, build.name, seed, used);
      if (t) return t;
    }
  }
  /* 리플레이가 없는 사람(수기 등록·옛 경기)은 전적밖에 없다. 그래도 한 줄은 준다 —
     이 자리가 비면 그 줄만 닉네임이 위로 떠 표가 들쭉날쭉해 보인다. 지는 쪽에도 놀리는
     말은 안 쓴다: 여기 이름이 오르는 것은 계속 나오고 있다는 뜻이다. */
  if (s.plays >= MIN_PLAYS_RATE && s.winRate >= 60) return "이기는 맛을 아는 사람";
  if (s.winRate <= 35) return "다음 판을 노리는 자";
  return "묵묵히 한 판 더";
}

/** 회원 → 칭호. 왕관은 넘겨받은 무리 안에서만 매기므로, 부르는 쪽이 '검색에 걸린 목록'이
 *  아니라 '그 조건의 회원 전체'를 넘겨야 한다(메달과 같은 원칙) — 이름을 검색했다고 칭호가
 *  옮겨 다니면 그건 기록이 아니라 화면 효과다. */
export function epithetsOf(pool: EpithetSubject[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  const ranked = pool.filter((p) => p.stats.plays >= MIN_PLAYS);

  for (const title of TITLES) {
    const vals = ranked
      .map((p) => ({ id: p.id, v: title.value(p.stats), stats: p.stats }))
      .filter((x): x is { id: string; v: number; stats: MemberStats } => x.v !== null && x.v > 0);
    if (vals.length < (title.pool ?? MIN_POOL)) continue;
    const top = Math.max(...vals.map((x) => x.v));
    if (title.min !== undefined && top < title.min) continue;
    if (top < median(vals.map((x) => x.v)) * (title.edge ?? CROWN_EDGE)) continue;
    const winners = vals.filter((x) => x.v === top);
    // 공동 1위가 절반을 넘으면 그건 그 사람의 특징이 아니라 그 무리의 평균이다(수치 칭호에만
    // 해당한다 — 전술은 여럿이 같은 횟수인 것이 흔하고, 그래도 '한 사람만'은 아래에서 지킨다).
    if ((title.pool ?? MIN_POOL) > 1 && winners.length > vals.length / 2) continue;
    for (const w of winners) {
      if (out.has(w.id)) continue;
      const label = title.name
        ? title.label.replace("{n}", title.name(w.stats) ?? "")
        : title.label;
      if (!label || label.includes("{n}") || used.has(label)) continue;
      out.set(w.id, label);
      used.add(label);
      // 한 칭호는 한 사람만 — 공동 1위여도 먼저 걸린 사람이 가져간다(맵 칭호는 사람마다
      // 맵이 달라 이 줄에 걸리지 않는다: 이름이 다르면 다른 칭호다).
      if (!title.name) break;
    }
  }

  for (const p of pool) {
    if (out.has(p.id)) continue;
    if (p.stats.plays < MIN_PLAYS) continue;
    const text = signature(p.id, p.stats, used);
    if (!text) continue;
    out.set(p.id, text);
    used.add(text);
  }
  return out;
}
