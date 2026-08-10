import { useEffect, useMemo, useState } from "react";
import { LoadingMark } from "../../components/common/Feedback";
import SearchFilterBar from "../../components/common/SearchFilterBar";
import MemberStatRow from "../stats/MemberStatRow";
import { useEpithets } from "../../utils/useEpithets";
import { useAppStore } from "../../store/appStore";
import { api } from "../../api/client";
import { activeMemberSearchTerms, memberMatchesQuery } from "../../utils/memberSearch";
// (삭제) 기간 유틸(monthInputToRange 등) — 이 화면에 고를 기간이 없다(요청).
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { usePageBackground } from "../../hooks/usePageBackground";
import { cx } from "../../utils/format";
import type { GameResultStatsResponse, GameType, Member, MemberStats, MemberStatsEntry } from "../../types";

/* (삭제) 종족 필터 한 벌(RaceFilter·RACE_TAB_OPTS·serverRaceOf) — 종족이 표의 칸이 되면서
   고를 것이 없어졌다(요청). 예전에는 이 필터가 '어느 종족의 도넛·목록을 볼까'를 정했고,
   그래서 전체종족을 보는 동안에는 그 칸들이 통째로 사라졌다. 이제 세 종족이 나란히 서므로
   한 사람의 종족별 모습을 한눈에 견줄 수 있고, 필터는 그 일을 대신할 것이 없다.
   주요 지표(게임수·승률·APM·커맨드·BEST)는 전체 종족 합계로 본다 — 종족을 가르는 일은
   오른쪽 세 칸이 이미 하고 있다. */

/** 이 회원의 주종족 — 서버가 늘 실제 참가 기록으로 뽑아 준다. 지금은 안 쓴다. */

/* 이 화면은 내전(팀전) 하나만 본다(요청: 래더와 내전은 아예 다른 메뉴) — 유형을 고르던
   라디오는 메뉴 그 자체가 됐다. 값은 조회에 계속 쓰이므로 상수로 박아 둔다. */
const CLAN_TYPE: GameType = "0102";
/* (삭제) 기간 값(PERIOD_ALL과 "YYYY-MM") — 이 화면은 늘 전체 누적이다(요청: 내전은 월
   필터 없이 무조건 전체 기간). 래더는 반대로 월 하나가 유일한 필터인데, 그건 레이팅이
   '그 날짜까지의 기록으로 본 값'이라 언제 기준인지가 값의 일부이기 때문이다. 내전이 보는
   전적·생산·칭호는 쌓일수록 그 사람의 모습에 가까워지는 값이라 잘라 볼 이유가 없다.

   딸려 나온 결과 하나: 견줄 '전달'이 없어져 전월 대비 변동이 통째로 사라진다(Delta의
   undefined 갈래). 달을 고르지 않는 표에서 "지난달보다 +6"은 어느 달을 말하는지가 없는
   수이고, 그 자리를 "-"로 채우면 수마다 뜻 없는 줄이 하나씩 깔린다. */
/* 세부 지표(승률·APM·커맨드·레이팅·순위) 표본 미달 판정은 백엔드가 전담한다(요청: 프론트에서
   경기수로 필터링하는 것 자체를 없앰) — 프론트는 그 값을 그대로 보여주고, null이면 "-"로만
   바꾼다. 최소 판수 기준(game_results/service.py의 _MIN_PLAYS_FOR_RANK)이 바뀌어도 여기는
   손댈 게 없다. */
// (삭제) 메달 이모지 — 이 표에서 메달을 걷었다(요청).

const EMPTY_STATS: MemberStats = {
  plays: 0, wins: 0, losses: 0, draws: 0, winRate: 0, bests: 0,
  avgApm: null, avgEapm: null, avgCmd: null, avgEcmd: null, avgBuild: null, buildMix: null, avgWorker5: null, mixPlays: null, mixSeconds: null, upPlays: null,
};

