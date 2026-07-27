import { createPortal } from "react-dom";
import { X, Sparkles } from "lucide-react";
import { useLockBodyScroll } from "../utils/bodyScrollLock";

interface AppUpdateNoticeModalProps {
  // 보여줄 안내 내용 — 관리자가 입력한 원문 그대로(줄바꿈/빈 줄/들여쓰기 포함). 버전별로
  // 서버(app_versions.notes)에 있고, 호출부가 활성 버전의 내용을 넘긴다. "버전 안내
  // 설정"의 미리보기도 같은 모달을 그대로 재사용한다.
  notes: string;
  onClose: () => void;
}

// 운영자가 제어판에서 버전을 배포하면, 그 뒤 처음 접속하는 회원에게 한 번만 뜬다(각자
// 브라우저에 "마지막으로 본 버전"을 저장해두고 비교 — appStore의 updateNotice 참고).
// 내용은 배포된 버전에 저장된 안내 내용(notes)을 '입력한 원문 그대로' 보여준다 — 예전엔
// 줄 단위로 쪼개 불릿 목록(ul/li)으로 그렸는데, 엔터만 치면 무조건 동그라미 구분자가 붙고
// 빈 줄·들여쓰기가 사라져 자유도가 너무 떨어졌다(지적). 지금은 white-space:pre-wrap으로
// 줄바꿈·빈 줄·공백을 있는 그대로 렌더한다(불릿을 원하면 관리자가 직접 찍어 넣으면 된다).
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
          <div className="scr-update-notice-body">{notes}</div>

          <div className="scr-form-actions">
            <button type="button" className="scr-btn scr-btn-primary" onClick={onClose}>확인</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
