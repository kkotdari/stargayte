import type { CSSProperties } from "react";

interface ValueBarProps {
  value: number | null;
  // 이 목록에서 가장 높은 값(=100%) — 전적 막대와 같은 원칙으로, 값이 없으면(리플레이로
  // 등록된 경기가 하나도 없는 회원) 막대 없이 "-"만 보여준다.
  maxValue: number;
  // 이미 끝난 기간에서 이 칸의 1·2·3위에 붙는 메달(요청) — 칸 우상단에 절대배치된다
  // (CSS의 .scr-stat-medal 참고, 이 칸의 다른 요소 정렬에는 영향을 주지 않는다).
  medal?: string;
}

// APM/커맨드처럼 승/패 구분 없이 값 하나만 비교하면 되는 막대 — 전적 막대와 같은
// 각진 스타일이지만 구간 색 없이 단색(파랑)으로 채운다. 숫자는 막대 트랙 위에 겹쳐
// 그린다(요청) — 채움 비율은 별도 DOM 없이 트랙 배경의 그라디언트 경계(--scr-value-fill)로
// 표현해, 숫자가 항상 트랙 자신의 배경 위(자식보다 먼저 그려짐)에 자연스럽게 얹히고
// 별도 stacking-context 트릭이 필요 없다.
export default function ValueBar({ value, maxValue, medal }: ValueBarProps) {
  const fillPercent = value !== null && maxValue > 0 ? (value / maxValue) * 100 : 0;
  // 값이 없어("-") 채울 비율 자체가 없는 경우, 그래도 그라디언트를 그리면 0% 채운
  // 막대(실제 0점)와 구분이 안 간다(지적) — 이때는 배경 자체를 안 그린다.
  const trackStyle: CSSProperties = value !== null ? { ["--scr-value-fill" as string]: `${fillPercent}%` } : {};
  return (
    <div className="scr-value-bar">
      <div
        className={value === null ? "scr-value-bar-track-wrap scr-value-bar-track-wrap-empty" : "scr-value-bar-track-wrap"}
        style={trackStyle}
      >
        <span className="scr-value-bar-num">{value ?? "-"}</span>
      </div>
      {medal && <span className="scr-stat-medal">{medal}</span>}
    </div>
  );
}
