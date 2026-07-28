import type { ParsedReplay, ParsedReplayPlayer, ReplayPlayerSignals } from "./replayParser";
import { scanTactics } from "./replayTactics";
import { fellFrame } from "./replayFell";
import { REPLAY_SUMMARY_VERSION, type ReplaySummaryBeat, type ReplaySummaryData } from "./replaySummaryData";
import {
  DEFENSE_KO, EXPANSION_KO, PRODUCTION_KO, SPECTACLE_UNITS, SUPPORT_UNITS, UNIT_KO, UNIT_ROLE,
  renderReplaySummary,
} from "./replaySummaryText";

// 리플레이에서 뽑은 재료로 경기 요약을 만든다(요청).
//
// 만드는 건 완성된 문장이 아니라 '무슨 일이 있었나'의 목록이다(ReplaySummaryData) — 문구와
// 이름은 볼 때 replaySummaryText.ts가 붙인다. 그래야 닉네임이 바뀌거나 표현을 고쳐도 이미
// 등록된 경기가 옛말을 계속 보여주지 않는다(요청). 여기가 하는 일은 "무엇을 말할지"를
// 고르는 것까지고, "어떻게 말할지"는 전부 저쪽 몫이다.
//
// 아래 원칙은 그대로다.
//
// "APM 210 vs 150" 같은 지표 나열이 아니라 전황을 말하는 문장이어야 하고(요청), 경기마다
// 다른 이야기가 나오도록 최대한 다양하고 풍부해야 한다(요청):
//   "미친마법사가 하이템플러 캐리어 조합으로 승리"
//   "브래드가 초반 열세이다가 후반에 탱크와 발키리 조합으로 역전"
//   "34분 혈투 끝에 조조가 울트라 디파일러로 승리, 유비가 일찍 무너짐"
//
// 구조: 재료에서 '사실(Fact)'을 여러 개 뽑아 두고, 희소한 것부터 골라 두세 개를 이어 붙인다.
// 한 가지 규칙으로 문장 하나만 찍어내면 모든 경기가 똑같이 읽히기 때문이다 — 핵·캐리어·
// 40분 혈투 같은 드문 사건이 있으면 그게 먼저 말해진다.
//
// 재료는 전부 커맨드 스트림의 '명령' 기록이라 '완성'이 아니다 — 취소한 생산도 세지고,
// 저그 라바 다중 변태는 커맨드 1개로 잡힌다(replayParser의 buildCount 주석과 같은 한계).
// 그래서 문장은 단정("압도했다")을 피하고 관찰한 사실만 말한다. 알맹이가 없으면 null을
// 돌려주고 요약을 안 붙인다 — 틀린 문장보다 없는 편이 낫다.

// 1 프레임 = 0.042초(replayParser와 같은 상수).
const SECONDS_PER_FRAME = 0.042;

// 조합 이야기에서 뺄 유닛 — 일꾼·보급·알처럼 "무엇으로 싸웠나"와 무관한 것들.
const WORKER_UNITS = new Set(["SCV", "Probe", "Drone"]);
const NON_COMBAT_UNITS = new Set([
  ...WORKER_UNITS, "Larva", "Egg", "Overlord", "Mutalisk Cocoon", "Cocoon", "Lurker Egg",
  // 인터셉터/스캐럽은 캐리어·리버가 자동으로 뽑는 소모품이라 조합 이름이 될 수 없다.
  "Interceptor", "Scarab", "Spider Mine", "Scanner Sweep",
]);



// 후반 테크로 볼 유닛 / 초반 러시로 볼 유닛.
const LATE_TECH_UNITS = new Set([
  "Carrier", "Arbiter", "Battlecruiser", "Science Vessel", "Valkyrie",
  "Ultralisk", "Defiler", "Guardian", "Devourer", "Archon", "Dark Archon", "Reaver",
]);
const EARLY_RUSH_UNITS = new Set(["Zergling", "Marine", "Zealot", "Hydralisk", "Vulture"]);

// 확장(멀티) 건물 — 이걸 몇 개 지었나로 운영/올인을 가른다.
const EXPANSION_BUILDINGS = new Set(["Nexus", "Hatchery", "Command Center"]);
// 방어 건물·드랍 수송선 이야기는 이제 각각 "질럿과 성큰으로 막아섰지만 실패"(아래
// DEFENSE_KO)와 전술 층(replayTactics의 드랍십/셔틀)이 맡는다 — 여기 목록은 없앴다.

// 유닛이 경기에서 하는 '역할' — 같은 승리라도 무엇으로 이겼는지에 따라 다르게 읽히도록
// (요청: 팀전이라도 잘한 사람이 있으면 그 사람 얘기를 많이 — "하이템플러 견제로 승기를 잡음").
// 활약을 고를 때 역할에 매기는 가중치. 질럿 40기와 하이템플러 25기 중 이야깃거리는 뒤쪽인데
// (요청 예시: "하이템플러 견제로 승기를 잡음") 개수만 보면 앞쪽이 이긴다 — 기본 병력은 낮추고
// 판을 가르는 역할은 올려서, '많이 뽑은 유닛'이 아니라 '그 사람다운 유닛'이 뽑히게 한다.
const ROLE_WEIGHT: Record<string, number> = {
  견제: 2, 마법: 2, 매복: 1.8, 저격: 1.8, "공중 견제": 1.8, 드랍: 1.6, 자폭: 1.6,
  "공중 장악": 1.5, 제공권: 1.3, 돌파: 1, "자리 잡기": 0.7, 물량: 0.5,
};
// 역할별 맺음말 — 뜻에 맞춰 갈라 두면 같은 문장이 반복되지 않는다.


