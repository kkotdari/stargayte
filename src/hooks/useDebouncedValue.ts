import { useEffect, useState } from "react";

// 검색/필터 값이 바뀔 때마다 즉시 서버에 쿼리를 쏘지 않고, 입력이 잠깐 멈췄을 때만
// 반영한다 — 필터가 전부 클라이언트 계산이던 예전엔 필요 없었지만, 서버 페이지네이션으로
// 바뀌면서 매 키 입력마다 네트워크 요청이 나가는 걸 막기 위해 새로 생겼다.
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
