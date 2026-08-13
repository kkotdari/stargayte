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

/** 같은 값으로 이어진 작은 고립 조각을 주변 값으로 뒤집는다(분석 ④). 4방향 연결. */
function fillSpecks(w: number, h: number, walk: Uint8Array): void {
  const WALK_SPECK_MAX = 5;
  const BLOCK_SPECK_MAX = 2;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const comp: number[] = [];
  for (let start = 0; start < w * h; start += 1) {
    if (seen[start]) continue;
    const v = walk[start];
    const cap = v === 1 ? WALK_SPECK_MAX : BLOCK_SPECK_MAX;
    stack.length = 0;
    comp.length = 0;
    stack.push(start);
    seen[start] = 1;
    let small = true;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      comp.push(cur);
      if (comp.length > cap) { small = false; }
      const x = cur % w;
      for (const d of [-1, 1, -w, w]) {
        const nx = cur + d;
        if (nx < 0 || nx >= w * h || seen[nx] || walk[nx] !== v) continue;
        if (Math.abs((nx % w) - x) > 1) continue; // 줄 끝 감김 금지
        seen[nx] = 1;
        stack.push(nx);
      }
    }
    if (small) for (const i of comp) walk[i] = v === 1 ? 0 : 1;
  }
}

const cache = new Map<string, Promise<TerrainGrid | null>>();

/** 그림을 격자로 내려 읽는다 — 검수 화면(초기값)과 재생 화면(저장값 없을 때)이 함께 쓴다.
 *  anchors(0~1 분수 좌표)는 '반드시 걷는 땅'인 자리들이다 — 자원 지대·시작점(지적: 빠른
 *  무한에서 반전 — 그림만 보는 추측의 한계라, 정답을 아는 칸으로 보정한다). */
