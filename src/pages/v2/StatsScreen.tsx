import { useEffect, useMemo, useState } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown, RotateCcw } from "lucide-react";
import { Spinner } from "../../components/common/Feedback";
import SearchFilterBar from "../../components/common/SearchFilterBar";
import Select, { type SelectOption } from "../../components/common/Select";
import MemberStatRow, { type StatColumnMedals } from "../stats/MemberStatRow";
import PointDetailModal from "./PointDetailModal";
import RankTrendModal from "./RankTrendModal";
import { rankOf } from "./rankOrder";
import RivalryOverlay from "../rivalry/RivalryOverlay";
import InfoTip from "../../components/common/InfoTip";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { activeMemberSearchTerms, memberMatchesQuery } from "../../utils/memberSearch";
import { monthInputToRange, shiftMonthValue, currentMonthValue, monthLabel } from "../../utils/date";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { usePageBackground } from "../../hooks/usePageBackground";
import { cx } from "../../utils/format";
import type { BaseRace, GameResultStatsResponse, GameType, Member, MemberStats, MemberStatsEntry } from "../../types";

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
/* 세부 지표(승률·APM·커맨드·포인트·순위) 표본 미달 판정은 백엔드가 전담한다(요청: 프론트에서
   경기수로 필터링하는 것 자체를 없앰) — 프론트는 그 값을 그대로 보여주고, null이면 "-"로만
   바꾼다. 최소 판수 기준(game_results/service.py의 _MIN_PLAYS_FOR_RANK)이 바뀌어도 여기는
   손댈 게 없다. */
// 지난 기간의 각 칸 1·2·3위에 붙일 메달(요청) — 순서가 곧 등수다.
const MEDALS = ["🥇", "🥈", "🥉"];

const EMPTY_STATS: MemberStats = {
  plays: 0, wins: 0, losses: 0, draws: 0, winRate: 0,
  avgApm: null, avgEapm: null, avgCmd: null, avgEcmd: null, avgBuild: null, buildMix: null, avgWorker5: null,
};

type StatSortKey = "name" | "rank" | "points" | "rate" | "plays" | "build" | "apm" | "cmd";
type StatSortDir = "desc" | "asc";
interface StatSort { key: StatSortKey; dir: StatSortDir }

