import type { BuildPos, ParsedReplayPlayer, ReplayPlayerSignals } from "./replayParser";
import { ga, reul } from "./korean";

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

/** 짚어낸 전술 하나. 이긴 편/진 편 문장을 함께 들고 있다가 호출부가 골라 쓴다. */
export interface Tactic {
  /** 같은 전술이 여러 사람에게서 나와도 한 번만 말하기 위한 키. */
  key: string;
  /** 이야깃거리로서의 무게 — 큰 것부터 말한다. */
  weight: number;
  /** 그 전술이 드러난 프레임 — 요약을 시간순으로 늘어놓을 때 쓴다. 못 잡으면 null. */
  at: number | null;
  won: string;
  lost: string;
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
  name: string;
  s: ReplayPlayerSignals;
  race: string;
  foeRaces: string[];
  zone: ((b: BuildPos) => Zone) | null;
}

const sec = (frame: number) => frame * SECONDS_PER_FRAME;

/** 건물 묶음에서 가장 이른 프레임 — 그 전술이 드러난 시점으로 쓴다. */
function earliestFrame(builds: BuildPos[]): number | null {
  const frames = builds.map((b) => b.frame).filter((f): f is number => f !== null);
  return frames.length > 0 ? Math.min(...frames) : null;
}

function detectFor(c: Ctx): Tactic[] {
  const { name, s, race, foeRaces, zone } = c;
  const out: Tactic[] = [];
  const u = (n: string) => s.unitCounts[n] ?? 0;
  const firstU = (n: string): number | null => s.firstUnitFrame[n] ?? null;
  const firstB = (n: string): number | null => s.firstBuildingFrame[n] ?? null;
  const hasTech = (n: string) => s.techNames.includes(n);
  const tanks = u("Siege Tank (Tank Mode)") + u("Siege Tank (Siege Mode)");
  const who = ga(name);
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
          key: "zling-rush", weight: 10, at: ling,
          won: `${who} ${drones}드론 저글링 러시로 초반부터 몰아침`,
          lost: `${who} ${drones}드론 저글링 러시를 갔지만 막힘`,
        });
      }
    }
    // 목동 저그 — 저글링·울트라에 다크스웜(또는 디파일러)까지 얹은 그림.
    const swarm = hasTech("Dark Swarm") || u("Defiler") >= 2;
    if (u("Zergling") >= 12 && u("Ultralisk") >= 3 && swarm) {
      out.push({
        key: "moka", weight: 11, at: firstU("Ultralisk"),
        won: `${who} 저글링·울트라에 다크스웜을 얹은 목동 저그로 밀어붙임`,
        lost: `${who} 목동 저그로 버텨봤지만 무너짐`,
      });
    } else if (hasTech("Dark Swarm")) {
      out.push({
        key: "swarm", weight: 6, at: s.firstTechFrame["Dark Swarm"] ?? null,
        won: `${who} 다크스웜으로 진영을 덮고 들어감`,
        lost: `${who} 다크스웜까지 깔았지만 역부족`,
      });
    }
    if (u("Devourer") >= 3 && u("Mutalisk") >= 6) {
      out.push({
        key: "devourer", weight: 9, at: firstU("Devourer"),
        won: `${who} 디바우러와 뮤탈을 섞어 하늘을 잡음`,
        lost: `${who} 디바우러 뮤탈로 공중을 노렸지만 통하지 않음`,
      });
    }
    if (u("Lurker") >= 5) {
      out.push({
        key: "lurker", weight: 7, at: firstU("Lurker"),
        won: `${who} 러커로 길목을 조여 숨통을 끊음`,
        lost: `${who} 러커로 조여봤지만 풀림`,
      });
    }
  }

  // ── 테란 ──
  if (race === "테란") {
    if (u("Marine") >= 16 && u("Medic") >= 5) {
      const withTank = tanks >= 4;
      out.push({
        key: "bionic", weight: 10, at: firstU("Medic"),
        won: withTank
          ? `${who} 마린·메딕에 탱크까지 붙인 바이오닉 한 방으로 밀고 나감`
          : `${who} 마린·메딕 바이오닉으로 조여 들어감`,
        lost: `${who} 바이오닉으로 몰아쳤지만 뚫지 못함`,
      });
    } else if (tanks >= 6 && u("Vulture") + u("Goliath") >= 8 && u("Marine") < 10) {
      out.push({
        key: "mech", weight: 9, at: firstU("Siege Tank (Tank Mode)") ?? firstU("Goliath"),
        won: `${who} 탱크와 골리앗을 앞세운 메카닉으로 한 걸음씩 밀고 나감`,
        lost: `${who} 메카닉으로 자리를 잡았지만 무너짐`,
      });
    }
    if (u("Valkyrie") >= 3 && foeRaces.includes("저그")) {
      out.push({
        key: "valkyrie", weight: 8, at: firstU("Valkyrie"),
        won: `${who} 발키리를 띄워 오버로드 사냥에 나섬`,
        lost: `${who} 발키리로 하늘을 노렸지만 소용없었음`,
      });
    }
    if (u("Dropship") >= 2) {
      out.push({
        key: "dropship", weight: 7, at: firstU("Dropship"),
        won: `${who} 드랍십을 계속 돌려 뒤를 흔듦`,
        lost: `${who} 드랍십으로 흔들어봤지만 판을 못 바꿈`,
      });
    }
    // 몰래 배럭 — 본진에서 한참 떨어진 자리에 초반 배럭.
    const sneaky = [...inZone("enemy", "Barracks", 300), ...inZone("mid", "Barracks", 300)];
    if (sneaky.length > 0) {
      out.push({
        key: "sneak-rax", weight: 11, at: sneaky[0].frame,
        won: `${who} 본진에서 한참 떨어진 자리에 몰래 배럭을 올려 허를 찌름`,
        lost: `${who} 몰래 배럭을 시도했지만 들킴`,
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
        const label = gates === 2 ? "투게이트" : `${gates}게이트`;
        out.push({
          key: "zealot-rush", weight: 10, at: zealot,
          won: `${who} ${label} 질럿 러시로 초반을 잡음`,
          lost: `${who} ${label} 질럿 러시를 갔지만 막힘`,
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
        key: "cannon-rush", weight: 11, at: cannon,
        won: `${who} 초반 포토 러시로 시작부터 흔들어 놓음`,
        lost: `${who} 초반 포토 러시를 갔다가 도로 손해만 봄`,
      });
    }
    if (u("Arbiter") >= 1 && hasTech("Recall")) {
      out.push({
        key: "recall", weight: 10, at: firstU("Arbiter"),
        won: `${who} 아비터 리콜로 뒤를 통째로 파고듦`,
        lost: `${who} 아비터 리콜까지 꺼냈지만 판을 못 뒤집음`,
      });
    }
    if (u("Shuttle") >= 2 && u("Reaver") >= 3) {
      out.push({
        key: "shuttle-reaver", weight: 9, at: firstU("Reaver"),
        won: `${who} 셔틀 리버로 쉴 새 없이 찔러 넣음`,
        lost: `${who} 셔틀 리버로 찔러봤지만 막힘`,
      });
    } else if (u("Shuttle") >= 2) {
      out.push({
        key: "shuttle", weight: 6, at: firstU("Shuttle"),
        won: `${who} 셔틀을 돌려 뒤를 흔듦`,
        lost: `${who} 셔틀로 흔들어봤지만 판을 못 바꿈`,
      });
    }
  }

  // ── 종족 공통(자리 기반) ──
  const midCannons = inZone("mid", "Photon Cannon");
  if (midCannons.length >= 2) {
    out.push({
      key: "center-photon", weight: 9, at: earliestFrame(midCannons),
      won: `${who} 센터에 포토를 박아 길을 끊음`,
      lost: `${who} 센터에 포토를 박았지만 지켜내지 못함`,
    });
  } else {
    const mid = inZone("mid");
    if (mid.length >= 3) {
      out.push({
        key: "center", weight: 7, at: earliestFrame(mid),
        won: `${who} 센터에 건물을 늘려 판을 넓힘`,
        lost: `${reul(name)} 센터로 밀고 나갔지만 되레 본진이 비었음`,
      });
    }
  }

  return out;
}

export interface TacticScanInput {
  sidePlayers: ParsedReplayPlayer[];
  foePlayers: ParsedReplayPlayer[];
  displayName: (rawName: string) => string;
}

/** 한 편의 전술 목록 — 무게 큰 것부터, 같은 전술은 한 번만. */
export function scanTactics({ sidePlayers, foePlayers, displayName }: TacticScanInput): Tactic[] {
  const foeRaces = [...new Set(foePlayers.map((p) => p.race).filter(Boolean))];
  const all: Tactic[] = [];
  for (const p of sidePlayers) {
    if (!p.signals) continue;
    all.push(
      ...detectFor({
        name: displayName(p.rawName),
        s: p.signals,
        race: p.race,
        foeRaces,
        zone: zoneResolver(p, foePlayers),
      })
    );
  }
  const seen = new Set<string>();
  return all
    .sort((a, b) => b.weight - a.weight)
    .filter((t) => (seen.has(t.key) ? false : (seen.add(t.key), true)));
}
