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

import { groundPath, type TerrainGrid } from "./minimapTerrain";
import {
  DEFAULT_TURN_RATE, TURN_RATE, UNIT_ARMOR, UNIT_SIZE, WEAPON_AIR, WEAPON_GROUND,
  damageOf, isAir, speedOfUnit, type UnitSize, type Weapon,
} from "./bwUnits";
import { BLD_STATS, UNIT_STATS } from "./replayUnits";

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
};

/* ── 출력 ─────────────────────────────────────────────────────────────────────── */

/** 상태 — 렌더가 무엇을 그릴지 가르는 값. P2에서 fight/attack이 는다. */
export type SimState = 0 | 1 | 2 | 3 | 4;
export const ST_IDLE: SimState = 0;
export const ST_MOVE: SimState = 1;
export const ST_INSIDE: SimState = 2;   // 수송선 안 — 안 그린다
export const ST_GONE: SimState = 3;
export const ST_FIGHT: SimState = 4;    // 멈춰 서서 쏘는 중(P2)

/** 전투 사건 — [초, 갈래, 주체 태그, 표적 태그, x, y, tx, ty]. 갈래 0 발사 1 죽음. */
export type SimEventArr = number[];
export const EV_FIRE = 0;
export const EV_DIE = 1;

export type SimTrack = {
  tag: number; owner: number; kind: string;
  born: number; died: number | null;
  /** 키프레임 평탄 배열 — 5개씩 [t, x, y, heading(도), state]. */
  keys: number[];
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
};

/* ── 상수 ─────────────────────────────────────────────────────────────────────── */

/** 한 틱 — 원작 23.81fps의 3프레임. 공격 쿨다운(8~30프레임)이 뭉개지지 않는 눈금. */
export const TICK_SEC = 3 / 23.81;
/** 도착 판정(타일). */
const ARRIVE = 0.35;
/** 같은 편끼리 밀어내는 반경(타일) — 원작의 뭉치고 흐르는 모양을 이것이 만든다. */
const SEP_R = 0.75;
/** 하드 앵커에서 이만큼 넘게 어긋나면 보정한다(타일). */
const ANCHOR_SNAP = 1.2;
/** 보정을 녹여 넣는 시간(초) — 순간이동으로 고치지 않는다. */
const ANCHOR_FIX_SEC = 2.5;

/* ── 주문 ─────────────────────────────────────────────────────────────────────── */

type OrdKind = "move" | "attack" | "anchor" | "board" | "unload" | "gone";
type Ord = { t: number; kind: OrdKind; x: number; y: number; tag: number };

