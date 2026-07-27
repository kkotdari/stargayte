import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import RankShiftCard, { RankShiftMenu } from "./RankShiftCard";
import { CalendarPlus, ClipboardList, MoreHorizontal, Phone, Plus, Upload } from "lucide-react";
import { Spinner } from "../../components/common/Feedback";
import SearchFilterBar from "../../components/common/SearchFilterBar";
import Select from "../../components/common/Select";
import FilterItem from "../../components/common/FilterItem";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import KakaoShareButton from "../../components/common/KakaoShareButton";
import MatchList, { type SearchListRow } from "../v2/MatchList";
import { ChallengeCard, ChallengeTimeHeadEdit } from "../challenge/ChallengeScreen";
import FeedComments from "./FeedComments";
import ScrollNavTimeline from "../../components/common/ScrollNavTimeline";
import ReplayReviewModal from "../../modals/ReplayReviewModal";
import ChallengeFormModal from "../../modals/ChallengeFormModal";
import { scheduledInstantMs } from "../../utils/date";
import { suppressScrollHide } from "../../utils/scrollRoot";
import { useAppStore } from "../../store/appStore";
import { isAdminRole } from "../../constants/roles";
import { activeMemberSearchTerms, memberMatchesTerm, normalizeSearchText, splitSearchTerms } from "../../utils/memberSearch";
import { cx } from "../../utils/format";
import { api } from "../../api/client";
import { useCursorPagination } from "../../hooks/useCursorPagination";
import { buildReplayDrafts, type ReplayDraft } from "../../utils/replayDraft";
import { hasAppUpdatePreloadErrorOccurred } from "../../utils/appUpdate";
import type { Challenge, FeedTargetType, Match, MatchSlot, MatchType, Member, RankSnapshot } from "../../types";

const PAGE_SIZE = 100;
const MAX_REPLAY_FILES = 20;

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

// 같은 날의 게임결과가 피드에서 2개 이상 연속되면 겹침 스택 하나로 묶는다.
interface MatchStackItem {
  kind: "matchstack";
  time: number;
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

// ---- 메인스레드(rAF) transform 구동 ----
// WAAPI로 transform을 움직이면 컴포지터 가속 애니메이션이 되는데, iOS 사파리는 가속
// 애니메이션 동안 그 서브트리의 backdrop-filter를 프레임마다 다시 샘플링하지 않아
// 카드 블러가 풀렸다가 끝나야 돌아온다(지적: "애니메이션 중에 블러가 풀림"). 매
// 프레임 스타일 커밋으로 움직이면 커밋마다 블러가 다시 샘플링돼 유지된다. WAAPI
// Animation과 같은 겉모양(finished/cancel)이라 기존 정리 코드와 섞어 쓸 수 있다.
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-4) break;
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    t = Math.min(1, Math.max(0, t));
    return ((ay * t + by) * t + cy) * t;
  };
}
// 스택 연출 공용 이징(기존 cubic-bezier(0.32,0.72,0,1))과 CSS ease-in/ease-out 대응.
const EASE_STACK = cubicBezier(0.32, 0.72, 0, 1);
const EASE_IN = cubicBezier(0.42, 0, 1, 1);

interface DrivenAnim { finished: Promise<void>; cancel: () => void }

