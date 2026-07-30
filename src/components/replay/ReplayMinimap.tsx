import { useEffect, useRef } from "react";
import { Skull } from "lucide-react";
import Avatar from "../common/Avatar";
import RaceBadge from "../common/RaceBadge";
import { cx } from "../../utils/format";
import type { ReplayMapGrid } from "../../utils/replayParser";
import type { Race } from "../../types";

// 리플레이에서 읽은 지형 격자를 미니맵으로 그린다.
//
// 게임에서 보던 그 미니맵은 만들 수 없다 — 타일 번호를 픽셀로 바꾸는 그래픽(tileset의
// cv5/vx4/vr4와 팔레트)은 게임 설치본에 있는 저작물이라 리플레이에 없다. 그래서 여기서
// 그리는 건 '타일 종류를 색으로 구분한 개략도'다. 그것만으로도 본진 여덟 자리·램프·중앙
// 광장·미네랄 벽이 또렷하게 나온다(실측 확인).
//
// 색은 타일 그룹 번호를 '작은 번호 → 큰 번호' 순서의 색 램프에 얹어 만든다(아래 rampOf).
//
// 처음에는 번호를 해시해 색을 흩뿌렸다. 빠른무한(타일 그룹 37~38개)에서는 그럭저럭 보였지만,
// 실제 래더맵을 넣어 보고 못 쓴다는 것이 드러났다 — 투혼(Jungle 타일셋)은 그룹이 642개라
// 색이 완전한 색종이 눈이 되어 지형이 아예 안 읽혔다(실측).
//
// 램프로 바꾼 근거: 타일셋의 그룹은 지형 종류 순으로 늘어서 있어(cv5) 번호가 가까운 그룹은
// 같은 지형 계열이다. 그래서 번호 순서를 밝기·색조에 그대로 얹으면 같은 계열이 비슷한 색이
// 되어 면이 뭉치고, 절벽·벽처럼 다른 계열은 띠로 갈린다. 투혼과 빠른무한 둘 다에서 확인했다.
//
// 여기서 못 하는 것도 분명히 해 둔다: 어느 면이 언덕이고 어느 띠가 다리·램프인지 '이름을
// 붙이는' 일은 이 방법으로 안 된다. 그 표(그룹 → 지형 종류)는 게임 설치본의 타일셋 파일에
// 있고 리플레이에는 없다. 세 가지 방법을 실제로 재 보고 다 접었다:
//   ① 빈도로 가르기 — 상위 6개 그룹이 맵의 23%만 덮었고 순서도 뒤집혔다.
//   ② 응집도로 면 찾기 — 같은 지형 안에서도 인접 타일이 다른 그룹이라 의미가 없었다
//      (투혼에서 '넓은 면'으로 잡힌 그룹 0개).
//   ③ '확실히 걸을 수 있는 자리'를 표본으로 삼기 — 본진 좌표·자원 옆 타일·실제 이동 명령
//      좌표에 나온 그룹을 걸을 수 있는 땅으로 보고 마스크를 만들었다. 본진만 쓰면 여덟 자리가
//      서로 안 이어지고(빠른무한 8덩어리, 투혼 200덩어리), 명령 좌표를 넣으면 마스크가
//      85~99%로 부풀어 아무것도 가르지 못했다 — 명령은 절벽 위·물 위로도 찍히기 때문이다.
// 그래서 지형에 이름을 붙이려면 맵마다 사람이 적어 준 표(입구·언덕·다리 좌표)를 들고 오는
// 수밖에 없다. 지금 그리는 것은 어디까지나 '색으로 구분한 개략도'다.
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

// 맵의 이만큼 안쪽까지를 '가장자리'로 보고 닉네임을 안쪽으로 붙인다.
const EDGE = 0.22;

// 본진 아바타 크기 — 지금 문장의 주인공(ON)과 나머지(OFF). 차이를 크게 벌려 둔다(요청:
// 언급된 유저는 더 확실하게 크게, 기본은 축소).
const AVATAR_ON = 28;
const AVATAR_OFF = 13;

/** 본진에서 그 일이 있었던 자리까지 이어지는 화살표 하나(요청). 공격만이 아니라 "센터에
 *  포토를 지었다"처럼 자리가 남는 모든 장면이 대상이다. */
