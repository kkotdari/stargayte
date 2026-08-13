import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Mountain, Pause, Play, RotateCcw, Shield, X } from "lucide-react";
import { useLockBodyScroll } from "../../utils/bodyScrollLock";
import TerrainReviewModal from "../../modals/TerrainReviewModal";
import Avatar from "../common/Avatar";
import { cx } from "../../utils/format";
import { UNIT_KO, BUILDING_KO, TECH_KO } from "../../utils/replaySummaryText";
import type { ReplayMapGrid } from "../../utils/replayParser";
import { isAirUnit, type MotionTrack, type SummaryMotion, type TrackPt } from "../../utils/replayMotion";
import { DEFENSE_BUILDINGS } from "../../utils/replayBuildMix";
import { terrainOf, decodeWalk, groundPath, groundPathSoft, type TerrainGrid } from "../../utils/minimapTerrain";
import {
  bodyFace, capFace, groundEllipse, sideFace, topFace, type ShapeFace,
  boxFaces3, cylinderFaces3, discPath3, polyPath3, project,
  domeFaces3, faceLight, frustumFaces3, hornFaces, limbFaces, tubeFaces,
  withTopView, withYaw,
} from "../../utils/shapeOblique";
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
/** 핵 낙하 시간(초) — 발사(런치)부터 실제 착탄까지. 폭발 효과는 이 뒤에야 시작한다(지적). */
const NUKE_FALL_SEC = 7;
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
/** 이만큼 조용했던 부대는 먼 점을 못 가져간다(초, 지적: 잠든 무명 부대가 명령을 가로채
 *  순간이동처럼 보임) — 그 클릭은 새 부대로 태어나거나(자리가 있으면) 버려진다. */
const SQUAD_RETIRE_SEC = 120;
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
      /* 옛 자리가 곧 다시 안 쓰인다 — 무리째 이사다. 이어 걸어간다.
         단, 한참 잠든 부대는 못 가져간다(지적: "기존 명령 받은 무명 부대에 계속 명령을
         할당해서" 순간이동) — 2분 넘게 조용하던 부대가 맵 저쪽 클릭을 가로채면 유령이
         걸어간다. 그 클릭은 아래에서 새 부대로 태어난다. */
      if (!staysBehind && pt[0] - last[0] <= SQUAD_RETIRE_SEC) {
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
       조용한 부대를 골라, 맵 반대편의 부대가 유령처럼 가로질러 걸었다. 그마저도 아주 멀거나
       그 부대가 한참 잠들어 있었으면 빠뜨린다 — 놓치는 것보다 유령이 더 큰 거짓말이다. */
    if (bestD <= SQUAD_TELEPORT_TILES
      && pt[0] - squads[best][squads[best].length - 1][0] <= SQUAD_RETIRE_SEC) {
      squads[best].push(pt);
      prevIdx = best;
      if (g !== undefined) gToSquad.set(g, best);
    }
  }
  return squads;
}

function dropSpikes(
  pts: TrackPt[], span: number,
): TrackPt[] {
  if (pts.length < 3) return pts;
  const far = span * SPIKE_FAR_RATE;
  const back = span * SPIKE_BACK_RATE;
  const at = (p: TrackPt) => [p[1], p[2]] as const;
  const gap = (a: TrackPt, b: TrackPt) =>
    Math.hypot(at(a)[0] - at(b)[0], at(a)[1] - at(b)[1]);
  const out: TrackPt[] = [pts[0]];
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
/* 25 → 10초(요청: 아이콘으로 변경되는 시간 줄이기) — 이름이 오래 남으니 지도가 글자로
   덮였다. 열 초면 "방금 명령받았다"를 읽기에 충분하다. */
const ACTIVE_HOLD_SEC = 10;
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
  "Creep Colony": "creep",
  // 넥서스는 넙적한 세모+양옆 기둥, 게이트는 원 위의 가파른 삼각(요청).
  "Command Center": "tomb", Nexus: "pyramidWide", Gateway: "gate",
  /* 저그 본진 3형제(요청) — 해처리는 곡선 둔덕(각진 T는 부자연스럽다는 지적), 레어는
     그 둔덕의 바닥에 뿔, 하이브는 더 높은 뿔에 안쪽 가시까지 — 단계가 오를수록 뿔이
     자란다. */
  Hatchery: "hatchery", Lair: "lair", Hive: "hive",
  "Spawning Pool": "pool",
  /* 다른 생산 건물도 원래 실루엣을 살린 벡터로(요청) — 배럭은 측면에서 본 정육면체(요청),
     팩토리는 8각 단면 각기둥(스크린샷), 스타포트는 원형 착륙 패드(스크린샷 — 종이비행기
     설명은 오해), 로보틱스는 돔, 스타게이트는 문(아치). */
  Barracks: "cube", Factory: "factory", Starport: "plane",
  "Robotics Facility": "dome", Stargate: "arch",
  // 애드온(요청) — 컴샛(스캔)·핵 사일로는 모델, 나머지는 +.
  "Comsat Station": "comsat", "Nuclear Silo": "nsilo",
  // 가스 건물 셋(실물 참고) — 종족별 정제소. 크기는 발자국(4×2)이 맞춘다.
  Refinery: "refinery", Assimilator: "assim", Extractor: "extract",
  // 업그레이드·테크 건물들(요청: 다 만들자).
  Academy: "academy", "Engineering Bay": "ebay", Armory: "armory", "Science Facility": "scifac",
  Forge: "forge", "Cybernetics Core": "cyber", "Citadel of Adun": "citadel",
  "Templar Archives": "archives", "Robotics Support Bay": "robobay", Observatory: "observatory",
  "Fleet Beacon": "fleetbeacon", "Arbiter Tribunal": "tribunal", "Shield Battery": "sbattery",
  "Evolution Chamber": "evo", "Hydralisk Den": "hydraden", Spire: "spire", "Greater Spire": "gspire",
  "Queen's Nest": "queensnest", "Defiler Mound": "dmound", "Ultralisk Cavern": "cavern",
  "Nydus Canal": "nydus",
};
/** 저그 둔덕 몸통 — 셋이 같은 몸을 쓰고 뿔만 자란다(아래 lair/hive). 옆구리는 종 모양
 *  으로 불룩하게(지적: "해처리의 곡선이 반대로 됨" — 나팔처럼 파인 곡선을 뒤집었다).
 *  꼭대기는 평평하고, 높이보다 옆으로 넓다(지적). */
/* 후지산 옆모습(지적: 뚱뚱하면 안 된다 — 위쪽은 거의 직선으로 가파르고 내려갈수록
   완만하게 벌어지는 오목 곡선), 바닥은 거미줄처럼 사방으로 퍼지는 가닥들(지적). */
// 머리(윗부분) 폭을 한 단 좁혔다(지적: 너무 두꺼움).
/* (전면 3D화·요청) 손으로 깎던 저그 본진 상수들은 3D 빌더(SHAPE_BUILDERS)로 대체됐다. */
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
/* ── 전면 3D 빌더(요청: 모든 건물·수송선을 3D 도형으로 — 기존 손 작업 대체) ─────────
   전부 project() 기반이라 withYaw로 감싸면 아무 요잉에서나 다시 투영된다.
   표준 시점 결과는 아래 SHAPE_FACES에 한 번 구워 쓴다. */
/** 벌어진 다리 + 원반 발(테란 실물 공통) — 몸통 밑에서 바깥-아래로 뻗고 발판이 받친다. */
function legAndFoot(px: number, py: number, zTop: number): ShapeFace[] {
  return [
    ...hornFaces(px * 0.72, py * 0.72, zTop, px * 1.12, py * 1.12, 0.7, 1.1),
    bodyFace(discPath3(px * 1.16, py * 1.16, 0.35, 1.15)),
    sideFace(discPath3(px * 1.16, py * 1.16, 0.32, 1.15), 0.25),
  ];
}

/** 저그 갈고리(정정: 마디가 아니라 쭉 이어진 휘어진 칼) — 밖-앞으로 나갔다 안으로
 *  감기는 한 장의 낫 날. m은 좌우, s는 덩치 배율, z0는 뿌리 높이. */
function claw3(m: 1 | -1, s: number, z0: number): ShapeFace[] {
  const [a1x, a1y] = project(m * 0.7 * s, 0.6 * s, z0);
  const [a2x, a2y] = project(m * 1.5 * s, 0.2 * s, z0);
  const [ox, oy] = project(m * 2.9 * s, 2.4 * s, z0 + 0.6);
  const [tx, ty] = project(m * 1 * s, 4.4 * s, z0 - 0.6);
  const [ix, iy] = project(m * 1.9 * s, 1.9 * s, z0 + 0.2);
  const d = `M${a1x} ${a1y} Q${ox} ${oy} ${tx} ${ty} Q${ix} ${iy} ${a2x} ${a2y} Z`;
  return [bodyFace(d), sideFace(d, 0.16)];
}

/** 크립 갈퀴 바닥(지적: 콜로니 바닥은 동그라미가 아니라 갈퀴) — 사방으로 뻗는 납작한
 *  덩굴 조각들. */
function creepSplat(r: number): ShapeFace[] {
  const out: ShapeFace[] = [];
  for (const ang of [0, 45, 90, 135, 180, 225, 270, 315]) {
    const a = (ang * Math.PI) / 180;
    const sx = Math.sin(a);
    const sy = Math.cos(a);
    const tx = Math.cos(a);
    const ty = -Math.sin(a);
    out.push(sideFace(polyPath3([
      [sx * r * 0.3 + tx * 0.9, sy * r * 0.3 + ty * 0.9, 0.12],
      [sx * r, sy * r, 0.12],
      [sx * r * 0.3 - tx * 0.9, sy * r * 0.3 - ty * 0.9, 0.12],
    ]), 0.3));
  }
  out.push(sideFace(discPath3(0, 0, 0.1, r * 0.45), 0.3));
  return out;
}

