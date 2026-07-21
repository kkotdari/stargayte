import { useEffect, useState } from "react";
import { Spinner } from "../../components/common/Feedback";
import MatchList, { type SearchListRow } from "../v2/MatchList";
import ChallengeInboxModal from "../../modals/ChallengeInboxModal";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import type { Challenge, Match } from "../../types";

// 카카오톡으로 공유된 링크(?sv=match|challenge&sid=…)가 여는, 그 한 장만 보이는 화면(요청:
// "너나와/경기 공유시 해당 카드만 있는 화면"). 로그인 뒤에 뜨며, "스타게이트로"로 전체 앱에 들어간다.
export interface ShareTarget {
  type: "match" | "challenge";
  id: number;
}

export default function SharePage({ target, onExit }: { target: ShareTarget; onExit: () => void }) {
  const memberOf = useAppStore((s) => s.memberOf);
  const [match, setMatch] = useState<Match | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr("");
    setMatch(null);
    setChallenge(null);
    void (async () => {
      try {
        if (target.type === "match") {
          const m = await api.getMatch(target.id);
          if (alive) setMatch(m);
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
  }, [target.type, target.id]);

  // 너 나와 공유는 인박스(편지봉투→편지지)를 그대로 재사용한다(요청). 지목된 대상만 응답
  // 버튼을 보고, 아니면 읽기 전용이며 "스타게이트로"로 앱에 들어간다. 인박스 모달이
  // 전체 화면 오버레이라 별도 상단바 없이 그것만 띄운다.
  if (target.type === "challenge") {
    if (loading) return <div className="scr-share-page"><div className="scr-share-body"><Spinner size={18} /></div></div>;
    if (challenge) return <ChallengeInboxModal challenges={[challenge]} onClose={onExit} closeLabel="스타게이트로" />;
    return (
      <div className="scr-share-page">
        <div className="scr-share-head">
          <span className="scr-share-brand">스타게이트</span>
          <button type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid" onClick={onExit}>스타게이트로</button>
        </div>
        <div className="scr-share-body"><div className="scr-err">{err || "찾을 수 없어요."}</div></div>
      </div>
    );
  }

  const rows: SearchListRow[] = match
    ? [{ id: match.id, date: match.date, team1: match.team1, team2: match.team2, result: match.result, raw: match }]
    : [];

  return (
    <div className="scr-share-page">
      <div className="scr-share-head">
        <span className="scr-share-brand">스타게이트</span>
        <button type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid" onClick={onExit}>
          스타게이트로
        </button>
      </div>
      <div className="scr-share-body">
        {loading ? (
          <div className="scr-empty"><Spinner size={18} /></div>
        ) : err ? (
          <div className="scr-err">{err}</div>
        ) : match ? (
          <div className="scr-share-match">
            <MatchList rows={rows} memberOf={memberOf} onDeleted={() => {}} loading={false} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
