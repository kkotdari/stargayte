// 리플레이의 기술(Tech)·업그레이드(Upgrade) 이름 — screp이 내려주는 영문 키를 한 곳에 모은다.
//
// 왜 따로 두나: 이 이름들을 코드 곳곳에서 문자열 리터럴로 적어 쓰다가 조용히 안 맞는 사고가
// 실제로 여러 건 있었다(지적으로 발견).
//   · "Cloaking Field"를 업그레이드로 찾고 있었다 — 그건 업그레이드가 아니라 기술이라
//     upgradeNames에는 영원히 없다. 클로킹 레이스 전술이 한 번도 안 떴다.
//   · "Ventral Sacs" / "Pneumatized Carapace"로 찾고 있었다 — screp의 실제 이름은
//     "Ventral Sacs (Overlord Transport)"처럼 괄호 설명이 붙어 있어서, 배열의 정확 일치
//     검사(Array.includes)가 늘 false였다. 오버로드 드랍·산개 판정이 죽어 있었다.
//   · DECISIVE_TECHS에 있던 "Cloaking"은 아예 존재하지 않는 이름이었다.
// 셋 다 타입이 string이라 컴파일러가 못 잡아 줬다. 그래서 이름을 여기 상수로 못 박고
// 타입(TechName/UpgradeName)으로 좁혀, 오타나 잘못된 갈래는 컴파일 단계에서 걸리게 한다.
//
// 목록은 screp(icza/screp)의 Techs/Upgrades enum에서 그대로 뽑았다.

/** 요약이 말할 수 있는 능력 — screp Techs enum(0~34) + 핵 발사(아래 주석 참고). */
export const TECH_NAMES = [
  "Stim Packs", "Lockdown", "EMP Shockwave", "Spider Mines", "Scanner Sweep",
  "Tank Siege Mode", "Defensive Matrix", "Irradiate", "Yamato Gun", "Cloaking Field",
  "Personnel Cloaking", "Burrowing", "Infestation", "Spawn Broodlings", "Dark Swarm",
  "Plague", "Consume", "Ensnare", "Parasite", "Psionic Storm",
  "Hallucination", "Recall", "Stasis Field", "Archon Warp", "Restoration",
  "Disruption Web", "Mind Control", "Dark Archon Meld", "Feedback", "Optical Flare",
  "Maelstrom", "Lurker Aspect", "Healing",
  /* 핵 발사 — screp의 Techs enum(0~34)에는 없다. 핵은 연구가 아니라 고스트가 내리는
     명령(Order "CastNuclearStrike")이라 screp이 Tech로 세지 않기 때문이다(실측:
     screp-js의 Techs 표에 Nuclear 항목이 없다). 그래서 여기 목록은 이제 "screp Techs
     enum 그대로"가 아니라 "요약이 말할 수 있는 능력들"이고, 핵만 그 예외다 — 아래
     CAST_ORDER_TO_TECH가 그 명령을 이 이름으로 받아 준다. 이렇게 두면 순위(TECH_RANK)·
     한국어 이름·시전 좌표(castPositions)까지 다른 마법과 똑같은 길을 탄다. */
  "Nuclear Strike",
] as const;
export type TechName = (typeof TECH_NAMES)[number];

/** 업그레이드 — screp Upgrades enum(50개)에서 괄호 설명을 뗀 이름.
 *
 *  screp은 "U-238 Shells (Marine Range)"처럼 괄호로 무엇에 쓰는지 덧붙여 준다. 사람이 읽기엔
 *  좋지만 코드에서 비교하기엔 길고 틀리기 쉬워서, 파서가 받아 담을 때 괄호를 떼고
 *  (normalizeUpgradeName) 여기 이름으로 통일한다. */
