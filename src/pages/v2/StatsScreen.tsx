import { useEffect, useMemo, useState } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown, RotateCcw } from "lucide-react";
import { Spinner } from "../../components/common/Feedback";
import SearchFilterBar from "../../components/common/SearchFilterBar";
import Select, { type SelectOption } from "../../components/common/Select";
import MemberStatRow from "../stats/MemberStatRow";
import PointDetailModal from "./PointDetailModal";
import RivalryOverlay from "../rivalry/RivalryOverlay";
import InfoTip from "../../components/common/InfoTip";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { activeMemberSearchTerms, memberMatchesQuery } from "../../utils/memberSearch";
import { monthInputToRange, shiftMonthValue, currentMonthValue, monthLabel } from "../../utils/date";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { usePageBackground } from "../../hooks/usePageBackground";
import { cx } from "../../utils/format";
import type { BaseRace, MatchType, Member, MemberStats, MemberStatsEntry } from "../../types";

// 필터 셋은 이제 그리드 제목을 이루는 문장의 낱말이다(요청: "7월 개인전 전체종족"
// 형태로 각각을 드롭다운으로) — 라벨도 문장 안에서 그대로 읽히는 말로 적는다("전체"가
// 아니라 "전체종족").
const RACE_SELECT_OPTS: SelectOption[] = [
  { value: "all", label: "전체종족" },
  { value: "저그", label: "저그" },
  { value: "프로토스", label: "프로토스" },
  { value: "테란", label: "테란" },
];
const TYPE_SELECT_OPTS: SelectOption[] = [
  { value: "0101", label: "개인전" },
  { value: "0102", label: "팀전" },
];
// 기간 드롭다운에서 "전체 기간"을 가리키는 값 — 나머지 값은 전부 "YYYY-MM"이다.
const PERIOD_ALL = "all";
// 기간 드롭다운이 늘어놓을 월의 상한 — 첫 경기 조회가 이상한 값을 주더라도 목록이
// 무한정 길어지지 않게 막는 안전장치일 뿐, 정상 상황에서는 걸리지 않는다.
const MAX_PERIOD_MONTHS = 240;
// 최소 10회 플레이해야 승률/APM 등 세부 지표를 신뢰할 수 있다고 보고, 못 채운 회원은
// 게임수만 보여주고 나머지는 가린다(집계 표본이 너무 적어 왜곡되는 걸 막기 위함).
const MIN_PLAYS_FOR_STATS = 10;

const EMPTY_STATS: MemberStats = {
  plays: 0, wins: 0, losses: 0, draws: 0, winRate: 0,
  avgApm: null, avgEapm: null, avgCmd: null, avgEcmd: null, avgBuild: null,
};

type StatSortKey = "name" | "points" | "rate" | "plays" | "build" | "apm" | "cmd";
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

// 정렬 상태는 화살표 아이콘 하나로 말한다 — 이 컬럼이 지금 정렬
// 기준이면 방향에 맞는 화살표 하나(오름차순=위, 내림차순=아래)만, 아직 정렬 기준이
// 아니면(눌러본 적 없거나 다른 컬럼이 활성) 위아래 화살표가 같이 있는 중립 아이콘으로
// "정렬 가능하지만 지금은 안 걸려 있다"는 걸 흐리게 보여준다.
function SortableHead({ label, sortKey, sort, onToggle, className, tooltip }: SortableHeadProps) {
  const active = sort?.key === sortKey;
  return (
    <button type="button" className={cx("scr-stat-sort-btn", className, active && "scr-stat-sort-btn-active")} onClick={() => onToggle(sortKey)}>
      {label}
      {/* 툴팁·정렬 아이콘은 1스텝 키워 14로 통일(요청 — 15는 안 쓰는 수치). */}
      {tooltip && <InfoTip text={tooltip} label={label} size={14} />}
      {active
        ? (sort?.dir === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />)
        : <ArrowUpDown size={14} className="scr-stat-sort-icon-idle" />}
    </button>
  );
}

