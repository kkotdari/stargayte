import { useEffect, useState } from "react";
import { LoadingMark } from "../../components/common/Feedback";
import ChallengeInboxModal from "../../modals/ChallengeInboxModal";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { useForceLightTheme } from "../../utils/theme";
import RankingShiftCard from "../activity/RankingShiftCard";
import {
  GameResultCard, GameResultPost, gameResultItem, sessionDateLabel, sessionDateOf, type GameResultPostItem,
} from "../activity/ActivityScreen";
import { formatWhen, shortDate } from "../../utils/date";
import type { Challenge, GameResult, RankingShift } from "../../types";

// 카카오톡으로 공유된 링크(?sv=gameResult|challenge|rankingShift&sid=…)가 여는, 그 한 장만 보이는
// 화면(요청: "너나와/경기 공유시 해당 카드만 있는 화면" + "순위변동도 카톡공유 가능").
// 로그인 뒤에 뜨며, "스타게이트로"로 전체 앱에 들어간다.
// 게임결과 묶음만 id가 아니라 세션 날짜(YYYY-MM-DD)로 가리킨다 — 묶음은 DB 행이 아니라
// '같은 자리에서 이어 친 판들'을 화면에서 묶어 보여주는 것뿐이라 가리킬 id가 없다(요청:
// "카드뭉치는 UI적으로만 뭉쳐보이는거니까"). 그 자리를 정하는 값이 곧 세션 날짜다.
export type ShareTarget =
  /* challenge는 호출("OO 너 나와!"), challengeReply는 그 호출에 돌아온 답이다 — 같은
     도전장을 가리키지만 보여줄 이야기가 다르다(지적: 응답 공유가 호출 공유와 똑같은
     화면으로 연결됨). */
  | { type: "gameResult" | "challenge" | "challengeReply" | "rankingShift"; id: number }
  | { type: "stack"; day: string };

