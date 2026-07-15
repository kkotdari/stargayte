import { useState } from "react";
import { createPortal } from "react-dom";
import { Spinner } from "../components/common/Feedback";
import Avatar, { type AvatarMember } from "../components/common/Avatar";
import { api } from "../api/client";
import { useAppStore } from "../store/appStore";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { formatChallengeSchedule, pad } from "../utils/date";
import { MATCH_TYPE_INFO } from "../constants/matchTypes";
import type { Challenge, ChallengeResult } from "../types";

interface ChallengeResultInboxModalProps {
  challenges: Challenge[];
  onClose: () => void;
}

// 다음 접속 때 뜨는 "결과 입력" 팝업 — 예정 일시가 지났는데 아직 결과가 안 들어온, 내가
// 참가한 확정 대결을 한 번에 하나씩 보여주고(요청: "결과 입력할게 여러개면 팝업도 여러개
// 뜨나?" → 큐로 하나씩) 승리팀을 눌러 바로 결과를 입력하게 한다. 초대(편지지)
// 팝업(ChallengeInboxModal)과 UI 패턴을 맞춘다. "봤는지"는 초대 팝업과 같은 원리로 서버
// (challenge_participants.result_notified)가 기억한다 — 조회 즉시 "봤음"이 되므로 여기
// 담겨 넘어온 목록 자체가 이미 "아직 안 본 것"뿐이고, 이 팝업에서 입력하든 넘기든 다시는
// 자동으로 안 뜬다(대결 화면에서는 결과가 입력될 때까지 계속 "결과 입력" 버튼이 뜬다).
export default function ChallengeResultInboxModal({ challenges, onClose }: ChallengeResultInboxModalProps) {
  useLockBodyScroll();
  const memberOf = useAppStore((s) => s.memberOf);
  const user = useAppStore((s) => s.user);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // 결과 입력 대신 연기(날짜/시간 다시 잡기)로 전환한 상태.
  const [mode, setMode] = useState<"result" | "postpone">("result");
  const [dateStr, setDateStr] = useState("");
  const [timeStr, setTimeStr] = useState("22:00");

  const current = challenges[idx];
  if (!current) { onClose(); return null; }

  // 취소는 생성자만(요청: "취소는 생성자만"). 연기는 참가자 누구나(이 팝업은 참가자에게만 뜬다).
  const isCreator = user?.id === current.createdBy.id;

  const advance = () => {
    setErr("");
    setMode("result");
    if (idx + 1 >= challenges.length) onClose();
    else setIdx((i) => i + 1);
  };

  const submit = async (winnerSide: ChallengeResult) => {
    setErr("");
    setBusy(true);
    try {
      await api.enterChallengeResult(current.id, winnerSide);
      advance();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "결과를 입력하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  // 연기는 기존 시간을 기본값으로 프리필한다(요청: "연기할때는 기존 시간이 기본값").
  const startPostpone = () => {
    const cur = current.scheduledAt ? new Date(current.scheduledAt) : null;
    setDateStr(cur ? `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}` : "");
    setTimeStr(cur ? `${pad(cur.getHours())}:${pad(cur.getMinutes())}` : "22:00");
    setErr("");
    setMode("postpone");
  };

  const doPostpone = async () => {
    if (!dateStr || !timeStr) return;
    setErr("");
    setBusy(true);
    try {
      await api.postponeChallenge(current.id, new Date(`${dateStr}T${timeStr}`).toISOString());
      advance();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "연기하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    if (!window.confirm("이 도전장을 취소할까요? 되돌릴 수 없어요.")) return;
    setErr("");
    setBusy(true);
    try {
      await api.cancelChallenge(current.id);
      advance();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "취소하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  // 도전자 본인은 응답 객체에 프사가 없어(닉네임만) 로컬 회원 목록에서 프사를 찾아 채운다 —
  // 지목된 상대/내 팀원은 서버가 프사까지 내려주니 그대로 쓴다.
  const creatorMembers: AvatarMember[] = [
    { id: current.createdBy.id, nickname: current.createdBy.nickname, avatar: memberOf(current.createdBy.id)?.avatar ?? null },
    ...current.ownMembers.map((m) => ({ id: m.memberId, nickname: m.nickname, avatar: m.avatar })),
  ];
  const targetMembers: AvatarMember[] = current.targets.map((t) => ({ id: t.memberId, nickname: t.nickname, avatar: t.avatar }));

  return createPortal(
    <div className="scr-modal-overlay">
      <div className="scr-modal scr-modal-sm scr-challenge-inbox-modal">
        <div className="scr-challenge-inbox-title">지난 대결의 결과를 입력해 주세요</div>
        <div className="scr-modal-body scr-challenge-inbox-body">
          {/* 어떤 경기인지 구분할 수 있게 종류/일시/한마디를 함께 보여준다(요청: "경기일시랑
              한마디 정보도 표현해줘야 무슨 경기인지 구분하기 쉽겠다"). */}
          <div className="scr-challenge-inbox-row">
            <span className="scr-label">종류</span>
            <span>{MATCH_TYPE_INFO[current.matchType]}</span>
          </div>
          <div className="scr-challenge-inbox-row">
            <span className="scr-label">일시</span>
            <span>{formatChallengeSchedule(current.scheduledAt)}</span>
          </div>
          {current.message && (
            <p className="scr-challenge-inbox-message">"{current.message}"</p>
          )}

          {err && <div className="scr-err">{err}</div>}

          {mode === "postpone" ? (
            /* 연기 — 새 일시(기존 시간 프리필)로 다시 잡는다. */
            <>
              <p className="scr-challenge-inbox-message">새 일시로 연기해요.</p>
              <div className="scr-challenge-datetime">
                <input
                  type="date" className="scr-input" value={dateStr}
                  onChange={(e) => setDateStr(e.target.value)}
                />
                <input
                  type="time" className="scr-input" value={timeStr}
                  onChange={(e) => setTimeStr(e.target.value)} disabled={!dateStr}
                />
              </div>
              <div className="scr-form-actions">
                <button className="scr-btn scr-btn-ghost" onClick={() => setMode("result")} disabled={busy}>뒤로</button>
                <button
                  className="scr-btn scr-challenge-accept-btn" onClick={doPostpone}
                  disabled={busy || !dateStr || !timeStr}
                >
                  {busy ? <Spinner /> : "연기"}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="scr-challenge-inbox-message">승리한 팀을 눌러주세요 — 먼저 입력하는 쪽이 그대로 인정돼요.</p>

              {/* 구성원을 프사와 함께 보여주고 팀 카드를 눌러 승리팀을 고른다(요청: "구성원이
                  노출되고 승리팀을 고르는게 좋을듯"). */}
              <div className="scr-challenge-result-teams">
                <button
                  type="button" className="scr-challenge-result-team" onClick={() => submit("creator")}
                  disabled={busy}
                >
                  <span className="scr-challenge-result-team-label">도전자편</span>
                  <span className="scr-challenge-result-team-members">
                    {creatorMembers.map((p) => (
                      <span key={p.id} className="scr-challenge-result-member">
                        <Avatar member={p} size={20} />
                        <span className="scr-challenge-result-member-name">{p.nickname}</span>
                      </span>
                    ))}
                  </span>
                  <span className="scr-challenge-result-team-win">승리</span>
                </button>
                <button
                  type="button" className="scr-challenge-result-team" onClick={() => submit("target")}
                  disabled={busy}
                >
                  <span className="scr-challenge-result-team-label">상대편</span>
                  <span className="scr-challenge-result-team-members">
                    {targetMembers.map((p) => (
                      <span key={p.id} className="scr-challenge-result-member">
                        <Avatar member={p} size={20} />
                        <span className="scr-challenge-result-member-name">{p.nickname}</span>
                      </span>
                    ))}
                  </span>
                  <span className="scr-challenge-result-team-win">승리</span>
                </button>
              </div>

              {/* 승패가 없는 결과(요청: "무승부나 미실시도 있게 해주고"). */}
              <div className="scr-form-actions">
                <button className="scr-btn scr-btn-ghost" onClick={() => submit("draw")} disabled={busy}>무승부</button>
                <button className="scr-btn scr-btn-ghost" onClick={() => submit("not_held")} disabled={busy}>미실시</button>
              </div>
              {/* 연기(참가자 누구나) / 취소(생성자만) / 나중에 — 결과 대신 일정을 바꾸거나 접는다. */}
              <div className="scr-form-actions">
                <button className="scr-btn scr-btn-ghost" onClick={startPostpone} disabled={busy}>연기</button>
                {isCreator && (
                  <button className="scr-btn scr-btn-ghost" onClick={doCancel} disabled={busy}>취소</button>
                )}
                <button className="scr-btn scr-btn-ghost" onClick={advance} disabled={busy}>나중에</button>
              </div>
            </>
          )}
          {busy && <div className="scr-challenge-result-busy"><Spinner /></div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
