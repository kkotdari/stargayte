import { useEffect, useState } from "react";
import { Spinner } from "../../components/common/Feedback";
import MatchList, { type SearchListRow } from "../v2/MatchList";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { formatChallengeSchedule } from "../../utils/date";
import type { Challenge, Match } from "../../types";

// 카카오톡으로 공유된 링크(?sv=match|challenge&sid=…)가 여는, 그 한 장만 보이는 화면(요청:
// "너나와/경기 공유시 해당 카드만 있는 화면"). 로그인 뒤에 뜨며, "앱 열기"로 전체 앱으로 들어간다.
export interface ShareTarget {
  type: "match" | "challenge";
  id: number;
}

// 너 나와 카드(읽기 전용) — 초대 편지지(ChallengeInboxModal)의 안쪽 클래스를 그대로 빌려
// 쓰되, 전체 화면을 덮는 스크림(.scr-modal의 거대한 box-shadow)은 피하려고 .scr-modal 대신
// 가벼운 .scr-share-card로 감싼다.
function ShareChallengeCard({ challenge }: { challenge: Challenge }) {
  const isTeam = challenge.matchType === "0102";
  const targetNames = challenge.targets.map((t) => t.nickname);
  const opposingTeam = [challenge.createdBy.nickname, ...challenge.ownMembers.map((m) => m.nickname)];
  const ourTeam = challenge.targets.map((t) => t.nickname);
  return (
    <div className="scr-share-card scr-challenge-inbox-modal">
      <div className="scr-challenge-inbox-title">{targetNames.join(", ")} 너 나와!</div>
      <img src="/images/items/nawa2.jpg" alt="" className="scr-challenge-inbox-hero" />
      <div className="scr-challenge-inbox-body">
        {isTeam ? (
          <>
            <div className="scr-challenge-inbox-row scr-challenge-inbox-team-row">
              <span className="scr-label scr-challenge-team-label scr-challenge-team-label-them">상대팀</span>
              <span className="scr-challenge-team-names">{opposingTeam.join(", ")}</span>
            </div>
            <div className="scr-challenge-inbox-row scr-challenge-inbox-team-row">
              <span className="scr-label scr-challenge-team-label scr-challenge-team-label-us">우리팀</span>
              <span className="scr-challenge-team-names">{ourTeam.join(", ")}</span>
            </div>
          </>
        ) : (
          <div className="scr-challenge-inbox-row">
            <span className="scr-label">도전자</span>
            <span>{challenge.createdBy.nickname}</span>
          </div>
        )}
        <div className="scr-challenge-inbox-row">
          <span className="scr-label">일시</span>
          <span>{formatChallengeSchedule(challenge.scheduledAt)}</span>
        </div>
      </div>
    </div>
  );
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

  const rows: SearchListRow[] = match
    ? [{ id: match.id, date: match.date, team1: match.team1, team2: match.team2, result: match.result, raw: match }]
    : [];

  return (
    <div className="scr-share-page">
      <div className="scr-share-head">
        <span className="scr-share-brand">스타게이트</span>
        <button type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid" onClick={onExit}>
          앱 열기
        </button>
      </div>
      <div className="scr-share-body">
        {loading ? (
          <div className="scr-empty"><Spinner size={18} /></div>
        ) : err ? (
          <div className="scr-err">{err}</div>
        ) : target.type === "match" && match ? (
          <div className="scr-share-match">
            <MatchList rows={rows} memberOf={memberOf} onMemo={() => {}} onDeleted={() => {}} loading={false} />
          </div>
        ) : challenge ? (
          <ShareChallengeCard challenge={challenge} />
        ) : null}
      </div>
    </div>
  );
}
