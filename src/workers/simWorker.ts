/* 시뮬 코어를 도는 웹 워커 (기획서 docs/plan-sim-core-v4.md P1)
 *
 * 왜 워커인가: 20분 4:4 한 판이 개체 2,500기 × 1만 틱이라 메인 스레드에서 돌리면 몇 초
 * 동안 화면이 언다. 워커로 빼면 그동안 재생·조작이 그대로 산다.
 *
 * 왜 열 때 도는가(요청·기획서 5절): 업로드 때 구워 두면 시뮬을 고칠 때마다 전 경기를
 * 재분석해야 한다. 열 때 돌면 코어를 고치는 순간 과거 경기 전부가 저절로 좋아진다. */

import { simulate, type SimInput, type SimOpts } from "../utils/simCore";

export type SimReq = { id: number; data: SimInput; opts: SimOpts };
export type SimRes =
  | { id: number; ok: true; tracks: ReturnType<typeof simulate>["tracks"]; events: ReturnType<typeof simulate>["events"]; stats: ReturnType<typeof simulate>["stats"] }
  | { id: number; ok: false; err: string };

self.onmessage = (ev: MessageEvent<SimReq>) => {
  const { id, data, opts } = ev.data;
  try {
    const r = simulate(data, opts);
    const msg: SimRes = { id, ok: true, tracks: r.tracks, events: r.events, stats: r.stats };
    (self as unknown as Worker).postMessage(msg);
  } catch (e) {
    const msg: SimRes = { id, ok: false, err: e instanceof Error ? e.message : String(e) };
    (self as unknown as Worker).postMessage(msg);
  }
};
