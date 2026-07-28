import type { ParsedReplayPlayer } from "./replayParser";

// "그 사람이 판에서 사라진 시점"을 커맨드만으로 잡는다.
//
// 가장 쉬운 답은 마지막 커맨드 프레임이지만 그건 너무 늦다 — 기지가 다 날아가고도 남은
// 병력으로 한참을 돌아다니면 커맨드는 계속 찍힌다. 실제로는 '시간당 생산이 확 줄어든'
// 그 지점이 무너진 순간이다(요청).
//
// 다만 줄었다고 다 죽은 건 아니다 — 다시 올라오면 부활한 것이라 죽은 것으로 치면 안 된다
// (지적). 그래서 '꺾인 뒤로 끝까지 회복하지 못한' 첫 지점만 무너진 시점으로 본다.

const SECONDS_PER_FRAME = 0.042;
/** 생산량을 세는 창 — 1분. 더 잘게 자르면 라바 타이밍 같은 정상적인 들쭉날쭉에 걸린다. */
const WINDOW_SEC = 60;
/** 이 사람의 전성기 생산량 대비 이만큼 아래로 떨어지면 '꺾였다'. */
const COLLAPSE_RATIO = 0.25;
/** 꺾인 뒤 이만큼 위로 올라오면 부활한 것이다 — 그 지점은 무너진 시점이 아니다. */
const RECOVER_RATIO = 0.5;
/** 전성기 생산량이 이보다 적으면 비교 자체가 무의미하다(짧은 경기·관전 슬롯). */
const MIN_PEAK = 4;

function windows(p: ParsedReplayPlayer, totalFrames: number): number[] {
  const s = p.signals;
  if (!s) return [];
  const per = WINDOW_SEC / SECONDS_PER_FRAME;
  const n = Math.max(1, Math.ceil(totalFrames / per));
  const buckets = new Array<number>(n).fill(0);
  // 일꾼도 함께 센다 — 기지가 날아가면 제일 먼저 멈추는 게 일꾼 생산이다.
  for (const frames of Object.values(s.unitFrames)) {
    for (const f of frames) {
      const i = Math.floor(f / per);
      if (i >= 0 && i < n) buckets[i] += 1;
    }
  }
  return buckets;
}

/** 생산이 꺾여 끝내 회복하지 못한 시점(프레임). 그런 지점이 없으면 null. */
export function productionCollapse(
  p: ParsedReplayPlayer,
  totalFrames: number | null
): number | null {
  if (!totalFrames) return null;
  const b = windows(p, totalFrames);
  if (b.length < 3) return null;
  const peak = Math.max(...b);
  if (peak < MIN_PEAK) return null;
  const per = WINDOW_SEC / SECONDS_PER_FRAME;
  // 뒤에서부터 훑어 '여기부터 끝까지 회복이 없었다'는 구간의 시작을 찾는다.
  let start = b.length;
  for (let i = b.length - 1; i >= 0; i -= 1) {
    if (b[i] > peak * RECOVER_RATIO) break; // 여기서 부활했다 — 더 앞은 볼 것 없다
    if (b[i] <= peak * COLLAPSE_RATIO) start = i;
  }
  if (start >= b.length) return null;
  return Math.round(start * per);
}

/** 그 사람이 사라진 시점 — 생산이 꺾인 지점을 먼저 보고, 못 잡으면 마지막 커맨드. */
export function fellFrame(
  p: ParsedReplayPlayer,
  totalFrames: number | null
): number | null {
  const last = p.signals?.lastCmdFrame ?? null;
  const collapse = productionCollapse(p, totalFrames);
  if (collapse === null) return last;
  if (last === null) return collapse;
  return Math.min(collapse, last);
}
