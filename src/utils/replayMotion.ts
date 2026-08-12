import type { ParsedReplay } from "./replayParser";
import { AIR_UNITS, CASTER_UNITS, NOT_ARMY } from "./replayBuildMix";

/* ── 연속 재생용 모션 트랙(요청: 장면 선정 없이 전부 연속으로) ─────────────────────
   스냅(beat) 방식은 등록 때 장면을 골라 저장하고 그 사이를 건너뛰었다. 연속 재생은 원본
   명령 스트림이 필요한데, 그건 파싱 순간에만 있고 버려진다 — 그래서 여기서 시간축으로
   솎아(다운샘플) 요약(summaryData.motion)에 함께 저장한다. beat는 그대로 남는다(칭호
   집계·자막·BEST의 원장이다) — 재생 시각이 beat를 지날 때 자막이 뜨는 재료가 된다.

   좌표는 전부 타일이고(미니맵 마커·화살표와 같은 자), 시각은 초(정수)다. 판당 크기는
   버킷·중복 접기·상한을 거쳐 수십 KB 안쪽이다 — 명령 만 개짜리 팀전도 트랙은 수백 점이다. */

const SECONDS_PER_FRAME = 0.042;
/** 부대 자취의 버킷(초) — 이보다 촘촘한 움직임은 어차피 미니맵 픽셀로 뭉개진다. */
const STEP_SEC = 4;
/** 한 사람의 자취 상한 — 넘치면 버킷을 배로 키워 다시 접는다(40분 팀전 대비). */
const TRACK_CAP = 400;
/** 같은 자리로 치는 거리(타일) — 이 안에서 맴돈 버킷은 한 점으로 접는다. */
const SAME_SPOT_TILES = 3;
/** 부대 이름표가 너무 촐싹대지 않게, 우세 유닛이 바뀌어도 이만큼은 지나야 갈아 준다(초). */
const UNIT_HOLD_SEC = 10;
/** 일꾼 수의 버킷(초) — 매 마리마다 점을 찍으면 트랙만 굵어진다. */
const WORKER_STEP_SEC = 15;
/** 병력 규모의 버킷·창(초) — 최근 이 창 안의 생산 수를 규모로 본다(요청: 크기로 수를). */
const SIZE_STEP_SEC = 15;
const SIZE_WINDOW_SEC = 180;
const WORKER_UNITS = ["SCV", "Probe", "Drone"];
/* 건물 무너짐 어림(요청) — 상대의 공격 명령이 건물 반경(타일) 안에서 창(초) 동안 이만큼
   몰리면, 그 창의 끝을 무너진 때로 본다. 리플레이에 파괴가 안 남아 명령 밀도로 어림한다. */
const RAZE_RADIUS = 6;
const RAZE_WINDOW_SEC = 30;
const RAZE_MIN_ORDERS = 12;

/** 한 사람의 자취 — 원본 게임 아이디(raw)로 부른다(beats와 같은 규칙). */
export interface MotionTrack {
  raw: string;
  /** 게임 내 색(#rrggbb, 요청) — 재생 화면이 팀 2색 대신 이 색으로 칠한다. 없으면 팀 색. */
  color?: string;
  /** [초, x, y] — STEP_SEC 버킷의 마지막 명령 자리. 안 움직인 버킷은 접혀 있다. */
  pts: [number, number, number][];
  /** [초, 유닛 영문명] — 그때까지 가장 많이 뽑은 전투 유닛이 바뀐 순간들(이름표 재료). */
  units: [number, string][];
  /** [초, 누적 일꾼 수] — 자원 캐는 모습의 재료(요청). 생산 커맨드 누적이라 죽은 일꾼은
   *  못 뺀다(리플레이에 죽음이 없다) — "여태 뽑은 일꾼"으로 읽어야 한다. */
  workers: [number, number][];
  /** 유닛 영문명 → 생산 시각(초)들 — "생산할 때 건물 이름 켜기"(요청)의 재료다. 마린이
   *  나온 순간 그 사람 배럭이 일하고 있었다는 뜻이라, 건물 종류로 되짚는다. */
  prod: Record<string, number[]>;
  /** [초, 병력 규모] — 최근 3분 안에 뽑은 전투 유닛 수(요청: 뭉친 병력은 크기로 수를 표현).
   *  죽음을 모르니 '지금 서 있는 병력'이 아니라 '최근에 몰아 뽑은 규모'다 — 진군 직전에
   *  커지고 소강기에 줄어, 화면의 뜻(지금 움직이는 덩어리가 얼마나 큰가)과 결이 맞다. */
  size: [number, number][];
}

