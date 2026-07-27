import type { ParsedReplay, ParsedReplayPlayer, ReplayPlayerSignals } from "./replayParser";

// 리플레이에서 뽑은 재료로 경기 요약 문장을 만든다(요청).
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

// screp 영문명 → 한국어 통용 표기. 여기 없는 유닛은 문장에 쓰지 않는다 — 영문명을 그대로
// 노출하면 어색하고, UMS 맵의 영웅 유닛까지 새어 나온다.
const UNIT_KO: Record<string, string> = {
  Marine: "마린", Firebat: "파이어뱃", Medic: "메딕", Ghost: "고스트",
  Vulture: "벌처", Goliath: "골리앗",
  "Siege Tank (Tank Mode)": "탱크", "Siege Tank (Siege Mode)": "탱크",
  Wraith: "레이스", Dropship: "드랍십", "Science Vessel": "사이언스베슬",
  Battlecruiser: "배틀크루저", Valkyrie: "발키리", "Nuclear Missile": "핵",
  Zealot: "질럿", Dragoon: "드라군", "High Templar": "하이템플러",
  "Dark Templar": "다크템플러", Archon: "아콘", "Dark Archon": "다크아콘",
  Reaver: "리버", Shuttle: "셔틀", Observer: "옵저버", Scout: "스카웃",
  Corsair: "커세어", Carrier: "캐리어", Arbiter: "아비터",
  Zergling: "저글링", Hydralisk: "히드라", Lurker: "러커", Ultralisk: "울트라",
  Mutalisk: "뮤탈", Scourge: "스커지", Guardian: "가디언", Devourer: "디바우러",
  Queen: "퀸", Defiler: "디파일러", "Infested Terran": "감염된 테란",
};

// 등장만으로도 이야깃거리가 되는 '한 방' 유닛 — 있으면 문장 맨 앞에 세운다.
const SPECTACLE_UNITS: Record<string, string> = {
  "Nuclear Missile": "핵까지 등장한",
  Battlecruiser: "배틀크루저가 뜬",
  Carrier: "캐리어가 뜬",
  Guardian: "가디언이 뜬",
  Ultralisk: "울트라가 나온",
  Arbiter: "아비터까지 간",
  "Dark Archon": "다크아콘이 나온",
};

// 후반 테크로 볼 유닛 / 초반 러시로 볼 유닛.
const LATE_TECH_UNITS = new Set([
  "Carrier", "Arbiter", "Battlecruiser", "Science Vessel", "Valkyrie",
  "Ultralisk", "Defiler", "Guardian", "Devourer", "Archon", "Dark Archon", "Reaver",
]);
const EARLY_RUSH_UNITS = new Set(["Zergling", "Marine", "Zealot", "Hydralisk", "Vulture"]);

// 확장(멀티) 건물 — 이걸 몇 개 지었나로 운영/올인을 가른다.
const EXPANSION_BUILDINGS = new Set(["Nexus", "Hatchery", "Command Center"]);
// 방어 건물 — 많으면 "웅크린" 그림이다.
const DEFENSE_BUILDINGS = new Set([
  "Photon Cannon", "Missile Turret", "Bunker", "Sunken Colony", "Spore Colony",
]);
// 드랍 수송선 — 있으면 견제 이야기를 붙일 만하다.
const DROP_UNITS = new Set(["Dropship", "Shuttle"]);

