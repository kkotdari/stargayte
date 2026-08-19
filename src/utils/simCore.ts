/* 시뮬레이션 코어 v4 — P1: 이동과 주문 상태 기계
 * 기획서: docs/plan-sim-core-v4.md
 *
 * 이 파일의 한 가지 약속: **위치는 적분된 상태다. 절대 시각 t의 함수가 아니다.**
 * 그래서 순간이동·후진·따라잡기가 구조적으로 불가능하다 — 유닛은 제 속도표보다 빨리
 * 갈 방법이 없고, 왔던 길을 되짚는 것은 명령이 정말 그렇게 시켰을 때뿐이다. 지금 렌더가
 * 지고 있는 보정 여덟 가지(따라잡기·재동기화·스무딩 상한·홀드·걸음 상한·다리 잇기…)는
 * 전부 "t의 함수"라는 전제에서만 필요했던 것이라, 여기서는 존재하지 않는다.
 *
 * 입력은 이미 저장돼 있는 개체 트랙(v2)이다 — 재분석이 필요 없다(요청). 명령 스트림에서
 * 바로 읽는 것은 기획서 P5의 일이다.
 *
 * P1 범위: 이동·주문·수송 탑승·하드 앵커 보정. 전투(표적 획득·사격·피해·죽음)는 P2다.
 * 리액트를 안 쓴다 — 웹 워커와 노드 CLI가 그대로 번들해 돌린다. */

import { groundPath, groundPathSoft, type TerrainGrid } from "./minimapTerrain";
import {
  BUILDING_FOOT, BURROW_MIN_FRAMES, BURROW_UNITS, DEFAULT_FOOT, DEFAULT_TURN_RATE,
  FRAME_SEC, GEYSER_FOOT, LURKER_REHIT_FRAMES, MINE_ATTACH_FRAMES, MINE_DETACH_FRAMES,
  MINE_GAS_FRAMES, MINE_MINERAL_FRAMES, MINE_RETURN_FRAMES, MINERAL_FOOT, TURN_RATE,
  UNBURROW_MIN_FRAMES,
  buildingBox, isAir, moveDynOf, speedOfUnit, unitBoxTiles,
} from "./bwUnits";
/* 전투 값은 표(bwUnits)를 직접 읽지 않고 어댑터(bwCombat)를 거친다 — 표가 통째로 갈리는
   중이라 읽는 자리를 한 곳으로 모아 두면 이름이 어긋나도 고칠 파일이 하나다.
   ⚠ bwUnits에도 reachTiles가 있지만 그쪽은 업그레이드·벙커 보너스를 못 받는 짧은 판이다.
      이 파일이 쓰는 것은 bwCombat.reachTiles 하나뿐이고, 몸 반지름을 더하는 자리도
      거기 하나뿐이다 — 여기서 Body.rad를 또 더하면 이중 가산이 난다. */
import {
  MATRIX_HP, ORDER_PERIOD_SEC, RETARGET_SEC, STATUS_TICKS, acqPhaseOf, acquireReachTiles, attackOf,
  cooldownSec, ignoresDarkSwarm, timerSec, upgradeSeconds, STIM_SELF_DAMAGE, STIM_UNITS,
  STORM_PULSES, STORM_PULSE_SEC, STORM_TILES, stormPulse,
  bunkerShooterProfileOf, minReachTiles, profileOf, reachTiles, splashDivisorAt,
  targetFor, weaponVs,
  type CombatProfile, type DmgTarget, type ProfWeapon,
} from "./bwCombat";
import {
  FLYING_BUILDING_TPS, ORDER_POLL_SEC, PICKUP_POLL_SEC, UNLOAD_GAP_SEC,
  UNLOAD_ORDER_LOCK_SEC, UNLOAD_PENALTY_EXEMPT, unloadOrderLocked,
} from "./bwTransport";

/* ── 입력 모양(개체 트랙 v2) ─────────────────────────────────────────────────── */

/** 증거 한 점 — [초, x, y, 갈래, 덤]. x<0이면 자리 없는 증거(생산·랠리).
 *  갈래: 0 이동 · 1 남이 찍은 자리(하드 앵커) · 2 건설 자리 · 3 출생 · 4 자리 없음
 *  · 5 착륙 · 6 이륙 · 7 공격(덤=표적 태그) · 8/9 시즈 · 10 수리·힐 · 12 승선(덤=수송선
 *  태그) · 13 하차 · 14/15 클로킹 · 16 스팀 */
export type SimEv = [number, number, number, number, (number | undefined)?];

export type SimEnt = {
  t: number; o: number; k?: string; b: number; d?: number | null;
  bld?: boolean; ev: SimEv[]; ups?: string[];
};

export type SimInput = {
  players: { id: number; name: string; race?: string }[];
  ents: SimEnt[];
  /** 연구 기록 [초, 이름, 플레이어] — 개체 트랙(UnitTracksV2.ups)이 이미 싣고 오던 값이다.
   *  ★ 여태 이 칸이 없어서 SimEnt.ups가 실전에서 **늘 undefined**였다(세 갈래가 모두
   *    같은 구멍을 지적했다). 그 결과 공·방업·사거리 업글·속업이 시뮬에서 한 번도 산 적이
   *    없다 — 후반 교전이 업글 0인 판으로 그려지고 있었다. 렌더러는 UnitTracksV2를
   *    `as unknown as SimInput`으로 넘기므로, 이 칸을 **여기서 선언하기만 하면** 이미
   *    실려 오던 자료가 그대로 읽힌다. 어댑터를 고칠 것도 없었다. */
  ups?: [number, string, number][];
  /** 좌표가 남는 마법 [초, x, y, 기술, 플레이어] — 개체 트랙(UnitTracksV2.casts)이 이미
   *  싣고 오던 값이다.
   *  ★ ups가 그랬듯 이 칸도 여태 **선언이 없어** 코어가 마법을 아예 못 봤다(과제 #54).
   *    다크스웜 아래에서도 원거리 지상 공격이 다 맞았고, 인스네어에 젖어도 손이 안
   *    무뎠으며, 디펜시브 매트릭스는 한 번도 흡수한 적이 없다. 렌더러는 UnitTracksV2를
   *    `as unknown as SimInput`으로 넘기므로 여기서 선언하기만 하면 그대로 읽힌다. */
  casts?: [number, number, number, string, number][];
  /** 연구가 **끝나는** 시각 — 분석(replayUnits)이 전력 끊김까지 셈해 실어 준다.
   *  없으면 ups(누른 때)에 연구 시간을 더해 쓴다(옛 트랙 호환). */
  upsDone?: [number, string, number][];
};

/* ── 출력 ─────────────────────────────────────────────────────────────────────── */

/** 상태 — 렌더가 무엇을 그릴지 가르는 값. P2에서 fight/attack이 는다. */
export type SimState = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const ST_IDLE: SimState = 0;
export const ST_MOVE: SimState = 1;
export const ST_INSIDE: SimState = 2;   // 수송선 안 — 안 그린다
export const ST_GONE: SimState = 3;
export const ST_FIGHT: SimState = 4;    // 멈춰 서서 쏘는 중(P2)
export const ST_GATHER: SimState = 5;   // 채취 왕복 중(P3)
/** 땅속 — 자리가 아예 안 바뀐다. 렌더가 구멍을 그릴 근거도 이 값이다. */
export const ST_BURROW: SimState = 6;

/** 전투 사건 — [초, 갈래, 주체 태그, 표적 태그, x, y, tx, ty]. 갈래 0 발사 1 죽음.
 *
 *  ★ 32비트 실수 배열이다(과제 #70). 숫자 배열(number[])로 내보내면 워커→화면 전달과
 *  IndexedDB 저장이 값 하나하나에 꼬리표를 달아 옮긴다 — 같은 내용이 배는 무겁고 몇 배
 *  느리다. 담는 값은 시각(소수 둘)·태그(정수)·좌표(소수 하나)뿐이라 32비트로 남는
 *  오차가 1e-4 아래다. 읽는 쪽은 번호로만 훑으므로 바뀔 것이 없다. */
export type SimEventArr = Float32Array;
export const EV_FIRE = 0;
export const EV_DIE = 1;

export type SimTrack = {
  tag: number; owner: number; kind: string;
  born: number; died: number | null;
  /** 키프레임 평탄 배열 — 5개씩 [t, x, y, heading(도), state]. 사건 배열과 같은 이유로
   *  32비트 실수다(과제 #70) — 게임 하나에 키가 12만 개라 여기가 가장 무거운 짐이다. */
  keys: Float32Array;
};

export type SimStats = {
  ticks: number; ents: number; keys: number; ms: number;
  /** 하드 앵커에서 시뮬 위치가 어긋난 거리(타일) — 중앙값·90분위. */
  driftMedian: number; driftP90: number; anchors: number;
  /** 앵커에서 1.5타일 넘게 벌어진 비율(%). */
  driftBadRate: number;
  /** 전투(P2) — 시뮬이 죽인 수, 증거가 살려 낸 수(제약이 시뮬을 이긴 횟수), 발사 수. */
  kills: number; saved: number; shots: number;
};

export type SimResult = { tracks: SimTrack[]; events: SimEventArr; stats: SimStats };

export type SimOpts = {
  /** 맵 타일 크기 — 증거 좌표의 단위다. */
  width: number; height: number;
  /** 걷기 격자(검수된 것이 있으면 그것) — 없으면 지상도 곧게 간다. */
  terrain?: TerrainGrid | null;
  /** 키프레임 단순화 문턱(타일). 클수록 결과가 작아진다. */
  epsilon?: number;
  /** 자원 지대 — [타일x, 타일y, 가스인가]. 일꾼 채취 왕복의 재료다(P3). */
  resources?: [number, number, number][];
};

/* ── 상수 ─────────────────────────────────────────────────────────────────────── */

/** 한 틱 — 원작 23.81fps의 3프레임. 공격 쿨다운(8~30프레임)이 뭉개지지 않는 눈금. */
export const TICK_SEC = 3 / 23.81;
/** 도착 판정(타일). */
const ARRIVE = 0.35;
/** (걷음) 편별 밀어내기 반경 — 이제 크기별 몸 반지름(BODY_R)이 그 자리를 대신한다. */
/** 하드 앵커에서 이만큼 넘게 어긋나면 보정한다(타일). */
const ANCHOR_SNAP = 1.2;
/** 보정을 녹여 넣는 시간(초) — 순간이동으로 고치지 않는다.
 *  2.5초였다. 그런데 하드 앵커가 실제로 오는 간격을 두 픽스처에서 세어 보니
 *  중앙 3.0초·하위 사분위 **1.0초**다(tracks 앵커간격 n=120, lift n=138). 보정 시간이
 *  간격보다 길면 다음 증거가 올 때까지 어긋남의 절반도 못 갚는다 — 그래서 늘 한 앵커
 *  뒤처진 채로 다음 드리프트를 맞았다. 하위 사분위와 같은 1.0초로 내리면 대개의 증거
 *  간격 안에 보정이 끝난다.
 *  ★ 재측정(③-0d 앵커 마중이 들어온 뒤) — 2.5초로 되돌려 다시 재 보니
 *    tracks 1.65 → 1.86(초과 51.8% → 53.7%)로 나빠지고 lift는 48.5% → 46.9%로 좋아진다.
 *    즉 1.0이 두 경기 모두에서 이기는 값은 아니다. tracks의 중앙·초과가 함께 좋아지는
 *    쪽을 골라 1.0을 남긴다 — 이것은 유도된 값이 아니라 고른 값이다. [어림]
 *  ⚠ 이 값 언저리의 지형은 매끈하지 않다 — 0.6/0.7/1.05/1.15초가 3.32~3.37로 흩어진다.
 *     전투 결과가 갈리면 살아남는 개체가 달라져 앵커 표본 자체가 바뀌기 때문이다.
 *     그러니 1.0을 소수점까지 믿지 마라. 2.5보다 1.0 언저리가 낫다는 것까지가 실측이다. */
const ANCHOR_FIX_SEC = 1.0;

/** 길 다듬기가 볼 몸 폭(타일)과 한 번에 내다볼 꼭짓점 수(비용 상한).
 *  ⚠ [motion] 갈래가 함께 낸 걸림돌 우회(jam·dodge·재경로·지형 한 발 검사)는 **빼 놓았다.**
 *    실측으로 키프레임이 33k → 131k로 넷 배가 되고 드리프트 중앙이 3.4 → 5.0으로 무너졌다.
 *    원인은 그 설계가 목적지에 닿았는지를 '길의 끝'이 아니라 '제 목적지까지의 거리'로만
 *    판정하는 데 있다 — 목적지가 건물 발자국 안(어택 명령이 늘 그렇다)이면 영영 못 닿아
 *    유닛이 벽에 붙어 45도씩 비켜 돌기를 되풀이한다. 되살리려면 '못 닿는 목적지'를 끝내는
 *    규칙이 먼저 있어야 한다. 아래 길 다듬기와 다익스트라 폴백만 남긴다(둘은 중립이었다). */
const PATH_PAD = 0.45;
const SMOOTH_LOOK = 12;

/** 앵커가 이만큼 넘게 빗나가면 '목적지 모형도 틀렸다'로 보고 목적지를 버린다(타일).
 *  ★ 실측은 ③-0d 앵커 마중이 들어온 뒤 다시 잡은 값이다(앞 단계가 적어 둔 3.20 → 3.75는
 *  마중이 없던 판의 수치라 이제 맞지 않는다): 이 블록만 지우면
 *  tracks 중앙 1.65 → 1.95 · 초과 51.8% → 55.2%, lift는 48.5% → 48.4%로 거의 안 움직인다.
 *  마중과 짝을 이루기 때문이다 — 낡은 목적지를 버려야 ③-0d가 '갈 곳 없는 개체'로 보고
 *  다음 앵커를 마중 나간다. 문턱 1.5/2/2.5/3 중 2~3이 엇비슷했고 2.0은 그 안에서 고른
 *  값이지 유도된 값이 아니다. [어림] */
const STALE_DEST = 2;

/** 표적 유지 여유(타일) — 원전에 없는 장치다. 사거리 경계에 선 적 때문에 표적이 매 틱
 *  붙었다 떨어지면 몸이 떨리므로, 잡을 때보다 놓을 때를 이만큼 늦춘다. [어림] */
const KEEP_PAD = 1.5;

/** 버로우·언버로우가 끝나기까지 걸리는 시간(초) — [DAT] bwUnits의 프레임 값을 옮긴 것. */
const BURROW_IN_SEC = BURROW_MIN_FRAMES * FRAME_SEC;
const BURROW_OUT_SEC = UNBURROW_MIN_FRAMES * FRAME_SEC;
/** 러커 가시가 같은 표적을 다시 때리기까지(초) — 32프레임. */
const LURKER_REHIT_SEC = LURKER_REHIT_FRAMES * FRAME_SEC;

/* ── 주문 ─────────────────────────────────────────────────────────────────────── */

type OrdKind =
  | "move" | "attack" | "anchor" | "board" | "unload" | "liftoff" | "land" | "gone";
type Ord = { t: number; kind: OrdKind; x: number; y: number; tag: number };

