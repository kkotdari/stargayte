// 통계 표의 닉네임 아래에 붙는 한 줄 칭호(요청) — "물량 끝판왕", "번개같은 손놀림",
// "공포의 럴커 부대"처럼 그 사람이 어떻게 게임하는지를 한마디로 부르는 별명이다.
//
// 규칙 하나만 지킨다: 칭호는 반드시 그 사람의 기록에서 나와야 한다. 무작위로 돌리거나
// 돌아가며 나눠 주면 재미는 잠깐이고 그다음부터는 아무도 안 읽는 글자가 된다 — 읽는 사람이
// "왜 저게 붙었지?"하고 표를 다시 보게 만드는 것이 이 줄의 값어치다.
//
// 두 단계로 뽑는다.
//   1) 왕관 — 그 무리에서 어떤 값의 1등인 사람에게. 한 칭호는 한 사람만, 한 사람은 한 칭호만.
//   2) 특징 — 왕관을 못 받은 사람은 제 기록에서 가장 튀는 것(많이 뽑은 유닛, 많이 쓴 마법)으로.
// 둘 다 못 잡으면 전적만 보고 무난한 말 하나를 준다. 한 판도 안 뛴 사람은 아예 안 붙인다 —
// 없는 사실로 별명을 지을 수는 없다.

import { PER_WINDOW_SECONDS } from "./replayBuildMix";
import { BUILDING_KO, TECH_KO, UNIT_KO } from "./replaySummaryText";
import type { MemberStats } from "../types";

/** 칭호를 붙일 최소 경기 수 — 한두 판으로 무엇의 "왕"을 부를 수는 없다. */
const MIN_PLAYS = 3;
/** 승률만은 더 본다 — 3판 3승이 곧 "정점"이 되면 그 칭호는 아무 말도 안 하는 것과 같다. */
const MIN_PLAYS_RATE = 8;
/** 왕관은 겨룰 사람이 이만큼은 있어야 뜻이 선다 — 둘 중 1등은 1등이 아니다. */
const MIN_POOL = 3;
/** 1등 값이 무리 한가운데보다 이만큼은 커야 왕관이다. 다들 비슷한데 소수점이 조금 컸을
 *  뿐인 1등에 "끝판왕"을 씌우면, 그 표의 모든 칭호가 같이 거짓말이 된다. */
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

