import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Spinner } from "../../components/common/Feedback";
import SearchFilterBar from "../../components/common/SearchFilterBar";
import PillTabs from "../../components/common/PillTabs";
import FilterItem from "../../components/common/FilterItem";
import RankRow from "./RankRow";
import RankingDetailModal from "./RankingDetailModal";
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
import type { Member } from "../../types";

// 랭킹 차트 필터는 "개인전 / 팀전" 둘뿐이다 — 예전의 개인/2인팀/3인팀/4인팀(인원수별) 구분을
// 없앴다(요청: "개인전/팀전으로만, 팀전은 모든 팀 인원수를 묶어 개인 환산"). 팀전도 개인
// 카드 목록 그대로 보여주고(상대팀 전원을 각각 이긴/진 것으로 풀어 개인 랭킹과 같은 방식으로
// 점수를 매긴다), 인원수(2·3·4인)는 한 데 섞는다.
const CHART_OPTS: { value: RankMode; label: string }[] = [
  { value: "solo", label: "개인전" },
  { value: "team", label: "팀전" },
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

// v2 랭킹 — 개인전/팀전을 고르고, 월/연 기간을 좌우 화살표로 옮겨 그 기간의 순위를 본다.
// 순위 계산(TrueSkill 레이팅)은 전부 서버가 끝내서 내려주고(./rank.ts), 화면은 그 순서대로
// 그리며 순위 숫자만 붙인다. 개인전·팀전은 집계 대상 경기(1:1 / 팀경기)만 다르고 각각 별도
// 레이팅으로 계산된다.
export default function RankingScreenV2() {
  const members = useAppStore((s) => s.members);
  const suggestions = useMemo(() => activeMemberSearchTerms(members), [members]);

  // 진입 기본값은 개인전/팀전 중 랜덤(요청: "랭킹 기본은 개인/팀 랜덤으로 결정") — 특정
  // 쪽으로 고정하지 않고 매번 새로 들어올 때마다 둘 중 하나를 고른다.
  const [mode, setMode] = useState<RankMode>(() => (Math.random() < 0.5 ? "solo" : "team"));
  const matchType = MATCH_TYPE_OF[mode];
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
  const [rows, setRows] = useState<RankRowData[]>([]);
  // 카드(행) 클릭 — 상세 모달(최근 5개 기간 순위변동 그래프 + 경기 이력·경기당 Δ).
  const [trendMember, setTrendMember] = useState<Member | null>(null);
  const [trendPoints, setTrendPoints] = useState<RankTrendPoint[] | null>(null);
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
    // 종족 필터는 없앴다(레이팅은 회원 단위 하나 — 종족별로 나누지 않는다) — 항상 "all".
    computeRankRows(membersRef.current, matchType, "all", unit, anchor)
      .then((res) => { if (!cancelled) setRows(res); })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "랭킹을 불러오지 못했어요.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membersSignature, matchType, unit, anchor]);

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

  const period = useMemo(() => periodAnchorToRange(unit, anchor), [unit, anchor]);

  const closeTrend = () => { setTrendMember(null); setTrendPoints(null); };
  const openTrend = (row: RankRowData) => {
    setTrendMember(row.member);
    setTrendPoints(null);
    computeRankTrend(membersRef.current, matchType, row.member.id, "all", unit, anchor)
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
          <FilterItem label="차트">
            <PillTabs options={CHART_OPTS} value={mode} onChange={handleModeChange} aria-label="개인전/팀전 선택" />
          </FilterItem>
        }
      />

      {/* 산정 방식 안내 — 필터들 아래, 순위 목록 바로 위(예전 기준점수표 자리). 레이팅이
          어떻게 매겨지는지 한 줄로 설명한다(요청: 기준점수표 대신 산정 방식만 명시). */}
      <p className="scr-rank-method-note">
        산정 방식: 경기 결과로 실력 레이팅(TrueSkill)을 추정합니다. 강한 상대를 이길수록 크게
        오르고, 경기가 적으면 <b>잠정</b>으로 낮게 잡힙니다. 팀전은 팀 승패를 개인 실력으로
        분해하며, 개인전·팀전 레이팅은 따로 계산됩니다.
      </p>

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
          onClose={closeTrend}
        />
      )}
    </div>
  );
}
