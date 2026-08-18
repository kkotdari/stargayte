/* 시뮬 결과를 얻는 창구 — 워커에 맡기고 IndexedDB에 캐시한다(기획서 P1).
 *
 * 캐시 열쇠는 (경기 번호, 시뮬 버전)이다. 코어를 고치면 버전만 올리면 되고, 그러면 다음
 * 열람에서 전부 다시 돈다 — 서버 재분석은 어디에도 없다(요청). */

import type { SimEventArr, SimOpts, SimResult, SimTrack } from "./simCore";
import type { SimInput } from "./simCore";

/** 코어를 고칠 때마다 올린다 — 캐시가 옛 결과를 주지 않게 하는 유일한 자물쇠다. */
export const SIM_VERSION = 2;

const DB = "stargayte-sim";
const STORE = "tracks";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") { resolve(null); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export type SimCached = { tracks: SimTrack[]; events: SimEventArr };

async function cacheGet(key: string): Promise<SimCached | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as SimCached | undefined) ?? null);
    req.onerror = () => resolve(null);
  });
}

async function cachePut(key: string, val: SimCached): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/* 진행 상황을 콘솔에 남긴다(요청: 로딩이 도는지 안 도는지 알 수 없다) — 워커에서 도니
   화면이 안 멈춰서, 제대로 돌았는지 눈으로는 가릴 수가 없다. */
export function logSim(msg: string): void {
  // eslint-disable-next-line no-console
  console.info(`[sim] ${msg}`);
}

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, (r: SimResult | null) => void>();

function ensureWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL("../workers/simWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent) => {
      const m = ev.data as {
        id: number; ok: boolean; tracks?: SimTrack[]; events?: SimEventArr;
        stats?: SimResult["stats"]; err?: string;
      };
      const done = waiting.get(m.id);
      if (!done) return;
      waiting.delete(m.id);
      if (m.ok && m.tracks) {
        done({ tracks: m.tracks, events: m.events ?? [], stats: m.stats as SimResult["stats"] });
      }
      else done(null);
    };
    worker.onerror = (e) => {
      logSim(`워커 오류: ${(e as ErrorEvent).message ?? e}`);
      for (const [, d] of waiting) d(null);
      waiting.clear();
    };
  } catch (e) {
    logSim(`워커를 못 만들었다: ${e instanceof Error ? e.message : String(e)}`);
    worker = null;
  }
  return worker;
}

/** 그 경기의 시뮬 자취 — 캐시에 있으면 바로, 없으면 워커가 돌려 캐시에 넣는다. */
export async function loadSimTracks(
  cacheKey: string, data: SimInput, opts: SimOpts,
  /** 진행을 화면에 보일 자리 — 워커에서 도니 알려 주지 않으면 됐는지 알 수가 없다. */
  onNote?: (msg: string) => void,
): Promise<SimCached | null> {
  const key = `${cacheKey}:v${SIM_VERSION}`;
  const t0 = Date.now();
  const hit = await cacheGet(key);
  if (hit) {
    logSim(`캐시 적중 ${key} — 자취 ${hit.tracks.length}, 사건 ${hit.events.length / 8}`);
    onNote?.(`시뮬 ${hit.tracks.length}기 (캐시)`);
    return hit;
  }
  const w = ensureWorker();
  if (!w) { onNote?.("시뮬 워커를 못 띄웠다"); return null; }
  onNote?.("시뮬 계산 중…");
  const id = (seq += 1);
  const res = await new Promise<SimResult | null>((resolve) => {
    waiting.set(id, resolve);
    w.postMessage({ id, data, opts });
  });
  if (!res) { logSim("시뮬 실패 — 워커가 결과를 못 냈다"); onNote?.("시뮬 실패"); return null; }
  const st = res.stats;
  logSim(`시뮬 완료 ${Math.round(Date.now() - t0)}ms — 개체 ${st.ents}, 자취 ${res.tracks.length}, `
    + `키 ${Math.round(st.keys)}, 사건 ${res.events.length / 8}, 죽임 ${st.kills}, `
    + `드리프트 중앙 ${st.driftMedian}타일`);
  onNote?.(`시뮬 ${res.tracks.length}기 · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
  const out: SimCached = { tracks: res.tracks, events: res.events };
  void cachePut(key, out);
  return out;
}
