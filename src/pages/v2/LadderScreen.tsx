import { useEffect, useMemo, useState } from "react";
import { LoadingMark } from "../../components/common/Feedback";
import SearchFilterBar from "../../components/common/SearchFilterBar";
import MonthCalendar from "../../components/common/MonthCalendar";
import Avatar from "../../components/common/Avatar";
import Delta from "../stats/Delta";
import RivalryOverlay from "../rivalry/RivalryOverlay";
import { rankOf } from "./rankOrder";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { monthInputToRange, shiftMonthValue, currentMonthValue } from "../../utils/date";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { usePageBackground } from "../../hooks/usePageBackground";
import { cx } from "../../utils/format";
import type { GameResultStatsResponse, GameType, Member, MemberStatsEntry } from "../../types";

/* ── 래더 ─────────────────────────────────────────────────────────────────────
   내전 통계와 아예 다른 화면이다(요청: 메뉴 진입점부터 분리) — 이쪽은 통계가 아니라
   리더보드다. 표가 아니라 줄 세운 순위표 하나가 화면의 전부이고, 그래서 칸도 다섯뿐이다:
   랭크 · 유저 · 레이팅 · 경기수 · 승률(요청). APM·커맨드는 뺐다 — 손이 빠른 순서를
   보러 오는 자리가 아니고, 칸이 늘수록 정작 순위표가 좁아진다.

   레이팅은 일대일 경기로만 매겨지는 값이라(요청) 이 화면이 그 유일한 집이다. 상성 관계도
   여기서만 본다: 누가 누구에게 강한가는 1:1이라야 성립하는 말이다.

   필터는 월 하나다(요청). 유저 검색이 없는 것도 일부러다 — 순위표에서 한 사람만 남기면
   그건 더 이상 순위표가 아니다. 종족 필터가 없는 것도 같은 이유다: 레이팅은 종족을 가르지
   않은 한 줄의 값이라야 "이 클럽에서 몇 위"라는 말이 성립한다. */

/** 일대일. 이 화면은 이 유형 하나만 본다. */
const LADDER_TYPE: GameType = "0101";
// 기간 달력에서 "전체 누적"을 가리키는 값 — 나머지는 전부 "YYYY-MM"이다.
const PERIOD_ALL = "all";
/** 끝난 달의 1·2·3위에 붙는 메달 — 순서가 곧 등수다. */
const MEDALS = ["🥇", "🥈", "🥉"];

/** 이 회원의 한 줄 — 순위표에 필요한 값만 뽑아 둔다. */
interface LadderRow {
  member: Member;
  /** 몇 위인가(공동순위 포함). 한 판도 안 뛰었으면 null. */
  rank: number | null;
  /** 전달 대비 몇 계단(+면 상승). "new"는 지난달에 순위가 없던 사람. */
  move: number | "new" | null;
  points: number | null;
  prevPoints: number | null;
  plays: number;
  prevPlays: number | null;
  /** 한 판도 안 뛰었으면 null — 0%와 '잰 적 없음'은 다른 말이다. */
  winRate: number | null;
  prevWinRate: number | null;
}

