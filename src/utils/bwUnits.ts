/* 원작 유닛·전투 자료표 — OpenBW(bwgame.h)와 BWAPI 원시 배열에서 **생성**한 것.
 *
 * 왜 다시 썼나: 여기 있던 앞 판은 파일 머리에 "이 표의 숫자는 아직 대조 전"이라고 스스로
 * 적어 둔 기억산 표였다. 그래서 셈 자체가 틀려 있었다 — 옛 damageOf는
 * `피해 × 크기배수 − 방어력`이었는데 원작은 `(피해 − 방어력) × 크기배수`다. 순서가
 * 뒤집혀 있으면 히드라(10 폭발)가 질럿(방1)에게 4.0을 넣는다. 실제 값은 4.5다.
 * 한 방 0.5씩 어긋나면 타수가 달라지고, 타수가 달라지면 누가 죽는지가 달라진다.
 *
 * 이 파일의 표는 손으로 옮겨 적지 않았다. 아래 원시 배열을 파싱해 기계로 뽑았다:
 *   · BWAPI BWAPILIB/Source/UnitType.cpp  — 체력·실드·방어·크기·무기·타격수·획득·시야,
 *                                            unitDimensions(발자국·스프라이트 상자),
 *                                            unitFlags(비행·유기물·기계·버로우·탐지)
 *   · BWAPI BWAPILIB/Source/WeaponType.cpp — 피해·업글 증가·damageFactor·종류·쿨다운·
 *                                            사거리·최소사거리·스플래시 3링·폭발 갈래
 *   · BWAPI BWAPILIB/Source/UpgradeType.cpp— 연구 시간·비용·최대 레벨
 *   · OpenBW bwgame.h                       — 셈의 순서(weapon_deal_damage 등)
 *
 * 표식 규약:
 *   [DAT] 원시 배열에서 그대로 뽑은 값. 사람 손이 안 닿았다.
 *   [OBW] bwgame.h 함수를 읽고 옮긴 규칙.
 *   [추정] 출처에서 못 읽었다. 근거를 옆에 적었다 — 지어낸 값이 아니라 어림이다.
 *
 * 이 파일은 어떤 것도 import하지 않는다 — 노드 CLI(scripts/sim-metrics.mjs)와 웹 워커가
 * 리액트 없이 그대로 번들해 쓴다. */

/* ════════════════════════════════════════════════════════════════════════════
   1. 시계와 고정소수(fp8)

   원작의 체력·실드·피해는 전부 1/256 단위 정수다. 0.5 / 4.5 / 17.5 / 1.75 같은 값이
   실제로 남아 돌아다니므로, 중간에 반올림하면 타수가 통째로 달라진다. 그래서 셈은
   raw 정수로 하고 사람이 볼 때만 나눈다. [OBW] util.h fp8
   ════════════════════════════════════════════════════════════════════════════ */

/** 원작 한 프레임의 길이(초) — 빠른 속도 23.81 FPS. */
export const FRAME_SEC = 1 / 23.81;

/** 1.0의 raw 값. */
export const FP = 256;
/** 사람이 읽는 수 → fp8 raw. */
export const fp = (n: number): number => Math.round(n * FP);
/** fp8 raw → 사람이 읽는 수. */
export const unfp = (raw: number): number => raw / FP;
/** C++ 정수 나눗셈(0 방향 절삭) — `damage /= damage_divisor`. */
const truncDiv = (a: number, b: number): number => Math.trunc(a / b);
/** fp8 곱(-∞ 방향 내림) — `damage *= 128_fp8`. [OBW] util.h "rounds towards negative infinity" */
const fpMul = (raw: number, m256: number): number => Math.floor((raw * m256) / 256);

/* ════════════════════════════════════════════════════════════════════════════
   2. 크기 배수 — [OBW] weapon_deal_damage 의 switch(damage_type)
   ════════════════════════════════════════════════════════════════════════════ */

/** 무기 피해 종류. independent(= OpenBW damage_type_none)는 주문 전용이라 일반 피해
 *  경로로 들어오면 0이 된다 — 플레이그 300, 마엘스트롬 따위가 여기다. */
export type DmgType = "normal" | "concussive" | "explosive" | "ignoreArmor" | "independent";
/** 표적 크기. **모든 건물은 large다** — 폭발형이 건물에 100%, 진동형이 25%인 이유. */
export type UnitSize = "independent" | "small" | "medium" | "large";

const SIZE_IDX: Record<UnitSize, 0 | 1 | 2 | 3> =
  { independent: 0, small: 1, medium: 2, large: 3 };

/** [종류][크기] 배수, 단위 1/256. [OBW] weapon_deal_damage switch 그대로. */
export const SIZE_MUL_256: Record<DmgType, [number, number, number, number]> = {
  independent: [0, 0, 0, 0],
  explosive: [0, 128, 192, 256],
  concussive: [0, 256, 128, 64],
  normal: [256, 256, 256, 256],
  ignoreArmor: [256, 256, 256, 256],
};

/** 사람이 읽는 배수표 — 표시·검산용. 셈에는 SIZE_MUL_256을 쓴다. */
export const DMG_MULT: Record<DmgType, Record<UnitSize, number>> = {
  independent: { independent: 0, small: 0, medium: 0, large: 0 },
  explosive: { independent: 0, small: 0.5, medium: 0.75, large: 1 },
  concussive: { independent: 0, small: 1, medium: 0.5, large: 0.25 },
  normal: { independent: 1, small: 1, medium: 1, large: 1 },
  ignoreArmor: { independent: 1, small: 1, medium: 1, large: 1 },
};

/* ════════════════════════════════════════════════════════════════════════════
   3. 무기 표 — [DAT] WeaponType.cpp 원시 배열

   프레임·픽셀 원값을 표에 그대로 두고 초·타일은 파생 필드로 얹었다. "프레임 ÷ 23.81"을
   표에 미리 박아 두면 반올림 오차가 자료 쪽에 굳어 버린다.
   ════════════════════════════════════════════════════════════════════════════ */

/** 스플래시 갈래. lurker는 일반 스플래시 경로를 안 타는 특례다(감쇠 없는 풀데미지). */
export type SplashKind = "none" | "radial" | "enemy" | "air" | "lurker";

export type Weapon = {
  /** weapons.dat 이름 — 원전과 대조할 때 이 이름으로 찾는다. */
  id: string;
  /** 히트 1회의 기본 피해(정수). 화면 표기가 아니다 — 질럿 8은 두 번 때려 16이 된다. */
  dmg: number;
  /** 공업 1레벨당 증가(정수). 무기마다 다르다 — 일률 +10%는 원작에 없다. */
  bonus: number;
  type: DmgType;
  /** weapons.dat damage_factor. */
  damageFactor: number;
  /** units.dat max{Ground,Air}Hits — 이 무기를 드는 유닛의 값. */
  maxHits: number;
  /** 한 공격(쿨다운 1회분)의 히트 수 = maxHits × damageFactor.
   *  히트마다 방어력·크기배수·하한이 따로 걸린다. **절대 합산하지 마라** —
   *  질럿 8×2는 방1 표적에 14이지 15가 아니다. */
  hits: number;
  /** 쿨다운(프레임 원값). */
  cdFrames: number;
  /** 쿨다운(초) — cdFrames × FRAME_SEC. 옛 코드가 쓰던 이름이라 그대로 둔다. */
  cd: number;
  /** 사거리(픽셀 원값). */
  rangePx: number;
  /** 사거리(타일) = rangePx / 32.
   *  ⚠ 원작은 **스프라이트 상자 모서리 사이** 거리로 재고 이 코드는 중심 사이로 잰다.
   *  중심 기준으로 쓰려면 reachTiles()로 두 몸 반지름을 더해라. 그냥 쓰면 질럿(0.47)
   *  같은 근접 유닛은 서로 겹치기 전엔 절대 사거리 안에 못 든다. */
  range: number;
  /** 최소 사거리(픽셀) — 시즈 모드 64만 0이 아니다. */
  minRangePx: number;
  /** 최소 사거리(타일). */
  minRange: number;
  /** 스플래시 반경(픽셀) [inner, medium, outer]. */
  splashPx: [number, number, number];
  splashKind: SplashKind;
  /** 한 겹 원으로 뭉갠 스플래시 반경(타일) — 옛 코드가 쓰던 이름. 없으면 undefined.
   *  **중간 링(splashPx[1])을 쓴다.** 옛 모형은 이 원 안의 모두에게 감쇠 없는 풀데미지를
   *  주므로 바깥 링을 넣으면 커세어(100px)·시즈(40px) 스플래시가 원작보다 훨씬 세진다.
   *  원작이 피해를 반으로 꺾는 자리가 중간 링이니, 원 하나로 줄일 때는 그 반지름이 가장
   *  덜 틀린다. 3링을 제대로 돌리려면 splashDivisor()를 써라. */
  splash?: number;
  /** 공업 이름 — 없으면 null. */
  upgrade: string | null;
};

const mkW = (
  id: string, dmg: number, bonus: number, type: DmgType, damageFactor: number,
  maxHits: number, cdFrames: number, rangePx: number, minRangePx: number,
  splashPx: [number, number, number], splashKind: SplashKind, upgrade: string | null,
): Weapon => ({
  id, dmg, bonus, type, damageFactor, maxHits, hits: maxHits * damageFactor,
  cdFrames, cd: cdFrames * FRAME_SEC,
  rangePx, range: rangePx / 32,
  minRangePx, minRange: minRangePx / 32,
  splashPx, splashKind,
  splash: splashKind === "none" ? undefined : splashPx[1] / 32,
  upgrade,
});

/** 무기 원장 — 키는 weapons.dat 이름. [DAT] WeaponType.cpp 정적 배열 그대로. */
export const WEAPONS = {
  /* Marine */
  Gauss_Rifle: mkW("Gauss_Rifle", 6, 1, "normal", 1, 1, 15, 128, 0, [0, 0, 0], "none", "Terran Infantry Weapons"),
  /* Ghost */
  C_10_Canister_Rifle: mkW("C_10_Canister_Rifle", 10, 1, "concussive", 1, 1, 22, 224, 0, [0, 0, 0], "none", "Terran Infantry Weapons"),
  /* Vulture */
  Fragmentation_Grenade: mkW("Fragmentation_Grenade", 20, 2, "concussive", 1, 1, 30, 160, 0, [0, 0, 0], "none", "Terran Vehicle Weapons"),
  /* Spider Mine */
  Spider_Mines: mkW("Spider_Mines", 125, 0, "explosive", 1, 1, 22, 10, 0, [50, 75, 100], "radial", null),
  /* Goliath */
  Twin_Autocannons: mkW("Twin_Autocannons", 12, 1, "normal", 1, 1, 22, 192, 0, [0, 0, 0], "none", "Terran Vehicle Weapons"),
  /* Goliath */
  Hellfire_Missile_Pack: mkW("Hellfire_Missile_Pack", 10, 2, "explosive", 2, 1, 22, 160, 0, [0, 0, 0], "none", "Terran Vehicle Weapons"),
  /* Siege Tank (Tank Mode) */
  Arclite_Cannon: mkW("Arclite_Cannon", 30, 3, "explosive", 1, 1, 37, 224, 0, [0, 0, 0], "none", "Terran Vehicle Weapons"),
  /* SCV */
  Fusion_Cutter: mkW("Fusion_Cutter", 5, 1, "normal", 1, 1, 15, 10, 0, [0, 0, 0], "none", null),
  /* Wraith */
  Gemini_Missiles: mkW("Gemini_Missiles", 20, 2, "explosive", 1, 1, 22, 160, 0, [0, 0, 0], "none", "Terran Ship Weapons"),
  /* Wraith */
  Burst_Lasers: mkW("Burst_Lasers", 8, 1, "normal", 1, 1, 30, 160, 0, [0, 0, 0], "none", "Terran Ship Weapons"),
  /* Battlecruiser */
  ATS_Laser_Battery: mkW("ATS_Laser_Battery", 25, 3, "normal", 1, 1, 30, 192, 0, [0, 0, 0], "none", "Terran Ship Weapons"),
  /* Battlecruiser */
  ATA_Laser_Battery: mkW("ATA_Laser_Battery", 25, 3, "normal", 1, 1, 30, 192, 0, [0, 0, 0], "none", "Terran Ship Weapons"),
  /* Firebat */
  Flame_Thrower: mkW("Flame_Thrower", 8, 1, "concussive", 1, 3, 22, 32, 0, [15, 20, 25], "enemy", "Terran Infantry Weapons"),
  /* Siege Tank (Siege Mode) */
  Arclite_Shock_Cannon: mkW("Arclite_Shock_Cannon", 70, 5, "explosive", 1, 1, 75, 384, 64, [10, 25, 40], "radial", "Terran Vehicle Weapons"),
  /* Missile Turret */
  Longbolt_Missile: mkW("Longbolt_Missile", 20, 0, "explosive", 1, 1, 15, 224, 0, [0, 0, 0], "none", null),
  /* 주문 전용 */
  Yamato_Gun: mkW("Yamato_Gun", 260, 0, "explosive", 1, 1, 15, 320, 0, [0, 0, 0], "none", null),
  /* 주문 전용 */
  Nuclear_Strike: mkW("Nuclear_Strike", 600, 0, "explosive", 1, 1, 1, 3, 0, [128, 192, 256], "radial", null),
  /* 주문 전용 */
  Irradiate: mkW("Irradiate", 250, 0, "ignoreArmor", 1, 1, 75, 288, 0, [0, 0, 0], "none", null),
  /* Zergling */
  Claws: mkW("Claws", 5, 1, "normal", 1, 1, 8, 15, 0, [0, 0, 0], "none", "Zerg Melee Attacks"),
  /* Hydralisk */
  Needle_Spines: mkW("Needle_Spines", 10, 1, "explosive", 1, 1, 15, 128, 0, [0, 0, 0], "none", "Zerg Missile Attacks"),
  /* Ultralisk */
  Kaiser_Blades: mkW("Kaiser_Blades", 20, 3, "normal", 1, 1, 15, 25, 0, [0, 0, 0], "none", "Zerg Melee Attacks"),
  /* Broodling */
  Toxic_Spores: mkW("Toxic_Spores", 4, 1, "normal", 1, 1, 15, 2, 0, [0, 0, 0], "none", "Zerg Melee Attacks"),
  /* Drone */
  Spines: mkW("Spines", 5, 0, "normal", 1, 1, 22, 32, 0, [0, 0, 0], "none", null),
  /* Guardian */
  Acid_Spore: mkW("Acid_Spore", 20, 2, "normal", 1, 1, 30, 256, 0, [0, 0, 0], "none", "Zerg Flyer Attacks"),
  /* Mutalisk */
  Glave_Wurm: mkW("Glave_Wurm", 9, 1, "normal", 1, 1, 30, 96, 0, [0, 0, 0], "none", "Zerg Flyer Attacks"),
  /* Spore Colony */
  Seeker_Spores: mkW("Seeker_Spores", 15, 0, "normal", 1, 1, 15, 224, 0, [0, 0, 0], "none", null),
  /* Sunken Colony */
  Subterranean_Tentacle: mkW("Subterranean_Tentacle", 40, 0, "explosive", 1, 1, 32, 224, 0, [0, 0, 0], "none", null),
  /* Infested Terran */
  Suicide_Infested_Terran: mkW("Suicide_Infested_Terran", 500, 0, "explosive", 1, 1, 1, 3, 0, [20, 40, 60], "radial", null),
  /* Scourge */
  Suicide_Scourge: mkW("Suicide_Scourge", 110, 0, "normal", 1, 1, 1, 3, 0, [0, 0, 0], "none", null),
  /* 주문 전용 */
  Plague: mkW("Plague", 300, 0, "independent", 1, 1, 1, 288, 0, [0, 0, 0], "none", null),
  /* Probe */
  Particle_Beam: mkW("Particle_Beam", 5, 0, "normal", 1, 1, 22, 32, 0, [0, 0, 0], "none", null),
  /* Zealot */
  Psi_Blades: mkW("Psi_Blades", 8, 1, "normal", 1, 2, 22, 15, 0, [0, 0, 0], "none", "Protoss Ground Weapons"),
  /* Dragoon */
  Phase_Disruptor: mkW("Phase_Disruptor", 20, 2, "explosive", 1, 1, 30, 128, 0, [0, 0, 0], "none", "Protoss Ground Weapons"),
  /* Archon */
  Psionic_Shockwave: mkW("Psionic_Shockwave", 30, 3, "normal", 1, 1, 20, 64, 0, [3, 15, 30], "enemy", "Protoss Ground Weapons"),
  /* Scout */
  Dual_Photon_Blasters: mkW("Dual_Photon_Blasters", 8, 1, "normal", 1, 1, 30, 128, 0, [0, 0, 0], "none", "Protoss Air Weapons"),
  /* Scout */
  Anti_Matter_Missiles: mkW("Anti_Matter_Missiles", 14, 1, "explosive", 2, 1, 22, 128, 0, [0, 0, 0], "none", "Protoss Air Weapons"),
  /* Arbiter */
  Phase_Disruptor_Cannon: mkW("Phase_Disruptor_Cannon", 10, 1, "explosive", 1, 1, 45, 160, 0, [0, 0, 0], "none", "Protoss Air Weapons"),
  /* Interceptor */
  Pulse_Cannon: mkW("Pulse_Cannon", 6, 1, "normal", 1, 1, 1, 128, 0, [0, 0, 0], "none", "Protoss Air Weapons"),
  /* Photon Cannon */
  STS_Photon_Cannon: mkW("STS_Photon_Cannon", 20, 0, "normal", 1, 1, 22, 224, 0, [0, 0, 0], "none", null),
  /* Photon Cannon */
  STA_Photon_Cannon: mkW("STA_Photon_Cannon", 20, 0, "normal", 1, 1, 22, 224, 0, [0, 0, 0], "none", null),
  /* Scarab */
  Scarab: mkW("Scarab", 100, 25, "normal", 1, 1, 1, 128, 0, [20, 40, 60], "enemy", "Scarab Damage"),
  /* 주문 전용 */
  Psionic_Storm: mkW("Psionic_Storm", 14, 1, "ignoreArmor", 1, 1, 45, 288, 0, [48, 48, 48], "radial", null),
  /* Corsair */
  Neutron_Flare: mkW("Neutron_Flare", 5, 1, "explosive", 1, 1, 8, 160, 0, [5, 50, 100], "air", "Protoss Air Weapons"),
  /* Valkyrie */
  Halo_Rockets: mkW("Halo_Rockets", 6, 1, "explosive", 2, 4, 64, 192, 0, [5, 50, 100], "air", "Terran Ship Weapons"),
  /* Devourer */
  Corrosive_Acid: mkW("Corrosive_Acid", 25, 2, "explosive", 1, 1, 100, 192, 0, [0, 0, 0], "none", "Zerg Flyer Attacks"),
  /* Lurker */
  Subterranean_Spines: mkW("Subterranean_Spines", 20, 2, "normal", 1, 1, 37, 192, 0, [20, 20, 20], "lurker", "Zerg Missile Attacks"),
  /* Dark Templar */
  Warp_Blades: mkW("Warp_Blades", 40, 3, "normal", 1, 1, 30, 15, 0, [0, 0, 0], "none", "Protoss Ground Weapons"),
} satisfies Record<string, Weapon>;

