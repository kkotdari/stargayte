import { useEffect, useMemo, useState } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { Spinner } from "../../components/common/Feedback";
import SearchFilterBar from "../../components/common/SearchFilterBar";
import PillTabs from "../../components/common/PillTabs";
import FilterItem from "../../components/common/FilterItem";
import Select from "../../components/common/Select";
import MemberStatRow from "../stats/MemberStatRow";
import InfoTip from "../../components/common/InfoTip";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { activeMemberSearchTerms, memberMatchesQuery } from "../../utils/memberSearch";
import { monthInputToRange, currentMonthValue, MONTH_INPUT_MIN, MONTH_INPUT_MAX } from "../../utils/date";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { cx } from "../../utils/format";
import type { BaseRace, MemberStats, MemberStatsEntry } from "../../types";

// 종족 필터 — 검색창 예약어에서 필터창 드롭다운으로 옮겼다(요청).
const RACE_SELECT_OPTS = [
  { value: "all", label: "전체", shortLabel: "종족" },
  { value: "테란", label: "테란" },
  { value: "프로토스", label: "프로토스" },
  { value: "저그", label: "저그" },
];
const PERIOD_UNIT_OPTS: { value: "all" | "month"; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "month", label: "월" },
];
// 최소 10회 플레이해야 승률/APM 등 세부 지표를 신뢰할 수 있다고 보고, 못 채운 회원은
// 게임수만 보여주고 나머지는 가린다(집계 표본이 너무 적어 왜곡되는 걸 막기 위함).
const MIN_PLAYS_FOR_STATS = 10;

const EMPTY_STATS: MemberStats = {
  plays: 0, wins: 0, losses: 0, draws: 0, winRate: 0,
  avgApm: null, avgEapm: null, avgCmd: null, avgEcmd: null, avgBuild: null,
};

type StatSortKey = "name" | "rate" | "plays" | "build" | "eapm" | "ecmd";
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
  // 있으면 라벨 옆에 ⓘ를 띄우고 탭하면 이 설명 말풍선을 보여준다(요청: 컬럼 설명 툴팁).
  tooltip?: string;
}

// 기간 필터의 정렬 토글(화살표 아이콘 하나)과 같은 언어로 통일 — 이 컬럼이 지금 정렬
// 기준이면 방향에 맞는 화살표 하나(오름차순=위, 내림차순=아래)만, 아직 정렬 기준이
// 아니면(눌러본 적 없거나 다른 컬럼이 활성) 위아래 화살표가 같이 있는 중립 아이콘으로
// "정렬 가능하지만 지금은 안 걸려 있다"는 걸 흐리게 보여준다.
function SortableHead({ label, sortKey, sort, onToggle, className, tooltip }: SortableHeadProps) {
  const active = sort?.key === sortKey;
  return (
    <button type="button" className={cx("scr-stat-sort-btn", className, active && "scr-stat-sort-btn-active")} onClick={() => onToggle(sortKey)}>
      {label}
      {tooltip && <InfoTip text={tooltip} label={label} />}
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
    const noAvgLast = (a: (typeof list)[number], b: (typeof list)[number], key: "avgEapm" | "avgEcmd" | "avgBuild") => {
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
    if (sort.key === "build") {
      sorted.sort((a, b) => noAvgLast(a, b, "avgBuild") || dirSign * ((a.stats.avgBuild ?? 0) - (b.stats.avgBuild ?? 0)) || nicknameTiebreak(a, b));
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
  const maxBuild = useMemo(
    () => Math.max(1, ...cards.map((c) => c.stats.avgBuild ?? 0)), [cards],
  );
  const maxEapm = useMemo(
    () => Math.max(1, ...cards.map((c) => c.stats.avgEapm ?? 0)), [cards],
  );
  const maxEcmd = useMemo(
    () => Math.max(1, ...cards.map((c) => c.stats.avgEcmd ?? 0)), [cards],
  );

  return (
    <div className="scr-screen scr-stats-screen-v2">
      <div className="scr-v2-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">통계</h1>
      </div>

      <SearchFilterBar
        count={cards.length}
        countLabel="명"
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="@로 유저 추가"
        suggestions={suggestions}
        filterPanel={
          <>
            {/* 기간 단위 알약탭과 그에 딸린 달력은 원래 하나의 요소 — 종족 필터가
                둘 사이에 끼어 그룹이 갈라지지 않도록 같은 FilterItem 안에 붙여 두고,
                종족은 그 뒤(기간·달력 → 종족 순)에 배치한다. */}
            <FilterItem label="기간">
              <PillTabs options={PERIOD_UNIT_OPTS} value={periodUnit} onChange={setPeriodUnit} aria-label="기간" />
              {periodUnit === "month" && (
                <input
                  type="month" className="scr-filter-month-input"
                  min={MONTH_INPUT_MIN} max={MONTH_INPUT_MAX}
                  value={periodMonth} onChange={(e) => setPeriodMonth(e.target.value)}
                  aria-label="조회할 월"
                />
              )}
            </FilterItem>
            {/* 종족은 검색창 예약어 대신 필터 드롭다운으로(요청). */}
            <FilterItem label="종족">
              <Select
                value={race}
                options={RACE_SELECT_OPTS}
                onChange={(v) => setRace(v as BaseRace | "all")}
                size="sm"
                minDropWidth={110}
                className="scr-filter-race-select"
              />
            </FilterItem>
          </>
        }
      />

      {error && <div className="scr-err">{error}</div>}

      <div className="scr-stats-list-panel-v2">
        {/* 첫 로딩 때는 통계가 아직 없어 모든 회원의 게임수가 0 → 닉네임순으로 잠깐 정렬됐다가,
            데이터가 도착하면 게임수순으로 재정렬되며 목록이 튀는 문제가 있었다(신고). 통계가
            한 번도 안 들어온 상태(statsByMember 비어 있음)에서는 목록 대신 스피너만 보여줘서
            그 중간 단계(닉네임순 배치)를 화면에 노출하지 않는다. 필터를 바꿔 재조회할 때는
            이전 통계가 남아 있어 목록을 계속 보여준 채 갱신된다. */}
        {loading && Object.keys(statsByMember).length === 0 ? (
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
                <SortableHead
                  label="생산" sortKey="build" sort={sort} onToggle={toggleSort} className="scr-stat-build-cell"
                  tooltip="경기당 평균 '생산'(유닛 훈련+건물 건설+저그 변태 커맨드 수) — 유닛·건물을 얼마나 뽑고 지었나의 어림 지표."
                />
                <SortableHead
                  label="유효APM" sortKey="eapm" sort={sort} onToggle={toggleSort} className="scr-stat-eapm-cell"
                  tooltip="분당 유효 조작 수(EAPM) — 리플레이에서 실제 게임에 영향을 준 명령만 센 APM. 화면 이동·중복 클릭 같은 불필요한 입력은 빠져 순수 조작량에 가깝다."
                />
                <SortableHead
                  label="유효커맨드/분" sortKey="ecmd" sort={sort} onToggle={toggleSort} className="scr-stat-ecmd-cell"
                  tooltip="유효 명령 총합을 경기 시간(분)으로 나눈 값 — 경기 길이가 제각각이라 총합 대신 분당으로 환산해 공정하게 비교한다."
                />
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
                  maxBuild={maxBuild}
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
