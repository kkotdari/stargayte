/* ── 미니맵 이미지에서 지형(통행 가능) 격자 만들기(요청) ─────────────────────────
   리플레이에는 타일 통행 정보가 없다(타일셋 파일에만 있다). 대신 운영자가 미니맵 관리에서
   등록해 둔 실제 미니맵 그림이 있다 — 그 그림의 색이 곧 지형이다: 우주(스페이스 타일셋)는
   거의 검고, 물은 파랗다. 그림을 격자로 내려 읽어 "지상군이 걸을 수 있는 칸"의 지도를
   만들어 두면, 연속 재생의 지상 부대가 절벽·물·우주를 건너지 않는 궤적을 얻는다.

   완벽할 수는 없다 — 미니맵 색만으로 언덕 경사로(램프)까지는 못 가른다. 하지만 부대가
   물 한가운데를 가로지르는 종류의 거짓말은 여기서 다 걸러진다. 맵 하나에 한 번만 분석하고
   모듈 캐시에 둔다(이미지 해시가 같으면 그림도 같다 — 운영의 '같은 맵은 미니맵 하나' 규칙). */

export interface TerrainGrid {
  /** 격자 크기 — 타일 좌표를 cell로 나눈 값이다(연속 재생의 좌표와 같은 자). */
  w: number;
  h: number;
  /** 한 칸이 몇 타일인가. */
  cell: number;
  /** 행 우선 — 1이면 걸을 수 있는 땅으로 본다. */
  walk: Uint8Array;
}

/** 한 칸 = 2타일 — 128×128 맵이면 64×64칸. 길찾기(BFS)가 프레임 안에 끝나는 크기다. */
const CELL_TILES = 2;

const cache = new Map<string, Promise<TerrainGrid | null>>();

function classify(r: number, g: number, b: number): boolean {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  // 우주·심연 — 스페이스 타일셋의 바깥은 거의 검다.
  if (lum < 26) return false;
  // 물 — 파랑이 붉음을 뚜렷이 누르는 어두운 칸(정글·황혼·얼음의 강과 바다).
  if (b > r + 18 && b > g + 8 && lum < 110) return false;
  return true;
}

async function analyze(url: string, tilesW: number, tilesH: number): Promise<TerrainGrid | null> {
  if (!(tilesW > 0) || !(tilesH > 0) || typeof document === "undefined") return null;
  const img = new Image();
  img.crossOrigin = "anonymous";
  const loaded = await new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
  if (!loaded) return null;
  const w = Math.ceil(tilesW / CELL_TILES);
  const h = Math.ceil(tilesH / CELL_TILES);
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
  return { w, h, cell: CELL_TILES, walk };
}

/** 미니맵 그림 → 지형 격자(맵당 한 번, 캐시). 분석이 안 되는 그림은 null — 직선 폴백. */
export function terrainOf(url: string, tilesW: number, tilesH: number): Promise<TerrainGrid | null> {
  const key = `${url}|${tilesW}x${tilesH}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = analyze(url, tilesW, tilesH).catch(() => null);
    cache.set(key, hit);
  }
  return hit;
}

/** 두 타일 좌표 사이의 지상 경로(타일 좌표 꼭짓점들) — 격자 BFS. 시작·끝이 못 걷는 칸이면
 *  가까운 걷는 칸으로 옮겨 잡고, 길이 아예 없으면 null(부르는 쪽이 직선으로 폴백). */
export function groundPath(
  t: TerrainGrid, fromX: number, fromY: number, toX: number, toY: number,
): [number, number][] | null {
  const cellOf = (x: number, y: number): [number, number] => [
    Math.min(t.w - 1, Math.max(0, Math.floor(x / t.cell))),
    Math.min(t.h - 1, Math.max(0, Math.floor(y / t.cell))),
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
  const start = snap(cellOf(fromX, fromY));
  const goal = snap(cellOf(toX, toY));
  if (!start || !goal) return null;
  if (start[0] === goal[0] && start[1] === goal[1]) return [[toX, toY]];

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
      const cx = cur % t.w;
      const nx = next % t.w;
      if (Math.abs(cx - nx) > 1) continue;
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
  // 칸 가운데의 타일 좌표로 — 끝점만 실제 목적지 좌표를 쓴다(칸 가운데로 끌리면 어긋난다).
  const out: [number, number][] = cellsPath.map((i) => [
    (i % t.w) * t.cell + t.cell / 2,
    Math.floor(i / t.w) * t.cell + t.cell / 2,
  ]);
  out[out.length - 1] = [toX, toY];
  return out;
}
