import { useEffect, useMemo, useState } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { Spinner } from "../../components/common/Feedback";
import SearchFilterBar from "../../components/common/SearchFilterBar";
import PillTabs from "../../components/common/PillTabs";
import FilterItem from "../../components/common/FilterItem";
import MemberStatRow from "../stats/MemberStatRow";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { activeMemberSearchTerms, memberMatchesQuery } from "../../utils/memberSearch";
import { monthInputToRange, currentMonthValue } from "../../utils/date";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { cx } from "../../utils/format";
import type { BaseRace, MemberStats, MemberStatsEntry } from "../../types";

const PERIOD_UNIT_OPTS: { value: "all" | "month"; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "month", label: "월" },
];
// 최소 10회 플레이해야 승률/APM 등 세부 지표를 신뢰할 수 있다고 보고, 못 채운 회원은
// 게임수만 보여주고 나머지는 가린다(집계 표본이 너무 적어 왜곡되는 걸 막기 위함).
const MIN_PLAYS_FOR_STATS = 10;

const EMPTY_STATS: MemberStats = {
  plays: 0, wins: 0, losses: 0, draws: 0, winRate: 0,
  avgApm: null, avgEapm: null, avgCmd: null, avgEcmd: null,
};

type StatSortKey = "name" | "rate" | "plays" | "eapm" | "ecmd";
type StatSortDir = "desc" | "asc";
interface StatSort { key: StatSortKey; dir: StatSortDir }

// 컬럼 헤더를 누르면 내림차순 → 오름차순 → 미설정(다시 누르기 전 상태로) 순서로 도는
// 3단 토글 — 같은 컬럼을 다시 누르면 방향만 바뀌고, 다른 컬럼을 누르면 그 컬럼의
// 내림차순부터 새로 시작한다(한 번에 하나의 정렬 기준만 유지).
function nextSort(prev: StatSort | null, key: StatSortKey): StatSort | null {
  // 유저(이름)만 오름차순(가나다순)부터 시작하는 게 자연스러워 시작 방향과 토글 순서를
  // 반대로 둔다(asc -> desc -> null) — 나머지 지표는 그대로 desc -> asc -> null.
  if (!prev || prev.key !== key) return { key, dir: key === "name" ? "asc" : "desc" };
  if (key === "name") return prev.dir === "asc" ? { key, dir: "desc" } : null;
  if (prev.dir === "desc") return { key, dir: "asc" };
  return null;
}

interface SortableHeadProps {
  label: string;
  sortKey: StatSortKey;
  sort: StatSort | null;
  onToggle: (key: StatSortKey) => void;
  className?: string;
}

// 기간 필터의 정렬 토글(화살표 아이콘 하나)과 같은 언어로 통일 — 이 컬럼이 지금 정렬
// 기준이면 방향에 맞는 화살표 하나(오름차순=위, 내림차순=아래)만, 아직 정렬 기준이
// 아니면(눌러본 적 없거나 다른 컬럼이 활성) 위아래 화살표가 같이 있는 중립 아이콘으로
// "정렬 가능하지만 지금은 안 걸려 있다"는 걸 흐리게 보여준다.
function SortableHead({ label, sortKey, sort, onToggle, className }: SortableHeadProps) {
  const active = sort?.key === sortKey;
  return (
    <button type="button" className={cx("scr-stat-sort-btn", className, active && "scr-stat-sort-btn-active")} onClick={() => onToggle(sortKey)}>
      {label}
      {active
        ? (sort?.dir === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />)
        : <ArrowUpDown size={13} className="scr-stat-sort-icon-idle" />}
    </button>
  );
}

