import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import RankingShiftCard, { RankingShiftMenu } from "./RankingShiftCard";
import { CalendarPlus, ClipboardList, MoreHorizontal, Phone, Plus, Upload } from "lucide-react";
import Avatar from "../../components/common/Avatar";
import { Spinner } from "../../components/common/Feedback";
import SearchFilterBar from "../../components/common/SearchFilterBar";
import Select from "../../components/common/Select";
import FilterItem from "../../components/common/FilterItem";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import KakaoShareButton from "../../components/common/KakaoShareButton";
import { shareThumb, type KakaoShareContent } from "../../utils/kakaoShare";
import GameResultCardBody, { type SearchListRow } from "./GameResultCardBody";
import { FeedCard } from "./FeedCard";
import { resolveSlotName } from "./GameResultSides";
import { isComputerSlot } from "../../constants/computerSlot";
import { isUnregisteredSlot } from "../../constants/unregisteredSlot";
import { ChallengeCard, ChallengeTimeHeadEdit } from "../challenge/ChallengeScreen";
import FeedComments, { primeFeedComments } from "./FeedComments";
import { primeReplayMaps } from "../../hooks/useReplayMap";
import ScrollNavTimeline from "../../components/common/ScrollNavTimeline";
import ChallengeFormModal from "../../modals/ChallengeFormModal";
import { scheduledInstantMs, formatWhen } from "../../utils/date";
import { useAppStore } from "../../store/appStore";
import { isAdminRole } from "../../constants/roles";
import { activeMemberSearchTerms, memberMatchesTerm, normalizeSearchText, splitSearchTerms } from "../../utils/memberSearch";
import { cx } from "../../utils/format";
import { attachPopover } from "../../utils/popover";
import { api } from "../../api/client";
import { useCursorPagination } from "../../hooks/useCursorPagination";
import { useEditableFocused } from "../../hooks/useEditableFocused";
import { usePageBackground } from "../../hooks/usePageBackground";
import {
  getScrollMetrics, getScrollTop, scrollRootTo, suppressScrollHide,
} from "../../utils/scrollRoot";
import {
  buildReplayDrafts, resolveUnmatchedAsUnregistered, validateReplayDraft, type ReplayDraft,
} from "../../utils/replayDraft";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";
import { REPLAY_SUMMARY_VERSION } from "../../utils/replaySummaryData";
import { hasAppUpdatePreloadErrorOccurred } from "../../utils/appUpdate";
import type {
  Challenge, FeedTargetType, GameOutcome, GameResult, GameResultSlot, Member, NewGameResult, RankingShift,
} from "../../types";

const PAGE_SIZE = 100;
const MAX_REPLAY_FILES = 20;

/** 들어올 때 "현재" 구분선으로 옮겨 간 뒤, 탭바·헤더가 "아래로 스크롤했다"로 오해하지
 *  않게 막아 두는 시간. 예전에는 이 자리를 1.1초짜리 rAF 애니메이션으로 내려갔는데,
 *  그 동안 매 프레임 scrollTo를 부르는 통에 카드가 많은 피드에서는 눈에 띄게 버벅였다
 *  (지적: 스크롤 버벅임이 심하니 그냥 순간이동으로). 이제 한 번에 옮기므로 이 창은
 *  그 직후의 스크롤 이벤트 한두 번만 덮으면 된다. */
const NOW_SCROLL_MS = 300;

// 펼칠 때 목록 맨 위와 화면 맨 위 사이에 남길 여백(요청: "정확히 위에 맞추지 말고 위쪽
// 안전 여백을 줘야 해") — 딱 맞추면 첫 경기가 화면 모서리에 붙어 잘린 것처럼 보인다.
// 여기에 노치/상태바 높이(--safe-top)를 더해 쓴다: 홈 화면에 추가한 웹앱은 상태바
// 영역까지 그리므로, 스크롤 위치 0이 곧 노치 밑이 아니다.
const STACK_EXPAND_MARGIN = 24;

