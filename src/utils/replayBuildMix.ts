// 그 판에서 '무엇을 지었고 무엇을 뽑았나'의 구성비(요청: 통계 생산 칸에 도넛 셋 + 초반
// 일꾼 수).
//
// 총량 하나(buildCount)로는 "많이 했다"까지밖에 못 말한다. 같은 300이라도 방어탑만 올린
// 판과 병력만 뽑은 판은 전혀 다른 경기고, 기본 유닛만 굴린 사람과 마법 유닛까지 간 사람도
// 다르다. 그래서 그 총량을 갈래별로 나눠 함께 저장한다 — 보는 쪽은 비율만 그리면 된다.
//
// 세는 단위는 buildCount와 같은 '커맨드'다(replayParser의 buildCount 주석 참고). 저그 라바
// 여러 마리를 한 번에 변태시키면 커맨드가 하나라 실제 수보다 적게 세지는 한계도 그대로다 —
// 어차피 비율로 읽는 값이라 갈래마다 같은 자로 재는 것이 중요하지, 절대 수가 중요하지 않다.

import type { ReplayPlayerSignals } from "./replayParser";

/** 초당 프레임(다른 파일들과 같은 값) — 초반 일꾼 수를 셀 때만 쓴다. */
const SECONDS_PER_FRAME = 0.042;
/** '초반 일꾼'을 세는 선(초) — 요청: 초반 5분까지의 일꾼 생산 수. */
export const WORKER_EARLY_SEC = 5 * 60;

/** 막는 건물 — 나머지 건물은 전부 '생산'으로 본다(요청: 건물 빌드 비율은 생산/방어).
 *  크립 콜로니는 성큰·스포어가 되기 전 단계라 방어로 센다. */
const DEFENSE_BUILDINGS = new Set([
  "Bunker", "Missile Turret",
  "Photon Cannon", "Shield Battery",
  "Creep Colony", "Sunken Colony", "Spore Colony",
]);

const WORKER_UNITS = new Set(["SCV", "Probe", "Drone"]);
/** 병력으로 세지 않는 것들 — 일꾼·보급·알·소모품. 비율을 흐리기만 한다. */
const NOT_ARMY = new Set([
  ...WORKER_UNITS, "Larva", "Egg", "Overlord", "Cocoon", "Mutalisk Cocoon", "Lurker Egg",
  "Interceptor", "Scarab", "Spider Mine", "Scanner Sweep", "Nuclear Missile",
]);

/** 마법 유닛 — 에너지를 쓰는 것이 그 유닛의 존재 이유인 것들. 메딕·고스트는 여기 안 넣는다:
 *  메딕은 바이오닉의 한 부분이고 고스트는 사실상 핵·락다운용이라 수가 아주 적어, 넣으면
 *  '마법 비중'이 그 사람의 운영이 아니라 종족을 말하는 값이 된다. */
const CASTER_UNITS = new Set([
  "High Templar", "Dark Archon", "Arbiter", "Science Vessel", "Defiler", "Queen",
]);
/** 기본 유닛 — 첫 생산 건물에서 바로 나오는 것들. 나머지 전투 유닛은 전부 '고급'이다
 *  (테크 건물이나 추가 건물을 하나 더 거쳐야 나오는 것들). */
const BASIC_UNITS = new Set([
  "Marine", "Firebat", "Medic", "Vulture",
  "Zealot", "Dragoon",
  "Zergling", "Hydralisk",
]);
/** 하늘에 뜨는 것 — 오버로드는 위 NOT_ARMY에서 이미 빠진다. */
const AIR_UNITS = new Set([
  "Wraith", "Dropship", "Science Vessel", "Valkyrie", "Battlecruiser",
  "Shuttle", "Observer", "Scout", "Corsair", "Carrier", "Arbiter",
  "Mutalisk", "Guardian", "Devourer", "Scourge", "Queen",
]);

/** 한 사람의 그 경기 생산 구성. 값은 전부 커맨드 수이고, 보는 쪽은 비율로 읽는다. */
export interface BuildMix {
  /** 건물 — 생산(테크·확장 포함) / 방어. */
  bProd: number;
  bDef: number;
  /** 병력 — 기본 / 고급 / 마법. */
  uBasic: number;
  uAdv: number;
  uCaster: number;
  /** 병력 — 지상 / 공중. */
  uGround: number;
  uAir: number;
  /** 초반(WORKER_EARLY_SEC)까지 뽑은 일꾼 수. */
  worker5: number;
}

export const EMPTY_BUILD_MIX: BuildMix = {
  bProd: 0, bDef: 0, uBasic: 0, uAdv: 0, uCaster: 0, uGround: 0, uAir: 0, worker5: 0,
};

/** 서버에서 온 값이 우리가 아는 형식인지 — JSON 컬럼이라 무엇이든 들어올 수 있다. */
export function isBuildMix(v: unknown): v is BuildMix {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return (Object.keys(EMPTY_BUILD_MIX) as (keyof BuildMix)[])
    .every((k) => typeof m[k] === "number" && Number.isFinite(m[k] as number));
}

/** 여러 경기의 구성을 하나로 더한다 — 통계는 기간 안의 경기를 통째로 합쳐 비율을 낸다.
 *  경기마다 비율을 내서 평균 내지 않는 이유: 3분짜리 판과 40분짜리 판의 비율을 같은 무게로
 *  섞으면 짧은 판 한 번이 그 사람의 그림을 통째로 흔든다. */
export function addBuildMix(a: BuildMix, b: BuildMix): BuildMix {
  const out = { ...EMPTY_BUILD_MIX };
  for (const k of Object.keys(EMPTY_BUILD_MIX) as (keyof BuildMix)[]) out[k] = a[k] + b[k];
  return out;
}

export function buildMixTotals(m: BuildMix): { buildings: number; army: number; area: number } {
  return {
    buildings: m.bProd + m.bDef,
    army: m.uBasic + m.uAdv + m.uCaster,
    area: m.uGround + m.uAir,
  };
}

/** 커맨드 스트림에서 모은 재료(signals)로 그 경기의 구성을 낸다. 재료가 없으면 null. */
export function buildMixOf(s: ReplayPlayerSignals | null | undefined): BuildMix | null {
  if (!s) return null;
  const out = { ...EMPTY_BUILD_MIX };
  for (const [b, n] of Object.entries(s.buildingCounts)) {
    if (DEFENSE_BUILDINGS.has(b)) out.bDef += n; else out.bProd += n;
  }
  for (const [u, n] of Object.entries(s.unitCounts)) {
    if (NOT_ARMY.has(u)) continue;
    if (CASTER_UNITS.has(u)) out.uCaster += n;
    else if (BASIC_UNITS.has(u)) out.uBasic += n;
    else out.uAdv += n;
    if (AIR_UNITS.has(u)) out.uAir += n; else out.uGround += n;
  }
  const early = WORKER_EARLY_SEC / SECONDS_PER_FRAME;
  for (const u of WORKER_UNITS) {
    out.worker5 += (s.unitFrames[u] ?? []).filter((f) => f <= early).length;
  }
  return out;
}
