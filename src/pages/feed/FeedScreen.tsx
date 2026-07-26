import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { CalendarPlus, MoreHorizontal, Plus, Send, Swords, Trophy, Upload } from "lucide-react";
import { Spinner } from "../../components/common/Feedback";
import SearchFilterBar from "../../components/common/SearchFilterBar";
import PillTabs from "../../components/common/PillTabs";
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
import { buildReplayDrafts, type ReplayDraft } from "../../utils/replayDraft";
import { hasAppUpdatePreloadErrorOccurred } from "../../utils/appUpdate";
import { usePageBackground } from "../../hooks/usePageBackground";
import type { Challenge, Match, MatchSlot, MatchType, Member, RankSnapshot, RankShiftEntry } from "../../types";

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

// 변동 표기 — 신규 진입 / 상승(▲n) / 하락(▼n).
function shiftLabel(e: RankShiftEntry): { text: string; cls: string } {
  if (e.from == null) return { text: "신규", cls: "scr-feed-shift-new" };
  const d = e.from - e.to;
  if (d > 0) return { text: `▲${d}`, cls: "scr-feed-shift-up" };
  return { text: `▼${-d}`, cls: "scr-feed-shift-down" };
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
function FeedCardComments({ targetType, targetId }: { targetType: "match" | "challenge"; targetId: number }) {
  return (
    <div className="scr-feed-comments">
      <FeedComments targetType={targetType} targetId={targetId} />
    </div>
  );
}

// 경기 카드 — 한 경기가 피드 카드 한 장. 기존 경기 로우(접힌 상태)를 카드 본문에 그대로
// 앉히고(누르면 그 자리에서 펼쳐짐), 하단에 피드 댓글을 단다.
function MatchCard({ item, memberOf, onDeleted, dateLabel, highlightMemberIds, highlightTerms }: {
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
        <Swords size={13} aria-hidden />
        <span className="scr-feed-card-label">게임결과</span>
        <span className="scr-feed-card-time">{formatEventTime(item.time, item.withClock)}</span>
      </div>
      <div className="scr-feed-match-body">
        <MatchList rows={rows} memberOf={memberOf} onDeleted={onDeleted} loading={false} matchup highlightMemberIds={highlightMemberIds} highlightTerms={highlightTerms} />
      </div>
      <FeedCardComments targetType="match" targetId={item.match.id} />
    </div>
  );
}

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
  // 펼쳐지는 것처럼 보인다(지적). 스크롤 보정은 "페인트 전 딱 한 번"만 한다 — 레이아웃을
  // 즉시 바꾸고(useLayoutEffect 시점) 앞 카드가 밀린 만큼 같은 프레임에 scrollBy로 되돌려,
  // 화면에는 애초에 아무 움직임도 그려지지 않는다. 높이 트랜지션 + 매 프레임 보정 루프는
  // iOS 사파리에서 스크롤 반영이 비동기라 보정과 측정이 서로 어긋나며 크게 튀었다(지적:
  // "스크롤 튐이 더 심해졌어") — 프레임 단위 스크롤 개입 자체를 없애는 게 유일하게 안전하다.
  // "위로 착착" 펼쳐지는 느낌은 스크롤과 무관한 카드별 transform 슬라이드(CSS 애니메이션,
  // 아래 카드부터 순차)가 담당한다. html의 overflow-anchor:none은 계속 필요하다 — 네이티브
  // 스크롤 앵커링이 같은 변화를 한 번 더 보정하면 이중 보정으로 튄다.
  // 보정 앵커는 "펼칠 때"만 앞 카드다. 접을 때는 보정하지 않는다 — 줄이기 버튼은 펼쳐진
  // 목록 맨 위에 있어 누르는 순간 앞 카드가 화면 밖(아래)인 경우가 많은데, 그 카드를
  // 앵커로 잡으면 스택 높이만큼 위로 스크롤해 엉뚱한 곳(스택 위)이 보였다(지적). 접힘은
  // 스택 위쪽 문서 위치가 안 변하므로 그냥 두면 접힌 목록이 누른 자리에 그대로 나타난다.
  const frontRef = useRef<HTMLDivElement>(null);
  const restListRef = useRef<HTMLDivElement>(null);
  const pendingAnchorRef = useRef<number | null>(null);
  const toggleOpen = (next: boolean) => {
    pendingAnchorRef.current = next ? (frontRef.current?.getBoundingClientRect().top ?? null) : null;
    setOpen(next);
  };
  useLayoutEffect(() => {
    const anchor = pendingAnchorRef.current;
    pendingAnchorRef.current = null;
    if (anchor != null && frontRef.current) {
      const d = frontRef.current.getBoundingClientRect().top - anchor;
      // 문서에 CSS scroll-behavior:smooth가 걸려 있어 반드시 instant로 이동시킨다.
      if (d !== 0) window.scrollBy({ top: d, behavior: "instant" });
    }
    // 펼침 트랜지션 — 카드들이 스택 자리(맨 아래)에서 각자 자기 위치까지 실측 거리만큼
    // 미끄러져 올라온다(WAAPI, transform만이라 레이아웃·스크롤 불변 + 블러 유지). 아래
    // 카드부터 순차 시작(위로 착착). CSS 고정 거리로는 "높이가 즉시 확 열리는" 느낌이라
    // 뚝 끊겨 보였다(지적) — 실제 이동 거리를 줘야 펼쳐지는 트랜지션으로 보인다.
    if (open && restListRef.current && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const list = restListRef.current;
      const bottom = list.getBoundingClientRect().bottom;
      const children = Array.from(list.children) as HTMLElement[];
      children.forEach((el, idx) => {
        const dy = bottom - el.getBoundingClientRect().bottom;
        if (dy <= 0) return;
        el.animate(
          [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
          {
            duration: 380,
            easing: "cubic-bezier(0.32, 0.72, 0, 1)",
            delay: (children.length - 1 - idx) * 40,
            fill: "backwards",
          },
        );
      });
    }
  }, [open]);

  // 두 상태(접힘/펼침)의 카드가 모두 항상 마운트돼 있고(요청: "실제로는 렌더링해놓고"),
  // 높이는 클립(grid-rows 0fr↔1fr)으로 즉시 바뀐다 — 트랜지션은 카드 transform이 담당.
  return (
    <div className={cx("scr-feed-stack", open && "scr-feed-stack-opened")}>
      <button
        type="button" className="scr-feed-stack-peek"
        onClick={() => toggleOpen(true)}
        aria-hidden={open} tabIndex={open ? -1 : 0}
        aria-label={`게임결과 ${restDesc.length}건 더 펼치기`}
      >
        + {restDesc.length}건
      </button>
      <div className="scr-feed-stack-rest" aria-hidden={!open}>
        <div className="scr-feed-stack-rest-inner">
          <div className="scr-feed-stack-rest-list" ref={restListRef}>
            {/* 줄이기 버튼 — 카드 밖, 맨 위(가장 나중 게임 카드 위). */}
            <button
              type="button" className="scr-feed-stack-collapse"
              onClick={() => toggleOpen(false)} aria-label="줄이기"
            >
              줄이기
            </button>
            {/* 펼침 애니메이션(위 useLayoutEffect의 WAAPI)이 카드 단위로 걸리도록 래핑. */}
            {restDesc.map((it) => (
              <div key={it.match.id} className="scr-feed-stack-reveal">
                <MatchCard item={it} memberOf={memberOf} onDeleted={onDeleted} dateLabel={dateLabel} highlightMemberIds={highlightMemberIds} highlightTerms={highlightTerms} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div ref={frontRef} className="scr-feed-stack-front">
        <MatchCard item={ordered[0]} memberOf={memberOf} onDeleted={onDeleted} dateLabel={dateLabel} highlightMemberIds={highlightMemberIds} highlightTerms={highlightTerms} />
      </div>
    </div>
  );
}

export default function FeedScreen() {
  // 검색/필터(기록실과 동일 구성) — 유저 검색, 경기유형, 게임번호. 불러온 피드 안에서 즉시 필터.
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "0101" | "0102">("all");

  // 홈(피드) 배경 — 기존 랭킹 배경을 피드 이름으로 옮겨 그대로 쓴다(다크 우주/라이트 트로피).
  usePageBackground(
    "/images/bg/feed_bg.jpg",
    "/images/bg/feed_bg_mobile.png",
    "/images/bg/feed_bg_light.png",
  );
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
      if (typeFilter !== "all") {
        const mt = item.kind === "match" ? item.match.matchType
          : item.kind === "challenge" ? item.challenge.matchType
          : item.shift.matchType;
        if (mt !== typeFilter) return false;
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
  }, [visibleFeed, typeFilter, searchTerms, members]);

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

  return (
    <div className="scr-screen scr-feed-screen">
      <div className="scr-v2-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">피드</h1>
      </div>

      {/* 등록 진입점 — 리플레이 / 너 나와! / 일정(추후 개발). */}
      <div className="scr-v2-primary-row scr-feed-add-wrap">
        <button
          type="button"
          className="scr-btn scr-btn-primary scr-btn-primary-solid scr-btn-sm"
          onClick={() => setAddMenuOpen((v) => !v)}
          aria-expanded={addMenuOpen}
          aria-label="등록"
        >
          {parsingReplays ? <Spinner size={14} /> : <Plus size={16} />} 등록
        </button>
        {addMenuOpen && (
          <>
            <div className="scr-feed-add-backdrop" onClick={() => setAddMenuOpen(false)} aria-hidden />
            <div className="scr-feed-add-menu" role="menu">
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
                <Send size={14} aria-hidden /> 너 나와! 등록
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

      {/* 분류(개인전/팀전) 필터 — 기록실과 같은 알약 로우, 라벨만 분류로(요청). */}
      <div className="scr-match-type-filter">
        <FilterItem label="분류">
          <PillTabs
            aria-label="분류 필터"
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: "all", label: "전체" },
              { value: "0101", label: "개인전" },
              { value: "0102", label: "팀전" },
            ]}
          />
        </FilterItem>
      </div>

      {/* 유저 검색 + 게임번호 — 기록실과 동일. 너나와/랭크변동에도 유저 필터가 걸린다. */}
      <SearchFilterBar
        count={displayFeed.length}
        countLabel="건"
        showCount={false}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="@유저 검색"
        suggestions={suggestions}
      />

      {error && <div className="scr-err">{error}</div>}

      {loading ? (
        <div className="scr-empty"><Spinner size={18} /></div>
      ) : displayFeed.length === 0 ? (
        <div className="scr-empty">아직 표시할 활동이 없어요.</div>
      ) : (
        <div className="scr-feed-list">
          {displayFeed.map((item) => (
            item.kind === "rankshift" ? (
              <div className="scr-feed-card" key={`rs-${item.shift.id}`}>
                <div className="scr-feed-card-head" data-date-label={dateLabelOf(item)}>
                  <Trophy size={13} aria-hidden />
                  <span className="scr-feed-card-label">
                    랭크 변동 발생 · {item.shift.matchType === "0101" ? "개인전" : "팀전"}
                  </span>
                  <span className="scr-feed-card-time">{formatEventTime(item.time, item.withClock)}</span>
                </div>
                <ul className="scr-feed-shift-list">
                  {item.shift.shifts.map((e) => {
                    const label = shiftLabel(e);
                    return (
                      <li key={`${e.memberId}-${e.to}`} className="scr-feed-shift-row">
                        <span className="scr-feed-shift-rank">{e.to}위</span>
                        <span className="scr-feed-shift-name">{e.nickname}</span>
                        <span className={label.cls}>{label.text}</span>
                        {e.from != null && <span className="scr-feed-shift-from">({e.from}위 → {e.to}위)</span>}
                      </li>
                    );
                  })}
                </ul>
                <div className="scr-feed-rank-actions">
                  {/* 상세 — 통계 탭으로 이동, 이 변동의 게임 유형을 필터로 미리 건다(요청). */}
                  <button type="button" className="scr-btn scr-btn-sm" onClick={() => openStatsFor(item.shift.matchType)}>
                    상세
                  </button>
                </div>
              </div>
            ) : item.kind === "challenge" ? (
              <div className="scr-feed-card" key={`c-${item.challenge.id}`}>
                <div className="scr-feed-card-head" data-date-label={dateLabelOf(item)}>
                  <Send size={13} aria-hidden />
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
          ))}
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
