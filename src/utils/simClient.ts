/* 시뮬 결과를 얻는 창구 — 워커에 맡기고 IndexedDB에 캐시한다(기획서 P1).
 *
 * 캐시 열쇠는 (경기 번호, 시뮬 버전)이다. 코어를 고치면 버전만 올리면 되고, 그러면 다음
 * 열람에서 전부 다시 돈다 — 서버 재분석은 어디에도 없다(요청). */

import type { SimEventArr, SimOpts, SimResult, SimTrack } from "./simCore";
import type { SimInput } from "./simCore";

/* 코어를 고칠 때마다 올린다 — 캐시가 옛 결과를 주지 않게 하는 유일한 자물쇠다.
 *
 * v3 (2026-08-18): 전투·이동 코어를 원전(OpenBW/BWAPI) 값으로 다시 세운 병합에서 올렸다.
 * 사거리를 모서리-모서리(bwCombat.reachTiles)로 재고, 지상 주력의 가속을 없애고
 * (flingy.dat movement_type==2는 첫 틱부터 최고속), 하차 간격을 15가 아닌 18프레임으로
 * 고친 판이다. 자취 좌표·사망 시각이 전부 달라졌으므로 v2 캐시를 그대로 쓰면 화면에는
 * 이번 작업이 하나도 안 보인다 — IndexedDB 열쇠가 `${cacheKey}:v${SIM_VERSION}`라
 * 이 숫자 하나가 옛 결과와 새 결과를 가르는 전부다.
 * 올리는 것은 병합마다 정확히 한 번이어야 한다. 갈래마다 올리면 서로 덮어써
 * 결국 안 올린 것과 같아진다(지난 병합이 그렇게 무너졌다).
 *
 * v4 (과제 #70): 길찾기를 A*로 바꾸면서 대각 모서리 자르기를 막아 자취가 달라졌고,
 * 자취·사건을 숫자 배열이 아니라 32비트 실수 배열로 내보낸다. 옛 캐시는 모양도 값도
 * 다른 판이라 그대로 두면 화면에 이번 작업이 하나도 안 보인다. */
/* 5(이번 판) — 건물 틈(몸 상자 충돌·잔 눈금 길찾기)·SCV 수리·메딕 힐·편 가르기가
   한꺼번에 들어와 자취와 사건이 통째로 달라졌다. 판 번호를 안 올리면 옛 캐시가 그대로
   나와 이번 작업이 화면에 하나도 안 보인다. */
export const SIM_VERSION = 6;

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
  // console.info는 개발자도구 기본 필터에서 감춰지는 자리가 있다 — log로 남긴다.
  // eslint-disable-next-line no-console
  console.log(`[sim] ${msg}`);
}

/* 깃발은 모듈이 올라오는 순간 한 번 읽어 둔다(지적: 주소에 ?sim=1을 붙였는데 아무것도
   안 뜬다) — 활동 화면 라우터가 주소를 여러 번 갈아 끼우므로, 렌더마다 location을
   다시 읽으면 그 사이에 놓칠 수 있다. 한 번 켜지면 그 탭에서는 계속 켜져 있게
   sessionStorage에도 적어 둔다(새로고침·화면 이동에도 유지). */
export const SIM_FLAG = ((): boolean => {
  if (typeof location === "undefined") return false;
  const inUrl = /[?&#]sim=1\b/.test(location.href);
  try {
    if (inUrl) sessionStorage.setItem("scr-sim", "1");
    if (sessionStorage.getItem("scr-sim") === "1") return true;
  } catch { /* 사생활 모드 등 — 주소만 본다. */ }
  return inUrl;
})();

if (SIM_FLAG) logSim(`깃발 켜짐 — 빌드 SIM_VERSION ${SIM_VERSION}, 주소 ${typeof location !== "undefined" ? location.search : ""}`);

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
        done({
          tracks: m.tracks, events: m.events ?? new Float32Array(0),
          stats: m.stats as SimResult["stats"],
        });
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
