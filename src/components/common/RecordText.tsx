import { cx } from "../../utils/format";

interface RecordTextProps {
  plays: number;
  wins: number;
  losses: number;
  draws: number;
  // 있으면 승률을 괄호로 덧붙인다 (주간랭킹처럼 승률을 도넛 등 별도 요소로 안 보여줄 때만 사용)
  winRate?: number;
  className?: string;
}

// "10전 8승 2패 (80%)" 형태의 전적 표기 — 전/승/패/무·% 같은 단위 글자는 숫자보다
// 작게 처리해서(scr-num-unit) 숫자만 도드라져 보이게 한다. 승/무/패는 전적통계 화면의
// 막대그래프(StatBar)와 같은 계열(초록/회색/붉은)로 색을 입혀 한눈에 구분되게 한다.
export default function RecordText({ plays, wins, losses, draws, winRate, className }: RecordTextProps) {
  return (
    <span className={cx("scr-mono", className)}>
      {plays}<span className="scr-num-unit">전</span>{" "}
      <span className="scr-record-win">{wins}<span className="scr-num-unit">승</span></span>{" "}
      <span className="scr-record-loss">{losses}<span className="scr-num-unit">패</span></span>
      {draws > 0 && <> <span className="scr-record-draw">{draws}<span className="scr-num-unit">무</span></span></>}
      {winRate !== undefined && <> ({winRate}<span className="scr-num-unit">%</span>)</>}
    </span>
  );
}
