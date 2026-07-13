import { createContext, useContext } from "react";
import type { ImageSettingMap } from "../types";
import { DEFAULT_ICON_SLOTS } from "../constants/iconSlots";

// 운영자가 설정한 종족 아이콘(+ 홈 로고 등 다른 이미지 슬롯)을 트리 전체에 공급
export const ImageSettingContext = createContext<ImageSettingMap>(DEFAULT_ICON_SLOTS);

export const useImageSettings = (): ImageSettingMap => useContext(ImageSettingContext);
