import { AlertTriangle } from "lucide-react";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title, message, confirmLabel = "확인", cancelLabel = "취소", onConfirm, onCancel,
}: ConfirmDialogProps) {
  useLockBodyScroll();
  return (
    <div className="scr-modal-overlay">
      <div className="scr-modal scr-modal-sm scr-modal-confirm">
        <div className="scr-confirm-head">
          <AlertTriangle size={18} className="scr-confirm-icon" />
          <span>{title}</span>
        </div>
        {message && <p className="scr-confirm-msg">{message}</p>}
        <div className="scr-form-actions">
          <button className="scr-btn scr-btn-ghost" onClick={onCancel}>{cancelLabel}</button>
          <button className="scr-btn scr-btn-primary" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