export const SHAPE_BUILDERS: Record<string, () => ShapeFace[]> = {
  /* 커맨드 센터(실물 참고) — 넓은 원반 선체 3단 + 위 관제 모듈(빛 띠·돔) + 앞으로
     내려오는 전개 램프 + 네 귀 돔 발. */
  tomb: () => {
    const pod = (px: number, py: number): ShapeFace[] => [
      ...cylinderFaces3(px, py, 1.1, 1.1),
      ...domeFaces3(px, py, 1.6, 1.4, 1.05),
    ];
    const out: ShapeFace[] = [...pod(-5.4, -4.4), ...pod(5.4, -4.4)];
    out.push(...cylinderFaces3(0, 0, 6.4, 2.4));
    out.push(capFace(discPath3(0, 0, 2.42, 5.6), 0.2));
    // 위뚜껑은 큰 돔(지적: 돔 형태를 살린다).
    out.push(...domeFaces3(0, 0, 5.4, 3.4, 2.4));
    // 그릇(지적) — 돔 오른쪽 어깨의 벌어진 아가리 통.
    out.push(...cylinderFaces3(3.4, -2.2, 1.15, 1.3, 4.1));
    out.push(bodyFace(discPath3(3.4, -2.2, 5.45, 1.7)));
    out.push(capFace(discPath3(3.4, -2.2, 5.5, 1.25), 0.5));
    // 관제 모듈 — 돔 꼭대기의 상자 + 앞면 빛 띠 + 지붕 돔.
    out.push(...boxFaces3(0, 0.2, 3, 2.6, 1.8, 5.5));
    out.push(capFace(polyPath3([[-1.2, 1.51, 5.9], [1.2, 1.51, 5.9], [1.2, 1.51, 6.3], [-1.2, 1.51, 6.3]]), 0.5));
    out.push(topFace(polyPath3([[-1, 1.52, 5.95], [1, 1.52, 5.95], [1, 1.52, 6.25], [-1, 1.52, 6.25]]), 0.35));
    out.push(...domeFaces3(0, 0.2, 1.15, 0.85, 7.3));
    // 전개 램프(실물) — 선체 중턱 해치에서 앞 바닥으로.
    const ramp = polyPath3([[-1.3, 6, 2.4], [1.3, 6, 2.4], [2.1, 9.6, 0], [-2.1, 9.6, 0]]);
    out.push(bodyFace(ramp), topFace(ramp, 0.16));
    for (const t of [0.25, 0.5, 0.75]) {
      const yy = 6 + 3.6 * t;
      const zz = 2.4 * (1 - t);
      const ww = 1.3 + 0.8 * t;
      out.push(capFace(polyPath3([[-ww, yy, zz + 0.02], [ww, yy, zz + 0.02], [ww, yy + 0.3, zz - 0.18], [-ww, yy + 0.3, zz - 0.18]]), 0.3));
    }
    out.push(...pod(-5.6, 3.9), ...pod(5.6, 3.9));
    return out;
  },
  /* 배럭(실물 참고) — 중앙 몸통 + 좌우로 더 높은 쌍탑 + 벌어진 네 다리와 원반 발. */
  cube: () => [
    // 평면을 정사각에 가깝게(지적: 실물이 거의 정사각) — 발자국 눌림은 캔버스가 맡는다.
    // 다리 여섯(지적) — 앞·가운데·뒤 세 쌍.
    ...legAndFoot(-3.9, 3.4, 2.8),
    ...legAndFoot(3.9, 3.4, 2.8),
    ...legAndFoot(-4.4, 0, 2.8),
    ...legAndFoot(4.4, 0, 2.8),
    ...legAndFoot(-3.9, -3.4, 2.8),
    ...legAndFoot(3.9, -3.4, 2.8),
    ...boxFaces3(0, 0, 5.8, 6.6, 5, 2.6),
    ...boxFaces3(-3.9, 0, 2.7, 5.6, 7.4, 2.2),
    ...boxFaces3(3.9, 0, 2.7, 5.6, 7.4, 2.2),
    topFace(polyPath3([[-5.2, 2.2, 9.6], [-3, 2.2, 9.6], [-3, 1.4, 9.6], [-5.2, 1.4, 9.6]]), 0.3),
    topFace(polyPath3([[3, 2.2, 9.6], [5.2, 2.2, 9.6], [5.2, 1.4, 9.6], [3, 1.4, 9.6]]), 0.3),
  ],
  /* 서플라이(단순화, 지적) — 본체 상자 + 지붕 큰 회전 통풍구 + 앞면의 더 큰 둥근 팬
     둘 + 왼앞 줄무늬 차단바. 잔장식(등판·캐니스터·탱크)은 걷어냈다. */
  trapezoid: () => {
    // 높이 상향(지적: 4.6→6).
    const out: ShapeFace[] = [...boxFaces3(0, 0, 10.8, 6.8, 6)];
    // 지붕 회전 통풍구 — 크게.
    out.push(capFace(discPath3(-2.3, 0.3, 6.05, 2.8), 0.3));
    out.push(bodyFace(discPath3(-2.3, 0.3, 6.1, 2.3)));
    for (const ang of [0, 45, 90, 135]) {
      const a = (ang * Math.PI) / 180;
      out.push(capFace(polyPath3([
        [-2.3 - Math.sin(a) * 2.05, 0.3 - Math.cos(a) * 2.05, 6.15],
        [-2.3 + Math.sin(a) * 2.05, 0.3 + Math.cos(a) * 2.05, 6.15],
        [-2.3 + Math.sin(a) * 2.05 + Math.cos(a) * 0.32, 0.3 + Math.cos(a) * 2.05 - Math.sin(a) * 0.32, 6.15],
        [-2.3 - Math.sin(a) * 2.05 + Math.cos(a) * 0.32, 0.3 - Math.cos(a) * 2.05 - Math.sin(a) * 0.32, 6.15],
      ]), 0.35));
    }
    // 앞면 둥근 팬 둘 — 더 크게(지적), 앞면에 바로 얹는다.
    const fan = (fx: number, fz: number, r: number): void => {
      const [px, py] = project(fx, 3.41, fz);
      out.push(capFace(groundEllipse(px, py, r, r * 0.94), 0.42));
      out.push(bodyFace(groundEllipse(px, py, r * 0.78, r * 0.72)));
      for (const ang of [15, 105, 195, 285]) {
        const a = (ang * Math.PI) / 180;
        out.push(capFace(`M${px} ${py} L${px + Math.cos(a) * r * 0.7} ${py + Math.sin(a) * r * 0.64} A${r * 0.7} ${r * 0.64} 0 0 1 ${px + Math.cos(a + 1.1) * r * 0.7} ${py + Math.sin(a + 1.1) * r * 0.64} Z`, 0.32));
      }
    };
    fan(0.8, 3, 2.05);
    fan(3.7, 2.9, 1.6);
    // 왼앞 줄무늬 차단바.
    out.push(...boxFaces3(-3.3, 4.05, 3.6, 0.9, 1.15));
    for (let i = 0; i < 4; i += 1) {
      const x0 = -4.9 + i * 0.9;
      out.push(capFace(polyPath3([
        [x0, 4.51, 0.15], [x0 + 0.45, 4.51, 0.15], [x0 + 0.85, 4.51, 1], [x0 + 0.4, 4.51, 1],
      ]), 0.4));
    }
    return out;
  },
  /* 팩토리(실물 참고) — 큰 본체 상자 + 앞 낮은 별채 + 지붕 굴뚝 셋 + 오른뒤 포탑 + 발. */
  factory: () => [
    ...boxFaces3(-0.6, -0.6, 9.8, 6, 5.8, 1.2),
    ...boxFaces3(3.2, 2.8, 4, 2.8, 3.6, 1.2),
    ...cylinderFaces3(-3.4, -2, 0.85, 1.7, 7),
    ...cylinderFaces3(-1.5, -2.2, 0.85, 1.7, 7),
    ...cylinderFaces3(0.4, -2.4, 0.85, 1.7, 7),
    ...boxFaces3(3.4, -2.2, 2.8, 2.2, 2.4, 7),
    ...tubeFaces(3, -3, 5.4, -3, 0.45, 9.6),
    /* 다리는 없다(지적) — 대신 앞으로 나란히 내려오는 경사로 셋. */
    ...[-3.8, -1, 1.8].flatMap((rx) => {
      const d = polyPath3([[rx - 1.1, 2.4, 1.2], [rx + 1.1, 2.4, 1.2], [rx + 1.3, 5.2, 0], [rx - 1.3, 5.2, 0]]);
      return [bodyFace(d), topFace(d, 0.14), sideFace(polyPath3([[rx + 1.1, 2.4, 1.2], [rx + 1.3, 5.2, 0], [rx + 1.05, 5.2, 0], [rx + 0.88, 2.4, 1.2]]), 0.25)];
    }),
  ],
  /* 스타포트(실물 참고 + 지적) — 다리 여섯, 앞으로 뾰족 튀어나온 코, 옆 날개. 드럼 위
     큰 원형 패드와 대각 팔 넷은 그대로. */
  plane: () => {
    const out: ShapeFace[] = [];
    for (const [px, py] of [
      [-4.6, 3.4], [4.6, 3.4], [-5.2, 0], [5.2, 0], [-4.6, -3.4], [4.6, -3.4],
    ] as [number, number][]) {
      out.push(...legAndFoot(px, py, 2.4));
    }
    out.push(...cylinderFaces3(0, 0, 5, 3.2, 0.8));
    /* 앞부분은 선착장 마당(정정: 뾰족 코가 아니라) — 드럼에서 앞으로 내민 평평한
       착륙 진입로. 끝은 살짝 좁아지는 각진 마당이다. */
    out.push(...boxFaces3(0, 5.2, 4.2, 3.2, 1.9, 0.9));
    out.push(topFace(polyPath3([[-2.1, 3.6, 2.8], [2.1, 3.6, 2.8], [1.7, 6.8, 2.8], [-1.7, 6.8, 2.8]]), 0.2));
    out.push(capFace(polyPath3([[-1.3, 4.2, 2.83], [1.3, 4.2, 2.83], [1.1, 6.2, 2.83], [-1.1, 6.2, 2.83]]), 0.25));
    // 옆 날개(지적) — 좌우로 짧게 뻗는 판.
    out.push(bodyFace(polyPath3([[-5, 1, 3.4], [-8, 0.2, 2.6], [-7.6, -1, 2.6], [-4.8, -0.6, 3.4]])));
    out.push(bodyFace(polyPath3([[5, 1, 3.4], [8, 0.2, 2.6], [7.6, -1, 2.6], [4.8, -0.6, 3.4]])));
    out.push(sideFace(polyPath3([[5, 1, 3.4], [8, 0.2, 2.6], [7.6, -1, 2.6], [4.8, -0.6, 3.4]]), 0.2));
    out.push(bodyFace(discPath3(0, 0, 4.1, 6.4)));
    out.push(topFace(discPath3(0, 0, 4.13, 5.2), 0.25));
    out.push(capFace(discPath3(0, 0, 4.16, 3.9), 0.35));
    for (const ang of [45, 135, 225, 315]) {
      const a = (ang * Math.PI) / 180;
      const bx2 = Math.sin(a) * 4.6;
      const by2 = Math.cos(a) * 4.6;
      const tx2 = Math.sin(a) * 7.2;
      const ty2 = Math.cos(a) * 7.2;
      out.push(bodyFace(polyPath3([[bx2, by2, 4], [tx2, ty2, 6], [tx2 * 1.04, ty2 * 1.04, 5.5], [bx2 * 1.06, by2 * 1.06, 3.5]])));
      const [kx, ky] = project(tx2, ty2, 6.1);
      out.push(bodyFace(groundEllipse(kx, ky, 0.75, 0.6)));
      out.push(topFace(groundEllipse(kx - 0.2, ky - 0.2, 0.35, 0.25), 0.4));
    }
    return out;
  },
  /* 벙커(실물 참고) — 사방으로 비탈진 날개 판(정사각 배치) + 날개마다 내려오는 계단 +
     가운데 강철 돔 + 윗면 원형 해치. 날개 밝기는 세계 광원(faceLight)이 정한다. */
  tombFlat: () => {
    const out: ShapeFace[] = [];
    for (const ang of [0, 90, 180, 270]) {
      const a = (ang * Math.PI) / 180;
      const sx = Math.sin(a);
      const sy = Math.cos(a);
      const cxa = Math.cos(a);
      const sya = -Math.sin(a);
      const d = polyPath3([
        [sx * 2 + cxa * 2.4, sy * 2 + sya * 2.4, 2.6],
        [sx * 2 - cxa * 2.4, sy * 2 - sya * 2.4, 2.6],
        [sx * 5.6 - cxa * 3.3, sy * 5.6 - sya * 3.3, 0],
        [sx * 5.6 + cxa * 3.3, sy * 5.6 + sya * 3.3, 0],
      ]);
      const { visible, face } = faceLight(sx, sy);
      if (!visible) continue;
      out.push(bodyFace(d), ...face(d));
      /* 사방으로 내려오는 계단(요청) — 날개 가운데로 살짝 도드라진 디딤판 셋. */
      const w = 0.95;
      for (let i = 0; i < 3; i += 1) {
        const d0 = 2.3 + i * 1.1;
        const d1 = d0 + 1.1;
        const z0 = 2 - i * 0.66;
        const z1 = z0 - 0.66;
        const tread = polyPath3([
          [sx * d0 + cxa * w, sy * d0 + sya * w, z0],
          [sx * d0 - cxa * w, sy * d0 - sya * w, z0],
          [sx * d1 - cxa * w, sy * d1 - sya * w, z0],
          [sx * d1 + cxa * w, sy * d1 + sya * w, z0],
        ]);
        const riser = polyPath3([
          [sx * d1 + cxa * w, sy * d1 + sya * w, z0],
          [sx * d1 - cxa * w, sy * d1 - sya * w, z0],
          [sx * d1 - cxa * w, sy * d1 - sya * w, z1],
          [sx * d1 + cxa * w, sy * d1 + sya * w, z1],
        ]);
        out.push(bodyFace(`${tread} ${riser}`), topFace(tread, 0.22), ...face(riser));
      }
    }
    // 뚜껑은 납작하게(지적) — 낮은 돔과 그 높이에 맞춘 해치.
    out.push(...domeFaces3(0, 0, 3.6, 2.4, 1.6));
    out.push(topFace(discPath3(0, 0, 4.05, 1.7), 0.3));
    out.push(capFace(discPath3(0, 0, 4.08, 0.7), 0.35));
    return out;
  },
  /* 넥서스(실물 참고) — 절두 황금 피라미드(높이 한 단 낮춤) + 면의 능선 띠 + 꼭대기
     파란 수정 + 사방 삼각 진입받침 + 네 귀 오벨리스크. 뒤 기둥은 피라미드가 가리도록
     먼저 그린다(지적: 기둥이 비쳐 보였다). */
  pyramidWide: () => {
    const pillar = (px: number, py: number): ShapeFace[] => {
      const [kx, ky] = project(px, py, 5.8);
      return [
        bodyFace(discPath3(px, py, 0.45, 1.9)),
        sideFace(discPath3(px, py, 0.42, 1.9), 0.25),
        ...hornFaces(px, py, 0.4, px, py, 8.8, 2),
        topFace(groundEllipse(kx, ky, 0.45, 0.65), 0.5),
      ];
    };
    /* 기둥 자리 6.6 → 6.0(수리: 대각 모서리 기둥이 요잉 투영에서 뷰박스 가로(±8)를
       넘어 잘려 떨어져 나간 듯 보였다 — rx = 6.6cos20 + 6.6sin20 ≈ 8.46). */
    // 6.0 → 5.6(재지적: 왼뒤 기둥이 너무 바깥) — 받침 원반이 피라미드 모서리에 걸치게 붙인다.
    const out: ShapeFace[] = [...pillar(-5.6, -5.6), ...pillar(5.6, -5.6)];
    out.push(...frustumFaces3(0, 0, 10.6, 10.6, 3.2, 3.2, 6.4));
    // 앞면 능선 띠 — 경사면을 따라 층층이 가로 띠.
    const half = (z: number): number => 5.3 - (5.3 - 1.6) * (z / 6.4);
    for (const bz of [1.4, 3, 4.6]) {
      const w0 = half(bz) - 0.35;
      const w1 = half(bz + 0.6) - 0.35;
      out.push(topFace(polyPath3([
        [-w0, half(bz), bz], [w0, half(bz), bz],
        [w1, half(bz + 0.6), bz + 0.6], [-w1, half(bz + 0.6), bz + 0.6],
      ]), 0.2));
    }
    // 꼭대기 받침 + 파란 수정.
    out.push(...boxFaces3(0, 0, 2.9, 2.9, 0.8, 6.4));
    const [gx, gy] = project(0, 0, 7.2);
    out.push(bodyFace(`M${gx} ${gy - 2.7} L${gx + 1.25} ${gy - 0.9} L${gx} ${gy + 0.55} L${gx - 1.25} ${gy - 0.9} Z`));
    out.push(topFace(`M${gx} ${gy - 2.7} L${gx - 1.25} ${gy - 0.9} L${gx} ${gy + 0.55} L${gx - 0.4} ${gy - 0.95} Z`, 0.45));
    /* 사방 삼각형 진입받침(요청) — 면 가운데에 기대어 바닥으로 벌어지는 낮은 비탈. */
    for (const ang of [0, 90, 180, 270]) {
      const a = (ang * Math.PI) / 180;
      const sx = Math.sin(a);
      const sy = Math.cos(a);
      const cxa = Math.cos(a);
      const sya = -Math.sin(a);
      const { visible, face } = faceLight(sx, sy);
      if (!visible) continue;
      const d = polyPath3([
        [sx * 3.9, sy * 3.9, 3.4],
        [sx * 8 + cxa * 2.4, sy * 8 + sya * 2.4, 0],
        [sx * 8 - cxa * 2.4, sy * 8 - sya * 2.4, 0],
      ]);
      out.push(bodyFace(d), ...face(d));
    }
    out.push(...pillar(-5.6, 5.6), ...pillar(5.6, 5.6));
    return out;
  },
  /* 게이트웨이(실물 점검) — 낮은 사방 경사로 마당 위에 마주 기운 어금니 탑 한 쌍이
     사이를 띄워 문을 이루고, 그 사이에 소환 빛이 선다. */
  gate: () => {
    const h = 1.1;
    const a = 3.1;
    const b = 2.4;
    const run = 2.5;
    const plateau = polyPath3([[-a, b, h], [a, b, h], [a, -b, h], [-a, -b, h]]);
    const front = polyPath3([[-a, b, h], [a, b, h], [a, b + run, 0], [-a, b + run, 0]]);
    const back = polyPath3([[-a, -b, h], [a, -b, h], [a, -b - run, 0], [-a, -b - run, 0]]);
    const right = polyPath3([[a, -b, h], [a, b, h], [a + run, b, 0], [a + run, -b, 0]]);
    const left = polyPath3([[-a, -b, h], [-a, b, h], [-a - run, b, 0], [-a - run, -b, 0]]);
    const out: ShapeFace[] = [
      bodyFace(`${back} ${left} ${right} ${plateau} ${front}`),
      sideFace(back, 0.2),
      sideFace(right, 0.3),
      topFace(plateau, 0.22),
    ];
    // (삭제·지적) 검은 뿔·안테나 가지들 — 이상한 뒷가지로 읽혀 걷어냈다.
    // 실물 점검(스프라이트 시트) — 게이트는 돛 하나가 아니라 마주 기운 어금니 탑
    // 한 쌍이 사이를 띄우고 문을 이룬다. 사이엔 소환 빛.
    const [wx, wy] = project(0, 0.1, 3.6);
    out.push(topFace(groundEllipse(wx, wy, 1.45, 2), 0.4));
    out.push(...hornFaces(-2.7, 0, 0.8, -1, -0.3, 9.6, 2.3));
    out.push(...hornFaces(2.7, 0, 0.8, 1, -0.3, 9.6, 2.3));
    return out;
  },
  /* 스타게이트(복원 — 슬래브 판 폐기) — 세운 원통을 세로로 반 갈라 두 쪽을 사이 띄워
     마주 세운 꼴. 구멍은 앞단면(아래)에 파여 함선이 그 사이·앞으로 나온다. 반쪽마다
     청록 창 점 세 개. */
  arch: () => {
    const [xcL] = project(-1.9, 0, 0);
    const [xcR] = project(1.9, 0, 0);
    const [, tyS] = project(0, 0, 8.2);
    const [, byS] = project(0, 0, 0);
    const R = 2.3;
    const ry = R * 0.45;
    const half = (xc: number, m2: 1 | -1): { body: string; top: string; hole: string } => {
      const sw = m2 === -1 ? 0 : 1;
      return {
        body: `M${xc} ${tyS - ry} A${R} ${ry} 0 0 ${sw} ${xc + m2 * R} ${tyS}`
          + ` L${xc + m2 * R} ${byS} A${R} ${ry} 0 0 ${sw} ${xc} ${byS + ry} L${xc} ${tyS + ry} Z`,
        top: `M${xc} ${tyS - ry} A${R} ${ry} 0 0 ${sw} ${xc} ${tyS + ry} Z`,
        hole: `M${xc} ${byS - ry * 0.6} A${R * 0.6} ${ry * 0.6} 0 0 ${sw} ${xc} ${byS + ry * 0.6} Z`,
      };
    };
    const L2 = half(xcL, -1);
    const R2 = half(xcR, 1);
    const win = (xc: number, m2: 1 | -1): ShapeFace[] => {
      const yMid = (tyS + byS) / 2;
      return [0, 1, 2].map((i) =>
        topFace(groundEllipse(xc + m2 * 1.05, yMid - 1.4 + i * 1.4, 0.3, 0.42), 0.45));
    };
    return [
      sideFace(discPath3(0, 0.2, 0, 5), 0.22),
      bodyFace(L2.body), topFace(L2.top), capFace(L2.hole, 0.4),
      topFace(`M${xcL - R} ${tyS} L${xcL - R + 0.6} ${tyS + 0.3} L${xcL - R + 0.6} ${byS} L${xcL - R} ${byS} Z`, 0.14),
      ...win(xcL, -1),
      bodyFace(R2.body), topFace(R2.top), capFace(R2.hole, 0.4),
      sideFace(`M${xcR + R} ${tyS} L${xcR + R - 0.6} ${tyS + 0.3} L${xcR + R - 0.6} ${byS} L${xcR + R} ${byS} Z`, 0.2),
      ...win(xcR, 1),
    ];
  },
  /* 파일런(정정 둘) — 고리를 수정 허리께로 더 올리고(지적), 수정은 매끈한 육각
     보석으로 다듬었다: 위 뾰족·어깨·허리·아래 뾰족이 좌우대칭. */
  diamond: () => {
    // 고리가 바닥에 붙어 보인다(지적) — 그림자를 줄이고 고리를 공중으로 더 올린다.
    const out: ShapeFace[] = [sideFace(discPath3(0, 0, 0, 3), 0.24)];
    // 고리 많이 위로(지적) — 수정 허리에 걸린다.
    const [cx, cy] = project(0, 0, 6.4);
    const rxo = 4.6;
    const ryo = rxo * 0.45;
    const rxi = 3.2;
    const ryi = rxi * 0.45;
    const ringBack = `M${cx - rxo} ${cy} A${rxo} ${ryo} 0 0 1 ${cx + rxo} ${cy} L${cx + rxi} ${cy} A${rxi} ${ryi} 0 0 0 ${cx - rxi} ${cy} Z`;
    const ringFront = `M${cx - rxo} ${cy} A${rxo} ${ryo} 0 0 0 ${cx + rxo} ${cy} L${cx + rxi} ${cy} A${rxi} ${ryi} 0 0 1 ${cx - rxi} ${cy} Z`;
    const claw = (ang: number, h: number): ShapeFace[] => {
      const a = (ang * Math.PI) / 180;
      return hornFaces(Math.sin(a) * 3.9, Math.cos(a) * 3.9, 6.2, Math.sin(a) * 3, Math.cos(a) * 3, h, 1.05);
    };
    // 뒤 발톱들 → 뒤 링 → 수정 → 앞 링 → 앞 발톱들 순으로 겹친다.
    for (const ang of [135, 180, -135]) out.push(...claw(ang, 9.4));
    out.push(bodyFace(ringBack), sideFace(ringBack, 0.3));
    const [gx, gy] = project(0, 0, 7.4);
    const R = 5.2;
    const W = 2.6;
    const gem = `M${gx} ${gy - R} L${gx + W * 0.82} ${gy - R * 0.42} L${gx + W} ${gy + R * 0.28} L${gx} ${gy + R * 0.72} L${gx - W} ${gy + R * 0.28} L${gx - W * 0.82} ${gy - R * 0.42} Z`;
    out.push(bodyFace(gem));
    // 왼 면 밝게 · 오른 면 어둡게 · 세로 능선은 좁게.
    out.push(topFace(`M${gx} ${gy - R} L${gx - W * 0.82} ${gy - R * 0.42} L${gx - W} ${gy + R * 0.28} L${gx} ${gy + R * 0.72} L${gx - W * 0.3} ${gy + R * 0.24} L${gx - W * 0.3} ${gy - R * 0.36} Z`, 0.26));
    out.push(sideFace(`M${gx} ${gy - R} L${gx + W * 0.82} ${gy - R * 0.42} L${gx + W} ${gy + R * 0.28} L${gx} ${gy + R * 0.72} L${gx + W * 0.3} ${gy + R * 0.24} L${gx + W * 0.3} ${gy - R * 0.36} Z`, 0.22));
    out.push(topFace(`M${gx} ${gy - R} L${gx + W * 0.3} ${gy - R * 0.36} L${gx} ${gy - R * 0.1} L${gx - W * 0.3} ${gy - R * 0.36} Z`, 0.4));
    out.push(bodyFace(ringFront), topFace(ringFront, 0.22));
    for (const ang of [90, -90]) out.push(...claw(ang, 9.7));
    for (const ang of [45, -45, 0]) out.push(...claw(ang, 9.2));
    return out;
  },
  /* 로보틱스(실물 참고, 곡선의 미) — 둥근 대야와 도톰한 링 테두리, 어두운 격자 구덩이,
     테두리의 매끈한 흰 가시, 그리고 테두리에서 구덩이 위로 부드럽게 굽어 드리우는 팔. */
  dome: () => {
    const pt = (x: number, y: number, z: number): string => {
      const [px, py] = project(x, y, z);
      return `${px} ${py}`;
    };
    const out: ShapeFace[] = [...cylinderFaces3(0, 0, 6.6, 2.4)];
    // 구덩이 격자 — 까만 바닥판 없이(지적: 같은 톤) 밝은 줄만 얹는다.
    const bars: string[] = [];
    for (const o of [-2.8, -1, 1, 2.8]) {
      bars.push(polyPath3([[-4.6, o + 0.12, 2.5], [4.6, o + 0.12, 2.5], [4.6, o - 0.12, 2.5], [-4.6, o - 0.12, 2.5]]));
      bars.push(polyPath3([[o + 0.12, -4.6, 2.5], [o + 0.12, 4.6, 2.5], [o - 0.12, 4.6, 2.5], [o - 0.12, -4.6, 2.5]]));
    }
    out.push(topFace(bars.join(" "), 0.22));
    // 도톰한 링 테두리 — 위 테를 둥근 띠로 두른다.
    const [rcx, rcy] = project(0, 0, 2.5);
    out.push(bodyFace(`M${rcx - 6.9} ${rcy} a6.9 3.35 0 1 0 13.8 0a6.9 3.35 0 1 0 -13.8 0`
      + ` M${rcx - 5.5} ${rcy} a5.5 2.65 0 1 1 11 0a5.5 2.65 0 1 1 -11 0`));
    // 테두리 빛 눈금 — 앞쪽 띠의 밝은 조각들.
    for (const ang of [115, 80, 45, 245]) {
      const a2 = (ang * Math.PI) / 180;
      out.push(topFace(groundEllipse(rcx + Math.cos(a2) * 6.2, rcy + Math.sin(a2) * 3, 0.55, 0.3), 0.45));
    }
    // 매끈한 흰 가시 — 바깥으로 살짝 기운 원뿔 셋.
    for (const [hx, hy, tx2, ty2] of [[-3.4, 5.2, -4.2, 6.6], [3.5, 5, 4.3, 6.3], [-6.4, -1, -7.9, -1.3]] as [number, number, number, number][]) {
      out.push(...hornFaces(hx, hy, 1.8, tx2, ty2, 4.2, 1.05));
      out.push(topFace(groundEllipse(...project(tx2 * 0.94, ty2 * 0.94, 3.2), 0.32, 0.5), 0.4));
    }
    /* 위 구조물은 고치(지적: 띠가 아니라) — 뒤 테두리에서 솟아 웅덩이 위로 몸을
       숙인 통통한 번데기 덩어리. 등에는 마디 주름, 머리와 코끝에 발광. */
    const cocoon = `M${pt(-5.6, -2.8, 1.6)} Q${pt(-7, -3.6, 5.8)} ${pt(-4.6, -2.6, 8.8)}`
      + ` Q${pt(-2.6, -1.6, 10.2)} ${pt(-0.7, -0.6, 8.8)} Q${pt(0.5, 0, 7.2)} ${pt(-0.3, 0.4, 6)}`
      + ` Q${pt(-1.6, -0.4, 6.4)} ${pt(-2.8, -1.6, 6)} Q${pt(-3.6, -2.2, 4)} ${pt(-3.2, -2.4, 1.6)} Z`;
    out.push(bodyFace(cocoon), sideFace(cocoon, 0.14));
    // 마디 주름 — 등을 가로지르는 가는 골 둘.
    out.push(sideFace(`M${pt(-5.9, -3, 4.6)} Q${pt(-5, -2.6, 5.2)} ${pt(-3.3, -2, 4.9)} L${pt(-3.4, -2.1, 4.4)} Q${pt(-5, -2.7, 4.7)} ${pt(-5.8, -3, 4.1)} Z`, 0.2));
    out.push(sideFace(`M${pt(-5.8, -3.1, 7)} Q${pt(-4.6, -2.5, 7.6)} ${pt(-3, -1.9, 7.1)} L${pt(-3.1, -2, 6.6)} Q${pt(-4.6, -2.6, 7.1)} ${pt(-5.7, -3.1, 6.5)} Z`, 0.2));
    // 머리·코끝 발광.
    const [hx2, hy2] = project(-0.5, 0.3, 6.2);
    out.push(topFace(groundEllipse(hx2, hy2, 0.55, 0.6), 0.5));
    const [ax2, ay2] = project(-3.2, -2, 9.3);
    out.push(topFace(groundEllipse(ax2, ay2, 1, 0.65), 0.4));
    return out;
  },
  /* 터렛(실물 참고) — 원통 받침 + 상자 머리 + 세로 미사일 랙 둘 + 옆으로 빠지는 배관. */
  turret: () => [
    ...cylinderFaces3(0, 0.4, 3.1, 3.4),
    ...tubeFaces(-2.6, 2.2, -4.4, 3.4, 0.55, 1.2),
    ...boxFaces3(0, 0, 3.6, 2.8, 3.6, 3.6),
    /* 미사일 포드 — 약간 하늘을 향해 기운다(지적): 위가 뒤로 1.4 물러난 기운 판. */
    /* 미사일 포드(지적) — 옆모습이 마름모가 아니라 직사각형: 위만 미는 전단이 아니라
       상자를 통째로 뒤로 기울인다. 하늘을 향한 기울기는 그대로. */
    ...[-2.2, 2.2].flatMap((rx) => {
      const c = 0.96;
      const sn = 0.27;
      const pvt = (dy: number, t: number): [number, number] =>
        [0.2 + dy * c - t * sn, 3.2 + dy * sn + t * c];
      const fb = pvt(1.9, 0);
      const ft = pvt(1.9, 5);
      const bb = pvt(-1.9, 0);
      const bt = pvt(-1.9, 5);
      const front = polyPath3([
        [rx - 0.75, fb[0], fb[1]], [rx + 0.75, fb[0], fb[1]],
        [rx + 0.75, ft[0], ft[1]], [rx - 0.75, ft[0], ft[1]],
      ]);
      const side = polyPath3([
        [rx + 0.75, fb[0], fb[1]], [rx + 0.75, ft[0], ft[1]],
        [rx + 0.75, bt[0], bt[1]], [rx + 0.75, bb[0], bb[1]],
      ]);
      const top = polyPath3([
        [rx - 0.75, ft[0], ft[1]], [rx + 0.75, ft[0], ft[1]],
        [rx + 0.75, bt[0], bt[1]], [rx - 0.75, bt[0], bt[1]],
      ]);
      const s0 = pvt(1.91, 0.8);
      const s1 = pvt(1.91, 4.3);
      const stripe = polyPath3([
        [rx - 0.5, s0[0], s0[1]], [rx + 0.5, s0[0], s0[1]],
        [rx + 0.5, s1[0], s1[1]], [rx - 0.5, s1[0], s1[1]],
      ]);
      return [
        bodyFace(`${front} ${side} ${top}`),
        sideFace(side, 0.28),
        topFace(top, 0.2),
        topFace(stripe, 0.35),
      ];
    }),
    ...boxFaces3(0, -0.2, 2.2, 1.8, 1.6, 7.2),
  ],
  /* 포톤 캐논(실물 참고) — 납작한 원형 판(고리 무늬) + 테두리 포드 여덟 + 가운데 가는
     수정 기둥(빛나는 끝). */
  coil: () => {
    const out: ShapeFace[] = [...cylinderFaces3(0, 0, 5.6, 1.3)];
    out.push(capFace(discPath3(0, 0, 1.35, 4.4), 0.3));
    out.push(topFace(discPath3(0, 0, 1.38, 3.2), 0.2));
    out.push(capFace(discPath3(0, 0, 1.41, 2.1), 0.3));
    for (let i = 0; i < 8; i += 1) {
      const a = (i * 45 * Math.PI) / 180;
      out.push(...boxFaces3(Math.sin(a) * 5.2, Math.cos(a) * 5.2, 1.7, 1.7, 1.9));
    }
    out.push(...cylinderFaces3(0, 0, 0.55, 4.6, 1.3));
    // 꼭대기는 주사바늘(지적) — 관 끝이 사선으로 깎여 왼쪽이 높다.
    const [nx2, nyB] = project(0, 0, 5.85);
    const [, nyL] = project(0, 0, 7.6);
    const [, nyR] = project(0, 0, 6.35);
    out.push(bodyFace(`M${nx2 - 0.55} ${nyL} L${nx2 + 0.55} ${nyR} L${nx2 + 0.55} ${nyB} L${nx2 - 0.55} ${nyB} Z`));
    out.push(topFace(`M${nx2 - 0.55} ${nyL} L${nx2 + 0.55} ${nyR} L${nx2 + 0.55} ${nyR + 0.35} L${nx2 - 0.55} ${nyL + 0.35} Z`, 0.5));
    return out;
  },
  /* 성큰(실물 참고) — 납작한 크립 더미 + 잔가시들 + 웅크린 큰 낫 발톱(끝 밝은 날). */
  sunken: () => {
    /* 성큰(정정) — 가시 없이: 불가사리처럼 여섯 갈래로 뻗는 다리 바닥 + 납작한 몸,
       뒤쪽으로 혓바닥처럼 늘어진 촉수 판. */
    const out: ShapeFace[] = [];
    for (const ang of [0, 60, 120, 180, 240, 300]) {
      const a = (ang * Math.PI) / 180;
      out.push(...hornFaces(
        Math.sin(a) * 1.4, Math.cos(a) * 1.4, 0.8,
        Math.sin(a) * 5.5, Math.cos(a) * 5.5, 0.15, 1.7,
      ));
    }
    out.push(...domeFaces3(0, 0, 3.3, 1.2));
    // 혓바닥 — 몸 뒤로 넓게 늘어져 끝이 둥글다. 가운데 골.
    const tongue = polyPath3([
      [0.9, -1.2, 1.5], [1.15, -3.3, 0.7], [0.65, -4.6, 0.35], [0, -5, 0.3],
      [-0.65, -4.6, 0.35], [-1.15, -3.3, 0.7], [-0.9, -1.2, 1.5],
    ]);
    out.push(bodyFace(tongue), topFace(tongue, 0.16));
    out.push(capFace(polyPath3([
      [0.18, -1.6, 1.35], [0.2, -3.4, 0.68], [0, -4.4, 0.4], [-0.2, -3.4, 0.68], [-0.18, -1.6, 1.35],
    ]), 0.2));
    return out;
  },
  /* 스포어(정정: 가시가 아니라 굴뚝이 포인트) — 크립 밑동과 몸통 덩어리 위에, 왼뒤에서
     굵게 서는 아가리 뚫린 굴뚝 관. */
  spore: () => [
    ...domeFaces3(0, 0, 5.4, 1.5),
    // 가운데 몸통 — 겹친 불룩 덩어리 둘(유지).
    ...domeFaces3(0.6, 0.2, 3, 4.6),
    ...domeFaces3(1.6, 1.4, 2.1, 2.9),
    // 큰 굴뚝 — 벌어진 테와 어두운 속.
    ...cylinderFaces3(-2.6, -1.4, 1.3, 6.2, 0.8),
    bodyFace(discPath3(-2.6, -1.4, 7.05, 1.65)),
    capFace(discPath3(-2.6, -1.4, 7.1, 1.05), 0.5),
    // 앞오른쪽 작은 덩이(유지).
    ...domeFaces3(3.4, 2.6, 1.5, 1.7),
  ],
  /* 크립 콜로니(실물 참고) — 처진 붉은 둔덕 + 꼭대기 주름 혹(입) + 옆 가시 + 바닥에
     번진 점액 자락. */
  creep: () => [
    // 바닥은 동그라미가 아니라 갈퀴(지적).
    ...creepSplat(6.2),
    ...domeFaces3(0, 0, 4.6, 3.4),
    ...domeFaces3(0.4, -0.6, 2, 2.4, 3),
    capFace(discPath3(0.4, -0.6, 5.35, 0.75), 0.45),
    ...hornFaces(-3.4, -1.4, 1.6, -4.6, -2, 3.4, 0.9),
    ...hornFaces(-1.6, -3, 1.6, -2.2, -4.2, 3.2, 0.9),
    ...hornFaces(3.4, -1.8, 1.6, 4.6, -2.6, 3.2, 0.9),
  ],

  /* 리파이너리(실물 참고) — 낮은 받침 + 좌우 어두운 탑 + 가운데 나팔 굴뚝 + 은빛
     팔꿈치 배관들 + 앞 은색 탱크 + 왼앞 줄무늬 경사로. */
  refinery: () => {
    const out: ShapeFace[] = [...boxFaces3(0, 0, 11.6, 7, 2.2)];
    // 높이 살짝 낮춤(지적).
    out.push(...frustumFaces3(-3.9, -0.9, 3.4, 3, 2.9, 2.6, 5, 2.2));
    out.push(...frustumFaces3(3.9, -0.7, 3.6, 3.2, 3.1, 2.8, 4.3, 2.2));
    // 나팔 굴뚝 — 목 원통 위로 벌어진 테와 어두운 속.
    out.push(...cylinderFaces3(0, -1.2, 1.7, 3.6, 2.2));
    out.push(bodyFace(discPath3(0, -1.2, 5.85, 2.9)));
    out.push(capFace(discPath3(0, -1.2, 5.9, 2.2), 0.5));
    // 은빛 배관 — 탑과 굴뚝 사이를 타넘는다.
    out.push(...tubeFaces(-3.6, 1.2, -1, 1.6, 0.55, 4.2));
    out.push(...tubeFaces(1.2, 1.4, 3.4, 0.6, 0.55, 3.6));
    out.push(...tubeFaces(-2.2, -2.6, 2.4, -2.8, 0.5, 4.9));
    // 앞 은색 탱크(돔 뚜껑) + 왼쪽 작은 돔.
    out.push(...cylinderFaces3(1.4, 2.9, 1.6, 3.4));
    out.push(...domeFaces3(1.4, 2.9, 1.6, 1.1, 3.4));
    out.push(...domeFaces3(-4.9, 2.3, 1.3, 1.4, 2.2));
    // 왼앞 경사로 — 아래쪽에 사선 줄무늬.
    const ramp = polyPath3([[-3.9, 2.2, 2.2], [-1.7, 2.2, 2.2], [-1.2, 5, 0], [-4.4, 5, 0]]);
    out.push(bodyFace(ramp), topFace(ramp, 0.15));
    for (let i = 0; i < 3; i += 1) {
      const x0 = -4.2 + i * 1;
      out.push(capFace(polyPath3([
        [x0, 4.3, 0.5], [x0 + 0.5, 4.3, 0.5], [x0 + 0.9, 4.9, 0.08], [x0 + 0.4, 4.9, 0.08],
      ]), 0.4));
    }
    return out;
  },
  /* 어시밀레이터(실물 참고) — 둥근 황금 몸체 + 몸을 타넘는 골진 활 띠(청록 눈금) +
     가운데 큰 청록 알 + 네 귀 비스듬한 통풍 포드 + 바깥으로 처지는 지느러미. */
  assim: () => {
    const out: ShapeFace[] = [sideFace(discPath3(0, 0.4, 0, 7), 0.2)];
    // 귀퉁이 지느러미 — 바깥-아래로 처지는 넓은 갈퀴.
    for (const [px, py] of [[-4.6, 3.2], [4.6, 3.2], [-5, -2.8], [5, -2.8]] as [number, number][]) {
      out.push(...hornFaces(px * 0.6, py * 0.6, 1.2, px * 1.4, py * 1.4, 0.3, 2.2));
    }
    out.push(...domeFaces3(0, -0.2, 5.6, 3.2));
    // 골진 활 띠 — 몸 위를 가로로 타넘는 도톰한 반고리.
    const [bx2, by2] = project(0, -0.6, 0);
    out.push(bodyFace(`M${bx2 - 5.9} ${by2} A5.9 4.6 0 0 1 ${bx2 + 5.9} ${by2}`
      + ` L${bx2 + 4.4} ${by2} A4.4 3.4 0 0 0 ${bx2 - 4.4} ${by2} Z`));
    out.push(sideFace(`M${bx2 + 4.4} ${by2} A4.4 3.4 0 0 1 ${bx2 + 5.9} ${by2} L${bx2 + 5.9} ${by2} A5.9 4.6 0 0 0 ${bx2 + 4.4} ${by2} Z`, 0.2));
    for (const ang of [140, 108, 76, 44]) {
      const a2 = (ang * Math.PI) / 180;
      out.push(topFace(groundEllipse(bx2 + Math.cos(a2) * 5.15, by2 - Math.sin(a2) * 4, 0.35, 0.55), 0.5));
    }
    // 네 귀 통풍 포드 — 흰 띠 두른 포드와 위 타원 구멍.
    for (const [px, py] of [[-3.5, 2.6], [3.6, 2.4], [-3.9, -2.5], [3.9, -2.6]] as [number, number][]) {
      out.push(...boxFaces3(px, py, 1.9, 1.7, 2.9, 0.6));
      const [vx, vy] = project(px, py, 3.6);
      out.push(topFace(groundEllipse(vx, vy, 0.8, 0.55), 0.3));
      out.push(capFace(groundEllipse(vx, vy, 0.55, 0.35), 0.45));
    }
    // 가운데 큰 알 — 빛나는 청록 물방울(윤곽 테 + 발광 속).
    const [ex, ey] = project(0, 2.4, 2.1);
    out.push(capFace(groundEllipse(ex, ey, 2.4, 3), 0.35));
    out.push(topFace(groundEllipse(ex, ey, 2, 2.6), 0.55));
    return out;
  },
  /* 익스트랙터(실물 참고) — 점액 받침 위 좌우 갈색 통(초록 발광 뚜껑 + 흘러내리는 힘줄
     우리)과 그 위 뿔 돋은 검은 덮개, 가운데 비스듬히 기댄 골진 붉은 애벌레 몸통. */
  extract: () => {
    const out: ShapeFace[] = [sideFace(discPath3(0, 0.4, 0, 7.2), 0.2)];
    const vat = (px: number, py: number, r: number): void => {
      out.push(...cylinderFaces3(px, py, r, 3.4));
      const [gx, gy] = project(px, py, 3.45);
      out.push(topFace(groundEllipse(gx, gy, r * 0.82, r * 0.4), 0.5));
      // 힘줄 우리 — 통 옆면을 타고 내리는 가는 다리들.
      for (const ang of [150, 210, 30, -30, 90]) {
        const a2 = (ang * Math.PI) / 180;
        out.push(...hornFaces(
          px + Math.sin(a2) * r * 0.7, py + Math.cos(a2) * r * 0.7, 3.6,
          px + Math.sin(a2) * r * 1.25, py + Math.cos(a2) * r * 1.25, 0.2, 0.5,
        ));
      }
      // 검은 덮개와 굽은 뿔들.
      out.push(...domeFaces3(px, py, r * 1.15, 1.6, 3.4));
      out.push(...hornFaces(px - 0.6, py - 0.5, 4.6, px - 1.9, py - 1.2, 8.6, 1.3));
      out.push(...hornFaces(px + 0.8, py - 0.3, 4.6, px + 2, py - 1, 7.6, 1.1));
      out.push(...hornFaces(px, py + 0.5, 4.4, px + 0.4, py + 1.4, 6.4, 0.9));
    };
    vat(-3.9, -0.6, 2.4);
    vat(4, -0.4, 2.2);
    // 가운데 붉은 애벌레 몸통 — 골진 마디가 비스듬히 기댄다.
    for (let i = 0; i < 4; i += 1) {
      out.push(...domeFaces3(0.2 - i * 0.15, 2.6 - i * 1.1, 2 - i * 0.28, 1.5, 0.4 + i * 1.35));
    }
    out.push(...hornFaces(0, -1.6, 4.4, -0.4, -2.6, 7, 1.4));
    // 잿빛 가시 조각.
    out.push(...hornFaces(-1.6, 3.4, 0.4, -2.4, 4.6, 2.2, 0.8));
    out.push(...hornFaces(1.8, 3.2, 0.4, 2.6, 4.2, 2, 0.8));
    return out;
  },

  /* ── 업그레이드·테크 건물들(요청: 이제 다 만들자) ─────────────────────────── */
  /* 아카데미(실물 참고, 디테일) — 받침 위에 슬릿 난 관측 돔 드럼(왼앞), 어두운 캡의
     원통 탑 둘(뒤), 기둥 위 기운 큰 고리 접시(오른쪽), 다리 달린 테이블 단과 꼭지(앞). */
  academy: () => {
    const [sx2, sy2] = project(-2.6, 2.5, 5.6);
    const [dx3, dy3] = project(2.9, 0.2, 6.1);
    return [
      // 본건물 높이 증가(지적: 1.4→2.6) — 위 요소들도 함께 오른다.
      ...boxFaces3(0, 0.4, 8.8, 5.6, 2.6),
      // 관측 돔 드럼 — 앞에 가로 슬릿.
      ...cylinderFaces3(-2.6, 0.8, 1.9, 2.4, 2.6),
      ...domeFaces3(-2.6, 0.8, 1.9, 1.6, 5),
      capFace(groundEllipse(sx2, sy2, 0.95, 0.26), 0.45),
      // 뒤 원통 탑 둘 — 위에 어두운 캡, 가는 목.
      ...cylinderFaces3(-0.5, -1.7, 1.1, 5, 2.6),
      capFace(discPath3(-0.5, -1.7, 7.65, 0.78), 0.4),
      ...cylinderFaces3(1.1, -2.3, 0.75, 4, 2.6),
      capFace(discPath3(1.1, -2.3, 6.65, 0.5), 0.35),
      // 오른쪽 기운 큰 고리 접시 — 기둥이 받친다.
      ...cylinderFaces3(2.9, 0.4, 0.7, 3, 2.6),
      bodyFace(groundEllipse(dx3, dy3, 2.35, 1.5)),
      topFace(groundEllipse(dx3, dy3 - 0.15, 1.95, 1.2), 0.18),
      capFace(groundEllipse(dx3, dy3, 1.25, 0.78), 0.42),
      // 앞 테이블 단 — 네 다리 위 판과 가운데 꼭지.
      ...hornFaces(0.9, 2.2, 2.6, 0.9, 2.2, 4.3, 0.35),
      ...hornFaces(2.4, 2.6, 2.6, 2.4, 2.6, 4.3, 0.35),
      ...boxFaces3(1.6, 2.3, 2.5, 1.9, 0.45, 4.3),
      ...domeFaces3(1.6, 2.3, 0.5, 0.45, 4.75),
    ];
  },
  /* 엔지니어링 베이(복원) — 사방 대각 팔 끝의 원반 발 넷, 각진 몸체 더미, 끝이
     빛나는 앞 통, 지붕 안테나. */
  ebay: () => {
    const foot = (fx: number, fy: number): ShapeFace[] => [
      ...hornFaces(fx * 0.45, fy * 0.45, 1.9, fx * 0.85, fy * 0.85, 0.7, 0.9),
      bodyFace(discPath3(fx, fy, 0.35, 1.5)),
      topFace(discPath3(fx, fy, 0.38, 1), 0.25),
      ...cylinderFaces3(fx, fy, 0.32, 1, 0.35),
    ];
    return [
      ...foot(-5, -3), ...foot(5, -3),
      ...boxFaces3(0, -0.4, 6.6, 4, 3),
      ...boxFaces3(-0.8, -1, 3, 2.4, 1.5, 3),
      ...boxFaces3(1.8, -1.4, 1.5, 1.5, 2.3, 3),
      ...tubeFaces(1.7, 0.6, 1.7, 2.5, 0.65, 1.9),
      topFace(groundEllipse(...project(1.7, 2.5, 2.4), 0.5, 0.4), 0.35),
      ...hornFaces(-2.3, -1.7, 4.5, -2.3, -1.7, 6.5, 0.32),
      ...foot(-5.2, 3.2), ...foot(5.2, 3.2),
    ];
  },
  /* 아머리(실물 참고) — 가운데 우물 드럼(어두운 속·테두리 빛 눈금·비스듬한 뚜껑 판),
     둘레의 각진 첨탑 둘과 빛나는 기둥 포스트 둘, 방사 팔 모듈. */
  armory: () => {
    const rim = (ang: number): ShapeFace => {
      const a = (ang * Math.PI) / 180;
      const [px2, py2] = project(Math.sin(a) * 2.1, Math.cos(a) * 2.1, 3);
      return topFace(groundEllipse(px2, py2, 0.3, 0.2), 0.4);
    };
    const post = (px2: number, py2: number, h: number): ShapeFace[] => {
      const [gx2, gy2] = project(px2, py2, h + 0.6);
      return [
        ...cylinderFaces3(px2, py2, 0.75, h),
        ...domeFaces3(px2, py2, 0.75, 0.5, h),
        topFace(groundEllipse(gx2, gy2, 0.32, 0.22), 0.45),
      ];
    };
    return [
      // 기둥은 셋(지적) — 뒤 첨탑 둘 + 앞 첨탑 하나.
      ...boxFaces3(-3.2, -2.2, 1.4, 1.4, 5.4),
      ...boxFaces3(-3.2, -2.2, 0.7, 0.7, 1.8, 5.4),
      ...boxFaces3(3.4, -1.8, 1.5, 1.5, 6.2),
      ...boxFaces3(3.4, -1.8, 0.8, 0.8, 2, 6.2),
      // 방사 팔 모듈.
      ...boxFaces3(2.4, 0.9, 2, 1.3, 1.5),
      ...boxFaces3(-2.5, 0.7, 1.9, 1.3, 1.4),
      // 가운데 우물 드럼.
      ...cylinderFaces3(0, 0, 2.6, 3),
      capFace(discPath3(0, 0, 3.05, 1.85), 0.45),
      rim(50), rim(90), rim(130),
      // 비스듬한 뚜껑 판 — 우물 위로 걸친 원판.
      bodyFace(discPath3(0.4, -0.9, 4.3, 1.6)),
      topFace(discPath3(0.4, -0.9, 4.33, 1.15), 0.25),
      // 앞 첨탑 하나 + 빛 포스트.
      ...boxFaces3(-3.4, 2.4, 1.4, 1.4, 4.6),
      ...boxFaces3(-3.4, 2.4, 0.7, 0.7, 1.6, 4.6),
      ...post(3.7, 2.7, 2.7),
    ];
  },
  /* 사이언스 퍼실리티(정정: 엔베가 아니라 이 건물이었다) — 드럼 발 위에 떠 있는
     둥근 층층 플랫폼, 가운데 큰 갈빗살 돔(농구공 반쪽), 원통 모듈, 초록 불 띠. */
  scifac: () => {
    const foot = (fx: number, fy: number): ShapeFace[] => [
      ...cylinderFaces3(fx, fy, 1.05, 1.3),
      bodyFace(discPath3(fx, fy, 0.25, 1.4)),
      capFace(discPath3(fx, fy, 1.32, 0.55), 0.3),
    ];
    const glow = (gx2: number, gy2: number, gz2: number): ShapeFace => {
      const [px2, py2] = project(gx2, gy2, gz2);
      return topFace(groundEllipse(px2, py2, 0.45, 0.2), 0.45);
    };
    return [
      ...foot(-3.6, -2.2), ...foot(3.8, -2),
      ...cylinderFaces3(0, 0, 4.6, 1.9, 1.3),
      ...cylinderFaces3(0, 0, 3.4, 1.3, 3.2),
      ...domeFaces3(0, -0.5, 2.5, 2.2, 4.4),
      sideFace(polyPath3([[0, 1.9, 4.6], [0, 1.5, 6], [0, -0.5, 6.65], [0.16, -0.5, 6.65], [0.16, 1.5, 6], [0.16, 1.9, 4.6]]), 0.15),
      ...cylinderFaces3(2.1, 1, 1, 2, 3.2),
      glow(-2.9, 2.6, 2.2), glow(-1.6, 3.3, 2.2), glow(3.3, 1.9, 2.6),
      ...foot(-1.2, 3.5), ...foot(2.9, 3),
    ];
  },
  /* 포지(렌더 참고 복원) — 왼앞 아치 별채, 가운데 총알 기둥 무리, 초록 배관 다발이
     오른쪽 큰 렌즈 돔으로 흘러들고, 앞오른쪽에 작은 렌즈 돔. */
  forge: () => {
    const lens = (x: number, y: number, z: number, r: number): ShapeFace[] => {
      const [px2, py2] = project(x, y, z);
      return [
        topFace(groundEllipse(px2, py2, r, r * 0.7), 0.3),
        topFace(groundEllipse(px2, py2, r * 0.55, r * 0.4), 0.5),
      ];
    };
    return [
      // 왼앞 아치 별채.
      ...boxFaces3(-3, 1.6, 3.2, 2.9, 2.3),
      ...domeFaces3(-3, 1.6, 1.4, 1, 2.3),
      // 총알 기둥 무리.
      ...cylinderFaces3(-2.9, -2.6, 0.75, 3.6),
      ...domeFaces3(-2.9, -2.6, 0.75, 0.7, 3.6),
      ...cylinderFaces3(-1.6, -1.6, 0.85, 4.6),
      ...domeFaces3(-1.6, -1.6, 0.85, 0.8, 4.6),
      ...cylinderFaces3(-0.2, -2.4, 0.8, 5.4),
      ...domeFaces3(-0.2, -2.4, 0.8, 0.75, 5.4),
      ...cylinderFaces3(0.6, -0.8, 0.7, 3.2),
      ...domeFaces3(0.6, -0.8, 0.7, 0.65, 3.2),
      // 배관 다발 — 기둥에서 큰 돔으로 층층이.
      ...tubeFaces(0.2, -1.8, 2.6, -1.1, 0.42, 2.8),
      ...tubeFaces(0.3, -1.4, 2.7, -0.7, 0.42, 2),
      ...tubeFaces(0.4, -1, 2.8, -0.3, 0.42, 1.2),
      // 큰 렌즈 돔(뒤 오른) + 작은 렌즈 돔(앞 오른).
      ...domeFaces3(3, -1.2, 2.5, 2.3),
      ...lens(3, -1.2, 2.35, 1.05),
      ...domeFaces3(2.8, 2.4, 1.55, 1.3),
      ...lens(2.8, 2.4, 1.35, 0.65),
    ];
  },
  /* 사이버네틱스 코어(실물 참고) — 가운데 드럼 위 파란 발광 고리, 그 뒤로 솟는 발톱
     손가락 셋, 둘레 네 포드마다 파란 구슬이 얹힌다. */
  cyber: () => {
    const orbPod = (px2: number, py2: number): ShapeFace[] => {
      const [gx2, gy2] = project(px2, py2, 1.45);
      return [
        ...domeFaces3(px2, py2, 1.15, 0.9),
        [groundEllipse(gx2, gy2, 0.85, 0.8), 0.6] as ShapeFace,
        topFace(groundEllipse(gx2 - 0.25, gy2 - 0.25, 0.32, 0.28), 0.5),
        ...hornFaces(px2 - 0.55, py2 + 0.75, 0.4, px2 - 0.75, py2 + 1.15, 1.5, 0.32),
        ...hornFaces(px2 + 0.55, py2 + 0.75, 0.4, px2 + 0.75, py2 + 1.15, 1.5, 0.32),
      ];
    };
    const [cx2, cy2] = project(0, -0.2, 3.6);
    return [
      // 뒤 발톱 손가락 셋.
      ...hornFaces(-0.9, -1.5, 3.8, -1.3, -2.1, 8, 1),
      ...hornFaces(0, -1.8, 3.8, 0, -2.5, 8.6, 1.1),
      ...hornFaces(0.9, -1.5, 3.8, 1.3, -2.1, 8, 1),
      ...orbPod(-2.9, -1.5),
      ...orbPod(2.9, -1.5),
      // 가운데 드럼.
      ...cylinderFaces3(0, -0.2, 2.5, 3.3),
      // 위 파란 발광 고리 — 반투명 판 위에 금 뚜껑.
      [groundEllipse(cx2, cy2, 2.3, 1.15), 0.55] as ShapeFace,
      bodyFace(groundEllipse(cx2, cy2, 1.45, 0.72)),
      topFace(groundEllipse(cx2, cy2, 1.05, 0.5), 0.25),
      ...orbPod(-2.4, 2.1),
      ...orbPod(2.4, 2.1),
    ];
  },
  /* 시타델 오브 아둔 — 좁아지는 탑 + 꼭대기 뾰족. */
  citadel: () => {
    /* 시타델 오브 아둔(리디자인, 실물 참고) — 렌즈 점 박힌 큰 공 몸통, 그 위로 앞으로
       숙인 각진 황금 두건(뒤로 솟는 뿔), 양옆으로 뻗은 가는 팔 끝의 세로 패들(렌즈). */
    const lens = (lx: number, ly: number, lz: number): ShapeFace => {
      const [px2, py2] = project(lx, ly, lz);
      return topFace(groundEllipse(px2, py2, 0.34, 0.28), 0.45);
    };
    return [
      // 양옆 팔 + 세로 패들.
      ...tubeFaces(-2.4, -0.2, -4.5, -0.2, 0.4, 4),
      ...boxFaces3(-4.9, -0.2, 0.65, 2.3, 3.3, 2.6),
      lens(-4.85, 0.95, 4.2),
      ...tubeFaces(2.4, -0.2, 4.5, -0.2, 0.4, 4),
      ...boxFaces3(4.9, -0.2, 0.65, 2.3, 3.3, 2.6),
      lens(4.95, 0.95, 4.2),
      // 큰 공 몸통 — 낮은 받침 위.
      ...cylinderFaces3(0, 0, 2.1, 0.8),
      ...domeFaces3(0, 0, 2.85, 2.7, 0.8),
      lens(-1.1, 2.4, 2), lens(0.3, 2.6, 1.7), lens(1.5, 2.3, 2.1),
      // 앞으로 숙인 각진 두건 + 뒤로 솟는 뿔.
      ...frustumFaces3(0, -0.3, 2.4, 2, 1.5, 1.3, 2.2, 3.4),
      ...hornFaces(0, -0.7, 5.5, 0, -1.5, 7.4, 1),
      lens(0, 0.9, 4.6),
    ];
  },
  /* 템플러 아카이브(리디자인, 실물 참고) — 큰 황금 공 몸에 테 물린 파란 렌즈가
     위에 박히고, 왼뒤로 뿔 한 쌍이 솟으며, 오른앞엔 골진 껍데기 꼬리(끝 원반). */
  archives: () => {
    const [gx2, gy2] = project(0.1, 0.4, 4);
    const [tx3, ty3] = project(3.8, 3, 1);
    return [
      // 왼뒤 뿔 한 쌍.
      ...hornFaces(-1.6, -1.4, 2.6, -3.2, -2.4, 6.6, 1.1),
      ...hornFaces(-0.2, -2, 2.8, -0.8, -3.2, 7, 1.2),
      // 큰 황금 공 몸 + 받침.
      ...cylinderFaces3(0, 0, 2.9, 0.7),
      ...domeFaces3(0, 0, 2.9, 2.7, 0.7),
      // 위 파란 렌즈 — 테에 물림.
      bodyFace(groundEllipse(gx2, gy2, 1.35, 1.05)),
      [groundEllipse(gx2, gy2, 1.02, 0.78), 0.6] as ShapeFace,
      topFace(groundEllipse(gx2 - 0.35, gy2 - 0.3, 0.4, 0.3), 0.5),
      // 오른앞 골진 껍데기 꼬리 — 굽은 마디 둘 + 골 줄 + 끝 작은 파란 원반.
      ...domeFaces3(2.4, 1.2, 1.3, 1),
      ...domeFaces3(3.2, 2.2, 1, 0.8),
      sideFace(polyPath3([[1.8, 0.6, 1], [2.2, 1, 1.9], [2.6, 1.5, 1], [2.5, 1.4, 0.6]]), 0.18),
      sideFace(polyPath3([[2.7, 1.6, 0.9], [3, 2, 1.6], [3.4, 2.5, 0.9], [3.3, 2.4, 0.5]]), 0.18),
      [groundEllipse(tx3, ty3, 0.5, 0.4), 0.55] as ShapeFace,
    ];
  },
  /* 로보틱스 서포트 베이(실물 참고) — 톱니 테 받침판 가운데 오목한 대접(심 발광),
     그 둘레로 바깥으로 기운 당근 포드들과 굽은 관 팔. */
  robobay: () => {
    const out: ShapeFace[] = [...cylinderFaces3(0, 0, 4.6, 1.1)];
    // 받침 테두리 톱니.
    for (const ang of [160, 200, 90, 270, 40, 320]) {
      const a = (ang * Math.PI) / 180;
      out.push(...boxFaces3(Math.sin(a) * 4.7, Math.cos(a) * 4.7, 0.8, 0.8, 0.9));
    }
    // 오목 대접 + 심 발광.
    out.push(capFace(discPath3(0, 0, 1.15, 3), 0.3));
    out.push(capFace(discPath3(0, 0, 1.18, 2.1), 0.45));
    const [gx2, gy2] = project(0, 0, 1.25);
    out.push(topFace(groundEllipse(gx2, gy2, 0.7, 0.4), 0.5));
    // 당근 포드 — 뒤 둘·오른앞 하나, 바깥으로 기운다.
    out.push(...hornFaces(-1.4, -1.2, 1, -2.5, -2, 6.6, 1.7));
    out.push(...hornFaces(0.4, -1.7, 1, 0.7, -3, 7.2, 1.8));
    out.push(...hornFaces(1.7, -0.6, 1, 2.8, -1.1, 5.8, 1.6));
    // 굽은 관 팔 — 받침 밖에서 포드 쪽으로 넘어온다.
    out.push(...hornFaces(-3.6, 0.9, 0.8, -4, 0.2, 3.6, 0.7));
    out.push(...hornFaces(-4, 0.2, 3.5, -2.9, -0.9, 4.6, 0.55));
    out.push(...hornFaces(3.6, 1.3, 0.8, 4, 0.6, 3.2, 0.7));
    out.push(...hornFaces(4, 0.6, 3.1, 3, -0.3, 4.2, 0.55));
    return out;
  },
  /* 옵저버토리(실물 참고) — 청록 랜턴 머리를 얹은 각진 탑 셋이 삼각으로 서고,
     밑동끼리 굽은 팔로 이어진다. */
  observatory: () => {
    const lamp = (px2: number, py2: number, h: number): ShapeFace[] => {
      const [gx2, gy2] = project(px2, py2, h + 1.75);
      return [
        ...boxFaces3(px2, py2, 1.35, 1.35, h),
        ...cylinderFaces3(px2, py2, 0.6, 0.9, h),
        ...domeFaces3(px2, py2, 0.95, 1.05, h + 0.9),
        topFace(groundEllipse(gx2, gy2, 0.55, 0.42), 0.5),
      ];
    };
    return [
      ...lamp(-2.8, -1.3, 3.2),
      ...lamp(0.2, -2.3, 4.4),
      ...lamp(2.9, -0.7, 3.6),
      // 밑동을 잇는 굽은 팔들 — 앞 가운데로 모인다.
      ...hornFaces(-2.8, -1, 1.1, -1.3, 1.6, 0.9, 1.2),
      ...hornFaces(-1.3, 1.6, 0.9, 0.3, 2.3, 0.8, 1),
      ...hornFaces(2.9, -0.4, 1.1, 1.7, 1.9, 0.9, 1.2),
      ...hornFaces(1.7, 1.9, 0.9, 0.3, 2.3, 0.8, 1),
      ...hornFaces(-2.4, -1.9, 1, 0, -2.4, 0.9, 1),
    ];
  },
  /* 플릿 비컨(리디자인, 실물 참고) — 낮고 둥근 몸 위에 큰 파란 구슬이 박히고,
     바닥에는 게발처럼 벌어지는 다리들, 왼팔 드럼 포드와 오른쪽 원반. */
  fleetbeacon: () => {
    const [gx2, gy2] = project(0, 0.2, 3.5);
    const [rx2, ry2] = project(3.3, -0.9, 3.2);
    return [
      // 게발 다리 — 사방으로 벌어져 끝이 바닥을 짚는다.
      ...hornFaces(-2, 1.6, 1.6, -3.4, 3, 0.2, 0.9),
      ...hornFaces(2, 1.6, 1.6, 3.4, 3, 0.2, 0.9),
      ...hornFaces(-2.8, 0.2, 1.6, -4.4, 0.6, 0.2, 0.9),
      ...hornFaces(2.8, 0.2, 1.6, 4.4, 0.6, 0.2, 0.9),
      ...hornFaces(-2, -1.4, 1.5, -3.2, -2.6, 0.2, 0.85),
      ...hornFaces(2, -1.4, 1.5, 3.2, -2.6, 0.2, 0.85),
      // 낮고 둥근 몸.
      ...domeFaces3(0, 0, 3.1, 2.3),
      // 왼팔 드럼 포드 + 오른 원반.
      ...tubeFaces(-3, -0.6, -4.4, -0.6, 0.5, 2.5),
      ...cylinderFaces3(-4.7, -0.6, 0.75, 0.9, 2.1),
      capFace(discPath3(-4.7, -0.6, 3.05, 0.5), 0.35),
      ...cylinderFaces3(3.3, -0.9, 0.9, 0.6, 2.5),
      topFace(groundEllipse(rx2, ry2, 0.6, 0.4), 0.3),
      // 큰 파란 구슬 — 테에 물려 몸 위 가운데 박힌다.
      bodyFace(groundEllipse(gx2, gy2 + 0.25, 1.85, 1.7)),
      [groundEllipse(gx2, gy2, 1.55, 1.45), 0.6] as ShapeFace,
      topFace(groundEllipse(gx2 - 0.5, gy2 - 0.5, 0.6, 0.5), 0.5),
    ];
  },
  /* 아비터 트리뷰널(정정 둘) — 불가사리 팔 네 개의 바닥은 유지하되, 위 구슬 대신
     돔 둘레에서 서로 마주 보며 안으로 기운 짧은 기둥 다섯. */
  tribunal: () => {
    const arm = (ang: number): ShapeFace[] => {
      const a = (ang * Math.PI) / 180;
      return hornFaces(
        Math.sin(a) * 1.1, Math.cos(a) * 1.1, 1.7,
        Math.sin(a) * 4.7, Math.cos(a) * 4.7, 0.15, 2.3,
      );
    };
    const post = (ang: number): ShapeFace[] => {
      const a = (ang * Math.PI) / 180;
      return hornFaces(
        Math.sin(a) * 2.1, Math.cos(a) * 2.1, 2.6,
        Math.sin(a) * 1.3, Math.cos(a) * 1.3, 4.6, 0.75,
      );
    };
    return [
      ...arm(135), ...arm(225),
      ...post(180), ...post(108), ...post(252),
      ...arm(45), ...arm(-45),
      ...domeFaces3(0, 0, 2.6, 2.2, 0.8),
      ...post(36), ...post(-36),
    ];
  },
  /* 실드 배터리(정정 둘) — 몸은 얇게, 다리는 빨대: 가늘게 수평으로 뻗다가 끝이
     구부러져 땅에 꽂힌다. */
  sbattery: () => {
    const leg = (ang: number): ShapeFace[] => {
      const a = (ang * Math.PI) / 180;
      const sx = Math.sin(a);
      const sy = Math.cos(a);
      return [
        ...hornFaces(sx * 1.1, sy * 1.1, 1.4, sx * 3.2, sy * 3.2, 1.35, 0.42),
        ...hornFaces(sx * 3.2, sy * 3.2, 1.35, sx * 3.7, sy * 3.7, 0, 0.38),
      ];
    };
    const [gx2, gy2] = project(0, 0, 2.2);
    return [
      ...leg(157), ...leg(203), ...leg(112), ...leg(248),
      ...cylinderFaces3(0, 0, 1.5, 1),
      ...domeFaces3(0, 0, 1.5, 0.95, 1),
      topFace(groundEllipse(gx2, gy2, 0.55, 0.4), 0.4),
      ...leg(67), ...leg(-67), ...leg(22), ...leg(-22),
    ];
  },
  /* 에볼루션 챔버(실물 참고) — 장기·심장 같은 살덩이 두 엽(결절 점·숨구멍 입),
     뒤의 검은 굴뚝 등걸, 가운데 흰 힘줄 띠, 앞오른쪽 촉수 술. */
  evo: () => {
    const nod = (nx2: number, ny2: number, nz2: number): ShapeFace => {
      const [px2, py2] = project(nx2, ny2, nz2);
      return capFace(groundEllipse(px2, py2, 0.3, 0.24), 0.35);
    };
    const [mx3, my3] = project(-2.6, 2.4, 0.9);
    const band = polyPath3([[-0.7, 1.7, 2.7], [1.5, 0.9, 3], [1.7, 0.2, 2.2], [-0.5, 1, 1.9]]);
    return [
      // 뒤 검은 굴뚝 등걸 — 속이 빈 그루터기.
      ...boxFaces3(0.7, -1.9, 2, 1.7, 3.7),
      capFace(discPath3(0.7, -1.9, 3.75, 0.75), 0.5),
      // 심장 같은 살덩이 두 엽.
      ...domeFaces3(-1.9, 1, 2.4, 2.1),
      ...domeFaces3(2, 0.3, 2.2, 1.9),
      // 결절 점들과 앞 숨구멍 입.
      nod(-2.9, 1.9, 1.6), nod(-1.2, 2.2, 1.9), nod(2.7, 1.2, 1.7), nod(1.5, -0.4, 2.4),
      capFace(groundEllipse(mx3, my3, 0.55, 0.4), 0.5),
      // 가운데 흰 힘줄 띠.
      topFace(band, 0.4),
      // 앞오른쪽 촉수 술.
      ...hornFaces(2.2, 1.8, 0.9, 2.6, 2.9, 0.1, 0.3),
      ...hornFaces(2.8, 1.4, 0.9, 3.5, 2.3, 0.1, 0.3),
      ...hornFaces(3.2, 0.8, 0.9, 4.1, 1.4, 0.1, 0.3),
      ...hornFaces(1.7, 2.2, 0.8, 1.8, 3.3, 0.1, 0.28),
    ];
  },
  /* 히드라리스크 덴(실물 참고) — 둔덕 위로 갈퀴막이 걸린 큰 돛가시들이 둘러서고,
     앞에는 마디진 꼬리가 똬리를 튼다. */
  hydraden: () => {
    const [mx3, my3] = project(1.9, 3.2, 1);
    return [
      ...domeFaces3(0, 0, 4.6, 2.6),
      // 돛가시 + 갈퀴막 — 뒤 왼·뒤 오른·뒤 가운데.
      ...hornFaces(-2.6, -1.4, 2.2, -4.4, -2.6, 7.4, 1.3),
      bodyFace(polyPath3([[-2.6, -1.4, 2.4], [-4.2, -2.5, 6.8], [-3.2, -0.8, 4.4], [-2.2, -0.6, 2.8]])),
      sideFace(polyPath3([[-2.6, -1.4, 2.4], [-4.2, -2.5, 6.8], [-3.2, -0.8, 4.4], [-2.2, -0.6, 2.8]]), 0.15),
      ...hornFaces(2.4, -1.6, 2.2, 4.2, -3, 6.8, 1.2),
      bodyFace(polyPath3([[2.4, -1.6, 2.4], [4, -2.9, 6.2], [3, -0.9, 4.2], [2, -0.7, 2.8]])),
      sideFace(polyPath3([[2.4, -1.6, 2.4], [4, -2.9, 6.2], [3, -0.9, 4.2], [2, -0.7, 2.8]]), 0.2),
      ...hornFaces(0, -2.8, 2.4, 0, -4.4, 6.2, 1.1),
      // 가지 사이 물갈퀴 천막(지적) — 이웃 돛가시 끝을 잇는 처진 막.
      /* 엉겨붙은 찢어진 막(재지적) — 매끈한 갈퀴가 아니라 가장자리가 들쭉날쭉 뜯긴
         네 폭. 뜯긴 골이 위로 파고들고 바닥선도 너덜거린다. */
      bodyFace(polyPath3([
        [-4.2, -2.5, 7], [-5.5, -1.6, 0.3], [-4.8, -1.4, 2.1], [-4.2, -1.2, 0.3],
        [-3.6, -1, 1.5], [-3.2, -0.9, 0.3],
      ])),
      sideFace(polyPath3([
        [-4.2, -2.5, 7], [-5.5, -1.6, 0.3], [-4.8, -1.4, 2.1], [-4.2, -1.2, 0.3],
        [-3.6, -1, 1.5], [-3.2, -0.9, 0.3],
      ]), 0.14),
      bodyFace(polyPath3([
        [-4.2, -2.5, 7], [-2.4, -3.3, 3.4], [-1.3, -3.8, 5], [0, -4.2, 5.9],
        [-0.6, -3.6, 0.3], [-1.4, -3.1, 2], [-2.2, -2.7, 0.3], [-3.4, -2.2, 0.3],
      ])),
      sideFace(polyPath3([
        [-4.2, -2.5, 7], [-2.4, -3.3, 3.4], [-1.3, -3.8, 5], [0, -4.2, 5.9],
        [-0.6, -3.6, 0.3], [-1.4, -3.1, 2], [-2.2, -2.7, 0.3], [-3.4, -2.2, 0.3],
      ]), 0.16),
      bodyFace(polyPath3([
        [4, -2.9, 6.5], [2.2, -3.5, 3.2], [1.2, -3.9, 4.8], [0, -4.2, 5.9],
        [0.6, -3.6, 0.3], [1.5, -3.1, 1.9], [2.3, -2.7, 0.3], [3.2, -2.4, 0.3],
      ])),
      sideFace(polyPath3([
        [4, -2.9, 6.5], [2.2, -3.5, 3.2], [1.2, -3.9, 4.8], [0, -4.2, 5.9],
        [0.6, -3.6, 0.3], [1.5, -3.1, 1.9], [2.3, -2.7, 0.3], [3.2, -2.4, 0.3],
      ]), 0.2),
      bodyFace(polyPath3([
        [4, -2.9, 6.5], [5.3, -1.8, 0.3], [4.6, -1.6, 1.9], [4, -1.4, 0.3],
        [3.5, -1.2, 1.3], [3, -1.1, 0.3],
      ])),
      sideFace(polyPath3([
        [4, -2.9, 6.5], [5.3, -1.8, 0.3], [4.6, -1.6, 1.9], [4, -1.4, 0.3],
        [3.5, -1.2, 1.3], [3, -1.1, 0.3],
      ]), 0.22),
      // 앞 똬리 꼬리 — 마디 돔 줄 + 끝 입.
      ...domeFaces3(-1.2, 2.6, 1, 0.85),
      ...domeFaces3(0, 3, 0.9, 0.75),
      ...domeFaces3(1.1, 2.7, 0.85, 0.7),
      capFace(groundEllipse(mx3, my3, 0.8, 0.45), 0.4),
    ];
  },
  /* 스파이어(실물 참고) — 초록 밑동에서 촉수 여러 가닥이 모여 오르는 기둥, 그 위
     잿빛 머리와 골진 도넛 왕관(가운데 구멍). */
  spire: () => {
    const out: ShapeFace[] = [];
    // 밑동 — 초록 무지개 더미(밝은 윗빛).
    out.push(...domeFaces3(0, 0.6, 2.7, 1.2));
    out.push(topFace(groundEllipse(...project(0, 0.6, 1), 1.7, 0.85), 0.3));
    // 촉수 기둥 — 여섯 가닥이 위로 모인다.
    for (const ang of [150, 210, 90, 270, 30, -30]) {
      const a = (ang * Math.PI) / 180;
      out.push(...hornFaces(
        Math.sin(a) * 2.5, 0.6 + Math.cos(a) * 2.5, 0.3,
        Math.sin(a) * 0.85, Math.cos(a) * 0.85, 8.3, 0.55,
      ));
    }
    // 잿빛 머리 판.
    out.push(...cylinderFaces3(0, 0, 1.6, 1.3, 8.1));
    // 골진 도넛 왕관 — 방사 골 + 가운데 구멍.
    const [cx2, cy2] = project(0, 0, 9.8);
    out.push(bodyFace(groundEllipse(cx2, cy2, 2.6, 1.5)));
    for (const ang of [200, 240, 280, 320, 20, 60, 100, 140]) {
      const a = (ang * Math.PI) / 180;
      out.push(sideFace(`M${cx2 + Math.cos(a) * 1.1} ${cy2 + Math.sin(a) * 0.62}`
        + ` L${cx2 + Math.cos(a) * 2.45} ${cy2 + Math.sin(a) * 1.4}`
        + ` L${cx2 + Math.cos(a + 0.16) * 2.45} ${cy2 + Math.sin(a + 0.16) * 1.4}`
        + ` L${cx2 + Math.cos(a + 0.16) * 1.1} ${cy2 + Math.sin(a + 0.16) * 0.62} Z`, 0.16));
    }
    out.push(capFace(groundEllipse(cx2, cy2 - 0.15, 0.75, 0.45), 0.5));
    return out;
  },
  /* 그레이터 스파이어(정정: 바닥 제거·층 없는 한 몸·더 높게) — 허리가 잘록했다 위에서
     벌어지는 매끈한 줄기 하나, 앞 붉은 살 띠, 옆 혹, 꼭대기 살덩이 엽 아가리와 깃 뿔. */
  gspire: () => {
    const out: ShapeFace[] = [];
    const [bx, by] = project(0, 0.4, 0);
    const [, wy] = project(0, 0.4, 6.2);
    const [, ty] = project(0, 0.4, 9.6);
    out.push(bodyFace(
      `M${bx - 2.9} ${by}`
      + ` Q${bx - 2.5} ${(by + wy) / 2} ${bx - 1.55} ${wy}`
      + ` Q${bx - 1.75} ${(wy + ty) / 2} ${bx - 2.35} ${ty}`
      + ` L${bx + 2.35} ${ty}`
      + ` Q${bx + 1.75} ${(wy + ty) / 2} ${bx + 1.55} ${wy}`
      + ` Q${bx + 2.5} ${(by + wy) / 2} ${bx + 2.9} ${by}`
      + `a2.9 1.3 0 1 1 -5.8 0Z`,
    ));
    out.push(sideFace(
      `M${bx + 1.05} ${wy} Q${bx + 1.25} ${(wy + ty) / 2} ${bx + 1.75} ${ty - 0.4}`
      + ` L${bx + 2.3} ${ty}`
      + ` Q${bx + 1.7} ${(wy + ty) / 2} ${bx + 1.5} ${wy}`
      + ` Q${bx + 2.4} ${(by + wy) / 2} ${bx + 2.8} ${by}`
      + ` Q${bx + 1.9} ${(by + wy) / 2} ${bx + 1.05} ${wy} Z`, 0.16,
    ));
    // 앞 붉은 살 띠 — 길게, 가로 골 셋.
    out.push(bodyFace(polyPath3([[-0.85, 2.2, 1.4], [0.85, 2.2, 1.4], [0.45, 1.1, 7.6], [-0.45, 1.1, 7.6]])));
    out.push(capFace(polyPath3([[-0.7, 2.1, 2.6], [0.7, 2.1, 2.6], [0.66, 2, 2.9], [-0.66, 2, 2.9]]), 0.2));
    out.push(capFace(polyPath3([[-0.62, 1.85, 4.2], [0.62, 1.85, 4.2], [0.58, 1.75, 4.5], [-0.58, 1.75, 4.5]]), 0.2));
    out.push(capFace(polyPath3([[-0.54, 1.55, 5.8], [0.54, 1.55, 5.8], [0.5, 1.45, 6.1], [-0.5, 1.45, 6.1]]), 0.2));
    // 옆 혹 둘.
    out.push(...domeFaces3(-1.7, 1, 0.95, 0.8, 3.2));
    out.push(...domeFaces3(1.8, 0.7, 0.85, 0.7, 4.6));
    // 깃 뿔 한 쌍 — 꼭대기 옆에서 위로.
    out.push(...hornFaces(-1.9, -0.4, 7.6, -2.9, -0.9, 11, 0.95));
    out.push(...hornFaces(1.9, -0.4, 7.6, 2.9, -0.9, 11, 0.95));
    // 꼭대기 살덩이 엽 아가리.
    const [cx2, cy2] = project(0, 0, 10.1);
    out.push(...domeFaces3(-1.15, -0.4, 1.1, 0.9, 9.4));
    out.push(...domeFaces3(1.15, -0.4, 1.05, 0.85, 9.4));
    out.push(...domeFaces3(-0.75, 0.75, 0.95, 0.8, 9.4));
    out.push(...domeFaces3(0.85, 0.75, 0.95, 0.8, 9.4));
    out.push(...domeFaces3(0, -1.05, 0.95, 0.8, 9.4));
    out.push(capFace(groundEllipse(cx2, cy2 - 0.1, 0.75, 0.45), 0.5));
    return out;
  },
  /* 퀸즈 네스트(실물 참고) — 살덩이 엽이 겹겹이 쌓인 봉분: 아랫단 엽 다섯, 사이 어두운
     세로 골, 중간 단 셋, 꼭대기 덮개와 작은 뿔들, 밑동 촉수. */
  queensnest: () => {
    const slit = (sx2: number, sy2: number, sz2: number): ShapeFace => {
      const [px2, py2] = project(sx2, sy2, sz2);
      return capFace(groundEllipse(px2, py2, 0.28, 0.85), 0.4);
    };
    return [
      // 아랫단 엽 다섯.
      ...domeFaces3(-3, -0.8, 1.6, 2.2),
      ...domeFaces3(3, -0.9, 1.6, 2.2),
      ...domeFaces3(-2.4, 1, 1.7, 2.4),
      ...domeFaces3(2.1, 1, 1.7, 2.4),
      ...domeFaces3(-0.2, 1.6, 1.8, 2.6),
      // 사이 어두운 세로 골.
      slit(-1.4, 1.8, 1.1), slit(1.1, 1.8, 1.1), slit(-2.9, 0.4, 1),
      // 중간 단 셋.
      ...domeFaces3(-1.3, 0, 1.8, 2.4, 1.9),
      ...domeFaces3(1.2, 0, 1.8, 2.4, 1.9),
      ...domeFaces3(0, -1, 1.9, 2.4, 1.9),
      // 꼭대기 덮개 + 작은 뿔들.
      ...domeFaces3(0, -0.2, 1.9, 1.9, 3.9),
      ...hornFaces(-0.9, -0.9, 5.3, -1.5, -1.4, 6.5, 0.5),
      ...hornFaces(0.9, -0.9, 5.3, 1.5, -1.4, 6.5, 0.5),
      ...hornFaces(0, -1.3, 5.1, 0, -2, 6.1, 0.5),
      // 밑동 촉수.
      ...hornFaces(-2.6, 2.2, 0.6, -3.4, 3, 0.1, 0.5),
      ...hornFaces(2.6, 2.2, 0.6, 3.4, 3, 0.1, 0.5),
    ];
  },
  /* 디파일러 마운드(실물 참고) — 낮게 퍼진 살덩이 위에 검은 수정 조각 무더기가 솟고,
     왼쪽엔 말려 올라간 촉수, 가운데엔 흰 애벌레 마디, 앞엔 구덩이 입. */
  dmound: () => {
    const shard = (bx2: number, by2: number, tx2: number, ty2: number, tz2: number, w2: number): ShapeFace[] => {
      const d = polyPath3([[bx2 - w2, by2, 0.4], [bx2 + w2, by2 - 0.3, 0.4], [tx2, ty2, tz2]]);
      return [bodyFace(d), sideFace(d, 0.42)];
    };
    const grub = (gx2: number, gy2: number, r2: number): ShapeFace[] => {
      const [px2, py2] = project(gx2, gy2, r2 * 0.9);
      return [
        ...domeFaces3(gx2, gy2, r2, r2 * 0.85),
        topFace(groundEllipse(px2, py2, r2 * 0.6, r2 * 0.4), 0.4),
      ];
    };
    const [mx3, my3] = project(0.9, 2.6, 0.8);
    return [
      ...domeFaces3(-1.4, 0.4, 3.6, 1.6),
      ...domeFaces3(1.8, -0.4, 3.4, 1.7),
      // 검은 수정 무더기 — 오른쪽 크게, 왼앞 작게.
      ...shard(2.6, -1.4, 2.4, -2, 4.8, 0.8),
      ...shard(3.6, -0.6, 3.9, -1.1, 3.7, 0.7),
      ...shard(4.2, -1.8, 4.6, -2.2, 2.9, 0.6),
      ...shard(1.9, -0.4, 1.6, -0.9, 3.4, 0.6),
      ...shard(-4, 0.6, -4.4, 0.2, 2.5, 0.6),
      ...shard(-3.3, 1.4, -3.6, 1, 2, 0.5),
      // 말린 촉수 — 왼쪽에서 세 마디로 감아 올라간다.
      ...hornFaces(-2.6, 0.9, 1, -4.5, -0.2, 3.3, 0.9),
      ...hornFaces(-4.5, -0.2, 3.3, -3.5, -1.5, 4.6, 0.7),
      ...hornFaces(-3.5, -1.5, 4.6, -2.6, -0.9, 3.7, 0.5),
      // 흰 애벌레 마디 — 가운데 대각선 줄.
      ...grub(0.3, 0.6, 0.85),
      ...grub(-0.5, -0.1, 0.8),
      ...grub(-1.3, -0.7, 0.72),
      // 앞 구덩이 입 + 작은 엄니.
      capFace(groundEllipse(mx3, my3, 1.35, 0.6), 0.5),
      ...hornFaces(-0.2, 2.2, 0.6, -0.4, 2.9, 1.7, 0.4),
      ...hornFaces(0.6, 1.9, 0.6, 0.9, 2.6, 1.6, 0.4),
    ];
  },
  /* 울트라리스크 캐번(실물 참고) — 울퉁불퉁한 큰 덩치 앞에 거대한 아가리가 벌어지고,
     그 양옆을 큰 금빛 엄니 둘이 감싼다. 옆엔 흰 베개 덩이, 바닥엔 촉수 술. */
  cavern: () => {
    const [mx3, my3] = project(0, 2.9, 1.5);
    return [
      // 옆 흰 베개 덩이.
      ...domeFaces3(-3.7, 0.4, 1.5, 1.1),
      topFace(groundEllipse(...project(-3.7, 0.4, 0.9), 0.9, 0.5), 0.35),
      ...domeFaces3(3.7, 0, 1.4, 1),
      topFace(groundEllipse(...project(3.7, 0, 0.8), 0.85, 0.45), 0.3),
      // 울퉁불퉁 몸 — 겹돔.
      ...domeFaces3(0, -1, 4.2, 3.7),
      ...domeFaces3(-1.7, 0.1, 2.6, 2.2, 1.3),
      ...domeFaces3(1.9, 0.3, 2.4, 2, 1.1),
      // 거대한 아가리 — 어두운 속.
      capFace(groundEllipse(mx3, my3, 2.5, 1.6), 0.5),
      // 큰 금 엄니 — 아가리 양옆에서 아래로 굽는다(끝 밝게).
      ...hornFaces(-2, 2.4, 3.6, -1.2, 3.9, 0.4, 1.05),
      topFace(polyPath3([[-1.7, 2.9, 2.6], [-1.25, 3.7, 0.6], [-1.5, 3.5, 0.5], [-1.95, 2.8, 2.4]]), 0.4),
      ...hornFaces(2, 2.4, 3.6, 1.2, 3.9, 0.4, 1.05),
      topFace(polyPath3([[1.7, 2.9, 2.6], [1.25, 3.7, 0.6], [1.5, 3.5, 0.5], [1.95, 2.8, 2.4]]), 0.35),
      // 바닥 촉수 술.
      ...hornFaces(-3.3, 2.4, 0.5, -4.5, 3.2, 0.1, 0.4),
      ...hornFaces(3.4, 2.2, 0.5, 4.6, 3, 0.1, 0.4),
      ...hornFaces(-4.2, 1.2, 0.5, -5.4, 1.7, 0.1, 0.38),
    ];
  },
  /* 나이더스 커널(재작도) — 좌우로 감싸 늘어진 큰 엽(잿빛 꼭대기 캡) 사이로 세로로
     발광하는 균열 속이 드러나고, 앞 아래엔 이빨 줄과 발톱. */
  nydus: () => {
    const [px2, py2] = project(0, 1.5, 2.3);
    const cap = (cx2: number, cy2: number, cz2: number, r2: number, op: number): ShapeFace => {
      const [qx, qy] = project(cx2, cy2, cz2);
      return topFace(groundEllipse(qx, qy, r2, r2 * 0.6), op);
    };
    return [
      // 뒤 몸통 덩어리.
      ...domeFaces3(0, -1, 3.2, 3.4),
      // 세로 발광 균열 — 어두운 테와 밝은 속.
      capFace(groundEllipse(px2, py2, 1.5, 2.05), 0.45),
      topFace(groundEllipse(px2, py2, 1.02, 1.55), 0.42),
      // 좌우로 늘어지는 큰 엽 + 잿빛 꼭대기 캡.
      ...domeFaces3(-2.1, 0.4, 1.9, 2.9),
      cap(-2.2, -0.1, 2.55, 0.95, 0.3),
      ...domeFaces3(2.2, 0.3, 1.9, 2.9),
      cap(2.3, -0.2, 2.55, 0.9, 0.24),
      // 위 덮개 엽.
      ...domeFaces3(0, -0.7, 2, 2.1, 2.3),
      cap(0, -1.1, 4.1, 1, 0.28),
      // 앞 아래 이빨 줄.
      ...hornFaces(-1.7, 2.4, 0.4, -1.9, 2.7, 1.7, 0.4),
      ...hornFaces(-0.85, 2.7, 0.4, -0.95, 3, 1.9, 0.4),
      ...hornFaces(0, 2.8, 0.4, 0, 3.1, 2, 0.4),
      ...hornFaces(0.85, 2.7, 0.4, 0.95, 3, 1.9, 0.4),
      ...hornFaces(1.7, 2.4, 0.4, 1.9, 2.7, 1.7, 0.4),
      // 발톱 둘.
      ...hornFaces(-2.2, 2.7, 0.5, -2.8, 3.5, 0.1, 0.5),
      ...hornFaces(2.2, 2.7, 0.5, 2.8, 3.5, 0.1, 0.5),
    ];
  },

  /* 해처리 — 둔덕 + 방사 다리 여섯(요잉을 따라 도는 것이 핵심) + 윗면 입·목띠. */
  hatchery: () => {
    const out: ShapeFace[] = [];
    for (const ang of [130, -170]) out.push(...limbFaces(ang, 3, 1.7, 3.4));
    /* 꼭대기 볏(실물) — 뒤로 벌어져 굽는 볏 뿔 한 쌍. 둔덕보다 먼저 그려 밑동이
       가려진다(지적: 뿔이 비쳐 보였다). */
    out.push(...hornFaces(-1.1, -0.7, 5.7, -3.2, -1.6, 9.4, 1.3));
    out.push(...hornFaces(1.1, -0.6, 5.7, 3.3, -1.4, 9.6, 1.4));
    /* 본 기둥 — 뒤집힌 밥그릇(돔)이 아니라 후지산 둔덕(지적): 위는 좁게 잘리고 옆구리는
       가파르다가 바닥에서 완만하게 벌어진다. 회전 대칭이라 요잉 불변. */
    {
      const [bx, by] = project(0, 0, 0);
      const [, ty] = project(0, 0, 6.6);
      const rB = 5.9;
      const rT = 1.4;
      const ryB = rB * 0.45;
      const mound = `M${bx - rB} ${by}`
        + ` Q${bx - rB * 0.86} ${by - (by - ty) * 0.28} ${bx - rT} ${ty}`
        + ` L${bx + rT} ${ty}`
        + ` Q${bx + rB * 0.86} ${by - (by - ty) * 0.28} ${bx + rB} ${by}`
        + `a${rB} ${ryB} 0 1 1-${rB * 2} 0Z`;
      out.push(bodyFace(mound));
      out.push(sideFace(
        `M${bx + rT * 0.55} ${ty} Q${bx + rB * 0.8} ${by - (by - ty) * 0.26} ${bx + rB * 0.92} ${by}`
        + ` Q${bx + rB * 0.55} ${by + ryB * 0.5} ${bx + rT * 0.4} ${by}`
        + ` Q${bx + rB * 0.5} ${by - (by - ty) * 0.3} ${bx + rT * 0.55} ${ty} Z`,
        0.2,
      ));
    }
    const [mx, my] = project(0, 0, 6.35);
    out.push(sideFace(`M${mx - 1.5} ${my} L${mx + 1.5} ${my} Q${mx + 1.4} ${my + 1} ${mx} ${my + 1.15} Q${mx - 1.4} ${my + 1} ${mx - 1.5} ${my} Z`, 0.35));
    out.push(topFace(groundEllipse(mx, my, 1.4, 0.4)));
    for (const ang of [-40, 20, -100, 80]) out.push(...limbFaces(ang, 3.4, 1.7, 3.2));
    // 바닥 갈고리 덩굴(실물) — 다리 사이로 기다가 끝이 말려 올라간다.
    out.push(...hornFaces(4.2, 4.2, 0.5, 6.6, 6, 0.9, 0.7));
    out.push(...hornFaces(6.6, 6, 0.9, 7.4, 6.6, 2.4, 0.5));
    out.push(...hornFaces(-5.6, 2, 0.5, -7.8, 2.8, 0.9, 0.7));
    out.push(...hornFaces(-7.8, 2.8, 0.9, -8.6, 3, 2.2, 0.5));
    return out;
  },
  /* 레어 — 해처리 + 다리 끝 굽은 뿔 셋. */
  lair: () => [
    // 뿔은 동굴 입구 하나 건너 하나(지적) — 다리 각 -170·-40·80의 입구에서 솟는다.
    // 뒤 입구(-170) 뿔은 둔덕이 가리도록 먼저(지적: 비쳐 보였다).
    ...hornFaces(-1.15, -6.5, 0.9, -1.4, -7.7, 9, 1.5),
    ...SHAPE_BUILDERS.hatchery(),
    ...hornFaces(-4.25, 5.05, 0.9, -5, 6, 10.4, 1.7),
    ...hornFaces(6.5, 1.15, 1, 7.7, 1.4, 11, 1.9),
  ],
  /* 하이브 — 더 길고 굵은 뿔 셋(뿔 등에 가시들, 요청) + 앞 컬. */
  hive: () => {
    const out: ShapeFace[] = [];
    // 뿔은 동굴 입구 하나 건너 하나(지적) — 레어와 같은 세 입구, 더 길게.
    // 첫째(뒤 입구) 뿔은 둔덕보다 먼저 그린다(지적: 비쳐 보였다).
    const horns: [number, number, number, number, number, number, number][] = [
      [-1.15, -6.5, 0.9, -1.5, -8.2, 11.6, 1.9],
      [-4.25, 5.05, 0.9, -5.3, 6.4, 13, 2.1],
      [6.5, 1.15, 1, 8.2, 1.6, 14, 2.3],
    ];
    let hi = 0;
    for (const [bx, by, bz, tx, ty, tz, w] of horns) {
      if (hi === 1) out.push(...SHAPE_BUILDERS.hatchery());
      hi += 1;
      out.push(...hornFaces(bx, by, bz, tx, ty, tz, w));
      /* 뿔 등의 가시(요청, 정정: 안쪽을 향한다) — 뿔 길이를 따라 서너 개가 본 건물
         쪽으로 돋는다. */
      for (const t of [0.35, 0.55, 0.75]) {
        const px = bx + (tx - bx) * t;
        const py = by + (ty - by) * t;
        const pz = bz + (tz - bz) * t;
        const olen = Math.hypot(px, py) || 1;
        const ox = (px / olen) * 1.7;
        const oy = (py / olen) * 1.7;
        out.push(...hornFaces(px, py, pz, px - ox, py - oy, pz + 0.7, 0.65));
      }
    }
    out.push(...hornFaces(-2.6, 4.6, 0.6, -4.4, 6, 2.6, 1));
    out.push(...hornFaces(2.8, 4.4, 0.6, 4.6, 5.6, 2.4, 1));
    return out;
  },
  /* 스포닝 풀(입체감, 지적) — 살 테두리를 땅에서 도톰하게 올리고 앞으로 흘러내리는
     치마 벽을 달았다. 웅덩이 안쪽 뒤편엔 테두리 그늘, 위로는 마주 굽는 뼈 아치. */
  pool: () => {
    const [cx, cy] = project(0, 0, 1.5);
    const [, gy] = project(0, 0, 0);
    const ring = `M${cx - 6.4} ${cy} a6.4 3.1 0 1 0 12.8 0a6.4 3.1 0 1 0 -12.8 0`
      + ` M${cx - 4.7} ${cy} a4.7 2.15 0 1 1 9.4 0a4.7 2.15 0 1 1 -9.4 0`;
    return [
      sideFace(discPath3(0, 0.4, 0, 7), 0.2),
      // 앞 치마 벽 — 올라간 테두리에서 땅까지 흘러내린다.
      bodyFace(`M${cx - 6.4} ${cy} A6.4 3.1 0 0 0 ${cx + 6.4} ${cy} L${cx + 6.4} ${gy} A6.4 3.1 0 0 1 ${cx - 6.4} ${gy} Z`),
      sideFace(`M${cx - 6.4} ${cy} A6.4 3.1 0 0 0 ${cx + 6.4} ${cy} L${cx + 6.4} ${gy} A6.4 3.1 0 0 1 ${cx - 6.4} ${gy} Z`, 0.18),
      bodyFace(ring),
      sideFace(`M${cx - 6.4} ${cy} a6.4 3.1 0 0 0 12.8 0a6.4 2.5 0 0 1 -12.8 0`, 0.2),
      topFace(`M${cx - 6.4} ${cy} a6.4 3.1 0 0 1 12.8 0a6.4 2.6 0 0 0 -12.8 0`, 0.14),
      capFace(groundEllipse(cx, cy, 4.7, 2.15), 0.5),
      // 안쪽 뒤편 그늘 — 테두리가 물에 드리우는 그림자.
      capFace(`M${cx - 4.7} ${cy} A4.7 2.15 0 0 1 ${cx + 4.7} ${cy} A4.7 1.55 0 0 0 ${cx - 4.7} ${cy} Z`, 0.25),
      topFace(groundEllipse(cx - 1.3, cy + 0.4, 2.4, 0.9), 0.18),
      topFace(groundEllipse(cx + 1.8, cy + 1.1, 1.2, 0.45), 0.14),
      // 뼈 아치 — 양쪽 테두리에서 웅덩이 위로 마주 굽는 뿔 둘.
      ...hornFaces(-5.2, -1.4, 1.9, -1, -0.4, 5.4, 1.3),
      ...hornFaces(4.9, 1, 1.9, 0.9, 0.2, 5, 1.2),
      // 테두리 잔가시.
      ...hornFaces(-3.2, 4.2, 1.4, -4, 5.6, 2.4, 0.8),
      ...hornFaces(5.6, -1.8, 1.4, 7, -2.4, 2.3, 0.8),
      ...hornFaces(-6, 0.8, 1.4, -7.4, 1, 2.2, 0.8),
      ...hornFaces(1.8, -5, 1.3, 2.4, -6.4, 2.1, 0.7),
    ];
  },
  /* 핵탄두(요청·테스트) — 몸통 원통 + 둥근 탄두 + 꼬리 날개 넷. */
  nuke: () => [
    ...cylinderFaces3(0, 0, 1.7, 7.4),
    ...domeFaces3(0, 0, 1.7, 3, 7.4),
    ...hornFaces(-1.5, 0, 0.4, -3.1, 0, 2.6, 1),
    ...hornFaces(1.5, 0, 0.4, 3.1, 0, 2.6, 1),
    ...hornFaces(0, -1.3, 0.4, 0, -2.8, 2.6, 0.9),
    ...hornFaces(0, 1.3, 0.4, 0, 2.8, 2.6, 0.9),
  ],

  /* 핵 화구 돔(요청: 반구형 돔) — 폭발 화구를 3D 반구로. 색은 감싼 쪽의 주황
     (currentColor)이 정하고, 재생 쪽 CSS가 부풀리며 사그라뜨린다. */
  nukedome: () => {
    const [hx3, hy3] = project(-1.8, -1.2, 3.4);
    return [
      ...domeFaces3(0, 0, 7, 5),
      topFace(groundEllipse(hx3, hy3, 2.2, 1.5), 0.35),
    ];
  },
  /* ── 기계·함선 유닛들(요청: 만들 수 있는 건 다) — 정면 +y, 공중은 높이 띄운다. ── */
  /* 시즈 탱크(실물 참고) — 양옆 궤도 블록 + 차체 + 포탑의 쌍포신. */
  tank: () => [
    // 몸체를 더 넙적하게(지적).
    ...boxFaces3(-2.5, 0, 1.8, 5.2, 1.5),
    ...boxFaces3(2.5, 0, 1.8, 5.2, 1.5),
    ...boxFaces3(0, -0.2, 4.2, 4.4, 1.3, 1.2),
    ...boxFaces3(0, -0.4, 2.6, 2.6, 1.3, 2.5),
    ...tubeFaces(-0.55, 1.2, -0.55, 3.9, 0.24, 3.3),
    ...tubeFaces(0.55, 1.2, 0.55, 3.9, 0.24, 3.3),
  ],
  /* 시즈 모드(실물 참고) — 사방으로 벌린 궤도 발 넷 + 올라선 포탑 + 위-앞으로 겨눈
     큰 포신. */
  tanksiege: () => {
    /* 포신(수리: 요잉 때 뒤틀림) — 화면 사각형 대신 모델 공간 슬래브: 윗면·옆 두께·
       포구 단면이 전부 모형 좌표라 어느 요잉에서도 결이 맞는다. */
    const barrelTop = polyPath3([[-0.7, 0.7, 4], [0.7, 0.7, 4], [0.7, 2.9, 6.9], [-0.7, 2.9, 6.9]]);
    return [
      /* 고정 다리(지적) — 차체에서 대각으로 내려 뻗는 지주와 땅을 문 넓은 발판,
         발판 끝 말뚝까지: 땅에 딱 박힌 전개 다리. */
      ...hornFaces(-1.8, 1.5, 1.8, -3.2, 2.5, 0.5, 0.8),
      ...boxFaces3(-3.4, 2.7, 1.8, 1.4, 0.55),
      ...hornFaces(-3.9, 3.1, 0.55, -4.2, 3.4, 0, 0.35),
      ...hornFaces(1.8, 1.5, 1.8, 3.2, 2.5, 0.5, 0.8),
      ...boxFaces3(3.4, 2.7, 1.8, 1.4, 0.55),
      ...hornFaces(3.9, 3.1, 0.55, 4.2, 3.4, 0, 0.35),
      ...hornFaces(-1.8, -1.5, 1.8, -3.3, -2.5, 0.5, 0.8),
      ...boxFaces3(-3.5, -2.7, 1.8, 1.4, 0.55),
      ...hornFaces(1.8, -1.5, 1.8, 3.3, -2.5, 0.5, 0.8),
      ...boxFaces3(3.5, -2.7, 1.8, 1.4, 0.55),
      // 옆이 아니라 앞뒤로 긴 차체(정정).
      ...boxFaces3(0, -0.3, 2.8, 4.8, 1.6, 1),
      ...frustumFaces3(0, -0.7, 2.3, 3.2, 1.7, 2.4, 1.6, 2.6),
      bodyFace(barrelTop),
      topFace(barrelTop, 0.18),
      bodyFace(polyPath3([[0.7, 0.7, 4], [0.7, 2.9, 6.9], [0.7, 2.9, 6.5], [0.7, 0.7, 3.6]])),
      sideFace(polyPath3([[0.7, 0.7, 4], [0.7, 2.9, 6.9], [0.7, 2.9, 6.5], [0.7, 0.7, 3.6]]), 0.24),
      capFace(polyPath3([[-0.7, 2.9, 6.9], [0.7, 2.9, 6.9], [0.7, 2.9, 6.5], [-0.7, 2.9, 6.5]]), 0.4),
    ];
  },
  /* 벌처(실물 참고) — 뒤 엔진 통 둘, 가운데 좌석·라이더 혹, 앞으로 길고 뾰족하게
     뻗는 칼날 스키드 코. */
  vulture: () => {
    const [gx, gy] = project(0, 0.4, 3);
    const nose = polyPath3([[-1, -0.3, 4.35], [1, -0.3, 4.35], [0.4, 4.8, 3.55], [-0.05, 4.9, 3.55]]);
    return [
      topFace(groundEllipse(gx, gy, 2, 0.85), 0.22),
      ...tubeFaces(-0.5, -2.9, -0.5, -1.3, 0.55, 4.6),
      ...tubeFaces(0.6, -3, 0.6, -1.4, 0.5, 4.2),
      bodyFace(polyPath3([[1.1, -0.2, 4.4], [0.9, -2.4, 4.5], [-0.9, -2.4, 4.5], [-1.1, -0.2, 4.4]])),
      ...domeFaces3(0, -1, 0.85, 0.85, 4.6),
      bodyFace(nose),
      topFace(nose, 0.18),
      sideFace(polyPath3([[1, -0.3, 4.35], [0.4, 4.8, 3.55], [0.35, 4.75, 3.2], [0.95, -0.3, 3.9]]), 0.2),
    ];
  },
  /* 골리앗 — 두 다리 위 상자 몸통 + 양옆 총 포드 + 머리. */
  goliath: () => [
    // 기계식 꺾인 다리(짧게 유지).
    ...hornFaces(-1.2, -0.2, 4.8, -1.7, -1.2, 2.9, 0.8),
    ...hornFaces(-1.7, -1.2, 2.9, -1.9, 0.7, 0.9, 0.65),
    ...boxFaces3(-1.9, 0.8, 1.1, 1.6, 0.5),
    ...hornFaces(1.2, -0.2, 4.8, 1.7, -1.2, 2.9, 0.8),
    ...hornFaces(1.7, -1.2, 2.9, 1.9, 0.7, 0.9, 0.65),
    ...boxFaces3(1.9, 0.8, 1.1, 1.6, 0.5),
    // 몸통 + 옆에 매달린 큰 팔 총 포드(앞 총열).
    ...boxFaces3(0, -0.2, 2.6, 2.2, 2, 4.8),
    ...boxFaces3(-2.25, 0, 1.25, 1.9, 1.8, 4.3),
    ...tubeFaces(-2.25, 0.9, -2.25, 2.3, 0.28, 5),
    ...boxFaces3(2.25, 0, 1.25, 1.9, 1.8, 4.3),
    ...tubeFaces(2.25, 0.9, 2.25, 2.3, 0.28, 5),
    // 콕핏 머리 — 앞 창 + 안테나.
    ...domeFaces3(0, 0.2, 0.9, 0.7, 6.8),
    capFace(polyPath3([[-0.5, 0.95, 7.2], [0.5, 0.95, 7.2], [0.4, 1.05, 6.9], [-0.4, 1.05, 6.9]]), 0.4),
    ...hornFaces(-0.5, -0.6, 7.4, -0.8, -0.9, 8.4, 0.22),
  ],
  /* 리버(복구) — 반지름이 비슷한 마디 돔 다섯을 촘촘히 겹친 매끈한 애벌레 + 앞 입. */
  reaver: () => {
    const [mx2, my2] = project(0, 3.6, 4);
    return [
      // 반원 아치 + 머리·꼬리로 갈수록 몸도 얇아진다(지적).
      ...domeFaces3(0, -2.6, 0.65, 0.6, 3.4),
      ...domeFaces3(0, -1.2, 1.4, 1.8, 3.4),
      ...domeFaces3(0, 0.1, 1.68, 2.4, 3.4),
      ...domeFaces3(0, 1.4, 1.4, 1.8, 3.4),
      ...domeFaces3(0, 2.6, 0.65, 0.6, 3.4),
      capFace(groundEllipse(mx2, my2, 0.55, 0.35), 0.4),
    ];
  },
  /* 레이스(정정: 세모 아님) — 사각형들로 짠 몸: 상자 몸통 + 콕핏 상자 + 뒤로 젖힌
     사각 날개 두 장, 그리고 양 날개 끝마다 앞으로 뻗는 긴 포신 하나씩. */
  wraith: () => {
    const gun = (tx: number): ShapeFace[] => {
      const [ax2, ay2] = project(tx, -0.8, 5.75);
      const [bx2, by2] = project(tx + (tx > 0 ? 0.2 : -0.2), 3.6, 5.65);
      const dx2 = bx2 - ax2;
      const dy2 = by2 - ay2;
      const L = Math.hypot(dx2, dy2) || 1;
      const nx2 = (-dy2 / L) * 0.17;
      const ny2 = (dx2 / L) * 0.17;
      return [
        bodyFace(`M${ax2 + nx2} ${ay2 + ny2} L${bx2 + nx2} ${by2 + ny2} L${bx2 - nx2} ${by2 - ny2} L${ax2 - nx2} ${ay2 - ny2} Z`),
        capFace(groundEllipse(bx2, by2, 0.2, 0.16), 0.4),
      ];
    };
    const wingL = polyPath3([[-0.85, 0.6, 5.9], [-3.1, -1.1, 5.7], [-3.1, -2.3, 5.75], [-0.85, -1.2, 5.95]]);
    const wingR = polyPath3([[0.85, 0.6, 5.9], [3.1, -1.1, 5.7], [3.1, -2.3, 5.75], [0.85, -1.2, 5.95]]);
    return [
      // 뒤 엔진 꽁무니 둘.
      ...tubeFaces(-0.5, -2.8, -0.5, -1.7, 0.32, 5.4),
      ...tubeFaces(0.5, -2.8, 0.5, -1.7, 0.32, 5.4),
      // 날개 — 사각 평판 두 장.
      bodyFace(wingL), topFace(wingL, 0.16),
      bodyFace(wingR), sideFace(wingR, 0.18),
      // 날개 끝 긴 포신 각각.
      ...gun(-3.1),
      ...gun(3.1),
      // 몸통 상자 + 콕핏 상자.
      ...boxFaces3(0, 0.3, 1.7, 4.2, 1.1, 5.4),
      ...boxFaces3(0, 1, 1.1, 1.7, 0.7, 6.5),
      capFace(polyPath3([[-0.4, 1.86, 7], [0.4, 1.86, 7], [0.35, 1.86, 6.6], [-0.35, 1.86, 6.6]]), 0.4),
      // 핵심 포인트(지적: 훨씬 길게) — 몸 아래로 낮게 매달린 긴 포신.
      ...hornFaces(0, -0.9, 5.3, 0, -1.1, 3.3, 0.26),
      ...tubeFaces(0, -3.4, 0, 1.8, 0.4, 2.8),
    ];
  },
  /* 배틀크루저(전면 단순화 — 지적: 가는 붐·캡슐 조합이 조각나 보임) — 전부 몸에 붙은
     상자·짧은 통으로: 장도리 몸 + 옆 날개 슬래브 위 미사일 상자(탄두) + 꽁무니 통 셋. */
  bc: () => [
    // (제거·지적) 추진기 — 어느 판도 마음에 안 들어 걷었다.
    // 양팔 복구(지적) — 붐 팔 + 캡슐 미사일(탄두).
    ...hornFaces(-1.4, -1.4, 6, -4.5, -0.8, 5.7, 0.4),
    ...tubeFaces(-4.8, -1.6, -4.8, 1, 0.55, 5.3),
    ...hornFaces(-4.8, 1, 5.55, -4.8, 2.4, 5.5, 0.5),
    ...hornFaces(1.4, -1.4, 6, 4.5, -0.8, 5.7, 0.4),
    ...tubeFaces(4.8, -1.6, 4.8, 1, 0.55, 5.3),
    ...hornFaces(4.8, 1, 5.55, 4.8, 2.4, 5.5, 0.5),
    // 장도리 몸(정정 둘: 몸 짧게, 목 길게) — 몸통·긴 목·가로 머리·함교.
    ...boxFaces3(0, -0.6, 2.4, 3.4, 1.6, 5.4),
    ...boxFaces3(0, 2.2, 1.2, 2.6, 0.9, 5.7),
    ...boxFaces3(0, 4.1, 3.6, 1.2, 1.4, 5.5),
    ...boxFaces3(0, -1.4, 1.2, 1.2, 0.8, 7),
  ],
  /* 발키리(실물 참고) — 뭉툭한 큰 몸통에 둥근 코, 지붕의 미사일 튜브 다발 두 줄,
     양옆의 납작한 판 날개, 뒤 엔진 블록. */
  valk: () => {
    const plate = (m2: 1 | -1): string => polyPath3([
      [m2 * 1.6, 0.8, 5.6], [m2 * 3.6, 0.2, 5.4], [m2 * 3.4, -1.8, 5.5], [m2 * 1.6, -1.2, 5.7],
    ]);
    const tubeNose = (tx: number): ShapeFace[] => {
      const [px2, py2] = project(tx, 0.9, 7.2);
      return [bodyFace(groundEllipse(px2, py2 - 0.45 * 0.45, 0.48, 0.4))];
    };
    return [
      ...boxFaces3(0, -2.3, 2.2, 1, 1.5, 5.3),
      bodyFace(plate(1)), sideFace(plate(1), 0.2),
      bodyFace(plate(-1)), topFace(plate(-1), 0.14),
      ...boxFaces3(0, -0.4, 2.8, 3.8, 2.2, 5),
      // 코 — 뾰족한 끝을 깎아낸 절두형(정정): 좁아지다 평평한 단면으로 끝난다.
      bodyFace(polyPath3([[-1.35, 1, 6.05], [1.35, 1, 6.05], [0.75, 3, 5.9], [-0.75, 3, 5.9]])),
      topFace(polyPath3([[-1.35, 1, 6.05], [1.35, 1, 6.05], [0.75, 3, 5.9], [-0.75, 3, 5.9]]), 0.18),
      bodyFace(polyPath3([[-0.75, 3, 5.9], [0.75, 3, 5.9], [0.75, 3, 5], [-0.75, 3, 5]])),
      sideFace(polyPath3([[1.35, 1, 6.05], [0.75, 3, 5.9], [0.75, 3, 5], [1.35, 1, 5]]), 0.2),
      // 조종석 창(정정: 가로로 긴 콕핏 띠) — 능선 앞면을 가로지르는 낮고 넓은 창.
      capFace(polyPath3([[-1.15, 1.35, 7.5], [1.15, 1.35, 7.5], [1.05, 1.75, 6.85], [-1.05, 1.75, 6.85]]), 0.45),
      topFace(polyPath3([[-0.95, 1.42, 7.35], [-0.1, 1.42, 7.35], [-0.18, 1.66, 6.98], [-0.9, 1.66, 6.98]]), 0.3),
      // 지붕 미사일 튜브 다발.
      ...tubeFaces(-0.7, -1.7, -0.7, 0.9, 0.5, 7.2),
      ...tubeNose(-0.7),
      ...tubeFaces(0.7, -1.7, 0.7, 0.9, 0.5, 7.2),
      ...tubeNose(0.7),
    ];
  },
  /* 사이언스 베슬(정정) — 구 몸통 아래에 구형 추진기 세 개가 달린다. */
  vessel: () => {
    const [ex2, ey2] = project(0, 2.2, 6.3);
    return [
      ...domeFaces3(0, -1.6, 0.8, 1.4, 4.3),
      ...domeFaces3(-1.4, 1, 0.8, 1.4, 4.3),
      ...domeFaces3(1.4, 1, 0.8, 1.4, 4.3),
      ...domeFaces3(0, 0, 2.5, 3.4, 5),
      capFace(groundEllipse(ex2, ey2, 0.5, 0.32), 0.35),
    ];
  },
  /* 뮤탈리스크(정정) — 날개는 위에 달리고, 긴 몸통이 앞-아래로 휘어 입이 아래로 나온다. */
  muta: () => {
    const wing = (m2: 1 | -1): string => polyPath3([
      [m2 * 0.5, 0, 7.1], [m2 * 2.6, 1.3, 7.6], [m2 * 4.1, 0.2, 7.2], [m2 * 2.1, -0.4, 7],
    ]);
    const [mx2, my2] = project(0, 2.5, 3.9);
    return [
      // 굽는 몸통 — 날개 밑에서 앞-아래로 마디지며 내려간다.
      ...domeFaces3(0, 0, 1, 0.85, 6.4),
      ...domeFaces3(0, 0.8, 0.9, 0.75, 5.6),
      ...domeFaces3(0, 1.6, 0.8, 0.65, 4.8),
      ...hornFaces(0, 2, 4.6, 0, 2.6, 3.7, 0.7),
      capFace(groundEllipse(mx2, my2, 0.42, 0.3), 0.45),
      // 꼬리 — 뒤로 처진다.
      ...hornFaces(0, -0.6, 6.6, 0, -2.2, 5.8, 0.5),
      // 날개 — 위에서 펼쳐진다.
      bodyFace(wing(1)), sideFace(wing(1), 0.16),
      bodyFace(wing(-1)), topFace(wing(-1), 0.14),
    ];
  },
  /* 가디언(지적: 꽃게 모양) — 옆으로 넓적한 게딱지 + 앞 양 집게 + 옆 잔다리. */
  guardian: () => [
    ...domeFaces3(-1.2, -0.4, 1.7, 1.1, 5.7),
    ...domeFaces3(1.2, -0.4, 1.7, 1.1, 5.7),
    ...domeFaces3(0, -0.2, 2.1, 1.4, 5.6),
    // 앞 양 집게 — 두 마디로 안쪽으로 굽는다.
    ...hornFaces(1.9, 0.8, 5.9, 3, 2.2, 5.6, 0.7),
    ...hornFaces(3, 2.2, 5.6, 2.2, 3.2, 5.4, 0.5),
    ...hornFaces(-1.9, 0.8, 5.9, -3, 2.2, 5.6, 0.7),
    ...hornFaces(-3, 2.2, 5.6, -2.2, 3.2, 5.4, 0.5),
    // 옆 잔다리.
    ...hornFaces(2.4, -0.6, 5.7, 3.6, -1.2, 5, 0.45),
    ...hornFaces(-2.4, -0.6, 5.7, -3.6, -1.2, 5, 0.45),
    ...hornFaces(2.2, -1.4, 5.7, 3.2, -2.2, 5, 0.45),
    ...hornFaces(-2.2, -1.4, 5.7, -3.2, -2.2, 5, 0.45),
  ],
  /* 디바우러(실물 참고) — 판갑으로 덮인 큰 공 몸통, 그 아래로 골진 배가 앞으로 말려
     들어가고, 앞 옆에서 흰 뿔 한 쌍이 위로 젖혀진다. */
  devourer: () => [
    // 골진 배 — 몸 아래에서 앞으로 말리는 마디들.
    ...domeFaces3(0, 1.5, 1.15, 0.9, 4.4),
    ...domeFaces3(0, 2, 0.95, 0.75, 3.8),
    ...domeFaces3(0, 2.2, 0.75, 0.6, 3.3),
    // 판갑 공 몸 — 크게 둥글게, 등판 이음선 하나.
    ...domeFaces3(0, -0.4, 2.25, 2.05, 4.8),
    sideFace(polyPath3([[0, -2.6, 5], [0, -2.4, 6.4], [0, 1.7, 5.6], [0.16, 1.7, 5.6], [0.16, -2.4, 6.4], [0.16, -2.6, 5]]), 0.16),
    // 흰 뿔 한 쌍 — 앞 옆에서 위-뒤로 젖혀진다.
    ...hornFaces(1.4, 1, 5.9, 2.4, -0.8, 8.1, 0.6),
    ...hornFaces(-1.4, 1, 5.9, -2.4, -0.8, 8.1, 0.6),
    // 앞 아래 작은 턱.
    ...hornFaces(0.5, 2.1, 4.5, 0.8, 3, 3.9, 0.4),
    ...hornFaces(-0.5, 2.1, 4.5, -0.8, 3, 3.9, 0.4),
  ],
  /* 스커지 — 작은 몸 + 날개 한 쌍. */
  scourge: () => {
    const wing = (m: 1 | -1): string => polyPath3([
      [m * 0.5, 0.2, 6.3], [m * 2, 1.2, 6], [m * 1.4, -0.6, 6.1],
    ]);
    return [
      ...domeFaces3(0, 0, 0.75, 0.65, 5.9),
      bodyFace(wing(1)), sideFace(wing(1), 0.16),
      bodyFace(wing(-1)), topFace(wing(-1), 0.14),
    ];
  },
  /* 퀸(정정 셋) — 더듬이 없이, 전갈처럼 위로 솟아 앞으로 휘는 꼬리. 다리 여섯은
     60도 간격으로 골고루 퍼지되 너무 처지지 않고, 다리 끝까지 갈퀴막이 이어진다. */
  queen: () => {
    const spot = (sx2: number, sy2: number): ShapeFace => {
      const [px2, py2] = project(sx2, sy2, 7);
      return capFace(groundEllipse(px2, py2, 0.28, 0.22), 0.35);
    };
    const P = (ang: number, r: number): [number, number] => {
      const a = (ang * Math.PI) / 180;
      return [Math.sin(a) * r, Math.cos(a) * r];
    };
    const out: ShapeFace[] = [];
    // 갈퀴막 — 이웃 다리 끝까지 잇는 여섯 폭 치마.
    for (let i = 0; i < 6; i += 1) {
      const a1 = i * 60 + 30;
      const [x1, y1] = P(a1, 1.2);
      const [t1x, t1y] = P(a1, 2.4);
      const [x2, y2] = P(a1 + 60, 1.2);
      const [t2x, t2y] = P(a1 + 60, 2.4);
      const web = polyPath3([[x1, y1, 5.1], [t1x, t1y, 4.05], [t2x, t2y, 4.05], [x2, y2, 5.1]]);
      out.push(bodyFace(web), sideFace(web, 0.15));
    }
    // 다리 여섯 — 막의 뼈대.
    for (let i = 0; i < 6; i += 1) {
      const [x1, y1] = P(i * 60 + 30, 1.2);
      const [t1x, t1y] = P(i * 60 + 30, 2.45);
      out.push(...hornFaces(x1, y1, 5.2, t1x, t1y, 4, 0.65));
    }
    out.push(...domeFaces3(0, -1.1, 1.95, 1.75, 5.3));
    out.push(spot(-0.6, -1.5), spot(0.4, -1.9), spot(0.1, -0.9));
    out.push(...domeFaces3(0, 0.7, 1.2, 0.9, 5.5));
    // 전갈 꼬리 — 뒤에서 솟아 앞으로 휜다.
    out.push(...hornFaces(0, -2.2, 5.9, 0, -3, 7.8, 0.7));
    out.push(...hornFaces(0, -3, 7.7, 0, -1.6, 9.2, 0.55));
    out.push(...hornFaces(0, -1.6, 9.1, 0, -0.4, 8.8, 0.45));
    // 큰 집게 한 쌍.
    out.push(...hornFaces(1.3, 1, 5.8, 2.6, 2.2, 5.6, 0.95));
    out.push(...hornFaces(2.6, 2.2, 5.6, 1.9, 3.5, 5.2, 0.7));
    out.push(...hornFaces(-1.3, 1, 5.8, -2.6, 2.2, 5.6, 0.95));
    out.push(...hornFaces(-2.6, 2.2, 5.6, -1.9, 3.5, 5.2, 0.7));
    return out;
  },
  /* 커세어(정정) — 몸통을 줄이고, 양팔과 아래 꼬리 포드가 모두 앞을 향해 뻗는 느낌. */
  corsair: () => {
    const [e1x, e1y] = project(-0.85, -1.5, 5.6);
    const [e2x, e2y] = project(0.85, -1.5, 5.6);
    return [
      // 각진 방패 몸 — 한 단 작게.
      bodyFace(polyPath3([
        [0, 2.1, 5.9], [1.6, 1, 5.95], [2, -0.7, 5.85], [0.9, -1.7, 5.8],
        [-0.9, -1.7, 5.8], [-2, -0.7, 5.85], [-1.6, 1, 5.95],
      ])),
      topFace(polyPath3([[0, 2.1, 5.9], [-1.6, 1, 5.95], [-1.1, -0.3, 5.9], [0, 0.3, 5.92]]), 0.18),
      sideFace(polyPath3([[0, 2.1, 5.9], [1.6, 1, 5.95], [2, -0.7, 5.85], [0.85, -0.15, 5.9]]), 0.18),
      // 양팔 — 몸 뒤에서 나와 앞으로 길게 뻗는다.
      ...hornFaces(1.5, -0.6, 5.9, 2.3, 2.9, 5.55, 0.7),
      ...hornFaces(-1.5, -0.6, 5.9, -2.3, 2.9, 5.55, 0.7),
      // 콕핏 혹.
      ...domeFaces3(0, 0.4, 0.7, 0.55, 6.05),
      // 뒤 발광 엔진 둘.
      topFace(groundEllipse(e1x, e1y, 0.45, 0.36), 0.5),
      topFace(groundEllipse(e2x, e2y, 0.45, 0.36), 0.5),
      // 아래 꼬리 포드 — 앞으로 기운 캡슐.
      ...hornFaces(0, -0.6, 5.5, 0, -0.8, 4.1, 0.22),
      ...tubeFaces(0, -1.2, 0, 1.6, 0.32, 3.6),
    ];
  },
  /* 스카웃(실물 참고) — 길고 홀쭉한 금빛 코 몸통, 뒤로 젖힌 큰 날개 두 장, 뒤 엔진
     꽁무니 둘, 콕핏 혹. 날개는 몸보다 뒤에 달린다. */
  scout: () => {
    const hull = polyPath3([
      [0, 4.6, 6.05], [0.75, 2, 6.1], [0.95, -2.2, 6], [-0.95, -2.2, 6], [-0.75, 2, 6.1],
    ]);
    const wingL = polyPath3([[-0.9, 0.2, 6], [-3.4, -2.6, 5.7], [-1.9, -2.9, 5.8], [-0.9, -1.4, 6]]);
    const wingR = polyPath3([[0.9, 0.2, 6], [3.4, -2.6, 5.7], [1.9, -2.9, 5.8], [0.9, -1.4, 6]]);
    return [
      ...tubeFaces(-0.55, -3.1, -0.55, -2, 0.3, 5.9),
      ...tubeFaces(0.55, -3.1, 0.55, -2, 0.3, 5.9),
      bodyFace(wingL), topFace(wingL, 0.16),
      bodyFace(wingR), sideFace(wingR, 0.18),
      bodyFace(hull), topFace(hull, 0.16),
      ...domeFaces3(0, 0.9, 0.6, 0.5, 6.3),
    ];
  },
  /* 캐리어(정정 넷: 마주 보며 감싸기) — 옆 꽃잎 두 장은 바깥 가장자리가 말려 올라
     가운데를 향해 오므리고, 위 꽃잎이 그 사이를 덮는다 — 세 면이 감싸 안는 봉오리. */
  carrier: () => {
    const petal = (cx2: number, m2: 0 | 1 | -1, z0: number, xr: number, yr: number): string => polyPath3(
      Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        const co = Math.cos(a);
        return [
          cx2 + co * xr,
          0.3 + Math.sin(a) * yr,
          z0 - Math.sin(a) * 0.28 + (m2 !== 0 ? Math.max(0, m2 * co) * 1.35 : 0),
        ] as [number, number, number];
      }),
    );
    return [
      bodyFace(petal(-1.3, -1, 5.1, 1.05, 3.9)),
      topFace(petal(-1.3, -1, 5.1, 1.05, 3.9), 0.16),
      bodyFace(petal(1.3, 1, 5.1, 1.05, 3.9)),
      sideFace(petal(1.3, 1, 5.1, 1.05, 3.9), 0.18),
      bodyFace(petal(0, 0, 6.5, 1.05, 4.1)),
      topFace(petal(0, 0, 6.5, 1.05, 4.1), 0.1),
    ];
  },
  /* 아비터(정정 둘) — 작은 몸체 양옆에 긴 타원형 날개가 방패처럼 뒤를 향해 길게
     붙는다. 모형 공간 타원(10각 근사)이라 방향이 정확히 뒤로 눕는다. */
  arbiter: () => {
    const oval = (m2: 1 | -1): string => polyPath3(
      Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2;
        return [
          m2 * 1.7 + Math.cos(a) * 1.05,
          -1 + Math.sin(a) * 2.9,
          6.05 - Math.sin(a) * 0.25,
        ] as [number, number, number];
      }),
    );
    const [cx2, cy2] = project(0, 1.9, 5.7);
    return [
      bodyFace(oval(-1)), topFace(oval(-1), 0.16),
      bodyFace(oval(1)), sideFace(oval(1), 0.18),
      // 몸체는 구(지적: 곤충 같음) — 동그란 공 하나에 하이라이트만.
      ...domeFaces3(0, 0.5, 1.15, 1.05, 5.3),
      topFace(groundEllipse(cx2 - 0.3, cy2 - 0.5, 0.4, 0.32), 0.35),
    ];
  },
  /* 옵저버(실물 참고) — 작은 금빛 공 몸통 좌우에 둥근 귀 덩이, 위엔 부챗살 볏 돛,
     앞엔 렌즈 고리. */
  observer: () => {
    const [tx3, ty3] = project(0, -0.3, 6.9);
    const [lx2, ly2] = project(0, 1.05, 5.95);
    return [
      // 좌우 귀 덩이.
      ...domeFaces3(-1.15, -0.3, 0.62, 0.55, 5.55),
      ...domeFaces3(1.15, -0.3, 0.62, 0.55, 5.55),
      // 몸통 공.
      ...domeFaces3(0, 0, 0.98, 0.9, 5.5),
      // 위 부챗살 볏 돛 — 선 반원 + 부챗살 두 줄.
      bodyFace(`M${tx3 - 1} ${ty3} A1 0.95 0 0 1 ${tx3 + 1} ${ty3} Z`),
      sideFace(`M${tx3 - 0.35} ${ty3} L${tx3 - 0.28} ${ty3 - 0.88} L${tx3 - 0.18} ${ty3 - 0.9} L${tx3 - 0.24} ${ty3} Z`, 0.2),
      sideFace(`M${tx3 + 0.3} ${ty3} L${tx3 + 0.42} ${ty3 - 0.82} L${tx3 + 0.52} ${ty3 - 0.78} L${tx3 + 0.4} ${ty3} Z`, 0.2),
      // 앞 렌즈 고리.
      capFace(groundEllipse(lx2, ly2, 0.34, 0.3), 0.4),
      topFace(groundEllipse(lx2 - 0.1, ly2 - 0.1, 0.13, 0.11), 0.5),
    ];
  },
  /* 컴샛 스테이션(스캔 애드온, 요청) — 낮은 몸체 위 기울어진 접시 안테나와 침. */
  comsat: () => {
    const [dx3, dy3] = project(0.3, -0.4, 5.2);
    return [
      ...boxFaces3(0, 0.2, 5.6, 4.4, 2.6),
      ...cylinderFaces3(0.3, -0.4, 0.5, 1.6, 2.6),
      bodyFace(groundEllipse(dx3, dy3, 2, 1)),
      topFace(groundEllipse(dx3, dy3, 1.5, 0.7), 0.2),
      capFace(groundEllipse(dx3, dy3, 0.4, 0.22), 0.35),
      ...hornFaces(0.3, -0.4, 5.2, 0.7, 0.3, 6.8, 0.2),
    ];
  },
  /* 핵 사일로(요청) — 받침 위 둥근 사일로 통과 돔 뚜껑, 해치 씸. */
  nsilo: () => [
    ...boxFaces3(0, 0.2, 5.6, 4.4, 1.6),
    ...cylinderFaces3(0, 0, 2.3, 2.4, 1.6),
    ...domeFaces3(0, 0, 2.3, 1.5, 4),
    capFace(discPath3(0, 0, 4.05, 1.6), 0.22),
    topFace(discPath3(0, 0, 5.1, 0.75), 0.3),
    capFace(discPath3(0, 0, 5.13, 0.4), 0.35),
  ],
  /* ── 공사 표현 공용 셋(요청: 아이콘 대신 모델) ───────────────────────────── */
  /* 저그 고치 — 크립 위 통통한 번데기(재생 쪽 CSS가 바운스시킨다). */
  cocoon: () => [
    ...creepSplat(4.4),
    ...domeFaces3(0, 0.3, 2.6, 3.2),
    ...domeFaces3(0, 1.1, 1.9, 1.5),
    capFace(polyPath3([[-1.9, 0.5, 2.1], [1.9, 0.5, 2.1], [1.7, 0.3, 2.5], [-1.7, 0.3, 2.5]]), 0.18),
    capFace(polyPath3([[-1.5, 1.3, 1.2], [1.5, 1.3, 1.2], [1.35, 1.1, 1.6], [-1.35, 1.1, 1.6]]), 0.18),
    ...hornFaces(0, -1.8, 3, 0.4, -2.6, 4.4, 0.6),
  ],
  /* 프로토스 소환구 — 겹겹의 빛 고리와 중심 빛기둥. 다 지어지면 건물이 드러난다. */
  warpin: () => {
    const [cx, cy] = project(0, 0, 0.4);
    return [
      bodyFace(groundEllipse(cx, cy, 4.6, 2.2)),
      topFace(groundEllipse(cx, cy, 4, 1.9), 0.2),
      capFace(groundEllipse(cx, cy, 3, 1.4), 0.3),
      topFace(groundEllipse(cx, cy, 2, 0.95), 0.35),
      [`M${cx - 0.75} ${cy} L${cx - 0.25} ${cy - 5.8} L${cx + 0.25} ${cy - 5.8} L${cx + 0.75} ${cy} Z`, 0.45, "#fff"] as ShapeFace,
      topFace(groundEllipse(cx, cy, 0.9, 0.45), 0.5),
    ];
  },
  /* 테란 공사장 — 기초 슬래브 + 뼈대 기둥 넷 + 가로 보 + 크레인. */
  scaffold: () => [
    ...boxFaces3(0, 0, 7, 5, 0.8),
    ...boxFaces3(-2.9, 1.9, 0.5, 0.5, 3.4, 0.8),
    ...boxFaces3(2.9, 1.9, 0.5, 0.5, 3.4, 0.8),
    ...boxFaces3(-2.9, -1.9, 0.5, 0.5, 3.4, 0.8),
    ...boxFaces3(2.9, -1.9, 0.5, 0.5, 3.4, 0.8),
    ...boxFaces3(0, 1.9, 6.2, 0.4, 0.4, 4.2),
    ...boxFaces3(0, -1.9, 6.2, 0.4, 0.4, 4.2),
    // 크레인 — 기둥 + 지브 + 갈고리 줄.
    ...boxFaces3(2.3, -1.5, 0.45, 0.45, 6.4, 0.8),
    bodyFace(polyPath3([[2.3, -1.7, 7.2], [-0.9, -1.7, 6.9], [-0.9, -1.5, 6.9], [2.3, -1.3, 7.2]])),
    ...hornFaces(-0.7, -1.6, 6.9, -0.7, -1.6, 5.2, 0.16),
  ],

  /* SCV(실물 참고) — 각진 몸통 + 양옆 포드 + 위 머리 + 앞으로 굽는 집게 드릴 한 쌍. */
  scv: () => [
    ...boxFaces3(0, -0.4, 2.6, 2.4, 2.6, 3.4),
    ...boxFaces3(-2.2, -0.2, 1.3, 1.8, 1.9, 3.6),
    ...boxFaces3(2.2, -0.2, 1.3, 1.8, 1.9, 3.6),
    ...domeFaces3(0, -0.6, 0.9, 0.7, 6),
    // 팔·다리는 지면과 평행(정정) — 팔 한 쌍은 넓게 벌려 위에, 다리 한 쌍은 모아 아래에.
    // 팔다리 길이 축소(지적).
    ...boxFaces3(-2.5, 1.2, 1.05, 1.8, 1.05, 4.1),
    ...boxFaces3(2.5, 1.2, 1.05, 1.8, 1.05, 4.1),
    ...boxFaces3(-0.85, 1.4, 0.95, 1.7, 0.95, 2.3),
    ...boxFaces3(0.85, 1.4, 0.95, 1.7, 0.95, 2.3),
  ],
  /* 프로브(실물 참고) — 팔각 보석 몸(밝은 윗판 층층) + 방사 가시들. */
  probe: () => {
    const out: ShapeFace[] = [];
    /* 다리를 납작한 날개판으로(지적: 원통·원뿔이 아니라 비행기 날개 같은 형태) —
       윗판(넓적한 사다리꼴) + 바깥 모서리의 얇은 두께면. 옆다리는 뺐다(지적). */
    const wing = (
      ang: number, r0: number, len: number, wRoot: number, wTip: number, z0: number, z1: number,
    ): ShapeFace[] => {
      const a = (ang * Math.PI) / 180;
      const dx = Math.sin(a);
      const dy = Math.cos(a);
      const nx = Math.cos(a);
      const ny = -Math.sin(a);
      const rx = dx * r0;
      const ryy = dy * r0;
      const tx = dx * (r0 + len);
      const ty = dy * (r0 + len);
      const dTop = polyPath3([
        [rx - nx * wRoot, ryy - ny * wRoot, z0],
        [rx + nx * wRoot, ryy + ny * wRoot, z0],
        [tx + nx * wTip, ty + ny * wTip, z1],
        [tx - nx * wTip, ty - ny * wTip, z1],
      ]);
      const dEdge = polyPath3([
        [rx + nx * wRoot, ryy + ny * wRoot, z0],
        [tx + nx * wTip, ty + ny * wTip, z1],
        [tx + nx * wTip, ty + ny * wTip, z1 - 0.28],
        [rx + nx * wRoot, ryy + ny * wRoot, z0 - 0.34],
      ]);
      return [bodyFace(`${dTop} ${dEdge}`), topFace(dTop, 0.18), sideFace(dEdge, 0.3)];
    };
    // 뒤 위 날개 한 쌍 + 뒤 아래로 처지는 날개 한 쌍(옆다리는 제거 — 지적).
    for (const ang of [168, 192]) out.push(...wing(ang, 1, 1.9, 0.5, 0.22, 4.6, 3.8));
    for (const ang of [138, 222]) out.push(...wing(ang, 1, 2.2, 0.55, 0.25, 4.5, 2.4));
    /* 몸통·눈도 모델 공간(수리: 화면 공간이라 돌아도 고정돼 있었다 — 지적) — 팔각도
       눈도 요잉을 따라 함께 돈다. */
    const oct = (r: number, z: number): string => polyPath3(
      Array.from({ length: 8 }, (_, i) => {
        const a = ((i * 45 + 22.5) * Math.PI) / 180;
        return [Math.cos(a) * r, Math.sin(a) * r, z] as [number, number, number];
      }),
    );
    out.push(bodyFace(oct(2, 4.6)));
    out.push(topFace(oct(1.35, 4.85), 0.26));
    out.push(topFace(oct(0.8, 5.1), 0.3));
    // 동그란 눈 두 개 — 흰색으로(지적), 정면(+y)에 붙어 같이 돈다.
    const [e1x, e1y] = project(-0.75, 1.85, 4.7);
    const [e2x, e2y] = project(0.75, 1.85, 4.7);
    out.push(topFace(groundEllipse(e1x, e1y, 0.42, 0.4), 0.88));
    out.push(topFace(groundEllipse(e2x, e2y, 0.42, 0.4), 0.88));
    // 옆면 둥근 포트(실물 참고) — 앞옆 비스듬한 면의 원형 해치 한 쌍.
    const [p1x, p1y] = project(-1.75, 0.7, 4.75);
    const [p2x, p2y] = project(1.75, 0.7, 4.75);
    out.push(topFace(groundEllipse(p1x, p1y, 0.34, 0.3), 0.3));
    out.push(topFace(groundEllipse(p2x, p2y, 0.34, 0.3), 0.3));
    // 앞다리 한 쌍 — 몸에 딱 붙여 더 가늘고 짧게(지적), 이것도 납작한 날개판.
    for (const ang of [14, -14]) out.push(...wing(ang, 0.9, 0.9, 0.26, 0.13, 4.15, 3.15));
    return out;
  },
  /* 드론(정정) — 갈퀴치마는 집게 사이가 아니라 집게팔과 꼬리 사이, 양옆에 부채처럼
     펼쳐진다. 몸통(꼬리 겹돔) + 칼날팔 한 쌍 + 양옆 톱니 부채막. */
  drone: () => {
    // 치마는 지면과 수평(지적) — 높이를 한 값(3.4)으로 편다.
    const fan = (m: 1 | -1): string => polyPath3([
      [m * 1.5, 0.6, 3.4],
      [m * 2.6, 2.2, 3.4], [m * 2.3, 1.2, 3.4],
      [m * 3.2, 0.4, 3.4], [m * 2.6, -0.4, 3.4],
      [m * 3.3, -1.4, 3.4], [m * 2.2, -2.2, 3.4],
      [m * 0.9, -3, 3.4],
    ]);
    return [
      bodyFace(fan(1)), sideFace(fan(1), 0.16),
      bodyFace(fan(-1)), sideFace(fan(-1), 0.13),
      ...domeFaces3(0, -2.1, 1.5, 1.2, 3.5),
      ...domeFaces3(0, -0.7, 2, 1.7, 3.5),
      // 팔도 다른 갈고리와 같은 휘어진 낫 날(지적).
      ...claw3(1, 0.7, 4),
      ...claw3(-1, 0.7, 4),
    ];
  },

  /* ── 유닛 상징물(요청: 유닛 마커도 방향을 갖게 기본 3D화) — 정면은 +y. 세밀한 움직임
     대신 정체를 말하는 상징물이다. 회전 중심(8,8) 근처에 몸이 오도록 공중에 띄워 깎는다. */
  /* 메딕(실물 참고) — 같은 파워드 아머에 밝은 열린 얼굴, 앞으로 드리운 흰 앞치마
     자락, 오른팔의 주사기. */
  inf: () => {
    const [fx2, fy2] = project(0, 0.5, 4.55);
    const apron = polyPath3([[-0.5, 1.05, 2.9], [0.5, 1.05, 2.9], [0.35, 1.2, 0.9], [-0.35, 1.2, 0.9]]);
    return [
      ...cylinderFaces3(-0.6, -0.2, 0.5, 1.7, 0.2),
      ...cylinderFaces3(0.6, -0.2, 0.5, 1.7, 0.2),
      ...cylinderFaces3(0, -0.2, 1.25, 2.1, 1.9),
      ...domeFaces3(-1.5, -0.3, 0.95, 0.85, 3.6),
      ...domeFaces3(1.5, -0.3, 0.95, 0.85, 3.6),
      ...domeFaces3(0, -0.2, 0.8, 0.7, 4.2),
      topFace(groundEllipse(fx2, fy2, 0.4, 0.34), 0.45),
      bodyFace(apron),
      topFace(apron, 0.3),
      // 오른팔 주사기.
      ...tubeFaces(1.35, 0.3, 1.35, 1.4, 0.3, 3),
      ...hornFaces(1.35, 1.4, 3.1, 1.35, 2.2, 3, 0.16),
    ];
  },
  /* 마린(실물 참고) — 큰 어깨 뽕 한 쌍의 파워드 아머, 금빛 바이저 머리, 가슴 앞에
     가로로 든 가우스 소총. */
  gunner: () => {
    const [vx2, vy2] = project(0, 0.55, 4.7);
    const [mx2, my2] = project(1.75, 1.15, 3.35);
    return [
      ...cylinderFaces3(-0.6, -0.2, 0.5, 1.7, 0.2),
      ...cylinderFaces3(0.6, -0.2, 0.5, 1.7, 0.2),
      ...cylinderFaces3(0, -0.2, 1.25, 2.1, 1.9),
      ...domeFaces3(-1.5, -0.3, 0.95, 0.85, 3.6),
      ...domeFaces3(1.5, -0.3, 0.95, 0.85, 3.6),
      ...domeFaces3(0, -0.2, 0.8, 0.7, 4.2),
      topFace(groundEllipse(vx2, vy2, 0.42, 0.3), 0.5),
      // 가로 가우스 소총.
      ...boxFaces3(0.3, 1.15, 2.7, 0.7, 0.7, 3),
      capFace(groundEllipse(mx2, my2, 0.22, 0.18), 0.4),
    ];
  },
  /* 파이어뱃(실물 참고) — 같은 파워드 아머에 어깨 위로 보이는 등 연료통 둘, 어두운
     바이저 슬릿, 앞으로 내민 굵은 화염 건틀릿 두 팔. */
  fbat: () => {
    const [vx2, vy2] = project(0, 0.55, 4.7);
    const noz = (tx: number): ShapeFace => {
      const [px2, py2] = project(tx, 1.6, 2.95);
      return capFace(groundEllipse(px2, py2 - 0.19, 0.3, 0.24), 0.4);
    };
    return [
      // 등 연료통 둘 — 먼저 그려 어깨가 뿌리를 덮는다.
      ...cylinderFaces3(-0.7, -1.3, 0.5, 2.4, 3.2),
      ...domeFaces3(-0.7, -1.3, 0.5, 0.4, 5.6),
      ...cylinderFaces3(0.7, -1.3, 0.5, 2.4, 3.2),
      ...domeFaces3(0.7, -1.3, 0.5, 0.4, 5.6),
      ...cylinderFaces3(-0.6, -0.2, 0.5, 1.7, 0.2),
      ...cylinderFaces3(0.6, -0.2, 0.5, 1.7, 0.2),
      ...cylinderFaces3(0, -0.2, 1.25, 2.1, 1.9),
      ...domeFaces3(-1.5, -0.3, 0.95, 0.85, 3.6),
      ...domeFaces3(1.5, -0.3, 0.95, 0.85, 3.6),
      ...domeFaces3(0, -0.2, 0.8, 0.7, 4.2),
      capFace(groundEllipse(vx2, vy2, 0.4, 0.22), 0.4),
      // 화염 건틀릿 두 팔.
      ...tubeFaces(-1.4, 0.4, -1.4, 1.6, 0.42, 2.9),
      noz(-1.4),
      ...tubeFaces(1.4, 0.4, 1.4, 1.6, 0.42, 2.9),
      noz(1.4),
    ];
  },
  /* 질럿 — 검 두 자루(요청). */
  zealot: () => [
    ...cylinderFaces3(0, -0.4, 1.4, 3.4, 3.4),
    ...domeFaces3(0, -0.9, 1.2, 0.95, 6.8),
    // 프로토스 특유의 길쭉한 머리(요청) — 뒤로 흐르는 타원 볏.
    ...hornFaces(0, -1.3, 7.2, 0, -3, 7.9, 0.7),
    // 어깨 뽕 한 쌍(실물).
    ...domeFaces3(-1.35, -0.2, 0.62, 0.5, 6),
    ...domeFaces3(1.35, -0.2, 0.62, 0.5, 6),
    // 사이오닉 검 — 팔뚝에서 앞-아래로, 빛나는 날.
    ...hornFaces(1.7, 0.3, 4.7, 2.4, 1.4, 1, 0.7),
    topFace(polyPath3([[1.75, 0.45, 4.5], [2.35, 1.35, 1.15], [2.2, 1.25, 1.1], [1.6, 0.4, 4.4]]), 0.45),
    ...hornFaces(-1.7, 0.3, 4.7, -2.4, 1.4, 1, 0.7),
    topFace(polyPath3([[-1.75, 0.45, 4.5], [-2.35, 1.35, 1.15], [-2.2, 1.25, 1.1], [-1.6, 0.4, 4.4]]), 0.45),
  ],
  /* 다크 템플러 — 검 한 자루(요청). */
  dtemp: () => [
    // 망토(요청) — 어깨 뒤에서 제비꼬리로 드리운다. 몸이 앞을 덮게 먼저 그린다.
    bodyFace(polyPath3([
      [-1.3, -0.9, 6.2], [1.3, -0.9, 6.2], [1.9, -1.8, 3.2],
      [0.6, -1.5, 3.7], [0, -1.7, 3.2], [-0.6, -1.5, 3.7], [-1.9, -1.8, 3.2],
    ])),
    sideFace(polyPath3([
      [-1.3, -0.9, 6.2], [1.3, -0.9, 6.2], [1.9, -1.8, 3.2],
      [0.6, -1.5, 3.7], [0, -1.7, 3.2], [-0.6, -1.5, 3.7], [-1.9, -1.8, 3.2],
    ]), 0.18),
    ...cylinderFaces3(0, -0.4, 1.4, 3.4, 3.4),
    ...domeFaces3(0, -0.9, 1.2, 0.95, 6.8),
    // 프로토스 길쭉한 머리(요청).
    ...hornFaces(0, -1.3, 7.2, 0, -3, 7.9, 0.7),
    // 등 볏 칼날 한 쌍(실물) — 뒤 위로 쓸려 올라간다.
    ...hornFaces(-0.4, -1, 6.6, -1.6, -2.4, 8.9, 0.55),
    ...hornFaces(0.4, -1, 6.6, 1.3, -2.6, 8.5, 0.5),
    // 낫 검 한 자루 — 오른 옆구리에서 아래로, 빛나는 날.
    ...hornFaces(1.7, 0.3, 4.7, 2.4, 1.5, 0.9, 0.75),
    topFace(polyPath3([[1.75, 0.45, 4.5], [2.35, 1.45, 1.05], [2.2, 1.35, 1], [1.6, 0.4, 4.4]]), 0.45),
  ],
  /* 하이 템플러(요청) — 떠 있는 로브: 바닥에서 띄운 짧은 로브 통 + 머리, 발밑 부양 빛. */
  htemp: () => {
    const [gx, gy] = project(0, 0.2, 3.2);
    return [
      topFace(groundEllipse(gx, gy, 1.6, 0.8), 0.3),
      // 어두운 망토 — 몸 뒤로 드리운다.
      bodyFace(polyPath3([[-1.1, -0.8, 6.6], [1.1, -0.8, 6.6], [1.6, -1.6, 3.6], [-1.6, -1.6, 3.6]])),
      sideFace(polyPath3([[-1.1, -0.8, 6.6], [1.1, -0.8, 6.6], [1.6, -1.6, 3.6], [-1.6, -1.6, 3.6]]), 0.22),
      ...cylinderFaces3(0, -0.3, 1.3, 2.4, 4.4),
      ...domeFaces3(0, -0.7, 1.05, 0.85, 6.8),
      // 프로토스 길쭉한 머리(요청).
      ...hornFaces(0, -1.1, 7.1, 0, -2.7, 7.8, 0.65),
      /* 초승달 후광(실물) — 머리 뒤에서 좌우로 감아 올라 마주 보는 큰 호. */
      ...hornFaces(-0.8, -1, 7, -1.4, -1.2, 9.4, 0.4),
      ...hornFaces(-1.4, -1.2, 9.3, -0.35, -1.35, 10.2, 0.3),
      ...hornFaces(0.8, -1, 7, 1.4, -1.2, 9.4, 0.4),
      ...hornFaces(1.4, -1.2, 9.3, 0.35, -1.35, 10.2, 0.3),
      // 두 손을 들고 다닌다(요청) — 어깨에서 위-앞으로 든 팔 한 쌍.
      ...hornFaces(1.1, 0.5, 5.8, 1.8, 1.3, 7.9, 0.5),
      ...hornFaces(-1.1, 0.5, 5.8, -1.8, 1.3, 7.9, 0.5),
    ];
  },
  /* 드라군(실물 참고) — 크고 둥근 금빛 껍데기 몸(앞 해치 슬릿), 굵게 꺾인 네 다리. */
  goon: () => {
    const leg = (m2: 1 | -1, fy: number): ShapeFace[] => [
      ...hornFaces(m2 * 1.5, fy, 4.2, m2 * 3, fy * 1.35, 5.2, 0.85),
      ...hornFaces(m2 * 3, fy * 1.35, 5.2, m2 * 3.6, fy * 1.55, 0.4, 0.7),
    ];
    const [gx2, gy2] = project(-0.8, -0.8, 5.7);
    return [
      ...leg(-1, -1.5), ...leg(1, -1.5),
      ...domeFaces3(0, -0.2, 2.4, 2.3, 3.8),
      capFace(polyPath3([[-0.7, 1.95, 4.7], [0.7, 1.95, 4.7], [0.5, 2.15, 4.1], [-0.5, 2.15, 4.1]]), 0.4),
      topFace(groundEllipse(gx2, gy2, 0.9, 0.6), 0.25),
      ...leg(-1, 1.3), ...leg(1, 1.3),
    ];
  },
  /* 아콘(실물 참고) — 반투명 발광 구 속에 어두운 형체가 비친다: 뾰족한 머리, 몸통,
     길게 늘어지는 두 팔. */
  archon: () => {
    const [cx, cy] = project(0, 0, 5);
    return [
      [groundEllipse(cx, cy, 3.6, 3.4), 0.55] as ShapeFace,
      topFace(groundEllipse(cx, cy, 3.6, 3.4), 0.3),
      // 구 속 형체.
      capFace(`M${cx} ${cy - 2.5} L${cx + 0.55} ${cy - 1.5} L${cx - 0.5} ${cy - 1.45} Z`, 0.4),
      capFace(groundEllipse(cx, cy - 0.4, 0.75, 1.15), 0.35),
      capFace(`M${cx - 0.6} ${cy - 1.2} Q${cx - 1.9} ${cy - 0.4} ${cx - 1.6} ${cy + 1.3}`
        + ` L${cx - 1.3} ${cy + 1.2} Q${cx - 1.4} ${cy - 0.2} ${cx - 0.4} ${cy - 0.8} Z`, 0.35),
      capFace(`M${cx + 0.6} ${cy - 1.2} Q${cx + 1.9} ${cy - 0.2} ${cx + 1.5} ${cy + 1.5}`
        + ` L${cx + 1.2} ${cy + 1.4} Q${cx + 1.4} ${cy} ${cx + 0.4} ${cy - 0.8} Z`, 0.35),
      topFace(groundEllipse(cx - 1.2, cy - 1.2, 1.3, 1), 0.4),
    ];
  },
  /* 다크 아콘(실물 참고) — 어두운 반투명 구 속에 뿔귀 머리와 갈퀴 팔의 형체가 비치고,
     구 밖으로 가는 수염 호가 흩날린다. */
  darchon: () => {
    const [cx, cy] = project(0, 0, 5);
    return [
      [groundEllipse(cx, cy, 3.6, 3.4), 0.55] as ShapeFace,
      capFace(groundEllipse(cx, cy, 3.6, 3.4), 0.25),
      // 속 형체 — 뿔귀 둘·몸·아래로 늘어지는 갈퀴 팔.
      capFace(`M${cx - 0.1} ${cy - 2.2} L${cx + 0.95} ${cy - 0.95} L${cx + 0.1} ${cy - 0.85} Z`, 0.45),
      capFace(`M${cx - 1.25} ${cy - 1.75} L${cx - 0.3} ${cy - 0.9} L${cx - 1.05} ${cy - 0.65} Z`, 0.45),
      capFace(groundEllipse(cx - 0.15, cy + 0.1, 0.7, 1), 0.4),
      capFace(`M${cx - 0.5} ${cy + 0.6} Q${cx - 1.3} ${cy + 1.2} ${cx - 1.1} ${cy + 2.2}`
        + ` L${cx - 0.8} ${cy + 2.1} Q${cx - 0.95} ${cy + 1.2} ${cx - 0.25} ${cy + 0.8} Z`, 0.4),
      // 바깥 수염 호 — 가늘게 흩날린다.
      topFace(`M${cx - 3.1} ${cy - 1.9} Q${cx - 4.6} ${cy - 0.6} ${cx - 4.1} ${cy + 1}`
        + ` L${cx - 3.9} ${cy + 0.9} Q${cx - 4.3} ${cy - 0.5} ${cx - 2.95} ${cy - 1.75} Z`, 0.4),
      topFace(`M${cx + 2.9} ${cy - 2.2} Q${cx + 4.5} ${cy - 1.4} ${cx + 4.6} ${cy + 0.2}`
        + ` L${cx + 4.4} ${cy + 0.25} Q${cx + 4.2} ${cy - 1.2} ${cx + 2.75} ${cy - 2} Z`, 0.35),
      topFace(groundEllipse(cx - 1.2, cy - 1.2, 1.2, 0.9), 0.3),
    ];
  },
  /* 저글링·히드라·울트라(요청: 전용 모델) — 갈고리는 직선이 아니라 3단으로 휘어진다:
     밖-앞으로 → 앞으로 → 안-아래로 말리는 세 마디. 덩치별로 몸과 갈고리 크기가 다르다. */
  /* 저글링(실물 참고) — 웅크린 네발 몸, 등의 날개 볏 돛 한 쌍, 앞 낮은 턱 머리, 꼬리. */
  zling: () => [
    ...hornFaces(0, -1.6, 3.6, 0, -3.2, 3.3, 0.5),
    ...hornFaces(-0.9, -0.8, 3.6, -1.6, -1.4, 2.1, 0.45),
    ...hornFaces(0.9, -0.8, 3.6, 1.6, -1.4, 2.1, 0.45),
    ...domeFaces3(0, -0.4, 1.3, 1.1, 3.2),
    // 등 날개 볏 — 위로 세운 돛 한 쌍.
    bodyFace(polyPath3([[-0.4, -0.6, 4.2], [-1.5, -1.7, 6.3], [-0.9, -0.2, 5.6], [-0.3, 0, 4.4]])),
    sideFace(polyPath3([[-0.4, -0.6, 4.2], [-1.5, -1.7, 6.3], [-0.9, -0.2, 5.6], [-0.3, 0, 4.4]]), 0.16),
    bodyFace(polyPath3([[0.4, -0.6, 4.2], [1.5, -1.7, 6.3], [0.9, -0.2, 5.6], [0.3, 0, 4.4]])),
    topFace(polyPath3([[0.4, -0.6, 4.2], [1.5, -1.7, 6.3], [0.9, -0.2, 5.6], [0.3, 0, 4.4]]), 0.14),
    ...hornFaces(-0.8, 0.6, 3.4, -1.3, 1.4, 2, 0.4),
    ...hornFaces(0.8, 0.6, 3.4, 1.3, 1.4, 2, 0.4),
    ...domeFaces3(0, 1.2, 0.95, 0.8, 3.1),
    capFace(polyPath3([[-0.45, 2, 3.35], [0.45, 2, 3.35], [0.3, 2.25, 3.15], [-0.3, 2.25, 3.15]]), 0.4),
  ],
  /* 히드라리스크(단순화) — 낮은 받침 꼬리 돔 위에 세운 몸, 낫팔 한 쌍, 작은 머리와
     뒤로 흐르는 두건. */
  hydra: () => {
    const hood = polyPath3([[0.5, 0.3, 7.1], [0.95, -1.5, 8.4], [0, -2.6, 8.7], [-0.95, -1.5, 8.4], [-0.5, 0.3, 7.1]]);
    return [
      ...domeFaces3(0, -0.9, 1.9, 1.3, 3.2),
      ...cylinderFaces3(0, 0, 1.05, 2.9, 3.9),
      ...claw3(1, 0.85, 5),
      ...claw3(-1, 0.85, 5),
      ...domeFaces3(0, 0.2, 0.75, 0.6, 6.8),
      bodyFace(hood),
      topFace(hood, 0.14),
    ];
  },
  /* 울트라리스크(실물 참고) — 코끼리 다리 넷의 거체, 어깨에서 크게 휘는 거대 카이저
     낫 두 자루. */
  ultra: () => [
    ...cylinderFaces3(-2, -2, 0.8, 3, 0.3),
    ...cylinderFaces3(2, -2, 0.8, 3, 0.3),
    ...domeFaces3(0, -0.9, 3.2, 3, 3.4),
    ...domeFaces3(0, 1.6, 2, 1.6, 3.9),
    ...cylinderFaces3(-2.2, 1.1, 0.8, 3, 0.3),
    ...cylinderFaces3(2.2, 1.1, 0.8, 3, 0.3),
    ...claw3(1, 2.1, 5.4),
    ...claw3(-1, 2.1, 5.4),
  ],
  /* 러커(실물 참고) — 넓은 가시 등딱지, 사방으로 벌린 낫 칼다리 두 쌍(끝이 안으로
     말림), 앞 입. */
  lurker: () => {
    const out: ShapeFace[] = [];
    for (const m2 of [1, -1] as const) {
      // 뒤 칼다리.
      out.push(...hornFaces(m2 * 1.5, -0.9, 4, m2 * 3.4, -2.1, 2, 0.7));
      out.push(...hornFaces(m2 * 3.4, -2.1, 2, m2 * 2.7, -3, 0.3, 0.5));
      // 앞 칼다리.
      out.push(...hornFaces(m2 * 1.6, 0.6, 4, m2 * 3.6, 1.7, 2.2, 0.7));
      out.push(...hornFaces(m2 * 3.6, 1.7, 2.2, m2 * 2.9, 2.8, 0.3, 0.5));
    }
    // 넓은 등딱지 + 등 가시들.
    out.push(...domeFaces3(0, -0.2, 2.5, 2, 3.4));
    out.push(...hornFaces(-0.9, -0.9, 5, -1.3, -1.3, 6.2, 0.4));
    out.push(...hornFaces(0.9, -0.9, 5, 1.3, -1.3, 6.2, 0.4));
    out.push(...hornFaces(0, -0.2, 5.4, 0, -0.4, 6.7, 0.45));
    out.push(...hornFaces(-0.7, 0.7, 5, -1, 1, 6, 0.38));
    out.push(...hornFaces(0.7, 0.7, 5, 1, 1, 6, 0.38));
    // 앞 입.
    out.push(...domeFaces3(0, 1.7, 1, 0.75, 3.2));
    out.push(capFace(polyPath3([[-0.5, 2.4, 3.5], [0.5, 2.4, 3.5], [0.35, 2.65, 3.3], [-0.35, 2.65, 3.3]]), 0.42));
    return out;
  },
  /* 디파일러(정정 둘: 바닥을 긴다) — 몸을 낮게 붙이고, 다리는 곧게 서지 않고 옆으로
     넓게 뻗다 끝만 살짝 굽어 땅을 짚는 납작 포복 다리 여섯. */
  defiler: () => [
    ...hornFaces(-1.1, -1.2, 2.2, -2.4, -1.5, 1.1, 0.38),
    ...hornFaces(-2.4, -1.5, 1.1, -3.1, -1.7, 0.1, 0.3),
    ...hornFaces(-1.3, 0, 2.2, -2.7, 0, 1.1, 0.38),
    ...hornFaces(-2.7, 0, 1.1, -3.4, 0, 0.1, 0.3),
    ...hornFaces(-1.1, 1.2, 2.2, -2.4, 1.5, 1.1, 0.38),
    ...hornFaces(-2.4, 1.5, 1.1, -3.1, 1.7, 0.1, 0.3),
    ...hornFaces(1.1, -1.2, 2.2, 2.4, -1.5, 1.1, 0.38),
    ...hornFaces(2.4, -1.5, 1.1, 3.1, -1.7, 0.1, 0.3),
    ...hornFaces(1.3, 0, 2.2, 2.7, 0, 1.1, 0.38),
    ...hornFaces(2.7, 0, 1.1, 3.4, 0, 0.1, 0.3),
    ...hornFaces(1.1, 1.2, 2.2, 2.4, 1.5, 1.1, 0.38),
    ...hornFaces(2.4, 1.5, 1.1, 3.1, 1.7, 0.1, 0.3),
    // 낮게 붙은 몸 — 넓적한 앞몸과 뒤 혹.
    ...domeFaces3(0, 0.3, 1.9, 1.1, 2),
    ...domeFaces3(0, -1.3, 1.5, 1.4, 2.1),
    ...domeFaces3(0, 1.9, 0.7, 0.5, 2),
    ...hornFaces(0.25, 2.4, 2.4, 1.7, 4.5, 3.6, 0.18),
    ...hornFaces(-0.25, 2.4, 2.4, -1.7, 4.5, 3.6, 0.18),
    ...hornFaces(0, -2.5, 2.4, 0.2, -3.4, 4, 0.4),
  ],

  /* 오버로드 — 풍선 몸통(요잉 불변) + 곤충 다리 셋(요청: 촉수·칼이 아니라 무릎이 꺾인
     곤충 다리) — 윗마디는 바깥-아래로, 아랫마디는 무릎에서 안-아래로 꺾인다. */
  ovie: () => {
    const [cx, cy] = project(0, 0, 5.2);
    const legs: string[] = [];
    for (const [lx, lyy] of [[-2.4, 0.6], [0.2, 1.3], [2.6, 0.5]] as [number, number][]) {
      const seg = (
        x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, w: number,
      ): string => {
        const [ax, ay] = project(x1, y1, z1);
        const [bx, by] = project(x2, y2, z2);
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * (w / 2);
        const ny = (dx / len) * (w / 2);
        return `M${ax + nx} ${ay + ny} L${bx + nx} ${by + ny} L${bx - nx} ${by - ny} L${ax - nx} ${ay - ny} Z`;
      };
      // 윗마디: 몸통 밑 → 무릎(바깥으로 벌어짐). 아랫마디: 무릎 → 발끝(안으로 모임).
      const kneeX = lx * 1.55 + (lx === 0.2 ? 0.9 : 0);
      legs.push(seg(lx, lyy, 2.8, kneeX, lyy, 0.4, 0.55));
      legs.push(seg(kneeX, lyy, 0.4, lx * 1.15 + (lx === 0.2 ? 0.4 : 0), lyy, -2.6, 0.42));
    }
    return [
      bodyFace(legs.join(" ")),
      // 머리 축소(지적) + 눈은 앞쪽으로 모은다.
      bodyFace(groundEllipse(cx, cy, 3.6, 3.4)),
      bodyFace(groundEllipse(cx - 2.1, cy + 1.7, 1.25, 1.15)),
      topFace(groundEllipse(cx - 2.35, cy + 1.4, 0.45, 0.4), 0.35),
      bodyFace(groundEllipse(cx + 2.1, cy + 1.7, 1.25, 1.15)),
      sideFace(groundEllipse(cx + 2.1, cy + 1.7, 1.25, 1.15), 0.18),
      topFace(groundEllipse(cx + 1.82, cy + 1.42, 0.45, 0.4), 0.3),
      sideFace(`M${cx + 1.4} ${cy - 3.4} Q${cx + 4.4} ${cy - 1.6} ${cx + 3.4} ${cy + 2.4} Q${cx + 3.9} ${cy - 1} ${cx + 1.4} ${cy - 3.4} Z`, 0.22),
      topFace(groundEllipse(cx - 1.2, cy - 2.2, 1.8, 1.1), 0.35),
    ];
  },
  /* 드랍십(실물 참고) — 양옆 굵은 엔진 포드(앞 단면이 둥글게 보인다) + 가운데 각진
     몸통 + 뒤쪽 수직 꼬리날개. */
  /* 드랍십(다시 셋, 지적) — 완만하게 휘어진 판의 양쪽 끝에 실린더가 달린 꼴: 좌우
     굵은 통 한 쌍과 그 사이를 잇는 활처럼 젖혀진 판. 앞끝은 뭉뚝한 뚜껑, 뒤엔 꼬리. */
  dship: () => {
    const pt = (x: number, y: number, z: number): string => {
      const [px, py] = project(x, y, z);
      return `${px} ${py}`;
    };
    const out: ShapeFace[] = [...hornFaces(0, -2.6, 5, -0.3, -3.6, 7.8, 1)];
    /* 포드는 캡슐 한 덩이(정정: 앞 뭉치가 본체와 떨어져 보였고 검정이 끼었다) —
       양 끝이 둥근 외곽선 하나로 그려 이음매도 어두운 단면도 없다. */
    const pod = (tx: number): void => {
      const [ax2, ay2] = project(tx, -2.8, 3.2);
      const [bx2, by2] = project(tx, 2.6, 3.2);
      const r = 1.4;
      const zr = r * 0.9;
      const dx2 = bx2 - ax2;
      const dy2 = by2 - ay2;
      const L = Math.hypot(dx2, dy2) || 1;
      const nx2 = (-dy2 / L) * r;
      const ny2 = (dx2 / L) * r;
      /* 끝 마감은 A 호가 아니라 축 방향으로 내민 Q 곡선(수리: 이 대각 방향에서 호의
         굽는 쪽이 뒤집혀 몸 안으로 파고들며 별처럼 뚫려 보였다 — 지적). */
      const ux = (dx2 / L) * r * 1.25;
      const uy = (dy2 / L) * r * 1.25;
      out.push(bodyFace(`M${ax2 + nx2} ${ay2 + ny2 - zr} L${bx2 + nx2} ${by2 + ny2 - zr}`
        + ` Q${bx2 + ux} ${by2 + uy - zr} ${bx2 - nx2} ${by2 - ny2 - zr}`
        + ` L${ax2 - nx2} ${ay2 - ny2 - zr}`
        + ` Q${ax2 - ux} ${ay2 - uy - zr} ${ax2 + nx2} ${ay2 + ny2 - zr} Z`));
      out.push(topFace(groundEllipse((ax2 + bx2) / 2 - 0.4, (ay2 + by2) / 2 - zr - 0.2, 0.9, 0.5), 0.2));
    };
    pod(-3.1);
    pod(3.1);
    const plate = `M${pt(-3.1, 0.8, 5.3)} Q${pt(0, 2, 6.1)} ${pt(3.1, 0.8, 5.3)}`
      + ` L${pt(3.1, -1.8, 5.1)} Q${pt(0, -2.8, 5.7)} ${pt(-3.1, -1.8, 5.1)} Z`;
    // 판 두께감(지적) — 앞 가장자리 아래로 내려앉는 옆면 띠.
    const edge = `M${pt(-3.1, 0.8, 5.3)} Q${pt(0, 2, 6.1)} ${pt(3.1, 0.8, 5.3)}`
      + ` L${pt(3.1, 0.8, 4.6)} Q${pt(0, 2, 5.4)} ${pt(-3.1, 0.8, 4.6)} Z`;
    out.push(bodyFace(edge), sideFace(edge, 0.22));
    out.push(bodyFace(plate), topFace(plate, 0.18));
    return out;
  },
  /* 셔틀(다시 둘, 실물 참고) — 둥근 게딱지 몸통 앞(+y)으로 굵은 집게 두 개가 안쪽으로
     굽어 마주 물고, 그 사이가 어두운 아가리(위에 빛 줄). 등 뒤엔 엔진 짐 세 덩이,
     옆구리엔 밝은 홈. 집게발쪽이 정면. */
  shuttle: () => {
    const pt = (x: number, y: number, z: number): string => {
      const [px, py] = project(x, y, z);
      return `${px} ${py}`;
    };
    const [cx, cy] = project(0, -0.8, 3.8);
    const out: ShapeFace[] = [];
    // 뒷다리(요청) — 뒤 옆구리에서 나와 앞을 향해 굽는다. 뿌리는 몸통이 덮는다.
    out.push(...hornFaces(-3, -2.4, 3.7, -4.6, -1.2, 3.5, 0.9));
    out.push(...hornFaces(-4.6, -1.2, 3.5, -4.4, 1.6, 3.3, 0.7));
    out.push(...hornFaces(3, -2.4, 3.7, 4.6, -1.2, 3.5, 0.9));
    out.push(...hornFaces(4.6, -1.2, 3.5, 4.4, 1.6, 3.3, 0.7));
    // 몸통 — 둥근 게딱지.
    out.push(bodyFace(groundEllipse(cx, cy, 3.8, 3)));
    out.push(sideFace(`M${cx + 1.2} ${cy - 2.6} Q${cx + 3.8} ${cy - 1.6} ${cx + 3.5} ${cy + 1.6} Q${cx + 3.5} ${cy - 1} ${cx + 1.2} ${cy - 2.6} Z`, 0.2));
    out.push(topFace(groundEllipse(cx - 1.2, cy - 1.3, 1.7, 1.1), 0.25));
    // 옆구리 밝은 홈 한 쌍.
    out.push(topFace(groundEllipse(...project(-3.1, -0.4, 3.9), 0.5, 0.7), 0.4));
    out.push(topFace(groundEllipse(...project(3.1, -0.4, 3.9), 0.5, 0.7), 0.4));
    // 등 뒤 엔진 짐 — 껍데기 위 뒤쪽에 얹힌 세 덩이.
    out.push(...domeFaces3(-1.6, -2.9, 1.25, 1, 4.25));
    out.push(...domeFaces3(1.6, -2.9, 1.25, 1, 4.25));
    out.push(...domeFaces3(0, -3.3, 1, 0.9, 4.35));
    // 아가리 — 집게 사이 어두운 속과 그 위 빛 줄.
    out.push(capFace(`M${pt(-1.7, 1.2, 3.9)} Q${pt(0, 2.2, 3.9)} ${pt(1.7, 1.2, 3.9)} L${pt(0.8, 4, 3.9)} Q${pt(0, 4.6, 3.9)} ${pt(-0.8, 4, 3.9)} Z`, 0.45));
    out.push(topFace(`M${pt(-1.5, 1.3, 3.95)} Q${pt(0, 2.3, 3.95)} ${pt(1.5, 1.3, 3.95)} L${pt(1.3, 1.7, 3.95)} Q${pt(0, 2.7, 3.95)} ${pt(-1.3, 1.7, 3.95)} Z`, 0.5));
    // 집게 — 굵은 초승달 한 쌍이 안쪽으로 굽어 마주 문다.
    // 집게는 더 바깥으로(지적) — 뿌리·끝 모두 옆으로 벌린다.
    const claw = (m: 1 | -1): string =>
      `M${pt(m * 4.1, 0.2, 3.9)} Q${pt(m * 4.5, 3, 3.9)} ${pt(m * 1.9, 5.6, 3.9)}`
      + ` Q${pt(m * 1.2, 6, 3.9)} ${pt(m * 1.1, 5.2, 3.9)} Q${pt(m * 2.1, 3.6, 3.9)} ${pt(m * 2.2, 1.6, 3.9)}`
      + ` Q${pt(m * 2.3, 0.4, 3.9)} ${pt(m * 4.1, 0.2, 3.9)} Z`;
    out.push(bodyFace(claw(1)), sideFace(claw(1), 0.16));
    out.push(bodyFace(claw(-1)), topFace(claw(-1), 0.14));
    return out;
  },
};


