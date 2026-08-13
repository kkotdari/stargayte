import { createPortal } from "react-dom";
import ModalHash from "../../utils/modalHash";
import { X, Share } from "lucide-react";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";

// 자동 설치가 안 되는 모든 자리에서 여는 안내 — iOS 사파리(애플이 설치 API를 안 준다),
// 카카오톡·인스타 인앱 브라우저(홈 화면 추가 자체가 없다), 설치 조건이 안 잡힌 안드로이드가
// 다 여기로 온다. 그래서 기기별로 갈라 적는다(지적: 메뉴에서 방법을 못 찾는 사람이 있다).
// 안드로이드 크롬에서 네이티브 설치 창이 뜨는 경우에는 이 모달이 아예 안 열린다.
export default function InstallGuideModal({ onClose }: { onClose: () => void }) {
  useLockBodyScroll(true, onClose);
  return createPortal(
    <div className="scr-modal-overlay" onClick={onClose}>
      <ModalHash hash="install-guide" onClose={onClose} />
      <div className="scr-modal scr-modal-sm scr-install-guide-modal" onClick={(e) => e.stopPropagation()}>
        <div className="scr-modal-head">
          <span>홈 화면에 추가</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>
        <div className="scr-modal-body">
          <p className="scr-install-guide-lead">
            홈 화면에 추가하면 <b>주소창 없이 앱처럼</b> 열려요. 몇 초면 됩니다.
          </p>
          <p className="scr-install-guide-note">
            카카오톡·인스타처럼 앱 안에서 열린 화면에서는 홈 화면 추가가 아예 없습니다.
            먼저 우측 상단 <b>⋯</b> → <b>“다른 브라우저로 열기”</b>(사파리·크롬)를 고른 다음
            아래대로 하세요.
          </p>
          <p className="scr-install-guide-lead"><b>아이폰 (사파리)</b></p>
          <ol className="scr-install-guide-steps">
            <li>
              <span className="scr-install-guide-icon"><Share size={15} /></span>
              화면 아래 가운데의 <b>공유</b> 버튼을 누르세요.
            </li>
            <li>목록을 내려 <b>“홈 화면에 추가”</b>를 고르세요.</li>
            <li><b>“추가”</b>를 누르면 끝!</li>
          </ol>
          <p className="scr-install-guide-lead"><b>안드로이드 (크롬)</b></p>
          <ol className="scr-install-guide-steps">
            <li>화면 우측 상단의 <b>⋮</b> 버튼을 누르세요.</li>
            <li><b>“홈 화면에 추가”</b> 또는 <b>“앱 설치”</b>를 고르세요.</li>
            <li><b>“설치”</b>를 누르면 끝!</li>
          </ol>
        </div>
      </div>
    </div>,
    document.body,
  );
}
