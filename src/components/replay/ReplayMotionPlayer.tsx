import React, { useEffect, useMemo, useRef, useState } from "react";
import { Hammer, Mountain, Pause, Play, RotateCcw, Shield } from "lucide-react";
import TerrainReviewModal from "../../modals/TerrainReviewModal";
import Avatar from "../common/Avatar";
import RaceBadge from "../common/RaceBadge";
import { cx } from "../../utils/format";
import { UNIT_KO, BUILDING_KO, TECH_KO } from "../../utils/replaySummaryText";
import type { ReplayMapGrid } from "../../utils/replayParser";
import { isAirUnit, type MotionTrack, type SummaryMotion } from "../../utils/replayMotion";
import { DEFENSE_BUILDINGS } from "../../utils/replayBuildMix";
import { terrainOf, decodeWalk, groundPath, type TerrainGrid } from "../../utils/minimapTerrain";
import type { MinimapMarker } from "./ReplayMinimap";

/* ── 연속 재생 플레이어(요청: 장면 선정 없이 전부 연속으로, 이미지 대신 텍스트로) ──────
   스냅 미니맵(ReplayMinimap)이 '고른 장면'을 화살표·이모지로 그렸다면, 여기는 시간이 그냥
   흐른다: 시각 t가 배속으로 달리고, 매 순간
     · t까지 지어진 건물이 텍스트로 박히고(자리·시각은 건설 커맨드 그대로 — 정확하다)
     · 부대 자취(명령 좌표 다운샘플)를 따라 우세 유닛 이름표가 미끄러지고
     · t에 떨어진 마법이 텍스트로 잠깐 번쩍인다.
   beat(자막·장면)는 여기서 안 쓴다(요청: 남겨두되 사용은 안 하게) — 그건 칭호·BEST의
   원장으로만 남는다. 유닛 위치는 명령 기반 추정이다: 리플레이에는 위치·죽음이 안 남아서,
   이 자취는 "그 사람 부대가 어디서 무엇을 하고 있었나"의 어림이다. */

/** 배속 갈래(요청: 속도 조절, 기본 ×2) — 뜯어보는 ×2부터 훑어 넘기는 ×32까지. */
const SPEEDS = [2, 4, 8, 16, 32] as const;
/** 다 지어진 뒤 이름이 더 붙어 있는 시간(초) — 하는 일 없으면 바로 도형이다(지적: 액티브
 *  시간은 유닛보다 타이트하게). 생산·연구가 돌면 그때 다시 이름이 뜬다. */
const BUILD_LABEL_TAIL_SEC = 15;
/** 마법 텍스트가 떠 있는 시간(초, 게임 시간). */
const CAST_HOLD_SEC = 6;
/** 자취 점 사이가 이보다 벌어지면 잇지 않고 건너뛴다(초) — 한참 조용하다 다른 곳을 찍은
 *  것은 이동이 아니라 시선 전환이라, 이으면 부대가 맵을 순간이동으로 가로지른다. */
const LERP_MAX_GAP_SEC = 24;

const pct = (v: number, span: number) => `${(v / span) * 100}%`;

/** 지상 부대가 가운데 쪽으로 휘는 정도 — 스냅 화살표의 BEND와 같은 어림(지적: 지상군이
 *  벽을 넘어 다닌다). 진짜 길찾기는 지형 표 없이는 못 그리지만, 브루드워 지상군은 대체로
 *  본진을 나와 가운데 길로 돌므로 직선보다 이쪽이 덜 거짓말이다. 공중은 곧게 간다. */
const GROUND_BEND = 0.35;

interface TrackPos { x: number; y: number; stale: boolean; moving: boolean; sinceLast: number }

/* ── 나들이 점 걷기(지적: 특히 초반에 유닛 자리가 튄다 — 오버로드인지 갑자기 저 멀리 다른
   기지에 가 있다) ────────────────────────────────────────────────────────────────
   한 사람의 자취(pts)는 그 사람이 내린 이동·공격 명령을 시간순으로 이은 것 하나뿐이다.
   무엇을 골라 내린 명령인지는 대체로 안 남아서(replayParser의 orderPositions.by는 시즈·스톰
   처럼 그 유닛만 하는 커맨드가 있어야 붙는다), 오버로드나 일꾼을 정찰 보낸 클릭 한 번이
   '부대'의 자리로 읽히고 마커가 맵을 가로지른다. 초반에 유독 심한 것은 그때 내리는 명령의
   거의 전부가 정찰이라서다.

   가려내는 근거는 '돌아온다'는 사실이다: 정찰은 저쪽에 잠깐 찍혔다가 곧 이쪽 명령으로
   돌아오지만, 진짜 진군은 간 자리에서 계속 명령이 이어진다. 그래서 앞점에서 멀리 떨어진
   점이 짧게(RUN 이하) 이어지다가 다시 앞점 근처로 돌아오면 그 구간을 통째로 뺀다. 오래
   머무르는 구간(전투·진출)은 길이 조건에서 살아남는다.

   저장된 트랙이 아니라 화면에서 거른다 — 원본을 깎아 두면 되돌릴 수 없고, 이렇게 하면
   이미 등록된 경기도 재분석 없이 곧바로 반듯해진다. */
/** 앞점에서 이만큼(맵 한 변 대비) 떨어지면 '저 멀리'다. */
const SPIKE_FAR_RATE = 0.22;
/** 그러고서 앞점의 이만큼 안으로 돌아오면 나들이였다고 본다. */
const SPIKE_BACK_RATE = 0.1;
/** 나들이로 볼 수 있는 최대 연속 점 수 — 이보다 길게 머물렀으면 그건 진짜 그 자리다. */
const SPIKE_MAX_RUN = 4;
/** 부대 묶기(요청: 가까운 유닛만 합침) — 앞 부대의 마지막 자리에서 이 안이면 같은 부대다. */
const SQUAD_MERGE_TILES = 14;
const SQUAD_MAX = 3;
/** 곁 부대가 이만큼 조용하면 걷는다 — 본대에 합류했거나 정리된 것이다. */
const SQUAD_FADE_SEC = 60;
/** 정찰 자취의 걸음(타일/초) — 일꾼 속도다. 오버로드는 더 느리지만 누가 갔는지 모르는
 *  자리라, 흔한 쪽(일꾼)에 맞춘다. */
const SCOUT_WALK_SPEED = 3.7;

/** 먼 점을 새 부대로 볼지 내다보는 창(초) — 이 안에 옛 자리 근처 명령이 또 오면 두 무리다. */
const SQUAD_LOOKAHEAD_SEC = 30;
/** 출발점이 첫 목적지와 이보다 가까우면 심지 않는다 — 제자리 걸음만 한 점 는다. */
const SAME_SPOT_START_TILES = 4;
/** 묶음 이름(by) → 그 안의 유닛들 — 유닛별 마커의 수를 셀 때 쓴다. */
const BY_UNITS: Record<string, string[]> = {
  Bionic: ["Marine", "Firebat", "Medic"],
  "Siege Tank": ["Siege Tank (Tank Mode)", "Siege Tank (Siege Mode)"],
};

/** 명령 점을 가까운 것끼리 부대로 묶는다(요청: 가까운 유닛만 합침) — 부대 자취와 정찰
 *  자취가 같이 쓴다.
 *
 *  먼 점 하나에는 두 이야기가 있다(지적: 부대를 가른 뒤로 먼 어택이 걷지 않았고, 일꾼·
 *  오버로드 위치도 여전히 튀었다) — 그 무리가 통째로 옮겨 가는 것이거나, 딴 무리가 저기서
 *  따로 움직이는 것이다. 가르는 근거는 옛 자리다: 먼 점 뒤로 곧(30초) 옛 자리 근처 명령이
 *  또 오면 두 무리가 같이 사는 것이라 부대를 가르고, 안 오면 이사라 이어 걷는다.
 *  새로 서는 부대는 곁 부대의 마지막 자리를 출발점으로 심는다 — 첫 점이 곧 목적지라
 *  마커가 목적지에서 태어나던 것을, 걸어 나가는 그림으로 되돌린다. */
function splitSquads(
  pts: [number, number, number][], home?: [number, number] | null,
): [number, number, number][][] {
  const squads: [number, number, number][][] = [];
  for (let i = 0; i < pts.length; i += 1) {
    const pt = pts[i];
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < squads.length; k += 1) {
      const last = squads[k][squads[k].length - 1];
      const d = Math.hypot(last[1] - pt[1], last[2] - pt[2]);
      if (d < bestD) { bestD = d; best = k; }
    }
    if (best >= 0 && bestD <= SQUAD_MERGE_TILES) { squads[best].push(pt); continue; }
    if (best >= 0) {
      const last = squads[best][squads[best].length - 1];
      let staysBehind = false;
      for (let j = i + 1; j < pts.length && pts[j][0] - pt[0] <= SQUAD_LOOKAHEAD_SEC; j += 1) {
        if (Math.hypot(pts[j][1] - last[1], pts[j][2] - last[2]) <= SQUAD_MERGE_TILES) {
          staysBehind = true;
          break;
        }
      }
      // 옛 자리가 곧 다시 안 쓰인다 — 무리째 이사다. 이어 걸어간다.
      if (!staysBehind) { squads[best].push(pt); continue; }
    }
    if (squads.length < SQUAD_MAX) {
      /* 새 부대의 출발점(지적: 엉뚱한 데서 태어남) — 곁 부대의 마지막 자리, 그것도 없으면
         본진이다. 첫 명령의 좌표는 목적지라, 심어 주지 않으면 마커가 목적지에서 태어난다. */
      const from = best >= 0 ? squads[best][squads[best].length - 1] : null;
      const seed: [number, number] | null = from ? [from[1], from[2]] : home ?? null;
      squads.push(seed && Math.hypot(seed[0] - pt[1], seed[1] - pt[2]) > SAME_SPOT_START_TILES
        ? [[pt[0], seed[0], seed[1]], pt] : [pt]);
      continue;
    }
    /* 다 찼으면 가장 가까운 부대가 그리로 걸어간다(지적: 순간이동) — 예전에는 가장 오래
       조용한 부대를 골라, 맵 반대편의 부대가 유령처럼 가로질러 걸었다. */
    squads[best].push(pt);
  }
  return squads;
}