export type WeaponKey = keyof typeof WEAPONS;

/** 파이어뱃이 한 표적에 실제로 꽂는 발 수 — 단일 표적 근사에서만 쓴다.
 *  [추정] units.dat maxGroundHits는 3인데 세 발의 화염 오프셋이 서로 달라 한 표적은 보통
 *  두 발을 맞는다(그래서 게임 UI가 16으로 표기한다). 오프셋은 iscript.bin 자료라 못 읽었다.
 *  공간 스플래시를 제대로 도는 쪽이라면 WEAPONS.Flame_Thrower.hits(3)를 그대로 써라. */
export const FIREBAT_HITS_ON_ONE_TARGET = 2;

/* ════════════════════════════════════════════════════════════════════════════
   4. 유닛 표 — [DAT] UnitType.cpp 원시 배열
   ════════════════════════════════════════════════════════════════════════════ */

export type UnitCombat = {
  hp: number;
  shield: number;
  /** 기본 방어력(업그레이드 전 정수). */
  armor: number;
  size: UnitSize;
  /** 방어 업그레이드 이름 — 없으면 null. **건물은 전부 null이다.** */
  armorUp: string | null;
  ground: WeaponKey | null;
  air: WeaponKey | null;
  /** 지상 표적 타격수(units.dat maxGroundHits). */
  groundHits: number;
  /** 공중 표적 타격수(units.dat maxAirHits). */
  airHits: number;
  /** units.dat target_acquisition_range(타일) **원값**.
   *  ⚠ 그대로 쓰지 마라 — 게임이 뜰 때 무기 사거리로 한 번 올려 잡는다. acquireTiles()를 거쳐라. */
  seek: number;
  /** 시야(타일). */
  sight: number;
  /** 발자국(타일) [폭, 높이] — 건물만 뜻이 있다. */
  tile: [number, number];
  /** 스프라이트 상자(픽셀) [left, up, right, down] — 원작의 거리 판정 기준이다. */
  box: [number, number, number, number];
  building: boolean;
  flyer: boolean;
  /** 유기물 — 메딕 힐·이레디에이트 대상. */
  organic: boolean;
  /** 기계 — SCV 수리 대상(테란 + 기계 + 완성). */
  mech: boolean;
  burrowable: boolean;
  detector: boolean;
  worker: boolean;
};

/* 플래그는 unitFlags 비트를 그대로 옮긴 것이다. 표가 길어 한 자리에 눌러 담았다. */
const F_BUILDING = 1, F_FLYER = 2, F_ORGANIC = 4, F_MECH = 8;
const F_BURROW = 16, F_DETECTOR = 32, F_WORKER = 64;

const mkU = (
  hp: number, shield: number, armor: number, size: UnitSize, armorUp: string | null,
  ground: WeaponKey | null, air: WeaponKey | null, groundHits: number, airHits: number,
  seek: number, sight: number, tile: [number, number],
  box: [number, number, number, number], flags: number,
): UnitCombat => ({
  hp, shield, armor, size, armorUp, ground, air, groundHits, airHits, seek, sight, tile, box,
  building: (flags & F_BUILDING) !== 0,
  flyer: (flags & F_FLYER) !== 0,
  organic: (flags & F_ORGANIC) !== 0,
  mech: (flags & F_MECH) !== 0,
  burrowable: (flags & F_BURROW) !== 0,
  detector: (flags & F_DETECTOR) !== 0,
  worker: (flags & F_WORKER) !== 0,
});