// 국면 경계(초). 클럽 경기 길이 분포에 맞춘 어림값이다.
const EARLY_GAME_SEC = 7 * 60;
const LATE_GAME_SEC = 18 * 60;
const EPIC_GAME_SEC = 30 * 60;

// 한쪽이 이 배율 넘게 일꾼을 더 뽑았으면 경제가 벌어진 것으로 본다.
const WORKER_GAP_RATIO = 1.6;
// 건물을 이만큼 띄웠으면 한두 채 옮긴 게 아니라 자리를 내주고 도망다닌 것이다.
const LIFT_OFF_MIN = 3;
// 방어 건물을 한 종류라도 이만큼 지었으면 '막을 준비'로 본다.
const DEFENSE_MIN = 3;
// 여기부터는 준비가 아니라 아예 웅크린 것이다 — 그 자체가 전황이라 더 무겁게 친다(요청).
const TURTLE_MIN = 6;

// 마지막 커맨드가 경기 끝보다 이만큼(비율) 앞서면 "일찍 무너졌다"로 본다.
const EARLY_OUT_RATIO = 0.7;

// 합공으로 볼 시간 창 — 이보다 늦게 끊긴 건 초반 러시가 아니라 그냥 진 것이다.
const GANG_RUSH_SEC = 9 * 60;
// 그 시점까지 이만큼은 뽑았어야 '달려든 사람'으로 센다 — 뒤에서 확장만 하고 있던 사람까지
// 합공에 넣으면 숫자가 거짓말이 된다.
const GANG_MIN_UNITS = 8;

interface Side {
  players: ParsedReplayPlayer[];
  /** 이 편이 뽑은 전투 유닛 합계(유닛명 → 커맨드 수). */
  combat: Map<string, number>;
  /** 이 편이 지은 건물 합계. */
  buildings: Map<string, number>;
  /** 일꾼 생산 커맨드 수. */
  workers: number;
  /** 구간별 커맨드 수 합계(초반/중반/후반). */
  thirds: [number, number, number];
  /** 연구한 테크 이름(중복 제거). */
  techs: Set<string>;
}

function buildSide(players: ParsedReplayPlayer[]): Side {
  const combat = new Map<string, number>();
  const buildings = new Map<string, number>();
  const techs = new Set<string>();
  const thirds: [number, number, number] = [0, 0, 0];
  let workers = 0;
  for (const p of players) {
    const s: ReplayPlayerSignals | null = p.signals;
    if (!s) continue;
    for (const [unit, n] of Object.entries(s.unitCounts)) {
      if (WORKER_UNITS.has(unit)) { workers += n; continue; }
      if (NON_COMBAT_UNITS.has(unit)) continue;
      if (!UNIT_KO[unit]) continue; // 이름을 모르는 유닛은 문장에 못 쓴다
      combat.set(unit, (combat.get(unit) ?? 0) + n);
    }
    for (const [b, n] of Object.entries(s.buildingCounts)) {
      buildings.set(b, (buildings.get(b) ?? 0) + n);
    }
    for (const t of s.techNames) if (DECISIVE_TECHS.has(t)) techs.add(t);
    s.cmdCountByThird.forEach((n, i) => { thirds[i] += n; });
  }
  return { players, combat, buildings, workers, thirds, techs };
}

function countIn(map: Map<string, number>, names: Set<string>): number {
  let n = 0;
  for (const [k, v] of map) if (names.has(k)) n += v;
  return n;
}

/** 그 편의 주력 — 가장 많이 뽑은 전투 유닛 최대 두 종류(2위가 1위에 한참 못 미치면 하나만).
 *  앞자리는 스스로 싸움을 끝낼 수 있는 유닛에 준다 — 메딕·퀸 같은 보조 유닛이 수만 많다고
 *  "메딕으로 이김"이 되면 곤란하다(지적). 그런 유닛은 뒷자리로 밀려 조합으로 읽힌다. */
