// 인앱 브라우저(메신저 내장 웹뷰) 감지 — 카카오톡으로 공유한 링크를 열면 카카오톡 자체
// 브라우저(WebView)에서 뜨는데, 이건 평소 쓰는 Chrome/Safari와 저장소가 분리돼 있어 앱
// 로그인(localStorage 토큰)이 유지되지 않는다. 그래서 감지해서 "외부 브라우저로 열기"를
// 안내한다(요청: 로그인 유지 + 외부 브라우저 안내).

export type InAppKind = "kakao" | "naver" | "line" | "instagram" | "facebook" | "other";

export interface InAppInfo {
  isInApp: boolean;
  kind: InAppKind | null;
}

export function detectInAppBrowser(ua: string = navigator.userAgent): InAppInfo {
  const s = ua.toLowerCase();
  if (s.includes("kakaotalk")) return { isInApp: true, kind: "kakao" };
  if (s.includes("naver(inapp") || s.includes("naver ")) return { isInApp: true, kind: "naver" };
  if (/\bline\//.test(s) || s.includes("line/")) return { isInApp: true, kind: "line" };
  if (s.includes("instagram")) return { isInApp: true, kind: "instagram" };
  if (s.includes("fban") || s.includes("fbav")) return { isInApp: true, kind: "facebook" };
  return { isInApp: false, kind: null };
}

// 카카오톡 인앱 브라우저는 이 스킴으로 현재 URL을 기기 기본 브라우저(외부)에서 다시 열 수
// 있다 — 거기선 로그인이 유지된다. 처리 가능하면 true(호출부가 배너를 접는 데 쓴다).
export function openInExternalBrowser(kind: InAppKind | null, url: string = window.location.href): boolean {
  if (kind === "kakao") {
    window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`;
    return true;
  }
  // 그 외 메신저는 표준 스킴이 없어(각자 달라) 수동 안내로만 처리한다.
  return false;
}
