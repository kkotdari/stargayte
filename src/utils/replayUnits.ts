// 개체 트랙 v2 — 커맨드 스트림을 태그(유닛 번호) 단위로 다시 읽어, 유닛·건물 하나하나의
// 생애(태어남·정체·움직임의 증거·죽음)를 복원한다(요청: 리플레이 파싱은 오래 걸려도 되니까
// 유닛 위치를 저마다 기억하고 실제 브루드워 엔진처럼 분석 / 건물 파괴도 파악하려면 건물도
// 같이 가야 한다).
//
// 리플레이에는 위치가 아니라 '명령'만 남는다. 그런데 선택(Select)에는 고른 유닛의 번호가
// 실려 오고, 그 뒤의 모든 명령은 그때 골라져 있던 번호들의 것이다 — 실측으로 명령의 100%가
// 개별 번호에 귀속됐다(4:4 리플레이 8,390개 전부). 우클릭·표적 명령은 '찍힌 대상'의 번호
// (UnitTag)도 실어 온다(실측 15.5%) — 찍은 좌표는 곧 그 순간 대상이 있던 자리라, 남이 찍어
// 준 내 유닛의 위치가 공짜 앵커가 된다.
//
// 저장하는 것은 '증거 스트림'이다 — 시뮬레이션된 좌표가 아니라, 각 개체가 언제 어디로
// 명령받았고 언제 어디서 찍혔는지다. 지형을 따라 걷는 계산은 재생기가 맡는다(지형 격자는
// 서버 검수 뒤에야 생겨 등록 시점엔 없고, 걷기 모델은 저장을 다시 하지 않고도 고칠 수
// 있어야 한다 — 지적: 우리가 놓치는 요소가 분명 있을 테니 뒷결과로 보정하는 체계가 필요).
// 같은 이유로 보정 통계(앵커 개수·어긋남)를 함께 담아, 모델이 실제와 얼마나 다른지를
// 리플레이마다 잴 수 있게 한다.
import {
  CAST_ORDER_TO_UNIT, USE_CMD_TO_UNIT, CAST_ORDER_TO_TECH, PLACE_MINE_ORDER,
  normalizeUpgradeName,
} from "./replayTechNames";
import type { Race } from "../types";

/* ── 입력 — screp 커맨드에서 쓰는 필드만 구조 타입으로 받는다(replayParser의 ScrepCmd와
      호환). ─────────────────────────────────────────────────────────────────── */
export interface UnitCmd {
  /** screp 타입 선언상 선택 필드지만 실측으로 늘 온다 — 없으면 0으로 친다. */
  Frame?: number;
  PlayerID: number;
  Type?: { Name?: string } | string;
  Pos?: { X?: number; Y?: number; x?: number; y?: number } | null;
  Order?: { Name?: string } | string;
  Unit?: { Name?: string } | string;
  UnitTags?: number[];
  UnitTag?: number;
  Group?: number | { Name?: string };
  HotkeyType?: { Name?: string } | string;
  IneffKind?: number | string;
  /** 연구 커맨드의 테크·업그레이드 이름 — 속업 판정(재생기)과 기록의 재료다. */
  Tech?: { Name?: string } | string;
  Upgrade?: { Name?: string } | string;
  /** 시프트 예약 명령 — 지금이 아니라 앞선 일이 끝난 뒤의 일이라, '건설 무르기' 판정
   *  (일꾼이 다른 데로 불려가면 취소)에서 뺀다. */
  Queued?: boolean;
}

/* ── 출력 — 별도 테이블(game_result_unit_tracks)에 JSON으로 담긴다(요청: 별도 테이블로
      해서 기존 부대 추적과 비교). ──────────────────────────────────────────── */
/** 증거 한 점: [초, 타일x, 타일y, 종류]. 종류 — 0 이동명령의 목적지(여기로 '가라'),
 *  1 남이 찍은 자리(그 순간 실제로 '있던' 자리 — 강한 앵커), 2 건설 자리(일꾼이 가서
 *  지은 자리), 3 멈춤·홀드·시즈·버로우(그 자리에 '선다'), 4 생산·랠리(건물이 일한 증거 —
 *  위치 정보 없음, x·y는 랠리 좌표거나 -1), 5 착륙 자리(띄운 건물의 이사 목적지),
 *  6 이륙(위치 없음, x·y는 -1), 7 공격 명령의 목적지(지적: 어택 찍으면 그 대상을
 *  공격해야 — 다섯째 값이 찍힌 대상의 태그, 땅 어택이면 0), 8 시즈모드 켬, 9 해제
 *  (지적: 시즈 판정은 리플레이 커맨드 그대로 — 둘 다 위치 없음). */
export type UnitEv = [number, number, number, number, number?];
export interface UnitEnt {
  /** 유닛 번호. 물리 건물(선택된 적 없이 건설 좌표로만 아는 것)은 -1. */
  t: number;
  /** 주인(screp PlayerID) — players 배열의 id와 짝. */
  o: number;
  /** 정체(스크렙 유닛 이름). 못 알아냈으면 "". */
  k: string;
  /** 처음 확인된 초. */
  b: number;
  /** 죽음(마지막 확인) 초 — 근거가 없으면 null(끝까지 산 것으로 본다). */
  d: number | null;
  /** 죽음의 근거 — tag(번호 재사용: 다음 생애가 이 번호로 시작됐다), atk(공격받은 뒤
   *  소식 없음), morph(변태로 이어짐 — 죽음이 아니라 다음 생애로 계속), cxl(건설 취소 —
   *  취소 커맨드 또는 일꾼이 도착 전에 딴 데로 불려감), "". */
  dk: "tag" | "atk" | "morph" | "cxl" | "";
  /** 건물이면 1. */
  bld: 0 | 1;
  /** 체력 변곡점 [초, 퍼센트 0~100](요청: 스탯을 지닌 생애주기) — 피격·회복·죽음. */
  hp?: [number, number][];
  /** 캐리어 인터셉터 개수 변곡점 [초, 개수](요청: 실시간 적용). */
  ic?: [number, number][];
  ev: UnitEv[];
}
export interface UnitTracksV2 {
  v: 2;
  /** color는 게임 내 개인색(#rrggbb) — v1을 걷어낸 뒤에도 이 테이블만으로 칠할 수 있게
   *  함께 담는다(요청: 모든 정보를 다 모아서 한 테이블에). */
  players: { id: number; name: string; race: Race | ""; color?: string | null }[];
  ents: UnitEnt[];
  /** 연구 기록 [초, 이름, 플레이어] — 속업(이동 속도)·클로킹 판정의 재료. 이름은 v1과
   *  같은 자(normalizeUpgradeName)로 통일한다. */
  ups: [number, string, number][];
  /** 좌표가 남는 마법 [초, x, y, 기술 이름, 플레이어] — 스톰·스웜·리콜·마인…. */
  casts: [number, number, number, string, number][];
  /** 미니맵 핑 [초, x, y, 플레이어](요청: 클릭도 기록 — 좌표가 온전히 남는다. 실측 4:4
   *  에서 59개). 카메라 시야는 리플레이에 저장되지 않아 여기 없다 — 인게임 리플레이의
   *  '시야'는 엔진이 명령을 재시뮬레이션해 유닛 위치로 안개를 다시 계산하는 것이다. */
  pings?: [number, number, number, number][];
  /** 보정 재료(지적: 놓치는 요소를 뒷결과로 잴 체계) — 강한 앵커가 몇 번 나왔고, 명령
   *  귀속이 얼마나 됐는지. 재생기·후속 분석이 모델의 어긋남을 잴 때 쓴다. */
  stats: {
    cmds: number; attributed: number; anchors: number; lives: number; tags: number;
    /** 생산 원장(요청: 큐된 유닛 전 생애) — 기입·결합·합성 개체 수. */
    prod?: number; prodBound?: number; prodSyn?: number;
  };
}

const SECONDS_PER_FRAME = 0.042;
const PIXELS_PER_TILE = 32;

/** 생산(훈련) 커맨드로 정체가 드러나는 건물 — 무엇을 뽑았는지가 곧 골라 둔 건물의 종류다.
 *  (해처리 계열은 라바가 뽑는 것이라 여기 없다 — Unit Morph는 라바 선택이다.) */
const TRAIN_AT: Record<string, string> = {
  Marine: "Barracks", Firebat: "Barracks", Medic: "Barracks", Ghost: "Barracks",
  Vulture: "Factory", Goliath: "Factory", "Siege Tank (Tank Mode)": "Factory", "Siege Tank": "Factory",
  Wraith: "Starport", Dropship: "Starport", "Science Vessel": "Starport",
  Battlecruiser: "Starport", Valkyrie: "Starport",
  SCV: "Command Center",
  Zealot: "Gateway", Dragoon: "Gateway", "High Templar": "Gateway", "Dark Templar": "Gateway",
  Shuttle: "Robotics Facility", Reaver: "Robotics Facility", Observer: "Robotics Facility",
  Scout: "Stargate", Corsair: "Stargate", Carrier: "Stargate", Arbiter: "Stargate",
  Probe: "Nexus",
};
/** 유닛에서 유닛으로 변태 — 골라 둔 것이 '무엇이었는지'와 '무엇이 되는지'를 함께 말해 준다.
 *  그 밖의 Unit Morph는 라바 선택이다(라바였다가 그 유닛이 된다). */
const MORPH_FROM: Record<string, string> = {
  Lurker: "Hydralisk", Guardian: "Mutalisk", Devourer: "Mutalisk",
};
/** 건물에서 나오지 않는 유닛 — 다른 유닛이 합쳐지거나 변태해서 생긴다(지적: 아콘·
 *  다크아콘이 게이트에서 바로 태어난 것처럼 보인다). 생산 출고 보정이 이들을 제 생산소
 *  발치에서 걸어 나오게 만들면, 합체한 자리가 아니라 게이트에서 솟는 그림이 된다. */
const NOT_TRAINED = new Set([
  "Archon", "Dark Archon", "Lurker", "Guardian", "Devourer", "Infested Terran",
]);
/** 유닛 생산 시간(게임 프레임) — 원장 시뮬레이션(요청: 큐된 유닛 전 생애)의 시계.
 *  sec = frames × 0.042. 방해(서플 막힘 등)는 리플레이로 알 수 없어 무시한다. */
const UNIT_FRAMES: Record<string, number> = {
  SCV: 300, Probe: 300, Drone: 300,
  Marine: 360, Firebat: 360, Medic: 450, Ghost: 750,
  Vulture: 450, Goliath: 600, "Siege Tank": 750, "Siege Tank (Tank Mode)": 750,
  Wraith: 900, Dropship: 750, "Science Vessel": 1200, Battlecruiser: 2000, Valkyrie: 750,
  Zealot: 600, Dragoon: 750, "High Templar": 750, "Dark Templar": 750,
  Shuttle: 900, Reaver: 1050, Observer: 600, Scout: 1200, Carrier: 2100, Arbiter: 2400, Corsair: 600,
  Zergling: 420, Hydralisk: 420, Overlord: 600, Mutalisk: 600, Scourge: 450,
  Queen: 750, Ultralisk: 900, Defiler: 750,
};

/** 유닛 기본 스탯(요청: 체력·방어력·공격력·기술을 지니고 이벤트를 겪는 생애주기) —
 *  hp는 체력+실드 합, dps는 지상 상대 어림. 원작 수치의 근사값이다. */
export const UNIT_STATS: Record<string, { hp: number; dps: number; sh?: number }> = {
  SCV: { hp: 60, dps: 5 }, Probe: { hp: 20, sh: 20, dps: 4 }, Drone: { hp: 40, dps: 4 },
  Marine: { hp: 40, dps: 6 }, Firebat: { hp: 50, dps: 12 }, Medic: { hp: 60, dps: 0 },
  Ghost: { hp: 45, dps: 7 }, Vulture: { hp: 80, dps: 9 }, Goliath: { hp: 125, dps: 9 },
  "Siege Tank": { hp: 150, dps: 14 }, "Siege Tank (Tank Mode)": { hp: 150, dps: 14 },
  "Siege Tank (Siege Mode)": { hp: 150, dps: 24 },
  Wraith: { hp: 120, dps: 6 }, Dropship: { hp: 150, dps: 0 }, "Science Vessel": { hp: 200, dps: 0 },
  Battlecruiser: { hp: 500, dps: 17 }, Valkyrie: { hp: 200, dps: 8 },
  Zealot: { hp: 100, sh: 60, dps: 13 }, Dragoon: { hp: 100, sh: 80, dps: 10 },
  "High Templar": { hp: 40, sh: 40, dps: 3 },
  "Dark Templar": { hp: 80, sh: 40, dps: 22 }, Archon: { hp: 10, sh: 350, dps: 20 },
  "Dark Archon": { hp: 25, sh: 200, dps: 0 },
  Shuttle: { hp: 80, sh: 60, dps: 0 }, Reaver: { hp: 100, sh: 80, dps: 26 },
  Observer: { hp: 40, sh: 20, dps: 0 },
  Scout: { hp: 150, sh: 100, dps: 8 }, Carrier: { hp: 300, sh: 150, dps: 22 },
  Arbiter: { hp: 200, sh: 150, dps: 7 }, Corsair: { hp: 100, sh: 80, dps: 6 },
  Zergling: { hp: 35, dps: 5 }, Hydralisk: { hp: 80, dps: 8 }, Lurker: { hp: 125, dps: 14 },
  Mutalisk: { hp: 120, dps: 7 }, Scourge: { hp: 25, dps: 0 }, Queen: { hp: 120, dps: 0 },
  Ultralisk: { hp: 400, dps: 18 }, Defiler: { hp: 80, dps: 0 }, Overlord: { hp: 200, dps: 0 },
  "Sunken Colony": { hp: 300, dps: 13 }, "Photon Cannon": { hp: 100, sh: 100, dps: 11 },
  Bunker: { hp: 350, dps: 14 }, "Missile Turret": { hp: 200, dps: 0 },
};
const DEFAULT_UNIT_STATS = { hp: 70, dps: 6 };
/** 건물 스탯(요청: 건물 체력바 — 실드·회복·불·수리까지) — [체력, 실드]. 실드는
 *  프로토스만 있고 저절로 차오른다. */
export const BLD_STATS: Record<string, [number, number]> = {
  "Command Center": [1500, 0], "Supply Depot": [500, 0], Barracks: [1000, 0], Refinery: [750, 0],
  "Engineering Bay": [850, 0], Academy: [600, 0], Bunker: [350, 0], "Missile Turret": [200, 0],
  Factory: [1250, 0], Starport: [1300, 0], Armory: [750, 0], "Science Facility": [850, 0],
  "Comsat Station": [500, 0], "Machine Shop": [750, 0], "Control Tower": [500, 0],
  Hatchery: [1250, 0], Lair: [1800, 0], Hive: [2500, 0], "Spawning Pool": [750, 0],
  "Hydralisk Den": [850, 0], Spire: [600, 0], "Greater Spire": [1000, 0],
  "Evolution Chamber": [750, 0], Extractor: [750, 0], "Creep Colony": [400, 0],
  "Sunken Colony": [300, 0], "Spore Colony": [400, 0], "Queen's Nest": [850, 0],
  "Queens Nest": [850, 0], "Ultralisk Cavern": [600, 0], "Defiler Mound": [850, 0],
  Nexus: [750, 750], Pylon: [300, 300], Gateway: [500, 500], Assimilator: [450, 450],
  Forge: [550, 550], "Photon Cannon": [100, 100], "Cybernetics Core": [500, 500],
  "Citadel of Adun": [450, 450], "Templar Archives": [500, 500], "Robotics Facility": [500, 500],
  "Robotics Support Bay": [450, 450], Observatory: [250, 250], Stargate: [600, 600],
  "Fleet Beacon": [500, 500], "Arbiter Tribunal": [500, 500], "Shield Battery": [200, 200],
};
/** 공중 유닛(체력 원장의 방어건물 사거리 판정용) — 성큰은 지상만, 터렛은 공중만 쏜다. */
const AIR_UNITS = new Set([
  "Overlord", "Mutalisk", "Scourge", "Guardian", "Devourer", "Queen",
  "Wraith", "Dropship", "Science Vessel", "Battlecruiser", "Valkyrie",
  "Shuttle", "Observer", "Scout", "Corsair", "Carrier", "Arbiter",
]);

/** 건물에서 건물로 변태 — 무엇이 되는지로 이전 정체를 안다. */
const BUILDING_MORPH_FROM: Record<string, string> = {
  Lair: "Hatchery", Hive: "Lair", "Greater Spire": "Spire",
  "Sunken Colony": "Creep Colony", "Spore Colony": "Creep Colony",
};
/** 두루뭉술한 정체(그룹) → 구체 증거가 없을 때의 대표. */
const GROUP_FALLBACK: Record<string, string> = { Bionic: "Marine", Transport: "Dropship" };
/** 그룹이 품는 구체 정체 — 그룹 증거와 구체 증거가 만나면 구체 쪽을 쓴다. */
const GROUP_MEMBERS: Record<string, Set<string>> = {
  Bionic: new Set(["Marine", "Firebat"]),
  Transport: new Set(["Dropship", "Shuttle", "Overlord"]),
};
const RACE_WORKER: Record<string, string> = { 테란: "SCV", 프로토스: "Probe", 저그: "Drone" };
const RACE_TRANSPORT: Record<string, string> = { 테란: "Dropship", 프로토스: "Shuttle", 저그: "Overlord" };
/** 자원을 찍은 우클릭 → 고른 것은 일꾼(replayParser와 같은 규칙). */
const RESOURCE_TARGETS = new Set<string>([
  "Vespene Geyser", "Assimilator", "Refinery", "Extractor",
  "Mineral Field (Type 1)", "Mineral Field (Type 2)", "Mineral Field (Type 3)",
]);
/** 시작 직후 '통째 선택'(4기 이상)이 찍은 자원 클릭에는 일꾼 낙인을 안 찍는다 —
 *  스타팅 오버로드가 같이 골라진 채 미네랄을 찍는 일이 흔하다(replayParser와 동일). */
const EARLY_ALL_SELECT_FRAMES = 720;
/** 표적 명령 중 '공격'으로 칠 것들 — 죽음(공격받고 소식 없음)의 근거가 된다. 남의 유닛을
 *  찍은 우클릭도 공격이다(주인 판정 뒤의 2차 패스에서 가른다). */
/* 건물 발자국(기획서 2-F) — 렌더러 FOOTPRINT와 같은 표(발치 공격 증거 판정용). */
const FOOT_WH: Record<string, [number, number]> = {
  "Command Center": [4, 3], Nexus: [4, 3], Hatchery: [4, 3], Lair: [4, 3], Hive: [4, 3],
  Barracks: [4, 3], Factory: [4, 3], Starport: [4, 3], "Science Facility": [4, 3],
  Gateway: [4, 3], Stargate: [4, 3], "Engineering Bay": [4, 3],
  Refinery: [4, 2], Assimilator: [4, 2], Extractor: [4, 2],
  Pylon: [2, 2], "Missile Turret": [2, 2], "Photon Cannon": [2, 2],
  "Creep Colony": [2, 2], "Sunken Colony": [2, 2], "Spore Colony": [2, 2],
  Spire: [2, 2], "Greater Spire": [2, 2], "Nydus Canal": [2, 2],
};