const SHAPE_FACES: Record<string, ShapeFace[]> = {
  // 3D 빌더 전부를 표준 시점으로 한 번 굽고, 2D 기호(전투 갈래)는 그대로 얹는다.
  ...Object.fromEntries(Object.entries(SHAPE_BUILDERS).map(([k, b]) => [k, b()])),
  // (2D 기호 삭제·요청) — 갈래 기호도 전부 3D 빌더가 만든다: 삼각형은 삼각뿔로.
};
/* 위에서 본 판(요청: 입체 아닌 모드에서 좀 더 부감으로) — 같은 빌더를 납작비 0.66·
   높이 0.6으로 다시 구운 것. 입체 보기가 아닐 때 지도 마커가 이쪽을 쓴다. */
const SHAPE_FACES_TOP: Record<string, ShapeFace[]> = withTopView(() =>
  Object.fromEntries(Object.entries(SHAPE_BUILDERS).map(([k, b]) => [k, b()])));
/** 방향(요잉) 굽기 갈무리 — kind×22.5도(16방향) 버킷×(부감 여부)마다 한 번 굽는다. */
const HEAD_FACES = new Map<string, ShapeFace[]>();
/* (삭제·요청) 유닛 → 마커 갈래 표 — 전 유닛이 제 모델을 갖게 되어 갈래 표는 걷었다. */
/* 유닛 → 3D 상징물(요청) — 지상 유닛만(지적: 저그도 지상만). 공중은 2D 기호 그대로.
   표에 없는 지상 유닛은 기본 쐐기(wedge)로 방향만 갖는다. */
