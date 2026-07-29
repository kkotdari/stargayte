import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import RankShiftCard, { RankShiftMenu } from "./RankShiftCard";
import { CalendarPlus, ClipboardList, MoreHorizontal, Phone, Plus, Upload } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import { Spinner } from "../../components/common/Feedback";
import SearchFilterBar from "../../components/common/SearchFilterBar";
import Select from "../../components/common/Select";
import FilterItem from "../../components/common/FilterItem";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import KakaoShareButton from "../../components/common/KakaoShareButton";
import MatchList, { resolveSlotName, type SearchListRow } from "../v2/MatchList";
import { isComputerSlot } from "../../constants/computerSlot";
import { isUnregisteredSlot } from "../../constants/unregisteredSlot";
import { ChallengeCard, ChallengeTimeHeadEdit } from "../challenge/ChallengeScreen";
import FeedComments from "./FeedComments";
import ScrollNavTimeline from "../../components/common/ScrollNavTimeline";
import ReplayReviewModal from "../../modals/ReplayReviewModal";
import ChallengeFormModal from "../../modals/ChallengeFormModal";
import { scheduledInstantMs } from "../../utils/date";
import { useAppStore } from "../../store/appStore";
import { isAdminRole } from "../../constants/roles";
import { activeMemberSearchTerms, memberMatchesTerm, normalizeSearchText, splitSearchTerms } from "../../utils/memberSearch";
import { cx } from "../../utils/format";
import { api } from "../../api/client";
import { useCursorPagination } from "../../hooks/useCursorPagination";
import { useEditableFocused } from "../../hooks/useEditableFocused";
import { usePageBackground } from "../../hooks/usePageBackground";
import { getScrollTop, scrollRootTo } from "../../utils/scrollRoot";
import { buildReplayDrafts, type ReplayDraft } from "../../utils/replayDraft";
import { hasAppUpdatePreloadErrorOccurred } from "../../utils/appUpdate";
import type { Challenge, FeedTargetType, Match, MatchSlot, MatchType, Member, RankSnapshot } from "../../types";

const PAGE_SIZE = 100;
const MAX_REPLAY_FILES = 20;

// 묶음 펼침/접힘에서 포스트 한 장이 나타나거나 사라지는 시간과, 포스트 사이의 시차.
// 공간(높이)이 다 열린 뒤에 포스트가 한 장씩 등장한다(요청) — 접을 땐 그 반대다.
// 아래쪽 접기로 닫을 때 접힌 카드를 화면 맨 위에서 이만큼 띄워 놓는다.
const STACK_COLLAPSE_MARGIN = 12;
const CARD_FADE_MS = 150;
const CARD_STAGGER_MS = 45;

// 피드 — 커뮤니티 활동(경기 결과, 너 나와! 일정)을 한 타임라인으로 보여주는 홈 화면.
// 타임라인 기준: 너 나와!는 경기 예정 일시, 경기는 리플레이의 게임 시작 시각.

const DOW_FULL = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

// 피드 시각 표기 — 다가오는 일정은 "오늘"/"이번주 토요일"/"다음주 화요일"(주 시작 = 월요일),
// 지난 일주일 안은 일자 대신 요일만("화요일 21:30"), 그 밖은 "M월 D일"(올해가 아니면 년도
// 포함). 요일 괄호 병기는 하지 않는다.
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
  const year = d.getFullYear() !== now.getFullYear() ? `${d.getFullYear()}년 ` : "";
  return `${year}${d.getMonth() + 1}월 ${d.getDate()}일${time}`;
}

interface ChallengeItem {
  kind: "challenge";
  time: number;
  withClock: boolean;
  challenge: Challenge;
}

interface MatchItem {
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
interface MatchStackItem {
  kind: "matchstack";
  time: number;
  /** 세션 날짜(YYYY-MM-DD) — 달력 날짜가 아니라 sessionDateOf 기준이다. */
  date: string;
  items: MatchItem[];
}

type DisplayItem = FeedItem | MatchStackItem;

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
    withClock: c.scheduledTime != null,
    challenge: c,
  };
}