function dropSpikes(
  pts: [number, number, number][], span: number,
): [number, number, number][] {
  if (pts.length < 3) return pts;
  const far = span * SPIKE_FAR_RATE;
  const back = span * SPIKE_BACK_RATE;
  const at = (p: [number, number, number]) => [p[1], p[2]] as const;
  const gap = (a: [number, number, number], b: [number, number, number]) =>
    Math.hypot(at(a)[0] - at(b)[0], at(a)[1] - at(b)[1]);
  const out: [number, number, number][] = [pts[0]];
  let i = 1;
  while (i < pts.length) {
    const prev = out[out.length - 1];
    if (gap(prev, pts[i]) <= far) { out.push(pts[i]); i += 1; continue; }
    // 멀리 나간 구간의 끝을 찾는다 — 앞점 근처로 돌아온 첫 점이 그 끝이다.
    let j = i;
    while (j < pts.length && j - i < SPIKE_MAX_RUN && gap(prev, pts[j]) > far) j += 1;
    if (j < pts.length && gap(prev, pts[j]) <= back) { i = j; continue; }  // 나들이 — 통째로 뺀다
    out.push(pts[i]);
    i += 1;
  }
  return out;
}

/* ── 유닛 속도(요청: 속업 여부 포함) ──────────────────────────────────────────
   값은 타일/초다(브루드워 픽셀/프레임 × 23.81fps ÷ 32px). 표에 없는 유닛은 보병쯤(3.2)으로
   친다. 속업은 리플레이의 업그레이드 기록(트랙의 ups)에서 연구 시점을 읽어, 그 뒤의
   이동에만 붙는다 — 배수는 대부분 1.5배이고 오버로드만 4배다. */
const UNIT_SPEED: Record<string, number> = {
  Marine: 3.0, Firebat: 3.0, Medic: 3.0, Ghost: 3.0, SCV: 3.7,
  Vulture: 4.8, Goliath: 3.5, "Siege Tank (Tank Mode)": 3.5, "Siege Tank": 3.5,
  Wraith: 5.0, Dropship: 4.1, "Science Vessel": 3.7, Battlecruiser: 1.9, Valkyrie: 4.9,
  Zealot: 3.0, Dragoon: 3.7, "High Templar": 2.4, "Dark Templar": 3.7, Archon: 3.7,
  Reaver: 1.3, Probe: 3.7, Shuttle: 3.3, Observer: 2.5, Scout: 5.0, Corsair: 5.0,
  Carrier: 2.5, Arbiter: 3.7,
  Zergling: 4.1, Hydralisk: 2.7, Lurker: 4.3, Ultralisk: 3.8, Defiler: 3.0,
  Drone: 3.7, Overlord: 0.6, Mutalisk: 5.0, Scourge: 5.0, Queen: 5.0, Guardian: 1.9,
  Devourer: 3.7, "Infested Terran": 4.0,
};
/** 유닛 → 그 유닛의 속도 업그레이드 이름. */
const SPEED_UP_OF: Record<string, string> = {
  Zergling: "Metabolic Boost", Hydralisk: "Muscular Augments", Ultralisk: "Anabolic Synthesis",
  Overlord: "Pneumatized Carapace", Vulture: "Ion Thrusters", Zealot: "Leg Enhancements",
  Shuttle: "Gravitic Drive", Observer: "Gravitic Boosters", Scout: "Gravitic Thrusters",
};
const DEFAULT_SPEED = 3.2;

function speedOf(
  unit: string, atSec: number, ups: [number, string][] | undefined,
): number {
  const base = UNIT_SPEED[unit] ?? DEFAULT_SPEED;
  const upName = SPEED_UP_OF[unit];
  if (!upName || !ups) return base;
  const researched = ups.some(([sec, name]) => name === upName && sec <= atSec);
  if (!researched) return base;
  return unit === "Overlord" ? base * 4 : base * 1.5;
}

/** 커맨드를 받은 지 이 안이면 아직 '활동 중'이다(요청) — 이름표를 유지한다. 유닛은 오래
 *  이름으로, 건물은 타이트하게(지적)의 '오래' 쪽. */
const ACTIVE_HOLD_SEC = 12;
/** 재생 전용 이름 보강 — UNIT_KO에 없는 정찰 유닛(일꾼·오버로드). UNIT_KO에 넣으면 통계
 *  도넛·Top5까지 일꾼이 섞이므로(replayBuildMix가 그 표로 거른다) 여기서만 얹는다. */
const SCOUT_KO: Record<string, string> = {
  SCV: "SCV", Probe: "프로브", Drone: "드론", Overlord: "오버로드",
};
/** 생산 뒤 이 안이면 그 건물이 '일하는 중'이다(요청: 생산할 때 이름 표시) — 건물의 이름
 *  시간은 유닛(8초)보다 타이트하게(지적). */
const PROD_FLASH_SEC = 4;

/* 무엇이 어디서 나오나 — 유닛이 나온 순간 그 종류의 건물이 일하고 있었다는 뜻이다. 어느
   채인지는 리플레이가 안 알려줘(생산 커맨드에 건물 번호가 없다) 같은 종류가 함께 켜진다.
   저그는 전부 해처리 계열(라바)이고, 러커·가디언처럼 유닛에서 변태하는 것은 건물 몫이
   아니라 뺀다. */
/* 연구(업그레이드·테크) → 그 연구를 하는 건물(요청: 업그레이드 중인 건물도 심장 뛰기).
   연구가 시작되면 그 건물이 RESEARCH_SEC 동안 뛰는 것으로 본다(정확한 연구 시간은 종류마다
   달라 어림 하나로 뭉친다). 부속 건물(머신샵 등)의 연구는 몸통 건물로 올려 붙인다. */
const RESEARCH_SEC = 90;
const RESEARCH_BUILDING: Record<string, string> = {
  "Terran Infantry Weapons": "Engineering Bay", "Terran Infantry Armor": "Engineering Bay",
  "Terran Vehicle Weapons": "Armory", "Terran Vehicle Plating": "Armory",
  "Terran Ship Weapons": "Armory", "Terran Ship Plating": "Armory",
  "U-238 Shells": "Academy", "Stim Packs": "Academy", "Caduceus Reactor": "Academy",
  "Restoration": "Academy", "Optical Flare": "Academy",
  "Ion Thrusters": "Factory", "Spider Mines": "Factory", "Tank Siege Mode": "Factory",
  "Cloaking Field": "Starport", "Apollo Reactor": "Starport",
  "Yamato Gun": "Science Facility", "Titan Reactor": "Science Facility",
  "Personnel Cloaking": "Science Facility", "Lockdown": "Science Facility",
  "Protoss Ground Weapons": "Forge", "Protoss Ground Armor": "Forge", "Protoss Plasma Shields": "Forge",
  "Protoss Air Weapons": "Cybernetics Core", "Protoss Air Armor": "Cybernetics Core",
  "Singularity Charge": "Cybernetics Core",
  "Leg Enhancements": "Citadel of Adun",
  "Psionic Storm": "Templar Archives", "Hallucination": "Templar Archives",
  "Khaydarin Amulet": "Templar Archives", "Maelstrom": "Templar Archives",
  "Mind Control": "Templar Archives", "Argus Talisman": "Templar Archives",
  "Gravitic Drive": "Robotics Support Bay", "Scarab Damage": "Robotics Support Bay",
  "Reaver Capacity": "Robotics Support Bay",
  "Gravitic Boosters": "Observatory", "Sensor Array": "Observatory",
  "Carrier Capacity": "Fleet Beacon", "Gravitic Thrusters": "Fleet Beacon",
  "Apial Sensors": "Fleet Beacon", "Disruption Web": "Fleet Beacon", "Argus Jewel": "Fleet Beacon",
  "Recall": "Arbiter Tribunal", "Stasis Field": "Arbiter Tribunal", "Khaydarin Core": "Arbiter Tribunal",
  "Zerg Melee Attacks": "Evolution Chamber", "Zerg Missile Attacks": "Evolution Chamber",
  "Zerg Carapace": "Evolution Chamber",
  "Zerg Flyer Attacks": "Spire", "Zerg Flyer Carapace": "Spire",
  "Metabolic Boost": "Spawning Pool", "Adrenal Glands": "Spawning Pool",
  "Muscular Augments": "Hydralisk Den", "Grooved Spines": "Hydralisk Den", "Lurker Aspect": "Hydralisk Den",
  "Pneumatized Carapace": "Hatchery", "Ventral Sacs": "Hatchery", "Antennae": "Hatchery", "Burrowing": "Hatchery",
  "Anabolic Synthesis": "Ultralisk Cavern", "Chitinous Plating": "Ultralisk Cavern",
  "Plague": "Defiler Mound", "Consume": "Defiler Mound", "Metasynaptic Node": "Defiler Mound",
  "Ensnare": "Queen's Nest", "Spawn Broodlings": "Queen's Nest", "Gamete Meiosis": "Queen's Nest",
};

const ZERG_LARVA = ["Drone", "Overlord", "Zergling", "Hydralisk", "Mutalisk", "Scourge", "Queen", "Ultralisk", "Defiler"];
const PRODUCED_BY: Record<string, string[]> = {
  Barracks: ["Marine", "Firebat", "Medic", "Ghost"],
  Factory: ["Vulture", "Siege Tank (Tank Mode)", "Siege Tank", "Goliath"],
  Starport: ["Wraith", "Dropship", "Science Vessel", "Battlecruiser", "Valkyrie"],
  "Command Center": ["SCV"],
  Gateway: ["Zealot", "Dragoon", "High Templar", "Dark Templar"],
  "Robotics Facility": ["Shuttle", "Reaver", "Observer"],
  Stargate: ["Scout", "Corsair", "Carrier", "Arbiter"],
  Nexus: ["Probe"],
  Hatchery: ZERG_LARVA,
  Lair: ZERG_LARVA,
  Hive: ZERG_LARVA,
};

/** 건물 짓는 시간(초, 어림) — 짓는 동안 반투명 표시(요청)의 창이다. */
const BUILD_SEC: Record<string, number> = {
  "Command Center": 55, Nexus: 55, Hatchery: 55, Lair: 45, Hive: 55,
  Refinery: 18, Assimilator: 18, Extractor: 18,
  "Supply Depot": 18, Pylon: 14, "Creep Colony": 10, "Spawning Pool": 35,
};
/** 유닛 뽑는 시간(초, 어림) — 이 시간이 지나면 만든 건물 앞에 잠깐 놓인다(요청). */
const UNIT_SEC: Record<string, number> = {
  SCV: 13, Probe: 13, Drone: 13, Overlord: 25,
  Marine: 15, Firebat: 15, Medic: 19, Ghost: 31,
  Vulture: 19, "Siege Tank (Tank Mode)": 31, "Siege Tank": 31, Goliath: 25,
  Wraith: 38, Dropship: 31, "Science Vessel": 50, Battlecruiser: 83, Valkyrie: 31,
  Zealot: 25, Dragoon: 31, "High Templar": 31, "Dark Templar": 31,
  Shuttle: 38, Reaver: 44, Observer: 25, Scout: 50, Corsair: 25, Carrier: 88, Arbiter: 100,
  Zergling: 17, Hydralisk: 17, Mutalisk: 25, Scourge: 19, Queen: 31, Ultralisk: 42, Defiler: 31,
};
/** 유닛 → 뽑는 건물들 — PRODUCED_BY의 뒤집기. */
const PRODUCER_OF: Record<string, string[]> = (() => {
  const m: Record<string, string[]> = {};
  for (const [b, units] of Object.entries(PRODUCED_BY)) {
    for (const u of units) (m[u] ??= []).push(b);
  }
  return m;
})();
/** 갓 뽑힌 유닛이 건물 앞에 머무는 시간(초). */
const FRESH_HOLD_SEC = 12;

