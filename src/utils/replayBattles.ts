import { FIGHT_TECHS } from "./replayTactics";
import { AIR_UNITS, CASTER_UNITS, NOT_ARMY } from "./replayBuildMix";

/* ── 전투(교전) 하나하나의 승패 ─────────────────────────────────────────────────
   지상전·공중전·마법 퀸의 재료다(요청: 그 전투 하나하나에서 이겼냐가 중요하다 — 판정은
   "그 자리에 살아남았나").

   리플레이에는 전투도 죽음도 안 남는다(replayParser 주석). 남는 것은 명령이다 — 그래서
   전투를 이렇게 어림한다:
   ① 공격 명령·직접 타격(hits)·교전 마법(FIGHT_TECHS)의 좌표·시각을 한데 모아, 시간·자리가
      가까운 것끼리 뭉친다(fightersAt·biggestClash와 같은 근거를 '뭉치 단위'로 쓴다).
   ② 한 뭉치에 서로 다른 두 편이 제각기 충분히 찍었으면 그것이 전투다 — 한쪽뿐이면 빈 집
      두들기기(견제)지 전투가 아니다.
   ③ 승패는 그 자리에 살아남았나로 가른다(요청) — 전투가 끝난 뒤 한동안 그 자리 근처에
      명령을 계속 찍는 편이 살아남은 쪽이고, 발길이 끊긴 편이 물러난(전멸한) 쪽이다.
      둘 다 남았거나 둘 다 떠났으면 승패 없음 — 그런 전투는 아예 안 센다: 어중간한 판정을
      반반으로 섞으면 승률이 값이 아니라 소음이 된다.

   전투마다 참가자를 갈래로 나눠 센다 — 마법은 그 전투에서 실제로 마법을 썼나로, 지상·공중은
   그때까지 뽑아 온 병력의 꼴로 가른다(그 순간 무엇이 싸웠는지는 명령의 주인(by)이 드물게만
   남아 못 쓴다 — 시즈·스톰처럼 저만의 커맨드가 있는 유닛만 이름이 붙는다). */

const SECONDS_PER_FRAME = 0.042;

/** 같은 전투로 볼 시간 틈과 반경(타일) — 반경은 fightersAt(14)과 같은 자를 쓰되, 틈은
 *  60초가 아니라 짧게 잡는다: 여기서는 '한 판 전체의 그 무렵'이 아니라 전투 하나의 경계를
 *  긋는 자리라, 틈이 넓으면 한 자리에서 벌어진 두 번의 전투가 하나로 붙는다. */
const GAP_SEC = 12;
const RADIUS = 14;
/** 한 편이 이만큼은 찍어야 전투다 — 몇 번은 지나가던 길이다(fightersAt의 3보다 높은 것은
 *  거긴 '마법이 떨어진 자리'라는 증거가 이미 있는 자리라서다). */
const TEAM_MIN_ORDERS = 8;
/** 이 사람이 그 전투에 꼈다고 말할 최소 명령 수. */
const PLAYER_MIN_ORDERS = 5;
/** 살아남았나를 보는 창 — 끝(마지막 명령)에서 조금 지나서부터 이만큼. 바로 다음 순간은
 *  마지막 컨트롤의 꼬리라 양쪽 다 찍혀 있기 마련이다. */
const AFTER_SKIP_SEC = 5;
const AFTER_SEC = 45;
/** 그 창에 이만큼 찍혀 있으면 '그 자리에 남아 있다'. */
const PRESENCE_MIN = 3;

/** 공중 '전투' 유닛 — AIR_UNITS에서 실어 나르고 보는 것들(수송선·옵저버)과 마법 유닛을
 *  뺀 것. 셔틀 세 대로 "공중전"이 되면 안 된다. */
const AIR_COMBAT = new Set(
  [...AIR_UNITS].filter((u) => !["Dropship", "Shuttle", "Observer"].includes(u) && !CASTER_UNITS.has(u)),
);

/** 병력 꼴 판정의 바닥 — 그때까지 공중 전투 유닛을 이만큼(수·비중) 뽑았어야 그 전투를
 *  "공중전으로 싸웠다"고 부른다. 지상은 기본값이라 비중이 절반만 넘으면 지상전이다. */
