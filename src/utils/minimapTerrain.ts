/* ── 미니맵 이미지에서 지형(이동 가능/불가) 격자 만들기(요청) ────────────────────
   리플레이에는 타일 통행 정보가 없다(타일셋 파일에만 있다). 대신 운영자가 미니맵 관리에서
   등록해 둔 실제 미니맵 그림이 있다 — 그 그림의 색이 곧 지형이다: 우주(스페이스 타일셋)는
   거의 검고, 물은 파랗다. 그림을 격자로 내려 읽어 "지상군이 걸을 수 있는 칸"의 지도를
   만들면, 연속 재생의 지상 부대가 절벽·물·우주를 건너지 않는 궤적을 얻는다.

   격자는 그림 기준이다(맵 타일 기준이 아니다) — 한 그림을 여러 맵(이름·판본만 다른 빠른
   무한 계열)이 함께 가리키므로, 타일 수에 못 박으면 그 묶음이 깨진다. 좌표는 전부
   0~1 분수로 주고받는다(마커·자취가 이미 비율로 얹히는 것과 같은 자).

   자동 분석은 어림이라(색만으로 언덕 램프까지는 못 가른다) 운영자가 미니맵 관리에서
   검수·수정한 값(minimap_images.walk)이 있으면 그쪽이 이긴다(요청). */

export interface TerrainGrid {
  w: number;
  h: number;
  /** 행 우선 — 1이면 걸을 수 있는 땅으로 본다. */
  walk: Uint8Array;
}

/** 가로 격자 수 — 세로는 그림 비율을 따른다. 96이면 128×128 맵에서 한 칸이 1.3타일쯤 —
 *  64에서 올렸다(지적: 벽을 전혀 못 잡는다 — 절벽선은 한두 타일 굵기라 굵은 격자에서는
 *  이웃 땅과 섞여 평균색이 밝아진다). */
const GRID_W = 96;
/** 상대 명암의 창 반지름(칸) — 절벽·벽 판정의 "주변"이 이만큼이다. */
const LOCAL_R = 4;
/** 주변 평균의 이 비율보다 어두우면 절벽·벽으로 본다(지적: 절대 밝기만으론 벽을 못 잡는다
 *  — 벽은 검은 게 아니라 제 주변보다 어두운 능선이다). */
const RIDGE_RATIO = 0.68;

const cache = new Map<string, Promise<TerrainGrid | null>>();