const ATTACK_ORDERS = new Set<string>([
  // AttackFixedRange 누락(기획서 2-B) — 이 오더의 어택이 f=0 이동으로 격하됐었다.
  "Attack1", "Attack2", "AttackUnit", "AttackMove", "AttackFixedRange",
  "CastPsionicStorm", "CastNuclearStrike",
  "CastPlague", "CastEnsnare", "CastStasisField", "CastLockdown", "CastIrradiate",
  "CastSpawnBroodlings", "CastMaelstrom", "FireYamatoGun", "CastMindControl", "CastFeedback",
]);
/** 골라 둔 것을 그 자리에 세우는 커맨드들(증거 종류 3). */
const HALT_CMDS = new Set<string>(["Stop", "Hold Position", "Siege", "Burrow"]);
/** 건물만 낼 수 있는 커맨드 — 고른 번호가 건물이라는 뜻이고, 그 뒤의 우클릭은 랠리다. */
const BUILDING_ONLY_CMDS = new Set<string>(["Train", "Cancel Train", "Building Morph", "Lift Off", "Land", "Train Fighter"]);
/** 건물 이름 판별 — TRAIN_AT의 값들 + 흔한 건물들. bld 플래그를 세울 때 쓴다. */
const BUILDING_NAMES = new Set<string>([
  ...Object.values(TRAIN_AT), ...Object.keys(BUILDING_MORPH_FROM), ...Object.values(BUILDING_MORPH_FROM),
  "Hatchery", "Spawning Pool", "Hydralisk Den", "Spire", "Queen's Nest", "Queens Nest", "Ultralisk Cavern",
  "Defiler Mound", "Evolution Chamber", "Extractor", "Nydus Canal",
  "Supply Depot", "Refinery", "Engineering Bay", "Academy", "Missile Turret", "Bunker",
  "Armory", "Science Facility", "Comsat Station", "ComSat", "Nuclear Silo", "Machine Shop", "Control Tower",
  "Physics Lab", "Covert Ops",
  "Pylon", "Assimilator", "Forge", "Photon Cannon", "Cybernetics Core", "Citadel of Adun",
  "Templar Archives", "Robotics Support Bay", "Observatory", "Fleet Beacon", "Arbiter Tribunal",
  "Shield Battery",
]);

/* ── 내부 작업용 — 생애(lifetime) 하나. 태그는 죽으면 곧 재사용되므로 한 태그가 여러
      생애를 가진다. 생애를 가르는 근거는 (1) 다른 사람이 '명령'을 내림(선택만으로는 안
      가른다 — 남의 유닛도 홑클릭으로 골라져 Select에 실린다), (2) 정체가 충돌하는 증거,
      (3) 변태(정체가 바뀌며 이어짐). ──────────────────────────────────────── */
interface Life {
  tag: number;
  owner: number;            // 명령을 내린 사람(선택만 한 사람이 아니라)
  kinds: Map<string, number>; // 정체 증거 → 횟수
  groupKinds: Set<string>;    // 두루뭉술한 증거(Bionic·Transport)
  bld: boolean;
  born: number;             // 초
  last: number;             // 마지막 증거 초
  lastAtk: number | null;   // 마지막으로 공격받은 초
  evAfterAtk: boolean;      // 공격받은 뒤에도 증거가 나왔나(살아남음)
  morphTo: Life | null;     // 변태로 이어진 다음 생애
  cxl: number | null;       // 건설 취소 커맨드를 받은 초(건물 생애의 끝)
  solo: boolean;            // 홀로 골라져 명령받은 적이 있나(시작 오버로드 판별 재료)
  /** 이 건물 생애에 찍힌 랠리들 [초, x, y] — 원장 유닛의 첫 행선지. */
  rallies?: [number, number, number][];
  /** 원장 결합으로 출생 이야기를 이미 받았다 — 어림 출고 보정은 건너뛴다. */
  spawned?: boolean;
  ev: UnitEv[];
}

function nameOf(v: { Name?: string } | string | undefined): string {
  if (typeof v === "string") return v;
  return v?.Name ?? "";
}
function posOf(c: UnitCmd): { x: number; y: number } | null {
  const p = c.Pos;
  if (!p) return null;
  const X = p.X ?? p.x;
  const Y = p.Y ?? p.y;
  if (typeof X !== "number" || typeof Y !== "number") return null;
  return { x: X / PIXELS_PER_TILE, y: Y / PIXELS_PER_TILE };
}
/** 건설·착륙 커맨드의 좌표는 처음부터 '타일' 단위다 — 32로 나누면 전 건물이 왼쪽 위
 *  구석에 뭉친다(실측: 지도 전체가 0~4 타일로 접혔다). v1 파서(buildPositions·lands)와
 *  같은 규칙이다. */
function posTileOf(c: UnitCmd): { x: number; y: number } | null {
  const p = c.Pos;
  if (!p) return null;
  const X = p.X ?? p.x;
  const Y = p.Y ?? p.y;
  if (typeof X !== "number" || typeof Y !== "number") return null;
  return { x: X, y: Y };
}
const r1 = (n: number): number => Math.round(n * 10) / 10;

/** 정체 증거들을 하나의 이름으로 굳힌다 — 구체 증거가 있으면 다수결, 그룹 증거뿐이면
 *  대표(마린·수송선은 종족 것)로. */
function settleKind(life: Life, race: Race | ""): string {
  if (life.kinds.size > 0) {
    // 건물 생애는 건물 이름 표만 센다(지적: 드론 표가 이겨 건물 자리에 드론이 섰다).
    const pool = life.bld
      ? [...life.kinds].filter(([k]) => BUILDING_NAMES.has(k))
      : [...life.kinds];
    let best = "";
    let bestN = 0;
    for (const [k, n] of (pool.length > 0 ? pool : [...life.kinds])) {
      if (n > bestN) { best = k; bestN = n; }
    }
    return best;
  }
  for (const g of life.groupKinds) {
    if (g === "Transport" && race) return RACE_TRANSPORT[race] ?? GROUP_FALLBACK[g];
    return GROUP_FALLBACK[g] ?? "";
  }
  return "";
}

/** 새 정체 증거가 기존 생애와 어긋나는가 — 어긋나면 태그 재사용(앞 생애의 죽음)이다.
 *  그룹 증거는 그 그룹의 구체 정체와는 어긋나지 않는다. */
function kindConflicts(life: Life, kind: string): boolean {
  if (life.kinds.size === 0) return false;
  if (life.kinds.has(kind)) return false;
  const members = GROUP_MEMBERS[kind];
  if (members) return ![...life.kinds.keys()].some((k) => members.has(k));
  for (const g of life.groupKinds) if (GROUP_MEMBERS[g]?.has(kind)) return false;
  // 구체 vs 구체 — 다른 이름이면 충돌. 단 일꾼↔일꾼 같은 동족 오염은 없다(이름이 같다).
  return true;
}

/** 커맨드 스트림 → 개체 트랙 v2. players는 실제 참가자(관전 제외)의 screp PlayerID와
 *  이름·종족 — 명령 귀속과 일꾼·수송선 대표를 정하는 데 쓴다. */
