import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import RankingShiftCard, { RankingShiftMenu, RANK_SHIFT_TITLE } from "./RankingShiftCard";
import { CalendarPlus, ClipboardList, MoreHorizontal, Phone, Upload } from "lucide-react";
import { Spinner } from "../../components/common/Feedback";
import SearchFilterBar from "../../components/common/SearchFilterBar";
import Select from "../../components/common/Select";
import FilterItem from "../../components/common/FilterItem";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import KakaoShareButton from "../../components/common/KakaoShareButton";
import { shareThumb } from "../../utils/kakaoShare";
import GameResultCardBody, { type SearchListRow } from "./GameResultCardBody";
import { ActivityCard } from "./ActivityCard";
import { resolveSlotName } from "./GameResultSides";
import { isComputerSlot } from "../../constants/computerSlot";
import { isUnregisteredSlot } from "../../constants/unregisteredSlot";
import { ChallengeCard, ChallengeTimeHeadEdit, challengeSideBadges, challengeStatusInfo } from "../challenge/ChallengeScreen";
import ReplayReviewModal from "../../modals/ReplayReviewModal";
import ActivityComments, { latestCommentMs, primeActivityComments } from "./ActivityComments";
import { primeReplayMaps } from "../../hooks/useReplayMap";
import ChallengeFormModal from "../../modals/ChallengeFormModal";
import { scheduledInstantMs, formatWhen, formatAgo, serverMs } from "../../utils/date";
import { useAppStore } from "../../store/appStore";
import { isAdminRole } from "../../constants/roles";
import { activeMemberSearchTerms, memberMatchesTerm, normalizeSearchText, splitSearchTerms } from "../../utils/memberSearch";
import { cx } from "../../utils/format";
import { api } from "../../api/client";
import { useCursorPagination } from "../../hooks/useCursorPagination";
import { useEditableFocused } from "../../hooks/useEditableFocused";
import { usePageBackground } from "../../hooks/usePageBackground";
import {
  buildReplayDrafts, shortMatchHint, validateReplayDraft, type ReplayDraft,
} from "../../utils/replayDraft";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";
import { hasAppUpdatePreloadErrorOccurred } from "../../utils/appUpdate";
import type {
  Challenge, ActivityTargetType, GameOutcome, GameResult, GameResultSlot, Member, NewGameResult, RankingShift,
} from "../../types";

const PAGE_SIZE = 100;
const MAX_REPLAY_FILES = 20;



/** 목록 줄이 접히는 데 걸리는 시간 — CSS의 scr-row-close 애니메이션과 같은 값이라야
 *  카드가 다 접힌 뒤에 사라진다(짧으면 접히다 말고 툭 없어진다). */
const ROW_CLOSE_MS = 200;

/** NEW로 볼 기간(요청: 24시간 내) — 지난 방문을 기억해 두던 방식에서 이 단순한 규칙으로
 *  바꿨다. 누구에게나 같은 것이 보이고, 브라우저에 기억해 둘 것도 없다. */
const NEW_WINDOW_MS = 24 * 60 * 60 * 1000;

// 활동 — 커뮤니티 활동(경기 결과, 너 나와! 일정)을 한 타임라인으로 보여주는 홈 화면.
// 타임라인 기준: 너 나와!는 경기 예정 일시, 경기는 리플레이의 게임 시작 시각.

