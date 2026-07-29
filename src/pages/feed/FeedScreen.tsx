import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import RankShiftCard, { RankShiftMenu } from "./RankShiftCard";
import { CalendarPlus, ClipboardList, MoreHorizontal, Phone, Plus, Upload } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import { Spinner } from "../../components/common/Feedback";
import SearchFilterBar from "../../components/common/SearchFilterBar";
import Select from "../../components/common/Select";
import FilterItem from "../../components/common/FilterItem";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import KakaoShareButton from "../../components/common/KakaoShareButton";
import type { KakaoShareContent } from "../../utils/kakaoShare";
import MatchList, { resolveSlotName, type SearchListRow } from "../v2/MatchList";
import { isComputerSlot } from "../../constants/computerSlot";
import { isUnregisteredSlot } from "../../constants/unregisteredSlot";
import { ChallengeCard, ChallengeTimeHeadEdit } from "../challenge/ChallengeScreen";
import FeedComments from "./FeedComments";
import ScrollNavTimeline from "../../components/common/ScrollNavTimeline";
import ReplayReviewModal from "../../modals/ReplayReviewModal";
import ChallengeFormModal from "../../modals/ChallengeFormModal";
import { scheduledInstantMs, shortYearPrefix } from "../../utils/date";
import { useAppStore } from "../../store/appStore";
import { isAdminRole } from "../../constants/roles";
import { activeMemberSearchTerms, memberMatchesTerm, normalizeSearchText, splitSearchTerms } from "../../utils/memberSearch";
import { cx } from "../../utils/format";
import { attachPopover } from "../../utils/popover";
import { api } from "../../api/client";
import { useCursorPagination } from "../../hooks/useCursorPagination";
import { useEditableFocused } from "../../hooks/useEditableFocused";
import { usePageBackground } from "../../hooks/usePageBackground";
import { getScrollMetrics, getScrollTop, scrollRootTo } from "../../utils/scrollRoot";
import { buildReplayDrafts, type ReplayDraft } from "../../utils/replayDraft";
import { hasAppUpdatePreloadErrorOccurred } from "../../utils/appUpdate";
import type { Challenge, FeedTargetType, Match, MatchSlot, MatchType, Member, RankSnapshot } from "../../types";

const PAGE_SIZE = 100;
const MAX_REPLAY_FILES = 20;

// 묶음 펼침/접힘에서 포스트 한 장이 나타나거나 사라지는 시간과, 포스트 사이의 시차.
// 공간(높이)이 다 열린 뒤에 포스트가 한 장씩 등장한다(요청) — 접을 땐 그 반대다.
// 아래쪽 접기로 닫을 때 접힌 카드를 화면 한가운데에 놓는다(요청) — 맨 위에 붙여 놓으면
// 방금 접은 카드가 헤더 바로 밑에 걸려 앞뒤 맥락이 안 보인다. 카드가 화면보다 크면
// 가운데로 못 놓으므로, 그때는 맨 위에서 이만큼만 띄운다(예전 동작).
const STACK_COLLAPSE_MARGIN = 12;
// 요약 ↔ 목록 교대 연출(요청: 페이드 아웃 → 높이 이동 → 한 번에 페이드 인).
// 페이드는 짧게, 높이는 그보다 길게 — 높이가 눈으로 따라가는 유일한 움직임이라 여기에
// 시간을 준다. 셋을 더해도 반 초 안쪽이라 두 번 누르는 흐름이 답답하지 않다.
const SWAP_FADE_MS = 130;
const SWAP_HEIGHT_MS = 260;
// 접힌 뒤 테두리를 밝혀 두는 시간(요청) — CSS의 scr-stack-collapsed-flash와 같은 값이어야
// 한다. 연출이 끝난 시점부터 세는데, 그 뒤에 부드러운 스크롤이 한 번 더 이어지므로
// 그것까지 지켜볼 만큼 길게 둔다(요청: 스크롤까지 있어서 2초).
const FLASH_MS = 2000;

// 피드 — 커뮤니티 활동(경기 결과, 너 나와! 일정)을 한 타임라인으로 보여주는 홈 화면.
// 타임라인 기준: 너 나와!는 경기 예정 일시, 경기는 리플레이의 게임 시작 시각.

const DOW_FULL = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