/** 유닛 원장 — 키는 이 프로젝트가 쓰는 표기(screp 이름). [DAT] UnitType.cpp. */
export const UNITS: Record<string, UnitCombat> = {
  /* ── Terran ── */
  Marine: mkU(40, 0, 0, "small", "Terran Infantry Armor", "Gauss_Rifle", "Gauss_Rifle", 1, 1, 0, 7, [1, 1], [8, 9, 8, 10], 4),
  Ghost: mkU(45, 0, 0, "small", "Terran Infantry Armor", "C_10_Canister_Rifle", "C_10_Canister_Rifle", 1, 1, 0, 9, [1, 1], [7, 10, 7, 11], 4),
  Vulture: mkU(80, 0, 0, "medium", "Terran Vehicle Plating", "Fragmentation_Grenade", null, 1, 0, 0, 8, [1, 1], [16, 16, 15, 15], 8),
  Goliath: mkU(125, 0, 1, "large", "Terran Vehicle Plating", "Twin_Autocannons", "Hellfire_Missile_Pack", 1, 1, 5, 8, [1, 1], [16, 16, 15, 15], 8),
  "Siege Tank (Tank Mode)": mkU(150, 0, 1, "large", "Terran Vehicle Plating", "Arclite_Cannon", null, 1, 0, 8, 10, [1, 1], [16, 16, 15, 15], 8),
  "Siege Tank": mkU(150, 0, 1, "large", "Terran Vehicle Plating", "Arclite_Cannon", null, 1, 0, 8, 10, [1, 1], [16, 16, 15, 15], 8),  // 같은 유닛의 다른 표기
  SCV: mkU(60, 0, 0, "small", "Terran Infantry Armor", "Fusion_Cutter", null, 1, 0, 1, 7, [1, 1], [11, 11, 11, 11], 76),
  Wraith: mkU(120, 0, 0, "large", "Terran Ship Plating", "Burst_Lasers", "Gemini_Missiles", 1, 1, 0, 7, [1, 1], [19, 15, 18, 14], 10),
  "Science Vessel": mkU(200, 0, 1, "large", "Terran Ship Plating", null, null, 0, 0, 0, 10, [2, 2], [32, 33, 32, 16], 42),
  Dropship: mkU(150, 0, 1, "large", "Terran Ship Plating", null, null, 0, 0, 0, 8, [2, 2], [24, 16, 24, 20], 10),
  Battlecruiser: mkU(500, 0, 3, "large", "Terran Ship Plating", "ATS_Laser_Battery", "ATA_Laser_Battery", 1, 1, 0, 11, [2, 2], [37, 29, 37, 29], 10),
  "Spider Mine": mkU(20, 0, 0, "small", null, "Spider_Mines", null, 1, 0, 3, 3, [1, 1], [7, 7, 7, 7], 0),
  "Siege Tank (Siege Mode)": mkU(150, 0, 1, "large", "Terran Vehicle Plating", "Arclite_Shock_Cannon", null, 1, 0, 0, 10, [1, 1], [16, 16, 15, 15], 8),
  Firebat: mkU(50, 0, 1, "small", "Terran Infantry Armor", "Flame_Thrower", null, 3, 0, 3, 7, [1, 1], [11, 7, 11, 14], 4),
  Medic: mkU(60, 0, 1, "small", "Terran Infantry Armor", null, null, 0, 0, 9, 9, [1, 1], [8, 9, 8, 10], 4),
  Valkyrie: mkU(200, 0, 2, "large", "Terran Ship Plating", null, "Halo_Rockets", 0, 4, 0, 8, [2, 2], [24, 16, 24, 20], 10),
  /* ── Zerg ── */
  Larva: mkU(25, 0, 10, "small", "Zerg Carapace", null, null, 0, 0, 0, 4, [1, 1], [8, 8, 7, 7], 4),
  Egg: mkU(200, 0, 10, "medium", "Zerg Carapace", null, null, 0, 0, 0, 4, [1, 1], [16, 16, 15, 15], 4),
  Zergling: mkU(35, 0, 0, "small", "Zerg Carapace", "Claws", null, 1, 0, 3, 5, [1, 1], [8, 4, 7, 11], 20),
  Hydralisk: mkU(80, 0, 0, "medium", "Zerg Carapace", "Needle_Spines", "Needle_Spines", 1, 1, 0, 6, [1, 1], [10, 10, 10, 12], 20),
  Ultralisk: mkU(400, 0, 1, "large", "Zerg Carapace", "Kaiser_Blades", null, 1, 0, 3, 7, [2, 2], [19, 16, 18, 15], 4),
  Broodling: mkU(30, 0, 0, "small", "Zerg Carapace", "Toxic_Spores", null, 1, 0, 3, 5, [1, 1], [9, 9, 9, 9], 4),
  Drone: mkU(40, 0, 0, "small", "Zerg Carapace", "Spines", null, 1, 0, 0, 7, [1, 1], [11, 11, 11, 11], 84),
  Overlord: mkU(200, 0, 0, "large", "Zerg Flyer Carapace", null, null, 0, 0, 0, 9, [2, 2], [25, 25, 24, 24], 38),
  Mutalisk: mkU(120, 0, 0, "small", "Zerg Flyer Carapace", "Glave_Wurm", "Glave_Wurm", 1, 1, 3, 7, [2, 2], [22, 22, 21, 21], 6),
  Guardian: mkU(150, 0, 2, "large", "Zerg Flyer Carapace", "Acid_Spore", null, 1, 0, 0, 11, [2, 2], [22, 22, 21, 21], 6),
  Queen: mkU(120, 0, 0, "medium", "Zerg Flyer Carapace", null, null, 0, 0, 8, 10, [2, 2], [24, 24, 23, 23], 6),
  Defiler: mkU(80, 0, 1, "medium", "Zerg Carapace", null, null, 0, 0, 0, 10, [1, 1], [13, 12, 13, 12], 20),
  Scourge: mkU(25, 0, 0, "small", "Zerg Flyer Carapace", null, "Suicide_Scourge", 0, 1, 3, 5, [1, 1], [12, 12, 11, 11], 6),
  "Infested Terran": mkU(60, 0, 0, "small", "Zerg Carapace", "Suicide_Infested_Terran", null, 1, 0, 3, 5, [1, 1], [8, 9, 8, 10], 20),
  Cocoon: mkU(200, 0, 0, "large", "Zerg Carapace", null, null, 0, 0, 0, 4, [1, 1], [16, 16, 15, 15], 6),
  Devourer: mkU(250, 0, 2, "large", "Zerg Flyer Carapace", null, "Corrosive_Acid", 0, 1, 7, 10, [2, 2], [22, 22, 21, 21], 6),
  "Lurker Egg": mkU(200, 0, 10, "medium", "Zerg Carapace", null, null, 0, 0, 0, 4, [1, 1], [16, 16, 15, 15], 4),
  Lurker: mkU(125, 0, 1, "medium", "Zerg Carapace", "Subterranean_Spines", null, 1, 0, 6, 8, [1, 1], [15, 15, 16, 16], 20),
  /* ── Protoss ── */
  Corsair: mkU(100, 80, 1, "medium", "Protoss Air Armor", null, "Neutron_Flare", 0, 1, 9, 9, [1, 1], [18, 16, 17, 15], 10),
  "Dark Templar": mkU(80, 40, 1, "small", "Protoss Ground Armor", "Warp_Blades", null, 1, 0, 3, 7, [1, 1], [12, 6, 11, 19], 4),
  "Dark Archon": mkU(25, 200, 1, "large", "Protoss Ground Armor", null, null, 0, 0, 7, 10, [1, 1], [16, 16, 15, 15], 0),
  Probe: mkU(20, 20, 0, "small", "Protoss Ground Armor", "Particle_Beam", null, 1, 0, 0, 8, [1, 1], [11, 11, 11, 11], 72),
  Zealot: mkU(100, 60, 1, "small", "Protoss Ground Armor", "Psi_Blades", null, 2, 0, 3, 7, [1, 1], [11, 5, 11, 13], 4),
  Dragoon: mkU(100, 80, 1, "large", "Protoss Ground Armor", "Phase_Disruptor", "Phase_Disruptor", 1, 1, 0, 8, [1, 1], [15, 15, 16, 16], 8),
  "High Templar": mkU(40, 40, 0, "small", "Protoss Ground Armor", null, null, 0, 0, 3, 7, [1, 1], [12, 10, 11, 13], 4),
  Archon: mkU(10, 350, 0, "large", "Protoss Ground Armor", "Psionic_Shockwave", "Psionic_Shockwave", 1, 1, 3, 8, [1, 1], [16, 16, 15, 15], 0),
  Shuttle: mkU(80, 60, 1, "large", "Protoss Air Armor", null, null, 0, 0, 0, 8, [2, 1], [20, 16, 19, 15], 10),
  Scout: mkU(150, 100, 0, "large", "Protoss Air Armor", "Dual_Photon_Blasters", "Anti_Matter_Missiles", 1, 1, 0, 8, [2, 1], [18, 16, 17, 15], 10),
  Arbiter: mkU(200, 150, 1, "large", "Protoss Air Armor", "Phase_Disruptor_Cannon", "Phase_Disruptor_Cannon", 1, 1, 0, 9, [2, 2], [22, 22, 21, 21], 10),
  Carrier: mkU(300, 150, 4, "large", "Protoss Air Armor", null, null, 0, 0, 8, 11, [2, 2], [32, 32, 31, 31], 10),
  Interceptor: mkU(40, 40, 0, "small", "Protoss Air Armor", "Pulse_Cannon", "Pulse_Cannon", 1, 1, 0, 6, [1, 1], [8, 8, 7, 7], 10),
  Reaver: mkU(100, 80, 0, "large", "Protoss Ground Armor", null, null, 0, 0, 8, 10, [1, 1], [16, 16, 15, 15], 8),
  Observer: mkU(40, 20, 0, "small", "Protoss Air Armor", null, null, 0, 0, 0, 9, [1, 1], [16, 16, 15, 15], 42),
  Scarab: mkU(20, 10, 0, "small", "Protoss Ground Armor", "Scarab", null, 1, 0, 3, 5, [1, 1], [2, 2, 2, 2], 8),
  /* ── 건물 — Terran ── */
  "Command Center": mkU(1500, 0, 1, "large", null, null, null, 0, 0, 0, 10, [4, 3], [58, 41, 58, 41], 9),
  "Comsat Station": mkU(500, 0, 1, "large", null, null, null, 0, 0, 0, 10, [2, 2], [37, 16, 31, 25], 9),
  "Nuclear Silo": mkU(600, 0, 1, "large", null, null, null, 0, 0, 0, 8, [2, 2], [37, 16, 31, 25], 9),
  "Supply Depot": mkU(500, 0, 1, "large", null, null, null, 0, 0, 0, 8, [3, 2], [38, 22, 38, 26], 9),
  Refinery: mkU(750, 0, 1, "large", null, null, null, 0, 0, 0, 8, [4, 2], [56, 32, 56, 31], 9),
  Barracks: mkU(1000, 0, 1, "large", null, null, null, 0, 0, 0, 8, [4, 3], [48, 40, 56, 32], 9),
  Academy: mkU(600, 0, 1, "large", null, null, null, 0, 0, 0, 8, [3, 2], [40, 32, 44, 24], 9),
  Factory: mkU(1250, 0, 1, "large", null, null, null, 0, 0, 0, 8, [4, 3], [56, 40, 56, 40], 9),
  Starport: mkU(1300, 0, 1, "large", null, null, null, 0, 0, 0, 10, [4, 3], [48, 40, 48, 38], 9),
  "Control Tower": mkU(500, 0, 1, "large", null, null, null, 0, 0, 0, 8, [2, 2], [47, 24, 28, 22], 9),
  "Science Facility": mkU(850, 0, 1, "large", null, null, null, 0, 0, 0, 10, [4, 3], [48, 38, 48, 38], 9),
  "Covert Ops": mkU(750, 0, 1, "large", null, null, null, 0, 0, 0, 8, [2, 2], [47, 24, 28, 22], 9),
  "Physics Lab": mkU(600, 0, 1, "large", null, null, null, 0, 0, 0, 8, [2, 2], [47, 24, 28, 22], 9),
  "Machine Shop": mkU(750, 0, 1, "large", null, null, null, 0, 0, 0, 8, [2, 2], [39, 24, 31, 24], 9),
  "Engineering Bay": mkU(850, 0, 1, "large", null, null, null, 0, 0, 0, 8, [4, 3], [48, 32, 48, 28], 9),
  Armory: mkU(750, 0, 1, "large", null, null, null, 0, 0, 0, 8, [3, 2], [48, 32, 47, 22], 9),
  "Missile Turret": mkU(200, 0, 0, "large", null, null, "Longbolt_Missile", 0, 1, 0, 11, [2, 2], [16, 32, 16, 16], 41),
  Bunker: mkU(350, 0, 1, "large", null, null, null, 0, 0, 0, 10, [3, 2], [32, 24, 32, 16], 9),
  /* ── 건물 — Zerg ── */
  "Infested Command Center": mkU(1500, 0, 1, "large", null, null, null, 0, 0, 0, 10, [4, 3], [58, 41, 58, 41], 5),
  Hatchery: mkU(1250, 0, 1, "large", null, null, null, 0, 0, 0, 9, [4, 3], [49, 32, 49, 32], 5),
  Lair: mkU(1800, 0, 1, "large", null, null, null, 0, 0, 0, 10, [4, 3], [49, 32, 49, 32], 5),
  Hive: mkU(2500, 0, 1, "large", null, null, null, 0, 0, 0, 11, [4, 3], [49, 32, 49, 32], 5),
  "Nydus Canal": mkU(250, 0, 1, "large", null, null, null, 0, 0, 0, 8, [2, 2], [32, 32, 31, 31], 5),
  "Hydralisk Den": mkU(850, 0, 1, "large", null, null, null, 0, 0, 0, 8, [3, 2], [40, 32, 40, 24], 5),
  "Defiler Mound": mkU(850, 0, 1, "large", null, null, null, 0, 0, 0, 8, [4, 2], [48, 32, 48, 4], 5),
  "Greater Spire": mkU(1000, 0, 1, "large", null, null, null, 0, 0, 0, 8, [2, 2], [28, 32, 28, 24], 5),
  "Queen's Nest": mkU(850, 0, 1, "large", null, null, null, 0, 0, 0, 8, [3, 2], [38, 28, 32, 28], 5),
  "Queens Nest": mkU(850, 0, 1, "large", null, null, null, 0, 0, 0, 8, [3, 2], [38, 28, 32, 28], 5),  // 같은 유닛의 다른 표기
  "Evolution Chamber": mkU(750, 0, 1, "large", null, null, null, 0, 0, 0, 8, [3, 2], [44, 32, 32, 20], 5),
  "Ultralisk Cavern": mkU(600, 0, 1, "large", null, null, null, 0, 0, 0, 8, [3, 2], [40, 32, 32, 31], 5),
  Spire: mkU(600, 0, 1, "large", null, null, null, 0, 0, 0, 8, [2, 2], [28, 32, 28, 24], 5),
  "Spawning Pool": mkU(750, 0, 1, "large", null, null, null, 0, 0, 0, 8, [3, 2], [36, 28, 40, 18], 5),
  "Creep Colony": mkU(400, 0, 0, "large", null, null, null, 0, 0, 0, 10, [2, 2], [24, 24, 23, 23], 5),
  "Spore Colony": mkU(400, 0, 0, "large", null, null, "Seeker_Spores", 0, 1, 0, 10, [2, 2], [24, 24, 23, 23], 37),
  "Sunken Colony": mkU(300, 0, 2, "large", null, "Subterranean_Tentacle", null, 1, 0, 0, 10, [2, 2], [24, 24, 23, 23], 5),
  Extractor: mkU(750, 0, 1, "large", null, null, null, 0, 0, 0, 7, [4, 2], [64, 32, 63, 31], 5),
  /* ── 건물 — Protoss ── */
  Nexus: mkU(750, 750, 1, "large", null, null, null, 0, 0, 0, 11, [4, 3], [56, 39, 56, 39], 9),
  "Robotics Facility": mkU(500, 500, 1, "large", null, null, null, 0, 0, 0, 10, [3, 2], [36, 16, 40, 20], 9),
  Pylon: mkU(300, 300, 0, "large", null, null, null, 0, 0, 0, 8, [2, 2], [16, 12, 16, 20], 9),
  Assimilator: mkU(450, 450, 1, "large", null, null, null, 0, 0, 0, 10, [4, 2], [48, 32, 48, 24], 9),
  Observatory: mkU(250, 250, 1, "large", null, null, null, 0, 0, 0, 10, [3, 2], [44, 16, 44, 28], 9),
  Gateway: mkU(500, 500, 1, "large", null, null, null, 0, 0, 0, 10, [4, 3], [48, 32, 48, 40], 9),
  "Photon Cannon": mkU(100, 100, 0, "large", null, "STS_Photon_Cannon", "STA_Photon_Cannon", 1, 1, 0, 11, [2, 2], [20, 16, 20, 16], 41),
  "Citadel of Adun": mkU(450, 450, 1, "large", null, null, null, 0, 0, 0, 10, [3, 2], [24, 24, 40, 24], 9),
  "Cybernetics Core": mkU(500, 500, 1, "large", null, null, null, 0, 0, 0, 10, [3, 2], [40, 24, 40, 24], 9),
  "Templar Archives": mkU(500, 500, 1, "large", null, null, null, 0, 0, 0, 10, [3, 2], [32, 24, 32, 24], 9),
  Forge: mkU(550, 550, 1, "large", null, null, null, 0, 0, 0, 10, [3, 2], [36, 24, 36, 20], 9),
  Stargate: mkU(600, 600, 1, "large", null, null, null, 0, 0, 0, 10, [4, 3], [48, 40, 48, 32], 9),
  "Fleet Beacon": mkU(500, 500, 1, "large", null, null, null, 0, 0, 0, 10, [3, 2], [40, 32, 47, 24], 9),
  "Arbiter Tribunal": mkU(500, 500, 1, "large", null, null, null, 0, 0, 0, 10, [3, 2], [44, 28, 44, 28], 9),
  "Robotics Support Bay": mkU(450, 450, 1, "large", null, null, null, 0, 0, 0, 10, [3, 2], [32, 32, 32, 20], 9),
  "Shield Battery": mkU(200, 200, 1, "large", null, null, null, 0, 0, 0, 10, [3, 2], [32, 16, 32, 16], 9),
};

/** 표에 없는 정체 — 새 이름이 들어와도 시뮬이 안 죽게. [추정] */
export const DEFAULT_UNIT: UnitCombat =
  mkU(70, 0, 0, "medium", null, null, null, 1, 0, 0, 7, [1, 1], [16, 16, 15, 15], 0);
export const unitOf = (kind: string): UnitCombat => UNITS[kind] ?? DEFAULT_UNIT;

/** 공중 유닛 — [DAT] unitFlags의 Flyer 비트. 이름을 손으로 모으던 자리를 자료로 바꿨다.
 *  뜬 테란 건물은 여기 없다 — 그건 FlyingBuilding이라 상태에 따라 갈린다. */
export const AIR_UNIT_SET = new Set([
  "Wraith", "Science Vessel", "Dropship", "Battlecruiser", "Valkyrie",
  "Overlord", "Mutalisk", "Guardian", "Queen", "Scourge",
  "Cocoon", "Devourer", "Corsair", "Shuttle", "Scout",
  "Arbiter", "Carrier", "Interceptor", "Observer",
]);

export const isAir = (unit: string): boolean => AIR_UNIT_SET.has(unit);

/* ════════════════════════════════════════════════════════════════════════════
   5. 이동 — 여기만 원전 대조가 안 됐다.

   걸음 속도의 원값은 flingy.dat의 top_speed(fp8 픽셀/프레임)인데 BWAPI가 그 배열을
   안 내놓는다. 그래서 이 표는 화면에서 맞춘 어림 그대로 두고 [추정] 표식만 붙였다.
   숫자를 바꾸려면 flingy.dat을 먼저 구해야 한다.
   ════════════════════════════════════════════════════════════════════════════ */

/** 걸음 속도(타일/초) — 업그레이드 없는 값. [추정] */
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

/** 정체를 모르는 개체의 걸음 — 보병 언저리. [추정] */
export const DEFAULT_SPEED = 3.2;

/** 속업이 붙는 유닛과 그 업그레이드 이름. */
export const SPEED_UP_OF: Record<string, string> = {
  Zergling: "Metabolic Boost", Hydralisk: "Muscular Augments", Ultralisk: "Anabolic Synthesis",
  Overlord: "Pneumatized Carapace", Vulture: "Ion Thrusters", Zealot: "Leg Enhancements",
  Shuttle: "Gravitic Drive", Observer: "Gravitic Boosters", Scout: "Gravitic Thrusters",
};

/** 속업 배수 — [추정] 원작은 유닛마다 조금씩 다르다(저글링 ~1.6, 질럿 ~1.5, 벌처 ~1.4). */
export const SPEED_UP_MULT = 1.5;

/** 그 유닛의 걸음(타일/초) — 속업 목록을 주면 반영한다.
 *
 *  11절의 MOVE_DYN(flingy.dat 실덤프)을 **먼저** 본다. 위 UNIT_SPEED는 flingy.dat을
 *  못 구했을 때 화면에서 맞춘 어림이라 실제와 조금씩 어긋나 있었다 — 마린 3.0 대 2.976,
 *  히드라 2.7 대 2.723, 질럿 3.0 대 2.976, 드라군 3.7 대 3.72, 러커 4.3 대 6.496.
 *  러커는 속도 업그레이드 플래그가 늘 켜져 있어 어림이 3할 넘게 느렸다.
 *  속업도 마찬가지다 — SPEED_UP_MULT 1.5는 오버로드(실제 ×4.0)와 스카웃(×1.33)에서
 *  틀린다. MOVE_DYN에는 업그레이드된 실값이 들어 있으니 배수를 쓸 일이 없다.
 *  표에 없는 정체만 옛 UNIT_SPEED·SPEED_UP_MULT로 떨어진다. */
export function speedOfUnit(unit: string, ups?: Set<string> | string[]): number {
  const dyn = moveDynOf(unit, ups);
  if (dyn) return dyn.top;
  const base = UNIT_SPEED[unit] ?? DEFAULT_SPEED;
  const up = SPEED_UP_OF[unit];
  if (!up || !ups) return base;
  return upsHasUpgrade(ups, up) ? base * SPEED_UP_MULT : base;
}

/* ── 라바 ─────────────────────────────────────────────────────────────────────
   해처리 계열은 라바를 뱉는다. 아래는 그 규칙(원작의 사실)이다.
   ⚠ 여기 있던 "리플레이에 라바 자체는 안 남는다"는 말은 **명령 기록만 보던 시절의
     것**이라 지웠다. 참값 자취에는 라바가 제 유닛으로 실린다 — 그래서 이 상수들로
     라바 수를 되짚던 층(hatchState)은 걷어냈다(아래 걷어냄 주석). */

/** 라바 하나가 새로 도는 데 걸리는 프레임 — 342(빠른 속도 23.81fps에서 14.36초).
 *  ⚠ [어림] 원전 코드를 못 읽었다. 널리 쓰이는 값이고 화면에서도 맞지만, 확인되면
 *  출처와 함께 고쳐라. */
