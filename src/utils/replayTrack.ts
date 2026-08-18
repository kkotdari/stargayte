/* 자취 위의 한 점 — 재생 화면이 "그때 그 개체는 어디 있었나"를 묻는 유일한 창구다.
 *
 * 여기 있는 이유(과제 #61): 이 셈은 원래 15,000줄짜리 재생 컴포넌트 한가운데 박혀 있어
 * 따로 재 볼 수가 없었다. 코어(simCore)가 걸음의 진실이 되면서 이 함수의 몫은 "코어가
 * 낸 자취를 읽는 것" 하나로 좁아졌고 — 옛 보정들은 코어가 없던 시절의 대역이다 —
 * 좁아진 만큼 밖으로 꺼내 자로 잴 수 있게 뒀다(scripts/pos-check.mjs).
 */

/** 자취 한 점 [초, x, y, 선택 묶음 번호?] — 넷째 값(g)은 같은 부대지정으로 내린 명령끼리
 *  같은 번호다(지적: 단축키 부대 이동의 순간이동). 옛 분석본에는 없다. */
export type TrackPt = [number, number, number, number?];

export interface TrackPos { x: number; y: number; stale: boolean; moving: boolean; sinceLast: number }

/** 자취 점 사이가 이보다 벌어지면 잇지 않고 건너뛴다(초) — 한참 조용하다 다른 곳을 찍은
 *  것은 이동이 아니라 시선 전환이라, 이으면 부대가 맵을 순간이동으로 가로지른다. */
export const LERP_MAX_GAP_SEC = 24;
/** 보간이 낼 수 있는 최고 속도(타일/초) — 이보다 빨라야 닿는 두 점은 잇지 않고 앞 점에
 *  머문다(지적: "아직도 유닛 갑자기 빠르게 이동하는 말도안되는 현상이"). 자취는 걷기
 *  (walkTrack)로 속도가 눌려 있지만, 부대 재배정·틈새로 새는 점이 남긴 초고속 미끄러짐을
 *  여기서 마지막으로 막는다. 스커지(6.7타일/초)가 실제 최고라 8이면 진짜 이동은 안 걸린다. */
const GLIDE_MAX_SPEED = 6.5;
/** 순간이동 다리(지적: 유닛이 얼었다 다음 점으로 튐 — 앞뒤 추적 강화) — 침묵 구간의
 *  끝자락을 걸어 잇는 걸음 속도와, 초고속 구간을 행군으로 봐줄 상한(타일/초). 상한을
 *  넘어야 닿는 점프만 예전처럼 앞 점에 머문다(그건 정말 딴 부대의 점이다). */
const BRIDGE_WALK_SPEED = 4.5;
const BRIDGE_MAX_SPEED = 10;
/** 지상 부대가 가운데 쪽으로 휘는 정도 — 스냅 화살표의 BEND와 같은 어림(지적: 지상군이
 *  벽을 넘어 다닌다). 진짜 길찾기는 지형 표 없이는 못 그리지만, 브루드워 지상군은 대체로
 *  본진을 나와 가운데 길로 돌므로 직선보다 이쪽이 덜 거짓말이다. 공중은 곧게 간다. */
const GROUND_BEND = 0.35;

