import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { ReplayMapGrid } from "../utils/replayParser";

// 미니맵 격자를 해시로 받아 오는 곳 — 경기 응답에는 해시만 있고 격자는 여기서 따로 받는다.
//
// 캐시를 모듈에 두는 이유는 두 가지다.
//   ① 같은 맵을 쓰는 경기가 한 화면에 수십 건씩 있다(클럽이 빠른무한 몇 종류를 계속 돈다).
//      경기마다 22KB짜리를 받으면 같은 값을 되풀이해 받는 셈이다.
//   ② 격자는 내용 해시로 찾는 값이라 절대 바뀌지 않는다 — 한 번 받으면 세션 내내 그대로
//      쓸 수 있고, 무효화를 걱정할 필요가 없다.
//
// 값이 undefined면 아직 안 물어본 것, null이면 서버에 없는 것이다. 없는 것도 캐시에
// 못 박아 둔다 — 안 그러면 그 카드가 뜰 때마다 같은 해시를 계속 다시 묻는다(옛 경기는
// 미니맵이 아예 없으므로 흔한 경우다).
const cache = new Map<string, ReplayMapGrid | null>();
// 아직 안 보낸 해시 / 지금 요청 중인 해시. 두 번째가 없으면 요청이 날아가 있는 동안 뜬
// 카드가 같은 해시를 또 큐에 넣는다.
const waiting = new Set<string>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

// 한 번에 물을 수 있는 개수 — 서버도 같은 상한을 둔다(game_results 라우터 참고).
const BATCH_MAX = 32;

function schedule(): void {
  if (timer !== null) return;
  // 0ms 타이머 하나로 같은 프레임에 뜬 카드들의 해시를 한 요청으로 묶는다.
  timer = setTimeout(() => { timer = null; void flush(); }, 0);
}

async function flush(): Promise<void> {
  const hashes = [...waiting].slice(0, BATCH_MAX);
  if (hashes.length === 0) return;
  for (const h of hashes) { waiting.delete(h); inflight.add(h); }
  try {
    const maps = await api.getReplayMaps(hashes);
    const got = new Map(maps.map((m) => [m.hash, m]));
    for (const h of hashes) cache.set(h, got.get(h) ?? null);
  } catch {
    // 실패는 캐시에 남기지 않는다 — 다음에 그 카드가 다시 뜨면 한 번 더 시도한다.
  } finally {
    for (const h of hashes) inflight.delete(h);
  }
  if (waiting.size > 0) schedule();
  for (const l of listeners) l();
}

/** 목록을 부를 때 필요한 격자를 미리 다 받아 둔다 — 댓글과 같은 이유다(ActivityComments의
 *  primeActivityComments 주석): 카드가 뜬 뒤에 격자가 도착하면 미니맵이 그때 생겨나며 카드
 *  키가 자라고, 그만큼 활동의 스크롤 자리가 밀린다. 이미 받아 둔 해시는 건너뛴다. */
export async function primeReplayMaps(hashes: (string | null | undefined)[]): Promise<void> {
  const need = [...new Set(hashes.filter((h): h is string => !!h && !cache.has(h)))];
  for (let i = 0; i < need.length; i += BATCH_MAX) {
    const chunk = need.slice(i, i + BATCH_MAX);
    try {
      const maps = await api.getReplayMaps(chunk);
      const got = new Map(maps.map((m) => [m.hash, m]));
      for (const h of chunk) cache.set(h, got.get(h) ?? null);
    } catch {
      // 실패는 캐시에 안 남긴다 — 그 카드가 뜰 때 위 훅이 한 번 더 시도한다.
    }
  }
  for (const l of listeners) l();
}

/** 맵연결 직후(요청: 게임 상세의 맵연결 버튼) — 서버가 돌려준 새 격자(그림 포함)를
 *  캐시에 바로 심어, 그 해시를 쓰는 모든 카드가 즉시 새 그림으로 갈아탄다. */
export function applyReplayMap(grid: ReplayMapGrid): void {
  cache.set(grid.hash, grid);
  for (const l of listeners) l();
}

/* ── 원본 그림 승급 ──────────────────────────────────────────────────────────────
   서버가 목록에 싣는 미니맵 그림은 512px 작은 판이다(활동 목록은 한 화면에 그 페이지의
   맵 종류만큼 이 응답을 받으므로 2048px을 전부 나를 수 없다). 재생 화면이 실제로 크게
   그릴 때만 그 한 장을 ?full=1로 다시 받아 캐시를 갈아 끼운다.

   해시마다 딱 한 번만 조른다. 이게 없으면 무한 루프가 된다 — 승급이 캐시에 새 객체를
   심고, 그걸 보는 컴포넌트가 리렌더되고, 승급을 부르는 effect의 deps가 그 객체를 물고
   있으면 다시 돌기 때문이다. 서버가 옛 판이라 full을 몰라도(같은 그림이 돌아와도)
   promoted에 남으므로 두 번은 안 묻는다. */
const promoted = new Set<string>();

/** 그 해시의 그림을 원본으로 갈아 끼운다 — 이미 졸랐거나 그림이 없는 맵이면 아무것도 안 한다. */
export async function promoteReplayMap(hash: string | null | undefined): Promise<void> {
  if (!hash || promoted.has(hash)) return;
  const cur = cache.get(hash);
  // 그림이 안 붙은 맵(격자로 그리는 맵)은 승급할 것이 없다.
  if (!cur || !cur.image) return;
  promoted.add(hash);
  try {
    const maps = await api.getReplayMaps([hash], true);
    const got = maps.find((m) => m.hash === hash);
    if (!got || !got.image || got.image === cur.image) return;
    cache.set(hash, got);
    for (const l of listeners) l();
  } catch {
    // 실패하면 작은 판 그대로 둔다 — 화질만 아쉬울 뿐 화면은 멀쩡하다.
  }
}

/** 그 해시의 맵 격자 — 서버에 없으면 null, '아직 조회 중'이면 undefined.
 *  (구분 이유·지적: 조회 중을 null로 뭉개면 카드가 첫 그림에 옛 로스터 폼을 그렸다가
 *  격자가 도착하면 재생 화면으로 갈아타며 로스터가 깜빡하고 사라져 보였다.) */
export function useReplayMap(hash: string | null | undefined): ReplayMapGrid | null | undefined {
  const [, bump] = useState(0);
  useEffect(() => {
    const listen = () => bump((n) => n + 1);
    listeners.add(listen);
    return () => { listeners.delete(listen); };
  }, []);
  useEffect(() => {
    if (!hash || cache.has(hash) || inflight.has(hash)) return;
    waiting.add(hash);
    schedule();
  }, [hash]);
  if (!hash) return null;
  return cache.has(hash) ? cache.get(hash) ?? null : undefined;
}
