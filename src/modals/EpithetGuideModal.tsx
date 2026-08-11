import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useLockBodyScroll } from "../utils/bodyScrollLock";

/* 칭호 안내 — 짧은 설명만 적는다(요청: 목록을 리스트화하지 말고 설명만 간단히, 칭호 목록
   제거). 한때 표(TITLES)에서 쉰 줄을 만들어 등급별로 늘어놓았는데, 조건이 자주 바뀌는
   살림이라 목록이 곧 유지보수 대상이 됐고, 무엇보다 쉰 줄은 읽는 화면이 아니라 훑는
   화면이었다. 어떤 칭호가 있는지는 통계 표가 이미 보여준다 — 여기는 "어떻게 받나"만
   말한다. */
export default function EpithetGuideModal({ onClose }: { onClose: () => void }) {
  useLockBodyScroll();

  return createPortal(
    <div className="scr-modal-overlay" onClick={onClose}>
      <div className="scr-modal scr-epithet-guide" onClick={(e) => e.stopPropagation()}>
        <div className="scr-modal-head">
          <span>칭호 안내</span>
          <button className="scr-icon-btn" onClick={onClose} aria-label="닫기"><X size={14} /></button>
        </div>
        <div className="scr-modal-body">
          <ul className="scr-epithet-guide-notes">
            <li>칭호는 내전 전체 기록으로 계산하고, 한 사람에 하나씩 붙어요.</li>
            <li>등급은 전설 › 에픽 › 일반 — 승률처럼 나오기 힘든 기록일수록 위 등급이에요.</li>
            <li>전술은 이긴 판만 세고, 그 종족 판에서 충분히 자주 나와야 인정돼요.</li>
            <li>경기가 등록될 때마다 다시 계산되고, 칭호가 바뀌면 활동에 알림이 남아요.</li>
          </ul>
        </div>
      </div>
    </div>,
    document.body,
  );
}
