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

/* 공유 카드 썸네일 — 포스트 종류마다 한 장씩 미리 만들어 둔 그림이다(요청).
   한때 워드마크 원본(logo_black.png)을 그대로 넘겼는데, 그건 6.4:1로 아주 납작해서
   카카오 피드 템플릿의 2:1 그림 자리에 넣으면 좌우가 잘렸다(신고: 로고 좌우가 잘려).
   imageWidth/imageHeight로 비율을 알려 줘도 카카오는 자리를 채우도록 잘라 낸다.
   그래서 처음부터 2:1(1200×600)로 그려 둔 그림을 쓴다 — 위에 로고, 아래에 무슨 글을
   공유한 것인지(요청). 원본은 public/images/share, 만드는 스크립트는 이 커밋 메시지 참고. */
const SHARE_THUMB_W = 1200;
const SHARE_THUMB_H = 600;
const SHARE_THUMBS = {
  /** 너 나와! 호출 — 도전장을 보냈다는 글. */
  challengeCall: "share_thumb_challenge_call.png",
  /** 너 나와! 응답 — 수락/거절했다는 글. */
  challengeReply: "share_thumb_challenge_reply.png",
  /** 게임결과 묶음(같은 자리에서 이어 친 판들). */
  gameResultList: "share_thumb_game_result_list.png",
  /** 게임결과 한 건. */
  gameResult: "share_thumb_game_result.png",
  /** 랭크 변동 알림. */
  rankShift: "share_thumb_rank_shift.png",
} as const;

export type ShareThumbKind = keyof typeof SHARE_THUMBS;

/** 그 종류의 썸네일을 KakaoShareContent에 그대로 펼쳐 넣을 수 있는 꼴로 돌려준다.
 *  URL이 절대경로여야 하는 것은 카카오가 자기 서버에서 이 그림을 읽어가기 때문이다. */
export function shareThumb(kind: ShareThumbKind): {
  imageUrl: string; imageWidth: number; imageHeight: number;
} {
  return {
    imageUrl: `${window.location.origin}/images/share/${SHARE_THUMBS[kind]}`,
    imageWidth: SHARE_THUMB_W,
    imageHeight: SHARE_THUMB_H,
  };
}

export interface KakaoShareContent {
  // 카드 제목/설명 — 카카오 네이티브 공유(활동형)에 쓴다.
  title: string;
  description?: string;
  // 카드 썸네일. 카카오가 서버에서 읽어가므로 반드시 공개 접근 가능한 절대 URL이어야 한다.
  imageUrl?: string;
  // 그 그림의 실제 가로·세로(px) — 카카오가 자리를 잡을 때 쓴다. 워드마크처럼 비율이
  // 심하게 치우친 그림은 이걸 안 주면 가운데만 잘려 나온다.
  imageWidth?: number;
  imageHeight?: number;
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
          ...(content.imageWidth ? { imageWidth: content.imageWidth } : {}),
          ...(content.imageHeight ? { imageHeight: content.imageHeight } : {}),
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
