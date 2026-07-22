import { AlertTriangle } from "lucide-react";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  // 호출처별 스타일 미세조정용(예: 배치등록 확인창 텍스트 축소) — 카드에 그대로 붙는다.
  className?: string;
}

export default function ConfirmDialog({
  title, message, confirmLabel = "확인", cancelLabel = "취소", onConfirm, onCancel, className,
}: ConfirmDialogProps) {
  useLockBodyScroll();
  return (
    <div className="scr-modal-overlay">
      <div className={`scr-modal scr-modal-sm scr-modal-confirm${className ? ` ${className}` : ""}`}>
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
