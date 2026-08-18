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
import { speedOfUnit } from "./bwUnits";
/* 전투 값은 표(bwUnits)를 직접 읽지 않고 어댑터(bwCombat)를 거친다(과제 #54).
   ─ 왜 이렇게 됐는가: 이 파일의 체력 원장은 유닛마다 dps 스칼라 하나(UNIT_STATS.dps)만
     보고 공격 종류(normal/concussive/explosive)·표적 크기 배수·방어력 뺄셈·쿨다운·
     대공/대지 구분을 통째로 무시했다(map-replayunits A-1·A-2·A-3). 그 탓에 무기가
     아예 없는 오버로드·메딕·드랍십까지 하한 max(2, dps)로 초당 2씩 때렸다.
   ─ bwUnits를 직접 읽지 않는 것은 규약이다: 몸 반지름을 더해 중심-중심 거리로 옮기는
     일이 bwCombat.reachTiles 한 곳에서만 일어나야 이중 가산이 안 난다.
   ─ bwUnits에서 계속 가져오는 것은 speedOfUnit 하나뿐이다(걸음은 전투가 아니다). */
import {
  attackOf, bunkerFallbackProfile, profileOf, targetFor, weaponVs,
  type CombatProfile, type ProfWeapon,
  upgradeSeconds,
} from "./bwCombat";
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
 *  (지적: 시즈 판정은 리플레이 커맨드 그대로 — 둘 다 위치 없음), 17 추정 자리(클릭
 *  중앙값으로 어림한 건물 자리 — 표적 지도·체력 원장만 쓰고 화면에는 안 그린다). */