interface ChallengeItem {
  kind: "challenge";
  time: number;
  withClock: boolean;
  /** 활동에서 꽂히는 자리 — 표시용 time과 다르다(challengeSortMs 주석 참고). */
  sortTime: number;
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

type ActivityItem = ChallengeItem | GameResultItem | RankingShiftItem;

// 같은 '세션'의 게임결과가 활동에서 2개 이상 연속되면 겹침 스택 하나로 묶는다.
export interface GameResultPostItem {
  kind: "gameResultPost";
  time: number;
  /** 세션 날짜(YYYY-MM-DD) — 달력 날짜가 아니라 sessionDateOf 기준이다. */
  date: string;
  items: GameResultItem[];
}

type DisplayItem = ActivityItem | GameResultPostItem;

/** 활동에서 이 항목이 꽂히는 자리(ms) — 너 나와만 표시용 시각과 다르다(challengeSortMs). */
function sortMsOf(it: ActivityItem): number {
  return it.kind === "challenge" ? it.sortTime : it.time;
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

function challengeItem(c: Challenge): ChallengeItem {
  /* 표시 시각 — 취소·거절·만료로 끝난 건은 그 끝난 때다(요청: 시간은 취소/거절/만료
     시간으로). 약속 날짜를 그대로 쓰면 "8월 3일 대결"이라 적힌 채 카드에는 취소라고
     쓰여 있는, 서로 어긋난 머리가 된다. 성사·완료는 예전대로 약속한 날이다. */
  const ended = c.status === "discarded" && c.discardedAt;
  const iso = ended ? c.discardedAt! : (c.scheduledAt ?? c.createdAt);
  return {
    kind: "challenge",
    time: serverMs(iso),
    // 시각 개념이 없어졌다(요청: 너 나와는 날짜만) — 헤더는 늘 날짜만 적는다.
    withClock: false,
    sortTime: challengeSortMs(c),
    challenge: c,
  };
}

/** 아직 안 끝난(응답대기·성사) 너 나와인가 — 활동에서 "현재" 선보다 위(=앞으로 있을 일)에
 *  놓이는 것은 이것뿐이다. 경기결과·순위변동은 전부 이미 벌어진 일이다. */
export function isUpcomingChallenge(it: { kind: string; challenge?: Challenge }): boolean {
  return it.kind === "challenge"
    && (it.challenge!.status === "pending" || it.challenge!.status === "confirmed");
}

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
    // 그날 끝(23:59:59)을 기준으로 잡아 같은 날 경기들보다 위에 서게 하고, 이미 지난
    // 약속이면 "지금 바로 위"까지 끌어올린다.
    const endOfDay = c.scheduledDate
      ? new Date(`${c.scheduledDate}T23:59:59`).getTime()
      : base;
    return Math.max(endOfDay, Date.now() + 1);
  }
  /* 취소·거절·버림·만료로 끝난 것은 '끝난 때'에 꽂는다 — 카드가 적는 시각도 그때이기
     때문이다(challengeItem의 iso). 예전에는 여기만 약속한 날(scheduledDate)을 봤는데,
     그러면 8월 1일로 잡았다가 어제 취소한 건이 "어제"라고 적힌 채 8월 1일 자리에 끼어
     들었다(지적: 취소/만료/거절 너 나와가 순서가 안 맞는 곳에 있다). 적는 시각과 꽂는
     자리가 다르면 목록은 어느 쪽으로 읽어도 틀린 그림이 된다. */
  if (c.status === "discarded" && c.discardedAt) return serverMs(c.discardedAt);
  if (!c.scheduledDate) return base;
  // 결과까지 들어온 건(완료)은 여전히 약속한 날의 이야기다 — 그날 경기들 아래(오전 8시,
  // sessionDateOf의 경계와 같은 값)에 앉혀 전날 것들보다는 위가 되게 한다.
  return new Date(`${c.scheduledDate}T00:00:00`).getTime() + SESSION_DAY_START_HOUR * 3600_000;
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
function rowKeyOf(it: DisplayItem): string {
  return it.kind === "challenge" ? `c-${it.challenge.id}`
    : it.kind === "rankingShift" ? `rs-${it.shift.id}`
      : it.kind === "gameResultPost" ? `ms-${it.items[0].gameResult.id}`
        : `m-${it.gameResult.id}`;
}

/** 그 줄이 무엇에 대한 것인가 — 카드 머리의 제목과 같은 말을 쓴다. */
function rowTitleOf(it: DisplayItem): string {
  return it.kind === "challenge" ? "너 나와!"
    : it.kind === "rankingShift" ? RANK_SHIFT_TITLE : "게임결과";
}

/** 이 리플레이는 등록 전에 사람이 한 번 봐야 하나(요청) — 세 가지다.
 *
 *  · 선수를 회원과 못 이었다(unmatchedTeam*) — 그냥 넣으면 "모름"으로 박혀 그 사람 전적이
 *    사라진다. 검토창에서 회원/컴퓨터/비회원 중 무엇인지 골라 줘야 한다.
 *  · 승패를 못 가려냈다(result 없음) — 예전엔 무승부로 채워 넣고 카드에 빨간 글씨만 남겼는데,
 *    그건 틀린 기록이 통계에 먼저 섞인 뒤 사람이 찾아오길 기다리는 순서다.
 *  · 2분이 안 되는 짧은 판(shortMatchHint) — 진짜 경기일 수도, 맵만 켰다 끈 것일 수도 있다.
 *    이건 데이터만 봐서는 못 가른다.
 *
 *  나머지(매핑 끝 + 승패 확실 + 정상 길이)는 사람이 볼 게 없으므로 그냥 등록한다. */
function needsReview(d: ReplayDraft): boolean {
  return d.unmatchedTeam1.length > 0
    || d.unmatchedTeam2.length > 0
    || !d.result
    || shortMatchHint(d) !== null;
}

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
function playersOf(items: GameResultItem[], memberOf: (id: string) => Member | undefined): string[] {
  const seen = new Map<string, { name: string; n: number }>();
  for (const it of items) {
    for (const side of ["team1", "team2"] as const) {
      for (const slot of it.gameResult[side]) {
        if (isComputerSlot(slot.memberId) || isUnregisteredSlot(slot.memberId)) continue;
        const cur = seen.get(slot.memberId)
          ?? { name: resolveSlotName(slot, it.gameResult[side], memberOf), n: 0 };
        cur.n += 1;
        seen.set(slot.memberId, cur);
      }
    }
  }
  return [...seen.values()].sort((a, b) => b.n - a.n).map((x) => x.name);
}

export function sessionDateLabel(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}월 ${Number(d)}일`;
}

// 응답 마감 = 요청일 + 72시간(예정 시각이 그보다 먼저면 예정 시각) — 백엔드와 동일 기준.
// 헤더행의 날짜 옆에서 1초마다 실시간으로 줄어든다(요청: "응답마감까지 72:32:31" 형식).
const CHALLENGE_EXPIRE_MS = 72 * 60 * 60 * 1000;
function ChallengeCountdown({ challenge }: { challenge: Challenge }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (challenge.status !== "pending") return null;
  const base = new Date(challenge.createdAt).getTime() + CHALLENGE_EXPIRE_MS;
  const scheduled = scheduledInstantMs(challenge);
  const deadline = scheduled !== null ? Math.min(base, scheduled) : base;
  const remain = deadline - now;
  if (remain <= 0) return null;
  const total = Math.floor(remain / 1000);
  const hh = String(Math.floor(total / 3600)).padStart(2, "0");
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return <span className="scr-activity-chal-countdown">응답마감까지 {hh}:{mm}:{ss}</span>;
}

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
      ...shareThumb("challengeCall"),
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
  onDeleted: () => void;
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
      headMeta={item.gameResult.createdBy && (
        <span className="scr-activity-card-by">{item.gameResult.createdBy.nickname} 등록</span>
      )}
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
  onDeleted: () => void;
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

export default function ActivityScreen() {
  // 화면 배경 사진 — 이제 PC 다크에서만 깐다(요청: 라이트는 통째로, 다크는 모바일만 제거).
  // 그래서 모바일용·라이트용 사진은 넘기지 않는다(usePageBackground 주석 참고).
  // 사진은 통계와 같은 것을 쓴다(원래 활동 배경이던 파일이 통계로 옮겨가며 이름만 stats_bg*가 됐다).
  usePageBackground("/images/bg/stats_bg.jpg");
  // 검색/필터(기록실과 동일 구성) — 유저 검색, 경기유형, 게임번호. 불러온 활동 안에서 즉시 필터.
  const [search, setSearch] = useState("");
  // 활동 유형 필터(요청: 분류(개인전/팀전) 제거하고 유형 드롭다운 추가). 게임결과/너나와/
  // 일정/랭크변동으로 거른다 — 너나와=시간 미확정 도전장, 일정=시간 확정 도전장.
  const [kindFilter, setKindFilter] = useState<"all" | "gameResult" | "call" | "schedule" | "rankingShift">("all");

  /* 목록 한 줄을 눌러 펼친다 — 펼침은 한 번에 하나다. 여러 줄을 동시에 펴 두면 목록의
     값어치(한 화면에 많이)가 사라진다.
     (예전엔 카드를 죽 늘어놓는 '타임라인' 보기가 따로 있고 둘을 버튼으로 오갔는데,
      통째로 걷어냈다(요청) — 목록이 기본이 된 뒤로는 아무도 그쪽으로 넘어가지 않았고,
      같은 카드를 두 가지 배치로 그리느라 카드 쪽 수정마다 양쪽을 다 확인해야 했다.
      보던 모양을 기억하던 localStorage 자리도 함께 없앴다.) */
  const [openRowKey, setOpenRowKey] = useState<string | null>(null);
  /* 접히는 모습을 보여 주려면(요청: 여닫을 때 트랜지션) 닫는 동안에도 그 줄의 카드가
     잠깐 더 붙어 있어야 한다 — 바로 언마운트하면 그냥 사라진다. 다른 줄을 펴서 밀려
     닫히는 경우도 같은 길을 탄다. */
  const [closingRowKey, setClosingRowKey] = useState<string | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  useEffect(() => () => { if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current); }, []);
  const toggleRow = (key: string) => {
    const prev = openRowKey;
    const next = prev === key ? null : key;
    setOpenRowKey(next);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    if (prev && prev !== next) {
      setClosingRowKey(prev);
      closeTimerRef.current = window.setTimeout(() => {
        setClosingRowKey(null);
        closeTimerRef.current = null;
      }, ROW_CLOSE_MS);
    } else {
      setClosingRowKey(null);
    }
  };

  const user = useAppStore((s) => s.user);
  const isAdmin = !!user && isAdminRole(user.roles);
  const memberOf = useAppStore((s) => s.memberOf);
  const members = useAppStore((s) => s.members);
  const addGameResult = useAppStore((s) => s.addGameResult);

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

  // 너 나와! 목록
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [challengesLoading, setChallengesLoading] = useState(true);
  const [error, setError] = useState("");

  const loadChallenges = useCallback(() => {
    api.getChallenges()
      .then((res) => setChallenges(res.items))
      .catch((e) => setError(e instanceof Error ? e.message : "목록을 불러오지 못했어요."))
      .finally(() => setChallengesLoading(false));
  }, []);
  useEffect(loadChallenges, [loadChallenges]);

  /* 댓글도 목록과 함께 한 번에 받아 둔다(요청) — 카드마다 따로 부르면 답이 제각각 도착하며
     카드 키가 뒤늦게 자라, 들어올 때 "현재"에 맞춰 둔 자리가 그만큼 밀린다. 이게 끝나야
     목록을 그린다: 그래야 첫 렌더의 카드 높이가 곧 최종 높이다.
     실패해도 목록까지 막지는 않는다 — 그때는 카드가 예전처럼 제 것만 따로 불러온다. */
  const [commentsLoading, setCommentsLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    primeActivityComments().catch(() => {}).finally(() => { if (alive) setCommentsLoading(false); });
    return () => { alive = false; };
  }, []);

  // 카드의 카운트다운/마감 파생 상태를 1분마다 갱신한다.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  // 응답/결과입력 등 카드 액션의 결과를 목록에 반영한다.
  const upsertChallenge = (updated: Challenge) => {
    setChallenges((prev) => (
      prev.some((c) => c.id === updated.id)
        ? prev.map((c) => (c.id === updated.id ? updated : c))
        : [updated, ...prev]
    ));
  };

  // 경기 전체 — 최신순 커서 페이지를 끝까지 이어붙여 한 번에 다 불러온다.
  const fetchPage = useCallback(
    (cursor: string | null) =>
      api.getGameResultsPage({ cursor: cursor ?? undefined, limit: PAGE_SIZE, sort: "latest" }),
    [],
  );
  const {
    items: gameResults, loading: matchesLoading, loadingMore, hasMore, loadMore, reload,
    total: gameResultTotal,
  } = useCursorPagination(fetchPage, []);

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
    if (matchesLoading || didPrimeMapsRef.current) return;
    didPrimeMapsRef.current = true;
    primeReplayMaps(gameResults.map((g) => g.mapHash))
      .catch(() => {}).finally(() => { if (aliveRef.current) setMapsLoading(false); });
  }, [matchesLoading, gameResults]);

  const loading = challengesLoading || matchesLoading || commentsLoading || mapsLoading;

  /* 무한스크롤 관측 — 목록이 실제로 그려진 뒤에만 건다. 이 판단은 경기 목록의 로딩
     (matchesLoading)이 아니라 화면 전체의 loading이어야 한다(지적: 로딩바가 두 개 뜬다).
     경기 목록만 먼저 도착하고 댓글·격자 프리페치가 아직인 구간에서는 목록 자리에 스피너
     하나만 있어 화면이 짧으니, 맨 아래 센티널이 처음부터 보인다 — 그러면 사용자가 스크롤을
     하기도 전에 다음 페이지를 부르고, 스피너가 하나 더 붙어 두 개가 됐다. 딸려온 문제가 더
     크다: 그 바람에 gameResults가 바뀌면서 위 프리페치까지 어긋났다. */
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loading) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && hasMore && !matchesLoading && !loadingMore) {
        loadMore();
      }
    }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, matchesLoading, loadingMore, loadMore]);

  // 랭크(포인트/순위) 변동 이벤트 — 서버가 경기 등록/삭제 때마다 계산·저장한 스냅샷을
  // 그대로 읽는다(클라이언트는 더 이상 아무것도 계산하지 않는다).
  const [rankShifts, setRankShifts] = useState<RankingShift[]>([]);
  /* 줄 번호 — 서버가 센 값을 그대로 쓴다(요청: "api에서 보내주는 값이어야 한다").
     화면이 직접 셀 수 없는 값이다: 목록은 세 곳을 시간순으로 섞어 만드는데 게임결과는
     페이지 단위로 나눠 받으므로, 화면이 쥔 것만 세면 아직 안 받아온 과거만큼 번호가
     통째로 어긋난다. 열쇠(rowKeyOf와 같은 꼴)로 자기 줄에 얹는다. */
  const [rowNos, setRowNos] = useState<Map<string, number>>(new Map());
  const reloadRankingShifts = useCallback(() => {
    api.listRankingShifts()
      .then(setRankShifts)
      .catch(() => {});
    api.listActivityRows()
      .then((res) => setRowNos(new Map(res.rows.map((r) => [r.key, r.no]))))
      // 못 받아 와도 화면은 그대로 돌아간다(번호만 안 붙는다) — 다만 조용히 삼키지는
      // 않는다. 한 번 그렇게 뒀다가 운영에서 번호가 통째로 안 나오는데 왜인지 알 길이
      // 없었다(지적). 콘솔에 남겨 두면 무엇이 끊겼는지가 한눈에 보인다.
      .catch((e) => console.error("[활동] 줄 번호를 못 받아 왔습니다 — /api/activity/list", e));
  }, []);
  useEffect(() => reloadRankingShifts(), [reloadRankingShifts]);

  // 저장/삭제 완료 — 경기 목록과 함께 변동 이벤트도 갱신한다(서버가 이미 저장을 끝냈다).
  const handleReplaysSaved = useCallback(async () => {
    reload();
    reloadRankingShifts();
  }, [reload, reloadRankingShifts]);
  const handleGameResultDeleted = useCallback(() => {
    reload();
    reloadRankingShifts();
  }, [reload, reloadRankingShifts]);

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

      // 중복(이미 등록됨/병합됨)은 buildReplayDrafts가 이미 걸러 뒀으므로 조용히 넘어간다.
      // 팀을 아예 못 나눴거나(teamSplitUncertain) 관전자 의심 인원이 있는 건은 검토창도
      // 손댈 수 없는 자리라(팀 편성 자체를 다시 짜야 한다) 여전히 실패로 남긴다.
      // 그 밖에 사람 눈이 필요한 세 가지는 검토창으로 보낸다(요청) — 아래 needsReview.
      let registered = 0;
      const failed: string[] = [];
      const review: ReplayDraft[] = [];
      for (const raw of drafts) {
        if (raw.excludeReason === "duplicate") continue;
        if (raw.parseError) { failed.push(`${raw.fileName}: ${raw.parseError}`); continue; }
        if (raw.teamSplitUncertain) {
          failed.push(`${raw.fileName}: 팀을 자동으로 나누지 못했어요.`);
          continue;
        }
        if (raw.guessedObservers.length > 0) {
          failed.push(`${raw.fileName}: 관전자로 의심되는 사람이 있어요(${raw.guessedObservers.join(", ")}).`);
          continue;
        }
        if (needsReview(raw)) { review.push(raw); continue; }

        // 여기까지 온 건 매핑도 끝났고 승패도 가려졌고 길이도 정상인 경기다 — 그냥 넣는다.
        const problem = validateReplayDraft(raw);
        if (problem) { failed.push(`${raw.fileName}: ${problem}`); continue; }

        const payload: NewGameResult = {
          date: raw.date, team1: raw.team1, team2: raw.team2,
          result: raw.result as GameOutcome, matchType: raw.matchType,
          replay: raw.replay,
          mapName: raw.mapName || null, gameStartedAt: raw.gameStartedAt,
          durationSeconds: raw.durationSeconds,
          summaryData: raw.summaryData,
          mapData: raw.mapGrid,
        };
        try {
          await addGameResult(payload);
          registered += 1;
        } catch (err) {
          failed.push(`${raw.fileName}: ${err instanceof Error ? err.message : "등록에 실패했어요."}`);
        }
      }

      if (registered > 0) await handleReplaysSaved();
      const parts: string[] = [];
      if (truncated) parts.push(`한 번에 최대 ${MAX_REPLAY_FILES}개까지만 등록돼 처음 ${MAX_REPLAY_FILES}개만 처리했어요.`);
      if (registered > 0) parts.push(`${registered}개 등록했어요.`);
      if (failed.length > 0) parts.push(`${failed.length}개는 등록하지 못했어요 — ${failed.join(" / ")}`);
      // 검토할 게 있으면 안내창 대신 검토창을 바로 연다 — 안내를 먼저 띄우면 확인을 누른
      // 뒤에야 검토창이 뜨는 두 단계가 되고, 그 사이에 무슨 일이 남았는지가 흐려진다.
      // 자동 등록분 안내는 검토창을 닫은 뒤로 미룬다(아래 onClose/onSaved).
      const notice = parts.length > 0
        ? { text: parts.join(" "), kind: failed.length > 0 ? "error" as const : "success" as const }
        : null;
      if (review.length > 0) {
        pendingNoticeRef.current = notice;
        setReviewDrafts(review);
      } else if (notice) {
        setReplayNotice(notice);
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
    ];
    // 정렬 기준은 time이 아니라 sortTime이다 — 너 나와만 표시용 시각과 꽂히는 자리가
    // 다르다(위 challengeSortMs). 나머지는 sortTime이 없어 time을 그대로 쓴다.
    return items.sort((a, b) => sortMsOf(b) - sortMsOf(a));
  }, [challenges, gameResults, rankShifts]);

  // 경기가 아직 더 남아 있으면(hasMore), 이미 불러온 가장 오래된 경기보다 더 과거의
  // 너나와/변동 카드는 보류한다 — 페이지가 이어질 때 시간순이 뒤섞여 보이지 않게.
  const visibleFeed = useMemo(() => {
    if (!hasMore || gameResults.length === 0) return feed;
    const oldest = Math.min(...gameResults.map((m) => gameResultItem(m).time));
    return feed.filter((item) => item.time >= oldest);
  }, [feed, hasMore, gameResults]);

  const suggestions = useMemo(() => activeMemberSearchTerms(members), [members]);
  const searchTerms = useMemo(() => splitSearchTerms(search), [search]);
  const matchedIds = useMemo(() => {
    if (searchTerms.length === 0) return undefined;
    const all = new Set<string>();
    members.forEach((m) => {
      if (searchTerms.some((t) => memberMatchesTerm(m, t))) all.add(m.id);
    });
    return all;
  }, [members, searchTerms]);

  // 슬롯 하나가 검색어와 맞는지 — 회원이면 닉네임/배틀태그/게임아이디, 아니면 rawName.
  const slotMatchesTerm = (slot: GameResultSlot, term: string): boolean => {
    const m = memberOf(slot.memberId);
    if (m && memberMatchesTerm(m, term)) return true;
    return !!slot.rawName && normalizeSearchText(slot.rawName).includes(term);
  };
  // 너 나와 참가자(도전자/아군/상대) 중 검색어와 맞는 사람이 있는지.
  const challengeMatchesTerm = (c: Challenge, term: string): boolean => {
    const names = [c.createdBy.nickname, ...c.ownMembers.map((m) => m.nickname), ...c.targets.map((t) => t.nickname)];
    if (names.some((n) => normalizeSearchText(n).includes(term))) return true;
    const ids = [c.createdBy.id, ...c.ownMembers.map((m) => m.memberId), ...c.targets.map((t) => t.memberId)];
    return ids.some((id) => { const m = memberOf(id); return !!m && memberMatchesTerm(m, term); });
  };

  // 필터 바에 적을 건수(요청: 무한스크롤이면 미리 전체 건수를 조회해서 써야 한다).
  //
  // 경기결과만 커서 페이지로 나눠 받고(나머지는 한 번에 다 받는다), 그 전체 건수는 서버가
  // 첫 페이지 응답에 담아 준다(GameResultPage.total) — 그래서 아무 필터도 안 걸렸을 때는
  // "서버가 센 경기 수 + 이미 다 받아 둔 너나와/순위변동 수"가 곧 진짜 전체 건수다.
  // 화면에 몇 장이 그려졌는지(filteredFeed.length)와 무관하게 처음부터 이 값을 보여준다.
  //
  // 필터(유형/검색)가 걸리면 이 값을 쓸 수 없다 — 걸러내기는 전부 이미 받아 둔 것들
  // 위에서만 이뤄지므로(서버에 같은 조건으로 세어 달라고 하지 않는다) 아직 안 받은
  // 페이지의 건수를 알 방법이 없다. 그때는 지금까지 받은 것 중 걸러진 수를 그대로 쓴다 —
  // 목록도 딱 그만큼만 보여주고 있으므로 화면과 숫자가 어긋나지는 않는다.
  const filterActiveForCount = kindFilter !== "all" || searchTerms.length > 0;
  const nonGameResultCount = useMemo(
    () => feed.filter((it) => it.kind !== "gameResult").length,
    [feed],
  );

  // 필터 판정 — filteredFeed와 아래 건수 계산이 같은 규칙을 쓰도록 함수로 빼 둔다.
  const passesFilter = useCallback(
    (item: ActivityItem): boolean => {
      if (kindFilter !== "all") {
        // 도전장(시간 확정이든 아니든)은 전부 너나와(call)로 본다(요청). 일정은 추후
        // 별도 아이템이 생기면 채워진다.
        const kind = item.kind === "gameResult" ? "gameResult"
          : item.kind === "rankingShift" ? "rankingShift"
          : "call";
        if (kind !== kindFilter) return false;
      }
      if (searchTerms.length > 0) {
        if (item.kind === "gameResult") {
          const slots = [...item.gameResult.team1, ...item.gameResult.team2];
          return searchTerms.every((term) => slots.some((slot) => slotMatchesTerm(slot, term)));
        }
        if (item.kind === "challenge") {
          return searchTerms.every((term) => challengeMatchesTerm(item.challenge, term));
        }
        // 좌우 두 칸(개인전·팀전)을 함께 훑는다 — 어느 칸에 걸리든 그 카드는 검색에 맞다.
        const names = item.shift.sections
          .flatMap((sec) => sec.shifts)
          .map((e) => normalizeSearchText(e.nickname));
        return searchTerms.every((term) => names.some((n) => n.includes(term)));
      }
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slotMatchesTerm/challengeMatchesTerm은 members로 충분히 표현됨
    [kindFilter, searchTerms, members],
  );
  const filteredFeed = useMemo<ActivityItem[]>(
    () => visibleFeed.filter(passesFilter),
    [visibleFeed, passesFilter],
  );
  // 필터가 걸린 상태의 경기 건수는 서버에 조용히 다시 물어 채운다(요청: "필터시 정확한
  // 건수도 필요해 조용히 비동기적으로 업데이트해줘"). 걸러내기는 이미 받아 둔 페이지
  // 위에서만 이뤄지므로 클라이언트 혼자서는 알 수가 없다 — 같은 조건(userQuery)으로 목록
  // 엔드포인트에 한 건만 달라고 해서 거기 실려 오는 total만 읽는다.
  //
  // 답이 오기 전에는 지금 보이는 수를 그대로 둔다(로딩 표시를 새로 만들지 않는다 — 숫자가
  // 잠깐 뒤에 조용히 커지는 편이 낫다). 실패해도 조용히 지나간다.
  // 너나와·순위변동은 처음에 통째로 받아 두므로 그쪽 걸러진 수는 이미 정확하다.
  const [filteredGameResultTotal, setFilteredGameResultTotal] = useState<number | null>(null);
  useEffect(() => {
    if (!filterActiveForCount) { setFilteredGameResultTotal(null); return; }
    // 게임결과가 아예 대상이 아닌 유형 필터는 물어볼 것도 없다.
    if (kindFilter === "call" || kindFilter === "rankingShift") { setFilteredGameResultTotal(0); return; }
    let alive = true;
    setFilteredGameResultTotal(null);
    // 검색어는 글자마다 바뀌므로 잠깐 묵혔다 보낸다 — 타자 한 번에 한 번씩 묻지 않게.
    const t = window.setTimeout(() => {
      api.countGameResults({
        userQuery: searchTerms.length > 0 ? search.trim() : undefined,
        // 여러 낱말을 모두 만족해야 한다 — 위 passesFilter의 every()와 같은 규칙이다.
        matchAllUsers: true,
      })
        .then((n) => { if (alive) setFilteredGameResultTotal(n); })
        .catch(() => { /* 조용히 실패 — 로드된 수를 그대로 보여준다 */ });
    }, 300);
    return () => { alive = false; window.clearTimeout(t); };
  }, [filterActiveForCount, kindFilter, search, searchTerms.length]);
  // 필터에 걸린 너나와·순위변동 수 — 이쪽은 전부 받아 뒀으므로 세면 곧 정확한 값이다.
  const filteredNonGameResultCount = useMemo(
    () => feed.filter((it) => it.kind !== "gameResult" && passesFilter(it)).length,
    [feed, passesFilter],
  );

  // 같은 세션(sessionDateOf — 새벽 경기는 전날에 붙는다)의 게임결과가 2개 이상 연속이면
  // 겹침 스택으로 묶는다(요청).
  /** 이 줄에 붙일 딱지 — 하루 안에 올라온 것은 NEW, 올라온 지는 지났는데 하루 안에
   *  달라진 것은 UPDATE, 그 밖은 없음(요청).
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
  const rowFlagOf = (it: DisplayItem): "new" | "update" | null => {
    const now = Date.now();
    const fresh = (ms: number) => now - ms >= 0 && now - ms <= NEW_WINDOW_MS;
    if (it.kind === "challenge") {
      if (fresh(serverMs(it.challenge.createdAt))) return "new";
      return fresh(serverMs(it.challenge.updatedAt)) ? "update" : null;
    }
    if (it.kind === "rankingShift") return fresh(serverMs(it.shift.createdAt)) ? "new" : null;
    if (it.kind === "gameResultPost") return it.items.some((x) => fresh(x.time)) ? "new" : null;
    return fresh(it.time) ? "new" : null;
  };

  /** 이 줄에 하루 안에 달린 댓글이 있나(요청) — NEW/UPDATE와 같은 24시간 창이다.
   *
   *  위 rowFlagOf와 나란히 서지만 세는 것이 다르다: 저건 그 건 자체가 새것이냐를 보고,
   *  이건 그 건에 새 말이 붙었느냐를 본다. 사흘 전 경기에 오늘 댓글이 달리면 줄 자체는
   *  아무 딱지도 없는데 볼 것은 생긴 상태라, 그 경우가 딱 이 딱지가 있어야 하는 자리다.
   *  게임결과 묶음은 그 안 어느 경기에 달렸든 줄에 붙인다 — 접힌 채로는 안이 안 보인다. */
  const hasNewCommentOf = (it: DisplayItem): boolean => {
    const now = Date.now();
    const fresh = (ms: number) => now - ms >= 0 && now - ms <= NEW_WINDOW_MS;
    if (it.kind === "challenge") return fresh(latestCommentMs("challenge", it.challenge.id));
    if (it.kind === "rankingShift") return fresh(latestCommentMs("rankingShift", it.shift.id));
    if (it.kind === "gameResultPost") {
      return it.items.some((x) => fresh(latestCommentMs("gameResult", x.gameResult.id)));
    }
    return fresh(latestCommentMs("gameResult", it.gameResult.id));
  };

  const displayFeed = useMemo<DisplayItem[]>(() => {
    const out: DisplayItem[] = [];
    let i = 0;
    while (i < filteredFeed.length) {
      const it = filteredFeed[i];
      if (it.kind === "gameResult") {
        const day = sessionDateOf(it);
        let j = i + 1;
        while (
          j < filteredFeed.length
          && filteredFeed[j].kind === "gameResult"
          && sessionDateOf(filteredFeed[j] as GameResultItem) === day
        ) j++;
        // 한 판짜리도 요약 카드로 낸다(요청) — 게임결과는 판 수와 상관없이 늘 "누가
        // 있었는지"부터 보여주고, 자세히 보기로 카드를 편다. 예전엔 2판 이상만 묶어서
        // 한 판일 때만 카드가 통째로 펼쳐진 채 나와 생김새가 갈렸다.
        out.push({ kind: "gameResultPost", time: it.time, date: day, items: filteredFeed.slice(i, j) as GameResultItem[] });
        i = j;
        continue;
      }
      out.push(it);
      i++;
    }
    return out;
  }, [filteredFeed]);

  /* 번호를 받아는 왔는데 한 줄도 못 붙는 경우 — 서버가 센 줄과 화면이 그린 줄의 열쇠가
     어긋났다는 뜻이라 원인이 전혀 다르다(양쪽 묶음 규칙이 갈라졌을 때 이렇게 된다).
     둘을 구분해 두지 않으면 "번호가 안 나온다" 하나로 보여 어디를 봐야 할지 알 수 없다. */
  useEffect(() => {
    if (rowNos.size === 0 || displayFeed.length === 0) return;
    if (displayFeed.some((it) => rowNos.has(rowKeyOf(it)))) return;
    console.error(
      "[활동] 서버가 준 줄 번호가 화면의 어느 줄과도 안 맞습니다 — 묶음 규칙이 갈라졌을 수 있어요.",
      { 서버열쇠: [...rowNos.keys()].slice(0, 5), 화면열쇠: displayFeed.slice(0, 5).map(rowKeyOf) },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowNos, displayFeed]);

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
       · 너 나와  — 누가 누구를 불렀나. 이름 사이 배지는 카드의 손 이모지 양옆 배지와
                    같은 값이다(challengeSideBadges) — 왼쪽이 부른 편, 오른쪽이 지목된 편.
       · 게임결과 — 몇 사람이 몇 판을 쳤나.
       · 랭크변동 — 몇 사람의 순위가 움직였나(개인전·팀전에 다 오른 사람은 한 번만 센다). */
  const rowDesc = (item: DisplayItem) => {
    if (item.kind === "challenge") {
      const c = item.challenge;
      const mine = [c.createdBy.nickname, ...c.ownMembers.map((m) => m.nickname)];
      const theirs = c.targets.map((t) => t.nickname);
      const status = challengeStatusInfo(c);
      /* 상태는 줄에 끼우지 않고 닉네임 우상단에 얹는다(요청: 제목의 NEW 배지처럼, 자리
         차지 없이). 흐름에 두면 그 폭만큼 이름 자리가 줄어 모바일에서 닉네임이 잘렸다.
         어느 쪽 닉네임에 붙일지는 '누구의 이야기인가'로 정한다 — 수락·거절·버림·만료는
         지목된 쪽이 한 일이니 오른쪽에, 부른 쪽이 거둬들인 취소만 왼쪽에 붙는다(요청).
         그 판단은 카드가 손 이모지 양옆 배지를 놓을 때 쓰는 것과 같은 함수다
         (challengeSideBadges) — 두 화면이 같은 걸 보고 같은 자리를 고르게. */
      const onCreatorSide = challengeSideBadges(c).left !== null;
      const badge = (
        <span className={cx("scr-activity-row-state", `scr-challenge-avatar-badge-${status.tone}`)}>
          {status.text}
        </span>
      );
      return (
        <>
          <span className="scr-activity-row-name">
            <span className="scr-activity-row-name-main">
              {nameNodes(mine)}{onCreatorSide && badge}
            </span>
          </span>
          <span className="scr-activity-row-arrow" aria-hidden>→</span>
          <span className="scr-activity-row-name">
            <span className="scr-activity-row-name-main">
              {nameNodes(theirs)}{!onCreatorSide && badge}
            </span>
          </span>
        </>
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
    const items = item.kind === "gameResultPost" ? item.items : [item];
    return (
      <span className="scr-activity-row-names">
        {namesWithRest(playersOf(items, memberOf))}
        <span className="scr-activity-row-sep">·</span>
        <span className="scr-activity-row-em">{items.length}</span>{"경기"}
      </span>
    );
  };

  /* 줄을 펼쳤을 때 그 아래에 들어가는 카드 한 장.
     너 나와·랭크 변동은 카드 머리를 감춘다(scr-activity-card-head-off) — 바로 위 줄이 이미
     같은 제목·시각을 말한다. 게임결과 묶음은 감추지 않는다: 그 안의 머리들은 줄이 한 번도
     말한 적 없는 경기별 시각·등록자와 삭제 메뉴를 쥐고 있다(지적: 목록에서 시각·등록자가
     사라지고 삭제 불가). 경기가 한 판뿐인 묶음도 마찬가지라, 카드가 몇 장인지로는 가를 수
     없어서 어느 쪽인지를 여기서 표시한다. */
  const renderCard = (item: DisplayItem) => (
    item.kind === "rankingShift" ? (
      <div
        className="scr-activity-card-stack-wrapper scr-activity-card-head-off"
        key={`rs-${item.shift.id}`}
      >
        <RankingShiftCard
          shift={item.shift}
          timeText={formatWhen(item.time, { clock: item.withClock })}
          dateLabel={dateLabelOf(item)}
          actions={<RankingShiftMenu shift={item.shift} />}
          highlightMemberIds={matchedIds}
          highlightTerms={searchTerms}
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
          dateLabel={dateLabelOf(item)}
          // 너 나와!는 "호출"이니 수화기 아이콘으로(요청) — 등록 메뉴·호출 버튼과 통일.
          icon={<Phone size={16} aria-hidden />}
          label="너 나와!"
          timeText={formatWhen(item.time, { clock: item.withClock })}
          // 시각·마감·일시수정은 전부 '언제'에 대한 것이라 제목 바로 옆에 함께 둔다(요청).
          headMeta={<>
            {/* 응답 마감 실시간 카운트다운 — 날짜 옆, 헤더와 같은 폰트 크기(요청). */}
            <ChallengeCountdown challenge={item.challenge} />
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
              onDeleted={(id) => setChallenges((prev) => prev.filter((c) => c.id !== id))}
              onChanged={(c) => setChallenges((prev) => prev.map((x) => (x.id === c.id ? c : x)))}
            />
          }
          comment={<ActivityCardComments targetType="challenge" targetId={item.challenge.id} />}
        >
          <ChallengeCard
            challenge={item.challenge}
            myId={user?.id}
            highlightMemberIds={matchedIds}
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
        highlightMemberIds={matchedIds}
        highlightTerms={searchTerms}
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
          highlightMemberIds={matchedIds}
          highlightTerms={searchTerms}
        />
      </div>
    )
  );

  return (
    <div className="scr-screen scr-activity-screen">
      <div className="scr-v2-toolbar">
        <div className="scr-v2-toolbar-title-row">
          <h1 className="scr-title scr-v2-toolbar-title">활동</h1>
        </div>
      </div>

      {/* 등록 진입점 — 리플레이 / 너 나와! / 일정(추후 개발). 탭바 좌상단에 플로팅하는
          동그란 유리 + 버튼(요청). 메뉴는 버튼 위로 펼쳐진다. */}
      {/* 숨김 클래스는 항상 붙이되 실제 적용은 CSS가 모바일 폭에서만 한다 — 이 버튼은
          PC에서도 뜨는데, 거기선 키보드가 화면을 가리지 않으므로 검색창에 포커스했다고
          사라지면 안 된다. */}
      <div className={cx(
        "scr-activity-add-fab-wrap scr-activity-add-wrap",
        fabHidden && "scr-activity-add-fab-wrap-hidden",
      )}>
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
        {addMenuOpen && (
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
              <button type="button" role="menuitem" disabled title="추후 제공">
                <CalendarPlus size={14} aria-hidden /> 일정 등록 <span className="scr-activity-add-soon">추후</span>
              </button>
            </div>
          </>
        )}
        <input
          ref={replayInputRef} type="file" accept=".rep" multiple hidden
          onChange={handleReplayFilesChosen}
        />
      </div>

      {/* 유형 드롭다운(요청: 분류 제거) + 유저 검색을 한 줄에(요청: 모바일도 한 줄) —
          검색바의 filterPanel로 넘겨 같은 인라인 스택에 나란히 둔다. */}
      <SearchFilterBar
        // 필터 바로 아래에 건수를 둔다(요청). 세는 건 걸러진 활동 하나하나(filteredFeed)이지
        // 화면에 보이는 카드 수(displayFeed)가 아니다 — 같은 날 게임결과를 한 장으로 묶는 건
        // 보여주는 방식일 뿐이라(지적) 그 묶음 안의 판도 각각 한 건이다.
        count={
          !filterActiveForCount
            ? (gameResultTotal !== null ? gameResultTotal + nonGameResultCount : filteredFeed.length)
            // 서버 답이 오기 전에는 지금 보이는 수를 그대로 둔다.
            : (filteredGameResultTotal !== null
              ? filteredGameResultTotal + filteredNonGameResultCount
              : filteredFeed.length)
        }
        // 필터 건수를 서버에 다시 묻는 동안에는 숫자 옆에 스피너를 둔다(요청) — 그 사이
        // 보이는 값은 아직 화면에 그려진 수라 곧 바뀔 수 있다는 표시다.
        countLoading={filterActiveForCount && filteredGameResultTotal === null}
        countLabel="건"
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="유저 검색"
        suggestions={suggestions}
        filterPanel={
          <FilterItem label="유형">
            {/* 필터 패널 표준 드롭다운(.scr-filter-select, global.css) — 통계 종족
                필터와 공유하는 공통 스타일(요청: 화면별 클래스 대신 표준화). */}
            <Select
              value={kindFilter}
              onChange={(v) => setKindFilter(v as typeof kindFilter)}
              size="sm"
              minDropWidth={120}
              className="scr-filter-select"
              options={[
                { value: "all", label: "전체" },
                { value: "gameResult", label: "게임결과" },
                { value: "call", label: "너 나와!" },
                { value: "schedule", label: "일정" },
                { value: "rankingShift", label: "랭크 변동" },
              ]}
            />
          </FilterItem>
        }
      />

      {error && <div className="scr-err">{error}</div>}

      {loading ? (
        <div className="scr-empty"><Spinner size={18} /></div>
      ) : displayFeed.length === 0 ? (
        <div className="scr-empty">아직 표시할 활동이 없어요.</div>
      ) : (
        (
          /* 목록 보기(요청) — 한 줄에 시각·제목·한 줄 요약만 두고, 누르면 그 줄 아래에
             원래 카드의 본문과 댓글이 그대로 열린다. 카드를 새로 만들지 않고 카드 보기와
             같은 renderCard를 부르는 이유는, 여기만 따로 만들면 카드 쪽 수정이 목록 쪽에
             반영되지 않아 두 화면이 서서히 어긋나기 때문이다. 머리(시각·제목)만 CSS로
             감춘다 — 바로 위 줄이 이미 같은 말을 하고 있다. */
          <div className="scr-activity-rows">
            {displayFeed.map((item) => {
              const key = rowKeyOf(item);
              const open = openRowKey === key;
              const closing = closingRowKey === key;
              const flag = rowFlagOf(item);
              const newComment = hasNewCommentOf(item);
              const no = rowNos.get(key);
              return (
                <div className={cx("scr-activity-row-wrap", open && "scr-activity-row-wrap-open")} key={key}>
                  <button
                    type="button" className="scr-activity-row" aria-expanded={open}
                    onClick={() => toggleRow(key)}
                  >
                    <span className="scr-activity-row-title">
                      <span className="scr-activity-row-title-main">
                        {/* 몇 번째 활동인가 — 제목 글자 바로 위, 왼쪽 끝을 맞춰 세운다
                            (요청: 좌상단, 대각선 아님). 흐름에서 빼 두므로 제목 자리는
                            번호가 있든 없든 그대로다. */}
                        {no !== undefined && <span className="scr-activity-row-no">#{no}</span>}
                        <span className="scr-activity-row-title-text">{rowTitleOf(item)}</span>
                      </span>
                      {/* 하루 안에 올라왔거나(NEW) 달라진(UPDATE) 건 — 색만으로 말하지
                          않도록 글자를 그대로 적는다. 배지는 안 줄고, 자리가 모자라면
                          제목이 줄어든다. */}
                      {flag && (
                        <span className={cx("scr-activity-row-flag", `scr-activity-row-flag-${flag}`)}>
                          {flag === "new" ? "NEW" : "UPDATE"}
                        </span>
                      )}
                      {/* 하루 안에 새 댓글이 붙은 건(요청) — 우하단이다. 위 세 딱지(번호·
                          NEW·UPDATE)와 한 줄에 못 선다: 제목 칸의 글자 자리는 62px인데
                          "#17"(16) + "UPDATE"(37)만으로 이미 57px을 쓴다(실측). 대신
                          제목 아래 칸 여백이 비어 있어 거기로 내렸다 — 번호가 좌상단,
                          NEW/UPDATE가 우상단, 이것이 우하단으로 세 모서리가 갈린다. */}
                      {newComment && <span className="scr-activity-row-flag-comment">NEW댓글</span>}
                    </span>
                    <span className="scr-activity-row-desc">{rowDesc(item)}</span>
                    {/* 얼마나 지났나(요청) — 하루까지는 "N분 전/N시간 전", 일주일까지는
                        "N일 전", 그보다 오래된 것만 날짜. 종류를 안 가리고 한 가지로 적는다
                        (예전에는 너 나와는 날짜만, 랭크 변동은 "12시간 전", 게임결과 묶음은
                        세션 날짜라 세 줄이 저마다 다른 말투였다). */}
                    <span className="scr-activity-row-time">{formatAgo(item.time)}</span>
                  </button>
                  {/* 게임결과는 요약(참가자 명단)을 건너뛰고 바로 경기 목록을 편다(요청) —
                      목록 줄이 이미 "n명 n경기"로 그 요약을 말했다. */}
                  {(open || closing) && (
                    <div className={cx("scr-activity-row-fold", open ? "scr-activity-row-fold-open" : "scr-activity-row-fold-closing")}>
                      <div className="scr-activity-row-body">{renderCard(item)}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* 스피너는 화면에 하나뿐이어야 한다 — 위 목록 자리의 것과 여기 '더 불러오는 중'이
          동시에 뜨면 로딩바가 두 개로 보인다(지적). 센티널도 목록이 그려진 뒤에만 둔다:
          없으면 관측할 것 자체가 없어 조기 loadMore가 원천적으로 안 생긴다. */}
      {!loading && loadingMore && <div className="scr-empty"><Spinner size={16} /></div>}
      {!loading && <div ref={sentinelRef} aria-hidden />}

      {challengeFormOpen && (
        <ChallengeFormModal
          onClose={() => setChallengeFormOpen(false)}
          onCreated={(c) => { upsertChallenge(c); setChallengeFormOpen(false); }}
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