/** 증거를 주문으로 옮긴다 — 자리 없는 증거(생산·랠리·클로킹)는 이동과 무관하니 뺀다. */
function ordersOf(e: SimEnt): Ord[] {
  const out: Ord[] = [];
  for (const v of e.ev) {
    const [s, x, y, f, extra] = v;
    if (f === 12) { out.push({ t: s, kind: "board", x, y, tag: extra ?? 0 }); continue; }
    /* 이륙(f=6)이 여태 통째로 버려지고 있었다.
       ⚠ [transport] 갈래는 "아래 x<0 거르기(111줄)에 걸린다"고 진단했는데 **그 진단은
         틀렸다.** 검증이 실제로 세어 보니 f=6 증거는 x≥0이라 그 줄에 안 걸린다.
         진짜 원인은 이 함수 끝의 if 사슬이다 — f===7과 f===0|10만 받아 담고 나머지는
         한마디 말도 없이 흘려보낸다. 그래서 뜬 건물이 영영 지상에 붙어 있었다.
       고칠 자리는 결국 여기가 맞으므로, 이륙을 제 갈래로 먼저 건져 올린다. 좌표가 없는
       판(x<0)도 있을 수 있어 x 거르기보다 위에 둔다. */
    if (f === 6) { out.push({ t: s, kind: "liftoff", x, y, tag: 0 }); continue; }
    if (x < 0) continue;
    if (f === 13) { out.push({ t: s, kind: "unload", x, y, tag: 0 }); continue; }
    /* 착륙(f=5)은 타일 좌상단이다 — 뜬 건물에게는 '거기 내려앉으라'는 목적지이고, 앉은
       뒤에는 그 자리가 곧 하드 앵커다. 걷는 유닛에게 f=5는 애초에 안 온다. */
    if (f === 5) { out.push({ t: s, kind: "land", x, y, tag: 0 }); continue; }
    // 남이 찍은 자리·건설 자리·출생은 '그때 정말 거기 있었다'는 하드 앵커다.
    if (f === 1 || f === 2 || f === 3) {
      out.push({ t: s, kind: "anchor", x, y, tag: 0 });
      continue;
    }
    /* 0 이동 · 7 공격 · 10 수리 — 전부 목적지다. 다만 어택(7)만 '가다가 만나면 싸운다'
       이고, 그냥 이동(0)은 원작에서도 멈춰 서지 않는다 — 이 구분이 P2의 핵심 규칙이다. */
    if (f === 7) out.push({ t: s, kind: "attack", x, y, tag: extra ?? 0 });
    else if (f === 0 || f === 10) out.push({ t: s, kind: "move", x, y, tag: extra ?? 0 });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/* ── 개체 ─────────────────────────────────────────────────────────────────────── */

type Body = {
  src: SimEnt;
  tag: number; owner: number; kind: string; air: boolean;
  speed: number; turn: number;
  born: number; died: number | null;
  x: number; y: number; hdg: number;
  /* ── 이동 물리 ── [DAT] flingy.dat 실덤프(bwUnits.MOVE_DYN). 표에 없는 정체는
     ctrl 2 · 가속 0으로 떨어져 예전과 똑같은 등속 걸음이 된다.
     ★ 원작 지상 주력에는 가속이 아예 없다 — movement_type 2(iscript 구동)면 엔진이
       가속·정지거리 필드를 읽지도 않는다. 그래서 accel>0인 것만 램프를 탄다: 공중 전부
       + SCV·드론·프로브 + 벌처 + 아콘·다크아콘 + 하이템플러(ctrl 1, 브레이크 없음). */
  /** 진행 방향(도) — 원작의 course. ctrl 0·1 유닛은 몸 방향과 따로 돈다. */
  crs: number;
  /** 지금 속력(타일/초). 가속이 붙는 유닛만 여기서 자라고 줄어든다. */
  vel: number;
  /** flingy.dat movement_type. 2면 몸이 향한 쪽으로만 간다(회전이 곧 제동이다). */
  ctrl: 0 | 1 | 2;
  /** 가속(타일/초²) · 정지거리(타일) · 진행 방향 회전 상한(도/초). 0이면 각각 즉발·무제동. */
  accel: number; halt: number; turnCourse: number;
  state: SimState;
  ords: Ord[]; oi: number;
  /** 지금 목적지와 남은 길(꼭짓점, 타일 좌표). */
  dest: [number, number] | null; path: [number, number][]; pi: number;
  /** 꼭짓점마다 목적지까지 남은 길 길이 — 감속을 매 틱 O(1)로 셈하는 자. */
  rem: Float64Array | null;
  /** 그 길을 짤 때의 판 번호 — 판이 바뀐 길에 걸리면 곧장 다시 짠다. */
  pathVer: number;
  /** 지난 틱에 목표까지 남았던 거리 · 나아가지 못한 틱 수 · 비켜 도는 틱과 방향. */
  lastGap: number; jam: number; dodge: number; dodgeSide: number;
  /** 길을 다시 짤 수 있는 가장 이른 시각(초). */
  repathAt: number;
  /** 수송선 태그(안에 있을 때). */
  inside: number | null;
  /** 하차 벌칙으로 행동이 잠긴 시각(초) — 리버의 main_order_timer가 여기 든다. */
  actUntil: number;
  /** 떠 있는가(테란 건물) — 뜬 동안은 공중이다: 지상 무기가 못 닿고 대공이 친다. */
  lifted: boolean;
  /** 착륙 목표(중심 타일). 자리가 막혀 있으면 못 앉고 계속 뜬 채로 남는다. */
  landTo: [number, number] | null;
  /** 떠 있던 구간 [뜬 초, 앉은 초] — 막힘 판이 그 사이에는 이 발자국을 비운다. */
  flyWins: [number, number][];
  /** 앵커 보정 — 남은 벡터와 남은 시간. */
  fixX: number; fixY: number; fixT: number;
  keys: number[];
  /** 마지막으로 찍은 키의 자리·방향·시각과 그때의 속도(직선 예측 단순화에 쓴다). */
  kx: number; ky: number; kh: number; ks: SimState; kt: number; kvx: number; kvy: number;
  /** 지난 틱의 자리 — 이번 틱 속도를 재는 자. */
  px: number; py: number;
  /* ── 전투(P2) ── */
  bld: boolean;
  /** 일꾼인가 — 이름으로 Set을 뒤지는 값을 뜨거운 자리에서 안 치르려고 미리 잡아 둔다. */
  wk: boolean;
  /** 몸 반지름(타일) — 밀어내기 평형에만 쓴다.
   *  ⚠ 사거리 판정에는 쓰지 마라. 중심 기준으로 옮기는 덧셈은 bwCombat.reachTiles가
   *    이미 제 안에서 한다 — 여기서 또 더하면 이중 가산이다(verdict-충돌 지적). */
  rad: number;
  /** 몸 상자 반폭·반높이(타일) — 건물 틈을 지날 수 있나가 이 둘로 갈린다(원작의
   *  상자 대 상자). 저글링 0.25/0.25 · 드라군 0.5/0.5 · 마린 0.27/0.31. */
  hw: number; hh: number;
  /** 지금 쓰는 전투 값 한 벌. 벙커에 타면 cpBunker로 갈아 끼운다(무기 +64px·획득 +2타일). */
  cp: CombatProfile;
  cpBase: CombatProfile; cpBunker: CombatProfile | null;
  /** 표적 상태(체력·실드는 fp8 raw). 표의 dealOneHit이 이 객체를 그 자리에서 깎는다 —
   *  그래서 개체마다 하나씩 들고 있어야 한다. 옛 UNIT_STATS.hp/.dps 스칼라는 걷어냈다:
   *  검증 안 된 어림표와 원전 무기표를 섞어 쓰면 어느 쪽이 진실인지 아무도 모른다. */
  dmg: DmgTarget;
  cd: number;                 // 남은 쿨다운(초)
  foe: Body | null;
  /* 지금 명령이 어택인가 — 원작에서 '그냥 이동'은 적을 만나도 안 멈춘다. 이 한 칸이
     "행군하다 아무 건물에나 붙어 서는" 문제를 막는다. */
  aggro: boolean;
  /** 표적을 다시 고를 시각 — 원전의 오더 처리 주기(9프레임)와 재표적 타이머(15프레임)가
   *  정하고, 개체마다 위상이 다르다(acqPhaseOf). */
  reacq: number;
  /* 어택무브 추격 — 획득 사거리 안에 든 적을 향해 걸어간다. 그 거리를 벗어나면 원래
     목적지(home)로 돌아간다: 이 되돌림이 없으면 부대가 적 한 기에 끌려 지도를 헤맨다. */
  chase: number;              // 쫓는 표적 태그(0이면 안 쫓음)
  chX: number; chY: number;   // 마지막으로 길을 다시 낸 표적 자리
  homeX: number; homeY: number; hasHome: boolean;
  /* ── 버로우 ── 땅속이면 위치가 바뀔 수 있는 코드 경로 자체가 원작에 없다
     (movement_UM_Init이 아무 일도 안 하는 UM_Lump로 떨어진다). 러커는 거기 더해
     unit_can_move가 거짓이라 이동 명령 자체를 거부한다. */
  burrowed: boolean;
  /** 언버로우가 끝날 때까지 남은 시간(초) — 그동안도 자리는 그대로다. */
  burrowLock: number;
  /** 버로우가 끝날 때까지 남은 시간(초). 음수면 들어가는 중이 아니다. */
  burrowIn: number;
  /** 러커 가시가 최근 때린 표적 — 태그마다 마지막 타격 시각(32프레임 재차단). */
  lurkHit: Map<number, number> | null;
  /** 죽을 시각이 정해졌는가 — 증거가 보장한 생존 하한까지 미뤄 둔 죽음. */
  dieAt: number | null;
  /** 증거가 보장하는 생존 하한 — 이 시각까지는 절대 안 죽는다(제약이 시뮬을 이긴다). */
  aliveUntil: number;
  /* ── 주변 효과(과제 #54) — 표가 이미 셈해 주는 값을 받아 둘 자리. ── */
  /** 스팀 종료 시각(초). 증거 f=16이 켠다. 쿨다운이 절반이 된다. */
  stimUntil: number;
  /** 인스네어 종료 시각(초) — 젖으면 쿨다운이 1.25배로 는다. */
  ensnaredUntil: number;
  /** 아드레날(저글링 공속업) — 태어날 때 한 번 정해진다. */
  adrenal: boolean;
  /** 스팀을 누른 시각들(증거 f=16, 오름차순)과 다음에 볼 자리. */
  stims: number[];
  stimI: number;
  /** 디펜시브 매트릭스 만료 시각(초) — 지나면 남은 흡수량을 지운다. */
  matrixUntil: number;
  /** 분석이 말한 죽음 — 시뮬이 그때까지 못 죽였으면 여기서 죽는다(상한). */
  dieBy: number | null;
  /* ── 채취(P3) ── 명령이 없는 일꾼은 제 밭과 홀 사이를 오간다. 리플레이에 안 남는
     자동 순환이라 시뮬이 모델해야 한다 — 렌더의 왕복 어림을 여기로 옮긴 것이다. */
  job: {
    /** 자원 식별 — 미네랄은 자원표 인덱스, 가스는 정제소 태그의 음수. 밭 임자 잠금의 열쇠다. */
    res: number;
    gas: boolean;
    /** 캐는 자리 — 자원 발자국 테두리 앞(가스는 정제소 문 앞). */
    px: number; py: number;
    /** 가스 정제소 한가운데 — 캐는 동안 몸이 들어가 있는(안 보이는) 자리. */
    cx: number; cy: number;
    /** 반납 자리 — 홀 발자국 테두리 앞. */
    hx: number; hy: number;
    /** 0 밭으로 · 1 붙는 중 · 2 캐는 중 · 3 떨어지는 중 · 4 홀로 · 5 반납 중. */
    phase: number;
    /** 남은 정지 시간(초) — 위 딜레이·채취 시간이 여기로 들어온다. */
    wait: number;
  } | null;
};

/** 일꾼 — 스스로 표적을 잡지 않고, 할 일이 없으면 캔다. */
const WORKERS = new Set(["SCV", "Probe", "Drone"]);
/** 자원을 받는 본진 건물. */
const HALLS = new Set(["Command Center", "Nexus", "Hatchery", "Lair", "Hive"]);
/** 가스 건물. */
const GAS_BLD = new Set(["Refinery", "Assimilator", "Extractor"]);

const norm360 = (d: number): number => ((d % 360) + 360) % 360;
/** a에서 b로 도는 최단 각(도, -180~180). */
const angDiff = (a: number, b: number): number => {
  let d = norm360(b - a);
  if (d > 180) d -= 360;
  return d;
};

export function simulate(data: SimInput, opts: SimOpts): SimResult {
  const t0 = Date.now();
  const eps = opts.epsilon ?? 0.3;
  const W = opts.width;
  const H = opts.height;
  const terrain = opts.terrain ?? null;
  /** 막힘 판의 눈금 — 한 타일을 몇 칸으로 쪼개나(아래 '막힘 판' 절 주석 참고).
   *  4칸이면 8px로, 원작 걸음 격자와 같다. 칸이 너무 많아지는 큰 맵만 2칸으로 떨어진다. */
  const FINE = W * H * 16 <= 700000 ? 4 : 2;


  /* ── 업그레이드 — 개체가 태어난 시각에 그 임자가 갖고 있던 것들 ──
     표(profileOf·moveDynOf·speedOfUnit·targetFor)는 개체를 세울 때 딱 한 번 본다(성능).
     그래서 업그레이드도 한 시점의 값으로 굳는다 — 무엇으로 굳힐지를 정해야 한다.
     · 경기 전체 목록으로 굳히면 1분짜리 초반 마린이 3-3업으로 싸운다.
     · 출생 시각으로 굳히면 오래 사는 개체가 나중 업글을 못 받는다.
     둘 중 **출생 시각**을 고른다. 실제 경기에서 한 개체의 수명은 대개 업글 한 단계보다
     짧고, 앞의 잘못(없던 업글을 소급해 주는 것)은 초반 교전을 통째로 뒤집지만 뒤의
     잘못(막 끝난 업글을 늦게 받는 것)은 그 개체 하나가 조금 약할 뿐이다. [어림] */
  /* ups의 시각은 '연구를 **누른** 때'다(과제 #71). 여태 그대로 써서 시뮬은 업그레이드를
     연구가 끝나기 한참 전부터 주고 있었다 — 공·방업 1렙이 4000프레임(168초)이니 거의
     3분 이르다. 끝나는 시각으로 옮긴다. 같은 이름이 두 번째로 나오면 그것이 2레벨이라
     시간도 그만큼 는다(표의 레벨당 480프레임). */
  /* 분석이 완성 시각을 함께 실어 오면 그것이 진실이다(upsDone) — 거기에는 프로토스
     전력 끊김으로 밀린 몫까지 들어 있다. 옛 트랙에는 그 칸이 없으므로, 없으면 여기서
     연구 시간만큼 밀어 쓴다. */
  const upsLog = (data.upsDone ?? data.ups ?? []).slice().sort((a, b) => a[0] - b[0]);
  const hasDone = !!data.upsDone;
  const upsByOwner = new Map<number, [number, string][]>();
  const upLv = new Map<string, number>();
  for (const [sec, name, pid] of upsLog) {
    const key = `${pid} ${name}`;
    const lv = (upLv.get(key) ?? 0) + 1;
    upLv.set(key, lv);
    const arr = upsByOwner.get(pid);
    const doneSec = hasDone ? sec : sec + upgradeSeconds(name, lv);
    if (arr) arr.push([doneSec, name]);
    else upsByOwner.set(pid, [[doneSec, name]]);
  }
  // 끝나는 시각 순으로 다시 세운다 — 아래 upsAt이 시간순을 전제로 끊어 읽는다.
  for (const arr of upsByOwner.values()) arr.sort((a, b) => a[0] - b[0]);
  /** 그 임자가 sec까지 끝낸 업그레이드 이름들 — 같은 이름이 두 번 나오면 2레벨이라는
   *  뜻이므로 **중복을 지우지 않는다**(bwCombat.upgradeLevel이 출현 횟수를 센다). */
  const upsAt = (owner: number, sec: number): string[] | undefined => {
    const arr = upsByOwner.get(owner);
    if (!arr) return undefined;
    const out: string[] = [];
    for (const [s2, name] of arr) {
      if (s2 > sec) break;
      out.push(name);
    }
    return out.length > 0 ? out : undefined;
  };

  /* 걸을 개체만 — 건물(bld)과 물리 줄(t=-1)은 이 층이 안 그린다. */
  const bodies: Body[] = [];
  const byTag = new Map<number, Body[]>();
  let endSec = 0;

  for (const e of data.ents) {
    if (e.t === -1 && !e.bld) continue;
    /* 건물도 개체다(P2) — 맞아서 무너지고, 방어 건물은 제 사거리 안을 친다. 자리는
       마지막 자리 증거(f=2|5), 없으면 안 세운다. */
    const isB = !!e.bld;
    if (isB) {
      /* 띄운 건물 — 이륙 증거(f=6)가 있는 건물은 붙박이가 아니다. 자리 증거 중 **첫**
         것에서 시작해 착륙 증거를 따라 옮겨 다닌다. 여태는 늘 마지막 자리를 썼기 때문에
         이사한 건물이 경기 내내, 뜨기도 전부터 도착지에 서 있었다. */
      const bSpots = e.ev.filter((v) => (v[3] === 2 || v[3] === 5) && v[1] >= 0);
      const bLifted = e.ev.some((v) => v[3] === 6);
      const spot = bLifted ? bSpots[0] : bSpots[bSpots.length - 1];
      if (!spot) continue;
      // 이·착륙을 하는 건물만 주문을 갖는다 — 앉은 건물은 종전대로 아무 주문도 안 먹는다.
      const bOrds = bLifted ? ordersOf(e) : [];
      const bUps = e.ups ?? upsAt(e.o, spot[0]);
      const bcp = profileOf(e.k ?? "", bUps);
      /* 건물 자리 증거는 타일 앵커(좌상단)다 — 중심으로 옮겨 담는다(수리: 막힘 판이
         반 발자국씩 어긋나 있었고, 건물 사거리·홀 거리도 그만큼 틀렸다). */
      const bf = BUILDING_FOOT[e.k ?? ""] ?? DEFAULT_FOOT;
      const bb: Body = {
        src: e, tag: e.t, owner: e.o, kind: e.k ?? "", air: false,
        speed: 0, turn: 0, born: spot[0], died: e.d ?? null,
        x: spot[1] + bf[0] / 2, y: spot[2] + bf[1] / 2, hdg: 180,
        crs: 180, vel: 0, ctrl: 2, accel: 0, halt: 0, turnCourse: 0, state: ST_IDLE,
        ords: bOrds, oi: 0, dest: null, path: [], pi: 0,
        rem: null, pathVer: -1, lastGap: Infinity, jam: 0, dodge: 0, dodgeSide: 1, repathAt: 0,
        inside: null, actUntil: 0, lifted: false, landTo: null, flyWins: [],
        fixX: 0, fixY: 0, fixT: 0, keys: [],
        kx: NaN, ky: NaN, kh: NaN, ks: ST_GONE, kt: 0, kvx: 0, kvy: 0, px: NaN, py: NaN,
        bld: true, wk: false,
        /* 건물의 체력·실드·방어력·크기는 이제 표(UNITS)에서 온다 — 옛 판이 하던
           "건물은 large·방어력 최소 1" 같은 손보정은 지어낸 값이었다. 표에 없는 이름
           (애드온 ComSat 등)만 DEFAULT_UNIT으로 떨어진다. [추정] */
        rad: bcp.radius, hw: 0, hh: 0,
        cp: bcp, cpBase: bcp, cpBunker: null,
        dmg: targetFor(e.k ?? "", bUps),
        cd: 0, foe: null, aggro: true, reacq: spot[0] + acqPhaseOf(e.t),
        dieAt: null, job: null,
        chase: 0, chX: 0, chY: 0, homeX: 0, homeY: 0, hasHome: false,
        burrowed: false, burrowLock: 0, burrowIn: -1, lurkHit: null,
        aliveUntil: e.ev.length > 0 ? e.ev[e.ev.length - 1][0] : spot[0],
        stimUntil: -1, ensnaredUntil: -1, adrenal: false, stims: [], stimI: 0, matrixUntil: -1,
        dieBy: e.d ?? null,
      };
      bodies.push(bb);
      const arrB = byTag.get(bb.tag) ?? [];
      arrB.push(bb);
      byTag.set(bb.tag, arrB);
      endSec = Math.max(endSec, bb.died ?? bb.born);
      continue;
    }
    const ords = ordersOf(e);
    const kind = e.k ?? "";
    const first = ords.find((o) => o.kind !== "board");
    /* 표는 개체를 세울 때 딱 한 번 본다(성능) — 수백 개체 × 수천 틱을 도는 자리라 매 틱
       이름으로 표를 뒤지면 그 조회 하나가 시뮬 전체를 좌우한다. */
    /* 개체가 든 것이 있으면 그것이 먼저다(직접 실어 주는 입력을 막지 않는다). */
    const ups = e.ups ?? upsAt(e.o, e.b);
    const cp = profileOf(kind, ups);
    /* 이동 물리는 원전 표가 있으면 그것, 없으면 옛 회전표로 떨어진다. 지어낸 값을
       돌려받지 않으려고 moveDynOf는 모르는 정체에 null을 준다. */
    const md = moveDynOf(kind, ups);
    const turnFallback = TURN_RATE[kind] ?? DEFAULT_TURN_RATE;
    const b: Body = {
      src: e,
      tag: e.t, owner: e.o, kind, air: isAir(kind),
      speed: speedOfUnit(kind, ups), turn: md ? md.turnBody : turnFallback,
      born: e.b, died: e.d ?? null,
      x: first ? first.x : W / 2, y: first ? first.y : H / 2, hdg: 180,
      crs: 180, vel: 0,
      ctrl: md ? md.ctrl : 2,
      accel: md ? md.accel : 0,
      halt: md ? md.halt : 0,
      turnCourse: md ? md.turnCourse : turnFallback,
      state: ST_IDLE,
      ords, oi: 0,
      dest: null, path: [], pi: 0,
      rem: null, pathVer: -1, lastGap: Infinity, jam: 0,
      dodge: 0, dodgeSide: (e.t & 1) === 0 ? 1 : -1, repathAt: 0,
      inside: null, actUntil: 0, lifted: false, landTo: null, flyWins: [],
      fixX: 0, fixY: 0, fixT: 0,
      keys: [],
      kx: NaN, ky: NaN, kh: NaN, ks: ST_GONE, kt: 0, kvx: 0, kvy: 0,
      px: NaN, py: NaN,
      bld: false, wk: WORKERS.has(kind),
      rad: cp.radius, hw: unitBoxTiles(kind)[0] / 2, hh: unitBoxTiles(kind)[1] / 2,
      cp, cpBase: cp, cpBunker: bunkerShooterProfileOf(kind),
      dmg: targetFor(kind, ups),
      cd: 0, foe: null, aggro: false, reacq: e.b + acqPhaseOf(e.t), dieAt: null, job: null,
      chase: 0, chX: 0, chY: 0, homeX: 0, homeY: 0, hasHome: false,
      burrowed: false, burrowLock: 0, burrowIn: -1, lurkHit: null,
      /* 증거가 보장하는 생존 하한 — 명령을 받은 태그는 그 순간 확실히 살아 있다.
         시뮬이 그 전에 죽이려 들면 시뮬이 틀린 것이므로 체력 1로 버틴다. */
      aliveUntil: e.ev.length > 0 ? e.ev[e.ev.length - 1][0] : e.b,
      /* 아드레날은 저글링에게만 있고 한 번 끝나면 안 풀린다 — 태어날 때 굳힌다.
         스팀·인스네어는 시간이 흐르며 켜지고 꺼지므로 아래 루프가 채운다. */
      stimUntil: -1,
      ensnaredUntil: -1,
      adrenal: kind === "Zergling" && (ups ?? []).includes("Adrenal Glands"),
      /* 스팀 증거는 명령 순간 함께 골라져 있던 **모두**에게 남는다 — 실제로 스팀을 쓰는
         둘(마린·파이어뱃)만 받는다. 안 가리면 SCV가 두 배로 빨리 때린다(실측: 한 경기
         에 SCV 54기가 스팀 증거를 갖고 있었다). */
      stims: STIM_UNITS.has(kind)
        ? e.ev.filter((v) => v[3] === 16).map((v) => v[0]).sort((p1, p2) => p1 - p2) : [],
      stimI: 0,
      matrixUntil: -1,
      dieBy: e.d ?? null,
    };
    bodies.push(b);
    const arr = byTag.get(b.tag) ?? [];
    arr.push(b);
    byTag.set(b.tag, arr);
    const last = ords.length > 0 ? ords[ords.length - 1].t : e.b;
    endSec = Math.max(endSec, b.died ?? last);
  }

  /* ── 수송·이착륙 타이밍 ─────────────────────────────────────────────────────
     분석이 아는 것은 '명령이 떨어진 초'뿐이다. 원작이 그 명령을 실제로 언제 처리하는지는
     execute_main_order의 게이트가 정한다:
         if (order_process_timer) { --order_process_timer; return; }
         order_process_timer = 8;          // bwgame.h:7758-7762
     게이트 **뒤**에 있는 오더(탑승 7950 · 하차 7972 · 이륙 7908)는 9프레임마다만 돌고,
     착륙(BuildingLand 7686)만 게이트 **앞**이라 매 프레임 돈다. 그래서 여기서 증거 시각을
     한 번에 그 격자로 옮긴다.
      ① 탑승 — 태우는 동작 자체는 0프레임(경계상자가 1픽셀 닿으면 그 프레임에 실린다).
         PickupTransport가 거는 main_order_timer=7은 9보다 작아 다음 폴링 때 이미 0이라,
         **격자를 만들지 못한다** — 실효 간격은 게이트 주기 그대로 9프레임이다.
      ② 하차 — unit_unload는 수송선에 main_order_timer=15를 걸지만 order_process_timer를
         0으로 놓지 않는다(위상 재설정이 없다). F에 한 기를 내리면 F+9는 타이머 6이라
         그냥 지나가고 F+18에 발동한다 — 보이는 간격은 **18프레임(0.756초)**이지 15가
         아니다. 대조군이 곁에 있다: order_hidden_BunkerGuard(12564)는 15와 **함께**
         order_process_timer=0을 놓아 위상을 다시 잡는다. 원작은 정말 15를 원할 때
         이렇게 명시한다.
      ③ 이륙 — 9프레임 격자. 착륙은 게이트 앞이라 안 미룬다. */
  {
    const drops: { o: Ord; tag: number; ship: number }[] = [];
    for (const b of bodies) {
      let ship = 0;
      for (const o of b.ords) {
        if (o.kind === "board") {
          ship = o.tag;
          o.t = Math.ceil(o.t / PICKUP_POLL_SEC) * PICKUP_POLL_SEC;
        } else if (o.kind === "unload") {
          // 어느 배에서 내렸는지는 바로 앞의 승선이 안다 — 벙커 면제도 이 태그로 가른다.
          o.tag = ship;
          if (ship !== 0) drops.push({ o, tag: b.tag, ship });
        } else if (o.kind === "liftoff") {
          o.t = Math.ceil(o.t / ORDER_POLL_SEC) * ORDER_POLL_SEC;
        }
      }
      for (const o of b.ords) {
        if (o.kind === "liftoff") b.flyWins.push([o.t, Infinity]);
        else if (o.kind === "land" && b.flyWins.length > 0) {
          b.flyWins[b.flyWins.length - 1][1] = o.t;
        }
      }
    }
    /* 증거에는 하차 간격이 없어 여덟이 같은 초에 쏟아졌다 — 수송선마다 줄을 세워
       18프레임씩 벌린다. 줄 순서는 시각→수송선→태그라 같은 입력이면 늘 같은 그림이다. */
    drops.sort((p, q) => (p.o.t - q.o.t) || (p.ship - q.ship) || (p.tag - q.tag));
    const shipFree = new Map<number, number>();
    for (const d of drops) {
      const at = Math.max(d.o.t, shipFree.get(d.ship) ?? 0);
      d.o.t = at;
      shipFree.set(d.ship, at + UNLOAD_GAP_SEC);
    }
    // 밀린 하차·이륙만큼 시뮬도 길어져야 한다 — 마지막 주문이 잘리면 못 내린 채 끝난다.
    for (const b of bodies) {
      const lo = b.ords.length > 0 ? b.ords[b.ords.length - 1] : null;
      if (lo) endSec = Math.max(endSec, lo.t);
    }
  }

  /* ── 막힘 판(요청: 건물·자원·유닛 모두 통과 불가 + 건물 틈으로는 지나다니게) ──────
     지형 격자에 건물과 자원 지대를 덧칠한 판을 만들어 길찾기와 걸음을 함께 태운다.
     건물은 서고 무너지므로 그때마다 판을 다시 굽고(15초에 한 번으로 묶는다) 길 갈무리도
     열쇠의 판 번호로 저절로 갈린다.

     ★ 눈금이 타일보다 잘다(요청: 건물 틈) — 원작 건물이 막는 것은 발자국(타일 배수)이
       아니라 **몸 상자**이고, 둘의 차이가 곧 틈이다(가로 배럭-배럭 24px·서플-서플 20px,
       세로 서플-배럭 14px·배럭-서플 26px). 한 칸이 한 타일이면 그 반 타일짜리 틈이
       판에 아예 안 담긴다. 그래서 한 타일을 4칸(8px — 원작 걸음 격자와 같은 눈금)으로
       쪼갠다. 칸이 너무 많아지는 큰 맵만 2칸(16px)으로 떨어진다.
     ★ 몸 크기도 판이 안다 — 장애물을 제 반폭만큼 부풀린 판을 크기별로 따로 굽고 유닛은
       제 판에서 길을 찾는다(가운데 칸이 트였나 = 몸이 들어가나). 저글링(16px)은 1칸,
       드라군·탱크·리버·아콘·울트라(32px 이상)는 2칸이다 — 그래서 같은 틈이 저글링에게는
       열리고 드라군에게는 닫힌다. 근거와 표: docs/note-building-gaps.md. */
  const BW = terrain ? terrain.w : W;
  const BH = terrain ? terrain.h : H;
  const GW = Math.max(4, Math.round(W * FINE));
  const GH = Math.max(4, Math.round(H * FINE));
  const staticBlock = new Uint8Array(GW * GH);      // 자원 — 경기 내내 그대로
  /** 타일 사각형을 칸에 칠한다 — 조금이라도 걸치는 칸은 다 막는 쪽으로(장애물 안전). */
  const markRect = (
    arr: Uint8Array, tx: number, ty: number, tw: number, th: number, v: number,
  ): void => {
    const x0 = Math.max(0, Math.floor(tx * FINE));
    const y0 = Math.max(0, Math.floor(ty * FINE));
    const x1 = Math.min(GW - 1, Math.ceil((tx + tw) * FINE) - 1);
    const y1 = Math.min(GH - 1, Math.ceil((ty + th) * FINE) - 1);
    for (let yy = y0; yy <= y1; yy += 1) for (let xx = x0; xx <= x1; xx += 1) arr[yy * GW + xx] = v;
  };
  for (const [rx, ry, gas] of opts.resources ?? []) {
    const f = gas === 1 ? GEYSER_FOOT : MINERAL_FOOT;
    markRect(staticBlock, rx - f[0] / 2, ry - f[1] / 2, f[0], f[1], 1);
  }
  /** 지형 + 자원만 담은 바닥 판(건물 없음) — 크기별 잔 판이 이것을 베껴 쓴다. */
  let baseWalk: Uint8Array | null = null;
  /** 굵은 판(타일 눈금) — A*가 큰 줄기를 찾는 자리. */
  let liveGrid: TerrainGrid | null = null;
  /** 지금 서 있는 건물들의 몸 상자(타일) [x0, y0, x1, y1]. */
  let bldRects: [number, number, number, number][] = [];
  let gridVer = 0;
  const rebuildGrid = (t: number): void => {
    gridVer += 1;
    const walk = new Uint8Array(GW * GH);
    for (let gy = 0; gy < GH; gy += 1) {
      const ty = terrain ? Math.min(BH - 1, Math.floor(((gy / FINE) / H) * BH)) : 0;
      for (let gx = 0; gx < GW; gx += 1) {
        const i = gy * GW + gx;
        if (staticBlock[i]) continue;                      // 0 그대로 = 막힘
        if (!terrain) { walk[i] = 1; continue; }
        const tx = Math.min(BW - 1, Math.floor(((gx / FINE) / W) * BW));
        walk[i] = terrain.walk[ty * BW + tx] ? 1 : 0;
      }
    }
    baseWalk = walk;
    bldRects = [];
    /* 굵은 판(A* 전용) — 길찾기까지 잔 눈금으로 돌리면 칸이 16배라 시뮬이 10배 느려진다
       (실측: 4.7초 → 45.7초). 길의 큰 줄기는 타일 눈금으로 찾고, 건물 틈처럼 잔 것은
       아래 잔 판이 맡는다: findPath는 곧은 줄(clearLine)을 **먼저** 보므로, 벽 너머를
       향한 유닛이 틈을 지나는 길목은 잔 판이 그대로 판정한다. */
    const coarse = new Uint8Array(BW * BH);
    for (let i = 0; i < coarse.length; i += 1) {
      const cx9 = i % BW;
      const cy9 = (i - cx9) / BW;
      const wx9 = ((cx9 + 0.5) / BW) * W;
      const wy9 = ((cy9 + 0.5) / BH) * H;
      coarse[i] = terrain
        ? (terrain.walk[i] && !staticBlock[Math.min(GH - 1, Math.floor(wy9 * FINE)) * GW
          + Math.min(GW - 1, Math.floor(wx9 * FINE))] ? 1 : 0)
        : 1;
    }
    for (const b of bodies) {
      if (!b.bld || t < b.born || (b.died !== null && t >= b.died)) continue;
      // 뜬 동안은 자리를 안 막는다 — 이륙하면 원작도 그 자리를 통째로 풀어 준다.
      if (b.flyWins.some(([fa, fb]) => t >= fa && t < fb)) continue;
      const [bw2, bh2, ox2, oy2] = buildingBox(b.kind);
      const rx0 = b.x + ox2 - bw2 / 2;
      const ry0 = b.y + oy2 - bh2 / 2;
      bldRects.push([rx0, ry0, rx0 + bw2, ry0 + bh2]);
      // 굵은 판에는 몸 상자가 걸친 타일을 통째로 막는다(길의 큰 줄기는 보수적으로).
      const cx0 = Math.max(0, Math.floor((rx0 / W) * BW));
      const cy0 = Math.max(0, Math.floor((ry0 / H) * BH));
      const cx1 = Math.min(BW - 1, Math.ceil(((rx0 + bw2) / W) * BW) - 1);
      const cy1 = Math.min(BH - 1, Math.ceil(((ry0 + bh2) / H) * BH) - 1);
      for (let yy = cy0; yy <= cy1; yy += 1) for (let xx = cx0; xx <= cx1; xx += 1) coarse[yy * BW + xx] = 0;
    }
    liveGrid = { w: BW, h: BH, walk: coarse } as TerrainGrid;
    indexRects();
    /* 길 갈무리는 비우지 않는다 — 열쇠에 판 번호(gridVer)가 들어 있어 옛 것은 저절로
       안 쓰인다. 비우면 건물이 설 때마다 부대 전체의 길을 다시 셈해 몇 배로 느려진다
       (실측: 게임 1이 6.1초 → 11.6초). 무한히 자라지 않게 상한만 둔다. */
    if (pathCache.size > 40000) pathCache.clear();
  };
  /** 건물 몸 상자를 그 상자가 걸친 타일마다 색인 — 자리 하나가 어느 건물에 걸리나는
   *  제 타일 바구니만 보면 된다(건물 수백 개를 매번 훑지 않는다). 유닛 몸이 최대 반
   *  타일쯤 되므로 한 타일 여유를 두고 담는다. */
  const bldBuckets = new Map<number, [number, number, number, number][]>();
  const bucketKey = (tx: number, ty: number): number => ty * (W + 2) + tx;
  const indexRects = (): void => {
    bldBuckets.clear();
    for (const r of bldRects) {
      const tx0 = Math.max(0, Math.floor(r[0]) - 1);
      const ty0 = Math.max(0, Math.floor(r[1]) - 1);
      const tx1 = Math.min(W, Math.floor(r[2]) + 1);
      const ty1 = Math.min(H, Math.floor(r[3]) + 1);
      for (let ty = ty0; ty <= ty1; ty += 1) {
        for (let tx = tx0; tx <= tx1; tx += 1) {
          const k = bucketKey(tx, ty);
          const arr = bldBuckets.get(k);
          if (arr) arr.push(r);
          else bldBuckets.set(k, [r]);
        }
      }
    }
  };
  /** 잔 눈금 판(몸 크기별) — 칸 **한가운데**에 그 몸을 놓았을 때 건물에 걸리면 막힌 칸이다.
   *  굵은 판(타일)에서 길이 아예 안 나올 때만 굽는다: 건물로 막은 벽에서 '틈이 있나'를
   *  가리는 자리가 거기뿐이라, 평소 길찾기는 값을 하나도 더 치르지 않는다. */
  const fineByBox = new Map<string, TerrainGrid>();
  const fineFor = (hw: number, hh: number): TerrainGrid => {
    const key = `${gridVer}|${Math.round(hw * 32)},${Math.round(hh * 32)}`;
    const hit = fineByBox.get(key);
    if (hit) return hit;
    const walk = baseWalk ? Uint8Array.from(baseWalk) : new Uint8Array(GW * GH).fill(1);
    for (const r of bldRects) {
      const x0 = Math.max(0, Math.ceil((r[0] - hw) * FINE - 0.5));
      const y0 = Math.max(0, Math.ceil((r[1] - hh) * FINE - 0.5));
      const x1 = Math.min(GW - 1, Math.floor((r[2] + hw) * FINE - 0.5));
      const y1 = Math.min(GH - 1, Math.floor((r[3] + hh) * FINE - 0.5));
      for (let yy = y0; yy <= y1; yy += 1) for (let xx = x0; xx <= x1; xx += 1) walk[yy * GW + xx] = 0;
    }
    const g = { w: GW, h: GH, walk } as TerrainGrid;
    if (fineByBox.size > 24) fineByBox.clear();
    fineByBox.set(key, g);
    return g;
  };
  /** 그 몸(반폭 hw·반높이 hh)이 이 자리에서 건물과 겹치나 — 원작의 상자 대 상자다
   *  (OpenBW is_blocked → unit_inner_bounding_box). 칸 눈금이 아니라 픽셀 셈이라
   *  16px 틈과 24px 틈이 실제로 갈린다. */
  const bldHit = (x: number, y: number, hw: number, hh: number): boolean => {
    const arr = bldBuckets.get(bucketKey(Math.floor(x), Math.floor(y)));
    if (!arr) return false;
    for (let i = 0; i < arr.length; i += 1) {
      const r = arr[i];
      if (x + hw > r[0] && x - hw < r[2] && y + hh > r[1] && y - hh < r[3]) return true;
    }
    return false;
  };
  /* 발자국 테두리의 가장 가까운 점(요청: 미네랄 안쪽이 아니라 바깥에서 캐고, 반납도
     기지의 가장 가까운 외곽점에) — 가운데를 목표로 두면 몸이 자원·건물 속으로 들어간다.
     상대 쪽 방향으로 테두리까지 나간 뒤 pad만큼 더 밀어 몸이 밖에 서게 한다. */
  /** 축 정렬 두 사각형 사이 **최단 선분**의 양 끝점(요청: "건물 테두리와 미네랄
   *  테두리에서 최단거리만 골라서 왔다갔다") — 위 edgePoint는 중심끼리 이은 직선이
   *  닿는 테두리 점이라, 홀처럼 옆으로 긴 4×3에서는 실제로 가장 가까운 자리보다 한참
   *  옆에 섰다(그래서 일꾼이 건물 한복판까지 파고드는 것처럼 보였다).
   *  축마다 따로 본다 — 두 구간이 겹치는 축은 수직으로 마주 보고(겹침 한가운데),
   *  안 겹치는 축은 마주 보는 변끼리다. 이것이 두 사각형의 최단 선분이다.
   *  pad는 몸이 발자국 밖에 서도록 안쪽으로 물리는 몫(일꾼 반지름). */
  const nearPair = (
    ax: number, ay: number, ahw: number, ahh: number,
    bx: number, by: number, bhw: number, bhh: number, pad: number,
  ): [number, number, number, number] => {
    const axis = (ac: number, ah: number, bc: number, bh: number): [number, number] => {
      const a1 = ac - ah;
      const a2 = ac + ah;
      const b1 = bc - bh;
      const b2 = bc + bh;
      if (a2 < b1) return [a2, b1];
      if (b2 < a1) return [a1, b2];
      const m = (Math.max(a1, b1) + Math.min(a2, b2)) / 2;
      return [m, m];
    };
    const [px, py] = axis(ax, ahw, bx, bhw);
    const [ay2, by2] = axis(ay, ahh, by, bhh);
    const dx = py - px;
    const dy = by2 - ay2;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-4) return [px, ay2, py, by2];
    // 두 발자국이 붙어 있으면 물리는 몫이 서로를 지나치지 않게 반씩만.
    const pd = Math.min(pad, len / 2);
    return [px + (dx / len) * pd, ay2 + (dy / len) * pd,
      py - (dx / len) * pd, by2 - (dy / len) * pd];
  };

  /** 지도가 말하는 진짜 벽인가 — 건물·자원은 안 본다(지형 격자를 그대로 읽는다). */
  const wallAt = (x: number, y: number): boolean => {
    if (!terrain) return false;
    const gx = Math.floor((x / W) * BW);
    const gy = Math.floor((y / H) * BH);
    if (gx < 0 || gy < 0 || gx >= BW || gy >= BH) return true;
    return terrain.walk[gy * BW + gx] === 0;
  };
  /** 이 몸(cls)이 그 자리에 못 서나 — 걸음 한 발마다 본다. */
  const blockedAt = (x: number, y: number, hw = 0, hh = 0): boolean => {
    const gx = Math.floor(x * FINE);
    const gy = Math.floor(y * FINE);
    if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) return true;
    if (baseWalk && baseWalk[gy * GW + gx] === 0) return true;   // 지형·자원
    return bldHit(x, y, hw, hh);                                  // 건물은 제 상자로
  };
  /** 지형·자원으로 막힌 칸인가 — 건물은 빼고 본다(건물은 따로 몸으로 잰다).
   *  15초에 한 번 굽는 판과 달리 이 값은 경기 내내 그대로라, 착륙 판정이 판 굽는
   *  주기에 흔들리지 않는다. */
  const terrainBlocked = (x: number, y: number): boolean => {
    const gx = Math.floor(x * FINE);
    const gy = Math.floor(y * FINE);
    if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) return true;
    if (staticBlock[gy * GW + gx]) return true;
    return wallAt(x, y);
  };
  /** 여기 내려앉을 수 있나 — 원작은 착륙하는 동안 건물을 공중으로 치기 때문에, 발자국
   *  타일이 하나라도 점유돼 있으면 착륙이 그냥 실패하고 뜬 채로 남는다.
   *  ⚠ 크립 위 착륙 금지는 아직 못 본다 — 이 층에 크립 판이 없다. */
  const landBlocked = (self: Body, cx: number, cy: number, at: number): boolean => {
    const f = BUILDING_FOOT[self.kind] ?? DEFAULT_FOOT;
    for (let ty = 0; ty < f[1]; ty += 1) {
      for (let tx = 0; tx < f[0]; tx += 1) {
        if (terrainBlocked(cx - f[0] / 2 + tx + 0.5, cy - f[1] / 2 + ty + 0.5)) return true;
      }
    }
    for (const o of bodies) {
      if (o === self || !o.bld || o.lifted) continue;
      if (at < o.born || (o.died !== null && at >= o.died)) continue;
      /* 제 쌍둥이는 빼고 본다 — 같은 건물이 물리 줄(태그 없는 건설 기록)과 태그 줄로 두
         벌 서 있어서, 그대로 재면 제 착륙 자리를 제가 막아 영영 못 앉는다. */
      if (o.kind === self.kind && o.owner === self.owner
        && Math.abs(o.x - cx) < 1 && Math.abs(o.y - cy) < 1) continue;
      const g = BUILDING_FOOT[o.kind] ?? DEFAULT_FOOT;
      if (Math.abs(o.x - cx) < (f[0] + g[0]) / 2 && Math.abs(o.y - cy) < (f[1] + g[1]) / 2) {
        return true;
      }
    }
    return false;
  };

  /* 길찾기 캐시 — 같은 두 점을 여러 유닛이 함께 쓴다(부대 이동). */
  const pathCache = new Map<string, [number, number][]>();
  /** 곧은 줄이 트여 있나 — 0.5타일마다 훑는다. 트였으면 길찾기를 아예 안 부른다. */
  const clearLine = (
    x0: number, y0: number, x1: number, y1: number, hw: number, hh: number,
  ): boolean => {
    const d = dist(x0, y0, x1, y1);
    /* 걸음이 잔 눈금이면 훑기도 잘아야 한다 — 한 칸(8px)씩 본다. 반 타일씩 건너뛰면
       건물 사이 틈은 물론 벽 모서리도 통째로 지나쳐 읽는다. */
    const n = Math.ceil(d * FINE);
    for (let i = 1; i <= n; i += 1) {
      if (blockedAt(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, hw, hh)) return false;
    }
    return true;
  };
  /** 몸 폭을 감안한 시야 — 가운데 줄과 좌우 rad만큼의 옆줄까지 트여야 트인 것으로 본다.
   *  원작은 장애물을 제 몸 크기만큼 부풀려 검사한다. 그 값싼 대역이 이 옆줄 둘이다. */
  const clearWide = (
    x0: number, y0: number, x1: number, y1: number, rad: number, hw: number, hh: number,
  ): boolean => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-6) return !blockedAt(x0, y0, hw, hh);
    const px = (-dy / d) * rad;
    const py = (dx / d) * rad;
    const n = Math.ceil(d * FINE);
    for (let i = 0; i <= n; i += 1) {
      const x = x0 + (dx * i) / n;
      const y = y0 + (dy * i) / n;
      if (blockedAt(x, y, hw, hh) || blockedAt(x + px, y + py, hw, hh)
        || blockedAt(x - px, y - py, hw, hh)) return false;
    }
    return true;
  };
  /** 격자 BFS가 낸 계단꼴을 줄인다 — 보이는 가장 먼 꼭짓점으로 곧장 잇는다(원작 short
   *  path가 '벽 모서리'로만 꺾는 것의 값싼 대역이다). 내다보는 폭을 SMOOTH_LOOK으로
   *  묶어 비용을 길이에 비례하게 눌렀고, 길 하나당 한 번만 치러 갈무리에 함께 담긴다. */
  const smoothPath = (
    x0: number, y0: number, pts: [number, number][], hw: number, hh: number,
  ): [number, number][] => {
    if (pts.length <= 2) return pts;
    const out: [number, number][] = [];
    let cx = x0;
    let cy = y0;
    let i = 0;
    while (i < pts.length) {
      let j = i;
      const cap = Math.min(pts.length - 1, i + SMOOTH_LOOK);
      while (j < cap && clearWide(cx, cy, pts[j + 1][0], pts[j + 1][1], PATH_PAD, hw, hh)) j += 1;
      out.push(pts[j]);
      cx = pts[j][0];
      cy = pts[j][1];
      i = j + 1;
    }
    return out;
  };
  const findPath = (
    x0: number, y0: number, x1: number, y1: number, hw: number, hh: number,
  ): [number, number][] => {
    /* 대부분의 이동은 빈 땅을 가로지른다 — 그때는 길찾기(격자 BFS)가 통째로 낭비다.
       곧은 줄이 트여 있으면 그대로 간다(실측: 게임 1이 11.0초 → 아래 값).
       ★ 건물 사이 틈으로 지나가는 것도 대개 이 갈래다: 판이 제 몸 크기로 부풀려져
         있으므로 가운데 줄만 트였으면 그 몸이 실제로 들어간다는 뜻이다. */
    if (clearLine(x0, y0, x1, y1, hw, hh)) return [[x1, y1]];
    const grid = liveGrid;
    if (!grid) return [[x1, y1]];
    // 갈무리 열쇠에 몸 크기가 들어간다 — 저글링의 길을 드라군이 물려받으면 안 된다.
    const key = `${gridVer}.${Math.round(hw * 8)},${Math.round(hh * 8)}:`
      + `${Math.round(x0)},${Math.round(y0)},${Math.round(x1)},${Math.round(y1)}`;
    const hit = pathCache.get(key);
    if (hit) return hit;
    let got = groundPath(grid, x0 / W, y0 / H, x1 / W, y1 / H);
    /* 굵은 판이 "길이 없다"고 하면 그때만 잔 판을 본다(요청: 건물 틈으로 지나다니게) —
       타일 눈금에는 반 타일짜리 틈이 안 담겨, 건물로 막은 벽은 늘 '길 없음'으로 나온다.
       잔 판은 8px 눈금에 제 몸 크기까지 재므로, 저글링은 넓은 틈으로 지나가고 드라군은
       같은 틈에서 막힌다. 여기까지 와서도 길이 없으면 아래 소프트 폴백이 답을 낸다. */
    if (!got) got = groundPath(fineFor(hw, hh), x0 / W, y0 / H, x1 / W, y1 / H);
    /* BFS가 길을 못 찾으면 예전엔 직선이었다 — 그 직선이 곧 "지상 유닛이 벽을 뚫고
       지나간다"의 정체였다(과제 #50). 벽을 비싸게 치는 다익스트라는 반드시 답을 내고,
       정말 막힌 자리만 최단으로 가로지른다. */
    const raw = got ?? groundPathSoft(grid, x0 / W, y0 / H, x1 / W, y1 / H);
    const pts = smoothPath(x0, y0,
      raw.map(([fx, fy]) => [fx * W, fy * H] as [number, number]), hw, hh);
    if (pathCache.size > 20000) pathCache.clear();
    pathCache.set(key, pts);
    return pts;
  };

  const setDest = (b: Body, x: number, y: number): void => {
    b.dest = [x, y];
    b.path = b.air ? [[x, y]] : findPath(b.x, b.y, x, y, b.hw, b.hh);
    b.pi = 0;
    /* 꼭짓점마다 목적지까지 남은 거리 — 감속(정지거리)은 '얼마나 남았나'를 알아야 하는데
       매 틱 길 전체를 더하면 개체 수만큼 비싸다. 길을 짤 때 한 번만 셈해 둔다. */
    const n = b.path.length;
    const r = new Float64Array(n);
    for (let i = n - 2; i >= 0; i -= 1) {
      r[i] = r[i + 1] + dist(b.path[i][0], b.path[i][1], b.path[i + 1][0], b.path[i + 1][1]);
    }
    b.rem = r;
    b.pathVer = gridVer;
    b.lastGap = Infinity;
    b.jam = 0;
    b.dodge = 0;
  };

  /* 앵커 어긋남 기록(품질 지표) — 보정하기 '전'의 거리라야 뜻이 있다. */
  const drift: number[] = [];

  /* 키프레임은 '직선 예측에서 벗어날 때'만 찍는다(요청: 결과를 열 때 돌리므로 크기가
     곧 메모리다) — 마지막 키의 속도로 지금을 예측해 보고, 그 예측과 eps 넘게 어긋나야
     새 키다. 곧게 걷는 구간은 출발·도착 점 둘로 줄어든다. */
  const pushKey = (b: Body, t: number, force: boolean): void => {
    if (!force && Number.isFinite(b.kx)) {
      const el = t - b.kt;
      const pdx = b.x - (b.kx + b.kvx * el);
      const pdy = b.y - (b.ky + b.kvy * el);
      const turned = Math.abs(angDiff(b.kh, b.hdg));
      /* 채취 왕복은 결이 다르다 — 밭과 홀 사이를 하루 종일 오가므로, 도는 각도마다
         키를 찍으면 결과가 몇 배로 분다(실측: 게임 1이 80k → 467k키). 왕복의 뜻은
         '어디서 돌아섰나'지 '어느 쪽을 봤나'가 아니라, 방향 문턱을 크게 두고 자리
         문턱도 조금 넉넉히 준다. */
      const gath = b.state === ST_GATHER;
      const tol = gath ? eps * 2 : eps;
      if (pdx * pdx + pdy * pdy < tol * tol
        && turned < (gath ? 150 : 30) && b.state === b.ks) return;
    }
    const vdt = Number.isFinite(b.px) ? dt : 0;
    b.keys.push(Math.round(t * 100) / 100, Math.round(b.x * 100) / 100,
      Math.round(b.y * 100) / 100, Math.round(b.hdg), b.state);
    b.kx = b.x; b.ky = b.y; b.kh = b.hdg; b.ks = b.state; b.kt = t;
    b.kvx = vdt > 0 ? (b.x - b.px) / vdt : 0;
    b.kvy = vdt > 0 ? (b.y - b.py) / vdt : 0;
  };

  /* ── 루프 ─────────────────────────────────────────────────────────────────── */
  const dt = TICK_SEC;
  const ticks = Math.ceil((endSec + 2) / dt);
  /* 균일 격자 — 밀어내기 이웃 질의. 셀 2타일이면 반경 0.75는 이웃 아홉 칸 안이다. */
  const CELL = 2;
  const gw = Math.ceil(W / CELL) + 1;
  const gh = Math.ceil(H / CELL) + 1;
  /* 판판한 배열이다 — Map이 아니다(과제 #70). 격자는 틱마다 다시 채우고 개체마다
     읽는 자리라 해시 값이 그대로 시간이 된다. 칸은 길이만 0으로 되돌려 다시 쓰고,
     이번 틱에 손댄 칸만 적어 두어 비우기도 격자 전체를 안 훑는다. */
  const cells: Body[][] = Array.from({ length: gw * gh }, () => []);
  const cTouch: number[] = [];

  /* ── 전투(P2) ────────────────────────────────────────────────────────────────
     표적 찾기는 균일 격자로 이웃만 훑는다. 사거리(reachOf)는 공중·지상에 따라 무기가
     갈리고, 못 치는 갈래는 아예 표적이 아니다. */
  /* 모으는 동안은 늘어나는 숫자 배열이다 — 다 모은 뒤 한 번에 32비트 배열로 굳힌다
     (내보내는 모양은 Float32Array다, 위 SimEventArr 참고). */
  const events: number[] = [];
  const live: Body[] = [];
  /** 벙커 탑승자 — 쏘기는 하되 표적으로는 안 잡히는 개체들(이번 틱). */
  const garrison: Body[] = [];
  /** 이번 틱의 디텍터 — 땅속을 표적으로 삼으려면 제 편 디텍터가 곁에 있어야 한다. */
  const dets: Body[] = [];
  /** 이번 틱에 땅속인 개체가 하나라도 있나 — 없으면 탐지 검사를 통째로 건너뛴다(성능). */
  let anyBurrow = false;
  let kills = 0;
  let saved = 0;
  let shots = 0;
  /** 두 점 사이 거리 — 뜨거운 자리에서 Math.hypot은 V8에서 몇 배 느리다. */
  const dist = (ax: number, ay: number, bx: number, by: number): number => {
    const dx = bx - ax;
    const dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
  };

  /* ── ★ 사거리 삼분(과제 #48) ─────────────────────────────────────────────────
     원전은 셋을 따로 든다. 여기서 셋을 다시 하나로 뭉개면 지난 판의 회귀가 그대로 돌아온다.
       · 무기 사거리 — 표적을 '때리는' 거리. reachOf.
       · 획득 사거리(seek) — 스스로 표적을 '잡는' 거리. 질럿·저글링은 3타일이라 시야(7·5)
         보다 훨씬 짧다. 0이면 아예 자동으로 안 잡는다(드랍십·베슬·오버로드).
       · 시야 — 표시와 탐지용. 전투 판정에는 안 쓴다. 디텍터의 탐지 거리도 이 값이다.

     ★★ 그리고 이 파일의 거리는 전부 **중심-중심**인데 원작은 **스프라이트 상자 모서리
        사이**로 잰다. 그 차이를 안 메우면 무기 사거리가 0.469타일뿐인 질럿·저글링·
        다크템플러는 밀어내기 평형(0.66타일)을 뚫고 파고들기 전에는 영영 사거리 안에 못
        든다 — 6대6 질럿 사격이 12발에서 0발로 죽었던 자리다(verdict-실행 ■1).
        그 덧셈을 하는 곳은 bwCombat.reachTiles / minReachTiles / acquireReachTiles
        **셋뿐**이고, 이 파일은 Body.rad를 따로 더하지 않는다(이중 가산 금지).
     ── 여기 아래 네 자리가 그 판정 전부다: 획득(reachOf/seekTo) · 유지(+KEEP_PAD) ·
        발사(reachOf) · 정지(reachOf). 넷을 한꺼번에 갈아야 회귀가 풀린다. */

  /** 이 표적에 쓸 무기 — 못 치는 갈래면 null.
   *  러커는 **버로우해야** 지상 무기가 생긴다: 원작은 땅 위 러커의 지상 무기를 null로
   *  돌려주므로 표적 획득도 사격도 통째로 죽는다. 이 조건이 없으면 러커가 걸어 다니며
   *  가시를 쏜다. */
  const weaponFor = (a: Body, tgt: Body): ProfWeapon | null => {
    if (!tgt.air && a.kind === "Lurker" && !a.burrowed) return null;
    return weaponVs(a.cp, tgt.air);
  };
  /** 그 표적까지 실제로 닿는 무기 사거리(타일, 중심 기준). 못 치면 −1. */
  const reachOf = (a: Body, tgt: Body): number => {
    if (!weaponFor(a, tgt)) return -1;
    return reachTiles(a.cp, tgt.cp, tgt.air);
  };
  /** 그 표적을 '잡을' 수 있는 거리(타일, 중심 기준). 0이면 스스로 안 잡는다. */
  const seekTo = (a: Body, tgt: Body): number => acquireReachTiles(a.cp, tgt.cp);
  /** 그 표적이 이 편에게 보이나 — 땅속은 제 편 디텍터가 곁에 있어야 표적이 된다.
   *  탐지 거리는 유닛마다 다른 시야 그대로다(옵저버 9 · 오버로드 9 · 베슬 10 · 캐논 11).
   *  일률 9타일로 뭉개면 캐논·터렛의 탐지 범위가 2타일 줄어든다. */
  const visible = (a: Body, tgt: Body): boolean => {
    if (!anyBurrow || !tgt.burrowed) return true;
    for (const d of dets) {
      if (d.owner !== a.owner) continue;
      if (dist(d.x, d.y, tgt.x, tgt.y) <= d.cp.sight) return true;
    }
    return false;
  };
  /** 표적 격자 — 이번 틱의 산 개체를 셀에 담는다. 셀 4타일이면 사거리 8까지 이웃 5칸. */
  const TCELL = 4;
  const tgw = Math.ceil(W / TCELL) + 1;
  const tgh = Math.ceil(H / TCELL) + 1;
  /* 위 밀어내기 격자와 같은 이유로 판판한 배열이다 — 표적 훑기는 개체마다 이웃 셀
     수십 칸을 읽으므로 여기가 Map의 해시 값을 가장 많이 치르던 자리였다. */
  const tcells: Body[][] = Array.from({ length: tgw * tgh }, () => []);
  const tTouch: number[] = [];

  /* 채취 배정(P3) — 제 홀 12타일 안에 선 일꾼에게 밭 하나를 준다. 밭은 홀 둘레 9타일
     안의 미네랄 중 태그로 갈라(개체마다 다른 밭) 줄이 서게 한다. 가스는 곁(2.5타일)에
     제 정제소가 있으면 그쪽이다. 자원표가 없으면 채취를 안 만든다(거짓 왕복 금지). */
  const RES = opts.resources ?? [];
  /* 홀·가스는 몇 채뿐이라 미리 갈라 둔다 — 일꾼마다 전체 개체를 훑을 이유가 없다. */
  const hallList = bodies.filter((h) => h.bld && HALLS.has(h.kind));
  const gasList = bodies.filter((g) => g.bld && GAS_BLD.has(g.kind));
  /* 밭 임자 잠금(요청: "가스 미네랄 누가 캐고 있으면 못붙음 기다려야함") — 자원마다
     지금 붙어 있는 일꾼 하나. 만료(until)를 함께 들고 있어, 임자가 죽거나 명령을 받아
     떠나도 저절로 풀린다(붙어 있는 동안 매 틱 갱신된다). 원작의 밭 앞 줄서기이자,
     '밭당 3기까지가 쓸모 있다'는 포화의 뿌리다. */
  const claim = new Map<number, { tag: number; until: number }>();
  const assignJob = (b: Body, t: number): Body["job"] => {
    if (RES.length === 0) return null;
    let hx = 0;
    let hy = 0;
    let hd = 12;
    let hallKind = "";
    for (const h of hallList) {
      if (h.owner !== b.owner || h.state === ST_GONE) continue;
      if (t < h.born || (h.died !== null && t >= h.died)) continue;
      const d = dist(b.x, b.y, h.x, h.y);
      if (d < hd) { hd = d; hx = h.x; hy = h.y; hallKind = h.kind; }
    }
    if (hd >= 12) return null;
    const hf = BUILDING_FOOT[hallKind] ?? DEFAULT_FOOT;
    const rad = Math.max(0.3, b.rad);
    /* 줄(lane) — 한 밭에 여럿이 배정돼도 기다리는 자리가 정확히 포개지지 않게, 왕복
       길을 개체마다 옆으로 조금 비켜 놓는다. 태그로 갈라 결정적이다. */
    const lane = ((Math.abs(b.tag) % 3) - 1) * 0.42;
    const laid = (
      res: number, gas: boolean, cx: number, cy: number,
      q: [number, number, number, number],
    ): Body["job"] => {
      const dx = q[0] - q[2];
      const dy = q[1] - q[3];
      const L = Math.sqrt(dx * dx + dy * dy) || 1;
      const ox = (-dy / L) * lane;
      const oy = (dx / L) * lane;
      return {
        res, gas, cx, cy,
        px: q[0] + ox, py: q[1] + oy, hx: q[2] + ox, hy: q[3] + oy,
        phase: 0, wait: 0,
      };
    };
    // 가스 — 곁에 제 정제소가 서 있으면 그 자리가 밭이다.
    for (const g of gasList) {
      if (g.owner !== b.owner || g.state === ST_GONE) continue;
      if (t < g.born || (g.died !== null && t >= g.died)) continue;
      if (dist(b.x, b.y, g.x, g.y) <= 3.5) {
        const gf = BUILDING_FOOT[g.kind] ?? DEFAULT_FOOT;
        return laid(-g.tag, true, g.x, g.y,
          nearPair(g.x, g.y, gf[0] / 2, gf[1] / 2, hx, hy, hf[0] / 2, hf[1] / 2, rad));
      }
    }
    const near: number[] = [];
    RES.forEach((r, i) => { if (r[2] !== 1 && dist(hx, hy, r[0], r[1]) <= 9) near.push(i); });
    if (near.length === 0) return null;
    const ri = near[Math.abs(b.tag) % near.length];
    const pick = RES[ri];
    /* 밭과 홀 **발자국 사이 최단 선분**의 두 끝이 왕복의 양 끝이다(요청) — 밭 테두리
       앞에서 캐고, 홀 테두리 앞에서 반납한다. 어느 쪽 한가운데로도 안 들어간다. */
    return laid(ri, false, pick[0], pick[1],
      nearPair(pick[0], pick[1], MINERAL_FOOT[0] / 2, MINERAL_FOOT[1] / 2,
        hx, hy, hf[0] / 2, hf[1] / 2, rad));
  };

  /* 피해 셈은 여기서 다시 하지 않는다 — 표의 dealOneHit이 bwgame.h weapon_deal_damage를
     문장 순서 그대로 옮긴 것이고, 어댑터의 attackOf가 공업 레벨과 히트 수(파이어뱃 예외
     포함)를 얹어 표적을 그 자리에서 깎는다. 옛 damageOf는 실드와 체력에서 같은 값을 두 번
     빼고 크기 배수를 방어력보다 먼저 곱하던 어림이라, 그것을 다시 부르면 매트릭스·산성
     포자·환상·이른/늦은 하한이 통째로 빠진다.
     divisor는 스플래시 링(1/2/4)이다 — 방어력보다 **먼저** 나눈다. */
  const hurt = (a: Body, tgt: Body, w: ProfWeapon, t: number, divisor = 1): void => {
    if (tgt.state === ST_GONE || tgt.dieAt !== null) return;
    /* 다크스웜(과제 #54) — 그 안의 지상 비건물 표적은 원거리 공격을 **전부** 빗맞는다.
       표의 missChanceRaw가 그 자리에 255/256을 주는데, 우리는 주사위를 굴리는 대신
       확정 회피로 갈음한다: 255/256은 사실상 전부이고, 굴림을 넣으면 결정론이 깨진다.
       스플래시·야마토·근접은 뚫는다(ignoresDarkSwarm). */
    if (!ignoresDarkSwarm(w.wp) && underSwarm(tgt, t)) return;
    attackOf(w, a.cp, tgt.dmg, { divisor });
    /* 러커 말고는 맞는 순간 저절로 튀어나온다(on_hit_change_target). 이래디에이트가 걸린
       개체만 그대로 있는데 우리는 그 상태를 안 다뤄 조건에서 뺐다. 러커는 무슨 일이
       있어도 제 발로 안 나온다 — 땅속이라야 무기가 있기 때문이다. */
    if (tgt.burrowed && tgt.kind !== "Lurker" && BURROW_UNITS.has(tgt.kind)) {
      tgt.burrowed = false;
      tgt.burrowLock = BURROW_OUT_SEC;
    }
    // 원전은 피해가 남은 체력 이상이면 죽는다(초과가 아니라 같아도 죽는다) — dealOneHit의 >=.
    if (tgt.dmg.hp > 0) return;
    /* 증거가 시뮬을 이긴다 — 명령을 받은 태그는 그때 확실히 살아 있었다. 그렇다고 체력
       1로 영영 버티게 두면 그 유닛이 총알을 다 빨아들이는 스펀지가 된다. 죽을 시각만
       증거의 하한까지 미뤄 두고, 표적으로도 더는 안 잡히게 한다. */
    tgt.dmg.hp = 0;
    tgt.dieAt = Math.max(t, tgt.aliveUntil);
    if (tgt.dieAt > t) saved += 1;
    kills += 1;
    events.push(tgt.dieAt, EV_DIE, tgt.tag, a.tag,
      Math.round(tgt.x * 10) / 10, Math.round(tgt.y * 10) / 10, 0, 0);
  };

  /* 러커 가시 — 표적 하나가 아니라 제 앞 직선 위의 지상 적 전부를 때린다. 감쇠가 없어
     안쪽 링(splashPx[0] = 20px) 안이면 누구든 전액을 맞고, 같은 표적은 32프레임 안에
     두 번 안 맞는다(LURKER_REHIT_FRAMES). 그래서 이 무기만 스플래시 경로를 안 탄다. */
  const lurkerSpines = (a: Body, f: Body, w: ProfWeapon, t: number): void => {
    const inner = w.splashPx[0] / 32;
    const dx = f.x - a.x;
    const dy = f.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-4) { hurt(a, f, w, t); return; }
    const ux = dx / len;
    const uy = dy / len;
    const reach = w.rangeTiles + a.rad;
    let hits = a.lurkHit;
    if (!hits) { hits = new Map(); a.lurkHit = hits; }
    const cx = Math.floor(a.x / TCELL);
    const cy = Math.floor(a.y / TCELL);
    const rad = Math.ceil((reach + 1) / TCELL);
    const yA = cy - rad < 0 ? 0 : cy - rad;
    const yB = cy + rad >= tgh ? tgh - 1 : cy + rad;
    const xA = cx - rad < 0 ? 0 : cx - rad;
    const xB = cx + rad >= tgw ? tgw - 1 : cx + rad;
    for (let yy = yA; yy <= yB; yy += 1) {
      for (let xx = xA; xx <= xB; xx += 1) {
        const arr = tcells[yy * tgw + xx];
        for (const c of arr) {
          if (c.owner === a.owner || c.air || c.state === ST_GONE || c.dieAt !== null) continue;
          if (c.state === ST_INSIDE) continue;
          const px = c.x - a.x;
          const py = c.y - a.y;
          const along = px * ux + py * uy;
          if (along < 0 || along > reach + c.rad) continue;
          if (Math.abs(px * uy - py * ux) > inner + c.rad) continue;
          if (t - (hits.get(c.tag) ?? -1e9) < LURKER_REHIT_SEC) continue;
          hits.set(c.tag, t);
          hurt(a, c, w, t);
        }
      }
    }
  };

  const fireOne = (a: Body, t: number): void => {
    if (a.cd > 0) a.cd -= dt;
    if (!a.cp.ground && !a.cp.air) return;
    // 일꾼은 스스로 싸우러 가지 않는다 — 어택 명령을 콕 받았을 때만.
    if (a.wk && !a.aggro) return;
    /* ── 판정 ② 표적 유지 — 무기 사거리(중심 기준) + 여유 안이면 그대로 둔다. */
    let f = a.foe;
    if (f && (f.state === ST_GONE || f.dieAt !== null || !visible(a, f)
      || dist(a.x, a.y, f.x, f.y) > reachOf(a, f) + KEEP_PAD)) {
      f = null;
      /* 놓친 뒤에는 재표적 타이머(15프레임=0.630초)가 지나야 새로 잡는다(과제 #58).
         재표적만은 정말 15다 — bwgame.h:12564가 main_order_timer=15와 함께
         order_process_timer=0을 놓아 위상을 다시 잡기 때문이다. 옛 0.5초는 근거가 없었고,
         무엇보다 '놓침'과 '평소 훑기'를 구분하지 않아 표적이 죽자마자 다음이 즉시 붙었다. */
      a.reacq = t + RETARGET_SEC;
    }
    /* ── 판정 ① 표적 획득 — 무기 사거리가 아니라 **획득 사거리**로 잡는다. 훑는 주기는
       원전의 오더 처리 주기(9프레임=0.378초)이고 개체마다 위상이 다르다. */
    if (!f && t >= a.reacq && a.cp.acquire > 0) {
      a.reacq = t + ORDER_PERIOD_SEC;
      let bq = Infinity;
      const cx = Math.floor(a.x / TCELL);
      const cy = Math.floor(a.y / TCELL);
      const rad = Math.ceil((a.cp.acquire + 2) / TCELL);
      const yA = cy - rad < 0 ? 0 : cy - rad;
      const yB = cy + rad >= tgh ? tgh - 1 : cy + rad;
      const xA = cx - rad < 0 ? 0 : cx - rad;
      const xB = cx + rad >= tgw ? tgw - 1 : cx + rad;
      for (let yy = yA; yy <= yB; yy += 1) {
        for (let xx = xA; xx <= xB; xx += 1) {
          const arr = tcells[yy * tgw + xx];
          for (const c of arr) {
            if (c.owner === a.owner || c.state === ST_GONE || c.dieAt !== null) continue;
            // 태운 유닛은 못 때린다 — 원작에서 벙커·수송선 안은 표적이 아니다.
            if (c.state === ST_INSIDE) continue;
            /* 거리를 먼저 본다 — 이미 더 가까운 표적이 있으면 나머지는 볼 것도 없다.
               제곱으로 견주어 뿌리 셈도 그때만 친다(과제 #70). */
            const qx = c.x - a.x;
            const qy = c.y - a.y;
            const q = qx * qx + qy * qy;
            if (q >= bq) continue;
            // 못 치는 갈래(지상 전용이 공중을, 대공 전용이 지상을)는 표적이 아니다.
            if (reachOf(a, c) < 0) continue;
            if (!visible(a, c)) continue;
            const st = seekTo(a, c);
            if (q > st * st) continue;
            bq = q; f = c;
          }
        }
      }
    }
    a.foe = f;
    // 하차 벌칙으로 잠긴 동안은 못 쏜다(리버의 main_order_timer=30).
    if (!f || a.cd > 0 || t < a.actUntil) return;
    const w = weaponFor(a, f);
    if (!w) return;
    /* ── 판정 ③ 발사 — 획득했다고 바로 닿지는 않는다(질럿은 걸어가야 한다).
       최소 사거리도 함께 본다: 시즈 모드 64px가 유일한 사례인데 여태 아무도 안 읽어
       시즈탱크가 코앞에서도 쐈다(verdict-실행 ■4). */
    const fd = dist(a.x, a.y, f.x, f.y);
    if (fd > reachOf(a, f)) return;
    if (fd < minReachTiles(a.cp, f.cp, f.air)) return;
    /* 쿨다운은 표가 셈한다(과제 #54) — 여태 무보정 원값(w.cd)을 그대로 썼다. 그래서
       스팀 먹은 마린이 평소 속도로 쐈고, 아드레날 저글링도 그랬으며, 인스네어에 젖어도
       손이 안 무뎠다. cooldownFrames가 원전의 순서(산성포자 가산 → 배수 → 5~250 죔)를
       그대로 옮겨 놓았으니 그것을 부른다. 산성포자는 디바우러 중첩을 아직 안 세어 뺐다. */
    a.cd = cooldownSec(w.wp, {
      stim: t < a.stimUntil,
      adrenal: a.adrenal,
      ensnared: t < a.ensnaredUntil,
    });
    shots += 1;
    events.push(t, EV_FIRE, a.tag, f.tag, Math.round(a.x * 10) / 10, Math.round(a.y * 10) / 10,
      Math.round(f.x * 10) / 10, Math.round(f.y * 10) / 10);
    if (w.splashKind === "lurker") { lurkerSpines(a, f, w, t); return; }
    hurt(a, f, w, t);
    /* 스플래시 — 표적 둘레의 적도 함께(아군 오폭은 P2 뒤 검토, 지금은 안 넣는다).
       링 셋(1/2/4 나눔)은 표의 splashDivisorAt이 가른다. 그 함수가 땅속 표적 규칙도
       함께 든다: 버로우한 것은 **안쪽 링만** 맞고 중간·바깥 링은 아예 안 닿는다. */
    if (w.splashKind !== "none") {
      const sr = w.splashPx[2] / 32;
      const cx = Math.floor(f.x / TCELL);
      const cy = Math.floor(f.y / TCELL);
      const rad = Math.ceil((sr + 1) / TCELL);
      const yA = cy - rad < 0 ? 0 : cy - rad;
      const yB = cy + rad >= tgh ? tgh - 1 : cy + rad;
      const xA = cx - rad < 0 ? 0 : cx - rad;
      const xB = cx + rad >= tgw ? tgw - 1 : cx + rad;
      for (let yy = yA; yy <= yB; yy += 1) {
        for (let xx = xA; xx <= xB; xx += 1) {
          const arr = tcells[yy * tgw + xx];
          for (const c of arr) {
            if (c === f || c.owner === a.owner || c.state === ST_GONE
              || c.state === ST_INSIDE) continue;
            const dv = splashDivisorAt(w, dist(f.x, f.y, c.x, c.y) * 32,
              { burrowed: c.burrowed });
            if (dv === null) continue;
            hurt(a, c, w, t, dv);
          }
        }
      }
    }
  };

  const fireAll = (t: number): void => {
    for (let i = 0; i < tTouch.length; i += 1) tcells[tTouch[i]].length = 0;
    tTouch.length = 0;
    dets.length = 0;
    for (const b of live) {
      const bx = Math.floor(b.x / TCELL);
      const by = Math.floor(b.y / TCELL);
      const k = (by < 0 ? 0 : by >= tgh ? tgh - 1 : by) * tgw
        + (bx < 0 ? 0 : bx >= tgw ? tgw - 1 : bx);
      const arr = tcells[k];
      if (arr.length === 0) tTouch.push(k);
      arr.push(b);
      if (b.cp.detector) dets.push(b);
    }
    for (const a of live) fireOne(a, t);
    /* 벙커 안에서 쏘는 것들 — 표적 격자에는 안 넣는다. 원작에서 벙커에 탄 유닛은 따로
       겨눌 수 없고(벙커를 때려야 한다) 벙커 자신은 무기가 아예 없다(UNITS.Bunker의
       ground/air가 둘 다 null). 쏘는 것은 마린·파이어뱃·고스트뿐이고 메딕·SCV는 타기만
       한다 — bunkerShooterProfileOf가 후자에 null을 준다. */
    for (const a of garrison) fireOne(a, t);
  };

  /* 활성 목록(성능) — 예전엔 매 틱 전체 개체를 훑었다. 20분 4:4는 개체 3천 × 1만 틱이라
     3천만 번인데, 그 대부분이 "아직 안 태어남" 또는 "이미 죽음"이었다. 출생순으로 줄을
     세워 때가 되면 넣고, 걷히면 빼면 실제로 도는 것은 그 순간 살아 있는 몇백 기다. */
  /* 판을 다시 구울 시각 — 건물이 서거나 무너지는 순간뿐이다(경기당 수백 번). */
  const gridTimes = [...new Set(bodies.flatMap((b) => (b.bld
    ? [b.born, ...(b.died !== null ? [b.died] : []),
      // 이·착륙도 판이 바뀌는 순간이다 — 뜬 자리는 풀리고 앉은 자리는 다시 막힌다.
      ...b.flyWins.flatMap(([fa, fb]) => (Number.isFinite(fb) ? [fa, fb] : [fa]))]
    : [])))].sort((a, b2) => a - b2);
  let gridIdx = 0;
  let lastGrid = -99;
  rebuildGrid(0);

  /* ── 좌표 마법(과제 #54) ─────────────────────────────────────────────────────
     표는 이 효과들을 진작 셈할 줄 알았는데(dealOneHit의 매트릭스 단계, missChanceRaw의
     다크스웜 갈래, cooldownFrames의 스팀·인스네어) 코어가 재료를 못 받아 한 번도 안
     탔다. 이제 casts를 읽어 세 가지를 건다.
       · 다크스웜 — 그 안의 지상 비건물 표적은 원거리 공격을 **전부** 빗맞는다
         (missChanceRaw가 255/256을 주는 자리다). 스플래시·야마토·근접은 뚫는다.
       · 인스네어 — 젖은 적의 쿨다운이 1.25배가 된다.
       · 디펜시브 매트릭스 — 250을 대신 맞아 준다(dealOneHit의 (5)단계).
     반경과 다크스웜 지속은 표에 없어 어림이다 — 스웜 스프라이트가 6타일 폭이라 반경 3,
     인스네어는 4×4칸이라 반경 2로 잡았다. 지속은 상태 타이머 표(STATUS_TICKS)에서
     온다(인스네어 25.2초·매트릭스 56.4초·스팀 12.4초). 스웜만 유닛 타이머가 아니라
     스프라이트라 표에 없어 30초로 둔다. [추정] */
  const DARK_SWARM_TILES = 3;
  const DARK_SWARM_SEC = 30;
  const ENSNARE_TILES = 2;
  const MATRIX_SNAP_TILES = 1.5;
  const STIM_SEC = timerSec(STATUS_TICKS.stim);
  const ENSNARE_SEC = timerSec(STATUS_TICKS.ensnare);
  const MATRIX_SEC = timerSec(STATUS_TICKS.defensiveMatrix);
  const castsSorted = [...(data.casts ?? [])].sort((a, b2) => a[0] - b2[0]);
  /** 살아 있는 다크스웜 [끝나는 초, x, y]. 몇 개 안 되어 훑어도 싸다. */
  const swarms: [number, number, number][] = [];
  /** 아직 안 터진 스톰 박자 [초, x, y] — 오름차순. 시전 하나가 여덟을 낳는다. */
  const stormPulsesDue: [number, number, number][] = [];
  let stormI = 0;
  let castI = 0;
  const underSwarm = (b: Body, t: number): boolean => {
    if (b.air || b.bld) return false;          // 공중·건물은 스웜이 안 가린다
    for (const [end, sx, sy] of swarms) {
      if (t > end) continue;
      if (Math.abs(b.x - sx) <= DARK_SWARM_TILES && Math.abs(b.y - sy) <= DARK_SWARM_TILES) return true;
    }
    return false;
  };

  const byBorn = [...bodies].sort((a, b2) => a.born - b2.born);
  let bornIdx = 0;
  let active: Body[] = [];

  for (let k = 0; k <= ticks; k += 1) {
    const t = k * dt;
    for (let i = 0; i < cTouch.length; i += 1) cells[cTouch[i]].length = 0;
    cTouch.length = 0;
    live.length = 0;
    garrison.length = 0;
    anyBurrow = false;
    /* 판 다시 굽기는 15초에 한 번으로 묶는다 — 굽는 비용 자체보다, 판 번호가 바뀌면
       길 갈무리가 통째로 쓸모없어져 부대 전체가 길을 다시 셈하는 것이 훨씬 비싸다
       (실측: 2초 간격이면 게임 1이 11.8초, 15초 간격이면 아래 값). 건물이 서는 순간과
       길이 막히는 순간이 15초쯤 어긋나도 화면에서는 안 보인다. */
    if (gridIdx < gridTimes.length && gridTimes[gridIdx] <= t && t - lastGrid >= 15) {
      while (gridIdx < gridTimes.length && gridTimes[gridIdx] <= t) gridIdx += 1;
      lastGrid = t;
      rebuildGrid(t);
    }
    while (bornIdx < byBorn.length && byBorn[bornIdx].born <= t) {
      active.push(byBorn[bornIdx]);
      bornIdx += 1;
    }
    let dropped = false;

    for (const b of active) {
      if (t < b.born) continue;
      /* 스팀은 증거가 켠다(f=16) — 누른 순간부터 12.4초. 만료된 매트릭스는 남은 흡수량을
         지운다(안 지우면 한 번 감싼 유닛이 경기 내내 250을 대신 맞는다). */
      while (b.stimI < b.stims.length && b.stims[b.stimI] <= t) {
        b.stimUntil = b.stims[b.stimI] + STIM_SEC;
        b.stimI += 1;
        /* 스팀은 값을 치른다 — 방어력·실드를 무시한 생피해 10. 체력이 10 이하면 안 든다
           (원작이 그 자리에서 거른다). 공짜로 두면 스팀이 순이득이라 남발한 판이 유리해진다. */
        if (b.dmg.hp > STIM_SELF_DAMAGE * 256) b.dmg.hp -= STIM_SELF_DAMAGE * 256;
      }
      if (b.matrixUntil >= 0 && t > b.matrixUntil) { b.dmg.matrixHp = 0; b.matrixUntil = -1; }
      if (b.died !== null && t >= b.died) {
        if (b.state !== ST_GONE) { b.state = ST_GONE; pushKey(b, b.died, true); }
        dropped = true;
        continue;
      }
      if (b.dieAt !== null && t >= b.dieAt) {
        b.died = b.dieAt; b.state = ST_GONE; pushKey(b, b.dieAt, true);
        dropped = true;
        continue;
      }
      /* 분석이 말한 죽음은 상한이다 — 시뮬이 그때까지 못 죽였으면 여기서 죽는다.
         (아래 전투가 그보다 먼저 죽이면 그쪽이 이긴다.) */
      if (b.dieBy !== null && t >= b.dieBy && b.died === null) {
        b.died = b.dieBy; b.state = ST_GONE; pushKey(b, b.dieBy, true);
        events.push(b.dieBy, EV_DIE, b.tag, 0, Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10, 0, 0);
        dropped = true;
        continue;
      }
      if (b.state === ST_GONE) { dropped = true; continue; }

      /* 건물 — 앉아 있으면 제자리에서 싸우고 맞기만 한다. 띄운 건물만 움직인다.
         속도는 건물 종류를 안 가리고 늘 1픽셀/프레임(0.744타일/초)이다: 이·착륙 오더가
         최고 속도를 그 값으로 박아 넣고, 오더가 끝날 때의 속도 복원이 건물을 제외해
         원래 값으로 못 돌아온다(bwTransport.FLYING_BUILDING_TPS). 렌더러가 쓰던
         1.2타일/초는 1.6배 빨랐다. 뜬 동안은 air라 지상 무기가 못 닿고 대공이 친다. */
      if (b.bld) {
        while (b.oi < b.ords.length && b.ords[b.oi].t <= t) {
          const o = b.ords[b.oi];
          b.oi += 1;
          if (o.kind === "liftoff") {
            b.lifted = true; b.air = true; b.speed = FLYING_BUILDING_TPS;
            b.landTo = null; b.dest = null; b.path = []; b.pi = 0;
            // 이륙 증거의 좌표는 그때 건물이 서 있던 중심이다 — 있으면 거기서 뜬다.
            if (o.x >= 0) { b.x = o.x; b.y = o.y; }
            continue;
          }
          if (o.kind === "land") {
            // 착륙 증거는 타일 좌상단이라 발자국 절반만큼 밀어 중심으로 바꾼다.
            const lf = BUILDING_FOOT[b.kind] ?? DEFAULT_FOOT;
            const lx = o.x + lf[0] / 2;
            const ly = o.y + lf[1] / 2;
            if (b.lifted) { b.landTo = [lx, ly]; b.dest = null; } else { b.x = lx; b.y = ly; }
            continue;
          }
          // 뜬 채로 받은 이동·어택은 정찰 비행이다 — 공중이라 곧게 난다.
          if (b.lifted && (o.kind === "move" || o.kind === "attack")) setDest(b, o.x, o.y);
        }
        if (b.lifted) {
          const goal = b.landTo ?? b.dest;
          if (goal) {
            const dxL = goal[0] - b.x;
            const dyL = goal[1] - b.y;
            const dL = Math.sqrt(dxL * dxL + dyL * dyL);
            const goL = Math.min(b.speed * dt, dL);
            if (dL > 1e-4) { b.x += (dxL / dL) * goL; b.y += (dyL / dL) * goL; }
            if (dL - goL <= ARRIVE) {
              if (b.landTo) {
                /* 착륙 판정은 원작에서 매 프레임 돈다 — order_BuildingLand(7686)만 오더
                   게이트 **앞**에 있어 9프레임 격자에 안 걸린다. 여기서는 매 틱이 그
                   자리다. 발자국 타일이 하나라도 막혀 있으면 못 앉고 뜬 채로 남는다. */
                if (!landBlocked(b, b.landTo[0], b.landTo[1], t)) {
                  b.x = b.landTo[0]; b.y = b.landTo[1]; b.landTo = null;
                  b.lifted = false; b.air = false; b.speed = 0;
                }
              } else b.dest = null;
            }
          }
          b.state = b.landTo !== null || b.dest !== null ? ST_MOVE : ST_IDLE;
        }
        live.push(b);
        pushKey(b, t, b.keys.length === 0);
        continue;
      }
      // ① 이번 틱에 온 주문 — 여럿이면 마지막 것이 지금의 명령이다.
      while (b.oi < b.ords.length && b.ords[b.oi].t <= t) {
        const o = b.ords[b.oi];
        b.oi += 1;
        if (o.kind === "board") { b.inside = o.tag; b.state = ST_INSIDE; b.dest = null; continue; }
        if (o.kind === "unload") {
          b.inside = null; b.cp = b.cpBase;
          b.x = o.x; b.y = o.y; b.dest = null; b.state = ST_IDLE;
          /* 하차 벌칙(unit_unload, bwgame.h:3167-3178)은 **양자택일**이다.
             · 오더 잠금 가지 — main_order_timer=30(1.260초). 리버가 확정 사례이고,
               '재장전할 무기가 없는 유닛'도 같은 가지로 본다([추정]). 이 가지는 무기 쿨
               재장전을 **안 받는다**(else 가지다). 앞 판은 둘을 겹쳐 걸어 리버가 이중으로
               벌을 받았다.
             · 무기 쿨 재장전 가지 — 제 무기의 풀 쿨을 처음부터 다시 채운다.
             · 벙커에서 나오는 것은 u_grounded_building 가지라 벌칙 자체가 없다. */
          const ship = (byTag.get(o.tag) ?? [])
            .find((s) => t >= s.born && (s.died === null || t < s.died));
          if (!ship || !UNLOAD_PENALTY_EXEMPT.has(ship.kind)) {
            const hasWeapon = !!(b.cpBase.ground || b.cpBase.air);
            if (unloadOrderLocked(b.kind, hasWeapon)) {
              b.actUntil = Math.max(b.actUntil, t + UNLOAD_ORDER_LOCK_SEC);
            } else {
              const wcd = Math.max(b.cpBase.ground?.cd ?? 0, b.cpBase.air?.cd ?? 0);
              if (wcd > 0) b.cd = Math.max(b.cd, wcd);
            }
          }
          continue;
        }
        /* 이·착륙은 건물의 것이다 — 걷는 유닛에게 f=6은 오지 않고, f=5(착륙 자리)가
           붙은 비건물 개체는 예전대로 '그때 거기 있었다'는 하드 앵커로 읽는다. */
        if (o.kind === "liftoff") continue;
        if (o.kind === "anchor" || o.kind === "land") {
          const d = dist(b.x, b.y, o.x, o.y);
          if (b.keys.length === 0) {
            // 출생 자리는 그냥 거기서 시작한다 — 통계에 넣으면 늘 0이라 뜻이 없다.
            b.x = o.x; b.y = o.y;
          } else {
            drift.push(d);
            if (d > ANCHOR_SNAP) {
            /* 순간이동으로 고치지 않는다 — 어긋남을 다음 몇 초의 걸음에 녹인다. */
              b.fixX = o.x - b.x; b.fixY = o.y - b.y; b.fixT = ANCHOR_FIX_SEC;
              /* ★ 크게 빗나갔다는 것은 자리만 틀린 것이 아니라 **목적지 모형이 틀렸다**는
                 뜻이다. 증거가 저기 있었다고 말하는데 우리는 여기서 저쪽으로 걸어가는 중
                 이었다면, 그 목적지는 이미 지난 명령의 잔상이다. 자리만 당겨 놓고 낡은
                 목적지로 계속 걸으면 다음 앵커에서 똑같이 빗나간다 — 그래서 목적지도 함께
                 버린다. ③-0d 마중이 들어온 지금 다시 재면 이 블록만 지웠을 때
                 tracks 중앙 1.65 → 1.95, 초과 51.8% → 55.2%다(마중이 없던 판에서는
                 3.20 → 3.75였다 — 그 수치는 이제 옛 판의 것이다). */
              if (d > STALE_DEST && b.dest) {
                b.dest = null; b.path = []; b.pi = 0; b.rem = null;
                b.hasHome = false; b.chase = 0; b.state = ST_IDLE;
              }
            }
            /* 땅속인 개체에 '그때 저기 있었다'는 증거가 붙으면 그건 땅속이 아니었다는
               말이다(우리 버로우는 커맨드가 아니라 어림이다). 증거가 어림을 이긴다 —
               언버로우 지연도 안 건다. 이미 거기까지 갔다는 증거니 그 시간은 지난 뒤다. */
            if (b.burrowed) { b.burrowed = false; b.burrowIn = -1; }
          }
          continue;
        }
        if (b.inside !== null) continue;   // 배 안에서 받은 명령은 내린 뒤에 쓴다(P4)
        /* 땅속에 든 개체에게 온 이동·공격 명령은 '그 직전에 언버로우했다'는 증거다.
           원작은 버로우한 유닛에게 Unburrowing 말고는 명령을 안 주고, 러커는 unit_can_move
           가 거짓이라 이동 명령 자체를 거부한다. 그런데 우리 파서는 버로우/언버로우
           커맨드(0x2c/0x2d)를 증거로 안 담아, 땅속인 개체에 이동 명령만 덩그러니 남는다.
           명령은 받되 최소 36프레임 동안 제자리에 묶어 "버로우한 채 미끄러진다"를 막는다. */
        if (b.burrowed) { b.burrowed = false; b.burrowLock = BURROW_OUT_SEC; }
        b.burrowIn = -1;
        setDest(b, o.x, o.y);
        if (b.job) claim.delete(b.job.res);
        b.job = null;
        b.aggro = o.kind === "attack";
        b.state = ST_MOVE;
        /* 명령이 준 목적지를 따로 기억한다 — 적을 쫓다 놓쳤을 때 돌아갈 자리다. */
        b.homeX = o.x; b.homeY = o.y; b.hasHome = true;
        b.chase = 0;
      }

      // ② 배 안이면 배를 따라간다 — 제 걸음이 없다.
      if (b.inside !== null) {
        const ship = (byTag.get(b.inside) ?? []).find((s) => t >= s.born && (s.died === null || t < s.died));
        if (ship) { b.x = ship.x; b.y = ship.y; }
        /* 벙커는 배가 아니다 — 원작에서 둘을 가르는 것은 딱 한 줄이다. 벙커 안이면
           BunkerGuard, 수송선 안이면 Nothing. 벙커 자신은 무기가 아예 없고, 안에 든
           마린·파이어뱃·고스트가 무기 +64px·획득 +2타일을 받아 대신 쏜다(메딕·SCV는
           타기만 한다 — cpBunker가 null). 탑승자는 표적 격자에 안 넣는다: 원작에서
           벙커 안은 따로 겨눌 수 없고 벙커를 때려야 한다. */
        if (ship && ship.kind === "Bunker" && b.cpBunker) {
          b.cp = b.cpBunker;
          garrison.push(b);
        }
        pushKey(b, t, false);
        continue;
      }

      /* ③-0 땅속 — 원작에는 땅속 유닛의 위치가 바뀔 수 있는 코드 경로 자체가 없다
         (movement_UM_Init이 아무 일도 안 하는 UM_Lump로 떨어진다). 걸음도, 앵커 보정도,
         밀어내기도 여기서 끊는다. 언버로우가 끝나기 전(burrowLock)도 마찬가지로 제자리다.
         러커만은 이 상태에서 지상 무기가 생기고, 조준 각 제한이 없어 표적 쪽으로 홱 돈다. */
      if (b.burrowed || b.burrowLock > 0) {
        let freed = false;
        if (b.burrowLock > 0) {
          b.burrowLock = Math.max(0, b.burrowLock - dt);
          freed = b.burrowLock <= 0;
        }
        if (b.burrowed) {
          anyBurrow = true;
          if (b.foe && b.foe.state !== ST_GONE) {
            const bfx = b.foe.x - b.x;
            const bfy = b.foe.y - b.y;
            if (bfx * bfx + bfy * bfy > 0.0001) {
              b.hdg = norm360((Math.atan2(-bfx, bfy) * 180) / Math.PI);
            }
          }
        }
        b.state = b.burrowed ? ST_BURROW : ST_IDLE;
        b.vel = 0;
        live.push(b);
        /* 땅을 나오는 마지막 틱에는 키를 꼭 박는다 — 안 박으면 '멈춰 있던 키'와 '걷기
           시작해 어긋난 키' 사이를 렌더가 곧게 이어, 땅속인 동안 조금씩 미끄러진 것처럼
           보인다. 자리는 안 바뀌는데 그림만 흐르는 그 현상이 애초에 지적받은 장면이다. */
        pushKey(b, t, b.keys.length === 0 || freed);
        b.px = b.x; b.py = b.y;
        continue;
      }
      /* ③-0b 버로우 들어가기 — 리플레이 스트림에 버로우 커맨드가 없으므로(파서가
         0x2c/0x2d를 안 담는다) 러커만은 '갈 곳이 없으면 땅에 든다'로 되살린다. 원작
         러커는 버로우해야 무기가 생겨 땅 위에서는 아무 쓸모가 없으니, 제자리에 선 러커는
         십중팔구 땅속이다. 들어가는 데 걸리는 시간은 하한(2틱=18프레임)을 쓴다. [어림] */
      if (b.kind === "Lurker" && !b.dest && b.inside === null && b.fixT <= 0) {
        b.burrowIn = b.burrowIn < 0 ? BURROW_IN_SEC : b.burrowIn - dt;
        if (b.burrowIn <= 0) { b.burrowed = true; b.burrowIn = -1; anyBurrow = true; }
      } else if (b.burrowIn >= 0) {
        b.burrowIn = -1;
      }

      /* ③-0c 앵커 보정 — 남은 몫을 시간에 걸쳐 조금씩.
         ※ 아래 세 군데(3.54→3.38 · 3.37→3.68 · 3.36→3.20)는 **③-0d 앵커 마중이 들어오기
           전 판에서 잰 값**이다. 어느 쪽이 나은지를 가른 근거로는 아직 유효하지만
           절대 수치로는 이제 맞지 않는다(같은 픽스처의 지금 중앙은 1.64다). 다시
           인용하지 마라 — 인용하려거든 다시 재라.
         ★ 이 블록은 예전에 걸음(④) 뒤에 있었다. 그런데 교전 중(ST_FIGHT)·채취 중
         (ST_GATHER)인 개체는 그 자리에 닿기 전에 continue로 빠져나가, **보정이 통째로
         버려졌다.** 싸우거나 캐는 동안 어긋난 몸은 영영 안 돌아왔고 그것이 다음 앵커의
         드리프트로 그대로 쌓였다(실측: 이 한 자리를 앞으로 옮기니 tracks 중앙 3.54 →
         3.38). 그래서 갈래가 갈리기 전으로 올린다. */
      if (b.fixT > 0) {
        const ff = Math.min(1, dt / b.fixT);
        const ax = b.x + b.fixX * ff;
        const ay = b.y + b.fixY * ff;
        /* 보정도 벽은 안 넘는다 — 이 게이트가 없으면 걸음을 아무리 막아도 앵커 보정
           만으로 벽을 통과했다(과제 #50의 남은 구멍).
           ★ 그런데 여기서 보던 것이 blockedAt(지형 + 건물 발자국 + 자원 발자국)이었고,
             그것이 이번 병합에서 가장 크게 드리프트를 망가뜨린 한 줄이었다(3.37 → 3.68,
             그 줄만 되돌리면 곧장 3.37로 돌아왔다). 이유는 일꾼이다: 채취 자리는 미네랄
             과 홀 발자국 **바로 그 위**라, 증거가 "그때 저기 있었다"고 말하는 자리를 우리
             판이 '막힘'으로 읽어 보정을 통째로 거절했다. 일꾼이 앵커의 62%(tracks 190/308)
             를 차지하니 그 거절이 곧 전체 성적이었다.
             증거는 우리 어림을 이긴다. 건물·자원 발자국은 우리가 지어낸 판이므로 여기서
             안 본다. 지도가 말하는 진짜 벽(terrain.walk)만 남긴다 — 그것만은 증거 좌표가
             거스를 리 없다. */
        if (b.air || !wallAt(ax, ay)) { b.x = ax; b.y = ay; }
        b.fixX -= b.fixX * ff; b.fixY -= b.fixY * ff;
        b.fixT -= dt;
      }

      /* ③-0d 앵커 마중 — 다음 하드 앵커까지 걸어서 마중 나간다.
         ★ 이것이 이 단계에서 마지막으로 남은 구조적 결함을 닫는 자리다.
           앞 단계는 "이 일꾼이 몇 초 뒤 지도 저쪽에 건물을 지으러 간다는 것은
           앞을 안 보면 못 맞힌다"라고 적었다. 그런데 우리는 재생기다 — 경기는 이미
           끝난 일이고, ordersOf가 개체마다 주문 목록 전체를 처음부터 손에 들고 있다.
           앞을 못 보는 것이 아니라 안 보고 있었다.
         하드 앵커(f=1 남이 찍은 자리 · f=2 건설 자리 · f=3 출생)는 여태 ‘그때 거기
         있었다’로만 읽혔다. 그러면 증거가 당도하는 순간의 어긋남은 늘 ‘거기까지 갔어야
         할 거리’ 전부가 된다 — 일꾼은 직전까지 엉뚱한 데 서 있다가 갑자기 건설 자리로
         끌려간다. tracks 앵커 308건 중 190건이 프로브이고 그중 177건이 1.5타일을 넘기던
         이유가 바로 이것이었다.
         증거는 ‘거기 있었다’인 동시에 ‘거기로 가고 있었다’이다. 달리 받을 명령이 없는
         개체라면, 제 발로 가서 제시간에 닿을 만큼 앞당겨 출발시킨다.
         조건을 좁힌 이유도 적는다 — 목적지가 이미 있으면(진짜 이동·어택 명령) 그쪽이
         더 강한 증거라 건드리지 않고, 보정이 도는 중(fixT>0)이면 두 장치가 서로를
         밀치므로 비킨다. ANCHOR_SNAP 아래는 이미 거의 제자리라 걸을 것도 없다.
         실측 — 이 블록 하나를 넣고 뺀 차이다(같은 파일, 같은 픽스처, 다른 손잡이 그대로):
           tracks : 중앙 3.20 → **1.65** · 90분위 13.07 → **12.38** · 1.5타일초과 71.1% → **51.8%**
           lift   : 중앙 2.20 → **1.31** · 90분위 14.30 → **12.74** · 1.5타일초과 56.8% → **48.5%**
         기준선(HEAD)이 70.7% / 58.3% 였으니 이 한 자리가 두 경기의 성적을 함께 갈랐다.
         값을 지어내지 않는다는 원칙은 지킨다 — 개체는 제 speed로 setDest를 따라 걸을 뿐,
         순간이동하지 않는다. 앞당기는 것은 출발 시각이지 속도가 아니다. */
      if (b.fixT <= 0 && !b.dest && b.speed > 0 && b.inside === null) {
        const nx = b.ords[b.oi];
        if (nx && nx.kind === "anchor") {
          const adx = nx.x - b.x;
          const ady = nx.y - b.y;
          const add = Math.sqrt(adx * adx + ady * ady);
          if (add > ANCHOR_SNAP && nx.t - t <= add / b.speed) {
            setDest(b, nx.x, nx.y);
            if (b.job) claim.delete(b.job.res);
            b.job = null;
            b.aggro = false;
            b.state = ST_MOVE;
            b.hasHome = false;
            b.chase = 0;
          }
        }
      }

      /* ③ 교전(P2) — 무기 사거리 안에 적이 있으면 멈춰 서서 쏜다. 이 한 규칙이 "만나면
         싸운다"를 만든다. 표적은 아래 fireAll이 이번 틱 자리로 다시 고른다.
         ★ 판정 ④ 정지 — 여기 거리도 중심-중심이라 reachOf(=모서리 사거리 + 두 몸
           반지름)로 재야 한다. 옛 코드는 무기 사거리(질럿 0.469타일)에 +0.5를 얹은
           값과 곧장 견줘, 질럿이 멈춰 설 자리에 영영 못 닿았다.
         쫓는 중이면 '목적지가 있다'는 이유로 교전에서 빠지면 안 된다 — 그러면 한 틱마다
         쫓기와 그만두기를 오가며 제자리에서 떤다. */
      const engaging = (b.aggro || b.chase !== 0 || !b.dest)
        && b.foe !== null && b.foe.state !== ST_GONE && b.foe.dieAt === null;
      const foeD = engaging ? dist(b.x, b.y, b.foe!.x, b.foe!.y) : Infinity;
      const fightingNow = engaging && foeD <= reachOf(b, b.foe!);
      if (fightingNow) {
        b.state = ST_FIGHT;
        // 멈춰 서서 쏘는 동안은 관성이 없다 — 다시 걸을 때 0에서 붙는다.
        b.vel = 0;
        const fx0 = b.foe!.x - b.x;
        const fy0 = b.foe!.y - b.y;
        if (fx0 * fx0 + fy0 * fy0 > 0.0001) {
          const want = norm360((Math.atan2(-fx0, fy0) * 180) / Math.PI);
          const diff = angDiff(b.hdg, want);
          const maxTurn = b.turn * dt;
          b.hdg = norm360(b.hdg + Math.max(-maxTurn, Math.min(maxTurn, diff)));
        }
        live.push(b);
        pushKey(b, t, b.keys.length === 0);
        b.px = b.x; b.py = b.y;
        continue;
      }
      /* ③-a 추격(과제 #48) — 획득 사거리 안에 들었지만 무기가 아직 안 닿으면 표적 쪽으로
         걸어간다. 질럿은 획득 3타일·무기 0.47타일이라 이 규칙이 없으면 3타일 밖에 서서
         영영 안 붙는다. 표적이 획득 사거리를 벗어나면 쫓기를 그만두고 원래 목적지로
         돌아간다 — 안 그러면 부대가 도망가는 한 기에 끌려 지도를 가로지른다.
         땅속·수송 중인 것은 안 쫓는다(러커는 애초에 못 움직인다).
         길은 매 틱이 아니라 표적이 1.5타일 넘게 움직였을 때만 다시 낸다(길찾기 비용). */
      if (engaging && foeD <= seekTo(b, b.foe!) && !b.burrowed) {
        const fo = b.foe!;
        if (b.chase !== fo.tag || dist(b.chX, b.chY, fo.x, fo.y) > 1.5) {
          setDest(b, fo.x, fo.y);
          b.chase = fo.tag; b.chX = fo.x; b.chY = fo.y;
        }
        b.state = ST_MOVE;
      } else if (b.chase !== 0) {
        b.chase = 0;
        if (b.hasHome) { setDest(b, b.homeX, b.homeY); b.state = ST_MOVE; }
        else { b.dest = null; b.path = []; b.pi = 0; b.state = ST_IDLE; }
      }
      /* ③-b 채취(P3) — 명령이 없는 일꾼은 제 밭과 홀 사이를 오간다. 원작에서 이 순환은
         자동이라 리플레이에 명령으로 안 남는다: 시뮬이 모델하지 않으면 일꾼이 마지막
         명령 자리에 얼어붙는다(렌더의 왕복 어림이 하던 일을 여기로 옮겼다). */
      if (!b.dest && b.inside === null && b.wk) {
        if (!b.job) b.job = assignJob(b, t);
        if (b.job) {
          b.state = ST_GATHER;
          const j = b.job;
          /* 한 번 왕복의 차례(요청: 캐는 시간이 시작·종료 딜레이까지 정확해야) —
             ⓪ 밭으로 → ① 붙고 → ② 캐고 → ③ 떨어지고 → ④ 홀로 → ⑤ 반납.
             시간은 전부 bwUnits의 채취 상수 블록에서만 읽는다. */
          if (j.phase === 0 || j.phase === 4) {
            const toHall = j.phase === 4;
            const tx2 = toHall ? j.hx : j.px;
            const ty2 = toHall ? j.hy : j.py;
            const dx2 = tx2 - b.x;
            const dy2 = ty2 - b.y;
            const d2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1e-6;
            /* 밭도 홀도 '막힌 칸'이다(요청: 자원·건물 통과 불가) — 그 한가운데를 목표로
               두면 영영 못 닿는다. 이제 목표 자체가 두 발자국 사이 최단 선분의 끝이라
               건물 밖이지만, 남이 막고 섰을 때를 위해 막힘 도착은 그대로 둔다. */
            const go = Math.min(b.speed * dt, d2);
            const nx2 = b.x + (dx2 / d2) * go;
            const ny2 = b.y + (dy2 / d2) * go;
            if (d2 <= 0.4 || blockedAt(nx2, ny2, b.hw, b.hh)) {
              if (toHall) {
                j.phase = 5;
                j.wait = MINE_RETURN_FRAMES * FRAME_SEC;
              } else {
                /* 밭에 다다랐다 — **빈 자리일 때만** 붙는다(요청: 누가 캐고 있으면 못
                   붙고 기다린다). 임자면 이 자리에 선 채로 차례를 기다린다. */
                const held = claim.get(j.res);
                if (held === undefined || held.until <= t || held.tag === b.tag) {
                  j.phase = 1;
                  j.wait = MINE_ATTACH_FRAMES * FRAME_SEC;
                  /* 붙는 **그 순간** 잠근다 — 같은 틱에 둘이 도착해도 몸 훑기는 차례
                     대로라, 먼저 온 쪽이 여기서 잠그면 뒤엣것은 위 검사에서 걸린다.
                     아래에서 매 틱 갱신하지만 첫 잠금이 여기 없으면 한 틱 동안 둘 다
                     붙어 버린다. */
                  claim.set(j.res, { tag: b.tag, until: t + j.wait + 0.5 });
                }
              }
            } else {
              b.x = nx2;
              b.y = ny2;
              const want2 = norm360((Math.atan2(-dx2, dy2) * 180) / Math.PI);
              const diff2 = angDiff(b.hdg, want2);
              const mt2 = b.turn * dt;
              b.hdg = norm360(b.hdg + Math.max(-mt2, Math.min(mt2, diff2)));
            }
          } else {
            j.wait -= dt;
            /* 붙어 있는 세 동안(①②③)은 그 자원이 내 것이다 — 만료를 늘 '지금부터
               남은 시간'으로 새로 써, 도중에 죽거나 명령을 받아 떠나면 저절로 풀린다. */
            if (j.phase <= 3) claim.set(j.res, { tag: b.tag, until: t + Math.max(0, j.wait) + 0.5 });
            /* 가스는 정제소 **안에서** 캔다(요청: 가스 일꾼은 들어가서 안 보였다가
               나와야) — 뽑는 동안만 안이고, 붙고 떨어지는 딜레이에는 문 앞에 서 있다.
               ST_INSIDE는 렌더가 안 그리는 상태다(수송선 안과 같은 뜻). */
            if (j.gas && j.phase === 2) {
              b.x = j.cx;
              b.y = j.cy;
              b.state = ST_INSIDE;
            }
            if (j.wait <= 0) {
              if (j.phase === 1) {
                j.phase = 2;
                j.wait = (j.gas ? MINE_GAS_FRAMES : MINE_MINERAL_FRAMES) * FRAME_SEC;
              } else if (j.phase === 2) {
                j.phase = 3;
                j.wait = MINE_DETACH_FRAMES * FRAME_SEC;
                // 가스는 문 앞으로 도로 나온다 — 여기서부터 다시 보인다.
                if (j.gas) { b.x = j.px; b.y = j.py; b.state = ST_GATHER; }
              } else if (j.phase === 3) {
                // 다 캤다 — 밭을 놓아 주고(기다리던 일꾼이 붙는다) 홀로 향한다.
                j.phase = 4;
                claim.delete(j.res);
              } else {
                j.phase = 0;
              }
            }
          }
          live.push(b);
          pushKey(b, t, b.keys.length === 0);
          b.px = b.x; b.py = b.y;
          continue;
        }
      }
      /* ④ 걸음 — 길 꼭짓점을 따라 제 속도로. 남은 거리보다 더 못 간다.
         옛 코드는 `b.speed * dt`를 목표 직선에 그대로 실어, 첫 틱부터 최고속으로 튀어
         나가고 즉시 섰다.
         ★ 가속은 **가속을 타는 유닛에만** 건다. flingy.dat movement_type이 2(iscript 구동)
         면 엔진이 가속·정지거리 필드를 아예 안 읽고 첫 틱부터 최고속이다 — 마린·파뱃·
         메딕·고스트·골리앗·탱크·마인 / 저글링·히드라·울트라·디파일러·러커·브루들링·
         인페스티드테란 / 질럿·드라군·다크템플러·리버·스캐럽이 전부 그쪽이라, 이들에게
         램프를 씌우는 것 자체가 원작 이탈이다(MOVE_DYN.accel이 0으로 그것을 말한다).
         램프를 타는 것은 공중 전부 + SCV·드론·프로브 + 벌처 + 아콘·다크아콘(ctrl 0) +
         하이템플러(ctrl 1)뿐이다.
         브레이크(halt)는 ctrl 0에만 있다 — 하이템플러는 halt_distance를 안 봐서 목적지
         에서 급정거한다. v² = 2·a·s가 벌처·SCV·레이스·전순 넷에서 덤프의 halt_distance와
         소수점까지 맞아떨어진 것이 이 감속식의 근거다(research-accel.md). */
      if (b.dest) {
        /* 마지막 구간은 길의 끝점이 아니라 제 목적지를 겨눈다 — 길 갈무리 열쇠가 정수
           반올림이라 남이 만든 길을 물려받으면 끝점이 최대 한 타일 남의 것이다. */
        const lastLeg0 = b.pi >= b.path.length - 1;
        const wx0 = lastLeg0 ? b.dest[0] : b.path[b.pi][0];
        const wy0 = lastLeg0 ? b.dest[1] : b.path[b.pi][1];
        let vTop = b.speed;
        if (b.accel > 0) {
          if (b.halt > 0) {
            const remain = dist(b.x, b.y, wx0, wy0)
              + (b.rem && b.pi < b.rem.length ? b.rem[b.pi] : 0);
            if (remain < b.halt) vTop = Math.min(vTop, Math.sqrt(2 * b.accel * remain));
          }
          const dv = b.accel * dt;
          b.vel = b.vel < vTop ? Math.min(vTop, b.vel + dv) : Math.max(vTop, b.vel - dv);
        } else {
          b.vel = vTop;   // ctrl 2 — 첫 틱부터 최고속. 원작이 그렇다.
        }
        let step0 = b.vel * dt;
        while (step0 > 0 && b.pi < b.path.length) {
          const lastLeg = b.pi >= b.path.length - 1;
          const wx = lastLeg ? b.dest[0] : b.path[b.pi][0];
          const wy = lastLeg ? b.dest[1] : b.path[b.pi][1];
          const dx = wx - b.x;
          const dy = wy - b.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d <= ARRIVE) { b.pi += 1; continue; }
          // 방향은 회전 속도 안에서만 돈다 — 상한은 원전 표(MOVE_DYN.turnBody)에서 온다.
          const want = norm360((Math.atan2(-dx, dy) * 180) / Math.PI);
          const diff = angDiff(b.hdg, want);
          const maxTurn = b.turn * dt;
          b.hdg = norm360(b.hdg + Math.max(-maxTurn, Math.min(maxTurn, diff)));
          // 크게 틀어야 하면 그만큼 천천히 나아간다(제자리 회전에 가깝게).
          const go = Math.min(step0, d) * (Math.abs(diff) > 90 ? 0.25 : 1);
          b.x += (dx / d) * go;
          b.y += (dy / d) * go;
          step0 -= go;
          break;
        }
        if (b.pi >= b.path.length) {
          /* 목적지에 닿으면 '돌아갈 자리'도 없앤다 — 남겨 두면 추격이 끝날 때마다 이미
             다 온 자리로 다시 걸어간다.
             ★ 여기서 b.vel은 **안 지운다.** 처음엔 0으로 지웠는데, 그러면 증거가 촘촘한
               개체(일꾼이 그렇다)는 명령이 이어질 때마다 램프를 처음부터 다시 타서 실제
               보다 늘 느렸다. 원작에서 다음 이동 명령이 곧장 이어지면 유닛은 서지 않는다
               — 서는 것은 명령이 끊겼을 때다. 지우기를 그만두니 tracks 중앙이
               3.36 → 3.20으로 내려갔다. 대신 '오래 서 있다가 다시 걷는' 유닛이 옛 속도로
               출발하는 구멍이 남는다. 서 있는 동안 속도를 감쇠시키는 자리가 아직 없다. */
          b.dest = null; b.state = ST_IDLE; b.hasHome = false;
        }
      }


      // ⑤ 밀어내기 — 같은 편끼리만. 겹쳐 선 채 한 몸으로 움직이지 않게.
      if (!b.air) {
        const cx = Math.floor(b.x / CELL);
        const cy = Math.floor(b.y / CELL);
        const key = (cy < 0 ? 0 : cy >= gh ? gh - 1 : cy) * gw
          + (cx < 0 ? 0 : cx >= gw ? gw - 1 : cx);
        const arr = cells[key];
        if (arr.length === 0) cTouch.push(key);
        arr.push(b);
      }
      live.push(b);
      pushKey(b, t, b.keys.length === 0);
      b.px = b.x; b.py = b.y;
    }
    /* 마법은 몸들이 이번 틱 자리를 다 잡은 **뒤에** 건다(fireAll 바로 앞) — 틱 머리에
       두었더니 그 자리에서 live가 방금 비워진 참이라, 스톰이 아무도 못 때리고 인스네어가
       아무도 안 적셨다(실측: 스톰 30발이 사망 수를 1도 안 바꿨다). */
    /* 이번 틱까지 떨어진 마법을 건다 — 스웜은 판에 얹고, 인스네어는 적을 적시고,
       매트릭스는 제 편 하나를 감싼다. 나머지 기술(스톰·플레이그·이래디에이트 등)은
       피해를 직접 주는 것이라 이 자리가 아니다. */
    while (castI < castsSorted.length && castsSorted[castI][0] <= t) {
      const [csec, cx, cy, tech, cpid] = castsSorted[castI];
      castI += 1;
      if (tech === "Dark Swarm") { swarms.push([csec + DARK_SWARM_SEC, cx, cy]); continue; }
      if (tech === "Psionic Storm") {
        for (let pi = 0; pi < STORM_PULSES; pi += 1) {
          stormPulsesDue.push([csec + pi * STORM_PULSE_SEC, cx, cy]);
        }
        stormPulsesDue.sort((p1, p2) => p1[0] - p2[0]);
        continue;
      }
      if (tech !== "Ensnare" && tech !== "Defensive Matrix") continue;
      if (tech === "Ensnare") {
        for (const o of live) {
          if (o.owner === cpid) continue;
          if (Math.abs(o.x - cx) <= ENSNARE_TILES && Math.abs(o.y - cy) <= ENSNARE_TILES) {
            o.ensnaredUntil = Math.max(o.ensnaredUntil, csec + ENSNARE_SEC);
          }
        }
        continue;
      }
      // 매트릭스는 표적 하나 — 시전 자리에 가장 가까운 제 편을 감싼다.
      let best: Body | null = null;
      let bd = MATRIX_SNAP_TILES;
      for (const o of live) {
        if (o.owner !== cpid || o.bld) continue;
        const dd = dist(cx, cy, o.x, o.y);
        if (dd <= bd) { bd = dd; best = o; }
      }
      if (best) { best.dmg.matrixHp = MATRIX_HP * 256; best.matrixUntil = csec + MATRIX_SEC; }
    }
    /* 스톰 박자 — 반경 안의 **모두**를 때린다(radial, 시전자 본인 포함). 편을 안 가리는
       것이 원작이고, 그래서 스톰 위에 선 아군도 녹는다. */
    while (stormI < stormPulsesDue.length && stormPulsesDue[stormI][0] <= t) {
      const [, sx, sy] = stormPulsesDue[stormI];
      stormI += 1;
      for (const o of live) {
        if (o.bld) continue;                 // 건물은 스톰을 안 맞는다
        if (dist(sx, sy, o.x, o.y) > STORM_TILES) continue;
        stormPulse(o.dmg);
        if (o.dmg.hp <= 0 && o.dieAt === null) {
          o.dmg.hp = 0;
          o.dieAt = Math.max(t, o.aliveUntil);
          if (o.dieAt > t) saved += 1;
          kills += 1;
          /* 죽인 자를 -1로 남긴다 — 0은 '증거가 시켜 죽었다'는 뜻으로 이미 쓰이고 있어
             (아래 dieBy 갈래) 자리 마법의 죽음을 거기 섞으면, 시뮬이 제 힘으로 낸 죽음이
             떠먹은 죽음으로 집계된다(#68의 자력 사망률이 그것을 가른다). */
          events.push(o.dieAt, EV_DIE, o.tag, -1,
            Math.round(o.x * 10) / 10, Math.round(o.y * 10) / 10, 0, 0);
        }
      }
    }
    // 다 꺼진 스웜은 걷는다 — 훑는 목록을 짧게 유지한다.
    for (let si = swarms.length - 1; si >= 0; si -= 1) if (swarms[si][0] < t) swarms.splice(si, 1);
    fireAll(t);
    /* 죽은 몸은 제자리에서 걷어낸다(과제 #70) — filter는 죽음이 난 틱마다 개체 수만 한
       배열을 새로 잡았고, 중반 이후엔 그게 거의 매 틱이라 쓰레기가 산더미였다. */
    if (dropped) {
      let wq = 0;
      for (let i = 0; i < active.length; i += 1) {
        if (active[i].state !== ST_GONE) { active[wq] = active[i]; wq += 1; }
      }
      active.length = wq;
    }

    // 밀어내기는 이번 틱 자리가 다 정해진 뒤에 한 번(순서에 안 흔들리게).
    for (let ci = 0; ci < cTouch.length; ci += 1) {
      const arr = cells[cTouch[ci]];
      for (let i = 0; i < arr.length; i += 1) {
        for (let j = i + 1; j < arr.length; j += 1) {
          const a = arr[i];
          const c = arr[j];
          /* 유닛끼리도 통과 불가(요청) — 편을 안 가린다. 다만 자원을 캐는 일꾼끼리는
             겹칠 수 있다(원작에서도 캐는 일꾼은 서로를 통과한다). */
          if (a.state === ST_GATHER && c.state === ST_GATHER) continue;
          const rr = a.rad + c.rad;
          const dx = c.x - a.x;
          const dy = c.y - a.y;
          const q = dx * dx + dy * dy;
          if (q >= rr * rr || q < 1e-8) continue;
          const d = Math.sqrt(q);
          /* 밀리는 몫은 '가는 쪽'이 더 진다 — 원작 지상 유닛은 서로를 밀지 못하고, 선
             유닛은 그냥 장애물이다. 선 쪽을 거의 안 밀어야 교전선·대기 대형이 안 흐르고,
             미는 쪽만 옆으로 흘러 저절로 돌아간다(그 흘러남이 곧 jam을 세워 비켜 돌기로
             이어진다). 완전히 0으로 안 두는 것은 겹친 채 굳는 것을 막는 여유다. */
          const am = a.state === ST_MOVE ? 1 : 0.15;
          const cm = c.state === ST_MOVE ? 1 : 0.15;
          const pa = ((rr - d) * am) / (am + cm);
          const pc = ((rr - d) * cm) / (am + cm);
          const ax2 = a.x - (dx / d) * pa;
          const ay2 = a.y - (dy / d) * pa;
          const cx2 = c.x + (dx / d) * pc;
          const cy2 = c.y + (dy / d) * pc;
          if (a.air || !blockedAt(ax2, ay2, a.hw, a.hh)) { a.x = ax2; a.y = ay2; }
          if (c.air || !blockedAt(cx2, cy2, c.hw, c.hh)) { c.x = cx2; c.y = cy2; }
        }
      }
    }
  }

  const tracks: SimTrack[] = [];
  let keys = 0;
  for (const b of bodies) {
    if (b.keys.length === 0) continue;
    keys += b.keys.length / 5;
    tracks.push({
      tag: b.tag, owner: b.owner, kind: b.kind,
      born: b.born, died: b.died, keys: Float32Array.from(b.keys),
    });
  }

  /* 사건을 시각순으로 정렬 — 미뤄 둔 죽음(dieAt)이 나중 시각으로 끼어들 수 있어서,
     렌더가 이분 탐색으로 훑으려면 순서가 맞아야 한다. */
  const EVW = 8;
  const order = Array.from({ length: events.length / EVW }, (_, i) => i)
    .sort((a, b2) => events[a * EVW] - events[b2 * EVW]);
  const sortedEvents: SimEventArr = new Float32Array(events.length);
  order.forEach((src, dst) => {
    for (let q = 0; q < EVW; q += 1) sortedEvents[dst * EVW + q] = events[src * EVW + q];
  });

  const sorted = [...drift].sort((a, b2) => a - b2);
  const at = (p: number): number =>
    sorted.length === 0 ? 0 : Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] * 100) / 100;

  return {
    tracks,
    events: sortedEvents,
    stats: {
      ticks, ents: bodies.length, keys, ms: Date.now() - t0,
      driftMedian: at(0.5), driftP90: at(0.9), anchors: drift.length,
      driftBadRate: sorted.length === 0 ? 0
        : Math.round((sorted.filter((d) => d > 1.5).length / sorted.length) * 1000) / 10,
      kills, saved, shots,
    },
  };
}

