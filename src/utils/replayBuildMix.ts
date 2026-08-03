// 그 판에서 '무엇을 지었고 무엇을 뽑았고 무엇을 썼나'(요청: 통계의 건설·유닛·스킬 칸).
//
// 총량 하나(buildCount)로는 "많이 했다"까지밖에 못 말한다. 같은 300이라도 방어탑만 올린
// 판과 병력만 뽑은 판은 전혀 다른 경기고, 기본 유닛만 굴린 사람과 마법 유닛까지 간 사람도
// 다르다. 그래서 그 총량을 갈래별로 나눠, 그리고 이름별 원장(건물·유닛·스킬)과 공/방 단계까지
// 함께 저장한다 — 보는 쪽은 비율을 그리고 많이 나온 다섯을 세기만 하면 된다.
//
// 세는 단위는 buildCount와 같은 '커맨드'다(replayParser의 buildCount 주석 참고). 저그 라바
// 여러 마리를 한 번에 변태시키면 커맨드가 하나라 실제 수보다 적게 세지는 한계도 그대로다 —
// 어차피 비율로 읽는 값이라 갈래마다 같은 자로 재는 것이 중요하지, 절대 수가 중요하지 않다.

import type { ReplayPlayerSignals } from "./replayParser";
import { BUILDING_KO, TECH_KO, UNIT_KO } from "./replaySummaryText";
import { upgradeLevel, type UpgradeName } from "./replayTechNames";

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
  /** 초반(WORKER_EARLY_SEC)까지 뽑은 일꾼 수 — 비율이 아니라 그냥 수다(요청). */
  worker5: number;
  /** 공/방/실드 업그레이드가 몇 단계까지 올라갔나(0~3). 종족마다 이름이 다르지만 부르는
   *  이름은 '지상/공중'과 '공/방' 넷이라, 종족 이름을 지우고 그 넷으로만 담는다(요청:
   *  종족 무관). 테란처럼 지상이 보병·메카닉 둘로 갈리는 종족은 높은 쪽을 그 판의 지상
   *  단계로 본다 — '얼마나 올렸나'를 말하는 값이라 낮은 쪽에 끌려 내려가면 뜻이 어긋난다.
   *  실드는 프로토스에만 있어 나머지 종족은 늘 0이다. */
  upGw: number;
  upGa: number;
  upAw: number;
  upAa: number;
  upSh: number;
  /** 건물별 건설 커맨드 수(screp 영문명) — 통계 '건설' 칸의 Top5. 파일런·서플라이는 뺀다
   *  (요청) — 보급을 대는 건물이라 어느 판에서나 압도적 1위가 돼 목록이 늘 같아진다. */
  buildings: Record<string, number>;
  /** 유닛별 생산 커맨드 수(screp 영문명) — 통계 '유닛' 칸이 여기서 Top5를 뽑는다. 일꾼·
   *  보급·알은 빼고, 이름을 아는 유닛(UNIT_KO)만 남긴다 — UMS 맵의 영웅 유닛까지 새어
   *  들어오면 목록이 엉망이 되고, 어차피 한국어 표기를 모르면 보여줄 수도 없다. */
  units: Record<string, number>;
  /** 실제로 '쓴' 마법·기술별 횟수(screp 영문명) — 통계 '스킬' 칸의 Top5. 연구만 하고 안
   *  쓴 기술은 0이라 여기 안 들어온다(signals.techUses가 사용 증거만 센다). */
  skills: Record<string, number>;
  /** 위 세 원장의 '이름별 총 경기시간(초)' — 그 이름이 한 번이라도 나온 경기들의 길이 합.
   *
   *  집계(기간 합계)에서만 채워지고 경기 하나짜리 값에서는 비어 있다 — 서버가 합칠 때
   *  세는 편이 payload도 가볍다.
   *
   *  왜 필요한가: 총합만으로는 "오래 뛰어서 큰 수"와 "한 판에 많이 써서 큰 수"가 구분되지
   *  않는다. 그래서 10분당 값으로 환산해 보여주는데(요청), 전체 경기시간으로 나누면 이번엔
   *  그 기술을 안 쓴 판의 시간까지 분모에 들어가 프로토스만 쓰는 기술의 값이 종족 비율만큼
   *  깎인다 — 그 이름이 실제로 나온 판의 시간만 분모로 쓴다. */
  buildingSecs: Record<string, number>;
  unitSecs: Record<string, number>;
  skillSecs: Record<string, number>;
}

/** 새 값 하나. 상수를 spread 해서 쓰면 사전들이 같은 객체를 공유하므로 함수로 낸다. */
export function emptyBuildMix(): BuildMix {
  return {
    bProd: 0, bDef: 0, uBasic: 0, uAdv: 0, uCaster: 0, uGround: 0, uAir: 0, worker5: 0,
    upGw: 0, upGa: 0, upAw: 0, upAa: 0, upSh: 0,
    buildings: {}, units: {}, skills: {},
    buildingSecs: {}, unitSecs: {}, skillSecs: {},
  };
}

/* 공/방/실드 — 종족별 이름을 '지상 공격 / 지상 방어 / 공중 공격 / 공중 방어 / 실드'
   다섯 자리로 모은다. 한 자리에 이름이 여럿이면 그중 가장 높이 올라간 것을 쓴다. */