export const UPGRADE_NAMES = [
  // 공/방 — 같은 이름이 단계마다 한 번씩 더 온다(1→2→3단계로 세 번).
  "Terran Infantry Armor", "Terran Vehicle Plating", "Terran Ship Plating",
  "Zerg Carapace", "Zerg Flyer Carapace", "Protoss Ground Armor", "Protoss Air Armor",
  "Terran Infantry Weapons", "Terran Vehicle Weapons", "Terran Ship Weapons",
  "Zerg Melee Attacks", "Zerg Missile Attacks", "Zerg Flyer Attacks",
  "Protoss Ground Weapons", "Protoss Air Weapons", "Protoss Plasma Shields",
  // 사거리·속도 등 한 번뿐인 것들.
  "U-238 Shells", "Ion Thrusters", "Titan Reactor", "Ocular Implants", "Moebius Reactor",
  "Apollo Reactor", "Colossus Reactor", "Ventral Sacs", "Antennae", "Pneumatized Carapace",
  "Metabolic Boost", "Adrenal Glands", "Muscular Augments", "Grooved Spines",
  "Gamete Meiosis", "Defiler Energy", "Singularity Charge", "Leg Enhancement",
  "Scarab Damage", "Reaver Capacity", "Gravitic Drive", "Sensor Array", "Gravitic Booster",
  "Khaydarin Amulet", "Apial Sensors", "Gravitic Thrusters", "Carrier Capacity",
  "Khaydarin Core", "Argus Jewel", "Argus Talisman", "Caduceus Reactor",
  "Chitinous Plating", "Anabolic Synthesis", "Charon Boosters",
] as const;
export type UpgradeName = (typeof UPGRADE_NAMES)[number];

/** screp이 준 업그레이드 이름에서 괄호 설명을 뗀다 — "Ion Thrusters (Vulture Speed)" →
 *  "Ion Thrusters". 괄호가 없는 이름(공/방 등)은 그대로다. */
export function normalizeUpgradeName(raw: string): string {
  const i = raw.indexOf(" (");
  return (i === -1 ? raw : raw.slice(0, i)).trim();
}

/** 공/방 업그레이드 — 한 번 연구할 때마다 한 단계씩 오르므로, 같은 이름이 나온 횟수가
 *  곧 단계다(최대 3). "3-3 풀업"을 말하려면 무기/방어를 짝지어 봐야 해서 종족별로 묶어 둔다. */
export const ARMOR_WEAPON_PAIRS: Record<string, { weapon: UpgradeName; armor: UpgradeName }[]> = {
  테란: [
    { weapon: "Terran Infantry Weapons", armor: "Terran Infantry Armor" },
    { weapon: "Terran Vehicle Weapons", armor: "Terran Vehicle Plating" },
    { weapon: "Terran Ship Weapons", armor: "Terran Ship Plating" },
  ],
  저그: [
    { weapon: "Zerg Melee Attacks", armor: "Zerg Carapace" },
    { weapon: "Zerg Missile Attacks", armor: "Zerg Carapace" },
    { weapon: "Zerg Flyer Attacks", armor: "Zerg Flyer Carapace" },
  ],
  프로토스: [
    { weapon: "Protoss Ground Weapons", armor: "Protoss Ground Armor" },
    { weapon: "Protoss Air Weapons", armor: "Protoss Air Armor" },
  ],
};

/** 그 종족의 공/방 묶음이 무엇을 굴리는 업그레이드인지 — "지상 3-3", "공중 2-2"처럼 부른다. */
export const UPGRADE_LINE_KO: Record<string, string> = {
  "Terran Infantry Weapons": "보병",
  "Terran Vehicle Weapons": "메카닉",
  "Terran Ship Weapons": "공중",
  // 저그는 지상 공격이 근접(저글링·울트라)과 원거리(히드라)로 갈린다 — 둘 다 "지상"이라
  // 부르면 한 사람에게 같은 이름이 두 줄 나온다. 실제로 부르는 대로 나눠 적는다.
  "Zerg Melee Attacks": "저글링",
  "Zerg Missile Attacks": "히드라",
  "Zerg Flyer Attacks": "공중",
  "Protoss Ground Weapons": "지상",
  "Protoss Air Weapons": "공중",
};

/** 그 자체로 이야깃거리가 되는 '상징 업그레이드' — 속업·사업처럼 이름만 대도 그림이 그려지는
 *  것들만. 흔하다고 다 빼지는 않는다(저글링 속업은 거의 다 하지만 '언제' 했는지가 곧 판이다). */
