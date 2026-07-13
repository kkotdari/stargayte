import { useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "../../components/common/Feedback";
import SearchFilterBar from "../../components/common/SearchFilterBar";
import PillTabs from "../../components/common/PillTabs";
import FilterItem from "../../components/common/FilterItem";
import RankRow from "./RankRow";
import TeamRankRow from "./TeamRankRow";
import {
  computeRankRows, computeTeamRankRows, SOLO_MATCH_TYPE,
  type RankMode, type RankRow as RankRowData, type TeamRankRow as TeamRankRowData,
} from "./rank";
import { activeMemberSearchTerms, memberMatchesTerm, splitSearchTerms } from "../../utils/memberSearch";
import { useAppStore } from "../../store/appStore";
import TeamMatchesModal from "../../modals/TeamMatchesModal";
import type { BaseRace, Member } from "../../types";

const MODE_OPTS: { value: RankMode; label: string }[] = [
  { value: "solo", label: "개인" }, { value: "team", label: "팀" },
];

// v2 랭킹 — 먼저 "일대일 / 팀" 중 하나를 고르고, 그다음에야 일대일은 종족을, 팀은 유저
// 검색을 쓸 수 있다(두 모드는 집계 대상 자체가 달라 필터를 공유하지 않는다). 기간 선택은
// 아예 없앴다 — 클럽 경기 수가 적어 주/월로 자르면 표본이 거의 안 남아서, 두 모드 모두 전체
// 경기를 대상으로 집계한다. 그래서 비교할 직전 기간이 없어 순위 변동도 보여주지 않는다.
//
// 순위 계산(승자승 → 간접비교(공통상대) → 승수 / 팀은 승점 → 승수 → 경기수)은 전부 서버가
// 끝내서 내려준다 — 화면은 그 순서대로 그리고 순위 숫자만 붙인다(./rank.ts).
export default function RankingScreenV2() {
  const members = useAppStore((s) => s.members);
  const suggestions = useMemo(() => activeMemberSearchTerms(members), [members]);

  const [mode, setMode] = useState<RankMode>("solo");
  const [race, setRace] = useState<BaseRace | "all">("all");
  const [search, setSearch] = useState("");

  // 일대일/팀은 집계 대상 자체가 다른(1:1 경기 / 팀 구성) 별도 목록이라, 한쪽에서 걸어둔
  // 검색어·종족 필터를 다른 쪽으로 들고 가면 그 화면에 아무도 안 걸린 채로 남거나(다른
  // 모드 기준 검색어) 무의미한 필터(팀 모드의 종족)가 남는다 — 모드를 바꾸면 항상
  // 검색어/필터를 초기화한다(요청: "개인/팀 전환시 나머지 필터와 검색 키워드 초기화").
  const handleModeChange = (m: RankMode) => {
    setMode(m);
    setRace("all");
    setSearch("");
  };

  const [rows, setRows] = useState<RankRowData[]>([]);
  const [teamRows, setTeamRows] = useState<TeamRankRowData[]>([]);
  // 카드를 누른 팀 — 그 팀이 함께 뛴 경기 목록 모달을 연다(null이면 안 열림).
  const [teamMatches, setTeamMatches] = useState<Member[] | null>(null);
  // 일대일 행의 "최근 경기" 줄을 눌렀을 때 — 그 회원의 일대일 경기 목록 모달을 연다
  // (팀 랭킹과 같은 TeamMatchesModal을 재활용, members가 한 명뿐인 배열이라는 점만 다르다).
  const [soloMatchMember, setSoloMatchMember] = useState<Member | null>(null);
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
    const load = mode === "solo"
      ? computeRankRows(membersRef.current, race).then((res) => { if (!cancelled) setRows(res); })
      : computeTeamRankRows(membersRef.current).then((res) => { if (!cancelled) setTeamRows(res); });
    load.catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : "랭킹을 불러오지 못했어요.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membersSignature, mode, race]);

  // 팀 검색은 순위 재계산 없이(순위는 항상 전체 팀 기준) 화면에 보여줄 행만 거른다 — 그래서
  // 남은 행의 순위 숫자는 검색 전과 항상 같다. 검색어 중 아무나 팀에 들어있으면 그 팀이 남는다.
  // SearchFilterBar가 이제 엔터를 눌러야만 onSearchChange를 부르므로(점프 방지), search
  // 자체가 이미 확정된 값이다 — 더 늦출 디바운스가 필요 없다.
  const searchTerms = useMemo(() => splitSearchTerms(search), [search]);
  const visibleTeamRows = useMemo(() => {
    if (searchTerms.length === 0) return teamRows;
    return teamRows.filter((r) => searchTerms.some((t) => r.members.some((m) => memberMatchesTerm(m, t))));
  }, [teamRows, searchTerms]);
  // 일대일(개인) 랭킹도 팀 랭킹과 같은 원칙 — 순위 재계산 없이(종족 필터로 이미 서버가
  // 다시 매긴 순위는 그대로 두고) 화면에 보여줄 행만 검색어로 거른다. rows 자체를 그대로
  // 렌더링해 이 필터가 적용된 적이 없었다(실제로 지적받은 문제 — "유저 검색이 개인 차트에서
  // 안 먹힘").
  const visibleRows = useMemo(() => {
    if (searchTerms.length === 0) return rows;
    return rows.filter((r) => searchTerms.some((t) => memberMatchesTerm(r.member, t)));
  }, [rows, searchTerms]);

  // 검색어에 걸린 사람들 — 남은 팀 안에서 누구 때문에 걸렸는지 반전색으로 짚어준다.
  const highlightMemberIds = useMemo(() => {
    const ids = new Set<string>();
    if (searchTerms.length === 0) return ids;
    members.forEach((m) => { if (searchTerms.some((t) => memberMatchesTerm(m, t))) ids.add(m.id); });
    return ids;
  }, [members, searchTerms]);

  const isTeam = mode === "team";
  const listRows = isTeam ? visibleTeamRows : visibleRows;

  return (
    <div className="scr-screen scr-rank-screen-v2">
      <div className="scr-v2-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">랭킹</h1>
      </div>

      {/* 일대일/팀 선택은 이제 필터창(왼쪽 알약 탭)이 맡는다. 기간 선택 자체가 없는
          화면이라 필터창엔 이 탭 하나뿐이다. 종족은 라디오 필터가 아니라 유저 검색창의
          예약어(raceValue/onRaceChange) — "테란"/"프로토스"/"저그"를 완성하면 종족
          칩으로 인식한다. 팀 랭킹엔 종족 개념이 없어(팀 구성원별 종족을 하나로 묶을 수
          없다) 팀 모드에서는 이 두 prop 자체를 안 넘긴다(요청: "팀 차트에서 종족
          제거") — SearchFilterBar가 onRaceChange 없으면 종족 인식을 아예 안 한다. */}
      <SearchFilterBar
        count={listRows.length}
        countLabel={isTeam ? "팀" : "명"}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={isTeam ? "유저" : "유저/종족"}
        suggestions={suggestions}
        raceValue={isTeam ? undefined : (race === "all" ? null : race)}
        onRaceChange={isTeam ? undefined : (r) => setRace(r ?? "all")}
        filterPanel={
          <FilterItem label="차트">
            <PillTabs options={MODE_OPTS} value={mode} onChange={handleModeChange} aria-label="개인/팀 선택" />
          </FilterItem>
        }
      />

      {error && <div className="scr-err">{error}</div>}

      {/* 팀 랭킹에 안 보이는 조합이 있는 이유를 밝혀둔다 — 서버가 3전 미만인 팀을 아예
          안 내려주므로(TEAM_MIN_PLAYS), 화면만 봐서는 왜 빠졌는지 알 수가 없다. 일대일의
          산정 방법 안내는 목록이 비어 있어도(아직 아무도 경기를 안 뛰었어도) 항상 보여준다
          — 팀과 달리 "왜 빠졌는지"가 아니라 "어떻게 매겨지는지" 자체를 알려주는 문구라
          목록 유무와 무관하게 유용하다. */}
      {(isTeam ? listRows.length > 0 : true) && (
        <p className="scr-rank-note">
          {isTeam
            ? "2게임 이상 함께 뛴 팀만 순위에 올라요"
            : (
              <>
                승자승 → 간접비교 → 승수
                <br />
                방식에 대한 의견은 카톡방에 자유롭게 말해주세요
              </>
            )}
        </p>
      )}

      <div className="scr-rank-table-panel-v2">
        <div className="scr-rank-table">
          {listRows.length === 0 ? (
            <div className="scr-empty">{loading ? <Spinner size={18} /> : "기록이 없어요"}</div>
          ) : isTeam ? (
            visibleTeamRows.map((row, i) => (
              <TeamRankRow
                key={row.members.map((m) => m.id).join("|")}
                row={row}
                // 공동순위는 그 그룹의 첫 행에만 순위 숫자를 보여주는데(나머지는 빈칸), 그건
                // 목록이 순위표 전체일 때만 성립한다 — 검색으로 걸러지면 그룹의 첫 행이
                // 사라진 채 남은 행만 빈칸으로 남아 순위가 아예 안 보인다(실제로 지적받은
                // 문제). 검색 중에는 묶지 않고 모든 행이 자기 순위를 그대로 보여준다.
                tiedWithPrev={searchTerms.length === 0 && i > 0 && row.rank === visibleTeamRows[i - 1].rank}
                highlightMemberIds={highlightMemberIds}
                onOpenMatches={() => setTeamMatches(row.members)}
              />
            ))
          ) : (
            visibleRows.map((row, i) => (
              <RankRow
                key={row.member.id}
                row={row}
                // 팀 랭킹과 같은 이유(위 visibleTeamRows 주석 참고) — 검색으로 걸러지면
                // 공동순위 그룹의 첫 행이 사라져 남은 행만 빈칸으로 보일 수 있어, 검색
                // 중에는 묶지 않는다.
                tiedWithPrev={searchTerms.length === 0 && i > 0 && row.rank === visibleRows[i - 1].rank}
                onOpenLatestMatch={() => setSoloMatchMember(row.member)}
              />
            ))
          )}
        </div>
      </div>

      {teamMatches && (
        <TeamMatchesModal members={teamMatches} onClose={() => setTeamMatches(null)} />
      )}
      {soloMatchMember && (
        <TeamMatchesModal
          members={[soloMatchMember]} matchType={SOLO_MATCH_TYPE}
          onClose={() => setSoloMatchMember(null)}
        />
      )}
    </div>
  );
}