/** 자취에서 t 시각의 자리 — 사이는 보간(지상은 가운데로 휘는 곡선), 틈이 크면 앞 점에 머문다.
 *  moving(두 점 사이를 미끄러지는 중)과 sinceLast(마지막 명령에서 지난 초)도 함께 낸다 —
 *  "커맨드를 받거나 이동 중이면 이름으로"(요청)의 재료다. */
function posAt(
  pts: [number, number, number][], t: number,
  bendCenter: { x: number; y: number } | null,
): TrackPos | null {
  if (pts.length === 0) return null;
  if (t <= pts[0][0]) return { x: pts[0][1], y: pts[0][2], stale: false, moving: false, sinceLast: Infinity };
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [s0, x0, y0] = pts[i];
    const [s1, x1, y1] = pts[i + 1];
    if (t < s1) {
      if (s1 - s0 > LERP_MAX_GAP_SEC) {
        return { x: x0, y: y0, stale: t - s0 > LERP_MAX_GAP_SEC, moving: false, sinceLast: t - s0 };
      }
      const k = (t - s0) / Math.max(0.001, s1 - s0);
      // 대기 구간(같은 자리 두 점) — 움직임이 아니다(도착해서 다음 명령을 기다리는 중).
      const still = x0 === x1 && y0 === y1;
      if (!bendCenter || still) {
        return {
          x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k,
          stale: false, moving: !still, sinceLast: still ? t - s0 : 0,
        };
      }
      /* 이차 베지어 — 제어점을 두 점의 가운데에서 맵 중앙 쪽으로 당긴다. 이동 거리가 길수록
         더 휘어, 먼 진군일수록 "가운데 길로 돌아간다"에 가까워진다. */
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      const cx = mx + (bendCenter.x - mx) * GROUND_BEND;
      const cy = my + (bendCenter.y - my) * GROUND_BEND;
      const u = 1 - k;
      return {
        x: u * u * x0 + 2 * u * k * cx + k * k * x1,
        y: u * u * y0 + 2 * u * k * cy + k * k * y1,
        stale: false, moving: true, sinceLast: 0,
      };
    }
  }
  const last = pts[pts.length - 1];
  return { x: last[1], y: last[2], stale: t - last[0] > LERP_MAX_GAP_SEC, moving: false, sinceLast: t - last[0] };
}

/** t 시각의 우세 유닛 이름 — 없으면 빈 문자열. */
function unitAt(units: [number, string][], t: number): string {
  let name = "";
  for (const [sec, u] of units) {
    if (sec > t) break;
    name = u;
  }
  return name;
}

/* 한 번에 한 판만 돈다(요청) — 목록에 게임 카드가 여럿 펼쳐져 있으면 저마다 자동재생을
   시작해 지도가 사방에서 움직인다. 마지막으로 재생을 잡은 플레이어가 앞 임자를 멈춘다. */
let playbackHolder: { current: () => void } | null = null;
function claimPlayback(ref: { current: () => void }) {
  if (playbackHolder && playbackHolder !== ref) playbackHolder.current();
  playbackHolder = ref;
}
function releasePlayback(ref: { current: () => void }) {
  if (playbackHolder === ref) playbackHolder = null;
}

const fmtClock = (sec: number): string => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

