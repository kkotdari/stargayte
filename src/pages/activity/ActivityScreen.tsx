import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import NoticeCard, { noticeLine, NoticeMenu } from "./NoticeCard";
import RankingShiftCard, { RankingShiftMenu } from "./RankingShiftCard";
import LeagueMatchCard from "./LeagueMatchCard";
import { CalendarPlus, ChevronLeft, ClipboardList, MoreHorizontal, Phone, Upload, X } from "lucide-react";
import { Spinner, LoadingMark } from "../../components/common/Feedback";
import SearchFilterBar from "../../components/common/SearchFilterBar";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import KakaoShareButton from "../../components/common/KakaoShareButton";
import { challengePhoto, shareThumb } from "../../utils/kakaoShare";
import GameResultCardBody, { type SearchListRow } from "./GameResultCardBody";
import { GameDetailCloseContext } from "./gameDetailClose";
import ModalHash from "../../utils/modalHash";
import { ActivityCard } from "./ActivityCard";
import Select from "../../components/common/Select";
import { resolveSlotName } from "./GameResultSides";
import { bestRawOf } from "../../utils/replaySummaryData";
import { isComputerSlot } from "../../constants/computerSlot";
import { isUnregisteredSlot } from "../../constants/unregisteredSlot";
import { ChallengeCard, ChallengeTimeHeadEdit, challengeStatusInfo } from "../challenge/ChallengeScreen";
import ReplayReviewModal from "../../modals/ReplayReviewModal";
import ActivityComments, { primeActivityComments } from "./ActivityComments";
import { primeReplayMaps } from "../../hooks/useReplayMap";
import ChallengeFormModal from "../../modals/ChallengeFormModal";
import ScheduleFormModal from "../../modals/ScheduleFormModal";
import ScheduleCard from "./ScheduleCard";
import { formatWhen, formatAgo, serverMs } from "../../utils/date";
import { useAppStore } from "../../store/appStore";
import { isAdminRole } from "../../constants/roles";
import { activeMemberSearchTerms, memberMatchesTerm, normalizeSearchText, splitSearchTerms } from "../../utils/memberSearch";
import { renderReplaySummary } from "../../utils/replaySummaryText";
import { cx } from "../../utils/format";
import { api } from "../../api/client";
import { useCursorPagination } from "../../hooks/useCursorPagination";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useEditableFocused } from "../../hooks/useEditableFocused";
import {
  buildReplayDrafts, type ReplayDraft,
} from "../../utils/replayDraft";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";
import { hasAppUpdatePreloadErrorOccurred } from "../../utils/appUpdate";
import type {
  ActivityFeedItem, ActivityNotice, Challenge, ActivityTargetType, GameOutcome, GameResult, GameResultSlot,
  LeagueMatchActivity, Member, RankingShift, Schedule,
} from "../../types";

const PAGE_SIZE = 100;
const MAX_REPLAY_FILES = 20;



/* (삭제) ROW_CLOSE_MS — 줄을 그 자리에서 펴던 시절의 접힘 시간. 상세가 팝업이 된 뒤로는
   접히는 줄 자체가 없어졌고, "전체 보기"가 화면이 되면서 마지막으로 남아 있던 자리
   (그 창만의 열림 상태)까지 걷혔다. */

/** NEW·UPDATE로 볼 기간(요청: 12시간으로 축소) — 지난 방문을 기억해 두던 방식에서 이
 *  단순한 규칙으로 바꿨다. 누구에게나 같은 것이 보이고, 브라우저에 기억해 둘 것도 없다.
 *  하루였던 것을 반으로 줄인다: 클럽이 저녁에 몰려 치는 곳이라 하루짜리 창은 어제 저녁
 *  것까지 오늘 저녁에 여전히 NEW로 남겨 딱지가 흔해졌다. */
const NEW_WINDOW_MS = 12 * 60 * 60 * 1000;
/** 알약을 반투명으로 눌러 둘 상태(요청) — 이미 끝나서 더 손댈 것이 없는 것들이다.
 *  대기·수락은 아직 살아 있는 이야기라 또렷하게 남는다. */
const STATUS_FADED = new Set(["거절", "버림", "만료", "취소", "미실시", "완료"]);
/** 끝내 실제 게임으로 이어지지 않은 너 나와(요청: 제목·내용·날짜 모두 연하게) — 줄 전체를
 *  눌러 둔다. "완료"는 여기 없다: 그건 실제로 붙은 판이라 다른 줄과 같은 무게로 읽혀야 한다. */
const ROW_VOID = new Set(["거절", "버림", "만료", "취소", "미실시"]);
/** 등록 시각과 수정 시각이 이만큼 넘게 벌어져야 "손댄 것"으로 본다 — 등록 순간에는
 *  둘이 같게 찍히지만, 같은 트랜잭션 안에서도 초 단위 아래로는 어긋날 수 있다. */
const TOUCHED_SLACK_MS = 5000;

// 활동 — 커뮤니티 활동(경기 결과, 너 나와! 일정)을 한 타임라인으로 보여주는 홈 화면.
// 타임라인 기준: 너 나와!는 경기 예정 일시, 경기는 리플레이의 게임 시작 시각.

interface ChallengeItem {
  kind: "challenge";
  time: number;
  withClock: boolean;
  /** 활동에서 꽂히는 자리 — 표시용 time과 다르다(challengeSortMs 주석 참고). */
  sortTime: number;
  /** 날짜를 아직 안 정한 너 나와 — 목록 맨 위에 서고 시각 칸엔 "미정"이 적힌다(요청). */
  undated: boolean;
  challenge: Challenge;
}

export interface GameResultItem {
  kind: "gameResult";
  time: number;
  withClock: boolean;
  gameResult: GameResult;
}

interface RankingShiftItem {
  kind: "rankingShift";
  time: number;
  withClock: boolean;
  /** 하루치 스냅샷 하나 — 개인전·팀전이 그 안의 sections에 함께 들어 있다(요청). */
  shift: RankingShift;
}

/** 일정이 적힌 리그 경기 하나(요청: 리그 매치에 일정 등록 시 활동에 띄움).
 *
 *  너 나와와 같은 자리에 꽂힌다 — 결과가 아직 없으면 '앞으로 있을 일'이라 지금 위에,
 *  결과가 들어오면 그 경기가 열린 때에. 그 판단은 서버가 이미 순서로 내려주므로 여기서는
 *  표시용 시각(약속한 때)만 들고 있으면 된다. */
interface LeagueMatchItem {
  kind: "leagueMatch";
  time: number;
  withClock: boolean;
  match: LeagueMatchActivity;
}

/** 모임 일정 하나(요청: "일정 등록").
 *
 *  리그 경기와 같은 자리에 꽂힌다 — 아직 안 지난 일정은 '앞으로 있을 일'이라 지금 위에,
 *  지난 일정은 그날에. 그 판단은 서버가 순서로 내려주고(_schedule_rows) 여기서는 같은
 *  규칙을 한 번 더 계산한다(줄 열쇠가 맞아야 한다 — ActivityListService 주석 참고). */
interface ScheduleItem {
  kind: "schedule";
  time: number;
  withClock: boolean;
  /** 아직 안 온 일정이 지금 위에 서게 하는 자리 — 표시용 time과 다르다. */
  sortTime: number;
  schedule: Schedule;
}

/** 서버가 남긴 알림 한 줄(요청: 활동 피드에 알림 유형) — 지금은 칭호 변경뿐이지만,
 *  앞으로 다른 알림도 같은 자리로 들어온다. 무엇을 그릴지는 notice.kind가 정한다. */
interface NoticeItem {
  kind: "notice";
  time: number;
  withClock: boolean;
  notice: ActivityNotice;
}

type ActivityItem =
  | ChallengeItem | GameResultItem | RankingShiftItem | LeagueMatchItem | ScheduleItem | NoticeItem;

// 같은 '세션'의 게임결과가 활동에서 2개 이상 연속되면 겹침 스택 하나로 묶는다.
export interface GameResultPostItem {
  kind: "gameResultPost";
  time: number;
  /** 세션 날짜(YYYY-MM-DD) — 달력 날짜가 아니라 sessionDateOf 기준이다. */
  date: string;
  items: GameResultItem[];
}

type DisplayItem = ActivityItem | GameResultPostItem;

/** vs 양옆의 승·무·패 동그라미(요청) — 그 편이 이겼나 졌나를 한 글자로 적는다.
 *
 *  '미실시'는 아무것도 안 그린다: 치르지 않은 판이라 승패가 없고, 그 자리에 무엇을 세우면
 *  "무승부"로 읽힌다. 색은 CSS가 정한다(.scr-activity-outcome-win/draw/lose). */
function OutcomeDot({ result, side }: { result: GameOutcome; side: "team1" | "team2" }) {
  if (result === "not_held") return null;
  const kind = result === "draw" ? "draw" : result === side ? "win" : "lose";
  const text = kind === "draw" ? "무" : kind === "win" ? "승" : "패";
  return <span className={`scr-activity-outcome scr-activity-outcome-${kind}`}>{text}</span>;
}

/** 활동에서 이 항목이 꽂히는 자리(ms) — 너 나와만 표시용 시각과 다르다(challengeSortMs). */
function sortMsOf(it: ActivityItem): number {
  return it.kind === "challenge" || it.kind === "schedule" ? it.sortTime : it.time;
}

/* 서버 시각을 읽을 때는 반드시 serverMs를 거친다(new Date(문자열) 금지).
   서버의 created_at·discarded_at 계열은 UTC인데 DB에 따라 "…+00:00"이 붙기도 안 붙기도
   한다. 안 붙은 문자열을 new Date에 그냥 넣으면 브라우저가 '로컬 시각'으로 읽어, 한국에서는
   실제보다 9시간 이른 순간이 된다. 목록 순서가 바로 그만큼 어긋났다 — 8월 2일 23:56(UTC)에
   버려진 너 나와가 14:56으로 읽혀, 8월 3일 경기들보다 아래로 내려갔다. */
function rankShiftItem(shift: RankingShift): RankingShiftItem {
  return {
    kind: "rankingShift",
    time: serverMs(shift.createdAt),
    withClock: true,
    shift,
  };
}

function noticeItem(n: ActivityNotice): NoticeItem {
  return { kind: "notice", time: serverMs(n.createdAt), withClock: true, notice: n };
}

function challengeItem(c: Challenge): ChallengeItem {
  /* 표시 시각 — 약속한 날이 있으면 무조건 그 날이다(요청). 거절·버림·수락·만료 같은
     응답 처리 시각으로 목록의 시각이 바뀌면 안 된다: 그 너 나와가 가리키는 것은 언제
     붙기로 했느냐이지 언제 답이 왔느냐가 아니다.
     날짜가 미정인 건만 응답 처리 시각(끝난 때)이 기준이 되고, 그마저도 나중에 날짜가
     정해지는 순간 그 날짜가 다시 이긴다 — 그래서 scheduledAt을 먼저 본다. */
  const ended = c.status === "discarded" && c.discardedAt;
  const iso = c.scheduledAt ?? (ended ? c.discardedAt! : c.createdAt);
  return {
    kind: "challenge",
    time: serverMs(iso),
    // 시각 개념이 없어졌다(요청: 너 나와는 날짜만) — 헤더는 늘 날짜만 적는다.
    withClock: false,
    sortTime: challengeSortMs(c),
    // 아직 안 끝난 것만 '미정'이다 — 끝난 건은 끝난 때가 있어 그 시각으로 적힌다.
    undated: !c.scheduledDate && !ended,
    challenge: c,
  };
}

/** 아직 안 끝난(응답대기·성사) 너 나와인가 — 활동에서 "현재" 선보다 위(=앞으로 있을 일)에
 *  놓이는 것은 이것뿐이다. 경기결과·순위변동은 전부 이미 벌어진 일이다. */
export function isUpcomingChallenge(it: { kind: string; challenge?: Challenge }): boolean {
  return it.kind === "challenge"
    && (it.challenge!.status === "pending" || it.challenge!.status === "confirmed");
}

/* 날짜 미정인 너 나와가 앉는 자리 — 실제 시각(ms, 지금 ≈1.8e12)보다 한참 크고 안전한
   정수 범위(9e15) 안이라, 어떤 날짜와 견줘도 항상 위에 선다. */
const UNDATED_SORT_BASE = 4e15;

// 너 나와가 활동 어디에 꽂히나 — 표시용 시각(time)과 따로 계산한다.
//
//  · 아직 안 끝난 것(응답대기·성사)은 "현재" 선 바로 위에 둔다(지적: 아직 안 열린 너 나와가
//    현재보다 아래로 내려가면 안 된다). 약속한 날이 이미 지났어도 마찬가지다 — 결과가
//    안 들어온 이상 그건 여전히 남은 일이다. 예정일이 더 먼 것일수록 위로 간다.
//  · 취소·거절·버림·만료로 끝난 것은 '끝난 때'에 꽂는다 — 카드가 적는 시각과 같아야 한다.
//  · 결과까지 들어온 것(완료)은 그날 경기들 아래로 내린다(요청: "전날 경기 목록과 당일
//    경기목록 사이"). 세션 날짜의 시작(오전 8시 — sessionDateOf의 경계와 같은 값)에
//    앉히면 그날 경기들(8시 이후)보다 아래, 전날 것들보다 위가 된다.
function challengeSortMs(c: Challenge): number {
  const base = serverMs(c.scheduledAt ?? c.createdAt);
  if (c.status === "pending" || c.status === "confirmed") {
    /* 날짜를 아직 안 정한 건 무조건 맨 위다(요청) — "언제 할지 정하자"가 목록에서 가장
       먼저 눈에 띄어야 하는 일이고, 예정일이 없으니 시간축 어디에도 꽂을 자리가 없다.
       실제 날짜들(≈1.8e12)보다 한참 큰 자리에 앉히고, 그 안에서는 늦게 올린 것이 위로
       오게 등록 시각으로 줄을 세운다. */
    if (!c.scheduledDate) return UNDATED_SORT_BASE + serverMs(c.createdAt);
    // 그날 끝(23:59:59)을 기준으로 잡아 같은 날 경기들보다 위에 서게 하고, 이미 지난
    // 약속이면 "지금 바로 위"까지 끌어올린다.
    const endOfDay = new Date(`${c.scheduledDate}T23:59:59`).getTime();
    return Math.max(endOfDay, Date.now() + 1);
  }
  /* 끝난 것(취소·거절·버림·만료)도 약속한 날이 있으면 그 날에 꽂는다 — 적는 시각과 꽂는
     자리는 반드시 같아야 한다(challengeItem의 iso와 한 쌍이다). 다르면 목록은 어느 쪽으로
     읽어도 틀린 그림이 된다.
     한때 여기만 '끝난 때'를 봤는데, 그건 그때 표시 시각도 끝난 때였기 때문이다. 이제
     약속한 날이 늘 먼저이므로(요청) 자리도 그 날을 따른다. 날짜가 미정인 건만 끝난 때에
     꽂힌다 — 그것 말고는 시간축에 놓을 자리가 없다. */
  if (!c.scheduledDate) {
    if (c.status === "discarded" && c.discardedAt) return serverMs(c.discardedAt);
    return base;
  }
  // 결과까지 들어온 건(완료)은 여전히 약속한 날의 이야기다 — 그날 경기들 아래(오전 8시,
  // sessionDateOf의 경계와 같은 값)에 앉혀 전날 것들보다는 위가 되게 한다.
  return new Date(`${c.scheduledDate}T00:00:00`).getTime() + SESSION_DAY_START_HOUR * 3600_000;
}

function scheduleItem(s: Schedule): ScheduleItem {
  // 시각을 안 정한 일정은 그날 끝으로 잡는다 — 자정으로 잡으면 그날 열린 경기들 아래로
  // 내려가, 아직 안 온 일이 이미 끝난 일 밑에 깔린다(서버의 _schedule_rows와 같은 규칙).
  const at = new Date(`${s.scheduledDate}T${s.scheduledTime || "23:59:59"}`).getTime();
  return {
    kind: "schedule",
    time: at,
    withClock: !!s.scheduledTime,
    sortTime: at > Date.now() ? Math.max(at, Date.now() + 1) : at,
    schedule: s,
  };
}

