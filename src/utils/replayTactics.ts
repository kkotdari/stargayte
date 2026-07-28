import type { BuildPos, ParsedReplayPlayer, ReplayPlayerSignals } from "./replayParser";

// 리플레이 커맨드 스트림에서 '전술'을 짚어낸다(요청: 9드론 저글링 러시 / 투게이트 질럿 /
// 초반 포토러시 / 몰래 배럭 / 목동 저그 / 바이오닉 / 발키리 오버로드 사냥 / 아비터 리콜 /
// 성큰·벙커·포토 방어 / 드랍 플레이 / 센터 장악 …).
//
// 조합 이름("히드라와 뮤탈")만으로는 경기가 다 비슷하게 읽히는데, 전술은 그 경기에서만
// 일어난 일이라 문장이 확 살아난다. 대신 조건이 빡빡해야 한다 — 아무 경기에나 "저글링
// 러시"가 붙으면 전술 이름이 아니라 소음이 된다. 그래서 대부분 "무엇을 얼마나 + 언제"
// 두 가지를 함께 본다.
//
// 한계는 요약 전체와 같다. 커맨드는 '명령'이지 '완성'이 아니고(취소한 생산도 세진다),
// 저그 라바 다중 변태는 커맨드 하나로 잡힌다. 그래서 문장은 결과를 단정하지 않고
// "무엇을 시도했나"까지만 말한다.

const SECONDS_PER_FRAME = 0.042;

// 성큰러시로 볼 시간 창 — 이보다 늦게 본진 밖에 박는 성큰은 러시가 아니라 조이기·확장
// 방어에 가깝다.
const SUNKEN_RUSH_SEC = 7 * 60;

/** 짚어낸 전술 하나. 문구는 여기 없다 — 저장은 키와 재료로만 하고(replaySummaryData.ts의
 *  이유 참고) 문장은 replaySummaryText.ts가 만든다. */
export interface Tactic {
  /** 같은 전술이 여러 사람에게서 나와도 한 번만 말하기 위한 키 = 문장 틀 키. */
  key: string;
  /** 이야깃거리로서의 무게 — 큰 것부터 말한다. */
  weight: number;
  /** 그 전술이 드러난 프레임 — 요약을 시간순으로 늘어놓을 때 쓴다. 못 잡으면 null. */
  at: number | null;
  /** 이 전술을 쓴 사람의 리플레이 원본 게임 아이디. */
  who: string;
  /** 당한 쪽 — "9시 조조에게 3게이트 질럿러시"처럼 대상이 있는 전술만(요청). */
  whom?: string;
  /** 덕을 본 아군 — 옆탱처럼 '누구 기지에서 했나'가 곧 전술의 뜻인 경우만. */
  who2?: string;
  /** 문장 틀에 꽂히는 값(드론 수·게이트 수 등). 없으면 생략. */
  p?: Record<string, string | number | boolean>;
}






/** 건물을 지은 자리가 내 본진인지, 아군 본진인지, 가운데인지, 상대 쪽인지.
 *  아군 본진을 내 본진과 갈라 두는 이유는 둘이 정반대 뜻이기 때문이다 — 성큰러시는
 *  아군 기지를 빼야 하고(지적: 다른 저그의 크립 콜로니 위에도 짓는다), 옆탱은 아군
 *  기지여야만 옆탱이다. */
type Zone = "home" | "ally" | "mid" | "enemy";

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 점들의 메도이드(다른 점들까지의 거리 합이 가장 작은 점) = 그 사람의 본진.
 *  평균이 아니라 메도이드를 쓰는 이유는, 몰래 배럭·앞마당 포토처럼 멀리 나간 건물 한두
 *  채가 평균을 통째로 끌고 가버리기 때문이다. 건물 대부분은 본진에 몰려 있으므로
 *  메도이드는 그 덩어리 안에 남는다. */
function medoid(pts: { x: number; y: number }[]): { x: number; y: number } | null {
  if (pts.length === 0) return null;
  let best = pts[0];
  let bestSum = Infinity;
  for (const a of pts) {
    let sum = 0;
    for (const b of pts) sum += dist(a, b);
    if (sum < bestSum) { bestSum = sum; best = a; }
  }
  return best;
}

/** 그 사람 건물들이 본진에서 흩어진 정도(중앙값) = 그 기지의 크기. 지도 단위를 몰라도
 *  되도록 절대값이 아니라 그 사람 자신의 건물 분포로 잰다. */
function spreadOf(p: ParsedReplayPlayer): number | null {
  const pts = p.signals?.buildPositions ?? [];
  const h = homeOf(p);
  if (!h || pts.length < MIN_BUILDINGS_FOR_HOME) return null;
  const ds = pts.map((b) => dist(b, h)).sort((a, b) => a - b);
  return ds[Math.floor(ds.length / 2)];
}