// 유닛이 경기에서 하는 '역할' — 같은 승리라도 무엇으로 이겼는지에 따라 다르게 읽히도록
// (요청: 팀전이라도 잘한 사람이 있으면 그 사람 얘기를 많이 — "하이템플러 견제로 승기를 잡음").
const UNIT_ROLE: Record<string, string> = {
  "High Templar": "견제", "Dark Templar": "견제", Reaver: "견제", Mutalisk: "견제",
  Vulture: "견제", Dropship: "드랍", Shuttle: "드랍", Lurker: "매복", Ghost: "저격",
  Defiler: "마법", "Science Vessel": "마법", Arbiter: "마법", "Dark Archon": "마법", Queen: "마법",
  Carrier: "공중 장악", Battlecruiser: "공중 장악", Guardian: "공중 장악",
  Wraith: "공중 견제", Valkyrie: "제공권", Corsair: "제공권", Scourge: "제공권", Devourer: "제공권",
  Ultralisk: "돌파", Archon: "돌파", Zealot: "돌파", Firebat: "돌파",
  "Siege Tank (Tank Mode)": "자리 잡기", "Siege Tank (Siege Mode)": "자리 잡기",
  Zergling: "물량", Hydralisk: "물량", Marine: "물량", Dragoon: "물량", Goliath: "물량",
  Medic: "물량", Scout: "공중 견제", "Infested Terran": "자폭",
};
// 역할별 맺음말 — 뜻에 맞춰 갈라 두면 같은 문장이 반복되지 않는다.
const ROLE_TAIL: Record<string, string> = {
  견제: "승기를 잡음", "공중 견제": "승기를 잡음", 매복: "승기를 잡음", 저격: "승기를 잡음",
  드랍: "흔들어 놓음", 마법: "판을 갈랐음", 자폭: "판을 갈랐음",
  "공중 장악": "굳히기", 제공권: "굳히기", 돌파: "굳히기",
  물량: "밀어붙임", "자리 잡기": "밀어붙임",
};

const TECH_KO: Record<string, string> = {
  "Psionic Storm": "스톰", "Stim Packs": "스팀팩", Lockdown: "락다운",
  "Spider Mines": "마인", "Lurker Aspect": "럴커", Burrowing: "버로우",
  Irradiate: "이레디에이트", "Yamato Gun": "야마토", Recall: "리콜",
  "Stasis Field": "스테이시스", Consume: "컨슘", "Dark Swarm": "다크스웜",
  Plague: "플레이그", Hallucination: "환상", "Mind Control": "마인드컨트롤",
  Cloaking: "클로킹", "Personnel Cloaking": "클로킹",
};

// 국면 경계(초). 클럽 경기 길이 분포에 맞춘 어림값이다.
const EARLY_GAME_SEC = 7 * 60;
const LATE_GAME_SEC = 18 * 60;
const EPIC_GAME_SEC = 30 * 60;

// 마지막 커맨드가 경기 끝보다 이만큼(비율) 앞서면 "일찍 무너졌다"로 본다.
const EARLY_OUT_RATIO = 0.7;

export interface ReplaySummaryInput {
  replay: ParsedReplay;
  /** 리플레이 원본 이름 → 화면에 쓸 이름(회원 닉네임). 매칭이 안 됐으면 원본 이름 그대로. */
  displayName: (rawName: string) => string;
}

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

// ── 한글 조사 ──
// 앞 글자의 받침 유무로 갈린다. (한글 음절 코드 = 0xAC00 + (초성*21 + 중성)*28 + 종성)
function jongseong(word: string): number | null {
  const ch = word.charCodeAt(word.length - 1);
  if (Number.isNaN(ch) || ch < 0xac00 || ch > 0xd7a3) return null; // 한글이 아니면 판단 불가
  return (ch - 0xac00) % 28;
}
/** ~로 / ~으로 (받침이 없거나 ㄹ이면 "로"). */
function ro(w: string): string {
  const j = jongseong(w);
  return j === null || j === 0 || j === 8 ? `${w}로` : `${w}으로`;
}
/** ~와 / ~과 */
function wa(w: string): string {
  const j = jongseong(w);
  return j === null || j === 0 ? `${w}와` : `${w}과`;
}
/** ~가 / ~이 */
function ga(w: string): string {
  const j = jongseong(w);
  return j === null || j === 0 ? `${w}가` : `${w}이`;
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
    for (const t of s.techNames) if (TECH_KO[t]) techs.add(t);
    s.cmdCountByThird.forEach((n, i) => { thirds[i] += n; });
  }
  return { players, combat, buildings, workers, thirds, techs };
}

