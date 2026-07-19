import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, ChevronLeft, ChevronRight } from "lucide-react";
import { Spinner } from "../../components/common/Feedback";
import SearchFilterBar from "../../components/common/SearchFilterBar";
import PillTabs from "../../components/common/PillTabs";
import FilterItem from "../../components/common/FilterItem";
import Select from "../../components/common/Select";
import RankRow from "./RankRow";
import RankingDetailModal from "./RankingDetailModal";
import RankWeightModal from "./RankWeightModal";
import {
  computeRankRows, computeRankTrend, MATCH_TYPE_OF,
  type RankMode, type RankRow as RankRowData, type RankTrendPoint,
} from "./rank";
import { activeMemberSearchTerms, memberMatchesTerm, splitSearchTerms } from "../../utils/memberSearch";
import {
  currentPeriodAnchor, periodAnchorLabel, periodAnchorToRange, shiftPeriodAnchor, type PeriodUnit,
} from "../../utils/date";
import { cx } from "../../utils/format";
import { useAppStore } from "../../store/appStore";
import type { BaseRace, Member } from "../../types";

// 랭킹 차트 필터는 "개인전 / 팀전" 둘뿐이다 — 예전의 개인/2인팀/3인팀/4인팀(인원수별) 구분을
// 없앴다(요청: "개인전/팀전으로만, 팀전은 모든 팀 인원수를 묶어 개인 환산"). 팀전도 개인
// 카드 목록 그대로 보여주고(상대팀 전원을 각각 이긴/진 것으로 풀어 개인 랭킹과 같은 방식으로
// 점수를 매긴다), 인원수(2·3·4인)는 한 데 섞는다.
const CHART_OPTS: { value: RankMode; label: string }[] = [
  { value: "solo", label: "개인전" },
  { value: "team", label: "팀전" },
];
// 종족 필터 — 검색창 예약어에서 필터창 드롭다운으로 옮겼다(요청). "전체"면 종족 무관.
const RACE_SELECT_OPTS = [
  { value: "all", label: "전체", shortLabel: "종족" },
  { value: "테란", label: "테란" },
  { value: "프로토스", label: "프로토스" },
  { value: "저그", label: "저그" },
];
// 기간 단위 — 월이면 화살표 한 번에 ±1개월, 연이면 ±1년 이동한다(요청: "기간 년/월, 화살표
// 하나로 그 단위만큼 이동. 캘린더 선택기 없이").
const UNIT_OPTS: { value: PeriodUnit; label: string }[] = [
  { value: "month", label: "월" },
  { value: "year", label: "년" },
];
// 데이터가 시작된 시점 — 이 이전으로는 화살표가 안 넘어간다. 문자열 비교가 그대로 시간
// 비교라("2026-07" < "2026-08", "2026" < "2027") 별도 파싱 없이 경계를 판단한다.
const RANK_MIN: Record<PeriodUnit, string> = { month: "2026-07", year: "2026" };

// 강함/약함 정규화 스케일 — 서버(NET_SCALE_MAX, matches/service.py)와 반드시 같은 값을
// 유지해야 상세 모달의 경기별 획득 점수 합이 카드 총점과 맞아떨어진다.
const NET_SCALE_MAX = 9;

