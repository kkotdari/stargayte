// 날짜 관련 유틸
import type { PeriodPreset } from "../types";

export const pad = (n: number): string => String(n).padStart(2, "0");

export const fmt = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// 이 앱의 "오늘"은 자정이 아니라 정오(낮 12시)를 경계로 한다(요청: "경기 기본 일자는
// 밤 22시 전에는 어제 22시 이후엔 오늘자" → "날짜 기준 정오로 할게" → "등록과 조회
// 모두 기준을 정오로 바꾸라고") — 밤 늦게 시작해 자정을 넘겨 새벽까지 이어지는 게임
// 세션은 시작한 그 저녁 날짜로 등록/조회되는 게 자연스럽고, 정오 이전(전날 세션 결과를
// 다음날 오전에 등록하거나 조회하는 상황)에는 하루 전 날짜가 기준이어야 맞다. 경기
// 등록 기본값과 오늘/이번주 등 조회 기간 프리셋, 캘린더 "오늘" 표시가 모두 이 기준을
// 공유하므로 todayStr() 자체가 이 정의를 따른다.
export function gameNow(): Date {
  const now = new Date();
  return now.getHours() < 12 ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : now;
}

export const todayStr = (): string => fmt(gameNow());

export const dstrFor = (y: number, m: number, d: number): string =>
  `${y}-${pad(m + 1)}-${pad(d)}`;

// YYYY-MM-DD 형식 유효성 검사
export const isValidDateStr = (s: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());

// 사용자가 타이핑할 때 숫자만 입력해도 실시간으로 YYYY-MM-DD 형태로 변환
// 예) "20260701" -> "2026-07-01", "202607" -> "2026-07", "2026" -> "2026"
// 하이픈은 사용자가 직접 넣어도 되고(무시하고 숫자만 사용), 최대 8자리까지만 인식
export const autoFormatDateInput = (raw: string): string => {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  const y = digits.slice(0, 4);
  const m = digits.slice(4, 6);
  const d = digits.slice(6, 8);
  let out = y;
  if (digits.length > 4) out += `-${m}`;
  if (digits.length > 6) out += `-${d}`;
  return out;
};

// 해당 월의 시작/마지막 날짜 문자열
export const monthStart = (y: number, m: number): string => dstrFor(y, m, 1);
export const monthEnd = (y: number, m: number): string =>
  dstrFor(y, m, new Date(y, m + 1, 0).getDate());

// <input type="month">의 값("YYYY-MM")을 그 달의 시작~끝 날짜 범위로 바꾼다 — 기간필터가
// 커스텀 연/월/주 드릴다운 대신 OS 네이티브 월 선택기 하나로 단순화되면서, offset 기반
// 계산(periodPresetRange) 대신 이 값 하나만으로 바로 범위를 구한다.
export function monthInputToRange(value: string): { from: string; to: string } {
  const [y, m] = value.split("-").map(Number);
  return { from: monthStart(y, m - 1), to: monthEnd(y, m - 1) };
}

// 오늘이 속한 달의 <input type="month"> 기본값("YYYY-MM").
export const currentMonthValue = (): string => todayStr().slice(0, 7);

// "YYYY-MM"을 delta개월만큼 앞/뒤로 옮긴다(음수=과거) — 랭킹 화면의 전월 대비 순위변동/
// 최근 5개월 순위변동 모달이 함께 쓴다.
export function shiftMonthValue(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

// 최근 n개월("YYYY-MM")을 과거→최근 순으로 — 최근 5개월 순위변동 차트가 왼쪽부터
// 시간순으로 그려지도록 이 순서 그대로 쓴다.
export function recentMonthValues(n: number, from: string = currentMonthValue()): string[] {
  return Array.from({ length: n }, (_, i) => shiftMonthValue(from, -(n - 1 - i)));
}

// 월요일 시작 기준 이번 주의 시작(월)/끝(일) 날짜 문자열.
export const weekStart = (d: Date): string => {
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1; // 일요일(0)은 6일 전 월요일
  return fmt(new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff));
};
export const weekEnd = (d: Date): string => {
  const day = d.getDay();
  const diff = day === 0 ? 0 : 7 - day;
  return fmt(new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff));
};