/** 자취에서 t 시각의 자리 — 렌더가 쓰는 유일한 조회다(이분 탐색 + 선형 보간). */
export function posAtSim(
  tr: SimTrack, t: number,
): { x: number; y: number; hdg: number; state: SimState } | null {
  const n = tr.keys.length / 5;
  if (n === 0) return null;
  if (t < tr.keys[0]) return null;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tr.keys[mid * 5] <= t) lo = mid; else hi = mid - 1;
  }
  const i = lo * 5;
  const st = tr.keys[i + 4] as SimState;
  if (lo === n - 1) return { x: tr.keys[i + 1], y: tr.keys[i + 2], hdg: tr.keys[i + 3], state: st };
  const j = i + 5;
  const span = tr.keys[j] - tr.keys[i];
  const u = span > 0 ? Math.min(1, Math.max(0, (t - tr.keys[i]) / span)) : 0;
  let dh = angDiff(tr.keys[i + 3], tr.keys[j + 3]);
  return {
    x: tr.keys[i + 1] + (tr.keys[j + 1] - tr.keys[i + 1]) * u,
    y: tr.keys[i + 2] + (tr.keys[j + 2] - tr.keys[i + 2]) * u,
    hdg: norm360(tr.keys[i + 3] + dh * u),
    state: st,
  };
}

/** 사건 배열의 한 칸 폭 — [t, 갈래, 주체, 표적, x, y, tx, ty]. */
export const EVENT_STRIDE = 8;

/** events에서 시각 t 이하의 첫 자리(이분 탐색) — 렌더가 창을 훑는 시작점. */
function lowerBound(events: SimEventArr, t: number): number {
  let lo = 0;
  let hi = events.length / EVENT_STRIDE;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid * EVENT_STRIDE] < t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** [t-win, t] 창의 발사 — 태그마다 마지막 한 발(표적 자리)만. 트레이서를 그리는 재료다. */
export function shotsAt(
  events: SimEventArr, t: number, win: number,
): Map<number, [number, number]> {
  const out = new Map<number, [number, number]>();
  let i = lowerBound(events, t - win);
  const n = events.length / EVENT_STRIDE;
  for (; i < n; i += 1) {
    const o = i * EVENT_STRIDE;
    if (events[o] > t) break;
    if (events[o + 1] !== EV_FIRE) continue;
    out.set(events[o + 2], [events[o + 6], events[o + 7]]);
  }
  return out;
}