// 본진을 믿고 쓰려면 건물이 이만큼은 있어야 한다 — 두 채뿐이면 어느 쪽이 본진인지 모른다.
const MIN_BUILDINGS_FOR_HOME = 4;
// 내 본진 ↔ 가장 가까운 상대 본진 거리를 1로 뒀을 때의 경계.
const HOME_RADIUS = 0.33;
const ENEMY_RADIUS = 0.35;
// 본진 중심에서 이만큼은 나가 있어야 '앞'이다 — 안쪽에 박은 건 그냥 본진 건물이다.
const FRONT_MIN = 0.1;
// 상대 쪽으로 60도 안쪽(cos 0.5)이어야 진출로 쪽이라고 본다.
const FRONT_COS = 0.5;
// 몰래 배럭에 딸려 나오면 그 자체가 러시의 증거가 되는 파이어뱃 수 — 방어용으로는 이만큼
// 뽑지 않는다.
const FIREBAT_RUSH_MIN = 6;
// '대규모 뮤탈'로 볼 수 — 한 부대 12기 기준 세 부대(지적: 3~4부대).
const MUTA_MASS_MIN = 36;

// 성큰러시·포토러시·몰래 배럭은 '자리를 보고서야 알 수 있는' 기습이라, 그 경기에서만
// 있었던 일 중에서도 특히 이야깃거리다(요청: 무게감을 올려 달라). 자리가 모자랄 때
// 일반적인 사실보다 먼저 남도록 무게를 따로 잡아 둔다.
const SNEAK_WEIGHT = 16;

// '패스트 OO' — 이 시각보다 이르게 첫 기가 나오면 빠른 것이다(요청). 초 단위.
const FAST_UNITS: [string, number][] = [
  ["Dark Templar", 8 * 60], ["Reaver", 9 * 60], ["Lurker", 7 * 60],
  ["Dragoon", 5 * 60], ["Vulture", 4 * 60], ["Mutalisk", 7 * 60],
];
// 한 기만 뽑고 만 것은 '전략'이 아니라 사고다 — 최소한 이만큼은 이어 뽑아야 한다.
const FAST_MIN_UNITS = 3;
// '파워 OO' — 이만큼 뽑고, 그게 병력의 이 비율을 넘으면 그 유닛 하나로 간 것이다(요청).
const POWER_UNITS: [string, number][] = [
  ["Dragoon", 30], ["Hydralisk", 40], ["Zealot", 40], ["Marine", 50],
  ["Vulture", 30], ["Zergling", 60],
];
const POWER_SHARE = 0.6;
// 클로킹 레이스 — 이만큼은 띄워야 '레이스 전략'이다.
const WRAITH_MIN = 4;
// 이레디에이트 — 베슬 한 기는 지나가다 뽑은 것일 수 있다.
const VESSEL_MIN = 2;
// 일꾼은 종족을 그대로 드러낸다 — 제 종족이 아닌 일꾼을 뽑았다면 뺏어 온 것이다(요청).
const WORKER_OF = new Map<string, string>([
  ["Probe", "프로토스"], ["Drone", "저그"], ["SCV", "테란"],
]);
// 한두 기는 오차일 수 있다 — 실제로 그 종족을 굴렸다고 하려면 이만큼은 뽑아야 한다.
const MIND_WORKER_MIN = 3;
// '한 종류만 뽑았나'를 셀 때 제외할 것들 — 일꾼·보급·소모품은 조합이 아니다.
const SOLO_EXCLUDE = new Set([
  "SCV", "Probe", "Drone", "Overlord", "Larva", "Egg",
  "Interceptor", "Scarab", "Spider Mine", "Scanner Sweep",
]);
// 셋방살이는 '나중에 들어온 쪽'이다 — 집주인보다 이만큼은 늦게 그 자리에 지었어야 한다.
// 이 조건이 없으면 같은 자리를 공유한 두 아군이 서로를 셋방살이로 지목한다.
const LODGING_LATE_SEC = 3 * 60;

/** 이 사람의 건물 좌표를 구역으로 바꿔 주는 함수. 좌표를 못 읽었거나(screp이 Pos를 안 줌)
 *  본진을 못 정하면 null — 자리 기반 전술(몰래 배럭·센터 포토)은 그냥 안 나온다. */
function homeOf(p: ParsedReplayPlayer): { x: number; y: number } | null {
  const pts = p.signals?.buildPositions ?? [];
  return pts.length >= MIN_BUILDINGS_FOR_HOME ? medoid(pts) : null;
}

/** 자리로 알 수 있는 것들을 한 벌로 묶은 것. 좌표를 못 읽었거나 본진을 못 정하면 통째로
 *  null이고, 자리 기반 전술은 그냥 안 나온다(요청: 불확실한 건 빼기). */
interface Geo {
  zone: (b: BuildPos) => Zone;
  /** 이 자리가 어느 아군의 본진인가 — 옆탱처럼 '누구를 도왔나'를 말해야 하는 경우. */
  allyAt: (b: BuildPos) => string | null;
  /** 이 자리가 어느 상대의 진영인가 — 성큰러시·포토러시처럼 '누구한테 갔나'가 곧
   *  전술의 내용인 경우. 팀전에서도 자리로는 확실히 짚힌다(요청). */
  enemyAt: (b: BuildPos) => string | null;
  /** 내 본진 안이면서 상대 쪽으로 나가 있는 자리인가 = 진출로(입구) 쪽. */
  front: (b: BuildPos) => boolean;
  /** 내 살림이 아군 기지에 얹혀 있으면 그 아군(지적: 내 기지에 건물이 거의 없고 아군
   *  기지에 있는 게 셋방살이다). 아니면 null. */
  lodgingHost: string | null;
  /** 그중에서도 '시작 자리를 두고 옮겨온' 경우 — 본진을 잃은 그림이라 문장이 달라진다. */
  lodgingLost: boolean;
}

