import { cx } from "../../utils/format";

interface RankDeltaBadgeProps {
  delta: number | null;
}

// 전월 대비 순위 변동 — 순위 숫자 바로 아래에 붙인다(요청: "목록페이지의 순위 밑에도
// 랭킹변동 보여주기"). delta는 "전월 순위 - 이번달 순위"라 양수면 순위가 올랐다는 뜻.
export default function RankDeltaBadge({ delta }: RankDeltaBadgeProps) {
  if (delta === null) {
    return <span className="scr-rank-delta scr-rank-delta-new">신규</span>;
  }
  if (delta === 0) {
    return <span className="scr-rank-delta scr-rank-delta-none">-</span>;
  }
  return (
    <span className={cx("scr-rank-delta", delta > 0 ? "scr-rank-delta-up" : "scr-rank-delta-down")}>
      {delta > 0 ? "▲" : "▼"}{Math.abs(delta)}
    </span>
  );
}
