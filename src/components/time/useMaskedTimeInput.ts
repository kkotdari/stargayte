import { autoFormatTimeInput } from "../../utils/time";
import { useMaskedSegmentedInput } from "../../utils/useMaskedSegmentedInput";

// 숫자 개수(커서가 있어야 할 논리적 자리) -> 콜론 포함 표시 문자열에서의 실제 커서 인덱스
const caretForDigitCount = (n: number): number => (n <= 2 ? n : n + 1);

// HH:MM 마스킹 입력. 실제 키 입력/커서 유지 로직은 useMaskedSegmentedInput 공용 훅.
export function useMaskedTimeInput(
  value: string,
  onChange: (v: string) => void,
  disabled = false,
) {
  return useMaskedSegmentedInput(value, onChange, disabled, {
    maxDigits: 4,
    format: autoFormatTimeInput,
    caretForDigitCount,
  });
}