export const LARVA_SPAWN_FRAMES = 342;
/** 14.36초. */
export const LARVA_SPAWN_SEC = LARVA_SPAWN_FRAMES / 23.81;
/** 해처리 하나가 데리고 있을 수 있는 라바 수 — 셋. */
export const LARVA_MAX = 3;
/** 시작 해처리는 처음부터 라바 셋을 데리고 있다. 새로 지은 해처리는 빈손으로 시작해
 *  LARVA_SPAWN_SEC마다 하나씩 채운다. */
export const LARVA_START = 3;
/** 경기 시작 자원(요청: "게임 시작 시 미네랄 50원") — 저그가 0초에 낼 수 있는 변태는
 *  이 돈으로 살 수 있는 만큼뿐이다. 드론 50이니 0초의 알은 많아야 하나다. */
export const START_MINERALS = 50;
/** 알 하나에서 둘이 나오는 유닛 — 개체 수를 알 수로 셀 때 둘씩 묶는다. */
export const EGG_TWINS = new Set(["Zergling", "Scourge"]);
/** 미네랄 값(변태에 드는 몫만) — 0초 알 개수를 가리는 데 쓴다. */
export const MORPH_MINERAL: Record<string, number> = {
  Drone: 50, Zergling: 50, Overlord: 100, Hydralisk: 75, Mutalisk: 100,
  Scourge: 25, Queen: 100, Defiler: 50, Ultralisk: 200, Lurker: 50,
  Guardian: 50, Devourer: 50, "Infested Terran": 100,
};

/* ── 값(미네랄·가스) ── [DAT] units.dat MineralCost / GasCost 실덤프.
   자원 모형(채취 수입 · 지출)의 지출 쪽 재료다. 손으로 적지 않았다 —
   heinermann/factorio-starcraft의 arr/units.lua(units.dat 통짜 덤프)를 긁어 이 프로젝트가
   쓰는 이름으로만 접었다. 103종이 다 잡혔고 이름이 다른 넷(다크 템플러·시즈 탱크·
   퀸즈 네스트·고치)만 손으로 이어 붙였다.

   읽는 규칙 셋 — 이 표는 "그 순간 지갑에서 나가는 돈"이다:
    · **변태는 차액이다.** 러커 [50,100]는 히드라 값이 아니라 히드라에서 러커로 바뀔 때
      더 내는 몫이고, 레어·하이브·그레이터 스파이어·성큰·스포어도 마찬가지다. 아콘·
      다크 아콘이 [0,0]인 것도 같은 이유다(템플러 둘을 이미 샀다).
    · **저그 쌍둥이는 알 하나 값이다.** 저글링 [50,0]·스커지 [25,75]는 두 마리 값이
      아니라 **알 한 개** 값이다(그 알에서 둘이 나온다) — MORPH_MINERAL과 같은 규약.
    · 덤프에서 1/1로 적힌 것(라바·알·브루들링·스파이더 마인 같은 '값 없음' 표식)은
      0으로 내렸다. 공짜로 생기는 것들이라 지출에 잡히면 안 된다. */
export const UNIT_COST: Record<string, readonly [number, number]> = {
  Academy: [150, 0],
  Arbiter: [100, 350],
  "Arbiter Tribunal": [200, 150],
  Archon: [0, 0],
  Armory: [100, 50],
  Assimilator: [100, 0],
  Barracks: [150, 0],
  Battlecruiser: [400, 300],
  Broodling: [0, 0],
  Bunker: [100, 0],
  Carrier: [350, 250],
  "Citadel of Adun": [150, 100],
  Cocoon: [0, 0],
  "Command Center": [400, 0],
  "Comsat Station": [50, 50],
  "Control Tower": [50, 50],
  Corsair: [150, 100],
  "Covert Ops": [50, 50],
  "Creep Colony": [75, 0],
  "Cybernetics Core": [200, 0],
  "Dark Archon": [0, 0],
  "Dark Templar": [125, 100],
  Defiler: [50, 150],
  "Defiler Mound": [100, 100],
  Devourer: [150, 50],
  Dragoon: [125, 50],
  Drone: [50, 0],
  Dropship: [100, 100],
  Egg: [0, 0],
  "Engineering Bay": [125, 0],
  "Evolution Chamber": [75, 0],
  Extractor: [50, 0],
  Factory: [200, 100],
  Firebat: [50, 25],
  "Fleet Beacon": [300, 200],
  Forge: [150, 0],
  Gateway: [150, 0],
  Ghost: [25, 75],
  Goliath: [100, 50],
  "Greater Spire": [100, 150],
  Guardian: [50, 100],
  Hatchery: [300, 0],
  "High Templar": [50, 150],
  Hive: [200, 150],
  Hydralisk: [75, 25],
  "Hydralisk Den": [100, 50],
  "Infested Command Center": [0, 0],
  "Infested Terran": [100, 50],
  Interceptor: [25, 0],
  Lair: [150, 100],
  Larva: [0, 0],
  Lurker: [50, 100],
  "Lurker Egg": [0, 0],
  "Machine Shop": [50, 50],
  Marine: [50, 0],
  Medic: [50, 25],
  "Missile Turret": [75, 0],
  Mutalisk: [100, 100],
  Nexus: [400, 0],
  "Nuclear Missile": [200, 200],
  "Nuclear Silo": [100, 100],
  "Nydus Canal": [150, 0],
  Observatory: [50, 100],
  Observer: [25, 75],
  Overlord: [100, 0],
  "Photon Cannon": [150, 0],
  "Physics Lab": [50, 50],
  Probe: [50, 0],
  Pylon: [100, 0],
  Queen: [100, 100],
  "Queen's Nest": [150, 100],
  "Queens Nest": [150, 100],
  Reaver: [200, 100],
  Refinery: [100, 0],
  "Robotics Facility": [200, 200],
  "Robotics Support Bay": [150, 100],
  SCV: [50, 0],
  Scarab: [15, 0],
  "Science Facility": [100, 150],
  "Science Vessel": [100, 225],
  Scourge: [25, 75],
  Scout: [275, 125],
  "Shield Battery": [100, 0],
  Shuttle: [200, 0],
  "Siege Tank": [150, 100],
  "Siege Tank (Siege Mode)": [150, 100],
  "Siege Tank (Tank Mode)": [150, 100],
  "Spawning Pool": [200, 0],
  "Spider Mine": [1, 0],
  Spire: [200, 150],
  "Spore Colony": [50, 0],
  Stargate: [150, 150],
  Starport: [150, 100],
  "Sunken Colony": [50, 0],
  "Supply Depot": [100, 0],
  "Templar Archives": [150, 200],
  Ultralisk: [200, 200],
  "Ultralisk Cavern": [150, 200],
  Valkyrie: [250, 125],
  Vulture: [75, 0],
  Wraith: [150, 100],
  Zealot: [100, 0],
  Zergling: [50, 0],
};
/** 그 정체의 값 — 표에 없으면 [0,0](공짜로 생기는 것·모르는 것). */
export function costOf(kind: string): readonly [number, number] {
  return UNIT_COST[kind] ?? ZERO_COST;
}
const ZERO_COST: readonly [number, number] = [0, 0];
/* (걷어냄) 해처리 발치의 라바·알 되짚기 — HATCH_SPOTS·HatchRec·HatchSpot·hatchState.
   "리플레이에 라바 자체는 안 남는다"를 전제로, 변태 시각들만 가지고 지금 라바가 몇이고
   무엇을 품고 있나를 규칙(342프레임마다 하나·최대 셋)으로 되짚던 층이다.
   ★ 그 전제가 참값에서 깨졌다 — 참값 자취에는 라바도 알도 **제 유닛으로** 실린다
     (자리·태그·체력까지). 실측: 한 판에 라바 키 5,558 · 알 키 5,304이고, 태그 하나가
     라바 35 → 알 36 → 유닛으로 갈아입는다. 되짚을 것이 없다.
   위 LARVA_* 상수는 남긴다 — 원작의 사실이라, 되짚기와 무관하게 값으로 쓸 데가 있다. */

/** 회전 속도(도/초) — [추정] flingy.dat turn_radius를 못 구했다. 화면에서 맞춘 값. */
export const TURN_RATE: Record<string, number> = {
  "Siege Tank": 200, "Siege Tank (Tank Mode)": 200, Goliath: 240, Dragoon: 240,
  Reaver: 160, Carrier: 130, Battlecruiser: 130, Guardian: 160, Ultralisk: 240,
  Lurker: 240, Arbiter: 200, "Science Vessel": 200, Overlord: 130,
};
export const DEFAULT_TURN_RATE = 380;

/* ════════════════════════════════════════════════════════════════════════════
   6. 업그레이드 — [DAT] UpgradeType.cpp
   ════════════════════════════════════════════════════════════════════════════ */

/** [연구 프레임 기준, 레벨당 증가 프레임, 최대 레벨].
 *  실제 초 = (base + max(0, lv-1) * factor) / 23.81 → 3단 업글은 168 / 188 / 208초다.
 *  옛 분석 코드가 쓰던 "일률 70초"는 2.4배 빠른 값이었다. */
export const UPGRADE_TIME: Record<string, [number, number, number]> = {
  "Terran Infantry Armor": [4000, 480, 3],
  "Terran Vehicle Plating": [4000, 480, 3],
  "Terran Ship Plating": [4000, 480, 3],
  "Zerg Carapace": [4000, 480, 3],
  "Zerg Flyer Carapace": [4000, 480, 3],
  "Protoss Ground Armor": [4000, 480, 3],
  "Protoss Air Armor": [4000, 480, 3],
  "Terran Infantry Weapons": [4000, 480, 3],
  "Terran Vehicle Weapons": [4000, 480, 3],
  "Terran Ship Weapons": [4000, 480, 3],
  "Zerg Melee Attacks": [4000, 480, 3],
  "Zerg Missile Attacks": [4000, 480, 3],
  "Zerg Flyer Attacks": [4000, 480, 3],
  "Protoss Ground Weapons": [4000, 480, 3],
  "Protoss Air Weapons": [4000, 480, 3],
  "Protoss Plasma Shields": [4000, 480, 3],
  "U-238 Shells": [1500, 0, 1],
  "Ion Thrusters": [1500, 0, 1],
  "Titan Reactor": [2500, 0, 1],
  "Ocular Implants": [2500, 0, 1],
  "Moebius Reactor": [2500, 0, 1],
  "Apollo Reactor": [2500, 0, 1],
  "Colossus Reactor": [2500, 0, 1],
  "Ventral Sacs": [2400, 0, 1],
  Antennae: [2000, 0, 1],
  "Pneumatized Carapace": [2000, 0, 1],
  "Metabolic Boost": [1500, 0, 1],
  "Adrenal Glands": [1500, 0, 1],
  "Muscular Augments": [1500, 0, 1],
  "Grooved Spines": [1500, 0, 1],
  "Gamete Meiosis": [2500, 0, 1],
  "Metasynaptic Node": [2500, 0, 1],
  "Defiler Energy": [2500, 0, 1],  // 이 프로젝트가 쓰는 다른 표기
  "Singularity Charge": [2500, 0, 1],
  "Leg Enhancements": [2000, 0, 1],
  "Leg Enhancement": [2000, 0, 1],  // 이 프로젝트가 쓰는 다른 표기
  "Scarab Damage": [2500, 0, 1],
  "Reaver Capacity": [2500, 0, 1],
  "Gravitic Drive": [2500, 0, 1],
  "Sensor Array": [2000, 0, 1],
  "Gravitic Boosters": [2000, 0, 1],
  "Gravitic Booster": [2000, 0, 1],  // 이 프로젝트가 쓰는 다른 표기
  "Khaydarin Amulet": [2500, 0, 1],
  "Apial Sensors": [2500, 0, 1],
  "Gravitic Thrusters": [2500, 0, 1],
  "Carrier Capacity": [1500, 0, 1],
  "Khaydarin Core": [2500, 0, 1],
  "Argus Jewel": [2500, 0, 1],
  "Argus Talisman": [2500, 0, 1],
  "Caduceus Reactor": [2500, 0, 1],
  "Chitinous Plating": [2000, 0, 1],
  "Anabolic Synthesis": [2000, 0, 1],
  "Charon Boosters": [2000, 0, 1],
};

/** 업그레이드 비용 [기준, 레벨당 증가] — 가스는 미네랄과 같은 값이다. */
export const UPGRADE_COST: Record<string, [number, number]> = {
  "Terran Infantry Armor": [100, 75],
  "Terran Vehicle Plating": [100, 75],
  "Terran Ship Plating": [150, 75],
  "Zerg Carapace": [150, 75],
  "Zerg Flyer Carapace": [150, 75],
  "Protoss Ground Armor": [100, 75],
  "Protoss Air Armor": [150, 75],
  "Terran Infantry Weapons": [100, 75],
  "Terran Vehicle Weapons": [100, 75],
  "Terran Ship Weapons": [100, 50],
  "Zerg Melee Attacks": [100, 50],
  "Zerg Missile Attacks": [100, 50],
  "Zerg Flyer Attacks": [100, 75],
  "Protoss Ground Weapons": [100, 50],
  "Protoss Air Weapons": [100, 75],
  "Protoss Plasma Shields": [200, 100],
  "U-238 Shells": [150, 0],
  "Ion Thrusters": [100, 0],
  "Titan Reactor": [150, 0],
  "Ocular Implants": [100, 0],
  "Moebius Reactor": [150, 0],
  "Apollo Reactor": [200, 0],
  "Colossus Reactor": [150, 0],
  "Ventral Sacs": [200, 0],
  Antennae: [150, 0],
  "Pneumatized Carapace": [150, 0],
  "Metabolic Boost": [100, 0],
  "Adrenal Glands": [200, 0],
  "Muscular Augments": [150, 0],
  "Grooved Spines": [150, 0],
  "Gamete Meiosis": [150, 0],
  "Metasynaptic Node": [150, 0],
  "Singularity Charge": [150, 0],
  "Leg Enhancements": [150, 0],
  "Scarab Damage": [200, 0],
  "Reaver Capacity": [200, 0],
  "Gravitic Drive": [200, 0],
  "Sensor Array": [150, 0],
  "Gravitic Boosters": [150, 0],
  "Khaydarin Amulet": [150, 0],
  "Apial Sensors": [100, 0],
  "Gravitic Thrusters": [200, 0],
  "Carrier Capacity": [100, 0],
  "Khaydarin Core": [150, 0],
  "Argus Jewel": [100, 0],
  "Argus Talisman": [150, 0],
  "Caduceus Reactor": [150, 0],
  "Chitinous Plating": [150, 0],
  "Anabolic Synthesis": [200, 0],
  "Charon Boosters": [100, 0],
};

