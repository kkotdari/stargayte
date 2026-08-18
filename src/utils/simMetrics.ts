/* 연속 재생 완성도 계측(기획서 `docs/plan-sim-core-v4.md` P0)
 *
 * 왜 필요한가: 지금까지 "이제 좀 나아 보인다"로 판정해 왔다. 그래서 한 지적을 고치면
 * 다른 데가 나빠져도 알 길이 없었다. 완성도를 숫자로 재 두면 모든 변경이 좋아졌는지
 * 나빠졌는지 바로 나온다 — 기획서에서 "가장 값싸고 가장 중요한 부분"이라고 적은 그것.
 *
 * 무엇을 재나: 지금 파이프라인이 내놓은 개체 트랙(UnitTracksV2)만 보고, 사용자가 실제로
 * 지적한 어색함 넷을 각각 하나의 수로 만든다. 시뮬 코어가 없어도 오늘 바로 잴 수 있는
 * 것들이다 — 이 값들이 v4의 '이전' 기준선이 된다.
 *
 *   ① 생존 위반 — 죽었다고 판정한 개체가 그 뒤에 명령을 받는다("때린 놈 없는 죽음"의 쌍)
 *   ② 걸음 허구 — 증거만으로는 닿을 수 없어 렌더가 지어내야 하는 시간의 비율
 *      (= 순간이동·따라잡기·다리 잇기가 메우고 있는 몫)
 *   ③ 후진 — 증거가 왔던 길을 되짚는 횟수("막 되돌아간다")
 *   ④ 근거 없는 죽음 — 죽은 자리 곁에 적의 증거가 없던 죽음
 *   ⑤ 깜빡임 — 태어난 지 6초 안에 죽는 개체("유닛들이 자꾸 페이드아웃된다")
 *
 * 비율만 보면 속는다 — 허수 개체를 없애는 변경은 분모(개체·사망 수)를 줄이므로 절대
 * 수가 그대로여도 비율이 오른다(실측: 꼬리 분리를 없애자 개체 828→778, 사망 355→306,
 * 생존위반은 13건→14건으로 사실상 그대로인데 비율은 3.7%→4.6%로 '나빠져' 보였다).
 * 그래서 비율 옆에 늘 절대 수를 함께 낸다.
 *
 * 이 파일은 리액트를 안 쓴다 — 노드 CLI(scripts/sim-metrics.mjs)가 그대로 번들해 돌린다. */

import { speedOfUnit } from "./bwUnits";

/** 개체 하나의 증거 한 점 — [초, x, y, 갈래, 덤]. x<0이면 자리 없는 증거(생산·랠리). */
type Ev = [number, number, number, number, number?];

type Ent = {
  t: number; o: number; k?: string; b: number; d?: number | null;
  bld?: boolean; ev: Ev[]; hp?: [number, number][];
};

type Tracks = {
  players: { id: number; name: string; race?: string }[];
  ents: Ent[];
};

export type Metrics = {
  /** 개체 수(유닛만 — 건물은 걸음이 없어 ②③에서 뺀다). */
  units: number;
  /** ① 사망 뒤 명령을 받은 개체 비율(%)과 그 늦음의 중앙값(초). */
  reviveRate: number;
  reviveMedianSec: number;
  /** ② 증거로는 못 닿아 지어내야 하는 시간 / 전체 이동 구간 시간(%). */
  fictionRate: number;
  /** ③ 개체 100기당 후진 횟수. */
  backtrackPer100: number;
  /** ④ 적의 증거가 곁에 없던 죽음의 비율(%). */
  lonelyDeathRate: number;
  /** ⑤ 태어난 지 6초 안에 죽는 개체 수와 그 비율(%). */
  flickers: number;
  flickerRate: number;
  /** 잰 개체·구간 수 — 표본이 너무 작을 때 알아보라고 함께 낸다. */
  deaths: number;
  legs: number;
  /** 비율에 속지 않으려고 함께 내는 절대 수 — 위 ①③④의 분자. */
  revives: number;
  backtracks: number;
  lonely: number;
};

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const pct = (a: number, b: number): number => (b === 0 ? 0 : Math.round((a / b) * 1000) / 10);

/** 자리 있는 증거만, 시간순으로. */
const posEvs = (e: Ent): Ev[] =>
  e.ev.filter((v) => v[1] >= 0).sort((a, b) => a[0] - b[0]);

