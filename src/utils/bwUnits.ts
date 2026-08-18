/* 원작 유닛 자료표 — 기획서 `docs/plan-sim-core-v4.md`의 시뮬 코어가 먹을 표의 첫 조각.
 *
 * 여기에 두는 이유(요청: 완성도를 숫자로 재자): 계측기(simMetrics)와 앞으로의 시뮬이
 * 같은 표를 봐야 숫자가 뜻을 갖는다. 지금은 걸음 속도만 옮겼다 — ReplayMotionPlayer의
 * 같은 표는 아직 살아 있고, 기획서 P2(전투)에서 무기·크기·방어력 표를 여기 채우면서
 * 한 벌로 합친다. 그때까지는 이 파일이 '데이터만 있는 곳'이라는 자리만 잡아 둔다.
 *
 * 이 파일은 어떤 것도 import하지 않는다 — 노드 CLI(scripts/sim-metrics.mjs)가 리액트
 * 없이 그대로 번들해 쓸 수 있어야 한다. */

/** 걸음 속도(타일/초) — 업그레이드 없는 값. 표에 없으면 DEFAULT_SPEED. */
export const UNIT_SPEED: Record<string, number> = {
  Marine: 3.0, Firebat: 3.0, Medic: 3.0, Ghost: 3.0, SCV: 3.7,
  Vulture: 4.8, Goliath: 3.5, "Siege Tank (Tank Mode)": 3.5, "Siege Tank": 3.5,
  Wraith: 5.0, Dropship: 4.1, "Science Vessel": 3.7, Battlecruiser: 1.9, Valkyrie: 4.9,
  Zealot: 3.0, Dragoon: 3.7, "High Templar": 2.4, "Dark Templar": 3.7, Archon: 3.7,
  Reaver: 1.3, Probe: 3.7, Shuttle: 3.3, Observer: 2.5, Scout: 5.0, Corsair: 5.0,
  Carrier: 2.5, Arbiter: 3.7,
  Zergling: 4.1, Hydralisk: 2.7, Lurker: 4.3, Ultralisk: 3.8, Defiler: 3.0,
  Drone: 3.7, Overlord: 0.6, Mutalisk: 5.0, Scourge: 5.0, Queen: 5.0, Guardian: 1.9,
  Devourer: 3.7, "Infested Terran": 4.0,
};

/** 정체를 모르는 개체의 걸음 — 보병 언저리. */
export const DEFAULT_SPEED = 3.2;

/** 속업이 붙는 유닛과 그 업그레이드 이름 — 붙으면 속도가 대략 1.5배다. */
export const SPEED_UP_OF: Record<string, string> = {
  Zergling: "Metabolic Boost", Hydralisk: "Muscular Augments", Ultralisk: "Anabolic Synthesis",
  Overlord: "Pneumatized Carapace", Vulture: "Ion Thrusters", Zealot: "Leg Enhancements",
  Shuttle: "Gravitic Drive", Observer: "Gravitic Boosters", Scout: "Gravitic Thrusters",
};

/** 속업 배수 — 원작은 유닛마다 조금씩 다르지만 화면에서 가르는 값은 아니다. */
export const SPEED_UP_MULT = 1.5;

/** 그 유닛의 걸음(타일/초) — 속업 목록을 주면 반영한다. */
export function speedOfUnit(unit: string, ups?: Set<string> | string[]): number {
  const base = UNIT_SPEED[unit] ?? DEFAULT_SPEED;
  const up = SPEED_UP_OF[unit];
  if (!up || !ups) return base;
  const has = Array.isArray(ups) ? ups.includes(up) : ups.has(up);
  return has ? base * SPEED_UP_MULT : base;
}

/** 공중 유닛 — 지형을 무시하고 곧게 난다. 오버로드는 통계 집합에 없어 따로 더한다. */
export const AIR_UNIT_SET = new Set([
  "Wraith", "Dropship", "Science Vessel", "Valkyrie", "Battlecruiser",
  "Shuttle", "Observer", "Scout", "Corsair", "Carrier", "Arbiter",
  "Mutalisk", "Guardian", "Devourer", "Scourge", "Queen", "Overlord",
]);

export const isAir = (unit: string): boolean => AIR_UNIT_SET.has(unit);

/** 회전 속도(도/초) — 원작 유닛은 몸을 돌리고 나서 간다. 이 값 하나가 "스프라이트가
 *  미끄러진다"는 인상을 없앤다. 표에 없으면 기본값. 정밀한 값은 P2에서 대조한다. */
