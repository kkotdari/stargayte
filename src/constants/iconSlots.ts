import type { ImageSettingMap } from "../types";

// 운영자가 교체 가능한 이미지 슬롯의 기본값 — 종족 4개 + 종족이 아닌 슬롯(홈 로고 등).
// 종족만의 개념이 아니라서 races.ts가 아니라 여기 따로 둔다.
export const DEFAULT_ICON_SLOTS: ImageSettingMap = {
  "테란": { type: "text", value: "T" },
  "프로토스": { type: "text", value: "P" },
  "저그": { type: "text", value: "Z" },
  "랜덤": { type: "text", value: "R" },
  "home_logo": { type: "text", value: "스타게이트" },
  "home_logo_light": { type: "text", value: "스타게이트" },
};
