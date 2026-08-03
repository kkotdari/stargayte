import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** 확인을 눌렀는데 실패했을 때 그 자리에 남길 말.
   *
   *  이게 없던 동안 확인창들은 실패를 삼켰다 — onConfirm이 던지면 창은 그대로 떠 있고
   *  아무 말도 안 나와서, 누르는 쪽에서는 버튼이 죽은 것처럼 보였다(지적: "조용히 오류남
   *  페이지가 멈춤"). 실패한 자리에서 실패를 말해야 다시 누를지 물러날지 정할 수 있다. */
  error?: string | null;
  // 호출처별 스타일 미세조정용(예: 배치등록 확인창 텍스트 축소) — 카드에 그대로 붙는다.
  className?: string;
}

export default function ConfirmDialog({
  title, message, confirmLabel = "확인", cancelLabel = "취소", onConfirm, onCancel,
  error = null, className,
}: ConfirmDialogProps) {
  useLockBodyScroll();
  /* body로 빼서 그린다 — 확인창은 화면의 것이지 그것을 띄운 카드의 것이 아니다.
     .scr-modal은 position: fixed로 화면 중앙에 서는데, 부르는 자리가 transform·filter를
     가진 조상 안이면 그 조상이 담는 블록이 되어 카드 한가운데에 앉는다(지적). 실제로
     펼친 줄의 여닫기 애니메이션이 그 조상이었고 그건 그것대로 고쳤지만, 확인창은 어디서
     불리든 화면 중앙이어야 하므로 자리 자체를 DOM 최상위로 옮긴다.
     리액트 이벤트는 포털을 건너도 리액트 트리를 따라 오르므로, 부르는 쪽이 클릭 전파를
     끊어 둔 것(GameResultCardBody의 stopPropagation 래퍼)은 그대로 듣는다. */
  return createPortal(
    <div className="scr-modal-overlay">
      <div className={`scr-modal scr-modal-sm scr-modal-confirm${className ? ` ${className}` : ""}`}>
        <div className="scr-confirm-head">
          <AlertTriangle size={18} className="scr-confirm-icon" />
          <span>{title}</span>
        </div>
        {message && <p className="scr-confirm-msg">{message}</p>}
        {error && <div className="scr-err" role="alert">{error}</div>}
        <div className="scr-form-actions">
          <button className="scr-btn scr-btn-ghost" onClick={onCancel}>{cancelLabel}</button>
          <button className="scr-btn scr-btn-primary" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
