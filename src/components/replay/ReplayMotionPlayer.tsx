import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Cog, FlaskConical, Hammer, Maximize2, Mountain, Pause, Play, RotateCcw, Shield, X } from "lucide-react";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";
import TerrainReviewModal from "../../modals/TerrainReviewModal";
import Avatar from "../common/Avatar";
import { cx } from "../../utils/format";
import { UNIT_KO, BUILDING_KO, TECH_KO } from "../../utils/replaySummaryText";
import type { ReplayMapGrid } from "../../utils/replayParser";
import { isAirUnit, type MotionTrack, type SummaryMotion, type TrackPt } from "../../utils/replayMotion";
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

/** 배속 갈래(요청: 1·2·3·5·10·20) — 뜯어보는 ×1부터 훑어 넘기는 ×20까지. */
const SPEEDS = [1, 2, 3, 5, 10, 20] as const;
/** 착공 직후 이름이 떠 있는 시간(초) — 그 뒤로는 곧장 도형+망치다(요청: "건물은 처음
 *  짓기 시작할때 잠깐 이름으로 표시하고 아이콘에 망치"). 예전엔 다 지어지고도 한참
 *  이름이었는데, 그 시간 내내 이름이 화면을 차지했다. 생산·연구가 돌면 그때 다시
 *  이름이 뜬다. */
const BUILD_NAME_SEC = 6;
/** 건물이 바닥 위로 솟는 높이 몫(타일) — 캔버스는 발자국 비율에 이만큼을 더해 세로로
 *  길어지고, 그만큼 위로 올라앉아 바닥선은 발자국 그대로다(지적: "실제 건물은 바닥위에
 *  높이가 있어"). 높이는 발자국 폭에 비례한다(지적: "바닥이 좁으면 대체로 높이도 낮아")
 *  — 4칸짜리 커맨드는 1.6타일, 2칸짜리 파일런은 0.8타일 솟는다. 높은 건물이 제 뒤(위쪽)
 *  건물을 가릴 수 있는 것은 사선 뷰의 원래 모습이고, 겹침 차례는 y가 큰(앞) 건물이
 *  이긴다(렌더 정렬). */
/** 높이가 거의 없는 납작이들(지적: 포토캐논·성큰·벙커) — 높이 몫을 확 줄인다. */
const FLAT_BUILDINGS = new Set(["Photon Cannon", "Sunken Colony", "Bunker"]);
const riseOf = (unit: string): number =>
  (FOOTPRINT[unit] ?? [3, 2])[0] * (FLAT_BUILDINGS.has(unit) ? 0.12 : 0.4);
/** 마법 텍스트가 떠 있는 시간(초, 게임 시간). */
const CAST_HOLD_SEC = 6;
/** 자취 점 사이가 이보다 벌어지면 잇지 않고 건너뛴다(초) — 한참 조용하다 다른 곳을 찍은
 *  것은 이동이 아니라 시선 전환이라, 이으면 부대가 맵을 순간이동으로 가로지른다. */
const LERP_MAX_GAP_SEC = 24;
/** 보간이 낼 수 있는 최고 속도(타일/초) — 이보다 빨라야 닿는 두 점은 잇지 않고 앞 점에
 *  머문다(지적: "아직도 유닛 갑자기 빠르게 이동하는 말도안되는 현상이"). 자취는 걷기
 *  (walkTrack)로 속도가 눌려 있지만, 부대 재배정·틈새로 새는 점이 남긴 초고속 미끄러짐을
 *  여기서 마지막으로 막는다. 스커지(6.7타일/초)가 실제 최고라 8이면 진짜 이동은 안 걸린다. */
const GLIDE_MAX_SPEED = 8;
/** 전투가 끝나고 이만큼 침묵해야 '그 전투에서 정리됐다'고 본다(초) — 요청: "유닛 죽은게
 *  확실하지 않으면 남겨놓기". 예전 8초는 잠깐 손을 뗀 부대까지 걷어냈다. */
const DEAD_QUIET_SEC = 45;

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
/** 유닛별 마커의 뭉침 반경(요청: "같은 종류유닛을 무조건 뭉치는게 아니라 아주 가까울때만")
 *  — 부대 반경보다 훨씬 좁다. */
const TYPE_MERGE_TILES = 6;
const SQUAD_MAX = 4;
/** 다 찼을 때 이보다 먼 점은 아예 빠뜨린다(지적: 동선이 튄다) — 가장 가까운 부대에
 *  이어도 맵을 가로지르는 유령 걸음이 된다. */