/** 무기 표가 실제로 쓰는 공격 업그레이드 이름. 증가량은 무기마다 다르다(Weapon.bonus). */
export const WEAPON_UPGRADES: readonly string[] = [
  "Protoss Air Weapons", "Protoss Ground Weapons", "Scarab Damage",
  "Terran Infantry Weapons", "Terran Ship Weapons", "Terran Vehicle Weapons",
  "Zerg Flyer Attacks", "Zerg Melee Attacks", "Zerg Missile Attacks",
];
/** 유닛 표가 실제로 쓰는 방어 업그레이드 이름 — 전부 레벨당 +1이다. 건물엔 안 붙는다. */
export const ARMOR_UPGRADES: readonly string[] = [
  "Protoss Air Armor", "Protoss Ground Armor", "Terran Infantry Armor",
  "Terran Ship Plating", "Terran Vehicle Plating", "Zerg Carapace",
  "Zerg Flyer Carapace",
];
/** 실드에만 걸리는 업그레이드 — 레벨당 −1. */
export const PLASMA_SHIELD_UPGRADE = "Protoss Plasma Shields";
/* ── 인구 ── [DAT] UnitType.cpp supplyRequired / supplyProvided
   값은 **내부 단위**다(화면 표시값 × 2) — 저글링·스커지가 0.5라 정수로 다루려면 이래야
   한다. 상한도 마찬가지로 400(표시 200)이다.
   ⚠ 이 표는 덤프가 아니라 손으로 적었다. 원작 값이 오래 고정돼 있어 안전하지만,
     쓰는 쪽은 '유닛을 지우는' 판정에 쓰지 마라 — 이 프로젝트는 우리가 **지어낸** 개체의
     상한으로만 쓴다(replayUnits의 합성 개체 정리). */
export const SUPPLY_CAP = 400;
export const SUPPLY_COST: Record<string, number> = {
  SCV: 2, Marine: 2, Firebat: 2, Medic: 2, Ghost: 2,
  Vulture: 4, "Siege Tank": 4, "Siege Tank (Tank Mode)": 4, "Siege Tank (Siege Mode)": 4,
  Goliath: 4, Wraith: 4, Dropship: 4, "Science Vessel": 4, Battlecruiser: 12, Valkyrie: 6,
  Probe: 2, Zealot: 4, Dragoon: 4, "High Templar": 4, "Dark Templar": 4,
  Archon: 8, "Dark Archon": 8, Shuttle: 4, Reaver: 8, Observer: 2,
  Scout: 6, Carrier: 12, Arbiter: 8, Corsair: 4,
  Drone: 2, Zergling: 1, Hydralisk: 2, Lurker: 4, Mutalisk: 4, Scourge: 1,
  Queen: 4, Defiler: 4, Ultralisk: 8, Guardian: 4, Devourer: 4,
  "Infested Terran": 2,
  // 인구를 안 먹는 것들 — 오버로드는 오히려 준다(아래).
  Overlord: 0, Larva: 0, Egg: 0, Cocoon: 0, Broodling: 0, Interceptor: 0, Scarab: 0,
  "Spider Mine": 0, "Nuclear Missile": 0,
};
export const SUPPLY_GIVES: Record<string, number> = {
  "Command Center": 20, "Supply Depot": 16,
  Nexus: 18, Pylon: 16,
  Hatchery: 2, Lair: 2, Hive: 2, Overlord: 16,
};

/** 울트라리스크 갑피 — 카라파스와 별개로 방어력 +2 고정. */
export const CHITINOUS_PLATING = "Chitinous Plating";

/** 그 업그레이드의 N레벨 연구가 끝나는 데 걸리는 초. */
export function upgradeSeconds(name: string, level: number): number {
  const t = UPGRADE_TIME[name];
  if (!t) return 168;   // [추정] 표에 없으면 3단 업글 1렙(4000프레임)으로 친다
  return (t[0] + Math.max(0, level - 1) * t[1]) * FRAME_SEC;
}

/** 그 업그레이드의 최대 레벨 — 공·방업만 3이고 나머지는 1이다. */
export const upgradeMaxLevel = (name: string): number => UPGRADE_TIME[name]?.[2] ?? 1;

/* ════════════════════════════════════════════════════════════════════════════
   7. 피해 셈 — [OBW] weapon_deal_damage 를 문장 순서 그대로 옮긴 것

   핵심은 순서다. bwgame.h에서 방어력 차감 블록이 switch(damage_type)보다 **위**에 있다:
       최종 = (원피해 − 방어력) × 크기배수
   그리고 실드는 그 방어력 블록보다도 위에서 깎이므로 **유닛 방어력도 크기 배수도 안 받는다**
   (실드를 줄이는 것은 플라즈마 실드 업그레이드 하나뿐).
   ════════════════════════════════════════════════════════════════════════════ */

/** 표적의 지금 상태 — hp/shield/matrixHp는 fp8 raw(정수)다. */
export type DmgTarget = {
  /** 남은 체력(fp8 raw). */
  hp: number;
  /** 남은 실드(fp8 raw). */
  shield: number;
  /** 실드를 가진 종류인가(지금 0이어도 true). */
  hasShield: boolean;
  size: UnitSize;
  /** 기본 방어력(정수). */
  armor: number;
  /** 방어 업그레이드 레벨. */
  armorLv?: number;
  /** 울트라리스크 키틴질 갑피 — 카라파스와 별개로 +2. */
  chitinous?: boolean;
  /** 플라즈마 실드 업글 레벨 — 실드에만 −1/렙. */
  plasmaLv?: number;
  /** 남은 디펜시브 매트릭스(fp8 raw). */
  matrixHp?: number;
  /** 스테이시스 — 피해 계산 자체를 안 한다. */
  invincible?: boolean;
  /** 환상 — 받는 피해 2배. */
  hallucination?: boolean;
  /** 디바우러 산성포자 중첩(0~9). */
  acidSpores?: number;
};

/** 히트 1회에 얹히는 주변 효과. */
export type HitCtx = {
  /** 스플래시 링(1/2/4) 또는 뮤탈 튕김(1/3/9). **방어력보다 먼저** 나눈다. */
  divisor?: number;
  /** 공격자의 공업 레벨. */
  weaponLv?: number;
};

export type HitResult = {
  /** 체력에 실제로 들어간 피해(fp8 raw). */
  hp: number;
  /** 실드가 흡수한 몫(fp8 raw). */
  shield: number;
  /** 매트릭스가 흡수한 몫(fp8 raw). */
  matrix: number;
  killed: boolean;
};

const ZERO_HIT: HitResult = { hp: 0, shield: 0, matrix: 0, killed: false };

/** 유닛 방어력(정수). [OBW] unit_armor */
export function armorOf(t: DmgTarget): number {
  let a = t.armor;
  if (t.chitinous) a += 2;
  a += t.armorLv ?? 0;
  return a;
}

/** 무기 히트 1회의 기본 피해(fp8 raw). [OBW] weapon_damage_amount */
export function weaponRaw(wp: Weapon, weaponLv = 0): number {
  return fp(wp.dmg + wp.bonus * weaponLv);
}

/** 히트 1회 — 표적 상태를 그 자리에서 깎는다. 단계 번호는 bwgame.h 문장 순서다. */
export function dealOneHit(wp: Weapon, t: DmgTarget, ctx: HitCtx = {}): HitResult {
  if (t.hp <= 0) return ZERO_HIT;
  if (t.invincible) return ZERO_HIT;                       // (0) 스테이시스 = 완전 무피해

  let d = weaponRaw(wp, ctx.weaponLv ?? 0);
  if (t.hallucination) d *= 2;                             // (1) 환상은 2배로 맞는다
  d = truncDiv(d, ctx.divisor ?? 1);                       // (2) 링·튕김 — 방어력보다 먼저
  d += (t.acidSpores ?? 0) * FP;                           // (3) 산성포자 +1/중첩 (방어력 전)
  if (d < 128) d = 128;                                    // (4) 이른 하한 0.5

  let matrix = 0;                                          // (5) 매트릭스가 제일 먼저 흡수
  const mx = t.matrixHp ?? 0;
  if (mx > 0) { matrix = Math.min(d, mx); d -= matrix; }

  let shield = 0;                                          // (6) 실드 — 방어력·크기배수 면제
  if (t.hasShield && t.shield >= FP) {                     //     1.0 미만이면 블록을 통째로 건너뛴다
    if (wp.type !== "ignoreArmor") {
      const sa = (t.plasmaLv ?? 0) * FP;
      d = d > sa ? d - sa : 128;
    }
    shield = Math.min(d, t.shield);
    d -= shield;                                           //     넘친 만큼만 아래로 흐른다
  }

  if (wp.type !== "ignoreArmor") {                         // (7) ★ 유닛 방어력
    const a = armorOf(t) * FP;
    d = d > a ? d - a : 0;
  }

  d = fpMul(d, SIZE_MUL_256[wp.type][SIZE_IDX[t.size]]);   // (8) ★ 크기 배수는 방어력 뒤

  if (shield === 0 && d < 128) d = 128;                    // (9) 늦은 하한 — 실드를 1도 못 깎았을 때만

  if (mx > 0) t.matrixHp = mx - matrix;
  t.shield -= shield;
  let killed = false;
  if (d >= t.hp) { t.hp = 0; killed = true; }              // ★ >= 이지 > 가 아니다
  else t.hp -= d;
  return { hp: d, shield, matrix, killed };
}

/** 한 공격(쿨다운 1회분) — 히트 수만큼 dealOneHit을 되풀이한다.
 *  히트마다 방어력·크기배수·하한이 따로 걸리므로 절대 미리 합산하지 마라. */
export function attackOnce(
  wp: Weapon, t: DmgTarget,
  opts: HitCtx & {
    /** 공격자가 환상이면 피해 0. [OBW] hallucinated_weapon_hit — 계산 자체를 안 한다. */
    attackerHallucination?: boolean;
    /** 히트 수 강제(파이어뱃 단일 표적 근사 등). 없으면 wp.hits. */
    hits?: number;
    /** 히트마다 빗맞음을 굴리려면 넣는다. 근접(총알 없는 무기)에는 넣지 마라. */
    missRoll?: () => boolean;
  } = {},
): HitResult & { misses: number } {
  if (opts.attackerHallucination) return { ...ZERO_HIT, misses: 0 };
  const n = opts.hits ?? wp.hits;
  let hp = 0; let shield = 0; let matrix = 0; let killed = false; let misses = 0;
  for (let i = 0; i < n; i += 1) {
    if (opts.missRoll && opts.missRoll()) { misses += 1; continue; }
    const r = dealOneHit(wp, t, opts);
    hp += r.hp; shield += r.shield; matrix += r.matrix;
    if (r.killed) { killed = true; break; }
  }
  return { hp, shield, matrix, killed, misses };
}

/** 그 정체의 표적 한 벌을 만든다 — 체력·실드·크기·방어력을 표에서 가져온다. */
export function targetOf(kind: string, over: Partial<DmgTarget> = {}): DmgTarget {
  const uc = unitOf(kind);
  return {
    hp: fp(uc.hp), shield: fp(uc.shield), hasShield: uc.shield > 0,
    size: uc.size, armor: uc.armor, ...over,
  };
}

/* ── 빗맞음 ── [OBW] 총알이 태어날 때만 굴린다. 근접(opc_attackmelee)은 총알이 없어
   굴림 자체가 없다. 스플래시·야마토·상태이상도 빗맞음 플래그를 안 본다. */

/** 빗맞음 원값 — 0 / 119 / 255 셋뿐이다. */
export function missChanceRaw(env: {
  targetFlying: boolean; targetIsBuilding: boolean;
  targetUnderDarkSwarm: boolean; targetOnCoverTile: boolean;
  attackerFlying: boolean; targetGroundHeight: number; attackerGroundHeight: number;
}): number {
  let r = 0;
  if (!env.targetFlying) {
    if (env.targetUnderDarkSwarm && !env.targetIsBuilding) r = 255;
    else if (env.targetOnCoverTile) r = 119;
  }
  if (!env.attackerFlying && !env.targetFlying
      && env.targetGroundHeight > env.attackerGroundHeight) {
    if (r < 119) r = 119;             // 높이 차가 몇 단이든 무조건 119
  }
  return r;
}

/** 그 원값의 실제 빗맞음 확률 — 비교가 `<=`라 (raw+1)/256이다.
 *  119 → 120/256 = 46.875%(흔히 말하는 "53%"는 명중률 쪽이다).
 *  0   → 1/256 = 0.39% — 평지에서도 빗나간다. */
export const missProbability = (raw: number): number => (raw + 1) / 256;

/** 다크 스웜을 뚫는가 — 빗맞음 플래그를 검사하는 hit_type은 normal과 corrosive_acid
 *  둘뿐이다. [OBW] bullet_hit */
export function ignoresDarkSwarm(wp: Weapon): boolean {
  if (wp.id === "Corrosive_Acid") return false;      // 디바우러 산성포는 막힌다
  if (wp.splashKind !== "none") return true;
  if (wp.id === "Yamato_Gun") return true;
  return wp.rangePx <= 32;                           // [추정] 근접 판정을 사거리로 갈음했다
}

/* ── 쿨다운 ── [OBW] get_modified_weapon_cooldown */

/** 실제 쿨다운(프레임). 원작은 여기에 (rand&3)−1 지터가 더 붙어 −1~+2 프레임 흔들린다. */
export function cooldownFrames(wp: Weapon, s: {
  stim?: boolean; adrenal?: boolean; ensnared?: boolean; acidSpores?: number;
} = {}): number {
  let cd = wp.cdFrames;
  const acid = s.acidSpores ?? 0;
  if (acid) cd += Math.max(Math.trunc(cd / 8), 3) * acid;
  let mod = 0;
  if (s.stim) mod += 1;
  if (s.adrenal) mod += 1;            // 아드레날은 스팀과 중첩되지 않는다 — 둘 다 mod>0
  if (s.ensnared) mod -= 1;
  if (mod > 0) cd = Math.trunc(cd / 2);
  if (mod < 0) cd += Math.trunc(cd / 4);
  if (cd > 250) cd = 250;
  if (cd < 5) cd = 5;
  return cd;
}
export const cooldownSec = (wp: Weapon, s?: Parameters<typeof cooldownFrames>[1]): number =>
  cooldownFrames(wp, s) * FRAME_SEC;

/* ════════════════════════════════════════════════════════════════════════════
   8. 사거리 삼분 — 무기(픽셀) / 자동 획득(타일) / 시야(타일)은 서로 다른 값이다.
   ════════════════════════════════════════════════════════════════════════════ */

/** 사거리 보너스가 붙는 업그레이드 — [OBW] weapon_max_range(픽셀) / unit_target_acquisition_range(타일). */
export const RANGE_UPGRADES: Record<string, { unit: string; px: number; tiles: number; weapon?: string }> = {
  "U-238 Shells": { unit: "Marine", px: 32, tiles: 1 },
  "Grooved Spines": { unit: "Hydralisk", px: 32, tiles: 1 },
  "Singularity Charge": { unit: "Dragoon", px: 64, tiles: 2 },
  "Charon Boosters": { unit: "Goliath", px: 96, tiles: 3, weapon: "Hellfire_Missile_Pack" },
};
/** 벙커에 탄 유닛이 받는 보너스 — 무기 +64px, 자동 획득 +2타일. [OBW] find_acquire_target */
export const BUNKER_RANGE_PX = 64;
export const BUNKER_ACQUIRE_TILES = 2;
/** 벙커 안에서 쏠 수 있는 정체 — 메딕·SCV는 타기만 하고 못 쏜다. */
export const BUNKER_SHOOTERS = new Set(["Marine", "Firebat", "Ghost"]);

type UpHas = (name: string) => boolean;

/** ① 무기 사거리(픽셀). [OBW] weapon_max_range */
export function weaponRangePx(
  wp: Weapon, kind: string, o: { inBunker?: boolean; ups?: UpHas } = {},
): number {
  let r = wp.rangePx;
  if (o.inBunker) r += BUNKER_RANGE_PX;
  const has = o.ups;
  if (has) {
    for (const [name, b] of Object.entries(RANGE_UPGRADES)) {
      if (b.unit !== kind || !has(name)) continue;
      if (b.weapon && b.weapon !== wp.id) continue;
      r += b.px;
    }
  }
  return r;
}

