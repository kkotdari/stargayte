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
import { CAST_ORDER_TO_UNIT, USE_CMD_TO_UNIT } from "./replayTechNames";
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
}

/* ── 출력 — 별도 테이블(game_result_unit_tracks)에 JSON으로 담긴다(요청: 별도 테이블로
      해서 기존 부대 추적과 비교). ──────────────────────────────────────────── */
/** 증거 한 점: [초, 타일x, 타일y, 종류]. 종류 — 0 이동명령의 목적지(여기로 '가라'),
 *  1 남이 찍은 자리(그 순간 실제로 '있던' 자리 — 강한 앵커), 2 건설 자리(일꾼이 가서
 *  지은 자리), 3 멈춤·홀드·시즈·버로우(그 자리에 '선다'), 4 생산·랠리(건물이 일한 증거 —
 *  위치 정보 없음, x·y는 랠리 좌표거나 -1). */
export type UnitEv = [number, number, number, number];
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
   *  소식 없음), morph(변태로 이어짐 — 죽음이 아니라 다음 생애로 계속), "". */
  dk: "tag" | "atk" | "morph" | "";
  /** 건물이면 1. */
  bld: 0 | 1;
  ev: UnitEv[];
}
export interface UnitTracksV2 {
  v: 2;
  players: { id: number; name: string; race: Race | "" }[];
  ents: UnitEnt[];
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
  "Hatchery", "Spawning Pool", "Hydralisk Den", "Spire", "Queen's Nest", "Ultralisk Cavern",
  "Defiler Mound", "Evolution Chamber", "Extractor", "Nydus Canal",
  "Supply Depot", "Refinery", "Engineering Bay", "Academy", "Missile Turret", "Bunker",
  "Armory", "Science Facility", "Comsat Station", "Nuclear Silo", "Machine Shop", "Control Tower",
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
const r1 = (n: number): number => Math.round(n * 10) / 10;

/** 정체 증거들을 하나의 이름으로 굳힌다 — 구체 증거가 있으면 다수결, 그룹 증거뿐이면
 *  대표(마린·수송선은 종족 것)로. */
function settleKind(life: Life, race: Race | ""): string {
  if (life.kinds.size > 0) {
    let best = "";
    let bestN = 0;
    for (const [k, n] of life.kinds) if (n > bestN) { best = k; bestN = n; }
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
  players: { id: number; name: string; race: Race | "" }[],
): UnitTracksV2 {
  const playing = new Set(players.map((p) => p.id));
  const raceOf = new Map(players.map((p) => [p.id, p.race] as const));

  const sel = new Map<number, number[]>();
  const groups = new Map<string, number[]>();
  /** 태그 → 지금 살아 있는 생애. 끝난 생애는 done으로 옮긴다. */
  const alive = new Map<number, Life>();
  const done: Life[] = [];
  /** 물리 건물(건설 좌표로 아는 것) — 태그가 없어도 개체다(요청: 건물 파괴 파악). */
  const built: { owner: number; kind: string; born: number; x: number; y: number; ev: UnitEv[] }[] = [];
  let attributed = 0;
  let anchors = 0;
  let totalOrders = 0;

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
        born: sec, last: sec, lastAtk: null, evAfterAtk: false, morphTo: null, ev: [],
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
      prev[0] = sec;
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

    const tags = sel.get(pid) ?? [];
    const orderName = nameOf(c.Order);
    const unitName = nameOf(c.Unit);
    const pos = posOf(c);

    // ── 명령 → 골라 둔 번호들의 증거 ──
    const isOrder = cmdName === "Targeted Order" || cmdName === "Right Click";
    if (isOrder) totalOrders += 1;
    if (isOrder && tags.length > 0) attributed += 1;

    if (cmdName === "Build" || cmdName === "Build Addon" || cmdName === "Hatch") {
      // 건설 — 고른 것은 일꾼이고, 자리(pos)로 걸어가 짓는다. 건물은 물리 개체로 태어난다.
      const worker = RACE_WORKER[raceOf.get(pid) ?? ""] ?? "";
      for (const tag of tags) {
        let life = lifeOf(tag, pid, sec);
        if (worker && cmdName !== "Hatch") life = markKind(life, worker, sec);
        if (pos) pushEv(life, sec, pos.x, pos.y, 2);
      }
      if (pos && unitName && cmdName !== "Hatch") {
        built.push({ owner: pid, kind: unitName, born: sec, x: pos.x, y: pos.y, ev: [] });
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
          // 정체가 바뀌며 이어진다 — 해처리→레어는 같은 몸이라 생애를 가르지 않고
          // 새 이름을 다수결에 얹는다(재생기는 마지막 이름을 쓴다).
          life.kinds.set(unitName, (life.kinds.get(unitName) ?? 0) + 2);
          life.bld = true;
        }
        pushEv(life, sec, -1, -1, 4);
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
        if (isBld) life.bld = true;
        if (HALT_CMDS.has(cmdName)) {
          const lastPt = life.ev[life.ev.length - 1];
          if (lastPt && lastPt[1] >= 0) pushEv(life, sec, lastPt[1], lastPt[2], 3);
        } else {
          life.last = sec;
        }
      }
      continue;
    }
    if (!isOrder) continue;

    // ── 우클릭·표적 명령 ──
    const castKind = CAST_ORDER_TO_UNIT[orderName] ?? "";
    const isRally = orderName === "RallyPointTile" || orderName === "RallyPointUnit";
    // 자원 클릭 → 일꾼(시작 직후의 통째 선택은 빼고 — 오버로드 오염 방지).
    const resourceClick = cmdName === "Right Click" && RESOURCE_TARGETS.has(unitName)
      && !((c.Frame ?? 0) < EARLY_ALL_SELECT_FRAMES && tags.length >= 4);
    for (const tag of tags) {
      let life = lifeOf(tag, pid, sec);
      if (castKind) life = markKind(life, castKind, sec);
      if (resourceClick) {
        const worker = RACE_WORKER[raceOf.get(pid) ?? ""] ?? "";
        if (worker) life = markKind(life, worker, sec);
      }
      if (isRally) { life.bld = true; pushEv(life, sec, -1, -1, 4); continue; }
      if (pos && !life.bld) pushEv(life, sec, pos.x, pos.y, 0);
      else life.last = sec;
    }

    // ── 찍힌 대상 — 그 순간 거기 '있던' 개체다(강한 앵커). 공격이면 죽음의 근거가 된다. ──
    const targetTag = c.UnitTag ?? 0;
    if (targetTag > 0 && targetTag < 60000 && pos) {
      const target = alive.get(targetTag);
      if (target) {
        anchors += 1;
        pushEv(target, sec, pos.x, pos.y, 1);
        const hostile = target.owner !== pid
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
        if (b.owner === pid || sec < b.born) continue;
        if (Math.abs(b.x - pos.x) <= 2.5 && Math.abs(b.y - pos.y) <= 2.5) {
          b.ev.push([Math.round(sec), r1(pos.x), r1(pos.y), 1]);
        }
      }
    }
  }

