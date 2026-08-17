import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pause, Play, RotateCcw, Shield, X } from "lucide-react";
import Avatar from "../common/Avatar";
import ReplayMapCanvas from "./ReplayMapCanvas";
import PillTabs from "../common/PillTabs";
import { cx } from "../../utils/format";
import { UNIT_KO, TECH_KO } from "../../utils/replayNames";
import type { ReplayMapGrid } from "../../utils/replayParser";
import { api } from "../../api/client";
import { applyReplayMap } from "../../hooks/useReplayMap";
import { AIR_UNITS } from "../../utils/replayBuildMix";
import { BLD_STATS, UNIT_STATS, type UnitTracksV2 } from "../../utils/replayUnits";
// (정리) DEFENSE_BUILDINGS — 건물 캔버스 전환으로 ▲ 글자 갈래가 없어져 더는 안 쓴다.
import { terrainOf, decodeWalk, groundPath, groundPathSoft, type TerrainGrid } from "../../utils/minimapTerrain";
import {
  bodyFace, capFace, depthNow, groundEllipse, sideFace, tagKey, topFace, type ShapeFace,
  boxFaces3, cylinderFaces3, discPath3, polyPath3, project,
  domeFaces3, faceLight, facingRatio, frustumFaces3, groundSquashNow, hornFaces, tubeFaces,
  wallDiscPath, wallFrame, withPitchView, withTopView, withViewShear, withYaw, zsorted,
} from "../../utils/shapeOblique";
import type { MinimapMarker } from "./ReplayMinimap";

/* ── 모션 트랙 타입(옛 utils/replayMotion.ts에서 이사) ─────────────────────────────
   요약(summaryData) 생성이 걷히면서 트랙을 만드는 쪽(motionOf)은 사라졌고, 저장돼 있던
   모션을 읽어 그리는 이 파일이 타입의 유일한 사용처라 여기로 옮겨 왔다. 좌표는 전부
   타일이고, 시각은 초(정수)다. */

/** 자취 한 점 [초, x, y, 선택 묶음 번호?] — 넷째 값(g)은 같은 부대지정으로 내린 명령끼리
 *  같은 번호다(지적: 단축키 부대 이동의 순간이동). 옛 분석본에는 없다. */
export type TrackPt = [number, number, number, number?];

/** 한 사람의 자취 — 원본 게임 아이디(raw)로 부른다. */
export interface MotionTrack {
  raw: string;
  /** 게임 내 색(#rrggbb, 요청) — 재생 화면이 팀 2색 대신 이 색으로 칠한다. 없으면 팀 색. */
  color?: string;
  /** [초, x, y, g?] — 버킷의 마지막 명령 자리. 안 움직인 버킷은 접혀 있다. */
  pts: TrackPt[];
  /** 일꾼의 자취 — 부대 자취(pts)에서 걷어낸, 정체가 일꾼으로 드러난 명령들. */
  spts?: TrackPt[];
  /** 수송선(오버로드 포함)의 자취. */
  tpts?: TrackPt[];
  /** 정체 모를 한 기짜리 클릭의 자취 — 시작 오버로드·옵저버 정찰이 대부분이다. */
  opts?: TrackPt[];
  /** 뜬 건물의 비행 클릭 자취. */
  fpts?: TrackPt[];
  /** 명령의 선택 크기 자취 [초, x, y, 몇 기 골랐나]. */
  sels?: [number, number, number, number][];
  /** 수송선 드랍 지점 [초, x, y]. */
  drops?: [number, number, number][];
  /** 태우기 지점 [초, x, y] — 제 수송선을 찍은 우클릭. */
  loads?: [number, number, number][];
  /** 정체가 드러난 유닛별 자취 — 키는 그 이름("Siege Tank"·"Bionic"·"Lurker"…). */
  upts?: Record<string, TrackPt[]>;
  /** [초, x, y, 건물 태그] — 생산 건물의 랠리 포인트. */
  rly?: [number, number, number, number][];
  /** [초, 유닛 영문명] — 그때까지 가장 많이 뽑은 전투 유닛이 바뀐 순간들(이름표 재료). */
  units: [number, string][];
  /** [초, 누적 일꾼 수] — "여태 뽑은 일꾼"으로 읽어야 한다(죽음은 리플레이에 없다). */
  workers: [number, number][];
  /** [초, 업그레이드 영문명] — 속도 업그레이드의 연구 시점. */
  ups?: [number, string][];
  /** 유닛 영문명 → 생산 시각(초)들 — "생산할 때 건물 이름 켜기"의 재료. */
  prod: Record<string, number[]>;
  /** prod와 나란한 '그때 골라져 있던 건물 번호(태그)'. */
  ptag?: Record<string, number[]>;
  /** [초, 병력 규모] — 최근 3분 안에 뽑은 전투 유닛 수. */
  size: [number, number][];
  /** [시작, 끝] 초 — 상대의 공격 명령이 내 부대 자리 곁에 몰린 구간(전투 어림). */
  hot?: [number, number][];
}

export interface SummaryMotion {
  v: 1;
  step: number;
  players: MotionTrack[];
  /** [초, x, y, 건물 영문명, raw, 무너진 초(0이면 살아 있음), 이륙한 초?]. */
  builds: [number, number, number, string, string, number, number?][];
  /** [초, x, y, 기술 영문명, raw] — 좌표가 남는 마법(스톰·스웜·리콜…). */
  casts: [number, number, number, string, string][];
}

/** 공중 유닛인가 — 마법 유닛(베슬·퀸 등)은 자취 목적상 지상 취급을 유지한다(옛 규칙 그대로). */
/* 오버로드는 통계용 AIR_UNITS(병력 구성 집합)에 없어서 지상으로 정렬됐다(지적: 스포닝
   풀이 오버로드 머리를 덮음) — 공중 우선(+100000) 화가 순서를 못 받아 건물이 풍선 위에
   그려졌다. 재생 판정에만 오버로드를 더한다(직선 비행·이완 제외도 같이 맞는 값이다).
   캐스터 제외(!CASTER_UNITS)도 걷었다(재검토 요청: "옵저버 같은 것도") — 그 조건이
   실제로 떨어뜨리던 것은 지상 캐스터가 아니라 아비터·베슬·퀸(나는 캐스터) 셋뿐이라,
   이들도 지상 취급돼 건물에 덮이고 지형 길찾기로 걸었다. 옵저버는 원래 정상이었다. */
export const isAirUnit = (unit: string): boolean =>
  unit === "Overlord" || AIR_UNITS.has(unit);

/** 본진 로스터 한 사람 — 위치(x·y)는 이제 요약이 사라져 실려 오지 않을 수 있다.
 *  좌표가 없으면 지형 앵커·채굴 임자 어림 같은 위치 계산에서 조용히 빠진다. */
export type MotionBase = Omit<MinimapMarker, "x" | "y"> & { x?: number; y?: number };

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
// ×3을 걷고 기본은 ×2(요청: 배속 정리 — x1 x2 x5 x10 x20, 기본 2).
const SPEEDS = [1, 2, 5, 10, 20] as const;
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
const GLIDE_MAX_SPEED = 6.5;
/** 순간이동 다리(지적: 유닛이 얼었다 다음 점으로 튐 — 앞뒤 추적 강화) — 침묵 구간의
 *  끝자락을 걸어 잇는 걸음 속도와, 초고속 구간을 행군으로 봐줄 상한(타일/초). 상한을
 *  넘어야 닿는 점프만 예전처럼 앞 점에 머문다(그건 정말 딴 부대의 점이다). */
const BRIDGE_WALK_SPEED = 4.5;
const BRIDGE_MAX_SPEED = 10;
/** 크립이 만개까지 퍼지는 시간(초) — 원작은 해처리·콜로니에서 몇 분에 걸쳐 타일이
 *  번져 나간다(정확한 표는 공개돼 있지 않아 체감치). 시작 본진 해처리는 처음부터 만개. */
const CREEP_SPREAD_SEC = 180;

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
/** 부대 묶기(요청: 가까운 유닛만 합침) — 앞 부대의 마지막 자리에서 이 안이면 같은 부대다.
 *  14 → 9(지적: 유닛이 갑자기 합쳐지고 커진다) — 14타일이면 화면에서 뚜렷이 떨어져 선
 *  두 무리도 한 부대로 삼켜, 마커들이 한 점으로 훅 모여들었다. */
const SQUAD_MERGE_TILES = 9;
/** 유닛별 마커의 뭉침 반경(요청: "같은 종류유닛을 무조건 뭉치는게 아니라 아주 가까울때만")
 *  — 부대 반경보다 훨씬 좁다. */
const TYPE_MERGE_TILES = 6;
// 4 → 8(지적: 합쳐짐) — 자리가 다 차면 새 무리가 못 태어나 기존 부대에 흡수됐다.
const SQUAD_MAX = 8;
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
  /** 이어붙이기 속도(타일/초) — 느린 정찰(오버로드·수송선)용(지적: 오버로드가 자꾸
   *  순간이동). 이 갈래는 대개 한두 기의 여정이라 부대 나누기 휴리스틱(방향 갈림·옛 자리
   *  재사용)이 여정을 툭툭 끊어 새 마커가 목적지에서 태어났다. 시간 대비 그 거리를 갈 수
   *  있으면(bestD/dt ≤ glueSpeed) 같은 기체가 걸어간 것으로 보고 잇고, 방향 갈림 규칙은
   *  끈다. */
  glueSpeed?: number,
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
    if (joinable && squads.length < SQUAD_MAX && glueSpeed === undefined) {
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
    /* 느린 정찰 이어붙이기(위 glueSpeed 주석) — 오버로드는 왕복·선회가 잦아 방향 규칙에
       걸리고, 먼 목적지는 mergeTiles를 넘어 새 부대가 됐다. 그 시간에 갈 수 있는 거리면
       같은 기체다 — 마커가 제 속도로 걸어간다(순간이동이 구조적으로 없어진다). */
    if (!joinable && glueSpeed !== undefined && best >= 0) {
      const last = squads[best][squads[best].length - 1];
      const dt = pt[0] - last[0];
      if (dt > 0 && bestD / dt <= glueSpeed) joinable = true;
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
    /* 다 찼으면 가까운(묶음 반경 안) 부대만 그리로 걸어간다(지적 둘: 순간이동 + 유닛이
       갑자기 합쳐짐) — 예전엔 45타일까지 기존 부대에 이어 붙여, 자리가 차면 딴 무리의
       명령이 옛 부대로 빨려 들어가 마커가 훅 합쳐졌다. 놓치는 것보다 합체가 더 큰
       거짓말이다. */
    if (bestD <= mergeTiles
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
  /* 전수조사에서 빠져 있던 4×3 건물 — 폴백 3×2로 그려져 옆 건물보다 한 단 작았다.
     나머지(아카데미·포지·풀·에보 등)는 폴백 3×2가 원작 발자국과 같아 그대로 둔다.
     로보틱스는 여기 넣었다가 뺐다(지적: 크기가 비정상) — 원작 발자국이 3×2다. */
  "Fleet Beacon": [4, 3],
  Refinery: [4, 2], Assimilator: [4, 2], Extractor: [4, 2],
  Pylon: [2, 2], "Missile Turret": [2, 2], "Photon Cannon": [2, 2],
  "Creep Colony": [2, 2], "Sunken Colony": [2, 2], "Spore Colony": [2, 2],
  Spire: [2, 2], "Greater Spire": [2, 2], "Nydus Canal": [2, 2],
  // 테란 부속건물(요청: 모델링·매핑) — 실제 발자국 2×2로 본체 오른쪽에 붙는다.
  "Comsat Station": [2, 2], "Nuclear Silo": [2, 2], "Machine Shop": [2, 2],
  "Control Tower": [2, 2], "Covert Ops": [2, 2], "Physics Lab": [2, 2],
  /* screp가 쓰는 변형 이름(SHAPE_KIND에는 이미 있던 별칭)도 같은 발자국으로 — 전수조사
     에서 컴샛만 홀로 4타일(폴백 3×2 × 애드온 보정)로 그려져, 옆에 붙은 머신샵(2.7타일)
     보다 1.5배 컸다. */
  ComSat: [2, 2], "Queens Nest": [3, 2], "Queen's Nest": [3, 2],
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
  // 애드온(요청: 부속건물 전부 모델링) — 여섯 다 제 모델이다.
  // screp가 쓰는 변형 이름(v2 트랙: ComSat·Queens Nest)도 같은 모델로 받는다(지적:
  // 모델 없는 건물이 네모로 나옴).
  ComSat: "comsat", "Queens Nest": "queensnest",
  "Comsat Station": "comsat", "Nuclear Silo": "nsilo",
  "Machine Shop": "mshop", "Control Tower": "ctower",
  "Covert Ops": "covert", "Physics Lab": "physlab",
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
  // 테란 이착륙 패드 다리발은 은색(요청).
  return paintBase([
    ...hornFaces(px * 0.72, py * 0.72, zTop, px * 1.12, py * 1.12, 0.7, 1.1),
    bodyFace(discPath3(px * 1.16, py * 1.16, 0.35, 1.15)),
    sideFace(discPath3(px * 1.16, py * 1.16, 0.32, 1.15), 0.25),
  ], "#c9ced6");
}

/** 저그 갈고리(정정: 마디가 아니라 쭉 이어진 휘어진 칼) — 밖-앞으로 나갔다 안으로
 *  감기는 한 장의 낫 날. m은 좌우, s는 덩치 배율, z0는 뿌리 높이. */
/* 상아색 발톱(지적: 모든 다리·팔 끝마디를 흰 톤 상아색으로) — 몸판(색 없는 면)에만
   상아색을 입히고, 그늘 덮개 면은 그대로 둬 입체감을 지킨다. */
const IVORY = "#eae3d2";
/* 진한 상아색(요청: 하이브 가시·옆띠). */
const IVORY_DEEP = "#cdc0a0";
/* 테란 화기 금속색(요청: 총구·포신은 어두운 회색). */
const GUNMETAL = "#4b5058";
/* 탱크 캐터필러 금속색(요청: 짙은 회은색). */
const TRACK_STEEL = "#5c636d";
/** 두 점을 잇는 뿔(요청: 가시·뿔도 공용 기둥으로) — spirePillar를 '뿌리 → 끝'
 *  방향으로 세워, 밑동이 굵고 끝이 뾰족한 뿔을 만든다. 살짝 휘게 하려면 bow를 준다. */
function spikeHorn(
  bx: number, by: number, bz: number, tx: number, ty: number, tz: number,
  w: number, fill?: string, sides = 6, bow = 0,
  /** 휨 방향(요청: 본진 안쪽으로) — 주면 그 방향으로 배가 부풀고, 없으면 옛 규칙(+y). */
  bowX?: number, bowY?: number,
): ShapeFace[] {
  const bxDir = bowX ?? 0;
  const byDir = bowY ?? 1;
  /* 중간에 잘록해지지 않게(지적: 하나의 뿔로 보이게) — 마디를 촘촘히(10) 나눠
     곡선을 매끈하게 하고, 굵기는 밑동에서 완만하게 시작해(taper 1.5) 끝으로 갈수록
     빨리 가늘어진다. hold는 두지 않는다(굵기 유지 구간이 있으면 그 끝이 턱이 된다). */
  return spirePillar({
    x: 0, y: 0, h: 1, w: w * 0.62, tipW: 0.02,
    segs: 10, sides, hold: 0, taper: 1.5, fill,
    path: (t9: number): [number, number, number] => {
      const s9 = Math.sin(Math.PI * t9) * bow;
      return [
        bx + (tx - bx) * t9 + s9 * bxDir,
        by + (ty - by) * t9 + s9 * byDir,
        bz + (tz - bz) * t9 + s9 * 0.2,
      ];
    },
  });
}
/** 꺾임 있는 뿔기둥(요청: 여러 곳에 쓰는 형태라 이름을 붙여 공용화) — 다각 단면의
 *  마디를 이어 세우고, 마디마다 축을 조금씩 꺾으며 굵기를 줄여 끝을 뾰족하게 한다.
 *  게이트 발판 뿔·미네랄 결정·건물 첨탑처럼 "밑은 기둥, 위는 뿔"인 것들이 같은 자를
 *  쓴다. 각도(lean·curve)·마디 수(segs)·단면 각(sides)이 모두 파라미터다.
 *
 *  x·y·z0  뿌리 자리, h 전체 높이, w 뿌리 반폭, tipW 끝 반폭(0이면 뾰족)
 *  segs    마디 수(많을수록 휨이 매끈하다), sides 단면 다각형의 변 수
 *  leanX·leanY  끝이 곧게 밀리는 양(기울기), curveX·curveY  끝으로 갈수록 더해지는 휨
 *  hold    아래 이 비율까지는 굵기를 그대로 둔다(기둥 구간, 0~1) */
function spirePillar(o: {
  x: number; y: number; z0?: number; h: number; w: number; tipW?: number;
  segs?: number; sides?: number;
  leanX?: number; leanY?: number; curveX?: number; curveY?: number;
  hold?: number; fill?: string;
  /** 앞(+y)·뒤(-y)를 향한 옆면의 색을 따로 줄 때(요청: 배는 상아색, 등은 갈색). */
  fillFront?: string; fillBack?: string;
  /** 축을 직접 그리는 경로(요청: 관절 없이 L자로 구부리기) — t 0~1로 [x,y,z]를 낸다.
   *  주면 x·y·z0·h·lean·curve는 무시되고 이 곡선이 기둥의 등뼈가 된다. */
  path?: (t: number) => [number, number, number];
  /** 굵기가 줄어드는 곡률(요청: 후지산) — 1이면 선형, 1보다 작으면 아래는 완만하고
   *  위로 갈수록 급해진다(0.5쯤이 후지산 옆선). */
  taper?: number;
}): ShapeFace[] {
  const z0 = o.z0 ?? 0;
  const segs = Math.max(1, o.segs ?? 3);
  const sides = Math.max(3, o.sides ?? 4);
  const tipW = o.tipW ?? 0;
  const hold = Math.min(0.9, Math.max(0, o.hold ?? 0.45));
  const axis = o.path ?? ((t: number): [number, number, number] => [
    o.x + (o.leanX ?? 0) * t + (o.curveX ?? 0) * t * t,
    o.y + (o.leanY ?? 0) * t + (o.curveY ?? 0) * t * t,
    z0 + o.h * t,
  ]);
  const taper = o.taper ?? 1;
  const widthAt = (t: number): number => {
    if (t <= hold) return o.w;
    const k = (t - hold) / (1 - hold);
    // taper 1이면 선형, 1보다 작으면 아래 완만·위 급격(후지산 옆선).
    return tipW + (o.w - tipW) * (1 - k) ** taper;
  };
  /* 단면은 축에 수직으로(지적: 기울인 기둥이 눌려 보임) — 수평 단면을 쓰면 축이
     기울수록 원이 늘어나 찌그러진다. 축의 접선을 구해 그에 수직인 두 벡터로 단면을
     세우면 어느 기울기에서도 정원(정뿔)이 된다. */
  const tangentAt = (t: number): [number, number, number] => {
    const e9 = 0.012;
    const p1 = axis(Math.max(0, t - e9));
    const p2 = axis(Math.min(1, t + e9));
    const d9: [number, number, number] = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
    const l9 = Math.hypot(d9[0], d9[1], d9[2]) || 1;
    return [d9[0] / l9, d9[1] / l9, d9[2] / l9];
  };
  /* 단면 기준 벡터 — 축 전체 방향과 가장 어긋난 축을 골라 한 번만 정한다. */
  const TA = tangentAt(0.5);
  const REF: [number, number, number] = Math.abs(TA[2]) < 0.9 ? [0, 0, 1]
    : (Math.abs(TA[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
  /* 단면 방향은 앞 단면에서 이어받는다(평행 이송) — 기준 벡터 하나를 매번 수직화하면,
     축이 도중에 되짚는 S자에서 T의 부호가 뒤집힐 때 u까지 180도 홱 돌아 마디 사이가
     꼬여 끊긴 것처럼 보였다(지적: 히드라 꼬리 중간에 끊김). 앞 단면의 u를 새 접선에
     수직화해 굴리면 비틀림 없이 이어진다. 마디 경계마다 한 번씩만 계산해 둔다. */
  const frames: [number, number, number][][] = [];
  {
    let pu: [number, number, number] | null = null;
    for (let s3 = 0; s3 <= segs; s3 += 1) {
      const t = s3 / segs;
      const [ax, ay, az] = axis(t);
      const r = widthAt(t);
      const T = tangentAt(t);
      const src: [number, number, number] = pu ?? REF;
      const sd9 = src[0] * T[0] + src[1] * T[1] + src[2] * T[2];
      let ux = src[0] - T[0] * sd9;
      let uy = src[1] - T[1] * sd9;
      let uz = src[2] - T[2] * sd9;
      let ul9 = Math.hypot(ux, uy, uz);
      if (ul9 < 1e-4) {
        // 앞 단면이 접선과 나란해진 드문 자리 — 전체 기준으로 되돌아간다.
        const d2 = REF[0] * T[0] + REF[1] * T[1] + REF[2] * T[2];
        ux = REF[0] - T[0] * d2;
        uy = REF[1] - T[1] * d2;
        uz = REF[2] - T[2] * d2;
        ul9 = Math.hypot(ux, uy, uz) || 1;
        if (ul9 < 1e-4) { ux = 1; uy = 0; uz = 0; ul9 = 1; }
      }
      ux /= ul9; uy /= ul9; uz /= ul9;
      pu = [ux, uy, uz];
      // v = T × u — u·T 모두에 수직.
      const vx = T[1] * uz - T[2] * uy;
      const vy = T[2] * ux - T[0] * uz;
      const vz = T[0] * uy - T[1] * ux;
      frames.push(Array.from({ length: sides }, (_, i) => {
        const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
        const cs = Math.cos(a) * r;
        const sn = Math.sin(a) * r;
        return [ax + ux * cs + vx * sn, ay + uy * cs + vy * sn, az + uz * cs + vz * sn] as [number, number, number];
      }));
    }
  }
  const ring = (t: number): [number, number, number][] =>
    frames[Math.max(0, Math.min(segs, Math.round(t * segs)))];
  const out: ShapeFace[] = [];
  /* 옆면은 마디별로 따로 정렬하면 안 된다(재지적: 마디 단면이 비쳐 보임) — 마디마다
     제 안에서만 순서를 잡으면 기울거나 휜 기둥에서 뒤 마디가 앞 마디를 덮어 속이
     들여다보인다. 모든 마디의 모든 옆면을 한 번에 모아 각 면 중심의 화면 깊이로
     정렬해야 painter 순서가 기둥 전체에서 옳다. */
  const walls: { d: string; nx: number; ny: number; dep: number }[] = [];
  for (let s2 = 0; s2 < segs; s2 += 1) {
    const t0 = s2 / segs;
    const t1 = (s2 + 1) / segs;
    const lo = ring(t0);
    const hi = ring(t1);
    const c0 = axis(t0);
    const c1 = axis(t1);
    for (let i = 0; i < sides; i += 1) {
      const j = (i + 1) % sides;
      const mx = (lo[i][0] + lo[j][0]) / 2 - c0[0];
      const my = (lo[i][1] + lo[j][1]) / 2 - c0[1];
      const ml = Math.hypot(mx, my) || 1;
      // 면 중심의 화면 깊이 — 축 중심이 앞뒤로 움직여도 제 자리를 안다.
      const fx = (lo[i][0] + lo[j][0] + hi[i][0] + hi[j][0]) / 4;
      const fy = (lo[i][1] + lo[j][1] + hi[i][1] + hi[j][1]) / 4;
      walls.push({
        d: polyPath3([lo[i], lo[j], hi[j], hi[i]]),
        nx: mx / ml, ny: my / ml, dep: depthNow(fx, fy) + (c1[2] - c0[2]) * 0.02,
      });
    }
  }
  walls.sort((q, w) => q.dep - w.dep);
  for (const wl of walls) {
    const fl = faceLight(wl.nx, wl.ny, 0.3);
    // 앞·뒤 색을 따로 받으면 면 법선의 y 부호로 갈라 칠한다(요청).
    const side = wl.ny >= 0 ? o.fillFront : o.fillBack;
    out.push(side ? [wl.d, 1, side] as ShapeFace : bodyFace(wl.d),
      ...(fl.visible ? fl.face(wl.d) : [sideFace(wl.d, 0.42)]));
  }
  /* 끝 단면은 옆면 뒤에 덮되, 바깥을 향할 때만 그린다(재지적: 각도에 따라 내부
     단면이 비쳐 보임) — 아래 뚜껑의 법선은 -T, 위 뚜껑은 +T다. 안쪽을 향한 뚜껑을
     그리면 기둥 속을 들여다보는 그림이 된다. */
  const T0 = tangentAt(0);
  const T1 = tangentAt(1);
  const botLit = faceLight(-T0[0], -T0[1], -T0[2]);
  if (botLit.visible) {
    const bot = polyPath3(ring(0));
    out.push(bodyFace(bot), ...botLit.face(bot));
  }
  if (tipW > 0.01) {
    const capLit = faceLight(T1[0], T1[1], T1[2]);
    if (capLit.visible) {
      const cap = polyPath3(ring(1));
      out.push(bodyFace(cap), ...capLit.face(cap));
    }
  }
  return tagKey(o.fill ? paintBase(out, o.fill) : out, depthNow(o.x, o.y));
}
/* 프로토스 금·플라즈마(요청) — 인간형 다섯(질럿·하템·다크·아콘·다크아콘)이 나눠 쓴다. */
const P_GOLD = "#d4af37";
const P_PLASMA = "#e4f6ff";
/* 프로토스 인간형 공통 얼굴(요청: 다섯이 같은 얼굴) — 크고 길쭉하며, 턱이 몸통 위끝보다
   아래로 내밀어 '턱주가리'가 된다. 정수리는 둥근 캡, 양볼이 앞아래 턱 끝 한 점으로
   모인다. fill 없이 부르면 색 없는 몸판이라 아콘의 dark() 실루엣이 그대로 집어 간다. */
function protossFace(fill?: string, lift = 0, s = 1): ShapeFace[] {
  /* 물방울 머리(재지적) — 휘지 않고 곧게 선 물방울: 위는 둥글게 부풀고 아래 턱은
     뾰족하지 않게 뭉뚝히 마감한다. 뒤통수 구는 없다(기둥 자체가 머리통이다).
     fill 없이 부르면 색 없는 몸판이라 아콘의 dark() 실루엣이 그대로 집어 간다. */
  /* 45도로 기울여 턱이 앞으로 나가게(요청) — 기둥은 아래에서 위로 자라므로 아래
     끝(턱)을 앞(+y)에, 위 끝(정수리)을 뒤로 보내면 머리가 앞으로 숙는다. */
  /* 머리는 몸통 위에 올라앉는다(재지적: 몸통 속에 겹침) — 몸통 기둥 꼭대기(z 6)
     바로 위에서 턱이 시작한다. */
  /* 45도로 숙이되, 머리의 위에서 1/3 지점이 몸통 꼭대기(z 6)에 물린다(재지적) —
     머리 길이 1.85의 1/3(0.62)만큼 정수리가 몸통 위로 솟고 나머지는 앞으로 늘어진다.
     축을 45도로 눕히면 z 상승분과 y 후퇴분이 같다(h와 leanY의 절댓값이 같다). */
  /* 물린 자리는 몸통 윗면 원형 단면의 한가운데(재지적) — 몸통 기둥의 위 끝은
     (0, 0.6, 6+lift)다. 머리 축의 t=2/3 지점이 정확히 그 점에 오도록 뿌리를 잡는다:
     y = 0.6 + 1.85·(2/3) ≈ 1.83, z = 6 − 1.85·(2/3) ≈ 4.77. */
  return spirePillar({
    // 머리통을 몸통에서 좀더 위로(요청) — 물린 깊이를 얕게: 4.77 → 5.32.
    x: 0, y: 1.83 * s, z0: 5.32 + lift, h: 1.85 * s,
    // 아래(턱)는 뭉뚝, 위(정수리)는 굵게 — hold 없이 매끈하게 부푼다.
    w: 0.22 * s, tipW: 0.6 * s,
    segs: 5, sides: 8, hold: 0,
    leanY: -1.85 * s,
    fill,
  });
}
/* 프로토스 인간형 공통 몸통(요청: 하템도 질럿·다크와 같은 굽은 몸통) — 앞으로 숙는
   캡슐 막대 하나. 두께·길이 축소(재지적). */
function protossTorso(fill: string, lift = 0): ShapeFace[] {
  // 허리 살짝 더 숙인다(재지적) — 어깨를 앞으로, 엉덩이를 뒤로 더 벌린다.
  return paintBase(rodFaces(0, -0.75, 3.9 + lift, 0, 0.6, 6 + lift, 1.25), fill);
}
/* 프로토스 인간형 공통 다리(요청: 하템도 같은 2관절) — 넓적다리 앞, 정강이 뒤, 긴 발이
   앞아래 대각선. 대퇴·하지 색을 따로 받는다(하템은 하지가 개인색). */
function protossLegs(thighFill?: string, shinFill?: string, lift = 0, shrink = 1): ShapeFace[] {
  const paint = (f: ShapeFace[], c?: string): ShapeFace[] => (c ? paintBase(f, c) : f);
  /* 다리 길이 줄이기(요청: 하이템플러는 짧게) — 엉덩이(3.95)를 축으로 z를 눌러
     비율만 줄인다. 굽힘 각도와 팔자 벌림은 그대로 남는다. */
  const Z = (z: number): number => 3.95 + (z - 3.95) * shrink + lift;
  const out: ShapeFace[] = [];
  for (const m of [-1, 1] as const) {
    /* 대퇴는 길고 곧게 세우고, 정강이는 더 굽히며, 무릎·발끝이 바깥으로 벌어지는
       팔자다리(재지적) — 발 관절은 지면(z 0)에 맞춰 마지막 마디가 눕는다. */
    out.push(...paint(rodFaces(m * 0.5, -0.3, Z(3.95), m * 0.82, 0.3, Z(2.2), 0.66), thighFill));
    out.push(...paint([
      ...rodFaces(m * 0.82, 0.3, Z(2.2), m * 0.95, -0.75, Z(1), 0.56),
      ...rodFaces(m * 0.95, -0.75, Z(1), m * 1.04, 0.5, Z(0.15), 0.47),
    ], shinFill));
    /* 발끝 팁(요청) — 지면에 수평으로 눕는 삼각 말굽. 윗판·밑판과 옆면 띠로 두께를
       줘 납작한 판이 아니라 굽으로 보인다. */
    const fx = m * 1.08;
    const fy = 0.65;
    const fz = Z(0.06);
    const tri = (z: number): [number, number, number][] => [
      [fx - 0.34, fy - 0.42, z], [fx + 0.34, fy - 0.42, z], [fx + m * 0.06, fy + 0.6, z],
    ];
    const loT = tri(fz);
    const hiT = tri(fz + 0.26);
    const footFaces: ShapeFace[] = [bodyFace(polyPath3(loT))];
    for (let i9 = 0; i9 < 3; i9 += 1) {
      const j9 = (i9 + 1) % 3;
      footFaces.push(bodyFace(polyPath3([loT[i9], loT[j9], hiT[j9], hiT[i9]])));
    }
    footFaces.push(bodyFace(polyPath3(hiT)), topFace(polyPath3(hiT), 0.2));
    out.push(...paint(footFaces, shinFill));
  }
  return out;
}
/** 저그 갈고리 — 밖·앞으로 나갔다 안으로 감기는 한 장의 낫 날(원복). */
function claw3(m: 1 | -1, s: number, z0: number): ShapeFace[] {
  const [a1x, a1y] = project(m * 0.7 * s, 0.6 * s, z0);
  const [a2x, a2y] = project(m * 1.5 * s, 0.2 * s, z0);
  const [ox, oy] = project(m * 2.9 * s, 2.4 * s, z0 + 0.6);
  const [tx, ty] = project(m * 1 * s, 4.4 * s, z0 - 0.6);
  const [ix, iy] = project(m * 1.9 * s, 1.9 * s, z0 + 0.2);
  const d = `M${a1x} ${a1y} Q${ox} ${oy} ${tx} ${ty} Q${ix} ${iy} ${a2x} ${a2y} Z`;
  return [bodyFace(d), sideFace(d, 0.16)];
}
function ivory(faces: ShapeFace[]): ShapeFace[] {
  return faces.map(([d, o, f, k]) => [d, o, f ?? IVORY, k] as ShapeFace);
}

/** 막(공용 도형·요청: 드론·뮤탈 날개 같은 디테일) — 뿌리 변(roots)과 바깥 변(tips)을
 *  잇는 얇은 막. 바깥 변은 이웃 끝점 사이를 안쪽으로 우묵하게 파 갈퀴처럼 만들고,
 *  뿌리에서 각 끝점으로 가는 힘줄을 얹어 결을 낸다. */
function membraneFaces(
  roots: [number, number, number][],
  tips: [number, number, number][],
  fill: string,
  o?: { shade?: number; notch?: number; rib?: number; key?: number },
): ShapeFace[] {
  if (roots.length === 0 || tips.length < 2) return [];
  const notch = o?.notch ?? 0.3;
  const cx = roots.reduce((a, r) => a + r[0], 0) / roots.length;
  const cy = roots.reduce((a, r) => a + r[1], 0) / roots.length;
  const cz = roots.reduce((a, r) => a + r[2], 0) / roots.length;
  // 바깥 변 — 끝점 사이마다 뿌리 쪽으로 당긴 골을 하나씩 끼운다.
  const edge: [number, number, number][] = [];
  for (let i = 0; i < tips.length; i += 1) {
    edge.push(tips[i]);
    if (i + 1 >= tips.length) break;
    const mx = (tips[i][0] + tips[i + 1][0]) / 2;
    const my = (tips[i][1] + tips[i + 1][1]) / 2;
    const mz = (tips[i][2] + tips[i + 1][2]) / 2;
    edge.push([
      mx + (cx - mx) * notch, my + (cy - my) * notch, mz + (cz - mz) * notch,
    ]);
  }
  const outline = polyPath3([...roots, ...[...edge].reverse()]);
  const out: ShapeFace[] = [[outline, 1, fill] as ShapeFace, sideFace(outline, o?.shade ?? 0.16)];
  // 힘줄 — 가장 가까운 뿌리에서 끝점까지 가는 띠.
  const rw = o?.rib ?? 0.09;
  for (const tp of tips) {
    let best = roots[0];
    let bd = Infinity;
    for (const r of roots) {
      const d = Math.hypot(r[0] - tp[0], r[1] - tp[1], r[2] - tp[2]);
      if (d < bd) { bd = d; best = r; }
    }
    const [rx, ry] = project(best[0], best[1], best[2]);
    const [tx, ty] = project(tp[0], tp[1], tp[2]);
    const dx = tx - rx;
    const dy = ty - ry;
    const dl = Math.hypot(dx, dy) || 1;
    const nx = (-dy / dl) * rw;
    const ny = (dx / dl) * rw;
    out.push(sideFace(`M${rx + nx} ${ry + ny} L${tx + nx} ${ty + ny}`
      + ` L${tx - nx} ${ty - ny} L${rx - nx} ${ry - ny} Z`, 0.22));
  }
  return o?.key === undefined ? out : tagKey(out, o.key);
}
/** 렌즈(공용 도형·요청) — 몸 표면의 접평면 위에 선 볼록한 원판. 화면 고정 정원으로
 *  칠하면 요잉과 무관하게 늘 동그래 '구'로 읽히므로(지적), 접평면의 두 축(수평 접선
 *  u, 수직 z)으로 3D 점을 찍어 투영한다: 정면에선 동그랗고 옆으로 돌수록 실제로
 *  납작해지며, 등을 돌리면 아예 안 그린다. 겹쳐 얹는 네 켜(테 → 몸 → 속살 → 반짝임)가
 *  법선 쪽으로 조금씩 배를 내밀어 볼록한 콘택트 렌즈가 된다. */
function lensFaces(o: {
  /** 렌즈 한가운데(모델 좌표). */
  x: number; y: number; z: number;
  /** 바깥 법선의 수평 성분 — 몸 중심에서 렌즈로 향하는 방향이면 된다. */
  nx: number; ny: number;
  r: number;
  /** 배부름 — 가운데 켜가 법선 쪽으로 나오는 몫(반지름 대비). */
  bulge?: number;
  rim?: string; fill?: string; core?: string; glint?: string;
  /** 굴림(도) — 렌즈 판을 수평 접선 축으로 기울인다(요청). 양수면 위쪽이 몸 안쪽으로
   *  눕는다: 원판의 세로 축을 그만큼 법선 반대쪽으로 젖힌 것이다. */
  tiltDeg?: number;
  /** 깊이 키 보정 — 몸통 위에 얹히는 만큼 더한다. */
  lift?: number;
}): ShapeFace[] {
  const nl = Math.hypot(o.nx, o.ny) || 1;
  const nx = o.nx / nl;
  const ny = o.ny / nl;
  if (facingRatio(nx, ny) <= 0.02) return [];
  const ux = -ny;
  const uy = nx;
  const bul = (o.bulge ?? 0.25) * o.r;
  /* 세로 축 — 굴림만큼 젖힌다. 위쪽(+v)이 법선 반대쪽(몸 안)으로 눕는다. */
  const tr = ((o.tiltDeg ?? 0) * Math.PI) / 180;
  const vxy = -Math.sin(tr);
  const vz = Math.cos(tr);
  const disc = (k: number, out: number, dz: number): string => polyPath3(
    Array.from({ length: 17 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      const co = Math.cos(a) * o.r * k;
      const si = Math.sin(a) * o.r * k;
      return [
        o.x + ux * co + nx * (out + vxy * si),
        o.y + uy * co + ny * (out + vxy * si),
        o.z + dz + vz * si,
      ] as [number, number, number];
    }),
  );
  const rim = o.rim ?? "#5d3c8c";
  const fill = o.fill ?? "#7d55b4";
  const core = o.core ?? "#a97fe0";
  const glint = o.glint ?? "#e2d4f6";
  return tagKey([
    [disc(1, 0, 0), 0.95, rim] as ShapeFace,
    [disc(0.88, bul * 0.4, 0), 0.95, fill] as ShapeFace,
    [disc(0.5, bul * 0.8, o.r * 0.2), 0.55, core] as ShapeFace,
    [disc(0.2, bul, o.r * 0.34), 0.6, glint] as ShapeFace,
  ], depthNow(o.x, o.y) + (o.lift ?? 3));
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

/* 저그 크립(요청: 건물 아래 보라빛 크립) — 가장자리가 각지지 않게, 저주파 웨이브를
   섞은 매끈한 닫힌 곡선(중점 Q 스무딩) 블롭. 씨앗만 다른 세 변형을 돌려 깔면 이웃
   건물의 크립과 겹치며 자연스럽게 한 덩어리로 이어진다(같은 불투명 단색이라 이음매가
   없다). 얼룩 반점 몇 개가 생물 질감을 낸다. */
function creepBlobFaces(seed: number): ShapeFace[] {
  const N = 16;
  const pts: [number, number][] = [];
  for (let i = 0; i < N; i += 1) {
    const a = (i / N) * Math.PI * 2;
    const w = Math.sin(a * 3 + seed) * 0.1 + Math.sin(a * 5 + seed * 2.7) * 0.08;
    const r = 7.6 * (0.86 + w);
    pts.push(project(Math.sin(a) * r, Math.cos(a) * r, 0.04));
  }
  let d = "";
  for (let i = 0; i < N; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % N];
    const mx = (p[0] + q[0]) / 2;
    const my = (p[1] + q[1]) / 2;
    if (i === 0) d = `M${mx} ${my}`;
    else d += ` Q${p[0]} ${p[1]} ${mx} ${my}`;
  }
  const p0 = pts[0];
  const m0x = (p0[0] + pts[1][0]) / 2;
  const m0y = (p0[1] + pts[1][1]) / 2;
  d += ` Q${p0[0]} ${p0[1]} ${m0x} ${m0y} Z`;
  const faces: ShapeFace[] = [bodyFace(d)];
  for (let i = 0; i < 7; i += 1) {
    const a = seed * 3.1 + i * 2.4;
    const rr = 2 + ((Math.sin(a * 17.7) * 0.5 + 0.5) * 4);
    const [sx, sy] = project(Math.sin(a) * rr, Math.cos(a) * rr, 0.05);
    faces.push([groundEllipse(sx, sy, 0.55 + (i % 3) * 0.2), i % 2 ? 0.22 : 0.14, "#3d3244"] as ShapeFace);
  }
  return faces;
}

/* 공사 셋 고정색(요청: 팀색 대신 재질색) — 색 없는 밑칠(bodyFace)에만 바탕색을 입히고,
   흰/검 음영과 명시색 면은 그대로 둔다. */
function paintBase(faces: ShapeFace[], base: string): ShapeFace[] {
  return faces.map(([d, o, f, k]) => [d, o, f ?? base, k] as ShapeFace);
}

/* 일정 폭 막대 사지(지적: 드라군 다리 '통' 느낌) — 뿔과 달리 두께가 끝까지 같고 양 끝이
   반원인 캡슐 막대. 레이스 아래 포신과 같은 화면 투영 스타디움이라 어느 요잉에서도
   결이 같다. 깊이 키는 뿔과 같은 규칙. */
function rodFaces(
  x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, w: number,
): ShapeFace[] {
  /* 원기둥 투영으로(재수리·지적: 질럿·드라군·레이스 막대는 그대로) — tubeFaces와 같은
     끝 처리: 스타디움 호 대신 축 방향으로 돌린 끝 타원 두 장 + 접선 사각. 화면축 기움
     (ang)을 타원에 실어 어느 방향에서도 끝이 물리거나 뚫리지 않는다. */
  const [ax, ay] = project(x1, y1, z1);
  const [bx, by] = project(x2, y2, z2);
  const dx = bx - ax;
  const dy = by - ay;
  const L = Math.hypot(dx, dy);
  const r = w / 2;
  const re = r * 0.62;
  const ang = Math.round(((Math.atan2(dy, dx) * 180) / Math.PI) * 100) / 100;
  const nx = L < 0.05 ? 0 : (-dy / L) * r;
  const ny = L < 0.05 ? r : (dx / L) * r;
  const endDisc = (ex: number, ey: number): string =>
    `M${ex + nx} ${ey + ny} A${re} ${r} ${ang} 1 1 ${ex - nx} ${ey - ny}`
    + ` A${re} ${r} ${ang} 1 1 ${ex + nx} ${ey + ny} Z`;
  const faces: ShapeFace[] = [bodyFace(endDisc(ax, ay)), bodyFace(endDisc(bx, by))];
  if (L >= 0.05) {
    faces.push(
      bodyFace(`M${ax + nx} ${ay + ny} L${bx + nx} ${by + ny}`
        + ` L${bx - nx} ${by - ny} L${ax - nx} ${ay - ny} Z`),
      sideFace(`M${ax} ${ay} L${bx} ${by} L${bx - nx} ${by - ny} L${ax - nx} ${ay - ny} Z`, 0.2),
    );
  }
  const dA = depthNow(x1, y1);
  const dB = depthNow(x2, y2);
  return tagKey(
    faces,
    (dA + dB) / 2 + Math.min(Math.abs(z2 - z1) + w, Math.abs(dA - dB) / 2),
  );
}

/* 탱크 궤도(재지적: 캐터필러 넷의 옆면이 알약꼴이어야) — (y,z) 알약 윤곽을 x 폭으로
   밀어낸 슬래브. 안·바깥 옆판과 대응 점을 잇는 둘레 띠로 채워 어느 각에서도 틈이 없고,
   보이는 옆판엔 음영을 얹는다. 바닥은 z 0. */
function trackFaces(cx: number, yA: number, yB: number, h: number, w: number): ShapeFace[] {
  const rc = h / 2;
  const yAc = yA + rc;
  const yBc = yB - rc;
  const ring = (x: number): [number, number, number][] => {
    const pts: [number, number, number][] = [];
    const N = 6;
    for (let i = 0; i <= N; i += 1) { // 앞 반원: 위 → 앞 → 아래.
      const t = Math.PI / 2 - (i / N) * Math.PI;
      pts.push([x, yBc + Math.cos(t) * rc, rc + Math.sin(t) * rc]);
    }
    for (let i = 0; i <= N; i += 1) { // 뒤 반원: 아래 → 뒤 → 위.
      const t = -Math.PI / 2 - (i / N) * Math.PI;
      pts.push([x, yAc + Math.cos(t) * rc, rc + Math.sin(t) * rc]);
    }
    return pts;
  };
  const inn = ring(cx - w / 2);
  const out2 = ring(cx + w / 2);
  const faces: ShapeFace[] = [bodyFace(polyPath3(inn))];
  const M = inn.length;
  for (let i = 0; i < M; i += 1) {
    const j = (i + 1) % M;
    faces.push(bodyFace(polyPath3([inn[i], inn[j], out2[j], out2[i]])));
  }
  // 윗 평면 띠(두 반원 사이)는 밝게.
  faces.push(topFace(polyPath3([inn[M - 1], inn[0], out2[0], out2[M - 1]]), 0.15));
  faces.push(bodyFace(polyPath3(out2)));
  const fx = facingRatio(1, 0);
  if (fx > 0.05) faces.push(sideFace(polyPath3(out2), 0.14 * Math.min(1, fx * 2)));
  else if (fx < -0.05) faces.push(sideFace(polyPath3(inn), 0.14 * Math.min(1, -fx * 2)));
  const sAbs = Math.abs(depthNow(1, 0));
  const cAbs = Math.abs(depthNow(0, 1));
  return tagKey(
    faces,
    depthNow(cx, (yA + yB) / 2) + Math.min(h, (w / 2) * sAbs + ((yB - yA) / 2) * cAbs),
  );
}

/* 해처리 둔덕 한 벌 — 옆띠 색만 갈라 쓴다(하이브는 상아색, 요청). */
function hatcheryMoundFaces(seamColor: string, spikeColor = "#1b1e23"): ShapeFace[] {
    const out: ShapeFace[] = [];
    // (이동) 여섯 다리 전부 아래 방향별 묶음에서 — 60도 균등 배치.
    /* 꼭대기 볏(실물) — 뒤로 벌어져 굽는 볏 뿔 한 쌍. 둔덕보다 먼저 그려 밑동이
       가려진다(지적: 뿔이 비쳐 보였다). */
    // 위 볏 뿔 — 해처리·레어 검정, 하이브 진한 상아(spikeColor).
    /* 볏 뿔에도 제 자리 깊이(지적: 해처리도 가려짐) — 둔덕 뒤(-y)로 뻗는 뿔이라
       뒤에서는 둔덕에 가리고 앞에서는 위로 온다. */
    /* 키는 한 자로 잰다(요청: 해처리·레어·하이브는 구조가 복잡해 키값을 잘 따져야
       한다) — 둔덕이 0이고, 둔덕에 붙는 모든 부품은 제 뿌리의 깊이 × 1.6을 쓴다.
       그러면 앞으로 돈 것은 둔덕 위로, 뒤로 돈 것은 둔덕 뒤로 저절로 갈린다.
       볏 뿔만은 둔덕 꼭대기 위(z 5.7~)에 얹히므로 +9를 더해 늘 위로 올린다. */
    out.push(...tagKey(spikeHorn(-1.1, -0.7, 5.7, -3.2, -1.6, 9.4, 1.3, spikeColor, 6, -0.5),
      depthNow(-2.2, -1.2) * 1.6 + 9));
    out.push(...tagKey(spikeHorn(1.1, -0.6, 5.7, 3.3, -1.4, 9.6, 1.4, spikeColor, 6, -0.5),
      depthNow(2.2, -1) * 1.6 + 9));
    /* 본 기둥 — 뒤집힌 밥그릇(돔)이 아니라 후지산 둔덕(지적): 위는 좁게 잘리고 옆구리는
       가파르다가 바닥에서 완만하게 벌어진다. 회전 대칭이라 요잉 불변. */
    /* 둔덕을 스파이어 기둥으로(요청) — 후지산 꼴: 넓은 밑동에서 위로 갈수록 좁아지되
       아래쪽은 굵기를 오래 유지(hold)해 완만한 치마가 되고 위는 가파르다. 회전 대칭
       (16각)이라 요잉에 흔들림이 없다. */
    /* 후지산 옆선(재지적) — 아래는 완만하고 위로 갈수록 급해진다: 굵기 곡률(taper)을
       0.55로 줘 한 기둥으로 낸다. 옆면 띠도 이 옆선을 그대로 타고 올라 둔덕과 한 몸이
       된다(두 덩이를 겹치지 않는다). */
    const MND_H = 6.6;
    const MND_RB = 5.9;
    const MND_RT = 1.4;
    // 경사 반전(재지적) — 위는 수직에 가깝고 아래로 갈수록 눕는다: taper > 1.
    const MND_P = 2.2;
    const moundR = (t9: number): number => MND_RT + (MND_RB - MND_RT) * (1 - t9) ** MND_P;
    out.push(...tagKey(spirePillar({
      x: 0, y: 0, z0: 0, h: MND_H, w: MND_RB, tipW: MND_RT,
      segs: 9, sides: 16, hold: 0, taper: MND_P,
    }), 0));
    const [mx, my] = project(0, 0, 6.35);
    out.push(sideFace(`M${mx - 1.5} ${my} L${mx + 1.5} ${my} Q${mx + 1.4} ${my + 1} ${mx} ${my + 1.15} Q${mx - 1.4} ${my + 1} ${mx - 1.5} ${my} Z`, 0.35));
    out.push(topFace(groundEllipse(mx, my, 1.4, 0.4)));
    /* 옆선 여섯 + 입구발 여섯(재재재지적: 60도 균등, 옆선이 입구굴과 딱 맞게) —
       다리와 얇은 경사면 옆선을 같은 각에 두고 방향별 깊이 키로 묶는다. 뒤로 돈
       옆선은 안 그린다(둔덕이 가린다). */
    for (const ang of [-160, -100, -40, 20, 80, 140]) {
      const a2 = (ang * Math.PI) / 180;
      const dxr = Math.sin(a2);
      const dyr = Math.cos(a2);
      const dep = depthNow(dxr * 4.2, dyr * 4.2);
      /* 다리(사진 지적: 이 검은 상자들 제거) — 입구발 슬래브를 전부 걷고, 옆선이
         꼭대기에서 바닥까지 이어져 입구굴을 대신 말한다. */
      /* 가림 문턱 완전 제거(재재지적) — 늘 그리고 앞뒤는 깊이 키가 정한다(뒤로 돈
         것은 둔덕 뒤). 옆띠는 바닥까지, 발치에 진짜 반원형 캐노피 입구굴을 복원한다:
         띠 색 반원 테 + 속 어두운 굴. */
      {
        /* 옆면 띠와 입구 캐노피를 스파이어 기둥으로(요청) — 띠는 꼭대기 언저리에서
           밑동까지 흐르는 가는 기둥이고, 캐노피는 그 발치에서 바깥으로 뻗는 굵은
           기둥이다. 둘 다 둔덕 표면을 타고 앉는다. */
        const seamPillar = spirePillar({
          // 밑동은 굵게 열고 위로 갈수록 가늘게 — 아래 단면이 곧 입구다.
          x: 0, y: 0, h: 1, w: 0.92, tipW: 0.4,
          segs: 8, sides: 6, hold: 0.08, taper: 1.6,
          // 둔덕 옆선을 그대로 타는 축 — 표면에 반쯤 묻혀 한 몸으로 이어진다.
          path: (t9: number): [number, number, number] => {
            const r9 = moundR(t9) * 0.99;
            return [dxr * r9, dyr * r9, MND_H * t9];
          },
          fill: seamColor,
        });
        /* 캐노피·동그라미 입구 표현 모두 제거(재지적) — 옆면 기둥의 굵게 열린 아래
           단면 자체가 들머리 노릇을 한다. */
        out.push(...tagKey(seamPillar, dep * 1.6));
      }
    }
    // 바닥 갈고리 덩굴(실물) — 다리 사이로 기다가 끝이 말려 올라간다.
    // 옆 갈고리 가시 — spikeColor(하이브는 진한 상아, 재지적).
    // 바닥 덩굴도 같은 자 — 둔덕 밖이라 앞뒤만 옳으면 된다.
    out.push(...tagKey(spikeHorn(4.2, 4.2, 0.5, 6.6, 6, 0.9, 0.7, spikeColor), depthNow(5.4, 5.1) * 1.6));
    out.push(...tagKey(spikeHorn(6.6, 6, 0.9, 7.4, 6.6, 2.4, 0.5, spikeColor), depthNow(7, 6.3) * 1.6));
    out.push(...tagKey(spikeHorn(-5.6, 2, 0.5, -7.8, 2.8, 0.9, 0.7, spikeColor), depthNow(-6.7, 2.4) * 1.6));
    out.push(...tagKey(spikeHorn(-7.8, 2.8, 0.9, -8.6, 3, 2.2, 0.5, spikeColor), depthNow(-8.2, 2.9) * 1.6));
    return out;
}

export const SHAPE_BUILDERS: Record<string, () => ShapeFace[]> = {
  /* 커맨드 센터(실물 참고) — 넓은 원반 선체 3단 + 위 관제 모듈(빛 띠·돔) + 앞으로
     내려오는 전개 램프 + 네 귀 돔 발. */
  tomb: () => {
    // 이륙 가능 건물의 발은 은색(요청) — 커맨드 네 귀 돔 발.
    const pod = (px: number, py: number): ShapeFace[] => paintBase([
      ...cylinderFaces3(px, py, 1.1, 1.1),
      ...domeFaces3(px, py, 1.6, 1.4, 1.05),
    ], "#c9ced6");
    const out: ShapeFace[] = [...pod(-5.4, -4.4), ...pod(5.4, -4.4)];
    out.push(...cylinderFaces3(0, 0, 6.4, 2.4));
    out.push(capFace(discPath3(0, 0, 2.42, 5.6), 0.2));
    // 위뚜껑은 큰 돔(지적: 돔 형태를 살린다). 반구 높이 증가(재지적: 구 높이 더).
    out.push(...domeFaces3(0, 0, 5.4, 4.4, 2.4));
    /* 그릇 굴뚝·관제 모듈은 돔 위 얹힘(지적: 가려짐이 이상) — 돔의 큰 키(반지름
       몫)에 밀리지 않게 지붕 규칙 키를 준다. */
    out.push(...tagKey([
      ...cylinderFaces3(3.4, -2.2, 1.15, 1.3, 4.1),
      bodyFace(discPath3(3.4, -2.2, 5.45, 1.7)),
      capFace(discPath3(3.4, -2.2, 5.5, 1.25), 0.5),
    ], 30));
    // 관제 모듈 — 돔 꼭대기의 상자 + 앞면 빛 띠 + 지붕 돔.
    // 관제 모듈 상자는 구리색(요청).
    out.push(...tagKey(paintBase(boxFaces3(0, 0.2, 3, 2.6, 1.8, 5.5), "#b87748"), 31));
    /* 앞면 장식(빛 띠·전개 램프)은 앞이 보일 때만(지적: 시점에 따라 기대와 다른 위치) —
       뒤로 돌린 각도에서도 그리면 몸 위로 떠올라 팔처럼 삐져나와 보였다. */
    const frontVisible = faceLight(0, 1).visible;
    if (frontVisible) {
      out.push(capFace(polyPath3([[-1.2, 1.51, 5.9], [1.2, 1.51, 5.9], [1.2, 1.51, 6.3], [-1.2, 1.51, 6.3]]), 0.5));
      out.push(topFace(polyPath3([[-1, 1.52, 5.95], [1, 1.52, 5.95], [1, 1.52, 6.25], [-1, 1.52, 6.25]]), 0.35));
    }
    out.push(...tagKey(domeFaces3(0, 0.2, 1.15, 0.85, 7.3), 32));
    if (frontVisible) {
      // 전개 램프(실물) — 선체 중턱 해치에서 앞 바닥으로. 제 깊이(지적: 가려짐 이상).
      const ramp = polyPath3([[-1.3, 6, 2.4], [1.3, 6, 2.4], [2.1, 9.6, 0], [-2.1, 9.6, 0]]);
      // 진출입 경사로는 은색(요청).
      const rampFaces: ShapeFace[] = [[ramp, 1, "#c9ced6"] as ShapeFace, topFace(ramp, 0.16)];
      for (const t of [0.25, 0.5, 0.75]) {
        const yy = 6 + 3.6 * t;
        const zz = 2.4 * (1 - t);
        const ww = 1.3 + 0.8 * t;
        rampFaces.push(capFace(polyPath3([[-ww, yy, zz + 0.02], [ww, yy, zz + 0.02], [ww, yy + 0.3, zz - 0.18], [-ww, yy + 0.3, zz - 0.18]]), 0.3));
      }
      out.push(...tagKey(rampFaces, depthNow(0, 7.8) + 0.5));
    }
    out.push(...pod(-5.6, 3.9), ...pod(5.6, 3.9));
    return out;
  },
  /* 배럭(실물 참고) — 중앙 몸통 + 좌우로 더 높은 쌍탑 + 벌어진 네 다리와 원반 발. */
  cube: () => {
    /* 배럭(사진 참고·요청) — 크게 보면 얇은 직육면체 판 셋(가운데·좌·우)이 나란히
       서고 그 사이를 입체 상자가 잇는 꼴이다. 뒤쪽에는 좌우 판 끝에 비스듬한 환풍구가
       붙고, 가운데 판 위에도 길게 환풍구가 얹힌다. */
    const out: ShapeFace[] = [];
    // 다리 여섯(지적) — 앞뒤 세 쌍.
    out.push(
      ...legAndFoot(-3.9, 3.4, 2.8), ...legAndFoot(0, 4.3, 2.8), ...legAndFoot(3.9, 3.4, 2.8),
      ...legAndFoot(-3.9, -3.4, 2.8), ...legAndFoot(0, -4.3, 2.8), ...legAndFoot(3.9, -3.4, 2.8),
    );
    // 사이를 잇는 입체 상자 — 판보다 낮고 짧아 판 셋이 도드라진다.
    /* 사이 상자는 판보다 앞뒤로 조금 더 내민다(지적: 판에 가려 안 보임) — 판이
       더 길면 정면에서 통째로 덮인다. 키도 판과 같은 층에 둬 요잉으로 앞뒤가 갈린다. */
    out.push(...tagKey(boxFaces3(-2.1, 0, 2.9, 8.2, 4.6, 2.9), 14 + depthNow(-2.1, 0)));
    out.push(...tagKey(boxFaces3(2.1, 0, 2.9, 8.2, 4.6, 2.9), 14 + depthNow(2.1, 0)));
    // 얇은 판 셋(재지적) — 양쪽 판이 더 크고 가운데가 오히려 작다.
    out.push(...tagKey(boxFaces3(-4.1, 0, 1.9, 7.6, 7.2, 2.4), 14 + depthNow(-4.1, 0)));
    out.push(...tagKey(boxFaces3(4.1, 0, 1.9, 7.6, 7.2, 2.4), 14 + depthNow(4.1, 0)));
    out.push(...tagKey(boxFaces3(0, 0, 1.6, 6.4, 5.8, 2.4), 16 + depthNow(0, 0)));
    /* 뒤쪽 환풍구(사진) — 좌우 판 뒤끝에 비스듬히 앉은 격자 상자. 살짝 기울여 뒤로
       빠지고, 앞면에 밝은 살 세 줄. */
    /* 환풍구는 양쪽 판 위에(재지적) — 판 꼭대기(z 9.6)에 앞뒤로 긴 상자를 얹고
       가로 살을 긋는다. 뒤쪽으로 치우쳐 앉는다(사진). */
    for (const sx9 of [-1, 1] as const) {
      const vx9 = sx9 * 4.1;
      out.push(...tagKey([
        ...boxFaces3(vx9, -1, 1.7, 4.8, 1.2, 9.6),
        ...Array.from({ length: 4 }, (_, i9) => topFace(polyPath3([
          [vx9 - 0.7, -3 + i9 * 1.15, 10.85], [vx9 + 0.7, -3 + i9 * 1.15, 10.85],
          [vx9 + 0.7, -2.62 + i9 * 1.15, 10.85], [vx9 - 0.7, -2.62 + i9 * 1.15, 10.85],
        ]), 0.3)),
      ], 18 + depthNow(vx9, -1)));
    }
    /* 가운데 판 위 환풍구 — 양쪽보다 작고 짧다. */
    out.push(...tagKey([
      ...boxFaces3(0, -0.8, 1.3, 3, 0.9, 8.2),
      ...Array.from({ length: 3 }, (_, i9) => topFace(polyPath3([
        [-0.52, -1.9 + i9 * 0.95, 9.15], [0.52, -1.9 + i9 * 0.95, 9.15],
        [0.52, -1.58 + i9 * 0.95, 9.15], [-0.52, -1.58 + i9 * 0.95, 9.15],
      ]), 0.3)),
    ], 20 + depthNow(0, -0.8)));
    // 좌우 판 어깨의 밝은 띠(기존 포인트 유지).
    out.push(topFace(polyPath3([[-5, 2.6, 9.65], [-3.2, 2.6, 9.65], [-3.2, 1.7, 9.65], [-5, 1.7, 9.65]]), 0.3));
    out.push(topFace(polyPath3([[3.2, 2.6, 9.65], [5, 2.6, 9.65], [5, 1.7, 9.65], [3.2, 1.7, 9.65]]), 0.3));
    return out;
  },
  /* 서플라이(단순화, 지적) — 본체 상자 + 지붕 큰 회전 통풍구 + 앞면의 더 큰 둥근 팬
     둘 + 왼앞 줄무늬 차단바. 잔장식(등판·캐니스터·탱크)은 걷어냈다. */
  trapezoid: () => {
    // 높이 상향(지적: 4.6→6).
    const out: ShapeFace[] = [...boxFaces3(0, 0, 10.8, 6.8, 6)];
    // 지붕 회전 통풍구 — 크게.
    out.push(capFace(discPath3(-2.3, 0.3, 6.05, 2.8), 0.3));
    out.push([discPath3(-2.3, 0.3, 6.1, 2.3), 1, "#c9ced6"] as ShapeFace); // 디스크 은색(요청)
    for (const ang of [0, 45, 90, 135]) {
      const a = (ang * Math.PI) / 180;
      out.push(capFace(polyPath3([
        [-2.3 - Math.sin(a) * 2.05, 0.3 - Math.cos(a) * 2.05, 6.15],
        [-2.3 + Math.sin(a) * 2.05, 0.3 + Math.cos(a) * 2.05, 6.15],
        [-2.3 + Math.sin(a) * 2.05 + Math.cos(a) * 0.32, 0.3 + Math.cos(a) * 2.05 - Math.sin(a) * 0.32, 6.15],
        [-2.3 - Math.sin(a) * 2.05 + Math.cos(a) * 0.32, 0.3 - Math.cos(a) * 2.05 - Math.sin(a) * 0.32, 6.15],
      ]), 0.35));
    }
    /* 앞면 둥근 팬 둘 — 벽 무늬로(지적: 각도에 따라 본체와 따로 노는 느낌) — 화면
       좌표에 동그라미를 그리면 요잉해도 시청자만 바라봐 벽에서 떨어져 보였다. 벽
       평면에 구워 벽과 함께 돌고, 앞면이 안 보이는 각도에선 아예 그리지 않는다. */
    const frontVisible = faceLight(0, 1).visible;
    if (frontVisible) {
      const fan = (fx: number, fz: number, r: number): void => {
        out.push(capFace(wallDiscPath(fx, 3.41, fz, r, r * 0.94), 0.42));
        out.push([wallDiscPath(fx, 3.41, fz, r * 0.78, r * 0.72), 1, "#c9ced6"] as ShapeFace); // 디스크 은색(요청)
        // 날개도 같은 벽 평면 안에서 — 부채꼴을 평면 좌표계(wallFrame)로 그린다.
        const { c, pt } = wallFrame(fx, 3.41, fz, r * 0.7, r * 0.64);
        for (const ang of [15, 105, 195, 285]) {
          const a = (ang * Math.PI) / 180;
          const p1 = pt(a);
          const p2 = pt(a + 0.55, 1.06);
          const p3 = pt(a + 1.1);
          out.push(capFace(`M${c[0]} ${c[1]} L${p1[0]} ${p1[1]} Q${p2[0]} ${p2[1]} ${p3[0]} ${p3[1]} Z`, 0.32));
        }
      };
      fan(0.8, 3, 2.05);
      fan(3.7, 2.9, 1.6);
    }
    // 왼앞 줄무늬 차단바 — 줄무늬는 앞면 무늬라 앞이 안 보이면 함께 숨긴다(지적).
    out.push(...boxFaces3(-3.3, 4.05, 3.6, 0.9, 1.15));
    if (frontVisible) {
      for (let i = 0; i < 4; i += 1) {
        const x0 = -4.9 + i * 0.9;
        out.push(capFace(polyPath3([
          [x0, 4.51, 0.15], [x0 + 0.45, 4.51, 0.15], [x0 + 0.85, 4.51, 1], [x0 + 0.4, 4.51, 1],
        ]), 0.4));
      }
    }
    return out;
  },
  /* 팩토리(실물 참고) — 큰 본체 상자 + 앞 낮은 별채 + 지붕 굴뚝 셋 + 오른뒤 포탑 + 발. */
  factory: () => {
    /* 팩토리(요청·사진) — 직육면체가 아니라, 위아래 모서리를 크게 깎은 넓적한 8각
       단면을 길이 방향으로 뽑은 장갑 몸통이다. 옆면에는 패널 홈이 줄지어 파이고,
       앞끝에 붉은 장갑판과 주황 화살표가, 지붕에는 굴뚝 셋과 붉은 테를 두른 관제
       모듈이 얹힌다. */
    const X0 = -5.5;
    const X1 = 4.3;
    const ZT = 6.9;
    // 8각 단면 — (y, z). 바닥·천장은 넓고 네 모서리는 45도로 깎였다.
    const SEC: [number, number][] = [
      [-3, 2.2], [-2, 1.2], [2, 1.2], [3, 2.2], [3, 5.9], [2, ZT], [-2, ZT], [-3, 5.9],
    ];
    const out: ShapeFace[] = [
      // 본체 바닥 패드 넷(지적: 가려져 있어도 이륙 발이 있어야 한다) — 은색.
      ...legAndFoot(-4.6, 1.6, 1.3),
      ...legAndFoot(3.4, 1.6, 1.3),
      ...legAndFoot(-4.6, -2.8, 1.3),
      ...legAndFoot(3.4, -2.8, 1.3),
    ];
    // 몸통 — 뒤에서 앞으로 정렬해 그린다(같은 키 묶음이라 순서가 곧 앞뒤다).
    {
      type Panel = { d: string; nx: number; ny: number; nz: number; dep: number };
      const faces: Panel[] = [];
      for (let i9 = 0; i9 < SEC.length; i9 += 1) {
        const [y1, z1] = SEC[i9];
        const [y2, z2] = SEC[(i9 + 1) % SEC.length];
        const ey = y2 - y1;
        const ez = z2 - z1;
        const l9 = Math.hypot(ey, ez) || 1;
        const ny = ez / l9;
        const nz = -ey / l9;
        faces.push({
          d: polyPath3([[X0, y1, z1], [X0, y2, z2], [X1, y2, z2], [X1, y1, z1]]),
          nx: 0, ny, nz, dep: depthNow(0, ny) * 3 + nz,
        });
      }
      for (const m9 of [-1, 1] as const) {
        const x9 = m9 < 0 ? X0 : X1;
        faces.push({
          d: polyPath3(SEC.map(([y9, z9]) => [x9, y9, z9] as [number, number, number])),
          nx: m9, ny: 0, nz: 0, dep: depthNow(m9, 0) * 3,
        });
      }
      const body: ShapeFace[] = [];
      for (const f9 of faces.sort((a9, b9) => a9.dep - b9.dep)) {
        const fl9 = faceLight(f9.nx, f9.ny, f9.nz);
        body.push(bodyFace(f9.d), ...(fl9.visible ? fl9.face(f9.d) : [sideFace(f9.d, 0.44)]));
      }
      out.push(...tagKey(body, depthNow(-0.6, -0.6) * 1.6));
    }
    /* 옆면 디테일 — 보이는 쪽 벽에만 얹는다. 패널 홈 넷과 그 아래 붉은 장갑 띠. */
    for (const sy of [1, -1] as const) {
      if (!faceLight(0, sy, 0).visible) continue;
      /* 옆면 데칼은 그 벽이 보일 때만 그리므로 벽보다 한 단만 위면 된다(지적: 팩토리
         키값 수정) — +10은 지붕 얹힘(24대)과 뒤섞여 앞뒤가 뒤집혔다. */
      const key = depthNow(0, sy * 3) * 1.6 + 0.4;
      const det: ShapeFace[] = [];
      const yw = sy * 3.02;
      for (const px of [-4.2, -1.9, 0.4, 2.7]) {
        det.push(sideFace(polyPath3([
          [px - 0.85, yw, 3.1], [px + 0.85, yw, 3.1], [px + 0.85, yw, 5.3], [px - 0.85, yw, 5.3],
        ]), 0.34));
        det.push(topFace(polyPath3([
          [px - 0.7, yw, 4.5], [px + 0.7, yw, 4.5], [px + 0.7, yw, 5.15], [px - 0.7, yw, 5.15],
        ]), 0.2));
      }
      // 앞끝 붉은 장갑판 — 깎인 모서리 아래.
      det.push([polyPath3([[2.9, yw, 2.4], [4.2, yw, 2.4], [4.2, yw, 4.2], [2.9, yw, 4.2]]),
        1, "#a8322a"] as ShapeFace);
      // 주황 화살표 셋 — 진출 방향 표시.
      for (const az of [2.8, 3.5, 4.2]) {
        det.push([polyPath3([[-5, yw, az], [-4.3, yw, az + 0.45], [-3.6, yw, az]]),
          1, "#e08a2b"] as ShapeFace);
      }
      out.push(...tagKey(det, key));
    }
    return out.concat(
      // 앞오른쪽 낮은 부속 상자.
      tagKey(boxFaces3(3.2, 2.8, 4, 2.8, 3.6, 1.2), depthNow(3.2, 2.8) * 1.6),
      // 지붕 규칙(지적: 굴뚝 가려짐) — 지붕 얹힘들은 붙박이 큰 키. 굴뚝 셋 은색(요청).
      tagKey(paintBase(cylinderFaces3(-3.4, -1.6, 0.85, 1.7, ZT), "#c9ced6"), 24 + depthNow(-3.4, -1.6)),
      tagKey(paintBase(cylinderFaces3(-1.5, -1.8, 0.85, 1.7, ZT), "#c9ced6"), 24 + depthNow(-1.5, -1.8)),
      tagKey(paintBase(cylinderFaces3(0.4, -1.9, 0.85, 1.7, ZT), "#c9ced6"), 24 + depthNow(0.4, -1.9)),
      // 관제 모듈 — 붉은 테를 두른 지붕 상자(사진).
      tagKey(boxFaces3(3, -1.6, 2.8, 2.2, 2.4, ZT), 24 + depthNow(3, -1.6)),
      tagKey([[polyPath3([[1.7, -0.48, ZT + 0.5], [4.3, -0.48, ZT + 0.5],
        [4.3, -0.48, ZT + 2.2], [1.7, -0.48, ZT + 2.2]]), 1, "#a8322a"] as ShapeFace],
      25 + depthNow(3, -0.5)),
      tagKey(tubeFaces(2.6, -2.6, 5, -2.6, 0.45, ZT + 2.7), 26 + depthNow(3.8, -2.6)),
      /* 다리는 없다(지적) — 대신 앞으로 나란히 내려오는 경사로 셋. 제 깊이를 달아
         뒤로 돌면 몸통 뒤로 들어간다. */
      [-3.8, -1, 1.8].flatMap((rx) => {
        const d = polyPath3([[rx - 1.1, 2.4, 1.2], [rx + 1.1, 2.4, 1.2], [rx + 1.3, 5.2, 0], [rx - 1.3, 5.2, 0]]);
        // 진출 경사로 은색(요청).
        return tagKey([
          [d, 1, "#c9ced6"] as ShapeFace,
          topFace(d, 0.14),
          sideFace(polyPath3([[rx + 1.1, 2.4, 1.2], [rx + 1.3, 5.2, 0], [rx + 1.05, 5.2, 0], [rx + 0.88, 2.4, 1.2]]), 0.25),
        ], depthNow(rx, 3.8) * 1.6);
      }),
    );
  },

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
    // 옆 날개(지적) — 좌우로 짧게 뻗는 판. 제 자리 깊이를 단다(앞 착륙장 키에 안 묻게).
    out.push(...tagKey([bodyFace(polyPath3([[-5, 1, 3.4], [-8, 0.2, 2.6], [-7.6, -1, 2.6], [-4.8, -0.6, 3.4]]))], depthNow(-6.4, 0)));
    out.push(...tagKey([
      bodyFace(polyPath3([[5, 1, 3.4], [8, 0.2, 2.6], [7.6, -1, 2.6], [4.8, -0.6, 3.4]])),
      sideFace(polyPath3([[5, 1, 3.4], [8, 0.2, 2.6], [7.6, -1, 2.6], [4.8, -0.6, 3.4]]), 0.2),
    ], depthNow(6.4, 0)));
    /* 윗 원판은 지붕이라 어느 각에서도 맨 위(지적: 정면 말고는 앞 다리·착륙장에 살짝
       가려짐) — 아주 큰 키로 못 박는다. 그 위 네 기둥·등은 뒤이어 그려져 그대로 위다. */
    out.push(...tagKey([
      bodyFace(discPath3(0, 0, 4.1, 6.4)),
      topFace(discPath3(0, 0, 4.13, 5.2), 0.25),
      capFace(discPath3(0, 0, 4.16, 3.9), 0.35),
    ], 50));
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
      /* 경사 날개의 위 성분(지적: 정면에서 양쪽 경사벽이 안 보임) — 안(2, z2.6)에서
         밖(5.6, z0)으로 눕는 벽이라 법선이 하늘을 많이 봐, 옆을 향해도 위에서 보인다. */
      const { visible, face } = faceLight(sx, sy, 3.6 / Math.hypot(2.6, 3.6));
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
        out.push([`${tread} ${riser}`, 1, "#c9ced6"] as ShapeFace, topFace(tread, 0.22), ...face(riser)); // 계단 은색(요청)
      }
    }
    /* 경사면 사이 메움(지적: 네 날개 사이가 뚫림) — 이웃 날개의 맞닿는 빗변끼리 능선
       사각(안쪽 두 점이 거의 붙어 사실상 삼각)으로 잇고, 같은 경사 법선으로 판정한다. */
    for (const ang of [0, 90, 180, 270]) {
      const a0 = (ang * Math.PI) / 180;
      const a1 = ((ang + 90) * Math.PI) / 180;
      const edge = (a: number, side: 1 | -1): [number, number, number][] => {
        const sx = Math.sin(a);
        const sy = Math.cos(a);
        const cxa = Math.cos(a);
        const sya = -Math.sin(a);
        return [
          [sx * 2 + side * cxa * 2.4, sy * 2 + side * sya * 2.4, 2.6],
          [sx * 5.6 + side * cxa * 3.3, sy * 5.6 + side * sya * 3.3, 0],
        ];
      };
      const [inA, outA] = edge(a0, 1);
      const [inB, outB] = edge(a1, -1);
      const nx = (Math.sin(a0) + Math.sin(a1)) / Math.SQRT2;
      const ny = (Math.cos(a0) + Math.cos(a1)) / Math.SQRT2;
      const { visible, face } = faceLight(nx, ny, 3.6 / Math.hypot(2.6, 3.6));
      if (!visible) continue;
      const d = polyPath3([inA, outA, outB, inB]);
      out.push(bodyFace(d), ...face(d));
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
        // 받침 원반도 제 깊이(지적: 기둥 바닥의 원들이 안 가려짐).
        ...tagKey([
          bodyFace(discPath3(px, py, 0.45, 1.6)),
          sideFace(discPath3(px, py, 0.42, 1.6), 0.25),
        ], depthNow(px, py)),
        /* 끝을 도려내고 팁을 꽂는다(재재재지적: 화살촉처럼 튀지 않게) — 팁 원뿔이
           그 높이의 기둥 굵기보다 늘 살짝 굵어 기둥 끝을 완전히 감싼다. */
        ...hornFaces(px, py, 0.4, px, py, 8.8, 1.7),
        ...paintBase(hornFaces(px, py, 6.8, px, py, 8.9, 0.5), "#3bd8c2"),
        topFace(groundEllipse(kx, ky, 0.45, 0.65), 0.5),
      ];
    };
    /* 기둥 자리 6.6 → 6.0(수리: 대각 모서리 기둥이 요잉 투영에서 뷰박스 가로(±8)를
       넘어 잘려 떨어져 나간 듯 보였다 — rx = 6.6cos20 + 6.6sin20 ≈ 8.46). */
    // 6.0 → 5.6(재지적: 왼뒤 기둥이 너무 바깥) — 받침 원반이 피라미드 모서리에 걸치게 붙인다.
    /* 상자 정규화(지적: 넥서스가 발자국을 초과) — 기둥·받침이 요잉 투영에서 ±9까지
       나가 16칸 상자를 넘쳤다. 전체를 0.85배로 눌러 안에 들인다. */
    const out: ShapeFace[] = [...pillar(-4.7, -4.7), ...pillar(4.7, -4.7)];
    out.push(...frustumFaces3(0, 0, 9, 9, 2.8, 2.8, 6.4));
    // 앞면 능선 띠 — 경사면을 따라 층층이 가로 띠.
    const half = (z: number): number => 4.5 - (4.5 - 1.4) * (z / 6.4);
    for (const bz of [1.4, 3, 4.6]) {
      const w0 = half(bz) - 0.35;
      const w1 = half(bz + 0.6) - 0.35;
      out.push(topFace(polyPath3([
        [-w0, half(bz), bz], [w0, half(bz), bz],
        [w1, half(bz + 0.6), bz + 0.6], [-w1, half(bz + 0.6), bz + 0.6],
      ]), 0.2));
    }
    // 꼭대기 받침 + 수정 — 지붕 키로 가림 해결(지적) + 옥색~시안 고정색(지적).
    out.push(...tagKey([
      ...boxFaces3(0, 0, 2.9, 2.9, 0.8, 6.4),
      [`M${project(0, 0, 7.2)[0]} ${project(0, 0, 7.2)[1] - 2.7} L${project(0, 0, 7.2)[0] + 1.25} ${project(0, 0, 7.2)[1] - 0.9} L${project(0, 0, 7.2)[0]} ${project(0, 0, 7.2)[1] + 0.55} L${project(0, 0, 7.2)[0] - 1.25} ${project(0, 0, 7.2)[1] - 0.9} Z`, 1, "#3bd8c2"] as ShapeFace,
      topFace(`M${project(0, 0, 7.2)[0]} ${project(0, 0, 7.2)[1] - 2.7} L${project(0, 0, 7.2)[0] - 1.25} ${project(0, 0, 7.2)[1] - 0.9} L${project(0, 0, 7.2)[0]} ${project(0, 0, 7.2)[1] + 0.55} L${project(0, 0, 7.2)[0] - 0.4} ${project(0, 0, 7.2)[1] - 0.95} Z`, 0.45),
    ], 45));
    /* 사방 삼각형 출구 발판(정정: 바깥쪽이 뾰족한 삼각형) — 넓은 변이 피라미드
       밑동에 기대고, 꼭짓점이 바깥 바닥을 향해 뾰족하게 뻗는다. 전엔 반대(안쪽
       꼭짓점·바깥 넓은 변)였다. */
    for (const ang of [0, 90, 180, 270]) {
      const a = (ang * Math.PI) / 180;
      const sx = Math.sin(a);
      const sy = Math.cos(a);
      const cxa = Math.cos(a);
      const sya = -Math.sin(a);
      const { visible, face } = faceLight(sx, sy);
      if (!visible) continue;
      const d = polyPath3([
        [sx * 4.2 + cxa * 2.2, sy * 4.2 + sya * 2.2, 1.5],
        [sx * 4.2 - cxa * 2.2, sy * 4.2 - sya * 2.2, 1.5],
        [sx * 8.4, sy * 8.4, 0],
      ]);
      // 발판도 제 깊이(지적: 기둥과 가려짐 순서) — 앞 발판만 기둥 위로.
      out.push(...tagKey([bodyFace(d), ...face(d)], depthNow(sx * 5.5, sy * 5.5)));
    }
    out.push(...pillar(-5.6, 5.6), ...pillar(5.6, 5.6));
    return out;
  },
  /* 게이트웨이(실물 점검) — 낮은 사방 경사로 마당 위에 마주 기운 어금니 탑 한 쌍이
     사이를 띄워 문을 이루고, 그 사이에 소환 빛이 선다. */
  gate: () => {
    /* 사방 발판 넷을 저마다 정육각형 판으로(정정 요청) — 한 모서리가 건물 중심을
       보게 돌리고(꼭지점이 아니라), 안쪽 변이 높고 바깥쪽 변이 낮은 쐐기로 눕힌다.
       위아래 두 육각형을 둘레 벽으로 봉합해 얇은 두께를 주고, 벽은 뒤에서 앞으로
       정렬해 그려 입체감을 지킨다. */
    const h = 1.15; // 발판 안쪽(높은 쪽) 윗면 높이 — 기둥·뿔이 여기서 선다.
    const out: ShapeFace[] = [];
    const pad = (cx9: number, cy9: number, r9: number): ShapeFace[] => {
      const inAng9 = Math.atan2(-cy9, -cx9); // 중심을 향하는 방향
      // 모서리 중점이 중심을 보게 — 정육각형 꼭지점은 중점보다 30도 앞선다.
      const base9 = inAng9 - Math.PI / 6;
      const LO9 = 0.32; // 바깥 변 윗면 높이
      const TH9 = 0.32; // 판 두께(요청: 얇게)
      const ox9 = -Math.cos(inAng9);
      const oy9 = -Math.sin(inAng9);
      const hex9 = (dz9: number): [number, number, number][] => Array.from(
        { length: 6 },
        (_, i9) => {
          const a9 = base9 + (i9 / 6) * Math.PI * 2;
          const px9 = cx9 + Math.cos(a9) * r9;
          const py9 = cy9 + Math.sin(a9) * r9;
          // 바깥 방향으로 얼마나 나갔나(-1 안 ~ +1 바깥) → 그만큼 낮아진다.
          const u9 = ((px9 - cx9) * ox9 + (py9 - cy9) * oy9) / r9;
          return [px9, py9, (h + LO9) / 2 - u9 * ((h - LO9) / 2) + dz9];
        },
      );
      const lo9 = hex9(-TH9);
      const hi9 = hex9(0);
      const f9: ShapeFace[] = [bodyFace(polyPath3(lo9))];
      const walls9 = lo9.map((_, i9) => {
        const j9 = (i9 + 1) % 6;
        const mx9 = (lo9[i9][0] + lo9[j9][0]) / 2 - cx9;
        const my9 = (lo9[i9][1] + lo9[j9][1]) / 2 - cy9;
        const ml9 = Math.hypot(mx9, my9) || 1;
        return {
          d: polyPath3([lo9[i9], lo9[j9], hi9[j9], hi9[i9]]),
          nx: mx9 / ml9, ny: my9 / ml9, f: facingRatio(mx9 / ml9, my9 / ml9),
        };
      }).sort((q9, w9) => q9.f - w9.f);
      for (const wl9 of walls9) {
        const fl9 = faceLight(wl9.nx, wl9.ny, 0.3);
        f9.push(bodyFace(wl9.d), ...(fl9.visible ? fl9.face(wl9.d) : [sideFace(wl9.d, 0.46)]));
      }
      f9.push(bodyFace(polyPath3(hi9)), topFace(polyPath3(hi9), 0.2));
      return tagKey(f9, depthNow(cx9, cy9));
    };
    /* 안쪽으로 당긴다(지적: 이웃 게이트의 발판과 겹친다) — 발자국 밖으로 나가면
       옆 건물과 포갠다: 바깥 끝이 5.4를 넘지 않게 자리 3.6·반지름 1.8로 조인다. */
    out.push(...pad(0, 3.6, 1.8));
    out.push(...pad(0, -3.6, 1.8));
    out.push(...pad(3.8, 0, 1.8));
    out.push(...pad(-3.8, 0, 1.8));
    /* 한가운데 작은 사각 판(요청) — 네 발판 사이 바닥을 메운다. */
    {
      const S9 = 1.15;
      const TZ9 = 0.34;
      const sq9 = (z9: number): [number, number, number][] => [
        [-S9, -S9, z9], [S9, -S9, z9], [S9, S9, z9], [-S9, S9, z9],
      ];
      const lo9 = sq9(0);
      const hi9 = sq9(TZ9);
      const f9: ShapeFace[] = [bodyFace(polyPath3(lo9))];
      const walls9 = lo9.map((_, i9) => {
        const j9 = (i9 + 1) % 4;
        const mx9 = (lo9[i9][0] + lo9[j9][0]) / 2;
        const my9 = (lo9[i9][1] + lo9[j9][1]) / 2;
        const ml9 = Math.hypot(mx9, my9) || 1;
        return {
          d: polyPath3([lo9[i9], lo9[j9], hi9[j9], hi9[i9]]),
          nx: mx9 / ml9, ny: my9 / ml9, f: facingRatio(mx9 / ml9, my9 / ml9),
        };
      }).sort((q9, w9) => q9.f - w9.f);
      for (const wl9 of walls9) {
        const fl9 = faceLight(wl9.nx, wl9.ny, 0.3);
        f9.push(bodyFace(wl9.d), ...(fl9.visible ? fl9.face(wl9.d) : [sideFace(wl9.d, 0.46)]));
      }
      f9.push(bodyFace(polyPath3(hi9)), topFace(polyPath3(hi9), 0.2));
      out.push(...tagKey(f9, depthNow(0, 0)));
    }
    /* 실물 점검(스프라이트 시트) — 게이트는 돛 하나가 아니라 마주 기운 어금니 탑
       한 쌍이 사이를 띄우고 문을 이룬다. 사이엔 소환 빛. */
    const [wx, wy] = project(0, 0.1, 4.2);
    /* 탑·구체는 경사로 위 얹힘(지적: 발판에 기둥이 가려짐) — 경사로가 제 깊이를
       달면서 앞 경사로가 탑을 덮었다. 지붕 규칙으로 붙박이 큰 키를 준다. */
    /* 어금니 탑을 4각 기반 기둥뿔로(요청) — 밑동이 굵고 안쪽으로 기울며 끝이
       뾰족해진다. 8각판 위에 얹히므로 지붕 규칙 키를 준다. */
    /* 탑 둘은 저마다 제 자리 깊이(재지적: 소환구가 탑에 아예 안 가려진다) — 둘을
       한 키로 묶고 구체를 그 위에 얹었더니, 앞으로 돈 탑까지 구체 뒤로 갔다.
       탑은 30±제 깊이, 구체는 그 한가운데(30)에 두면 앞 탑은 구체를 덮고 뒤 탑은
       구체 뒤로 간다 — 문 사이에 빛이 든 그림이다. */
    // 뿌리만 안쪽으로(지적) — ±2.7 → ±2.1. 끝 자리는 그대로라 눕는 몫이 줄어든다.
    for (const mx9 of [-2.1, 2.1]) {
      out.push(...tagKey(spirePillar({
        // 끝은 뾰족이 아니라 뭉뚝하게 잘린 면(지적) — tipW 0.12 → 0.55.
        // 높이 축소(지적) — 8.4 → 6.4.
        x: mx9, y: 0, z0: h, h: 6.4, w: 1.5, tipW: 0.55,
        /* 끝끼리 모으되 붙지는 않게(재지적: 너무 붙었다) — 안쪽으로 눕는 몫 2.25 →
           1.85. 두 끝 사이에 문틈이 남는다. */
        segs: 5, sides: 4, hold: 0.12, leanX: -Math.sign(mx9) * 1.25, leanY: -0.3, taper: 1.5,
      }), 30 + depthNow(mx9, 0) * 1.6));
    }
    // 가운데 소환 구체 — 두 탑 깊이의 한가운데.
    out.push(...tagKey([
      [groundEllipse(wx, wy, 1.1, 1.4), 0.5, "#a9ecf2"] as ShapeFace,
      topFace(groundEllipse(wx, wy, 0.6, 0.8), 0.4),
    ], 30));
    /* 발판 뿔(요청) — 앞뒤 경사로 한가운데에서 솟아 끝이 안쪽으로 휜다. 아래는 기둥,
       위는 뿔인 공용 도형(spirePillar). */
    for (const sy9 of [1, -1] as const) {
      // 발판과 함께 안쪽으로(지적: 이웃 건물과 겹침).
      const ry9 = sy9 * 2.7;
      /* 작은 뿔이 어금니 탑(키 30)에 안 묻히게(지적) — 앞쪽 뿔은 탑보다 큰 키,
         뒤쪽 뿔은 탑보다 작은 키를 줘 앞뒤가 제대로 갈린다. */
      out.push(...tagKey(spirePillar({
        // 앞뒤 뿔 살짝 축소(요청) — 높이 5.1 → 4.3, 굵기 0.72 → 0.6.
        x: 0, y: ry9, z0: h, h: 4.3, w: 0.6, tipW: 0,
        segs: 4, sides: 6, curveY: -sy9 * 1.2, hold: 0.5,
      }), facingRatio(0, sy9) >= 0 ? 34 : 26));
    }
    return out;
  },
  /* 스타게이트(확정, 요청: 보여준 육각형판으로 — 길이만 조금 짧게) — 긴 육각형
     잎날 넷이 앞뒤 축을 빙 둘러 배 면끼리 마주보는 관(구멍이 앞뒤). 높은 부감
     카메라에서 구멍이 보이도록 관 앞을 35도쯤 들고 앞을 살짝 나팔로 벌렸다.
     각 잎의 안쪽 면엔 밝은 발광 잎. 판·받침은 없다. */
  arch: () => {
    // 그림자는 옅고 아담하게 — 관문이 떠 있는 자리만 알리면 된다.
    const out: ShapeFace[] = [sideFace(discPath3(0, 0.2, 0, 3.4), 0.16)];
    const C = 5; // 관문 축 높이
    // 판만 키운다(요청: 원복 후 현재 형태에서 판 크기만 확대) — 2.7 → 3.1.
    const R = 3.1; // 축에서 잎 배까지 반지름
    /* 잎 하나 — 축 둘레 각 phi(0=위) 자리, 길이는 앞뒤(y·축 방향), 폭은 접선 방향,
       배 면은 축을 본다. 윤곽은 긴 육각형: 양 끝 꼭지 + 나란한 중간 변. */
    const leaf = (phi: number, rr: number, ll: number, ww: number): [number, number, number][] => {
      const rx = Math.sin(phi); // 축에서 바깥 방향(x·z 평면)
      const rz = Math.cos(phi);
      const tx = Math.cos(phi); // 접선 방향
      const tz = -Math.sin(phi);
      // 긴 육각형 여섯 꼭짓점 — (앞뒤 위치, 접선 반폭). 0.5부터 변이 나란하다.
      const HEX: [number, number][] = [
        [-1, 0], [-0.5, 1], [0.5, 1], [1, 0], [0.5, -1], [-0.5, -1],
      ];
      /* 곧은 관(정정: 자꾸 뒤쪽을 벌리지 말 것) — 나팔 벌림을 걷었다. 잎 넷이
         나란히 서서 반지름이 앞뒤 내내 같다. */
      /* 수평으로 눕는다(정정: 대각선으로 눕는 게 아니라) — 앞들림(35도)도 걷었다.
         관 축이 지면과 나란하고, 구멍은 앞뒤를 본다. 떠 있는 건 그림자가 말한다. */
      return HEX.map(([a, w]) => [
        rx * rr + tx * (w * ww), a * ll, C + rz * rr + tz * (w * ww),
      ] as [number, number, number]);
    };
    const PHIS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    for (const phi of PHIS) {
      // 판 크기 확대(요청) — 길이 2.2 → 3.1, 접선 반폭 1.05 → 1.5.
      const inPts = leaf(phi, R, 3.1, 1.5);
      const d = polyPath3(inPts);
      /* 판 두께(지적) — 바깥쪽(축 반대 방향)으로 한 겹 더 깔면 가장자리로 두께 테가
         비친다. */
      const outPts = leaf(phi, R + 0.42, 3.1, 1.5);
      const back = polyPath3(outPts);
      /* 명암·순서는 현재 시점 기준(재재지적: 겉판·속판 순서 — 시청자 쪽 잎은 겉판이
         가깝다) — 위 잎과 카메라를 마주 보는 옆 잎은 겉판을 나중에, 아래 잎과 등 돌린
         옆 잎은 속판을 나중에 그린다. */
      const fSide = facingRatio(Math.sin(phi), 0);
      const outerNear = Math.cos(phi) > 0.5 ? true
        : Math.cos(phi) < -0.5 ? false : fSide > 0;
      const faces: ShapeFace[] = [bodyFace(outerNear ? d : back)];
      if (!outerNear) faces.push(sideFace(back, 0.28)); // 두께 테 그늘 — 속판 뒤 테두리.
      /* 옆면 봉합(지적: 판 사이가 떠 보임) — 안판·바깥판의 대응 변 사이를 네모 띠로
         이어 두께의 옆구리를 채운다. 여섯 변 전부라 어느 각에서도 틈이 없다. */
      for (let i = 0; i < 6; i += 1) {
        const j = (i + 1) % 6;
        faces.push(bodyFace(polyPath3([inPts[i], inPts[j], outPts[j], outPts[i]])));
      }
      const top2 = outerNear ? back : d;
      faces.push(bodyFace(top2));
      if (Math.cos(phi) > 0.5) faces.push(topFace(top2, 0.18));
      else if (Math.cos(phi) < -0.5) faces.push(sideFace(top2, 0.24));
      else if (fSide < -0.3) faces.push(sideFace(top2, 0.26));
      else if (fSide < 0.3) faces.push(sideFace(top2, 0.12));
      /* 잎 안쪽(배) 발광 — 배가 시점을 향할 때만(지적: 바깥판 위에 밝은 점이 얹혀
         보였다). 위 잎은 늘 바깥이 보이니 빼고, 아래 잎은 배가 위라 늘 켜고, 옆
         잎은 바깥이 등을 돌린 쪽만 켠다. */
      const bellyOn = Math.cos(phi) > 0.5 ? false
        : Math.cos(phi) < -0.5 ? true : fSide < -0.1;
      if (bellyOn) faces.push(topFace(polyPath3(leaf(phi, R - 0.18, 1.35, 0.58)), 0.5));
      /* 잎마다 제 깊이(지적: 뒤에 있는 판이 안 가려짐) — 손 면이라 깊이가 없어 원래
         순서대로 그려졌다. 요잉에 따라 왼·오른 잎이 앞뒤로 갈리므로 중심 깊이를 단다. */
      out.push(...tagKey(faces, depthNow(Math.sin(phi) * R, 0)));
    }
    return out;
  },
  /* 파일런(정정 둘) — 고리를 수정 허리께로 더 올리고(지적), 수정은 매끈한 육각
     보석으로 다듬었다: 위 뾰족·어깨·허리·아래 뾰족이 좌우대칭. */
  diamond: () => {
    /* 파일런(사진 참고) — 위아래로 뾰족한 큰 파란 수정을 가운데 두고, 그 허리를
       수평 금 링이 감싼다. 링 둘레에는 세로 갈고리 여섯이 위아래로 뻗고, 링 자체엔
       청록 띠가 점점이 박힌다. 자체 그림자는 없다(공용 groundShadow가 맡는다). */
    const out: ShapeFace[] = [];
    // 수정 기둥이 기준 — 허리는 길이의 딱 절반이고 링이 거기 걸린다.
    /* 지면에 앉힌다(재재지적: 아직도 높이 떠 있음) — 아래 끝을 0으로 붙이고 기둥
       자체를 짧게 줄여 링·갈고리까지 통째로 내린다. */
    const PY_B = 0;
    /* 수정 기둥 1.25배(요청) — 9 → 11.25. 링·갈고리는 구조물에 박힌 띠라 제 높이를
       지켜야 해서, 허리(PY_M)는 예전 길이(9)의 절반에 그대로 둔다: 기둥만 위로
       길어지고 그 위가 더 뾰족해진다. */
    const PY_T = 11.25;
    const PY_M = (PY_B + 9) / 2;
    const [cx, cy] = project(0, 0, PY_M);
    const rxo = 5.5;
    const ryo = rxo * 0.45;
    const rxi = 4.4;
    const ryi = rxi * 0.45;
    const ringBack = `M${cx - rxo} ${cy} A${rxo} ${ryo} 0 0 1 ${cx + rxo} ${cy} L${cx + rxi} ${cy} A${rxi} ${ryi} 0 0 0 ${cx - rxi} ${cy} Z`;
    const ringFront = `M${cx - rxo} ${cy} A${rxo} ${ryo} 0 0 0 ${cx + rxo} ${cy} L${cx + rxi} ${cy} A${rxi} ${ryi} 0 0 1 ${cx - rxi} ${cy} Z`;
    /* 세로 갈고리 — 링 자리에서 위·아래로 뻗는 한 쌍의 뿔. 끝이 안쪽으로 모여
       수정을 감싼다. */
    /* 갈고리는 링에 안 가린다(지적) — 링은 무깊이 손 면이라 직전 깊이를 물려받아
       요잉에 따라 갈고리를 덮었다. 갈고리마다 제 자리 깊이를 달아, 앞쪽 갈고리는
       링 위로 뒤쪽 갈고리는 링 뒤로 간다. */
    const claw = (ang: number): ShapeFace[] => {
      const a = (ang * Math.PI) / 180;
      const bx = Math.sin(a) * 4.95;
      const by = Math.cos(a) * 4.95;
      return tagKey([
        ...hornFaces(bx, by, PY_M - 0.4, bx * 0.72, by * 0.72, PY_M + 3, 1.05),
        ...hornFaces(bx, by, PY_M + 0.4, bx * 0.72, by * 0.72, PY_M - 3.4, 1.05),
      ], depthNow(bx, by) + 1);
    };
    // 링에 박힌 청록 띠 — 갈고리 사이사이.
    const gems: ShapeFace[] = [];
    for (const ang of [30, 90, 150, 210, 270, 330]) {
      const a = (ang * Math.PI) / 180;
      gems.push([groundEllipse(cx + Math.cos(a) * 4.95, cy + Math.sin(a) * 2.23, 0.62, 0.3),
        0.9, "#3bd8c2"] as ShapeFace);
    }
    // 뒤 갈고리 → 뒤 링 → 수정 → 앞 링 → 앞 갈고리 순으로 겹친다.
    for (const ang of [180, 120, 240]) out.push(...claw(ang));
    out.push(...tagKey([bodyFace(ringBack), sideFace(ringBack, 0.3), ...gems.slice(3)],
      depthNow(0, -4.95)));
    /* 수정 — 네 모서리 양뿔(비피라미드)을 모델 좌표 삼각면으로 짠다: 요잉에 통째로
       돌고, 보이는 면만 그려 속면이 안 비친다. 위가 더 길고 뾰족하다(사진). */
    const zB = PY_B;
    const zM = PY_M - 0.6;
    const zT = PY_T;
    const w = 2.6;
    const eq: [number, number][] = [[w, 0], [0, w], [-w, 0], [0, -w]];
    for (let i = 0; i < 4; i += 1) {
      const [x1, y1] = eq[i];
      const [x2, y2] = eq[(i + 1) % 4];
      let nx = (x1 + x2) / 2;
      let ny = (y1 + y2) / 2;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      const up = faceLight(nx, ny, 0.55);
      // 수정은 코어 구슬과 같은 반투명 연시안.
      if (up.visible) {
        const d = polyPath3([[0, 0, zT], [x1, y1, zM], [x2, y2, zM]]);
        out.push([d, 0.6, "#a9ecf2"] as ShapeFace, ...up.face(d));
      }
      const dn = faceLight(nx, ny, -0.55);
      if (dn.visible) {
        const d = polyPath3([[0, 0, zB], [x2, y2, zM], [x1, y1, zM]]);
        out.push([d, 0.6, "#a9ecf2"] as ShapeFace, ...dn.face(d));
      }
    }
    out.push(...tagKey([bodyFace(ringFront), topFace(ringFront, 0.22), ...gems.slice(0, 3)],
      depthNow(0, 4.95)));
    for (const ang of [0, 60, 300]) out.push(...claw(ang));
    return out;
  },
  /* 로보틱스(실물 참고, 곡선의 미) — 둥근 대야와 도톰한 링 테두리, 어두운 격자 구덩이,
     테두리의 매끈한 흰 가시, 그리고 테두리에서 구덩이 위로 부드럽게 굽어 드리우는 팔. */
  dome: () => {
    const out: ShapeFace[] = [];
    /* 밑동은 높이감 있는 사다리꼴 대야(요청·사진) — 아래가 넓고 위가 좁은 원뿔대.
       옆면은 보이는 조각만 그리고, 위 테두리에 도톰한 링을 두른다. */
    {
      const N9 = 16;
      const rim9 = (r9: number, z9: number): [number, number, number][] =>
        Array.from({ length: N9 + 1 }, (_, i9) => {
          const a9 = (i9 / N9) * Math.PI * 2;
          return [Math.cos(a9) * r9, Math.sin(a9) * r9, z9] as [number, number, number];
        });
      const lo9 = rim9(5.1, 0);
      const hi9 = rim9(4.1, 2.7);
      const wall: ShapeFace[] = [];
      for (let i9 = 0; i9 < N9; i9 += 1) {
        const mid9 = ((i9 + 0.5) / N9) * Math.PI * 2;
        const nx9 = Math.cos(mid9);
        const ny9 = Math.sin(mid9);
        const fl9 = faceLight(nx9, ny9, 0.35);
        if (!fl9.visible) continue;
        const d9 = polyPath3([lo9[i9], lo9[i9 + 1], hi9[i9 + 1], hi9[i9]]);
        wall.push(bodyFace(d9), ...fl9.face(d9));
      }
      out.push(...tagKey([
        bodyFace(polyPath3(lo9)),
        ...wall,
        bodyFace(polyPath3(hi9)), topFace(polyPath3(hi9), 0.1),
      ], depthNow(0, 0) + 2.7));
    }
    // 구덩이 격자 — 대야 안쪽 우물을 가로지르는 밝은 줄.
    const bars: string[] = [];
    for (const o of [-2.1, -0.7, 0.7, 2.1]) {
      bars.push(polyPath3([[-3.2, o + 0.12, 2.75], [3.2, o + 0.12, 2.75], [3.2, o - 0.12, 2.75], [-3.2, o - 0.12, 2.75]]));
      bars.push(polyPath3([[o + 0.12, -3.2, 2.75], [o + 0.12, 3.2, 2.75], [o - 0.12, 3.2, 2.75], [o - 0.12, -3.2, 2.75]]));
    }
    out.push(topFace(bars.join(" "), 0.22));
    // 도톰한 링 테두리 — 위 테를 둥근 띠로 두른다.
    const [rcx, rcy] = project(0, 0, 2.8);
    out.push(bodyFace(`M${rcx - 4.15} ${rcy} a4.15 2.01 0 1 0 8.3 0a4.15 2.01 0 1 0 -8.3 0`
      + ` M${rcx - 3.35} ${rcy} a3.35 1.62 0 1 1 6.7 0a3.35 1.62 0 1 1 -6.7 0`));
    // 테두리 빛 눈금 — 앞쪽 띠의 밝은 조각들.
    for (const ang of [115, 80, 45, 245]) {
      const a2 = (ang * Math.PI) / 180;
      out.push([groundEllipse(rcx + Math.cos(a2) * 3.75, rcy + Math.sin(a2) * 1.82, 0.4, 0.22), 0.6, "#3bd8c2"] as ShapeFace);
    }
    // (삭제·요청) 테두리 흰 가시 — 크레인만 남긴다.
    /* 위는 집게 크레인(요청·사진: 고치 제거) — 뒤쪽에서 솟은 기둥이 앞으로 크게 굽어
       우물 위로 드리우고, 끝에 두 갈래 집게와 청록 발광이 달린다. 판 위 얹힘이라
       지붕 키로 늘 대야를 이긴다. */
    {
      /* 크레인은 가장 먼 쪽(뒤 한가운데)에서 앞으로 나온다(재지적) — 대각선으로
         비스듬히 서던 것을 y축 위에 곧게 세운다. */
      const arm: ShapeFace[] = [
        // 뒤 기둥 — 대야 뒤 테두리에서 위로.
        ...rodFaces(0, -3.5, 2.6, 0, -2.9, 8.2, 1.15),
        // 아치 — 꼭대기에서 앞으로 굽어 내려온다.
        ...rodFaces(0, -2.9, 8.2, 0, -1.1, 9.5, 1),
        ...rodFaces(0, -1.1, 9.5, 0, 1, 8.7, 0.9),
        ...rodFaces(0, 1, 8.7, 0, 2.3, 6.9, 0.8),
      ];
      /* 끝 집게 — 크게, 손가락 셋으로(요청). 손목 덩이에서 세 갈래가 벌어져 아래를
         문다: 바깥 둘과 안쪽 하나. */
      arm.push(...domeFaces3(0, 2.35, 0.62, 0.5, 6.5));
      arm.push(...hornFaces(0, 2.35, 6.7, 1.35, 3.2, 5.05, 0.72));
      arm.push(...hornFaces(0, 2.35, 6.7, -1.35, 3.2, 5.05, 0.72));
      arm.push(...hornFaces(0, 2.35, 6.7, 0, 1.45, 5.1, 0.66));
      // 청록 발광 — 꼭대기 구슬과 집게 사이 심.
      arm.push(...paintBase(domeFaces3(0, -2.9, 0.72, 0.62, 8.3), "#3bd8c2"));
      arm.push([groundEllipse(...project(0, 2.5, 6.55), 0.5, 0.5), 0.6, "#a9ecf2"] as ShapeFace);
      out.push(...tagKey(arm, 30));
    }
    return out;
  },
  /* 터렛(실물 참고) — 원통 받침 + 상자 머리 + 세로 미사일 랙 둘 + 옆으로 빠지는 배관. */
  turret: () => [
    ...cylinderFaces3(0, 0.4, 3.1, 3.4),
    /* 아래 기둥 공사장 노랑·검정 대각선 띠(재지적: 화면 고정 말고 원통에 삥 두르고,
       위쪽 말고 바닥쪽) — 원통 벽에 모델 공간 조각 24개를 감고, 위 모서리를 10도
       비틀어 사선을 만든다. 보이는 쪽 조각만 그린다. */
    ...((): ShapeFace[] => {
      const faces: ShapeFace[] = [];
      const P = (aDeg: number, z: number): [number, number, number] => {
        const a = (aDeg * Math.PI) / 180;
        return [Math.sin(a) * 3.16, 0.4 + Math.cos(a) * 3.16, z];
      };
      for (let i = 0; i < 24; i += 1) {
        const a0 = i * 15;
        const mid = ((a0 + 7.5) * Math.PI) / 180;
        if (facingRatio(Math.sin(mid), Math.cos(mid)) < 0.05) continue;
        faces.push([
          polyPath3([P(a0, 0.2), P(a0 + 15, 0.2), P(a0 + 25, 1.3), P(a0 + 10, 1.3)]),
          1, i % 2 === 0 ? "#d9ae35" : "#1b1e23",
        ] as ShapeFace);
      }
      return faces;
    })(),
    // (제거·지적: 기둥 옆 막대기 제거) — 옆으로 삐친 관이 정체불명 막대로 보였다.
    /* 머리 상자도 얹힘(지적: 넓은 밑둥 판과 순서가 요잉 따라 어긋남) — 지붕 규칙로
       밑둥(반지름 키 3.1)보다 큰 붙박이 키. 포드(40)·다리(41)보단 작게. */
    ...tagKey(paintBase(boxFaces3(0, 0, 3.6, 2.8, 3.6, 3.6), "#c9ced6"), 20 + depthNow(0, 0)), // 윗부분 은색(요청)
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
      const backQ = polyPath3([
        [rx - 0.75, bb[0], bb[1]], [rx + 0.75, bb[0], bb[1]],
        [rx + 0.75, bt[0], bt[1]], [rx - 0.75, bt[0], bt[1]],
      ]);
      const sideQ = (m2: 1 | -1): string => polyPath3([
        [rx + m2 * 0.75, fb[0], fb[1]], [rx + m2 * 0.75, ft[0], ft[1]],
        [rx + m2 * 0.75, bt[0], bt[1]], [rx + m2 * 0.75, bb[0], bb[1]],
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
      /* 포드는 머리 위 얹힘(지적) — 지붕 규칙로 큰 키. 면들은 고정으로 그리지 않고
         faceLight 판정(재지적: 옆면이 한쪽뿐이라 가려지거나 남았다) — 앞·뒤는 기운
         법선(0,±0.96,0.27), 옆은 (±1,0)로 보이는 면만 제 음영과 함께. */
      const faces: ShapeFace[] = [];
      const fr = faceLight(0, 0.96, 0.27);
      if (fr.visible) faces.push(bodyFace(front), ...fr.face(front), topFace(stripe, 0.35));
      const bk = faceLight(0, -0.96, 0.27);
      if (bk.visible) faces.push(bodyFace(backQ), ...bk.face(backQ));
      for (const m2 of [1, -1] as const) {
        const sl = faceLight(m2, 0);
        if (!sl.visible) continue;
        const d = sideQ(m2);
        faces.push(bodyFace(d), ...sl.face(d));
      }
      faces.push(bodyFace(top), topFace(top, 0.2));
      return tagKey(paintBase(faces, "#c9ced6"), 24 + depthNow(rx, 0.2)); // 포드 은색(요청)
    }),
    ...tagKey(paintBase(boxFaces3(0, -0.2, 2.2, 1.8, 1.6, 7.2), "#c9ced6"), 24 + depthNow(0, -0.2)),
  ],
  /* 포톤 캐논(실물 참고) — 납작한 원형 판(고리 무늬) + 테두리 포드 여덟 + 가운데 가는
     수정 기둥(빛나는 끝). */
  coil: () => {
    const out: ShapeFace[] = [...cylinderFaces3(0, 0, 5.6, 1.3)];
    out.push(capFace(discPath3(0, 0, 1.35, 4.4), 0.3));
    out.push(topFace(discPath3(0, 0, 1.38, 3.2), 0.2));
    out.push(capFace(discPath3(0, 0, 1.41, 2.1), 0.3));
    /* 톱니는 몸통 밖에(지적: 반쯤 파묻힌 톱니가 통째로 비쳐 어색) — 벽에 살짝만 닿게
       반지름을 밖으로 빼면, 앞 톱니는 벽 앞·뒤 톱니는 벽 뒤로 자연히 갈린다. */
    for (let i = 0; i < 8; i += 1) {
      const a = (i * 45 * Math.PI) / 180;
      out.push(...boxFaces3(Math.sin(a) * 6.15, Math.cos(a) * 6.15, 1.5, 1.5, 1.7));
    }
    /* 가운데 포탑은 받침 위 얹힘(재지적: 바닥이 포탑을 가림) — 지붕 띠 키로 받침
       (반지름 키)·이음 원반들을 늘 이긴다. */
    out.push(...tagKey([
      ...cylinderFaces3(0, 0, 0.55, 4.6, 1.3),
      /* 꼭대기 주사바늘(재지적: 가운데 포탑이 안 돎) — 화면 고정 사선 대신 모델 좌표
         뿔로: 축에서 −x 쪽으로 기운 높은 끝이라, 요잉하면 기운 방향이 함께 돈다. */
      ...hornFaces(0, 0, 5.7, -0.45, 0, 7.6, 1.05),
    ], 24 + depthNow(0, 0)));
    return out;
  },
  /* 성큰(실물 참고) — 납작한 크립 더미 + 잔가시들 + 웅크린 큰 낫 발톱(끝 밝은 날). */
  sunken: () => {
    /* 성큰 콜로니(전면 재작도·사진) — 낮게 퍼진 짙은 갈색 살덩이 위로 구릿빛 촉수
       그루터기들이 솟고, 그 사이사이에 상아빛 낫 날이 사방으로 눕는다. 등에는 검은
       가시가 돋고, 가운데 큰 촉수만 개인색이라 임자가 한눈에 읽힌다. */
    const FLESH = "#6b4732";
    const COPPER = "#a35a33";
    const out: ShapeFace[] = [...paintBase(creepSplat(6.6), "#3a3f46")];
    // 몸 — 볼록한 살덩이 둔덕.
    out.push(...tagKey(paintBase(spirePillar({
      x: 0, y: 0, z0: 0, h: 2.4, w: 4.3, tipW: 1.8,
      segs: 6, sides: 14, hold: 0, taper: 0.55,
    }), FLESH), 0));
    /* 상아빛 낫 날 여섯 — 바닥에 눕듯 사방으로 뻗는 납작한 칼. 뿌리는 몸에 묻힌다. */
    for (const [ang, len, w9] of [
      [-160, 3.6, 0.62], [-105, 4.2, 0.7], [-45, 3.9, 0.66],
      [25, 4.3, 0.72], [85, 3.7, 0.64], [145, 3.3, 0.6],
    ] as [number, number, number][]) {
      const a9 = (ang * Math.PI) / 180;
      const dx = Math.sin(a9);
      const dy = Math.cos(a9);
      out.push(...tagKey(ivory(hornFaces(
        dx * 1.6, dy * 1.6, 1.5, dx * (1.6 + len), dy * (1.6 + len), 0.35, w9,
      )), depthNow(dx * 3.4, dy * 3.4) * 1.6 + 1));
    }
    /* 구릿빛 촉수 그루터기 넷 — 몸 위에서 굽어 오르는 굵은 기둥. */
    for (const [ang, th, tw] of [
      [-140, 2.6, 0.72], [-40, 3, 0.8], [60, 2.4, 0.68], [150, 2.2, 0.62],
    ] as [number, number, number][]) {
      const a9 = (ang * Math.PI) / 180;
      const dx = Math.sin(a9) * 1.9;
      const dy = Math.cos(a9) * 1.9;
      out.push(...tagKey(paintBase(spirePillar({
        x: dx, y: dy, z0: 1.5, h: th, w: tw, tipW: tw * 0.35,
        segs: 4, sides: 8, hold: 0.15, taper: 1.3,
        leanX: -dx * 0.22, leanY: -dy * 0.22, curveX: dx * 0.2, curveY: dy * 0.2,
      }), COPPER), depthNow(dx, dy) * 1.6 + 2));
    }
    /* 가운데 큰 촉수 — 개인색(요청: 건물마다 개인색 포인트). 끝이 아가리처럼 벌어진다. */
    out.push(...tagKey([
      ...spirePillar({
        x: 0.2, y: -0.3, z0: 2.1, h: 3.2, w: 1.05, tipW: 0.45,
        segs: 5, sides: 10, hold: 0.1, taper: 1.3, leanY: 0.6, curveY: -0.4,
      }),
      capFace(discPath3(0.4, 0.3, 5.3, 0.42), 0.5),
    ], 12));
    // 등 검은 가시들 — 몸 옆선 위에 돋는다.
    for (const [ang, sz] of [
      [-170, 1.5], [-120, 1.9], [-70, 1.6], [10, 1.8], [70, 1.5], [130, 1.7],
    ] as [number, number][]) {
      const a9 = (ang * Math.PI) / 180;
      const dx = Math.sin(a9) * 2.9;
      const dy = Math.cos(a9) * 2.9;
      out.push(...tagKey(paintBase(hornFaces(
        dx, dy, 1.1, dx * 1.2, dy * 1.2, 1.1 + sz, 0.34,
      ), "#22262b"), depthNow(dx, dy) * 1.6 + 3));
    }
    return out;
  },

  /* 스포어(정정: 가시가 아니라 굴뚝이 포인트) — 크립 밑동과 몸통 덩어리 위에, 왼뒤에서
     굵게 서는 아가리 뚫린 굴뚝 관. */
  spore: () => {
    /* 스포어(요청: 뿔기둥 전격 활용 / 지적: 뚜껑 위치·키 어긋남) — 밑동·몸통·뚜껑을
       한 축에 세워 아래 단의 윗지름과 위 단의 밑지름을 그대로 맞물린다. 굴뚝만
       옆에 서므로 제 자리 깊이 키를 쓴다. */
    const out: ShapeFace[] = [];
    // 밑동 — 검회색 받침.
    out.push(...tagKey(paintBase(spirePillar({
      x: 0, y: 0, z0: 0, h: 1.5, w: 5.2, tipW: 3.2,
      segs: 3, sides: 14, hold: 0.15, taper: 1.8,
    }), "#3a3f46"), 0));
    // 몸통 — 밑동 윗지름(3.2)에서 시작해 1.15로 좁아진다.
    out.push(...tagKey(spirePillar({
      x: 0, y: 0, z0: 1.35, h: 4.2, w: 3.2, tipW: 1.15,
      segs: 6, sides: 12, hold: 0.08, taper: 1.7,
    }), 6));
    // 뚜껑 — 몸통 윗지름(1.15)을 그대로 받아 얹는다.
    out.push(...tagKey(spirePillar({
      x: 0, y: 0, z0: 5.4, h: 1.9, w: 1.15, tipW: 0.4,
      segs: 4, sides: 10, hold: 0.12, taper: 1.6,
    }), 9));
    // 굴뚝 — 왼뒤에 따로 선다. 벌어진 테와 어두운 속.
    out.push(...tagKey([
      ...spirePillar({
        x: -2.7, y: -1.5, z0: 0.9, h: 5.4, w: 1.05, tipW: 1.45,
        segs: 5, sides: 10, hold: 0.2,
      }),
      capFace(discPath3(-2.7, -1.5, 6.95, 1.05), 0.5),
    ], depthNow(-2.7, -1.5) * 1.6));
    // 앞오른쪽 작은 덩이 — 밑동 옆구리에 붙는다.
    out.push(...tagKey(spirePillar({
      x: 3.1, y: 2.4, z0: 0.7, h: 1.7, w: 1.5, tipW: 0.45,
      segs: 4, sides: 10, hold: 0.1, taper: 1.6,
    }), depthNow(3.1, 2.4) * 1.6));
    return out;
  },
  /* 크립 콜로니(실물 참고) — 처진 붉은 둔덕 + 꼭대기 주름 혹(입) + 옆 가시 + 바닥에
     번진 점액 자락. */
  creep: () => {
    /* 크립 콜로니(요청: 뿔기둥 전격 활용 / 지적: 뚜껑·가시가 어긋남) — 둔덕 옆선을
       식으로 두고, 뚜껑은 그 꼭대기 원 위에, 가시는 그 옆면 위에 앉힌다. 키는
       해처리와 같은 자(둔덕 0, 나머지는 제 자리 깊이 × 1.6). */
    const CR_H = 3.6;
    const CR_RB = 4.6;
    const CR_RT = 1.5;
    const CR_P = 2;
    const crR = (t9: number): number => CR_RT + (CR_RB - CR_RT) * (1 - t9) ** CR_P;
    const out: ShapeFace[] = [...paintBase(creepSplat(6.2), "#3a3f46")];
    out.push(...tagKey(spirePillar({
      x: 0, y: 0, z0: 0, h: CR_H, w: CR_RB, tipW: CR_RT,
      segs: 7, sides: 14, hold: 0, taper: CR_P,
    }), 0));
    // 뚜껑 — 둔덕 꼭대기 원(반지름 CR_RT) 위에 그대로 얹는 주름 혹.
    out.push(...tagKey(spirePillar({
      x: 0, y: 0, z0: CR_H - 0.15, h: 2, w: CR_RT, tipW: 0.45,
      segs: 5, sides: 12, hold: 0.12, taper: 1.7,
    }), 9));
    // 옆 가시 셋 — 뿌리를 둔덕 옆면 위에 정확히 두고 바깥·위로 뻗는다.
    for (const [ang, tz9] of [[-150, 3.3], [-90, 3.1], [-30, 3.2]] as [number, number][]) {
      const a9 = (ang * Math.PI) / 180;
      const dxr = Math.sin(a9);
      const dyr = Math.cos(a9);
      const zr9 = 1.35;
      const rr9 = crR(zr9 / CR_H) * 0.95;
      const bx9 = dxr * rr9;
      const by9 = dyr * rr9;
      out.push(...tagKey(spikeHorn(
        bx9, by9, zr9, dxr * (rr9 + 1.5), dyr * (rr9 + 1.5), tz9, 0.9, undefined, 6, 0.4, dxr, dyr,
      ), depthNow(bx9, by9) * 1.6));
    }
    return out;
  },

  /* 리파이너리(실물 참고) — 낮은 받침 + 좌우 어두운 탑 + 가운데 나팔 굴뚝 + 은빛
     팔꿈치 배관들 + 앞 은색 탱크 + 왼앞 줄무늬 경사로. */
  refinery: () => {
    // 받침 슬래브는 중심 깊이만(지적: 바닥이 안 가려짐 — 위 부품을 덮었다).
    const out: ShapeFace[] = [...tagKey(boxFaces3(0, 0, 11.6, 7, 2.2), depthNow(0, 0))];
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
    /* 왼앞 경사로(재지적: 안전 구역만 노랗고 그 위는 은색) — 경사로 몸은 은색,
       아래 끝 안전 구역만 노랑 바탕에 검정 사선. */
    const ramp = polyPath3([[-3.9, 2.2, 2.2], [-1.7, 2.2, 2.2], [-1.2, 5, 0], [-4.4, 5, 0]]);
    out.push([ramp, 1, "#c9ced6"] as ShapeFace, topFace(ramp, 0.15));
    out.push([polyPath3([[-4.28, 4.3, 0.55], [-1.33, 4.3, 0.55], [-1.2, 5, 0], [-4.4, 5, 0]]), 1, "#d9ae35"] as ShapeFace);
    for (let i = 0; i < 3; i += 1) {
      const x0 = -4.2 + i * 1;
      out.push([polyPath3([
        [x0, 4.3, 0.5], [x0 + 0.5, 4.3, 0.5], [x0 + 0.9, 4.9, 0.08], [x0 + 0.4, 4.9, 0.08],
      ]), 1, "#1b1e23"] as ShapeFace);
    }
    return out;
  },
  /* 어시밀레이터(전면 재작도·사진) — 황금 껍데기 위로 청록 눈금이 박힌 활 띠 넷이
     타넘고, 앞면 한가운데에 큰 청록 렌즈가 빛난다. 네 귀에는 청록 띠를 두른 황금
     기둥(뒤 둘은 높고 앞 둘은 낮게 기운다), 옆으로는 무늬 새긴 납작한 지느러미가
     처진다. 오른뒤 기둥에서는 초록 가스가 오른다. 위 활 띠 하나만 개인색이다. */
  assim: () => {
    const GOLD = "#c9a227";
    const GOLD_D = "#8a6f2a";
    const TEAL = "#2f8f86";
    const CYAN = "#4fd8ee";
    const out: ShapeFace[] = [];
    // 옆 지느러미 둘 — 무늬 새긴 납작한 판이 바깥으로 처진다.
    for (const m9 of [-1, 1] as const) {
      const fin = polyPath3([
        [m9 * 2.2, 1.4, 1.5], [m9 * 4.6, 0.9, 0.35], [m9 * 4.4, -1.6, 0.3], [m9 * 2.1, -1.4, 1.4],
      ]);
      out.push(...tagKey([
        [fin, 1, "#b9a883"] as ShapeFace,
        m9 > 0 ? sideFace(fin, 0.2) : topFace(fin, 0.14),
      ], depthNow(m9 * 3.4, -0.2) * 1.6));
    }
    // 껍데기 — 앞뒤로 길쭉한 낮은 황금 덩치.
    out.push(...tagKey(paintBase(domeFaces3(0, -0.2, 3.2, 2.4, 0), GOLD), 2));
    /* 몸을 타넘는 활 띠 넷 — 앞에서 뒤로 나란히 걸린다. 하나(가운데 앞)는 개인색. */
    ([[1.1, 2.9, 0], [0.2, 3.15, 1], [-0.7, 3.05, 0], [-1.6, 2.7, 0]] as [number, number, number][])
      .forEach(([by9, br9, own9]) => {
        const band = spirePillar({
          x: 0, y: 0, h: 1, w: 0.3, tipW: 0.3, segs: 12, sides: 5, hold: 1,
          path: (t9: number): [number, number, number] => {
            const th = Math.PI * t9;
            return [Math.cos(th) * br9, by9, 0.15 + Math.sin(th) * 2.05];
          },
          ...(own9 ? {} : { fill: GOLD_D }),
        });
        out.push(...tagKey(band, 6 + depthNow(0, by9) * 1.6));
        // 띠 위 청록 눈금 — 마루에 박힌 짧은 조각 셋.
        if (!own9) {
          const tick: ShapeFace[] = [];
          for (const u9 of [0.34, 0.5, 0.66]) {
            const th = Math.PI * u9;
            tick.push(...paintBase(domeFaces3(
              Math.cos(th) * br9, by9, 0.24, 0.16, 0.15 + Math.sin(th) * 2.05,
            ), TEAL));
          }
          out.push(...tagKey(tick, 7 + depthNow(0, by9) * 1.6));
        }
      });
    /* 앞면 큰 청록 렌즈 — 벽에 수직으로 붙은 볼록 원판(공용 렌즈 도형). */
    out.push(...lensFaces({
      x: 0, y: 2.15, z: 1.35, nx: 0, ny: 1, r: 1.25, bulge: 0.3, lift: 12,
      rim: GOLD_D, fill: "#1f7f97", core: CYAN, glint: "#d8f7ff",
    }));
    /* 네 귀 기둥 — 뒤 둘은 높고 곧게, 앞 둘은 낮고 바깥으로 기운다. 청록 띠와 황금 갓. */
    ([[-2.3, -1.9, 3.4, 0], [2.3, -1.9, 3.4, 0], [-2.7, 1.5, 2.2, -1], [2.7, 1.5, 2.2, 1]] as
      [number, number, number, number][]).forEach(([px, py, ph, lean]) => {
      out.push(...tagKey([
        ...paintBase(spirePillar({
          x: px, y: py, z0: 0.3, h: ph, w: 0.55, tipW: 0.42,
          segs: 3, sides: 6, hold: 0.3, leanX: lean * 0.9, leanY: lean === 0 ? 0 : 0.4,
        }), GOLD),
        ...paintBase(cylinderFaces3(px + lean * 0.45, py + (lean === 0 ? 0 : 0.2),
          0.6, 0.45, 0.3 + ph * 0.55), TEAL),
      ], 10 + depthNow(px, py) * 1.6));
    });
    /* 오른뒤 기둥에서 오르는 초록 가스(사진) — 위로 갈수록 넓고 옅어지는 세 켜. */
    for (const [gz, gr, ga] of [[4, 0.6, 0.3], [5.1, 0.9, 0.18], [6.2, 1.2, 0.1]] as
      [number, number, number][]) {
      out.push(...tagKey([[groundEllipse(
        ...project(2.3 + (gz - 4) * 0.1, -1.9 + (gz - 4) * 0.15, gz), gr, gr * 0.6,
      ), ga, "#7ee03a"] as ShapeFace], 20 + depthNow(2.3, -1.9)));
    }
    return out;
  },
  /* 익스트랙터(실물 참고) — 점액 받침 위 좌우 갈색 통(초록 발광 뚜껑 + 흘러내리는 힘줄
     우리)과 그 위 뿔 돋은 검은 덮개, 가운데 비스듬히 기댄 골진 붉은 애벌레 몸통. */
  extract: () => {
    /* 익스트랙터(요청·사진: 뿔기둥 전면 활용) — 검은 덮개를 쓴 살덩이 통 둘이 좌우에
       서고, 통마다 옆구리를 타는 힘줄 기둥과 크게 휜 상아 뿔이 돋는다. 가운데는
       앞으로 기어 나오는 붉은 애벌레 몸통. 키는 저그 건물 공통 자(제 자리 깊이 ×
       1.6)를 쓴다. */
    const out: ShapeFace[] = [sideFace(discPath3(0, 0.4, 0, 7.2), 0.2)];
    const vat = (px: number, py: number, r: number, m: 1 | -1): void => {
      const key = depthNow(px, py) * 1.6;
      const VH = 3.6;
      const vatR = (t9: number): number => r * 0.86 + r * 0.24 * (1 - t9) ** 1.6;
      // 통 — 아래가 굵고 위로 갈수록 살짝 좁아지는 살덩이 기둥.
      out.push(...tagKey(spirePillar({
        x: px, y: py, z0: 0, h: VH, w: r * 1.1, tipW: r * 0.86,
        segs: 5, sides: 12, hold: 0, taper: 1.6, fill: "#8a5f43",
      }), key));
      // 힘줄 우리 — 통 옆면을 그대로 타고 내리는 가는 기둥 다섯.
      for (const ang of [150, 210, 30, -30, 90]) {
        const a2 = (ang * Math.PI) / 180;
        const dxr = Math.sin(a2);
        const dyr = Math.cos(a2);
        out.push(...tagKey(spirePillar({
          x: 0, y: 0, h: 1, w: 0.62, tipW: 0.3, segs: 6, sides: 6, hold: 0.1, taper: 1.4,
          path: (t9: number): [number, number, number] => {
            const r9 = vatR(t9) * 1.02;
            return [px + dxr * r9, py + dyr * r9, VH * t9];
          },
          fill: "#6b4732",
        }), depthNow(px + dxr * r, py + dyr * r) * 1.6));
      }
      // 검은 덮개 — 통 윗지름을 그대로 받아 위로 좁아진다.
      out.push(...tagKey(paintBase(spirePillar({
        x: px, y: py, z0: VH - 0.15, h: 1.5, w: r * 0.86, tipW: r * 0.4,
        segs: 4, sides: 12, hold: 0.05, taper: 1.7,
      }), "#3a3f46"), key + 9));
      // 덮개에서 솟는 상아 뿔 셋 — 바깥·뒤로 크게 휘며 끝이 뾰족하다.
      out.push(...tagKey(spikeHorn(px - m * 0.7, py - 0.4, 4.6, px - m * 2.4, py - 1.6, 9.4, 1.35,
        IVORY, 6, 1.2, -m, -0.5), key + 10));
      out.push(...tagKey(spikeHorn(px + m * 0.9, py - 0.2, 4.5, px + m * 2.5, py - 1.2, 8.2, 1.15,
        IVORY, 6, 1, m, -0.4), key + 10));
      out.push(...tagKey(spikeHorn(px, py + 0.7, 4.3, px + m * 0.5, py + 2, 7, 0.95,
        IVORY, 6, 0.8, 0, 1), key + 11));
    };
    vat(-3.9, -0.6, 2.4, -1);
    vat(4, -0.4, 2.2, 1);
    /* 가운데 붉은 애벌레 — 뒤 바닥에서 나와 앞으로 기어 오르는 굵은 기둥 하나.
       마디는 그 위를 감싸는 얇은 테로 낸다. */
    const GRB = (t9: number): [number, number, number] => [
      0.2 - t9 * 0.3,
      -2.2 + t9 * 5.4,
      0.5 + Math.sin(Math.PI * t9 * 0.85) * 3.2,
    ];
    /* 가운데 구조물은 개인색(요청) — fill을 주지 않으면 그리는 쪽이 팀색을 넣는다.
       마디 테는 같은 팀색 위에 어두운 그늘을 덧대 골로 읽힌다. */
    out.push(...tagKey(spirePillar({
      x: 0, y: 0, h: 1, w: 1.5, tipW: 1.05, segs: 10, sides: 10, hold: 0.1, taper: 1.2,
      path: GRB,
    }), depthNow(0, 0.4) * 1.6 + 4));
    for (const t9 of [0.28, 0.46, 0.64, 0.82]) {
      const [gx9, gy9, gz9] = GRB(t9);
      const rib9 = spirePillar({
        x: gx9, y: gy9, z0: gz9 - 0.16, h: 0.32, w: 1.45, tipW: 1.45,
        segs: 1, sides: 10, hold: 1,
      });
      out.push(...tagKey([...rib9, ...rib9.map(([d9]) => sideFace(d9, 0.2))],
        depthNow(gx9, gy9) * 1.6 + 5));
    }
    // 애벌레 끝 상아 뿔.
    out.push(...tagKey(spikeHorn(0, -1.7, 4.2, -0.5, -2.9, 7.2, 1.3, IVORY, 6, 0.7, 0, -1),
      depthNow(0, -2.3) * 1.6 + 5));
    // 땅에서 솟는 앞 가시 둘 — 다른 뿔과 같은 상아색(요청).
    out.push(...tagKey(spikeHorn(-1.7, 3.4, 0.4, -2.6, 4.8, 2.4, 0.8, IVORY, 6, 0.4, -0.6, 0.8),
      depthNow(-2.1, 4.1) * 1.6));
    out.push(...tagKey(spikeHorn(1.9, 3.2, 0.4, 2.8, 4.4, 2.2, 0.8, IVORY, 6, 0.4, 0.6, 0.8),
      depthNow(2.3, 3.8) * 1.6));
    return out;
  },

  /* ── 업그레이드·테크 건물들(요청: 이제 다 만들자) ─────────────────────────── */
  /* 아카데미(전면 재작도·사진) — 어두운 강철 더미다: 왼쪽에 붉은 띠를 두른 리벳
     드럼 돔, 뒤에 붉은 갓을 쓴 굴뚝 탑 둘과 잿빛 원통 하나, 오른쪽에 속이 붉은 큰
     고리 대야, 그 앞에 기운 작업 단, 발치를 두르는 돌빛 슬래브들. */
  academy: () => {
    const STEEL = "#6b7078";
    const DARK = "#3f444b";
    const RED = "#a8322a";
    const out: ShapeFace[] = [];
    /* 발치 슬래브 — 사방으로 흩어진 돌빛 판들. 낮게 깔려 받침 노릇을 한다. */
    for (const [bx, by, bw, bh, br] of [
      [-3.2, 2.6, 2.2, 1.2, 0.7], [-1, 3.2, 1.6, 1, 0.55], [1.4, 3, 1.8, 1.1, 0.6],
      [3.4, 1.8, 1.4, 1.6, 0.5], [-4, 0.4, 1.3, 1.8, 0.6], [3.8, -1.6, 1.2, 1.4, 0.45],
    ] as [number, number, number, number, number][]) {
      out.push(...tagKey(paintBase(boxFaces3(bx, by, bw, bh, br, 0), STEEL),
        depthNow(bx, by) * 1.6));
    }
    // 본체 받침 — 낮고 넓은 어두운 단.
    out.push(...tagKey(paintBase(boxFaces3(0, 0.2, 8.4, 5.4, 1.2, 0), DARK), 4));
    /* 왼쪽 리벳 드럼 돔(사진) — 통 몸에 붉은 띠를 두르고 위는 돔 뚜껑. */
    out.push(...tagKey([
      ...paintBase(cylinderFaces3(-2.6, 0.6, 2.15, 2.2, 1.2), STEEL),
      ...paintBase(cylinderFaces3(-2.6, 0.6, 2.24, 0.5, 2.5), RED),
      ...paintBase(domeFaces3(-2.6, 0.6, 2.15, 1.5, 3.4), "#7b8088"),
      capFace(discPath3(-2.6, 0.6, 4.95, 0.8), 0.3),
    ], 20 + depthNow(-2.6, 0.6)));
    /* 뒤 굴뚝 탑 둘 — 붉은 갓을 쓴 가는 기둥. 하나는 더 높다. */
    for (const [cx9, cy9, ch9, cr9] of [
      [-1.2, -2.1, 5.4, 0.55], [1.5, -2.4, 4.2, 0.62],
    ] as [number, number, number, number][]) {
      out.push(...tagKey([
        ...paintBase(cylinderFaces3(cx9, cy9, cr9, ch9, 1.2), DARK),
        ...paintBase(cylinderFaces3(cx9, cy9, cr9 * 1.35, 0.7, 1.2 + ch9 - 0.7), RED),
        capFace(discPath3(cx9, cy9, 1.2 + ch9, cr9 * 0.9), 0.45),
      ], 24 + depthNow(cx9, cy9)));
    }
    // 가운데 잿빛 원통 — 돔 뚜껑을 쓴 짧은 통.
    out.push(...tagKey([
      ...paintBase(cylinderFaces3(0.2, -0.9, 0.95, 2.6, 1.2), "#8b8f96"),
      ...paintBase(domeFaces3(0.2, -0.9, 0.95, 0.8, 3.8), "#9ba3ad"),
    ], 22 + depthNow(0.2, -0.9)));
    /* 오른쪽 큰 고리 대야(사진) — 잿빛 테 안이 붉게 파인 원형 우물. 테는 굵다. */
    out.push(...tagKey([
      ...paintBase(cylinderFaces3(3, -0.8, 2.5, 1.5, 1.2), STEEL),
      [discPath3(3, -0.8, 2.72, 2.5), 1, STEEL] as ShapeFace,
      [discPath3(3, -0.8, 2.62, 1.75), 1, RED] as ShapeFace,
      capFace(discPath3(3, -0.8, 2.55, 1.35), 0.4),
    ], 20 + depthNow(3, -0.8)));
    /* 앞 기운 작업 단(사진) — 다리 넷 위에 비스듬히 얹힌 판과 잔 부속들. */
    {
      const tab: ShapeFace[] = [];
      for (const [lx, ly] of [[0.6, 1], [2.6, 1], [0.9, 2.4], [2.9, 2.4]] as [number, number][]) {
        tab.push(...paintBase(cylinderFaces3(lx, ly, 0.16, 1.3, 1.2), DARK));
      }
      const lo: [number, number, number][] = [
        [0.3, 0.7, 2.9], [3.2, 0.7, 2.5], [3.4, 2.7, 2.2], [0.5, 2.7, 2.6],
      ];
      const hi = lo.map(([x9, y9, z9]) => [x9, y9, z9 + 0.22] as [number, number, number]);
      tab.push(bodyFace(polyPath3(lo)));
      for (let k = 0; k < 4; k += 1) {
        const q = (k + 1) % 4;
        tab.push(bodyFace(polyPath3([lo[k], lo[q], hi[q], hi[k]])));
      }
      tab.push(bodyFace(polyPath3(hi)), topFace(polyPath3(hi), 0.18));
      out.push(...tagKey(paintBase(tab, "#8a6a44"), 26 + depthNow(1.9, 1.7)));
      // 단 위 잔 부속 — 작은 원반과 상자.
      out.push(...tagKey([
        ...paintBase(cylinderFaces3(1.2, 1.3, 0.42, 0.24, 3), "#9ba3ad"),
        ...paintBase(boxFaces3(2.5, 1.9, 0.6, 0.5, 0.4, 2.6), DARK),
      ], 28 + depthNow(1.9, 1.6)));
    }
    return out;
  },
  /* 엔지니어링 베이(복원) — 사방 대각 팔 끝의 원반 발 넷, 각진 몸체 더미, 끝이
     빛나는 앞 통, 지붕 안테나. */
  ebay: () => {
    const foot = (fx: number, fy: number): ShapeFace[] => paintBase([
      ...hornFaces(fx * 0.45, fy * 0.45, 1.0, fx * 0.85, fy * 0.85, 0.7, 0.9), // 몸통 부착점 더 아래(지적)
      bodyFace(discPath3(fx, fy, 0.35, 1.5)),
      topFace(discPath3(fx, fy, 0.38, 1), 0.25),
      ...cylinderFaces3(fx, fy, 0.32, 1, 0.35),
    ], "#c9ced6"); // 발 은색(요청: 이륙 가능 건물)
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
    // 발 은색(요청: 이륙 가능 건물).
    // 발은 몸 안쪽으로(요청: 윗부분이 안 보이게) — 자리는 아래 호출부에서 당긴다.
    /* 발은 늘 몸 뒤(재지적: 본건물 옆면이 발에 가려짐) — 안쪽으로 당긴 발이 앞에
       그려지면 드럼·슬래브 옆면을 덮는다. 맨 뒤 키로 못 박아 몸 밖으로 나온 발판만
       보이게 한다. */
    const foot = (fx: number, fy: number): ShapeFace[] => tagKey(paintBase([
      ...cylinderFaces3(fx, fy, 1.05, 1.3),
      bodyFace(discPath3(fx, fy, 0.25, 1.4)),
      capFace(discPath3(fx, fy, 1.32, 0.55), 0.3),
    ], "#c9ced6"), -100);
    const glow = (gx2: number, gy2: number, gz2: number): ShapeFace => {
      const [px2, py2] = project(gx2, gy2, gz2);
      return topFace(groundEllipse(px2, py2, 0.45, 0.2), 0.45);
    };
    /* 몸집 1.2배(지적: 스타포트와 크기가 너무 다름 — 같은 4×3 발자국인데 모델이
       상자를 덜 채웠다) — 드럼·슬래브·발까지 비례로 키워 스타포트 링과 급을 맞춘다. */
    return [
      /* 발을 안쪽으로(재지적: 윗부분은 안 보이게) — 드럼(반지름 5.5) 안으로 당겨
         발 머리가 몸에 묻히고 발판만 삐져나온다. */
      ...foot(-4.3, -2.4), ...foot(4.5, -2.3),
      /* 밑 큰 몸통(재지적: 반원처럼 보이고 안 돎) — 드럼은 온전한 원기둥으로 두고,
         둘레에 세로 이음판 여덟을 벽 밖으로 살짝 내밀어 도는 게 보이게 한다. */
      ...cylinderFaces3(0, 0, 5.5, 2.3, 1.3),
      ...Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2 + 0.35;
        return boxFaces3(Math.sin(a) * 5.64, Math.cos(a) * 5.64, 0.62, 0.62, 1.9, 1.35);
      }).flat(),
      /* 각진 본체(재지적: 본체가 안 돎) — 원기둥·돔은 회전 대칭이라 돌아도 티가
         안 났다. 실물처럼 각진 슬래브 + 윗상자로 바꿔 요잉이 보인다. 적층끼리 순서가
         요잉에 꼬여(재재지적) 단마다 띠 키(20/22/24) + 제 깊이로 계단을 놓는다. */
      // 2~3층 두께 축소(지적) — 2.5/2.3 → 1.9/1.7, 위 요소들이 따라 내려온다.
      ...tagKey(boxFaces3(0, 0, 7.7, 5.5, 1.9, 3.6), 20 + depthNow(0, 0)),
      ...tagKey(boxFaces3(0, -0.6, 4.6, 3.5, 1.7, 5.5), 22 + depthNow(0, -0.6)),
      ...tagKey(domeFaces3(0, -0.6, 1.8, 1.45, 7.2), 24 + depthNow(0, -0.6)),
      ...tagKey(cylinderFaces3(2.5, 1.9, 1.2, 2.4, 3.6), 20 + depthNow(2.5, 1.9)),
      glow(-3.5, 3.1, 2.6), glow(-1.9, 4, 2.6), glow(4, 2.3, 3),
      ...foot(-1.6, 4.5), ...foot(3.5, 3.7),
    ];
  },
  /* 포지(렌더 참고 복원) — 왼앞 아치 별채, 가운데 총알 기둥 무리, 초록 배관 다발이
     오른쪽 큰 렌즈 돔으로 흘러들고, 앞오른쪽에 작은 렌즈 돔. */
  forge: () => {
    /* 포지(전면 재작도·사진) — 황금 덩치다: 오른뒤에 청록 눈이 박힌 큰 황금 돔,
       앞오른쪽에 같은 눈을 인 작은 돔, 왼쪽에 뾰족한 황금 뿔탑 셋, 그 사이를 잇는
       관 팔 넷, 앞왼쪽에 골이 진 황금 단, 붉은 띠와 은빛 발이 곳곳에 박힌다. */
    const GOLD = "#d4af37";
    const GOLD_D = "#a8862a";
    const RED = "#a8322a";
    const CYAN = "#5fe0ea";
    const out: ShapeFace[] = [];
    // 은빛 발 넷 — 바닥에 낮게 깔린 판.
    for (const [fx, fy] of [[-3.4, 2.6], [3.4, 2.4], [-3.6, -1.6], [3.6, -2]] as [number, number][]) {
      out.push(...tagKey(paintBase(boxFaces3(fx, fy, 1.5, 1.1, 0.35, 0), "#c9ced6"),
        depthNow(fx, fy) * 1.6));
    }
    /* 큰 황금 돔(오른뒤) — 위에 청록 눈. 옆구리에 붉은 띠. */
    out.push(...tagKey([
      ...paintBase(cylinderFaces3(2.2, -0.6, 3, 1.4, 0.3), GOLD_D),
      ...paintBase(domeFaces3(2.2, -0.6, 3, 3.4, 1.7), GOLD),
      ...paintBase(cylinderFaces3(2.2, -0.6, 3.04, 0.4, 1.9), RED),
    ], 20 + depthNow(2.2, -0.6)));
    // 큰 돔 꼭대기 청록 눈 — 테 두른 발광 원반.
    out.push(...tagKey([
      [discPath3(2.2, -0.6, 5.05, 1.15), 1, GOLD_D] as ShapeFace,
      [discPath3(2.2, -0.6, 5.12, 0.86), 0.95, CYAN] as ShapeFace,
      topFace(discPath3(2.2, -0.6, 5.18, 0.45), 0.5),
    ], 24 + depthNow(2.2, -0.6)));
    /* 앞오른쪽 작은 돔 — 같은 눈을 인다. */
    out.push(...tagKey([
      ...paintBase(domeFaces3(2.6, 2.4, 1.6, 1.7, 0.35), GOLD),
      [discPath3(2.6, 2.4, 2.08, 0.7), 1, GOLD_D] as ShapeFace,
      [discPath3(2.6, 2.4, 2.14, 0.52), 0.95, CYAN] as ShapeFace,
      topFace(discPath3(2.6, 2.4, 2.2, 0.28), 0.5),
    ], 22 + depthNow(2.6, 2.4)));
    /* 왼쪽 황금 뿔탑 셋(사진) — 밑동이 굵고 끝이 뾰족한 첨탑. 세로 골이 있다. */
    for (const [tx, ty, th, tw] of [
      [-3, -1.2, 5.4, 0.95], [-1.9, -1.9, 6.4, 1.05], [-0.8, -1.2, 4.6, 0.85],
    ] as [number, number, number, number][]) {
      out.push(...tagKey(paintBase(spirePillar({
        x: tx, y: ty, z0: 0.3, h: th, w: tw, tipW: 0.1,
        segs: 5, sides: 8, hold: 0.18, taper: 1.4,
      }), GOLD), 22 + depthNow(tx, ty)));
    }
    /* 뿔탑에서 큰 돔으로 건너가는 관 팔 넷 — 마디진 황금 관. */
    for (let k = 0; k < 4; k += 1) {
      const sy9 = -1.9 + k * 0.5;
      const ax = -2.2 + k * 0.35;
      out.push(...tagKey([
        ...paintBase(tubeFaces(ax, sy9, 1.4, sy9 + 0.9, 0.26, 3.2 - k * 0.35), GOLD_D),
        ...paintBase(tubeFaces(ax + 0.9, sy9 + 0.3, ax + 1.1, sy9 + 0.36, 0.34, 3.2 - k * 0.35), GOLD),
      ], 26 + depthNow(0, sy9 + 0.5)));
    }
    /* 앞왼쪽 골진 황금 단(사진) — 층층이 골이 팬 낮은 상자. */
    {
      const blk: ShapeFace[] = [...paintBase(boxFaces3(-2.4, 2.3, 3.6, 2.6, 1.7, 0.3), GOLD)];
      for (let k = 0; k < 5; k += 1) {
        const gx = -3.9 + k * 0.75;
        blk.push(...paintBase(boxFaces3(gx, 2.3, 0.3, 2.7, 0.34, 2), GOLD_D));
      }
      blk.push(...paintBase(domeFaces3(-0.6, 3.1, 0.55, 0.5, 0.3), GOLD_D));
      out.push(...tagKey(blk, 20 + depthNow(-2.4, 2.3)));
    }
    return out;
  },
  /* 사이버네틱스 코어(실물 참고) — 가운데 드럼 위 파란 발광 고리, 그 뒤로 솟는 발톱
     손가락 셋, 둘레 네 포드마다 파란 구슬이 얹힌다. */
  cyber: () => {
    const orbPod = (px2: number, py2: number): ShapeFace[] => {
      const [gx2, gy2] = project(px2, py2, 1.45);
      return [
        ...domeFaces3(px2, py2, 1.15, 0.9),
        // 연한 시안 반투명 구슬(요청).
        [groundEllipse(gx2, gy2, 0.85, 0.8), 0.55, "#a9ecf2"] as ShapeFace,
        topFace(groundEllipse(gx2 - 0.25, gy2 - 0.25, 0.32, 0.28), 0.5),
        ...hornFaces(px2 - 0.55, py2 + 0.75, 0.4, px2 - 0.75, py2 + 1.15, 1.5, 0.32),
        ...hornFaces(px2 + 0.55, py2 + 0.75, 0.4, px2 + 0.75, py2 + 1.15, 1.5, 0.32),
      ];
    };
    const [cx2, cy2] = project(0, -0.2, 3.6);
    return [
      /* 뒤 발톱 손가락 셋 — 세로로 선 뿔은 뿌리·끝의 평면 깊이 차가 작아 자동 키가
         너무 얕고, 드럼(반지름 키)이 요잉 따라 덮었다(지적: 기둥 가려짐). 제 자리
         깊이 + 키 높이만큼으로 명시한다. */
      ...tagKey(hornFaces(-0.9, -1.5, 3.8, -1.3, -2.1, 8, 1), depthNow(-1.1, -1.8) + 1.2),
      ...tagKey(hornFaces(0, -1.8, 3.8, 0, -2.5, 8.6, 1.1), depthNow(0, -2.1) + 1.2),
      ...tagKey(hornFaces(0.9, -1.5, 3.8, 1.3, -2.1, 8, 1), depthNow(1.1, -1.8) + 1.2),
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
    /* 껍데기 꼬리 45도 반시계(지적: 요잉 후 왼쪽 반구들이 어긋남) — 부품 좌표를
       본체 중심 기준으로 돌린다. */
    const RC = Math.cos(Math.PI / 4);
    const RS = Math.sin(Math.PI / 4);
    const R = (x: number, y: number): [number, number] => [x * RC - y * RS, x * RS + y * RC];
    const [gx2, gy2] = project(0.1, 0.4, 2.9);
    const [d1x, d1y] = R(2.4, 1.2);
    const [d2x, d2y] = R(3.2, 2.2);
    const [ttx, tty] = R(3.8, 3);
    const [tx3, ty3] = project(ttx, tty, 1);
    const seam = (px2: number, py2: number, pz2: number): [number, number, number] => {
      const [rx2, ry2] = R(px2, py2);
      return [rx2, ry2, pz2];
    };
    return [
      // 왼뒤 뿔 한 쌍.
      ...hornFaces(-1.6, -1.4, 2.6, -3.2, -2.4, 6.6, 1.1),
      ...hornFaces(-0.2, -2, 2.8, -0.8, -3.2, 7, 1.2),
      // 큰 황금 몸 + 받침 — 더 납작하게(지적), 위는 분화구처럼 깎는다.
      ...cylinderFaces3(0, 0, 2.9, 0.7),
      ...domeFaces3(0, 0, 2.9, 1.6, 0.7),
      // 분화구 — 꼭대기를 깎은 어두운 접시 + 안쪽 더 깊은 그늘.
      [groundEllipse(...project(0, 0, 2.15), 1.75, 1.05), 0.3, "#000"] as ShapeFace,
      [groundEllipse(...project(0, 0, 2.05), 1.15, 0.7), 0.42, "#000"] as ShapeFace,
      /* 세로줄(요청·재확인: 옆면을 한 바퀴 빙 두르게) — 전 방위로 두르고 보이는 쪽만
         남긴다(faceLight). 납작해진 돔을 따라 끝 높이도 낮췄다. */
      ...[-160, -128, -96, -64, -32, 0, 32, 64, 96, 128, 160].flatMap((ang): ShapeFace[] => {
        const a2 = (ang * Math.PI) / 180;
        const sx3 = Math.sin(a2);
        const sy3 = Math.cos(a2);
        if (!faceLight(sx3, sy3).visible) return [];
        const txn = Math.cos(a2) * 0.14;
        const tyn = -Math.sin(a2) * 0.14;
        return [capFace(polyPath3([
          [sx3 * 2.6 - txn, sy3 * 2.6 - tyn, 1],
          [sx3 * 2.6 + txn, sy3 * 2.6 + tyn, 1],
          [sx3 * 2.15 + txn, sy3 * 2.15 + tyn, 2.1],
          [sx3 * 2.15 - txn, sy3 * 2.15 - tyn, 2.1],
        ]), 0.26)];
      }),
      // 위 렌즈 구슬 — 옥색(요청).
      bodyFace(groundEllipse(gx2, gy2, 1.15, 0.85)),
      [groundEllipse(gx2, gy2, 0.85, 0.62), 0.6, "#3bd8c2"] as ShapeFace,
      topFace(groundEllipse(gx2 - 0.3, gy2 - 0.25, 0.34, 0.25), 0.5),
      // 골진 껍데기 꼬리(45도 반시계 이동) — 굽은 마디 둘 + 골 줄 + 끝 파란 원반.
      ...domeFaces3(d1x, d1y, 1.3, 1),
      ...domeFaces3(d2x, d2y, 1, 0.8),
      sideFace(polyPath3([seam(1.8, 0.6, 1), seam(2.2, 1, 1.9), seam(2.6, 1.5, 1), seam(2.5, 1.4, 0.6)]), 0.18),
      sideFace(polyPath3([seam(2.7, 1.6, 0.9), seam(3, 2, 1.6), seam(3.4, 2.5, 0.9), seam(3.3, 2.4, 0.5)]), 0.18),
      // 꼬리 끝 동그란 구도 옥색(요청).
      [groundEllipse(tx3, ty3, 0.5, 0.4), 0.55, "#3bd8c2"] as ShapeFace,
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
    /* 오목 대접 + 심 발광 — 받침 키에 명시로 묶는다(지적: 기둥 가려짐 — 마지막 톱니
       키를 물려받아 요잉 따라 아주 늦게 그려지며 뒤 판들을 덮었다). */
    const [gx2, gy2] = project(0, 0, 1.25);
    out.push(...tagKey([
      capFace(discPath3(0, 0, 1.15, 3), 0.3),
      capFace(discPath3(0, 0, 1.18, 2.1), 0.45),
      topFace(groundEllipse(gx2, gy2, 0.7, 0.4), 0.5),
    ], depthNow(0, 0) + 1.1));
    /* 뒤 기둥들(재지적: 뾰족뿔이 아니라 끝이 둥근 넙적판) — 바깥으로 기운 넓은 판,
       꼭대기는 둥근 캡. */
    const plate = (
      bx2: number, by2: number, z0: number, tx2: number, ty2: number, zt: number, w: number,
    ): ShapeFace[] => {
      const [ax, ay] = project(bx2, by2, z0);
      const [cx3, cy3] = project(tx2, ty2, zt);
      const dx = cx3 - ax;
      const dy = cy3 - ay;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * (w / 2);
      const ny = (dx / len) * (w / 2);
      const ex = (dx / len) * (w * 0.62);
      const ey = (dy / len) * (w * 0.62);
      const d = `M${ax + nx} ${ay + ny} L${cx3 + nx} ${cy3 + ny}`
        + ` Q${cx3 + ex} ${cy3 + ey} ${cx3 - nx} ${cy3 - ny} L${ax - nx} ${ay - ny} Z`;
      const edge = `M${cx3 + nx * 0.3} ${cy3 + ny * 0.3} Q${cx3 + ex} ${cy3 + ey} ${cx3 - nx} ${cy3 - ny}`
        + ` L${ax - nx} ${ay - ny} L${ax - nx * 0.5} ${ay - ny * 0.5} Z`;
      // 깊이 키는 판 전체의 가장 앞점(뿌리·끝 중 앞) — 프리미티브와 같은 규칙.
      return tagKey(
        [bodyFace(d), sideFace(edge, 0.18)],
        Math.max(depthNow(bx2, by2), depthNow(tx2, ty2)),
      );
    };
    out.push(...plate(-1.4, -1.2, 1, -2.5, -2, 6.6, 2.1));
    out.push(...plate(0.4, -1.7, 1, 0.7, -3, 7.2, 2.2));
    out.push(...plate(1.7, -0.6, 1, 2.8, -1.1, 5.8, 2));
    // 굽은 관 팔 — 받침 밖에서 포드 쪽으로 넘어온다.
    out.push(...hornFaces(-3.6, 0.9, 0.8, -4, 0.2, 3.6, 0.7));
    out.push(...hornFaces(-4, 0.2, 3.5, -2.9, -0.9, 4.6, 0.55));
    out.push(...hornFaces(3.6, 1.3, 0.8, 4, 0.6, 3.2, 0.7));
    out.push(...hornFaces(4, 0.6, 3.1, 3, -0.3, 4.2, 0.55));
    return out;
  },
  /* 옵저버토리(전면 재작도·사진) — 바닥에 누운 황금 초승달 받침이 앞을 감싸고, 그
     위에 청록 띠를 두른 황금 기둥 셋이 솟아 청록 랜턴을 인다(가운데가 가장 높다).
     받침은 마디진 관이라 굽은 몸이 그대로 읽힌다. 랜턴 하나는 개인색이다. */
  observatory: () => {
    const GOLD = "#c9a227";
    const GOLD_D = "#8a6f2a";
    const TEAL = "#2f8f86";
    const CYAN = "#4fd8ee";
    const out: ShapeFace[] = [];
    /* 초승달 받침 — 앞을 감싸는 굵은 관. 마디 테를 군데군데 물린다. */
    const R9 = 3.6;
    out.push(...tagKey(paintBase(spirePillar({
      x: 0, y: 0, h: 1, w: 0.85, tipW: 0.85, segs: 14, sides: 7, hold: 1,
      path: (t9: number): [number, number, number] => {
        const a9 = Math.PI * (-0.12 + 1.24 * t9);
        return [Math.cos(a9) * R9, -0.6 + Math.sin(a9) * R9 * 0.62, 0.8];
      },
    }), GOLD), 0));
    for (const u9 of [0.16, 0.38, 0.62, 0.84]) {
      const a9 = Math.PI * (-0.12 + 1.24 * u9);
      const bx = Math.cos(a9) * R9;
      const by = -0.6 + Math.sin(a9) * R9 * 0.62;
      out.push(...tagKey(paintBase(cylinderFaces3(bx, by, 1, 0.34, 0.45), TEAL),
        1 + depthNow(bx, by) * 1.6));
    }
    /* 기둥 셋 — 청록 띠를 두른 황금 대. 가운데가 가장 높다. */
    ([[-2.5, 0.4, 3.2, 0], [0, -1.6, 4.4, 1], [2.5, 0.4, 3.2, 0]] as
      [number, number, number, number][]).forEach(([px, py, ph, own9]) => {
      const key = 12 + depthNow(px, py) * 1.6;
      out.push(...tagKey([
        ...paintBase(spirePillar({
          x: px, y: py, z0: 0.8, h: ph, w: 0.62, tipW: 0.48,
          segs: 3, sides: 7, hold: 0.35,
        }), GOLD),
        ...paintBase(cylinderFaces3(px, py, 0.68, 0.4, 0.8 + ph * 0.4), TEAL),
        ...paintBase(cylinderFaces3(px, py, 0.68, 0.34, 0.8 + ph * 0.72), GOLD_D),
      ], key));
      // 랜턴 머리 — 청록 발광 알. 가운데 것만 개인색(요청: 건물마다 개인색 포인트).
      out.push(...tagKey(own9
        ? domeFaces3(px, py, 0.72, 0.8, 0.8 + ph)
        : paintBase(domeFaces3(px, py, 0.72, 0.8, 0.8 + ph), CYAN),
      key + 1));
      out.push(...tagKey([[groundEllipse(...project(px, py, 1.68 + ph), 0.42, 0.42), 0.55,
        "#d8f7ff"] as ShapeFace], key + 2));
    });
    return out;
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
      // 큰 파란 구슬 — 몸 위 얹힘이라 지붕 키(지적: 구슬 가려짐 오류).
      ...tagKey([
        // 수정구를 감싸던 겉 구는 제거(요청) — 연한 시안 반투명 구슬만.
        [groundEllipse(gx2, gy2, 1.55, 1.45), 0.55, "#a9ecf2"] as ShapeFace,
        topFace(groundEllipse(gx2 - 0.5, gy2 - 0.5, 0.6, 0.5), 0.5),
      ], 30),
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
    // 기둥은 수직 직육면체(지적: 안으로 기운 뿔이 아니라) — 돔 둘레에 곧게 선다.
    const post = (ang: number): ShapeFace[] => {
      const a = (ang * Math.PI) / 180;
      // 돔 위 얹힘이라 돔 키(반지름 몫)를 이기게 보정(지적: 기둥 가려짐 오류).
      return tagKey(
        boxFaces3(Math.sin(a) * 1.8, Math.cos(a) * 1.8, 0.7, 0.7, 2.1, 2.5),
        depthNow(Math.sin(a) * 1.8, Math.cos(a) * 1.8) + 2.6,
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
  /* 에볼루션 챔버(재모델링·사진) — 결절이 박힌 큰 살덩이 엽 둘(개인색)이 앞을
     차지하고, 뒤에는 뒤틀린 검은 등걸이 가지를 뻗는다. 오른쪽에는 창백한 뼈판이
     기대고, 발치에는 검은 촉수 다발이 엉킨다. 키는 저그 공통 자(제 자리 깊이 × 1.6). */
  evo: () => {
    const out: ShapeFace[] = [...tagKey(creepSplat(6.2), -20)];
    /* 살덩이 엽 둘 — 볼록한 종 모양 기둥. 개인색이라 fill을 주지 않는다. */
    const lobe = (lx9: number, ly9: number, r9: number, h9: number): void => {
      out.push(...tagKey(spirePillar({
        x: lx9, y: ly9, z0: 0, h: h9, w: r9, tipW: r9 * 0.42,
        segs: 7, sides: 12, hold: 0, taper: 0.55,
      }), depthNow(lx9, ly9) * 1.6));
      /* 결절 — 엽 표면에 박힌 잿빛 눈알 여섯. 옆선 위에 정확히 앉힌다. */
      const lobeR = (t9: number): number => r9 * 0.42 + r9 * 0.58 * (1 - t9) ** 0.55;
      for (const [ang, t9, nr9] of [
        [-140, 0.28, 0.42], [-70, 0.5, 0.36], [-10, 0.3, 0.4],
        [55, 0.55, 0.32], [120, 0.34, 0.38], [175, 0.6, 0.3],
      ] as [number, number, number][]) {
        const a9 = (ang * Math.PI) / 180;
        const dxr = Math.sin(a9);
        const dyr = Math.cos(a9);
        const rr9 = lobeR(t9) * 0.94;
        const nx9 = lx9 + dxr * rr9;
        const ny9 = ly9 + dyr * rr9;
        out.push(...tagKey(paintBase(
          domeFaces3(nx9, ny9, nr9 * r9 * 0.5, nr9 * r9 * 0.32, h9 * t9), "#6e7d86",
        ), depthNow(nx9, ny9) * 1.6 + 0.4));
      }
    };
    lobe(-2.4, 1.2, 3.1, 3.9);
    lobe(2.3, 0.4, 2.5, 3.2);
    /* 뒤 검은 등걸 — 뒤틀려 오르는 굵은 기둥 하나와 갈라진 가지 둘. */
    out.push(...tagKey(spirePillar({
      x: 0, y: 0, h: 1, w: 1.9, tipW: 0.85, segs: 10, sides: 7, hold: 0.05, taper: 1.3,
      path: (t9: number): [number, number, number] => [
        -0.4 + Math.sin(t9 * 2.4) * 1.1,
        -2.2 - t9 * 0.9,
        t9 * 7.2,
      ],
      fill: "#3a2c22",
    }), depthNow(-0.4, -2.6) * 1.6 + 2));
    for (const [ex9, ey9, ez9, bw9] of [
      [-2.4, -3.2, 6.4, 0.85], [1.9, -3.6, 5.4, 0.75], [0.5, -1.4, 7.8, 0.6],
    ] as [number, number, number, number][]) {
      out.push(...tagKey(spikeHorn(-0.1, -2.7, 4.4, ex9, ey9, ez9, bw9, "#3a2c22", 6, 0.6,
        ex9 * 0.4, ey9 * 0.4 - 0.6), depthNow(ex9, ey9) * 1.6 + 2));
    }
    /* 오른쪽 뼈판 — 등걸에 기댄 창백한 널 둘. */
    for (const [bx9, by9, bz9, tx9, ty9, tz9, w9] of [
      [3.1, -0.9, 0.4, 2.3, -2.4, 5.2, 0.95],
      [3.9, 0.3, 0.4, 3.2, -1.3, 4.2, 0.75],
    ] as [number, number, number, number, number, number, number][]) {
      out.push(...tagKey(spirePillar({
        x: bx9, y: by9, z0: bz9, h: tz9 - bz9, w: w9, tipW: w9 * 0.55,
        segs: 4, sides: 4, hold: 0.2, taper: 1.3,
        leanX: tx9 - bx9, leanY: ty9 - by9,
        fill: IVORY_DEEP,
      }), depthNow(bx9, by9) * 1.6 + 3));
    }
    /* 발치 촉수 다발 — 앞오른쪽 바닥에서 기어 나와 끝이 말려 오른다. */
    for (const [tx9, ty9, ex9, ey9, ez9] of [
      [2.2, 1.9, 2.8, 3.4, 0.9], [3, 1.4, 3.9, 2.6, 0.8],
      [3.5, 0.7, 4.6, 1.4, 0.7], [1.6, 2.3, 1.9, 3.8, 1], [4, -0.2, 5.1, -0.4, 0.6],
    ] as [number, number, number, number, number][]) {
      out.push(...tagKey(spikeHorn(tx9, ty9, 0.5, ex9, ey9, ez9, 0.42, "#2b241d", 6, 0.5,
        ex9 - tx9, ey9 - ty9), depthNow(ex9, ey9) * 1.6 + 1));
    }
    return out;
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
      /* 가지 사이 물갈퀴 천막(요청: 드론·뮤탈 날개 같은 디테일) — 손으로 찍던
         너덜너덜 다각형을 걷고, 공용 막 도형으로 낸다: 이웃 돛가시 끝을 잇는 위 변에서
         바닥으로 늘어지고, 아랫단은 갈퀴 골로 우묵하게 파인다. 힘줄도 함께 붙는다. */
      ...([
        [[-4.2, -2.5, 7], [-3.2, -0.9, 2.6]] as [number, number, number][],
        [[-4.2, -2.5, 7], [0, -4.2, 5.9]] as [number, number, number][],
        [[0, -4.2, 5.9], [4, -2.9, 6.5]] as [number, number, number][],
        [[4, -2.9, 6.5], [3, -1.1, 2.6]] as [number, number, number][],
      ]).flatMap((rt9, k9) => {
        const [a9, b9] = rt9;
        // 아랫단 — 두 뿌리 사이를 넷으로 나눠 바닥까지 늘어뜨린다.
        const hem9: [number, number, number][] = Array.from({ length: 4 }, (_, i9) => {
          const u9 = i9 / 3;
          const hx9 = a9[0] + (b9[0] - a9[0]) * u9;
          const hy9 = a9[1] + (b9[1] - a9[1]) * u9;
          return [hx9 * 1.18, hy9 * 1.18, 0.3 + Math.sin(Math.PI * u9) * 1.6];
        });
        return membraneFaces(rt9, hem9, "#c68a62", {
          shade: 0.14 + k9 * 0.02, notch: 0.34,
          key: depthNow((a9[0] + b9[0]) / 2, (a9[1] + b9[1]) / 2) * 1.6,
        });
      }),
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
    /* 스파이어(요청·사진: 뿔기둥 전면 활용) — 초록 연못 위 후지산 밑동에서 촉수
       기둥 여섯이 위로 모여 오르고, 그 위에 잿빛 머리와 골진 도넛 왕관이 얹힌다. */
    const out: ShapeFace[] = [];
    const [plx, ply] = project(0, 0.6, 0.02);
    out.push(sideFace(groundEllipse(plx, ply, 6.1, 2.95), 0.22));
    out.push([groundEllipse(plx, ply, 5.5, 2.6), 0.8, "#8ef23e"] as ShapeFace);
    // 밑동 — 후지산 꼴 기둥 하나.
    const MB_H = 2.6;
    const MB_RB = 4.5;
    const MB_RT = 2.2;
    const mbR = (t9: number): number => MB_RT + (MB_RB - MB_RT) * (1 - t9) ** 2;
    out.push(...tagKey(paintBase(spirePillar({
      x: 0, y: 0.6, z0: 0, h: MB_H, w: MB_RB, tipW: MB_RT,
      segs: 5, sides: 14, hold: 0, taper: 2,
    }), "#4f7a2e"), 0));
    // 촉수 기둥 여섯 — 밑동 옆구리에 뿌리를 두고 위로 모이며 가늘어진다.
    for (const ang of [150, 210, 90, 270, 30, -30]) {
      const a2 = (ang * Math.PI) / 180;
      const dxr = Math.sin(a2);
      const dyr = Math.cos(a2);
      const rr9 = mbR(0.35) * 0.96;
      const bx9 = dxr * rr9;
      const by9 = 0.6 + dyr * rr9;
      out.push(...tagKey(spirePillar({
        x: bx9, y: by9, z0: MB_H * 0.35, h: 10.6, w: 1.05, tipW: 0.42,
        segs: 9, sides: 6, hold: 0.05, taper: 1.35,
        leanX: -dxr * (rr9 - 1.15), leanY: -dyr * (rr9 - 1.15),
        curveX: dxr * 0.85, curveY: dyr * 0.85,
        fill: "#8a5f43",
      }), depthNow(bx9, by9) * 1.6));
    }
    // 잿빛 머리 — 위로 살짝 벌어지는 짧은 기둥.
    out.push(...tagKey(paintBase(spirePillar({
      // 중심은 촉수가 모이는 자리(0, 0.6)와 같아야 한다(지적: 다리·뚜껑 중심 어긋남).
      x: 0, y: 0.6, z0: 11.1, h: 1.9, w: 2.6, tipW: 3.3,
      segs: 3, sides: 14, hold: 0.15,
    }), "#7d7a72"), 20));
    // 골진 도넛 왕관 — 방사 골 + 가운데 구멍.
    const [cx2, cy2] = project(0, 0.6, 13.1);
    out.push(...tagKey([bodyFace(groundEllipse(cx2, cy2, 3.55, 2.05))], 22));
    /* 골도 요잉을 탄다(지적: 뚜껑이 안 돎) — 화면 고정 각이던 골 위치에 현재 요잉을
       더해, 뚜껑이 함께 도는 것으로 보인다. */
    const yawRad = Math.atan2(-depthNow(1, 0), depthNow(0, 1));
    const crown: ShapeFace[] = [];
    for (const ang of [200, 240, 280, 320, 20, 60, 100, 140]) {
      const a = (ang * Math.PI) / 180 + yawRad;
      crown.push(sideFace(`M${cx2 + Math.cos(a) * 1.55} ${cy2 + Math.sin(a) * 0.9}`
        + ` L${cx2 + Math.cos(a) * 3.35} ${cy2 + Math.sin(a) * 1.94}`
        + ` L${cx2 + Math.cos(a + 0.16) * 3.35} ${cy2 + Math.sin(a + 0.16) * 1.94}`
        + ` L${cx2 + Math.cos(a + 0.16) * 1.55} ${cy2 + Math.sin(a + 0.16) * 0.9} Z`, 0.16));
    }
    crown.push(capFace(groundEllipse(cx2, cy2 - 0.2, 1.15, 0.68), 0.5));
    out.push(...tagKey(crown, 23));
    return out;
  },
  /* 그레이터 스파이어(정정: 바닥 제거·층 없는 한 몸·더 높게) — 허리가 잘록했다 위에서
     벌어지는 매끈한 줄기 하나, 앞 붉은 살 띠, 옆 혹, 꼭대기 살덩이 엽 아가리와 깃 뿔. */
  gspire: () => {
    /* 그레이터 스파이어(요청·사진: 뿔기둥 전면 활용) — 허리가 잘록했다 위에서 다시
       벌어지는 줄기를 기둥 둘로 잇고(아래는 좁아지고 위는 벌어진다), 앞 붉은 살
       띠는 그 옆선을 타는 가는 기둥으로, 꼭대기 깃 뿔은 spikeHorn으로 낸다. */
    const out: ShapeFace[] = [];
    const [plx, ply] = project(0, 0.4, 0.02);
    out.push(sideFace(groundEllipse(plx, ply, 5.9, 2.85), 0.22));
    out.push([groundEllipse(plx, ply, 5.3, 2.5), 0.8, "#8ef23e"] as ShapeFace);
    const GS_W = 9;
    const GS_T = 14;
    const gsLoR = (z9: number): number => 1.7 + 1.7 * (1 - z9 / GS_W) ** 1.6;
    // 아래 줄기 — 넓은 밑동에서 허리로.
    out.push(...tagKey(paintBase(spirePillar({
      x: 0, y: 0.4, z0: 0, h: GS_W, w: 3.4, tipW: 1.7,
      segs: 8, sides: 14, hold: 0, taper: 1.6,
    }), "#8a5f43"), 0));
    // 위 줄기 — 허리에서 꼭대기로 다시 벌어진다.
    out.push(...tagKey(paintBase(spirePillar({
      x: 0, y: 0.4, z0: GS_W, h: GS_T - GS_W, w: 1.7, tipW: 3.1,
      segs: 5, sides: 14, hold: 0,
    }), "#8a5f43"), 1));
    // 앞 붉은 살 띠 — 아래 줄기 옆선을 그대로 타고 오른다.
    out.push(...tagKey(spirePillar({
      x: 0, y: 0, h: 1, w: 1.2, tipW: 0.5, segs: 9, sides: 6, hold: 0.06, taper: 1.4,
      path: (t9: number): [number, number, number] => {
        const z9 = 0.8 + t9 * (GS_W - 0.8);
        return [0, 0.4 + gsLoR(z9) * 0.95, z9];
      },
      fill: "#b3543a",
    }), depthNow(0, 3.4) * 1.6));
    // 동굴 입구 — 밑동 앞면에 뚫린 검은 구멍.
    /* 입구는 앞이 제대로 보일 때만(지적: 안 가려짐) — 옆으로 돌면 납작한 구멍판이
       줄기 실루엣 밖으로 삐져나온다. 문턱을 올리고 면도 살짝 안으로 묻는다. */
    if (facingRatio(0, 1) > 0.45) {
      const hole = polyPath3(Array.from({ length: 9 }, (_, i) => {
        const th = (i / 8) * Math.PI;
        return [Math.cos(th) * 1.2, 0.4 + gsLoR(1.4) * 0.86, Math.sin(th) * 1.9] as [number, number, number];
      }));
      out.push(...tagKey([[hole, 0.92, "#101216"] as ShapeFace], depthNow(0, 3.4) * 1.6));
    }
    // 옆 혹 둘 — 줄기 옆선에 붙는다.
    out.push(...tagKey(domeFaces3(-gsLoR(4.6) * 0.8, 0.4, 0.95, 0.8, 4.6), depthNow(-2, 0.4) * 1.6));
    out.push(...tagKey(domeFaces3(gsLoR(6.7) * 0.85, 0.4, 0.85, 0.7, 6.7), depthNow(1.7, 0.4) * 1.6));
    // 꼭대기 깃 뿔 여섯 — 왕관처럼 둘레에서 바깥·위로 벌어진다.
    for (const [ang, len] of [[165, 4.4], [195, 4.4], [125, 3.8], [235, 3.8], [70, 3.2], [290, 3.2]] as [number, number][]) {
      const a2 = (ang * Math.PI) / 180;
      const dxr = Math.sin(a2);
      const dyr = Math.cos(a2);
      const bz9 = GS_T - 2.6;
      const rr9 = 2.5;
      const bx9 = dxr * rr9;
      const by9 = 0.4 + dyr * rr9;
      out.push(...tagKey(spikeHorn(
        bx9, by9, bz9, bx9 + dxr * 1.5, by9 + dyr * 1.5, bz9 + len,
        1, IVORY_DEEP, 6, 0.7, dxr, dyr,
      /* 뒤로 돈 깃 뿔은 줄기 뒤로(지적: 안 가려짐) — 붙박이 보정(+6)을 걷고 제 자리
         깊이만 쓴다. 줄기 키(0·1)보다 낮아지면 저절로 묻힌다. */
      ), depthNow(bx9, by9) * 1.6));
    }
    // 꼭대기 살덩이 엽 아가리.
    const [cx2, cy2] = project(0, 0.4, GS_T + 0.7);
    const maw: ShapeFace[] = [
      ...domeFaces3(-1.15, 0, 1.1, 0.9, GS_T - 0.2),
      ...domeFaces3(1.15, 0, 1.05, 0.85, GS_T - 0.2),
      ...domeFaces3(-0.75, 1.15, 0.95, 0.8, GS_T - 0.2),
      ...domeFaces3(0.85, 1.15, 0.95, 0.8, GS_T - 0.2),
      ...domeFaces3(0, -0.65, 0.95, 0.8, GS_T - 0.2),
      capFace(groundEllipse(cx2, cy2 - 0.1, 0.75, 0.45), 0.5),
    ];
    out.push(...tagKey(maw, 24));
    return out;
  },
  /* 퀸즈 네스트(실물 참고) — 살덩이 엽이 겹겹이 쌓인 봉분: 아랫단 엽 다섯, 사이 어두운
     세로 골, 중간 단 셋, 꼭대기 덮개와 작은 뿔들, 밑동 촉수. */
  queensnest: () => {
    /* 퀸즈 네스트(요청·사진: 뿔기둥 전면 활용) — 살덩이 봉분 하나 위로 겹친 엽 여섯이
       옆선을 타고 오르고, 꼭대기 덮개 둘레에서 창백한 왕관 뿔이 부챗살로 벌어진다.
       키는 저그 건물 공통 자(봉분 0, 나머지는 제 자리 깊이 × 1.6). */
    const QN_H = 4.2;
    const QN_RB = 4.4;
    const QN_RT = 2;
    /* 옆선은 볼록하게(요청) — 해처리와 반대로 위가 완만하고 아래로 갈수록 가팔라지는
       종 모양이라야 한다: 굵기 곡률을 1 아래로 내린다. */
    const QN_P = 0.55;
    const qnR = (t9: number): number => QN_RT + (QN_RB - QN_RT) * (1 - t9) ** QN_P;
    // 크립 갈퀴는 맨 아래 붙박이 키(지적: 네스트 키값 수정).
    const out: ShapeFace[] = [...tagKey(creepSplat(6.4), -20)];
    out.push(...tagKey(paintBase(spirePillar({
      x: 0, y: 0, z0: 0, h: QN_H, w: QN_RB, tipW: QN_RT,
      segs: 7, sides: 14, hold: 0, taper: QN_P,
    }), "#8a5f43"), 0));
    // 겹친 살덩이 엽 여섯 — 봉분 옆선을 타는 짧고 굵은 기둥. 개인색(요청).
    for (const ang of [-150, -90, -30, 30, 90, 150]) {
      const a2 = (ang * Math.PI) / 180;
      const dxr = Math.sin(a2);
      const dyr = Math.cos(a2);
      out.push(...tagKey(spirePillar({
        x: 0, y: 0, h: 1, w: 1.35, tipW: 0.5, segs: 8, sides: 6, hold: 0.1, taper: 1.5,
        path: (t9: number): [number, number, number] => {
          const r9 = qnR(t9) * 0.96;
          return [dxr * r9, dyr * r9, QN_H * t9];
        },
      }), depthNow(dxr * 3.4, dyr * 3.4) * 1.6));
    }
    // 꼭대기 덮개 — 봉분 윗지름을 그대로 받아 얹는다.
    out.push(...tagKey(spirePillar({
      x: 0, y: -0.2, z0: QN_H - 0.15, h: 1.6, w: QN_RT, tipW: 0.9,
      segs: 4, sides: 12, hold: 0.12, taper: 1.6, fill: "#8a5f43",
    }), 9));
    // 왕관 뿔 여섯 — 덮개 둘레에서 부챗살로 벌어지는 창백한 뿔.
    // 위쪽 뿔 대폭 축소(요청) — 길이·굵기를 절반 아래로 줄인다.
    for (const [ang, len, w9] of [
      [-160, 1.5, 0.34], [-105, 1.9, 0.38], [-50, 1.7, 0.36],
      [40, 1.3, 0.3], [100, 1.5, 0.32], [155, 1.3, 0.3],
    ] as [number, number, number][]) {
      const a2 = (ang * Math.PI) / 180;
      const dxr = Math.sin(a2);
      const dyr = Math.cos(a2);
      const bx9 = dxr * 1.1;
      const by9 = -0.2 + dyr * 1.1;
      out.push(...tagKey(spikeHorn(
        bx9, by9, QN_H + 0.4, bx9 + dxr * 0.8, by9 + dyr * 0.8, QN_H + 0.4 + len,
        w9, IVORY_DEEP, 6, 0.35, dxr, dyr,
      ), 10 + depthNow(bx9, by9) * 1.6));
    }
    // 아래 어두운 들머리 — 앞 옆선의 굴.
    out.push(...tagKey([capFace(groundEllipse(...project(0, qnR(0.12) * 0.95, 0.75), 1.1, 0.75), 0.55)],
      depthNow(0, 4) * 1.6 + 1));
    // 밑동 촉수 넷 — 바닥을 기다 끝이 살짝 든다.
    for (const [tx9, ty9, ex9, ey9] of [
      [-2.7, 2.3, -4.1, 3.4], [2.7, 2.3, 4.1, 3.4],
      [-3.6, -0.6, -5.2, -0.9], [3.5, -1, 5, -1.5],
    ] as [number, number, number, number][]) {
      out.push(...tagKey(spikeHorn(tx9, ty9, 0.7, ex9, ey9, 1.3, 0.55, "#6b4732", 6, 0.4,
        ex9 - tx9, ey9 - ty9), depthNow(ex9, ey9) * 1.6));
    }
    return out;
  },
  /* 디파일러 마운드(실물 참고) — 낮게 퍼진 살덩이 위에 검은 수정 조각 무더기가 솟고,
     왼쪽엔 말려 올라간 촉수, 가운데엔 흰 애벌레 마디, 앞엔 구덩이 입. */
  dmound: () => {
    /* 디파일러 마운드(전면 재작도·사진) — 구릿빛 살덩이 두덩이 낮게 엉키고, 그 위로
       검은 수정 조각이 무리 지어 솟는다. 오른쪽에 말려 오른 굵은 촉수, 앞에는 상아빛
       엄니 줄과 흰 애벌레 마디들, 가운데엔 개인색 아가리. */
    const FLESH = "#a35a33";
    const SHARD = "#22262b";
    const out: ShapeFace[] = [...paintBase(creepSplat(6.8), "#3a3f46")];
    // 살덩이 두덩 — 앞뒤로 겹친 낮은 언덕 둘.
    out.push(...tagKey(paintBase(spirePillar({
      x: -1, y: -0.4, z0: 0, h: 2.6, w: 3.9, tipW: 1.5,
      segs: 6, sides: 14, hold: 0, taper: 0.55,
    }), FLESH), 0));
    out.push(...tagKey(paintBase(spirePillar({
      x: 2.2, y: 0.4, z0: 0, h: 2, w: 3, tipW: 1.2,
      segs: 5, sides: 12, hold: 0, taper: 0.55,
    }), "#8a4a2a"), depthNow(2.2, 0.4) * 1.6));
    /* 검은 수정 무리 — 뒤쪽에서 제각기 다른 각도로 솟는 각진 조각들. */
    for (const [cx9, cy9, ch9, cw9, lx9, ly9] of [
      [-2.6, -2, 3.4, 0.72, -0.5, -0.3], [-1, -2.6, 4.6, 0.85, -0.2, -0.5],
      [0.6, -2.2, 3.8, 0.7, 0.2, -0.4], [2.2, -2.4, 4.2, 0.8, 0.4, -0.3],
      [3.6, -1.2, 3, 0.62, 0.5, -0.1], [-3.6, -0.6, 2.6, 0.58, -0.6, 0],
    ] as [number, number, number, number, number, number][]) {
      out.push(...tagKey(paintBase(spirePillar({
        x: cx9, y: cy9, z0: 1, h: ch9, w: cw9, tipW: 0.12,
        segs: 3, sides: 5, hold: 0.3, taper: 1.5,
        leanX: lx9, leanY: ly9,
      }), SHARD), depthNow(cx9, cy9) * 1.6 + 2));
    }
    /* 오른뒤 말려 오른 굵은 촉수 — 뿌리에서 크게 감아 도는 구릿빛 관. */
    out.push(...tagKey(paintBase(spirePillar({
      x: 0, y: 0, h: 1, w: 0.85, tipW: 0.55, segs: 10, sides: 8, hold: 0.2,
      path: (t9: number): [number, number, number] => {
        const a9 = Math.PI * (0.15 + t9 * 1.25);
        return [-2.4 + Math.cos(a9) * 1.9, -1.6 - Math.sin(a9) * 0.5, 3 + Math.sin(a9) * 2.2];
      },
    }), FLESH), 22 + depthNow(-2.4, -1.6)));
    /* 앞 상아빛 엄니 줄 — 아가리를 두르는 뾰족니 넷. */
    for (const [tx9, ty9, tz9] of [
      [-1.9, 1.9, 2], [-0.9, 2.4, 2.2], [0.2, 2.5, 2.2], [1.2, 2.2, 2],
    ] as [number, number, number][]) {
      out.push(...tagKey(ivory(hornFaces(tx9, ty9 - 0.7, 1.5, tx9, ty9, tz9, 0.42)),
        depthNow(tx9, ty9) * 1.6 + 4));
    }
    // 흰 애벌레 마디 둘 — 앞오른쪽 바닥에 눕는다.
    for (const [gx9, gy9] of [[2.6, 2], [3.6, 0.9]] as [number, number][]) {
      out.push(...tagKey(paintBase([
        ...domeFaces3(gx9, gy9, 0.75, 0.6, 0.2),
        ...domeFaces3(gx9 + 0.5, gy9 - 0.5, 0.6, 0.5, 0.2),
      ], "#d3d7db"), depthNow(gx9, gy9) * 1.6 + 3));
    }
    /* 가운데 아가리 — 개인색 포인트(요청). 어두운 속을 두른 살 테. */
    out.push(...tagKey([
      ...spirePillar({
        x: -0.7, y: 1.2, z0: 1.6, h: 1.5, w: 1.5, tipW: 1.05,
        segs: 3, sides: 12, hold: 0.2,
      }),
      capFace(discPath3(-0.7, 1.2, 3.15, 0.95), 0.55),
    ], 14));
    return out;
  },

  /* 울트라리스크 동굴(신설·사진) — 여태 모델이 없던 건물이다. 초록빛 도는 살덩이
     덩치에 굵은 핏줄이 도드라지고, 앞 아래가 크게 벌어져 누런 이빨 능선을 두른 굴
     아가리가 된다. 왼쪽에는 창백한 혹, 양옆 발치에는 갈색 촉수 다발. 꼭대기 혹
     하나가 개인색이다. */
  cavern: () => {
    const HIDE = "#5d7a4a";
    const HIDE_D = "#3f5733";
    const TOOTH = "#c9b46a";
    // 크립 갈퀴는 맨 아래 붙박이 키(면에 깊이가 없어 앞 부품 값을 물려받으면 안 된다).
    const out: ShapeFace[] = [...tagKey(paintBase(creepSplat(7), "#3a3f46"), -20)];
    // 덩치 — 뒤가 높고 앞으로 숙은 볼록한 살덩이.
    out.push(...tagKey(paintBase(spirePillar({
      x: 0, y: 0, h: 1, w: 4.4, tipW: 1.4, segs: 8, sides: 14, hold: 0, taper: 0.5,
      path: (t9: number): [number, number, number] => [0, -1.2 - t9 * 1.1, t9 * 6.4],
    }), HIDE), 0));
    /* 굵은 핏줄 — 덩치 옆선을 타고 오르는 가는 기둥 여섯. */
    for (const ang of [-150, -95, -40, 30, 95, 150]) {
      const a9 = (ang * Math.PI) / 180;
      const dxr = Math.sin(a9);
      const dyr = Math.cos(a9);
      out.push(...tagKey(spirePillar({
        x: 0, y: 0, h: 1, w: 0.42, tipW: 0.16, segs: 7, sides: 5, hold: 0.1, taper: 1.4,
        path: (t9: number): [number, number, number] => {
          const r9 = (1.4 + 3 * (1 - t9) ** 0.5) * 0.99;
          return [dxr * r9, -1.2 - t9 * 1.1 + dyr * r9, t9 * 6.4];
        },
        fill: HIDE_D,
      }), depthNow(dxr * 3, dyr * 3) * 1.6 + 1));
    }
    /* 앞 굴 아가리 — 어두운 속을 누런 이빨 능선이 위아래로 두른다. */
    /* 아가리는 몸 앞면이라 제 자리 깊이만 쓴다(지적: 키값 수정) — 붙박이 +4는
       뒤로 돌아도 몸을 뚫고 보였다. */
    const mouthKey = depthNow(0, 2.6) * 1.6;
    const arc9 = (yy: number, rx: number, rz: number, z0: number, up: boolean): string =>
      polyPath3(Array.from({ length: 13 }, (_, i9) => {
        const th = (i9 / 12) * Math.PI;
        return [Math.cos(th) * rx, yy, z0 + (up ? 1 : -1) * Math.sin(th) * rz] as [number, number, number];
      }));
    out.push(...tagKey([
      [arc9(2.35, 2.5, 2.9, 0.2, true), 0.97, "#0d1013"] as ShapeFace,
    ], mouthKey));
    // 위턱 이빨 능선 — 아가리 위를 덮는 누런 테.
    out.push(...tagKey(paintBase([
      ...spirePillar({
        x: 0, y: 0, h: 1, w: 0.46, tipW: 0.46, segs: 12, sides: 5, hold: 1,
        path: (t9: number): [number, number, number] => {
          const th = Math.PI * t9;
          return [Math.cos(th) * 2.62, 2.45 + Math.sin(th) * 0.35, 0.2 + Math.sin(th) * 3.05];
        },
      }),
    ], TOOTH), mouthKey + 0.3));
    // 아래턱 — 앞으로 내민 누런 턱받이.
    out.push(...tagKey(paintBase([
      ...spirePillar({
        x: 0, y: 0, h: 1, w: 0.52, tipW: 0.52, segs: 10, sides: 5, hold: 1,
        path: (t9: number): [number, number, number] => {
          const th = Math.PI * t9;
          return [Math.cos(th) * 2.3, 2.75 + Math.sin(th) * 0.5, 0.25];
        },
      }),
    ], TOOTH), mouthKey + 0.5));
    // 왼쪽 창백한 혹 — 덩치 옆에 붙은 매끈한 알.
    out.push(...tagKey(paintBase(domeFaces3(-3.6, 1.2, 1.35, 1.15, 0.2), "#d3d7db"),
      depthNow(-3.6, 1.2) * 1.6 + 2));
    /* 양옆 발치 갈색 촉수 다발 — 바닥을 기다 끝이 말려 오른다. */
    for (const [tx9, ty9, ex9, ey9] of [
      [-3.4, -0.6, -5.2, -1.4], [-3, 2.2, -4.4, 3.2], [3.4, -0.4, 5.2, -1],
      [3.1, 2, 4.5, 3.1], [3.8, 1, 5.6, 1.2],
    ] as [number, number, number, number][]) {
      out.push(...tagKey(spikeHorn(tx9, ty9, 0.6, ex9, ey9, 1.5, 0.5, "#6b4732", 6, 0.5,
        ex9 - tx9, ey9 - ty9), depthNow(ex9, ey9) * 1.6 + 1));
    }
    /* 꼭대기 혹 — 개인색 포인트(요청). */
    // 꼭대기 혹은 몸 위 얹힘이라 지붕 규칙 키(붙박이 + 제 자리 깊이).
    out.push(...tagKey(spirePillar({
      x: 0, y: -2.3, z0: 5.9, h: 1.9, w: 1.4, tipW: 0.5,
      segs: 4, sides: 10, hold: 0.12, taper: 1.5,
    }), 12 + depthNow(0, -2.3) * 1.6));
    return out;
  },
  /* 나이더스 커널(재모델링·사진) — 무엇보다 '동굴 입구'로 읽혀야 한다: 살덩이 둔덕
     앞면에 두툼한 아치가 서고 그 안이 검게 뚫려 굴이 된다. 위에는 앞으로 내민
     개인색 뚜껑이 굴을 덮고, 아래 테두리에는 짧은 엄니 몇 개만 남긴다. 키는 저그
     건물 공통 자(둔덕 0, 나머지는 제 자리 깊이 × 1.6). */
  nydus: () => {
    // 크립 갈퀴는 맨 아래 붙박이 키(면에 깊이가 없어 앞 부품 값을 물려받으면 안 된다).
    const out: ShapeFace[] = [...tagKey(creepSplat(6.4), -20)];
    // 둔덕 — 볼록한 종 모양 살덩이. 입구를 낼 자리라 뒤로 조금 물려 앉힌다.
    out.push(...tagKey(paintBase(spirePillar({
      x: 0, y: -0.6, z0: 0, h: 4.2, w: 4.4, tipW: 1.5,
      segs: 7, sides: 14, hold: 0, taper: 0.6,
    }), "#6b4732"), 0));
    /* 굴 속 — 아치 안의 검은 구멍. 제 자리 깊이를 그대로 쓰므로 앞을 보면 둔덕 위로
       올라오고 뒤로 돌면 둔덕에 묻힌다(따로 문턱을 두지 않는다). */
    const mouthKey = depthNow(0, 1.9) * 1.6;
    const arch9 = (yy: number, rx: number, rz: number, z0: number): string => polyPath3(
      Array.from({ length: 13 }, (_, i9) => {
        const th = (i9 / 12) * Math.PI;
        return [Math.cos(th) * rx, yy, z0 + Math.sin(th) * rz] as [number, number, number];
      }),
    );
    out.push(...tagKey([
      [arch9(1.95, 2.15, 2.55, 0.2), 0.96, "#14171c"] as ShapeFace,
      [arch9(1.7, 1.5, 1.9, 0.45), 0.98, "#06070a"] as ShapeFace,
    ], mouthKey + 0.2));
    /* 입구 아치 — 굴을 두르는 두툼한 살 테. 반원 길을 그리는 기둥 하나로 낸다
       (굵기가 일정하도록 hold를 끝까지 준다). */
    out.push(...tagKey(spirePillar({
      x: 0, y: 0, h: 1, w: 0.85, tipW: 0.85, segs: 14, sides: 6, hold: 1,
      path: (t9: number): [number, number, number] => {
        const a9 = Math.PI * (1 - t9);
        return [Math.cos(a9) * 2.55, 2.05 + Math.sin(a9) * 0.45, 0.2 + Math.sin(a9) * 2.75];
      },
      fill: "#c68a62",
    }), mouthKey + 0.4));
    /* 윗뚜껑 — 개인색(요청). 둔덕 뒤 위에서 앞으로 내밀어 굴 입구를 덮는다.
       뚜껑은 둔덕 꼭대기 위로 솟은 지붕 얹힘이다(재지적: 키값이 아직 이상) — 제
       자리 깊이만 쓰면 뒤로 돌 때마다 통째로 둔덕에 묻혀 사라진다. 지붕 규칙대로
       붙박이 큰 키에 제 자리 깊이를 얹어, 둔덕은 늘 이기되 뚜껑끼리·기관끼리의
       앞뒤는 요잉이 정하게 한다. 아치와 겹치지 않게 내민 길이도 줄인다. */
    /* 키를 저그 공통 자로 되돌린다(재지적: 커널 키값 수정) — 붙박이 12는 뒤에서
       봐도 둔덕을 뚫고 보였다. 뚜껑은 둔덕 꼭대기 위 얹힘이라 지붕 몫(6)만 얹고,
       앞뒤는 제 자리 깊이가 정하게 한다. */
    const hoodKey = 6 + depthNow(0, 1) * 1.6;
    out.push(...tagKey(spirePillar({
      x: 0, y: -1.4, z0: 2.5, h: 2.4, w: 3, tipW: 1.7,
      segs: 6, sides: 12, hold: 0.08, taper: 0.7,
      leanY: 2.5, curveY: 0.9,
    }), hoodKey));
    /* 뚜껑 등의 잿빛 기관 한 쌍(사진) — 둔덕 속에 묻히지 않게 뚜껑 위에 얹고,
       뚜껑보다 한 칸만 위 키를 준다. */
    for (const m9 of [1, -1] as const) {
      out.push(...tagKey(spirePillar({
        x: m9 * 1.8, y: -0.2, z0: 3.9, h: 1.7, w: 0.9, tipW: 0.38,
        segs: 5, sides: 8, hold: 0.1, taper: 1.4,
        leanY: 0.8, fill: IVORY_DEEP,
      }), hoodKey + 0.5));
    }
    /* 아래 테두리 엄니 — 축약(요청): 길게 늘어지던 이빨 줄과 발톱을 걷고, 입구
       아래턱에 짧은 엄니 넷만 남긴다. */
    for (const [fx9, fy9, tx9, ty9] of [
      [-2.1, 1.9, -2.5, 2.7], [-0.8, 2.35, -0.9, 3.15],
      [0.8, 2.35, 0.9, 3.15], [2.1, 1.9, 2.5, 2.7],
    ] as [number, number, number, number][]) {
      out.push(...tagKey(spikeHorn(fx9, fy9, 0.3, tx9, ty9, 1.15, 0.42, IVORY_DEEP, 6, 0.2,
        tx9 - fx9, ty9 - fy9), depthNow(tx9, ty9) * 1.6 + 0.6));
    }
    return out;
  },

  /* 해처리 — 둔덕 + 방사 다리 여섯(요잉을 따라 도는 것이 핵심) + 윗면 입·목띠. */
  // 띠·캐노피는 검정보다 한 단 연한 짙은 회색(재지적).
  hatchery: () => hatcheryMoundFaces("#3a3f46"),
  /* 레어 — 해처리 + 다리 끝 굽은 뿔 셋. */
  lair: () => [
    // 뿔은 동굴 입구 하나 건너 하나(지적) — 다리 각 -170·-40·80의 입구에서 솟는다.
    // 뒤 입구(-170) 뿔은 둔덕이 가리도록 먼저(지적: 비쳐 보였다). 뿔은 검회색(요청).
    /* 뿔에 제 자리 깊이(지적: 가려짐) — 둔덕이 큰 반지름 키를 써서 앞쪽 뿔까지
       덮었다. 뒤 뿔은 둔덕보다 낮은 키, 앞 뿔은 높은 키로 갈라 준다. */
    /* 뿔은 더 굵고 길게, 밑동은 둔덕 옆구리에 딱 붙이고(반경 4.6), 휨은 본진 안쪽
       (중심 방향)으로(요청). 안쪽 방향은 밑동 자리의 반대 부호다. */
    // 휨 방향 반전(재지적) — 배가 바깥으로 부풀며 끝이 안으로 감긴다.
    // 뿌리를 조금 더 바깥으로(요청) — 둔덕 옆구리 반경 4.6 → 5.4.
    /* 앞뒤는 요잉이 정한다(재지적) — 제 자리 깊이를 키워 써 앞 뿔은 둔덕 위, 뒤로
       돌아간 뿔은 둔덕 뒤로 간다. */
    ...tagKey(spikeHorn(-0.95, -5.35, 1.1, -1.1, -6.6, 10.2, 2.4, "#1b1e23", 6, 1.5, -0.17, -0.98),
      depthNow(-0.95, -5.35) * 1.6),
    ...SHAPE_BUILDERS.hatchery(),
    ...tagKey(spikeHorn(-3.45, 4.1, 1.1, -3.9, 5.1, 11.6, 2.6, "#1b1e23", 6, 1.6, -0.64, 0.77),
      depthNow(-3.45, 4.1) * 1.6),
    ...tagKey(spikeHorn(5.3, 0.95, 1.2, 5.9, 1.1, 12.2, 2.8, "#1b1e23", 6, 1.6, 0.98, 0.17),
      depthNow(5.3, 0.95) * 1.6),
  ],
  /* 하이브 — 더 길고 굵은 뿔 셋(뿔 등에 가시들, 요청) + 앞 컬. */
  hive: () => {
    const out: ShapeFace[] = [];
    // 뿔은 동굴 입구 하나 건너 하나(지적) — 레어와 같은 세 입구, 더 길게.
    // 첫째(뒤 입구) 뿔은 둔덕보다 먼저 그린다(지적: 비쳐 보였다).
    /* 뿔은 더 굵고 길게, 밑동은 둔덕 옆구리에 딱 붙이고, 휨은 본진 안쪽으로(요청).
       [밑x, 밑y, 밑z, 끝x, 끝y, 끝z, 굵기, 안쪽x, 안쪽y] */
    const horns: [number, number, number, number, number, number, number, number, number][] = [
      // 휨 방향 반전(재지적) — 배가 바깥으로 부풀며 끝이 안으로 감긴다.
      // 뿌리를 조금 더 바깥으로(요청).
      [-0.95, -5.35, 1.1, -1.2, -7, 13, 2.9, -0.17, -0.98],
      [-3.45, 4.1, 1.1, -4.1, 5.4, 14.4, 3.1, -0.64, 0.77],
      [5.3, 0.95, 1.2, 6.3, 1.2, 15.4, 3.3, 0.98, 0.17],
    ];
    let hi = 0;
    for (const [bx, by, bz, tx, ty, tz, w, inX, inY] of horns) {
      if (hi === 1) out.push(...hatcheryMoundFaces(IVORY_DEEP, IVORY_DEEP)); // 옆띠·위·옆 가시 진한 상아(재지적)
      hi += 1;
      // 뿔은 황토색, 가시는 상아색(요청).
      // 뿔에 제 자리 깊이(지적: 가려짐) — 첫 뿔(뒤)은 둔덕 뒤, 나머지는 둔덕 앞.
      /* 앞뒤는 요잉이 정한다(재지적: 뒤로 돈 뿔이 안 가려짐) — 고정 키를 쓰면 뒤로
         돌아도 늘 앞에 그려진다. 제 자리 깊이를 키워 쓰면 앞은 둔덕 위, 뒤는 아래다. */
      out.push(...tagKey(spikeHorn(bx, by, bz, tx, ty, tz, w, "#b3854a", 6, 1.8, inX, inY),
        depthNow(bx, by) * 1.6));
      /* 뿔 등의 가시(요청, 정정: 안쪽을 향한다) — 뿔 길이를 따라 서너 개가 본 건물
         쪽으로 돋는다. */
      /* 가시는 휜 뿔의 곡선 위에 앉는다(지적: 위치가 어긋남) — spikeHorn과 같은
         사인 휨을 그대로 더해 뿔 등에 붙인다. */
      for (const t of [0.35, 0.55, 0.75]) {
        const s9 = Math.sin(Math.PI * t) * 1.8;
        const px = bx + (tx - bx) * t + s9 * inX;
        const py = by + (ty - by) * t + s9 * inY;
        const pz = bz + (tz - bz) * t + s9 * 0.2;
        const olen = Math.hypot(px, py) || 1;
        const ox = (px / olen) * 1.7;
        const oy = (py / olen) * 1.7;
        out.push(...tagKey(paintBase(
          hornFaces(px, py, pz, px - ox, py - oy, pz + 0.7, 0.65), IVORY_DEEP,
        ), depthNow(px, py) * 1.6 + 0.2));
      }
    }
    out.push(...tagKey(hornFaces(-2.6, 4.6, 0.6, -4.4, 6, 2.6, 1), depthNow(-3.5, 5.3) * 1.6));
    out.push(...tagKey(hornFaces(2.8, 4.4, 0.6, 4.6, 5.6, 2.4, 1), depthNow(3.7, 5) * 1.6));
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
      // 풀 물색(요청: 약간 형광톤의 연두녹색) — 어둡게 누르던 캡 대신 제 색을 채운다.
      [groundEllipse(cx, cy, 4.7, 2.15), 0.9, "#8ef23e"] as ShapeFace,
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
    /* 궤도는 양쪽 두 개씩(지적) — 앞쪽이 짧고 뒤쪽이 긴 캐터필러 한 쌍. 상자+반구 캡
       대신 옆면이 알약꼴인 궤도 슬래브(재지적)로 그린다. */
    ...paintBase(trackFaces(-2, 0.9, 3.1, 1.4, 1.7), TRACK_STEEL),
    ...paintBase(trackFaces(2, 0.9, 3.1, 1.4, 1.7), TRACK_STEEL),
    ...paintBase(trackFaces(-2, -3.2, 0.4, 1.5, 1.7), TRACK_STEEL),
    ...paintBase(trackFaces(2, -3.2, 0.4, 1.5, 1.7), TRACK_STEEL),
    ...paintBase(boxFaces3(0, -0.2, 3.9, 5.6, 1.3, 1.2), "#c9ced6"), // 차체 은색(요청: 포탑만 개인색)
    /* 포탑은 사다리꼴면체(요청) — 아래가 넓고 위가 좁다. 렌더 순서 정리(지적:
       가려짐이 잦다): 궤도·차체는 제 깊이, 포탑 40, 포신 45로 층을 못 박는다. */
    ...tagKey(frustumFaces3(0, -0.4, 3, 3, 1.9, 1.9, 1.5, 2.4), 40),
    /* 뚜껑만 은색(요청) — 옆면은 개인색 그대로. frustum은 윗판과 옆면을 한 몸으로
       칠하므로, 같은 윗판을 은색으로 한 겹 덧그린다. */
    ...tagKey([
      [polyPath3([[-0.95, 0.55, 3.9], [0.95, 0.55, 3.9], [0.95, -1.35, 3.9], [-0.95, -1.35, 3.9]]),
        1, "#c9ced6"] as ShapeFace,
      topFace(polyPath3([[-0.95, 0.55, 3.9], [0.95, 0.55, 3.9], [0.95, -1.35, 3.9], [-0.95, -1.35, 3.9]]), 0.16),
    ], 41),
    ...tagKey(paintBase([
      ...tubeFaces(-0.55, 1.2, -0.55, 4.4, 0.24, 3.3),
      ...tubeFaces(0.55, 1.2, 0.55, 4.4, 0.24, 3.3),
    ], GUNMETAL), 45),
  ],
  /* 발포 반동용 분해(요청: 발포 시 포탑·포신만 움직이게) — 차체와 포탑을 딴 판으로
     구워, 쏘는 순간 포탑 판만 살짝 밀렸다 돌아온다. 갤러리·v1은 합본(tank)을 그대로
     쓰고 v2 렌더만 이 짝을 쓴다. */
  tankbody: () => [
    ...paintBase(trackFaces(-2, 0.9, 3.1, 1.4, 1.7), TRACK_STEEL),
    ...paintBase(trackFaces(2, 0.9, 3.1, 1.4, 1.7), TRACK_STEEL),
    ...paintBase(trackFaces(-2, -3.2, 0.4, 1.5, 1.7), TRACK_STEEL),
    ...paintBase(trackFaces(2, -3.2, 0.4, 1.5, 1.7), TRACK_STEEL),
    ...paintBase(boxFaces3(0, -0.2, 3.9, 5.6, 1.3, 1.2), "#c9ced6"), // 차체 은색(요청: 포탑만 개인색)
  ],
  tankgun: () => [
    // 포탑 사다리꼴면체 + 층 못 박기(요청·지적) — 포탑 40, 포신 45.
    ...tagKey(frustumFaces3(0, -0.4, 3, 3, 1.9, 1.9, 1.5, 2.4), 40),
    /* 뚜껑만 은색(요청) — 옆면은 개인색 그대로. frustum은 윗판과 옆면을 한 몸으로
       칠하므로, 같은 윗판을 은색으로 한 겹 덧그린다. */
    ...tagKey([
      [polyPath3([[-0.95, 0.55, 3.9], [0.95, 0.55, 3.9], [0.95, -1.35, 3.9], [-0.95, -1.35, 3.9]]),
        1, "#c9ced6"] as ShapeFace,
      topFace(polyPath3([[-0.95, 0.55, 3.9], [0.95, 0.55, 3.9], [0.95, -1.35, 3.9], [-0.95, -1.35, 3.9]]), 0.16),
    ], 41),
    ...tagKey(paintBase([
      ...tubeFaces(-0.55, 1.2, -0.55, 4.4, 0.24, 3.3),
      ...tubeFaces(0.55, 1.2, 0.55, 4.4, 0.24, 3.3),
    ], GUNMETAL), 45),
  ],
  /* 시즈 모드(실물 참고) — 사방으로 벌린 궤도 발 넷 + 올라선 포탑 + 위-앞으로 겨눈
     큰 포신. */
  tanksiege: () => {
    /* 포신(수리: 요잉 때 뒤틀림) — 화면 사각형 대신 모델 공간 슬래브: 윗면·옆 두께·
       포구 단면이 전부 모형 좌표라 어느 요잉에서도 결이 맞는다. */
    const barrelTop = polyPath3([[-0.7, 0.7, 4], [0.7, 0.7, 4], [0.7, 2.9, 6.9], [-0.7, 2.9, 6.9]]);
    return [
      /* 캐터필러는 시즈에서도 그대로다(지적: 시즈 모드에서 궤도가 없어지진 않는다) —
         탱크 모드와 같은 알약 옆면 궤도 두 쌍(앞 짧고 뒤 긴, 재지적). */
      ...paintBase(trackFaces(-2, 0.9, 3.1, 1.4, 1.7), TRACK_STEEL),
      ...paintBase(trackFaces(2, 0.9, 3.1, 1.4, 1.7), TRACK_STEEL),
      ...paintBase(trackFaces(-2, -3.2, 0.4, 1.5, 1.7), TRACK_STEEL),
      ...paintBase(trackFaces(2, -3.2, 0.4, 1.5, 1.7), TRACK_STEEL),
      /* 고정 발(정정 둘: 양옆·뒤 + 더 가늘게) — 차체에서 수평으로 뻗은 가는 팔이
         끝에서 직각으로 꺾여 내려서고, 바닥엔 작은 발판. 윗부분(차체·포탑·포신)은
         그대로. */
      // 왼발.
      ...paintBase(boxFaces3(-3.15, 0, 1.4, 0.5, 0.32, 1.6), "#c9ced6"), // 고정 발 은색(요청)
      ...paintBase(boxFaces3(-3.95, 0, 0.45, 0.45, 1.7), "#c9ced6"), // 고정 발 은색(요청)
      ...paintBase(boxFaces3(-3.95, 0, 1, 0.9, 0.28), "#c9ced6"), // 고정 발 은색(요청)
      // 오른발.
      ...paintBase(boxFaces3(3.15, 0, 1.4, 0.5, 0.32, 1.6), "#c9ced6"), // 고정 발 은색(요청)
      ...paintBase(boxFaces3(3.95, 0, 0.45, 0.45, 1.7), "#c9ced6"), // 고정 발 은색(요청)
      ...paintBase(boxFaces3(3.95, 0, 1, 0.9, 0.28), "#c9ced6"), // 고정 발 은색(요청)
      // 뒷발.
      ...paintBase(boxFaces3(0, -3.5, 0.5, 1.4, 0.32, 1.6), "#c9ced6"), // 고정 발 은색(요청)
      ...paintBase(boxFaces3(0, -4.3, 0.45, 0.45, 1.7), "#c9ced6"), // 고정 발 은색(요청)
      ...paintBase(boxFaces3(0, -4.3, 0.9, 1, 0.28), "#c9ced6"), // 고정 발 은색(요청)
      // 차체는 탱크 모드와 똑같이(지적: 시즈·보통 모드의 몸통이 달라) — 같은 상자.
      ...paintBase(boxFaces3(0, -0.2, 3.9, 5.6, 1.3, 1.2), "#c9ced6"), // 차체 은색(요청: 포탑만 개인색)
      /* 포신 입체 벽 두르기(재지적: 캐리어처럼) — 오른벽 하나만 박혀 있던 것을 윗판·
         밑판 + 좌우 옆벽(faceLight 판정) + 포구 단면(앞이 보일 때만)으로 닫는다.
         포신은 받침(키 40)보다 위(재지적: 포신 가려짐). */
      /* 면 순서(재지적: 비침·순서) — 내려다보는 카메라라 밑판이 맨 아래, 옆벽,
         포구 단면, 윗판 차례로 얹혀야 한다. 윗판을 먼저 그리면 옆벽이 그 위를 덮어
         포신이 뚫린 것처럼 보였다. 키(45)는 첫 면인 밑판이 정의하고 나머지가 물려받는다. */
      [polyPath3([[-0.7, 0.7, 3.6], [0.7, 0.7, 3.6], [0.7, 2.9, 6.5], [-0.7, 2.9, 6.5]]),
        1, GUNMETAL, 45] as ShapeFace,
      /* 좌우 벽은 둘 다 그리되 뒤 향한 쪽부터(재지적: 면이 비치고 서로 가림) —
         하나를 걸러내면 그 자리로 뒤가 비친다. */
      ...([1, -1] as [1, -1])
        .sort((q2: number, w2: number) => facingRatio(q2, 0) - facingRatio(w2, 0))
        .flatMap((m2: 1 | -1): ShapeFace[] => {
          const sl = faceLight(m2, 0);
          const d = polyPath3([
            [m2 * 0.7, 0.7, 4], [m2 * 0.7, 2.9, 6.9], [m2 * 0.7, 2.9, 6.5], [m2 * 0.7, 0.7, 3.6],
          ]);
          return [[d, 1, GUNMETAL] as ShapeFace, ...(sl.visible ? sl.face(d) : [sideFace(d, 0.42)])];
        }),
      ...((): ShapeFace[] => {
        const mz = faceLight(0, 0.71, 0.71);
        const d = polyPath3([[-0.7, 2.9, 6.9], [0.7, 2.9, 6.9], [0.7, 2.9, 6.5], [-0.7, 2.9, 6.5]]);
        // 포구 단면도 늘 그린다(재지적: 걸러내면 그 틈으로 비친다).
        return [[d, 1, GUNMETAL] as ShapeFace, ...(mz.visible ? [capFace(d, 0.4)] : [capFace(d, 0.5)])];
      })(),
      // 윗판은 맨 나중 — 위에서 보는 화면에서 늘 꼭대기다.
      [barrelTop, 1, GUNMETAL] as ShapeFace,
      topFace(barrelTop, 0.18),
      /* 포탑 받침은 맨 나중에(재수리: 앞에 두면 무깊이 포신 면들이 깊이 40을 물려받아
         결국 위에 그려졌다 — zsorted는 무깊이 면에 직전 깊이를 준다). */
      ...tagKey(frustumFaces3(0, -0.7, 2.3, 3.2, 1.7, 2.4, 1.6, 2.5), 40),
      // 뚜껑만 은색(요청) — 옆면은 개인색.
      ...tagKey([
        [polyPath3([[-0.85, 0.5, 4.1], [0.85, 0.5, 4.1], [0.85, -1.9, 4.1], [-0.85, -1.9, 4.1]]),
          1, "#c9ced6"] as ShapeFace,
        topFace(polyPath3([[-0.85, 0.5, 4.1], [0.85, 0.5, 4.1], [0.85, -1.9, 4.1], [-0.85, -1.9, 4.1]]), 0.16),
      ], 41),
    ];
  },
  /* 발포 반동용 분해(요청) — 시즈 차체/포탑·포신 분리판. */
  tanksiegebody: () => [
    ...paintBase(trackFaces(-2, 0.9, 3.1, 1.4, 1.7), TRACK_STEEL),
    ...paintBase(trackFaces(2, 0.9, 3.1, 1.4, 1.7), TRACK_STEEL),
    ...paintBase(trackFaces(-2, -3.2, 0.4, 1.5, 1.7), TRACK_STEEL),
    ...paintBase(trackFaces(2, -3.2, 0.4, 1.5, 1.7), TRACK_STEEL),
    ...paintBase(boxFaces3(-3.15, 0, 1.4, 0.5, 0.32, 1.6), "#c9ced6"), // 고정 발 은색(요청)
    ...paintBase(boxFaces3(-3.95, 0, 0.45, 0.45, 1.7), "#c9ced6"), // 고정 발 은색(요청)
    ...paintBase(boxFaces3(-3.95, 0, 1, 0.9, 0.28), "#c9ced6"), // 고정 발 은색(요청)
    ...paintBase(boxFaces3(3.15, 0, 1.4, 0.5, 0.32, 1.6), "#c9ced6"), // 고정 발 은색(요청)
    ...paintBase(boxFaces3(3.95, 0, 0.45, 0.45, 1.7), "#c9ced6"), // 고정 발 은색(요청)
    ...paintBase(boxFaces3(3.95, 0, 1, 0.9, 0.28), "#c9ced6"), // 고정 발 은색(요청)
    ...paintBase(boxFaces3(0, -3.5, 0.5, 1.4, 0.32, 1.6), "#c9ced6"), // 고정 발 은색(요청)
    ...paintBase(boxFaces3(0, -4.3, 0.45, 0.45, 1.7), "#c9ced6"), // 고정 발 은색(요청)
    ...paintBase(boxFaces3(0, -4.3, 0.9, 1, 0.28), "#c9ced6"), // 고정 발 은색(요청)
    ...paintBase(boxFaces3(0, -0.2, 3.9, 5.6, 1.3, 1.2), "#c9ced6"), // 차체 은색(요청: 포탑만 개인색)
  ],
  tanksiegegun: () => {
    const barrelTop = polyPath3([[-0.7, 0.7, 4], [0.7, 0.7, 4], [0.7, 2.9, 6.9], [-0.7, 2.9, 6.9]]);
    return [
      // 포신은 받침(키 40)보다 위(재지적: 포신 가려짐) — 뒤 무깊이 면들이 45를 상속한다.
      /* 면 순서(재지적: 비침·순서) — 내려다보는 카메라라 밑판이 맨 아래, 옆벽,
         포구 단면, 윗판 차례로 얹혀야 한다. 윗판을 먼저 그리면 옆벽이 그 위를 덮어
         포신이 뚫린 것처럼 보였다. 키(45)는 첫 면인 밑판이 정의하고 나머지가 물려받는다. */
      [polyPath3([[-0.7, 0.7, 3.6], [0.7, 0.7, 3.6], [0.7, 2.9, 6.5], [-0.7, 2.9, 6.5]]),
        1, GUNMETAL, 45] as ShapeFace,
      /* 좌우 벽은 둘 다 그리되 뒤 향한 쪽부터(재지적: 면이 비치고 서로 가림) —
         하나를 걸러내면 그 자리로 뒤가 비친다. */
      ...([1, -1] as [1, -1])
        .sort((q2: number, w2: number) => facingRatio(q2, 0) - facingRatio(w2, 0))
        .flatMap((m2: 1 | -1): ShapeFace[] => {
          const sl = faceLight(m2, 0);
          const d = polyPath3([
            [m2 * 0.7, 0.7, 4], [m2 * 0.7, 2.9, 6.9], [m2 * 0.7, 2.9, 6.5], [m2 * 0.7, 0.7, 3.6],
          ]);
          return [[d, 1, GUNMETAL] as ShapeFace, ...(sl.visible ? sl.face(d) : [sideFace(d, 0.42)])];
        }),
      ...((): ShapeFace[] => {
        const mz = faceLight(0, 0.71, 0.71);
        const d = polyPath3([[-0.7, 2.9, 6.9], [0.7, 2.9, 6.9], [0.7, 2.9, 6.5], [-0.7, 2.9, 6.5]]);
        // 포구 단면도 늘 그린다(재지적: 걸러내면 그 틈으로 비친다).
        return [[d, 1, GUNMETAL] as ShapeFace, ...(mz.visible ? [capFace(d, 0.4)] : [capFace(d, 0.5)])];
      })(),
      // 윗판은 맨 나중 — 위에서 보는 화면에서 늘 꼭대기다.
      [barrelTop, 1, GUNMETAL] as ShapeFace,
      topFace(barrelTop, 0.18),
      // 포탑 받침은 맨 나중에(재수리: zsorted 무깊이 상속 탓 — 위 합본과 같은 이유).
      ...tagKey(frustumFaces3(0, -0.7, 2.3, 3.2, 1.7, 2.4, 1.6, 2.5), 40),
      // 뚜껑만 은색(요청) — 옆면은 개인색.
      ...tagKey([
        [polyPath3([[-0.85, 0.5, 4.1], [0.85, 0.5, 4.1], [0.85, -1.9, 4.1], [-0.85, -1.9, 4.1]]),
          1, "#c9ced6"] as ShapeFace,
        topFace(polyPath3([[-0.85, 0.5, 4.1], [0.85, 0.5, 4.1], [0.85, -1.9, 4.1], [-0.85, -1.9, 4.1]]), 0.16),
      ], 41),
    ];
  },
  /* 벌처(실물 참고) — 뒤 엔진 통 둘, 가운데 좌석·라이더 혹, 앞으로 길고 뾰족하게
     뻗는 칼날 스키드 코. */
  vulture: () => {
    const [gx, gy] = project(0, 0.4, 3);
    const nose = polyPath3([[-1, -0.3, 4.35], [1, -0.3, 4.35], [0.4, 4.8, 3.55], [-0.05, 4.9, 3.55]]);
    return [
      topFace(groundEllipse(gx, gy, 2, 0.85), 0.22),
      // 앞코만 개인색, 나머지 은색(요청) — 조종석 유리는 유리색.
      // 추진체 둘 수평 정렬(지적) — 높이·반지름·길이를 같게.
      ...paintBase(tubeFaces(-0.55, -2.9, -0.55, -1.3, 0.52, 4.4), "#c9ced6"),
      ...paintBase(tubeFaces(0.55, -2.9, 0.55, -1.3, 0.52, 4.4), "#c9ced6"),
      /* 부품 간 가려짐(지적) — 손 면들이 직전 부품 깊이를 물려받아 요잉 따라 섞였다.
         뒤 갑판·코 그룹에 제 깊이 키를 단다. */
      ...tagKey([
        [polyPath3([[1.1, -0.2, 4.4], [0.9, -2.4, 4.5], [-0.9, -2.4, 4.5], [-1.1, -0.2, 4.4]]), 1, "#c9ced6"] as ShapeFace,
      ], depthNow(0, -1.3)),
      ...paintBase(domeFaces3(0, -1, 0.85, 0.85, 4.6), "#bfe0ef"),
      /* 앞코 윗판도 은색(재지적) — 대신 코의 옆치마 두 쪽과 앞끝 단면은 개인색으로
         남겨 개인색 포인트가 코 테두리에 두른다. */
      // 위뚜껑 경사판은 그룹 안에서 맨 나중에(재지적: 옆치마가 윗판 경사면을 덮었다).
      ...tagKey([
        bodyFace(polyPath3([[1, -0.3, 4.35], [0.4, 4.8, 3.55], [0.35, 4.75, 3.2], [0.95, -0.3, 3.9]])),
        sideFace(polyPath3([[1, -0.3, 4.35], [0.4, 4.8, 3.55], [0.35, 4.75, 3.2], [0.95, -0.3, 3.9]]), 0.2),
        bodyFace(polyPath3([[-1, -0.3, 4.35], [-0.05, 4.9, 3.55], [-0.1, 4.85, 3.2], [-0.95, -0.3, 3.9]])),
        topFace(polyPath3([[-1, -0.3, 4.35], [-0.05, 4.9, 3.55], [-0.1, 4.85, 3.2], [-0.95, -0.3, 3.9]]), 0.12),
        bodyFace(polyPath3([[0.4, 4.8, 3.55], [-0.05, 4.9, 3.55], [-0.1, 4.85, 3.2], [0.35, 4.75, 3.2]])),
        [nose, 1, "#c9ced6"] as ShapeFace,
        topFace(nose, 0.18),
      ], depthNow(0, 2) + 0.5),
    ];
  },
  /* 골리앗 — 두 다리 위 상자 몸통 + 양옆 총 포드 + 머리. */
  goliath: () => [
    // 상완(팔 총 포드)만 개인색, 나머지 전부 은색(요청).
    ...paintBase([
      /* 기계식 꺾인 다리(재지적: 뿔이 아니라 사각 기둥) — 공용 도형으로 넓적다리와
         정강이를 각각 사각 단면 기둥으로 세운다. 굵기는 거의 일정하다. */
      /* 관절(재재지적: 대퇴는 뒤로, 정강이는 앞으로 + 무릎에서 두 마디가 만나야 한다)
         — spirePillar는 아래에서 위로 자라므로, 대퇴는 '무릎→엉덩이', 정강이는
         '발→무릎'으로 정의해 무릎 좌표를 정확히 공유시킨다.
         엉덩이(x ±1.2, y 0, z 4.8) — 무릎(x ±1.55, y -1.4, z 2.9) — 발(x ±1.7, y 0.5, z 0.9). */
      ...([-1, 1] as const).flatMap((m9): ShapeFace[] => [
        // 대퇴 — 무릎에서 엉덩이로(뒤로 기운다).
        ...spirePillar({
          x: m9 * 1.55, y: -1.4, z0: 2.9, h: 1.9, w: 0.42, tipW: 0.44,
          segs: 1, sides: 4, leanX: -m9 * 0.35, leanY: 1.4, hold: 0.9,
        }),
        // 정강이 — 발에서 무릎으로(앞으로 기운다).
        // 정강이는 발판 위에 바로 얹힌다(지적: 아래다리와 발이 떨어짐) — z0 0.9 → 0.45.
        ...spirePillar({
          x: m9 * 1.7, y: 0.5, z0: 0.45, h: 2.45, w: 0.36, tipW: 0.42,
          segs: 1, sides: 4, leanX: -m9 * 0.15, leanY: -1.9, hold: 0.9,
        }),
        ...boxFaces3(m9 * 1.7, 0.5, 1.2, 1.7, 0.55),
      ]),
      ...boxFaces3(0, -0.2, 2.6, 2.2, 2, 4.8),
      // 콕핏 머리 + 안테나.
      ...domeFaces3(0, 0.2, 0.9, 0.7, 6.8),
      ...hornFaces(-0.5, -0.6, 7.4, -0.8, -0.9, 8.4, 0.22),
    ], "#c9ced6"),
    // 옆에 매달린 큰 팔 총 포드(앞 총열) — 개인색 유지.
    ...boxFaces3(-2.25, 0, 1.25, 1.9, 1.8, 4.3),
    ...paintBase(tubeFaces(-2.25, 0.9, -2.25, 2.3, 0.28, 5), GUNMETAL),
    ...boxFaces3(2.25, 0, 1.25, 1.9, 1.8, 4.3),
    ...paintBase(tubeFaces(2.25, 0.9, 2.25, 2.3, 0.28, 5), GUNMETAL),
    capFace(polyPath3([[-0.5, 0.95, 7.2], [0.5, 0.95, 7.2], [0.4, 1.05, 6.9], [-0.4, 1.05, 6.9]]), 0.4),
  ],
  /* 리버(복구) — 반지름이 비슷한 마디 돔 다섯을 촘촘히 겹친 매끈한 애벌레.
     머리 앞에 띄우던 입 원반은 걷었다(지적: 머리쪽 검은 원이 떠 있음 — 몸에서 떨어져
     보일 뿐 정보가 없다). */
  reaver: () => {
    /* 재재재지적: 옆에서 보면 오렌지 조각(반달) 실루엣 — 가운데가 높고 양끝이
       낮아지는 겹비늘 마디 다섯(앞마디가 뒤를 덮는 고정 키). 전체 금색. 등쪽 반원
       무늬는 화면 고정 호가 떠 보였으니 모델 공간 판으로 등에 붙여 요잉을 탄다.
       앞 바닥엔 아주 작은 반의반 구 머리. */
    // 등을 더 높인다(재지적) — 가운데가 솟은 반달이 더 도드라진다.
    const segs: [number, number, number][] = [ // [y, 반지름, 높이] — 뒤에서 앞으로.
      [-2.25, 0.8, 1.2], [-1.25, 1.3, 2.4], [-0.1, 1.6, 3.2], [1.05, 1.5, 2.7], [2.05, 1.05, 1.6],
    ];
    const out: ShapeFace[] = [];
    segs.forEach(([cy, r, h], i) => {
      out.push(...tagKey(paintBase(domeFaces3(0, cy, r, h, 3.4), "#d4af37"), 10 + i * 2));
      if (i >= 1 && i <= 3) {
        for (const m9 of [-1, 1] as const) {
          const cxm = m9 * r * 0.42;
          const w9 = r * 0.3;
          /* 갑각 곡면을 따라 휜다(재지적: 딱 맞추려면 휘어져 붙어야) — 무늬의 점마다
             그 자리의 돔 표면 높이를 풀어 얹는다. 평평한 판이 아니라 껍질에 밀착한
             얇은 딱지가 된다. */
          const pts9: [number, number, number][] = [];
          for (let a9 = 0; a9 <= 10; a9 += 1) {
            const th9 = (a9 / 10) * Math.PI;
            const px9 = cxm + Math.cos(th9) * w9;
            const py9 = cy + 0.5 - Math.sin(th9) * w9 * 1.15;
            const d9 = Math.min(0.985, Math.hypot(px9, py9 - cy) / r);
            pts9.push([px9, py9, 3.4 + h * Math.sqrt(1 - d9 * d9) * 0.99]);
          }
          out.push([polyPath3(pts9), 0.95] as ShapeFace);
        }
      }
    });
    // 아주 작은 반의반 구 머리 — 앞쪽 바닥에.
    out.push(...tagKey(paintBase(domeFaces3(0, 2.75, 0.5, 0.4, 3.4), "#d4af37"), 21));
    return out;
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
      ...paintBase(tubeFaces(-0.5, -2.8, -0.5, -1.7, 0.32, 5.4), GUNMETAL),
      ...paintBase(tubeFaces(0.5, -2.8, 0.5, -1.7, 0.32, 5.4), GUNMETAL),
      // 날개 — 사각 평판 두 장.
      bodyFace(wingL), topFace(wingL, 0.16),
      bodyFace(wingR), sideFace(wingR, 0.18),
      // 날개 끝 긴 포신 각각 — 건메탈(요청).
      ...paintBase(gun(-3.1), GUNMETAL),
      ...paintBase(gun(3.1), GUNMETAL),
      // 몸통 상자 은색(요청) + 콕핏 상자.
      ...paintBase(boxFaces3(0, 0.3, 1.7, 4.2, 1.1, 5.4), "#c9ced6"),
      ...boxFaces3(0, 1, 1.1, 1.7, 0.7, 6.5),
      capFace(polyPath3([[-0.4, 1.86, 7], [0.4, 1.86, 7], [0.35, 1.86, 6.6], [-0.35, 1.86, 6.6]]), 0.4),
      // 핵심 포인트(지적: 훨씬 길게) — 몸 아래로 낮게 매달린 긴 포신. 은색(요청).
      ...paintBase(hornFaces(0, -0.9, 5.3, 0, -1.1, 3.3, 0.26), "#c9ced6"),
      /* 막힌 원통 막대(재재지적) — 손 캡슐 대신 rodFaces: 축 정렬 끝 타원이라 어느
         요잉에서도 끝이 안 물린다. */
      ...paintBase(rodFaces(0, -3.4, 2.8, 0, 1.8, 2.8, 0.8), "#c9ced6"),
    ];
  },
  /* 배틀크루저(전면 단순화 — 지적: 가는 붐·캡슐 조합이 조각나 보임) — 전부 몸에 붙은
     상자·짧은 통으로: 장도리 몸 + 옆 날개 슬래브 위 미사일 상자(탄두) + 꽁무니 통 셋. */
  bc: () => [
    // (제거·지적) 추진기 — 어느 판도 마음에 안 들어 걷었다.
    // 양팔 복구(지적) — 붐 팔 + 캡슐 미사일(탄두).
    // 목만 빼고 전체 은색(요청).
    ...paintBase([
      ...hornFaces(-1.4, -1.4, 6, -4.5, -0.8, 5.7, 0.4),
      ...tubeFaces(-4.8, -1.6, -4.8, 1, 0.55, 5.3),
      ...hornFaces(-4.8, 1, 5.55, -4.8, 2.4, 5.5, 0.5),
      ...hornFaces(1.4, -1.4, 6, 4.5, -0.8, 5.7, 0.4),
      ...tubeFaces(4.8, -1.6, 4.8, 1, 0.55, 5.3),
      ...hornFaces(4.8, 1, 5.55, 4.8, 2.4, 5.5, 0.5),
    ], "#c9ced6"),
    // 장도리 몸(정정 둘: 몸 짧게, 목 길게) — 몸통·긴 목·가로 머리·함교.
    ...paintBase(boxFaces3(0, -0.6, 2.4, 3.4, 1.6, 5.4), "#c9ced6"),
    ...boxFaces3(0, 2.2, 1.2, 2.6, 0.9, 5.7), // 목 — 개인색 유지.
    ...paintBase(boxFaces3(0, 4.1, 3.6, 1.2, 1.4, 5.5), "#c9ced6"),
    ...paintBase(boxFaces3(0, -1.4, 1.2, 1.2, 0.8, 7), "#c9ced6"),
    /* 야마토 포문 홈(요청) — 머리 앞면 가운데의 어두운 구멍과 옅은 테. 앞면 벽 데칼
       (wallDiscPath)이라 요잉과 함께 돌고, 뒤에선 몸에 가려 안 그린다. */
    ...(facingRatio(0, 1) > -0.05
      ? ((): ShapeFace[] => {
        const k = Math.min(1, (facingRatio(0, 1) + 0.05) / 0.4);
        // 제 깊이(재지적: 안 보임) — 함교 키에 묻어 머리 상자가 홈을 덮었다.
        return tagKey([
          topFace(wallDiscPath(0, 4.72, 6.2, 0.6, 0.5), 0.18 * k),
          capFace(wallDiscPath(0, 4.72, 6.2, 0.42, 0.34), 0.5 * k),
        ], depthNow(0, 4.75) + 1.5);
      })()
      : []),
  ],
  /* 발키리(실물 참고) — 뭉툭한 큰 몸통에 둥근 코, 지붕의 미사일 튜브 다발 두 줄,
     양옆의 납작한 판 날개, 뒤 엔진 블록. */
  valk: () => {
    const plate = (m2: 1 | -1): string => polyPath3([
      [m2 * 1.6, 0.8, 5.6], [m2 * 3.6, 0.2, 5.4], [m2 * 3.4, -1.8, 5.5], [m2 * 1.6, -1.2, 5.7],
    ]);
    /* (삭제·지적: 튜브 코가 요잉을 안 먹는다) — groundEllipse는 바닥에 눕힌 원이라
       화면 고정 타원이었다. 관 자체가 capOpen으로 제 끝 단면을 그린다(아래). */
    return [
      // 날개만 빼고 전체 은색(요청).
      ...paintBase(boxFaces3(0, -2.3, 2.2, 1, 1.5, 5.3), "#c9ced6"),
      bodyFace(plate(1)), sideFace(plate(1), 0.2),
      bodyFace(plate(-1)), topFace(plate(-1), 0.14),
      ...paintBase(boxFaces3(0, -0.4, 2.8, 3.8, 2.2, 5), "#c9ced6"),
      /* 코(재재지적: 경사 네 면의 보임) — 면을 고정으로 그려서 왼 면이 아예 없고 오른
         면은 어느 각에서나 남았다. 앞·좌·우 기운 면을 faceLight로 판정해 보이는 면만
         제 밑칠과 음영으로 그린다. 윗면은 내려다보는 카메라라 늘 보인다. */
      ...tagKey((() => {
        const top = polyPath3([[-1.35, 1, 6.05], [1.35, 1, 6.05], [0.75, 3, 5.9], [-0.75, 3, 5.9]]);
        const nose: ShapeFace[] = [bodyFace(top), topFace(top, 0.18)];
        const sides: [number, number, [number, number, number][]][] = [
          [0, 1, [[-0.75, 3, 5.9], [0.75, 3, 5.9], [0.75, 3, 5], [-0.75, 3, 5]]],
          [0.96, 0.29, [[1.35, 1, 6.05], [0.75, 3, 5.9], [0.75, 3, 5], [1.35, 1, 5]]],
          [-0.96, 0.29, [[-1.35, 1, 6.05], [-0.75, 3, 5.9], [-0.75, 3, 5], [-1.35, 1, 5]]],
        ];
        for (const [nx, ny, pts] of sides) {
          const { visible, face } = faceLight(nx, ny);
          if (!visible) continue;
          const d = polyPath3(pts);
          nose.push(bodyFace(d), ...face(d));
        }
        return paintBase(nose, "#c9ced6");
      })(), depthNow(0, 2.1) + 0.9),
      ...tagKey([
        capFace(polyPath3([[-1.15, 1.35, 7.5], [1.15, 1.35, 7.5], [1.05, 1.75, 6.85], [-1.05, 1.75, 6.85]]), 0.45),
        topFace(polyPath3([[-0.95, 1.42, 7.35], [-0.1, 1.42, 7.35], [-0.18, 1.66, 6.98], [-0.9, 1.66, 6.98]]), 0.3),
      ], depthNow(0, 1.55) + 1.1),
      /* 지붕 미사일 튜브 다발 — 지붕 띠 키(재지적: 콕핏·코 데칼이 위에 씻겨 투명해
         보임): 몸 위 얹힘이라 어느 각에서도 몸·데칼 뒤로 안 간다. */
      ...tagKey([
        ...paintBase(tubeFaces(-0.7, -1.7, -0.7, 0.9, 0.5, 7.2, true), "#c9ced6"),
      ], 20 + depthNow(-0.7, -0.4)),
      ...tagKey([
        ...paintBase(tubeFaces(0.7, -1.7, 0.7, 0.9, 0.5, 7.2, true), "#c9ced6"),
      ], 20 + depthNow(0.7, -0.4)),
    ];
  },
  /* 사이언스 베슬(정정) — 구 몸통 아래에 구형 추진기 세 개가 달린다. */
  vessel: () => {
    /* 재설계(요청) — 창문 제거, 구는 살짝 줄이고, 구를 옆에서 감싸는 은색 껍질 방패
       셋(120도 간격), 그 사이사이(60도 오프셋)에 추진체 돔. 방패는 모델 각도를
       투영해 요잉을 따라 돈다. */
    const [bx, by] = project(0, 0, 6.4);
    const out: ShapeFace[] = [];
    // 추진체 — 방패 사이 자리(30·150·270도).
    /* 납작한 접시로(재지적) — 키 큰 돔 대신 살짝 도톰한 원반, 크기도 축소(1.3→1.1). */
    for (const ang of [30, 150, 270]) {
      const a2 = (ang * Math.PI) / 180;
      const px5 = Math.sin(a2) * 3.2;
      const py5 = Math.cos(a2) * 3.2;
      out.push(...tagKey([
        ...domeFaces3(px5, py5, 1.1, 0.38, 5.7),
        topFace(discPath3(px5, py5, 6.06, 0.62), 0.22),
      ], depthNow(px5, py5)));
    }
    // 구 몸통 — 한 단 더 축소(3.3 → 2.7, 재지적) + 그늘 초승달 + 하이라이트.
    out.push(...tagKey([
      // 구체 짙은 은색(요청).
      [groundEllipse(bx, by, 2.7, 2.58), 1, "#9ba3ad"] as ShapeFace,
      sideFace(`M${bx + 1.05} ${by - 2.3} A2.6 2.5 0 0 1 ${bx + 1.05} ${by + 2.3}`
        + ` A3.8 3.7 0 0 0 ${bx + 1.05} ${by - 2.3} Z`, 0.16),
      topFace(groundEllipse(bx - 0.9, by - 1, 1.2, 1), 0.28),
    ], 0));
    // 껍질 방패 셋(90·210·330도) — 은색 렌즈꼴 판이 구를 옆에서 감싼다.
    /* 방패 셋(재재재지적: 캐리어 꽃잎 한 장처럼 굽히기) — 점 고리를 모델 공간에서
       구면에 감아 만든다: 세로(z)로 길고 폭은 얇으며, 위아래 끝일수록 반경이 안으로
       당겨져 구를 감싸 안는 꽃잎 판이 된다. */
    for (const ang of [90, 210, 330]) {
      const a2 = (ang * Math.PI) / 180;
      const dxs = Math.sin(a2);
      const dys = Math.cos(a2);
      const txs = -dys;
      const tys = dxs;
      const pts: [number, number, number][] = Array.from({ length: 12 }, (_, i) => {
        const th = (i / 12) * Math.PI * 2;
        const v = Math.sin(th) * 2.1;
        const l = Math.cos(th) * 0.78;
        const rad = 3.35 - 0.95 * Math.sin(th) * Math.sin(th);
        return [dxs * rad + txs * l, dys * rad + tys * l, 6.4 + v] as [number, number, number];
      });
      const d = polyPath3(pts);
      out.push(...tagKey([
        [d, 1, "#c9ced6"] as ShapeFace,
        sideFace(d, 0.14),
      ], depthNow(dxs * 3.35, dys * 3.35)));
    }
    return zsorted(out);
  },
  /* 뮤탈리스크(정정) — 날개는 위에 달리고, 긴 몸통이 앞-아래로 휘어 입이 아래로 나온다. */
  muta: () => {
    /* 날개 더 크게 + 두 번 꺾이게(요청) — 스팬 방향 마디 네 곳(뿌리→관절1 위로→
       관절2 아래로→끝 위로)을 앞뒤 폭 있는 판 세 장으로 잇는다. */
    /* 서양 용 날개(요청) — 앞 가장자리를 따라 굽은 팔뼈가 서고, 그 뒤로 손가락뼈
       사이가 오목하게 파인 막이 늘어진다. 뼈·막 모두 모델 공간이라 요잉을 함께 탄다. */
    const wing = (m2: 1 | -1): ShapeFace[] => {
      const P = (x: number, y: number, z: number): [number, number, number] => [m2 * x, y, z];
      // 팔뼈 마디 — 어깨에서 위·밖으로 굽어 오른다.
      const b0 = P(0.25, 0.55, 6.9);
      const b1 = P(2.1, 1.05, 8.8);
      const b2 = P(4.3, 0.55, 9.9);
      // 막 — 손가락 끝 셋과 그 사이 오목한 골.
      const web = polyPath3([
        b0, b1, b2,
        P(4.55, -1.5, 9.1), P(3.35, -0.85, 8.6),
        P(3.05, -2.4, 8), P(2.05, -1.15, 7.5),
        P(1.5, -2.45, 6.9), P(0.55, -0.95, 6.6),
        P(0.2, -0.5, 6.6),
      ]);
      return [
        bodyFace(web), m2 > 0 ? sideFace(web, 0.18) : topFace(web, 0.12),
        // 팔뼈·손가락뼈는 막보다 살짝 밝게.
        ...rodFaces(b0[0], b0[1], b0[2], b1[0], b1[1], b1[2], 0.3),
        ...rodFaces(b1[0], b1[1], b1[2], b2[0], b2[1], b2[2], 0.26),
        ...hornFaces(b1[0], b1[1], b1[2], m2 * 3.05, -2.4, 8, 0.2),
        ...hornFaces(b2[0], b2[1], b2[2], m2 * 4.55, -1.5, 9.1, 0.18),
      ];
    };
    return [
      /* 몸통은 머리 반구까지 한 기둥으로(재지적) — 굵은 머리 끝에서 가늘고 뭉뚝한
         꼬리 끝까지 하나의 스파이어. 아래(꼬리)로 갈수록 앞으로 급히 휘고 위(머리)
         쪽은 완만하다: y' = leanY + 2·curveY·t 이므로 leanY를 크게, curveY를 그
         절반만큼 반대로 준다. 기둥은 아래에서 위로 자라니 '꼬리 끝 → 머리' 순이다. */
      ...tagKey(spirePillar({
        /* 휨을 더 크게(재지적) — 꽁무니가 거의 45도로 앞을 본다: 아래 구간의 기울기
           |y'| ≈ z 증가량과 비슷해야 45도다(h 3.6에 leanY -4.2, curveY 2.1). */
        // 굵기는 급히 줄지 않고 살짝만 — 꼬리 0.72 → 머리 1.05.
        x: 0, y: 2.2, z0: 3.3, h: 3.6, w: 0.72, tipW: 1.05,
        segs: 6, sides: 8, hold: 0,
        leanY: -4.2, curveY: 2.1,
        fill: "#6b4732",
      }), 12),
      // 날개 — 위에서 펼쳐진다. 몸통 마디(키 10~18)보다 위(지적: 날개가 가려짐).
      ...tagKey(wing(1), 24),
      ...tagKey(wing(-1), 24),
    ];
  },
  /* 가디언(지적: 꽃게 모양) — 옆으로 넓적한 게딱지 + 앞 양 집게 + 옆 잔다리. */
  guardian: () => [
    // 게딱지 양옆 회백색(요청).
    ...paintBase(domeFaces3(-1.2, -0.4, 1.7, 1.1, 5.7), "#d3d7db"),
    ...paintBase(domeFaces3(1.2, -0.4, 1.7, 1.1, 5.7), "#d3d7db"),
    ...domeFaces3(0, -0.2, 2.1, 1.4, 5.6),
    // 앞 양 집게 — 두 마디로 안쪽으로 굽는다. 짙은 갈색(재지적: 앞다리도).
    ...paintBase(hornFaces(1.9, 0.8, 5.9, 3, 2.2, 5.6, 0.7), "#6b4732"),
    ...paintBase(hornFaces(3, 2.2, 5.6, 2.2, 3.2, 5.4, 0.5), "#6b4732"),
    ...paintBase(hornFaces(-1.9, 0.8, 5.9, -3, 2.2, 5.6, 0.7), "#6b4732"),
    ...paintBase(hornFaces(-3, 2.2, 5.6, -2.2, 3.2, 5.4, 0.5), "#6b4732"),
    // 옆 잔다리 — 짙은 갈색(요청).
    ...paintBase(hornFaces(2.4, -0.6, 5.7, 3.6, -1.2, 5, 0.45), "#6b4732"),
    ...paintBase(hornFaces(-2.4, -0.6, 5.7, -3.6, -1.2, 5, 0.45), "#6b4732"),
    ...paintBase(hornFaces(2.2, -1.4, 5.7, 3.2, -2.2, 5, 0.45), "#6b4732"),
    ...paintBase(hornFaces(-2.2, -1.4, 5.7, -3.2, -2.2, 5, 0.45), "#6b4732"),
  ],
  /* 디바우러(실물 참고) — 판갑으로 덮인 큰 공 몸통, 그 아래로 골진 배가 앞으로 말려
     들어가고, 앞 옆에서 흰 뿔 한 쌍이 위로 젖혀진다. */
  devourer: () => [
    /* 디바우러(재지적) — 머리통은 큰 반구 하나로 되돌리고, 그 뒤쪽 끝에서 아래로
       마디들이 리버처럼 겹비늘로 이어진다(앞 마디가 뒤를 덮는 고정 키). */
    /* 아래 몸통은 뮤탈처럼 스파이어 기둥 한 몸으로(요청) — 머리 반구 바닥 뒤끝에서
       시작해 아래로 내려가며 앞으로 급히 휘고, 끝은 뭉뚝하다. 짙은 갈색.
       기둥은 아래에서 위로 자라니 '꼬리 끝 → 반구 밑' 순으로 정의한다. */
    /* 더 길고 끝이 더 좁게(요청) — 꼬리 끝 굵기를 1.25 → 0.62로 줄이고, taper를 1
       아래로 내려 가는 굵기가 오래 이어지다 머리 쪽에서 확 벌어지게 한다. */
    ...tagKey(spirePillar({
      /* 방향을 뒤집는다(재재지적: 뒤로 보내라는데 자꾸 서기만 한다) — 여태 꼬리 끝이
         머리보다 앞(+y)에 있어서, 아무리 눕히는 몫을 줄여도 '앞에 선 기둥'이었다.
         꼬리 끝을 머리 뒤(-y 3.2)로 옮기고 위로 갈수록 앞으로 나와 머리 뒤꽁무니에
         물리게 한다 — 이제 몸통 전체가 머리 뒤에 눕는다. */
      /* 위 끝 단면이 머리 반구 바닥과 딱 수평으로 맞물리게(요청) — 기둥의 단면은
         축의 접선에 수직이라, 끝에서 접선이 곧게 서야 단면이 수평이 된다. lean·curve
         조합으로는 끝 접선이 늘 기울어 있으므로 축을 직접 그린다: y는 t=1에서
         기울기가 0인 곡선(1-(1-t)^2)이라 꼭대기에서 수직으로 서고, 그 자리가 반구
         바닥 중심(0, 0.2, 4.3)이다. */
      x: 0, y: 0, h: 1, w: 0.62, tipW: 2.05,
      segs: 9, sides: 8, hold: 0, taper: 0.68,
      /* 180도 요잉(요청) — 머리 밑 물림점(y 0.2)을 축으로 뒤집는다: 꼬리 끝이 뒤가
         아니라 앞(1.8)으로 나오고 휨도 함께 돌아간다. 끝 기울기가 0인 성질은 그대로라
         위 단면은 여전히 수평이다. */
      path: (t9: number): [number, number, number] => [
        0, 1.8 - 1.6 * (1 - (1 - t9) ** 2), 0.3 + 4 * t9,
      ],
      fill: "#6b4732",
    }), 12),
    // 머리통 — 큰 반구. 개인색(요청), 기둥보다 앞·위.
    ...tagKey(domeFaces3(0, 0.2, 2.3, 2.1, 4.3), 18),
    /* 머리 앞의 동그란 얼굴 — 반구 앞면에 쏙 박힌 구. */
    ...tagKey([
      // 얼굴을 좀더 아래로(요청) — 5.1 → 4.5.
      [groundEllipse(...project(0, 1.9, 4.5), 0.95, 0.95), 1, "#4a3428"] as ShapeFace,
      topFace(groundEllipse(...project(-0.3, 1.65, 4.8), 0.34, 0.34), 0.22),
      /* 얼굴도 앞뒤를 탄다(재지적: 아예 안 가려짐) — 붙박이 맨 윗 키를 걷고 머리
         반구(18) 기준 제 자리 깊이를 얹는다: 앞을 보면 반구 위, 뒤로 돌면 반구 뒤다. */
    ], 18 + depthNow(0, 1.9) * 1.6),
    // (삭제·지적) 몸통을 세로로 가로지르던 철사 같은 등판 이음선.
    /* 뿔·턱은 머리 반구(키 18) 위로(지적: 머리통에 가려짐) — 반구가 붙박이 큰 키를
       쓰므로 뿔도 그보다 큰 키를 달아야 어느 각도에서도 안 묻힌다. */
    ...([1, -1] as const).flatMap((m9) => tagKey(paintBase(
      hornFaces(m9 * 1.35, 0.8, 5.4, m9 * 2.4, -1, 7.6, 0.6), IVORY_DEEP,
    ), 18 + depthNow(m9 * 1.9, -0.1) * 1.6)),
    /* 얼굴 밑에 있던 작은 가시 한 쌍은 몸통 끝으로(요청) — 꼬리 끝(0, 2.7, 0.3)에서
       앞·아래로 짧게 뻗는다. */
    ...tagKey(paintBase([
      ...hornFaces(0.3, 1.65, 0.85, 0.62, 2.55, 0.35, 0.32),
      ...hornFaces(-0.3, 1.65, 0.85, -0.62, 2.55, 0.35, 0.32),
    ], IVORY_DEEP), 13),
  ],
  /* 스커지 — 작은 몸 + 날개 한 쌍. */
  scourge: () => {
    const wing = (m: 1 | -1): string => polyPath3([
      [m * 0.5, 0.2, 6.3], [m * 2, 1.2, 6], [m * 1.4, -0.6, 6.1],
    ]);
    return [
      ...domeFaces3(0, 0, 0.75, 0.65, 5.9),
      // 날개는 드론 갈퀴 색(요청).
      [wing(1), 1, "#c68a62"] as ShapeFace, sideFace(wing(1), 0.16),
      [wing(-1), 1, "#c68a62"] as ShapeFace, topFace(wing(-1), 0.14),
    ];
  },
  /* 퀸(정정 셋) — 더듬이 없이, 전갈처럼 위로 솟아 앞으로 휘는 꼬리. 다리 여섯은
     60도 간격으로 골고루 퍼지되 너무 처지지 않고, 다리 끝까지 갈퀴막이 이어진다. */
  queen: () => {
    const P = (ang: number, r: number): [number, number] => {
      const a = (ang * Math.PI) / 180;
      return [Math.sin(a) * r, Math.cos(a) * r];
    };
    /* 앞부분을 45도쯤 든다(요청: 핀칭) — 앞(+y)으로 갈수록 z를 같은 비율로 올린다.
       몸통·머리는 위치만 올리면 기운 것으로 안 보이므로(지적), 회전 대칭 돔을 걷고
       기운 축을 따라 자라는 기둥으로 세운다. 축이 45도면 몸 자체가 기운다. */
    const PT = (y9: number): number => y9;
    /* 키는 한 자로 잰다(지적: 키값 재수정) — 몸통을 0으로 두고 나머지는 제 자리
       깊이 × 1.6. 앞으로 돈 부품은 몸 위로, 뒤로 돈 부품은 몸 뒤로 저절로 갈린다.
       머리·집게는 몸 앞에 얹히므로 한 단씩 더 올린다. */
    const out: ShapeFace[] = [];
    // 갈퀴막 — 이웃 다리 끝까지 잇는 여섯 폭 치마.
    for (let i = 0; i < 6; i += 1) {
      const a1 = i * 60 + 30;
      const [x1, y1] = P(a1, 1.2);
      const [t1x, t1y] = P(a1, 2.4);
      const [x2, y2] = P(a1 + 60, 1.2);
      const [t2x, t2y] = P(a1 + 60, 2.4);
      out.push(...membraneFaces(
        [[x1, y1, 5.1 + PT(y1)], [x2, y2, 5.1 + PT(y2)]],
        [[t1x, t1y, 4.05 + PT(t1y)], [t2x, t2y, 4.05 + PT(t2y)]],
        "#c68a62",
        { shade: 0.15, notch: 0.26, key: depthNow((t1x + t2x) / 2, (t1y + t2y) / 2) * 1.6 },
      ));
    }
    // 다리 여섯 — 막의 뼈대.
    for (let i = 0; i < 6; i += 1) {
      const [x1, y1] = P(i * 60 + 30, 1.2);
      const [t1x, t1y] = P(i * 60 + 30, 2.45);
      // 다리 짙은 갈색(재지적).
      out.push(...tagKey(paintBase(
        hornFaces(x1, y1, 5.2 + PT(y1), t1x, t1y, 4 + PT(t1y), 0.65), "#6b4732",
      ), depthNow(t1x, t1y) * 1.6));
    }
    /* 몸통 — 45도로 기운 축을 따라 자라는 기둥. 뒤가 가늘고 앞으로 갈수록 굵어져
       기운 알 모양이 된다(지적: 몸통·머리가 피칭이 안 됨). 개인색. */
    out.push(...tagKey(spirePillar({
      x: 0, y: 0, h: 1, w: 1.15, tipW: 1.95, segs: 6, sides: 12, hold: 0, taper: 0.8,
      path: (t9: number): [number, number, number] => {
        const y9 = -2.6 + 3 * t9;
        return [0, y9, 5.3 + PT(y9)];
      },
    }), 0));
    /* 머리 — 몸통과 같은 기울기로 앞에 이어 붙는 짧은 기둥. 짙은 갈색. */
    out.push(...tagKey(paintBase(spirePillar({
      x: 0, y: 0, h: 1, w: 1.75, tipW: 0.5, segs: 4, sides: 12, hold: 0.1, taper: 1.4,
      path: (t9: number): [number, number, number] => {
        const y9 = 0.4 + 1.5 * t9;
        return [0, y9, 5.3 + PT(y9)];
      },
    }), "#6b4732"), depthNow(0, 1.2) * 1.6 + 2));
    // 큰 집게 한 쌍 — 앞팔 짙은 갈색(요청). 몸 앞에 얹히므로 한 단 더 위.
    for (const m9 of [1, -1] as const) {
      out.push(...tagKey(paintBase([
        ...hornFaces(m9 * 1.3, 1, 5.8 + PT(1), m9 * 2.6, 2.2, 5.6 + PT(2.2), 0.95),
        ...hornFaces(m9 * 2.6, 2.2, 5.6 + PT(2.2), m9 * 1.9, 3.5, 5.2 + PT(3.5), 0.7),
      ], "#6b4732"), depthNow(m9 * 2.2, 2.2) * 1.6 + 3));
    }
    return out;
  },

  /* 커세어(정정) — 몸통을 줄이고, 양팔과 아래 꼬리 포드가 모두 앞을 향해 뻗는 느낌. */
  corsair: () => {
    const [e1x, e1y] = project(-0.85, -1.5, 5.6);
    const [e2x, e2y] = project(0.85, -1.5, 5.6);
    return [
      // 각진 방패 몸 — 또 한 단 작게(재지적: 몸통 크기 축소).
      bodyFace(polyPath3([
        [0, 1.75, 5.9], [1.35, 0.85, 5.95], [1.7, -0.6, 5.85], [0.75, -1.45, 5.8],
        [-0.75, -1.45, 5.8], [-1.7, -0.6, 5.85], [-1.35, 0.85, 5.95],
      ])),
      topFace(polyPath3([[0, 1.75, 5.9], [-1.35, 0.85, 5.95], [-0.9, -0.25, 5.9], [0, 0.25, 5.92]]), 0.18),
      sideFace(polyPath3([[0, 1.75, 5.9], [1.35, 0.85, 5.95], [1.7, -0.6, 5.85], [0.7, -0.12, 5.9]]), 0.18),
      /* 양팔(재지적: 포신보다 완만하게 휜 가시 느낌) — 밖으로 벌었다가 앞으로 모이는
         두 마디 곡선 가시. */
      // 세 팔 금색(요청) — 양팔.
      ...paintBase(hornFaces(1.5, -0.6, 5.9, 2.5, 1.3, 5.7, 0.6), "#d4af37"),
      ...paintBase(hornFaces(2.5, 1.3, 5.7, 2.1, 3.3, 5.5, 0.36), "#d4af37"),
      ...paintBase(hornFaces(-1.5, -0.6, 5.9, -2.5, 1.3, 5.7, 0.6), "#d4af37"),
      ...paintBase(hornFaces(-2.5, 1.3, 5.7, -2.1, 3.3, 5.5, 0.36), "#d4af37"),
      /* 하단 팔 하나(재보정: 아래 75도로 붙는다) — 몸 밑에서 가파르게 아래·앞으로
         떨어졌다가 끝이 팔처럼 위로 말린다. */
      // 하단 팔도 금색(요청: 세 팔).
      ...paintBase(hornFaces(0, -0.2, 5.4, 0, 0.6, 2.6, 0.5), "#d4af37"),
      ...paintBase(hornFaces(0, 0.6, 2.6, 0, 1.7, 3.3, 0.3), "#d4af37"),
      // 콕핏 혹.
      ...domeFaces3(0, 0.4, 0.7, 0.55, 6.05),
      // 뒤 발광 엔진 둘.
      topFace(groundEllipse(e1x, e1y, 0.45, 0.36), 0.5),
      topFace(groundEllipse(e2x, e2y, 0.45, 0.36), 0.5),
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
      // 날개만 빼고 금색(재지적: 은색→금색).
      ...paintBase(tubeFaces(-0.55, -3.1, -0.55, -2, 0.3, 5.9), "#d4af37"),
      ...paintBase(tubeFaces(0.55, -3.1, 0.55, -2, 0.3, 5.9), "#d4af37"),
      bodyFace(wingL), topFace(wingL, 0.16),
      bodyFace(wingR), sideFace(wingR, 0.18),
      [hull, 1, "#d4af37"] as ShapeFace, topFace(hull, 0.16),
      ...paintBase(domeFaces3(0, 0.9, 0.6, 0.5, 6.3), "#bfe0ef"), // 조종석 유리색(요청)
    ];
  },
  /* 캐리어(정정 둘: 옆 잎 등의 방향) — 옆 두 장은 안 가장자리가 아래로 처져 등이
     '아래'를 향하고(지적: 위가 아니라 아래), 위 꽃잎은 양 가장자리가 처져 등이 위로
     아치를 그린다. */
  carrier: () => {
    const petalPts = (
      cx2: number, m2: 0 | 1 | -1, z0: number, xr: number, yr: number,
    ): [number, number, number][] => Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      const co = Math.cos(a);
      return [
        cx2 + co * xr,
        0.3 + Math.sin(a) * yr,
        z0 - Math.sin(a) * 0.28
          + (m2 !== 0 ? -Math.max(0, -m2 * co) * 1.35 : -Math.abs(co) * 0.55),
      ] as [number, number, number];
    });
    const petal = (cx2: number, m2: 0 | 1 | -1, z0: number, xr: number, yr: number): string =>
      polyPath3(petalPts(cx2, m2, z0, xr, yr));
    /* 볼록 렌즈형(재재정정: 두께도) — 잎마다 세 겹이다: 아래로 볼록한 밑쉘(줄인
       판을 한 단 내려 깐다, 아래 두께가 실루엣 밖으로 살짝 비친다) + 본판(가장자리)
       + 위로 볼록한 윗판. 가장자리는 얇고 가운데가 위아래로 부푼 렌즈가 된다. */
    const lens = (
      cx2: number, m2: 0 | 1 | -1, z0: number, xr: number, yr: number,
      shade: "L" | "R" | "T",
    ): ShapeFace[] => {
      // 밑쉘은 본판과 거의 같은 윤곽(재지적: 두 장 판으로 보임 — 가장자리를 붙인다).
      const shellPts = petalPts(cx2, m2, z0 - 0.38, xr * 0.97, yr * 0.97);
      const mainPts = petalPts(cx2, m2, z0, xr, yr);
      const faces: ShapeFace[] = [
        bodyFace(polyPath3(shellPts)),
        sideFace(polyPath3(shellPts), 0.24),
      ];
      /* 옆면 봉합(지적: 판 사이가 떠 보임) — 밑쉘과 본판의 대응 점들을 네모 띠로
         이어 렌즈 테두리 옆구리를 채운다. */
      for (let i = 0; i < 12; i += 1) {
        const j = (i + 1) % 12;
        faces.push(bodyFace(polyPath3([shellPts[i], shellPts[j], mainPts[j], mainPts[i]])));
      }
      const main = polyPath3(mainPts);
      faces.push(
        bodyFace(main),
        shade === "L" ? topFace(main, 0.16)
          : shade === "R" ? sideFace(main, 0.18) : topFace(main, 0.1),
        topFace(petal(cx2, m2, z0 + 0.45, xr * 0.62, yr * 0.6), shade === "T" ? 0.15 : 0.12),
      );
      return faces;
    };
    return [
      // 세 잎 다 금색(재지적) — 잎마다 겉 가운데에 개인색을 은은히 얹는다.
      // 개인색 장식은 윗잎에만(재재재지적) — 옆 두 잎은 순금색.
      ...paintBase(lens(-1.3, -1, 5.1, 1.05, 3.9, "L"), "#d4af37"),
      ...paintBase(lens(1.3, 1, 5.1, 1.05, 3.9, "R"), "#d4af37"),
      ...paintBase(lens(0, 0, 6.5, 1.05, 4.1, "T"), "#d4af37"),
      [petal(0, 0, 7.02, 0.55, 2.05), 0.4] as ShapeFace,
    ];
  },
  /* 아비터(재정정: 날개는 지면과 수직으로 몸에 붙고, 특히 앞쪽에 두께감) — 수평으로
     떠 있던 타원 두 장을 세로 판으로 세웠다: 안판·바깥판 사이를 앞·윗변 두께 띠가
     잇는 얇은 방패 날개가 몸통 옆구리에 선다. */
  arbiter: () => {
    const wing = (m2: 1 | -1): ShapeFace[] => {
      /* 한 덩이 유선형(재재정정: 앞판·꼬리 뿔로 갈라 보이지 않게) — 두께가 코에서
         좁고 가운데서 불룩하다가 꼬리 한 점으로 모이는 방추형. 안·바깥 두 판이
         코와 꼬리를 공유하고 위 등마루 띠가 잇는다 — 하나의 몸으로 읽힌다. */
      const prof: [number, number, number][] = [ // [y, z, 두께 비율]
        [2.3, 6.05, 0.45], [1.1, 6.62, 1], [-0.9, 6.55, 0.85], [-3.6, 5.95, 0],
        [-0.9, 5.35, 0.85], [1.1, 5.22, 1], [2.45, 5.6, 0.45],
      ];
      const half = 0.3;
      const at = (side: 1 | -1): string => polyPath3(
        prof.map(([y, z, k]) => [m2 * (1.3 + side * half * k), y, z] as [number, number, number]));
      const upperIn = prof.slice(0, 4)
        .map(([y, z, k]) => [m2 * (1.3 - half * k), y, z] as [number, number, number]);
      const upperOut = prof.slice(0, 4).reverse()
        .map(([y, z, k]) => [m2 * (1.3 + half * k), y, z] as [number, number, number]);
      const ridge = polyPath3([...upperIn, ...upperOut]);
      /* 옆면 봉합(지적: 판 사이가 떠 보임) — 등마루 띠만 있고 배·앞 변은 안·바깥 판
         사이가 뚫려 있었다. 아랫변(꼬리→앞 아래)과 앞변(앞 아래→앞 위)도 띠로 잇는다. */
      const lowerIn = prof.slice(3)
        .map(([y, z, k]) => [m2 * (1.3 - half * k), y, z] as [number, number, number]);
      const lowerOut = prof.slice(3).reverse()
        .map(([y, z, k]) => [m2 * (1.3 + half * k), y, z] as [number, number, number]);
      const belly = polyPath3([...lowerIn, ...lowerOut]);
      const frontIO = ([y, z, k]: [number, number, number], side: 1 | -1):
      [number, number, number] => [m2 * (1.3 + side * half * k), y, z];
      const front = polyPath3([
        frontIO(prof[6], -1), frontIO(prof[0], -1), frontIO(prof[0], 1), frontIO(prof[6], 1),
      ]);
      // 날개 금색(요청).
      return tagKey(
        paintBase([
          bodyFace(at(-1)),
          bodyFace(ridge), topFace(ridge, 0.18),
          bodyFace(belly), sideFace(belly, 0.2),
          bodyFace(front),
          bodyFace(at(1)),
          m2 === 1 ? sideFace(at(1), 0.16) : topFace(at(1), 0.12),
        ], "#d4af37"),
        /* 날개 키(재지적: 각도에 따라 몸체에 가려짐) — 몸 돔은 depthNow에 반지름
           보정(+1.2)이 붙어 늘 앞섰다. 날개도 같은 보정을 얹고 중심을 몸 앞쪽으로
           잡아, 옆에서는 좌우가 제대로 갈리고 정면에서는 몸에 안 묻힌다. */
        depthNow(m2 * 1.3, 0.5) + 1.35,
      );
    };
    const [cx2, cy2] = project(0, 1.9, 5.7);
    return [
      ...wing(-1),
      ...wing(1),
      /* 몸체는 구 — 지붕 키(20)는 뒤에서도 몸이 이겨 '안 가려짐'이 됐다(재지적).
         날개 키를 무게중심으로 옮기고 몸은 제 깊이로: 앞에선 몸이, 뒤에선 날개가 이긴다. */
      ...domeFaces3(0, 0.5, 1.35, 1.2, 5.2),
      topFace(groundEllipse(cx2 - 0.3, cy2 - 0.5, 0.4, 0.32), 0.35),
    ];
  },
  /* 옵저버(실물 참고) — 작은 금빛 공 몸통 좌우에 둥근 귀 덩이, 위엔 부챗살 볏 돛,
     앞엔 렌즈 고리. */
  observer: () => {
    const [lx2, ly2] = project(0, 1.05, 5.95);
    return [
      // 좌우 귀 덩이.
      ...domeFaces3(-1.15, -0.3, 0.62, 0.55, 5.55),
      ...domeFaces3(1.15, -0.3, 0.62, 0.55, 5.55),
      /* 완전 구형 몸통(요청) — 중심만 투영하고 가로세로 같은 원이라 어느 시점에서도
         안 눌린다(소환구와 같은 규칙). */
      // 몸통 공만 금색(요청: 양팔·머리 장식 제외).
      [groundEllipse(...project(0, 0, 6), 1.05, 1.05), 1, "#d4af37"] as ShapeFace,
      topFace(groundEllipse(...project(-0.35, -0.3, 6.35), 0.4, 0.34), 0.25),
      /* 위 부챗살 볏 돛(재지적: 부채가 안 돎) — 화면 고정 반원 대신 앞뒤(y)·위(z)
         축의 투영으로 세운 세로 반원이라 요잉을 타고 옆에선 얇아진다. */
      ...((): ShapeFace[] => {
        const c = project(0, -0.3, 6.9);
        const u = project(0, 0.7, 6.9);
        const v = project(0, -0.3, 7.85);
        const ux2 = u[0] - c[0];
        const uy2 = u[1] - c[1];
        const vx2 = v[0] - c[0];
        const vy2 = v[1] - c[1];
        const pt2 = (t: number, k = 1): string =>
          `${c[0] + (ux2 * Math.cos(t) + vx2 * Math.sin(t)) * k} ${c[1] + (uy2 * Math.cos(t) + vy2 * Math.sin(t)) * k}`;
        let d = `M${pt2(Math.PI)}`;
        for (let i = 1; i <= 8; i += 1) d += ` L${pt2(Math.PI - (i / 8) * Math.PI)}`;
        d += " Z";
        const spoke = (t: number): string => `M${pt2(t, 0.12)} L${pt2(t - 0.1)} L${pt2(t + 0.04)} Z`;
        return tagKey(
          [bodyFace(d), sideFace(spoke(1.1), 0.2), sideFace(spoke(2.1), 0.2)],
          depthNow(0, -0.3) + 0.6,
        );
      })(),
      // 앞 렌즈 — 반투명 연한 사이언색(요청).
      [groundEllipse(lx2, ly2, 0.42, 0.36), 0.6, "#a9ecf2"] as ShapeFace,
      topFace(groundEllipse(lx2 - 0.1, ly2 - 0.1, 0.15, 0.12), 0.4),
    ];
  },
  /* 컴샛 스테이션(재모델링·사진) — 낮고 각진 선체 위에 큰 접시 안테나가 기둥으로
     서고, 옆구리에 초록 발광 띠가 줄지어 박힌다. 뒤 왼쪽엔 노랑·검정 경고 블록,
     앞·오른쪽 바닥엔 녹슨 주황 테를 두른 넓은 원반 패드 둘. */
  comsat: () => {
    const out: ShapeFace[] = [
      // 받침 슬래브는 중심 깊이만(지적: 애드온 바닥이 위 부품을 덮음).
      ...tagKey(boxFaces3(0, 0.2, 5.6, 4.4, 0.9), depthNow(0, 0.2)),
    ];
    /* 바닥 원반 패드 둘(사진) — 녹슨 주황 테를 두른 낮은 원반. 받침 바로 위. */
    for (const [px, py, pr] of [[-1.5, 1.5, 1.9], [1.9, 0.4, 1.5]] as [number, number, number][]) {
      out.push(...tagKey([
        ...paintBase(cylinderFaces3(px, py, pr, 0.55, 0.9), "#b5652c"),
        ...paintBase(cylinderFaces3(px, py, pr * 0.78, 0.2, 1.45), "#8b8f96"),
        capFace(discPath3(px, py, 1.66, pr * 0.62), 0.25),
      ], 22 + depthNow(px, py)));
    }
    /* 각진 선체 — 위로 갈수록 좁아지는 사다리꼴 통. 옆구리에 초록 발광 띠. */
    out.push(...tagKey(paintBase(
      frustumFaces3(-0.4, -0.5, 3.6, 2.8, 2.6, 1.9, 1.5, 1.45), "#7b8088",
    ), 24 + depthNow(-0.4, -0.5)));
    if (facingRatio(0, 1) > 0.12) {
      const led: ShapeFace[] = [];
      for (const lx of [-1.2, -0.4, 0.4]) {
        led.push([polyPath3([
          [lx - 0.26, 0.82, 1.9], [lx + 0.26, 0.82, 1.9],
          [lx + 0.26, 0.82, 2.5], [lx - 0.26, 0.82, 2.5],
        ]), 1, "#4cd86a"] as ShapeFace);
      }
      out.push(...tagKey(led, 25 + depthNow(-0.4, 0.9)));
    }
    /* 뒤 왼쪽 노랑·검정 경고 블록(사진) — 선체 뒤에 붙은 빗금 상자. */
    out.push(...tagKey(paintBase(boxFaces3(-1.9, -1.9, 1.9, 1.3, 1.5, 0.9), "#22262b"),
      24 + depthNow(-1.9, -1.9)));
    if (facingRatio(0, 1) > 0.1) {
      const warn: ShapeFace[] = [];
      for (let k = 0; k < 5; k += 1) {
        const u0 = -2.85 + k * 0.42;
        warn.push([polyPath3([
          [u0, -1.24, 0.95], [u0 + 0.22, -1.24, 0.95],
          [u0 + 0.5, -1.24, 2.4], [u0 + 0.28, -1.24, 2.4],
        ]), 1, k % 2 === 0 ? "#e8c33a" : "#22262b"] as ShapeFace);
      }
      out.push(...tagKey(warn, 25 + depthNow(-1.9, -1.2)));
    }
    /* 접시 안테나 — 기둥 위에 기울어 앉은 큰 접시. 은색. 접시는 접평면 원판이라
       요잉을 타고 실제로 납작해진다(공용 렌즈 도형과 같은 결). */
    out.push(...tagKey(paintBase(cylinderFaces3(0.2, -0.6, 0.34, 2.4, 2.9), "#c9ced6"),
      26 + depthNow(0.2, -0.6)));
    const dish: ShapeFace[] = [];
    {
      const DR = 2.05;
      const disc = (k: number, dy: number, dz: number): string => polyPath3(
        Array.from({ length: 17 }, (_, q) => {
          const a = (q / 16) * Math.PI * 2;
          return [
            0.2 + Math.cos(a) * DR * k,
            -0.6 + dy + Math.sin(a) * DR * k * 0.42,
            5.3 + dz + Math.sin(a) * DR * k * 0.72,
          ] as [number, number, number];
        }),
      );
      dish.push([disc(1, 0, 0), 1, "#c9ced6"] as ShapeFace);
      dish.push(topFace(disc(0.78, 0.08, 0.1), 0.22));
      dish.push(capFace(disc(0.3, 0.16, 0.2), 0.3));
      // 급전기 — 접시 한가운데에서 앞으로 뻗는 가는 침.
      dish.push(...paintBase(hornFaces(0.2, -0.5, 5.4, 0.55, 0.5, 6.4, 0.2), "#c9ced6"));
    }
    out.push(...tagKey(dish, 28 + depthNow(0.2, -0.6)));
    /* 오른뒤 마디진 작은 탑(사진) — 테가 층층이 끼워진 가는 기둥. */
    {
      const tw: ShapeFace[] = [...paintBase(cylinderFaces3(2.3, -1.6, 0.3, 3.2, 0.9), "#7b8088")];
      for (let k = 0; k < 3; k += 1) {
        tw.push(...paintBase(cylinderFaces3(2.3, -1.6, 0.52, 0.26, 1.6 + k * 0.9), "#5c636d"));
      }
      tw.push(capFace(discPath3(2.3, -1.6, 4.1, 0.26), 0.35));
      out.push(...tagKey(tw, 24 + depthNow(2.3, -1.6)));
    }
    return out;
  },
  /* 핵 사일로(재모델링·사진) — 리벳 박힌 강철 드럼 무리다: 오른뒤에 주황 창 띠를
     두른 큰 돔통, 가운데 앞에 띠 감긴 중간 돔통, 왼쪽에 작은 돔통, 왼뒤에 마디진
     가는 탑 둘, 앞 왼쪽 바닥에 노랑·검정 경고 판. 키는 '받침 = 제 자리 깊이,
     얹힘 = 24 + 제 자리 깊이' 규칙을 그대로 따른다. */
  nsilo: () => {
    const out: ShapeFace[] = [
      // 받침 슬래브는 중심 깊이만(지적: 애드온 바닥이 위 부품을 덮음).
      ...tagKey(boxFaces3(0, 0.2, 5.6, 4.4, 1), depthNow(0, 0.2)),
    ];
    /* 드럼 하나 — 리벳 띠를 두른 원통 + 돔 뚜껑. 몸에 가로 띠 둘, 꼭대기에 볼트 캡. */
    const drum = (
      dx: number, dy: number, r: number, hBody: number, hDome: number, key: number,
    ): void => {
      const parts: ShapeFace[] = [
        ...paintBase(cylinderFaces3(dx, dy, r, hBody, 1), "#8b8f96"),
        // 리벳 띠 둘 — 통 몸에 두른 얇은 테.
        ...paintBase(cylinderFaces3(dx, dy, r * 1.06, 0.22, 1 + hBody * 0.3), "#5c636d"),
        ...paintBase(cylinderFaces3(dx, dy, r * 1.06, 0.22, 1 + hBody * 0.72), "#5c636d"),
        ...paintBase(domeFaces3(dx, dy, r, hDome, 1 + hBody), "#9ba3ad"),
        capFace(discPath3(dx, dy, 1 + hBody + hDome * 0.05, r * 0.7), 0.2),
        topFace(discPath3(dx, dy, 1 + hBody + hDome, r * 0.3), 0.3),
      ];
      out.push(...tagKey(parts, key));
    };
    drum(1.5, -1, 2, 2.4, 1.7, 24 + depthNow(1.5, -1));
    drum(-0.2, 1.2, 1.5, 1.8, 1.2, 26 + depthNow(-0.2, 1.2));
    drum(-2.1, -0.6, 1.15, 1.5, 0.95, 24 + depthNow(-2.1, -0.6));
    /* 큰 드럼 옆구리의 주황 창 띠(사진) — 앞이 보일 때만 그린다. 세로 살 셋. */
    if (facingRatio(0.6, 0.8) > 0.15) {
      const win: ShapeFace[] = [];
      for (const wx of [-0.55, 0, 0.55]) {
        win.push([polyPath3([
          [1.5 + wx - 0.18, 0.98, 1.9], [1.5 + wx + 0.18, 0.98, 1.9],
          [1.5 + wx + 0.18, 0.98, 3], [1.5 + wx - 0.18, 0.98, 3],
        ]), 1, "#e0812b"] as ShapeFace);
      }
      out.push(...tagKey(win, 25 + depthNow(1.5, 1)));
    }
    // 큰 드럼에 붙은 보라 배관 — 옆구리를 타고 오르는 굵은 관.
    out.push(...tagKey(paintBase(
      tubeFaces(3.3, -0.4, 3.3, -0.4, 0.3, 1.4), "#6b5a8a",
    ), 25 + depthNow(3.3, -0.4)));
    out.push(...tagKey(paintBase(
      cylinderFaces3(3.3, -0.4, 0.3, 3.6, 1), "#6b5a8a",
    ), 25 + depthNow(3.3, -0.4)));
    /* 왼뒤 마디진 탑 둘(사진) — 가는 기둥에 굵은 마디 테가 층층이 끼워진다. */
    for (const [tx, ty, th, tr] of [
      [-2.4, -2, 5.4, 0.42], [-3.4, -1, 3.6, 0.34],
    ] as [number, number, number, number][]) {
      const tower: ShapeFace[] = [...paintBase(cylinderFaces3(tx, ty, tr, th, 1), "#7b8088")];
      for (let k = 0; k < 4; k += 1) {
        tower.push(...paintBase(
          cylinderFaces3(tx, ty, tr * 1.55, 0.3, 1.4 + (th - 0.9) * (k / 3.4)), "#5c636d",
        ));
      }
      tower.push(capFace(discPath3(tx, ty, 1 + th, tr * 0.9), 0.35));
      out.push(...tagKey(tower, 24 + depthNow(tx, ty)));
    }
    /* 앞 왼쪽 노랑·검정 경고 판(사진) — 바닥에 낮게 선 빗금 판. 앞이 보일 때만. */
    if (facingRatio(0, 1) > 0.1) {
      const warn: ShapeFace[] = [];
      for (let k = 0; k < 7; k += 1) {
        const u0 = -2.6 + k * 0.5;
        warn.push([polyPath3([
          [u0, 2.25, 1], [u0 + 0.26, 2.25, 1], [u0 + 0.58, 2.25, 1.9], [u0 + 0.32, 2.25, 1.9],
        ]), 1, k % 2 === 0 ? "#e8c33a" : "#22262b"] as ShapeFace);
      }
      out.push(...tagKey(warn, 24 + depthNow(-1.3, 2.3)));
    }
    return out;
  },
  /* 머신 샵(재모델링·사진) — 톱니처럼 각진 강철 덩치다: 앞면에 주황 테를 두른
     세로살 방열 격자, 왼쪽에 초록 발광 띠와 노랑·검정 빗금 블록, 지붕 왼쪽에 배기관
     둘, 오른쪽에 옆으로 누운 밝은 드럼 하나. */
  mshop: () => {
    const out: ShapeFace[] = [
      // 받침 슬래브는 중심 깊이만(지적: 애드온 바닥이 위 부품을 덮음).
      ...tagKey(paintBase(boxFaces3(0, 0.2, 5.6, 4.4, 1), "#3a3f46"), depthNow(0, 0.2)),
      // 본체 — 위로 살짝 좁아지는 각진 덩치.
      ...tagKey(paintBase(frustumFaces3(0, 0.2, 5.4, 4.2, 4.8, 3.6, 2.4, 1), "#4b5058"),
        22 + depthNow(0, 0.2)),
    ];
    /* 앞면 방열 격자(사진) — 주황 테 안에 세로살이 촘촘하다. 앞이 보일 때만. */
    if (facingRatio(0, 1) > 0.12) {
      const g: ShapeFace[] = [[polyPath3([
        [-1.9, 2.31, 1.3], [1.5, 2.31, 1.3], [1.5, 2.31, 3.1], [-1.9, 2.31, 3.1],
      ]), 1, "#d2762a"] as ShapeFace];
      for (let k = 0; k < 11; k += 1) {
        const gx = -1.72 + k * 0.3;
        g.push([polyPath3([
          [gx, 2.33, 1.45], [gx + 0.16, 2.33, 1.45], [gx + 0.16, 2.33, 2.95], [gx, 2.33, 2.95],
        ]), 1, "#8b8f96"] as ShapeFace);
      }
      out.push(...tagKey(g, 24 + depthNow(0, 2.35)));
      // 왼쪽 초록 발광 띠 + 노랑·검정 빗금 블록.
      const side: ShapeFace[] = [[polyPath3([
        [-2.5, 2.05, 2.6], [-2.05, 2.05, 2.6], [-2.05, 2.05, 3], [-2.5, 2.05, 3],
      ]), 1, "#4cd86a"] as ShapeFace];
      for (let k = 0; k < 4; k += 1) {
        const u0 = -2.55 + k * 0.32;
        side.push([polyPath3([
          [u0, 2.05, 1.5], [u0 + 0.16, 2.05, 1.5],
          [u0 + 0.38, 2.05, 2.35], [u0 + 0.22, 2.05, 2.35],
        ]), 1, k % 2 === 0 ? "#e8c33a" : "#22262b"] as ShapeFace);
      }
      out.push(...tagKey(side, 24 + depthNow(-2.3, 2.05)));
    }
    // 지붕 배기관 둘(사진) — 왼뒤에서 곧게 솟는다.
    for (const [ex, ey, eh] of [[-1.5, -1.2, 2.4], [-0.6, -1.7, 1.9]] as [number, number, number][]) {
      out.push(...tagKey([
        ...paintBase(cylinderFaces3(ex, ey, 0.28, eh, 3.4), "#5c636d"),
        ...paintBase(cylinderFaces3(ex, ey, 0.42, 0.3, 3.4 + eh - 0.3), "#22262b"),
        capFace(discPath3(ex, ey, 3.4 + eh, 0.28), 0.45),
      ], 26 + depthNow(ex, ey)));
    }
    /* 오른쪽 누운 드럼(사진) — 밝은 회색 통에 어두운 테 둘. 관 프리미티브라 끝
       단면이 요잉을 탄다. */
    out.push(...tagKey([
      ...paintBase(tubeFaces(1.3, -1, 3.2, -1, 1.15, 3.2), "#b9bec6"),
      ...paintBase(tubeFaces(1.6, -1, 1.8, -1, 1.22, 3.2), "#5c636d"),
      ...paintBase(tubeFaces(2.7, -1, 2.9, -1, 1.22, 3.2), "#5c636d"),
    ], 26 + depthNow(2.2, -1)));
    return out;
  },
  /* 컨트롤 타워(재모델링·사진) — 붉은 치마를 두른 원뿔 관제탑에 노랑·검정 빗금 띠가
     감기고, 꼭대기 드럼 위에 접시 안테나가 앉는다. 오른쪽에는 초록 등을 인 격자
     철탑이 따로 서고, 발치에 작은 붉은 드럼이 놓인다. */
  ctower: () => {
    const out: ShapeFace[] = [
      // 받침 슬래브는 중심 깊이만(지적: 받침 판과 탑 순서가 요잉 따라 어긋남).
      ...tagKey(paintBase(boxFaces3(0, 0.4, 4.6, 3.8, 0.7), "#3a3f46"), depthNow(0, 0.4)),
      // 붉은 치마 — 아래가 넓은 원뿔대.
      ...tagKey(paintBase(frustumFaces3(-0.6, 0.2, 3.6, 3.6, 2.9, 2.9, 1.5, 0.7), "#a8322a"),
        22 + depthNow(-0.6, 0.2)),
      // 잿빛 몸통 — 창이 줄지어 난 드럼.
      ...tagKey(paintBase(cylinderFaces3(-0.6, 0.2, 1.45, 1.9, 2.2), "#6b7078"),
        24 + depthNow(-0.6, 0.2)),
    ];
    // 몸통 창 띠 — 앞이 보일 때만.
    if (facingRatio(0, 1) > 0.12) {
      const win: ShapeFace[] = [];
      for (const wx of [-1.4, -0.8, -0.2, 0.4]) {
        win.push([polyPath3([
          [wx, 1.55, 2.6], [wx + 0.3, 1.55, 2.6], [wx + 0.3, 1.55, 3.5], [wx, 1.55, 3.5],
        ]), 1, "#20242a"] as ShapeFace);
      }
      out.push(...tagKey(win, 25 + depthNow(-0.6, 1.6)));
    }
    /* 꼭대기 드럼 + 빗금 띠 — 관제층. */
    out.push(...tagKey([
      ...paintBase(cylinderFaces3(-0.6, 0.2, 1.15, 0.9, 4.1), "#8b8f96"),
      ...paintBase(cylinderFaces3(-0.6, 0.2, 1.2, 0.36, 4.55), "#e8c33a"),
    ], 26 + depthNow(-0.6, 0.2)));
    /* 접시 안테나 — 기둥 위에 기울어 앉은 접시. 접평면 원판이라 요잉을 탄다. */
    out.push(...tagKey(paintBase(cylinderFaces3(-0.6, 0.2, 0.22, 0.9, 5), "#5c636d"),
      27 + depthNow(-0.6, 0.2)));
    {
      const DR = 1.35;
      const disc = (k: number, dy: number, dz: number): string => polyPath3(
        Array.from({ length: 17 }, (_, q) => {
          const a = (q / 16) * Math.PI * 2;
          return [
            -0.6 + Math.cos(a) * DR * k,
            0.2 + dy + Math.sin(a) * DR * k * 0.4,
            5.9 + dz + Math.sin(a) * DR * k * 0.7,
          ] as [number, number, number];
        }),
      );
      out.push(...tagKey([
        [disc(1, 0, 0), 1, "#8b8f96"] as ShapeFace,
        topFace(disc(0.76, 0.06, 0.08), 0.22),
        capFace(disc(0.28, 0.12, 0.16), 0.3),
      ], 28 + depthNow(-0.6, 0.2)));
    }
    /* 오른쪽 격자 철탑(사진) — 네 기둥과 가로 띠, 꼭대기에 초록 등. */
    {
      const TX = 2.5;
      const TY = -0.6;
      const TH = 6.2;
      const tw: ShapeFace[] = [];
      for (const [ox, oy] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] as [number, number][]) {
        tw.push(...paintBase(cylinderFaces3(TX + ox, TY + oy, 0.13, TH, 0.7), "#3a3f46"));
      }
      for (let k = 0; k < 4; k += 1) {
        tw.push(...paintBase(
          boxFaces3(TX, TY, 1.26, 1.26, 0.16, 1.6 + k * 1.4), "#3a3f46",
        ));
      }
      tw.push(...paintBase(domeFaces3(TX, TY, 0.36, 0.32, 0.7 + TH), "#4cd86a"));
      out.push(...tagKey(tw, 24 + depthNow(TX, TY)));
    }
    // 발치 작은 붉은 드럼(사진).
    out.push(...tagKey([
      ...paintBase(cylinderFaces3(1.9, 1.8, 0.62, 0.9, 0.7), "#a8322a"),
      ...paintBase(domeFaces3(1.9, 1.8, 0.62, 0.4, 1.6), "#8b8f96"),
    ], 24 + depthNow(1.9, 1.8)));
    return out;
  },
  /* 코버트 옵스(재모델링·사진) — 어두운 각진 선체 위에 길쭉한 장갑 슬래브 셋이
     비스듬히 얹히고(모서리에 밝은 띠), 뒤 왼쪽에 노랑·검정 빗금 쐐기, 오른쪽 앞에
     검은 포구 원통이 튀어나온다. 아래는 골이 진 띠 받침. */
  covert: () => {
    const out: ShapeFace[] = [
      // 받침 슬래브는 중심 깊이만(지적: 애드온 바닥이 위 부품을 덮음).
      ...tagKey(paintBase(boxFaces3(0, 0.2, 5.6, 4.4, 1.1), "#3a3f46"), depthNow(0, 0.2)),
    ];
    // 골 진 띠 받침 — 앞면을 가로지르는 가는 홈 넷.
    if (facingRatio(0, 1) > 0.1) {
      const rib: ShapeFace[] = [];
      for (let k = 0; k < 4; k += 1) {
        rib.push(sideFace(polyPath3([
          [-2.6, 2.41, 0.2 + k * 0.24], [2.6, 2.41, 0.2 + k * 0.24],
          [2.6, 2.41, 0.32 + k * 0.24], [-2.6, 2.41, 0.32 + k * 0.24],
        ]), 0.35));
      }
      out.push(...tagKey(rib, depthNow(0, 2.4) + 0.2));
    }
    /* 장갑 슬래브 셋 — 앞으로 낮아지게 비스듬히 얹힌 긴 판. 위 모서리에 밝은 띠. */
    for (const [sx, sy] of [[-1.5, 0.1], [0, 0.1], [1.5, 0.1]] as [number, number][]) {
      const lo: [number, number, number][] = [
        [sx - 0.62, sy - 1.9, 2.5], [sx + 0.62, sy - 1.9, 2.5],
        [sx + 0.62, sy + 1.9, 1.35], [sx - 0.62, sy + 1.9, 1.35],
      ];
      const hi = lo.map(([x9, y9, z9]) => [x9, y9, z9 + 0.62] as [number, number, number]);
      const f: ShapeFace[] = [bodyFace(polyPath3(lo))];
      for (let k = 0; k < 4; k += 1) {
        const q = (k + 1) % 4;
        f.push(bodyFace(polyPath3([lo[k], lo[q], hi[q], hi[k]])));
      }
      f.push(bodyFace(polyPath3(hi)), topFace(polyPath3(hi), 0.18));
      // 위 모서리 밝은 띠(사진) — 슬래브 꼭대기를 따라 흐르는 옅은 초록빛 선.
      f.push([polyPath3([
        [sx - 0.5, sy - 1.7, 3.14], [sx + 0.5, sy - 1.7, 3.14],
        [sx + 0.5, sy + 1.6, 2.15], [sx - 0.5, sy + 1.6, 2.15],
      ]), 0.8, "#cfe0cf"] as ShapeFace);
      out.push(...tagKey(paintBase(f, "#4b5058"), 24 + depthNow(sx, sy)));
    }
    /* 뒤 왼쪽 노랑·검정 빗금 쐐기(사진) — 선체 뒤 위로 솟은 경사 블록. */
    out.push(...tagKey(paintBase(
      frustumFaces3(-2.1, -1.9, 2.4, 1.6, 1.6, 1.2, 1.6, 1.1), "#22262b",
    ), 24 + depthNow(-2.1, -1.9)));
    if (facingRatio(0, 1) > 0.1) {
      const warn: ShapeFace[] = [];
      for (let k = 0; k < 5; k += 1) {
        const u0 = -3.15 + k * 0.44;
        warn.push([polyPath3([
          [u0, -1.12, 1.15], [u0 + 0.22, -1.12, 1.15],
          [u0 + 0.52, -1.12, 2.6], [u0 + 0.3, -1.12, 2.6],
        ]), 1, k % 2 === 0 ? "#e8c33a" : "#22262b"] as ShapeFace);
      }
      out.push(...tagKey(warn, 25 + depthNow(-2.1, -1.1)));
    }
    /* 오른쪽 앞 검은 포구 원통(사진) — 옆으로 누운 관, 끝이 뚫린다. */
    out.push(...tagKey(paintBase(
      tubeFaces(2.1, -0.4, 3.5, -0.4, 0.62, 2.1, true), "#22262b",
    ), 26 + depthNow(3, -0.4)));
    return out;
  },
  /* 피직스 랩(재모델링·사진) — 왼쪽에 큰 강철 구형 포드가 앉고 그 뒤로 노랑·검정
     빗금 날개가 부챗살로 펴진다. 오른쪽으로는 초록 발광 띠가 박힌 기계 팔이 뻗어
     끝에 테 고리가 물리고, 발치에는 층진 받침과 앞 오른쪽 판이 깔린다. */
  physlab: () => {
    const out: ShapeFace[] = [
      // 받침 슬래브는 중심 깊이만(지적: 애드온 바닥이 위 부품을 덮음).
      ...tagKey(paintBase(boxFaces3(0, 0.2, 5.6, 4.4, 0.8), "#4b5058"), depthNow(0, 0.2)),
    ];
    // 층진 받침 — 위로 좁아지는 단.
    out.push(...tagKey(paintBase(
      frustumFaces3(-0.8, -0.2, 3.4, 2.8, 2.5, 2, 1.1, 0.8), "#5c636d",
    ), 22 + depthNow(-0.8, -0.2)));
    /* 뒤 노랑·검정 빗금 날개(정정 지적: 패턴이 잘못 붙었다) — 낱장을 번갈아 노랑·검정
       으로 칠하면 '빗금'이 아니라 색 조각으로 읽힌다. 날개는 모두 검정으로 두고, 그
       위에 노란 빗금을 비스듬히 얹는다. 구 뒤 표면에서 부챗살로 펴진다. */
    for (let k = 0; k < 5; k += 1) {
      const a9 = (-56 + k * 28) * (Math.PI / 180);
      const bx = -1.5 + Math.sin(a9) * 1.5;
      const by = 0.1 - Math.cos(a9) * 1.5;
      const tx = -1.5 + Math.sin(a9) * 3.2;
      const ty = 0.1 - Math.cos(a9) * 3.2;
      const vane: ShapeFace[] = [];
      const quad = (u0: number, u1: number, z0: number, z1: number): string => polyPath3([
        [bx + (tx - bx) * u0, by + (ty - by) * u0, z0],
        [bx + (tx - bx) * u1, by + (ty - by) * u1, z0],
        [bx + (tx - bx) * u1, by + (ty - by) * u1, z1],
        [bx + (tx - bx) * u0, by + (ty - by) * u0, z1],
      ]);
      vane.push([quad(0, 1, 2, 3.6), 1, "#22262b"] as ShapeFace);
      // 빗금 — 아래에서 위로 비스듬히 오르는 노란 띠 셋.
      for (let q = 0; q < 3; q += 1) {
        const u0 = q * 0.3;
        vane.push([polyPath3([
          [bx + (tx - bx) * u0, by + (ty - by) * u0, 2.05],
          [bx + (tx - bx) * (u0 + 0.16), by + (ty - by) * (u0 + 0.16), 2.05],
          [bx + (tx - bx) * (u0 + 0.32), by + (ty - by) * (u0 + 0.32), 3.55],
          [bx + (tx - bx) * (u0 + 0.16), by + (ty - by) * (u0 + 0.16), 3.55],
        ]), 1, "#e8c33a"] as ShapeFace);
      }
      vane.push(sideFace(quad(0, 1, 2, 3.6), 0.18));
      out.push(...tagKey(vane, 23 + depthNow(tx, ty)));
    }
    /* 큰 구형 포드(사진) — 위·아래 돔을 맞붙여 진짜 구로. 허리에 리벳 테. */
    out.push(...tagKey([
      ...paintBase(domeFaces3(-1.5, 0.1, 1.75, 1.6, 2.2), "#9ba3ad"),
      ...paintBase(cylinderFaces3(-1.5, 0.1, 1.75, 1.1, 1.1), "#8b8f96"),
      ...paintBase(cylinderFaces3(-1.5, 0.1, 1.82, 0.24, 2), "#5c636d"),
      capFace(discPath3(-1.5, 0.1, 3.4, 0.9), 0.2),
    ], 26 + depthNow(-1.5, 0.1)));
    /* 오른쪽 기계 팔(사진) — 구에서 오른앞으로 뻗는 각진 통. 옆구리에 초록 발광 띠. */
    out.push(...tagKey(paintBase(boxFaces3(1.1, 0.1, 3.4, 1.3, 1.2, 2.3), "#7b8088"),
      26 + depthNow(1.1, 0.1)));
    if (facingRatio(0, 1) > 0.12) {
      const led: ShapeFace[] = [];
      for (const lx of [0.1, 0.8, 1.5]) {
        led.push([polyPath3([
          [lx - 0.22, 0.76, 2.7], [lx + 0.22, 0.76, 2.7],
          [lx + 0.22, 0.76, 3.1], [lx - 0.22, 0.76, 3.1],
        ]), 1, "#4cd86a"] as ShapeFace);
      }
      out.push(...tagKey(led, 27 + depthNow(0.8, 0.8)));
    }
    // 팔 끝 테 고리 — 관 끝에 물린 굵은 테.
    out.push(...tagKey([
      ...paintBase(tubeFaces(2.6, 0.1, 3.4, 0.1, 0.72, 2.9, true), "#9ba3ad"),
      ...paintBase(tubeFaces(3.3, 0.1, 3.5, 0.1, 0.92, 2.9), "#5c636d"),
    ], 28 + depthNow(3.2, 0.1)));
    // 앞 오른쪽 바닥 판(사진) — 낮게 깔린 넓은 철판.
    out.push(...tagKey(paintBase(boxFaces3(1.6, 2.1, 2.6, 1.6, 0.32, 0.8), "#5c636d"),
      22 + depthNow(1.6, 2.1)));
    return out;
  },
  /* ── 공사 표현 공용 셋(요청: 아이콘 대신 모델) ───────────────────────────── */
  /* 저그 고치 — 크립 위 통통한 번데기(재생 쪽 CSS가 바운스시킨다). */
  /* 저그 변태 고치 — 고정색(요청: 팀색 말고): 장기 느낌의 연한 살색 몸 + 붉은·갈·보라
     힘줄 선. 크립은 탁한 보라. */
  cocoon: () => [
    // 가시는 걷었다(지적: 성큰류와 헷갈린다) — 민둥한 겹돔 고치만.
    // 가시 돋친 크립 대신 부드러운 원반(재지적: 고치 옆 가시 제거).
    sideFace(discPath3(0, 0, 0.04, 4.2), 0.3),
    // 덩어리 무게중심을 상자 가운데로(지적: 고치 중심이 어긋난다) — 전체 y -0.55.
    ...paintBase([
      ...domeFaces3(0, -0.25, 2.6, 3.2),
      ...domeFaces3(0, 0.55, 1.9, 1.5),
    ], "#d9b8a2"),
    capFace(polyPath3([[-1.9, -0.05, 2.1], [1.9, -0.05, 2.1], [1.7, -0.25, 2.5], [-1.7, -0.25, 2.5]]), 0.18),
    capFace(polyPath3([[-1.5, 0.75, 1.2], [1.5, 0.75, 1.2], [1.35, 0.55, 1.6], [-1.35, 0.55, 1.6]]), 0.18),
    /* 힘줄은 껍질 표면을 따라(재지적: 떠 있고 안 보임 — 더 많이, 보라·갈색) — 로보틱스
       고치의 이음선처럼 돔 반지름 프로필을 타고 세로로 흘러, 요잉해도 표면에 붙어 있다. */
    ...((): ShapeFace[] => {
      const out: ShapeFace[] = [];
      const veins: [number, string][] = [
        [-2.7, "#7c5d92"], [-1.9, "#8a5f43"], [-1.1, "#7c5d92"], [-0.3, "#8a5f43"],
        [0.5, "#7c5d92"], [1.3, "#8a5f43"], [2.1, "#7c5d92"], [2.9, "#8a5f43"],
      ];
      const prof: [number, number][] = [[0.15, 0.99], [0.9, 0.95], [1.7, 0.83], [2.4, 0.62], [2.95, 0.34]];
      /* 구불구불 + 가지(재지적: 직선이라 어색) — 마디마다 각도를 해시로 비틀며 오르고,
         중간 마디에서 짧은 곁가지가 갈라진다. 전부 각도의 순수 함수라 결정적이다. */
      const ptAt = (aa: number, z: number, rf: number): [number, number] =>
        project(Math.sin(aa) * 2.6 * rf, -0.25 + Math.cos(aa) * 2.6 * rf, z);
      const seg = (
        p1: [number, number], p2: [number, number], w: number, col: string,
      ): ShapeFace => [
        `M${p1[0] - w} ${p1[1]} L${p2[0] - w} ${p2[1]} L${p2[0] + w} ${p2[1]} L${p1[0] + w} ${p1[1]} Z`,
        0.8, col,
      ] as ShapeFace;
      for (const [a, col] of veins) {
        if (facingRatio(Math.sin(a), Math.cos(a)) < 0.12) continue;
        /* 뿌리 높이·길이·굵기도 해시로 제각각(재재지적) — 어떤 건 밑동부터 길게,
           어떤 건 중턱에서 짧게, 굵기도 저마다 다르다. */
        const i0 = Math.sin(a * 71.3) > 0.2 ? 1 : 0;
        const iEnd = Math.min(prof.length - 1, i0 + 2 + Math.round(Math.sin(a * 19.7) * 0.5 + 1));
        const w0 = 0.09 + (Math.sin(a * 47.9) * 0.5 + 0.5) * 0.09;
        let ang = a;
        let prev = ptAt(ang, prof[i0][0], prof[i0][1]);
        for (let i = i0 + 1; i <= iEnd; i += 1) {
          ang += Math.sin(a * 37.3 + i * 2.1) * 0.26;
          const cur = ptAt(ang, prof[i][0], prof[i][1]);
          out.push(seg(prev, cur, Math.max(0.05, w0 - (i - i0) * 0.018), col));
          if (i === i0 + 1 && iEnd - i0 >= 2) {
            // 곁가지 — 옆으로 벌어져 반 마디만 뻗는다.
            const bAng = ang + (Math.sin(a * 53.1) > 0 ? 0.5 : -0.5);
            const mid: [number, number] = [(prof[i][0] + prof[i - 1][0]) / 2, (prof[i][1] + prof[i - 1][1]) / 2];
            out.push(seg(cur, ptAt(bAng, mid[0], mid[1]), w0 * 0.55, col));
          }
          prev = cur;
        }
      }
      /* 껍질 위 키(수리: 앞 돔 키를 물려받아 큰 돔이 덮었다) — 보이는 쪽만 그리니
         늘 몸 위면 된다. */
      return tagKey(out, depthNow(0, -0.25) + 3.4);
    })(),
  ],
  /* 프로토스 소환구 — 겹겹의 빛 고리와 중심 빛기둥. 다 지어지면 건물이 드러난다. */
  /* 프로토스 소환구(재정의: 신비로운 에너지 구) — 바닥 빛무리 위에 반투명 겹구가
     떠 있고, 밝은 심과 반짝이 둘이 돈다. 고정색(요청): 밝은 하늘빛·하얀 글로우. */
  warpin: () => {
    /* 구로 재작업(재지적: 돔은 무덤 같다 — 소환'구'다) — 공중에 뜬 진짜 공: 중심만
       투영하고 반지름은 가로세로 같은 원이라 어느 시점에서도 안 눌린다. 반투명 파란
       구 + 밝은 심 + 바닥 빛무리. */
    const [bx0, by0] = project(0, 0, 0.15);
    const [ox, oy] = project(0, 0, 3.2);
    return [
      topFace(groundEllipse(bx0, by0, 3.6, 1.7), 0.14),
      [groundEllipse(ox, oy, 3.05, 3.05), 0.5, "#9fd4ff"] as ShapeFace,
      [groundEllipse(ox, oy, 2.1, 2.1), 0.55, "#c4e6ff"] as ShapeFace,
      [groundEllipse(ox, oy, 1.05, 1.05), 0.9, "#eaf6ff"] as ShapeFace,
      topFace(groundEllipse(ox - 0.8, oy - 0.8, 0.8, 0.65), 0.5),
    ];
  },
  /* 테란 공사장 — 기초 슬래브 + 뼈대 기둥 넷 + 가로 보 + 크레인.
     고정색(요청): 공사 쇳빛 + 빨간 불빛. */
  scaffold: () => [
    ...paintBase([
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
    ], "#9aa3ad"),
    /* 공사장 안전 띠(요청: 터렛에 붙인 패턴을 적절히) — 기초 슬래브 네 옆면에
       노랑 바탕·검정 사선. 면마다 facing으로 보일 때만 그린다. */
    ...((): ShapeFace[] => {
      const faces: ShapeFace[] = [];
      const side = (
        nx: number, ny: number, pt: (t: number, z: number) => [number, number, number], len: number,
      ): void => {
        if (facingRatio(nx, ny) < 0.05) return;
        faces.push([polyPath3([pt(0, 0.05), pt(len, 0.05), pt(len, 0.75), pt(0, 0.75)]), 1, "#d9ae35"] as ShapeFace);
        for (let t = 0.35; t < len - 0.95; t += 1.4) {
          faces.push([polyPath3([pt(t, 0.05), pt(t + 0.55, 0.05), pt(t + 0.95, 0.75), pt(t + 0.4, 0.75)]), 1, "#1b1e23"] as ShapeFace);
        }
      };
      side(0, 1, (t, z) => [-3.5 + t, 2.51, z], 7);
      side(0, -1, (t, z) => [3.5 - t, -2.51, z], 7);
      side(1, 0, (t, z) => [3.51, 2.5 - t, z], 5);
      side(-1, 0, (t, z) => [-3.51, -2.5 + t, z], 5);
      return faces;
    })(),
    // 빨간 공사 등 — 크레인 꼭대기와 앞뒤 보 끝.
    [groundEllipse(...project(2.3, -1.5, 7.4), 0.3, 0.24), 0.85, "#ff5f4b"] as ShapeFace,
    [groundEllipse(...project(-2.9, 1.9, 4.5), 0.24, 0.19), 0.8, "#ff5f4b"] as ShapeFace,
    [groundEllipse(...project(2.9, -1.9, 4.5), 0.24, 0.19), 0.8, "#ff5f4b"] as ShapeFace,
  ],

  /* 스파이더 마인(요청) — 땅에 반쯤 묻힌 작은 돔 + 감지침 셋. 맵에서 죽음의 원인이
     보이게 마인 자체를 그린다. */
  /* 마인은 그냥 납작한 삼각형 판(재재재지적) — 뿔도 장식도 없이, 땅에 놓인 삼각 판
     한 장(살짝 두께만). */
  mine: () => {
    // 옆면 봉합(재지적) — 아랫판·윗판 대응 변을 띠로 이어 두께 옆구리를 채운다.
    const pts = (z: number): [number, number, number][] =>
      [[0, 2.6, z], [-2.3, -1.5, z], [2.3, -1.5, z]];
    const lo = pts(0);
    const hi = pts(0.8);
    // 은색 몸 + 윗판 개인색 동그라미(요청).
    const faces: ShapeFace[] = [[polyPath3(lo), 1, "#c9ced6"] as ShapeFace];
    for (let i = 0; i < 3; i += 1) {
      const j = (i + 1) % 3;
      faces.push([polyPath3([lo[i], lo[j], hi[j], hi[i]]), 1, "#c9ced6"] as ShapeFace);
    }
    faces.push([polyPath3(hi), 1, "#c9ced6"] as ShapeFace, topFace(polyPath3(hi), 0.18));
    faces.push(bodyFace(groundEllipse(...project(0, -0.1, 0.82), 0.72, 0.5)));
    return faces;
  },
  /* 애드온 연결 통로(재지적: 판때기 디자인 교체) — 넓은 납작 사각 대신 제대로 된
     낮은 관: 양끝 접합 칼라 두 개 사이를 몸통이 잇고, 지붕에 밝은 띠가 얹힌다. */
  addonlink: () => [
    ...boxFaces3(0, 0, 11, 4.2, 3, 0),
    topFace(polyPath3([[-5.5, -0.9, 3.05], [5.5, -0.9, 3.05], [5.5, 0.9, 3.05], [-5.5, 0.9, 3.05]]), 0.3),
    ...boxFaces3(-6.4, 0, 2.2, 5.4, 4, 0),
    ...boxFaces3(6.4, 0, 2.2, 5.4, 4, 0),
  ],
  /* 버로우 구멍(요청) — 버로우 중엔 유닛 대신 이 구멍만: 흙 둔덕 테 + 어두운 구멍.
     크기는 마커 크기(소·중·대형)를 그대로 탄다. */
  burrowhole: () => [
    /* 둔덕 제거(재지적) — 구멍 둘레의 납작한 흙 띠(도넛)만 두른다: 바깥 정방향 +
       안 역방향 감김이 구멍을 낸다. */
    ...paintBase(((): ShapeFace[] => {
      const [ex, ey] = project(0, 0, 0.25);
      const sq = groundSquashNow();
      const ro = 4.2;
      const ri = 2.9;
      return [bodyFace(
        `M${ex - ro} ${ey}a${ro} ${(ro * sq).toFixed(2)} 0 1 0 ${ro * 2} 0a${ro} ${(ro * sq).toFixed(2)} 0 1 0 ${-ro * 2} 0Z`
        + `M${ex - ri} ${ey}a${ri} ${(ri * sq).toFixed(2)} 0 1 1 ${ri * 2} 0a${ri} ${(ri * sq).toFixed(2)} 0 1 1 ${-ri * 2} 0Z`,
      )];
    })(), "#7a6a52"),
    // 어두운 구멍.
    capFace(discPath3(0, 0, 0.1, 3), 0.6),
    /* 숨은 유닛 비침(재지적: 납작한 렌즈 반구의 윗부분만 살짝) — 낮은 돔을 유닛색
       반투명으로 구멍 위에 살짝 내민다. */
    ...domeFaces3(0, 0, 1.9, 0.55, 0.05).map(([d, o, f, k]) => [d, o * 0.45, f, k] as ShapeFace),
  ],
  /* SCV(실물 참고) — 각진 몸통 + 양옆 포드 + 위 머리 + 앞으로 굽는 집게 드릴 한 쌍. */
  scv: () => [
    // 전신 은색(요청) — 팔 앞 반 토막만 개인색으로 남긴다.
    ...paintBase([
      ...boxFaces3(0, -0.4, 2.6, 2.4, 2.6, 3.4),
      ...boxFaces3(-2.2, -0.2, 1.3, 1.8, 1.9, 3.6),
      ...boxFaces3(2.2, -0.2, 1.3, 1.8, 1.9, 3.6),
      ...domeFaces3(0, -0.6, 0.9, 0.7, 6),
      // 팔·다리는 지면과 평행(정정) — 팔 한 쌍은 넓게 벌려 위에, 다리 한 쌍은 모아 아래에.
      ...boxFaces3(-2.5, 0.75, 1.05, 0.9, 1.05, 4.1),
      ...boxFaces3(2.5, 0.75, 1.05, 0.9, 1.05, 4.1),
      ...boxFaces3(-0.85, 1.4, 0.95, 1.7, 0.95, 2.3),
      ...boxFaces3(0.85, 1.4, 0.95, 1.7, 0.95, 2.3),
    ], "#c9ced6"),
    // 팔 앞부분 — 개인색.
    ...boxFaces3(-2.5, 1.65, 1.05, 0.9, 1.05, 4.1),
    ...boxFaces3(2.5, 1.65, 1.05, 0.9, 1.05, 4.1),
    // 조종석 유리(요청) — 몸 앞면 창, 앞이 보일 때만.
    ...((): ShapeFace[] => {
      const f = facingRatio(0, 1);
      if (f <= 0.05) return [];
      return tagKey([[wallDiscPath(0, 0.82, 4.9, 0.8, 0.62), 0.65, "#bfe0ef"] as ShapeFace], 30);
    })(),
    /* 뒤 추진체 둘(요청) — 몸통 꽁무니에 짙은 은색 원통 한 쌍, 끝에 어두운 노즐.
       뒤가 보일 때만 그려 앞에서 몸을 뚫고 나오지 않게 한다. */
    /* 노즐은 관 프리미티브에 맡긴다(지적: 단면의 원이 회전각을 안 먹고 가려지지도
       않는다) — groundEllipse는 '바닥에 눕힌 원'이라 요잉을 안 타는 화면 고정 타원이고,
       거기에 붙박이 큰 키(26)까지 얹어 어느 각도에서도 몸 위에 떠 있었다. tubeFaces는
       축 방향을 실제로 투영한 끝 단면을 그리고, 마주볼 때만 포구를 어둡게 찍으며,
       제 자리 깊이 키를 스스로 단다 — 붙박이 키도, 앞뒤 문턱도 필요 없다. */
    ...([-1.05, 1.05]).flatMap((jx) =>
      paintBase(tubeFaces(jx, -1.5, jx, -2.55, 0.52, 4.5, true), "#9ba3ad")),
    // 양팔 끝 연장(요청) — 왼팔 작은 드릴 원뿔, 오른팔 두 갈래 집게.
    ...paintBase(hornFaces(-2.5, 2.1, 4.6, -2.5, 3.1, 4.6, 0.42), GUNMETAL),
    ...paintBase([
      ...hornFaces(2.3, 2.1, 4.6, 2.42, 3, 4.6, 0.24),
      ...hornFaces(2.7, 2.1, 4.6, 2.58, 3, 4.6, 0.24),
    ], GUNMETAL),
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
      // 제 깊이(지적: 앞다리 안 가려짐) — 날개판마다 제 중심 깊이를 단다.
      return tagKey(
        [bodyFace(`${dTop} ${dEdge}`), topFace(dTop, 0.18), sideFace(dEdge, 0.3)],
        depthNow(dx * (r0 + len * 0.7), dy * (r0 + len * 0.7)),
      );
    };
    // 뒤 위 날개 한 쌍 + 뒤 아래로 처지는 날개 한 쌍(옆다리는 제거 — 지적).
    /* 1.6배 확대 + 더 높이 부양(지적: 프로브가 너무 작고 땅에 붙어 있음) — 몸통이
       상자의 16%만 채우고 있었다. 다리 얇음·가파름 비율은 유지. */
    // 꼬리 두 가닥은 안테나처럼 얇게(지적).
    // 등딱지(몸통 원판)만 개인색, 날개·다리 금색(요청).
    // 다리 뿌리를 몸통(팔각 반지름 1.55) 안으로 밀어 틈 없이 붙인다(지적).
    // 꼬리 두 가닥 길이 1/3(요청) — 2.4 → 0.8.
    for (const ang of [168, 192]) out.push(...paintBase(wing(ang, 1.1, 0.8, 0.16, 0.06, 6.2, 5.85), "#d4af37"));
    // 긴 뒷다리 한 쌍은 길이·두께 2/3(지적).
    // 짧은 뒷다리 한 쌍은 더 짧게(지적) — 1.67 → 1.05.
    for (const ang of [138, 222]) out.push(...paintBase(wing(ang, 1.1, 1.05, 0.37, 0.15, 6.1, 4.4), "#d4af37"));
    /* 몸통·눈도 모델 공간(수리: 화면 공간이라 돌아도 고정돼 있었다 — 지적) — 팔각도
       눈도 요잉을 따라 함께 돈다. */
    const oct = (r: number, z: number): string => polyPath3(
      Array.from({ length: 8 }, (_, i) => {
        const a = ((i * 45 + 22.5) * Math.PI) / 180;
        return [Math.cos(a) * r, Math.sin(a) * r, z] as [number, number, number];
      }),
    );
    // 몸통 축소(지적: 몸체 크기 축소) — 팔각 반지름 2 → 1.6, 겹층도 함께.
    // 원판 몸통만 축소(정정: '몸통'은 가운데 원판 파트 — 날개는 그대로).
    // 몸통은 늘 다리 위(지적: 뒷다리에 가려짐) — 제 깊이 키를 크게 단다.
    out.push(...tagKey([
      // 몸통 금색, 몸통 위 원판만 개인색(요청).
      [oct(1.55, 6.2), 1, "#d4af37"] as ShapeFace,
      [oct(1.05, 6.5), 1] as ShapeFace,
      topFace(oct(0.62, 6.8), 0.3),
    ], depthNow(0, 0) + 2.5));
    /* 눈 두 개(재지적: 몸통에 수직으로 붙여 정면을 보게 + 더 작게) — 바닥에 눕던
       타원을 정면 벽 데칼(wallDiscPath)로 세운다. 벽과 함께 돌고 눌리며, 뒤로 돌면
       서서히 사라진다(어시밀레이터 알과 같은 규칙). */
    const fEye = facingRatio(0, 1);
    if (fEye > -0.05) {
      const k = Math.min(1, (fEye + 0.05) / 0.4);
      // 눈은 형광 연두(지적).
      out.push([wallDiscPath(-0.52, 1.45, 6.3, 0.28, 0.18), 0.92 * k, "#a6ff3e"] as ShapeFace);
      out.push([wallDiscPath(0.52, 1.45, 6.3, 0.28, 0.18), 0.92 * k, "#a6ff3e"] as ShapeFace);
    }
    /* 옆면 둥근 포트(실물 참고) — 몸이 줄면서 가장자리 밖으로 삐져나와 떠 보였다(확인)
       — 몸 안쪽으로 당기고 더 작게. */
    const [p1x, p1y] = project(-0.98, 0.5, 6.3);
    const [p2x, p2y] = project(0.98, 0.5, 6.3);
    out.push(topFace(groundEllipse(p1x, p1y, 0.28, 0.22), 0.3));
    out.push(topFace(groundEllipse(p2x, p2y, 0.28, 0.22), 0.3));
    /* 앞다리 한 쌍(재지적: 길이 축소 + 두 다리 사이 벌리기 + 몸에 더 딱) — 뿌리를
       몸 바로 밑(0.65)까지 당기고, 각도를 ±14→±30으로 벌리고, 길이는 반 남짓으로. */
    for (const ang of [30, -30]) out.push(...paintBase(wing(ang, 0.85, 0.8, 0.27, 0.13, 5.7, 5), "#d4af37"));
    return out;
  },
  /* 드론(정정) — 갈퀴치마는 집게 사이가 아니라 집게팔과 꼬리 사이, 양옆에 부채처럼
     펼쳐진다. 몸통(꼬리 겹돔) + 칼날팔 한 쌍 + 양옆 톱니 부채막. */
  drone: () => {
    /* 갈퀴치마 재작도(요청) — 갈고리를 아래로 내리고, 치마가 '몸통 옆면 ↔ 갈고리'를
       잇는 막이 되게 한다. 뮤탈 날개처럼 디테일을 준다: 바깥 가장자리를 세 번 우묵하게
       파고, 뿌리에서 갈고리로 뻗는 힘줄을 얹어 얇은 막처럼 읽힌다. */
    // (되돌림·정정 요청: 핀칭은 드론이 아니라 퀸이었다) — 드론은 수평 자세 그대로.
    const up = (x9: number, y9: number, z9: number): [number, number, number] =>
      [x9, y9, z9];
    const CLAW_Z = 3;
    const CLAW_S = 0.7;
    const web = (m: 1 | -1): ShapeFace[] => {
      // 몸통 옆면 부착점 셋(뒤 → 앞)과 갈고리 쪽 바깥점 넷.
      const A: [number, number, number][] = [
        up(m * 1.3, -1.7, 3.25), up(m * 1.75, -0.4, 3.35), up(m * 1.5, 0.95, 3.45),
      ];
      const C: [number, number, number][] = [
        up(m * 1.95, -2.5, 2.95), up(m * 2.95, -1.1, 3),
        up(m * 3.25, 0.5, 3.05), up(m * 2.5, 2, 3.1),
      ];
      // 공용 막 도형(요청) — 갈퀴 골과 힘줄을 한 자리에서 낸다.
      return membraneFaces(A, C, "#c68a62", {
        shade: m > 0 ? 0.16 : 0.13, notch: 0.28, key: depthNow(m * 2.2, -0.2) * 1.6,
      });
    };
    return [
      ...web(1),
      ...web(-1),
      // 뒷몸 짙은 갈색(요청).
      ...tagKey(paintBase(domeFaces3(0, -2.1, 1.5, 1.2, 3.5), "#6b4732"),
        depthNow(0, -2.1) * 1.6 + 1),
      ...tagKey(domeFaces3(0, -0.7, 2, 1.7, 3.5), depthNow(0, -0.7) * 1.6 + 1),
      /* 갈고리 — 아래로 내린다(요청: z 4 → 3). 치마가 그 안쪽 변에 물린다. */
      ...tagKey(ivory(claw3(1, CLAW_S, CLAW_Z)), depthNow(2, 1.5) * 1.6 + 2),
      ...tagKey(ivory(claw3(-1, CLAW_S, CLAW_Z)), depthNow(-2, 1.5) * 1.6 + 2),
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
      // 앞 가림치마만 개인색, 나머지 흰회색(요청).
      ...paintBase([
        ...cylinderFaces3(-0.62, 0, 0.4, 2.3, 0.1),
        ...cylinderFaces3(0.62, 0, 0.4, 2.3, 0.1),
        ...domeFaces3(-0.62, 0.25, 0.5, 0.35, 0.05),
        ...domeFaces3(0.62, 0.25, 0.5, 0.35, 0.05),
        ...cylinderFaces3(0, -0.2, 1.25, 1.9, 2.3),
        ...domeFaces3(-1.5, -0.3, 0.95, 0.85, 3.6),
        ...domeFaces3(1.5, -0.3, 0.95, 0.85, 3.6),
      ], "#dfe3e6"),
      // 헬멧 유리색(요청) — 지붕 키(재지적: 몸통·어깨에 가려짐).
      ...tagKey(paintBase(domeFaces3(0, -0.2, 0.85, 0.8, 4.2), "#bfe0ef"), 20),
      [groundEllipse(fx2, fy2, 0.42, 0.36), 0.55, "#ffffff"] as ShapeFace,
      bodyFace(apron),
      topFace(apron, 0.3),
      /* 두 팔(재지적: 위치·굽힘) — 위팔은 어깨뽕 아래(z 3.7)에서 나와 내려가고,
         팔꿈치에서 굽는다. 왼팔은 앞으로, 오른팔은 주사기 뿌리로. */
      ...paintBase([
        ...hornFaces(-1.45, 0.1, 3.7, -1.2, 0.75, 2.8, 0.45),
        ...hornFaces(-1.2, 0.75, 2.8, -0.85, 1.4, 3.1, 0.4),
        ...hornFaces(1.5, 0.1, 3.7, 1.3, 0.55, 2.85, 0.45),
        ...hornFaces(1.3, 0.55, 2.85, 1.35, 1.05, 3.1, 0.4),
      ], "#dfe3e6"),
      // 오른팔 주사기 — 녹색(요청).
      ...paintBase(tubeFaces(1.35, 0.3, 1.35, 1.4, 0.3, 3), "#4db964"),
      ...paintBase(hornFaces(1.35, 1.4, 3.1, 1.35, 2.2, 3, 0.16), "#4db964"),
    ];
  },
  /* 마린(실물 참고) — 큰 어깨 뽕 한 쌍의 파워드 아머, 금빛 바이저 머리, 가슴 앞에
     가로로 든 가우스 소총. */
  gunner: () => {
    const [vx2, vy2] = project(0, 0.55, 4.7);
    return [
      // 다리를 또렷하게(지적: 다리가 없어 헷갈림) — 벌린 두 기둥 + 둥근 발.
      ...cylinderFaces3(-0.62, 0, 0.4, 2.3, 0.1),
      ...cylinderFaces3(0.62, 0, 0.4, 2.3, 0.1),
      ...domeFaces3(-0.62, 0.25, 0.5, 0.35, 0.05),
      ...domeFaces3(0.62, 0.25, 0.5, 0.35, 0.05),
      ...cylinderFaces3(0, -0.2, 1.25, 1.9, 2.3),
      ...domeFaces3(-1.5, -0.3, 0.95, 0.85, 3.6),
      ...domeFaces3(1.5, -0.3, 0.95, 0.85, 3.6),
      // 헬멧 유리색(요청) — 지붕 키(재지적: 몸통·어깨에 가려짐).
      ...tagKey(paintBase(domeFaces3(0, -0.2, 0.85, 0.8, 4.2), "#bfe0ef"), 20),
      [groundEllipse(vx2, vy2, 0.45, 0.32), 0.55, "#ffffff"] as ShapeFace,
      /* 두 팔(재지적: 위치·굽힘) — 위팔은 어깨뽕 '아래'(z 3.7)에서 나와 앞-아래로
         내려가고, 팔꿈치에서 굽어 아래팔이 총몸으로 올라가 쥔다. 왼손은 앞손잡이,
         오른손은 방아쇠 쪽. */
      ...hornFaces(-1.45, 0.1, 3.7, -1.05, 0.8, 2.75, 0.5),
      ...hornFaces(-1.05, 0.8, 2.75, 0.3, 1.85, 3.25, 0.42),
      ...hornFaces(1.5, 0.1, 3.7, 1.25, 0.7, 2.8, 0.5),
      ...hornFaces(1.25, 0.7, 2.8, 0.75, 1, 3.25, 0.42),
      /* 소총(지적: 총구가 요잉을 안 먹는다) — 총구를 화면 고정 원반으로 얹던 것을
         걷고, 총열을 관 프리미티브로 세운다: 축을 실제로 투영한 끝 단면이 나오고
         마주볼 때만 포구가 어둡게 뚫린다. 노리쇠 뭉치만 상자로 남긴다. 건메탈. */
      ...paintBase(boxFaces3(0.55, 0.95, 0.55, 1.3, 0.5, 3.1), GUNMETAL),
      ...paintBase(tubeFaces(0.55, 1.5, 0.55, 2.9, 0.24, 3.35, true), GUNMETAL),
    ];
  },
  /* 고스트(지적: 여태 마린 모델을 빌려 입고 있었다) — 마린과 비슷하되 어깨장갑이
     없고 헬멧이 작으며 몸통·팔다리가 훨씬 가늘다. 긴 C-10 저격소총을 받쳐 든다. */
  ghost: () => {
    const [vx2, vy2] = project(0, 0.5, 4.55);
    return [
      // 가는 다리 + 작은 발 — 회흰색(요청).
      ...paintBase([
        ...cylinderFaces3(-0.45, 0, 0.24, 2.3, 0.1),
        ...cylinderFaces3(0.45, 0, 0.24, 2.3, 0.1),
        ...domeFaces3(-0.45, 0.22, 0.32, 0.24, 0.05),
        ...domeFaces3(0.45, 0.22, 0.32, 0.24, 0.05),
      ], "#d3d7db"),
      // 가는 몸통(마린 1.25 → 0.7) — 어깨장갑 없이 작은 어깨 라운드만.
      ...cylinderFaces3(0, -0.1, 0.7, 2, 2.3),
      ...domeFaces3(-0.75, -0.15, 0.34, 0.3, 4.1),
      ...domeFaces3(0.75, -0.15, 0.34, 0.3, 4.1),
      // 작은 헬멧(마린 0.8 → 0.55) + 바이저.
      // 헬멧 유리색(요청) — 지붕 키(재지적: 가려짐).
      ...tagKey(paintBase(domeFaces3(0, -0.1, 0.58, 0.55, 4.35), "#bfe0ef"), 20),
      [groundEllipse(vx2, vy2, 0.3, 0.21), 0.55, "#ffffff"] as ShapeFace,
      // 가는 두 팔 — 앞-아래로 내려가 총몸을 받쳐 쥔다. 회흰색(요청).
      ...paintBase([
        ...hornFaces(-0.8, 0.1, 3.9, -0.6, 0.9, 2.9, 0.3),
        ...hornFaces(-0.6, 0.9, 2.9, 0.25, 1.7, 3.3, 0.26),
        ...hornFaces(0.85, 0.1, 3.9, 0.7, 0.8, 2.95, 0.3),
        ...hornFaces(0.7, 0.8, 2.95, 0.45, 1.2, 3.3, 0.26),
      ], "#d3d7db"),
      /* C-10 저격소총 — 마린과 같은 규칙(지적): 노리쇠는 상자, 총열은 관 프리미티브라
         총구가 요잉을 탄다. 마린보다 길고 가늘다. 건메탈. */
      ...paintBase(boxFaces3(0.4, 0.85, 0.3, 1.4, 0.34, 3.25), GUNMETAL),
      ...paintBase(tubeFaces(0.4, 1.5, 0.4, 3.6, 0.16, 3.42, true), GUNMETAL),
    ];
  },
  /* 파이어뱃(실물 참고) — 같은 파워드 아머에 어깨 위로 보이는 등 연료통 둘, 어두운
     바이저 슬릿, 앞으로 내민 굵은 화염 건틀릿 두 팔. */
  fbat: () => {
    const [vx2, vy2] = project(0, 0.55, 4.7);
    /* (삭제·지적: 총구가 요잉을 안 먹는다) — 화염 건틀릿 관에 capOpen을 줘 관이
       스스로 제 끝 단면(포구)을 그린다. */
    return [
      // 등 연료통 둘 — 먼저 그려 어깨가 뿌리를 덮는다. 붉은색(요청).
      ...paintBase([
        ...cylinderFaces3(-0.7, -1.3, 0.5, 2.4, 3.2),
        ...domeFaces3(-0.7, -1.3, 0.5, 0.4, 5.6),
        ...cylinderFaces3(0.7, -1.3, 0.5, 2.4, 3.2),
        ...domeFaces3(0.7, -1.3, 0.5, 0.4, 5.6),
      ], "#b83a2c"),
      // 다리를 또렷하게(지적: 다리가 없어 헷갈림) — 벌린 두 기둥 + 둥근 발.
      ...cylinderFaces3(-0.62, 0, 0.4, 2.3, 0.1),
      ...cylinderFaces3(0.62, 0, 0.4, 2.3, 0.1),
      ...domeFaces3(-0.62, 0.25, 0.5, 0.35, 0.05),
      ...domeFaces3(0.62, 0.25, 0.5, 0.35, 0.05),
      ...cylinderFaces3(0, -0.2, 1.25, 1.9, 2.3),
      ...domeFaces3(-1.5, -0.3, 0.95, 0.85, 3.6),
      ...domeFaces3(1.5, -0.3, 0.95, 0.85, 3.6),
      // 헬멧 유리색(요청) — 지붕 키(재지적: 몸통·어깨에 가려짐).
      ...tagKey(paintBase(domeFaces3(0, -0.2, 0.85, 0.8, 4.2), "#bfe0ef"), 20),
      [groundEllipse(vx2, vy2, 0.42, 0.24), 0.55, "#ffffff"] as ShapeFace,
      // 두 팔(요청) — 어깨에서 건틀릿 뿌리로.
      ...hornFaces(-1.45, -0.2, 4.9, -1.4, 0.6, 3.2, 0.5),
      ...hornFaces(1.45, -0.2, 4.9, 1.4, 0.6, 3.2, 0.5),
      // 화염 건틀릿 두 팔.
      // 앞으로 더 내민 화염 건틀릿(지적: 총구가 앞을 향하게).
      ...paintBase(tubeFaces(-1.4, 0.4, -1.4, 2.2, 0.42, 2.9, true), GUNMETAL),
      ...paintBase(tubeFaces(1.4, 0.4, 1.4, 2.2, 0.42, 2.9, true), GUNMETAL),
    ];
  },
  /* 질럿 — 검 두 자루(요청). */
  zealot: () => [
    // 다리·몸통은 프로토스 인간형 공통(요청) — 2관절 다리 + 앞으로 숙는 몸통.
    ...protossLegs(P_GOLD, P_GOLD),
    ...protossTorso(P_GOLD),
    /* 치마는 언제나 몸통 뒤(재재재지적: 아직도 가려짐) — 프러스텀의 반지름 깊이가
       요잉에 따라 몸통 막대를 이겨 앞으로 튀었다. 맨 뒤 고정 키로 못 박는다. */
    /* 치마를 첨탑기둥으로(요청: 둥글게) — 각진 프러스텀 대신 12각 기둥으로 세워
       아랫단이 넓고 허리로 갈수록 좁아지는 둥근 종 모양이 된다. 기둥은 아래에서 위로
       자라니 '치맛단 → 허리' 순으로 정의한다. 여전히 맨 뒤 고정 키(몸통에 안 튀게). */
    /* 더 작고 짧게(요청) — 치맛단 반지름 1.6 → 1.2, 길이 1.75 → 1.15로 줄이고 허리를
       올린다. 키도 고친다(요청): 맨 뒤 붙박이(-100)는 늘 다리 뒤로 밀려 안 보였다.
       회전 대칭이라 제 자리 깊이만으로 앞뒤가 옳게 갈린다. */
    ...tagKey(spirePillar({
      x: 0, y: -0.1, z0: 2.7, h: 1.15, w: 1.2, tipW: 0.82,
      segs: 3, sides: 12, hold: 0.12, taper: 0.7,
    }), depthNow(0, -0.1) * 1.6),
    // 얼굴 — 공통 턱주가리(요청). 뒤로 솟던 머리 뿔은 제거.
    /* 머리 깊이는 제 자리로(지적: 몸통에 안 가려짐) — 붙박이 키 20은 뒤에서 볼 때도
       머리가 몸통을 뚫고 나왔다. 앞으로 숙인 머리의 중심(y 0.4) 깊이를 쓰면 앞에선
       머리가, 뒤에선 몸통이 이긴다. */
    ...tagKey(protossFace(P_GOLD), depthNow(0, 0.4) + 0.7),
    /* 뒤통수 묶음머리(재지적: 한 마디 더·더 두껍게·더 곧게) — 끝은 금색 마감과
       플라즈마 불꽃. 다발은 개인색. */
    // 각도 더 낮춘다(재재지적) — 뒤로 갈수록 더 처진다.
    ...rodFaces(0, -0.7, 6.75, 0, -1.9, 5.75, 0.62),
    ...paintBase(rodFaces(0, -1.85, 5.79, 0, -2.15, 5.55, 0.72), P_GOLD),
    ...rodFaces(0, -2.1, 5.59, 0, -3.3, 4.5, 0.58),
    ...rodFaces(0, -3.25, 4.54, 0, -4.45, 3.4, 0.52),
    ...paintBase(rodFaces(0, -4.35, 3.49, 0, -4.7, 3.16, 0.6), P_GOLD),
    ...paintBase(domeFaces3(0, -4.95, 0.4, 0.38, 2.9), P_PLASMA),
    [groundEllipse(...project(0, -5.15, 3.1), 0.5, 0.5), 0.45, P_PLASMA] as ShapeFace,
    // 어깨 갑주 한 쌍 — 개인색.
    ...domeFaces3(-1.3, -0.25, 0.6, 0.48, 5.8),
    ...domeFaces3(1.3, -0.25, 0.6, 0.48, 5.8),
    /* 팔 두 마디(요청: 다리처럼 상완-하완, 손 대신 검) — 검은 하완과 1자로 이어진다. */
    ...paintBase(rodFaces(-1.3, -0.2, 5.7, -1.7, 0.15, 4.75, 0.52), P_GOLD),
    ...paintBase(rodFaces(-1.7, 0.15, 4.75, -2, 0.75, 4, 0.46), P_GOLD),
    ...paintBase(rodFaces(1.3, -0.2, 5.7, 1.7, 0.15, 4.75, 0.52), P_GOLD),
    ...paintBase(rodFaces(1.7, 0.15, 4.75, 2, 0.75, 4, 0.46), P_GOLD),
    /* 사이오닉 검 — 하완 방향 그대로. 색은 플라즈마(형광 푸른 흰색). */
    ...paintBase(hornFaces(1.95, 0.62, 4.15, 2.7, 2.1, 2.3, 0.7), P_PLASMA),
    [polyPath3([[2, 0.78, 4.05], [2.65, 2.05, 2.4], [2.52, 2.1, 2.25], [1.87, 0.83, 3.85]]), 0.75, "#ffffff"] as ShapeFace,
    ...paintBase(hornFaces(-1.95, 0.62, 4.15, -2.7, 2.1, 2.3, 0.7), P_PLASMA),
    [polyPath3([[-2, 0.78, 4.05], [-2.65, 2.05, 2.4], [-2.52, 2.1, 2.25], [-1.87, 0.83, 3.85]]), 0.75, "#ffffff"] as ShapeFace,
  ],
  /* 다크 템플러 — 검 한 자루(요청). */
  dtemp: () => [
    /* 망토(재지적: 더 들리고 끝단은 완만한 물결) — 어깨에서 시작해 뒤로 들린 자락,
       밑단은 지그재그가 아니라 사인 물결이다. 제 깊이를 달아 뒤에서 보면 몸 위로 온다. */
    ...tagKey(((): ShapeFace[] => {
      /* 어깨높이에 딱 붙고 몸통을 감싸듯 굽는다(재지적) — 어깨선은 가운데가 뒤로
         물러난 곡선(몸을 두른다), 옆구리를 지나 아래로 퍼지며, 자락은 아래로 갈수록
         뒤·위로 젖혀져 나부낀다. */
      const pts: [number, number, number][] = [
        [-1.32, -0.35, 5.85], [-0.7, -0.7, 6], [0, -0.8, 6.02], [0.7, -0.7, 6], [1.32, -0.35, 5.85],
        [1.85, -1.05, 4.5], [2.45, -1.95, 2.9], [2.7, -2.75, 1.9],
      ];
      for (let i = 0; i <= 10; i += 1) {
        const u = i / 10;
        // 밑단 — 완만한 물결에 바깥으로 갈수록 살짝 들린다.
        pts.push([2.55 - u * 5.1, -2.95 - Math.sin(u * Math.PI) * 0.35,
          1.5 + Math.sin(u * Math.PI * 2.5) * 0.55]);
      }
      pts.push([-2.7, -2.75, 1.9], [-2.45, -1.95, 2.9], [-1.85, -1.05, 4.5]);
      const d = polyPath3(pts);
      return [[d, 1] as ShapeFace, sideFace(d, 0.18)];
    })(), depthNow(0, -1.5) + 0.6),
    // 다리·몸통은 프로토스 인간형 공통(요청).
    ...protossLegs(P_GOLD, P_GOLD),
    ...protossTorso(P_GOLD),
    // 얼굴 — 공통 턱주가리(요청). 뒤로 솟던 머리 뿔은 제거.
    /* 머리 깊이는 제 자리로(지적: 몸통에 안 가려짐) — 붙박이 키 20은 뒤에서 볼 때도
       머리가 몸통을 뚫고 나왔다. 앞으로 숙인 머리의 중심(y 0.4) 깊이를 쓰면 앞에선
       머리가, 뒤에선 몸통이 이긴다. */
    ...tagKey(protossFace(P_GOLD), depthNow(0, 0.4) + 0.7),
    // 왼팔 두 마디 — 금색.
    ...paintBase(rodFaces(-1.05, -0.15, 5.65, -1.5, 0.4, 4.55, 0.5), P_GOLD),
    ...paintBase(rodFaces(-1.5, 0.4, 4.55, -1.1, 1.2, 3.7, 0.45), P_GOLD),
    /* 왼손 — 하이템플러식 큰 손: 흰 손바닥 + 긴 손가락 셋. */
    ...paintBase([
      ...domeFaces3(-1.1, 1.25, 0.34, 0.28, 3.5),
      ...hornFaces(-1.28, 1.3, 3.6, -1.42, 1.75, 3.1, 0.15),
      ...hornFaces(-1.08, 1.35, 3.6, -1.06, 1.85, 3.05, 0.15),
      ...hornFaces(-0.9, 1.28, 3.6, -0.75, 1.7, 3.1, 0.15),
    ], "#e9edf0"),
    /* 오른팔은 뒤로(요청) — 검을 뒤로 늘어뜨린 자세. 하완과 검이 1자다. */
    ...paintBase(rodFaces(1.05, -0.15, 5.65, 1.5, -0.9, 4.85, 0.5), P_GOLD),
    ...paintBase(rodFaces(1.5, -0.9, 4.85, 1.62, -1.55, 4.1, 0.45), P_GOLD),
    ...paintBase(hornFaces(1.6, -1.62, 3.95, 1.92, -2.85, 1.55, 0.75), P_PLASMA),
    [polyPath3([[1.66, -1.5, 3.8], [1.98, -2.75, 1.6], [1.85, -2.8, 1.5], [1.53, -1.55, 3.7]]), 0.75, "#ffffff"] as ShapeFace,
  ],
  /* 하이 템플러(요청) — 떠 있는 로브: 바닥에서 띄운 짧은 로브 통 + 머리, 발밑 부양 빛. */
  htemp: () => {
    const [gx, gy] = project(0, 0.2, 3.2);
    // 떠 있을 뿐 다리는 있다(요청) — 공통 다리·몸통을 통째로 띄운다.
    // 더 높이 띄운다(요청) — 0.8 → 1.6.
    const L = 1.6;
    return [
      topFace(groundEllipse(gx, gy, 1.6, 0.8), 0.3),
      // 다리는 금색(재지적) — 다리 길이 축소(요청): 엉덩이 축으로 0.68배.
      ...protossLegs(P_GOLD, P_GOLD, L, 0.68),
      ...protossTorso(P_GOLD, L),
      /* 앞가리개(요청) — 허리부터 발목까지. 몸에 딱 붙인다(재지적: 떠 보였다) —
         몸통 앞면(y 0.55)에 얹고 아래로 살짝만 벌어진다. */
      ...((): ShapeFace[] => {
        const d = polyPath3([
          [-0.42, 0.5, 4.8 + L], [0.42, 0.5, 4.8 + L],
          [0.34, 0.62, 1.3 + L], [-0.34, 0.62, 1.3 + L],
        ]);
        return [bodyFace(d), sideFace(d, 0.14)];
      })(),
      // 얼굴 — 공통 턱주가리(요청). 정수리 뿔·뒤 장식 뿔은 제거.
      ...tagKey(protossFace(P_GOLD, L), depthNow(0, 0.4) + 0.7),
      // 어깨 갑옷 한 쌍 — 개인색.
      ...domeFaces3(-1.15, -0.25, 0.55, 0.45, 5.8 + L),
      ...domeFaces3(1.15, -0.25, 0.55, 0.45, 5.8 + L),
      /* 팔 두 마디 — 상완 금색, 하완 개인색(요청). 살짝만 앞으로 든다. */
      /* 팔은 더 길고 더 높이 든다(요청: 마법 주문 자세) — 상완이 어깨에서 위·앞으로
         올라가고, 하완이 다시 위로 뻗어 손이 머리 높이를 넘는다. */
      ...paintBase(rodFaces(1.05, -0.2, 5.7 + L, 1.75, 0.5, 6.5 + L, 0.45), P_GOLD),
      ...rodFaces(1.75, 0.5, 6.5 + L, 1.5, 1.15, 7.9 + L, 0.38),
      ...paintBase(rodFaces(-1.05, -0.2, 5.7 + L, -1.75, 0.5, 6.5 + L, 0.45), P_GOLD),
      ...rodFaces(-1.75, 0.5, 6.5 + L, -1.5, 1.15, 7.9 + L, 0.38),
      /* 손(요청) — 흰색, 손가락 긴 형태. */
      ...paintBase([
        ...domeFaces3(1.48, 1.2, 0.26, 0.22, 7.95 + L),
        ...hornFaces(1.42, 1.25, 8 + L, 1.34, 1.7, 8.7 + L, 0.13),
        ...hornFaces(1.58, 1.2, 8 + L, 1.66, 1.62, 8.7 + L, 0.13),
        ...domeFaces3(-1.48, 1.2, 0.26, 0.22, 7.95 + L),
        ...hornFaces(-1.42, 1.25, 8 + L, -1.34, 1.7, 8.7 + L, 0.13),
        ...hornFaces(-1.58, 1.2, 8 + L, -1.66, 1.62, 8.7 + L, 0.13),
      ], "#e9edf0"),
    ];
  },
  /* 드라군(실물 참고) — 크고 둥근 금빛 껍데기 몸(앞 해치 슬릿), 굵게 꺾인 네 다리. */
  /* 드라군(재지적: 몸통 반으로 + 다리는 더 두꺼운 기계 느낌) — 작은 머리 돔에 굵은
     관절 다리 넷. */
  goon: () => {
    /* 다리 자체가 통(재재지적: 발만 통이 아니라) — 넓적다리·정강이를 뿔 대신 두께가
       끝까지 같은 캡슐 막대(rodFaces)로 잇고, 굵은 원기둥 발이 땅을 디딘다. */
    // 다리 금색(요청).
    /* 다리 전면 재작업(재재재지적: 아무리 해도 평면) — 대퇴·하지를 각각 사각 단면의
       각기둥·각뿔로 세운다. 사각이면 어느 각도에서도 두 면 이상이 보이고, 네 면에
       위·아래·좌·우 서로 다른 음영을 박아 두께가 늘 읽힌다. 사방 90도 배치. */
    const prism = (
      ax9: number, ay9: number, az9: number,
      bx9: number, by9: number, bz9: number,
      wA9: number, wB9: number,
    ): ShapeFace[] => {
      const dX = bx9 - ax9;
      const dY = by9 - ay9;
      const dZ = bz9 - az9;
      const hl9 = Math.hypot(dX, dY) || 1;
      // n: 축의 좌우(수평면 안), u: 축·n 모두에 수직(대략 위아래).
      const nX = -dY / hl9;
      const nY = dX / hl9;
      let uX = dY * 0 - dZ * nY;
      let uY = dZ * nX - dX * 0;
      let uZ = dX * nY - dY * nX;
      const ul9 = Math.hypot(uX, uY, uZ) || 1;
      uX /= ul9; uY /= ul9; uZ /= ul9;
      const quad = (cx9: number, cy9: number, cz9: number, w9: number): [number, number, number][] => [
        [cx9 + nX * w9 + uX * w9, cy9 + nY * w9 + uY * w9, cz9 + uZ * w9],
        [cx9 - nX * w9 + uX * w9, cy9 - nY * w9 + uY * w9, cz9 + uZ * w9],
        [cx9 - nX * w9 - uX * w9, cy9 - nY * w9 - uY * w9, cz9 - uZ * w9],
        [cx9 + nX * w9 - uX * w9, cy9 + nY * w9 - uY * w9, cz9 - uZ * w9],
      ];
      const A4 = quad(ax9, ay9, az9, wA9);
      const B4 = quad(bx9, by9, bz9, wB9);
      const side = (k9: number): string => polyPath3([A4[k9], A4[(k9 + 1) % 4], B4[(k9 + 1) % 4], B4[k9]]);
      /* 손수 칠한 네 면 음영은 걷었다(요청: "드라군 다리 음영을 제거하고 기본 음영
         렌더링만으로 입체감이 느껴질테니") — 위 0.18·오른 0.26·왼 0.46·아래 0.5에
         시청자 쪽 좌우까지 맞바꾸던 표다. 사각 단면이라 어느 각도에서도 두 면 이상이
         보이므로, 다른 모델과 같은 기본값(topFace·sideFace·capFace)만으로 두께가 읽힌다.
         면끼리 다른 값을 박을수록 각도가 돌 때 얼룩덜룩해지기도 했다. */
      const faces9: ShapeFace[] = [];
      // 아래 → 좌우 → 위 순서로 그려 밝은 면이 위에 온다.
      faces9.push(bodyFace(side(2)), sideFace(side(2)));
      faces9.push(bodyFace(side(1)), sideFace(side(1)));
      faces9.push(bodyFace(side(3)), sideFace(side(3)));
      faces9.push(bodyFace(side(0)), topFace(side(0)));
      // 끝 단면 — 무릎·발끝 마감.
      faces9.push(bodyFace(polyPath3(B4)), capFace(polyPath3(B4)));
      return faces9;
    };
    const leg = (ang: number): ShapeFace[] => {
      const a = (ang * Math.PI) / 180;
      const dx = Math.sin(a);
      const dy = Math.cos(a);
      /* 굵기 감소 + 관절 겹침 제거(재지적: 각도에 따라 이상해 보임) — 무릎에서 두
         마디가 같은 자리를 물고 있어 모서리가 엇갈렸다. 대퇴는 무릎 못 미쳐 끝내고
         하지는 무릎 조금 아래서 시작해, 사이를 작은 관절 덩이가 잇는다. */
      return tagKey(paintBase([
        // 대퇴 — 엉덩이에서 무릎 앞까지, 가늘어진 사각기둥.
        ...prism(dx * 0.9, dy * 0.9, 4.5, dx * 3.15, dy * 3.15, 5.4, 0.56, 0.6),
        // 관절 — 두 마디를 잇는 작은 덩이. 다리 면에 안 묻히게 위로(지적).
        ...tagKey(domeFaces3(dx * 3.3, dy * 3.3, 0.62, 0.5, 5.15), 8),
        // 하지 — 무릎 아래에서 발끝으로 좁아지는 사각뿔.
        ...prism(dx * 3.45, dy * 3.45, 5.15, dx * 4.05, dy * 4.05, 0.25, 0.6, 0.26),
      ], "#d4af37"), depthNow(dx * 2.4, dy * 2.4));
    };
    const [gx2, gy2] = project(-0.5, -0.5, 5.8);
    return [
      ...leg(180), ...leg(-90), ...leg(90),
      ...domeFaces3(0, -0.1, 1.6, 1.5, 4.4),
      capFace(polyPath3([[-0.5, 1.4, 5.2], [0.5, 1.4, 5.2], [0.36, 1.56, 4.75], [-0.36, 1.56, 4.75]]), 0.4),
      topFace(groundEllipse(gx2, gy2, 0.6, 0.4), 0.25),
      ...leg(0),
    ];
  },
  /* 아콘(실물 참고) — 반투명 발광 구 속에 어두운 형체가 비친다: 뾰족한 머리, 몸통,
     길게 늘어지는 두 팔. */
  archon: () => {
    const [cx, cy] = project(0, 0, 5);
    /* 속 형체도 입체(재지적) — 종잇장 평면 사상 대신 진짜 3D 부품(돔 몸통·뿔 머리·
       뿔 팔)을 어두운 실루엣으로 겹친다: 프리미티브의 몸판 패스만 받아 검정 반투명
       한 겹으로 칠하면, 요잉에 자연히 돌고 어느 각에서도 부피가 산다. */
    const dark = (faces: ShapeFace[], o: number): ShapeFace[] =>
      faces.filter(([, fo, fill]) => fo === 1 && !fill).map(([d]) => [d, o, "#000"] as ShapeFace);
    /* 1.4배 + 모양 개선(요청) — 밝은 청백 에너지 소용돌이 구로: 사람 색 구 위에 옅은
       청백 워시와 번개 호를 얹어 다크 아콘(어두운 보라+핏빛)과 확실히 갈린다. */
    /* 개인색은 구를 감싸는 고리 둘(재지적: 띠 하나가 아니라 링 두 개가 X자로 교차) —
       가락지라 가운데가 뚫려야 한다: 바깥 타원과 안쪽 타원의 감는 방향을 반대로 둬
       (호 sweep 0/1) 도넛으로 채운다. 서로 반대로 기운 둘이 옆에서 X자로 엇갈린다.
       속 형체를 다 그린 뒤 맨 위에 얹어 구 '겉'을 감싼다. */
    /* 반쪽씩 나눠 감는다(재지적: 각도는 더 눕히고, 굵기는 확 줄이고, 키값 수정) —
       한 장짜리 가락지를 통째로 맨 위에 얹으면 늘 구 앞에 떠 있어 '감싼' 것으로 안
       읽힌다. 먼 반쪽(호 sweep 0 = 화면 위쪽)은 구보다 먼저, 가까운 반쪽(sweep 1)은
       속 형체까지 다 그린 뒤 맨 나중에 그린다 — 배열 차례가 곧 앞뒤다. */
    const bandHalf = (deg9: number, sw9: 0 | 1): ShapeFace => {
      const t9 = (deg9 * Math.PI) / 180;
      const R9 = 5.05;
      const r9 = 1.05; // 더 눕힌다(1.7 → 1.05)
      const W9 = 0.2; // 굵기 대폭 감소(0.62 → 0.2)
      const px9 = (d9: number): [number, number] =>
        [cx + d9 * Math.cos(t9), cy + d9 * Math.sin(t9)];
      const [oax, oay] = px9(-R9);
      const [obx, oby] = px9(R9);
      const Ri9 = R9 - W9;
      const ri9 = Math.max(0.12, r9 - W9);
      const [iax, iay] = px9(-Ri9);
      const [ibx, iby] = px9(Ri9);
      return [`M${oax} ${oay} A${R9} ${r9} ${deg9} 0 ${sw9} ${obx} ${oby}`
        + ` L${ibx} ${iby} A${Ri9} ${ri9} ${deg9} 0 ${sw9 === 0 ? 1 : 0} ${iax} ${iay} Z`,
      0.95] as ShapeFace;
    };
    return [
      // 먼 반쪽 고리 — 구보다 먼저 그려 구 뒤로 돌아간다. 둘은 거의 직각으로 엇갈린다(요청).
      bandHalf(46, 0), bandHalf(-46, 0),
      // 에너지구는 플라즈마색, 개인색은 가운데 띠만(요청).
      // 에너지구 반투명화(요청) — 속 형체가 비쳐 보이게 0.72 → 0.4.
      [groundEllipse(cx, cy, 5.1, 4.8), 0.4, "#dff0ff"] as ShapeFace,
      topFace(groundEllipse(cx, cy, 5.1, 4.8), 0.14),
      // 몸통 — 낮은 타원 돔. 머리 불꽃 — 위로 솟는 뿔. 팔 — 어깨에서 밖·아래로.
      ...dark(domeFaces3(0, 0, 1.35, 2.7, 3.2), 0.35),
      // 머리는 공통 얼굴 실루엣(요청: 뒤로 솟은 뿔 제거).
      ...dark(protossFace(undefined, -0.9), 0.4),
      // 팔 마디(재지적) — 팔꿈치에서 한 번 꺾인다.
      ...dark(hornFaces(-0.9, 0.2, 5.9, -1.9, 0.55, 4.6, 0.7), 0.35),
      ...dark(hornFaces(-1.9, 0.55, 4.6, -2.6, 1, 3, 0.55), 0.35),
      ...dark(hornFaces(0.9, 0.2, 5.9, 1.9, 0.55, 4.6, 0.7), 0.35),
      ...dark(hornFaces(1.9, 0.55, 4.6, 2.6, 1, 3, 0.55), 0.35),
      // 에너지 번개 호 — 구면을 타는 청백 실선 둘.
      [`M${cx - 4.2} ${cy - 1.6} Q${cx - 1.2} ${cy - 4.4} ${cx + 2.4} ${cy - 3.4}`
        + ` L${cx + 2.2} ${cy - 3.1} Q${cx - 1.1} ${cy - 4} ${cx - 3.9} ${cy - 1.4} Z`, 0.8, "#eaf6ff"] as ShapeFace,
      [`M${cx + 4.4} ${cy + 0.6} Q${cx + 1.8} ${cy + 3.6} ${cx - 2.2} ${cy + 3.2}`
        + ` L${cx - 2} ${cy + 2.9} Q${cx + 1.6} ${cy + 3.2} ${cx + 4.1} ${cy + 0.4} Z`, 0.6, "#cfe6ff"] as ShapeFace,
      topFace(groundEllipse(cx - 1.7, cy - 1.7, 1.9, 1.5), 0.4),
      // 가까운 반쪽 고리 — 맨 나중에 그려 구 앞을 지난다.
      bandHalf(46, 1), bandHalf(-46, 1),
    ];
  },
  /* 다크 아콘(실물 참고) — 어두운 반투명 구 속에 뿔귀 머리와 갈퀴 팔의 형체가 비치고,
     구 밖으로 가는 수염 호가 흩날린다. */
  darchon: () => {
    const [cx, cy] = project(0, 0, 5);
    // 속 형체도 입체(재지적) — 아콘과 같은 dark() 기법. 수염 호·광택은 구 둘레 장식.
    const dark = (faces: ShapeFace[], o: number): ShapeFace[] =>
      faces.filter(([, fo, fill]) => fo === 1 && !fill).map(([d]) => [d, o, "#000"] as ShapeFace);
    /* 1.4배 + 구분 강화(요청) — 어두운 보랏빛 워시와 핏빛 글린트로 아콘(청백)과
       한눈에 갈린다. 수염 호는 그대로 비례 확대. */
    /* 개인색은 구를 감싸는 고리 둘(재지적: 띠 하나가 아니라 링 두 개가 X자로 교차) —
       가락지라 가운데가 뚫려야 한다: 바깥 타원과 안쪽 타원의 감는 방향을 반대로 둬
       (호 sweep 0/1) 도넛으로 채운다. 서로 반대로 기운 둘이 옆에서 X자로 엇갈린다.
       속 형체를 다 그린 뒤 맨 위에 얹어 구 '겉'을 감싼다. */
    /* 반쪽씩 나눠 감는다(재지적: 각도는 더 눕히고, 굵기는 확 줄이고, 키값 수정) —
       한 장짜리 가락지를 통째로 맨 위에 얹으면 늘 구 앞에 떠 있어 '감싼' 것으로 안
       읽힌다. 먼 반쪽(호 sweep 0 = 화면 위쪽)은 구보다 먼저, 가까운 반쪽(sweep 1)은
       속 형체까지 다 그린 뒤 맨 나중에 그린다 — 배열 차례가 곧 앞뒤다. */
    const bandHalf = (deg9: number, sw9: 0 | 1): ShapeFace => {
      const t9 = (deg9 * Math.PI) / 180;
      const R9 = 5.05;
      const r9 = 1.05; // 더 눕힌다(1.7 → 1.05)
      const W9 = 0.2; // 굵기 대폭 감소(0.62 → 0.2)
      const px9 = (d9: number): [number, number] =>
        [cx + d9 * Math.cos(t9), cy + d9 * Math.sin(t9)];
      const [oax, oay] = px9(-R9);
      const [obx, oby] = px9(R9);
      const Ri9 = R9 - W9;
      const ri9 = Math.max(0.12, r9 - W9);
      const [iax, iay] = px9(-Ri9);
      const [ibx, iby] = px9(Ri9);
      return [`M${oax} ${oay} A${R9} ${r9} ${deg9} 0 ${sw9} ${obx} ${oby}`
        + ` L${ibx} ${iby} A${Ri9} ${ri9} ${deg9} 0 ${sw9 === 0 ? 1 : 0} ${iax} ${iay} Z`,
      0.95] as ShapeFace;
    };
    return [
      // 먼 반쪽 고리 — 구보다 먼저 그려 구 뒤로 돌아간다. 둘은 거의 직각으로 엇갈린다(요청).
      bandHalf(46, 0), bandHalf(-46, 0),
      // 에너지구는 붉은색, 개인색은 가운데 띠만(요청).
      // 에너지구 반투명화(요청) — 0.7 → 0.38.
      [groundEllipse(cx, cy, 5.1, 4.8), 0.38, "#8a2833"] as ShapeFace,
      [groundEllipse(cx, cy, 5.1, 4.8), 0.16, "#c03a3a"] as ShapeFace,
      capFace(groundEllipse(cx, cy, 5.1, 4.8), 0.16),
      // 속 형체 — 낮은 돔 몸통, 벌어진 뿔귀 둘, 아래로 늘어지는 갈퀴 팔.
      ...dark(domeFaces3(-0.15, 0.15, 1.25, 2.4, 3.4), 0.45),
      // 머리는 공통 얼굴 실루엣(요청: 뿔귀 제거).
      ...dark(protossFace(undefined, -1), 0.5),
      // 갈퀴 팔 마디(재지적).
      ...dark(hornFaces(-0.5, 0.35, 4.2, -1.1, 0.7, 3.1, 0.65), 0.45),
      ...dark(hornFaces(-1.1, 0.7, 3.1, -1.7, 1.3, 2, 0.5), 0.45),
      // 핏빛 글린트 — 구면 위 붉은 광 조각 둘.
      [groundEllipse(cx + 1.9, cy - 1.1, 0.8, 0.55), 0.55, "#ff5d5d"] as ShapeFace,
      [groundEllipse(cx - 1.3, cy + 1.7, 0.55, 0.4), 0.45, "#ff8080"] as ShapeFace,
      // 바깥 수염 호 — 가늘게 흩날린다.
      topFace(`M${cx - 4.4} ${cy - 2.7} Q${cx - 6.5} ${cy - 0.8} ${cx - 5.8} ${cy + 1.4}`
        + ` L${cx - 5.5} ${cy + 1.3} Q${cx - 6.1} ${cy - 0.7} ${cx - 4.2} ${cy - 2.5} Z`, 0.4),
      topFace(`M${cx + 4.1} ${cy - 3.1} Q${cx + 6.4} ${cy - 2} ${cx + 6.5} ${cy + 0.3}`
        + ` L${cx + 6.2} ${cy + 0.35} Q${cx + 5.9} ${cy - 1.7} ${cx + 3.9} ${cy - 2.8} Z`, 0.35),
      topFace(groundEllipse(cx - 1.7, cy - 1.7, 1.7, 1.3), 0.3),
      // 가까운 반쪽 고리 — 맨 나중에 그려 구 앞을 지난다.
      bandHalf(46, 1), bandHalf(-46, 1),
    ];
  },
  /* 저글링·히드라·울트라(요청: 전용 모델) — 갈고리는 직선이 아니라 3단으로 휘어진다:
     밖-앞으로 → 앞으로 → 안-아래로 말리는 세 마디. 덩치별로 몸과 갈고리 크기가 다르다. */
  /* 저글링(실물 참고) — 웅크린 네발 몸, 등의 날개 볏 돛 한 쌍, 앞 낮은 턱 머리, 꼬리. */
  zling: () => [
    // 꼬리 검회색, 다리·팔 짙은 갈색(재지적), 발톱 상아색 유지.
    ...paintBase(hornFaces(0, -1.6, 3.6, 0, -3.2, 3.3, 0.5), "#3a3f46"),
    ...paintBase(hornFaces(-0.9, -0.8, 3.6, -1.6, -1.4, 2.1, 0.45), "#6b4732"),
    ...ivory(hornFaces(-1.43, -1.25, 2.48, -1.6, -1.4, 2.1, 0.3)),
    ...paintBase(hornFaces(0.9, -0.8, 3.6, 1.6, -1.4, 2.1, 0.45), "#6b4732"),
    ...ivory(hornFaces(1.43, -1.25, 2.48, 1.6, -1.4, 2.1, 0.3)),
    ...domeFaces3(0, -0.4, 1.3, 1.1, 3.2),
    // 등 날개 볏 — 스커지 날개색(요청).
    [polyPath3([[-0.4, -0.6, 4.2], [-1.5, -1.7, 6.3], [-0.9, -0.2, 5.6], [-0.3, 0, 4.4]]), 1, "#c68a62"] as ShapeFace,
    sideFace(polyPath3([[-0.4, -0.6, 4.2], [-1.5, -1.7, 6.3], [-0.9, -0.2, 5.6], [-0.3, 0, 4.4]]), 0.16),
    [polyPath3([[0.4, -0.6, 4.2], [1.5, -1.7, 6.3], [0.9, -0.2, 5.6], [0.3, 0, 4.4]]), 1, "#c68a62"] as ShapeFace,
    topFace(polyPath3([[0.4, -0.6, 4.2], [1.5, -1.7, 6.3], [0.9, -0.2, 5.6], [0.3, 0, 4.4]]), 0.14),
    ...paintBase(hornFaces(-0.8, 0.6, 3.4, -1.3, 1.4, 2, 0.4), "#6b4732"),
    ...ivory(hornFaces(-1.18, 1.2, 2.35, -1.3, 1.4, 2, 0.28)),
    ...paintBase(hornFaces(0.8, 0.6, 3.4, 1.3, 1.4, 2, 0.4), "#6b4732"),
    ...ivory(hornFaces(1.18, 1.2, 2.35, 1.3, 1.4, 2, 0.28)),
    /* 어깨 갈고리낫 한 쌍(지적: 얼굴 양옆 어깨에서 올라오는, 위가 볼록한 낫) —
       어깨 뿌리에서 위로 솟았다가 볼록한 꼭대기를 지나 앞아래로 낫끝이 말린다. */
    // 갈고리 앞팔 윗부분 — 짙은 갈색(재지적: 팔도 갈색으로).
    ...paintBase(hornFaces(-0.85, 0.7, 3.4, -1.4, 1.15, 5.1, 0.42), "#6b4732"),
    ...ivory(hornFaces(-1.4, 1.15, 5.1, -1.2, 2.4, 3.9, 0.3)),
    ...paintBase(hornFaces(0.85, 0.7, 3.4, 1.4, 1.15, 5.1, 0.42), "#6b4732"),
    ...ivory(hornFaces(1.4, 1.15, 5.1, 1.2, 2.4, 3.9, 0.3)),
    // 얼굴 갈색(요청).
    ...paintBase(domeFaces3(0, 1.2, 0.95, 0.8, 3.1), "#8a5f43"),
    capFace(polyPath3([[-0.45, 2, 3.35], [0.45, 2, 3.35], [0.3, 2.25, 3.15], [-0.3, 2.25, 3.15]]), 0.4),
  ],
  /* 히드라리스크(단순화) — 낮은 받침 꼬리 돔 위에 세운 몸, 낫팔 한 쌍, 작은 머리와
     뒤로 흐르는 두건. */
  hydra: () => {
    /* 머리장식 더 넙적하게(재지적: 특히 윗부분이 넓게) — 꼭대기를 한 점이 아니라
       넓은 윗변으로 편다. */
    const hood = polyPath3([[0.65, 0.3, 7.1], [1.7, -1.4, 8.3], [1.35, -2.45, 8.8], [-1.35, -2.45, 8.8], [-1.7, -1.4, 8.3], [-0.65, 0.3, 7.1]]);
    /* 매끈한 뱀꼬리(재지적: 애벌레 마디가 아니라 몸과 꼬리가 한 덩어리 — 배를 땅에
       대고 걷고 그쪽이 둥글게 굽는다) — 몸통 뿌리 폭에서 한 곡선으로 가늘어져 끝이
       점이 되는 실루엣 한 장 + 등마루 하이라이트 한 줄. */
    /* 꼬리 뿌리는 몸통 지름(1.05)에 맞춤(지적: 시작부가 몸통보다 두꺼워 삐져나옴). */
    const tailR: [number, number, number][] = [
      [1.02, -0.2, 1.4], [0.82, -1.4, 0.85], [0.56, -2.7, 0.48], [0.3, -3.9, 0.22], [0, -5.1, 0.08],
    ];
    const tailPts = [
      ...tailR,
      ...[...tailR].reverse().slice(1).map(([x, y, z]) => [-x, y, z] as [number, number, number]),
    ];
    void tailPts;
    return [
      /* 몸통 아래~꼬리 끝을 한 기둥으로(요청) — 납작한 꼬리 판을 걷고, 공용 도형
         spirePillar를 뒤·아래로 크게 휘어 세운다. 위(허리)에서 굵고 꼬리 끝으로
         갈수록 가늘어져 한 몸으로 이어진다. 짙은 살색. */
      /* 꼬리는 거의 L자(재지적) — 바닥에 눕는 꼬리와 곧게 선 하반신이 직각으로 꺾여
         만난다. 눕는 마디는 낮은 기둥을 뒤로 길게 눕혀 만들고, 선 마디는 그 꺾임점
         에서 허리(z 3.6, 굵기 1.05)까지 올려 상반신과 굵기가 딱 맞게 잇는다. */
      /* 꼬리와 하반신을 관절 없이 한 몸으로(요청) — 축을 이차 베지어로 그려 바닥을
         따라 뒤로 뻗다가 급히 위로 꺾여 허리로 이어진다. 꼬리 끝은 가늘고 허리는
         굵으며, 배(앞)는 상아색·등(뒤)은 짙은 갈색. */
      ...tagKey(spirePillar({
        x: 0, y: 0, h: 1, w: 0.12, tipW: 1.05,
        segs: 9, sides: 8, hold: 0,
        /* 축은 삼차 베지어(재지적) — 꼬리 끝에서 바닥을 따라 뒤로 뻗다가, 허리로
           오르는 구간에서 한 번 앞으로 기울었다가 확 뒤로 꺾인다. 제어점 둘로 S자를
           만든다: P0 꼬리끝 → C1 앞·낮게 → C2 뒤·높게 → P3 허리. */
        path: (t9: number): [number, number, number] => {
          const u9 = 1 - t9;
          const bez = (p0: number, c1: number, c2: number, p3: number): number =>
            u9 * u9 * u9 * p0 + 3 * u9 * u9 * t9 * c1 + 3 * u9 * t9 * t9 * c2 + t9 * t9 * t9 * p3;
          /* 갈고리 꼬리(재지적: 요잉 180도) — 끝이 뒤·바닥에 놓이고 앞으로 크게 감아
             돌아 허리로 올라온다. y 부호를 뒤집었다. */
          return [0, bez(-3.2, -2.4, 3.4, 0), bez(0.12, 0.05, 1.1, 3.6)];
        },
        // 180도 돌아 앞뒤가 바뀌므로 배·등 색도 맞바꾼다(배는 여전히 상아색).
        fill: "#c68a62", fillFront: "#6b4732", fillBack: IVORY,
      }), 6),
      // 꼬리 등의 자잘한 짙은 상아색 가시들(요청).
      ...paintBase(hornFaces(0.25, -1.5, 1.15, 0.5, -1.85, 2, 0.28), IVORY_DEEP),
      ...paintBase(hornFaces(-0.2, -2.5, 0.75, -0.45, -2.85, 1.55, 0.24), IVORY_DEEP),
      ...paintBase(hornFaces(0.15, -3.5, 0.45, 0.35, -3.85, 1.15, 0.2), IVORY_DEEP),
      /* 몸기둥 — 아래 절반은 짙은 살색 원통 그대로, 위 절반은 뒤로 살짝 휘는 스파이어
         기둥(요청) — 공용 도형 spirePillar로 세워 어깨 쪽으로 갈수록 굵기가 줄며
         뒤로 젖혀진다. 개인색. */
      // (제거) 아래 원통 — 위 기둥이 꼬리까지 한 몸으로 잇는다.
      ...tagKey(spirePillar({
        x: 0, y: 0, z0: 3.5, h: 3.1, w: 1.05, tipW: 0.78,
        segs: 4, sides: 8, curveY: -0.85, hold: 0.2,
      }), 10),
      /* 팔은 굽히기(재지적) + 넥서스 기둥식 이음(재재지적: 갈고리와 팔이 자연스럽게)
         — 팔 두 마디는 끝이 안 뾰족한 캡슐 막대(rodFaces), 갈고리는 손목 살짝 안에서
         팔보다 조금 굵게 시작해 '도려내고 꽂은' 소켓처럼 잇는다. 오르는 마디는 굵기
         일정한 막대, 꼭대기에서 꺾여 내려오는 마디만 끝이 점으로 가늘어진다. */
      /* 상완부 근육질(요청) — 굵은 막대 + 이두 불룩. */
      /* 팔은 몸통 기둥(키 10) 앞에(지적: 팔이 몸통에 가려짐) — 프리미티브 제 깊이는
         기둥의 층 키에 눌렸다. 어깨 앞 자리로 재 한 단 위에 얹는다. */
      ...tagKey([
        ...rodFaces(-0.8, 0.25, 5.3, -1.9, 0.7, 4.2, 0.85),
        ...domeFaces3(-1.3, 0.45, 0.55, 0.45, 4.75),
        ...rodFaces(-1.9, 0.7, 4.2, -2.5, 1.15, 5.4, 0.45),
        ...ivory(rodFaces(-2.44, 1.1, 5.28, -2.9, 1.5, 6.9, 0.55)),
        ...ivory(hornFaces(-2.9, 1.5, 6.9, -3.15, 2.1, 4.3, 0.55)),
      ], 11 + depthNow(-1.7, 0.7) * 1.6),
      ...tagKey([
        ...rodFaces(0.8, 0.25, 5.3, 1.9, 0.7, 4.2, 0.85),
        ...domeFaces3(1.3, 0.45, 0.55, 0.45, 4.75),
        ...rodFaces(1.9, 0.7, 4.2, 2.5, 1.15, 5.4, 0.45),
        ...ivory(rodFaces(2.44, 1.1, 5.28, 2.9, 1.5, 6.9, 0.55)),
        ...ivory(hornFaces(2.9, 1.5, 6.9, 3.15, 2.1, 4.3, 0.55)),
      ], 11 + depthNow(1.7, 0.7) * 1.6),
      /* 얼굴·머리장식 갈색(요청) — 무깊이 두건이 직전 깊이를 물려받아 얼굴을 덮었다
         (재지적: zsorted 상속) — 제 깊이를 달아 앞에선 얼굴이, 뒤에선 두건이 이긴다. */
      // 머리장식 개인색(재지적).
      /* 얼굴은 몸통 기둥(키 10)보다 위(재지적: 얼굴이 몸통에 가려짐) — 상반신을
         스파이어 기둥으로 바꾸며 기둥이 큰 층 키를 갖게 돼 얼굴이 묻혔다.
         두건은 그보다 한 단 아래에 둬 앞에선 얼굴이, 뒤에선 두건이 이긴다. */
      /* 두건과 얼굴을 같은 자로 잰다(재지적: 머리장식이 얼굴에 가려짐) — 붙박이
         12/14는 뒤에서 봐도 얼굴이 이겨, 머리 뒤에 있는 두건이 늘 묻혔다. 같은
         밑절미(12)에 제 자리 깊이를 얹으면 앞에선 얼굴이, 뒤에선 두건이 이긴다. */
      ...tagKey([[hood, 1] as ShapeFace, topFace(hood, 0.14)], 12 + depthNow(0, -1.1) * 1.6),
      ...tagKey(paintBase(domeFaces3(0, 0.2, 0.75, 0.6, 6.8), "#8a5f43"),
        12 + depthNow(0, 0.2) * 1.6),
    ];
  },
  /* 울트라리스크(실물 참고) — 코끼리 다리 넷의 거체, 어깨에서 크게 휘는 거대 카이저
     낫 두 자루. */
  ultra: () => [
    /* 다리를 스파이어 기둥으로(요청) — 코끼리 다리 넷이 위로 갈수록 살짝 얇아지며
       부드럽게 안으로 굽는다. 짙은 갈색. */
    ...([[-2, -2], [2, -2], [-2.2, 1.1], [2.2, 1.1]] as [number, number][])
      .flatMap(([lx9, ly9]): ShapeFace[] => spirePillar({
        x: lx9, y: ly9, z0: 0.25, h: 3.15, w: 0.86, tipW: 0.66,
        segs: 4, sides: 8, hold: 0.15,
        leanX: -lx9 * 0.12, leanY: -ly9 * 0.1,
        curveX: -lx9 * 0.16, curveY: -ly9 * 0.12,
        fill: "#6b4732",
      })),
    ...domeFaces3(0, -0.9, 3.2, 3, 3.4),
    // 머리 축소(요청) — 2×1.6 → 1.5×1.2. 갈고리도 그만큼 안·아래로 당긴다.
    ...paintBase(domeFaces3(0, 1.75, 1.5, 1.2, 3.9), "#6b4732"),
    ...ivory(claw3(1, 1.7, 4.95)),
    ...ivory(claw3(-1, 1.7, 4.95)),
  ],
  /* 러커(실물 참고) — 넓은 가시 등딱지, 사방으로 벌린 낫 칼다리 두 쌍(끝이 안으로
     말림), 앞 입. */
  lurker: () => {
    const out: ShapeFace[] = [];
    for (const m2 of [1, -1] as const) {
      /* 칼다리는 꺽쇠(재재지적: 더 완만하게) — 뿌리에서 바깥·위로 살짝만 올라
         꼭대기를 찍고, 완만한 각도로 내려와 땅을 짚는다. 내려오는 끝마디는
         상아색 발톱(지적)이다. */
      // 뒤 칼다리 — 윗마디 더 길게(지적) + 검회색(요청).
      out.push(...paintBase(hornFaces(m2 * 1.5, -0.9, 3.8, m2 * 3.5, -2.1, 4.35, 0.7), "#3a3f46"));
      out.push(...ivory(hornFaces(m2 * 3.5, -2.1, 4.35, m2 * 4.7, -3, 1.4, 0.5)));
      // 앞 칼다리 — 윗마디 더 길게(지적) + 검회색(요청).
      out.push(...paintBase(hornFaces(m2 * 1.6, 0.6, 3.8, m2 * 3.6, 1.7, 4.35, 0.7), "#3a3f46"));
      out.push(...ivory(hornFaces(m2 * 3.6, 1.7, 4.35, m2 * 4.8, 2.5, 1.4, 0.5)));
      /* 앞 가시갈고리 한 쌍(지적) — 몸 앞에서 앞을 향해 뻗다 끝이 갈고리처럼
         아래로 말린다. 상부 검회색(재지적). */
      out.push(...paintBase(hornFaces(m2 * 0.6, 1.9, 3.5, m2 * 1.1, 3.4, 2.3, 0.42), "#3a3f46"));
      out.push(...ivory(hornFaces(m2 * 1.1, 3.4, 2.3, m2 * 0.8, 4.1, 0.5, 0.28)));
    }
    // 꽁무니 다리 하나 더(지적) — 뒤 가운데에서 뒤로 뻗어 땅을 짚는다.
    // 꽁무니 다리도 꺽쇠(재지적: 뒷다리도 그렇게) — 완만히 올랐다 내려온다.
    out.push(...paintBase(hornFaces(0, -1.5, 3.6, 0, -3.2, 4.5, 0.6), "#3a3f46"));
    out.push(...ivory(hornFaces(0, -3.2, 4.5, 0, -4.6, 1.2, 0.42)));
    // 넓은 등딱지 + 등 가시들.
    out.push(...domeFaces3(0, -0.2, 2.5, 2, 3.4));
    // 등 가시들 검회색(요청).
    out.push(...paintBase(hornFaces(-0.9, -0.9, 5, -1.3, -1.3, 6.2, 0.4), "#3a3f46"));
    out.push(...paintBase(hornFaces(0.9, -0.9, 5, 1.3, -1.3, 6.2, 0.4), "#3a3f46"));
    out.push(...paintBase(hornFaces(0, -0.2, 5.4, 0, -0.4, 6.7, 0.45), "#3a3f46"));
    out.push(...paintBase(hornFaces(-0.7, 0.7, 5, -1, 1, 6, 0.38), "#3a3f46"));
    out.push(...paintBase(hornFaces(0.7, 0.7, 5, 1, 1, 6, 0.38), "#3a3f46"));
    // 앞 입 — 머리 갈색(요청).
    out.push(...paintBase(domeFaces3(0, 1.7, 1, 0.75, 3.2), "#8a5f43"));
    out.push(capFace(polyPath3([[-0.5, 2.4, 3.5], [0.5, 2.4, 3.5], [0.35, 2.65, 3.3], [-0.35, 2.65, 3.3]]), 0.42));
    return out;
  },
  /* 디파일러(재정정: 몸이 납작하고 길며 꼬리로 갈수록 가늘어짐 + 다리 여섯이 전부
     몸 앞쪽에 붙어 앞을 향함) — 사마귀처럼 앞에 몰린 다리와, 뒤로 길게 끌리는
     마디 배. */
  defiler: () => {
    const out: ShapeFace[] = [];
    // 다리 여섯 — 양쪽 3개씩, 뿌리가 다 앞몸(y 1.3~2)에 있고 앞·바깥으로 뻗는다.
    for (const m2 of [1, -1] as const) {
      // 다리 검회색(요청) — 발톱은 상아색 유지.
      out.push(...paintBase(hornFaces(m2 * 0.55, 2, 1.7, m2 * 1.1, 3.6, 0.1, 0.34), "#3a3f46"));
      out.push(...ivory(hornFaces(m2 * 0.96, 3.2, 0.5, m2 * 1.1, 3.6, 0.1, 0.24)));
      out.push(...paintBase(hornFaces(m2 * 0.75, 1.65, 1.7, m2 * 1.9, 3.2, 0.1, 0.36), "#3a3f46"));
      out.push(...ivory(hornFaces(m2 * 1.61, 2.81, 0.5, m2 * 1.9, 3.2, 0.1, 0.26)));
      out.push(...paintBase(hornFaces(m2 * 0.95, 1.3, 1.7, m2 * 2.6, 2.7, 0.1, 0.38), "#3a3f46"));
      out.push(...ivory(hornFaces(m2 * 2.19, 2.35, 0.5, m2 * 2.6, 2.7, 0.1, 0.28)));
    }
    // 납작한 앞몸(머리·가슴) — 짙은 갈색(요청: 꼬리 말고 몸통·머리).
    out.push(...paintBase(domeFaces3(0, 1.9, 0.75, 0.55, 1.5), "#6b4732"));
    out.push(...paintBase(domeFaces3(0, 1, 1.05, 0.8, 1.4), "#6b4732"));
    // 긴 배 — 뒤로 갈수록 반지름·높이가 주는 마디 넷 + 꼬리끝 뿔.
    out.push(...domeFaces3(0, -0.2, 0.95, 0.7, 1.3));
    out.push(...domeFaces3(0, -1.4, 0.78, 0.58, 1.2));
    out.push(...domeFaces3(0, -2.5, 0.6, 0.46, 1.1));
    out.push(...domeFaces3(0, -3.4, 0.44, 0.36, 1));
    out.push(...hornFaces(0, -3.7, 1.2, 0, -4.8, 0.3, 0.3));
    // 앞 더듬이 한 쌍 — 위로 굽는 가는 뿔(원안 유지).
    out.push(...hornFaces(0.25, 2.3, 1.9, 1.5, 4.2, 3.2, 0.16));
    out.push(...hornFaces(-0.25, 2.3, 1.9, -1.5, 4.2, 3.2, 0.16));
    return out;
  },

  /* 오버로드 — 풍선 몸통(요잉 불변) + 곤충 다리 셋(요청: 촉수·칼이 아니라 무릎이 꺾인
     곤충 다리) — 윗마디는 바깥-아래로, 아랫마디는 무릎에서 안-아래로 꺾인다. */
  ovie: () => {
    const [cx, cy] = project(0, 0, 5.2);
    const legs: string[] = [];
    // 끝마디는 상아 발톱(지적: 모든 다리·팔 끝마디) — 몸색과 갈라 따로 칠한다.
    const tips: string[] = [];
    /* 마디 — 시작·끝 굵기를 따로 받아 사다리꼴로 그린다(재지적: 집게팔은 뿌리가
       얇고 집게 쪽에서 확 두꺼워져야 한다). 끝 굵기를 안 주면 곧은 막대다. */
    const seg = (
      x1: number, y1: number, z1: number, x2: number, y2: number, z2: number,
      w: number, w2: number = w,
    ): string => {
      const [ax, ay] = project(x1, y1, z1);
      const [bx, by] = project(x2, y2, z2);
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const a1 = w / 2;
      const a2 = w2 / 2;
      return `M${ax + nx * a1} ${ay + ny * a1} L${bx + nx * a2} ${by + ny * a2} L${bx - nx * a2} ${by - ny * a2} L${ax - nx * a1} ${ay - ny * a1} Z`;
    };
    /* 다리 개편(재재재지적: 다리는 몸통에 완전히 붙이고, 집게팔은 많이 두껍게) —
       뿌리를 풍선 실루엣 안쪽으로 밀어 넣어 몸에서 바로 돋아난 것으로 보이게 한다.
       양옆 두 개씩은 무릎을 높이 꺾어 짧게 매달리고, 앞쪽 집게팔 한 쌍은 굵직한
       마디로 내려와 끝이 두 갈래로 벌어진다(공식 컨셉의 큰 집게 팔). */
    /* 다리 뿌리는 구 표면에(재지적: 몸통이 구라 자리마다 높이가 다르다) — 몸통 구
       (중심 z 5.2, 반지름 2.4)의 아래쪽 표면 z를 뿌리 좌표로 풀고, 0.2만큼 안으로
       박아 틈을 없앤다. */
    const rootZ = (rx9: number, ry9: number): number => {
      const d9 = Math.min(2.3, Math.hypot(rx9, ry9));
      return 5.2 - Math.sqrt(Math.max(0.01, 2.4 * 2.4 - d9 * d9)) + 0.2;
    };
    for (const sx of [-1, 1]) {
      // 뒤에 한 쌍 더(요청) — 뒷다리 세 쌍.
      for (const lyy of [-1.7, -0.5, 1]) {
        // 가늘게(재지적) — 매달린 실다리 느낌.
        /* 옆다리는 더 펴고 몸통 아래 안쪽으로(지적) — 뿌리를 안쪽(1.2)에서 내리고
           무릎 꺾임을 줄여 거의 곧게 아래로 늘어뜨린다. */
        // 몸 80%·다리 120%(요청) — 뿌리는 줄어든 몸에, 끝은 더 길게 아래로.
        // 길이 80%(요청) — 끝을 위로 당긴다.
        legs.push(seg(sx * 0.96, lyy * 0.8, rootZ(0.96, lyy * 0.8), sx * 1.78, lyy * 0.8, 0.45, 0.34));
        tips.push(seg(sx * 1.78, lyy * 0.8, 0.45, sx * 1.45, lyy * 0.8, -1.2, 0.26));
      }
      // 앞 집게팔(재재지적: 뒷다리보다 살짝 짧게, 뿌리는 얇고 집게 쪽에서 확 굵게) —
      // 사다리꼴 마디로 아래로 갈수록 부풀고, 발끝은 옆다리(-0.9)보다 조금 위에서 끝난다.
      // 앞 집게팔은 수직에 가깝게(요청) — 앞으로 크게 뻗던 것을 곧게 내린다.
      legs.push(seg(sx * 0.64, 1.36, rootZ(0.64, 1.36), sx * 0.95, 1.85, 1.4, 0.3, 0.5));
      legs.push(seg(sx * 0.95, 1.85, 1.4, sx * 1, 2.05, 0.2, 0.5, 0.95));
      // 집게 — 굵은 밑동에서 두 갈래로 좁아지는 날.
      tips.push(seg(sx * 1, 2.05, 0.2, sx * 1.45, 2.35, -0.5, 0.7, 0.25));
      tips.push(seg(sx * 1, 2.05, 0.2, sx * 0.55, 2.45, -0.45, 0.7, 0.25));
    }
    /* 허파(재지적: 양옆 렌즈는 눈이 아니라 허파 같은 기관 — 흰색 말고 보라색으로,
       두껍게가 아니라 '넓게') — 접평면 부착은 그대로 두고, 접선 방향으로 길쭉한
       보라 타원 기관으로 바꾼다. 속에 밝은 보라 속살을 한 겹 얹는다. */
    // 양옆 기관 — 공용 렌즈 도형(요청: 렌즈 형태 메이커) 하나로 낸다.
    const lens = (sxSign: number): ShapeFace[] => {
      const th = Math.PI * (82 / 180);
      // 몸통 쪽으로 더 붙인다(요청) — 표면 반지름 2.44 → 2.05.
      const lx = Math.sin(th) * 2.05 * sxSign;
      const ly = Math.cos(th) * 2.05;
      // 위쪽을 살짝 안으로 눕힌다(요청) — 좌우가 서로 마주 보는 느낌.
      return lensFaces({
        x: lx, y: ly, z: 5.65, nx: lx, ny: ly, r: 0.98, bulge: 0.26, tiltDeg: 9,
      });
    };
    /* 얼굴(재지적: 얼굴은 앞쪽 아래쪽에 작은 반구형으로) — 몸 앞아래 표면에 붙는
       작은 돔 하나. */
    /* 머리는 완전 구형(재지적) — 중심만 투영한 진짜 원이라 어느 시점에서도 안 눌리고,
       구 몸통 표면보다 안쪽에 두어 몸에 겹쳐 박힌다. 짙은 갈색. */
    const [fhx, fhy] = project(0, 1.95, 3.95);
    const face = tagKey([
      [groundEllipse(fhx, fhy, 0.8, 0.8), 1, "#6b4732"] as ShapeFace,
      topFace(groundEllipse(fhx - 0.26, fhy - 0.26, 0.3, 0.3), 0.22),
    ], depthNow(0, 1.95));
    /* 등의 가스 주머니(공식 컨셉: 뒤 위에 얹힌 큰 광택 물집) — 큰 것 하나와 작은 것
       하나. 광 하이라이트를 크게 얹어 유리알처럼 반들거린다. */
    const [g1x, g1y] = project(1.12, -1.44, 6);
    const [g2x, g2y] = project(-0.24, -1.84, 6.6);
    return [
      // 다리 짙은 갈색(요청).
      [legs.join(" "), 1, "#6b4732"] as ShapeFace,
      [tips.join(" "), 1, "#6b4732"] as ShapeFace,
      ...lens(-1),
      ...lens(1),
      ...face,
      // 혹 완전 축소(재지적: 머리 혹 줄이기) — 살짝 도드라지는 정도만.
      // 광택 제거(지적) — 혹은 몸판만, 반들거림 없이.
      ...tagKey([bodyFace(groundEllipse(g1x, g1y, 0.76, 0.68))], depthNow(1.12, -1.44)),
      ...tagKey([bodyFace(groundEllipse(g2x, g2y, 0.4, 0.36))], depthNow(-0.24, -1.84)),
      // 풍선 축소(재요청: 3.6 → 3.0) — 몸도 제 깊이(가운데 0)로. 광택 하이라이트는
      // 걷었다(지적: 광택 제거).
      // 몸통 80%(요청).
      ...tagKey([bodyFace(groundEllipse(cx, cy, 2.4, 2.28))], depthNow(0, 0)),
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
    const out: ShapeFace[] = []; // 꼬리 제거(재재지적)
    /* 포드는 캡슐 한 덩이(정정: 앞 뭉치가 본체와 떨어져 보였고 검정이 끼었다) —
       양 끝이 둥근 외곽선 하나로 그려 이음매도 어두운 단면도 없다. */
    /* 포드는 모델 공간 관으로(재지적: 사선에서 실린더가 안 보임 + 추진체와 높이가
       어긋남) — 화면 좌표 캡슐은 깊이 키가 없어 등판에 가려졌고, 화면에서 위로 민
       만큼 모델 높이도 알 수 없었다. tubeFaces는 제 깊이를 달고 추진체와 같은
       좌표계를 쓴다. 위 회색 광택 원은 제거(요청). */
    const POD_Z = 4.2;
    const pod = (tx: number): void => {
      /* 깊이 보정을 걷는다(재지적: 사선에서 가려져야 할 실린더가 앞으로 튄다) —
         관이 스스로 다는 깊이면 판·꼬리와 자연스럽게 앞뒤가 갈린다. */
      out.push(...paintBase(tubeFaces(tx, -2.9, tx, 0.4, 0.82, POD_Z), "#c9ced6"));
    };
    // 폭 축소(지적: 몸체 폭 줄이기) — 포드 자리 ±3.1 → ±2.6.
    pod(-2.6);
    pod(2.6);
    /* 구부러진 판이 곧 윗 등(재지적: 판이 너무 아래) — 포드보다 한 단 높이 올리고
       포드 뒤에 그려 등이 위로 올라앉는다. 판은 은색, 개인색 띠는 이 판에만(재지적). */
    const plate = `M${pt(-2.6, 2.6, 6.1)} Q${pt(0, 3.4, 6.95)} ${pt(2.6, 2.6, 6.1)}`
      + ` L${pt(2.6, -1.8, 5.9)} Q${pt(0, -2.8, 6.55)} ${pt(-2.6, -1.8, 5.9)} Z`;
    // 판 두께감(지적) — 앞 가장자리 아래로 내려앉는 옆면 띠.
    const edge = `M${pt(-2.6, 2.6, 6.1)} Q${pt(0, 3.4, 6.95)} ${pt(2.6, 2.6, 6.1)}`
      + ` L${pt(2.6, 2.6, 5.4)} Q${pt(0, 3.4, 6.25)} ${pt(-2.6, 2.6, 5.4)} Z`;
    /* 좌우 옆면(재지적: 등판 옆면이 안 보임) — 판 좌우 변에서 아래로 내려앉는 두께
       띠. 보이는 쪽만 그린다. */
    const flank = (m9: 1 | -1): string =>
      `M${pt(m9 * 2.6, 2.6, 6.1)} L${pt(m9 * 2.6, -1.8, 5.9)}`
      + ` L${pt(m9 * 2.6, -1.8, 5.2)} L${pt(m9 * 2.6, 2.6, 5.4)} Z`;
    /* 뒤 가장자리 두께(재지적: 등판 뒷면도 안 보임) — 앞 edge와 짝이 되는 뒤쪽 띠.
       뒤가 보일 때만 그린다. */
    const rearEdge = `M${pt(-2.6, -1.8, 5.9)} Q${pt(0, -2.8, 6.55)} ${pt(2.6, -1.8, 5.9)}`
      + ` L${pt(2.6, -1.8, 5.2)} Q${pt(0, -2.8, 5.85)} ${pt(-2.6, -1.8, 5.2)} Z`;
    out.push(...tagKey([
      [edge, 1, "#c9ced6"] as ShapeFace, sideFace(edge, 0.22),
      ...(faceLight(0, -1).visible
        ? [[rearEdge, 1, "#c9ced6"] as ShapeFace, ...faceLight(0, -1).face(rearEdge)]
        : []),
      ...([1, -1] as const).flatMap((m9): ShapeFace[] => {
        const fl9 = faceLight(m9, 0);
        if (!fl9.visible) return [];
        return [[flank(m9), 1, "#c9ced6"] as ShapeFace, ...fl9.face(flank(m9))];
      }),
      [plate, 1, "#c9ced6"] as ShapeFace, topFace(plate, 0.18),
      // 등판 개인색 띠 — 판의 굽은 결을 그대로 따르는 가로 줄.
      bodyFace(`M${pt(-2.55, 1.9, 6.11)} Q${pt(0, 2.6, 6.9)} ${pt(2.55, 1.9, 6.11)}`
        + ` L${pt(2.55, 0.6, 6.06)} Q${pt(0, 1.3, 6.83)} ${pt(-2.55, 0.6, 6.06)} Z`),
    ], depthNow(0, 0.4)));
    /* 뒤 추진체 셋 — 짙은 은색(재지적). 앞에서 볼 때도 몸을 뚫고 보이던 문제(지적:
       안 가려짐)는 꽁무니가 돌아앉으면 아예 그리지 않는 것으로 해결 — 몸판이 무깊이
       면이라 painter로는 못 가린다. */
    /* 추진체 넷(요청) — 본체 둘과 포드마다 하나씩, 크기를 키웠다. 꽁무니가 돌아앉으면
       아예 안 그린다(몸판이 무깊이 면이라 painter로는 못 가린다). */
    /* 추진체 넷(재지적: 보여야 하는데 안 보임) — 꽁무니 각도 게이트와 붙박이 키를
       걷고 관 자체 깊이로 둔다. 뒤에서 보면 몸 밖으로 나와 보이고 앞에서 보면 몸이
       가린다. 뒤 하얀 분사 원은 제거(요청). */
    // 포드 추진체는 실린더 중심 높이에 맞춘다(재지적).
    for (const [tx, tz] of [[-0.85, 5.6], [0.85, 5.6], [-2.6, POD_Z], [2.6, POD_Z]] as [number, number][]) {
      out.push(...paintBase(tubeFaces(tx, -2.95, tx, -3.95, 0.82, tz), "#9ba3ad"));
    }
    /* 꼬리(재지적: 축을 몸통에 붙이고 비행기 꼬리 스타일로) — 등판 뒤끝에서 곧장
       솟는 수직 안정판과, 그 위에서 좌우로 뻗는 수평 안정판 한 쌍. */
    /* 꼬리 입체화(요청) — 수직 안정판은 좌우 두께, 수평 안정판은 위아래 두께를 갖는
       판. 각 판의 둘레를 띠로 둘러 부피를 만든다. */
    out.push(...tagKey(paintBase(((): ShapeFace[] => {
      const finAt = (x9: number): [number, number, number][] => [
        [x9, -1.9, 6.1], [x9, -4.6, 8.3], [x9, -5.3, 8.3], [x9, -5.3, 5.6],
      ];
      const wingAt = (z9: number): [number, number, number][] => [
        [-1.6, -5.1, z9], [1.6, -5.1, z9], [1.2, -4.25, z9], [-1.2, -4.25, z9],
      ];
      /* 옆면은 뒤를 향한 것부터(재지적: 면들이 서로 가리고 비친다) — 무깊이 면이라
         배열 순서가 곧 그리는 순서다. 각 옆면의 바깥 법선을 재 뒤→앞으로 정렬하면
         앞면이 늘 위에 온다. */
      const slab = (lo9: [number, number, number][], hi9: [number, number, number][],
        topOp: number): ShapeFace[] => {
        const f9: ShapeFace[] = [bodyFace(polyPath3(lo9)), sideFace(polyPath3(lo9), 0.26)];
        const cX9 = lo9.reduce((q9, w9) => q9 + w9[0], 0) / lo9.length;
        const cY9 = lo9.reduce((q9, w9) => q9 + w9[1], 0) / lo9.length;
        const walls9 = lo9.map((_, i9) => {
          const j9 = (i9 + 1) % lo9.length;
          const mx9 = (lo9[i9][0] + lo9[j9][0]) / 2 - cX9;
          const my9 = (lo9[i9][1] + lo9[j9][1]) / 2 - cY9;
          const ml9 = Math.hypot(mx9, my9) || 1;
          return {
            d: polyPath3([lo9[i9], lo9[j9], hi9[j9], hi9[i9]]),
            f: facingRatio(mx9 / ml9, my9 / ml9),
          };
        }).sort((q9, w9) => q9.f - w9.f);
        for (const w9 of walls9) f9.push(bodyFace(w9.d), sideFace(w9.d, w9.f >= 0 ? 0.2 : 0.4));
        f9.push(bodyFace(polyPath3(hi9)), topFace(polyPath3(hi9), topOp));
        return f9;
      };
      return [
        ...slab(finAt(-0.2), finAt(0.2), 0.14),
        ...slab(wingAt(7.95), wingAt(8.25), 0.16),
      ];
    })(), "#c9ced6"), depthNow(0, -3.6)));
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
    const [cx, cy] = project(0, -0.6, 3.8);
    const out: ShapeFace[] = [];
    /* 뒷다리(정정 셋: 꺾인 관절이 아니라 곡선 변의 삼각형) — 두 뿔을 잇던 팔꿈치를
       걷고, 몸 옆구리에 뿌리를 둔 채 바깥·앞으로 쓸리는 지느러미꼴 삼각형 하나로
       그린다. 세 변이 다 완만한 곡선이다. */
    const leg = (m: 1 | -1): string =>
      `M${pt(m * 2.1, -2.2, 3.75)} Q${pt(m * 4.8, -1.8, 3.5)} ${pt(m * 5.2, 1.2, 3.3)}`
      + ` Q${pt(m * 3.7, 0.6, 3.65)} ${pt(m * 2.4, 0.1, 3.8)}`
      + ` Q${pt(m * 2.1, -1, 3.78)} ${pt(m * 2.1, -2.2, 3.75)} Z`;
    // 집게·다리 네 장 금색(요청).
    out.push([leg(-1), 1, "#d4af37"] as ShapeFace, sideFace(leg(-1), 0.18));
    out.push([leg(1), 1, "#d4af37"] as ShapeFace, sideFace(leg(1), 0.18));
    /* 몸통 — 둥근 게딱지. 제 자리 깊이를 못 박는다(지적: 앞 집게가 몸통에 안 가려짐)
       — 손 면이라 깊이가 없어 앞 부품 값을 물려받았고, 집게(제 자리 깊이 ×1.6)가
       어느 각도에서도 몸통을 이겼다. 같은 자로 재면 뒤로 돈 집게는 몸에 묻힌다. */
    out.push(...tagKey([bodyFace(groundEllipse(cx, cy, 2.8, 2.2))], depthNow(0, -0.6) * 1.6));
    // (삭제·지적) 앞부분 검은 반투명 홈 — 정체불명 얼룩으로 보여 걷었다.
    out.push(topFace(groundEllipse(cx - 0.9, cy - 1, 1.25, 0.8), 0.25));
    // 옆구리 밝은 홈 한 쌍.
    out.push(topFace(groundEllipse(...project(-2.3, -0.3, 3.9), 0.4, 0.55), 0.4));
    out.push(topFace(groundEllipse(...project(2.3, -0.3, 3.9), 0.4, 0.55), 0.4));
    // 등 뒤 엔진 짐 — 하나만 남기고 밝은 사이언색(요청).
    out.push(...paintBase(domeFaces3(0, -2.3, 0.95, 0.8, 4.2), "#a9ecf2"));
    // 아가리 어두운 속은 제거(지적: 앞 검정 반투명 부품) — 빛 줄만 남긴다.
    out.push(topFace(`M${pt(-1.6, 1.1, 3.9)} Q${pt(0, 2, 3.9)} ${pt(1.6, 1.1, 3.9)} L${pt(1.4, 1.5, 3.9)} Q${pt(0, 2.4, 3.9)} ${pt(-1.4, 1.5, 3.9)} Z`, 0.5));
    /* 앞 집게 한 쌍(요청·실물 사진) — 초승달 꼴: 바깥은 크게 부풀고 안쪽은 오목해
       끝이 뾰족하며, 두 끝이 서로 오므라들어 마주 본다. 앞으로 갈수록 살짝 내려앉고
       윗판·아랫판과 테두리 띠로 두께를 준다. 금색. */
    {
      /* 집게를 앞으로 한 걸음(요청) — 몸통에 파묻히지 않게 축 방향으로 +0.8타일. */
      const FWD9 = 0.8;
      const OUT9: [number, number][] = ([[2.15, -0.2], [3.45, 1.5], [3.55, 3.1], [2.8, 4.6], [1.05, 5.8]] as [number, number][])
        .map(([x9, y9]) => [x9, y9 + FWD9] as [number, number]);
      const IN9: [number, number][] = ([[1.6, 4.5], [1.95, 2.9], [1.85, 1.3], [1.5, -0.2]] as [number, number][])
        .map(([x9, y9]) => [x9, y9 + FWD9] as [number, number]);
      /* 앞으로 갈수록 더 가파르게 내려앉는다(요청: 양쪽 끝이 살짝 아래로 휘게) —
         선형 기울기만 있으면 곧은 판이라, 2차항을 더해 끝에서 휨이 커진다. */
      /* 좌우로도 둥글게 구부린다(요청: 앞에서 봤을 때 양쪽 옆이 아래로 45도쯤 휘게,
         전체적으로 둥글게) — 앞다리 둘과 그 사이 패널을 한 장의 아치로 본다. 높이가
         |x|의 2차식으로 떨어지므로 가운데는 평평하고 바깥으로 갈수록 기울기가 커진다:
         계수 0.14면 바깥 끝(x≈3.55)의 기울기가 2×0.14×3.55 ≈ 1, 곧 45도다. */
      // 집게 전체를 위로(요청) — 기준 높이 4.15 → 4.85.
      const zAt9 = (x9: number, y9: number, dz: number): number =>
        4.85 - (y9 + 0.2) * 0.1 - (y9 + 0.2) ** 2 * 0.028
        - Math.abs(x9) ** 2 * 0.14 + dz;
      const ring9 = (m9: 1 | -1, dz: number): [number, number, number][] => [
        ...OUT9.map(([x9, y9]) => [m9 * x9, y9, zAt9(x9, y9, dz)] as [number, number, number]),
        ...IN9.map(([x9, y9]) => [m9 * x9, y9, zAt9(x9, y9, dz)] as [number, number, number]),
      ];
      /* 두 집게 사이 메움(재지적) — 전부가 아니라 뿌리 쪽(위쪽) 1/3만, 그것도 집게와
         같은 두께의 입체로. 앞은 벌어진 채 남는다. */
      {
        const BR9: [number, number][] = IN9.slice(-2); // 뿌리 쪽 두 점(y 1.3 → -0.2)
        /* 패널도 같은 아치를 탄다 — 가운데(x=0)가 가장 높고 양옆에서 내려앉는다.
           두 점만으로는 각져 보이므로 가운데 마루점을 끼워 곡선으로 잇는다. */
        const rim9 = (dz: number): [number, number, number][] => {
          const yIn = BR9[BR9.length - 1][1];
          return [
            ...BR9.map(([x9, y9]) => [-x9, y9, zAt9(x9, y9, dz)] as [number, number, number]),
            [0, yIn, zAt9(0, yIn, dz)] as [number, number, number],
            ...[...BR9].reverse().map(([x9, y9]) => [x9, y9, zAt9(x9, y9, dz)] as [number, number, number]),
          ];
        };
        const lo0 = rim9(0);
        const hi0 = rim9(0.62);
        const wf9: ShapeFace[] = [[polyPath3(lo0), 1, "#d4af37"] as ShapeFace];
        for (let i9 = 0; i9 < lo0.length; i9 += 1) {
          const j9 = (i9 + 1) % lo0.length;
          wf9.push([polyPath3([lo0[i9], lo0[j9], hi0[j9], hi0[i9]]), 1, "#d4af37"] as ShapeFace);
        }
        wf9.push([polyPath3(hi0), 1, "#d4af37"] as ShapeFace, topFace(polyPath3(hi0), 0.14));
        out.push(...tagKey(wf9, depthNow(0, 0.6) * 1.6));
      }
      for (const m9 of [-1, 1] as const) {
        const lo9 = ring9(m9, 0);
        const hi9 = ring9(m9, 0.62);
        const faces9: ShapeFace[] = [[polyPath3(lo9), 1, "#d4af37"] as ShapeFace,
          sideFace(polyPath3(lo9), 0.3)];
        for (let i9 = 0; i9 < lo9.length; i9 += 1) {
          const j9 = (i9 + 1) % lo9.length;
          faces9.push([polyPath3([lo9[i9], lo9[j9], hi9[j9], hi9[i9]]), 1, "#d4af37"] as ShapeFace);
        }
        faces9.push([polyPath3(hi9), 1, "#d4af37"] as ShapeFace, topFace(polyPath3(hi9), 0.18));
        // 몸통과 같은 자로(지적: 뒤에서 봐도 집게가 안 가려짐) — 깊이를 키워 앞뒤가
        // 확실히 갈리게 한다.
        out.push(...tagKey(faces9, depthNow(m9 * 2.5, 2.6) * 1.6));
      }
    }
    return out;
  },
  /* 럴커 알(요청·사진) — 진흙 둔덕에 박힌 채 부푼 혹들이 뭉친 누런 알. 둘레를 갈색
     가시다리 여섯이 바깥으로 벌어져 감싼다. 히드라가 럴커가 되는 동안 이 모습이다. */
  lurkeregg: () => {
    const out: ShapeFace[] = [];
    /* 바닥 둔덕 — 어두운 진흙. 붙박이 맨 아래 키(지적: 알과 가시가 밑판에 가려짐) —
       돔 프리미티브가 제 반지름(2.5)을 키로 달아, 알(0)과 앞 가시까지 덮었다. */
    out.push(...tagKey(paintBase(domeFaces3(0, 0, 3.2, 2.5, 0), "#463628"), -8));
    /* 둘레 가시다리 — 뿌리에서 바깥·위로 휘어 오르며 알을 감싼다(spirePillar의 lean·
       curve로 관절 없이 한 번에 굽힌다). */
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2 + 0.35;
      const bx = Math.sin(a) * 1.95;
      const by = Math.cos(a) * 1.55;
      out.push(...tagKey(paintBase(spirePillar({
        // 가시 축소(요청) — 높이 2.7 → 1.9, 굵기 0.6 → 0.4.
        x: bx, y: by, z0: 0.25, h: 1.9, w: 0.4, tipW: 0.1,
        segs: 3, sides: 5, hold: 0.28, taper: 0.75,
        leanX: bx * 0.5, leanY: by * 0.5, curveX: bx * 0.45, curveY: by * 0.45,
      }), "#6d4a33"), depthNow(bx, by) * 1.6));
    }
    /* 알은 구 하나로 단순하게(요청) — 혹 다섯을 뭉치던 것을 걷고, 색은 건물 고치와
       같은 살구빛 껍질색을 쓴다. */
    /* 알과 가시를 같은 자로 잰다(지적: 가시가 알에 가려짐) — 붙박이 키 12는 앞으로
       돈 가시까지 덮었다. 알은 0, 가시는 제 자리 깊이다. */
    out.push(...tagKey(paintBase(domeFaces3(0, 0, 2.3, 2.7, 1.2), "#d9b8a2"), 0));
    return out;
  },
  /* 변태 고치(정정 요청: 공중 유닛용이라 땅에 붙은 밑동 제거 — 나비 번데기 꼴) —
     뮤탈이 가디언·디바우러가 되는 번데기. 위 실자락에 매달려 아래위가 다 뾰족한
     방추형 껍질이고, 마디 결이 층층이 감긴다. 어디도 지면에 닿지 않는다. */
  mutacocoon: () => {
    const WAIST = 3.9; // 가장 굵은 허리 높이
    const out: ShapeFace[] = [];
    /* 살짝 기운다(요청) — 껍질 축을 뒤로 조금 눕혀 매달린 느낌을 낸다. 자리마다
       중심이 어긋나면 마디 테가 안 맞으므로, 축의 기울기를 한 곳에서 정의해 쓴다. */
    const TILT = 1.1; // 꼭대기가 뒤(-y)로 밀리는 총량
    const axY = (z9: number): number => -TILT * (z9 / 7.3);
    // 아래 반 — 아래 끝(뾰족)에서 허리로 벌어진다. 색은 짙은 살색(요청).
    /* 키는 아래에서 위로 명시로 쌓는다(지적: 키가 이상하다) — 조각마다 프리미티브가
       매기는 제 깊이를 쓰면, 같은 축에 선 반쪽·테들이 반지름 몫으로 서로를 덮었다.
       아래 반 0 → 위 반 1 → 실자락 2 → 마디 테 3 순서면 늘 옳다. */
    out.push(...tagKey(paintBase(spirePillar({
      x: 0, y: axY(1.1), z0: 1.1, h: WAIST - 1.1, w: 0.3, tipW: 2.05,
      segs: 5, sides: 10, hold: 0, taper: 0.75,
      leanY: axY(WAIST) - axY(1.1),
    }), "#c68a62"), 0));
    // 위 반 — 허리에서 위 끝으로 다시 좁아진다.
    out.push(...tagKey(paintBase(spirePillar({
      /* 허리에서 살짝 겹쳐 시작한다(지적: 중간 허리 안쪽 단면이 비쳐 보인다) —
         두 반쪽이 딱 맞닿기만 하면 아래 반의 윗 뚜껑이 그대로 드러난다. 0.25 아래에서
         시작해 굵기를 조금 키워 그 뚜껑을 덮는다. */
      x: 0, y: axY(WAIST - 0.25), z0: WAIST - 0.25, h: 3.65, w: 2.12, tipW: 0.32,
      segs: 5, sides: 10, hold: 0.12, taper: 0.85,
      leanY: axY(WAIST + 3.4) - axY(WAIST - 0.25),
    }), "#c68a62"), 1));
    // 매달린 실자락 — 꼭대기에서 위로 가늘게 뻗는다.
    out.push(...tagKey(paintBase(spirePillar({
      x: 0, y: axY(7.3), z0: 7.3, h: 1.5, w: 0.22, tipW: 0.08,
      segs: 2, sides: 6, hold: 0.2, leanY: axY(8.8) - axY(7.3),
    }), "#8a5f43"), 2));
    /* (삭제·요청) 갈색 마디 테 장식 — 껍질만 남긴다. */
    return out;
  },
  /* 미네랄(재정정: 삼각뿔 말고 보석 기둥) — 세운 기둥 결정 + 뾰족 갓 셋, 키가 다
     다르다. 색은 그리는 쪽이 하늘색을 넣는다(팀색과 무관한 지물). */
  mineral: () => {
    /* 미네랄 결정 무리(요청: 새 공용 도형으로 화려하게) — spirePillar로 세운 육각
       기둥 결정 일곱. 큰 셋이 가운데를 이루고 작은 넷이 발치를 감싸며, 저마다 다른
       각도로 기울어 끝이 뾰족하다. 색은 그리는 쪽이 하늘색을 넣는다. */
    const gem = (
      x9: number, y9: number, h9: number, w9: number, lx9: number, ly9: number,
    ): ShapeFace[] => spirePillar({
      x: x9, y: y9, h: h9, w: w9, tipW: w9 * 0.12,
      segs: 3, sides: 6, hold: 0.35,
      leanX: lx9 * 0.45, leanY: ly9 * 0.45, curveX: lx9 * 0.55, curveY: ly9 * 0.55,
    });
    return [
      // 뒤쪽 작은 것들 먼저 — 앞 결정이 위로 온다.
      ...gem(-2.9, -1.4, 3.4, 0.75, -1.1, -0.5),
      ...gem(2.6, -1.6, 3, 0.7, 1.2, -0.4),
      // 가운데 큰 셋.
      ...gem(-1.4, -0.2, 6.2, 1.15, -0.7, 0.2),
      ...gem(0.3, 0.6, 7.6, 1.35, 0.1, 0.5),
      ...gem(1.9, -0.3, 5.4, 1, 0.9, 0.1),
      // 앞 발치의 작은 둘.
      ...gem(-0.9, 2, 2.9, 0.62, -0.5, 1),
      ...gem(1.2, 2.2, 3.6, 0.7, 0.6, 1.1),
    ];
  },
  /* 가스 간헐천(재모델링·사진 / 요청: 개인색 없는 고유색 전용) — 팀색을 한 점도
     쓰지 않는다: 모든 면에 제 색을 박는다. 잿빛 바위 덩이들이 둘러선 가운데 분화구가
     열려 초록 베스핀이 고이고, 그 위로 초록 김이 층층이 오른다. */
  geyser: () => {
    const ROCK = "#7a7264";
    const ROCK_D = "#4e483f";
    const GAS = "#7ee03a";
    const GAS_D = "#3f7a1c";
    const out: ShapeFace[] = [
      // 흙바닥 — 고정 회갈색.
      [groundEllipse(...project(0, 0, 0.02), 4.7, 2.25), 1, "#413c35"] as ShapeFace,
    ];
    /* 둘러선 바위 덩이 여섯 — 밖으로 조금씩 기운 각진 기둥. 크기와 각이 저마다 달라
       요잉이 눈에 보인다. */
    for (const [ang, r9, h9, w9, dark] of [
      [-150, 3.1, 2.4, 1.35, 0], [-95, 2.9, 3.2, 1.5, 1], [-35, 3.2, 1.9, 1.2, 0],
      [40, 3, 2.7, 1.4, 1], [100, 3.3, 2.1, 1.25, 0], [155, 2.8, 1.6, 1.1, 1],
    ] as [number, number, number, number, number][]) {
      const a9 = (ang * Math.PI) / 180;
      const bx9 = Math.sin(a9) * r9;
      const by9 = Math.cos(a9) * r9;
      out.push(...tagKey(paintBase(spirePillar({
        x: bx9, y: by9, z0: 0, h: h9, w: w9, tipW: w9 * 0.35,
        segs: 4, sides: 5, hold: 0.15, taper: 1.5,
        leanX: Math.sin(a9) * 0.55, leanY: Math.cos(a9) * 0.55,
      }), dark ? ROCK_D : ROCK), depthNow(bx9, by9) * 1.6));
    }
    /* 가운데 분화구 — 위로 좁아지는 바위 그릇. 테 안쪽은 어둡고 바닥에 초록 가스가
       고여 빛난다. */
    const crater = (cx9: number, cy9: number, r9: number, h9: number, key: number): void => {
      out.push(...tagKey(paintBase(spirePillar({
        x: cx9, y: cy9, z0: 0, h: h9, w: r9, tipW: r9 * 0.72,
        segs: 4, sides: 12, hold: 0.1, taper: 1.4,
      }), ROCK), key));
      const rim = r9 * 0.72;
      out.push(...tagKey([
        // 테 안쪽 그늘 — 구멍으로 읽히는 어두운 원.
        [discPath3(cx9, cy9, h9, rim * 0.94), 1, "#241f19"] as ShapeFace,
        /* 고인 베스핀 — 깊은 초록 위에 밝은 심. 색이 너무 진했다(지적) — 불투명도를
           낮춰 아래 바위 그늘이 비치는 맑은 가스로 만든다. */
        [discPath3(cx9, cy9, h9 - 0.12, rim * 0.72), 0.3, GAS_D] as ShapeFace,
        [discPath3(cx9, cy9, h9 - 0.18, rim * 0.42), 0.26, GAS] as ShapeFace,
      ], key + 0.6));
      // 초록 김 — 위로 갈수록 넓고 옅어지는 세 켜.
      out.push(...tagKey([
        [groundEllipse(...project(cx9 - 0.1, cy9 + 0.15, h9 + 0.9), rim * 0.8, rim * 0.5), 0.15, GAS] as ShapeFace,
        [groundEllipse(...project(cx9 - 0.25, cy9 + 0.3, h9 + 1.8), rim * 1.05, rim * 0.62), 0.09, GAS] as ShapeFace,
        [groundEllipse(...project(cx9 - 0.4, cy9 + 0.45, h9 + 2.7), rim * 1.3, rim * 0.72), 0.05, GAS] as ShapeFace,
      ], key + 1));
    };
    crater(-0.7, 0.4, 2.6, 2.3, depthNow(-0.7, 0.4) * 1.6 + 0.2);
    crater(2.3, -1.4, 1.35, 1.5, depthNow(2.3, -1.4) * 1.6 + 0.2);
    return out;
  },

};
/* 캐리어(인터셉터) — 갤러리용 별본(요청): 캐리어 둘레에 인터셉터 넷이 떠 있다. */
SHAPE_BUILDERS.carrierbay = () => {
  // 인터셉터는 작은 쌍안경꼴(재지적) — 나란한 두 알 + 사이를 잇는 좁은 다리판(재재지적).
  const cept = (x: number, y: number, z: number): ShapeFace[] => [
    ...boxFaces3(x, y, 0.4, 0.12, 0.08, z + 0.05),
    ...domeFaces3(x - 0.24, y, 0.2, 0.3, z),
    ...domeFaces3(x + 0.24, y, 0.2, 0.3, z),
  ];
  return [
    ...SHAPE_BUILDERS.carrier(),
    ...cept(3.1, 1.8, 6.2),
    ...cept(-3.4, 0.6, 4.6),
    ...cept(2.5, -2.6, 5.3),
    ...cept(-2.1, 2.9, 7.1),
  ];
};
/* 크립 블롭 세 변형(요청: 저그 건물 아래 크립) — 씨앗만 다른 같은 생물 카펫. */
SHAPE_BUILDERS.creeppatch = () => creepBlobFaces(0.7);
SHAPE_BUILDERS.creeppatch2 = () => creepBlobFaces(2.3);
SHAPE_BUILDERS.creeppatch3 = () => creepBlobFaces(4.1);
/* 부품 깊이 정렬(지적: 일부만 가려지는 파트에서 뒤 요소가 비쳐 보임 — 가장 큰 문제) —
   빌더의 그리기 순서는 표준 시점 기준 고정이라, 요잉으로 뒤로 돌아간 부품이 앞 부품
   위에 그려졌다. 프리미티브(상자·절두·기둥·돔·뿔·관·다리)가 제 중심 깊이를 면에 달아
   두므로, 모든 빌더를 요잉 버킷마다 뒤→앞 안정 정렬로 감싼다 — 깊이 없는 손 면은
   직전 부품에 붙어 다녀(장식 규칙) 기존 결이 안 깨진다. */
for (const k of Object.keys(SHAPE_BUILDERS)) {
  const orig = SHAPE_BUILDERS[k];
  SHAPE_BUILDERS[k] = () => zsorted(orig());
}


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
  Marine: "gunner", Firebat: "fbat", Ghost: "ghost", Medic: "inf",
  // 기계·함선(요청: 만들 수 있는 건 다).
  Vulture: "vulture", "Siege Tank": "tank", "Siege Tank (Tank Mode)": "tank",
  "Siege Tank (Siege Mode)": "tanksiege",
  Goliath: "goliath", Reaver: "reaver", Wraith: "wraith", Battlecruiser: "bc",
  Valkyrie: "valk", "Science Vessel": "vessel",
  Mutalisk: "muta", Guardian: "guardian", Devourer: "devourer", Scourge: "scourge",
  Queen: "queen", Corsair: "corsair", Scout: "scout", Carrier: "carrier",
  Arbiter: "arbiter", Observer: "observer",
  /* 수송선 셋(단서: "큰 질럿들이 좀 이따 드라군으로 바뀜") — 이 셋이 표에 없어 부대
     구성의 셔틀이 종족 폴백(질럿·마린·저글링)에 폴백 덩치(대형)로, 게다가 공중이라 떠서
     그려졌다. 구성 순서가 바뀌면 그 자리가 드라군으로 바뀌는 것까지 들어맞는다. */
  Dropship: "dship", Shuttle: "shuttle", Overlord: "ovie",
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
/* 무기 세분화(재지적: 이왕 한 거 세분화) — 드라군은 포톤캐논과 같은 광자포(photon),
   커세어는 광자 집중 지지기(flare), 배틀·레이스는 광선 뾱뾱(laser, 레이스·골리앗은
   공중 상대면 미사일 — 그리는 쪽에서 가른다), 캐리어는 두두두두 다발총(burst), 아콘은
   번개 줄기 지지기(zap), 뮤탈은 가시 투척(glave를 투척 다트로), 럴커는 초록 줄이 아닌
   가시(spike), 가디언은 노란 독구체(acidball). 템플러는 물리 공격이 없고(스톰은 캐스트
   가 따로 그린다) 스커지는 자폭(죽음이 곧 공격)이라 뺀다. */
const ATTACK_FX: Record<string, string> = {
  Marine: "gun", Ghost: "gun", Vulture: "gun", Goliath: "gun", Wraith: "laser",
  Battlecruiser: "laser", "Siege Tank": "cannon", "Siege Tank (Tank Mode)": "cannon",
  "Siege Tank (Siege Mode)": "cannon", Firebat: "flame", Medic: "heal",
  Hydralisk: "spine", Lurker: "spike", Mutalisk: "glave", Devourer: "acid",
  Guardian: "acidball", Queen: "acid", Valkyrie: "missile",
  Dragoon: "photon", Scout: "bolt", Corsair: "flare", Arbiter: "bolt", Carrier: "burst",
  Archon: "zap", Reaver: "cannon",
  /* 근접은 효과를 안 그린다(요청: 휘두름 호 제거) — 대신 몸이 표적 쪽으로 툭 나갔다
     빠지는 잽으로 때리는 것을 보인다(MELEE_JAB_SEC). 그림 없는 동작이 호보다 읽기
     쉽고, 무엇보다 옆에 뜬 부메랑처럼 보이지 않는다. */
};
/* 변태 중 모습(요청·사진) — 히드라는 럴커 알로, 뮤탈은 가디언·디바우러가 되는 번데기
   고치로 웅크린다. 태어난 뒤 이 시간 동안은 알·고치를 그리고 공격도 안 한다. */
const MORPH_SHELL: Record<string, string> = {
  Lurker: "lurkeregg", Guardian: "mutacocoon", Devourer: "mutacocoon",
};
/** 변태에 걸리는 시간(초) — 원작 값 어림(럴커·가디언·디바우러 모두 40초대). */
const MORPH_SHELL_SEC = 40;
/** 근접 잽 주기(초) — 원작 공격 주기 어림. 표에 없는 근접은 0.7초. */
const MELEE_JAB_SEC: Record<string, number> = {
  Zergling: 0.36, Ultralisk: 0.63, Zealot: 0.92, Firebat: 0.92, "Dark Templar": 1.26,
  Broodling: 0.63, "Infested Terran": 0.63,
};
/* 발사 지점(요청: 탱크는 포신, 히드라는 입, 마린·파뱃은 총구, 매딕은 주사기 — 효과가
   몸 중심이 아니라 제 무기 끝에서) — 트레이서를 몸 방향 축으로 이만큼(px) 앞으로 민다.
   회전 뒤 translateY라 어느 방향을 보든 정확히 총구 쪽이다. 표에 없으면 몸 가장자리
   어림(4px). 유닛별 완전 모델링(총구 화염까지 제 모델)은 다음 단계다. */
const MUZZLE_PX: Record<string, number> = {
  "Siege Tank": 8, "Siege Tank (Tank Mode)": 8, "Siege Tank (Siege Mode)": 10,
  Hydralisk: 5, Marine: 4, Firebat: 4, Ghost: 5, Vulture: 5, Goliath: 6,
  Wraith: 6, Battlecruiser: 9, Valkyrie: 6,
  Dragoon: 6, Zealot: 3, Archon: 6, Reaver: 7, Scout: 6, Corsair: 5, Carrier: 9, Arbiter: 6,
  Zergling: 3, Lurker: 6, Mutalisk: 5, Guardian: 6, Devourer: 6, Queen: 5, Ultralisk: 5,
  "Photon Cannon": 6, "Sunken Colony": 5, "Missile Turret": 7, Bunker: 6,
};
/* 총구 모델 앵커(요청: 오프셋 표 말고 모델별로 — 승인) — 모델 공간 [x(우), y(앞), z(위)].
   트레이서가 몸 중심이 아니라 이 점의 '투영 자리'에서 시작한다: 요잉 버킷·시각 밀림·
   피칭까지 스프라이트 굽기와 같은 변환(project)을 태우므로 어느 방향을 보든 정확히 그
   부위(탱크 포신·히드라 입·마린 총구·매딕 주사기)다. 좌표는 각 빌더의 해당 부품
   좌표에서 따 왔고(마린·고스트는 빌더의 총구 캡 그대로), 표에 없는 유닛만 예전 픽셀
   오프셋(MUZZLE_PX)으로 물러난다. */
const MUZZLE_ANCHOR: Record<string, [number, number, number]> = {
  gunner: [0.55, 2.8, 3.35], ghost: [0.5, 3.4, 3.5], fbat: [0.8, 2.6, 3],
  inf: [0.5, 2.2, 3.2],
  tank: [0.55, 4.4, 3.3], tanksiege: [0, 2.9, 6.9], goliath: [1.4, 2.2, 3.4],
  vulture: [0, 3.4, 2.6], wraith: [0, 3.6, 2.8], bc: [0, 4.6, 3.8], valk: [0.9, 3.2, 3],
  hydra: [0, 2.6, 4.2], lurker: [0, 3, 2.2], muta: [0, 3, 3], queen: [0, 3, 3],
  guardian: [0, 3.2, 2.8], devourer: [0, 3.2, 2.8], ultra: [0, 3.6, 3.4],
  goon: [0, 3.2, 3.6], zealot: [0.8, 2.4, 3], archon: [0, 2.2, 4.4], reaver: [0, 3.6, 2.4],
  scout: [0, 3.4, 3], corsair: [0, 3.2, 3], carrier: [0, 4.4, 3.6], arbiter: [0, 3.4, 3.4],
};
/** 총구 앵커의 16-상자 투영 좌표 — 스프라이트와 같은 버킷·밀림·피칭으로 투영한다. */
function muzzlePoint(
  kind: string, rotDeg: number | undefined, viewYaw: number | undefined, pitch: boolean,
): [number, number] | null {
  const a = MUZZLE_ANCHOR[kind];
  if (!a) return null;
  const vq = viewYaw ? Math.max(-36, Math.min(36, Math.round(viewYaw / 6) * 6)) : 0;
  const bucket = rotDeg !== undefined ? ((Math.round(rotDeg / 22.5) * 22.5) % 360 + 360) % 360 : 0;
  const sh = Math.tan((vq * Math.PI) / 180);
  const run = (): [number, number] =>
    withViewShear(sh, () => withYaw(-bucket, () => project(a[0], a[1], a[2])));
  return pitch ? withPitchView(run) : run();
}
const unitMarkerKind = (u: string, race?: string): string =>
  UNIT_3D[u] ?? (race === "테란" ? "gunner" : race === "저그" ? "zling" : "zealot");
/* 유닛 덩치(요청: 소형/중형/대형 크기 구분) — 브루드워의 유닛 크기 분류를 따른다.
   전수조사(요청) 결과 표가 절반쯤 비어 있었고, 빠진 유닛은 전부 대형으로 떨어졌다.
   대형 폴백은 "큰 쪽이 덜 틀린다"는 어림이었지만, 실제로는 커세어·퀸 같은 중형과
   드라군·탱크 같은 대형이 한 칸에 뭉쳐 크기로는 아무것도 구분되지 않았다. 이제 전
   유닛을 원작 분류(Small/Medium/Large) 그대로 적는다 — 폴백도 대형이 아니라 중형
   (가운데로 틀린다). 이 등급이 곧 화면 크기의 유일한 손잡이다(UNIT_TILES). */
const UNIT_BULK: Record<string, 0 | 1 | 2> = {
  // ── 테란 ──
  SCV: 0, Marine: 0, Firebat: 0, Ghost: 0, Medic: 0, "Spider Mine": 0,
  Vulture: 1,
  "Siege Tank": 2, "Siege Tank (Tank Mode)": 2, "Siege Tank (Siege Mode)": 2,
  Goliath: 2, Wraith: 2, Dropship: 2, "Science Vessel": 2, Battlecruiser: 2, Valkyrie: 2,
  // ── 프로토스 ──
  Probe: 0, Zealot: 0, "High Templar": 0, "Dark Templar": 0, Observer: 0, Interceptor: 0,
  Corsair: 1,
  Dragoon: 2, Archon: 2, "Dark Archon": 2, Reaver: 2, Shuttle: 2, Scout: 2,
  Carrier: 2, Arbiter: 2,
  // ── 저그 ──
  Larva: 0, Drone: 0, Zergling: 0, Mutalisk: 0, Scourge: 0, Broodling: 0,
  "Infested Terran": 0,
  Hydralisk: 1, Queen: 1, Defiler: 1,
  // 럴커는 원작에서 대형이다(조사: 중형으로 잘못 적혀 있었다).
  Lurker: 2, Ultralisk: 2, Overlord: 2, Guardian: 2, Devourer: 2,
};
/** 도형째 돌려 그리는 각도(시계방향) — 옛 스타게이트(반쪽 원통)용 45도는 봉오리
 *  재설계로 걷었다: 잎이 정확히 위아래·좌우에 서야 하고(요청), 화면 회전은 바닥
 *  그림자까지 대각선으로 돌려 검은 얼룩처럼 보였다. */
const SHAPE_ROT: Record<string, number> = {};
/** 관리자 모델링 뷰어(요청) — 도형 카탈로그. 건물은 SHAPE_KIND에서, 유닛 갈래는 손으로. */
/* 도록 차례(재편·요청) — 유닛/건물로 가르고, 각 갈래는 테란 → 프로토스 → 저그,
   그 안에서는 기본 → 고급·후반 순이다. 갤러리 목록과 시트가 같은 차례를 쓴다. */
export const SHAPE_GALLERY: { kind: string; label: string; group: "유닛" | "건물" }[] = [
  // ── 유닛 · 테란 ──
  { kind: "scv", label: "SCV", group: "유닛" },
  { kind: "gunner", label: "마린", group: "유닛" },
  { kind: "ghost", label: "고스트", group: "유닛" },
  { kind: "fbat", label: "파이어뱃", group: "유닛" },
  { kind: "inf", label: "메딕", group: "유닛" },
  { kind: "vulture", label: "벌처", group: "유닛" },
  { kind: "mine", label: "스파이더 마인", group: "유닛" },
  { kind: "tank", label: "시즈 탱크", group: "유닛" },
  { kind: "tanksiege", label: "시즈 탱크(시즈)", group: "유닛" },
  { kind: "goliath", label: "골리앗", group: "유닛" },
  { kind: "wraith", label: "레이스", group: "유닛" },
  { kind: "dship", label: "드랍십", group: "유닛" },
  { kind: "vessel", label: "사이언스 베슬", group: "유닛" },
  { kind: "valk", label: "발키리", group: "유닛" },
  { kind: "bc", label: "배틀크루저", group: "유닛" },
  // ── 유닛 · 프로토스 ──
  { kind: "probe", label: "프로브", group: "유닛" },
  { kind: "zealot", label: "질럿", group: "유닛" },
  { kind: "goon", label: "드라군", group: "유닛" },
  { kind: "htemp", label: "하이 템플러", group: "유닛" },
  { kind: "dtemp", label: "다크 템플러", group: "유닛" },
  { kind: "archon", label: "아콘", group: "유닛" },
  { kind: "darchon", label: "다크 아콘", group: "유닛" },
  { kind: "shuttle", label: "셔틀", group: "유닛" },
  { kind: "reaver", label: "리버", group: "유닛" },
  { kind: "observer", label: "옵저버", group: "유닛" },
  { kind: "scout", label: "스카웃", group: "유닛" },
  { kind: "corsair", label: "커세어", group: "유닛" },
  { kind: "carrier", label: "캐리어", group: "유닛" },
  { kind: "carrierbay", label: "캐리어(인터셉터)", group: "유닛" },
  { kind: "arbiter", label: "아비터", group: "유닛" },
  // ── 유닛 · 저그 ──
  { kind: "drone", label: "드론", group: "유닛" },
  { kind: "ovie", label: "오버로드", group: "유닛" },
  { kind: "zling", label: "저글링", group: "유닛" },
  { kind: "hydra", label: "히드라", group: "유닛" },
  { kind: "lurker", label: "러커", group: "유닛" },
  { kind: "muta", label: "뮤탈리스크", group: "유닛" },
  { kind: "scourge", label: "스커지", group: "유닛" },
  { kind: "queen", label: "퀸", group: "유닛" },
  { kind: "ultra", label: "울트라리스크", group: "유닛" },
  { kind: "defiler", label: "디파일러", group: "유닛" },
  { kind: "guardian", label: "가디언", group: "유닛" },
  { kind: "devourer", label: "디바우러", group: "유닛" },
  // ── 건물 · 테란 ──
  { kind: "tomb", label: "커맨드", group: "건물" },
  { kind: "comsat", label: "컴샛", group: "건물" },
  { kind: "nsilo", label: "핵 사일로", group: "건물" },
  { kind: "trapezoid", label: "서플라이", group: "건물" },
  { kind: "refinery", label: "리파이너리", group: "건물" },
  { kind: "cube", label: "배럭", group: "건물" },
  { kind: "ebay", label: "엔지니어링 베이", group: "건물" },
  { kind: "tombFlat", label: "벙커", group: "건물" },
  { kind: "academy", label: "아카데미", group: "건물" },
  { kind: "turret", label: "터렛", group: "건물" },
  { kind: "factory", label: "팩토리", group: "건물" },
  { kind: "mshop", label: "머신샵", group: "건물" },
  { kind: "plane", label: "스타포트", group: "건물" },
  { kind: "ctower", label: "컨트롤 타워", group: "건물" },
  { kind: "armory", label: "아머리", group: "건물" },
  { kind: "scifac", label: "사이언스 퍼실리티", group: "건물" },
  { kind: "covert", label: "코버트 옵스", group: "건물" },
  { kind: "physlab", label: "피직스 랩", group: "건물" },
  { kind: "scaffold", label: "공사장(테란)", group: "건물" },
  // ── 건물 · 프로토스 ──
  { kind: "pyramidWide", label: "넥서스", group: "건물" },
  { kind: "diamond", label: "파일런", group: "건물" },
  { kind: "assim", label: "어시밀레이터", group: "건물" },
  { kind: "gate", label: "게이트", group: "건물" },
  { kind: "forge", label: "포지", group: "건물" },
  { kind: "coil", label: "포토", group: "건물" },
  { kind: "sbattery", label: "실드 배터리", group: "건물" },
  { kind: "cyber", label: "사이버네틱스 코어", group: "건물" },
  { kind: "citadel", label: "시타델", group: "건물" },
  { kind: "archives", label: "템플러 아카이브", group: "건물" },
  { kind: "dome", label: "로보틱스", group: "건물" },
  { kind: "robobay", label: "서포트 베이", group: "건물" },
  { kind: "observatory", label: "옵저버토리", group: "건물" },
  { kind: "arch", label: "스타게이트", group: "건물" },
  { kind: "fleetbeacon", label: "플릿 비컨", group: "건물" },
  { kind: "tribunal", label: "아칸 트리뷰널", group: "건물" },
  { kind: "warpin", label: "소환구(프로토스)", group: "건물" },
  // ── 건물 · 저그 ──
  { kind: "hatchery", label: "해처리", group: "건물" },
  { kind: "lair", label: "레어", group: "건물" },
  { kind: "hive", label: "하이브", group: "건물" },
  { kind: "creep", label: "크립 콜로니", group: "건물" },
  { kind: "sunken", label: "성큰", group: "건물" },
  { kind: "spore", label: "스포어", group: "건물" },
  { kind: "extract", label: "익스트랙터", group: "건물" },
  { kind: "pool", label: "스포닝풀", group: "건물" },
  { kind: "evo", label: "에볼루션 챔버", group: "건물" },
  { kind: "hydraden", label: "히드라 덴", group: "건물" },
  { kind: "spire", label: "스파이어", group: "건물" },
  { kind: "gspire", label: "그레이터 스파이어", group: "건물" },
  { kind: "queensnest", label: "퀸즈 네스트", group: "건물" },
  { kind: "nydus", label: "나이더스", group: "건물" },
  { kind: "cavern", label: "울트라 동굴", group: "건물" },
  { kind: "dmound", label: "디파일러 마운드", group: "건물" },
  { kind: "cocoon", label: "공사 고치(저그)", group: "건물" },
  { kind: "lurkeregg", label: "럴커 알", group: "유닛" },
  { kind: "mutacocoon", label: "변태 고치", group: "유닛" },
  // ── 자원 ──
  { kind: "mineral", label: "미네랄", group: "건물" },
  { kind: "geyser", label: "가스 간헐천", group: "건물" },
];

/** 유닛(지상 이동체) 모델 kind 집합 — 겹침 방지 이완의 대상 판별에 쓴다(도록의 유닛
 *  갈래 그대로). 건물·자원·크립은 여기 없어 안 밀린다. */
const UNIT_KIND_SET = new Set(SHAPE_GALLERY.filter((g) => g.group === "유닛").map((g) => g.kind));
/** 일꾼 모델 — 겹침 이완에서 제 일꾼끼리는 서로 안 밀어낸다(지적: 자원 곁 포개짐 허용). */
const WORKER_KIND_SET = new Set(["scv", "probe", "drone"]);

/** ShapeIcon의 면 목록 결정을 떼어 낸 것 — 캔버스 유닛 층(UnitLayer)이 같은 판(같은
 *  굽기 캐시)을 그대로 그리려면 SVG 밖에서도 이 결정을 불러야 한다. 결과가 같은 함수
 *  하나이므로 SVG와 캔버스의 픽셀이 같은 도형에서 나온다(품질 동일의 근거). */
/* 본 게임과 같은 요잉(지적: 45도 시계방향) — 건물 모델의 기본 방향을 원작 아이소메트릭
   느낌으로 튼다. 원작 스프라이트 방향이 다른 모델(서플라이 디포 등)은 아래 보정표에
   도(°)를 더한다 — 값은 지적받는 대로 채운다. */
const BUILDING_BASE_YAW = 45;
const MODEL_YAW_TWEAK: Record<string, number> = {
  // 반시계 90도(지적) — 어시밀레이터·히드라 덴·서플·포지·테란 공사장.
  // 어시밀레이터: 180도(재재지적)→-45도→다시 180도(재재재재지적) — 합계 135.
  assim: 135, hydraden: -90, trapezoid: -90, forge: -90, scaffold: -90,
  // 시계 90도(지적) — 템플러 아카이브. 로보틱스는 모델 자체가 앞을 보게 고쳐 보정 0.
  // 아카이브 시계 90도(요청) — -90 → 0.
  dome: 0, archives: 0,
};
const buildingYawOf = (kind: string): number =>
  BUILDING_BASE_YAW + (MODEL_YAW_TWEAK[kind] ?? 0);

/* 음영 증폭(지적: 모델들 그림자가 너무 없어 — 갤러리보다 더 진하게) — 흑·백 덮개 면의
   불투명도를 1.45배로 키운다. 몸판(덮개색 없는 면)은 그대로라 색은 안 변하고 그늘·광만
   뚜렷해진다. */
const shadeBoost = (o: number, fill?: string): number => (fill ? Math.min(0.85, o * 1.45) : o);

function resolveShapeFaces(
  kind: string, rotDeg?: number, flat?: boolean, viewYaw?: number, pitchView?: boolean,
): { faces: ShapeFace[] | undefined; rot: number } {
  let faces: ShapeFace[] | undefined;
  let rot = SHAPE_ROT[kind] ?? 0;
  const builder = SHAPE_BUILDERS[kind];
  // 좌우 시점(지적) — 6도 스텝으로 갈무리해 굽는 판 수를 묶는다.
  const vq = viewYaw ? Math.max(-36, Math.min(36, Math.round(viewYaw / 6) * 6)) : 0;
  if ((rotDeg !== undefined || vq !== 0 || pitchView) && builder) {
    /* 기본은 정면(지적: 사선이 어색) — rotDeg 0이 요잉 0(정면 아래)이 되도록 굽는다.
       건물은 rotDeg가 없어 좌우 시점(vq)만 받는다. */
    // 16방향(요청: 원작 스프라이트처럼 22.5도 스텝) — 자연스러운 회전 단위.
    const bucket = rotDeg !== undefined ? ((Math.round(rotDeg / 22.5) * 22.5) % 360 + 360) % 360 : 0;
    const key = `${kind}:${bucket}:${flat ? 1 : 0}:${vq}:${pitchView ? 1 : 0}`;
    let f = HEAD_FACES.get(key);
    if (!f) {
      /* vq는 요잉이 아니라 시각 밀림(지적: 돌리면 모양이 찌그러짐) — 모델은 제 방향
         (bucket)만 요잉하고, 시각은 깊이 비례 가로 밀림(소실점 이동)으로만 반영한다. */
      const sh = Math.tan((vq * Math.PI) / 180);
      const bake0 = (): ShapeFace[] => withViewShear(sh, () => withYaw(-bucket, builder));
      const bake = pitchView ? (): ShapeFace[] => withPitchView(bake0) : bake0;
      f = flat ? withTopView(bake) : bake();
      HEAD_FACES.set(key, f);
    }
    faces = f;
  } else if (!builder) {
    rot += rotDeg ?? 0;
  }
  faces = faces ?? (flat ? SHAPE_FACES_TOP[kind] : undefined) ?? SHAPE_FACES[kind];
  return { faces, rot };
}

/* ── 유닛 캔버스 층(요청: 캔버스 전환 — 성능) ─────────────────────────────────────
   낱개 유닛 마커 수백 개를 span+SVG로 매번 재조정하는 것이 재생의 병목이었다(실측:
   중반 4대4 마커 750개, 폰급 CPU에서 1fps). 도형·자리·크기·순서 계산은 전부 그대로 두고
   '그리기'만 캔버스 한 장으로 옮긴다 — 면 목록은 위 resolveShapeFaces(같은 굽기 캐시)를
   그대로 쓰므로 그림 자체는 SVG와 같다. 전투 효과·말풍선·건물은 DOM에 남는다. */
type UnitDrawOp = {
  /** 렌즈 상자 기준 0~1 분수 자리(회피·입체 사영 반영 뒤). */
  fx: number; fy: number;
  /** 화가 순서 — 기존 zIndex 공식 값 그대로. */
  z: number;
  /** 발밑 접지 그림자(지적: 건물·지상 유닛에도 옅게) — 아주 작은 타원만. */
  groundShadow?: boolean;
  /** 바닥에 실제로 깔리는 그림자 테두리(분수 좌표) — 발자국 타원을 타일 공간에서
   *  띄엄띄엄 찍어 자리 사상으로 옮긴 점들이다(요청: 화면 타원 어림 말고 실제로 바닥에
   *  그려야 한다). 원근이 실린 채 지면에 눕는다. */
  shadowPts?: [number, number][];
  /** 지면선(입체) — 발자국 아랫변을 자리 사상으로 옮긴 세로 자리. 상자 바닥
   *  어림(sy + hPx/2) 대신 이 값에 그린 몸의 발을 앉힌다(지적: 3D에서 건물이
   *  그림자보다 한 칸쯤 아래에 그려짐 — 그림자는 지면에 직접 그린 도형이라 옳고,
   *  몸만 화면 어림을 써서 원근이 실린 만큼 어긋났다). */
  baseFy?: number;
  /** 발자국 세로/가로 비(건물) — 접지 그림자가 '바닥 발자국'만 덮게 하는 자(지적:
   *  칸(hPx)은 모델 높이까지 포함해, 칸 기준 타원은 건물을 통째로 덮는 큰 원이 됐다). */
  footRatio?: number;
  kind: string; rotDeg?: number; viewYaw?: number; flat?: boolean; pitch?: boolean;
  /** 도형 한 변(px) — 글자 크기 × 도형 배수(1.15/1.7) × 2배 토글 × 깊이 배율까지 포함. */
  sizePx: number;
  color: string;
  alpha: number;
  /* ── 건물용(캔버스 전환 둘째 판) — 발자국 비례 상자에 그린다. ───────────────── */
  /** 상자 폭·높이 — 캔버스 '폭'에 대한 분수(스팬의 % 폭 + aspectRatio와 같은 자).
   *  있으면 sizePx 대신 이 상자를 쓴다. */
  wFrac?: number; hFrac?: number;
  /** 상자 채우기 방식 — "meet"는 비율 유지·바닥 정렬(keepRatio), "fill"은 맨 네모 채움. */
  boxFit?: "meet" | "fill";
  /** meet에서 높이 대신 폭을 기준으로 — 납작 건물(벙커류)은 상자가 낮아 min 규칙이
   *  전체를 줄여 버린다(조사: 벙커가 유난히 작던 이유). */
  fitWidth?: boolean;
  /** 도형 대신 글자 하나(부속건물 +) — kind는 무시된다. */
  textGlyph?: string;
  /** 그림자 끄기 — 건물은 발이 땅에 붙어야 해서 그림자가 없다(유닛만 있다). */
  noShadow?: boolean;
  /** 공중 유닛(요청: 더 높이 + 바닥 그림자) — 몸을 위로 띄우고 발밑에 그림자 타원. */
  air?: boolean;
  /** 추가 부양(요청: 수송 승하차) — 크기 px에 대한 배수만큼 더 띄운다(빔에 빨려 오름). */
  rise?: number;
  /** 크립 판(요청: 크립은 벽·램프·다리를 못 넘는다) — 이 표시가 있는 판들은 먼저 깔고
   *  지형 차단 마스크로 파낸 뒤 나머지를 얹는다. */
  clipWalk?: boolean;
  /** 겹침 방지 이완에서 뺀다(지적: 채굴 일꾼이 해처리 밖으로 밀려 엉뚱한 데서 캠) —
   *  채굴 동선은 건물·자원과 겹치는 게 실제 모습이다. */
  noSep?: boolean;
  /** 남은 체력 비율 0~1(요청: 스탯을 지닌 생애주기) — 다쳤을 때만 와서 바가 뜬다. */
  hpFrac?: number;
  /** 최대 체력(실드 합) — 바의 100% 길이가 이 값에 비례한다(지적: 저글링과 울트라의
   *  만피가 같은 길이면 기준이 이상하다). */
  hpMax?: number;
  /** 상태 오라 색(전수조사: 인스네어·플레이그·빙결…) — 몸 밑에 색빛이 밴다. */
  tint?: string;
  /** 방금 명령을 받아 잡혀 있음 — 발밑에 흰 선택 링(지적: 드래그 선택 구분). */
  selRing?: boolean;
};
/* 구운 판의 실제 바닥(재재지적: 드론·해처리가 떠 있고 그림자가 이상하다) — 상자
   바닥 기준 어림은 모델이 상자를 다 안 채우면(해처리 둔덕 등) 그림자가 발보다 한참
   아래에 깔렸다. 알파를 성글게 훑어 가장 낮은 그린 픽셀 줄을 재고, 그림자를 거기에
   붙인다. 판은 캐시되므로 측정도 한 번뿐이다. */
/* 내용물 상자(재지적: 유닛·그림자·선택 고리가 다 안 맞음) — 바닥(y)만이 아니라 실제
   그려진 픽셀의 가로 중심(cx)까지 잰다. 내용물이 16-상자 안에서 치우친 모델은 상자
   중심에 붙인 그림자·링이 몸과 어긋났다. 전 픽셀 스캔, 캐시당 한 번. */
function contentBox(cv: HTMLCanvasElement): { bot: number; cx: number; top: number; w: number } {
  const c2 = cv.getContext("2d", { willReadFrequently: true });
  if (!c2 || cv.width === 0 || cv.height === 0) return { bot: cv.height, cx: cv.width / 2, top: 0, w: cv.width };
  const { data, width, height } = c2.getImageData(0, 0, cv.width, cv.height);
  let bot = 0;
  let top = height;
  let minX = width;
  let maxX = 0;
  for (let y = height - 1; y >= 0; y -= 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (data[row + x * 4 + 3] > 10) {
        if (bot === 0) bot = y + 1;
        if (y < top) top = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  if (bot === 0) return { bot: cv.height, cx: cv.width / 2, top: 0, w: cv.width };
  /* 잉크 폭(전수조사: "너무 크게/작게 그려지는 것") — 상자는 등급대로 같아도 모델이
     상자를 채우는 몫이 제각각이라, 같은 소형끼리도 어떤 놈은 커 보이고 어떤 놈은
     작아 보인다. 그 몫을 재서 그리기 단계가 되돌린다. */
  return { bot, cx: (minX + maxX + 1) / 2, top, w: maxX - minX + 1 };
}
const PATH2D_CACHE = new Map<string, Path2D>();
const pathOf = (d: string): Path2D => {
  let p = PATH2D_CACHE.get(d);
  if (!p) { p = new Path2D(d); PATH2D_CACHE.set(d, p); }
  return p;
};
/* ── 유닛 스프라이트 캐시(수리·지적: 캔버스 전환 뒤 프레임 뚝뚝) — 병목은 프레임마다
   유닛 하나에 면 8~20장을 '그림자 블러를 켠 채' fill하는 것: 수백 유닛이면 프레임당
   수천 번의 가우시안 블러 합성이라 PC에서도 버벅였다. 같은 (종류·방향·시각·색·크기)
   조합은 한 번만 오프스크린 캔버스에 굽고, 프레임에선 drawImage 한 번으로 찍는다.
   줌 중엔 크기 양자화 칸이 바뀌며 다시 굽지만 멈추면 전부 캐시 적중이다. */
/** 상자 채움 보정에서 빼는 조각 — 본체와 짝을 이뤄 그려지는 부품들. */
const FILL_SKIP = new Set(["tankgun", "burrowhole"]);
/** 모델별 상자 채움 몫(잉크 폭 / 상자 폭) — 종류마다 한 번만 재고 계속 쓴다. 방향마다
 *  다시 재면 몸이 도는 동안 크기가 출렁이고, 판도 두 배로 굽게 된다. */
const FILL_CACHE = new Map<string, number>();
const SPRITE_CACHE = new Map<string, { cv: HTMLCanvasElement; pad: number; l: number; bot: number; cx: number; top: number; w: number }>();
function unitSprite(
  op: UnitDrawOp, pxq: number, B: number,
): { cv: HTMLCanvasElement; pad: number; l: number; bot: number; cx: number; top: number; w: number } | null {
  const rotB = op.rotDeg !== undefined
    ? ((Math.round(op.rotDeg / 22.5) * 22.5) % 360 + 360) % 360 : -1;
  const vq = op.viewYaw ? Math.max(-36, Math.min(36, Math.round(op.viewYaw / 6) * 6)) : 0;
  const key = `${op.kind}|${rotB}|${op.flat ? 1 : 0}|${vq}|${op.pitch ? 1 : 0}`
    + `|${op.color}|${pxq}|${B.toFixed(2)}`;
  const hit = SPRITE_CACHE.get(key);
  if (hit) return hit;
  const { faces } = resolveShapeFaces(op.kind, op.rotDeg, op.flat, op.viewYaw, op.pitch);
  if (!faces) return null;
  /* (제거·요청) 드롭섀도 굽기 — 건물·유닛 그림자를 다 걷어 굽는 판도 그림자 없이 민다.
     pad는 안티에일리어싱 여유만. */
  const pad = 2;
  const l = pxq + pad * 2;
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.ceil(l * B));
  cv.height = cv.width;
  const c2 = cv.getContext("2d");
  if (!c2) return null;
  c2.setTransform(B, 0, 0, B, 0, 0);
  c2.translate(pad, pad);
  c2.scale(pxq / 16, pxq / 16);
  for (const [d, o, fill] of faces) {
    c2.globalAlpha = shadeBoost(o, fill);
    c2.fillStyle = fill ?? op.color;
    c2.fill(pathOf(d));
  }
  // 무한히 크지 않게 — 색·크기 조합이 쌓이면 통째로 비운다(다음 프레임에 필요분만 재적재).
  if (SPRITE_CACHE.size > 700) SPRITE_CACHE.clear();
  const entry = { cv, pad, l, ...contentBox(cv) };
  SPRITE_CACHE.set(key, entry);
  return entry;
}
/* 건물 스프라이트(요청: 건물도 병목 감축) — meet(비율 유지) 상자 건물을 같은 방식으로
   굽는다. 뷰박스 밖으로 살짝 삐치는 모델(높은 첨탑 등)을 위해 15% 머리방을 둔다. */
/* 건물 채움 보정에서 빼는 것들 — 크립 판(clipWalk)은 지형이고, 애드온 통로는 본체와
   부속 사이를 잇는 폭이 곧 제 길이라 늘리면 어긋난다. 미네랄은 발자국이 아니라 덩이
   넷을 흩어 놓은 무리라 요청대로 손대지 않는다. */
const BLD_FILL_SKIP = new Set(["addonlink", "mineral"]);
/** 프로토스 소환구 상자(타일)와 지면에서 띄우는 높이(타일) — 요청: 축소 + 더 띄우기. */
const WARP_TILES = 1.8;
const WARP_LIFT = 0.75;
/** 공사 모델(소환구·고치·공사장)을 발자국 한가운데보다 이만큼 아래(앞)에 앉힌다(요청). */
const CONSTRUCT_DROP = 0.55;
/** 그림자 색(요청: 검정 통일 대신 개인색) — 임자 색을 어둡게 눌러 쓴다. 너무 튀지
 *  않게 짙기를 0.34까지 낮추고(나머지는 검정과 섞음), 색을 못 읽으면 검정으로 둔다. */
const SHADOW_TINT_CACHE = new Map<string, string>();
function shadowTint(color: string | undefined): string {
  if (!color || color[0] !== "#") return "#000";
  const hit = SHADOW_TINT_CACHE.get(color);
  if (hit) return hit;
  const hex = color.length === 4
    ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
    : color;
  const n = Number.parseInt(hex.slice(1, 7), 16);
  if (!Number.isFinite(n)) return "#000";
  const k = 0.34;
  const out = `#${[16, 8, 0].map((sh) => Math.round(((n >> sh) & 255) * k)
    .toString(16).padStart(2, "0")).join("")}`;
  SHADOW_TINT_CACHE.set(color, out);
  return out;
}
/** 건물 모델이 제 발자국 상자를 채우는 몫 — 종류마다 한 번만 잰다. */
const BLD_FILL_CACHE = new Map<string, number>();
/** 건물 모델의 발·가로중심 자리 [cx몫, bot몫] — 구운 판 크기에 대한 비로 잰다.
 *  종류마다 한 번만 재는 것이 핵심이다(지적: 같은 넥서스인데 하나만 살짝 오른쪽으로
 *  나온다): 판은 요잉 6도 칸마다 따로 굽는데, 잉크 테두리 상자의 가로중심은 칸마다
 *  조금씩 달라 같은 건물이 자리마다 다르게 밀렸다. 채움 몫(BLD_FILL_CACHE)과 같은
 *  결로 한 번 재서 모두에게 같은 보정을 준다. */
const BLD_ANCHOR_CACHE = new Map<string, [number, number]>();
/* 발자국 대비 그릴 몫 — 기본은 0.95(발자국을 꽉 채운다). 본진 셋만 예외로 넘겨 그린다
   (요청: "넥서스 해처리 커맨드는 예외로 더 크게, 실제 게임처럼") — 원작에서도 이 셋의
   그림은 4×3 발자국을 넘어 앉는다. 레어·하이브는 해처리의 다음 단계라 같은 몫이다. */
const BLD_FILL_TARGET: Record<string, number> = {
  tomb: 1.2, pyramidWide: 1.2, hatchery: 1.2, lair: 1.2, hive: 1.2,
};
const BLD_SPRITE_CACHE = new Map<string, { cv: HTMLCanvasElement; pad: number; l: number; side: number; bot: number; top: number; w: number; cx: number }>();
function buildingSprite(
  op: UnitDrawOp, sideQ: number, B: number,
): { cv: HTMLCanvasElement; pad: number; l: number; side: number; bot: number; top: number; w: number; cx: number } | null {
  const vq = op.viewYaw ? Math.max(-36, Math.min(36, Math.round(op.viewYaw / 6) * 6)) : 0;
  const key = `${op.kind}|${op.rotDeg ?? 0}|${op.flat ? 1 : 0}|${vq}|${op.pitch ? 1 : 0}|${op.color}|${sideQ}|${B.toFixed(2)}`;
  const hit = BLD_SPRITE_CACHE.get(key);
  if (hit) return hit;
  const { faces } = resolveShapeFaces(op.kind, op.rotDeg, op.flat, op.viewYaw, op.pitch);
  if (!faces) return null;
  const pad = Math.ceil(sideQ * 0.15) + 2;
  const l = sideQ + pad * 2;
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.ceil(l * B));
  cv.height = cv.width;
  const c2 = cv.getContext("2d");
  if (!c2) return null;
  c2.setTransform(B, 0, 0, B, 0, 0);
  c2.translate(pad + sideQ / 2, pad + sideQ);
  c2.scale(sideQ / 16, sideQ / 16);
  c2.translate(-8, -16);
  for (const [d, o, fill] of faces) {
    c2.globalAlpha = shadeBoost(o, fill);
    c2.fillStyle = fill ?? op.color;
    c2.fill(pathOf(d));
  }
  if (BLD_SPRITE_CACHE.size > 500) BLD_SPRITE_CACHE.clear();
  const box9 = contentBox(cv);
  const entry = {
    cv, pad, l, side: sideQ, bot: box9.bot, top: box9.top, w: box9.w, cx: box9.cx,
  };
  BLD_SPRITE_CACHE.set(key, entry);
  return entry;
}
function UnitLayer({ ops, zoom, pan, wallMask, maskRects, clipQuad, showShadows, showOverlap, showHp, showCreep }: {
  ops: UnitDrawOp[]; zoom: number; pan: { x: number; y: number };
  /** 사양 게이트(요청) — 끄면 접지·겹침 그림자/체력바/크립을 안 그린다. 기본 켬. */
  showShadows?: boolean; showOverlap?: boolean; showHp?: boolean; showCreep?: boolean;
  /** 크립 차단 마스크(요청: 벽·램프·다리는 크립이 못 뚫는다) — 칸 하나가 픽셀 하나인
   *  지형 캔버스. clipWalk 판들을 깐 직후 destination-out으로 파낸다. */
  wallMask?: HTMLCanvasElement | null;
  /** 마스크를 얹을 화면 자리들 [원본 y, 원본 높이, fx0, fy0, fx1, fy1] — 평면은 맵
   *  전체 한 장, 입체는 원근이 줄마다 달라 지형 한 줄씩 근사한다. */
  maskRects?: [number, number, number, number, number, number][];
  /** 크립을 가두는 맵 네 모서리(분수 좌표, 시계방향) — 평면은 단위 사각형이고 입체는
   *  원근 투영된 사다리꼴이다(재지적: 3D에서 크립이 영역을 벗어남 — 직사각 클립은
   *  평면에서만 맞았다). rotateX 원근은 호모그래피라 변이 직선으로 남아 네 점이면 된다. */
  clipQuad?: [number, number][];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // 의존성 없는 effect — 매 렌더(t 걸음)마다 다시 그린다. ops는 렌더마다 새로 모인다.
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const cw = cv.clientWidth;
    const ch = cv.clientHeight;
    if (!cw || !ch) return;
    /* 선명한 확대(지적: 확대가 선명하게 돼야) — 렌즈의 CSS 확대에 태우면 배킹 해상도가
       줌을 따라 커져야 해서 한계(4096px)에 막혀 흐려졌다. 이제 캔버스는 렌즈 밖에서
       뷰포트 크기 그대로 두고, 줌·팬을 그리기 좌표에 직접 입힌다 — 어느 배율에서도
       화면 픽셀(dpr) 그대로라 늘 또렷하고, 화면 밖 마커는 걸러 깊은 줌일수록 그릴
       것이 오히려 준다. */
    const dpr = window.devicePixelRatio || 1;
    const B = Math.min(dpr, 4096 / Math.max(cw, ch, 1));
    const bw = Math.round(cw * B);
    const bh = Math.round(ch * B);
    if (cv.width !== bw) cv.width = bw;
    if (cv.height !== bh) cv.height = bh;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(B, 0, 0, B, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    /* (제거·요청) 도형 드롭섀도 — 건물·유닛 그림자를 다 걷었다(떠다니는 것 제외).
       떠 있음은 아래 hover 분기의 발밑 타원만 말한다. */
    // 렌즈 CSS(translate(pan) scale(zoom), 원점 가운데)와 같은 사상 — 분수 자리를
    // 확대·팬이 실린 화면 픽셀로 푼다.
    const zx = (f: number): number => (f - 0.5) * cw * zoom + cw / 2 + pan.x;
    const zy = (f: number): number => (f - 0.5) * ch * zoom + ch / 2 + pan.y;
    /* 공중은 늘 위층(지적: 공중 유닛이 뒤·아래 건물에 가려짐) — 화가 순서에서 공중
       유닛을 통째로 지상·건물 위로 올린다. 공중끼리는 제 z 순서 그대로다. */
    /* 화면 밖 선별(지적: 줌·드래그 버벅임) — 이완·겹침·그리기 전에 뷰포트 밖(여유
       160px)을 통째로 걸러낸다. 깊은 줌일수록 남는 일이 급감한다. 크립 판은 맵
       전체 클립이라 남긴다. */
    const CULL = 160;
    const inView0 = (o: UnitDrawOp): boolean => {
      if (o.clipWalk) return true;
      const ex0 = (o.wFrac !== undefined
        ? Math.max(o.wFrac, o.hFrac ?? 0) * cw : o.sizePx) * zoom + CULL;
      const vx0 = zx(o.fx);
      const vy0 = zy(o.fy);
      return vx0 >= -ex0 && vx0 <= cw + ex0 && vy0 >= -ex0 && vy0 <= ch + ex0;
    };
    const sorted = [...ops].sort((a, b) => (a.z + (a.air ? 100000 : 0)) - (b.z + (b.air ? 100000 : 0))).filter(inView0);
    /* ── 겹침 불가 원칙(요청: 유닛·건물은 겹쳐지지 않는다, 공중은 예외) — 그리기 전에
       지상 유닛 마커를 서로·건물과 겹치지 않게 밀어낸다. 화면 픽셀 좌표에서 2회 이완:
       ① 건물 상자 안에 든 유닛은 가장 가까운 변 밖으로, ② 유닛끼리는 반지름 합의 0.8
       보다 가까우면 절반씩 서로 반대로. 자리 계산(명령 좌표)은 그대로고 표시만 민다. */
    {
      const obst: { x: number; y: number; hw: number; hh: number }[] = [];
      const mov: number[] = [];
      for (let i = 0; i < sorted.length; i += 1) {
        const o = sorted[i];
        if (o.clipWalk || o.textGlyph) continue;
        if (o.wFrac !== undefined && o.hFrac !== undefined) {
          obst.push({ x: zx(o.fx), y: zy(o.fy), hw: (o.wFrac * cw * zoom) / 2, hh: (o.hFrac * cw * zoom) / 2 });
          continue;
        }
        if (!o.air && !o.noSep && UNIT_KIND_SET.has(o.kind)) mov.push(i);
      }
      if (mov.length > 0) {
        const px = mov.map((i) => zx(sorted[i].fx));
        const py = mov.map((i) => zy(sorted[i].fy));
        const pr = mov.map((i) => Math.max(2, sorted[i].sizePx * zoom * 0.32));
        for (let it = 0; it < 2; it += 1) {
          // ① 건물 밖으로 — 침투가 얕은 축으로 밀어낸다.
          for (let m = 0; m < mov.length; m += 1) {
            for (const b of obst) {
              const dx = px[m] - b.x;
              const dy = py[m] - b.y;
              const ox = b.hw + pr[m] - Math.abs(dx);
              const oy = b.hh + pr[m] - Math.abs(dy);
              if (ox <= 0 || oy <= 0) continue;
              if (ox < oy) px[m] += (dx >= 0 ? 1 : -1) * ox;
              else py[m] += (dy >= 0 ? 1 : -1) * oy;
            }
          }
          // ② 유닛끼리 — 촘촘한 전장 대비 균일 격자로 이웃만 본다.
          const cell = 28;
          const gridMap = new Map<number, number[]>();
          for (let m = 0; m < mov.length; m += 1) {
            const key = (Math.floor(px[m] / cell) * 4096 + Math.floor(py[m] / cell)) | 0;
            const bucket = gridMap.get(key);
            if (bucket) bucket.push(m);
            else gridMap.set(key, [m]);
          }
          for (let m = 0; m < mov.length; m += 1) {
            const cx0 = Math.floor(px[m] / cell);
            const cy0 = Math.floor(py[m] / cell);
            for (let gx = cx0 - 1; gx <= cx0 + 1; gx += 1) {
              for (let gy = cy0 - 1; gy <= cy0 + 1; gy += 1) {
                const bucket = gridMap.get((gx * 4096 + gy) | 0);
                if (!bucket) continue;
                for (const n of bucket) {
                  if (n <= m) continue;
                  /* 제 일꾼끼리는 겹침 허용(지적) — 자원 곁에 몰린 일꾼은 실제로도
                     포개져 일하니 서로 안 밀어낸다. 남의 일꾼·전투 유닛과는 민다. */
                  const oa = sorted[mov[m]];
                  const ob = sorted[mov[n]];
                  if (WORKER_KIND_SET.has(oa.kind) && WORKER_KIND_SET.has(ob.kind)
                    && oa.color === ob.color) continue;
                  let dx = px[n] - px[m];
                  let dy = py[n] - py[m];
                  let d = Math.hypot(dx, dy);
                  const min = (pr[m] + pr[n]) * 0.8;
                  if (d >= min) continue;
                  if (d < 0.01) { dx = ((m * 37) % 7) - 3 || 1; dy = ((n * 53) % 7) - 3 || -1; d = Math.hypot(dx, dy); }
                  const push = (min - d) / 2 / d;
                  px[m] -= dx * push; py[m] -= dy * push;
                  px[n] += dx * push; py[n] += dy * push;
                }
              }
            }
          }
        }
        /* 프레임당 밀림 상한(재지적: 가만히 선 유닛끼리 자리 경쟁하듯 괜히 움직이고,
           이동 중에도 점프) — 이완은 스무딩 뒤 캔버스 단계라, 이웃이 조금만 움직여도
           (잔걸음·교전 당김) 해법이 확 바뀌며 점프를 도로 만들었다. 한 프레임에 3px
           까지만 밀고(밀림은 다음 프레임에 이어 받는다) 0.4px 미만 떨림은 버린다. */
        for (let m = 0; m < mov.length; m += 1) {
          const o = sorted[mov[m]];
          const x0 = zx(o.fx);
          const y0 = zy(o.fy);
          let ddx = px[m] - x0;
          let ddy = py[m] - y0;
          const dd = Math.hypot(ddx, ddy);
          if (dd < 0.4) continue;
          if (dd > 3) { ddx = (ddx / dd) * 3; ddy = (ddy / dd) * 3; }
          o.fx = (x0 + ddx - cw / 2 - pan.x) / (cw * zoom) + 0.5;
          o.fy = (y0 + ddy - ch / 2 - pan.y) / (ch * zoom) + 0.5;
        }
      }
    }
    const paintOps = (list: UnitDrawOp[]) => {
    /* 겹침 그림자(확대 적용 요청: 공중만 아니라 유닛·건물 공통) — 몸이 닿는 것들 중
       '나중에 그려지는(앞)' 쪽에 옅은 그림자를 켜 뒤 몸과 윤곽이 갈린다. 안 겹치면
       기존대로 그림자 없음. 이웃 탐색은 이완과 같은 균일 격자. */
    const airOverlap = new Set<UnitDrawOp>();
    if (showOverlap !== false) {
      const cell2 = 48;
      const gmap = new Map<number, number[]>();
      const rOf = (o: UnitDrawOp): number => (o.wFrac !== undefined
        ? Math.max(o.wFrac, o.hFrac ?? 0) * cw * zoom * 0.5
        : o.sizePx * zoom * 0.5);
      const cand: number[] = [];
      for (let i2 = 0; i2 < list.length; i2 += 1) {
        const o = list[i2];
        if (o.textGlyph || o.clipWalk) continue;
        cand.push(i2);
        const key2 = (Math.floor(zx(o.fx) / cell2) * 4096 + Math.floor(zy(o.fy) / cell2)) | 0;
        const bucket = gmap.get(key2);
        if (bucket) bucket.push(i2); else gmap.set(key2, [i2]);
      }
      for (const i2 of cand) {
        const oa = list[i2];
        const ax2 = zx(oa.fx);
        const ay2 = zy(oa.fy);
        const cx0 = Math.floor(ax2 / cell2);
        const cy0 = Math.floor(ay2 / cell2);
        for (let gx = cx0 - 1; gx <= cx0 + 1; gx += 1) {
          for (let gy = cy0 - 1; gy <= cy0 + 1; gy += 1) {
            const bucket = gmap.get((gx * 4096 + gy) | 0);
            if (!bucket) continue;
            for (const j2 of bucket) {
              if (j2 <= i2) continue;
              const ob = list[j2];
              const dd2 = Math.hypot(zx(ob.fx) - ax2, zy(ob.fy) - ay2);
              if (dd2 < (rOf(oa) + rOf(ob)) * 0.8) airOverlap.add(list[Math.max(i2, j2)]);
            }
          }
        }
      }
    }
    for (const op of list) {
      const sx = zx(op.fx);
      const sy = zy(op.fy);
      /* 발이 닿는 세로 자리 — 지면선이 있으면 그것을 쓴다(그림자와 같은 지면 사상). */
      const groundY = op.baseFy !== undefined ? zy(op.baseFy) : undefined;
      // 화면 밖은 걸러낸다 — 깊은 줌에서 그리기가 오히려 줄어드는 이유.
      const ext = (op.wFrac !== undefined
        ? Math.max(op.wFrac, op.hFrac ?? 0) * cw : op.sizePx) * zoom + 24;
      if (sx < -ext || sx > cw + ext || sy < -ext || sy > ch + ext) continue;
      ctx.save();
      /* 건물은 그림자 없음(지적: 떠 보임 — 유닛만 그림자) — SVG 시절 filter:none과 동일.
         공중 유닛도 자체 그림자는 걷는다(지적) — 바닥 타원이 그림자를 맡으니, 몸에 또
         드리우면 그림자가 두 겹이 된다. 일꾼 셋도 떠다니는 기계라 같은 규칙(지적:
         일꾼들도 공중에 떠 있으니 바닥 그림자) — 다만 몸은 안 들어올린다. */
      /* 떠다니는 지상 유닛도 같은 규칙(지적) — 벌처·아콘·다크 아콘·하이 템플러는
         부양 유닛이라 발밑 그림자를 깐다. */
      const hover = op.air || op.kind === "scv" || op.kind === "probe" || op.kind === "drone"
        || op.kind === "vulture" || op.kind === "archon" || op.kind === "darchon" || op.kind === "htemp";
      if (op.textGlyph) {
        // 부속건물 + 같은 글자 하나 — 스팬 글자와 같은 굵기·가운데 앵커.
        ctx.globalAlpha = op.alpha;
        ctx.fillStyle = op.color;
        ctx.font = `700 ${op.sizePx * zoom}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(op.textGlyph, sx, sy);
        ctx.restore();
        continue;
      }
      if (op.wFrac !== undefined && op.hFrac !== undefined) {
        // 건물 상자 — 스팬의 % 폭 + aspectRatio(폭 기준)를 그대로 픽셀로 푼 것.
        const wPx = op.wFrac * cw * zoom;
        const hPx = op.hFrac * cw * zoom;
        if (op.boxFit === "fill") {
          // 맨 네모(전용 도형 없는 건물) — 상자를 그대로 채운다(.scr-motion-sq).
          ctx.globalAlpha = op.alpha;
          ctx.fillStyle = op.color;
          ctx.fillRect(sx - wPx / 2, sy - hPx / 2, wPx, hPx);
          ctx.restore();
          continue;
        }
        // keepRatio(xMidYMax meet) — 비율 유지로 상자에 맞추고 바닥 가운데 정렬.
        // 스프라이트로 찍는다(요청: 건물도 병목 감축) — 실패 시 직접 그리기 폴백.
        const sidePx = op.fitWidth ? wPx : Math.min(wPx, hPx);
        const sideQ = Math.max(4, Math.round(sidePx / 2) * 2);
        let bspr = buildingSprite(op, sideQ, B);
        let sideQEff = sideQ;
        /* 발자국을 꽉 채운다(지적: "건물크기가 제각각이야", "캔버스를 왜 꽉 안 채우게
           해놨어") — 상자는 발자국(타일)에 맞춰 뒀지만 모델이 그 상자를 채우는 몫이
           0.40~1.15로 제각각이라(실측: 옵저버토리 0.40 · 컴샛/머신샵 0.50 · 게이트
           0.67 · 해처리 0.91 · 커맨드/넥서스 1.15) 같은 4×3 건물끼리도 세 배 가까이
           벌어졌다. 구운 판의 실제 잉크 폭을 재서 발자국의 95%가 되게 맞춘다 —
           작은 놈은 키우고, 발자국을 넘던 놈(커맨드·넥서스)은 줄인다.
           그림자도 이 값을 써야 해서(아래) 스프라이트 바로 뒤에서 구한다. */
        let bFill = BLD_FILL_CACHE.get(op.kind);
        if (bFill === undefined && bspr && bspr.w > 0) {
          bFill = (bspr.w / B) / sideQ;
          BLD_FILL_CACHE.set(op.kind, bFill);
        }
        // 발·가로중심 보정도 종류마다 한 번만(요잉 칸마다 달라지면 자리가 흔들린다).
        let bAnc = BLD_ANCHOR_CACHE.get(op.kind);
        if (bAnc === undefined && bspr && bspr.w > 0) {
          bAnc = [(bspr.cx / B) / bspr.l, (bspr.bot / B) / bspr.l];
          BLD_ANCHOR_CACHE.set(op.kind, bAnc);
        }
        const kFit = op.clipWalk || BLD_FILL_SKIP.has(op.kind) || !bFill
          ? 1 : Math.min(2.5, Math.max(0.7, (BLD_FILL_TARGET[op.kind] ?? 0.95) / bFill));
        /* 채움 보정만큼 더 크게 굽는다(지적: 실제 모델링 크기가 작은 건물이 화면에서
           해상도가 떨어져 보인다) — 발자국 크기로 구운 판을 최대 2.5배까지 늘려
           그리고 있었으니 그만큼 뿌옜다. 늘릴 배율을 알고 나면 그 크기로 다시 구워
           확대 없이 1:1로 찍는다. */
        if (bspr && kFit > 1.08) {
          const sideQ2 = Math.max(4, Math.round((sideQ * kFit) / 2) * 2);
          const b2 = buildingSprite(op, sideQ2, B);
          if (b2) { bspr = b2; sideQEff = sideQ2; }
        }
        /* 접지 그림자(재재지적: 해처리가 떠 있다) — 상자 바닥 어림이 아니라 구운
           판의 실제 바닥 픽셀(contentBottom)에 붙인다. 모델이 상자를 다 안 채워도
           발이 그림자에 닿는다. */
        if (op.groundShadow && showShadows !== false) {
          /* 바닥 '발자국'만 덮는다(정정: 칸(hPx)은 모델 높이까지 포함해, 칸 기준 타원은
             건물을 통째로 감싸는 큰 원이었다 — 내접으로 바꿔도 거의 그대로라 "적용 안
             됨"으로 보였다). 발자국 깊이 = 폭 × footRatio, 자리는 칸 바닥에 붙인다. */
          /* 2D는 바닥이 의도적으로 눌려 있다(지적) — 원작 이동 마커와 같은 2:1 지면
             관례라, 그림자 세로도 그만큼(0.55) 줄인다. 3D(pitch)는 사영이 이미 칸을
             눌러 놓아 그대로다. */
          /* 발자국보다 작게(재지적: 건물 그림자가 또 말썽 — 바닥에 맞는 크기로) —
             건물은 45도로 요잉해 세워서, 상자 폭을 그대로 쓰면 실제 닿는 바닥보다
             한참 넓은 타원이 깔린다. 발자국 폭의 0.72만 덮는다. 3D도 지면 사영을
             한 번 더 눌러(0.68) 납작하게 붙인다. */
          /* 그림자를 그린 몸에 맞춘다(지적: 건물 크기를 고치면서 그림자는 그대로라
             너무 작고, 3D에선 바닥에 안 붙고 서 있다) — 폭을 발자국의 0.72배로 못
             박아 두었더니, 채움 보정으로 몸이 커진 뒤엔 발치에 작은 점만 남았다.
             실제로 그려지는 잉크 폭(kFit 반영)의 0.88배로 잡는다.
             입체에서는 임의 축소를 걷고 바닥면 그대로 눕힌다(지적: 3D 그림자는 바닥
             팔레트에 맞아야 한다) — 세로 한 타일이 화면에서 가로 한 타일의 몇 배로
             보이는지(groundSquash)를 자리마다 실제로 재어 넘겨받는다. 그 값이 곧
             바닥면의 눌림이라, 그림자가 지면 격자와 같은 각도로 깔린다. */
          const squish = 0.55;
          const inkW9 = bspr && bspr.w > 0 ? (bspr.w / B) * ((sidePx * kFit) / sideQEff) : wPx;
          /* 2D는 그린 몸에만 맞춘다(지적: 평면에선 건물이 높이까지 바닥 상자 안으로
             눌려 들어가, 발자국 폭(wPx) 바닥은 그린 몸보다 늘 크다) — 발자국 하한을
             걷고 잉크 폭의 0.72만 덮는다. 입체는 종전대로 발자국 하한을 지킨다. */
          const footW = op.pitch
            ? Math.max(wPx * 0.7, inkW9 * 0.88)
            : inkW9 * 0.72;
          const fdPx = footW * (op.footRatio ?? 0.6) * squish;
          ctx.save();
          ctx.shadowColor = "transparent";
          // 개인색 그림자(요청) — 어둡게 누른 임자 색. 짙기는 살짝 올려 형태를 지킨다.
          ctx.globalAlpha = op.alpha * 0.2;
          ctx.fillStyle = shadowTint(op.color);
          ctx.beginPath();
          if (op.shadowPts && op.shadowPts.length >= 3) {
            /* 바닥에 실제로 그린다(요청) — 발자국 타원을 타일 공간에서 찍어 둔 점들을
               그대로 화면으로 옮겨 잇는다. 원근이 실려 있어 멀수록 눌리고 가까울수록
               펴지며, 지면 격자와 같은 평면에 눕는다. */
            const p0 = op.shadowPts[0];
            ctx.moveTo(zx(p0[0]), zy(p0[1]));
            for (let q = 1; q < op.shadowPts.length; q += 1) {
              const pq = op.shadowPts[q];
              ctx.lineTo(zx(pq[0]), zy(pq[1]));
            }
            ctx.closePath();
          } else {
            ctx.ellipse(
              sx, (groundY ?? sy + hPx / 2) - fdPx / 2, footW * 0.5,
              Math.max(2, fdPx * 0.5), 0, 0, Math.PI * 2,
            );
          }
          ctx.fill();
          ctx.restore();
        }
        if (bspr) {
          const k = (sidePx * kFit) / sideQEff;
          // 겹친 것만 살짝 그림자(확대 적용: 유닛·건물 공통).
          if (airOverlap.has(op)) {
            ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
            ctx.shadowBlur = Math.max(1.5, sidePx * 0.06);
            ctx.shadowOffsetY = Math.max(1, sidePx * 0.04);
          } else ctx.shadowColor = "transparent";
          ctx.globalAlpha = op.alpha;
          /* 발은 땅에(보정과 짝) — 상자 바닥에 맞추면 모델의 잉크 바닥이 상자보다
             위에 있는 만큼의 틈이 배율만큼 함께 커져 건물이 떠 보인다. 그린 픽셀의
             실제 바닥(bot)을 발자국 바닥선에 앉힌다. */
          const bTop9 = (groundY ?? sy + hPx / 2)
            - (bAnc ? bAnc[1] * bspr.l : bspr.bot / B) * k;
          /* 좌우 어긋남 수리(지적: 건물이 살짝 왼쪽·오른쪽으로 어긋난다) — 상자 중심에
             맞춰 찍었는데 모델이 제 16-상자 안에서 치우쳐 그려진 것들이 있다. 발자국을
             채우려 배율을 키우면 그 치우침도 함께 커져 눈에 띈다. 그린 픽셀의 가로
             중심(cx)을 발자국 중심에 앉힌다 — 바닥(bot)을 땅에 앉힌 것과 같은 결. */
          const bLeft9 = sx - (bAnc ? bAnc[0] * bspr.l : bspr.cx / B) * k;
          ctx.drawImage(
            bspr.cv,
            bLeft9, bTop9,
            bspr.l * k, bspr.l * k,
          );
          /* 건물 체력바(요청) — 다친 건물 위에만. 유닛 바와 같은 3색. */
          if (showHp !== false && op.hpFrac !== undefined && op.hpFrac > 0) {
            /* 최대 체력의 제곱근 비례(재재지적: 정비례로 갔더니 적용이 안 된 듯 보이고
               작은 건물 바가 실오라기가 됨) — 넥서스(1500)와 성큰(300)이 √5≈2.2배 차이. */
            /* 유닛 바와 같은 원칙(전수조사) — 바는 제 건물보다 넓지 않다. 배율은
               0.6~1.4배로 조이고 폭 기준도 0.7 → 0.6으로 낮춘다. */
            /* 유닛 바와 같이 얇고 짧게(요청) — 길이 0.6 → 0.4배, 두께 0.05 → 0.03배. */
            const bScale = Math.min(1.4, Math.max(0.6, Math.sqrt((op.hpMax ?? 800) / 1000)));
            // 유닛과 같은 몫으로(요청) — 0.4 → 0.267, 0.03 → 0.015.
            const bw3 = Math.max(2.5, wPx * 0.267 * bScale);
            const bh3 = Math.max(0.6, wPx * 0.015);
            const bx3 = sx - bw3 / 2;
            /* 머리 바로 위(재재지적: 너무 위) — 그려진 픽셀 꼭대기에 살짝만 띄운다. */
            const byTop = bTop9 + (bspr.top / B) * k - bh3 - 2;
            ctx.globalAlpha = op.alpha * 0.9;
            ctx.fillStyle = "rgba(10, 14, 10, 0.75)";
            ctx.fillRect(bx3 - 0.5, byTop - 0.5, bw3 + 1, bh3 + 1);
            ctx.fillStyle = op.hpFrac > 0.66 ? "#39c04f" : op.hpFrac > 0.33 ? "#d9b13b" : "#d5473d";
            ctx.fillRect(bx3, byTop, bw3 * op.hpFrac, bh3);
          }
          ctx.restore();
          continue;
        }
        const { faces } = resolveShapeFaces(op.kind, op.rotDeg, op.flat, op.viewYaw, op.pitch);
        if (faces) {
          const s = (op.fitWidth ? wPx : Math.min(wPx, hPx)) / 16;
          ctx.translate(sx, groundY ?? sy + hPx / 2);
          ctx.scale(s, s);
          ctx.translate(-8, -16);
          for (const [d, o, fill] of faces) {
            ctx.globalAlpha = op.alpha * shadeBoost(o, fill);
            ctx.fillStyle = fill ?? op.color;
            ctx.fill(pathOf(d));
          }
        }
        ctx.restore();
        continue;
      }
      const { faces, rot } = resolveShapeFaces(op.kind, op.rotDeg, op.flat, op.viewYaw, op.pitch);
      if (!faces) { ctx.restore(); continue; }
      /* 상자를 덜 채운 몫을 되돌린다(전수조사: "너무 크게/작게 그려지는 것 체크") —
         등급으로 상자는 같게 맞췄어도, 모델이 그 상자를 채우는 몫이 24~69%로 제각각
         이라 눈에 보이는 몸은 여전히 세 배 가까이 벌어져 있었다(실측: 프로브·저글링
         0.24, 질럿·SCV 0.42, 셔틀 0.69 — 같은 소형끼리도 1.8배). 구운 판의 실제 잉크
         폭을 재서 목표 몫까지 키운다. 키우기만 하고(≥1) 상한을 두어(1.55), 잘 채운
         모델은 건드리지 않는다. 시즈 포신·버로우 구멍처럼 본체와 짝을 이루는 조각은
         제 크기를 지켜야 하므로 뺀다 — 혼자 부풀면 본체와 어긋난다. */
      const px0 = op.sizePx * zoom;
      let fillW = FILL_CACHE.get(op.kind);
      if (fillW === undefined && !FILL_SKIP.has(op.kind)) {
        const pq0 = Math.max(4, Math.round(px0 / 2) * 2);
        const sp0 = unitSprite(op, pq0, B);
        fillW = sp0 && sp0.w > 0 ? (sp0.w / B) / pq0 : 1;
        FILL_CACHE.set(op.kind, fillW);
      }
      const px = px0 * Math.min(1.55, Math.max(1, 0.58 / (fillW ?? 1)));
      /* 공중 유닛(요청: 높이 더 높이 + 바닥 그림자) — 발밑 자리에 그림자 타원을 깔고
         몸은 반 키만큼 위로 띄운다. 떠 있음이 땅 유닛과 한눈에 갈린다. */
      // 높이 반으로(재재지적) — 1.6 → 0.8.
      const lift = (op.air ? px * 0.8 : 0) + (op.rise ?? 0) * px;
      /* 판을 먼저 굽는다 — 그림자를 어림 오프셋이 아니라 판의 실제 바닥 픽셀
         (contentBottom)에 붙이기 위해서다(재재지적: 드론이 높이 떠 있다). */
      const pxq = Math.max(4, Math.round(px / 2) * 2);
      const spr = unitSprite(op, pxq, B);
      const kU = px / pxq;
      const footY = spr
        ? sy - px * 0.24 - (spr.pad + pxq / 2) * kU + (spr.bot / B) * kU - 1
        : sy + px * 0.28;
      /* 내용물 가로 중심(재지적: 그림자·링이 몸과 안 맞음) — 상자 중심이 아니라 실제
         그려진 픽셀의 가운데에 붙인다. */
      const footX = spr
        ? sx - (spr.pad + pxq / 2) * kU + (spr.cx / B) * kU
        : sx;
      if (hover && !op.noShadow && showShadows !== false) {
        ctx.save();
        ctx.shadowColor = "transparent";
        /* 떠다니는 지상 유닛(일꾼·벌처·아콘류)은 겨우 발밑만 떠 있다(지적: 그림자가
           너무 크고 진해) — 높이 나는 공중 유닛보다 작고 옅은 타원. */
        // 그림자 살짝 축소(지적) — 높이 나는 만큼 발밑 그림자는 작고 옅게.
        const shw = px * (op.air ? 0.26 : 0.17);
        /* 하이템플러 부양 로브(지적: 그림자가 몸에서 떨어져 분신 같다) — 그림자를
           위로 당겨 몸에 겹친다. */
        const shUp = op.kind === "htemp" ? px * 0.16 : 0;
        ctx.globalAlpha = op.alpha * (op.air ? 0.26 : 0.16);
        ctx.fillStyle = shadowTint(op.color);
        /* beginPath 필수(조사: 전 모드 거대 검은 쐐기의 진범) — 경로를 안 비우면
           ellipse가 직전 점에서 타원까지 선분을 이어 붙이며 프레임 내내 누적되고,
           fill이 맵을 가로지르는 검은 다각형들을 채웠다. 요잉과 무관했다. */
        ctx.beginPath();
        /* 발끝에 딱(재재지적: 그림자 각도·위치 — 발에 붙어야 하고 부양 유닛도 훨~씬
           낮게) — 그림자를 스프라이트 바닥선(0.28px)에 놓아 몸과 틈이 없다. 공중
           유닛만 몸이 위로 들려 그 틈이 곧 비행 높이로 읽힌다. */
        /* 바닥과 평행하게(재지적: 그림자 각도가 바닥과 평행이 아니다) — 입체 보기의
           바닥은 눌려 있는데 타원이 덜 납작해 비스듬히 선 판처럼 읽혔다. 입체에선
           세로 반지름을 바닥 기울기만큼 더 누른다. */
        /* 바닥면 전체(재지적: 그림자가 캔버스를 못 채우고 앞쪽만 납작하게) — 가장
           앞 픽셀(footY)에 붙이면 앞모서리 조각만 보인다. 타원을 키우고 중심을
           위로 당겨 몸 아래 발자국을 덮는다. */
        /* 그림자는 땅에(지적: 오버로드 위치는 해처리 위인데 그림자가 훨씬 아래) — 몸은
           lift만큼 '위로' 들리고 땅은 제자리(footY)인데, 여기에 lift를 '더해' 그림자가
           비행 높이만큼 남쪽으로 밀려 있었다. 발밑 땅 자리 그대로 둔다. */
        /* 3D에선 더 눕는다(지적: 그림자가 안 눕는 문제) — 0.6은 바닥 눌림(0.74×부감)에
           비해 서 보였다. 0.38로 바짝 눕힌다. */
        ctx.ellipse(footX, footY - shw * 0.22 - shUp, shw * 1.1, shw * (op.air ? 0.5 : 0.42) * (op.pitch ? 0.38 : 1), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (showShadows !== false && !op.air && UNIT_KIND_SET.has(op.kind)) {
        /* 지상 유닛 접지 그림자(재지적: 전부 떠 있는 느낌 — 발이 그림자에 닿아야 하고
           훨씬 작아야) — 발끝 자리에 딱 붙는 아주 작은 타원. */
        ctx.save();
        ctx.shadowColor = "transparent";
        ctx.globalAlpha = op.alpha * 0.15;
        ctx.fillStyle = shadowTint(op.color);
        ctx.beginPath();
        // 바닥면 전체(재지적: 앞쪽만 납작) — 타원을 키우고 중심을 위로 당긴다.
        ctx.ellipse(footX, footY - px * 0.09 - (op.kind === "htemp" ? px * 0.16 : 0), px * 0.19, px * 0.11 * (op.pitch ? 0.38 : 1), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      /* 선택 링(지적: 드래그 선택 구분) — 잡힌 유닛 발밑의 가는 흰 타원 테.
         공중 유닛은 링도 공중이다(지적: 유닛 바닥에) — 들린 몸의 바닥선에 붙인다. */
      if (op.selRing) {
        ctx.save();
        ctx.shadowColor = "transparent";
        ctx.globalAlpha = op.alpha * 0.85;
        ctx.strokeStyle = "rgba(240, 255, 240, 0.95)";
        /* 선 굵기는 화면 고정(지적: 링은 UI 요소 — 확대에 굵어지면 안 됨) — 반지름은
           유닛(px)을 따라가되 굵기에서 zoom을 뺀다. */
        ctx.lineWidth = Math.max(0.7, op.sizePx * 0.025);
        ctx.beginPath();
        // 링도 내용물 발끝에(재지적) — 상자 고정 오프셋은 작은 모델에서 몸 아래로 떨어졌다.
        const ringY = op.air ? footY - lift : footY - px * 0.03;
        ctx.ellipse(footX, ringY, px * 0.25, px * 0.14 * (op.pitch ? 0.38 : 1), 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      /* 상태 오라(전수조사) — 걸린 유닛 밑에 그 기술의 색빛. */
      if (op.tint) {
        ctx.save();
        ctx.shadowColor = "transparent";
        ctx.globalAlpha = op.alpha * 0.32;
        ctx.fillStyle = op.tint;
        ctx.beginPath();
        // 상태 오라도 3D에선 눕는다(지적과 같은 결).
        ctx.ellipse(sx, sy - px * 0.08 - lift, px * 0.55, px * 0.42 * (op.pitch ? 0.45 : 1), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      /* 체력바(요청: 체력을 지니고 다니는 생애주기) — 다친 유닛 머리 위에 원작풍
         바: 초록(>66%)·노랑(>33%)·빨강. 성한 유닛에는 안 띄워 화면을 아낀다. */
      if (showHp !== false && op.hpFrac !== undefined && op.hpFrac > 0) {
        /* 100% 길이 = 최대 체력의 제곱근 비례(재재지적: 정비례는 마린 바가 4px 바닥에
           눌리고 큰 유닛 바만 길어져 '적용 안 된' 것처럼 보였다) — 마린(40) 대비
           울트라(400)가 √10≈3.2배. 남은 칸과 색은 자기 비율(hpFrac) 그대로다. */
        /* 다만 바가 유닛보다 커지면 안 된다(전수조사: 크기를 타일 비례로 바로잡고 나니
           3.2배까지 늘어난 바가 몸을 덮어, 지도가 유닛이 아니라 초록 막대밭으로 읽혔다)
           — 배율은 0.7~1.7배로 조인다. 등급 자체가 이미 몸 크기를 가르므로(소 1.9 ↔
           대 3.3타일) 저글링과 울트라의 바 길이 차이는 그대로 4배쯤 난다. */
        /* 전체적으로 상당히 얇고 짧게(요청) — 길이 0.85 → 0.58배, 두께 0.085 → 0.05배.
           바닥값도 함께 내려(3 → 2px, 1.4 → 0.9px) 작은 유닛에서 굵어 보이지 않게. */
        const hpScale = Math.min(1.25, Math.max(0.75, Math.sqrt((op.hpMax ?? 100) / 150)));
        // 다시 길이 2/3 · 두께 1/2(요청) — 0.58 → 0.387, 0.05 → 0.025.
        const bw2 = Math.max(1.5, px * 0.387 * hpScale);
        const bh2 = Math.max(0.5, px * 0.025);
        const bx2 = sx - bw2 / 2;
        /* 머리 바로 위(재재지적: 너무 위) — 실제 그려진 픽셀 꼭대기(contentBox.top)에
           살짝만 띄운다. */
        const headY = spr
          ? sy - px * 0.24 - (spr.pad + pxq / 2) * kU + (spr.top / B) * kU
          : sy - px * 0.55;
        const by2 = headY - lift - bh2 - Math.max(1.5, px * 0.04);
        ctx.save();
        ctx.shadowColor = "transparent";
        ctx.globalAlpha = op.alpha * 0.9;
        ctx.fillStyle = "rgba(10, 14, 10, 0.75)";
        ctx.fillRect(bx2 - 0.5, by2 - 0.5, bw2 + 1, bh2 + 1);
        ctx.fillStyle = op.hpFrac > 0.66 ? "#39c04f" : op.hpFrac > 0.33 ? "#d9b13b" : "#d5473d";
        ctx.fillRect(bx2, by2, bw2 * op.hpFrac, bh2);
        ctx.restore();
      }
      /* 스프라이트로 찍는다(수리: 프레임 뚝뚝) — 면 낱장 fill 대신 구운 판 한 장.
         크기는 2px 칸으로 양자화해 캐시를 맞추고, 블릿에서 잔차 배율을 입힌다. */
      ctx.translate(sx, sy - px * 0.24 - lift);
      if (rot) ctx.rotate((rot * Math.PI) / 180);
      if (spr) {
        const k = px / pxq;
        // 겹친 것만 살짝 그림자(확대 적용: 유닛·건물 공통) — 뒤 몸과 또렷이 갈린다.
        if (airOverlap.has(op)) {
          ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
          ctx.shadowBlur = Math.max(1.5, px * 0.1);
          ctx.shadowOffsetY = Math.max(1, px * 0.07);
        } else ctx.shadowColor = "transparent";
        ctx.globalAlpha = op.alpha;
        ctx.drawImage(
          spr.cv,
          -(spr.pad + pxq / 2) * k, -(spr.pad + pxq / 2) * k,
          spr.l * k, spr.l * k,
        );
        ctx.restore();
        continue;
      }
      // 스프라이트를 못 구우면 예전 직접 그리기로.
      ctx.scale(px / 16, px / 16);
      ctx.translate(-8, -8);
      for (const [d, o, fill] of faces) {
        ctx.globalAlpha = op.alpha * shadeBoost(o, fill);
        ctx.fillStyle = fill ?? op.color;
        ctx.fill(pathOf(d));
      }
      ctx.restore();
    }
    };
    /* 크립은 지형을 못 넘는다(요청: 벽·램프·다리) — 크립 판(clipWalk, z가 제일 낮다)만
       먼저 깔고, 차단 마스크를 destination-out으로 파낸 다음 나머지를 얹는다. 캔버스에
       아직 크립뿐이라 다른 그림은 안 다친다. */
    const creepList = showCreep === false ? [] : sorted.filter((o) => o.clipWalk);
    /* 클립은 벽 마스크와 무관하다(재지적: 3D에서 아직도 미니맵을 벗어남) — 전에는
       마스크가 있을 때만 이 갈래로 들어와, 마스크가 아직 안 구워진 판에서는 클립
       자체가 안 걸려 크립이 맵 밖으로 샜다. 이제 크립이 있으면 늘 가둔다. */
    if (creepList.length > 0) {
      /* 크립은 맵 밖으로 못 나간다(지적: 미니맵 밖까지 나옴) — 컨테이너가 overflow:
         hidden이 아니라(모서리 마커를 안 자르려고) 가장자리 해처리의 크립 원이 그림
         밖까지 그려졌다. 크립 판만 맵 영역으로 클립한다 — 평면은 사각형, 입체는
         원근 사다리꼴(clipQuad, 재지적: 3D에서 여전히 벗어남). */
      ctx.save();
      ctx.beginPath();
      if (clipQuad && clipQuad.length >= 3) {
        ctx.moveTo(zx(clipQuad[0][0]), zy(clipQuad[0][1]));
        for (let qi = 1; qi < clipQuad.length; qi += 1) {
          ctx.lineTo(zx(clipQuad[qi][0]), zy(clipQuad[qi][1]));
        }
        ctx.closePath();
      } else {
        ctx.rect(zx(0), zy(0), cw * zoom, ch * zoom);
      }
      ctx.clip();
      paintOps(creepList);
      // 지형 차단은 마스크가 구워졌을 때만 파낸다.
      if (wallMask && maskRects && maskRects.length > 0) {
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        ctx.shadowColor = "transparent";
        for (const [sy0, sh, fx0, fy0, fx1, fy1] of maskRects) {
          ctx.drawImage(
            wallMask, 0, sy0, wallMask.width, sh,
            zx(fx0), zy(fy0), (fx1 - fx0) * cw * zoom, (fy1 - fy0) * ch * zoom,
          );
        }
        ctx.restore();
      }
      ctx.restore();
      paintOps(sorted.filter((o) => !o.clipWalk));
    } else {
      paintOps(sorted);
    }
  });
  return <canvas ref={ref} className="scr-motion-unitlayer" aria-hidden />;
}

export function ShapeIcon({ kind, className, faces: facesOverride, rotDeg, flat, keepRatio, viewYaw, pitchView }: {
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
  /** 입체 보기 판(지적: 모델이 맵하고 안 맞음) — 맵과 같은 45도 각으로 굽는다. */
  pitchView?: boolean;
}) {
  /* 방향은 요잉으로(지적: 화면 회전은 2D 시점에서 모델을 뒤집는다) — 3D 빌더가 있는
     도형은 rotDeg를 화면 회전 대신 모델 요잉 재투영으로 처리한다. 15도 버킷으로 한 번
     굽어 갈무리한다. 위쪽을 봐도 높이는 늘 위를 향한다. */
  const resolved = facesOverride
    ? { faces: facesOverride, rot: SHAPE_ROT[kind] ?? 0 }
    : resolveShapeFaces(kind, rotDeg, flat, viewYaw, pitchView);
  const faces = resolved.faces;
  const rot = resolved.rot;
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
/* 상태 주문 표(재질문: 모든 기술 전수조사) — 좌표 마법이 그 순간 그 자리의 개체에
   남기는 상태: 지속·반경·종류. 빙결류(스태시스·마엘스톰·락다운)는 그 자리에 얼어붙고,
   나머지는 색 오라로 몸에 밴다. */
const STATUS_CASTS: Record<string, { dur: number; r: number; kind: string; any?: boolean }> = {
  Ensnare: { dur: 25, r: 2.5, kind: "ensnare" },
  Plague: { dur: 25, r: 2.5, kind: "plague" },
  "Stasis Field": { dur: 30, r: 2, kind: "stasis", any: true },
  Maelstrom: { dur: 12, r: 2, kind: "mael" },
  Lockdown: { dur: 30, r: 1.2, kind: "lock" },
  Irradiate: { dur: 30, r: 1, kind: "irr" },
};
const FREEZE_STATUS = new Set(["stasis", "mael", "lock"]);
const STATUS_TINT: Record<string, string> = {
  ensnare: "#79c74c", plague: "#b4452e", stasis: "#69b7e8",
  mael: "#a86ae0", lock: "#c8c8d2", irr: "#e8c84a",
};
/** 디텍터(전수조사: 투명화 카운터) — 이들이 곁에 있으면 은신이 벗겨진다. */
const DETECTOR_UNITS = new Set(["Overlord", "Observer", "Science Vessel"]);
const ADDONS = new Set([
  "Comsat Station", "Nuclear Silo", "Machine Shop", "Control Tower", "Covert Ops", "Physics Lab",
  // v2 트랙의 변형 이름(지적: 커맨드 애드온에 통로가 안 붙음) — screp는 ComSat으로 준다.
  "ComSat",
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
/* 자원 고갈(요청: 어느 정도 캐면 고갈, 무한맵 제외) — 미네랄 밭 1500을 두어 기가
   캐면 약 12분, 가스 5000은 세 기가 약 17분이라는 어림. 고갈된 미네랄은 사라지고
   가스는 색이 죽는다(원작: 고갈 가스도 2씩은 나온다). */
const MINERAL_DEPLETE_SEC = 720;
const GAS_DEPLETE_SEC = 1020;

/* 교전 붙기의 자(아래 engagePosOf 주석) — 시야·당김 상한(타일), 근접 유닛, 유닛별
   사정거리(타일, 대략). 싸움과 무관한 유닛(일꾼·수송·캐스터)은 안 끈다 — 시즈 탱크
   (시즈 모드)와 러커는 제자리 화력이라 끌면 오히려 거짓말이 된다. */
const ENGAGE_SIGHT_TILES = 9;
const ENGAGE_SKIP = new Set([
  "Worker", "Transport", "Overlord", "Dropship", "Shuttle", "Observer", "Science Vessel",
  "Defiler", "Queen", "High Templar", "Dark Archon", "Medic", "Arbiter", "Lurker",
  "Siege Tank (Siege Mode)",
]);
/* 근접 유닛(지적: 질럿이 가까이 가지 않고 멀리서 싸움) — 이들은 당김 상한(2.5타일)에
   걸려 6~7타일 밖에 멈춰 서면 안 되고, 표적에 몸이 닿을 때까지 걸어 들어가야 한다.
   파이어뱃은 사거리 1타일이라 근접으로 친다. */
const MELEE_UNITS = new Set([
  "Zealot", "Zergling", "Ultralisk", "Dark Templar", "Broodling", "Infested Terran", "Firebat",
]);

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
      const gap = s1 - s0;
      const dist = Math.hypot(x1 - x0, y1 - y0);
      if (gap > LERP_MAX_GAP_SEC) {
        /* 침묵 구간의 순간이동 방지(지적: 얼었다 다음 점으로 튐) — 대부분은 예전처럼
           앞 점에 머물되, 도착 시각에 맞춰 끝자락(거리/걸음속도)만 걸어서 잇는다. */
        const walkSec = Math.min(gap, Math.max(2, dist / BRIDGE_WALK_SPEED));
        if (dist > 0.01 && t >= s1 - walkSec) {
          const k = (t - (s1 - walkSec)) / walkSec;
          return { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, stale: false, moving: true, sinceLast: 0 };
        }
        return { x: x0, y: y0, stale: t - s0 > LERP_MAX_GAP_SEC, moving: false, sinceLast: t - s0 };
      }
      /* 말이 안 되는 속도의 미끄러짐은 잇지 않는다(지적) — 다만 행군으로 봐줄 수 있는
         빠르기(BRIDGE_MAX_SPEED)까지는 걸어 잇는다(재지적: 순간이동 금지). 그보다
         빨라야 닿는 점만 앞 점에 머문다. GLIDE_MAX_SPEED 주석 참고. */
      if (dist / Math.max(0.001, gap) > GLIDE_MAX_SPEED) {
        if (dist / Math.max(0.001, gap) <= BRIDGE_MAX_SPEED) {
          const k2 = (t - s0) / Math.max(0.001, gap);
          return { x: x0 + (x1 - x0) * k2, y: y0 + (y1 - y0) * k2, stale: false, moving: true, sinceLast: 0 };
        }
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
// (삭제·요청: 확대창 완전 제거) — autoBigHolder(묶음 상세의 첫 판만 확대)도 함께 걷었다.

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

/** 로스터의 줄인 이름(재요청: 한글 3자·영문 5자) — 한글은 1, 그 밖(영문·숫자)은 0.6으로
 *  세어 너비 3까지 남긴다(한글 3자 = 영문 5자). 기둥이 좁아진 확대창·모바일 로스터가
 *  같이 쓴다. */
const shortName = (name: string): string => {
  let w = 0;
  let out = "";
  for (const ch of name) {
    w += /[ᄀ-ᇿ㄰-㆏가-힯]/.test(ch) ? 1 : 0.6;
    if (w > 3.01) break;
    out += ch;
  }
  return out || name;
};

/** 경기별 현재 재생 시각(요청: 특정 시간으로 카톡 공유) — 재생기가 제 clockKey로 지금
 *  t를 계속 적어 두면, 공유 버튼이 링크에 &t=로 실어 보낸다. */
export const playbackClockOf = new Map<string, number>();

export default function ReplayMotionPlayer({
  grid, motion, endSec, bases, teamOfRaw, active = true, winnerTeam, side,
  onDetailClose, loadUnitTracks, initialSec, clockKey, shareNode,
}: {
  grid: ReplayMapGrid;
  motion: SummaryMotion;
  /** 경기 길이(초) — 경기 메타(durationSeconds)에서 온다. 없으면 트랙의 끝으로 잡는다. */
  endSec: number | null;
  /** 본진 로스터(아바타+이름) — 좌표는 옛 요약에서만 왔으므로 이제 없을 수 있다. */
  bases: MotionBase[];
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
  /** 개체 트랙 v2 로더(요청: 태그 단위 분석을 별도 테이블로 저장해 비교) — 있으면 보기
   *  줄에 '부대/개체' 토글이 선다. 개체 모드는 유닛 층만 태그 단위 트랙으로 바꿔 그리고,
   *  건물·자원·크립은 기존 그대로 둔다. null이 오면(옛 경기·분석 실패) 토글이 알린다. */
  loadUnitTracks?: () => Promise<string | null>;
  /** 이 시각(초)부터 재생 시작(요청: 카톡 공유 링크의 &t=) — 경기 길이를 넘으면 무시. */
  initialSec?: number;
  /** 현재 재생 시각을 적어 둘 열쇠(경기번호) — 공유 링크가 &t=로 실어 보낸다. */
  clockKey?: string;
  /** 진행바 아래 공유 버튼(요청: 케밥은 그대로, 별도 버튼) — 시계 옆에 앉는다. */
  shareNode?: React.ReactNode;
  // (삭제·요청) caps — 자막 표시를 걷으면서 함께.
}) {
  const total = useMemo(() => {
    if (endSec && endSec > 0) return endSec;
    let last = 0;
    // (스토리 다이어트) pts가 사라져 건물·마법 시각으로 어림한다 — endSec이 원래 주다.
    for (const b of motion.builds) last = Math.max(last, b[0]);
    for (const c of motion.casts) last = Math.max(last, c[0]);
    return Math.max(60, last);
  }, [motion, endSec]);

  // 공유 링크의 시작 시각(요청) — 경기 길이 안일 때만 그 시점에서 시계를 세운다.
  const [t, setT] = useState(() =>
    initialSec !== undefined && initialSec > 0 && initialSec < total - 1 ? initialSec : 0);
  const [playing, setPlaying] = useState(true);
  /* 현재 재생 시각 기록(요청: 특정 시간으로 카톡 공유) — 공유 버튼이 이 값을 읽어
     링크에 &t=로 싣는다. 사라질 땐 지워 엉뚱한 경기에 안 붙게 한다. */
  useEffect(() => {
    if (clockKey) playbackClockOf.set(clockKey, t);
  }, [t, clockKey]);
  useEffect(() => () => { if (clockKey) playbackClockOf.delete(clockKey); }, [clockKey]);
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
  /* 개체 트랙 v2 토글(요청: 별도 테이블에 담아 기존 부대 추적과 비교) — 켜면 유닛 층만
     태그(유닛 번호) 단위 트랙으로 갈아 끼운다. 데이터는 처음 켤 때 한 번 내려받는다. */
  const [entMode, setEntMode] = useState(false);
  const [entData, setEntData] = useState<UnitTracksV2 | null>(null);
  const [entLoad, setEntLoad] = useState<"idle" | "loading" | "none">("idle");
  /* 클릭 자국 토글(요청) — 기본은 끔: 클릭이 많은 경기에서는 자국이 화면을 덮는다. */
  const [clickFx, setClickFx] = useState(true); // 기본 켬(요청)
  /* 사양 라디오(요청: 최저·저·중·고·최고 — 렌더 요소 단계별 온오프, 기본 중).
     0 최저: 접지 그림자만(재요청: 그림자는 최저부터) / 1 저: +체력바·죽음 효과 /
     2 중: +전투·공사 애니·크립 / 3 고: +겹침 그림자 / 4 최고: +핑(전부 켬). */
  const [quality, setQuality] = useState(2);
  // 체력바 보임/숨김(요청: 라디오화) — 사양 게이트(저 이상)와 곱해진다.
  const [hpShow, setHpShow] = useState(true);
  const qHp = quality >= 1;
  const qDeath = quality >= 1;
  const qShadows = true;
  const qCombat = quality >= 2;
  const qBuildFx = quality >= 2;
  const qCreep = quality >= 2;
  const qOverlap = quality >= 3;
  const qPing = quality >= 4;
  /* (제거·요청) 좌우 동시 보기(비교) — forceEnt·syncKey·syncRole·신호줄까지 걷었다. */
  useEffect(() => {
    /* v2가 기본(요청: v1 완전 제거의 1단계) — 트랙이 있으면 뜨자마자 v2로 연다.
       트랙이 없는 옛 경기(재분석 전)만 v1로 남는다. 소스 걷어내기는 다음 단계다. */
    if (loadUnitTracks && !entData && entLoad === "idle") void toggleEnt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadUnitTracks]);
  /* (v1 제거) 토글이 아니라 로더다 — 트랙을 내려받아 켠다. 끄는 길은 없다. */
  const toggleEnt = async (): Promise<void> => {
    if (entData) { setEntMode(true); return; }
    if (!loadUnitTracks || entLoad === "loading") return;
    setEntLoad("loading");
    try {
      const raw = await loadUnitTracks();
      const parsed = raw ? (JSON.parse(raw) as UnitTracksV2) : null;
      if (parsed && parsed.v === 2 && Array.isArray(parsed.ents)) {
        setEntData(parsed);
        setEntMode(true);
        setEntLoad("idle");
      } else {
        setEntLoad("none");
      }
    } catch {
      setEntLoad("none");
    }
  };
  /* v2 어댑터(요청: 건물까지 모든 정보를 한 테이블에 — 나중에 v1만 싹 걷어내게) — 개체
     트랙의 건물·마법을 v1과 똑같은 튜플로 바꿔, 아래의 건물·크립·채굴·마법 렌더 전부가
     소스만 갈아 끼우면 되게 한다. v2를 켜면 장면 전체(유닛·건물·마법)가 v2 데이터다. */
  const buildsV2 = useMemo<SummaryMotion["builds"]>(() => {
    if (!entData) return [];
    const nameOfId = new Map(entData.players.map((pl) => [pl.id, pl.name]));
    type Row = { born: number; x: number; y: number; k: string; raw: string; gone: number; lift?: number };
    const tagRows: Row[] = [];
    const physRows: (Row & { used?: boolean })[] = [];
    for (const e of entData.ents) {
      if (!e.bld || !e.k) continue;
      const raw = nameOfId.get(e.o) ?? "";
      if (!raw) continue;
      const spots = e.ev.filter((v) => v[3] === 2 || v[3] === 5);
      if (spots.length === 0) continue;
      /* 체력 0 = 즉시 소멸(요청) — 건물도 체력 자취가 0에 닿으면 사망 기록(d)보다
         앞당겨 걷는다. */
      const hpZero = (e.hp ?? []).find(([, hv0]) => hv0 <= 0)?.[0];
      const gone = hpZero !== undefined && (e.d === null || hpZero < e.d) ? hpZero : (e.d ?? 0);
      for (let i = 0; i < spots.length; i += 1) {
        const [sSec, x, y] = spots[i];
        const nextS = i + 1 < spots.length ? spots[i + 1][0] : null;
        const lift = e.ev.find((v) => v[3] === 6 && v[0] >= sSec && (nextS === null || v[0] <= nextS));
        const row: Row = {
          /* 공사 시작은 '자리를 찍은 순간'이다(지적: 첫 홀이 짓는 걸로 나온다) — 예전엔
             건설 앵커(f=2)일 때 개체의 출생(e.b)을 썼는데, 프로토스·테란은 일꾼 태그가
             그대로 건물 생애가 되므로 그 값은 일꾼이 태어난 때(경기 1초)다. 그래서
             90초에 지은 확장 넥서스가 1초부터 공사 중으로 서 있었다. 앵커 시각을 쓴다. */
          born: sSec, x, y, k: e.k, raw,
          gone: nextS !== null ? nextS : gone,
          ...(lift ? { lift: lift[0] } : {}),
        };
        (e.t === -1 ? physRows : tagRows).push(row);
      }
    }
    /* 같은 건물이 두 번 선다(드론→건물 변태 분리의 산물) — 같은 자리엔 물리 줄(건설
       좌표)과 태그 줄(드론 태그가 건물이 된 생애)이 함께 있다. 태그 줄이 정체(변태
       반영: 크립 콜로니→성큰)와 취소를 더 잘 알고, 물리 줄은 발치 공격의 철거를 안다 —
       태그 줄을 남기고 물리 줄의 무너짐만 승계한다. */
    const out: SummaryMotion["builds"] = [];
    for (const r of tagRows) {
      const twin = physRows.find((p2) => !p2.used && p2.raw === r.raw
        && Math.abs(p2.born - r.born) <= 3 && Math.hypot(p2.x - r.x, p2.y - r.y) <= 1.5);
      let gone = r.gone;
      if (twin) {
        twin.used = true;
        if (gone === 0 && twin.gone > 0) gone = twin.gone;
      }
      out.push(r.lift !== undefined
        ? [r.born, r.x, r.y, r.k, r.raw, gone, r.lift]
        : [r.born, r.x, r.y, r.k, r.raw, gone]);
    }
    for (const p2 of physRows) {
      if (p2.used) continue;
      out.push(p2.lift !== undefined
        ? [p2.born, p2.x, p2.y, p2.k, p2.raw, p2.gone, p2.lift]
        : [p2.born, p2.x, p2.y, p2.k, p2.raw, p2.gone]);
    }
    return out;
  }, [entData]);
  const castsV2 = useMemo<SummaryMotion["casts"]>(() => {
    if (!entData) return [];
    const nameOfId = new Map(entData.players.map((pl) => [pl.id, pl.name]));
    return (entData.casts ?? []).map(([s, x, y, tech, pidc]) =>
      [s, x, y, tech, nameOfId.get(pidc) ?? ""] as SummaryMotion["casts"][number]);
  }, [entData]);
  /* 건물 체력 자취(요청: 건물 체력바 — 실드·회복·불·수리 반영은 분석이 했다) —
     자리 열쇠(raw|x|y)로 그 건물의 체력 변곡점을 찾는다. */
  const entBldHp = useMemo(() => {
    const m = new Map<string, { born: number; hp: [number, number][] }[]>();
    if (!entData) return m;
    const nameOfId = new Map(entData.players.map((pl) => [pl.id, pl.name]));
    for (const e of entData.ents) {
      if (!e.bld || !e.hp || e.hp.length === 0) continue;
      const site = [...e.ev].reverse().find((v) => v[3] === 2 || v[3] === 5);
      if (!site) continue;
      const raw = nameOfId.get(e.o) ?? "";
      const key = `${raw}|${Math.round(site[1])}|${Math.round(site[2])}`;
      const arr = m.get(key) ?? [];
      arr.push({ born: e.b, hp: e.hp });
      m.set(key, arr);
    }
    return m;
  }, [entData]);
  /* 건물 태그 → 자리(지적: 질럿이 해처리에 붙지 않고 멀리서 싸움) — 어택 명령이 찍는
     표적은 해처리 같은 일반 건물일 때가 많은데, 표적 지도(entPosByTag)에 유닛과 방어
     건물만 있어 그 건물을 겨누지도, 다가붙지도 못했다. 건물은 안 움직이니 생애와 중심
     자리만 한 번 색인해 두고, 프레임마다 살아 있는 것만 지도에 올린다. */
  const bldTagSpots = useMemo(() => {
    const rows: { tag: number; x: number; y: number; raw: string; born: number; gone: number; k: string }[] = [];
    /* 태그 없는 물리 건물 자리(기획서 2-D) — 시작 홀 등 태그 생애가 없는 건물의
       자리 색인. 태그 미해석 어택의 폴백 표적이 된다. */
    const sites: { x: number; y: number; raw: string; born: number; gone: number; k: string }[] = [];
    if (!entData) return { rows, sites };
    const nameOfId = new Map(entData.players.map((pl) => [pl.id, pl.name]));
    for (const e of entData.ents) {
      if (!e.bld) continue;
      const site = [...e.ev].reverse().find((v) => v[3] === 2 || v[3] === 5);
      if (!site) continue;
      const hpZero = (e.hp ?? []).find(([, hv]) => hv <= 0)?.[0];
      const gone = hpZero !== undefined && (e.d === null || hpZero < e.d) ? hpZero : (e.d ?? 0);
      const row = {
        tag: e.t, x: site[1] + footDx(e.k), y: site[2] + footDy(e.k),
        raw: nameOfId.get(e.o) ?? "", born: e.b, gone, k: e.k,
      };
      if (e.t > 0) rows.push(row);
      else sites.push(row);
    }
    /* 허수아비 방지(기획서 2-D) — 태그 생애가 소멸 시각을 모르면(gone=0) 같은 자리
       물리 행의 철거 시각을 물려받아, 무너진 건물이 45초 표적으로 남지 않게 한다. */
    for (const r of rows) {
      if (r.gone > 0) continue;
      const m = sites.find((s0) => s0.k === r.k && s0.gone > 0
        && Math.abs(s0.x - r.x) <= 3 && Math.abs(s0.y - r.y) <= 3 && s0.gone > r.born);
      if (m) r.gone = m.gone;
    }
    return { rows, sites };
  }, [entData]);
  const entOn = entMode && entData !== null;
  /* 건설 SCV 떠남 시각(지적: SCV들이 건설현장에 남는다) — 일꾼 개체의 건설 앵커(f=2)
     마다 [앵커 자리, 앵커 초, 그 뒤 첫 위치 증거 초]를 색인한다. 합성 건설 SCV는 그
     '첫 위치 증거' 순간(진짜 SCV가 현장을 떠나 걸어 나가는 순간)에 걷힌다. */
  const builderLeave = useMemo(() => {
    const m: { x: number; y: number; s: number; end: number }[] = [];
    if (!entData) return m;
    for (const e of entData.ents) {
      if (e.bld || e.t === -1) continue;
      if (e.k !== "SCV" && e.k !== "") continue;
      for (let i = 0; i < e.ev.length; i += 1) {
        const v = e.ev[i];
        if (v[3] !== 2 || v[1] < 0) continue;
        let end = Infinity;
        for (let j = i + 1; j < e.ev.length; j += 1) {
          if (e.ev[j][1] >= 0 && e.ev[j][0] > v[0] + 1) { end = e.ev[j][0]; break; }
        }
        m.push({ x: v[1], y: v[2], s: v[0], end });
      }
    }
    return m;
  }, [entData]);
  const buildsSrc = entOn ? buildsV2 : motion.builds;
  const castsSrc = entOn ? castsV2 : motion.casts;
  /* 건물 겹침 해소(요청: 캔버스에서 건물끼리 겹침 불가) — 같은 시기에 함께 서 있는 두
     발자국이 포개지면, 늦게 선 쪽을 얕게 겹친 축으로 밀어낸다. 좌표는 커맨드 그대로가
     원칙이라 밀림은 화면에만 적용한다(근접 판정·경로 차단은 원좌표).
     · 부속건물은 본체에 붙는 것이 맞음이라 뺀다.
     · 같은 임자의 같은 자리(1.5타일 안) 짝은 변태·재건 계보라 겹침으로 안 본다 —
       옛 것은 렌더의 계보 규칙이 걷는다. */
  const bldNudge = useMemo(() => {
    const m = new Map<number, [number, number]>();
    const placed: {
      x: number; y: number; w: number; h: number; a: number; b: number;
      raw: string; ox: number; oy: number;
    }[] = [];
    const order = buildsSrc.map((_, i) => i).sort((a, b) => buildsSrc[a][0] - buildsSrc[b][0]);
    for (const i of order) {
      const [bs, x, y, u, raw, bg] = buildsSrc[i];
      if (ADDONS.has(u)) continue;
      const [fw, fh] = FOOTPRINT[u] ?? [3, 2];
      let nx = x;
      let ny = y;
      const a = bs;
      const b = (bg ?? 0) > 0 ? (bg as number) : Infinity;
      for (let iter = 0; iter < 6; iter += 1) {
        const hit = placed.find((q) => !(b <= q.a || a >= q.b)
          && !(q.raw === raw && Math.hypot(q.ox - x, q.oy - y) <= 1.5)
          && nx < q.x + q.w && q.x < nx + fw && ny < q.y + q.h && q.y < ny + fh);
        if (!hit) break;
        const pushR = hit.x + hit.w - nx;
        const pushL = nx + fw - hit.x;
        const pushD = hit.y + hit.h - ny;
        const pushU = ny + fh - hit.y;
        const min = Math.min(pushR, pushL, pushD, pushU);
        if (min === pushR) nx = hit.x + hit.w;
        else if (min === pushL) nx = hit.x - fw;
        else if (min === pushD) ny = hit.y + hit.h;
        else ny = hit.y - fh;
      }
      placed.push({ x: nx, y: ny, w: fw, h: fh, a, b, raw, ox: x, oy: y });
      if (nx !== x || ny !== y) m.set(i, [nx - x, ny - y]);
    }
    return m;
  }, [buildsSrc]);
  /* v2 교전 멈춤(지적: 어택땅 중 만나면 멈추고 싸워야 하는데 그냥 감) — 싸움이 시작된
     자리를 기억해, 적이 곁에 있는 동안 거기 세운다. 적이 사라지면(죽거나 멀어지면)
     기억을 걷고 다시 걷는다. 시간을 되감으면(t가 기억보다 앞) 기억을 버린다. */
  const engageHoldRef = useRef(new Map<string, { x: number; y: number; t0: number; tLast: number; adv: number }>());
  /* 교전으로 멈춘 시간의 합(지적: 어택한 경우 교전이 끝나고 살아 있으면 어택 지점까지
     이동해야 — 다른 명령으로 덮이지 않는 한) — 멈춘 만큼 걸음 시계를 미뤄, 교전이
     끝나면 순간이동 없이 멈춘 자리에서 이어 걷는다. */
  const engageDelayRef = useRef(new Map<string, { delay: number; since: number }>());
  /* 화면 위치 스무딩(지적: 유닛이 뚝뚝 끊기고 조금씩 순간이동처럼 움직임) — 대형 오프셋
     변경·교전 멈춤 해제·채굴 위상 전환 같은 잔점프를 지수 이동평균이 흡수한다. 큰 이동
     (6타일 초과 — 드랍·리콜 등 진짜 순간이동)과 시간 되감기는 그대로 점프한다. */
  const drawPosRef = useRef(new Map<string, { x: number; y: number; at: number }>());
  /* 죽는 순간의 '그려지던' 자리(지적: 피격·죽음 효과가 엉뚱한 데서 난다) — 죽음 연출은
     여태 원자취(명령 좌표)에서 터졌는데, 화면의 몸은 교전 당김·잽·채굴 왕복·겹침
     이완까지 실린 자리에 있다. 그 둘이 몇 타일씩 벌어져 폭발만 딴 데서 났다. */
  const diePosRef = useRef(new Map<string, { x: number; y: number }>());
  /* 초반 무명 개체의 폴백(지적: 일꾼밖에 없는데 저글링이 정찰 감) — 정체를 모르는
     개체는 그 사람의 '첫 전투 유닛이 태어난 시각' 전이면 일꾼으로, 뒤면 종족 보병으로
     그린다. 그 시각 전에는 저글링이 존재할 수 없다(뒤 스토리 제약). */
  const entCombatStart = useMemo(() => {
    const m = new Map<string, number>();
    if (!entData) return m;
    const nameOfId = new Map(entData.players.map((pl) => [pl.id, pl.name]));
    for (const e of entData.ents) {
      if (e.bld || !e.k) continue;
      if (e.k === "SCV" || e.k === "Probe" || e.k === "Drone" || e.k === "Overlord") continue;
      const raw = nameOfId.get(e.o) ?? "";
      const cur = m.get(raw);
      if (cur === undefined || e.b < cur) m.set(raw, e.b);
    }
    return m;
  }, [entData]);
  /* 클릭 자국(요청: 클릭만 해보자 — 동그라미 안에 점, 납작하게) — 개체 증거 스트림의
     이동 명령 목적지(f=0)가 곧 그 사람의 클릭이다. 같은 클릭이 골라진 유닛 수만큼
     중복돼 있으니(12기 선택 우클릭 = 12개체에 같은 점) 사람·초·자리로 합친다.
     별도 저장이 필요 없어 이미 재분석된 경기에서도 바로 나온다. */
  const entClicks = useMemo<[number, number, number, string, number][]>(() => {
    if (!entData) return [];
    const nameOfId = new Map(entData.players.map((pl) => [pl.id, pl.name]));
    const seen = new Set<string>();
    /* 다섯째 값은 클릭의 종류(지적: 클릭·우클릭이 구분이 안 된다) — 0 이동 우클릭,
       7 공격 클릭. 선택(드래그)은 자리가 아니라 잡힌 유닛들 몸에 켜지는 링이 맡는다. */
    const out: [number, number, number, string, number][] = [];
    for (const e of entData.ents) {
      if (e.t < 0) continue;
      const raw = nameOfId.get(e.o) ?? "";
      if (!raw) continue;
      for (const v of e.ev) {
        if (v[3] !== 0 && v[3] !== 7) continue;
        const key = `${e.o}:${v[0]}:${v[1]}:${v[2]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push([v[0], v[1], v[2], raw, v[3]]);
      }
    }
    return out.sort((a, b) => a[0] - b[0]);
  }, [entData]);
  /* 밝은 톤(지적: 음영에 비해 팀색이 어두워 안 보인다)이되 너무 파스텔은 말고(지적) —
     쨍한 하늘·장미색의 중간 지점. */
  const TEAM_EDGE: Record<1 | 2, string> = { 1: "#5ea2ff", 2: "#ff7d95" };
  const modeColor = (raw: string, team: 1 | 2 | undefined): string => {
    const teamColor = team === 2 ? TEAM_EDGE[2] : TEAM_EDGE[1];
    // 요약 폐지 뒤 개인색의 원천은 개체 트랙이다(수리: 색이 팀 2색으로 퇴행).
    if (colorMode === "personal") {
      return colorByRaw.get(raw)
        ?? entData?.players.find((pl) => pl.name === raw)?.color
        ?? teamColor;
    }
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
  /* (삭제) 이름 음영판(shapeStyle) — 건물 이름 창이 걷히며 함께 걷었다. */
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
  /* (삭제·요청: 배지 더 이상 사용 안 함) — 기술 알약 배지 테두리(castStyle)가 있던 자리. */

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
  /* (제거·요청: 지형 편집) — 재생 화면의 검수 모달·산 버튼을 걷었다. 검수 저장분은
     서버의 grid.walk로 이미 들어오므로 화면 임시 덮개는 더 필요 없다. */
  const walkOverride: string | null = null;
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
        ...bases.flatMap((m) => (!m.ghost && m.x !== undefined && m.y !== undefined
          ? [[m.x / grid.width, m.y / grid.height] as [number, number]] : [])),
      ],
    )
      .then((tg) => {
        if (cancelled) return;
        setTerrain(tg ? closeNarrowGaps(tg) : tg);
        setTerrainRaw(tg);
      });
    return () => { cancelled = true; };
  }, [grid.image, grid.walk, walkOverride]);

  /* 맵연결(요청: 게임 상세 버튼 줄에 맵연결 버튼) — 저장된 미니맵 그림(빠른 무한·헌터·
     투혼 …) 중 하나를 골라 이 경기의 맵 해시에 연결한다. 아무나 할 수 있고, 서버가
     마지막 연결자(회원 pk)·시각을 남긴다. 연결되면 캐시를 바로 갈아 끼워(applyReplayMap)
     이 맵을 쓰는 모든 카드가 즉시 그 그림으로 그려진다. */
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkChoices, setLinkChoices] = useState<
    { id: number; name: string; image: string; matches: number }[] | null
  >(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkErr, setLinkErr] = useState("");
  useEffect(() => {
    if (!linkOpen || linkChoices !== null) return;
    api.listMinimapChoices()
      .then(setLinkChoices)
      .catch(() => setLinkErr("맵 목록을 받지 못했어요."));
  }, [linkOpen, linkChoices]);
  const pickLink = async (id: number) => {
    setLinkBusy(true);
    setLinkErr("");
    try {
      const updated = await api.linkReplayMap(grid.hash, id);
      applyReplayMap(updated);
      setLinkOpen(false);
    } catch (e) {
      setLinkErr(e instanceof Error ? e.message : "연결하지 못했어요.");
    } finally {
      setLinkBusy(false);
    }
  };

  /* 크립 차단 마스크(요청: 크립은 벽을 못 뚫고, 램프·다리도 못 넘는다) — 지형 칸 하나가
     픽셀 하나인 캔버스. 못 걷는 칸(벽) + 검수 모달에서 사람이 칠한 크립 불가 칸(램프·
     다리)을 검게 채워, 유닛 층이 크립 판을 깐 직후 이 판으로 파낸다. 검수 원본(terrainRaw)
     기준 — 화면용 틈새 메움(closeNarrowGaps)은 크립과 무관하다. */
  const creepMask = useMemo(() => {
    const tg = terrainRaw;
    if (!tg) return null;
    if (typeof document === "undefined") return null;
    const cv = document.createElement("canvas");
    cv.width = tg.w;
    cv.height = tg.h;
    const mx = cv.getContext("2d");
    if (!mx) return null;
    let any = false;
    mx.fillStyle = "#000";
    for (let y = 0; y < tg.h; y += 1) {
      for (let x = 0; x < tg.w; x += 1) {
        const i = y * tg.w + x;
        if (!tg.walk[i] || tg.creep?.[i]) { mx.fillRect(x, y, 1, 1); any = true; }
      }
    }
    return any ? cv : null;
  }, [terrainRaw]);

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

  /* 자취 펴기 한 벌 — 부대는 지형 경로에 그 유닛의 속도로, 정찰(straight)은 직선에 일꾼
     걸음(3.7타일/초)으로 걷는다(지적: 일꾼·오버로드가 위치 찍으면 바로 이동하는 느낌 —
     정찰 점도 명령 시각에 출발해 걸어서 가야 한다). */
  /* 길찾기 캐시(개체 트랙 v2) — 부대 몇십 개가 아니라 개체 천여 개를 걷게 되면서, 같은
     두 지점(채굴 왕복·본대 행군)의 BFS가 수천 번 반복된다. 정확히 같은 출발·도착이면
     길도 같으므로 좌표 그대로를 열쇠로 재사용한다(양자화 없음 — 기존 결과와 비트 단위로
     같다). 지형이 바뀌면 통째로 비운다. */
  const pathCacheRef = useRef<{ key: string; map: Map<string, [number, number][]> }>({ key: "", map: new Map() });
  /* 건물은 벽이다(요청: 유닛이 건물을 우회해 걷기) — 그 시각에 서 있는 건물 발자국
     칸을 막은 지형판으로 길을 찾는다. 건물이 서고 사라질 때마다 판이 갈리므로 사건
     시각(착공·소멸)으로 판 번호를 매기고, 판마다 한 번만 굽는다(9KB 복사 × 판 수).
     부속건물은 본체에 붙은 작은 덩어리라 안 막는다. 채굴 왕복(결정적 미끄럼)은 이
     길찾기를 안 타므로 자원~기지 사이 일꾼 겹침은 원작대로 남는다(요청). */
  const bldGrid = useMemo(() => {
    /* 지형이 없어도(매핑 안 된 맵) 건물·자원 벽은 선다(지적: 유닛이 전부 관통) —
       전면 보행 가능한 합성 격자를 바닥으로 깔고 그 위에 도장만 찍는다. 절벽은 못
       알지만 건물·미네랄 우회는 산다. */
    const base: TerrainGrid = terrain ?? (() => {
      const w = 96;
      const h = Math.max(8, Math.round((96 * grid.height) / Math.max(1, grid.width)));
      const walk = new Uint8Array(w * h).fill(1);
      return { w, h, walk };
    })();
    const evs = new Set<number>();
    for (const [bs, , , bu, , bg] of buildsSrc) {
      if (ADDONS.has(bu)) continue;
      evs.add(bs);
      if ((bg ?? 0) > 0) evs.add(bg as number);
    }
    const times = [...evs].sort((a, b) => a - b);
    const cache = new Map<number, TerrainGrid>();
    const verOf = (sec: number): number => {
      let lo = 0;
      let hi = times.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= sec) lo = mid + 1; else hi = mid;
      }
      return lo;
    };
    /* 미네랄·가스도 벽이다(요청: 우회하기에 넣기) — 자원은 경기 내내 그 자리라 판마다
       같은 도장을 찍는다. 미네랄은 2×1, 간헐천은 4×2타일 어림(좌표는 가운데). */
    const stampRes = (walk: Uint8Array): void => {
      for (const r of grid.resources ?? []) {
        const gas = r[2] === 1;
        const hw = gas ? 2 : 1;
        const hh = gas ? 1 : 0.5;
        const x0 = Math.max(0, Math.floor(((r[0] - hw) / grid.width) * base.w));
        const x1 = Math.min(base.w - 1, Math.ceil(((r[0] + hw) / grid.width) * base.w) - 1);
        const y0 = Math.max(0, Math.floor(((r[1] - hh) / grid.height) * base.h));
        const y1 = Math.min(base.h - 1, Math.ceil(((r[1] + hh) / grid.height) * base.h) - 1);
        for (let yy = y0; yy <= y1; yy += 1) {
          for (let xx = x0; xx <= x1; xx += 1) walk[yy * base.w + xx] = 0;
        }
      }
    };
    const gridAt = (sec: number): TerrainGrid => {
      const ver = verOf(sec);
      let g = cache.get(ver);
      if (!g) {
        const walk = new Uint8Array(base.walk);
        stampRes(walk);
        for (const [bs, bxT, byT, bu, , bg] of buildsSrc) {
          if (ADDONS.has(bu)) continue;
          if (bs > sec || ((bg ?? 0) > 0 && sec >= (bg ?? 0))) continue;
          const [fw, fh] = FOOTPRINT[bu] ?? [3, 2];
          const x0 = Math.max(0, Math.floor((bxT / grid.width) * base.w));
          const x1 = Math.min(base.w - 1, Math.ceil(((bxT + fw) / grid.width) * base.w) - 1);
          const y0 = Math.max(0, Math.floor((byT / grid.height) * base.h));
          const y1 = Math.min(base.h - 1, Math.ceil(((byT + fh) / grid.height) * base.h) - 1);
          for (let yy = y0; yy <= y1; yy += 1) {
            for (let xx = x0; xx <= x1; xx += 1) walk[yy * base.w + xx] = 0;
          }
        }
        g = { ...base, walk };
        cache.set(ver, g);
      }
      return g;
    };
    return { gridAt, verOf };
  }, [terrain, buildsSrc, grid.resources, grid.width, grid.height]);
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
      if (!straight && !air && (terrain || bldGrid)) {
        /* 조인 격자 먼저, 끊겼으면 원본으로 한 번 더(위 terrainRaw 주석) — 둘 다 끊겼으면
           직선이 아니라 차선(벽을 비싸게 취급하는 다익스트라)이다(지적: 지상 유닛이 벽을 막
           통과해 직진). 격자가 조각났거나 출발·도착이 못 걷는 칸 깊숙이 떨어져 스냅이
           실패하면 BFS는 null인데, 그때마다 직선을 그으면 벽 관통이 화면을 덮는다. */
        const cache = pathCacheRef.current;
        const tkey = `${terrain ? `${terrain.w}:${terrain.h}` : "syn"}:${terrainRaw ? terrainRaw.w : 0}:${buildsSrc.length}`;
        if (cache.key !== tkey) { cache.key = tkey; cache.map.clear(); }
        /* 건물판 번호가 열쇠에 든다(요청: 건물 우회) — 같은 두 지점이라도 그 사이에
           건물이 서면 딴 길이다. */
        const bver = bldGrid ? bldGrid.verOf(orderSec) : 0;
        const ck = `${bver}:${atX},${atY},${tx},${ty}`;
        const hit = cache.map.get(ck);
        if (hit) {
          path = hit;
        } else {
          /* 건물을 막은 판이 먼저다(요청: 건물 우회) — 건물 탓에 길이 끊기면(심시티
             벽 등) 건물 없는 판으로 물러난다: 뚫고 가는 것은 막힌 채 서 있는 것보다
             작은 거짓말이다. */
          const found = (bldGrid ? groundPath(
            bldGrid.gridAt(orderSec),
            atX / grid.width, atY / grid.height,
            tx / grid.width, ty / grid.height,
          ) : null) ?? (terrain ? groundPath(
            terrain,
            atX / grid.width, atY / grid.height,
            tx / grid.width, ty / grid.height,
          ) : null) ?? (terrainRaw ? groundPath(
            terrainRaw,
            atX / grid.width, atY / grid.height,
            tx / grid.width, ty / grid.height,
          ) : null) ?? (terrainRaw ?? terrain ? groundPathSoft(
            terrainRaw ?? (terrain as TerrainGrid),
            atX / grid.width, atY / grid.height,
            tx / grid.width, ty / grid.height,
          ) : null);
          path = found ? found.map(([fx, fy]) => [fx * grid.width, fy * grid.height] as [number, number]) : null;
          // 무한히 자라지 않게만 막는다 — 넘치면 통째로 비워도 다시 채워지는 값이다.
          if (cache.map.size > 30000) cache.map.clear();
          if (path) cache.map.set(ck, path);
        }
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
    return b && b.x !== undefined && b.y !== undefined ? [b.x, b.y] : null;
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
      /* 리콜 자리도 워프 후보(요청: 갑작스런 등장은 드랍·리콜·태어남뿐) — 아비터
         리콜로 옮겨진 부대는 걸어온 자취 없이 그 자리에서 시작하는 게 맞다. */
      ...motion.casts
        .filter((c) => c[4] === p.raw && c[3] === "Recall")
        .map((c) => [c[0], c[1], c[2]] as [number, number, number]),
      ...(p.tpts ?? [])
        .filter(([, x, y]) => !home || Math.hypot(x - home[0], y - home[1]) > 15)
        .map(([s, x, y]) => [s, x, y] as [number, number, number]),
    ];
  };
  const squadPts = useMemo(
    () => basePts.map((pts, pi) => {
      /* 같은 병력 두 갈래 근본 봉합(재지적: 같은 유닛이 두 부대로 두 번 적진으로 감) —
         혼성 부대는 클릭이 무명(pts)과 정체 갈래(upts)를 오간다: 그냥 어택땅은 무명,
         스팀·시즈로 정체가 드러난 클릭은 유닛별 스트림. 같은 병력의 두 그림자가 나란히
         행군하던 원인이다. 무명 점이 정체 갈래 점과 같은 시공간(±20초·8타일)에 있으면
         같은 병력이므로 정체 쪽만 남기고 무명 점을 걷는다 — 멀리 떨어진 진짜 딴 무리는
         그대로 남는다. 일꾼·수송 갈래는 병력이 아니라 잣대에서 뺀다. */
      const ups = Object.entries(motion.players[pi].upts ?? {})
        .filter(([u2]) => u2 !== "Worker" && u2 !== "Transport")
        .flatMap(([, v]) => v);
      const filtered = ups.length === 0 ? pts : pts.filter((pt) =>
        !ups.some((u2) => Math.abs(u2[0] - pt[0]) <= 20
          && Math.hypot(u2[1] - pt[1], u2[2] - pt[2]) <= 8));
      return splitSquads(
        filtered, homeOf(motion.players[pi].raw), SQUAD_MERGE_TILES, warpsOf(motion.players[pi]),
      );
    }),
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
    [motion, terrain, terrainRaw, bldGrid, grid.width, grid.height, bases],
  );
  const refinedSquads = useMemo(
    () => motion.players.map((p, pi) => squadPts[pi].map((sq) =>
      walkTrack(sq, p, false, undefined, undefined, true))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [squadPts, terrain, terrainRaw, bldGrid, grid.width, grid.height, motion],
  );
  /* 개체 걷기(v2·요청: 유닛 위치를 저마다 기억하고 브루드워 엔진처럼 분석) — 태그 하나가
     곧 마커 하나다. 저장된 증거 점(이동 명령의 목적지·남이 찍은 자리·건설 자리·정지)을
     그 유닛의 속도와 지형 길찾기(walkTrack)로 걸린다. 부대 어림(squadPts)과 달리 묶고
     가르는 어림이 없어, 갑자기 나타나고 사라지는 유령이 원리상 안 생긴다 — 비교가 목적
     이라 건물·자원·크립 층은 기존(v1) 그대로 둔다. 생애의 죽음(d)이 오면 마커를 걷는다. */
  const entWalks = useMemo(() => {
    if (!entData) return [];
    const trackByName = new Map(motion.players.map((p) => [p.raw, p]));
    const nameOfId = new Map(entData.players.map((pl) => [pl.id, pl.name]));
    /* 같은 클릭을 받은 개체들의 차례표 — 행렬 시차·도착 대형의 열쇠(아래 주석). */
    const clickRank = new Map<string, number>();
    const out: {
      raw: string; unit: string; b: number; d: number | null; tag: number;
      /** 건설에 흡수되는 시각(지적: 건설 일꾼 잔상) — 현장 도착부터 숨는다. */
      buildHideAt: number | null;
      /** 공사 중 숨김 구간들(재재지적: 도는 SCV와 원래 SCV 이중 표시) — 앵커마다
       *  [앵커 시각, 다음 위치 증거). 그동안은 합성 건설 일꾼이 그 SCV다. */
      buildHides: [number, number][];
      /** 건설 앵커 자리들 — [시각, 발자국 왼쪽 위 x, y]. */
      buildSites: [number, number, number][];
      /** 공격 명령 목록 [초, 표적 태그, 클릭x, 클릭y] — 어택 표적 겨눔 + 태그
       *  미해석 시 자리 폴백(기획서 2-D)의 재료. */
      atkAt: [number, number, number, number][];
      /** 시즈 켬·해제 [초, 켬1/해제0] — 커맨드 그대로(지적). */
      sieges: [number, number][];
      /** 수리·힐 명령 초(지적: 일꾼 수리·매딕 힐) — 곁에서 일하는 효과의 창. */
      fixes: number[];
      /** 체력 변곡점 [초, 퍼센트](요청: 스탯 생애주기) — 체력바의 재료. */
      hp: [number, number][];
      /** 인터셉터 개수 변곡점(요청: 실시간 적용) — 캐리어 둘레를 도는 점들. */
      ic: [number, number][];
      /** 탑승 구간 [탑승 초, 끝 초](요청: 수송선 승하차) — 이 동안 마커를 숨긴다. */
      rides: [number, number][];
      /** 상태 구간 [시작, 끝, 종류](전수조사) — 빙결은 정지, 나머지는 색 오라. */
      statuses: [number, number, string][];
      /** 개인 클로킹 구간(레이스·고스트 f=14/15). */
      cloaks: [number, number][];
      /** 명령(이동·공격·정지) 시각들 — 선택 링(지적: 드래그 선택 구분)의 재료. */
      orders: number[];
      walk: [number, number, number][];
    }[] = [];
    for (const e of entData.ents) {
      // 건물(태그·물리 모두)은 v1 층이 계속 그린다 — 여기는 유닛만.
      /* 건물(태그·물리 -1)은 v1 건물 층이 그린다. 합성 개체(원장 출신, -1000 이하)는
         유닛이다(요청: 한 번도 안 집힌 유닛도 태어나 랠리로 걸어간다). */
      if (e.bld || e.t === -1) continue;
      const raw = nameOfId.get(e.o) ?? "";
      /* v1 트랙이 없어도 유닛은 걷는다(지적: 리플레이에 유닛이 안 나옴) — 요약이
         사라지며 motion이 빈 껍데기(EMPTY_MOTION)로 오는데, 여기서 v1 트랙을 필수로
         요구하니 개체 전부가 걸러져 유닛이 0개였다. 트랙은 걷기 속도의 속업(ups)
         참고용일 뿐이라, 없으면 빈 스텁으로 걷는다(기본 속도). */
      const p = trackByName.get(raw)
        ?? { raw, pts: [], units: [], workers: [], size: [], prod: {} };
      // 위치 없는 증거(생산·랠리, x=-1)는 걷기 재료가 아니다.
      /* 행렬 물리(지적: 이동을 찍으면 한 번에 출발하는 게 아니라 한 줄이 되면서 간다) +
         새 겹침 방지(지적: 다시 넣되 세련되게) — 같은 클릭(같은 사람·초·자리)을 받은
         개체들에 차례를 매겨, (a) 출발을 0.22초씩 늦춰 자연스럽게 한 줄 행렬이 되고,
         (b) 도착 자리는 클릭 지점 둘레 해바라기 나선으로 벌려 서로 안 포개진다 —
         프레임마다 밀치는 이완 대신 목적지 대형으로 푸는 방식이라 떨림이 없다. */
      const pts: TrackPt[] = [];
      // 일꾼은 대형 없이 그대로(지적: 일꾼끼리는 자원 캐는 동안 겹침이 원작 동작).
      const isWk = e.k === "SCV" || e.k === "Probe" || e.k === "Drone";
      for (const v of e.ev) {
        if (v[1] < 0 || v[3] === 4) continue;
        if (!isWk && (v[3] === 0 || v[3] === 7)) {
          const key = `${e.o}:${v[0]}:${v[1]}:${v[2]}`;
          const idx = clickRank.get(key) ?? 0;
          clickRank.set(key, idx + 1);
          const rr = 0.55 * Math.sqrt(idx);
          const aa = idx * 2.4;
          pts.push([
            v[0] + Math.min(2.4, idx * 0.22),
            v[1] + Math.cos(aa) * rr,
            v[2] + Math.sin(aa) * rr,
          ]);
        } else {
          pts.push([v[0], v[1], v[2]]);
        }
      }
      // 시차가 순서를 뒤집었으면(다음 명령이 바로 붙은 경우) 시간순으로 되돌린다.
      pts.sort((a, b) => a[0] - b[0]);
      /* 갑툭튀 방지(지적: 맵 중간에 갑자기 나타남) — 첫 위치 증거는 대개 '목적지'라,
         출생보다 한참 늦고 본진에서 멀면 그 자리에서 태어난 것처럼 보였다. 출생 시각의
         가장 가까운 제 홀에서 걸어(날아) 나오게 출발점을 심는다. */
      if (pts.length > 0 && pts[0][0] > e.b + 1) {
        let hx = -1;
        let hy = -1;
        let hd = Infinity;
        for (const [bs4, bx4, by4, bu4, br4, bg4] of buildsSrc) {
          if (br4 !== raw || bs4 > e.b || ((bg4 ?? 0) > 0 && e.b >= (bg4 ?? 0))) continue;
          if (!["Command Center", "Nexus", "Hatchery", "Lair", "Hive"].includes(bu4)) continue;
          const d6 = Math.hypot(bx4 - pts[0][1], by4 - pts[0][2]);
          if (d6 < hd) { hd = d6; hx = bx4 + footDx(bu4); hy = by4 + footDy(bu4); }
        }
        if (hx >= 0 && hd > 8) pts.unshift([e.b, hx, hy]);
      }
      if (pts.length === 0) continue;
      const wk = walkTrack(pts, p, false, e.k || undefined, undefined, e.k === "");
      /* 상태(전수조사) — 시전 순간 그 자리에 있었으면 걸린다. 적이 건 것만(스태시스는
         아군 오폭도 언다). */
      const statuses: [number, number, string][] = [];
      for (const [cs5, cx9, cy9, tech5, craw5] of castsV2) {
        const cfg = STATUS_CASTS[tech5];
        if (!cfg) continue;
        if (!cfg.any && craw5 === raw) continue;
        const pp5 = posAt(wk, cs5, null);
        if (!pp5 || Math.hypot(cx9 - pp5.x, cy9 - pp5.y) > cfg.r) continue;
        statuses.push([cs5, cs5 + cfg.dur, cfg.kind]);
      }
      /* 개인 클로킹(f=14 켬 / 15 끔) 구간. */
      const cloaks: [number, number][] = [];
      {
        let on = -1;
        for (const v of e.ev) {
          if (v[3] === 14 && on < 0) on = v[0];
          else if (v[3] === 15 && on >= 0) { cloaks.push([on, v[0]]); on = -1; }
        }
        if (on >= 0) cloaks.push([on, Infinity]);
      }
      /* 건설에 흡수(지적: 테란 일꾼이 건설을 시작하면 복제처럼 둘이 됐다가, 끝나면
         원래 일꾼이 복제된 자리에 영영 서 있음) — 명령받은 진짜 일꾼 개체는 건설
         앵커(f=2)가 마지막 증거라 생존 원칙으로 현장에 박제됐고, 공사 중 모습은 합성
         건설 일꾼 연출이 따로 그려 둘로 보였다. 마지막 위치 증거가 건설 앵커면 현장
         도착(걷기 마지막 점)부터 공사에 흡수시켜 숨긴다 — 그 뒤 제 증거가 생기는
         일꾼은 애초에 이 조건에 안 걸려 그대로 걸어 나온다. */
      let buildHideAt: number | null = null;
      /* 공사 중 숨김 구간들(재재지적: 건설 중에 도는 SCV와 원래 SCV가 둘 다 나옴) —
         마지막 증거가 앵커일 때만 숨기던 규칙은, 공사가 '끝난 뒤' 딴 명령을 받는 일꾼을
         공사 '중'에는 안 숨겼다. 앵커(f=2)마다 [앵커 시각, 다음 위치 증거)를 숨김
         구간으로 잡는다 — 그동안은 합성 건설 일꾼이 그 SCV다. */
      const buildHides: [number, number][] = [];
      if (isWk) {
        let lastPosF = -1;
        for (let i = e.ev.length - 1; i >= 0; i -= 1) {
          if (e.ev[i][1] >= 0) { lastPosF = e.ev[i][3]; break; }
        }
        if (lastPosF === 2 && wk.length > 0) buildHideAt = wk[wk.length - 1][0];
        for (let i = 0; i < e.ev.length; i += 1) {
          const v2 = e.ev[i];
          if (v2[3] !== 2) continue;
          let end = Infinity;
          for (let j = i + 1; j < e.ev.length; j += 1) {
            if (e.ev[j][1] >= 0 && e.ev[j][0] > v2[0] + 1) { end = e.ev[j][0]; break; }
          }
          buildHides.push([v2[0], end]);
        }
      }
      out.push({
        raw, unit: e.k, b: e.b, d: e.d, tag: e.t, buildHideAt, buildHides,
        /* 건설 앵커 자리(요청: 드론 변태도 고치 중앙에) — 흡수되기 직전 이 자리로
           걸어 들어가야 고치가 솟는 자리와 겹친다. */
        buildSites: e.ev.filter((v) => v[3] === 2 && v[1] >= 0)
          .map((v) => [v[0], v[1], v[2]] as [number, number, number]),
        atkAt: e.ev.filter((v) => v[3] === 7).map((v) => [v[0], v[4] ?? 0, v[1], v[2]] as [number, number, number, number]),
        sieges: e.ev.filter((v) => v[3] === 8 || v[3] === 9)
          .map((v) => [v[0], v[3] === 8 ? 1 : 0] as [number, number]),
        fixes: e.ev.filter((v) => v[3] === 10).map((v) => v[0]),
        hp: e.hp ?? [],
        ic: e.ic ?? [],
        orders: e.ev.filter((v) => v[3] === 0 || v[3] === 7 || v[3] === 3).map((v) => v[0]),
        rides: (() => {
          const spans: [number, number][] = [];
          for (let i = 0; i < e.ev.length; i += 1) {
            if (e.ev[i][3] !== 12) continue;
            let end = Infinity;
            for (let j = i + 1; j < e.ev.length; j += 1) {
              if (e.ev[j][0] > e.ev[i][0] + 0.5) { end = e.ev[j][0]; break; }
            }
            spans.push([e.ev[i][0], end]);
          }
          return spans;
        })(),
        // 정체를 알면 그 속도로, 모르면 부대 어림과 같은 규칙(그때의 우세 유닛·지상 길)로.
        walk: wk,
        statuses,
        cloaks,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entData, terrain, terrainRaw, bldGrid, grid.width, grid.height, motion]);
  /* 유령 부대 흡수(지적: 1시에 쳐들어간 테란 병력이 아무것도 안 하고 계속 서 있음 —
     같은 부대를 다시 드래그하면 선택 묶음(g)이 갈려 새 부대가 되고, 옛 마커가 마지막
     명령 자리에 영영 남았다. 실측: 한 공격 방면에 묶음 여덟이 줄줄이). 부대 A의 마지막
     명령 곁(8타일)에서 150초 안에 딴 부대 B가 첫 명령을 받으면 — 그 자리 유닛들을
     다시 집은 것이다 — A는 그 순간 B에 흡수된 것으로 보고 걷는다. */
  /* ── 교전 붙기(지적: 적이 가까이 있는데 전투를 안 한다 — 시야에 들면 맞붙는 게
     자연스럽다. 근접 유닛은 이동해 붙어서 싸우고, 원거리는 사정거리까지만 이동) —
     그리기 직전의 표시 조정이다. 원본 자취(명령 좌표)는 그대로 두고, 이 프레임의 가장
     가까운 적 유닛 마커를 향해 '남은 거리의 반'만 끌어당긴다. 반씩인 이유: 상대도 같은
     조정으로 다가오므로 양쪽이 반씩 오면 꼭 목표 거리(근접 0.8타일, 원거리 사정거리)
     에서 만나고, 서로 원좌표 기준이라 지나쳐 겹치지 않는다. 시야(9타일) 밖은 안 끈다. */
  const engageFoes: { team: number; x: number; y: number; air: boolean; bld?: boolean; k?: string }[] = [];
  /** 아비터 은신장(전수조사) — 같은 사람 유닛이 곁(4.5타일)에 있으면 흐려진다. */
  const arbiterSpots: { raw: string; x: number; y: number }[] = [];
  /** 디텍터 명단 — 적 디텍터가 곁(9타일)이면 은신이 벗겨진다. */
  const detectorSpots: { team: number; x: number; y: number }[] = [];
  /* v2 개체의 지금 위치(태그별) — 어택이 찍은 '그 대상'을 겨누는 지도(지적). */
  const entPosByTag = new Map<number, { x: number; y: number; team: number; air: boolean; bld?: boolean; k?: string }>();
  if (entOn) {
    /* v2 모드(지적: 유닛-건물 상호작용·어택땅 교전) — 교전 상대 목록을 v1 부대 어림이
       아니라 v2 개체 위치로 채운다. 적의 방어 건물(성큰·캐논·터렛·벙커)도 상대다:
       행군하던 유닛이 그 곁에서 멈춰 싸우고, 터렛·벙커 발사도 이 목록으로 겨눈다. */
    for (const e of entWalks) {
      if (e.walk.length === 0 || t < e.walk[0][0]) continue;
      if (e.d !== null && t >= e.d) continue;
      /* 유령 상대 제거(지적: 주변에 공격할 게 없는데 공격 모션) — 화면 규칙으로 이미
         죽었거나(체력 0 조기 사망) 숨은(수송 탑승·건설 흡수) 개체가 목록에 남아, 곁
         유닛이 빈 땅에 대고 계속 쐈다. 표시와 같은 잣대로 거른다. */
      const hpZero0 = e.hp.find(([, hv0]) => hv0 <= 0)?.[0];
      const dieAt0 = hpZero0 !== undefined && (e.d === null || hpZero0 < e.d) ? hpZero0 : e.d;
      if (dieAt0 !== null && t >= dieAt0) continue;
      if (e.rides.some(([ra0, rb0]) => t >= ra0 + 1 && t < rb0)) continue;
      if (e.buildHides.some(([ba0, bb0]) => t >= ba0 && t < bb0)) continue;
      const q = posAt(e.walk, t, null);
      if (!q) continue;
      const row = {
        team: teamOfRaw(e.raw) ?? 0, x: q.x, y: q.y,
        air: e.unit !== "" && isAirUnit(e.unit),
      };
      engageFoes.push(row);
      if (e.tag > 0) entPosByTag.set(e.tag, row);
      // 아비터 은신장·디텍터(전수조사) — 이번 프레임 위치를 명단에 올린다.
      if (e.unit === "Arbiter") arbiterSpots.push({ raw: e.raw, x: q.x, y: q.y });
      if (DETECTOR_UNITS.has(e.unit)) detectorSpots.push({ team: row.team, x: q.x, y: q.y });
    }
    for (const [bs, bx2, by2, bu, br, bg] of buildsSrc) {
      if (!["Sunken Colony", "Spore Colony", "Photon Cannon", "Missile Turret", "Bunker"].includes(bu)) continue;
      if (bs + (BUILD_SEC[bu] ?? 30) > t) continue;
      if ((bg ?? 0) > 0 && t >= (bg ?? 0)) continue;
      // 방어 건물도 bld·종류를 실어 발자국 기준 정지·창 규칙을 태운다(기획서 1-D).
      engageFoes.push({
        team: teamOfRaw(br) ?? 0,
        x: bx2 + footDx(bu), y: by2 + footDy(bu), air: false, bld: true, k: bu,
      });
      // 방어 디텍터(전수조사) — 터렛·스포어·캐논은 은신을 벗긴다.
      if (bu === "Missile Turret" || bu === "Spore Colony" || bu === "Photon Cannon") {
        detectorSpots.push({ team: teamOfRaw(br) ?? 0, x: bx2 + footDx(bu), y: by2 + footDy(bu) });
      }
    }
    /* 일반 건물도 표적 지도에(지적: 질럿이 해처리에 안 붙음) — engageFoes(교전 유발)엔
       안 넣는다: 건물이 보인다고 싸움이 시작되면 안 되고, 어택이 그 태그를 찍었을 때만
       겨눔·접근의 표적이 된다. 유닛 태그와 겹치면 유닛이 우선(위에서 이미 set). */
    for (const bt of bldTagSpots.rows) {
      if (t < bt.born + 2 || (bt.gone > 0 && t >= bt.gone)) continue;
      if (entPosByTag.has(bt.tag)) continue;
      entPosByTag.set(bt.tag, { x: bt.x, y: bt.y, team: teamOfRaw(bt.raw) ?? 0, air: false, bld: true, k: bt.k });
    }
    // 스캐너 스윕(전수조사) — 12초 동안 그 자리가 디텍터다.
    for (const [cs6, cx10, cy10, tech6, craw6] of castsSrc) {
      if (tech6 !== "Scanner Sweep" || t < cs6 || t - cs6 > 12) continue;
      detectorSpots.push({ team: teamOfRaw(craw6) ?? 0, x: cx10, y: cy10 });
    }
  } else {
    motion.players.forEach((p2, pi2) => {
      const team2 = teamOfRaw(p2.raw) ?? 0;
      for (const sq of refinedSquads[pi2] ?? []) {
        if (sq.length === 0 || t < sq[0][0]) continue;
        const q = posAt(sq, t, null);
        if (q) engageFoes.push({ team: team2, x: q.x, y: q.y, air: false });
      }
      for (const g2 of typeSquads[pi2] ?? []) {
        if (ENGAGE_SKIP.has(g2.unit)) continue;
        if (g2.walk.length === 0 || t < g2.walk[0][0]) continue;
        const q = posAt(g2.walk, t, null);
        // 공중 무리인가(재지적: 레이스·골리앗은 공중 상대면 미사일) — 식구 전부가 공중일 때.
        if (q) engageFoes.push({
          team: team2, x: q.x, y: q.y,
          air: (BY_UNITS[g2.unit] ?? [g2.unit]).every((u3) => isAirUnit(u3)),
        });
      }
    });
  }
  const nearestFoe = (team: number | undefined, x: number, y: number) => {
    let bx = 0;
    let by = 0;
    let bd = Infinity;
    let bAir = false;
    let bBld: boolean | undefined;
    let bK: string | undefined;
    for (const f of engageFoes) {
      /* 팀 미상(0)은 상대가 아니다(지적: 자기 유닛을 왜 공격해) — 로스터와 리플레이
         이름이 안 맞아 팀을 못 찾은 마커를 적으로 치면 제 편끼리 쏘는 그림이 된다. */
      if (!team || f.team === 0 || f.team === team) continue;
      const d = Math.hypot(f.x - x, f.y - y);
      if (d < bd) { bd = d; bx = f.x; by = f.y; bAir = f.air; bBld = f.bld; bK = f.k; }
    }
    return { bx, by, bd, air: bAir, bld: bBld, k: bK };
  };
  /* 정찰 자취도 걸어서 가고(지적: 갑자기 이동 — 직선이되 일꾼 걸음), 갈래·부대로 갈라
     각자의 점이 된다(지적: 드랍십 순간이동 — 일꾼 정찰과 셔틀 원정이 한 점을 놓고
     밀당했다). 갈래는 이름을 정한다(지적: 오버로드 이름이 안 나온다). */
  /* 정찰(수송선·오버로드) 사슬(지적: 가다 멈췄다 순간이동, 특히 초반 — 실측 데이터로
     확인: 클릭 간 거리가 부대 반경(28타일)을 넘으면 한 마리가 유령 마커 여럿으로 쪼개
     졌다) — 거리 반경 대신 '그 시간에 그 걸음으로 닿을 수 있나'로 잇는다. 닿을 수 있으면
     같은 마리, 없으면(동시에 딴 곳을 찍는 두 마리) 딴 마리다. */
  const chainScout = (
    pts: TrackPt[], speedAt: (sec: number) => number, home: [number, number] | null,
  ): TrackPt[][] => {
    const tracks: TrackPt[][] = [];
    for (const pt of pts) {
      let best = -1;
      let bestSlack = Infinity;
      for (let ti = 0; ti < tracks.length; ti += 1) {
        const last = tracks[ti][tracks[ti].length - 1];
        const need = Math.hypot(pt[1] - last[1], pt[2] - last[2]);
        // 여유 14타일 — 명령 좌표는 '목표'라 실제 위치보다 과대(실측: 되돌림 스팸 클릭).
        /* 속도는 그 시각의 것(지적: 오버로드가 자꾸 순간이동) — 속업(×4) 뒤에도 기본
           0.6으로 재면 실제로 갈 수 있던 거리가 "못 간다"가 되어 여정이 갈라지고, 갈라진
           새 자취가 목적지에서 태어나며 순간이동으로 보였다. */
        const avail = Math.max(0, pt[0] - last[0]) * speedAt(pt[0]) * 1.5 + 14;
        if (need <= avail && avail - need < bestSlack) { best = ti; bestSlack = avail - need; }
      }
      if (best >= 0) tracks[best].push(pt);
      /* 새 자취는 전부 집에서 걸어 나온다(지적: 순간이동의 둘째 갈래) — 첫 자취만 집
         시딩을 받아, 둘째 오버로드부터는 마커가 목적지에서 뿅 나타났다. 새 오버로드·
         수송선은 어차피 본진(해처리)에서 나온다. */
      else if (home) tracks.push([[pt[0], home[0], home[1]], pt]);
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
    /* 그 시각의 실제 속도(지적: 오버로드 순간이동) — 속업 연구 뒤에는 오버로드 ×4,
       셔틀 ×1.5(드랍십은 속업이 없다)로 잰다. speedOf가 같은 표를 이미 안다. */
    const carrierSpeedAt = (sec: number): number =>
      speedOf(race === "저그" ? "Overlord" : race === "테란" ? "Dropship" : "Shuttle", sec, p.ups);
    return kinds.flatMap(({ kind, src }) => (src.length === 0 ? [] : (kind === "worker"
      ? splitSquads(src, home0)
      : chainScout(
        src,
        kind === "carrier" || race === "저그" ? carrierSpeedAt : () => SCOUT_WALK_SPEED,
        ovieHome,
      ))
      .map((sq) => ({
        kind, raw: sq,
        walk: walkTrack(
          sq, p, kind !== "worker",
          kind === "worker" ? workerUnit : kind === "carrier" ? carrierUnit : loneUnit,
        ),
      }))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [motion, terrain, terrainRaw, bldGrid, grid.width, grid.height, bases]);
  // 기본은 ×3이다(요청: ×8 → ×4였다가 눈금이 1·2·3·5·10·20으로 바뀌며 가장 가까운 값).
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(2);
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
  /* PC 상세 넓은 배치(요청: 확대창 제거, 관련 소스까지) — 겹창·포털·가리개는 걷고,
     옛 확대창의 배치(맵 왼쪽 최대 + 오른쪽 기둥에 로스터·조작부·댓글, 케밥·닫기)는
     상세 화면 안 인라인 기본이 됐다(요청: 댓글부를 미니맵 우측으로 — 기존 확대창 방식).
     상세(onDetailClose가 온 자리) + PC 폭에서만 선다. 모바일 확대 버튼도 함께 걷었다 —
     상세가 이미 전체 화면이다. */
  /* 넓은 배치 판정(재지적: 댓글부가 우측으로 안 감 — 원인 찾음) — 여태 "상세(onDetailClose)
     + 창 폭"으로 묶어 뒀는데, 사용자가 보던 화면은 상세가 아니라 '활동 카드'였다. 카드
     자리에서는 창이 아무리 넓어도 게이트가 안 열렸다. 이제 이 플레이어가 앉은 '자리의
     실제 폭'(부모 상자, ≥860px)만 본다 — 상세든 카드든 자리가 넓으면 옛 확대창 배치
     (맵 왼쪽 + 오른쪽 댓글 기둥)를 쓴다. 좁은 자리는 그대로 세로 배치다. 닫기(X·Esc)는
     여전히 상세에서만이다. */
  const rootRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const host = rootRef.current?.parentElement;
    if (!host || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setWide(host.clientWidth >= 860));
    ro.observe(host);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!wide || !onDetailClose) return undefined;
    // Esc = 닫기 버튼과 같은 길 — 상세를 닫는다.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDetailClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wide, onDetailClose]);

  /* 재생이 손잡이를 민다 — 비제어라 React가 안 밀어 주므로 여기서 직접 쓴다. 잡고 있는
     동안은 안 민다(그 순간의 임자는 손이다). */
  useEffect(() => {
    if (scrubbing.current) return;
    const el = rangeRef.current;
    if (!el) return;
    el.value = String(t);
    el.style.setProperty("--p", `${total > 0 ? (t / total) * 100 : 0}%`);
  }, [t, total]);

  /* (삭제·요청: 확대창 완전 제거) — 확대창 자동 열기(autoBigHolder)·closeBig·축소
     기억 전부. 넓은 배치는 위의 wide가 인라인으로 잇는다. */

  /* PC 휠 줌(요청) — 맵 위에서 휠로 확대/축소, 커서 자리를 붙든 채 늘어난다. 팬은 줌
     계산에 함께 실려 경계 밖이 안 보이게 죈다. */
  const [zoom, setZoom] = useState(1);
  /* 피칭 보기(요청) — 수직 부감 대신 약간 비스듬한 정면. 바닥(지형 그림과 마커 자리)만
     세로로 눌리고, 건물·유닛 도형은 제 크기로 서 있어 3D로 바닥에 붙는다. 눌림은
     컨테이너 세로비가 맡아서 %자리가 저절로 따라온다. 휠 확대·드래그 이동은 기존
     렌즈(zoom·pan) 그대로다. */
  const [pitched, setPitched] = useState(false);
  // 유닛 크기 토글(요청) — 기본은 실제 크기, 누르면 2배.
  const [unitX2, setUnitX2] = useState(false);
  // (삭제·요청: 모바일에도 입체 보기 개방) — 터치 기기 판별이 있던 자리.
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return undefined;
    /* 업데이터 밖에서 한 번에 계산한다(지적: 줌아웃을 맵 외곽에서 하면 강제로 안쪽
       어딘가로 이동) — 예전엔 setZoom 업데이터 '안'에서 setPan을 불렀는데, 업데이터는
       순수해야 해서 리액트가 재실행하면 커서 고정 보정이 두 번 적용됐다. 한계 죔과
       겹치면 외곽에서 팬이 엉뚱한 안쪽 값으로 튀었다. 지금 값(ref)으로 새 줌·팬을
       같이 셈해 각각 한 번씩만 놓는다. */
    /* 프레임당 한 번만 상태를 놓는다(지적: 줌·드래그 버벅임) — 휠은 초당 수십 번
       튀는데 틱마다 setState면 그때마다 전체 마커 렌더가 돌았다. 목표값을 모아 rAF
       한 번에 반영한다(연타는 pend 기준으로 이어 계산해 커서 고정이 안 깨진다). */
    let wheelPend: { z: number; x: number; y: number } | null = null;
    let wheelRaf = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const ox = e.clientX - (rect.left + rect.width / 2);
      const oy = e.clientY - (rect.top + rect.height / 2);
      const z = wheelPend ? wheelPend.z : zoomRef.current;
      // 상한 10 → 20(재요청: 2배 더 — 세부 렌더링 확인용) — 휠 줌이 더 깊이 들어간다.
      const nz = Math.min(20, Math.max(1, z * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      if (nz === z) return;
      let nx = 0;
      let ny = 0;
      if (nz > 1) {
        const p = wheelPend ? { x: wheelPend.x, y: wheelPend.y } : panRef.current;
        const k = nz / z;
        nx = ox + (p.x - ox) * k;
        ny = oy + (p.y - oy) * k;
        const maxX = ((nz - 1) * rect.width) / 2;
        const maxY = ((nz - 1) * rect.height) / 2;
        nx = Math.min(maxX, Math.max(-maxX, nx));
        ny = Math.min(maxY, Math.max(-maxY, ny));
      }
      wheelPend = { z: nz, x: nx, y: ny };
      if (!wheelRaf) {
        wheelRaf = requestAnimationFrame(() => {
          wheelRaf = 0;
          if (!wheelPend) return;
          setZoom(wheelPend.z);
          setPan({ x: wheelPend.x, y: wheelPend.y });
          wheelPend = null;
        });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // 확대창(포털 재부착)이 사라져 맵 엘리먼트는 안 바뀐다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* 팬 재죔(지적: 줌인아웃하다 맵을 벗어나면 문제) — 팬 한계는 '그때의 맵 상자'로
     계산되는데, 줌 단계·보기 전환(3D 피칭은 세로가 0.74로 눌린다)으로 상자가 변하면
     이미 서 있던 팬이 새 한계를 넘어 맵 가장자리 밖(빈 바탕)이 드러나고 마커가 맵을
     벗어나 그려졌다. 상자가 변할 때마다 팬을 새 한계 안으로 되죈다. */
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    if (zoom <= 1) return;
    const rect = el.getBoundingClientRect();
    const maxX = ((zoom - 1) * rect.width) / 2;
    const maxY = ((zoom - 1) * rect.height) / 2;
    setPan((p) => {
      const nx = Math.min(maxX, Math.max(-maxX, p.x));
      const ny = Math.min(maxY, Math.max(-maxY, p.y));
      return nx === p.x && ny === p.y ? p : { x: nx, y: ny };
    });
  }, [zoom, pitched, wide]);

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
    let pinchPend: { z: number; p: { x: number; y: number } } | null = null;
    let pinchRaf = 0;
    /* 더블탭 확대·축소(요청: 모바일에서 더블클릭류) — 한 손가락 탭 두 번(320ms·36px
       안)이면 탭 지점 중심으로 4배 확대, 이미 확대 중이면 원래대로. 끌었으면(10px
       초과) 탭이 아니다. */
    let tap: { t: number; x: number; y: number } | null = null;
    let tapStart: { x: number; y: number; moved: boolean } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTS = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        tapStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, moved: false };
      }
      if (e.touches.length !== 2) return;
      tapStart = null;
      e.preventDefault();
      pinch = {
        d: dist(e.touches), z: zoomRef.current,
        cx: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        cy: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        px: panRef.current.x, py: panRef.current.y,
      };
    };
    const onTM = (e: TouchEvent) => {
      gestureRef.current = e.touches.length >= 2;
      // 10px 넘게 끌리면 탭이 아니다(더블탭 판정용).
      if (tapStart && e.touches.length === 1
        && Math.hypot(e.touches[0].clientX - tapStart.x, e.touches[0].clientY - tapStart.y) > 10) {
        tapStart.moved = true;
      }
      /* 삼키는 건 지도 조작일 때만(재재지적: 모바일에서 아래로 스와이프가 안 됨) —
         무조건 preventDefault가 확대 안 한 한 손가락 스와이프(페이지 스크롤)까지
         막았다. 두 손가락(핀치)이거나 확대 중(드래그 팬)일 때만 기본 동작을 끊고,
         평상시 한 손가락은 페이지 스크롤로 흘려보낸다. */
      if (e.touches.length >= 2 || zoomRef.current > 1) {
        if (e.cancelable) e.preventDefault();
      }
      if (!pinch || e.touches.length !== 2) return;
      const r = el.getBoundingClientRect();
      const ox = r.left + r.width / 2;
      const oy = r.top + r.height / 2;
      // 상한 12 → 20(재요청: 더 높게) — 그 위는 선명도가 배킹 한계(4096px)에 막혀 무의미하다.
      const z = Math.min(20, Math.max(1, (pinch.z * dist(e.touches)) / pinch.d));
      const mx2 = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const my2 = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      // 핀치 시작점 아래의 지도 지점이 손가락을 따라오도록 pan을 푼다.
      const ux = (pinch.cx - ox - pinch.px) / pinch.z;
      const uy = (pinch.cy - oy - pinch.py) / pinch.z;
      /* 프레임당 한 번만 커밋(지적: 확대축소가 튐) — touchmove는 프레임보다 잦게 와서
         매번 setState하면 무거운 리렌더가 겹겹이 밀려 손을 못 따라왔다. 마지막 값만
         rAF에 실어 한 프레임에 한 번 반영한다. */
      /* 미세 떨림 사구간(지적: 떨림) — 손가락은 가만히 있어도 ±1px씩 떨린다. 배율
         0.4%·이동 0.7px 미만의 변화는 버려 지도가 어른거리지 않게 한다. */
      const np = z <= 1 ? { x: 0, y: 0 } : { x: mx2 - ox - z * ux, y: my2 - oy - z * uy };
      if (pinchPend || Math.abs(z - zoomRef.current) / zoomRef.current > 0.004
        || Math.hypot(np.x - panRef.current.x, np.y - panRef.current.y) > 0.7) {
        pinchPend = { z, p: np };
      }
      if (!pinchPend) return;
      if (!pinchRaf) {
        pinchRaf = requestAnimationFrame(() => {
          pinchRaf = 0;
          if (pinchPend) { setZoom(pinchPend.z); setPan(pinchPend.p); pinchPend = null; }
        });
      }
    };
    const onTE = (e: TouchEvent) => {
      if (e.touches.length < 2) { pinch = null; gestureRef.current = false; }
      // 더블탭 판정 — 손가락이 다 떨어진 순간, 안 끌린 탭만 센다.
      if (e.touches.length === 0 && tapStart && !tapStart.moved && e.changedTouches.length === 1) {
        const ct = e.changedTouches[0];
        const now = performance.now();
        if (tap && now - tap.t < 320 && Math.hypot(ct.clientX - tap.x, ct.clientY - tap.y) < 36) {
          // 두 번째 탭 — 브라우저 더블탭 페이지 확대를 끊고 지도만 확대·복귀한다.
          if (e.cancelable) e.preventDefault();
          if (zoomRef.current > 1.05) {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          } else {
            const r2 = el.getBoundingClientRect();
            const ox2 = r2.left + r2.width / 2;
            const oy2 = r2.top + r2.height / 2;
            const z2 = 4;
            // 핀치와 같은 수식 — 탭한 지점 아래의 지도 지점이 그 자리에 남는다.
            const ux2 = (ct.clientX - ox2 - panRef.current.x) / zoomRef.current;
            const uy2 = (ct.clientY - oy2 - panRef.current.y) / zoomRef.current;
            setZoom(z2);
            setPan({ x: ct.clientX - ox2 - z2 * ux2, y: ct.clientY - oy2 - z2 * uy2 });
          }
          tap = null;
        } else {
          tap = { t: now, x: ct.clientX, y: ct.clientY };
        }
      }
      if (e.touches.length === 0) tapStart = null;
    };
    el.addEventListener("touchstart", onTS, { passive: false });
    el.addEventListener("touchmove", onTM, { passive: false });
    el.addEventListener("touchend", onTE);
    el.addEventListener("touchcancel", onTE);
    return () => {
      if (pinchRaf) cancelAnimationFrame(pinchRaf);
      el.removeEventListener("touchstart", onTS);
      el.removeEventListener("touchmove", onTM);
      el.removeEventListener("touchend", onTE);
      el.removeEventListener("touchcancel", onTE);
    };
    // 확대창(포털 재부착)이 사라져 맵 엘리먼트는 안 바뀐다 — 마운트에 한 번이면 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  /** 자리의 0~1 분수 — posStyle(%)과 캔버스 유닛 층이 같은 값을 쓴다. */
  const posFrac = (x: number, y: number): [number, number] => {
    if (!pitched) return [x / grid.width, y / grid.height];
    const { w, h, S, C, q, cy } = pitchGeom();
    const u = (x / grid.width - 0.5) * w;
    const v = (y / grid.height - 0.5) * h;
    const k = (q * PITCH_P) / (PITCH_P - v * S);
    return [0.5 + (u * k) / w, 0.5 + (v * C * k - cy) / h];
  };
  const posStyle = (x: number, y: number): { left: string; top: string } => {
    const [fx, fy] = posFrac(x, y);
    return { left: `${(fx * 100).toFixed(3)}%`, top: `${(fy * 100).toFixed(3)}%` };
  };
  /* 크립 차단 마스크의 화면 자리(요청) — 평면은 맵 전체에 한 장이면 되고, 입체는
     원근 배율이 줄마다 달라 지형 한 줄씩 잘라 그 줄의 자리·폭으로 근사해 얹는다. */
  const creepMaskRects: [number, number, number, number, number, number][] = [];
  if (creepMask) {
    if (!pitched) {
      creepMaskRects.push([0, creepMask.height, 0, 0, 1, 1]);
    } else {
      const th = creepMask.height;
      for (let gy = 0; gy < th; gy += 1) {
        const yT0 = (gy / th) * grid.height;
        const yT1 = ((gy + 1) / th) * grid.height;
        const yMid = (yT0 + yT1) / 2;
        const [fx0] = posFrac(0, yMid);
        const [fx1] = posFrac(grid.width, yMid);
        const [, fy0] = posFrac(0, yT0);
        const [, fy1] = posFrac(0, yT1);
        creepMaskRects.push([gy, 1, fx0, fy0, fx1, fy1]);
      }
    }
  }
  /* 좌우 시점(지적: 시점이 정면 고정, 좌우가 없다) — 카메라(화면 가운데, 거리 P)에서
     비껴 보이는 마커는 그 각도만큼 모델 요잉을 틀어 굽는다. 왼쪽 마커는 오른옆이,
     오른쪽 마커는 왼옆이 보인다. */
  const viewYawOf = (x: number, y: number): number => {
    if (!pitched) return 0;
    const { w } = pitchGeom();
    const u = (x / grid.width - 0.5) * w;
    void y; // 자리 호환 — 기울기는 u/P라 세로 좌표가 안 든다.
    /* 요잉이 아니라 시각 밀림의 각(지적: 소실점이 시각을 반영해야 — 돌리면 찌그러짐).
       ShapeIcon이 tan을 취하면 u/P — 지도 남북 선의 소실 기울기 그 값이다(지적:
       노란선-빨간선 정합). 부호는 실화면 확인으로 이쪽이 정답 — 다시 뒤집지 말 것. */
    return (Math.atan2(u, PITCH_P) * 180) / Math.PI;
  };
  /* 유닛 방향(지적: 멈추면 정면으로 돌아가 어색) — 조금 전이 아니라 '마지막으로 움직인'
     방향을 문다: 가까운 창부터 점점 멀리(최대 15초) 되짚어 처음 잡히는 변위의 방향이다.
     첫 창을 0.3초로 좁혔다(지적: 가끔 옆을 보고 걷는 듯) — 0.8초 창은 모퉁이를 돈 직후
     두 구간에 걸친 평균 방향(대각선)을 물어, 꺾고 나서도 한동안 비껴 보였다. */
  /* 마커별 직전 방향 기억(지적: 회전 부드럽게) — headingOf의 각 스무딩 상태. 마커가
     사라지면 항목이 남지만 몇백 개 수준이라 판 하나 안에서는 무해하다. */
  const hdgMemRef = useRef(new Map<string, { h: number; t: number }>());
  const headingOf = (walk: TrackPt[], pos: { x: number; y: number }, smoothKey?: string): number => {
    let target = 0;
    for (const back of [0.3, 0.8, 2, 4, 8, 15]) {
      const hp = posAt(walk, Math.max(0, t - back), null);
      if (!hp) break;
      const dx = pos.x - hp.x;
      const dy = pos.y - hp.y;
      if (Math.hypot(dx, dy) > 0.08) { target = (Math.atan2(-dx, dy) * 180) / Math.PI; break; }
    }
    if (!smoothKey) return target;
    /* 회전을 부드럽게(지적: 움직임·회전 좀 부드럽게) — 경유점을 꺾는 순간 방향이 즉시
       홱 돌던 것을, 마커별로 지난 프레임의 각을 기억해 초당 300도 상한으로 따라잡게
       한다. 시킹(시간이 뒤로 가거나 크게 점프)이나 첫 등장은 그대로 스냅. */
    const mem = hdgMemRef.current.get(smoothKey);
    hdgMemRef.current.set(smoothKey, { h: target, t });
    if (!mem || t <= mem.t || t - mem.t > 1.5) return target;
    let diff = ((target - mem.h) % 360 + 540) % 360 - 180;
    const maxTurn = 300 * (t - mem.t);
    if (Math.abs(diff) > maxTurn) diff = Math.sign(diff) * maxTurn;
    const h = mem.h + diff;
    hdgMemRef.current.set(smoothKey, { h, t });
    return h;
  };
  /* 화면 걸음 기준 방향(지적: 뒤로 걷는 유닛 + 몸과 트레이서 방향 불일치) — 걸음 시계
     지연(교전 뒤)·가스 왕복·교전 당김이 '표시 위치'를 자취와 다르게 옮긴 뒤라, 원 자취
     로 잰 방향은 실제 화면 이동과 어긋나 뒤로 걷는 것처럼 보였다. 직전 프레임의 표시
     위치 변화로 방향을 재면 정의상 몸이 늘 진행 방향을 본다. */
  const dispHdgRef = useRef(new Map<string, { x: number; y: number; h: number; t: number }>());
  /* 원작에는 옆걸음·뒷걸음이 없다(요청: 어떤 경우에도 유닛이 뒤나 옆으로 밀리거나
     걷지 않는다 — 무조건 이동 방향을 보고 간다) — 그래서 '움직이면 이동 방향'이 늘
     이긴다. 표적을 보는 것은 제자리에 선 순간뿐이다(stillFace). */
  const headingOfDisplay = (
    key: string, x: number, y: number, fallback: number, stillFace?: number | null,
  ): number => {
    const mem = dispHdgRef.current.get(key);
    if (!mem || t <= mem.t || t - mem.t > 1.5) {
      const h0 = stillFace ?? mem?.h ?? fallback;
      dispHdgRef.current.set(key, { x, y, h: h0, t });
      return h0;
    }
    const dx = x - mem.x;
    const dy = y - mem.y;
    /* 문턱 인하(지적: 방향 전환이 재렌더링 안 될 때가 있음) — 위치 스무딩(EMA)이 프레임당
       변위를 눌러 0.04 문턱을 못 넘기면 방향이 옛값에 얼어붙었다. 스무딩이 떨림을 이미
       걸러 주므로 문턱은 훨씬 낮아도 된다. */
    if (Math.hypot(dx, dy) < 0.008) {
      // 멈춰 있을 때만 표적 쪽으로 몸을 돌린다.
      const hs = stillFace ?? mem.h;
      dispHdgRef.current.set(key, { x, y, h: hs, t });
      return hs;
    }
    const target = (Math.atan2(-dx, dy) * 180) / Math.PI;
    let diff = ((target - mem.h) % 360 + 540) % 360 - 180;
    /* 회전 상한을 크게(요청: 옆으로 걷는 순간이 없어야) — 420도/초는 급회전 때 몇
       프레임 동안 몸과 걸음이 어긋났다. 1200도/초면 한 프레임 안에 따라붙는다. */
    const maxTurn = 1200 * (t - mem.t);
    if (Math.abs(diff) > maxTurn) {
      // 큰 반전은 즉시 돈다 — 문턱도 120 → 60도로 내려 되돌아설 때 등지고 걷지 않는다.
      if (Math.abs(diff) > 60) {
        dispHdgRef.current.set(key, { x, y, h: target, t });
        return target;
      }
      diff = Math.sign(diff) * maxTurn;
    }
    const h = mem.h + diff;
    dispHdgRef.current.set(key, { x, y, h, t });
    return h;
  };
  /* 캔버스 유닛 층의 재료(요청: 캔버스 전환 — 성능) — 이번 렌더에서 그릴 낱개 유닛
     도형들. 아래 마커 계산부가 push하고, 렌즈 안의 <UnitLayer>가 커밋 뒤 한 번에 그린다.
     계산(자리·회피·방향·깊이·순서)은 전부 그대로라 그림은 SVG 시절과 같다. */
  const unitOps: UnitDrawOp[] = [];
  /* (제거) 어택 명령 표적 집합으로 피격을 그리던 자 — 명령이 찍힌 곳과 실제로 맞는
     곳이 다르고 8초 내내 켜져, 싸움과 무관한 자리에서 불티가 텄다(지적). 이제 각
     개체의 체력 자취가 내려간 순간을 피격으로 삼는다(hurtAt). */
  // 글자 크기 CSS(모바일/PC 미디어)와 같은 값 — 캔버스는 CSS를 못 읽으니 여기서 정한다.
  // 이제 크기는 캔버스가 정한다 — 이 값은 그리기 주기(아래 DRAW_GAP_MS)에만 쓰인다.
  const pcView = typeof window !== "undefined" && !!window.matchMedia?.("(min-width: 1160px)").matches;
  const x2Mul = unitX2 ? 2 : 1;
  /* ── 유닛 크기의 자(전수조사·요청: "실제 캔버스 × 소·중·대로 균일하게") ─────────
     예전엔 등급마다 고정 픽셀(모바일 6·8·11 / PC 8·11·15)이었다. 화면 폭이나 맵
     격자와 무관한 값이라, 같은 마린이 맵마다 제멋대로 커 보였다: 64×64 맵의 한 타일은
     128×128의 두 배라 같은 6px이 절반 크기로 읽힌다. 건물은 진작부터 발자국(타일)
     비례였으니 유닛만 홀로 다른 자를 쓰고 있었던 셈이다.
     이제 둘이 한 자를 쓴다 — 한 타일의 화면 픽셀 × 등급비(소·중·대). 줌은 그리기
     단계에서 곱해지므로 어느 배율에서도 타일 대비 크기는 그대로다. */
  const tilePx = Math.max(1.2, (mapRef.current?.clientWidth ?? 320) / Math.max(1, grid.width));
  /* 등급별 크기(타일) — 소·중·대. 원작 스프라이트(마린 0.6·탱크 1.25·배틀 2.8타일)
     보다는 크게 잡는다: 128×128 맵에서 한 타일은 3px 안팎이라 실물 비례로 그리면
     보병이 점 하나가 된다. 대신 등급 간 비율(1 : 1.3 : 1.75)은 원작에 맞추고, 본진
     발자국(4타일)보다는 확실히 작게 둔다 — 고정 픽셀 시절 대형은 4.3타일이라 커맨드
     센터보다 넓었고(전수조사), 수송선은 1.7배가 더 붙어 5~7타일까지 갔다. */
  const UNIT_TILES = [1.9, 2.5, 3.3] as const;
  /** 낱개 유닛 도형 크기(px) — 타일 × 등급비(소·중·대) × 2배 토글 × 깊이. */
  const unitGlyphPx = (bulk: 0 | 1 | 2, depthY: number): number =>
    tilePx * UNIT_TILES[bulk] * x2Mul * pitchK(depthY);
  /** 유닛 이름 → 낱개 도형 크기 — 수송선도 이제 제 등급(대형)일 뿐, 따로 부풀리지
   *  않는다(전수조사: dot 눈금 1.7배가 오버로드를 본진보다 크게 그렸다). */
  const unitPxOf = (u: string, depthY: number): number =>
    unitGlyphPx(u === "?" ? 0 : (UNIT_BULK[u] ?? 1), depthY);
  const dragRef = useRef<{ id: number; sx: number; sy: number; px: number; py: number } | null>(null);
  const onMapPointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1 || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
  };
  const dragRafRef = useRef(0);
  const dragPendRef = useRef<{ x: number; y: number } | null>(null);
  const onMapPointerMove = (e: React.PointerEvent) => {
    /* 핀치 중엔 드래그 팬 봉인(지적: 확대축소 때 전혀 다른 곳이 깜빡) — 두 손가락이
       닿아 있는 동안엔 각 손가락의 pointermove가 저마다 팬으로 처리돼, 핀치가 계산한
       pan과 엉뚱한 pan이 번갈아 이기며 화면이 다른 자리로 튀었다. */
    if (gestureRef.current) { dragRef.current = null; return; }
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const el = mapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxX = ((zoom - 1) * rect.width) / 2;
    const maxY = ((zoom - 1) * rect.height) / 2;
    /* 프레임당 한 번(지적: 드래그 버벅임) — pointermove는 120Hz까지 튄다. */
    dragPendRef.current = {
      x: Math.min(maxX, Math.max(-maxX, d.px + (e.clientX - d.sx))),
      y: Math.min(maxY, Math.max(-maxY, d.py + (e.clientY - d.sy))),
    };
    if (!dragRafRef.current) {
      dragRafRef.current = requestAnimationFrame(() => {
        dragRafRef.current = 0;
        if (dragPendRef.current) setPan(dragPendRef.current);
        dragPendRef.current = null;
      });
    }
  };
  const onMapPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current?.id === e.pointerId) dragRef.current = null;
  };

  /* 키보드(요청: PC) — ↑↓ 배속, ←→ 5초 뒤/앞. 댓글 입력 중에는 건드리지 않는다. */
  useEffect(() => {
    if (!wide) return undefined;
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
  }, [wide, total]);

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
    if (wide) return undefined;
    const el = mapRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => !e.isIntersecting)) setPlaying(false);
    }, { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, [wide]);

  /* (삭제) 화면을 벗어날 때의 정지는 이제 스크롤 밖(IntersectionObserver)뿐이다 —
     창 전환(blur) 정지를 걷은 뒤에도 탭 숨김(visibilitychange) 정지가 남아 창을 덮으면
     여전히 멈췄다(지적: "블러시 재생 멈춤 왜 아직도 있지"). 숨은 탭은 브라우저가 rAF를
     세워 어차피 시간이 안 가고, 돌아온 첫 틱은 dt 상한(0.5초)이 점프를 막으므로 명시적
     정지 없이도 이어 보기가 안전하다. */

  /* 시계 — rAF로 게임 시간 t를 배속만큼 민다. state로 두는 이유는 매 프레임 그리는 것들
     (자취·건물·마법)이 전부 t의 함수라서다. */
  /* 그리기 30Hz(재지적: 1배속도 뚝뚝 — 10Hz의 0.1초 걸음이 눈에 밟혔다). 10Hz는
     마커 span 750개 시절의 처방인데, 유닛이 캔버스(unitOps 일괄 그리기)로 옮겨 간
     뒤로는 리렌더가 한참 가벼워져 33ms 예산 안에 든다. 시간은 매 틱 어김없이
     쌓으므로(accRef) 재생 속도는 어느 주기든 같다. */
  const clockRef = useRef<{ raf: number; last: number; acc: number; drawn: number } | null>(null);
  /* 핀치 중 재생 그리기 정지(지적: 확대축소 시 미니맵이 떨리고 튐) — 폰에서 20Hz
     리렌더 하나가 수십 ms라, 핀치 커밋이 그 뒤에 줄 서며 제스처가 밀렸다. 두 손가락이
     닿아 있는 동안은 시간도 표시도 멈추고 손짓에만 프레임을 쓴다. */
  const gestureRef = useRef(false);
  useEffect(() => {
    if (!playing || !active) return undefined;
    // 모바일은 20Hz(재지적: 모바일과 PC는 주기가 달라야) — 폰 CPU에서 30Hz 리렌더는
    // 오히려 밀려서 더 뚝뚝해진다. PC는 30Hz.
    const DRAW_GAP_MS = pcView ? 16 : 50;
    const tick = (now: number) => {
      const c = clockRef.current;
      /* 한 틱 상한 — 브라우저가 rAF를 멈췄다 되살리면(백그라운드 탭) dt가 자리 비운
         시간 전체가 돼, 돌아온 순간 그만큼을 한 번에 건너뛴다. 위의 정지가 대부분 막지만
         blur가 안 오는 경우(다른 모니터로 시선만 이동)를 위한 이중 잠금이다. */
      const dt = c ? Math.min((now - c.last) / 1000, 0.5) : 0;
      const acc = gestureRef.current ? 0 : (c?.acc ?? 0) + dt;
      const drawnAt = c?.drawn ?? 0;
      const draw = acc > 0 && now - drawnAt >= DRAW_GAP_MS;
      clockRef.current = {
        raf: requestAnimationFrame(tick), last: now,
        acc: draw ? 0 : acc, drawn: draw ? now : drawnAt,
      };
      if (draw) {
        setT((prev) => {
          const next = prev + acc * speed;
          if (next >= total) {
            setPlaying(false);
            setDone(true);
            return total;
          }
          return next;
        });
      }
    };
    clockRef.current = { raf: requestAnimationFrame(tick), last: performance.now(), acc: 0, drawn: 0 };
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
    buildsSrc.forEach((b, i) => {
      const key = `${b[4]}|${b[3]}`;
      const arr = m.get(key);
      if (arr) arr.push(i);
      else m.set(key, [i]);
    });
    for (const arr of m.values()) arr.sort((a, b) => buildsSrc[a][0] - buildsSrc[b][0]);
    return m;
  }, [buildsSrc]);


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


  /* 본진 건물(확장 포함)의 자리 — 채굴 일꾼이 오갈 목적지다(지적: 자원 지대가 기준이고,
     거기서 가장 가까운 본진 건물로 왔다 갔다). 커맨드·넥서스·해처리 계열이 대상이다. */
  // 좌표는 발자국 가운데로 옮긴다(FOOTPRINT 주석) — 일꾼이 건물 왼쪽 위 모서리가 아니라
  // 건물 한가운데로 오가야 한다.
  const halls = useMemo(() => buildsSrc
    .filter(([, , , unit]) => ["Command Center", "Nexus", "Hatchery", "Lair", "Hive"].includes(unit))
    .map(([sec, x, y, unit, raw, gone]) => ({
      sec, x: x + footDx(unit), y: y + footDy(unit), raw, gone: gone ?? 0,
    })), [buildsSrc]);
  /** 가스 건물들 — 가스 지대에 일꾼을 보낼 자격이다(지적: 가스도 안 지었는데 왔다 갔다). */
  const gasBuildings = useMemo(() => buildsSrc
    .filter(([, , , unit]) => ["Refinery", "Assimilator", "Extractor"].includes(unit))
    .map(([sec, x, y, unit, raw, gone]) => ({
      sec, x: x + footDx(unit), y: y + footDy(unit), raw, gone: gone ?? 0,
    })), [buildsSrc]);
  /* 가스 깃발이 정확한 판인가(지적: 미네랄과 가스를 헷갈림) — 간헐천 낱개화 이후의
     격자는 깃발(res[2])이 정확해서, '가스 건물 곁 6타일' 폴백을 쓰면 정제소 곁 미네랄
     밭까지 간헐천으로 그려 버린다. 폴백은 깃발이 하나도 없는 옛 격자에서만 쓴다. */
  const gridHasGasFlags = (grid.resources ?? []).some((r) => r[2] === 1);
  /* 정제소가 감추는 건 '제' 간헐천 하나(지적: 가스 건물을 지으면 곁 간헐천까지
     사라짐 — mineral10처럼 간헐천이 3.5타일 안에 몰린 맵에서 반경 4타일 뭉뚱그림이
     이웃까지 지웠다) — 건물마다 가장 가까운 간헐천 자리를 집어 그 자리만 감춘다. */
  const gasHideOf = useMemo(() => {
    const rs = (grid.resources ?? []).filter((r) => !gridHasGasFlags || r[2] === 1);
    return gasBuildings.map((g) => {
      let gx = -1;
      let gy = -1;
      let gd = Infinity;
      for (const r of rs) {
        const d = Math.hypot(g.x - r[0], g.y - r[1]);
        if (d < gd) { gd = d; gx = r[0]; gy = r[1]; }
      }
      return { ...g, gx, gy, gd };
    });
  }, [gasBuildings, grid, gridHasGasFlags]);
  /* 무한맵 검출(요청: 무한맵은 고갈 제외) — 겹쳐 쌓인 자원(1타일 안 두 항목)이 있으면
     돈맵이다. 일반 맵은 밭이 겹치지 않는다. */
  const moneyMap = useMemo(() => {
    const rs = grid.resources ?? [];
    for (let i = 0; i < rs.length; i += 1) {
      for (let j = i + 1; j < rs.length; j += 1) {
        const d = Math.hypot(rs[i][0] - rs[j][0], rs[i][1] - rs[j][1]);
        if (d < 0.9) return true;
        /* 간헐천끼리 3.5타일 안(재발견: mineral10 맵) — 간헐천 발자국이 4×2라 정상
           맵에선 이보다 가까울 수 없다. 미네랄 스택은 파서 병합(반경 1.2)이 한 항목으로
           접어 위 0.9 검사에 안 걸리는데, 그런 맵은 가스도 겹쳐 줄지어 있다. */
        if (rs[i][2] === 1 && rs[j][2] === 1 && d < 3.5) return true;
      }
    }
    return false;
  }, [grid]);
  /* 자원별 고갈 시각(위 MINERAL_DEPLETE_SEC 주석) — 미네랄은 '가까운 차례'가 처음
     일꾼으로 채워진 시각 + 12분, 가스는 그 자리 가스 건물의 첫 완공 + 17분. 임자·차례는
     채굴 표시와 같은 어림(가장 가까운 본진·홀)이되, 시각 의존을 피해 홀은 선 시각과
     무관하게 본다 — 고갈은 분 단위 어림이라 그 오차는 티가 안 난다. */
  const depleteAt = useMemo(() => {
    const rs = grid.resources ?? [];
    const out = new Map<number, number>();
    if (moneyMap) return out;
    const gasIdx = new Set<number>();
    rs.forEach((r, ri) => {
      if (r[2] === 1 || (!gridHasGasFlags
        && gasBuildings.some((g) => Math.hypot(g.x - r[0], g.y - r[1]) <= 6))) gasIdx.add(ri);
    });
    const ownerOf = rs.map((r) => {
      let best = 10;
      let raw: string | null = null;
      for (const m of bases) {
        if (m.x === undefined || m.y === undefined) continue;
        const d = Math.hypot(r[0] - m.x, r[1] - m.y);
        if (d < best) { best = d; raw = m.key; }
      }
      for (const h of halls) {
        const d = Math.hypot(r[0] - h.x, r[1] - h.y);
        if (d < best) { best = d; raw = h.raw; }
      }
      return { raw, dist: best };
    });
    const byOwner = new Map<string, number[]>();
    rs.forEach((_r, ri) => {
      const o = ownerOf[ri];
      if (o.raw && !gasIdx.has(ri)) {
        const a = byOwner.get(o.raw) ?? [];
        a.push(ri);
        byOwner.set(o.raw, a);
      }
    });
    for (const [raw, arr] of byOwner) {
      arr.sort((a, b) => ownerOf[a].dist - ownerOf[b].dist);
      const wk = motion.players.find((p) => p.raw === raw)?.workers ?? [];
      arr.forEach((ri, rank) => {
        let start = rank < 4 ? 0 : Infinity;
        for (const [sec, n] of wk) {
          if (4 + n > rank) { start = Math.min(start, sec); break; }
        }
        if (Number.isFinite(start)) out.set(ri, start + MINERAL_DEPLETE_SEC);
      });
    }
    rs.forEach((r, ri) => {
      if (!gasIdx.has(ri)) return;
      let first = Infinity;
      for (const g of gasBuildings) {
        if (Math.hypot(g.x - r[0], g.y - r[1]) <= 4) first = Math.min(first, g.sec + 30);
      }
      if (Number.isFinite(first)) out.set(ri, first + GAS_DEPLETE_SEC);
    });
    return out;
  }, [grid, moneyMap, gridHasGasFlags, gasBuildings, bases, halls, motion]);
  /* 스파이더 마인(요청) — 심은 자리(캐스트 좌표)에 마인 모델을 깔고, 심고 4초 뒤부터
     적 자취가 2타일 안에 들어온 첫 순간 터진 것으로 본다(리플레이에 폭발이 안 남는
     어림 — 갑자기 죽는 이유가 보이게). 디텍팅 제거는 알 수 없어 안 터진 마인은 남는다. */
  const mines = useMemo(() => castsSrc
    .filter((c) => c[3] === "Spider Mines")
    .map(([sec, x, y, , raw]) => {
      let boom = 0;
      // (스토리 다이어트) 적 접근은 v2 개체 자취로 잰다 — v1 pts는 더 안 실린다.
      for (const q of entWalks) {
        if (teamOfRaw(q.raw) === teamOfRaw(raw)) continue;
        for (const [ps, px, py] of q.walk) {
          if (ps <= sec + 4 || Math.hypot(px - x, py - y) > 2) continue;
          if (boom === 0 || ps < boom) boom = ps;
          break;
        }
      }
      return { sec, x, y, raw, boom };
    }), [castsSrc, entWalks, teamOfRaw]);
  const castsNow = castsSrc.filter((c) => c[0] <= t
    && t - c[0] <= (c[3] === "Nuclear Strike" ? NUKE_FALL_SEC + 4
      : c[3] === "Dark Swarm" ? 30
        : c[3] === "Disruption Web" ? 25
          : c[3] === "Stasis Field" ? 20 : CAST_HOLD_SEC));
  /* 핵 착탄들 + 성공 판정(지적: 실패가 더 많다) — 발사가 다 착탄이 아니다(고스트가
     끊기면 불발). 착탄 시각 언저리(−2초~+90초)에 반경 안 건물이 실제로 무너진 발사만
     '터진 핵'으로 본다. 불발은 표적 점만 보이다 만다. 유닛 몰살도 터진 핵만이다. */
  const nukeImpacts = useMemo(() => castsSrc
    .filter((c) => c[3] === "Nuclear Strike")
    .map((c) => {
      const sec = c[0] + NUKE_FALL_SEC;
      const confirmed = buildsSrc.some(([bs, bx2, by2, bu, , g2]) => {
        const gone = g2 ?? 0;
        return gone > 0 && gone >= sec - 2 && gone - sec <= 90 && bs <= sec
          && Math.hypot(bx2 + footDx(bu) - c[1], by2 + footDy(bu) - c[2]) <= 5;
      });
      return { sec, x: c[1], y: c[2], confirmed };
    }), [castsSrc, buildsSrc]);

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
  /* 수송선이 실제로 있고 나서다(지적: 수송선도 없는 시점·자리에 드랍 효과가 계속) —
     드랍·태움 신호는 번호 정체 어림에서 나와 오염될 수 있다. 테란·토스는 첫 수송선
     완성 전, 저그는 수송 업그레이드(Ventral Sacs) 연구 전의 신호는 전부 거짓이다. */
  const transportReadyAt = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of motion.players) {
      const race = bases.find((b) => b.key === p.raw)?.race;
      if (race === "저그") {
        const v = (p.ups ?? []).find(([, n]) => n === "Ventral Sacs");
        m.set(p.raw, v ? v[0] : Infinity);
        continue;
      }
      const unit = race === "테란" ? "Dropship" : "Shuttle";
      const secs = p.prod?.[unit];
      m.set(p.raw, secs && secs.length > 0 ? secs[0] + (UNIT_SEC[unit] ?? 20) : Infinity);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motion, bases]);
  /* 그리고 그 순간 수송선 자취가 곁에 있어야 한다(지적: 수송선 없는 데서 계속 나옴) —
     신호 자리에서 12타일 안에 수송선이 없으면 그 드랍·태움은 어림이 헛짚은 것이다. */
  const carrierNearAt = (raw: string, sec: number, x: number, y: number): boolean => {
    for (const w of carrierWalks.get(raw) ?? []) {
      if (w.length === 0 || sec < w[0][0] - 5) continue;
      const tp = posAt(w, sec, null);
      if (tp && Math.hypot(tp.x - x, tp.y - y) <= 12) return true;
    }
    return false;
  };


  /* 본진이 무너졌나(지적: 본진 기지 건물은 절대 안 망했다 — 시작 홀을 builds에 합성하며
     판정이 생겼다) — 집 자리(3타일)의 내 홀 계보에서 마지막 채가 무너졌고 재건이 없으면
     함락이다. 아바타 로스터의 유령화와 채굴 일꾼 걷기가 같이 쓴다. */
  const fallenHome = (m: MotionBase): boolean => {
    const { x: mx, y: my } = m;
    if (mx === undefined || my === undefined) return false;
    const chain = buildsSrc
      .filter(([bs, x2, y2, bu, br]) => br === m.key && bs <= t
        && ["Command Center", "Nexus", "Hatchery", "Lair", "Hive"].includes(bu)
        && Math.hypot(x2 + footDx(bu) - mx, y2 + footDy(bu) - my) <= 3)
      .sort((a, b) => a[0] - b[0]);
    const last = chain[chain.length - 1];
    return !!last && (last[5] ?? 0) > 0 && t >= (last[5] ?? 0);
  };

  /* 무너진 기지의 유닛도 대개 같이 죽는다(지적: 확률은 높은데 완벽하진 않음 — 그래서
     침묵 조건을 같이 건다) — 내 건물이 무너진 자리 곁(8타일)에 서 있었고, 무너진 뒤로
     새 명령 없이 한참(DEAD_QUIET_SEC) 지난 마커는 그 함락에서 정리된 것으로 본다. */



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
              {/* 줄인 이름 하나로(재요청: 한글 3·영문 5 제한) — 전체 이름은 카드·댓글에서. */}
              <span className="scr-motion-teamcol-name" style={chipStyle(m.key, m.team)}>
                {shortName(m.name)}
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

  /* (삭제·요청: 안 쓰는 범례 정리) — 건물·유닛·일꾼이 전부 제 모델로 그려져 기호
     범례(■·●)가 더는 화면과 안 맞았다. 범례 한 벌을 통째로 걷는다. */

  const body = (
    <div
      // 넓은 배치 클래스(확인·요청: 옛 확대창 클래스가 아닌지) — 옛 확대창(.scr-motion-big
      // -modal/-backdrop)은 소스째 삭제됐고, 이 .scr-motion-wide가 인라인 넓은 배치의
      // 유일한 클래스다(혼동을 없애려 -big에서 개명). ref는 자리 폭 재기(wide 판정)용.
      ref={rootRef}
      className={cx("scr-motion", wide && "scr-motion-wide")}
      // 확대 모드에선 폭 상한을 안 건다 — 모달 폭(아래 포털)이 이미 맵+양옆 세로 조작부
      // 기준으로 확정돼 있고, 여기까지 조이면 이중 제약으로 맵이 더 작아진다.
      // 230 → 150 → 230px(요청: 페이지라 더 크게 → 재지적: 노트북에서 맵이 다 안 들어옴)
      // — 150은 페이지 머리(크럼·카드 헤드 ≈200px)를 잊은 값이라 맵 자체가 화면을 넘쳤다.
      // 230이면 맵이 통째로 들어오고, 페이지 폭 상한(760px)은 그대로라 여전히 예전보다 크다.
      style={wide ? undefined : { maxWidth: `calc((100dvh - 230px) * ${(grid.width / grid.height).toFixed(4)})`, margin: "0 auto" }}
    >
      <div className="scr-motion-maprow">
      {teamCol(1)}
      {/* 로스터 가운데 vs(요청: 구분선 말고 vs — 모바일·PC 공통). */}
      <span className="scr-motion-teamvs" aria-hidden>vs</span>
      <div
        className={cx("scr-motion-map", pitched && "scr-motion-pitched", unitX2 && "scr-motion-unit2x")} ref={mapRef}
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
          /* 손짓 격리(지적 둘: 맵 조정 시 모달이 딸려 움직임 + 2D 모드에서 드래그가
             모달로 전파) — 맵 위 손짓은 확대 여부와 무관하게 브라우저에 안 넘긴다.
             확대 전 세로 스크롤만 열어 두던 pan-y가 2D에서 모달을 끌었다. 모달 훑기는
             맵 밖(로스터·댓글)에서 하면 된다. */
          touchAction: "none",
        }}
      >
        {/* 맵연결(요청: 별도로 맵 좌상단에, 연결 안 된 경우만, 알약 형태) — 렌즈 밖이라
            휠 줌에도 제자리다. 맵의 팬·줌 손짓에 안 딸리게 눌림을 끊는다. */}
        {!grid.image && (
          <button
            type="button"
            className="scr-motion-litbtn scr-motion-maplink"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setLinkOpen(true); }}
          >
            맵연결
          </button>
        )}
        {/* 미연결 안내(요청: 작게) — 지형(벽) 정보가 없어 유닛이 벽을 뚫고 다닌다는 것을
            알린다. 버튼 바로 아래 한 줄. */}
        {!grid.image && (
          <span className="scr-motion-maplink-note">미연결 상태에선 유닛이 벽을 뚫고 다녀요</span>
        )}
        {/* 렌즈 상자 — PC 휠 줌(요청)이 이 층을 통째로 키운다(마커·자취까지 같이). */}
        <div
          className={cx("scr-motion-lens", unitX2 && "scr-motion-unit2x")}
          style={{
            /* 줌 역배율 변수(지적: 클릭 마커·링은 UI라 확대에 굵어지면 안 됨) —
               UI성 마커가 scale(1/--mz)로 제 화면 크기를 지킨다. */
            "--mz": zoom,
            ...(zoom > 1 ? {
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "center",
            } : {}),
          } as React.CSSProperties}
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
          : (
            /* 매핑 안 된 맵(정정: 샘플 녹색이 아니라 맵에서 실제 추출한 지형) — 리플레이
               타일 격자 개략도(ReplayMapCanvas)를 바탕으로 깐다. 초록 계열 지형 램프가
               곧 기본색이다. 3D에선 실제 그림과 똑같은 기울임을 입는다(지적: 기본 파싱
               맵은 입체 효과가 안 됨). */
            <div
              className="scr-motion-canvas scr-motion-canvas-blank"
              style={pitched ? (() => {
                const { q, cy } = pitchGeom();
                return { transform: `translateY(${(-cy).toFixed(1)}px) scale(${q.toFixed(4)}) perspective(${PITCH_P}px) rotateX(45deg)` };
              })() : undefined}
            >
              <ReplayMapCanvas grid={grid} className="scr-motion-canvas-tiles" />
            </div>
          )}

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
          const drawOrder = buildsSrc.map((_, i) => i)
            .sort((a, b) => buildsSrc[a][2] - buildsSrc[b][2]);
          return drawOrder.map((i) => {
            const [sec, x, y, unit, raw, gone, liftAt] = buildsSrc[i];
            if (sec > t) return null;
            const goneAt = gone ?? 0;
            // 없어진 건물은 그냥 사라진다(요청: ✕ 표시 없음) — 착륙 이사·변태와도 한 결이다.
            /* 핵 한 방(요청) — 폭발 반경 안에서 무너진 걸로 판정된 건물은 파괴 감지가
               한참 뒤에 눈치챘더라도 착탄 순간 바로 걷는다. 이륙 이사 기록(liftAt)은
               goneAt이 착륙 시각이라 건드리지 않는다. */
            let goneEff = goneAt;
            if (!liftAt) {
              for (const nk of nukeImpacts) {
                const d = Math.hypot(x + footDx(unit) - nk.x, y + footDy(unit) - nk.y);
                if (goneAt > 0) {
                  if (nk.sec <= goneAt && goneAt - nk.sec <= 90 && d <= 5) {
                    goneEff = Math.min(goneEff, nk.sec);
                  }
                  continue;
                }
                /* 파괴 감지가 아예 없던 건물(지적: 핵 터진 자리에 건물이 남는다) — 파괴
                   감지는 놓치는 게 많아, 터진 게 확인된 핵의 폭심(4타일) 안 건물은 그냥
                   걷는다. 본진(커맨드·넥서스·해처리 계열)만은 체력이 커서 실제로도 핵
                   한 방을 버티므로 남긴다. */
                if (nk.confirmed && nk.sec >= sec && nk.sec <= t && d <= 4
                  && !["Command Center", "Nexus", "Hatchery", "Lair", "Hive"].includes(unit)) {
                  goneEff = goneEff > 0 ? Math.min(goneEff, nk.sec) : nk.sec;
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
            if (!razed && buildsSrc.some(([s2, x2, y2, u2, r2], j) =>
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
            /* 겹침 해소(요청: 건물끼리 캔버스 겹침 불가) — 화면 자리만 민다(위 bldNudge). */
            const nud = bldNudge.get(i);
            if (nud) { bx += nud[0]; by += nud[1]; }
            /* 짝의 걷힌 시각이 실제로 있어야(> 0) 한다(지적: 첫 기지가 위에서 내려온다) —
               시작 홀은 시작 시각이 0이라, 조건이 "gone === 0"이 되면 살아 있는 같은 종류
               건물 아무거나와 짝이 돼 거기서 날아왔다. */
            const flownFrom = sec > 0 && buildsSrc.find(([, x2, y2, u2, r2, g2]) =>
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
              const [s2, , , , , g2] = buildsSrc[bi];
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
            void activeBuild;
            /* 미세 박동(요청: 유닛 뽑거나 업그레이드 중인 건물은 아주 미세하게 박동) —
               게임 시간 1.6초 주기로 2.5%만 부풀었다 준다. 살아 일한다는 기색만 내고
               시선을 끌 만큼은 아니다. 캔버스 전환 때 끊겼던 심장 뛰기의 계승이다. */
            const pulse = producing || researching
              ? 1 + 0.025 * Math.sin((t * Math.PI * 2) / 1.6) : 1;
            /* (캔버스 전환 둘째 판·요청: 건물도 캔버스로) — 이름 창·아이콘이 다 걷힌
               건물 마커는 도형 하나라, 자리·상자·차례 계산만 그대로 두고 그리기는
               unitOps로 보낸다. DOM에는 효과(전투 불꽃·마법·핵)만 남는다(요청). */
            const shapeKind = SHAPE_KIND[unit];
            /* 부속건물도 제 모델이면 보통 건물과 같은 자리 규칙이다(요청: 부속건물 모델링)
               — + 글자 시절의 스넉 오프셋(-1.6, +0.4)은 모델 없는 폴백에만 남는다. */
            const addonPlus = ADDONS.has(unit) && !shapeKind;
            const fp2 = FOOTPRINT[unit] ?? [3, 2];
            const centerX = bx + footDx(unit);
            const centerY = by + footDy(unit);
            const anchorX = centerX - (addonPlus ? 1.6 : 0);
            const anchorY = centerY + (addonPlus ? 0.4 : 0)
              + (!addonPlus ? (shapeKind ? -riseOf(unit) / 2 : fp2[1] * 0.1) : 0);
            const [fxF, fyF] = posFrac(anchorX, anchorY);
            const mkK = pitchK(centerY);
            /* 나이 가산은 반 타일 몫(40) 아래로(지적: 연달아 놓인 가스 건물의 앞뒤
               가려짐이 뒤바뀜) — 세로 간격이 좁으면 나이 항(최대 70)이 y 항(타일당 80)을
               이겨 뒤 건물이 앞을 덮었다. */
            const z = pitched
              ? 1000 + Math.round((by + footDy(unit) * 2) * 80) + Math.min(30, Math.round(sec / 90))
              : 1000 + Math.round(afloat ? t : sec);
            const alpha = fade * (afloat ? 0.75 : 1);
            const color = modeColor(raw, team);
            if (addonPlus) {
              // 모델 없는 부속건물 폴백 — + 하나(캔버스 전환 첫 판이 모델까지 +로 덮던
              // 것을 바로잡았다: 이제 여섯 애드온 다 모델이 있어 여긴 안전망이다).
              unitOps.push({
                // 폴백 + 글자도 같은 자로(전수조사) — 고정 7/11px이었다.
                fx: fxF, fy: fyF, z, kind: "", sizePx: tilePx * 2 * mkK * pulse,
                color, alpha, textGlyph: "+", noShadow: true,
              });
              return null;
            }
            /* 바닥은 실제 발자국 그대로(요청: 건물 바닥크기를 캔버스에 맞추기) — 기지를
               1.3배 부풀리던 보정을 걷었다: 바닥 폭이 타일 발자국과 같아야 하고, 높이는
               모델 제 비율이 바닥 폭을 따라 정한다(아래 fitWidth). */
            /* 애드온의 1.35배 뻥튀기는 걷었다 — "작은 부속 모델이 상자를 덜 채워
               왜소하다"는 지적을 상자째 키워 때우던 보정인데, 이제 그리기 단계가 잉크
               폭을 재서 발자국을 채우므로(BLD_FILL_CACHE) 상자는 제 발자국(2×2) 그대로
               두면 된다. 그대로 두면 부속만 발자국보다 28% 넓게 그려진다. */
            const wTiles = fp2[0] * (shapeKind ? 1 : 0.8);
            const hTiles = wTiles * ((fp2[1] + (shapeKind ? riseOf(unit) : 0)) / fp2[0]);
            const wFrac = (wTiles / grid.width) * mkK;
            const hFrac = (hTiles / grid.width) * mkK;
            const race2 = bases.find((b) => b.key === raw)?.race;
            /* 짓는 SCV(재재재지적: 완공돼도 자원으로 보내지 말고 다음 명령을 받게) — 공사
               내내 불티 곁에 서 있고, 완공 뒤에는 그 곁(5타일)에 떨어지는 임자의 첫 일꾼
               명령(spts)을 '이 SCV가 받은 다음 명령'으로 보고 그 순간 일꾼 스트림에
               넘긴다(그 클릭부터는 일꾼 점이 그린다). 명령이 안 오면 게으른 SCV 그대로
               서 있고, 건물이 무너지면 함께 걷힌다. 지어낸 미네랄 왕복은 걷었다. */
            if (race2 === "테란" && !flownFrom && sec > 0 && !razed
              && (goneEff === 0 || t < goneEff)) {
              const bs2 = BUILD_SEC[unit] ?? 30;
              const scvX = centerX - fp2[0] / 2 + 0.35;
              const scvY = centerY + fp2[1] / 2 - 0.35;
              let scvShow = t - sec >= 0;
              if (t - sec >= bs2) {
                const trk2 = motion.players.find((pp) => pp.raw === raw);
                let nextCmd = Infinity;
                for (const pt2 of trk2?.spts ?? []) {
                  if (pt2[0] < sec + bs2 - 2) continue;
                  if (Math.hypot(pt2[1] - scvX, pt2[2] - scvY) <= 5) { nextCmd = pt2[0]; break; }
                }
                if (t >= nextCmd) scvShow = false;
              }
              /* v2에선 진짜 개체가 답을 안다(지적: SCV들이 건설현장에 남는다 — v2 모드는
                 motion이 빈 껍데기라 위 spts 게이트가 영영 안 열렸다) — 이 현장의 건설
                 앵커(f=2)를 남긴 일꾼 개체의 '앵커 뒤 첫 위치 증거' 시각이 곧 그 SCV가
                 현장을 떠난 순간이다. 그때부터는 개체 마커가 걸어 나가며 그리므로 합성
                 SCV를 걷는다. */
              if (scvShow && entOn) {
                const lv = builderLeave.find((b2) =>
                  Math.abs(b2.x - centerX) <= fp2[0] / 2 + 2 && Math.abs(b2.y - centerY) <= fp2[1] / 2 + 2
                  && b2.s >= sec - 15 && b2.s <= sec + bs2);
                if (lv && t >= lv.end) scvShow = false;
              }
              if (scvShow) {
                const [sfx2, sfy2] = posFrac(scvX, scvY);
                unitOps.push({
                  fx: sfx2, fy: sfy2, z: z + 1, kind: "scv",
                  rotDeg: Math.atan2(-(centerX - scvX), centerY - scvY) * (180 / Math.PI),
                  viewYaw: viewYawOf(scvX, scvY), flat: !pitched, pitch: pitched,
                  sizePx: unitGlyphPx(0, scvY),
                  color: modeColor(raw, teamOfRaw(raw)),
                  alpha: 1,
                  noSep: true,
                });
              }
            }
            if (raising) {
              // 공사는 종족 공용 모델(고치·소환구·공사장)이 말한다.
              /* 저그 고치는 크기 자체가 두근거린다(요청: 확대 바운스) — 10Hz t의 사인
                 박동. 스프라이트는 2px 칸 양자화라 두어 가지 크기를 오가며 캐시된다.
                 그리고 게임처럼 단계 성장(재지적: 너무 작음): 공사 진행에 따라 0.7배에서
                 1.5배까지 세 단계로 자란다. */
              const prog = Math.min(1, (t - sec) / (BUILD_SEC[unit] ?? 30));
              // 시작을 크게(재지적: 처음에 너무 작음 — 훨씬 크게 시작) — 0.7 → 1.0.
              /* 자라되 완성 건물을 넘지 않는다(전수조사: 1.0→1.5배라 4타일 해처리의
                 고치가 6.4타일 — 다 지어진 건물보다 컸다). 발자국의 0.8 → 1.0으로. */
              const stage = prog < 0.33 ? 0.8 : prog < 0.7 ? 0.9 : 1;
              const beat = race2 === "저그" ? stage * (1 + 0.06 * Math.sin(t * 5.2)) : 1;
              /* 공사 모델은 바닥 맞춤(지적: 소환구보다 훨씬 아래쪽에 실제 건물이 생긴다)
                 — 완성 모델은 '들어올린 칸'의 바닥 = 발자국 바닥에 앉는데, 소환구·고치는
                 제 작은 상자가 칸 중심(위로 들어올린 앵커)에 걸려 바닥이 발자국보다 위에
                 떴다. 상자 바닥을 발자국 바닥에 맞춘다. */
              // 소환구는 정사각 상자(재재지적: 3D에서 찌그러짐) — 어디서도 안 눌린다.
              /* 소환구 축소 + 더 띄우기(요청) — 상자 3.4 → 2.4타일이고, 발자국
                 바닥에서 0.6타일 위로 띄운다(워프 중인 건물은 아직 땅에 안 앉았다). */
              const modelHT = race2 === "프로토스" ? WARP_TILES
                : ((hFrac * grid.width) / mkK) * beat;
              /* 고치 치우침(재지적) — +0.25타일 보정 대신 모델 자체 무게중심을 상자
                 가운데로 옮겨 보정 없이 맞는다. */
              /* 발자국 한가운데가 아니라 조금 아래(앞)로(요청) — 그림자를 줄여 발치에
                 맞춘 것과 같은 결이다. 사선 시점에서 상자 중앙에 놓으면 모델이 제
                 발자국보다 뒤로 물러나 떠 보인다. */
              const bAnchorY = centerY + fp2[1] / 2 - modelHT / 2 + CONSTRUCT_DROP
                - (race2 === "프로토스" ? WARP_LIFT : 0);
              const [bfxF, bfyF] = posFrac(centerX, bAnchorY);
              unitOps.push({
                fx: bfxF, fy: bfyF, z,
                kind: race2 === "저그" ? "cocoon" : race2 === "프로토스" ? "warpin" : "scaffold",
                // 공사 모델도 45도 요잉(지적) + 종류별 보정(지적: 테란 공사장 반시계 90).
                rotDeg: buildingYawOf(race2 === "저그" ? "cocoon" : race2 === "프로토스" ? "warpin" : "scaffold"),
                viewYaw: viewYawOf(centerX, centerY), flat: !pitched, pitch: pitched,
                // 공사 모델도 완성 건물과 같은 지면선에 선다.
                baseFy: posFrac(centerX, centerY + fp2[1] / 2)[1],
                // 공사 모델도 완성 모델과 같은 폭 기준 — 바닥 폭이 발자국과 같아야 한다.
                /* 소환구는 크기 통일(재지적: 게임에서도 모든 건물이 같다) — 발자국과
                   무관하게 소형 기준 고정. */
                sizePx: 0,
                wFrac: race2 === "프로토스" ? (WARP_TILES / grid.width) * mkK : wFrac * beat,
                hFrac: race2 === "프로토스" ? (WARP_TILES / grid.width) * mkK : hFrac * beat,
                boxFit: "meet", fitWidth: true,
                /* 소환구는 떠 있다(요청: 그림자 작게 표현해 공중 느낌) — 발자국 폭의
                   절반짜리 작은 타원만 바닥에 깔린다. 몸은 WARP_LIFT만큼 떠 있으니
                   그 틈이 곧 높이로 읽힌다. 저그 고치·테란 공사장은 땅에 앉는다. */
                ...(race2 === "프로토스"
                  ? { groundShadow: true, footRatio: 0.5 }
                  : {}),
                color, alpha, noShadow: true,
              });
              /* 공사 애니(요청) — 모델은 캐시 스프라이트라 못 움직이니 CSS 오버레이가
                 맡는다: 테란 빨간 불 깜빡, 저그 심장 박동, 프로토스 소환 글로우. */
              /* 스파크 자리(재지적: 일꾼 주변에 작게) — 테란은 SCV가 붙는 건물
                 왼쪽 아래 모서리에서 인다. 저그 박동·토스 글로우는 가운데 그대로. */
              /* 모서리에 바짝(재지적: 일꾼이 너무 떨어져 있나) — 0.4 → 0.9타일 안쪽,
                 반 타일 위로: 불티가 공사장 몸체에 반쯤 얹힌다. */
              /* 저그 고치도 모델 앵커에(재지적: 고치와 안의 박동 빛 중앙이 안 맞음) —
                 고치 모델은 무게중심 보정(+0.25타일)과 바닥 맞춤을 받는데 글로우만
                 발자국 가운데였다. 소환구와 같은 식으로 셋 다 제 모델에 묶는다. */
              const bfxX = race2 === "테란" ? centerX - fp2[0] / 2 + 0.9 : centerX;
              const bfxY = race2 === "테란" ? centerY + fp2[1] / 2 - 0.6
                : centerY + fp2[1] / 2 - modelHT / 2;
              if (!qBuildFx) return null;
              return (
                <span
                  key={`bfx-${i}`}
                  className={`scr-motion-buildfx scr-bfx-${race2 === "저그" ? "zerg" : race2 === "프로토스" ? "toss" : "terran"}`}
                  style={{ ...posStyle(bfxX, bfxY), zIndex: z + 1 }}
                >
                  {/* 테란 용접 스파크(지적: 빨간 깜빡임이 전투 같다) — 밝은 흰빛의 길이가
                      다른 짧은 막대들을 둥글게 배치, 저마다 다른 박자로 튄다. 길이·각은
                      건물 번호 해시로 결정적이다. 크기는 타일 크기에 비례(재지적: 왜케
                      커 — 고정 px라 모바일의 작은 맵에선 막대가 건물만 했다). */}
                  {race2 === "테란" && (() => {
                    /* 불티 파팟(재×4지적: 동그라미 로딩 아이콘 같다) — 원인은 72도 균등
                       방사 배치 + 제각각 박자(= 도는 스피너). 이제 한 점에서 위쪽
                       부채꼴로 흩어진 제각각 길이의 실선들이 '같은 박자'로 파팟(두 번
                       연속) 튀고, 쉬었다가 반복한다(키프레임 scr-weld). 각은 위 반원에
                       건물 해시로 흩어 놓아 돌지 않는다. */
                    const ws = Math.max(0.3, ((mapRef.current?.clientWidth ?? 320) / grid.width) / 5);
                    return [0, 1, 2, 3, 4].map((k) => (
                      <span
                        key={k}
                        className="scr-bfx-weld"
                        style={{
                          width: "0.3px",
                          height: `${((0.4 + ((i * 7 + k * 5) % 5) * 0.28) * ws).toFixed(1)}px`,
                          transform: `rotate(${-90 + (k - 2) * 34 + ((i * 13 + k * 29) % 22) - 11}deg) translateY(${(0.2 * ws).toFixed(1)}px)`,
                          animationDelay: `${(i % 5) / 10}s`,
                        }}
                      />
                    ));
                  })()}
                </span>
              );
            }
            /* 건물 체력과 '맞은 순간'(요청: 피격 표현 재검토) — 자취가 내려간 마지막
               변곡점이 곧 이 건물이 맞은 때다. 체력바와 피격 불티가 같은 자를 쓴다. */
            const bldHp = ((): { frac: number | undefined; hurt: number } => {
              if (!entOn) return { frac: undefined, hurt: -99 };
              const arr = entBldHp.get(`${raw}|${Math.round(x)}|${Math.round(y)}`);
              if (!arr) return { frac: 1, hurt: -99 }; // 기록 없는 성한 건물도 만피 바(요청).
              const rec = [...arr].filter((r2) => r2.born <= sec + 5)
                .sort((a2, b2) => b2.born - a2.born)[0] ?? arr[0];
              let pct = 100;
              let hurt = -99;
              for (const [hs3, hv3] of rec.hp) {
                if (hs3 > t) break;
                if (hv3 < pct) hurt = hs3;
                pct = hv3;
              }
              return { frac: Math.max(0.04, pct / 100), hurt };
            })();
            /* 맞는 건물에도 불티(요청: 유닛·건물 피격 표현 재검토) — 여태 건물은 피격
               연출이 아예 없어, 해처리가 깎이는 동안 화면에서 터지는 것은 때리는 쪽
               유닛의 연기뿐이었다. 그래서 "피해 객체와 멀리 떨어진 곳에서 나온다"로
               보였다. 크기는 발자국에 매어(폭의 0.3배) 작은 건물에서 과하지 않게. */
            const bldTile9 = (mapRef.current?.clientWidth ?? 320) / grid.width;
            /* 건물도 실드가 남았으면 막이 번쩍인다(요청) — 프로토스 건물은 전부 실드를
               지녔고, 자취는 체력+실드 합이라 남은 비율로 갈린다. */
            const bs9 = BLD_STATS[unit];
            const bShShare9 = bs9 && bs9[1] > 0 ? bs9[1] / (bs9[0] + bs9[1]) : 0;
            const bShieldUp9 = bShShare9 > 0 && (bldHp.frac ?? 1) > 1 - bShShare9 + 0.001;
            const bldHitFx = bldHp.hurt > -99 && t - bldHp.hurt <= 0.8 ? (
              <span
                key={`bhit-${i}`}
                className="scr-motion-army scr-motion-dot scr-v2fx"
                style={{ ...posStyle(centerX, centerY), zIndex: z + 3 }}
              >
                {bShieldUp9 ? (
                  <span
                    key={`bshd-${Math.round(bldHp.hurt * 10)}`}
                    className="scr-motion-shieldfx"
                    style={{
                      width: `${(fp2[0] * 0.95 * bldTile9).toFixed(1)}px`,
                      height: `${(fp2[0] * 0.95 * bldTile9).toFixed(1)}px`,
                    }}
                  />
                ) : (
                  <span
                    key={`bh-${Math.round(bldHp.hurt * 10)}`}
                    className="scr-motion-puff scr-puff-hit"
                    style={{
                      width: `${(fp2[0] * 0.3 * bldTile9).toFixed(1)}px`,
                      height: `${(fp2[0] * 0.3 * bldTile9).toFixed(1)}px`,
                      transform: "translate(-50%, -50%)",
                    }}
                  />
                )}
              </span>
            ) : null;
            if (shapeKind) {
              unitOps.push({
                fx: fxF, fy: fyF, z, kind: shapeKind,
                /* 원작처럼 45도 요잉(지적) — 2D에도 적용(재지적: 2D도 45도 요잉해야지).
                   쐐기의 진범은 요잉이 아니라 hover 그림자의 beginPath 누락이었다. */
                rotDeg: buildingYawOf(shapeKind),
                hpMax: (() => {
                  const bs2 = BLD_STATS[unit];
                  return bs2 ? bs2[0] + bs2[1] : undefined;
                })(),
                hpFrac: bldHp.frac,
                groundShadow: true,
                // 접지 그림자의 발자국 비(지적: 그림자는 바닥 발자국만) — 세로/가로.
                footRatio: (FOOTPRINT[unit] ?? [3, 2])[1] / (FOOTPRINT[unit] ?? [3, 2])[0],
                /* 바닥에 실제로 깔리는 그림자(요청) — 발자국 크기의 타원을 타일 공간
                   에서 열두 점으로 찍고, 그 점들을 자리 사상(posFrac)으로 옮긴다.
                   화면에서 타원을 눌러 흉내 내는 것이 아니라 지면 위에 그린 도형이라,
                   원근·기울기가 지면 격자와 정확히 같다. */
                shadowPts: ((): [number, number][] => {
                  const rx9 = (FOOTPRINT[unit] ?? [3, 2])[0] / 2;
                  const ry9 = (FOOTPRINT[unit] ?? [3, 2])[1] / 2;
                  const pts9: [number, number][] = [];
                  for (let q9 = 0; q9 < 12; q9 += 1) {
                    const a9 = (q9 / 12) * Math.PI * 2;
                    pts9.push(posFrac(
                      centerX + Math.cos(a9) * rx9 * 0.98,
                      centerY + Math.sin(a9) * ry9 * 0.98,
                    ));
                  }
                  return pts9;
                })(),
                // 지면선 — 발자국 아랫변(그림자 타원의 아래 끝과 같은 지면).
                baseFy: posFrac(centerX, centerY + (FOOTPRINT[unit] ?? [3, 2])[1] / 2)[1],
                viewYaw: viewYawOf(centerX, centerY), flat: !pitched, pitch: pitched,
                sizePx: 0, wFrac: wFrac * pulse, hFrac: hFrac * pulse, boxFit: "meet",
                /* 전 건물 폭 기준(요청: 바닥을 발자국에, 높이는 제 비율로) — meet
                   (min(w,h)) 규칙은 상자가 낮으면 바닥까지 같이 줄여 발자국보다 작은
                   바닥을 만들었다(벙커가 유난히 작던 이유와 같은 갈래). 폭을 기준 삼으면
                   바닥이 늘 발자국 폭과 같고 높이는 모델 비율이 따라온다. */
                fitWidth: true,
                color, alpha, noShadow: true,
              });
              /* 애드온 연결 통로(지적: 본체와 잇는 방식 고민 — 원작 배치 참고) — 원작
                 에서 부속건물은 본체 오른쪽 아래에 붙는다: 애드온 왼쪽 모서리에서 본체
                 쪽으로 낮은 복도 판을 깐다. */
              if (ADDONS.has(unit)) {
                const mkA = pitchK(centerY);
                /* 본체를 찾아 정확히 잇는다(재재재지적: 연결이 너무 구림 — 통로가 본체
                   오른변에 안 닿고 허공에 떴다) — 같은 임자의 살아 있는 비-애드온 중
                   '오른변이 애드온 왼변과 맞닿는' 건물이 부모다. 통로는 부모 오른변에서
                   애드온 왼변까지, 양끝을 0.5타일씩 물려 이음매 없이 깐다. */
                const par = buildsSrc.find(([ps3, pxT, pyT, pu3, pr3, pg3]) =>
                  pr3 === raw && !ADDONS.has(pu3) && ps3 <= t
                  && ((pg3 ?? 0) === 0 || t < (pg3 ?? 0))
                  && Math.abs((pxT + (FOOTPRINT[pu3] ?? [4, 3])[0]) - x) <= 2
                  && Math.abs(pyT - y) <= 4);
                const leftEdge = par ? par[1] + (FOOTPRINT[par[3]] ?? [4, 3])[0] - 0.5 : x - 1.7;
                const rightEdge = x + 0.5;
                const linkW = Math.max(1.6, rightEdge - leftEdge);
                const [lfx, lfy] = posFrac((leftEdge + rightEdge) / 2, centerY + fp2[1] * 0.1);
                unitOps.push({
                  fx: lfx, fy: lfy, z: z - 1, kind: "addonlink", rotDeg: 0,
                  viewYaw: viewYawOf(centerX, centerY), flat: !pitched, pitch: pitched,
                  sizePx: 0, wFrac: (linkW / grid.width) * mkA, hFrac: ((linkW * 0.36) / grid.width) * mkA,
                  boxFit: "meet", fitWidth: true, color, alpha, noShadow: true,
                });
              }
              /* 방어 사격(재지적: 터렛은 골리앗 대공과 동일, 벙커는 안에 든 것 따라) —
                 사거리 안 적 마커가 있으면 건물에서도 트레이서가 나간다. 터렛은 공중
                 상대만 미사일(8타일), 벙커는 총알(6타일)에 임자가 파벳을 뽑아 뒀고 적이
                 코앞(3.5타일)이면 화염을 섞는다 — 안에 누가 들었는지는 리플레이에 안
                 남아, 그 시점 보유 병종으로 어림한다. */
              if (qCombat && (unit === "Missile Turret" || unit === "Bunker")
                && !raising && (goneEff === 0 || t < goneEff)) {
                const teamB = teamOfRaw(raw);
                const foeB = nearestFoe(teamB, centerX, centerY);
                // 화면 기준 조준(지적: 공중 각도·지면 평행) — 유닛 트레이서와 같은 셈.
                const tPxB = (mapRef.current?.clientWidth ?? 320) / grid.width;
                let dgy = (foeB.by - centerY) * tPxB * (pitched ? 0.74 : 1);
                if (foeB.air) dgy -= unitGlyphPx(0, foeB.by) * 1.6;
                const degB = Math.atan2(-((foeB.bx - centerX) * tPxB), dgy) * (180 / Math.PI);
                const fire: React.ReactNode[] = [];
                if (unit === "Missile Turret" && foeB.air && foeB.bd <= 8) {
                  fire.push(<span key="t" className="scr-motion-tracer scr-tracer-missile" style={{ transform: `rotate(${degB.toFixed(1)}deg) translateY(${MUZZLE_PX[unit] ?? 5}px)` }} />);
                }
                if (unit === "Bunker" && !foeB.air && foeB.bd <= 6) {
                  fire.push(<span key="g" className="scr-motion-tracer" style={{ transform: `rotate(${degB.toFixed(1)}deg) translateY(${MUZZLE_PX[unit] ?? 5}px)` }} />);
                  const hasBat = (unitDoneByRaw.get(raw) ?? []).some(([u2, ds]) =>
                    u2 === "Firebat" && ds.length > 0 && ds[0] <= t);
                  if (hasBat && foeB.bd <= 3.5) {
                    fire.push(<span key="f" className="scr-motion-tracer scr-tracer-flame" style={{ transform: `rotate(${degB.toFixed(1)}deg) translateY(${MUZZLE_PX[unit] ?? 5}px)`, animationDelay: "0.2s" }} />);
                  }
                }
                if (fire.length > 0) {
                  return (
                    <span
                      key={`dfx-${i}`} className="scr-motion-deffire"
                      style={{ ...posStyle(centerX, centerY), zIndex: z + 2 }}
                    >
                      {fire}
                      {bldHitFx}
                    </span>
                  );
                }
              }
              return bldHitFx;
            }
            // 전용 도형이 없는 건물 — 발자국 80% 네모(.scr-motion-sq와 같은 채움·0.82).
            unitOps.push({
              fx: fxF, fy: fyF, z, kind: "",
              sizePx: 0, wFrac: wFrac * pulse, hFrac: hFrac * pulse, boxFit: "fill",
              color, alpha: alpha * 0.82, noShadow: true,
            });
            return bldHitFx;
          });
        })()}


        {/* 채굴 일꾼(요청, 지적: 방향 반대) — 자원 지대마다, 그 시점에 서 있는 가장
            가까운 본진 건물(시작 본진·확장 포함)을 찾아 그리로 오간다. 가까운 홀이 없는
            자원(아직 안 편 멀티)은 비워 둔다. */}
        {/* 자원 지물(요청: 미네랄·가스 모델링해서 맵에 배치) — 지대마다 가스 깃발이면
            간헐천, 아니면 미네랄 결정 무더기. 팀색과 무관한 고정 색이고, 건물(1000+)
            아래 층에 깔린다. */}
        {(grid.resources ?? []).map((res, ri) => {
          const gasSpot = res[2] === 1
            || (!gridHasGasFlags
              && gasBuildings.some((g) => Math.hypot(g.x - res[0], g.y - res[1]) <= 6));
          /* 정확한 좌표 우선(재지적: 겹치더라도 제자리에) — 홀 치마 회피 보정은 걷었다.
             군집도 낱밭 수준(파서 반경 1.2)으로 좁혀, 밭이 홀에 붙은 맵은 붙은 그대로
             그린다. */
          const mkK = pitchK(res[1]);
          const [fx, fy] = posFrac(res[0], res[1]);
          /* 간헐천은 두 칸 폭(지적: 한 칸처럼 작았다). 미네랄은 낱밭 단위가 되면서
             2×1 밭 폭에 맞춘 2.4타일 — 예전 3.2는 지대(여러 밭 묶음) 시절의 폭이다.
             색은 제 기본색(지적): 미네랄은 반투명 파란 수정, 가스는 회갈색 바위. */
          /* 가스 위 건물(지적: 가스에 건물을 지으면 간헐천 모델은 사라져야) — 정제소류가
             서 있는 동안은 '제' 간헐천만 감춘다(재지적: 곁 간헐천까지 사라짐 — 최근접
             매칭으로 바꿈). 취소·파괴로 걷히면(gone) 도로 나타난다. */
          if (gasSpot && gasHideOf.some((g) =>
            g.sec <= t && (g.gone === 0 || t < g.gone) && g.gd <= 4
            && Math.abs(g.gx - res[0]) < 0.5 && Math.abs(g.gy - res[1]) < 0.5)) return null;
          // 고갈된 미네랄(요청)은 밭이 사라진다. 가스는 아래에서 색만 죽인다.
          /* v2에서는 고갈 어림을 끈다(지적: 미네랄·간헐천에 모델 적용해야지 — 후반에
             자원이 통째로 사라져 있었다). 고갈은 일꾼 수로 짐작한 v1 어림이라 인과
             증거가 없다 — v2는 자원 모델을 늘 세워 둔다. */
          const depleted = !entOn && (depleteAt.get(ri) ?? Infinity) <= t;
          if (!gasSpot && depleted) return null;
          // 미네랄 살짝 확대(요청) — 2.4 → 2.9타일 폭.
          /* 간헐천은 제 발자국 그대로 4타일(전수조사: 6.4타일로 그려져 제 발자국(4×2)
             보다 60% 넓었다 — 그 위에 앉는 정제소(4타일)가 못 덮어 가스 건물 주위로
             간헐천이 삐져나오던 원인이기도 하다). */
          // 미네랄 확대(재지적: 크기도 너무 작아) — 2.9 → 4.2타일 폭.
          const wTiles = gasSpot ? 4 : 4.2;
          unitOps.push({
            fx, fy,
            /* 자원도 높이를 가진다(지적: 뒤 사물을 가려야) — 990 바닥층이 아니라 건물과
               같은 y순 층에 선다. 기준은 그림 상자의 아랫변(+1.2 — 건물 z가 발자국
               아랫변 기준이라 같은 자로 재야 함): +0.7로는 콜로니 뿔이 앞 미네랄을
               덮었다(지적: 가려짐 에러). */
            /* 자원은 같은 줄 건물보다 앞(지적: 미네랄이 가려진다) — 본진 셋을 발자국
               보다 크게 그리기 시작하면서, 앞줄 미네랄이 뒷줄 본진 그림에 덮였다. 자원의
               z를 반 타일(+40)만큼 올려 같은 줄이면 자원이 이긴다. 정말 앞에 선 건물
               (한 타일 이상 아래)은 여전히 자원을 가린다. */
            /* 화가 순서 기준을 그린 상자 아랫변으로(지적: 미네랄이 다른 요소에
               가려짐) — 고정 +1.2는 밭을 키우고 나서 실제 그림보다 위였다. 건물이
               발자국 아랫변을 쓰는 것과 같은 자로 맞춘다. */
            z: pitched ? 1000 + Math.round((res[1] + (wTiles * 0.75) / 2) * 80) + 40 : 900 + ri,
            kind: gasSpot ? "geyser" : "mineral",
            viewYaw: viewYawOf(res[0], res[1]), flat: !pitched, pitch: pitched,
            sizePx: 0,
            wFrac: (wTiles / grid.width) * mkK,
            hFrac: ((wTiles * 0.75) / grid.width) * mkK,
            boxFit: "meet", fitWidth: true,
            /* 자원도 지면선에 앉힌다(지적: 간헐천·미네랄 위치도 그렇다) — 건물과 같은
               갈래의 어긋남이다. 상자 바닥을 화면에서 어림하지 않고, 같은 자리를 타일
               공간(칸 아랫변)에서 잡아 자리 사상으로 옮긴다. 평면에서는 값이 같아
               보이던 그대로고, 입체에서만 원근이 실려 제자리로 온다. */
            baseFy: posFrac(res[0], res[1] + (wTiles * 0.75) / 2)[1],
            color: gasSpot ? (depleted ? "#5d564c" : "#8f8274") : "#8fb9e8",
            // 미네랄 반투명(요청) — 뒤가 어렴풋이 비치는 수정 결정.
            alpha: gasSpot ? 1 : 0.55, noShadow: true,
          });
          return null;
        })}
        {/* 스파이더 마인(요청) — 안 터졌으면 모델, 터지는 1.2초는 폭발 스팬. */}
        {mines.map((m, mi) => {
          if (t < m.sec || (m.boom > 0 && t >= m.boom + 1.2)) return null;
          const [mfx, mfy] = posFrac(m.x, m.y);
          if (m.boom === 0 || t < m.boom) {
            unitOps.push({
              fx: mfx, fy: mfy, z: 960 + mi, kind: "mine",
              viewYaw: viewYawOf(m.x, m.y), flat: !pitched, pitch: pitched,
              // 스파이더 마인은 원작 분류대로 소형(전수조사: dot 눈금 0.8배였다).
              sizePx: unitGlyphPx(0, m.y),
              color: modeColor(m.raw, teamOfRaw(m.raw) ?? 1),
              alpha: 0.95, noShadow: true,
            });
            return null;
          }
          return (
            <span
              key={`mine-${mi}`} className="scr-motion-mineboom"
              style={{ ...posStyle(m.x, m.y), zIndex: 1500 }}
            />
          );
        })}
        {/* 저그 크립(요청) — 살아 있는 저그 건물마다 발밑에 보라 크립 블롭을 깐다.
            불투명 단색이라 이웃 크립과 겹치며 이음매 없이 한 덩어리로 이어지고,
            건물이 없어지면 페이드와 함께 곧 걷힌다(지적). 층은 자원(900)보다 아래. */}
        {buildsSrc.map(([sec, x, y, unit, raw, gone], i) => {
          if (sec > t) return null;
          const race = bases.find((b2) => b2.key === raw)?.race;
          if (race !== "저그") return null;
          const goneAt = gone ?? 0;
          if (goneAt > 0 && t >= goneAt + 1.2) return null;
          const cxb = x + footDx(unit);
          const cyb = y + footDy(unit);
          const [cfx, cfy] = posFrac(cxb, cyb);
          /* 크립 확산(요청: 원작 규칙) — 해처리(레어·하이브)와 콜로니류만 시간이 갈수록
             크립이 넓게 퍼지고, 나머지 건물은 제 발밑만 적신다. 같은 자리의 앞선 같은
             계열(해처리→레어, 크립→성큰)에서 확산 시계를 이어받고, 경기 시작 본진
             해처리(sec 0)는 처음부터 만개다(원작: 첫 해처리는 크립을 다 깔고 시작). */
          const hallKind = ["Hatchery", "Lair", "Hive"].includes(unit);
          const colonyKind = unit.includes("Colony");
          let wTiles = 8;
          if (hallKind || colonyKind) {
            let startSec = sec;
            for (const [s2, x2, y2, u2, r2] of buildsSrc) {
              if (r2 !== raw || s2 >= startSec || Math.hypot(x2 - x, y2 - y) > 1.5) continue;
              if ((hallKind && ["Hatchery", "Lair", "Hive"].includes(u2))
                || (colonyKind && u2.includes("Colony"))) startSec = s2;
            }
            const maxW = hallKind ? 15 : 11;
            const minW = hallKind ? 8 : 5.5;
            const p = startSec <= 1 ? 1 : Math.min(1, Math.max(0, t - startSec) / CREEP_SPREAD_SEC);
            // 앞이 빠르고 갈수록 느린 번짐 — 반 타일 눈금이라 스프라이트도 계단으로만 다시 굽는다.
            const ease = 1 - (1 - p) * (1 - p);
            wTiles = Math.round((minW + (maxW - minW) * ease) * 2) / 2;
          }
          const mk3 = pitchK(cyb);
          unitOps.push({
            fx: cfx, fy: cfy, z: 880 + (i % 20),
            kind: i % 3 === 0 ? "creeppatch" : i % 3 === 1 ? "creeppatch2" : "creeppatch3",
            viewYaw: viewYawOf(cxb, cyb), flat: !pitched, pitch: pitched,
            sizePx: 0,
            wFrac: (wTiles / grid.width) * mk3,
            hFrac: ((wTiles * 0.75) / grid.width) * mk3,
            boxFit: "meet", fitWidth: true,
            color: "#544659",
            alpha: goneAt > 0 && t >= goneAt ? Math.max(0, 1 - (t - goneAt) / 1.2) : 1,
            noShadow: true,
            clipWalk: true,
          });
          return null;
        })}
        {/* 건물 소멸 효과(요청: 종족별) — 무너진 순간 2초: 테란 주황 폭발+회색 연기,
            저그 보라 살점 퍼짐, 프로토스 파란 빛 붕괴. 이륙 이사·같은 계보 대체(진화·
            재건)는 폭발이 아니라 제외한다. */}
        {buildsSrc.map(([sec, x, y, unit, raw, gone, liftAt], i) => {
          const goneAt = gone ?? 0;
          if (!goneAt || liftAt || t < goneAt || t > goneAt + 2) return null;
          if (buildsSrc.some(([s2, x2, y2, u2, r2], j) => j !== i && r2 === raw
            && s2 > sec && Math.hypot(x2 - x, y2 - y) <= 1.5
            && (u2 === unit
              || (["Hatchery", "Lair", "Hive"].includes(unit) && ["Hatchery", "Lair", "Hive"].includes(u2))
              || (unit.includes("Colony") && u2.includes("Colony"))))) return null;
          const race = bases.find((b2) => b2.key === raw)?.race;
          const rk = race === "저그" ? "zerg" : race === "프로토스" ? "toss" : "terran";
          if (!qDeath) return null;
          /* 크기는 건물 발자국의 0.7배(재지적: 그래도 너무 큼 — 반으로) — 퍼센트 폭이라
             맵 확대에도 비례한다. */
          const clpW = (((FOOTPRINT[unit] ?? [3, 2])[0] * 0.7) / grid.width) * 100;
          return (
            <span
              key={`clp-${i}`}
              className={`scr-motion-collapse scr-clp-${rk}`}
              style={{
                ...posStyle(x + footDx(unit), y + footDy(unit)),
                width: `${clpW}%`, zIndex: 1450,
              }}
            >
              <span className="scr-clp-smoke" />
              <span className="scr-clp-core" />
            </span>
          );
        })}
        {/* 채굴 일꾼 점(v1 전용 장식 어림) — 일꾼 '수'로 자원 곁에 점을 찍는 층이라
            실제 조작과 무관하게 그려진다(지적: 가스를 안 지었는데 캐러 다닌다 — 머니맵
            특례가 맨 간헐천에도 점을 세웠다). v2는 실제 일꾼 개체가 제 클릭을 따라
            움직이므로 이 층을 통째로 끈다 — 어림 장식이 아니라 증거만 남긴다. */}
        {!entOn && (() => {
          const resList = grid.resources ?? [];
          /* 지대 임자를 먼저 한 번에 정한다(요청: 시작 일꾼 4기) — 아래에서 '임자가 같은
             미네랄 지대 중 몇 번째로 가까운가'를 따져야 해서, 지대마다 따로 구하던 임자
             찾기를 한 판 앞서 모아 계산한다. */
          const owners = resList.map((res) => {
            let owner: { x: number; y: number; raw: string; dist: number } | null = null;
            /* 18 → 10(지적: 엄청 떨어진 미네랄을 캐는 일꾼) — 그 거리면 확장이 아니라
               잘못 클릭이다. 진짜 확장은 홀이 자원 곁에 서므로 10이면 넉넉하다. */
            let best = 10;
            for (const m of bases) {
              // 함락된 본진(fallenHome)은 채굴 목적지가 아니다(지적: 본진이 안 망하던 문제).
              if (m.ghost || fallenHome(m) || m.x === undefined || m.y === undefined) continue;
              const d = Math.hypot(res[0] - m.x, res[1] - m.y);
              if (d < best) { best = d; owner = { x: m.x, y: m.y, raw: m.key, dist: d }; }
            }
            for (const hall of halls) {
              if (hall.sec > t || (hall.gone > 0 && t >= hall.gone)) continue;
              const d = Math.hypot(res[0] - hall.x, res[1] - hall.y);
              if (d < best) { best = d; owner = { x: hall.x, y: hall.y, raw: hall.raw, dist: d }; }
            }
            return owner;
          });
          const gasFlagOf = (res: (typeof resList)[number]) => res[2] === 1
            || (!gridHasGasFlags
              && gasBuildings.some((g) => Math.hypot(g.x - res[0], g.y - res[1]) <= 6));
          /* 임자별 미네랄 지대의 '가까운 차례'(요청: 시작 일꾼 4기는 가장 가까운 미네랄
             4군데로) — 일꾼 수보다 먼 차례의 지대는 캐는 점이 안 선다. 초반 4기는 홀에서
             가까운 네 지대만 오가고, 일꾼이 늘수록 바깥 지대까지 찬다. */
          const mineralRank = new Map<number, number>();
          // 임자별 미네랄 밭 수(요청: 밭당 일꾼 수 배분의 분모).
          const ownerMineralCount = new Map<string, number>();
          {
            const byOwner = new Map<string, number[]>();
            resList.forEach((res2, ri2) => {
              const o = owners[ri2];
              if (!o || gasFlagOf(res2)) return;
              const arr = byOwner.get(o.raw) ?? [];
              arr.push(ri2);
              byOwner.set(o.raw, arr);
            });
            for (const arr of byOwner.values()) {
              arr.sort((a, b) => owners[a]!.dist - owners[b]!.dist);
              arr.forEach((ri2, k) => mineralRank.set(ri2, k));
            }
            for (const [raw2, arr] of byOwner) ownerMineralCount.set(raw2, arr.length);
          }
          return resList.flatMap((res, ri) => {
          const owner = owners[ri];
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
          const gasSpot = gasFlagOf(res);
          if (gasSpot) {
            /* 반경 10 → 4(지적: 건물 없는 가스에 일꾼이 붙음) — 돈맵처럼 간헐천이
               몰려 있으면 하나의 정제소가 10타일 안 이웃 간헐천까지 전부 열어 버렸다.
               정제소는 간헐천 위에 서므로 4타일이면 짝이 정확하다. */
            const hasGasBuilding = gasBuildings.some((g) =>
              g.raw === owner!.raw && g.sec + 30 <= t && (g.gone === 0 || t < g.gone)
              && Math.hypot(g.x - res[0], g.y - res[1]) <= 4);
            if (!hasGasBuilding) return [];
          }
          const track = motion.players.find((p) => p.raw === owner!.raw);
          /* 시작 일꾼 4기(요청: 초반 4기 표현) — workers 집계는 생산 '누계'라 0에서
             시작해, 경기 첫 화면에 채굴 일꾼이 하나도 없었다. 기본 4기를 밑절미로 더한다. */
          let workerN = 4;
          for (const [sec, n] of track?.workers ?? []) {
            if (sec > t) break;
            workerN = 4 + n;
          }
          /* 저그 가스는 변태(지적) — 익스트랙터 하나마다 드론 하나가 사라져 그 자리에
             가스가 된다. 채굴 일꾼 수에서 그만큼 뺀다. */
          const ownerRace = bases.find((b) => b.key === owner!.raw)?.race;
          if (ownerRace === "저그") {
            const morphed = buildsSrc.filter(([bs, , , bu, br]) =>
              br === owner!.raw && bu === "Extractor" && bs <= t).length;
            workerN = Math.max(0, workerN - morphed);
          }
          if (workerN === 0) return [];
          /* 시작 4기는 가장 가까운 미네랄 4군데로(요청) — 일꾼 수보다 먼 차례의 미네랄
             지대는 캐는 점이 안 선다. 일꾼이 늘면 바깥 지대도 차례로 찬다. */
          if (!gasSpot && (mineralRank.get(ri) ?? 0) >= workerN) return [];
          // 고갈된 미네랄(요청)엔 일꾼도 안 간다. 고갈 가스는 원작처럼 계속 캔다(2씩).
          if (!gasSpot && (depleteAt.get(ri) ?? Infinity) <= t) return [];
          const team = teamOfRaw(owner.raw);
          /* 일꾼 수 규칙(지적: 하나에 한 마리가 아니다) — 가스는 세 마리, 미네랄은 밭당
             1~3마리에서 시작해 후반엔 네 마리까지: 임자의 일꾼 수를 밭 수로 나눈 몫이다. */
          const dots = gasSpot
            ? Math.min(3, workerN)
            : Math.max(1, Math.min(4, Math.round(workerN / Math.max(1, ownerMineralCount.get(owner.raw) ?? 8))));
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
            // (캔버스 전환) — 채굴 일꾼도 unitOps로. 종족 일꾼 상징물이 오간다.
            const [fx, fy] = posFrac(x, y);
            unitOps.push({
              fx, fy,
              // 채굴 일꾼 점도 같은 규칙(위 주석) — 같은 줄에서는 건물보다 위.
              z: pitched ? 1000 + Math.round(y * 80) + 40 : 900,
              kind: workerKindOf(ownerRace), rotDeg: hdg, viewYaw: viewYawOf(x, y),
              flat: !pitched, pitch: pitched,
              sizePx: unitGlyphPx(0, y),
              color: modeColor(owner!.raw, team),
              alpha: 1,
              noSep: true,
            });
            return null;
          });
          });
        })()}

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
              style={{ ...posStyle(m.x ?? 0, m.y ?? 0) }}
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




        {/* 개체 트랙 v2(요청: 태그 단위 분석을 별도 테이블에 담아 비교) — 태그 하나가
            곧 마커 하나다. 부대 어림의 묶음·흡수·합류 규칙이 전혀 없이, 각 개체가 제
            증거를 따라 걷고 제 죽음(d)에 종족 효과와 함께 걷힌다. 유닛 층만 바꿔 그리고
            건물·자원·크립·마법은 v1 그대로다. 정체를 모르는 개체는 그 종족의 기본 보병
            꼴을 반투명으로 — 아는 척은 안 하되 존재는 보인다. */}
        {entMode && entWalks.map((e, ei) => {
          const rp = e.walk;
          if (rp.length === 0 || t < rp[0][0]) return null;
          /* 체력 0 = 즉사(요청: 체력바가 0이 되면 바로 폭발·소멸) — 사망 기록(d)이
             늦게 오거나 없어도, 체력 자취가 0에 닿은 순간을 죽음으로 앞당긴다. */
          const hpZero = e.hp.find(([, hv0]) => hv0 <= 0)?.[0];
          const dieAt = hpZero !== undefined && (e.d === null || hpZero < e.d) ? hpZero : e.d;
          if (dieAt !== null && t >= dieAt + 1.2) return null;
          const team = teamOfRaw(e.raw);
          const holdKey0 = `${e.raw}-v2e${ei}`;
          // 교전으로 멈췄던 시간만큼 걸음 시계를 미룬다(위 engageDelayRef 주석).
          const dmem = engageDelayRef.current.get(holdKey0);
          let walkDelay = dmem && t >= dmem.since ? dmem.delay : 0;
          if (dmem && t < dmem.since) { engageDelayRef.current.delete(holdKey0); walkDelay = 0; }
          /* 새 명령 재동기화(기획서 1-F — 수리: 지연이 무한 누적돼 걸음 시계가 영구히
             뒤처졌다) — 적립 이후 실제 명령이 나오면 그 명령 좌표가 현실이므로 지연을
             걷는다. */
          if (dmem && walkDelay > 0 && e.orders.some((os0) => os0 > dmem.since && os0 <= t)) {
            engageDelayRef.current.delete(holdKey0);
            walkDelay = 0;
          }
          const rawPos = posAt(rp, Math.max(rp[0][0], t - walkDelay), null);
          if (!rawPos) return null;
          /* 탑승 중(요청: 수송선 승하차) — 배 안에 있으니 마커를 걷는다. 하차 지점
             (f=13)이나 다음 제 명령에서 다시 나타나 걷는다.
             승하차 연출(요청) — 태울 땐 빛기둥이 내리고 그 안에서 몸이 작아지며 떠올라
             사라지고, 내릴 땐 거꾸로다. rideK 0=제 모습, 1=완전히 빨려듦. */
          const RIDE_FX = 0.9;
          if (e.rides.some(([ra, rb]) => t >= ra + RIDE_FX && t < rb)) return null;
          let rideK = 0;
          const rideIn9 = e.rides.find(([ra]) => t >= ra && t < ra + RIDE_FX);
          const rideOut9 = e.rides.find(([, rb]) => t >= rb && t < rb + RIDE_FX);
          if (rideIn9) rideK = Math.min(1, (t - rideIn9[0]) / RIDE_FX);
          else if (rideOut9) rideK = Math.max(0, 1 - (t - rideOut9[1]) / RIDE_FX);
          /* 건설에 흡수(지적: 건설 끝난 일꾼이 복제된 자리에 계속 서 있음) — 현장에
             도착한 순간부터 숨는다. 공사 중 모습은 합성 건설 일꾼 연출의 몫이고,
             죽음이 아니라 소멸 효과도 없다. */
          if (e.buildHideAt !== null && t >= e.buildHideAt) return null;
          // 공사 중 구간(재재지적: 이중 표시) — 앵커~다음 증거 사이는 공사에 흡수돼 있다.
          if (e.buildHides.some(([ba2, bb2]) => t >= ba2 && t < bb2)) return null;
          /* 빙결(전수조사: 스태시스·마엘스톰·락다운) — 걸린 자리에 얼어붙는다. */
          const frzSt = e.statuses.find(([sa2, sb2, sk2]) =>
            FREEZE_STATUS.has(sk2) && t >= sa2 && t < sb2);
          const race = bases.find((b) => b.key === e.raw)?.race;
          const u = e.unit;
          /* 초반 무명은 일꾼(지적: 일꾼밖에 없는데 저글링이 정찰) — 그 사람의 첫 전투
             유닛이 태어나기 전의 무명 개체는 보병일 수 없다. */
          const drawUnit = u !== "" ? u
            : e.b < (entCombatStart.get(e.raw) ?? Infinity)
              ? (race === "저그" ? "Drone" : race === "테란" ? "SCV" : "Probe") : "";
          const isWorker = drawUnit === "SCV" || drawUnit === "Probe" || drawUnit === "Drone";
          /* 밭이 홀에 붙은 무한 맵인가 — 왕복 폭이 발자국보다 좁아, 아래 '홀에 들어간
             순간 숨김' 창이 왕복을 통째로 삼키는 경우를 가른다(지적). */
          let nearMine9 = false;
          const uAir = drawUnit !== "" && isAirUnit(drawUnit);
          /* 교전(지적: 상호작용 없음 + 어택땅 중 만나면 멈추고 싸워야) — 적 개체·방어
             건물이 시야 안이면 싸움이다: 그 자리에 멈춰 서고(engageHoldRef), 트레이서·
             불꽃이 인다. 일꾼·수송·옵저버는 안 싸운다(도망 대상일 뿐). */
          const holdKey = `${e.raw}-v2e${ei}`;
          const canFight = !isWorker && !uAir
            && MORPH_SHELL[drawUnit] === undefined
            && !(drawUnit !== "" && ENGAGE_SKIP.has(drawUnit));
          /* 표적 우선(지적: 어택 찍으면 그 대상을 공격해야) — 최근(30초 안) 공격 명령이
             찍은 태그가 아직 살아 움직이면 그쪽이 상대다. 없으면 가장 가까운 적. */
          let foe: { bx: number; by: number; bd: number; air: boolean; bld?: boolean; k?: string } =
            nearestFoe(team, rawPos.x, rawPos.y);
          /* 표적 우선(재수리·기획서 1-B): 최신 1건만 보던 규칙은 어택땅 연타 한 번에
             건물 표적을 지웠다 — nearestFoe에는 일반 건물이 없어 폴백도 없다. 창
             (건물 45초/유닛 12초) 안에서 역순으로 훑되, 태그 없는 명령(어택땅)은
             건너뛰고 태그 있는 가장 최근 명령을 채택한다. */
          for (let ai = e.atkAt.length - 1; ai >= 0; ai -= 1) {
            const [as2, atg, akx, aky] = e.atkAt[ai];
            if (as2 > t) continue;
            if (t - as2 > 45) break;
            if (atg <= 0) continue;
            let tp = entPosByTag.get(atg);
            /* 태그 미해석 폴백(기획서 2-D) — 태그가 지도에 없으면(시작 홀·태그 재활용
               분리) 클릭 좌표에서 3타일 안의 살아 있는 적 건물 자리로 잇는다. 어택땅
               (atg=0)은 여기 못 온다 — 건물이 보인다고 싸움이 나면 안 된다. */
            if (!tp) {
              const st9 = bldTagSpots.sites.find((s9) =>
                t >= s9.born + 2 && (s9.gone === 0 || t < s9.gone)
                && Math.abs(s9.x - akx) <= 3 && Math.abs(s9.y - aky) <= 3
                && (teamOfRaw(s9.raw) ?? 0) > 0 && teamOfRaw(s9.raw) !== team);
              if (st9) {
                tp = { x: st9.x, y: st9.y, team: teamOfRaw(st9.raw) ?? 0, air: false, bld: true, k: st9.k };
              }
            }
            // 팀 미상(0)은 표적으로도 안 삼는다(위 nearestFoe 주석과 같은 오인 방지).
            if (tp && tp.team > 0 && (team ?? 0) > 0 && tp.team !== team
              && t - as2 <= (tp.bld ? 45 : 12)) {
              const td = Math.hypot(tp.x - rawPos.x, tp.y - rawPos.y);
              // 너무 먼 표적은 안 겨눈다(지적: 타겟팅 오인) — 이미 딴 데 간 옛 표적이다.
              if (td <= ENGAGE_SIGHT_TILES * 1.6) {
                foe = { bx: tp.x, by: tp.y, bd: td, air: tp.air, ...(tp.bld ? { bld: true, k: tp.k } : {}) };
                break;
              }
            }
          }
          /* 히스테리시스(지적: 이동 중 위치가 앞뒤로 잘게 플리커) — 시야 경계에 선
             적 때문에 교전이 프레임마다 켜졌다 꺼지면, '멈춘 자리'와 '지연 걸음' 사이를
             오가며 흔들렸다. 들어올 땐 시야, 나갈 땐 시야×1.3이라 경계에서 안 떨린다. */
          const engagedBefore = engageHoldRef.current.has(holdKey);
          const fighting = canFight && !frzSt && Number.isFinite(foe.bd)
            && (foe.bd <= ENGAGE_SIGHT_TILES * (engagedBefore ? 1.3 : 1)
              /* 어택이 찍은 건물은 14.4타일부터 접근 시작(기획서 1-E — 수리: 시야
                 게이트가 철거 행군을 9타일 밖에서 세워 뒀다). */
              || (foe.bld === true && foe.bd <= ENGAGE_SIGHT_TILES * 1.6));
          let pos = rawPos;
          if (fighting && !uAir) {
            const mem = engageHoldRef.current.get(holdKey);
            /* 되감기만 리셋(기획서 1-C — 수리: 2.5초 유실 조건이 파고든 진행(adv)을
               통째로 날려 접촉→후퇴 요요를 만들었다. 깜빡임·컬링 공백은 아래 시계
               (dt9, 프레임당 1.5초 상한)로 흡수한다). */
            let base = mem && t >= mem.t0 ? mem : null;
            if (!base) {
              base = { x: rawPos.x, y: rawPos.y, t0: t, tLast: t, adv: 0 };
              engageHoldRef.current.set(holdKey, base);
            }
            const dt9 = Math.max(0, Math.min(1.5, t - base.tLast));
            base.tLast = t;
            /* 홀드는 후퇴만 막는다(수리: 교전 시작 자리에 박제돼 원자취가 표적으로
               전진해도 화면은 제자리였다) — 원자취가 표적에 더 가깝게 와 있으면
               기준점을 따라 옮기고, 그만큼 파고든 몫(adv)에서 뺀다. */
            const gNow = Math.hypot(foe.bx - rawPos.x, foe.by - rawPos.y);
            const gBase0 = Math.hypot(foe.bx - base.x, foe.by - base.y);
            if (gNow < gBase0) {
              base.adv = Math.max(0, base.adv - (gBase0 - gNow));
              base.x = rawPos.x;
              base.y = rawPos.y;
            }
            const gap = Math.hypot(foe.bx - base.x, foe.by - base.y);
            // 무명 개체(k="")는 보병 모형으로 그려지므로 근접으로 취급(기획서 1-A).
            const melee9 = drawUnit === "" || MELEE_UNITS.has(drawUnit);
            /* 정지 거리(기획서 1-C) — 건물은 발자국 사각형 가장자리 + 0.3타일(수리:
               중심 고정 2.0은 4×3 세로변을 파고들고 모서리에 못 닿았고, 성큰을
               nearestFoe로 잡으면 1.1로 발자국 안까지 들어갔다). */
            const maxAdv = ((): number => {
              if (foe.bld) {
                const fp = FOOTPRINT[foe.k ?? ""] ?? [3, 2];
                const ddx = Math.max(0, Math.abs(foe.bx - base.x) - fp[0] / 2);
                const ddy = Math.max(0, Math.abs(foe.by - base.y) - fp[1] / 2);
                return Math.max(0, Math.hypot(ddx, ddy) - 0.3);
              }
              return Math.max(0, gap - (melee9 ? 1.1 : 2.2));
            })();
            if (melee9) {
              /* 걸음 속도로만 다가간다(지적: 당겨지듯 빠르게 이동하는 것) — 예전엔
                 교전에 드는 첫 프레임에 base.adv를 2.5타일로 끌어올려, 몸이 한 박자에
                 쭉 빨려 들어갔다. 그 즉시 당김을 걷고 0에서 제 걸음으로 적분한다.
                 속업 반영은 원자취(walkTrack) 몫이라 여기선 기본 속도표만 쓴다. */
              const spd9 = Math.max(0.5, UNIT_SPEED[drawUnit] ?? 3.2);
              base.adv = base.adv + dt9 * spd9;
            } else {
              // 원거리도 같다 — 사거리까지 걸어서 좁힌다(즉시 2.5 → 걸음 적분).
              base.adv = base.adv + dt9 * Math.max(0.5, UNIT_SPEED[drawUnit] ?? 3.2);
            }
            /* 근접 잽(요청: 휘두름 호 대신, 권투처럼 표적 쪽으로 툭 나갔다 빠지게 —
               공속에 비례) — 붙은 뒤(당김이 다 찼을 때)부터 제 공격 주기로 앞뒤로
               민다. 한 주기의 앞 1/4에 튀어나가고 그 다음 1/3 동안 물러난 뒤 쉰다.
               개체마다 위상을 어긋내(ei) 무리가 한 몸처럼 들썩이지 않게 한다. */
            const pullBase = Math.min(base.adv, maxAdv);
            let jab9 = 0;
            if (melee9 && pullBase >= maxAdv - 0.05) {
              const per9 = MELEE_JAB_SEC[drawUnit] ?? 0.7;
              const ph9 = (((t + ei * 0.11) % per9) + per9) % per9 / per9;
              jab9 = ph9 < 0.25 ? ph9 / 0.25 : ph9 < 0.58 ? 1 - (ph9 - 0.25) / 0.33 : 0;
            }
            const pull = pullBase + jab9 * 0.42;
            pos = gap > 0.01
              ? { ...rawPos, x: base.x + ((foe.bx - base.x) / gap) * pull, y: base.y + ((foe.by - base.y) / gap) * pull }
              : { ...rawPos, x: base.x, y: base.y };
          } else {
            const mem = engageHoldRef.current.get(holdKey);
            /* 깜빡임 유예(기획서 1-C): 1.2초 안에 다시 붙으면 진행(adv)을 보존한다 —
               즉시 삭제가 재교전마다 t0·진행을 리셋해 요요를 만들었다. */
            if (mem && t >= mem.t0 && t - mem.tLast >= 1.2) {
              /* 교전이 끝났다 — 멈춘 시간을 걸음 지연에 넘겨 이어 걷게 한다.
                 찰나(0.4초 미만)의 스침은 지연으로 안 쌓는다(지적: 플리커). */
              if (mem.tLast - mem.t0 > 0.4) {
                engageDelayRef.current.set(holdKey, { delay: walkDelay + (mem.tLast - mem.t0), since: t });
              }
              engageHoldRef.current.delete(holdKey);
            }
          }
          /* 가스 왕복(지적: 가스 캐는 일꾼이 하나도 없다) — 배정 클릭은 한 번만 남고
             그 뒤는 게임이 자동 순환이라, 개체가 정제소 위에 서서 건물에 가려져 있었다.
             제 정제소 곁(2타일)에 선 일꾼은 가장 가까운 홀과 그 사이를 결정적으로
             왕복한다 — 어림 장식이 아니라, 그 일꾼이 실제로 가스에 배정된 개체다. */
          if (isWorker && !fighting) {
            const gasB = buildsSrc.find(([bs2, bx2, by2, bu2, br2, bg2]) =>
              br2 === e.raw && (bu2 === "Refinery" || bu2 === "Assimilator" || bu2 === "Extractor")
              && bs2 <= t && ((bg2 ?? 0) === 0 || t < (bg2 ?? 0))
              && Math.hypot(bx2 + footDx(bu2) - pos.x, by2 + footDy(bu2) - pos.y) <= 2);
            if (gasB) {
              const gx3 = gasB[1] + footDx(gasB[3]);
              const gy3 = gasB[2] + footDy(gasB[3]);
              let hall: { x: number; y: number } | null = null;
              let hd = 12;
              for (const h of halls) {
                if (h.raw !== e.raw || h.sec > t || (h.gone > 0 && t >= h.gone)) continue;
                const d2 = Math.hypot(h.x - gx3, h.y - gy3);
                if (d2 < hd) { hd = d2; hall = h; }
              }
              if (hall && hd > 1.5) {
                const cyc3 = (t * 1.5 + ei * 2.3) % (2 * hd);
                const k3 = (cyc3 < hd ? cyc3 : 2 * hd - cyc3) / hd;
                // 가스 왕복도 같은 결 — 0.84 → 0.72.
                const kk = 0.08 + k3 * 0.72;
                pos = { ...pos, x: gx3 + (hall.x - gx3) * kk, y: gy3 + (hall.y - gy3) * kk };
              }
            } else {
              /* 미네랄 줄서기(요청 ②: 일꾼 원장의 자원 배분) — 패치 곁에 선 일꾼은
                 그 패치와 홀을, 홀 곁에 유휴한 일꾼(합성 포함)은 배분받은 패치와 홀을
                 결정적 박자로 왕복한다. 배분은 개체 번호로 갈라 패치마다 줄이 선다. */
              const resList = grid.resources ?? [];
              let mpx = -1;
              let mpy = -1;
              for (const r of resList) {
                if (r[2] === 1) continue;
                if (Math.hypot(r[0] - pos.x, r[1] - pos.y) <= 2.2) { mpx = r[0]; mpy = r[1]; break; }
              }
              let hallM: { x: number; y: number } | null = null;
              let hdM = 5.5;
              for (const h of halls) {
                if (h.raw !== e.raw || h.sec > t || (h.gone > 0 && t >= h.gone)) continue;
                const d4 = Math.hypot(h.x - pos.x, h.y - pos.y);
                if (d4 < hdM) { hdM = d4; hallM = h; }
              }
              /* 집에 있는 일꾼은 캔다(지적: 첫 4기가 바로 채취해야 하는데 안 됨) —
                 예전 조건은 '멈춰 있을 때'뿐이라, 시작 일꾼처럼 증거 점이 띄엄띄엄한
                 개체는 두 점 사이를 하염없이 미끄러지는 '이동 중'으로 잡혀 왕복을 못
                 탔다(실측: 경기 20초에 일꾼 41기가 홀 발자국 안에 겹쳐 있었다). 최근
                 3초 안에 제 명령이 없으면 — 즉 지금 무엇을 하러 가는 길이 아니면 —
                 집 앞 일꾼은 캐는 것이 참이다. */
              /* 집 앞이면 그냥 캔다(재지적: 1분대가 넘어가야 채굴 모션이 나온다) —
                 '멈춰 있거나 최근 3초 명령이 없을 때'라는 문턱은 초반에 못 넘는다:
                 개막에는 임자가 일꾼을 계속 집어 명령을 주고, 증거 점이 띄엄띄엄해
                 그 사이 내내 '이동 중'으로 잡히기 때문이다. 제 홀 5.5타일 안에 있으면
                 무엇을 하러 가는 길이 아닌 한 캐는 것이 참이다 — 건물을 지으러 가는
                 길(앞뒤 몇 초)만 빼 준다. */
              const goingToBuild9 = e.buildSites.some((v9) => t >= v9[0] - 6 && t <= v9[0] + 1);
              if (mpx < 0 && hallM && !goingToBuild9) {
                const near = resList.filter((r) => r[2] !== 1
                  && Math.hypot(r[0] - hallM!.x, r[1] - hallM!.y) <= 9);
                if (near.length > 0) {
                  const pick = near[ei % near.length];
                  mpx = pick[0];
                  mpy = pick[1];
                }
              }
              if (mpx >= 0) {
                /* 반납은 늘 '패치에서 가장 가까운' 제 홀로(지적: 더 가까운 기지를 놔두고
                   먼 데 반납) — 예전엔 일꾼 몸 곁 홀(hallM)을 우선해, 두 기지 사이에 선
                   일꾼이 패치 반대편 먼 홀로 왕복했다. */
                let h2: { x: number; y: number } | null = null;
                let hd2 = 12;
                for (const h of halls) {
                  if (h.raw !== e.raw || h.sec > t || (h.gone > 0 && t >= h.gone)) continue;
                  const d5 = Math.hypot(h.x - mpx, h.y - mpy);
                  if (d5 < hd2) { hd2 = d5; h2 = h; }
                }
                /* 문턱을 1.5 → 0.6으로(지적: 일꾼들이 처음부터 일을 안 한다 — 왕복이
                   없다) — 실측(추가mineral10): 무한 맵은 미네랄 덩이가 홀에서 1.9타일
                   앞에 붙어 있어, 1.5타일 문턱을 겨우 넘거나 못 넘었다. 못 넘으면 왕복
                   자체가 안 걸리고, 넘어도 폭이 1.4타일이라 홀 발자국 안에서 다 끝났다.
                   가까운 밭에서는 폭을 넓게 잡아(0.72 → 0.9) 눈에 보이게 오간다. */
                if (h2 && hd2 > 0.6 && hd2 < 12) {
                  const cyc4 = (t * 1.6 + ei * 2.7) % (2 * hd2);
                  const k4 = (cyc4 < hd2 ? cyc4 : 2 * hd2 - cyc4) / hd2;
                  const span4 = hd2 < 3 ? 0.9 : 0.72;
                  const kk2 = 0.06 + k4 * span4;
                  pos = { ...pos, x: mpx + (h2.x - mpx) * kk2, y: mpy + (h2.y - mpy) * kk2 };
                  nearMine9 = hd2 < 3;
                }
              }
            }
          }
          /* 변태·건설로 흡수되기 직전엔 그 자리로 들어간다(요청: 드론 변태도 고치
             중앙에 놔야 자연스럽다) — 예전엔 제자리에서 그냥 사라져, 고치는 발자국
             한가운데에 솟는데 드론은 옆에서 없어졌다. 앵커 1.2초 전부터 발자국 중앙
             (고치와 같은 자리 보정 포함)으로 미끄러져 들어간다. */
          if (isWorker) {
            const site9 = e.buildSites.find((v) => t >= v[0] - 1.2 && t <= v[0] + 0.2);
            if (site9) {
              const bRow9 = buildsSrc.find(([bs9, bx9, by9, , br9]) =>
                br9 === e.raw && Math.abs(bs9 - site9[0]) <= 3
                && Math.abs(bx9 - site9[1]) <= 1.5 && Math.abs(by9 - site9[2]) <= 1.5);
              const fp9 = FOOTPRINT[bRow9 ? bRow9[3] : ""] ?? [3, 2];
              const tx9 = site9[1] + fp9[0] / 2;
              const ty9 = site9[2] + fp9[1] / 2 + CONSTRUCT_DROP;
              const k9 = Math.min(1, Math.max(0, (t - (site9[0] - 1.2)) / 1.2));
              pos = { ...pos, x: pos.x + (tx9 - pos.x) * k9, y: pos.y + (ty9 - pos.y) * k9 };
            }
          }
          /* 자원 반납 순간은 숨는다(요청: 기지 겹침은 허용하되 들어간 순간 렌더링에선
             숨기기) — 왕복 자리가 제 홀 발자국 안이면 그 프레임은 안 그린다. 원작도
             반납하는 일꾼은 건물 속으로 잠깐 사라진다. */
          if (isWorker && !nearMine9) {
            /* 밭이 홀에 붙은 무한 맵에서는 아예 안 숨긴다(지적: 일꾼이 일을 안 하는
               것처럼 보임) — 왕복 폭이 발자국보다 좁아 숨김 창이 왕복을 통째로
               삼켰다. 아래 창은 밭이 3타일 넘게 떨어진 보통 맵에서만 건다. */
            /* 숨김 창을 좁힌다(지적: 첫 4기가 채취하는 게 안 보인다) — ±1.8×1.3타일은
               4×3 발자국의 거의 전부라, 반납 왕복의 절반을 건물 속으로 삼켰다(실측:
               경기 20초에 일꾼 41기가 이 규칙으로 사라졌다). 정말 안으로 들어간
               한가운데(±1.15×0.85)만 숨긴다. */
            const inHall = halls.some((h) => h.raw === e.raw && h.sec <= t
              && (h.gone === 0 || t < h.gone)
              && Math.abs(h.x - pos.x) <= 1.15 && Math.abs(h.y - pos.y) <= 0.85);
            if (inHall) return null;
            /* 가스 건물도 같은 규칙(지적: 가스 일꾼이 들어가기 한참 전에 사라짐) —
               발자국 한가운데(문턱 1.4×0.7)에 정말 '들어간 순간'만 숨는다. 다가가는
               동안은 그대로 보인다. */
            const inGas = buildsSrc.some(([bs6, bx6, by6, bu6, br6, bg6]) =>
              br6 === e.raw && bs6 <= t && ((bg6 ?? 0) === 0 || t < (bg6 ?? 0))
              && (bu6 === "Refinery" || bu6 === "Assimilator" || bu6 === "Extractor")
              && Math.abs(bx6 + footDx(bu6) - pos.x) <= 1.4
              && Math.abs(by6 + footDy(bu6) - pos.y) <= 0.7);
            if (inGas) return null;
          }
          if (frzSt) {
            const fp2 = posAt(rp, Math.max(rp[0][0], frzSt[0]), null);
            if (fp2) pos = { ...pos, x: fp2.x, y: fp2.y };
          }
          /* 화면 스무딩(지적: 뚝뚝 끊김 → 재요청: 순간이동 무조건 제거, 아무리 짧아도
             스무스) — 지난 프레임 표시 자리에서 목표로 지수 추종. 거리 상한(6타일 스냅)
             을 걷어 드랍·리콜 급 큰 이동도 빠른 미끄럼으로 잇는다. 시간 되감기·큰 시간
             건너뜀(탐색)만 그 자리 리셋이다. */
          {
            const mem2 = drawPosRef.current.get(holdKey);
            if (mem2 && t >= mem2.at && t - mem2.at < 1.5) {
              const dt5 = t - mem2.at;
              const k5 = 1 - Math.exp(-dt5 * 6);
              let nx5 = mem2.x + (pos.x - mem2.x) * k5;
              let ny5 = mem2.y + (pos.y - mem2.y) * k5;
              /* 활강 속도 상한(지적: 갓 태어난 유닛이 랠리로 확 미끄러짐) — 지수 추종은
                 먼 어긋남일수록 초반이 광속이라, 표시 이동을 초당 9타일로 죈다. 큰
                 점프도 '빠른 걸음'으로만 따라간다. */
              const md5 = Math.hypot(nx5 - mem2.x, ny5 - mem2.y);
              const cap5 = 9 * dt5;
              if (md5 > cap5 && md5 > 0) {
                nx5 = mem2.x + ((nx5 - mem2.x) / md5) * cap5;
                ny5 = mem2.y + ((ny5 - mem2.y) / md5) * cap5;
              }
              pos = { ...pos, x: nx5, y: ny5 };
            }
            drawPosRef.current.set(holdKey, { x: pos.x, y: pos.y, at: t });
          }
          if (dieAt === null || t < dieAt) diePosRef.current.set(holdKey, { x: pos.x, y: pos.y });
          const [ax3, ay3] = [pos.x, pos.y];
          const [fx, fy] = posFrac(ax3, ay3);
          /* 건설 일꾼 뒷그물(재지적: 좌하단의 '진짜' 일꾼이 남는다 — 앵커 판정
             buildHideAt을 비껴간 경우) — 조용히 서 있는 일꾼이, 제 최근 활동 무렵
             '이후'에 선 내 건물 발자국에 붙어 있으면(회피가 모서리로 밀어낸 그 자리)
             그 공사에 흡수된 것으로 본다. 오래전부터 서 있던 본진 곁 일꾼은 건물이
             제 활동보다 한참 앞서라 안 걸린다. */
          if (isWorker && !rawPos.moving) {
            let lastAct = e.b;
            for (const os3 of e.orders) {
              if (os3 <= t) lastAct = os3;
              else break;
            }
            const absorbed = buildsSrc.some(([bs4, bx4, by4, bu4, br4, bg4]) => {
              if (br4 !== e.raw || bs4 > t || ((bg4 ?? 0) > 0 && t >= (bg4 ?? 0))) return false;
              if (bs4 < lastAct - 60) return false;
              const [fw4, fh4] = FOOTPRINT[bu4] ?? [3, 2];
              return Math.abs(pos.x - (bx4 + fw4 / 2)) <= fw4 / 2 + 1.2
                && Math.abs(pos.y - (by4 + fh4 / 2)) <= fh4 / 2 + 1.2;
            });
            if (absorbed) return null;
          }
          // 죽음 창(dieAt~+1.2초) — 마커 대신 종족별 사망 효과가 남는다(체력 0 즉사 포함).
          if (dieAt !== null && t >= dieAt) {
            if (!qDeath) return null;
            const dk = race === "저그" ? "zerg" : race === "프로토스" ? "toss" : "mech";
            /* 죽은 자리에 못박기(지적: 체력 0으로 소멸한 유닛이 폭발하며 움직임) —
               지금 표시 위치(스무딩·걸음이 계속 간다)가 아니라 죽은 '순간'의 자취
               좌표에서 터진다. */
            const dmem0 = diePosRef.current.get(holdKey);
            const dp0 = dmem0 ?? posAt(rp, Math.max(rp[0][0], dieAt), null);
            const dpx = dp0 ? dp0.x : ax3;
            const dpy = dp0 ? dp0.y : ay3;
            /* 공중은 떠 있던 몸 자리에서 터진다(지적) — 비행 높이만큼 위로. */
            const dieLift = uAir
              ? (drawUnit === "" ? unitGlyphPx(0, dpy) : unitPxOf(drawUnit, dpy)) * 1.6 : 0;
            return (
              <span
                key={`v2die-${ei}`}
                className="scr-motion-army scr-motion-dot"
                style={{ ...posStyle(dpx, dpy), zIndex: 1300, ...(dieLift ? { marginTop: `${(-dieLift).toFixed(1)}px` } : {}) }}
              >
                <span className={`scr-motion-diefx scr-die-${dk}`} />
              </span>
            );
          }
          /* 러커 버로우(지적: 판정이 안 됨) — v1과 같은 규칙: 러커가 제자리(이동
             없음)면 버로우로 보고 땅 구멍만 그린다. */
          const burrowed = drawUnit === "Lurker" && !rawPos.moving;
          /* 시즈모드(지적: 판정을 리플레이에서) — Siege/Unsiege 커맨드 증거 그대로. */
          let siegeOn = 0;
          for (const [ss2, on2] of e.sieges) { if (ss2 <= t) siegeOn = on2; else break; }
          const drawUnit2 = siegeOn === 1 && drawUnit.startsWith("Siege Tank")
            ? "Siege Tank (Siege Mode)" : drawUnit;
          /* 몸 방향(지적: 트레이서와 불일치 + 뒤로 걷기) — 싸울 땐 표적을 바라보고,
             걸을 땐 실제 화면 이동 방향을 본다(headingOfDisplay). */
          const foeDeg = Number.isFinite(foe.bd) && foe.bd <= ENGAGE_SIGHT_TILES
            ? Math.atan2(-(foe.bx - pos.x), foe.by - pos.y) * (180 / Math.PI) : null;
          /* 싸울 때도 '움직이면 이동 방향'이 먼저다(요청) — 표적 고정 요잉은 잽으로
             파고들거나 진형이 밀릴 때 몸이 옆·뒤로 미끄러지게 만들었다. 제자리에 선
             순간에만 표적을 본다. */
          const bodyHdg = headingOfDisplay(
            holdKey, pos.x, pos.y, headingOf(rp, rawPos),
            fighting && foeDeg !== null ? foeDeg : null,
          );
          /* 지금 체력(요청: 체력을 지니고 다닌다) — 변곡점 목록에서 t 시점 값.
             내려간 변곡점의 시각은 곧 '이 개체가 실제로 맞은 순간'이라, 피격 불티를
             그 자리·그 때에 띄우는 자로 함께 쓴다(요청: 피격 표현 재검토). */
          let hpPct = 100;
          let hurtAt = -99;
          for (const [hs2, hv2] of e.hp) {
            if (hs2 > t) break;
            if (hv2 < hpPct) hurtAt = hs2;
            hpPct = hv2;
          }
          /* 선택 표시(지적: 드래그 선택 구분) — 방금 명령을 받았다는 것은 그 직전에
             (드래그든 부대지정이든) 잡혔다는 뜻이다. 클릭 토글이 켜져 있으면 명령
             직후 0.35초 동안 몸에 흰 링이 켜져, 함께 잡힌 무리가 한눈에 보인다. */
          const selNow = clickFx && e.orders.some((os2) => t >= os2 && t - os2 <= 0.35);
          /* 시즈탱크 반동(요청: 발포 시 포탑·포신만) — 차체/포탑을 딴 판으로 밀어,
             쏘는 박자에 포탑 판만 뒤로 살짝 밀렸다 돌아온다. */
          /* 변태 중이면 알·고치다(요청) — 태어난 직후 MORPH_SHELL_SEC 동안은 제 모습이
             아니라 껍질 안이다. 이 동안은 싸우지도 않는다(아래 canFight). */
          const morphShell = MORPH_SHELL[drawUnit] !== undefined
            && t - e.b < MORPH_SHELL_SEC ? MORPH_SHELL[drawUnit] : null;
          const kind0 = morphShell ?? (burrowed ? "burrowhole"
            : isWorker ? workerKindOf(race) : unitMarkerKind(drawUnit2, race));
          const gunKind = kind0 === "tank" ? "tankgun" : kind0 === "tanksiege" ? "tanksiegegun" : null;
          const kindMain = kind0 === "tank" ? "tankbody" : kind0 === "tanksiege" ? "tanksiegebody" : kind0;
          unitOps.push({
            fx, fy,
            /* 공중은 2D에서도 y순(지적: 공중 유닛 간 앞뒤 섞임) — ei 나머지는 무작위
               순서라 뒤 풍선이 앞을 덮었다. */
            /* 같은 줄이면 유닛이 건물보다 위(지적: 유닛이 건물에 가려짐) — 건물의
               화가 기준은 발자국 아랫변이라 같은 y면 깊이가 같은데, 건물에만 나이
               가산(최대 +30)이 붙어 앞에 선 유닛까지 덮었다. 유닛에 그보다 큰 붙박이
               +40을 줘 같은 깊이에서는 늘 유닛이 이기게 한다(뒤에 선 유닛은 y가 작아
               여전히 건물 뒤로 간다). */
            z: pitched || uAir ? 1000 + Math.round(ay3 * 80) + 40 : 1000 + (ei % 137),
            kind: kindMain,
            selRing: selNow || undefined,
            // 보임 토글이면 만피여도 표시(요청: 모든 유닛·건물 다 표시).
            hpFrac: Math.max(0.04, hpPct / 100),
            hpMax: (() => {
              const st2 = UNIT_STATS[drawUnit2] ?? UNIT_STATS[drawUnit];
              return st2 ? st2.hp + (st2.sh ?? 0) : undefined;
            })(),
            tint: (() => {
              const actSt = e.statuses.find(([sa3, sb3]) => t >= sa3 && t < sb3);
              return actSt ? STATUS_TINT[actSt[2]] : undefined;
            })(),
            rotDeg: burrowed ? undefined : bodyHdg,
            viewYaw: viewYawOf(ax3, ay3), flat: !pitched, pitch: pitched,
            sizePx: (drawUnit === "" || isWorker ? unitGlyphPx(0, ay3) : unitPxOf(drawUnit, ay3))
              * (1 - rideK * 0.75), // 승하차 축소(요청)
            rise: rideK * 1.5, // 빔을 타고 둥둥 오른다(요청)
            color: modeColor(e.raw, team),
            alpha: (() => {
              /* 클로킹(전수조사) — 개인 클록(f=14/15)·상시 은신(다크·옵저버)·아비터
                 은신장. 적 디텍터(오버로드·옵저버·베슬·터렛·스포어·캐논·스캔)가
                 곁이면 반쯤 벗겨진다. */
              const cloakedNow = e.cloaks.some(([ca, cb]) => t >= ca && t < cb)
                || drawUnit === "Dark Templar" || drawUnit === "Observer"
                || (drawUnit !== "Arbiter" && arbiterSpots.some((asp) =>
                  asp.raw === e.raw && Math.hypot(asp.x - pos.x, asp.y - pos.y) <= 4.5));
              if (!cloakedNow) return u === "" ? 0.8 : 1;
              const detected = detectorSpots.some((dsp) => dsp.team > 0
                && dsp.team !== (team ?? 0) && Math.hypot(dsp.x - pos.x, dsp.y - pos.y) <= 9);
              return detected ? 0.72 : 0.4;
            })() * (1 - rideK * 0.95), // 승하차 페이드(요청)
            air: uAir,
            /* 겹침 이완은 v2에선 안 쓴다(지적: 다시 넣되 새로) — 도착 대형(entWalks의
               해바라기 나선)이 겹침을 미리 푸는 방식이라, 프레임마다 밀치는 이완의
               떨림이 없다. */
            noSep: true,
          });
          /* 귀신 활강(요청: 하템이 약간 귀신처럼 이동) — 걷는 동안 지나온 자리에
             몸 잔상 두 장을 점점 옅게 끌고 다닌다. 그림자·체력바·링 없이 몸만. */
          if (kindMain === "htemp" && rawPos.moving && !fighting) {
            const hr9 = (bodyHdg * Math.PI) / 180;
            const mainOp = unitOps[unitOps.length - 1];
            for (let gi = 1; gi <= 2; gi += 1) {
              const [gfx9, gfy9] = posFrac(ax3 + Math.sin(hr9) * 0.45 * gi, ay3 - Math.cos(hr9) * 0.45 * gi);
              unitOps.push({
                ...mainOp, fx: gfx9, fy: gfy9, z: mainOp.z - gi,
                alpha: mainOp.alpha * (gi === 1 ? 0.32 : 0.15),
                selRing: undefined, hpFrac: undefined, tint: undefined, noShadow: true,
              });
            }
          }
          /* 포탑 판(요청: 발포 시 포탑·포신만 움직임) — 쏘는 박자(1.5초 주기 앞 0.18초)에
             포탑만 뒤로 0.4타일 밀렸다 돌아온다. 차체 판(kindMain)은 제자리다. */
          if (gunKind) {
            const fireK = fighting && foeDeg !== null && ((t + ei * 0.7) % 1.5) < 0.18 ? 1 : 0;
            const gdx = foeDeg !== null ? -Math.sin((foeDeg * Math.PI) / 180) : 0;
            const gdy = foeDeg !== null ? Math.cos((foeDeg * Math.PI) / 180) : 0;
            const last = unitOps[unitOps.length - 1];
            const [gfx, gfy] = posFrac(ax3 - gdx * 0.4 * fireK, ay3 - gdy * 0.4 * fireK);
            unitOps.push({
              // 포신 가려짐 해결(지적) — 곁 유닛의 z가 포탑을 얇게 자르지 않게 여유 있게.
              ...last, kind: gunKind, fx: gfx, fy: gfy, z: last.z + 30,
              selRing: undefined, hpFrac: undefined, hpMax: undefined,
              tint: undefined, groundShadow: undefined,
            });
          }
          /* 전투 효과(지적: 효과 다 살리기) — 유닛별 예광탄이 가장 가까운 적 쪽으로
             뻗고, 이따금 퍼프가 터진다. DOM 수를 아끼려 세 개체에 하나만 효과를 단다. */
          /* 피격 연출(지적: 마린 트레이서는 있는데 공격받는 오버로드엔 피격효과가
             없다) — 최근 적 공격 명령의 표적이 '나'면, 싸울 수 없는 유닛(오버로드·
             일꾼·수송)에도 맞는 불꽃이 튄다. */
          /* 인터셉터(요청: 개수 실시간) — 캐리어 둘레를 도는 작은 점들. 개수는
             Train Fighter 변곡점 그대로다. */
          if (drawUnit === "Carrier" && e.ic.length > 0) {
            let icN = 0;
            for (const [is3, iv3] of e.ic) {
              if (is3 <= t) icN = iv3;
              else break;
            }
            if (icN > 0) {
              return (
                <span
                  key={`v2ic-${ei}`}
                  className="scr-motion-army scr-motion-dot"
                  style={{ ...posStyle(ax3, ay3), zIndex: 1305, color: modeColor(e.raw, team) }}
                >
                  {Array.from({ length: icN }).map((_, ki) => (
                    <span
                      key={ki}
                      className="scr-ic-dot"
                      style={{ transform: `rotate(${((ki * 360) / icN + t * 50) % 360}deg) translateX(10px)` }}
                    />
                  ))}
                </span>
              );
            }
          }
          /* 피격(요청: 지금은 피해 객체와 멀리 떨어진 곳에서 나오고 크기도 크다) —
             예전엔 '최근 8초 안에 어택 명령이 찍은 태그'를 맞은 것으로 쳤다. 명령이
             찍힌 곳과 실제로 맞는 곳은 다르고(표적은 그 사이 걸어가 있다), 8초 내내
             켜져 있어 싸움과 무관한 자리에서도 불티가 텄다. 이제 제 체력 자취가
             내려간 순간(hurtAt)에만, 제 몸 위에서 짧게 튄다. */
          const hitNow = t - hurtAt <= 0.7;
          /* 효과는 가슴 높이(지적: 공격 효과가 너무 낮다 — 발밑에서 튀었다) — 마커
             기준점은 발 자리라, 유닛 키의 1/3만큼 띄워 몸통에 맞춘다. */
          const fxPx = drawUnit === "" || isWorker ? unitGlyphPx(0, ay3) : unitPxOf(drawUnit, ay3);
          const fxLift = { marginTop: `${(-fxPx * 0.34).toFixed(1)}px` };
          /* 맞는 쪽 불티(요청: 크기도 몸에 맞게) — 고정 크기(9px에 scale 0.25)라
             유닛 크기를 캔버스 비례로 바로잡은 뒤엔 작은 유닛 위에서 유독 컸다.
             몸 상자의 0.55배로 잡고 가슴 높이에 띄운다. 싸우는 중이어도 맞으면
             띄운다 — 맞는 것과 때리는 것은 따로다. */
          /* 프로토스는 실드가 먼저 깎인다(요청: 실드가 남은 유닛·건물은 반투명 실드가
             깜빡이는 표현으로) — 체력 자취는 실드까지 합친 몫이라, 남은 비율이 체력
             몫보다 크면 아직 실드가 버티는 중이다. 그동안은 불티 대신 몸을 감싼 푸른
             막이 한 번 번쩍인다. */
          const st9 = UNIT_STATS[drawUnit2] ?? UNIT_STATS[drawUnit];
          const shShare9 = st9 && st9.sh ? st9.sh / (st9.hp + st9.sh) : 0;
          const shieldUp9 = shShare9 > 0 && hpPct / 100 > 1 - shShare9 + 0.001;
          const hitSpark = qCombat && hitNow ? (
            shieldUp9 ? (
              <span
                key={`shd-${Math.round(hurtAt * 10)}`}
                className="scr-motion-shieldfx"
                style={{
                  width: `${(fxPx * 1.05).toFixed(1)}px`,
                  height: `${(fxPx * 1.05).toFixed(1)}px`,
                }}
              />
            ) : (
              <span
                key={`hit-${Math.round(hurtAt * 10)}`}
                className="scr-motion-puff scr-puff-hit"
                style={{
                  width: `${(fxPx * 0.55).toFixed(1)}px`,
                  height: `${(fxPx * 0.55).toFixed(1)}px`,
                  transform: "translate(-50%, -60%)",
                }}
              />
            )
          ) : null;
          if (hitSpark && !fighting) {
            return (
              <span
                key={`v2hit-${ei}`}
                className="scr-motion-army scr-motion-dot scr-v2fx"
                style={{ ...posStyle(ax3, ay3), zIndex: 1310, ...fxLift }}
              >
                {hitSpark}
              </span>
            );
          }
          /* 수리·힐 연출(지적: 일꾼 수리 + 매딕 힐) — 명령 뒤 8초 동안 그 자리에서
             일한다: SCV는 용접 불티, 매딕은 흰 십자가 떠오른다. */
          if (!fighting) {
            const fixAt = e.fixes.length > 0
              ? e.fixes.filter((fs) => fs <= t && t - fs <= 8).pop() : undefined;
            if (fixAt !== undefined) {
              const heal = drawUnit === "Medic";
              return (
                <span
                  key={`v2fix-${ei}`}
                  className="scr-motion-army scr-motion-dot scr-v2fx"
                  style={{ ...posStyle(ax3, ay3), zIndex: 1310, ...fxLift }}
                >
                  <span
                    key={`fx-${Math.floor(t / 1.1)}`}
                    className={heal ? "scr-motion-healfx" : "scr-motion-puff scr-puff-weld"}
                  />
                </span>
              );
            }
          }
          /* 럴커 가시(지적: 가시 표현이 안 나옴) — 럴커는 교전 돌입 목록(ENGAGE_SKIP)
             밖이라 fighting이 영영 거짓이었고 가시 트레이서도 안 나왔다. 원작대로
             버로우한 채 적이 사거리(6타일, 여유 7) 안이면 명령 없이도 가시를 쏜다.
             럴커는 수가 적으니 1/3 솎기도 안 태운다. */
          const lurkStrike = burrowed && !frzSt && Number.isFinite(foe.bd) && foe.bd <= 7;
          /* 솎기(기획서 1-G) — 근접은 이제 그릴 효과가 없으므로(잽 동작이 대신한다) 덜
             솎을 이유도 없다. 다만 맞은 불티는 솎으면 안 된다 — 맞는 순간은 개체마다
             한 번뿐이라 솎이면 통째로 사라진다. */
          if (fighting && !lurkStrike && !hitSpark && ei % 3 !== 0) return null;
          if (((!fighting && !lurkStrike) || !qCombat) && !hitSpark) return null;
          /* 근접은 효과 스팬 자체가 없다 — 잽으로 때리는 것이 보이고, 맞는 쪽 불티는
             맞는 개체가 제 몸에 띄운다. */
          if (!lurkStrike && !hitSpark && (MELEE_UNITS.has(drawUnit) || drawUnit === "")) return null;
          const fxUnit = drawUnit === "" ? (race === "저그" ? "Zergling" : race === "테란" ? "Marine" : "Zealot") : drawUnit;
          const atkDeg = foeDeg;
          /* 조준각은 화면 기준(지적 둘: 공중 표적 각도가 안 맞음 + 지상 사격은 지면과
             평행해야) — 타일 각을 그대로 돌리면 3D의 바닥 눌림(0.74)과 떠 있는 몸
             (lift)이 무시된다. 화면 픽셀 델타로 재고, 공중 표적·공중 사수는 비행
             높이를 가감한다. */
          const aimDeg = (fx9: number, fy9: number, fAir: boolean): number => {
            const tPx9 = (mapRef.current?.clientWidth ?? 320) / grid.width;
            const ddx = (fx9 - pos.x) * tPx9;
            let ddy = (fy9 - pos.y) * tPx9 * (pitched ? 0.74 : 1);
            // 비행 높이 반감(재재지적)과 함께 0.8로.
            if (fAir) ddy -= fxPx * 0.8;
            if (uAir) ddy += fxPx * 0.8;
            return (Math.atan2(-ddx, ddy) * 180) / Math.PI;
          };
          const beamDeg = atkDeg !== null ? aimDeg(foe.bx, foe.by, foe.air) : null;
          /* 총구 모델 앵커(승인) — 몸 스프라이트와 같은 변환으로 앵커를 투영해, 그 자리
             에서 트레이서를 시작한다. 16-상자 중심(8,8)이 마커 앵커(발 자리)다. 효과
             스팬이 이미 가슴 높이(-0.34)로 떠 있고 몸 스프라이트는 -0.24만 떠 있어,
             그 차(+0.10)를 세로에 되돌린다. 앵커 없는 유닛은 픽셀 오프셋 폴백. */
          const fxKind = unitMarkerKind(
            siegeOn === 1 && fxUnit.startsWith("Siege Tank") ? "Siege Tank (Siege Mode)" : fxUnit,
            race,
          );
          const mzP = atkDeg !== null
            ? muzzlePoint(fxKind, atkDeg, viewYawOf(ax3, ay3), pitched) : null;
          const mzTf = mzP
            ? `translate(${(((mzP[0] - 8) * fxPx) / 16).toFixed(1)}px, ${((((mzP[1] - 8) * fxPx) / 16) + 0.1 * fxPx).toFixed(1)}px) rotate(${beamDeg!.toFixed(1)}deg)`
            : `rotate(${beamDeg?.toFixed(1)}deg) translateY(${MUZZLE_PX[fxUnit] ?? 4}px)`;
          return (
            <span
              key={`v2fx-${ei}`}
              className="scr-motion-army scr-motion-dot scr-v2fx"
              /* 럴커 가시는 가슴 높이가 아니라 땅에서 솟는다 — 들어올림 없이. */
              style={{ ...posStyle(ax3, ay3), zIndex: 1310, ...glyphStyle(e.raw, team), ...(lurkStrike ? {} : fxLift) }}
            >
              {atkDeg !== null && ATTACK_FX[fxUnit] && ATTACK_FX[fxUnit] !== "heal" && (
                <span
                  className={`scr-motion-tracer scr-tracer-${
                    (fxUnit === "Wraith" || fxUnit === "Goliath") && foe.air ? "missile" : ATTACK_FX[fxUnit]}`}
                  /* 럴커 가시는 표적까지 실거리(요청) — 고정 길이 대신 상대와의 거리를
                     타일 픽셀로 풀어 그만큼 솟는다(사거리 7타일 상한). */
                  style={{
                    transform: mzTf, animationDelay: `${((ei * 7) % 5) / 10}s`,
                    ...(lurkStrike ? {
                      height: `${(Math.min(7, foe.bd) * ((mapRef.current?.clientWidth ?? 320) / grid.width)).toFixed(1)}px`,
                    } : {}),
                    /* 근접 휘두름 호는 제 몸에 맞춘다(지적: "부메랑 모양이 계속 나온다")
                       — 6px 고정이라 유닛 크기를 캔버스 비례로 바로잡고 나니 호가 몸통
                       만 해져, 칼자국이 아니라 옆에 뜬 부메랑으로 보였다. 몸의 절반
                       크기에 테두리도 그만큼 얇게. */
                    ...(ATTACK_FX[fxUnit] === "slash" ? {
                      width: `${(fxPx * 0.34).toFixed(1)}px`,
                      height: `${(fxPx * 0.34).toFixed(1)}px`,
                      borderWidth: `${Math.max(0.4, fxPx * 0.05).toFixed(2)}px`,
                      opacity: 0.85,
                    } : {}),
                  }}
                />
              )}
              {/* (제거) 공격자 발밑 퍼프 — 때리는 쪽에서 터지던 연기라, 맞는 쪽 불티와
                  헷갈려 "피해 객체와 멀리 떨어진 곳에서 나온다"로 읽혔다(지적). 발사는
                  트레이서가, 피격은 맞는 쪽 불티가 말한다. */}
              {hitSpark}
            </span>
          );
        })}


        {/* 마법 — 떨어진 자리에 이름이 잠깐 떠오른다. 핵만은 이름에 폭발 파문까지
            얹는다(요청: "핵 떨어지는거도 효과") — 경기 하나에 몇 번 없는, 그 판의 가장
            큰 사건이라 다른 마법과 같은 글자 한 줄로는 안 보였다. */}
        {/* 클릭 자국(요청: 동그라미 안에 점, 납작하게 + 토글) — 브루드워의 이동 클릭
            표시처럼, 명령이 떨어진 자리에 찍은 사람 색의 납작한 고리+가운데 점이 잠깐
            남는다. v2 데이터로 그리므로 v2 모드 + 클릭 토글이 켜져 있을 때만이다. */}
        {entOn && clickFx && entClicks.map(([cs, cx2, cy2, raw, ck], i) => {
          if (t < cs || t - cs > 0.9) return null;
          /* UI 고정 크기 — 가장 축소(줌 1)에서도 또렷한 18px 기준(재지적). 타일 비례는
             큰 화면에서만 그보다 커진다. */
          const ckw = Math.max(18, ((mapRef.current?.clientWidth ?? 320) / grid.width) * 0.55);
          // 공격 클릭은 붉은 고리로 갈라 보인다(지적: 클릭 종류 구분).
          return (
            <span
              key={`clk-${i}`}
              className={cx("scr-motion-clickfx", ck === 7 && "scr-clickfx-atk")}
              style={{
                ...posStyle(cx2, cy2), color: modeColor(raw, teamOfRaw(raw)), zIndex: 1490,
                "--ckw": `${ckw.toFixed(1)}px`,
              } as React.CSSProperties}
            />
          );
        })}

        {/* 미니맵 핑(요청: 클릭도 기록 — 리플레이에 좌표가 온전히 남는다) — v2 트랙에만
            있다. 찍은 사람 색의 물결 고리가 3초 동안 퍼진다. 카메라 시야는 리플레이에
            저장되지 않아 못 그린다(엔진 재시뮬레이션의 몫). */}
        {entOn && qPing && (entData?.pings ?? []).map(([ps, px, py, ppid], i) => {
          if (t < ps || t - ps > 3) return null;
          const raw = entData?.players.find((pl) => pl.id === ppid)?.name ?? "";
          return (
            <span
              key={`ping-${i}`}
              className="scr-motion-pingfx"
              style={{ ...posStyle(px, py), color: modeColor(raw, teamOfRaw(raw)), zIndex: 1500 }}
            />
          );
        })}

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
                    <ShapeIcon kind="nuke" flat={!pitched} pitchView={pitched} />
                  </span>
                ) : (
                  <>
                    <span className="scr-motion-nuke-flash" />
                    {/* 화구는 반구 돔(요청) — 평면 원 대신 3D 돔이 부푼다. */}
                    <span className="scr-motion-nuke-domewrap"><ShapeIcon kind="nukedome" flat={!pitched} pitchView={pitched} /></span>
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
              /* 야마토(정정: 리플레이에 FireYamatoGun 명령이 좌표까지 남는다 — "안
                 남는다"던 앞선 말은 틀렸다) — 표적에 청백 에너지 구체가 작렬한다. */
              "Yamato Gun": ["yamato", 2.6],
            };
            const fx = AREA_FX[tech];
            if (fx) {
              if (tech === "EMP Shockwave" && t - sec > 1.6) return null;
              if (tech === "Yamato Gun" && t - sec > 2.2) return null;
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
                <span className="scr-motion-storm-flash" />
                {/* 원작 스톰(참고 이미지) — 굵은 수직 낙뢰 여러 가닥이 영역 가득 제각각
                    내리꽂힌다. 가닥마다 잔가지가 붙고, 흰 심지에 파란 광채를 두른다. */}
                <svg className="scr-motion-storm-bolts" viewBox="0 0 48 48" aria-hidden>
                  <path d="M6 3 L11 9 L7 16 L12 22 L5 31 L11 38 L7 46" />
                  <path d="M16 0 L13 12 L19 18 L14 29 L18 37 L13 47" />
                  <path d="M24 4 L21 10 L27 15 L23 24 L28 33 L23 41 L27 47" />
                  <path d="M33 1 L36 8 L30 17 L35 25 L29 35 L34 44" />
                  <path d="M41 3 L38 12 L44 20 L39 30 L43 39 L40 47" />
                  <path d="M46 8 L44 16 L47 25 L43 35 L46 43" />
                  <path d="M11 9 L16 12" />
                  <path d="M30 17 L25 20" />
                  <path d="M28 33 L33 36" />
                  <path d="M14 29 L9 32" />
                </svg>
              </span>
            );
          }
          /* (제거·요청: 배지 더 이상 사용 안 함) — 전용 효과가 없는 기술의 이름 알약
             배지가 서던 자리. 효과 있는 기술(스톰·스웜·핵·역병 등)만 그린다. */
          return null;
        })}

        {/* 드랍·태움(요청: 셔틀·드랍십·오버로드의 태우기와 드랍 표현) — 내린 자리엔
            '드랍', 제 수송선을 찍어 태운 자리엔 '태움'이 마법처럼 잠깐 떠오른다. */}
        {motion.players.flatMap((p) => {
          const team = teamOfRaw(p.raw);
          /* 수송선 실존 걸림막(지적: 수송선도 없는 시점·자리에 드랍 효과가 계속) —
             드랍·태움 신호는 번호 정체 어림이라 오염될 수 있다. 첫 수송선이 생기기
             전(저그는 Ventral Sacs 연구 전)의 신호와, 그 순간 수송선 자취가 곁(12타일)에
             없는 자리의 신호는 효과를 그리지 않는다. */
          const ready = transportReadyAt.get(p.raw) ?? Infinity;
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
              .filter(([s, cx2, cy2]) => s <= t && t - s <= CAST_HOLD_SEC
                && s >= ready && carrierNearAt(p.raw, s, cx2, cy2))
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
        {/* 유닛 캔버스 층(요청: 캔버스 전환 — 성능, 지적: 확대가 선명해야) — 렌즈 밖에
            둔다: CSS 확대에 태우지 않고 줌·팬을 그리기 좌표에 직접 입혀, 어느 배율에서도
            화면 해상도 그대로 또렷하다. unitOps는 렌즈 안 마커 계산부가 이 렌더에서
            채우고, 커밋 뒤 effect가 그린다. */}
        <UnitLayer
          ops={unitOps} zoom={zoom} pan={pan} wallMask={creepMask} maskRects={creepMaskRects}
          showShadows={qShadows} showOverlap={qOverlap} showHp={qHp && hpShow} showCreep={qCreep}
          /* 크립을 가두는 맵 모서리(재지적: 3D에서 크립이 영역을 벗어남) — 입체는 원근
             투영된 사다리꼴이라 네 모서리를 posFrac으로 투영해 넘긴다. 평면은 단위
             사각형이 나와 기존 직사각 클립과 같다. */
          clipQuad={[
            posFrac(0, 0), posFrac(grid.width, 0),
            posFrac(grid.width, grid.height), posFrac(0, grid.height),
          ]}
        />
        {/* (삭제) PC 확대 조절바 — PC에서는 확대 기능을 통째로 걷었다(요청). 확대·이동은
            이제 모바일 손짓(더블탭·두 손가락)만의 것이다. */}
      </div>
      {teamCol(2)}
      </div>

      {/* 지도 아래 도구줄 — 오른쪽 칸에 확대 토글만 남았다. 범례는 모델이 대신하고,
          지형 편집(산 버튼)도 걷었다(요청: 버튼 정리). */}
      <div className="scr-motion-toolrow">
        <div className="scr-motion-toolrow-mid" />
        {/* (삭제·요청: PC 좌측 케밥 제거) — 케밥 없이 오른쪽 닫기(X)만 남는다. */}
        {/* 닫기(X) — 확대창이 걷혀(요청) 이제 상세 자체를 닫는 버튼이다. 넓은 배치에서만. */}
        {wide && onDetailClose ? (
          <div className="scr-motion-expand-row">
            <button
              type="button" className="scr-motion-btn scr-motion-expand"
              onClick={() => onDetailClose()}
              aria-label="닫기" title="닫기"
            >
              <X size={14} />
            </button>
          </div>
        ) : null}
      </div>

      {/* 보기 설정 줄(정리·요청) — 원형 버튼 11개 중 윗줄 여섯: 보기(2D/3D)·컬러(팀색/
          개인색)·모델크기(×1/×2)를 짝 버튼으로, 종류 사이엔 갭. 지형 편집은 걷었다.
          자리는 조종부 위(재지적: 탐색바와 겹침) — 스크러버보다 먼저 선다. */}
      <div className="scr-motion-bar scr-motion-viewrow">
        {/* 라디오식 짝 버튼 → 라이팅 알약 라디오(요청: 게임 상세의 라디오 버튼 전부 —
            작게, 위에 라벨, PC·모바일 공통). 필터창과 같은 PillTabs를 쓴다. */}
        {/* 사양(요청: PC는 로스터와 버튼 사이, 모바일은 버튼그룹 위) — 렌더 요소 단계. */}
        <span className="scr-motion-radio scr-motion-qrow">
          <span className="scr-motion-radio-label">성능</span>
          <PillTabs
            options={[
              { value: "0", label: "최저" }, { value: "1", label: "저" },
              { value: "2", label: "중" }, { value: "3", label: "고" }, { value: "4", label: "최고" },
            ]}
            value={String(quality)}
            onChange={(v) => setQuality(Number(v))}
            aria-label="성능"
            fit
          />
        </span>
        <span className="scr-motion-radio">
          <span className="scr-motion-radio-label">보기</span>
          <PillTabs
            options={[{ value: "2d", label: "2D" }, { value: "3d", label: "3D" }]}
            value={pitched ? "3d" : "2d"}
            onChange={(v) => setPitched(v === "3d")}
            aria-label="보기"
          />
        </span>
        <span className="scr-motion-radio">
          <span className="scr-motion-radio-label">컬러</span>
          <PillTabs
            options={[{ value: "personal", label: "개인색" }, { value: "team", label: "팀색" }]}
            value={colorMode}
            onChange={(v) => setColorMode(v)}
            aria-label="컬러"
          />
        </span>
        <span className="scr-motion-radio">
          <span className="scr-motion-radio-label">모델 크기</span>
          <PillTabs
            options={[{ value: "s", label: "작게" }, { value: "l", label: "크게" }]}
            value={unitX2 ? "l" : "s"}
            onChange={(v) => setUnitX2(v === "l")}
            aria-label="모델 크기"
          />
        </span>
        {/* (v1 제거·요청: 두 개가 섞여 헷갈린다) — v1/v2 토글이 있던 자리. 개체 트랙이
            없는 옛 경기만 재분석 안내를 띄운다. */}
        {loadUnitTracks && entLoad === "none" && (
          <span className="scr-motion-btn scr-motion-rbtn" style={{ opacity: 0.7, pointerEvents: "none" }}>
            개체 트랙 없음 — 재분석 필요
          </span>
        )}
        {/* 클릭 자국 토글(요청) — v2 데이터로 그리므로 v2가 켜져 있을 때만 선다. */}
        {/* 체력바(요청: 라디오화, 마우스 조작 앞 순서). */}
        <span className="scr-motion-radio">
          <span className="scr-motion-radio-label">체력바</span>
          <PillTabs
            options={[{ value: "on", label: "보임" }, { value: "off", label: "숨김" }]}
            value={hpShow ? "on" : "off"}
            onChange={(v) => setHpShow(v === "on")}
            aria-label="체력바"
          />
        </span>
        {/* 마우스 조작 표시(요청: 라벨 달고 라디오는 on/off) — 다른 라디오와 같은 꼴. */}
        {entOn && (
          <span className="scr-motion-radio">
            <span className="scr-motion-radio-label">마우스 조작</span>
            <PillTabs
              options={[{ value: "on", label: "보임" }, { value: "off", label: "숨김" }]}
              value={clickFx ? "on" : "off"}
              onChange={(v) => setClickFx(v === "on")}
              aria-label="마우스 조작"
              fit
            />
          </span>
        )}
        {/* 배속(재재요청: 제일 마지막) — 보기 줄 맨 끝. */}
        <span className="scr-motion-radio scr-motion-speeds">
          <span className="scr-motion-radio-label">배속</span>
          <PillTabs
            options={SPEEDS.map((v) => ({ value: String(v), label: `×${v}` }))}
            value={String(speed)}
            onChange={(v) => setSpeed(SPEEDS.find((s) => String(s) === v) ?? SPEEDS[0])}
            aria-label="배속"
            fit
          />
        </span>

      </div>
      {linkOpen && createPortal(
        <div className="scr-modal-overlay scr-terrain-overlay" onClick={() => setLinkOpen(false)}>
          <div className="scr-modal scr-maplink-modal" onClick={(e) => e.stopPropagation()}>
            <div className="scr-modal-head">
              <span>맵연결{grid.imageName ? ` — 지금: ${grid.imageName}` : ""}</span>
              <button className="scr-icon-btn" onClick={() => setLinkOpen(false)} aria-label="닫기"><X size={14} /></button>
            </div>
            <div className="scr-modal-body">
              <p className="scr-maplink-hint">
                이 경기의 맵을 저장된 미니맵 중에서 골라 연결해 주세요 — 같은 맵을 쓰는
                모든 경기가 그 그림으로 그려져요.
              </p>
              {linkErr && <div className="scr-err">{linkErr}</div>}
              {linkChoices === null && !linkErr ? (
                <div className="scr-empty">불러오는 중…</div>
              ) : (
                <div className="scr-maplink-list">
                  {/* 세로 목록(요청) — 왼쪽 썸네일, 가운데 이름, 오른쪽 작은 글씨로
                      그 그림에 연결된 리플레이 수. */}
                  {(linkChoices ?? []).map((c) => (
                    <button
                      key={c.id} type="button" disabled={linkBusy}
                      className={cx("scr-maplink-item", grid.imageId === c.id && "scr-maplink-item-on")}
                      onClick={() => void pickLink(c.id)}
                    >
                      <img className="scr-maplink-thumb" src={c.image} alt="" draggable={false} />
                      <span className="scr-maplink-name">{c.name}</span>
                      <span className="scr-maplink-count">리플레이 {c.matches}</span>
                    </button>
                  ))}
                  {(linkChoices ?? []).length === 0 && linkChoices !== null && (
                    <div className="scr-empty">등록된 미니맵이 없어요.</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
      {/* 조종간 한 줄(요청: PC·모바일 공통 — [재생 | 탐색바 | 시각], 시각 아래 작은
          공유 버튼) — 컴팩트하게 여백을 죈다. */}
      <div className="scr-motion-bar scr-motion-bar-controls">
        <button
          type="button" className="scr-motion-play"
          onClick={() => {
            if (done) { setT(0); setDone(false); setPlaying(true); return; }
            setPlaying((v) => !v);
          }}
          aria-label={playing ? "일시정지" : "재생"}
        >
          {playing
            ? <Pause size={20} fill="currentColor" />
            : done
              ? <RotateCcw size={20} />
              : <Play size={20} fill="currentColor" />}
        </button>
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
        <span className="scr-motion-clockwrap">
          <span className="scr-motion-clock">{fmtClock(t)} / {fmtClock(total)}</span>
        </span>
      </div>
      {/* 현재 장면 공유는 조종간 아랫줄에 따로(재지적) — 오른끝 정렬 한 줄. */}
      {shareNode && <div className="scr-motion-bar scr-motion-sharerow">{shareNode}</div>}
      {/* (삭제·지적: PC 타임스탬프 중복) — 기둥의 타임스탬프·등록자는 걷었다. 시각은
          맵 이름 줄(.scr-story-when)이 말하고 등록자는 그 오른쪽에 붙는다(GameResultStory). */}
      {/* 오른쪽 댓글 영역(요청: PC에서 댓글부를 미니맵 우측으로 — 기존 확대창 방식 그대로,
          다만 이제 겹창 없이 상세 화면 안 인라인이다). */}
      {wide && side ? <div className="scr-motion-sidewrap">{side}</div> : null}
    </div>
  );

  /* (삭제·요청: PC 확대창 관련 소스 완전 제거) — 포털 모달·가리개·폭 공식 전부.
     넓은 배치는 wide가 인라인으로 그린다. */
  return body;
}
