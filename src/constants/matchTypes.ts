import type { MatchType } from "../types";

export const MATCH_TYPE_INFO: Record<MatchType, string> = {
  "0101": "일대일",
  "0102": "팀전",
};

export const MATCH_TYPE_OPTIONS = Object.keys(MATCH_TYPE_INFO) as MatchType[];
