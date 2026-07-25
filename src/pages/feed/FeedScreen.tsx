import { Plus } from "lucide-react";

// 피드 — 커뮤니티 활동(경기 결과, 너 나와! 일정)을 시간순으로 한 곳에서 보여주는 홈 화면.
// 맨 위 + 버튼으로 리플레이/너 나와!/일정(추후)을 등록한다.
// (뼈대 단계 — 카드 타임라인과 등록 플로우는 다음 단계에서 채운다.)
export default function FeedScreen() {
  return (
    <div className="scr-screen scr-feed-screen">
      <div className="scr-v2-toolbar">
        <h1 className="scr-title scr-v2-toolbar-title">피드</h1>
      </div>

      <div className="scr-v2-primary-row">
        <button type="button" className="scr-btn scr-btn-primary scr-btn-primary-solid scr-btn-sm" aria-label="등록">
          <Plus size={16} /> 등록
        </button>
      </div>

      <div className="scr-empty">아직 표시할 활동이 없어요.</div>
    </div>
  );
}