function countIn(map: Map<string, number>, names: Set<string>): number {
  let n = 0;
  for (const [k, v] of map) if (names.has(k)) n += v;
  return n;
}

/** 그 편의 주력 — 가장 많이 뽑은 전투 유닛 최대 두 종류(2위가 1위에 한참 못 미치면 하나만). */
function mainUnits(side: Side): string[] {
  const ranked = [...side.combat.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return [];
  const [top, second] = ranked;
  const out = [top[0]];
  if (second && second[1] >= top[1] * 0.35) out.push(second[0]);
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

/** "○○의 하이템플러 견제로 승기를 잡음" — 그 사람을 특징짓는 유닛 하나를 골라 말한다.
 *  팀 동료가 거의 안 뽑은 유닛일수록 그 사람의 몫이 뚜렷하므로 우선한다. */
function heroClause(side: Side, hero: ParsedReplayPlayer, name: string): string | null {
  const own = ownCombat(hero);
  if (own.size === 0) return null;
  const mates = side.players.filter((p) => p !== hero);
  const scored = [...own.entries()]
    .filter(([u]) => UNIT_ROLE[u])
    .map(([unit, n]) => {
      const byMates = mates.reduce((acc, m) => acc + (ownCombat(m).get(unit) ?? 0), 0);
      // 혼자 뽑은 유닛에 가중치 — 팀에서 이 사람만 낸 카드가 곧 그 사람의 이야기다.
      return { unit, score: n * (byMates === 0 ? 2 : 1) };
    })
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top) return null;
  const role = UNIT_ROLE[top.unit];
  const tail = ROLE_TAIL[role] ?? "승기를 잡음";
  return `${name}의 ${ro(`${UNIT_KO[top.unit]} ${role}`)} ${tail}`;
}

/** 경기가 끝나기 한참 전에 커맨드가 끊긴 사람 — 그 시점에 졌거나 나간 것으로 읽는다. */
function earlyOuts(players: ParsedReplayPlayer[], totalFrames: number | null): ParsedReplayPlayer[] {
  if (!totalFrames) return [];
  return players.filter((p) => {
    const s = p.signals;
    if (!s || s.lastCmdFrame === null) return false;
    if (sumCombat(p) === 0) return false; // 아무것도 안 한 슬롯은 "무너진" 게 아니다
    return s.lastCmdFrame < totalFrames * EARLY_OUT_RATIO;
  });
}

function unitPhrase(units: string[]): string {
  const ko = units.map((u) => UNIT_KO[u]).filter(Boolean);
  if (ko.length === 0) return "";
  if (ko.length === 1) return ro(ko[0]);
  return `${wa(ko[0])} ${ko[1]} 조합으로`;
}

function minutes(sec: number): number {
  return Math.round(sec / 60);
}

/**
 * 경기 요약 문장. 재료가 모자라면(커맨드 스트림 없음/승자 미확정/유닛 이름 못 읽음) null.
 */
export function buildReplaySummary({ replay, displayName }: ReplaySummaryInput): string | null {
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
  const units = star
    ? mainUnits({ ...winner, combat: ownCombat(star) })
    : mainUnits(winner);
  const phrase = unitPhrase(units);
  if (!phrase) return null; // 조합을 못 읽으면 문장의 알맹이가 없다

  const subject = star
    ? displayName(star.rawName)
    : winnerPlayers.map((p) => displayName(p.rawName)).join("·");

  // ── 국면과 흐름 ──
  const wentLate = units.some((u) => LATE_TECH_UNITS.has(u)) || sec >= LATE_GAME_SEC;
  const wasRush = sec > 0 && sec < EARLY_GAME_SEC && units.every((u) => EARLY_RUSH_UNITS.has(u));
  const earlyTotal = winner.thirds[0] + loser.thirds[0];
  const lateTotal = winner.thirds[2] + loser.thirds[2];
  const earlyShare = earlyTotal > 0 ? winner.thirds[0] / earlyTotal : null;
  const lateShare = lateTotal > 0 ? winner.thirds[2] / lateTotal : null;
  const comeback =
    earlyShare !== null && lateShare !== null &&
    earlyTotal >= 40 && lateTotal >= 40 && earlyShare < 0.42 && lateShare > 0.55;

  // ── 머리말: 드문 사건이 있으면 그걸 먼저 말한다(경기마다 다른 문장이 나오도록) ──
  const lead: string[] = [];
  const spectacle = units
    .concat([...winner.combat.keys()])
    .find((u) => SPECTACLE_UNITS[u] && (winner.combat.get(u) ?? 0) > 0);
  if (sec >= EPIC_GAME_SEC) lead.push(`${minutes(sec)}분 혈투 끝에`);
  else if (spectacle) lead.push(SPECTACLE_UNITS[spectacle]);
  else if (wasRush && sec > 0) lead.push(`${minutes(sec)}분 만에`);

  // ── 본문 ──
  let body: string;
  const who = ga(subject);
  if (wasRush) body = `${who} 초반 ${phrase} 승리`;
  else if (comeback) body = `${who} 초반 열세이다가 ${wentLate ? "후반에 " : ""}${phrase} 역전`;
  else if (wentLate && lead.length === 0) body = `${who} 후반 ${phrase} 승리`;
  else body = `${who} ${phrase} 승리`;

  // ── 덧붙임: 활약/운영/견제/테크/탈락 중 눈에 띄는 것 한둘 ──
  const tails: string[] = [];

  // 팀전이면 그 사람의 활약을 한 줄 더 말한다(요청) — 1:1은 이미 본문이 그 사람 얘기라 뺀다.
  if (star && winnerPlayers.length > 1) {
    const hero = heroClause(winner, star, displayName(star.rawName));
    if (hero) tails.push(hero);
  }

  // 확장 수 — 두 편 차이가 뚜렷할 때만 말한다(둘 다 3확장이면 이야깃거리가 아니다).
  const winExp = countIn(winner.buildings, EXPANSION_BUILDINGS);
  const loseExp = countIn(loser.buildings, EXPANSION_BUILDINGS);
  if (winExp >= loseExp + 2 && winExp >= 3) tails.push(`${winExp}멀티까지 늘린 운영`);
  else if (loseExp >= winExp + 2 && sec > 0 && sec < LATE_GAME_SEC) tails.push("한 방에 무너진 확장");

  // 웅크린 그림 / 견제 / 테크.
  if (countIn(loser.buildings, DEFENSE_BUILDINGS) >= 6) tails.push("상대는 방어 건물로 버팀");
  if (countIn(winner.combat, DROP_UNITS) >= 2) tails.push("드랍 견제도 곁들임");
  const tech = [...winner.techs][0];
  if (tech && tails.length < 2) tails.push(`${TECH_KO[tech]}까지 씀`);

  // 일꾼을 거의 안 뽑고 병력만 짜낸 올인.
  const winCombatTotal = [...winner.combat.values()].reduce((a, b) => a + b, 0);
  if (winner.workers > 0 && winCombatTotal > winner.workers * 4 && sec < LATE_GAME_SEC) {
    tails.push("일꾼을 거의 안 뽑은 올인");
  }

  // 진 편에서 먼저 끊긴 사람(요청: 일찍 죽은 사람 표현) — 팀전에서만 의미가 있다.
  const fallen = earlyOuts(loserPlayers, totalFrames);
  if (fallen.length > 0 && loserPlayers.length > 1) {
    tails.push(`${ga(fallen.map((p) => displayName(p.rawName)).join("·"))} 일찍 무너짐`);
  }

  const head = lead.length > 0 ? `${lead[0]} ` : "";
  // 덧붙임은 최대 두 개까지 — 더 붙이면 문장이 아니라 목록이 된다.
  return [head + body, ...tails.slice(0, 2)].join(", ");
}