// 컬럼 헤더를 누르면 내림차순 → 오름차순 → 미설정(다시 누르기 전 상태로) 순서로 도는
// 3단 토글 — 같은 컬럼을 다시 누르면 방향만 바뀌고, 다른 컬럼을 누르면 그 컬럼의
// 내림차순부터 새로 시작한다(한 번에 하나의 정렬 기준만 유지).
function nextSort(prev: StatSort | null, key: StatSortKey): StatSort | null {
  // 유저(이름)와 랭크만 오름차순부터 시작하는 게 자연스러워 시작 방향과 토글 순서를
  // 반대로 둔다(asc -> desc -> null) — 이름은 가나다순, 랭크는 숫자가 작을수록 좋은
  // 성적이라 1위부터가 맨 위다. 나머지 지표는 그대로 desc -> asc -> null.
  const ascFirst = key === "name" || key === "rank";
  if (!prev || prev.key !== key) return { key, dir: ascFirst ? "asc" : "desc" };
  if (ascFirst) return prev.dir === "asc" ? { key, dir: "desc" } : null;
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
  // 게임 유형(개인전/팀전) — 라디오이고 "전체"는 없다. 기본값은 랜덤(요청).
  // (삭제) 피드의 랭크 변동 카드에서 유형을 미리 걸어 주는 연동이 있었는데, 그 입구였던
  // "실시간 랭크 확인" 링크를 걷어내면서(요청) 걸어 줄 사람이 없어졌다.
  const [matchType, setMatchType] = useState<GameType>(
    () => (Math.random() < 0.5 ? "0101" : "0102"),
  );
  // 기본 정렬은 포인트(랭크 점수) 내림차순 — 랭킹을 통계에 통합한 기본 모습(요청).
  const [sort, setSort] = useState<StatSort | null>({ key: "points", dir: "desc" });
  // 포인트를 누르면 그 회원의 포인트 상세(경기 이력)를 연다.
  const [pointMember, setPointMember] = useState<Member | null>(null);
  // 월간 랭크를 누르면 그 회원의 최근 다섯 달 순위변동 그래프를 연다(요청). 전체 기간을
  // 볼 때는 견줄 달이 없어 열 게 없다 — 그래서 아래에서 월일 때만 클릭을 붙인다.
  const [trendMember, setTrendMember] = useState<Member | null>(null);
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
    api.getGameResultsPage({ sort: "oldest", limit: 1 })
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
      // 종족도 서버에 넘긴다 — 승률/APM 같은 전적은 응답의 byRace로 골라 쓰면 되지만,
      // 포인트(rankScore)와 순위(sortOrder)는 레이팅을 시간순으로 누적해 만든 값이라
      // 클라이언트가 종족별로 갈라낼 수 없다. 안 넘기면 종족을 골라도 포인트만 전체
      // 종족 기준으로 남아 표 안에서 기준이 어긋난다(지적).
      race,
      // 기간 자체도 함께 담는다 — 값은 위 dateFrom/dateTo에 이미 들어 있지만, 받아 온
      // 한 장(StatsView)이 '어느 달의 값인가'를 스스로 알고 있어야 메달·순위변동을
      // 그 달 기준으로 그린다(아래 view 주석).
      period,
      prevFrom: prevRange.from, prevTo: prevRange.to,
      memberIds: matchedMembers.map((m) => m.id).sort().join(","),
    }),
    [effectiveFrom, effectiveTo, prevRange, matchType, race, period, matchedMembers],
  );
  const queryKeySignature = useMemo(() => JSON.stringify(queryKey), [queryKey]);
  const debouncedSignature = useDebouncedValue(queryKeySignature, 300);
  const debouncedQuery = useMemo(() => JSON.parse(debouncedSignature) as typeof queryKey, [debouncedSignature]);

  /* 화면이 그리는 '한 장' — 조건과 그 조건으로 받은 값이 한 몸이다.
     예전에는 조건(기간·종족)은 state로 따로 있고 통계는 통계대로, 전달 통계는 또 그것대로
     따로 들어왔다. 그래서 필터를 바꾸면 화면이 중간 단계를 그대로 내보였다(지적):
       - 기간만 먼저 바뀌고 통계는 아직 지난 조건 것이라, 끝난 달에만 붙는 메달이 엉뚱한
         값으로 매겨졌다("알 수 없는 순위 배지").
       - 본 통계가 먼저 도착해 포인트·랭크가 한 번 바뀌고, 몇백 ms 뒤 전달 통계가 도착해
         순위 변동(▲2·신규)이 또 한 번 바뀌었다.
     이제 한 장을 통째로 갈아 끼운다 — 두 조회가 다 끝난 뒤 한 번만 그린다(요청).
     메달·순위변동·종족 고르기까지 전부 이 안의 값으로만 계산하므로, 조건과 값이 어긋난
     그림이 애초에 만들어지지 않는다. */
  interface StatsView {
    /** 이 한 장을 만든 조건(debouncedSignature) — 지금 조건과 다르면 갱신 중이라는 뜻이다. */
    key: string;
    race: BaseRace | "all";
    /** "YYYY-MM", '전체 기간'이면 빈 문자열. */
    periodMonth: string;
    period: string;
    /** 이 조건으로 물어본 회원들 — 검색으로 걸러진 목록도 한 장 안에 함께 얼어 있다. */
    memberIds: string[];
    stats: Record<string, MemberStatsEntry>;
    /** 전달 같은 조건의 통계 — 포인트 옆 순위 변동(▲2)의 기준선이다.
     *
     *  피드의 '랭크 변동 스냅샷'과는 다른 이야기다(지적): 저쪽은 "직전 순위표 대비 방금
     *  무엇이 바뀌었나"이고, 이쪽은 "지난달 순위와 견주면 지금 몇 계단인가"다. 그래서
     *  스냅샷을 갖다 쓰지 않고, 조회할 때 그 달 통계를 한 번 더 받아 직접 계산한다.
     *  '전체 기간'을 보고 있으면 견줄 '전달'이 없어 아예 안 부른다. */
    prev: Record<string, MemberStatsEntry>;
  }
  const [view, setView] = useState<StatsView | null>(null);
  const [error, setError] = useState("");
  /** 아직 한 장도 못 그렸나 / 새 조건의 한 장을 기다리는 중인가. */
  const firstLoad = view === null;
  const refreshing = view !== null && view.key !== debouncedSignature;

  useEffect(() => {
    const memberIds = debouncedQuery.memberIds ? debouncedQuery.memberIds.split(",") : [];
    const blank = {
      key: debouncedSignature,
      race: debouncedQuery.race,
      periodMonth: debouncedQuery.period === PERIOD_ALL ? "" : debouncedQuery.period,
      period: debouncedQuery.period,
      memberIds,
    };
    if (memberIds.length === 0) { setView({ ...blank, stats: {}, prev: {} }); return; }
    let cancelled = false;
    setError("");
    const byId = (res: GameResultStatsResponse) => {
      const map: Record<string, MemberStatsEntry> = {};
      res.members.forEach((entry) => { map[entry.memberId] = entry; });
      return map;
    };
    const mine = api.getGameResultStats({
      memberIds,
      dateFrom: debouncedQuery.dateFrom,
      dateTo: debouncedQuery.dateTo,
      matchType: debouncedQuery.matchType,
      race: debouncedQuery.race,
    });
    // 전달 기준선은 없어도 표는 그대로다 — 실패하면 화살표만 안 나온다. 그래도 기다렸다가
    // 함께 그린다: 늦게 도착해 순위 변동만 뒤늦게 뜨는 것이 바로 지적받은 그림이다.
    const before = debouncedQuery.prevFrom
      ? api.getGameResultStats({
        memberIds,
        dateFrom: debouncedQuery.prevFrom,
        dateTo: debouncedQuery.prevTo,
        matchType: debouncedQuery.matchType,
        race: debouncedQuery.race,
      }).catch(() => null)
      : Promise.resolve(null);
    Promise.all([mine, before]).then(([res, prevRes]) => {
      if (cancelled) return;
      setView({ ...blank, stats: byId(res), prev: prevRes ? byId(prevRes) : {} });
    }).catch((e) => {
      if (cancelled) return;
      setError(e instanceof Error ? e.message : "통계를 불러오지 못했어요.");
      // 조건이 바뀌었는데 새 값을 못 받았으면 옛 값을 그대로 두지 않는다 — 그게 바로
      // '조건과 값이 어긋난 그림'이다. 빈 한 장으로 갈아 끼우고 오류 문구를 함께 보여준다.
      setView({ ...blank, stats: {}, prev: {} });
    });
    return () => { cancelled = true; };
  }, [debouncedQuery, debouncedSignature]);

  // 지금 몇 위인가 — 규칙은 rankOrder.ts에 있다(순위변동 모달이 달마다 같은 계산을
  // 다시 해야 해서 밖으로 뺐다). 표의 정렬(sort)과는 무관하다 — 순위는 정렬을 바꿔도
  // 그 사람의 순위 그대로여야 한다.
  /* 표에 늘어놓을 회원 — 지금 검색 결과(matchedMembers)가 아니라 '받아 온 한 장'이 물어본
     회원들이다. 검색어도 조회 조건이라, 새 결과가 오기 전에 목록만 먼저 바뀌면 그 사람들
     자리에 남의 통계가 잠깐 앉는다. 이름·아바타는 늘 지금 것으로 읽는다(회원 정보가 바뀌면
     표도 바로 따라간다) — 얼려 두는 것은 '누구를 보여줄까'뿐이다. */
  const viewMembers = useMemo(() => {
    if (!view) return [];
    const byId = new Map(members.map((m) => [m.id, m]));
    return view.memberIds.map((id) => byId.get(id)).filter((m): m is Member => m !== undefined);
  }, [view, members]);

  /** 지금 표에 그려져 있는 한 장의 기간 — 칸 이름·순위변동처럼 '보이는 값'을 설명하는
   *  자리에는 지금 고른 기간(periodMonth)이 아니라 이 값을 쓴다. */
  const shownMonth = view?.periodMonth ?? "";

  const rankPool = useMemo(() => view?.memberIds ?? [], [view]);
  const rankByMember = useMemo(
    () => rankOf(view?.stats ?? {}, rankPool),
    [rankPool, view],
  );
  // 전달 대비 몇 계단 움직였나(+면 상승, 요청) — 같은 규칙으로 전달 순위를 매겨 뺀다.
  // 지난달에 순위가 없던 사람(그 달에 안 뛴 사람)은 "new"로 표시한다(요청: "월간 랭크
  // 옆에 전월대비 순위 변동, 신규면 신규 표시"). '전체 기간'을 보고 있을 때는 애초에
  // 견줄 전달 데이터를 안 받으므로(prevStatsByMember 조회 자체를 건너뜀) periodMonth로
  // 한 번 더 막는다 — 안 막으면 누구나 "신규"로 보인다.
  const rankDeltaByMember = useMemo(() => {
    const prevRank = rankOf(view?.prev ?? {}, rankPool);
    const out = new Map<string, number | "new">();
    for (const [id, now] of rankByMember) {
      const before = prevRank.get(id);
      if (before === undefined) {
        if (view?.periodMonth) out.set(id, "new");
        continue;
      }
      if (before === now) continue;
      out.set(id, before - now);
    }
    return out;
  }, [rankByMember, view, rankPool]);

  const cards = useMemo(() => {
    const shown = view?.race ?? "all";
    const list = viewMembers.map((m) => {
      const entry = view?.stats[m.id];
      const stats = shown === "all" ? (entry?.overall ?? EMPTY_STATS) : (entry?.byRace[shown] ?? EMPTY_STATS);
      // 포인트(랭크 점수) — 이 기간·유형에 한 판도 안 뛰었으면 null → "-"(최소 게임수는
      // 안 따진다. 백엔드 _apply_rank_order 주석 참고).
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
    // 값이 없는(null) 회원을 뒤로 보낸다 — 표본 미달 판정은 백엔드가 이미 null로 내려주므로
    // (요청: 프론트에서 경기수로 필터링하지 않음) 여기서는 그 null 여부만 본다.
    const noAvgLast = (a: (typeof list)[number], b: (typeof list)[number], key: "avgApm" | "avgCmd" | "avgBuild") => {
      const aMissing = a.stats[key] === null;
      const bMissing = b.stats[key] === null;
      if (aMissing && bMissing) return nicknameTiebreak(a, b);
      if (aMissing) return 1;
      if (bMissing) return -1;
      return 0;
    };
    // 포인트 정렬 보조 — 포인트가 없는(순위 대상이 아닌) 회원만 항상 맨 아래로 보낸다.
    // 0점을 따로 맨 아래로 내리던 보정은 없앴다(요청): 포인트가 승점이던 시절에는 0이
    // "아직 없음"과 같은 뜻이었지만, 지금은 레이팅이라 음수도 나온다 — 그때 0만 -14보다
    // 아래로 가면 목록 순서와 옆의 순위 뱃지가 서로 어긋나 보인다.
    const noPointsLast = (a: (typeof list)[number], b: (typeof list)[number]) => {
      const ta = a.points === null ? 1 : 0, tb = b.points === null ? 1 : 0;
      if (ta !== tb) return ta - tb;
      if (ta === 1) return nicknameTiebreak(a, b);
      return 0;
    };
    if (!sort) {
      sorted.sort(nicknameTiebreak);
      return sorted;
    }
    const dirSign = sort.dir === "desc" ? -1 : 1;
    // 데이터 칸(랭크·유저 제외) 하나를 비교한다 — 값이 없는 쪽은 방향과 무관하게 항상
    // 맨 아래(위 noPointsLast/noPlaysLast/noAvgLast), 있으면 지금 선택된 방향(dirSign)
    // 그대로 크고 작음을 비교한다(요청: "오름차순인지 내림차순인지도 따져서" — 타이브레이크도
    // 반대로 뒤집힐 수 있다는 뜻).
    type DataKey = "points" | "plays" | "rate" | "build" | "apm" | "cmd";
    const compareData = (key: DataKey, a: (typeof list)[number], b: (typeof list)[number]) => {
      switch (key) {
        case "points": return noPointsLast(a, b) || dirSign * ((a.points ?? 0) - (b.points ?? 0));
        case "plays": return noPlaysLast(a, b) || dirSign * (a.stats.plays - b.stats.plays);
        case "rate": return noPlaysLast(a, b) || dirSign * (a.stats.winRate - b.stats.winRate);
        case "build": return noAvgLast(a, b, "avgBuild") || dirSign * ((a.stats.avgBuild ?? 0) - (b.stats.avgBuild ?? 0));
        case "apm": return noAvgLast(a, b, "avgApm") || dirSign * ((a.stats.avgApm ?? 0) - (b.stats.avgApm ?? 0));
        case "cmd": return noAvgLast(a, b, "avgCmd") || dirSign * ((a.stats.avgCmd ?? 0) - (b.stats.avgCmd ?? 0));
      }
    };
    // 타이브레이크 우선순위 — 표의 칸 순서 그대로(포인트 > 게임수 > 승률 > 생산 > APM >
    // 커맨드, 요청: "타이인 경우 앞에서부터 순서대로 적용"). 지금 고른 칸은 이미 맨 앞으로
    // 당겨 첫 비교로 쓰고, 나머지는 이 순서 그대로 이어서 본다. 랭크는 포인트와 사실상
    // 같은 값이라(동점=공동순위) 별도 타이브레이크 칸으로 안 쓴다(요청) — 랭크가 갈리지
    // 않으면 포인트도 갈리지 않으므로 그대로 다음 칸(게임수)으로 자연히 넘어간다. 유저
    // 닉네임은 숫자 칸이 전부 같을 때만 쓰는 최후의 보루(요청: "닉네임이 마지막")다.
    const DATA_ORDER: DataKey[] = ["points", "plays", "rate", "build", "apm", "cmd"];
    const tiebreakChain = (primary: DataKey | null) => {
      const order = primary ? [primary, ...DATA_ORDER.filter((k) => k !== primary)] : DATA_ORDER;
      return (a: (typeof list)[number], b: (typeof list)[number]) => {
        for (const key of order) {
          const c = compareData(key, a, b);
          if (c) return c;
        }
        return nicknameTiebreak(a, b);
      };
    };
    if (sort.key === "name") {
      sorted.sort((a, b) => dirSign * a.member.nickname.localeCompare(b.member.nickname));
      return sorted;
    }
    // 랭크 — 순위가 없는(한 판도 안 뛴) 회원은 방향과 무관하게 맨 아래. 공동순위(랭크가
    // 갈리지 않음)는 포인트부터 시작하는 위 타이브레이크 체인으로 넘어간다(랭크=포인트라
    // 포인트도 당연히 갈리지 않고 자연히 게임수로 넘어간다).
    if (sort.key === "rank") {
      const rankValue = (c: (typeof list)[number]) => rankByMember.get(c.member.id) ?? null;
      const breakTie = tiebreakChain(null);
      sorted.sort((a, b) => {
        const ra = rankValue(a), rb = rankValue(b);
        if (ra === null || rb === null) {
          if (ra === null && rb === null) return nicknameTiebreak(a, b);
          return ra === null ? 1 : -1;
        }
        return dirSign * (ra - rb) || breakTie(a, b);
      });
      return sorted;
    }
    sorted.sort(tiebreakChain(sort.key as DataKey));
    return sorted;
  }, [viewMembers, view, sort, rankByMember]);


  /* 이미 끝난 달을 볼 때는 각 칸의 1·2·3위에 메달을 붙인다(요청) — 그 달의 성적은 더
     바뀌지 않으니 그렇게 못 박아도 된다. 이번 달과 '전체 기간'은 아직 진행 중이라 안 붙인다.

     순위는 검색창에 걸린 목록이 아니라 그 조건(기간·분류·종족)의 회원 전체에서 매긴다 —
     이름을 검색했다고 메달이 옮겨 다니면 그건 순위가 아니다. 화면에서 "-"로 가려지는 값
     (표본 미달·기록 없음)은 애초에 후보에서 뺀다. 같은 값이면 같은 메달을 나눠 갖는다. */
  const medalByMember = useMemo(() => {
    const out = new Map<string, StatColumnMedals>();
    // 기간·종족도 지금 고른 값이 아니라 '받아 온 한 장'의 값으로 본다 — 값보다 조건이 먼저
    // 바뀌면 지난달 통계에 이번 달 잣대로 메달이 붙는다(지적: 알 수 없는 순위 배지).
    if (!view || view.period === PERIOD_ALL || view.period >= currentMonthValue()) return out;
    const shown = view.race;
    const pool = members
      .filter((m) => m.status !== "withdrawn" && m.status !== "suspended")
      .map((m) => {
        const entry = view.stats[m.id];
        const stats = shown === "all"
          ? (entry?.overall ?? EMPTY_STATS)
          : (entry?.byRace[shown] ?? EMPTY_STATS);
        return {
          id: m.id, stats,
          points: entry?.rankScore != null ? Math.round(entry.rankScore) : null,
        };
      });
    const give = (
      key: keyof StatColumnMedals, valueOf: (c: (typeof pool)[number]) => number | null,
    ) => {
      const vals = pool
        .map((c) => ({ id: c.id, v: valueOf(c) }))
        .filter((x): x is { id: string; v: number } => x.v !== null);
      const top = [...new Set(vals.map((x) => x.v))].sort((a, b) => b - a).slice(0, MEDALS.length);
      for (const x of vals) {
        const i = top.indexOf(x.v);
        if (i < 0) continue;
        out.set(x.id, { ...(out.get(x.id) ?? {}), [key]: MEDALS[i] });
      }
    };
    give("points", (c) => c.points);
    give("plays", (c) => (c.stats.plays > 0 ? c.stats.plays : null));
    give("rate", (c) => (c.stats.plays === 0 ? null : c.stats.winRate));
    give("build", (c) => c.stats.avgBuild);
    give("apm", (c) => c.stats.avgApm);
    give("cmd", (c) => c.stats.avgCmd);
    return out;
  }, [members, view]);

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
            <Select
              className="scr-sentence-select" value={period} options={periodOpts}
              onChange={setPeriod} minDropWidth={150}
            />
            <Select
              className="scr-sentence-select" value={matchType} options={TYPE_SELECT_OPTS}
              onChange={(v) => setMatchType(v as GameType)} minDropWidth={120}
            />
            {/* 마지막 낱말과 초기화는 한 덩어리로 — 줄이 좁아 넘칠 때 초기화만 다음 줄에
                외따로 떨어지지 않게 한다. */}
            <span className="scr-grid-title-tail">
              <Select
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
              {/* 최소 게임수 규칙 설명(요청) — 표에 "-"가 왜 뜨는지는 컬럼별 툴팁만으로는
                  안 보인다(그 컬럼을 눌러 봐야 나온다). 조건을 고르는 자리 옆에 한 번에
                  일러 둔다. 판수는 지금 걸린 분류에 따라 달라지므로 둘 다 적는다. */}
              <InfoTip
                label="최소 게임수"
                text={"생산·APM·커맨드는 개인전 3판, 팀전 10판을 채워야 나와요. 안 채우면 '-'예요.\n\n"
                  + "컴퓨터·비회원이 한 명이라도 낀 경기는 포인트가 0이에요. 팀전은 한 자리만 그래도 전원 0이에요."}
              />
            </span>
          </div>
        }
      />

      {error && <div className="scr-err">{error}</div>}

      {/* 표는 늘 '완성된 한 장'만 그린다(요청: 데이터를 다 불러온 뒤 한 번에 짠 하고).
          첫 로딩 때는 통계가 아직 없어 모든 회원의 게임수가 0 → 닉네임순으로 잠깐 정렬됐다가
          데이터가 도착하면 재정렬되며 목록이 튀었다(신고) — 그래서 한 장도 없을 때는 스피너만
          보여준다. 필터를 바꿔 다시 받는 동안에는 지금 그려 둔 한 장을 그대로 둔 채 살짝
          흐리게만 하고, 새 값이 다 도착하면 통째로 갈아 끼운다 — 조건만 먼저 바뀌어 옛 값에
          새 잣대가 씌워지는 그림(엉뚱한 메달·뒤늦게 뜨는 순위 변동)이 여기서 사라진다. */}
      <div className={cx("scr-stats-list-panel-v2", refreshing && "scr-stats-list-panel-busy")}>
        {refreshing && (
          <div className="scr-stats-list-busy-mark" aria-hidden><Spinner size={18} /></div>
        )}
        {firstLoad ? (
          <div className="scr-empty"><Spinner size={18} /></div>
        ) : cards.length === 0 ? (
          // 못 받아 온 것과 받아 보니 없는 것은 다른 말이다 — 오류 문구가 이미 위에 있으면
          // "조건에 맞는 회원이 없어요"를 겹쳐 놓지 않는다.
          error ? null : <div className="scr-empty">조건에 맞는 회원이 없어요.</div>
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
                {/* 랭크와 포인트는 별개의 칸이다(요청) — 이름도 지금 걸린 기간을 그대로
                    말한다: 전체 기간이면 "누적", 한 달이면 "월간". */}
                {/* 칸 이름도 지금 고른 기간이 아니라 '지금 그려져 있는 한 장'의 기간을 말한다 —
                    표는 아직 지난 조건의 값인데 이름만 먼저 바뀌면 그것도 어긋난 그림이다. */}
                <SortableHead
                  label={shownMonth ? "월간 랭크" : "누적 랭크"} sortKey="rank" sort={sort} onToggle={toggleSort}
                  tooltip={shownMonth
                    ? "이 달 이 분류·종족에서 포인트로 매긴 순위. 완전 동률이면 공동순위예요. 한 판도 안 뛰었으면 '-'고, 옆의 ▲▼는 전달 대비 몇 계단 움직였는지예요. 숫자를 누르면 최근 다섯 달 순위변동 그래프가 열려요."
                    : "전체 기간 누적 포인트로 매긴 순위. 완전 동률이면 공동순위예요. 한 판도 안 뛰었으면 '-'예요. 견줄 전달이 없어 변동과 순위변동 그래프는 달을 골랐을 때만 나와요."}
                />
                <SortableHead
                  label={shownMonth ? "월간 포인트" : "누적 포인트"} sortKey="points" sort={sort} onToggle={toggleSort}
                  tooltip="랭크 포인트 — 이 기간·분류의 경기들로 산정한 레이팅 점수. 최소 게임수를 안 따져요. 컴퓨터·비회원이 한 명이라도 낀 경기는 0점이에요 — 견줄 실력치가 없는 상대라 점수가 오르내릴 근거가 없어요. 숫자를 누르면 경기 이력이 열려요."
                />
                <SortableHead label="게임수" sortKey="plays" sort={sort} onToggle={toggleSort} />
                <SortableHead label="승률" sortKey="rate" sort={sort} onToggle={toggleSort} />
                <SortableHead
                  label="생산" sortKey="build" sort={sort} onToggle={toggleSort}
                  tooltip={"경기당 평균 '생산' — 유닛·건물을 얼마나 뽑고 지었나의 어림 지표예요.\n\n"
                    + "그 아래 도넛 셋은 그 총량이 무엇으로 채워졌나예요. 건물은 생산(테크·확장 포함)과 방어로, "
                    + "병력은 기본·고급·마법으로, 지형은 지상과 공중으로 나눠요. 도넛에 손을 올리면 실제 수치가 나와요.\n\n"
                    + "맨 아래는 경기당 초반(5분) 일꾼 수예요.\n\n"
                    + "기간 안의 경기를 통째로 더해서 비율을 내요 — 경기마다 비율을 내서 평균 내면 3분짜리 판 한 번이 "
                    + "그림을 통째로 흔들거든요. 리플레이로 등록한 경기만 들어가요."}
                />
                <SortableHead
                  label="APM" sortKey="apm" sort={sort} onToggle={toggleSort}
                  tooltip="분당 조작 수 — 리플레이에 기록된 명령을 분 단위로 나눈 값. 화면 이동이나 중복 클릭도 그대로 세므로 실제 손이 얼마나 바빴는지에 가깝다."
                />
                <SortableHead
                  label="커맨드" sortKey="cmd" sort={sort} onToggle={toggleSort}
                  tooltip="경기당 평균 명령 수 — 리플레이에 기록된 명령을 전부 센 값."
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
                  onRankClick={shownMonth ? () => setTrendMember(c.member) : undefined}
                  medals={medalByMember.get(c.member.id)}
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

      {/* 순위변동 — 최근 다섯 달의 순위를 그린다(요청). 순위는 그 달 표 전체에서 나오는
          값이라 회원 목록(rankPool)을 통째로 넘겨 화면과 같은 규칙으로 다시 매긴다. */}
      {trendMember && shownMonth && (
        <RankTrendModal
          member={trendMember}
          memberIds={rankPool}
          month={shownMonth}
          matchType={matchType}
          race={race}
          onClose={() => setTrendMember(null)}
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