function matchItem(m: Match): MatchItem {
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
function sessionDateOf(it: MatchItem): string {
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
function sessionDateLabel(date: string): string {
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
          <div className="scr-feed-add-backdrop" onClick={() => setOpen(false)} aria-hidden />
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
    <div className="scr-feed-comments">
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

// 게임결과 묶음 — 접힘은 그 세션의 참가자 전원을 담은 '요약 포스트'이고, "자세히 보기"를
// 누르면 피드 안에서 그 자리가 게임결과 포스트 목록으로 바뀐다(요청). 한때 전체화면 모달로
// 열어봤지만 다시 이 아코디언으로 돌아왔다.
function MatchStack({
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

  // 카드는 한 장이다(요청). 요약(참가자 명단)은 늘 보이고, 그 아래 목록 영역의 높이만
  // 0 ↔ 실제로 늘렸다 줄인다 — 카드 안에 카드가 있는 모양이지만 실제로는 한 장 안에서
  // 내용만 늘어나는 형태다. 스크롤은 한 번도 건드리지 않는다: 카드가 아래로만 자라므로
  // 위쪽 내용이 밀릴 일이 없고, 예전에 쓰던 스크롤 상쇄는 iOS 사파리에서 잔떨림만 남겼다.
  const stackRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // 요약 껍데기 — 목록이 벌어지는 만큼 이쪽이 접힌다(요청: 펼치면 요약은 숨김).
  const sumRef = useRef<HTMLDivElement>(null);
  // 토글로 열린 것인지(연출 O) 그냥 리렌더인지(연출 X) 구분하는 표시.
  const toggledRef = useRef(false);
  // 진행 중인 연출을 중단·원복하는 함수 — 재토글/언마운트 때 호출한다.
  const cancelRevealRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelRevealRef.current?.(), []);
  // 접기 연출이 끝난 뒤에 할 일(요청: 접을 때 애니메이션이 끝나고 스크롤 이동) — 카드가
  // 줄어드는 동안 스크롤까지 같이 움직이면 두 움직임이 겹쳐 어디를 보고 있는지 알기 어렵다.
  // 새 토글이 들어오면(toggleOpen) 예약은 그대로 버린다 — 그 스크롤은 이미 지난 의도다.
  const afterCollapseRef = useRef<(() => void) | null>(null);
  const runAfterCollapse = () => {
    const fn = afterCollapseRef.current;
    afterCollapseRef.current = null;
    fn?.();
  };
  const toggleOpen = (next: boolean) => {
    toggledRef.current = true;
    afterCollapseRef.current = null;
    setOpen(next);
  };

  // 아래쪽 접기로 닫을 때는 접힌 카드로 스크롤해 준다(요청) — 그 버튼은 목록 맨 끝에 있어서,
  // 그냥 접으면 보고 있던 자리가 통째로 사라지고 한참 아래의 다른 포스트를 보게 된다.
  // 좌표는 연출이 끝난 뒤에 잰다: 접히는 도중에는 카드 높이가 계속 변한다.
  const collapseAndReveal = () => {
    toggleOpen(false);
    // toggleOpen이 예약을 비우므로 반드시 그 뒤에 건다(setOpen은 비동기라 연출 시작 전이다).
    afterCollapseRef.current = () => {
      const card = stackRef.current;
      if (!card) return;
      // 헤더는 position:relative라 같이 스크롤돼 올라간다 — 그 높이를 빼면 오히려 카드
      // 위쪽으로 한참 더 올라가버린다. 화면 맨 위에 딱 붙지만 않게 조금만 띄운다.
      const top = getScrollTop() + card.getBoundingClientRect().top - STACK_COLLAPSE_MARGIN;
      scrollRootTo({ top: Math.max(0, top), behavior: "smooth" });
    };
  };

  useLayoutEffect(() => {
    const wasToggled = toggledRef.current;
    toggledRef.current = false;
    const inner = stackRef.current?.querySelector<HTMLElement>(":scope > .scr-feed-stack-inner");
    const list = listRef.current;
    const sum = sumRef.current;
    if (!inner || !list) return;

    cancelRevealRef.current?.();
    const clearInline = () => {
      inner.style.height = "";
      inner.style.overflow = "";
      if (sum) { sum.style.height = ""; sum.style.opacity = ""; }
      list.querySelectorAll<HTMLElement>(":scope > .scr-feed-stack-reveal")
        .forEach((el) => { el.style.opacity = ""; el.style.transform = ""; });
    };
    const cleanup = () => { clearInline(); cancelRevealRef.current = null; };

    // 첫 렌더나 리렌더는 연출 없이 상태만 맞춘다 — 스크롤하다 리렌더될 때마다 카드가
    // 다시 펼쳐지는 것처럼 보이면 안 된다. 기다릴 연출이 없으니 예약도 바로 실행한다.
    if (!wasToggled) { cleanup(); runAfterCollapse(); return; }

    // 접히는 영역 전체를 잰다 — scrollHeight는 height가 0으로 눌려 있어도 내용 높이를
    // 그대로 준다.
    const target = inner.scrollHeight;
    const cards = [...list.querySelectorAll<HTMLElement>(":scope > .scr-feed-stack-reveal")];
    // 접힘 → 펼침은 위에서부터, 펼침 → 접힘은 아래에서부터 사라진다.
    const orderOf = (i: number) => (open ? i : cards.length - 1 - i);

    // 높이는 목록이 다 드러나는 데 걸리는 시간에 맞춰 함께 늘어난다 — 공간이 먼저 다
    // 벌어진 뒤 카드가 뒤늦게 나타나면 빈 칸이 한 박자 보인다.
    const span = CARD_FADE_MS + Math.max(0, cards.length - 1) * CARD_STAGGER_MS;
    inner.style.overflow = "hidden";
    const anims: Animation[] = [];
    anims.push(inner.animate(
      open ? [{ height: "0px" }, { height: `${target}px` }]
           : [{ height: `${target}px` }, { height: "0px" }],
      { duration: span, easing: open ? "ease-out" : "ease-in", fill: "both" },
    ));
    // 요약은 목록과 반대로 움직인다 — 목록이 벌어지는 동안 같은 시간에 걸쳐 접힌다.
    // 껍데기는 열림/닫힘 어느 쪽이든 overflow:hidden이라 scrollHeight가 늘 내용 높이다.
    if (sum) {
      const sumH = sum.scrollHeight;
      anims.push(sum.animate(
        open ? [{ height: `${sumH}px`, opacity: 1 }, { height: "0px", opacity: 0 }]
             : [{ height: "0px", opacity: 0 }, { height: `${sumH}px`, opacity: 1 }],
        { duration: span, easing: open ? "ease-in" : "ease-out", fill: "both" },
      ));
    }
    cards.forEach((el, i) => {
      const order = orderOf(i);
      anims.push(el.animate(
        open
          ? [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }]
          : [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(8px)" }],
        { duration: CARD_FADE_MS, delay: order * CARD_STAGGER_MS, fill: "both", easing: "ease-out" },
      ));
    });

    // 펼친 뒤 목록 맨 아래로 스크롤하던 것은 걷어냈다(요청) — 펼치기를 누른 자리에
    // 그대로 있는 편이 낫다. 접기는 collapseAndReveal이 예약해 둔 스크롤이 되돌려 주는데,
    // 그 실행은 연출이 끝난 지금이다(요청: 접을 때 애니메이션이 끝나고 스크롤 이동).
    Promise.all(anims.map((a) => a.finished))
      .then(() => { cleanup(); runAfterCollapse(); })
      .catch(() => {});
    cancelRevealRef.current = () => {
      anims.forEach((x) => { try { x.cancel(); } catch { /* 이미 끝남 */ } });
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    // 포스트 한 장 — 요약도 경기 목록도 이 안에 있다(요청).
    <div
      ref={stackRef}
      className={cx("scr-feed-card scr-post scr-feed-stack", open && "scr-feed-stack-opened")}
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

      {/* 요약 — 세미타이틀 한 줄과 참가자 로스터(요청). 펼치면 이 자리는 접히고 그 아래
          목록이 대신 온다(요청: 펼치면 요약부분은 숨기면서 목록 보여주기) — 그래서 높이를
          가진 껍데기와 내용물을 나눠 둔다(껍데기 height만 0↔실제로 오간다).
          명단 어디를 눌러도 펼쳐진다. button 안에는 목록을 넣을 수 없어(phrasing content만
          허용) role로 대신한다. */}
      <div className="scr-feed-stack-sum" ref={sumRef} aria-hidden={open}>
        <div
          className="scr-feed-stack-sum-body" role="button" tabIndex={open ? -1 : 0}
          aria-expanded={open}
          aria-label="게임결과 펼치기"
          onClick={() => toggleOpen(true)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleOpen(true); } }}
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
        <div className="scr-feed-stack-list" ref={listRef}>
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

      {/* 펼치기 ▽ / 접기 △ — 글자만으로는 어느 쪽으로 움직이는지 한눈에 안 들어와
          방향을 그대로 그린 삼각형을 옆에 붙인다(요청). */}
      <button
        type="button" className="scr-feed-stack-toggle"
        onClick={() => (open ? collapseAndReveal() : toggleOpen(true))} aria-expanded={open}
      >
        {open ? "접기" : "펼치기"}
        <svg className="scr-feed-stack-toggle-caret" width="9" height="6" viewBox="0 0 9 6" aria-hidden>
          <path d={open ? "M4.5 0 9 6H0z" : "M4.5 6 0 0h9z"} fill="currentColor" />
        </svg>
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
  const { items: matches, loading: matchesLoading, loadingMore, hasMore, loadMore, reload } =
    useCursorPagination(fetchPage, []);

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
    return items.sort((a, b) => b.time - a.time);
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

  // 필터 적용 — 유형/게임번호/유저 검색을 아이템 종류별로 건다(너나와에도 유저 필터 적용).
  const filteredFeed = useMemo<FeedItem[]>(() => {
    return visibleFeed.filter((item) => {
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
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slotMatchesTerm/challengeMatchesTerm은 members로 충분히 표현됨
  }, [visibleFeed, kindFilter, searchTerms, members]);

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
  const nowIndex = useMemo(() => {
    const dayStart = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const today = dayStart(Date.now());
    return displayFeed.findIndex((it) => dayStart(it.time) <= today);
  }, [displayFeed]);
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
        count={filteredFeed.length}
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
