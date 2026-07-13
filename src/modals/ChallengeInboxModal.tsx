import { useState } from "react";
import { createPortal } from "react-dom";
import { Spinner } from "../components/common/Feedback";
import { api } from "../api/client";
import { useAppStore } from "../store/appStore";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { formatChallengeSchedule } from "../utils/date";
import { MATCH_TYPE_INFO } from "../constants/matchTypes";
import type { Challenge } from "../types";

interface ChallengeInboxModalProps {
  challenges: Challenge[];
  onClose: () => void;
}

// 다음 접속 때 뜨는 도전장 팝업 — 한 번에 하나씩만 보여주고, 응답하거나 닫으면 큐의
// 다음 도전장으로 넘어간다. 전부 처리되면 onClose로 부모가 닫는다.
export default function ChallengeInboxModal({ challenges, onClose }: ChallengeInboxModalProps) {
  useLockBodyScroll();
  const myId = useAppStore((s) => s.user?.id);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const current = challenges[idx];
  if (!current) { onClose(); return null; }

  const advance = () => {
    setRejecting(false);
    setRejectReason("");
    if (idx + 1 >= challenges.length) onClose();
    else setIdx((i) => i + 1);
  };

  const accept = async () => {
    setErr("");
    setBusy(true);
    try {
      await api.respondToChallenge(current.id, "accepted");
      advance();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "응답하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    setErr("");
    setBusy(true);
    try {
      await api.respondToChallenge(current.id, "rejected", rejectReason.trim() || undefined);
      advance();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "응답하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  // "함께" 줄은 팀전(2명 이상 지목)에서 나 말고 같이 지목된 상대가 있을 때만 보여준다 —
  // 1:1이면 이미 상대가 나 하나뿐이라 중복이고, 나 자신의 이름만 나오면 어색하다.
  const others = current.targets.filter((t) => t.memberId !== myId).map((t) => t.nickname);

  return createPortal(
    <div className="scr-modal-overlay">
      <div className="scr-modal scr-modal-sm scr-challenge-inbox-modal">
        <div className="scr-challenge-envelope">
          <img src="/images/bg/letter.jpg" alt="" className="scr-challenge-envelope-img" />
        </div>
        <div className="scr-challenge-inbox-title">{current.createdBy.nickname}님으로부터 도전장이 도착했어요</div>

        <div className="scr-modal-body scr-challenge-inbox-body">
          {current.message && (
            <p className="scr-challenge-inbox-message">"{current.message}"</p>
          )}
          {others.length > 0 && (
            <div className="scr-challenge-inbox-row">
              <span className="scr-label">함께</span>
              <span>{others.join(", ")}</span>
            </div>
          )}
          <div className="scr-challenge-inbox-row">
            <span className="scr-label">종류</span>
            <span>{MATCH_TYPE_INFO[current.matchType]}</span>
          </div>
          <div className="scr-challenge-inbox-row">
            <span className="scr-label">일시</span>
            <span>{formatChallengeSchedule(current.scheduledAt)}</span>
          </div>

          {err && <div className="scr-err">{err}</div>}

          {rejecting ? (
            <div className="scr-challenge-time-change-form">
              <label className="scr-field">
                <span className="scr-label">거절 사유 (선택)</span>
                <input
                  type="text" className="scr-input" value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="예: 그날은 시간이 안 돼요"
                  maxLength={60}
                />
              </label>
              <div className="scr-form-actions">
                <button className="scr-btn scr-btn-ghost" onClick={() => setRejecting(false)} disabled={busy}>취소</button>
                <button className="scr-btn scr-challenge-reject-btn" onClick={reject} disabled={busy}>
                  {busy ? <Spinner /> : "거절하기"}
                </button>
              </div>
            </div>
          ) : (
            <div className="scr-form-actions">
              <button className="scr-btn scr-challenge-reject-btn" onClick={() => setRejecting(true)} disabled={busy}>
                거절
              </button>
              <button className="scr-btn scr-challenge-accept-btn" onClick={accept} disabled={busy}>
                {busy ? <><Spinner /> 처리 중...</> : "승락"}
              </button>
            </div>
          )}
        </div>

        {/* 재미 요소 — 구석에 살짝 걸쳐 보이는 이스터에그, 가장자리를 부드럽게 흐려 카드에
            자연스레 녹아들게 한다. */}
        <img src="/images/items/nawa.jpg" alt="" className="scr-challenge-easter-egg" />
      </div>
    </div>,
    document.body,
  );
}
