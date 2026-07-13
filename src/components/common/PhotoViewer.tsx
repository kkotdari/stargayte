import { X } from "lucide-react";

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
  return (
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
    </div>
  );
}
