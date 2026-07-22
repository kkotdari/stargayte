import { useMemo, useState } from "react";
import Avatar from "../../components/common/Avatar";
import { cx } from "../../utils/format";
import type { Member, RivalryPair } from "../../types";

// 상성 판정 기준 — 1전이라도 있으면 다 그린다(요청: "1전이라도 다 표현"). 표본 크기는
// 선 굵기(우세 강도)가 아니라 보여주는 범위의 문제로 두지 않고 전부 노출한다.
const MIN_GAMES = 1;
// 이 승률 이상이면 "우세"(화살표), 그 사이(40~60%)는 "대등"(회색 선).
const STRONG = 0.6;

// 우세/열세가 강할수록(승률이 50%에서 멀수록) 선을 두껍게, 약하면 얇게(요청).
// strength 0(50%) → 0.35, 1(100%) → 1.1.
const edgeWidth = (winRate: number) => {
  const strength = Math.abs(winRate - 0.5) * 2;
  return Math.round((0.35 + 0.75 * strength) * 100) / 100;
};

interface Edge {
  from: string; // 우세한 쪽(대등이면 그냥 a)
  to: string;
  kind: "strong" | "even";
  games: number;
  label: string; // "7:3" 같은 전적 라벨
  width: number; // 우세 강도에 비례한 선 굵기(SVG 좌표계 단위)
}

