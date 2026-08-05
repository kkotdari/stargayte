import { useEffect, useMemo, useState } from "react";
import { Spinner } from "../../components/common/Feedback";
import SearchFilterBar from "../../components/common/SearchFilterBar";
import MonthCalendar from "../../components/common/MonthCalendar";
import PickRow from "../../components/common/PickRow";
import MemberStatRow, { type StatColumnMedals } from "../stats/MemberStatRow";
import PointDetailModal from "./PointDetailModal";
import RankTrendModal from "./RankTrendModal";
import { rankOf } from "./rankOrder";
import RivalryOverlay from "../rivalry/RivalryOverlay";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { activeMemberSearchTerms, memberMatchesQuery } from "../../utils/memberSearch";
import { monthInputToRange, shiftMonthValue, currentMonthValue } from "../../utils/date";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { usePageBackground } from "../../hooks/usePageBackground";
import { cx } from "../../utils/format";
import type { BaseRace, GameResultStatsResponse, GameType, Member, MemberStats, MemberStatsEntry } from "../../types";

/** 종족 필터 값 — 실제 종족 셋에 "전체"와 "주종족"이 더해진다. */
type RaceFilter = BaseRace | "all" | "main";

/* 필터는 드롭다운이 아니라 라디오다(요청) — 값이 몇 개 안 되고 늘 같은 자리에 있어,
   지금 무엇이 걸렸는지를 열어 보지 않고도 한눈에 읽는다. 라벨도 그만큼 짧게 적는다
   ("전체종족" → "전체"). 주종족은 고른 값 하나로 모두를 보는 다른 항목들과 달리 사람마다
   다른 종족을 본다 — 종족을 바꿔 가며 하는 사람들의 "제일 잘하는 모습"을 견주는 자리다. */
const RACE_TAB_OPTS: { value: RaceFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "main", label: "주종" },
  { value: "테란", label: "테란" },
  { value: "프로토스", label: "플토" },
  { value: "저그", label: "저그" },
];

/** 서버에 넘길 종족 — 값을 그대로 넘긴다("주종족"도 서버가 안다).
 *
 *  한때는 "주종족"을 "전체"로 바꿔 보냈다: 포인트·순위는 판을 시간순으로 누적해 만드는
 *  값이라 사람마다 다른 잣대로 나눌 수 없다고 봤기 때문이다. 실제로는 서버가 한 번의
 *  재생으로 (회원, 종족) 조합 전부의 점수를 이미 만들어 두므로, 사람마다 제 주종족 칸을
 *  집기만 하면 된다(요청: "주종족으로 했을 때 포인트를 다시 계산 못해?") — 조회가 늘지도
 *  않는다. 집계(전적·APM·생산)는 여전히 전 종족으로 내려오고, 화면이 byRace에서 그 사람
 *  것을 골라 쓴다. */
const serverRaceOf = (r: RaceFilter): BaseRace | "all" | "main" => r;

/** 이 회원의 주종족 — 서버가 종족 필터와 무관하게 늘 실제 참가 기록으로 뽑아 준다
 *  (game_results/service.py의 most_played_race). 한 판도 안 뛰었으면 null. */
function mainRaceOf(entry: MemberStatsEntry | undefined): BaseRace | null {
  const r = entry?.mostPlayedRace;
  return r === "테란" || r === "프로토스" || r === "저그" ? r : null;
}

