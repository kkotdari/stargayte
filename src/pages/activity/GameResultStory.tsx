import { useContext, useMemo, type MouseEvent, type PointerEvent } from "react";
import { formatWhen } from "../../utils/date";
import ReplayMotionPlayer, { type MotionBase, type SummaryMotion } from "../../components/replay/ReplayMotionPlayer";
import { api } from "../../api/client";
import ActivityComments from "./ActivityComments";
import KakaoShareButton from "../../components/common/KakaoShareButton";
import { gameResultShareContent } from "./gameShare";
import RosterSide, { outcomeFor, resolveSlotName } from "./GameResultSides";
import Avatar from "../../components/common/Avatar";
import { GameDetailCloseContext } from "./gameDetailClose";
import { useReplayMap } from "../../hooks/useReplayMap";
import { cleanMapName } from "../../utils/mapName";
import { cx } from "../../utils/format";
import { normalizeSearchText } from "../../utils/memberSearch";
import type { GameResult, GameResultSlot, Member } from "../../types";

// 경기 한 판의 상세 — 로스터/미니맵과 연속 재생(ReplayMotionPlayer)을 담는다.
//
// (스토리 다이어트) 문장 요약(summaryData) 기반의 스냅·자막·화살표·이모지 층은 통째로
// 걷었다 — 요약 자체가 더는 만들어지지도 저장되지도 않는다. 남은 것은 로스터·승패·맵
// 이름과 연속 재생이고, 재생의 장면은 개체 트랙 v2(buildsV2/castsV2)가 채운다.

/* 요약이 사라져 v1 모션 트랙도 더는 실려 오지 않는다 — 재생기는 빈 모션으로 돌리고,
   장면은 v2 개체 트랙(loadUnitTracks)이 채운다. 모듈 상수로 두는 이유는 렌더마다 새
   객체를 만들면 재생기의 useMemo들이 전부 다시 돌기 때문이다. */
const EMPTY_MOTION: SummaryMotion = { v: 1, step: 5, players: [], builds: [], casts: [] };

