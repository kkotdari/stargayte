import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import { Spinner } from "../../components/common/Feedback";
import SearchFilterBar from "../../components/common/SearchFilterBar";
import PillTabs from "../../components/common/PillTabs";
import FilterItem from "../../components/common/FilterItem";
import Select from "../../components/common/Select";
import RankRow from "./RankRow";
import RankingDetailModal from "./RankingDetailModal";
import ChallengeFormModal from "../../modals/ChallengeFormModal";
import KakaoShareButton from "../../components/common/KakaoShareButton";
import type { KakaoShareContent } from "../../utils/kakaoShare";
import { renderRankingShareImage } from "../../utils/rankingShareImage";
import { api } from "../../api/client";
import {
  computeRankRows, computeRankTrend, MATCH_TYPE_OF,
  type RankMode, type RankRow as RankRowData, type RankTrendPoint,
} from "./rank";
import { activeMemberSearchTerms, memberMatchesTerm, splitSearchTerms } from "../../utils/memberSearch";
import {
  currentPeriodAnchor, periodAnchorLabel, periodAnchorToRange, shiftPeriodAnchor, type PeriodUnit,
} from "../../utils/date";
import { attachPopover } from "../../utils/popover";
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
// 종족 필터 — "랭커의 종족"(그 경기에서 낸 종족) 기준. "전체"면 종족 무관 회원 단위 레이팅.
// 개인전·팀전 모두 지원한다(각자 그 경기에서 낸 종족으로 (회원,종족) 레이팅이 쌓인다).
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

// 카톡 공유 링크(?screen=ranking&mode=...&unit=...&anchor=...&race=...)로 들어왔을 때
// 그 필터를 초기값으로 복원한다(요청: "차트 공유시 필터가 그대로 적용되서 가야하는데
// 안가") — shareRanking이 같은 파라미터로 링크를 만든다. 값이 없거나 알 수 없는
// 값이면 undefined를 돌려줘 기존 기본값(랜덤 모드 등)을 그대로 쓰게 한다.
function rankingParamsFromUrl(): { mode?: RankMode; race?: BaseRace | "all"; unit?: PeriodUnit; anchor?: string } {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  const race = params.get("race");
  const unit = params.get("unit");
  const anchor = params.get("anchor");
  return {
    mode: mode === "solo" || mode === "team" ? mode : undefined,
    race: race === "테란" || race === "프로토스" || race === "저그" ? race : undefined,
    unit: unit === "month" || unit === "year" ? unit : undefined,
    anchor: anchor || undefined,
  };
}