function leagueMatchItem(m: LeagueMatchActivity): LeagueMatchItem {
  return {
    kind: "leagueMatch",
    // 일정이 없으면 목록에 안 오지만, 만에 하나 비어 오면 등록 시각으로 물러선다.
    time: serverMs(m.scheduledAt ?? m.postedAt),
    withClock: true,
    match: m,
  };
}

export function gameResultItem(m: GameResult): GameResultItem {
  const started = m.gameStartedAt ? serverMs(m.gameStartedAt) : null;
  return {
    kind: "gameResult",
    time: started ?? new Date(`${m.date}T00:00:00`).getTime(),
    withClock: started != null,
    gameResult: m,
  };
}

// 게임 한 판이 아니라 "한 자리에서 이어 한 묶음"이 스택의 단위다. 그런데 밤에 시작한
// 자리는 자정을 넘겨 이어지는 일이 흔해서, 달력 날짜로 끊으면 같은 자리가 두 스택으로
// 쪼개진다(요청: 연속된 게임결과는 날짜가 달라도 하나로). 새벽 경기는 전날 밤의 연장으로
// 보고 전날에 붙인다 — 경계는 오전 8시(요청).
const SESSION_DAY_START_HOUR = 8;
export function sessionDateOf(it: GameResultItem): string {
  const d = new Date(it.time);
  // 시각을 모르는 경기(날짜만 등록된 건)는 자정으로 잡혀 있다 — 그걸 새벽으로 읽고
  // 전날로 밀면 안 되니, 시계가 있는 경기에만 이 보정을 건다.
  if (it.withClock && d.getHours() < SESSION_DAY_START_HOUR) d.setDate(d.getDate() - 1);
  const mm = `${d.getMonth() + 1}`.padStart(2, "0");
  const dd = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
// 세션 날짜(YYYY-MM-DD) → 카드 헤더용 라벨. 스택은 자기 첫 아이템의 시각이 아니라
// 세션 날짜로 이름표를 단다 — 새벽 2시 경기가 맨 위에 있다고 "오늘"로 적히면 안 된다.
/** 목록 보기 한 줄의 키 — 펼쳐 둔 줄을 기억하는 데 쓴다. 종류마다 id 공간이 달라
 *  접두어로 갈라 둔다(게임결과 3번과 너 나와 3번이 같은 줄이 되면 안 된다). */
/** 상세 팝업의 주소 해시(요청: 모달마다 고유값) — 게임은 경기 번호, 너나와는 그 id,
 *  일정·알림·순위변동·리그도 제 pk다. 묶음은 날짜가 고유값이다. */
function detailHashOf(it: DisplayItem): string {
  if (it.kind === "gameResult") return `game-${it.gameResult.id}`;
  if (it.kind === "challenge") return `callout-${it.challenge.id}`;
  if (it.kind === "schedule") return `schedule-${it.schedule.id}`;
  if (it.kind === "notice") return `notice-${it.notice.id}`;
  if (it.kind === "rankingShift") return `rank-${it.shift.id}`;
  if (it.kind === "leagueMatch") return `league-${it.match.id}`;
  return `games-${it.date}`;
}

function rowKeyOf(it: DisplayItem): string {
  return it.kind === "challenge" ? `c-${it.challenge.id}`
    : it.kind === "notice" ? `nt-${it.notice.id}`
      : it.kind === "rankingShift" ? `rs-${it.shift.id}`
      : it.kind === "leagueMatch" ? `lm-${it.match.id}`
        : it.kind === "schedule" ? `sc-${it.schedule.id}`
          : it.kind === "gameResultPost" ? `ms-${it.items[0].gameResult.id}`
            : `m-${it.gameResult.id}`;
}

/* (삭제) kindClassOf — 줄의 갈래 색(일정 그린 / 리그 보라 / 너 나와 핑크 / 게임 파랑)을
   배지에 입히던 함수다. 유형 배지를 어느 줄에서도 안 그리게 되면서(요청) 색을 입힐 자리가
   없어졌다 — 갈래는 이제 덩어리 제목이 말한다. 색 자체(CSS의 --kind-*)는 다른 곳에서
   그대로 쓴다. */

/* (삭제) needsReview — '사람 눈이 꼭 필요한 건'만 골라 검토창으로 보내던 판정이다.
   이제 중복만 빼고 전부 검토창으로 보내므로(요청) 고를 일이 없다. 무엇이 문제인지는
   검토창이 줄마다 판정해 배지로 말한다(ReplayReviewModal의 reviewOf). */


/** 이름을 몇 개까지 부르고 나머지는 "외 N명"으로 넘길까 — 한 명이다(요청). 두 명을 부르면
 *  "Cheol · carol 외 1명"처럼 이름 사이 가운뎃점과 "외" 앞 띄어쓰기가 한 줄에 뒤엉켜,
 *  누가 이름이고 어디부터 숫자인지가 오히려 흐려졌다. 한 명만 부르면 "Cheol 외 2명"으로
 *  구조가 단순해진다 — 어차피 누가 다 있었는지는 펼쳐 봐야 안다. */
const ROW_NAME_MAX = 1;

/** 이름들을 부르는 한 가지 방식 — 닉네임만 진하게 두고, 사이의 가운뎃점은 흐리게 띄운다
 *  (요청: "· 좌우에 공백", "닉네임 볼드"). 붙여 쓴 "Cheol·bob"은 한 낱말로 읽혀서 몇
 *  사람인지가 안 보였다. */
function nameNodes(names: string[]): ReactNode[] {
  return names.flatMap((n, i) => [
    ...(i > 0 ? [<span className="scr-activity-row-sep" key={`s${i}`}>·</span>] : []),
    <span className="scr-activity-row-em" key={`n${i}`}>{n}</span>,
  ]);
}

/** "Cheol · bob 외 2명" — 목록 한 줄이 사람을 부르는 방식(요청). 사람 수도 이름과 같이
 *  진하게 둔다: 줄마다 되풀이되는 "외 / 명"은 훑을 때 읽을 값이 아니다. 아무도 없으면 null. */
function namesWithRest(names: string[]): ReactNode {
  if (names.length === 0) return null;
  const rest = names.length - ROW_NAME_MAX;
  return (
    <>
      {nameNodes(names.slice(0, ROW_NAME_MAX))}
      {rest > 0 && <>{" 외 "}<span className="scr-activity-row-em">{rest}</span>{"명"}</>}
    </>
  );
}

/** 게임결과 묶음에 있었던 사람들 — 컴퓨터·비회원은 "누가 있었나"의 답이 아니라서 뺀다
 *  (요약 카드의 참가자 명단과 같은 규칙). 많이 나온 사람부터 부른다. */
/** 그 줄이 깔 배경 사진 — 지금은 편지지 배경을 올린 "너 나와!"뿐이다. */
function rowPhoto(item: DisplayItem): string | null {
  return item.kind === "challenge" ? item.challenge.backdropUrl : null;
}

/* 눌러도 더는 못 읽는 한계 — 이 아래로는 안 누르고 넘치는 만큼 잘라 낸다. 한글은 가로로
   눌리면 획 사이가 먼저 무너져서, 0.5 아래로는 무엇을 해도 안 읽힌다(실측). */
const FLAT_MIN = 0.5;

/* 글자 크기는 그대로 두고 가로로만 눌러 한 줄에 맞춘다(요청: "닉네임 풀로 표시하되 길이가
   안 넘치게 알맞게 스퀴징").

   얼마나 누를지는 줄마다 다르다 — 1:1 두 사람이면 안 눌러도 남고, 여덟이 붙은 판은 많이
   눌러야 들어간다. 고정 비율을 쓰면 둘 중 하나는 늘 틀린다: 짧은 줄은 이유 없이 납작하고
   긴 줄은 그래도 넘친다. 그래서 그린 뒤 실측해서 그 줄에 맞는 비율을 준다.

   재는 법: 안쪽을 width:max-content로 두어 자연스러운 폭(natural)을 얻고, 칸이 실제로 가진
   폭(avail)과의 비를 그대로 쓴다. scaleX는 offsetWidth를 안 건드리므로 눌린 뒤에도 natural은
   그대로다 — 그래서 눌렀다 폈다 하는 되먹임이 안 생긴다. 칸 폭은 ResizeObserver가 본다. */
function FlatLine({ children }: { children: ReactNode }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const inRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const box = boxRef.current;
    const inner = inRef.current;
    if (!box || !inner) return;
    const fit = () => {
      const avail = box.clientWidth;
      const natural = inner.offsetWidth;
      const k = natural > 0 ? Math.min(1, avail / natural) : 1;
      box.style.setProperty("--flat", Math.max(FLAT_MIN, Math.round(k * 1000) / 1000).toString());
    };
    fit();
    /* 눌리는 과정이 보이면 안 된다(요청: "스퀴즈가 보여서 문제, 처음부터 스퀴즈된 상태로")
       — 첫 값은 그리기 전(useLayoutEffect)에 넣지만, 그 값이 전환(transition)을 타면
       줄이 안 눌린 상태에서 눌린 상태로 0.12초 동안 미끄러진다. 목록이 통째로 그렇게
       움직이니 화면이 한 번 출렁였다. 그래서 전환은 첫 그림을 넘긴 뒤에 켠다 — 창을 끌어
       폭이 바뀔 때의 부드러움(그게 이 전환의 원래 목적이다)은 그대로 남는다. */
    const raf = window.requestAnimationFrame(() => { box.dataset.flatReady = "1"; });
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    /* 웹폰트가 늦게 오면 글자 폭이 바뀐다 — 대체 글꼴로 잰 비율은 그 순간 틀린 값이 되고,
       바깥 칸 폭은 안 변해 ResizeObserver도 안 깨어난다. 폰트가 앉는 대로 한 번 더 잰다. */
    document.fonts?.ready.then(fit).catch(() => {});
    return () => { window.cancelAnimationFrame(raf); ro.disconnect(); };
  });
  return (
    <span className="scr-activity-row-flat" ref={boxRef}>
      <span className="scr-activity-row-flat-in" ref={inRef}>{children}</span>
    </span>
  );
}

function playersOf(items: GameResultItem[], memberOf: (id: string) => Member | undefined): string[] {
  const seen = new Map<string, { name: string; n: number; won: number }>();
  for (const it of items) {
    for (const side of ["team1", "team2"] as const) {
      for (const slot of it.gameResult[side]) {
        if (isComputerSlot(slot.memberId) || isUnregisteredSlot(slot.memberId)) continue;
        const cur = seen.get(slot.memberId)
          ?? { name: resolveSlotName(slot, it.gameResult[side], memberOf), n: 0, won: 0 };
        cur.n += 1;
        if (it.gameResult.result === side) cur.won += 1;
        seen.set(slot.memberId, cur);
      }
    }
  }
  /* 많이 친 사람이 앞이고, 같으면 많이 이긴 사람이 앞이다(요청) — 묶음 제목에 이름을
     둘까지만 적으므로 그 두 자리를 누가 가져가는지가 곧 이 줄이 누구 이야기인지가 된다.
     예전엔 앞자리가 판수만으로 정해져, 같은 판수면 목록에 먼저 걸린 순서였다. */
  return [...seen.values()]
    .sort((a, b) => b.n - a.n || b.won - a.won)
    .map((x) => x.name);
}