/** ② 자동 획득 사거리(타일).
 *  units.dat의 seek 원값은 게임이 뜰 때 한 번 올려 잡힌다 —
 *  [OBW] set_acquisition_ranges: acq = max(seek, 지상사거리/32, 대공사거리/32).
 *  그래서 마린의 seek 0은 실제로 4다. BWAPI seekRange()를 그대로 쓰면 마린이 자동으로
 *  싸우지 않는다 — 옛 코드가 사거리 하나로 다 갈음하던 자리가 여기다. */
export function acquireTiles(
  kind: string, o: { ups?: UpHas; inBunker?: boolean } = {},
): number {
  const uc = unitOf(kind);
  let acq = uc.seek;
  if (uc.ground) acq = Math.max(acq, Math.trunc(WEAPONS[uc.ground].rangePx / 32));
  if (uc.air) acq = Math.max(acq, Math.trunc(WEAPONS[uc.air].rangePx / 32));
  const has = o.ups;
  if (has) {
    for (const [name, b] of Object.entries(RANGE_UPGRADES)) {
      if (b.unit === kind && has(name)) acq += b.tiles;
    }
  }
  if (o.inBunker) acq += BUNKER_ACQUIRE_TILES;
  return acq;
}

/** ③ 시야(타일). */
export const sightTiles = (kind: string): number => unitOf(kind).sight;

/** 그 정체의 몸 반지름(타일) — 스프라이트 상자의 가로·세로 반폭을 평균한 값.
 *  표에 없으면 크기 등급의 대표값(BODY_R). */
export function bodyRadiusTiles(kind: string): number {
  const uc = UNITS[kind];
  if (!uc) return BODY_R.medium;
  const [l, up, r, dn] = uc.box;
  return ((l + 1 + r) / 2 + (up + 1 + dn) / 2) / 2 / 32;
}

/** 중심 사이 거리로 잴 때의 실효 사거리(타일).
 *  원작은 두 스프라이트 상자의 **모서리 사이** 거리를 재는데 이 프로젝트의 시뮬은 중심
 *  사이를 잰다. 그 차이를 안 메우면 큰 유닛일수록 사거리가 짧아지고, 질럿(무기 0.47타일)
 *  같은 근접 유닛은 서로 파고들기 전에는 영영 사거리 안에 못 든다. */
export function reachTiles(wp: Weapon, attacker: string, target: string): number {
  return wp.rangePx / 32 + bodyRadiusTiles(attacker) + bodyRadiusTiles(target);
}

/* ── 스플래시 ── [OBW] bullet_deal_splash_damage */

/** 그 거리(픽셀)에서 쓸 divisor. 못 맞으면 null.
 *  ⚠ air_splash는 inner 분기가 없어 표적 본인 말고는 전부 2 또는 4다.
 *  ⚠ 버로우한 표적은 medium/outer 링을 아예 안 맞는다(inner만 유효). */
export function splashDivisor(
  wp: Weapon, distPx: number, o: { burrowed?: boolean; isBulletTarget?: boolean } = {},
): number | null {
  const [inner, mid, outer] = wp.splashPx;
  if (wp.splashKind === "none") return o.isBulletTarget ? 1 : null;
  if (wp.splashKind === "lurker") return distPx <= inner ? 1 : null;  // 감쇠 없는 풀데미지
  if (distPx > outer) return null;
  if (wp.splashKind !== "air" && distPx <= inner) return 1;
  if (o.burrowed) return null;
  return distPx <= mid ? 2 : 4;
}
/** 그 스플래시가 제 편도 때리는가. [OBW] damages_allies — radial과 핵만 아군을 친다. */
export const splashHitsOwnUnits = (wp: Weapon): boolean => wp.splashKind === "radial";
/** 시전자 본인도 제 스플래시에 맞는가 — 사이오닉 스톰만 맞는다. */
export const splashHitsCaster = (wp: Weapon): boolean => wp.id === "Psionic_Storm";

/* ── 러커 ── 무기·사거리·쿨다운은 WEAPONS.Subterranean_Spines에 있다. 여기는 그 무기가
   일반 스플래시 경로를 안 타기 때문에 따로 적어 두는 규칙들이다. */
/** 같은 표적을 다시 때리기까지 막는 프레임 — st.recent_lurker_hits. */
export const LURKER_REHIT_FRAMES = 32;
/** 가시가 제 자리에서 나아가는 거리(픽셀)와 속도(픽셀/프레임) — behaviour 9 "go to max range". */
export const LURKER_SPINE_TRAVEL_PX = 212;
export const LURKER_SPINE_SPEED_PX = 18.75;
/** 버로우를 풀기까지 최소 4틱 = 36프레임. 버로우한 러커는 이동 명령 자체가 거부된다. */
export const UNBURROW_MIN_FRAMES = 36;

/* ── 재생·치유 ── [OBW] 매 프레임 더한다. 초당값은 ×23.81이다. */
/** 저그 체력 재생 +4_fp8/프레임 = 0.372/초. **정액이다 — 최대체력 비례가 아니다.** */
export const ZERG_REGEN_PER_SEC = (4 / FP) / FRAME_SEC;
/** 프로토스 실드 재생 +7_fp8/프레임 = 0.651/초. 정액이고, 완성 전 건물도 찬다. */
export const SHIELD_REGEN_PER_SEC = (7 / FP) / FRAME_SEC;
/** 테란 건물 화재 — 체력 33% 이하에서 20_fp8/프레임 = 1.86/초. **하한이 없어 타서 무너진다.** */
export const TERRAN_BURN_PER_SEC = (20 / FP) / FRAME_SEC;
export const TERRAN_BURN_HP_PCT = 33;
/** 메딕 힐 — min(부족분, 200_fp8)/프레임 = 18.6/초. 에너지 1당 2HP, 중첩 불가, 사거리 30px. */
export const MEDIC_HEAL_PER_SEC = (200 / FP) / FRAME_SEC;
export const MEDIC_HEAL_RANGE_PX = 30;

/* ── 상태 타이머 ── [OBW] update_unit_status_timers는 8프레임마다 1씩 깎는다.
   실제 지속 = 틱 × 8프레임. 프레임으로 착각하면 8배 짧아진다. */
export const TIMER_TICK_FRAMES = 8;
export const timerSec = (ticks: number): number => ticks * TIMER_TICK_FRAMES * FRAME_SEC;
export const STATUS_TICKS = {
  stasis: 131, lockdown: 131, defensiveMatrix: 168,
  plague: 75, irradiate: 75, ensnare: 75, stim: 37, maelstrom: 22,
  /** 산성포자(디바우러) — [OBW] add_acid_spore가 슬롯에 150을 놓는다. 중첩 하나마다
   *  제 타이머를 따로 들고, 상태 틱(8프레임)마다 하나씩 준다 → 1200프레임(빠름 50.4초). */
  acidSpore: 150,
} as const;
/** 산성포자 최대 중첩 — [OBW] `if (u->acid_spore_count < 9) ++…`. */
export const ACID_SPORE_MAX = 9;
/** 산성포자가 번지는 반경(픽셀) — [OBW] add_acid_spore(pos, owner)의 square_at(pos, 64). */
export const ACID_SPORE_PX = 64;
/** 디펜시브 매트릭스 흡수량. */
export const MATRIX_HP = 250;
/** 스팀팩 자해 — 방어력·실드 무시 생피해. hp > 10일 때만 발동한다. */
export const STIM_SELF_DAMAGE = 10;
/** 스팀을 쓸 수 있는 정체 — 이 둘뿐이다.
 *  ★ 이걸 안 가리면 안 된다: 스팀은 부대 전체에 내리는 명령이라, 그때 함께 골라져 있던
 *    SCV·메딕·탱크에도 증거(f=16)가 남는다. 실측으로 한 경기에서 SCV 54기·메딕 3기·
 *    탱크 2기가 스팀 증거를 갖고 있었다. 그대로 믿으면 SCV가 두 배로 빨리 때린다. */
export const STIM_UNITS = new Set(["Marine", "Firebat"]);
/** 플레이그 — 피해 공식을 안 탄다(직접 차감). 75틱에 걸쳐 300, 절대 못 죽인다. */
export const PLAGUE_TOTAL = 300;
/** 이레디에이트 — ignoreArmor로 75틱에 250. 표적 32px 안 유기물 비건물 전원에게 번진다. */
export const IRRADIATE_TOTAL = 250;
/** 핵 — 표적마다 max(500, (최대체력+최대실드) × 2/3), 폭발형. */
export const nukeDamage = (maxHpPlusShield: number): number =>
  Math.max(500, Math.trunc((maxHpPlusShield * 2) / 3));

/* ── 판정 주기 ── [OBW] 오더는 9프레임마다 한 번 돈다(order_process_timer=8 재장전). */
export const ORDER_PROCESS_FRAMES = 9;
/** 표적을 다시 고르는 주기. */
export const RETARGET_FRAMES = 15;

/* ════════════════════════════════════════════════════════════════════════════
   9. 옛 이름 껍데기 — 아직 옛 모양으로 부르는 곳(simCore)이 있어 남겨 둔다.
      호출부를 dealOneHit/attackOnce로 옮기고 나면 이 절은 지운다.
   ════════════════════════════════════════════════════════════════════════════ */

export const UNIT_SIZE: Record<string, UnitSize> =
  Object.fromEntries(Object.entries(UNITS).map(([k, v]) => [k, v.size]));
export const UNIT_ARMOR: Record<string, number> =
  Object.fromEntries(Object.entries(UNITS).map(([k, v]) => [k, v.armor]));
export const UNIT_HP: Record<string, number> =
  Object.fromEntries(Object.entries(UNITS).map(([k, v]) => [k, v.hp]));
export const UNIT_SHIELD: Record<string, number> =
  Object.fromEntries(Object.entries(UNITS).map(([k, v]) => [k, v.shield]));

/** 지상 무기 — 없으면 지상을 못 친다.
 *  ⚠ 벙커가 여기 없는 것은 빠뜨린 게 아니다. 원작에서 벙커 자신은 표적을 잡지도 쏘지도
 *  않는다 — 안에 탄 마린·파이어뱃·고스트가 쏜다(무기 +64px, 획득 +2타일). */
export const WEAPON_GROUND: Record<string, Weapon> = Object.fromEntries(
  Object.entries(UNITS).filter(([, v]) => v.ground).map(([k, v]) => [k, WEAPONS[v.ground!]]),
);
/** 대공 무기 — 없으면 공중을 못 친다. */
export const WEAPON_AIR: Record<string, Weapon> = Object.fromEntries(
  Object.entries(UNITS).filter(([, v]) => v.air).map(([k, v]) => [k, WEAPONS[v.air!]]),
);

/** 옛 damageOf의 자리 — 새 셈(attackOnce)을 부르는 얇은 껍데기다.
 *
 *  옛 것과 달라진 점 둘. ① 순서를 바로잡았다((피해−방어력)×크기배수). ② 한 번의 공격에
 *  들어가는 히트 수(질럿 2, 파이어뱃 3, 발키리 8)를 반영한다 — 방어력이 히트마다 빠지므로
 *  합산한 값에서 한 번 빼는 것과는 결과가 다르다.
 *
 *  ⚠ 이 껍데기는 표적의 실드가 얼마나 남았는지를 모른다. onShield면 실드가 통째로
 *  흡수한다고 보고 방어력·크기배수 없는 값을, 아니면 실드가 하나도 없다고 보고 체력
 *  피해를 낸다. 실드가 애매하게 남은 순간의 넘침은 못 낸다 — 그 자리는 호출부를
 *  dealOneHit으로 옮겨야 맞아떨어진다. */
export function damageOf(w: Weapon, size: UnitSize, armor: number, onShield: boolean): number {
  if (onShield) {
    // 실드는 유닛 방어력도 크기 배수도 안 받는다. 하한 0.5만 걸린다.
    return unfp(Math.max(fp(w.dmg), 128) * w.hits);
  }
  const t: DmgTarget = { hp: 1 << 30, shield: 0, hasShield: false, size, armor };
  return unfp(attackOnce(w, t).hp);
}

/* ════════════════════════════════════════════════════════════════════════════
   10. 발자국·몸집 — [DAT] unitDimensions
   ════════════════════════════════════════════════════════════════════════════ */

/** 건물 발자국(타일) — tileWidth × tileHeight 그대로. */
export const BUILDING_FOOT: Record<string, [number, number]> = {
  "Command Center": [4, 3],
  "Comsat Station": [2, 2],
  "Nuclear Silo": [2, 2],
  "Supply Depot": [3, 2],
  Refinery: [4, 2],
  Barracks: [4, 3],
  Academy: [3, 2],
  Factory: [4, 3],
  Starport: [4, 3],
  "Control Tower": [2, 2],
  "Science Facility": [4, 3],
  "Covert Ops": [2, 2],
  "Physics Lab": [2, 2],
  "Machine Shop": [2, 2],
  "Engineering Bay": [4, 3],
  Armory: [3, 2],
  "Missile Turret": [2, 2],
  Bunker: [3, 2],
  "Infested Command Center": [4, 3],
  Hatchery: [4, 3],
  Lair: [4, 3],
  Hive: [4, 3],
  "Nydus Canal": [2, 2],
  "Hydralisk Den": [3, 2],
  "Defiler Mound": [4, 2],
  "Greater Spire": [2, 2],
  "Queen's Nest": [3, 2],
  "Queens Nest": [3, 2],
  "Evolution Chamber": [3, 2],
  "Ultralisk Cavern": [3, 2],
  Spire: [2, 2],
  "Spawning Pool": [3, 2],
  "Creep Colony": [2, 2],
  "Spore Colony": [2, 2],
  "Sunken Colony": [2, 2],
  Extractor: [4, 2],
  Nexus: [4, 3],
  "Robotics Facility": [3, 2],
  Pylon: [2, 2],
  Assimilator: [4, 2],
  Observatory: [3, 2],
  Gateway: [4, 3],
  "Photon Cannon": [2, 2],
  "Citadel of Adun": [3, 2],
  "Cybernetics Core": [3, 2],
  "Templar Archives": [3, 2],
  Forge: [3, 2],
  Stargate: [4, 3],
  "Fleet Beacon": [3, 2],
  "Arbiter Tribunal": [3, 2],
  "Robotics Support Bay": [3, 2],
  "Shield Battery": [3, 2],
};
/** 표에 없는 건물 — 3×2로 친다. [추정] */
export const DEFAULT_FOOT: [number, number] = [3, 2];

/** 건물 몸 상자(타일) — [폭, 높이, 발자국 중심에서 밀린 몫 x, y].
 *
 *  원작은 건물마다 상자를 **둘** 든다: 자리 상자(placement, 타일 배수 — 위 BUILDING_FOOT)
 *  와 몸 상자(units.dat dimensions). 몸이 자리보다 작고, 네 변이 저마다 다르게 작다
 *  (배럭 좌16·우8·상8·하16px). 그 차이가 곧 건물 사이의 **틈**이다 — 발자국을 딱 붙여
 *  놓아도 사이가 남고, 폭은 어느 건물의 어느 변이 마주 보느냐로 정해진다.
 *
 *  [OBW] 걸음·길찾기 충돌이 보는 것은 몸 상자다(unit_type_bounding_box =
 *  {-dimensions.from, dimensions.to + 1}, bwgame.h 710행). 발자국 타일에 칠하는
 *  flag_occupied(15843행)는 '여기 지을 수 있나'(can_place_building, 2578행)에만 쓰이고
 *  걸음을 안 막는다 — 발자국 안의 틈은 진짜로 걸어 다닐 수 있는 땅이다.
 *  자세한 표와 근거는 docs/note-building-gaps.md.
 *
 *  ⚠ 값은 UNITS[].box(= [left, up, right, down])에서 기계로 뽑는다. 손으로 적지 마라. */
