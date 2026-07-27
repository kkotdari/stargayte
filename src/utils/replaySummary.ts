import { ga, neun, ro, wa } from "./korean";
import type { ParsedReplay, ParsedReplayPlayer, ReplayPlayerSignals } from "./replayParser";
import { scanTactics } from "./replayTactics";

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
// 방어 건물·드랍 수송선 이야기는 이제 각각 "질럿과 성큰으로 막아섰지만 실패"(아래
// DEFENSE_KO)와 전술 층(replayTactics의 드랍십/셔틀)이 맡는다 — 여기 목록은 없앴다.

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
// 활약을 고를 때 역할에 매기는 가중치. 질럿 40기와 하이템플러 25기 중 이야깃거리는 뒤쪽인데
// (요청 예시: "하이템플러 견제로 승기를 잡음") 개수만 보면 앞쪽이 이긴다 — 기본 병력은 낮추고
// 판을 가르는 역할은 올려서, '많이 뽑은 유닛'이 아니라 '그 사람다운 유닛'이 뽑히게 한다.
const ROLE_WEIGHT: Record<string, number> = {
  견제: 2, 마법: 2, 매복: 1.8, 저격: 1.8, "공중 견제": 1.8, 드랍: 1.6, 자폭: 1.6,
  "공중 장악": 1.5, 제공권: 1.3, 돌파: 1, "자리 잡기": 0.7, 물량: 0.5,
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
 *  팀 동료가 거의 안 뽑은 유닛일수록 그 사람의 몫이 뚜렷하므로 우선한다.
 *  avoid는 본문이 이미 말한 유닛 — "저글링으로 역전, 저글링 물량으로 밀어붙임"처럼 같은
 *  단어를 두 번 쓰지 않기 위해 뺀다. 다 빼서 남는 게 없으면 그냥 원래대로 고른다. */
function heroClause(
  side: Side,
  hero: ParsedReplayPlayer,
  name: string,
  avoid: string[] = []
): string | null {
  const own = ownCombat(hero);
  if (own.size === 0) return null;
  const mates = side.players.filter((p) => p !== hero);
  const pool = [...own.entries()].filter(([u]) => UNIT_ROLE[u]);
  const fresh = pool.filter(([u]) => !avoid.includes(u));
  const scored = (fresh.length > 0 ? fresh : pool)
    .map(([unit, n]) => {
      const byMates = mates.reduce((acc, m) => acc + (ownCombat(m).get(unit) ?? 0), 0);
      // 혼자 뽑은 유닛에 가중치 — 팀에서 이 사람만 낸 카드가 곧 그 사람의 이야기다.
      return { unit, score: n * (byMates === 0 ? 2 : 1) * (ROLE_WEIGHT[UNIT_ROLE[unit]] ?? 1) };
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

/** 요약을 이루는 한 줄. 시점(at)이 있으면 "N분 · …"으로 앞에 분을 붙이고 시간순으로 놓는다.
 *  weight는 자리가 모자랄 때 무엇부터 버릴지의 기준 — 고를 때는 무게순, 놓을 때는 시간순이다. */
interface Beat {
  at: number | null;
  weight: number;
  text: string;
  /** 이 말이 이미 다른 줄에 나왔으면 이 줄은 버린다 — "아비터 리콜로 파고듦" 바로 옆에
   *  "첫 아비터를 뽑음"이 붙는 식의 겹침을 막는다. 무게가 큰 줄이 먼저 자리를 잡는다. */
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
const EXPANSION_KO: Record<string, string> = {
  Hatchery: "해처리", Nexus: "넥서스", "Command Center": "커맨드",
};

/** 방어 건물의 한국어 이름 — "질럿과 성큰으로 막아섰지만 실패"처럼 유닛과 함께 말한다(요청). */
const DEFENSE_KO: Record<string, string> = {
  "Sunken Colony": "성큰", "Spore Colony": "스포어",
  Bunker: "벙커", "Missile Turret": "터렛", "Photon Cannon": "포토",
};

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
  displayName: (rawName: string) => string;
  /** 이 편이 이겼나 — 같은 사실도 이긴 쪽이면 "굳힘", 진 쪽이면 "역부족"으로 맺는다. */
  won: boolean;
  sec: number;
  totalFrames: number | null;
  /** (진 편만) 초반 주도권을 잡았었나 — 커맨드 점유율 기준. */
  pressedEarly: boolean;
}): Beat[] {
  const { side, other, players, displayName, won, sec, totalFrames, pressedEarly } = args;
  const beats: Beat[] = [];
  if (players.length === 0) return beats;
  const nameOf = (p: ParsedReplayPlayer) => displayName(p.rawName);

  // ── 진 편의 머리 문장: 무엇으로 맞섰고 왜 안 됐나 ──
  // 시점은 그 편이 손을 놓은 때로 둔다 — 한 순간의 사건이 아니라 결말이라 맨 뒤에 놓여야 한다.
  if (!won) {
    const star = standout(side);
    const name = star ? nameOf(star) : players.map(nameOf).join("·");
    const units = star ? mainUnits({ ...side, combat: ownCombat(star) }) : mainUnits(side);
    const phrase = unitPhrase(units);
    const lastFrames = players
      .map((p) => p.signals?.lastCmdFrame ?? null)
      .filter((f): f is number => f !== null);
    const at = lastFrames.length > 0 ? Math.max(...lastFrames) : totalFrames;
    const spectacle = spectacleOf(side);
    let text: string | null = null;
    if (spectacle) text = `${neun(name)} ${UNIT_KO[spectacle]}까지 꺼냈지만 판을 뒤집지 못함`;
    else if (pressedEarly && phrase) text = `${neun(name)} 초반을 잡고 흔들었지만 ${phrase} 굳히지 못함`;
    else if (phrase) {
      text = units.some((u) => LATE_TECH_UNITS.has(u))
        ? `${neun(name)} ${phrase} 후반을 노렸지만 역부족`
        : `${neun(name)} ${phrase} 맞섰지만 역부족`;
    } else if (sec > 0 && sec < EARLY_GAME_SEC) {
      text = `${neun(name)} 제대로 싸워보지 못하고 무너짐`;
    }
    if (text) beats.push({ at, weight: 12, text });
  }

  // ── 유닛 + 방어 건물로 막아선 그림(요청: "질럿과 성큰으로 방어했지만 실패") ──
  for (const p of players) {
    const sg = p.signals;
    if (!sg) continue;
    const def = Object.entries(sg.buildingCounts)
      .filter(([k, n]) => DEFENSE_KO[k] && n >= 3)
      .filter(([k]) => !(k === "Photon Cannon" && cannonIsRush(p)))
      .sort((a, b) => b[1] - a[1])[0];
    if (!def) continue;
    const unit = [...ownCombat(p).entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!unit) continue;
    const with_ = `${wa(UNIT_KO[unit])} ${DEFENSE_KO[def[0]]}`;
    beats.push({
      at: sg.firstBuildingFrame[def[0]] ?? null,
      weight: 7,
      text: won
        ? `${ga(nameOf(p))} ${ro(with_)} 막아냄`
        : `${ga(nameOf(p))} ${ro(with_)} 막아섰지만 실패`,
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
        const label = `${top.n}${EXPANSION_KO[kind]}`;
        beats.push({
          at: frames[2] ?? frames[frames.length - 1] ?? null,
          weight: 6,
          text: won
            ? `${ga(nameOf(top.p))} ${label}까지 늘려 판을 벌림`
            : `${ga(nameOf(top.p))} ${label}까지 늘렸지만 병력에서 밀림`,
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
      at: sg.firstTechFrame[t] ?? null,
      weight: 6,
      text: won
        ? `${ga(nameOf(p))} ${TECH_KO[t]}까지 꺼내 씀`
        : `${ga(nameOf(p))} ${TECH_KO[t]}까지 썼지만 흐름을 되돌리지 못함`,
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
      beats.push({
        at: null,
        weight: 6,
        text: `${ga(nameOf(top.p))} 일꾼을 거의 안 뽑고 병력만 짜낸 올인`,
      });
    }
  }

  // ── 먼저 끊긴 사람(요청: 일찍 죽은 사람) — 끊긴 시점이 곧 그 줄의 시각이다 ──
  for (const p of earlyOuts(players, totalFrames)) {
    beats.push({
      at: p.signals?.lastCmdFrame ?? null,
      weight: 9,
      text: players.length > 1
        ? `${ga(nameOf(p))} 먼저 무너지며 전열이 갈림`
        : `${ga(nameOf(p))} 일찍 손을 놓음`,
    });
  }

  return beats;
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
  const pressedEarly = earlyShare !== null && earlyTotal >= 40 && earlyShare < 0.42;
  const comeback =
    pressedEarly && lateShare !== null && lateTotal >= 40 && lateShare > 0.55;

  // ── 머리말: 드문 사건이 있으면 그걸 먼저 말한다(경기마다 다른 문장이 나오도록) ──
  // 주력으로 이미 말할 유닛은 머리말에서 뺀다 — 안 그러면 "캐리어가 뜬 조조가 캐리어로 승리"
  // 처럼 같은 말을 두 번 한다.
  const lead: string[] = [];
  const spectacle = [...winner.combat.keys()].find(
    (u) => SPECTACLE_UNITS[u] && (winner.combat.get(u) ?? 0) > 0 && !units.includes(u)
  );
  if (sec >= EPIC_GAME_SEC) lead.push(`${minutes(sec)}분 혈투 끝에`);
  else if (spectacle) lead.push(SPECTACLE_UNITS[spectacle]);
  else if (wasRush && sec > 0) lead.push(`${minutes(sec)}분 만에`);

  // ── 맺음말 본문 ──
  // 앞선 문장들이 이미 그 조합을 말했으면 조합은 빼고 결과만 말한다 — 두 문장짜리 요약에서
  // "저글링 러시로 몰아침. 저글링으로 승리"처럼 같은 단어가 붙어 나오는 걸 막는다.
  const who = ga(subject);
  const bodyOf = (withPhrase: boolean): string => {
    const p = withPhrase ? `${phrase} ` : "";
    // 조합을 빼면 "초반 승리"처럼 앙상해지므로, 그럴 땐 수식도 같이 정리한다.
    if (wasRush) return withPhrase ? `${who} 초반 ${p}승리` : `${who} 승리`;
    if (comeback) return `${who} 초반 열세이다가 ${wentLate ? "후반에 " : ""}${p}역전`;
    if (wentLate && lead.length === 0) return `${who} 후반 ${p}승리`;
    return withPhrase ? `${who} ${p}승리` : `${who} 그대로 승리`;
  };

  // 팀전이면 그 사람의 활약을 본문에 한 마디 덧붙인다(요청) — 1:1은 이미 본문이 그 사람
  // 얘기라 뺀다. 이건 첫 문장 안의 쉼표 절이고, 아래 문장들과는 별개다.
  const hero =
    star && winnerPlayers.length > 1
      ? heroClause(winner, star, displayName(star.rawName), units)
      : null;

  const head = lead.length > 0 ? `${lead[0]} ` : "";

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
      displayName,
    }).map((t) => ({ at: t.at, weight: t.weight + 10, text: won ? t.won : t.lost }));

  const pool: Beat[] = [
    ...tacticBeats(true),
    ...tacticBeats(false),
    ...sideBeats({
      side: winner, other: loser, players: winnerPlayers, displayName,
      won: true, sec, totalFrames, pressedEarly: false,
    }),
    ...sideBeats({
      side: loser, other: winner, players: loserPlayers, displayName,
      won: false, sec, totalFrames, pressedEarly,
    }),
  ];

  // 고를 때는 무게순(재미있는 것부터), 이야기로 늘어놓을 때는 시간순 — 순서를 이 둘로 나눠야
  // "자리가 모자라 재미없는 걸 남기는" 일도, "중요한 게 뜬금없는 자리에 오는" 일도 없다.
  // 시점을 못 잡은 문장(올인처럼 한 순간이 아닌 것)은 맺음말 바로 앞으로 밀린다.
  const chosen: Beat[] = [];
  for (const b of [...pool].sort((x, y) => y.weight - x.weight)) {
    if (chosen.length >= budget - 1) break;
    if (b.weight < MIN_WEIGHT) break; // 무게순이라 하나 미달이면 뒤는 전부 미달이다
    if (b.dedupeOn && chosen.some((c) => c.text.includes(b.dedupeOn!))) continue;
    chosen.push(b);
  }
  chosen.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));

  // 결과는 이야기의 맺음말로 맨 뒤에 붙인다 — 앞에 먼저 요약을 놓으면 뒤의 이야기가
  // 이미 아는 결말의 부연이 되어버린다(요청: 맨 처음의 전체 요약은 빼기).
  const told = chosen.map((b) => b.text).join(" ");
  const koUnits = units.map((u) => UNIT_KO[u]).filter(Boolean);
  const alreadySaid = koUnits.length > 0 && koUnits.every((k) => told.includes(k));
  const ending = [head + bodyOf(!alreadySaid), ...(hero ? [hero] : [])].join(", ");

  return [...chosen.map((b) => b.text), ending].join(". ");
}