export function buildUnitTracks(
  cmds: UnitCmd[],
  players: {
    id: number; name: string; race: Race | ""; color?: string | null;
    /** 시작 지점(타일 중심) — 시작 홀을 심는 재료다(아래 주석). */
    startX?: number | null; startY?: number | null;
    /** 팀 번호 — 전투 사망 보정에서 아군 공격·방어건물을 적으로 오인하지 않게. */
    team?: number | null;
  }[],
): UnitTracksV2 {
  const playing = new Set(players.map((p) => p.id));
  const raceOf = new Map(players.map((p) => [p.id, p.race] as const));
  /* 편 가르기 — 아군을 찍은 우클릭(수리·힐·따라가기)을 공격으로 오인하지 않게. 팀
     정보가 없는 옛 리플레이는 '남 = 적'으로 남는다(종전과 같다). */
  const teamNoOf = new Map(players.map((p) => [p.id, p.team ?? null] as const));
  const sameSide = (a: number, b: number): boolean => {
    if (a === b) return true;
    const ta = teamNoOf.get(a);
    const tb = teamNoOf.get(b);
    return ta !== null && ta !== undefined && tb !== null && tb !== undefined && ta === tb;
  };

  const sel = new Map<number, number[]>();
  const groups = new Map<string, number[]>();
  /** 태그 → 지금 살아 있는 생애. 끝난 생애는 done으로 옮긴다. */
  const alive = new Map<number, Life>();
  const done: Life[] = [];
  /** 물리 건물(건설 좌표로 아는 것) — 태그가 없어도 개체다(요청: 건물 파괴 파악).
   *  builder는 지은 일꾼의 태그 — 그 일꾼이 도착 전에 딴 데로 불려가면 건설 무르기다. */
  const built: {
    owner: number; kind: string; born: number; x: number; y: number;
    builder: number | null; gone: number | null; goneKind: "cxl" | "atk" | null; ev: UnitEv[];
  }[] = [];
  /** 생산 원장(요청: 주먹구구 덧대기 말고 근본 수집 — 모든 큐된 유닛의 전 생애) —
   *  Train·라바 변태 하나가 유닛 하나다: 시작 시각, 만드는 건물 태그, 완성 예정.
   *  뒤에서 실제 태그 증거와 결합하고, 남으면 스스로 사는 합성 개체가 된다. */
  const ledger: {
    unit: string; pid: number; sec: number; done: number;
    bldTag: number | null; cancelled: boolean; bound: boolean;
  }[] = [];
  /** 건물 태그별 생산 꼬리 시각 — 같은 건물의 큐는 한 줄로 이어진다(라바는 병렬). */
  const prodTail = new Map<number, number>();
  const prodStats = { total: 0, bound: 0, syn: 0 };
  /** 수송선 승하차(요청 ③) — 제 수송선을 우클릭하면 탑승(f=12), Unload·MoveUnload로
   *  내리면 하차(f=13). 탑승 중 제 명령을 받으면 그때 이미 내린 것이다. */
  const ridersOf = new Map<number, number[]>();
  const riderIn = new Map<number, number>();
  /* ── 수송선 태그를 놓치지 않는 자(요청: 근본 원리) ──────────────────────────────
     탑승 판정은 '우클릭이 찍은 태그가 내 수송선인가'인데, 그 태그의 생애는 그 태그가
     한 번이라도 '선택'된 적이 있어야 생긴다. 셔틀을 뽑아 랠리만 걸고 템플러로 우클릭해
     태우면 셔틀은 선택된 적이 없어 생애가 없고, 탑승이 통째로 없던 일이 된다(실측:
     이 리플레이의 유닛 표적 우클릭 443건 중 278건이 '선택된 적 없는 태그').
     그래서 두 갈래로 고친다.
     ⓐ 수송선 정체를 확정하는 증거를 모은다 — MoveUnload·Unload·Unload All은 수송선
        에게만 내릴 수 있는 명령이라, 그때 선택돼 있던 태그는 수송선이 확실하다.
     ⓑ 판정을 뒤로 미룬다 — 태울 때는 아직 정체를 모를 수 있으니(하차는 수백 초 뒤에
        온다) 후보를 적어 두고, 스트림을 다 읽은 뒤 확정된 수송선 태그로 걸러 승하차를
        만든다. 지형·거리 같은 간접 추측은 쓰지 않는다(지적: 짧은 거리 드랍도 흔하다). */
  /** 확정된 수송선 태그 → 임자. */
  const transTagOwner = new Map<number, number>();
  /** 보류 승선 — [시각, 태우는 유닛 태그, 수송선 후보 태그, x, y, 임자]. */
  const pendBoard: [number, number, number, number, number, number][] = [];
  /** 보류 하차 — [시각, 수송선 태그, x, y]. */
  const pendUnload: [number, number, number, number][] = [];
  const unloadRiders = (transTag: number, sec2: number, ux: number, uy: number): void => {
    const list = ridersOf.get(transTag);
    if (!list) return;
    for (const rt of list) {
      const rl = alive.get(rt);
      if (rl && !rl.bld) {
        rl.ev.push([Math.round(sec2), r1(ux), r1(uy), 13]);
        rl.last = sec2;
      }
      riderIn.delete(rt);
    }
    ridersOf.delete(transTag);
  };
  const majorityKindOf2 = (l: Life): string => {
    let best = "";
    let bn = 0;
    for (const [k, n] of l.kinds) { if (n > bn) { best = k; bn = n; } }
    return best;
  };
  const isTransportLife = (l: Life): boolean =>
    l.kinds.has("Dropship") || l.kinds.has("Shuttle") || l.kinds.has("Overlord")
    || l.groupKinds.has("Transport");
  const ventralAt = new Map<number, number>();
  /** 떠 있는 건물 태그(요청: summary motion 완전 제거의 마지막 재료) — 이륙~착륙
   *  사이의 이동 클릭을 비행 자취(f=0)로 싣는다. */
  const liftedTags = new Set<number>();
  /** 캐리어 태그 → 인터셉터 개수 변곡점 [초, 개수](요청: 실시간 적용). */
  const icptOf = new Map<number, [number, number][]>();
  /** 표적 주문(재질문: 모든 기술 전수조사) — [표적 태그, 초, 기술]. 이라디에잇·
   *  야마토·브루들링(즉사)·디펜시브 매트릭스(흡수)·락다운(정지)이 태그를 찍는다. */
  const targCast: { tag: number; sec: number; tech: string }[] = [];
  /** 일꾼 태그 → 아직 확정 안 된 건설 — '도착 전'(arrive 예상 시각 앞)에 다른 데로
   *  불려가야만 취소다. 도착 뒤의 재명령(테란 SCV 곁 세우기, 프로토스 워프 후 복귀)은
   *  정상 조작이다 — 첫 판은 25초 뭉툭 창이라 물리건물 476채 중 248채를 취소로 오판했다. */
  const pendingBuild = new Map<number, { sec: number; x: number; y: number; idx: number; arrive: number }>();
  /** 연구 기록 — 같은 사람이 같은 이름을 연타(취소 후 재시작 포함)하면 첫 번만 남긴다. */
  const ups: [number, string, number][] = [];
  const upSeen = new Set<string>();
  const casts: [number, number, number, string, number][] = [];
  const pings: [number, number, number, number][] = [];
  let attributed = 0;
  let anchors = 0;
  let totalOrders = 0;
  /* 시작 홀을 심는다(v1 replayMotion과 같은 규칙) — 시작 커맨드센터·해처리·넥서스는
     건설 커맨드가 없어 그냥 두면 개체 목록에도, 파괴 판정에도 없다. 시작 지점에 종족
     홀을 0초로 세우면 발치 공격 증거·철거/격퇴 판정이 다른 건물과 똑같이 걸린다.
     좌표는 중심에서 발자국 절반(4×3)을 물려 왼쪽 위 타일로(builds 규약). */
  for (const p of players) {
    if (typeof p.startX !== "number" || typeof p.startY !== "number" || !p.race) continue;
    const hall = p.race === "저그" ? "Hatchery" : p.race === "테란" ? "Command Center" : "Nexus";
    /* 자리 증거를 함께 심는다(지적: 첫 홀 넥서스가 짓는 걸로 나온다) — 화면의 건물
       층은 자리 증거(f=2|5)가 있는 것만 그린다. 여태 시작 홀은 ev가 비어 아예 안
       그려졌고, 그 자리에 보이던 '첫 홀'은 시작 일꾼 태그에서 자란 확장 건물이 일꾼의
       출생(1초)으로 잘못 날짜 매겨진 것이었다 — 그래서 경기 시작부터 공사 중이었다.
       0초 앵커를 심으면 시작 홀이 제 모습으로, 완공 상태로 선다(공사 표시는 sec>0). */
    built.push({
      owner: p.id, kind: hall, born: 0,
      x: Math.round(p.startX - 2), y: Math.round(p.startY - 1.5),
      builder: null, gone: null, goneKind: null,
      ev: [[0, Math.round(p.startX - 2), Math.round(p.startY - 1.5), 2]],
    });
  }

  const lifeOf = (tag: number, owner: number, sec: number): Life => {
    let life = alive.get(tag);
    if (life && life.owner !== owner) {
      // 다른 사람의 '명령' — 앞 주인의 유닛은 죽고 번호가 재사용됐다(마인드컨트롤은
      // 드물어 무시한다). 앞 생애를 닫고 새로 연다.
      life.lastAtk = life.lastAtk ?? life.last;
      done.push(life);
      life = undefined;
      alive.delete(tag);
    }
    if (!life) {
      life = {
        tag, owner, kinds: new Map(), groupKinds: new Set(), bld: false,
        born: sec, last: sec, lastAtk: null, evAfterAtk: false, morphTo: null, cxl: null,
        solo: false, ev: [],
      };
      alive.set(tag, life);
    }
    return life;
  };
  const markKind = (life: Life, kind: string, sec: number): Life => {
    if (GROUP_MEMBERS[kind]) { life.groupKinds.add(kind); return life; }
    if (kindConflicts(life, kind)) {
      // 정체 충돌 — 태그 재사용. 앞 생애를 닫고 이 증거로 새 생애를 시작한다.
      done.push(life);
      alive.delete(life.tag);
      const next = lifeOf(life.tag, life.owner, sec);
      next.kinds.set(kind, 1);
      next.bld = BUILDING_NAMES.has(kind);
      return next;
    }
    life.kinds.set(kind, (life.kinds.get(kind) ?? 0) + 1);
    if (BUILDING_NAMES.has(kind)) life.bld = true;
    return life;
  };
  const pushEv = (life: Life, sec: number, x: number, y: number, f: number): void => {
    life.last = sec;
    if (life.lastAtk !== null) life.evAfterAtk = true;
    const prev = life.ev[life.ev.length - 1];
    // 같은 자리 연타는 한 점으로(스팸 클릭) — 초만 당겨 쓴다.
    if (prev && prev[3] === f && Math.abs(prev[1] - x) < 0.2 && Math.abs(prev[2] - y) < 0.2) {
      prev[0] = Math.round(sec);
      return;
    }
    life.ev.push([Math.round(sec), r1(x), r1(y), f]);
  };

  /* 태그별 '마지막 등장' 시각(요청 수리: 아콘만 많이 탔는데 프로브로 나온다) — 합체는
     짝을 지어 아콘을 만드는데, 어느 쪽 태그가 살아남는지는 리플레이가 말해 주지 않는다.
     합체 뒤에도 다시 명령·표적으로 나타나는 태그가 곧 살아남은 아콘이다. 미리 한 번 훑어
     그 시각을 적어 둔다. */
  const tagLastSeen = new Map<number, number>();
  for (const c of cmds) {
    const f9 = (c.Frame ?? 0) * SECONDS_PER_FRAME;
    for (const tg of c.UnitTags ?? []) {
      if (tg > 0 && tg !== 65535) tagLastSeen.set(tg, Math.max(tagLastSeen.get(tg) ?? -1, f9));
    }
    const ut9 = c.UnitTag ?? 0;
    if (ut9 > 0 && ut9 !== 65535) tagLastSeen.set(ut9, Math.max(tagLastSeen.get(ut9) ?? -1, f9));
  }
  for (const c of cmds) {
    const cmdName = nameOf(c.Type);
    if (!cmdName) continue;
    const sec = (c.Frame ?? 0) * SECONDS_PER_FRAME;
    const pid = c.PlayerID;

    // ── 선택·핫키 — 귀속의 뼈대. 관전자 것도 그대로 굴린다(관전자는 명령을 못 내려
    //    생애를 만들지 않는다). ──
    if (cmdName === "Select") { sel.set(pid, [...(c.UnitTags ?? [])]); continue; }
    if (cmdName === "Select Add") { sel.set(pid, [...(sel.get(pid) ?? []), ...(c.UnitTags ?? [])]); continue; }
    if (cmdName === "Select Remove") {
      const drop = new Set(c.UnitTags ?? []);
      sel.set(pid, (sel.get(pid) ?? []).filter((t) => !drop.has(t)));
      continue;
    }
    if (cmdName === "Hotkey") {
      const key = `${pid}:${typeof c.Group === "number" ? c.Group : nameOf(c.Group)}`;
      const how = nameOf(c.HotkeyType);
      if (how === "Assign") groups.set(key, [...(sel.get(pid) ?? [])]);
      else if (how === "Select") sel.set(pid, [...(groups.get(key) ?? [])]);
      continue;
    }
    if (!playing.has(pid)) continue;

    // ── 미니맵 핑(요청: 클릭 기록) — 좌표(픽셀)가 온전히 실려 온다. ──
    if (cmdName === "Minimap Ping") {
      const pp = posOf(c);
      if (pp) pings.push([Math.round(sec), r1(pp.x), r1(pp.y), pid]);
      continue;
    }

    const tags = sel.get(pid) ?? [];
    const orderName = nameOf(c.Order);
    const unitName = nameOf(c.Unit);
    const pos = posOf(c);

    // ── 연구 — 이름을 v1과 같은 자로 통일해 담는다(속업·클로킹 판정의 재료). ──
    const techName = nameOf(c.Tech);
    const upgradeName = nameOf(c.Upgrade);
    const research = techName || (upgradeName ? normalizeUpgradeName(upgradeName) : "");
    if (research) {
      const seenKey = `${pid}:${research}`;
      if (!upSeen.has(seenKey)) {
        upSeen.add(seenKey);
        ups.push([Math.round(sec), research, pid]);
        // 오버로드 수송은 이 연구 뒤에만(요청 ③의 오인 방지) — 연구 시간 어림 100초.
        if (research === "Ventral Sacs") ventralAt.set(pid, sec + 100);
      }
    }

    // ── 명령 → 골라 둔 번호들의 증거 ──
    const isOrder = cmdName === "Targeted Order" || cmdName === "Right Click";
    if (isOrder) totalOrders += 1;
    if (isOrder && tags.length > 0) attributed += 1;

    if (cmdName === "Build" || cmdName === "Build Addon" || cmdName === "Hatch") {
      // 건설 — 고른 것은 일꾼이고, 자리로 걸어가 짓는다. 건물은 물리 개체로 태어난다.
      // 좌표는 타일 단위 그대로다(posTileOf 주석).
      const bpos = posTileOf(c);
      const worker = RACE_WORKER[raceOf.get(pid) ?? ""] ?? "";
      // 일꾼의 직전 위치 증거 — 자리까지의 도착 시각을 어림하는 재료다(무르기 판정).
      let prevPt: UnitEv | null = null;
      const zergBuild = raceOf.get(pid) === "저그" && cmdName === "Build";
      for (const tag of tags) {
        let life = lifeOf(tag, pid, sec);
        if (worker && cmdName !== "Hatch") life = markKind(life, worker, sec);
        if (tags.length === 1) {
          for (let i = life.ev.length - 1; i >= 0; i -= 1) {
            if (life.ev[i][1] >= 0) { prevPt = life.ev[i]; break; }
          }
        }
        if (bpos) pushEv(life, sec, bpos.x, bpos.y, 2);
        /* 저그 건설은 드론이 건물로 '변태'다(지적: 해처리가 네모로 나옴 — 드론 태그가
           그대로 건물 태그가 되는데, 채굴 클릭 표가 많아 정체 다수결에서 Drone이 이겨
           건물 자리에 드론 이름의 개체가 섰다). 실제 엔진처럼 드론 생애를 여기서 닫고,
           같은 태그로 건물 생애를 새로 연다. */
        if (zergBuild && tags.length === 1 && unitName && bpos) {
          done.push(life);
          alive.delete(tag);
          const next = lifeOf(tag, pid, sec);
          next.kinds.set(unitName, 1);
          next.bld = true;
          life.morphTo = next;
          pushEv(next, sec, bpos.x, bpos.y, 2);
        }
      }
      if (bpos && unitName && cmdName !== "Hatch") {
        // 같은 일꾼이 도착 전에 다른 건설을 또 냈으면 앞의 것은 무른 것이다(드론 건물
        // 바꿔 앉히기 — v1 파서의 lastDroneBuild 무르기와 같은 현상).
        const prevPending = tags.length === 1 ? pendingBuild.get(tags[0]) : undefined;
        if (prevPending && !c.Queued && sec < prevPending.arrive) {
          const pb = built[prevPending.idx];
          if (pb.gone === null) { pb.gone = sec; pb.goneKind = "cxl"; }
        }
        built.push({
          owner: pid, kind: unitName, born: sec, x: bpos.x, y: bpos.y,
          builder: tags.length === 1 ? tags[0] : null, gone: null, goneKind: null, ev: [],
        });
        // 일꾼 하나가 낸 건설이면 무르기 판정 창을 연다(요청: SCV·프로브는 도착 전에
        // 다른 명령이 오면 그 건설은 취소). 도착 예상은 직전 위치에서 일꾼 걸음(3.5)로
        // 잰다 — 직전 위치를 모르거나 낡았으면(45초↑) 아예 안 무른다: 어림 창을 두면
        // "건설 내리고 곧장 자원 복귀"라는 정상 조작이 죄다 취소로 오판된다(실측 4:4
        // 에서 476채 중 196채). 모르면 지은 것으로 두는 쪽이 덜 틀린다.
        if (tags.length === 1 && prevPt && sec - prevPt[0] < 45) {
          const travel = Math.min(20, Math.max(1, Math.hypot(prevPt[1] - bpos.x, prevPt[2] - bpos.y) / 3.5));
          pendingBuild.set(tags[0], { sec, x: bpos.x, y: bpos.y, idx: built.length - 1, arrive: sec + travel });
        }
      }
      continue;
    }
    if (cmdName === "Cancel Build") {
      // 건설 취소 — 고른 것은 짓던 건물(태그)이다. 물리 건물과는 자리로 못 이어(취소
      // 커맨드엔 좌표가 없다) 그 사람의 '가장 최근에 시작한, 아직 살아 있는' 건설을
      // 무른 것으로 본다 — 취소는 대개 방금 잘못 앉힌 것을 무르는 조작이다.
      const cxlWorker = RACE_WORKER[raceOf.get(pid) ?? ""] ?? "";
      for (const tag of tags) {
        const life = lifeOf(tag, pid, sec);
        life.bld = true;
        if (life.cxl === null) life.cxl = sec;
        /* 저그 환불(지적: 일꾼 번호 승계) — 취소하면 드론이 같은 태그로 돌아온다.
           건물 생애를 여기서 닫고 드론 생애를 새로 열지 않으면, 그 뒤 그 드론의 명령이
           전부 건물 랠리로 오인돼 버려진다(건물 생애는 이동 증거를 안 받는다). */
        if (raceOf.get(pid) === "저그" && cxlWorker) {
          done.push(life);
          alive.delete(tag);
          const back = lifeOf(tag, pid, sec);
          back.kinds.set(cxlWorker, 1);
          life.morphTo = back;
        }
      }
      /* 어느 건물을 물렀나(지적: 저그 취소를 못 잡음) — 저그는 드론 태그가 그대로
         건물 태그라, 골라 둔 태그가 곧 짓던 그 건물이다(builder로 저장돼 있다). 태그로
         먼저 맞춰 보고, 안 맞으면(테란·프로토스 — 건물 제 태그라 builder와 다르다)
         '가장 최근에 시작한 살아 있는 건설'로 물러난다. */
      const byTagIdx = built.findIndex((b) =>
        b.owner === pid && b.gone === null && b.builder !== null && tags.includes(b.builder));
      if (byTagIdx >= 0) {
        built[byTagIdx].gone = sec;
        built[byTagIdx].goneKind = "cxl";
      } else {
        for (let i = built.length - 1; i >= 0; i -= 1) {
          const b = built[i];
          if (b.owner === pid && b.gone === null && sec - b.born < 180) {
            b.gone = sec;
            b.goneKind = "cxl";
            break;
          }
        }
      }
      continue;
    }
    if (cmdName === "Train" || cmdName === "Train Fighter") {
      // 생산 — 고른 것은 그 유닛을 뽑는 건물이다.
      const at = cmdName === "Train Fighter" ? "Carrier" : TRAIN_AT[unitName] ?? "";
      for (const tag of tags) {
        let life = lifeOf(tag, pid, sec);
        if (at) life = markKind(life, at, sec);
        pushEv(life, sec, -1, -1, 4);
      }
      /* 인터셉터 개수 실시간(요청) — Train Fighter 하나가 인터셉터 하나다:
         12.6초 뒤 +1, 여덟 상한. 캐리어 화력이 이 개수를 탄다. */
      if (cmdName === "Train Fighter" && tags.length > 0) {
        const ct = tags[0];
        const arr = icptOf.get(ct) ?? [];
        const cur = arr.length > 0 ? arr[arr.length - 1][1] : 0;
        if (cur < 8) arr.push([Math.round(sec + 12.6), Math.min(8, cur + 1)]);
        icptOf.set(ct, arr);
      }
      /* 원장 기입(요청: 모든 큐된 유닛) — Train 하나가 유닛 하나다. 같은 건물의
         큐는 꼬리를 물고 이어진다(다중 선택 Train은 첫 태그로 어림). */
      if (cmdName === "Train" && unitName && UNIT_FRAMES[unitName]) {
        const bldTag = tags.length > 0 ? tags[0] : null;
        const dur = UNIT_FRAMES[unitName] * 0.042;
        const tail = bldTag !== null ? prodTail.get(bldTag) ?? 0 : 0;
        const start = Math.max(sec, tail);
        const doneAt = start + dur;
        if (bldTag !== null) prodTail.set(bldTag, doneAt);
        ledger.push({ unit: unitName, pid, sec, done: doneAt, bldTag, cancelled: false, bound: false });
      }
      continue;
    }
    if (cmdName === "Unit Morph") {
      // 변태 — 라바→유닛이면 새 정체의 시작, 히드라→러커류면 앞 정체를 닫고 잇는다.
      const from = MORPH_FROM[unitName];
      for (const tag of tags) {
        let life = lifeOf(tag, pid, sec);
        if (from) {
          life = markKind(life, from, sec);
          // 앞 생애(히드라)를 변태로 닫고, 러커 생애를 새로 연다.
          done.push(life);
          alive.delete(tag);
          const next = lifeOf(tag, pid, sec);
          next.kinds.set(unitName, 1);
          life.morphTo = next;
          if (life.ev.length > 0) {
            const lastPt = life.ev[life.ev.length - 1];
            if (lastPt[1] >= 0) pushEv(next, sec, lastPt[1], lastPt[2], 3);
          }
        } else if (unitName) {
          life = markKind(life, unitName, sec);
        }
      }
      /* 라바 변태도 원장(요청) — 라바는 병렬이라 큐 직렬화 없이 제 시간에 나온다.
         저글링·스커지는 한 알에 두 마리. 히드라→러커류(MORPH_FROM)는 기존 유닛의
         변태라 새 출생이 아니다. */
      if (unitName && !MORPH_FROM[unitName] && UNIT_FRAMES[unitName]) {
        const dur = UNIT_FRAMES[unitName] * 0.042;
        const n = unitName === "Zergling" || unitName === "Scourge" ? 2 : 1;
        for (let zi = 0; zi < n; zi += 1) {
          ledger.push({ unit: unitName, pid, sec, done: sec + dur, bldTag: null, cancelled: false, bound: false });
        }
      }
      continue;
    }
    if (cmdName === "Building Morph") {
      const from = BUILDING_MORPH_FROM[unitName];
      for (const tag of tags) {
        let life = lifeOf(tag, pid, sec);
        if (from) life = markKind(life, from, sec);
        if (unitName) {
          /* 변태로 생애를 갈라 잇는다(지적: 크립 콜로니→성큰·스포어를 못 잡음 — 예전엔
             새 이름을 표에 +2로 얹었는데, 콜로니 표와 2:2로 비겨 옛 이름이 이겼다).
             콜로니 생애를 여기서 닫고 같은 태그·같은 자리로 새 정체의 생애를 연다 —
             해처리→레어→하이브·스파이어→그레이터도 같은 길이다. */
          const site = [...life.ev].reverse().find((v) => v[3] === 2 || v[3] === 5);
          done.push(life);
          alive.delete(tag);
          const next = lifeOf(tag, pid, sec);
          next.kinds.set(unitName, 1);
          next.bld = true;
          life.morphTo = next;
          if (site) next.ev.push([Math.round(sec), site[1], site[2], 2]);
        } else {
          life.last = sec;
        }
      }
      continue;
    }
    if (cmdName === "Cloak" || cmdName === "Decloak") {
      // 개인 클로킹(재질문: 투명화) — 레이스·고스트의 켬(f=14)·끔(f=15)을 그대로 싣는다.
      for (const tag of tags) {
        const life = lifeOf(tag, pid, sec);
        life.ev.push([Math.round(sec), -1, -1, cmdName === "Cloak" ? 14 : 15]);
        life.last = sec;
      }
      continue;
    }
    if (HALT_CMDS.has(cmdName) || cmdName === "Unsiege" || cmdName === "Unburrow"
      || cmdName === "Stim" || cmdName === "Merge Archon" || cmdName === "Merge Dark Archon"
      || cmdName === "Unload All" || cmdName === "Lift Off" || cmdName === "Land"
      || cmdName === "Cancel Train" || cmdName === "Unload") {
      const kind = USE_CMD_TO_UNIT[cmdName] ?? "";
      const isBld = BUILDING_ONLY_CMDS.has(cmdName);
      /* 합체는 '짝'이다(지적: 아콘만 많이 탔는데 한 기로 뭉쳤다) — 템플러 N기를 골라
         합체를 누르면 원작은 짝을 지어 floor(N/2)기의 아콘을 만든다(홀수 하나는 그대로
         남는다). 예전엔 명령 하나에 아콘 하나만 만들고 나머지를 그 아콘으로 녹여, 7기를
         고른 합체가 아콘 한 기가 됐다 — 그 뒤 실려 간 나머지 태그들은 아콘이 아닌 옛
         정체(템플러·프로브)로 남아 드랍 명단이 엉뚱해졌다.
         어느 태그가 살아남는지는 기록에 없으므로, 합체 뒤에도 다시 나타나는 태그를
         살아남은 쪽으로 본다(tagLastSeen). */
      if (cmdName === "Merge Archon" || cmdName === "Merge Dark Archon") {
        const kindName9 = cmdName === "Merge Archon" ? "Archon" : "Dark Archon";
        /* 합체에 들어간 태그는 그 순간 템플러다(수리: 드랍 명단의 질럿 한 기 —
           태그 27174는 549초에 질럿이던 태그를 템플러가 물려받은 것이었다). 지금 정체가
           템플러가 아니면 태그를 물려받은 것이므로, 옛 생애를 여기서 끝내고 템플러
           생애를 새로 연다 — 명령 자체가 증거라 어림이 아니다. */
        const srcKind0 = USE_CMD_TO_UNIT[cmdName] ?? "";
        for (const tg9 of tags) {
          const cur9 = alive.get(tg9);
          if (!cur9 || cur9.bld) continue;
          const mk9 = majorityKindOf2(cur9);
          if (mk9 === "" || mk9 === srcKind0) continue;
          /* 수송선이 선택에 섞여 있을 수 있다(실측: 674초 합체 선택에 셔틀 27174가
             끼어 있었다) — 합체는 템플러에게만 걸리므로 수송선은 건드리지 않는다. */
          if (isTransportLife(cur9)) continue;
          done.push(cur9);
          alive.delete(tg9);
          const fresh9 = lifeOf(tg9, pid, sec);
          if (srcKind0) fresh9.kinds.set(srcKind0, 5);
          const lp9 = [...cur9.ev].reverse().find((v) => v[1] >= 0);
          if (lp9) pushEv(fresh9, sec, lp9[1], lp9[2], 3);
        }
        const ordered9 = [...tags].sort(
          (a, b) => (tagLastSeen.get(b) ?? -1) - (tagLastSeen.get(a) ?? -1),
        );
        const pairs9 = Math.floor(ordered9.length / 2);
        for (let pi9 = 0; pi9 < pairs9; pi9 += 1) {
          const keepTag = ordered9[pi9];
          const eatTag = ordered9[ordered9.length - 1 - pi9];
          if (keepTag === eatTag) break;
          const keepLife = lifeOf(keepTag, pid, sec);
          const eatLife = lifeOf(eatTag, pid, sec);
          const lastPt9 = [...keepLife.ev].reverse().find((v) => v[1] >= 0)
            ?? [...eatLife.ev].reverse().find((v) => v[1] >= 0);
          done.push(keepLife);
          alive.delete(keepTag);
          done.push(eatLife);
          alive.delete(eatTag);
          const arch9 = lifeOf(keepTag, pid, sec + 4);
          arch9.kinds.set(kindName9, 9);
          if (lastPt9) pushEv(arch9, sec + 4, lastPt9[1], lastPt9[2], 3);
          keepLife.morphTo = arch9;
          eatLife.morphTo = arch9;
        }
        /* 짝을 못 지은 홀수 잔여(수리: 드랍 명단에 질럿 한 기가 섞였다) — 합체를 누른
           선택에 있었으니 템플러가 맞다. 정체를 못 박아 두지 않으면 그 태그의 옛
           생애(질럿 등)가 그대로 읽혀 엉뚱한 이름으로 실려 간다. */
        const srcKind9 = USE_CMD_TO_UNIT[cmdName] ?? "";
        if (ordered9.length % 2 === 1 && srcKind9) {
          const leftTag9 = ordered9[pairs9];
          if (leftTag9 !== undefined && alive.has(leftTag9)) {
            markKind(lifeOf(leftTag9, pid, sec), srcKind9, sec);
          }
        }
        continue;
      }
      let mergedTo: Life | null = null;
      for (const tag of tags) {
        let life = lifeOf(tag, pid, sec);
        if (kind) life = markKind(life, kind, sec);
        if (cmdName === "Merge Archon" || cmdName === "Merge Dark Archon") {
          /* 합체(지적: 아콘이 화면에 안 나옴) — Merge는 정체(하이/다크 템플러)만
             남기고 아콘을 안 만들었다. 두 템플러가 하나로 녹는다: 첫 태그가 4초 뒤
             아콘 생애로 이어지고, 나머지 선택 태그는 같은 생애로 흡수(morph)된다. */
          const lastPt9 = [...life.ev].reverse().find((v) => v[1] >= 0);
          done.push(life);
          alive.delete(tag);
          if (!mergedTo) {
            mergedTo = lifeOf(tag, pid, sec + 4);
            mergedTo.kinds.set(cmdName === "Merge Archon" ? "Archon" : "Dark Archon", 9);
            if (lastPt9) pushEv(mergedTo, sec + 4, lastPt9[1], lastPt9[2], 3);
          }
          life.morphTo = mergedTo;
          continue;
        }
        if (cmdName === "Land" && unitName) life = markKind(life, unitName, sec);
        if (isBld) life.bld = true;
        if (cmdName === "Unload All" || cmdName === "Unload") {
          // 하차(요청 ③) — 좌표가 없으면 수송선의 마지막 알려진 자리에서.
          // 이 명령도 수송선에게만 내려진다 — 태그를 명부에 못 박는다(위 주석).
          transTagOwner.set(tag, pid);
          const lp = [...life.ev].reverse().find((v) => v[1] >= 0);
          const up = posOf(c) ?? (lp ? { x: lp[1], y: lp[2] } : null);
          if (up) {
            pendUnload.push([sec + 1, tag, up.x, up.y]);
            unloadRiders(tag, sec + 1, up.x, up.y);
          }
        }
        if (cmdName === "Cancel Train") {
          // 원장 취소(사용자 말대로 '취소가 없다면' — 있으면 무른다) — 그 건물의 막내부터.
          for (let li = ledger.length - 1; li >= 0; li -= 1) {
            const it = ledger[li];
            if (it.cancelled || it.pid !== pid) continue;
            if (it.bldTag !== tag && it.bldTag !== null) continue;
            if (it.done <= sec) continue;
            it.cancelled = true;
            break;
          }
        }
        if (cmdName === "Land") {
          // 착륙 — 띄운 건물의 이사 목적지다(커맨드에 자리·건물 이름이 실려 온다).
          // 건설과 같은 타일 좌표다(posTileOf 주석).
          const lpos = posTileOf(c);
          if (lpos) pushEv(life, sec, lpos.x, lpos.y, 5);
          liftedTags.delete(tag);
        } else if (cmdName === "Lift Off") {
          pushEv(life, sec, -1, -1, 6);
          liftedTags.add(tag);
        } else if (cmdName === "Stim") {
          // 스팀(전수조사) — 제 피 10을 태워 잠깐 빨라진다: 증거 f=16.
          life.ev.push([Math.round(sec), -1, -1, 16]);
          life.last = sec;
        } else if (HALT_CMDS.has(cmdName)) {
          const lastPt = life.ev[life.ev.length - 1];
          if (lastPt && lastPt[1] >= 0) pushEv(life, sec, lastPt[1], lastPt[2], 3);
          // 시즈 판정은 커맨드 그대로(지적) — 켠 시각을 증거로 남긴다.
          if (cmdName === "Siege") life.ev.push([Math.round(sec), -1, -1, 8]);
        } else {
          if (cmdName === "Unsiege") life.ev.push([Math.round(sec), -1, -1, 9]);
          life.last = sec;
        }
      }
      continue;
    }
    if (!isOrder) continue;

    // ── 우클릭·표적 명령 ──
    const castKind = CAST_ORDER_TO_UNIT[orderName] ?? "";
    const isRally = orderName === "RallyPointTile" || orderName === "RallyPointUnit";
    /* 공격 명령인가(지적: 어택 찍으면 그 대상을 공격해야) — 어택류 오더거나, 남의
       개체를 찍은 우클릭이다. 표적 태그를 증거에 실어 재생기가 그 대상을 겨눈다. */
    const tgtTag0 = c.UnitTag ?? 0;
    /* 태그 유효성(기획서 2-C) — BW 태그는 11비트 인덱스+5비트 재활용 카운터라
       59392~65534도 정상 태그다. 무효는 65535뿐. */
    const tgtLife = tgtTag0 > 0 && tgtTag0 !== 65535 ? alive.get(tgtTag0) : undefined;
    /* 같은 팀은 적이 아니다(지적: 매딕은 아군 유닛도 치료) — 아군을 찍은 우클릭
       (수리·힐·따라가기)이 공격으로 잡히면 아군이 '공격받고 소식 없음'으로 죽는다. */
    const hostileClick = tgtLife !== undefined && !sameSide(tgtLife.owner, pid);
    const isAtkOrder = ATTACK_ORDERS.has(orderName) || orderName.startsWith("Attack")
      || (cmdName === "Right Click" && hostileClick);
    /* 수리·힐(지적: 일꾼 수리 파싱 + 매딕은 아군까지) — 명령 자체가 정체(SCV·매딕)를
       밝히고, 표적 자리로 걸어가 일하는 증거(f=10)가 된다. */
    const isFixOrder = orderName === "Repair" || orderName === "HealMove";
    /* 탑승(요청 ③) — 제(같은 사람) 수송선을 찍은 우클릭은 태우기다. */
    const overlordOnly = tgtLife !== undefined && tgtLife.kinds.has("Overlord")
      && !tgtLife.kinds.has("Dropship") && !tgtLife.kinds.has("Shuttle");
    /* 벙커 태우기(질문: 구현했나 — 이제 한다) — 제 벙커를 찍은 우클릭은 보병이 들어가는
       것이다. 수송선과 같은 승차(f=12) 증거로 남아 마커가 벙커 안으로 사라지고,
       Unload All이나 제 다음 명령에서 도로 나온다. */
    const isBunkerIn = cmdName === "Right Click" && tgtLife !== undefined
      && tgtLife.owner === pid && tgtLife.bld && tgtLife.kinds.has("Bunker");
    const isBoarding = (cmdName === "Right Click" && tgtLife !== undefined
      && tgtLife.owner === pid && !tgtLife.bld && isTransportLife(tgtLife)
      // 오버로드는 수송 업그레이드 전엔 못 태운다 — 초반 '따라가기' 클릭 오인 방지.
      && (!overlordOnly || (ventralAt.get(pid) ?? Infinity) <= sec)) || isBunkerIn;
    /* 정체 미상 표적을 찍은 우클릭은 '탑승 후보'로 적어 둔다(위 주석 ⓑ) — 그 태그가
       뒤에 수송선으로 확정되면 그때 승선으로 승격한다. 지금 아는 것이 없어도 기록은
       남으므로, 태그를 놓치는 일이 없다. */
    if (cmdName === "Right Click" && pos && !isBoarding && tgtTag0 > 0 && tgtTag0 !== 65535
      && (tgtLife === undefined || (tgtLife.owner === pid && !tgtLife.bld))) {
      for (const tag of tags) {
        if (tag !== tgtTag0) pendBoard.push([sec, tag, tgtTag0, pos.x, pos.y, pid]);
      }
    }
    // 자원 클릭 → 일꾼(시작 직후의 통째 선택은 빼고 — 오버로드 오염 방지).
    const resourceClick = cmdName === "Right Click" && RESOURCE_TARGETS.has(unitName)
      && !((c.Frame ?? 0) < EARLY_ALL_SELECT_FRAMES && tags.length >= 4);
    for (const tag of tags) {
      let life = lifeOf(tag, pid, sec);
      if (tags.length === 1) life.solo = true;
      /* 탑승 중 제 명령(요청 ③) — 이미 내렸다는 증거다: 장부에서 지운다. */
      if (riderIn.has(tag) && !isBoarding) {
        const tt = riderIn.get(tag)!;
        riderIn.delete(tag);
        ridersOf.set(tt, (ridersOf.get(tt) ?? []).filter((x) => x !== tag));
      }
      /* 역방향 승선(지적: 셔틀 드랍인데 유닛이 직접 걸어감) — 수송선을 골라 둔 채
         제 유닛을 우클릭해도 태우기다: 찍힌 유닛을 승선 장부에 올리고 수송선은
         그 자리로 이동한다. */
      if (cmdName === "Right Click" && pos && !life.bld && isTransportLife(life)
        && tgtLife !== undefined && tgtLife !== life && tgtLife.owner === pid
        && !tgtLife.bld && !isTransportLife(tgtLife)
        && (!life.kinds.has("Overlord") || (ventralAt.get(pid) ?? Infinity) <= sec)) {
        tgtLife.ev.push([Math.round(sec), r1(pos.x), r1(pos.y), 12, tag]);
        tgtLife.last = sec;
        if (riderIn.has(tgtTag0)) {
          const tt9 = riderIn.get(tgtTag0)!;
          ridersOf.set(tt9, (ridersOf.get(tt9) ?? []).filter((x) => x !== tgtTag0));
        }
        riderIn.set(tgtTag0, tag);
        ridersOf.set(tag, [...(ridersOf.get(tag) ?? []).filter((x) => x !== tgtTag0), tgtTag0]);
        pushEv(life, sec, pos.x, pos.y, 0);
        continue;
      }
      if (isBoarding && tag !== tgtTag0 && pos && !life.bld) {
        if (isBunkerIn) {
          // 벙커는 보병만 탄다 — 기계·대형이 섞인 선택이면 그들은 그냥 이동이다.
          const mk3 = majorityKindOf2(life);
          if (mk3 !== "" && !["Marine", "Firebat", "Ghost", "Medic"].includes(mk3)) {
            pushEv(life, sec, pos.x, pos.y, 0);
            continue;
          }
        }
        life.ev.push([Math.round(sec), r1(pos.x), r1(pos.y), 12, tgtTag0]);
        life.last = sec;
        riderIn.set(tag, tgtTag0);
        ridersOf.set(tgtTag0, [...(ridersOf.get(tgtTag0) ?? []), tag]);
        continue;
      }
      if (castKind) life = markKind(life, castKind, sec);
      if (resourceClick) {
        const worker = RACE_WORKER[raceOf.get(pid) ?? ""] ?? "";
        if (worker) life = markKind(life, worker, sec);
      }
      if (isRally) {
        life.bld = true;
        // 랠리 좌표를 남긴다(요청: 원장 유닛이 완성되면 여기로 간다).
        if (pos) (life.rallies ??= []).push([Math.round(sec), r1(pos.x), r1(pos.y)]);
        pushEv(life, sec, -1, -1, 4);
        continue;
      }
      /* (걷음) 이동 명령의 건설 무르기 — "건설을 내리고 곧장 자원으로 복귀"가 흔한
         정상 조작이라, 일꾼의 직전 증거만으로는 도착 전·후를 못 가려 오판이 압도한다
         (실측 4:4에서 물리건물 476채 중 185채 취소 — 실제 경기에선 있을 수 없는 수).
         무르기는 확실한 근거 둘만 남긴다: 명시적 취소 커맨드(Cancel Build)와 같은
         일꾼의 도착 전 재건설(아래 Build 분기). 이동 무르기의 진짜 판정은 나중 증거
         (그 건물의 생산·피격 기록)로 뒤집는 후방 보정 쪽이 맞는 길이다. */
      if (pos) pendingBuild.delete(tag);
      if (pos && life.bld && liftedTags.has(tag)) {
        // 비행 클릭(요청) — 뜬 건물이 나는 길. 착륙 전까지의 이동 자취다.
        pushEv(life, sec, pos.x, pos.y, 0);
        continue;
      }
      if (pos && !life.bld) {
        if (isFixOrder) {
          life.last = sec;
          life.ev.push([Math.round(sec), r1(pos.x), r1(pos.y), 10, tgtTag0]);
        } else if (isAtkOrder) {
          life.last = sec;
          if (life.lastAtk !== null) life.evAfterAtk = true;
          /* 표적 태그는 명시적 어택류 오더면 무조건 싣는다(기획서 2-A — 수리: 표적에
             Life(명령 이력)가 없으면 atg=0이 돼 시작 홀 등은 원천적으로 못 겨눴다).
             hostileClick은 우클릭을 어택으로 격상하는 판정에만 쓴다. */
          life.ev.push([Math.round(sec), r1(pos.x), r1(pos.y), 7,
            ATTACK_ORDERS.has(orderName) || orderName.startsWith("Attack") || hostileClick ? tgtTag0 : 0]);
        } else {
          pushEv(life, sec, pos.x, pos.y, 0);
        }
      } else life.last = sec;
    }

    if (tgtTag0 > 0 && tgtTag0 !== 65535
      && ["CastIrradiate", "FireYamatoGun", "CastSpawnBroodlings", "CastDefensiveMatrix", "CastLockdown"].includes(orderName)) {
      targCast.push({ tag: tgtTag0, sec, tech: CAST_ORDER_TO_TECH[orderName] ?? orderName });
    }
    /* MoveUnload(요청 ③) — 수송선이 그 자리로 가서 쏟는다: 도착 어림 4초 뒤 하차.
       이 명령은 수송선에게만 내릴 수 있으므로, 그때 선택돼 있던 태그는 수송선이
       확실하다(요청: 태그를 놓치지 않는 근본 원리) — 명부에 못 박는다. */
    if (orderName === "MoveUnload" && pos) {
      for (const tag of tags) {
        /* 섞인 선택 방어 — 셔틀과 질럿을 함께 잡은 채 MoveUnload를 내리면 질럿까지
           수송선으로 못 박힌다. 이미 정체를 아는데 수송선이 아닌 태그는 뺀다. */
        const l9 = alive.get(tag);
        if (l9 && majorityKindOf2(l9) !== "" && !isTransportLife(l9)) continue;
        transTagOwner.set(tag, pid);
        pendUnload.push([sec + 4, tag, pos.x, pos.y]);
        unloadRiders(tag, sec + 4, pos.x, pos.y);
      }
    }
    // ── 마법 — 좌표가 남는 것만(스톰·스웜·리콜·마인…). 이름은 v1과 같은 기술명이다. ──
    const castTech = CAST_ORDER_TO_TECH[orderName]
      ?? (orderName === PLACE_MINE_ORDER ? "Spider Mines" : "");
    if (castTech && pos && tags.length > 0) {
      casts.push([Math.round(sec), r1(pos.x), r1(pos.y), castTech, pid]);
    }

    // ── 찍힌 대상 — 그 순간 거기 '있던' 개체다(강한 앵커). 공격이면 죽음의 근거가 된다. ──
    const targetTag = c.UnitTag ?? 0;
    if (targetTag > 0 && targetTag !== 65535 && pos) {
      const target = alive.get(targetTag);
      if (target) {
        anchors += 1;
        pushEv(target, sec, pos.x, pos.y, 1);
        const hostile = !sameSide(target.owner, pid)
          && (ATTACK_ORDERS.has(orderName) || cmdName === "Right Click" || orderName === "");
        if (hostile) { target.lastAtk = sec; target.evAfterAtk = false; }
      }
    }
    // 물리 건물 곁을 노린 공격 — 대상을 찍었든(우클릭 포함) 어택무브로 땅을 찍었든, 남의
    // 건물 발치의 공격 명령은 그 건물이 맞고 있다는 증거다(실측: 1:1 경기의 건물 공격이
    // 어택무브뿐이라 태그 표적만 보면 0건으로 잡혔다). 자리로 잇는다.
    if (pos && (ATTACK_ORDERS.has(orderName)
      || (targetTag > 0 && targetTag !== 65535 && cmdName === "Right Click"))) {
      for (const b of built) {
        // 아군 건물도 공격 대상이 아니다(같은 팀 오인 방지 — 위 sameSide 주석).
        if (sameSide(b.owner, pid) || sec < b.born) continue;
        /* 발자국 기준 판정(기획서 2-F) — 왼쪽 위 앵커 ±2.5 고정 박스는 4×3 건물의
           먼쪽(오른·아래 가장자리) 클릭을 흘렸다. 발자국 전체 +0.5 여유로 잡는다. */
        const [fw, fh] = FOOT_WH[b.kind] ?? [3, 2];
        if (pos.x >= b.x - 0.5 && pos.x <= b.x + fw + 0.5
          && pos.y >= b.y - 0.5 && pos.y <= b.y + fh + 0.5) {
          b.ev.push([Math.round(sec), r1(pos.x), r1(pos.y), 1]);
        }
      }
    }
  }

  for (const life of alive.values()) done.push(life);

  /* ── 태그 재사용 분리(요청: 체력 로직을 위한 태그 관리 개선) — 브루드워는 죽은
        유닛의 태그를 새로 태어난 유닛이 물려받는다. 한 태그를 한 생애로 묶으면
        ① 옛 유닛이 죽은 '뒤'의 새 유닛 증거가 생존 증거로 오인돼 빈사 부활 산포가
        같은 값으로 반복되고(체력이 8%쯤에 얼어붙는 증상), ② 전투 근처에도 안 간
        새 유닛이 옛 유닛의 누적 피해를 상속해 갑자기 빈사가 된다. 과분리(어택땅으로
        먼 좌표를 찍은 산 유닛을 자르는 것)를 막기 위해 세 증거가 다 맞을 때만 자른다:
        위치 증거가 90초 넘게 끊긴 채 20타일 밖에서 재등장 + 사라지기 직전 공격받고
        있었음 + 재등장 무렵(±90초) 같은 주인의 정체 맞는 생산 완성이 있음. 잘린
        뒤쪽은 spawned를 비워 생산 원장이 제 출생 이야기를 새로 붙일 수 있다. */
  {
    const queue = done.filter((l) => !l.bld && l.ev.length >= 2);
    for (let round = 0; round < 3 && queue.length > 0; round += 1) {
      const next: Life[] = [];
      for (const life of queue) {
        /* 시공간 공백만으론 못 가른다(실측: 분리 0건) — 명령 좌표는 유닛 위치가 아니라
           클릭한 '목표' 지점이라, 산 유닛의 먼 어택땅과 재사용 태그가 똑같이 보인다.
           강한 앵커(f=1)만은 유닛의 실제 위치다: 연속 앵커 사이 요구 속력이 물리적으로
           불가능하면(12타일 넘게를 초당 9타일 이상으로) 같은 유닛일 수 없다. 승하차
           (f=12/13)가 사이에 있으면 수송 이동이므로 제외한다. */
        let prevA: { i: number; v: UnitEv } | null = null;
        for (let vi = 0; vi < life.ev.length; vi += 1) {
          const v = life.ev[vi];
          if (v[1] < 0 || v[3] !== 1) continue;
          if (prevA
            && v[0] - prevA.v[0] >= 2
            && Math.hypot(v[1] - prevA.v[1], v[2] - prevA.v[2]) >= 12
            && Math.hypot(v[1] - prevA.v[1], v[2] - prevA.v[2])
              / Math.max(1, v[0] - prevA.v[0]) >= 9
            && !life.ev.slice(prevA.i + 1, vi).some((w) => w[3] === 12 || w[3] === 13)) {
            const rest = life.ev.splice(vi);
            const seg: Life = {
              tag: life.tag + 1000000,
              owner: life.owner,
              kinds: new Map(life.kinds),
              groupKinds: new Set(life.groupKinds),
              bld: false,
              born: rest[0][0],
              last: life.last,
              lastAtk: life.lastAtk !== null && life.lastAtk >= rest[0][0] ? life.lastAtk : null,
              evAfterAtk: false,
              morphTo: life.morphTo,
              cxl: null,
              solo: false,
              spawned: false,
              ev: rest,
            };
            life.last = life.ev[life.ev.length - 1][0];
            if (life.lastAtk !== null && life.lastAtk > life.last + 30) life.lastAtk = life.last;
            life.morphTo = null;
            done.push(seg);
            next.push(seg);
            break;
          }
          prevA = { i: vi, v };
        }
      }
      queue.length = 0;
      queue.push(...next);
    }
  }

  /* ── 뒤 스토리 보정: 시작 유닛(지적: 처음 오버로드가 안 나온다) — 개체는 첫 증거에서
        태어나는데, 시작 유닛의 첫 명령 '전' 이야기는 리플레이가 말해 준다: 본진에 서
        있었다. 저그의 이른(90초 안) 단독 선택 이동체 중 자원·건설·정체 증거가 하나도
        없는 첫 하나는 시작 오버로드다 — 그 시각에 홀로 움직일 다른 것이 없다(라바는
        선택돼도 명령을 못 받고, 드론은 자원 클릭이 남는다). 이른(45초 안) 일꾼도 본진
        에서 출발시킨다 — 어림 합성이 아니라 태어난 자리로 거슬러 얹는 보정이다. */
  {
    const startOf = new Map(
      players
        .filter((p) => typeof p.startX === "number" && typeof p.startY === "number")
        .map((p) => [p.id, [p.startX as number, p.startY as number] as const]),
    );
    const overlordSeen = new Set<number>();
    for (const life of [...done].sort((a, b) => a.born - b.born)) {
      const home = startOf.get(life.owner);
      if (!home) continue;
      const race = raceOf.get(life.owner) ?? "";
      const isUnknown = life.kinds.size === 0 && life.groupKinds.size === 0 && !life.bld;
      if (race === "저그" && life.born <= 90 && isUnknown && life.solo && !overlordSeen.has(life.owner)) {
        overlordSeen.add(life.owner);
        life.kinds.set("Overlord", 1);
        if (life.ev.length === 0 || life.ev[0][0] > 0) life.ev.unshift([0, r1(home[0]), r1(home[1]), 3]);
        life.born = 0;
      } else if (life.born <= 45 && !life.bld) {
        const worker = RACE_WORKER[race] ?? "";
        if (worker && life.kinds.has(worker)
          && (life.ev.length === 0 || life.ev[0][0] > 0)) {
          life.ev.unshift([0, r1(home[0]), r1(home[1]), 3]);
          life.born = 0;
        }
      }
    }
  }

  /* ── 생산 원장 해소(요청: 큰 그림 먼저 — 생산·이동·전투·죽음까지 모든 큐된 유닛의
        전 생애) — 원장의 각 항목에 출생지(만든 건물 발치)와 첫 행선지(랠리)를 정하고,
        실제 태그 증거와 결합한다: 결합되면 그 생애의 출생 이야기가 되고(무명이면
        정체까지), 끝내 안 집힌 유닛은 합성 개체로 스스로 산다 — 완성 시각에 태어나
        랠리로 걸어가고, 전투 사망 보정의 심판도 똑같이 받는다. ──────────────── */
  {
    /* 생산 건물 발자국 — 유닛은 건물 '아래쪽'(남쪽 출구)에서 나온다(요청). 건설 명령
       좌표는 발자국 왼위 앵커라, 가로는 가운데·세로는 바닥 아래 0.6타일에서 태어난다. */
    const PROD_FOOT: Record<string, [number, number]> = {
      "Command Center": [4, 3], Nexus: [4, 3], Hatchery: [4, 3], Lair: [4, 3], Hive: [4, 3],
      Barracks: [4, 3], Factory: [4, 3], Starport: [4, 3], Gateway: [4, 3], Stargate: [4, 3],
      "Robotics Facility": [3, 2],
    };
    // 건물 태그 → [태어난 초, 자리 x, y, 랠리들] — 변태 사슬은 최신 생애가 이긴다.
    const tagSites = new Map<number, { born: number; x: number; y: number; rallies: [number, number, number][] }[]>();
    for (const life of done) {
      if (!life.bld) continue;
      const site = [...life.ev].reverse().find((v) => v[3] === 2 || v[3] === 5);
      if (!site && !(life.rallies && life.rallies.length > 0)) continue;
      let bk9 = "";
      let bn9 = 0;
      for (const [k9, n9] of life.kinds) if (n9 > bn9) { bk9 = k9; bn9 = n9; }
      const [fw9, fh9] = PROD_FOOT[bk9] ?? [3, 2.5];
      const arr = tagSites.get(life.tag) ?? [];
      arr.push({
        born: life.born,
        x: site ? site[1] + fw9 / 2 : -1, y: site ? site[2] + fh9 + 0.6 : -1,
        rallies: life.rallies ?? [],
      });
      tagSites.set(life.tag, arr);
    }
    const hallsOf = (pid: number, at: number): { x: number; y: number }[] => built
      .filter((b) => b.owner === pid && ["Hatchery", "Lair", "Hive", "Command Center", "Nexus"].includes(b.kind)
        && b.born <= at && (b.gone === null || b.gone > at))
      // 홀도 아래쪽 출구(요청: 유닛은 건물 아래에서 생산) — 4×3 바닥 밑 0.6타일.
      .map((b) => ({ x: b.x + 2, y: b.y + 3.6 }));
    const lastRallyOf = (pid: number, at: number): [number, number] | null => {
      let best: [number, number] | null = null;
      let bs = -1;
      for (const life of done) {
        if (!life.bld || life.owner !== pid || !life.rallies) continue;
        for (const [rs, rx, ry] of life.rallies) {
          if (rs <= at && rs > bs) { bs = rs; best = [rx, ry]; }
        }
      }
      return best;
    };
    // ① 출생지·랠리 결정.
    const items = ledger.filter((it) => !it.cancelled).map((it, idx) => {
      let sx = -1;
      let sy = -1;
      let rally: [number, number] | null = null;
      if (it.bldTag !== null) {
        const cands = (tagSites.get(it.bldTag) ?? []).filter((c) => c.born <= it.done);
        const c = cands.length > 0 ? cands[cands.length - 1] : null;
        if (c && c.x >= 0) { sx = c.x; sy = c.y; }
        const rl = c ? c.rallies.filter(([rs]) => rs <= it.done) : [];
        if (rl.length > 0) rally = [rl[rl.length - 1][1], rl[rl.length - 1][2]];
      }
      if (sx < 0) {
        // 자리를 모르는 건물(라바 포함) — 그 종류의 실물 건물 중에서 고른다.
        const prodKind = TRAIN_AT[it.unit] ?? "";
        const pool = prodKind
          ? built.filter((b) => b.owner === it.pid && b.kind === prodKind
            && b.born + 40 <= it.done && (b.gone === null || b.gone > it.done))
            // 아래쪽 출구(요청) — 발자국 바닥 밑 0.6타일.
            .map((b) => ({
              x: b.x + (PROD_FOOT[prodKind]?.[0] ?? 3) / 2,
              y: b.y + (PROD_FOOT[prodKind]?.[1] ?? 2.5) + 0.6,
            }))
          : hallsOf(it.pid, it.done);
        if (pool.length > 0) {
          const pick = pool[idx % pool.length];
          sx = pick.x; sy = pick.y;
        }
      }
      if (!rally) rally = lastRallyOf(it.pid, it.done);
      // 오버로드·일꾼은 랠리를 안 탄다(오버로드는 제자리, 일꾼은 자원 배정).
      if (it.unit === "Overlord" || it.unit === RACE_WORKER[raceOf.get(it.pid) ?? ""]) rally = null;
      return { it, sx, sy, rally };
    }).filter((r) => r.sx >= 0);
    // ② 실제 생애와 결합 — 같은 사람·같은 정체(1차), 무명(2차). 완성 뒤 300초 안 첫 증거.
    const majorityOf = (life: Life): string => {
      let best = "";
      let bn = 0;
      for (const [k, n] of life.kinds) { if (n > bn) { best = k; bn = n; } }
      return best;
    };
    const candLives = done
      .filter((l) => !l.bld && l.tag > 0 && l.born > 5 && !l.spawned)
      .sort((a, b) => a.born - b.born);
    const attach = (life: Life, r: (typeof items)[number]): void => {
      const doneAt = Math.round(r.it.done);
      const inserts: UnitEv[] = [[doneAt, r1(r.sx), r1(r.sy), 3]];
      if (r.rally) {
        const wd = Math.hypot(r.rally[0] - r.sx, r.rally[1] - r.sy);
        const arriveAt = Math.round(doneAt + Math.min(30, wd / 4));
        if (life.ev.length === 0 || arriveAt < life.ev[0][0]) {
          inserts.push([arriveAt, r1(r.rally[0]), r1(r.rally[1]), 0]);
        }
      }
      life.ev.unshift(...inserts);
      life.born = Math.min(life.born, doneAt);
      life.spawned = true;
      r.it.bound = true;
    };
    for (const pass of [0, 1] as const) {
      for (const r of items) {
        if (r.it.bound) continue;
        for (const life of candLives) {
          if (life.spawned || life.owner !== r.it.pid) continue;
          if (life.born < r.it.done - 8 || life.born - r.it.done > 300) continue;
          const mk = majorityOf(life);
          if (pass === 0 ? mk !== r.it.unit : mk !== "") continue;
          if (pass === 1) life.kinds.set(r.it.unit, 1);
          attach(life, r);
          break;
        }
      }
    }
    // ③ 잔여는 합성 개체 — 한 번도 안 집힌 유닛도 태어나 랠리까지는 산다(요청).
    let synTag = -1000;
    let synN = 0;
    for (const r of items) {
      if (r.it.bound) continue;
      const doneAt = Math.round(r.it.done);
      const life: Life = {
        tag: synTag, owner: r.it.pid, kinds: new Map([[r.it.unit, 1]]), groupKinds: new Set(),
        bld: false, born: doneAt, last: doneAt, lastAtk: null, evAfterAtk: false,
        morphTo: null, cxl: null, solo: false, spawned: true,
        ev: [[doneAt, r1(r.sx), r1(r.sy), 3]],
      };
      if (r.rally) {
        const wd = Math.hypot(r.rally[0] - r.sx, r.rally[1] - r.sy);
        life.ev.push([Math.round(doneAt + Math.min(30, wd / 4)), r1(r.rally[0]), r1(r.rally[1]), 0]);
        life.last = life.ev[life.ev.length - 1][0];
      }
      done.push(life);
      synTag -= 1;
      synN += 1;
    }
    prodStats.total = ledger.length;
    prodStats.bound = items.filter((r) => r.it.bound).length;
    prodStats.syn = synN;
  }

  /* ── 뒤늦게 밝혀진 수송선으로 승하차 세우기(요청: 태그를 놓치지 않는 근본 원리) ──
        태울 때는 셔틀의 정체를 모를 수 있다 — 뽑아서 랠리만 걸어 둔 셔틀은 '선택'된 적이
        없어 생애도 정체도 없다. 그 사이 템플러가 셔틀을 우클릭하면 예전엔 그냥 이동이
        됐고, 드랍은 통째로 사라져 유닛이 제 발로 걸어가는 그림이 됐다(지적).
        이제 스트림을 다 읽어 수송선 태그가 확정된 뒤(MoveUnload·Unload가 못 박아 준다)
        보류해 둔 우클릭을 승선으로 승격한다. 하차는 그 수송선의 하차 기록에서 가장 가까운
        뒤 시각에 붙는다 — 태운 자리가 아니라 내린 자리에서 다시 나타난다.
        거리·지형 같은 간접 추측은 일절 쓰지 않는다(지적: 짧은 거리 드랍도 흔하다). */
  {
    const unloadsBy = new Map<number, [number, number, number][]>();
    for (const [usec, ttag, ux, uy] of pendUnload) {
      const arr = unloadsBy.get(ttag) ?? [];
      arr.push([usec, ux, uy]);
      unloadsBy.set(ttag, arr);
    }
    for (const arr of unloadsBy.values()) arr.sort((a, b) => a[0] - b[0]);
    /* 태그별 생애 색인(수리: 아콘이 탔는데 프로브가 탄 것으로 나왔다) — alive는 그 태그의
       '지금(경기 끝) 생애'를 주므로, 태그가 나중에 재사용되면 승선 증거가 엉뚱한 후대
       생애에 붙는다. 태운 시각에 살아 있던 생애를 골라야 한다. */
    const livesByTag = new Map<number, Life[]>();
    for (const l of [...done, ...alive.values()]) {
      if (l.bld) continue;
      const arr = livesByTag.get(l.tag) ?? [];
      arr.push(l);
      livesByTag.set(l.tag, arr);
    }
    for (const arr of livesByTag.values()) arr.sort((a, b) => a.born - b.born);
    const lifeAt = (tag: number, at: number): Life | null => {
      const arr = livesByTag.get(tag);
      if (!arr) return null;
      let found: Life | null = null;
      for (const l of arr) { if (l.born <= at + 1) found = l; else break; }
      return found;
    };
    let promoted = 0;
    for (const [bsec, rtag, ttag, bx, by, bpid] of pendBoard) {
      if (transTagOwner.get(ttag) !== bpid) continue;
      /* 수송선은 승객이 될 수 없다(수리: 셔틀 여덟이 서로 탄 것으로 나왔다) — 수송선
         여럿을 함께 잡은 채 무언가를 우클릭하면 그 선택 전부가 승객 후보로 적혔다. */
      if (transTagOwner.has(rtag)) continue;
      const rl = lifeAt(rtag, bsec);
      if (!rl || rl.bld || rl.owner !== bpid) continue;
      /* 정체가 수송선인 개체도 승객이 아니다(수리: 아콘과 함께 고른 셔틀이 명단에
         올랐다) — 수송선을 같이 고른 채 다른 수송선을 우클릭하면 따라갈 뿐이다. */
      if (isTransportLife(rl)) continue;
      // 이미 같은 시각에 승선 증거가 있으면 겹쳐 넣지 않는다.
      if (rl.ev.some((v) => v[3] === 12 && Math.abs(v[0] - bsec) < 1)) continue;
      const drop = (unloadsBy.get(ttag) ?? []).find(([usec]) => usec > bsec && usec - bsec < 600);
      if (!drop) continue; // 내린 기록이 없으면 태운 것도 아니다(따라가기 클릭일 뿐).
      rl.ev.push([Math.round(bsec), r1(bx), r1(by), 12, ttag]);
      rl.ev.push([Math.round(drop[0]), r1(drop[1]), r1(drop[2]), 13]);
      rl.ev.sort((a, b) => a[0] - b[0]);
      rl.last = Math.max(rl.last, drop[0]);
      promoted += 1;
    }
    void promoted;
  }

  /* ── 스타트 일꾼 넷(요청: 경기 시작부터 4기 + 명령·태그 번호 매핑 유지) — 시작 일꾼은
        생산된 적이 없어 원장에 없고, 처음 집히기 전까진 증거도 없어 화면에 늦게 나타났다.
        ① 이른 시기(150초 안)에 등장한 일꾼(또는 정체 미상) '태그' 생애의 앞쪽 4기를
           시작 홀 발치 출생(0초)으로 당긴다 — 그 태그가 나중에 받는 명령이 그대로 그
           일꾼의 자취다(요청: 명령·태그 매핑).
        ② 4기가 안 채워지면 나머지는 홀 발치의 합성 일꾼으로 세운다 — 채굴 왕복 표시가
           유휴 일꾼으로 받아 간다. */
  {
    const HALL_KINDS = new Set(["Command Center", "Nexus", "Hatchery", "Lair", "Hive"]);
    const hallOf = new Map<number, [number, number]>();
    for (const b of built) {
      if (b.born <= 5 && HALL_KINDS.has(b.kind) && !hallOf.has(b.owner)) {
        hallOf.set(b.owner, [b.x + 2, b.y + 1.5]);
      }
    }
    const byOwner = new Map<number, Life[]>();
    for (const life of done) {
      if (life.bld || life.spawned || life.born > 150) continue;
      // majorityKindOf는 아래에서 선언돼 인라인으로 같은 다수결을 쓴다.
      const mk = [...life.kinds.entries()].sort((k1, k2) => k2[1] - k1[1])[0]?.[0] ?? "";
      if (!(mk === "SCV" || mk === "Probe" || mk === "Drone" || mk === "")) continue;
      const arr = byOwner.get(life.owner) ?? [];
      arr.push(life);
      byOwner.set(life.owner, arr);
    }
    let synTag2 = -20000;
    for (const [pid, hall] of hallOf) {
      const arr = (byOwner.get(pid) ?? []).sort((x, y) => x.born - y.born).slice(0, 4);
      for (let i = 0; i < arr.length; i += 1) {
        const life = arr[i];
        if (life.born > 0) {
          life.born = 0;
          life.ev.unshift([0, r1(hall[0] - 1.5 + i), r1(hall[1] + 2), 3]);
        }
      }
      for (let i = arr.length; i < 4; i += 1) {
        done.push({
          tag: synTag2, owner: pid, kinds: new Map(), groupKinds: new Set(),
          bld: false, born: 0, last: 0, lastAtk: null, evAfterAtk: false,
          morphTo: null, cxl: null, solo: false, spawned: true,
          ev: [[0, r1(hall[0] - 1.5 + i), r1(hall[1] + 2), 3]],
        });
        synTag2 -= 1;
      }
    }
  }

  /* ── 뒤 스토리: 생산 출고(지적: 생산 모습이 없던 마린이 갑자기 나타나서 이동) —
        유닛 생애의 첫 증거는 첫 '명령'이라, 그 앞 이야기(생산 건물에서 나온 것)가
        비어 맵 한복판에서 솟아났다. 정체(모르면 종족 기본 생산소)의 생산 건물 중 첫
        증거에 가장 가까운 자기 건물 발치에서 걸어 나온 것으로 태어남을 당긴다.
        배럭·게이트 출신으로 잡힌 무명 개체는 일꾼일 수 없으니 기본 보병으로
        식별한다(지적: 마린 같은데 SCV로 태어나서 이동). */
  {
    const RACE_INFANTRY: Record<string, string> = { 테란: "Marine", 프로토스: "Zealot", 저그: "Zergling" };
    const RACE_PRODUCER: Record<string, string> = { 테란: "Barracks", 프로토스: "Gateway", 저그: "Hatchery" };
    for (const life of done) {
      if (life.bld || life.ev.length === 0 || life.spawned) continue;
      const first = life.ev.find((v) => v[1] >= 0);
      if (!first || first[0] < 40) continue;
      if (life.ev[0][0] === 0) continue; // 이미 본진 출발 보정을 받은 시작 유닛
      const race = raceOf.get(life.owner) ?? "";
      let kind = "";
      let kn = 0;
      for (const [k, n] of life.kinds) { if (n > kn) { kind = k; kn = n; } }
      if (kind === (RACE_WORKER[race] ?? "") && kind !== "") continue; // 일꾼은 자원 곁 탄생이 자연스럽다
      if (kind === "Overlord") continue;
      /* 합체·변태 유닛은 건물에서 안 나온다(지적) — 아콘은 템플러 둘이 녹은 자리에서,
         러커·가디언·디바우러는 제 몸이 변태한 자리에서 태어난다. 이 보정이 걸리면
         TRAIN_AT에 없는 정체가 종족 기본 생산소(프로토스=게이트)로 떨어져, 합체 자리
         대신 게이트 발치에서 걸어 나오는 그림이 됐다. */
      if (NOT_TRAINED.has(kind)) continue;
      const prodKind = (kind && TRAIN_AT[kind]) || RACE_PRODUCER[race] || "";
      if (!prodKind) continue;
      // 저그는 모두 해처리 계열 어느 것에서든 나온다.
      const prodSet = prodKind === "Hatchery" ? ["Hatchery", "Lair", "Hive"] : [prodKind];
      let best: { x: number; y: number } | null = null;
      let bd = 60; // 이보다 먼 출고는 억지라 안 잇는다(드랍 등).
      for (const b of built) {
        if (b.owner !== life.owner || !prodSet.includes(b.kind)) continue;
        if (b.born + 60 > first[0]) continue; // 아직 완공 전
        if (b.gone !== null && b.gone < first[0]) continue;
        const d = Math.hypot(b.x + 2 - first[1], b.y + 1.5 - first[2]);
        if (d < bd) { bd = d; best = { x: b.x + 2, y: b.y + 3 }; }
      }
      if (!best || bd < 3) continue; // 이미 건물 곁이면 그대로다
      const walkSec = Math.min(20, bd / 4);
      const departSec = Math.max(1, first[0] - walkSec);
      life.ev.unshift([Math.round(departSec), r1(best.x), r1(best.y), 3]);
      life.born = Math.min(life.born, departSec);
      if (kind === "" && (prodKind === "Barracks" || prodKind === "Gateway")) {
        life.kinds.set(RACE_INFANTRY[race] ?? "", 1);
      }
    }
  }

  /* ── 후방 보정 — 뒷결과로 앞을 고친다(지적). 태그별로 생애를 시간순으로 놓고,
        앞 생애의 죽음을 다음 생애의 태어남으로 눌러 잡는다. 공격받고 소식이 없으면
        그때 죽은 것으로, 공격받고도 증거가 이어졌으면 살아남은 것으로. ─────────── */
  const byTag = new Map<number, Life[]>();
  for (const life of done) {
    if (!byTag.has(life.tag)) byTag.set(life.tag, []);
    byTag.get(life.tag)!.push(life);
  }
  /* 전투 사망 뒤 스토리(지적: 전투 시뮬레이션 되는 거 맞아? 유닛들이 전혀 안 죽는데) —
     개별로 찍힌 죽음(표적 공격·번호 재사용)만으로는 큰 전투의 대부분이 산 채로 남는다.
     공격 명령이 뭉친 자리(전투)가 지나간 뒤로 증거가 하나도 없는 유닛은 그 전투에서
     죽은 것으로 본다 — 마지막 자리 곁(6타일)에 적의 공격 명령이 셋 이상, 5초 넘게
     이어졌을 때만이다(찌르기 한 번에 온 부대를 죽이지 않게). 죽는 시각은 전투 시작
     에서 태그 해시만큼(0~8초) 흩어 우수수 쓰러지게 한다. */
  /* 정체 다수결(사전) — 체력 원장과 공격 화력 계산에 쓰인다. */
  const majorityKindOf = (life: Life): string => {
    let best = "";
    let bn = 0;
    for (const [k, n] of life.kinds) { if (n > bn) { best = k; bn = n; } }
    return best;
  };
  const MELEE_UNITS = new Set(["Zergling", "Zealot", "Dark Templar", "Ultralisk", "Firebat", "SCV", "Probe", "Drone"]);
  const atkEvts: { sec: number; x: number; y: number; owner: number; dps: number; melee: boolean }[] = [];
  /* 표적 힐·수리(f=10) — 태그별 [초] 목록. 체력 원장의 회복 이벤트. */
  const healsAt = new Map<number, number[]>();
  /* 공격자 쪽 기술(전수조사) — 스팀은 12초 동안 공속 +35%, 적 인스네어에 젖으면
     -30%(공속 저하 지적), 디스럽션 웹 안에선 지상 공격이 거의 멎는다. */
  const slowCasts: [number, number, number, number][] = [];
  const webCasts: [number, number, number][] = [];
  for (const [csec, cxs, cys, tech, cpid] of casts) {
    if (tech === "Ensnare") slowCasts.push([csec, cxs, cys, cpid]);
    if (tech === "Disruption Web") webCasts.push([csec, cxs, cys]);
  }
  /* 디바우러 산성 포자(재지적: 공속 느려지는 것 — 인스네어 말고도) — 디바우러의
     공격이 닿은 언저리의 적 공중 유닛은 한동안 손이 무뎌진다. */
  const devAtk: [number, number, number, number][] = [];
  for (const life of done) {
    if (majorityKindOf(life) !== "Devourer") continue;
    for (const v of life.ev) {
      if (v[3] === 7) devAtk.push([v[0], v[1], v[2], life.owner]);
    }
  }
  for (const life of done) {
    const mk = majorityKindOf(life);
    const dps = (UNIT_STATS[mk] ?? DEFAULT_UNIT_STATS).dps;
    const melee = MELEE_UNITS.has(mk);
    const stims = life.ev.filter((v) => v[3] === 16).map((v) => v[0]);
    const isAirMk = AIR_UNITS.has(mk);
    const myIcpt = mk === "Carrier" ? icptOf.get(life.tag) ?? [] : null;
    for (const v of life.ev) {
      if (v[3] === 7) {
        let d = Math.max(3, dps);
        // 캐리어(요청) — 그 순간의 인터셉터 개수만큼만 때린다.
        if (myIcpt) {
          let ic = 0;
          for (const [is2, iv2] of myIcpt) { if (is2 <= v[0]) ic = iv2; else break; }
          d *= Math.max(0.1, ic / 8);
        }
        if (stims.some((ss) => v[0] - ss >= 0 && v[0] - ss <= 12)) d *= 1.35;
        if (isAirMk && devAtk.some(([ds2, dx2, dy2, do2]) => !sameSide(do2, life.owner)
          && v[0] - ds2 >= 0 && v[0] - ds2 <= 20 && Math.hypot(dx2 - v[1], dy2 - v[2]) <= 3)) d *= 0.75;
        if (slowCasts.some(([cs2, cx5, cy5, cp5]) => !sameSide(cp5, life.owner)
          && v[0] - cs2 >= 0 && v[0] - cs2 <= 25 && Math.hypot(cx5 - v[1], cy5 - v[2]) <= 3)) d *= 0.7;
        if (webCasts.some(([cs3, cx6, cy6]) =>
          v[0] - cs3 >= 0 && v[0] - cs3 <= 25 && Math.hypot(cx6 - v[1], cy6 - v[2]) <= 2.5)) d *= 0.1;
        atkEvts.push({ sec: v[0], x: v[1], y: v[2], owner: life.owner, dps: d, melee });
      }
      if (v[3] === 10 && (v[4] ?? 0) > 0) {
        const arr = healsAt.get(v[4] as number) ?? [];
        arr.push(v[0]);
        healsAt.set(v[4] as number, arr);
      }
    }
  }
  atkEvts.sort((a, b) => a.sec - b.sec);
  /* 업그레이드 반영(요청 ②) — 공업은 화력 +10%/렙, 방업은 받는 피해 -8%/렙(3렙 상한).
     이름의 부류(보병·차량·근접…)까지 가르는 건 이 근사 모델엔 과하다 — 연구 명령 뒤
     70초(연구 시간 어림)부터 그 사람 전체에 적용한다. */
  const wUpsBy = new Map<number, number[]>();
  const aUpsBy = new Map<number, number[]>();
  for (const [usec, uname, upid] of ups) {
    const isW = /Weapons|Attacks/.test(uname);
    const isA = /Armor|Plating|Carapace|Plasma Shields/.test(uname);
    if (!isW && !isA) continue;
    const m = isW ? wUpsBy : aUpsBy;
    const arr = m.get(upid) ?? [];
    arr.push(usec + 70);
    m.set(upid, arr);
  }
  const lvOf = (m: Map<number, number[]>, pid2: number, sec2: number): number =>
    Math.min(3, (m.get(pid2) ?? []).filter((u2) => u2 <= sec2).length);
  /* ── 체력 원장(요청: 체력·공격력을 지니고 이벤트를 겪는 생애주기) — 유닛이 제
        최대 체력으로 태어나, 곁에 떨어진 적 공격 명령의 화력만큼 깎이고 힐·수리로
        회복한다. 0에 닿았을 때 그 뒤 증거가 있으면 '살아남은 것'(뒤 스토리 — 체력
        바닥에서 회복 시작), 없으면 그때 죽은 것이다. 결과는 hp 퍼센트 변곡점 목록. */
  const posAtSec = (life: Life, sec: number, tol = 45): [number, number] | null => {
    let best: [number, number] | null = null;
    let bd = Infinity;
    for (const v of life.ev) {
      if (v[1] < 0) continue;
      const d = Math.abs(v[0] - sec);
      if (d < bd) { bd = d; best = [v[1], v[2]]; }
    }
    return bd <= tol ? best : null;
  };
  /* 갓 태어난 유닛은 만피다(지적: 태어나자마자 다쳐 있음) — 위 증거 창(±45초)이 어린
     유닛에게는 '태어나기 한참 뒤의 증거'로 출생 순간의 자리를 어림해, 본진을 겨눈 적
     어택 명령이 생산되자마자 체력을 깎았다. 산 지 얼마 안 된 시점의 피해는 그 무렵의
     증거가 정말 곁에 있을 때만 받는다. */
  const dmgTol = (life: Life, sec: number): number =>
    Math.min(45, Math.max(2, sec - life.born));
  /* ── 교전 원장(재지적: 전투 시뮬레이션이 제일 중요 — 체력 이슈의 근본) ─────────
        지금까지는 공격 명령 하나가 곁 7타일의 '모든' 유닛에게 각자 온전히 박혀, 20기
        뭉치 곁 명령 하나가 실제의 20배 피해가 됐다(전원 빈사 증후군). 또 클릭이 잦은
        사람일수록 화력이 커지는 역설도 있었다. 이제 피해를 '보존'한다:
        ① 공격 명령들을 시공간(8타일·12초)으로 뭉쳐 교전을 만들고,
        ② 교전 참가자를 그 시각의 위치로 가려 뽑은 뒤,
        ③ 한 편이 주는 총피해 = 참가 유닛 DPS 합 × 교전 시간 × 가동률(0.7)을
           상대편 참가자 수로 나눠 배분한다 — 명령 수가 아니라 병력이 화력을 정한다. */
  type Battle = {
    x: number; y: number; n: number; start: number; end: number;
    sides: Map<string, Life[]>;
  };
  const battles: Battle[] = [];
  for (const a of atkEvts) {
    let hit: Battle | null = null;
    for (let bi = battles.length - 1; bi >= 0; bi -= 1) {
      const b = battles[bi];
      if (a.sec - b.end > 12) break; // 시간순 입력이라 더 옛 교전은 볼 필요 없다.
      if (Math.hypot(a.x - b.x, a.y - b.y) <= 8) { hit = b; break; }
    }
    if (hit) {
      hit.end = Math.max(hit.end, a.sec);
      hit.x = (hit.x * hit.n + a.x) / (hit.n + 1);
      hit.y = (hit.y * hit.n + a.y) / (hit.n + 1);
      hit.n += 1;
    } else {
      battles.push({ x: a.x, y: a.y, n: 1, start: a.sec, end: a.sec, sides: new Map() });
    }
  }
  const sideKeyOf = (owner: number): string => {
    const tn = teamNoOf.get(owner);
    return tn === null || tn === undefined ? `o${owner}` : `t${tn}`;
  };
  for (const life of done) {
    if (life.bld) continue;
    const lastSec = life.ev.length > 0 ? life.ev[life.ev.length - 1][0] : life.last;
    for (const b of battles) {
      if (b.end < life.born || b.start > lastSec + 30) continue;
      const mid = (b.start + b.end) / 2;
      /* 참가 증거 창 조이기(재지적: 전투 없이 갑자기 빈사) — ±45초 창은 교전 40초
         '전'에 그 자리를 지나간 유닛까지 참가자로 끌어들여, 지나가기만 한 유닛이
         피해를 배분받았다. 창을 교전 길이에 비례(반길이+15초)로 죈다 — 실제 싸운
         유닛은 교전 중 제 명령 증거가 있어 걸리고, 스쳐 간 유닛은 빠진다. */
      const tol = Math.min(dmgTol(life, mid), (b.end - b.start) / 2 + 15);
      const pos = posAtSec(life, mid, tol);
      if (!pos || Math.hypot(b.x - pos[0], b.y - pos[1]) > 8) continue;
      const key = sideKeyOf(life.owner);
      const arr = b.sides.get(key) ?? [];
      arr.push(life);
      b.sides.set(key, arr);
    }
  }
  /** 생애 → 교전에서 받는 피해 조각들 [초, 양] — hpSim이 이 시간줄을 읽는다. */
  const battleDmgOf = new Map<Life, [number, number][]>();
  for (const b of battles) {
    const dur = Math.max(2, b.end - b.start + 2);
    for (const [key, mine] of b.sides) {
      let foeDps = 0;
      for (const [k2, list] of b.sides) {
        if (k2 === key) continue;
        for (const l2 of list) {
          const st2 = UNIT_STATS[majorityKindOf(l2)] ?? DEFAULT_UNIT_STATS;
          foeDps += Math.max(2, st2.dps) * (1 + 0.1 * lvOf(wUpsBy, l2.owner, b.start));
        }
      }
      if (foeDps <= 0) continue;
      const per = (foeDps * dur * 0.7) / mine.length;
      // 서서히 깎이게 교전을 2~5조각으로 나눈다.
      const chunks = Math.min(5, Math.max(2, Math.round(dur / 3)));
      for (const l3 of mine) {
        const arr = battleDmgOf.get(l3) ?? [];
        for (let ci = 0; ci < chunks; ci += 1) {
          arr.push([b.start + ((ci + 1) / chunks) * dur, per / chunks]);
        }
        battleDmgOf.set(l3, arr);
      }
    }
  }

  /* 메딕 상시 치료(재지적: 곁에 있고 이동 중이 아니면 계속 치료 — 아군(같은 팀)
     유닛까지) — 명령이 없어도 자동으로 낫는 게 원작이라, 힐 '명령'만으로는 한참
     모자랐다. 같은 편 메딕이 곁(4타일)에 있으면 생체 유닛은 싸움 중 피해가 줄고
     (×0.65), 소강기에 초당 2.2씩 아문다. 메딕의 정지 여부는 증거로 정확히 알 수
     없어 '곁에 있음'으로 갈음한다. */
  const MECH_UNITS = new Set([
    "Vulture", "Goliath", "Siege Tank", "Siege Tank (Tank Mode)", "Siege Tank (Siege Mode)",
    "Wraith", "Dropship", "Science Vessel", "Battlecruiser", "Valkyrie",
    "Probe", "Reaver", "Shuttle", "Observer", "Scout", "Carrier", "Arbiter", "Corsair",
  ]);
  const mediLives = done.filter((l) => !l.bld && majorityKindOf(l) === "Medic");
  const medicNearAt = (life: Life, sec: number): boolean => {
    const pos = posAtSec(life, sec, dmgTol(life, sec));
    if (!pos) return false;
    for (const m of mediLives) {
      if (!sameSide(m.owner, life.owner)) continue;
      if (sec < m.born - 2 || sec > m.last + 30) continue;
      const mp = posAtSec(m, sec);
      if (mp && Math.hypot(mp[0] - pos[0], mp[1] - pos[1]) <= 4) return true;
    }
    return false;
  };

  const hpSimOf = (life: Life): { trace: [number, number][]; death: number | null; splitVi?: number } => {
    const mk = majorityKindOf(life);
    const st = UNIT_STATS[mk] ?? DEFAULT_UNIT_STATS;
    const maxHp = st.hp;
    const maxSh = st.sh ?? 0;
    const max = maxHp + maxSh;
    const race3 = raceOf.get(life.owner) ?? "";
    const isAir = AIR_UNITS.has(mk);
    const healable = !MECH_UNITS.has(mk) && mediLives.length > 0;
    const lastEvSec = life.ev.length > 0 ? life.ev[life.ev.length - 1][0] : life.last;
    const heals = healsAt.get(life.tag) ?? [];
    /* 피해 시간줄 — 적 공격 명령(공업 반영) + 적 방어건물 화력(요청 ③: 성큰·캐논·
       벙커·터렛이 사거리 안 유닛을 실제로 깎는다)을 한 줄로 합친다. */
    const dmg: [number, number, string?][] = [];
    /* 스태시스(전수조사) — 얼음 속은 무적이다: 창 안의 피해를 걸러낸다. */
    const stasisSpans: [number, number][] = [];
    /* 다크스웜 — 스웜 아래선 원거리 피해가 거의 안 박힌다(근접은 그대로). */
    const swarmZones: [number, number, number][] = [];
    for (const [csec, cx7, cy7, tech] of casts) {
      if (tech === "Stasis Field") {
        const pos = posAtSec(life, csec);
        if (pos && Math.hypot(cx7 - pos[0], cy7 - pos[1]) <= 2) stasisSpans.push([csec, csec + 30]);
      }
      if (tech === "Dark Swarm") swarmZones.push([csec, cx7, cy7]);
    }
    /* 교전 배분 피해(교전 원장 주석) — 명령별 개별 타격 대신, 참가한 교전에서
       제 몫으로 나눠 받은 조각들이다. 스태시스 창은 무적, 다크스웜 아래선 크게
       줄어든다(근접·원거리 혼재라 0.35로 뭉뚱그린다). */
    for (const [bsec, bAmt] of battleDmgOf.get(life) ?? []) {
      if (stasisSpans.some(([sa, sb]) => bsec >= sa && bsec <= sb)) continue;
      let amt = bAmt;
      const pos = posAtSec(life, bsec, dmgTol(life, bsec));
      if (pos && swarmZones.some(([ws, wx, wy]) =>
        bsec - ws >= 0 && bsec - ws <= 25 && Math.hypot(wx - pos[0], wy - pos[1]) <= 2.5)) {
        amt *= 0.35;
      }
      dmg.push([bsec, amt]);
    }
    // 스팀 자해(전수조사) — 한 번에 피 10.
    for (const v of life.ev) {
      if (v[3] === 16) dmg.push([v[0], 10, "spell"]);
    }
    /* 주문 영향(재질문: 스톰·플레이그·이라디에잇·EMP 등) — 좌표 마법이 그 순간 그
       자리에 있던 개체를 잡는다. 스톰·이라디에잇은 방업 무시, EMP는 실드 소거,
       플레이그는 체력을 1/4로 무너뜨리되 죽이지는 못한다(원작 규칙). */
    for (const [csec, cx4, cy4, tech, cpid] of casts) {
      if (csec < life.born || csec > lastEvSec + 240) continue;
      if (tech === "Psionic Storm") {
        if (!isFoeOf(cpid, life.owner)) continue;
        const pos = posAtSec(life, csec, dmgTol(life, csec));
        if (pos && Math.hypot(cx4 - pos[0], cy4 - pos[1]) <= 2) dmg.push([csec, 90, "spell"]);
      } else if (tech === "EMP Shockwave") {
        const pos = posAtSec(life, csec);
        if (pos && Math.hypot(cx4 - pos[0], cy4 - pos[1]) <= 2.5) dmg.push([csec, 0, "emp"]);
      } else if (tech === "Plague") {
        if (!isFoeOf(cpid, life.owner)) continue;
        const pos = posAtSec(life, csec);
        if (pos && Math.hypot(cx4 - pos[0], cy4 - pos[1]) <= 2.5) dmg.push([csec, 0, "plague"]);
      }
    }
    let matrixFrom = -1;
    let matrixLeft = 250;
    /* 부활 눅임(재지적: 체력이 8%에서 더는 안 깎임) — 산 유닛을 죽였다는 건 이 유닛에
       대한 피해 배분이 과했다는 뜻이다. 되살릴 때마다 남은 물리 피해를 반쯤(0.55×)
       눅여, 죽음→같은 값 부활이 무한 반복되며 체력이 한 값에 얼어붙는 순환을 끊는다. */
    let dmgScale = 1;
    for (const tc of targCast) {
      if (tc.tag !== life.tag || tc.sec < life.born || tc.sec > lastEvSec + 240) continue;
      if (tc.tech === "Irradiate") dmg.push([tc.sec + 6, 130, "spell"], [tc.sec + 14, 90, "spell"]);
      else if (tc.tech === "Yamato Gun") dmg.push([tc.sec + 2, 260, "spell"]);
      else if (tc.tech === "Spawn Broodlings") dmg.push([tc.sec + 1, 9999, "spell"]);
      else if (tc.tech === "Defensive Matrix") matrixFrom = tc.sec;
    }
    // 핵(전수조사) — 찍힌 자리 곁 8타일은 초토화된다(발사까지 8초 어림).
    for (const [csec, cx8, cy8, tech, cpid] of casts) {
      if (tech !== "Nuclear Strike" || !isFoeOf(cpid, life.owner)) continue;
      if (csec < life.born || csec > lastEvSec + 240) continue;
      const pos = posAtSec(life, csec + 8);
      if (pos && Math.hypot(cx8 - pos[0], cy8 - pos[1]) <= 8) dmg.push([csec + 8, 466, "spell"]);
    }
    for (let vi = 0; vi < life.ev.length; vi += 1) {
      const v = life.ev[vi];
      if (v[1] < 0) continue;
      for (const sp of defSpots) {
        if (!isFoeOf(sp.owner, life.owner)) continue;
        if (v[0] < sp.from || v[0] > sp.to) continue;
        if (sp.air !== undefined && sp.air !== isAir) continue;
        if (Math.hypot(sp.x - v[1], sp.y - v[2]) > 7.5) continue;
        // 증거 사이 머문 시간만큼 두들긴다(6초 상한) — 스치기만 하면 조금만 깎인다.
        const nextSec = vi + 1 < life.ev.length ? life.ev[vi + 1][0] : v[0] + 4;
        dmg.push([v[0], sp.dps * Math.min(6, Math.max(1.5, nextSec - v[0]))]);
      }
    }
    dmg.sort((x, y) => x[0] - y[0]);
    /* 두 풀 + 종족 역학(재질문 반영: 유닛도 회복·실드) — 실드부터 깎이고, 이벤트
       사이엔 프로토스 실드가 초당 2%씩 도로 차며 저그 체력은 초당 0.6씩 아문다.
       테란 유닛은 저절로는 안 낫는다(수리·힐이 회복의 전부다). */
    let curHp = maxHp;
    let curSh = maxSh;
    let prevSec = life.born;
    let hi = 0;
    const trace: [number, number][] = [];
    const pct = (): number => Math.max(0, Math.round(((curHp + curSh) / max) * 20) * 5);
    let lastPct = 100;
    const flow = (from: number, to: number): void => {
      const dt = Math.min(600, Math.max(0, to - from));
      if (dt <= 0) return;
      if (maxSh > 0) curSh = Math.min(maxSh, curSh + maxSh * 0.02 * dt);
      if (race3 === "저그") curHp = Math.min(maxHp, curHp + 0.6 * dt);
      // 메딕 상시 치료(재지적) — 소강기에 곁에 있으면 초당 2.2씩 아문다(45초 상한).
      if (healable && curHp < maxHp && medicNearAt(life, to)) {
        curHp = Math.min(maxHp, curHp + 2.2 * Math.min(dt, 45));
      }
    };
    for (const [dsec, draw, dknd] of dmg) {
      flow(prevSec, dsec);
      prevSec = dsec;
      // 회복이 먼저 왔으면 반영 — 메딕 힐·SCV 수리 한 번에 체력 4할.
      while (hi < heals.length && heals[hi] <= dsec) {
        curHp = Math.min(maxHp, curHp + maxHp * 0.4);
        const p2 = pct();
        if (p2 !== lastPct) { trace.push([Math.round(heals[hi]), p2]); lastPct = p2; }
        hi += 1;
      }
      if (dknd === "emp") {
        curSh = 0;
        const pE = pct();
        if (pE !== lastPct) { trace.push([Math.round(dsec), pE]); lastPct = pE; }
        continue;
      }
      if (dknd === "plague") {
        curHp = Math.max(3, curHp * 0.25);
        const pP = pct();
        if (pP !== lastPct) { trace.push([Math.round(dsec), pP]); lastPct = pP; }
        continue;
      }
      // 방업 -8%/렙(주문은 무시). 실드 먼저. 부활 눅임(dmgScale)도 물리에만 탄다.
      let d2 = draw * (dknd === "spell" ? 1 : (1 - 0.08 * lvOf(aUpsBy, life.owner, dsec)) * dmgScale);
      // 디펜시브 매트릭스(전수조사) — 60초 동안 250까지 대신 받아 준다.
      if (matrixFrom >= 0 && dsec >= matrixFrom && dsec <= matrixFrom + 60 && matrixLeft > 0) {
        const absorb = Math.min(matrixLeft, d2);
        matrixLeft -= absorb;
        d2 -= absorb;
      }
      const fromSh = Math.min(curSh, d2);
      curSh -= fromSh;
      d2 -= fromSh;
      /* 메딕 경감(재지적: 실드는 못 채워줌) — 메딕은 살만 꿰맨다. 실드에 박히는
         피해는 그대로 두고, 실드를 뚫고 체력에 닿는 몫만 줄인다(주문은 못 막음). */
      if (d2 > 0 && dknd !== "spell" && healable && medicNearAt(life, dsec)) d2 *= 0.65;
      curHp -= d2;
      if (curHp <= 0) {
        const survived = life.ev.some((v) => v[1] >= 0 && v[0] > dsec + 2);
        if (survived) {
          /* 부활이 그럴듯한가(재질문: 죽여야 할 걸 살았다고 강제로 붙잡을 수 있다) —
             죽은 자리에서 다음 증거까지 유닛 최고 속도(초당 ~5타일)로도 못 가는
             거리·시간이면, 그 증거는 같은 유닛일 수 없다: 태그를 물려받은 새 유닛이다.
             그때는 진짜 죽음으로 접고, 꼬리 증거를 분리하라고 알린다(splitVi). */
          /* 최소 1개 증거는 부모에 남긴다(수리: splitVi 0이면 꼬리가 부모와 같아져
             무한 분열) — 죽음이 '모든' 증거보다 앞서면 출생 전 교전 조각이 만든 가짜
             죽음이므로 부활 쪽으로 흘린다. */
          const nvi = life.ev.findIndex((v) => v[1] >= 0 && v[0] > dsec + 2);
          if (nvi >= 1) {
            const dpos = posAtSec(life, dsec, 60);
            const nv = life.ev[nvi];
            if (dpos) {
              const spd = Math.hypot(nv[1] - dpos[0], nv[2] - dpos[1])
                / Math.max(1, nv[0] - dsec);
              if (spd > 6) {
                trace.push([Math.round(dsec), 0]);
                return { trace, death: dsec + 1 + (Math.abs(life.tag) % 4), splitVi: nvi };
              }
            }
          }
          /* 뒤 스토리 — 그 뒤에도 움직였으니 죽지 않았다. 남은 체력은 개체 번호로
             흩고(20~43%), 남은 피해는 눅여(위 dmgScale) 8% 언저리에 얼어붙지 않게. */
          dmgScale *= 0.55;
          curHp = maxHp * (0.2 + ((Math.abs(life.tag) * 37) % 24) / 100);
          curSh = 0;
          const pS = pct();
          if (pS !== lastPct) { trace.push([Math.round(dsec), pS]); lastPct = pS; }
          continue;
        }
        trace.push([Math.round(dsec), 0]);
        return { trace, death: dsec + 1 + (Math.abs(life.tag) % 4) };
      }
      const p3 = pct();
      if (p3 !== lastPct) { trace.push([Math.round(dsec), p3]); lastPct = p3; }
    }
    /* 남은 재생을 자취로(지적: 체력바 뜨는 유닛이 전부 같은 빨강 — 바닥을 친 유닛이
       10%에 얼어붙었다) — 이벤트 사이 재생(flow)은 값만 올리고 자취 점이 없어, 표시가
       마지막 사건의 퍼센트에 영영 멈췄다. 마지막 사건 뒤의 저그 체력·프로토스 실드
       재생을 중간·완료 두 점으로 남긴다. 테란은 원작대로 저절로 안 낫는다. */
    if (curHp + curSh < max - 0.5 && (race3 === "저그" || maxSh > 0)) {
      const durSh = maxSh > 0 ? (maxSh - curSh) / (maxSh * 0.02) : 0;
      const durHp = race3 === "저그" ? (maxHp - curHp) / 0.6 : 0;
      const dur = Math.max(durSh, durHp);
      if (dur > 1) {
        const endHp = race3 === "저그" ? maxHp : curHp;
        const endPct = Math.max(0, Math.round(((endHp + maxSh) / max) * 20) * 5);
        const midPct = Math.max(0, Math.round((((curHp + endHp) / 2 + (curSh + maxSh) / 2) / max) * 20) * 5);
        if (midPct !== lastPct) { trace.push([Math.round(prevSec + dur / 2), midPct]); lastPct = midPct; }
        if (endPct !== lastPct) trace.push([Math.round(prevSec + dur), endPct]);
      }
    }
    return { trace, death: null };
  };
  /* (이행기) hpSimOf는 세계 시뮬레이션이 대신한다 — 검증 비교용으로 남겨 둔 참조.
     다음 정리 때 battleDmgOf 배분과 함께 통째로 걷는다. */
  void hpSimOf;
  /* 편 가르기(팀 정보) — 같은 팀의 공격 명령·방어건물은 위협이 아니다(위 sameSide). */
  const isFoeOf = (a: number, b: number): boolean => !sameSide(a, b);
  /* 방어건물 자리 — 수비측이 명령 한 번 없이 성큰·캐논·벙커로 막아낸 싸움에서도
     공격측이 죽게(지적: 왜케 안 죽어), 마지막 증거가 적 방어건물 발치인 유닛을 잡는다. */
  const DEF_KINDS = new Set(["Sunken Colony", "Photon Cannon", "Bunker", "Missile Turret"]);
  /** 방어건물의 화력·표적(요청 ③) — air true는 공중만(터렛), false는 지상만(성큰),
   *  undefined는 둘 다(캐논·벙커). */
  const DEF_FIRE: Record<string, { dps: number; air?: boolean }> = {
    "Sunken Colony": { dps: 13, air: false },
    "Photon Cannon": { dps: 11 },
    Bunker: { dps: 14 },
    "Missile Turret": { dps: 9, air: true },
  };
  const defSpots: { owner: number; x: number; y: number; from: number; to: number; dps: number; air?: boolean }[] = [];
  for (const b of built) {
    if (DEF_KINDS.has(b.kind)) {
      const f = DEF_FIRE[b.kind] ?? { dps: 10 };
      defSpots.push({
        owner: b.owner, x: b.x + 1, y: b.y + 1, from: b.born + 40, to: b.gone ?? Infinity,
        dps: f.dps, ...(f.air !== undefined ? { air: f.air } : {}),
      });
    }
  }
  for (const life of done) {
    if (!life.bld) continue;
    let best = "";
    let bestN = 0;
    for (const [k, n] of life.kinds) { if (n > bestN) { best = k; bestN = n; } }
    if (!DEF_KINDS.has(best)) continue;
    const site = [...life.ev].reverse().find((v) => v[3] === 2 || v[3] === 5);
    if (!site) continue;
    const f2 = DEF_FIRE[best] ?? { dps: 10 };
    defSpots.push({
      owner: life.owner, x: site[1] + 1, y: site[2] + 1, from: life.born + 40, to: life.last + 300,
      dps: f2.dps, ...(f2.air !== undefined ? { air: f2.air } : {}),
    });
  }
  const battleDeathOf = (life: Life): number | null => {
    let lastPt: UnitEv | null = null;
    for (let i = life.ev.length - 1; i >= 0; i -= 1) {
      if (life.ev[i][1] >= 0) { lastPt = life.ev[i]; break; }
    }
    if (!lastPt) return null;
    const hits: number[] = [];
    for (const a of atkEvts) {
      if (!isFoeOf(a.owner, life.owner)) continue;
      if (a.sec < lastPt[0] - 2) continue;
      if (a.sec > lastPt[0] + 240) break;
      if (Math.hypot(a.x - lastPt[1], a.y - lastPt[2]) <= 7) hits.push(a.sec);
    }
    /* 문턱 완화(지적: 왜케 안 죽어) — 3발·5초는 큰 교전만 잡아, 수비측이 어택 한두
       번으로 끝낸 싸움에선 공격측이 안 죽었다. 마지막 증거 곁에 적 공격 명령이 2발만
       모여도(2초 이상) 그 뒤 소식 없는 유닛은 죽은 것으로 본다. */
    if (hits.length >= 2 && hits[hits.length - 1] - hits[0] >= 2) {
      return hits[0] + 1 + (life.tag % 8);
    }
    /* 방어건물 발치 사망 — 공격 명령(f=7)을 품은 유닛이 적 방어건물 곁(6타일)을
       마지막으로 소식이 없으면 거기서 산화한 것이다. 명령 없이 스쳐 지나가다 선
       유닛까지 죽이지 않게, 그 생애에 공격 명령이 있었을 때만이다. */
    if (life.ev.some((v) => v[3] === 7)) {
      const isAir2 = AIR_UNITS.has(majorityKindOf(life));
      const nd = defSpots.find((s) => isFoeOf(s.owner, life.owner)
        && (s.air === undefined || s.air === isAir2)
        && lastPt[0] >= s.from && lastPt[0] <= s.to
        && Math.hypot(s.x - lastPt[1], s.y - lastPt[2]) <= 6);
      if (nd) return lastPt[0] + 3 + (Math.abs(life.tag) % 6);
    }
    return null;
  };
  /* 건물 체력 원장(요청: 실드 차오름·저그 회복·테란 불·수리까지) — 곁에 떨어진 적
     공격 명령(+방어건물끼리는 없음)이 깎고, 이벤트 사이 시간엔 종족 역학이 흐른다:
     프로토스는 실드 풀만 초당 2%씩 차고, 저그는 체력이 초당 1.5씩 아물며, 테란은
     체력 1/3 아래로 내려가면 불붙어 초당 1.2씩 잦아든다(수리가 오면 다시 차오른다).
     0에 닿아도 그 뒤 증거(생산·랠리·발치 공격)가 있으면 살아남은 것이다. */
  const bldHpSimOf = (
    kind: string, owner: number, cx2: number, cy2: number,
    born2: number, until2: number, tag2: number | null,
    hasEvidenceAfter: (sec: number) => boolean,
  ): [number, number][] => {
    const race2 = raceOf.get(owner) ?? "";
    const [maxHp, maxSh] = BLD_STATS[kind]
      ?? (race2 === "프로토스" ? [500, 500] : [850, 0]) as [number, number];
    const total = maxHp + maxSh;
    let hp2 = maxHp;
    let sh2 = maxSh;
    const heals = tag2 !== null ? healsAt.get(tag2) ?? [] : [];
    let hi2 = 0;
    let prevSec = born2;
    const trace: [number, number][] = [];
    let lastPct = 100;
    const push2 = (sec3: number): void => {
      const p4 = Math.max(0, Math.round(((hp2 + sh2) / total) * 20) * 5);
      if (p4 !== lastPct) { trace.push([Math.round(sec3), p4]); lastPct = p4; }
    };
    const flow = (from: number, to: number): void => {
      // 이벤트 사이 종족 역학 — 상한 600초(그 이상은 수렴).
      const dt = Math.min(600, Math.max(0, to - from));
      if (dt <= 0) return;
      if (race2 === "프로토스") sh2 = Math.min(maxSh, sh2 + maxSh * 0.02 * dt);
      else if (race2 === "저그") hp2 = Math.min(maxHp, hp2 + 1.5 * dt);
      else if (hp2 > 0 && hp2 < maxHp / 3) hp2 = Math.max(1, hp2 - 1.2 * dt);
    };
    for (const a of atkEvts) {
      if (a.sec < born2 + 2) continue;
      if (a.sec > until2 + 60) break;
      if (!isFoeOf(a.owner, owner)) continue;
      if (Math.hypot(a.x - cx2, a.y - cy2) > 7) continue;
      flow(prevSec, a.sec);
      while (hi2 < heals.length && heals[hi2] <= a.sec) {
        hp2 = Math.min(maxHp, hp2 + maxHp * 0.35);
        push2(heals[hi2]);
        hi2 += 1;
      }
      let dmg2 = Math.min(120, a.dps * 1.6) * (1 + 0.1 * lvOf(wUpsBy, a.owner, a.sec));
      // 실드 먼저 깎인다.
      const fromSh = Math.min(sh2, dmg2);
      sh2 -= fromSh;
      dmg2 -= fromSh;
      hp2 -= dmg2;
      if (hp2 <= 0) {
        if (hasEvidenceAfter(a.sec + 3)) {
          hp2 = maxHp * 0.08;
          push2(a.sec);
        } else {
          trace.push([Math.round(a.sec), 0]);
          return trace;
        }
      } else push2(a.sec);
      prevSec = a.sec;
    }
    // 남은 회복·역학 한 번 더 — 불타다 소강했으면 그 값이 마지막 상태다.
    while (hi2 < heals.length) {
      hp2 = Math.min(maxHp, hp2 + maxHp * 0.35);
      push2(heals[hi2]);
      hi2 += 1;
    }
    return trace;
  };
  /* ── 세계 시뮬레이션(요청: 정속 이동·사거리 내 전투·번복 없는 죽음을 한 세계에서
        동시에) — 지금까지는 이동(증거 보간)·전투 참가(증거 창 어림)·죽음(체력 0 + 뒤
        증거)이 제각기 딴 세상을 어림해 서로 모순됐다. 이제 시간을 한 방향으로만 흘리며
        모든 유닛을 한 세계에서 굴린다:
        ① 명령 좌표는 위치가 아니라 '목표'다 — 유닛은 제 최고 속도로 목표를 향해
           틱(1초)마다 전진한다. 정속이고, 순간이동이 원천적으로 없다(수송 하차만 예외).
        ② 전투 피해는 시뮬 위치가 실제로 교전 반경(8타일) 안에 있는 틱에만 주고받는다 —
           지나간 유닛이 소급으로 얻어맞는 일이 구조적으로 사라진다.
        ③ 체력이 0에 닿으면: 다음 위치 증거가 제 속도로 닿을 수 있는 곳이면 피해 과대
           추정으로 보고 살리되 남은 피해를 눅이고(기존 원칙), 닿을 수 없는 곳이면 진짜
           죽음이다 — 그 뒤의 증거는 태그를 물려받은 새 유닛으로 갈라 그 자리에서 새로
           산다. 죽음은 번복되지 않는다. */
  const SIM_SPEED: Record<string, number> = {
    Zergling: 4.1, Hydralisk: 2.7, Lurker: 4.3, Ultralisk: 3.8, Defiler: 3.0, Drone: 3.0,
    Mutalisk: 5.0, Scourge: 5.0, Overlord: 1.8, Queen: 4.0, Guardian: 1.9, Devourer: 3.8,
    Marine: 3.0, Firebat: 3.0, Ghost: 3.0, Medic: 3.0, SCV: 3.0, Vulture: 4.8,
    Goliath: 3.5, "Siege Tank": 3.0, "Siege Tank (Tank Mode)": 3.0, "Siege Tank (Siege Mode)": 0.5,
    Wraith: 5.0, Dropship: 4.1, "Science Vessel": 3.8, Battlecruiser: 1.9, Valkyrie: 5.0,
    Probe: 3.7, Zealot: 3.0, Dragoon: 3.8, "High Templar": 2.4, "Dark Templar": 3.7,
    Archon: 3.7, "Dark Archon": 3.7, Shuttle: 3.4, Reaver: 1.8, Observer: 2.5,
    Scout: 5.0, Carrier: 2.5, Arbiter: 3.8, Corsair: 5.0,
  };
  const simHpOf = new Map<Life, [number, number][]>();
  const simDeathOf = new Map<Life, number>();
  {
    interface Agent {
      life: Life; kind: string; speed: number; air: boolean; healable: boolean;
      x: number; y: number; startAt: number; alive: boolean;
      hp: number; sh: number; maxHp: number; maxSh: number;
      evIdx: number; tgt: [number, number] | null; hidden: boolean;
      heals: number[]; healIdx: number;
      dmgScale: number; revives: number; lastPct: number;
      stasisUntil: number; matrixLeft: number; matrixUntil: number;
      trace: [number, number][];
    }
    const mkAgent = (life: Life): Agent | null => {
      if (life.bld) return null;
      const first = life.ev.find((v) => v[1] >= 0);
      if (!first) return null;
      const mk = majorityKindOf(life);
      const st = UNIT_STATS[mk] ?? DEFAULT_UNIT_STATS;
      return {
        life, kind: mk, speed: SIM_SPEED[mk] ?? 2.8, air: AIR_UNITS.has(mk),
        healable: !MECH_UNITS.has(mk) && mediLives.length > 0,
        x: first[1], y: first[2], startAt: Math.max(0, Math.min(first[0], life.born)),
        alive: true, hp: st.hp, sh: st.sh ?? 0, maxHp: st.hp, maxSh: st.sh ?? 0,
        evIdx: 0, tgt: null, hidden: false,
        heals: healsAt.get(life.tag) ?? [], healIdx: 0,
        dmgScale: 1, revives: 0, lastPct: 100,
        stasisUntil: -1, matrixLeft: 0, matrixUntil: -1,
        trace: [],
      };
    };
    const agents: Agent[] = [];
    for (const l of done) { const a = mkAgent(l); if (a) agents.push(a); }
    let simEnd = 0;
    for (const a of agents) simEnd = Math.max(simEnd, a.life.last + 8);
    for (const b of battles) simEnd = Math.max(simEnd, b.end + 4);
    simEnd = Math.min(simEnd, 3600 * 3);
    const pctOf = (a: Agent): number =>
      Math.max(0, Math.round(((a.hp + a.sh) / (a.maxHp + a.maxSh)) * 20) * 5);
    const mark = (a: Agent, sec: number): void => {
      const p = pctOf(a);
      if (p !== a.lastPct) { a.trace.push([Math.round(sec), p]); a.lastPct = p; }
    };
    /* 예약 피해(핵 낙하·이라디에잇 틱·야마토 착탄) — 초 버킷. */
    const pend = new Map<number, { a?: Agent; area?: [number, number, number, number]; amt: number; owner?: number }[]>();
    const schedule = (sec: number, item: { a?: Agent; area?: [number, number, number, number]; amt: number; owner?: number }): void => {
      const arr = pend.get(Math.round(sec)) ?? [];
      arr.push(item);
      pend.set(Math.round(sec), arr);
    };
    const swarms: [number, number, number][] = [];
    let deadTailN = 0;
    const hurt = (a: Agent, sec: number, amt: number, spell: boolean): void => {
      if (!a.alive || amt <= 0) return;
      if (sec < a.stasisUntil) return; // 얼음 속은 무적
      let d2 = amt;
      if (!spell) {
        d2 *= (1 - 0.08 * lvOf(aUpsBy, a.life.owner, sec)) * a.dmgScale;
        // 다크스웜 아래선 크게 준다(근접·원거리 뭉뚱그려 0.35).
        if (swarms.some(([ws, wx, wy]) => sec - ws >= 0 && sec - ws <= 25
          && Math.hypot(wx - a.x, wy - a.y) <= 2.5)) d2 *= 0.35;
      }
      if (a.matrixLeft > 0 && sec <= a.matrixUntil) {
        const ab = Math.min(a.matrixLeft, d2);
        a.matrixLeft -= ab;
        d2 -= ab;
      }
      const fromSh = Math.min(a.sh, d2);
      a.sh -= fromSh;
      d2 -= fromSh;
      // 메딕 곁 경감은 체력 몫만(실드는 못 채워 주니 못 막는다).
      if (d2 > 0 && !spell && a.healable && medicNearSim(a, sec)) d2 *= 0.65;
      a.hp -= d2;
      mark(a, sec);
      if (a.hp <= 0) onZero(a, sec);
    };
    const medicAgents: Agent[] = [];
    const medicNearSim = (a: Agent, sec: number): boolean => {
      for (const m of medicAgents) {
        if (!m.alive || m.hidden || sec < m.startAt) continue;
        if (!sameSide(m.life.owner, a.life.owner)) continue;
        if (Math.hypot(m.x - a.x, m.y - a.y) <= 4) return true;
      }
      return false;
    };
    const onZero = (a: Agent, sec: number): void => {
      const nv = a.life.ev.find((v) => v[1] >= 0 && v[0] > sec + 2);
      const reachable = nv
        ? Math.hypot(nv[1] - a.x, nv[2] - a.y) <= a.speed * 1.4 * Math.max(1, nv[0] - sec) + 2
        : false;
      if (nv && reachable && a.revives < 4) {
        // 산 유닛을 죽였다 = 배분 과대 — 살리되 남은 피해를 눅인다(기존 원칙 그대로).
        a.revives += 1;
        a.dmgScale *= 0.55;
        a.hp = a.maxHp * (0.2 + ((Math.abs(a.life.tag) * 37) % 24) / 100);
        a.sh = 0;
        mark(a, sec);
        return;
      }
      a.alive = false;
      a.trace.push([Math.round(sec), 0]);
      simDeathOf.set(a.life, Math.round(sec + 1 + (Math.abs(a.life.tag) % 4)));
      // 꼬리 분리 — 죽음 '뒤'의 증거는 태그를 물려받은 새 유닛이다(번복 없는 죽음).
      if (nv) {
        const vi = a.life.ev.indexOf(nv);
        if (vi >= 1) {
          const rest = a.life.ev.splice(vi);
          deadTailN += 1;
          const tail: Life = {
            tag: a.life.tag + 1000000 * deadTailN,
            owner: a.life.owner,
            kinds: new Map(a.life.kinds),
            groupKinds: new Set(a.life.groupKinds),
            bld: false,
            born: rest[0][0],
            last: rest[rest.length - 1][0],
            lastAtk: null,
            evAfterAtk: false,
            morphTo: a.life.morphTo,
            cxl: null,
            solo: false,
            spawned: true,
            ev: rest,
          };
          a.life.morphTo = null;
          a.life.last = a.life.ev.length > 0 ? a.life.ev[a.life.ev.length - 1][0] : a.life.born;
          done.push(tail);
          const bucket = byTag.get(tail.tag) ?? [];
          bucket.push(tail);
          byTag.set(tail.tag, bucket);
          const ta = mkAgent(tail);
          if (ta) { agents.push(ta); if (ta.kind === "Medic") medicAgents.push(ta); }
        }
      }
    };
    for (const a of agents) if (a.kind === "Medic") medicAgents.push(a);
    const castsSorted = [...casts].sort((c1, c2) => c1[0] - c2[0]);
    let ci = 0;
    const tCasts = [...targCast].sort((c1, c2) => c1.sec - c2.sec);
    let ti = 0;
    const agentsOfTag = new Map<number, Agent[]>();
    for (const a of agents) {
      const arr = agentsOfTag.get(a.life.tag) ?? [];
      arr.push(a);
      agentsOfTag.set(a.life.tag, arr);
    }
    for (let sec = 0; sec <= simEnd; sec += 1) {
      // 좌표 마법 — 그 순간 그 자리의 시뮬 위치가 맞는다.
      while (ci < castsSorted.length && castsSorted[ci][0] <= sec) {
        const [csec, cx, cy, tech, cpid] = castsSorted[ci];
        ci += 1;
        if (tech === "Dark Swarm") swarms.push([csec, cx, cy]);
        else if (tech === "Nuclear Strike") schedule(csec + 8, { area: [cx, cy, 8, 466], amt: 466, owner: cpid });
        else {
          for (const a of agents) {
            if (!a.alive || a.hidden || sec < a.startAt) continue;
            const dd = Math.hypot(cx - a.x, cy - a.y);
            if (tech === "Psionic Storm" && dd <= 2 && isFoeOf(cpid, a.life.owner)) hurt(a, csec, 90, true);
            else if (tech === "EMP Shockwave" && dd <= 2.5) { a.sh = 0; mark(a, csec); }
            else if (tech === "Plague" && dd <= 2.5 && isFoeOf(cpid, a.life.owner)) {
              a.hp = Math.max(3, a.hp * 0.25);
              mark(a, csec);
            } else if (tech === "Stasis Field" && dd <= 2) a.stasisUntil = csec + 30;
          }
        }
      }
      while (ti < tCasts.length && tCasts[ti].sec <= sec) {
        const tc = tCasts[ti];
        ti += 1;
        const targets = agentsOfTag.get(tc.tag) ?? [];
        const tgt = targets.find((a) => a.alive && sec >= a.startAt) ?? targets[0];
        if (tgt) {
          if (tc.tech === "Irradiate") { schedule(tc.sec + 6, { a: tgt, amt: 130 }); schedule(tc.sec + 14, { a: tgt, amt: 90 }); }
          else if (tc.tech === "Yamato Gun") schedule(tc.sec + 2, { a: tgt, amt: 260 });
          else if (tc.tech === "Spawn Broodlings") schedule(tc.sec + 1, { a: tgt, amt: 9999 });
          else if (tc.tech === "Defensive Matrix") { tgt.matrixLeft = 250; tgt.matrixUntil = tc.sec + 60; }
        }
      }
      const due = pend.get(sec);
      if (due) {
        for (const it of due) {
          if (it.a) hurt(it.a, sec, it.amt, true);
          else if (it.area) {
            const [ax, ay, ar, amt] = it.area;
            for (const a of agents) {
              if (!a.alive || a.hidden || sec < a.startAt) continue;
              if (it.owner !== undefined && !isFoeOf(it.owner, a.life.owner)) continue;
              if (Math.hypot(ax - a.x, ay - a.y) <= ar) hurt(a, sec, amt, true);
            }
          }
        }
        pend.delete(sec);
      }
      // 이동·명령 소화 — 정속, 순간이동 없음(수송 하차만 예외).
      for (const a of agents) {
        if (!a.alive || sec < a.startAt) continue;
        while (a.evIdx < a.life.ev.length && a.life.ev[a.evIdx][0] <= sec) {
          const v = a.life.ev[a.evIdx];
          a.evIdx += 1;
          if (v[3] === 12) { a.hidden = true; a.tgt = null; }
          else if (v[3] === 13) { a.hidden = false; if (v[1] >= 0) { a.x = v[1]; a.y = v[2]; a.tgt = null; } }
          else if (v[1] >= 0 && !a.hidden) a.tgt = [v[1], v[2]];
        }
        while (a.healIdx < a.heals.length && a.heals[a.healIdx] <= sec) {
          a.healIdx += 1;
          if (a.hp < a.maxHp) { a.hp = Math.min(a.maxHp, a.hp + a.maxHp * 0.4); mark(a, sec); }
        }
        if (a.hidden || sec < a.stasisUntil) continue;
        if (a.tgt) {
          const dx = a.tgt[0] - a.x;
          const dy = a.tgt[1] - a.y;
          const dd = Math.hypot(dx, dy);
          if (dd <= a.speed) { a.x = a.tgt[0]; a.y = a.tgt[1]; a.tgt = null; }
          else { a.x += (dx / dd) * a.speed; a.y += (dy / dd) * a.speed; }
        }
      }
      // 재생·메딕·방어건물 — 3초 묶음(가벼움 유지).
      if (sec % 3 === 0) {
        for (const a of agents) {
          if (!a.alive || sec < a.startAt) continue;
          const race9 = raceOf.get(a.life.owner) ?? "";
          if (a.maxSh > 0 && a.sh < a.maxSh) { a.sh = Math.min(a.maxSh, a.sh + a.maxSh * 0.02 * 3); mark(a, sec); }
          if (race9 === "저그" && a.hp < a.maxHp) { a.hp = Math.min(a.maxHp, a.hp + 0.6 * 3); mark(a, sec); }
          if (a.healable && a.hp < a.maxHp && !a.hidden && medicNearSim(a, sec)) {
            a.hp = Math.min(a.maxHp, a.hp + 2.2 * 3);
            mark(a, sec);
          }
          if (!a.hidden) {
            for (const sp of defSpots) {
              if (sec < sp.from || sec > sp.to) continue;
              if (!isFoeOf(sp.owner, a.life.owner)) continue;
              if (sp.air !== undefined && sp.air !== a.air) continue;
              if (Math.hypot(sp.x - a.x, sp.y - a.y) <= 7.5) hurt(a, sec, sp.dps * 3, false);
            }
          }
        }
      }
      // 교전 — 시뮬 위치가 반경(8타일) 안에 있는 틱에만 주고받는다.
      for (const b of battles) {
        if (sec < b.start || sec > b.end + 2) continue;
        const present = new Map<string, Agent[]>();
        for (const a of agents) {
          if (!a.alive || a.hidden || sec < a.startAt) continue;
          if (Math.hypot(b.x - a.x, b.y - a.y) > 8) continue;
          const key = sideKeyOf(a.life.owner);
          const arr = present.get(key) ?? [];
          arr.push(a);
          present.set(key, arr);
        }
        if (present.size < 2) continue;
        for (const [key, mine] of present) {
          let foeDps = 0;
          for (const [k2, list2] of present) {
            if (k2 === key) continue;
            for (const e2 of list2) {
              const st2 = UNIT_STATS[e2.kind] ?? DEFAULT_UNIT_STATS;
              foeDps += Math.max(2, st2.dps) * (1 + 0.1 * lvOf(wUpsBy, e2.life.owner, sec));
            }
          }
          if (foeDps <= 0) continue;
          const per = (foeDps * 0.7) / mine.length;
          for (const a of mine) hurt(a, sec, per, false);
        }
      }
    }
    for (const a of agents) {
      if (a.trace.length > 0) simHpOf.set(a.life, a.trace);
    }
  }
  const ents: UnitEnt[] = [];
  let lives = 0;
  for (const [, list] of byTag) {
    list.sort((a, b) => a.born - b.born);
    for (let i = 0; i < list.length; i += 1) {
      const life = list[i];
      lives += 1;
      const next = i + 1 < list.length ? list[i + 1] : null;
      let d: number | null = null;
      let dk: UnitEnt["dk"] = "";
      if (life.morphTo) {
        d = life.morphTo.born;
        dk = "morph";
      } else if (life.cxl !== null) {
        d = life.cxl;
        dk = "cxl";
      } else if (!life.bld && life.lastAtk !== null && !life.evAfterAtk) {
        /* 건물 가드(기획서 2-E) — 공격을 버텨낸 건물이 '주인의 후속 명령 부재'만으로
           lastAtk+4에 조기 사망 처리됐다. 건물 파괴는 물리 행(built)의 철거 판정과
           체력 원장이 정한다. */
        d = life.lastAtk + 4;
        dk = "atk";
      } else if (next) {
        d = Math.max(life.last, Math.min(next.born, life.last + 120));
        dk = "tag";
      }
      /* 체력 원장(요청) — 유닛은 스탯을 지니고 이벤트를 겪는다: 피격에 깎이고
         힐·수리에 차오르며, 0에 닿고 뒤 증거가 없으면 그 자리에서 죽는다. */
      let hpTrace: [number, number][] | undefined;
      if (!life.bld) {
        /* 세계 시뮬레이션 결과(요청: 정속·사거리 전투·번복 없는 죽음) — 체력 자취와
           죽음을 시뮬이 정하고, 재사용 꼬리는 시뮬이 이미 새 생애로 갈라 두었다. */
        const tr9 = simHpOf.get(life);
        if (tr9 && tr9.length > 0) hpTrace = tr9;
        const sd9 = simDeathOf.get(life);
        if (d === null && sd9 !== undefined) { d = sd9; dk = "atk"; }
      } else {
        // 건물 체력 원장(요청) — 자리를 아는 건물만.
        let site2 = [...life.ev].reverse().find((v) => v[3] === 2 || v[3] === 5);
        /* 자리 없는 건물 생애의 앵커 승격(기획서 2-D) — 시작 홀·테란/프로토스 건설
           건물은 f=2|5가 없어 표적 지도·체력 원장에서 빠졌다. 적 클릭 앵커(f=1)가
           둘 이상이면 그 중앙값(클릭은 그 건물 위였다)을 자리로 승격해 ev에 싣는다
           (중앙값-1.5 = 대략 왼쪽 위 앵커 — 기존 site 규약과 같은 기준점). */
        if (!site2) {
          const anchors3 = life.ev.filter((v) => v[3] === 1 && v[1] >= 0);
          if (anchors3.length >= 2) {
            const xs3 = anchors3.map((v) => v[1]).sort((q, w) => q - w);
            const ys3 = anchors3.map((v) => v[2]).sort((q, w) => q - w);
            site2 = [anchors3[0][0], r1(xs3[Math.floor(xs3.length / 2)] - 1.5),
              r1(ys3[Math.floor(ys3.length / 2)] - 1.5), 2];
            life.ev.unshift(site2);
          }
        }
        if (site2) {
          const mk2 = majorityKindOf(life);
          const tr2 = bldHpSimOf(
            mk2, life.owner, site2[1] + 1.5, site2[2] + 1.5,
            life.born, d ?? life.last, life.tag,
            (sec3) => life.ev.some((v) => v[0] > sec3),
          );
          if (tr2.length > 0) hpTrace = tr2;
        }
      }
      if (d === null && !life.bld) {
        // 체력 원장이 못 잡는 죽음(방어건물 화력은 공격 '명령'이 아니다) — 기존 보정.
        const bd2 = battleDeathOf(life);
        if (bd2 !== null) { d = bd2; dk = "atk"; }
      }
      if (next && d !== null && d > next.born) d = next.born;
      const race = raceOf.get(life.owner) ?? "";
      const icArr = icptOf.get(life.tag);
      ents.push({
        t: life.tag, o: life.owner, k: settleKind(life, race), b: Math.round(life.born),
        d: d === null ? null : Math.round(d), dk, bld: life.bld ? 1 : 0, ev: life.ev,
        ...(hpTrace ? { hp: hpTrace } : {}),
        ...(icArr && icArr.length > 0 ? { ic: icArr } : {}),
      });
    }
  }
  /* 물리 건물의 죽음(요청: 건물 파괴 파악) — 발치에 공격이 몰린 마지막 시각을 철거로
     보되, 격퇴 증거로 뒤집는다: 주인이 그 뒤(180초 안)에 곁(12타일)에 새로 지었으면
     자리를 지킨 것이다(v1의 격퇴 규칙과 같은 잣대 — 별도 테이블이니 결과를 비교한다).
     취소(무르기)로 이미 끝난 건물은 그대로 둔다. */
  for (const b of built) {
    if (b.gone === null && b.ev.length > 0) {
      const lastAtk = b.ev[b.ev.length - 1][0];
      const defended = built.some((o) =>
        o !== b && o.owner === b.owner && o.born > lastAtk && o.born < lastAtk + 180
        && Math.hypot(o.x - b.x, o.y - b.y) <= 12);
      if (!defended) { b.gone = lastAtk + 8; b.goneKind = "atk"; }
    }
    let bHp = bldHpSimOf(
      b.kind, b.owner, b.x + 1.5, b.y + 1.5, b.born, b.gone ?? b.born + 3600, null,
      (sec3) => b.ev.some((v) => v[0] > sec3) || b.gone === null || b.gone > sec3 + 30,
    );
    /* 붕괴 결합(기획서 2-E) — 명령 원장만으로는 체력 80~100%가 남은 채 철거 시각에
       돌연 무너졌다. 붕괴가 확정된 건물은 8초 전부터 0으로 선형 수렴시킨다. */
    if (b.gone !== null && bHp.length > 0) {
      const g8 = Math.max(b.born, b.gone - 8);
      const lastQ = [...bHp].reverse().find((q) => q[0] <= g8) ?? bHp[0];
      bHp = bHp.filter((q) => q[0] < g8);
      bHp.push([Math.round(g8), lastQ[1]], [Math.round(b.gone), 0]);
    }
    ents.push({
      t: -1, o: b.owner, k: b.kind, b: Math.round(b.born),
      d: b.gone === null ? null : Math.round(b.gone), dk: b.goneKind ?? "", bld: 1,
      ev: [[Math.round(b.born), r1(b.x), r1(b.y), 2], ...b.ev],
      ...(bHp.length > 0 ? { hp: bHp } : {}),
    });
  }

  return {
    v: 2,
    players: players.map((p) => ({ id: p.id, name: p.name, race: p.race, color: p.color ?? null })),
    ents,
    ups,
    casts,
    pings,
    stats: {
      cmds: totalOrders, attributed, anchors, lives, tags: byTag.size,
      prod: prodStats.total, prodBound: prodStats.bound, prodSyn: prodStats.syn,
    },
  };
}

