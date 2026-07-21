import { useState } from "react";
import { cx } from "../../utils/format";
import { shareToKakao, type KakaoShareContent } from "../../utils/kakaoShare";

// 카카오톡 말풍선 로고를 최소한으로 그린 인라인 아이콘(외부 아이콘 패키지 없이). 말풍선
// 아래 꼬리가 왼쪽으로 삐친 카카오톡 특유의 모양.
function KakaoIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 3.6c-4.97 0-9 3.13-9 6.99 0 2.48 1.66 4.66 4.16 5.9-.18.63-.66 2.35-.76 2.72-.12.46.17.45.36.33.15-.1 2.4-1.63 3.37-2.29.6.09 1.22.13 1.87.13 4.97 0 9-3.13 9-6.99S16.97 3.6 12 3.6Z"
      />
    </svg>
  );
}

type Variant = "icon" | "menu" | "full";

interface KakaoShareButtonProps {
  // 공유 내용은 누를 때 최신 상태로 만들어야 하는 경우가 있어(예: 랭킹 목록) 함수로도 받는다.
  // 랭킹 차트처럼 미리보기 이미지를 그 순간 캔버스로 그려 업로드까지 마친 뒤에야 내용이
  // 확정되는 경우도 있어(요청: "카톡 미리보기에서 차트가 보이면 좋겠어") 비동기 함수도 받는다.
  content: KakaoShareContent | (() => KakaoShareContent) | (() => Promise<KakaoShareContent>);
  variant?: Variant;
  className?: string;
  // 메뉴 항목/버튼에 보일 글자(기본 "카카오톡 공유"). 아이콘 변형은 무시한다.
  label?: string;
  // 눌린 뒤 메뉴 등을 닫아야 하면(케밥 메뉴) 넘겨준다.
  onDone?: () => void;
}

// 세 자리(랭킹 산정방식 줄 / 경기 케밥 메뉴 / 너 나와 확인창)에서 공통으로 쓰는 카카오
// 공유 버튼. variant로 겉모양만 바꾼다. 폴백으로 링크가 복사되면 잠깐 "복사됨"을 알린다.
export default function KakaoShareButton({
  content, variant = "icon", className, label = "카카오톡 공유", onDone,
}: KakaoShareButtonProps) {
  const [copied, setCopied] = useState(false);
  // 이미지 렌더링+업로드가 끝날 때까지 잠깐 걸릴 수 있어(랭킹 차트), 그동안 버튼을 다시
  // 누르지 못하게 막는다.
  const [busy, setBusy] = useState(false);

  const share = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const c = typeof content === "function" ? await content() : content;
      const outcome = await shareToKakao(c);
      if (outcome === "copied") {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }
    } finally {
      setBusy(false);
      onDone?.();
    }
  };

  if (variant === "icon") {
    return (
      <button
        type="button"
        className={cx("scr-icon-btn scr-kakao-icon-btn", className)}
        onClick={(e) => { e.stopPropagation(); void share(); }}
        aria-label="카카오톡 공유"
        title={copied ? "링크 복사됨" : busy ? "만드는 중..." : "카카오톡 공유"}
        disabled={busy}
      >
        <KakaoIcon size={16} />
      </button>
    );
  }

  if (variant === "menu") {
    return (
      <button
        type="button" role="menuitem"
        className={cx("scr-menu-pop-opt scr-kakao-menu-opt", className)}
        onClick={(e) => { e.stopPropagation(); void share(); }}
        disabled={busy}
      >
        <KakaoIcon size={15} />
        {copied ? "링크 복사됨" : busy ? "만드는 중..." : label}
      </button>
    );
  }

  // full — 확인창의 노란 카카오 버튼.
  return (
    <button
      type="button"
      className={cx("scr-btn scr-kakao-share-btn", className)}
      onClick={(e) => { e.stopPropagation(); void share(); }}
      disabled={busy}
    >
      <KakaoIcon size={16} />
      {copied ? "링크 복사됨" : busy ? "만드는 중..." : label}
    </button>
  );
}