/* (삭제) 정렬 필터와 그 기준(SORT_KEY) — 고를 것 자체를 없앴다(요청). 랭킹순이던 기본값도
   여기서는 쓸 수 없다: 내전에는 랭킹이 없다. 지금은 게임수 내림차순 하나뿐이다(아래
   DATA_ORDER). */

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

/* (삭제) FilterGroup(이름표 + 값) — 이 화면에 남은 필터가 없다(요청). */

// 내전(팀전) 통계 — 유저 검색 하나만 걸고 전체 누적을 본다(요청). 표는 [유저][주요 지표]
// [테란][프로토스][저그] 다섯 칸이다.
export default function ClanStatsScreen() {
  // 사진 배경은 통계 화면 전용이고, 이제 다크에서만 쓴다(요청: "라이트 테마 통계 배경
  // 제거") — 밝은 바탕에서는 사진이 표/글씨와 경쟁만 해서 읽기를 방해했다.
  usePageBackground("/images/bg/stats_bg.jpg", "/images/bg/stats_bg_mobile.png");
  const members = useAppStore((s) => s.members);
  // 표에서 제 줄을 바로 찾게 배경을 깔아 줄 사람(요청).
  const user = useAppStore((s) => s.user);
  const suggestions = useMemo(() => activeMemberSearchTerms(members), [members]);

  const [search, setSearch] = useState("");
  // (삭제) 종족 필터 — 종족이 표의 칸이 됐다(요청). 위 주석 참고.
  // (삭제) 유형 라디오 — 이 화면 자체가 내전이다(CLAN_TYPE).
  // (삭제) 레이팅 상세·순위변동 그래프, 상성 관계 오버레이 — 앞의 둘은 걷어냈고(요청),
  // 상성은 래더로 갔다(요청: 상성맵은 래더에서만).
  // (삭제) 기간 state와 달력 — 전체 누적 하나로 못 박았다(요청).
  /* (삭제) 레이팅·순위 — 내전에서는 폐지다(요청). 레이팅은 일대일 경기로만 매겨지는 값이라
     (래더 화면 참고) 팀전 표에 얹으면 그 표의 어느 수와도 잣대가 안 맞았다. 함께 있던
     "레이팅 n.n 기준" 단서와 순위 변동(▲2)도 이 화면에서는 적을 것이 없어졌다. */

  // (삭제) 달력에 늘어놓을 월의 하한(firstMonth)을 물어보던 조회 — 달력이 없어졌다.

  /* (삭제) 레이팅 기준일자(asOf) — 레이팅이 없는 화면이라 적을 것이 없다. */

  // SearchFilterBar가 이제 엔터를 눌러야만 onSearchChange를 부르므로(점프 방지), search
  // 자체가 이미 확정된 값이다 — 더 늦출 디바운스가 필요 없다.
  const matchedMembers = useMemo(() => {
    return members.filter((m) =>
      m.status !== "withdrawn" && m.status !== "suspended" && memberMatchesQuery(m, search));
  }, [members, search]);

  // (삭제) 전달 범위(prevRange) — 견줄 달이 없다(위 주석).

  const queryKey = useMemo(
    () => ({
      // (삭제) 기간·전달 범위·종족 — 셋 다 고를 것이 없어졌다(요청). 남은 조건은 검색으로
      // 걸러진 회원 목록 하나다. 종족은 서버에 "all"로 물어보고, 화면이 응답의 byRace에서
      // 칸마다 제 것을 집는다.
      memberIds: matchedMembers.map((m) => m.id).sort().join(","),
    }),
    [matchedMembers],
  );
  const queryKeySignature = useMemo(() => JSON.stringify(queryKey), [queryKey]);
  const debouncedSignature = useDebouncedValue(queryKeySignature, 300);
  const debouncedQuery = useMemo(() => JSON.parse(debouncedSignature) as typeof queryKey, [debouncedSignature]);

  /* 화면이 그리는 '한 장' — 조건과 그 조건으로 받은 값이 한 몸이다.
     조건(종족)만 먼저 바뀌고 값은 아직 지난 조건 것이면, 표가 중간 단계를 그대로 내보인다
     (지적: 알 수 없는 순위 배지 — 그때는 기간까지 조건이었다). 한 장을 통째로 갈아 끼우면
     조건과 값이 어긋난 그림이 애초에 만들어지지 않는다(요청). */
  interface StatsView {
    /** 이 한 장을 만든 조건(debouncedSignature) — 지금 조건과 다르면 갱신 중이라는 뜻이다. */
    key: string;
    /** 이 조건으로 물어본 회원들 — 검색으로 걸러진 목록도 한 장 안에 함께 얼어 있다. */
    memberIds: string[];
    stats: Record<string, MemberStatsEntry>;
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
      memberIds,
    };
    if (memberIds.length === 0) { setView({ ...blank, stats: {} }); return; }
    let cancelled = false;
    setError("");
    const byId = (res: GameResultStatsResponse) => {
      const map: Record<string, MemberStatsEntry> = {};
      res.members.forEach((entry) => { map[entry.memberId] = entry; });
      return map;
    };
    // 한 번만 부른다 — 전체 누적 한 벌(요청). 전달 기준선을 함께 받던 두 번째 조회는
    // 견줄 달 자체가 없어지면서 사라졌다.
    api.getGameResultStats({
      memberIds,
      dateFrom: "", dateTo: "", matchType: CLAN_TYPE, race: "all",
    }).then((res) => {
      if (cancelled) return;
      setView({ ...blank, stats: byId(res) });
    }).catch((e) => {
      if (cancelled) return;
      setError(e instanceof Error ? e.message : "통계를 불러오지 못했어요.");
      // 조건이 바뀌었는데 새 값을 못 받았으면 옛 값을 그대로 두지 않는다 — 그게 바로
      // '조건과 값이 어긋난 그림'이다. 빈 한 장으로 갈아 끼우고 오류 문구를 함께 보여준다.
      setView({ ...blank, stats: {} });
    });
    return () => { cancelled = true; };
  }, [debouncedQuery, debouncedSignature]);

  /* 표에 늘어놓을 회원 — 지금 검색 결과(matchedMembers)가 아니라 '받아 온 한 장'이 물어본
     회원들이다. 검색어도 조회 조건이라, 새 결과가 오기 전에 목록만 먼저 바뀌면 그 사람들
     자리에 남의 통계가 잠깐 앉는다. 이름·아바타는 늘 지금 것으로 읽는다(회원 정보가 바뀌면
     표도 바로 따라간다) — 얼려 두는 것은 '누구를 보여줄까'뿐이다. */
  const viewMembers = useMemo(() => {
    if (!view) return [];
    const byId = new Map(members.map((m) => [m.id, m]));
    return view.memberIds.map((id) => byId.get(id)).filter((m): m is Member => m !== undefined);
  }, [view, members]);

  /* (삭제) shownMonth — 순위변동 그래프를 열 수 있는 달인지 가리던 값이라, 그 화면을
     걷어내며(요청) 쓸 곳이 없어졌다. */

  /* (삭제) showMix — 종족을 골라야 생산 칸을 그리던 조건. 종족이 칸이 되면서(요청) 늘
     세 칸이 함께 서므로 켜고 끌 것이 없다. */

  /* (삭제) 순위(rankOf)와 전달 대비 순위 변동 — 내전에는 랭킹이 없다(요청).
     계산 자체가 rankScore(레이팅)에 기대고 있어서, 랭킹을 폐지하면 남길 것이 없다.
     같은 계산은 래더 화면이 이어받았다(LadderScreen). */

  const cards = useMemo(() => {
    const list = viewMembers.map((m) => {
      const entry = view?.stats[m.id];
      /* 주요 지표는 전체 종족 합계다 — 종족을 가르는 일은 오른쪽 세 칸이 한다(위 주석).
         (삭제) 전달 같은 조건의 값 — 견줄 달이 없어졌다(요청: 무조건 전체 기간). prev를
         아예 안 넘기므로 줄의 모든 변동이 자리째 사라진다(Delta의 undefined 갈래). */
      return { member: m, stats: entry?.overall ?? EMPTY_STATS, entry };
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
    // 늘 내림차순이다 — 고를 방향이 없다(요청: 정렬 필터 삭제).
    const dirSign = -1;
    // 데이터 칸(유저 제외) 하나를 비교한다 — 값이 없는 쪽은 항상 맨 아래
    // (위 noPlaysLast/noAvgLast), 있으면 큰 쪽이 위로 온다.
    type DataKey = "plays" | "rate" | "apm" | "cmd";
    const compareData = (key: DataKey, a: (typeof list)[number], b: (typeof list)[number]) => {
      switch (key) {
        case "plays": return noPlaysLast(a, b) || dirSign * (a.stats.plays - b.stats.plays);
        case "rate": return noPlaysLast(a, b) || dirSign * (a.stats.winRate - b.stats.winRate);
        case "apm": return noAvgLast(a, b, "avgApm") || dirSign * ((a.stats.avgApm ?? 0) - (b.stats.avgApm ?? 0));
        case "cmd": return noAvgLast(a, b, "avgCmd") || dirSign * ((a.stats.avgCmd ?? 0) - (b.stats.avgCmd ?? 0));
      }
    };
    /* 비교 순서 — 표의 칸 순서 그대로(게임수 > 승률 > APM > 커맨드, 요청: "타이인 경우
       앞에서부터 순서대로 적용"). 맨 앞이던 레이팅이 빠지면서 이제 게임수가 첫 잣대다:
       랭킹이 없는 표에서 제일 먼저 궁금한 것은 "누가 많이 뛰었나"이고, 아래 칸들(승률·
       APM)은 그 판수를 배경으로 읽어야 뜻이 산다.
       유저 닉네임은 숫자 칸이 전부 같을 때만 쓰는 최후의 보루(요청: "닉네임이 마지막")다. */
    const DATA_ORDER: DataKey[] = ["plays", "rate", "apm", "cmd"];
    sorted.sort((a, b) => {
      for (const key of DATA_ORDER) {
        const c = compareData(key, a, b);
        if (c) return c;
      }
      return nicknameTiebreak(a, b);
    });
    return sorted;
  }, [viewMembers, view]);


  /* (삭제) 칸별 1·2·3위 메달 — 이 표에서 걷었다(요청: 내전 통계에서는 델타랑 메달은 이제
     쓰이지 않아). 메달은 "이 칸의 1등"이라는 말인데, 줄 세우는 일이 래더로 넘어간 뒤로
     이 표는 순위를 매기는 화면이 아니다. 메달만 남으면 순위가 아닌 것에 순위 표시가
     붙는 셈이 된다. */

  /* 닉네임 아래 한 줄로 붙는 별명(요청) — 기준·범위는 useEpithets가 한 벌로 못 박는다
     (전체 누적·모든 유형·모든 종족). 이 화면의 기간·종족 필터를 안 따르는 이유는 그 주석에
     있다: 별명이 화면과 필터마다 달라지면 그건 부르는 말이 아니다. */
  const epithetByMember = useEpithets();

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
          <h1 className="scr-title scr-v2-toolbar-title">내전 통계</h1>
          {/* 도움말은 없앴다(요청). 칸마다 달려 있던 ⓘ 여섯 개를 하나로 합친 뒤 다섯 번
              쳐내다가 결국 통째로 지웠다 — 남아 있던 줄의 절반은 판수 문턱 이야기였는데
              그 문턱 자체가 사라졌고, 나머지도 화면이 이미 말하고 있다(칸 이름, 막대 라벨,
              "커맨드/분", 스킬 머리의 20분 단서). */}
          {/* (이동) 상성 보기 — 래더로 갔다(요청: 상성맵은 래더에서만). 누가 누구에게
              강한가는 1:1이라야 성립하는 말이라, 팀전 화면에 두면 그 표가 무엇을 견준
              것인지 말할 수가 없다. */}
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
        /* (삭제) 필터 줄 통째 — 남은 조건은 유저 검색 하나이고 그건 검색창 자신이다.
           유형 라디오는 메뉴가 됐고(요청), 월 달력은 전체 누적으로 못 박으며(요청), 종족
           라디오는 종족이 표의 칸이 되면서(요청), 정렬은 고를 것이 없어져 걷혔다. */
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
          <div className="scr-stats-list-busy-mark" aria-hidden><LoadingMark /></div>
        )}
        {firstLoad ? (
          <LoadingMark />
        ) : cards.length === 0 ? (
          // 못 받아 온 것과 받아 보니 없는 것은 다른 말이다 — 오류 문구가 이미 위에 있으면
          // "조건에 맞는 회원이 없어요"를 겹쳐 놓지 않는다.
          error ? null : <div className="scr-empty">조건에 맞는 회원이 없어요.</div>
        ) : (
          /* 종족을 안 고르면 건설·유닛·스킬 세 칸을 통째로 뺀다(요청) — 종족마다 짓는 것도
             뽑는 것도 아예 달라서, 여러 종족의 판을 한 칸에 겹쳐 놓으면 그 도넛과 목록은
             '무엇의 비율'인지가 없는 그림이 된다. 자리만 비워 두는 것과도 다른 말이다:
             칸을 남겨 두면 그 안의 "-"가 '이 사람은 안 지었다'로 읽힌다. */
          <div className="scr-stat-table-row">
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
                  {/* 게임수·승률·APM·커맨드에 BEST PLAYER 횟수까지 이 한 칸이다 — 어느 한
                      가지를 가리키는 이름이 없어 '주요 지표'로 부른다(요청). 레이팅·순위는
                      래더로 갔고(요청), 그와 함께 "레이팅 n.n 기준" 단서도 여기서 빠졌다.
                      기간은 필터 줄이 이미 말하고 있어 칸 이름에서 뺐다. */}
                  <PlainHead label="주요 지표" />
                  {/* 종족이 곧 칸 이름이다(요청: 종족별로 반복) — 건설·유닛·스킬 셋을 한 칸에
                      합쳤으니 칸을 가리키는 이름은 종족뿐이다. 무엇을 보는 칸인지는 칸 안의
                      여섯 내용요소가 저마다 제 캡션으로 말한다(요청: 표 위 안내문 제거). */}
                  <PlainHead label="테란" />
                  <PlainHead label="프로토스" />
                  <PlainHead label="저그" />
                </div>
                {cards.map((c) => (
                  <MemberStatRow
                    key={c.member.id}
                    member={c.member}
                    stats={c.stats}
                    // 자기 줄에 살짝 배경을 깐다(요청) — 회원이 늘수록 표에서 제 줄을 찾는
                    // 것이 일이 된다.
                    me={c.member.id === user?.id}
                    /* BEST PLAYER 횟수(요청) — 팀전에만 붙는 값이라 이 화면에만 있다.
                       래더(개인전)에서는 어느 줄이나 0이라, 그 0이 "한 번도 못 받았다"로
                       잘못 읽혔을 자리다. */
                    showBest
                    // 종족 칸 셋이 각자 제 것을 집는다(요청: 종족별로 반복).
                    byRace={c.entry?.byRace}
                    // 닉네임 아래 한 줄 — 위 epithetByMember 참고(늘 내전 전체 누적 기준).
                    epithet={epithetByMember.get(c.member.id)}
                    epithetReady={epithetByMember.size > 0}
                    compact
                    maxOverallPlays={maxOverallPlays}
                    maxApm={maxApm}
                    maxCmd={maxCmd}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* (삭제) 레이팅 상세·순위변동 그래프 — 둘 다 걷어냈다(요청). */}
      {/* (이동) 상성 관계 오버레이 — 래더로 갔다(요청). */}
    </div>
  );
}
