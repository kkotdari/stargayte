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
import { useEditableFocused } from "../../hooks/useEditableFocused";
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
// 피드 카드 라운딩(.scr-feed-card border-radius)과 같은 값 — 겹친 카드를 자르는 선을
// 이만큼 아래로 내려, 둥근 모서리에 파인 자리로 단면이 비치지 않게 한다.
const CARD_RADIUS = 14;

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

// ---- 블러 유지: '조상'이 아니라 블러 '잎'에 직접 transform ----
// backdrop-filter 카드는 '조상'에 transform(또는 clip-path/opacity 등)이 걸리면 블러가
// 끊긴다 — 그 조상이 자체 그룹 경계(backdrop root)가 되어 카드가 페이지 배경 대신
// 투명한 그룹 내부를 샘플링하기 때문이다(코드 곳곳의 opacity 함정과 같은 원리, 크롬·
// 사파리 공통 확인). 반면 '자기 자신'에 건 transform은 블러를 유지한다(자기 backdrop
// root는 자식에만 영향, 자신의 블러엔 무관). 그래서 스택 이동은 래퍼(rest-list·
// stack-front·matchstack)가 아니라 그 안 블러 잎(.scr-feed-card)에
// 직접 건다 — 래퍼는 배경이 없어 시각적으로 완전히 동일하고 블러만 살아남는다.
// 겹침 스택의 "+ N건 펼치기" 글자(peekwrap)도 함께 옮긴다 — 이 라벨은 absolute라 카드가
// 아니어서, 여기 빠지면 아래 스택들의 카드만 보정 transform을 받고 라벨은 제자리에 남아
// 위 카드 뒤로 밀려 사라진 것처럼 보였다(지적: "펼치기 버튼 감출 때 다른 펼치기 버튼도
// 같이 감춰진다").
const BLUR_LEAF_SEL = ".scr-feed-card, .scr-feed-stack-peekwrap";
function blurLeaves(el: HTMLElement): HTMLElement[] {
  if (el.matches(BLUR_LEAF_SEL)) return [el];
  const found = Array.from(el.querySelectorAll<HTMLElement>(BLUR_LEAF_SEL));
  return found.length ? found : [el];
}
function setTransform(els: HTMLElement[], v: string): void {
  // 값이 있을 땐 translateZ(0)을 붙여 3D transform으로 만든다 — 잎이 애니메이션 내내 자기
  // 합성 레이어에 머문다(레이어 생성/파괴 반복 방지). 단 이것만으론 개폐 커밋 프레임의
  // 통짜 번쩍임은 안 잡혔다(실기기 확인) — 원인은 레이어가 아니라 커밋 프레임에 한꺼번에
  // 실리던 즉시 스크롤 점프였고, 지금은 스크롤을 rAF로 나눠 옮긴다(useLayoutEffect 주석).
  // 빈 값은 CSS의 translateZ(0) 베이스로 떨어지므로 그대로 ""로 둔다.
  const val = v ? `${v} translateZ(0)` : "";
  for (const el of els) el.style.transform = val;
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
  // View Transition은 최종적으로 제거 — 두 번 시도했지만 iOS 사파리에서 VT 스냅샷이
  // 도는 동안 (1) 화면의 backdrop-filter가 일제히 투명해졌고(1차 제거 사유), (2)
  // 엣지-투-엣지 합성이 끊겨 주소줄/상태바 뒤 컨텐츠가 잘리고 배경색 띠가 번쩍였다
  // (지적: "주소줄과 상태바가 잠깐 컨텐츠가 잘리고 배경색 띠로 바뀌어" — 스냅샷은
  // 레이아웃 뷰포트에만 그려져 크롬 뒤 확장이 사라진다). 즉 VT 자체가 깜빡임을
  // 만든다. VT의 원래 목적(클립 토글 때 블러 레이어 생성/파괴 재래스터 가리기)은
  // 피드에서 backdrop-filter를 전부 걷어내면서(카드 불투명·탭바/FAB 무블러 반투명)
  // 소멸했으므로 이제 맨 커밋으로 충분하다. 시작·종료 상태는 아래 useLayoutEffect가
  // 페인트 전에 인라인으로 못박아 커밋 프레임에 위치 점프가 없다.
  const toggleOpen = (next: boolean) => {
    pendingAnchorRef.current = {
      scrollY: window.scrollY,
      docHeight: document.documentElement.scrollHeight,
    };
    setOpen(next);
  };
  // 접기 페이드아웃(closeStack)이 진행 중인지 — 중복 클릭 방지.
  const closingRef = useRef(false);
  // 스크롤 보정에 태워선 안 되는 요소 — position:fixed는 문서 스크롤과 무관하게 뷰포트에
  // 고정된 크롬(등록 FAB 등)이라, translateY를 걸면 그만큼 내려갔다 올라오는 헛움직임이
  // 된다(지적: "접고 펼 때 FAB가 아래로 내려갔다 올라와").
  const isSlidable = (el: HTMLElement): boolean => getComputedStyle(el).position !== "fixed";
  // 아래쪽 콘텐츠 수집 — 앞 카드 + 스택 뒤 피드 아이템들 + 피드 목록 뒤 요소들.
  // 개폐 중 이 무리만 transform으로 붙든다(앞 카드 기준 시점유지). 스택 '위'쪽 콘텐츠는
  // 수집하지 않는다 — 이동을 스크롤 자체가 만들어주므로 보정할 게 없다.
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
    suppressScrollHide(1200);
    // ★ 이 커밋 프레임에서는 스크롤을 절대 건드리지 않는다 — 문서 높이 ±d(수백 px)
    // 변경과 즉시 스크롤 점프 d를 한 프레임에 같이 실으면, iOS는 루트 스크롤 위치를
    // 브라우저 프로세스가 비동기로 들고 있어 둘이 한 프레임 어긋나 화면이 통째로
    // 번쩍인다(지적: 펼치기 누르자마자 / 접힘 완료 직후 peek 나오기 직전 = 정확히 두
    // 커밋 프레임). 대신 스크롤 이동은 아래 애니메이션이 프레임당 몇 px씩 나눠 옮긴다
    // — 어긋날 큰 값 자체가 없어지므로 타이밍 운이 아니라 구조적으로 사라진다.
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
      // 접힘이 확정된(rest가 0fr) 이 프레임에서 비로소 클립을 푼다 — 이제 열려 있는 높이
      // 자체가 0이라 풀어도 드러날 게 없다(closeStack의 clipTo 주석 참고).
      const restInner = root.querySelector<HTMLElement>(
        ":scope > .scr-feed-stack-rest > .scr-feed-stack-rest-inner",
      );
      if (restInner) restInner.style.clipPath = "";
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
    // 시작 상태는 인라인 스타일로 "지금 당장" 박는다 — WAAPI fill에만 맡기면 iOS가 첫
    // 프레임에 적용하지 않아 깜빡인다(이전 지적과 동일한 함정). 카드 기둥은 접힌 위치
    // (+d, rest-inner 클립 밖)에, 위 콘텐츠는 옛 위치(+d)에, 라인은 투명으로, 바는
    // 세운 채로(펼침 클래스의 scaleY(0)을 덮는다).
    railLocked = true;
    // 열린 스택 영역을 "앞 카드가 실제로 렌더되는 윗모서리"까지만 보이게 자른다.
    //
    // 이 영역(rest-inner)은 문서상 [S, S+d]를 차지하는데, 연출 중 앞 카드는 translateY로
    // 되올려져 S+d·p에 그려진다. 그 아래(S+d·p ~ S+d)는 아무도 안 덮는 노출 구간이다 —
    // 아래 피드 카드들도 같이 되올려져 제자리를 지키지만 카드 사이 갭(20px)이 그대로 뚫려
    // 있어, 그 틈으로 펼쳐지는 카드가 움직이는 게 다 비쳤다(지적: "다른 카드들 뒤로
    // 접히거나 펼쳐지는 카드들이 보여, 애니메이션도 다 보여"). 앞 카드가 내려간 만큼만
    // 열어주면 그 틈으로 보일 것 자체가 없어진다.
    // clip-path는 페인트 단계만 건드린다 — 레이아웃도, 실측(offsetHeight)도, 스크롤 보정
    // 계산도 손대지 않으므로 접힘 커밋과 어긋날 여지가 없다(한때 카드 기둥을 실측해
    // translate로 밀어 올려봤다가 접을 때 레이아웃이 흔들려 되돌린 적이 있다).
    const restInner = root.querySelector<HTMLElement>(
      ":scope > .scr-feed-stack-rest > .scr-feed-stack-rest-inner",
    );
    const clipTo = (p: number) => {
      if (!restInner) return;
      // 자르는 선을 앞 카드 윗모서리보다 카드 반경만큼 아래로 내린다 — 딱 윗모서리에서
      // 자르면 그 높이가 곧 라운딩 구간이라, 둥근 모서리에 파인 자리로 잘린 단면이
      // 그대로 비쳤다(지적). 반경만큼 더 열어두면 그 파인 자리는 뒤 카드가 채우고,
      // 실제 단면은 카드의 불투명한 몸통 뒤에서 잘린다.
      // px로 준다 — %는 요소 높이로 매 프레임 다시 나눠지며 경계가 서브픽셀에서 진동한다.
      const bottom = Math.max(0, Math.round(d * (1 - p) - CARD_RADIUS));
      restInner.style.clipPath = `inset(0 0 ${bottom}px 0)`;
    };
    const clipOff = () => { if (restInner) restInner.style.clipPath = ""; };
    clipTo(0);
    // 스크롤을 안 옮겼으므로 이 프레임의 화면은 접힘 때와 픽셀 단위로 같아야 한다.
    // 문서상으론 rest가 d만큼 열려 앞 카드·아래 콘텐츠가 d 내려갔으니, 그만큼 되올려
    // 제자리에 붙든다(아래 기준 시점유지). 펼쳐질 카드들은 transform이 필요 없다 —
    // 문서 순서상 앞 카드보다 위에 있고, 앞 카드/아래 콘텐츠가 나중에 그려져 그 위를
    // 덮으므로 지금은 완전히 가려져 있다. 스크롤이 내려갈수록 카드가 앞 카드 뒤에서
    // 미끄러져 나온다(= 예전의 rise 연출과 동일한 그림, 이동은 스크롤이 만든다).
    const belowLeaves = collectBelow()
      .filter((el) => el.getBoundingClientRect().top < window.innerHeight + d + 40)
      .flatMap(blurLeaves);
    setTransform(belowLeaves, `translateY(${-d}px)`);
    if (rail) rail.style.opacity = "0";
    const S0 = before.scrollY;

    const start = () => {
      if (cancelled) return;
      // 스크롤을 S0→S0+d로 나눠 옮기고, 같은 콜백에서 앞 카드·아래 콘텐츠의 보정
      // transform을 그만큼 풀어준다(한 프레임 안에서 함께 적용돼 서로 정확히 상쇄).
      //   앞 카드 화면위치 = docY+d - (S0+p·d) + (-(1-p)·d) = docY - S0  (p와 무관, 항상 고정)
      // 위 콘텐츠는 transform이 아예 없어도 스크롤만으로 p·d만큼 올라간다.
      const a = driveStyle(slideDur, EASE_STACK, (p) => {
        window.scrollTo({ top: S0 + d * p, behavior: "instant" });
        setTransform(belowLeaves, `translateY(${-d * (1 - p)}px)`);
        clipTo(p);
      });
      void a.finished.then(() => {
        setTransform(belowLeaves, "");
        clipOff();
        railLocked = false;
        if (railDeferred) { railDeferred = false; positionRail(); }
      }).catch(() => {});
      anims.push(a);
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

    };
    // 첫 페인트가 끝난 다음 프레임에 시작한다 — 레이아웃 변경+스크롤 보정이 실린 첫
    // 프레임은 무거워서(수백 ms까지도), animate()를 그 안에서 바로 걸면 시작 시각 기준으로
    // 이미 한참 진행된 지점부터 그려져 위 카드들이 중간부터 뚝 나타났다(지적: "쓰윽
    // 올라가는 게 아니라 갑자기 공간이 생기면서 깜빡임"). 시작 상태는 위 인라인 스타일이
    // 잡아두고 있어 첫 프레임은 아무것도 안 움직인 화면 그대로 보인다.
    let raf1 = 0, raf2 = 0;
    raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(start); });

    cancelRevealRef.current = () => {
      cancelled = true;
      clipOff();
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      anims.forEach((a) => { try { a.cancel(); } catch { /* 이미 끝남 */ } });
      // 중단되면 '펼침 완료' 상태로 확정한다 — 보정 transform을 걷는 것과 스크롤을
      // 최종값으로 옮기는 건 서로 상쇄라, 앞 카드는 어느 시점에 끊겨도 제자리에 남는다.
      setTransform(belowLeaves, "");
      window.scrollTo({ top: S0 + d, behavior: "instant" });
      if (rail) rail.style.opacity = "";
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
    // 펼침과 같은 클립을 역순으로 되감는다(위 useLayoutEffect의 clipTo 주석 참고) —
    // 앞 카드가 되올라간 만큼만 열어둬야, 접히는 카드들이 아래 피드 카드 사이 갭으로
    // 비치지 않는다.
    const restInner = root.querySelector<HTMLElement>(
      ":scope > .scr-feed-stack-rest > .scr-feed-stack-rest-inner",
    );
    const clipTo = (p: number) => {
      if (!restInner) return;
      // 펼침과 같은 이유로 카드 반경만큼 덜 자른다(위 clipTo 주석).
      const bottom = Math.max(0, Math.round(dist * p - CARD_RADIUS));
      restInner.style.clipPath = `inset(0 0 ${bottom}px 0)`;
    };
    const clipOff = () => { if (restInner) restInner.style.clipPath = ""; };
    clipTo(0);
    // 내려가는 거리 = 펼친 카드 영역 높이 그대로. 접힘/펼침 레이아웃 차이가 이제 이것
    // 하나뿐이다 — 예전엔 "+N건" 바가 접힘 때 실제 높이를 차지해서 그만큼을 빼고 다시
    // 자리를 잡아주는 보정이 줄줄이 붙었는데, 그 바를 카드에서 글자로 바꾸면서
    // (absolute라 높이 0) 보정할 것이 통째로 사라졌다.
    const dist = rest.getBoundingClientRect().height;
    const dur = Math.min(560, 360 + Math.round(dist * 0.12));
    const vh = window.innerHeight;
    suppressScrollHide(dur + 600);
    // 펼치기의 정확한 역재생 — 스크롤을 S1→S1-A로 나눠 되돌리고(A는 문서 상단에 막히면
    // 여유만큼만), 같은 콜백에서 앞 카드·아래 콘텐츠를 -dist·p만큼 내린다. 이 둘이
    // 상쇄해 앞 카드는 애니메이션 내내 제자리, 위 콘텐츠는 스크롤만으로 내려온다.
    // 커밋(레이아웃 1fr→0fr)은 애니메이션이 끝난 뒤 스크롤을 '건드리지 않고' 실행되므로
    // 큰 스크롤 점프와 레이아웃 변경이 한 프레임에 겹치지 않는다(펼치기와 같은 원리).
    const S1 = Math.max(0, window.scrollY);
    const A = Math.min(dist, S1);
    // 아래 무리 = 앞 카드 + 스택 뒤 콘텐츠. 위 무리·카드 기둥엔 transform이 필요 없다
    // (스크롤이 그 이동을 만든다) — 예전의 sink/rise 이중 보정이 통째로 사라졌다.
    const belowLeaves = collectBelow()
      .filter((el) => el.getBoundingClientRect().top < vh + dist + 40)
      .flatMap(blurLeaves);
    // 카드 클립은 rest-inner의 기존 overflow:hidden이 담당한다. 앞 카드(z-index 1)가
    // rest 위를 덮으므로, 스크롤이 되돌아갈수록 카드가 앞 카드 뒤로 미끄러져 들어간다.
    const anims: (Animation | DrivenAnim)[] = [];
    anims.push(driveStyle(dur, EASE_STACK, (p) => {
      // 끝점 -dist는 커밋에서 rest가 0fr로 접히며 빠지는 높이와 정확히 같아, 인라인
      // transform을 걷는 것과 서로 상쇄돼 커밋 프레임의 변화가 0이 된다.
      // 펼침과 같은 이유로 스크롤 반올림 오차를 transform에 되돌려 준다(위 주석 참고).
      const want = S1 - A * p;
      const s = Math.round(want);
      window.scrollTo({ top: s, behavior: "instant" });
      setTransform(belowLeaves, `translateY(${-dist * p + (want - s)}px)`);
      clipTo(p);
      // "+N건" 바는 후반부에 도로 자라나 커밋 전에 이미 제 모습을 갖춘다 — 커밋 프레임이
      // 순수 레이아웃 교체(화면 변화 0)가 되게 해서 바가 튀어나오는 느낌을 없앤다.
      // 펼침의 반대 — 바는 연출 내내 접힌 채로 두고 끝에서 한 번에 세운다(아래 finish).
      // 후반부에 서서히 자라게 했더니 그 바가 내려가는 카드들의 아랫부분을 미리 잘라 먹었다.
    }));
    if (rail) {
      anims.push(rail.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: 150, easing: "ease-in", fill: "both" },
      ));
    }
    const finish = () => {
      if (!closingRef.current) return;
      closingRef.current = false;
      // 클립은 여기서 걷지 않는다 — 걷으면 rest가 아직 열려 있는 상태(0fr 커밋 전)에서 한
      // 프레임 동안 통째로 드러나, 아래 피드 카드 사이 갭으로 스택 카드가 비치며 깜빡였다
      // (지적: "애니메이션이 끝나는 시점에 뒤에 스택 카드들이 비쳐 보이고 깜빡임").
      // 완전히 닫힌 값으로 확정해 두고, 실제 해제는 접힘이 커밋된 뒤(!open 분기)에 한다.
      clipTo(1);
      // 커밋 프레임이 이어받도록 종료 상태를 인라인으로 박고 애니메이션 객체는 정리한다.
      window.scrollTo({ top: S1 - A, behavior: "instant" });
      setTransform(belowLeaves, `translateY(${-dist}px)`);
      if (rail) rail.style.opacity = "0";
      anims.forEach((a) => { try { a.cancel(); } catch { /* 이미 끝남 */ } });
      closeMotionRef.current = { els: belowLeaves, belowEls: [], dist };
      cancelRevealRef.current = null;
      toggleOpen(false);
    };
    // 재펼침/언마운트 등으로 중단되면 전부 원복한다(펼침 상태로 되돌린다).
    cancelRevealRef.current = () => {
      closingRef.current = false;
      clipOff();
      anims.forEach((a) => { try { a.cancel(); } catch { /* 이미 끝남 */ } });
      setTransform(belowLeaves, "");
      window.scrollTo({ top: S1, behavior: "instant" });
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
          + {restDesc.length}건 펼치기
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