function geoOf(
  me: ParsedReplayPlayer,
  allies: ParsedReplayPlayer[],
  foes: ParsedReplayPlayer[]
): Geo | null {
  const home = homeOf(me);
  if (!home) return null;
  const foeHomes = foes.map(homeOf).filter((h): h is { x: number; y: number } => h !== null);
  if (foeHomes.length === 0) return null;
  const allyHomes = allies
    .map((a) => ({ raw: a.rawName, h: homeOf(a) }))
    .filter((a): a is { raw: string; h: { x: number; y: number } } => a.h !== null);
  // 기준 거리는 '가장 가까운 상대까지' — 팀전에서 멀리 있는 상대까지 재면 구역이 다 뭉개진다.
  const base = Math.min(...foeHomes.map((h) => dist(home, h)));
  if (!(base > 0)) return null;
  // 앞쪽을 재는 기준 방향 = 가장 가까운 상대 본진 쪽.
  const near = foeHomes.reduce((a, b) => (dist(home, b) < dist(home, a) ? b : a));
  const dir = { x: (near.x - home.x) / base, y: (near.y - home.y) / base };

  const foeHomeOf = foes
    .map((f) => ({ raw: f.rawName, h: homeOf(f) }))
    .filter((f): f is { raw: string; h: { x: number; y: number } } => f.h !== null);

  const enemyAt = (b: BuildPos): string | null => {
    let best: { raw: string; d: number } | null = null;
    for (const f of foeHomeOf) {
      const d = dist(b, f.h);
      if (d < base * ENEMY_RADIUS && (!best || d < best.d)) best = { raw: f.raw, d };
    }
    return best?.raw ?? null;
  };

  const allyAt = (b: BuildPos): string | null => {
    let best: { raw: string; d: number } | null = null;
    for (const a of allyHomes) {
      const d = dist(b, a.h);
      if (d < base * HOME_RADIUS && (!best || d < best.d)) best = { raw: a.raw, d };
    }
    return best?.raw ?? null;
  };

  const zone = (b: BuildPos): Zone => {
    const toFoe = Math.min(...foeHomes.map((h) => dist(b, h)));
    if (toFoe < base * ENEMY_RADIUS) return "enemy";
    if (dist(b, home) < base * HOME_RADIUS) return "home";
    // 아군 본진도 '남의 기지가 아닌 곳'이다(지적: 다른 저그의 크립 콜로니 위에도 짓는다).
    // 내 본진과 갈라 두어야 성큰러시에서 빼고 옆탱에서만 쓸 수 있다.
    if (allyAt(b) !== null) return "ally";
    return "mid";
  };

  // 리플레이에는 지형이 없다 — 램프가 어디인지는 알 방법이 없다. 대신 확실한 건
  // 방향이다: 내 본진 안이되 상대 쪽으로 나가 있는 자리는 진출로 쪽이다. 뒤나 옆에
  // 박은 건물은 걸리지 않는다.
  const front = (b: BuildPos): boolean => {
    const v = { x: b.x - home.x, y: b.y - home.y };
    const len = Math.hypot(v.x, v.y);
    if (len < base * FRONT_MIN) return false;      // 본진 한복판이면 앞이 아니다
    if (len > base * HOME_RADIUS) return false;    // 너무 멀면 그건 본진 밖이다
    return (v.x * dir.x + v.y * dir.y) / len > FRONT_COS;
  };

  // 셋방살이 — 두 갈래로 잡는다(요청: 이 이야기가 더 자주 나왔으면).
  //   ① 내 건물 덩어리 자체가 아군 기지 안에 앉아 있다(메도이드가 거기 있다).
  //   ② 시작 자리는 따로 있었는데, 나중에 아군 기지로 살림을 옮겼다 — 본진을 잃은 그림이다.
  // ②가 실제로 훨씬 흔하다. ①만 보면 원래 자리에 건물이 많이 남은 경우를 놓친다.
  const lodging = (() => {
    const myPts = me.signals?.buildPositions ?? [];
    /** 그 자리 근처에 이 사람이 처음 지은 시각 — 누가 집주인인지 가른다. */
    const firstNear = (p: ParsedReplayPlayer, at: { x: number; y: number }, r: number) => {
      const fs = (p.signals?.buildPositions ?? [])
        .filter((b) => dist(b, at) <= r && b.frame !== null)
        .map((b) => b.frame as number);
      return fs.length > 0 ? Math.min(...fs) : null;
    };
    // 시작 자리 = 가장 이른 건물 몇 채의 메도이드. 지금의 본진(메도이드)과 다를 수 있다.
    const early = [...myPts].sort((a, b) => (a.frame ?? 0) - (b.frame ?? 0)).slice(0, 5);
    const start = medoid(early) ?? home;
    const mySpread = spreadOf(me) ?? 0;

    let best: { raw: string; lost: boolean; d: number } | null = null;
    for (const a of allies) {
      const h = homeOf(a);
      const spread = spreadOf(a);
      if (!h || spread === null || !(spread > 0)) continue;
      if (dist(home, h) >= base * HOME_RADIUS) continue; // 아예 딴 동네면 볼 것 없다
      // 늦게 들어온 쪽이 셋방이다. 집주인은 처음부터 거기 있었다.
      const mine = firstNear(me, h, spread);
      const theirs = firstNear(a, h, spread);
      if (mine === null || theirs === null || sec(mine - theirs) < LODGING_LATE_SEC) continue;

      const inside = dist(home, h) <= spread;
      // ② 시작 자리는 딴 곳이었는데 그 뒤로 여기에 세 채 넘게 지었고, 원래 자리에는
      //    거의 돌아가지 않았다 — 옮겨온 것이다.
      const mineThere = myPts.filter((b) => dist(b, h) <= spread);
      const backHome = myPts.filter(
        (b) => (b.frame ?? 0) > mine && mySpread > 0 && dist(b, start) <= mySpread
      );
      const moved = dist(start, h) > spread && mineThere.length >= 3 && backHome.length <= 1;
      if (!inside && !moved) continue;
      const d = dist(home, h);
      if (!best || d < best.d) best = { raw: a.rawName, lost: moved, d };
    }
    return best;
  })();
  const lodgingHost = lodging?.raw ?? null;
  const lodgingLost = lodging?.lost ?? false;

  return { zone, allyAt, enemyAt, front, lodgingHost, lodgingLost };
}

