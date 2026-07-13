import type { CSSProperties, ReactNode } from "react";
import { cx } from "../../utils/format";

interface CornerPanelProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

// 기본 HUD 스타일 패널
export default function CornerPanel({ children, className, style }: CornerPanelProps) {
  return (
    <div className={cx("scr-panel", className)} style={style}>
      {children}
    </div>
  );
}