// v2 랭킹 — 개인전/팀전을 고르고, 월/연 기간을 좌우 화살표로 옮겨 그 기간의 순위를 본다.
// 순위 계산(TrueSkill 레이팅)은 전부 서버가 끝내서 내려주고(./rank.ts), 화면은 그 순서대로
// 그리며 순위 숫자만 붙인다. 개인전·팀전은 집계 대상 경기(1:1 / 팀경기)만 다르고 각각 별도
// 레이팅으로 계산된다.
export default function RankingScreenV2() {
  const members = useAppStore((s) => s.members);
  const user = useAppStore((s) => s.user);
  const suggestions = useMemo(() => activeMemberSearchTerms(members), [members]);
  // 닉네임 옆 주먹 버튼으로 지목한 상대 — 있으면 그 상대를 미리 채운 도전장 작성 모달을
  // 띄운다(요청: "랭킹카드에 바로 그 상대로 도전장 띄우는 버튼 추가 닉네임 옆에").
  const [challengeTarget, setChallengeTarget] = useState<Member | null>(null);

  // 진입 기본값은 개인전/팀전 중 랜덤(요청: "랭킹 기본은 개인/팀 랜덤으로 결정") — 특정
  // 쪽으로 고정하지 않고 매번 새로 들어올 때마다 둘 중 하나를 고른다. 다만 카톡 공유
  // 링크로 들어왔으면(rankingParamsFromUrl) 그 필터를 랜덤보다 우선한다.
  const shareParams = useMemo(rankingParamsFromUrl, []);
  const [mode, setMode] = useState<RankMode>(() => shareParams.mode ?? (Math.random() < 0.5 ? "solo" : "team"));
  const matchType = MATCH_TYPE_OF[mode];
  // 종족 필터(랭커 종족 기준). "all"이면 종족 무관.
  const [race, setRace] = useState<BaseRace | "all">(() => shareParams.race ?? "all");
  const [search, setSearch] = useState("");
  // 집계 기간 단위(월/연)와 그 기준점(anchor: 월 "YYYY-MM" / 연 "YYYY"). 기본은 그 단위의
  // "현재"(월은 그레이스 보정 이번 달, 연은 올해).
  const [unit, setUnit] = useState<PeriodUnit>(() => shareParams.unit ?? "month");
  const [anchor, setAnchor] = useState(() => shareParams.anchor ?? currentPeriodAnchor(shareParams.unit ?? "month"));
  // 위 초기값에 한 번 쓰고 나면 URL에서 지운다 — 남아있으면 이 화면을 벗어났다 다시
  // 들어올 때마다(재마운트) 계속 이 필터로 되돌아가 버려서, "화면 이동 시 항상 초기
  // 상태로" 원칙(다른 화면들과 동일)이 깨진다.
  useEffect(() => {
    if (!shareParams.mode && !shareParams.race && !shareParams.unit && !shareParams.anchor) return;
    const params = new URLSearchParams(window.location.search);
    params.delete("mode"); params.delete("race"); params.delete("unit"); params.delete("anchor");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const maxAnchor = currentPeriodAnchor(unit);
  const minAnchor = RANK_MIN[unit];
  const hasPrev = anchor > minAnchor;
  const hasNext = anchor < maxAnchor;

  const [rows, setRows] = useState<RankRowData[]>([]);
  const [loading, setLoading] = useState(true);

  // 개인전/팀전은 집계 대상 경기 자체가 다른 별도 목록이지만, 모드를 바꿔도 필터(종족·검색·
  // 기간)는 그대로 유지한다(요청). 목록(rows)은 여기서 비우지 않는다: 비우면 그 순간 패널
  // 높이가 확 줄었다가 새 데이터로 다시 늘어나는데, 그 사이 브라우저가 지금 스크롤 위치를
  // 줄어든 높이에 맞춰 top으로 당겨버리는 문제가 있었다(요청: "필터바꾸면 스피너 돌면서
  // 스크롤탑되는듯"). 대신 새 데이터가 도착할 때까지 이전 목록을 그대로 둔 채 흐리게+
  // 스피너로 "갱신 중"만 표시한다(아래 JSX, loading && rows.length > 0).
  const handleModeChange = (m: RankMode) => {
    setMode(m);
  };
  // 기간 단위를 바꾸면 그 단위의 "현재"로 기준점을 되돌린다(월↔연은 anchor 형식 자체가 달라
  // 그대로 둘 수 없다).
  const handleUnitChange = (u: PeriodUnit) => {
    if (u === unit) return;
    setUnit(u);
    setAnchor(currentPeriodAnchor(u));
  };
  // 기간 이동 — 그 단위(월/연)만큼 한 칸씩. 범위(데이터 시작 ~ 현재)를 벗어나면 무시한다.
  const goPeriod = (delta: number) => {
    const next = shiftPeriodAnchor(unit, anchor, delta);
    if (next < minAnchor || next > maxAnchor) return;
    setAnchor(next);
  };
  // 카드(행) 클릭 — 상세 모달(최근 5개 기간 순위변동 그래프 + 경기 이력·경기당 Δ).
  const [trendMember, setTrendMember] = useState<Member | null>(null);
  const [trendPoints, setTrendPoints] = useState<RankTrendPoint[] | null>(null);
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
    // 종족 필터는 '랭커의 종족' 기준 — 서버가 (회원,종족) 레이팅으로 순위를 매긴다("all"이면 회원 단위).
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

  // 경기수 순위 — 이 기간 경기수(plays)가 많은 순 상위 3개 값에 1/2/3위를 매긴다(요청).
  // 같은 경기수는 같은 위, 0경기는 제외. 검색 필터와 무관하게 전체 기준.
  const gamesRankByMember = useMemo(() => {
    const distinct = [...new Set(rows.map((r) => r.stats.plays).filter((p) => p > 0))]
      .sort((a, b) => b - a)
      .slice(0, 3);
    const map = new Map<string, number>();
    rows.forEach((r) => {
      const idx = distinct.indexOf(r.stats.plays);
      if (idx >= 0) map.set(r.member.id, idx + 1);
    });
    return map;
  }, [rows]);

  // 검색어에 걸린 사람들 — 프사+닉네임을 경기 로스터와 같은 반전색으로 짚어준다.
  const highlightMemberIds = useMemo(() => {
    const ids = new Set<string>();
    if (searchTerms.length === 0) return ids;
    members.forEach((m) => { if (searchTerms.some((t) => memberMatchesTerm(m, t))) ids.add(m.id); });
    return ids;
  }, [members, searchTerms]);

  const period = useMemo(() => periodAnchorToRange(unit, anchor), [unit, anchor]);

  // 카카오톡 공유 내용 — 누르는 시점의 필터/순위로 만든다(상위 5명 + 조건 라벨). 함수로
  // 넘겨 버튼이 최신 상태를 읽게 한다. link에 지금 필터(개인전/팀전·종족·기간)를 쿼리로
  // 실어 보내야 상대가 열었을 때도 같은 조건으로 보인다 — 예전엔 link를 안 줘서 항상
  // 사이트 루트(기본값)로만 열렸다(요청: "차트 공유시 필터가 그대로 적용되서 가야하는데
  // 안가"). RankingScreenV2의 useState 초기값이 이 쿼리를 읽는다(아래 rankingParamsFromUrl).
  // 미리보기 이미지는 그 순간 상위 5명을 캔버스로 그려 업로드한 뒤 URL을 붙인다(요청:
  // "카톡 미리보기에서 차트가 보이면 좋겠어") — 실패해도(네트워크 등) 공유 자체는 이미지
  // 없이 계속 진행한다(카톡 기본 아이콘으로 대체될 뿐, 공유가 막히면 안 된다).
  const shareRanking = async (): Promise<KakaoShareContent> => {
    const modeLabel = mode === "team" ? "팀전" : "개인전";
    const raceLabel = race === "all" ? "" : ` · ${race}`;
    const label = `${modeLabel}${raceLabel} · ${periodAnchorLabel(unit, anchor)}`;
    const topRows = visibleRows.slice(0, 5);
    const top = topRows.map((r) => `${r.rank}. ${r.member.nickname} (${r.rankScore}점)`);
    const linkParams = new URLSearchParams({ screen: "ranking", mode, unit, anchor });
    if (race !== "all") linkParams.set("race", race);

    let imageUrl: string | undefined;
    try {
      const dataUrl = await renderRankingShareImage(
        "스타게이트 랭킹", label,
        topRows.map((r) => ({ rank: r.rank, nickname: r.member.nickname, score: r.rankScore })),
      );
      imageUrl = (await api.uploadShareImage(dataUrl)).url;
    } catch {
      // 무시 — 위 주석 참고.
    }

    return {
      title: `스타게이트 랭킹 · ${label}`,
      description: top.slice(0, 3).join("  "),
      fallbackText: `[스타게이트 랭킹] ${label}\n${top.join("\n")}`,
      link: `${window.location.origin}/?${linkParams.toString()}`,
      imageUrl,
    };
  };

  // 산정 방식 안내 — 항상 보이는 문단 대신, 눌러야 뜨는 툴팁으로(요청: "누르면 툴팁형태로
  // 보이게"). 헤더의 프로필 드롭다운과 같은 패턴(attachPopover + 바깥 클릭/포커스 이동 시 닫음).
  const [methodTipOpen, setMethodTipOpen] = useState(false);
  const methodAnchorRef = useRef<HTMLButtonElement>(null);
  const methodTipRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!methodTipOpen || !methodAnchorRef.current || !methodTipRef.current) return;
    // 산정 방식 버튼과 가운데 정렬(요청: "툴팁은 산정방식 버튼과 가운데 정렬시키기").
    return attachPopover(methodAnchorRef.current, methodTipRef.current, { growToContent: true, maxWidth: 280, placement: "bottom" });
  }, [methodTipOpen]);
  useEffect(() => {
    if (!methodTipOpen) return;
    const closeIfOutside = (e: Event) => {
      const t = e.target as Node;
      if (methodAnchorRef.current?.contains(t)) return;
      if (methodTipRef.current?.contains(t)) return;
      setMethodTipOpen(false);
    };
    document.addEventListener("mousedown", closeIfOutside);
    document.addEventListener("focusin", closeIfOutside);
    return () => {
      document.removeEventListener("mousedown", closeIfOutside);
      document.removeEventListener("focusin", closeIfOutside);
    };
  }, [methodTipOpen]);

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
      {/* 개인전/팀전은 '필터'라기보다 목록의 종류라, 필터 패널이 아니라 타이틀 줄에 둔다(요청:
          "팀전 개인전 라디오는 목록타입에 가까워서 타이틀로우로 이동"). */}
      <div className="scr-v2-toolbar scr-rank-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">랭킹</h1>
        <span className="scr-rank-mode-tabs">
          <PillTabs options={CHART_OPTS} value={mode} onChange={handleModeChange} aria-label="개인전/팀전 선택" />
        </span>
        {/* 산정 방식 + 카톡 공유를 타이틀 줄 우측에 붙인다(요청). */}
        <span className="scr-rank-title-actions">
          <button
            type="button"
            className={cx("scr-rank-method-trigger", methodTipOpen && "scr-rank-method-trigger-active")}
            ref={methodAnchorRef}
            onClick={() => setMethodTipOpen((v) => !v)}
          >
            <Info size={13} /> 산정 방식
          </button>
          <KakaoShareButton content={shareRanking} variant="icon" />
        </span>
      </div>

      {/* 기간(단위 토글 + 좌우 이동) 선택을 다른 화면과 같은 필터 모듈 안으로 옮긴다(요청:
          "랭킹의 년월 선택기능을 필터의 기간모듈로 통합"). 선택지는 년/월뿐 — 캘린더/전체
          기간 선택 없이 화살표 한 번에 그 단위만큼만 이동한다. 화살표는 갈 수 있을 때만
          보이되 자리는 늘 예약해 레이아웃이 안 흔들린다. */}
      <SearchFilterBar
        count={visibleRows.length}
        countLabel="명"
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="@로 유저 추가"
        suggestions={suggestions}
        showSearch={false}
        filterPanel={
          <>
            <FilterItem label="기간">
              {/* 필터창의 다른 알약탭(차트 등)과 같은 공용 컴포넌트를 그대로 써서 톤을
                  맞춘다 — 선택지는 년/월뿐(요청: "선택지는 년/월만 가능"). */}
              <PillTabs options={UNIT_OPTS} value={unit} onChange={handleUnitChange} aria-label="기간 단위(월/연) 선택" />
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
            </FilterItem>
            {/* 종족 필터 — '랭커의 종족'(그 경기에서 낸 종족) 기준. 개인전·팀전 모두 지원한다. */}
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

      {methodTipOpen && createPortal(
        <ul className="scr-rank-method-tooltip" ref={methodTipRef}>
          <li>경기 결과로 실력 레이팅(<b>TrueSkill</b>)을 추정합니다.</li>
          <li>강한 상대를 이길수록 크게 오르고, 경기가 적으면 <b className="scr-rank-method-tip-provisional">잠정</b>으로 낮게 잡힙니다.</li>
          <li>팀전은 팀 승패를 개인 실력으로 분해하며, 개인전·팀전 레이팅은 따로 계산됩니다.</li>
          <li>종족 필터를 걸면 <b>그 종족으로 낸 경기</b>만의 레이팅으로 순위를 매깁니다.</li>
        </ul>,
        document.body,
      )}

      {error && <div className="scr-err">{error}</div>}

      <div className="scr-rank-table-panel-v2">
        {/* 필터/기간을 바꿔 새 데이터를 다시 불러오는 동안, 목록을 비우지 않고 이전
            목록 위에 흐림+스피너만 얹는다 — 목록을 비우면 그 순간 패널 높이가 줄었다가
            다시 늘어나면서 브라우저가 스크롤 위치를 top으로 당겨버렸다(요청: "필터바꾸면
            스피너 돌면서 스크롤탑되는듯"). rows.length>0인데 loading이면 "갱신 중"이고,
            rows.length===0인데 loading이면 첫 진입(보여줄 게 아예 없음)이라 스피너만. */}
        <div className={cx("scr-rank-table", loading && rows.length > 0 && "scr-rank-table-refreshing")}>
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
                gamesRank={gamesRankByMember.get(row.member.id)}
                onOpenTrend={() => openTrend(row)}
                onChallenge={row.member.id !== user?.id ? setChallengeTarget : undefined}
              />
            ))
          )}
        </div>
        {loading && rows.length > 0 && (
          <div className="scr-rank-table-refresh-spinner"><Spinner size={18} /></div>
        )}
      </div>

      {trendMember && (
        <RankingDetailModal
          members={[trendMember]}
          points={trendPoints}
          matchType={matchType}
          period={period}
          race={race}
          onClose={closeTrend}
        />
      )}

      {challengeTarget && (
        <ChallengeFormModal
          presetTargetIds={[challengeTarget.id]}
          lockTarget
          onClose={() => setChallengeTarget(null)}
          onCreated={() => setChallengeTarget(null)}
        />
      )}
    </div>
  );
}
