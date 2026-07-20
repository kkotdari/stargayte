import { useState } from "react";
import { X, ExternalLink } from "lucide-react";
import { detectInAppBrowser, openInExternalBrowser, type InAppInfo } from "../../utils/inAppBrowser";

const DISMISS_KEY = "stargayte_inapp_notice_dismissed";

// 카톡 등 인앱 브라우저에서 열렸을 때 뜨는 안내 — 이 브라우저에선 로그인이 유지되지 않으니
// 기기 기본 브라우저(Chrome/Safari)로 열라고 권한다(요청: 로그인 유지 + 외부 브라우저 안내).
// 카카오톡은 버튼 한 번으로 외부 브라우저에서 다시 열 수 있고, 그 외 메신저는 수동 안내한다.
export default function InAppBrowserNotice() {
  const [info] = useState<InAppInfo>(() => detectInAppBrowser());
  // 세션 동안만 접어둔다(sessionStorage) — 다음에 또 인앱으로 들어오면 다시 안내한다.
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });
  const [hint, setHint] = useState(false);

  if (!info.isInApp || dismissed) return null;

  const close = () => {
    setDismissed(true);
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* 프라이빗 모드 등 무시 */ }
  };

  const openExternal = () => {
    const ok = openInExternalBrowser(info.kind);
    // 카카오톡이 아니면 스킴이 없어 수동 방법을 펼쳐 보여준다.
    if (!ok) setHint(true);
  };

  const label = info.kind === "kakao" ? "카카오톡 브라우저" : "인앱 브라우저";

  return (
    <div className="scr-inapp-notice" role="dialog" aria-label="외부 브라우저로 열기 안내">
      <div className="scr-inapp-notice-main">
        <div className="scr-inapp-notice-text">
          <b>{label}에선 로그인이 유지되지 않아요</b>
          <span>Chrome·Safari로 열면 로그인 상태가 그대로 유지돼요.</span>
        </div>
        <button type="button" className="scr-inapp-notice-cta" onClick={openExternal}>
          <ExternalLink size={14} /> 기본 브라우저로 열기
        </button>
        <button type="button" className="scr-inapp-notice-close" onClick={close} aria-label="닫기">
          <X size={16} />
        </button>
      </div>
      {hint && (
        <div className="scr-inapp-notice-hint">
          오른쪽 위 <b>⋯(더보기)</b> → <b>다른 브라우저로 열기</b>를 눌러주세요.
        </div>
      )}
    </div>
  );
}
