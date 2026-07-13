import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, X } from "lucide-react";
import { cx } from "../../utils/format";
import { todayStr, isValidDateStr } from "../../utils/date";
import { attachPopover } from "../../utils/popover";
import { useMaskedDateInput } from "./useMaskedDateInput";
import CalendarPanel, { type CalendarView } from "./CalendarPanel";

interface DateRangePickerProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  disabled?: boolean;
}

/*
  기간 선택기 — 필터 줄에는 달력 아이콘 버튼 하나만 보이고, 누르면 팝오버 안에 시작/종료
  입력칸 + 달력이 함께 뜬다(입력칸을 필터 줄에 상시 노출하지 않아 공간을 아낀다).
  - 달력에서 첫 클릭은 시작일, 이어서 두 번째 클릭은 종료일 (거꾸로 클릭하면 자동으로 뒤바뀜)
  - 이미 둘 다 정해진 상태에서 다시 클릭하면 새 범위 선택으로 리셋된다
  - 입력칸에 직접 타이핑도 가능 (마스킹 입력 공용 훅) — 팝오버가 열리면 시작 칸에 자동 포커스.
*/
export default function DateRangePicker({ from, to, onChange, disabled = false }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<CalendarView>("days");
  const anchorDate = (isValidDateStr(from) && from) || (isValidDateStr(to) && to) || todayStr();
  const initial = new Date(anchorDate);
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const today = new Date();
  const TODAY_YEAR = today.getFullYear();
  const TODAY_MONTH = today.getMonth();

  // 타이핑: 값만 갱신 (완성된 날짜끼리 from>to가 되면 자동 보정).
  // 예전엔 시작 8자리 완성 시 종료 칸으로 자동 포커스 이동시켰는데, 그 focus() 호출이 아직
  // React가 시작 칸의 새 값을 커밋하기 전에(동일 이벤트 안에서 동기적으로) 실행되면서 시작
  // 입력값이 한 글자만 남고 날아가는 경합이 있었다. 자동 이동은 포기하고 안정성을 택한다.
  // 보정 비교는 반드시 v가 완성된 날짜(yyyy-mm-dd)일 때만 한다 — 타이핑 중인 미완성 문자열
  // ("1", "2026-0" 등)을 완성된 반대편 값과 문자열 비교하면 부등호가 잘못 걸려서, 다른 칸에
  // 입력을 시작하자마자 이미 다 입력해둔 칸이 한 글자만 남고 지워지는 버그가 있었다.
  const typeFrom = (v: string) => onChange(v, isValidDateStr(v) && to && v > to ? v : to);
  const typeTo = (v: string) => onChange(isValidDateStr(v) && from && v < from ? v : from, v);

  const toField = useMaskedDateInput(to, typeTo, disabled);
  const fromField = useMaskedDateInput(from, typeFrom, disabled);

  // 위치 계산/추적을 Floating UI에 맡긴다 — 스크롤/리사이즈에 따른 흔들림·지연·오작동을
  // 직접 다루려다 계속 문제가 재발해서, 이 문제를 이미 다듬어 놓은 라이브러리로 옮겼다.
  // 모바일 키보드가 뜨며 나는 리사이즈도 autoUpdate가 알아서 다시 계산해준다.
  useEffect(() => {
    if (!open || !ref.current || !popRef.current) return;
    return attachPopover(ref.current, popRef.current, { maxWidth: 300 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false); setView("days");
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // 포커스가 입력창/팝오버 바깥의 다른 요소로 이동해도 닫는다
  useEffect(() => {
    if (!open) return;
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false); setView("days");
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [open]);

  // 팝오버가 열려 있는 동안 타이핑으로 유효한 날짜가 완성되면 달력을 실시간으로 그 날짜로 이동
  useEffect(() => {
    if (!open) return;
    const anchor = (isValidDateStr(from) && from) || (isValidDateStr(to) && to);
    if (anchor) {
      const d = new Date(anchor);
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
    }
  }, [from, to, open]);

  const syncViewToValue = () => {
    const d = new Date((isValidDateStr(from) && from) || (isValidDateStr(to) && to) || todayStr());
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    setView("days");
  };

  const openPop = () => { if (disabled) return; syncViewToValue(); setOpen(true); };
  const togglePop = () => {
    if (disabled) return;
    if (open) { setOpen(false); setView("days"); return; }
    openPop();
  };

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  };

  // 달력 클릭: 시작이 없거나 이미 둘 다 정해져 있으면 새 범위 시작, 시작만 있는 중이면
  // 두 번째 클릭으로 범위를 완성한다 (거꾸로 찍으면 자동으로 순서를 바꿔준다).
  const pickDay = (key: string) => {
    if (!from || (from && to)) {
      onChange(key, "");
      return;
    }
    if (key < from) onChange(key, from);
    else onChange(from, key);
    setView("days");
    setOpen(false);
  };

  const pickMonth = (mIdx: number) => {
    setViewMonth(mIdx);
    setTimeout(() => setView("days"), 180);
  };

  // 연도만 고르고 나면 자연스럽게 "이제 월을 고를" 차례라 월 화면으로 넘어간다 — 예전엔
  // 여기서 바로 일 화면으로 가버려서, 이전에 보던(관련 없는) 월의 일 그리드가 뜨는 바람에
  // 연도 선택이 반영 안 된 것처럼 보였다.
  const pickYear = (y: number) => {
    setViewYear(y);
    setTimeout(() => setView("months"), 180);
  };

  // "오늘" 버튼은 날짜를 선택하는 게 아니라 오늘이 있는 달로 달력 화면만 이동시킨다.
  const goToday = () => {
    setViewYear(TODAY_YEAR);
    setViewMonth(TODAY_MONTH);
  };

  return (
    <div ref={ref}>
      <button
        type="button"
        className={cx("scr-icon-btn", "scr-daterange-trigger", (from || to) && "scr-daterange-trigger-active")}
        onClick={togglePop}
        disabled={disabled}
        aria-label="기간 직접 선택"
        title="기간 직접 선택"
      >
        <CalendarDays size={15} />
      </button>

      {open && createPortal(
        <div className="scr-df-pop" ref={popRef}>
          <div className="scr-range2 scr-range2-pop">
            <div className="scr-datefield-input">
              <input
                ref={fromField.inputRef}
                className="scr-df-input"
                value={from}
                placeholder="시작일"
                inputMode="numeric"
                disabled={disabled}
                onChange={fromField.onChange}
                onKeyDown={fromField.onKeyDown}
                onPaste={fromField.onPaste}
              />
              {from && !disabled && (
                <button
                  type="button"
                  className="scr-df-clear"
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onChange("", to)}
                  aria-label="시작일 지우기"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <div className="scr-datefield-input">
              <input
                ref={toField.inputRef}
                className="scr-df-input"
                value={to}
                placeholder="종료일"
                inputMode="numeric"
                disabled={disabled}
                onChange={toField.onChange}
                onKeyDown={toField.onKeyDown}
                onPaste={toField.onPaste}
              />
              {to && !disabled && (
                <button
                  type="button"
                  className="scr-df-clear"
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onChange(from, "")}
                  aria-label="종료일 지우기"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
          <CalendarPanel
            view={view}
            onViewChange={setView}
            viewYear={viewYear}
            viewMonth={viewMonth}
            onPrevMonth={prevMonth}
            onNextMonth={nextMonth}
            onPickDay={pickDay}
            onPickMonth={pickMonth}
            onPickYear={pickYear}
            onToday={goToday}
            rangeFrom={from}
            rangeTo={to}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}
