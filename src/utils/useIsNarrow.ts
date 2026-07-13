import { useEffect, useState } from "react";

// CSS 미디어쿼리와 같은 기준을 JS에서도 알아야 할 때(placeholder 텍스트처럼 CSS만으로는
// 못 바꾸는 값) 쓰는 최소한의 훅.
export function useIsNarrow(maxWidth: number): boolean {
  const query = `(max-width: ${maxWidth}px)`;
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setNarrow(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return narrow;
}
