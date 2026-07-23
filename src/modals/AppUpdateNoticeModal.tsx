import { createPortal } from "react-dom";
import { X, Sparkles } from "lucide-react";
import { useLockBodyScroll } from "../utils/bodyScrollLock";

interface AppUpdateNoticeModalProps {
  // 보여줄 안내 내용(줄 단위 항목) — 이제 버전별로 서버(app_versions.notes)에 있고, 호출부가
  // 활성 버전의 내용을 넘긴다. "버전 안내 설정"의 미리보기도 같은 모달을 그대로 재사용한다.
  notes: string[];
  onClose: () => void;
}

// 운영자가 제어판에서 버전을 배포하면, 그 뒤 처음 접속하는 회원에게 한 번만 뜬다(각자
// 브라우저에 "마지막으로 본 버전"을 저장해두고 비교 — appStore의 updateNotice 참고).
// 내용은 배포된 버전에 저장된 안내 내용(notes)을 그대로 보여준다 — 관리자가 "버전 안내
// 설정"에서 버전별로 편집하고, 전역 토글로 표시 자체를 끌 수도 있다.
export default function AppUpdateNoticeModal({ notes, onClose }: AppUpdateNoticeModalProps) {
  useLockBodyScroll(true, onClose);

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
            {notes.map((note, i) => <li key={i}>{note}</li>)}
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