export interface SummaryMotion {
  v: 1;
  step: number;
  players: MotionTrack[];
  /** [초, x, y, 건물 영문명, raw, 무너진 초(0이면 살아 있음)] — 자리·시각은 건설 커맨드
   *  그대로 정확하고, 무너짐만 어림이다(요청: 파괴 파악) — 상대의 공격 명령이 그 자리에
   *  몰린 창의 끝을 무너진 때로 본다. */
  builds: [number, number, number, string, string, number][];
  /** [초, x, y, 기술 영문명, raw] — 좌표가 남는 마법(스톰·스웜·리콜…). */
  casts: [number, number, number, string, string][];
}

const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(ax - bx, ay - by);

/** 부대 자취 — 이동·공격 명령(건물 랠리 제외)을 버킷으로 접는다. */
function trackOf(
  orders: { frame: number; x: number; y: number; kind?: "attack" | "move"; by?: string }[],
): [number, number, number][] {
  const combat = orders.filter((o) => o.kind !== undefined && o.by !== "Building");
  let step = STEP_SEC;
  for (;;) {
    const byBucket = new Map<number, { sec: number; x: number; y: number }>();
    for (const o of combat) {
      const sec = o.frame * SECONDS_PER_FRAME;
      byBucket.set(Math.floor(sec / step), { sec: Math.round(sec), x: o.x, y: o.y });
    }
    const pts: [number, number, number][] = [];
    for (const key of [...byBucket.keys()].sort((a, b) => a - b)) {
      const p = byBucket.get(key)!;
      const last = pts[pts.length - 1];
      // 같은 자리에서 맴돈 버킷은 접는다 — 자취는 "어디로 갔나"지 "몇 번 찍었나"가 아니다.
      if (last && dist(last[1], last[2], p.x, p.y) < SAME_SPOT_TILES) continue;
      pts.push([p.sec, Math.round(p.x), Math.round(p.y)]);
    }
    if (pts.length <= TRACK_CAP) return pts;
    step *= 2;
  }
}

/** 우세 유닛 이름표의 변천 — 그때까지 가장 많이 뽑은 전투 유닛. */
function unitTimeline(unitFrames: Record<string, number[]>): [number, string][] {
  const events: { sec: number; unit: string }[] = [];
  for (const [unit, frames] of Object.entries(unitFrames)) {
    if (NOT_ARMY.has(unit)) continue;
    for (const f of frames) events.push({ sec: f * SECONDS_PER_FRAME, unit });
  }
  events.sort((a, b) => a.sec - b.sec);
  const counts = new Map<string, number>();
  const out: [number, string][] = [];
  let leader = "";
  let lastAt = -Infinity;
  for (const e of events) {
    counts.set(e.unit, (counts.get(e.unit) ?? 0) + 1);
    let top = leader;
    let topN = counts.get(leader) ?? 0;
    for (const [u, n] of counts) if (n > topN) { top = u; topN = n; }
    if (top !== leader && e.sec - lastAt >= UNIT_HOLD_SEC) {
      leader = top;
      lastAt = e.sec;
      out.push([Math.round(e.sec), top]);
    }
  }
  return out;
}

/** 누적 일꾼 수의 변천 — WORKER_STEP_SEC 버킷 끝의 값만 남긴다. */
function workerTimeline(unitFrames: Record<string, number[]>): [number, number][] {
  const frames = WORKER_UNITS.flatMap((u) => unitFrames[u] ?? []).sort((a, b) => a - b);
  if (frames.length === 0) return [];
  const out: [number, number][] = [];
  let n = 0;
  let bucket = -1;
  for (const f of frames) {
    n += 1;
    const sec = f * SECONDS_PER_FRAME;
    const b = Math.floor(sec / WORKER_STEP_SEC);
    if (b !== bucket) {
      bucket = b;
      out.push([Math.round(sec), n]);
    } else {
      out[out.length - 1] = [out[out.length - 1][0], n];
    }
  }
  return out;
}

/** 병력 규모의 변천 — SIZE_STEP_SEC 버킷마다 최근 SIZE_WINDOW_SEC 안의 전투 유닛 생산 수. */
function sizeTimeline(unitFrames: Record<string, number[]>): [number, number][] {
  const secs: number[] = [];
  for (const [unit, frames] of Object.entries(unitFrames)) {
    if (NOT_ARMY.has(unit)) continue;
    for (const f of frames) secs.push(f * SECONDS_PER_FRAME);
  }
  if (secs.length === 0) return [];
  secs.sort((a, b) => a - b);
  const out: [number, number][] = [];
  const lastSec = secs[secs.length - 1];
  let prev = -1;
  for (let t = 0; t <= lastSec + SIZE_WINDOW_SEC; t += SIZE_STEP_SEC) {
    const n = secs.filter((v) => v > t - SIZE_WINDOW_SEC && v <= t).length;
    if (n !== prev) {
      out.push([Math.round(t), n]);
      prev = n;
    }
  }
  return out;
}