const SQUAD_TELEPORT_TILES = 45;
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
  pts: TrackPt[], home?: [number, number] | null,
  mergeTiles: number = SQUAD_MERGE_TILES,
  /** 드랍 지점들(요청: 드랍십 태우고 내리는 게 반영 안 됨) — 갓 내린 자리 곁의 새 명령
   *  뭉치는 여기서 태어난 부대다(수송선이 날라 준 것이라 걸어온 자취가 없는 게 맞다). */
  warps?: [number, number, number][],
): TrackPt[][] {
  const squads: TrackPt[][] = [];
  // 직전 점이 들어간 부대 — 연속 클릭은 대개 같은 선택(같은 부대)의 것이다.
  let prevIdx = -1;
  /* 선택 묶음 번호(g) → 그 묶음이 마지막으로 들어간 부대(지적: 단축키 부대지정 뒤
     이동이 순간이동으로 보임) — 같은 부대지정으로 내린 명령은 거리와 무관하게 같은
     부대의 자취다. 자리 어림(가까운 부대)보다 굵은 근거라 먼저 본다. */
  const gToSquad = new Map<number, number>();
  for (let i = 0; i < pts.length; i += 1) {
    const pt = pts[i];
    const g = pt[3];
    if (g !== undefined) {
      const k = gToSquad.get(g);
      if (k !== undefined) {
        const last = squads[k][squads[k].length - 1];
        // 너무 멀면(TELEPORT 초과) 드랍·리콜로 옮겨진 것일 수 있다 — 아래 워프 시딩에 맡긴다.
        if (Math.hypot(last[1] - pt[1], last[2] - pt[2]) <= SQUAD_TELEPORT_TILES) {
          squads[k].push(pt);
          prevIdx = k;
          continue;
        }
      }
    }
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < squads.length; k += 1) {
      const last = squads[k][squads[k].length - 1];
      const d = Math.hypot(last[1] - pt[1], last[2] - pt[2]);
      if (d < bestD) { bestD = d; best = k; }
    }
    /* 순간이동 방지(지적: 이동 명령을 내리면 바로 그 자리로 가 버림) — 배정이 '목적지에서
       가장 가까운 부대'라, 목적지 곁에 한참 조용한 옛 부대가 있으면 그 부대가 명령을
       가로채 마커가 목적지에서 바로 켜졌다. 실제로 움직인 부대(직전 클릭과 같은 선택)는
       제자리인 채였다. 가장 가까운 부대가 한참(SQUAD_FADE_SEC) 조용했고, 직전 클릭의
       부대가 방금(10초 안)도 부려졌고 걸어갈 만한 거리(TELEPORT 이내)면, 직전 부대가
       그리로 이동한 것으로 본다 — 마커가 걸어간다. */
    if (best >= 0 && bestD <= mergeTiles && prevIdx >= 0 && prevIdx !== best) {
      const bl = squads[best][squads[best].length - 1];
      const pl = squads[prevIdx][squads[prevIdx].length - 1];
      if (pt[0] - bl[0] > SQUAD_FADE_SEC && pt[0] - pl[0] <= 10
        && Math.hypot(pl[1] - pt[1], pl[2] - pt[2]) <= SQUAD_TELEPORT_TILES) {
        best = prevIdx;
        bestD = Math.hypot(pl[1] - pt[1], pl[2] - pt[2]);
      }
    }
    /* 방향이 갈리면 바로 안 묶는다(지적: 멈춰 있거나 같은 방향일 때만 묶기 — 뮤탈
       나누기처럼 서로 다른 움직임은 딴 무리다) — 그 부대가 방금 가던 쪽에서 90도 넘게
       꺾이는 클릭은 아래 staysBehind 판정으로 넘긴다: 옛 방향 클릭이 곧 또 오면(교차
       클릭 = 나누기) 새 부대로 갈리고, 아니면(무리째 방향 전환) 그대로 잇는다. */
    let joinable = best >= 0 && bestD <= mergeTiles;
    if (joinable && squads.length < SQUAD_MAX) {
      const sq = squads[best];
      if (sq.length >= 2) {
        const prev = sq[sq.length - 2];
        const last = sq[sq.length - 1];
        const vx = last[1] - prev[1];
        const vy = last[2] - prev[2];
        const wx = pt[1] - last[1];
        const wy = pt[2] - last[2];
        const vlen = Math.hypot(vx, vy);
        const wlen = Math.hypot(wx, wy);
        if (vlen > 2 && wlen > 2 && (vx * wx + vy * wy) / (vlen * wlen) < 0) joinable = false;
      }
    }
    if (joinable) {
      squads[best].push(pt);
      prevIdx = best;
      if (g !== undefined) gToSquad.set(g, best);
      continue;
    }
    if (best >= 0) {
      const last = squads[best][squads[best].length - 1];
      let staysBehind = false;
      for (let j = i + 1; j < pts.length && pts[j][0] - pt[0] <= SQUAD_LOOKAHEAD_SEC; j += 1) {
        if (Math.hypot(pts[j][1] - last[1], pts[j][2] - last[2]) <= mergeTiles) {
          staysBehind = true;
          break;
        }
      }
      // 옛 자리가 곧 다시 안 쓰인다 — 무리째 이사다. 이어 걸어간다.
      if (!staysBehind) {
        squads[best].push(pt);
        prevIdx = best;
        if (g !== undefined) gToSquad.set(g, best);
        continue;
      }
    }
    if (squads.length < SQUAD_MAX) {
      /* 새 부대의 출발점(지적: 엉뚱한 데서 태어남) — 갓 내린 드랍 지점이 곁에 있으면
         거기서(수송선이 날라 줬다), 아니면 곁 부대의 마지막 자리, 그것도 없으면 본진이다.
         첫 명령의 좌표는 목적지라, 심어 주지 않으면 마커가 목적지에서 태어난다. */
      const warp = warps?.find(([ws, wx, wy]) =>
        pt[0] - ws >= 0 && pt[0] - ws <= 45 && Math.hypot(wx - pt[1], wy - pt[2]) <= 10);
      const from = best >= 0 ? squads[best][squads[best].length - 1] : null;
      const seed: [number, number] | null = warp ? [warp[1], warp[2]]
        : from ? [from[1], from[2]] : home ?? null;
      squads.push(seed && Math.hypot(seed[0] - pt[1], seed[1] - pt[2]) > SAME_SPOT_START_TILES
        ? [[pt[0], seed[0], seed[1]], pt] : [pt]);
      prevIdx = squads.length - 1;
      if (g !== undefined) gToSquad.set(g, prevIdx);
      continue;
    }
    /* 다 찼으면 가장 가까운 부대가 그리로 걸어간다(지적: 순간이동) — 예전에는 가장 오래
       조용한 부대를 골라, 맵 반대편의 부대가 유령처럼 가로질러 걸었다. 그마저도 아주 멀면
       빠뜨린다 — 놓치는 것보다 유령이 더 큰 거짓말이다. */
    if (bestD <= SQUAD_TELEPORT_TILES) {
      squads[best].push(pt);
      prevIdx = best;
      if (g !== undefined) gToSquad.set(g, best);
    }
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
/* 12 → 25초(요청: 액티브 상태 더 오래) — 이름이 너무 빨리 점으로 꺼져, 훑어보는 눈이
   따라가기 전에 정보가 사라졌다. */
const ACTIVE_HOLD_SEC = 25;
/** 갓 뽑힌 유닛이 부대를 깨우는 창(요청: 생산 직후 액티브) — 완성이 이 안이면 이름이 뜬다. */
const FRESH_ACTIVE_SEC = 15;
/** 띄운 건물의 비행 속도(타일/초) — 착륙 이사를 잇는 자다. */
const BUILDING_FLY_SPEED = 1.2;
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

/** 건물 발자국(타일 폭·높이) — 건설 커맨드의 좌표는 발자국의 왼쪽 위 타일이라(스크렙),
 *  그대로 앵커에 놓으면 건물마다 반 발자국씩 왼쪽 위로 치우친다(지적: "맵 안의 요소들은
 *  또 맵의 왼쪽으로 살짝 치우쳤어"). 반 발자국을 더해 가운데에 그린다. 표에 없는 건물은
 *  가장 흔한 3×2로 어림한다 — 반 타일 안쪽의 오차는 눈에 안 걸린다. */
const FOOTPRINT: Record<string, [number, number]> = {
  "Command Center": [4, 3], Nexus: [4, 3], Hatchery: [4, 3], Lair: [4, 3], Hive: [4, 3],
  Barracks: [4, 3], Factory: [4, 3], Starport: [4, 3], "Science Facility": [4, 3],
  Gateway: [4, 3], Stargate: [4, 3], "Engineering Bay": [4, 3],
  Refinery: [4, 2], Assimilator: [4, 2], Extractor: [4, 2],
  Pylon: [2, 2], "Missile Turret": [2, 2], "Photon Cannon": [2, 2],
  "Creep Colony": [2, 2], "Sunken Colony": [2, 2], "Spore Colony": [2, 2],
  Spire: [2, 2], "Greater Spire": [2, 2], "Nydus Canal": [2, 2],
};
const footDx = (unit: string): number => (FOOTPRINT[unit] ?? [3, 2])[0] / 2;
const footDy = (unit: string): number => (FOOTPRINT[unit] ?? [3, 2])[1] / 2;

/** 건물 전용 도형(요청) — 파일런 마름모·서플 사다리꼴·벙커 무덤·커맨드 큰 무덤·넥서스
 *  큰 피라미드·게이트 삼각형·해처리 거꾸로 T·레어 육각별·하이브 육각형.
 *  이모지·글꼴 글리프가 아니라 벡터로 직접 그린다(요청) — 이모지는 제 색을 고집해 유저
 *  색을 못 입고, 글꼴 도형은 글꼴마다 크기·잉크가 다르다. currentColor를 채우므로 색은
 *  글자와 똑같이 탄다. 커맨드/넥서스/해처리 계열은 본진 크기(-hall)라 벙커의 작은 무덤과
 *  구분된다. 나머지 건물은 ■/▲/★ 기본 규칙 그대로다. */
const SHAPE_KIND: Record<string, string> = {
  // 벙커는 납작한 무덤, 포토캐논은 납작한 태엽(요청) — 커맨드의 큰 무덤과 갈린다.
  // 성큰은 동그라미에 가시, 터렛은 네모 위에 기울어진 네모(요청).
  Pylon: "diamond", "Supply Depot": "trapezoid", Bunker: "tombFlat", "Photon Cannon": "coil",
  // 스포어는 봉오리 머리에 밑동 촉수(요청: 게임 스크린샷 참고).
  "Sunken Colony": "sunken", "Spore Colony": "spore", "Missile Turret": "turret",
  // 넥서스는 넙적한 세모+양옆 기둥, 게이트는 원 위의 가파른 삼각(요청).
  "Command Center": "tomb", Nexus: "pyramidWide", Gateway: "gate",
  /* 저그 본진 3형제(요청) — 해처리는 곡선 둔덕(각진 T는 부자연스럽다는 지적), 레어는
     그 둔덕의 바닥에 뿔, 하이브는 더 높은 뿔에 안쪽 가시까지 — 단계가 오를수록 뿔이
     자란다. */
  Hatchery: "hatchery", Lair: "lair", Hive: "hive",
  /* 다른 생산 건물도 원래 실루엣을 살린 벡터로(요청) — 배럭은 측면에서 본 정육면체(요청),
     팩토리는 8각 단면 각기둥(스크린샷), 스타포트는 원형 착륙 패드(스크린샷 — 종이비행기
     설명은 오해), 로보틱스는 돔, 스타게이트는 문(아치). */
  Barracks: "cube", Factory: "factory", Starport: "plane",
  "Robotics Facility": "dome", Stargate: "arch",
  // (삭제) 가스 건물 — 직접 그린 게 아니라 네모로 돌아갔다(지적). 크기는 발자국(4×2)이 맞춘다.
};
/** 저그 둔덕 몸통 — 셋이 같은 몸을 쓰고 뿔만 자란다(아래 lair/hive). 옆구리는 종 모양
 *  으로 불룩하게(지적: "해처리의 곡선이 반대로 됨" — 나팔처럼 파인 곡선을 뒤집었다).
 *  꼭대기는 평평하고, 높이보다 옆으로 넓다(지적). */
/* 후지산 옆모습(지적: 뚱뚱하면 안 된다 — 위쪽은 거의 직선으로 가파르고 내려갈수록
   완만하게 벌어지는 오목 곡선), 바닥은 거미줄처럼 사방으로 퍼지는 가닥들(지적). */
// 머리(윗부분) 폭을 한 단 좁혔다(지적: 너무 두꺼움).
const ZERG_MOUND = "M6.2 4 Q8 3.3 9.8 4 Q10.5 10 14.2 12.6 Q8 13.8 1.8 12.6 Q5.5 10 6.2 4 Z"
  /* 다리는 옆으로 나가며 위로 펼쳐지는 뭉뚝한 갈래다(지적: 아래로 처지면 나무뿌리 같다)
     — 게처럼 끝이 밑동보다 위에 선다. */
  + " M4.6 11 Q2 11.4 1 9 Q2.6 10 4.2 9.9 Z"
  + " M4 12.4 Q1.6 13 0.6 11.6 Q2.4 12 4.4 11.6 Z"
  + " M11.4 11 Q14 11.4 15 9 Q13.4 10 11.8 9.9 Z"
  + " M12 12.4 Q14.4 13 15.4 11.6 Q13.6 12 11.6 11.6 Z"
  + " M7.3 13.2 Q7.2 14.6 8 14.8 Q8.8 14.6 8.9 13.2 Z";
/** 저그 본진 머리의 평평한 윗면(요청) — 둥근 머리 위 밝은 타원. 더 얇게(지적: 뚜껑). */
const ZERG_TOP = "M6.6 3.85a1.4 0.45 0 1 0 2.8 0a1.4 0.45 0 1 0-2.8 0Z";
/* 전부 입체(면 겹침)로 옮겼다(요청: "무조건 입체로") — 홑겹 도형은 이제 없다. */
const SHAPE_PATHS: Record<string, string> = {};
/** 본진 아바타용 실루엣(요청: "아바타를 본진 안에", "아바타용 모양들도 크기 비슷하게") —
 *  건물 도형을 그대로 쓰면 종족마다 덩치가 달라(피라미드는 뾰족해 얼굴이 좁고, 커맨드의
 *  떠 있는 판은 사진 조각을 따로 남긴다) 셋을 비슷한 부피로 다시 깎은 판이다.
 *  장식(커맨드 꼭대기 판, 넥서스 양옆 기둥)도 함께 단다(요청: "아바타에도 장식 요소 다") —
 *  사진은 몸통(body)에만 담고 장식(deco)은 사진 위에 색으로 얹는다: 장식까지 클립에 넣으면
 *  떨어진 판·기둥 속에 사진 조각이 따로 남는다. 해처리는 건물 자체에 장식이 없어 몸통뿐이다
 *  (뿔은 레어부터다). */
const AVATAR_HALL_PATHS: Record<string, { body: string; deco?: string; dy: number }> = {
  /* dy — 동그란 아바타가 실루엣 배 속에 쏙 들어가는 세로 자리(px, 40px 상자 기준, 지적:
     "아바타가 쏙 들어가게 크기 위치 조정"). 도형마다 배가 앉은 높이가 달라 하나로 못
     맞춘다(피라미드는 아래가 넓고 돔은 가운데다).
     모양은 건물 도형을 따라간다(요청: "아바타용도 모양 같이 맞춰가야해") — 커맨드 돔+판,
     잘린 피라미드+기둥, 저그 둔덕+거미줄 밑동. */
  테란: {
    // 건물 커맨드와 같은 결(요청: 아바타 모양도 맞추기) — 돔 + 둥근 바닥 + 꼭대기 판.
    body: "M1.5 12 Q1.5 4.8 8 4.8 Q14.5 4.8 14.5 12 Q13.2 14.4 8 14.4 Q2.8 14.4 1.5 12 Z",
    deco: "M6.2 2.8 H9.8 V3.6 H6.2 Z",
    dy: 3,
  },
  프로토스: {
    // 건물 넥서스와 같은 결 — 뾰족한 넙적 피라미드 + 두 직선 바닥 + 양옆 기둥.
    body: "M8 3 L15.8 12.4 L8 14.8 L0.2 12.4 Z",
    deco: "M1.6 13.2 L2.8 5.8 L4.4 13.8 Z M14.4 13.2 L13.2 5.8 L11.6 13.8 Z",
    dy: 5,
  },
  저그: {
    // 건물 해처리와 같은 후지산 결이되, 원형 아바타가 담기게 옆으로 벌린 판.
    // 다리(위로 펼쳐지는 뭉뚝한 갈래)도 함께 단다(요청: 아바타에도 다리 표현).
    body: "M4.6 4.4 Q8 3.4 11.4 4.4 Q12 10 15 12.8 Q8 14.2 1 12.8 Q4 10 4.6 4.4 Z"
      + " M3.8 11.2 Q1.4 11.6 0.4 9.4 Q2 10.3 3.6 10.2 Z"
      + " M3.4 12.9 Q1 13.5 0 12.1 Q1.8 12.5 3.8 12.1 Z"
      + " M12.2 11.2 Q14.6 11.6 15.6 9.4 Q14 10.3 12.4 10.2 Z"
      + " M12.6 12.9 Q15 13.5 16 12.1 Q14.2 12.5 12.2 12.1 Z"
      + " M7.3 13.6 Q7.2 15 8 15.2 Q8.8 15 8.9 13.6 Z",
    dy: 4,
  },
};
/** 저그 아바타의 단계 장식(요청: "해처리 아바타도 레어 하이브 다 표현") — 그 시각에
 *  살아 있는 최고 단계 건물을 따라간다. 레어는 바닥 뿔, 하이브는 본체보다 긴 뿔 셋. */
const AVATAR_ZERG_DECO: Record<string, string | undefined> = {
  hatchery: undefined,
  lair: "M2.4 12.2 L1.2 8 L4.2 10.8 Z M13.6 12.2 L14.8 8 L11.8 10.8 Z",
  hive: "M2 12.2 Q0.8 6.4 2.4 0.8 Q3.4 6.6 4.4 11 Z"
    + " M6.9 10.4 Q7.3 3.8 8 0.3 Q8.7 3.8 9.1 10.4 Z"
    + " M14 12.2 Q15.2 6.4 13.6 0.8 Q12.6 6.6 11.6 11 Z",
};

/** 여러 면으로 그리는 도형 — [패스, 불투명도, 색?] 목록. 색을 안 주면 currentColor다.
 *  한 색 위에 흰/검 반투명을 겹쳐 밝은 윗면·어두운 옆면을 만든다(입체 사선 뷰). */
const SHAPE_FACES: Record<string, [string, number, string?][]> = {
  /* 배럭 — 살짝만 입체(지적), 옆면이 좀 긴 직사각형(지적). 높이는 낮춘다(지적).
     다리 넷 중 셋이 보인다(요청: 입체라 하나는 가려짐). */
  cube: [
    ["M2 7 L9 7 L14 5.2 L7 5.2 Z", 1],
    ["M2 7 L9 7 L14 5.2 L7 5.2 Z", 0.3, "#fff"],
    ["M2 7 L9 7 L9 13.2 L2 13.2 Z", 1],
    ["M9 7 L14 5.2 L14 11.4 L9 13.2 Z", 1],
    ["M9 7 L14 5.2 L14 11.4 L9 13.2 Z", 0.35, "#000"],
    ["M2.6 13.2 V14.6 H3.6 V13.2 Z M7.4 13.2 V14.6 H8.4 V13.2 Z M12.6 11.9 L13.6 11.5 V12.9 L12.6 13.3 Z", 1],
  ],
  /* 팩토리 — 8각 단면의 각기둥을 사선으로 본 것(지적: 옆면이 8각, 앞면의 위아래 꺾임은
     그 단면의 앞모서리를 공유한다). 스크린샷 대조(지적: 설명과 다름) — 옆면은 더 작고
     정팔각형에 가깝게, 앞면은 더 넓게, 앞면 밑에는 평평한 발 셋이 받친다. */
  factory: [
    // 윗면이 살짝 보이는 각도(요청) — 앞-위 꺾임면을 더 깊게 눕힌다.
    ["M1 6.6 L11 6.6 L12.4 4.8 L2.4 4.8 Z", 1],
    ["M1 6.6 L11 6.6 L12.4 4.8 L2.4 4.8 Z", 0.3, "#fff"],
    ["M1 6.6 L11 6.6 L11 10.6 L1 10.6 Z", 1],
    ["M1 10.6 L11 10.6 L11.8 12 L1.8 12 Z", 1],
    ["M1 10.6 L11 10.6 L11.8 12 L1.8 12 Z", 0.3, "#000"],
    ["M11 6.6 L12.4 4.8 L13.8 4.8 L14.6 6.6 L14.6 10.6 L13.8 12 L11.8 12 L11 10.6 Z", 1],
    ["M11 6.6 L12.4 4.8 L13.8 4.8 L14.6 6.6 L14.6 10.6 L13.8 12 L11.8 12 L11 10.6 Z", 0.35, "#000"],
    ["M2 12 H4 V13.2 H2 Z M5.5 12 H7.5 V13.2 H5.5 Z M9 12 H11 V13.2 H9 Z", 1],
  ],
  /* 커맨드 — 사선으로 본 입체(요청): 돔 위에 밝은 윗면 타원, 꼭대기 판은 그대로.
     바닥은 네모난 발자국을 모서리로 본 두 직선이다(지적: 해처리는 둥글고 넥서스·커맨드는
     직선이라야 사선 뷰가 갈린다). */
  tomb: [
    // 바닥도 둥글다(지적: 직각·직선이 아니라) — 아래로 살짝 부푼 타원 배.
    ["M1.5 12 Q1.5 4.8 8 4.8 Q14.5 4.8 14.5 12 Q13.2 14.4 8 14.4 Q2.8 14.4 1.5 12 Z", 1],
    ["M3.4 6.4a4.6 1.5 0 1 0 9.2 0a4.6 1.5 0 1 0-9.2 0Z", 0.28, "#fff"],
    ["M6.2 3.6 H9.8 V4.3 H6.2 Z", 1],
  ],
  /* 넥서스 — 뾰족한 넙적 피라미드 그대로(지적: 위를 자르지 말 것) + 양옆 기둥. 사선
     느낌은 바닥의 두 직선(모서리로 본 네모 발자국)이 낸다(지적). */
  pyramidWide: [
    ["M8 4.5 L16 12.6 L8 14.8 L0 12.6 Z", 1],
    ["M8 4.5 L16 12.6 L8 14.8 Z", 0.22, "#000"],
    // 기둥은 좌우 모서리 끝에(지적) — 바닥 꼭짓점(0·16, y12.6) 바로 위에서 솟는다.
    ["M0.2 13 L1.3 5.8 L2.8 13.4 Z", 1],
    ["M15.8 13 L14.7 5.8 L13.2 13.4 Z", 1],
  ],
  /* 저그 본진 3형제 — 몸통 + 밝은 윗면(요청: "해처리 윗부분 동그란 평평한 면 표현").
     레어·하이브는 그 위에 뿔·가시(요청). */
  hatchery: [[ZERG_MOUND, 1], [ZERG_TOP, 0.3, "#fff"]],
  /* 레어 — 바닥 뿔은 하이브보다 확실히 작게(지적). */
  lair: [
    [`${ZERG_MOUND} M2.8 12.2 L2 9.2 L4.4 11.2 Z M13.2 12.2 L14 9.2 L11.6 11.2 Z`, 1],
    [ZERG_TOP, 0.3, "#fff"],
  ],
  /* 하이브 — 본 건물보다 훨씬 긴 뿔 셋이 위로 솟고, 가시는 그 뿔에서 본 건물 쪽(안쪽)
     으로 난다(지적). */
  hive: [
    [`${ZERG_MOUND}`
      + " M2 12.4 Q0.8 6.6 2.4 0.8 Q3.4 6.6 4.4 11.4 Z"
      + " M6.9 11 Q7.3 4 8 0.3 Q8.7 4 9.1 11 Z"
      + " M14 12.4 Q15.2 6.6 13.6 0.8 Q12.6 6.6 11.6 11.4 Z"
      + " M2.9 7.4 L5.6 8.6 L3.4 9.6 Z M13.1 7.4 L10.4 8.6 L12.6 9.6 Z", 1],
    [ZERG_TOP, 0.3, "#fff"],
  ],
  /* 파일런 — 얇은 마름모 크리스탈의 허리를 둘러싼 납작한 고리(요청: "기둥을 둘러싼
     고리") — 토성 고리처럼 좌우로 삐져나온다. */
  diamond: [
    ["M8 1 12 8 8 15 4 8Z", 1],
    // 왼쪽 면을 밝혀 크리스탈의 입체를 살린다(요청: 전부 입체).
    ["M8 1 L4 8 L8 15 Z", 0.25, "#fff"],
    // 안쪽 타원은 감는 방향을 뒤집어 구멍이 된다(nonzero 규칙) — 그래야 '고리'다.
    ["M2.6 8a5.4 1.5 0 1 0 10.8 0a5.4 1.5 0 1 0-10.8 0Z M4 8a4 0.9 0 1 1 8 0a4 0.9 0 1 1-8 0Z", 0.4, "#000"],
  ],
  /* 스타포트 — 스크린샷 대조(지적: 종이비행기 설명은 오해였다): 몸통 위에 큰 원형 착륙
     패드가 얹히고, 대각선으로 안테나 팔(끝에 둥근 등)이 뻗으며, 벌어진 다리들이 받친다.
     패드를 맨 나중에 그려 팔·몸통의 밑동을 덮는다(패드 뒤에서 나온 것처럼). */
  plane: [
    // 맞보는 날개 한 쌍(요청: 왼쪽 위·오른쪽 아래에 작게).
    ["M1.6 4.2 L4.6 5.2 L4 6.5 L1 5.5 Z M14.4 10.6 L11.4 9.6 L12 8.3 L15 9.3 Z", 1],
    ["M1.6 4.2 L4.6 5.2 L4 6.5 L1 5.5 Z M14.4 10.6 L11.4 9.6 L12 8.3 L15 9.3 Z", 0.25, "#000"],
    // 왼쪽 아래로 툭 튀어나온 덩이(요청).
    ["M1 9 H4.4 V11.2 H1 Z", 1],
    ["M1 9 H4.4 V11.2 H1 Z", 0.3, "#000"],
    // 다리 — 받침 없이(지적) 패드 밑에 바로 붙어 벌어지는 발 셋.
    ["M4 9.8 L2.6 13.2 L5 13.2 Z M7.6 10.4 L6.6 14 L9.2 14 Z M11.6 9.8 L11 13.2 L13.4 13.2 Z", 1],
    ["M4 9.8 L2.6 13.2 L5 13.2 Z M7.6 10.4 L6.6 14 L9.2 14 Z M11.6 9.8 L11 13.2 L13.4 13.2 Z", 0.35, "#000"],
    // 착륙 패드 — 큰 타원 링 위에 밝은 테, 가운데는 살짝 꺼진 판. 맨 나중에 그려
    // 날개·돌출부·다리의 밑동을 덮는다.
    ["M2.4 7.2a5.6 3 0 1 0 11.2 0a5.6 3 0 1 0-11.2 0Z", 1],
    ["M3.7 7.2a4.3 2.2 0 1 0 8.6 0a4.3 2.2 0 1 0-8.6 0Z", 0.28, "#fff"],
    ["M4.7 7.2a3.3 1.7 0 1 0 6.6 0a3.3 1.7 0 1 0-6.6 0Z", 0.25, "#000"],
  ],
  /* 스타게이트 — 똑같은 긴 마름모 두 개가 나란히 사선으로 붙는다(지적: 둘이 같은
     모양이라야 한다). */
  /* 두 마름모는 같은 색이다(지적: 색이 갈리면 딴 건물로 보인다) — 입체감은 각자의
     오른쪽 반쪽에만 같은 농도의 그늘로 준다. 둘은 바짝 붙는다(지적). */
  arch: [
    ["M4 2 L7.4 5 L5.6 12.4 L2.2 9.4 Z", 1],
    ["M4 2 L7.4 5 L5.6 12.4 Z", 0.2, "#000"],
    ["M8 3.4 L11.4 6.4 L9.6 13.8 L6.2 10.8 Z", 1],
    ["M8 3.4 L11.4 6.4 L9.6 13.8 Z", 0.2, "#000"],
  ],
  /* 게이트 — 원판 위 가파른 삼각, 원판 가운데 밝은 원(지적: 가운데 원은 게이트웨이 것). */
  gate: [
    ["M8 4 L11 11.8 L5 11.8 Z", 1],
    // 첨탑 오른쪽 면은 어둡게 — 입체(요청).
    ["M8 4 L11 11.8 L8 11.8 Z", 0.22, "#000"],
    ["M2.4 12.4a5.6 2 0 1 0 11.2 0a5.6 2 0 1 0-11.2 0Z", 1],
    // 소환구 원은 더 크고 위로(지적), 색은 어둡게 — 뚫린 그림자 느낌(요청). 왼쪽으로
    // 치우치고(요청 두 번), 위-우측에서 내려다본 기울어진 타원(요청) — 호 회전 +18도
    // (지적: 경사가 반대였다).
    ["M5.3 10.78a2 1.2 18 1 0 3.8 1.24a2 1.2 18 1 0-3.8-1.24Z", 0.45, "#000"],
  ],
  /* 나머지 건물도 전부 위 오른쪽 사선 입체(요청: "모든 건물이 위 우측에서 본 사선") —
     밝은 윗면 한 겹씩. */
  /* 벙커 — 납작한 사각 상자 위에 둥근 무덤이 올라앉은 것을 위-오른쪽에서 본 모습(지적:
     입체가 아니었다). */
  tombFlat: [
    // 상자 윗면(밝음) — 위-오른쪽 사선.
    ["M2.4 9.6 L3.6 8.2 L15 8.2 L13.8 9.6 Z", 1],
    ["M2.4 9.6 L3.6 8.2 L15 8.2 L13.8 9.6 Z", 0.3, "#fff"],
    // 상자 앞면.
    ["M2.4 9.6 H13.8 V12.6 H2.4 Z", 1],
    // 상자 오른쪽 옆면(어두움).
    ["M13.8 9.6 L15 8.2 L15 11.2 L13.8 12.6 Z", 1],
    ["M13.8 9.6 L15 8.2 L15 11.2 L13.8 12.6 Z", 0.35, "#000"],
    // 둥근 무덤 — 상자 윗면 가운데에 앉는다.
    ["M4.6 8.2 Q4.6 4.6 8.6 4.6 Q12.6 4.6 12.6 8.2 Z", 1],
    ["M5.6 6a1.6 0.8 0 1 0 3.2 0a1.6 0.8 0 1 0-3.2 0Z", 0.3, "#fff"],
  ],
  /* 서플라이 — 제대로 된 사선 상자(지적: "옆면과 윗면도 보이게 사선으로") — 살짝 기운
     앞면 + 밝은 윗면 + 어두운 옆면, 앞면에 동그라미 해치 둘(요청). */
  trapezoid: [
    ["M2.6 6.6 L10.6 6.6 L13 5 L5 5 Z", 1],
    ["M2.6 6.6 L10.6 6.6 L13 5 L5 5 Z", 0.3, "#fff"],
    ["M2.6 6.6 L10.6 6.6 L11 12.8 L2.2 12.8 Z", 1],
    ["M10.6 6.6 L13 5 L13.4 11.2 L11 12.8 Z", 1],
    ["M10.6 6.6 L13 5 L13.4 11.2 L11 12.8 Z", 0.35, "#000"],
    // 앞면 원 둘은 더 크게(지적).
    ["M3.6 9.9a1.8 1.5 0 1 0 3.6 0a1.8 1.5 0 1 0-3.6 0Z M7.4 9.9a1.8 1.5 0 1 0 3.6 0a1.8 1.5 0 1 0-3.6 0Z", 0.3, "#000"],
  ],
  /* (삭제) 가스 — 직접 그린 게 아니라 네모로 돌아갔다(지적). */
  /* 로보틱스 — 뭉뚝한 꼬깔모자(요청): 위가 둥글게 잘린 원뿔이 넓은 받침에 앉는다.
     몸통에는 격자무늬(요청) — 가로 두 줄·세로 두 줄의 옅은 골. */
  dome: [
    ["M6 4.6 Q8 3.8 10 4.6 L12.2 11.4 L3.8 11.4 Z", 1],
    ["M6.6 4.4a1.5 0.55 0 1 0 3 0a1.5 0.55 0 1 0-3 0Z", 0.3, "#fff"],
    ["M5.3 6.6 H10.7 V7 H5.3 Z M4.5 9.2 H11.5 V9.6 H4.5 Z M6.8 5 H7.2 V11.4 H6.8 Z M8.8 5 H9.2 V11.4 H8.8 Z", 0.28, "#000"],
    ["M2 13.4 Q2 11.4 3.8 11.4 L12.2 11.4 Q14 11.4 14 13.4 Z", 1],
    ["M2 13.4 Q2 11.4 3.8 11.4 L12.2 11.4 Q14 11.4 14 13.4 Z", 0.25, "#000"],
  ],
  /* 터렛 — 옆에서 본 미사일 포드 두 개가 대각선으로 눕고(지적), 그 아래 기둥은 좀 더
     높다(지적). 포드 끝(위 오른쪽)은 밝은 캡. */
  turret: [
    // 기둥은 더 크게(지적) — 폭·높이 다 키운다.
    ["M5.8 15.4 H10.2 V8.8 H5.8 Z", 1],
    ["M5.8 15.4 H10.2 V8.8 H5.8 Z", 0.3, "#000"],
    ["M3.6 8.8 L9 3.4 L10.6 5 L5.2 10.4 Z", 1],
    ["M5.6 10.8 L11 5.4 L12.6 7 L7.2 12.4 Z", 1],
    ["M9 3.4 L10.6 5 L9.8 5.8 L8.2 4.2 Z M11 5.4 L12.6 7 L11.8 7.8 L10.2 6.2 Z", 0.35, "#fff"],
  ],
  /* 포토캐논 — 톱니 두른 원(박카스 로고, 지적) + 아래 그림자·위 반짝임으로 입체. */
  coil: [
    ["M3 12.8a5 1.5 0 1 0 10 0a5 1.5 0 1 0-10 0Z", 0.3, "#000"],
    ["M8 3.1 L9.8 5.1 L12.8 4.5 L12.5 6.9 L15.3 8 L13.1 9.7 L14.4 12 L11.3 12.2 L10.5 14.6 L8 13.2 L5.5 14.6 L4.7 12.2 L1.6 12 L2.9 9.7 L0.7 8 L3.5 6.9 L3.2 4.5 L6.2 5.1 Z", 1],
    ["M5.4 7.4a2.6 1 0 1 0 5.2 0a2.6 1 0 1 0-5.2 0Z", 0.3, "#fff"],
  ],
  /* 성큰 — 넙적한 몸통 + 낫처럼 굽은 가시 둘(스크린샷) + 윗면 반짝임·밑 그림자로 입체. */
  sunken: [
    ["M2.4 13a5.6 1.4 0 1 0 11.2 0a5.6 1.4 0 1 0-11.2 0Z", 0.25, "#000"],
    ["M1.2 11.5a6.8 3.2 0 1 0 13.6 0a6.8 3.2 0 1 0-13.6 0Z"
      + " M4.2 9.8 Q2.4 6.2 4.8 3 Q4.2 6.4 6.2 9.2 Z"
      + " M11.8 9.8 Q13.6 6.2 11.2 3 Q11.8 6.4 9.8 9.2 Z", 1],
    ["M4.6 10.4a3.4 1 0 1 0 6.8 0a3.4 1 0 1 0-6.8 0Z", 0.22, "#fff"],
  ],
  /* 오버로드 — 풍선에 긴 다리 + 풍선 윗머리 반짝임으로 입체.
     다리는 옆으로 벌지 않고 수직으로 길게 떨어진다(지적). */
  ovie: [
    ["M3.6 6a4.4 4.2 0 1 0 8.8 0a4.4 4.2 0 1 0-8.8 0Z"
      + " M4.6 9.3 Q4.7 13.2 5.1 15.9 Q5.6 13.1 5.7 9.7 Z"
      + " M7.5 10.2 Q7.5 13.7 8 16 Q8.5 13.7 8.5 10.2 Z"
      + " M11.4 9.3 Q11.3 13.2 10.9 15.9 Q10.4 13.1 10.3 9.7 Z", 1],
    ["M5.2 4.4a1.8 1.1 0 1 0 3.6 0a1.8 1.1 0 1 0-3.6 0Z", 0.35, "#fff"],
  ],
  /* 드랍십 — 옆에서 본 뭉툭한 수송선(요청: 오버로드처럼 도형으로): 둥근 몸통, 오른쪽
     조종석 창, 왼쪽 위·아래 작은 핀. */
  dship: [
    ["M4 4.8 L2.2 3.2 L5.6 4.2 Z M4 10.6 L2.2 12.2 L5.6 11.2 Z", 1],
    ["M3 6.2 Q3 4.6 4.8 4.6 L10.2 4.6 Q12.8 4.8 13.8 6.8 Q14.2 7.8 13.6 8.8 Q12.4 10.8 9.8 10.8 L4.8 10.8 Q3 10.8 3 9.2 Z", 1],
    ["M4.4 5.4 L10 5.4 Q11.4 5.5 12.2 6.3 L4.8 6.3 Q4.2 6.3 4.4 5.4 Z", 0.3, "#fff"],
    ["M11.2 6.6a1 0.9 0 1 0 2 0a1 0.9 0 1 0-2 0Z", 0.45, "#fff"],
  ],
  /* 셔틀 — 위에서 본 넓적한 조개꼴(요청: 오버로드처럼 도형으로): 가운데 돔, 앞뒤로
     얇아지고 왼쪽 반은 그늘. */
  shuttle: [
    ["M1.6 8 Q4 4.4 8 4.2 Q12 4.4 14.4 8 Q12 11.6 8 11.8 Q4 11.6 1.6 8 Z", 1],
    ["M1.6 8 Q4 4.4 8 4.2 Q5.2 6.6 5 8 Q5.2 9.6 8 11.8 Q4 11.6 1.6 8 Z", 0.25, "#000"],
    ["M6 7.4a2 1.2 0 1 0 4 0a2 1.2 0 1 0-4 0Z", 0.3, "#fff"],
  ],
  /* 스포어 — 봉오리 머리(윗면 반짝임) + 밑동 둔덕 + 양옆 촉수(요청: 스크린샷 참고). */
  spore: [
    ["M2 13.6 Q2.4 10.8 5.2 10.2 L10.8 10.2 Q13.6 10.8 14 13.6 Z", 1],
    ["M3.4 10.6 Q1.6 9 2.8 6.6 Q2.8 9 4.8 10 Z M12.6 10.6 Q14.4 9 13.2 6.6 Q13.2 9 11.2 10 Z", 1],
    ["M4.6 6.6a3.4 3.2 0 1 0 6.8 0a3.4 3.2 0 1 0-6.8 0Z", 1],
    ["M6 5a1.6 0.7 0 1 0 3.2 0a1.6 0.7 0 1 0-3.2 0Z", 0.3, "#fff"],
  ],
  /* (삭제) slab — 이름 없는 기본 건물은 입체 상자가 아니라 예전 네모로 돌아갔다(지적:
     "입체표현은 직접 그린거만"). 크기만 발자국을 따른다. */
};
/** 도형째 돌려 그리는 각도(시계방향) — 스타게이트는 45도(요청). */
const SHAPE_ROT: Record<string, number> = { arch: 45 };
function ShapeIcon({ kind, className }: { kind: string; className?: string }) {
  const faces = SHAPE_FACES[kind];
  const rot = SHAPE_ROT[kind];
  return (
    // preserveAspectRatio="none" — 상자(발자국 비율)에 맞춰 그림째 눌린다(요청: 캔버스
    // 비율을 정확하게). 정사각 상자(유닛 마커 등)에서는 아무 일도 안 일어난다.
    <svg
      className={cx("scr-motion-shape-svg", className)}
      viewBox="0 0 16 16" preserveAspectRatio="none" aria-hidden
    >
      <g transform={rot ? `rotate(${rot} 8 8)` : undefined}>
        {faces
          ? faces.map(([d, op, fill], i) => <path key={i} d={d} fill={fill ?? "currentColor"} opacity={op} />)
          : <path d={SHAPE_PATHS[kind]} fill="currentColor" />}
      </g>
    </svg>
  );
}

/** 테란 부속건물 — 이름 대신 + 하나로 본체 옆에 붙는다(요청). 제 건설 좌표가 본체
 *  오른쪽 아래라 저절로 옆자리다. */
const ADDONS = new Set([
  "Comsat Station", "Nuclear Silo", "Machine Shop", "Control Tower", "Covert Ops", "Physics Lab",
]);

/** 폭 1칸짜리 실틈은 막힌 것으로 본다(요청: "벽과 벽 사이에 공간이 살짝 있어도 원래
 *  없을법한 적은 타일수면 막힌걸로") — 분석 격자의 틈새로 지상 유닛이 벽을 뚫고 다녔다.
 *  양옆(또는 위아래)이 다 막힌 외길 칸을 지운다. 화면에서만 조인다 — 저장된 지형은
 *  그대로다. */
function closeNarrowGaps(t: TerrainGrid): TerrainGrid {
  const walk = new Uint8Array(t.walk);
  for (let y = 0; y < t.h; y += 1) {
    for (let x = 0; x < t.w; x += 1) {
      const i = y * t.w + x;
      if (!t.walk[i]) continue;
      const blockedL = x <= 0 || !t.walk[i - 1];
      const blockedR = x >= t.w - 1 || !t.walk[i + 1];
      const blockedU = y <= 0 || !t.walk[i - t.w];
      const blockedD = y >= t.h - 1 || !t.walk[i + t.w];
      if ((blockedL && blockedR) || (blockedU && blockedD)) walk[i] = 0;
    }
  }
  return { ...t, walk };
}

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
      /* 말이 안 되는 속도의 미끄러짐은 잇지 않는다(지적) — 앞 점에 머물다 다음 점에서
         이어 간다. GLIDE_MAX_SPEED 주석 참고. */
      if (Math.hypot(x1 - x0, y1 - y0) / Math.max(0.001, s1 - s0) > GLIDE_MAX_SPEED) {
        return { x: x0, y: y0, stale: false, moving: false, sinceLast: t - s0 };
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
  grid, motion, endSec, bases, teamOfRaw, active = true, winnerTeam, side, menu,
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
  /** 확대 모드에서 맵 오른쪽 영역에 앉는 내용(지적: "리플" = 댓글) — 경기 결과의 댓글
   *  컴포넌트가 온다. 자막 패널로 오해했다가 바로잡았다. 인라인에선 안 그린다. */
  side?: React.ReactNode;
  /** 케밥 메뉴(요청: PC 기본이 확대인 만큼 확대 창에도 케밥·닫기) — 확대 창 오른쪽 위,
   *  닫기(X) 옆에 앉는다. 인라인에선 카드 윗줄의 원본이 이미 있으니 안 그린다. */
  menu?: React.ReactNode;
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
  /* 도형(●▪▲✕·점)은 건물이든 유닛이든 음영판 없이 제 색 그대로다(지적).
     그림자만 얇게 깐다(요청: "유닛 테두리 검정톤 그림자 약하게 추가") — 아주 밝은
     개인색(연두·노랑·흰색)은 밝은 맵에서 통째로 사라져 더 진한 링을 두른다(지적: "이색은
     흰색 바탕에서 잘 안보여"). */
  const glyphStyle = (raw: string, team: 1 | 2 | undefined): React.CSSProperties => {
    const c = modeColor(raw, team);
    return {
      color: c, background: "none", padding: 0,
      textShadow: lumOf(c) > 170
        ? "0 0 2px rgba(0, 0, 0, 0.9), 0 0 1px rgba(0, 0, 0, 0.9)"
        : "0 1px 2px rgba(0, 0, 0, 0.5)",
    };
  };
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
    if (reviewed) { setTerrain(closeNarrowGaps(reviewed)); return undefined; }
    if (!grid.image) { setTerrain(null); return undefined; }
    terrainOf(grid.image)
      .then((tg) => { if (!cancelled) setTerrain(tg ? closeNarrowGaps(tg) : tg); });
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
    speedOverride?: number, forceGround?: boolean,
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
      /* 무명 부대는 늘 지상 길찾기다(지적: 지상 유닛이 벽을 뚫고 다닌다) — 우세 유닛이
         공중(뮤탈 등)이면 부대 전체가 직선으로 날았는데, 그 부대엔 지상 유닛이 섞여
         있기 마련이라 벽 뚫기가 더 큰 거짓말이다. 정체를 아는 공중(typeSquads)만 곧게
         난다. */
      const air = !forceGround && unit !== "" && isAirUnit(unit);
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
      /* 정체를 아는 갈래(수송선·오버로드)는 곧게 날더라도 제 속도로 걷는다(지적: 오버로드
         이동이 뚝뚝 끊김 — 일꾼 걸음 3.7로 내달리곤 다음 명령까지 서 있어서, 실제 0.6짜리
         걸음과 전혀 다른 돌진·정지 반복이 됐다). 띄운 건물은 제 비행 속도(오버라이드)다. */
      const v = speedOverride ?? (straight && !forcedUnit
        ? SCOUT_WALK_SPEED
        : Math.max(0.5, speedOf(unit || "Marine", orderSec, p.ups)));
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
    /* 긴 걸음을 잘게 썬다(지적: 이동이 뚝뚝 끊김) — posAt은 LERP_MAX_GAP_SEC(24초)보다
       긴 구간을 침묵(시선 전환)으로 보고 잇지 않으므로, 오버로드(0.6타일/초)처럼 느린
       걸음 하나가 24초를 넘으면 출발점에 얼어 있다 도착점으로 튀었다. 이동 구간의 점
       사이가 그 문턱을 못 넘게 쪼갠다 — 대기(같은 좌표) 구간은 그대로 둔다. */
    const MAX_SEG_SEC = LERP_MAX_GAP_SEC - 4;
    const dense: [number, number, number][] = [out[0]];
    for (let i = 1; i < out.length; i += 1) {
      const [s0, x0, y0] = out[i - 1];
      const [s1, x1, y1] = out[i];
      const dur = s1 - s0;
      if (dur > MAX_SEG_SEC && (x0 !== x1 || y0 !== y1)) {
        const n = Math.ceil(dur / MAX_SEG_SEC);
        for (let k = 1; k < n; k += 1) {
          const f = k / n;
          dense.push([s0 + dur * f, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]);
        }
      }
      dense.push(out[i]);
    }
    return dense;
  };
  /* 부대 갈라 보기(요청: 유닛을 무조건 합치는 게 아니라 가까운 것만 합침) — 마커 하나가
     드랍조와 본대를 오가며 순간이동하던 자리다. 명령 점을 가까운 것끼리 묶어 부대 몇으로
     가르고, 어느 부대에서도 먼 점은 가장 오래 조용한 부대가 그리로 옮겨 간 것으로 본다. */
  const homeOf = (raw: string): [number, number] | null => {
    const b = bases.find((m) => m.key === raw);
    return b ? [b.x, b.y] : null;
  };
  const squadPts = useMemo(
    () => basePts.map((pts, pi) => splitSquads(
      pts, homeOf(motion.players[pi].raw), SQUAD_MERGE_TILES, motion.players[pi].drops,
    )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [basePts, motion, bases],
  );
  /* 정체가 드러난 유닛별 자취(요청: 모든 유닛의 위치를 따로, 같은 종류끼리만 묶기) —
     시즈·스팀팩·버로우로 정체가 드러난 명령들이다. 종류마다 따로 묶으므로 탱크 라인과
     바이오닉 본대가 딴 자리에 있어도 각자의 점으로 선다. 옛 분석본에는 없다(재분석). */
  /* 같은 종류라도 아주 가까울 때만 뭉친다(요청: "같은 종류유닛을 무조건 뭉치는게 아니라
     아주 가까울때만") — 부대 반경(14타일)은 앞마당 시즈 라인과 본진 수비 탱크까지 한
     마커로 뭉쳤다. 6타일이면 화면에서 실제로 붙어 보이는 것만 하나가 된다. */
  const typeSquads = useMemo(
    () => motion.players.map((p) => Object.entries(p.upts ?? {})
      .flatMap(([unit, pts]) => splitSquads(pts, homeOf(p.raw), TYPE_MERGE_TILES, p.drops)
        .map((sq) => ({ unit, raw: sq, walk: walkTrack(sq, p, false, unit) })))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [motion, terrain, grid.width, grid.height, bases],
  );
  const refinedSquads = useMemo(
    () => motion.players.map((p, pi) => squadPts[pi].map((sq) =>
      walkTrack(sq, p, false, undefined, undefined, true))),
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
    /* 일꾼 정찰은 직선이 아니라 지형 길로 걷는다(지적: "드론이 벽을 뚫고 정찰감") —
       드론·SCV·프로브는 지상 유닛이다. 수송선·오버로드(carrier·lone)만 곧게 난다. */
    const race = bases.find((b) => b.key === p.raw)?.race;
    const workerUnit = race === "저그" ? "Drone" : race === "테란" ? "SCV" : "Probe";
    /* 갈래마다 정체를 아는 만큼 제 속도로(지적: 오버로드 이동이 뚝뚝 끊김) — 저그의
       수송·단독 정찰은 오버로드(0.6, 업글 ×4), 테란·토스 수송선은 드랍십·셔틀. 정체
       모를 비저그 단독만 일꾼 걸음(3.7) 그대로다. */
    const carrierUnit = race === "저그" ? "Overlord" : race === "테란" ? "Dropship" : "Shuttle";
    const loneUnit = race === "저그" ? "Overlord" : undefined;
    return kinds.flatMap(({ kind, src }) => (src.length === 0 ? [] : splitSquads(src, homeOf(p.raw))
      .map((sq) => ({
        kind, raw: sq,
        walk: walkTrack(
          sq, p, kind !== "worker",
          kind === "worker" ? workerUnit : kind === "carrier" ? carrierUnit : loneUnit,
        ),
      }))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [motion, terrain, grid.width, grid.height, bases]);
  // 기본은 ×3이다(요청: ×8 → ×4였다가 눈금이 1·2·3·5·10·20으로 바뀌며 가장 가까운 값).
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(3);
  /* 탐색바(지적: 다이얼 드래그가 안 되고, 부드럽지 않고 반응이 느림) — 제어 입력은 매
     프레임 React가 값을 덮어써 잡은 손잡이와 싸웠고, 끌 때마다 지도 전체가 그려져 손을
     못 따라왔다. 입력을 비제어로 두고(손잡이는 브라우저 몫), 재생 중의 위치는 ref로 직접
     쓰며, 끌기의 지도 이동(setT)은 rAF로 프레임당 한 번으로 묶는다. */
  const rangeRef = useRef<HTMLInputElement>(null);
  const scrubbing = useRef(false);
  const seekPending = useRef<number | null>(null);

  /* (삭제·요청: 모바일 확대 기능 제거) — 더블탭·핀치 렌즈를 통째로 걷었다. PC 확대는
     이미 걷었으니(마우스 더블클릭 무시) 렌즈는 더 이상 쓸 곳이 없다. 확대는 큰 화면
     보기(확대 모달)가 맡는다. */
  const [done, setDone] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  /* (삭제) 본진 아바타 클립 id — 사진을 도형으로 자르지 않게 되면서(지적) 클립 자체가
     없어졌다. */
  /* 큰 화면 보기(요청: PC — 확대 아이콘을 누르면 맵과 조작부만 든 팝업이 엄청 크게) —
     같은 컴포넌트 트리를 통째로 포털 모달 안으로 옮겨 심으므로 재생 상태가 그대로
     이어진다. Esc로도 닫는다. */
  const [big, setBig] = useState(false);
  useLockBodyScroll(big);
  useEffect(() => {
    if (!big) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setBig(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [big]);

  /* 재생이 손잡이를 민다 — 비제어라 React가 안 밀어 주므로 여기서 직접 쓴다. 잡고 있는
     동안은 안 민다(그 순간의 임자는 손이다). */
  useEffect(() => {
    if (scrubbing.current) return;
    const el = rangeRef.current;
    if (!el) return;
    el.value = String(t);
    el.style.setProperty("--p", `${total > 0 ? (t / total) * 100 : 0}%`);
  }, [t, total]);

  /* PC에서 보는 것은 확대가 기본이다(요청: 경기 결과는 최대화 화면이 기본, 줄인 게
     옵션) — 재생을 시작하는 순간 확대로 연다. 사람이 축소를 눌렀으면 그 뜻을 기억해
     이번 카드에선 다시 안 키운다. 카드 목록이라 열자마자 전부 확대할 수는 없어(포털이
     겹친다) '재생 시작'을 문으로 쓴다. */
  const shrunk = useRef(false);
  const bigByDefault = () => {
    if (!shrunk.current && typeof window !== "undefined"
      && window.matchMedia?.("(min-width: 1160px)").matches) setBig(true);
  };

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
     사람이 이어 보는 건 재생 버튼의 몫이다). 확대 모달은 늘 화면 안이라 안 지킨다 —
     여닫는 재부착 순간 IO가 '안 보임'을 쏘아 재생을 멈추던 것(지적: 확대·축소 시
     재생 유지)도 이것으로 막힌다. big이 바뀌면 맵이 다른 트리로 옮겨 심기므로 effect를
     다시 걸어 새 엘리먼트를 관찰한다. */
  useEffect(() => {
    if (big) return undefined;
    const el = mapRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => !e.isIntersecting)) setPlaying(false);
    }, { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, [big]);

  /* (삭제) 화면을 벗어날 때의 정지는 이제 스크롤 밖(IntersectionObserver)뿐이다 —
     창 전환(blur) 정지를 걷은 뒤에도 탭 숨김(visibilitychange) 정지가 남아 창을 덮으면
     여전히 멈췄다(지적: "블러시 재생 멈춤 왜 아직도 있지"). 숨은 탭은 브라우저가 rAF를
     세워 어차피 시간이 안 가고, 돌아온 첫 틱은 dt 상한(0.5초)이 점프를 막으므로 명시적
     정지 없이도 이어 보기가 안전하다. */

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
     지수로 깎는다. 리플레이에 죽음이 안 남는 이상 "전투 밖에서는 안 줄어든다" 쪽이
     어림으로도 사실에 가깝다. 곡선은 사람마다 한 번 만들어 두고 재생은 읽기만 한다.
     반감기 60 → 25초(지적: "유닛수가 아직도 너무 과도하게 잡힘 죽음 감지 철저히") —
     브루드워 전투는 분 단위가 아니라 초 단위로 병력이 녹는다. 60초 반감기는 2분을 싸워도
     4분의 1이 남는 셈이라 늘 실제보다 부풀어 있었다. */
  const sizeSeries = useMemo(() => {
    const out = new Map<string, [number, number][]>();
    const HALF_LIFE = Math.LN2 / 25;
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
  // 좌표는 발자국 가운데로 옮긴다(FOOTPRINT 주석) — 일꾼이 건물 왼쪽 위 모서리가 아니라
  // 건물 한가운데로 오가야 한다.
  const halls = useMemo(() => motion.builds
    .filter(([, , , unit]) => ["Command Center", "Nexus", "Hatchery", "Lair", "Hive"].includes(unit))
    .map(([sec, x, y, unit, raw, gone]) => ({
      sec, x: x + footDx(unit), y: y + footDy(unit), raw, gone: gone ?? 0,
    })), [motion]);
  /** 가스 건물들 — 가스 지대에 일꾼을 보낼 자격이다(지적: 가스도 안 지었는데 왔다 갔다). */
  const gasBuildings = useMemo(() => motion.builds
    .filter(([, , , unit]) => ["Refinery", "Assimilator", "Extractor"].includes(unit))
    .map(([sec, x, y, unit, raw, gone]) => ({
      sec, x: x + footDx(unit), y: y + footDy(unit), raw, gone: gone ?? 0,
    })), [motion]);
  const castsNow = motion.casts.filter((c) => c[0] <= t && t - c[0] <= CAST_HOLD_SEC);

  /* 태워진 유닛은 잠깐 사라진다(요청: 태운 자리의 유닛들은 안 보이다가 내리면 나타남) —
     태움 지점 곁에 서 있던, 그 뒤로 새 명령이 없는 마커는 다음 드랍(없으면 계속)까지
     숨는다. 내리면(드랍 시각이 지나면) 도로 나타난다 — 다 내렸는지는 알 수 없으니
     시각만 근거다. */
  const carriedGone = (
    p: MotionTrack, pos: { x: number; y: number }, lastOrderSec: number,
  ): boolean => {
    for (const [ls, lx, ly] of p.loads ?? []) {
      if (ls > t) break;
      const ds = (p.drops ?? []).find(([s]) => s > ls)?.[0] ?? Infinity;
      if (t >= ls && t < ds && lastOrderSec <= ls
        && Math.hypot(pos.x - lx, pos.y - ly) <= 5) return true;
    }
    return false;
  };

  /* 건설에 흡수(지적: 익스트랙터 만든 드론이 유닛 아이콘으로 남는다) — 마지막 명령 뒤
     조용한 채 제 건물 착공 자리에 서 있는 일꾼 점은 걷는다: 저그는 드론이 건물이 된
     것이고, 테란·토스도 다 짓고 일감으로 돌아간 것이다. 그 명령 무렵(걸어간 시간 포함
     60초 안)에 시작된 착공만 짚는다 — 한참 뒤 같은 자리의 딴 건물에 엉뚱하게 먹히지
     않게. */
  const buildAbsorbed = (
    p: MotionTrack, pos: { x: number; y: number }, lastOrderSec: number,
  ): boolean => motion.builds.some(([bs, bx2, by2, bu, br]) =>
    br === p.raw && bs <= t && bs >= lastOrderSec - 4 && bs - lastOrderSec <= 60
    && Math.hypot(bx2 + footDx(bu) - pos.x, by2 + footDy(bu) - pos.y) <= 3);

  /* 본진이 무너졌나(지적: 본진 기지 건물은 절대 안 망했다 — 시작 홀을 builds에 합성하며
     판정이 생겼다) — 집 자리(3타일)의 내 홀 계보에서 마지막 채가 무너졌고 재건이 없으면
     함락이다. 아바타 로스터의 유령화와 채굴 일꾼 걷기가 같이 쓴다. */
  const fallenHome = (m: MinimapMarker): boolean => {
    const chain = motion.builds
      .filter(([bs, x2, y2, bu, br]) => br === m.key && bs <= t
        && ["Command Center", "Nexus", "Hatchery", "Lair", "Hive"].includes(bu)
        && Math.hypot(x2 + footDx(bu) - m.x, y2 + footDy(bu) - m.y) <= 3)
      .sort((a, b) => a[0] - b[0]);
    const last = chain[chain.length - 1];
    return !!last && (last[5] ?? 0) > 0 && t >= (last[5] ?? 0);
  };

  /* 무너진 기지의 유닛도 대개 같이 죽는다(지적: 확률은 높은데 완벽하진 않음 — 그래서
     침묵 조건을 같이 건다) — 내 건물이 무너진 자리 곁(8타일)에 서 있었고, 무너진 뒤로
     새 명령 없이 한참(DEAD_QUIET_SEC) 지난 마커는 그 함락에서 정리된 것으로 본다. */
  const razedNearby = (
    p: MotionTrack, pos: { x: number; y: number }, lastOrderSec: number,
  ): boolean => motion.builds.some(([, bx2, by2, bu, br, g2]) => {
    const gone = g2 ?? 0;
    return br === p.raw && gone > 0 && gone <= t && t > gone + DEAD_QUIET_SEC
      && lastOrderSec <= gone
      && Math.hypot(bx2 + footDx(bu) - pos.x, by2 + footDy(bu) - pos.y) <= 8;
  });

  /* 컨트롤되는 유닛 수(요청: 유닛 수를 죽음 판정에 기대기보다 실제 명령 받는 수로 —
     명령을 받는다는 건 그 자리에 계속 있었다는 뜻이다) — 최근 90초 안에 그 부대 자리
     곁(8타일)을 찍은 명령의 최대 선택 크기. 한 번에 최대 12기(게임 한계)라 과장이 없고,
     죽은 유닛은 더 못 고르니 저절로 줄어든다. 0이면(그 자리 명령에 선택 크기 기록이
     없으면) 생산-감쇠 어림이 대신 말한다. */
  const ctrlNear = (p: MotionTrack, pos: { x: number; y: number }): number => {
    let n = 0;
    for (const [s, sx, sy, k] of p.sels ?? []) {
      if (s > t) break;
      if (t - s <= 90 && Math.hypot(sx - pos.x, sy - pos.y) <= 8 && k > n) n = k;
    }
    return n;
  };

  /* 폭은 무조건 컨테이너 최대가 아니라 화면 세로 공간이 허락하는 만큼(지적: 노트북처럼
     납작한 화면에서 전체 폭을 쓰면 미니맵이 한 화면에 다 안 들어옴) — 맵 높이가
     (100dvh − 조작부 몫)을 넘지 않게 폭을 비율로 역산해 상한을 걸고 가운데 정렬.
     인라인은 맵 아래 전부(도구줄·조종부)와 위쪽 화면 몫까지 빼서 조종부까지 한 화면에
     들어온다(지적). 큰 화면 모달은 맵+조종부만이라 몫이 작다(190px).
     폰 세로 화면에선 이 상한이 컨테이너 폭보다 커서 아무 영향 없다. */
  /* 아바타 로스터 기둥(요청: 아바타를 맵 밖으로 — 1팀 왼쪽·2팀 오른쪽 세로 한 줄,
     로스터식 아바타+닉네임에 그 사람 색까지) — 맵 위의 본진 자리는 합성된 시작 홀이
     다른 홀과 같은 평범한 기지 도형으로 말한다. */
  const teamCol = (team: 1 | 2) => (
    <div className="scr-motion-teamcol">
      {bases.filter((m) => (m.team === 2 ? 2 : 1) === team).map((m) => {
        const track = motion.players.find((p) => p.raw === m.key);
        let workerN = 0;
        for (const [sec, n] of track?.workers ?? []) {
          if (sec > t) break;
          workerN = n;
        }
        const fallen = m.ghost || fallenHome(m);
        const color = modeColor(m.key, m.team);
        return (
          <div
            key={m.key}
            className={cx("scr-motion-teamcol-item", fallen && "scr-motion-base-ghost")}
          >
            <span className="scr-motion-base-ring" style={{ boxShadow: `0 0 0 2px ${color}` }}>
              <Avatar member={{ id: m.memberId, nickname: m.name, avatar: m.avatar }} size={22} />
            </span>
            <span className="scr-motion-teamcol-text">
              <span className="scr-motion-teamcol-name" style={{ color }}>{m.name}</span>
              <span
                className="scr-motion-workers"
                style={workerN > 0 ? undefined : { visibility: "hidden" }}
              >
                일꾼 {workerN || 0}
              </span>
            </span>
            {winnerTeam && (m.team === 2 ? 2 : 1) === winnerTeam && t >= total - 0.5 && !fallen && (
              <span className="scr-motion-trophy">🏆</span>
            )}
          </div>
        );
      })}
    </div>
  );

  const body = (
    <div
      className={cx("scr-motion", big && "scr-motion-big")}
      // 확대 모드에선 폭 상한을 안 건다 — 모달 폭(아래 포털)이 이미 맵+양옆 세로 조작부
      // 기준으로 확정돼 있고, 여기까지 조이면 이중 제약으로 맵이 더 작아진다.
      style={big ? undefined : { maxWidth: `calc((100dvh - 230px) * ${(grid.width / grid.height).toFixed(4)})`, margin: "0 auto" }}
    >
      <div className="scr-motion-maprow">
      {teamCol(1)}
      <div
        className="scr-motion-map" ref={mapRef}
        style={{ aspectRatio: `${grid.width} / ${grid.height}` }}
      >
        {/* 렌즈 상자는 남긴다(마커들의 부모) — 확대 기능이 걷혀(요청: 모바일 확대 제거)
            transform은 더 이상 없다. */}
        <div className="scr-motion-lens">
        {grid.image
          ? <img className="scr-motion-canvas" src={grid.image} alt={`${grid.name} 미니맵`} />
          : <div className="scr-motion-canvas scr-motion-canvas-blank" />}

        {/* 건물(요청: 합치기 대신) — 기본은 작은 이름이 늘 떠 있되, 가까이 겹치는 같은
            이름은 하나만 적고 나머지는 점(지적: 겹치면 안 보인다). 긴 이름은 폰트를 한
            단계 줄인다. 생산·연구 중이면 심장처럼 뛴다(요청). */}
        {(() => {
          /* 시작 홀은 파서가 합성한다(지적: 스타팅 포인트에 기지가 없다 → 재분석으로
             해결, 폴백은 걷었다 — 요청). */
          /* 그리는 차례는 y(세로) 순이다 — 높이가 생기면서(BUILD_RISE) 높은 건물이 제 뒤
             건물 위로 솟는데(지적: "높이땜에 뒤에 건물과 겹쳐보일수도"), 사선 뷰에서는
             앞(y가 큰) 건물이 뒤를 가리는 것이 맞다. i는 원래 인덱스 그대로 들고 간다
             (buildsByType 등이 그 인덱스로 잰다). */
          const drawOrder = motion.builds.map((_, i) => i)
            .sort((a, b) => motion.builds[a][2] - motion.builds[b][2]);
          return drawOrder.map((i) => {
            const [sec, x, y, unit, raw, gone, liftAt] = motion.builds[i];
            if (sec > t) return null;
            const goneAt = gone ?? 0;
            // 없어진 건물은 그냥 사라진다(요청: ✕ 표시 없음) — 착륙 이사·변태와도 한 결이다.
            if (goneAt > 0 && t >= goneAt) return null;
            // 떠 있는 구간(지적: 건물 떠 있는 게 표현이 안 된다) — 이륙부터 착륙(=goneAt)
            // 까지 옛 자리에서 둥실거린다.
            const afloat = !!liftAt && t >= liftAt;
            const razed = false;
            /* 같은 자리에 같은 임자의 새 건물이 서면(레어 진화·재건) 옛 것은 걷는다
               (지적: 비활성 건물이 글자와 도형으로 동시 표시). */
            if (!razed && motion.builds.some(([s2, x2, y2, , r2], j) =>
              j !== i && r2 === raw && s2 > sec && s2 <= t && Math.hypot(x2 - x, y2 - y) <= 1.5)) {
              return null;
            }
            /* 착륙 이사(요청: 건물 움직임도 추적) — 같은 임자의 같은 건물이 내 시작
               시각에 걷혔으면 거기서 날아온 것이다. 나는 동안은 두 자리 사이를 비행
               속도로 잇는다. */
            let bx = x;
            let by = y;
            const flownFrom = motion.builds.find(([, x2, y2, u2, r2, g2]) =>
              r2 === raw && u2 === unit && (g2 ?? 0) === sec && (x2 !== x || y2 !== y));
            if (flownFrom) {
              const flyDist = Math.hypot(flownFrom[1] - x, flownFrom[2] - y);
              const flyDur = Math.min(40, flyDist / BUILDING_FLY_SPEED);
              if (t < sec + flyDur && flyDur > 0) {
                const k = Math.max(0, (t - sec) / flyDur);
                bx = flownFrom[1] + (x - flownFrom[1]) * k;
                by = flownFrom[2] + (y - flownFrom[2]) * k;
              }
            }
            /* 띄운 채 나는 정찰(요청: 엔베 띄워 정찰이 안 나온다) — 뜬 마커는 옛 자리에
               둥실대는 대신, 이륙 뒤의 비행 클릭(fpts)을 비행 속도로 따라 난다. 동시에
               두 채가 떠 있으면 자취를 나눠 갖지 못하고 같이 따라간다(어림). */
            const flyTrack = motion.players.find((p) => p.raw === raw);
            if (afloat && liftAt && flyTrack) {
              const flight = (flyTrack.fpts ?? []).filter(([fs]) =>
                fs >= liftAt && (goneAt === 0 || fs < goneAt));
              if (flight.length > 0) {
                const fw = walkTrack(
                  [[liftAt, x, y], ...flight], flyTrack, true, undefined, BUILDING_FLY_SPEED,
                );
                const fp = posAt(fw, t, null);
                if (fp) { bx = fp.x; by = fp.y; }
              }
            }
            // 짓는 동안은 공사중 아이콘(요청: 반투명 말고) — 반투명은 "저기 뭐가 있긴 한데"
            // 로만 읽히고, 도형의 반투명(뒤 비침)과도 헷갈렸다. 날아온 건물은 이미 다 선
            // 건물이라 망치를 안 든다.
            const raising = !razed && !flownFrom && t - sec < (BUILD_SEC[unit] ?? 30);
            const team = teamOfRaw(raw);
            const tagOrd = tagOrdinals.get(`${raw}|${unit}`);
            const typeList = buildsByType.get(`${raw}|${unit}`) ?? [];
            const myOrd = typeList.indexOf(i);
            /* 태그를 모르면 대표 하나만(지적: 해처리 생산·업그레이드에 모든 해처리가
               아이콘) — 같은 종류 전부에 달면 어디서 하는지가 아니라 "다 한다"로 읽힌다.
               대표는 그 종류에서 가장 오래된, 지금 살아 있는 건물(대개 본진 쪽)이다. */
            const repOrd = typeList.findIndex((bi) => {
              const [s2, , , , , g2] = motion.builds[bi];
              return s2 <= t && !((g2 ?? 0) > 0 && t >= (g2 ?? 0));
            });
            const producing = !razed && (prodByRawType.get(`${raw}|${unit}`) ?? [])
              .some(([ps, tag]) => {
                if (!(ps <= t && t - ps <= PROD_FLASH_SEC)) return false;
                // 태그를 알면 그 순번의 건물만(요청) — 모르면 대표 건물만(지적).
                if (!tag || !tagOrd) return myOrd === repOrd;
                const ord = tagOrd.get(tag);
                return ord === undefined || ord === myOrd;
              });
            // 연구 중(요청) — 이 건물에서 하는 연구가 지금 창 안에 시작돼 있나. 어느
            // 건물인지는 안 남으므로 대표 건물에만 단다(지적).
            const hallLike = unit === "Lair" || unit === "Hive" ? "Hatchery" : unit;
            const researching = !razed && myOrd === repOrd
              && (flyTrack?.ups ?? []).some(([us, name]) =>
                RESEARCH_BUILDING[name] === hallLike && us <= t && t - us <= RESEARCH_SEC);
            // 이름 창 = 착공 직후 잠깐뿐(요청) — 그 뒤 공사 중에는 도형+망치이고, 생산·
            // 연구 중에도 이름 대신 라임 글로우가 말한다(요청: "생산중인 건물은 이름을
            // 띄우지 말고 액티브").
            const activeBuild = !razed && t - sec <= BUILD_NAME_SEC;
            const name = BUILDING_KO[unit] ?? UNIT_KO[unit];
            /* 비활성이면 무조건 도형이다(지적: 서플라이·파일런·포토·터렛이 영영 안 변했다 —
               "겹치지만 않으면 이름 상시 노출"이던 옛 규칙을 걷었다). */
            const isHall = ["Command Center", "Nexus", "Hatchery", "Lair", "Hive"].includes(unit);
            const shapeKind = SHAPE_KIND[unit];
            let text: string;
            // 테란 부속건물은 이름 대신 늘 +다(요청: "테란 부속건물은 +로 옆에 붙이기") —
            // 제 발자국 자리가 본체 오른쪽이라 저절로 옆에 붙는다.
            if (ADDONS.has(unit)) text = "+";
            else if (activeBuild && name) text = name;
            // ▪는 글꼴상 반쪽짜리라 ●▲보다 작아 보인다(지적) — 꽉 찬 ■로. 본진은 별표(요청).
            else text = isHall ? "★" : DEFENSE_BUILDINGS.has(unit) ? "▲" : "■";
            // 발자국이 곧 크기다(요청: "건물크기로 구분 — 서플·파일런같은 작은 건물은 작게,
            // 큰 건물은 크게"). 본진은 제 크기 클래스(-hall)가 이미 있다.
            const fpArea = (FOOTPRINT[unit] ?? [3, 2]).reduce((a, b) => a * b, 1);
            return (
              <span
                key={`b-${i}`}
                className={cx(
                  "scr-motion-build",
                  !razed && text !== name && "scr-motion-build-shape",
                  // 도형은 실제 발자국 크기 그대로 그린다(요청: "건물 아이콘 크기를 실제
                  // 맵크기에 비례해서 정확히") — 폭을 지도 % 로 못박는다(아래 style).
                  !razed && text !== name && "scr-motion-build-tile",
                  !razed && text !== name && !isHall
                    && (fpArea >= 12 ? "scr-motion-build-lg" : fpArea <= 6 ? "scr-motion-build-sm" : false),
                  // 본진 건물은 다른 건물보다 큼직하게(요청).
                  isHall && "scr-motion-build-hall",
                  activeBuild && "scr-motion-build-on",
                  // (삭제) 라임 테 박동(-glow) — 하는 일은 아이콘만으로 말한다(요청:
                  // 건물 액티브 사각형 효과 제거).
                  afloat && "scr-motion-build-afloat",
                  razed && "scr-motion-build-razed",
                )}
                style={{
                  // 나는 중이면 비행 좌표(bx·by), 아니면 제자리다(위 착륙 이사 주석).
                  // 앵커는 발자국 가운데다(FOOTPRINT 주석 — 왼쪽 위 타일 그대로면 치우친다).
                  // 부속건물(+)은 본체에 딱 붙여 오른쪽 아래로(요청: "더 본건물에 딱 붙이고
                  // 아래로 내리기") — 왼쪽으로 당겨 겹치고, 세로는 내린다.
                  /* 겹침 차례는 마지막 명령 시각(지적: 유닛이 무조건 위가 아니라 —
                     건물이 위일 수 있다) — 방금 착공했거나 지금 생산·연구·비행 중인
                     건물은 조용한 유닛 점 위로 온다. 유닛 마커도 같은 자로 잰다. */
                  zIndex: 1000 + Math.round(producing || researching || afloat ? t : sec),
                  left: pct(bx + footDx(unit) - (ADDONS.has(unit) ? 1.6 : 0), grid.width),
                  // 건물은 바닥 위로 솟는다(지적: "실제 건물은 바닥위에 높이가 있어") —
                  // 캔버스 높이에 그 몫(riseOf, 발자국 폭 비례)을 더하고, 늘어난 만큼
                  // 위로 올려 바닥선은 발자국 그대로다. 단 전용 벡터가 있는 건물만이다
                  // (지적: 벡터 없는 애들은 높이 생각 말고 바닥 캔버스로만) — 맨 네모가
                  // 높이 몫까지 늘어나면 발자국보다 세로로 긴 거짓 기둥이 된다.
                  // 벡터 없는 네모는 발자국의 80%로만 그린다(요청) — 대신 아래로 내려
                  // 바닥선은 발자국 바닥 그대로다.
                  top: pct(
                    by + footDy(unit) + (ADDONS.has(unit) ? 0.4 : 0)
                      + (text !== name && !ADDONS.has(unit)
                        ? (shapeKind ? -riseOf(unit) / 2 : (FOOTPRINT[unit] ?? [3, 2])[1] * 0.1)
                        : 0),
                    grid.height,
                  ),
                  // 캔버스 비율 = 발자국 폭 × (발자국 높이 + 벡터 건물만 높이 몫)(요청·지적).
                  ...(text !== name && !ADDONS.has(unit)
                    ? {
                      width: pct((FOOTPRINT[unit] ?? [3, 2])[0] * (shapeKind ? 1 : 0.8), grid.width),
                      aspectRatio: `${(FOOTPRINT[unit] ?? [3, 2])[0]} / ${(FOOTPRINT[unit] ?? [3, 2])[1] + (shapeKind ? riseOf(unit) : 0)}`,
                    }
                    : {}),
                  // 긴 이름은 한 단계 작게(지적) — 여섯 자부터.
                  ...(text.length >= 6 && !activeBuild ? { fontSize: 6 } : {}),

                  // 건물은 글자색=제 색, 음영판이 바탕 — 유닛 배지와 반대(지적). 도형이 된
                  // 뒤에는 음영 없이 맨 색이다(지적).
                  ...(razed ? {} : text === name ? shapeStyle(raw, team) : glyphStyle(raw, team)),
                }}
              >
                {/* 전용 도형이 있으면 벡터로(SHAPE_KIND — 이모지·글꼴 글리프 금지 요청).
                    입체는 직접 깎은 도형만이다(지적) — 이름 없는 나머지 건물은 예전대로
                    네모, 대신 크기만 발자국에 맞춘다. */}
                {shapeKind && text !== name
                  ? <ShapeIcon kind={shapeKind} />
                  : text === "■"
                    // 캔버스가 이미 발자국 비율이라(위 aspectRatio — 벡터 없으면 높이 몫도
                    // 없다) 네모는 그 상자를 그대로 채운다(CSS width/height 100%).
                    ? <i className="scr-motion-sq" />
                    : text}
                {/* 하는 일 아이콘(요청: 생산·업그레이드도 각각 아이콘으로) — 공사는 망치,
                    생산은 톱니, 업그레이드는 플라스크. 한 번에 하나만(공사가 먼저다). */}
                {/* 8 → 10(요청: 아이콘 확대), 자리는 건물 왼쪽 모서리에 살짝 걸치게(요청).
                    색은 그 사람 칩의 글자색과 같은 규칙(요청: "글자색" — 플레이어색도
                    흰색 고정도 아니다): 밝은 개인색 위엔 검정, 어두운 색 위엔 흰색이라
                    제 색 도형 위에서도 늘 보인다. */}
                {(() => {
                  const Icon = raising ? Hammer
                    : producing && !afloat ? Cog
                      : researching && !afloat ? FlaskConical : null;
                  if (!Icon) return null;
                  const jobColor = lumOf(modeColor(raw, team)) > 150 ? "#111" : "#fff";
                  return <Icon size={10} className="scr-motion-raising" style={{ color: jobColor }} />;
                })()}
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
              const [, bx, by, bUnit] = pick;
              out.push(
                <span
                  key={`fresh-${p.raw}-${unit}-${si}`}
                  className="scr-motion-fresh"
                  style={{
                    // 건물 발자국의 왼쪽 아래에서 나온다(요청) — 더 바짝 붙여서(지적).
                    left: pct(bx - 0.2, grid.width),
                    top: pct(by + (FOOTPRINT[bUnit] ?? [3, 2])[1] + 0.3, grid.height),
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
            // 함락된 본진(fallenHome)은 채굴 목적지가 아니다(지적: 본진이 안 망하던 문제).
            if (m.ghost || fallenHome(m)) continue;
            const d = Math.hypot(res[0] - m.x, res[1] - m.y);
            if (d < best) { best = d; owner = { x: m.x, y: m.y, raw: m.key }; }
          }
          for (const hall of halls) {
            if (hall.sec > t || (hall.gone > 0 && t >= hall.gone)) continue;
            const d = Math.hypot(res[0] - hall.x, res[1] - hall.y);
            if (d < best) { best = d; owner = { x: hall.x, y: hall.y, raw: hall.raw }; }
          }
          if (!owner) return [];
          /* 가스 지대 게이트(재지적: 가스 안 지은 곳에 가스 캐는 일꾼이 계속 나옴) —
             가스가 낀 지대는 가스 건물(정제소류)이 서기 전엔 일꾼이 안 간다. 예전의
             '홑 가스 지대' 판별(30타일 안 다른 지대가 있어야 게이트)은 가스만 있는
             멀티를 놓쳤다 — 근처에 미네랄 지대가 따로 없어 홑으로 안 잡혔다. 미네랄과
             가스가 한 지대로 묶인 맵에서 정제소 전까지 이 지대가 조용해지는 손해는
             감수한다(본진 밑 곡괭이 일꾼이 채취 자체는 계속 말해 준다). */
          /* 깃발 안전망(재지적: 아직도 가스 없는 곳에 가스 캐는 일꾼) — 옛 맵 데이터에는
             가스 깃발(res[2])이 아예 없을 수 있다. 이 판에서 누군가 가스 건물을 지은
             자리는 깃발과 무관하게 가스 지대다. */
          const gasSpot = res[2] === 1
            || gasBuildings.some((g) => Math.hypot(g.x - res[0], g.y - res[1]) <= 6);
          if (gasSpot) {
            const hasGasBuilding = gasBuildings.some((g) =>
              g.raw === owner!.raw && g.sec + 30 <= t && (g.gone === 0 || t < g.gone)
              && Math.hypot(g.x - res[0], g.y - res[1]) <= 10);
            if (!hasGasBuilding) return [];
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
                {/* ·(가운뎃점)은 잉크가 적어 너무 작았다(지적) — 정찰·일꾼 점과 같은
                    ●를 같은 크기로 쓴다(요청: 일꾼 점 통일). */}
                ●
              </span>
            );
          });
        })}

        {/* (이동·요청: 아바타를 맵 밖으로) — 본진 아바타+이름은 맵 양옆 로스터 기둥
            (teamCol)으로 나갔다. 맵의 본진 자리는 합성된 시작 홀 도형이 말한다. */}
        {false && bases.map((m) => {
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
                {/* 아바타를 그 종족 본진 실루엣 '안'에 넣는다(요청: "본진 기지 아바타도 본진
                    모양을 본따서", "아바타를 본진안에 넣으라는 뜻, 따로 빼지말고") —
                    테란 무덤, 프로토스 피라미드, 저그 둔덕 모양으로 사진을 자르고 같은
                    모양의 색 테를 두른다. 사진이 없는 사람은 도형 바탕에 첫 글자다.
                    종족은 이 실루엣이 이미 말하므로 종족 배지는 걷었다(요청). */}
                {(() => {
                  /* 사진은 자르지 않는다(지적: "아바타를 잘라서 넣는게 아니라 원으로
                     가운데에 잘림없이, 종족 무관 같은 크기") — 본진 실루엣은 색 판으로
                     뒤에 서고, 그 한가운데에 동그란 아바타가 같은 크기로 얹힌다. */
                  const hall = m.race ? AVATAR_HALL_PATHS[m.race] : undefined;
                  /* 저그는 그 시각의 최고 단계(해처리→레어→하이브)를 따라 뿔이 자란다
                     (요청: "해처리 아바타도 레어 하이브 다 표현"). */
                  let deco = hall?.deco;
                  if (m.race === "저그") {
                    let tier: "hatchery" | "lair" | "hive" = "hatchery";
                    for (const [bs, , , bu, br, bg] of motion.builds) {
                      if (br !== m.key || bs > t || ((bg ?? 0) > 0 && t >= (bg ?? 0))) continue;
                      if (bu === "Hive") { tier = "hive"; break; }
                      if (bu === "Lair") tier = "lair";
                    }
                    deco = AVATAR_ZERG_DECO[tier];
                  }
                  if (!hall) {
                    return (
                      <span
                        className="scr-motion-base-ring"
                        style={{ boxShadow: `0 0 0 3px ${modeColor(m.key, m.team)}` }}
                      >
                        <Avatar member={{ id: m.memberId, nickname: m.name, avatar: m.avatar }} size={24} />
                      </span>
                    );
                  }
                  return (
                    <span className="scr-motion-base-hallwrap">
                      <svg
                        className="scr-motion-base-hallsvg" viewBox="0 0 16 16" aria-hidden
                        style={{ color: modeColor(m.key, m.team) }}
                      >
                        <path d={hall.body} fill="currentColor" />
                        {deco && <path d={deco} fill="currentColor" />}
                      </svg>
                      <span
                        className="scr-motion-base-avatar-in"
                        style={{ transform: `translateY(${hall.dy}px)` }}
                      >
                        <Avatar member={{ id: m.memberId, nickname: m.name, avatar: m.avatar }} size={18} />
                      </span>
                    </span>
                  );
                })()}
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
          /* 죽음이 확실할 때만 걷는다(요청: "유닛 죽은게 확실하지 않으면 남겨놓기") —
             마지막 명령이 전투 창 '안'에 있어야 하고(예전엔 전투 30초 전 명령까지 쓸어
             담아, 싸움 근처에 서 있기만 한 부대도 죽은 것이 됐다), 전투가 끝나고도 한참
             (DEAD_QUIET_SEC) 손이 안 간 뒤에야 정리된 것으로 본다 — 리플레이에 죽음이 안
             남는 이상 이 둘이 겹친 것이 우리가 가질 수 있는 가장 굵은 근거다. */
          const deadBy = (lastOrderSec: number): boolean => {
            for (const [a, b] of p.hot ?? []) {
              if (lastOrderSec >= a && lastOrderSec <= b && t > b + DEAD_QUIET_SEC) return true;
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
            // 태워진 동안은 숨는다(요청) — 내리면 나타난다.
            if (carriedGone(p, pos, Number.isFinite(sinceCmd) ? t - sinceCmd : -1)) return [];
            // 건설에 흡수(지적: 익스트랙터 만든 드론이 남는다) — 일꾼 묶음만.
            if (g.unit === "Worker" && !pos.moving && Number.isFinite(sinceCmd)
              && buildAbsorbed(p, pos, t - sinceCmd)) return [];
            // 무너진 기지 곁에서 침묵 — 그 함락에서 정리된 것(지적).
            if (razedNearby(p, pos, Number.isFinite(sinceCmd) ? t - sinceCmd : 0)) return [];
            return [{ g, gi, pos, sinceCmd }];
          });
          const shownUnits = new Set(typeMarks.flatMap(({ g }) => BY_UNITS[g.unit] ?? [g.unit]));
          /* 같은 종류가 여러 부대로 갈라졌으면 수도 갈라 적는다(지적: 저글링 10이 5·5,
             3·3·4처럼 갈라지는 모션) — 어느 쪽에 몇이 갔는지는 안 남으니 고르게 나눈다. */
          const squadsOfUnit = new Map<string, number>();
          for (const { g } of typeMarks) squadsOfUnit.set(g.unit, (squadsOfUnit.get(g.unit) ?? 0) + 1);
          const seenOfUnit = new Map<string, number>();
          const typeNodes = typeMarks.map(({ g, gi, pos, sinceCmd }) => {
            const members = BY_UNITS[g.unit] ?? [g.unit];
            const aliveAll = members.reduce((n, u) => n + aliveOf(u), 0);
            const nSquads = squadsOfUnit.get(g.unit) ?? 1;
            const idx = seenOfUnit.get(g.unit) ?? 0;
            seenOfUnit.set(g.unit, idx + 1);
            const aliveGuess = aliveAll > 0
              ? Math.floor(aliveAll / nSquads) + (idx < aliveAll % nSquads ? 1 : 0)
              : 0;
            // 실제 컨트롤 수가 있으면 그것이 먼저다(요청) — 어림은 폴백.
            const ctrl = ctrlNear(p, pos);
            const alive = ctrl > 0 ? ctrl : aliveGuess;
            /* 파서의 묶음 이름이 유닛명이 아닌 경우("Transport"·"Worker")는 그 종족의 실제
               이름으로 부른다(지적: "transport가 뭐지" — 영문 키가 그대로 샜다). */
            const race = bases.find((b) => b.key === p.raw)?.race;
            const groupKo = UNIT_KO[g.unit]
              ?? (g.unit === "Transport"
                ? (race === "저그" ? "오버로드" : race === "테란" ? "드랍십" : "셔틀")
                : g.unit === "Worker"
                  ? (race === "저그" ? "드론" : race === "테란" ? "SCV" : "프로브")
                  : g.unit);
            const label = `${groupKo}${alive > 0 ? ` ${alive}` : ""}`;
            /* 일꾼과 수송선은 이름을 안 띄운다(요청) — 일꾼은 늘 작은 점, 수송선은 늘
               제 도형(오버로드 풍선·드랍십·셔틀)이다. */
            const noName = g.unit === "Worker" || g.unit === "Transport";
            const activeNow = !noName && (pos.moving || sinceCmd <= ACTIVE_HOLD_SEC);
            /* 클로킹 유닛은 반투명(요청) — 옵저버·다크는 늘, 레이스·고스트는 클로킹 연구
               뒤부터. 칩이든 점이든 같이 옅어진다(요청). */
            const cloaked = g.unit === "Observer" || g.unit === "Dark Templar"
              || (g.unit === "Wraith" && (p.ups ?? []).some(([us, n]) => n === "Cloaking Field" && us <= t))
              || (g.unit === "Ghost" && (p.ups ?? []).some(([us, n]) => n === "Personnel Cloaking" && us <= t));
            return (
              <span
                key={`${p.raw}-u${g.unit}-${gi}`}
                className={cx(
                  "scr-motion-army",
                  activeNow ? "scr-motion-chip" : "scr-motion-dot",
                  // 일꾼은 적당히 작은 점으로 통일(요청) — 부대 점보다 작고 옅은 정찰 점 크기.
                  g.unit === "Worker" && "scr-motion-scout",
                  team === 2 ? "scr-motion-team2" : "scr-motion-team1",
                  cloaked && "scr-motion-cloaked",
                )}
                style={{
                  left: pct(pos.x, grid.width), top: pct(pos.y, grid.height),
                  // 겹침 차례는 마지막 명령 시각(지적: 유닛이 무조건 위가 아니라).
                  zIndex: 1000 + Math.round(Number.isFinite(sinceCmd) ? t - sinceCmd : g.walk[0][0]),
                  // 칩 글씨 한 단 축소(지적: 너무 큼).
                  ...(activeNow
                    ? { fontSize: Math.min(11, 7 + Math.round(Math.sqrt(Math.max(alive, 1)))), ...chipStyle(p.raw, team) }
                    : glyphStyle(p.raw, team)),
                }}
              >
                {/* 수송선은 점·이름 대신 늘 제 도형(요청) — 오버로드 풍선·드랍십·셔틀. */}
                {g.unit === "Transport"
                  ? (
                    <ShapeIcon
                      kind={race === "저그" ? "ovie" : race === "테란" ? "dship" : "shuttle"}
                      className="scr-motion-ovie"
                    />
                  )
                  : activeNow ? label : "●"}
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
            // 태워진 동안은 숨는다(요청) — 내리면 나타난다.
            if (carriedGone(p, pos, Number.isFinite(sinceCmd) ? t - sinceCmd : -1)) return null;
            // 무너진 기지 곁에서 침묵 — 그 함락에서 정리된 것(지적).
            if (razedNearby(p, pos, Number.isFinite(sinceCmd) ? t - sinceCmd : 0)) return null;
            /* 생산 직후에도 깨어 있다(요청) — 갓 나온 유닛은 명령을 안 받았어도 지금
               이야기의 일부다. 완성은 사람 단위 값이라 주 부대만 깨운다. */
            let freshDone = false;
            if (si === primary) {
              for (const d of completionsByRaw.get(p.raw) ?? []) {
                if (d > t) break;
                freshDone = t - d <= FRESH_ACTIVE_SEC;
              }
            }
            const activeNow = pos.moving || sinceCmd <= ACTIVE_HOLD_SEC || freshDone;
            const showName = si === primary && activeNow && !!unit && (size >= 1 || !!SCOUT_KO[unit]);
            // 칩 글씨 한 단 축소(지적: 너무 큼) — 16 상한/1.6 기울기 → 12/1.1.
            const fontPx = Math.min(12, 7 + Math.round(Math.sqrt(size) * 1.1));
            /* 무명 부대의 구성 — 제 마커를 가진 종류(shownUnits)는 뺀다: 같은 탱크가 제
               마커와 부대 칩에 두 번 적히면 수가 배로 읽힌다. */
            const parts: [string, number][] = [];
            for (const [u] of unitDoneByRaw.get(p.raw) ?? []) {
              if (shownUnits.has(u)) continue;
              const alive = aliveOf(u);
              if (alive >= 1) parts.push([u, alive]);
            }
            parts.sort((a, b) => b[1] - a[1]);
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
                      team === 2 ? "scr-motion-team2" : "scr-motion-team1",                    )}
                    style={{
                      left: pct(pos.x + dx, grid.width), top: pct(pos.y + dy, grid.height),
                      // 겹침 차례는 마지막 명령 시각(지적).
                      zIndex: 1000 + Math.round(Number.isFinite(sinceCmd) ? t - sinceCmd : rp[0][0]),
                      ...glyphStyle(p.raw, team),
                    }}
                  >
                    ●
                  </span>
                );
              });
            }
            /* 유닛마다 제 칩이다(지적: "왜 아직도 합쳐서 나와 유닛이?") — "질럿 93 ·
               옵저버 5 · 하이템플러 4"를 한 칩에 이어 적으면 세 유닛이 한 덩어리로 읽힌다.
               자리는 하나뿐이라(이 유닛들은 제 위치가 드러난 적이 없어 부대 자리밖에
               모른다) 같은 자리에 세로로 쌓되, 칩은 유닛별로 가른다. 첫 칩(가장 많은
               유닛)만 규모 글씨·심장박동을 갖고 나머지는 작게 딸린다. */
            const chips: string[] = parts.length > 0
              ? parts.map(([u, n]) => `${UNIT_KO[u]} ${n}`)
              : [UNIT_KO[unit] ? `${UNIT_KO[unit]} ${size}`.trim() : SCOUT_KO[unit] ?? "●"];
            return chips.map((text, ci) => (
              <span
                key={`${p.raw}-s${si}-c${ci}`}
                className={cx(
                  "scr-motion-army",
                  "scr-motion-chip",
                  // (삭제) 심장박동 — 유닛 액티브 효과 취소(요청). 게다가 scale 맥동은
                  // 글자 래스터를 늘려 확대 화면에서 칩이 내내 뿌옇게 보였다(지적).
                  team === 2 ? "scr-motion-team2" : "scr-motion-team1",
                )}
                style={{
                  left: pct(pos.x, grid.width), top: pct(pos.y, grid.height),
                  fontSize: ci === 0 ? fontPx : 10,
                  // 첫 칩 아래로 한 줄씩 내려 쌓는다 — 마진은 transform(가운데 앵커)보다
                  // 먼저 먹으므로 앵커는 그대로고 상자만 내려간다.
                  ...(ci > 0 ? { marginTop: fontPx + 4 + (ci - 1) * 14 } : {}),
                  ...chipStyle(p.raw, team),
                }}
              >
                {text}
              </span>
            ));
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
            if (!pos) return null;
            let sinceCmd = Infinity;
            for (const [sec] of g.raw) {
              if (sec > t) break;
              sinceCmd = t - sec;
            }
            /* 생존 추정의 원칙(지적: 정찰 간 오버로드가 죽었을 리 없는데 갑자기 사라짐) —
               명령이 끊겨도, 자취가 오래돼도(stale) 마지막 자리에 그대로 둔다. 걷는 근거는
               둘뿐이다: 집에 돌아와 본진 표현에 흡수됐거나, 아래 전투 판정(죽음의 근거). */
            const home = homeOf(p.raw);
            const nearHome = !!home && Math.hypot(pos.x - home[0], pos.y - home[1]) <= 6;
            if (sinceCmd > SQUAD_FADE_SEC && !pos.moving && nearHome) return null;
            /* 전투 판정(요청: 정찰 점에도) — 마지막 명령이 전투 창에 닿아 있고 그 전투가
               끝나고도 새 명령이 없으면, 그 정찰도 거기서 정리된 것이다. 부대의 deadBy와
               같은 완화(요청: 확실하지 않으면 남겨놓기) — 전투 창 안의 명령만, 침묵도
               한참 뒤에야. */
            if (Number.isFinite(sinceCmd)) {
              const lastOrderSec = t - sinceCmd;
              for (const [a, b] of p.hot ?? []) {
                if (lastOrderSec >= a && lastOrderSec <= b && t > b + DEAD_QUIET_SEC) return null;
              }
            }
            // 태워진 동안은 숨는다(요청) — 오버로드·셔틀에 오른 정찰도 마찬가지다.
            if (carriedGone(p, pos, Number.isFinite(sinceCmd) ? t - sinceCmd : -1)) return null;
            // 건설에 흡수(지적: 익스트랙터 만든 드론이 남는다) — 일꾼 점만.
            if (g.kind === "worker" && !pos.moving && Number.isFinite(sinceCmd)
              && buildAbsorbed(p, pos, t - sinceCmd)) return null;
            // 무너진 기지 곁에서 침묵 — 그 함락에서 정리된 것(지적).
            if (razedNearby(p, pos, Number.isFinite(sinceCmd) ? t - sinceCmd : 0)) return null;
            /* 진짜 이름으로 부른다(지적: "일꾼"이 아니라 원래 이름 — "정찰"이라는 유닛은
               없다). 종족이 이름을 정한다: 일꾼은 SCV·프로브·드론, 수송선은 드랍십·셔틀·
               오버로드. 정체 모를 한 기도 그 종족의 흔한 쪽(일꾼, 저그는 오버로드)으로
               부른다 — 어림이지만 없는 유닛 이름보다는 사실에 가깝다. */
            const label = race === "저그"
              ? (g.kind === "worker" ? "드론" : "오버로드")
              : g.kind === "carrier"
                ? (race === "테란" ? "드랍십" : "셔틀")
                : race === "테란" ? "SCV" : "프로브";
            /* 일꾼과 수송선은 이름을 안 띄운다(요청) — 일꾼은 자원 채취뿐 아니라 늘
               적당히 작은 점으로 통일, 수송선은 늘 제 도형(오버로드 풍선·드랍십·셔틀)이다. */
            const noName = g.kind === "worker" || g.kind === "carrier" || race === "저그";
            const activeNow = !noName && (pos.moving || sinceCmd <= ACTIVE_HOLD_SEC) && !nearHome;
            return (
              <span
                key={`s-${p.raw}-${g.kind}-${gi}`}
                className={cx(
                  "scr-motion-army",
                  activeNow ? "scr-motion-chip" : "scr-motion-dot",
                  // 일꾼은 부대 점보다 작고 옅은 정찰 점 크기(요청).
                  g.kind === "worker" && "scr-motion-scout",
                  team === 2 ? "scr-motion-team2" : "scr-motion-team1",
                )}
                style={{
                  left: pct(pos.x, grid.width), top: pct(pos.y, grid.height),
                  // 겹침 차례는 마지막 명령 시각(지적).
                  zIndex: 1000 + Math.round(Number.isFinite(sinceCmd) ? t - sinceCmd : rp[0][0]),
                  ...(activeNow ? chipStyle(p.raw, team) : glyphStyle(p.raw, team)),
                }}
              >
                {/* 수송선·오버로드는 점 대신 제 도형(요청) — 풍선·드랍십·셔틀. */}
                {race === "저그" && g.kind !== "worker"
                  ? <ShapeIcon kind="ovie" className="scr-motion-ovie" />
                  : g.kind === "carrier"
                    ? <ShapeIcon kind={race === "테란" ? "dship" : "shuttle"} className="scr-motion-ovie" />
                    : activeNow ? label : "●"}
              </span>
            );
          });
        })}

        {/* 스타팅 오버로드(요청: 아이콘으로 바로 표시) — 명령이 있기 전에도 본진 곁에
            풍선이 떠 있다. 첫 수송·단독 정찰 자취가 시작되면 그쪽 점이 이어받는다(정찰도
            본진에서 걸어 나가므로 자리가 이어진다). */}
        {motion.players.flatMap((p, pi) => {
          const race = bases.find((b) => b.key === p.raw)?.race;
          if (race !== "저그") return [];
          const firstScout = Math.min(Infinity, ...scoutSquads[pi]
            .filter((g) => g.kind !== "worker" && g.walk.length > 0)
            .map((g) => g.walk[0][0]));
          if (t >= firstScout) return [];
          const home = homeOf(p.raw);
          if (!home) return [];
          const team = teamOfRaw(p.raw);
          return [(
            <span
              key={`ovie0-${p.raw}`}
              className={cx("scr-motion-army", "scr-motion-dot", team === 2 ? "scr-motion-team2" : "scr-motion-team1")}
              style={{ left: pct(home[0] + 2.5, grid.width), top: pct(home[1] - 2.5, grid.height), ...glyphStyle(p.raw, team) }}
            >
              <ShapeIcon kind="ovie" className="scr-motion-ovie" />
            </span>
          )];
        })}

        {/* 마법 — 떨어진 자리에 이름이 잠깐 떠오른다. 핵만은 이름에 폭발 파문까지
            얹는다(요청: "핵 떨어지는거도 효과") — 경기 하나에 몇 번 없는, 그 판의 가장
            큰 사건이라 다른 마법과 같은 글자 한 줄로는 안 보였다. */}
        {castsNow.map(([, x, y, tech, raw], i) => (
          // 한글명을 모르는 기술은 아예 안 띄운다(요청: 텍스트는 전부 한글로).
          TECH_KO[tech] ? (
            <span
              key={`c-${i}`}
              className={cx(
                "scr-motion-cast", "scr-motion-chip",
                tech === "Nuclear Strike" && "scr-motion-nuke",
                teamOfRaw(raw) === 2 ? "scr-motion-team2" : "scr-motion-team1",
              )}
              style={{ left: pct(x, grid.width), top: pct(y, grid.height), ...chipStyle(raw, teamOfRaw(raw)) }}
            >
              {TECH_KO[tech]}
            </span>
          ) : null
        ))}

        {/* 드랍·태움(요청: 셔틀·드랍십·오버로드의 태우기와 드랍 표현) — 내린 자리엔
            '드랍', 제 수송선을 찍어 태운 자리엔 '태움'이 마법처럼 잠깐 떠오른다. */}
        {motion.players.flatMap((p) => {
          const team = teamOfRaw(p.raw);
          const mk = (pts: [number, number, number][] | undefined, label: string, kp: string) =>
            (pts ?? [])
              .filter(([s]) => s <= t && t - s <= CAST_HOLD_SEC)
              .map(([s, cx2, cy2]) => (
                <React.Fragment key={`${kp}-${p.raw}-${s}-${cx2}-${cy2}`}>
                  {/* 우주선 광선(요청) — 위(수송선)에서 유닛 자리로 노랗게 내리쬔다. */}
                  <span
                    className="scr-motion-beam"
                    style={{ left: pct(cx2, grid.width), top: pct(cy2, grid.height) }}
                  />
                  <span
                    className={cx("scr-motion-cast", "scr-motion-chip", team === 2 ? "scr-motion-team2" : "scr-motion-team1")}
                    style={{ left: pct(cx2, grid.width), top: pct(cy2, grid.height), ...chipStyle(p.raw, team) }}
                  >
                    {label}
                  </span>
                </React.Fragment>
              ));
          return [...mk(p.drops, "드랍", "dr"), ...mk(p.loads, "태움", "ld")];
        })}
        </div>
        {/* (삭제) PC 확대 조절바 — PC에서는 확대 기능을 통째로 걷었다(요청). 확대·이동은
            이제 모바일 손짓(더블탭·두 손가락)만의 것이다. */}
      </div>
      {teamCol(2)}
      </div>

      {/* 지도 아래 도구줄(요청: 범례·지형 수정·확대 토글을 전부 같은 한 줄에) — 가운데
          칸에 범례와 지형 버튼, 오른쪽 칸에 확대 토글. 범례의 본진(★)은 지웠다(요청) —
          본진 건물들이 저마다 제 도형을 갖게 되면서 ★는 더 이상 안 그려진다. 확대 토글은
          PC 전용(모바일은 핀치 확대), 큰 화면 모달에선 범례·지형이 숨어 토글만 남는다. */}
      <div className="scr-motion-toolrow">
        <div className="scr-motion-toolrow-mid">
          <div className="scr-motion-legend">
            <span>● 부대·유닛</span>
            <span>■ 건물</span>
            {/* 일꾼은 채굴·정찰 없이 전부 같은 작은 점이다(요청: 통일). 기호는 지도의
                점과 같은 ●를 부대보다 한 단 작게(지적: •는 너무 작았다). */}
            <span><i className="scr-motion-legend-worker">●</i> 일꾼</span>
            <span><Hammer size={8} /> 건설 중</span>
            <span><Cog size={8} /> 생산 중</span>
            <span><FlaskConical size={8} /> 업그레이드 중</span>
          </div>
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
        </div>
        <div className="scr-motion-expand-row">
          {/* 확대 창의 케밥(요청: PC 기본이 확대인 만큼 케밥·닫기가 있어야 한다) —
              카드 윗줄의 메뉴와 같은 것. 인라인에선 원본이 이미 있어 안 그린다. */}
          {big && menu}
          <button
            type="button" className="scr-motion-btn scr-motion-expand"
            // 사람이 줄였으면 기억한다(위 shrunk 주석) — 재생을 다시 눌러도 안 커진다.
            onClick={() => setBig((v) => { if (v) shrunk.current = true; return !v; })}
            aria-label={big ? "닫기" : "크게 보기"} title={big ? "닫기" : "크게 보기"}
          >
            {big ? <X size={14} /> : <Maximize2 size={12} />}
          </button>
        </div>
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
          {/* 색 전환(요청: 전환 버튼 살림) — 팀색 ↔ 개인색. 이름표는 지금 상태가 아니라
              '누르면 볼 것'이다(요청: "개인컬러 팀컬러를 반대로 뒤집고 뒤에 보기 붙이기")
              — "팀컬러"라 적혀 있는데 눌러도 팀컬러가 안 되는(이미 팀컬러인) 버튼은
              거꾸로 읽힌다. */}
          <button
            type="button" className="scr-motion-btn scr-motion-colorbtn"
            onClick={() => setColorMode((v) => (v === "team" ? "personal" : "team"))}
            title="색 기준 전환"
          >
            {colorMode === "team" ? "개인컬러 보기" : "팀컬러 보기"}
          </button>
        </span>
        {/* 옛 스냅 타임라인의 재생 버튼과 같은 꼴(요청) — 46px 완전 원, 속 채운 삼각형. */}
        <button
          type="button" className="scr-motion-play"
          onClick={() => {
            if (done) { setT(0); setDone(false); setPlaying(true); bigByDefault(); return; }
            if (!playing) bigByDefault();
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
      {/* 확대 모드의 오른쪽 댓글 영역(지적: "리플" = 댓글) — 맵 오른쪽 그리드 4번째 칸. */}
      {big && side ? <div className="scr-motion-sidewrap">{side}</div> : null}
      {terrainOpen && typeof grid.imageId === "number" && grid.image && (
        <TerrainReviewModal
          image={terrainModalImage}
          onClose={() => setTerrainOpen(false)}
          onSaved={(updated) => setWalkOverride(updated.walk ?? null)}
        />
      )}
    </div>
  );

  /* 큰 화면 보기(요청) — 같은 트리를 포털 모달에 옮겨 심는다: 재생 상태가 그대로 이어지고,
     범례·지형 버튼은 CSS(.scr-motion-big)가 감춰 맵과 조작부만 남는다. */
  if (big) {
    return createPortal(
      <div className="scr-modal-overlay">
        {/* 뒤 상세 창 가리개(지적: 확대를 누르면 뒤에 창이 남아 보임) — 화면 전체를 덮는
            어두운 막. 누르면 축소로 돌아간다(사람의 축소로 기억). */}
        <div
          className="scr-motion-big-backdrop"
          onClick={() => { shrunk.current = true; setBig(false); }}
        />
        {/* 폭 상한 = (가용 높이 − 위아래 여백·슬림 탐색바 몫) × 맵 가로세로비 + 옆 기둥
            몫(요청: 옆 기둥 위에서부터 로스터 → 조작부 → 댓글, 맵은 최대 크기) — 기둥은
            고정 300px + 간격·패딩 40px. */}
        <div
          className="scr-modal scr-motion-big-modal"
          style={{ width: `min(94vw, calc((100dvh - 88px) * ${(grid.width / grid.height).toFixed(4)} + 340px))` }}
        >{body}</div>
      </div>,
      document.body,
    );
  }
  return body;
}