export const BUILDING_BOX: Record<string, [number, number, number, number]> =
  Object.fromEntries(Object.entries(UNITS)
    .filter(([, u]) => u.building)
    .map(([k, u]) => {
      const [bl, bu, br, bd] = u.box;
      return [k, [(bl + br + 1) / 32, (bu + bd + 1) / 32, (br - bl) / 64, (bd - bu) / 64]];
    }));

/** 그 건물의 몸 상자 — 표에 없으면 발자국을 그대로 몸으로 친다(막는 쪽으로 안전하게). */
export function buildingBox(kind: string): [number, number, number, number] {
  const hit = BUILDING_BOX[kind];
  if (hit) return hit;
  const f = BUILDING_FOOT[kind] ?? DEFAULT_FOOT;
  return [f[0], f[1], 0, 0];
}

/** 지상 유닛 몸 상자(타일) — [폭, 높이]. 틈을 지날 수 있나는 이 둘로 가른다:
 *  가로 틈은 폭, 세로 틈은 높이가 들어가야 지난다(저글링 16×16px = 0.5×0.5타일). */
export function unitBoxTiles(kind: string): [number, number] {
  const u = UNITS[kind];
  if (!u) return [BODY_R.medium * 2, BODY_R.medium * 2];
  const [bl, bu, br, bd] = u.box;
  return [(bl + br + 1) / 32, (bu + bd + 1) / 32];
}

/** 자원 발자국(타일) — Resource_Mineral_Field / Resource_Vespene_Geyser. */
export const MINERAL_FOOT: [number, number] = [2, 1];
export const GEYSER_FOOT: [number, number] = [4, 2];

/* ── 자원 채취 순환(요청: 자원 모델을 붙일 거라 공식문서급으로) ────────────────────
   원작의 한 번 왕복은 늘 같은 차례다:
     밭·간헐천 테두리로 걸어가 → 붙고(딜레이) → 캐고 → 떨어지고(딜레이) →
     홀 테두리로 걸어와 → 반납(딜레이) → 되돌아선다.
   · 한 번에 실어 나르는 양은 미네랄·가스 모두 8이다.
   · **밭 하나·간헐천 하나에는 한 번에 한 일꾼만 붙는다** — 나머지는 곁에서 기다린다.
     이것이 '밭당 3기까지가 쓸모 있다'는 포화 규칙의 뿌리다.
   · 가스는 일꾼이 정제소 **안으로 들어가** 캐는 동안 화면에서 사라진다.

   ★ 프레임 값의 출처 — 채취 자체(MINERAL·GAS)는 널리 인용되는 커뮤니티 문서(BWAPI·
     Liquipedia 계열) 값이고, 붙고 떨어지고 반납하는 세 딜레이는 그만큼 확실한 출처를
     못 찾아 왕복 리듬에 맞춘 어림이다. 자원 모델(수입 곡선)을 붙일 때 **이 블록만**
     원전과 대조하면 된다 — 순환 전체가 여기서만 시간을 읽는다. */
/** 한 번 왕복에 실어 나르는 양(미네랄·가스 공통). */
export const HARVEST_AMOUNT = 8;
/** 미네랄에 붙어 캐는 시간(프레임). */
export const MINE_MINERAL_FRAMES = 80;
/** 정제소 안에서 가스를 뽑는 시간(프레임) — 이 동안 일꾼은 안 보인다. */
export const MINE_GAS_FRAMES = 37;
/** 자원에 붙는 딜레이(프레임, 어림) — 도착해서 캐기 시작하기까지. */
export const MINE_ATTACH_FRAMES = 11;
/** 자원에서 떨어지는 딜레이(프레임, 어림) — 캐기를 마치고 돌아서기까지. */
export const MINE_DETACH_FRAMES = 8;
/** 홀에 반납하는 딜레이(프레임, 어림) — 닿아서 되돌아서기까지. */
export const MINE_RETURN_FRAMES = 12;


/* ════════════════════════════════════════════════════════════════════════════
   12. 짓는 시간 — [DAT] units.dat BuildTime 실덤프
   ════════════════════════════════════════════════════════════════════════════ */

/** 짓는 데 걸리는 **프레임** 수. [DAT] units.dat BuildTime.
 *
 *  값은 heinermann/factorio-starcraft의 units.dat 전수 덤프에서 기계로 옮겼다 —
 *  덤프 항목과 이 파일의 이름은 (최대 체력, 실드, 치수) 짝으로 이었고, 97종이 유일하게
 *  맞았다(못 이은 다섯은 아래에 통설 값으로 따로 적었다).
 *
 *  ⚠ 초로 바꿀 때 눈금을 조심하라. 이 수는 프레임이고, 빠른 속도의 한 프레임은
 *    FRAME_SEC(1/23.81)다: 배럭 1200프레임 = 50.4초(빠름) = 80초(보통).
 *    커뮤니티 표에 흔히 적히는 '초'는 대개 **보통 속도**(프레임/15)라 1.6배 길다.
 *
 *  쓰는 곳: SCV 수리 속도(원작은 짓는 속도와 같은 속도로 고친다 — [OBW] order_Repair가
 *  target->hp_construction_rate를 그대로 더한다). */
export const BUILD_FRAMES: Record<string, number> = {
  /* (동률 해소) 아래 다섯은 (체력·치수) 열쇠가 덤프의 두 항목과 같아 기계로 못 갈랐다 —
     널리 아는 값으로 못 박는다(전부 '보통 속도 초 × 15'와 맞는다):
     마린 24초·메딕 30·인페스티드 테란 40·나이더스 커널 40·성큰 20. */
  Marine: 360, Medic: 450, "Infested Terran": 600, "Nydus Canal": 600, "Sunken Colony": 300,
  Ghost: 750,
  Vulture: 450,
  Goliath: 600,
  "Siege Tank (Tank Mode)": 750,
  "Siege Tank": 750,
  SCV: 300,
  Wraith: 900,
  "Science Vessel": 1200,
  Dropship: 750,
  Battlecruiser: 2000,
  "Spider Mine": 1,
  "Siege Tank (Siege Mode)": 750,
  Firebat: 360,
  Valkyrie: 750,
  Larva: 1,
  Egg: 1,
  Zergling: 420,
  Hydralisk: 420,
  Ultralisk: 900,
  Broodling: 1,
  Drone: 300,
  Overlord: 600,
  Mutalisk: 600,
  Guardian: 600,
  Queen: 750,
  Defiler: 750,
  Scourge: 450,
  Cocoon: 1,
  Devourer: 600,
  "Lurker Egg": 1,
  Lurker: 600,
  Corsair: 600,
  "Dark Templar": 750,
  "Dark Archon": 300,
  Probe: 300,
  Zealot: 600,
  Dragoon: 750,
  "High Templar": 750,
  Archon: 300,
  Shuttle: 900,
  Scout: 1200,
  Arbiter: 2400,
  Carrier: 2100,
  Interceptor: 300,
  Reaver: 1050,
  Observer: 600,
  Scarab: 105,
  "Command Center": 1800,
  "Comsat Station": 600,
  "Nuclear Silo": 1200,
  "Supply Depot": 600,
  Refinery: 600,
  Barracks: 1200,
  Academy: 1200,
  Factory: 1200,
  Starport: 1050,
  "Control Tower": 600,
  "Science Facility": 900,
  "Covert Ops": 600,
  "Physics Lab": 600,
  "Machine Shop": 600,
  "Engineering Bay": 900,
  Armory: 1200,
  "Missile Turret": 450,
  Bunker: 450,
  "Infested Command Center": 1800,
  Hatchery: 1800,
  Lair: 1500,
  Hive: 1800,
  "Hydralisk Den": 600,
  "Defiler Mound": 900,
  "Greater Spire": 1800,
  "Queen's Nest": 900,
  "Queens Nest": 900,
  "Evolution Chamber": 600,
  "Ultralisk Cavern": 1200,
  Spire: 1800,
  "Spawning Pool": 1200,
  "Creep Colony": 300,
  "Spore Colony": 300,
  Extractor: 600,
  Nexus: 1800,
  "Robotics Facility": 1200,
  Pylon: 450,
  Assimilator: 600,
  Observatory: 450,
  Gateway: 900,
  "Photon Cannon": 750,
  "Citadel of Adun": 900,
  "Cybernetics Core": 900,
  "Templar Archives": 900,
  Forge: 600,
  Stargate: 1050,
  "Fleet Beacon": 900,
  "Arbiter Tribunal": 900,
  "Robotics Support Bay": 450,
  "Shield Battery": 450,
};
/** 그 종류를 짓는 데 걸리는 초(빠른 속도) — 표에 없으면 0. */
export function buildSecOf(kind: string): number {
  const f = BUILD_FRAMES[kind];
  return f === undefined ? 0 : f * FRAME_SEC;
}

/** 유닛 몸 반지름(타일) — 크기 등급별 대표값이다. 지상 유닛 스프라이트 상자의
 *  가로 반폭 (left+1+right)/2 와 세로 반폭 (up+1+down)/2 를 평균해 32로 나눈 값의
 *  중앙값. 개체별 정확한 상자는 UNITS[].box에 픽셀로 있으니 정밀히 재려면
 *  bodyRadiusTiles()를 써라. */
export const BODY_R: Record<UnitSize, number> = {
  independent: 0.32, small: 0.33, medium: 0.45, large: 0.5,
};

/* ════════════════════════════════════════════════════════════════════════════
   11. 이동 물리 — [DAT] flingy.dat 실덤프. 5절의 "여기만 원전 대조가 안 됐다"를 메운다.

   5절이 쓰여질 때는 BWAPI가 flingy.dat 배열을 안 내놓아 걸음 속도가 전부 [추정]이었다.
   그 뒤 flingy.dat 209행 전수 덤프(heinermann/factorio-starcraft arr/flingy.lua)와
   units.dat의 Flingy 결합(227/228 검증)이 들어왔다. 그래서 이 절의 숫자는 [DAT]다.
   5절의 UNIT_SPEED는 옛 호출부가 아직 읽고 있어 남겨 두되, speedOfUnit이 이 표를
   먼저 본다 — 진실은 한 곳이어야 한다.

   ★ 이 절이 뒤집은 통념 하나: **원작 지상 주력은 가속이 아예 없다.**
   flingy.dat의 movement_type(아래 ctrl)이 2면 iscript가 몰고, 그때 엔진은 가속·정지거리
   필드를 아예 안 읽는다(bwgame.h unit_halt_distance가 movement_type!=0이면 0을 돌려주고,
   update_current_speed_towards_waypoint는 ctrl==2 가지에서 곧장 최고속을 꽂는다).
   마린·저글링·질럿·탱크·골리앗·드라군·히드라·울트라·러커·리버·다크템플러가 전부 그쪽이다.
   가속을 실제로 타는 것은 **공중 전부 + 일꾼 셋(SCV·드론·프로브) + 벌처 + 아콘·다크아콘
   + 하이템플러**뿐이다. 옛 설계가 "모든 유닛에 가속을 주자"고 했던 자리가 여기서 갈렸다.

   ctrl 값의 뜻:
     0 — flingy 구동. 가속·감속(halt_distance)이 .dat대로 산다. 진행 방향(course)이
         몸 방향과 따로 돌고 그 상한은 dat 값의 절반이다(unit_turn_rate).
     1 — flingy 구동이되 **halt_distance를 안 본다**. 가속은 붙지만 브레이크가 없어
         목적지에서 급정거한다. 하이템플러가 유일한 지상 사례다.
     2 — iscript 구동. 첫 틱부터 최고속이고 몸이 향한 쪽으로만 간다 — 회전이 곧 이동을
         막는다. course 상한은 반으로 안 깎인다.

   단위 환산(원전은 픽셀·프레임):
     타일/초  = px/프레임 × 23.81 ÷ 32
     타일/초² = px/프레임² × 23.81² ÷ 32
     도/초    = brad/프레임 × 1.40625 × 23.81
   최고속 도달 프레임 = top_speed_raw / accel_raw 이고, 여기 담은 값으로 다시 세면
   셔틀 3.293/1.177 = 2.80초(66.6프레임), 드랍십 4.069/1.177 = 3.46초(82.4프레임)로
   덤프의 framesToTopSpeed와 소수점까지 맞는다.
   ════════════════════════════════════════════════════════════════════════════ */

export type MoveDynUp = {
  /** 이 값을 켜는 업그레이드 이름. */
  name: string;
  top: number; accel: number; halt: number; turnCourse: number; turnBody: number;
};

export type MoveDyn = {
  /** flingy.dat movement_type. 2면 가속이 없다(즉발). */
  ctrl: 0 | 1 | 2;
  /** 최고 속도(타일/초). */
  top: number;
  /** 가속(타일/초²). **0이면 즉발이다** — 코어는 이 값이 0이면 가속 적분을 건너뛰어야 한다.
   *  감속도 같은 크기로 본다(정지거리 = v²/2a 가 벌처·SCV·레이스·전순 넷에서 소수점까지
   *  맞아떨어진 것이 그 근거다). */
  accel: number;
  /** 정지 거리(타일) — 목적지가 이 안에 들면 미리 줄인다. **0이면 브레이크가 없다**
   *  (ctrl 1·2가 그렇다). 업그레이드는 이 값을 안 건드린다 — 덤프의 수정 목록
   *  (get_modified_unit_speed / _acceleration / _turn_rate)에 halt_distance가 없다. */
  halt: number;
  /** 진행 방향(속도 벡터)이 도는 상한(도/초). ctrl 0·1은 dat 값의 절반이다. */
  turnCourse: number;
  /** 몸(스프라이트)이 도는 상한(도/초). */
  turnBody: number;
  up?: MoveDynUp;
};

/** 이동 물리 원장 — [DAT] flingy.dat × units.dat.
 *  회전값이 옛 TURN_RATE(130~380도/초)보다 서너 배 큰 것은 오타가 아니다. turn radius 40은
 *  프레임당 56.25도 = 초당 1339도라 마린은 사실상 즉시 돈다. 몸이 정말 느리게 도는 것은
 *  탱크(435)·골리앗(569)·리버/캐리어/오버로드류(670)뿐이고, 그 셋만 회전이 걸음을 막는다. */
