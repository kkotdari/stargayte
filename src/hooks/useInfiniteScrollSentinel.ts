import { useEffect, useRef } from "react";

interface Opts {
  enabled: boolean;
  rootMargin?: string;
}

// 목록 맨 아래 보이지 않는 sentinel div에 걸어두는 훅 — 그 div가 뷰포트(또는 스크롤
// 컨테이너)에 들어오면 onIntersect를 부른다. rootMargin만큼 미리 당겨서 스크롤이 바닥에
//닿기 전에 다음 페이지를 불러오기 시작한다.
export function useInfiniteScrollSentinel(onIntersect: () => void, opts: Opts): React.RefObject<HTMLDivElement | null> {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const onIntersectRef = useRef(onIntersect);
  onIntersectRef.current = onIntersect;

  useEffect(() => {
    if (!opts.enabled) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onIntersectRef.current();
      },
      { rootMargin: opts.rootMargin ?? "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [opts.enabled, opts.rootMargin]);

  return sentinelRef;
}
