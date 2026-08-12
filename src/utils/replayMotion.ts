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
/* 업그레이드·테크의 연구 시작을 전부 싣는다(요청: 업그레이드 중인 건물 표시) — 속도
   업그레이드만 골라 싣던 것을 넓혔다. 재생 쪽이 이름으로 속업(9종)과 연구 건물을 가른다.
   가짓수가 몇십이라 트랙 무게는 티가 안 난다. */
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
  /** 정찰·일꾼의 자취 — 부대 자취(pts)에서 걷어낸 한 기짜리·일꾼 명령들이다(지적: 정찰이
   *  안 보인다). 옛 분석본에는 없다. */
  spts?: [number, number, number][];
  /** [초, 유닛 영문명] — 그때까지 가장 많이 뽑은 전투 유닛이 바뀐 순간들(이름표 재료). */
  units: [number, string][];
  /** [초, 누적 일꾼 수] — 자원 캐는 모습의 재료(요청). 생산 커맨드 누적이라 죽은 일꾼은
   *  못 뺀다(리플레이에 죽음이 없다) — "여태 뽑은 일꾼"으로 읽어야 한다. */
  workers: [number, number][];
  /** [초, 업그레이드 영문명] — 속도 업그레이드의 연구 시점(요청: 속업 여부가 이동 속도에
   *  중요하다). 속도와 무관한 업은 안 싣는다(트랙만 굵어진다). */
  ups?: [number, string][];
  /** 유닛 영문명 → 생산 시각(초)들 — "생산할 때 건물 이름 켜기"(요청)의 재료다. 마린이
   *  나온 순간 그 사람 배럭이 일하고 있었다는 뜻이라, 건물 종류로 되짚는다. */
  prod: Record<string, number[]>;
  /** prod와 나란한 '그때 골라져 있던 건물 번호(태그)' — 어느 건물에서 뽑았는지의 어림
   *  재료다(요청). 옛 분석본에는 없다 — 그때는 같은 종류가 함께 깜빡이는 폴백. */
  ptag?: Record<string, number[]>;
  /** [초, 병력 규모] — 최근 3분 안에 뽑은 전투 유닛 수(요청: 뭉친 병력은 크기로 수를 표현).
   *  죽음을 모르니 '지금 서 있는 병력'이 아니라 '최근에 몰아 뽑은 규모'다 — 진군 직전에
   *  커지고 소강기에 줄어, 화면의 뜻(지금 움직이는 덩어리가 얼마나 큰가)과 결이 맞다. */
  size: [number, number][];
  /** [시작, 끝] 초 — 상대의 공격 명령이 내 부대 자리 곁에 몰린 구간(전투 어림). 재생이
   *  이 구간에서 규모를 깎는다(지적: 전투 중인데 유닛 수가 안 준다) — 리플레이에 죽음이
   *  안 남아 수를 셀 수는 없고, 맞고 있는 시간만큼 지수로 줄이는 것이 어림의 한계다. */
  hot?: [number, number][];
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

/** 부대 자취 — 이동·공격 명령(건물 랠리 제외)을 버킷으로 접는다.
 *
 *  정찰을 리플레이 정보로 걷는다(지적: 특히 초반에 자리가 튄다 — 오버로드인지 갑자기
 *  저 멀리 가 있다). 화면의 어림(멀리 갔다 돌아오면 빼기)보다 근거가 굵은 세 가지다.
 *   · by가 "Worker"인 명령 — 자원 클릭·건설로 정체가 드러난 일꾼의 클릭이다. 일꾼
 *     정찰·매너 파일런이 부대 자리로 읽히면 안 된다.
 *   · 한 기짜리 클릭(n === 1)인데 정체를 모르거나 수송선인 것 — 시작 오버로드는 아무
 *     커맨드로도 정체가 안 드러나지만 '한 기'인 것은 선택 기록이 말해 준다. 한 기는
 *     부대가 아니다(수송선 한 대의 원정도 오버로드 정찰과 같은 결이다 — 내린 뒤의 부대
 *     명령이 어차피 그 자리를 찍는다).
 *   · 첫 전투 유닛 생산 전의 모든 명령 — 병력이 없는 동안 움직이는 것은 죄다 일꾼과
 *     오버로드다. 부대 마커는 부대가 생기고서야 움직일 자격이 있다.
 *  옛 분석본에는 n이 없어 둘째 조건이 그냥 통과된다 — 그런 판은 재생 쪽의 나들이 걷기
 *  (dropSpikes)가 마저 막는다. */
