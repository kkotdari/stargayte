import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import SafeAreaDebug from "./components/dev/SafeAreaDebug";
import { markAppUpdatePreloadError } from "./utils/appUpdate";
import "./styles/global.css";

// 프론트 배포 직후 이미 열려 있던 탭에서 코드 스플리팅된 청크(예: 리플레이 분석기 screp-js)를
// 동적 import하면, 그 청크가 참조하는 예전 빌드 해시 파일이 서버에서 이미 새 빌드로 덮여
// 없어져 있어 로드에 실패한다 — Vite가 이를 감지해 이 이벤트를 쏴 준다. 자동 새로고침은
// 사용자 작업 중 갑자기 화면이 넘어가버려 더 이상하니, 왜 실패했는지 알려주고 새로고침 후
// 직접 다시 시도하게 안내만 한다.
// 리플레이 일괄 등록처럼 같은 청크를 파일 개수만큼 반복해서 동적 import하는 경우, 실패도
// 파일 수만큼 반복돼 이 alert(브라우저 기본 확인 창)가 똑같이 여러 번 떠서 하나하나 눌러야
// 했다 — 페이지 하나당 한 번만 띄우고, preventDefault로 Vite의 기본 처리(에러를 그대로
// 다시 던짐)도 막아 나머지 실패는 조용히 무시한다.
let preloadErrorShown = false;
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  markAppUpdatePreloadError();
  if (preloadErrorShown) return;
  preloadErrorShown = true;
  window.alert("사이트가 새 버전으로 업데이트됐어요. 새로고침한 뒤 다시 시도해 주세요.");
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
    {import.meta.env.DEV && <SafeAreaDebug />}
  </React.StrictMode>,
);
