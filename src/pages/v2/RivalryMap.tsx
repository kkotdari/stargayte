import { useMemo, useState } from "react";
import Avatar from "../../components/common/Avatar";
import { cx } from "../../utils/format";
import type { Member, RivalryPair } from "../../types";

// 상성 판정 기준 — 무승부를 뺀 1:1 판수가 이만큼은 돼야 쌍을 그린다(표본이 적으면 상성이
// 아니라 우연이다).
const MIN_GAMES = 3;
// 이 승률 이상이면 "우세"(화살표), 그 사이(40~60%)는 "대등"(회색 선).
const STRONG = 0.6;

interface Edge {
  from: string; // 우세한 쪽(대등이면 그냥 a)
  to: string;
  kind: "strong" | "even";
  games: number;
  label: string; // "7:3" 같은 전적 라벨
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
        edges.push({ from: p.a, to: p.b, kind: "strong", games, label: `${p.aWins}:${p.bWins}` });
      } else if (aWr <= 1 - STRONG) {
        edges.push({ from: p.b, to: p.a, kind: "strong", games, label: `${p.bWins}:${p.aWins}` });
      } else {
        edges.push({ from: p.a, to: p.b, kind: "even", games, label: `${p.aWins}:${p.bWins}` });
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
          <defs>
            {/* 화살촉은 marker 정의라 선의 stroke 색을 못 물려받아 CSS 클래스로 따로
                칠한다. 화살표는 어느 모드든 "우세"라는 한 가지 의미라 색도 초록 하나다
                (요청: "선택시랑 전체에서 모두 우세니까 우세는 초록"). */}
            <marker id="scr-rivalry-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" className="scr-rivalry-arrow-head" />
            </marker>
          </defs>
          {shownEdges.map((e, i) => {
            const a = pos.get(e.from);
            const b = pos.get(e.to);
            if (!a || !b) return null;
            // 칩 아래 숨지 않게 양 끝을 칩 반지름만큼 안쪽으로 당긴다(화살촉 쪽은 조금 더).
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len;
            const uy = dy / len;
            const x1 = a.x + ux * 9;
            const y1 = a.y + uy * 9;
            const x2 = b.x - ux * 11;
            const y2 = b.y - uy * 11;
            return (
              <g key={i} className={cx("scr-rivalry-edge", `scr-rivalry-edge-${e.kind}`, selected !== null && "scr-rivalry-edge-focus")}>
                <line
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  markerEnd={e.kind === "strong" ? "url(#scr-rivalry-arrow)" : undefined}
                />
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
        <span className="scr-rivalry-legend-item"><span className="scr-rivalry-legend-arrow" /> 우세(화살표가 가리키는 쪽이 열세)</span>
        <span className="scr-rivalry-legend-item"><span className="scr-rivalry-legend-even" /> 대등</span>
        <span className="scr-rivalry-legend-note">
          {team ? `팀전 개인환산 ${MIN_GAMES}전 이상만` : `1:1 ${MIN_GAMES}전 이상만`} · 유저를 누르면 그 유저의 상성만 표시
        </span>
      </div>
    </div>
  );
}