export const TURN_RATE: Record<string, number> = {
  "Siege Tank": 200, "Siege Tank (Tank Mode)": 200, Goliath: 240, Dragoon: 240,
  Reaver: 160, Carrier: 130, Battlecruiser: 130, Guardian: 160, Ultralisk: 240,
  Lurker: 240, Arbiter: 200, "Science Vessel": 200, Overlord: 130,
};
export const DEFAULT_TURN_RATE = 380;

/* ── 전투 자료표(기획서 P2) ───────────────────────────────────────────────────
 *
 * ⚠ 이 표의 숫자는 아직 **대조 전**이다. 구조를 먼저 세우려고 기억으로 채웠으므로,
 *   P2를 끝냈다고 말하기 전에 반드시 원 자료(BWAPI의 UnitType/WeaponType 덤프 등)로
 *   한 줄씩 대조해야 한다. 기획서 7절에 적어 둔 그 항목이다.
 *
 * 피해 셈: 실피해 = max(0.5, 피해량 × 종류배수(공격종류, 표적크기) − 방어력).
 * 실드가 남아 있으면 실드부터 깎는다(실드는 종류배수를 안 받는다 — 이것도 대조 대상). */

export type DmgType = "normal" | "concussive" | "explosive";
export type UnitSize = "small" | "medium" | "large";

/** 무기 하나 — cd는 초(원작 프레임 ÷ 23.81), range·splash는 타일. */
export type Weapon = {
  dmg: number; type: DmgType; range: number; cd: number; splash?: number;
};

/** 종류배수 — 공격 종류 × 표적 크기. 건물은 large로 친다. */
export const DMG_MULT: Record<DmgType, Record<UnitSize, number>> = {
  normal: { small: 1, medium: 1, large: 1 },
  concussive: { small: 1, medium: 0.5, large: 0.25 },
  explosive: { small: 0.5, medium: 0.75, large: 1 },
};

export const UNIT_SIZE: Record<string, UnitSize> = {
  Marine: "small", Firebat: "small", Medic: "small", Ghost: "small", SCV: "small",
  Vulture: "medium", Goliath: "large", "Siege Tank": "large",
  "Siege Tank (Tank Mode)": "large", "Siege Tank (Siege Mode)": "large",
  Wraith: "large", Dropship: "large", "Science Vessel": "large",
  Battlecruiser: "large", Valkyrie: "large",
  Probe: "small", Zealot: "small", Dragoon: "large", "High Templar": "small",
  "Dark Templar": "small", Archon: "large", "Dark Archon": "large", Reaver: "large",
  Shuttle: "large", Observer: "small", Scout: "large", Corsair: "medium",
  Carrier: "large", Arbiter: "large",
  Drone: "small", Zergling: "small", Hydralisk: "medium", Lurker: "large",
  Ultralisk: "large", Defiler: "medium", Overlord: "large", Mutalisk: "small",
  Scourge: "small", Queen: "medium", Guardian: "large", Devourer: "large",
  "Infested Terran": "small", Broodling: "small",
};

export const UNIT_ARMOR: Record<string, number> = {
  Firebat: 1, Medic: 1, Goliath: 1, "Siege Tank": 1, "Siege Tank (Tank Mode)": 1,
  "Siege Tank (Siege Mode)": 1, Dropship: 1, "Science Vessel": 1,
  Battlecruiser: 3, Valkyrie: 2,
  Zealot: 1, Dragoon: 1, "Dark Templar": 1, Shuttle: 1, Corsair: 1, Carrier: 4, Arbiter: 1,
  Lurker: 1, Ultralisk: 1, Defiler: 1, Guardian: 2, Devourer: 2,
};