export function sessionDateLabel(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}월 ${Number(d)}일`;
}

/* (삭제) ChallengeCountdown — 카드 머리의 "응답마감까지 72:32:31" 시계다. 목록 보기에서는
   카드 머리 자체가 감춰져 있어(.scr-activity-card-head-off) 아무에게도 안 보이던 채로
   1초마다 돌고 있었다(지적: 카운트다운이 없어졌다). 이제 그 말은 카드 윗줄 가운데에서
   ChallengeDeadline이 하고, 초 단위로 뛰지도 않는다(요청: 실시간 변동 X). */

// 너 나와 카드 우상단 케밥 — 카카오 공유(전체) + 삭제(운영자만).
function ChallengeActionsMenu({ challenge, isAdmin, myId, onDeleted, onChanged }: {
  challenge: Challenge;
  isAdmin: boolean;
  /** 지금 보고 있는 사람 — 제 호출만 취소할 수 있어서 필요하다(요청). */
  myId: string;
  onDeleted: (id: number) => void;
  onChanged: (c: Challenge) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // 삭제·취소가 실패했을 때 확인창 안에 남길 말 — 두 창이 동시에 뜨는 일은 없어 하나로 쓴다.
  const [err, setErr] = useState<string | null>(null);
  /* 취소는 부른 사람(또는 운영자)이, 아직 안 끝난 것만(요청: "호출자가 취소도 가능함").
     삭제와 달리 기록은 남고 폐기로만 넘어간다 — 활동에 "취소"로 남는다. */
  const canCancel = (challenge.createdBy.id === myId || isAdmin)
    && (challenge.status === "pending" || challenge.status === "confirmed");

  // 지목된 상대는 절대 미리보기에 내지 않는다(요청: "누구한테 보냈는지는 꼭 숨겨달라") —
  // 누가 불렸는지는 링크를 열어 편지지에서 확인하는 것이 이 기능의 재미다. 여기만 대진을
  // 그대로 description에 넣어 카톡 카드에 "vs Rex"가 찍혔다(신고). 호출을 보낼 때 뜨는
  // 확인창(ChallengeFormModal의 shareCall)과 같은 문구로 맞춘다.
  // 응답(수락/거절) 공유는 그대로 대진을 보여준다 — 그건 불린 사람이 스스로 알리는 것이다.
  const shareContent = () => {
    const caller = challenge.createdBy.nickname;
    return {
      title: `${caller ? `${caller}님` : "누군가"}의 호출`,
      description: "누가 호출됐을까요? 👀 탭해서 확인하기",
      // 편지지 배경 사진을 올린 호출이면 여기서도 그 사진의 공유 카드판을 쓴다(요청:
      // "활동 목록에서 공유한 경우에도 편지지를 카톡 미리보기로" — 통일성). 보낼 때 뜨는
      // 확인창과 같은 그림이어야, 어디서 공유하든 같은 카드가 나간다.
      ...shareThumb("challengeCall", challengePhoto(challenge)),
      link: `${window.location.origin}/?sv=challenge&sid=${challenge.id}`,
      fallbackText: `[스타게이트] ${caller ? `${caller}님` : "누군가"}의 호출이 도착했어요! 열어서 확인해보세요.`,
    };
  };

  // 실패하면 창을 닫지 않고 그 자리에 이유를 남긴다 — 예전엔 catch 없이 finally에서
  // 무조건 닫아서, 요청이 깨져도 창만 사라지고 아무 일도 안 일어난 것처럼 보였다
  // (지적: "조용히 오류남"). 성공했을 때만 닫는다.
  const remove = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.deleteChallenge(challenge.id);
      onDeleted(challenge.id);
      setConfirmOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "삭제하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    setErr(null);
    try {
      onChanged(await api.cancelChallenge(challenge.id));
      setCancelOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "취소하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scr-activity-chal-menu">
      <button
        type="button" className="scr-activity-post-menu-btn scr-activity-kebab-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="더보기" aria-haspopup="menu" aria-expanded={open}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <>
          {/* 백드롭 클릭은 '메뉴 닫기'에서 끝나야 한다(지적) — 안 끊으면 그 클릭이
              카드 본체까지 올라가 펼침/접힘까지 같이 눌린다. */}
          <div
            className="scr-activity-add-backdrop"
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            aria-hidden
          />
          <div className="scr-menu-pop-drop scr-activity-chal-menu-drop" role="menu">
            <KakaoShareButton variant="menu" content={shareContent} onDone={() => setOpen(false)} />
            {canCancel && (
              <button
                type="button" role="menuitem" className="scr-menu-pop-opt"
                onClick={() => { setOpen(false); setCancelOpen(true); }}
              >
                취소
              </button>
            )}
            {isAdmin && (
              <button
                type="button" role="menuitem"
                className={cx("scr-menu-pop-opt", "scr-activity-post-menu-opt-danger")}
                onClick={() => { setOpen(false); setConfirmOpen(true); }}
              >
                삭제
              </button>
            )}
          </div>
        </>
      )}
      {confirmOpen && (
        <ConfirmDialog
          title="너 나와! 삭제"
          message="이 너 나와!를 완전히 삭제할까요? 되돌릴 수 없어요."
          confirmLabel={busy ? "삭제 중..." : "삭제"}
          error={err}
          onConfirm={() => void remove()}
          onCancel={() => { setConfirmOpen(false); setErr(null); }}
        />
      )}
      {cancelOpen && (
        <ConfirmDialog
          title="너 나와! 취소"
          message="이 호출을 거둬들일까요? 활동에는 취소로 남아요."
          confirmLabel={busy ? "취소 중..." : "취소하기"}
          // 기본 취소 버튼도 "취소"라 한 창에 취소가 둘이 된다 — 물러나는 쪽은 "그냥 둘래요"로.
          cancelLabel="그냥 둘래요"
          error={err}
          onConfirm={() => void cancel()}
          onCancel={() => { setCancelOpen(false); setErr(null); }}
        />
      )}
    </div>
  );
}

// 활동 카드 하단 공통 댓글 영역 — 목록은 항상, 입력창은 아이콘 옆에서 열리고 닫힌다.
// 래퍼(.scr-activity-card-comment)는 ActivityCard가 낸다 — 댓글이 있는 타입만 이 컴포넌트를
// comment 슬롯에 넘긴다.
function ActivityCardComments({ targetType, targetId }: { targetType: ActivityTargetType; targetId: number }) {
  return <ActivityComments targetType={targetType} targetId={targetId} />;
}

// 경기 카드 — 한 경기가 활동 카드 한 장. 기존 경기 로우(접힌 상태)를 카드 본문에 그대로
// 앉히고(누르면 그 자리에서 펼쳐짐), 하단에 활동 댓글을 단다.
// memo — 스택 개폐(setOpen)는 GameResultPost만 다시 렌더하면 되는데, 그때마다 카드 전체
// (경기 로우·댓글·아바타 이미지)까지 다시 렌더되면서 iOS에서 기존 카드들이 깜빡였다
// (지적: "펼치기 접기 누를 때 기존 요소들도 다시 그리는 것 같아"). 개폐 때 카드 props는
// 전부 같은 참조라 memo가 전부 걸러낸다.
export const GameResultCard = memo(function GameResultCard({ item, memberOf, onDeleted, dateLabel, highlightMemberIds, highlightTerms, active = true, className }: {
  item: GameResultItem;
  memberOf: (id: string) => Member | undefined;
  onDeleted: (id: number) => void;
  dateLabel: string;
  highlightMemberIds?: Set<string>;
  highlightTerms?: string[];
  active?: boolean;
  // 게임결과 묶음을 펼칠 때 카드가 하나씩 나타나는 등장 연출에 쓴다(GameResultPost).
  className?: string;
}) {
  const rows: SearchListRow[] = useMemo(() => {
    const m = item.gameResult;
    return [{ id: m.id, date: m.date, team1: m.team1, team2: m.team2, result: m.result, raw: m }];
  }, [item.gameResult]);

  return (
    <ActivityCard
      className={className}
      dateLabel={dateLabel}
      icon={<ClipboardList size={16} aria-hidden />}
      label="게임결과"
      timeText={formatWhen(item.time, { clock: item.withClock })}
      // (삭제) 카드 머리의 "○○ 등록" — 미니맵 재생 바 아래로 옮겼다(요청). 경기 시각
      // 바로 옆에 나란히 서니 둘이 한 덩어리로 읽혀 '등록한 시각'처럼 보였다(지적).
      bodyClassName="scr-activity-game-result-body"
      comment={<ActivityCardComments targetType="gameResult" targetId={item.gameResult.id} />}
    >
      <GameResultCardBody rows={rows} memberOf={memberOf} onDeleted={onDeleted} highlightMemberIds={highlightMemberIds} highlightTerms={highlightTerms} active={active} />
    </ActivityCard>
  );
});

// 게임결과 묶음 — 접힘은 그 세션의 참가자 전원을 담은 '요약 카드'이고, "자세히 보기"를
// 누르면 활동 안에서 그 자리가 게임결과 카드 목록으로 바뀐다(요청). 한때 전체화면 모달로
// 열어봤지만 다시 이 아코디언으로 돌아왔다.
export function GameResultPost({
  stack, memberOf, onDeleted, dateLabel, highlightMemberIds, highlightTerms,
}: {
  stack: GameResultPostItem;
  memberOf: (id: string) => Member | undefined;
  onDeleted: (id: number) => void;
  dateLabel: string;
  highlightMemberIds?: Set<string>;
  highlightTerms?: string[];
}) {
  /* 한 자리에서 이어 친 경기들을 그대로 늘어놓는다.
     예전엔 접힌 '요약 카드'(참가자 명단 + 카카오 공유)가 먼저 뜨고 눌러야 펼쳐졌는데,
     통째로 걷어냈다(요청: 묶음 공유가 더 이상 불가능해져 요약 카드도 필요 없음).
     그와 함께 딸려 있던 것들도 같이 나갔다 — 펼침 상태, 펼친 뒤 스크롤 이동, 참가자
     집계, 묶음 공유 메뉴. 목록에서는 어차피 줄을 누르면 바로 경기들이 나오고, 그 줄이
     이미 "n명 n경기"로 요약을 말한다. */
  // 최신 경기가 위로 — 펼친 목록은 활동과 같은 시간 순서(최신 → 과거)를 따른다.
  const orderedDesc = useMemo(() => [...stack.items].sort((a, b) => b.time - a.time), [stack.items]);
  return (
    <div className="scr-activity-card-stack-wrapper">
      {orderedDesc.map((it) => (
        <GameResultCard
          key={it.gameResult.id}
          item={it} memberOf={memberOf} onDeleted={onDeleted} dateLabel={dateLabel}
          highlightMemberIds={highlightMemberIds} highlightTerms={highlightTerms}
        />
      ))}
    </div>
  );
}

/* 활동을 유형별 덩어리로 나눈다(요청: "활동 화면을 유형별 목록으로 구분하는데 각
   덩어리별로 중 타이틀 달고 그 옆에 전체 보기 버튼 추가"). 유형 필터(나열선택형)는
   이제 없다 — 필터로 하나만 골라 보던 것을, 다섯 덩어리를 한 화면에 늘어놓고 각자
   "전체 보기"로 파고드는 방식으로 바꿨다.
   알림은 랭크 변동까지 함께 든다 — 둘 다 사람이 올린 글이 아니라 서버가 남긴 한 줄이고,
   화면에서도 같은 카드 자리에 선다(요청: 표시만 통합). */
type ActivityGroupKey = "notice" | "schedule" | "league" | "call" | "gameResult";

const GROUP_DEFS: { key: ActivityGroupKey; label: string }[] = [
  { key: "notice", label: "알림" },
  { key: "schedule", label: "일정" },
  { key: "league", label: "리그" },
  { key: "call", label: "너 나와!" },
  { key: "gameResult", label: "게임" },
];

/* 전체 보기의 주소·스크린 코드(요청: 해시 말고 페이지 경로로 + 갈래마다 코드) —
   화면 주소와 같은 결의 쿼리(?screen=activity&group=gameResult)로 남긴다. 새로고침해도
   그 목록으로 돌아오고, 진입 이력은 갈래별 코드로 남는다(서버 ScreenCode와 짝). */
const GROUP_SCREEN_CODE: Record<ActivityGroupKey, string> = {
  notice: "activity_notice",
  schedule: "activity_schedule",
  league: "activity_league",
  call: "activity_call",
  gameResult: "activity_game",
};

function groupFromUrl(): ActivityGroupKey | null {
  const g = new URLSearchParams(window.location.search).get("group");
  return GROUP_DEFS.some((d) => d.key === g) ? (g as ActivityGroupKey) : null;
}

/** 이 항목이 어느 덩어리로 가나. */
function groupKeyOf(item: ActivityItem): ActivityGroupKey {
  return item.kind === "gameResult" ? "gameResult"
    : item.kind === "challenge" ? "call"
    : item.kind === "leagueMatch" ? "league"
    : item.kind === "schedule" ? "schedule"
    : "notice"; // notice · rankingShift
}

/** 한 덩어리를 접었을 때 목록에 보이는 최대 줄 수 — 그 이상은 "전체 보기"로.
 *  5 → 3(요청: 활동 페이지 목록은 최대 3개 노출). */
const GROUP_PREVIEW_MAX = 3;

/** 리그·너 나와·게임 "전체 보기" 팝업에만 유저 필터가 있다(요청: "유저필터는 리그,
 *  너나와, 게임목록 전체보기에 넣음") — 나머지(알림·일정)는 사람으로 거를 일이 없는
 *  갈래라 검색창을 둘 이유가 없다. */
const SEARCHABLE_GROUPS = new Set<ActivityGroupKey>(["league", "call", "gameResult"]);

/** "전체 보기" 화면 — 한 덩어리의 전체 목록을 보여준다. 팝업이 아니라 활동 화면을 갈아
 *  끼우는 페이지다(요청: "활동 전체보기시 모달이 아닌 페이지로 이동하게") — 목록 하나를
 *  통째로 담고, 그 안에서 검색하고, 다시 그 안에서 상세를 여는 자리라 잠깐 떴다 사라지는
 *  창보다 화면이 맞다. 돌아가는 길은 화면 아래 동그란 버튼이다(요청) — 활동 목록에서
 *  "등록"이던 그 자리가 이 화면에서는 "뒤로"가 된다(ActivityScreen의 FAB).
 *  리그·너 나와·게임(SEARCHABLE_GROUPS)만 유저 검색이 있다(요청: "유저필터는 리그, 너나와,
 *  게임목록 전체보기에 넣음") — 알림·일정은 사람으로 거를 일이 없는 갈래라 목록만 보여준다.
 *  줄 렌더는 부르는 쪽(ActivityScreen)의 renderRow를 그대로 받아 쓴다 — 미리보기와 이 화면이
 *  같은 함수를 쓰면 카드 쪽 수정이 한 곳만 고치면 양쪽에 반영된다. */
function ActivityGroupPage({
  groupKey, label, items, memberOf, members, renderRow, onBack,
}: {
  groupKey: ActivityGroupKey;
  label: string;
  items: ActivityItem[];
  memberOf: (id: string) => Member | undefined;
  members: Member[];
  renderRow: (item: DisplayItem) => ReactNode;
  /** 제목의 "활동"을 누르면 돌아간다 — 화면 아래 뒤로 버튼과 같은 길(closeGroup)을 탄다. */
  onBack: () => void;
}) {
  const searchable = SEARCHABLE_GROUPS.has(groupKey);
  const [search, setSearch] = useState("");
  /* 경기 내용 검색(요청) — 자막에 적힌 말로 찾는다("포토러시", "핵", "커널"…). 유저 검색과
     따로 두는 까닭은 찾는 것이 다르기 때문이다: 이쪽은 사람이 아니라 그 판에서 무슨 일이
     있었나다. 그래서 닉네임은 일부러 안 찾는다(요청) — 아래 captionOf가 이름 자리를 기호로
     바꿔 글에서 아예 지운다. 안 그러면 사람 이름이 두 검색창에 다 걸려, 이 칸이 유저
     검색을 두 번 하는 자리가 된다. */
  const [content, setContent] = useState("");
  /* 고른 사람들을 어떻게 읽을 것인가 — 활동 목록이 전에 쓰던 것과 같은 두 갈래다.
       all  — 포함 : 고른 사람이 다 나온 판이면 된다. 다른 사람이 더 껴 있어도 걸린다.
       only — 일치 : 그 판에 나온 사람이 고른 사람들과 정확히 같아야 한다. */
  const [userMode, setUserMode] = useState<"all" | "only">("all");
  const suggestions = useMemo(() => activeMemberSearchTerms(members), [members]);
  const searchTerms = useMemo(() => splitSearchTerms(search), [search]);
  const contentTerms = useMemo(() => splitSearchTerms(content), [content]);
  /* 자막 한 벌은 한 번만 만든다 — 글자 하나 칠 때마다 목록 전체의 문장을 다시 짓는 일이라,
     캐시가 없으면 타이핑이 그대로 멈춘다. 열쇠는 경기 번호다(문장은 그 경기의 요약에서만
     나온다). */
  const captions = useRef(new Map<number, string>());
  const captionOf = (g: GameResult): string => {
    const hit = captions.current.get(g.id);
    if (hit !== undefined) return hit;
    /* 이름은 죄다 같은 기호로 바꾼다(요청: 닉네임은 아님) — 문장 틀은 이름의 받침을 보고
       조사를 고르므로, 지우는 대신 한 글자로 바꿔야 문장이 그대로 선다. */
    const text = normalizeSearchText(renderReplaySummary(g.summaryData, () => "○") ?? "");
    captions.current.set(g.id, text);
    return text;
  };

  const slotMatchesTerm = (slot: GameResultSlot, term: string): boolean => {
    const m = memberOf(slot.memberId);
    if (m && memberMatchesTerm(m, term)) return true;
    return !!slot.rawName && normalizeSearchText(slot.rawName).includes(term);
  };
  const challengeMatchesTerm = (c: Challenge, term: string): boolean => {
    const names = [c.createdBy.nickname, ...c.ownMembers.map((m) => m.nickname), ...c.targets.map((t) => t.nickname)];
    if (names.some((n) => normalizeSearchText(n).includes(term))) return true;
    const ids = [c.createdBy.id, ...c.ownMembers.map((m) => m.memberId), ...c.targets.map((t) => t.memberId)];
    return ids.some((id) => { const m = memberOf(id); return !!m && memberMatchesTerm(m, term); });
  };

  const filtered = useMemo(() => {
    if (!searchable || (searchTerms.length === 0 && contentTerms.length === 0)) return items;
    const onlyThese = userMode === "only";
    return items.filter((item) => {
      /* 경기 내용으로 찾는 중이면 경기만 남는다 — 너 나와·리그 줄에는 자막 자체가 없어서
         "안 걸린 것"이 아니라 "잴 수 없는 것"이다. 목록에 그대로 두면 걸러진 결과처럼
         보인다. */
      if (contentTerms.length > 0) {
        if (item.kind !== "gameResult") return false;
        const caption = captionOf(item.gameResult);
        if (!contentTerms.every((term) => caption.includes(term))) return false;
      }
      if (searchTerms.length === 0) return true;
      if (item.kind === "gameResult") {
        const slots = [...item.gameResult.team1, ...item.gameResult.team2];
        if (!searchTerms.every((term) => slots.some((slot) => slotMatchesTerm(slot, term)))) return false;
        return !onlyThese || slots.every((slot) => isComputerSlot(slot.memberId)
          || searchTerms.some((term) => slotMatchesTerm(slot, term)));
      }
      if (item.kind === "challenge") {
        if (!searchTerms.every((term) => challengeMatchesTerm(item.challenge, term))) return false;
        if (!onlyThese) return true;
        const c = item.challenge;
        const everyone = [
          c.createdBy.nickname, ...c.ownMembers.map((m) => m.nickname), ...c.targets.map((t) => t.nickname),
        ];
        return everyone.every((n) => searchTerms.some((term) => normalizeSearchText(n).includes(term)));
      }
      if (item.kind === "leagueMatch") {
        const names = [item.match.teamA, item.match.teamB]
          .flatMap((t) => (t ? t.members.map((x) => x.nickname) : []));
        const text = normalizeSearchText([...names, item.match.leagueName].join(" "));
        if (!searchTerms.every((term) => text.includes(term))) return false;
        return !onlyThese
          || names.every((n) => searchTerms.some((term) => normalizeSearchText(n).includes(term)));
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slotMatchesTerm/challengeMatchesTerm은 memberOf로 충분히 표현됨
  }, [items, searchTerms, contentTerms, userMode, searchable, memberOf]);

  /* 페이지로 들어온 것이니 맨 위에서 시작한다 — 활동 목록을 한참 내려보다 눌렀을 때 그
     스크롤 위치를 그대로 물려받으면, 새 화면이 중간부터 열린 것처럼 보인다.
     instant를 못 박는 것이 요점이다(요청: "스크롤 이동이 아니라 페이지 즉시 전환") —
     문서 루트에 scroll-behavior:smooth가 걸려 있어서 그냥 scrollTo하면 새 화면이 뜬 채로
     맨 위까지 주르륵 굴러 올라간다. 화면이 바뀐 것이 아니라 같은 화면을 스크롤한 것처럼
     보인다. 그리는 것과 같은 프레임에 끝내야 하므로 useLayoutEffect다. */
  useLayoutEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [groupKey]);

  return (
    <div className="scr-activity-group-page">
      <div className="scr-v2-toolbar">
        <div className="scr-v2-toolbar-title-row">
          {/* (삭제) 제목 왼쪽 ← — 돌아가는 길은 이제 화면 아래 등록 버튼 자리가 맡는다(요청).
              화면마다 그 자리에 뜨는 동그란 버튼이 이미 "이 화면에서 할 일"이라, 돌아가기도
              거기 있는 편이 손이 가는 자리와 맞는다(ActivityScreen의 FAB 참고). */}
          {/* 어디서 어디로 들어왔나를 제목이 말한다(요청: "활동 > 게임") — 이 화면은 주소가
              바뀌지 않는 '화면 안의 화면'이라, 갈래 이름만 있으면 활동에서 파고든 자리인지
              아예 다른 탭인지가 안 보인다.
              갈래 이름은 목록의 소제목과 같은 크기로 둔다(요청: 게임은 18px 그대로) — 밖에서
              누른 그 소제목이 여기 제목이 된 것이라, 크기가 같아야 같은 것으로 읽힌다. */}
          <h1 className="scr-title scr-v2-toolbar-title">
            {/* 앞머리는 누르면 돌아간다(지적: 빵부스러기는 원래 그런 것) — 이력을 되감는
                같은 길이라, 브라우저 뒤로가기·아래 뒤로 버튼과 결과가 늘 같다. */}
            <button type="button" className="scr-activity-crumb-root" onClick={onBack}>활동</button>
            <span className="scr-activity-crumb-sep">›</span>
            <span className="scr-activity-crumb-leaf">{label}</span>
          </h1>
        </div>
      </div>
      {searchable && (
        <SearchFilterBar
          count={filtered.length}
          countLabel="건"
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="유저 입력 또는 @로 목록 띄우기"
          suggestions={suggestions}
          /* 경기 갈래에만 둔다(요청: 게임 전체 목록에 경기 내용 검색) — 자막이 있는 갈래가
             여기뿐이다. PC에서는 유저 검색과 한 줄, 모바일에서는 아랫줄이다(trailing). */
          trailing={groupKey === "gameResult" ? (
            <input
              className="scr-input scr-activity-content-search"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="경기 내용 검색"
              aria-label="경기 내용 검색"
            />
          ) : undefined}
          searchLeading={(
            <Select
              className="scr-user-mode-select"
              size="sm"
              value={userMode}
              options={[
                { value: "all", label: "포함" },
                { value: "only", label: "일치" },
              ]}
              onChange={(v) => setUserMode(v === "only" ? "only" : "all")}
              minDropWidth={92}
            />
          )}
        />
      )}
      {/* 이 화면에서는 목록을 묶지 않는다(요청) — 화면 하나가 곧 한 갈래라, 그 안에서 다시
          테두리를 두르면 같은 말을 두 번 하는 셈이다. */}
      <div className="scr-activity-rows scr-activity-group-page-rows">
        {filtered.length === 0 ? (
          <div className="scr-empty">조건에 맞는 항목이 없어요.</div>
        ) : (
          filtered.map((item) => renderRow(item))
        )}
      </div>
    </div>
  );
}

export default function ActivityScreen() {
  /* (삭제) 화면 배경 사진 — 통째로 걷었다(요청). 유형별 덩어리마다 테두리를 두른 뒤로는
     목록 자체가 화면의 뼈대가 됐고, 그 뒤에 깔린 사진은 테두리 안팎을 함께 흐려 묶음의
     경계를 도로 지웠다. */
  /* 유저 검색은 이제 이 화면에 없다(요청: "유형 필터, 유저필터 제거하고 유저필터는 리그,
     너나와, 게임목록 전체보기에 넣음") — 리그·너 나와·게임 "전체 보기" 팝업
     (ActivityGroupPage)이 각자 제 목록 안에서만 검색한다. 포함/일치 두 갈래(요청: "선택된
     사람들이 모두 포함된 경우 / 선택된 사람만 있는 경우 둘로 나누고 싶다")도 그 화면
     안에서 관리한다.
     지금 들어와 있는 "전체 보기" 갈래 — null이면 활동 목록(홈)이다. */
  // 새로고침해도 보던 전체 보기 그대로(요청: 페이지 경로) — 주소의 group을 그대로 잇는다.
  const [openGroupKey, setOpenGroupKey] = useState<ActivityGroupKey | null>(groupFromUrl);
  /* 우리가 얹은 히스토리 칸인가 — 새로고침·링크로 바로 들어온 자리에서 닫을 때
     history.back()을 쏘면 앱 밖(이전 페이지)으로 물러난다. 그때는 주소만 지운다. */
  const pushedGroupRef = useRef(false);
  /* 제목 줄의 닉네임을 자를지 — 폰에서만 자른다(요청: PC에서는 줄이지 않기). 글자 수를
     JS가 자르는 값이라 CSS 미디어쿼리로는 되돌릴 수 없어, 폭을 여기서 본다. */
  const isMobile = useIsMobile();
  /* 들어갈 때 두고 온 활동 목록의 스크롤 자리 — 돌아오면 그 자리로 되돌린다. 같은 문서를
     스크롤해 오갔으므로 안 되돌리면 전체 보기에서 내려 본 만큼 활동 목록도 내려가 있다.
     되돌리는 것도 instant다(요청: 즉시 전환) — 문서 루트의 smooth를 그대로 두면 돌아오자마자
     화면이 스스로 굴러간다. */
  const homeScrollRef = useRef(0);
  /* 전체 보기는 이력에 한 칸을 남긴다(요청: 뒤로가기 버튼이 먹히게) — 주소는 해시가
     아니라 화면 주소와 같은 쿼리(?group=…)다(요청: 페이지 경로). 진입 이력도 갈래별
     스크린 코드로 남긴다(요청). */
  const openGroup = (key: ActivityGroupKey) => {
    homeScrollRef.current = window.scrollY;
    setOpenGroupKey(key);
    const params = new URLSearchParams(window.location.search);
    params.set("group", key);
    window.history.pushState({ activityGroup: key }, "", `${window.location.pathname}?${params.toString()}`);
    pushedGroupRef.current = true;
    void api.pingAccess(GROUP_SCREEN_CODE[key]);
  };
  /* 닫기 — 우리가 얹은 칸이면 이력을 되감고(뒤로가기와 결과가 같다), 새로고침·링크로
     바로 들어온 자리면 히스토리를 안 건드리고 주소의 group만 지운다. */
  const closeGroup = () => {
    if (pushedGroupRef.current) {
      window.history.back();
      return;
    }
    const params = new URLSearchParams(window.location.search);
    params.delete("group");
    const qs = params.toString();
    window.history.replaceState(
      window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`,
    );
    setOpenGroupKey(null);
  };
  useEffect(() => {
    /* 뒤로/앞으로가기 — 주소의 group이 곧 상태다. 그룹 칸이 걷히면 닫히고, 앞으로가기로
       되살아나면 다시 열린다. 다른 무엇도 이 리스너로 닫히지 않는다(고질 지적의 교훈). */
    const onPop = () => {
      pushedGroupRef.current = false;
      setOpenGroupKey(groupFromUrl());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  /* 새로고침·링크로 바로 들어온 전체 보기도 이력에 남긴다(요청: 갈래별 스크린 코드) —
     openGroup을 안 거친 진입이라 여기서 한 번 찍는다. */
  useEffect(() => {
    if (openGroupKey) void api.pingAccess(GROUP_SCREEN_CODE[openGroupKey]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 시 초기값만
  }, []);
  useLayoutEffect(() => {
    if (openGroupKey === null && homeScrollRef.current > 0) {
      window.scrollTo({ top: homeScrollRef.current, behavior: "instant" });
    }
  }, [openGroupKey]);

  /* 목록 한 줄을 눌러 펼친다 — 펼침은 한 번에 하나다. 여러 줄을 동시에 펴 두면 목록의
     값어치(한 화면에 많이)가 사라진다.
     (예전엔 카드를 죽 늘어놓는 '타임라인' 보기가 따로 있고 둘을 버튼으로 오갔는데,
      통째로 걷어냈다(요청) — 목록이 기본이 된 뒤로는 아무도 그쪽으로 넘어가지 않았고,
      같은 카드를 두 가지 배치로 그리느라 카드 쪽 수정마다 양쪽을 다 확인해야 했다.
      보던 모양을 기억하던 localStorage 자리도 함께 없앴다.) */
  /* 줄을 누르면 그 자리에서 펼치던 것을 팝업으로 바꿨다(요청: 목록 클릭시 펼치기가 아니라
     또 한 번 팝업으로). 함께 사라진 것들:
       · 열림/닫힘 상태와 접힘 연출 타이머(openRowKey·closingRowKey·ROW_CLOSE_MS)
       · 펼친 줄을 화면 맨 위로 올리던 보정(scrollRowToTop·cardBottomOf·rowElsRef)
     그 보정은 '카드가 줄 아래로 열려 화면 밖으로 나가는' 문제를 푸는 것이었는데, 팝업은
     애초에 화면 가운데에 뜨므로 풀 문제가 없다. 목록도 안 밀린다 — 뒤에 그대로 있다. */
  const [detailItem, setDetailItem] = useState<DisplayItem | null>(null);

  const user = useAppStore((s) => s.user);
  const isAdmin = !!user && isAdminRole(user.roles);
  const memberOf = useAppStore((s) => s.memberOf);
  const members = useAppStore((s) => s.members);

  // + 등록 메뉴(리플레이/너 나와!/일정) — 버튼 아래 작은 팝오버로 연다.
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  // 키보드가 뜨면 등록 FAB을 숨긴다 — 이 버튼의 bottom이 '탭바 높이 위'인데 정작 탭바는
  // 키보드가 뜨면 숨어서, 버튼만 빈 자리에 남아 댓글 입력칸 위를 가린다.
  // 연출은 넣지 않는다: 한 번 opacity+translateY 트랜지션으로 숨겨봤더니 키보드가 오르내리는
  // 동안 값이 여러 번 갱신되며 버튼이 깜빡여 잔상처럼 보였다(지적: "탭바 숨길 때 고스트처럼
  // 나타나는 게 생겼다"). visibility만 끄면 합성 그룹도, 중간 프레임도 생기지 않는다.
  const fabHidden = useEditableFocused();
  useEffect(() => {
    // 버튼이 사라졌는데 메뉴만 공중에 남으면 안 된다.
    if (fabHidden) setAddMenuOpen(false);
  }, [fabHidden]);

  // 리플레이 등록 — 파일 선택 → 분석(buildReplayDrafts) → 깨끗한 건 바로 등록.
  //
  // 검토창을 모두 없앴다가(요청: "검토창이 너무 복잡해") 다시 문제 있는 건에만 되살렸다
  // (요청). 그냥 넣고 카드에 빨간 글씨만 남기는 방식은 '틀린 기록이 일단 들어간다'는 뜻이라,
  // 확인하러 다시 들어오지 않으면 그대로 통계에 섞인다. 사람 손이 실제로 필요한 세 가지
  // — 선수를 회원과 못 이었을 때, 승패를 못 가렸을 때, 2분이 안 되는 짧은 판일 때 —
  // 만 검토창으로 보내고, 나머지는 예전처럼 조용히 등록한다.
  const replayInputRef = useRef<HTMLInputElement>(null);
  const [parsingReplays, setParsingReplays] = useState(false);
  // 검토창에 올릴 드래프트 — 비어 있으면(null) 창을 안 연다.
  const [reviewDrafts, setReviewDrafts] = useState<ReplayDraft[] | null>(null);
  // 검토창이 닫힌 뒤에 띄울 안내(자동 등록분 결과) — 같은 배치에서 일부는 그냥 들어가고
  // 일부는 검토가 필요할 때, 두 소식이 겹쳐 뜨지 않게 순서를 미뤄 둔다.
  const pendingNoticeRef = useRef<{ text: string; kind: "success" | "error" } | null>(null);
  // 등록 결과 안내 — 인라인 토스트 대신 확인 버튼 있는 팝업으로 띄운다(지적: "저렇게
  // 토스트로 뜨지말고 내용과 확인버튼 있는 팝업으로"). 실패가 없으면 순수 안내, 하나라도
  // 있으면 확인이 필요하다는 뜻으로 제목만 다르게 단다 — 어느 쪽이든 사람이 "확인"을
  // 눌러야 닫힌다.
  const [replayNotice, setReplayNotice] = useState<{ text: string; kind: "success" | "error" } | null>(null);
  useLockBodyScroll(!!replayNotice);

  // 너 나와! 등록 폼.
  const [challengeFormOpen, setChallengeFormOpen] = useState(false);
  /* 일정 등록·수정 폼 — 창이 하나라 상태도 하나다. null이면 닫힘, "new"면 등록,
     일정이면 그것을 고치는 중이다(요청: 등록과 수정이 같은 모달). */
  const [scheduleForm, setScheduleForm] = useState<Schedule | "new" | null>(null);
  const setScheduleEditing = (s: Schedule) => setScheduleForm(s);

  const [error, setError] = useState("");

  // 카드의 카운트다운/마감 파생 상태를 1분마다 갱신한다.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  /* 활동 목록 — 화면이 부르는 API는 이것 하나다(요청: API 딱 하나만 호출하게).
     너 나와·랭크 변동·게임결과가 같은 아이템으로 오고, 내용도 댓글도 그 안에 있다.
     예전에는 세 곳(/challenges, /game-results, /activity/ranking-shifts)을 따로 받아
     여기서 섞고 번호는 또 /activity/list에서 받아 열쇠로 맞춰 얹었다 — 섞는 규칙이
     서버와 화면 양쪽에 있어야 했고, 한쪽만 고쳐지는 순간 번호가 줄과 어긋났다. */
  const fetchPage = useCallback(
    async (cursor: string | null): Promise<{
      items: ActivityFeedItem[]; nextCursor: string | null; hasMore: boolean; total: number;
    }> => {
      const page = await api.listActivityFeed({ cursor: cursor ?? undefined, limit: PAGE_SIZE });
      // 공용 무한스크롤 훅의 모양(hasMore)에 맞춘다 — 서버는 다음 커서만 준다.
      return { ...page, hasMore: page.nextCursor !== null, total: page.totalActivities };
    },
    [],
  );
  const {
    items: feedItems, loading: feedLoading, loadingMore, hasMore, loadMore, reload,
    patch: patchFeed,
  } = useCursorPagination(fetchPage, []);

  /* 받은 아이템을 종류별로 낱개로 펴서(challenges/gameResults/...) 아래 feed에서 한
     타임라인으로 합친다 — 유형별 덩어리(groupedSections)로 다시 나누는 것은 그 뒤 단계다. */
  const challenges = useMemo(
    () => feedItems.flatMap((it) => (it.challenge ? [it.challenge] : [])),
    [feedItems],
  );
  const gameResults = useMemo(() => feedItems.flatMap((it) => it.gameResults), [feedItems]);
  /* 랭크 변동은 이제 알림으로 실려 온다(요청: 표시만 통합) — 저장도 카드도 그대로라,
     받는 자리에서 스냅샷 모양으로 되돌려 예전 파이프라인에 그대로 흘린다. */
  const rankShifts = useMemo(
    () => feedItems.flatMap((it) => (
      it.notice && it.notice.kind === "rankingShift"
        ? [{
          id: it.notice.id,
          reason: it.notice.payload.reason ?? "daily",
          createdAt: it.notice.createdAt,
          matchIds: it.notice.payload.matchIds ?? [],
          sections: it.notice.payload.sections ?? [],
        } as RankingShift]
        : []
    )),
    [feedItems],
  );
  const leagueMatches = useMemo(
    () => feedItems.flatMap((it) => (it.leagueMatch ? [it.leagueMatch] : [])),
    [feedItems],
  );
  const schedules = useMemo(
    () => feedItems.flatMap((it) => (it.schedule ? [it.schedule] : [])),
    [feedItems],
  );
  /* 랭크 변동은 위에서 스냅샷으로 돌려 그리므로 여기서는 뺀다 — 안 그러면 같은 줄이
     알림 카드와 랭크 변동 카드로 두 번 선다. */
  const notices = useMemo(
    () => feedItems.flatMap((it) => (it.notice && it.notice.kind !== "rankingShift" ? [it.notice] : [])),
    [feedItems],
  );
  /* 댓글도 같은 응답에 실려 온다 — 카드마다 따로 부르면 답이 제각각 도착하며 카드 키가
     뒤늦게 자라, 들어올 때 "현재"에 맞춰 둔 자리가 그만큼 밀린다. 페이지를 이어 받을
     때마다 다시 담는다(표는 통째로 새로 만든다). */
  useEffect(() => {
    if (feedItems.length === 0) return;
    void primeActivityComments(feedItems.flatMap((it) => it.comments));
  }, [feedItems]);

  // 응답/결과입력 등 카드 액션의 결과를 목록에 반영한다 — 목록을 처음부터 다시 받지
  // 않는다(그러면 스크롤을 내려 둔 자리가 통째로 사라진다).
  const upsertChallenge = (updated: Challenge) => {
    patchFeed((prev) => {
      const hit = prev.some((it) => it.challenge?.id === updated.id);
      if (hit) {
        return prev.map((it) => (it.challenge?.id === updated.id ? { ...it, challenge: updated } : it));
      }
      // 새로 부른 호출은 맨 위에 세운다.
      return [{
        key: `c-${updated.id}`, kind: "challenge" as const,
        challenge: updated, gameResults: [], comments: [],
      }, ...prev];
    });
  };

  // 참가표시·수정처럼 카드에서 벌어진 일을 목록에 반영한다 — 너 나와의 upsertChallenge와
  // 같은 이유다(목록을 처음부터 다시 받으면 스크롤을 내려 둔 자리가 통째로 사라진다).
  const upsertSchedule = (updated: Schedule) => {
    patchFeed((prev) => {
      const hit = prev.some((it) => it.schedule?.id === updated.id);
      if (hit) {
        return prev.map((it) => (it.schedule?.id === updated.id ? { ...it, schedule: updated } : it));
      }
      return [{
        key: `sc-${updated.id}`, kind: "schedule" as const,
        schedule: updated, gameResults: [], comments: [],
      }, ...prev];
    });
  };

  // 무한스크롤 — 목록 끝 센티널이 보이면 다음 페이지를 불러온다(전체 일괄 로드 대신).
  const sentinelRef = useRef<HTMLDivElement>(null);

  /* 미니맵 격자도 목록과 함께 받아 둔다 — 댓글과 같은 이유다(위 primeActivityComments).
     카드가 뜬 뒤에 격자가 도착하면 미니맵이 그때 생겨나며 카드 키가 자라, 들어올 때
     맞춰 둔 자리가 밀린다. 첫 페이지 것만 미리 받으면 된다: 그 아래는 무한스크롤로
     내려가며 뜨는 것이라 이미 사용자가 스크롤을 쥔 뒤다. */
  const [mapsLoading, setMapsLoading] = useState(true);
  const didPrimeMapsRef = useRef(false);
  /* 이 화면이 아직 살아 있나 — 화면이 사라진 뒤의 setState만 막으면 되므로 ref로 둔다.
     예전에는 이펙트마다 새로 만드는 지역 변수(let alive)로 봤는데, 이 이펙트는 ref로
     한 번만 돌게 막아 놓은 자리라 그러면 안 된다: 프리페치가 끝나기 전에 gameResults가
     한 번만 바뀌어도(아래 무한스크롤이 한 페이지를 더 부르면 바뀐다) React가 앞선
     이펙트의 정리를 돌려 그 변수를 꺼 버리고, 새로 도는 이펙트는 ref 가드에 걸려 아무
     일도 안 한다 — 그래서 setMapsLoading(false)가 영영 안 불려 활동가 로딩에서
     멈췄다(지적: 가끔 활동 진입 시 무한로딩). */
  const aliveRef = useRef(true);
  // 다시 마운트되면 반드시 되살려 놔야 한다 — 정리에서 끄기만 하면 한 번 꺼진 뒤로는
  // 영영 꺼진 채다. StrictMode(개발)는 마운트→정리→마운트를 일부러 한 번 더 돌리므로
  // 이게 없으면 개발에서는 100% 로딩에서 멈춘다.
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);
  useEffect(() => {
    if (feedLoading || didPrimeMapsRef.current) return;
    didPrimeMapsRef.current = true;
    primeReplayMaps(gameResults.map((g) => g.mapHash))
      .catch(() => {}).finally(() => { if (aliveRef.current) setMapsLoading(false); });
  }, [feedLoading, gameResults]);

  const loading = feedLoading || mapsLoading;

  /* 무한스크롤 관측 — 목록이 실제로 그려진 뒤에만 건다. 이 판단은 경기 목록의 로딩
     (feedLoading)이 아니라 화면 전체의 loading이어야 한다(지적: 로딩바가 두 개 뜬다).
     경기 목록만 먼저 도착하고 댓글·격자 프리페치가 아직인 구간에서는 목록 자리에 스피너
     하나만 있어 화면이 짧으니, 맨 아래 센티널이 처음부터 보인다 — 그러면 사용자가 스크롤을
     하기도 전에 다음 페이지를 부르고, 스피너가 하나 더 붙어 두 개가 됐다. 딸려온 문제가 더
     크다: 그 바람에 gameResults가 바뀌면서 위 프리페치까지 어긋났다. */
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loading) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && hasMore && !feedLoading && !loadingMore) {
        loadMore();
      }
    }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, feedLoading, loadingMore, loadMore]);

  // 저장 완료 — 목록을 처음부터 다시 받는다. 랭크 변동도 같은 응답에 실려 오므로
  // 따로 갱신할 것이 없다(서버가 이미 저장·재집계를 끝냈다).
  const handleReplaysSaved = useCallback(async () => { reload(); }, [reload]);
  /* 게임결과 삭제 반영(handleGameResultDeleted)은 displayFeed가 만들어진 뒤에 정의한다
     (아래) — 펼쳐 둔 줄의 열쇠를 옮기려면 지금 화면이 어떻게 묶여 있는지를 봐야 한다. */

  const handleReplayFilesChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (picked.length === 0) return;
    // accept가 걸러 주긴 하지만 브라우저마다 지키는 정도가 달라 한 번 더 본다 — 리플레이가
    // 아닌 걸 파서에 넘기면 무슨 일이 났는지 모를 오류만 남는다.
    const chosen = picked.filter((f) => f.name.toLowerCase().endsWith(".rep"));
    if (chosen.length === 0) {
      setError("리플레이(.rep) 파일이 아니에요 — .rep 파일을 골라 주세요.");
      return;
    }
    const truncated = chosen.length > MAX_REPLAY_FILES;
    const batch = chosen.slice(0, MAX_REPLAY_FILES);
    setParsingReplays(true);
    setError("");
    try {
      const [drafts] = await Promise.all([
        buildReplayDrafts(batch, members),
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]);
      if (hasAppUpdatePreloadErrorOccurred()) return;

      /* 읽어 온 것은 중복만 빼고 전부 검토창으로 보낸다(요청: 검토 화면은 모두 중복인
         경우만 빼고는 정상만 있어도 나와야 한다). 예전에는 깨끗한 건 여기서 조용히
         등록하고 문제 있는 것만 검토창으로 보냈는데, 그러면 방금 무엇이 들어갔는지 사람이
         볼 방법이 없었다 — 배치등록(ReplayBatchButton)은 이미 같은 규칙으로 돈다.
         읽지 못한 것·팀을 못 나눈 것도 검토창이 실패/검토필요로 제 자리에 세워 준다
         (ReplayReviewModal의 reviewOf). 중복만은 사람이 할 일이 없어 건너뛰고 숫자로만
         알린다. */
      let duplicates = 0;
      const review: ReplayDraft[] = [];
      for (const raw of drafts) {
        if (raw.excludeReason === "duplicate") { duplicates += 1; continue; }
        review.push(raw);
      }

      const parts: string[] = [];
      if (truncated) parts.push(`한 번에 최대 ${MAX_REPLAY_FILES}개까지만 등록돼 처음 ${MAX_REPLAY_FILES}개만 처리했어요.`);
      if (duplicates > 0) parts.push(`${duplicates}개는 이미 등록된 경기라 건너뛰었어요.`);
      // 안내는 검토창을 닫은 뒤로 미룬다 — 먼저 띄우면 확인을 누른 뒤에야 검토창이 뜨는
      // 두 단계가 되고, 그 사이에 무슨 일이 남았는지가 흐려진다.
      const notice = parts.length > 0 ? { text: parts.join(" "), kind: "success" as const } : null;
      if (review.length > 0) {
        pendingNoticeRef.current = notice;
        setReviewDrafts(review);
      } else {
        setReplayNotice(notice ?? { text: "등록할 리플레이가 없어요.", kind: "error" as const });
      }
    } finally {
      setParsingReplays(false);
    }
  };

  // 너 나와!와 경기를 하나의 타임라인으로 — 최근 이벤트가 위.
  const feed = useMemo<ActivityItem[]>(() => {
    const items: ActivityItem[] = [
      /* 끝난 너 나와도 다 싣는다(요청: 거절/무응답거절/취소도 나오게) — 예전에는 아무도
         응답하지 않은 채 사라진 건을 통째로 뺐는데, 그러면 "불렀는데 아무도 안 왔다"와
         "부른 사람이 거둬들였다"가 둘 다 없던 일이 된다. 그 둘은 카드에서 각각 만료·취소로
         구분해 보여준다. */
      ...challenges.map(challengeItem),
      ...gameResults.map(gameResultItem),
      ...rankShifts.map(rankShiftItem),
      ...leagueMatches.map(leagueMatchItem),
      ...schedules.map(scheduleItem),
      ...notices.map(noticeItem),
    ];
    // 정렬 기준은 time이 아니라 sortTime이다 — 너 나와만 표시용 시각과 꽂히는 자리가
    // 다르다(위 challengeSortMs). 나머지는 sortTime이 없어 time을 그대로 쓴다.
    return items.sort((a, b) => sortMsOf(b) - sortMsOf(a));
  }, [challenges, gameResults, rankShifts, leagueMatches, schedules, notices]);

  /* 해시 → 상세(요청: 앞으로가기·딥링크) — #game-12 같은 해시로 서 있는데 상세가 닫혀
     있으면 그 항목을 찾아 연다. 닫기는 ModalHash(뒤로가기)가 맡으므로 여기선 열기만 한다.
     다른 모달의 해시(member-…)는 feed에 없어 자연히 무시된다. */
  const detailRef = useRef<DisplayItem | null>(null);
  detailRef.current = detailItem;
  useEffect(() => {
    const tryOpen = () => {
      if (detailRef.current) return;
      const h = decodeURIComponent(window.location.hash.slice(1));
      if (!h) return;
      const hit = feed.find((it) => detailHashOf(it) === h);
      if (hit) setDetailItem(hit);
    };
    tryOpen();
    window.addEventListener("popstate", tryOpen);
    return () => window.removeEventListener("popstate", tryOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed]);

  /* 예전에는 여기서 "이미 불러온 가장 오래된 경기보다 과거인 너나와·변동"을 보류했다 —
     경기만 페이지로 나눠 받고 나머지는 통째로 받았기에, 아직 안 받은 경기 자리에 옛
     너나와가 먼저 내려와 시간순이 뒤섞여 보였기 때문이다. 이제 셋을 한 목록으로 함께
     나눠 받으므로 받은 것은 늘 위에서부터 이어져 있고, 보류할 것이 없다. 오히려 남겨
     두면 문제가 된다: 너 나와는 표시 시각과 꽂히는 자리가 달라(challengeSortMs) 제대로
     실려 온 카드가 그 잣대에 걸려 사라질 수 있다. */
  /** 이 줄에 붙일 딱지 — NEW_WINDOW_MS(12시간) 안에 올라온 것은 NEW, 올라온 지는
   *  지났는데 그 안에 달라진 것은 UPDATE, 그 밖은 없음(요청).
   *
   *  둘을 가르는 이유는 너 나와다 — 사흘 전에 부른 호출에 방금 답이 오면 그건 새것이
   *  아니라 달라진 것인데, NEW 하나로는 그 둘이 구별되지 않는다. 응답·일시 수정·결과
   *  입력·취소가 모두 updatedAt을 갱신하므로 그 값 하나로 답이 된다.
   *
   *  '언제'를 종류마다 아는 만큼만 쓴다. 너 나와는 등록/수정 시각이 다 있고, 랭크 변동은
   *  하루치 스냅샷이라 만들어진 뒤 바뀌지 않아 NEW만 있다. 게임결과에는 등록 시각 자체가
   *  없어(GameResult에 createdAt이 없다) 경기 시각으로 대신한다 — 대개 친 날 바로
   *  올리므로 거의 같지만, 한참 지난 경기를 오늘 올리면 그 건에는 아무 딱지도 안 붙는다.
   *  앞으로의 일(예정된 너 나와)은 새것이 아니라 아직 안 온 것이라 제외한다. */
  /* 미리보기의 정렬 열쇠(요청: 가장 최근에 NEW나 UPDATE가 발생한 순) — 위 rowFlagsOf가
     딱지를 매기는 그 시각들 중 가장 늦은 것이다. 종류마다 아는 만큼만 쓰는 것도 같다. */
  const touchMsOf = (it: DisplayItem): number => {
    if (it.kind === "challenge") {
      return Math.max(serverMs(it.challenge.createdAt), serverMs(it.challenge.updatedAt));
    }
    if (it.kind === "leagueMatch") {
      return Math.max(serverMs(it.match.postedAt), serverMs(it.match.updatedAt));
    }
    if (it.kind === "schedule") {
      return Math.max(serverMs(it.schedule.createdAt), serverMs(it.schedule.updatedAt));
    }
    if (it.kind === "rankingShift") return serverMs(it.shift.createdAt);
    if (it.kind === "gameResultPost") return Math.max(...it.items.map((x) => x.time));
    return it.time;
  };

  const rowFlagsOf = (it: DisplayItem): ("new" | "update")[] => {
    const now = Date.now();
    const fresh = (ms: number) => now - ms >= 0 && now - ms <= NEW_WINDOW_MS;
    if (it.kind === "challenge") {
      const created = serverMs(it.challenge.createdAt);
      const updated = serverMs(it.challenge.updatedAt);
      const flags: ("new" | "update")[] = [];
      if (fresh(created)) flags.push("new");
      // 손댄 적이 있어야 UPDATE다 — 등록하는 순간엔 두 시각이 같게 찍혀서, 그냥 비교하면
      // 새로 올라온 줄마다 NEW와 UPDATE가 나란히 붙는다. 같은 트랜잭션 안에서도 초 단위
      // 아래로는 어긋날 수 있어 몇 초의 여유를 둔다.
      if (updated - created > TOUCHED_SLACK_MS && fresh(updated)) flags.push("update");
      return flags;
    }
    if (it.kind === "leagueMatch") {
      /* 일정 등록이 NEW, 그 뒤의 일정 수정·결과 입력이 UPDATE다(요청) — 너 나와와 같은
         규칙이라 판정도 같다. 서버가 두 시각을 따로 내려주므로(postedAt·updatedAt) 여기서는
         비교만 한다: 등록하는 순간엔 둘이 같게 찍혀 몇 초의 여유를 둔다. */
      const posted = serverMs(it.match.postedAt);
      const updated = serverMs(it.match.updatedAt);
      const flags: ("new" | "update")[] = [];
      if (fresh(posted)) flags.push("new");
      if (updated - posted > TOUCHED_SLACK_MS && fresh(updated)) flags.push("update");
      return flags;
    }
    if (it.kind === "schedule") {
      // 너 나와·리그와 같은 규칙 — 올린 때가 NEW, 그 뒤에 고친 때가 UPDATE다.
      const created = serverMs(it.schedule.createdAt);
      const updated = serverMs(it.schedule.updatedAt);
      const flags: ("new" | "update")[] = [];
      if (fresh(created)) flags.push("new");
      if (updated - created > TOUCHED_SLACK_MS && fresh(updated)) flags.push("update");
      return flags;
    }
    if (it.kind === "rankingShift") return fresh(serverMs(it.shift.createdAt)) ? ["new"] : [];
    if (it.kind === "gameResultPost") return it.items.some((x) => fresh(x.time)) ? ["new"] : [];
    return fresh(it.time) ? ["new"] : [];
  };

  /* (삭제) 줄에 달린 댓글 수 — 걷었다(요청). 댓글이 몇 개인지는 카드를 펴면 댓글
     자리가 직접 말하고, 목록 줄에서는 그 수가 무슨 일이 있었는지보다 먼저 읽혔다. */

  /* 목록은 경기를 안 묶는다(요청: "활동에서 경기 묶음 컨셉 제거하고 한 경기 한 경기 다
     별도 목록으로 보여주기"). 예전에는 한 자리에서 이어 친 판들을 하루 단위로 한 줄에
     모아 "누가 있었나 · N경기"로 적었는데, 그러면 목록에서 읽을 수 있는 것이 '그날 누가
     모였나'뿐이라 정작 각 판이 누구 대 누구였는지는 줄을 펴야만 알 수 있었다. 다른 갈래
     (너 나와·리그·일정)는 모두 한 건이 한 줄인데 게임만 규칙이 달랐다는 점도 있다.

     묶음 자체(GameResultPost)는 지운 게 아니라 공유 화면(SharePage)이 계속 쓴다 — 거기서는
     '그날 한 자리'를 통째로 보여주는 것이 그 화면의 용건이다. */
  const displayFeed = feed;

  /* 다섯 덩어리로 나눠 늘어놓는다(요청: "유형별 목록으로 구분하는데 각 덩어리별로 중
     타이틀 달고 그 옆에 전체 보기 버튼 추가, 묶음 구분되게 사이 갭 충분히 주기").
     feed가 이미 최신순으로 정렬돼 있으므로(위 sortMsOf) 덩어리 안에서도 그 순서가 그대로
     이어진다 — 따로 다시 정렬할 필요가 없다.

     덩어리의 차례는 고정이 아니다(요청: "new나 업데이트가 있는 목록이 맨 위로") — NEW·
     UPDATE 딱지가 붙은 것이 하나라도 있는 덩어리를 앞세우고, 그런 덩어리끼리는 가장 최근
     딱지를 기준으로 다시 줄 세운다. 아무 딱지도 없는 덩어리들은 원래 차례(GROUP_DEFS,
     알림→일정→리그→너 나와!→게임)를 그대로 지킨다 — 매번 뒤섞이면 눈에 익은 자리를
     잃는다. */
  const groupedSections = useMemo(() => {
    const buckets = new Map<ActivityGroupKey, ActivityItem[]>();
    for (const g of GROUP_DEFS) buckets.set(g.key, []);
    for (const item of feed) buckets.get(groupKeyOf(item))!.push(item);
    const withFlags = GROUP_DEFS
      .map((g, order) => {
        const items = buckets.get(g.key)!;
        let freshAt = 0;
        for (const it of items) { if (rowFlagsOf(it).length > 0) freshAt = Math.max(freshAt, it.time); }
        return { ...g, order, items, freshAt };
      })
      .filter((s) => s.items.length > 0);
    withFlags.sort((a, b) => {
      if ((a.freshAt > 0) !== (b.freshAt > 0)) return a.freshAt > 0 ? -1 : 1;
      if (a.freshAt !== b.freshAt) return b.freshAt - a.freshAt;
      return a.order - b.order;
    });
    return withFlags;
  }, [feed]);

  /* 지운 경기 한 판만 목록에서 빼낸다(요청: 새로고침 말고 그 부분만 사라지게) — 예전에는
     통째로 다시 받아서, 스크롤을 내려 둔 자리가 사라지고 펼쳐 둔 카드도 다 접혔다.
     한 줄이 여러 판을 묶고 있을 수 있으므로 그 줄에서 그 판만 빼고, 그래서 줄이 텅 비면
     줄째로 뺀다. 호출·랭크 변동을 품은 줄은 남긴다. API가 성공한 뒤에만 불린다. */
  const handleGameResultDeleted = useCallback((id: number) => {
    /* 보고 있던 상세 팝업이 그 경기였으면 닫는다 — 지운 판의 카드를 계속 띄워 둘 수는 없다.
       예전에는 '펼쳐 둔 줄의 열쇠를 따라 옮기는' 보정이 여기 있었는데(묶음 줄의 열쇠가 첫
       판 id라 그 판을 지우면 열쇠가 바뀌어 줄이 통째로 접혔다), 상세가 팝업이 되면서 열쇠가
       아니라 항목 자체를 들고 있게 돼 그 문제가 사라졌다. */
    setDetailItem((it) => (it && it.kind === "gameResult" && it.gameResult.id === id ? null : it));
    patchFeed((prev) => prev
      .map((it) => (it.gameResults.some((g) => g.id === id)
        ? { ...it, gameResults: it.gameResults.filter((g) => g.id !== id) }
        : it))
      .filter((it) => !!it.challenge || !!it.notice || it.gameResults.length > 0));
  }, [patchFeed, displayFeed]);

  const dateLabelOf = (item: { time: number }) => {
    const d = new Date(item.time);
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  };

  // "현재"(now) 경계 = 미래(위)와 오늘/과거(아래)가 갈리는 지점 = 위에서부터 첫 "오늘
  // 이하" 아이템. 그 위에 미래 아이템이 있을 때만(idx>0) 카드 사이에 "현재" 구분선을
  // 넣는다(요청). 활동에 들어오면 이 지점이 화면 가운데 오도록 스크롤한다(요청) — 위로는
  // 앞으로 있을 일, 아래로는 이미 벌어진 일이라 그 경계가 곧 "지금 어디쯤인가"다.


  /* (삭제) 진입할 때 "현재" 구분선으로 한 번 스크롤하던 처리 — 없앴다(요청: 활동 진입시
     스크롤 제거). 활동는 최신순이라 맨 위가 곧 가장 새 소식인데, 열자마자 화면이 아래로
     한 번 뛰면 그 사이에 새로 올라온 것을 지나쳐 버린다. "현재" 구분선과 오른쪽 타임라인의
     눈금은 그대로라, 지금 자리로 가고 싶으면 그 눈금을 짚으면 된다. */

  /* 목록 한 줄의 '내용' 칸(요청) — 종류마다 한 줄로 줄이면 무엇이 남나.
       · 너 나와  — 누가 누구를 불렀나(이름뿐이다 — 상태는 위 rowStatusOf가 맡는다).
       · 게임결과 — 몇 사람이 몇 판을 쳤나.
       · 랭크변동 — 몇 사람의 순위가 움직였나(개인전·팀전에 다 오른 사람은 한 번만 센다). */
  /** 내용 칸 맨 왼쪽의 상태 알약 — 너 나와만 값이 있고 나머지(게임결과·랭크 변동)는
   *  비운다. 비어도 자리는 CSS가 늘 예약하므로(.scr-activity-row-status-slot) 줄 종류가
   *  섞여도 닉네임이 시작하는 x가 흔들리지 않는다(지적: "너나와 말고는 배지가 없잖아"). */
  /** 이 줄이 '없던 일'인가 — 위 ROW_VOID 참고. */
  const rowVoid = (item: DisplayItem): boolean => (
    item.kind === "challenge" && ROW_VOID.has(challengeStatusInfo(item.challenge).text)
  );

  const rowStatusOf = (item: DisplayItem) => {
    /* 리그도 같은 자리에 상태를 단다(요청) — 아직 안 붙은 경기(Ready)와 결과까지 들어온
       경기(Finish). 너 나와의 '완료'와 같은 뜻이라 Finish도 같은 방식으로 눌러 둔다.
       가르는 잣대는 점수다: 승자만 정해진 부전승은 점수가 안 적히므로 Ready로 남는데,
       그건 맞다 — 그 경기는 실제로 치러지지 않았다. */
    if (item.kind === "leagueMatch") {
      const done = item.match.setsWonA !== null && item.match.setsWonB !== null;
      return (
        <span className={cx("scr-activity-row-status", done && "scr-activity-row-status-faded")}>
          {done ? "Finish" : "Ready"}
        </span>
      );
    }
    if (item.kind !== "challenge") return null;
    const s = challengeStatusInfo(item.challenge);
    // 이 알약은 두 글자 자리다 — "대기중"만 셋이라 여기서 줄인다(요청의 낱말도 "대기").
    const text = s.text === "대기중" ? "대기" : s.text;
    return (
      <span className={cx("scr-activity-row-status", STATUS_FADED.has(text) && "scr-activity-row-status-faded")}>
        {text}
      </span>
    );
  };

  /** 그 편에 나온 사람들 — 이름은 자르지 않는다(요청: "닉네임 풀로 표시"). 길이는
   *  자르기가 아니라 눌러서 맞춘다(위 FlatLine).
   *
   *  BEST PLAYER인 사람 닉네임에는 작은 배지를 붙인다(요청) — 줄만 보고도 그 판의 주인공을
   *  알 수 있게. 누가 BEST인지는 원본 게임 아이디로 가른다(요약이 그 값을 들고 있고,
   *  닉네임은 같은 것이 둘일 수 있다). */
  /** 한 편을 한 줄에 늘어놓는다(요청: 다시 한 줄 + 스퀴징으로 복구).
   *
   *  줄을 나누거나 칸 격자로 세워 보기도 했는데, 둘 다 줄 하나가 두세 줄이 되면서 목록의
   *  줄 높이가 갈래마다 달라졌다. 한 줄로 돌리면 길이는 다시 문제가 되지만, 그 답은 이미
   *  있다 — 글자 크기는 그대로 두고 가로로만 눌러 맞추는 FlatLine이다.
   *  팀원 사이는 빗금 하나로 가른다(요청) — 이름과 같은 색으로 두면 그것도 글자처럼
   *  읽히므로 연하게, 좌우 사이도 좁혀 [이름/이름]이 한 덩어리로 보이게 한다. */
  /* 제목에 적는 이름 길이(요청: 한글 넉 자·영문 여덟 자까지는 그대로, 그보다 길면 여섯 칸
     (한글 석 자)까지만 적고 말줄임표).
     한 판은 최대 여덟 명이라 긴 닉네임 하나가 줄 전체의 눌림(FlatLine)을 정한다 — 이름
     한둘이 길다는 이유로 여덟 사람의 글자가 다 같이 납작해진다.
     길이를 글자 수가 아니라 '칸'으로 세는 것이 요청의 핵심이다: 한글은 영문의 두 배 폭이라
     같은 넉 자라도 "브래드왕"과 "Brad"는 자리를 두 배로 다르게 먹는다. 한글·한자·이모지를
     두 칸, 나머지를 한 칸으로 세면 두 이름이 같은 잣대 위에 선다.
     자를 때 코드포인트로 훑는 건 이모지가 든 닉네임을 반 토막 내지 않기 위해서다. */
  /* 한글과 영문에 다른 한도를 준다(요청: 한글 6·영문 8까지 그대로, 넘치면 한글 5·영문 7).
     칸으로 환산하면 한글 6 = 12칸, 영문 8 = 8칸이라 한도가 서로 다르다 — 한글이 두 배
     넓다고 해서 같은 칸 수로 자르면 넉 자밖에 못 적는데, 한글 이름은 넉 자로 자르면 누구인지
     알아보기 어렵다(영문은 여덟 자면 대개 다 읽힌다).
     이름에 넓은 글자가 하나라도 있으면 한글 잣대로 본다 — 섞인 이름("한글Ab")도 한글
     이름처럼 읽히고, 실제로 차지하는 자리도 그쪽에 가깝다. */
  /* 자르는 길이(요청: 한글 2자 / 영문 4자) — 한 줄에 여덟 이름이 서는 자리라, 이름 하나가
     읽히기만 하면 된다. 한글이 영문보다 적은 것은 한 글자가 두 배 넓기 때문이다: 칸(units)으로
     세면 둘 다 4칸으로 같은 폭이다.
     "얼마까지는 그냥 두고 넘치면 몇 자로"라는 두 값 짝(keep/clip)은 걷었다 — 기준이 하나면
     모든 이름이 같은 길이로 서서 줄이 격자처럼 읽힌다. */
  const TITLE_UNITS_WIDE = 4;   // 한글 2자
  const TITLE_UNITS_NARROW = 4; // 영문 4자
  /** 한 글자가 먹는 칸 — 넓은 글자(한글·한자·가나·전각·이모지)는 둘, 나머지는 하나. */
  const charUnits = (ch: string): number => (
    /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꥠ-꥿가-힣豈-﫿︰-﹯＀-｠￠-￦]/u.test(ch)
    || ch.codePointAt(0)! > 0xFFFF ? 2 : 1
  );
  const clipName = (name: string): string => {
    /* PC에서는 자르지 않는다(요청) — 자르는 까닭은 한 줄에 여덟 이름이 서는 좁은 폭 때문인데,
       기둥이 서는 넓은 화면에서는 그 줄에 여유가 있어 이름을 온전히 적을 수 있다. */
    if (!isMobile) return name;
    const chars = Array.from(name);
    const wide = chars.some((c) => charUnits(c) === 2);
    const limit = wide ? TITLE_UNITS_WIDE : TITLE_UNITS_NARROW;
    let used = 0;
    const kept: string[] = [];
    for (const c of chars) {
      const w = charUnits(c);
      if (used + w > limit) break;
      kept.push(c); used += w;
    }
    /* 말줄임표는 안 붙인다(요청) — 점 셋도 한 글자 자리를 먹는데, 여덟이 늘어선 줄에서
       그 자리는 이름 한 글자를 더 보여 주는 데 쓰는 편이 낫다. 잘렸다는 것은 줄 전체가
       같은 길이로 서 있는 모양에서 이미 드러난다. */
    return kept.join("");
  };
  const sideNodes = (slots: GameResultSlot[], bestRaw: string | undefined): ReactNode[] =>
    slots.flatMap((s, i) => [
      ...(i > 0 ? [<span className="scr-activity-row-slash" key={`s${i}`} aria-hidden>/</span>] : []),
      /* BEST PLAYER는 배지 대신 닉네임 자체를 백금 메탈로 적는다(요청) — 여덟 이름이 한
         줄에 눌려 서는 자리라, 배지는 그 줄에서 유일하게 '이름이 아닌 것'이 되어 눈이 먼저
         거기 걸렸다. 이름 색만 달라지면 줄의 생김새는 그대로면서 누가 뽑혔는지는 그대로
         보인다. 자리도 안 먹으므로 눌리는 비율(FlatLine)도 안 건드린다. */
      <span
        className={cx("scr-activity-row-em", !!bestRaw && s.rawName === bestRaw && "scr-activity-row-em-best")}
        key={`n${i}`}
        title={!!bestRaw && s.rawName === bestRaw ? "BEST PLAYER" : undefined}
      >
        {/* 이름 규칙은 그 편 전체를 봐야 정해진다(컴퓨터 슬롯 번호 매기기) — 자르는 건
            그렇게 정해진 이름을 적을 때다. */}
        {clipName(resolveSlotName(s, slots, memberOf))}
      </span>,
    ]);

  const rowDesc = (item: DisplayItem) => {
    if (item.kind === "challenge") {
      const c = item.challenge;
      const mine = [c.createdBy.nickname, ...c.ownMembers.map((m) => m.nickname)];
      const theirs = c.targets.map((t) => t.nickname);
      /* 내용 칸의 배지는 전부 걷었다(요청) — 승/무/패도, 닉네임 옆에 붙던 상태도 없다.
         닉네임 사이사이에 색 조각이 끼면 정작 읽어야 할 이름이 그만큼 밀리고, 어느 쪽
         사람의 것인지도 줄마다 달라 눈이 한 번씩 멈췄다. 상태는 칸 맨 왼쪽의 제 자리
         (아래 rowStatusOf)로 옮겼다. */
      return (
        <>
          <span className="scr-activity-row-name">
            <span className="scr-activity-row-name-main">{nameNodes(mine)}</span>
          </span>
          <span className="scr-activity-row-arrow" aria-hidden>→</span>
          <span className="scr-activity-row-name">
            <span className="scr-activity-row-name-main">{nameNodes(theirs)}</span>
          </span>
        </>
      );
    }
    if (item.kind === "leagueMatch") {
      /* 리그 경기 한 줄 — 너 나와와 같은 "A → B" 꼴로 두 팀을 세운다. 앞에는 어느
         리그의 몇 강인지, 뒤에는 결과가 있으면 점수까지. */
      /* 라운드 이름("8강")은 줄에 안 적는다 — 좁은 화면에서 재어 보니 배지·두 팀·점수까지
         한 줄에 다 넣으면 이름이 잘리고 화살표가 밀려 사라졌다(실측 390px). 어느 리그의
         몇 강인지는 줄을 펴면 카드 머리가 "여름 리그 8강"으로 말한다. */
      const m = item.match;
      /* 줄에서는 두 편을 콜론으로 가른다(요청) — 너 나와의 화살표는 "누가 누구를 불렀나"라
         방향이 있지만, 리그 대진은 이미 짜인 자리라 방향이 없다. */
      /* 팀전이면 이름을 다 늘어놓지 않고 "A팀"으로 부른다(요청: 팀이면 a팀:b팀으로) —
         네 명씩 붙는 판에서 여덟 명을 한 줄에 적으면 어차피 다 잘린다. 누가 나오는지는
         줄을 펴면 카드의 로스터가 세로로 다 보여준다. 혼자면 그 사람 이름이 곧 팀 이름이다. */
      const sideText = (t: typeof m.teamA) => (
        t === null ? "미정"
          : t.members.length === 1 ? t.members[0].nickname
            : t.members.length > 1 ? `${t.label}팀`
              : t.label
      );
      /* 점수는 줄에 안 적는다 — 상태 알약(Ready·Finish)이 생기면서 줄이 꽉 찼고, 실측하니
         (390px) 두 팀 이름이 줄어들다 못해 서로 겹쳐 그려졌다. 알약이 이미 "붙었나"를
         말하므로 몇 대 몇인지는 줄을 펴면 카드가 말한다. */
      return (
        <>
          <span className="scr-activity-row-name scr-activity-row-name-clip">
            <span className="scr-activity-row-name-main">{sideText(m.teamA)}</span>
          </span>
          <span className="scr-activity-row-arrow scr-activity-row-colon" aria-hidden>:</span>
          <span className="scr-activity-row-name scr-activity-row-name-clip">
            <span className="scr-activity-row-name-main">{sideText(m.teamB)}</span>
          </span>
        </>
      );
    }
    if (item.kind === "schedule") {
      /* 일정 줄은 제목 하나다 — 그게 이 줄이 무엇에 대한 것인지의 전부다. 참가 인원을
         함께 적어 볼까 했는데, 좁은 화면에서 재어 보니 제목이 그만큼 잘렸다: 몇 명이
         손들었는지는 줄을 펴면 프사가 곧바로 말한다. */
      return (
        <span className="scr-activity-row-names scr-activity-row-name-clip">
          <span className="scr-activity-row-em">{item.schedule.title}</span>
        </span>
      );
    }
    if (item.kind === "notice") {
      return (
        <span className="scr-activity-row-names">
          {noticeLine(item.notice, (id) => memberOf(id)?.nickname ?? id)}
        </span>
      );
    }
    if (item.kind === "rankingShift") {
      // 같은 사람이 개인전·팀전에 다 올랐으면 한 번만 부른다.
      const names: string[] = [];
      const seen = new Set<string>();
      for (const sec of item.shift.sections) {
        for (const e of sec.shifts) {
          if (seen.has(e.memberId)) continue;
          seen.add(e.memberId); names.push(e.nickname);
        }
      }
      return <span className="scr-activity-row-names">{namesWithRest(names)}{" 변동"}</span>;
    }
    if (item.kind === "gameResultPost") {
      // 묶음은 이제 목록에 안 뜬다(위 displayFeed) — 공유 화면 전용이라 여기 올 일이 없다.
      return (
        <span className="scr-activity-row-names">
          {namesWithRest(playersOf(item.items, memberOf))}
          <span className="scr-activity-row-sep">·</span>
          <span className="scr-activity-row-em">{item.items.length}</span>{"경기"}
        </span>
      );
    }
    /* 경기 한 판 — 누가 누구와 붙었나(요청):
         브래드 · 조조 · 개포동불 · 홍빵(최  vs  정구 · 군범 · Rex · 미친마법

       한때 팀전을 "대표팀 4명"으로 줄여 봤는데, 그러면 목록에서 누가 낀 판인지가 대표 한
       사람으로 뭉개져 정작 찾던 사람이 안 보였다. 여덟을 다 부르되 이름을 넉 자로 자르고
       (shortName) 좁은 화면에서는 글자 자체를 좁힌다(CSS의 .scr-activity-row-name-game) —
       길이는 줄이는 방향이 두 가지인데, 사람을 지우는 쪽보다 글자를 줄이는 쪽이 낫다. */
    const g = item.gameResult;
    return (
      <FlatLine>
        {/* 편 색은 걷었다(요청) — 한동안 1팀 파랑·2팀 붉음으로 칠했는데, 어디까지가 한
            편인지는 가운데 vs와 그 안의 빗금이 말한다. 색까지 얹으면 줄마다 있는 유형
            배지와 한 줄 안에서 서로 다툰다. */}
        {/* 두 편이 한 줄에 서고, 넘치는 만큼은 FlatLine이 가로로 눌러 맞춘다(요청). */}
        <span className="scr-activity-row-name">
          <span className="scr-activity-row-name-main">{sideNodes(g.team1, bestRawOf(g.summaryData))}</span>
        </span>
        {/* vs 양옆에 그 편의 결과를 동그란 배지로(요청) — 이름만 늘어선 줄에서는 누가 이겼는지가
            펼쳐 봐야 나왔다. 무승부는 양쪽 다 '무'이고, 미실시는 아무 표시도 안 한다(치르지
            않은 판이라 승패 자체가 없다). 배지 색은 유형 배지들과 같은 규칙이다: 바탕을 꽉
            채우고 글자는 먹색 하나(--kind-ink) — 색은 갈래만 말하고 뜻은 글자가 진다. */}
        <span className="scr-activity-row-arrow scr-activity-row-vs" aria-hidden>
          <OutcomeDot result={g.result} side="team1" />
          vs
          <OutcomeDot result={g.result} side="team2" />
        </span>
        <span className="scr-activity-row-name">
          <span className="scr-activity-row-name-main">{sideNodes(g.team2, bestRawOf(g.summaryData))}</span>
        </span>
      </FlatLine>
    );
  };

  /* 줄을 펼쳤을 때 그 아래에 들어가는 카드 한 장.
     너 나와·랭크 변동은 카드 머리를 감춘다(scr-activity-card-head-off) — 바로 위 줄이 이미
     같은 제목·시각을 말한다. 게임결과 묶음은 감추지 않는다: 그 안의 머리들은 줄이 한 번도
     말한 적 없는 경기별 시각·등록자와 삭제 메뉴를 쥐고 있다(지적: 목록에서 시각·등록자가
     사라지고 삭제 불가). 경기가 한 판뿐인 묶음도 마찬가지라, 카드가 몇 장인지로는 가를 수
     없어서 어느 쪽인지를 여기서 표시한다. */
  const renderCard = (item: DisplayItem) => (
    item.kind === "schedule" ? (
      <div
        className="scr-activity-card-stack-wrapper scr-activity-card-head-off"
        key={`sc-${item.schedule.id}`}
      >
        <ScheduleCard
          schedule={item.schedule}
          timeText={formatWhen(item.time, { clock: item.withClock })}
          dateLabel={dateLabelOf(item)}
          myId={user?.id}
          // 올린 사람 또는 운영자만 — 서버도 같은 잣대로 한 번 더 막는다.
          canEdit={!!user && (item.schedule.createdBy.id === user.id || isAdmin)}
          onEdit={() => setScheduleEditing(item.schedule)}
          onChanged={upsertSchedule}
          onDeleted={(id) => patchFeed((prev) => prev.filter((it) => it.schedule?.id !== id))}
          footer={<ActivityCardComments targetType="schedule" targetId={item.schedule.id} />}
        />
      </div>
    ) : item.kind === "leagueMatch" ? (
      <div
        className="scr-activity-card-stack-wrapper scr-activity-card-head-off"
        key={`lm-${item.match.id}`}
      >
        <LeagueMatchCard
          match={item.match}
          timeText={formatWhen(item.time, { clock: item.withClock })}
          dateLabel={dateLabelOf(item)}
          footer={<ActivityCardComments targetType="leagueMatch" targetId={item.match.id} />}
        />
      </div>
    ) : item.kind === "notice" ? (
      <div
        className="scr-activity-card-stack-wrapper scr-activity-card-head-off"
        key={`nt-${item.notice.id}`}
      >
        <NoticeCard
          notice={item.notice}
          timeText={formatWhen(item.time, { clock: item.withClock })}
          dateLabel={dateLabelOf(item)}
          memberOf={memberOf}
          /* 알림도 공유한다(요청) — 케밥 하나에 카카오 공유만 들어 있다. */
          actions={<NoticeMenu notice={item.notice} nameOf={(id) => memberOf(id)?.nickname ?? id} />}
          footer={<ActivityCardComments targetType="notice" targetId={item.notice.id} />}
        />
      </div>
    ) : item.kind === "rankingShift" ? (
      <div
        className="scr-activity-card-stack-wrapper scr-activity-card-head-off"
        key={`rs-${item.shift.id}`}
      >
        <RankingShiftCard
          shift={item.shift}
          timeText={formatWhen(item.time, { clock: item.withClock })}
          dateLabel={dateLabelOf(item)}
          actions={<RankingShiftMenu shift={item.shift} />}
          /* 순위변동 알림에도 댓글(요청) — 경기/너나와 카드와 같은 공통 댓글 영역.
             그 위에 있던 "실시간 랭크 확인" 링크는 걷어냈다(요청). */
          /* 하루에 스냅샷 한 건이라 댓글 실도 자연히 하나다(요청: 한 로우). */
          footer={<ActivityCardComments targetType="rankingShift" targetId={item.shift.id} />}
        />
      </div>
    ) : item.kind === "challenge" ? (
      <div
        className="scr-activity-card-stack-wrapper scr-activity-card-head-off"
        key={`c-${item.challenge.id}`}
      >
        <ActivityCard
          /* 미실시로 끝난 건은 흐리게(요청) — 치르지 않은 판이라 목록에서 다른 건들과 같은
             무게로 서 있으면 "이 자리가 있었다"로 읽힌다. 지우지는 않는다: 불렀다는 사실은
             남아야 하고, 실제로는 치렀는데 미실시로 적힌 건을 되돌릴 자리도 필요하다. */
          className={item.challenge.resultWinnerSide === "not_held" ? "scr-activity-card-void" : undefined}
          dateLabel={item.undated ? "미정" : dateLabelOf(item)}
          // 너 나와!는 "호출"이니 수화기 아이콘으로(요청) — 등록 메뉴·호출 버튼과 통일.
          icon={<Phone size={16} aria-hidden />}
          label="너 나와!"
          // 날짜를 아직 안 정한 건 적을 시각이 없다 — 등록한 때를 적으면 그게 약속한
          // 날인 것처럼 읽힌다(요청: 타임스탬프는 미정으로).
          timeText={item.undated ? "미정" : formatWhen(item.time, { clock: item.withClock })}
          // 시각·마감·일시수정은 전부 '언제'에 대한 것이라 제목 바로 옆에 함께 둔다(요청).
          headMeta={<>
            {/* 일시(시간) 수정 — 시각은 헤더가 이미 보여주므로 연필만 얹는다(중복 표기
                제거, 요청). 참가자만 연필이 보인다(컴포넌트가 판정). */}
            <ChallengeTimeHeadEdit
              challenge={item.challenge}
              timeLabel={null}
              myId={user?.id}
              onUpdated={upsertChallenge}
            />
          </>}
          actions={
            <ChallengeActionsMenu
              challenge={item.challenge}
              isAdmin={isAdmin}
              myId={user?.id ?? ""}
              onDeleted={(id) => patchFeed((prev) => prev.filter((it) => it.challenge?.id !== id))}
              onChanged={upsertChallenge}
            />
          }
          comment={<ActivityCardComments targetType="challenge" targetId={item.challenge.id} />}
          bodyClassName={item.challenge.backdropUrl ? "scr-activity-card-body-photo" : undefined}
        >
          {/* 편지지 배경 사진을 올린 호출이면 카드 본문에도 같은 사진이 깔린다(요청).
              비율은 그대로 두고 잘라 채우며(cover), 본문의 패딩 안쪽에만 앉는다(요청:
              "바디의 패딩까지 채우진 않고 그 안쪽으로만"). */}
          {item.challenge.backdropUrl && (
            <div
              className="scr-activity-card-photo" aria-hidden="true"
              style={{ "--card-photo": `url("${item.challenge.backdropUrl}")` } as CSSProperties}
            />
          )}
          <ChallengeCard
            challenge={item.challenge}
            myId={user?.id}
            onResponded={upsertChallenge}
          />
        </ActivityCard>
      </div>
    ) : item.kind === "gameResultPost" ? (
      // GameResultPost는 접힘/펼침에 따라 카드가 1~N개로 늘어나므로, 자기 몫의
      // .scr-activity-card-stack-wrapper를 스스로 렌더한다 — 여기서 또 감싸지 않는다.
      <GameResultPost
        // 같은 세션이라도 중간에 다른 종류 카드가 끼면 스택이 둘로 갈린다 —
        // 날짜+시각만으로는 그 둘이 같은 키가 될 수 있어 첫 경기 id로 못박는다.
        key={`ms-${item.items[0].gameResult.id}`}
        stack={item}
        memberOf={memberOf}
        onDeleted={handleGameResultDeleted}
        dateLabel={sessionDateLabel(item.date)}
      />
    ) : (
      // 묶이지 않은 낱장 경기 — 머리는 목록에서도 남긴다. 줄이 말하지 않는 등록자와
      // 삭제 메뉴가 거기 있어서, 묶음 안의 경기 카드와 같은 이유로 감추면 안 된다.
      <div className="scr-activity-card-stack-wrapper" key={`m-${item.gameResult.id}`}>
        <GameResultCard
          item={item}
          memberOf={memberOf}
          onDeleted={handleGameResultDeleted}
          dateLabel={dateLabelOf(item)}
        />
      </div>
    )
  );

  /* 목록 줄 하나 — 그룹 미리보기(최대 5줄)와 "전체 보기" 팝업이 똑같이 이 함수를 쓴다
   *  (카드 쪽 수정이 두 자리에 따로 반영되는 걸 피하려는 renderCard와 같은 이유).
   *
   *  누르면 그 자리에서 펼치는 게 아니라 상세 팝업이 뜬다(요청) — 그래서 열림 상태도,
   *  그 상태를 오가는 방법도, 줄마다 붙어 있던 접힘 칸도 다 없다. 두 자리가 같은 항목을
   *  동시에 보여 줄 수 있어(전체 보기를 열어도 뒤의 미리보기 5줄은 그대로 남는다) 열림
   *  상태를 따로 들고 있어야 했는데, 열리는 곳이 화면에 하나뿐인 팝업이 되면서 그 걱정도
   *  같이 사라졌다. */
  const renderRow = (item: DisplayItem) => {
    const key = rowKeyOf(item);
    const flags = rowFlagsOf(item);
    return (
      <div className="scr-activity-row-wrap" key={key}>
        <button
          type="button"
          className={cx("scr-activity-row", rowVoid(item) && "scr-activity-row-void")}
          onClick={() => setDetailItem(item)}
        >
          <span className="scr-activity-row-main">
            <span className="scr-activity-row-desc">
              {/* 유형 배지는 이제 어느 줄에도 안 그린다(요청: 너 나와도 제거) — 그룹 제목이
                  이미 갈래를 말하고 있어서, 줄마다 "너 나와!"를 되풀이하면 다섯 줄이 같은
                  글자로 시작한다. 그 자리를 상태 알약이 이어받는다(요청: 너 나와 상태배지를
                  제목 왼쪽에).
                  자리를 바꾼 것이 요점이다 — 상태는 윗줄 오른쪽(시각·NEW 딱지 옆)에 있었는데,
                  거기서는 "언제"를 말하는 것들과 섞여 읽혔다. 제목 왼쪽은 원래 "이게 무엇인가"를
                  말하던 자리이고, 갈래가 칸 이름으로 올라간 지금 그 자리가 말할 것은 상태다.
                  값이 있는 줄은 너 나와와 리그뿐이고 나머지는 아예 안 그린다. */}
              {rowStatusOf(item)}
              {rowDesc(item)}
            </span>
            {/* 시각은 제목과 같은 줄 오른쪽 끝이다(요청) — 줄이 둘일 때는 시각이 제목보다
                먼저 읽히는 자리(윗줄)에 있었는데, 줄에서 읽을 값은 제목이다. 딱지(NEW·
                UPDATE)는 그 시각 위에 얹는다(요청): 둘 다 "언제"에 대한 말이라 한 덩어리로
                묶이고, 두 줄을 합쳐도 제목 한 줄 높이라 줄이 도로 두 줄로 늘지 않는다. */}
            <span className="scr-activity-row-badges">
              {/* 새것(NEW)이거나 달라진 것(UPDATE) — 둘 다 참이어도 하나만 세운다(요청:
                  NEW 우선). */}
              {flags.length > 0 && (
                <span className={cx("scr-activity-row-flag", `scr-activity-row-flag-${flags[0]}`)}>
                  {flags[0] === "new" ? "NEW" : "UPDATE"}
                </span>
              )}
              <span className="scr-activity-row-time">
                {item.kind === "challenge" && item.undated ? "미정" : formatAgo(item.time)}
              </span>
            </span>
          </span>
        </button>
      </div>
    );
  };

  /* "전체 보기"는 이제 창이 아니라 화면이다(요청) — 활동 목록 자리를 그 갈래의 전체
     목록으로 갈아 끼운다. 목록 위에 겹쳐 띄우던 때와 달리 뒤에 남는 화면이 없으므로,
     아래 본문(제목·등록 버튼·덩어리 미리보기)은 통째로 그리지 않는다. 상세 팝업과 등록
     폼들은 이 화면에서도 그대로 떠야 해서 바깥에 남는다. */
  const groupPage = openGroupKey
    ? {
      def: GROUP_DEFS.find((g) => g.key === openGroupKey)!,
      items: groupedSections.find((s) => s.key === openGroupKey)?.items ?? [],
    }
    : null;

  return (
    <div className="scr-screen scr-activity-screen">
      {groupPage && openGroupKey && (
        <ActivityGroupPage
          groupKey={openGroupKey}
          label={groupPage.def.label}
          items={groupPage.items}
          memberOf={memberOf}
          members={members}
          renderRow={renderRow}
          onBack={closeGroup}
        />
      )}
      {/* 화면 아래 동그란 버튼은 한 자리를 두 화면이 나눠 쓴다(요청: 전체 보기의 뒤로가기를
          없애고 등록 버튼이 뒤로가기로 바뀜) — 활동 목록에서는 "등록", 전체 보기 화면에서는
          "뒤로". 손이 가는 자리가 하나뿐이라, 화면이 바뀌면 그 자리가 하는 일도 바뀌는 것이
          맞다. 그래서 이 덩어리는 두 화면 바깥에 있다. */}
      {/* 숨김 클래스는 항상 붙이되 실제 적용은 CSS가 모바일 폭에서만 한다 — 이 버튼은
          PC에서도 뜨는데, 거기선 키보드가 화면을 가리지 않으므로 검색창에 포커스했다고
          사라지면 안 된다. */}
      <div className={cx(
        "scr-activity-add-fab-wrap scr-activity-add-wrap",
        fabHidden && "scr-activity-add-fab-wrap-hidden",
      )}>
        {groupPage ? (
          <button
            type="button"
            className="scr-activity-add-fab"
            onClick={closeGroup}
            aria-label="활동으로 돌아가기"
          >
            <ChevronLeft size={20} aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            className="scr-activity-add-fab"
            onClick={() => setAddMenuOpen((v) => !v)}
            aria-expanded={addMenuOpen}
          >
            {/* 아이콘 대신 글자로(요청) — 동그란 ＋는 "무언가 추가"까지만 말하고 무엇을
                추가하는지는 눌러 봐야 알았다. 리플레이를 읽는 동안에는 그 자리에 스피너가
                들어서므로, 글자와 스피너가 자리를 다투지 않게 둘 중 하나만 그린다. */}
            {parsingReplays ? <Spinner size={18} /> : "등록"}
          </button>
        )}
        {!groupPage && addMenuOpen && (
          <>
            <div className="scr-activity-add-backdrop" onClick={() => setAddMenuOpen(false)} aria-hidden />
            <div className="scr-activity-add-menu scr-activity-add-menu-up" role="menu">
              <button
                type="button" role="menuitem"
                onClick={() => { setAddMenuOpen(false); replayInputRef.current?.click(); }}
              >
                <Upload size={14} aria-hidden /> 게임결과 등록
              </button>
              <button
                type="button" role="menuitem"
                onClick={() => { setAddMenuOpen(false); setChallengeFormOpen(true); }}
              >
                <Phone size={14} aria-hidden /> 너 나와! 등록
              </button>
              <button
                type="button" role="menuitem"
                onClick={() => { setAddMenuOpen(false); setScheduleForm("new"); }}
              >
                <CalendarPlus size={14} aria-hidden /> 일정 등록
              </button>
            </div>
          </>
        )}
        <input
          ref={replayInputRef} type="file" accept=".rep" multiple hidden
          onChange={handleReplayFilesChosen}
        />
      </div>

      {!groupPage && (
      <>
      <div className="scr-v2-toolbar">
        <div className="scr-v2-toolbar-title-row">
          <h1 className="scr-title scr-v2-toolbar-title">활동</h1>
        </div>
      </div>

      {error && <div className="scr-err">{error}</div>}

      {loading ? (
        <LoadingMark />
      ) : displayFeed.length === 0 ? (
        <div className="scr-empty">아직 표시할 활동이 없어요.</div>
      ) : (
        /* 유형별 덩어리(요청: "활동 화면을 유형별 목록으로 구분하는데 각 덩어리별로 중
           타이틀 달고 그 옆에 전체 보기 버튼 추가, 묶음 구분되게 사이 갭 충분히 주기") —
           덩어리마다 최대 5줄만 미리 보여주고(GROUP_PREVIEW_MAX), 그 이상은 "전체 보기"
           팝업(ActivityGroupModal)에서 본다. */
        <div className="scr-activity-groups">
          {groupedSections.map((section) => (
            <div className="scr-activity-group" key={section.key}>
              {/* 소제목 줄 전체가 "전체 보기" 버튼이다(요청) — 글자 넉 자만 누를 수 있으면
                  손가락으로는 겨냥해야 하는 과녁이고, 이 줄에서 할 수 있는 일이 그것뿐이라
                  줄 전체를 내주는 편이 맞다.
                  버튼 태그로 감싸지 않는 이유는 제목이 h2라서다 — 버튼 안에 제목을 넣는 것은
                  HTML이 허락하지 않는다. 그래서 role/tabIndex/키보드를 직접 달아 준다. */}
              <div
                className="scr-activity-group-head"
                role="button" tabIndex={0}
                aria-label={`${section.label} 전체 보기`}
                onClick={() => openGroup(section.key)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  openGroup(section.key);
                }}
              >
                <h2 className="scr-activity-group-title">{section.label}</h2>
                <span className="scr-activity-group-viewall" aria-hidden>전체 보기</span>
              </div>
              <div className="scr-activity-rows">
                {/* 미리보기는 시간표가 아니라 소식란이다(요청) — 최근에 올라오거나 달라진
                    것부터 센다. "전체 보기" 팝업은 원래 차례(시간순) 그대로다. */}
                {[...section.items]
                  .sort((a, b) => touchMsOf(b) - touchMsOf(a))
                  .slice(0, GROUP_PREVIEW_MAX)
                  .map((item) => renderRow(item))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 스피너는 화면에 하나뿐이어야 한다 — 위 목록 자리의 것과 여기 '더 불러오는 중'이
          동시에 뜨면 로딩바가 두 개로 보인다(지적). 센티널도 목록이 그려진 뒤에만 둔다:
          없으면 관측할 것 자체가 없어 조기 loadMore가 원천적으로 안 생긴다. */}
      {!loading && loadingMore && <LoadingMark />}
      {!loading && <div ref={sentinelRef} aria-hidden />}
      </>
      )}

      {/* 상세 — 줄을 누르면 그 자리에서 펴는 대신 팝업으로 뜬다(요청). 카드 본문은 예전
          접힘 칸에 있던 것과 같은 껍데기(.scr-activity-row-body)를 그대로 쓴다: 카드의
          여백·사진 배경이 그 클래스에 걸려 있어서, 다른 껍데기에 담으면 같은 카드가 두 가지
          모습이 된다.
          "전체 보기" 팝업 위에도 뜰 수 있으므로(그 안의 줄을 눌러도 이 팝업이다) 더 위에
          선다 — .scr-activity-detail-modal의 z-index. */}
      {/* body로 포털한다 — 화면 안(.scr-main, z-index:1)에 그대로 두면 헤더(z-index:2)가
          만든 쌓임 맥락에 진다. 모달 자신의 z-index가 130이어도 소용없다: 비교는 조상 맥락
          끼리 먼저 이뤄지고, .scr-main(1) < .scr-header(2)에서 이미 갈린다.
          실제로 모바일에서 헤더 로고가 "활동으로 돌아가기" 위에 그려져 그 버튼이 눌리지도
          않았다(실측: elementFromPoint가 .scr-header-inner). 옆의 "전체 보기" 팝업이 처음부터
          createPortal을 쓰고 있던 것이 같은 이유다. */}
      {detailItem && createPortal(
        <div className="scr-modal-overlay">
          {/* 뒤/앞으로가기(요청) — 상세가 주소 해시(#game-12 …)를 얹는다. */}
          <ModalHash hash={detailHashOf(detailItem)} onClose={() => setDetailItem(null)} />
          {/* 창 뒤를 덮는 투명 판 — 이 창은 전면이 아니라 작게 뜨는 탓에 뒤에 떠 있는
              탭바·등록 버튼·맨 위로 버튼이 그대로 눌렸다(지적). 딤은 안 씌우고 눌림만
              막으며, 그 누름은 닫기로 받는다. */}
          <div
            className="scr-activity-detail-backdrop"
            onClick={() => setDetailItem(null)}
            aria-hidden
          />
          {/* 편지지 배경은 카드가 아니라 창 전체가 입는다(요청) — 창이 곧 편지 한 통이라,
              카드 자리에만 깔면 그 위아래(머리 줄·여백)만 딴 종이가 된다. 사진 층을 창의
              첫 자식으로 두면 창의 둥근 모서리(overflow:hidden)에 맞춰 잘리고, 유리판
              (::before)과 내용 사이에 정확히 한 겹으로 앉는다. */}
          <div
            className={cx(
              "scr-modal scr-modal-page scr-modal-fit scr-activity-detail-modal",
              /* 게임 상세는 애초에 전체화면이다(요청) — 미니맵을 화면의 짧은 변에 최대로
                 맞추려면 창이 화면을 다 써야 한다. 다른 갈래(너나와·일정·칭호)는 내용이
                 작아 가운데 창 그대로다. */
              detailItem.kind === "gameResult" && "scr-activity-detail-full",
              rowPhoto(detailItem) && "scr-activity-detail-photo",
            )}
            {...(rowPhoto(detailItem)
              ? { style: { "--card-photo": `url("${rowPhoto(detailItem)}")` } as CSSProperties }
              : {})}
          >
            {rowPhoto(detailItem) && <div className="scr-activity-card-photo" aria-hidden="true" />}
            <div className="scr-modal-head scr-activity-detail-head">
              {/* (삭제) 갈래 이름 제목 — 안 넣어도 된다(요청). 카드 자신이 이미 무엇인지를
                  말하고("bob 너 나와!", 게임 로스터, 칭호 목록…), 그 위에 "너 나와!"를 한 번
                  더 얹으면 같은 말이 두 줄로 겹친다. 남는 것은 닫는 X 하나다. */}
              <button type="button" className="scr-icon-btn scr-modal-close-x" onClick={() => setDetailItem(null)} aria-label="닫기">
                <X aria-hidden />
              </button>
              {/* (삭제) "활동으로 돌아가기" — 이 창은 이제 모바일에서도 전체화면이 아니라
                  제 내용만 한 크기로 가운데 뜬다(요청). 뒤가 그대로 보이므로 "화면을
                  벗어난다"가 아니라 "이 창을 닫는다"이고, 그러면 X가 맞다. 전체화면으로
                  뜨는 "전체 보기"(.scr-modal-page)만 돌아가기를 그대로 쓴다. */}
            </div>
            <div className="scr-modal-body scr-activity-detail-body scr-scroll">
              {/* 사진은 이 껍데기가 아니라 창이 깐다(바로 위) — 여기서는 사진 위 글자에
                  테두리를 주는 규칙만 물려받으면 되므로 클래스만 남긴다. */}
              <div className="scr-activity-row-body">
                {/* 상세 안의 연속 재생에 닫기 통로를 준다(요청: PC는 게임 결과만 확대창이
                    기본, 기존 상세는 미사용) — 확대창을 닫으면 이 상세도 함께 닫힌다. */}
                <GameDetailCloseContext.Provider value={() => setDetailItem(null)}>
                  {renderCard(detailItem)}
                </GameDetailCloseContext.Provider>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {challengeFormOpen && (
        <ChallengeFormModal
          onClose={() => setChallengeFormOpen(false)}
          onCreated={(c) => { upsertChallenge(c); setChallengeFormOpen(false); }}
        />
      )}

      {/* 일정 등록·수정 — 창 하나가 둘을 다 한다(요청). "new"면 빈 폼, 일정이면 그 값이
          채워진 폼이다. */}
      {scheduleForm && (
        <ScheduleFormModal
          initial={scheduleForm === "new" ? null : scheduleForm}
          onClose={() => setScheduleForm(null)}
          onSaved={upsertSchedule}
        />
      )}

      {/* 리플레이 등록 결과 — 인라인 토스트 대신 확인 버튼 있는 팝업으로(지적). "취소"가
          아니라 순수 안내라 버튼은 "확인" 하나뿐이다 — ConfirmDialog는 항상 두 버튼을
          내므로 여기선 그 대신 같은 모양의 팝업을 직접 그린다. */}
      {/* 문제 있는 건만 사람이 훑는 자리(요청) — 매핑이 덜 됐거나 승패를 못 가렸거나
          짧은 판. 창을 닫으면(등록했든 그냥 닫았든) 미뤄 둔 자동 등록분 안내를 그때 띄운다. */}
      {reviewDrafts && (
        <ReplayReviewModal
          drafts={reviewDrafts}
          onClose={() => {
            setReviewDrafts(null);
            const pending = pendingNoticeRef.current;
            pendingNoticeRef.current = null;
            if (pending) setReplayNotice(pending);
          }}
          onSaved={handleReplaysSaved}
        />
      )}

      {replayNotice && createPortal(
        <div className="scr-modal-overlay">
          <div className="scr-modal scr-modal-sm scr-modal-confirm">
            <div className="scr-confirm-head">
              <span>{replayNotice.kind === "success" ? "등록 완료" : "등록 결과 확인 필요"}</span>
            </div>
            <p className="scr-confirm-msg">{replayNotice.text}</p>
            <div className="scr-form-actions">
              <button type="button" className="scr-btn scr-btn-primary" onClick={() => setReplayNotice(null)}>
                확인
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

    </div>
  );
}
