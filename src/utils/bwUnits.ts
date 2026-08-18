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