// 경기결과/랭킹과 같은 공용 상단 모듈(SearchFilterBar)로 전적통계를 보여준다.
// 필터 패널(유형/공식)과 목록 타이틀은 없애고 기간(일/주/월)+유저 검색+종족만 남긴다 —
// 정렬(승률순 등)은 그대로 둔다. 종족별 전적을 한 행에 다 보여주는 대신, 검색창에
// "테란"/"프로토스"/"저그" 중 하나를 예약어로 완성하면 전적/게임수/APM/커맨드 전부가
// 그 종족 기준으로 바뀐다 — 랭킹의 종족 필터와 같은 방식(SearchFilterBar의
// raceValue/onRaceChange).
export default function StatsScreenV2() {
  const members = useAppStore((s) => s.members);
  const suggestions = useMemo(() => activeMemberSearchTerms(members), [members]);

  const [search, setSearch] = useState("");
  const [race, setRace] = useState<BaseRace | "all">("all");
  const [sort, setSort] = useState<StatSort | null>({ key: "plays", dir: "desc" });
  const toggleSort = (key: StatSortKey) => setSort((prev) => nextSort(prev, key));
  // 기본값은 "이번 달" — 예전 usePeriodNav(..., "month")과 같은 초기 단위.
  const [periodUnit, setPeriodUnit] = useState<"all" | "month">("month");
  const [periodMonth, setPeriodMonth] = useState(currentMonthValue);

  const { from: effectiveFrom, to: effectiveTo } = useMemo(
    () => (periodUnit === "month" ? monthInputToRange(periodMonth) : { from: "", to: "" }),
    [periodUnit, periodMonth],
  );

  // SearchFilterBar가 이제 엔터를 눌러야만 onSearchChange를 부르므로(점프 방지), search
  // 자체가 이미 확정된 값이다 — 더 늦출 디바운스가 필요 없다.
  const matchedMembers = useMemo(() => {
    return members.filter((m) =>
      m.status !== "withdrawn" && m.status !== "suspended" && memberMatchesQuery(m, search));
  }, [members, search]);

  const queryKey = useMemo(
    () => ({
      dateFrom: effectiveFrom, dateTo: effectiveTo,
      memberIds: matchedMembers.map((m) => m.id).sort().join(","),
    }),
    [effectiveFrom, effectiveTo, matchedMembers],
  );
  const queryKeySignature = useMemo(() => JSON.stringify(queryKey), [queryKey]);
  const debouncedSignature = useDebouncedValue(queryKeySignature, 300);
  const debouncedQuery = useMemo(() => JSON.parse(debouncedSignature) as typeof queryKey, [debouncedSignature]);

  const [statsByMember, setStatsByMember] = useState<Record<string, MemberStatsEntry>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const memberIds = debouncedQuery.memberIds ? debouncedQuery.memberIds.split(",") : [];
    if (memberIds.length === 0) { setStatsByMember({}); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError("");
    api.getMatchStats({
      memberIds,
      dateFrom: debouncedQuery.dateFrom,
      dateTo: debouncedQuery.dateTo,
    }).then((res) => {
      if (cancelled) return;
      const map: Record<string, MemberStatsEntry> = {};
      res.members.forEach((entry) => { map[entry.memberId] = entry; });
      setStatsByMember(map);
    }).catch((e) => {
      if (cancelled) return;
      setError(e instanceof Error ? e.message : "통계를 불러오지 못했어요.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [debouncedQuery]);

  const cards = useMemo(() => {
    const list = matchedMembers.map((m) => {
      const entry = statsByMember[m.id];
      const stats = race === "all" ? (entry?.overall ?? EMPTY_STATS) : (entry?.byRace[race] ?? EMPTY_STATS);
      return { member: m, stats };
    });

    const sorted = [...list];
    const nicknameTiebreak = (a: (typeof list)[number], b: (typeof list)[number]) =>
      a.member.nickname.localeCompare(b.member.nickname);
    const noPlaysLast = (a: (typeof list)[number], b: (typeof list)[number]) => {
      if (a.stats.plays === 0 && b.stats.plays === 0) return nicknameTiebreak(a, b);
      if (a.stats.plays === 0) return 1;
      if (b.stats.plays === 0) return -1;
      return 0;
    };
    // 최소 게임수(MIN_PLAYS_FOR_STATS) 미달이면 승률/APM/커맨드는 화면에 "-"로 가려지므로,
    // 그 값 기준으로 정렬할 땐(게임수 자체로 정렬할 때는 제외) 진짜 데이터가 있는 회원
    // 뒤로 보낸다 — 안 그러면 "-"로 표시되는 행이 값 있는 행들 사이에 뒤섞여 보인다.
    const belowMinLast = (a: (typeof list)[number], b: (typeof list)[number]) => {
      const aBelow = a.stats.plays < MIN_PLAYS_FOR_STATS, bBelow = b.stats.plays < MIN_PLAYS_FOR_STATS;
      if (aBelow && bBelow) return nicknameTiebreak(a, b);
      if (aBelow) return 1;
      if (bBelow) return -1;
      return 0;
    };
    const noAvgLast = (a: (typeof list)[number], b: (typeof list)[number], key: "avgEapm" | "avgEcmd") => {
      const aMissing = a.stats.plays < MIN_PLAYS_FOR_STATS || a.stats[key] === null;
      const bMissing = b.stats.plays < MIN_PLAYS_FOR_STATS || b.stats[key] === null;
      if (aMissing && bMissing) return nicknameTiebreak(a, b);
      if (aMissing) return 1;
      if (bMissing) return -1;
      return 0;
    };
    if (!sort) {
      sorted.sort(nicknameTiebreak);
      return sorted;
    }
    const dirSign = sort.dir === "desc" ? -1 : 1;
    if (sort.key === "name") {
      sorted.sort((a, b) => dirSign * a.member.nickname.localeCompare(b.member.nickname));
    }
    if (sort.key === "rate") {
      sorted.sort((a, b) => belowMinLast(a, b) || dirSign * (a.stats.winRate - b.stats.winRate) || dirSign * (a.stats.plays - b.stats.plays) || nicknameTiebreak(a, b));
    }
    if (sort.key === "plays") {
      sorted.sort((a, b) => noPlaysLast(a, b) || dirSign * (a.stats.plays - b.stats.plays) || nicknameTiebreak(a, b));
    }
    if (sort.key === "eapm") {
      sorted.sort((a, b) => noAvgLast(a, b, "avgEapm") || dirSign * ((a.stats.avgEapm ?? 0) - (b.stats.avgEapm ?? 0)) || nicknameTiebreak(a, b));
    }
    if (sort.key === "ecmd") {
      sorted.sort((a, b) => noAvgLast(a, b, "avgEcmd") || dirSign * ((a.stats.avgEcmd ?? 0) - (b.stats.avgEcmd ?? 0)) || nicknameTiebreak(a, b));
    }
    return sorted;
  }, [matchedMembers, statsByMember, sort, race]);

  const maxOverallPlays = useMemo(
    () => Math.max(1, ...cards.map((c) => c.stats.plays)), [cards],
  );
  const maxEapm = useMemo(
    () => Math.max(1, ...cards.map((c) => c.stats.avgEapm ?? 0)), [cards],
  );
  const maxEcmd = useMemo(
    () => Math.max(1, ...cards.map((c) => c.stats.avgEcmd ?? 0)), [cards],
  );

  return (
    <div className="scr-screen">
      <div className="scr-v2-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">통계</h1>
      </div>

      <SearchFilterBar
        count={cards.length}
        countLabel="명"
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="유저/종족"
        suggestions={suggestions}
        raceValue={race === "all" ? null : race}
        onRaceChange={(r) => setRace(r ?? "all")}
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
          </>
        }
      />

      {error && <div className="scr-err">{error}</div>}

      <p className="scr-hint scr-stats-min-plays-note">
        {MIN_PLAYS_FOR_STATS}회 미만 플레이한 회원은 정확도가 낮아 게임수만 표시해요.
      </p>

      <div className="scr-stats-list-panel-v2">
        {loading && cards.length === 0 ? (
          <div className="scr-empty"><Spinner size={18} /></div>
        ) : cards.length === 0 ? (
          <div className="scr-empty">조건에 맞는 회원이 없어요.</div>
        ) : (
          <div className="scr-stat-table-clip">
            <div className="scr-stat-table scr-scroll">
              {/* 헤더도 데이터 행과 같은 가로 스크롤 컨테이너 안의 평범한 첫 행이다 —
                  더 이상 sticky가 아니라서(요청으로 제거) 페이지 스크롤 기준으로 따로
                  띄워둘 이유가 없어졌고, 그 덕에 이름 칸의 position:sticky;left:0도
                  브라우저가 알아서 처리해준다. 예전엔 헤더가 이 컨테이너 밖에 따로
                  있어서 가로 스크롤때마다 JS(requestAnimationFrame)로 위치를 흉내
                  내야 했는데, 그 흉내가 완벽히 매끈하지 않아 스크롤 중 미세하게
                  흔들려 보였다(실제로 지적받은 문제) — 같은 컨테이너 안에 두면 브라우저
                  네이티브 스크롤이 완벽히 동기화해서 그 흔들림 자체가 원천적으로 사라진다. */}
              <div className="scr-stat-row scr-stat-row-head">
                <SortableHead label="유저" sortKey="name" sort={sort} onToggle={toggleSort} className="scr-stat-name-head" />
                <SortableHead label="게임수" sortKey="plays" sort={sort} onToggle={toggleSort} className="scr-stat-plays-cell" />
                <SortableHead label="승률" sortKey="rate" sort={sort} onToggle={toggleSort} />
                <SortableHead label="유효APM" sortKey="eapm" sort={sort} onToggle={toggleSort} className="scr-stat-eapm-cell" />
                <SortableHead label="유효커맨드/분" sortKey="ecmd" sort={sort} onToggle={toggleSort} className="scr-stat-ecmd-cell" />
              </div>
              {cards.map((c) => (
                <MemberStatRow
                  key={c.member.id}
                  member={c.member}
                  stats={c.stats}
                  belowMinPlays={c.stats.plays < MIN_PLAYS_FOR_STATS}
                  avatar={false}
                  compact
                  maxOverallPlays={maxOverallPlays}
                  maxEapm={maxEapm}
                  maxEcmd={maxEcmd}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
