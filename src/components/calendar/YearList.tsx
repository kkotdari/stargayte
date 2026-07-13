import { useLayoutEffect, useRef } from "react";
import { cx } from "../../utils/format";

interface YearListProps {
  selectedYear: number;
  todayYear: number;
  onPick: (y: number) => void;
  // 연/월/일 뷰를 마운트 상태로 두고 CSS로만 전환하는 화면(DateField)에서
  // 연도 뷰로 다시 들어올 때마다 스크롤을 되돌리기 위해 필요
  active?: boolean;
}

const PAST_SPAN = 80;
const FUTURE_SPAN = 10;

// 연도 목록 — 월 선택 그리드와 같은 3열 배치를 유지하면서 위아래로 스크롤해서 고른다
export default function YearList({ selectedYear, todayYear, onPick, active = true }: YearListProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // 연도 뷰가 (다시) 보일 때마다 스크롤 애니메이션 없이 바로 선택된(또는 오늘) 연도로 위치시킴.
  // scrollIntoView는 페이지까지 함께 스크롤시킬 수 있어, 리스트 자신의 scrollTop만 직접 계산해 옮긴다.
  useLayoutEffect(() => {
    if (!active) return;
    const container = listRef.current;
    const el = container?.querySelector<HTMLElement>(`[data-year="${selectedYear}"]`);
    if (!container || !el) return;
    // offsetParent 체인에 의존하지 않도록 뷰포트 좌표 차이로 컨테이너 기준 위치를 계산
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const relativeTop = elRect.top - containerRect.top + container.scrollTop;
    container.scrollTop = relativeTop - container.clientHeight / 2 + el.clientHeight / 2;
  }, [active, selectedYear]);

  const start = todayYear - PAST_SPAN;
  const end = todayYear + FUTURE_SPAN;
  const years = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  return (
    <div className="scr-picker-grid scr-year-list scr-scroll" ref={listRef}>
      {years.map((y) => (
        <button
          key={y}
          type="button"
          data-year={y}
          className={cx(
            "scr-picker-cell",
            y === todayYear && "scr-picker-cell-today",
            y === selectedYear && "scr-cal-selected",
          )}
          onClick={() => onPick(y)}
        >
          {y}
        </button>
      ))}
    </div>
  );
}