interface Ctx {
  /** 리플레이 원본 게임 아이디 — 문장에 쓸 이름은 볼 때 다시 푼다. */
  rawName: string;
  s: ReplayPlayerSignals;
  race: string;
  foeRaces: string[];
  /** 이 사람이 지은 건물의 자리로 알 수 있는 것들. 좌표를 못 읽으면 null. */
  geo: Geo | null;
  /** 1:1이면 상대 한 사람 — 팀전은 누가 당했는지 커맨드만으로 알 수 없어 null이다.
   *  당한 쪽을 말할 땐 반드시 한 쪽도 함께 말한다(요청). */
  soleFoe: string | null;
  /** 팀전에서 '내 옆에 붙은' 상대 — 나머지 상대보다 뚜렷하게 가까운 한 사람이 먼저
   *  나가떨어졌을 때만 값이 있다. 탱크 방어의 근거다. */
  neighbor: { raw: string; fellAt: number } | null;
}

const sec = (frame: number) => frame * SECONDS_PER_FRAME;


function detectFor(c: Ctx): Tactic[] {
  const { rawName, s, race, foeRaces, soleFoe, geo, neighbor } = c;
  const out: Tactic[] = [];
  const u = (n: string) => s.unitCounts[n] ?? 0;
  const firstU = (n: string): number | null => s.firstUnitFrame[n] ?? null;
  const firstB = (n: string): number | null => s.firstBuildingFrame[n] ?? null;
  const hasTech = (n: string) => s.techNames.includes(n);
  const tanks = u("Siege Tank (Tank Mode)") + u("Siege Tank (Siege Mode)");
  const who = rawName;
  // 당한 쪽 — 1:1에서만 확실하다. 못 짚으면 그 부분만 빠지고 문장은 그대로 나온다.
  const target = soleFoe ? { whom: soleFoe } : {};
  // 한 종류만 주야장천 뽑았나 — 그러면 이겼더라도 '무지성'이라 부를 수 있다(지적).
  const army = Object.entries(s.unitCounts).filter(([u]) => !SOLO_EXCLUDE.has(u));
  const armyTotal = army.reduce((acc, [, n]) => acc + n, 0);
  const topArmy = army.map(([, n]) => n).sort((a, b) => b - a)[0] ?? 0;
  const solo = armyTotal >= 12 && topArmy / armyTotal >= 0.8;
  /** 드랍은 수송선을 뽑은 것만으로는 알 수 없다 — 실제로 내린 커맨드가 있어야 드랍이다. */
  const dropped = s.unloadCount >= 2;
  /** 그 구역에 지은 건물들(좌표를 못 읽으면 항상 빈 배열). */
  const inZone = (z: Zone, unit?: string, beforeSec?: number): BuildPos[] => {
    if (!geo) return [];
    return s.buildPositions.filter(
      (p) =>
        (unit === undefined || p.unit === unit) &&
        (beforeSec === undefined || (p.frame !== null && sec(p.frame) < beforeSec)) &&
        geo.zone(p) === z
    );
  };
  /** 내 본진 앞(진출로 쪽)에 세운 것들 — 지형이 없으니 '상대 쪽으로 나가 있나'로 본다. */
  const atFront = (unit: string): BuildPos[] =>
    geo ? inZone("home", unit).filter(geo.front) : [];
  /** 그 건물들이 들어선 진영의 주인 — 팀전에서도 '누구한테 갔나'를 자리로 짚는다(요청).
   *  가운데에 박은 것뿐이면 주인이 없어 null이고, 그때는 1:1일 때만 상대를 말한다. */
  const foeAt = (b: BuildPos[]): { whom: string } | typeof target => {
    if (geo) {
      for (const x of b) {
        const f = geo.enemyAt(x);
        if (f) return { whom: f };
      }
    }
    return target;
  };
  /** 건물 묶음에서 가장 이른 프레임 — 그 전술이 드러난 시점. */
  const firstOf = (b: BuildPos[]): number | null => {
    const f = b.map((x) => x.frame).filter((x): x is number => x !== null);
    return f.length > 0 ? Math.min(...f) : null;
  };

  // ── 종족을 가리지 않는 것들 ──
  // '패스트 OO' — 그 유닛이 나오는 보통 타이밍보다 확실히 이르면 그 자체가 전략이다(요청).
  for (const [unit, bySec] of FAST_UNITS) {
    const f = firstU(unit);
    if (f !== null && sec(f) <= bySec && u(unit) >= FAST_MIN_UNITS) {
      out.push({ key: "fast-tech", ...target, weight: 12, at: f, who, p: { unit, min: Math.max(1, Math.round(sec(f) / 60)) } });
      break; // 하나만 — 여러 개를 다 말하면 '빠른 무엇'이 흐려진다
    }
  }
  // 마인드 컨트롤(다크 아콘)로 아군의 일꾼을 뺏어 그 종족 건물까지 올리는 전략(요청) —
  // 제 종족이 아닌 일꾼을 뽑았다는 것이 그 증거다. 다른 방법으로는 나올 수 없는 커맨드다.
  const foreign = ([...WORKER_OF] as [string, string][])
    .filter(([w, r]) => r !== race && u(w) >= MIND_WORKER_MIN)
    .map(([, r]) => r);
  if (foreign.length > 0) {
    out.push({
      key: "mind-control", weight: 16,
      at: firstU([...WORKER_OF].find(([, r]) => r === foreign[0])?.[0] ?? "") ?? null,
      who, p: { race: foreign[0] },
    });
  }
  // '파워 OO' — 한 유닛을 압도적으로 뽑아 그 물량으로 밀어붙이는 그림(요청).
  for (const [unit, min] of POWER_UNITS) {
    if (u(unit) >= min && armyTotal > 0 && u(unit) / armyTotal >= POWER_SHARE) {
      // 시점을 두지 않는다 — 경기 내내의 총량 이야기라 첫 기가 나온 때에 놓으면 앞으로
      // 당겨져 '초반에 파워 질럿'처럼 읽힌다(지적). 시점 없는 문장은 맺음말 앞에 붙는다.
      out.push({ key: "power-unit", weight: 11, at: null, who, p: { unit, n: u(unit) } });
      break;
    }
  }

  // ── 저그 ──
  if (race === "저그") {
    // N드론 저글링 러시 — 스포닝풀을 짓기 전에 드론을 몇 기 뽑았나가 곧 빌드 이름이다
    // (시작 드론 4기 + 그때까지 뽑은 수). 풀도 저글링도 충분히 일러야 '러시'다.
    const pool = firstB("Spawning Pool");
    const ling = firstU("Zergling");
    if (pool !== null && ling !== null && sec(pool) < 210 && sec(ling) < 300) {
      const drones = 4 + (s.unitFrames["Drone"] ?? []).filter((f) => f < pool).length;
      if (drones >= 7 && drones <= 14) {
        out.push({
          key: "zling-rush", ...target, weight: 12, at: ling,
          who, p: { drones, solo },
        });
      }
    }
    // 목동 저그 — 저글링·울트라에 다크스웜(또는 디파일러)까지 얹은 그림.
    const swarm = hasTech("Dark Swarm") || u("Defiler") >= 2;
    if (u("Zergling") >= 12 && u("Ultralisk") >= 3 && swarm) {
      out.push({
        key: "moka", weight: 11, at: firstU("Ultralisk"),
        who,
      });
    } else if (hasTech("Dark Swarm")) {
      out.push({
        key: "swarm", weight: 6, at: s.firstTechFrame["Dark Swarm"] ?? null,
        who,
      });
    }
    if (u("Devourer") >= 3 && u("Mutalisk") >= 6) {
      out.push({
        key: "devourer", weight: 9, at: firstU("Devourer"),
        who,
      });
    }
    // 러커/히드라 드랍(요청) — 저그는 오버로드에 태워야 하므로 수송 업그레이드가 곧 신호다.
    if (dropped && s.upgradeNames.includes("Ventral Sacs") && (u("Lurker") >= 3 || u("Hydralisk") >= 8)) {
      out.push({
        key: "zerg-drop", ...target, weight: 11,
        at: s.firstUnloadFrame,
        who, p: { lurker: u("Lurker") >= 3 },
      });
    }
    // 커널(나이더스 커널) — 뚫어 놓으면 병력이 순식간에 건너간다(요청). 건물 건설 커맨드
    // 하나로 확실히 잡히고, 애초에 자주 나오지 않아 나오면 그 자체가 이야깃거리다.
    const nydus = s.buildingCounts["Nydus Canal"] ?? 0;
    if (nydus >= 1) {
      out.push({
        key: "nydus", ...target, weight: 12,
        at: s.firstBuildingFrame["Nydus Canal"] ?? null,
        who,
      });
    }
    // 성큰러시(요청) — 내 기지가 아닌 곳에 초반에 성큰을 짓는 것. 상대 코앞이든 가운데든
    // '내 본진 밖'이면 다 해당한다. 같은 건물이라도 어디에 지었나가 전부라서, 자리를 봐야만
    // 방어용 성큰과 갈린다. 해처리는 보지 않는다(지적: 보통 해처리를 안 펴고 바로 성큰을
    // 짓는다) — 크립콜로니/성큰 자체의 자리만 본다.
    const sunkenRush = (["Creep Colony", "Sunken Colony"] as const).flatMap((b) => [
      ...inZone("enemy", b, SUNKEN_RUSH_SEC), ...inZone("mid", b, SUNKEN_RUSH_SEC),
    ]);
    if (sunkenRush.length > 0) {
      out.push({
        key: "sunken-rush", ...foeAt(sunkenRush), weight: SNEAK_WEIGHT, at: firstOf(sunkenRush), who,
      });
    }
    // 뮤탈 대규모 — 한두 부대로는 '대규모'가 아니다(지적: 3~4부대). 한 부대 12기 기준으로
    // 세 부대부터 본다. 견제의 대명사라 상대 일꾼 생산이 치솟았는지와 짝지어 볼 수 있다(요청).
    const mutas = u("Mutalisk");
    if (mutas >= MUTA_MASS_MIN) {
      out.push({
        key: "muta", weight: 9, at: firstU("Mutalisk"), who,
        p: { squads: Math.floor(mutas / 12) },
      });
    }
    // 가디언 — 뮤탈을 변태시켜 지상을 두들기는 그림. 나오는 것 자체가 드물어 이야깃거리다(요청).
    if (u("Guardian") >= 4) {
      out.push({
        key: "guardian", weight: 10, at: firstU("Guardian"), who,
        p: { n: u("Guardian") },
      });
    }
    // 인페스티드 테란(요청) — 퀸으로 상대 커맨드센터를 감염시켜야만 나온다. 경기에 한 번
    // 나올까 말까 한 사건이라, 나왔다는 것 자체가 그날의 이야기다.
    if (u("Infested Terran") >= 1) {
      out.push({
        key: "infested", ...target, weight: 16,
        at: firstU("Infested Terran"), who, p: { n: u("Infested Terran") },
      });
    }
    if (u("Lurker") >= 5) {
      out.push({
        key: "lurker", weight: 7, at: firstU("Lurker"),
        who,
      });
    }
  }

  // ── 테란 ──
  if (race === "테란") {
    if (u("Marine") >= 16 && u("Medic") >= 5) {
      const withTank = tanks >= 4;
      out.push({
        key: "bionic", weight: 10, at: firstU("Medic"),
        who, p: { tank: withTank },
      });
    } else if (tanks >= 6 && u("Vulture") + u("Goliath") >= 8 && u("Marine") < 10) {
      out.push({
        key: "mech", weight: 9, at: firstU("Siege Tank (Tank Mode)") ?? firstU("Goliath"),
        who,
      });
    }
    // 배틀크루저 — 띄우는 것 자체가 사건이고, 띄우고도 지는 경기가 많아 이야기가 된다(요청).
    if (u("Battlecruiser") >= 3) {
      out.push({
        key: "bc", weight: 11, at: firstU("Battlecruiser"), who,
        p: { n: u("Battlecruiser") },
      });
    }
    if (u("Valkyrie") >= 3 && foeRaces.includes("저그")) {
      out.push({
        key: "valkyrie", weight: 8, at: firstU("Valkyrie"),
        who,
      });
    }
    // 몰래 배럭 — 본진에서 한참 떨어진 자리에 올린 초반 배럭. 자리를 안 보면 그냥 배럭이다.
    // 자리만으로는 애매한 구석이 있다(지적) — 상대 진영으로 보이는 자리는 그것만으로 확실하지만,
    // 가운데에 올린 배럭은 앞마당 방어일 수도 있다. 그래서 가운데 배럭은 파이어뱃까지 나왔을
    // 때만 인정하고, 그 조합은 아예 '몰래 배럭 파이어뱃 러시'로 부른다(요청).
    const firebats = u("Firebat");
    const rushFirebat = firebats >= FIREBAT_RUSH_MIN;
    const atFoe = inZone("enemy", "Barracks", 300);
    const sneaky = [...atFoe, ...(rushFirebat ? inZone("mid", "Barracks", 300) : [])];
    if (sneaky.length > 0) {
      out.push({
        key: "sneak-rax", ...foeAt(sneaky), weight: rushFirebat ? SNEAK_WEIGHT + 1 : SNEAK_WEIGHT,
        at: firstOf(sneaky), who, p: { firebat: rushFirebat },
      });
    }
    // 탱크 방어(흔히 옆탱, 요청) — 두 갈래다. 아군 기지에 팩토리를 올려 그쪽을 받쳐주는 것도 옆탱이고,
    // 내 기지에서 뽑은 탱크로 바로 옆에 붙은 상대를 잡아내는 것도 옆탱이다(지적).
    const sideFactory = inZone("ally", "Factory");
    const firstTank = firstU("Siege Tank (Tank Mode)") ?? firstU("Siege Tank (Siege Mode)");
    if (sideFactory.length > 0 && tanks >= 3) {
      const helped = geo?.allyAt(sideFactory[0]) ?? null;
      out.push({
        key: "side-tank", weight: 11, at: firstOf(sideFactory), who,
        ...(helped ? { who2: helped } : {}), p: { at: "ally" },
      });
    } else if (neighbor && tanks >= 3 && firstTank !== null && neighbor.fellAt > firstTank) {
      // 탱크가 실제로 무엇을 잡았는지는 리플레이에 없다. 확실한 건 '옆에 붙은 상대가
      // 내 탱크가 나온 뒤에 먼저 판에서 사라졌다'는 것이고, 딱 그만큼만 말한다.
      out.push({
        key: "side-tank", weight: 12, at: firstTank, who,
        whom: neighbor.raw, p: { at: "home" },
      });
    }
    if (dropped && u("Dropship") >= 2) {
      out.push({
        key: "dropship", ...target, weight: 7, at: s.firstUnloadFrame,
        who,
      });
    }
  }

  // 클로킹 레이스(요청) — 레이스만으로는 정찰일 수 있고, 클로킹까지 올려야 전략이다.
  if (race === "테란" && u("Wraith") >= WRAITH_MIN && s.upgradeNames.includes("Cloaking Field")) {
    out.push({
      key: "cloak-wraith", ...target, weight: 12,
      at: firstU("Wraith"), who, p: { n: u("Wraith") },
    });
  }
  // 이레디에이트로 일꾼 지우기(요청) — 베슬을 띄우고 이레디를 올렸다는 것 자체가 그 그림이다.
  if (race === "테란" && hasTech("Irradiate") && u("Science Vessel") >= VESSEL_MIN) {
    out.push({
      key: "irradiate", ...target, weight: 12,
      at: s.firstTechFrame["Irradiate"] ?? firstU("Science Vessel"), who,
    });
  }

  // ── 프로토스 ──
  if (race === "프로토스") {
    // N게이트 질럿 러시 — 첫 질럿이 나오기 전에 세운 게이트 수가 곧 빌드 이름이다.
    const zealot = firstU("Zealot");
    if (zealot !== null && sec(zealot) < 260 && u("Zealot") >= 6) {
      const gates = (s.buildingFrames["Gateway"] ?? []).filter((f) => f < zealot).length;
      if (gates >= 2) {
        out.push({
          key: "zealot-rush", ...target, weight: 12, at: zealot,
          who, p: { gates, solo },
        });
      }
    }
    // 초반 포토러시 — 상대 본진에 박은 포토만 해당한다(지적). 가운데까지 세면 앞마당·길목
    // 방어 포토가 죄다 러시로 잡혀 지나치게 자주 나왔다. 포지를 게이트보다 먼저 올린 것도
    // 근거가 아니다 — 그건 빠른 포지일 뿐이고 그 포토를 제 본진에 지었으면 방어다.
    const cannon = firstB("Photon Cannon");
    const forward = inZone("enemy", "Photon Cannon", 360);
    const cannonRush = cannon !== null && sec(cannon) < 330 && forward.length > 0;
    if (cannonRush) {
      out.push({
        key: "cannon-rush", ...foeAt(forward), weight: SNEAK_WEIGHT, at: cannon,
        who,
      });
    }
    if (u("Arbiter") >= 1 && hasTech("Recall")) {
      out.push({
        key: "recall", weight: 10, at: firstU("Arbiter"),
        who,
      });
    }
    if (dropped && u("Shuttle") >= 2 && u("Reaver") >= 3) {
      out.push({
        key: "shuttle-reaver", ...target, weight: 11, at: s.firstUnloadFrame,
        who,
      });
    } else if (dropped && u("Shuttle") >= 2 && u("High Templar") >= 4) {
      // 하이템플러 드랍(요청) — 셔틀에 템플러를 태워 일꾼을 지지는 그림. 리버 드랍과
      // 같은 셔틀 플레이지만 결과가 전혀 달라서 따로 말한다.
      out.push({
        key: "templar-drop", ...target, weight: 11, at: s.firstUnloadFrame,
        who,
      });
    } else if (dropped && u("Shuttle") >= 2) {
      out.push({
        key: "shuttle", ...target, weight: 6, at: s.firstUnloadFrame,
        who,
      });
    }
  }

  // ── 종족 공통(자리 기반) ── 어느 종족이든 '가운데를 먹었나'는 자리로만 알 수 있다.
  const midCannons = inZone("mid", "Photon Cannon");
  if (midCannons.length >= 2) {
    out.push({ key: "center-photon", ...target, weight: 10, at: firstOf(midCannons), who, p: { n: midCannons.length } });
  } else {
    const mid = inZone("mid");
    if (mid.length >= 3) {
      // 무슨 건물을 지었는지까지 말한다(지적: 무슨 건물인지 모르겠음) — 가장 많이 세운 것 하나.
      const byKind = new Map<string, number>();
      for (const b of mid) byKind.set(b.unit, (byKind.get(b.unit) ?? 0) + 1);
      const top = [...byKind.entries()].sort((a, b) => b[1] - a[1])[0];
      out.push({
        key: "center", weight: 8, at: firstOf(mid), who,
        p: { n: mid.length, ...(top ? { b: top[0] } : {}) },
      });
    }
  }

  // ── 입구 방어(요청) ── 리플레이에 지형이 없어 램프 자체는 알 수 없다. 대신 '내 본진
  // 안이면서 상대 쪽으로 나가 있는 자리'는 진출로 쪽이고, 거기 박은 방어 건물은 뒤나 옆에
  // 세운 것과 뜻이 다르다. 한 채는 우연일 수 있어 두 채부터 말한다.
  const frontDef = (["Bunker", "Photon Cannon", "Sunken Colony"] as const).map((b) => ({
    b, at: atFront(b),
  })).filter((x) => x.at.length >= 2).sort((a, b) => b.at.length - a.at.length)[0];
  if (frontDef) {
    out.push({
      key: "front-defense", weight: 8, at: firstOf(frontDef.at), who,
      p: { b: frontDef.b, n: frontDef.at.length },
    });
  }

  // ── 셋방살이(요청) ── 내 기지에는 건물이 거의 없고 아군 기지에 얹혀 있는 것(지적).
  // 건물 하나가 아군 쪽에 있는 걸로는 부족하다 — 내 건물 덩어리 자체가 거기 앉아야 한다.
  if (geo?.lodgingHost) {
    out.push({
      key: "lodging", weight: 9, who, who2: geo.lodgingHost,
      at: firstOf(s.buildPositions),
      ...(geo.lodgingLost ? { p: { lost: true } } : {}),
    });
  }

  // ── 채팅(요청) ── GG 선언은 승부가 어디서 끝났는지 알려주는 유일한 '사람의 말'이다.
  // 오타·장난까지 잡으려 들면 오탐이 늘어서, 통용되는 항복 표현만 좁게 본다.
  // gg / ㅈㅈ / ww — 셋 다 같은 말이다(지적). ww는 한글 자판에서 ㅈㅈ을 영문 상태로 친 것이고,
  // ㅈㅈ은 그 반대다. ㅎㅎ은 웃음이라 넣지 않는다.
  const gg = s.chats.find((c) => /^\s*(g{2,}|w{2,}|ㅈ{2,}|지지|잘{1,2}했|잘하시네)/i.test(c.text));
  if (gg) {
    out.push({ key: "gg", weight: 6, at: gg.frame, who });
  }

  return out;
}

