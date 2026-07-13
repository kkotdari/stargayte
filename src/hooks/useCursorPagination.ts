import { useCallback, useEffect, useRef, useState } from "react";

interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  // 같은 필터 조건의 전체 건수 — 서버는 첫 페이지(커서 없음) 응답에만 값을 채워 보낸다.
  // 이 훅을 쓰지 않는 화면(Page 타입에 이 필드가 없는 응답)도 있어 옵셔널로 둔다.
  total?: number | null;
}

interface UseCursorPaginationResult<T> {
  items: T[];
  loading: boolean; // 첫 페이지(필터가 바뀐 경우 포함) 로딩 중
  loadingMore: boolean; // "더 보기"(다음 페이지) 로딩 중
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  // 매치 등록/수정/삭제 직후 목록을 처음부터 다시 불러올 때 호출 (기존 onSaved 콜백 자리에서 사용)
  reload: () => void;
  // 같은 필터 조건의 전체 건수 — 로드된 items.length가 아니라 서버가 첫 페이지에서
  // 알려준 값을 그대로 들고 있는다(무한스크롤 중에도 안 바뀜). 아직 첫 응답 전이면 null.
  total: number | null;
}

// 커서 기반 무한스크롤 공용 훅 — deps(필터/정렬 값들)가 바뀌면 첫 페이지부터 다시 불러오고,
// loadMore()를 부르면 다음 페이지를 이어붙인다. deps 변경 도중 이전 요청이 늦게 도착해도
// (generation 카운터로) 최신 상태를 덮어쓰지 않는다.
export function useCursorPagination<T>(
  fetchPage: (cursor: string | null) => Promise<Page<T>>,
  deps: unknown[],
): UseCursorPaginationResult<T> {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  const generationRef = useRef(0);
  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;

  const load = useCallback(async (targetCursor: string | null, append: boolean) => {
    const myGeneration = generationRef.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const page = await fetchPageRef.current(targetCursor);
      if (myGeneration !== generationRef.current) return; // 그 사이 필터가 또 바뀜 — 폐기
      setItems((prev) => (append ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
      if (page.total !== undefined && page.total !== null) setTotal(page.total);
    } catch (e) {
      if (myGeneration !== generationRef.current) return;
      setError(e instanceof Error ? e.message : "목록을 불러오지 못했어요.");
    } finally {
      if (myGeneration === generationRef.current) {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    // items는 일부러 안 비운다 — 필터/정렬이 바뀔 때마다 목록을 빈 배열로 갈아치우면
    // 화면이 순간적으로 텅 비었다 다시 채워지면서 문서 높이가 출렁여 스크롤이 맨 위로
    // 튀어 보였다. 이전 결과를 그대로 보여준 채(호출부가 loading으로 옅게 표시) 새
    // 페이지가 도착하면 그때 통째로 교체한다(아래 load()의 setItems).
    setCursor(null);
    setHasMore(false);
    load(null, false);
    // deps는 호출부가 넘기는 동적 배열이라 정적 분석이 안 된다 — 의도적으로 그대로 전달.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    load(cursor, true);
  }, [cursor, hasMore, loading, loadingMore, load]);

  const reload = useCallback(() => {
    generationRef.current += 1;
    setCursor(null);
    setHasMore(false);
    load(null, false);
  }, [load]);

  return { items, loading, loadingMore, error, hasMore, loadMore, reload, total };
}