/** 그림을 격자로 내려 읽는다 — 검수 화면(초기값)과 재생 화면(저장값 없을 때)이 함께 쓴다. */
export async function analyzeMinimap(url: string): Promise<TerrainGrid | null> {
  if (typeof document === "undefined") return null;
  const img = new Image();
  img.crossOrigin = "anonymous";
  const loaded = await new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
  if (!loaded || !(img.naturalWidth > 0)) return null;
  const w = GRID_W;
  const h = Math.max(8, Math.round((GRID_W * img.naturalHeight) / img.naturalWidth));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  // 격자 크기로 바로 줄여 그린다 — 픽셀 하나가 곧 칸 하나의 평균색이다.
  ctx.drawImage(img, 0, 0, w, h);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    // 다른 출처의 그림이라 캔버스가 오염되면(CORS) 지형 없이 간다 — 직선 폴백.
    return null;
  }
  /* 두 겹으로 가른다(지적: 벽을 전혀 못 잡는다).
     ① 절대 규칙 — 우주(거의 검정)와 물(파랑 우세)은 색 자체가 답이다.
     ② 상대 규칙 — 절벽·벽·언덕 경계는 "제 주변(9×9칸)보다 뚜렷이 어두운 능선"이다.
        절대 밝기로는 못 잡는다: 어두운 타일셋에서는 온 땅이 어둡고, 밝은 타일셋에서는
        벽조차 밝다. 주변 평균 대비 비율이라야 타일셋을 안 탄다. */
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  // 가로·세로 두 번의 박스 블러로 주변 평균을 만든다 — O(w·h·r)면 96×96에 충분히 싸다.
  const rowAvg = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      let n = 0;
      for (let dx = -LOCAL_R; dx <= LOCAL_R; dx += 1) {
        const nx = x + dx;
        if (nx >= 0 && nx < w) { sum += lum[y * w + nx]; n += 1; }
      }
      rowAvg[y * w + x] = sum / n;
    }
  }
  const localAvg = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      let n = 0;
      for (let dy = -LOCAL_R; dy <= LOCAL_R; dy += 1) {
        const ny = y + dy;
        if (ny >= 0 && ny < h) { sum += rowAvg[ny * w + x]; n += 1; }
      }
      localAvg[y * w + x] = sum / n;
    }
  }
  /* ③ 색 순위(요청) — 칸 색을 뭉쳐(채널당 8단계) 넓게 깔린 '주요 타일' 색을 가려낸다.
     주요 색 무리 안에 드문드문 박힌 비주요 색(바위·수풀·장식 타일)은 걸을 수 없는 것으로
     본다. 뭉친 색 하나가 전체의 MINOR_SHARE(1.5%)를 못 넘으면 비주요다. 미니맵이 온통
     잘게 갈린 색이라 주요 색이 절반도 안 되면(그라데이션 심한 그림) 이 규칙은 접는다 —
     그때 켜면 맵이 통째로 불가가 된다. */
  const keyOf = (i: number): number =>
    ((data[i * 4] >> 5) << 6) | ((data[i * 4 + 1] >> 5) << 3) | (data[i * 4 + 2] >> 5);
  const freq = new Map<number, number>();
  for (let i = 0; i < w * h; i += 1) freq.set(keyOf(i), (freq.get(keyOf(i)) ?? 0) + 1);
  const MINOR_SHARE = 0.015;
  const majors = new Set<number>();
  let majorCells = 0;
  for (const [k, n] of freq) {
    if (n >= w * h * MINOR_SHARE) { majors.add(k); majorCells += n; }
  }
  const rankRule = majorCells >= w * h * 0.5;

  const walk = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const L = lum[i];
    // ① 절대 — 우주·심연.
    if (L < 26) continue;
    // ① 절대 — 물(파랑 우세).
    if (b > r + 18 && b > g + 8 && L < 110) continue;
    // ② 상대 — 주변보다 뚜렷이 어두운 능선(절벽·벽·언덕 경계).
    if (L < localAvg[i] * RIDGE_RATIO) continue;
    // ③ 색 순위 — 주요 타일이 아닌 색은 불가(요청).
    if (rankRule && !majors.has(keyOf(i))) continue;
    walk[i] = 1;
  }
  return { w, h, walk };
}

/** 격자 크기대로 내려 읽은 칸 색(RGBA) — 검수 화면의 "비슷한 유형 한꺼번에"(요청)가
 *  같은 색 계열을 찾는 재료다. 분석과 같은 방식으로 줄여 읽는다. */
export async function sampleMinimapColors(
  url: string, w: number, h: number,
): Promise<Uint8ClampedArray | null> {
  if (typeof document === "undefined") return null;
  const img = new Image();
  img.crossOrigin = "anonymous";
  const loaded = await new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
  if (!loaded) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  try {
    return ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }
}

/** 자동 분석의 캐시판 — 재생 화면이 쓴다(맵당 한 번). */
export function terrainOf(url: string): Promise<TerrainGrid | null> {
  let hit = cache.get(url);
  if (!hit) {
    hit = analyzeMinimap(url).catch(() => null);
    cache.set(url, hit);
  }
  return hit;
}

/* ── 저장 직렬화 — 서버(minimap_images.walk)에 JSON 문자열로 오간다. ───────────── */