export default function SharePage({ target, onExit }: { target: ShareTarget; onExit: () => void }) {
  // 카톡 공유 링크로 열린 화면(공유 인박스/편지지)은 라이트 테마 강제(요청).
  useForceLightTheme();
  const memberOf = useAppStore((s) => s.memberOf);
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [shift, setShift] = useState<RankingShift | null>(null);
  const [stack, setStack] = useState<GameResultPostItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  // 목적지 값(id 또는 세션 날짜) 하나로 아래 useEffect의 의존성을 잡는다.
  const targetKey = target.type === "stack" ? target.day : String(target.id);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr("");
    setGameResult(null);
    setChallenge(null);
    setShift(null);
    setStack(null);
    void (async () => {
      try {
        if (target.type === "stack") {
          // 세션 날짜는 새벽 경기를 전날에 붙이므로(sessionDateOf), 그 날짜와 다음 날까지
          // 받아 온 뒤 같은 세션인 것만 남긴다 — 이틀치라 건수가 얼마 안 된다.
          const next = new Date(`${target.day}T00:00:00`);
          next.setDate(next.getDate() + 1);
          // toISOString은 UTC라 한국(UTC+9)에서는 하루 앞 날짜가 나온다 — 로컬 값으로 직접 짠다.
          const to = `${next.getFullYear()}-${`${next.getMonth() + 1}`.padStart(2, "0")}-${`${next.getDate()}`.padStart(2, "0")}`;
          // 한 번에 받을 수 있는 상한은 100건이다(서버 Query(le=100)) — 그보다 크게
          // 달라고 하면 422로 튕겨 공유 링크가 통째로 에러 화면이 됐다(신고). 이틀치가
          // 100건을 넘는 일은 드물지만, 넘더라도 빠지는 경기가 없도록 커서로 이어 받는다.
          const items: GameResult[] = [];
          let cursor: string | undefined;
          for (let guard = 0; guard < 20; guard += 1) {
            const page = await api.getGameResultsPage({
              dateFrom: target.day, dateTo: to, sort: "latest", limit: 100, cursor,
            });
            items.push(...page.items);
            if (!page.hasMore || !page.nextCursor) break;
            cursor = page.nextCursor;
          }
          const mine = items.map(gameResultItem).filter((it) => sessionDateOf(it) === target.day);
          if (!alive) return;
          if (mine.length === 0) {
            setErr("공유된 게임결과를 찾을 수 없어요.");
          } else {
            // 활동와 같은 순서(최신 → 과거)로 넘긴다.
            mine.sort((a, b) => b.time - a.time);
            setStack({ kind: "gameResultPost", time: mine[0].time, date: target.day, items: mine });
          }
        } else if (target.type === "gameResult") {
          const m = await api.getGameResult(target.id);
          if (alive) setGameResult(m);
        } else if (target.type === "rankingShift") {
          // 단건 조회 엔드포인트가 없어 목록에서 골라낸다(너 나와와 같은 방식).
          const snaps = await api.listRankingShifts();
          const s = snaps.find((it) => it.id === target.id) ?? null;
          if (alive) {
            setShift(s);
            if (!s) setErr("공유된 순위변동을 찾을 수 없어요.");
          }
        } else {
          // 단건 조회 엔드포인트가 없어 전체 목록에서 골라낸다(클럽 규모라 부담 없음).
          const { items } = await api.getChallenges();
          const c = items.find((it) => it.id === target.id) ?? null;
          if (alive) {
            setChallenge(c);
            if (!c) setErr("공유된 너 나와를 찾을 수 없어요.");
          }
        }
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : "불러오지 못했어요.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- target은 type+targetKey로 충분히 표현된다
  }, [target.type, targetKey]);

  // 너 나와 공유는 인박스의 편지지를 그대로 재사용한다(요청). 지목된 대상만 응답 버튼을
  // 보고, 아니면 읽기 전용이며 "스타게이트로"로 앱에 들어간다. 인박스 모달이 전체 화면
  // 오버레이라 별도 상단바 없이 그것만 띄운다.
  // 봉투 장면은 없다(요청: "공유는 호출완료시·응답완료시·활동목록에서 어떤 경우라도
  // 편지지만 바로") — 링크를 타고 온 사람에겐 카카오톡 카드가 이미 봉투 노릇을 했다.
  if (target.type === "challenge" || target.type === "challengeReply") {
    if (loading) return <div className="scr-share-page"><div className="scr-share-body"><LoadingMark /></div></div>;
    if (challenge) {
      return (
        <ChallengeInboxModal
          challenges={[challenge]} onClose={onExit} closeLabel="스타게이트로" shareBackdrop skipEnvelope
          reply={target.type === "challengeReply"}
        />
      );
    }
    return (
      <div className="scr-share-page">
        <div className="scr-share-body"><div className="scr-err">{err || "찾을 수 없어요."}</div></div>
        <ShareFoot onExit={onExit} />
      </div>
    );
  }

  return (
    <div className="scr-share-page">
      <div className="scr-share-body">
        {loading ? (
          <LoadingMark />
        ) : err ? (
          <div className="scr-err">{err}</div>
        ) : gameResult ? (
          // 경기 한 장 공유 — 묶음 공유와 마찬가지로 활동의 그 카드를 그대로 쓴다(요청).
          // 예전엔 목록(GameResultCardBody)을 날것으로 얹어서, 활동에는 없는 숫자 날짜 머리글이
          // 뜨고 카드 머리(시각·등록자·제목)는 없는 다른 모양이었다.
          <div className="scr-activity-list">
            <GameResultCard
              item={gameResultItem(gameResult)} memberOf={memberOf} onDeleted={() => {}}
              dateLabel={shortDate(gameResult.date)}
            />
          </div>
        ) : shift ? (
          // 순위변동 공유 — 활동와 같은 카드 한 장(읽기 전용, 케밥/상세/댓글 없이).
          <div className="scr-activity-list">
            <RankingShiftCard shift={shift} timeText={formatWhen(shift.createdAt, { clock: true })} />
          </div>
        ) : stack ? (
          // 게임결과 묶음 공유 — 활동의 그 카드를 그대로 재사용한다(요청). 접힌 채로 뜨고
          // 누르면 활동에서와 똑같이 펼쳐진다.
          <div className="scr-activity-list">
            <GameResultPost
              stack={stack} memberOf={memberOf} onDeleted={() => {}}
              dateLabel={sessionDateLabel(stack.date)}
            />
          </div>
        ) : null}
      </div>
      <ShareFoot onExit={onExit} />
    </div>
  );
}

// 브랜드 + "스타게이트로" — 예전엔 페이지 맨 위에 있었는데 아래로 내렸다(요청). 인앱
// 브라우저(카톡)로 열면 화면 위쪽은 이미 주소창·닫기 버튼이 차지하고 있어서 그 바로 아래에
// 또 브랜드 줄이 얹히면 머리가 두 겹이 되고, 공유된 카드를 보러 온 사람에게 "앱으로 가기"는
// 다 본 다음의 일이다.
// .scr-share-page가 flex 컬럼이고 본문이 flex:1이라, 마크업 순서만 바꾸면 바닥에 붙는다.
function ShareFoot({ onExit }: { onExit: () => void }) {
  return (
    <div className="scr-share-foot">
      {/* 왼쪽에 "스타게이트" 글자를 함께 뒀었는데 지웠다(요청: 의미 없어 보인다) —
          바로 옆 버튼이 이미 "스타게이트로"라서 같은 말이 두 번이었다. */}
      <button type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid" onClick={onExit}>
        스타게이트로
      </button>
    </div>
  );
}
