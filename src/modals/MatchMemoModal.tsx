import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Spinner } from "../components/common/Feedback";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { api } from "../api/client";
import type { Match } from "../types";

interface MatchMemoModalProps {
  match: Match;
  onClose: () => void;
  onSaved: (updated: Match) => void;
}

// 팀/결과 등을 바꾸는 정식 수정(MatchModal, 작성자·운영자 전용)과 달리 note 한 필드만
// 남기는 가벼운 메모 — 회원 누구나 쓸 수 있다(나중에 이 메모로 검색도 가능하게 할 예정).
export default function MatchMemoModal({ match, onClose, onSaved }: MatchMemoModalProps) {
  useLockBodyScroll();
  const [note, setNote] = useState(match.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    setErr("");
    setBusy(true);
    try {
      const updated = await api.updateMatchMemo(match.id, note);
      onSaved(updated);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "메모 저장에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="scr-modal-overlay">
      <div className="scr-modal scr-modal-sm">
        <div className="scr-modal-head">
          <span>메모 남기기</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>

        <div className="scr-modal-body">
          <label className="scr-field">
            <span className="scr-label">메모</span>
            <textarea
              className="scr-input scr-textarea"
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="이 경기에 남길 메모를 적어주세요"
              autoFocus
            />
          </label>

          {err && <div className="scr-err">{err}</div>}

          <div className="scr-form-actions">
            <button className="scr-btn scr-btn-ghost" onClick={onClose}>취소</button>
            <button className="scr-btn scr-btn-primary" onClick={save} disabled={busy}>
              {busy ? <><Spinner /> 저장 중...</> : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
