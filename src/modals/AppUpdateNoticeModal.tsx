import { createPortal } from "react-dom";
import { X, Sparkles } from "lucide-react";
import { useLockBodyScroll } from "../utils/bodyScrollLock";
import { APP_UPDATE_NOTES } from "../constants/menuVersions";

interface AppUpdateNoticeModalProps {
  onClose: () => void;
}

// 운영자가 제어판에서 버전을 배포하면, 그 뒤 처음 접속하는 회원에게 한 번만 뜬다(각자
// 브라우저에 "마지막으로 본 버전"을 저장해두고 비교 — appStore의 updateNotice 참고).
// 내용은 고정된 최신 변경 목록(APP_UPDATE_NOTES)을 그대로 보여준다 — 버전별로 갈라
// 쌓아두기엔 배포가 잦지 않아, "가장 최근에 뭐가 바뀌었는지" 한 화면이면 충분하다.
export default function AppUpdateNoticeModal({ onClose }: AppUpdateNoticeModalProps) {
  useLockBodyScroll();

  return createPortal(
    <div className="scr-modal-overlay" onClick={onClose}>
      <div className="scr-modal scr-modal-sm scr-update-notice-modal" onClick={(e) => e.stopPropagation()}>
        <div className="scr-modal-head">
          <span><Sparkles size={15} className="scr-update-notice-icon" /> 업데이트 안내</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>

        <div className="scr-modal-body">
          <p className="scr-update-notice-title">업데이트 내용</p>
          <ul className="scr-update-notice-list">
            {APP_UPDATE_NOTES.map((note) => <li key={note}>{note}</li>)}
          </ul>

          <div className="scr-form-actions">
            <button type="button" className="scr-btn scr-btn-primary" onClick={onClose}>확인</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
