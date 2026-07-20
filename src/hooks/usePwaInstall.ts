import { useEffect, useState } from "react";

// PWA "홈 화면에 추가" 지원 — 플랫폼마다 가능한 게 다르다.
//   · 안드로이드(크롬 등): beforeinstallprompt 이벤트를 가로채 두면 버튼 한 번으로 네이티브
//     설치 창을 띄울 수 있다(진짜 자동 설치).
//   · iOS 사파리: 애플이 그런 API를 안 줘서 자동 설치가 불가능하다 — "공유 → 홈 화면에 추가"
//     안내(가이드)까지만 가능하다.
//   · 이미 설치돼 standalone으로 실행 중이면 아무것도 보여줄 필요 없다.
// beforeinstallprompt는 앱 로드 극초반에 한 번만 발화하므로, 모듈 로드 시점에 전역으로
// 잡아두고 훅은 그 상태를 구독만 한다(여러 곳에서 같은 deferred 이벤트를 공유).

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // 브라우저 기본 미니 배너를 막고 우리가 시점을 제어한다.
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS 사파리 홈화면 실행 플래그(표준 아님).
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) ||
    // iPadOS 13+는 UA가 Mac으로 나와 터치 지원으로 보조 판별.
    (navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1);
  // 인앱 브라우저(카카오/인스타 등)는 홈화면 추가가 안 되므로 사파리 계열만.
  const inApp = /(KAKAOTALK|Instagram|FBAN|FBAV|Line|NAVER)/i.test(ua);
  return ios && !inApp;
}

export type InstallPlatform = "android" | "ios";

export interface PwaInstall {
  // 설치 안내를 띄울 만한 상태인지(미설치 + 안드로이드 설치가능 or iOS 사파리).
  canInstall: boolean;
  platform: InstallPlatform | null;
  // 안드로이드: 네이티브 설치 창을 띄운다. iOS/불가면 "ios"/false를 돌려줘 호출부가 안내를 연다.
  promptInstall: () => Promise<"installed" | "dismissed" | "ios" | "unavailable">;
}

export function usePwaInstall(): PwaInstall {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);

  const standalone = isStandalone();
  const ios = !standalone && isIosSafari();
  const androidReady = !standalone && deferred !== null;
  const platform: InstallPlatform | null = androidReady ? "android" : ios ? "ios" : null;

  const promptInstall: PwaInstall["promptInstall"] = async () => {
    if (androidReady && deferred) {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      notify();
      return outcome === "accepted" ? "installed" : "dismissed";
    }
    if (ios) return "ios";
    return "unavailable";
  };

  return { canInstall: !standalone && (androidReady || ios), platform, promptInstall };
}
