// 회원 → 칭호 한 벌(statEpithet.ts)을 앱 어디서나 같은 값으로 읽기 위한 고리.
//
// 잣대를 한 벌로 못 박는다: 내전(팀전) · 전체 누적 · 모든 종족.
// 기간을 안 따르는 이유(요청: 기준은 전체 누적) — 통계 표의 필터를 따라가게 두면 달을 바꿀
// 때마다 별명이 갈아치워지고, 표에서 본 칭호와 프로필에서 본 칭호가 서로 달라진다. 별명은
// 그 사람을 부르는 말이라 화면마다 다르면 부를 수가 없다.
// 유형을 내전으로 못 박는 이유(요청: 칭호는 내전만 대상으로 집계) — 두 유형이 한 수에 섞여
// 있으면 그 말이 어느 판에서 나온 것인지 알 수가 없고, 무엇보다 칭호가 걸리는 자리가 내전
// 화면 하나뿐이다. 보이는 곳과 세는 곳이 같아야 한다.
//
// 화면은 읽기만 한다(load) — 계산은 경기가 등록·삭제될 때만 돈다(refreshEpithets, 요청:
// 통계 화면 진입 때 재계산 금지). 그 결과는 서버에 남아 있으므로 누가 언제 열어도 같은
// 말이 보이고, 활동에 남은 알림과 어긋날 수가 없다.
// 읽은 값은 한 세션에 한 번만 받는다(아래 cached) — 표는 필터를 만질 때마다 다시 그려지는데
// 칭호는 필터를 안 타는 값이라 그때마다 부를 이유가 없다. 회원 목록이 바뀌면 키가 달라져
// 그때 한 번 다시 받는다.

import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAppStore } from "../store/appStore";
import { epithetsOf, type Epithet } from "./statEpithet";
import type { GameType, MemberStatsEntry } from "../types";

/** 내전 = 팀전. 칭호는 이 유형의 기록으로만 매긴다(요청). */
const CLAN_TYPE: GameType = "0102";

const EMPTY = new Map<string, Epithet>();

let cachedKey = "";
let cached: Map<string, Epithet> | null = null;
let inflightKey = "";
let inflight: Promise<void> | null = null;
let recounting = false;
let recountAgain: string | null = null;

/** 화면이 쓰는 값 — 서버에 저장된 한 벌을 그대로 읽는다(요청: 통계 화면에 들어갈 때는 다시
 *  계산하지 않는다). 계산은 경기가 등록될 때만 돈다(아래 refreshEpithets).
 *
 *  읽기로 바꾼 뒤에 달라지는 것: 화면을 여는 일이 더는 알림을 남기지 않는다. 예전에는 통계를
 *  여는 사람마다 전체 통계를 받아 제 손으로 세고 그 결과를 올렸는데, 그러면 '보기'가 '쓰기'를
 *  겸하게 되고 아무도 통계를 안 열면 칭호도 안 바뀌었다. */
async function load(key: string): Promise<void> {
  const want = new Set(key.split(","));
  try {
    const rows = await api.getEpithets();
    const map = new Map<string, Epithet>();
    rows.forEach((r) => {
      if (want.has(r.memberId) && r.label) map.set(r.memberId, { label: r.label, why: r.why });
    });
    cached = map;
    cachedKey = key;
  } catch {
    // 칭호가 없어도 화면은 그대로다 — 한 줄이 안 붙을 뿐이라 오류를 띄우지 않는다.
    cached = EMPTY;
    cachedKey = key;
  }
}

/** 칭호를 새로 계산해 서버에 올린다 — 경기가 등록·삭제될 때만 부른다.
 *
 *  잣대는 이 파일 머리에 적힌 그대로다(내전·전체 누적·모든 종족). 계산 규칙 자체는
 *  statEpithet.ts에만 있다(서버는 값만 보관한다 — API의 MemberEpithet 주석). */
