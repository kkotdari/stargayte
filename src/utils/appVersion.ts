import type { AppVersion } from "../types";

// "v3" -> 3. 파싱 실패(형식이 깨진 값이 서버에서 온 극단적인 경우) 시 가장 낮은 버전(1)으로
// 취급한다 — 새 메뉴/화면을 실수로 노출하는 쪽보다 예전 화면으로 안전하게 fallback하는 쪽이 낫다.
export function versionNumber(version: AppVersion): number {
  const n = Number(version.slice(1));
  return Number.isInteger(n) && n >= 1 ? n : 1;
}
