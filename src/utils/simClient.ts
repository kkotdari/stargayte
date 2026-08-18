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
    worker.onerror = () => { for (const [, d] of waiting) d(null); waiting.clear(); };
  } catch {
    worker = null;
  }
  return worker;
}

/** 그 경기의 시뮬 자취 — 캐시에 있으면 바로, 없으면 워커가 돌려 캐시에 넣는다. */
export async function loadSimTracks(
  cacheKey: string, data: SimInput, opts: SimOpts,
): Promise<SimCached | null> {
  const key = `${cacheKey}:v${SIM_VERSION}`;
  const hit = await cacheGet(key);
  if (hit) return hit;
  const w = ensureWorker();
  if (!w) return null;
  const id = (seq += 1);
  const res = await new Promise<SimResult | null>((resolve) => {
    waiting.set(id, resolve);
    w.postMessage({ id, data, opts });
  });
  if (!res) return null;
  const out: SimCached = { tracks: res.tracks, events: res.events };
  void cachePut(key, out);
  return out;
}
