import { useState } from "react";
import { X, Download } from "lucide-react";
import { usePwaInstall } from "../../hooks/usePwaInstall";
import InstallGuideModal from "./InstallGuideModal";

const DISMISS_KEY = "stargayte_install_dismissed";

// 첫 방문(미설치) 때 한 번 살짝 띄우는 설치 유도 배너 — 닫으면 localStorage에 기록해 다시 안
// 뜬다. 안드로이드는 버튼이 네이티브 설치 창을, iOS는 안내 모달을 연다. 서랍 메뉴의 "홈 화면에
// 추가"는 이 배너를 닫은 뒤에도 언제든 다시 설치할 수 있는 상시 통로다.
export default function InstallBanner() {
  const { canInstall, platform, promptInstall } = usePwaInstall();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === "1");
  const [guideOpen, setGuideOpen] = useState(false);

  const close = () => {
    setDismissed(true);
    localStorage.setItem(DISMISS_KEY, "1");
  };

  const onInstall = async () => {
    const r = await promptInstall();
    if (r === "ios") setGuideOpen(true);
    else if (r === "installed" || r === "dismissed") close();
  };

  if (guideOpen) {
    // 안내를 열면 배너 자체는 닫힌 것으로 친다(다시 안 뜸).
    return <InstallGuideModal onClose={() => { setGuideOpen(false); close(); }} />;
  }
  if (!canInstall || dismissed) return null;

  return (
    <div className="scr-install-banner" role="dialog" aria-label="홈 화면에 추가">
      <div className="scr-install-banner-text">
        <b>주소창 없이 앱처럼</b>
        <span>홈 화면에 추가하면 화면이 넓어져요{platform === "ios" ? " (방법 안내)" : ""}.</span>
      </div>
      <button type="button" className="scr-install-banner-cta" onClick={onInstall}>
        <Download size={14} /> 추가
      </button>
      <button type="button" className="scr-install-banner-close" onClick={close} aria-label="닫기">
        <X size={16} />
      </button>
    </div>
  );
}
