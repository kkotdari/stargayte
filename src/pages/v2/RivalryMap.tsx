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
// 테이퍼 도입 후 전체적으로 얇아 보여 상한을 1.4로(요청) — strength 0(50%) → 0.25, 1(100%) → 1.4.
const edgeWidth = (winRate: number) => {
  const strength = Math.abs(winRate - 0.5) * 2;
  return Math.round((0.25 + 1.15 * strength) * 100) / 100;
};

interface Edge {
  from: string; // 우세한 쪽(대등이면 그냥 a)
  to: string;
  kind: "strong" | "even";
  games: number;
  // 전적 라벨은 "누가 선택됐는지"에 따라 방향이 뒤집혀야 해서(선택한 유저의 승수가
  // 항상 앞 — 요청) 문자열 대신 양쪽 승수를 그대로 들고 렌더 시점에 조합한다.
  fromWins: number;
  toWins: number;
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
      if (aWr >= STRONG) {
        edges.push({ from: p.a, to: p.b, kind: "strong", games, fromWins: p.aWins, toWins: p.bWins, width: edgeWidth(aWr) });
      } else if (aWr <= 1 - STRONG) {
        edges.push({ from: p.b, to: p.a, kind: "strong", games, fromWins: p.bWins, toWins: p.aWins, width: edgeWidth(aWr) });
      } else {
        // 대등은 강도 개념이 없으니 중간 굵기 고정(요청) — 우세 굵기 범위(0.25~1.4)의 중간.
        edges.push({ from: p.a, to: p.b, kind: "even", games, fromWins: p.aWins, toWins: p.bWins, width: 0.8 });
      }
      ids.add(p.a);
      ids.add(p.b);
    });
    // 원 위 배치는 닉네임순 고정 대신 무작위로 섞는다(요청: "그때그때 달라지게") —
    // 데이터가 새로 로드될 때(화면 진입/기간·탭 변경)마다 셔플되고, 그 사이(유저
    // 선택 등 상호작용)에는 useMemo가 지켜줘 자리가 안 흔들린다.
    const nodes = [...ids];
    for (let i = nodes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [nodes[i], nodes[j]] = [nodes[j], nodes[i]];
    }
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
  // 0 0 100 100)가 같은 값을 공유한다. 타원(41×46)도 시도했지만 원형이 예뻐 되돌리고
  // (요청), 대신 반지름을 40→42로 살짝 키워 여백만 줄인다.
  const pos = new Map<string, { x: number; y: number }>();
  nodes.forEach((id, i) => {
    const ang = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
    pos.set(id, { x: 50 + 42 * Math.cos(ang), y: 50 + 42 * Math.sin(ang) });
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
            // 닉네임이 길면 칩이 이 타원 근사보다 넓어 촉이 칩 밑에 숨는 경우가 많았다
            // (지적) — 가로 반지름을 키우고 촉 쪽 여유도 넉넉히 둬서, 칩에 딱 붙이는 대신
            // 조금 떨어진 지점에서 멈추게 한다.
            const halfW = 9 * chipScale;
            const halfH = 3 * chipScale;
            const edgeRadius = (vx: number, vy: number) =>
              (halfW * halfH) / (Math.hypot(halfH * vx, halfW * vy) || 1);
            // 양 끝을 유저칩에 더 가깝게(요청) — 예전엔 촉이 칩 밑에 숨는 걸 피하려 칩
            // 타원 반지름 위에 여유(0.7/2.0)를 넉넉히 얹었는데, 그만큼 화살표가 칩에서
            // 떠 보였다. 여유를 크게 줄여 촉/꼬리가 칩 가장자리에 바짝 붙게 한다(칩이 위
            // z-index라 살짝 겹쳐도 칩 밑에 자연스럽게 숨는다).
            let trimStart = edgeRadius(ux, uy) + 0.2;
            let trimEnd = edgeRadius(ux, uy) + 0.7;
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
            // 우세 기둥은 시작이 얇고 화살촉 쪽으로 갈수록 두꺼워지는 사다리꼴(요청) —
            // <line>은 굵기가 균일해서 폴리곤으로 직접 그린다. 시작 폭은 끝 폭의 35%,
            // 끝은 촉 밑변에서 끊는다(꼭짓점까지 그리면 촉 옆으로 삐져나온다 — 지적).
            const startHalf = (e.width * 0.35) / 2;
            const endHalf = e.width / 2;
            const shaftPoints = `${x1 - uy * startHalf},${y1 + ux * startHalf} ${bx - uy * endHalf},${by + ux * endHalf} ${bx + uy * endHalf},${by - ux * endHalf} ${x1 + uy * startHalf},${y1 - ux * startHalf}`;
            return (
              <g key={i} className={cx("scr-rivalry-edge", `scr-rivalry-edge-${e.kind}`, selected !== null && "scr-rivalry-edge-focus")}>
                {e.kind === "strong" ? (
                  <>
                    <polygon points={shaftPoints} className="scr-rivalry-shaft" />
                    <polygon points={arrowPoints} className="scr-rivalry-arrow-head" />
                  </>
                ) : (
                  <line x1={x1} y1={y1} x2={x2} y2={y2} style={{ strokeWidth: e.width }} />
                )}
                {/* 선택 모드에서만 전적 라벨을 선 중앙에 보여준다 — 전체 보기에선 겹쳐서 소음.
                    띄우는 방향은 화면 위쪽 고정이 아니라 선의 수직 방향(perp) — 고정 y 오프셋은
                    세로/대각선 선에서 "선을 따라" 밀려 라벨이 한쪽 끝으로 치우쳐 보였다(지적).
                    글자 크기는 칩 축소 비율(chipScale)을 따라간다(요청 — 칩 사이가 좁아지므로). */}
                {selected !== null && (() => {
                  const midX = (x1 + x2) / 2;
                  const midY = (y1 + y2) / 2;
                  let side = ux > 0 ? -1 : 1; // perp(-uy,ux)의 y성분(ux)이 음수(위쪽)가 되게
                  let off = 1.6;
                  // 바로 옆 칩 사이 짧은 선은 라벨이 칩(위층 DOM)에 덮인다(지적). 처음엔
                  // 원 중심 쪽으로 뺐는데 중심부는 다른 선들이 다 지나는 자리라 오히려
                  // 헷갈렸다(지적) — 반대로 원 바깥쪽(선이 없는 빈 공간)으로 띄운다.
                  if (len < 32) {
                    side = (-uy * (50 - midX) + ux * (50 - midY)) >= 0 ? -1 : 1;
                    off = 4.2;
                  }
                  const lx = midX + side * -uy * off;
                  const ly = midY + side * ux * off;
                  // 선택한 유저의 승수가 항상 앞에 오게 방향을 맞춘다(지적된 오류).
                  const label = e.from === selected
                    ? `${e.fromWins}:${e.toWins}`
                    : `${e.toWins}:${e.fromWins}`;
                  return (
                    <text x={lx} y={ly} dominantBaseline="central" style={{ fontSize: 3.2 * chipScale }} className="scr-rivalry-edge-label">{label}</text>
                  );
                })()}
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
      <RivalryLegend />
    </div>
  );
}

// 범례는 데이터와 무관한 고정 내용이라 따로 뽑아둔다 — 로딩 화면도 이걸 그대로 렌더해서
// 로딩/로드 상태의 본체 높이를 "정확히" 같게 만든다(오버레이가 세로 가운데 정렬이라
// 높이가 조금이라도 달라지면 타이틀이 위/아래로 튄다 — 지적). 높이를 px로 어림해
// 예약하던 방식은 화면 폭에 따라 범례가 줄바꿈되면 어긋나서 폐기.
export function RivalryLegend() {
  return (
    <div className="scr-rivalry-legend">
      {/* 우세/열세는 색이 아니라 화살표 방향으로만 구분한다(요청) — 어느 모드든 초록 하나. */}
      <span className="scr-rivalry-legend-item"><span className="scr-rivalry-legend-arrow" /> 우세→열세</span>
      <span className="scr-rivalry-legend-item"><span className="scr-rivalry-legend-even" /> 대등</span>
      <span className="scr-rivalry-legend-note">
        선이 굵을수록 상성이 뚜렷 · 유저를 누르면 그 유저의 상성만 표시
      </span>
    </div>
  );
}
