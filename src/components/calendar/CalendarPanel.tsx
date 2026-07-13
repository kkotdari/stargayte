import { ChevronLeft, ChevronRight } from "lucide-react";
import { cx } from "../../utils/format";
import { dstrFor, todayStr, MONTHS_KR, DOW } from "../../utils/date";
import YearList from "./YearList";

export type CalendarView = "days" | "months" | "years";

interface CalendarPanelProps {
  view: CalendarView;
  onViewChange: (v: CalendarView) => void;
  viewYear: number;
  viewMonth: number;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onPickDay: (key: string) => void;
  onPickMonth: (idx: number) => void;
  onPickYear: (y: number) => void;
  onToday: () => void;
  // 범위 하이라이트 (단일 날짜 입력에서는 빈 문자열로 두면 그냥 무시된다)
  rangeFrom: string;
  rangeTo: string;
}

// 일/월/연 달력 그리드 자체 (헤더 네비 포함) — DateField(단일 날짜)와 DateRangePicker(기간,
// 시작~종료 두 자리를 한 팝오버 하나에서 고름)가 함께 쓰는 순수 표시 컴포넌트. 상태는 상위가 갖는다.
export default function CalendarPanel({
  view, onViewChange, viewYear, viewMonth, onPrevMonth, onNextMonth,
  onPickDay, onPickMonth, onPickYear, onToday, rangeFrom, rangeTo,
}: CalendarPanelProps) {
  const today = new Date();
  const TODAY_YEAR = today.getFullYear();
  const TODAY_MONTH = today.getMonth();
  const todayKey = todayStr();

  const inRange = (key: string): boolean =>
    !!rangeFrom && !!rangeTo && key >= rangeFrom && key <= rangeTo;

  const startOffset = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  // 항상 6주(42칸)를 채워서 달마다 그리드 높이가 달라지지 않게 함 (월/연 모드와 팝업 크기 유지)
  while (cells.length < 42) cells.push(null);

  return (
    <>
      <div className="scr-cal-head">
        <button
          type="button"
          className={cx("scr-icon-btn", view !== "days" && "scr-cal-nav-hidden")}
          onClick={onPrevMonth}
          aria-label="이전"
          tabIndex={view === "days" ? 0 : -1}
        >
          <ChevronLeft size={16} />
        </button>
        <div className="scr-cal-title-group">
          <button
            type="button"
            className={cx("scr-cal-title-btn", view === "years" && "scr-cal-title-active")}
            onClick={() => onViewChange(view === "years" ? "days" : "years")}
          >
            {viewYear}년
          </button>
          <button
            type="button"
            className={cx("scr-cal-title-btn", view === "months" && "scr-cal-title-active")}
            onClick={() => onViewChange(view === "months" ? "days" : "months")}
          >
            {String(viewMonth + 1).padStart(2, "0")}월
          </button>
        </div>
        <div className="scr-cal-head-right">
          <button type="button" className="scr-cal-today-btn" onClick={onToday}>오늘</button>
          <button
            type="button"
            className={cx("scr-icon-btn", view !== "days" && "scr-cal-nav-hidden")}
            onClick={onNextMonth}
            aria-label="다음"
            tabIndex={view === "days" ? 0 : -1}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="scr-df-body">
        {/* 일 그리드 */}
        <div className={cx("scr-df-view", view === "days" && "scr-df-view-on")}>
          <div className="scr-cal-view">
            <div className="scr-cal-grid scr-cal-dow">
              {DOW.map((d) => <div key={d} className="scr-cal-dow-cell">{d}</div>)}
            </div>
            <div className="scr-cal-grid">
              {cells.map((d, i) => {
                if (d === null) return <div key={i} />;
                const key = dstrFor(viewYear, viewMonth, d);
                const isEdge = key === rangeFrom || key === rangeTo;
                return (
                  <button
                    type="button"
                    key={i}
                    className={cx(
                      "scr-cal-cell",
                      key === todayKey && "scr-cal-today",
                      isEdge && "scr-cal-selected",
                      inRange(key) && !isEdge && "scr-cal-inrange",
                    )}
                    onClick={() => onPickDay(key)}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 월 그리드 (그 달로 이동) */}
        <div className={cx("scr-df-view", view === "months" && "scr-df-view-on")}>
          <div className="scr-cal-view">
            <div className="scr-cal-view-spacer" />
            <div className="scr-picker-grid">
              {MONTHS_KR.map((label, idx) => (
                <button
                  type="button" key={label}
                  className={cx(
                    "scr-picker-cell",
                    viewYear === TODAY_YEAR && idx === TODAY_MONTH && "scr-picker-cell-today",
                    idx === viewMonth && "scr-cal-selected",
                  )}
                  onClick={() => onPickMonth(idx)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 연도 목록 (위아래로 스크롤) */}
        <div className={cx("scr-df-view", view === "years" && "scr-df-view-on")}>
          <div className="scr-cal-view">
            <div className="scr-cal-view-spacer" />
            <YearList
              selectedYear={viewYear}
              todayYear={TODAY_YEAR}
              onPick={onPickYear}
              active={view === "years"}
            />
          </div>
        </div>
      </div>
    </>
  );
}
