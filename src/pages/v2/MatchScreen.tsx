import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { Upload } from "lucide-react";
import ReplayLocationHint from "../../components/common/ReplayLocationHint";
import { Spinner } from "../../components/common/Feedback";
import MatchMemoModal from "../../modals/MatchMemoModal";
import ReplayReviewModal from "../../modals/ReplayReviewModal";
import MatchList, { type SearchListRow } from "./MatchList";
import SearchFilterBar from "../../components/common/SearchFilterBar";
import ScrollNavTimeline from "../../components/common/ScrollNavTimeline";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { activeMemberSearchTerms, memberMatchesTerm, splitSearchTerms } from "../../utils/memberSearch";
import { buildReplayDrafts, type ReplayDraft } from "../../utils/replayDraft";
import { hasAppUpdatePreloadErrorOccurred } from "../../utils/appUpdate";
import { useCursorPagination } from "../../hooks/useCursorPagination";
import type { Match, Member, MatchSlot } from "../../types";

const MAX_REPLAY_FILES = 20;
// 한 번에 최대한 많이 받아 왕복 횟수를 줄인다 — 서버가 허용하는 상한(limit ≤ 100)에 맞춘다.
const PAGE_SIZE = 100;

// 경기 목록 화면. 기간 필터(전체/월/일)와 필터창·조회 버튼은 없앴다(요청: "기간 필터 제거하고
// 무조건 전체로 통일, 필터창 자체 필요없어짐"). 화면을 열면 전체 경기를 최신순으로 한 번에
// 모두 불러온다(요청: "무한스크롤이 아닌 한번에 모두 불러오기") — 유저 검색만 상단에 남긴다.
export default function MatchScreenV2() {
  const members = useAppStore((s) => s.members);
  const memberOf = useAppStore((s) => s.memberOf);

  // 검색창은 엔터를 눌러야만 확정되는 값이라(SearchFilterBar 참고), search 자체가 이미
  // "적용된" 값이다 — 이미 불러온 전체 경기 안에서 클라이언트가 즉시 걸러낸다.
  const [search, setSearch] = useState("");
  const suggestions = useMemo(() => activeMemberSearchTerms(members), [members]);
  const searchTerms = useMemo(() => splitSearchTerms(search), [search]);
  const hasSearch = searchTerms.length > 0;
  const matchedIds = useMemo(() => {
    if (searchTerms.length === 0) return undefined;
    const all = new Set<string>();
    members.forEach((m) => {
      if (searchTerms.some((t) => memberMatchesTerm(m, t))) all.add(m.id);
    });
    return all;
  }, [members, searchTerms]);

  // 회원 누구나 남길 수 있는 가벼운 메모 — 목록 카드의 연필 아이콘을 누르면 연다.
  const [memoMatch, setMemoMatch] = useState<Match | null>(null);

  const replayInputRef = useRef<HTMLInputElement>(null);
  const [parsingReplays, setParsingReplays] = useState(false);
  const [replayDrafts, setReplayDrafts] = useState<ReplayDraft[] | null>(null);
  const [replayTruncated, setReplayTruncated] = useState(false);

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
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    } finally {
      setParsingReplays(false);
    }
  };

  // 기간 필터를 없앴으므로 서버 쿼리는 조건 없이 항상 "전체 경기 최신순"이다. 유저 검색은
  // 서버에 안 보내고, 아래 listRows에서 이미 받은 목록을 클라이언트가 AND로 거른다.
  const fetchPage = useCallback(
    (cursor: string | null) =>
      api.getMatchesPage({ cursor: cursor ?? undefined, limit: PAGE_SIZE, sort: "latest" }),
    [],
  );

  const { items: matches, loading, loadingMore, hasMore, loadMore, reload, error, total } =
    useCursorPagination(fetchPage, []);

  // 무한스크롤(스크롤에 따라 한 페이지씩)을 없애고, 다음 페이지가 남아 있으면 계속 이어붙여
  // 전체를 한 번에 다 불러온다(요청). 첫 페이지가 끝나면 hasMore가 순차적으로 다음 페이지를
  // 트리거해 마지막 페이지까지 자동으로 채운다.
  useEffect(() => {
    if (hasMore && !loading && !loadingMore) loadMore();
  }, [hasMore, loading, loadingMore, loadMore]);

  const resolveMember = (id: string): Member | undefined => memberOf(id);

  // 슬롯 하나가 이 검색어와 맞는지 — 회원으로 연결됐으면 닉네임/배틀태그/게임아이디로,
  // 컴퓨터/비회원/수기등록 슬롯이면 리플레이 원본 이름(rawName)으로 판단한다.
  const slotMatchesTerm = (slot: MatchSlot, term: string): boolean => {
    const m = resolveMember(slot.memberId);
    if (m && memberMatchesTerm(m, term)) return true;
    return !!slot.rawName && slot.rawName.toLowerCase().includes(term);
  };

  const listRows: SearchListRow[] = useMemo(() => {
    const rows = matches.map((m) => (
      { id: m.id, date: m.date, team1: m.team1, team2: m.team2, result: m.result, raw: m }
    ));
    if (!hasSearch) return rows;
    // AND — 검색어 전부가 각각(서로 다른 참가자여도 무방) 이 경기 참가자 중 누군가와 맞아야 한다.
    return rows.filter((r) => {
      const slots = [...r.team1, ...r.team2];
      return searchTerms.every((term) => slots.some((slot) => slotMatchesTerm(slot, term)));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resolveMember/slotMatchesTerm은 members 참조 함수라 매 렌더 새로 만들어져도 무방(값 자체는 members로 충분히 표현됨)
  }, [matches, hasSearch, searchTerms, members]);

  const handleSaved = useCallback(async () => {
    reload();
  }, [reload]);

  const count = hasSearch ? listRows.length : (total ?? matches.length);

  return (
    <div className="scr-screen scr-match-screen-v2">
      <div className="scr-v2-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">경기 등록</h1>
      </div>

      {/* "등록" 버튼 — 타이틀 줄 아래 별도 줄에 가운데 정렬. 리플레이 위치 안내는 그 아래
          링크 텍스트로 둔다. */}
      <div className="scr-v2-primary-row scr-v2-primary-row-col">
        <button className="scr-btn scr-btn-primary scr-btn-primary-solid scr-btn-sm" onClick={() => replayInputRef.current?.click()}>
          <Upload size={12} /> 등록
        </button>
        <ReplayLocationHint className="scr-replay-loc-link" />
        <input
          ref={replayInputRef}
          type="file"
          accept=".rep,application/octet-stream"
          multiple
          hidden
          onChange={handleReplayFilesChosen}
        />
      </div>

      <h2 className="scr-v2-subheading">경기 목록</h2>

      {/* 기간 필터/조회 버튼은 없앴다 — 유저 검색창만 남긴다(전체 목록 안에서 즉시 필터). */}
      <SearchFilterBar
        count={count}
        countLabel="건"
        showCount={false}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="유저 검색"
        suggestions={suggestions}
      />

      {error && <div className="scr-err">{error}</div>}

      {parsingReplays && createPortal(
        <div className="scr-match-list-overlay">
          <Spinner size={22} />
        </div>,
        document.body,
      )}

      {/* 건수는 목록 바로 위에. */}
      <span className="scr-list-count scr-match-list-count">{count}건</span>

      <div className="scr-match-list-wrap">
        <MatchList
          rows={listRows}
          memberOf={resolveMember}
          onMemo={(m) => setMemoMatch(m)}
          onDeleted={handleSaved}
          loading={loading}
          highlightMemberIds={matchedIds}
        />
        {loadingMore && <div className="scr-empty"><Spinner size={16} /></div>}
      </div>

      {memoMatch && (
        <MatchMemoModal
          match={memoMatch}
          onClose={() => setMemoMatch(null)}
          onSaved={handleSaved}
        />
      )}

      {replayDrafts && (
        <ReplayReviewModal
          drafts={replayDrafts}
          truncated={replayTruncated}
          onClose={() => setReplayDrafts(null)}
          onSaved={handleSaved}
        />
      )}

      {/* 우측 네비게이션 타임라인 — 경기 목록은 최신순(위=최근, 아래=과거). 첫 페이지가
          로드되면 띄운다. */}
      {!loading && <ScrollNavTimeline headSelector=".scr-match-date-head" topLabel="최근" bottomLabel="과거" />}
    </div>
  );
}
