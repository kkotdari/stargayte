import { useEffect, useRef } from "react";
import { cx } from "../../utils/format";
import type { ReplayMapGrid } from "../../utils/replayParser";

// 리플레이의 타일 격자를 캔버스에 '개략도'로 그린다 — 게임과 같은 색의 미니맵이 아니다.
//
// 타일 번호를 픽셀로 바꾸는 그래픽(tileset의 cv5/vx4/vr4와 팔레트)은 게임 설치본에 있는
// 저작물이라 리플레이에 없다. 물·풀·땅·벽에 이름을 붙여 보려는 시도를 네 번 하고 접었다:
//   ① 빈도로 가르기 — 상위 6개 그룹이 맵의 23%만 덮었고 순서도 뒤집혔다.
//   ② 응집도로 면 찾기 — 같은 지형 안에서도 인접 타일이 다른 그룹이라 의미가 없었다
//      (투혼에서 '넓은 면'으로 잡힌 그룹 0개).
//   ③ '확실히 걸을 수 있는 자리'를 표본으로 삼기 — 본진·자원 옆·이동 명령 좌표로 마스크를
//      만들었더니 본진끼리 안 이어지거나(투혼 200덩어리) 마스크가 99%로 부풀었다.
//   ④ 그룹 덩어리별로 칠해 실제 미니맵과 대조 — 물·언덕이 갈리지 않았다.
// 그래서 실제와 같은 그림은 사람이 올린다(운영 메뉴의 미니맵 화면). 여기서 그리는 개략도는
// 그림이 없는 맵의 대체물이고, 그 화면에서 '어느 맵인지 알아보는' 미리보기로도 쓴다.
//
// 테마(라이트/다크)에 따라 바꾸지 않는다 — 이건 글이 아니라 지도 그림이라, 두 테마에서
// 같은 그림으로 보이는 편이 낫다.

/** 타일 그룹 번호 → 색.
 *
 *  근거: 타일셋 파일(cv5)의 그룹은 지형 종류 순으로 늘어서 있다. 그래서 번호가 가까우면 같은
 *  지형 계열이고, 번호를 색에 얹으면 같은 계열이 한 색으로 뭉친다. 낮은 번호는 어둡고 푸른
 *  쪽(물·낮은 땅), 높은 번호는 밝고 초록·누런 쪽(언덕 계열)에 둔다.
 *
 *  로그로 눌러 쓴다 — 실제 맵은 낮은 번호 몇 개가 면적을 다 차지하고(투혼: 그룹 2~9가 전체의
 *  4분의 1) 높은 번호 수백 개가 경계 타일 몇 개씩을 나눠 갖는다. 번호를 그대로 쓰면 넓은 면이
 *  전부 같은 색이 되고, 순위로 쓰면(예전 방식) 경계 타일들이 색 대비를 독차지해 화면이
 *  자글자글했다(실측: 투혼이 색종이 눈처럼 보였다). 로그는 그 사이를 잡는다. */
const GROUP_SCALE = Math.log2(1 + 1024);

function rampOf(group: number): string {
  const t = Math.min(1, Math.log2(1 + group) / GROUP_SCALE);
  return `hsl(${190 - t * 90} ${14 + t * 22}% ${16 + t * 44}%)`;
}

/** 타일셋 파일(cv5)에서 이 번호 이상의 그룹은 지형이 아니라 장식(doodad)이다 — 나무·바위·
 *  잔해 같은 것들이고, 지형 그룹 1024칸 뒤에 이어 붙는다. 리플레이 격자에도 그대로 들어 있어
 *  투혼에서는 타일의 12.9%가 이것이었다(실측: 최대 그룹 번호 1576).
 *
 *  이걸 지형처럼 칠하면 나무가 온 맵에 밝은 점으로 흩뿌려져 지형이 아예 안 읽힌다(실측).
 *  그래서 '아직 모름'으로 비우고 주변 지형으로 메운다 — 나무 아래도 땅은 이어져 있다. */
const DOODAD_GROUP = 1024;
/** 지운 자리를 주변 최빈값으로 메우는 횟수 — 장식이 뭉쳐 있는 곳도 몇 번이면 채워진다. */
const FILL_PASSES = 4;

/** 지형만 남긴 격자를 만든다 — 장식으로 보이는 종류를 지우고 주변 지형으로 메운 뒤, 남은
 *  점 하나짜리 얼룩을 3×3 최빈값으로 한 번 문지른다.
 *
 *  최빈값을 쓰는 이유: 평균과 달리 없던 종류를 새로 만들지 않아 절벽·벽의 경계가 흐려지지
 *  않는다. 빠른무한처럼 그룹이 몇십 개뿐인 맵은 장식으로 걸리는 종류가 거의 없어 그림이
 *  거의 그대로 남는다(얇은 미네랄 벽이 지워지지 않는 것도 확인했다). */