export default function GameResultStory({
  gameResult, team1, team2, result, memberOf, highlightMemberIds, highlightTerms, active = true,
  menu,
}: {
  gameResult: GameResult;
  team1: GameResultSlot[];
  team2: GameResultSlot[];
  result: GameResult["result"];
  memberOf: (id: string) => Member | undefined;
  highlightMemberIds?: Set<string>;
  highlightTerms?: string[];
  /** 케밥 메뉴(요청: PC 기본이 확대인 만큼 확대 창에도 케밥·닫기) — 카드의
   *  GameResultActionsMenu를 그대로 받아 확대 창 오른쪽 위에 앉힌다. */
  menu?: import("react").ReactNode;
  /** 지금 실제로 보이는 카드인가 — 접힌 묶음은 카드 본체를 투명하게 깔아 둔 채로 두므로
   *  (자리를 주고받는 애니메이션 때문) 이 값 없이는 안 보이는 카드의 재생이 혼자 돈다. */
  active?: boolean;
}) {
  const grid = useReplayMap(gameResult.mapHash);
  /* 상세 팝업의 닫기 통로(요청: PC는 게임 결과만 확대창 기본, 기존 상세 미사용) — 상세
     팝업 안에서만 값이 있고, 목록·전체 보기에서는 null이라 예전 그대로다. */
  const detailClose = useContext(GameDetailCloseContext);
  /* 특정 시간 공유(요청: 카톡 링크로 열면 그 시각부터 재생) — 주소의 &t=<초>는 이
     경기(game 파라미터가 일치할 때)에만 적용한다. 피드의 다른 카드가 같이 점프하면
     안 되니 경기번호·id 둘 다로 맞춰 본다. 첫 마운트에 한 번만 읽는다. */
  const initialSec = useMemo(() => {
    const q = new URLSearchParams(window.location.search);
    const gameParam = q.get("game");
    if (!gameParam) return undefined;
    if (gameParam !== gameResult.matchNo && Number(gameParam) !== gameResult.id) return undefined;
    const v = Number(q.get("t"));
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 확대 창 왼쪽 기둥의 타임스탬프(요청: 공통 양식) — 앱 공용 시각 유틸(formatWhen)로,
  // 리플레이 실제 시작 시각(시각 포함), 없으면 경기 날짜.
  const stampText = formatWhen(gameResult.gameStartedAt ?? gameResult.date, { clock: true });

  // 슬롯 → 표시 이름·팀 — 재생기의 로스터 기둥과 팀 색이 쓴다. 이름은 볼 때마다 지금의
  // 회원 연결로 다시 푼다(닉네임을 바꾸면 옛 경기도 따라온다).
  const slots = useMemo(() => {
    const all = [...team1, ...team2];
    const rows: { raw: string; name: string; slot: GameResultSlot; team: 1 | 2 }[] = [];
    const add = (list: GameResultSlot[], team: 1 | 2) => {
      list.forEach((slot) => {
        const name = resolveSlotName(slot, all, memberOf);
        if (slot.rawName) rows.push({ raw: slot.rawName, name, slot, team });
      });
    };
    add(team1, 1);
    add(team2, 2);
    return rows;
  }, [team1, team2, memberOf]);

  /* 재생기에 넘기는 로스터 — 위치(x·y)는 요약(bases)이 사라져 더는 없다. 재생기는 좌표
     없는 항목을 위치 계산(지형 앵커·채굴 임자)에서 건너뛰고, 로스터 기둥·종족/팀 조회
     (bases.find(...).race)만으로 쓴다. */
  const bases: MotionBase[] = useMemo(() => slots.map((s) => {
    const nameLc = normalizeSearchText(s.name);
    const hit = highlightMemberIds?.has(s.slot.memberId)
      || !!highlightTerms?.some((t) => nameLc.includes(t));
    return {
      key: s.raw, name: s.name, memberId: s.slot.memberId,
      avatar: memberOf(s.slot.memberId)?.avatar ?? null,
      race: s.slot.race, team: s.team,
      withName: true, highlight: hit,
    };
  }), [slots, memberOf, highlightMemberIds, highlightTerms]);

  const o1 = outcomeFor("team1", result);
  const o2 = outcomeFor("team2", result);
  /* 이긴 편을 이름으로 부른다(요청: "승" → "n팀 승") — 미니맵 머리의 이 배지는 로스터를
     감춘 자리에서 승패를 알리는 유일한 표시인데, "승"만으로는 색을 읽어야 어느 편인지
     알 수 있었다. 1:1은 팀 용어를 쓰지 않으므로(요청) 이긴 사람 이름을 그대로 부른다. */
  const winLabel = (() => {
    if (result === "draw") return "무승부";
    const side = o1 === "win" ? team1 : team2;
    if (team1.length === 1 && team2.length === 1) {
      return `${resolveSlotName(side[0], [...team1, ...team2], memberOf)} 승`;
    }
    return `${o1 === "win" ? 1 : 2}팀 승`;
  })();
  const mapName = cleanMapName(gameResult.mapName);
  const minutes = gameResult.durationSeconds != null
    ? Math.round(gameResult.durationSeconds / 60) : null;
  /* 미니맵이 있으면 맵 이름·플레이시간은 그림의 머리로 올라간다 — 아래 따로 한 줄 더 두면
     같은 말이 두 번 나온다. 맵 자체를 못 읽은 옛 경기(grid === null)만 로스터+맵 이름
     한 줄의 옛 형식이다 — 좌표계가 없어 아무것도 제자리에 못 놓는다. */
  const storyMap = grid ?? null;
  const showRoster = grid === null;
  /* 맵은 읽었는데 그림만 아직 없는 경우 — 운영자가 연결해 주면 바로 재생이 붙는다(요청).
     맵 자체를 못 읽은 옛 경기(grid === null)에는 연결할 대상이 없어 안 띄운다. */
  // (삭제·요청) needMapImage 안내 — 맵연결 버튼·미연결 한 줄이 대신한다.
  const showMapLine = showRoster && Boolean(mapName || minutes !== null);

  /* 미니맵을 눌러도 카드가 접히지 않게 한다(요청) — 이 카드는 눌러서 접는 동작을 갖고
     있어서(활동 묶음), 재생을 조작하려고 누른 것이 그대로 접기로 새어 나갔다. click만
     막으면 pointerdown을 보고 접는 쪽이 먼저 반응하므로 세 가지를 다 끊는다. */
  const stopBubble = {
    onPointerDown: (e: PointerEvent) => e.stopPropagation(),
    onMouseDown: (e: MouseEvent) => e.stopPropagation(),
    onClick: (e: MouseEvent) => e.stopPropagation(),
  };

  /* 두 팀 사이의 vs 줄(승·무 배지 포함) — 로스터 위쪽(PC)이 쓴다. */
  const vsRow = (
    <span className="scr-challenge-arrow-row">
      <span className={cx("scr-challenge-inline-win", o1 === "draw" && "scr-challenge-inline-draw", o1 !== "win" && o1 !== "draw" && "scr-challenge-inline-win-hidden")}>
        {o1 === "draw" ? "무" : "승"}
      </span>
      <span className="scr-challenge-arrow scr-challenge-arrow-vs" aria-hidden="true">vs</span>
      <span className={cx("scr-challenge-inline-win", o2 === "draw" && "scr-challenge-inline-draw", o2 !== "win" && o2 !== "draw" && "scr-challenge-inline-win-hidden")}>
        {o2 === "draw" ? "무" : "승"}
      </span>
    </span>
  );

  /* 재생 길이는 경기 메타(durationSeconds)가 말한다 — 요약(end)은 사라졌다. */
  const endSecVal = gameResult.durationSeconds ?? null;
  const teamOfRaw = (raw: string): 1 | 2 | undefined => slots.find((x) => x.raw === raw)?.team;

  const mapBlock = storyMap && (
    <div className="scr-story-map" {...stopBubble}>
      {/* 머리 한 줄(재요청: 승리 배지는 맵 이름 좌우로) — [1팀 승] 맵이름 시간 [2팀 승].
          1팀이 이기면 이름 왼쪽, 2팀(또는 무승부)이면 오른쪽에 서서 배지 자리가 곧 편을
          말한다. */}
      <div className="scr-story-map-head">
        {(() => {
          const winSpan = !showRoster && result !== "not_held" ? (
            /* 로스터를 감춘 자리(모바일)에서는 승패를 여기서 알려야 한다 — vs 양옆의
               승/무 배지가 로스터와 함께 사라지기 때문이다. 색이 곧 이긴 편이다. */
            <span
              className={cx("scr-story-win",
                result === "draw" ? "scr-story-win-draw"
                  : o1 === "win" ? "scr-story-win-t1" : "scr-story-win-t2")}
            >
              {winLabel}
            </span>
          ) : null;
          return (
            <div className="scr-story-map-head-line">
              {/* 게임 타이틀 로우(재요청) — [타임스탬프 왼쪽 | 맵·시간·승리 가운데 |
                  작성자 오른쪽]. 게임 페이지에서만 CSS로 보이고, 목록·묶음 카드는 머리의
                  시각이 그대로라 시각·작성자는 기본 숨김이다. */}
              <span className="scr-story-when">{stampText}</span>
              <span className="scr-story-map-mid">
                {result !== "draw" && o1 === "win" && winSpan}
                {mapName && <span className="scr-story-map-name">{mapName}</span>}
                {minutes !== null && <span className="scr-story-map-dur">{minutes}분</span>}
                {(result === "draw" || o1 !== "win") && winSpan}
              </span>
              {gameResult.createdBy && (
                <span className="scr-story-when-by">
                  <Avatar
                    member={{
                      id: gameResult.createdBy.id,
                      nickname: gameResult.createdBy.nickname,
                      avatar: memberOf(gameResult.createdBy.id)?.avatar ?? null,
                    }}
                    size={16}
                  />
                  <span>{gameResult.createdBy.nickname} 등록</span>
                </span>
              )}
            </div>
          );
        })()}
      </div>
      {/* 연속 재생 — v1 모션(요약)이 사라져 빈 모션으로 돌고, 장면은 v2 개체 트랙이 채운다. */}
      <ReplayMotionPlayer
        grid={storyMap} motion={EMPTY_MOTION} endSec={endSecVal}
        bases={bases} teamOfRaw={teamOfRaw} active={active}
        /* 특정 시간 공유(요청) — 링크의 &t=면 그 시점부터, 공유 버튼은 clockKey로
           지금 재생 시각을 읽어 링크에 싣는다. */
        initialSec={initialSec}
        clockKey={String(gameResult.matchNo || gameResult.id)}
        /* 진행바 아래 별도 공유 버튼(요청: 케밥은 그대로) — 지금 재생 시각이 링크에
           실려, 받은 쪽은 이 장면부터 본다. */
        shareNode={(
          <KakaoShareButton
            variant="full"
            label="현재 공유"
            content={() => gameResultShareContent(gameResult, memberOf)}
          />
        )}
        onDetailClose={detailClose ?? undefined}
        /* 개체 트랙 v2(요청: 별도 테이블과 비교) — 재생기의 '부대/개체' 토글이 처음
           켜질 때 한 번 내려받는다. 없는 경기(옛 등록·분석 실패)는 null이 온다. */
        loadUnitTracks={() => api.getGameUnitTracks(gameResult.id).catch(() => null)}
        winnerTeam={gameResult.result === "team1" ? 1 : gameResult.result === "team2" ? 2 : undefined}
        /* 확대 모드의 오른쪽 영역엔 이 경기의 댓글(지적: "리플" = 댓글) — 활동 카드
           하단과 같은 컴포넌트를 그대로 앉힌다. 모달(z 210) 안이라 overModal. */
        side={<ActivityComments targetType="gameResult" targetId={gameResult.id} overModal />}
        menu={menu}
      />
    </div>
  );

  return (
    <div className="scr-story">
      {showRoster && (
        <div className={cx("scr-roster-matchup", "scr-activity-game-result-matchup", grid && "scr-story-matchup-wide")}>
          <RosterSide
            team={team1} memberOf={memberOf}
            highlightMemberIds={highlightMemberIds} highlightTerms={highlightTerms}
          />
          {/* 가운데 — 승/무 배지와 vs. */}
          <div className="scr-story-mid">
            {vsRow}
          </div>
          <RosterSide
            team={team2} memberOf={memberOf}
            highlightMemberIds={highlightMemberIds} highlightTerms={highlightTerms}
          />
        </div>
      )}
      {result === "not_held" && <div className="scr-activity-game-result-notheld">미실시</div>}
      {!showRoster && mapBlock}
      {/* 미니맵이 없는 경기는 예전처럼 맵 이름·플레이시간을 한 줄로 적는다. */}
      {showMapLine && (
        <div className="scr-game-result-trow-map-line scr-game-result-trow-map-meta">
          {mapName && <span className="scr-game-result-trow-map">{mapName}</span>}
          {minutes !== null && <span className="scr-game-result-trow-dur">({minutes}분)</span>}
        </div>
      )}
      {/* (삭제·요청) "운영메뉴에서 미니맵 이미지를 연결해주세요" 안내 — 맵 정중앙의
          맵연결 버튼과 그 아래 미연결 한 줄이 대신 말한다. */}
      {/* 누가 올린 경기인가 — 재생 바 아래다(요청). */}
      {gameResult.createdBy && (
        <div className="scr-story-by">{gameResult.createdBy.nickname} 등록</div>
      )}
    </div>
  );
}