// 피드 시각 표기 — 다가오는 일정은 "오늘"/"이번주 토요일"/"다음주 화요일"(주 시작 = 월요일),
// 지난 일주일 안은 일자 대신 요일만("화요일 21:30"), 그 밖은 "M월 D일"(올해가 아니면
// "25년 3월 4일"처럼 두 자리 연도 포함). 요일 괄호 병기는 하지 않는다.
function formatEventTime(ms: number, withClock: boolean): string {
  const d = new Date(ms);
  const now = new Date();
  // 실제 시각이 있는(withClock) 최근 과거 이벤트는 상대 표기(요청): 1시간 이내면 "N분 전",
  // 24시간 이내면 "N시간 전"(분 생략). 날짜만 있는 경기(withClock=false)는 자정 기준이라
  // 상대표기가 어긋나므로 제외하고, 미래 일정(음수 diff)도 기존 절대 표기를 쓴다.
  if (withClock) {
    const diffMs = now.getTime() - ms;
    if (diffMs >= 0 && diffMs < 24 * 60 * 60 * 1000) {
      const mins = Math.floor(diffMs / 60000);
      if (mins < 1) return "방금 전";
      if (mins < 60) return `${mins}분 전`;
      return `${Math.floor(diffMs / (60 * 60 * 1000))}시간 전`;
    }
  }
  const time = withClock
    ? ` ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
    : "";
  const dayStart = (x: Date) => { const c = new Date(x); c.setHours(0, 0, 0, 0); return c.getTime(); };
  const diffDays = Math.round((dayStart(d) - dayStart(now)) / 86_400_000);
  if (diffDays === 0) return `오늘${time}`;
  if (diffDays > 0) {
    const weekStart = (x: Date) => dayStart(x) - ((x.getDay() + 6) % 7) * 86_400_000;
    const weekDiff = Math.round((weekStart(d) - weekStart(now)) / (7 * 86_400_000));
    if (weekDiff === 0) return `이번주 ${DOW_FULL[d.getDay()]}${time}`;
    if (weekDiff === 1) return `다음주 ${DOW_FULL[d.getDay()]}${time}`;
  } else if (diffDays > -7) {
    return `${DOW_FULL[d.getDay()]}${time}`;
  }
  // 올해가 아니면 두 자리 연도를 붙인다(요청: "전년도부터는 25년 이렇게") — 통계 제목의
  // 월 라벨과 같은 규칙(shortYearPrefix).
  return `${shortYearPrefix(d.getFullYear(), now)}${d.getMonth() + 1}월 ${d.getDate()}일${time}`;
}

interface ChallengeItem {
  kind: "challenge";
  time: number;
  withClock: boolean;
  /** 피드에서 꽂히는 자리 — 표시용 time과 다르다(challengeSortMs 주석 참고). */
  sortTime: number;
  challenge: Challenge;
}

export interface MatchItem {
  kind: "match";
  time: number;
  withClock: boolean;
  match: Match;
}

interface RankShiftFeedItem {
  kind: "rankshift";
  time: number;
  withClock: boolean;
  shift: RankSnapshot;
}

type FeedItem = ChallengeItem | MatchItem | RankShiftFeedItem;

// 같은 '세션'의 게임결과가 피드에서 2개 이상 연속되면 겹침 스택 하나로 묶는다.
export interface MatchStackItem {
  kind: "matchstack";
  time: number;
  /** 세션 날짜(YYYY-MM-DD) — 달력 날짜가 아니라 sessionDateOf 기준이다. */
  date: string;
  items: MatchItem[];
}

type DisplayItem = FeedItem | MatchStackItem;

/** 피드에서 이 항목이 꽂히는 자리(ms) — 너 나와만 표시용 시각과 다르다(challengeSortMs). */
function sortMsOf(it: FeedItem): number {
  return it.kind === "challenge" ? it.sortTime : it.time;
}

function rankShiftItem(shift: RankSnapshot): RankShiftFeedItem {
  return {
    kind: "rankshift",
    time: new Date(shift.createdAt).getTime(),
    withClock: true,
    shift,
  };
}

function challengeItem(c: Challenge): ChallengeItem {
  const iso = c.scheduledAt ?? c.createdAt;
  return {
    kind: "challenge",
    time: new Date(iso).getTime(),
    // 시각 개념이 없어졌다(요청: 너 나와는 날짜만) — 헤더는 늘 날짜만 적는다.
    withClock: false,
    sortTime: challengeSortMs(c),
    challenge: c,
  };
}

/** 아직 안 끝난(응답대기·성사) 너 나와인가 — 피드에서 "현재" 선보다 위(=앞으로 있을 일)에
 *  놓이는 것은 이것뿐이다. 경기결과·순위변동은 전부 이미 벌어진 일이다. */
export function isUpcomingChallenge(it: { kind: string; challenge?: Challenge }): boolean {
  return it.kind === "challenge"
    && (it.challenge!.status === "pending" || it.challenge!.status === "confirmed");
}

// 너 나와가 피드 어디에 꽂히나 — 표시용 시각(time)과 따로 계산한다.
//
//  · 아직 안 끝난 것(응답대기·성사)은 "현재" 선 바로 위에 둔다(지적: 아직 안 열린 너 나와가
//    현재보다 아래로 내려가면 안 된다). 약속한 날이 이미 지났어도 마찬가지다 — 결과가
//    안 들어온 이상 그건 여전히 남은 일이다. 예정일이 더 먼 것일수록 위로 간다.
//  · 끝난 것(완료·폐기)은 그날 경기들 아래로 내린다(요청: "전날 경기 목록과 당일 경기목록
//    사이"). 세션 날짜의 시작(오전 8시 — sessionDateOf의 경계와 같은 값)에 앉히면 그날
//    경기들(8시 이후)보다 아래, 전날 것들보다 위가 된다.
function challengeSortMs(c: Challenge): number {
  const base = new Date(c.scheduledAt ?? c.createdAt).getTime();
  if (c.status === "pending" || c.status === "confirmed") {
    // 그날 끝(23:59:59)을 기준으로 잡아 같은 날 경기들보다 위에 서게 하고, 이미 지난
    // 약속이면 "지금 바로 위"까지 끌어올린다.
    const endOfDay = c.scheduledDate
      ? new Date(`${c.scheduledDate}T23:59:59`).getTime()
      : base;
    return Math.max(endOfDay, Date.now() + 1);
  }
  if (!c.scheduledDate) return base;
  return new Date(`${c.scheduledDate}T00:00:00`).getTime() + SESSION_DAY_START_HOUR * 3600_000;
}

export function matchItem(m: Match): MatchItem {
  const started = m.gameStartedAt ? new Date(m.gameStartedAt).getTime() : null;
  return {
    kind: "match",
    time: started ?? new Date(`${m.date}T00:00:00`).getTime(),
    withClock: started != null,
    match: m,
  };
}

// 게임 한 판이 아니라 "한 자리에서 이어 한 묶음"이 스택의 단위다. 그런데 밤에 시작한
// 자리는 자정을 넘겨 이어지는 일이 흔해서, 달력 날짜로 끊으면 같은 자리가 두 스택으로
// 쪼개진다(요청: 연속된 게임결과는 날짜가 달라도 하나로). 새벽 경기는 전날 밤의 연장으로
// 보고 전날에 붙인다 — 경계는 오전 8시(요청).
const SESSION_DAY_START_HOUR = 8;
export function sessionDateOf(it: MatchItem): string {
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
  return <span className="scr-feed-chal-countdown">응답마감까지 {hh}:{mm}:{ss}</span>;
}

// 너 나와 포스트 우상단 케밥 — 카카오 공유(전체) + 삭제(운영자만).
function ChallengeActionsMenu({ challenge, isAdmin, onDeleted }: {
  challenge: Challenge;
  isAdmin: boolean;
  onDeleted: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const shareContent = () => {
    const matchup = `${challenge.ownMembers.map((m) => m.nickname).join(", ")} vs ${challenge.targets.map((t) => t.nickname).join(", ")}`;
    return {
      title: "너 나와!",
      description: matchup,
      imageUrl: `${window.location.origin}/images/challenge/challenge_share_thumb.jpg`,
      link: `${window.location.origin}/?sv=challenge&sid=${challenge.id}`,
      fallbackText: `[스타게이트] 너 나와!\n${matchup}`,
    };
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteChallenge(challenge.id);
      onDeleted(challenge.id);
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="scr-feed-chal-menu">
      <button
        type="button" className="scr-match-memo-btn scr-match-kebab-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="더보기" aria-haspopup="menu" aria-expanded={open}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <>
          {/* 백드롭 클릭은 '메뉴 닫기'에서 끝나야 한다(지적) — 안 끊으면 그 클릭이
              포스트 본체까지 올라가 펼침/접힘까지 같이 눌린다. */}
          <div
            className="scr-feed-add-backdrop"
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            aria-hidden
          />
          <div className="scr-menu-pop-drop scr-feed-chal-menu-drop" role="menu">
            <KakaoShareButton variant="menu" content={shareContent} onDone={() => setOpen(false)} />
            {isAdmin && (
              <button
                type="button" role="menuitem"
                className={cx("scr-menu-pop-opt", "scr-match-menu-opt-danger")}
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
          onConfirm={() => void remove()}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}

// 피드 카드 하단 공통 댓글 영역 — 목록은 항상, 입력창은 아이콘 옆에서 열리고 닫힌다.
function FeedCardComments({ targetType, targetId }: { targetType: FeedTargetType; targetId: number }) {
  return (
    // 댓글 영역의 클릭은 바깥으로 안 올린다 — 묶음 안에서는 목록 클릭이 '접기'라서(요청),
    // 댓글을 쓰려고 입력칸을 누른 것만으로 목록이 통째로 접혀 버린다.
    <div className="scr-feed-comments" onClick={(e) => e.stopPropagation()}>
      <FeedComments targetType={targetType} targetId={targetId} />
    </div>
  );
}

// 경기 카드 — 한 경기가 피드 카드 한 장. 기존 경기 로우(접힌 상태)를 카드 본문에 그대로
// 앉히고(누르면 그 자리에서 펼쳐짐), 하단에 피드 댓글을 단다.
// memo — 스택 개폐(setOpen)는 MatchStack만 다시 렌더하면 되는데, 그때마다 카드 전체
// (경기 로우·댓글·아바타 이미지)까지 다시 렌더되면서 iOS에서 기존 카드들이 깜빡였다
// (지적: "펼치기 접기 누를 때 기존 요소들도 다시 그리는 것 같아"). 개폐 때 카드 props는
// 전부 같은 참조라 memo가 전부 걸러낸다.
const MatchCard = memo(function MatchCard({ item, memberOf, onDeleted, dateLabel, highlightMemberIds, highlightTerms, nested = false }: {
  item: MatchItem;
  memberOf: (id: string) => Member | undefined;
  onDeleted: () => void;
  dateLabel: string;
  highlightMemberIds?: Set<string>;
  highlightTerms?: string[];
  // 묶음 카드 안에 들어갈 때 — 포스트 껍데기(배경·블러·꼬리여백)와 "게임결과" 제목을 벗고
  // 내용만 낸다. 겉보기로는 한 장의 카드 안에 경기들이 이어지는 모양이 된다(요청).
  nested?: boolean;
}) {
  const rows: SearchListRow[] = useMemo(() => {
    const m = item.match;
    return [{ id: m.id, date: m.date, team1: m.team1, team2: m.team2, result: m.result, raw: m }];
  }, [item.match]);

  return (
    <div className={nested ? "scr-feed-stack-item" : "scr-feed-card scr-post"}>
      <div className="scr-feed-card-head" data-date-label={dateLabel}>
        <div className="scr-feed-card-head-meta">
          <span className="scr-feed-card-time">{formatEventTime(item.time, item.withClock)}</span>
        </div>
        {/* 묶음 안에서는 카드 제목을 반복하지 않는다 — 바깥 카드가 이미 "게임결과 N건"이다. */}
        {!nested && (
          <div className="scr-feed-card-head-title">
            {/* 게임결과는 결과지 느낌의 아이콘으로(요청) — 칼은 너 나와!가 쓴다. */}
            <ClipboardList size={16} aria-hidden />
            <span className="scr-feed-card-label">게임결과</span>
          </div>
        )}
      </div>
      <div className="scr-feed-match-body">
        <MatchList rows={rows} memberOf={memberOf} onDeleted={onDeleted} loading={false} matchup highlightMemberIds={highlightMemberIds} highlightTerms={highlightTerms} />
      </div>
      <FeedCardComments targetType="match" targetId={item.match.id} />
    </div>
  );
});

// 묶음 카드 우상단 케밥 — 지금은 카카오톡 공유 하나만 담는다(묶음은 DB 행이 아니라
// 삭제/수정 개념이 없다). 경기결과 카드의 케밥(MatchList의 MatchActionsMenu)과 같은
// 방식으로 만든다 — 드롭다운을 body로 포털하고 자리는 attachPopover가 잡는다.
//
// 처음엔 순위변동 카드처럼 제자리에 그렸는데 세 가지가 어긋났다(지적: 다른 데를 눌러도
// 안 닫힘 / 모양이 다름 / 클릭이 잘 안 됨). 원인은 전부 "어디에 그리느냐"였다.
//  · 포스트 판(.scr-feed-card)에 backdrop-filter가 걸려 있어 그 안의 position:fixed는
//    화면이 아니라 그 카드를 기준으로 잡힌다 — 전체 화면을 덮어야 할 백드롭이 카드
//    안에만 깔려서, 카드 밖을 누르면 아무 일도 안 일어났다.
//  · 헤더(.scr-feed-card-head)는 isolation:isolate로 쌓임 맥락을 따로 만들고 글자
//    크기·자간·대문자 변환도 자기 것을 물려준다 — 그 안에 그린 메뉴는 뒤 요소에 덮이고
//    생김새도 다른 케밥과 달라진다.
// 그래서 버튼만 카드 직계 자식으로 옮기고, 백드롭·드롭다운은 body로 포털한다.
function StackMenu({ content }: { content: KakaoShareContent }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !dropRef.current) return;
    return attachPopover(anchorRef.current, dropRef.current, { growToContent: true, maxWidth: 200 });
  }, [open]);

  return (
    // 카드 어디를 눌러도 펼침/접힘이 되므로 이 안의 클릭은 위로 안 새게 막는다 —
    // 메뉴를 열자마자 카드가 같이 펼쳐지면 안 된다.
    <div
      className="scr-feed-chal-menu"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      role="presentation"
    >
      <button
        type="button" ref={anchorRef} className="scr-match-memo-btn scr-match-kebab-btn"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-label="더보기" aria-haspopup="menu" aria-expanded={open}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && createPortal(
        // 포털이라도 이벤트는 리액트 트리를 따라 올라간다 — 위 래퍼가 이미 끊지만,
        // 백드롭 쪽은 '닫기'까지 하고 끝내야 하므로 여기서도 명시적으로 끊는다.
        <>
          <div
            className="scr-feed-add-backdrop"
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            aria-hidden
          />
          <div
            className="scr-menu-pop-drop scr-match-menu-drop scr-scroll" ref={dropRef} role="menu"
            onClick={(e) => e.stopPropagation()}
          >
            <KakaoShareButton variant="menu" content={content} onDone={() => setOpen(false)} />
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

// 게임결과 묶음 — 접힘은 그 세션의 참가자 전원을 담은 '요약 포스트'이고, "자세히 보기"를
// 누르면 피드 안에서 그 자리가 게임결과 포스트 목록으로 바뀐다(요청). 한때 전체화면 모달로
// 열어봤지만 다시 이 아코디언으로 돌아왔다.
export function MatchStack({
  stack, memberOf, onDeleted, dateLabel, highlightMemberIds, highlightTerms, defaultOpen = false,
}: {
  stack: MatchStackItem;
  memberOf: (id: string) => Member | undefined;
  onDeleted: () => void;
  dateLabel: string;
  highlightMemberIds?: Set<string>;
  highlightTerms?: string[];
  /** 필터가 걸린 상태인가 — 그럴 땐 묶음을 펼친 채로 낸다(요청). */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // 아래 안내문("포스트를 눌러 …")이 지금 무슨 글자여야 하는가 — open을 그대로 쓰지 않고
  // 한 박자 늦춘다(요청: 연출 동안에는 글자를 안 보여주기). open을 그대로 쓰면 누르는
  // 순간 글자가 먼저 바뀌어, 카드는 아직 움직이는 중인데 안내문만 '이미 다 됐다'고 말한다.
  // 글자는 아래 연출의 페이드 아웃이 끝난 뒤(=안 보이는 사이)에 바꾼다.
  const [labelOpen, setLabelOpen] = useState(defaultOpen);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const labelTimerRef = useRef<number | null>(null);
  // 접기가 끝난 뒤 잠깐 테두리를 밝혀 어느 카드가 접힌 건지 짚어 준다(요청).
  const [flash, setFlash] = useState(false);
  const flashTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    if (labelTimerRef.current) window.clearTimeout(labelTimerRef.current);
  }, []);
  // 필터를 걸거나 풀면 그에 맞춰 다시 맞춘다(요청) — 걸러진 결과를 요약 뒤에 숨겨 두면
  // 이 카드가 왜 남았는지가 안 보인다. toggledRef를 건드리지 않으므로 연출 없이 상태만 바뀐다.
  useEffect(() => { setOpen(defaultOpen); }, [defaultOpen]);
  // 최신 게임이 위로 오게 — 펼친 목록은 피드와 같은 시간 순서(최신 → 과거)를 따른다.
  const orderedDesc = useMemo(() => [...stack.items].sort((a, b) => b.time - a.time), [stack.items]);
  // 요약에 나열할 참가자 — 이 세션의 모든 게임에 나온 사람을 중복 없이 모은다(요청).
  // 등장 순서(첫 게임 1팀부터)를 그대로 쓴다: 정렬 기준을 따로 두면 게임마다 순서가
  // 흔들려 "같은 날 같은 멤버"라는 인상이 깨진다.
  const participants = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; name: string }[] = [];
    for (const it of [...stack.items].sort((a, b) => a.time - b.time)) {
      for (const team of [it.match.team1, it.match.team2]) {
        for (const slot of team) {
          // 컴퓨터·비회원은 "누가 있었나"를 말하는 명단이 아니다(요청) — 빼고 센다.
          // 참여 인원 집계도 이 목록 길이를 쓰므로 함께 맞는다.
          if (isComputerSlot(slot.memberId) || isUnregisteredSlot(slot.memberId)) continue;
          if (seen.has(slot.memberId)) continue;
          seen.add(slot.memberId);
          out.push({ id: slot.memberId, name: resolveSlotName(slot, team, memberOf) });
        }
      }
    }
    return out;
  }, [stack.items, memberOf]);

  // 카카오톡 공유 내용(요청: 게임요약을 통째로 공유). 링크는 세션 날짜로 이 묶음을
  // 가리킨다(sv=stack&sd=…) — 묶음에는 DB id가 없다(SharePage의 ShareTarget 주석).
  const shareContent = useMemo(() => {
    const label = `${sessionDateLabel(stack.date)} 게임결과${stack.items.length > 1 ? ` ${stack.items.length}건` : ""}`;
    const roster = participants.map((p) => p.name).join(", ");
    return {
      title: `스타게이트 · ${label}`,
      description: `참가자 총 ${participants.length}명 — ${roster}`,
      link: `${window.location.origin}/?sv=stack&sd=${stack.date}`,
      fallbackText: `[스타게이트] ${label}\n참가자 총 ${participants.length}명 — ${roster}`,
    };
  }, [stack.date, stack.items.length, participants]);

  // 카드는 한 장이다(요청). 요약(참가자 명단)은 늘 보이고, 그 아래 목록 영역의 높이만
  // 0 ↔ 실제로 늘렸다 줄인다 — 카드 안에 카드가 있는 모양이지만 실제로는 한 장 안에서
  // 내용만 늘어나는 형태다. 스크롤은 한 번도 건드리지 않는다: 카드가 아래로만 자라므로
  // 위쪽 내용이 밀릴 일이 없고, 예전에 쓰던 스크롤 상쇄는 iOS 사파리에서 잔떨림만 남겼다.
  const stackRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // 요약 껍데기와, 요약↔목록이 자리를 주고받는 바깥 껍데기(높이가 이쪽에서 움직인다).
  const sumRef = useRef<HTMLDivElement>(null);
  const swapRef = useRef<HTMLDivElement>(null);
  // 토글 직전의 껍데기 높이 — 리액트가 DOM을 바꾼 뒤에는 잴 수 없어 누를 때 미리 담아 둔다.
  const heightRef = useRef<number | null>(null);
  // 토글로 열린 것인지(연출 O) 그냥 리렌더인지(연출 X) 구분하는 표시.
  const toggledRef = useRef(false);
  // 진행 중인 연출을 중단·원복하는 함수 — 재토글/언마운트 때 호출한다.
  const cancelRevealRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelRevealRef.current?.(), []);
  // 여닫기 연출이 끝난 뒤에 할 일(요청: 애니메이션이 끝나고 스크롤 이동) — 카드 높이가
  // 변하는 동안 스크롤까지 같이 움직이면 두 움직임이 겹쳐 어디를 보고 있는지 알기 어렵다.
  // 새 토글이 들어오면(toggleOpen) 예약은 그대로 버린다 — 그 스크롤은 이미 지난 의도다.
  const afterToggleRef = useRef<(() => void) | null>(null);
  const runAfterToggle = () => {
    const fn = afterToggleRef.current;
    afterToggleRef.current = null;
    fn?.();
  };
  const toggleOpen = (next: boolean) => {
    toggledRef.current = true;
    // 지금 높이를 재서 그 자리에 인라인으로 못 박아 둔다 — 리액트가 DOM을 바꾸는 순간
    // 껍데기의 자연 높이가 '들어오는 쪽'으로 확 바뀌는데, 그 값을 애니메이션의 backwards
    // fill에만 맡기면 브라우저/시점에 따라 한 프레임 튄다(지적: 누르면 순간 움직임).
    // 인라인 height는 아래 연출이 끝날 때 clearInline이 걷어낸다.
    const h = swapRef.current?.offsetHeight ?? null;
    heightRef.current = h;
    if (swapRef.current && h !== null) swapRef.current.style.height = `${h}px`;
    afterToggleRef.current = null;
    setOpen(next);
  };

  // 아래쪽 접기로 닫을 때는 접힌 카드로 스크롤해 준다(요청) — 그 버튼은 목록 맨 끝에 있어서,
  // 그냥 접으면 보고 있던 자리가 통째로 사라지고 한참 아래의 다른 포스트를 보게 된다.
  // 좌표는 연출이 끝난 뒤에 잰다: 접히는 도중에는 카드 높이가 계속 변한다.
  const collapseAndReveal = () => {
    toggleOpen(false);
    // toggleOpen이 예약을 비우므로 반드시 그 뒤에 건다(setOpen은 비동기라 연출 시작 전이다).
    afterToggleRef.current = () => {
      // 연출이 끝난 지금부터 센다 — 접히는 동안 켜 두면 그만큼 짧게 보인다.
      setFlash(true);
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => setFlash(false), FLASH_MS);
      const card = stackRef.current;
      if (!card) return;
      // 접힌 카드를 화면 한가운데에 놓는다(요청). 헤더는 position:relative라 같이 스크롤돼
      // 올라가므로 따로 빼줄 것이 없다 — 카드 위에 남길 여백을 그대로 더하면 된다.
      const r = card.getBoundingClientRect();
      const { clientHeight, scrollHeight } = getScrollMetrics();
      const vh = Math.max(clientHeight, window.innerHeight || 0);
      // 카드가 화면보다 크면 가운데 값이 음수가 되어 오히려 카드 위쪽이 잘린다 — 그때는
      // 예전처럼 맨 위에서 조금만 띄운다.
      const pad = Math.max(STACK_COLLAPSE_MARGIN, (vh - r.height) / 2);
      const top = getScrollTop() + r.top - pad;
      // 문서 끝쪽 카드는 아무리 밀어도 가운데까지 못 온다 — 갈 수 있는 데까지만 간다.
      scrollRootTo({ top: Math.min(Math.max(0, top), Math.max(0, scrollHeight - vh)), behavior: "smooth" });
    };
  };

  // 펼칠 때는 가운데가 아니라 목록 맨 위를 화면 맨 위에 붙인다(요청) — 펼친 직후 읽기
  // 시작하는 자리가 첫 경기이기 때문이다. 접기(가운데)와 다른 건 목적이 달라서다:
  // 접기는 '어느 카드가 접혔나'를 보여주는 것이고, 펼치기는 '이제 여기부터 읽어라'다.
  const expandAndReveal = () => {
    toggleOpen(true);
    afterToggleRef.current = () => {
      const list = listRef.current;
      if (!list) return;
      const { clientHeight, scrollHeight } = getScrollMetrics();
      const vh = Math.max(clientHeight, window.innerHeight || 0);
      const top = getScrollTop() + list.getBoundingClientRect().top - STACK_COLLAPSE_MARGIN;
      scrollRootTo({ top: Math.min(Math.max(0, top), Math.max(0, scrollHeight - vh)), behavior: "smooth" });
    };
  };

  useLayoutEffect(() => {
    const wasToggled = toggledRef.current;
    toggledRef.current = false;
    const swap = swapRef.current;
    const inner = stackRef.current?.querySelector<HTMLElement>(".scr-feed-stack-inner");
    const sum = sumRef.current;
    if (!swap || !inner || !sum) return;

    cancelRevealRef.current?.();
    const clearInline = () => {
      swap.style.height = "";
      sum.style.opacity = "";
      inner.style.opacity = "";
    };
    const cleanup = () => { clearInline(); cancelRevealRef.current = null; };
    // 안내문 글자 바꾸기 예약 — 연출이 중간에 끊기면(재토글/언마운트) 지금 상태로 맞춘다.
    const settleLabel = () => {
      if (labelTimerRef.current) window.clearTimeout(labelTimerRef.current);
      labelTimerRef.current = null;
      setLabelOpen(open);
    };

    // 첫 렌더나 리렌더는 연출 없이 상태만 맞춘다 — 스크롤하다 리렌더될 때마다 카드가
    // 다시 펼쳐지는 것처럼 보이면 안 된다. 기다릴 연출이 없으니 예약도 바로 실행한다.
    if (!wasToggled) { cleanup(); settleLabel(); heightRef.current = null; runAfterToggle(); return; }

    // 세 마디로 나눠 순서대로 간다(요청): 나가는 쪽이 사라지고 → 높이가 옮겨 가고 →
    // 들어오는 쪽이 한 번에 나타난다. 예전엔 셋을 동시에 굴리며 카드도 하나씩 어긋나게
    // 띄웠는데, 그러면 '높이를 서로 맞춰 주는' 계산이 늘 따라붙었다(요청: 그 로직 제거).
    //
    // 지금은 요약과 목록이 같은 껍데기(.scr-feed-stack-swap) 안에서 자리를 주고받는다 —
    // 비활성 쪽은 CSS가 절대배치로 흐름에서 빼므로, 껍데기의 자연 높이가 곧 '들어오는
    // 쪽의 높이'다. 그래서 맞출 게 없다.
    const from = heightRef.current;
    heightRef.current = null;
    const outgoing = open ? sum : inner;
    const incoming = open ? inner : sum;
    // 목표 높이는 '들어오는 쪽'의 높이를 직접 잰다 — 껍데기의 scrollHeight를 쓰면 안 된다.
    // 나가는 쪽은 절대배치라 흐름에서는 빠졌지만 여전히 껍데기 안에 있어서, 그쪽이 더
    // 크면 scrollHeight가 그 값을 돌려준다(접을 때 늘 그렇다). 그러면 from == to가 되어
    // 높이 애니메이션이 아예 안 걸리고, 카드가 줄지 않은 채 목록만 잘려 보였다(지적).
    const to = incoming.offsetHeight;
    const moves = from !== null && Math.abs(from - to) > 1;

    const anims: Animation[] = [];
    // 나가는 쪽 페이드 아웃. CSS는 이미 투명으로 바꿔 놨으므로 인라인으로 되돌려 시작한다.
    anims.push(outgoing.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: SWAP_FADE_MS, fill: "both", easing: "ease-in" },
    ));
    // 높이 이동. delay 동안은 fill:"both"가 시작값을 붙들어 줘서, 페이드 아웃이 끝날
    // 때까지 껍데기가 원래 높이 그대로 있는다.
    if (moves) {
      anims.push(swap.animate(
        [{ height: `${from}px` }, { height: `${to}px` }],
        { duration: SWAP_HEIGHT_MS, delay: SWAP_FADE_MS, fill: "both", easing: "ease-in-out" },
      ));
    }
    // 들어오는 쪽 페이드 인 — 카드 하나씩이 아니라 목록 통째로 한 번에(요청).
    anims.push(incoming.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      {
        duration: SWAP_FADE_MS,
        delay: SWAP_FADE_MS + (moves ? SWAP_HEIGHT_MS : 0),
        fill: "both", easing: "ease-out",
      },
    ));

    // 아래 안내문은 연출이 도는 동안 감춘다(요청) — 앞뒤로만 잠깐 보이고 가운데(높이가
    // 옮겨 가는 구간)에는 없다. 페이드 아웃/인을 따로 두 개 걸면 뒤에 건 쪽이 delay
    // 구간까지 backwards fill로 이겨 버려서(둘 다 opacity를 건드린다) 시작하자마자 툭
    // 사라진다 — 한 애니메이션 안에 네 지점을 offset으로 찍어 한 번에 굴린다.
    const total = SWAP_FADE_MS * 2 + (moves ? SWAP_HEIGHT_MS : 0);
    if (toggleRef.current) {
      anims.push(toggleRef.current.animate(
        [
          { opacity: 1, offset: 0 },
          { opacity: 0, offset: SWAP_FADE_MS / total },
          { opacity: 0, offset: (total - SWAP_FADE_MS) / total },
          { opacity: 1, offset: 1 },
        ],
        { duration: total, fill: "both", easing: "linear" },
      ));
    }
    // 글자 자체는 안 보이는 사이에 바꾼다(위 labelOpen 주석).
    if (labelTimerRef.current) window.clearTimeout(labelTimerRef.current);
    labelTimerRef.current = window.setTimeout(() => setLabelOpen(open), SWAP_FADE_MS);

    // 펼친 뒤 목록 맨 아래로 스크롤하던 것은 걷어냈다(요청) — 펼치기를 누른 자리에
    // 그대로 있는 편이 낫다. 접기는 collapseAndReveal이 예약해 둔 스크롤이 되돌려 주는데,
    // 그 실행은 연출이 끝난 지금이다(요청: 접을 때 애니메이션이 끝나고 스크롤 이동).
    Promise.all(anims.map((a) => a.finished))
      .then(() => { cleanup(); settleLabel(); runAfterToggle(); })
      .catch(() => {});
    cancelRevealRef.current = () => {
      anims.forEach((x) => { try { x.cancel(); } catch { /* 이미 끝남 */ } });
      cleanup();
      settleLabel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    // 포스트 한 장 — 요약도 경기 목록도 이 안에 있다(요청).
    <div
      ref={stackRef}
      className={cx(
        "scr-feed-card scr-post scr-feed-stack",
        open && "scr-feed-stack-opened",
        flash && "scr-feed-stack-flash",
      )}
    >
      <div className="scr-feed-card-head" data-date-label={dateLabel}>
        <div className="scr-feed-card-head-meta">
          <span className="scr-feed-card-time">{dateLabel}</span>
        </div>
        <div className="scr-feed-card-head-title">
          <ClipboardList size={16} aria-hidden />
          {/* 묶음이면 라벨 자체가 몇 건인지 말해준다(요청). 한 판이면 "1건"은 안 붙인다.
              참여 인원은 아래 요약의 세미타이틀 줄로 내렸다(요청) — 제목은 "이게 무슨
              포스트인가"만 말하고, 요약이 제 머리를 따로 갖는다. */}
          <span className="scr-feed-card-label">
            게임결과{stack.items.length > 1 ? ` ${stack.items.length}건` : ""}
          </span>
        </div>
      </div>
      {/* 묶음 통째로 카카오톡 공유(요청) — 링크를 열면 이 카드 한 장만 접힌 채 뜨고,
          눌러서 펼쳐 볼 수 있다(SharePage의 sv=stack). 다른 포스트와 똑같이 우상단
          케밥 안에 넣는다(요청). 헤더 '안'이 아니라 카드 직계 자식으로 두는 이유는
          StackMenu 주석 참고 — 헤더 안에 두면 안 닫히고 생김새도 달라진다. */}
      <StackMenu content={shareContent} />

      {/* 요약(세미타이틀 + 참가자 로스터)과 경기 목록이 이 껍데기 안에서 자리를 주고받는다.
          비활성 쪽은 CSS가 절대배치로 흐름에서 빼므로 껍데기의 자연 높이가 곧 지금 보이는
          쪽의 높이다 — 둘의 높이를 서로 맞춰 주는 계산이 필요 없다(요청).
          명단 어디를 눌러도 펼쳐진다. button 안에는 목록을 넣을 수 없어(phrasing content만
          허용) role로 대신한다. */}
      <div className="scr-feed-stack-swap" ref={swapRef}>
      <div className="scr-feed-stack-sum" ref={sumRef} aria-hidden={open}>
        <div
          className="scr-feed-stack-sum-body" role="button" tabIndex={open ? -1 : 0}
          aria-expanded={open}
          aria-label="게임결과 펼치기"
          onClick={() => expandAndReveal()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); expandAndReveal(); } }}
        >
          <div className="scr-feed-stack-sum-head">
            <span className="scr-feed-stack-sum-title">요약 정보</span>
            <span className="scr-feed-stack-sum-count">참가자 총 {participants.length}명</span>
          </div>
          <ul className="scr-feed-stack-sum-players">
            {participants.map((p) => (
              <li
                key={p.id}
                className={cx(
                  "scr-feed-stack-sum-player",
                  (highlightMemberIds?.has(p.id)
                    || highlightTerms?.some((t) => normalizeSearchText(p.name).includes(t)))
                    && "scr-feed-stack-sum-player-hl",
                )}
              >
                <Avatar member={{ id: p.id, nickname: p.name, avatar: memberOf(p.id)?.avatar ?? null }} size={20} />
                <span className="scr-feed-stack-sum-name">{p.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* 펼치면 이 자리가 목록 높이만큼 벌어지고 카드가 하나씩 나타난다(요청).
          예전에는 이 안 맨 위에도 '접기'가 하나 더 있었다(펼치기가 있던 자리) — 같은 일을
          하는 버튼이 위아래로 둘이라 오히려 헷갈려서 없앴다(요청). 접기는 목록 끝의
          버튼 하나가 맡는다. */}
      <div className="scr-feed-stack-inner" aria-hidden={!open}>
        {/* 펼쳐진 목록은 어디를 눌러도 접힌다(요청) — 경기 로우 자체는 이제 펼칠 것이
            없어서(스탯은 시트로 나갔다) 클릭이 남아돌기 때문이다. 그 안의 진짜 버튼들
            (스탯 보기·케밥·댓글·프로필)은 각자 stopPropagation으로 이 클릭을 막는다. */}
        <div
          className="scr-feed-stack-list" ref={listRef}
          onClick={() => { if (open) collapseAndReveal(); }}
        >
          {orderedDesc.map((it) => (
            <div key={it.match.id} className="scr-feed-stack-reveal">
              <MatchCard
                nested item={it} memberOf={memberOf} onDeleted={onDeleted} dateLabel={dateLabel}
                highlightMemberIds={highlightMemberIds} highlightTerms={highlightTerms}
              />
            </div>
          ))}
        </div>
      </div>
      </div>

      {/* 이 버튼은 이제 누르는 곳이라기보다 '어디를 눌러야 하는지' 알려 주는 안내문이다
          (요청) — 포스트 어디를 눌러도 펼침/접힘이 되므로, 방향 삼각형 대신 그 사실을
          글자로 말한다. 버튼으로 남겨 두는 건 키보드로도 여전히 여닫을 수 있게 하려는 것. */}
      <button
        ref={toggleRef}
        type="button" className="scr-feed-stack-toggle"
        onClick={() => (open ? collapseAndReveal() : expandAndReveal())} aria-expanded={open}
      >
        {labelOpen ? "포스트 눌러서 요약보기" : "포스트 눌러서 펼치기"}
      </button>
    </div>
  );
}

export default function FeedScreen() {
  // 화면 배경 사진 — 이제 PC 다크에서만 깐다(요청: 라이트는 통째로, 다크는 모바일만 제거).
  // 그래서 모바일용·라이트용 사진은 넘기지 않는다(usePageBackground 주석 참고).
  // 사진은 통계와 같은 것을 쓴다(원래 피드 배경이던 파일이 통계로 옮겨가며 이름만 stats_bg*가 됐다).
  usePageBackground("/images/bg/stats_bg.jpg");
  // 검색/필터(기록실과 동일 구성) — 유저 검색, 경기유형, 게임번호. 불러온 피드 안에서 즉시 필터.
  const [search, setSearch] = useState("");
  // 피드 유형 필터(요청: 분류(개인전/팀전) 제거하고 유형 드롭다운 추가). 게임결과/너나와/
  // 일정/랭크변동으로 거른다 — 너나와=시간 미확정 도전장, 일정=시간 확정 도전장.
  const [kindFilter, setKindFilter] = useState<"all" | "match" | "call" | "schedule" | "rankshift">("all");

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

  // 리플레이 등록 — 파일 선택 → 분석(buildReplayDrafts) → 검토 모달.
  const replayInputRef = useRef<HTMLInputElement>(null);
  const [parsingReplays, setParsingReplays] = useState(false);
  const [replayDrafts, setReplayDrafts] = useState<ReplayDraft[] | null>(null);
  const [replayTruncated, setReplayTruncated] = useState(false);

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

  // 카드의 카운트다운/마감 파생 상태를 1분마다 갱신한다.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  // 응답/결과입력/리벤지 등 카드 액션의 결과를 목록에 반영한다.
  const upsertChallenge = (updated: Challenge) => {
    setChallenges((prev) => {
      const base = updated.reappliedFromId != null
        ? prev.filter((c) => c.id !== updated.reappliedFromId)
        : prev;
      const exists = base.some((c) => c.id === updated.id);
      return exists ? base.map((c) => (c.id === updated.id ? updated : c)) : [updated, ...base];
    });
  };

  // 경기 전체 — 최신순 커서 페이지를 끝까지 이어붙여 한 번에 다 불러온다.
  const fetchPage = useCallback(
    (cursor: string | null) =>
      api.getMatchesPage({ cursor: cursor ?? undefined, limit: PAGE_SIZE, sort: "latest" }),
    [],
  );
  const {
    items: matches, loading: matchesLoading, loadingMore, hasMore, loadMore, reload,
    total: matchTotal,
  } = useCursorPagination(fetchPage, []);

  // 무한스크롤 — 목록 끝 센티널이 보이면 다음 페이지를 불러온다(전체 일괄 로드 대신).
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && hasMore && !matchesLoading && !loadingMore) {
        loadMore();
      }
    }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, matchesLoading, loadingMore, loadMore]);

  const loading = challengesLoading || matchesLoading;

  // 랭크(포인트/순위) 변동 이벤트 — 서버가 경기 등록/삭제 때마다 계산·저장한 스냅샷을
  // 그대로 읽는다(클라이언트는 더 이상 아무것도 계산하지 않는다).
  const [rankShifts, setRankShifts] = useState<RankSnapshot[]>([]);
  const reloadRankSnapshots = useCallback(() => {
    api.listRankSnapshots()
      .then(setRankShifts)
      .catch(() => {});
  }, []);
  useEffect(() => reloadRankSnapshots(), [reloadRankSnapshots]);

  // 저장/삭제 완료 — 경기 목록과 함께 변동 이벤트도 갱신한다(서버가 이미 저장을 끝냈다).
  const handleReplaysSaved = useCallback(async () => {
    reload();
    reloadRankSnapshots();
  }, [reload, reloadRankSnapshots]);
  const handleMatchDeleted = useCallback(() => {
    reload();
    reloadRankSnapshots();
  }, [reload, reloadRankSnapshots]);

  // 피드의 "상세" 버튼 — 통계 탭으로 이동하며 그 변동의 게임 유형을 필터로 미리 건다(요청).
  const requestScreen = useAppStore((s) => s.requestScreen);
  const setStatsPresetMatchType = useAppStore((s) => s.setStatsPresetMatchType);
  const openStatsFor = (matchType: MatchType) => {
    setStatsPresetMatchType(matchType);
    requestScreen("stats");
  };

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
    setReplayTruncated(truncated);
    setParsingReplays(true);
    try {
      const [drafts] = await Promise.all([
        buildReplayDrafts(batch, members),
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]);
      if (hasAppUpdatePreloadErrorOccurred()) return;
      setReplayDrafts(drafts);
    } finally {
      setParsingReplays(false);
    }
  };

  // 너 나와!와 경기를 하나의 타임라인으로 — 최근 이벤트가 위.
  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [
      ...challenges.map(challengeItem),
      ...matches.map(matchItem),
      ...rankShifts.map(rankShiftItem),
    ];
    // 정렬 기준은 time이 아니라 sortTime이다 — 너 나와만 표시용 시각과 꽂히는 자리가
    // 다르다(위 challengeSortMs). 나머지는 sortTime이 없어 time을 그대로 쓴다.
    return items.sort((a, b) => sortMsOf(b) - sortMsOf(a));
  }, [challenges, matches, rankShifts]);

  // 경기가 아직 더 남아 있으면(hasMore), 이미 불러온 가장 오래된 경기보다 더 과거의
  // 너나와/변동 카드는 보류한다 — 페이지가 이어질 때 시간순이 뒤섞여 보이지 않게.
  const visibleFeed = useMemo(() => {
    if (!hasMore || matches.length === 0) return feed;
    const oldest = Math.min(...matches.map((m) => matchItem(m).time));
    return feed.filter((item) => item.time >= oldest);
  }, [feed, hasMore, matches]);

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
  const slotMatchesTerm = (slot: MatchSlot, term: string): boolean => {
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
  // 첫 페이지 응답에 담아 준다(MatchPage.total) — 그래서 아무 필터도 안 걸렸을 때는
  // "서버가 센 경기 수 + 이미 다 받아 둔 너나와/순위변동 수"가 곧 진짜 전체 건수다.
  // 화면에 몇 장이 그려졌는지(filteredFeed.length)와 무관하게 처음부터 이 값을 보여준다.
  //
  // 필터(유형/검색)가 걸리면 이 값을 쓸 수 없다 — 걸러내기는 전부 이미 받아 둔 것들
  // 위에서만 이뤄지므로(서버에 같은 조건으로 세어 달라고 하지 않는다) 아직 안 받은
  // 페이지의 건수를 알 방법이 없다. 그때는 지금까지 받은 것 중 걸러진 수를 그대로 쓴다 —
  // 목록도 딱 그만큼만 보여주고 있으므로 화면과 숫자가 어긋나지는 않는다.
  const filterActiveForCount = kindFilter !== "all" || searchTerms.length > 0;
  const nonMatchCount = useMemo(
    () => feed.filter((it) => it.kind !== "match").length,
    [feed],
  );

  // 필터 판정 — filteredFeed와 아래 건수 계산이 같은 규칙을 쓰도록 함수로 빼 둔다.
  const passesFilter = useCallback(
    (item: FeedItem): boolean => {
      if (kindFilter !== "all") {
        // 도전장(시간 확정이든 아니든)은 전부 너나와(call)로 본다(요청). 일정은 추후
        // 별도 아이템이 생기면 채워진다.
        const kind = item.kind === "match" ? "match"
          : item.kind === "rankshift" ? "rankshift"
          : "call";
        if (kind !== kindFilter) return false;
      }
      if (searchTerms.length > 0) {
        if (item.kind === "match") {
          const slots = [...item.match.team1, ...item.match.team2];
          return searchTerms.every((term) => slots.some((slot) => slotMatchesTerm(slot, term)));
        }
        if (item.kind === "challenge") {
          return searchTerms.every((term) => challengeMatchesTerm(item.challenge, term));
        }
        return searchTerms.every((term) =>
          item.shift.shifts.some((e) => normalizeSearchText(e.nickname).includes(term)));
      }
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slotMatchesTerm/challengeMatchesTerm은 members로 충분히 표현됨
    [kindFilter, searchTerms, members],
  );
  const filteredFeed = useMemo<FeedItem[]>(
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
  const [filteredMatchTotal, setFilteredMatchTotal] = useState<number | null>(null);
  useEffect(() => {
    if (!filterActiveForCount) { setFilteredMatchTotal(null); return; }
    // 게임결과가 아예 대상이 아닌 유형 필터는 물어볼 것도 없다.
    if (kindFilter === "call" || kindFilter === "rankshift") { setFilteredMatchTotal(0); return; }
    let alive = true;
    setFilteredMatchTotal(null);
    // 검색어는 글자마다 바뀌므로 잠깐 묵혔다 보낸다 — 타자 한 번에 한 번씩 묻지 않게.
    const t = window.setTimeout(() => {
      api.countMatches({
        userQuery: searchTerms.length > 0 ? search.trim() : undefined,
        // 여러 낱말을 모두 만족해야 한다 — 위 passesFilter의 every()와 같은 규칙이다.
        matchAllUsers: true,
      })
        .then((n) => { if (alive) setFilteredMatchTotal(n); })
        .catch(() => { /* 조용히 실패 — 로드된 수를 그대로 보여준다 */ });
    }, 300);
    return () => { alive = false; window.clearTimeout(t); };
  }, [filterActiveForCount, kindFilter, search, searchTerms.length]);
  // 필터에 걸린 너나와·순위변동 수 — 이쪽은 전부 받아 뒀으므로 세면 곧 정확한 값이다.
  const filteredNonMatchCount = useMemo(
    () => feed.filter((it) => it.kind !== "match" && passesFilter(it)).length,
    [feed, passesFilter],
  );

  // 같은 세션(sessionDateOf — 새벽 경기는 전날에 붙는다)의 게임결과가 2개 이상 연속이면
  // 겹침 스택으로 묶는다(요청).
  const displayFeed = useMemo<DisplayItem[]>(() => {
    const out: DisplayItem[] = [];
    let i = 0;
    while (i < filteredFeed.length) {
      const it = filteredFeed[i];
      if (it.kind === "match") {
        const day = sessionDateOf(it);
        let j = i + 1;
        while (
          j < filteredFeed.length
          && filteredFeed[j].kind === "match"
          && sessionDateOf(filteredFeed[j] as MatchItem) === day
        ) j++;
        // 한 판짜리도 요약 카드로 낸다(요청) — 게임결과는 판 수와 상관없이 늘 "누가
        // 있었는지"부터 보여주고, 자세히 보기로 카드를 편다. 예전엔 2판 이상만 묶어서
        // 한 판일 때만 카드가 통째로 펼쳐진 채 나와 생김새가 갈렸다.
        out.push({ kind: "matchstack", time: it.time, date: day, items: filteredFeed.slice(i, j) as MatchItem[] });
        i = j;
        continue;
      }
      out.push(it);
      i++;
    }
    return out;
  }, [filteredFeed]);

  // 필터(유형/유저 검색)가 걸려 있나 — 걸려 있으면 게임결과 묶음을 펼친 채로 낸다(요청).
  // 걸러진 결과가 요약 뒤에 접혀 있으면 이 카드가 왜 남았는지 보이지 않는다.
  const filterActive = kindFilter !== "all" || searchTerms.length > 0;

  const dateLabelOf = (item: { time: number }) => {
    const d = new Date(item.time);
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  };

  // 피드 진입 시 오늘 날짜 아이템으로 스크롤(요청) — 없으면 가장 가까운 과거로. 피드는
  // 최신순(내림차순)이라 위에서부터 첫 "오늘 이하" 아이템이 곧 오늘(있으면) 또는 그 바로
  // 아래의 가장 가까운 과거다. 로딩이 끝나 목록이 처음 그려진 직후 딱 한 번만 한다.
  // "현재"(now) 경계 = 미래(위)와 오늘/과거(아래)가 갈리는 지점 = 위에서부터 첫 "오늘
  // 이하" 아이템. 그 위에 미래 아이템이 있을 때만(idx>0) 카드 사이에 "현재" 구분선을
  // 넣는다(요청). 진입 자동 스크롤도 이 지점으로 맞춘다.
  // "현재" 선은 아직 안 끝난 너 나와 바로 아래에 둔다(지적: 당일에 잡혔지만 아직 안 한
  // 너 나와가 현재선 아래로 내려가면 안 된다). 예전엔 날짜로 갈랐는데, 오늘 잡힌 너 나와는
  // 날짜가 '오늘'이라 이미 끝난 오늘 경기들과 같은 편으로 묶여 버렸다. 선 위쪽은 "앞으로
  // 있을 일", 아래쪽은 "이미 벌어진 일"이라는 뜻으로 통일한다.
  const nowIndex = useMemo(
    () => displayFeed.findIndex((it) => !isUpcomingChallenge(it)),
    [displayFeed],
  );
  const showNowDivider = nowIndex > 0;

  const feedListRef = useRef<HTMLDivElement>(null);
  const didInitialScrollRef = useRef(false);
  useEffect(() => {
    if (loading || didInitialScrollRef.current) return;
    const list = feedListRef.current;
    if (!list || displayFeed.length === 0) return;
    didInitialScrollRef.current = true;
    requestAnimationFrame(() => {
      // "현재" 구분선이 있으면 그 위에, 없으면 첫 오늘/과거 카드에 맞춘다. 구분선이 없을
      // 땐 DOM 자식 인덱스가 displayFeed 인덱스와 일치한다(구분선 미삽입).
      const marker = list.querySelector<HTMLElement>("[data-now-marker]");
      const idx = nowIndex >= 0 ? nowIndex : displayFeed.length - 1;
      const el = marker ?? (list.children[idx] as HTMLElement | undefined);
      if (!el) return;
      // "현재" 구분선이 화면 세로 가운데쯤 오게(요청 — 이전엔 헤더 바로 아래에 붙어
      // 미래 카드가 안 보였다). 가운데 오프셋만큼 위 미래 카드들이 함께 보인다.
      const r = el.getBoundingClientRect();
      const top = window.scrollY + r.top + r.height / 2 - window.innerHeight / 2;
      if (top > 1) window.scrollTo({ top, behavior: "instant" });
    });
  }, [loading, displayFeed, nowIndex]);

  return (
    <div className="scr-screen scr-feed-screen">
      <div className="scr-v2-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">피드</h1>
      </div>

      {/* 등록 진입점 — 리플레이 / 너 나와! / 일정(추후 개발). 탭바 좌상단에 플로팅하는
          동그란 유리 + 버튼(요청). 메뉴는 버튼 위로 펼쳐진다. */}
      {/* 숨김 클래스는 항상 붙이되 실제 적용은 CSS가 모바일 폭에서만 한다 — 이 버튼은
          PC에서도 뜨는데, 거기선 키보드가 화면을 가리지 않으므로 검색창에 포커스했다고
          사라지면 안 된다. */}
      <div className={cx(
        "scr-feed-add-fab-wrap scr-feed-add-wrap",
        fabHidden && "scr-feed-add-fab-wrap-hidden",
      )}>
        <button
          type="button"
          className="scr-feed-add-fab"
          onClick={() => setAddMenuOpen((v) => !v)}
          aria-expanded={addMenuOpen}
          aria-label="등록"
        >
          {parsingReplays ? <Spinner size={18} /> : <Plus size={24} />}
        </button>
        {addMenuOpen && (
          <>
            <div className="scr-feed-add-backdrop" onClick={() => setAddMenuOpen(false)} aria-hidden />
            <div className="scr-feed-add-menu scr-feed-add-menu-up" role="menu">
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
                <CalendarPlus size={14} aria-hidden /> 일정 등록 <span className="scr-feed-add-soon">추후</span>
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
            ? (matchTotal !== null ? matchTotal + nonMatchCount : filteredFeed.length)
            // 서버 답이 오기 전에는 지금 보이는 수를 그대로 둔다.
            : (filteredMatchTotal !== null
              ? filteredMatchTotal + filteredNonMatchCount
              : filteredFeed.length)
        }
        // 필터 건수를 서버에 다시 묻는 동안에는 숫자 옆에 스피너를 둔다(요청) — 그 사이
        // 보이는 값은 아직 화면에 그려진 수라 곧 바뀔 수 있다는 표시다.
        countLoading={filterActiveForCount && filteredMatchTotal === null}
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
                { value: "match", label: "게임결과" },
                { value: "call", label: "너 나와!" },
                { value: "schedule", label: "일정" },
                { value: "rankshift", label: "랭크 변동" },
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
        <div className="scr-feed-list" ref={feedListRef}>
          {displayFeed.flatMap((item, i) => {
            // 미래↔과거 경계(nowIndex)에 "현재" 구분선을 카드 사이에 끼운다(요청).
            const divider = showNowDivider && i === nowIndex ? (
              <div key="now-divider" className="scr-feed-now-divider" data-now-marker>
                <span>현재</span>
              </div>
            ) : null;
            const card = (
            item.kind === "rankshift" ? (
              <RankShiftCard
                key={`rs-${item.shift.id}`}
                shift={item.shift}
                timeText={formatEventTime(item.time, item.withClock)}
                dateLabel={dateLabelOf(item)}
                actions={<RankShiftMenu shift={item.shift} />}
                highlightMemberIds={matchedIds}
                highlightTerms={searchTerms}
                footer={
                  <>
                    <div className="scr-feed-rank-actions">
                      {/* 버튼 대신 텍스트 링크(요청) — 통계 탭으로 이동하며 그 변동의
                          게임 유형을 필터로 미리 건다. */}
                      <button type="button" className="scr-link-btn scr-feed-rank-link" onClick={() => openStatsFor(item.shift.matchType)}>
                        실시간 랭크 확인
                      </button>
                    </div>
                    {/* 순위변동 알림에도 댓글(요청) — 경기/너나와 카드와 같은 공통 댓글 영역. */}
                    <FeedCardComments targetType="rankshift" targetId={item.shift.id} />
                  </>
                }
              />
            ) : item.kind === "challenge" ? (
              <div className="scr-feed-card scr-post" key={`c-${item.challenge.id}`}>
                <div className="scr-feed-card-head" data-date-label={dateLabelOf(item)}>
                  {/* 시각·마감·일시수정은 전부 '언제'에 대한 것이라 제목 윗줄에 함께 둔다(요청). */}
                  <div className="scr-feed-card-head-meta">
                    <span className="scr-feed-card-time">{formatEventTime(item.time, item.withClock)}</span>
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
                  </div>
                  <div className="scr-feed-card-head-title">
                    {/* 너 나와!는 "호출"이니 수화기 아이콘으로(요청) — 등록 메뉴·호출 버튼과 통일. */}
                    <Phone size={16} aria-hidden />
                    <span className="scr-feed-card-label">너 나와!</span>
                  </div>
                </div>
                <ChallengeActionsMenu
                  challenge={item.challenge}
                  isAdmin={isAdmin}
                  onDeleted={(id) => setChallenges((prev) => prev.filter((c) => c.id !== id))}
                />
                <div className="scr-feed-card-body">
                  <ChallengeCard
                    challenge={item.challenge}
                    myId={user?.id}
                    highlightMemberIds={matchedIds}
                    onResponded={upsertChallenge}
                  />
                </div>
                <FeedCardComments targetType="challenge" targetId={item.challenge.id} />
              </div>
            ) : item.kind === "matchstack" ? (
              <MatchStack
                // 같은 세션이라도 중간에 다른 종류 카드가 끼면 스택이 둘로 갈린다 —
                // 날짜+시각만으로는 그 둘이 같은 키가 될 수 있어 첫 경기 id로 못박는다.
                key={`ms-${item.items[0].match.id}`}
                stack={item}
                memberOf={memberOf}
                onDeleted={handleMatchDeleted}
                dateLabel={sessionDateLabel(item.date)}
                highlightMemberIds={matchedIds}
                highlightTerms={searchTerms}
                defaultOpen={filterActive}
              />
            ) : (
              <MatchCard
                key={`m-${item.match.id}`}
                item={item}
                memberOf={memberOf}
                onDeleted={handleMatchDeleted}
                dateLabel={dateLabelOf(item)}
                highlightMemberIds={matchedIds}
                highlightTerms={searchTerms}
              />
            )
            );
            return divider ? [divider, card] : [card];
          })}
        </div>
      )}

      {loadingMore && <div className="scr-empty"><Spinner size={16} /></div>}
      <div ref={sentinelRef} aria-hidden />

      {/* 우측 스크롤 타임라인 — 피드는 최신순(위=최근, 아래=과거). 무한스크롤과 함께 쓰면
          타임라인은 "지금까지 불러온 범위"를 나타내고, 더 불러올수록 아래(과거)가 늘어난다. */}
      {!loading && displayFeed.length > 0 && (
        <ScrollNavTimeline
          headSelector=".scr-feed-card-head"
          topLabel="최근"
          bottomLabel="과거"
          /* 미래↔과거 경계("현재" 구분선) 눈금(요청) — 구분선이 없으면(전부 과거 등)
             groupFraction이 null을 돌려줘 눈금도 안 그려진다. */
          markers={[
            { key: "now", className: "scr-scroll-timeline-now", groupSelector: "[data-now-marker]" },
          ]}
        />
      )}

      {replayDrafts && (
        <ReplayReviewModal
          drafts={replayDrafts}
          truncated={replayTruncated}
          onClose={() => setReplayDrafts(null)}
          onSaved={handleReplaysSaved}
        />
      )}

      {challengeFormOpen && (
        <ChallengeFormModal
          onClose={() => setChallengeFormOpen(false)}
          onCreated={(c) => { upsertChallenge(c); setChallengeFormOpen(false); }}
        />
      )}

    </div>
  );
}
