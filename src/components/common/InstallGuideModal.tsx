import { createPortal } from "react-dom";
import { X, Share } from "lucide-react";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";

// iOS 사파리는 자동 설치 API가 없어, "공유 → 홈 화면에 추가" 절차를 그림/글로 안내한다.
// (안드로이드는 네이티브 설치 창이 바로 떠서 이 모달이 필요 없다.)
export default function InstallGuideModal({ onClose }: { onClose: () => void }) {
  useLockBodyScroll(true, onClose);
  return createPortal(
    <div className="scr-modal-overlay" onClick={onClose}>
      <div className="scr-modal scr-modal-sm scr-install-guide-modal" onClick={(e) => e.stopPropagation()}>
        <div className="scr-modal-head">
          <span>홈 화면에 추가</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>
        <div className="scr-modal-body">
          <p className="scr-install-guide-lead">
            홈 화면에 추가하면 <b>주소창 없이 앱처럼</b> 열려요. 몇 초면 됩니다.
          </p>
          <ol className="scr-install-guide-steps">
            <li>
              화면 우측 상단(또는 하단)의 <b>⋯ 더보기</b> 버튼을 누르세요.
            </li>
            <li>
              <span className="scr-install-guide-icon"><Share size={15} /></span>
              <b>공유</b> → <b>“홈 화면에 추가”</b>를 고르세요.
            </li>
            <li>
              <b>“웹 앱으로 열기”</b>를 켠 다음 <b>“추가”</b>를 누르면 끝!
            </li>
          </ol>
          <p className="scr-install-guide-note">
            ※ 카카오톡·인스타 인앱 브라우저는 우측 상단 ⋯ → “다른 브라우저로 열기(Safari 등)” 후 진행하세요.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