  for (const life of alive.values()) done.push(life);

  /* ── 후방 보정 — 뒷결과로 앞을 고친다(지적). 태그별로 생애를 시간순으로 놓고,
        앞 생애의 죽음을 다음 생애의 태어남으로 눌러 잡는다. 공격받고 소식이 없으면
        그때 죽은 것으로, 공격받고도 증거가 이어졌으면 살아남은 것으로. ─────────── */
  const byTag = new Map<number, Life[]>();
  for (const life of done) {
    if (!byTag.has(life.tag)) byTag.set(life.tag, []);
    byTag.get(life.tag)!.push(life);
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
      } else if (life.lastAtk !== null && !life.evAfterAtk) {
        d = life.lastAtk + 4;
        dk = "atk";
      } else if (next) {
        d = Math.max(life.last, Math.min(next.born, life.last + 120));
        dk = "tag";
      }
      if (next && d !== null && d > next.born) d = next.born;
      const race = raceOf.get(life.owner) ?? "";
      ents.push({
        t: life.tag, o: life.owner, k: settleKind(life, race), b: Math.round(life.born),
        d: d === null ? null : Math.round(d), dk, bld: life.bld ? 1 : 0, ev: life.ev,
      });
    }
  }
  // 물리 건물 — 공격 증거만 싣고, 죽음 판정 자체는 재생기·비교 분석의 몫으로 남긴다
  // (v1의 철거 전파와 견줄 대상이라 여기서 섣불리 못박지 않는다).
  for (const b of built) {
    ents.push({
      t: -1, o: b.owner, k: b.kind, b: Math.round(b.born), d: null, dk: "", bld: 1,
      ev: [[Math.round(b.born), r1(b.x), r1(b.y), 2], ...b.ev],
    });
  }

  return {
    v: 2,
    players: players.map((p) => ({ id: p.id, name: p.name, race: p.race })),
    ents,
    stats: { cmds: totalOrders, attributed, anchors, lives, tags: byTag.size },
  };
}