/** 증거를 주문으로 옮긴다 — 자리 없는 증거(생산·랠리·클로킹)는 이동과 무관하니 뺀다. */
function ordersOf(e: SimEnt): Ord[] {
  const out: Ord[] = [];
  for (const v of e.ev) {
    const [s, x, y, f, extra] = v;
    if (f === 12) { out.push({ t: s, kind: "board", x, y, tag: extra ?? 0 }); continue; }
    if (x < 0) continue;
    if (f === 13) { out.push({ t: s, kind: "unload", x, y, tag: 0 }); continue; }
    // 남이 찍은 자리·건설 자리·착륙 자리·출생은 '그때 정말 거기 있었다'는 하드 앵커다.
    if (f === 1 || f === 2 || f === 3 || f === 5) {
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
  state: SimState;
  ords: Ord[]; oi: number;
  /** 지금 목적지와 남은 길(꼭짓점, 타일 좌표). */
  dest: [number, number] | null; path: [number, number][]; pi: number;
  /** 수송선 태그(안에 있을 때). */
  inside: number | null;
  /** 앵커 보정 — 남은 벡터와 남은 시간. */
  fixX: number; fixY: number; fixT: number;
  keys: number[];
  /** 마지막으로 찍은 키의 자리·방향·시각과 그때의 속도(직선 예측 단순화에 쓴다). */
  kx: number; ky: number; kh: number; ks: SimState; kt: number; kvx: number; kvy: number;
  /** 지난 틱의 자리 — 이번 틱 속도를 재는 자. */
  px: number; py: number;
  /* ── 전투(P2) ── */
  bld: boolean;
  hp: number; sh: number; maxHp: number; armor: number; size: UnitSize;
  wg: Weapon | null; wa: Weapon | null;
  cd: number;                 // 남은 쿨다운(초)
  foe: Body | null;
  /* 지금 명령이 어택인가 — 원작에서 '그냥 이동'은 적을 만나도 안 멈춘다. 이 한 칸이
     "행군하다 아무 건물에나 붙어 서는" 문제를 막는다. */
  aggro: boolean;
  /** 표적을 다시 고를 시각 — 매 틱 훑지 않게(비용). */
  reacq: number;
  /** 죽을 시각이 정해졌는가 — 증거가 보장한 생존 하한까지 미뤄 둔 죽음. */
  dieAt: number | null;
  /** 증거가 보장하는 생존 하한 — 이 시각까지는 절대 안 죽는다(제약이 시뮬을 이긴다). */
  aliveUntil: number;
  /** 분석이 말한 죽음 — 시뮬이 그때까지 못 죽였으면 여기서 죽는다(상한). */
  dieBy: number | null;
};

/** 일꾼 — 스스로 표적을 잡지 않는다. */
const WORKERS = new Set(["SCV", "Probe", "Drone"]);

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
      const spot = [...e.ev].reverse().find((v) => (v[3] === 2 || v[3] === 5) && v[1] >= 0);
      if (!spot) continue;
      const bs = BLD_STATS[e.k ?? ""] ?? [800, 0];
      const bb: Body = {
        src: e, tag: e.t, owner: e.o, kind: e.k ?? "", air: false,
        speed: 0, turn: 0, born: spot[0], died: e.d ?? null,
        x: spot[1], y: spot[2], hdg: 180, state: ST_IDLE,
        ords: [], oi: 0, dest: null, path: [], pi: 0, inside: null,
        fixX: 0, fixY: 0, fixT: 0, keys: [],
        kx: NaN, ky: NaN, kh: NaN, ks: ST_GONE, kt: 0, kvx: 0, kvy: 0, px: NaN, py: NaN,
        bld: true,
        hp: bs[0] + bs[1], sh: bs[1], maxHp: bs[0] + bs[1],
        armor: 1, size: "large",
        wg: WEAPON_GROUND[e.k ?? ""] ?? null, wa: WEAPON_AIR[e.k ?? ""] ?? null,
        cd: 0, foe: null, aggro: true, reacq: 0, dieAt: null,
        aliveUntil: e.ev.length > 0 ? e.ev[e.ev.length - 1][0] : spot[0],
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
    const b: Body = {
      src: e,
      tag: e.t, owner: e.o, kind, air: isAir(kind),
      speed: speedOfUnit(kind, e.ups), turn: TURN_RATE[kind] ?? DEFAULT_TURN_RATE,
      born: e.b, died: e.d ?? null,
      x: first ? first.x : W / 2, y: first ? first.y : H / 2, hdg: 180,
      state: ST_IDLE,
      ords, oi: 0,
      dest: null, path: [], pi: 0,
      inside: null,
      fixX: 0, fixY: 0, fixT: 0,
      keys: [],
      kx: NaN, ky: NaN, kh: NaN, ks: ST_GONE, kt: 0, kvx: 0, kvy: 0,
      px: NaN, py: NaN,
      bld: false,
      hp: (UNIT_STATS[kind]?.hp ?? 70) + (UNIT_STATS[kind]?.sh ?? 0),
      sh: UNIT_STATS[kind]?.sh ?? 0,
      maxHp: (UNIT_STATS[kind]?.hp ?? 70) + (UNIT_STATS[kind]?.sh ?? 0),
      armor: UNIT_ARMOR[kind] ?? 0, size: UNIT_SIZE[kind] ?? "medium",
      wg: WEAPON_GROUND[kind] ?? null, wa: WEAPON_AIR[kind] ?? null,
      cd: 0, foe: null, aggro: false, reacq: 0, dieAt: null,
      /* 증거가 보장하는 생존 하한 — 명령을 받은 태그는 그 순간 확실히 살아 있다.
         시뮬이 그 전에 죽이려 들면 시뮬이 틀린 것이므로 체력 1로 버틴다. */
      aliveUntil: e.ev.length > 0 ? e.ev[e.ev.length - 1][0] : e.b,
      dieBy: e.d ?? null,
    };
    bodies.push(b);
    const arr = byTag.get(b.tag) ?? [];
    arr.push(b);
    byTag.set(b.tag, arr);
    const last = ords.length > 0 ? ords[ords.length - 1].t : e.b;
    endSec = Math.max(endSec, b.died ?? last);
  }

  /* 길찾기 캐시 — 같은 두 점을 여러 유닛이 함께 쓴다(부대 이동). */
  const pathCache = new Map<string, [number, number][]>();
  const findPath = (x0: number, y0: number, x1: number, y1: number): [number, number][] => {
    if (!terrain) return [[x1, y1]];
    const key = `${Math.round(x0)},${Math.round(y0)},${Math.round(x1)},${Math.round(y1)}`;
    const hit = pathCache.get(key);
    if (hit) return hit;
    const got = groundPath(terrain, x0 / W, y0 / H, x1 / W, y1 / H);
    const pts: [number, number][] = got
      ? got.map(([fx, fy]) => [fx * W, fy * H] as [number, number])
      : [[x1, y1]];
    if (pathCache.size > 20000) pathCache.clear();
    pathCache.set(key, pts);
    return pts;
  };

  const setDest = (b: Body, x: number, y: number): void => {
    b.dest = [x, y];
    b.path = b.air ? [[x, y]] : findPath(b.x, b.y, x, y);
    b.pi = 0;
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
      if (Math.hypot(pdx, pdy) < eps && turned < 30 && b.state === b.ks) return;
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
  const cells = new Map<number, Body[]>();

  /* ── 전투(P2) ────────────────────────────────────────────────────────────────
     표적 찾기는 균일 격자로 이웃만 훑는다. 사거리(reachOf)는 공중·지상에 따라 무기가
     갈리고, 못 치는 갈래는 아예 표적이 아니다. */
  const events: SimEventArr = [];
  const live: Body[] = [];
  let kills = 0;
  let saved = 0;
  let shots = 0;
  /** 두 점 사이 거리 — 뜨거운 자리에서 Math.hypot은 V8에서 몇 배 느리다. */
  const dist = (ax: number, ay: number, bx: number, by: number): number => {
    const dx = bx - ax;
    const dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
  };
  const weaponFor = (a: Body, tgt: Body): Weapon | null => (tgt.air ? a.wa : a.wg);
  const reachOf = (a: Body, tgt: Body): number => weaponFor(a, tgt)?.range ?? -1;
  /** 표적 격자 — 이번 틱의 산 개체를 셀에 담는다. 셀 4타일이면 사거리 8까지 이웃 5칸. */
  const TCELL = 4;
  const tgw = Math.ceil(W / TCELL) + 1;
  const tcells = new Map<number, Body[]>();

  const hurt = (a: Body, tgt: Body, w: Weapon, t: number): void => {
    const dmg = damageOf(w, tgt.size, tgt.armor, tgt.sh > 0);
    if (tgt.sh > 0) tgt.sh = Math.max(0, tgt.sh - dmg);
    tgt.hp -= dmg;
    if (tgt.hp > 0 || tgt.state === ST_GONE || tgt.dieAt !== null) return;
    /* 증거가 시뮬을 이긴다 — 명령을 받은 태그는 그때 확실히 살아 있었다. 그렇다고 체력
       1로 영영 버티게 두면 그 유닛이 총알을 다 빨아들이는 스펀지가 된다. 죽을 시각만
       증거의 하한까지 미뤄 두고, 표적으로도 더는 안 잡히게 한다. */
    tgt.hp = 0;
    tgt.dieAt = Math.max(t, tgt.aliveUntil);
    if (tgt.dieAt > t) saved += 1;
    kills += 1;
    events.push(tgt.dieAt, EV_DIE, tgt.tag, a.tag,
      Math.round(tgt.x * 10) / 10, Math.round(tgt.y * 10) / 10, 0, 0);
  };

  const fireAll = (t: number): void => {
    tcells.clear();
    for (const b of live) {
      const k = Math.floor(b.y / TCELL) * tgw + Math.floor(b.x / TCELL);
      const arr = tcells.get(k);
      if (arr) arr.push(b); else tcells.set(k, [b]);
    }
    for (const a of live) {
      if (a.cd > 0) a.cd -= dt;
      if (!a.wg && !a.wa) continue;
      // 일꾼은 스스로 싸우러 가지 않는다 — 어택 명령을 콕 받았을 때만.
      if (!a.bld && !a.aggro && WORKERS.has(a.kind)) continue;
      const maxR = Math.max(a.wg?.range ?? -1, a.wa?.range ?? -1);
      /* 표적 다시 고르기 — 지금 표적이 살아 있고 사거리 안이면 그대로, 아니면 가장 가까운
         적. 매 틱 다시 고르지 않는 이유는 표적이 프레임마다 튀면 몸이 흔들리기 때문이다. */
      let f = a.foe;
      if (f && (f.state === ST_GONE || f.dieAt !== null
        || dist(a.x, a.y, f.x, f.y) > reachOf(a, f) + 1.5)) f = null;
      if (!f && t >= a.reacq) {
        a.reacq = t + 0.5;
        let bd = Infinity;
        const cx = Math.floor(a.x / TCELL);
        const cy = Math.floor(a.y / TCELL);
        const rad = Math.ceil((maxR + 1) / TCELL);
        for (let dy2 = -rad; dy2 <= rad; dy2 += 1) {
          for (let dx2 = -rad; dx2 <= rad; dx2 += 1) {
            const arr = tcells.get((cy + dy2) * tgw + (cx + dx2));
            if (!arr) continue;
            for (const c of arr) {
              if (c.owner === a.owner || c.state === ST_GONE || c.dieAt !== null) continue;
              const r = reachOf(a, c);
              if (r < 0) continue;
              const d = dist(a.x, a.y, c.x, c.y);
              if (d > r + 0.5 || d >= bd) continue;
              bd = d; f = c;
            }
          }
        }
      }
      a.foe = f;
      if (!f || a.cd > 0) continue;
      const w = weaponFor(a, f);
      if (!w) continue;
      if (dist(a.x, a.y, f.x, f.y) > w.range + 0.5) continue;
      a.cd = w.cd;
      shots += 1;
      events.push(t, EV_FIRE, a.tag, f.tag, Math.round(a.x * 10) / 10, Math.round(a.y * 10) / 10,
        Math.round(f.x * 10) / 10, Math.round(f.y * 10) / 10);
      hurt(a, f, w, t);
      // 스플래시 — 표적 둘레의 적도 함께(아군 오폭은 P2 뒤 검토, 지금은 안 넣는다).
      if (w.splash) {
        const cx = Math.floor(f.x / TCELL);
        const cy = Math.floor(f.y / TCELL);
        for (let dy2 = -1; dy2 <= 1; dy2 += 1) {
          for (let dx2 = -1; dx2 <= 1; dx2 += 1) {
            const arr = tcells.get((cy + dy2) * tgw + (cx + dx2));
            if (!arr) continue;
            for (const c of arr) {
              if (c === f || c.owner === a.owner || c.state === ST_GONE) continue;
              if (dist(f.x, f.y, c.x, c.y) > w.splash) continue;
              hurt(a, c, w, t);
            }
          }
        }
      }
    }
  };

  for (let k = 0; k <= ticks; k += 1) {
    const t = k * dt;
    cells.clear();
    live.length = 0;

    for (const b of bodies) {
      if (t < b.born) continue;
      if (b.died !== null && t >= b.died) {
        if (b.state !== ST_GONE) { b.state = ST_GONE; pushKey(b, b.died, true); }
        continue;
      }
      if (b.dieAt !== null && t >= b.dieAt) {
        b.died = b.dieAt; b.state = ST_GONE; pushKey(b, b.dieAt, true);
        continue;
      }
      /* 분석이 말한 죽음은 상한이다 — 시뮬이 그때까지 못 죽였으면 여기서 죽는다.
         (아래 전투가 그보다 먼저 죽이면 그쪽이 이긴다.) */
      if (b.dieBy !== null && t >= b.dieBy && b.died === null) {
        b.died = b.dieBy; b.state = ST_GONE; pushKey(b, b.dieBy, true);
        events.push(b.dieBy, EV_DIE, b.tag, 0, Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10, 0, 0);
        continue;
      }
      if (b.state === ST_GONE) continue;

      if (b.bld) { live.push(b); pushKey(b, t, b.keys.length === 0); continue; }
      // ① 이번 틱에 온 주문 — 여럿이면 마지막 것이 지금의 명령이다.
      while (b.oi < b.ords.length && b.ords[b.oi].t <= t) {
        const o = b.ords[b.oi];
        b.oi += 1;
        if (o.kind === "board") { b.inside = o.tag; b.state = ST_INSIDE; b.dest = null; continue; }
        if (o.kind === "unload") {
          b.inside = null; b.x = o.x; b.y = o.y; b.dest = null; b.state = ST_IDLE;
          continue;
        }
        if (o.kind === "anchor") {
          const d = Math.hypot(o.x - b.x, o.y - b.y);
          if (b.keys.length === 0) {
            // 출생 자리는 그냥 거기서 시작한다 — 통계에 넣으면 늘 0이라 뜻이 없다.
            b.x = o.x; b.y = o.y;
          } else {
            drift.push(d);
            if (d > ANCHOR_SNAP) {
            /* 순간이동으로 고치지 않는다 — 어긋남을 다음 몇 초의 걸음에 녹인다. */
              b.fixX = o.x - b.x; b.fixY = o.y - b.y; b.fixT = ANCHOR_FIX_SEC;
            }
          }
          continue;
        }
        if (b.inside !== null) continue;   // 배 안에서 받은 명령은 내린 뒤에 쓴다(P4)
        setDest(b, o.x, o.y);
        b.aggro = o.kind === "attack";
        b.state = ST_MOVE;
      }

      // ② 배 안이면 배를 따라간다 — 제 걸음이 없다.
      if (b.inside !== null) {
        const ship = (byTag.get(b.inside) ?? []).find((s) => t >= s.born && (s.died === null || t < s.died));
        if (ship) { b.x = ship.x; b.y = ship.y; }
        pushKey(b, t, false);
        continue;
      }

      /* ③ 교전(P2) — 사거리 안에 적이 있으면 멈춰 서서 쏜다. 이 한 규칙이 "만나면
         싸운다"를 만든다. 표적은 아래 fireAll이 이번 틱 자리로 다시 고른다. */
      const fightingNow = (b.aggro || !b.dest) && b.foe !== null && b.foe.state !== ST_GONE
        && dist(b.x, b.y, b.foe.x, b.foe.y) <= reachOf(b, b.foe) + 0.5;
      if (fightingNow) {
        b.state = ST_FIGHT;
        const fx0 = b.foe!.x - b.x;
        const fy0 = b.foe!.y - b.y;
        if (Math.hypot(fx0, fy0) > 0.01) {
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
      // ④ 걸음 — 길 꼭짓점을 따라 제 속도로. 남은 거리보다 더 못 간다.
      let step = b.speed * dt;
      if (b.dest) {
        while (step > 0 && b.pi < b.path.length) {
          const [wx, wy] = b.path[b.pi];
          const dx = wx - b.x;
          const dy = wy - b.y;
          const d = Math.hypot(dx, dy);
          if (d <= ARRIVE) { b.pi += 1; continue; }
          // 방향은 회전 속도 안에서만 돈다 — 몸을 돌리고 나서 간다.
          const want = norm360((Math.atan2(-dx, dy) * 180) / Math.PI);
          const diff = angDiff(b.hdg, want);
          const maxTurn = b.turn * dt;
          b.hdg = norm360(b.hdg + Math.max(-maxTurn, Math.min(maxTurn, diff)));
          // 크게 틀어야 하면 그만큼 천천히 나아간다(제자리 회전에 가깝게).
          const go = Math.min(step, d) * (Math.abs(diff) > 90 ? 0.25 : 1);
          b.x += (dx / d) * go;
          b.y += (dy / d) * go;
          step -= go;
          break;
        }
        if (b.pi >= b.path.length) { b.dest = null; b.state = ST_IDLE; }
      }

      // ④ 앵커 보정 — 남은 몫을 시간에 걸쳐 조금씩.
      if (b.fixT > 0) {
        const f = Math.min(1, dt / b.fixT);
        b.x += b.fixX * f; b.y += b.fixY * f;
        b.fixX -= b.fixX * f; b.fixY -= b.fixY * f;
        b.fixT -= dt;
      }

      // ⑤ 밀어내기 — 같은 편끼리만. 겹쳐 선 채 한 몸으로 움직이지 않게.
      if (!b.air) {
        const cx = Math.floor(b.x / CELL);
        const cy = Math.floor(b.y / CELL);
        const key = cy * gw + cx;
        const arr = cells.get(key);
        if (arr) arr.push(b); else cells.set(key, [b]);
      }
      live.push(b);
      pushKey(b, t, b.keys.length === 0);
      b.px = b.x; b.py = b.y;
    }
    fireAll(t);

    // 밀어내기는 이번 틱 자리가 다 정해진 뒤에 한 번(순서에 안 흔들리게).
    for (const arr of cells.values()) {
      for (let i = 0; i < arr.length; i += 1) {
        for (let j = i + 1; j < arr.length; j += 1) {
          const a = arr[i];
          const c = arr[j];
          if (a.owner !== c.owner) continue;
          const dx = c.x - a.x;
          const dy = c.y - a.y;
          const d = Math.hypot(dx, dy);
          if (d >= SEP_R || d < 1e-4) continue;
          const push = (SEP_R - d) / 2;
          a.x -= (dx / d) * push; a.y -= (dy / d) * push;
          c.x += (dx / d) * push; c.y += (dy / d) * push;
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
      born: b.born, died: b.died, keys: b.keys,
    });
  }

  /* 사건을 시각순으로 정렬 — 미뤄 둔 죽음(dieAt)이 나중 시각으로 끼어들 수 있어서,
     렌더가 이분 탐색으로 훑으려면 순서가 맞아야 한다. */
  const EVW = 8;
  const order = Array.from({ length: events.length / EVW }, (_, i) => i)
    .sort((a, b2) => events[a * EVW] - events[b2 * EVW]);
  const sortedEvents: SimEventArr = new Array(events.length);
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
