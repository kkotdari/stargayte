// 시:분(HH:MM) 관련 유틸

// HH:MM 형식 유효성 검사
export const isValidTimeStr = (s: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

// 사용자가 타이핑할 때 숫자만 입력해도 실시간으로 HH:MM 형태로 변환
// 예) "1830" -> "18:30", "18" -> "18"
export const autoFormatTimeInput = (raw: string): string => {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  const h = digits.slice(0, 2);
  const m = digits.slice(2, 4);
  return digits.length > 2 ? `${h}:${m}` : h;
};