export const SIGNATURE_UPGRADE_KO: Partial<Record<UpgradeName, string>> = {
  "Metabolic Boost": "저글링 속업",
  "Adrenal Glands": "저글링 아드레날린",
  "Muscular Augments": "히드라 속업",
  "Grooved Spines": "히드라 사업",
  "Pneumatized Carapace": "오버로드 속업",
  "Ventral Sacs": "오버로드 수송",
  "Chitinous Plating": "울트라 방업",
  "Anabolic Synthesis": "울트라 속업",
  "U-238 Shells": "마린 사업",
  "Ion Thrusters": "벌처 속업",
  "Charon Boosters": "골리앗 사업",
  "Singularity Charge": "드라군 사업",
  "Leg Enhancement": "질럿 속업",
  "Gravitic Drive": "셔틀 속업",
  "Carrier Capacity": "캐리어 인터셉터 증설",
  "Reaver Capacity": "리버 스캐럽 증설",
  "Scarab Damage": "스캐럽 공업",
  "Khaydarin Amulet": "템플러 에너지업",
  // 아래는 '나오면 그 판의 방향이 보이는' 것들 — 옵저버 속업은 클로킹 싸움, 디파일러·
  // 다크아콘 에너지업은 마법을 주력으로 쓰겠다는 선언이다(요청: 유의미한 업그레이드 진술).
  "Gravitic Booster": "옵저버 속업",
  "Sensor Array": "옵저버 시야업",
  "Gravitic Thrusters": "스카웃 속업",
  "Apial Sensors": "스카웃 시야업",
  "Argus Talisman": "다크아콘 에너지업",
  "Argus Jewel": "커세어 에너지업",
  "Defiler Energy": "디파일러 에너지업",
  "Khaydarin Core": "아비터 에너지업",
  "Gamete Meiosis": "퀸 에너지업",
  "Moebius Reactor": "고스트 에너지업",
  "Ocular Implants": "고스트 시야업",
  "Titan Reactor": "베슬 에너지업",
  "Caduceus Reactor": "메딕 에너지업",
  "Apollo Reactor": "레이스 에너지업",
  "Colossus Reactor": "배틀크루저 에너지업",
  Antennae: "오버로드 시야업",
};

/** 그 업그레이드가 꾸미는 유닛과, 유닛 이름 앞에 붙일 딱지(요청: 업그레이드는 그 유닛이
 *  나올 때 같이 덧붙여도 된다).
 *
 *  스타에서 실제로 쓰는 말이 그렇다 — "속업 저글링", "사업 히드라", "발업 질럿". 따로 한
 *  문장을 세우는 것보다 이렇게 붙이는 편이 짧고, 자리도 아끼고, 무엇보다 그 병력이 어떤
 *  물건이었는지가 한눈에 읽힌다. 유닛 이름은 screp의 영문명이다. */
export const UNIT_UPGRADE_TAG: Partial<Record<UpgradeName, { unit: string; tag: string }>> = {
  "Metabolic Boost": { unit: "Zergling", tag: "속업" },
  "Adrenal Glands": { unit: "Zergling", tag: "아드레날린" },
  "Muscular Augments": { unit: "Hydralisk", tag: "속업" },
  "Grooved Spines": { unit: "Hydralisk", tag: "사업" },
  "Chitinous Plating": { unit: "Ultralisk", tag: "방업" },
  "Anabolic Synthesis": { unit: "Ultralisk", tag: "속업" },
  "Pneumatized Carapace": { unit: "Overlord", tag: "속업" },
  "Ventral Sacs": { unit: "Overlord", tag: "수송업" },
  "Defiler Energy": { unit: "Defiler", tag: "에너지업" },
  "Gamete Meiosis": { unit: "Queen", tag: "에너지업" },
  "U-238 Shells": { unit: "Marine", tag: "사업" },
  "Ion Thrusters": { unit: "Vulture", tag: "속업" },
  "Charon Boosters": { unit: "Goliath", tag: "사업" },
  "Moebius Reactor": { unit: "Ghost", tag: "에너지업" },
  "Titan Reactor": { unit: "Science Vessel", tag: "에너지업" },
  "Apollo Reactor": { unit: "Wraith", tag: "에너지업" },
  "Colossus Reactor": { unit: "Battlecruiser", tag: "에너지업" },
  "Singularity Charge": { unit: "Dragoon", tag: "사업" },
  "Leg Enhancement": { unit: "Zealot", tag: "속업" },
  "Gravitic Drive": { unit: "Shuttle", tag: "속업" },
  "Khaydarin Amulet": { unit: "High Templar", tag: "에너지업" },
  "Khaydarin Core": { unit: "Arbiter", tag: "에너지업" },
  "Argus Talisman": { unit: "Dark Archon", tag: "에너지업" },
  "Argus Jewel": { unit: "Corsair", tag: "에너지업" },
  "Gravitic Booster": { unit: "Observer", tag: "속업" },
  "Gravitic Thrusters": { unit: "Scout", tag: "속업" },
};

