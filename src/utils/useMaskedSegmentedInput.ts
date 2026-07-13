import { useRef, useLayoutEffect, type KeyboardEvent, type ClipboardEvent, type ChangeEvent } from "react";

// 표시 문자열(구분자 포함 부분 완성형) 안에서, 커서 위치(문자 인덱스) 앞에 실제 숫자가
// 몇 개 있는지 센다. 구분자는 세지 않는다 — 커서를 "몇 번째 숫자 자리"로 다루기 위함.
const digitCountBeforeCaret = (display: string, caret: number): number =>
  display.slice(0, caret).replace(/\D/g, "").length;

export interface SegmentedMaskConfig {
  maxDigits: number;
  // 숫자만 -> 구분자 포함 표시 문자열 (예: "20260701" -> "2026-07-01", "1830" -> "18:30")
  format: (digits: string) => string;
  // 숫자 개수(커서가 있어야 할 논리적 자리) -> 구분자 포함 표시 문자열에서의 실제 커서 인덱스
  caretForDigitCount: (n: number) => number;
}

/*
  숫자만 입력되는 구분자 마스킹 입력 공통 로직 (YYYY-MM-DD 날짜, HH:MM 시간 등).
  - 숫자만 자리 삽입/삭제 가능, 구분자는 자동 삽입만 되고 직접 타이핑/삭제 대상이 아니다
    (백스페이스하면 구분자는 건너뛰고 그 앞 숫자가 지워진다)
  - 타이핑 중에도 커서 위치가 유지된다 (끝으로 안 튐)
*/
export function useMaskedSegmentedInput(
  value: string,
  onChange: (v: string) => void,
  disabled: boolean,
  config: SegmentedMaskConfig,
) {
  const { maxDigits, format, caretForDigitCount } = config;
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (pendingCaret.current !== null && inputRef.current) {
      inputRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value]);

  const applyDigits = (newDigits: string, caretDigitCount: number) => {
    const capped = newDigits.slice(0, maxDigits);
    onChange(format(capped));
    pendingCaret.current = caretForDigitCount(Math.min(caretDigitCount, maxDigits));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    const input = e.currentTarget;
    const selStart = input.selectionStart ?? value.length;
    const selEnd = input.selectionEnd ?? value.length;
    const digits = value.replace(/\D/g, "").slice(0, maxDigits);

    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      const nStart = digitCountBeforeCaret(value, selStart);
      const nEnd = digitCountBeforeCaret(value, selEnd);
      const base = digits.slice(0, nStart) + digits.slice(nEnd);
      const newDigits = (base.slice(0, nStart) + e.key + base.slice(nStart)).slice(0, maxDigits);
      applyDigits(newDigits, nStart + 1);
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      const nStart = digitCountBeforeCaret(value, selStart);
      const nEnd = digitCountBeforeCaret(value, selEnd);
      if (nStart !== nEnd) applyDigits(digits.slice(0, nStart) + digits.slice(nEnd), nStart);
      else if (nStart > 0) applyDigits(digits.slice(0, nStart - 1) + digits.slice(nStart), nStart - 1);
      return;
    }
    if (e.key === "Delete") {
      e.preventDefault();
      const nStart = digitCountBeforeCaret(value, selStart);
      const nEnd = digitCountBeforeCaret(value, selEnd);
      if (nStart !== nEnd) applyDigits(digits.slice(0, nStart) + digits.slice(nEnd), nStart);
      else if (nStart < digits.length) applyDigits(digits.slice(0, nStart) + digits.slice(nStart + 1), nStart);
      return;
    }
    // 방향키/Tab/Home/End 등 이동/편집 키는 그대로 두고, 그 외 문자 입력(구분자 포함)은 막는다
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    e.preventDefault();
    const input = e.currentTarget;
    const selStart = input.selectionStart ?? value.length;
    const selEnd = input.selectionEnd ?? value.length;
    const digits = value.replace(/\D/g, "").slice(0, maxDigits);
    const nStart = digitCountBeforeCaret(value, selStart);
    const nEnd = digitCountBeforeCaret(value, selEnd);
    const base = digits.slice(0, nStart) + digits.slice(nEnd);
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "");
    const newDigits = (base.slice(0, nStart) + pasted + base.slice(nStart)).slice(0, maxDigits);
    applyDigits(newDigits, nStart + pasted.length);
  };

  // 모바일 가상 키보드 등 keydown으로 못 잡는 경로의 안전망 (일반적으로는 위 핸들러가 먼저 처리)
  const onChangeFallback = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(format(e.target.value.replace(/\D/g, "").slice(0, maxDigits)));
  };

  return { inputRef, onKeyDown, onPaste, onChange: onChangeFallback };
}
