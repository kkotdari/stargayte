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
// 있고 리플레이에는 없다. 응집도로 면과 경계를 갈라 보는 방법도 시도했지만 실패했다 —
// 같은 지형 안에서도 인접 타일이 서로 다른 그룹이라 응집도가 의미를 갖지 않았다(실측:
// 투혼에서 '넓은 면'으로 잡힌 그룹이 0개).
//
// 테마(라이트/다크)에 따라 바꾸지 않는다 — 이건 글이 아니라 지도 그림이라, 두 테마에서
// 같은 그림으로 보이는 편이 낫다.

/** 팔레트 안에서의 순위(0~1) → 색. 낮은 번호는 어둡고 푸른 쪽, 높은 번호는 밝고 초록 쪽에
 *  둔다. 순위로 매기므로 그룹 번호가 촘촘하든 띄엄띄엄하든 대비가 고르게 나온다. */
function rampOf(t: number): string {
  return `hsl(${170 - t * 40} ${10 + t * 14}% ${18 + t * 44}%)`;
}

// 타일 하나를 몇 픽셀로 그릴까 — 화면에 200~360px로 보이는 그림이라 이 정도면 충분하고,
// 실제 표시 크기보다 크게 그려 두면 브라우저가 줄이면서 알아서 다듬어 준다.
const PX_PER_TILE = 4;

// 맵의 이만큼 안쪽까지를 '가장자리'로 보고 닉네임을 안쪽으로 붙인다.
const EDGE = 0.22;

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
  /** 이름까지 함께 보일까 — 본진은 이름을 달고(요청), 스냅의 주인공은 아바타만 띄운다. */
  withName: boolean;
  /** 검색 중 짚어야 할 사람인가 — 로스터를 감춘 모바일에서는 여기가 유일한 표시 자리다. */
  highlight: boolean;
  /** 그 시점에 궤멸됐거나 빈사 상태인가 — 본진에 해골을 얹는다(요청). */
  downed?: boolean;
}

export default function ReplayMinimap({
  grid, bases, actors, className,
}: {
  grid: ReplayMapGrid;
  /** 늘 보이는 본진 표시(요청: 본진은 아바타+닉네임 계속 표시). */
  bases: MinimapMarker[];
  /** 지금 스냅의 주인공들 — 아바타만, 그때 병력을 보낸 자리에(요청). */
  actors: MinimapMarker[];
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // base64 → 팔레트 첨자 바이트.
    const bin = atob(grid.tiles);
    const { width: w, height: h, palette } = grid;
    canvas.width = w * PX_PER_TILE;
    canvas.height = h * PX_PER_TILE;
    // 팔레트는 그룹 번호 오름차순으로 저장돼 있으므로(파서 참고) 첨자가 곧 순위다 —
    // 색을 미리 한 벌 만들어 두고 타일마다 찾아 쓴다.
    const last = Math.max(1, palette.length - 1);
    const colors = palette.map((_, i) => rampOf(i / last));
    // 같은 색이 이어지는 구간을 한 번에 칠한다 — 타일마다 fillRect를 부르면 128×128에
    // 16384번이라 눈에 띄게 느리다(한 화면에 카드가 여럿이면 더욱).
    for (let y = 0; y < h; y += 1) {
      let runStart = 0;
      let runIdx = -1;
      for (let x = 0; x <= w; x += 1) {
        const idx = x < w ? bin.charCodeAt(y * w + x) : -2;
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
  return (
    <div className={cx("scr-minimap", className)}>
      <canvas ref={canvasRef} className="scr-minimap-canvas" aria-label={`${grid.name} 미니맵`} />
      {bases.map((m) => (
        <span
          key={`base-${m.key}`}
          className={cx("scr-minimap-mark", "scr-minimap-mark-base",
            m.team === 1 && "scr-minimap-mark-t1", m.team === 2 && "scr-minimap-mark-t2",
            m.highlight && "scr-minimap-mark-hit",
            m.downed && "scr-minimap-mark-downed",
            labelSide(m))}
          style={place(m)}
        >
          <Avatar member={{ id: m.memberId, nickname: m.name, avatar: m.avatar }} size={18} />
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
      {actors.map((m) => (
        <span
          key={`act-${m.key}`}
          className={cx("scr-minimap-mark", "scr-minimap-mark-actor",
            m.team === 1 && "scr-minimap-mark-t1", m.team === 2 && "scr-minimap-mark-t2")}
          style={place(m)}
        >
          <Avatar member={{ id: m.memberId, nickname: m.name, avatar: m.avatar }} size={24} />
        </span>
      ))}
    </div>
  );
}
