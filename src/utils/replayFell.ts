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

// 직전 수준의 이만큼 아래로 떨어지면 '한 대 크게 맞았다'로 본다.
const DIP_RATIO = 0.35;
// 그 전에 이만큼은 뽑고 있었어야 비교가 된다 — 원래 두어 기씩 뽑던 구간의 등락은 소음이다.
const DIP_MIN_LEVEL = 5;

/** 생산이 갑자기 꺾인 지점들(프레임). 회복 여부는 보지 않는다 — 다시 일어섰더라도 그때
 *  크게 맞은 건 맞다. 러시·드랍 타이밍과 겹치면 그 피해를 그 수의 결과로 읽는다(요청). */
export function productionDips(
  p: ParsedReplayPlayer,
  totalFrames: number | null
): number[] {
  if (!totalFrames) return [];
  const b = windows(p, totalFrames);
  if (b.length < 3) return [];
  const per = WINDOW_SEC / SECONDS_PER_FRAME;
  const out: number[] = [];
  for (let i = 1; i < b.length; i += 1) {
    const before = Math.max(b[i - 1], i >= 2 ? b[i - 2] : 0);
    if (before < DIP_MIN_LEVEL) continue;
    if (b[i] <= before * DIP_RATIO) out.push(Math.round(i * per));
  }
  return out;
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

// 꺾였다가 이만큼까지 올라오면 '다시 일어섰다'로 본다.
// 한창때의 절반까지 올라오면 다시 일어선 것으로 본다 — 본진을 잃고 되살아난 생산이
// 전성기만큼 나오기는 어렵다.
const REVIVE_RATIO = 0.5;

/** 크게 꺾였다가 다시 일어선 시점(프레임). 그런 일이 없으면 null.
 *  부활은 그 자체가 이야기라 따로 잡는다(요청) — 무너진 것만 말하고 끝내면 절반만 말한 것이다. */
export function revivalFrame(
  p: ParsedReplayPlayer,
  totalFrames: number | null
): number | null {
  if (!totalFrames) return null;
  const b = windows(p, totalFrames);
  if (b.length < 4) return null;
  const per = WINDOW_SEC / SECONDS_PER_FRAME;
  for (let i = 1; i < b.length - 1; i += 1) {
    const before = Math.max(b[i - 1], i >= 2 ? b[i - 2] : 0);
    if (before < DIP_MIN_LEVEL) continue;
    if (b[i] > before * DIP_RATIO) continue;      // 여기서 꺾이지 않았다
    for (let j = i + 1; j < b.length; j += 1) {
      if (b[j] >= before * REVIVE_RATIO) return Math.round(j * per);
    }
  }
  return null;
}

/** 리플레이에 '졌다'고 적힌 사유들 — 이겨서/무승부로 끝난 퇴장과 갈라야 한다. */
const LOST_REASONS = new Set(["Defeat", "Quit", "Dropped"]);

/** 판에서 실제로 탈락한 시점 — screp의 "Leave Game" 기록이 있으면 그게 사실이다.
 *  추측(생산 붕괴)과 달리 이건 리플레이에 그대로 적혀 있다. 없으면 null. */
export function eliminatedFrame(p: ParsedReplayPlayer): number | null {
  const s = p.signals;
  // 옛 데이터에는 이 필드가 아예 없다 — undefined도 함께 걸러야 한다.
  if (!s || s.leaveFrame == null) return null;
  // 사유를 못 읽는 버전도 있다 — 그때는 퇴장 자체를 탈락으로 본다.
  if (s.leaveReason && !LOST_REASONS.has(s.leaveReason)) return null;
  return s.leaveFrame;
}

/** 그 사람이 사라진 시점 — 리플레이에 적힌 탈락이 먼저고, 없으면 생산이 꺾인 지점,
 *  그것도 없으면 마지막 커맨드. */
export function fellFrame(
  p: ParsedReplayPlayer,
  totalFrames: number | null
): number | null {
  const left = eliminatedFrame(p);
  if (left !== null) return left;
  const last = p.signals?.lastCmdFrame ?? null;
  const collapse = productionCollapse(p, totalFrames);
  if (collapse === null) return last;
  if (last === null) return collapse;
  return Math.min(collapse, last);
}