export async function analyzeMinimap(
  url: string, anchors?: [number, number][],
): Promise<TerrainGrid | null> {
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
  /* ①·② 먼저 — 우주·물·능선을 거른 '땅 후보'를 만든다. ③의 주요 색은 이 후보 안에서만
     센다(지적: 우주맵에서 가능/불가가 반대로 — 우주(검정)가 맵의 주요 색이 되면서 정작
     플랫폼 땅 색들이 소수파로 몰려 통째로 막혔다). */
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
    walk[i] = 1;
  }
  /* ③ 색·패턴 순위(요청: 색뿐 아니라 패턴도 — 바둑판 타일) — 칸의 열쇠를 '제 색 +
     이웃(4방향) 다수색'의 정렬 쌍으로 만든다. 바둑판처럼 두 색이 교대하는 타일은 양쪽
     칸이 같은 쌍(A,B)을 갖게 돼 한 무리로 묶이고, 단색 땅은 (A,A)다. 이 열쇠의 소수파
     (장식·바위)만 막는다. */
  const patternKeyOf = (i: number): number => {
    const own = keyOf(i);
    const x = i % w;
    const counts = new Map<number, number>();
    for (const d of [-1, 1, -w, w]) {
      const nx = i + d;
      if (nx < 0 || nx >= w * h) continue;
      if (Math.abs((nx % w) - x) > 1) continue;
      const k = keyOf(nx);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    let nb = own;
    let best = 0;
    for (const [k, n] of counts) {
      if (n > best || (n === best && k < nb)) { best = n; nb = k; }
    }
    /* 같은 색이라도 결이 다르면 딴 요소다(지적) — 국소 대비(제 밝기 − 주변 평균)를
       넉 단계로 접어 열쇠에 붙인다. 매끈한 바닥과 같은 색의 우둘투둘한 장식이 갈린다. */
    const diff = Math.abs(lum[i] - localAvg[i]);
    const grain = diff < 6 ? 0 : diff < 14 ? 1 : diff < 26 ? 2 : 3;
    return (own <= nb ? own * 512 + nb : nb * 512 + own) * 4 + grain;
  };
  const freq = new Map<number, number>();
  let candidates = 0;
  for (let i = 0; i < w * h; i += 1) {
    if (!walk[i]) continue;
    candidates += 1;
    freq.set(patternKeyOf(i), (freq.get(patternKeyOf(i)) ?? 0) + 1);
  }
  const MINOR_SHARE = 0.015;
  const majors = new Set<number>();
  let majorCells = 0;
  for (const [k, n] of freq) {
    if (n >= candidates * MINOR_SHARE) { majors.add(k); majorCells += n; }
  }
  /* 앵커 학습 분류기(지적: 빠른무한이 완전 엉망 — 색 규칙들이 서로 싸운다) — 앵커가
     충분하면 규칙 더미 대신 발상을 바꾼다: 앵커(자원 지대) 반경 2칸은 확실한 땅이니,
     거기서 땅의 '색 가족'과 '밝기 대역'을 배우고, 그와 닮은 칸을 전부 연다.
       · 색 가족 — 표본 칸들의 뭉친 색(8단계/채널) 집합.
       · 밝기 대역 — 표본 밝기의 5~95% 구간을 0.75~1.25배로 벌린 범위.
     걷는 칸 = 우주·물이 아니고 (색 가족이거나 밝기 대역 안). 절벽·벽은 땅보다 뚜렷이
     어둡거나 밝아 대역 밖으로 떨어진다. 광장처럼 색이 달라도 밝기가 땅급이면 열린다. */
  const anchorIdx: number[] = [];
  for (const [fx, fy] of anchors ?? []) {
    const ax = Math.min(w - 1, Math.max(0, Math.round(fx * w)));
    const ay = Math.min(h - 1, Math.max(0, Math.round(fy * h)));
    anchorIdx.push(ay * w + ax);
  }
  if (anchorIdx.length >= 3) {
    /* 앵커 분류기 셋째 판(지적: 빠른무한 벽 통과 + 투혼 유적 통과·풀 차단) — 핵심은 표본
       정화다: 자원 곁 표본에는 미네랄 결정(밝음)과, 벽에 붙은 자원의 벽 픽셀(어두움)이
       섞여 팔레트를 오염시킨다. 표본 밝기 중앙값의 0.85~1.3배 밖 표본은 버린다.
       판정은 셋 중 하나면 땅:
         · 정화 팔레트와의 색 거리 ≤ 45
         · 좁은 밝기 대역(정화 표본 30~70% × 0.9~1.1)
         · 전역 우세 가족 — 맵 전체에서 4% 이상 깔린 색이면서 평균 밝기가 땅 대역 언저리
           (풀처럼 앵커 곁엔 없지만 넓게 깔린 걷는 장식) */
    /* 표본은 자원 그 자리가 아니라 '자원에서 맵 중심 쪽으로 3칸 들어간 자리'에서 뽑는다
       (지적: 빠른무한 그대로 — 자원이 벽·가장자리에 붙은 맵은 자원 곁 표본의 다수가
       미네랄·구조물이라, 중앙값 정화가 진짜 바닥(어두운 체커)을 오염으로 버렸다).
       자원 안쪽은 일꾼이 드나드는 트인 바닥이 확실하다. */
    const rawSamples: number[] = [];
    for (const ai of anchorIdx) {
      let ax = ai % w;
      let ay = Math.floor(ai / w);
      const vx = w / 2 - ax;
      const vy = h / 2 - ay;
      const vlen = Math.hypot(vx, vy);
      if (vlen > 1) {
        ax = Math.min(w - 1, Math.max(0, Math.round(ax + (vx / vlen) * 3)));
        ay = Math.min(h - 1, Math.max(0, Math.round(ay + (vy / vlen) * 3)));
      }
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const nx = ax + dx;
          const ny = ay + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          rawSamples.push(ny * w + nx);
        }
      }
    }
    const rawLums = rawSamples.map((i) => lum[i]).sort((a, b) => a - b);
    const med = rawLums[Math.floor(rawLums.length / 2)];
    const samples = rawSamples.filter((i) => lum[i] >= med * 0.85 && lum[i] <= med * 1.3);
    const acc = new Map<number, [number, number, number, number]>();
    const sampleLums: number[] = [];
    for (const ni of samples) {
      const k = keyOf(ni);
      const a = acc.get(k) ?? [0, 0, 0, 0];
      a[0] += data[ni * 4];
      a[1] += data[ni * 4 + 1];
      a[2] += data[ni * 4 + 2];
      a[3] += 1;
      acc.set(k, a);
      sampleLums.push(lum[ni]);
    }
    const palette: [number, number, number][] = [...acc.values()]
      .map(([r, g, b, n]) => [r / n, g / n, b / n] as [number, number, number]);
    sampleLums.sort((a, b) => a - b);
    const lo = sampleLums[Math.floor(sampleLums.length * 0.3)] * 0.9;
    const hi = sampleLums[Math.floor(sampleLums.length * 0.7)] * 1.1;
    // 전역 우세 가족 — 키별 칸 수·평균 밝기.
    const gcount = new Map<number, [number, number]>();
    for (let i = 0; i < w * h; i += 1) {
      const k = keyOf(i);
      const e = gcount.get(k) ?? [0, 0];
      e[0] += 1;
      e[1] += lum[i];
      gcount.set(k, e);
    }
    const dominant = new Set<number>();
    for (const [k, [n, lsum]] of gcount) {
      const meanL = lsum / n;
      if (n >= w * h * 0.04 && meanL >= lo * 0.95 && meanL <= hi * 1.05) dominant.add(k);
    }
    const PAL_DIST = 45;
    for (let i = 0; i < w * h; i += 1) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      const L = lum[i];
      walk[i] = 0;
      if (L < 15) continue; // 우주·심연
      if (b > r + 18 && b > g + 8 && L < 110) continue; // 물
      let near = false;
      for (const [pr, pg, pb] of palette) {
        const dr = r - pr;
        const dg = g - pg;
        const db = b - pb;
        if (dr * dr + dg * dg + db * db <= PAL_DIST * PAL_DIST) { near = true; break; }
      }
      if (near || (L >= lo && L <= hi) || dominant.has(keyOf(i))) walk[i] = 1;
    }
  }
  /* ④ 작은 빵꾸 메우기(요청) — 자잘한 고립 조각은 오판일 확률이 높아 주변 값으로 맞춘다.
     걷는 조각(벽 사이 빵꾸)은 5칸까지 막고, 막힌 점은 2칸까지만 연다 — 막힌 쪽을 크게
     열면 ③이 잡은 장식 타일이 도로 풀린다. */
  fillSpecks(w, h, walk);
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
export function terrainOf(url: string, anchors?: [number, number][]): Promise<TerrainGrid | null> {
  // 앵커 유무가 결과를 바꾼다 — 앵커 있는 호출(재생 화면)이 캐시를 갈아 끼운다.
  const key = anchors && anchors.length > 0 ? `${url}#a` : url;
  let hit = cache.get(key);
  if (!hit) {
    hit = analyzeMinimap(url, anchors).catch(() => null);
    cache.set(key, hit);
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