/* ── 크기 지킴 직렬화 — 서버 저장 상한은 200만 자다(schemas.UnitTracksWrite). 아주 긴
      경기(빠른무한 팀전)는 증거 스트림이 그 위로 갈 수 있고, 그때 그냥 올리면 서버가
      422로 거절해 트랙이 조용히 빈다(지적: 재분석했는데 안 들어옴 — 실패가 안 보이는
      게 더 큰 문제였다). 넘치면 개체별 이동 증거(f=0)를 촘촘한 것부터 솎아 상한 안으로
      들여보낸다 — 앵커(1)·건설(2)·정지(3)·랠리(4)·이착륙(5·6)은 안 건드린다: 수가 적고
      생애·건물 판정의 근거다. ─────────────────────────────────────────────── */
const SERIALIZE_CAP = 1_900_000;
export function serializeUnitTracks(tracks: UnitTracksV2): string {
  let json = JSON.stringify(tracks);
  for (let round = 0; round < 4 && json.length > SERIALIZE_CAP; round += 1) {
    // 이동 증거가 많은 개체부터, 한 회마다 절반으로 솎는다(둘에 하나 — 시작·끝은 남긴다).
    const THIN_OVER = 24 >> round;
    for (const e of tracks.ents) {
      const moves = e.ev.filter((v) => v[3] === 0).length;
      if (moves <= THIN_OVER) continue;
      let nth = 0;
      e.ev = e.ev.filter((v, i) => {
        if (v[3] !== 0 || i === 0 || i === e.ev.length - 1) return true;
        nth += 1;
        return nth % 2 === 0;
      });
    }
    json = JSON.stringify(tracks);
  }
  /* 체력·앵커 솎기(수리: 긴 경기 8건이 상한을 넘어 업로드 거절 — 체력 자취·합성
     개체가 몸집을 키웠다) — 이동 솎기로 모자라면 체력 변곡점을 둘에 하나로(끝값은
     남긴다), 그다음 강한 앵커(f=1)를 둘에 하나로 줄인다. */
  for (let round = 0; round < 3 && json.length > SERIALIZE_CAP; round += 1) {
    for (const e of tracks.ents) {
      if (e.hp && e.hp.length > 6) {
        e.hp = e.hp.filter((_, i) => i % 2 === 0 || i === e.hp!.length - 1);
      }
      const anchors2 = e.ev.filter((v) => v[3] === 1).length;
      if (anchors2 > 8) {
        let nth2 = 0;
        e.ev = e.ev.filter((v) => {
          if (v[3] !== 1) return true;
          nth2 += 1;
          return nth2 % 2 === 0;
        });
      }
    }
    json = JSON.stringify(tracks);
  }
  return json;
}