const UP_LINES: Record<"upGw" | "upGa" | "upAw" | "upAa" | "upSh", UpgradeName[]> = {
  upGw: ["Terran Infantry Weapons", "Terran Vehicle Weapons",
         "Zerg Melee Attacks", "Zerg Missile Attacks", "Protoss Ground Weapons"],
  upGa: ["Terran Infantry Armor", "Terran Vehicle Plating", "Zerg Carapace", "Protoss Ground Armor"],
  upAw: ["Terran Ship Weapons", "Zerg Flyer Attacks", "Protoss Air Weapons"],
  upAa: ["Terran Ship Plating", "Zerg Flyer Carapace", "Protoss Air Armor"],
  upSh: ["Protoss Plasma Shields"],
};

/** 보급을 대는 건물 — 어느 판에서나 가장 많이 지어서 Top5의 1위를 늘 독차지한다(요청: 제외).
 *  저그 오버로드는 유닛이라 애초에 건물 목록에 없다. */
const SUPPLY_BUILDINGS = new Set(["Pylon", "Supply Depot"]);

/** 많이 나온 순 Top N. 이름은 영문 키로 저장돼 있으므로 부르는 쪽이 한국어 표기 사전을
 *  넘긴다 — 표기를 고치면 이미 등록된 경기도 다음 조회부터 새 표기로 읽히게 하기 위해서다
 *  (요약 문장이 저장된 문장 대신 저장된 사실을 두는 것과 같은 이유).
 *
 *  옮긴 뒤에 합치는 것이 중요하다: 탱크는 시즈/언시즈 두 영문명으로 오지만 한국어로는 둘 다
 *  "탱크"라, 먼저 순위를 매기면 "탱크"가 두 줄로 선다.
 *
 *  같은 수면 이름순으로 갈라 순서가 조회마다 흔들리지 않게 한다. */
export function topEntries(
  d: Record<string, number> | undefined, ko: Record<string, string>, n: number,
  secs?: Record<string, number>,
): TopEntry[] {
  const merged: Record<string, number> = {};
  const mergedSecs: Record<string, number> = {};
  // 서버가 아직 이 갈래를 안 내려주는 사이(프론트만 먼저 배포된 순간)에도 칸이 깨지지
  // 않아야 한다 — 없으면 그냥 빈 목록이다.
  for (const [key, v] of Object.entries(d ?? {})) {
    const name = ko[key];
    if (!name || !(v > 0)) continue;
    merged[name] = (merged[name] ?? 0) + v;
    const sv = secs?.[key];
    if (typeof sv === "number" && sv > 0) mergedSecs[name] = (mergedSecs[name] ?? 0) + sv;
  }
  /* 탱크처럼 영문명 둘이 한국어 하나로 합쳐지는 이름은 시간도 함께 더해진다 — 한 판에서
     시즈/언시즈가 둘 다 나오면 그 판 길이가 두 번 들어가 값이 실제보다 낮게 나온다. 이름이
     갈리는 것은 탱크뿐이고 보수적으로 잡히는 쪽이라 그대로 둔다.
     순위는 10분당 값이 아니라 총합으로 매긴다 — 한 판에만 잠깐 쓴 것이 10분당으로는 커 보여
     상위로 올라오면 "많이 뽑은 다섯"이라는 목록의 뜻이 어긋난다. */
  return Object.entries(merged)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([name, count]) => ({
      name,
      per10: mergedSecs[name] > 0 ? (count / mergedSecs[name]) * PER_WINDOW_SECONDS : null,
    }));
}

/** 10분(초) — 경기당 총합을 이 길이로 환산한다(서버의 PER_WINDOW_SECONDS와 같은 값). */
export const PER_WINDOW_SECONDS = 600;

/** 목록 한 줄 — 이름과 10분당 값. 길이를 모르면(옛 응답) null이라 화면이 그 줄의 수를 뺀다. */
export interface TopEntry { name: string; per10: number | null }

/** 커맨드 스트림에서 모은 재료(signals)로 그 경기의 구성을 낸다. 재료가 없으면 null. */
export function buildMixOf(s: ReplayPlayerSignals | null | undefined): BuildMix | null {
  if (!s) return null;
  const out = emptyBuildMix();
  for (const [b, n] of Object.entries(s.buildingCounts)) {
    if (DEFENSE_BUILDINGS.has(b)) out.bDef += n; else out.bProd += n;
    if (BUILDING_KO[b] && !SUPPLY_BUILDINGS.has(b)) out.buildings[b] = (out.buildings[b] ?? 0) + n;
  }
  for (const [line, names] of Object.entries(UP_LINES) as [keyof typeof UP_LINES, UpgradeName[]][]) {
    out[line] = Math.max(...names.map((u) => upgradeLevel(s, u)));
  }
  for (const [u, n] of Object.entries(s.unitCounts)) {
    if (NOT_ARMY.has(u)) continue;
    if (CASTER_UNITS.has(u)) out.uCaster += n;
    else if (BASIC_UNITS.has(u)) out.uBasic += n;
    else out.uAdv += n;
    if (AIR_UNITS.has(u)) out.uAir += n; else out.uGround += n;
    if (UNIT_KO[u]) out.units[u] = (out.units[u] ?? 0) + n;
  }
  for (const [t, n] of Object.entries(s.techUses)) {
    if (TECH_KO[t] && n > 0) out.skills[t] = (out.skills[t] ?? 0) + n;
  }
  const early = WORKER_EARLY_SEC / SECONDS_PER_FRAME;
  for (const u of WORKER_UNITS) {
    out.worker5 += (s.unitFrames[u] ?? []).filter((f) => f <= early).length;
  }
  return out;
}
