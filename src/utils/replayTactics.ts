import type { BuildPos, ParsedReplayPlayer, ReplayPlayerSignals } from "./replayParser";

// 리플레이 커맨드 스트림에서 '전술'을 짚어낸다(요청: 9드론 저글링 러시 / 투게이트 질럿 /
// 초반 포토 러시 / 몰래 배럭 / 목동 저그 / 바이오닉 / 발키리 오버로드 사냥 / 아비터 리콜 /
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
  /** 문장 틀에 꽂히는 값(드론 수·게이트 수 등). 없으면 생략. */
  p?: Record<string, string | number | boolean>;
}

/** 건물을 지은 자리가 내 본진인지, 가운데인지, 상대 쪽인지. */
type Zone = "home" | "mid" | "enemy";

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

// 본진을 믿고 쓰려면 건물이 이만큼은 있어야 한다 — 두 채뿐이면 어느 쪽이 본진인지 모른다.
const MIN_BUILDINGS_FOR_HOME = 4;
// 내 본진 ↔ 가장 가까운 상대 본진 거리를 1로 뒀을 때의 경계.
const HOME_RADIUS = 0.33;
const ENEMY_RADIUS = 0.35;

/** 이 사람의 건물 좌표를 구역으로 바꿔 주는 함수. 좌표를 못 읽었거나(screp이 Pos를 안 줌)
 *  본진을 못 정하면 null — 자리 기반 전술(몰래 배럭·센터 포토)은 그냥 안 나온다. */
function zoneResolver(
  me: ParsedReplayPlayer,
  foes: ParsedReplayPlayer[]
): ((b: BuildPos) => Zone) | null {
  const mine = me.signals?.buildPositions ?? [];
  if (mine.length < MIN_BUILDINGS_FOR_HOME) return null;
  const home = medoid(mine);
  if (!home) return null;
  const foeHomes = foes
    .map((f) => {
      const pts = f.signals?.buildPositions ?? [];
      return pts.length >= MIN_BUILDINGS_FOR_HOME ? medoid(pts) : null;
    })
    .filter((h): h is { x: number; y: number } => h !== null);
  if (foeHomes.length === 0) return null;
  // 기준 거리는 '가장 가까운 상대까지' — 팀전에서 멀리 있는 상대까지 재면 구역이 다 뭉개진다.
  const base = Math.min(...foeHomes.map((h) => dist(home, h)));
  if (!(base > 0)) return null;
  return (b) => {
    const toFoe = Math.min(...foeHomes.map((h) => dist(b, h)));
    if (toFoe < base * ENEMY_RADIUS) return "enemy";
    if (dist(b, home) < base * HOME_RADIUS) return "home";
    return "mid";
  };
}

interface Ctx {
  /** 리플레이 원본 게임 아이디 — 문장에 쓸 이름은 볼 때 다시 푼다. */
  rawName: string;
  s: ReplayPlayerSignals;
  race: string;
  foeRaces: string[];
  zone: ((b: BuildPos) => Zone) | null;
  /** 가장 가까운 상대(러시를 간 대상)와 그 사람의 시작 지점 방향(9시/12시…). */
  nearestFoe: string | null;
  foeClock: number | null;
}

const sec = (frame: number) => frame * SECONDS_PER_FRAME;

// 시작 지점이 몇 시 방향인가(요청: "9시 조조에게…"). 좌표 단위가 타일인지 픽셀인지는
// screp 버전에 따라 다를 수 있어서, 맵 크기와 실제 관측 최대값을 견줘 스케일을 정한다.
// 어느 쪽으로도 맵 안에 안 들어오면 방향을 말하지 않는다(틀린 방향보다 없는 편이 낫다).
function tileScaleOf(all: BuildPos[], mapWidth: number, mapHeight: number): number | null {
  if (all.length === 0 || mapWidth <= 0 || mapHeight <= 0) return null;
  const mx = Math.max(...all.map((b) => b.x));
  const my = Math.max(...all.map((b) => b.y));
  if (mx <= mapWidth && my <= mapHeight) return 1;         // 타일 단위
  if (mx <= mapWidth * 32 && my <= mapHeight * 32) return 32; // 픽셀 단위(1타일=32px)
  return null;
}

// 맵 중앙에서 너무 가까우면 방향이 의미가 없다(중앙 근처는 몇 시라고 말할 수 없다).
const MIN_CLOCK_RADIUS = 0.15;

