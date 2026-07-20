// 카카오톡 공유 — Kakao JavaScript SDK를 필요할 때 한 번만 동적으로 싣고, 있으면 카카오
// 네이티브 공유(리치 카드)로, 없거나 실패하면 OS 공유 시트(navigator.share) → 클립보드
// 복사 순으로 폴백한다.
//
// 카카오 네이티브 공유를 쓰려면 .env에 VITE_KAKAO_JS_KEY(카카오 개발자 콘솔의 JavaScript
// 키)를 넣고, 그 앱의 [플랫폼 > Web]에 배포 도메인을 등록해야 한다. 키가 없으면 아래 폴백만
// 동작한다(모바일에선 OS 공유 시트에서 카카오톡을 고를 수 있어 실사용엔 문제 없다).

// 안정 버전으로 고정. 콘솔 콘솔 경고를 피하려 정식 배포 URL을 쓴다.
const KAKAO_SDK_URL = "https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js";

// window.Kakao 타입을 최소한으로만 선언한다(공식 타입 패키지를 새로 들이지 않으려고).
interface KakaoLike {
  isInitialized: () => boolean;
  init: (key: string) => void;
  Share?: {
    sendDefault: (settings: unknown) => void;
  };
}
function kakaoGlobal(): KakaoLike | undefined {
  return (window as unknown as { Kakao?: KakaoLike }).Kakao;
}

function kakaoKey(): string | undefined {
  const k = import.meta.env.VITE_KAKAO_JS_KEY as string | undefined;
  return k && k.length > 0 ? k : undefined;
}

// SDK 로드는 한 번만 시도하고 그 프라미스를 재사용한다 — 키가 없으면 즉시 null(로드 안 함).
let sdkPromise: Promise<KakaoLike | null> | null = null;
function loadKakao(): Promise<KakaoLike | null> {
  if (sdkPromise) return sdkPromise;
  const key = kakaoKey();
  if (!key) {
    sdkPromise = Promise.resolve(null);
    return sdkPromise;
  }
  sdkPromise = new Promise<KakaoLike | null>((resolve) => {
    const ready = () => {
      const K = kakaoGlobal();
      if (!K) return resolve(null);
      try {
        if (!K.isInitialized()) K.init(key);
        resolve(K);
      } catch {
        resolve(null);
      }
    };
    if (kakaoGlobal()) return ready();
    const s = document.createElement("script");
    s.src = KAKAO_SDK_URL;
    s.async = true;
    s.onload = ready;
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return sdkPromise;
}

export interface KakaoShareContent {
  // 카드 제목/설명 — 카카오 네이티브 공유(피드형)에 쓴다.
  title: string;
  description?: string;
  // 카드 썸네일. 카카오가 서버에서 읽어가므로 반드시 공개 접근 가능한 절대 URL이어야 한다.
  imageUrl?: string;
  // 카드를 눌렀을 때 이동할 링크(기본: 현재 사이트).
  link?: string;
  // 폴백(OS 공유 시트/클립보드)에서 쓸 순수 텍스트 — 카드가 아니라 글로 나가므로 핵심
  // 내용을 여기에 담는다.
  fallbackText: string;
}

export type ShareOutcome = "shared" | "copied" | "failed";

// 실제 공유. 카카오 SDK가 준비돼 있으면 카카오 공유창을, 아니면 폴백을 띄운다.
// 반환값으로 호출부가 "복사됨" 같은 안내를 띄울지 정한다.
export async function shareToKakao(content: KakaoShareContent): Promise<ShareOutcome> {
  const link = content.link ?? window.location.origin;
  const Kakao = await loadKakao();
  if (Kakao?.Share) {
    try {
      Kakao.Share.sendDefault({
        objectType: "feed",
        content: {
          title: content.title,
          description: content.description ?? "",
          imageUrl: content.imageUrl ?? `${window.location.origin}/apple-touch-icon.png`,
          link: { mobileWebUrl: link, webUrl: link },
        },
        buttons: [{ title: "앱에서 보기", link: { mobileWebUrl: link, webUrl: link } }],
      });
      return "shared";
    } catch {
      // 카카오 공유가 실패하면(도메인 미등록 등) 아래 폴백으로 넘어간다.
    }
  }
  // 폴백 1: OS 공유 시트(모바일에선 여기서 카카오톡을 고를 수 있다).
  const shareData = { title: content.title, text: content.fallbackText, url: link };
  if (typeof navigator.share === "function") {
    try {
      await navigator.share(shareData);
      return "shared";
    } catch (e) {
      // 사용자가 취소(AbortError)한 경우는 실패가 아니라 그냥 끝낸 것으로 본다.
      if (e instanceof Error && e.name === "AbortError") return "shared";
    }
  }
  // 폴백 2: 클립보드 복사.
  try {
    await navigator.clipboard.writeText(`${content.fallbackText}\n${link}`);
    return "copied";
  } catch {
    return "failed";
  }
}