const AIR_PROD_MIN = 6;
const AIR_SHARE_MIN = 0.25;
const GROUND_PROD_MIN = 8;
const GROUND_SHARE_MIN = 0.5;

/** 한 사람의 전투 원장 — buildMix에 실려 저장되고, 서버가 기간 합계를 내 칭호가 읽는다. */
export interface BattleCounts {
  btGround: number;
  btGroundWon: number;
  btAir: number;
  btAirWon: number;
  btMagic: number;
  btMagicWon: number;
}

interface BattlePlayerLike {
  rawName: string;
  team: number;
  isComputer: boolean;
  signals: {
    orderPositions: { frame: number; x: number; y: number; kind?: "attack" | "move"; by?: string }[];
    hits: { frame: number; x: number; y: number; whom: string }[];
    castPositions: { tech: string; frame: number; x: number; y: number }[];
    unitFrames: Record<string, number[]>;
  } | null;
}

interface Ev { frame: number; x: number; y: number; who: number; cast: boolean }

interface Cluster {
  sx: number; sy: number; n: number;
  first: number; last: number;
  byPlayer: Map<number, number>;
  castsBy: Map<number, number>;
}

const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(ax - bx, ay - by);

/** 그때까지 뽑은 병력의 꼴 — 지상/공중 전투 유닛 수(마법·일꾼·수송은 병력으로 안 센다). */
function armyAt(p: BattlePlayerLike, frame: number): { ground: number; air: number } {
  let ground = 0;
  let air = 0;
  for (const [unit, frames] of Object.entries(p.signals?.unitFrames ?? {})) {
    if (NOT_ARMY.has(unit) || CASTER_UNITS.has(unit)) continue;
    const n = frames.filter((f) => f <= frame).length;
    if (AIR_COMBAT.has(unit)) air += n;
    else if (!AIR_UNITS.has(unit)) ground += n;
  }
  return { ground, air };
}

/** 전투가 끝난 뒤 그 자리에 남아 있나 — 창 안에 그 근처를 찍은 명령이 바닥만큼 있나. */
function stayed(p: BattlePlayerLike, c: Cluster): boolean {
  const cx = c.sx / c.n;
  const cy = c.sy / c.n;
  const from = c.last + AFTER_SKIP_SEC / SECONDS_PER_FRAME;
  const to = c.last + AFTER_SEC / SECONDS_PER_FRAME;
  let n = 0;
  for (const o of p.signals?.orderPositions ?? []) {
    if (o.frame < from || o.frame > to) continue;
    if (dist(o.x, o.y, cx, cy) > RADIUS * 1.25) continue;
    n += 1;
    if (n >= PRESENCE_MIN) return true;
  }
  return false;
}

/** 게임 하나의 전투를 모두 가려 사람별 원장을 낸다 — 좌표를 못 읽은 판(수기 등록·옛
 *  리플레이)은 빈 지도를 낸다(전투가 없다는 말이 아니라 모른다는 말이지만, 저장 모양은
 *  같다 — 재분석이 그 판들을 채운다). */
