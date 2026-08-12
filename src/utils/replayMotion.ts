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

/** 한 사람의 자취 — 원본 게임 아이디(raw)로 부른다(beats와 같은 규칙). */
export interface MotionTrack {
  raw: string;
  /** [초, x, y] — STEP_SEC 버킷의 마지막 명령 자리. 안 움직인 버킷은 접혀 있다. */
  pts: [number, number, number][];
  /** [초, 유닛 영문명] — 그때까지 가장 많이 뽑은 전투 유닛이 바뀐 순간들(이름표 재료). */
  units: [number, string][];
}

export interface SummaryMotion {
  v: 1;
  step: number;
  players: MotionTrack[];
  /** [초, x, y, 건물 영문명, raw] — 건설 커맨드는 자리·시각이 정확하다. */
  builds: [number, number, number, string, string][];
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

/** 게임 하나의 모션 트랙 — 좌표를 못 읽은 리플레이(옛 포맷)는 null(연속 재생은 그 판만 쉰다). */
export function motionOf(replay: ParsedReplay): SummaryMotion | null {
  const players = replay.players.filter((p) => !p.isComputer && p.signals);
  if (players.length === 0) return null;

  const tracks: MotionTrack[] = [];
  const builds: SummaryMotion["builds"] = [];
  const casts: SummaryMotion["casts"] = [];
  for (const p of players) {
    const sg = p.signals!;
    const pts = trackOf(sg.orderPositions ?? []);
    const units = unitTimeline(sg.unitFrames ?? {});
    if (pts.length > 0 || units.length > 0) tracks.push({ raw: p.rawName, pts, units });
    for (const b of sg.buildPositions ?? []) {
      if (b.frame === null) continue; // 시각을 모르는 건설은 시간축에 못 세운다.
      builds.push([
        Math.round(b.frame * SECONDS_PER_FRAME), Math.round(b.x), Math.round(b.y), b.unit, p.rawName,
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