// 기간 필터 프리셋(오늘/이번주/이번달/직접입력)을 실제 조회에 쓸 from/to로 변환한다 —
// "직접입력"만 사용자가 입력해둔 값을 그대로 쓰고, 나머지는 서버 조회 없이 오늘 날짜
// 기준으로 그 자리에서 계산된다. offset은 월간랭킹/주간랭킹의 이전·다음과 같은 개념 —
// 0이면 현재(오늘/이번주/이번달), 1이면 그 직전 한 단위(하루/한 주/한 달) 전이다.
// "직접입력"은 이미 확정된 절대 날짜라 offset이 적용될 기준(오늘 등)이 없어 무시한다.
export function periodPresetRange(
  preset: PeriodPreset, from: string, to: string, offset = 0,
): { from: string; to: string } {
  if (preset === "custom") return { from, to };
  if (preset === "all") return { from: "", to: "" };
  const now = gameNow();
  if (preset === "today") {
    const t = fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset));
    return { from: t, to: t };
  }
  if (preset === "week") {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset * 7);
    return { from: weekStart(d), to: weekEnd(d) };
  }
  if (preset === "year") {
    const y = now.getFullYear() - offset;
    return { from: fmt(new Date(y, 0, 1)), to: fmt(new Date(y, 11, 31)) };
  }
  let y = now.getFullYear();
  let m = now.getMonth() - offset;
  while (m < 0) { m += 12; y -= 1; }
  return { from: monthStart(y, m), to: monthEnd(y, m) };
}

// 목록 타이틀 아래(랭킹 화면처럼)에 보여줄 "지금 적용 중인 기간"을 사람이 읽을 문구로 만든다.
// 랭킹 화면과 같은 원칙으로 "오늘"/"이번달" 같은 프리셋 이름은 안 붙이고 실제 날짜(범위)만
// 보여준다 — offset으로 과거로 이동했을 때 "오늘 (2026-07-05)"처럼 모순된 문구가 되는 걸 방지.
export function periodPresetLabel(preset: PeriodPreset, from: string, to: string, offset = 0): string {
  const { from: f, to: t } = periodPresetRange(preset, from, to, offset);
  if (preset === "year") return f.slice(0, 4);
  if (preset === "month") return f.slice(0, 7);
  if (!f && !t) return "전체 기간";
  if (f === t) return f;
  if (f && t) return `${f} ~ ${t}`;
  return f ? `${f} ~` : `~ ${t}`;
}

export const DOW = ["일", "월", "화", "수", "목", "금", "토"] as const;

// "너 나와!" 도전장의 일시 표시 — 날짜 없이 미정이면 "미정", 날짜만 있고 시간이 정확히
// 자정(작성 폼에서 시간을 비우면 자정으로 저장된다)이면 시간은 "시간 미정"으로 보고
// 날짜만 보여준다. 요일도 같이 보여준다(요청: "요일도 알려줘").
// 챌린지 일시가 오늘인지(당일 경기는 포인트 컬러로 강조 표시하기 위함).
export function isToday(scheduledAt: string | null): boolean {
  if (!scheduledAt) return false;
  const d = new Date(scheduledAt);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export function formatChallengeSchedule(scheduledAt: string | null): string {
  if (!scheduledAt) return "미정";
  const d = new Date(scheduledAt);
  const dateStr = `${d.getMonth() + 1}월 ${d.getDate()}일(${DOW[d.getDay()]})`;
  if (d.getHours() === 0 && d.getMinutes() === 0) return dateStr;
  return `${dateStr} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// 도전장 화면을 경기결과 화면처럼 날짜별로 묶어 보여주면서(요청: "경기 화면처럼 날짜별로
// 그룹핑"), 카드 하나하나엔 그 날짜 그룹 라벨과 중복되는 날짜를 다시 안 적고 시간만
// 보여준다(요청: "각 카드엔 시간만 표시") — 그래서 날짜/시간 표시를 둘로 쪼갠다. 일정이
// 아예 없는 도전장은 별도 그룹으로 모은다.
export function challengeDateGroupLabel(scheduledAt: string | null): string {
  if (!scheduledAt) return "일정 미정";
  const d = new Date(scheduledAt);
  return `${d.getMonth() + 1}월 ${d.getDate()}일(${DOW[d.getDay()]})`;
}
// 시간까지 정해졌을 때만 값을 주고, 자정(시간을 안 정한 경우) 혹은 일정 자체가 없으면
// null — 카드에서 아예 시간을 안 보여준다.
export function challengeTimeLabel(scheduledAt: string | null): string | null {
  if (!scheduledAt) return null;
  const d = new Date(scheduledAt);
  if (d.getHours() === 0 && d.getMinutes() === 0) return null;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
export const MONTHS_KR = [
  "1월", "2월", "3월", "4월", "5월", "6월",
  "7월", "8월", "9월", "10월", "11월", "12월",
] as const;