// --safe-top(노치/상태바 높이)의 실제 픽셀값. 이 값은 max()/env()로 적혀 있어
// getComputedStyle로 읽으면 계산 전 문자열이 그대로 나온다 — 실제로 그 값을 높이로 쓰는
// 요소를 잠깐 만들어 재는 것이 확실하다. 스크롤 한 번에 한 번만 부른다.
function safeTopPx(): number {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;top:0;left:0;width:0;visibility:hidden;pointer-events:none;height:var(--safe-top)";
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return Number.isFinite(h) ? h : 0;
}
// 요약 ↔ 목록 전환 — 높이를 재서 애니메이션하는 대신, 보일 쪽만 조건부로 마운트하고
// 각 카드가 개별적으로 살짝 아래에서 올라오며 페이드인한다(요청: "그냥 하나씩 순차적으로
// hidden을 제거하면 자연스럽게 스크롤이 늘어날거잖아 — 한번에 영역 확보하는거만 없애면
// 되는거지") — 래퍼가 몇 px로 커질지 계산할 필요 없이, 마운트된 만큼 문서가 자연히
// 자란다. 이 값은 그 등장 애니메이션 길이이자, 애니메이션이 끝난 뒤 스크롤을 옮기기까지
// 기다리는 시간이다.
const REVEAL_MS = 220;

// 피드 — 커뮤니티 활동(경기 결과, 너 나와! 일정)을 한 타임라인으로 보여주는 홈 화면.
// 타임라인 기준: 너 나와!는 경기 예정 일시, 경기는 리플레이의 게임 시작 시각.

interface ChallengeItem {
  kind: "challenge";
  time: number;
  withClock: boolean;
  /** 피드에서 꽂히는 자리 — 표시용 time과 다르다(challengeSortMs 주석 참고). */
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

type FeedItem = ChallengeItem | GameResultItem | RankingShiftItem;

// 같은 '세션'의 게임결과가 피드에서 2개 이상 연속되면 겹침 스택 하나로 묶는다.
export interface GameResultPostItem {
  kind: "gameResultPost";
  time: number;
  /** 세션 날짜(YYYY-MM-DD) — 달력 날짜가 아니라 sessionDateOf 기준이다. */
  date: string;
  items: GameResultItem[];
}

type DisplayItem = FeedItem | GameResultPostItem;

/** 피드에서 이 항목이 꽂히는 자리(ms) — 너 나와만 표시용 시각과 다르다(challengeSortMs). */
function sortMsOf(it: FeedItem): number {
  return it.kind === "challenge" ? it.sortTime : it.time;
}

function rankShiftItem(shift: RankingShift): RankingShiftItem {
  return {
    kind: "rankingShift",
    time: new Date(shift.createdAt).getTime(),
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

export function gameResultItem(m: GameResult): GameResultItem {
  const started = m.gameStartedAt ? new Date(m.gameStartedAt).getTime() : null;
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
  /* 취소는 부른 사람(또는 운영자)이, 아직 안 끝난 것만(요청: "호출자가 취소도 가능함").
     삭제와 달리 기록은 남고 폐기로만 넘어간다 — 피드에 "취소"로 남는다. */
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

  const cancel = async () => {
    setBusy(true);
    try {
      onChanged(await api.cancelChallenge(challenge.id));
    } finally {
      setBusy(false);
      setCancelOpen(false);
    }
  };

  return (
    <div className="scr-feed-chal-menu">
      <button
        type="button" className="scr-feed-post-menu-btn scr-feed-kebab-btn"
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
                className={cx("scr-menu-pop-opt", "scr-feed-post-menu-opt-danger")}
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
      {cancelOpen && (
        <ConfirmDialog
          title="너 나와! 취소"
          message="이 호출을 거둬들일까요? 피드에는 취소로 남아요."
          confirmLabel={busy ? "취소 중..." : "취소하기"}
          // 기본 취소 버튼도 "취소"라 한 창에 취소가 둘이 된다 — 물러나는 쪽은 "그냥 둘래요"로.
          cancelLabel="그냥 둘래요"
          onConfirm={() => void cancel()}
          onCancel={() => setCancelOpen(false)}
        />
      )}
    </div>
  );
}

// 피드 카드 하단 공통 댓글 영역 — 목록은 항상, 입력창은 아이콘 옆에서 열리고 닫힌다.
// 래퍼(.scr-feed-card-comment)는 FeedCard가 낸다 — 댓글이 있는 타입만 이 컴포넌트를
// comment 슬롯에 넘긴다.
function FeedCardComments({ targetType, targetId }: { targetType: FeedTargetType; targetId: number }) {
  return <FeedComments targetType={targetType} targetId={targetId} />;
}

// 경기 카드 — 한 경기가 피드 카드 한 장. 기존 경기 로우(접힌 상태)를 카드 본문에 그대로
// 앉히고(누르면 그 자리에서 펼쳐짐), 하단에 피드 댓글을 단다.
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
    <FeedCard
      className={className}
      dateLabel={dateLabel}
      icon={<ClipboardList size={16} aria-hidden />}
      label="게임결과"
      timeText={formatWhen(item.time, { clock: item.withClock })}
      headMeta={item.gameResult.createdBy && (
        <span className="scr-feed-card-by">{item.gameResult.createdBy.nickname} 등록</span>
      )}
      bodyClassName="scr-feed-game-result-body"
      comment={<FeedCardComments targetType="gameResult" targetId={item.gameResult.id} />}
    >
      <GameResultCardBody rows={rows} memberOf={memberOf} onDeleted={onDeleted} highlightMemberIds={highlightMemberIds} highlightTerms={highlightTerms} active={active} />
    </FeedCard>
  );
});