/** 표에 그릴 이 회원의 통계 한 벌 — 종족 필터가 "주종족"이면 사람마다 다른 칸을 집는다. */
function statsOf(entry: MemberStatsEntry | undefined, shown: RaceFilter): MemberStats {
  if (shown === "all") return entry?.overall ?? EMPTY_STATS;
  const race = shown === "main" ? mainRaceOf(entry) : shown;
  return (race && entry?.byRace[race]) ?? EMPTY_STATS;
}
const TYPE_TAB_OPTS: { value: GameType; label: string }[] = [
  { value: "0101", label: "개인" },
  { value: "0102", label: "팀" },
];
// 기간 드롭다운에서 "전체 기간"을 가리키는 값 — 나머지 값은 전부 "YYYY-MM"이다.
const PERIOD_ALL = "all";
/* 세부 지표(승률·APM·커맨드·포인트·순위) 표본 미달 판정은 백엔드가 전담한다(요청: 프론트에서
   경기수로 필터링하는 것 자체를 없앰) — 프론트는 그 값을 그대로 보여주고, null이면 "-"로만
   바꾼다. 최소 판수 기준(game_results/service.py의 _MIN_PLAYS_FOR_RANK)이 바뀌어도 여기는
   손댈 게 없다. */
// 지난 기간의 각 칸 1·2·3위에 붙일 메달(요청) — 순서가 곧 등수다.
const MEDALS = ["🥇", "🥈", "🥉"];

const EMPTY_STATS: MemberStats = {
  plays: 0, wins: 0, losses: 0, draws: 0, winRate: 0,
  avgApm: null, avgEapm: null, avgCmd: null, avgEcmd: null, avgBuild: null, buildMix: null, avgWorker5: null, mixPlays: null, mixSeconds: null, upPlays: null,
};

// 정렬 가능한 칸 — 건설/유닛/스킬은 순위로 줄 세울 값이 아니라 그 사람의 색깔이라 뺐다
// (요청). 랭크와 포인트는 한 칸이 되면서 정렬 키도 하나(points)로 합쳤다 — 포인트로 매긴
// 것이 랭크라 두 정렬은 애초에 같은 순서였다.
/* 정렬은 컬럼 머리를 누르는 대신 필터 아랫줄에 낱말로 늘어놓고 고른다(요청). 그래서 기준과
   방향을 따로 두지 않고 "무엇을 어느 쪽으로"를 한 낱말로 묶는다 — 게임수를 적은 순으로 보는
   일은 없고, 이름은 가나다순 말고 볼 일이 없다. 고를 것이 하나면 잘못 고를 일도 없다. */
type StatSortKey = "points" | "plays" | "rate";
type StatSortDir = "desc" | "asc";
interface StatSort { key: StatSortKey; dir: StatSortDir }

/* 라벨은 이름만 적는다(요청: "높은 순 빼고 랭킹 게임수 승률 apm ... 이런 식으로 이름만").
   낱말을 나란히 늘어놓는 자리라 "높은순/많은순"이 여섯 번 되풀이되면 그것만 읽힌다 —
   어느 쪽으로 서는지는 아래 dir이 늘 같은 쪽(이름만 가나다순)이라 굳이 적지 않아도 된다. */
const SORT_OPTS: { value: StatSortKey; label: string; dir: StatSortDir }[] = [
  { value: "points", label: "랭킹순", dir: "desc" },
  { value: "plays", label: "게임수순", dir: "desc" },
  { value: "rate", label: "승률순", dir: "desc" },
];
const sortOf = (key: StatSortKey): StatSort =>
  ({ key, dir: SORT_OPTS.find((o) => o.value === key)?.dir ?? "desc" });

/** 컬럼 머리 — 이제 이름 하나뿐이다. 정렬은 드롭다운으로 갔고(요청), 칸마다 달려 있던
 *  설명(ⓘ)도 타이틀 옆 한 자리로 합쳤다(요청) — 여섯 칸에 여섯 개가 흩어져 있으면 무엇을
 *  눌러야 원하는 설명이 나오는지를 먼저 알아야 한다. */
function PlainHead({ label, sub, className }: { label: string; sub?: string; className?: string }) {
  return (
    <span className={cx("scr-stat-plain-head", className)}>
      {label}
      {/* 칸 전체에 걸리는 단서는 줄마다 되풀이하지 않고 여기 한 번만 적는다(요청) —
          줄이 늘수록 같은 문장이 늘어나 그것만 눈에 밟힌다. */}
      {sub && <span className="scr-stat-plain-head-sub">{sub}</span>}
    </span>
  );
}

