/* 자취 위의 한 점 — 재생 화면이 "그때 그 개체는 어디 있었나"를 묻는 유일한 창구다.
 *
 * 여기 있는 이유(과제 #61): 이 셈은 원래 15,000줄짜리 재생 컴포넌트 한가운데 박혀 있어
 * 따로 재 볼 수가 없었다. 코어(simCore)가 걸음의 진실이 되면서 이 함수의 몫은 "코어가
 * 낸 자취를 읽는 것" 하나로 좁아졌고 — 좁아진 만큼 밖으로 꺼내 자로 잴 수 있게 뒀다
 * (scripts/pos-check.mjs).
 *
 * ★ 정식 배포에서 옛 보정이 통째로 걷혔다 — 걸음 상한(maxSpeed·GLIDE/BRIDGE)·침묵 구간
 *   다리 놓기(LERP_MAX_GAP_SEC)·지면 굽힘(bendCenter)·침묵 판정(stale)은 전부 **명령
 *   좌표 사이를 렌더러가 어림하던 시절**의 장치다. 코어 자취는 이미 제 속도로 적분된
 *   값이라, 그 위에 보정을 얹으면 코어가 낸 값을 렌더러가 다시 주무르는 이중 모형이
 *   된다(같은 몸을 두 모형이 서로 밀었다). 지금은 토막 사이를 곧게 잇기만 한다.
 */

/** 자취 한 점 [초, x, y, 선택 묶음 번호?] — 넷째 값(g)은 같은 부대지정으로 내린 명령끼리
 *  같은 번호다. 코어 자취에는 안 실린다. */
export type TrackPt = [number, number, number, number?];

export interface TrackPos { x: number; y: number; moving: boolean; sinceLast: number }

export function posAt(pts: TrackPt[], t: number): TrackPos | null {
  const n = pts.length;
  if (n === 0) return null;
  if (t <= pts[0][0]) {
    return { x: pts[0][1], y: pts[0][2], moving: false, sinceLast: Infinity };
  }
  const lastPt = pts[n - 1];
  if (t >= lastPt[0]) {
    return {
      x: lastPt[1], y: lastPt[2], moving: false, sinceLast: t - lastPt[0],
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
  const [s0, x0, y0] = pts[lo];
  const [s1, x1, y1] = pts[lo + 1];
  const k = (t - s0) / Math.max(0.001, s1 - s0);
  // 대기 구간(같은 자리 두 점) — 움직임이 아니다(도착해서 다음 명령을 기다리는 중).
  const still = x0 === x1 && y0 === y1;
  return {
    x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k,
    moving: !still, sinceLast: still ? t - s0 : 0,
  };
}
