import { autoFormatDateInput } from "../../utils/date";
import { useMaskedSegmentedInput } from "../../utils/useMaskedSegmentedInput";

// 숫자 개수(커서가 있어야 할 논리적 자리) -> 하이픈 포함 표시 문자열에서의 실제 커서 인덱스
const caretForDigitCount = (n: number): number => (n <= 4 ? n : n <= 6 ? n + 1 : n + 2);

/*
  YYYY-MM-DD 마스킹 입력. DateField(단일 날짜)와 DateRangePicker(시작/종료 두 세그먼트)가 함께 쓴다.
  실제 키 입력/커서 유지 로직은 useMaskedSegmentedInput 공용 훅.
*/
export function useMaskedDateInput(
  value: string,
  onChange: (v: string) => void,
  disabled = false,
) {
  return useMaskedSegmentedInput(value, onChange, disabled, {
    maxDigits: 8,
    format: autoFormatDateInput,
    caretForDigitCount,
  });
}
