import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { addScrollListener, getScrollTop, smoothScrollRootToTop } from "../../utils/scrollRoot";

const SHOW_AFTER_PX = 400;

// 페이지를 어느 정도 내렸을 때만 나타나는 맨 위로 이동 플로팅 버튼
export default function ScrollTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(getScrollTop() > SHOW_AFTER_PX);
    onScroll();
    return addScrollListener(onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      className="scr-scrolltop"
      // 네이티브 behavior:"smooth"는 iOS에서 관성 스크롤과 겹치면 무시되는 일이 있어
      // 탭바의 액티브 탭 재탭과 같은 rAF 애니메이션으로 통일한다.
      onClick={() => smoothScrollRootToTop()}
      aria-label="맨 위로"
    >
      <ArrowUp size={22} />
    </button>
  );
}