export default function LadderScreen() {
  // 배경 사진은 통계와 같은 것을 쓴다 — 같은 결의 두 화면이라 배경까지 갈라 둘 이유가 없다.
  usePageBackground("/images/bg/stats_bg.jpg", "/images/bg/stats_bg_mobile.png");
  const members = useAppStore((s) => s.members);
  // 순위표에서 제 줄을 바로 찾게 배경을 깔아 줄 사람(요청).
  const user = useAppStore((s) => s.user);

  const [period, setPeriod] = useState<string>(() => currentMonthValue());
  const [rivalryOpen, setRivalryOpen] = useState(false);
  const periodMonth = period === PERIOD_ALL ? "" : period;

  // 달력에 늘어놓을 월의 하한 — 첫 경기가 있는 달. 그보다 과거는 어차피 빈 표다.
  const [firstMonth, setFirstMonth] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.getGameResultsPage({ sort: "oldest", limit: 1 })
      .then((page) => { if (!cancelled) setFirstMonth(page.items[0]?.date.slice(0, 7) ?? null); })
      .catch(() => { /* 목록이 이번 달 하나로 줄 뿐이라 조용히 넘어간다 */ });
    return () => { cancelled = true; };
  }, []);

  const { from, to } = useMemo(
    () => (periodMonth ? monthInputToRange(periodMonth) : { from: "", to: "" }),
    [periodMonth],
  );
  const prevRange = useMemo(
    () => (periodMonth ? monthInputToRange(shiftMonthValue(periodMonth, -1)) : { from: "", to: "" }),
    [periodMonth],
  );

  /* 레이팅이 어느 날짜 기준인가 — 그 기간의 마지막 날이되, 아직 안 온 날은 오늘로 자른다
     (이번 달을 보면 "8.31 기준"이 아니라 "8.10 기준"이라야 맞다). '전체 누적'은 오늘이다.
     레이팅은 '그 기간에 번 값'이 아니라 '그 날짜까지의 기록으로 본 값'이라, 이 날짜를 안
     적으면 달을 바꿨을 때 값이 왜 달라지는지 읽을 길이 없다. */
  const asOf = useMemo(() => {
    const today = new Date();
    const end = to ? new Date(`${to}T00:00:00`) : today;
    const at = end > today ? today : end;
    return `${at.getMonth() + 1}.${at.getDate()}`;
  }, [to]);

  /* 순위표에 서는 사람 — 활동 중인 회원 전체다. 검색으로 줄이지 않는다(위 주석). */
  const poolIds = useMemo(
    () => members
      .filter((m) => m.status !== "withdrawn" && m.status !== "suspended")
      .map((m) => m.id).sort(),
    [members],
  );

  const queryKey = useMemo(
    () => ({ from, to, prevFrom: prevRange.from, prevTo: prevRange.to, period, ids: poolIds.join(",") }),
    [from, to, prevRange, period, poolIds],
  );
  const signature = useMemo(() => JSON.stringify(queryKey), [queryKey]);
  const debouncedSignature = useDebouncedValue(signature, 300);
  const q = useMemo(() => JSON.parse(debouncedSignature) as typeof queryKey, [debouncedSignature]);

  /* 화면이 그리는 '한 장' — 조건과 그 조건으로 받은 값이 한 몸이다(내전 화면과 같은 원칙).
     따로 두면 조건만 먼저 바뀌어, 지난달 값에 이번 달 잣대로 메달이 붙거나 순위 변동만
     몇백 ms 늦게 따라 바뀌는 그림이 나온다. */
  interface LadderView {
    key: string;
    /** "YYYY-MM", '전체 누적'이면 빈 문자열. */
    periodMonth: string;
    period: string;
    ids: string[];
    stats: Record<string, MemberStatsEntry>;
    prev: Record<string, MemberStatsEntry>;
  }
  const [view, setView] = useState<LadderView | null>(null);
  const [error, setError] = useState("");
  const firstLoad = view === null;
  const refreshing = view !== null && view.key !== debouncedSignature;

  useEffect(() => {
    const ids = q.ids ? q.ids.split(",") : [];
    const blank = {
      key: debouncedSignature,
      periodMonth: q.period === PERIOD_ALL ? "" : q.period,
      period: q.period,
      ids,
    };
    if (ids.length === 0) { setView({ ...blank, stats: {}, prev: {} }); return; }
    let cancelled = false;
    setError("");
    const byId = (res: GameResultStatsResponse) => {
      const map: Record<string, MemberStatsEntry> = {};
      res.members.forEach((e) => { map[e.memberId] = e; });
      return map;
    };
    const mine = api.getGameResultStats({
      memberIds: ids, dateFrom: q.from, dateTo: q.to, matchType: LADDER_TYPE, race: "all",
    });
    // 전달 기준선이 없어도 순위표는 그대로다 — 실패하면 변동만 안 나온다. 그래도 기다렸다가
    // 함께 그린다: 늦게 도착해 ▲2만 뒤늦게 뜨는 것이 딱 지적받았던 그림이다.
    const before = q.prevFrom
      ? api.getGameResultStats({
        memberIds: ids, dateFrom: q.prevFrom, dateTo: q.prevTo, matchType: LADDER_TYPE, race: "all",
      }).catch(() => null)
      : Promise.resolve(null);
    Promise.all([mine, before]).then(([res, prevRes]) => {
      if (cancelled) return;
      setView({ ...blank, stats: byId(res), prev: prevRes ? byId(prevRes) : {} });
    }).catch((e) => {
      if (cancelled) return;
      setError(e instanceof Error ? e.message : "래더를 불러오지 못했어요.");
      setView({ ...blank, stats: {}, prev: {} });
    });
    return () => { cancelled = true; };
  }, [q, debouncedSignature]);

  const rows = useMemo((): LadderRow[] => {
    if (!view) return [];
    const byId = new Map(members.map((m) => [m.id, m]));
    const rank = rankOf(view.stats, view.ids);
    const prevRank = rankOf(view.prev, view.ids);
    const list = view.ids
      .map((id) => byId.get(id))
      .filter((m): m is Member => m !== undefined)
      .map((m): LadderRow => {
        const e = view.stats[m.id];
        const p = view.prev[m.id];
        const now = rank.get(m.id) ?? null;
        const before = prevRank.get(m.id);
        /* 세 가지가 다른 말이다: 지난달에 순위가 없던 사람은 "신규", 있었는데 제자리면
           변동 없음(null), 견줄 달 자체가 없으면(전체 누적) 역시 null이다. 전체 누적에서는
           애초에 전달을 안 받아 오므로 periodMonth로 한 번 더 막는다 — 안 막으면 누구나
           "신규"로 보인다. */
        const move: number | "new" | null =
          now === null ? null
            : before === undefined ? (view.periodMonth ? "new" : null)
              : before === now ? null : before - now;
        return {
          member: m,
          rank: now,
          move,
          points: e?.rankScore != null ? Math.round(e.rankScore) : null,
          prevPoints: p?.rankScore != null ? Math.round(p.rankScore) : null,
          plays: e?.overall.plays ?? 0,
          prevPlays: p ? p.overall.plays : null,
          winRate: e && e.overall.plays > 0 ? e.overall.winRate : null,
          prevWinRate: p && p.overall.plays > 0 ? p.overall.winRate : null,
        };
      });
    /* 줄 세우는 잣대는 순위 하나다 — 이 화면이 리더보드인 이상 다른 순서는 없다.
       순위가 없는 사람(한 판도 안 뛴)은 맨 아래에 닉네임순으로 모인다: 순위표에서 아예
       빼면 "이 사람은 회원이 아닌가"로 읽히고, 위에 섞이면 순위표가 아니게 된다. */
    return list.sort((a, b) => {
      if (a.rank === null && b.rank === null) return a.member.nickname.localeCompare(b.member.nickname);
      if (a.rank === null) return 1;
      if (b.rank === null) return -1;
      return a.rank - b.rank || a.member.nickname.localeCompare(b.member.nickname);
    });
  }, [view, members]);

  /* 이미 끝난 달에만 1·2·3위에 메달을 붙인다 — 그 달의 성적은 더 바뀌지 않으니 그렇게 못
     박아도 된다. 이번 달과 '전체 누적'은 아직 진행 중이라 안 붙인다(내전 화면과 같은 규칙). */
  const medalOn = view !== null && view.period !== PERIOD_ALL && view.period < currentMonthValue();

  return (
    <div className="scr-screen scr-ladder-screen">
      <div className="scr-v2-toolbar">
        <div className="scr-v2-toolbar-title-row">
          <h1 className="scr-title scr-v2-toolbar-title">래더 보드</h1>
          {/* 상성 보기 — 래더에서만 연다(요청). 기간은 이 화면의 현재 필터를 그대로 따른다
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
        count={rows.length}
        countLabel="명"
        showCount={false}
        // 유저 검색은 없다(요청: 필터는 월 하나) — 순위표에서 한 사람만 남기면 그건 더 이상
        // 순위표가 아니다.
        showSearch={false}
        searchValue=""
        onSearchChange={() => { /* 검색창 자체가 없다 */ }}
        heading={<div className="scr-stat-filters">
          <div className="scr-stat-filter-row">
            {/* 이름표는 없다(요청) — 이 화면의 유일한 필터라 무엇을 고르는 자리인지 헷갈릴
                일이 없고, 달력 트리거 자신이 이미 "8월"이라고 적고 있다. 이름표가 필요했던
                것은 유형·종족·월 셋이 한 줄에 섰을 때였다. */}
            <div className="scr-stat-filter-group">
              <MonthCalendar
                value={period} onChange={setPeriod}
                minMonth={firstMonth} maxMonth={currentMonthValue()}
                allValue={PERIOD_ALL} allLabel="전체 누적"
              />
              {/* 레이팅이 어느 날짜 기준인가 — 컬럼 머리 아랫줄 대신 월 필터 옆에 적는다
                  (요청: "기준 일은 월 필터 옆에 표시"). 기준일은 그 필터가 정하는 값이라
                  필터 곁에 있는 편이 "무엇에 대한 기준인가"가 더 잘 붙는다. */}
              <span className="scr-stat-plain-head-sub scr-ladder-asof">{asOf} 기준</span>
            </div>
          </div>
        </div>}
      />

      {error && <div className="scr-err">{error}</div>}

      {/* 순위표도 '완성된 한 장'만 그린다 — 값이 오기 전에는 모두의 순위가 없어 닉네임순으로
          잠깐 섰다가 재정렬되며 목록이 튄다. 다시 받는 동안에는 지금 것을 그대로 두고 살짝
          흐리게만 한다(내전 화면과 같은 규칙). */}
      <div className={cx("scr-stats-list-panel-v2", refreshing && "scr-stats-list-panel-busy")}>
        {refreshing && <div className="scr-stats-list-busy-mark" aria-hidden><LoadingMark /></div>}
        {firstLoad ? (
          <LoadingMark />
        ) : rows.length === 0 ? (
          error ? null : <div className="scr-empty">아직 순위에 오른 회원이 없어요.</div>
        ) : (
          <div className="scr-stat-table-clip">
            <div className="scr-ladder-table scr-scroll">
              <div className="scr-ladder-row scr-ladder-row-head">
                <span className="scr-ladder-rank-head">랭크</span>
                <span className="scr-ladder-name-head">유저</span>
                <span>레이팅</span>
                <span>경기수</span>
                <span>승률</span>
              </div>
              {rows.map((r) => (
                <div
                  key={r.member.id}
                  className={cx("scr-ladder-row", r.member.id === user?.id && "scr-stat-row-me")}
                >
                  {/* 랭크는 맨 왼쪽 제 칸이다(요청) — 리더보드에서 제일 먼저 읽는 값이라
                      유저 칸 안에 딸려 있으면 안 된다. 변동은 그 옆에 매단다. */}
                  <span className="scr-ladder-rank">
                    {r.rank === null ? (
                      <span className="scr-stat-points-empty">-</span>
                    ) : (
                      <span className="scr-ladder-rank-val">
                        {medalOn && r.rank <= MEDALS.length
                          ? <span className="scr-stat-medal">{MEDALS[r.rank - 1]}</span>
                          : <span className="scr-ladder-rank-n">{r.rank}</span>}
                        <span className="scr-ladder-move">
                          {r.move === "new" ? (
                            <span className="scr-activity-shift-new">신규</span>
                          ) : typeof r.move === "number" ? (
                            <span className={r.move > 0 ? "scr-activity-shift-up" : "scr-activity-shift-down"}>
                              {r.move > 0 ? `▲${r.move}` : `▼${-r.move}`}
                            </span>
                          ) : (
                            <span className="scr-stat-delta scr-stat-delta-none">-</span>
                          )}
                        </span>
                      </span>
                    )}
                  </span>
                  <span className="scr-ladder-name">
                    {/* 한 스텝 확대(요청: "아바타 및 폰트 크기 1스텝 확대") — 28 → 32px. */}
                    <Avatar member={r.member} size={32} />
                    <button
                      type="button" className="scr-stat-name-btn"
                      onClick={() => useAppStore.getState().openMemberProfile(r.member.id)}
                    >
                      {r.member.nickname}
                    </button>
                  </span>
                  {/* 수치 셋은 같은 모양이다 — 값 한 줄, 그 아래 전달 대비 변동 한 줄.
                      변동 자리는 값이 없는 줄에서도 지킨다(Delta가 "-"를 그린다): 그래야
                      줄 높이가 모두 같아 순위표가 고르게 내려간다. */}
                  <span className="scr-ladder-num">
                    <b>{r.points === null ? "-" : r.points.toLocaleString()}</b>
                    <Delta now={r.points} prev={r.prevPoints} />
                  </span>
                  <span className="scr-ladder-num">
                    <b>{r.plays > 0 ? r.plays : "-"}</b>
                    <Delta now={r.plays} prev={r.prevPlays} />
                  </span>
                  <span className="scr-ladder-num">
                    {/* 승률만 소수 첫째 자리까지 — 정수로 반올림하면 47.6 → 48.1처럼 실제로
                        움직인 값이 "+0"으로 사라진다. */}
                    <b>{r.winRate === null ? "-" : `${r.winRate.toFixed(1)}%`}</b>
                    <Delta now={r.winRate} prev={r.prevWinRate} digits={1} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {rivalryOpen && (
        <RivalryOverlay from={from} to={to} onClose={() => setRivalryOpen(false)} />
      )}
    </div>
  );
}
