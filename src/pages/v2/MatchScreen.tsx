import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { Plus, Upload, ArrowUp, ArrowDown } from "lucide-react";
import ReplayLocationHint from "../../components/common/ReplayLocationHint";
import { Spinner } from "../../components/common/Feedback";
import PillTabs from "../../components/common/PillTabs";
import FilterItem from "../../components/common/FilterItem";
import MatchModal from "../../modals/MatchModal";
import MatchMemoModal from "../../modals/MatchMemoModal";
import ReplayReviewModal from "../../modals/ReplayReviewModal";
import MatchList, { type SearchListRow } from "./MatchList";
import SearchFilterBar from "../../components/common/SearchFilterBar";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { activeMemberSearchTerms, memberMatchesTerm, splitSearchTerms } from "../../utils/memberSearch";
import { monthInputToRange, currentMonthValue } from "../../utils/date";
import { buildReplayDrafts, type ReplayDraft } from "../../utils/replayDraft";
import { hasAppUpdatePreloadErrorOccurred } from "../../utils/appUpdate";
import { useCursorPagination } from "../../hooks/useCursorPagination";
import { useInfiniteScrollSentinel } from "../../hooks/useInfiniteScrollSentinel";
import type { Match, Member, MatchSlot } from "../../types";

const MAX_REPLAY_FILES = 20;
const PAGE_SIZE = 20;
const PERIOD_UNIT_OPTS: { value: "all" | "month"; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "month", label: "월" },
];

