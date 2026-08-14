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
  stats: { cmds: number; attributed: number; anchors: number; lives: number; tags: number };
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
const ATTACK_ORDERS = new Set<string>([
  "Attack1", "Attack2", "AttackUnit", "AttackMove", "CastPsionicStorm", "CastNuclearStrike",
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
    if (HALT_CMDS.has(cmdName) || cmdName === "Unsiege" || cmdName === "Unburrow"
      || cmdName === "Stim" || cmdName === "Merge Archon" || cmdName === "Merge Dark Archon"
      || cmdName === "Unload All" || cmdName === "Lift Off" || cmdName === "Land"
      || cmdName === "Cancel Train" || cmdName === "Unload") {
      const kind = USE_CMD_TO_UNIT[cmdName] ?? "";
      const isBld = BUILDING_ONLY_CMDS.has(cmdName);
      for (const tag of tags) {
        let life = lifeOf(tag, pid, sec);
        if (kind) life = markKind(life, kind, sec);
        if (cmdName === "Land" && unitName) life = markKind(life, unitName, sec);
        if (isBld) life.bld = true;
        if (cmdName === "Land") {
          // 착륙 — 띄운 건물의 이사 목적지다(커맨드에 자리·건물 이름이 실려 온다).
          // 건설과 같은 타일 좌표다(posTileOf 주석).
          const lpos = posTileOf(c);
          if (lpos) pushEv(life, sec, lpos.x, lpos.y, 5);
        } else if (cmdName === "Lift Off") {
          pushEv(life, sec, -1, -1, 6);
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
    const tgtLife = tgtTag0 > 0 && tgtTag0 < 60000 ? alive.get(tgtTag0) : undefined;
    /* 같은 팀은 적이 아니다(지적: 매딕은 아군 유닛도 치료) — 아군을 찍은 우클릭
       (수리·힐·따라가기)이 공격으로 잡히면 아군이 '공격받고 소식 없음'으로 죽는다. */
    const hostileClick = tgtLife !== undefined && !sameSide(tgtLife.owner, pid);
    const isAtkOrder = ATTACK_ORDERS.has(orderName) || (cmdName === "Right Click" && hostileClick);
    /* 수리·힐(지적: 일꾼 수리 파싱 + 매딕은 아군까지) — 명령 자체가 정체(SCV·매딕)를
       밝히고, 표적 자리로 걸어가 일하는 증거(f=10)가 된다. */
    const isFixOrder = orderName === "Repair" || orderName === "HealMove";
    // 자원 클릭 → 일꾼(시작 직후의 통째 선택은 빼고 — 오버로드 오염 방지).
    const resourceClick = cmdName === "Right Click" && RESOURCE_TARGETS.has(unitName)
      && !((c.Frame ?? 0) < EARLY_ALL_SELECT_FRAMES && tags.length >= 4);
    for (const tag of tags) {
      let life = lifeOf(tag, pid, sec);
      if (tags.length === 1) life.solo = true;
      if (castKind) life = markKind(life, castKind, sec);
      if (resourceClick) {
        const worker = RACE_WORKER[raceOf.get(pid) ?? ""] ?? "";
        if (worker) life = markKind(life, worker, sec);
      }
      if (isRally) { life.bld = true; pushEv(life, sec, -1, -1, 4); continue; }
      /* (걷음) 이동 명령의 건설 무르기 — "건설을 내리고 곧장 자원으로 복귀"가 흔한
         정상 조작이라, 일꾼의 직전 증거만으로는 도착 전·후를 못 가려 오판이 압도한다
         (실측 4:4에서 물리건물 476채 중 185채 취소 — 실제 경기에선 있을 수 없는 수).
         무르기는 확실한 근거 둘만 남긴다: 명시적 취소 커맨드(Cancel Build)와 같은
         일꾼의 도착 전 재건설(아래 Build 분기). 이동 무르기의 진짜 판정은 나중 증거
         (그 건물의 생산·피격 기록)로 뒤집는 후방 보정 쪽이 맞는 길이다. */
      if (pos) pendingBuild.delete(tag);
      if (pos && !life.bld) {
        if (isFixOrder) {
          life.last = sec;
          life.ev.push([Math.round(sec), r1(pos.x), r1(pos.y), 10, tgtTag0]);
        } else if (isAtkOrder) {
          life.last = sec;
          if (life.lastAtk !== null) life.evAfterAtk = true;
          life.ev.push([Math.round(sec), r1(pos.x), r1(pos.y), 7, hostileClick ? tgtTag0 : 0]);
        } else {
          pushEv(life, sec, pos.x, pos.y, 0);
        }
      } else life.last = sec;
    }

    // ── 마법 — 좌표가 남는 것만(스톰·스웜·리콜·마인…). 이름은 v1과 같은 기술명이다. ──
    const castTech = CAST_ORDER_TO_TECH[orderName]
      ?? (orderName === PLACE_MINE_ORDER ? "Spider Mines" : "");
    if (castTech && pos && tags.length > 0) {
      casts.push([Math.round(sec), r1(pos.x), r1(pos.y), castTech, pid]);
    }

    // ── 찍힌 대상 — 그 순간 거기 '있던' 개체다(강한 앵커). 공격이면 죽음의 근거가 된다. ──
    const targetTag = c.UnitTag ?? 0;
    if (targetTag > 0 && targetTag < 60000 && pos) {
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
      || (targetTag > 0 && targetTag < 60000 && cmdName === "Right Click"))) {
      for (const b of built) {
        // 아군 건물도 공격 대상이 아니다(같은 팀 오인 방지 — 위 sameSide 주석).
        if (sameSide(b.owner, pid) || sec < b.born) continue;
        if (Math.abs(b.x - pos.x) <= 2.5 && Math.abs(b.y - pos.y) <= 2.5) {
          b.ev.push([Math.round(sec), r1(pos.x), r1(pos.y), 1]);
        }
      }
    }
  }

  for (const life of alive.values()) done.push(life);

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
      if (life.bld || life.ev.length === 0) continue;
      const first = life.ev.find((v) => v[1] >= 0);
      if (!first || first[0] < 40) continue;
      if (life.ev[0][0] === 0) continue; // 이미 본진 출발 보정을 받은 시작 유닛
      const race = raceOf.get(life.owner) ?? "";
      let kind = "";
      let kn = 0;
      for (const [k, n] of life.kinds) { if (n > kn) { kind = k; kn = n; } }
      if (kind === (RACE_WORKER[race] ?? "") && kind !== "") continue; // 일꾼은 자원 곁 탄생이 자연스럽다
      if (kind === "Overlord") continue;
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
  const atkEvts: { sec: number; x: number; y: number; owner: number }[] = [];
  for (const life of done) {
    for (const v of life.ev) {
      if (v[3] === 7) atkEvts.push({ sec: v[0], x: v[1], y: v[2], owner: life.owner });
    }
  }
  atkEvts.sort((a, b) => a.sec - b.sec);
  /* 편 가르기(팀 정보) — 같은 팀의 공격 명령·방어건물은 위협이 아니다(위 sameSide). */
  const isFoeOf = (a: number, b: number): boolean => !sameSide(a, b);
  /* 방어건물 자리 — 수비측이 명령 한 번 없이 성큰·캐논·벙커로 막아낸 싸움에서도
     공격측이 죽게(지적: 왜케 안 죽어), 마지막 증거가 적 방어건물 발치인 유닛을 잡는다. */
  const DEF_KINDS = new Set(["Sunken Colony", "Photon Cannon", "Bunker"]);
  const defSpots: { owner: number; x: number; y: number; from: number; to: number }[] = [];
  for (const b of built) {
    if (DEF_KINDS.has(b.kind)) {
      defSpots.push({ owner: b.owner, x: b.x + 1, y: b.y + 1, from: b.born + 40, to: b.gone ?? Infinity });
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
    defSpots.push({ owner: life.owner, x: site[1] + 1, y: site[2] + 1, from: life.born + 40, to: life.last + 300 });
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
      const nd = defSpots.find((s) => isFoeOf(s.owner, life.owner)
        && lastPt[0] >= s.from && lastPt[0] <= s.to
        && Math.hypot(s.x - lastPt[1], s.y - lastPt[2]) <= 6);
      if (nd) return lastPt[0] + 3 + (life.tag % 6);
    }
    return null;
  };
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
      } else if (life.lastAtk !== null && !life.evAfterAtk) {
        d = life.lastAtk + 4;
        dk = "atk";
      } else if (next) {
        d = Math.max(life.last, Math.min(next.born, life.last + 120));
        dk = "tag";
      }
      if (d === null && !life.bld) {
        const bd2 = battleDeathOf(life);
        if (bd2 !== null) { d = bd2; dk = "atk"; }
      }
      if (next && d !== null && d > next.born) d = next.born;
      const race = raceOf.get(life.owner) ?? "";
      ents.push({
        t: life.tag, o: life.owner, k: settleKind(life, race), b: Math.round(life.born),
        d: d === null ? null : Math.round(d), dk, bld: life.bld ? 1 : 0, ev: life.ev,
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
    ents.push({
      t: -1, o: b.owner, k: b.kind, b: Math.round(b.born),
      d: b.gone === null ? null : Math.round(b.gone), dk: b.goneKind ?? "", bld: 1,
      ev: [[Math.round(b.born), r1(b.x), r1(b.y), 2], ...b.ev],
    });
  }

  return {
    v: 2,
    players: players.map((p) => ({ id: p.id, name: p.name, race: p.race, color: p.color ?? null })),
    ents,
    ups,
    casts,
    pings,
    stats: { cmds: totalOrders, attributed, anchors, lives, tags: byTag.size },
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
  return json;
}
