// 회원 → 칭호 한 벌(statEpithet.ts)을 앱 어디서나 같은 값으로 읽기 위한 고리.
//
// 잣대를 한 벌로 못 박는다: 전체 누적 · 모든 유형 · 모든 종족(요청: 기준은 전체 누적).
// 통계 표의 기간·종족 필터를 따라가게 두면, 달을 바꿀 때마다 별명이 갈아치워지고 표에서
// 본 칭호와 프로필에서 본 칭호가 서로 달라진다 — 별명은 그 사람을 부르는 말이라 화면마다
// 다르면 부를 수가 없다.
//
// 한 세션에 한 번만 부른다(아래 cached) — 통계 표와 프로필 팝업이 각각 부르고, 표는 필터를
// 만질 때마다 다시 그려지는데 그때마다 전체 기간 통계를 새로 받아 올 이유가 없다. 회원
// 목록이 바뀌면(가입·탈퇴) 키가 달라져 그때 한 번 다시 받는다.

import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAppStore } from "../store/appStore";
import { epithetsOf, type Epithet } from "./statEpithet";
import type { MemberStatsEntry } from "../types";

const EMPTY = new Map<string, Epithet>();

let cachedKey = "";
let cached: Map<string, Epithet> | null = null;
let inflightKey = "";
let inflight: Promise<void> | null = null;

async function load(key: string): Promise<void> {
  const ids = key.split(",");
  try {
    const res = await api.getGameResultStats({ memberIds: ids, dateFrom: "", dateTo: "" });
    const byId: Record<string, MemberStatsEntry> = {};
    res.members.forEach((entry) => { byId[entry.memberId] = entry; });
    cached = epithetsOf(ids.map((id) => ({ id, stats: byId[id]?.overall })).filter(
      (x): x is { id: string; stats: NonNullable<typeof x.stats> } => x.stats !== undefined,
    ));
    cachedKey = key;
    /* 계산한 한 벌을 서버에 알린다 — 달라진 사람이 있으면 활동에 알림 한 줄이 남는다(요청).
       여기서 부르는 이유: 칭호가 만들어지는 자리가 여기 하나뿐이라, 다른 데서 부르면
       화면이 보여주는 값과 알림이 갈릴 수 있다. 한 세션에 한 번만 도는 자리이기도 하다.
       실패는 조용히 넘긴다 — 알림은 곁다리고, 못 남겼다고 통계 화면이 멈추면 안 된다. */
    void api.reportEpithets(
      [...cached].map(([memberId, e]) => ({ memberId, label: e.label, why: e.why })),
    ).catch(() => { /* 다음에 누가 통계를 열 때 다시 올라간다 */ });
  } catch {
    // 칭호가 없어도 화면은 그대로다 — 한 줄이 안 붙을 뿐이라 오류를 띄우지 않는다.
    cached = EMPTY;
    cachedKey = key;
  }
}

/** 지금 활동 중인 회원들의 칭호. 아직 안 받았으면 빈 map을 돌려주고, 도착하면 다시 그린다. */
export function useEpithets(): Map<string, Epithet> {
  const members = useAppStore((s) => s.members);
  /* 대상은 활동 중인 회원 전체다 — 검색에 걸린 목록이 아니라(메달과 같은 원칙). 1등이라는
     말이 들어가는 값이라, 이름을 검색했다고 왕관이 옮겨 다니면 그건 기록이 아니다. */
  const key = useMemo(
    () => members
      .filter((m) => m.status !== "withdrawn" && m.status !== "suspended")
      .map((m) => m.id).sort().join(","),
    [members],
  );
  const [map, setMap] = useState<Map<string, Epithet>>(
    () => (cachedKey === key && cached ? cached : EMPTY),
  );

  useEffect(() => {
    if (!key) { setMap(EMPTY); return; }
    if (cachedKey === key && cached) { setMap(cached); return; }
    let cancelled = false;
    if (inflightKey !== key || !inflight) {
      inflightKey = key;
      inflight = load(key);
    }
    inflight.then(() => {
      if (!cancelled && cachedKey === key && cached) setMap(cached);
    });
    return () => { cancelled = true; };
  }, [key]);

  return map;
}