/** 고를 값들을 낱말로 늘어놓는 한 줄 — 유형·종족·정렬이 같은 물건을 쓴다(요청: 유형·종족도
 *  정렬과 같은 스타일로). 알약 트랙을 두르던 때보다 폭이 훨씬 덜 든다: 트랙과 좌우 여백이
 *  사라지고 고른 낱말 하나만 배경을 갖는다. */
/** 필터 한 덩어리 — 이름표 + 그 값(요청: 필터에 각각 라벨). PC에서 넷이 한 줄에 서면
 *  무엇이 무엇인지가 낱말만으로는 안 갈린다("전체"가 종족인지 유형인지). */
function FilterGroup({ label, children, className }: {
  label: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cx("scr-stat-filter-group", className)}>
      <span className="scr-stat-filter-label">{label}</span>
      {children}
    </div>
  );
}

// 경기결과/랭킹과 같은 공용 상단 모듈(SearchFilterBar)로 전적통계를 보여준다.
// 조건은 필터창 대신 목록 바로 위의 세 줄이 맡는다(요청) — 유형·기간 / 종족 / 정렬 순으로
// 늘어놓고, 앞의 둘은 라디오라 지금 걸린 값이 열어 보지 않아도 그대로 보인다. 검색창
// (유저)은 그 아래 별개 줄이다.
export default function StatsScreenV2() {
  // 사진 배경은 통계 화면 전용이고, 이제 다크에서만 쓴다(요청: "라이트 테마 통계 배경
  // 제거") — 밝은 바탕에서는 사진이 표/글씨와 경쟁만 해서 읽기를 방해했다.
  usePageBackground("/images/bg/stats_bg.jpg", "/images/bg/stats_bg_mobile.png");
  const members = useAppStore((s) => s.members);
  const suggestions = useMemo(() => activeMemberSearchTerms(members), [members]);

  const [search, setSearch] = useState("");
  const [race, setRace] = useState<RaceFilter>("all");
  // 게임 유형(개인전/팀전) — 라디오이고 "전체"는 없다. 기본값은 개인전(요청) — 팀전이던
  // 것을 옮겼다. 한때 랜덤이었는데, 열 때마다 다른 표가 나오는 것이 득보다 실이 컸다.
  // (삭제) 활동의 랭크 변동 카드에서 유형을 미리 걸어 주는 연동이 있었는데, 그 입구였던
  // "실시간 랭크 확인" 링크를 걷어내면서(요청) 걸어 줄 사람이 없어졌다.
  const [matchType, setMatchType] = useState<GameType>("0101");
  // 기본 정렬은 포인트(랭크 점수) 내림차순 — 랭킹을 통계에 통합한 기본 모습(요청).
  const [sort, setSort] = useState<StatSort>(sortOf("points"));
  // 포인트를 누르면 그 회원의 포인트 상세(경기 이력)를 연다.
  const [pointMember, setPointMember] = useState<Member | null>(null);
  // 월간 랭크를 누르면 그 회원의 최근 다섯 달 순위변동 그래프를 연다(요청). 전체 기간을
  // 볼 때는 견줄 달이 없어 열 게 없다 — 그래서 아래에서 월일 때만 클릭을 붙인다.
  const [trendMember, setTrendMember] = useState<Member | null>(null);
  // 상성 관계 오버레이(타이틀 옆 "상성 보기" 버튼).
  const [rivalryOpen, setRivalryOpen] = useState(false);
  // 기간은 올타임 아니면 특정 월("YYYY-MM") 하나 — 예전 단위 알약탭 + 월 선택기를 달력
  // 하나로 합쳤다(요청). 기본값은 당월(요청) — 올타임이던 것을 되돌렸다. 달 초에는 표가
  // 거의 비어 보이지만, 지금 이 달의 판세를 먼저 보여주는 쪽이 통계를 여는 이유에 가깝다.
  const [period, setPeriod] = useState<string>(() => currentMonthValue());
  const periodMonth = period === PERIOD_ALL ? "" : period;
  /* 랭크·포인트는 어느 종족 필터에서나 보여준다. 한때 주종족일 때만 감췄는데, 그건 그 값이
     혼자 전체 종족 기준으로 남아 옆 칸들과 잣대가 어긋났기 때문이다 — 이제 서버가 사람마다
     제 주종족으로 다시 매기므로(serverRaceOf 주석) 어긋날 일이 없다. */
  const showRank = true;
  const sortOpts = SORT_OPTS.map(({ value, label }) => ({ value, label }));

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

  const { from: effectiveFrom, to: effectiveTo } = useMemo(
    () => (periodMonth ? monthInputToRange(periodMonth) : { from: "", to: "" }),
    [periodMonth],
  );

  /* 상세(포인트 이력·순위변동)를 열 때 넘길 종족 — 목록의 "주종족"은 사람마다 다른 값이라
     그 회원의 실제 주종족 하나로 바꿔 넘긴다. 주종족을 못 고른 회원(0경기)은 전체로 둔다. */
  const detailRaceOf = (memberId: string): BaseRace | "all" => (
    race === "main" ? (mainRaceOf(view?.stats[memberId]) ?? "all") : race
  );

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
    race: RaceFilter;
    /** "YYYY-MM", '전체 기간'이면 빈 문자열. */
    periodMonth: string;
    period: string;
    /** 이 조건으로 물어본 회원들 — 검색으로 걸러진 목록도 한 장 안에 함께 얼어 있다. */
    memberIds: string[];
    stats: Record<string, MemberStatsEntry>;
    /** 전달 같은 조건의 통계 — 포인트 옆 순위 변동(▲2)의 기준선이다.
     *
     *  활동의 '랭크 변동 스냅샷'과는 다른 이야기다(지적): 저쪽은 "직전 순위표 대비 방금
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
      race: serverRaceOf(debouncedQuery.race),
    });
    // 전달 기준선은 없어도 표는 그대로다 — 실패하면 화살표만 안 나온다. 그래도 기다렸다가
    // 함께 그린다: 늦게 도착해 순위 변동만 뒤늦게 뜨는 것이 바로 지적받은 그림이다.
    const before = debouncedQuery.prevFrom
      ? api.getGameResultStats({
        memberIds,
        dateFrom: debouncedQuery.prevFrom,
        dateTo: debouncedQuery.prevTo,
        matchType: debouncedQuery.matchType,
        race: serverRaceOf(debouncedQuery.race),
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
      const stats = statsOf(entry, shown);
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
    const noAvgLast = (a: (typeof list)[number], b: (typeof list)[number], key: "avgApm" | "avgCmd") => {
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
    const dirSign = sort.dir === "desc" ? -1 : 1;
    // 데이터 칸(랭크·유저 제외) 하나를 비교한다 — 값이 없는 쪽은 방향과 무관하게 항상
    // 맨 아래(위 noPointsLast/noPlaysLast/noAvgLast), 있으면 지금 선택된 방향(dirSign)
    // 그대로 크고 작음을 비교한다(요청: "오름차순인지 내림차순인지도 따져서" — 타이브레이크도
    // 반대로 뒤집힐 수 있다는 뜻).
    type DataKey = "points" | "plays" | "rate" | "apm" | "cmd";
    const compareData = (key: DataKey, a: (typeof list)[number], b: (typeof list)[number]) => {
      switch (key) {
        case "points": return noPointsLast(a, b) || dirSign * ((a.points ?? 0) - (b.points ?? 0));
        case "plays": return noPlaysLast(a, b) || dirSign * (a.stats.plays - b.stats.plays);
        case "rate": return noPlaysLast(a, b) || dirSign * (a.stats.winRate - b.stats.winRate);
        case "apm": return noAvgLast(a, b, "avgApm") || dirSign * ((a.stats.avgApm ?? 0) - (b.stats.avgApm ?? 0));
        case "cmd": return noAvgLast(a, b, "avgCmd") || dirSign * ((a.stats.avgCmd ?? 0) - (b.stats.avgCmd ?? 0));
      }
    };
    // 타이브레이크 우선순위 — 표의 칸 순서 그대로(포인트 > 게임수 > 승률 > APM >
    // 커맨드, 요청: "타이인 경우 앞에서부터 순서대로 적용"). 지금 고른 칸은 이미 맨 앞으로
    // 당겨 첫 비교로 쓰고, 나머지는 이 순서 그대로 이어서 본다. 랭크는 포인트와 사실상
    // 같은 값이라(동점=공동순위) 별도 타이브레이크 칸으로 안 쓴다(요청) — 랭크가 갈리지
    // 않으면 포인트도 갈리지 않으므로 그대로 다음 칸(게임수)으로 자연히 넘어간다. 유저
    // 닉네임은 숫자 칸이 전부 같을 때만 쓰는 최후의 보루(요청: "닉네임이 마지막")다.
    const DATA_ORDER: DataKey[] = ["points", "plays", "rate", "apm", "cmd"];
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
    sorted.sort(tiebreakChain(sort.key));
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
    if (!view) return out;
    /* 올타임에는 늘 단다(요청) — 여기엔 '아직 안 끝난 기간'이라는 개념이 자체가 없다.
       달로 볼 때만 이번 달(진행 중)을 뺀다: 아직 뒤집힐 순위에 메달을 달면 그게 확정인
       것처럼 읽힌다. */
    if (view.period !== PERIOD_ALL && view.period >= currentMonthValue()) return out;
    const shown = view.race;
    const pool = members
      .filter((m) => m.status !== "withdrawn" && m.status !== "suspended")
      .map((m) => {
        const entry = view.stats[m.id];
        const stats = statsOf(entry, shown);
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
    // 생산은 수치를 화면에 안 그리게 됐으니(요청) 메달도 달지 않는다 — 숫자 없이 메달만
    // 떠 있으면 무엇으로 1등인지 읽을 도리가 없다. 정렬은 그대로 이 값으로 된다.
    give("apm", (c) => c.stats.avgApm);
    give("cmd", (c) => c.stats.avgCmd);
    return out;
  }, [members, view]);

  const maxOverallPlays = useMemo(
    () => Math.max(1, ...cards.map((c) => c.stats.plays)), [cards],
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
          {/* 도움말은 없앴다(요청). 칸마다 달려 있던 ⓘ 여섯 개를 하나로 합친 뒤 다섯 번
              쳐내다가 결국 통째로 지웠다 — 남아 있던 줄의 절반은 판수 문턱 이야기였는데
              그 문턱 자체가 사라졌고, 나머지도 화면이 이미 말하고 있다(칸 이름, 막대 라벨,
              "커맨드/분", 스킬 머리의 20분 단서). */}
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
        // 건수는 뺀다(요청) — 회원 수는 표를 읽는 데 쓰는 값이 아니고, 필터 줄이 세 줄로
        // 늘면서 그 오른쪽 끝에 홀로 떠 있는 숫자가 더 눈에 걸렸다.
        showCount={false}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="유저 입력 또는 @로 목록 띄우기"
        suggestions={suggestions}
        /* 조건은 목록 위 세 줄이 맡는다(요청) — 예전엔 "8월 개인전 전체종족"처럼 한 문장에
           드롭다운을 섞어 놨는데, 고를 것이 늘면서 문장이 길어지고 무엇이 눌리는지도 흐릿해졌다.
             ① 유형(라디오) + 기간(달력)
             ② 종족(라디오)
             ③ 정렬(텍스트 버튼 나열)
           라디오는 값이 몇 개 안 되고 늘 같은 자리에 있어, 지금 무엇이 걸렸는지를 열어 보지
           않고도 한눈에 읽는다. */
        heading={<div className="scr-stat-filters">
          {/* 유형·종족·기간 순으로 한 줄에(요청) — 고르는 낱말끼리 붙여 두고 달력을 끝에
              둔다. 좁아서 다 안 들어가면 wrap이 뒤엣것부터 아래로 내린다. */}
          <div className="scr-stat-filter-row">
            <FilterGroup label="유형">
              <PickRow options={TYPE_TAB_OPTS} value={matchType} onChange={setMatchType} label="경기 유형" />
            </FilterGroup>
            <FilterGroup label="종족">
              <PickRow options={RACE_TAB_OPTS} value={race} onChange={setRace} label="종족" />
            </FilterGroup>
            <FilterGroup label="기간">
              <MonthCalendar
                value={period} onChange={setPeriod}
                minMonth={firstMonth} maxMonth={currentMonthValue()}
                allValue={PERIOD_ALL} allLabel="올타임"
              />
            </FilterGroup>
          </div>
          {/* 정렬은 오른쪽 끝(요청) — 앞의 셋이 "무엇을 볼까"라면 이건 "어떻게 늘어놓을까"라
              결이 다르다. 떨어뜨려 두면 그 차이가 자리로 읽힌다.
              이름표는 없다(요청) — 낱말마다 "~순"이 붙어 그 자체가 이름표 노릇을 한다.
              바깥(.scr-stat-filters)이 아래 맞춤이라 이름표가 없어도 앞의 셋과 같은 줄에 선다. */}
          <div className="scr-stat-filter-group scr-stat-filter-sort">
            <PickRow options={sortOpts} value={sort.key} onChange={(k) => setSort(sortOf(k))} label="정렬 기준" />
          </div>
        </div>}
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
                <PlainHead label="유저" className="scr-stat-name-head" />
                {/* 랭크·포인트·게임수·승률·APM·커맨드가 다 이 한 칸에 있다(요청: 랭킹과
                    기록 통합) — 어느 한 가지를 가리키는 이름이 없어 '주요 지표'로 부른다
                    (요청). 기간은 필터 줄이 이미 말하고 있어 칸 이름에서 뺐다. */}
                <PlainHead label="주요 지표" />
                <PlainHead
                  label="건설"
                />
                <PlainHead
                  label="유닛"
                />
                <PlainHead label="스킬" sub="※ 공/방은 20분 이상 경기" />
              </div>
              {cards.map((c) => (
                <MemberStatRow
                  key={c.member.id}
                  member={c.member}
                  stats={c.stats}
                  points={showRank ? c.points : undefined}
                  rank={showRank ? rankByMember.get(c.member.id) ?? null : null}
                  rankDelta={showRank ? rankDeltaByMember.get(c.member.id) ?? null : null}
                  onPointsClick={() => setPointMember(c.member)}
                  onRankClick={showRank && shownMonth ? () => setTrendMember(c.member) : undefined}
                  medals={medalByMember.get(c.member.id)}
                  // 주종족으로 볼 때만 — 줄마다 잣대가 다르니 그 종족을 닉네임 옆에
                  // 적는다(요청). 다른 필터에서는 제목 문장이 이미 말하고 있다.
                  race={view?.race === "main" ? mainRaceOf(c.entry) : null}
                  /* 업그레이드 표는 종족마다 줄이 달라 종족이 정해져야 그릴 수 있다(요청)
                     — 주종족이면 그 사람 것, 종족을 고르면 그 종족, 전체종족이면 안 그린다. */
                  upRace={view?.race === "main" ? mainRaceOf(c.entry)
                    : view?.race === "all" ? null : (view?.race as BaseRace | undefined) ?? null}
                  compact
                  maxOverallPlays={maxOverallPlays}
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
          // 상세는 그 회원의 실제 종족 하나로 연다 — "주종족"은 목록에서만 뜻이 있는 값이라
          // (사람마다 다르다) 그대로 넘길 수 없다. 표의 포인트도 그 종족 기준이라 어긋나지 않는다.
          race={detailRaceOf(pointMember.id)}
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
          race={detailRaceOf(trendMember.id)}
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