/** 건물이 무너진 때의 어림 — 지은 뒤 상대 공격 명령이 그 자리에 몰린 첫 창의 끝(초).
 *  안 무너졌으면 0. */
function razedAt(
  builtSec: number, x: number, y: number,
  foeAttacks: { sec: number; x: number; y: number }[],
): number {
  const near = foeAttacks.filter(
    (o) => o.sec > builtSec && Math.hypot(o.x - x, o.y - y) <= RAZE_RADIUS,
  );
  for (let i = 0; i < near.length; i += 1) {
    let j = i;
    while (j + 1 < near.length && near[j + 1].sec - near[i].sec <= RAZE_WINDOW_SEC) j += 1;
    if (j - i + 1 >= RAZE_MIN_ORDERS) return Math.round(near[j].sec);
  }
  return 0;
}

/** 게임 하나의 모션 트랙 — 좌표를 못 읽은 리플레이(옛 포맷)는 null(연속 재생은 그 판만 쉰다). */
export function motionOf(replay: ParsedReplay): SummaryMotion | null {
  const players = replay.players.filter((p) => !p.isComputer && p.signals);
  if (players.length === 0) return null;

  const tracks: MotionTrack[] = [];
  const builds: SummaryMotion["builds"] = [];
  const casts: SummaryMotion["casts"] = [];
  /* 팀별 공격 명령 — 건물 무너짐 어림의 재료. 한 번만 모아 두고 건물마다 훑는다. */
  const attacksByTeam = new Map<number, { sec: number; x: number; y: number }[]>();
  for (const p of players) {
    const list = attacksByTeam.get(p.team) ?? [];
    for (const o of p.signals!.orderPositions ?? []) {
      if (o.kind !== "attack" || o.by === "Building") continue;
      list.push({ sec: o.frame * SECONDS_PER_FRAME, x: o.x, y: o.y });
    }
    attacksByTeam.set(p.team, list);
  }
  for (const list of attacksByTeam.values()) list.sort((a, b) => a.sec - b.sec);

  for (const p of players) {
    const sg = p.signals!;
    const pts = trackOf(sg.orderPositions ?? []);
    const units = unitTimeline(sg.unitFrames ?? {});
    const workers = workerTimeline(sg.unitFrames ?? {});
    const size = sizeTimeline(sg.unitFrames ?? {});
    const prod: Record<string, number[]> = {};
    for (const [unit, frames] of Object.entries(sg.unitFrames ?? {})) {
      if (frames.length === 0) continue;
      prod[unit] = frames.map((f) => Math.round(f * SECONDS_PER_FRAME));
    }
    if (pts.length > 0 || units.length > 0 || workers.length > 0) {
      tracks.push({ raw: p.rawName, ...(p.color ? { color: p.color } : {}), pts, units, workers, size, prod });
    }
    const foeAttacks = [...attacksByTeam.entries()]
      .filter(([team]) => team !== p.team)
      .flatMap(([, list]) => list)
      .sort((a, b) => a.sec - b.sec);
    for (const b of sg.buildPositions ?? []) {
      if (b.frame === null) continue; // 시각을 모르는 건설은 시간축에 못 세운다.
      const builtSec = Math.round(b.frame * SECONDS_PER_FRAME);
      builds.push([
        builtSec, Math.round(b.x), Math.round(b.y), b.unit, p.rawName,
        razedAt(builtSec, b.x, b.y, foeAttacks),
      ]);
    }
    for (const c of sg.castPositions ?? []) {
      casts.push([
        Math.round(c.frame * SECONDS_PER_FRAME), Math.round(c.x), Math.round(c.y), c.tech, p.rawName,
      ]);
    }
  }
  if (tracks.length === 0 && builds.length === 0) return null;
  builds.sort((a, b) => a[0] - b[0]);
  casts.sort((a, b) => a[0] - b[0]);
  return { v: 1, step: STEP_SEC, players: tracks, builds, casts };
}

/** 공중 유닛인가 — 이름표에 ✈ 같은 표기를 따로 안 쓰지만, 부대 표기의 결(지상/공중)을
 *  플레이어가 알고 싶을 때 쓴다. (지금은 미사용 — 자리만 마련해 둔다.) */
export const isAirUnit = (unit: string): boolean => AIR_UNITS.has(unit) && !CASTER_UNITS.has(unit);