// 통계 화면 하단의 유저 상성 맵(요청) — 회원들을 원형으로 배치한 투명 글라스 칩(아바타+
// 닉네임)으로 그리고, 1:1 상대전적이 쌓인 쌍을 화살표(우세→열세)/회색 선(대등)으로
// 잇는다. 전원 연결선을 다 그리면 실타래가 되므로, 칩 하나를 탭하면 그 유저의 선만
// 진하게 남고 나머지는 숨겨진다(다시 탭하면 전체 보기).
export default function RivalryMap({
  pairs, memberOf, team = false,
}: {
  pairs: RivalryPair[];
  memberOf: (id: string) => Member | undefined;
  // 팀전(개인 환산) 데이터 여부 — 집계/그리기는 동일하고 안내 문구만 달라진다.
  team?: boolean;
}) {
  const { nodes, edges } = useMemo(() => {
    const edges: Edge[] = [];
    const ids = new Set<string>();
    pairs.forEach((p) => {
      const games = p.aWins + p.bWins;
      if (games < MIN_GAMES) return;
      if (!memberOf(p.a) || !memberOf(p.b)) return;
      const aWr = p.aWins / games;
      const width = edgeWidth(aWr);
      if (aWr >= STRONG) {
        edges.push({ from: p.a, to: p.b, kind: "strong", games, label: `${p.aWins}:${p.bWins}`, width });
      } else if (aWr <= 1 - STRONG) {
        edges.push({ from: p.b, to: p.a, kind: "strong", games, label: `${p.bWins}:${p.aWins}`, width });
      } else {
        edges.push({ from: p.a, to: p.b, kind: "even", games, label: `${p.aWins}:${p.bWins}`, width });
      }
      ids.add(p.a);
      ids.add(p.b);
    });
    // 배치 순서를 안정시키려 닉네임순으로 고정한다(응답 순서가 바뀌어도 원 위 자리가 안 바뀜).
    const nodes = [...ids].sort((x, y) =>
      (memberOf(x)?.nickname ?? x).localeCompare(memberOf(y)?.nickname ?? y, "ko"));
    return { nodes, edges };
  }, [pairs, memberOf]);

  const [selected, setSelected] = useState<string | null>(null);

  if (nodes.length < 2) {
    return (
      <div className="scr-empty">
        아직 상성을 그릴 만큼 쌓인 {team ? "팀전" : "1:1"} 상대전적({MIN_GAMES}전 이상)이 없어요.
      </div>
    );
  }

  // 원형 배치 — 좌표는 0~100 좌표계(정사각 컨테이너의 %)로 계산해 카드(%)와 SVG(viewBox
  // 0 0 100 100)가 같은 값을 공유한다.
  const pos = new Map<string, { x: number; y: number }>();
  nodes.forEach((id, i) => {
    const ang = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
    pos.set(id, { x: 50 + 40 * Math.cos(ang), y: 50 + 40 * Math.sin(ang) });
  });

  const related = (e: Edge) => selected !== null && (e.from === selected || e.to === selected);
  const shownEdges = selected === null ? edges : edges.filter(related);

  // 참여자가 많을수록 원 위 자리가 좁아지므로 칩을 단계적으로 줄인다(요청) —
  // 8명까지는 원래 크기, 그 뒤로 한 명당 3%씩, 최소 70%까지.
  const chipScale = Math.max(0.7, Math.min(1, 1 - Math.max(0, nodes.length - 8) * 0.03));

  return (
    <div className="scr-rivalry">
      <div className="scr-rivalry-wrap" onClick={() => setSelected(null)}>
        <svg className="scr-rivalry-svg" viewBox="0 0 100 100" aria-hidden>
          {shownEdges.map((e, i) => {
            const a = pos.get(e.from);
            const b = pos.get(e.to);
            if (!a || !b) return null;
            // 선택 모드에선 선택한 유저가 주인공(요청) — 그 유저가 이기는 관계(from)는
            // 초록, 지는 관계(to)는 빨강. 전체 보기는 우세=초록 하나.
            const focusKind = selected !== null && e.kind === "strong"
              ? (e.from === selected ? "win" : "lose")
              : null;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len;
            const uy = dy / len;
            // 화살촉 — marker 대신 직접 그린다: 굵기에 비례하되(요청) 최소/최대를
            // 클램프해 얇은 선에서도 보이고 굵은 선에서도 과하지 않게. 길이 h, 밑변
            // 폭은 h의 0.9배.
            const headLen = Math.min(3.6, Math.max(2.2, e.width * 3.4));
            const half = headLen * 0.45;
            // 양 끝 트림 — 예전엔 방향 불문 고정(9/11)이었는데, 칩이 가로로 긴 알약이라
            // 세로로 들어가는 화살표는 칩 가장자리보다 한참 앞에서 멈춰 촉이 허공에
            // 떠 보였다(지적: "기둥하고 촉이 위치가 안맞아"). 칩을 타원(halfW×halfH)로
            // 근사해 들어가는 방향에 맞는 타원 반지름만큼만 당긴다 — 어느 각도든 촉이
            // 칩 가장자리에 딱 붙는다. 칩이 위(z-index)라 살짝 넘쳐도 칩 밑에 숨는다.
            const halfW = 8 * chipScale;
            const halfH = 3 * chipScale;
            const edgeRadius = (vx: number, vy: number) =>
              (halfW * halfH) / (Math.hypot(halfH * vx, halfW * vy) || 1);
            let trimStart = edgeRadius(ux, uy) + 0.6;
            let trimEnd = edgeRadius(ux, uy) + 0.4;
            // 바로 옆 칩처럼 가까우면 트림이 선을 다 먹어 화살촉만 남는다(지적된 버그)
            // — 촉 길이 + 여유만큼의 기둥은 반드시 남도록 트림을 비례 축소한다.
            const minShaft = headLen + 1.6;
            if (len - trimStart - trimEnd < minShaft) {
              const k = Math.max(0, Math.min(1, (len - minShaft) / (trimStart + trimEnd)));
              trimStart *= k;
              trimEnd *= k;
            }
            const x1 = a.x + ux * trimStart;
            const y1 = a.y + uy * trimStart;
            const x2 = b.x - ux * trimEnd;
            const y2 = b.y - uy * trimEnd;
            const bx = x2 - ux * headLen;
            const by = y2 - uy * headLen;
            const arrowPoints = `${x2},${y2} ${bx - uy * half},${by + ux * half} ${bx + uy * half},${by - ux * half}`;
            // 기둥은 촉 꼭짓점이 아니라 촉 밑변에서 끊는다 — 꼭짓점까지 그리면 삼각형이
            // 뾰족해지는 끝에서 기둥(굵은 선)이 촉보다 넓어 옆으로 삐져나왔다(지적).
            const shaftX2 = e.kind === "strong" ? bx : x2;
            const shaftY2 = e.kind === "strong" ? by : y2;
            return (
              <g key={i} className={cx("scr-rivalry-edge", `scr-rivalry-edge-${e.kind}`, selected !== null && "scr-rivalry-edge-focus", focusKind && `scr-rivalry-edge-${focusKind}`)}>
                <line
                  x1={x1} y1={y1} x2={shaftX2} y2={shaftY2}
                  // 우세 강도 비례 굵기 — 인라인 style이라 CSS 기본 굵기를 덮는다.
                  style={{ strokeWidth: e.width }}
                />
                {e.kind === "strong" && <polygon points={arrowPoints} className="scr-rivalry-arrow-head" />}
                {/* 선택 모드에서만 전적 라벨을 선 중앙에 보여준다 — 전체 보기에선 겹쳐서 소음. */}
                {selected !== null && (
                  <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 1.2} className="scr-rivalry-edge-label">{e.label}</text>
                )}
              </g>
            );
          })}
        </svg>
        {nodes.map((id) => {
          const m = memberOf(id);
          const p = pos.get(id);
          if (!m || !p) return null;
          const dimmed = selected !== null && id !== selected
            && !edges.some((e) => related(e) && (e.from === id || e.to === id));
          return (
            <button
              key={id}
              type="button"
              className={cx(
                "scr-rivalry-card",
                selected === id && "scr-rivalry-card-selected",
                dimmed && "scr-rivalry-card-dim",
              )}
              style={{
                left: `${p.x}%`, top: `${p.y}%`,
                // 참여자수에 따른 칩 축소(요청) — 폰트/아바타/패딩을 같은 비율로.
                fontSize: `${Math.round(12 * chipScale * 10) / 10}px`,
                padding: `${4 * chipScale}px ${6 * chipScale}px`,
                gap: `${5 * chipScale}px`,
              }}
              onClick={(e) => { e.stopPropagation(); setSelected((s) => (s === id ? null : id)); }}
            >
              <Avatar member={m} size={Math.round(18 * chipScale)} />
              <span className="scr-rivalry-card-name">{m.nickname}</span>
            </button>
          );
        })}
      </div>
      <div className="scr-rivalry-legend">
        {selected === null ? (
          <span className="scr-rivalry-legend-item"><span className="scr-rivalry-legend-arrow" /> 우세(화살표가 가리키는 쪽이 열세)</span>
        ) : (
          <>
            <span className="scr-rivalry-legend-item"><span className="scr-rivalry-legend-arrow" /> 선택한 유저가 우세</span>
            <span className="scr-rivalry-legend-item"><span className="scr-rivalry-legend-arrow scr-rivalry-legend-arrow-lose" /> 열세</span>
          </>
        )}
        <span className="scr-rivalry-legend-item"><span className="scr-rivalry-legend-even" /> 대등</span>
        <span className="scr-rivalry-legend-note">
          선이 굵을수록 상성이 뚜렷 · 유저를 누르면 그 유저의 상성만 표시
        </span>
      </div>
    </div>
  );
}
