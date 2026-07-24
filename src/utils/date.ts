// 날짜 관련 유틸
import type { PeriodPreset } from "../types";

// <input type="date"/"month">의 연도 칸 상·하한. max에 명시하지 않으면 브라우저 기본 상한이
// 275760년(6자리)이라 키보드로 연도에 5~6자리가 들어가는 문제가 있다 — 4자리 연도의 min/max를
// 주면 연도 칸이 4자리로 제한된다. 모든 날짜/월 입력이 이 상수를 공유한다(요청: 전수 적용).
export const DATE_INPUT_MIN = "1990-01-01";
export const DATE_INPUT_MAX = "2100-12-31";
export const MONTH_INPUT_MIN = "1990-01";
export const MONTH_INPUT_MAX = "2100-12";

export const pad = (n: number): string => String(n).padStart(2, "0");


export const fmt = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// 예전엔 이 앱의 "오늘"을 자정이 아니라 정오(낮 12시)를 경계로 잡아, 정오 이전엔 하루 전
// 날짜를 기준으로 삼았다(밤샘 게임 세션을 시작한 저녁 날짜로 등록/조회하려는 취지). 이제
// 그 정오 기준은 없앤다(요청: "최초 조회조건 정오 기준 이런건 이제 없어도 됨") — "오늘"은
// 그냥 실제 오늘이다. 등록 기본값/조회 기간 프리셋/캘린더 "오늘"이 모두 이 함수를 공유하므로
// 여기 한 곳만 바꾸면 전부 실제 날짜 기준으로 통일된다.
export function gameNow(): Date {
  return new Date();
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

// 월별 화면(랭킹·경기)이 기본으로 보여줄 달 — "그레이스 기간"이 붙는다(요청: "그레이스기간
// 적용 매월 1일 20시까지는 전월 표시"). 새 달로 넘어가도 1일 20시 전까지는 아직 지난달을
// 그대로 보여준다 — 달이 바뀌자마자 새 달(경기 0건)로 갈아치우면 전월 최종 순위/기록을
// 확인할 틈도 없이 빈 표가 되기 때문이다. 1일 20시부터 비로소 이번 달로 넘어간다.
// (그 외 날짜엔 항상 이번 달. 시각은 기기 로컬 시간 = 한국 사용자 기준 KST.)
export function graceMonthValue(): string {
  const now = gameNow();
  if (now.getDate() === 1 && now.getHours() < 20) return shiftMonthValue(currentMonthValue(), -1);
  return currentMonthValue();
}

// 경기 화면의 "일" 단위 기본 조회일 — graceMonthValue와 같은 원칙으로, 자정 넘어 정오
// 전까지는 아직 전날 경기를 등록/조회하는 흐름이 자연스러워 전날을 기본으로 보여준다
// (요청: "경기 기록 조회 필터 기본 조건 일로 하고 정오까지는 전날로 조회"). 정오부터는
// 오늘로 넘어간다.
export function graceDayValue(): string {
  const now = gameNow();
  if (now.getHours() < 12) return fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  return todayStr();
}

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

// "YYYY-MM-DD" 날짜 문자열에 요일을 덧붙인다(요청: "경기 날짜... 요일 정보 추가 월요일
// 수요일 등") — new Date(dateStr)로 바로 파싱하면 UTC 자정으로 해석돼 시간대에 따라
// 요일이 하루 밀릴 수 있어, 연/월/일을 직접 나눠 로컬 자정으로 만든다.
export function dateWithDow(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${dateStr} (${DOW[new Date(y, m - 1, d).getDay()]})`;
}

// "너 나와!" 도전장의 예정 일정 — 날짜/시간이 각각 독립적으로 비어 있을 수 있다(요청:
// "시간은 null 가능", "날짜만 정하고 시간은 나중에"). scheduledDate/scheduledTime은 한국시간
// 벽시계값 문자열("YYYY-MM-DD" / "HH:MM")이라 표시엔 파싱 없이 그대로 쓴다.
export interface ScheduleLike {
  scheduledDate: string | null;
  scheduledTime: string | null;
}

// 응답 마감/지남 판정용 로컬(한국) 시각(ms). 시간 미정이면 그날 끝(23:59:59)으로 본다 —
// 백엔드와 동일(요청: 날짜만 지정 시 그날이 지나면 자동 무응답 취소). 날짜가 없으면 null.
export function scheduledInstantMs(s: ScheduleLike): number | null {
  if (!s.scheduledDate) return null;
  return new Date(`${s.scheduledDate}T${s.scheduledTime ?? "23:59:59"}`).getTime();
}

// 너 나와 일정이 오늘인지(당일 경기는 포인트 컬러로 강조). 날짜만 비교한다.
export function isToday(s: ScheduleLike): boolean {
  if (!s.scheduledDate) return false;
  return s.scheduledDate === fmt(gameNow());
}

// 시간은 24시간제 HH:MM으로 표기한다(요청: "시간도 22:30 형식으로 복귀").
export function formatKoreanTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatChallengeSchedule(s: ScheduleLike): string {
  if (!s.scheduledDate) return "미정";
  const dateLabel = dateWithDow(s.scheduledDate);
  return s.scheduledTime ? `${dateLabel} ${s.scheduledTime}` : `${dateLabel} 시간 미정`;
}

// 단일 일시(datetime ISO) 하나를 "YYYY-MM-DD (요일) HH:MM"으로 — 리그 대진표처럼 날짜+시간이
// 항상 함께인 일정 표기에 쓴다(도전장처럼 날짜/시간이 따로 놀지 않는다). null이면 "미정".
export function formatDateTime(iso: string | null): string {
  if (!iso) return "미정";
  const d = new Date(iso);
  return `${dateWithDow(fmt(d))} ${formatKoreanTime(d)}`;
}

// 도전장 화면을 경기결과 화면처럼 날짜별로 묶어 보여주면서(요청: "경기 화면처럼 날짜별로
// 그룹핑"), 카드 하나하나엔 그 날짜 그룹 라벨과 중복되는 날짜를 다시 안 적고 시간만
// 보여준다(요청: "각 카드엔 시간만 표시") — 그래서 날짜/시간 표시를 둘로 쪼갠다. 일정이
// 아예 없는 도전장은 별도 그룹으로 모은다.
export function challengeDateGroupLabel(s: ScheduleLike): string {
  if (!s.scheduledDate) return "일정 미정";
  return dateWithDow(s.scheduledDate);
}
// 날짜 자체가 없으면(일정 미정) null, 날짜가 있으면 시각(없으면 "시간 미정")을 준다.
export function challengeTimeLabel(s: ScheduleLike): string | null {
  if (!s.scheduledDate) return null;
  return s.scheduledTime ?? "시간 미정";
}

// 두 날짜 사이를 달력 기준 "N개월 M일"로 — earlier <= later. 일수가 음수면 한 달을 빌려와
// (later 직전 달의 일수만큼) 채운다. 시:분은 보지 않는 대략 표기라 같은 날이면 0개월 0일.
function calendarMonthsDays(earlier: Date, later: Date): { months: number; days: number } {
  let months = (later.getFullYear() - earlier.getFullYear()) * 12 + (later.getMonth() - earlier.getMonth());
  let days = later.getDate() - earlier.getDate();
  if (days < 0) {
    months -= 1;
    // later가 속한 달의 "0일" = 그 전 달의 마지막 날짜 = 전 달의 총 일수.
    days += new Date(later.getFullYear(), later.getMonth(), 0).getDate();
  }
  return { months: Math.max(0, months), days: Math.max(0, days) };
}

// 페이징 있는 카드(재신청/리벤지 이력)에서 지금 보는 페이지의 일시를 "얼마나 전/후 + 실제
// 시각"으로 보여준다(요청: "1개월 23일 전 오후 7시 10분 이런식으로"). 하루 미만이면 "오늘".
export function formatRelativeSchedule(s: ScheduleLike): string {
  if (!s.scheduledDate) return "일정 미정";
  const [y, mo, dd] = s.scheduledDate.split("-").map(Number);
  const [hh, mi] = s.scheduledTime ? s.scheduledTime.split(":").map(Number) : [0, 0];
  const d = new Date(y, mo - 1, dd, hh, mi);
  const now = gameNow();
  const past = d.getTime() <= now.getTime();
  const [earlier, later] = past ? [d, now] : [now, d];
  const { months, days } = calendarMonthsDays(earlier, later);
  const parts: string[] = [];
  if (months > 0) parts.push(`${months}개월`);
  if (days > 0) parts.push(`${days}일`);
  const when = parts.length > 0 ? `${parts.join(" ")} ${past ? "전" : "후"}` : "오늘";
  return `${when} ${s.scheduledTime ? formatKoreanTime(d) : "시간 미정"}`;
}
export const MONTHS_KR = [
  "1월", "2월", "3월", "4월", "5월", "6월",
  "7월", "8월", "9월", "10월", "11월", "12월",
] as const;

// 랭킹 집계 기간의 단위 — 월("YYYY-MM")이나 연("YYYY") 하나로 좁혀 순위를 매긴다(요청:
// "필터 기간 년/월, 화살표 하나로 그 단위만큼 이동"). anchor 문자열은 월이면 "YYYY-MM",
// 연이면 "YYYY"다. 아래 헬퍼들은 이 anchor를 실제 조회 범위(from~to)·표시 라벨·이동으로
// 바꿔준다 — 화면(RankingScreen)은 이 헬퍼들만 쓰고 달/연을 직접 계산하지 않는다.
export type PeriodUnit = "month" | "year";

// 그 단위의 "현재"(월은 그레이스 보정 이번 달, 연은 올해) anchor.
export function currentPeriodAnchor(unit: PeriodUnit): string {
  return unit === "year" ? String(gameNow().getFullYear()) : graceMonthValue();
}

// anchor를 그 단위 delta개(음수=과거)만큼 앞뒤로 옮긴다.
export function shiftPeriodAnchor(unit: PeriodUnit, anchor: string, delta: number): string {
  if (unit === "year") return String(Number(anchor) + delta);
  return shiftMonthValue(anchor, delta);
}

// anchor를 실제 조회 범위(그 달/그 해의 첫날~마지막날)로 바꾼다.
export function periodAnchorToRange(unit: PeriodUnit, anchor: string): { from: string; to: string } {
  if (unit === "year") {
    const y = Number(anchor);
    return { from: fmt(new Date(y, 0, 1)), to: fmt(new Date(y, 11, 31)) };
  }
  return monthInputToRange(anchor);
}

// 타이틀 옆에 보여줄 라벨 — 월은 "7월"(그해 안이라 달만), 연은 "2026년".
export function periodAnchorLabel(unit: PeriodUnit, anchor: string): string {
  if (unit === "year") return `${anchor}년`;
  return MONTHS_KR[Number(anchor.slice(5, 7)) - 1];
}

// 순위변동 그래프의 x축(과거→최근)용 짧은 라벨 — 월은 "7월", 연은 "26"(자리 절약).
export function periodAxisLabel(unit: PeriodUnit, anchor: string): string {
  if (unit === "year") return anchor.slice(2);
  return MONTHS_KR[Number(anchor.slice(5, 7)) - 1];
}

// 최근 n개 기간(과거→최근 순) — 순위변동 그래프가 왼쪽부터 시간순으로 그려지도록.
export function recentPeriodAnchors(unit: PeriodUnit, n: number, upto: string): string[] {
  return Array.from({ length: n }, (_, i) => shiftPeriodAnchor(unit, upto, -(n - 1 - i)));
}
