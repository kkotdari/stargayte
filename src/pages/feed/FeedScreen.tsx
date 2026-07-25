import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { CalendarPlus, MessageCircle, Plus, Send, Swords, Trophy, Upload, X } from "lucide-react";
import { Spinner } from "../../components/common/Feedback";
import MatchList, { type SearchListRow } from "../v2/MatchList";
import { ChallengeCard } from "../challenge/ChallengeScreen";
import FeedComments from "./FeedComments";
import ScrollNavTimeline from "../../components/common/ScrollNavTimeline";
import ReplayReviewModal from "../../modals/ReplayReviewModal";
import ChallengeFormModal from "../../modals/ChallengeFormModal";
import RankRow from "../v2/RankRow";
import RankingScreen from "../v2/RankingScreen";
import { computeRankRows, MATCH_TYPE_OF, type RankMode, type RankRow as RankRowData } from "../v2/rank";
import { currentPeriodAnchor } from "../../utils/date";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { useCursorPagination } from "../../hooks/useCursorPagination";
import { buildReplayDrafts, type ReplayDraft } from "../../utils/replayDraft";
import { hasAppUpdatePreloadErrorOccurred } from "../../utils/appUpdate";
import type { Challenge, Match, Member } from "../../types";

const PAGE_SIZE = 100;
const MAX_REPLAY_FILES = 20;

// 피드 — 커뮤니티 활동(경기 결과, 너 나와! 일정)을 한 타임라인으로 보여주는 홈 화면.
// 타임라인 기준: 너 나와!는 경기 예정 일시, 경기는 리플레이의 게임 시작 시각.

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