async function recount(key: string): Promise<number> {
  const ids = key.split(",");
  /* 한 번만 부른다 — 내전(팀전) 전체 누적 한 벌. 예전에는 다섯 벌(전체·개인전·팀전·이번
     달·지난달)을 나란히 받았는데, 그 넷은 전부 유형을 가르거나 레이팅을 견주는 칭호를
     위한 것이었고 그 칭호들이 함께 없어졌다(statEpithet의 삭제 주석). */
  const res = await api.getGameResultStats({
    memberIds: ids, dateFrom: "", dateTo: "", matchType: CLAN_TYPE,
  });
  const byId: Record<string, MemberStatsEntry> = {};
  res.members.forEach((entry) => { byId[entry.memberId] = entry; });
  const map = epithetsOf(ids
    .map((id) => ({
      id,
      stats: byId[id]?.overall,
      // 종족별은 이미 응답에 실려 온다(byRace) — 따로 부를 것이 없다.
      races: byId[id]?.byRace,
    }))
    .flatMap((x) => (x.stats ? [{ id: x.id, stats: x.stats, races: x.races }] : [])));
  /* 올린 값이 곧 다음에 누가 읽을 값이다 — 그래서 여기서 캐시도 같이 갈아 둔다. 달라진
     사람이 있으면 서버가 활동에 알림 한 줄을 남긴다(요청). */
  const changed = await api.reportEpithets(
    [...map].map(([memberId, e]) => ({ memberId, label: e.label, why: e.why })),
  );
  cached = map;
  cachedKey = key;
  return changed;
}

/** 지금 당장 다시 계산한다 — 제어판의 "칭호 다시 계산" 버튼이 쓴다(요청).
 *
 *  계산이 경기 등록 때만 도는 구조라, 칭호 규칙(statEpithet.ts)을 손봐도 다음 경기가 올라오기
 *  전까지는 옛 칭호가 그대로 남는다. 규칙을 고친 사람이 그 자리에서 반영할 길이 필요하다.
 *  여기서는 오류를 삼키지 않는다 — 누가 눌러서 도는 일이라 결과를 알려 줘야 한다. */
export async function recomputeEpithets(memberIds: string[]): Promise<number> {
  const key = memberIds.slice().sort().join(",");
  if (!key) return 0;
  cachedKey = "";
  cached = null;
  return recount(key);
}

/** 칭호를 다시 계산해 서버에 알린다(요청: 경기 등록할 때마다) — 통계 화면을 열 때가 아니라
 *  기록이 바뀐 그 순간에 돌아야, 활동에 뜨는 알림이 "방금 그 경기 때문에 바뀌었다"는 말이 된다.
 *
 *  캐시도 새 값으로 갈린다 — 등록한 사람이 곧바로 통계를 열어도 옛말이 보이지 않게.
 *
 *  실패는 조용히 넘긴다 — 등록은 이미 끝났고 칭호는 곁다리다. 다음 등록이나 다음 통계 조회
 *  때 다시 계산된다. */
export async function refreshEpithets(memberIds: string[]): Promise<void> {
  const key = memberIds.slice().sort().join(",");
  if (!key) return;
  /* 여러 판을 한 번에 올릴 때(리플레이 검토 창은 고른 판을 하나씩 이어 저장한다) 판마다
     한 벌씩 세면 스무 번을 세고 스무 번을 알린다. 도는 중이면 "끝나고 한 번 더"만 예약해
     마지막 상태로 한 번만 더 센다 — 중간값은 어차피 아무도 안 본다. */
  if (recounting) { recountAgain = key; return; }
  recounting = true;
  try {
    let next: string | null = key;
    while (next) {
      const k: string = next;
      recountAgain = null;
      cachedKey = "";
      cached = null;
      inflightKey = k;
      inflight = recount(k).then(() => { /* 알림은 서버가 남긴다 */ });
      // 등록은 이미 끝났다 — 못 셌으면 다음 등록 때 다시 센다.
      await inflight.catch(() => { /* 조용히 넘긴다 */ });
      next = recountAgain;
    }
  } finally {
    recounting = false;
    recountAgain = null;
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