export interface MinimapArrow {
  key: string;
  /** 타일 좌표 — 시작(본진)과 끝(공격 자리). */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  team: 1 | 2 | undefined;
  /** 날아서·워프로 간 것인가 — 곧은 점선으로 그린다. 지상은 곡선(요청). */
  flight: boolean;
}

// 화살표 모양 — 값은 모두 타일 단위다(SVG viewBox가 타일 격자와 같다).
//
// 지상 이동을 곡선으로 그리라는 요청이 있었지만, 실제 이동 경로를 리플레이에서 알 수는 없다
// (위 주석: 어디가 절벽이고 어디가 다리인지 모른다). 그래서 '가운데 쪽으로 조금 휘는' 곡선을
// 쓴다 — 스타에서 지상군은 본진을 나와 가운데 길로 돌아 들어가기 때문에, 곧은 직선보다 이게
// 실제 동선에 가깝다. 대각(크로스) 자리끼리는 현이 이미 가운데를 지나므로 자연히 직선이
// 된다(휘는 양이 0이 된다). 벽을 정확히 피해 가는 경로는 지형 표가 없으면 그릴 수 없다.
const BEND = 0.22;
/** 시작·끝에서 이만큼 띄운다 — 아바타 밑에서 시작하면 화살표가 아바타에 가려 안 보인다. */
const GAP_FROM = 4.4;
/* 끝은 더 넉넉히 띄운다 — 목표 자리에는 그 사람 본진 아바타(커지면 지름 28px+테두리)가 있어
   화살촉이 그 밑에 들어가 안 보였다(지적: "화살촉이 다른 요소들에 가려짐"). */
const GAP_TO = 6;
/** 이보다 짧은 화살표는 그리지 않는다 — 자기 본진 안에서 벌어진 일은 '어디로 갔다'가 아니다.
 *  부르는 쪽에서도 같은 기준으로 걸러 낼 수 있게 내보낸다. */
export const ARROW_MIN_TILES = 8;
const MIN_LEN = ARROW_MIN_TILES;
const HEAD_LEN = 4.6;
const HEAD_WIDE = 2.6;

/** 팀 색 — 미니맵은 지형 위라 채도가 낮으면 두 편이 잘 안 갈린다(요청: 팀 구분이
 *  더 확실하게). CSS의 마커 테두리 색과 같은 값을 쓴다. */
const TEAM_COLOR: Record<number, string> = { 1: "#2b9bff", 2: "#ff4d68" };

/** 화살표 하나를 SVG 경로와 머리 삼각형으로 바꾼다. 그릴 값이 없으면 null. */
function arrowGeom(a: MinimapArrow, w: number, h: number) {
  const dx = a.x2 - a.x1;
  const dy = a.y2 - a.y1;
  const len = Math.hypot(dx, dy);
  if (len < MIN_LEN) return null;
  const ux = dx / len;
  const uy = dy / len;
  // 짧은 화살표는 띄우는 양·머리 크기를 길이에 맞춰 줄인다 — 고정값을 쓰면 가까운 곳으로 간
  // 화살표가 몸통 없이 화살촉만 남아 지형 위에 얼룩처럼 찍혔다(실측 스크린샷).
  const gapFrom = Math.min(GAP_FROM, len * 0.2);
  const gapTo = Math.min(GAP_TO, len * 0.22);
  const headLen = Math.min(HEAD_LEN, len * 0.3);
  const headWide = HEAD_WIDE * (headLen / HEAD_LEN);
  const x1 = a.x1 + ux * gapFrom;
  const y1 = a.y1 + uy * gapFrom;
  const x2 = a.x2 - ux * gapTo;
  const y2 = a.y2 - uy * gapTo;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  let cx0 = mx;
  let cy0 = my;
  if (!a.flight) {
    // 현에 수직인 방향 중 맵 가운데를 향하는 쪽으로 휜다. 휘는 양은 '가운데까지의 수직
    // 거리'를 넘지 않게 잡는다 — 그래서 현이 이미 가운데를 지나면 휘지 않는다.
    const nx = -uy;
    const ny = ux;
    const d = nx * (w / 2 - mx) + ny * (h / 2 - my);
    const amt = Math.sign(d) * Math.min(len * BEND, Math.abs(d));
    cx0 = mx + nx * amt;
    cy0 = my + ny * amt;
  }
  // 머리 방향은 곡선의 끝 접선(2차 베지에는 끝점 - 제어점).
  const tx = x2 - cx0;
  const ty = y2 - cy0;
  const tl = Math.hypot(tx, ty) || 1;
  const hx = tx / tl;
  const hy = ty / tl;
  const bx = x2 - hx * headLen;
  const by = y2 - hy * headLen;
  return {
    d: `M ${x1} ${y1} Q ${cx0} ${cy0} ${x2} ${y2}`,
    head: `${x2},${y2} ${bx - hy * headWide},${by + hx * headWide} ${bx + hy * headWide},${by - hx * headWide}`,
  };
}