export default function ReplayMotionPlayer({
  grid, motion, endSec, bases, teamOfRaw, active = true, winnerTeam,
}: {
  grid: ReplayMapGrid;
  motion: SummaryMotion;
  /** 경기 길이(초) — 요약의 end(프레임)에서 온다. 없으면 트랙의 끝으로 잡는다. */
  endSec: number | null;
  /** 본진 표시(아바타+이름) — 스냅 미니맵과 같은 재료를 그대로 받는다. */
  bases: MinimapMarker[];
  /** 원본 게임 아이디 → 팀 — 텍스트 색을 가른다. */
  teamOfRaw: (raw: string) => 1 | 2 | undefined;
  /** 화면에 실제로 보이는 카드인가 — 안 보이는 카드의 시계는 세우지 않는다. */
  active?: boolean;
  /** 이긴 편 — 재생이 끝나면 그 편 아바타에 트로피를 얹는다(요청). 무승부·미확정은 없음. */
  winnerTeam?: 1 | 2;
  // (삭제·요청) caps — 자막 표시를 걷으면서 함께.
}) {
  const total = useMemo(() => {
    if (endSec && endSec > 0) return endSec;
    let last = 0;
    for (const p of motion.players) for (const pt of p.pts) last = Math.max(last, pt[0]);
    for (const b of motion.builds) last = Math.max(last, b[0]);
    return Math.max(60, last);
  }, [motion, endSec]);

  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  /* 배지 색 규칙(요청) — 배경은 팀 컬러, 테두리는 개인(게임 내) 컬러, 글자는 배경과
     대비되는 흰/검이다. 역할이 고정되면서 팀색/개인색 토글은 걷었다. */
  const colorByRaw = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of motion.players) if (p.color) m.set(p.raw, p.color);
    return m;
  }, [motion]);
  /* 색은 한 벌만 칠한다(요청: 중복 표시 제거) — 팀색/개인색을 전환 버튼으로 오간다.
     개인색이 없는 옛 기록은 개인색 모드여도 팀색으로 떨어진다. */
  const [colorMode, setColorMode] = useState<"team" | "personal">("personal");
  /* 밝은 톤(지적: 음영에 비해 팀색이 어두워 안 보인다)이되 너무 파스텔은 말고(지적) —
     쨍한 하늘·장미색의 중간 지점. */
  const TEAM_EDGE: Record<1 | 2, string> = { 1: "#5ea2ff", 2: "#ff7d95" };
  const modeColor = (raw: string, team: 1 | 2 | undefined): string => {
    const teamColor = team === 2 ? TEAM_EDGE[2] : TEAM_EDGE[1];
    if (colorMode === "personal") return colorByRaw.get(raw) ?? teamColor;
    return teamColor;
  };
  /** 색의 밝기 — 어두운 개인색은 흰 반투명 음영을 받쳐야 보인다(지적). */
  const lumOf = (hex: string): number => {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return 255;
    return 0.299 * parseInt(hex.slice(1, 3), 16)
      + 0.587 * parseInt(hex.slice(3, 5), 16)
      + 0.114 * parseInt(hex.slice(5, 7), 16);
  };
  /* 건물 이름 글자 — 테두리 없이 음영판만(지적). 어두운 계열(블루 포함, 지적)은 흰 반투명
     배경판, 밝은 계열은 CSS의 검정 음영판. */
  const shapeStyle = (raw: string, team: 1 | 2 | undefined): React.CSSProperties => {
    const c = modeColor(raw, team);
    return {
      color: c,
      ...(lumOf(c) < 140 ? {
        background: "rgba(255, 255, 255, 0.5)", borderRadius: 3, padding: "0 2px",
        textShadow: "none",
      } : {}),
    };
  };
  /* 도형(●▪▲✕·점)은 건물이든 유닛이든 음영이 아예 없다(지적) — 제 색 그대로. CSS의
     음영판·그림자를 물려받지 않게 여기서 걷는다. */
  const glyphStyle = (raw: string, team: 1 | 2 | undefined): React.CSSProperties => ({
    color: modeColor(raw, team), background: "none", textShadow: "none", padding: 0,
  });
  const chipStyle = (raw: string, team: 1 | 2 | undefined): React.CSSProperties => {
    const bg = modeColor(raw, team);
    const lum = lumOf(bg);
    // 배지(칩)는 제 배경색이 있으니 테두리는 안 두른다(지적).
    return {
      background: bg,
      color: lum > 150 ? "#111" : "#fff",
    };
  };

  /* 지형(요청: 미니맵 이미지 분석) — 그림에서 걷는 땅 격자를 만들어, 지상 부대의 자취를
     그 위의 경로로 편다. 분석 전·실패 시에는 기존 곡선 폴백. */
  const [terrain, setTerrain] = useState<TerrainGrid | null>(null);
  /* 지형 수정(요청: 모든 경기 리플레이 화면에서, 아무나) — 산 버튼이 검수 모달을 연다.
     저장하면 이 자리에서 바로 새 지형으로 갈아 끼운다(맵 캐시는 다음 로드에 새 값을 받는다). */
  const [terrainOpen, setTerrainOpen] = useState(false);
  const [walkOverride, setWalkOverride] = useState<string | null>(null);
  /* 모달에 주는 image는 같은 값이면 같은 객체여야 한다(지적: 칠하면 까맣게 깜빡이고
     되돌아감) — 재생은 매 프레임 리렌더라, 인라인 객체를 만들면 모달의 초기화 effect가
     프레임마다 다시 돌아 격자를 원본으로 리셋했다. */
  const terrainModalImage = useMemo(() => ({
    id: grid.imageId ?? 0, name: grid.name || "미니맵",
    image: grid.image ?? "", walk: walkOverride ?? grid.walk,
  }), [grid.imageId, grid.name, grid.image, grid.walk, walkOverride]);
  useEffect(() => {
    let cancelled = false;
    /* 검수한 지형(grid.walk, 방금 이 자리에서 고쳤으면 walkOverride)이 있으면 그쪽이
       이긴다(요청) — 자동 분석은 어림이다. */
    const reviewed = decodeWalk(walkOverride ?? grid.walk);
    if (reviewed) { setTerrain(reviewed); return undefined; }
    if (!grid.image) { setTerrain(null); return undefined; }
    terrainOf(grid.image)
      .then((tg) => { if (!cancelled) setTerrain(tg); });
    return () => { cancelled = true; };
  }, [grid.image, grid.walk, walkOverride]);

  /* 자취를 실제 이동으로 편다(지적: 클릭 자리로 순간이동해서 이상하다) — 명령은 도착이
     아니라 출발 신호다: 마커는 명령 시각에 그 자리에서 출발해, 경로(지상은 지형 BFS,
     공중은 직선)를 그 유닛의 속도(속업 포함)로 이동한다. 도착 전에 다음 명령이 오면 가던
     길 그 지점에서 새 목적지로 방향을 튼다. 명령이 없는 동안은 서 있는다 — 순간이동은
     구조적으로 없다. */
  /* 정찰 클릭 한 번에 부대가 맵을 가로지르던 점들을 먼저 걷는다(위 dropSpikes 주석).
     아래 자취를 펴는 계산도, 마커가 '방금 명령받았나'를 재는 곳도 이 걸러진 점을 본다 —
     뺀 점이 한쪽에만 남아 있으면 마커는 가만히 선 채로 명령받은 척 맥동한다. */
  const basePts = useMemo(
    () => motion.players.map((p) => dropSpikes(p.pts, Math.max(grid.width, grid.height))),
    [motion, grid.width, grid.height],
  );
  /* 지금 부대의 주력 유닛(지적: 질럿·히드라·탱크·일꾼 말고는 이름이 안 나온다) — 트랙의
     units는 '여태 제일 많이 뽑은 것'이라 한번 정해지면 거의 안 바뀌었다. 최근 3분의
     생산에서 고르고, 그동안 생산이 없으면 여태 누계로 물러난다. 재료(prod)는 옛 분석본에도
     있어 재분석이 필요 없다. */
  const unitNow = (p: MotionTrack, at: number): string => {
    let bestRecent = "";
    let nRecent = 0;
    let bestEver = "";
    let nEver = 0;
    for (const [unit, secs] of Object.entries(p.prod ?? {})) {
      if (SCOUT_KO[unit] || !UNIT_KO[unit]) continue;
      let recent = 0;
      let ever = 0;
      for (const sec of secs) {
        if (sec > at) break;
        ever += 1;
        if (at - sec <= 180) recent += 1;
      }
      if (recent > nRecent) { nRecent = recent; bestRecent = unit; }
      if (ever > nEver) { nEver = ever; bestEver = unit; }
    }
    return bestRecent || bestEver || unitAt(p.units, at);
  };

  /* 자취 펴기 한 벌 — 부대는 지형 경로에 그 유닛의 속도로, 정찰(straight)은 직선에 일꾼
     걸음(3.7타일/초)으로 걷는다(지적: 일꾼·오버로드가 위치 찍으면 바로 이동하는 느낌 —
     정찰 점도 명령 시각에 출발해 걸어서 가야 한다). */
  const walkTrack = (
    src: [number, number, number][], p: MotionTrack, straight: boolean, forcedUnit?: string,
  ): [number, number, number][] => {
    if (src.length === 0) return src;
    const out: [number, number, number][] = [[src[0][0], src[0][1], src[0][2]]];
    let atX = src[0][1];
    let atY = src[0][2];
    let atSec = src[0][0];
    for (let i = 1; i < src.length; i += 1) {
      const [orderSec, tx, ty] = src[i];
      const nextOrderSec = i + 1 < src.length ? src[i + 1][0] : Infinity;
      // 명령이 올 때까지 서 있던 자리 — 같은 좌표의 점을 박아 그 구간을 정지로 만든다.
      if (orderSec > atSec) out.push([orderSec, atX, atY]);
      const startSec = Math.max(atSec, orderSec);
      const unit = forcedUnit ?? (straight ? "" : unitAt(p.units, orderSec));
      const air = unit !== "" && isAirUnit(unit);
      let path: [number, number][] | null = null;
      if (!straight && !air && terrain) {
        path = groundPath(
          terrain,
          atX / grid.width, atY / grid.height,
          tx / grid.width, ty / grid.height,
        )?.map(([fx, fy]) => [fx * grid.width, fy * grid.height] as [number, number]) ?? null;
      }
      if (!path) path = [[tx, ty]];
      let total = 0;
      const lens: number[] = [];
      let px = atX;
      let py = atY;
      for (const [x, y] of path) {
        const d = Math.hypot(x - px, y - py);
        lens.push(d);
        total += d;
        px = x;
        py = y;
      }
      if (total === 0) { atSec = startSec; continue; }
      const v = straight ? SCOUT_WALK_SPEED : Math.max(0.5, speedOf(unit || "Marine", orderSec, p.ups));
      const travel = total / v;
      if (startSec + travel <= nextOrderSec) {
        // 끝까지 간다 — 도착 뒤 다음 명령까지는 위의 대기 점이 맡는다.
        let acc = 0;
        for (let j = 0; j < path.length; j += 1) {
          acc += lens[j];
          out.push([startSec + travel * (acc / total), path[j][0], path[j][1]]);
        }
        atX = tx;
        atY = ty;
        atSec = startSec + travel;
      } else {
        // 다음 명령이 먼저 온다 — 그때까지 간 만큼만 걷고 거기서 방향을 튼다.
        const cutDist = v * (nextOrderSec - startSec);
        let acc = 0;
        let cx = atX;
        let cy = atY;
        for (let j = 0; j < path.length; j += 1) {
          if (acc + lens[j] >= cutDist) {
            const k = lens[j] > 0 ? (cutDist - acc) / lens[j] : 0;
            const bx = j === 0 ? atX : path[j - 1][0];
            const by = j === 0 ? atY : path[j - 1][1];
            cx = bx + (path[j][0] - bx) * k;
            cy = by + (path[j][1] - by) * k;
            out.push([nextOrderSec, cx, cy]);
            break;
          }
          acc += lens[j];
          out.push([startSec + acc / v, path[j][0], path[j][1]]);
          cx = path[j][0];
          cy = path[j][1];
        }
        atX = cx;
        atY = cy;
        atSec = nextOrderSec;
      }
    }
    return out;
  };
  /* 부대 갈라 보기(요청: 유닛을 무조건 합치는 게 아니라 가까운 것만 합침) — 마커 하나가
     드랍조와 본대를 오가며 순간이동하던 자리다. 명령 점을 가까운 것끼리 묶어 부대 몇으로
     가르고, 어느 부대에서도 먼 점은 가장 오래 조용한 부대가 그리로 옮겨 간 것으로 본다. */
  const homeOf = (raw: string): [number, number] | null => {
    const b = bases.find((m) => m.key === raw);
    return b ? [b.x, b.y] : null;
  };
  const squadPts = useMemo(
    () => basePts.map((pts, pi) => splitSquads(pts, homeOf(motion.players[pi].raw))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [basePts, motion, bases],
  );
  /* 정체가 드러난 유닛별 자취(요청: 모든 유닛의 위치를 따로, 같은 종류끼리만 묶기) —
     시즈·스팀팩·버로우로 정체가 드러난 명령들이다. 종류마다 따로 묶으므로 탱크 라인과
     바이오닉 본대가 딴 자리에 있어도 각자의 점으로 선다. 옛 분석본에는 없다(재분석). */
  const typeSquads = useMemo(
    () => motion.players.map((p) => Object.entries(p.upts ?? {})
      .flatMap(([unit, pts]) => splitSquads(pts, homeOf(p.raw))
        .map((sq) => ({ unit, raw: sq, walk: walkTrack(sq, p, false, unit) })))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [motion, terrain, grid.width, grid.height, bases],
  );
  const refinedSquads = useMemo(
    () => motion.players.map((p, pi) => squadPts[pi].map((sq) => walkTrack(sq, p, false))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [squadPts, terrain, grid.width, grid.height, motion],
  );
  /* 정찰 자취도 걸어서 가고(지적: 갑자기 이동 — 직선이되 일꾼 걸음), 갈래·부대로 갈라
     각자의 점이 된다(지적: 드랍십 순간이동 — 일꾼 정찰과 셔틀 원정이 한 점을 놓고
     밀당했다). 갈래는 이름을 정한다(지적: 오버로드 이름이 안 나온다). */
  const scoutSquads = useMemo(() => motion.players.map((p) => {
    const kinds: { kind: "worker" | "carrier" | "lone"; src: [number, number, number][] }[] = [
      { kind: "worker", src: p.spts ?? [] },
      { kind: "carrier", src: p.tpts ?? [] },
      { kind: "lone", src: p.opts ?? [] },
    ];
    // 정찰도 본진에서 걸어 나간다(지적: 엉뚱한 데서 태어남).
    return kinds.flatMap(({ kind, src }) => (src.length === 0 ? [] : splitSquads(src, homeOf(p.raw))
      .map((sq) => ({ kind, raw: sq, walk: walkTrack(sq, p, true) }))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [motion, terrain, grid.width, grid.height, bases]);
  // 기본은 ×4다(요청: ×8 → ×4) — ×8은 전투가 눈으로 못 따라갈 만큼 빨랐다.
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(4);
  /* 탐색바(지적: 다이얼 드래그가 안 되고, 부드럽지 않고 반응이 느림) — 제어 입력은 매
     프레임 React가 값을 덮어써 잡은 손잡이와 싸웠고, 끌 때마다 지도 전체가 그려져 손을
     못 따라왔다. 입력을 비제어로 두고(손잡이는 브라우저 몫), 재생 중의 위치는 ref로 직접
     쓰며, 끌기의 지도 이동(setT)은 rAF로 프레임당 한 번으로 묶는다. */
  const rangeRef = useRef<HTMLInputElement>(null);
  const scrubbing = useRef(false);
  const seekPending = useRef<number | null>(null);
  const [done, setDone] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);

  /* 재생이 손잡이를 민다 — 비제어라 React가 안 밀어 주므로 여기서 직접 쓴다. 잡고 있는
     동안은 안 민다(그 순간의 임자는 손이다). */
  useEffect(() => {
    if (scrubbing.current) return;
    const el = rangeRef.current;
    if (!el) return;
    el.value = String(t);
    el.style.setProperty("--p", `${total > 0 ? (t / total) * 100 : 0}%`);
  }, [t, total]);

  /* 한 번에 한 판만(요청) — 재생을 시작하는 순간 먼저 돌던 판을 멈춘다. */
  const pauseSelf = useRef(() => {});
  useEffect(() => {
    pauseSelf.current = () => setPlaying(false);
  }, []);
  useEffect(() => {
    if (!playing) return undefined;
    claimPlayback(pauseSelf);
    return () => releasePlayback(pauseSelf);
  }, [playing]);

  /* 시야에서 벗어나면 일시정지(요청) — 다시 보일 때 자동으로 되살리지는 않는다(멈춘 걸
     사람이 이어 보는 건 재생 버튼의 몫이다). */
  useEffect(() => {
    const el = mapRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => !e.isIntersecting)) setPlaying(false);
    }, { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /* 창을 벗어나면 일시정지(지적: 창 전환해도 계속 재생됨) — 탭 전환(hidden)과 창 전환
     (blur)을 함께 잡는다. 되살리는 것은 화면 밖 정지와 마찬가지로 사람의 몫이다. */
  useEffect(() => {
    const stop = () => setPlaying(false);
    const onVis = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", stop);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", stop);
    };
  }, []);

  /* 시계 — rAF로 게임 시간 t를 배속만큼 민다. state로 두는 이유는 매 프레임 그리는 것들
     (자취·건물·마법)이 전부 t의 함수라서다. */
  const clockRef = useRef<{ raf: number; last: number } | null>(null);
  useEffect(() => {
    if (!playing || !active) return undefined;
    const tick = (now: number) => {
      const c = clockRef.current;
      /* 한 틱 상한 — 브라우저가 rAF를 멈췄다 되살리면(백그라운드 탭) dt가 자리 비운
         시간 전체가 돼, 돌아온 순간 그만큼을 한 번에 건너뛴다. 위의 정지가 대부분 막지만
         blur가 안 오는 경우(다른 모니터로 시선만 이동)를 위한 이중 잠금이다. */
      const dt = c ? Math.min((now - c.last) / 1000, 0.5) : 0;
      clockRef.current = { raf: requestAnimationFrame(tick), last: now };
      if (dt > 0) {
        setT((prev) => {
          const next = prev + dt * speed;
          if (next >= total) {
            setPlaying(false);
            setDone(true);
            return total;
          }
          return next;
        });
      }
    };
    clockRef.current = { raf: requestAnimationFrame(tick), last: performance.now() };
    return () => {
      if (clockRef.current) cancelAnimationFrame(clockRef.current.raf);
      clockRef.current = null;
    };
  }, [playing, active, speed, total]);

  /* 생산 시각 되짚기(요청: 생산할 때 건물 이름) — 사람×건물종류별로 [생산 초, 그때 고른
     건물 태그]를 미리 모아, 재생 중에는 "지금 창 안에 있나"만 본다. 태그가 있으면(새
     분석본) 그 건물 하나만 깜빡인다(요청: 어느 건물에서 생산 중인지). */
  const prodByRawType = useMemo(() => {
    const m = new Map<string, [number, number][]>();
    for (const p of motion.players) {
      for (const [type, units] of Object.entries(PRODUCED_BY)) {
        const evs: [number, number][] = [];
        for (const u of units) {
          const secs = p.prod?.[u] ?? [];
          const tags = p.ptag?.[u];
          for (let k = 0; k < secs.length; k += 1) evs.push([secs[k], tags?.[k] ?? 0]);
        }
        if (evs.length > 0) {
          evs.sort((a, b) => a[0] - b[0]);
          m.set(`${p.raw}|${type}`, evs);
        }
      }
    }
    return m;
  }, [motion]);

  /* 태그 → 건물 순번 어림(요청 승인) — 태그↔자리 대응은 리플레이에 없다. "먼저 보인
     태그 = 먼저 지은 건물"로 잇는다. 저그(라바 생산)는 태그가 라바 것이라 못 쓴다. */
  const tagOrdinals = useMemo(() => {
    const m = new Map<string, Map<number, number>>();
    for (const [key, evs] of prodByRawType) {
      const type = key.slice(key.indexOf("|") + 1);
      if (type === "Hatchery" || type === "Lair" || type === "Hive") continue;
      const ord = new Map<number, number>();
      for (const [, tag] of evs) if (tag > 0 && !ord.has(tag)) ord.set(tag, ord.size);
      if (ord.size > 0) m.set(key, ord);
    }
    return m;
  }, [prodByRawType]);
  /** (임자, 건물 종류) 안에서 지은 순서 — builds 인덱스 → 순번, 그리고 그 역방향. */
  const buildsByType = useMemo(() => {
    const m = new Map<string, number[]>();
    motion.builds.forEach((b, i) => {
      const key = `${b[4]}|${b[3]}`;
      const arr = m.get(key);
      if (arr) arr.push(i);
      else m.set(key, [i]);
    });
    for (const arr of m.values()) arr.sort((a, b) => motion.builds[a][0] - motion.builds[b][0]);
    return m;
  }, [motion]);

  /* 부대 규모(지적: 말도 안 되게 부풀려진다 — 클릭 수로 세고 있었다) — 완성으로 센다.
     그 유닛을 뽑는 건물 수가 슬롯이고(저그는 해처리당 라바 3), 클릭이 와도 슬롯 대기가
     두 판 분량을 넘으면 스팸 클릭으로 보고 버린다. 표시 규모 = 최근 3분의 완성 수. */
  const completionsByRaw = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const p of motion.players) {
      const done: number[] = [];
      const producersAt = (types: string[], atSec: number): number => {
        let n = 0;
        for (let i = 0; i < motion.builds.length; i += 1) {
          const [bs, bx, by, bu, br, bg] = motion.builds[i];
          if (br !== p.raw || !types.includes(bu)) continue;
          if (bs + (BUILD_SEC[bu] ?? 30) > atSec) continue;
          if ((bg ?? 0) > 0 && atSec >= (bg ?? 0)) continue;
          // 같은 자리에 뒤 건물이 있으면(해처리→레어) 이건 옛 껍데기다.
          let dup = false;
          for (let j = 0; j < motion.builds.length; j += 1) {
            if (j === i) continue;
            const [s2, x2, y2, u2, r2] = motion.builds[j];
            if (r2 === p.raw && s2 > bs && s2 <= atSec && types.includes(u2)
              && Math.hypot(x2 - bx, y2 - by) <= 1.5) { dup = true; break; }
          }
          if (!dup) n += 1;
        }
        return n;
      };
      for (const [unit, secs] of Object.entries(p.prod ?? {})) {
        if (SCOUT_KO[unit]) continue;
        const producers = PRODUCER_OF[unit];
        if (!producers) continue;
        const dur = UNIT_SEC[unit] ?? 20;
        const larva = producers.includes("Hatchery");
        const tags = larva ? undefined : p.ptag?.[unit];
        if (tags) {
          // 태그(=건물)마다 제 큐(요청 승인) — 어느 채에 시켰는지까지 아는 셈이다.
          const freeByTag = new Map<number, number>();
          for (let k = 0; k < secs.length; k += 1) {
            const cmdSec = secs[k];
            const tag = tags[k] ?? 0;
            const free = freeByTag.get(tag) ?? 0;
            if (free > cmdSec + dur * 2) continue;
            const start = Math.max(cmdSec, free);
            freeByTag.set(tag, start + dur);
            done.push(start + dur);
          }
          continue;
        }
        const slotFree: number[] = [];
        for (const cmdSec of secs) {
          const cap = Math.max(1, producersAt(producers, cmdSec) * (larva ? 3 : 1));
          while (slotFree.length < cap) slotFree.push(0);
          let bi = 0;
          for (let k = 1; k < Math.min(slotFree.length, cap); k += 1) {
            if (slotFree[k] < slotFree[bi]) bi = k;
          }
          if (slotFree[bi] > cmdSec + dur * 2) continue;
          const start = Math.max(cmdSec, slotFree[bi]);
          slotFree[bi] = start + dur;
          done.push(start + dur);
        }
      }
      done.sort((a, b) => a - b);
      m.set(p.raw, done);
    }
    return m;
  }, [motion]);

  /* 유닛별 완성 시각(요청: 제일 많이 뽑은 것 하나가 아니라 모든 유닛을 따로) — 위 합계와
     같은 큐 시뮬레이션을 유닛별로 가른 것. 어느 유닛이 죽었는지는 모르니, 전투 감모는
     합계의 감모 비율(살아남은 몫)을 유닛마다 같은 비율로 나눠 얹는다 — 전투에서 질럿만
     죽고 리버는 멀쩡했는지까지는 리플레이가 말해 주지 않는다. */
  const unitDoneByRaw = useMemo(() => {
    const m = new Map<string, [string, number[]][]>();
    for (const p of motion.players) {
      const byUnit: [string, number[]][] = [];
      for (const [unit, secs] of Object.entries(p.prod ?? {})) {
        if (SCOUT_KO[unit] || !UNIT_KO[unit]) continue;
        const dur = UNIT_SEC[unit] ?? 20;
        // 합계 쪽은 생산 큐를 시뮬레이션하지만, 유닛별 몫은 순서 비교라 완성 어림(명령+
        // 건조 시간)으로 충분하다 — 큐 밀림은 모든 유닛에 비슷하게 얹힌다.
        byUnit.push([unit, secs.map((sec) => sec + dur).sort((a, b) => a - b)]);
      }
      m.set(p.raw, byUnit);
    }
    return m;
  }, [motion]);

  /* 규모 곡선(요청: 유닛 수는 전투하거나 공격당해야만 감소) — 예전에는 '최근 3분의 완성
     수'라 소강기에도 저절로 줄었다. 이제 완성 누계를 들고 가되, 전투 구간(hot)에서만
     지수로 깎는다(반감기 60초). 리플레이에 죽음이 안 남는 이상 "전투 밖에서는 안 줄어든다"
     쪽이 어림으로도 사실에 가깝다. 곡선은 사람마다 한 번 만들어 두고 재생은 읽기만 한다. */
  const sizeSeries = useMemo(() => {
    const out = new Map<string, [number, number][]>();
    const HALF_LIFE = Math.LN2 / 60;
    for (const p of motion.players) {
      const done = completionsByRaw.get(p.raw) ?? [];
      const hot = p.hot ?? [];
      // 눈금: 완성 시각 + 전투 경계와 그 안의 5초 간격 — 구간이 경계를 안 넘게 쪼갠다.
      const marks = new Set<number>([0, ...done]);
      for (const [a, b] of hot) {
        for (let x = a; x < b; x += 5) marks.add(x);
        marks.add(b);
      }
      const times = [...marks].sort((a, b) => a - b);
      const inHot = (lo: number, hi: number) => hot.some(([a, b]) => lo >= a && hi <= b);
      const series: [number, number][] = [];
      let size = 0;
      let di = 0;
      let prev = 0;
      for (const now of times) {
        if (now > prev && inHot(prev, now)) size *= Math.exp(-HALF_LIFE * (now - prev));
        while (di < done.length && done[di] <= now) { size += 1; di += 1; }
        series.push([now, size]);
        prev = now;
      }
      out.set(p.raw, series);
    }
    return out;
  }, [motion, completionsByRaw]);

  /* 본진 건물(확장 포함)의 자리 — 채굴 일꾼이 오갈 목적지다(지적: 자원 지대가 기준이고,
     거기서 가장 가까운 본진 건물로 왔다 갔다). 커맨드·넥서스·해처리 계열이 대상이다. */
  const halls = useMemo(() => motion.builds
    .filter(([, , , unit]) => ["Command Center", "Nexus", "Hatchery", "Lair", "Hive"].includes(unit))
    .map(([sec, x, y, , raw, gone]) => ({ sec, x, y, raw, gone: gone ?? 0 })), [motion]);
  /** 가스 건물들 — 가스 지대에 일꾼을 보낼 자격이다(지적: 가스도 안 지었는데 왔다 갔다). */
  const gasBuildings = useMemo(() => motion.builds
    .filter(([, , , unit]) => ["Refinery", "Assimilator", "Extractor"].includes(unit))
    .map(([sec, x, y, , raw, gone]) => ({ sec, x, y, raw, gone: gone ?? 0 })), [motion]);
  const castsNow = motion.casts.filter((c) => c[0] <= t && t - c[0] <= CAST_HOLD_SEC);

  return (
    <div className="scr-motion">
      <div className="scr-motion-map" ref={mapRef} style={{ aspectRatio: `${grid.width} / ${grid.height}` }}>
        {grid.image
          ? <img className="scr-motion-canvas" src={grid.image} alt={`${grid.name} 미니맵`} />
          : <div className="scr-motion-canvas scr-motion-canvas-blank" />}

        {/* 건물(요청: 합치기 대신) — 기본은 작은 이름이 늘 떠 있되, 가까이 겹치는 같은
            이름은 하나만 적고 나머지는 점(지적: 겹치면 안 보인다). 긴 이름은 폰트를 한
            단계 줄인다. 생산·연구 중이면 심장처럼 뛴다(요청). */}
        {(() => {
          return motion.builds.map(([sec, x, y, unit, raw, gone], i) => {
            if (sec > t) return null;
            const goneAt = gone ?? 0;
            if (goneAt > 0 && t >= goneAt + 6) return null;
            const razed = goneAt > 0 && t >= goneAt;
            /* 같은 자리에 같은 임자의 새 건물이 서면(레어 진화·재건) 옛 것은 걷는다
               (지적: 비활성 건물이 글자와 도형으로 동시 표시). */
            if (!razed && motion.builds.some(([s2, x2, y2, , r2], j) =>
              j !== i && r2 === raw && s2 > sec && s2 <= t && Math.hypot(x2 - x, y2 - y) <= 1.5)) {
              return null;
            }
            // 짓는 동안은 공사중 아이콘(요청: 반투명 말고) — 반투명은 "저기 뭐가 있긴 한데"
            // 로만 읽히고, 도형의 반투명(뒤 비침)과도 헷갈렸다.
            const raising = !razed && t - sec < (BUILD_SEC[unit] ?? 30);
            const team = teamOfRaw(raw);
            const tagOrd = tagOrdinals.get(`${raw}|${unit}`);
            const myOrd = (buildsByType.get(`${raw}|${unit}`) ?? []).indexOf(i);
            const producing = !razed && (prodByRawType.get(`${raw}|${unit}`) ?? [])
              .some(([ps, tag]) => {
                if (!(ps <= t && t - ps <= PROD_FLASH_SEC)) return false;
                // 태그를 알면 그 순번의 건물만(요청) — 모르면 예전처럼 같은 종류 전부.
                if (!tag || !tagOrd) return true;
                const ord = tagOrd.get(tag);
                return ord === undefined || ord === myOrd;
              });
            // 연구 중(요청) — 이 건물에서 하는 연구가 지금 창 안에 시작돼 있나.
            const track = motion.players.find((p) => p.raw === raw);
            const hallLike = unit === "Lair" || unit === "Hive" ? "Hatchery" : unit;
            const researching = !razed && (track?.ups ?? []).some(([us, name]) =>
              RESEARCH_BUILDING[name] === hallLike && us <= t && t - us <= RESEARCH_SEC);
            // 이름 창 = 짓는 동안 + 꼬리 3초 — 완공되면 거의 바로 도형이다(지적).
            const activeBuild = !razed && (producing || researching
              || t - sec <= (BUILD_SEC[unit] ?? 30) + BUILD_LABEL_TAIL_SEC);
            const name = BUILDING_KO[unit] ?? UNIT_KO[unit];
            /* 비활성이면 무조건 도형이다(지적: 서플라이·파일런·포토·터렛이 영영 안 변했다 —
               "겹치지만 않으면 이름 상시 노출"이던 옛 규칙을 걷었다). */
            const isHall = ["Command Center", "Nexus", "Hatchery", "Lair", "Hive"].includes(unit);
            let text: string;
            if (razed) text = "✕";
            else if (activeBuild && name) text = name;
            // ▪는 글꼴상 반쪽짜리라 ●▲보다 작아 보인다(지적) — 꽉 찬 ■로. 본진은 별표(요청).
            else text = isHall ? "★" : DEFENSE_BUILDINGS.has(unit) ? "▲" : "■";
            return (
              <span
                key={`b-${i}`}
                className={cx(
                  "scr-motion-build",
                  !razed && text !== name && "scr-motion-build-shape",
                  // 본진 건물은 다른 건물보다 큼직하게(요청).
                  isHall && "scr-motion-build-hall",
                  activeBuild && "scr-motion-build-on",
                  (producing || researching) && "scr-motion-heartbeat",
                  razed && "scr-motion-build-razed",
                )}
                style={{
                  left: pct(x, grid.width), top: pct(y, grid.height),
                  // 긴 이름은 한 단계 작게(지적) — 여섯 자부터.
                  ...(text.length >= 6 && !activeBuild ? { fontSize: 6 } : {}),

                  // 건물은 글자색=제 색, 음영판이 바탕 — 유닛 배지와 반대(지적). 도형이 된
                  // 뒤에는 음영 없이 맨 색이다(지적).
                  ...(razed ? {} : text === name ? shapeStyle(raw, team) : glyphStyle(raw, team)),
                }}
              >
                {/* 글꼴 ■는 작게 뭉개져 동그라미처럼 보인다(지적) — 진짜 네모를 CSS로 그린다. */}
                {text === "■" ? <i className="scr-motion-sq" /> : text}
                {raising && <Hammer size={6} className="scr-motion-raising" />}
              </span>
            );
          });
        })()}

        {/* 갓 뽑힌 유닛(요청) — 뽑는 시간이 지나면 만든 건물 앞에 잠깐 놓인다. 같은 종류
            건물이 여럿이면(게이트 여럿) 차례로 나눠 놓는다. */}
        {motion.players.flatMap((p) => {
          const team = teamOfRaw(p.raw);
          const out: React.ReactNode[] = [];
          for (const [unit, secs] of Object.entries(p.prod ?? {})) {
            const producers = PRODUCER_OF[unit];
            if (!producers) continue;
            for (let si = 0; si < secs.length; si += 1) {
              const done = secs[si] + (UNIT_SEC[unit] ?? 20);
              if (t < done || t > done + FRESH_HOLD_SEC) continue;
              // 그 시각에 서 있는 그 종류 건물들 — 태그를 알면 그 건물, 모르면 돌려 가며.
              const cands = motion.builds.filter(([bs, , , bu, br, bg]) =>
                br === p.raw && bs <= secs[si] && ((bg ?? 0) === 0 || secs[si] < (bg ?? 0))
                && producers.includes(bu));
              if (cands.length === 0) continue;
              let pick = cands[si % cands.length];
              const tag = p.ptag?.[unit]?.[si] ?? 0;
              if (tag > 0) {
                for (const ptype of producers) {
                  const ord = tagOrdinals.get(`${p.raw}|${ptype}`)?.get(tag);
                  const bIdx = ord === undefined ? undefined
                    : buildsByType.get(`${p.raw}|${ptype}`)?.[ord];
                  const b = bIdx === undefined ? undefined : motion.builds[bIdx];
                  if (b && b[0] <= secs[si] && ((b[5] ?? 0) === 0 || secs[si] < (b[5] ?? 0))) {
                    pick = b;
                    break;
                  }
                }
              }
              const [, bx, by] = pick;
              out.push(
                <span
                  key={`fresh-${p.raw}-${unit}-${si}`}
                  className="scr-motion-fresh"
                  style={{
                    left: pct(bx + 1.2, grid.width), top: pct(by + 2, grid.height),
                    ...glyphStyle(p.raw, team),
                  }}
                >
                  ●
                </span>,
              );
            }
          }
          return out;
        })}

        {/* 채굴 일꾼(요청, 지적: 방향 반대) — 자원 지대마다, 그 시점에 서 있는 가장
            가까운 본진 건물(시작 본진·확장 포함)을 찾아 그리로 오간다. 가까운 홀이 없는
            자원(아직 안 편 멀티)은 비워 둔다. */}
        {(grid.resources ?? []).flatMap((res, ri) => {
          let owner: { x: number; y: number; raw: string } | null = null;
          let best = 18;
          for (const m of bases) {
            if (m.ghost) continue;
            const d = Math.hypot(res[0] - m.x, res[1] - m.y);
            if (d < best) { best = d; owner = { x: m.x, y: m.y, raw: m.key }; }
          }
          for (const hall of halls) {
            if (hall.sec > t || (hall.gone > 0 && t >= hall.gone)) continue;
            const d = Math.hypot(res[0] - hall.x, res[1] - hall.y);
            if (d < best) { best = d; owner = { x: hall.x, y: hall.y, raw: hall.raw }; }
          }
          if (!owner) return [];
          /* 가스 지대 게이트(지적) — 같은 기지에 미네랄 지대가 따로 있는 홑 가스 지대는,
             그 위에 가스 건물(정제소류)이 서기 전엔 일꾼이 안 간다. 미네랄과 가스가 한
             지대로 묶인 맵은 그대로 둔다(어차피 미네랄 캐는 길이다). */
          if (res[2] === 1) {
            /* 홑 가스 지대인가 — 근처(같은 기지권, 30타일)에 다른 자원 지대가 따로 있으면
               이 지대는 간헐천 홑 지대다(미네랄이 섞였으면 애초에 한 지대로 묶였을 테니).
               (지적: 12타일로는 못 잡았다 — 본진 미네랄 지대 중심이 그보다 멀다.) */
            const standalone = (grid.resources ?? []).some((other, oi) =>
              oi !== ri && Math.hypot(other[0] - res[0], other[1] - res[1]) <= 30);
            if (standalone) {
              const hasGasBuilding = gasBuildings.some((g) =>
                g.raw === owner!.raw && g.sec + 30 <= t && (g.gone === 0 || t < g.gone)
                && Math.hypot(g.x - res[0], g.y - res[1]) <= 8);
              if (!hasGasBuilding) return [];
            }
          }
          const track = motion.players.find((p) => p.raw === owner!.raw);
          let workerN = 0;
          for (const [sec, n] of track?.workers ?? []) {
            if (sec > t) break;
            workerN = n;
          }
          if (workerN === 0) return [];
          const team = teamOfRaw(owner.raw);
          const dots = Math.min(3, Math.max(1, Math.ceil(workerN / 10)));
          return Array.from({ length: dots }, (_, i) => {
            const k = 0.5 + 0.5 * Math.sin(t * 0.9 + i * 2.1 + ri);
            const x = res[0] + (owner!.x - res[0]) * (0.15 + 0.7 * k);
            const y = res[1] + (owner!.y - res[1]) * (0.15 + 0.7 * k);
            return (
              <span
                key={`mine-${ri}-${i}`}
                className="scr-motion-miner"
                style={{
                  left: pct(x, grid.width), top: pct(y, grid.height),
                  ...glyphStyle(owner!.raw, team),
                }}
              >
                ·
              </span>
            );
          });
        })}

        {/* 본진 — 스냅 미니맵과 같은 표시(아바타+이름), 늘 떠 있다. 그 아래에 자원 캐는
            일꾼(요청) — 여태 뽑은 일꾼 수가 곡괭이질하듯 잘게 흔들린다. */}
        {bases.map((m) => {
          const track = motion.players.find((p) => p.raw === m.key);
          let workerN = 0;
          for (const [sec, n] of track?.workers ?? []) {
            if (sec > t) break;
            workerN = n;
          }
          return (
            <span
              key={m.key}
              className={cx("scr-motion-base", m.ghost && "scr-motion-base-ghost")}
              style={{ left: pct(m.x, grid.width), top: pct(m.y, grid.height) }}
            >
              {/* 테두리 한 겹(요청: 중복 제거) — 지금 색 모드의 색으로. 어두운 색에 받치던
                  흰 겉테두리는 걷었다(요청: 흰 테두리 제거) — 아바타가 커진 뒤로는 색 테가
                  얇아도 충분히 읽힌다. */}
              <span style={{ position: "relative" }}>
                <span
                  className="scr-motion-base-ring"
                  style={{ boxShadow: `0 0 0 3px ${modeColor(m.key, m.team)}` }}
                >
                  {/* 16 → 24px(요청: 아바타 크기 확대) — 지도 위에서 사람을 가려내는 것은
                      결국 얼굴이라, 도형보다 이쪽이 커야 한다. */}
                  <Avatar member={{ id: m.memberId, nickname: m.name, avatar: m.avatar }} size={24} />
                </span>
                {/* 종족 배지(요청) — 아바타 옆에. */}
                <RaceBadge race={m.race} size={9} circleLetter className="scr-motion-base-race" />
                {/* 팀 표시(요청: 깃발 말고 팀을 나타내는 아이콘에 색 구분) — 반대 어깨의
                    방패다. 색은 늘 팀색이다(modeColor가 아니다): 개인색 모드에서는 아바타
                    테두리가 그 사람 색이라, 편을 말해 주는 자리가 하나는 있어야 한다.
                    방패 안에 팀 번호를 적는다(요청) — 색만으로는 "1팀이 파랑이던가"를
                    되물어야 하는데, 숫자가 앉으면 그 물음이 없다. */}
                {/* 11 → 15px(요청: 아바타 방패 크기 증가) — 아바타가 24px로 커진 뒤라
                    방패가 그 절반은 돼야 어깨 장식이 아니라 표식으로 읽힌다. 숫자도 한
                    눈금 따라 큰다(scr-motion-base-team의 --n 참고). */}
                <span className="scr-motion-base-team">
                  <Shield size={15} strokeWidth={0} fill={TEAM_EDGE[m.team === 2 ? 2 : 1]} />
                  <i className="scr-motion-team-n">{m.team === 2 ? 2 : 1}</i>
                </span>
                {/* 재생이 끝나면 이긴 편에 트로피(요청) — 스냅의 승패 표시와 같은 자리. */}
                {winnerTeam && m.team === winnerTeam && t >= total - 0.5 && !m.ghost && (
                  <span className="scr-motion-trophy">🏆</span>
                )}
              </span>
              {m.withName && (
                <span
                  className={cx("scr-motion-base-name", "scr-motion-chip", m.team === 2 ? "scr-motion-team2" : "scr-motion-team1")}
                  style={chipStyle(m.key, m.team)}
                >
                  {m.name}
                </span>
              )}
              {/* 일꾼 줄은 자리를 늘 잡아 둔다(지적: 첫 장면에서 일꾼 줄이 생기며 아바타가
                  위로 밀렸다) — 마커는 세로 가운데 정렬이라 줄이 늘면 전체가 움직인다. */}
              {m.withName && (
                <span
                  className="scr-motion-workers"
                  style={workerN > 0 ? undefined : { visibility: "hidden" }}
                >
                  일꾼 {workerN || 0}
                </span>
              )}
            </span>
          );
        })}

        {/* 부대 자취 — 명령 좌표 기반 어림(모듈 주석). 부대(squadPts)마다 마커 하나씩이고,
            이름·수·심장박동은 주 부대(가장 최근 명령을 받은 쪽)에만 붙는다 — 수는 사람
            단위 어림이라 부대별로 가를 근거가 없다. 곁 부대는 잠잠해지면 걷는다(본대에
            합류했거나 정리된 것이다). 유닛 칩의 팀 방패는 뺐다(요청). */}
        {motion.players.flatMap((p, pi) => {
          const unit = unitNow(p, t);
          const team = teamOfRaw(p.raw);
          const squads = refinedSquads[pi];
          const raws = squadPts[pi];
          let primary = 0;
          let latest = -Infinity;
          raws.forEach((sq, si) => {
            let l = -Infinity;
            for (const [sec] of sq) { if (sec > t) break; l = sec; }
            if (l > latest) { latest = l; primary = si; }
          });
          // 규모 — 완성 누계에서 전투 시간만큼 깎은 곡선을 읽는다(sizeSeries 주석).
          let size = 0;
          for (const [sec, v] of sizeSeries.get(p.raw) ?? []) {
            if (sec > t) break;
            size = v;
          }
          size = Math.round(size);
          /* 유닛별 살아 있는 수의 어림 — 완성 누계 × 합계의 살아남은 비율. 유닛별 마커의
             수와 무명 부대의 구성 표기가 같이 쓴다. */
          let cumAll = 0;
          for (const d of completionsByRaw.get(p.raw) ?? []) {
            if (d > t) break;
            cumAll += 1;
          }
          const aliveShare = cumAll > 0 ? size / cumAll : 1;
          const aliveOf = (u: string): number => {
            let n = 0;
            for (const [du, doneSecs] of unitDoneByRaw.get(p.raw) ?? []) {
              if (du !== u) continue;
              for (const d of doneSecs) {
                if (d > t) break;
                n += 1;
              }
            }
            return Math.round(n * aliveShare);
          };
          /* 유닛별 마커(요청: 모든 유닛의 위치를 따로, 같은 종류끼리만 묶기) — 정체가
             드러난 자취(upts)의 부대들이다. 살아서 보이는 종류는 무명 부대의 구성 표기에서
             뺀다 — 같은 탱크가 제 마커와 부대 칩에 두 번 적히면 수가 배로 읽힌다. */
          const deadBy = (lastOrderSec: number): boolean => {
            for (const [a, b] of p.hot ?? []) {
              if (lastOrderSec >= a - 30 && lastOrderSec <= b && t > b + 8) return true;
            }
            return false;
          };
          const typeMarks = typeSquads[pi].flatMap((g, gi) => {
            const rp = g.walk;
            if (rp.length === 0 || t < rp[0][0]) return [];
            const pos = posAt(
              rp, t, terrain || isAirUnit(g.unit) ? null : { x: grid.width / 2, y: grid.height / 2 },
            );
            if (!pos) return [];
            let sinceCmd = Infinity;
            for (const [sec] of g.raw) {
              if (sec > t) break;
              sinceCmd = t - sec;
            }
            if (sinceCmd > SQUAD_FADE_SEC) return [];
            if (Number.isFinite(sinceCmd) && deadBy(t - sinceCmd)) return [];
            return [{ g, gi, pos, sinceCmd }];
          });
          const shownUnits = new Set(typeMarks.flatMap(({ g }) => BY_UNITS[g.unit] ?? [g.unit]));
          const typeNodes = typeMarks.map(({ g, gi, pos, sinceCmd }) => {
            const members = BY_UNITS[g.unit] ?? [g.unit];
            const alive = members.reduce((n, u) => n + aliveOf(u), 0);
            const label = `${UNIT_KO[g.unit] ?? g.unit}${alive > 0 ? ` ${alive}` : ""}`;
            const activeNow = pos.moving || sinceCmd <= ACTIVE_HOLD_SEC;
            return (
              <span
                key={`${p.raw}-u${g.unit}-${gi}`}
                className={cx(
                  "scr-motion-army",
                  activeNow ? "scr-motion-chip" : "scr-motion-dot",
                  team === 2 ? "scr-motion-team2" : "scr-motion-team1",
                  pos.stale && "scr-motion-army-stale",
                )}
                style={{
                  left: pct(pos.x, grid.width), top: pct(pos.y, grid.height),
                  ...(activeNow
                    ? { fontSize: Math.min(14, 8 + Math.round(Math.sqrt(Math.max(alive, 1)) * 1.4)), ...chipStyle(p.raw, team) }
                    : glyphStyle(p.raw, team)),
                }}
              >
                {activeNow ? label : "●"}
              </span>
            );
          });
          const squadNodes = squads.map((rp, si) => {
            /* 첫 부대 명령 전에는 아예 없다(지적: 시작하자마자 이상한 데 멈춰 있다) —
               posAt은 첫 점 이전이면 첫 점 자리를 돌려줘서, 병력이 생기기도 전에 마커가
               '앞으로 갈 자리'에 서 있었다. 그동안의 움직임은 정찰 점(spts)이 맡는다. */
            if (rp.length === 0 || t < rp[0][0]) return null;
            const pos = posAt(
              rp, t,
              terrain || isAirUnit(unit) ? null : { x: grid.width / 2, y: grid.height / 2 },
            );
            if (!pos) return null;
            // 활동 판정은 원본 명령 점으로 잰다 — 경로로 편 점은 촘촘해 늘 '방금'이 된다.
            let sinceCmd = Infinity;
            for (const [sec] of raws[si]) {
              if (sec > t) break;
              sinceCmd = t - sec;
            }
            if (si !== primary && sinceCmd > SQUAD_FADE_SEC) return null;
            /* 전투에서 정리된 부대(요청: 유닛은 새로 이동하지 않는 한 그 자리에 있고,
               전투 후 다시 액션이 없다면 그 전투에서 죽은 것). */
            if (Number.isFinite(sinceCmd) && deadBy(t - sinceCmd)) return null;
            const activeNow = pos.moving || sinceCmd <= ACTIVE_HOLD_SEC;
            const showName = si === primary && activeNow && !!unit && (size >= 1 || !!SCOUT_KO[unit]);
            const fontPx = Math.min(16, 8 + Math.round(Math.sqrt(size) * 1.6));
            /* 무명 부대의 구성 — 제 마커를 가진 종류(shownUnits)는 뺀다: 같은 탱크가 제
               마커와 부대 칩에 두 번 적히면 수가 배로 읽힌다. */
            const parts: [string, number][] = [];
            for (const [u] of unitDoneByRaw.get(p.raw) ?? []) {
              if (shownUnits.has(u)) continue;
              const alive = aliveOf(u);
              if (alive >= 1) parts.push([u, alive]);
            }
            parts.sort((a, b) => b[1] - a[1]);
            const composition = parts.map(([u, n]) => `${UNIT_KO[u]} ${n}`).join(" · ");
            /* 도형일 땐 뭉치지 않는다(지적: 이름일 때만 뭉침) — 규모만큼 낱개 점을 촘촘히
               흩어 놓는다(해바라기 나선 — 결정적이라 프레임마다 안 튄다). 곁 부대는 규모를
               모르니 점 하나다. */
            if (!showName) {
              const dots = si === primary ? Math.min(9, Math.max(1, Math.round(size / 3) || 1)) : 1;
              return Array.from({ length: dots }, (_, di) => {
                const r = di === 0 ? 0 : 0.7 + 0.55 * Math.sqrt(di);
                const dx = Math.cos(di * 2.4) * r;
                const dy = Math.sin(di * 2.4) * r;
                return (
                  <span
                    key={`${p.raw}-s${si}-d${di}`}
                    className={cx(
                      "scr-motion-army",
                      "scr-motion-dot",
                      team === 2 ? "scr-motion-team2" : "scr-motion-team1",
                      pos.stale && "scr-motion-army-stale",
                    )}
                    style={{
                      left: pct(pos.x + dx, grid.width), top: pct(pos.y + dy, grid.height),
                      ...glyphStyle(p.raw, team),
                    }}
                  >
                    ●
                  </span>
                );
              });
            }
            return (
              <span
                key={`${p.raw}-s${si}`}
                className={cx(
                  "scr-motion-army",
                  "scr-motion-chip",
                  "scr-motion-heartbeat",
                  team === 2 ? "scr-motion-team2" : "scr-motion-team1",
                  pos.stale && "scr-motion-army-stale",
                )}
                style={{
                  left: pct(pos.x, grid.width), top: pct(pos.y, grid.height),
                  fontSize: fontPx,
                  ...chipStyle(p.raw, team),
                }}
              >
                {/* 유닛 전부를 수와 함께 적는다(요청) — "질럿 8 · 드라군 4" 꼴. 구성이
                    비었으면(병력 어림 0) 우세 유닛 이름이나 점으로 물러난다. */}
                {composition || (UNIT_KO[unit] ? `${UNIT_KO[unit]} ${size}`.trim() : SCOUT_KO[unit] ?? "●")}
              </span>
            );
          });
          return [...typeNodes, ...squadNodes];
        })}

        {/* 정찰 자취 — 부대 자취에서 걷어낸 명령들이다(지적: 일꾼 정찰이 하나도 안
            보인다). 갈래(일꾼·수송선·정체 모름)와 부대로 갈라 각자의 점이고, 움직이거나
            방금 명령받은 동안은 이름이 뜬다(지적: 오버로드 이름이 안 나온다) — 정체 모를
            한 기는 저그면 오버로드라 부른다: 그 종족의 이름 없는 한 기는 대개 그것이다.
            명령이 이어지는 동안만 보이고 곧게 간다 — 정찰 하나에 지형 길찾기는 배보다
            배꼽이다. */}
        {motion.players.flatMap((p, pi) => {
          const race = bases.find((b) => b.key === p.raw)?.race;
          const team = teamOfRaw(p.raw);
          return scoutSquads[pi].map((g, gi) => {
            const rp = g.walk;
            if (rp.length === 0 || t < rp[0][0]) return null;
            const pos = posAt(rp, t, null);
            if (!pos || pos.stale) return null;
            // 사라짐도 명령 기준(지적: 갑자기 사라짐) — 걷는 중에는 안 걷힌다.
            let sinceCmd = Infinity;
            for (const [sec] of g.raw) {
              if (sec > t) break;
              sinceCmd = t - sec;
            }
            if (sinceCmd > LERP_MAX_GAP_SEC && !pos.moving) return null;
            /* 전투 판정(요청: 정찰 점에도) — 마지막 명령이 전투 창에 닿아 있고 그 전투가
               끝나고도 새 명령이 없으면, 그 정찰도 거기서 정리된 것이다. */
            if (Number.isFinite(sinceCmd)) {
              const lastOrderSec = t - sinceCmd;
              for (const [a, b] of p.hot ?? []) {
                if (lastOrderSec >= a - 30 && lastOrderSec <= b && t > b + 8) return null;
              }
            }
            const label = g.kind === "worker" ? "일꾼"
              : race === "저그" ? "오버로드"
                : g.kind === "carrier" ? "수송선" : "정찰";
            return (
              <span
                key={`s-${p.raw}-${g.kind}-${gi}`}
                className={cx("scr-motion-scout", team === 2 ? "scr-motion-team2" : "scr-motion-team1")}
                style={{
                  left: pct(pos.x, grid.width), top: pct(pos.y, grid.height),
                  ...glyphStyle(p.raw, team),
                }}
              >
                {pos.moving || sinceCmd <= ACTIVE_HOLD_SEC ? label : "●"}
              </span>
            );
          });
        })}

        {/* 마법 — 떨어진 자리에 이름이 잠깐 떠오른다. */}
        {castsNow.map(([, x, y, tech, raw], i) => (
          // 한글명을 모르는 기술은 아예 안 띄운다(요청: 텍스트는 전부 한글로).
          TECH_KO[tech] ? (
            <span
              key={`c-${i}`}
              className={cx("scr-motion-cast", "scr-motion-chip", teamOfRaw(raw) === 2 ? "scr-motion-team2" : "scr-motion-team1")}
              style={{ left: pct(x, grid.width), top: pct(y, grid.height), ...chipStyle(raw, teamOfRaw(raw)) }}
            >
              {TECH_KO[tech]}
            </span>
          ) : null
        ))}
      </div>

      {/* 지형 수정(요청: 미니맵 바로 아래 가운데) — 산 아이콘, 회원 누구나. */}
      {typeof grid.imageId === "number" && grid.image && (
        <div className="scr-motion-terrain-row">
          <button
            type="button" className="scr-motion-btn scr-motion-terrain"
            onClick={() => { setPlaying(false); setTerrainOpen(true); }}
            aria-label="지형 수정" title="지형 수정"
          >
            <Mountain size={12} />
          </button>
        </div>
      )}


      {/* 범례(요청) — 지도 위 도형이 뭔지 한 줄로. */}
      <div className="scr-motion-legend">
        <span>● 부대·유닛</span>
        <span>★ 본진</span>
        <span>■ 건물</span>
        <span>▲ 방어 건물</span>
        <span>✕ 파괴됨</span>
        <span>· 채굴 일꾼</span>
        <span><Hammer size={8} /> 건설 중</span>
      </div>

      {/* 조종간(요청: 두 줄) — 윗줄은 스크러버 하나, 아랫줄에 재생·배속·시간이 선다. */}
      <div className="scr-motion-bar">
        {/* 비제어 탐색바(지적: 드래그가 안 먹고 느림 — 위 rangeRef 주석). step이 없어야
            ×4에서도 손잡이가 툭툭 안 뛴다. --p는 지나온 자리를 채우는 그라데이션 경계다. */}
        <input
          ref={rangeRef}
          className="scr-motion-range" type="range"
          min={0} max={total} step="any" defaultValue={t}
          onPointerDown={() => { scrubbing.current = true; }}
          onPointerUp={() => { scrubbing.current = false; }}
          onPointerCancel={() => { scrubbing.current = false; }}
          onInput={(e) => {
            const el = e.target as HTMLInputElement;
            const v = Number(el.value);
            el.style.setProperty("--p", `${total > 0 ? (v / total) * 100 : 0}%`);
            // 지도는 프레임당 한 번만 따라온다 — 끌기 이벤트마다 그리면 손이 밀린다.
            if (seekPending.current === null) {
              requestAnimationFrame(() => {
                const sv = seekPending.current;
                seekPending.current = null;
                if (sv === null) return;
                setT(sv);
                setDone(sv >= total);
              });
            }
            seekPending.current = v;
          }}
          aria-label="재생 위치"
        />
      </div>
      <div className="scr-motion-bar scr-motion-bar-controls">
        {/* 차례가 곧 그리드 칸이다(지적: 재생이 줄 가운데, 배속은 왼쪽에 필터처럼) —
            [배속 | 재생 | 시간]. 재생 버튼을 먼저 적으면 왼쪽 칸에 앉아 버린다. */}
        <span className="scr-motion-speeds" role="group" aria-label="배속">
          {SPEEDS.map((v) => (
            <button
              key={v} type="button"
              className={cx("scr-motion-btn", "scr-motion-speed", speed === v && "scr-motion-speed-on")}
              onClick={() => setSpeed(v)}
            >
              ×{v}
            </button>
          ))}
          {/* 색 전환(요청: 전환 버튼 살림) — 팀색 ↔ 개인색. */}
          <button
            type="button" className="scr-motion-btn scr-motion-colorbtn"
            onClick={() => setColorMode((v) => (v === "team" ? "personal" : "team"))}
            title="색 기준 전환"
          >
            {colorMode === "team" ? "팀컬러" : "개인컬러"}
          </button>
        </span>
        {/* 옛 스냅 타임라인의 재생 버튼과 같은 꼴(요청) — 46px 완전 원, 속 채운 삼각형. */}
        <button
          type="button" className="scr-motion-play"
          onClick={() => {
            if (done) { setT(0); setDone(false); setPlaying(true); return; }
            setPlaying((v) => !v);
          }}
          aria-label={playing ? "일시정지" : "재생"}
        >
          {playing
            ? <Pause size={26} fill="currentColor" />
            : done
              ? <RotateCcw size={26} />
              : <Play size={26} fill="currentColor" />}
        </button>
        <span className="scr-motion-clock">{fmtClock(t)} / {fmtClock(total)}</span>
      </div>
      {terrainOpen && typeof grid.imageId === "number" && grid.image && (
        <TerrainReviewModal
          image={terrainModalImage}
          onClose={() => setTerrainOpen(false)}
          onSaved={(updated) => setWalkOverride(updated.walk ?? null)}
        />
      )}
    </div>
  );
}
