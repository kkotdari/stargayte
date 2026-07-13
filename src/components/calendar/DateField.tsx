import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, X } from "lucide-react";
import { cx } from "../../utils/format";
import { isValidDateStr } from "../../utils/date";
import { attachPopover } from "../../utils/popover";
import { useMaskedDateInput } from "./useMaskedDateInput";
import CalendarPanel, { type CalendarView } from "./CalendarPanel";

interface DateFieldProps {
  value: string;
  // 타이핑 시 값 갱신
  onChange: (v: string) => void;
  // 달력에서 날짜를 '클릭'했을 때 (타이핑과 구분)
  onDayPick: (v: string) => void;
  placeholder: string;
  // 범위 하이라이트용 (시작/종료 달력이 공유)
  rangeFrom: string;
  rangeTo: string;
  // 이 값이 증가하면 팝오버를 자동으로 연다 (반대편에서 날짜를 골랐을 때)
  autoOpenSignal?: number;
  disabled?: boolean;
}

/*
  단일 날짜 입력 + 달력 팝오버
  - 마스킹 타이핑(숫자만, 커서 유지, 하이픈 자동)은 useMaskedDateInput 공용 훅
  - 달력 그리드는 CalendarPanel 공용 컴포넌트 (DateRangePicker와 함께 씀)
  - rangeFrom~rangeTo 구간 하이라이트로 시작/종료 달력이 서로 공유
  - 팝오버는 body에 포털링하고 위치는 Floating UI(attachPopover)에 맡겨서, 모달/패널의
    backdrop-filter에 갇히지 않게 뜬다. 모달 안이면 모달 카드 영역을 경계로 삼아 모달
    밖으로 삐져나가지 않는다.
*/
export default function DateField({
  value, onChange, onDayPick, placeholder, rangeFrom, rangeTo, autoOpenSignal = 0, disabled = false,
}: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<CalendarView>("days");
  const initial = value && isValidDateStr(value) ? new Date(value) : new Date();
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const today = new Date();
  const TODAY_YEAR = today.getFullYear();
  const TODAY_MONTH = today.getMonth();

  const { inputRef, onKeyDown, onPaste, onChange: onChangeFallback } = useMaskedDateInput(value, onChange, disabled);

  // 위치 계산/추적을 Floating UI에 맡긴다 — 스크롤/리사이즈에 따른 흔들림·지연·오작동을
  // 직접 다루려다 계속 문제가 재발해서, 이 문제를 이미 다듬어 놓은 라이브러리로 옮겼다.
  // 모바일 키보드가 뜨며 나는 리사이즈도 autoUpdate가 알아서 다시 계산해준다.
  useEffect(() => {
    if (!open || !ref.current || !popRef.current) return;
    return attachPopover(ref.current, popRef.current, { matchAnchor: true });
  }, [open]);

  // 바깥 클릭 시 닫기 (입력창/버튼 쪽과 포털된 팝오버 쪽 둘 다 확인)
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

  // 포커스가 입력창/팝오버 바깥의 다른 요소로 이동해도 닫는다 (탭 이동 등 클릭이 아닌 경우 포함)
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
    if (value && isValidDateStr(value)) {
      const d = new Date(value);
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
    }
  }, [value, open]);

  // 현재 값 기준으로 뷰 위치 잡기
  const syncViewToValue = () => {
    if (value && isValidDateStr(value)) {
      const d = new Date(value);
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
    }
    setView("days");
  };

  const openPop = () => { if (disabled) return; syncViewToValue(); setOpen(true); };

  // 반대편에서 날짜를 고르면 자동으로 열기
  const firstSignal = useRef(autoOpenSignal);
  useEffect(() => {
    if (disabled) return;
    if (autoOpenSignal !== firstSignal.current) {
      firstSignal.current = autoOpenSignal;
      syncViewToValue();
      setOpen(true);
    }
  }, [autoOpenSignal, disabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  };

  // 날짜 클릭 → 바로 닫기 (부모가 반대편을 열지 결정)
  const pickDay = (key: string) => {
    onDayPick(key);
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
    <div className={cx("scr-datefield", disabled && "scr-datefield-disabled")} ref={ref}>
      <div className={cx("scr-datefield-input", open && "scr-datefield-input-open")}>
        <input
          ref={inputRef}
          className="scr-df-input"
          value={value}
          placeholder={placeholder}
          inputMode="numeric"
          disabled={disabled}
          onFocus={openPop}
          onChange={onChangeFallback}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        {value && !disabled && (
          <button
            type="button"
            className="scr-df-clear"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange("")}
            aria-label="지우기"
          >
            <X size={12} />
          </button>
        )}
        <button type="button" className="scr-df-btn" onClick={() => (open ? setOpen(false) : openPop())} disabled={disabled} aria-label="달력 열기">
          <CalendarDays size={14} />
        </button>
      </div>

      {open && createPortal(
        <div className="scr-df-pop" ref={popRef}>
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
            // 이 컴포넌트는 대부분 단일 날짜 용도라 호출부가 rangeFrom/rangeTo를 그냥 ""로
            // 넘긴다 — 그러면 CalendarPanel이 선택된 날짜를 표시할 기준이 없어져 타이핑/선택한
            // 날짜가 달력에 하이라이트되지 않는다. 범위 공유가 없을 때는 현재 값으로 대체한다.
            rangeFrom={rangeFrom || value}
            rangeTo={rangeTo || value}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}