// '옆'이라고 부르려면 나머지 상대보다 이만큼은 가까워야 한다 — 셋 다 비슷한 거리면
// 누가 옆인지 말할 수 없다.
const NEIGHBOR_MARGIN = 1.3;
// 판이 끝나기 이만큼 전에 손을 놓았다면 먼저 정리된 것이다.
const FELL_EARLY_SEC = 2 * 60;

/** 팀전에서 내 옆에 붙은 상대가 먼저 나가떨어졌는가. 탱크 방어의 유일한 확실한 근거다 —
 *  탱크가 무엇을 잡았는지는 리플레이에 없고, '누가 가까웠고 누가 먼저 사라졌나'는 있다. */
function neighborOf(
  me: ParsedReplayPlayer,
  foes: ParsedReplayPlayer[],
  endFrame: number
): { raw: string; fellAt: number } | null {
  if (foes.length < 2) return null; // 1:1엔 '옆'이 없다
  const home = homeOf(me);
  if (!home) return null;
  const ranked = foes
    .map((f) => ({ f, h: homeOf(f) }))
    .filter((x): x is { f: ParsedReplayPlayer; h: { x: number; y: number } } => x.h !== null)
    .map((x) => ({ f: x.f, d: dist(home, x.h) }))
    .sort((a, b) => a.d - b.d);
  if (ranked.length < 2) return null;
  if (!(ranked[1].d >= ranked[0].d * NEIGHBOR_MARGIN)) return null;
  const last = ranked[0].f.signals?.lastCmdFrame ?? null;
  if (last === null || sec(endFrame - last) < FELL_EARLY_SEC) return null;
  return { raw: ranked[0].f.rawName, fellAt: last };
}

