import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cx } from "../../utils/format";
import { attachPopover } from "../../utils/popover";
import { monthLabel } from "../../utils/date";

interface MonthCalendarProps {
  /** "YYYY-MM" 또는 allValue */
  value: string;
  onChange: (value: string) => void;
  /** 이보다 과거는 못 고른다("YYYY-MM"). 없으면 아래로 막지 않는다. */
  minMonth?: string | null;
  /** 이보다 미래는 못 고른다("YYYY-MM"). 보통 이번 달. */
  maxMonth: string;
  /** 기간 전체를 뜻하는 값 — 넘기면 달력 아래에 그 칸이 한 줄로 붙는다. */
  allValue?: string;
  allLabel?: string;
  className?: string;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const pad2 = (n: number) => String(n).padStart(2, "0");
const yearOf = (m: string) => Number(m.slice(0, 4));

/* 기간 고르기 — 달을 스무 줄짜리 드롭다운으로 늘어놓던 것을 달력으로 바꾼다(요청).
   달력이라 해도 고르는 단위는 여전히 달이다(통계는 달 단위로만 낸다) — 그래서 날짜 격자가
   아니라 연도 하나에 열두 칸을 놓고, 연도를 좌우 화살표로 넘긴다. 고를 수 있는 범위 밖의
   달(첫 경기 이전·다음 달 이후)은 눌리지 않게 죽여 둬서, 빈 표로 가는 길 자체를 막는다. */
export default function MonthCalendar({
  value, onChange, minMonth, maxMonth, allValue, allLabel = "전체 기간", className,
}: MonthCalendarProps) {
  const [open, setOpen] = useState(false);
  const isAll = allValue !== undefined && value === allValue;
  const [year, setYear] = useState(() => (isAll ? yearOf(maxMonth) : yearOf(value)));
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // 열 때마다 지금 고른 달의 해로 돌아간다 — 지난번에 넘겨 둔 해에서 시작하면 "내가 뭘
  // 보고 있나"를 다시 찾아야 한다.
  useEffect(() => {
    if (open) setYear(isAll ? yearOf(maxMonth) : yearOf(value));
  }, [open, value, isAll, maxMonth]);

  useEffect(() => {
    if (!open || !ref.current || !popRef.current) return;
    return attachPopover(ref.current, popRef.current, { maxWidth: 248 });
  }, [open]);

  // 바깥 클릭으로 닫기 — Select와 같은 방식으로 그 첫 클릭을 삼켜, 뒤에 있는 것이 함께
  // 눌리지 않게 한다.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
      e.preventDefault();
      e.stopPropagation();
      const swallow = (ev: Event) => {
        ev.preventDefault();
        ev.stopPropagation();
        document.removeEventListener("click", swallow, true);
      };
      document.addEventListener("click", swallow, true);
      window.setTimeout(() => document.removeEventListener("click", swallow, true), 400);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  const inRange = (m: string) => (!minMonth || m >= minMonth) && m <= maxMonth;
  // 그 해에 고를 수 있는 달이 하나라도 있어야 넘어갈 수 있다.
  const yearHasAny = (y: number) => MONTHS.some((m) => inRange(`${y}-${pad2(m)}`));
  const commit = (v: string) => { onChange(v); setOpen(false); };

  return (
    <div className={cx("scr-month-cal", className)} ref={ref}>
      <button
        type="button"
        className={cx("scr-month-cal-trigger", open && "scr-month-cal-open")}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
        aria-haspopup="dialog" aria-expanded={open}
      >
        <CalendarDays size={14} aria-hidden />
        <span>{isAll ? allLabel : monthLabel(value)}</span>
      </button>
      {open && createPortal(
        <div className="scr-month-cal-pop" ref={popRef} role="dialog" aria-label="기간 고르기">
          <div className="scr-month-cal-head">
            <button
              type="button" className="scr-month-cal-nav" aria-label="이전 해"
              onClick={() => setYear((y) => y - 1)} disabled={!yearHasAny(year - 1)}
            >
              <ChevronLeft size={15} aria-hidden />
            </button>
            <span className="scr-month-cal-year">{year}년</span>
            <button
              type="button" className="scr-month-cal-nav" aria-label="다음 해"
              onClick={() => setYear((y) => y + 1)} disabled={!yearHasAny(year + 1)}
            >
              <ChevronRight size={15} aria-hidden />
            </button>
          </div>
          <div className="scr-month-cal-grid">
            {MONTHS.map((m) => {
              const v = `${year}-${pad2(m)}`;
              return (
                <button
                  key={m} type="button"
                  className={cx("scr-month-cal-cell", v === value && "scr-month-cal-cell-on")}
                  onClick={() => commit(v)} disabled={!inRange(v)}
                >
                  {m}월
                </button>
              );
            })}
          </div>
          {allValue !== undefined && (
            <button
              type="button"
              className={cx("scr-month-cal-all", isAll && "scr-month-cal-cell-on")}
              onClick={() => commit(allValue)}
            >
              {allLabel}
            </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
