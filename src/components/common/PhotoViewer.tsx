import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";

interface PhotoViewerProps {
  src: string;
  alt: string;
  onClose: () => void;
}

// 이미지 클릭 시 확대해서 보여주는 공용 오버레이 — 바깥(배경) 클릭으로는 안 닫히고
// 닫기(X) 버튼으로만 닫는다(다른 곳 실수로 배경을 눌러 바로 닫혀버린다는 피드백 —
// AdminPanelModal과 같은 원칙). position:fixed라 포털 안이든 밖이든 그대로 화면 전체를
// 덮는다. createPortal로 body에 그려도 React 이벤트는 DOM 트리가 아니라 JSX(리액트 트리)
// 구조를 따라 버블링된다 — 이 뷰어를 클릭 가능한 카드(예: RankRow) 안에서 열면, 포털을
// 써도 여기서 발생한 클릭이 그 카드의 onClick까지 계속 올라갈 수 있다(실제로 지적받은
// 문제: 사진 X를 눌러 닫으면 카드가 다시 클릭된 것처럼 상세 모달이 열림) — 이 클릭이
// 더 못 올라가게 여기서 확실히 멈춘다(호출부에서 구조적으로 분리해도 이중 방어로 남긴다).
export default function PhotoViewer({ src, alt, onClose }: PhotoViewerProps) {
  // 딤 오버레이가 사라지면서(iOS 26 크롬 재펼침 회피, global.css 참고) 배경 차단을
  // 잃었다 — 모달들과 같은 입력 실드로 배경 스크롤/클릭을 막는다. 바깥 탭으로는 안
  // 닫는 기존 원칙 유지(onOutside 없음, X로만 닫힘).
  useLockBodyScroll();
  // body 포털 — position:fixed는 조상에 transform/filter/backdrop-filter가 있으면 뷰포트가
  // 아니라 '그 조상'을 기준으로 자리를 잡는다. 통계표(.scr-stat-table)가 유리 재질이라
  // backdrop-filter를 갖고 있어서, 그 안 아바타로 이 뷰어를 열면 화면 중앙이 아니라 표
  // 안쪽 기준으로 뜨고 모바일 유저 칸의 overflow:hidden에 잘렸다(지적: "통계에서 아바타
  // 누르면 사진뷰어 레이아웃 깨짐"). body로 올리면 어느 화면에서 열든 기준이 뷰포트다.
  // (클릭 버블링은 포털과 무관하게 리액트 트리를 따라가므로 아래 stopPropagation은 유지.)
  return createPortal(
    <div className="scr-photo-overlay">
      <div className="scr-photo-frame">
        <button
          type="button" className="scr-icon-btn scr-photo-close"
          onClick={(e) => { e.stopPropagation(); onClose(); }} aria-label="닫기"
        >
          <X size={16} />
        </button>
        <img src={src} alt={alt} className="scr-photo-large" />
      </div>
    </div>,
    document.body,
  );
}
