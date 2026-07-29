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


// 날짜 표기 앞에 붙일 연도 — 올해면 없고, 다른 해면 두 자리로 붙인다(요청: "전년도부터는
// 25년 이렇게"). 한때 "최근 12개월이면 생략"으로 뒀는데, 그러면 같은 "1월"이 작년 것인지
// 올해 것인지 읽는 사람이 세어봐야 해서 헷갈린다는 피드백으로 해 경계로 되돌렸다.
// 통계 제목의 월 라벨(monthLabel)과 피드 타임스탬프가 이 한 규칙을 같이 쓴다.
export function shortYearPrefix(year: number, now: Date = gameNow()): string {
  return year === now.getFullYear() ? "" : `${String(year).slice(2)}년 `;
}

// "YYYY-MM"을 사람이 읽는 라벨로 — 올해면 "8월", 다른 해면 "25년 8월".
export function monthLabel(month: string, now: Date = gameNow()): string {
  const [y, m] = month.split("-").map(Number);
  return `${shortYearPrefix(y, now)}${m}월`;
}

// "YYYY-MM"을 delta개월만큼 앞/뒤로 옮긴다(음수=과거) — 랭킹 화면의 전월 대비 순위변동/
// 최근 5개월 순위변동 모달이 함께 쓴다.
export function shiftMonthValue(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
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


export const DOW = ["일", "월", "화", "수", "목", "금", "토"] as const;

// "YYYY-MM-DD"를 사람 말로 — "7월 28일 (화)", 올해가 아니면 "25년 3월 4일 (화)"
// (요청: 요일 병기, 전년도부터 두 자리 연도). 아래 formatEventTime이 날짜만 남는 갈래에서
// 이걸 부르므로, 날짜를 보여주는 곳은 결국 전부 이 한 꼴로 모인다.
// new Date(dateStr)로 바로 파싱하면 UTC 자정으로 해석돼 시간대에 따라 요일이 하루 밀릴 수
// 있어, 연/월/일을 직접 나눠 로컬 자정으로 만든다.
// (예전엔 "2026-07-28 (화)"처럼 숫자 날짜로 적는 dateWithDow도 있었는데, 그 꼴을 쓰던
//  화면이 하나도 안 남아 걷어냈다 — 요청: 표기 통일.)
export function shortDateWithDow(dateStr: string, now: Date = gameNow()): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${shortYearPrefix(y, now)}${m}월 ${d}일 (${DOW[new Date(y, m - 1, d).getDay()]})`;
}

const DOW_FULL = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"] as const;

// 이 앱의 유일한 "언제" 표기 규칙(요청: 모두 통일) — 피드·너 나와·포인트 이력·리그
// 대진표가 전부 이 함수를 거친다.
//   · withClock이고 지난 24시간 안이면 상대 표기: "방금 전" / "N분 전" / "N시간 전"
//   · 오늘이면 "오늘", 다가오는 이번주/다음주면 "이번주 토요일" / "다음주 화요일"
//     (주 시작 = 월요일)
//   · 지난 일주일 안이면 일자 대신 요일만 "목요일"
//   · 그 밖은 "7월 28일 (화)", 올해가 아니면 "25년 3월 4일 (화)"(shortDateWithDow)
// withClock이면 끝에 " 21:30"이 붙는다. 날짜만 있는 값(자정 기준)은 상대 표기가 어긋나므로
// 그 갈래를 건너뛴다. 요일을 이미 말로 부르는 갈래에는 괄호 요일을 덧붙이지 않는다 —
// 같은 말을 두 번 하는 셈이라서다.
export function formatEventTime(ms: number, withClock: boolean, now: Date = gameNow()): string {
  const d = new Date(ms);
  if (withClock) {
    const diffMs = now.getTime() - ms;
    if (diffMs >= 0 && diffMs < 24 * 60 * 60 * 1000) {
      const mins = Math.floor(diffMs / 60000);
      if (mins < 1) return "방금 전";
      if (mins < 60) return `${mins}분 전`;
      return `${Math.floor(diffMs / (60 * 60 * 1000))}시간 전`;
    }
  }
  const time = withClock ? ` ${formatKoreanTime(d)}` : "";
  const dayStart = (x: Date) => { const c = new Date(x); c.setHours(0, 0, 0, 0); return c.getTime(); };
  const diffDays = Math.round((dayStart(d) - dayStart(now)) / 86_400_000);
  if (diffDays === 0) return `오늘${time}`;
  if (diffDays > 0) {
    const wkStart = (x: Date) => dayStart(x) - ((x.getDay() + 6) % 7) * 86_400_000;
    const weekDiff = Math.round((wkStart(d) - wkStart(now)) / (7 * 86_400_000));
    if (weekDiff === 0) return `이번주 ${DOW_FULL[d.getDay()]}${time}`;
    if (weekDiff === 1) return `다음주 ${DOW_FULL[d.getDay()]}${time}`;
  } else if (diffDays > -7) {
    return `${DOW_FULL[d.getDay()]}${time}`;
  }
  return `${shortDateWithDow(fmt(d), now)}${time}`;
}

// "YYYY-MM-DD"(시각 없음)에 같은 규칙을 적용한다 — 문자열을 로컬 자정으로 읽어 넘긴다.
export function formatEventDate(dateStr: string, now: Date = gameNow()): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return formatEventTime(new Date(y, m - 1, d).getTime(), false, now);
}

// "너 나와!" 도전장의 예정 일정 — 이제 날짜 하나뿐이다(요청: 시간 필드 삭제). 시각 대신
// "언제"를 사람 말로 적어 두는 자리(scheduledTimeNote)가 따로 있고, 그건 표시 전용이라
// 여기 계산에는 절대 들어오지 않는다. scheduledDate는 한국시간 벽시계값 문자열
// ("YYYY-MM-DD")이라 표시엔 파싱 없이 그대로 쓴다.
export interface ScheduleLike {
  scheduledDate: string | null;
}

// 응답 마감/지남 판정용 로컬(한국) 시각(ms) — 늘 그날 끝(23:59:59)이다. 백엔드와 동일
// (요청: 날짜만 지정 시 그날이 지나면 자동 무응답 취소). 날짜가 없으면 null.
export function scheduledInstantMs(s: ScheduleLike): number | null {
  if (!s.scheduledDate) return null;
  return new Date(`${s.scheduledDate}T23:59:59`).getTime();
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

// 도전장 일정 — 날짜만 정한다(시간 필드 없음). 표기는 앱 공통 규칙(formatEventDate).
export function formatChallengeSchedule(s: ScheduleLike): string {
  if (!s.scheduledDate) return "미정";
  return formatEventDate(s.scheduledDate);
}

// 단일 일시(datetime ISO) 하나를 "YYYY-MM-DD (요일) HH:MM"으로 — 리그 대진표처럼 날짜+시간이
// 항상 함께인 일정 표기에 쓴다(도전장처럼 날짜/시간이 따로 놀지 않는다). null이면 "미정".
export function formatDateTime(iso: string | null): string {
  if (!iso) return "미정";
  return formatEventTime(new Date(iso).getTime(), true);
}

// 도전장 화면을 경기결과 화면처럼 날짜별로 묶어 보여주면서(요청: "경기 화면처럼 날짜별로
// 그룹핑"), 카드 하나하나엔 그 날짜 그룹 라벨과 중복되는 날짜를 다시 안 적고 시간만
// 보여준다(요청: "각 카드엔 시간만 표시") — 그래서 날짜/시간 표시를 둘로 쪼갠다. 일정이
// 아예 없는 도전장은 별도 그룹으로 모은다.
export function challengeDateGroupLabel(s: ScheduleLike): string {
  if (!s.scheduledDate) return "일정 미정";
  return formatEventDate(s.scheduledDate);
}
// 시각 표기는 없앴다(요청) — 날짜 그룹 라벨 아래에 따로 적을 시간이 없다. "언제"는
// 카드 안에서 scheduledTimeNote로 보여준다.

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

// 페이징 있는 카드(재신청/리벤지 이력)에서 지금 보는 페이지가 "얼마나 전/후"인지 보여준다
// (요청: "1개월 23일 전 이런식으로"). 하루 미만이면 "오늘". 시각은 이제 없다.
export function formatRelativeSchedule(s: ScheduleLike): string {
  if (!s.scheduledDate) return "일정 미정";
  const [y, mo, dd] = s.scheduledDate.split("-").map(Number);
  const d = new Date(y, mo - 1, dd);
  const now = gameNow();
  const past = d.getTime() <= now.getTime();
  const [earlier, later] = past ? [d, now] : [now, d];
  const { months, days } = calendarMonthsDays(earlier, later);
  const parts: string[] = [];
  if (months > 0) parts.push(`${months}개월`);
  if (days > 0) parts.push(`${days}일`);
  return parts.length > 0 ? `${parts.join(" ")} ${past ? "전" : "후"}` : "오늘";
}
export const MONTHS_KR = [
  "1월", "2월", "3월", "4월", "5월", "6월",
  "7월", "8월", "9월", "10월", "11월", "12월",
] as const;