export function battleCountsOf(players: BattlePlayerLike[]): Map<string, BattleCounts> {
  const out = new Map<string, BattleCounts>();
  const fighters = players.filter((p) => !p.isComputer && p.signals);
  if (fighters.length < 2) return out;

  // 전투의 증거가 되는 명령들 — 공격 지정(건물 랠리 제외)·직접 타격·교전 마법.
  const evs: Ev[] = [];
  fighters.forEach((p, idx) => {
    for (const o of p.signals?.orderPositions ?? []) {
      if (o.kind !== "attack" || o.by === "Building") continue;
      evs.push({ frame: o.frame, x: o.x, y: o.y, who: idx, cast: false });
    }
    for (const h of p.signals?.hits ?? []) {
      evs.push({ frame: h.frame, x: h.x, y: h.y, who: idx, cast: false });
    }
    for (const cst of p.signals?.castPositions ?? []) {
      if (!FIGHT_TECHS.has(cst.tech)) continue;
      evs.push({ frame: cst.frame, x: cst.x, y: cst.y, who: idx, cast: true });
    }
  });
  evs.sort((a, b) => a.frame - b.frame);

  const gap = GAP_SEC / SECONDS_PER_FRAME;
  const open: Cluster[] = [];
  const closed: Cluster[] = [];
  for (const e of evs) {
    // 틈이 지난 뭉치는 닫는다 — 시간순이라 다시 열릴 일이 없다.
    for (let i = open.length - 1; i >= 0; i -= 1) {
      if (e.frame - open[i].last > gap) closed.push(...open.splice(i, 1));
    }
    // 자리가 닿는 뭉치 중 가장 가까운 곳에 얹는다 — 없으면 새 뭉치다.
    let best: Cluster | null = null;
    let bestD = Infinity;
    for (const c of open) {
      const d = dist(e.x, e.y, c.sx / c.n, c.sy / c.n);
      if (d <= RADIUS && d < bestD) { best = c; bestD = d; }
    }
    if (!best) {
      best = { sx: 0, sy: 0, n: 0, first: e.frame, last: e.frame, byPlayer: new Map(), castsBy: new Map() };
      open.push(best);
    }
    best.sx += e.x; best.sy += e.y; best.n += 1; best.last = e.frame;
    best.byPlayer.set(e.who, (best.byPlayer.get(e.who) ?? 0) + 1);
    if (e.cast) best.castsBy.set(e.who, (best.castsBy.get(e.who) ?? 0) + 1);
  }
  closed.push(...open);

  const countsOf = (name: string): BattleCounts => {
    let c = out.get(name);
    if (!c) {
      c = { btGround: 0, btGroundWon: 0, btAir: 0, btAirWon: 0, btMagic: 0, btMagicWon: 0 };
      out.set(name, c);
    }
    return c;
  };
  // 좌표를 읽은 사람은 전투가 0이어도 0으로 적는다 — "안 셌다"와 "없었다"가 갈린다.
  fighters.forEach((p) => countsOf(p.rawName));

  for (const c of closed) {
    // 편별 명령 수 — 서로 다른 두 편이 제각기 바닥을 넘어야 전투다.
    const byTeam = new Map<number, number>();
    for (const [idx, n] of c.byPlayer) {
      const t = fighters[idx].team;
      byTeam.set(t, (byTeam.get(t) ?? 0) + n);
    }
    const teams = [...byTeam.entries()]
      .filter(([, n]) => n >= TEAM_MIN_ORDERS)
      .sort((a, b) => b[1] - a[1]);
    if (teams.length < 2) continue;
    const [t1, t2] = [teams[0][0], teams[1][0]];

    // 살아남은 편 — 두 편 중 정확히 한 편만 남았을 때만 승패가 선다.
    const alive = (team: number): boolean =>
      fighters.some((p, idx) => p.team === team && (c.byPlayer.get(idx) ?? 0) > 0 && stayed(p, c));
    const a1 = alive(t1);
    const a2 = alive(t2);
    if (a1 === a2) continue;
    const winner = a1 ? t1 : t2;

    for (const [idx, n] of c.byPlayer) {
      const p = fighters[idx];
      if (n < PLAYER_MIN_ORDERS || (p.team !== t1 && p.team !== t2)) continue;
      const won = p.team === winner ? 1 : 0;
      const cnt = countsOf(p.rawName);
      // 마법 — 그 전투에서 실제로 교전 마법을 떨어뜨렸나.
      if ((c.castsBy.get(idx) ?? 0) > 0) {
        cnt.btMagic += 1;
        cnt.btMagicWon += won;
      }
      // 지상/공중 — 그때까지 뽑아 온 병력의 꼴로 가른다(위 모듈 주석).
      const army = armyAt(p, c.first);
      const total = army.ground + army.air;
      if (total > 0) {
        if (army.air >= AIR_PROD_MIN && army.air / total >= AIR_SHARE_MIN) {
          cnt.btAir += 1;
          cnt.btAirWon += won;
        }
        if (army.ground >= GROUND_PROD_MIN && army.ground / total >= GROUND_SHARE_MIN) {
          cnt.btGround += 1;
          cnt.btGroundWon += won;
        }
      }
    }
  }
  return out;
}
