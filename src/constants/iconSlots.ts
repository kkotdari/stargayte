import type { ImageSettingMap } from "../types";

// 운영자가 교체 가능한 이미지 슬롯의 기본값 — 이제 종족 4개뿐(홈 로고 슬롯은 정적
// 자산으로 대체되어 제거). 종족만의 개념이 아닐 수 있어 races.ts가 아니라 여기 따로 둔다.
export const DEFAULT_ICON_SLOTS: ImageSettingMap = {
  "테란": { type: "text", value: "T" },
  "프로토스": { type: "text", value: "P" },
  "저그": { type: "text", value: "Z" },
  "랜덤": { type: "text", value: "R" },
};