export type UnitEv = [number, number, number, number, number?];
export interface UnitEnt {
  /** 유닛 번호. 물리 건물(끝내 선택된 적 없어 건설 좌표로만 아는 것)은 -1. */
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
    /** 무른 건설 — bldVoided: 선 적 없어 뺀 것, bldClosed: 겹침으로 철거를 닫은 것. */
    bldVoided?: number; bldClosed?: number;
    /** 폐기된 이동 목적지 — moveDropped: 못 닿아 뺀 것, moveKept: 닿은 것. */
    moveDropped?: number; moveKept?: number;
    /** 선택 동반으로 이름을 받은 무명 개체 수(과제 #71). */
    coSelFilled?: number;
    /** 원장 몫이 없어 동반이 물러난 횟수(과제 #71 — 원장이 위다). */
    coSelOverQuota?: number;
    /** 남은 원장 몫으로 이름을 받은 무명 개체 수(과제 #71). */
    quotaAssigned?: number;
    /** 몫을 넘겨서라도 동반으로 이름을 준 수(과제 #71 — 마지막 그물). */
    coSelOverFilled?: number;
    /** 건물이 무너져 취소된 생산 수(과제 #71). */
    prodRazed?: number;
    /** 출생 자리를 못 정해 버려진 원장 수(과제 #71). */
    prodNoSite?: number;
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
/** 홀 계보의 변태 — 시작 홀(건설 커맨드가 없어 자리 증거도 없는 것)을 이어 주는 자. */
const HALL_MORPHS = new Set(["Lair", "Hive"]);
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
/** 본진 건물 — 일꾼의 출발점을 모를 때 여기서 걸어온 것으로 친다. */
const HALL_KINDS = new Set<string>(["Hatchery", "Lair", "Hive", "Command Center", "Nexus"]);
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

/** 같은 유닛의 다른 표기를 하나로 모은다(과제 #71).
 *  screp은 자리마다 이름을 달리 준다 — Train 커맨드는 "Siege Tank (Tank Mode)"인데
 *  다른 자리에서는 맨 "Siege Tank"로 온다. 그대로 두면 한 유닛이 두 이름으로 갈려,
 *  원장 몫은 한쪽에 쌓이고 개체는 다른 쪽에 붙는다 — 실측으로 "뽑은 적 없는 이름"
 *  11기(경기3)·12기(경기1)가 전부 이것이었다.
 *  ★ 시즈 모드는 안 합친다 — 그건 표기가 아니라 진짜 다른 상태다(못 움직이고
 *    무기가 다르다). 렌더러도 시뮬도 둘을 갈라 쓴다. */
const KIND_ALIAS: Record<string, string> = {
  "Siege Tank": "Siege Tank (Tank Mode)",
};

/** screp이 '헛쳤다'고 표시한 커맨드인가 — 생산 원장에 적으면 안 되는 것들이다.
 *  지적: "인구 막힘·전력 끊김·건물 파괴 등 생산 취소도 넣어야 할 듯."
 *  screp의 표시는 그중 큐 넘침(연타로 큐가 다 찬 뒤의 클릭)을 잡아 준다 — 실측으로
 *  Train/Morph의 7%(경기1)·3%(경기3)가 여기 걸린다. 이걸 원장에 적으면 그만큼
 *  **없던 유닛이 합성돼** 화면에 선다. 표시가 완벽하진 않다는 것은 이 파일이 이미
 *  아는 사실이라(연구 중복 주석), 이건 걸러 낼 수 있는 것만 거르는 자리다. */
function ineffective(c: UnitCmd): boolean {
  const k = c.IneffKind;
  if (k === undefined || k === null) return false;
  const v = typeof k === "number" ? k : String(k);
  return v !== 0 && v !== "0" && v !== "" && v !== "Effective";
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
/** 스팀 명령(f=16)을 받은 개체의 정체를 바로잡는다.
 *
 *  지적: "스팀팩은 선택이 마린·파이어뱃으로 이루어져 있을 때만 쓸 수 있어."
 *  그러니 스팀 증거를 가진 개체는 정의상 마린 아니면 파이어뱃이다.
 *
 *  실측이 그 지적을 뒷받침한다. 스팀 증거를 가졌는데 그 둘이 아닌 이름이 붙은 개체를
 *  전수로 뜯어 보니, **제 정체를 말해 주는 증거가 하나도 없었다**:
 *    · 옛 저장본의 'SCV' 38기 — 건설(f=2)·수리(f=10) 0건. 이동·공격·스팀뿐.
 *    · 지금 분석의 '시즈 탱크' 8기 — 시즈(f=8) 0건.
 *    · '메딕' 3기 — 힐(f=10) 0건.
 *  이름은 생산 원장 결합에서 잘못 물려받은 것이고, 행동은 전부 마린이다.
 *
 *  그래서 스팀이 이긴다 — 다만 **제 증거를 가진 것은 지킨다**: 시즈를 켠 적이 있으면
 *  탱크고, 힐을 한 적이 있으면 메딕이다. 행동 증거끼리는 더 구체적인 쪽이 이기고,
 *  아무 증거도 없으면 스팀이 정한다. #62(버로우를 커맨드 증거로 판정)와 같은 이치다. */
const STIM_KINDS = new Set(["Marine", "Firebat"]);
function stimSettles(life: Life, kind: string): string {
  if (STIM_KINDS.has(kind)) return kind;
  if (!life.ev.some((v) => v[3] === 16)) return kind;
  // 제 증거가 있는 정체는 지킨다 — 시즈(8·9)는 탱크, 힐·수리(10)는 메딕·SCV.
  if (life.ev.some((v) => v[3] === 8 || v[3] === 9 || v[3] === 10 || v[3] === 2)) return kind;
  return life.kinds.has("Firebat") ? "Firebat" : "Marine";
}

function settleKind(life: Life, race: Race | ""): string {
  if (life.bld) return settleKindRaw(life, race);
  return stimSettles(life, settleKindRaw(life, race));
}

function settleKindRaw(life: Life, race: Race | ""): string {
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
  /* ── 선택 동반(과제 #71) — 같이 고른 태그는 대개 같은 종류다 ──────────────────
     지적: "가장 큰 문제는 분석에서 유닛 유추다. 자리 + 마우스 커맨드 기반이라 특정이
     아니다 보니 — 질럿·드라군처럼 기술 없는 애들이 프로브로 잡힌다."
     맞는 말이고, 실제로 무명 개체는 프로토스에 몰린다(실측: 경기 1의 무명 160기 중
     139기가 프로토스). 저그는 라바 변태가, 테란은 스팀·시즈·수리가 정체를 말해 주는데
     질럿·드라군에는 그런 것이 하나도 없다.
     남은 신호가 이것이다 — 부대 지정과 드래그로 함께 골라진 태그들. 실측으로 둘 이상
     고른 Select의 65%/60%가 한 종류만 담고 있었다(섞인 것 29%/40%). 3분의 1이 섞이므로
     단순 전파는 안 되고, '함께 골라진 것들이 만장일치일 때만' 그 이름을 준다.
     [시각도 함께 담는다 — 태그는 재사용되므로 그때 살아 있던 생애만 봐야 한다.] */
  const coSels: { sec: number; tags: number[] }[] = [];
  const noteCoSel = (sec: number, tags: number[]): void => {
    if (tags.length < 2 || tags.length > 12) return;   // 12는 원작의 한 부대 상한
    coSels.push({ sec, tags: [...tags] });
  };
  const groups = new Map<string, number[]>();
  /** 태그 → 지금 살아 있는 생애. 끝난 생애는 done으로 옮긴다. */
  const alive = new Map<number, Life>();
  const done: Life[] = [];
  /** 물리 건물(건설 좌표로 아는 것) — 태그가 없어도 개체다(요청: 건물 파괴 파악).
   *  builder는 지은 일꾼의 태그 — 그 일꾼이 도착 전에 딴 데로 불려가면 건설 무르기다. */
  const built: {
    owner: number; kind: string; born: number; x: number; y: number;
    builder: number | null; gone: number | null;
    /** 이 건물의 태그(있으면) — 자리 없는 건물 생애를 여기에 스냅해 붙인다(아래 앵커 승격). */
    tag?: number;
    /** 아예 선 적이 없다(일꾼이 닿기 전에 무른 건설) — 출력에서 통째로 뺀다. */
    never?: boolean;
    /** 일꾼이 자리에 닿아 건물이 실제로 서는 예상 시각 — 이 전에 딴 명령이 오면 무른 것이다. */
    arrive?: number;
    /** 끝난 사유 — 취소·철거에 변태를 더한다(지적: 레어가 돼도 앞 단계 홀이 안 닫힌다). */
    goneKind: "cxl" | "atk" | "morph" | null; ev: UnitEv[];
  }[] = [];
  /** 생산 원장(요청: 주먹구구 덧대기 말고 근본 수집 — 모든 큐된 유닛의 전 생애) —
   *  Train·라바 변태 하나가 유닛 하나다: 시작 시각, 만드는 건물 태그, 완성 예정.
   *  뒤에서 실제 태그 증거와 결합하고, 남으면 스스로 사는 합성 개체가 된다. */
  const ledger: {
    unit: string; pid: number; sec: number; done: number;
    bldTag: number | null; cancelled: boolean; bound: boolean;
    /** 이 유닛이 될 태그 — **라바 변태만 알 수 있다**(과제 #71).
     *  건물이 뽑는 유닛은 그때 골라진 것이 건물이라 태그를 모르지만, 라바는 유닛이라
     *  고른 그 태그가 그대로 유닛이 된다. 여태 이 사실을 안 적어 두고 결합 때 시간·자리로
     *  다시 찾고 있었고, 못 찾으면 합성 개체를 하나 더 세웠다 — 같은 유닛이 둘이 된다.
     *  실측(경기1): 저그 오버로드 합성 17기(뽑은 20기 대비 개체 32기), 경기3 저글링
     *  합성 105기. 아는 것을 안 쓰고 있었다. */
    unitTag: number | null;
  }[] = [];
  /** 건물 태그별 생산 꼬리 시각 — 같은 건물의 큐는 한 줄로 이어진다(라바는 병렬). */
  const prodTail = new Map<number, number>();
  const prodStats = { total: 0, bound: 0, syn: 0, razed: 0, noSite: 0 };
  /** 선택 동반으로 이름을 받은 무명 생애 수 — 성적표(id-check)가 읽는다. */
  let coSelFilled = 0;
  /** 원장에 남은 몫이 없어 동반이 물러난 횟수 — 원장이 위라는 규칙이 실제로 무는 자리. */
  let coSelOverQuota = 0;
  /** 남은 원장 몫으로 이름을 받은 무명 개체 수(과제 #71). */
  let quotaAssigned = 0;
  /** 몫을 넘겨서라도 동반으로 이름을 준 수 — 크면 원장이 덜 세고 있다는 신호. */
  let coSelOverFilled = 0;
  /** 무른 건설 계측 — voided: 아예 안 지어진 것, closed: 놓쳤던 철거를 겹침으로 닫은 것. */
  const buildStats = { voided: 0, closed: 0 };
  /** 폐기된 이동 목적지 계측 — dropped: 잘라 낸 것, kept: 실제로 닿은 것. */
  const moveStats = { dropped: 0, kept: 0 };
  /** 선 적 없는 건설의 자리 — 일꾼 생애에 남은 그 건설 증거(f=2)도 함께 지운다. */
  const voidedSites: { owner: number; x: number; y: number; sec: number }[] = [];
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
  /** 수송선으로 못 박힌 초(가장 이른 것) — 그 태그의 '수송선 시절'이 언제부터인지 재는 자. */
  const transSince = new Map<number, number>();
  const markTransport = (tag: number, pid2: number, at: number): void => {
    transTagOwner.set(tag, pid2);
    const cur = transSince.get(tag);
    if (cur === undefined || at < cur) transSince.set(tag, at);
  };
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
       0초 앵커를 심으면 시작 홀이 제 모습으로, 완공 상태로 선다(공사 표시는 sec>0).
       앵커는 따로 안 넣는다(수리: 0초 자리 증거가 두 번 나왔다) — 물리 건물은 출력에서
       제 출생 자리(f=2)를 늘 앞에 붙인다. */
    built.push({
      owner: p.id, kind: hall, born: 0,
      x: Math.round(p.startX - 2), y: Math.round(p.startY - 1.5),
      builder: null, gone: null, goneKind: null, ev: [],
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
  const markKind = (life: Life, kind0: string, sec: number): Life => {
    const kind = KIND_ALIAS[kind0] ?? kind0;
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
  /** 시프트 예약 이동(Queued) 표시 — 이동 증거의 다섯째 값에 1로 싣는다. 브루드워에서
   *  예약 없는 명령은 대기 중인 명령을 전부 지우고, 예약 명령은 뒤에 붙는다. 이 구별이
   *  없으면 '지워진 목적지'까지 유닛이 다녀온 것으로 그려진다(지적: 5시로 간 정찰
   *  프로브가 7시에 갔다 온다). */
  const pushEv = (life: Life, sec: number, x: number, y: number, f: number, q = false): void => {
    life.last = sec;
    if (life.lastAtk !== null) life.evAfterAtk = true;
    const prev = life.ev[life.ev.length - 1];
    // 같은 자리 연타는 한 점으로(스팸 클릭) — 초만 당겨 쓴다.
    if (prev && prev[3] === f && Math.abs(prev[1] - x) < 0.2 && Math.abs(prev[2] - y) < 0.2) {
      prev[0] = Math.round(sec);
      return;
    }
    life.ev.push(q ? [Math.round(sec), r1(x), r1(y), f, 1] : [Math.round(sec), r1(x), r1(y), f]);
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
    if (cmdName === "Select") {
      sel.set(pid, [...(c.UnitTags ?? [])]);
      noteCoSel(sec, c.UnitTags ?? []);
      continue;
    }
    if (cmdName === "Select Add") {
      const merged = [...(sel.get(pid) ?? []), ...(c.UnitTags ?? [])];
      sel.set(pid, merged);
      noteCoSel(sec, merged);
      continue;
    }
    if (cmdName === "Select Remove") {
      const drop = new Set(c.UnitTags ?? []);
      sel.set(pid, (sel.get(pid) ?? []).filter((t) => !drop.has(t)));
      continue;
    }
    if (cmdName === "Hotkey") {
      const key = `${pid}:${typeof c.Group === "number" ? c.Group : nameOf(c.Group)}`;
      const how = nameOf(c.HotkeyType);
      if (how === "Assign") groups.set(key, [...(sel.get(pid) ?? [])]);
      else if (how === "Select") {
        const g = groups.get(key) ?? [];
        sel.set(pid, [...g]);
        /* 부대 지정 소환이 가장 센 동반 신호다 — 사람이 손수 한 묶음으로 묶어 둔
           것이라 드래그 선택보다 종류가 고르다. 여태 이 자리를 안 보고 있었다. */
        noteCoSel(sec, g);
      }
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

    /* 착륙은 건설이 아니다(지적: "건물 띄우기 및 이동이 재현 안 되는 중") — screp은
       착륙을 **Build 커맨드에 Order=BuildingLand**로 준다. 우리는 "Land"라는 커맨드
       종류를 기다리고 있었는데 그런 종류는 오지 않는다(실측: 이 리플레이의 Build
       272건 중 BuildingLand 4건, Land 커맨드는 0건). 그래서 착륙이 새 건물 건설로
       읽혀 유령 건물이 서고, 정작 띄운 건물은 영영 안 내려앉았다.
       고른 것은 일꾼이 아니라 **떠 있는 그 건물 자신**이므로, 아래 건설 처리를 통째로
       건너뛰고 착륙 증거(f=5)만 남긴다. */
    if (cmdName === "Build" && (c.Order && typeof c.Order === "object"
      ? c.Order.Name : c.Order) === "BuildingLand") {
      const lpos = posTileOf(c);
      for (const tag of tags) {
        const life = lifeOf(tag, pid, sec);
        life.bld = true;
        if (unitName) markKind(life, unitName, sec);
        if (lpos) pushEv(life, sec, lpos.x, lpos.y, 5);
        liftedTags.delete(tag);
      }
      continue;
    }
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
        /* 종족을 안 가린다(수리: 안 지은 건물이 화면에 선다) — 한때 "프로토스는 소환만
           하고 프로브가 곧 자유라 연달아 둘을 앉힐 수 있다"고 보고 프로토스를 뺐는데,
           그게 틀렸다. 프로토스도 프로브가 자리까지 '걸어가야' 소환이 시작되고, 도착
           전에 다른 건설을 내면 앞의 것은 없던 일이 된다. 실측(3시): 501.1초 파일런
           (111,70)과 502.8초 옵저버토리 (111,70)가 같은 프로브·같은 타일이었다 —
           두 건물이 한 자리에 설 수 없으니 앞의 것은 안 지어진 것이다(사용자 확인:
           "실제로는 옵저버토리가 지어졌고 파일런은 지어지지 않았다"). 코어 둘,
           엉뚱한 자리 게이트웨이도 전부 같은 형태였다.
           무른 건설은 '잠깐 섰다 사라지는' 것이 아니라 아예 선 적이 없다 — never로
           표시해 출력에서 뺀다. 그것이 '완공되며 미끄러지는' 것처럼 보이던 정체다. */
        if (prevPending && !c.Queued && sec < prevPending.arrive) {
          const pb = built[prevPending.idx];
          if (pb.gone === null) {
            pb.gone = sec; pb.goneKind = "cxl"; pb.never = true;
            voidedSites.push({ owner: pb.owner, x: pb.x, y: pb.y, sec: pb.born });
          }
        }
        built.push({
          owner: pid, kind: unitName, born: sec, x: bpos.x, y: bpos.y,
          builder: tags.length === 1 ? tags[0] : null, gone: null, goneKind: null, ev: [],
        });
        /* 일꾼 하나가 낸 건설이면 무르기 판정 창을 연다 — 일꾼이 자리에 '닿아야' 건물이
           서고, 닿기 전에 다른 건설을 내면 앞의 것은 없던 일이 된다(세 종족 모두).
           이 창은 그 일꾼이 위치 있는 명령을 하나라도 받으면 곧바로 닫힌다(1093줄) —
           그래서 "건설 내리고 곧장 자원 복귀" 같은 정상 조작은 오판되지 않는다. 예전에
           476채 중 196채가 취소로 잘못 찍힌 것은 그 문지기가 없던 시절 이야기다.

           도착 예상은 직전 위치에서 일꾼 걸음(3.5타일/초)으로 잰다. 직전 위치를 모르거나
           낡았으면 예전엔 아예 안 물렀는데, 그래서 안 지은 건물이 화면에 남았다(지적:
           없는 코어·엉뚱한 게이트웨이). 모를 때는 '최소 이만큼은 걸어야 한다'는 바닥값
           WARP_MIN을 쓴다. 2.5초로 잡은 근거는 이 리플레이의 실측 분포다 — 같은 일꾼의
           연속 건설 간격이 1.14 / 1.31 / 1.34 / 1.47 / 1.64 / 1.72 / 2.1 / 2.27초에
           몰려 있고(사용자가 확인해 준 무르기들이 여기 들어 있다), 그 다음이 3.23초부터라
           둘 사이가 뚜렷이 갈린다. */
        if (tags.length === 1) {
          /* 출발점을 아는 대로 고른다 — 어림 상수를 쓰기 전에 실제 거리를 먼저 쓴다.
             ① 그 일꾼의 최근(45초 안) 위치 증거, ② 없으면 그 임자의 가장 가까운 홀
             (일꾼은 거의 늘 홀·미네랄 곁에 있다). 목적지는 발자국 **중심**이다 —
             일꾼은 앵커가 아니라 건물 한가운데로 걸어간다. */
          const [fw0, fh0] = FOOT_WH[unitName] ?? [3, 2];
          const cx0 = bpos.x + fw0 / 2;
          const cy0 = bpos.y + fh0 / 2;
          let from: [number, number] | null =
            prevPt && sec - prevPt[0] < 45 ? [prevPt[1], prevPt[2]] : null;
          if (!from) {
            let bd0 = Infinity;
            for (const h0 of built) {
              if (h0.owner !== pid || h0.never) continue;
              if (!HALL_KINDS.has(h0.kind)) continue;
              if (h0.born > sec || (h0.gone !== null && h0.gone <= sec)) continue;
              const d0 = Math.hypot(h0.x + 2 - cx0, h0.y + 1.5 - cy0);
              if (d0 < bd0) { bd0 = d0; from = [h0.x + 2, h0.y + 1.5]; }
            }
          }
          const travel = from
            ? Math.min(25, Math.max(0.8, Math.hypot(from[0] - cx0, from[1] - cy0) / 3.5))
            : 2.5;
          const arrive = sec + travel;
          built[built.length - 1].arrive = arrive;
          pendingBuild.set(tags[0], { sec, x: bpos.x, y: bpos.y, idx: built.length - 1, arrive });
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
        b.owner === pid && b.gone === null && !b.never
        && b.builder !== null && tags.includes(b.builder));
      if (byTagIdx >= 0) {
        built[byTagIdx].gone = sec;
        built[byTagIdx].goneKind = "cxl";
      } else {
        for (let i = built.length - 1; i >= 0; i -= 1) {
          const b = built[i];
          if (b.owner === pid && b.gone === null && !b.never && sec - b.born < 180) {
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
      if (cmdName === "Train" && unitName && UNIT_FRAMES[unitName] && !ineffective(c)) {
        const bldTag = tags.length > 0 ? tags[0] : null;
        const dur = UNIT_FRAMES[unitName] * 0.042;
        const tail = bldTag !== null ? prodTail.get(bldTag) ?? 0 : 0;
        const start = Math.max(sec, tail);
        const doneAt = start + dur;
        if (bldTag !== null) prodTail.set(bldTag, doneAt);
        ledger.push({ unit: unitName, pid, sec, done: doneAt, bldTag, cancelled: false, bound: false, unitTag: null });
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
      if (unitName && !MORPH_FROM[unitName] && UNIT_FRAMES[unitName] && !ineffective(c)) {
        const dur = UNIT_FRAMES[unitName] * 0.042;
        /* 고른 라바 전부가 변한다(지적: "게이트 셋을 고를 수가 없어" — 건물은 여럿을
           골라도 하나에서만 뽑히지만, 라바는 건물이 아니라 **유닛**이라 변태가 고른
           전부에 걸린다). 여태 명령 하나를 한 마리로 적어, 라바를 여럿 골라 누른 만큼
           원장이 통째로 비었다. 실측: 그런 명령이 경기1에 114건, 경기3에 31건이고,
           바로 그 때문에 저그만 '뽑은 수보다 개체가 훨씬 많은' 판이 났다.
           위 for 루프가 이미 고른 태그 전부에 정체를 찍고 있으니, 원장도 같은 수를
           적어야 앞뒤가 맞는다. */
        /* 고른 라바마다 한 마리 — 그 태그를 원장에 함께 적는다(위 unitTag 주석).
           저글링·스커지는 알 하나에 둘인데, 태그를 물려받는 것은 하나뿐이라
           나머지 한 마리는 태그 없이 적는다(그건 종전대로 시간·자리로 찾는다). */
        const larvae = tags.length > 0 ? tags : [null];
        const twin = unitName === "Zergling" || unitName === "Scourge";
        for (const lt of larvae) {
          ledger.push({
            unit: unitName, pid, sec, done: sec + dur, bldTag: null,
            cancelled: false, bound: false, unitTag: lt,
          });
          if (twin) {
            ledger.push({
              unit: unitName, pid, sec, done: sec + dur, bldTag: null,
              cancelled: false, bound: false, unitTag: null,
            });
          }
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
          /* 자리를 모르면 실제 위치 앵커로(지적: 레어로 변태해도 앞 단계 홀이 안 닫힌다) —
             시작 해처리는 건설 커맨드가 없어 자리 증거(f=2)가 없다. 자리를 못 물려주면
             변태한 레어 생애가 증거 0점이 돼 화면의 건물 층에서 통째로 빠지고, 앞 단계
             해처리만 끝까지 서 있는 그림이 된다. 남이 찍은 자리(f=1)는 그 순간 실제로
             거기 있었다는 뜻이라 자리 대용으로 쓸 수 있다. */
          const anchor = site ?? [...life.ev].reverse().find((v) => v[3] === 1 && v[1] >= 0);
          /* 물리 건물 줄도 함께 가른다(지적: 태그가 -1이라 태그 매칭이 안 된다) — 임자와
             자리(발자국 +1.5타일)와 변태 시각으로 잇는다. 앞 단계 줄은 여기서 닫고
             (dk=morph) 같은 자리에 새 정체의 줄을 이어 세운다: 발치 공격의 철거 판정이
             변태 뒤에도 끊기지 않고, 화면에서는 홀이 하나로 이어진다. */
          let px9 = anchor ? anchor[1] : NaN;
          let py9 = anchor ? anchor[2] : NaN;
          /* 후보는 '변태 전' 종류뿐이다(수리: 크립 콜로니가 성큰이 되면서 엉뚱한 건물이
             사라지고 성큰은 안 나타난다) — 변태 대상까지 후보에 넣었더니, 이미 성큰인
             줄이 다음 크립→성큰 변태에 닫혔다. 또 ±1.5타일 여유로 '첫 일치'를 집었더니
             콜로니가 한두 타일 간격으로 붙어 선 저그 본진에서 늘 엉뚱한(가장 먼저 지은)
             줄이 걸렸다 — 이제 발자국 안(여유 0.6)에 들면서 '가장 가까운' 줄을 집는다. */
          let bi9 = -1;
          if (Number.isFinite(px9) && from) {
            let bd9 = Infinity;
            for (let q9 = 0; q9 < built.length; q9 += 1) {
              const b = built[q9];
              if (b.owner !== pid || b.gone !== null || b.born > sec || b.kind !== from) continue;
              if (b.never) continue;
              const [fw9, fh9] = FOOT_WH[b.kind] ?? [3, 2];
              if (px9 < b.x - 0.6 || px9 > b.x + fw9 + 0.6) continue;
              if (py9 < b.y - 0.6 || py9 > b.y + fh9 + 0.6) continue;
              const d9 = Math.hypot(px9 - b.x, py9 - b.y);
              if (d9 < bd9) { bd9 = d9; bi9 = q9; }
            }
          }
          /* 시작 홀만은 자리 증거가 아예 없어도 잇는다(지적: 시작 해처리가 끝까지 남는다) —
             건설 커맨드가 없어 f=2가 없고, 남이 한 번도 안 찍었으면 f=1도 없다. 대신
             '경기 0초에 심은 홀'이라는 다른 데 없는 자리가 있다: 이른(45초 안) 홀 생애의
             변태는 그 줄로 잇는다. */
          if (bi9 < 0 && from && life.born <= 45 && HALL_MORPHS.has(unitName)) {
            bi9 = built.findIndex((b) => b.owner === pid && b.born === 0
              && b.gone === null && b.kind === from);
          }
          if (bi9 >= 0) {
            const b9 = built[bi9];
            b9.gone = sec;
            b9.goneKind = "morph";
            built.push({
              owner: b9.owner, kind: unitName, born: sec, x: b9.x, y: b9.y,
              builder: null, gone: null, goneKind: null, ev: [],
            });
            if (!Number.isFinite(px9)) { px9 = b9.x; py9 = b9.y; }
          }
          done.push(life);
          alive.delete(tag);
          const next = lifeOf(tag, pid, sec);
          next.kinds.set(unitName, 1);
          next.bld = true;
          life.morphTo = next;
          if (Number.isFinite(px9)) next.ev.push([Math.round(sec), r1(px9), r1(py9), 2]);
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
          markTransport(tag, pid, sec);
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
          /* 이륙 — 커맨드에 **픽셀** 좌표가 실려 온다(실측: {"Type":"Lift Off",
             "Pos":{"X":640,"Y":336}} = 타일 20,10.5). 건설·착륙이 타일인 것과 다르다.
             그 자리는 '건물이 그때 서 있던 곳'이라 강한 앵커만큼 확실하다 — 띄운 건물의
             출발점으로 남긴다(여태 자리 없는 증거였다). */
          const lp = c.Pos;
          if (lp && typeof lp.X === "number" && typeof lp.Y === "number") {
            pushEv(life, sec, lp.X / 32, lp.Y / 32, 6);
          } else pushEv(life, sec, -1, -1, 6);
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
          /* 버로우도 커맨드 그대로다(지적: 러커와 버로우 러커가 같이 움직인다 / 변태
             알에서 나오자마자 버로우 상태로 나온다) — 여태 재생기가 '러커가 안 움직이면
             땅속'이라는 어림으로 판정했다. 그 어림은 두 가지를 동시에 틀리게 만든다:
             땅속인데 자취가 흐르면 구멍이 미끄러지고, 갓 태어나 아직 명령을 못 받은
             러커는 서 있다는 이유로 곧장 땅속이 된다. 켠 시각(f=18)·끈 시각(f=19)을
             증거로 남겨 시즈와 같은 잣대로 읽게 한다. */
          if (cmdName === "Burrow") life.ev.push([Math.round(sec), -1, -1, 18]);
        } else {
          if (cmdName === "Unsiege") life.ev.push([Math.round(sec), -1, -1, 9]);
          if (cmdName === "Unburrow") life.ev.push([Math.round(sec), -1, -1, 19]);
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
      /* 같은 일꾼에게 도착 전 다른 명령이 오면 그 건설은 없던 일이 된다(요청: "일꾼이
         죽었다든가, 지으러 가는 동안 다른 게 먼저 짓기 시작한다든가, 같은 일꾼에게 다른
         명령을 덮어씌운다 — 그 사유를 잡아낼 수 없나"). 예전엔 정반대로, 위치 있는 명령이
         오면 판정 창을 '닫아' 취소를 포기했다. 그래서 안 지은 건물이 화면에 남았다.
         실측(3시): 299.5초 코어(111,58) → 300.0초 우클릭(115.4,56.6) → 301.6초 코어
         (113,60). 0.5초 만에 프로브가 자리에 닿았을 리 없으니 앞 코어는 선 적이 없다.
         옵저버토리도 같다: 501.1초 파일런(111,70) → 501.4초 우클릭 → 502.8초 옵저버토리
         (111,70). 사용자 확인 — "실제로는 옵저버토리가 지어졌고 파일런은 안 지어졌다".
         도착 뒤의 명령은(프로토스는 소환만 하면 프로브가 자유다) 그냥 창을 닫는다. */
      if (pos) {
        const pend = pendingBuild.get(tag);
        if (pend && sec < pend.arrive) {
          const pb2 = built[pend.idx];
          if (pb2 && pb2.gone === null) {
            pb2.gone = sec; pb2.goneKind = "cxl"; pb2.never = true;
            voidedSites.push({ owner: pb2.owner, x: pb2.x, y: pb2.y, sec: pb2.born });
          }
        }
        pendingBuild.delete(tag);
      }
      if (pos && life.bld && liftedTags.has(tag)) {
        // 비행 클릭(요청) — 뜬 건물이 나는 길. 착륙 전까지의 이동 자취다.
        pushEv(life, sec, pos.x, pos.y, 0, c.Queued === true);
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
          pushEv(life, sec, pos.x, pos.y, 0, c.Queued === true);
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
        markTransport(tag, pid, sec);
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
        /* 명시적 어택은 아군도 표적이다(요청) — 사람이 A를 누르고 제 유닛을 직접 찍는
           것은 원작에서 실제로 때리는 조작이다(감염된 테란 처리, 아군 벙커 부수기,
           흡혈 등). 자동 교전(우클릭·주문 없는 명령)은 종전대로 적만 친다 — 아군을
           찍은 우클릭은 따라가기·수리·힐이라 공격이 아니다. */
        const explicitAtk = orderName === "Attack1" || orderName === "Attack2"
          || orderName === "AttackUnit" || orderName === "AttackFixedRange";
        const hostile = explicitAtk
          || (!sameSide(target.owner, pid)
            && (ATTACK_ORDERS.has(orderName) || cmdName === "Right Click" || orderName === ""));
        if (hostile) { target.lastAtk = sec; target.evAfterAtk = false; }
      }
    }
    // 물리 건물 곁을 노린 공격 — 대상을 찍었든(우클릭 포함) 어택무브로 땅을 찍었든, 남의
    // 건물 발치의 공격 명령은 그 건물이 맞고 있다는 증거다(실측: 1:1 경기의 건물 공격이
    // 어택무브뿐이라 태그 표적만 보면 0건으로 잡혔다). 자리로 잇는다.
    if (pos && (ATTACK_ORDERS.has(orderName)
      || (targetTag > 0 && targetTag !== 65535 && cmdName === "Right Click"))) {
      /* 아군 건물은 명시적 어택으로 찍었을 때만 표적이다(요청) — 어택무브·우클릭이
         아군 건물 발치를 지나기만 해도 때린 것으로 치면 제 건물을 스스로 허문다. */
      const explicitAtk9 = orderName === "Attack1" || orderName === "Attack2"
        || orderName === "AttackUnit" || orderName === "AttackFixedRange";
      for (const b of built) {
        if ((sameSide(b.owner, pid) && !explicitAtk9) || sec < b.born) continue;
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

  /* ── 폐기된 목적지 자르기(지적: 5시로 간 정찰 프로브가 7시에 갔다 온다) ──────────
     브루드워의 이동 명령에는 예약(Queued) 여부가 붙는다. 예약 없는 명령은 대기 중인
     명령을 전부 지우고, 예약 명령은 뒤에 붙는다. 우리는 그 구별을 안 보고 모든 우클릭을
     '유닛이 지나간 점'으로 삼아, 이미 지워진 목적지까지 다녀오는 그림을 그렸다.
     실측(3시 정찰 프로브 10996): 63.04초 예약 없는 명령이 7시 목적지 둘을 지웠는데도
     우리는 거기까지 다녀왔다. 진짜 목적지는 (110,118) = 5시이고, 5시 저그가 92~97초에
     이 프로브를 (117,120)에서 세 번 어택으로 찍은 것이 그 증거다.

     **지우지 않고 자른다**(수리). 처음엔 못 닿은 목적지를 통째로 뺐는데, 계측이 그것이
     손해임을 보여 줬다: 이동 목적지의 65%가 사라져 증거점이 37% 줄고, 앵커로 확인되는
     인과 오차의 '8타일 안' 비율이 95% → 89%로 되레 나빠졌다. 목적지는 유닛이 그쪽으로
     '움직였다'는 사실까지 함께 지운 것이다. 이제는 명령이 폐기된 순간 유닛이 실제로
     가 있던 지점으로 좌표를 바꿔 남긴다 — 방향은 지키고 허구만 걷어낸다.

     굴리는 방식은 그대로다: 예약 없는 명령은 큐를 비우고, 예약 명령은 뒤에 붙이고,
     시간이 흐르는 만큼 제 속력으로 걷는다. 남이 찍은 자리(f=1)·건설·출생·착륙은 진짜
     위치라 걸음의 출발점을 그리로 되돌린다. 어택·수리 목적지는 표적 태그가 전투의
     뼈대라 걸음에만 넣고 좌표는 안 건드린다.
     속력을 모르는 개체는 가장 빠른 지상 유닛으로 치고 여유 35%를 준다. */
  {
    let clipped = 0;
    let kept = 0;
    for (const life of done) {
      if (life.bld || life.ev.length < 3) continue;
      let mk = "";
      let bn = 0;
      for (const [k, n] of life.kinds) if (n > bn) { bn = n; mk = k; }
      /* 자를 자리는 제 걸음으로, 닿았는지 판정은 너그럽게(여유 35%) — 둘을 가른다.
         한 값으로 하면 둘 중 하나가 틀린다: 여유를 걸음에 주면 자른 자리가 실제보다
         멀리 찍혀 그 자체가 허구가 되고, 여유를 빼면 업그레이드·경사·비스듬한 길
         때문에 진짜로 닿은 목적지까지 '못 닿았다'가 된다. */
      const spd = mk ? speedOfUnit(mk) : 7;
      const REACH_SLACK = 1.35;
      const idx = life.ev
        .map((v, i) => ({ v, i }))
        .filter((e) => e.v[1] >= 0)
        .sort((a, b) => a.v[0] - b.v[0] || a.i - b.i);
      if (idx.length < 3) continue;
      let px = idx[0].v[1];
      let py = idx[0].v[2];
      let t0 = idx[0].v[0];
      /** 아직 못 간 목적지 줄 — [x, y, 증거 인덱스]. */
      const queue: [number, number, number][] = [];
      const arrived = new Set<number>();
      /** 폐기된 목적지 → 그 순간 유닛이 있던 자리. */
      const clip = new Map<number, [number, number, number]>();
      const walk = (until: number): void => {
        while (t0 < until && queue.length > 0) {
          const [qx, qy] = queue[0];
          const d = Math.hypot(qx - px, qy - py);
          const need = d / spd;
          if (need <= (until - t0) * REACH_SLACK) {
            px = qx; py = qy; t0 = Math.min(until, t0 + need);
            if (queue[0][2] >= 0) arrived.add(queue[0][2]);
            queue.shift();
          } else {
            const k = (until - t0) / Math.max(1e-6, need);
            px += (qx - px) * k; py += (qy - py) * k; t0 = until;
          }
        }
        if (t0 < until) t0 = until;
      };
      /** 큐를 비운다 — 남아 있던 목적지는 '여기까지 갔다'로 잘린다. */
      const clearQueue = (): void => {
        for (const [, , i] of queue) if (i >= 0) clip.set(i, [t0, px, py]);
        queue.length = 0;
      };
      for (let n = 1; n < idx.length; n += 1) {
        const { v, i } = idx[n];
        walk(v[0]);
        if (v[3] === 0) {
          if (v[4] !== 1) clearQueue();   // 예약 없는 명령 = 큐를 비운다
          queue.push([v[1], v[2], i]);
        } else if (v[3] === 7 || v[3] === 10) {
          clearQueue();
          queue.push([v[1], v[2], -1]);
        } else if (v[3] === 12) {
          clearQueue();                   // 탔다 — 제 걸음이 아니다
          px = v[1]; py = v[2];
        } else {
          clearQueue();
          px = v[1]; py = v[2];           // 진짜 자리 — 걸음의 출발점을 여기로
        }
      }
      walk(Number.POSITIVE_INFINITY);     // 마지막 명령은 끝까지 걸어간다
      for (const [, , i] of queue) if (i >= 0) arrived.add(i);
      /* 앵커가 걸음을 이긴다(수리) — 자른 자리는 어디까지나 우리 걸음 모형이 말하는
         것이고, 남이 찍은 자리(f=1)는 그 순간 유닛이 정말로 있던 곳이다. 둘이 어긋나면
         앵커가 옳다. 실측(정찰 프로브 10996): 64초에 예약된 7시 목적지 때문에 모형은
         프로브를 서쪽으로 걷게 해 85초에 (43,117)이라는 자리를 지어냈는데, 92초 앵커는
         5시 (117,120)이었다 — 7초에 74타일은 어떤 유닛도 못 간다. 그런 자리는 자르지
         말고 아예 뺀다. 실제 게임에서는 예약이 중간에 끊긴 것이다(막히거나 얻어맞거나). */
      const anch = idx.filter((e) => e.v[3] === 1);
      const contradicted = (t: number, x: number, y: number): boolean => {
        for (const a of anch) {
          if (a.v[0] < t) continue;
          return Math.hypot(a.v[1] - x, a.v[2] - y)
            > spd * REACH_SLACK * Math.max(0.5, a.v[0] - t) + 1;
        }
        return false;
      };
      /* 잘린 점끼리 같은 자리가 잇달으면(연타 한 뭉치는 한 자리에서 끝난다) 하나만
         남긴다 — 안 그러면 제자리 점이 줄줄이 쌓여 저장만 커진다. */
      let lastX = Number.NaN;
      let lastY = Number.NaN;
      for (let n = idx.length - 1; n >= 1; n -= 1) {
        const { v, i } = idx[n];
        if (v[3] !== 0) { lastX = Number.NaN; continue; }
        if (arrived.has(i)) { kept += 1; lastX = Number.NaN; continue; }
        const c = clip.get(i);
        const at = life.ev.indexOf(v);
        if (at < 0) continue;
        const dup = c !== undefined
          && Math.abs(c[1] - lastX) < 0.3 && Math.abs(c[2] - lastY) < 0.3;
        if (c === undefined || dup || contradicted(c[0], c[1], c[2])) {
          life.ev.splice(at, 1);
          clipped += 1;
          continue;
        }
        lastX = c[1]; lastY = c[2];
        v[0] = Math.round(c[0]);
        v[1] = r1(c[1]);
        v[2] = r1(c[2]);
        clipped += 1;
      }
      life.ev.sort((a, b) => a[0] - b[0]);
      // 같은 초·같은 자리 중복은 한 점으로(자르기가 만든 것).
      for (let n = life.ev.length - 1; n >= 1; n -= 1) {
        const a = life.ev[n];
        const b = life.ev[n - 1];
        if (a[3] === b[3] && a[0] === b[0]
          && Math.abs(a[1] - b[1]) < 0.3 && Math.abs(a[2] - b[2]) < 0.3) life.ev.splice(n, 1);
      }
    }
    moveStats.dropped = clipped;
    moveStats.kept = kept;
  }

  /* ── 발자국 겹침으로 무른 건설 가려내기(지적: 없는 건물이 나온다) ──────────────
     위의 '도착 전 재건설' 판정은 일꾼 걸음을 어림해 도착 시각을 재므로 빗나갈 수 있다.
     여기 규칙은 어림이 아니라 물리다: **두 건물은 같은 타일을 함께 쓸 수 없다.** 서 있는
     건물 위에는 애초에 자리를 찍을 수 없으니, 뒤 건설의 발자국이 앞 건설과 겹친다면
     앞의 것은 그때 서 있지 않았다는 뜻이다. 둘 중 하나다:
       ① 짧은 사이(90초 안)에 겹쳤다 — 앞의 것은 아예 안 지어졌다(무른 건설). 통째로 뺀다.
       ② 오랜 뒤에 겹쳤다 — 앞의 것은 지어졌다가 부서졌고 우리가 그 철거를 놓쳤다.
          뒤 건설이 시작된 때까지 서 있던 것으로 닫는다.
     변태 승계(크립 콜로니→성큰, 해처리→레어)는 원래 같은 자리라 건드리지 않는다. */
  {
    const foot = (k: string): [number, number] => FOOT_WH[k] ?? [3, 2];
    let voided = 0;
    let closed = 0;
    for (let j = 0; j < built.length; j += 1) {
      const bj = built[j];
      if (bj.never) continue;
      const [jw, jh] = foot(bj.kind);
      for (let i = 0; i < j; i += 1) {
        const bi = built[i];
        if (bi.never || bi.owner !== bj.owner) continue;
        if (bi.goneKind === "morph" && bi.x === bj.x && bi.y === bj.y) continue;
        if (bi.gone !== null && bi.gone <= bj.born) continue;   // 이미 닫혔다 — 겹칠 일 없다
        const [iw, ih] = foot(bi.kind);
        if (bi.x + iw <= bj.x || bj.x + jw <= bi.x) continue;
        if (bi.y + ih <= bj.y || bj.y + jh <= bi.y) continue;
        if (bj.born - bi.born < 90) {
          bi.never = true; voided += 1;
          voidedSites.push({ owner: bi.owner, x: bi.x, y: bi.y, sec: bi.born });
        }
        else { bi.gone = bj.born; bi.goneKind = "atk"; closed += 1; }
        break;
      }
    }
    buildStats.voided = voided;
    buildStats.closed = closed;
    // 선 적 없는 건설은 여기서 통째로 뺀다 — 아래 어느 소비자도 보면 안 된다.
    for (let i = built.length - 1; i >= 0; i -= 1) if (built[i].never) built.splice(i, 1);
    /* 생애에 남은 건설 증거(f=2)도 함께 지운다 — 물리 줄만 빼면 저그가 안 지워진다.
       드론은 제 태그가 곧 건물이라 그 건물은 '태그 줄'로 그려지기 때문이다(실측:
       5시 해처리 (112,113)이 3초 살다 (113,113)으로 옮겨 앉는 것으로 남아 있었다). */
    if (voidedSites.length > 0) {
      for (const life of done) {
        if (life.ev.length === 0) continue;
        for (let i = life.ev.length - 1; i >= 0; i -= 1) {
          const v = life.ev[i];
          if (v[3] !== 2) continue;
          if (voidedSites.some((q) => q.owner === life.owner && Math.abs(q.sec - v[0]) <= 1
            && Math.abs(q.x - v[1]) < 0.6 && Math.abs(q.y - v[2]) < 0.6)) life.ev.splice(i, 1);
        }
      }
    }
  }

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

  /* ── 못 박힌 수송선에 이름을 주고 옛 생애를 갈라 준다(지적: 아콘이 걸어가고 셔틀이
        안 나온다) ────────────────────────────────────────────────────────────────
        MoveUnload·Unload는 수송선에게만 내릴 수 있어 태그를 '수송선'으로 못 박아 주지만,
        못 박기만 하고 이름은 안 줬다. 실측 표본(SG_26081613330800)에서 진짜 드랍을 한
        셔틀 여덟이 모두 이름 없는 생애였고, 뒤이어 생산 원장이 그 무명 생애에 옛 프로브를
        붙여 버려(같은 태그를 프로브가 먼저 쓰다 죽고 셔틀이 물려받은 자리다) 아콘 넷의
        드랍이 통째로 '프로브 여덟의 행군'이 됐다. 승하차 자체는 맞게 잡혔는데 타고 간
        것의 정체만 틀린 것이라, 화면에서는 셔틀이 사라지고 아콘이 걸어가는 그림이 된다.
        ① 못 박힌 태그가 무명이면 종족의 수송선으로 이름 짓는다 — 명령 자체가 증거라
           어림이 아니다. 이미 다른 구체 정체가 있으면 건드리지 않는다(섞인 선택 방어가
           거른 뒤이므로, 여기까지 온 구체 정체는 존중한다).
        ② 그 사람의 첫 수송선이 완성되기도 전의 앞쪽 증거는 이 태그를 먼저 쓰던 옛
           주인의 것이다 — 거기서 생애를 갈라 앞쪽은 무명으로 남긴다. 그러면 원장이
           앞 생애에 제 이름(프로브 등)을 도로 붙이고, 뒤 생애가 셔틀로 산다. */
  {
    /** 임자별 첫 수송선 완성 시각 — 원장(취소 안 된 것)에서 곧장 읽는다. */
    const firstTransDone = new Map<number, number>();
    for (const it of ledger) {
      if (it.cancelled) continue;
      if (it.unit !== (RACE_TRANSPORT[raceOf.get(it.pid) ?? ""] ?? "")) continue;
      const cur = firstTransDone.get(it.pid);
      if (cur === undefined || it.done < cur) firstTransDone.set(it.pid, it.done);
    }
    /** 태그별 생애 목록 — 재사용 분리로 한 태그에 여럿일 수 있다. */
    const byTag = new Map<number, Life[]>();
    for (const l of done) {
      if (l.bld || l.tag <= 0) continue;
      const arr = byTag.get(l.tag) ?? [];
      arr.push(l);
      byTag.set(l.tag, arr);
    }
    for (const arr of byTag.values()) arr.sort((a, b) => a.born - b.born);
    for (const [tag, pid2] of transTagOwner) {
      const tKind = RACE_TRANSPORT[raceOf.get(pid2) ?? ""] ?? "";
      if (!tKind) continue;
      const at = transSince.get(tag) ?? 0;
      const arr = byTag.get(tag);
      if (!arr) continue;
      // 못 박힌 그 시각에 살아 있던 생애 — 없으면 그 앞의 마지막 것.
      let life: Life | null = null;
      for (const l of arr) { if (l.born <= at + 1) life = l; else break; }
      if (!life || life.owner !== pid2) continue;
      /* 일꾼 표는 '어림'이라 못 박은 증거에 진다(수리: 셔틀 여덟이 전부 프로브로 나왔다) —
         일꾼 정체는 자원 우클릭 하나로 붙는데, 셔틀은 미네랄 밭 쪽으로 이동 우클릭만 해도
         그 표를 받는다. 반면 MoveUnload·Unload는 수송선만 받는 명령이라 어림이 아니다.
         그래서 표가 일꾼뿐인 생애는 수송선으로 고쳐 쓴다. 다른 구체 정체(질럿·드라군…)는
         자원 클릭으로 붙을 일이 없으니 그대로 존중한다(섞인 선택 방어). */
      const worker9 = RACE_WORKER[raceOf.get(pid2) ?? ""] ?? "";
      const onlyWorker = worker9 !== "" && life.kinds.size === 1 && life.kinds.has(worker9);
      if (life.kinds.size === 0 || onlyWorker) {
        life.kinds.clear();
        life.kinds.set(tKind, 3);
      } else if (!isTransportLife(life)) continue; // 구체 정체가 다르면 손대지 않는다.
      /* ② 앞 생애 가르기 — 첫 수송선 완성보다 이른 증거는 옛 주인 것이다. 완성 어림에
         8초 여유를 둔다(원장 시계는 방해를 모른다). */
      const cut = firstTransDone.get(pid2);
      if (cut === undefined || life.born >= cut - 8) continue;
      const vi = life.ev.findIndex((v) => v[0] >= cut - 8);
      if (vi <= 0) continue;
      const head = life.ev.splice(0, vi);
      const old: Life = {
        tag: life.tag, owner: life.owner, kinds: new Map(), groupKinds: new Set(),
        bld: false, born: life.born, last: head[head.length - 1][0],
        lastAtk: null, evAfterAtk: false, morphTo: null, cxl: null, solo: false,
        spawned: false, ev: head,
      };
      life.born = life.ev[0][0];
      life.spawned = false;
      done.push(old);
    }
  }

  /* ── 뒤 스토리 보정: 시작 유닛(지적: 처음 오버로드가 안 나온다) — 개체는 첫 증거에서
        태어나는데, 시작 유닛의 첫 명령 '전' 이야기는 리플레이가 말해 준다: 본진에 서
        있었다. 저그의 이른(90초 안) 단독 선택 이동체 중 자원·건설·정체 증거가 하나도
        없는 첫 하나는 시작 오버로드다 — 그 시각에 홀로 움직일 다른 것이 없다(라바는
        선택돼도 명령을 못 받고, 드론은 자원 클릭이 남는다). 이른(45초 안) 일꾼도 본진
        에서 출발시킨다 — 어림 합성이 아니라 태어난 자리로 거슬러 얹는 보정이다. */
  /* 어림으로 고른 시작 오버로드 — 뒤에서 진짜 정찰 증거(개막에 남의 본진을 찍음)가
     나오면 그 어림은 물린다. */
  const guessedOverlord = new Map<number, { life: Life; born: number; evLen: number }>();
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
        guessedOverlord.set(life.owner, { life, born: life.born, evLen: life.ev.length });
        life.kinds.set("Overlord", 1);
        if (life.ev.length === 0 || life.ev[0][0] > 0) life.ev.unshift([0, r1(home[0]), r1(home[1]), 3]);
        life.born = 0;
      }
      /* 45초 안 일꾼을 전부 0초로 당기던 갈래는 걷었다(지적: 스타팅 일꾼이 화면에 안
         나옴의 이면) — 30초에 나온 드론까지 0초 출생으로 당겨져, 저그 본진에 0초부터
         일꾼 아홉이 겹쳐 서 있었다. 어느 넷이 시작 일꾼인지는 아래 '스타트 일꾼 넷'이
         태어난 순서로 가려 정하고, 나머지는 제 출생 시각을 지킨다. */
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
    /* 건물이 무너지면 그 안의 큐도 함께 사라진다(지적: "건물 파괴 시 생산 취소").
       건물 생애의 마지막이 '공격받고 소식 없음'이면 그때 무너진 것이다 — 이 파일이
       유닛에 이미 쓰는 잣대(lastAtk & !evAfterAtk)를 건물에도 그대로 쓴다. 완성 시각이
       그 뒤라면 그 유닛은 세상에 나온 적이 없다.
       라바 변태(bldTag가 없다)와 아직 서 있는 건물은 걸리지 않는다. */
    {
      const bldLifeOf = new Map<number, Life>();
      for (const l of done) if (l.bld) bldLifeOf.set(l.tag, l);
      let razed = 0;
      for (const it of ledger) {
        if (it.cancelled || it.bldTag === null) continue;
        const bl = bldLifeOf.get(it.bldTag);
        if (!bl || bl.lastAtk === null || bl.evAfterAtk) continue;
        if (bl.lastAtk + 8 < it.done) { it.cancelled = true; razed += 1; }
      }
      prodStats.razed = razed;
    }
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
        /* 시작 건물은 처음부터 완공돼 있다(과제 #71) — born + 40(완공 어림)을 그대로
           걸었더니 40초 안에 나오는 초반 생산이 전부 '자리를 모르는 원장'이 되어 아래
           filter(sx >= 0)에서 통째로 버려졌다. 실측: 경기2의 원장 77건 중 45건이 여기서
           사라졌고, 그래서 프로브를 38기 뽑았는데 개체는 13기뿐이었다. */
        const ready = (b: { born: number }): number => (b.born === 0 ? 0 : b.born + 40);
        const pool = prodKind
          ? built.filter((b) => b.owner === it.pid && b.kind === prodKind
            && ready(b) <= it.done && (b.gone === null || b.gone > it.done))
            // 아래쪽 출구(요청) — 발자국 바닥 밑 0.6타일.
            .map((b) => ({
              x: b.x + (PROD_FOOT[prodKind]?.[0] ?? 3) / 2,
              y: b.y + (PROD_FOOT[prodKind]?.[1] ?? 2.5) + 0.6,
            }))
          : hallsOf(it.pid, it.done);
        /* 그래도 비면 그 사람의 본진 발치로 떨어뜨린다 — 자리를 모른다고 원장을 통째로
           버리면 그 유닛은 세상에 아예 없던 것이 된다. 자리가 조금 틀린 것이 없는 것보다
           낫다(아래 filter(sx >= 0)가 그 마지막 그물이다). */
        const pool2 = pool.length > 0 ? pool : hallsOf(it.pid, it.done);
        if (pool2.length > 0) {
          const pick = pool2[idx % pool2.length];
          sx = pick.x; sy = pick.y;
        }
      }
      if (!rally) rally = lastRallyOf(it.pid, it.done);
      // 오버로드·일꾼은 랠리를 안 탄다(오버로드는 제자리, 일꾼은 자원 배정).
      if (it.unit === "Overlord" || it.unit === RACE_WORKER[raceOf.get(it.pid) ?? ""]) rally = null;
      return { it, sx, sy, rally };
    }).filter((r) => {
      if (r.sx >= 0) return true;
      prodStats.noSite += 1;
      return false;
    });
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
    /* ⓪ 태그를 아는 것부터 — 라바 변태는 고른 태그가 그대로 그 유닛이다(위 unitTag).
       시간·자리로 더듬을 것 없이 그 생애에 곧장 붙인다. 이 한 걸음이 없으면 결합에
       실패한 만큼 합성 개체가 생겨 같은 유닛이 화면에 둘이 된다. */
    {
      const byTagLives = new Map<number, Life[]>();
      for (const l of candLives) {
        const arr = byTagLives.get(l.tag) ?? [];
        arr.push(l);
        byTagLives.set(l.tag, arr);
      }
      for (const r of items) {
        if (r.it.bound || r.it.unitTag === null) continue;
        const arr = byTagLives.get(r.it.unitTag);
        if (!arr) continue;
        /* 그 태그의 여러 생애 중 변태를 누른 시각을 품은 것 — 태그는 재사용되므로
           아무거나 붙이면 딴 유닛의 생애를 덮어쓴다. */
        const life = arr.find((l) => !l.spawned
          && l.born <= r.it.sec + 2 && r.it.sec <= l.last + 2);
        if (!life) continue;
        life.kinds.set(r.it.unit, (life.kinds.get(r.it.unit) ?? 0) + 1);
        attach(life, r);
      }
    }
    for (const pass of [0, 1] as const) {
      for (const r of items) {
        if (r.it.bound) continue;
        for (const life of candLives) {
          if (life.spawned || life.owner !== r.it.pid) continue;
          /* 창의 앞끝은 '주문 시각'까지 연다(수리: 안 뽑은 오버로드가 갑자기 생산됨) —
             저그 라바 변태는 고른 라바의 태그가 그대로 그 유닛이 된다. 그 생애는 변태를
             '누른 순간'에 열리는데(태그 매핑 유지), 완성은 25초 뒤라 '완성 8초 전'
             창에 못 들어왔다. 그래서 원장이 결합에 실패하고 합성 개체를 하나 더 세워,
             한 번 누른 오버로드가 화면에 둘이 됐다(실측 5시 저그: 변태 9번에 오버로드
             개체 14기). 앞끝을 주문 시각으로 열면 그 생애가 제 출생 이야기를 받는다.
             건물이 뽑는 유닛(테란·프로토스)은 고른 태그가 '건물'이라 정체가 안 맞아
             1차 통과에 안 걸린다 — 이 완화가 닿지 않는다. */
          /* 앞끝 완화는 '그 태그가 주문 순간에 골라져 있던' 생애에만 준다(수리: 3시
             질럿이 프로브로 잡힌다) — 위 완화를 모두에게 열어 두었더니, 건물이 뽑는
             유닛(테란·프로토스)에서도 아무 무명 태그나 걸렸다. 156초에 첫 명령을 받은
             질럿이 316초에 완성될 프로브 원장에 붙어 정체가 Probe가 되고 출생이 넥서스
             발치로 밀려, 그 사이 화면에서 사라졌다(실측: 3시 프로브 117기 중 58기가
             공격 명령을 가진 가짜였다).
             가르는 자는 증거다 — 라바 변태는 고른 태그가 곧 그 유닛이라 그 생애에
             주문 시각의 자리 없는 증거(f=4)가 남는다. 건물이 뽑은 유닛에는 그것이
             없다(그때 골라진 것은 건물이다). */
          const orderedSelf = life.ev.some(
            (v) => v[3] === 4 && Math.abs(v[0] - r.it.sec) <= 2,
          );
          const front = orderedSelf
            ? Math.min(r.it.done - 8, r.it.sec - 2) : r.it.done - 8;
          if (life.born < front || life.born - r.it.done > 300) continue;
          const mk = majorityOf(life);
          if (pass === 0 ? mk !== r.it.unit : mk !== "") continue;
          /* 행동이 정체를 가른다(수리: 질럿이 프로브로) — 무명 생애를 원장에 붙일 때,
             그 생애가 한 일과 원장이 말하는 정체가 어긋나면 붙이지 않는다. 공격 명령
             (f=7)을 낸 개체는 일꾼일 수 없고, 건물을 앉힌(f=2) 개체는 일꾼일 수밖에
             없다. 시간 창만으로는 못 가른다 — 창이 뒤로 300초라 앞서 완성된 프로브
             원장이 뒤늦게 첫 명령을 받은 질럿을 삼켰다. */
          if (pass === 1) {
            const isWorkerItem = r.it.unit === (RACE_WORKER[raceOf.get(r.it.pid) ?? ""] ?? "");
            const attacked = life.ev.some((v) => v[3] === 7);
            const builtSomething = life.ev.some((v) => v[3] === 2);
            if (isWorkerItem && attacked) continue;
            if (!isWorkerItem && builtSomething) continue;
          }
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
    /* 초반 30초의 '엄청 먼' 자취(지적: 시작하자마자 1시 기지에 5시 저그의 드론이 있다)
       — 실측: 3초에 태그 11020(임자=5시 저그, 정체 미상)에 (126,3) — 즉 1시 남의 본진 —
       자리 증거가 달렸다. 그 자리가 곧 개체의 첫 증거라, 정체 미상 개체가 종족 기본
       일꾼(드론) 모습으로 적 본진에 솟았다.
       다만 그 명령 자체는 진짜다(재지적: 스타팅 오버로드에게 내린 이동 명령이 안
       나타남) — 개막에 남의 본진을 찍을 수 있는 건 정찰 오버로드뿐이다. 통째로 버리던
       것을 갈라 본다:
       ① 저그의 정체 미상 개체가 그런 먼 곳을 찍었다면 그게 시작 오버로드다 — 정체를
          오버로드로 못 박고 집(홀)에서 태어나게 해 실제로 날아가는 자취를 살린다.
       ② 그 밖(이미 정체가 잡혔거나 저그가 아닌 경우)은 남의 명령이 묻은 것이라 여태처럼
          자리 증거만 버린다. */
    const scoutSeen = new Set<number>();
    for (const life of [...done].sort((a, b) => a.born - b.born)) {
      if (life.bld) continue;
      const hall = hallOf.get(life.owner);
      if (!hall) continue;
      const farAway = (v: [number, number, number, number, number?]): boolean => v[0] < 30
        && v[1] >= 0 && Math.hypot(v[1] - hall[0], v[2] - hall[1]) > 25;
      if (!life.ev.some(farAway)) continue;
      const unknown = life.kinds.size === 0 && life.groupKinds.size === 0;
      if (raceOf.get(life.owner) === "저그" && unknown && !scoutSeen.has(life.owner)) {
        scoutSeen.add(life.owner);
        /* 어림으로 오버로드라 했던 개체는 물린다 — 오버로드는 하나뿐이라 어림과 증거가
           맞서면 증거가 이긴다. 정체를 비워 두면 아래에서 시작 일꾼으로 다시 잡힌다. */
        const g = guessedOverlord.get(life.owner);
        if (g && g.life !== life) {
          g.life.kinds.delete("Overlord");
          // 집 앞 출생도 함께 물린다 — 안 그러면 0초에 정체 없는 개체가 하나 더 선다.
          if (g.life.ev.length > g.evLen) g.life.ev.shift();
          g.life.born = g.born;
          guessedOverlord.delete(life.owner);
        }
        life.kinds.set("Overlord", 1);
        if (life.ev.length === 0 || life.ev[0][0] > 0 || life.ev[0][3] !== 3) {
          life.ev.unshift([0, r1(hall[0]), r1(hall[1]), 3]);
        }
        life.born = 0;
        continue;
      }
      const kept = life.ev.filter((v) => !farAway(v));
      if (kept.length === life.ev.length) continue;
      life.ev = kept;
      if (kept.length > 0) life.born = Math.min(life.born, kept[0][0]);
    }

    /* 일꾼 후보 모으기는 위 정찰 오버로드 판정 '뒤'에 한다(수리) — 앞에서 모으면 어림으로
       오버로드라 붙었다가 물린 개체가 후보에서 빠져, 시작 일꾼이 셋만 잡혔다. */
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
      /* 정체를 일꾼으로 못 박는다(지적: 스타팅 일꾼 4마리가 화면에 안 나오고 채취도
         안 함) — 시작 일꾼은 생산된 적이 없어 Train 증거가 없고, 자원 우클릭에도
         유닛 이름이 안 붙어 정체가 끝까지 빈칸이었다. 그리는 쪽은 정체 없는 개체를
         못 그리고 채취 왕복도 일꾼에게만 붙으니, 넷이 통째로 사라져 있었다. 시작 홀
         발치의 이 넷은 정의상 그 종족의 일꾼이다. */
      const worker = RACE_WORKER[raceOf.get(pid) ?? ""] ?? "";
      const arr = (byOwner.get(pid) ?? [])
        // 위에서 시작 오버로드로 잡힌 개체는 일꾼 후보가 아니다.
        .filter((life) => !life.kinds.has("Overlord"))
        .sort((x, y) => x.born - y.born).slice(0, 4);
      for (let i = 0; i < arr.length; i += 1) {
        const life = arr[i];
        if (worker && life.kinds.size === 0) life.kinds.set(worker, 1);
        if (life.born > 0) {
          life.born = 0;
          life.ev.unshift([0, r1(hall[0] - 1.5 + i), r1(hall[1] + 2), 3]);
        }
      }
      for (let i = arr.length; i < 4; i += 1) {
        done.push({
          tag: synTag2, owner: pid, kinds: worker ? new Map([[worker, 1]]) : new Map(),
          groupKinds: new Set(),
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

  /* ── 선택 동반으로 무명 채우기(과제 #71) ────────────────────────────────────
     여기까지 와도 이름이 없는 생애가 남는다 — 원장이 못 묶었고, 능력도 안 썼고,
     건물 발치도 아니었던 것들이다. 프로토스가 대부분이다(질럿·드라군에는 정체를
     말해 주는 행동이 없다).
     마지막 신호는 '누구와 함께 골라졌나'다. 부대 지정과 드래그는 대개 같은 종류를
     묶으므로, 그 순간 함께 골라진 생애들의 이름이 **하나로 모일 때만** 그 이름을 준다.
     섞인 선택(질럿 + 드라군)에서는 아무 이름도 안 준다 — 3분의 1이 그런 선택이라
     다수결로 밀면 그만큼 틀린 이름을 새로 만든다.
     [태그 재사용] 같은 태그의 여러 생애 중 그 선택 시각에 살아 있던 것만 본다. */
  {
    const livesByTag = new Map<number, Life[]>();
    for (const life of done) {
      if (life.bld) continue;
      const arr = livesByTag.get(life.tag) ?? [];
      arr.push(life);
      livesByTag.set(life.tag, arr);
    }
    const aliveAt = (tag: number, sec: number): Life | null => {
      const arr = livesByTag.get(tag);
      if (!arr) return null;
      let best: Life | null = null;
      for (const l of arr) {
        if (sec < l.born - 2 || sec > l.last + 2) continue;
        if (!best || l.born > best.born) best = l;
      }
      return best;
    };
    /** 무명 생애 → 그 생애가 낀 선택들에서 모은 이름들. */
    const votes = new Map<Life, Map<string, number>>();
    for (const cs of coSels) {
      const mates: Life[] = [];
      for (const tg of cs.tags) {
        const l = aliveAt(tg, cs.sec);
        if (l) mates.push(l);
      }
      if (mates.length < 2) continue;
      const known = new Set<string>();
      const blanks: Life[] = [];
      for (const l of mates) {
        const k = majorityKindOf2(l);
        if (k) known.add(k); else blanks.push(l);
      }
      // 만장일치일 때만 — 섞인 선택은 아무 말도 안 한 것으로 친다.
      if (known.size !== 1 || blanks.length === 0) continue;
      const [only] = [...known];
      for (const l of blanks) {
        const m = votes.get(l) ?? new Map<string, number>();
        m.set(only, (m.get(only) ?? 0) + 1);
        votes.set(l, m);
      }
    }
    /* ★ 원장이 위다(지적: "공동선택보다는 원장이 우선, 아니면 둘이 동급").
       동반은 '누구와 함께 골라졌나'라는 정황이고 원장은 '무엇을 몇 기 뽑았나'라는
       기록이다. 정황이 기록을 넘어설 수는 없다 — 질럿을 42기 뽑았는데 동반이 43번째
       질럿을 만들면 그건 새로 지어낸 유닛이다.
       그래서 남은 몫(뽑은 수 − 이미 붙은 수)이 있을 때만 이름을 준다. 몫은 원장
       (취소된 것 뺀 것) + 시작 유닛(일꾼 4, 저그 오버로드 1)이다 — 시작 유닛에는
       커맨드가 없어 원장에 없다. */
    const quota = new Map<number, Map<string, number>>();
    const bump = (pid: number, kind: string, n: number): void => {
      const m = quota.get(pid) ?? new Map<string, number>();
      m.set(kind, (m.get(kind) ?? 0) + n);
      quota.set(pid, m);
    };
    for (const it of ledger) if (!it.cancelled) bump(it.pid, it.unit, 1);
    for (const p of players) {
      const w = RACE_WORKER[p.race] ?? "";
      if (w) bump(p.id, w, 4);
      if (p.race === "저그") bump(p.id, "Overlord", 1);
    }
    for (const life of done) {
      if (life.bld) continue;
      const k = majorityKindOf2(life);
      if (k) bump(life.owner, k, -1);
    }
    let filled = 0;
    let overQuota = 0;
    for (const [life, m] of votes) {
      if (majorityKindOf2(life) !== "") continue;   // 그 사이에 이름이 붙었으면 건드리지 않는다
      /* 여러 종류가 나뉘어 나왔다면(어떤 선택에서는 질럿뿐, 다른 선택에서는 드라군뿐)
         그 태그는 둘 사이를 오간 것이 아니라 우리가 잘못 짝지은 것이다 — 안 준다. */
      if (m.size !== 1) continue;
      const [[kind]] = [...m];
      if ((quota.get(life.owner)?.get(kind) ?? 0) <= 0) { overQuota += 1; continue; }
      bump(life.owner, kind, -1);
      life.kinds.set(kind, 1);
      filled += 1;
    }
    coSelFilled = filled;
    coSelOverQuota = overQuota;

    /* ── 남은 몫을 무명에게 배정한다(과제 #71) ────────────────────────────────
       여기까지 와도 이름이 없는 생애가 남고, 반대로 뽑았는데 아무 태그에도 안 붙은
       원장 몫이 남는다. 둘은 같은 구멍의 양쪽이다 — 짝지어 준다.

       지적: "공동선택보다는 원장이 우선, 아니면 둘이 동급." 그래서 순서가 이렇다.
         ① 원장이 태그를 직접 묶는다(위 결합 패스). 가장 센 증거다.
         ② 동반이 제안하되 원장 몫 안에서만(위).
         ③ 남은 몫을 남은 무명에게 준다(여기).
       ①②③ 모두 원장 총량을 넘지 않으므로, 이름을 붙일수록 수급이 오히려 맞아 간다.

       고르는 자는 행동이다 — 공격 명령(f=7)을 낸 개체는 일꾼일 수 없고, 건물을
       앉힌(f=2) 개체는 일꾼일 수밖에 없다. 그 다음은 남은 몫이 가장 많은 종류다
       (많이 뽑은 것일수록 눈앞의 무명이 그것일 확률이 높다). */
    let quotaFilled = 0;
    const workerOf = new Map(players.map((p) => [p.id, RACE_WORKER[p.race] ?? ""] as const));
    const unnamed = done.filter((l) => !l.bld && majorityKindOf2(l) === "")
      .sort((a, b) => a.born - b.born);
    for (const life of unnamed) {
      const m = quota.get(life.owner);
      if (!m) continue;
      const worker = workerOf.get(life.owner) ?? "";
      const attacked = life.ev.some((v) => v[3] === 7);
      const builtSomething = life.ev.some((v) => v[3] === 2);
      let best = "";
      let bn = 0;
      for (const [k, n] of m) {
        if (n <= 0) continue;
        if (attacked && k === worker) continue;          // 일꾼은 공격 명령을 안 받는다
        if (builtSomething && k !== worker) continue;    // 건물을 앉힌 것은 일꾼뿐이다
        if (n > bn) { best = k; bn = n; }
      }
      if (!best) continue;
      m.set(best, bn - 1);
      life.kinds.set(best, 1);
      quotaFilled += 1;
    }
    /* ④ 마지막 그물 — 그래도 이름이 없는데 동반이 할 말이 있으면, 몫을 넘더라도 준다.
       ①②③이 다 지나간 뒤이므로 여기 오는 것은 '원장이 아는 생산보다 관측된 생애가
       많은' 자리다. 원장이 완벽하지 않다는 뜻이고(지적: 인구 막힘·전력 끊김·건물
       파괴로 어차가 있다 — 그 반대 방향의 누락도 있다), 그럴 때 이름 없이 두면 그
       개체는 화면에서 반투명한 무명으로, 시뮬에서는 기본 유닛으로 산다. 동반이라는
       실제 증거가 있는데 그것보다 나쁜 쪽을 고를 이유가 없다.
       넘긴 횟수는 남겨 둔다 — 이 수가 크면 원장이 덜 세고 있다는 신호다. */
    let overFilled = 0;
    for (const [life, m] of votes) {
      if (majorityKindOf2(life) !== "" || m.size !== 1) continue;
      const [[kind]] = [...m];
      life.kinds.set(kind, 1);
      overFilled += 1;
    }
    coSelOverFilled = overFilled;
    quotaAssigned = quotaFilled;
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
    // 스팀 증거는 여기서도 이긴다 — 체력·무기·속도를 이 이름으로 고르기 때문이다.
    return life.bld ? best : stimSettles(life, best);
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
     이름의 부류(보병·차량·근접…)까지 가르는 건 이 근사 모델엔 과하다 — 연구가 끝나는
     시각부터 그 사람 전체에 적용한다.
     ★ 그 '끝나는 시각'이 여태 **일률 70초**였다(과제 #71). 표(bwUnits.UPGRADE_TIME)는
       진작 있었고 제 주석에 "옛 분석 코드가 쓰던 일률 70초는 2.4배 빠른 값"이라고까지
       적혀 있었는데, 부르는 곳이 없었다. 공·방업 1렙은 4000프레임(168초)이고 2·3렙은
       480프레임씩 더 걸린다 — 즉 화면과 시뮬은 업그레이드를 1분 40초 넘게 일찍 주고
       있었다. 같은 이름이 두 번째로 나오면 그것이 2레벨이라 시간도 그만큼 는다. */
  const wUpsBy = new Map<number, number[]>();
  const aUpsBy = new Map<number, number[]>();
  const upLvSeen = new Map<string, number>();
  for (const [usec, uname, upid] of ups) {
    const isW = /Weapons|Attacks/.test(uname);
    const isA = /Armor|Plating|Carapace|Plasma Shields/.test(uname);
    if (!isW && !isA) continue;
    const lvKey = `${upid}|${uname}`;
    const lv = (upLvSeen.get(lvKey) ?? 0) + 1;
    upLvSeen.set(lvKey, lv);
    const m = isW ? wUpsBy : aUpsBy;
    const arr = m.get(upid) ?? [];
    arr.push(usec + upgradeSeconds(uname, lv));
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
  /** 방어 건물 한 채의 전투 값 — 자리를 세울 때 한 번만 본다.
   *  벙커만 예외다: 원전에서 벙커 **자신**은 무기가 없어(UNITS.Bunker의 ground/air가
   *  둘 다 null) 표대로 두면 한 발도 못 쏜다. 실제로 쏘는 것은 안에 탄 보병인데 이
   *  원장은 탑승 목록을 안 들고 있으므로, 어댑터가 내주는 '벙커 보너스를 받은 마린
   *  한 기'로 어림한다(bwCombat.bunkerFallbackProfile — 스스로 [추정]이라 밝힌 값). */
  const defProfOf = (kind: string): CombatProfile =>
    (kind === "Bunker" ? bunkerFallbackProfile() : profileOf(kind));
  const defSpots: {
    owner: number; x: number; y: number; from: number; to: number;
    /** 아래 dps·air는 사장된 hpSimOf 경로가 아직 읽는다. 세계 시뮬은 prof만 본다. */
    dps: number; air?: boolean;
    kind: string;
    /** 사격 값 한 벌 — 벙커만 '안에 탄 마린'의 것이다. */
    prof: CombatProfile;
    /** 건물 자신의 몸 반지름(타일) — 사거리를 중심-중심으로 옮길 때 더한다. 벙커는
     *  prof가 마린이라 prof.radius를 쓰면 3×2 건물이 마린 몸집으로 줄어든다. */
    rad: number;
  }[] = [];
  for (const b of built) {
    if (DEF_KINDS.has(b.kind)) {
      const f = DEF_FIRE[b.kind] ?? { dps: 10 };
      defSpots.push({
        owner: b.owner, x: b.x + 1, y: b.y + 1, from: b.born + 40, to: b.gone ?? Infinity,
        kind: b.kind, prof: defProfOf(b.kind), rad: profileOf(b.kind).radius,
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
      kind: best, prof: defProfOf(best), rad: profileOf(best).radius,
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
/** 건물을 때리는 첫 명령이 주는 시간(초) — 기준 삼을 직전 명령이 없을 때의 한 모금. */
const BLD_FIRST_SEC = 2;
/** 같은 임자의 두 명령 사이를 '계속 때린 시간'으로 볼 상한(초) — 이보다 벌어지면
 *  그 사이엔 딴 데를 보고 있었다고 본다. */
const BLD_MAX_GAP_SEC = 6;
/** 원장이 분석보다 먼저 건물을 무너뜨려도 좋은 폭(초) — 붕괴 결합이 마지막 8초에 걸쳐
 *  0으로 내리므로 그와 같은 값이다. 여기가 넓으면(옛 30초) 분석이 말한 죽음보다 한참
 *  앞서 무너져, 화면에서 건물이 이르게 사라진다. */
const BLD_DIE_SLACK_SEC = 8;

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
    /* 화력은 '명령 수'가 아니라 '시간'이 정한다(지적 #53: 건물이 너무 이르고 너무 많이
       부서짐). 여태는 곁에 떨어진 적 공격 명령 하나마다 최대 120을 통째로 깎았다 —
       클릭이 잦은 사람일수록 상대 건물이 빨리 무너지는 역설이고, 850짜리 건물이 여덟
       번의 클릭으로 재가 됐다. 유닛 쪽은 이 병을 진작 고쳤는데(교전 원장의 피해 보존)
       건물은 그 원장에서 통째로 빠져 있어(`if (life.bld) continue`) 옛 모형이 그대로
       남아 있었다.
       이제 한 명령은 '언제부터 언제까지 때렸나'만 말한다: 같은 임자의 직전 명령부터
       흐른 시간만큼 제 DPS로 깎는다. 연타는 시간이 거의 안 흘러 거의 안 깎이고,
       띄엄띄엄 이어지는 공격은 그 사이만큼 깎인다. 첫 명령은 기준이 없으므로 짧은
       한 모금(BLD_FIRST_SEC)만 준다. */
    const lastByOwner = new Map<number, number>();
    const trace: [number, number][] = [];
    let lastPct = 100;
    const push2 = (sec3: number): void => {
      /* 살아 있으면 0으로 안 내려간다(지적 #53) — 퍼센트를 5칸 단위로 반올림하다 보니
         체력이 남아 있는데도 0%로 찍히는 자리가 있었다(850짜리 건물이 1 남으면 0.02%
         → 0). 화면은 0을 죽음으로 읽으므로(hpZero), 그 반올림 하나가 멀쩡한 건물을
         무너뜨렸다. 진짜 0은 아래 죽음 처리에서만 나온다. */
      const alive4 = hp2 + sh2 > 0;
      const p4 = Math.max(alive4 ? 5 : 0, Math.round(((hp2 + sh2) / total) * 20) * 5);
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
      const prevOwn = lastByOwner.get(a.owner);
      lastByOwner.set(a.owner, a.sec);
      const shotSec = prevOwn === undefined
        ? BLD_FIRST_SEC : Math.min(BLD_MAX_GAP_SEC, a.sec - prevOwn);
      let dmg2 = a.dps * shotSec * (1 + 0.1 * lvOf(wUpsBy, a.owner, a.sec));
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
      /** 전투 값 한 벌 — 표는 개체를 세울 때 한 번만 본다. 교전 루프는 초마다 개체
       *  수의 제곱을 도는 자리라 거기서 이름으로 표를 뒤지면 그 자체가 병목이다. */
      prof: CombatProfile;
      x: number; y: number; startAt: number; alive: boolean;
      hp: number; sh: number; maxHp: number; maxSh: number;
      evIdx: number; tgt: [number, number] | null; hidden: boolean;
      /** 시즈모드인가(f=8 켬 / f=9 해제) — 시즈 포탄의 아군 피해(요청)를 가르는 자. */
      sieged: boolean;
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
        prof: profileOf(mk),
        healable: !MECH_UNITS.has(mk) && mediLives.length > 0,
        x: first[1], y: first[2], startAt: Math.max(0, Math.min(first[0], life.born)),
        alive: true, hp: st.hp, sh: st.sh ?? 0, maxHp: st.hp, maxSh: st.sh ?? 0,
        evIdx: 0, tgt: null, hidden: false, sieged: false,
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
    /* ── 초당 피해(사람이 읽는 수) — 실드에 쓸 수치와 체력에 쓸 수치를 **따로** 낸다.
       ─ 왜 둘인가: 원전에서 실드는 유닛 방어력도 크기 배수도 안 받는다
         (bwgame.h weapon_deal_damage — 실드 차감이 방어력 뺄셈보다 **먼저**다).
         그래서 같은 무기라도 실드에 박히는 값과 체력에 박히는 값이 다르다. 예전 원장은
         한 값으로 뭉쳐 놓고 실드부터 깎아, 실드가 남은 유닛에게는 방어력이 이미 빠진
         값을 실드 피해로 냈다.
       ─ 왜 bwCombat.dpsOf를 안 쓰는가: 그쪽은 공격자 값 한 벌에 박힌 공업 레벨만 쓴다.
         이 원장은 업그레이드가 경기 도중 오르는 것을 초 단위로 따라가야 해서
         (lvOf(wUpsBy, …, sec)) 레벨을 밖에서 넣어야 한다. 그래서 같은 셈을 표의
         attackOf·targetFor로 여기서 다시 편다 — 피해 공식 자체는 여전히 표의 것이다.
       ─ 캐시: 교전 루프는 초마다 개체 수의 제곱을 도는 자리다. 같은
         (무기, 공업, 표적, 방업) 조합마다 객체 둘을 새로 만들면 그 자체가 병목이라
         결과를 열쇠로 붙들어 둔다. 열쇠 구분자는 NUL — 유닛 이름에 공백·괄호가 있다.
       ─ [어림] 이 원장의 업그레이드 집계(aUpsBy)는 정규식 하나로 방어구·카라파스·
         키틴질 갑피·플라즈마 실드를 한 숫자로 뭉친다(map-replayunits D-23). 그래서
         여기서는 그 숫자를 전부 '유닛 방어력 +n'으로만 넣는다 — 플라즈마 실드의
         실드 −1/렙과 키틴질 갑피의 +2는 따로 세지 못한다. 부류를 제대로 가르려면
         업그레이드 이름을 그대로 실어 bwCombat.profileOf(kind, ups)에 넘기는 길이
         이미 나 있다(UpgradeState). 그 배관은 이 단계 밖이다. */
    const DPS_BIG = 1 << 30;
    const dpsCache = new Map<string, { hp: number; shield: number }>();
    const dpsVs = (
      w: ProfWeapon, atk: CombatProfile, wLv: number, tgtKind: string, armorLv: number,
    ): { hp: number; shield: number } => {
      const ck = `${w.key}\u0000${wLv}\u0000${tgtKind}\u0000${armorLv}`;
      const hitc = dpsCache.get(ck);
      if (hitc) return hitc;
      // 쿨 0인 무기는 표에 없다 — 0으로 나누는 것만 막는 자리다.
      const cd = w.cd > 0 ? w.cd : 1;
      const bare = targetFor(tgtKind, undefined, {
        hp: DPS_BIG, shield: 0, hasShield: false, armorLv,
      });
      const hp = attackOf(w, atk, bare, { weaponLv: wLv }).hp / 256 / cd;
      let shield = 0;
      if (profileOf(tgtKind).hasShield) {
        const shd = targetFor(tgtKind, undefined, {
          hp: DPS_BIG, shield: DPS_BIG, hasShield: true, armorLv,
        });
        shield = attackOf(w, atk, shd, { weaponLv: wLv }).shield / 256 / cd;
      }
      const r = { hp, shield };
      dpsCache.set(ck, r);
      return r;
    };
    /* ── 피해 한 번. shAmt는 '실드에 박힐 때의 값', hpAmt는 '체력에 박힐 때의 값'이다.
       둘을 한꺼번에 더하면 실드를 가진 유닛이 두 배로 맞는다 — 실드가 남아 있으면
       실드용 수치로만 깎고, 이 틱에 실드가 바닥나면 못 쓴 몫의 비율만큼을 체력용
       수치로 환산해 이어 깎는다. 원전처럼 히트 하나하나에서 넘침을 세는 것이 아니라
       초당 값을 비율로 가르는 [어림]이다 — 이 원장의 시간 눈금이 1초라 그 아래는 못 본다.
       방어구 업그레이드는 여기서 곱셈(-8%/렙)으로 걷어내지 않는다. 이제 dpsVs가
       방어력에 정액으로 얹어(원전은 렙당 +1) 피해 쪽에서 뺀다 — 그래야 저글링 5와
       울트라 20에 같은 뜻이 된다(map-replayunits D-23). */
    const hurtSplit = (
      a: Agent, sec: number, shAmt: number, hpAmt: number, spell: boolean,
    ): void => {
      if (!a.alive || (shAmt <= 0 && hpAmt <= 0)) return;
      if (sec < a.stasisUntil) return; // 얼음 속은 무적
      let sd = shAmt;
      let hd = hpAmt;
      if (!spell) {
        sd *= a.dmgScale;
        hd *= a.dmgScale;
        // 다크스웜 아래선 크게 준다(근접·원거리 뭉뚱그려 0.35).
        if (swarms.some(([ws, wx, wy]) => sec - ws >= 0 && sec - ws <= 25
          && Math.hypot(wx - a.x, wy - a.y) <= 2.5)) { sd *= 0.35; hd *= 0.35; }
      }
      if (a.matrixLeft > 0 && sec <= a.matrixUntil) {
        // 매트릭스는 실드보다 먼저 흡수한다 — 두 몫을 같은 비율로 눅인다.
        const tot = Math.max(sd, hd);
        const ab = Math.min(a.matrixLeft, tot);
        a.matrixLeft -= ab;
        const keep = tot > 0 ? (tot - ab) / tot : 0;
        sd *= keep;
        hd *= keep;
      }
      let toHp = hd;
      if (a.sh > 0 && sd > 0) {
        const toSh = Math.min(a.sh, sd);
        a.sh -= toSh;
        toHp = hd * Math.max(0, 1 - toSh / sd);
      }
      // 메딕 곁 경감은 체력 몫만(실드는 못 채워 주니 못 막는다).
      if (toHp > 0 && !spell && a.healable && medicNearSim(a, sec)) toHp *= 0.65;
      a.hp -= toHp;
      mark(a, sec);
      if (a.hp <= 0) onZero(a, sec);
    };
    /* 주문 피해 — 방어력도 크기 배수도 실드 면제도 안 탄다. 실드용·체력용 수치가 같아
       위 비율 셈이 곧 '실드 먼저, 넘친 만큼 체력'이 된다. */
    const hurt = (a: Agent, sec: number, amt: number, spell: boolean): void => {
      hurtSplit(a, sec, amt, amt, spell);
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
    /* 증거가 죽음을 이긴다(기획서 docs/plan-sim-core-v4.md — 개체 트랙의 첫째 원칙)
       리플레이에서 뒤에 명령을 받은 태그는 그 순간 확실히 살아 있다. 배분한 피해가
       먼저 0에 닿았다면 그건 '배분이 과했다'는 뜻이지 그 유닛이 죽었다는 뜻이 아니다.
       예전엔 네 번까지만 살려 주고 그 뒤로는 죽인 다음 남은 증거를 새 생애(꼬리)로
       갈랐는데, 그 탓에
         ① 한 유닛이 여럿으로 늘고(실측 이 경기 꼬리 50개 — 3시 질럿만 19개,
            질럿 개체 97기 대 실제 생산 80기),
         ② 갓 갈린 꼬리가 전투 한복판에서 태어나 2~4초 만에 또 죽어, 화면에서
            깜빡였다(지적: 질럿들이 자꾸 페이드아웃된다).
       이제 뒤 증거가 있으면 무조건 산다. 태그 재사용(진짜로 죽고 번호를 물려준 경우)은
       위쪽 '태그 재사용 분리'가 따로 가른다 — 거기 잣대는 유닛의 실제 자리인 강한
       앵커(f=1) 사이의 물리적으로 불가능한 도약이라 명령 좌표에 안 속는다. */
    const onZero = (a: Agent, sec: number): void => {
      const nv = a.life.ev.find((v) => v[1] >= 0 && v[0] > sec + 2);
      if (nv) {
        // 산 유닛을 죽였다 = 배분 과대 — 살리되 남은 피해를 눅인다(기존 원칙 그대로).
        a.revives += 1;
        a.dmgScale = Math.max(0.05, a.dmgScale * 0.55);
        a.hp = a.maxHp * (0.2 + ((Math.abs(a.life.tag) * 37) % 24) / 100);
        a.sh = 0;
        mark(a, sec);
        return;
      }
      a.alive = false;
      a.trace.push([Math.round(sec), 0]);
      simDeathOf.set(a.life, Math.round(sec + 1 + (Math.abs(a.life.tag) % 4)));
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
          else if (v[3] === 8) a.sieged = true;
          else if (v[3] === 9) a.sieged = false;
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
              /* 방어 건물의 사거리와 화력도 표에서 온다(과제 #48·#54).
                 여태 성큰·캐논·스포어·터렛·벙커가 모두 **7.5타일 한 값**이었고, 화력은
                 표적 크기·방어력과 무관한 dps 스칼라였다. 이제 무기가 없으면(성큰이
                 공중을, 터렛이 지상을) 아예 못 쏘므로 위 sp.air 검사가 여기 녹아 있다.
                 사거리는 무기 사거리에 양쪽 몸 반지름을 더해 중심-중심으로 옮긴다 —
                 원전은 스프라이트 상자의 모서리 사이를 재기 때문이다(bwgame.h
                 unit_distance 계열). 그 덧셈의 근거와 값은 bwCombat.reachTiles 주석에
                 있고, 여기서는 자리 좌표가 이미 발자국 중심이라 같은 식을 손으로 편다. */
              const w = weaponVs(sp.prof, a.air);
              if (!w) continue;
              const reach = w.rangeTiles + sp.rad + a.prof.radius;
              if (Math.hypot(sp.x - a.x, sp.y - a.y) > reach) continue;
              const bite = dpsVs(
                w, sp.prof, lvOf(wUpsBy, sp.owner, sec),
                a.kind, lvOf(aUpsBy, a.life.owner, sec),
              );
              hurtSplit(a, sec, bite.shield * 3, bite.hp * 3, false);
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
        /* 화력 배분 — 예전 셈은 상대 편 dps를 통째로 합쳐 우리 편 인원수로 나눴다.
           거기엔 구멍이 셋 있었다(map-replayunits A-2·A-3·B-5):
             (ㄱ) 하한 max(2, dps) 탓에 무기가 아예 없는 오버로드·메딕·드랍십·과학선·
                  퀸·디파일러까지 초당 2씩 때렸다 — 오버로드 20기 뭉치가 초당 40의
                  화력이었다.
             (ㄴ) 대공·대지 구분이 없어 질럿이 뮤탈을 때리고 스커지가 지상을 때렸다.
             (ㄷ) 표적 크기·방어력·공격 종류가 전혀 안 들어갔다 — 익스플로시브가 스몰에
                  절반만 들어가는 원전의 뼈대가 통째로 없었다.
           이제 사수마다 '이 표적에게 쓸 무기'를 표에서 찾고(weaponVs — 없으면 그 사수는
           이 표적에게 한 톨도 못 낸다), 그 무기가 이 표적에게 내는 초당 피해를 그 사수가
           겨눌 수 있는 표적 수로 나눠 준다. 가동률 0.7은 그대로 둔다 — 배분 방식만
           바뀌는 것이지 총 화력의 눈금을 여기서 다시 고르지 않는다.
           ⚠ 원전의 집중사격·오버킬은 여전히 없다(B-5). 이것은 '한 편이 낸 화력을 상대
           편에 고르게 흩는' 모형이고, 다만 흩는 단위가 유닛 하나에서 무기 하나로
           내려온 것이다. */
        let totAir = 0;
        let totGnd = 0;
        const nAir = new Map<string, number>();
        const nGnd = new Map<string, number>();
        for (const [k2, list2] of present) {
          let ca = 0;
          let cg = 0;
          for (const x of list2) { if (x.air) ca += 1; else cg += 1; }
          nAir.set(k2, ca);
          nGnd.set(k2, cg);
          totAir += ca;
          totGnd += cg;
        }
        /* 사수마다 겨눌 수 있는 표적 수를 미리 센다 — 안쪽 루프에서 다시 세면 개체 수의
           세제곱이 되어 큰 교전에서 분석이 멈춘다. */
        const canHit = new Map<Agent, number>();
        for (const [k2, list2] of present) {
          const oa = totAir - (nAir.get(k2) ?? 0);
          const og = totGnd - (nGnd.get(k2) ?? 0);
          for (const e2 of list2) {
            canHit.set(e2, (e2.prof.air ? oa : 0) + (e2.prof.ground ? og : 0));
          }
        }
        for (const [key, mine] of present) {
          for (const a of mine) {
            const aLv = lvOf(aUpsBy, a.life.owner, sec);
            let sh = 0;
            let hp = 0;
            for (const [k2, list2] of present) {
              if (k2 === key) continue;
              for (const e2 of list2) {
                const w = weaponVs(e2.prof, a.air);
                if (!w) continue;
                const n = canHit.get(e2) ?? 0;
                if (n <= 0) continue;
                const bite = dpsVs(w, e2.prof, lvOf(wUpsBy, e2.life.owner, sec), a.kind, aLv);
                sh += bite.shield / n;
                hp += bite.hp / n;
              }
            }
            if (sh <= 0 && hp <= 0) continue;
            hurtSplit(a, sec, sh * 0.7, hp * 0.7, false);
          }
        }
        /* 아군 피해(럴커·시즈모드·리버)는 물렸다(지적: 전투의 내용과 결과가 완전히
           달라짐 + 공격하는 유닛이 없는데 에너지가 달거나 죽는다) — 표적 둘레에
           편 안 가리고 터뜨리는 갈래를 넣었더니, 전투마다 아군 피해가 겹쳐 쌓여
           승패까지 뒤집혔고 '때린 놈이 안 보이는 죽음'이 늘었다. 되돌린다.
           다시 넣을 때는 ① 실제 사격 박자(초당 한 발)에 묶고 ② 피해를 전체 배분에서
           덜어 오는 식이라야 총량이 안 늘어난다. */
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
            const gx3 = r1(xs3[Math.floor(xs3.length / 2)] - 1.5);
            const gy3 = r1(ys3[Math.floor(ys3.length / 2)] - 1.5);
            /* 클릭 중앙값은 ±1타일쯤 어긋난다 — 그대로 자리로 삼으면 이미 그려지고 있는
               물리 건물 옆에 유령이 하나 더 선다(수리: 안 지은 넥서스가 시작 넥서스와
               겹치는 자리에 생긴다. 실측 이 경기에서 넥서스 2·게이트웨이 5·성큰 1이
               그렇게 늘었다). 같은 임자의 실제 건설 기록 중 그때 서 있던 가장 가까운
               것에 붙여, 유령 대신 '그 건물의 태그가 이것'이라는 사실만 남긴다. */
            const mk3 = majorityKindOf(life);
            let snap: (typeof built)[number] | null = null;
            let sd3 = 3.2;
            for (const pass3 of [0, 1]) {
              for (const b3 of built) {
                if (b3.tag !== undefined || b3.owner !== life.owner) continue;
                if (pass3 === 0 && mk3 && b3.kind !== mk3) continue;
                if (b3.born > life.last + 2) continue;
                if (b3.gone !== null && b3.gone < life.born - 2) continue;
                const dd3 = Math.hypot(b3.x - gx3, b3.y - gy3);
                if (dd3 < sd3) { snap = b3; sd3 = dd3; }
              }
              if (snap) break;
            }
            if (snap) {
              snap.tag = life.tag;
            } else {
              /* 붙일 데가 없으면 어림 자리를 그대로 쓰되 갈래를 17(추정 자리)로 둔다 —
                 표적 지도와 체력 원장만 쓰고 화면에는 그리지 않는다. */
              site2 = [life.born, gx3, gy3, 17];
              life.ev.unshift(site2);
            }
          }
        }
        if (site2) {
          const mk2 = majorityKindOf(life);
          /* 살아남음의 근거에 '분석이 내린 죽음'을 넣는다(지적 #53) — 여태 태그 건물은
             '그 뒤에 제 증거가 또 있나'만 봤다. 건물은 한 번 지어 놓고 다시 안 고르는
             일이 흔해 증거가 거의 없고, 그래서 곁에 적 공격이 두어 번만 떨어져도 그 자리
             에서 무너졌다. 실측(경기 1): 건물 704 중 체력 원장이 135를 0으로 보냈는데
             그중 125가 분석이 말한 죽음보다 일렀고(중앙 81초), 38은 분석이 '끝까지
             살았다'고 한 건물이었다.
             물리 건물 경로(아래 built 순회)에는 이 보호막이 진작 있었다 — 태그 건물에만
             없던 비대칭이다. 같은 잣대로 맞춘다: 분석이 죽음을 안 내렸으면(d === null)
             안 죽고, 내렸어도 아직 한참 뒤면(+30초) 지금 죽지 않는다. */
          const tr2 = bldHpSimOf(
            mk2, life.owner, site2[1] + 1.5, site2[2] + 1.5,
            life.born, d ?? life.last, life.tag,
            (sec3) => life.ev.some((v) => v[0] > sec3) || d === null || d > sec3 + BLD_DIE_SLACK_SEC,
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
      /* 붕괴 결합 — 물리 건물이 하던 것(아래 built 순회)을 태그 건물에도 준다. 원장만
         두면 체력이 8%쯤 남은 채로 죽음 시각을 맞아 바가 뚝 끊긴다. 죽는 건물은 마지막
         8초에 걸쳐 0으로 내려간다. 이 자리에서 하는 것은 d가 여기까지 와서야 확정되기
         때문이다(바로 위 next 보정). */
      if (life.bld && d !== null) {
        /* 한 번도 안 맞은 채 무너지는 건물도 무너지는 8초를 갖는다 — 원장이 비었다고
           건너뛰면 만피에서 곧장 사라져 뚝 끊긴다. */
        const base9: [number, number][] = hpTrace && hpTrace.length > 0
          ? hpTrace : [[Math.round(life.born), 100]];
        const g9 = Math.max(life.born, d - 8);
        const last9 = [...base9].reverse().find((q) => q[0] <= g9) ?? base9[0];
        hpTrace = [...base9.filter((q) => q[0] < g9),
          [Math.round(g9), last9[1]] as [number, number],
          [Math.round(d), 0] as [number, number]];
      }
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
    /* 철거의 근거는 '발치 공격'(f=1)뿐이다(수리: 시작 홀·변태로 이어 세운 홀이 태어나자
       마자 무너졌다) — 자리 증거(f=2)까지 섞어 마지막 항목만 보고 있었더니, 공격을 한
       번도 안 받은 건물이 제 자리 증거 시각 +8초에 철거된 것으로 잡혔다. */
    const atkEv = [...b.ev].reverse().find((v) => v[3] === 1);
    if (b.gone === null && atkEv) {
      const lastAtk = atkEv[0];
      const defended = built.some((o) =>
        o !== b && o.owner === b.owner && o.born > lastAtk && o.born < lastAtk + 180
        && Math.hypot(o.x - b.x, o.y - b.y) <= 12);
      if (!defended) { b.gone = lastAtk + 8; b.goneKind = "atk"; }
    }
    let bHp = bldHpSimOf(
      b.kind, b.owner, b.x + 1.5, b.y + 1.5, b.born, b.gone ?? b.born + 3600, null,
      (sec3) => b.ev.some((v) => v[0] > sec3) || b.gone === null || b.gone > sec3 + BLD_DIE_SLACK_SEC,
    );
    /* 붕괴 결합(기획서 2-E) — 명령 원장만으로는 체력 80~100%가 남은 채 철거 시각에
       돌연 무너졌다. 붕괴가 확정된 건물은 8초 전부터 0으로 선형 수렴시킨다. */
    if (b.gone !== null) {
      // 원장이 비어도 무너지는 8초는 준다(위 태그 건물과 같은 잣대).
      if (bHp.length === 0) bHp = [[Math.round(b.born), 100]];
      const g8 = Math.max(b.born, b.gone - 8);
      const lastQ = [...bHp].reverse().find((q) => q[0] <= g8) ?? bHp[0];
      bHp = bHp.filter((q) => q[0] < g8);
      bHp.push([Math.round(g8), lastQ[1]], [Math.round(b.gone), 0]);
    }
    ents.push({
      t: b.tag ?? -1, o: b.owner, k: b.kind, b: Math.round(b.born),
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
      bldVoided: buildStats.voided, bldClosed: buildStats.closed,
      moveDropped: moveStats.dropped, moveKept: moveStats.kept,
      coSelFilled,
      coSelOverQuota,
      quotaAssigned,
      coSelOverFilled,
      prodRazed: prodStats.razed,
      prodNoSite: prodStats.noSite,
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
