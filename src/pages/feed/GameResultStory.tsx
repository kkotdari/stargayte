import { useEffect, useMemo, useRef, useState } from "react";
import ReplayMinimap, { type MinimapMarker } from "../../components/replay/ReplayMinimap";
import ReplayStoryTimeline from "../../components/replay/ReplayStoryTimeline";
import RosterSide, { outcomeFor, resolveSlotName } from "./GameResultSides";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useReplayMap } from "../../hooks/useReplayMap";
import { cleanMapName } from "../../utils/mapName";
import { cx } from "../../utils/format";
import { normalizeSearchText } from "../../utils/memberSearch";
import { renderReplaySummarySentences } from "../../utils/replaySummaryText";
import type { GameResult, GameResultSlot, Member } from "../../types";

// 경기 한 판을 '이야기'로 보여주는 부분 — 로스터/미니맵, 타임라인, 요약 문장이 한 상태를
// 함께 쓴다(요청).
//
// 타임라인의 스냅 하나가 요약 문장 하나다. 스냅을 고르면 그 문장에 하이라이트가 가고,
// 미니맵에는 그 문장의 주인공들이 그때 병력을 보낸 자리에 아바타로 뜬다. 본진 표시(아바타+
// 닉네임)는 스냅과 무관하게 늘 떠 있다.
//
// 로스터는 모바일에서만 감춘다(요청: 카드 하나가 너무 길어졌다) — 편은 미니맵의 색이
// 말해 주고, 종족도 미니맵 표시에 함께 붙는다. PC는 가로로 자리가 남으므로 예전처럼 로스터를
// 양쪽에 두고 미니맵을 그 사이에 둔다(요청). 미니맵을 못 그리는 경기(옛 경기, 맵 정보를 못
// 읽은 리플레이)에서는 모바일에서도 로스터가 유일한 로스터라 그대로 보여준다.

// 자동재생이 한 스냅에 머무는 시간 — 문장 길이에 맞춘다(긴 문장에 같은 시간을 주면 다
// 읽기 전에 넘어간다). 한글은 초당 열 자 남짓 읽는다고 보고 잡은 값이다.
const DWELL_BASE_MS = 1200;
const DWELL_PER_CHAR_MS = 60;
// 한 스냅에 이보다 오래 머물면 멈춰 있는 것처럼 보인다(실측: 7초로 뒀더니 첫 문장에서
// 8초를 서 있었다).
const DWELL_MAX_MS = 5500;

/** 카드가 화면에 이만큼 들어와 있으면 재생한다 — 피드에 카드가 여럿인데 전부 동시에
 *  돌아가면 어지럽고, 보이지도 않는 카드가 타이머를 물고 있을 이유도 없다. */
const VISIBLE_RATIO = 0.4;

