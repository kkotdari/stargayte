import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Plus, Send, Swords } from "lucide-react";
import { Spinner } from "../../components/common/Feedback";
import MatchList, { type SearchListRow } from "../v2/MatchList";
import { ChallengeCard } from "../challenge/ChallengeScreen";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { useCursorPagination } from "../../hooks/useCursorPagination";
import { cx } from "../../utils/format";
import type { Challenge, Match, Member } from "../../types";

const PAGE_SIZE = 100;

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

interface MatchGroupItem {
  kind: "matches";
  time: number;
  withClock: boolean;
  date: string; // YYYY-MM-DD — 같은 날의 경기들을 한 카드로 묶는 기준
  matches: Match[];
}

type FeedItem = ChallengeItem | MatchGroupItem;

function challengeItem(c: Challenge): ChallengeItem {
  const iso = c.scheduledAt ?? c.createdAt;
  return {
    kind: "challenge",
    time: new Date(iso).getTime(),
    withClock: c.scheduledTime != null,
    challenge: c,
  };
}

// 같은 날짜의 경기들을 한 카드로 묶는다 — 카드 시각은 그날 가장 늦은 게임 시작 시각.
function groupMatchesByDate(matches: Match[]): MatchGroupItem[] {
  const byDate = new Map<string, Match[]>();
  for (const m of matches) {
    const list = byDate.get(m.date) ?? [];
    list.push(m);
    byDate.set(m.date, list);
  }
  return [...byDate.entries()].map(([date, list]) => {
    const startTimes = list
      .map((m) => (m.gameStartedAt ? new Date(m.gameStartedAt).getTime() : null))
      .filter((t): t is number => t != null);
    return {
      kind: "matches",
      date,
      matches: list,
      withClock: startTimes.length > 0,
      time: startTimes.length > 0 ? Math.max(...startTimes) : new Date(`${date}T00:00:00`).getTime(),
    };
  });
}

// 참가자 요약 — 회원 닉네임 우선, 아니면 리플레이 게임아이디. 중복 제거, 등장 순서 유지.
function participantNames(matches: Match[], memberOf: (id: string) => Member | undefined): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const m of matches) {
    for (const slot of [...m.team1, ...m.team2]) {
      const name = memberOf(slot.memberId)?.nickname ?? slot.rawName ?? null;
      if (!name || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

function MatchGroupCard({ item, memberOf, onDeleted }: {
  item: MatchGroupItem;
  memberOf: (id: string) => Member | undefined;
  onDeleted: () => void;
}) {
  // 요약(N건 + 참가자)만 보여주다가 누르면 상세 목록이 아래로 펼쳐진다.
  const [open, setOpen] = useState(false);
  const names = participantNames(item.matches, memberOf);
  const rows: SearchListRow[] = useMemo(
    () => item.matches.map((m) => ({
      id: m.id, date: m.date, team1: m.team1, team2: m.team2, result: m.result, raw: m,
    })),
    [item.matches],
  );

  return (
    <div className="scr-feed-card">
      <div className="scr-feed-card-head">
        <Swords size={13} aria-hidden />
        <span className="scr-feed-card-time">{formatEventTime(item.time, item.withClock)}</span>
        <span className="scr-feed-card-label">경기 {item.matches.length}건 등록</span>
      </div>
      <button
        type="button"
        className="scr-feed-matches-summary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="scr-feed-matches-names">{names.join(" · ")}</span>
        <ChevronDown size={14} className={cx("scr-feed-chevron", open && "scr-feed-chevron-open")} aria-hidden />
      </button>
      <div className={cx("scr-feed-detail-clip", open && "scr-feed-detail-clip-open")} aria-hidden={!open}>
        <div className="scr-feed-detail-clip-inner">
          <div className="scr-feed-matches-detail">
            <MatchList rows={rows} memberOf={memberOf} onDeleted={onDeleted} loading={false} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FeedScreen() {
  const user = useAppStore((s) => s.user);
  const memberOf = useAppStore((s) => s.memberOf);

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

  // 너 나와!와 경기 그룹을 하나의 타임라인으로 — 최근 이벤트가 위.
  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [
      ...challenges.map(challengeItem),
      ...groupMatchesByDate(matches),
    ];
    return items.sort((a, b) => b.time - a.time);
  }, [challenges, matches]);

  return (
    <div className="scr-screen scr-feed-screen">
      <div className="scr-v2-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">피드</h1>
      </div>

      {/* 등록 진입점 — 리플레이/너 나와!/일정(추후). 실제 플로우는 다음 단계에서 연결. */}
      <div className="scr-v2-primary-row">
        <button type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid scr-btn-sm" aria-label="등록">
          <Plus size={16} /> 등록
        </button>
      </div>

      {error && <div className="scr-err">{error}</div>}

      {loading ? (
        <div className="scr-empty"><Spinner size={18} /></div>
      ) : feed.length === 0 ? (
        <div className="scr-empty">아직 표시할 활동이 없어요.</div>
      ) : (
        <div className="scr-feed-list">
          {feed.map((item) => (
            item.kind === "challenge" ? (
              <div className="scr-feed-card" key={`c-${item.challenge.id}`}>
                <div className="scr-feed-card-head">
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
              </div>
            ) : (
              <MatchGroupCard
                key={`m-${item.date}`}
                item={item}
                memberOf={memberOf}
                onDeleted={reload}
              />
            )
          ))}
        </div>
      )}
    </div>
  );
}
