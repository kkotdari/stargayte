import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 일꾼(Web Worker)도 모듈로 묶는다 — 기본값(iife)은 코드 분할을 못 해서, 리플레이 파서를
  // 쓰는 일꾼(replaySummaryWorker)이 screp-js를 동적 import 하는 순간 빌드가 통째로 실패한다.
  // 모듈 일꾼을 못 쓰는 브라우저는 replaySummaryPool이 알아서 걸러 내고 화면 쪽에서 읽는다.
  worker: { format: "es" },
});