function formatEventTime(ms: number, withClock: boolean): string {
  const d = new Date(ms);
  const base = `${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})`;
  if (!withClock) return base;
  return `${base} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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

interface RankingFeedItem {
  kind: "ranking";
  time: number;
  withClock: boolean;
  mode: RankMode;
  rows: RankRowData[]; // TOP 1~5
}

type FeedItem = ChallengeItem | MatchItem | RankingFeedItem;

// 랭킹 공개 시각 — 매일 오전 8시. 아직 8시 전이면 어제 8시 발행분이 최신이다.
function lastRankingPublishTime(): number {
  const pub = new Date();
  pub.setHours(8, 0, 0, 0);
  if (Date.now() < pub.getTime()) pub.setDate(pub.getDate() - 1);
  return pub.getTime();
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

// 피드 카드 하단 공통 댓글 영역 — 달린 댓글은 항상 보여주고, 입력창은 아이콘을 눌러야 열린다.
function FeedCardComments({ targetType, targetId }: { targetType: "match" | "challenge"; targetId: number }) {
  const [composerOpen, setComposerOpen] = useState(false);
  return (
    <div className="scr-feed-comments">
      <FeedComments targetType={targetType} targetId={targetId} showComposer={composerOpen} />
      <button
        type="button" className="scr-feed-comments-toggle"
        onClick={() => setComposerOpen((v) => !v)}
        aria-expanded={composerOpen} aria-label="댓글 쓰기" title="댓글 쓰기"
      >
        <MessageCircle size={14} aria-hidden />
      </button>
    </div>
  );
}

// 경기 카드 — 한 경기가 피드 카드 한 장. 기존 경기 로우(접힌 상태)를 카드 본문에 그대로
// 앉히고(누르면 그 자리에서 펼쳐짐), 하단에 피드 댓글을 단다.
function MatchCard({ item, memberOf, onDeleted, dateLabel }: {
  item: MatchItem;
  memberOf: (id: string) => Member | undefined;
  onDeleted: () => void;
  dateLabel: string;
}) {
  const rows: SearchListRow[] = useMemo(() => {
    const m = item.match;
    return [{ id: m.id, date: m.date, team1: m.team1, team2: m.team2, result: m.result, raw: m }];
  }, [item.match]);

  return (
    <div className="scr-feed-card">
      <div className="scr-feed-card-head" data-date-label={dateLabel}>
        <Swords size={13} aria-hidden />
        <span className="scr-feed-card-time">{formatEventTime(item.time, item.withClock)}</span>
        <span className="scr-feed-card-label">경기</span>
      </div>
      <div className="scr-feed-match-body">
        <MatchList rows={rows} memberOf={memberOf} onDeleted={onDeleted} loading={false} />
      </div>
      <FeedCardComments targetType="match" targetId={item.match.id} />
    </div>
  );
}

export default function FeedScreen() {
  const user = useAppStore((s) => s.user);
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
  useEffect(() => {
    if (hasMore && !matchesLoading && !loadingMore) loadMore();
  }, [hasMore, matchesLoading, loadingMore, loadMore]);

  const loading = challengesLoading || matchesLoading;

  // 데일리 랭킹(개인전/팀전 TOP5) — 실제 배치 없이, 조회 시점 기준 "가장 최근 오전 8시"
  // 발행분으로 타임라인에 아이템이 하나씩 생긴다. 데이터는 이번 달 랭킹.
  const [rankingItems, setRankingItems] = useState<RankingFeedItem[]>([]);
  useEffect(() => {
    if (members.length === 0) return;
    let cancelled = false;
    const publishedAt = lastRankingPublishTime();
    const anchor = currentPeriodAnchor("month");
    Promise.all((["solo", "team"] as RankMode[]).map(async (mode) => {
      const rows = await computeRankRows(members, MATCH_TYPE_OF[mode], "all", "month", anchor);
      return {
        kind: "ranking" as const,
        time: publishedAt,
        withClock: true,
        mode,
        rows: rows.filter((r) => r.rank <= 5),
      };
    }))
      .then((items) => { if (!cancelled) setRankingItems(items.filter((i) => i.rows.length > 0)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [members]);

  // 실시간 랭킹 모달 — 기존 랭킹 화면을 그대로 띄운다.
  const [liveRankingOpen, setLiveRankingOpen] = useState(false);

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
      ...rankingItems,
    ];
    return items.sort((a, b) => b.time - a.time);
  }, [challenges, matches, rankingItems]);

  const dateLabelOf = (item: FeedItem) => {
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
                <Upload size={14} aria-hidden /> 리플레이 등록
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

      {error && <div className="scr-err">{error}</div>}

      {loading ? (
        <div className="scr-empty"><Spinner size={18} /></div>
      ) : feed.length === 0 ? (
        <div className="scr-empty">아직 표시할 활동이 없어요.</div>
      ) : (
        <div className="scr-feed-list">
          {feed.map((item) => (
            item.kind === "ranking" ? (
              <div className="scr-feed-card" key={`r-${item.mode}-${item.time}`}>
                <div className="scr-feed-card-head" data-date-label={dateLabelOf(item)}>
                  <Trophy size={13} aria-hidden />
                  <span className="scr-feed-card-time">{formatEventTime(item.time, item.withClock)}</span>
                  <span className="scr-feed-card-label">오늘의 랭킹 · {item.mode === "solo" ? "개인전" : "팀전"}</span>
                </div>
                <div className="scr-feed-rank-panel scr-rank-table-panel-v2">
                  <div className="scr-rank-table">
                    {item.rows.map((row, i) => (
                      <RankRow
                        key={row.member.id}
                        row={row}
                        tiedWithPrev={i > 0 && row.rank === item.rows[i - 1].rank}
                      />
                    ))}
                  </div>
                </div>
                <div className="scr-feed-rank-actions">
                  <button type="button" className="scr-btn scr-btn-sm" onClick={() => setLiveRankingOpen(true)}>
                    실시간 랭킹 보기
                  </button>
                </div>
              </div>
            ) : item.kind === "challenge" ? (
              <div className="scr-feed-card" key={`c-${item.challenge.id}`}>
                <div className="scr-feed-card-head" data-date-label={dateLabelOf(item)}>
                  <Send size={13} aria-hidden />
                  <span className="scr-feed-card-time">{formatEventTime(item.time, item.withClock)}</span>
                  <span className="scr-feed-card-label">너 나와!</span>
                </div>
                <div className="scr-feed-card-body">
                  <ChallengeCard
                    challenge={item.challenge}
                    myId={user?.id}
                    onResponded={upsertChallenge}
                  />
                </div>
                <FeedCardComments targetType="challenge" targetId={item.challenge.id} />
              </div>
            ) : (
              <MatchCard
                key={`m-${item.match.id}`}
                item={item}
                memberOf={memberOf}
                onDeleted={reload}
                dateLabel={dateLabelOf(item)}
              />
            )
          ))}
        </div>
      )}

      {/* 우측 스크롤 타임라인 — 피드는 최신순(위=최근, 아래=과거). */}
      {!loading && feed.length > 0 && (
        <ScrollNavTimeline headSelector=".scr-feed-card-head" topLabel="최근" bottomLabel="과거" />
      )}

      {replayDrafts && (
        <ReplayReviewModal
          drafts={replayDrafts}
          truncated={replayTruncated}
          onClose={() => setReplayDrafts(null)}
          onSaved={reload}
        />
      )}

      {challengeFormOpen && (
        <ChallengeFormModal
          onClose={() => setChallengeFormOpen(false)}
          onCreated={(c) => { upsertChallenge(c); setChallengeFormOpen(false); }}
        />
      )}

      {/* 실시간 랭킹 — 기존 랭킹 화면을 모달로 그대로 띄운다(배경 사진만 끔). */}
      {liveRankingOpen && createPortal(
        <div className="scr-modal-overlay">
          <div className="scr-modal scr-feed-ranking-modal">
            <div className="scr-modal-head">
              <span>실시간 랭킹</span>
              <button className="scr-icon-btn" onClick={() => setLiveRankingOpen(false)} aria-label="닫기">
                <X size={14} />
              </button>
            </div>
            <div className="scr-modal-body scr-feed-ranking-modal-body">
              <RankingScreen embedded />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