function terrainOf(src: Uint8Array, palette: number[], w: number, h: number): Uint8Array {
  const n = w * h;
  // -1은 '아직 모름'. 장식 자리를 비우고 주변 지형으로 메운다.
  let cur = new Int16Array(n);
  for (let i = 0; i < n; i += 1) {
    cur[i] = (palette[src[i]] ?? 0) >= DOODAD_GROUP ? -1 : src[i];
  }
  const count = new Int32Array(256);
  const mode = (grid: Int16Array, x: number, y: number, fallback: number): number => {
    let best = fallback;
    let bestN = 0;
    const seen: number[] = [];
    for (let dy = -1; dy <= 1; dy += 1) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        const v = grid[yy * w + xx];
        if (v < 0) continue;
        if (count[v] === 0) seen.push(v);
        count[v] += 1;
        // 같은 표를 받으면 가운데 값이 이긴다 — 원래 지형을 함부로 바꾸지 않는다.
        if (count[v] > bestN || (count[v] === bestN && v === fallback)) { best = v; bestN = count[v]; }
      }
    }
    seen.forEach((v) => { count[v] = 0; });
    return best;
  };

  for (let pass = 0; pass < FILL_PASSES; pass += 1) {
    let left = 0;
    const next = new Int16Array(cur);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = y * w + x;
        if (cur[i] >= 0) continue;
        const v = mode(cur, x, y, -1);
        if (v < 0) left += 1;
        else next[i] = v;
      }
    }
    cur = next;
    if (left === 0) break;
  }

  const out = new Uint8Array(n);
  // 끝까지 못 메운 자리(장식만 모여 있던 곳)는 원래 값을 쓴다.
  for (let i = 0; i < n; i += 1) out[i] = cur[i] < 0 ? src[i] : cur[i];
  const smoothed = new Uint8Array(n);
  const asI16 = new Int16Array(out);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) smoothed[y * w + x] = mode(asI16, x, y, out[y * w + x]);
  }
  return smoothed;
}

// 타일 하나를 몇 픽셀로 그릴까 — 화면에 200~360px로 보이는 그림이라 이 정도면 충분하고,
// 실제 표시 크기보다 크게 그려 두면 브라우저가 줄이면서 알아서 다듬어 준다.
const PX_PER_TILE = 4;

/** 격자를 그린 캔버스 하나. 크기는 CSS가 정한다(부모를 꽉 채운다). */
export default function ReplayMapCanvas({ grid, className }: { grid: ReplayMapGrid; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // base64 → 팔레트 첨자 바이트.
    const bin = atob(grid.tiles);
    const { width: w, height: h, palette } = grid;
    const idxs = new Uint8Array(w * h);
    for (let i = 0; i < idxs.length; i += 1) idxs[i] = bin.charCodeAt(i);
    const tiles = terrainOf(idxs, palette, w, h);
    canvas.width = w * PX_PER_TILE;
    canvas.height = h * PX_PER_TILE;
    // 첨자 → 그룹 번호 → 색을 미리 한 벌 만들어 두고 타일마다 찾아 쓴다.
    const colors = palette.map((group) => rampOf(group));
    // 같은 색이 이어지는 구간을 한 번에 칠한다 — 타일마다 fillRect를 부르면 128×128에
    // 16384번이라 눈에 띄게 느리다(한 화면에 카드가 여럿이면 더욱).
    for (let y = 0; y < h; y += 1) {
      let runStart = 0;
      let runIdx = -1;
      for (let x = 0; x <= w; x += 1) {
        const idx = x < w ? tiles[y * w + x] : -2;
        if (idx === runIdx) continue;
        if (runIdx >= 0) {
          ctx.fillStyle = colors[runIdx] ?? colors[0];
          ctx.fillRect(runStart * PX_PER_TILE, y * PX_PER_TILE, (x - runStart) * PX_PER_TILE, PX_PER_TILE);
        }
        runStart = x;
        runIdx = idx;
      }
    }
    // 자원 지대(앞마당·멀티) — 미네랄은 옅은 청록, 가스 낀 곳은 초록으로 점을 찍는다(요청:
    // 자원 위치). 지형 위에 얹는 정적 표시라 마커가 아니라 여기 캔버스에 함께 그린다.
    for (const [rx, ry, gas] of grid.resources ?? []) {
      ctx.beginPath();
      ctx.arc(rx * PX_PER_TILE, ry * PX_PER_TILE, gas ? 3.5 : 2.6, 0, Math.PI * 2);
      ctx.fillStyle = gas ? "rgba(90,220,140,0.95)" : "rgba(120,210,235,0.9)";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.stroke();
    }
  }, [grid]);

  return (
    <canvas
      ref={canvasRef} className={cx("scr-minimap-canvas", className)}
      aria-label={`${grid.name} 미니맵`}
    />
  );
}