function mainUnits(side: Side): string[] {
  const ranked = [...side.combat.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return [];
  const lead = ranked.find(([u]) => !SUPPORT_UNITS.has(u)) ?? ranked[0];
  const second = ranked.find((x) => x !== lead);
  const out = [lead[0]];
  if (second && second[1] >= lead[1] * 0.35) out.push(second[0]);
  return out;
}

function sumCombat(p: ParsedReplayPlayer): number {
  const s = p.signals;
  if (!s) return 0;
  let n = 0;
  for (const [unit, c] of Object.entries(s.unitCounts)) {
    if (NON_COMBAT_UNITS.has(unit)) continue;
    n += c;
  }
  return n;
}

/** 그 편에서 눈에 띄게 많이 뽑은 사람 — 팀전이라도 이 사람 얘기를 많이 하기 위한 기준
 *  (요청). 2등보다 1.4배 넘게 앞서면 인정한다(예전엔 "혼자 절반 넘게"라 3인 이상 팀에서는
 *  거의 안 잡혔다). 1:1은 당연히 그 사람이다. */
function standout(side: Side): ParsedReplayPlayer | null {
  const ranked = side.players
    .map((p) => ({ p, n: sumCombat(p) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  if (ranked.length === 0) return null;
  if (ranked.length === 1) return ranked[0].p;
  return ranked[0].n >= ranked[1].n * 1.4 ? ranked[0].p : null;
}

/** 한 사람이 뽑은 전투 유닛만 골라 많은 순으로 — 팀 합계가 아니라 '이 사람의 조합'이다. */
function ownCombat(p: ParsedReplayPlayer): Map<string, number> {
  const out = new Map<string, number>();
  const s = p.signals;
  if (!s) return out;
  for (const [unit, n] of Object.entries(s.unitCounts)) {
    if (NON_COMBAT_UNITS.has(unit)) continue;
    if (!UNIT_KO[unit]) continue;
    out.set(unit, n);
  }
  return out;
}

/** "○○의 하이템플러 견제로 승기를 잡음"에 쓸 유닛 하나 — 그 사람을 특징짓는 카드를 고른다.
 *  팀 동료가 거의 안 뽑은 유닛일수록 그 사람의 몫이 뚜렷하므로 우선한다.
 *  avoid는 본문이 이미 말한 유닛 — "저글링으로 역전, 저글링 물량으로 밀어붙임"처럼 같은
 *  단어를 두 번 쓰지 않기 위해 뺀다. 다 빼서 남는 게 없으면 그냥 원래대로 고른다. */
function heroUnitOf(
  side: Side,
  hero: ParsedReplayPlayer,
  avoid: string[] = []
): string | null {
  const own = ownCombat(hero);
  if (own.size === 0) return null;
  const mates = side.players.filter((p) => p !== hero);
  // 보조 유닛은 그 사람의 '한 방'이 될 수 없다(지적) — 남는 게 없으면 이 문장은 통째로 뺀다.
  const pool = [...own.entries()].filter(([u]) => UNIT_ROLE[u] && !SUPPORT_UNITS.has(u));
  const fresh = pool.filter(([u]) => !avoid.includes(u));
  const scored = (fresh.length > 0 ? fresh : pool)
    .map(([unit, n]) => {
      const byMates = mates.reduce((acc, m) => acc + (ownCombat(m).get(unit) ?? 0), 0);
      // 혼자 뽑은 유닛에 가중치 — 팀에서 이 사람만 낸 카드가 곧 그 사람의 이야기다.
      return { unit, score: n * (byMates === 0 ? 2 : 1) * (ROLE_WEIGHT[UNIT_ROLE[unit]] ?? 1) };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.unit ?? null;
}

/** 경기가 끝나기 한참 전에 커맨드가 끊긴 사람 — 그 시점에 졌거나 나간 것으로 읽는다. */
function earlyOuts(players: ParsedReplayPlayer[], totalFrames: number | null): ParsedReplayPlayer[] {
  if (!totalFrames) return [];
  return players.filter((p) => {
    if (sumCombat(p) === 0) return false; // 아무것도 안 한 슬롯은 "무너진" 게 아니다
    const fell = fellFrame(p, totalFrames);
    return fell !== null && fell < totalFrames * EARLY_OUT_RATIO;
  });
}

/** 그 프레임까지 뽑은 전투 유닛 수 — 훈련 커맨드의 시각으로 센다. */
function combatBefore(p: ParsedReplayPlayer, frame: number): number {
  const s = p.signals;
  if (!s) return 0;
  let n = 0;
  for (const [unit, frames] of Object.entries(s.unitFrames)) {
    if (NON_COMBAT_UNITS.has(unit)) continue;
    n += frames.filter((f) => f < frame).length;
  }
  return n;
}

/** "몇 명이 몰아쳤나"(요청) — 리플레이에 인구수가 없어 '죽었다'를 직접 볼 수는 없다.
 *  대신 커맨드가 끊긴 시점이 그 사람이 판에서 사라진 시점이고, 그때까지 병력을 낸 상대가
 *  몇 명인지는 셀 수 있다. 초반에 한 사람이 먼저 정리됐고 달려든 상대가 둘 이상일 때만
 *  말한다 — 한 명이면 그건 이미 전술 문장이 하고 있는 얘기다. */
function gangRush(
  victims: ParsedReplayPlayer[],
  attackers: ParsedReplayPlayer[],
  totalFrames: number | null
): { victim: ParsedReplayPlayer; by: ParsedReplayPlayer[] }[] {
  const out: { victim: ParsedReplayPlayer; by: ParsedReplayPlayer[] }[] = [];
  for (const v of victims) {
    const fell = fellFrame(v, totalFrames);
    if (fell === null || fell * SECONDS_PER_FRAME > GANG_RUSH_SEC) continue;
    const by = attackers.filter((a) => combatBefore(a, fell) >= GANG_MIN_UNITS);
    if (by.length >= 2) out.push({ victim: v, by });
  }
  return out;
}

/** 양쪽이 같은 짓을 했으면 한 문장으로 묶는다(요청: "누구와 누구가 서로 ~함").
 *  재료가 다르면 묶지 않는다 — 9드론과 12드론을 한 숫자로 말하면 한쪽이 거짓이 된다. */
function mergeMutual(list: Beat[]): Beat[] {
  const byKey = new Map<string, Beat[]>();
  for (const b of list) {
    const g = byKey.get(b.k);
    if (g) g.push(b); else byKey.set(b.k, [b]);
  }
  const out: Beat[] = [];
  for (const group of byKey.values()) {
    const w = group.find((b) => b.won);
    const l = group.find((b) => !b.won);
    if (!w || !l || JSON.stringify(w.p ?? {}) !== JSON.stringify(l.p ?? {})) {
      out.push(...group);
      continue;
    }
    const ats = [w.at, l.at].filter((x): x is number => x !== null && x !== undefined);
    const { whom: _whom, who2: _who2, ...rest } = w;
    out.push({
      ...rest,
      who: [...w.who, ...l.who],
      at: ats.length > 0 ? Math.min(...ats) : null,
      // 양쪽이 같은 수를 뒀다는 것 자체가 이야깃거리라 조금 무겁게 친다.
      weight: Math.max(w.weight, l.weight) + 2,
      p: { ...(w.p ?? {}), mutual: true },
    });
  }
  return out;
}

/** 이름을 아는 유닛만 남긴다 — 하나도 없으면 조합을 말할 수 없다. */
function nameableUnits(units: string[]): string[] {
  return units.filter((u) => UNIT_KO[u]);
}

function minutes(sec: number): number {
  return Math.round(sec / 60);
}

/** 고르는 동안의 후보 한 줄 = 저장될 beat + 고를 때만 쓰는 무게.
 *  고를 때는 무게순(재미있는 것부터), 이야기로 늘어놓을 때는 시간순이다. */
interface Beat extends ReplaySummaryBeat {
  weight: number;
  /** 이 말이 이미 다른 줄에 나왔으면 이 줄은 버린다 — "7해처리까지 늘려" 옆에 "해처리를
   *  7개까지 늘려"가 또 붙는 걸 막는다. 고를 때만 쓰고 저장하지는 않는다. */
  dedupeOn?: string;
}

// 승부를 가르는 테크만 이야기에 넣는다(요청: 중요한 이벤트만) — 버로우·환상처럼 있어도
// 그만인 연구는 자리만 차지한다. 이름은 TECH_KO에 있는 것 중에서 고른다.
const DECISIVE_TECHS = new Set([
  "Psionic Storm", "Lurker Aspect", "Dark Swarm", "Recall", "Yamato Gun", "Irradiate",
  "Lockdown", "Stasis Field", "Plague", "Mind Control", "Spider Mines", "Stim Packs",
  "Cloaking", "Personnel Cloaking",
]);

/** 확장 건물의 한국어 이름 — "멀티를 5개까지"가 아니라 "5해처리까지"로 말한다(요청). */

/** 고를 때만 쓰는 것들(무게·중복 판정)을 떼고 저장할 형태만 남긴다. */
function strip({ weight: _w, dedupeOn: _d, ...b }: Beat): ReplaySummaryBeat {
  return b;
}

/** 방어 건물의 한국어 이름 — "질럿과 성큰으로 막아섰지만 실패"처럼 유닛과 함께 말한다(요청). */

/** 한 사람이 그 종류 건물을 몇 채 지었나. */
function buildingsOf(p: ParsedReplayPlayer, names: Set<string>): number {
  const s = p.signals;
  if (!s) return 0;
  let n = 0;
  for (const [k, v] of Object.entries(s.buildingCounts)) if (names.has(k)) n += v;
  return n;
}

/** 그 종류 건물들의 건설 프레임을 시간순으로(기록된 앞부분만). */
function buildFramesOf(p: ParsedReplayPlayer, names: Set<string>): number[] {
  const s = p.signals;
  if (!s) return [];
  const out: number[] = [];
  for (const [k, arr] of Object.entries(s.buildingFrames)) if (names.has(k)) out.push(...arr);
  return out.sort((a, b) => a - b);
}

/** 포지를 게이트보다 먼저 올린 프로토스 — 그 포토는 방어가 아니라 캐논러시라는 신호다.
 *  이걸 "포토로 막아냄"이라고 하면 정반대로 읽힌다. */
function cannonIsRush(p: ParsedReplayPlayer): boolean {
  const s = p.signals;
  if (!s) return false;
  const forge = s.firstBuildingFrame["Forge"];
  const gate = s.firstBuildingFrame["Gateway"];
  return forge !== undefined && (gate === undefined || forge < gate);
}

/** 그 편에서 가장 많이 뽑은 '한 방' 유닛(없으면 undefined). */
function spectacleOf(side: Side): string | undefined {
  return [...side.combat.entries()]
    .filter(([u, n]) => SPECTACLE_UNITS[u] && n > 0)
    .sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** 한 편의 전황을 '줄'들로 만든다. 이긴 편/진 편 모두 같은 재료(주력 조합·확장·방어·테크·
 *  테크 전환 시점·먼저 끊긴 사람)를 쓰고, 진 편만 결말이 정해져 있어 "…했지만 …" 꼴로 맺는다.
 *
 *  모든 줄은 반드시 누가 한 일인지 이름을 달고 나온다(요청) — 예전엔 편 단위 사실을 주어
 *  없이 말해서("5멀티까지 늘린 운영") 여러 줄이 붙으면 누구 얘기인지 알 수 없었다. 편 전체의
 *  사실도 그 편에서 그걸 가장 많이 한 사람에게 붙여 이름을 만든다. */
function sideBeats(args: {
  side: Side;
  other: Side;
  players: ParsedReplayPlayer[];
  /** 이 편이 이겼나 — 같은 사실도 이긴 쪽이면 "굳힘", 진 쪽이면 "역부족"으로 맺는다. */
  won: boolean;
  sec: number;
  totalFrames: number | null;
  /** (진 편만) 초반 주도권을 잡았었나 — 커맨드 점유율 기준. */
  pressedEarly: boolean;
}): Beat[] {
  const { side, other, players, won, sec, totalFrames, pressedEarly } = args;
  const beats: Beat[] = [];
  if (players.length === 0) return beats;
  const who = (p: ParsedReplayPlayer) => [p.rawName];

  // ── 진 편의 머리 문장: 무엇으로 맞섰고 왜 안 됐나 ──
  // 시점은 그 편이 손을 놓은 때로 둔다 — 한 순간의 사건이 아니라 결말이라 맨 뒤에 놓여야 한다.
  if (!won) {
    const star = standout(side);
    const units = nameableUnits(
      star ? mainUnits({ ...side, combat: ownCombat(star) }) : mainUnits(side)
    );
    const lastFrames = players
      .map((p) => p.signals?.lastCmdFrame ?? null)
      .filter((f): f is number => f !== null);
    const at = lastFrames.length > 0 ? Math.max(...lastFrames) : totalFrames;
    const spectacle = spectacleOf(side);
    let p: Record<string, string | number | boolean | string[]> | null = null;
    if (spectacle) p = { mode: "spectacle", unit: spectacle };
    else if (pressedEarly && units.length > 0) p = { mode: "pressed", units };
    else if (units.length > 0) {
      p = { mode: units.some((u) => LATE_TECH_UNITS.has(u)) ? "late" : "plain", units };
    } else if (sec > 0 && sec < EARLY_GAME_SEC) {
      p = { mode: "nothing" };
    }
    if (p) {
      beats.push({
        k: "stand", won, at, weight: 12, p,
        who: star ? who(star) : players.map((x) => x.rawName),
      });
    }
  }

  // ── 유닛 + 방어 건물로 막아선 그림(요청: "질럿과 성큰으로 방어했지만 실패") ──
  for (const p of players) {
    const sg = p.signals;
    if (!sg) continue;
    const usable = Object.entries(sg.buildingCounts)
      .filter(([k]) => DEFENSE_KO[k])
      .filter(([k]) => !(k === "Photon Cannon" && cannonIsRush(p)));
    const def = usable.filter(([, n]) => n >= DEFENSE_MIN).sort((a, b) => b[1] - a[1])[0];
    if (!def) continue;
    const unit = [...ownCombat(p).entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!unit) continue;
    // 방어 건물 총합이 일정 수준을 넘으면 '막을 준비'가 아니라 웅크린 것이라, 그 자체가
    // 이야깃거리다(요청) — 문장에 개수를 싣고 무게도 올린다.
    const total = usable.reduce((acc, [, n]) => acc + n, 0);
    beats.push({
      k: "defense", won, who: who(p), weight: total >= TURTLE_MIN ? 10 : 7,
      at: sg.firstBuildingFrame[def[0]] ?? null,
      p: { unit, def: def[0], n: def[1], total },
      // 입구 방어(front-defense)가 이미 같은 건물을 말했으면 두 번 말하지 않는다.
      dedupeOn: DEFENSE_KO[def[0]],
    });
  }

  // ── 확장 운영 — 두 편 차이가 뚜렷할 때, 그 편에서 제일 많이 늘린 사람 이름으로 ──
  const sideExp = countIn(side.buildings, EXPANSION_BUILDINGS);
  const otherExp = countIn(other.buildings, EXPANSION_BUILDINGS);
  if (sideExp >= otherExp + 2 && sideExp >= 3) {
    const top = players
      .map((p) => ({ p, n: buildingsOf(p, EXPANSION_BUILDINGS) }))
      .sort((a, b) => b.n - a.n)[0];
    if (top && top.n >= 2) {
      // 그 사람이 실제로 올린 확장 건물 이름을 그대로 쓴다 — 저그면 해처리, 프로면 넥서스.
      const kind = Object.entries(top.p.signals?.buildingCounts ?? {})
        .filter(([k]) => EXPANSION_KO[k])
        .sort((a, b) => b[1] - a[1])[0]?.[0];
      if (kind) {
        const frames = buildFramesOf(top.p, EXPANSION_BUILDINGS);
        beats.push({
          k: "expand", won, who: who(top.p), weight: 8,
          at: frames[2] ?? frames[frames.length - 1] ?? null,
          p: { n: top.n, kind },
        });
      }
    }
  }

  // ── 테크 — 싸움을 뒤집는 것만. 사람마다 하나씩. ──
  for (const p of players) {
    const sg = p.signals;
    if (!sg) continue;
    const t = sg.techNames.find((x) => DECISIVE_TECHS.has(x));
    if (!t) continue;
    beats.push({
      k: "tech", won, who: who(p), weight: 6,
      at: sg.firstTechFrame[t] ?? null,
      p: { tech: t },
    });
  }

  // ── 일꾼을 거의 안 뽑고 병력만 짜낸 올인 — 그 편에서 가장 극단적인 사람 이름으로 ──
  const combatTotal = [...side.combat.values()].reduce((a, b) => a + b, 0);
  if (side.workers > 0 && combatTotal > side.workers * 4 && sec < LATE_GAME_SEC) {
    const top = players
      .map((p) => {
        const sg = p.signals;
        const w = sg ? Object.entries(sg.unitCounts).filter(([k]) => WORKER_UNITS.has(k))
          .reduce((acc, [, n]) => acc + n, 0) : 0;
        return { p, ratio: w > 0 ? sumCombat(p) / w : sumCombat(p) };
      })
      .sort((a, b) => b.ratio - a.ratio)[0];
    if (top) {
      beats.push({ k: "allin", won, who: who(top.p), at: null, weight: 6 });
    }
  }

  // ── 경제·규모 격차 — 승부의 밑바탕을 말해준다(요청). 편 단위 사실이라 그 편 전원의
  // 이름으로 말한다. 커맨드로 센 '뽑은 수'지 '살아남은 수'가 아니라는 한계는 그대로다.
  const everyone = players.map((p) => p.rawName);
  // 밀린 쪽에서만 말한다 — 양쪽이 다 말하면 같은 사실이 두 문장으로 나온다.
  if (side.workers >= 12 && other.workers >= side.workers * WORKER_GAP_RATIO) {
    beats.push({
      k: "worker-gap", won, who: everyone, at: null, weight: 8,
      p: { n: side.workers, foe: other.workers },
    });
  }
  // 생산 건물 규모 — 그 편이 가장 많이 늘린 종류 하나로 견준다.
  const prodTop = [...side.buildings.entries()]
    .filter(([k]) => PRODUCTION_KO[k])
    .sort((a, b) => b[1] - a[1])[0];
  if (prodTop && prodTop[1] >= 3) {
    const foeSame = other.buildings.get(prodTop[0]) ?? 0;
    const foeTop = Math.max(
      foeSame,
      ...[...other.buildings.entries()].filter(([k]) => PRODUCTION_KO[k]).map(([, n]) => n),
      0,
    );
    // 상대도 생산 건물을 세고 있어야 견줄 수 있다 — 종족이 달라 종류가 아예 없으면
    // "0개에 머문 상대"가 되어 사실과 다르게 읽힌다.
    if (foeTop >= 2 && (prodTop[1] >= foeTop + 3 || foeTop >= prodTop[1] + 3)) {
      beats.push({
        k: "prod-gap", won, who: everyone, at: null, weight: 6,
        dedupeOn: PRODUCTION_KO[prodTop[0]],
        p: { kind: prodTop[0], n: prodTop[1], foe: foeTop },
      });
    }
  }
  // 건물을 띄운 사람(테란) — 자리를 다 내줬다는 뜻이라 그 자체가 전황이다(요청).
  for (const p of players) {
    const n = p.signals?.liftOffCount ?? 0;
    if (n < LIFT_OFF_MIN) continue;
    beats.push({
      k: "lift-off", won, who: [p.rawName], weight: 9,
      at: p.signals?.firstLiftOffFrame ?? null,
      p: { n },
    });
  }

  // ── 먼저 끊긴 사람(요청: 일찍 죽은 사람) — 끊긴 시점이 곧 그 줄의 시각이다 ──
  for (const p of earlyOuts(players, totalFrames)) {
    beats.push({
      k: "fallen", won, who: who(p), weight: 9,
      at: fellFrame(p, totalFrames),
      p: { team: players.length > 1 },
    });
  }

  return beats;
}

/**
 * 경기 요약. 재료가 모자라면(커맨드 스트림 없음/승자 미확정/유닛 이름 못 읽음) null.
 * 돌려주는 건 문장이 아니라 저장할 데이터다 — 문장은 renderReplaySummary가 만든다.
 */
export function buildReplaySummary(replay: ParsedReplay): ReplaySummaryData | null {
  if (!replay.winnerSide) return null;
  const sec = replay.durationSeconds ?? 0;
  const totalFrames = sec > 0 ? Math.round(sec / SECONDS_PER_FRAME) : null;

  const winnerPlayers = replay.winnerSide === "team1" ? replay.team1 : replay.team2;
  const loserPlayers = replay.winnerSide === "team1" ? replay.team2 : replay.team1;
  if (winnerPlayers.length === 0) return null;

  const winner = buildSide(winnerPlayers);
  const loser = buildSide(loserPlayers);

  // 눈에 띄는 사람이 있으면 그 사람을 주어로 세우고 조합도 '그 사람의 것'으로 말한다
  // (요청: 팀전이라도 잘한 사람 얘기를 많이). 없으면 편 전체로 말한다.
  const star = standout(winner);
  const units = nameableUnits(
    star ? mainUnits({ ...winner, combat: ownCombat(star) }) : mainUnits(winner)
  );
  if (units.length === 0) return null; // 조합을 못 읽으면 이야기의 알맹이가 없다
  const subject = star ? [star.rawName] : winnerPlayers.map((p) => p.rawName);

  // ── 국면과 흐름 ──
  const wentLate = units.some((u) => LATE_TECH_UNITS.has(u)) || sec >= LATE_GAME_SEC;
  const wasRush = sec > 0 && sec < EARLY_GAME_SEC && units.every((u) => EARLY_RUSH_UNITS.has(u));
  const earlyTotal = winner.thirds[0] + loser.thirds[0];
  const lateTotal = winner.thirds[2] + loser.thirds[2];
  const earlyShare = earlyTotal > 0 ? winner.thirds[0] / earlyTotal : null;
  const lateShare = lateTotal > 0 ? winner.thirds[2] / lateTotal : null;
  const pressedEarly = earlyShare !== null && earlyTotal >= 40 && earlyShare < 0.42;
  const comeback = pressedEarly && lateShare !== null && lateTotal >= 40 && lateShare > 0.55;

  // ── 맺음말 머리 — 드문 사건이 있으면 그걸 앞세운다(경기마다 다른 문장이 나오도록).
  // 주력으로 이미 말할 유닛은 여기서 뺀다 — 안 그러면 "캐리어가 뜬 …캐리어로 승리"가 된다.
  const spectacle = [...winner.combat.keys()].find(
    (u) => SPECTACLE_UNITS[u] && (winner.combat.get(u) ?? 0) > 0 && !units.includes(u)
  );
  const lead =
    sec >= EPIC_GAME_SEC ? "epic" : spectacle ? "spectacle" : wasRush && sec > 0 ? "rush" : "";
  const mode = wasRush ? "rush" : comeback ? "comeback" : wentLate && !lead ? "late" : "plain";

  // 팀전이면 그 사람의 활약을 맺음말에 한 마디 덧붙인다(요청) — 1:1은 이미 맺음말이 그 사람
  // 얘기라 뺀다.
  const heroUnit =
    star && winnerPlayers.length > 1 ? heroUnitOf(winner, star, units) : null;

  // ── 문장 수 ──
  // 한 문단짜리 이야기라 길면 읽히지 않는다. 짧은 경기는 두어 문장, 길어도 다섯을 넘지
  // 않게 3분→2문장에서 5분마다 하나씩만 늘린다(요청).
  const budget = Math.max(2, Math.min(5, 2 + Math.floor((sec - 3 * 60) / (5 * 60))));
  // 자리가 남아도 아무거나 채우지 않는다(요청: 승부에 중요한 이벤트만) — 이 무게 아래는
  // "그래서 뭐" 소리가 나오는 사실들이라, 문단을 짧게 끝내는 편이 낫다.
  const MIN_WEIGHT = 6;

  // 전술(9드론 저글링 러시·몰래 배럭·목동 저그…)은 그 경기에서만 있었던 일이라 가장 무겁게
  // 친다 — 자리가 모자라면 일반적인 이야기부터 버려진다.
  const tacticBeats = (won: boolean): Beat[] =>
    scanTactics({
      sidePlayers: won ? winnerPlayers : loserPlayers,
      foePlayers: won ? loserPlayers : winnerPlayers,
    }).map((t) => ({
      k: t.key, won, who: [t.who], at: t.at, p: t.p, weight: t.weight + 10,
      ...(t.whom ? { whom: [t.whom] } : {}),
      ...(t.who2 ? { who2: [t.who2] } : {}),
    }));

  // "유비의 바이오닉 한 방으로 관우의 저글링 성큰을 뚫음" — 이긴 편의 주력이 진 편의 누구를
  // 어떻게 뚫었는지 한 문장에 담는다(요청). 양쪽을 따로 말하는 것보다 훨씬 경기처럼 읽힌다.
  const breached = (() => {
    for (const p of loserPlayers) {
      const sg = p.signals;
      if (!sg) continue;
      const def = Object.entries(sg.buildingCounts)
        .filter(([k, n]) => DEFENSE_KO[k] && n >= DEFENSE_MIN)
        .filter(([k]) => !(k === "Photon Cannon" && cannonIsRush(p)))
        .sort((a, b) => b[1] - a[1])[0];
      if (!def) continue;
      const unit = [...ownCombat(p).entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (!unit) continue;
      return {
        k: "breakthrough", won: true, who: subject, whom: [p.rawName], weight: 14,
        at: sg.firstBuildingFrame[def[0]] ?? null,
        p: { units, unit, def: def[0], n: def[1] },
      } as Beat;
    }
    return null;
  })();

  const tactics = [...tacticBeats(true), ...tacticBeats(false)];
  // 탱크 방어 문장이 "조조를 밀어냄"까지 말했으면 "조조가 먼저 정리됨"을 또 붙이지 않는다.
  // 여기서만 이름으로 거른다 — 렌더된 문장을 훑는 일반 dedupe는 이름이 우연히 겹치는
  // 다른 문장까지 지워버린다.
  const pickedOff = new Set(
    tactics.filter((b) => b.k === "side-tank").flatMap((b) => b.whom ?? [])
  );

  const gangBeats: Beat[] = [
    ...gangRush(earlyOuts(loserPlayers, totalFrames), winnerPlayers, totalFrames)
      .map((g) => ({ g, won: true })),
    ...gangRush(earlyOuts(winnerPlayers, totalFrames), loserPlayers, totalFrames)
      .map((g) => ({ g, won: false })),
  ].map(({ g, won }) => {
    pickedOff.add(g.victim.rawName);
    return {
      k: "gang-rush", won, who: g.by.map((p) => p.rawName), whom: [g.victim.rawName],
      at: fellFrame(g.victim, totalFrames), weight: 13, p: { n: g.by.length },
    } as Beat;
  });

  const pool: Beat[] = [
    ...(breached ? [breached] : []),
    ...gangBeats,
    ...mergeMutual(tactics),
    ...sideBeats({
      side: winner, other: loser, players: winnerPlayers,
      won: true, sec, totalFrames, pressedEarly: false,
    }),
    ...sideBeats({
      side: loser, other: winner, players: loserPlayers,
      won: false, sec, totalFrames, pressedEarly,
    }).filter((b) => !(breached && b.k === "defense")),
  ].filter((b) => !(b.k === "fallen" && b.who.some((w) => pickedOff.has(w))));

  // 고를 때는 무게순(재미있는 것부터), 이야기로 늘어놓을 때는 시간순 — 순서를 이 둘로 나눠야
  // "자리가 모자라 재미없는 걸 남기는" 일도, "중요한 게 뜬금없는 자리에 오는" 일도 없다.
  // 시점을 못 잡은 문장(올인처럼 한 순간이 아닌 것)은 맺음말 바로 앞으로 밀린다.
  const chosen: Beat[] = [];
  for (const b of [...pool].sort((x, y) => y.weight - x.weight)) {
    if (chosen.length >= budget - 1) break;
    if (b.weight < MIN_WEIGHT) break; // 무게순이라 하나 미달이면 뒤는 전부 미달이다
    if (b.dedupeOn && chosen.some((x) => renderReplaySummary(
      { v: REPLAY_SUMMARY_VERSION, beats: [strip(x)] }, (raw) => raw,
    )?.includes(b.dedupeOn!))) continue;
    chosen.push(b);
  }
  chosen.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));

  // 결과는 이야기의 맺음말로 맨 뒤에 붙인다 — 앞에 먼저 요약을 놓으면 뒤의 이야기가
  // 이미 아는 결말의 부연이 되어버린다(요청: 맨 처음의 전체 요약은 빼기).
  // 앞선 문장들이 이미 그 조합을 말했으면 조합은 빼고 결과만 말한다. 판단은 실제로 만들어질
  // 문장을 보고 한다 — beat의 재료만 봐서는 "9드론 저글링 러시"가 저글링을 이미 말했다는 걸
  // 알 수 없고, 전술마다 어떤 유닛을 언급하는지 목록을 따로 들고 있으면 문구를 고칠 때마다
  // 같이 고쳐야 한다. 이름은 결과에 안 쓰이므로 아무 값이나 넘겨도 된다.
  const told = renderReplaySummary(
    { v: REPLAY_SUMMARY_VERSION, beats: chosen.map(strip) },
    (raw) => raw
  ) ?? "";
  const alreadySaid = units.every((u) => told.includes(UNIT_KO[u]));
  const ending: Beat = {
    k: "result", won: true, who: subject, at: Number.POSITIVE_INFINITY, weight: 1000,
    p: {
      mode, lead, wentLate,
      leadMin: minutes(sec),
      ...(spectacle ? { leadUnit: spectacle } : {}),
      ...(alreadySaid ? {} : { units }),
      ...(heroUnit ? { heroUnit } : {}),
    },
    ...(heroUnit && star ? { who2: [star.rawName] } : {}),
  };

  return { v: REPLAY_SUMMARY_VERSION, beats: [...chosen, ending].map(strip) };
}