export function posAt(
  pts: TrackPt[], t: number,
  bendCenter: { x: number; y: number } | null,
  /** 이 자취가 낼 수 있는 최고 걸음(타일/초) — 주면 그 위로는 절대 안 미끄러진다(요청:
   *  걸음 속도 상한). 넘치는 구간은 앞 점에 머물다 이 속도로 걸어 제때(다음 점 시각)
   *  닿는다 — 도착 시각과 자리는 그대로라 앵커가 안 어긋난다. 안 주면 종전대로. */
  maxSpeed?: number,
  /** 코어가 낸 자취인가(과제 #61) — 코어 자취는 이미 제 속도로 적분된 값이라 아래
   *  보정(걸음 상한·다리 놓기·굽힘·침묵 판정)이 통째로 군더더기이고, 켜 두면 오히려
   *  코어가 낸 값을 렌더러가 다시 주무르는 이중 모형이 된다. 켜면 토막 사이를 곧게
   *  잇기만 한다. */
  plain?: boolean,
): TrackPos | null {
  const n = pts.length;
  if (n === 0) return null;
  if (t <= pts[0][0]) return { x: pts[0][1], y: pts[0][2], stale: false, moving: false, sinceLast: Infinity };
  const lastPt = pts[n - 1];
  if (t >= lastPt[0]) {
    return {
      x: lastPt[1], y: lastPt[2],
      stale: !plain && t - lastPt[0] > LERP_MAX_GAP_SEC, moving: false, sinceLast: t - lastPt[0],
    };
  }
  /* 토막은 이분 탐색으로 찾는다 — 자취는 시간순이다. 코어 자취를 그대로 읽게 되면서
     개체 하나가 수천 점을 지니는 일이 생겼는데(실측: 게임 1의 최장 일꾼 8981점),
     앞에서부터 훑으면 그 하나가 프레임을 먹는다. 앞뒤로 같은 시각의 점이 겹쳐 있어도
     고르는 토막은 옛 훑기와 같다. */
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid][0] <= t) lo = mid; else hi = mid - 1;
  }
  const i = lo;
  const [s0, x0, y0] = pts[i];
  const [s1, x1, y1] = pts[i + 1];
  const gap = s1 - s0;
  if (plain) {
    const kp = (t - s0) / Math.max(0.001, gap);
    const stillp = x0 === x1 && y0 === y1;
    return {
      x: x0 + (x1 - x0) * kp, y: y0 + (y1 - y0) * kp,
      stale: false, moving: !stillp, sinceLast: stillp ? t - s0 : 0,
    };
  }
  const dist = Math.hypot(x1 - x0, y1 - y0);
  if (gap > LERP_MAX_GAP_SEC) {
    /* 침묵 구간의 순간이동 방지(지적: 얼었다 다음 점으로 튐) — 대부분은 예전처럼
       앞 점에 머물되, 도착 시각에 맞춰 끝자락(거리/걸음속도)만 걸어서 잇는다. */
    const walkSec = Math.min(gap, Math.max(2, dist / BRIDGE_WALK_SPEED));
    if (dist > 0.01 && t >= s1 - walkSec) {
      const k = (t - (s1 - walkSec)) / walkSec;
      return { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, stale: false, moving: true, sinceLast: 0 };
    }
    return { x: x0, y: y0, stale: t - s0 > LERP_MAX_GAP_SEC, moving: false, sinceLast: t - s0 };
  }
  /* 제 걸음보다 빨리 못 간다(요청: 걸음 속도 상한 — 순간적으로 기본 속도보다
     빨라진다) — 증거 점 사이를 그냥 선형으로 이으면 두 점이 멀수록 광속이 된다.
     유닛 속도표가 주어지면 그 위로는 안 미끄러지고, 앞 점에 머물다 제 걸음으로
     걸어 다음 점 시각에 닿는다. */
  if (maxSpeed !== undefined && dist / Math.max(0.001, gap) > maxSpeed) {
    const walkSec9 = Math.min(gap, dist / maxSpeed);
    if (t >= s1 - walkSec9) {
      const k9 = (t - (s1 - walkSec9)) / Math.max(0.001, walkSec9);
      return { x: x0 + (x1 - x0) * k9, y: y0 + (y1 - y0) * k9, stale: false, moving: true, sinceLast: 0 };
    }
    return { x: x0, y: y0, stale: false, moving: false, sinceLast: t - s0 };
  }
  /* 말이 안 되는 속도의 미끄러짐은 잇지 않는다(지적) — 다만 행군으로 봐줄 수 있는
     빠르기(BRIDGE_MAX_SPEED)까지는 걸어 잇는다(재지적: 순간이동 금지). 그보다
     빨라야 닿는 점만 앞 점에 머문다. GLIDE_MAX_SPEED 주석 참고. */
  if (dist / Math.max(0.001, gap) > GLIDE_MAX_SPEED) {
    if (dist / Math.max(0.001, gap) <= BRIDGE_MAX_SPEED) {
      const k2 = (t - s0) / Math.max(0.001, gap);
      return { x: x0 + (x1 - x0) * k2, y: y0 + (y1 - y0) * k2, stale: false, moving: true, sinceLast: 0 };
    }
    return { x: x0, y: y0, stale: false, moving: false, sinceLast: t - s0 };
  }
  const k = (t - s0) / Math.max(0.001, s1 - s0);
  // 대기 구간(같은 자리 두 점) — 움직임이 아니다(도착해서 다음 명령을 기다리는 중).
  const still = x0 === x1 && y0 === y1;
  if (!bendCenter || still) {
    return {
      x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k,
      stale: false, moving: !still, sinceLast: still ? t - s0 : 0,
    };
  }
  /* 이차 베지어 — 제어점을 두 점의 가운데에서 맵 중앙 쪽으로 당긴다. 이동 거리가 길수록
     더 휘어, 먼 진군일수록 "가운데 길로 돌아간다"에 가까워진다. */
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const cx = mx + (bendCenter.x - mx) * GROUND_BEND;
  const cy = my + (bendCenter.y - my) * GROUND_BEND;
  const u = 1 - k;
  return {
    x: u * u * x0 + 2 * u * k * cx + k * k * x1,
    y: u * u * y0 + 2 * u * k * cy + k * k * y1,
    stale: false, moving: true, sinceLast: 0,
  };
}