const UNIT_3D: Record<string, string> = {
  Marine: "gunner", Firebat: "fbat", Ghost: "gunner", Medic: "inf",
  // 기계·함선(요청: 만들 수 있는 건 다).
  Vulture: "vulture", "Siege Tank": "tank", "Siege Tank (Tank Mode)": "tank",
  "Siege Tank (Siege Mode)": "tanksiege",
  Goliath: "goliath", Reaver: "reaver", Wraith: "wraith", Battlecruiser: "bc",
  Valkyrie: "valk", "Science Vessel": "vessel",
  Mutalisk: "muta", Guardian: "guardian", Devourer: "devourer", Scourge: "scourge",
  Queen: "queen", Corsair: "corsair", Scout: "scout", Carrier: "carrier",
  Arbiter: "arbiter", Observer: "observer",
  Zealot: "zealot", "Dark Templar": "dtemp", Dragoon: "goon", "High Templar": "htemp",
  Archon: "archon", "Dark Archon": "darchon",
  Zergling: "zling", Hydralisk: "hydra", Ultralisk: "ultra", Broodling: "zling",
  "Infested Terran": "zling", Lurker: "lurker", Defiler: "defiler",
  // 일꾼류는 다 직접 모델링(요청).
  SCV: "scv", Probe: "probe", Drone: "drone",
};
/** 종족 → 일꾼 상징물 — 유닛 이름이 없는 일꾼 점(정찰·채굴)용. */
const workerKindOf = (race?: string): string =>
  race === "테란" ? "scv" : race === "저그" ? "drone" : "probe";