export function computeMetrics(data: Tracks): Metrics {
  const units = data.ents.filter((e) => !e.bld && e.t !== -1);
  const teamOf = new Map<number, number>(data.players.map((p) => [p.id, p.id]));

  /* ① 생존 위반 — 죽었다고 해 놓고 그 뒤에 명령이 온다. 리플레이에서 명령을 받은 태그는
     그 순간 확실히 살아 있으므로, 이건 어림이 아니라 확정된 오류다. 0.4초는 같은 순간의
     증거가 죽음 판정 뒤로 밀려 정렬된 경우를 봐주는 여유다. */
  const lateness: number[] = [];
  for (const e of units) {
    if (e.d === null || e.d === undefined) continue;
    const after = e.ev.filter((v) => v[0] > e.d! + 0.4);
    if (after.length > 0) lateness.push(after[after.length - 1][0] - e.d!);
  }
  const withDeath = units.filter((e) => e.d !== null && e.d !== undefined).length;

  /* ② 걸음 허구 — 증거 두 점 사이를 제 걸음으로 걸으면 needed초가 든다. 주어진 시간
     (available)이 그보다 짧으면 그 차이는 렌더가 지어내야 한다: 순간이동하거나, 속도를
     올리거나, 구간을 통째로 건너뛴다. 그 합이 전체 이동 시간에서 차지하는 비율이
     "지금 화면의 몇 %가 허구인가"다. 반대로 남는 시간은 그냥 서 있는 것이라 허구가 아니다. */
  let fiction = 0;
  let span = 0;
  let legs = 0;
  /* ③ 후진 — 세 점이 A→B→C인데 B→C가 왔던 길을 절반 넘게 되짚으면(각 120도 초과 +
     되짚는 거리 2타일 초과) 한 번으로 센다. 사람이 정말 그렇게 시킬 수도 있지만, 그
     빈도가 종족·경기와 무관하게 높다면 그것은 우리 자취가 만든 것이다. */
  let backtracks = 0;

  for (const e of units) {
    const evs = posEvs(e);
    const v = speedOfUnit(e.k ?? "");
    for (let i = 1; i < evs.length; i += 1) {
      const [s0, x0, y0] = evs[i - 1];
      const [s1, x1, y1] = evs[i];
      const dt = s1 - s0;
      const dist = Math.hypot(x1 - x0, y1 - y0);
      if (dist < 0.5) continue;          // 제자리 대기 — 걸음이 아니다.
      if (dt > 90) continue;             // 침묵 구간 — 증거가 없는 것이지 허구가 아니다.
      const needed = dist / v;
      span += Math.max(dt, needed);
      legs += 1;
      if (needed > dt) fiction += needed - dt;
      if (i >= 2) {
        const [, xa, ya] = evs[i - 2];
        const ax = x0 - xa;
        const ay = y0 - ya;
        const bx = x1 - x0;
        const by = y1 - y0;
        const la = Math.hypot(ax, ay);
        const lb = Math.hypot(bx, by);
        if (la > 2 && lb > 2) {
          const cos = (ax * bx + ay * by) / (la * lb);
          if (cos < -0.5) backtracks += 1;   // 120도 초과
        }
      }
    }
  }

  /* ④ 근거 없는 죽음 — 죽은 시각·자리 둘레(12타일, ±20초)에 적의 증거가 하나도 없었다면
     그 죽음은 누가 때려서 난 것이 아니다. 사용자 지적 "때린 놈이 안 보이는 죽음"의 수치. */
  const enemyEvs = new Map<number, [number, number, number][]>();
  for (const e of data.ents) {
    const own = teamOf.get(e.o) ?? e.o;
    const arr = enemyEvs.get(own) ?? [];
    for (const v of posEvs(e)) arr.push([v[0], v[1], v[2]]);
    enemyEvs.set(own, arr);
  }
  let lonely = 0;
  let deaths = 0;
  for (const e of units) {
    if (e.d === null || e.d === undefined) continue;
    const evs = posEvs(e);
    const last = [...evs].reverse().find((v) => v[0] <= e.d!);
    if (!last) continue;
    deaths += 1;
    const own = teamOf.get(e.o) ?? e.o;
    let seen = false;
    for (const [side, arr] of enemyEvs) {
      if (side === own) continue;
      for (const [s, x, y] of arr) {
        if (Math.abs(s - e.d!) > 20) continue;
        if (Math.hypot(x - last[1], y - last[2]) <= 12) { seen = true; break; }
      }
      if (seen) break;
    }
    if (!seen) lonely += 1;
  }

  /* ⑤ 깜빡임 — 태어난 지 6초 안에 죽는 개체. 화면에서는 유닛이 나타났다 곧 사라지는
     것으로 보인다(지적: 질럿들이 자꾸 페이드아웃된다). 진짜로 6초 만에 죽는 일도 있지만
     (수송선에서 내리자마자 죽는 등) 그 비율이 높다면 그건 우리가 만든 허수다. */
  let flickers = 0;
  for (const e of units) {
    if (e.d === null || e.d === undefined) continue;
    if (e.d - e.b <= 6) flickers += 1;
  }

  return {
    units: units.length,
    reviveRate: pct(lateness.length, withDeath),
    reviveMedianSec: Math.round(median(lateness) * 10) / 10,
    fictionRate: pct(fiction, span),
    backtrackPer100: units.length === 0 ? 0 : Math.round((backtracks / units.length) * 1000) / 10,
    lonelyDeathRate: pct(lonely, deaths),
    flickers,
    flickerRate: pct(flickers, units.length),
    deaths,
    legs,
    revives: lateness.length,
    backtracks,
    lonely,
  };
}

/** 사람이 읽는 한 줄. */
export function formatMetrics(label: string, m: Metrics): string {
  return [
    label.padEnd(18),
    `유닛 ${String(m.units).padStart(5)}`,
    `사망 ${String(m.deaths).padStart(4)}`,
    `생존위반 ${String(m.reviveRate).padStart(5)}%(${m.revives}건, 중앙 ${m.reviveMedianSec}s)`,
    `걸음허구 ${String(m.fictionRate).padStart(5)}%`,
    `후진 ${String(m.backtrackPer100).padStart(5)}/100기(${m.backtracks}회)`,
    `외로운죽음 ${String(m.lonelyDeathRate).padStart(5)}%(${m.lonely}건)`,
    `깜빡임 ${String(m.flickerRate).padStart(5)}%(${m.flickers}기)`,
  ].join("  ");
}
