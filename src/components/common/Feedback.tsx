import { Loader2 } from "lucide-react";

interface PercentDonutProps {
  rate: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
}

// 승률을 링 형태로 보여주는 퍼센티지 도넛. 퍼센트 수치는 도넛 가운데에 함께 표시한다.
export function PercentDonut({ rate, size = 44, strokeWidth = 8, color = "var(--point)" }: PercentDonutProps) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, rate));
  return (
    <div className="scr-donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} strokeLinecap="butt"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="scr-donut-label scr-mono">{rate}<span className="scr-num-unit">%</span></span>
    </div>
  );
}

interface SpinnerProps {
  size?: number;
}

export function Spinner({ size = 14 }: SpinnerProps) {
  return <Loader2 size={size} className="scr-spin" />;
}
