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
// 색은 타일 그룹 번호에서 곧바로 만든다(아래 colorOf). 그룹을 묶어 단정하게 칠하는 쪽도
// 만들어 봤는데, 그룹을 있는 대로 다 구분한 쪽이 더 상세해서 그쪽으로 정했다(요청).
// 테마(라이트/다크)에 따라 바꾸지 않는다 — 이건 글이 아니라 지도 그림이라, 두 테마에서
// 같은 그림으로 보이는 편이 낫다.

/** 타일 그룹 번호 → 색. 번호에서 곧바로 만드므로 같은 맵은 늘 같은 그림이 된다.
 *  채도를 낮게 잡아 그림이 지도처럼 읽히게 하고, 밝기만 그룹마다 흩어 놓아 지형 경계가
 *  드러나게 한다. */
function colorOf(group: number): string {
  const hue = (group * 47) % 360;
  const lum = 22 + ((group * 29) % 46);
  return `hsl(${hue} 38% ${lum}%)`;
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
    // 같은 색이 이어지는 구간을 한 번에 칠한다 — 타일마다 fillRect를 부르면 128×128에
    // 16384번이라 눈에 띄게 느리다(한 화면에 카드가 여럿이면 더욱).
    for (let y = 0; y < h; y += 1) {
      let runStart = 0;
      let runColor = -1;
      for (let x = 0; x <= w; x += 1) {
        const g = x < w ? palette[bin.charCodeAt(y * w + x)] ?? 0 : -2;
        if (g === runColor) continue;
        if (runColor >= 0) {
          ctx.fillStyle = colorOf(runColor);
          ctx.fillRect(runStart * PX_PER_TILE, y * PX_PER_TILE, (x - runStart) * PX_PER_TILE, PX_PER_TILE);
        }
        runStart = x;
        runColor = g;
      }
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
  // 지금 어디 있는지가 뜬 사람은 본진 표시를 물러나게 한다 — 같은 사람의 아바타가 두 개
  // 뜨는데 둘이 똑같이 진하면 어느 쪽이 '지금'인지 헷갈린다.
  const active = new Set(actors.map((a) => a.key));

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
            active.has(m.key) && "scr-minimap-mark-behind",
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