function foldTrack(
  combat: { frame: number; x: number; y: number }[],
): [number, number, number][] {
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

function trackOf(
  orders: { frame: number; x: number; y: number; kind?: "attack" | "move"; by?: string; n?: number }[],
  armyStartSec: number,
): { pts: [number, number, number][]; spts: [number, number, number][] } {
  const movable = orders.filter((o) => o.kind !== undefined && o.by !== "Building");
  const isScout = (o: (typeof movable)[number]): boolean =>
    o.by === "Worker"
    || (o.n === 1 && (o.by === undefined || o.by === "Transport"))
    || o.frame * SECONDS_PER_FRAME < armyStartSec;
  return {
    pts: foldTrack(movable.filter((o) => !isScout(o))),
    /* 걷어낸 쪽이 버려지지 않고 제 자취가 된다(지적: 일꾼 정찰을 하나도 못 잡는다 —
       포토러시 일꾼은 안 가는데 파일런만 생겼다). 초반 정찰·매너 건물·오버로드 산개가
       전부 이 자취다. 화면은 이 자취가 움직이는 동안만 작은 점을 띄운다. */
    spts: foldTrack(movable.filter(isScout)),
  };
}

/** 우세 유닛 이름표의 변천 — 그때까지 가장 많이 뽑은 전투 유닛. 전투 유닛이 아직 없으면
 *  일꾼·오버로드가 그 자리를 맡는다(지적: 초반 정찰 — 오버로드·일꾼이 이름 없이 점으로만
 *  움직였다. 초반에 움직이는 것은 죄다 그 둘이다). */
const SCOUT_FALLBACK = new Set(["SCV", "Probe", "Drone", "Overlord"]);

function unitTimeline(unitFrames: Record<string, number[]>): [number, string][] {
  const events: { sec: number; unit: string; army: boolean }[] = [];
  for (const [unit, frames] of Object.entries(unitFrames)) {
    const army = !NOT_ARMY.has(unit);
    if (!army && !SCOUT_FALLBACK.has(unit)) continue;
    for (const f of frames) events.push({ sec: f * SECONDS_PER_FRAME, unit, army });
  }
  events.sort((a, b) => a.sec - b.sec);
  const armyCounts = new Map<string, number>();
  const scoutCounts = new Map<string, number>();
  const out: [number, string][] = [];
  let leader = "";
  let lastAt = -Infinity;
  for (const e of events) {
    (e.army ? armyCounts : scoutCounts).set(
      e.unit, ((e.army ? armyCounts : scoutCounts).get(e.unit) ?? 0) + 1,
    );
    const counts = armyCounts.size > 0 ? armyCounts : scoutCounts;
    let top = "";
    let topN = 0;
    for (const [u, n] of counts) if (n > topN) { top = u; topN = n; }
    if (top !== leader && e.sec - lastAt >= UNIT_HOLD_SEC) {
      leader = top;
      lastAt = e.sec;
      out.push([Math.round(e.sec), top]);
    }
  }
  return out;
}


/** 일꾼 건조 시간(초) — 세 종족 모두 비슷한 눈금이다. */
const WORKER_BUILD_SEC = 13;
/** 본진 건물이 지어져 생산 슬롯이 되기까지(초) — 커맨드·넥서스·해처리의 어림 건설 시간. */
const HALL_BUILD_SEC = 55;

/** 누적 일꾼 수의 변천 — 완료 시각 기준이다(지적: 누른다고 다 뽑는 게 아니다 — 시간을
 *  계산해야 한다). 생산 슬롯(본진 건물 수)마다 한 기씩 직렬로 뽑는 큐를 시뮬레이션해서,
 *  명령을 몰아 눌러도 완료는 건조 시간 간격으로 흩어진다. */
function workerTimeline(
  unitFrames: Record<string, number[]>, slotOpenSecs: number[],
): [number, number][] {
  const cmds = WORKER_UNITS.flatMap((u) => unitFrames[u] ?? [])
    .map((f) => f * SECONDS_PER_FRAME)
    .sort((a, b) => a - b);
  if (cmds.length === 0) return [];
  // 슬롯마다 '언제부터 비나' — 본진 건물이 지어지는 대로 슬롯이 는다.
  const free = (slotOpenSecs.length > 0 ? slotOpenSecs : [0]).slice().sort((a, b) => a - b);
  const doneSecs: number[] = [];
  for (const c of cmds) {
    let bi = 0;
    for (let i = 1; i < free.length; i += 1) if (free[i] < free[bi]) bi = i;
    const fin = Math.max(c, free[bi]) + WORKER_BUILD_SEC;
    free[bi] = fin;
    doneSecs.push(fin);
  }
  doneSecs.sort((a, b) => a - b);
  const out: [number, number][] = [];
  let n = 0;
  let bucket = -1;
  for (const sec of doneSecs) {
    n += 1;
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

/* 전투 구간 어림(MotionTrack.hot) — 버킷(초)마다 '그때 내 부대 자리'에서 반경 안에 떨어진
   상대 공격 명령을 세고, 문턱을 넘긴 버킷을 구간으로 잇는다. 반경·문턱은 건물 무너짐
   어림(razedAt)과 같은 결이되, 부대는 건물보다 움직이니 반경을 조금 넓게 잡는다. */
const FIGHT_STEP_SEC = 10;
const FIGHT_RADIUS = 10;
const FIGHT_MIN_ORDERS = 5;

function hotOf(
  pts: [number, number, number][],
  foeAttacks: { sec: number; x: number; y: number }[],
): [number, number][] {
  if (pts.length === 0 || foeAttacks.length === 0) return [];
  // 그 시각의 내 자리 — 자취는 시간순이라 한 손가락으로 따라가며 읽는다.
  let pi = 0;
  const counts = new Map<number, number>();
  for (const a of foeAttacks) {
    while (pi + 1 < pts.length && pts[pi + 1][0] <= a.sec) pi += 1;
    const [, x, y] = pts[pi];
    if (Math.hypot(a.x - x, a.y - y) <= FIGHT_RADIUS) {
      const b = Math.floor(a.sec / FIGHT_STEP_SEC);
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
  }
  const hot: [number, number][] = [];
  for (const b of [...counts.keys()].sort((x, y) => x - y)) {
    if ((counts.get(b) ?? 0) < FIGHT_MIN_ORDERS) continue;
    const start = b * FIGHT_STEP_SEC;
    const end = start + FIGHT_STEP_SEC;
    const last = hot[hot.length - 1];
    if (last && start <= last[1]) last[1] = end;
    else hot.push([start, end]);
  }
  return hot;
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
    /* 첫 전투 유닛의 생산 명령 시각 — 그 전의 명령은 전부 정찰이다(trackOf 주석).
       전투 유닛을 아예 안 뽑은 사람(일꾼뿐)은 0으로 두어 옛 동작 그대로 남긴다 —
       자취가 통째로 비는 것보다는 낫다. */
    let armyStartSec = Infinity;
    for (const [unit, frames] of Object.entries(sg.unitFrames ?? {})) {
      if (NOT_ARMY.has(unit)) continue;
      for (const f of frames) armyStartSec = Math.min(armyStartSec, f * SECONDS_PER_FRAME);
    }
    if (armyStartSec === Infinity) armyStartSec = 0;
    const { pts, spts } = trackOf(sg.orderPositions ?? [], armyStartSec);
    const units = unitTimeline(sg.unitFrames ?? {});
    // 생산 슬롯 — 시작 본진(0초) + 지어진 본진 건물들(건설 시간 지나서부터).
    const slotOpenSecs = [0, ...(sg.buildPositions ?? [])
      .filter((b) => b.frame !== null
        && ["Command Center", "Nexus", "Hatchery"].includes(b.unit))
      .map((b) => b.frame! * SECONDS_PER_FRAME + HALL_BUILD_SEC)];
    const workers = workerTimeline(sg.unitFrames ?? {}, slotOpenSecs);
    const size = sizeTimeline(sg.unitFrames ?? {});
    const ups: [number, string][] = [];
    for (const [name, frame] of Object.entries(sg.firstUpgradeFrame ?? {})) {
      ups.push([Math.round(frame * SECONDS_PER_FRAME), name]);
    }
    for (const [name, frame] of Object.entries(sg.firstTechFrame ?? {})) {
      ups.push([Math.round(frame * SECONDS_PER_FRAME), name]);
    }
    ups.sort((a, b) => a[0] - b[0]);
    const prod: Record<string, number[]> = {};
    for (const [unit, frames] of Object.entries(sg.unitFrames ?? {})) {
      if (frames.length === 0) continue;
      prod[unit] = frames.map((f) => Math.round(f * SECONDS_PER_FRAME));
    }
    // 생산 태그(요청: 어느 건물인지) — prod와 길이가 맞는 것만 싣는다(어긋나면 오지목).
    const ptag: Record<string, number[]> = {};
    for (const [unit, tags] of Object.entries(sg.trainTags ?? {})) {
      if (tags.length > 0 && tags.length === (sg.unitFrames?.[unit]?.length ?? 0)
        && tags.some((tg) => tg > 0)) {
        ptag[unit] = tags;
      }
    }
    const foeAttacks = [...attacksByTeam.entries()]
      .filter(([team]) => team !== p.team)
      .flatMap(([, list]) => list)
      .sort((a, b) => a.sec - b.sec);
    if (pts.length > 0 || spts.length > 0 || units.length > 0 || workers.length > 0) {
      const hot = hotOf(pts, foeAttacks);
      tracks.push({
        raw: p.rawName, ...(p.color ? { color: p.color } : {}),
        ...(ups.length > 0 ? { ups } : {}), pts, units, workers, size, prod,
        ...(spts.length > 0 ? { spts } : {}),
        ...(Object.keys(ptag).length > 0 ? { ptag } : {}),
        ...(hot.length > 0 ? { hot } : {}),
      });
    }
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
