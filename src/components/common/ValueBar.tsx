interface ValueBarProps {
  value: number | null;
  // 이 목록에서 가장 높은 값(=100%) — 전적 막대와 같은 원칙으로, 값이 없으면(리플레이로
  // 등록된 경기가 하나도 없는 회원) 막대 없이 "-"만 보여준다.
  maxValue: number;
}

// 유효APM/유효커맨드처럼 승/패 구분 없이 값 하나만 비교하면 되는 막대 — 전적 막대와 같은
// 각진 스타일이지만 구간 색 없이 단색(파랑, 중립적인 색)으로 채운다.
export default function ValueBar({ value, maxValue }: ValueBarProps) {
  const fillPercent = value !== null && maxValue > 0 ? (value / maxValue) * 100 : 0;
  return (
    <div className="scr-value-bar">
      <span className="scr-value-bar-num">{value ?? "-"}</span>
      <div className="scr-value-bar-track-wrap">
        {value !== null && <div className="scr-value-bar-track" style={{ width: `${fillPercent}%` }} />}
      </div>
    </div>
  );
}