/** 상징 업그레이드의 '이야깃거리 점수' — TECH_RANK와 같은 뜻이다(클수록 먼저 말한다).
 *
 *  기준은 '그 업그레이드가 판을 바꾸나'다(지적으로 바로잡은 순서).
 *   · 속업·사업(이동속도·사거리)이 가장 높다. 병력의 성능 자체가 달라져서, 언제 찍었느냐로
 *     그 판의 싸움이 갈린다 — 발업 저글링과 안 된 저글링은 다른 유닛이다.
 *   · 오버로드 수송·셔틀 속업처럼 '무엇을 하겠다'는 선언이 그다음이다.
 *   · 에너지업·시야업이 가장 낮다. 그 유닛을 오래 쓰면 으레 따라오는 것이라 판을 바꾸지
 *     않는다(지적: 템플러·다크아콘·아비터·디파일러 에너지업은 낮은 축이다).
 *
 *  여기 없는 것은 0점이고, 0점짜리는 아예 문장이 되지 않는다(replaySummary의
 *  UPGRADE_MIN_RANK). 캐리어 인터셉터 증설과 리버 스캐럽 증설이 그렇다 — 그 유닛을 쓰면
 *  으레 따라오는 것이라 "무슨 일이 있었나"를 말해 주지 않는다(지적). */
export const UPGRADE_RANK: Partial<Record<UpgradeName, number>> = {
  // 병력의 성능 자체가 달라지는 것들 — 속업·사업.
  "Metabolic Boost": 6, "Adrenal Glands": 6, "Muscular Augments": 6, "Grooved Spines": 6,
  "Singularity Charge": 6, "Leg Enhancement": 6, "Ion Thrusters": 6, "Charon Boosters": 6,
  "U-238 Shells": 6, "Anabolic Synthesis": 6, "Chitinous Plating": 6,
  // '무엇을 하겠다'는 선언 — 드랍을 가겠다, 옵저버로 훑겠다.
  "Ventral Sacs": 4, "Gravitic Drive": 4, "Gravitic Booster": 4, "Gravitic Thrusters": 4,
  "Pneumatized Carapace": 4, "Scarab Damage": 4,
  // 오래 쓰면 으레 따라오는 것들 — 에너지업·시야업.
  "Khaydarin Amulet": 2, "Khaydarin Core": 2, "Argus Talisman": 2, "Argus Jewel": 2,
  "Defiler Energy": 2, "Gamete Meiosis": 2, "Moebius Reactor": 2, "Titan Reactor": 2,
  "Colossus Reactor": 2, "Apollo Reactor": 2, "Caduceus Reactor": 2,
  "Sensor Array": 2, "Apial Sensors": 2, "Ocular Implants": 2, Antennae: 2,
};

/** 기술의 '이야깃거리 점수' — 클수록 요약에서 먼저 말한다.
 *
 *  예전에는 정해둔 집합에서 "먼저 연구한 것 하나"를 골랐다. 그러면 거의 모든 테란 경기가
 *  스팀팩으로 채워졌다 — 스팀팩은 안 하는 사람이 없어서 '무슨 일이 있었나'를 말해 주지
 *  않는다. 드물게 나오는 기술일수록 그 경기의 그림이므로, 흔한 것은 낮게 둔다.
 *  여기 없는 기술은 요약에 안 쓴다(스캐너·디펜시브 매트릭스처럼 연구가 아예 없는 것 포함). */
export const TECH_RANK: Partial<Record<TechName, number>> = {
  // 나오면 그 경기의 하이라이트가 되는 것들.
  // 핵은 한 경기에 한두 번 나올까 말까라 나오면 그 경기의 이야기다 — 가장 위에 둔다.
  "Nuclear Strike": 10,
  "Mind Control": 10, Maelstrom: 9, "Spawn Broodlings": 9, "Disruption Web": 9,
  "Optical Flare": 8, Restoration: 8, Hallucination: 8,
  // 판을 가르는 주력 마법·능력.
  "Psionic Storm": 7, "Yamato Gun": 7, "Stasis Field": 7, Plague: 7, Recall: 7,
  Irradiate: 6, Lockdown: 6, Consume: 6, Ensnare: 6, "EMP Shockwave": 6,
  "Dark Swarm": 5, "Lurker Aspect": 5,
  // 흔하지만 언급할 값은 있는 것들 — 위가 하나도 없을 때만 나온다.
  "Cloaking Field": 4, "Personnel Cloaking": 4,
  "Spider Mines": 2, Burrowing: 2, "Stim Packs": 1, "Tank Siege Mode": 1,
};