// 묶음 카드 우상단 케밥 — 지금은 카카오톡 공유 하나만 담는다(묶음은 DB 행이 아니라
// 삭제/수정 개념이 없다). 경기결과 카드의 케밥(GameResultCardBody의 GameResultActionsMenu)과 같은
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
        type="button" ref={anchorRef} className="scr-feed-post-menu-btn scr-feed-kebab-btn"
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
            className="scr-menu-pop-drop scr-feed-post-menu-drop scr-scroll" ref={dropRef} role="menu"
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
export function GameResultPost({
  stack, memberOf, onDeleted, dateLabel, highlightMemberIds, highlightTerms, defaultOpen = false,
  expanded, onExpand,
}: {
  stack: GameResultPostItem;
  memberOf: (id: string) => Member | undefined;
  onDeleted: () => void;
  dateLabel: string;
  highlightMemberIds?: Set<string>;
  highlightTerms?: string[];
  /** 필터가 걸린 상태인가 — 그럴 땐 묶음을 펼친 채로 낸다(요청). */
  defaultOpen?: boolean;
  /** 이 묶음이 지금 펼쳐져 있어야 하는가 — FeedScreen이 전역으로 하나만 관리한다
   *  (요청: "다른 포스트를 펴면 나머지는 자동으로 접힘"). 생략하면(SharePage의 단독
   *  공유 화면처럼 이 묶음 하나뿐인 곳) 로컬 상태로 스스로 관리한다. */
  expanded?: boolean;
  /** 펼치기를 눌렀을 때 FeedScreen에 알린다 — 이 값이 다른 묶음의 키로 바뀌면 그
   *  묶음은 저절로 접힌다. */
  onExpand?: () => void;
}) {
  // 아무도 안 넘겨주면(SharePage처럼 묶음이 하나뿐이라 다른 묶음과 자리를 다툴 일이
  // 없는 곳) 로컬 상태로 대신한다.
  const [localExpanded, setLocalExpanded] = useState(false);
  const isExpanded = expanded ?? localExpanded;
  // 실제 열림 상태 — 필터가 강제로 펼치거나(defaultOpen), 이 묶음이 선택돼 있으면
  // (isExpanded) 열린다. 수동으로 접는 길은 없다(요청: "포스트 눌러서 요약보기 제거
  // 이제 한번 펴면 못접음") — 다른 묶음을 펼치면 여기는 꺼지며 저절로 접힌다.
  const open = defaultOpen || isExpanded;
  // 최신 게임이 위로 오게 — 펼친 목록은 피드와 같은 시간 순서(최신 → 과거)를 따른다.
  const orderedDesc = useMemo(() => [...stack.items].sort((a, b) => b.time - a.time), [stack.items]);
  // 요약에 나열할 참가자 — 이 세션의 모든 게임에 나온 사람을 중복 없이 모은다(요청).
  // 순서는 이 묶음 안에서의 게임수 많은 순 → 승리 많은 순 → 닉네임순(요청). 한때는
  // 등장 순서를 그대로 썼는데, 그러면 그날 제일 많이 친 사람이 명단 끝에 가 있기도 했다.
  // 3열 그리드가 행 우선으로 채우므로(grid-auto-flow: row) 읽는 순서도 1 2 3 / 4 5 6이다.
  const participants = useMemo(() => {
    const acc = new Map<string, { id: string; name: string; plays: number; wins: number }>();
    for (const it of [...stack.items].sort((a, b) => a.time - b.time)) {
      const m = it.gameResult;
      for (const side of ["team1", "team2"] as const) {
        for (const slot of m[side]) {
          // 컴퓨터·비회원은 "누가 있었나"를 말하는 명단이 아니다(요청) — 빼고 센다.
          // 참여 인원 집계도 이 목록 길이를 쓰므로 함께 맞는다.
          if (isComputerSlot(slot.memberId) || isUnregisteredSlot(slot.memberId)) continue;
          const cur = acc.get(slot.memberId)
            ?? { id: slot.memberId, name: resolveSlotName(slot, m[side], memberOf), plays: 0, wins: 0 };
          cur.plays += 1;
          if (m.result === side) cur.wins += 1;
          acc.set(slot.memberId, cur);
        }
      }
    }
    return [...acc.values()].sort((a, b) => (
      b.plays - a.plays || b.wins - a.wins || a.name.localeCompare(b.name, "ko")
    ));
  }, [stack.items, memberOf]);

  // 카카오톡 공유 내용(요청: 게임요약을 통째로 공유). 링크는 세션 날짜로 이 묶음을
  // 가리킨다(sv=stack&sd=…) — 묶음에는 DB id가 없다(SharePage의 ShareTarget 주석).
  const shareContent = useMemo(() => {
    const label = `${sessionDateLabel(stack.date)} 게임결과 ${stack.items.length}건`;
    const roster = participants.map((p) => p.name).join(", ");
    return {
      title: `스타게이트 · ${label}`,
      description: `참가자 총 ${participants.length}명 — ${roster}`,
      ...shareThumb("gameResultList"),
      link: `${window.location.origin}/?sv=stack&sd=${stack.date}`,
      fallbackText: `[스타게이트] ${label}\n참가자 총 ${participants.length}명 — ${roster}`,
    };
  }, [stack.date, stack.items.length, participants]);

  // 카드는 한 장이다(요청). 접히면 요약 포스트 하나, 펼치면 게임결과 포스트 N개가 이
  // 래퍼 안에 조건부로 마운트된다 — 높이를 재서 애니메이션하지 않는다(요청: "왜 높이
  // 합산을 해야 하는거야? 하나씩 순차적으로 hidden을 제거하면 자연스럽게 스크롤이
  // 늘어날거잖아 — 한번에 영역 확보하는거만 없애면 되는거지"). 보일 쪽만 렌더하고, 각
  // 카드가 개별적으로 등장 애니메이션(아래 .scr-feed-card-stack-reveal)으로 나타나면,
  // 래퍼의 높이는 마운트된 만큼 문서가 자연히 자라는 것뿐이다 — JS가 계산할 게 없다.
  const stackRef = useRef<HTMLDivElement>(null);
  // 펼치기가 실제 사용자 조작이었는지 — 필터 동기화나 다른 묶음이 펼쳐지며 자동으로
  // 접히는 간접 변경(위 open 계산)에는 스크롤을 옮기지 않는다.
  const toggledRef = useRef(false);
  // 펼침 연출이 끝난 뒤에 할 일(요청: 애니메이션이 끝나고 스크롤 이동) — 카드가 나타나는
  // 동안 스크롤까지 같이 움직이면 두 움직임이 겹쳐 어디를 보고 있는지 알기 어렵다.
  const afterToggleRef = useRef<(() => void) | null>(null);
  const runAfterToggle = () => {
    const fn = afterToggleRef.current;
    afterToggleRef.current = null;
    fn?.();
  };

  // 펼칠 때는 목록 맨 위를 화면 위쪽에 둔다(요청) — 펼친 직후 읽기 시작하는 자리가 첫
  // 경기이기 때문이다. 화면 맨 위에 딱 붙이지는 않는다(요청) — 노치/상태바 높이에
  // 여백을 더해 띄운다. 수동으로 접는 길은 없으므로(요청) 접을 때 쓰던 스크롤·강조
  // 표시(flash)는 이제 필요 없다 — 다른 묶음을 펼치면 여기는 그냥 조용히 접힌다.
  const expandAndReveal = () => {
    toggledRef.current = true;
    afterToggleRef.current = () => {
      // 목록이 아니라 포스트 카드 전체를 기준으로 잡는다. 목록에 맞추면 그 위에 있는
      // 카드 머리(시각·제목·케밥)만큼이 화면 위로 밀려 나가는데, 그 높이가 딱 상단
      // 안전영역쯤이라 머리가 노치/상태바 밑에 깔렸다(지적: 펼칠 때 위 안전영역).
      // 실측: 목록 기준일 때 카드 머리가 화면 위 24px — 안전영역(47px) 안이었다.
      const card = stackRef.current;
      if (!card) return;
      const { clientHeight, scrollHeight } = getScrollMetrics();
      const vh = Math.max(clientHeight, window.innerHeight || 0);
      const top = getScrollTop() + card.getBoundingClientRect().top - (safeTopPx() + STACK_EXPAND_MARGIN);
      scrollRootTo({ top: Math.min(Math.max(0, top), Math.max(0, scrollHeight - vh)), behavior: "smooth" });
    };
    if (onExpand) onExpand(); else setLocalExpanded(true);
  };

  // 카드가 개별적으로 나타나는 등장 애니메이션이 끝난 뒤에 스크롤을 옮긴다 — 실제 펼치기
  // (사용자가 눌렀을 때)일 때만, 필터 동기화나 다른 묶음이 펼쳐지며 자동으로 접히는
  // 간접 변경은 스크롤을 건드리지 않는다.
  useEffect(() => {
    const wasToggled = toggledRef.current;
    toggledRef.current = false;
    if (!wasToggled) { afterToggleRef.current = null; return; }
    const t = window.setTimeout(runAfterToggle, REVEAL_MS);
    // 다른 묶음이 펼쳐져 이 효과가 다시 돌기 전에 언마운트되면 예약을 버린다 — 그
    // 스크롤은 이미 지난 의도다.
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    // 래퍼 한 장 — 접히면 요약 포스트 1개, 펼치면 게임결과 포스트 N개를 담는다(요청:
    // "포스트가 여러 개인 걸로"). 래퍼 자신은 헤더·글래스가 없는 순수 레이아웃이라 다른
    // 타입의 래퍼와 CSS가 똑같다(요청: "다른 카드들과 css가 다르게 분기되고 있어").
    <div ref={stackRef} className="scr-feed-card-stack-wrapper">
      {open ? (
        // 펼치면 이 자리에 승격된 포스트가 하나씩 나타난다(요청: 게임결과 카드도 하나의
        // 피드 포스트로 승격) — 각 포스트가 실제 댓글 입력창을 갖게 되므로, 예전의
        // "목록 아무 데나 눌러 접기"는 없앴다(요청) — 접기는 아래 전용 버튼으로만 한다.
        orderedDesc.map((it) => (
          <GameResultCard
            key={it.gameResult.id}
            item={it} memberOf={memberOf} onDeleted={onDeleted} dateLabel={dateLabel}
            highlightMemberIds={highlightMemberIds} highlightTerms={highlightTerms}
            className="scr-feed-card-stack-reveal"
          />
        ))
      ) : (
        // 요약 쪽에 헤더("게임결과 N건"+케밥)까지 통째로 담아 두므로, 펼치면 이 카드
        // 자체가 언마운트되면서 헤더도 함께 사라진다(요청: 펼치면 공유 헤더는 접힘에만
        // 보이고 각 게임이 자기 헤더를 갖는다).
        <FeedCard
          className="scr-feed-card-stack-summary scr-feed-card-stack-reveal"
          dateLabel={dateLabel}
          icon={<ClipboardList size={16} aria-hidden />}
          label={`게임결과 ${stack.items.length}건`}
          timeText={formatWhen(stack.date)}
          // 묶음 통째로 카카오톡 공유(요청) — 다른 포스트와 똑같이 우상단 케밥 안에
          // 넣는다. 헤더 '안'이 아니라 카드 직계 자식으로 두는 이유는 StackMenu 주석 참고.
          actions={<StackMenu content={shareContent} />}
        >
        {/* 명단 어디를 눌러도 펼쳐진다. button 안에는 목록을 넣을 수 없어(phrasing
            content만 허용) role로 대신한다. */}
        <div
          className="scr-feed-card-stack-sum-body" role="button" tabIndex={0}
          aria-expanded={false}
          aria-label="게임결과 펼치기"
          onClick={() => expandAndReveal()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); expandAndReveal(); } }}
        >
          <div className="scr-feed-card-stack-sum-head">
            <span className="scr-feed-card-stack-sum-title">요약 정보</span>
            <span className="scr-feed-card-stack-sum-count">참가자 총 {participants.length}명</span>
          </div>
          <ul className="scr-feed-card-stack-sum-players">
            {participants.map((p) => (
              <li
                key={p.id}
                className={cx(
                  "scr-feed-card-stack-sum-player",
                  (highlightMemberIds?.has(p.id)
                    || highlightTerms?.some((t) => normalizeSearchText(p.name).includes(t)))
                    && "scr-feed-card-stack-sum-player-hl",
                )}
              >
                {/* 아바타·닉네임 확대(요청) — 한 줄에 3명이던 그리드는 2명으로 줄인다
                    (아래 .scr-feed-card-stack-sum-players 참고). */}
                <Avatar member={{ id: p.id, nickname: p.name, avatar: memberOf(p.id)?.avatar ?? null }} size={28} />
                <span className="scr-feed-card-stack-sum-name">{p.name}</span>
              </li>
            ))}
          </ul>
        </div>
        </FeedCard>
      )}

      {/* 접었을 때만 보이는 안내문(요청: 한번 펴면 못 접으므로 펼친 뒤에는 누를 일이
          없다) — 포스트 어디를 눌러도 펼쳐지므로, 방향 삼각형 대신 그 사실을 글자로
          말한다. 버튼으로 남겨 두는 건 키보드로도 펼칠 수 있게 하려는 것. */}
      {!open && (
        <button type="button" className="scr-feed-card-stack-toggle" onClick={expandAndReveal}>
          포스트 눌러서 펼치기
        </button>
      )}
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
  const [kindFilter, setKindFilter] = useState<"all" | "gameResult" | "call" | "schedule" | "rankingShift">("all");

  // 게임결과 묶음은 한 번에 하나만 펼쳐 둔다(요청: "포스트 눌러서 요약보기 제거 이제
  // 한번 펴면 못접음... 대신! 다른 포스트를 펴면 나머지는 자동으로 접힘") — 수동으로
  // 접는 방법은 없앴고, 다른 묶음을 펼치면 그 키로 바뀌면서 이전 것이 저절로 접힌다.
  // 키는 그 묶음 첫 경기의 id(렌더 루프의 key와 같은 값)다.
  const [expandedStackKey, setExpandedStackKey] = useState<number | null>(null);

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

  // 리플레이 등록 — 파일 선택 → 분석(buildReplayDrafts) → 바로 등록(요청: "검토창이
  // 너무 복잡해... 기존 리플레이 검토창은 이제 필요없음"). 사람이 매핑을 봐야 하던
  // 자리는 등록 자체를 막지 않고, 대신 저장된 경기 카드에 빨간 글씨로 남긴다(아래
  // GameResultCardBody의 이상 케이스 안내 참고) — 확인 후 지우는 건 그 카드의 기존
  // 삭제(케밥) 버튼으로 충분하다.
  const replayInputRef = useRef<HTMLInputElement>(null);
  const [parsingReplays, setParsingReplays] = useState(false);
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
    primeFeedComments().catch(() => {}).finally(() => { if (alive) setCommentsLoading(false); });
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

  /* 미니맵 격자도 목록과 함께 받아 둔다 — 댓글과 같은 이유다(위 primeFeedComments).
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
     일도 안 한다 — 그래서 setMapsLoading(false)가 영영 안 불려 피드가 로딩에서
     멈췄다(지적: 가끔 피드 진입 시 무한로딩). */
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
  const reloadRankingShifts = useCallback(() => {
    api.listRankingShifts()
      .then(setRankShifts)
      .catch(() => {});
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

      // 검토창 없이 바로 등록한다(요청) — 중복(이미 등록됨/병합됨)은 buildReplayDrafts가
      // 이미 걸러 뒀으므로 조용히 넘어간다. 팀을 아예 못 나눴거나(teamSplitUncertain)
      // 관전자 의심 인원이 있는 경우만 여전히 사람 눈이 필요해 등록하지 않고 실패로
      // 남긴다 — 나머지(짧은 경기·승패 미확인·미확정 참가자)는 등록은 하되 피드 카드에
      // 빨간 글씨로 남겨 확인/삭제를 유도한다.
      let registered = 0;
      const failed: string[] = [];
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
        // 승패를 못 가려낸 경기 — 등록은 하되(요청) 무승부로 채우고 그 사실을 summaryData에
        // 남긴다(피드 카드가 이 표시를 보고 빨간 글씨를 낸다).
        const resultUncertain = !raw.result;
        const filled = resolveUnmatchedAsUnregistered(raw);
        const d: ReplayDraft = resultUncertain ? { ...filled, result: "draw" } : filled;
        const problem = validateReplayDraft(d);
        if (problem) { failed.push(`${d.fileName}: ${problem}`); continue; }

        const payload: NewGameResult = {
          date: d.date, team1: d.team1, team2: d.team2, result: d.result as GameOutcome, matchType: d.matchType,
          replay: d.replay,
          mapName: d.mapName || null, gameStartedAt: d.gameStartedAt, durationSeconds: d.durationSeconds,
          summaryData: resultUncertain
            ? { ...(d.summaryData ?? { v: REPLAY_SUMMARY_VERSION, beats: [] }), resultUncertain: true }
            : d.summaryData,
          mapData: d.mapGrid,
        };
        try {
          await addGameResult(payload);
          registered += 1;
        } catch (err) {
          failed.push(`${d.fileName}: ${err instanceof Error ? err.message : "등록에 실패했어요."}`);
        }
      }

      if (registered > 0) await handleReplaysSaved();
      const parts: string[] = [];
      if (truncated) parts.push(`한 번에 최대 ${MAX_REPLAY_FILES}개까지만 등록돼 처음 ${MAX_REPLAY_FILES}개만 처리했어요.`);
      if (registered > 0) parts.push(`${registered}개 등록했어요.`);
      if (failed.length > 0) parts.push(`${failed.length}개는 등록하지 못했어요 — ${failed.join(" / ")}`);
      if (parts.length > 0) {
        setReplayNotice({ text: parts.join(" "), kind: failed.length > 0 ? "error" : "success" });
      }
    } finally {
      setParsingReplays(false);
    }
  };

  // 너 나와!와 경기를 하나의 타임라인으로 — 최근 이벤트가 위.
  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [
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
    (item: FeedItem): boolean => {
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

  // 필터(유형/유저 검색)가 걸려 있나 — 걸려 있으면 게임결과 묶음을 펼친 채로 낸다(요청).
  // 걸러진 결과가 요약 뒤에 접혀 있으면 이 카드가 왜 남았는지 보이지 않는다.
  const filterActive = kindFilter !== "all" || searchTerms.length > 0;

  const dateLabelOf = (item: { time: number }) => {
    const d = new Date(item.time);
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  };

  // "현재"(now) 경계 = 미래(위)와 오늘/과거(아래)가 갈리는 지점 = 위에서부터 첫 "오늘
  // 이하" 아이템. 그 위에 미래 아이템이 있을 때만(idx>0) 카드 사이에 "현재" 구분선을
  // 넣는다(요청). 피드에 들어오면 이 지점이 화면 가운데 오도록 스크롤한다(요청) — 위로는
  // 앞으로 있을 일, 아래로는 이미 벌어진 일이라 그 경계가 곧 "지금 어디쯤인가"다.
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
      // "현재" 구분선이 있으면 그 자리에, 없으면(전부 과거) 첫 오늘/과거 카드에 맞춘다.
      // 구분선이 없을 땐 DOM 자식 인덱스가 displayFeed 인덱스와 그대로 일치한다.
      //
      // 한 번만 맞추면 된다 — 댓글까지 목록과 함께 받아 두고 그린 화면이라(위
      // primeFeedComments) 이 시점의 카드 높이가 곧 최종 높이다. 예전에는 카드마다 댓글이
      // 뒤늦게 따로 도착해 "현재"가 380px이나 밀렸고, 그걸 계속 되잡는 식으로 막고 있었다.
      const marker = list.querySelector<HTMLElement>("[data-now-marker]");
      const idx = nowIndex >= 0 ? nowIndex : displayFeed.length - 1;
      const el = marker ?? (list.children[idx] as HTMLElement | undefined);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const top = window.scrollY + r.top + r.height / 2 - window.innerHeight / 2;
      if (top <= 1) return;
      // 이 자동 스크롤이 "아래로 스크롤했다"로 읽혀 탭바·헤더가 접히면 안 된다
      // (useHideOnScrollDown이 이 창 동안 방향 판정을 건너뛴다).
      suppressScrollHide(NOW_SCROLL_MS + 300);
      /* 한 번에 옮긴다(요청: "스크롤시 버벅임이 심해서 그냥 순간이동으로 변경").
         부드럽게 흘러내리는 편이 "여기가 지금 자리다"를 잘 말해 주긴 했지만, 그건 매
         프레임 scrollTo를 부르는 rAF 애니메이션이라 카드가 많은 피드에서는 그 1.1초
         내내 메인 스레드가 밀렸다 — 첫인상이 곧 버벅임이면 얻는 것보다 잃는 게 크다.
         behavior:"instant"를 반드시 명시한다: #scroll-root에 CSS scroll-behavior:smooth가
         걸려 있어서 안 주면 네이티브 스무스 스크롤로 해석돼 도로 애니메이션이 된다. */
      scrollRootTo({ top, behavior: "instant" });
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
        <div className="scr-feed-list" ref={feedListRef}>
          {displayFeed.flatMap((item, i) => {
            // 미래↔과거 경계(nowIndex)에 "현재" 구분선을 카드 사이에 끼운다(요청).
            const divider = showNowDivider && i === nowIndex ? (
              <div key="now-divider" className="scr-feed-now-divider" data-now-marker>
                <span>현재</span>
              </div>
            ) : null;
            const card = (
            item.kind === "rankingShift" ? (
              <div className="scr-feed-card-stack-wrapper" key={`rs-${item.shift.id}`}>
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
                  footer={<FeedCardComments targetType="rankingShift" targetId={item.shift.id} />}
                />
              </div>
            ) : item.kind === "challenge" ? (
              <div className="scr-feed-card-stack-wrapper" key={`c-${item.challenge.id}`}>
                <FeedCard
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
                  comment={<FeedCardComments targetType="challenge" targetId={item.challenge.id} />}
                >
                  <ChallengeCard
                    challenge={item.challenge}
                    myId={user?.id}
                    highlightMemberIds={matchedIds}
                    onResponded={upsertChallenge}
                  />
                </FeedCard>
              </div>
            ) : item.kind === "gameResultPost" ? (
              // GameResultPost는 접힘/펼침에 따라 카드가 1~N개로 늘어나므로, 자기 몫의
              // .scr-feed-card-stack-wrapper를 스스로 렌더한다 — 여기서 또 감싸지 않는다.
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
                defaultOpen={filterActive}
                expanded={expandedStackKey === item.items[0].gameResult.id}
                onExpand={() => setExpandedStackKey(item.items[0].gameResult.id)}
              />
            ) : (
              <div className="scr-feed-card-stack-wrapper" key={`m-${item.gameResult.id}`}>
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
            return divider ? [divider, card] : [card];
          })}
        </div>
      )}

      {/* 스피너는 화면에 하나뿐이어야 한다 — 위 목록 자리의 것과 여기 '더 불러오는 중'이
          동시에 뜨면 로딩바가 두 개로 보인다(지적). 센티널도 목록이 그려진 뒤에만 둔다:
          없으면 관측할 것 자체가 없어 조기 loadMore가 원천적으로 안 생긴다. */}
      {!loading && loadingMore && <div className="scr-empty"><Spinner size={16} /></div>}
      {!loading && <div ref={sentinelRef} aria-hidden />}

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

      {challengeFormOpen && (
        <ChallengeFormModal
          onClose={() => setChallengeFormOpen(false)}
          onCreated={(c) => { upsertChallenge(c); setChallengeFormOpen(false); }}
        />
      )}

      {/* 리플레이 등록 결과 — 인라인 토스트 대신 확인 버튼 있는 팝업으로(지적). "취소"가
          아니라 순수 안내라 버튼은 "확인" 하나뿐이다 — ConfirmDialog는 항상 두 버튼을
          내므로 여기선 그 대신 같은 모양의 팝업을 직접 그린다. */}
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
