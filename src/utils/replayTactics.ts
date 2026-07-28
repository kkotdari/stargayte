import type { ParsedReplayPlayer, ReplayPlayerSignals } from "./replayParser";

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






interface Ctx {
  /** 리플레이 원본 게임 아이디 — 문장에 쓸 이름은 볼 때 다시 푼다. */
  rawName: string;
  s: ReplayPlayerSignals;
  race: string;
  foeRaces: string[];
  /** 1:1이면 상대 한 사람 — 팀전은 누가 당했는지 커맨드만으로 알 수 없어 null이다.
   *  당한 쪽을 말할 땐 반드시 한 쪽도 함께 말한다(요청). */
  soleFoe: string | null;
}

const sec = (frame: number) => frame * SECONDS_PER_FRAME;


function detectFor(c: Ctx): Tactic[] {
  const { rawName, s, race, foeRaces, soleFoe } = c;
  const out: Tactic[] = [];
  const u = (n: string) => s.unitCounts[n] ?? 0;
  const firstU = (n: string): number | null => s.firstUnitFrame[n] ?? null;
  const firstB = (n: string): number | null => s.firstBuildingFrame[n] ?? null;
  const hasTech = (n: string) => s.techNames.includes(n);
  const tanks = u("Siege Tank (Tank Mode)") + u("Siege Tank (Siege Mode)");
  const who = rawName;
  // 당한 쪽 — 1:1에서만 확실하다. 못 짚으면 그 부분만 빠지고 문장은 그대로 나온다.
  const target = soleFoe ? { whom: soleFoe } : {};
  /** 드랍은 수송선을 뽑은 것만으로는 알 수 없다 — 실제로 내린 커맨드가 있어야 드랍이다. */
  const dropped = s.unloadCount >= 2;

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
          who, p: { drones },
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
    if (dropped && u("Dropship") >= 2) {
      out.push({
        key: "dropship", ...target, weight: 7, at: s.firstUnloadFrame,
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
          who, p: { gates },
        });
      }
    }
    // 초반 포토 러시 — 게이트웨이보다 포지를 먼저 올린 건 커맨드 순서만으로 확실한
    // 캐논러시 신호다(정상 빌드는 게이트가 먼저다). 자리는 안 본다(요청: 불확실한 건 빼기).
    const cannon = firstB("Photon Cannon");
    const forge = firstB("Forge");
    const gate = firstB("Gateway");
    const forgeFirst = forge !== null && (gate === null || forge < gate);
    const cannonRush = cannon !== null && sec(cannon) < 330 && forgeFirst;
    if (cannonRush) {
      out.push({
        key: "cannon-rush", ...target, weight: 11, at: cannon,
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

  // ── 채팅(요청) ── GG 선언은 승부가 어디서 끝났는지 알려주는 유일한 '사람의 말'이다.
  // 오타·장난까지 잡으려 들면 오탐이 늘어서, 통용되는 항복 표현만 좁게 본다.
  const gg = s.chats.find((c) => /^\s*(g{2,}|ㅈ{2,}|지지|잘{1,2}했|잘하시네)/i.test(c.text));
  if (gg) {
    out.push({ key: "gg", weight: 6, at: gg.frame, who });
  }

  return out;
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

  const all: Tactic[] = [];
  for (const p of sidePlayers) {
    if (!p.signals) continue;
    all.push(
      ...detectFor({ rawName: p.rawName, s: p.signals, race: p.race, foeRaces, soleFoe })
    );
  }
  const seen = new Set<string>();
  return all
    .sort((a, b) => b.weight - a.weight)
    .filter((t) => (seen.has(t.key) ? false : (seen.add(t.key), true)));
}
