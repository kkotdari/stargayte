import type { CSSProperties } from "react";

interface ValueBarProps {
  value: number | null;
  // 이 목록에서 가장 높은 값(=100%) — 전적 막대와 같은 원칙으로, 값이 없으면(리플레이로
  // 등록된 경기가 하나도 없는 회원) 막대 없이 "-"만 보여준다.
  maxValue: number;
  // 이미 끝난 기간에서 이 칸의 1·2·3위에 붙는 메달(요청) — 막대 위의 수 바로 옆에
  // 흐름으로 선다(요청: 데이터 텍스트 옆에 붙이기. 수의 길이에 따라 자리가 달라져도 된다).
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
        {/* 메달은 수 '안'에 있다 — 수의 오른쪽 끝에 매달리되 자리를 차지하지 않는다
            (지적: 메달 때문에 글자가 왼쪽으로 치우친다). 흐름에 두면 [수+메달]이 한
            덩어리로 가운데에 서므로 수 자체는 그만큼 왼쪽으로 밀린다 — 막대 위의 수는
            트랙 한가운데에 있어야 한다. 절대배치라 수의 가운데 정렬은 그대로고, 메달은
            수가 길든 짧든 그 오른쪽 끝을 따라간다(요청). */}
        <span className="scr-value-bar-num">
          {value ?? "-"}
          {medal && <span className="scr-stat-medal">{medal}</span>}
        </span>
      </div>
    </div>
  );
}
