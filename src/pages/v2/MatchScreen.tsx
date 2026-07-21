import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { Upload } from "lucide-react";
import ReplayLocationHint from "../../components/common/ReplayLocationHint";
import { Spinner } from "../../components/common/Feedback";
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
import type { Member, MatchSlot } from "../../types";

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
  // 공통 검색창(위 search)은 유저 전용이고, 경기번호·댓글은 이 화면 전용 별도 필드로 받는다
  // (요청). 셋은 AND로 함께 걸린다.
  const [matchNoQuery, setMatchNoQuery] = useState("");
  const [commentQuery, setCommentQuery] = useState("");
  // 진입하면 조회 버튼 없이 곧바로 전체 경기를 불러온다(요청: "조회 버튼 제거하고 자동
  // 조회로 변경"). 기간 필터가 없어 조회는 그냥 전체 로드다.
  const suggestions = useMemo(() => activeMemberSearchTerms(members), [members]);
  const searchTerms = useMemo(() => splitSearchTerms(search), [search]);
  const matchNoTerm = matchNoQuery.trim().toLowerCase();
  const commentTerm = commentQuery.trim().toLowerCase();
  const hasSearch = searchTerms.length > 0 || matchNoTerm !== "" || commentTerm !== "";
  const matchedIds = useMemo(() => {
    if (searchTerms.length === 0) return undefined;
    const all = new Set<string>();
    members.forEach((m) => {
      if (searchTerms.some((t) => memberMatchesTerm(m, t))) all.add(m.id);
    });
    return all;
  }, [members, searchTerms]);

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

  // 진입 즉시 기간 조건 없이 "전체 경기 최신순"을 불러온다. 유저 검색은 서버에 안 보내고,
  // 아래 listRows에서 클라이언트가 AND로 거른다.
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
    return rows.filter((r) => {
      const slots = [...r.team1, ...r.team2];
      // 공통 검색창은 유저 전용 — 검색어 전부가 각각(서로 다른 참가자여도 무방) 이 경기
      // 참가자 중 누군가와 맞아야 한다(요청: 검색창은 유저 전용으로).
      const userOk = searchTerms.every((term) => slots.some((slot) => slotMatchesTerm(slot, term)));
      // 경기번호 필드 — 부분일치.
      const noOk = matchNoTerm === "" || r.raw.matchNo.toLowerCase().includes(matchNoTerm);
      // 댓글 필드 — 이 경기 댓글 중 하나라도 내용에 포함하면 통과.
      const commentOk = commentTerm === "" || r.raw.comments.some((c) => c.text.toLowerCase().includes(commentTerm));
      return userOk && noOk && commentOk;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resolveMember/slotMatchesTerm은 members 참조 함수라 매 렌더 새로 만들어져도 무방(값 자체는 members로 충분히 표현됨)
  }, [matches, hasSearch, searchTerms, matchNoTerm, commentTerm, members]);

  const handleSaved = useCallback(async () => {
    reload();
  }, [reload]);

  const count = hasSearch ? listRows.length : (total ?? matches.length);

  return (
    <div className="scr-screen scr-match-screen-v2">
      <div className="scr-v2-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">기록실</h1>
      </div>

      {/* "등록" 버튼 — 리플레이 업로드. 위치 안내는 그 아래 링크. */}
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

      {/* 유저 검색(필터) — 자동 조회로 목록이 늘 있으므로 상시 노출한다. 불러온 목록 안에서 즉시 필터. */}
      <SearchFilterBar
        count={count}
        countLabel="건"
        showCount={false}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="@유저 검색"
        suggestions={suggestions}
      />

      {/* 경기번호·댓글 검색 — 유저 전용 공통 검색창과 별개인 이 화면 전용 필드. 한 줄에
          나란히 두고 모바일에서도 한 줄을 유지한다(요청). */}
      <div className="scr-match-extra-search">
        <label className="scr-match-extra-field">
          <span className="scr-field-label-text">경기번호</span>
          <input
            className="scr-input scr-list-search-input"
            value={matchNoQuery}
            onChange={(e) => setMatchNoQuery(e.target.value)}
            placeholder="경기번호"
            inputMode="numeric"
            autoComplete="off"
          />
        </label>
        <label className="scr-match-extra-field">
          <span className="scr-field-label-text">메모</span>
          <input
            className="scr-input scr-list-search-input"
            value={commentQuery}
            onChange={(e) => setCommentQuery(e.target.value)}
            placeholder="메모 내용"
            autoComplete="off"
          />
        </label>
      </div>

      {error && <div className="scr-err">{error}</div>}

      {parsingReplays && createPortal(
        <div className="scr-match-list-overlay">
          <Spinner size={22} />
        </div>,
        document.body,
      )}

      <span className="scr-list-count scr-match-list-count">{count}건</span>

      <div className="scr-match-list-wrap">
        <MatchList
          rows={listRows}
          memberOf={resolveMember}
          onDeleted={handleSaved}
          loading={loading}
          highlightMemberIds={matchedIds}
        />
        {loadingMore && <div className="scr-empty"><Spinner size={16} /></div>}
      </div>

      {replayDrafts && (
        <ReplayReviewModal
          drafts={replayDrafts}
          truncated={replayTruncated}
          onClose={() => setReplayDrafts(null)}
          onSaved={handleSaved}
        />
      )}

      {/* 우측 네비게이션 타임라인 — 경기 목록은 최신순(위=최근, 아래=과거). 로딩이 끝나면 띄운다. */}
      {!loading && <ScrollNavTimeline headSelector=".scr-match-date-head" topLabel="최근" bottomLabel="과거" />}
    </div>
  );
}