function median(vals: number[]): number {
  const s = [...vals].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* ── 왕관 ──────────────────────────────────────────────────────────────────────
   값이 클수록 좋은 것만 담는다 — 작을수록 좋은 값(예: 패배)으로 별명을 지으면 놀리는 말이
   된다. 순서가 곧 우선순위다: 여러 값에서 1등인 사람은 앞에 있는 칭호를 가져가고, 그 사람이
   가져간 칭호의 나머지는 2등에게 물려주지 않고 그냥 안 쓴다 — 2등에게 "끝판왕"을 붙이는
   순간 이 줄은 순위표가 아니라 참가상이 된다.
   앞쪽에 '어떻게 하는가'(스타일)를, 뒤쪽에 '얼마나 했는가'(양)를 둔다: 같은 1등이라도
   앞쪽이 그 사람을 더 많이 말해 준다. */
interface Crown {
  label: string;
  value: (s: MemberStats) => number | null;
  /** 1등이라도 이 값은 넘어야 씌운다 — 비율로 재는 칭호에만 있다.
   *
   *  이 문턱을 value 안에서 걸면 안 된다(초기 구현의 버그): 문턱에 못 미치는 사람을 null로
   *  떨어뜨리면 후보 수가 줄어 아래 MIN_POOL을 못 넘기고, 그러면 공중 비중 89%짜리 한 명이
   *  있어도 "하늘의 지배자"가 아예 안 나간다. 겨룰 사람이 몇인가(MIN_POOL)와 1등이 그럴
   *  만한가(min)는 서로 다른 질문이라 따로 물어야 한다. */
  min?: number;
}

const CROWNS: Crown[] = [
  { label: "물량 끝판왕", value: (s) => (s.buildMix ? perMin(s.buildMix.coreUnit, s.mixSeconds) : null) },
  { label: "번개같은 손놀림", value: (s) => s.avgApm },
  {
    label: "하늘의 지배자",
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
    label: "철벽의 수호자",
    value: (s) => (s.buildMix ? share(s.buildMix.bDef, s.buildMix.bProd, 20) : null),
    min: 0.12,
  },
  { label: "자원 캐기의 왕", value: (s) => s.avgWorker5 },
  { label: "승률의 정점", value: (s) => (s.plays >= MIN_PLAYS_RATE ? s.winRate : null) },
  { label: "BEST의 단골", value: (s) => (s.bests > 0 ? s.bests : null) },
  { label: "쉬지 않는 손", value: (s) => s.avgCmd },
  { label: "쉴 새 없이 짓는 자", value: (s) => (s.buildMix ? perMin(s.buildMix.coreBuild, s.mixSeconds) : null) },
  { label: "개근의 아이콘", value: (s) => s.plays },
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
];

/* ── 특징 ──────────────────────────────────────────────────────────────────────
   왕관을 못 받은 사람은 남과 견주지 않고 제 기록에서만 뽑는다 — 무리에서 1등이 아니어도
   "이 사람 하면 저것"은 있다. 이름(럴커·스톰)이 들어가는 말이라 사람마다 저절로 달라진다. */

/** 한국어 받침 — 조사(은/는, 을/를)를 고른다. 유닛·기술 이름은 사전(UNIT_KO 등)이 한국어로
 *  옮긴 값이라 여기서 한글만 보면 된다. */
function hasFinal(word: string): boolean {
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}
const obj = (w: string) => (hasFinal(w) ? "을" : "를");
const sub = (w: string) => (hasFinal(w) ? "은" : "는");

const UNIT_SAYS: ((n: string) => string)[] = [
  (n) => `공포의 ${n} 부대`,
  (n) => `${n}${sub(n)} 나의 것`,
  (n) => `${n}의 화신`,
  (n) => `${n}의 아이콘`,
  (n) => `${n} 하나로 간다`,
];
const SKILL_SAYS: ((n: string) => string)[] = [
  (n) => `${n}${obj(n)} 부르는 자`,
  (n) => `${n}의 대가`,
  (n) => `${n} 장인`,
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
 *  럴커를 모아도 한 명은 "공포의 럴커 부대", 다른 한 명은 "럴커는 나의 것"이 된다.
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
    /* 병력의 4분의 1을 한 유닛이 차지하면 그건 취향이 아니라 그 사람의 전술이다.
       일꾼·보급은 애초에 이 원장에 없다(replayBuildMix) — 그래서 이 비율이 곧 병력 구성이다. */
    const unit = topOf(m.units, UNIT_KO);
    if (unit && unit.share >= 0.25 && unit.count >= 10) {
      const t = pick(UNIT_SAYS, unit.name, seed, used);
      if (t) return t;
    }
    /* 마법은 한 번 쓰기도 어려운 것이라 비중을 안 따진다 — 가장 많이 쓴 것 하나면 충분히
       그 사람다운 말이 된다. */
    const skill = topOf(m.skills, TECH_KO);
    if (skill && skill.count >= 5) {
      const t = pick(SKILL_SAYS, skill.name, seed, used);
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

  if (ranked.length >= MIN_POOL) {
    for (const crown of CROWNS) {
      const vals = ranked
        .map((p) => ({ id: p.id, v: crown.value(p.stats) }))
        .filter((x): x is { id: string; v: number } => x.v !== null && x.v > 0);
      if (vals.length < MIN_POOL) continue;
      const top = Math.max(...vals.map((x) => x.v));
      if (crown.min !== undefined && top < crown.min) continue;
      if (top < median(vals.map((x) => x.v)) * CROWN_EDGE) continue;
      const winners = vals.filter((x) => x.v === top);
      // 공동 1위가 절반을 넘으면 그건 그 사람의 특징이 아니라 그 무리의 평균이다.
      if (winners.length > vals.length / 2) continue;
      let given = false;
      for (const w of winners) {
        if (out.has(w.id)) continue;
        out.set(w.id, crown.label);
        given = true;
      }
      if (given) used.add(crown.label);
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