/** 아래 조회 헬퍼들이 받는 최소한의 신호 — replayParser의 ReplayPlayerSignals가 그대로 들어온다.
 *  파서를 되import하면 순환이 되므로 필요한 필드만 구조로 받는다. */
export interface TechSignalsLike {
  techNames: string[];
  upgradeNames: string[];
  firstTechFrame: Record<string, number>;
  firstUpgradeFrame: Record<string, number>;
  /** 기술 이름 → 실제로 쓴 횟수. 연구만 하고 안 썼으면 아예 없다. */
  techUses: Record<string, number>;
  /** 기술 이름 → 처음 쓴 프레임. */
  firstTechUseFrame: Record<string, number>;
}

/** 이 기술을 연구했나. 이름이 TechName으로 좁혀져 있어, 없는 이름이나 업그레이드 이름을
 *  잘못 넣으면 컴파일이 안 된다(예전에 "Cloaking"·"Cloaking Field"로 헛돌던 자리들). */
export function hasTech(s: TechSignalsLike, name: TechName): boolean {
  return s.techNames.includes(name);
}

/** 이 업그레이드를 했나 — 단계는 안 본다(1단계라도 true). */
export function hasUpgrade(s: TechSignalsLike, name: UpgradeName): boolean {
  return s.upgradeNames.includes(name);
}

/** 이 업그레이드를 몇 단계까지 올렸나 — 공/방은 한 단계마다 커맨드가 한 번씩 오므로
 *  나온 횟수가 곧 단계다. 한 번뿐인 업그레이드(속업 등)는 0 또는 1.
 *
 *  파서가 연타를 이미 걸러 주지만(RESEARCH_DEDUPE_FRAMES), 연구를 취소했다 한참 뒤에
 *  다시 시작한 경우까지는 못 가른다 — 브루드워에 4단계는 없으니 3에서 자른다. */
export function upgradeLevel(s: TechSignalsLike, name: UpgradeName): number {
  let n = 0;
  for (const u of s.upgradeNames) if (u === name) n += 1;
  return Math.min(n, MAX_UPGRADE_LEVEL);
}

/** 브루드워 공/방 업그레이드의 최고 단계. */
export const MAX_UPGRADE_LEVEL = 3;

/** 이 기술을 처음 연구한 프레임(안 했으면 null). */
export function techFrame(s: TechSignalsLike, name: TechName): number | null {
  return s.firstTechFrame[name] ?? null;
}

/** 이 업그레이드를 처음 누른 프레임(안 했으면 null) — 공/방이면 1단계 시점이다. */
export function upgradeFrame(s: TechSignalsLike, name: UpgradeName): number | null {
  return s.firstUpgradeFrame[name] ?? null;
}

/** 이 사람이 연구한 기술 중 가장 이야깃거리가 되는 것 하나 — TECH_RANK가 큰 쪽.
 *  같은 점수면 먼저 연구한 것을 고른다(그 경기에서 더 이른 결정이라서). */