export function encodeWalk(t: TerrainGrid): string {
  let hex = "";
  for (let i = 0; i < t.walk.length; i += 4) {
    let nib = 0;
    for (let j = 0; j < 4; j += 1) if (t.walk[i + j]) nib |= 1 << (3 - j);
    hex += nib.toString(16);
  }
  return JSON.stringify({ w: t.w, h: t.h, hex });
}

export function decodeWalk(json: string | null | undefined): TerrainGrid | null {
  if (!json) return null;
  try {
    const d = JSON.parse(json) as { w?: number; h?: number; hex?: string };
    if (!d || !(d.w! > 0) || !(d.h! > 0) || typeof d.hex !== "string") return null;
    const walk = new Uint8Array(d.w! * d.h!);
    for (let i = 0; i < d.hex.length; i += 1) {
      const nib = parseInt(d.hex[i], 16);
      for (let j = 0; j < 4; j += 1) {
        const idx = i * 4 + j;
        if (idx < walk.length && nib & (1 << (3 - j))) walk[idx] = 1;
      }
    }
    return { w: d.w!, h: d.h!, walk };
  } catch {
    return null;
  }
}

/* ── 길찾기 — 좌표는 0~1 분수다(마커와 같은 자). ─────────────────────────────── */

/** 두 자리 사이의 지상 경로(분수 좌표 꼭짓점들) — 격자 BFS(8방향). 시작·끝이 못 걷는
 *  칸이면 가까운 걷는 칸으로 옮겨 잡고, 길이 아예 없으면 null(부르는 쪽이 직선 폴백). */
export function groundPath(
  t: TerrainGrid, fx0: number, fy0: number, fx1: number, fy1: number,
): [number, number][] | null {
  const cellOf = (fx: number, fy: number): [number, number] => [
    Math.min(t.w - 1, Math.max(0, Math.floor(fx * t.w))),
    Math.min(t.h - 1, Math.max(0, Math.floor(fy * t.h))),
  ];
  const snap = ([cx, cy]: [number, number]): [number, number] | null => {
    if (t.walk[cy * t.w + cx]) return [cx, cy];
    for (let r = 1; r <= 4; r += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx >= 0 && ny >= 0 && nx < t.w && ny < t.h && t.walk[ny * t.w + nx]) return [nx, ny];
        }
      }
    }
    return null;
  };
  const start = snap(cellOf(fx0, fy0));
  const goal = snap(cellOf(fx1, fy1));
  if (!start || !goal) return null;
  if (start[0] === goal[0] && start[1] === goal[1]) return [[fx1, fy1]];

  const prev = new Int32Array(t.w * t.h).fill(-1);
  const startIdx = start[1] * t.w + start[0];
  const goalIdx = goal[1] * t.w + goal[0];
  prev[startIdx] = startIdx;
  const queue = [startIdx];
  // 8방향 — 대각을 허락해야 계단꼴 경로가 안 나온다.
  const dirs = [-1, 1, -t.w, t.w, -t.w - 1, -t.w + 1, t.w - 1, t.w + 1];
  let found = false;
  for (let qi = 0; qi < queue.length && !found; qi += 1) {
    const cur = queue[qi];
    for (const d of dirs) {
      const next = cur + d;
      if (next < 0 || next >= prev.length || prev[next] !== -1) continue;
      // 줄 끝에서 반대편으로 감기는 이웃은 버린다.
      if (Math.abs((cur % t.w) - (next % t.w)) > 1) continue;
      if (!t.walk[next]) continue;
      prev[next] = cur;
      if (next === goalIdx) { found = true; break; }
      queue.push(next);
    }
  }
  if (!found) return null;
  const cellsPath: number[] = [];
  for (let cur = goalIdx; cur !== startIdx; cur = prev[cur]) cellsPath.push(cur);
  cellsPath.reverse();
  // 칸 가운데의 분수 좌표로 — 끝점만 실제 목적지를 쓴다(칸 가운데로 끌리면 어긋난다).
  const out: [number, number][] = cellsPath.map((i) => [
    ((i % t.w) + 0.5) / t.w,
    (Math.floor(i / t.w) + 0.5) / t.h,
  ]);
  out[out.length - 1] = [fx1, fy1];
  return out;
}