/** 미니맵 위에 놓을 표시 하나. */
export interface MinimapMarker {
  /** 리플레이 원본 게임 아이디 — 목록 키로도 쓴다. */
  key: string;
  /** 화면에 보일 이름. */
  name: string;
  avatar: string | null;
  memberId: string;
  /** ""는 screp이 종족을 못 읽은 드문 경우 — RaceBadge가 그대로 받아 빈칸으로 그린다. */
  race: Race | "";
  team: 1 | 2 | undefined;
  /** 타일 좌표. */
  x: number;
  y: number;
  /** 이름까지 함께 보일까 — 본진 표시는 이름을 단다(요청). */
  withName: boolean;
  /** 검색 중 짚어야 할 사람인가 — 로스터를 감춘 모바일에서는 여기가 유일한 표시 자리다. */
  highlight: boolean;
  /** 그 시점에 궤멸됐거나 빈사 상태인가 — 본진에 해골을 얹는다(요청). */
  downed?: boolean;
  /** 지금 문장에 이름이 나온 사람인가 — 아바타를 크게 키운다(요청). */
  featured?: boolean;
}

export default function ReplayMinimap({
  grid, bases, arrows = [], className,
}: {
  grid: ReplayMapGrid;
  /** 늘 보이는 본진 표시(요청: 본진은 아바타+닉네임 계속 표시). 지금 문장의 주인공은
   *  featured로 크게 그린다 — 자리마다 아바타를 따로 띄우는 표시는 없앴다(요청). */
  bases: MinimapMarker[];
  /** 본진 → 그 일이 있었던 자리로 잇는 화살표(요청). */
  arrows?: MinimapArrow[];
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // 사람이 올려 둔 실제 미니맵 그림이 있으면 캔버스를 아예 안 그린다(요청).
    if (grid.image) return;
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

  const place = (m: MinimapMarker) => ({
    left: `${(m.x / grid.width) * 100}%`,
    top: `${(m.y / grid.height) * 100}%`,
  });

  /** 닉네임을 아바타 어느 쪽에 붙일까 — 가장자리 본진에서 가운데 정렬로 두면 이름이 그림
   *  밖으로 나가 잘린다(실제로 오른쪽 아래 본진의 이름이 잘렸다). 맵의 어느 쪽에 있는지
   *  보고 안쪽으로 붙인다. 아래쪽 본진은 이름을 아바타 위로 올린다. */
  const labelSide = (m: MinimapMarker): string => {
    const fx = m.x / grid.width;
    const fy = m.y / grid.height;
    return cx(
      fx < EDGE ? "scr-minimap-mark-lab-r" : fx > 1 - EDGE ? "scr-minimap-mark-lab-l" : "",
      fy > 1 - EDGE ? "scr-minimap-mark-lab-up" : "",
    );
  };
  // 그릴 화살표만 미리 계산한다 — 몸통 레이어와 머리 레이어가 같은 값을 쓴다.
  const geoms = arrows
    .map((a) => ({ a, g: arrowGeom(a, grid.width, grid.height) }))
    .filter((v): v is { a: MinimapArrow; g: NonNullable<ReturnType<typeof arrowGeom>> } => v.g !== null);

  return (
    <div className={cx("scr-minimap", className)}>
      {/* 사람이 올려 둔 실제 미니맵 그림이 있으면 그것을, 없으면 타일 격자로 그린 개략도를
          쓴다(요청: 물·풀·땅·벽을 실제와 비슷하게). 아바타·화살표는 좌표를 비율로 얹으므로
          어느 쪽이든 같은 자리에 놓인다. */}
      {grid.image ? (
        <img className="scr-minimap-canvas" src={grid.image} alt={`${grid.name} 미니맵`} />
      ) : (
        <canvas ref={canvasRef} className="scr-minimap-canvas" aria-label={`${grid.name} 미니맵`} />
      )}
      {/* 화살표 — 몸통은 지형 위·아바타 아래에 둔다. viewBox를 타일 격자와 같게 두어 좌표를
          그대로 쓰고, preserveAspectRatio를 끄면 아바타(퍼센트 위치)와 같은 자리에 놓인다.
          화살촉만은 아바타 위에 올린 별도 레이어에 그린다(아래) — 어디를 쳤는지가 이 그림에서
          가장 중요한 정보인데, 목표 자리의 아바타·이름표에 가려 안 보였다(지적). */}
      <svg
        className="scr-minimap-arrows" aria-hidden
        viewBox={`0 0 ${grid.width} ${grid.height}`} preserveAspectRatio="none"
      >
        {geoms.map(({ a, g }) => (
          <g key={`arw-${a.key}`} stroke={TEAM_COLOR[a.team ?? 0] ?? "#d8dee6"}>
            {/* 어두운 지형에도 밝은 지형에도 걸치므로 검은 테를 한 겹 깔아 둔다. */}
            <path
              d={g.d} className="scr-minimap-arrow-halo" fill="none"
              strokeDasharray={a.flight ? "3 2.4" : undefined}
            />
            <path
              d={g.d} fill="none" className="scr-minimap-arrow"
              strokeDasharray={a.flight ? "3 2.4" : undefined}
            />
          </g>
        ))}
      </svg>
      {bases.map((m) => (
        <span
          key={`base-${m.key}`}
          className={cx("scr-minimap-mark", "scr-minimap-mark-base",
            m.team === 1 && "scr-minimap-mark-t1", m.team === 2 && "scr-minimap-mark-t2",
            m.highlight && "scr-minimap-mark-hit",
            m.downed && "scr-minimap-mark-downed",
            m.featured && "scr-minimap-mark-on",
            labelSide(m))}
          style={place(m)}
        >
          {/* 지금 문장의 주인공은 확실히 크게, 나머지는 작게(요청) — 크기 차이가 곧
              "이 문장은 이 사람 이야기"라는 표시다. */}
          <Avatar
            member={{ id: m.memberId, nickname: m.name, avatar: m.avatar }}
            size={m.featured ? AVATAR_ON : AVATAR_OFF}
          />
          {/* 궤멸·빈사 — 본진 위에 해골을 얹는다(요청). 아바타는 흑백으로 눌러 두어
              해골이 그 사람 자리에 붙은 표시로 읽히게 한다. */}
          {m.downed && <Skull className="scr-minimap-mark-skull" size={14} aria-label="궤멸" />}
          {m.withName && (
            <span className="scr-minimap-mark-label">
              <span className="scr-minimap-mark-name">{m.name}</span>
              {/* 로스터를 감춘 모바일에서 종족이 통째로 사라지지 않게 여기 함께 붙인다. */}
              <RaceBadge race={m.race} size={11} circleLetter className="scr-minimap-mark-race" />
            </span>
          )}
        </span>
      ))}
      {/* 화살촉 — 아바타·이름표 위에 올린다(지적: 화살촉이 다른 요소들에 가려짐). 몸통까지
          위로 올리면 긴 화살표가 남의 얼굴을 가로지르므로 머리만 올린다. */}
      <svg
        className="scr-minimap-arrow-tips" aria-hidden
        viewBox={`0 0 ${grid.width} ${grid.height}`} preserveAspectRatio="none"
      >
        {geoms.map(({ a, g }) => (
          <polygon
            key={`tip-${a.key}`} points={g.head}
            className="scr-minimap-arrow-head" fill={TEAM_COLOR[a.team ?? 0] ?? "#d8dee6"}
          />
        ))}
      </svg>
    </div>
  );
}