/* 기본 쐐기도 폐기(요청) — 표에 없는 낯선 유닛은 그 종족의 기본 보병 꼴로 그린다. */
/* 유닛별 전투 효과(요청: 불 말고 무기 특성) — 근접은 없음. */
const ATTACK_FX: Record<string, string> = {
  Marine: "gun", Ghost: "gun", Vulture: "gun", Goliath: "gun", Wraith: "gun",
  Battlecruiser: "bolt", "Siege Tank": "cannon", "Siege Tank (Tank Mode)": "cannon",
  "Siege Tank (Siege Mode)": "cannon", Firebat: "flame", Medic: "heal",
  Hydralisk: "spine", Lurker: "spine", Mutalisk: "glave", Devourer: "acid",
  Guardian: "acid", Queen: "acid", Valkyrie: "missile", Scourge: "glave",
  Dragoon: "bolt", Scout: "bolt", Corsair: "bolt", Arbiter: "bolt", Carrier: "bolt",
  "High Templar": "bolt", Reaver: "cannon",
};
const unitMarkerKind = (u: string, race?: string): string =>
  UNIT_3D[u] ?? (race === "테란" ? "gunner" : race === "저그" ? "zling" : "zealot");
/* 유닛 덩치(요청: 소형/중형/대형 크기 구분) — 브루드워의 유닛 크기 분류를 따른다.
   표에 없으면 대형으로 본다(큰 것들이 표에서 빠졌을 때 눈에 띄는 쪽이 덜 틀린다). */