function driveStyle(dur: number, ease: (t: number) => number, apply: (p: number) => void): DrivenAnim {
  let raf = 0;
  let settled = false;
  let doCancel = () => {};
  const finished = new Promise<void>((resolve, reject) => {
    doCancel = () => reject(new Error("cancelled"));
    const t0 = performance.now();
    apply(0);
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      apply(ease(p));
      if (p >= 1) { settled = true; resolve(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });
  // 취소를 아무도 안 기다리는 사용처에서 미처리 거부 경고가 나지 않게 기본 소비.
  finished.catch(() => {});
  return {
    finished,
    cancel: () => {
      if (settled) return;
      settled = true;
      cancelAnimationFrame(raf);
      doCancel();
    },
  };
}

function driveTransform(
  el: HTMLElement, dur: number, ease: (t: number) => number, frame: (p: number) => string,
): DrivenAnim {
  return driveStyle(dur, ease, (p) => { el.style.transform = frame(p); });
}

// ---- 블러 유지: '조상'이 아니라 블러 '잎'에 직접 transform ----
// backdrop-filter 카드는 '조상'에 transform(또는 clip-path/opacity 등)이 걸리면 블러가
// 끊긴다 — 그 조상이 자체 그룹 경계(backdrop root)가 되어 카드가 페이지 배경 대신
// 투명한 그룹 내부를 샘플링하기 때문이다(코드 곳곳의 opacity 함정과 같은 원리, 크롬·
// 사파리 공통 확인). 반면 '자기 자신'에 건 transform은 블러를 유지한다(자기 backdrop
// root는 자식에만 영향, 자신의 블러엔 무관). 그래서 스택 이동은 래퍼(rest-list·
// stack-front·matchstack)가 아니라 그 안 블러 잎(.scr-feed-card, .scr-feed-stack-peek)에
// 직접 건다 — 래퍼는 배경이 없어 시각적으로 완전히 동일하고 블러만 살아남는다.
const BLUR_LEAF_SEL = ".scr-feed-card, .scr-feed-stack-peek";
function blurLeaves(el: HTMLElement): HTMLElement[] {
  if (el.matches(BLUR_LEAF_SEL)) return [el];
  const found = Array.from(el.querySelectorAll<HTMLElement>(BLUR_LEAF_SEL));
  return found.length ? found : [el];
}
function setTransform(els: HTMLElement[], v: string): void {
  // 값이 있을 땐 translateZ(0)을 붙여 3D transform으로 만든다 — 잎이 애니메이션 내내 자기
  // 합성 레이어에 머물러, 커밋 프레임에 레이어가 내려앉으며 목록 전체가 재래스터되는
  // 사파리 깜빡임을 막는다(global.css .scr-feed-card 주석). 빈 값은 CSS의 translateZ(0)
  // 베이스로 떨어지므로 그대로 ""로 둔다.
  const val = v ? `${v} translateZ(0)` : "";
  for (const el of els) el.style.transform = val;
}
function driveTransformEls(
  els: HTMLElement[], dur: number, ease: (t: number) => number, frame: (p: number) => string,
): DrivenAnim {
  return driveStyle(dur, ease, (p) => setTransform(els, frame(p)));
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
const MatchCard = memo(function MatchCard({ item, memberOf, onDeleted, dateLabel, highlightMemberIds, highlightTerms }: {
  item: MatchItem;
  memberOf: (id: string) => Member | undefined;
  onDeleted: () => void;
  dateLabel: string;
  highlightMemberIds?: Set<string>;
  highlightTerms?: string[];
}) {
  const rows: SearchListRow[] = useMemo(() => {
    const m = item.match;
    return [{ id: m.id, date: m.date, team1: m.team1, team2: m.team2, result: m.result, raw: m }];
  }, [item.match]);

  return (
    <div className="scr-feed-card">
      <div className="scr-feed-card-head" data-date-label={dateLabel}>
        {/* 게임결과는 결과지 느낌의 아이콘으로(요청) — 칼은 너 나와!가 쓴다. */}
        <ClipboardList size={13} aria-hidden />
        <span className="scr-feed-card-label">게임결과</span>
        <span className="scr-feed-card-time">{formatEventTime(item.time, item.withClock)}</span>
      </div>
      <div className="scr-feed-match-body">
        <MatchList rows={rows} memberOf={memberOf} onDeleted={onDeleted} loading={false} matchup highlightMemberIds={highlightMemberIds} highlightTerms={highlightTerms} />
      </div>
      <FeedCardComments targetType="match" targetId={item.match.id} />
    </div>
  );
});

// 겹침 스택 — 접힘: 그날 첫 게임 카드 + 그 아래로 살짝 겹쳐 보이는 뒷카드 밑단("+N건",
// 누르면 펼침). 펼침: 시간순 전체 카드 + 마지막 카드 위 줄이기 버튼.
function MatchStack({ stack, memberOf, onDeleted, dateLabel, highlightMemberIds, highlightTerms }: {
  stack: MatchStackItem;
  memberOf: (id: string) => Member | undefined;
  onDeleted: () => void;
  dateLabel: string;
  highlightMemberIds?: Set<string>;
  highlightTerms?: string[];
}) {
  const [open, setOpen] = useState(false);
  const ordered = useMemo(() => [...stack.items].sort((a, b) => a.time - b.time), [stack.items]);
  // 첫 게임이 맨 아래(앞 카드), 나중 게임일수록 위로 쌓인다 — 펼치면 위로 착착 나온다.
  const restDesc = useMemo(() => ordered.slice(1).reverse(), [ordered]);

  // 펼침 영역이 앞 카드 "위"에 있어, 그대로 두면 앞 카드가 아래로 밀려 마치 아래로
  // 펼쳐지는 것처럼 보인다(지적). 시점 유지는 펼칠 때/접을 때 모두 "문서 아래에서부터의
  // 높이" 기준이다(요청) — 문서 높이가 변한 만큼 스크롤을 같은 프레임(페인트 전)에 함께
  // 옮기면 스택 아래 콘텐츠(앞 카드 포함)가 화면에서 전혀 안 움직인다. 접을 때 브라우저가
  // 줄어든 문서에 맞춰 스크롤을 이미 클램프했을 수 있어(그 위에 상대 이동을 얹으면 이중
  // 보정이 된다 — 예전 "접으면 훨씬 위로 가버리는" 문제의 원인) scrollBy가 아니라 절대
  // 좌표 scrollTo로 잡는다. 클램프 상태(스크롤이 최대치를 넘은 순간)는 iOS에서 fixed
  // 레이어(탭바/스크롤 타임라인)가 위로 밀려 보이는 글리치까지 만들므로, 미리 막는 게
  // 중요하다(지적: "탭바가 사라졌어", "타임라인 위치가 올라감"). 매 프레임 보정 루프는
  // iOS의 비동기 스크롤 반영과 어긋나 크게 튀었다 — 반드시 딱 한 번만. html의
  // overflow-anchor:none은 계속 필요하다.
  //
  // 펼침 연출은 2단계(아이디어 제공: 사용자):
  // 1) 위쪽 콘텐츠(스택 위 아이템들·필터·헤더)가 필요한 높이만큼 트랜지션으로 밀려
  //    올라가 빈 공간을 만들고 — 실제 레이아웃은 이미 끝났고, 옛 위치(+H)에서 제자리로
  //    transform만 되감는 것이라 스크롤·레이아웃 개입이 없다.
  // 2) 다 올라가면 그 빈 공간에 카드들이 페이드인한다.
  // (이전의 "카드들이 스택 자리에서 날아오르는" 방식은 겹침 구간이 지저분해 보였다 — 지적.)
  const stackRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<HTMLDivElement>(null);
  const restListRef = useRef<HTMLDivElement>(null);
  const pendingAnchorRef = useRef<{ scrollY: number; docHeight: number } | null>(null);
  // 진행 중인 펼침 연출을 중단·원복하는 함수 — 접기/재펼침/언마운트 때 호출한다.
  const cancelRevealRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelRevealRef.current?.(), []);
  const toggleOpen = (next: boolean) => {
    pendingAnchorRef.current = {
      scrollY: window.scrollY,
      docHeight: document.documentElement.scrollHeight,
    };
    // 예전엔 이 커밋(레이아웃 클립 0fr↔1fr + 스크롤 보정)을 document.startViewTransition
    // 으로 감쌌다 — 사파리에서 클립이 풀리고 잠기는 순간 재래스터 깜빡임을 스냅샷 뒤에
    // 숨기려는 것이었다. 그런데 VT가 도는 동안 사파리는 라이브 페이지를 평평한 VT 스냅샷
    // 으로 통째로 대체해, 그 구간 내내 화면의 모든 backdrop-filter(탭바·등록 FAB·스택
    // peek)가 일제히 샘플링할 배경을 잃고 투명해졌다(지적: "블러 없어질 때 탭바와 등록
    // 버튼도 같이 투명해져"). 접기 애니메이션 자체는 잎 self-transform이라 블러를 유지
    // 하는데(지적: "줄어드는 동안은 블러 유지, 다 줄고부터 딱 풀려" = VT 창) VT만 걷어내면
    // 그 구간이 사라진다. 시작·종료 상태는 아래 useLayoutEffect가 페인트 전에 인라인으로
    // 못박아 두므로 VT 없이도 커밋 프레임에 위치 점프가 없다.
    setOpen(next);
  };
  // 접기 페이드아웃(closeStack)이 진행 중인지 — 중복 클릭 방지.
  const closingRef = useRef(false);
  // 위쪽 콘텐츠 수집 — 스택 위 피드 아이템들 + 피드 목록 위 요소들(타이틀/필터/검색).
  // 헤더는 문서 스크롤 최상단 콘텐츠라 스택을 펼칠 즈음엔 화면 밖이 대부분이지만,
  // 근처에 있으면 같이 밀어 위화감을 없앤다.
  // 스크롤 보정 슬라이드에 태워선 안 되는 요소 — position:fixed는 문서 스크롤과 무관하게
  // 뷰포트에 고정된 크롬(등록 FAB 등)이라, 스크롤 델타만큼 translateY를 걸면 그만큼 내려갔다
  // 올라오는 헛움직임이 된다(지적: "접고 펼 때 FAB가 아래로 내려갔다 올라와"). 이런 요소는
  // 수집에서 제외한다(헤더는 position:relative라 실제로 스크롤돼 그대로 포함).
  const isSlidable = (el: HTMLElement): boolean => getComputedStyle(el).position !== "fixed";
  const collectAbove = (): HTMLElement[] => {
    const root = stackRef.current;
    if (!root) return [];
    const above: HTMLElement[] = [];
    for (let el = root.previousElementSibling; el; el = el.previousElementSibling) {
      above.push(el as HTMLElement);
    }
    const listParent = root.parentElement;
    if (listParent) {
      for (let el = listParent.previousElementSibling; el; el = el.previousElementSibling) {
        above.push(el as HTMLElement);
      }
    }
    const header = document.querySelector<HTMLElement>(".scr-header");
    if (header) above.push(header);
    return above.filter(isSlidable);
  };
  // 아래쪽 콘텐츠 수집 — 앞 카드 + 스택 뒤 피드 아이템들 + 피드 목록 뒤 요소들.
  // 위쪽에서 접을 때(스크롤 여유 부족) 부족분만큼 이 무리가 올라와 채운다(아래 closeStack).
  const collectBelow = (): HTMLElement[] => {
    const root = stackRef.current;
    if (!root) return [];
    const below: HTMLElement[] = [];
    if (frontRef.current) below.push(frontRef.current);
    for (let el = root.nextElementSibling; el; el = el.nextElementSibling) {
      below.push(el as HTMLElement);
    }
    const listParent = root.parentElement;
    if (listParent) {
      for (let el = listParent.nextElementSibling; el; el = el.nextElementSibling) {
        below.push(el as HTMLElement);
      }
    }
    return below.filter(isSlidable);
  };
  // 접기 애니메이션(closeStack)이 끝내놓은 인라인 상태 — 커밋(!open) 분기가 이어받아 정리한다.
  const closeMotionRef = useRef<{ els: HTMLElement[]; belowEls: HTMLElement[]; dist: number } | null>(null);

  // ★ 이 연출의 대원칙: 카드에는 opacity 애니메이션을 절대 걸지 않는다 — opacity<1은
  // 자체 합성 그룹을 만들어 카드의 backdrop-filter가 꺼졌다가 1이 되는 순간 다시 켜지며
  // 카드 전체가 다시 그려지는 깜빡임이 된다(지적: "카드를 재렌더링을 해" — global.css의
  // .scr-feed-stack-rest 주석과 같은 함정). 카드 움직임은 전부 transform, opacity는
  // 블러 없는 요소(줄이기 라인·고스트)에만 쓴다. 카드 기둥(rest-list)은 rest-inner의
  // overflow:hidden이 클립해 주므로, 접힌 위치(+d)에서 통째로 밀어올리면 앞 카드 뒤에서
  // 카드들이 순서대로 나오는 모양이 된다.
  useLayoutEffect(() => {
    cancelRevealRef.current?.();
    const before = pendingAnchorRef.current;
    pendingAnchorRef.current = null;
    const front = frontRef.current;
    if (!before || !front) return;
    const d = document.documentElement.scrollHeight - before.docHeight;
    // 이 프로그램 스크롤이 "아래로 스크롤"로 오인돼 탭바/헤더가 숨지 않게 잠깐 억제한다
    // (펼치는 순간 탭바가 줄어드는 깜빡임 — 지적된 부자연스러움의 일부).
    suppressScrollHide(800);
    // 문서에 CSS scroll-behavior:smooth가 걸려 있어 반드시 instant로 이동시킨다.
    const target = Math.max(0, before.scrollY + d);
    if (target !== window.scrollY) window.scrollTo({ top: target, behavior: "instant" });
    const root = stackRef.current;
    const list = restListRef.current;
    if (!root || !list) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // 밀어올리기/내리기 시간 — 거리에 비례해 살짝 늘린다(지적: "너무 속도가 빠른 건지"
    // 카드 이동이 윗부분에서만 잠깐 보인다). 이동량이 클수록 오래, 상한은 둔다.
    const slideDur = Math.min(560, 360 + Math.round(Math.abs(d) * 0.12));

    if (!open) {
      // ---- 접기 커밋 — closeStack이 위 콘텐츠·카드 기둥을 이미 접힌 위치까지 움직여
      // 놨다(인라인 transform). 스크롤 보정(위)이 같은 프레임에 실리므로 인라인을 걷어내면
      // 화면상 위치가 그대로 이어진다. closeStack의 sinkDist/riseDist가 접힌 레이아웃 위치에
      // 정확히 내려앉게 맞춰져 있어("+N건" 바 높이를 미리 뺐다) 잔차 보정이 필요 없다.
      // 여기선 인라인 transform을 걷어 최종 상태(peek 완전 노출)로 이 프레임에 확정만 한다.
      // 예전엔 이 뒤에 peek scaleY(0→1)·잔차 translateY "후속 애니메이션"을 돌렸는데, 그게
      // 라이브 DOM에서 도는 동안 사파리가 그 서브트리를 재합성해 블러가 잠깐 풀렸다 — 그래서
      // 없앴다. 클립 토글(1fr→0fr) 자체는 잎 self-transform 바깥이라 블러를 끊지 않는다.
      const rail = root.querySelector<HTMLElement>(":scope > .scr-feed-stack-rail");
      if (rail) rail.style.opacity = "";
      const moved = closeMotionRef.current;
      closeMotionRef.current = null;
      moved?.belowEls.forEach((el) => { el.style.transform = ""; });
      moved?.els.forEach((el) => { el.style.transform = ""; });
      const peek = root.querySelector<HTMLElement>(
        ":scope > .scr-feed-stack-peekwrap > .scr-feed-stack-peek",
      );
      if (peek) { peek.style.transform = ""; peek.style.transformOrigin = ""; }
      return;
    }

    // 줄이기 라인 배치 — 첫(맨 위) 카드의 세로 중심에서 시작해 마지막(앞) 카드의 세로
    // 중심에서 끝난다(요청). 카드 높이는 제각각이라 CSS만으론 못 잡아 실측해 인라인으로
    // 박고, 열려 있는 동안 높이가 변하면(카드 펼침 등) ResizeObserver로 다시 잡는다.
    // 카드 기둥이 transform으로 움직이는 동안엔 실측이 이동 중 좌표를 읽어버리므로
    // 미뤄뒀다가 끝나고 다시 잡는다.
    const rail = root.querySelector<HTMLElement>(":scope > .scr-feed-stack-rail");
    let railDeferred = false;
    let railLocked = false;
    const positionRail = () => {
      if (railLocked) { railDeferred = true; return; }
      const firstCard = list.querySelector<HTMLElement>(".scr-feed-stack-reveal .scr-feed-card");
      const frontCard = front.querySelector<HTMLElement>(".scr-feed-card");
      if (!rail || !firstCard || !frontCard) return;
      const rootTop = root.getBoundingClientRect().top;
      const a = firstCard.getBoundingClientRect();
      const b = frontCard.getBoundingClientRect();
      const startY = a.top + a.height / 2 - rootTop;
      rail.style.top = `${startY}px`;
      rail.style.height = `${Math.max(0, b.top + b.height / 2 - rootTop - startY)}px`;
      rail.style.bottom = "auto";
    };
    positionRail();
    const railObserver = new ResizeObserver(positionRail);
    railObserver.observe(root);
    const cleanupRail = () => {
      railObserver.disconnect();
      if (rail) { rail.style.top = ""; rail.style.height = ""; rail.style.bottom = ""; }
    };

    if (d <= 0 || reduced) {
      cancelRevealRef.current = () => { cleanupRail(); cancelRevealRef.current = null; };
      return;
    }

    let cancelled = false;
    const anims: (Animation | DrivenAnim)[] = [];
    // "+N건" 바 — 언마운트·복제 없이 실물 그대로 쓴다(지적: 바가 생기고 없어질 때마다
    // 목록 전체가 재렌더링·깜빡임). 커밋 프레임엔 펼침 상태의 absolute 자리(접힘 때와
    // 같은 화면 위치)에서 scaleY(1)로 세워 눌렀던 자리를 그대로 덮고, 카드 기둥이 그
    // 밑에서 올라오는 동안 짧게 접혀 들어간다.
    const peek = root.querySelector<HTMLElement>(
      ":scope > .scr-feed-stack-peekwrap > .scr-feed-stack-peek",
    );

    // 시작 상태는 인라인 스타일로 "지금 당장" 박는다 — WAAPI fill에만 맡기면 iOS가 첫
    // 프레임에 적용하지 않아 깜빡인다(이전 지적과 동일한 함정). 카드 기둥은 접힌 위치
    // (+d, rest-inner 클립 밖)에, 위 콘텐츠는 옛 위치(+d)에, 라인은 투명으로, 바는
    // 세운 채로(펼침 클래스의 scaleY(0)을 덮는다).
    railLocked = true;
    // 이동은 래퍼가 아니라 블러 잎에 직접(위 blurLeaves 주석). 카드 기둥(rest-list)의
    // 잎 = 펼쳐질 카드들, 위 콘텐츠의 잎 = 각 피드 카드/바.
    const listLeaves = blurLeaves(list);
    setTransform(listLeaves, `translateY(${d}px)`);
    if (rail) rail.style.opacity = "0";
    if (peek) peek.style.transform = "scaleY(1)";
    // 애니메이션 동안 화면에 들어올 일 없는(최종 위치가 d만큼 내려가도 화면 위 밖인)
    // 위 콘텐츠는 건너뛴다.
    const sliders = collectAbove().filter((el) => el.getBoundingClientRect().bottom + d >= -40);
    const aboveLeaves = sliders.flatMap(blurLeaves);
    setTransform(aboveLeaves, `translateY(${d}px)`);

    const start = () => {
      if (cancelled) return;
      // 위 콘텐츠와 카드 기둥이 옛(접힌) 위치에서 한 몸으로 밀려 올라온다 — 위 카드들이
      // 열어주는 공간을 새 카드들이 앞 카드 뒤에서 나오며 그대로 채우므로 빈 공백 구간이
      // 없다. 카드엔 opacity를 안 쓰므로(위 대원칙) 블러 재합성 깜빡임도 없다.
      const rise = (els: HTMLElement[], onDone?: () => void) => {
        const a = driveTransformEls(els, slideDur, EASE_STACK, (p) => `translateY(${d * (1 - p)}px)`);
        void a.finished.then(() => { setTransform(els, ""); onDone?.(); }).catch(() => {});
        anims.push(a);
      };
      rise(aboveLeaves);
      rise(listLeaves, () => {
        railLocked = false;
        if (railDeferred) { railDeferred = false; positionRail(); }
      });
      // 줄이기 라인은 자리가 잡히는 후반부에 나타난다(블러 없는 요소라 opacity 안전).
      if (rail) {
        const ra = rail.animate(
          [{ opacity: 0 }, { opacity: 1 }],
          { duration: 220, easing: "ease-out", delay: Math.round(slideDur * 0.55), fill: "both" },
        );
        const settle = () => { rail.style.opacity = ""; };
        ra.onfinish = () => { settle(); ra.cancel(); };
        ra.oncancel = settle;
        anims.push(ra);
      }
      // "+N건" 바는 기둥이 뒤에서 올라오는 초반에 앞 카드 윗모서리로 접혀 들어간다 —
      // opacity를 쓰면 바의 블러가 꺼지며 또 깜빡이므로(지적: "뒤에 스택된 카드가
      // 나오고 없어질 때 깜빡해") 스케일(transform)로만. 끝나면 인라인을 걷어 펼침
      // 클래스의 scaleY(0)이 이어받는다(같은 값이라 화면 변화 없음).
      if (peek) {
        const pa = driveTransform(peek, 180, EASE_IN, (p) => `scaleY(${1 - p})`);
        void pa.finished.then(() => { peek.style.transform = ""; }).catch(() => {});
        anims.push(pa);
      }
    };
    // 첫 페인트가 끝난 다음 프레임에 시작한다 — 레이아웃 변경+스크롤 보정이 실린 첫
    // 프레임은 무거워서(수백 ms까지도), animate()를 그 안에서 바로 걸면 시작 시각 기준으로
    // 이미 한참 진행된 지점부터 그려져 위 카드들이 중간부터 뚝 나타났다(지적: "쓰윽
    // 올라가는 게 아니라 갑자기 공간이 생기면서 깜빡임"). 시작 상태는 위 인라인 스타일이
    // 잡아두고 있어 첫 프레임은 아무것도 안 움직인 화면 그대로 보인다. rise는 전부 잎
    // self-transform이라 블러가 유지된다(VT를 걷어낸 이유 — toggleOpen 주석 참고).
    let raf1 = 0, raf2 = 0;
    raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(start); });

    cancelRevealRef.current = () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      anims.forEach((a) => { try { a.cancel(); } catch { /* 이미 끝남 */ } });
      if (peek) peek.style.transform = "";
      setTransform(listLeaves, "");
      if (rail) rail.style.opacity = "";
      setTransform(aboveLeaves, "");
      cleanupRail();
      cancelRevealRef.current = null;
    };
  }, [open]);

  // 접기 — 펼치기의 정확한 역재생(요청): 레이아웃은 그대로 둔 채 위 콘텐츠와 카드
  // 기둥이 한 몸으로 접힌 위치까지 내려가고(기둥은 rest-inner 클립 밖으로 사라진다),
  // 다 내려가면 실제 접힘(레이아웃+스크롤 보정)을 커밋한다(위 useLayoutEffect의 !open
  // 분기가 인라인 상태를 이어받아 정리). 카드엔 opacity를 안 쓴다(위 대원칙).
  const closeStack = () => {
    if (closingRef.current) return;
    const root = stackRef.current;
    const list = restListRef.current;
    const rest = root?.querySelector<HTMLElement>(":scope > .scr-feed-stack-rest");
    const rail = root?.querySelector<HTMLElement>(":scope > .scr-feed-stack-rail");
    if (!root || !list || !rest || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      toggleOpen(false);
      return;
    }
    // 펼침 연출이 아직 진행 중이면 끊고(스타일 원복) 접기로 넘어간다.
    cancelRevealRef.current?.();
    closingRef.current = true;
    // 내려가는 거리 = 펼친 카드 영역 높이 - 접힘 때 "+N건" 바가 도로 차지할 높이.
    // 바 높이를 안 빼면 커밋 후 위 콘텐츠가 바 높이만큼 되올라가는 잔차 보정이 남아
    // 접을 때 위 목록이 한 번 출렁였다(지적). 빼 두면 애니메이션이 정확히 접힌
    // 레이아웃 위치에 내려앉아 잔차가 0이 된다(커밋 분기의 settle은 안전망으로만 남음).
    // 바의 접힘 레이아웃 기여분 = border-box 높이 + 상하 마진(-6px 겹침 포함).
    const peekEl = root.querySelector<HTMLElement>(
      ":scope > .scr-feed-stack-peekwrap > .scr-feed-stack-peek",
    );
    let peekH = 0;
    if (peekEl) {
      const pcs = getComputedStyle(peekEl);
      peekH = Math.max(0,
        peekEl.offsetHeight + (parseFloat(pcs.marginTop) || 0) + (parseFloat(pcs.marginBottom) || 0));
    }
    const dist = Math.max(0, rest.getBoundingClientRect().height - peekH);
    const dur = Math.min(560, 360 + Math.round(dist * 0.12));
    const vh = window.innerHeight;
    // 접으면 문서가 dist만큼 줄어 커밋 때 스크롤도 그만큼 되돌아가야 하는데, 화면이
    // 문서 상단 근처면 그만한 스크롤 여유가 없어 0에서 잘렸다 — 애니메이션은 전체
    // 거리만큼 내려가 있어 상단에 공백이 생겼다가 커밋에 사라졌다(지적: "위쪽에서
    // 접으면 상단이 내려오면서 공백"). 위 무리는 스크롤 여유만큼만 내려가고, 부족분은
    // 아래 무리(앞 카드부터)가 올라와 채운다 — 커밋 때 정확히 맨 위(스크롤 0)에서
    // 멈추며 위·아래 모두 이어진다. 여유가 충분하면 riseDist=0, 기존과 동일.
    const sinkDist = Math.min(dist, Math.max(0, window.scrollY));
    const riseDist = dist - sinkDist;
    // 이동은 래퍼가 아니라 블러 잎에 직접(위 blurLeaves 주석) — 조상 transform은 사파리
    // ·크롬 공통으로 카드 블러를 끊는다(지적: "애니메이션 중 블러 꺼짐"). 위 무리·카드
    // 기둥은 내려가고(sinkDist), 위쪽 클램프 때 부족분(riseDist)은 아래 무리가 올라온다.
    const aboveLeaves = collectAbove().filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top < vh + 40 && r.bottom + sinkDist > -40;
    }).flatMap(blurLeaves);
    const listLeaves = blurLeaves(list);
    const belowLeaves = riseDist > 0.5
      ? collectBelow().filter((el) => {
          const r = el.getBoundingClientRect();
          return r.top - riseDist < vh + 40 && r.bottom > -40;
        }).flatMap(blurLeaves)
      : [];
    // 카드 클립은 rest-inner의 기존 overflow:hidden이 그대로 담당한다(clip-path는 조상에
    // 걸리면 transform과 똑같이 블러를 끊어 쓰지 않는다 — 확인). 아래 무리가 올라와도
    // 앞 카드(z-index 1)가 rest 위를 덮고, rest 카드는 overflow 밖으로 나가며 사라진다.
    const anims: (Animation | DrivenAnim)[] = [];
    const sinkLeaves = [...aboveLeaves, ...listLeaves];
    anims.push(driveTransformEls(sinkLeaves, dur, EASE_STACK, (p) => `translateY(${sinkDist * p}px)`));
    if (belowLeaves.length) {
      anims.push(driveTransformEls(belowLeaves, dur, EASE_STACK, (p) => `translateY(${-riseDist * p}px)`));
    }
    if (rail) {
      anims.push(rail.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: 150, easing: "ease-in", fill: "both" },
      ));
    }
    const finish = () => {
      if (!closingRef.current) return;
      closingRef.current = false;
      // 커밋 프레임이 이어받도록 종료 상태를 인라인으로 박고 애니메이션 객체는 정리한다.
      setTransform(sinkLeaves, `translateY(${sinkDist}px)`);
      setTransform(belowLeaves, `translateY(${-riseDist}px)`);
      if (rail) rail.style.opacity = "0";
      anims.forEach((a) => { try { a.cancel(); } catch { /* 이미 끝남 */ } });
      closeMotionRef.current = { els: sinkLeaves, belowEls: belowLeaves, dist: sinkDist };
      cancelRevealRef.current = null;
      toggleOpen(false);
    };
    // 재펼침/언마운트 등으로 중단되면 전부 원복한다.
    cancelRevealRef.current = () => {
      closingRef.current = false;
      anims.forEach((a) => { try { a.cancel(); } catch { /* 이미 끝남 */ } });
      setTransform(sinkLeaves, "");
      setTransform(belowLeaves, "");
      if (rail) rail.style.opacity = "";
      cancelRevealRef.current = null;
    };
    Promise.all(anims.map((a) => a.finished)).then(finish).catch(() => {});
  };

  // 두 상태(접힘/펼침)의 카드가 모두 항상 마운트돼 있고(요청: "실제로는 렌더링해놓고"),
  // 높이는 클립(grid-rows 0fr↔1fr)으로 즉시 바뀐다 — 트랜지션은 카드 transform이 담당.
  return (
    <div ref={stackRef} className={cx("scr-feed-stack", open && "scr-feed-stack-opened")}>
      {/* 래퍼: 펼침 상태에서 바를 display 토글 없이(높이 0 + absolute) 자리만 잃게
          하기 위한 기준 컨테이너 — global.css의 .scr-feed-stack-peekwrap 주석 참고. */}
      <div className="scr-feed-stack-peekwrap">
        <button
          type="button" className="scr-feed-stack-peek"
          onClick={() => toggleOpen(true)}
          aria-hidden={open} tabIndex={open ? -1 : 0}
          aria-label={`게임결과 ${restDesc.length}건 더 펼치기`}
        >
          + {restDesc.length}건
        </button>
      </div>
      <div className="scr-feed-stack-rest" aria-hidden={!open}>
        <div className="scr-feed-stack-rest-inner">
          <div className="scr-feed-stack-rest-list" ref={restListRef}>
            {/* 펼침 애니메이션(위 useLayoutEffect의 WAAPI)이 카드 단위로 걸리도록 래핑. */}
            {restDesc.map((it) => (
              <div key={it.match.id} className="scr-feed-stack-reveal">
                <MatchCard item={it} memberOf={memberOf} onDeleted={onDeleted} dateLabel={dateLabel} highlightMemberIds={highlightMemberIds} highlightTerms={highlightTerms} />
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* 줄이기 — 버튼 대신 스택(펼쳐진 카드들 + 앞 카드) 전체 왼쪽에 겹쳐 올라가는 흰
          세로 라인(요청: 들여쓰기 없이 카드 위에 배치, 첫 카드까지 포함). 누르면 접힌다. */}
      <button
        type="button" className="scr-feed-stack-rail"
        onClick={closeStack} aria-label="줄이기"
        aria-hidden={!open} tabIndex={open ? 0 : -1}
      >
        <span className="scr-feed-stack-rail-dot scr-feed-stack-rail-dot-top" aria-hidden />
        <span className="scr-feed-stack-rail-label">눌러서 다시 줄이기</span>
        <span className="scr-feed-stack-rail-dot scr-feed-stack-rail-dot-bottom" aria-hidden />
      </button>
      <div ref={frontRef} className="scr-feed-stack-front">
        <MatchCard item={ordered[0]} memberOf={memberOf} onDeleted={onDeleted} dateLabel={dateLabel} highlightMemberIds={highlightMemberIds} highlightTerms={highlightTerms} />
      </div>
    </div>
  );
}

export default function FeedScreen() {
  // 검색/필터(기록실과 동일 구성) — 유저 검색, 경기유형, 게임번호. 불러온 피드 안에서 즉시 필터.
  const [search, setSearch] = useState("");
  // 피드 유형 필터(요청: 분류(개인전/팀전) 제거하고 유형 드롭다운 추가). 게임결과/너나와/
  // 일정/랭크변동으로 거른다 — 너나와=시간 미확정 도전장, 일정=시간 확정 도전장.
  const [kindFilter, setKindFilter] = useState<"all" | "match" | "call" | "schedule" | "rankshift">("all");

  // 피드는 다크/라이트 모두 사진 배경 없음(요청: 다크 피드 배경도 제거, 사진 배경은
  // 통계 화면으로 이동 — StatsScreen의 usePageBackground 참고).
  const user = useAppStore((s) => s.user);
  const isAdmin = !!user && isAdminRole(user.roles);
  const memberOf = useAppStore((s) => s.memberOf);
  const members = useAppStore((s) => s.members);

  // + 등록 메뉴(리플레이/너 나와!/일정) — 버튼 아래 작은 팝오버로 연다.
  const [addMenuOpen, setAddMenuOpen] = useState(false);

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
    const chosen = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (chosen.length === 0) return;
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

  // 같은 날 게임결과가 2개 이상 연속이면 겹침 스택으로 묶는다(요청).
  const displayFeed = useMemo<DisplayItem[]>(() => {
    const out: DisplayItem[] = [];
    let i = 0;
    while (i < filteredFeed.length) {
      const it = filteredFeed[i];
      if (it.kind === "match") {
        let j = i + 1;
        while (
          j < filteredFeed.length
          && filteredFeed[j].kind === "match"
          && (filteredFeed[j] as MatchItem).match.date === it.match.date
        ) j++;
        if (j - i >= 2) {
          out.push({ kind: "matchstack", time: it.time, date: it.match.date, items: filteredFeed.slice(i, j) as MatchItem[] });
          i = j;
          continue;
        }
      }
      out.push(it);
      i++;
    }
    return out;
  }, [filteredFeed]);

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
      <div className="scr-feed-add-fab-wrap scr-feed-add-wrap">
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
        count={displayFeed.length}
        countLabel="건"
        showCount={false}
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
              <div className="scr-feed-card" key={`c-${item.challenge.id}`}>
                <div className="scr-feed-card-head" data-date-label={dateLabelOf(item)}>
                  {/* 너 나와!는 "호출"이니 수화기 아이콘으로(요청) — 등록 메뉴·호출 버튼과 통일. */}
                  <Phone size={13} aria-hidden />
                  <span className="scr-feed-card-label">너 나와!</span>
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
                key={`ms-${item.date}-${item.time}`}
                stack={item}
                memberOf={memberOf}
                onDeleted={handleMatchDeleted}
                dateLabel={dateLabelOf(item)}
                highlightMemberIds={matchedIds}
                highlightTerms={searchTerms}
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
        <ScrollNavTimeline headSelector=".scr-feed-card-head" topLabel="최근" bottomLabel="과거" />
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
