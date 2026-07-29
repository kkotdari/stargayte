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

/** 기술 — screp Techs enum(35개) 그대로. */
export const TECH_NAMES = [
  "Stim Packs", "Lockdown", "EMP Shockwave", "Spider Mines", "Scanner Sweep",
  "Tank Siege Mode", "Defensive Matrix", "Irradiate", "Yamato Gun", "Cloaking Field",
  "Personnel Cloaking", "Burrowing", "Infestation", "Spawn Broodlings", "Dark Swarm",
  "Plague", "Consume", "Ensnare", "Parasite", "Psionic Storm",
  "Hallucination", "Recall", "Stasis Field", "Archon Warp", "Restoration",
  "Disruption Web", "Mind Control", "Dark Archon Meld", "Feedback", "Optical Flare",
  "Maelstrom", "Lurker Aspect", "Healing",
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
};

/** 기술의 '이야깃거리 점수' — 클수록 요약에서 먼저 말한다.
 *
 *  예전에는 정해둔 집합에서 "먼저 연구한 것 하나"를 골랐다. 그러면 거의 모든 테란 경기가
 *  스팀팩으로 채워졌다 — 스팀팩은 안 하는 사람이 없어서 '무슨 일이 있었나'를 말해 주지
 *  않는다. 드물게 나오는 기술일수록 그 경기의 그림이므로, 흔한 것은 낮게 둔다.
 *  여기 없는 기술은 요약에 안 쓴다(스캐너·디펜시브 매트릭스처럼 연구가 아예 없는 것 포함). */
export const TECH_RANK: Partial<Record<TechName, number>> = {
  // 나오면 그 경기의 하이라이트가 되는 것들.
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