const UNIT_BULK: Record<string, 0 | 1 | 2> = {
  Marine: 0, Firebat: 0, Ghost: 0, Medic: 0, Zealot: 0, "High Templar": 0,
  "Dark Templar": 0, Observer: 0, Zergling: 0, Scourge: 0, Mutalisk: 0,
  Broodling: 0, "Infested Terran": 0,
  Hydralisk: 1, Vulture: 1, Corsair: 1, Lurker: 1, Queen: 1, Defiler: 1,
};
/** 도형째 돌려 그리는 각도(시계방향) — 스타게이트는 45도(요청). */
const SHAPE_ROT: Record<string, number> = { arch: 45 };
/** 관리자 모델링 뷰어(요청) — 도형 카탈로그. 건물은 SHAPE_KIND에서, 유닛 갈래는 손으로. */
export const SHAPE_GALLERY: { kind: string; label: string }[] = (() => {
  const seen = new Set<string>();
  const out: { kind: string; label: string }[] = [];
  for (const [unit, kind] of Object.entries(SHAPE_KIND)) {
    if (seen.has(kind)) continue;
    seen.add(kind);
    out.push({ kind, label: BUILDING_KO[unit] ?? unit });
  }
  for (const [kind, label] of [
    ["pool", "스포닝 풀"],
    ["ovie", "오버로드"], ["dship", "드랍십"], ["shuttle", "셔틀"],
    ["gunner", "테란 보병(총)"], ["fbat", "파이어뱃"], ["inf", "메딕"],
    ["zealot", "질럿"], ["dtemp", "다크 템플러"], ["goon", "드라군"],
    ["archon", "아콘"], ["darchon", "다크 아콘"],
    ["lurker", "러커"], ["defiler", "디파일러"],
    ["cocoon", "공사 고치(저그)"], ["warpin", "소환구(프로토스)"], ["scaffold", "공사장(테란)"],
    ["scv", "SCV"], ["probe", "프로브"], ["drone", "드론"],
    ["zling", "저글링"], ["hydra", "히드라"], ["ultra", "울트라리스크"],
    ["htemp", "하이 템플러"],
    ["tank", "시즈 탱크"], ["tanksiege", "시즈 탱크(시즈)"], ["vulture", "벌처"], ["goliath", "골리앗"], ["reaver", "리버"],
    ["wraith", "레이스"], ["bc", "배틀크루저"], ["valk", "발키리"], ["vessel", "사이언스 베슬"],
    ["muta", "뮤탈리스크"], ["guardian", "가디언"], ["devourer", "디바우러"], ["scourge", "스커지"],
    ["queen", "퀸"], ["corsair", "커세어"], ["scout", "스카웃"], ["carrier", "캐리어"],
    ["arbiter", "아비터"], ["observer", "옵저버"],
  ] as [string, string][]) {
    if (!seen.has(kind)) { seen.add(kind); out.push({ kind, label }); }
  }
  return out;
})();