/** BFS가 길을 못 찾을 때의 차선 — 못 걷는 칸도 '비싸게는' 지나가는 다익스트라(지적: 지상
 *  유닛이 벽을 막 통과해 직진). 격자가 검수·분석 오류로 조각나면 groundPath는 null이고,
 *  부르는 쪽의 직선 폴백이 벽을 그대로 그었다. 이 차선은 걷는 칸 위주로 돌아가되 정말
 *  막힌 자리만 최단으로 가로질러, 최악의 경우에도 "대체로 땅을 따라가는" 경로를 준다.
 *  시작·끝을 걷는 칸에 옮겨 잡을 필요도 없어(스냅 실패로 인한 null도 없다) 항상 답이 있다. */
const SOFT_WALL_COST = 30;
export function groundPathSoft(
  t: TerrainGrid, fx0: number, fy0: number, fx1: number, fy1: number,
): [number, number][] {
  const cx0 = Math.min(t.w - 1, Math.max(0, Math.floor(fx0 * t.w)));
  const cy0 = Math.min(t.h - 1, Math.max(0, Math.floor(fy0 * t.h)));
  const cx1 = Math.min(t.w - 1, Math.max(0, Math.floor(fx1 * t.w)));
  const cy1 = Math.min(t.h - 1, Math.max(0, Math.floor(fy1 * t.h)));
  const startIdx = cy0 * t.w + cx0;
  const goalIdx = cy1 * t.w + cx1;
  if (startIdx === goalIdx) return [[fx1, fy1]];
  const dist = new Float64Array(t.w * t.h).fill(Infinity);
  const prev = new Int32Array(t.w * t.h).fill(-1);
  dist[startIdx] = 0;
  // 이진 힙 — 96×96(9천여 칸)이면 몇 ms 안이다.
  const heap: number[] = [startIdx];
  const key = (i: number) => dist[i];
  const push = (i: number) => {
    heap.push(i);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (key(heap[p]) <= key(heap[c])) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = (): number => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        const r = l + 1;
        let m = c;
        if (l < heap.length && key(heap[l]) < key(heap[m])) m = l;
        if (r < heap.length && key(heap[r]) < key(heap[m])) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };
  const dirs: [number, number][] = [
    [-1, 1], [1, 1], [-t.w, 1], [t.w, 1],
    [-t.w - 1, Math.SQRT2], [-t.w + 1, Math.SQRT2], [t.w - 1, Math.SQRT2], [t.w + 1, Math.SQRT2],
  ];
  const settled = new Uint8Array(t.w * t.h);
  while (heap.length > 0) {
    const cur = pop();
    if (settled[cur]) continue;
    settled[cur] = 1;
    if (cur === goalIdx) break;
    for (const [d, step] of dirs) {
      const next = cur + d;
      if (next < 0 || next >= dist.length) continue;
      if (Math.abs((cur % t.w) - (next % t.w)) > 1) continue;
      const cost = dist[cur] + step * (t.walk[next] ? 1 : SOFT_WALL_COST);
      if (cost < dist[next]) {
        dist[next] = cost;
        prev[next] = cur;
        push(next);
      }
    }
  }
  if (prev[goalIdx] === -1) return [[fx1, fy1]]; // 있을 수 없지만 — 안전망은 직선.
  const cells: number[] = [];
  for (let cur = goalIdx; cur !== startIdx; cur = prev[cur]) cells.push(cur);
  cells.reverse();
  const out: [number, number][] = cells.map((i) => [
    ((i % t.w) + 0.5) / t.w,
    (Math.floor(i / t.w) + 0.5) / t.h,
  ]);
  out[out.length - 1] = [fx1, fy1];
  return out;
}