export interface TacticScanInput {
  sidePlayers: ParsedReplayPlayer[];
  foePlayers: ParsedReplayPlayer[];
}

/** 한 편의 전술 목록 — 무게 큰 것부터, 같은 전술은 한 번만. */
export function scanTactics({ sidePlayers, foePlayers }: TacticScanInput): Tactic[] {
  const foeRaces = [...new Set(foePlayers.map((p) => p.race).filter(Boolean))];
  // 당한 쪽은 1:1에서만 확실하다 — 팀전에서 누구를 때렸는지는 커맨드만으로 알 수 없어서
  // 아예 말하지 않는다(요청: 불확실한 건 빼기).
  const soleFoe = foePlayers.length === 1 ? foePlayers[0].rawName : null;
  // 판이 끝난 시점 — 마지막까지 손을 놀린 사람의 마지막 커맨드. 여기서 한참 앞서 손을 놓은
  // 사람은 그 전에 죽었거나 나간 것이다.
  const endFrame = Math.max(
    0,
    ...[...sidePlayers, ...foePlayers].map((p) => p.signals?.lastCmdFrame ?? 0)
  );

  const all: Tactic[] = [];
  for (const p of sidePlayers) {
    if (!p.signals) continue;
    all.push(
      ...detectFor({
        rawName: p.rawName, s: p.signals, race: p.race, foeRaces, soleFoe,
        geo: geoOf(p, sidePlayers.filter((x) => x !== p), foePlayers),
        neighbor: neighborOf(p, foePlayers, endFrame),
      })
    );
  }
  const seen = new Set<string>();
  return all
    .sort((a, b) => b.weight - a.weight)
    // gg는 사람마다 남긴다 — 팀원이 잇달아 친 걸 한 문장으로 묶으려면 전부 필요하다(요청).
    .filter((t) => {
      const key = t.key === "gg" ? `gg|${t.who}` : t.key;
      return seen.has(key) ? false : (seen.add(key), true);
    });
}