/** 지상 무기 — 없으면 지상을 못 친다. */
export const WEAPON_GROUND: Record<string, Weapon> = {
  Marine: { dmg: 6, type: "normal", range: 4, cd: 0.63 },
  Firebat: { dmg: 16, type: "concussive", range: 2, cd: 0.92, splash: 0.7 },
  Ghost: { dmg: 10, type: "normal", range: 7, cd: 0.92 },
  SCV: { dmg: 5, type: "normal", range: 1, cd: 0.63 },
  Vulture: { dmg: 20, type: "concussive", range: 5, cd: 1.26 },
  Goliath: { dmg: 12, type: "normal", range: 6, cd: 0.92 },
  "Siege Tank": { dmg: 30, type: "explosive", range: 7, cd: 1.55 },
  "Siege Tank (Tank Mode)": { dmg: 30, type: "explosive", range: 7, cd: 1.55 },
  "Siege Tank (Siege Mode)": { dmg: 70, type: "explosive", range: 12, cd: 3.15, splash: 1.5 },
  Wraith: { dmg: 8, type: "normal", range: 5, cd: 1.26 },
  Battlecruiser: { dmg: 25, type: "normal", range: 6, cd: 1.26 },
  Probe: { dmg: 5, type: "normal", range: 1, cd: 0.92 },
  Zealot: { dmg: 16, type: "normal", range: 1, cd: 0.92 },
  Dragoon: { dmg: 20, type: "explosive", range: 4, cd: 1.26 },
  "Dark Templar": { dmg: 40, type: "normal", range: 1, cd: 1.26 },
  Archon: { dmg: 30, type: "normal", range: 2, cd: 0.84, splash: 0.8 },
  Reaver: { dmg: 100, type: "normal", range: 8, cd: 2.5, splash: 1.2 },
  Scout: { dmg: 8, type: "normal", range: 4, cd: 1.26 },
  Carrier: { dmg: 18, type: "normal", range: 8, cd: 1.5 },
  Arbiter: { dmg: 10, type: "explosive", range: 5, cd: 1.89 },
  Drone: { dmg: 5, type: "normal", range: 1, cd: 0.92 },
  Zergling: { dmg: 5, type: "normal", range: 1, cd: 0.34 },
  Hydralisk: { dmg: 10, type: "explosive", range: 4, cd: 0.63 },
  Lurker: { dmg: 20, type: "normal", range: 6, cd: 1.55, splash: 1.2 },
  Ultralisk: { dmg: 20, type: "normal", range: 1, cd: 0.63 },
  Mutalisk: { dmg: 9, type: "normal", range: 3, cd: 1.26 },
  Guardian: { dmg: 20, type: "normal", range: 8, cd: 1.26 },
  "Infested Terran": { dmg: 500, type: "explosive", range: 1, cd: 1, splash: 2 },
  Broodling: { dmg: 4, type: "normal", range: 1, cd: 0.63 },
  // 방어 건물
  "Sunken Colony": { dmg: 40, type: "explosive", range: 7, cd: 1.34 },
  "Photon Cannon": { dmg: 20, type: "normal", range: 7, cd: 0.92 },
  Bunker: { dmg: 6, type: "normal", range: 6, cd: 0.63 },
};

/** 대공 무기 — 없으면 공중을 못 친다. */
export const WEAPON_AIR: Record<string, Weapon> = {
  Marine: { dmg: 6, type: "normal", range: 4, cd: 0.63 },
  Ghost: { dmg: 10, type: "normal", range: 7, cd: 0.92 },
  Goliath: { dmg: 20, type: "explosive", range: 5, cd: 0.92 },
  Wraith: { dmg: 20, type: "explosive", range: 5, cd: 0.92 },
  Battlecruiser: { dmg: 25, type: "normal", range: 6, cd: 1.26 },
  Valkyrie: { dmg: 48, type: "explosive", range: 6, cd: 2.52, splash: 0.6 },
  Dragoon: { dmg: 20, type: "explosive", range: 4, cd: 1.26 },
  Archon: { dmg: 30, type: "normal", range: 2, cd: 0.84, splash: 0.8 },
  Scout: { dmg: 28, type: "explosive", range: 4, cd: 0.92 },
  Corsair: { dmg: 5, type: "explosive", range: 5, cd: 0.34, splash: 0.6 },
  Carrier: { dmg: 18, type: "normal", range: 8, cd: 1.5 },
  Hydralisk: { dmg: 10, type: "explosive", range: 4, cd: 0.63 },
  Mutalisk: { dmg: 9, type: "normal", range: 3, cd: 1.26 },
  Scourge: { dmg: 110, type: "normal", range: 1, cd: 1 },
  Devourer: { dmg: 25, type: "explosive", range: 6, cd: 4.2 },
  "Missile Turret": { dmg: 20, type: "explosive", range: 7, cd: 0.63 },
  "Spore Colony": { dmg: 15, type: "normal", range: 7, cd: 0.63 },
  "Photon Cannon": { dmg: 20, type: "normal", range: 7, cd: 0.92 },
};

/** 실피해 — 실드가 남아 있으면 종류배수·방어력 없이 실드부터 깎는다(대조 대상). */
export function damageOf(w: Weapon, size: UnitSize, armor: number, onShield: boolean): number {
  if (onShield) return Math.max(0.5, w.dmg);
  return Math.max(0.5, w.dmg * DMG_MULT[w.type][size] - armor);
}
