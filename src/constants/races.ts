import type { Race, BaseRace } from "../types";

interface RaceMeta {
  color: string;
}

export const RACE_INFO: Record<Race, RaceMeta> = {
  "테란": { color: "var(--terran)" },
  "프로토스": { color: "var(--protoss)" },
  "저그": { color: "var(--zerg)" },
  "랜덤": { color: "var(--point)" },
};

export const RACE_OPTIONS = Object.keys(RACE_INFO) as Race[];

export const BASE_RACES: BaseRace[] = ["테란", "프로토스", "저그"];