function clockOf(
  pos: { x: number; y: number },
  mapWidth: number,
  mapHeight: number,
  scale: number
): number | null {
  const fx = pos.x / scale / mapWidth - 0.5;
  const fy = pos.y / scale / mapHeight - 0.5;
  if (Math.hypot(fx, fy) < MIN_CLOCK_RADIUS) return null;
  // 화면 좌표는 아래로 갈수록 y가 커지므로 12시는 -y 쪽이다.
  const turns = Math.atan2(fx, -fy) / (Math.PI * 2);
  const h = Math.round(((turns % 1) + 1) % 1 * 12);
  return h === 0 ? 12 : h;
}

/** 건물 묶음에서 가장 이른 프레임 — 그 전술이 드러난 시점으로 쓴다. */
function earliestFrame(builds: BuildPos[]): number | null {
  const frames = builds.map((b) => b.frame).filter((f): f is number => f !== null);
  return frames.length > 0 ? Math.min(...frames) : null;
}

function detectFor(c: Ctx): Tactic[] {
  const { rawName, s, race, foeRaces, zone, nearestFoe, foeClock } = c;
  const out: Tactic[] = [];
  const u = (n: string) => s.unitCounts[n] ?? 0;
  const firstU = (n: string): number | null => s.firstUnitFrame[n] ?? null;
  const firstB = (n: string): number | null => s.firstBuildingFrame[n] ?? null;
  const hasTech = (n: string) => s.techNames.includes(n);
  const tanks = u("Siege Tank (Tank Mode)") + u("Siege Tank (Siege Mode)");
  const who = rawName;
  // 대상이 있는 러시(요청: "9시 조조에게 3게이트 질럿러시") — 상대나 방향을 못 짚으면
  // 그 부분만 빠지고 문장은 그대로 나온다.
  const target = nearestFoe ? { whom: nearestFoe } : {};
  const clockP: Record<string, number> = foeClock ? { clock: foeClock } : {};
  /** 그 구역에 지은 건물들(좌표를 못 읽으면 항상 빈 배열). */
  const inZone = (z: Zone, unit?: string, beforeSec?: number): BuildPos[] => {
    if (!zone) return [];
    return s.buildPositions.filter(
      (p) =>
        (unit === undefined || p.unit === unit) &&
        (beforeSec === undefined || (p.frame !== null && sec(p.frame) < beforeSec)) &&
        zone(p) === z
    );
  };

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
          who, p: { drones, ...clockP },
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
    if (s.upgradeNames.includes("Ventral Sacs") && (u("Lurker") >= 3 || u("Hydralisk") >= 8)) {
      out.push({
        key: "zerg-drop", ...target, weight: 11,
        at: firstU("Lurker") ?? firstU("Hydralisk"),
        who, p: { lurker: u("Lurker") >= 3 },
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
    if (u("Valkyrie") >= 3 && foeRaces.includes("저그")) {
      out.push({
        key: "valkyrie", weight: 8, at: firstU("Valkyrie"),
        who,
      });
    }
    if (u("Dropship") >= 2) {
      out.push({
        key: "dropship", ...target, weight: 7, at: firstU("Dropship"),
        who,
      });
    }
    // 몰래 배럭 — 본진에서 한참 떨어진 자리에 초반 배럭.
    const sneaky = [...inZone("enemy", "Barracks", 300), ...inZone("mid", "Barracks", 300)];
    if (sneaky.length > 0) {
      out.push({
        key: "sneak-rax", ...target, weight: 11, at: sneaky[0].frame, p: clockP,
        who,
      });
    }
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
          who, p: { gates, ...clockP },
        });
      }
    }
    // 초반 포토 러시 — 게이트보다 포지를 먼저 올렸거나(정석 캐논러시 신호), 상대/가운데
    // 쪽에 포토를 박았을 때. 그냥 이른 포토는 대개 방어라서 둘 중 하나는 있어야 한다.
    const cannon = firstB("Photon Cannon");
    const forge = firstB("Forge");
    const gate = firstB("Gateway");
    const forgeFirst = forge !== null && (gate === null || forge < gate);
    const forward = [...inZone("enemy", "Photon Cannon", 360), ...inZone("mid", "Photon Cannon", 360)];
    const cannonRush = cannon !== null && sec(cannon) < 330 && (forgeFirst || forward.length > 0);
    if (cannonRush) {
      out.push({
        key: "cannon-rush", ...target, weight: 11, at: cannon, p: clockP,
        who,
      });
    }
    if (u("Arbiter") >= 1 && hasTech("Recall")) {
      out.push({
        key: "recall", weight: 10, at: firstU("Arbiter"),
        who,
      });
    }
    if (u("Shuttle") >= 2 && u("Reaver") >= 3) {
      out.push({
        key: "shuttle-reaver", ...target, weight: 11, at: firstU("Reaver"),
        who,
      });
    } else if (u("Shuttle") >= 2 && u("High Templar") >= 4) {
      // 하이템플러 드랍(요청) — 셔틀에 템플러를 태워 일꾼을 지지는 그림. 리버 드랍과
      // 같은 셔틀 플레이지만 결과가 전혀 달라서 따로 말한다.
      out.push({
        key: "templar-drop", ...target, weight: 11, at: firstU("High Templar"),
        who,
      });
    } else if (u("Shuttle") >= 2) {
      out.push({
        key: "shuttle", ...target, weight: 6, at: firstU("Shuttle"),
        who,
      });
    }
  }

  // ── 채팅(요청) ── GG 선언은 승부가 어디서 끝났는지 알려주는 유일한 '사람의 말'이다.
  // 오타·장난까지 잡으려 들면 오탐이 늘어서, 통용되는 항복 표현만 좁게 본다.
  const gg = s.chats.find((c) => /^\s*(g{2,}|ㅈ{2,}|지지|잘{1,2}했|잘하시네)/i.test(c.text));
  if (gg) {
    out.push({ key: "gg", weight: 6, at: gg.frame, who });
  }

  // ── 종족 공통(자리 기반) ──
  const midCannons = inZone("mid", "Photon Cannon");
  if (midCannons.length >= 2) {
    out.push({
      key: "center-photon", weight: 9, at: earliestFrame(midCannons),
      who,
    });
  } else {
    const mid = inZone("mid");
    if (mid.length >= 3) {
      out.push({
        key: "center", weight: 7, at: earliestFrame(mid),
        who,
      });
    }
  }

  return out;
}

