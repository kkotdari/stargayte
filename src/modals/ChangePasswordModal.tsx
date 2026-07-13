import { useState } from "react";
import { X } from "lucide-react";
import { Spinner } from "../components/common/Feedback";
import { useAppStore } from "../store/appStore";

interface ChangePasswordModalProps {
  onClose: () => void;
}

// 내 정보 수정 모달 안에서 "비밀번호 변경" 버튼을 눌러야 뜨는 별도 창 — 현재 비밀번호
// 확인이 필요한 독립된 동작이라 나머지 프로필 항목들의 일괄 저장과 분리했다. 이 모달은
// ProfileModal이 이미 만들어 둔 portal/스크롤 잠금 안에서 조건부로 렌더링되므로(예:
// ConfirmDialog와 같은 패턴) 여기서 따로 createPortal/useLockBodyScroll을 하지 않는다.
export default function ChangePasswordModal({ onClose }: ChangePasswordModalProps) {
  const updatePassword = useAppStore((s) => s.updatePassword);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    if (!currentPassword || !newPassword) {
      setErr("현재 비밀번호와 새 비밀번호를 모두 입력해 주세요.");
      return;
    }
    if (newPassword.length < 4) {
      setErr("새 비밀번호는 4자 이상이어야 해요.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setErr("새 비밀번호가 서로 일치하지 않아요.");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      await updatePassword(currentPassword, newPassword);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "비밀번호 변경에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scr-modal-overlay">
      <div className="scr-modal scr-modal-sm">
        <div className="scr-modal-head">
          <span>비밀번호 변경</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>

        <div className="scr-modal-body">
          <label className="scr-field">
            <span className="scr-label">현재 비밀번호</span>
            <input
              type="password"
              className="scr-input"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
            />
          </label>
          <label className="scr-field">
            <span className="scr-label">새 비밀번호</span>
            <input
              type="password"
              className="scr-input"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="4자 이상"
              autoComplete="new-password"
            />
          </label>
          <label className="scr-field">
            <span className="scr-label">새 비밀번호 확인</span>
            <input
              type="password"
              className="scr-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>

          {err && <div className="scr-err">{err}</div>}

          <div className="scr-form-actions">
            <button className="scr-btn scr-btn-ghost" onClick={onClose}>취소</button>
            <button className="scr-btn scr-btn-primary" onClick={save} disabled={busy}>
              {busy ? <><Spinner /> 변경 중...</> : "변경"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
