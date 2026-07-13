interface ThemeIconProps {
  size?: number;
  className?: string;
}

// 라이트 테마 토글 아이콘 — lucide의 Contrast 아이콘 대신 직접 그린다(테두리 없이도
// 눈에 띄어야 하는데, 라이브러리 아이콘은 얇은 선 하나만으로 두면 존재감이 약했다).
// 얇은 원 테두리(stroke) 안에 반원(오른쪽 절반)만 색을 채운 가장 단순한 형태.
export default function ThemeIcon({ size = 16, className }: ThemeIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" />
    </svg>
  );
}