// 경기결과/랭킹과 같은 공용 상단 모듈(SearchFilterBar)로 전적통계를 보여준다.
// 조건은 필터창 대신 목록 바로 위의 제목 한 줄이 통째로 맡는다(요청) — "7월 개인전
// 전체종족"처럼 읽히는 문장인데, 그 낱말 셋(기간/유형/종족)이 각각 드롭다운이라
// 제목을 읽는 것이 곧 지금 걸린 조건을 읽는 것이고, 고치는 자리도 같은 자리다. 검색창
// (유저)과 정렬(컬럼 헤더)은 그대로 둔다.
export default function StatsScreenV2() {
  // 사진 배경은 통계 화면 전용이고, 이제 다크에서만 쓴다(요청: "라이트 테마 통계 배경
  // 제거") — 밝은 바탕에서는 사진이 표/글씨와 경쟁만 해서 읽기를 방해했다.
  usePageBackground("/images/bg/stats_bg.jpg", "/images/bg/stats_bg_mobile.png");
  const members = useAppStore((s) => s.members);
  const suggestions = useMemo(() => activeMemberSearchTerms(members), [members]);

  const [search, setSearch] = useState("");
  const [race, setRace] = useState<BaseRace | "all">("all");
  // 게임 유형(개인전/팀전) — 라디오이고 "전체"는 없다. 피드의 랭크 변동 카드 "상세"로
  // 들어왔으면 그 변동의 유형을 미리 걸고(연동, 요청), 일반 진입은 랜덤 기본값(요청).
  const [matchType, setMatchType] = useState<MatchType>(() => {
    const preset = useAppStore.getState().statsPresetMatchType;
    if (preset) {
      useAppStore.getState().setStatsPresetMatchType(null);
      return preset;
    }
    return Math.random() < 0.5 ? "0101" : "0102";
  });
  // 기본 정렬은 포인트(랭크 점수) 내림차순 — 랭킹을 통계에 통합한 기본 모습(요청).
  const [sort, setSort] = useState<StatSort | null>({ key: "points", dir: "desc" });
  // 포인트를 누르면 그 회원의 포인트 상세(경기 이력)를 연다.
  const [pointMember, setPointMember] = useState<Member | null>(null);
  // 상성 관계 오버레이(타이틀 옆 "상성 보기" 버튼).
  const [rivalryOpen, setRivalryOpen] = useState(false);
  const toggleSort = (key: StatSortKey) => setSort((prev) => nextSort(prev, key));
  // 기간은 "전체 기간" 아니면 특정 월("YYYY-MM") 하나 — 예전 단위 알약탭 + 월 선택기를
  // 드롭다운 하나로 합쳤다(요청). 기본값은 이번 달.
  const [period, setPeriod] = useState<string>(currentMonthValue);
  const periodMonth = period === PERIOD_ALL ? "" : period;

  // 기간 드롭다운에 늘어놓을 월의 하한 — 첫 경기가 있는 달. 그보다 과거는 어차피 빈
  // 표라서 목록에 둘 이유가 없다. 한 번만 물어보고, 실패하면 이번 달만 남는다.
  const [firstMonth, setFirstMonth] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.getMatchesPage({ sort: "oldest", limit: 1 })
      .then((page) => {
        if (!cancelled) setFirstMonth(page.items[0]?.date.slice(0, 7) ?? null);
      })
      .catch(() => { /* 목록이 이번 달 하나로 줄 뿐이라 조용히 넘어간다 */ });
    return () => { cancelled = true; };
  }, []);

  const periodOpts = useMemo<SelectOption[]>(() => {
    const now = currentMonthValue();
    const opts: SelectOption[] = [{ value: PERIOD_ALL, label: "전체 기간" }];
    // 최근순(요청) — 이번 달에서 시작해 첫 경기가 있는 달까지 한 달씩 거슬러 내려간다.
    // "YYYY-MM"은 사전순 비교가 곧 시간순 비교라 문자열 비교로 충분하다.
    const stop = firstMonth && firstMonth < now ? firstMonth : now;
    for (let m = now, i = 0; i < MAX_PERIOD_MONTHS; m = shiftMonthValue(m, -1), i += 1) {
      opts.push({ value: m, label: monthLabel(m) });
      if (m <= stop) break;
    }
    return opts;
  }, [firstMonth]);

  const { from: effectiveFrom, to: effectiveTo } = useMemo(
    () => (periodMonth ? monthInputToRange(periodMonth) : { from: "", to: "" }),
    [periodMonth],
  );

  // 문장 끝 초기화 버튼(요청) — 기간과 종족만 되돌리고 분류(개인전/팀전)는 지금 보고 있는
  // 것을 그대로 둔다(요청). 분류는 "전체"가 없는 라디오라 되돌릴 중립값 자체가 없고,
  // 개인전을 보다가 초기화를 눌렀는데 팀전으로 튀면 보던 화면을 잃는다.
  const isDefaultFilter = period === currentMonthValue() && race === "all";
  const resetFilters = () => {
    setPeriod(currentMonthValue());
    setRace("all");
  };

  // SearchFilterBar가 이제 엔터를 눌러야만 onSearchChange를 부르므로(점프 방지), search
  // 자체가 이미 확정된 값이다 — 더 늦출 디바운스가 필요 없다.
  const matchedMembers = useMemo(() => {
    return members.filter((m) =>
      m.status !== "withdrawn" && m.status !== "suspended" && memberMatchesQuery(m, search));
  }, [members, search]);

  // 전달의 같은 조건 — 순위 변동을 견줄 기준선(아래 prevStatsByMember 주석 참고).
  // '전체 기간'에는 견줄 전달이 없으므로 빈 범위로 두고 조회 자체를 건너뛴다.
  const prevRange = useMemo(
    () => (periodMonth
      ? monthInputToRange(shiftMonthValue(periodMonth, -1))
      : { from: "", to: "" }),
    [periodMonth],
  );

  const queryKey = useMemo(
    () => ({
      dateFrom: effectiveFrom, dateTo: effectiveTo, matchType,
      prevFrom: prevRange.from, prevTo: prevRange.to,
      memberIds: matchedMembers.map((m) => m.id).sort().join(","),
    }),
    [effectiveFrom, effectiveTo, prevRange, matchType, matchedMembers],
  );
  const queryKeySignature = useMemo(() => JSON.stringify(queryKey), [queryKey]);
  const debouncedSignature = useDebouncedValue(queryKeySignature, 300);
  const debouncedQuery = useMemo(() => JSON.parse(debouncedSignature) as typeof queryKey, [debouncedSignature]);

  const [statsByMember, setStatsByMember] = useState<Record<string, MemberStatsEntry>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // 전달 같은 조건의 통계 — 포인트 옆 순위 변동(▲2)의 기준선이다.
  //
  // 피드의 '랭크 변동 스냅샷'과는 다른 이야기다(지적): 저쪽은 "직전 순위표 대비 방금
  // 무엇이 바뀌었나"이고, 이쪽은 "지난달 순위와 견주면 지금 몇 계단인가"다. 그래서
  // 스냅샷을 갖다 쓰지 않고, 조회할 때 그 달 통계를 한 번 더 받아 직접 계산한다.
  // '전체 기간'을 보고 있으면 견줄 '전달'이 없어 아예 안 부른다.
  const [prevStatsByMember, setPrevStatsByMember] = useState<Record<string, MemberStatsEntry>>({});

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
      matchType: debouncedQuery.matchType,
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
    // 전달 순위 기준선 — 본 조회와 따로 간다. 실패하면 화살표만 안 나오고 표는 그대로다.
    if (debouncedQuery.prevFrom) {
      api.getMatchStats({
        memberIds,
        dateFrom: debouncedQuery.prevFrom,
        dateTo: debouncedQuery.prevTo,
        matchType: debouncedQuery.matchType,
      }).then((res) => {
        if (cancelled) return;
        const map: Record<string, MemberStatsEntry> = {};
        res.members.forEach((entry) => { map[entry.memberId] = entry; });
        setPrevStatsByMember(map);
      }).catch(() => { if (!cancelled) setPrevStatsByMember({}); });
    } else {
      setPrevStatsByMember({});
    }
    return () => { cancelled = true; };
  }, [debouncedQuery]);

  const cards = useMemo(() => {
    const list = matchedMembers.map((m) => {
      const entry = statsByMember[m.id];
      const stats = race === "all" ? (entry?.overall ?? EMPTY_STATS) : (entry?.byRace[race] ?? EMPTY_STATS);
      // 포인트(랭크 점수) — 이 기간·유형에서 순위 대상이 아니면(0경기 등) null → "-".
      const points = entry?.rankScore != null ? Math.round(entry.rankScore) : null;
      return { member: m, stats, points, entry };
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
    const noAvgLast = (a: (typeof list)[number], b: (typeof list)[number], key: "avgApm" | "avgCmd" | "avgBuild") => {
      const aMissing = a.stats.plays < MIN_PLAYS_FOR_STATS || a.stats[key] === null;
      const bMissing = b.stats.plays < MIN_PLAYS_FOR_STATS || b.stats[key] === null;
      if (aMissing && bMissing) return nicknameTiebreak(a, b);
      if (aMissing) return 1;
      if (bMissing) return -1;
      return 0;
    };
    // 포인트 정렬 보조 — 0점은 오름/내림 어느 방향이든 항상 맨 아래, 포인트 없는(순위
    // 대상 아닌) 회원은 그보다도 아래(요청).
    const noPointsLast = (a: (typeof list)[number], b: (typeof list)[number]) => {
      const tier = (p: number | null) => (p === null ? 2 : p === 0 ? 1 : 0);
      const ta = tier(a.points), tb = tier(b.points);
      if (ta !== tb) return ta - tb;
      if (ta > 0) return nicknameTiebreak(a, b);
      return 0;
    };
    if (!sort) {
      sorted.sort(nicknameTiebreak);
      return sorted;
    }
    const dirSign = sort.dir === "desc" ? -1 : 1;
    if (sort.key === "points") {
      sorted.sort((a, b) => noPointsLast(a, b) || dirSign * ((a.points ?? 0) - (b.points ?? 0)) || nicknameTiebreak(a, b));
    }
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
    if (sort.key === "apm") {
      sorted.sort((a, b) => noAvgLast(a, b, "avgApm") || dirSign * ((a.stats.avgApm ?? 0) - (b.stats.avgApm ?? 0)) || nicknameTiebreak(a, b));
    }
    if (sort.key === "cmd") {
      sorted.sort((a, b) => noAvgLast(a, b, "avgCmd") || dirSign * ((a.stats.avgCmd ?? 0) - (b.stats.avgCmd ?? 0)) || nicknameTiebreak(a, b));
    }
    return sorted;
  }, [matchedMembers, statsByMember, sort, race]);

  // 지금 몇 위인가 — 서버가 매긴 자리번호(sortOrder)로 줄을 세우고 완전 동률(tieGroup)은
  // 공동순위(1,1,3)로 묶는다. 백엔드가 순위표를 만들 때 쓰는 규칙(_compute_standings)과
  // 같은 계산이라, 여기 순위와 랭크 변동 카드의 순위가 어긋나지 않는다.
  // 표의 정렬(sort)과는 무관하다 — 순위는 정렬을 바꿔도 그 사람의 순위 그대로여야 한다.
  const rankOf = (by: Record<string, MemberStatsEntry>): Map<string, number> => {
    const ranked = matchedMembers
      .map((m) => by[m.id])
      .filter((e): e is MemberStatsEntry => !!e && e.sortOrder != null && e.tieGroup != null)
      .filter((e) => e.overall.plays > 0)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const out = new Map<string, number>();
    let rank = 0;
    ranked.forEach((e, i) => {
      if (i === 0 || e.tieGroup !== ranked[i - 1].tieGroup) rank = i + 1;
      out.set(e.memberId, rank);
    });
    return out;
  };
  const rankByMember = useMemo(
    () => rankOf(statsByMember),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matchedMembers, statsByMember],
  );
  // 전달 대비 몇 계단 움직였나(+면 상승, 요청) — 같은 규칙으로 전달 순위를 매겨 뺀다.
  // 지난달에 순위가 없던 사람(그 달에 안 뛴 사람)은 견줄 값이 없어 화살표를 안 단다.
  const rankDeltaByMember = useMemo(() => {
    const prevRank = rankOf(prevStatsByMember);
    const out = new Map<string, number>();
    for (const [id, now] of rankByMember) {
      const before = prevRank.get(id);
      if (before === undefined || before === now) continue;
      out.set(id, before - now);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankByMember, prevStatsByMember, matchedMembers]);

  const maxOverallPlays = useMemo(
    () => Math.max(1, ...cards.map((c) => c.stats.plays)), [cards],
  );
  const maxBuild = useMemo(
    () => Math.max(1, ...cards.map((c) => c.stats.avgBuild ?? 0)), [cards],
  );
  const maxApm = useMemo(
    () => Math.max(1, ...cards.map((c) => c.stats.avgApm ?? 0)), [cards],
  );
  const maxCmd = useMemo(
    () => Math.max(1, ...cards.map((c) => c.stats.avgCmd ?? 0)), [cards],
  );

  return (
    <div className="scr-screen scr-stats-screen-v2">
      <div className="scr-v2-toolbar">
        <div className="scr-v2-toolbar-title-row">
          <h1 className="scr-title scr-v2-toolbar-title">통계</h1>
          {/* 상성 보기 — 랭킹 화면이 없어지면서 진입점이 끊겼던 상성 관계 오버레이를 통계
              타이틀 옆에 다시 붙인다(요청). 기간은 이 화면의 현재 필터를 그대로 따른다
              (오버레이 자체 필터 없음 — RivalryOverlay 주석 참고). */}
          <button
            type="button"
            className="scr-btn scr-btn-primary scr-rivalry-open-btn"
            onClick={() => setRivalryOpen(true)}
          >
            상성 보기
          </button>
        </div>
      </div>

      <SearchFilterBar
        count={cards.length}
        countLabel="명"
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="유저 검색"
        suggestions={suggestions}
        // 필터창(분류/종족/기간 세 덩어리)은 없앴다(요청) — 그 셋을 목록 바로 위의 제목
        // 문장으로 옮겼다. 제목이 곧 지금 걸린 조건이라 따로 읽을 필터 UI가 없다.
        heading={
          <div className="scr-grid-title">
            {/* 각 칸은 제 목록에서 가장 긴 낱말에 맞춰 폭이 잡힌다(요청) — 셋을 같은 폭으로
                맞춰 봤더니 짧은 낱말 칸에 빈자리만 커졌다. 고른 값이 바뀌어도 그 칸 폭은
                그대로라, 레이아웃이 흔들리지 않는다는 성질은 그대로다. */}
            <Select
              fixedWidth
              className="scr-sentence-select" value={period} options={periodOpts}
              onChange={setPeriod} minDropWidth={150}
            />
            <Select
              fixedWidth
              className="scr-sentence-select" value={matchType} options={TYPE_SELECT_OPTS}
              onChange={(v) => setMatchType(v as MatchType)} minDropWidth={120}
            />
            {/* 마지막 낱말과 초기화는 한 덩어리로 — 줄이 좁아 넘칠 때 초기화만 다음 줄에
                외따로 떨어지지 않게 한다. */}
            <span className="scr-grid-title-tail">
              <Select
                fixedWidth
                className="scr-sentence-select" value={race} options={RACE_SELECT_OPTS}
                onChange={(v) => setRace(v as BaseRace | "all")} minDropWidth={130}
              />
              {/* 초기화(요청) — 문장 끝에 붙여 기간·종족을 한 번에 되돌린다(분류는 유지).
                  이미 기본값이면 누를 게 없으니 흐리게 죽여 둔다. 검색어(유저)는 이 문장
                  밖의 별개 필터라 건드리지 않는다 — 칩마다 제 ×가 있다. */}
              <button
                type="button" className="scr-grid-title-reset"
                onClick={resetFilters} disabled={isDefaultFilter}
                aria-label="필터 초기화" title="필터 초기화"
              >
                <RotateCcw size={14} aria-hidden />
              </button>
            </span>
          </div>
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
                <SortableHead
                  label="포인트" sortKey="points" sort={sort} onToggle={toggleSort}
                  tooltip="랭크 포인트 — 이 기간·분류의 경기들로 산정한 레이팅 점수. 괄호 안은 지금 순위와 전달 대비 변동이에요(전체 기간을 보면 견줄 전달이 없어 변동은 안 나와요). 숫자를 누르면 경기 이력(경기당 포인트 변화)이 열려요."
                />
                <SortableHead label="게임수" sortKey="plays" sort={sort} onToggle={toggleSort} />
                <SortableHead label="승률" sortKey="rate" sort={sort} onToggle={toggleSort} />
                <SortableHead
                  label="생산" sortKey="build" sort={sort} onToggle={toggleSort}
                  tooltip="경기당 평균 '생산'(유닛 훈련+건물 건설+저그 변태 커맨드 수) — 유닛·건물을 얼마나 뽑고 지었나의 어림 지표."
                />
                <SortableHead
                  label="APM" sortKey="apm" sort={sort} onToggle={toggleSort}
                  tooltip="분당 조작 수(Actions Per Minute) — 리플레이에 기록된 명령을 분 단위로 나눈 값. 화면 이동이나 중복 클릭도 그대로 세므로 실제 손이 얼마나 바빴는지에 가깝다."
                />
                <SortableHead
                  label="커맨드" sortKey="cmd" sort={sort} onToggle={toggleSort}
                  tooltip="경기당 평균 명령 수 — 리플레이에 기록된 명령을 전부 센 값(한 경기에서 몇 번이나 입력했나)."
                />
              </div>
              {cards.map((c) => (
                <MemberStatRow
                  key={c.member.id}
                  member={c.member}
                  stats={c.stats}
                  points={c.points}
                  rank={rankByMember.get(c.member.id) ?? null}
                  rankDelta={rankDeltaByMember.get(c.member.id) ?? null}
                  onPointsClick={() => setPointMember(c.member)}
                  belowMinPlays={c.stats.plays < MIN_PLAYS_FOR_STATS}
                  compact
                  maxOverallPlays={maxOverallPlays}
                  maxBuild={maxBuild}
                  maxApm={maxApm}
                  maxCmd={maxCmd}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 포인트 상세 — 그래프/소제목 없이 경기 이력만(요청, 예전 랭킹 상세 대체). */}
      {pointMember && (
        <PointDetailModal
          member={pointMember}
          matchType={matchType}
          period={{ from: effectiveFrom, to: effectiveTo }}
          race={race}
          onClose={() => setPointMember(null)}
        />
      )}

      {/* 상성 관계 — 기간은 이 화면의 현재 필터를 그대로 쓴다(개인전 고정). */}
      {rivalryOpen && (
        <RivalryOverlay
          from={effectiveFrom}
          to={effectiveTo}
          onClose={() => setRivalryOpen(false)}
        />
      )}
    </div>
  );
}
