import { useState } from "react";
import { createPortal } from "react-dom";
import { Spinner } from "../components/common/Feedback";
import { api } from "../api/client";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { formatChallengeSchedule } from "../utils/date";
import { MATCH_TYPE_INFO } from "../constants/matchTypes";
import type { Challenge, ChallengeSide } from "../types";

interface ChallengeResultInboxModalProps {
  challenges: Challenge[];
  onClose: () => void;
}

// 다음 접속 때 뜨는 "결과 입력" 팝업 — 예정 일시가 지났는데 아직 결과가 안 들어온, 내가
// 참가한 확정 대결을 한 번에 하나씩 보여주고 승패를 바로 입력하게 한다. 초대(편지지)
// 팝업(ChallengeInboxModal)과 UI 패턴을 맞춘다. 서버에 "결과 안 봄" 플래그가 없어서(초대
// 팝업과 달리) 어디까지 팝업으로 봤는지는 localStorage로만 관리한다 — 여기 담겨 넘어온
// 목록 자체가 이미 "아직 안 본 것"만 걸러진 것이고, 이 팝업에서 입력하든 넘기든 다시는
// 자동으로 안 뜬다(대결 화면에서는 결과가 입력될 때까지 계속 "결과 입력" 버튼이 뜬다).
export default function ChallengeResultInboxModal({ challenges, onClose }: ChallengeResultInboxModalProps) {
  useLockBodyScroll();
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const current = challenges[idx];
  if (!current) { onClose(); return null; }

  const advance = () => {
    setErr("");
    if (idx + 1 >= challenges.length) onClose();
    else setIdx((i) => i + 1);
  };

  const submit = async (winnerSide: ChallengeSide) => {
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

  const creatorNames = [current.createdBy.nickname, ...current.ownMembers.map((m) => m.nickname)].join(", ");
  const targetNames = current.targets.map((t) => t.nickname).join(", ");

  return createPortal(
    <div className="scr-modal-overlay">
      <div className="scr-modal scr-modal-sm scr-challenge-inbox-modal">
        <div className="scr-challenge-inbox-title">지난 대결의 결과를 입력해 주세요</div>
        <div className="scr-modal-body scr-challenge-inbox-body">
          <div className="scr-challenge-inbox-row">
            <span className="scr-label">종류</span>
            <span>{MATCH_TYPE_INFO[current.matchType]}</span>
          </div>
          <div className="scr-challenge-inbox-row">
            <span className="scr-label">일시</span>
            <span>{formatChallengeSchedule(current.scheduledAt)}</span>
          </div>
          <div className="scr-challenge-inbox-row">
            <span className="scr-label">도전자편</span>
            <span>{creatorNames}</span>
          </div>
          <div className="scr-challenge-inbox-row">
            <span className="scr-label">상대편</span>
            <span>{targetNames}</span>
          </div>
          {current.message && (
            <p className="scr-challenge-inbox-message">"{current.message}"</p>
          )}

          <p className="scr-challenge-inbox-message">누가 이겼나요? — 먼저 입력하는 쪽이 그대로 인정돼요.</p>

          {err && <div className="scr-err">{err}</div>}

          <div className="scr-form-actions">
            <button className="scr-btn scr-challenge-reject-btn" onClick={() => submit("target")} disabled={busy}>
              {busy ? <Spinner /> : "상대편 승"}
            </button>
            <button className="scr-btn scr-challenge-accept-btn" onClick={() => submit("creator")} disabled={busy}>
              {busy ? <Spinner /> : "도전자편 승"}
            </button>
          </div>
          <div className="scr-form-actions">
            <button className="scr-btn scr-btn-ghost" onClick={advance} disabled={busy}>나중에</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