export function topTech(s: TechSignalsLike): TechName | null {
  let best: TechName | null = null;
  let bestRank = 0;
  for (const raw of s.techNames) {
    const name = raw as TechName;
    const rank = TECH_RANK[name] ?? 0;
    if (rank > bestRank) { bestRank = rank; best = name; }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// "썼나" — 연구했다는 사실만으로는 아무 일도 안 일어난 것이다(지적).
//
// 실제 리플레이에서 확인한 예: 한 사람이 마인드컨트롤·디스럽션웹·스톰을 전부 연구해
// 놓고, 정작 쓴 것은 디스럽션웹 네 번뿐이었다(마인드컨트롤·스톰은 0회). 또 다른 사람은
// 스톰과 할루시네이션을 연구하고 한 번도 안 썼다. 연구만 보고 "스톰까지 꺼내 썼다"고
// 하면 없던 일을 지어내는 셈이다.
//
// 무엇이 '썼다'의 증거인지는 기술마다 다르다.
//   · 마법: 표적 명령의 Order가 Cast… 로 온다(CastPsionicStorm 등).
//   · 시즈/버로우/클로킹/스팀: 전용 커맨드가 따로 있다(Siege, Burrow, Cloack, Stim).
//   · 마인: 심는 순간 Order가 PlaceMine이다.
//   · 럴커·아콘류: 변태·합체라 유닛 수(unitCounts)가 곧 증거라 여기서 다루지 않는다.
// ─────────────────────────────────────────────────────────────────────────────

/** 마법 사용 Order 이름 → 그 기술. screp Orders enum의 Cast… 계열이다. */
export const CAST_ORDER_TO_TECH: Record<string, TechName> = {
  CastPsionicStorm: "Psionic Storm",
  CastLockdown: "Lockdown",
  CastEMPShockwave: "EMP Shockwave",
  CastIrradiate: "Irradiate",
  FireYamatoGun: "Yamato Gun",
  CastDefensiveMatrix: "Defensive Matrix",
  CastScannerSweep: "Scanner Sweep",
  CastRestoration: "Restoration",
  CastOpticalFlare: "Optical Flare",
  CastDarkSwarm: "Dark Swarm",
  CastPlague: "Plague",
  CastConsume: "Consume",
  CastEnsnare: "Ensnare",
  CastParasite: "Parasite",
  CastSpawnBroodlings: "Spawn Broodlings",
  CastInfestation: "Infestation",
  CastRecall: "Recall",
  CastStasisField: "Stasis Field",
  CastHallucination: "Hallucination",
  CastDisruptionWeb: "Disruption Web",
  CastMindControl: "Mind Control",
  CastFeedback: "Feedback",
  CastMaelstrom: "Maelstrom",
  MedicHeal: "Healing",
  // 핵 — 위 TECH_NAMES 주석 참고. 이 한 줄이 없어서 "핵 쐈다"가 요약에 통째로 안
  // 나왔다(지적) — 연구가 아니라 명령이라 techNames로도 안 잡혔다.
  CastNuclearStrike: "Nuclear Strike",
};

/** 마법이 아닌 능력 — 전용 커맨드 이름(screp Types)이 곧 사용 증거다. */
export const USE_CMD_TO_TECH: Record<string, TechName> = {
  Siege: "Tank Siege Mode",
  Burrow: "Burrowing",
  Cloack: "Personnel Cloaking", // 고스트/레이스 공용 커맨드 — 아래에서 종족·유닛으로 가른다
  Stim: "Stim Packs",
};

/** 마인은 심는 순간의 Order로 잡는다. */
export const PLACE_MINE_ORDER = "PlaceMine";

/** 이 기술을 실제로 몇 번 썼나 — 0이면 연구만 하고 안 쓴 것이다. */
export function techUseCount(s: TechSignalsLike, name: TechName): number {
  return s.techUses[name] ?? 0;
}

/** 실제로 쓴 기술 중 가장 이야깃거리가 되는 것 — 안 쓴 것은 아예 후보가 아니다.
 *
 *  드묾(TECH_RANK)만 보면 안 된다. 실제 리플레이에서 시즈모드를 49번 쓰고 마인을 2번 깐
 *  테란이 있었는데, 랭크만 보면 마인(2)이 시즈모드(1)를 이겨 "마인을 두 번 깔았다"가
 *  나간다 — 그 판의 그림은 시즈 49번 쪽이다. 그래서 많이 쓸수록 점수를 얹는다(10번마다
 *  1점).
 *
 *  다만 그 덤은 최상위(10)를 넘볼 수 없어야 한다. 예전 상한이 3이라 스톰 30번(7+3=10)이
 *  핵 2발(10+0=10)과 동점이 됐고, 동점은 횟수로 갈리니 늘 스톰이 이겼다 — 그 판에서
 *  유일하게 드문 일인 핵이 밀려났다(지적: 핵 쏜 게 요약에 안 나온다). 상한을 2로 낮추면
 *  아무리 많이 써도 9가 최대라 10짜리(핵·마인드컨트롤)를 못 넘고, 원래 이 덤이 풀려던
 *  문제(시즈 1+2=3 > 마인 2)는 그대로 풀린다. */
const USE_BONUS_MAX = 2;
export function topUsedTech(s: TechSignalsLike): TechName | null {
  let best: TechName | null = null;
  let bestScore = 0;
  let bestUses = 0;
  for (const [raw, uses] of Object.entries(s.techUses)) {
    if (uses <= 0) continue;
    const name = raw as TechName;
    const rank = TECH_RANK[name] ?? 0;
    if (rank <= 0) continue;
    const score = rank + Math.min(USE_BONUS_MAX, Math.floor(uses / 10));
    if (score > bestScore || (score === bestScore && uses > bestUses)) {
      bestScore = score;
      bestUses = uses;
      best = name;
    }
  }
  return best;
}

/** 실제로 쓴 기술을 이야깃거리 순으로 여러 개 — topUsedTech와 같은 점수 규칙이다.
 *
 *  사람마다 하나만 말하면 요약이 늘 같은 말만 하게 된다(요청: 다양한 세부 기술 사용 진술).
 *  스톰을 30번 뿌리면서 스테이시스로 판을 끊은 경기는 그 둘이 다 이야기다. 다만 흔한 능력
 *  (시즈·스팀·마인)까지 줄줄이 붙으면 그것대로 지루해서, 두 번째부터는 '판을 가르는' 급
 *  (TECH_RANK가 SECOND_TECH_MIN_RANK 이상)에 실제로 여러 번 쓴 것만 남긴다. */
export const SECOND_TECH_MIN_RANK = 5;
export const SECOND_TECH_MIN_USES = 3;
export function topUsedTechs(s: TechSignalsLike, max: number): TechName[] {
  const scored: { name: TechName; score: number; uses: number }[] = [];
  for (const [raw, uses] of Object.entries(s.techUses)) {
    if (uses <= 0) continue;
    const name = raw as TechName;
    const rank = TECH_RANK[name] ?? 0;
    if (rank <= 0) continue;
    scored.push({ name, score: rank + Math.min(USE_BONUS_MAX, Math.floor(uses / 10)), uses });
  }
  scored.sort((a, b) => b.score - a.score || b.uses - a.uses);
  return scored
    .filter((x, i) => i === 0
      || ((TECH_RANK[x.name] ?? 0) >= SECOND_TECH_MIN_RANK && x.uses >= SECOND_TECH_MIN_USES))
    .slice(0, max)
    .map((x) => x.name);
}

/** 그 기술을 "쓴다"를 우리말로 어떻게 말하나 — 마법은 쓰지만 시즈는 펴고 마인은 깐다.
 *  {n}에 횟수가 들어간다. 없는 기술은 기본형("…를 N번 씀")을 쓴다.
 *
 *  기술마다 제 말투를 적어 두는 이유는 두 가지다. 하나는 정확함이다 — "다크스웜을 썼다"
 *  보다 "다크스웜을 깔아 총알을 지웠다"가 그 마법이 실제로 한 일이다. 다른 하나는 다채로움
 *  이다(요청: 다양한 세부 기술 사용 진술) — 기본형만 쓰면 어느 경기든 "…를 N번 썼다"
 *  한 줄로 끝나서, 스톰 서른 번과 브루들링 다섯 번이 같은 문장이 된다. 한 기술에 여럿을
 *  적어 두면 같은 마법이라도 경기마다 다르게 읽힌다. */
export const TECH_USE_PHRASE: Partial<Record<TechName, string[]>> = {
  // ── 능력(마법이 아닌 것) ──
  "Tank Siege Mode": ["시즈를 {n}번 폄", "탱크를 {n}번 앉혔다 일으킴"],
  "Spider Mines": ["마인을 {n}개 깜", "길목마다 마인을 {n}개 심음"],
  Burrowing: ["버로우로 {n}번 숨음", "{n}번 땅에 숨어 기다림"],
  "Personnel Cloaking": ["고스트를 {n}번 숨김", "고스트를 {n}번 지워 놓고 움직임"],
  "Cloaking Field": ["레이스를 {n}번 숨김", "레이스를 {n}번 지워 놓고 들어감"],
  "Stim Packs": ["스팀팩을 {n}번 씀", "스팀을 {n}번 올려 달려듦"],
  // ── 프로토스 ──
  "Psionic Storm": [
    "스톰을 {n}번 뿌림", "사이오닉 스톰으로 {n}번 지짐", "머리 위로 스톰을 {n}번 떨굼",
  ],
  "Stasis Field": [
    "스테이시스로 {n}번 병력을 통째로 묶음", "스테이시스 필드를 {n}번 걸어 시간을 벌음",
  ],
  Hallucination: ["할루시네이션으로 {n}번 허상을 앞세움", "환영을 {n}번 만들어 앞세움"],
  "Mind Control": ["마인드컨트롤로 {n}번 빼앗음", "다크아콘으로 {n}번 남의 유닛을 가져옴"],
  Feedback: ["피드백으로 {n}번 마나를 터뜨림", "상대 마법 유닛을 {n}번 피드백으로 지움"],
  "Disruption Web": ["디스럽션 웹을 {n}번 깔아 지상 공격을 막음", "웹을 {n}번 깔아 길을 끊음"],
  Maelstrom: ["마엘스트롬으로 {n}번 얼려 세움", "마엘스트롬을 {n}번 걸어 발을 묶음"],
  // ── 저그 ──
  "Dark Swarm": [
    "다크스웜을 {n}번 깔아 총알을 지움", "스웜 아래로 {n}번 밀고 들어감",
  ],
  Plague: ["플레이그를 {n}번 뿌려 체력을 깎음", "플레이그로 {n}번 병력을 갉아 놓음"],
  Consume: ["컨슘으로 {n}번 마나를 채움", "저글링을 {n}번 삼켜 마나를 채움"],
  Ensnare: ["인스네어를 {n}번 뿌려 발을 묶음", "인스네어로 {n}번 속도를 죽임"],
  Parasite: ["패러사이트로 {n}번 시야를 훔침", "{n}번 패러사이트를 걸어 속을 들여다봄"],
  "Spawn Broodlings": [
    "브루들링으로 {n}번 유닛을 통째로 지움", "브루들링을 {n}번 심어 한 방에 없앰",
  ],
  // ── 테란 ──
  Lockdown: ["락다운으로 {n}번 묶어 놓음", "락다운을 {n}번 걸어 세워 둠"],
  "EMP Shockwave": ["EMP로 {n}번 마나와 실드를 날림", "EMP를 {n}번 터뜨려 판을 정리함"],
  Irradiate: ["이레디에이트를 {n}번 걸음", "이레디로 {n}번 뭉친 병력을 녹임"],
  "Yamato Gun": ["야마토를 {n}번 쏨", "야마토로 {n}번 큰 것을 지움"],
  Restoration: ["리스토레이션으로 {n}번 풀어냄", "걸린 마법을 {n}번 풀어 줌"],
  "Optical Flare": ["옵티컬 플레어로 {n}번 눈을 멀게 함", "{n}번 눈을 멀게 해 놓고 붙음"],
  "Defensive Matrix": ["디펜시브 매트릭스를 {n}번 씌움", "{n}번 매트릭스로 감싸 살림"],
};

/** 그 마법을 쓸 수 있는 유닛 — 마법 하나는 대개 한 유닛만 쓴다. 명령을 내린 순간 골라져
 *  있던 유닛 번호에 이 이름을 붙여 두면, 그 뒤(그리고 그 앞)의 이동·공격 명령이 '누구를
 *  움직인 것'인지 알 수 있다(replayParser의 orderPositions.by).
 *  두 유닛이 함께 쓰는 것(클로킹=고스트·레이스 등)은 여기 넣지 않는다 — 틀리게 짚느니
 *  모른 채로 두는 편이 낫다. */
export const CAST_ORDER_TO_UNIT: Record<string, string> = {
  CastNuclearStrike: "Ghost",
  CastPsionicStorm: "High Templar",
  CastHallucination: "High Templar",
  CastLockdown: "Ghost",
  CastEMPShockwave: "Science Vessel",
  CastIrradiate: "Science Vessel",
  CastDefensiveMatrix: "Science Vessel",
  FireYamatoGun: "Battlecruiser",
  CastRestoration: "Medic",
  CastOpticalFlare: "Medic",
  MedicHeal: "Medic",
  CastDarkSwarm: "Defiler",
  CastPlague: "Defiler",
  CastConsume: "Defiler",
  CastEnsnare: "Queen",
  CastParasite: "Queen",
  CastSpawnBroodlings: "Queen",
  CastInfestation: "Queen",
  CastRecall: "Arbiter",
  CastStasisField: "Arbiter",
  CastDisruptionWeb: "Corsair",
  CastMindControl: "Dark Archon",
  CastFeedback: "Dark Archon",
  CastMaelstrom: "Dark Archon",
};

/** 전용 커맨드가 곧 유닛을 알려 주는 것들 — 시즈는 시즈탱크만, 스팀은 마린·파이어뱃만
 *  한다. 파이어뱃까지 함께 묶이는 자리는 '바이오닉'이라는 한 이름으로 둔다. */
export const USE_CMD_TO_UNIT: Record<string, string> = {
  Siege: "Siege Tank",
  Unsiege: "Siege Tank",
  Stim: "Bionic",
  "Train Fighter": "Carrier",
  "Merge Archon": "High Templar",
  "Merge Dark Archon": "Dark Templar",
  "Unload All": "Transport",
  Unload: "Transport",
};