// 경기결과/전적통계/랭킹 공용 상단 모듈(SearchFilterBar)을 쓰는 화면. 기간은 전체/월
// 두 단위뿐이라(요청: iOS Safari가 <input type="week">를 지원 안 해서 주 단위 자체를
// 없앰) OS 네이티브 월 선택기(<input type="month">) 하나로 충분하다.
export default function MatchScreenV2() {
  const members = useAppStore((s) => s.members);
  const memberOf = useAppStore((s) => s.memberOf);

  // 검색창은 이제 엔터를 눌러야만 확정되는 값이라(SearchFilterBar 참고), search 자체가
  // 이미 "적용된" 값이다 — 예전처럼 디바운스로 한 번 더 늦출 필요가 없다.
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"latest" | "oldest">("latest");
  const [periodUnit, setPeriodUnit] = useState<"all" | "month">("all");
  const [periodMonth, setPeriodMonth] = useState(currentMonthValue);
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

  const effectiveRange = useMemo(
    () => (periodUnit === "month" ? monthInputToRange(periodMonth) : { from: "", to: "" }),
    [periodUnit, periodMonth],
  );

  // 수기등록(신규) 전용 — 카드 클릭으로는 더 이상 이 모달(수정)이 열리지 않지만, 코드는
  // 나중에 다시 쓸 수 있어 남겨둔다.
  const [editing, setEditing] = useState<Match | null | undefined>(undefined);
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
      // 매칭이 끝났든 아니든 등록 전에 항상 한 번 내용을 훑어보게 모달을 연다 — 곧장
      // 등록해버리지 않는다(중복만 있는 경우도 마찬가지로 모달에서 보여준다).
      setReplayDrafts(drafts);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    } finally {
      setParsingReplays(false);
    }
  };

  // 문의/디버깅 시 특정 경기 하나를 정확히 찾아볼 때 — 채워지면 다른 조건은 무시하고
  // 이 번호의 경기 하나만 조회한다. 이것도 이제 엔터로 확정되는 값이라 그대로 서버로 보낸다.
  const [matchNoInput, setMatchNoInput] = useState("");
  // 유저 검색은 더 이상 서버에 안 보낸다 — 항상 AND(모두 참여)로 클라이언트에서
  // 거른다(아래 listRows). 서버 쿼리는 기간/경기번호로만 좁혀서, 검색어가 바뀔 때마다
  // 다시 네트워크를 타지 않고 이미 불러온 결과 안에서 즉시 걸러진다. 경기유형 필터는
  // 없앴다(요청: "경기 - 유형구분 삭제") — 항상 전체 유형을 조회한다.
  const queryKey = useMemo(
    () => ({
      dateFrom: effectiveRange.from, dateTo: effectiveRange.to, sort,
      matchNo: matchNoInput.trim(),
    }),
    [effectiveRange.from, effectiveRange.to, sort, matchNoInput],
  );

  const fetchPage = useCallback(
    (cursor: string | null) => api.getMatchesPage({
      cursor: cursor ?? undefined,
      limit: PAGE_SIZE,
      sort: queryKey.sort,
      dateFrom: queryKey.dateFrom,
      dateTo: queryKey.dateTo,
      matchNo: queryKey.matchNo || undefined,
    }),
    [queryKey],
  );

  const { items: matches, loading, loadingMore, hasMore, loadMore, reload, error, total } = useCursorPagination(
    fetchPage, [queryKey],
  );
  // 검색어가 있는 동안은 무한스크롤(사용자가 직접 내려서 더 불러오기) 대신, 이 기간의
  // 경기를 전부 불러올 때까지 계속 다음 페이지를 이어붙인다 — 클라이언트 AND 필터가
  // 페이지 하나(20건)만 보고 판단하면 검색어와 맞는 경기가 뒤쪽 페이지에 몰려있을 때
  // 훑어보기 전엔 거의 안 보일 수 있다. 검색어가 없으면(평소 목록 훑어보기) 예전처럼
  // 스크롤에 따라 페이지씩만 불러온다(속도/트래픽 우월).
  useEffect(() => {
    if (hasSearch && hasMore && !loading && !loadingMore) loadMore();
  }, [hasSearch, hasMore, loading, loadingMore, loadMore]);
  const sentinelRef = useInfiniteScrollSentinel(loadMore, { enabled: !hasSearch && hasMore && !loading && !loadingMore });

  const resolveMember = (id: string): Member | undefined => memberOf(id);

  // 슬롯 하나가 이 검색어와 맞는지 — 회원으로 연결됐으면 닉네임/배틀태그/게임아이디로,
  // 컴퓨터/비회원/수기등록 슬롯이면 리플레이 원본 이름(rawName)으로 판단한다(서버의
  // _participant_term_exists와 같은 기준).
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

  return (
    <div className="scr-screen scr-match-screen-v2">
      <div className="scr-v2-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">경기</h1>
        <div className="scr-v2-toolbar-actions">
          <button
            type="button"
            className="scr-btn scr-btn-ghost scr-btn-sm"
            onClick={() => setEditing(null)}
          >
            <Plus size={12} /> 수기등록
          </button>
          <div className="scr-replay-register-group-corner">
            <button className="scr-btn scr-btn-primary scr-btn-primary-solid scr-btn-sm" onClick={() => replayInputRef.current?.click()}>
              <Upload size={12} /> 등록하기
            </button>
            <ReplayLocationHint className="scr-replay-loc-trigger-corner" />
            <input
              ref={replayInputRef}
              type="file"
              accept=".rep,application/octet-stream"
              multiple
              hidden
              onChange={handleReplayFilesChosen}
            />
          </div>
        </div>
      </div>

      <SearchFilterBar
        count={hasSearch ? listRows.length : (total ?? matches.length)}
        countLabel="건"
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="경기번호/유저"
        matchNoValue={matchNoInput}
        onMatchNoChange={setMatchNoInput}
        suggestions={suggestions}
        filterPanel={
          <>
            <FilterItem label="기간">
              <PillTabs options={PERIOD_UNIT_OPTS} value={periodUnit} onChange={setPeriodUnit} aria-label="기간" />
            </FilterItem>
            {periodUnit === "month" && (
              <FilterItem label="월">
                <input
                  type="month" className="scr-filter-month-input"
                  value={periodMonth} onChange={(e) => setPeriodMonth(e.target.value)}
                  aria-label="조회할 월"
                />
              </FilterItem>
            )}
            <FilterItem label="정렬">
              <button
                type="button" className="scr-filter-sort-btn"
                onClick={() => setSort(sort === "oldest" ? "latest" : "oldest")}
                aria-label={sort === "oldest" ? "오래된순 (누르면 최신순)" : "최신순 (누르면 오래된순)"}
                title={sort === "oldest" ? "오래된순" : "최신순"}
              >
                {sort === "oldest" ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
              </button>
            </FilterItem>
          </>
        }
      />

      {error && <div className="scr-err">{error}</div>}

      {parsingReplays && createPortal(
        <div className="scr-match-list-overlay">
          <Spinner size={22} />
        </div>,
        document.body,
      )}

      <div className="scr-match-list-wrap">
        <MatchList
          rows={listRows}
          memberOf={resolveMember}
          onMemo={(m) => setMemoMatch(m)}
          onDeleted={handleSaved}
          loading={loading}
          highlightMemberIds={matchedIds}
          matchNoQuery={matchNoInput.trim()}
        />
        <div ref={sentinelRef} />
        {loadingMore && <div className="scr-empty"><Spinner size={16} /></div>}
      </div>

      {editing !== undefined && (
        <MatchModal
          match={editing}
          onClose={() => setEditing(undefined)}
          onSaved={handleSaved}
        />
      )}

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
    </div>
  );
}
