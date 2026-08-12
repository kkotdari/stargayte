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

/** 가로 격자 수 — 세로는 그림 비율을 따른다. 64면 128×128 맵에서 한 칸이 2타일이다. */
const GRID_W = 64;

const cache = new Map<string, Promise<TerrainGrid | null>>();

function classify(r: number, g: number, b: number): boolean {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  // 우주·심연 — 스페이스 타일셋의 바깥은 거의 검다.
  if (lum < 26) return false;
  // 물 — 파랑이 붉음을 뚜렷이 누르는 어두운 칸(정글·황혼·얼음의 강과 바다).
  if (b > r + 18 && b > g + 8 && lum < 110) return false;
  return true;
}

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
  const walk = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    walk[i] = classify(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) ? 1 : 0;
  }
  return { w, h, walk };
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