export const MOVE_DYN: Record<string, MoveDyn> = {
  /* ── Terran ── */
  Marine: { ctrl: 2, top: 2.976, accel: 0, halt: 0, turnCourse: 1339.312, turnBody: 1339.312 },
  Ghost: { ctrl: 2, top: 2.976, accel: 0, halt: 0, turnCourse: 1339.312, turnBody: 1339.312 },
  Firebat: { ctrl: 2, top: 2.976, accel: 0, halt: 0, turnCourse: 1339.312, turnBody: 1339.312 },
  Medic: { ctrl: 2, top: 2.976, accel: 0, halt: 0, turnCourse: 1339.312, turnBody: 1339.312 },
  Goliath: { ctrl: 2, top: 3.4, accel: 0, halt: 0, turnCourse: 569.202, turnBody: 569.202 },
  "Siege Tank (Tank Mode)": { ctrl: 2, top: 2.976, accel: 0, halt: 0, turnCourse: 435.271, turnBody: 435.271 },
  "Siege Tank": { ctrl: 2, top: 2.976, accel: 0, halt: 0, turnCourse: 435.271, turnBody: 435.271 },
  "Siege Tank (Siege Mode)": { ctrl: 2, top: 0, accel: 0, halt: 0, turnCourse: 1339.312, turnBody: 1339.312 },
  "Spider Mine": { ctrl: 2, top: 11.905, accel: 0, halt: 0, turnCourse: 4252.323, turnBody: 4252.323 },
  Vulture: {
    ctrl: 0, top: 4.961, accel: 6.92, halt: 1.778, turnCourse: 669.656, turnBody: 1339.312,
    up: { name: "Ion Thrusters", top: 7.442, accel: 13.841, halt: 1.778, turnCourse: 1339.312, turnBody: 2678.625 },
  },
  SCV: { ctrl: 0, top: 3.72, accel: 4.637, halt: 1.492, turnCourse: 669.656, turnBody: 1339.312 },
  Wraith: { ctrl: 0, top: 4.961, accel: 4.637, halt: 2.654, turnCourse: 669.656, turnBody: 1339.312 },
  "Science Vessel": { ctrl: 0, top: 3.72, accel: 3.46, halt: 0.625, turnCourse: 669.656, turnBody: 1339.312 },
  Dropship: { ctrl: 0, top: 4.069, accel: 1.177, halt: 4.609, turnCourse: 334.816, turnBody: 669.656 },
  Valkyrie: { ctrl: 0, top: 4.912, accel: 4.498, halt: 2.673, turnCourse: 502.248, turnBody: 1004.496 },
  Battlecruiser: { ctrl: 0, top: 1.86, accel: 1.869, halt: 0.926, turnCourse: 334.816, turnBody: 669.656 },
  /* ── Zerg ── */
  Larva: { ctrl: 2, top: 0, accel: 0, halt: 0, turnCourse: 669.656, turnBody: 669.656 },
  Zergling: {
    ctrl: 2, top: 4.085, accel: 0, halt: 0, turnCourse: 904.042, turnBody: 904.042,
    up: { name: "Metabolic Boost", top: 6.127, accel: 0, halt: 0, turnCourse: 1808.072, turnBody: 1808.072 },
  },
  Hydralisk: {
    ctrl: 2, top: 2.723, accel: 0, halt: 0, turnCourse: 904.042, turnBody: 904.042,
    up: { name: "Muscular Augments", top: 4.085, accel: 0, halt: 0, turnCourse: 1808.072, turnBody: 1808.072 },
  },
  Ultralisk: {
    ctrl: 2, top: 3.81, accel: 0, halt: 0, turnCourse: 1339.312, turnBody: 1339.312,
    up: { name: "Anabolic Synthesis", top: 5.714, accel: 0, halt: 0, turnCourse: 2678.625, turnBody: 2678.625 },
  },
  Broodling: { ctrl: 2, top: 4.464, accel: 0, halt: 0, turnCourse: 904.042, turnBody: 904.042 },
  Defiler: { ctrl: 2, top: 2.976, accel: 0, halt: 0, turnCourse: 904.042, turnBody: 904.042 },
  "Infested Terran": { ctrl: 2, top: 4.33, accel: 0, halt: 0, turnCourse: 1339.312, turnBody: 1339.312 },
  /** 러커의 이동 속도 업그레이드는 **연구가 없다** — update_unit_speed_upgrades가 러커의
   *  속도 플래그를 늘 켠 채로 둔다(덤프의 speedUpgrade 칸에 그 사실이 적혀 있다).
   *  그래서 base가 4.33이 아니라 처음부터 6.496 타일/초다. up 칸을 비운 이유가 이것이다. */
  Lurker: { ctrl: 2, top: 6.496, accel: 0, halt: 0, turnCourse: 2678.625, turnBody: 2678.625 },
  Drone: { ctrl: 0, top: 3.72, accel: 4.637, halt: 1.492, turnCourse: 669.656, turnBody: 1339.312 },
  Overlord: {
    ctrl: 0, top: 0.619, accel: 1.869, halt: 0.102, turnCourse: 334.816, turnBody: 669.656,
    /* 오버로드만 속업 배수가 1.5가 아니라 **4.0**이다 — get_modified_unit_speed가 결과를
       3+1/3 px/frame 아래로 못 내려가게 바닥을 깔아 두는데, 오버로드의 원속(0.83)이 그
       바닥보다 훨씬 낮아 배수가 아니라 바닥값이 그대로 걸린다. SPEED_UP_MULT 1.5로는
       못 내는 값이라 여기서만 바로잡힌다. */
    up: { name: "Pneumatized Carapace", top: 2.48, accel: 3.737, halt: 0.102, turnCourse: 669.656, turnBody: 1339.312 },
  },
  Mutalisk: { ctrl: 0, top: 4.961, accel: 4.637, halt: 2.654, turnCourse: 669.656, turnBody: 1339.312 },
  Guardian: { ctrl: 0, top: 1.86, accel: 1.869, halt: 0.926, turnCourse: 334.816, turnBody: 669.656 },
  Devourer: { ctrl: 0, top: 3.72, accel: 3.322, halt: 2.083, turnCourse: 502.248, turnBody: 1004.496 },
  Queen: { ctrl: 0, top: 4.961, accel: 4.637, halt: 2.654, turnCourse: 669.656, turnBody: 1339.312 },
  Scourge: { ctrl: 0, top: 4.961, accel: 7.405, halt: 1.662, turnCourse: 669.656, turnBody: 1339.312 },
  /* ── Protoss ── */
  Zealot: {
    ctrl: 2, top: 2.976, accel: 0, halt: 0, turnCourse: 1339.312, turnBody: 1339.312,
    up: { name: "Leg Enhancements", top: 4.464, accel: 0, halt: 0, turnCourse: 2678.625, turnBody: 2678.625 },
  },
  Dragoon: { ctrl: 2, top: 3.72, accel: 0, halt: 0, turnCourse: 1339.312, turnBody: 1339.312 },
  "Dark Templar": { ctrl: 2, top: 3.661, accel: 0, halt: 0, turnCourse: 1339.312, turnBody: 1339.312 },
  Reaver: { ctrl: 2, top: 1.324, accel: 0, halt: 0, turnCourse: 669.656, turnBody: 669.656 },
  Scarab: { ctrl: 2, top: 11.905, accel: 0, halt: 0, turnCourse: 904.042, turnBody: 904.042 },
  /** 하이템플러만 ctrl 1이다 — 가속은 타는데 halt_distance를 안 봐서 **브레이크가 없다.**
   *  목적지에서 속도를 안 줄이고 그대로 멈춘다. 덤프의 usesHaltDistance=false가 그 뜻이다. */
  "High Templar": { ctrl: 1, top: 2.479, accel: 1.869, halt: 0, turnCourse: 669.656, turnBody: 1339.312 },
  /* 아콘·다크아콘은 ctrl 0이라 가속이 산다. 다만 11.07 타일/초²라 8프레임이면 최고속이다. */
  Archon: { ctrl: 0, top: 3.72, accel: 11.073, halt: 0.625, turnCourse: 669.656, turnBody: 1339.312 },
  "Dark Archon": { ctrl: 0, top: 3.72, accel: 11.073, halt: 0.625, turnCourse: 669.656, turnBody: 1339.312 },
  Probe: { ctrl: 0, top: 3.72, accel: 4.637, halt: 1.492, turnCourse: 669.656, turnBody: 1339.312 },
  Shuttle: {
    ctrl: 0, top: 3.293, accel: 1.177, halt: 4.609, turnCourse: 334.816, turnBody: 669.656,
    up: { name: "Gravitic Drive", top: 4.94, accel: 2.353, halt: 4.609, turnCourse: 669.656, turnBody: 1339.312 },
  },
  Observer: {
    ctrl: 0, top: 2.479, accel: 1.869, halt: 1.645, turnCourse: 334.816, turnBody: 669.656,
    up: { name: "Gravitic Boosters", top: 3.719, accel: 3.737, halt: 1.645, turnCourse: 669.656, turnBody: 1339.312 },
  },
  Scout: {
    ctrl: 0, top: 3.72, accel: 3.322, halt: 2.083, turnCourse: 502.248, turnBody: 1004.496,
    /* 스카웃 속업만 배수가 1.5가 아니다 — get_modified_unit_speed가 스카웃류를 정확히
       6+2/3 px/frame에 못 박아서 3.72 → 4.96(×1.33)이 된다. */
    up: { name: "Gravitic Thrusters", top: 4.96, accel: 6.644, halt: 2.083, turnCourse: 1004.484, turnBody: 2008.969 },
  },
  Corsair: { ctrl: 0, top: 4.961, accel: 4.637, halt: 2.083, turnCourse: 502.248, turnBody: 1004.496 },
  Arbiter: { ctrl: 0, top: 3.72, accel: 2.284, halt: 3.03, turnCourse: 669.656, turnBody: 1339.312 },
  Carrier: { ctrl: 0, top: 2.479, accel: 1.869, halt: 1.645, turnCourse: 334.816, turnBody: 669.656 },
  Interceptor: { ctrl: 0, top: 9.92, accel: 29.55, halt: 1.665, turnCourse: 669.656, turnBody: 1339.312 },
};

/** 이 저장소의 업그레이드 표기와 원전 표기가 갈리는 둘.
 *  파서(replayTechNames.UPGRADE_NAMES)는 단수형 "Leg Enhancement"·"Gravitic Booster"로
 *  담는데 위 표와 SPEED_UP_OF는 원전 표기인 복수형을 쓴다. 이 자리를 안 이으면 질럿
 *  속업·옵저버 속업이 **한 번도 반영되지 않는다** — HEAD에서도 그랬다(옛 SPEED_UP_OF가
 *  같은 복수형이었다). 표는 원전 표기로 두고 읽는 쪽에서 잇는 편이, 표를 프로젝트 표기로
 *  고쳐 원전 대조를 흐리는 것보다 낫다고 봤다. */
export const UPGRADE_ALIASES: Record<string, string> = {
  "Leg Enhancement": "Leg Enhancements",
  "Gravitic Booster": "Gravitic Boosters",
};

/** 업그레이드 목록에 그 이름이 있는가 — 위 별칭까지 함께 본다. */
export function upsHasUpgrade(ups: Set<string> | string[], name: string): boolean {
  const inList = (n: string): boolean =>
    (Array.isArray(ups) ? ups.includes(n) : ups.has(n));
  if (inList(name)) return true;
  for (const [alias, canon] of Object.entries(UPGRADE_ALIASES)) {
    if (canon === name && inList(alias)) return true;
    if (alias === name && inList(canon)) return true;
  }
  return false;
}

/** 그 유닛의 이동 물리 — 표에 없으면 null이다(지어낸 값을 돌려주지 않는다).
 *  null을 받은 쪽은 speedOfUnit + TURN_RATE의 옛 등속 걸음으로 떨어지면 된다.
 *  덤프에 없는 것은 알·고치·건물처럼 애초에 안 걷는 것들이다. */
export function moveDynOf(unit: string, ups?: Set<string> | string[]): MoveDyn | null {
  const d = MOVE_DYN[unit];
  if (!d) return null;
  if (!d.up || !ups) return d;
  if (!upsHasUpgrade(ups, d.up.name)) return d;
  return {
    ctrl: d.ctrl, top: d.up.top, accel: d.up.accel, halt: d.up.halt,
    turnCourse: d.up.turnCourse, turnBody: d.up.turnBody,
  };
}

/** 가속을 타는가 — false면 코어는 첫 틱부터 최고속을 꽂아야 한다.
 *  표에 없는 유닛은 옛 등속 걸음이 곧 즉발이므로 false다. */
export const acceleratesOf = (unit: string): boolean => (MOVE_DYN[unit]?.accel ?? 0) > 0;

/** 최고속에 닿기까지 걸리는 초 — 즉발이면 0. 검산용이자 코어의 램프 길이다. */
export function timeToTopSpeed(unit: string, ups?: Set<string> | string[]): number {
  const d = moveDynOf(unit, ups);
  if (!d || d.accel <= 0) return 0;
  return d.top / d.accel;
}

/* ════════════════════════════════════════════════════════════════════════════
   12. 버로우·벙커 부속 — 8절에 없던 나머지.

   8절이 이미 내보내는 것(LURKER_REHIT_FRAMES · LURKER_SPINE_TRAVEL_PX ·
   LURKER_SPINE_SPEED_PX · UNBURROW_MIN_FRAMES · BUNKER_RANGE_PX ·
   BUNKER_ACQUIRE_TILES · BUNKER_SHOOTERS)은 여기서 다시 만들지 않는다.
   러커 가시의 사거리를 찾는다면 WEAPONS.Subterranean_Spines.rangePx(192px = 6타일)가
   그 값이다 — 따로 둔 LURKER_SPINE.range 같은 이름은 만들지 않았다. 같은 숫자가 두 곳에
   있으면 반드시 한 곳이 뒤처진다는 것이 이번 병합에서 배운 것이다.
   스플래시 안쪽 반경도 마찬가지다. 땅속 표적이 전액을 받는 그 '안쪽 링'은
   Weapon.splashPx[0]이다 — inner 라는 별도 칸을 더하지 않았다.
   ════════════════════════════════════════════════════════════════════════════ */

/** 버로우할 수 있는 정체 — [DAT] units.dat flag_can_burrow.
 *  영웅 셋(Unclean One·Hunter Killer·Devouring One)은 이 프로젝트 이름표에 안 나와 뺐다. */
export const BURROW_UNITS = new Set([
  "Zergling", "Hydralisk", "Drone", "Defiler", "Infested Terran", "Lurker",
]);

/** 버로우가 끝나기까지의 하한(프레임) — 서 있고 이미 그 방향을 볼 때 2틱 = 18프레임.
 *  걷다가 들어가면 감속·회전만큼 더 걸린다. UNBURROW_MIN_FRAMES(36)와 짝이다. */
export const BURROW_MIN_FRAMES = 2 * ORDER_PROCESS_FRAMES;

/** 벙커 자리 수 — [DAT] units.dat space_provided. */
export const BUNKER_SEATS = 4;
/** 벙커에 **탈** 수 있는 정체. 쏘는 것은 BUNKER_SHOOTERS 셋뿐이고, 메딕·SCV는 타기만 한다. */
export const BUNKER_LOADABLE = new Set(["Marine", "Firebat", "Ghost", "Medic", "SCV"]);

/** 디텍터 — 땅속·은신한 것은 이들이 곁에 있어야 표적이 된다. [DAT] unitFlags Detector 비트.
 *  탐지 거리를 상수로 두지 않은 것은 원작이 유닛마다 다른 시야를 그대로 쓰기 때문이다
 *  (옵저버 9 · 오버로드 9 · 베슬 10 · 캐논 11 · 터렛 11). sightTiles(정체)를 써라 —
 *  일률 9타일로 뭉개면 캐논·터렛의 탐지 범위가 2타일 줄어든다. */
export const DETECTOR_KINDS = new Set(
  Object.entries(UNITS).filter(([, v]) => v.detector).map(([k]) => k),
);