// v2 랭킹 — 개인전/팀전을 고르고, 월/연 기간을 좌우 화살표로 옮겨 그 기간의 순위를 본다.
// 순위 계산(경기마다 상대 강함/약함으로 가중 합산)은 전부 서버가 끝내서 내려주고(./rank.ts),
// 화면은 그 순서대로 그리며 순위 숫자만 붙인다. 개인전·팀전은 집계 대상 경기(1:1 / 팀경기)만
// 다를 뿐 목록 모양과 산정 방식이 완전히 같다.
export default function RankingScreenV2() {
  const members = useAppStore((s) => s.members);
  const suggestions = useMemo(() => activeMemberSearchTerms(members), [members]);

  // 진입 기본값은 개인전/팀전 중 랜덤(요청: "랭킹 기본은 개인/팀 랜덤으로 결정") — 특정
  // 쪽으로 고정하지 않고 매번 새로 들어올 때마다 둘 중 하나를 고른다.
  const [mode, setMode] = useState<RankMode>(() => (Math.random() < 0.5 ? "solo" : "team"));
  const matchType = MATCH_TYPE_OF[mode];
  const isTeam = mode === "team";
  const [race, setRace] = useState<BaseRace | "all">("all");
  const [search, setSearch] = useState("");
  // 집계 기간 단위(월/연)와 그 기준점(anchor: 월 "YYYY-MM" / 연 "YYYY"). 기본은 그 단위의
  // "현재"(월은 그레이스 보정 이번 달, 연은 올해).
  const [unit, setUnit] = useState<PeriodUnit>("month");
  const [anchor, setAnchor] = useState(() => currentPeriodAnchor("month"));
  const maxAnchor = currentPeriodAnchor(unit);
  const minAnchor = RANK_MIN[unit];
  const hasPrev = anchor > minAnchor;
  const hasNext = anchor < maxAnchor;

  // 개인전/팀전은 집계 대상 경기 자체가 다른 별도 목록이라, 한쪽에서 걸어둔 검색어·종족
  // 필터를 그대로 들고 가면 무의미하게 남는다 — 모드를 바꾸면 초기화한다. 목록도 그 자리에서
  // 비운다(안 그러면 새 집계 도착 전까지 이전 모드 목록이 그대로 보이다가 갑자기 갈아치워짐).
  const handleModeChange = (m: RankMode) => {
    setMode(m);
    setRace("all");
    setSearch("");
    setRows([]);
  };
  // 기간 단위를 바꾸면 그 단위의 "현재"로 기준점을 되돌린다(월↔연은 anchor 형식 자체가 달라
  // 그대로 둘 수 없다). 목록은 즉시 비우고 로딩부터 다시 그린다.
  const handleUnitChange = (u: PeriodUnit) => {
    if (u === unit) return;
    setUnit(u);
    setAnchor(currentPeriodAnchor(u));
    setRows([]);
  };
  // 기간 이동 — 그 단위(월/연)만큼 한 칸씩. 범위(데이터 시작 ~ 현재)를 벗어나면 무시한다.
  const goPeriod = (delta: number) => {
    const next = shiftPeriodAnchor(unit, anchor, delta);
    if (next < minAnchor || next > maxAnchor) return;
    setAnchor(next);
    setRows([]);
  };
  // 종족 칩도 같은 이유 — 조건이 바뀌는 순간 이전 조건의 목록을 지우고 새로 그린다.
  const handleRaceChange = (r: BaseRace | null) => {
    setRace(r ?? "all");
    setRows([]);
  };

  const [rows, setRows] = useState<RankRowData[]>([]);
  // 카드(행) 클릭 — 상세 모달(최근 5개 기간 순위변동 그래프 + 경기 이력·경기당 점수).
  const [trendMember, setTrendMember] = useState<Member | null>(null);
  const [trendPoints, setTrendPoints] = useState<RankTrendPoint[] | null>(null);
  // 가중치 표 모달 — 순위표 오른쪽 링크로 연다.
  const [weightOpen, setWeightOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 화면 전환마다(App.tsx의 refreshAll) members가 내용은 같아도 새 배열 참조로 갱신되는데,
  // 그걸 그대로 effect 의존성에 두면 랭킹 화면에 들어갈 때마다 조회가 한 번 더 나간다 —
  // 최신 값은 ref로 읽고, 내용이 실제로 바뀌었을 때만(문자열 시그니처) 다시 계산한다.
  const membersRef = useRef(members);
  membersRef.current = members;
  const membersSignature = useMemo(() => JSON.stringify(members), [members]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    computeRankRows(membersRef.current, matchType, race, unit, anchor)
      .then((res) => { if (!cancelled) setRows(res); })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "랭킹을 불러오지 못했어요.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membersSignature, matchType, race, unit, anchor]);

  // 유저 검색은 순위 재계산 없이(순위는 항상 전체 기준) 화면에 보여줄 행만 거른다 — 남은
  // 행의 순위 숫자는 검색 전과 항상 같다.
  const searchTerms = useMemo(() => splitSearchTerms(search), [search]);
  const visibleRows = useMemo(() => {
    if (searchTerms.length === 0) return rows;
    return rows.filter((r) => searchTerms.some((t) => memberMatchesTerm(r.member, t)));
  }, [rows, searchTerms]);

  // 검색어에 걸린 사람들 — 프사+닉네임을 경기 로스터와 같은 반전색으로 짚어준다.
  const highlightMemberIds = useMemo(() => {
    const ids = new Set<string>();
    if (searchTerms.length === 0) return ids;
    members.forEach((m) => { if (searchTerms.some((t) => memberMatchesTerm(m, t))) ids.add(m.id); });
    return ids;
  }, [members, searchTerms]);

  // 강함/약함은 순우열(우세수−열세수)을 "이번 기간 참가자 수"로 정규화한 비율에 고정
  // 스케일(NET_SCALE_MAX)을 곱한 값이다 — 클럽 규모가 커질수록 경기 한 판의 점수 스윙이
  // 부풀어 오르던 문제를 없앤다(요청: "회원이 많아지면 편차가 커지는 게 공평하냐").
  // 서버(_apply_rank_order)와 같은 산식·같은 상수라 상세에서 경기별로 더하면 카드
  // 총점과 맞아떨어진다.
  const participantCount = useMemo(() => rows.filter((r) => r.stats.plays > 0).length, [rows]);
  const netDenom = Math.max(1, participantCount - 1);
  const strengthByMember = useMemo(
    () => new Map(rows.map((r) => [r.member.id, 1 + (NET_SCALE_MAX * Math.max(0, r.superiorCount - r.inferiorCount)) / netDenom])),
    [rows, netDenom],
  );
  const weaknessByMember = useMemo(
    () => new Map(rows.map((r) => [r.member.id, 1 + (NET_SCALE_MAX * Math.max(0, r.inferiorCount - r.superiorCount)) / netDenom])),
    [rows, netDenom],
  );
  const period = useMemo(() => periodAnchorToRange(unit, anchor), [unit, anchor]);
  // 가중치 표 — 순위에 든(한 판이라도 뛴) 회원을 순 우열(우세수−열세수)이 높은 순으로 세우고,
  // 각자의 한 지표(순 우열)에서 강함·약함을 뽑아 '이 사람을 이기면/지면 몇 점'을 매긴다.
  const weightRows = useMemo(
    () => rows
      .filter((r) => r.stats.plays > 0)
      .map((r) => {
        const net = r.superiorCount - r.inferiorCount;
        const win = 1 + (NET_SCALE_MAX * Math.max(0, net)) / netDenom;
        const loss = -(1 + (NET_SCALE_MAX * Math.max(0, -net)) / netDenom);
        return {
          member: r.member,
          net,
          win: Math.round(win * 10) / 10,
          loss: Math.round(loss * 10) / 10,
        };
      })
      .sort((a, b) => b.net - a.net || a.member.nickname.localeCompare(b.member.nickname)),
    [rows, netDenom],
  );

  const closeTrend = () => { setTrendMember(null); setTrendPoints(null); };
  const openTrend = (row: RankRowData) => {
    setTrendMember(row.member);
    setTrendPoints(null);
    computeRankTrend(membersRef.current, matchType, row.member.id, race, unit, anchor)
      .then((pts) => setTrendPoints(pts))
      .catch(() => setTrendPoints([]));
  };

  return (
    <div className="scr-screen scr-rank-screen-v2">
      <div className="scr-v2-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">랭킹</h1>
      </div>

      {/* 기간(단위 토글 + 좌우 이동)과 산정 방식 힌트를 타이틀 아래 별도 행으로 둔다. 화살표는
          갈 수 있을 때만 보이되 자리는 늘 예약해 레이아웃이 안 흔들린다. */}
      <div className="scr-rank-subrow">
        <span className="scr-rank-period">
          <span className="scr-rank-unit-toggle" role="group" aria-label="기간 단위(월/연) 선택">
            {UNIT_OPTS.map((o) => (
              <button
                key={o.value}
                type="button"
                className={cx("scr-rank-unit-btn", unit === o.value && "scr-rank-unit-btn-active")}
                onClick={() => handleUnitChange(o.value)}
                aria-pressed={unit === o.value}
              >
                {o.label}
              </button>
            ))}
          </span>
          <span className="scr-rank-month-nav">
            <button
              type="button"
              className={cx("scr-rank-month-btn", !hasPrev && "scr-rank-month-btn-hidden")}
              onClick={() => goPeriod(-1)}
              aria-label="이전 기간"
              aria-hidden={!hasPrev}
              tabIndex={hasPrev ? 0 : -1}
            >
              <ChevronLeft size={18} />
            </button>
            <span className="scr-rank-title-month">{periodAnchorLabel(unit, anchor)}</span>
            <button
              type="button"
              className={cx("scr-rank-month-btn", !hasNext && "scr-rank-month-btn-hidden")}
              onClick={() => goPeriod(1)}
              aria-label="다음 기간"
              aria-hidden={!hasNext}
              tabIndex={hasNext ? 0 : -1}
            >
              <ChevronRight size={18} />
            </button>
          </span>
        </span>
      </div>

      {/* 개인전/팀전 선택은 필터창(왼쪽 알약 탭)이 맡는다. 종족은 라디오가 아니라 유저 검색창의
          예약어(raceValue/onRaceChange) — "테란"/"프로토스"/"저그"를 완성하면 종족 칩으로
          인식한다. 팀전엔 종족 개념을 두지 않아(구성원별 종족을 하나로 묶을 수 없다) 팀전에서는
          이 두 prop을 안 넘긴다 — SearchFilterBar가 onRaceChange 없으면 종족 인식을 안 한다. */}
      <SearchFilterBar
        count={visibleRows.length}
        countLabel="명"
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="유저 검색"
        suggestions={suggestions}
        showSearch={false}
        filterPanel={
          <>
            <FilterItem label="차트">
              <PillTabs options={CHART_OPTS} value={mode} onChange={handleModeChange} aria-label="개인전/팀전 선택" />
            </FilterItem>
            {/* 종족은 검색창 예약어 대신 필터 드롭다운으로(요청). 팀전엔 종족 개념이 없어 숨긴다. */}
            {!isTeam && (
              <FilterItem label="종족">
                <Select
                  value={race}
                  options={RACE_SELECT_OPTS}
                  onChange={(v) => handleRaceChange(v === "all" ? null : (v as BaseRace))}
                  size="sm"
                  minDropWidth={110}
                  className="scr-filter-race-select"
                />
              </FilterItem>
            )}
          </>
        }
      />

      {/* 기준점수표 링크 — 필터들 아래, 순위 목록 바로 위에 붙인다(요청). 가중치(점수)가
          순위별로 어떻게 매겨지는지 표 모달을 연다. */}
      <div className="scr-rank-weight-row">
        <button type="button" className="scr-rank-weight-link" onClick={() => setWeightOpen(true)}>
          <BarChart3 size={13} />
          <span>기준점수표</span>
        </button>
      </div>

      {error && <div className="scr-err">{error}</div>}

      <div className="scr-rank-table-panel-v2">
        <div className="scr-rank-table">
          {visibleRows.length === 0 ? (
            <div className="scr-empty">{loading ? <Spinner size={18} /> : "기록이 없어요"}</div>
          ) : (
            visibleRows.map((row, i) => (
              <RankRow
                key={row.member.id}
                row={row}
                // 검색으로 걸러지면 공동순위 그룹의 첫 행이 사라져 남은 행만 빈칸으로 보일 수
                // 있어, 검색 중에는 묶지 않고 모든 행이 자기 순위를 그대로 보여준다.
                tiedWithPrev={searchTerms.length === 0 && i > 0 && row.rank === visibleRows[i - 1].rank}
                highlighted={highlightMemberIds.has(row.member.id)}
                onOpenTrend={() => openTrend(row)}
              />
            ))
          )}
        </div>
      </div>

      {trendMember && (
        <RankingDetailModal
          members={[trendMember]}
          points={trendPoints}
          matchType={matchType}
          period={period}
          strengthByMember={strengthByMember}
          weaknessByMember={weaknessByMember}
          onClose={closeTrend}
        />
      )}

      {weightOpen && (
        <RankWeightModal
          rows={weightRows}
          modeLabel={isTeam ? "팀전" : "개인전"}
          isTeam={isTeam}
          onClose={() => setWeightOpen(false)}
        />
      )}
    </div>
  );
}