export default function GameResultStory({
  gameResult, team1, team2, result, memberOf, highlightMemberIds, highlightTerms, active = true,
}: {
  gameResult: GameResult;
  team1: GameResultSlot[];
  team2: GameResultSlot[];
  result: GameResult["result"];
  memberOf: (id: string) => Member | undefined;
  highlightMemberIds?: Set<string>;
  highlightTerms?: string[];
  /** 지금 실제로 보이는 카드인가 — 접힌 묶음은 카드 본체를 투명하게 깔아 둔 채로 두므로
   *  (자리를 주고받는 애니메이션 때문) 이 값 없이는 안 보이는 카드의 타임라인이 혼자
   *  돌아가 있다가 펼치는 순간 중간 장면부터 보인다. */
  active?: boolean;
}) {
  const mobile = useIsMobile();
  const grid = useReplayMap(gameResult.mapHash);
  const rootRef = useRef<HTMLDivElement>(null);

  // 이름 풀기 — 요약은 리플레이 원본 게임 아이디로 저장돼 있어서, 볼 때마다 지금의 회원
  // 연결로 이름을 다시 푼다(닉네임을 바꾸면 옛 경기의 요약도 따라온다).
  const { nameByRaw, teamByName, slots } = useMemo(() => {
    const all = [...team1, ...team2];
    const byRaw = new Map<string, string>();
    const byName = new Map<string, 1 | 2>();
    const rows: { raw: string; name: string; slot: GameResultSlot; team: 1 | 2 }[] = [];
    const add = (list: GameResultSlot[], team: 1 | 2) => {
      list.forEach((slot) => {
        const name = resolveSlotName(slot, all, memberOf);
        if (slot.rawName) byRaw.set(slot.rawName, name);
        if (name) byName.set(name, team);
        if (slot.rawName) rows.push({ raw: slot.rawName, name, slot, team });
      });
    };
    add(team1, 1);
    add(team2, 2);
    return { nameByRaw: byRaw, teamByName: byName, slots: rows };
  }, [team1, team2, memberOf]);

  const sentences = useMemo(
    () => renderReplaySummarySentences(
      gameResult.summaryData,
      (raw) => nameByRaw.get(raw) ?? raw,
      (name) => teamByName.get(name),
    ) ?? [],
    [gameResult.summaryData, nameByRaw, teamByName],
  );

  const [index, setIndex] = useState(0);
  // 기본은 자동재생(요청). 사람이 멈추면 그 뜻을 지켜 다시 켜지 않는다.
  const [playing, setPlaying] = useState(true);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => setVisible(e.isIntersecting),
      { threshold: VISIBLE_RATIO },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const last = sentences.length - 1;
  const finished = index >= last && !playing;
  // 이 문장에 머물 시간 — 아래 타이머의 의존값으로 쓴다. sentences 배열 자체를 의존값에
  // 넣으면 안 된다: 피드 머리의 카운트다운 때문에 부모가 1초마다 다시 그려지고, 그때마다
  // 이 배열이 새 객체로 만들어져 타이머가 매번 끊긴다 — 그래서 3초 뒤에 넘어가야 할 스냅이
  // 영원히 제자리였다(실측: 4.5초를 기다려도 1번째 장면). 숫자로 뽑아 두면 내용이 같은
  // 동안에는 같은 값이라 타이머가 살아남는다.
  const dwell = Math.min(
    DWELL_MAX_MS,
    DWELL_BASE_MS + (sentences[index]?.parts.reduce((n, p) => n + p.text.length, 0) ?? 0) * DWELL_PER_CHAR_MS,
  );
  useEffect(() => {
    if (!playing || !visible || !active || last < 1) return;
    if (index >= last) { setPlaying(false); return; }
    const t = setTimeout(() => setIndex((i) => i + 1), dwell);
    return () => clearTimeout(t);
  }, [playing, visible, active, index, last, dwell]);

  // 미니맵 표시 — 본진은 늘, 스냅의 주인공은 그때 자리에(요청).
  const bases: MinimapMarker[] = useMemo(() => {
    const spots = gameResult.summaryData?.bases;
    if (!spots) return [];
    return slots
      .filter((s) => spots[s.raw])
      .map((s) => {
        const nameLc = normalizeSearchText(s.name);
        const hit = highlightMemberIds?.has(s.slot.memberId)
          || !!highlightTerms?.some((t) => nameLc.includes(t));
        return {
          key: s.raw, name: s.name, memberId: s.slot.memberId,
          avatar: memberOf(s.slot.memberId)?.avatar ?? null,
          race: s.slot.race, team: s.team,
          x: spots[s.raw][0], y: spots[s.raw][1],
          withName: true, highlight: hit,
        };
      });
  }, [gameResult.summaryData, slots, memberOf, highlightMemberIds, highlightTerms]);

  const actors: MinimapMarker[] = useMemo(() => {
    const beats = gameResult.summaryData?.beats;
    const idx = sentences[index]?.beats;
    if (!beats || !idx) return [];
    // 한 문장에 여러 beat가 들어가면 같은 사람이 여러 번 나올 수 있다 — 뒤에 오는 것(더
    // 나중의 자리)이 이긴다.
    const at = new Map<string, [number, number]>();
    for (const n of idx) {
      for (const [raw, xy] of Object.entries(beats[n]?.pos ?? {})) at.set(raw, xy);
    }
    return slots
      .filter((s) => at.has(s.raw))
      .map((s) => ({
        key: s.raw, name: s.name, memberId: s.slot.memberId,
        avatar: memberOf(s.slot.memberId)?.avatar ?? null,
        race: s.slot.race, team: s.team,
        x: at.get(s.raw)![0], y: at.get(s.raw)![1],
        withName: false, highlight: false,
      }));
  }, [gameResult.summaryData, sentences, index, slots, memberOf]);

  const o1 = outcomeFor("team1", result);
  const o2 = outcomeFor("team2", result);
  const mapName = cleanMapName(gameResult.mapName);
  const minutes = gameResult.durationSeconds != null
    ? Math.round(gameResult.durationSeconds / 60) : null;
  // 미니맵이 있으면 맵 이름·플레이시간은 그림의 머리로 올라간다 — 아래 따로 한 줄 더 두면
  // 같은 말이 두 번 나온다.
  const showRoster = !mobile || grid === null;
  const showMapLine = grid === null && (mapName || minutes !== null);

  const mapBlock = grid && (
    <div className="scr-story-map">
      <div className="scr-story-map-head">
        {mapName && <span className="scr-story-map-name">{mapName}</span>}
        {minutes !== null && <span className="scr-story-map-dur">{minutes}분</span>}
        {/* 로스터를 감춘 자리(모바일)에서는 승패를 여기서 알려야 한다 — vs 양옆의 승/무
            배지가 로스터와 함께 사라지기 때문이다. 색이 곧 이긴 편이다. */}
        {!showRoster && result !== "not_held" && (
          <span
            className={cx("scr-story-win",
              result === "draw" ? "scr-story-win-draw"
                : o1 === "win" ? "scr-story-win-t1" : "scr-story-win-t2")}
          >
            {result === "draw" ? "무승부" : "승"}
          </span>
        )}
      </div>
      <ReplayMinimap grid={grid} bases={bases} actors={actors} />
    </div>
  );

  return (
    <div className="scr-story" ref={rootRef}>
      {showRoster && (
        <div className={cx("scr-challenge-matchup", "scr-feed-game-result-matchup", grid && "scr-story-matchup-wide")}>
          <RosterSide
            team={team1} memberOf={memberOf}
            highlightMemberIds={highlightMemberIds} highlightTerms={highlightTerms}
          />
          {/* 가운데 — 승/무 배지와 vs, 그리고 PC에서는 그 아래 미니맵(요청: PC에서는
              로스터 사이에). */}
          <div className="scr-story-mid">
            <span className="scr-challenge-arrow-row">
              <span className={cx("scr-challenge-inline-win", o1 === "draw" && "scr-challenge-inline-draw", o1 !== "win" && o1 !== "draw" && "scr-challenge-inline-win-hidden")}>
                {o1 === "draw" ? "무" : "승"}
              </span>
              <span className="scr-challenge-arrow scr-challenge-arrow-vs" aria-hidden="true">vs</span>
              <span className={cx("scr-challenge-inline-win", o2 === "draw" && "scr-challenge-inline-draw", o2 !== "win" && o2 !== "draw" && "scr-challenge-inline-win-hidden")}>
                {o2 === "draw" ? "무" : "승"}
              </span>
            </span>
            {mapBlock}
          </div>
          <RosterSide
            team={team2} memberOf={memberOf}
            highlightMemberIds={highlightMemberIds} highlightTerms={highlightTerms}
          />
        </div>
      )}
      {result === "not_held" && <div className="scr-feed-game-result-notheld">미실시</div>}
      {!showRoster && mapBlock}
      {/* 미니맵이 없는 경기는 예전처럼 맵 이름·플레이시간을 한 줄로 적는다. */}
      {showMapLine && (
        <div className="scr-game-result-trow-map-line scr-game-result-trow-map-meta">
          {mapName && <span className="scr-game-result-trow-map">{mapName}</span>}
          {minutes !== null && <span className="scr-game-result-trow-dur">({minutes}분)</span>}
        </div>
      )}
      {/* 타임라인은 스냅이 둘 이상일 때만 쓸모가 있다 — 한 문장짜리 요약에 재생 버튼을 두면
          누를 데는 있는데 아무 일도 안 일어난다. */}
      {grid && sentences.length > 1 && (
        <ReplayStoryTimeline
          snaps={sentences} end={gameResult.summaryData?.end ?? null}
          index={index} playing={playing} finished={finished}
          onSeek={(i) => { setIndex(i); setPlaying(false); }}
          onToggle={() => {
            if (finished) { setIndex(0); setPlaying(true); return; }
            setPlaying((v) => !v);
          }}
        />
      )}
      {sentences.length > 0 && (
        <div className="scr-game-result-trow-summary">
          {sentences.map((s, i) => (
            <span
              key={i}
              className={cx("scr-sum-sentence",
                // 타임라인이 없으면 하이라이트할 이유도 없다 — 훑을 수 없는 문단에 한 문장만
                // 밝으면 나머지가 흐려 보인다.
                grid && sentences.length > 1 && (i === index ? "scr-sum-sentence-on" : "scr-sum-sentence-off"))}
              onClick={grid && sentences.length > 1
                ? (e) => { e.stopPropagation(); setIndex(i); setPlaying(false); }
                : undefined}
            >
              {s.parts.map((p, j) => (p.team
                ? <span key={j} className={p.team === 1 ? "scr-sum-team1" : "scr-sum-team2"}>{p.text}</span>
                : <span key={j}>{p.text}</span>))}
              {i < sentences.length - 1 ? ". " : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
