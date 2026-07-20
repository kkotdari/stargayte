import { forwardRef } from "react";
import Avatar from "../../components/common/Avatar";
import type { RankRow as RankRowData } from "./rank";

interface RankingSnapshotProps {
  rows: RankRowData[];
  // 캡처 헤더에 찍을 문맥 — 개인전/팀전, 종족(전체면 안 찍음), 기간.
  modeLabel: string;
  raceLabel: string | null;
  periodLabel: string;
}

// 랭킹 "스크린샷" 전용 렌더 — 화면(우주 배경/글라스/backdrop-filter)은 html-to-image가
// 제대로 못 담으므로, 캡처는 이 자족적(solid 배경·인라인 스타일) 레이아웃으로 따로 그린다.
// 화면 밖(left:-100000px)에 항상 마운트해 두고, 버튼을 누르면 이 노드를 통째로 PNG로 뽑는다.
// 스크롤로 잘리는 실제 목록과 달리 여기선 전체 행이 다 들어간다(요청: "전체가 다 나오게").
const RankingSnapshot = forwardRef<HTMLDivElement, RankingSnapshotProps>(function RankingSnapshot(
  { rows, modeLabel, raceLabel, periodLabel }, ref,
) {
  const sub = [modeLabel, raceLabel, periodLabel].filter(Boolean).join(" · ");
  return (
    <div
      ref={ref}
      style={{
        width: 420, boxSizing: "border-box", padding: "22px 20px 24px",
        background: "var(--panel-solid, #0f1216)", color: "var(--text, #eee)",
        fontFamily: "'Pretendard Variable', Pretendard, 'Noto Sans KR', sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 2 }}>
        <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em" }}>랭킹</span>
        <span style={{ fontSize: 12, opacity: 0.6 }}>스타게이트</span>
      </div>
      <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 16 }}>{sub} · {rows.length}명</div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map((r, i) => {
          const tied = i > 0 && r.rank === rows[i - 1].rank;
          return (
            <div
              key={r.member.id}
              style={{
                display: "grid", gridTemplateColumns: "34px 34px 1fr auto", columnGap: 12,
                alignItems: "center", padding: "9px 0",
                borderTop: i === 0 ? "none" : "1px solid rgba(150,150,150,0.18)",
              }}
            >
              <span style={{
                fontFamily: "var(--font-mono, monospace)", fontStyle: "italic", fontWeight: 700,
                fontSize: 20, textAlign: "left", opacity: tied ? 0 : 1,
              }}>{r.rank}</span>
              <Avatar member={r.member} size={30} />
              <span style={{
                minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                fontSize: 16, fontWeight: 700,
              }}>{r.member.nickname}</span>
              <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, justifySelf: "end" }}>
                {r.provisional && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#f0a85a" }}>잠정</span>
                )}
                <span style={{ fontSize: 16, fontWeight: 700 }}>
                  {r.rankScore}<span style={{ fontSize: 11, opacity: 0.6, marginLeft: 1 }}>점</span>
                </span>
              </span>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div style={{ padding: "24px 0", textAlign: "center", opacity: 0.6, fontSize: 14 }}>기록이 없어요</div>
        )}
      </div>
    </div>
  );
});

export default RankingSnapshot;