export function ShapeIcon({ kind, className, faces: facesOverride, rotDeg, flat, keepRatio, viewYaw }: {
  kind: string; className?: string;
  /** 뷰어의 요잉 회전(요청) — withYaw로 다시 투영한 면 목록을 그대로 그린다. */
  faces?: ShapeFace[];
  /** 이동 방향 회전(요청: 유닛 마커도 방향) — 시계방향 도. */
  rotDeg?: number;
  /** 위에서 본 판(요청) — 입체 보기가 아닐 때의 지도 마커가 켠다. */
  flat?: boolean;
  /** 원본 비율 유지(요청: 자료실에서 보는 비율 그대로 — 캔버스에 맞춰 늘리기 금지). */
  keepRatio?: boolean;
  /** 좌우 시점(지적: 입체 보기 시점이 정면 고정) — 카메라가 비껴 본 각(도). */
  viewYaw?: number;
}) {
  /* 방향은 요잉으로(지적: 화면 회전은 2D 시점에서 모델을 뒤집는다) — 3D 빌더가 있는
     도형은 rotDeg를 화면 회전 대신 모델 요잉 재투영으로 처리한다. 15도 버킷으로 한 번
     굽어 갈무리한다. 위쪽을 봐도 높이는 늘 위를 향한다. */
  let faces = facesOverride;
  let rot = SHAPE_ROT[kind] ?? 0;
  const builder = SHAPE_BUILDERS[kind];
  // 좌우 시점(지적) — 6도 스텝으로 갈무리해 굽는 판 수를 묶는다.
  const vq = viewYaw ? Math.max(-36, Math.min(36, Math.round(viewYaw / 6) * 6)) : 0;
  if (!faces && (rotDeg !== undefined || vq !== 0) && builder) {
    /* 기본은 정면(지적: 사선이 어색) — rotDeg 0이 요잉 0(정면 아래)이 되도록 굽는다.
       건물은 rotDeg가 없어 좌우 시점(vq)만 받는다. */
    // 16방향(요청: 원작 스프라이트처럼 22.5도 스텝) — 자연스러운 회전 단위.
    const bucket = rotDeg !== undefined ? ((Math.round(rotDeg / 22.5) * 22.5) % 360 + 360) % 360 : 0;
    const key = `${kind}:${bucket}:${flat ? 1 : 0}:${vq}`;
    let f = HEAD_FACES.get(key);
    if (!f) {
      const bake = (): ShapeFace[] => withYaw(vq - bucket, builder);
      f = flat ? withTopView(bake) : bake();
      HEAD_FACES.set(key, f);
    }
    faces = f;
  } else if (!builder) {
    rot += rotDeg ?? 0;
  }
  faces = faces ?? (flat ? SHAPE_FACES_TOP[kind] : undefined) ?? SHAPE_FACES[kind];
  return (
    // preserveAspectRatio="none" — 상자(발자국 비율)에 맞춰 그림째 눌린다(요청: 캔버스
    // 비율을 정확하게). 정사각 상자(유닛 마커 등)에서는 아무 일도 안 일어난다.
    <svg
      className={cx("scr-motion-shape-svg", className)}
      viewBox="0 0 16 16" preserveAspectRatio={keepRatio ? "xMidYMax meet" : "none"} aria-hidden
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
  pts: TrackPt[], t: number,
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

/** 상세 팝업 자동 확대의 자리 잡기 — 묶음 상세(카드 여럿)에서 첫 판만 확대창을 연다. */
const autoBigHolder = { taken: false };

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
  stamp, registrant, onDetailClose,
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
  /** 확대 창 왼쪽 기둥 맨 위의 타임스탬프(요청) — 경기 시각. */
  stamp?: React.ReactNode;
  /** 확대 창 왼쪽 기둥 맨 아래의 등록자 정보(요청). */
  registrant?: React.ReactNode;
  /** 상세 팝업 닫기(요청: PC는 게임 결과만 확대창이 기본, 기존 상세는 미사용) — 값이
   *  오면 PC에서 마운트되자마자 확대창을 열고, 확대창을 닫을 때 상세까지 함께 닫는다. */
  onDetailClose?: () => void;
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
     배경판, 밝은 계열은 CSS의 검정 음영판. 문턱은 칩(chipStyle의 150)과 같은 값이다
     (지적: 연보라가 칩에선 흰 글자인데 건물 음영판은 검정 — 140/150으로 갈라져 있었다). */
  const shapeStyle = (raw: string, team: 1 | 2 | undefined): React.CSSProperties => {
    const c = modeColor(raw, team);
    return {
      color: c,
      ...(lumOf(c) <= 150 ? {
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
  /* 기술(마법·드랍·태움) 전용 배지(요청: 유닛과 다른 스타일) — 유닛 칩은 제 색을 꽉 채운
     네모, 기술은 어두운 알약에 제 색 테두리다. 배지 꼴만으로 "누구의 부대"와 "무슨 일이
     일어난 자리"가 갈린다. 바탕·글자색은 CSS(.scr-motion-cast)가 정한다. */
  const castStyle = (raw: string, team: 1 | 2 | undefined): React.CSSProperties => ({
    border: `1px solid ${modeColor(raw, team)}`,
  });

  /* 지형(요청: 미니맵 이미지 분석) — 그림에서 걷는 땅 격자를 만들어, 지상 부대의 자취를
     그 위의 경로로 편다. 분석 전·실패 시에는 기존 곡선 폴백. */
  const [terrain, setTerrain] = useState<TerrainGrid | null>(null);
  /* 틈을 조이기 전의 원본 격자(지적: 지상 유닛들이 다 벽을 뚫고 다닌다) — 미니맵 해상도
     에서는 언덕길·초크가 딱 1칸 폭이라, 실틈 조이기(closeNarrowGaps)가 진짜 길목까지 막아
     지역이 통째로 끊겼다. 길찾기가 실패하면 직선 폴백이라 전부 벽을 뚫었다. 조인 격자로
     길이 안 나오면 이 원본으로 한 번 더 찾는다 — 실틈만 조이고 길목은 살리는 절충이다. */
  const [terrainRaw, setTerrainRaw] = useState<TerrainGrid | null>(null);
  /* 랠리 걸음의 경로 갈무리(지적: 벽뚫기) — (출발, 목적지) 짝마다 지형 길을 한 번만 셈한다.
     지형이 갈리면(검수 저장 등) 비운다. */
  const rallyRoutes = useRef(new Map<string, [number, number][]>());
  useEffect(() => { rallyRoutes.current.clear(); }, [terrain, terrainRaw]);
  /* 지형 수정(요청: 모든 경기 리플레이 화면에서, 아무나) — 산 버튼이 검수 모달을 연다.
     저장하면 이 자리에서 바로 새 지형으로 갈아 끼운다(맵 캐시는 다음 로드에 새 값을 받는다). */
  const [terrainOpen, setTerrainOpen] = useState(false);
  const [walkOverride, setWalkOverride] = useState<string | null>(null);
  /* 모달에 주는 image는 같은 값이면 같은 객체여야 한다(지적: 칠하면 까맣게 깜빡이고
     되돌아감) — 재생은 매 프레임 리렌더라, 인라인 객체를 만들면 모달의 초기화 effect가
     프레임마다 다시 돌아 격자를 원본으로 리셋했다. */
  const terrainModalImage = useMemo(() => ({
    // 제목은 대표맵 이름(요청) — 리플레이 원본 이름은 색 제어문자가 섞여 지저분하다.
    id: grid.imageId ?? 0, name: grid.imageName || grid.name || "미니맵",
    image: grid.image ?? "", walk: walkOverride ?? grid.walk,
  }), [grid.imageId, grid.imageName, grid.name, grid.image, grid.walk, walkOverride]);
  useEffect(() => {
    let cancelled = false;
    /* 검수한 지형(grid.walk, 방금 이 자리에서 고쳤으면 walkOverride)이 있으면 그쪽이
       이긴다(요청) — 자동 분석은 어림이다. */
    const reviewed = decodeWalk(walkOverride ?? grid.walk);
    if (reviewed) {
      setTerrain(closeNarrowGaps(reviewed));
      setTerrainRaw(reviewed);
      return undefined;
    }
    if (!grid.image) { setTerrain(null); setTerrainRaw(null); return undefined; }
    terrainOf(
      grid.image,
      // 앵커(지적: 빠른무한 반전) — 자원 지대 + 시작 지점(둘 다 확실한 땅). 분수 좌표.
      [
        ...(grid.resources ?? []).map(([x, y]) => [x / grid.width, y / grid.height] as [number, number]),
        ...bases.filter((m) => !m.ghost).map((m) => [m.x / grid.width, m.y / grid.height] as [number, number]),
      ],
    )
      .then((tg) => {
        if (cancelled) return;
        setTerrain(tg ? closeNarrowGaps(tg) : tg);
        setTerrainRaw(tg);
      });
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
    src: TrackPt[], p: MotionTrack, straight: boolean, forcedUnit?: string,
    speedOverride?: number, forceGround?: boolean,
  ): [number, number, number][] => {
    if (src.length === 0) return [];
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
        /* 조인 격자 먼저, 끊겼으면 원본으로 한 번 더(위 terrainRaw 주석) — 둘 다 끊겼으면
           직선이 아니라 차선(벽을 비싸게 취급하는 다익스트라)이다(지적: 지상 유닛이 벽을 막
           통과해 직진). 격자가 조각났거나 출발·도착이 못 걷는 칸 깊숙이 떨어져 스냅이
           실패하면 BFS는 null인데, 그때마다 직선을 그으면 벽 관통이 화면을 덮는다. */
        const found = groundPath(
          terrain,
          atX / grid.width, atY / grid.height,
          tx / grid.width, ty / grid.height,
        ) ?? (terrainRaw ? groundPath(
          terrainRaw,
          atX / grid.width, atY / grid.height,
          tx / grid.width, ty / grid.height,
        ) : null) ?? groundPathSoft(
          terrainRaw ?? terrain,
          atX / grid.width, atY / grid.height,
          tx / grid.width, ty / grid.height,
        );
        path = found.map(([fx, fy]) => [fx * grid.width, fy * grid.height] as [number, number]);
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
  /* 수송선 명령 자리도 워프 후보다(요청: 새로운 셔틀 위치에서 명령이 갑자기 시작되면
     내린 것) — 드랍 신호(drops)가 안 잡혀도, 수송선이 들른 자리 곁에서 태어나는 새 명령
     뭉치는 수송선이 날라 준 부대라 걸어온 자취 없이 그 자리에서 시작해야 한다.
     단 집 곁(15타일)의 수송선 자리는 뺀다(지적: 유닛 이동 중 마커 사라짐의 한 갈래) —
     본진 근처는 수송선이 늘 오가는 곳이라, 행군하러 나서는 부대의 첫 클릭이 엉뚱하게
     "여기서 내린 새 부대"로 태어나고 원래 부대는 조용해져 사라졌다. */
  const warpsOf = (p: MotionTrack): [number, number, number][] => {
    const home = homeOf(p.raw);
    return [
      ...(p.drops ?? []),
      ...(p.tpts ?? [])
        .filter(([, x, y]) => !home || Math.hypot(x - home[0], y - home[1]) > 15)
        .map(([s, x, y]) => [s, x, y] as [number, number, number]),
    ];
  };
  const squadPts = useMemo(
    () => basePts.map((pts, pi) => splitSquads(
      pts, homeOf(motion.players[pi].raw), SQUAD_MERGE_TILES, warpsOf(motion.players[pi]),
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
      .flatMap(([unit, pts]) => splitSquads(pts, homeOf(p.raw), TYPE_MERGE_TILES, warpsOf(p))
        .map((sq) => ({ unit, raw: sq, walk: walkTrack(sq, p, false, unit) })))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [motion, terrain, terrainRaw, grid.width, grid.height, bases],
  );
  const refinedSquads = useMemo(
    () => motion.players.map((p, pi) => squadPts[pi].map((sq) =>
      walkTrack(sq, p, false, undefined, undefined, true))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [squadPts, terrain, terrainRaw, grid.width, grid.height, motion],
  );
  /* 정찰 자취도 걸어서 가고(지적: 갑자기 이동 — 직선이되 일꾼 걸음), 갈래·부대로 갈라
     각자의 점이 된다(지적: 드랍십 순간이동 — 일꾼 정찰과 셔틀 원정이 한 점을 놓고
     밀당했다). 갈래는 이름을 정한다(지적: 오버로드 이름이 안 나온다). */
  /* 정찰(수송선·오버로드) 사슬(지적: 가다 멈췄다 순간이동, 특히 초반 — 실측 데이터로
     확인: 클릭 간 거리가 부대 반경(28타일)을 넘으면 한 마리가 유령 마커 여럿으로 쪼개
     졌다) — 거리 반경 대신 '그 시간에 그 걸음으로 닿을 수 있나'로 잇는다. 닿을 수 있으면
     같은 마리, 없으면(동시에 딴 곳을 찍는 두 마리) 딴 마리다. */
  const chainScout = (
    pts: TrackPt[], speed: number, home: [number, number] | null,
  ): TrackPt[][] => {
    const tracks: TrackPt[][] = [];
    for (const pt of pts) {
      let best = -1;
      let bestSlack = Infinity;
      for (let ti = 0; ti < tracks.length; ti += 1) {
        const last = tracks[ti][tracks[ti].length - 1];
        const need = Math.hypot(pt[1] - last[1], pt[2] - last[2]);
        // 여유 14타일 — 명령 좌표는 '목표'라 실제 위치보다 과대(실측: 되돌림 스팸 클릭).
        const avail = Math.max(0, pt[0] - last[0]) * speed * 1.5 + 14;
        if (need <= avail && avail - need < bestSlack) { best = ti; bestSlack = avail - need; }
      }
      if (best >= 0) tracks[best].push(pt);
      else if (tracks.length === 0 && home) tracks.push([[pt[0], home[0], home[1]], pt]);
      else tracks.push([pt]);
    }
    return tracks;
  };

  const scoutSquads = useMemo(() => motion.players.map((p) => {
    const kinds: { kind: "worker" | "carrier" | "lone"; src: TrackPt[] }[] = [
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
    /* 수송선·단독 정찰은 넓은 반경(28타일)으로 묶는다(지적: 초반 오버로드가 조금 가다
       멈췄다 나중에 몰아 움직임) — 한 마리가 맵을 크게 가로지르는 클릭들이 좁은 반경에서
       여러 부대로 갈라지고, '조용한 부대가 저리 옮겨 간 것' 재배정에 튕기며 가다 서다
       몰아치기가 됐다. 일꾼 정찰은 종전 반경 그대로다(여럿이 딴 데를 볼 수 있다). */
    /* 시작 오버로드는 해처리 옆에 떠 있다(지적: 트랙이 본진 좌표에서 출발해, 한 번
       해처리로 이동했다 움직이기 시작함) — 저그의 수송·단독 정찰은 걸어 나가는 출발점을
       풍선이 서 있는 그 자리(본진 오른쪽 위 2.5타일)로 잡는다. */
    const home0 = homeOf(p.raw);
    const ovieHome: [number, number] | null = home0 && race === "저그"
      ? [home0[0] + 2.5, home0[1] - 2.5] : home0;
    const carrierSpeed = race === "저그" ? 0.6 : race === "테란" ? 4.1 : 3.3;
    return kinds.flatMap(({ kind, src }) => (src.length === 0 ? [] : (kind === "worker"
      ? splitSquads(src, home0)
      : chainScout(src, kind === "carrier" || race === "저그" ? carrierSpeed : SCOUT_WALK_SPEED, ovieHome))
      .map((sq) => ({
        kind, raw: sq,
        walk: walkTrack(
          sq, p, kind !== "worker",
          kind === "worker" ? workerUnit : kind === "carrier" ? carrierUnit : loneUnit,
        ),
      }))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [motion, terrain, terrainRaw, grid.width, grid.height, bases]);
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
  /* 상세 팝업(PC)은 첫 렌더부터 확대다(지적: 승패·BEST 줄이 잠깐 보였다 사라짐 —
     effect로 열면 인라인 카드가 한 프레임 먼저 그려진다). 초기값은 순수 계산만 하고,
     자리 잡기(autoBigHolder)는 아래 effect가 맡는다. */
  const [big, setBig] = useState<boolean>(() => Boolean(onDetailClose)
    && typeof window !== "undefined"
    && !!window.matchMedia?.("(min-width: 1160px)").matches);
  /* (삭제·요청: 모바일 확대 기능 제거 둘째 판) — 화면 폭 확대 토글(wide)도 걷었다.
     게임 상세 모달이 애초에 전체화면이 되면서(요청) 맵은 늘 화면의 짧은 변에 최대로
     맞고, 눌러서 넓히는 중간 상태가 설 자리가 없다. */
  useLockBodyScroll(big);
  useEffect(() => {
    if (!big) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // 상세 팝업 기본 확대(요청)면 상세까지 함께 닫는다.
      if (onDetailClose) onDetailClose();
      else setBig(false);
    };
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

  /* (삭제·요청) PC 축소 장면 — 상세가 늘 확대창으로 열리면서 "재생 시작 시 확대"와
     "축소 기억"(shrunk·bigByDefault)은 통째로 걷었다. */

  /* PC 상세는 확대창이 곧 화면이다(요청: 기존 상세 미사용) — 상세 팝업 안(onDetailClose가
     온 자리)에서 마운트되자마자 확대창을 연다. 묶음 상세에 카드가 여럿이면 첫 판만 연다
     (autoBigHolder). */
  useEffect(() => {
    if (!onDetailClose) return undefined;
    if (typeof window === "undefined" || !window.matchMedia?.("(min-width: 1160px)").matches) return undefined;
    // 묶음 상세에서 다른 판이 이미 확대를 잡았으면 이쪽은 내려선다(초기값이 true였어도).
    if (autoBigHolder.taken) { setBig(false); return undefined; }
    autoBigHolder.taken = true;
    setBig(true);
    return () => { autoBigHolder.taken = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const closeBig = () => {
    if (onDetailClose) { onDetailClose(); return; }
    setBig(false);
  };

  /* PC 휠 줌(요청) — 맵 위에서 휠로 확대/축소, 커서 자리를 붙든 채 늘어난다. 팬은 줌
     계산에 함께 실려 경계 밖이 안 보이게 죈다. */
  const [zoom, setZoom] = useState(1);
  /* 피칭 보기(요청) — 수직 부감 대신 약간 비스듬한 정면. 바닥(지형 그림과 마커 자리)만
     세로로 눌리고, 건물·유닛 도형은 제 크기로 서 있어 3D로 바닥에 붙는다. 눌림은
     컨테이너 세로비가 맡아서 %자리가 저절로 따라온다. 휠 확대·드래그 이동은 기존
     렌즈(zoom·pan) 그대로다. */
  const [pitched, setPitched] = useState(false);
  // 모바일(터치 기기)은 입체 보기를 아직 안 연다(요청) — 아래에서 버튼을 감춘다.
  const coarsePointer = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const ox = e.clientX - (rect.left + rect.width / 2);
      const oy = e.clientY - (rect.top + rect.height / 2);
      setZoom((z) => {
        const nz = Math.min(5, Math.max(1, z * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
        setPan((p) => {
          if (nz <= 1) return { x: 0, y: 0 };
          const k = nz / z;
          let nx = ox + (p.x - ox) * k;
          let ny = oy + (p.y - oy) * k;
          const maxX = ((nz - 1) * rect.width) / 2;
          const maxY = ((nz - 1) * rect.height) / 2;
          nx = Math.min(maxX, Math.max(-maxX, nx));
          ny = Math.min(maxY, Math.max(-maxY, ny));
          return { x: nx, y: ny };
        });
        return nz;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [big]);

  /* 드래그 팬(지적: 확대 후 드래그가 이상함 — 브라우저의 이미지 드래그가 끌려 나왔다)
     — 확대 중에는 드래그로 지도를 민다. 경계 죔은 휠과 같은 식. */
  /* 지도 위에서만 핀치 줌·팬(요청) — 페이지 줌은 도로 막고, 지도(mapRef)에 붙인
     네이티브 두 손가락 처리로 확대·이동한다. 손가락 가운데 점이 고정되도록 pan을
     함께 푼다. 한 손가락 끌기는 기존 pointer 드래그(zoom>1)가 맡는다. */
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panRef = useRef(pan);
  panRef.current = pan;
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    let pinch: { d: number; z: number; cx: number; cy: number; px: number; py: number } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTS = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      pinch = {
        d: dist(e.touches), z: zoomRef.current,
        cx: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        cy: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        px: panRef.current.x, py: panRef.current.y,
      };
    };
    const onTM = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const ox = r.left + r.width / 2;
      const oy = r.top + r.height / 2;
      const z = Math.min(5, Math.max(1, (pinch.z * dist(e.touches)) / pinch.d));
      const mx2 = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const my2 = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      // 핀치 시작점 아래의 지도 지점이 손가락을 따라오도록 pan을 푼다.
      const ux = (pinch.cx - ox - pinch.px) / pinch.z;
      const uy = (pinch.cy - oy - pinch.py) / pinch.z;
      setZoom(z);
      setPan(z <= 1 ? { x: 0, y: 0 } : { x: mx2 - ox - z * ux, y: my2 - oy - z * uy });
    };
    const onTE = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    el.addEventListener("touchstart", onTS, { passive: false });
    el.addEventListener("touchmove", onTM, { passive: false });
    el.addEventListener("touchend", onTE);
    el.addEventListener("touchcancel", onTE);
    return () => {
      el.removeEventListener("touchstart", onTS);
      el.removeEventListener("touchmove", onTM);
      el.removeEventListener("touchend", onTE);
      el.removeEventListener("touchcancel", onTE);
    };
  }, []);
  /* 건물 자리 회피(요청: 밟고 지나가지 않고 돌아간다) — 서 있는 건물 발자국(+여유
     0.5타일) 안으로 들어온 유닛 자리는 가장 가까운 변 밖으로 밀어낸다. 선분이 발자국을
     가로지르면 안쪽 구간이 변을 따라 미끄러져, 돌아가는 걸음으로 보인다. */
  /* 입체 보기 원근(지적: 유닛만 원근이고 맵이 그대로) — 지형 그림에 CSS
     perspective+rotateX를 걸고, 마커 자리는 같은 사영 공식으로 매핑해 그림 위 제자리에
     얹는다. 깊이 배율(--mk)도 같은 k를 쓴다. */
  const PITCH_TH = Math.PI / 4;
  /* 650 → 520(지적: 확대폭이 작다) — 원근을 더 세게. 맞춤 축소(q)가 끝 잘림을 막아
     주므로 세게 걸어도 안 잘린다. */
  const PITCH_P = 520;
  /* 맞춤 축소(지적: 또 예전 끝 잘림) — 원근 확대로 가까운 변이 상자를 넘쳤다. 가까운
     변이 상자에 딱 맞는 배율 q로 전체를 줄이고, 세로는 cy만큼 올려 가운데 정렬한다.
     지형 그림(transform)과 마커 공식이 같은 q·cy를 쓴다. */
  const pitchGeom = () => {
    const el = mapRef.current;
    const w = el?.clientWidth ?? 320;
    const h = el?.clientHeight ?? 220;
    const S = Math.sin(PITCH_TH);
    const C = Math.cos(PITCH_TH);
    const H = h / 2;
    const q = Math.max(0.2, (PITCH_P - H * S) / PITCH_P);
    const kFar = PITCH_P / (PITCH_P + H * S);
    const cy = (C * H * (1 - q * kFar)) / 2;
    return { w, h, S, C, q, cy };
  };
  const pitchK = (y: number): number => {
    if (!pitched) return 1;
    const { h, S, q } = pitchGeom();
    const v = (y / grid.height - 0.5) * h;
    return (q * PITCH_P) / (PITCH_P - v * S);
  };
  const posStyle = (x: number, y: number): { left: string; top: string } => {
    // (수리) 평면 보기가 저를 다시 불러 무한 재귀였다 — 맨 백분율로 돌려준다.
    if (!pitched) return { left: pct(x, grid.width), top: pct(y, grid.height) };
    const { w, h, S, C, q, cy } = pitchGeom();
    const u = (x / grid.width - 0.5) * w;
    const v = (y / grid.height - 0.5) * h;
    const k = (q * PITCH_P) / (PITCH_P - v * S);
    return {
      left: `${(50 + ((u * k) / w) * 100).toFixed(3)}%`,
      top: `${(50 + ((v * C * k - cy) / h) * 100).toFixed(3)}%`,
    };
  };
  /* 좌우 시점(지적: 시점이 정면 고정, 좌우가 없다) — 카메라(화면 가운데, 거리 P)에서
     비껴 보이는 마커는 그 각도만큼 모델 요잉을 틀어 굽는다. 왼쪽 마커는 오른옆이,
     오른쪽 마커는 왼옆이 보인다. */
  const viewYawOf = (x: number, y: number): number => {
    if (!pitched) return 0;
    const { w, h, S, q } = pitchGeom();
    const u = (x / grid.width - 0.5) * w;
    const v = (y / grid.height - 0.5) * h;
    const k = (q * PITCH_P) / (PITCH_P - v * S);
    /* 부호(지적: 우측은 맞는데 좌측이 잘못) — 마커는 화면 가운데를 향한 옆면을 보여야
       한다. 왼쪽 마커는 음(제 오른옆이 보임), 오른쪽 마커는 양. */
    return (Math.atan2(u * k, PITCH_P) * 180) / Math.PI;
  };
  const depthMk = (y: number): React.CSSProperties =>
    (pitched ? { "--mk": pitchK(y).toFixed(3) } as React.CSSProperties : {});
  const dodge = (px: number, py: number): [number, number] => {
    for (const [bs, bx2, by2, bu, , g2, liftAt2] of motion.builds) {
      if (bs > t) continue;
      const gone = g2 ?? 0;
      if (gone > 0 && t >= gone) continue;
      if (liftAt2 && t >= liftAt2) continue;
      const [fw2, fh2] = FOOTPRINT[bu] ?? [3, 2];
      const cx2 = bx2 + footDx(bu);
      const cy2 = by2 + footDy(bu);
      const hw = fw2 / 2 + 0.5;
      const hh = fh2 / 2 + 0.5;
      const dx2 = px - cx2;
      const dy2 = py - cy2;
      if (Math.abs(dx2) < hw && Math.abs(dy2) < hh) {
        if (hw - Math.abs(dx2) < hh - Math.abs(dy2)) px = cx2 + (dx2 >= 0 ? hw : -hw);
        else py = cy2 + (dy2 >= 0 ? hh : -hh);
      }
    }
    return [px, py];
  };
  /* 유닛 방향(지적: 멈추면 정면으로 돌아가 어색) — 조금 전이 아니라 '마지막으로 움직인'
     방향을 문다: 0.8초 전부터 점점 멀리(최대 15초) 되짚어 처음 잡히는 변위의 방향이다. */
  const headingOf = (walk: TrackPt[], pos: { x: number; y: number }): number => {
    for (const back of [0.8, 2, 4, 8, 15]) {
      const hp = posAt(walk, Math.max(0, t - back), null);
      if (!hp) break;
      const dx = pos.x - hp.x;
      const dy = pos.y - hp.y;
      if (Math.hypot(dx, dy) > 0.1) return (Math.atan2(-dx, dy) * 180) / Math.PI;
    }
    return 0;
  };
  const dragRef = useRef<{ id: number; sx: number; sy: number; px: number; py: number } | null>(null);
  const onMapPointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1 || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
  };
  const onMapPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const el = mapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxX = ((zoom - 1) * rect.width) / 2;
    const maxY = ((zoom - 1) * rect.height) / 2;
    setPan({
      x: Math.min(maxX, Math.max(-maxX, d.px + (e.clientX - d.sx))),
      y: Math.min(maxY, Math.max(-maxY, d.py + (e.clientY - d.sy))),
    });
  };
  const onMapPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current?.id === e.pointerId) dragRef.current = null;
  };

  /* 키보드(요청: PC) — ↑↓ 배속, ←→ 5초 뒤/앞. 댓글 입력 중에는 건드리지 않는다. */
  useEffect(() => {
    if (!big) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const t2 = e.target as HTMLElement | null;
      if (t2 && (t2.tagName === "INPUT" || t2.tagName === "TEXTAREA" || t2.isContentEditable)) return;
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        setSpeed((v) => {
          const i = SPEEDS.indexOf(v);
          return SPEEDS[e.key === "ArrowUp" ? Math.min(SPEEDS.length - 1, i + 1) : Math.max(0, i - 1)];
        });
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        setT((v) => {
          const nv = Math.min(total, Math.max(0, v + (e.key === "ArrowRight" ? 5 : -5)));
          setDone(nv >= total);
          return nv;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [big, total]);

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
     반감기 60 → 25초(지적) → 복합 감쇠(재지적: 소모를 너무 작게 잡음) — 지수 하나로는
     0에 영영 못 닿는데, 실제 전투는 양쪽이 동시에 때려서 손실이 시간에 비례하는 몫이
     크다(비슷한 병력끼리 붙으면 결국 둘 다 0 — 수에 꼭 비례하지 않는다). 규모가 클수록
     화력도 커지니 비례 몫도 함께 둔다: 초당 '고정 0.25 + 반감기 18초 비례'로 깎고
     바닥은 0 — 30기끼리 붙으면 40초 언저리에 전멸하는 눈금이다. 입구 싸움처럼 천천히
     녹는 판은 hot 구간이 길어 그만큼 오래 깎이는 것으로 대신한다. */
  const sizeSeries = useMemo(() => {
    const out = new Map<string, [number, number][]>();
    const PROP = Math.LN2 / 18;
    const LIN = 0.25;
    /* 업그레이드 반영(요청: 실력까진 몰라도 업 정보는 있다) — 상대 공업이 높을수록 빨리
       녹고, 내 방업이 높을수록 천천히 녹는다. 단계당 공업 +8%, 방업 −6%(브루드워 공방업
       한 단의 체감 배율 어림). */
    const WEAPON_UPS = new Set([
      "Terran Infantry Weapons", "Terran Vehicle Weapons", "Terran Ship Weapons",
      "Zerg Melee Attacks", "Zerg Missile Attacks", "Zerg Flyer Attacks",
      "Protoss Ground Weapons", "Protoss Air Weapons",
    ]);
    const ARMOR_UPS = new Set([
      "Terran Infantry Armor", "Terran Vehicle Plating", "Terran Ship Plating",
      "Zerg Carapace", "Zerg Flyer Carapace",
      "Protoss Ground Armor", "Protoss Air Armor", "Protoss Plasma Shields",
    ]);
    /* 전투 마법 반영(지적: 마엘스톰·락다운·스태시스·피뿌리기도 공방에 영향) — 캐스트
       기록이 남는 마법은 최근 12초 안에 맞은 만큼 더 빨리 녹고(피해·무력화), 내가 건
       만큼 천천히 녹는다(상대 화력 묶음). 디바우러 산성 포자는 일반 공격이라 기록이
       없어 못 센다. */
    /* EMP는 실드 종족에만 크게(지적) — 실드를 통째로 벗기니 프로토스 상대 0.25,
       그 밖엔 에너지 소진 몫만 0.05. */
    const COMBAT_CASTS: Record<string, number> = {
      "Psionic Storm": 0.25, Plague: 0.25, Irradiate: 0.15,
      Lockdown: 0.15, Maelstrom: 0.15, "Stasis Field": 0.15,
      Ensnare: 0.1,
    };
    const raceOf = (raw: string): string | undefined => bases.find((b) => b.key === raw)?.race;
    const castsOf = (pred: (raw: string) => boolean, empW: number): [number, number][] => motion.casts
      .filter((c) => (COMBAT_CASTS[c[3]] !== undefined || c[3] === "EMP Shockwave") && pred(c[4]))
      .map((c) => [c[0], c[3] === "EMP Shockwave" ? empW : COMBAT_CASTS[c[3]]]);
    /* 상성 반영(요청: 메딕 있으면 바이오닉 강해지고, 이런 상성 최대한) — 생산 기록으로
       아는 유명 카운터만 조심스럽게: 상대 카운터 유닛이 쌓일수록(6기에 만렙) 내 피카운터
       비중만큼 더 녹고, 메딕은 내 바이오닉 몫을 지킨다(기당 5%, 상한 20%). */
    const COUNTERS: [string, string, number][] = [
      ["Vulture", "Zealot", 0.5], ["Vulture", "Zergling", 0.5],
      ["Siege Tank", "Dragoon", 0.5], ["Siege Tank", "Goliath", 0.4],
      ["Siege Tank", "Hydralisk", 0.4], ["Siege Tank", "Lurker", 0.4],
      ["Firebat", "Zergling", 0.5], ["Firebat", "Zealot", 0.4],
      ["Archon", "Zergling", 0.4], ["Archon", "Mutalisk", 0.4],
      ["Lurker", "Marine", 0.5], ["Lurker", "Zergling", 0.4],
      ["Reaver", "Marine", 0.4], ["Reaver", "Zergling", 0.4], ["Reaver", "Zealot", 0.4],
      ["Corsair", "Mutalisk", 0.5], ["Corsair", "Scourge", 0.4],
      ["Valkyrie", "Mutalisk", 0.5],
      ["Goliath", "Mutalisk", 0.4], ["Goliath", "Wraith", 0.4], ["Goliath", "Battlecruiser", 0.4],
      ["Dark Templar", "Zergling", 0.3],
    ];
    const unitTimesOf = (q: MotionTrack): Map<string, number[]> => {
      const m2 = new Map<string, number[]>();
      for (const [u, secs] of Object.entries(q.prod ?? {})) {
        const k2 = u.startsWith("Siege Tank") ? "Siege Tank" : u;
        const arr = m2.get(k2) ?? [];
        for (const x2 of secs) arr.push(x2 + (UNIT_SEC[u] ?? 20));
        m2.set(k2, arr);
      }
      for (const arr of m2.values()) arr.sort((a, b) => a - b);
      return m2;
    };
    const upTimes = (raw: string, names: Set<string>): number[] =>
      (motion.players.find((q) => q.raw === raw)?.ups ?? [])
        .filter(([, n]) => names.has(n)).map(([us]) => us).sort((a, b) => a - b);
    const countBy = (times: number[], sec: number): number => {
      let n = 0;
      while (n < times.length && times[n] <= sec) n += 1;
      return n;
    };
    for (const p of motion.players) {
      const done = completionsByRaw.get(p.raw) ?? [];
      const hot = p.hot ?? [];
      const myArmor = upTimes(p.raw, ARMOR_UPS);
      const foeWeapons = motion.players
        .filter((q) => q.raw !== p.raw && teamOfRaw(q.raw) !== teamOfRaw(p.raw))
        .map((q) => upTimes(q.raw, WEAPON_UPS));
      const foeCasts = castsOf(
        (raw) => teamOfRaw(raw) !== teamOfRaw(p.raw),
        raceOf(p.raw) === "프로토스" ? 0.25 : 0.05,
      );
      const myCasts = castsOf(
        (raw) => raw === p.raw,
        motion.players.some((q) => teamOfRaw(q.raw) !== teamOfRaw(p.raw) && raceOf(q.raw) === "프로토스")
          ? 0.25 : 0.05,
      );
      const castBoost = (list: [number, number][], sec: number): number =>
        list.reduce((a, [cs, w]) => a + (cs <= sec && sec - cs <= 12 ? w : 0), 0);
      /* 디바우러 산성 포자(지적: 곁에 있으면 공중이 약해진다) — 캐스트 기록은 없지만
         생산 기록은 있다. 상대 디바우러 수 × 내 공중 비중만큼 더 녹는다(기당 5%,
         상한 15%). */
      const prodTimes = (q: MotionTrack, filt: (u: string) => boolean): number[] =>
        Object.entries(q.prod ?? {}).filter(([u]) => filt(u))
          .flatMap(([u, secs]) => secs.map((x2) => x2 + (UNIT_SEC[u] ?? 20)))
          .sort((a, b) => a - b);
      const myAir = prodTimes(p, (u) => !!UNIT_KO[u] && isAirUnit(u));
      const myAll = prodTimes(p, (u) => !!UNIT_KO[u]);
      const foeDevourers = motion.players
        .filter((q) => teamOfRaw(q.raw) !== teamOfRaw(p.raw))
        .map((q) => prodTimes(q, (u) => u === "Devourer"));
      /* 다크 스웜(지적) — 스웜 아래 근접(대개 시전한 저그)은 원거리에 안 맞아 한결
         강해진다. 내 스웜이 최근 30초 안에 깔렸으면 20% 천천히 녹는다. */
      const mySwarms = motion.casts
        .filter((c) => c[3] === "Dark Swarm" && c[4] === p.raw).map((c) => c[0]);
      const myUnits = unitTimesOf(p);
      const foeUnits = new Map<string, number[]>();
      for (const q of motion.players) {
        if (teamOfRaw(q.raw) === teamOfRaw(p.raw)) continue;
        for (const [u, ts2] of unitTimesOf(q)) {
          foeUnits.set(u, [...(foeUnits.get(u) ?? []), ...ts2].sort((a, b) => a - b));
        }
      }
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
        if (now > prev && inHot(prev, now)) {
          const dt2 = now - prev;
          const atk = Math.max(0, ...foeWeapons.map((w) => countBy(w, prev)));
          const mult = (1 + 0.08 * atk) / (1 + 0.06 * countBy(myArmor, prev))
            * (1 + Math.min(0.6, castBoost(foeCasts, prev)))
            / (1 + Math.min(0.3, castBoost(myCasts, prev) * 0.6))
            * (1 + Math.min(0.15, Math.max(0, ...foeDevourers.map((d2) => countBy(d2, prev))) * 0.05)
              * (countBy(myAll, prev) > 0 ? countBy(myAir, prev) / countBy(myAll, prev) : 0))
            / (mySwarms.some((cs) => cs <= prev && prev - cs <= 30) ? 1.2 : 1);
          const myTot = Math.max(1, countBy(myAll, prev));
          let counterUp = 0;
          for (const [au, vu, w] of COUNTERS) {
            const eC = countBy(foeUnits.get(au) ?? [], prev);
            if (eC === 0) continue;
            counterUp += w * Math.min(1, eC / 6) * (countBy(myUnits.get(vu) ?? [], prev) / myTot);
          }
          const medics = countBy(myUnits.get("Medic") ?? [], prev);
          const bioN = countBy(myUnits.get("Marine") ?? [], prev) + countBy(myUnits.get("Firebat") ?? [], prev);
          const heal = Math.min(0.2, medics * 0.05) * Math.min(1, bioN / myTot);
          const mult2 = mult * (1 + Math.min(0.3, counterUp)) / (1 + heal);
          size = Math.max(0, size * Math.exp(-PROP * mult2 * dt2) - LIN * mult2 * dt2);
        }
        while (di < done.length && done[di] <= now) { size += 1; di += 1; }
        series.push([now, size]);
        prev = now;
      }
      out.set(p.raw, series);
    }
    return out;
  }, [motion, completionsByRaw, teamOfRaw, bases]);

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
  const castsNow = motion.casts.filter((c) => c[0] <= t
    && t - c[0] <= (c[3] === "Nuclear Strike" ? NUKE_FALL_SEC + 4
      : c[3] === "Dark Swarm" ? 30
        : c[3] === "Disruption Web" ? 25
          : c[3] === "Stasis Field" ? 20 : CAST_HOLD_SEC));
  /* 핵 착탄들 + 성공 판정(지적: 실패가 더 많다) — 발사가 다 착탄이 아니다(고스트가
     끊기면 불발). 착탄 시각 언저리(−2초~+90초)에 반경 안 건물이 실제로 무너진 발사만
     '터진 핵'으로 본다. 불발은 표적 점만 보이다 만다. 유닛 몰살도 터진 핵만이다. */
  const nukeImpacts = useMemo(() => motion.casts
    .filter((c) => c[3] === "Nuclear Strike")
    .map((c) => {
      const sec = c[0] + NUKE_FALL_SEC;
      const confirmed = motion.builds.some(([bs, bx2, by2, bu, , g2]) => {
        const gone = g2 ?? 0;
        return gone > 0 && gone >= sec - 2 && gone - sec <= 90 && bs <= sec
          && Math.hypot(bx2 + footDx(bu) - c[1], by2 + footDy(bu) - c[2]) <= 5;
      });
      return { sec, x: c[1], y: c[2], confirmed };
    }), [motion]);

  /* 태워진 유닛은 잠깐 사라진다(요청: 태운 자리의 유닛들은 안 보이다가 내리면 나타남) —
     태움 지점 곁에 서 있던, 그 뒤로 새 명령이 없는 마커는 다음 드랍(없으면 계속)까지
     숨는다. 내리면(드랍 시각이 지나면) 도로 나타난다 — 다 내렸는지는 알 수 없으니
     시각만 근거다. */
  /* 수송선 자취(걸어 편 것) — 아래 '곁에서 명령 끊김 = 탐' 판정이 그 시각의 수송선
     자리를 물어보는 데 쓴다. */
  const carrierWalks = useMemo(() => {
    const m = new Map<string, TrackPt[][]>();
    motion.players.forEach((p, pi) => {
      m.set(p.raw, scoutSquads[pi].filter((g) => g.kind === "carrier").map((g) => g.walk));
    });
    return m;
  }, [scoutSquads, motion]);
  const carriedGone = (
    p: MotionTrack, pos: { x: number; y: number }, lastOrderSec: number,
    // 지금 걷는 중인가 — 걷는 부대는 탄 것일 수 없다(아래 암묵 태움 판정의 걸림막).
    moving = false,
  ): boolean => {
    for (const [ls, lx, ly] of p.loads ?? []) {
      if (ls > t) break;
      const ds = (p.drops ?? []).find(([s]) => s > ls)?.[0] ?? Infinity;
      if (t >= ls && t < ds && lastOrderSec <= ls
        && Math.hypot(pos.x - lx, pos.y - ly) <= 5) return true;
    }
    /* 셔틀 곁에서 명령이 끊긴 애들은 탄 것(요청) — 태움 클릭이 안 잡혔어도, 마지막 명령
       순간 수송선이 바로 곁(3.5타일)에 있었고 그 수송선이 곧(25초 안) 10타일 넘게 날아
       갔으면 태워진 것으로 본다. 내림은 위 규칙과 같이 다음 드랍 신호까지다(없으면 계속
       — 새 자리의 명령이 새 부대로 태어나 그쪽이 이어 말한다).
       걸림막 셋(지적: 유닛 이동 중 마커가 사라진다 — 첫 판은 '지나가기만 한' 수송선에도
       걸렸다. 셔틀·오버로드는 본대와 나란히 다니기 일쑤라, 스쳐 간 것까지 태움으로 치면
       행군하던 부대가 통째로 증발한다):
         · 부대가 지금 걷는 중이면 안 탄 것이다 — 탄 유닛은 움직일 수 없다.
         · 수송선이 그 자리에 잠깐이라도 머물러야 한다(명령 앞뒤 3초 다 곁) — 태움은
           스치는 게 아니라 앉는 동작이다.
         · 그리고 곧 멀리 날아가야 한다 — 부대 위에 떠 있기만 한 오버로드 걸림막. */
    if (Number.isFinite(lastOrderSec) && lastOrderSec > 0 && !moving) {
      for (const w of carrierWalks.get(p.raw) ?? []) {
        if (w.length === 0 || lastOrderSec < w[0][0]) continue;
        const tp0 = posAt(w, lastOrderSec, null);
        if (!tp0 || Math.hypot(tp0.x - pos.x, tp0.y - pos.y) > 3.5) continue;
        const tpBefore = posAt(w, lastOrderSec - 3, null);
        const tpAfter = posAt(w, lastOrderSec + 3, null);
        if (!tpBefore || Math.hypot(tpBefore.x - pos.x, tpBefore.y - pos.y) > 4.5) continue;
        if (!tpAfter || Math.hypot(tpAfter.x - pos.x, tpAfter.y - pos.y) > 4.5) continue;
        /* 그리고 그 순간 수송선이 '서' 있었어야 한다(지적: 이동 중 마커가 사라졌다 멈추면
           나타난다) — 부대가 행군 틈에 잠깐 선 순간, 나란히 걷던 오버로드가 곁을 지나가기만
           해도 태움으로 쳤다. 앞뒤 6초의 변위가 1.5타일을 넘으면 지나가는 중이다. */
        if (Math.hypot(tpAfter.x - tpBefore.x, tpAfter.y - tpBefore.y) > 1.5) continue;
        const tp1 = posAt(w, lastOrderSec + 25, null);
        if (!tp1 || Math.hypot(tp1.x - tp0.x, tp1.y - tp0.y) < 10) continue;
        const ds = (p.drops ?? []).find(([s]) => s > lastOrderSec)?.[0] ?? Infinity;
        if (t >= lastOrderSec && t < ds) return true;
      }
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
  /* 핵 착탄 몰살(요청: 피통 계산까지) — 핵 피해는 최소 500(또는 최대체력의 2/3 중 큰
     쪽)이라 브루드워 유닛은 전부 체력이 모자란다(풀피 배틀크루저 500이 딱 경계). 착탄
     순간 반경(4.5타일) 안에 서 있었고(마지막 명령이 착탄 전) 그 뒤 새 명령이 없는
     마커는 그 핵에 정리된 것으로 본다. 건물은 위 goneEff(파괴 판정 당김)가 맡는다. */
  const nukedGone = (pos: { x: number; y: number }, lastOrderSec: number): boolean =>
    nukeImpacts.some((nk) => nk.confirmed && nk.sec <= t && lastOrderSec <= nk.sec
      && Math.hypot(pos.x - nk.x, pos.y - nk.y) <= 4.5);

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
              <span className="scr-motion-teamcol-name" style={chipStyle(m.key, m.team)}>{m.name}</span>
            </span>
            {winnerTeam && (m.team === 2 ? 2 : 1) === winnerTeam && t >= total - 0.5 && !fallen && (
              <span className="scr-motion-trophy">🏆</span>
            )}
          </div>
        );
      })}
    </div>
  );

  /* 범례 한 벌 — 지도 아래(인라인)와 확대 창 왼쪽 기둥(요청: 2열)이 같은 항목을 쓴다. */
  const legendItems = (
    <>
      {/* 유닛 갈래 도형(요청: 지대지/지대공/공중/마법으로 분리) — 지상은 채운 도형,
          공중은 속 빈 도형. 크기(소·중·대형)는 마커 크기가 말한다. */}
      {/* (삭제·요청) 갈래 대표 기호 — 유닛마다 제 모델이 생겨 갈래 범례는 걷었다. */}
      <span>■ 건물</span>
      {/* 일꾼은 채굴·정찰 없이 전부 같은 작은 점이다(요청: 통일). 기호는 지도의
          점과 같은 ●를 부대보다 한 단 작게(지적: •는 너무 작았다). */}
      <span><i className="scr-motion-legend-worker">●</i> 일꾼</span>
      <span>🔨 건설 중</span>
      <span>⏳🥚✨ 생산 중</span>
      <span>🧪🧬🔮 업그레이드 중</span>
    </>
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
        className={cx("scr-motion-map", pitched && "scr-motion-pitched")} ref={mapRef}
        onPointerDown={onMapPointerDown}
        onPointerMove={onMapPointerMove}
        onPointerUp={onMapPointerUp}
        onPointerCancel={onMapPointerUp}
        style={{
          /* 입체 보기(재구성: CSS 3D 빌보드가 브라우저 따라 누워 보임) — 바닥(자리·그림)만
             세로로 누르고, 마커는 눌리지 않은 채 서 있는 2.5D. */
          aspectRatio: `${grid.width} / ${grid.height * (pitched ? 0.74 : 1)}`,
          ...(zoom > 1 || pitched ? { overflow: "hidden" } : {}),
          ...(zoom > 1 ? { cursor: dragRef.current ? "grabbing" : "grab" } : {}),
        }}
      >
        {/* 렌즈 상자 — PC 휠 줌(요청)이 이 층을 통째로 키운다(마커·자취까지 같이). */}
        <div
          className="scr-motion-lens"
          style={zoom > 1 ? {
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center",
          } : undefined}
        >
        {grid.image
          ? (
            <img
              className="scr-motion-canvas" src={grid.image} alt={`${grid.name} 미니맵`}
              draggable={false}
              style={pitched ? (() => {
                const { q, cy } = pitchGeom();
                return { transform: `translateY(${(-cy).toFixed(1)}px) scale(${q.toFixed(4)}) perspective(${PITCH_P}px) rotateX(45deg)` };
              })() : undefined}
            />
          )
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
            /* 핵 한 방(요청) — 폭발 반경 안에서 무너진 걸로 판정된 건물은 파괴 감지가
               한참 뒤에 눈치챘더라도 착탄 순간 바로 걷는다. 이륙 이사 기록(liftAt)은
               goneAt이 착륙 시각이라 건드리지 않는다. */
            let goneEff = goneAt;
            if (goneAt > 0 && !liftAt) {
              for (const nk of nukeImpacts) {
                if (nk.sec <= goneAt && goneAt - nk.sec <= 90
                  && Math.hypot(x + footDx(unit) - nk.x, y + footDy(unit) - nk.y) <= 5) {
                  goneEff = Math.min(goneEff, nk.sec);
                }
              }
            }
            /* 페이드 인·아웃(요청) — 지어질 때 1.2초 스르륵 나타나고, 없어질 때 1.2초
               스르륵 사라진다. */
            const FADE_SEC = 1.2;
            const fade = Math.min(
              sec > 0 ? Math.min(1, (t - sec) / FADE_SEC) : 1,
              goneEff > 0 && t >= goneEff ? Math.max(0, 1 - (t - goneEff) / FADE_SEC) : 1,
            );
            if (goneEff > 0 && t >= goneEff + FADE_SEC) return null;
            if (fade <= 0) return null;
            // 떠 있는 구간(지적: 건물 떠 있는 게 표현이 안 된다) — 이륙부터 착륙(=goneAt)
            // 까지 옛 자리에서 둥실거린다.
            const afloat = !!liftAt && t >= liftAt;
            const razed = false;
            /* 같은 자리에 같은 계보의 새 건물이 서면(레어 진화·재건·콜로니 변태) 옛 것은
               걷는다(지적: 비활성 건물이 글자와 도형으로 동시 표시). 계보만 본다(지적:
               레어 되면서 없어짐 — 아무 새 건물이나 곁에 서면 옛 것을 지워 버렸다). */
            if (!razed && motion.builds.some(([s2, x2, y2, u2, r2], j) =>
              j !== i && r2 === raw && s2 > sec && s2 <= t && Math.hypot(x2 - x, y2 - y) <= 1.5
              && (u2 === unit
                || (["Hatchery", "Lair", "Hive"].includes(unit) && ["Hatchery", "Lair", "Hive"].includes(u2))
                || (unit.includes("Colony") && u2.includes("Colony"))))) {
              return null;
            }
            /* 착륙 이사(요청: 건물 움직임도 추적) — 같은 임자의 같은 건물이 내 시작
               시각에 걷혔으면 거기서 날아온 것이다. 나는 동안은 두 자리 사이를 비행
               속도로 잇는다. */
            let bx = x;
            let by = y;
            /* 짝의 걷힌 시각이 실제로 있어야(> 0) 한다(지적: 첫 기지가 위에서 내려온다) —
               시작 홀은 시작 시각이 0이라, 조건이 "gone === 0"이 되면 살아 있는 같은 종류
               건물 아무거나와 짝이 돼 거기서 날아왔다. */
            const flownFrom = sec > 0 && motion.builds.find(([, x2, y2, u2, r2, g2]) =>
              r2 === raw && u2 === unit && (g2 ?? 0) > 0 && (g2 ?? 0) === sec
              && (x2 !== x || y2 !== y)) || undefined;
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
            // 시작 건물(합성된 0초 홀)도 망치를 안 든다(지적: 처음 홀에 망치 표시는 왜?) —
            // 경기 시작에 이미 다 서 있던 건물이지, 짓는 중이 아니다.
            const raising = !razed && !flownFrom && sec > 0 && t - sec < (BUILD_SEC[unit] ?? 30);
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
            // 시작 건물은 액티브도 없다(요청: 처음 등장하는 건물·유닛은 액티브 안 주기).
            // (요청) 착공 직후 이름 창도 걷었다 — 모델이 정체를 말한다.
            const activeBuild = false;
            // 차례 계산에서 빠졌지만(지적: 무조건 신규 건물 우선) 판정 기반은 남겨둔다.
            void producing;
            void researching;
            const name = BUILDING_KO[unit] ?? UNIT_KO[unit];
            /* 비활성이면 무조건 도형이다(지적: 서플라이·파일런·포토·터렛이 영영 안 변했다 —
               "겹치지만 않으면 이름 상시 노출"이던 옛 규칙을 걷었다). */
            const isHall = ["Command Center", "Nexus", "Hatchery", "Lair", "Hive"].includes(unit);
            const shapeKind = SHAPE_KIND[unit];
            let text: string;
            // 테란 부속건물은 이름 대신 늘 +다(요청: "테란 부속건물은 +로 옆에 붙이기") —
            // 제 발자국 자리가 본체 오른쪽이라 저절로 옆에 붙는다.
            if (ADDONS.has(unit)) text = "+";
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
                  /* 입체 보기는 화가 순서(지적: 반투명 아닌데 뒤 건물이 보임) — 겹침을
                     화면 앞뒤(발자국 앞변 y)로 잰다. 같은 자리면 새 건물이 위(지적:
                     건물 위치 겹침 — 무조건 신규 우선). 평면도 신규 우선 — 생산·연구
                     부양(t)은 빼고 착공 시각만 본다(나는 중만 예외로 맨 위). */
                  zIndex: pitched
                    ? 1000 + Math.round((by + footDy(unit) * 2) * 80) + Math.min(70, Math.round(sec / 60))
                    : 1000 + Math.round(afloat ? t : sec),
                  ...(fade < 1 ? { opacity: fade } : {}),
                  ...depthMk(by + footDy(unit)),
                  ...posStyle(
                    bx + footDx(unit) - (ADDONS.has(unit) ? 1.6 : 0),
                    by + footDy(unit) + (ADDONS.has(unit) ? 0.4 : 0)
                      + (text !== name && !ADDONS.has(unit)
                        ? (shapeKind ? -riseOf(unit) / 2 : (FOOTPRINT[unit] ?? [3, 2])[1] * 0.1)
                        : 0),
                  ),
                  // 건물은 바닥 위로 솟는다(지적: "실제 건물은 바닥위에 높이가 있어") —
                  // 캔버스 높이에 그 몫(riseOf, 발자국 폭 비례)을 더하고, 늘어난 만큼
                  // 위로 올려 바닥선은 발자국 그대로다. 단 전용 벡터가 있는 건물만이다
                  // (지적: 벡터 없는 애들은 높이 생각 말고 바닥 캔버스로만) — 맨 네모가
                  // 높이 몫까지 늘어나면 발자국보다 세로로 긴 거짓 기둥이 된다.
                  // 벡터 없는 네모는 발자국의 80%로만 그린다(요청) — 대신 아래로 내려
                  // 바닥선은 발자국 바닥 그대로다.
                  // 캔버스 비율 = 발자국 폭 × (발자국 높이 + 벡터 건물만 높이 몫)(요청·지적).
                  ...(text !== name && (!ADDONS.has(unit) || shapeKind)
                    ? {
                      // 기지는 각 종족 제일 큰 건물(지적) — 같은 발자국이라도 크게 그린다.
                      width: pct((FOOTPRINT[unit] ?? [3, 2])[0] * (shapeKind ? 1 : 0.8) * (isHall ? 1.3 : 1), grid.width),
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
                {raising && !ADDONS.has(unit)
                  ? (
                    <ShapeIcon
                      kind={(bases.find((b) => b.key === raw)?.race) === "저그" ? "cocoon"
                        : (bases.find((b) => b.key === raw)?.race) === "프로토스" ? "warpin" : "scaffold"}
                      flat={!pitched} keepRatio viewYaw={viewYawOf(bx + footDx(unit), by + footDy(unit))}
                      className={(bases.find((b) => b.key === raw)?.race) === "저그" ? "scr-motion-cocoon" : undefined}
                    />
                  )
                  : shapeKind && text !== name
                  ? <ShapeIcon kind={shapeKind} flat={!pitched} keepRatio viewYaw={viewYawOf(bx + footDx(unit), by + footDy(unit))} />
                  : text === "■"
                    // 캔버스가 이미 발자국 비율이라(위 aspectRatio — 벡터 없으면 높이 몫도
                    // 없다) 네모는 그 상자를 그대로 채운다(CSS width/height 100%).
                    ? <i className="scr-motion-sq" />
                    : text}
                {/* (제거·요청) 건설·생산·연구 아이콘 — 공사는 종족 공용 모델(고치·
                    소환구·공사장)이 말하고, 생산·연구는 액티브 글로우가 말한다. */}
              </span>
            );
          });
        })()}

        {/* 갓 뽑힌 유닛(요청) — 뽑는 시간이 지나면 만든 건물 앞에 놓이고, 그 건물에 랠리가
            찍혀 있으면 그리로 걸어간다(지적: 랠리 포인트를 생각 못 해 건물 옆에 있다가
            갑자기 사라졌다 — 실제로는 랠리로 걸어간 것이다). 랠리에 닿고 잠시 뒤 걷히는
            것은 그 자리의 부대에 합류한 것으로 읽힌다. 같은 종류 건물이 여럿이면(게이트
            여럿) 차례로 나눠 놓는다. */}
        {motion.players.flatMap((p) => {
          const team = teamOfRaw(p.raw);
          const out: React.ReactNode[] = [];
          for (const [unit, secs] of Object.entries(p.prod ?? {})) {
            const producers = PRODUCER_OF[unit];
            if (!producers) continue;
            for (let si = 0; si < secs.length; si += 1) {
              const done = secs[si] + (UNIT_SEC[unit] ?? 20);
              // 랠리까지 걷는 시간(최대 60초) + 머무는 시간보다 지난 것은 볼 것도 없다.
              if (t < done || t - done > 60 + FRESH_HOLD_SEC) continue;
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
              // 건물 발자국의 왼쪽 아래에서 나온다(요청) — 더 바짝 붙여서(지적).
              const exitX = bx - 0.2;
              const exitY = by + (FOOTPRINT[bUnit] ?? [3, 2])[1] + 0.3;
              /* 랠리 목적지(지적) — 그 건물(태그)에 완성 전 마지막으로 찍힌 랠리. 태그가
                 안 맞으면(귀속 실패·옛 분석본) 그 사람의 마지막 랠리로 어림한다 — 랠리는
                 대개 한 방향(집결지)이라 건물이 달라도 크게 안 틀린다. */
              let rx: number | null = null;
              let ry: number | null = null;
              for (const [rs, rxx, ryy, rtag] of p.rly ?? []) {
                if (rs > done) break;
                if (tag > 0 && rtag === tag) { rx = rxx; ry = ryy; }
              }
              if (rx === null || ry === null) {
                for (const [rs, rxx, ryy] of p.rly ?? []) {
                  if (rs > done) break;
                  rx = rxx;
                  ry = ryy;
                }
              }
              let fx = exitX;
              let fy = exitY;
              let arrive = done;
              if (rx !== null && ry !== null) {
                /* 지상 유닛은 지형 길로 걷는다(지적: 벽뚫기가 랠리와 관련 있어 보인다) —
                   직선 보간이 벽을 그었다. 경로는 (출발, 목적지) 짝마다 한 번만 셈해
                   갈무리한다 — 매 프레임 BFS는 못 버틴다. */
                const air = isAirUnit(unit);
                let route: [number, number][] = [[exitX, exitY], [rx, ry]];
                if (!air && terrain) {
                  const key = `${Math.round(exitX)},${Math.round(exitY)}>${rx},${ry}`;
                  let hit = rallyRoutes.current.get(key);
                  if (!hit) {
                    // 둘 다 끊겼으면 차선(벽 회피 다익스트라) — walkTrack과 같은 이유.
                    const found = groundPath(
                      terrain, exitX / grid.width, exitY / grid.height,
                      rx / grid.width, ry / grid.height,
                    ) ?? (terrainRaw ? groundPath(
                      terrainRaw, exitX / grid.width, exitY / grid.height,
                      rx / grid.width, ry / grid.height,
                    ) : null) ?? groundPathSoft(
                      terrainRaw ?? terrain, exitX / grid.width, exitY / grid.height,
                      rx / grid.width, ry / grid.height,
                    );
                    hit = found
                      ? [[exitX, exitY] as [number, number],
                        ...found.map(([nx, ny]) => [nx * grid.width, ny * grid.height] as [number, number])]
                      : route;
                    rallyRoutes.current.set(key, hit);
                  }
                  route = hit;
                }
                let total = 0;
                const lens: number[] = [];
                for (let ri = 1; ri < route.length; ri += 1) {
                  const d = Math.hypot(route[ri][0] - route[ri - 1][0], route[ri][1] - route[ri - 1][1]);
                  lens.push(d);
                  total += d;
                }
                const v = Math.max(0.5, speedOf(unit, done, p.ups));
                const travel = Math.min(60, total / v);
                arrive = done + travel;
                const k = travel > 0 ? Math.min(1, (t - done) / travel) : 1;
                // 경로 길이 k 비율 지점까지 걷는다.
                let want = total * k;
                fx = route[route.length - 1][0];
                fy = route[route.length - 1][1];
                for (let ri = 1; ri < route.length; ri += 1) {
                  if (want <= lens[ri - 1]) {
                    const f = lens[ri - 1] > 0 ? want / lens[ri - 1] : 1;
                    fx = route[ri - 1][0] + (route[ri][0] - route[ri - 1][0]) * f;
                    fy = route[ri - 1][1] + (route[ri][1] - route[ri - 1][1]) * f;
                    break;
                  }
                  want -= lens[ri - 1];
                }
              }
              if (t > arrive + FRESH_HOLD_SEC) continue;
              // 이동 방향(요청) — 랠리 목적지를 향한다.
              const hdg = rx !== null && ry !== null && Math.hypot(rx - fx, ry - fy) > 0.1
                ? Math.atan2(-(rx - fx), ry - fy) * (180 / Math.PI) : 0;
              out.push(
                <span
                  key={`fresh-${p.raw}-${unit}-${si}`}
                  className="scr-motion-fresh"
                  style={{
                    ...posStyle(fx, fy),
                    ...depthMk(fy),
                    ...glyphStyle(p.raw, team),
                  }}
                >
                  {/* 갓 나온 유닛도 상징물(요청) — 일꾼도 제 모델로 랠리까지 걷는다. */}
                  <ShapeIcon kind={unitMarkerKind(unit, bases.find((b) => b.key === p.raw)?.race)} rotDeg={hdg} flat={!pitched} viewYaw={viewYawOf(fx, fy)} className="scr-motion-troop" />
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
          /* 저그 가스는 변태(지적) — 익스트랙터 하나마다 드론 하나가 사라져 그 자리에
             가스가 된다. 채굴 일꾼 수에서 그만큼 뺀다. */
          const ownerRace = bases.find((b) => b.key === owner!.raw)?.race;
          if (ownerRace === "저그") {
            const morphed = motion.builds.filter(([bs, , , bu, br]) =>
              br === owner!.raw && bu === "Extractor" && bs <= t).length;
            workerN = Math.max(0, workerN - morphed);
          }
          if (workerN === 0) return [];
          const team = teamOfRaw(owner.raw);
          const dots = Math.min(3, Math.max(1, Math.ceil(workerN / 10)));
          /* 채굴 걸음을 실제 일꾼 걸음으로(지적: 일꾼 속도가 왜 이렇게 빠르냐) — 예전
             사인파는 거리와 무관하게 7초에 한 왕복이라, 먼 홀(18타일까지)에선 점이 실제
             일꾼(3.7타일/초)보다 빨리 내달렸고 캐는 멈춤도 없었다. 이제 구간 길이만큼
             일꾼보다 살짝 느린 걸음(가감속 감안)으로 걷고, 양 끝에서 캐고 내리는 동안
             멈춘다 — 거리가 멀수록 왕복이 오래 걸리는, 눈에 익은 그 리듬이다. */
          const legTiles = Math.hypot(owner.x - res[0], owner.y - res[1]) * 0.7;
          const MINE_WALK = 2.6;
          const MINE_DWELL = 2;
          const leg = legTiles / MINE_WALK;
          const period = 2 * (leg + MINE_DWELL);
          return Array.from({ length: dots }, (_, i) => {
            // 점·지대마다 위상을 어긋내 셋이 같이 안 다니게 한다(결정적 — 프레임마다 안 튐).
            const u = ((t + i * 5.3 + ri * 2.7) % period + period) % period;
            const k = u < leg ? u / leg
              : u < leg + MINE_DWELL ? 1
                : u < 2 * leg + MINE_DWELL ? 1 - (u - leg - MINE_DWELL) / leg
                  : 0;
            const x = res[0] + (owner!.x - res[0]) * (0.15 + 0.7 * k);
            const y = res[1] + (owner!.y - res[1]) * (0.15 + 0.7 * k);
            // 걷는 방향(요청: 일꾼도 모델·방향) — 갈 때는 홀 쪽, 올 때는 자원 쪽.
            const toHall = u < leg ? 1 : u < leg + MINE_DWELL ? 0 : u < 2 * leg + MINE_DWELL ? -1 : 0;
            const hdg = toHall !== 0
              ? Math.atan2(-((owner!.x - res[0]) * toHall), (owner!.y - res[1]) * toHall) * (180 / Math.PI) : 0;
            return (
              <span
                key={`mine-${ri}-${i}`}
                className="scr-motion-miner"
                style={{
                  ...posStyle(x, y),
                  ...depthMk(y),
                  ...glyphStyle(owner!.raw, team),
                }}
              >
                {/* 일꾼류는 직접 모델링(요청) — 종족 일꾼 상징물이 오간다. */}
                <ShapeIcon kind={workerKindOf(ownerRace)} rotDeg={hdg} flat={!pitched} viewYaw={viewYawOf(x, y)} className="scr-motion-troop" />
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
              style={{ ...posStyle(m.x, m.y) }}
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
          /* 주 부대 = 여태 명령을 가장 많이 받은 부대(지적: 구성 칩이 두 그룹 사이를
             계속 순간이동) — '가장 최근 명령'으로 고르면 앞마당 수비 클릭 한 번에 본대
             칩이 그리로 튀고, 다음 본대 클릭에 되튀었다. 누적 명령 수는 천천히 변해
             칩이 본대에 눌러앉는다. 동수면 최근 쪽이 이긴다. */
          let primary = 0;
          let bestN = -1;
          let bestLast = -Infinity;
          raws.forEach((sq, si) => {
            let n = 0;
            let last = -Infinity;
            for (const pt of sq) {
              if (pt[0] > t) break;
              n += 1;
              last = pt[0];
            }
            if (n > bestN || (n === bestN && last > bestLast)) {
              primary = si;
              bestN = n;
              bestLast = last;
            }
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
            /* 가운데로 휘는 곡선(bend)은 걷은 자취에 안 얹는다(지적: 일꾼·유닛이 왜 이렇게
               빠르냐) — walkTrack이 이미 유닛 속도로 시간을 배분해 놨는데, 그 구간을 곡선
               으로 늘리면 같은 시간에 더 긴 길을 미끄러져 실제보다 빨라 보였다(실측 3.7
               타일/초짜리 일꾼이 4.7로). 곡선은 walkTrack 이전, 명령 점을 그대로 잇던
               시절의 장치다. */
            const pos = posAt(rp, t, null);
            if (!pos) return [];
            let sinceCmd = Infinity;
            for (const [sec] of g.raw) {
              if (sec > t) break;
              sinceCmd = t - sec;
            }
            if (sinceCmd > SQUAD_FADE_SEC) return [];
            if (Number.isFinite(sinceCmd) && deadBy(t - sinceCmd)) return [];
            // 태워진 동안은 숨는다(요청) — 내리면 나타난다.
            if (carriedGone(p, pos, Number.isFinite(sinceCmd) ? t - sinceCmd : -1, pos.moving)) return [];
            // 건설에 흡수(지적: 익스트랙터 만든 드론이 남는다) — 일꾼 묶음만.
            if (g.unit === "Worker" && !pos.moving && Number.isFinite(sinceCmd)
              && buildAbsorbed(p, pos, t - sinceCmd)) return [];
            // 무너진 기지 곁에서 침묵 — 그 함락에서 정리된 것(지적).
            if (razedNearby(p, pos, Number.isFinite(sinceCmd) ? t - sinceCmd : 0)) return [];
            /* 배틀크루저 예외(지적: 방업 여부도 고려해서 뺄지 말지) — 500피 경계라
               방업(함선 장갑)이 돼 있을 때만 핵에서 살아남는 것으로 본다. */
            const bcTough = (BY_UNITS[g.unit] ?? [g.unit]).includes("Battlecruiser")
              && (p.ups ?? []).some(([us, n]) => n === "Terran Ship Plating" && us <= t);
            if (!bcTough
              && nukedGone(pos, Number.isFinite(sinceCmd) ? t - sinceCmd : 0)) return [];
            return [{ g, gi, pos, sinceCmd }];
          });
          const shownUnits = new Set(typeMarks.flatMap(({ g }) => BY_UNITS[g.unit] ?? [g.unit]));
          /* 액티브 말풍선(요청: 이름 칩으로 바꾸지 말고 도형은 유지, 말풍선으로 무엇인지
             알려주기) — 액티브인 마커들이 여기에 제 구성([한글 이름, 수])을 적어 두면,
             가까운 것끼리(8타일) 한 풍선으로 묶여 마커 위에 뜬다(요청: 겹치지 않게 가까운
             유닛들은 하나의 말주머니로). */
          const bubbles: { x: number; y: number; parts: [string, number][] }[] = [];
          const addBubble = (x: number, y: number, parts: [string, number][]) => {
            if (parts.length === 0) return;
            const near = bubbles.find((b) => Math.hypot(b.x - x, b.y - y) <= 8);
            if (!near) { bubbles.push({ x, y, parts: [...parts] }); return; }
            // 같은 이름은 수를 합친다 — "질럿 4"와 "질럿 3"이 두 줄이면 딴 부대로 읽힌다.
            for (const [ko, n] of parts) {
              const hit = near.parts.find((q) => q[0] === ko);
              if (hit) hit[1] += n;
              else near.parts.push([ko, n]);
            }
          };
          void addBubble; // 유닛 이름 말풍선 제거(요청)로 지금은 안 쓴다 — 기반만 남긴다.
          /* 같은 종류가 여러 부대로 갈라졌으면 수도 갈라 적는다(지적: 저글링 10이 5·5,
             3·3·4처럼 갈라지는 모션) — 어느 쪽에 몇이 갔는지는 안 남으니 고르게 나눈다. */
          const squadsOfUnit = new Map<string, number>();
          for (const { g } of typeMarks) squadsOfUnit.set(g.unit, (squadsOfUnit.get(g.unit) ?? 0) + 1);
          const seenOfUnit = new Map<string, number>();
          /* 아비터 은신장(요청) — 아비터 곁(6타일)의 아군 유닛은 반투명해진다. */
          const arbSpots = typeMarks
            .filter(({ g }) => (BY_UNITS[g.unit] ?? [g.unit]).includes("Arbiter"))
            .map(({ pos }) => pos);
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
            /* 묶음 이름("바이오닉")을 그대로 안 쓴다(요청: 합쳐 부르지 않기) — 자리는
               하나여도(리플레이가 스팀팩 같은 묶음 커맨드 단위로만 정체를 말한다) 이름은
               식구별로 갈라 적는다: "마린 8 · 메딕 2". 같은 한글 이름(시즈/퉁퉁 탱크)은
               하나로 합산하고, 수를 하나도 모르면 묶음 이름으로 물러난다. */
            const groupParts: [string, number][] = (() => {
              if (members.length > 1 && aliveAll > 0) {
                const factor = alive / aliveAll;
                const byKo = new Map<string, number>();
                for (const u of members) {
                  const ko = UNIT_KO[u] ?? u;
                  const n = Math.round(aliveOf(u) * factor);
                  if (n > 0) byKo.set(ko, (byKo.get(ko) ?? 0) + n);
                }
                if (byKo.size > 0) return [...byKo].sort((a, b) => b[1] - a[1]);
              }
              return [[groupKo, alive]];
            })();
            /* 일꾼과 수송선은 이름을 안 띄운다(요청) — 일꾼은 늘 작은 점, 수송선은 늘
               제 도형(오버로드 풍선·드랍십·셔틀)이다. */
            const noName = g.unit === "Worker" || g.unit === "Transport";
            const activeNow = !noName && sinceCmd <= ACTIVE_HOLD_SEC;
            /* 액티브라도 마커는 도형 그대로다(요청: 이름으로 바꾸지 말고 말풍선으로) —
               무엇인지는 위의 말풍선이 말한다. */
            // (제거·요청) 유닛 이름 말풍선 — 모델링이 끝나 도형이 정체를 말한다.
            void groupParts;
            void activeNow;
            /* 클로킹 유닛은 반투명(요청) — 옵저버·다크는 늘, 레이스·고스트는 클로킹 연구
               뒤부터. 칩이든 점이든 같이 옅어진다(요청). */
            const cloaked = g.unit === "Observer" || g.unit === "Dark Templar"
              || (!(BY_UNITS[g.unit] ?? [g.unit]).includes("Arbiter")
                && arbSpots.some((ap) => Math.hypot(ap.x - pos.x, ap.y - pos.y) <= 6))
              || (g.unit === "Wraith" && (p.ups ?? []).some(([us, n]) => n === "Cloaking Field" && us <= t))
              || (g.unit === "Ghost" && (p.ups ?? []).some(([us, n]) => n === "Personnel Cloaking" && us <= t));
            // 수송선·일꾼은 낱개로 안 흩는다 — 수는 원래 안 적던 갈래다(제 도형·점 하나).
            if (g.unit === "Transport" || g.unit === "Worker") {
              return (
                <span
                  key={`${p.raw}-u${g.unit}-${gi}`}
                  className={cx(
                    "scr-motion-army",
                    "scr-motion-dot",
                    g.unit === "Worker" && "scr-motion-scout",
                    team === 2 ? "scr-motion-team2" : "scr-motion-team1",
                    cloaked && "scr-motion-cloaked",
                  )}
                  style={{
                    /* 자리·깊이·차례 모두 회피 좌표로(지적: 건물 뒤 유닛이 보임) —
                       회피가 건물 뒤로 밀어냈으면 차례도 뒤여야 한다. */
                    ...(() => {
                      const [ax3, ay3] = dodge(pos.x, pos.y);
                      return {
                        ...posStyle(ax3, ay3), ...depthMk(ay3),
                        zIndex: pitched ? 1000 + Math.round(ay3 * 80)
                          : 1000 + Math.round(Number.isFinite(sinceCmd) ? t - sinceCmd : g.walk[0][0]),
                      };
                    })(),
                    ...glyphStyle(p.raw, team),
                  }}
                >
                  {g.unit === "Transport"
                    ? (
                      <ShapeIcon
                        kind={race === "저그" ? "ovie" : race === "테란" ? "dship" : "shuttle"}
                        rotDeg={headingOf(g.walk, pos)}
                        className="scr-motion-ovie" flat={!pitched} viewYaw={viewYawOf(pos.x, pos.y)}
                      />
                    )
                    : <ShapeIcon kind={workerKindOf(race)} flat={!pitched} viewYaw={viewYawOf(pos.x, pos.y)} className="scr-motion-troop" />}
                </span>
              );
            }
            /* 낱개 마커(요청: 같은 유닛이라도 합치지 말고 하나하나 — 대신 작게) — 수만큼
               도형을 해바라기 나선으로 촘촘히 흩는다(결정적 — 프레임마다 안 튄다). 갈래
               도형(UNIT_CLASS)과 덩치 크기(UNIT_BULK)가 유닛의 정체를 말한다. */
            /* 묶음(바이오닉 등)은 유닛마다 제 도형·제 덩치로(지적: 질럿과 마린 크기가
               다르다 — 묶음 이름 "Bionic"이 도형·덩치 표에 없어 통째로 대형 삼각형이
               됐다). 구성 비율대로 낱개를 채운다. */
            const glyphUnits: string[] = [];
            if (members.length > 1 && aliveAll > 0) {
              const factor = alive / aliveAll;
              for (const u of members) {
                const cnt = Math.round(aliveOf(u) * factor);
                for (let k = 0; k < cnt && glyphUnits.length < 36; k += 1) glyphUnits.push(u);
              }
            }
            if (glyphUnits.length === 0) {
              const n0 = Math.max(1, Math.min(36, alive));
              for (let k = 0; k < n0; k += 1) glyphUnits.push(g.unit);
            }
            /* 같은 자리 무리는 아주 촘촘히 겹친다(지적: 퍼짐이 심해졌다 — 겹치면서도
               규모는 보이게). 묶음(gi)마다 나선을 돌려 두 무리가 포개지지 않게만 한다. */
            /* 전투 중(요청: 전투 효과) — 이 사람의 전투 구간(hot) 안이고 이 부대가
               방금도 부려졌으면 불꽃이 튀고, 주기적으로 사망 퍼프가 터진다. */
            const fighting = sinceCmd <= 15
              && (p.hot ?? []).some(([a2, b2]) => t >= a2 && t <= b2);
            const cyc = Math.floor(t / 1.5);
            const hdg = headingOf(g.walk, pos);
            const seed = gi * 1.7;
            return glyphUnits.map((u, di) => {
              const bulk = UNIT_BULK[u] ?? 2;
              // 조금 겹침 허용(지적: 너무 떨어져 징그러움) — 반지름을 한 단 좁힌다.
              const r = (0.3 + 0.09 * bulk) * Math.sqrt(di + 0.35);
              /* 랜덤성 섞기(지적: 고정 나선이 부자연스럽다) — 해시 지터(반경·각을
                 유닛마다 조금씩 어긋냄)와 위상 다른 느린 배회를 얹는다. 전부 (di,seed,t)의
                 순수 함수라 프레임마다 안 튀고, 같은 유닛은 늘 같은 버릇으로 서성인다. */
              const h1 = Math.sin(di * 127.1 + seed * 311.7) * 43758.5453;
              const jr = h1 - Math.floor(h1);
              const h2 = Math.sin(di * 269.5 + seed * 183.3) * 28001.8384;
              const ja = h2 - Math.floor(h2);
              // (정리) 걸음 요동 일습 제거(지적: 꿀렁댐) — 정적 나선 지터만 남긴다.
              const churn = ja * 3.1;
              const rj = r * (0.85 + jr * 0.5);
              const aj = di * 2.4 + seed + ja * 1.1 + churn;
              const dx = Math.cos(aj) * rj;
              const dy = Math.sin(aj) * rj;
              return (
                <span
                  key={`${p.raw}-u${g.unit}-${gi}-i${di}`}
                  className={cx(
                    "scr-motion-army",
                    "scr-motion-dot",
                    `scr-motion-unit-${bulk === 0 ? "s" : bulk === 1 ? "m" : "l"}`,
                    team === 2 ? "scr-motion-team2" : "scr-motion-team1",
                    cloaked && "scr-motion-cloaked",
                  )}
                  style={{
                    ...(() => {
                      const [ax3, ay3] = dodge(pos.x + dx, pos.y + dy);
                      return {
                        ...posStyle(ax3, ay3), ...depthMk(ay3),
                        zIndex: pitched ? 1000 + Math.round(ay3 * 80)
                          : 1000 + Math.round(Number.isFinite(sinceCmd) ? t - sinceCmd : g.walk[0][0]),
                      };
                    })(),
                    ...glyphStyle(p.raw, team),
                  }}
                >
                  <ShapeIcon kind={unitMarkerKind(u, bases.find((b) => b.key === p.raw)?.race)} rotDeg={hdg} flat={!pitched} viewYaw={viewYawOf(pos.x + dx, pos.y + dy)} className="scr-motion-troop" />
                  {/* 전투 불꽃·사망 퍼프(요청) — 대여섯에 하나씩 불꽃, 일곱에 하나씩
                      돌아가며 퍼프(1.5초 주기 결정적 순환이라 프레임마다 안 튄다). */}
                  {fighting && ATTACK_FX[u] && di % 4 === 0 && (
                    <span className={`scr-motion-atkfx scr-fxa-${ATTACK_FX[u]}`} />
                  )}
                  {fighting && (di + cyc) % 7 === 0 && (
                    <span key={`pf-${cyc}`} className="scr-motion-puff" />
                  )}
                  {/* 캐리어는 전투 때 인터셉터가 주위를 난다(요청) — 작은 점 셋이 궤도. */}
                  {fighting && u === "Carrier" && [0, 1, 2].map((ci) => (
                    <span
                      key={`ic-${ci}`}
                      className="scr-motion-ceptor"
                      style={{
                        left: `${50 + Math.cos(t * 2.2 + ci * 2.1) * 95}%`,
                        top: `${50 + Math.sin(t * 2.9 + ci * 2.1) * 85}%`,
                      }}
                    />
                  ))}
                </span>
              );
            });
          });
          const squadNodes = squads.map((rp, si) => {
            /* 첫 부대 명령 전에는 아예 없다(지적: 시작하자마자 이상한 데 멈춰 있다) —
               posAt은 첫 점 이전이면 첫 점 자리를 돌려줘서, 병력이 생기기도 전에 마커가
               '앞으로 갈 자리'에 서 있었다. 그동안의 움직임은 정찰 점(spts)이 맡는다. */
            if (rp.length === 0 || t < rp[0][0]) return null;
            // 걷은 자취에는 곡선을 안 얹는다 — 위 typeMarks의 bend 주석과 같은 이유.
            const pos = posAt(rp, t, null);
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
            if (carriedGone(p, pos, Number.isFinite(sinceCmd) ? t - sinceCmd : -1, pos.moving)) return null;
            // 무너진 기지 곁에서 침묵 — 그 함락에서 정리된 것(지적).
            if (razedNearby(p, pos, Number.isFinite(sinceCmd) ? t - sinceCmd : 0)) return null;
            if (nukedGone(pos, Number.isFinite(sinceCmd) ? t - sinceCmd : 0)) return null;
            /* 유닛 수는 컨트롤이 먼저다(요청: 컨트롤 기준으로 죽음 처리를 안 해서 계속
               쌓여만 간다) — 완성 누계 어림은 전투 감쇠로만 줄어서 실제 전멸을 못 따라간다.
               최근 이 자리를 찍은 선택의 최대 크기가 12 미만이면 남은 병력을 그 크기로
               본다: 병력이 더 있었다면 선택이 게임 한계(12)를 쳤을 것이다. 12를 꽉 채운
               선택은 "12 이상"이라는 하한일 뿐이라(대군은 부대지정 여러 개) 어림을 둔다. */
            const ctrl = ctrlNear(p, pos);
            const shownSize = ctrl > 0 && ctrl < 12 && ctrl < size ? ctrl : size;
            /* 생산 직후에도 깨어 있다(요청) — 갓 나온 유닛은 명령을 안 받았어도 지금
               이야기의 일부다. 완성은 사람 단위 값이라 주 부대만 깨운다. */
            let freshDone = false;
            if (si === primary) {
              for (const d of completionsByRaw.get(p.raw) ?? []) {
                if (d > t) break;
                freshDone = t - d <= FRESH_ACTIVE_SEC;
              }
            }
            /* 커맨드 직후 한동안만 이름이다(요청) — 이동 중이라고 계속 액티브면 지도가
               이름으로 덮여 정작 새 명령이 안 보인다. 창이 지나면 걷는 중이어도 점이다. */
            const activeNow = sinceCmd <= ACTIVE_HOLD_SEC || freshDone;
            const showName = si === primary && activeNow && !!unit && (shownSize >= 1 || !!SCOUT_KO[unit]);
            /* 무명 부대의 구성 — 제 마커를 가진 종류(shownUnits)는 뺀다: 같은 탱크가 제
               마커와 부대 칩에 두 번 적히면 수가 배로 읽힌다.
               컨트롤이 합계를 눌렀으면 구성도 같은 비율로 눌러 적는다 — 합은 12인데
               구성 합이 30이면 서로 딴소리가 된다. */
            const partScale = size > 0 && shownSize < size ? shownSize / size : 1;
            const parts: [string, number][] = [];
            for (const [u] of unitDoneByRaw.get(p.raw) ?? []) {
              if (shownUnits.has(u)) continue;
              const alive = Math.round(aliveOf(u) * partScale);
              if (alive >= 1) parts.push([u, alive]);
            }
            parts.sort((a, b) => b[1] - a[1]);
            /* 액티브면 구성을 말풍선에 적는다(요청: 마커는 도형 유지, 말풍선으로) — 자리는
               부대 자리 하나뿐이라 풍선도 하나고, 곁의 액티브 유닛 마커들과는 addBubble이
               알아서 합친다. */
            // (제거·요청) 유닛 이름 말풍선 — 모델이 정체를 말한다.
            void showName;
            /* 낱개 마커(요청: 같은 유닛이라도 합치지 말고 하나하나 — 대신 작게) — 구성
               (parts)의 유닛 수만큼 각자의 갈래 도형·덩치 크기로 흩는다. 구성을 모르면
               우세 유닛의 도형으로 규모만큼, 곁 부대는 규모를 모르니 하나다. */
            const glyphs: string[] = [];
            if (si === primary) {
              const src: [string, number][] = parts.length > 0
                ? parts
                : (unit ? [[unit, Math.max(1, shownSize)]] : []);
              for (const [u, cnt] of src) {
                for (let i = 0; i < cnt && glyphs.length < 36; i += 1) glyphs.push(u);
              }
            }
            if (glyphs.length === 0) glyphs.push(unit || "Marine");
            // 퍼짐 보정(요청) — 위 typeNodes의 seed 주석과 같은 규칙(부대 번호로 나선 회전).
            /* 전투 중(요청) — 위 typeNodes와 같은 규칙. */
            const fighting = sinceCmd <= 15
              && (p.hot ?? []).some(([a2, b2]) => t >= a2 && t <= b2);
            const cyc = Math.floor(t / 1.5);
            const hdg = headingOf(rp, pos);
            const seed = si * 1.7;
            return glyphs.map((u, di) => {
              const bulk = UNIT_BULK[u] ?? 2;
              // 아주 촘촘히(지적: 퍼짐이 심해졌다 — 겹치되 규모는 보이게).
              // 조금 겹침 허용(지적: 너무 떨어져 징그러움) — 반지름을 한 단 좁힌다.
              const r = (0.3 + 0.09 * bulk) * Math.sqrt(di + 0.35);
              /* 랜덤성 섞기(지적: 고정 나선이 부자연스럽다) — 해시 지터(반경·각을
                 유닛마다 조금씩 어긋냄)와 위상 다른 느린 배회를 얹는다. 전부 (di,seed,t)의
                 순수 함수라 프레임마다 안 튀고, 같은 유닛은 늘 같은 버릇으로 서성인다. */
              const h1 = Math.sin(di * 127.1 + seed * 311.7) * 43758.5453;
              const jr = h1 - Math.floor(h1);
              const h2 = Math.sin(di * 269.5 + seed * 183.3) * 28001.8384;
              const ja = h2 - Math.floor(h2);
              // (정리) 걸음 요동 일습 제거(지적: 꿀렁댐) — 정적 나선 지터만 남긴다.
              const churn = ja * 3.1;
              const rj = r * (0.85 + jr * 0.5);
              const aj = di * 2.4 + seed + ja * 1.1 + churn;
              const dx = Math.cos(aj) * rj;
              const dy = Math.sin(aj) * rj;
              return (
                <span
                  key={`${p.raw}-s${si}-d${di}`}
                  className={cx(
                    "scr-motion-army",
                    "scr-motion-dot",
                    `scr-motion-unit-${bulk === 0 ? "s" : bulk === 1 ? "m" : "l"}`,
                    team === 2 ? "scr-motion-team2" : "scr-motion-team1",
                  )}
                  style={{
                    ...(() => {
                      const [ax3, ay3] = dodge(pos.x + dx, pos.y + dy);
                      return {
                        ...posStyle(ax3, ay3), ...depthMk(ay3),
                        // 겹침 차례 — 평면은 마지막 명령 시각, 입체는 화면 앞뒤(회피 좌표).
                        zIndex: pitched ? 1000 + Math.round(ay3 * 80)
                          : 1000 + Math.round(Number.isFinite(sinceCmd) ? t - sinceCmd : rp[0][0]),
                      };
                    })(),
                    ...glyphStyle(p.raw, team),
                  }}
                >
                  <ShapeIcon kind={unitMarkerKind(u, bases.find((b) => b.key === p.raw)?.race)} rotDeg={hdg} flat={!pitched} viewYaw={viewYawOf(pos.x + dx, pos.y + dy)} className="scr-motion-troop" />
                  {/* 전투 불꽃·사망 퍼프(요청) — 대여섯에 하나씩 불꽃, 일곱에 하나씩
                      돌아가며 퍼프(1.5초 주기 결정적 순환이라 프레임마다 안 튄다). */}
                  {fighting && ATTACK_FX[u] && di % 4 === 0 && (
                    <span className={`scr-motion-atkfx scr-fxa-${ATTACK_FX[u]}`} />
                  )}
                  {fighting && (di + cyc) % 7 === 0 && (
                    <span key={`pf-${cyc}`} className="scr-motion-puff" />
                  )}
                  {/* 캐리어는 전투 때 인터셉터가 주위를 난다(요청) — 작은 점 셋이 궤도. */}
                  {fighting && u === "Carrier" && [0, 1, 2].map((ci) => (
                    <span
                      key={`ic-${ci}`}
                      className="scr-motion-ceptor"
                      style={{
                        left: `${50 + Math.cos(t * 2.2 + ci * 2.1) * 95}%`,
                        top: `${50 + Math.sin(t * 2.9 + ci * 2.1) * 85}%`,
                      }}
                    />
                  ))}
                </span>
              );
            });
          });
          /* 말풍선 그리기 — 위에서 모인 것을 자리(겹침 회피)만 다듬어 얹는다. 폰트는 수와
             무관하게 고정이고(요청) 모바일 축소는 CSS 미디어가 맡는다. */
          const placed: { x: number; y: number }[] = [];
          const bubbleNodes = bubbles
            .sort((a, b) => a.y - b.y)
            .map((b, bi) => {
              let by = b.y;
              // 겹치지 않게(요청) — 앞서 놓인 풍선과 가로로 가깝고 세로로도 붙으면 위로 민다.
              for (const q of placed) {
                if (Math.abs(q.x - b.x) < 16 && Math.abs(q.y - by) < 5) by = q.y - 5;
              }
              placed.push({ x: b.x, y: by });
              const bg = modeColor(p.raw, team);
              return (
                <span
                  key={`${p.raw}-bub${bi}`}
                  className="scr-motion-bubble"
                  style={{
                    ...posStyle(b.x, by),
                    zIndex: 20000 + bi,
                    ...chipStyle(p.raw, team),
                    "--bub": bg,
                  } as React.CSSProperties}
                >
                  {b.parts.map(([ko, n]) => (
                    <span key={ko}>{ko}{n > 0 ? ` ${n}` : ""}</span>
                  ))}
                </span>
              );
            });
          return [...typeNodes, ...squadNodes, ...bubbleNodes];
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
            if (carriedGone(p, pos, Number.isFinite(sinceCmd) ? t - sinceCmd : -1, pos.moving)) return null;
            // 건설에 흡수(지적: 익스트랙터 만든 드론이 남는다) — 일꾼 점만.
            if (g.kind === "worker" && !pos.moving && Number.isFinite(sinceCmd)
              && buildAbsorbed(p, pos, t - sinceCmd)) return null;
            // 무너진 기지 곁에서 침묵 — 그 함락에서 정리된 것(지적).
            if (razedNearby(p, pos, Number.isFinite(sinceCmd) ? t - sinceCmd : 0)) return null;
            if (nukedGone(pos, Number.isFinite(sinceCmd) ? t - sinceCmd : 0)) return null;
            /* 정찰은 이름을 아예 안 띄운다(지적: 일꾼 이름 뜨는 게 문제 맞다) — 일꾼은
               늘 작은 점, 수송선·오버로드는 늘 제 도형이다. 칩으로 커지는 일이 없으니
               커졌다 작아졌다도 없다. */
            const hdg = headingOf(rp, pos);
            const activeNow = false;
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
                  ...(() => {
                    const [ax3, ay3] = dodge(pos.x, pos.y);
                    return {
                      ...posStyle(ax3, ay3), ...depthMk(ay3),
                      // 겹침 차례 — 평면은 마지막 명령 시각, 입체는 화면 앞뒤(회피 좌표).
                      zIndex: pitched ? 1000 + Math.round(ay3 * 80)
                        : 1000 + Math.round(Number.isFinite(sinceCmd) ? t - sinceCmd : rp[0][0]),
                    };
                  })(),
                  ...(activeNow ? chipStyle(p.raw, team) : glyphStyle(p.raw, team)),
                }}
              >
                {/* 수송선·오버로드는 점 대신 제 도형(요청) — 풍선·드랍십·셔틀.
                    일꾼은 점 그대로, 그 밖의 단독 정찰(병력)은 육각형(요청: 아이콘 구분). */}
                {race === "저그" && g.kind !== "worker"
                  ? <ShapeIcon kind="ovie" rotDeg={hdg} flat={!pitched} viewYaw={viewYawOf(pos.x, pos.y)} className="scr-motion-ovie" />
                  : g.kind === "carrier"
                    ? <ShapeIcon kind={race === "테란" ? "dship" : "shuttle"} rotDeg={hdg} flat={!pitched} viewYaw={viewYawOf(pos.x, pos.y)} className="scr-motion-ovie" />
                    : g.kind === "worker"
                      ? <ShapeIcon kind={workerKindOf(race)} rotDeg={hdg} flat={!pitched} viewYaw={viewYawOf(pos.x, pos.y)} className="scr-motion-troop" />
                      : (
                        <ShapeIcon
                          kind={race === "테란" ? "gunner" : race === "저그" ? "zling" : "zealot"}
                          rotDeg={hdg} flat={!pitched} viewYaw={viewYawOf(pos.x, pos.y)} className="scr-motion-troop"
                        />
                      )}
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
              style={{ ...posStyle(home[0] + 2.5, home[1] - 2.5), ...glyphStyle(p.raw, team) }}
            >
              <ShapeIcon kind="ovie" flat={!pitched} viewYaw={viewYawOf(home[0] + 2.5, home[1] - 2.5)} className="scr-motion-ovie" />
            </span>
          )];
        })}

        {/* 건설 SCV(정정: 빙빙이 아니라) — 건물 둘레 네 자리를 "이동→정지(작업)→이동"
            으로 옮겨 다닌다. 걷는 동안은 진행 방향, 멈추면 건물 쪽을 본다. */}
        {motion.builds.map(([sec, bx3, by3, unit, raw], i) => {
          if (sec <= 0 || t < sec || t - sec >= (BUILD_SEC[unit] ?? 30)) return null;
          if (ADDONS.has(unit)) return null;
          const race2 = bases.find((b) => b.key === raw)?.race;
          if (race2 !== "테란") return null;
          const [fw2, fh2] = FOOTPRINT[unit] ?? [3, 2];
          const cx0 = bx3 + footDx(unit);
          const cy0 = by3 + footDy(unit);
          const spots: [number, number][] = [
            [fw2 / 2 + 0.9, 0], [0, fh2 / 2 + 0.8], [-(fw2 / 2 + 0.9), 0], [0, -(fh2 / 2 + 0.8)],
          ];
          const LEG = 3;
          const k = (t - sec) / LEG + i * 0.7;
          const idx = ((Math.floor(k) % 4) + 4) % 4;
          const f = k - Math.floor(k);
          const walkF = Math.min(1, f / 0.35);
          const [x1, y1] = spots[idx];
          const [x2, y2] = spots[(idx + 1) % 4];
          const sx2 = x1 + (x2 - x1) * walkF;
          const sy2 = y1 + (y2 - y1) * walkF;
          // 걷는 중엔 진행 방향, 멈추면 건물(안쪽)을 본다.
          const hdg2 = walkF < 1
            ? (Math.atan2(-(x2 - x1), y2 - y1) * 180) / Math.PI
            : (Math.atan2(sx2, -sy2) * 180) / Math.PI;
          return (
            <span
              key={`scv-${i}`}
              className="scr-motion-fresh"
              style={{
                ...posStyle(cx0 + sx2, cy0 + sy2),
                ...glyphStyle(raw, teamOfRaw(raw)),
              }}
            >
              <ShapeIcon kind="scv" rotDeg={hdg2} flat={!pitched} viewYaw={viewYawOf(cx0 + sx2, cy0 + sy2)} className="scr-motion-troop" />
            </span>
          );
        })}

        {/* 마법 — 떨어진 자리에 이름이 잠깐 떠오른다. 핵만은 이름에 폭발 파문까지
            얹는다(요청: "핵 떨어지는거도 효과") — 경기 하나에 몇 번 없는, 그 판의 가장
            큰 사건이라 다른 마법과 같은 글자 한 줄로는 안 보였다. */}
        {castsNow.map(([sec, x, y, tech, raw], i) => {
          if (!TECH_KO[tech]) return null; // 한글명을 모르는 기술은 안 띄운다(요청).
          if (tech === "Nuclear Strike") {
            /* 핵(정정) — 런치가 아니라 실제 착탄에 폭발(지적): 낙하 동안은 표적 점, 마지막
               2초에 탄두가 내려오고, NUKE_FALL_SEC부터 폭발 광원. 크기는 실제 피해 반경
               (4타일)에 맞춘 지름 8타일 상자에 %로 그리고 살짝 투명하다(지적). */
            const age = t - sec;
            /* 성공 판정(지적) — 불발이면 폭발 없이 표적 점만 보이다 만다. */
            const landed = nukeImpacts.some((nk) =>
              nk.confirmed && nk.x === x && nk.y === y && Math.abs(nk.sec - (sec + NUKE_FALL_SEC)) < 0.5);
            if (age >= NUKE_FALL_SEC && !landed) return null;
            return (
              <span
                key={`c-${i}`}
                className="scr-motion-nukefx"
                style={{
                  ...posStyle(x, y),
                  width: pct(8, grid.width),
                }}
              >
                {age < NUKE_FALL_SEC - 2 ? (
                  <span className="scr-motion-nuke-dot" />
                ) : age < NUKE_FALL_SEC && landed ? (
                  /* 낙하를 게임 시간으로 직접(수리: CSS 실시간 2초 애니라 배속에서 탄두가
                     덜 내려왔는데 폭발로 넘어갔다) — 마지막 2초의 진행률로 높이를 잰다. */
                  <span
                    className="scr-motion-nuke-fall"
                    style={{
                      color: modeColor(raw, teamOfRaw(raw)),
                      animation: "none",
                      translate: `0 ${Math.round(-140 * (1 - (age - (NUKE_FALL_SEC - 2)) / 2))}px`,
                      opacity: 0.4 + 0.6 * ((age - (NUKE_FALL_SEC - 2)) / 2),
                    }}
                  >
                    <ShapeIcon kind="nuke" flat={!pitched} />
                  </span>
                ) : (
                  <>
                    <span className="scr-motion-nuke-flash" />
                    {/* 화구는 반구 돔(요청) — 평면 원 대신 3D 돔이 부푼다. */}
                    <span className="scr-motion-nuke-domewrap"><ShapeIcon kind="nukedome" flat={!pitched} /></span>
                    <span className="scr-motion-nuke-ring" />
                  </>
                )}
              </span>
            );
          }
          {
            /* 특징 기술 효과(요청) — 이름 배지 대신 실제 영역 크기의 전용 효과.
               [클래스, 지름(타일)] — 영역은 인게임 어림이다. */
            const AREA_FX: Record<string, [string, number]> = {
              Plague: ["plague", 5], Ensnare: ["ensnare", 5], Irradiate: ["irrad", 2.5],
              "EMP Shockwave": ["emp", 6], "Stasis Field": ["stasis", 4],
              Lockdown: ["lock", 2.2], Maelstrom: ["mael", 5], Recall: ["recall", 4],
              "Scanner Sweep": ["scan", 8], "Disruption Web": ["dweb", 5.5],
            };
            const fx = AREA_FX[tech];
            if (fx) {
              if (tech === "EMP Shockwave" && t - sec > 1.6) return null;
              return (
                <span
                  key={`c-${i}`}
                  className={`scr-motion-castfx scr-fx-${fx[0]}`}
                  style={{
                    ...posStyle(x, y),
                    width: pct(fx[1], grid.width),
                  }}
                />
              );
            }
          }
          if (tech === "Dark Swarm") {
            /* 다크 스웜(요청) — 갈색 반투명 구름이 우글거린다. 실제 지속(약 60초의
               절반만 표시)과 영역(지름 6타일)에 맞춘다. */
            return (
              <span
                key={`c-${i}`}
                className="scr-motion-swarmfx"
                style={{
                  ...posStyle(x, y),
                  width: pct(6, grid.width),
                }}
              >
                <span className="scr-motion-swarm-cloud" />
                <span className="scr-motion-swarm-cloud scr-motion-swarm-cloud-b" />
              </span>
            );
          }
          if (tech === "Psionic Storm") {
            /* 사이오닉 스톰(요청) — 반투명 번개가 지지직. 영역은 실제 인게임(지름
               3타일)과 일치. 폭풍 지속(약 4초)만 보여 준다. */
            if (t - sec > 4) return null;
            return (
              <span
                key={`c-${i}`}
                className="scr-motion-stormfx"
                style={{
                  ...posStyle(x, y),
                  width: pct(3, grid.width),
                }}
              >
                <span className="scr-motion-storm-glow" />
                <svg className="scr-motion-storm-bolts" viewBox="0 0 48 48" aria-hidden>
                  <path d="M10 4 L16 16 L8 18 L20 32 L14 34 L24 46" />
                  <path d="M30 2 L26 14 L36 16 L28 30 L38 32 L30 44" />
                  <path d="M42 8 L36 18 L44 22 L34 38" />
                </svg>
              </span>
            );
          }
          return (
            <span
              key={`c-${i}`}
              className={cx(
                "scr-motion-cast",
                teamOfRaw(raw) === 2 ? "scr-motion-team2" : "scr-motion-team1",
              )}
              style={{ ...posStyle(x, y), ...castStyle(raw, teamOfRaw(raw)) }}
            >
              {TECH_KO[tech]}
            </span>
          );
        })}

        {/* 드랍·태움(요청: 셔틀·드랍십·오버로드의 태우기와 드랍 표현) — 내린 자리엔
            '드랍', 제 수송선을 찍어 태운 자리엔 '태움'이 마법처럼 잠깐 떠오른다. */}
        {motion.players.flatMap((p) => {
          const team = teamOfRaw(p.raw);
          const mk = (pts: [number, number, number][] | undefined, kp: "dr" | "ld") => {
            /* 몰린 클릭 접기(지적: 태움·내림 효과가 계속 남아 이상하다) — 여러 기를 태울
               때 수송선을 잇달아 찍으므로, 10초·5타일 안에 몰린 클릭은 첫 것 하나만 배지가
               된다. 그래야 효과가 "한 번 일어난 일"로 읽히고 끝난다. */
            const folded: [number, number, number][] = [];
            for (const pt of pts ?? []) {
              const prev = folded[folded.length - 1];
              if (prev && pt[0] - prev[0] <= 10
                && Math.hypot(pt[1] - prev[1], pt[2] - prev[2]) <= 5) continue;
              folded.push(pt);
            }
            return folded
              .filter(([s]) => s <= t && t - s <= CAST_HOLD_SEC)
              .map(([s, cx2, cy2]) => (
                <React.Fragment key={`${kp}-${p.raw}-${s}-${cx2}-${cy2}`}>
                  {/* 우주선 광선(요청: 글씨 없이 광선만) — 위(수송선)에서 유닛 자리로
                      노랗게 내리쬔다. */}
                  <span
                    className="scr-motion-beam"
                    style={{ ...posStyle(cx2, cy2) }}
                  />
                  {/* 유닛 승강(요청) — 태울 땐 광선 속으로 떠오르고, 내릴 땐 내려온다. */}
                  {[0, 1].map((di) => (
                    <span
                      key={di}
                      className={cx(
                        "scr-motion-lift",
                        kp === "ld" ? "scr-motion-lift-up" : "scr-motion-lift-down",
                        di === 1 && "scr-motion-lift-b",
                      )}
                      style={{
                        ...posStyle(cx2 + (di === 1 ? 0.7 : -0.4), cy2),
                        color: modeColor(p.raw, team),
                      }}
                    />
                  ))}
                </React.Fragment>
              ));
          };
          return [...mk(p.drops, "dr"), ...mk(p.loads, "ld")];
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
          <div className="scr-motion-legend">{legendItems}</div>
          <div className="scr-motion-terrain-row">
            {typeof grid.imageId === "number" && grid.image && (
              <button
                type="button" className="scr-motion-btn scr-motion-terrain"
                onClick={() => { setPlaying(false); setTerrainOpen(true); }}
                aria-label="지형 수정" title="지형 수정"
              >
                <Mountain size={12} />
              </button>
            )}
            {/* (삭제·요청: 모바일 확대 제거) — 화면 폭 확대 버튼이 있던 자리. 상세 모달이
                전체화면이 되며 맵이 늘 최대 크기다. */}
          </div>
        </div>
        {/* 케밥은 왼쪽 위(요청: PC 게임 상세에서도 케밥은 왼쪽) — X와 갈라 세운다. */}
        {big && menu ? <div className="scr-motion-menu-left">{menu}</div> : null}
        <div className="scr-motion-expand-row">
          <button
            type="button" className="scr-motion-btn scr-motion-expand"
            onClick={() => { if (big) closeBig(); else setBig(true); }}
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
          {/* 피칭 보기(요청) — 수직 부감 ↔ 비스듬한 정면. 모바일은 아직 안 연다(요청). */}
          {!coarsePointer && (
            <button
              type="button" className="scr-motion-btn scr-motion-colorbtn"
              onClick={() => setPitched((v) => !v)}
              title="시점 전환"
            >
              {pitched ? "수직 보기" : "입체 보기"}
            </button>
          )}
          {/* 지형 수정(요청, 지적: 따로 두면 자리가 애매하고 너무 컸다) — 인라인의 산
              버튼과 같은 작은 원형으로 조작부 배속 무리 끝에 앉는다. */}
          {big && typeof grid.imageId === "number" && grid.image ? (
            <button
              type="button" className="scr-motion-btn scr-motion-terrain"
              onClick={() => { setPlaying(false); setTerrainOpen(true); }}
              aria-label="지형 수정" title="지형 수정"
            >
              <Mountain size={12} />
            </button>
          ) : null}
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
      {/* 확대 창 왼쪽 기둥(요청) — 맨 위 타임스탬프, 로스터(기존), 범례 2열, 맨 아래 등록자. */}
      {big && stamp ? <div className="scr-motion-stamp">{stamp}</div> : null}
      {big ? <div className="scr-motion-legend scr-motion-legend-side">{legendItems}</div> : null}
      {big && registrant ? <div className="scr-motion-registrant">{registrant}</div> : null}
      {/* 확대 모드의 오른쪽 댓글 영역(지적: "리플" = 댓글) — 맵 오른쪽 그리드 4번째 칸. */}
      {big && side ? <div className="scr-motion-sidewrap">{side}</div> : null}
      {terrainOpen && typeof grid.imageId === "number" && grid.image && (
        <TerrainReviewModal
          image={terrainModalImage}
          anchors={(grid.resources ?? []).map(([x, y]) => [x / grid.width, y / grid.height] as [number, number])}
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
          onClick={closeBig}
        />
        {/* 폭 상한 = (가용 높이 − 위아래 여백·슬림 탐색바 몫) × 맵 가로세로비 + 양쪽 기둥
            몫(요청: 왼쪽 기둥에 로스터·조작부, 오른쪽 기둥에 댓글 — 맵은 최대 크기) —
            기둥 둘 300px씩 + 간격·패딩 60px. */}
        <div
          className="scr-modal scr-motion-big-modal"
          style={{ width: `min(94vw, calc((100dvh - 88px) * ${(grid.width / grid.height).toFixed(4)} + 660px))` }}
        >{body}</div>
      </div>,
      document.body,
    );
  }
  return body;
}