export interface TacticScanInput {
  sidePlayers: ParsedReplayPlayer[];
  foePlayers: ParsedReplayPlayer[];
  /** 맵 크기(타일) — 있으면 러시 대상의 시작 지점 방향(9시/12시…)까지 말한다. */
  mapWidth?: number | null;
  mapHeight?: number | null;
}

function homeOf(p: ParsedReplayPlayer): { x: number; y: number } | null {
  const pts = p.signals?.buildPositions ?? [];
  return pts.length >= MIN_BUILDINGS_FOR_HOME ? medoid(pts) : null;
}

/** 한 편의 전술 목록 — 무게 큰 것부터, 같은 전술은 한 번만. */
export function scanTactics({
  sidePlayers, foePlayers, mapWidth, mapHeight,
}: TacticScanInput): Tactic[] {
  const foeRaces = [...new Set(foePlayers.map((p) => p.race).filter(Boolean))];
  const allPositions = [...sidePlayers, ...foePlayers].flatMap((p) => p.signals?.buildPositions ?? []);
  const scale = mapWidth && mapHeight ? tileScaleOf(allPositions, mapWidth, mapHeight) : null;
  const foeHomes = foePlayers
    .map((f) => ({ f, home: homeOf(f) }))
    .filter((x): x is { f: ParsedReplayPlayer; home: { x: number; y: number } } => x.home !== null);

  const all: Tactic[] = [];
  for (const p of sidePlayers) {
    if (!p.signals) continue;
    // 러시를 간 대상 = 내 본진에서 가장 가까운 상대. 1:1이면 당연히 그 사람이다.
    const home = homeOf(p);
    const near = home && foeHomes.length > 0
      ? foeHomes.reduce((a, b) => (dist(home, a.home) <= dist(home, b.home) ? a : b))
      : foeHomes.length === 1 ? foeHomes[0] : null;
    all.push(
      ...detectFor({
        rawName: p.rawName,
        s: p.signals,
        race: p.race,
        foeRaces,
        zone: zoneResolver(p, foePlayers),
        nearestFoe: near?.f.rawName ?? null,
        foeClock: near && scale && mapWidth && mapHeight
          ? clockOf(near.home, mapWidth, mapHeight, scale)
          : null,
      })
    );
  }
  const seen = new Set<string>();
  return all
    .sort((a, b) => b.weight - a.weight)
    .filter((t) => (seen.has(t.key) ? false : (seen.add(t.key), true)));
}
