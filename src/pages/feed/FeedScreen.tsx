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
  // 스크롤 보정에 태워선 안 되는 요소 — position:fixed는 문서 스크롤과 무관하게 뷰포트에
  // 고정된 크롬(등록 FAB 등)이라, translateY를 걸면 그만큼 내려갔다 올라오는 헛움직임이
  // 된다(지적: "접고 펼 때 FAB가 아래로 내려갔다 올라와").
  // ── 펼침/접힘 연출 ────────────────────────────────────────────────────────
  //
  // 겹친 카드를 담은 래퍼(rest-inner)의 높이만 0 ↔ 실제 높이로 애니메이션한다. 그게 전부다.
  // 스크롤은 한 번도 건드리지 않는다.
  //
  // 예전엔 "앞 카드는 화면에서 제자리에 고정"을 지키려고, 열린 높이만큼 스크롤을 내리고
  // 아래 콘텐츠를 transform으로 되올려 상쇄하는 구조였다. 그런데 iOS 사파리는 루트 스크롤
  // 위치를 컴포지터가 비동기로 들고 있어 스타일과 같은 프레임에 착지한다는 보장이 없다 —
  // 매 프레임 상쇄하면 잔떨림, 커밋 프레임에 한 번에 실으면 그 프레임만 번쩍였다. 값을
  // 아무리 맞춰도(정수 반올림, 절대→상대) 남았고, 크롬에선 멀쩡한데 iOS에서만 나온다는
  // 것이 이 구조 고유의 증상임을 확인해 줬다.
  //
  // 그래서 그 고정 요구를 놓기로 했다(요청: "앞 카드가 밀려 내려가도 괜찮다"). 앞 카드가
  // 열린 만큼 아래로 밀려나는 평범한 아코디언이 되면 스크롤을 조정할 이유 자체가 없어지고,
  // 그와 함께 보정 transform·클립·커밋 프레임 동기화가 전부 필요 없어진다.
  useLayoutEffect(() => {
    const wasToggled = pendingAnchorRef.current;
    pendingAnchorRef.current = null;
    const root = stackRef.current;
    const inner = root?.querySelector<HTMLElement>(
      ":scope > .scr-feed-stack-rest > .scr-feed-stack-rest-inner",
    );
    const front = frontRef.current;
    const list = restListRef.current;
    if (!root || !inner || !front || !list) return;

    // 줄이기 라인은 첫 카드 중심 ~ 앞 카드 중심을 잇는다 — 높이가 변하는 내내 다시 잰다.
    const rail = root.querySelector<HTMLElement>(":scope > .scr-feed-stack-rail");
    const positionRail = () => {
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
    const cleanup = () => {
      railObserver.disconnect();
      inner.style.height = "";
      if (rail) { rail.style.top = ""; rail.style.height = ""; rail.style.bottom = ""; }
      cancelRevealRef.current = null;
    };

    // 토글이 아니라 첫 렌더/리렌더면 연출 없이 상태만 맞춘다.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!wasToggled || reduced) {
      inner.style.height = "";
      cancelRevealRef.current = () => cleanup();
      return;
    }

    // 열린 높이 — 접힘 상태에선 래퍼가 0이므로 안쪽 기둥(rest-list)에서 잰다.
    const full = list.getBoundingClientRect().height;
    const dur = Math.min(560, 360 + Math.round(full * 0.12));
    // 시작 높이를 인라인으로 '지금 당장' 박는다 — WAAPI fill에만 맡기면 iOS가 첫 프레임에
    // 적용하지 않아 열린 상태가 한 번 스쳐 보인다(이 파일 곳곳에서 반복 확인된 함정).
    inner.style.height = open ? "0px" : `${full}px`;
    if (rail) rail.style.opacity = open ? "0" : "1";

    const anims: Animation[] = [];
    const a = inner.animate(
      [{ height: open ? "0px" : `${full}px` }, { height: open ? `${full}px` : "0px" }],
      { duration: dur, easing: "cubic-bezier(0.32, 0.72, 0, 1)", fill: "both" },
    );
    anims.push(a);
    if (rail) {
      anims.push(rail.animate(
        [{ opacity: open ? 0 : 1 }, { opacity: open ? 1 : 0 }],
        { duration: open ? 220 : 150, easing: open ? "ease-out" : "ease-in",
          delay: open ? Math.round(dur * 0.55) : 0, fill: "both" },
      ));
    }
    void Promise.all(anims.map((x) => x.finished)).then(() => {
      anims.forEach((x) => { try { x.cancel(); } catch { /* 이미 끝남 */ } });
      // 펼침 완료 뒤엔 auto로 돌려놔야 댓글이 늘거나 카드가 펼쳐질 때 높이가 따라간다.
      inner.style.height = "";
      if (rail) rail.style.opacity = "";
      cleanup();
    }).catch(() => {});

    cancelRevealRef.current = () => {
      anims.forEach((x) => { try { x.cancel(); } catch { /* 이미 끝남 */ } });
      if (rail) rail.style.opacity = "";
      cleanup();
    };
    return () => { railObserver.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 접기 — 상태만 바꾸면 위 useLayoutEffect가 높이 애니메이션을 역방향으로 돌린다.
  const closeStack = () => toggleOpen(false);

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
