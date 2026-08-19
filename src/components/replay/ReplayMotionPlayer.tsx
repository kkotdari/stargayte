import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import Avatar from "../common/Avatar";
import ReplayMapCanvas from "./ReplayMapCanvas";
import PillTabs from "../common/PillTabs";
import { cx } from "../../utils/format";
import { BUILDING_KO, TECH_KO, UNIT_KO } from "../../utils/replayNames";
import { ARMOR_WEAPON_PAIRS, UPGRADE_LINE_KO } from "../../utils/replayTechNames";
import type { ReplayMapGrid } from "../../utils/replayParser";
import { api } from "../../api/client";
import { applyReplayMap, promoteReplayMap } from "../../hooks/useReplayMap";
import { AIR_UNITS } from "../../utils/replayBuildMix";
import { BLD_STATS, UNIT_BUILD_SEC, UNIT_STATS, type UnitTracksV2 } from "../../utils/replayUnits";
/* 사거리는 이 파일이 들고 있던 상수(ENGAGE_SIGHT_TILES 9, 방어 건물 7/7/7/8/6, 벙커 안
   화염 3.5)가 아니라 표에서 온다(과제 #48) — 마린도 시즈 탱크도 한 값 9로 쏘고 9에서
   멈추던 자리다. 표를 읽는 문은 **bwCombat 하나**로 정한다: bwUnits에도 같은 이름의
   reachTiles가 있지만 그쪽은 업그레이드·벙커 보너스를 못 받는 짧은 판이라, 두 문을 같이
   열면 같은 이름이 두 뜻을 갖는다.
   fireRangeTilesOf는 '몸 반지름을 뺀 순수 사거리'다. 이 파일의 거리 판정은 전부 중심-중심
   이라 실제보다 두 몸 반지름만큼 짧게 잡히는 어림인데, 그리기용 게이트라 그대로 둔다 —
   반지름까지 더하는 정확한 셈은 코어(bwCombat.reachTiles)의 몫이다. */
import {
  BUNKER_SEATS, acquireTilesOf, fireRangeTilesOf, isKnownKind, profileOf, weaponVs,
} from "../../utils/bwCombat";
/* 러커 가시가 나아가는 거리·속도는 무기표가 아니라 iscript 행동(behaviour 9 "go to max
   range")에서 온 값이라 bwCombat이 안 물고 있다. 숫자를 여기 또 적는 대신 표에서 읽는다. */
import {
  BUILDING_FOOT, FRAME_SEC, LURKER_SPINE_SPEED_PX, LURKER_SPINE_TRAVEL_PX, buildingBox,
} from "../../utils/bwUnits";
// (정리) DEFENSE_BUILDINGS — 건물 캔버스 전환으로 ▲ 글자 갈래가 없어져 더는 안 쓴다.
import { terrainOf, decodeWalk, type TerrainGrid } from "../../utils/minimapTerrain";
import { loadSimTracks, logSim } from "../../utils/simClient";
import {
  hitsAt, posAtSim, shotsAt, ST_CARRY_GAS, ST_CARRY_MIN, ST_INSIDE,
  type SimEventArr, type SimTrack,
} from "../../utils/simCore";
/* 자취 읽기는 유틸로 나갔다(과제 #61) — 코어가 걸음의 진실이 된 뒤로 이 파일의
   몫이 아니고, 밖에 있어야 자로 잴 수 있다(scripts/pos-check.mjs). */
import { posAt, type TrackPos, type TrackPt } from "../../utils/replayTrack";
/* 승하차 딜레이도 표에서 읽는다(요청: "탑승 딜레이시간에 딱 맞추기") — 태우기는 오더
   게이트 9프레임, 내리기는 한 기당 18프레임이다. */
import { FLYING_BUILDING_TPS, PICKUP_POLL_SEC, UNLOAD_GAP_SEC } from "../../utils/bwTransport";
import {
  annulusPath, bandPath, bodyFace, capFace, curvePath3, depthNow, fine, groundEllipse,
  LOD_FINE, LOD_TRIM, lodFilter, shape, sideFace, tagKey, topFace, trim, bake,
  type ShapeFace,
  boxFaces3, cylinderFaces3, discPath3, polyPath3, project,
  domeFaces3, faceLight, facingRatio, frustumFaces3, groundSquashNow, hornFaces,
  screenCircle, sphereFaces3, tubeFaces,
  wallDiscPath, withPitchView, withTopView, withViewShear, withYaw, zsorted,
} from "../../utils/shapeOblique";
import { TEAM_COLOR, type MinimapMarker } from "./ReplayMinimap";

/* ── 모션 트랙 타입(옛 utils/replayMotion.ts에서 이사) ─────────────────────────────
   요약(summaryData) 생성이 걷히면서 트랙을 만드는 쪽(motionOf)은 사라졌고, 저장돼 있던
   모션을 읽어 그리는 이 파일이 타입의 유일한 사용처라 여기로 옮겨 왔다. 좌표는 전부
   타일이고, 시각은 초(정수)다. */


/** [초, x, y, 건물 영문명, raw, 무너진 초(0이면 살아 있음), 이륙한 초?] — 화면이 읽는
 *  건물 한 줄. 개체 트랙(buildsV2)이 만드는 유일한 꼴이다. */
export type BuildRow = [number, number, number, string, string, number, number?];
/** [초, x, y, 기술 영문명, raw] — 좌표가 남는 마법 한 줄(스톰·스웜·리콜…). */
export type CastRow = [number, number, number, string, string];

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
/** 크립이 만개까지 퍼지는 시간(초) — 원작은 해처리·콜로니에서 몇 분에 걸쳐 타일이
 *  번져 나간다(정확한 표는 공개돼 있지 않아 체감치). 시작 본진 해처리는 처음부터 만개. */
const CREEP_SPREAD_SEC = 180;
/* 입체 보기의 바닥 기하 — 모듈 스코프에 둔다(수리: 그림자가 바닥보다 두 배 납작한
   문제). 지형 그림·마커 사영은 컴포넌트 안에서 이 값들을 쓰고, 캔버스의 그림자·
   선택 링은 컴포넌트 밖(UnitLayer)에서 쓴다. 같은 바닥을 두 곳이 따로 알고 있으면
   한쪽만 고쳐지고 다른 쪽은 옛 숫자로 남는다 — 실제로 그렇게 벌어졌다. */
/** 부감 각 — 바닥을 45도로 눕힌다. */
const PITCH_TH = Math.PI / 4;
/** 원근 거리 = 상자 세로 × 이 값. 클수록 원근이 약하고 바닥이 상자를 더 채운다.
 *
 *  1.6 → 4(지적: "3D모드에서 좌우의 땅이 내려가게 기울어진 느낌의 착시") — 진단은
 *  기울기가 아니라 **수렴**이다. 이 사영에서 같은 y의 두 점은 화면에서도 정확히 같은
 *  높이에 놓이므로(posFrac의 fy가 x를 안 탄다) 땅이 실제로 기운 곳은 한 군데도 없다.
 *  다만 1.6에서는 가까운 변이 먼 변보다 **1.60배** 넓어서, 사다리꼴의 좌우 변이 가파르게
 *  안쪽으로 눕는다. 수평선도 하늘도 없는 화면에서 그 사다리꼴은 '가운데가 솟고 양옆이
 *  흘러내리는 언덕'으로 읽힌다 — 착시의 정체가 그 수렴이다.
 *  확대하면 더 심해지는 것도 같은 뿌리다(지적) — 렌즈는 이미 사영된 그림을 화면에서
 *  키우는 것이라(translate(pan) scale(zoom)) 사다리꼴의 기울기는 그대로인데, 확대해
 *  옆으로 밀면 그 **가파른 좌우 변 하나가 화면을 가득 채운다**. 전체를 볼 때는 사각형의
 *  네 변이 서로를 설명해 주지만, 변 하나만 남으면 설명이 사라져 '땅이 흘러내린다'로만
 *  읽힌다. 그래서 값을 조금 낮추는 것으로는 부족하고 수렴 자체를 없애야 한다.
 *
 *  12로 잡는다 — 수렴 1.07배, 좌우 변의 기울기가 세로에서 17.4도 → 2.6도로 내려간다
 *  (4에서는 7.0도라 확대하면 여전히 읽혔다). 바닥 채움도 0.60 → 0.72로 는다.
 *  ★ 원작(스타크래프트)의 화면이 애초에 **평행 투영**이라 수렴이 1.00이다 — 이 값이
 *    클수록 원작에 가깝고, 깊이감은 눕힘(PITCH_FLAT)·건물 높이·그림자·그리는 차례가
 *    그대로 낸다. 원근을 다시 넣고 싶으면 이 상수 하나만 낮추면 된다(4면 1.20배). */
const PITCH_DIST = 12;
/** 바닥 눌림 — 세로가 가로의 몇 할로 보이는가. 바닥에 눕는 것(그림자·선택 링·
 *  트레이서 조준각)은 전부 이 값을 곱해야 지면 격자와 같은 평면에 깔린다. */
const PITCH_FLAT = 0.74;

const pct = (v: number, span: number) => `${(v / span) * 100}%`;


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
/* (걷어냄) 부대 어림 한 벌 — 명령 점을 부대 몇으로 묶고 가르던 상수와 함수(SPIKE_*·
   SQUAD_*·TYPE_MERGE_TILES·BY_UNITS·splitSquads·dropSpikes)다. 개체 트랙이 태그마다
   제 자취를 싣는 지금은 묶고 가를 것이 없다. */
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
/** 띄운 건물의 비행 속도(타일/초) — 착륙 이사와 정찰 비행을 잇는 자다.
 *  원작은 건물 종류를 안 가리고 늘 1픽셀/프레임이라 0.744타일/초다: 이·착륙 오더가 최고
 *  속도를 1로 박고(bwgame.h order_BuildingLiftOff), 오더가 끝날 때의 속도 복원이 건물을
 *  빼놓아 원래 값으로 못 돌아온다. 여태 쓰던 1.2는 근거 없는 어림이라 이사·정찰 비행이
 *  1.6배 빨랐다. */
const BUILDING_FLY_SPEED = FLYING_BUILDING_TPS;
/* (제거) 재생 전용 이름 보강 SCOUT_KO — 유닛별 완성 시각표(unitDoneByRaw)에서 일꾼을
   걸러내는 데만 쓰던 이름표였다. 그 표를 걷으면서 마지막 쓰임이 없어졌다. */
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

/** 건물 발자국(타일 폭·높이) — 원전 표(bwUnits.BUILDING_FOOT = units.dat tileSize)를
 *  그대로 쓴다. 건설 커맨드의 좌표는 발자국의 왼쪽 위 타일이라(스크렙) 그대로 앵커에
 *  놓으면 건물마다 반 발자국씩 왼쪽 위로 치우친다(지적: "맵 안의 요소들은 또 맵의
 *  왼쪽으로 살짝 치우쳤어") — 반 발자국을 더해 가운데에 그린다.
 *  ★ 여기 손으로 적어 두었던 표는 셋이 어긋나 있었다(건물 틈 조사에서 드러났다):
 *    플릿비콘 4×3 → 3×2, 폴백 3×2로 떨어지던 인페스티드 커맨드 4×3·디파일러 마운드 4×2.
 *    자리 계산이 반 타일씩 밀려 있었다는 뜻이다. 이제 표는 한 곳(bwUnits)뿐이다. */
const FOOTPRINT: Record<string, [number, number]> = {
  ...BUILDING_FOOT,
  // screp가 쓰는 변형 이름 — 원전 표의 같은 건물로 잇는다.
  ComSat: BUILDING_FOOT["Comsat Station"],
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
/* (걷어냄) 본진 아바타 실루엣 표 — 맵 위 본진 자리에 아바타를 앉히던 도형(AVATAR_
   HALL_PATHS·AVATAR_ZERG_DECO)이다. 아바타가 맵 밖 로스터 기둥으로 나가면서 그리는
   쪽이 먼저 사라졌고, 표만 남아 있었다. */

/** 여러 면으로 그리는 도형 — [패스, 불투명도, 색?] 목록. 색을 안 주면 currentColor다.
 *  한 색 위에 흰/검 반투명을 겹쳐 밝은 윗면·어두운 옆면을 만든다(입체 사선 뷰). */
/* ── 전면 3D 빌더(요청: 모든 건물·수송선을 3D 도형으로 — 기존 손 작업 대체) ─────────
   전부 project() 기반이라 withYaw로 감싸면 아무 요잉에서나 다시 투영된다.
   표준 시점 결과는 아래 SHAPE_FACES에 한 번 구워 쓴다. */
/** 벌어진 다리 + 원반 발(테란 실물 공통) — 몸통 밑에서 바깥-아래로 뻗고 발판이 받친다. */
function legAndFoot(
  px: number, py: number, zTop: number, lean = 0.1,
): ShapeFace[] {
  /* 테란 건물은 바닥이 떠 있다 — 몸통이 다리 위에 얹히고, 다리는 아래로 내려가
     그 밑에 발판이 달린다.

     ★ 키는 **어느 몸통보다도 뒤**다(지적: 배럭·스타포트·퍼실리티·팩토리 모두 "본체에
     다리가 안 가려짐"). 여태는 몸통 키에 ±0.6을 얹어 앞다리를 몸 앞으로 냈는데,
     그러면 앞다리 기둥이 제 건물 옆구리를 가로질러 그어진다 — 다리가 몸을 뚫고 나온
     것처럼 보이는 이유가 이것이다. 실제로 보여야 하는 것은 몸 실루엣 **아래로** 삐져
     나온 아랫도리뿐이므로, 다리는 언제나 몸 뒤에 두면 된다. 건물마다 키 눈금이 제각각
     (절대 상수 0.4~46, 깊이값 ±13)이라 상대값으로는 이 규칙을 세울 수 없어, 어떤
     몸통 키보다도 낮은 절대값(−40대)에 못 박는다.
     같은 이유로 발판은 다리보다 한 단 더 뒤다(지적: "발판이 다리에 안 가려지는") —
     다리 기둥이 발판 위로 내려꽂히는 꼴이라야 발이 다리를 받치는 것으로 읽힌다.
     앞뒤는 깊이의 **부호**만 쓴다: 앞다리 −40.0/발판 −40.1, 뒷다리 −40.2/발판 −40.3.
     앞 발판(−40.1)이 뒷다리(−40.2)보다 위라 네 다리끼리의 앞뒤도 옳다.

     lean은 내려오면서 바깥으로 벌어지는 정도다(0이면 완전 수직). 위는 안쪽에서
     시작해 아래에서 제자리로 오므로, 붙는 자리가 몸 가장자리여도 top이 몸 안에 물린다.

     기둥 굵기는 한 단 줄였다(지적: "테란 건물 다리들 굵기 조금씩 감소") — 반지름
     0.5→0.42, 끝 0.44→0.36이다. 발판은 그대로 둬 다리가 가늘어진 만큼 발이 더
     또렷하게 받치는 꼴이 된다. */
  const k9 = depthNow(px, py) > 0 ? -40 : -40.2;
  return [
    ...tagKey(paintBase(spirePillar({
      x: 0, y: 0, h: 1, w: 0.42, tipW: 0.36, segs: 1, sides: 6, hold: 0.35, caps: "none",
      path: (t9: number): [number, number, number] => [
        px * (1 - lean + lean * t9), py * (1 - lean + lean * t9), zTop - (zTop - 0.38) * t9,
      ],
    }), "#8b929a"), k9),
    ...tagKey(paintBase(spirePillar({
      x: px, y: py, z0: 0, h: 0.4, w: 0.98, tipW: 0.8,
      segs: 1, sides: 8, hold: 0.45, caps: "both",
    }), "#5d636b"), k9 - 0.1),
  ];
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
/** 성큰이 지금 촉수를 내밀고 있는가(요청: "성큰은 혓바닥 내민 상태 모델링 추가 —
 *  가시가 나오는 타이밍에 이 모양이") — 굽는 동안만 켜지는 깃발이다. 성큰 빌더는 이
 *  값 하나로 촉수 길이를 바꾸고, 아래 sunkenfire가 켠 채로 같은 빌더를 부른다.
 *  currentYaw와 같은 결의 굽기 상태라, 굽기가 끝나면 반드시 도로 끈다. */
let sunkenFire = false;
/* 콜로니류 바닥판 색(지적: "콜로니류 바닥판은 검회색으로") — 성큰·스포어·크립 셋이
   같은 발치를 갖게 한 곳에서 정한다. 여태 스포어만 검회색 받침을 갖고 있었고 성큰·
   크립은 바닥판 자체가 없었다. 크립 얼룩(creepSplat)은 이것과 다른 것이다 — 얼룩은
   면마다 검정(#000)을 박아 두어 paintBase가 아예 안 먹는 반투명 그림자다. */
const COLONY_BASE = "#3a3f46";
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
  /** 끝 단면을 그릴지(지적: "겉면에 안쪽 수평 단면이 가려져야 되는데 안 가려짐") —
   *  다른 기둥 위에 끼우는 토막(띠·이음매)은 두 끝이 모두 남의 몸속에 묻혀 있다.
   *  묻힌 단면은 카메라를 마주 보므로 보임 판정은 참인데, 그 앞을 가리는 것이 '다른
   *  도형'이라 페인터 순서로는 절대 못 가린다. 그런 토막은 "none"으로 아예 끄자. */
  caps?: "both" | "top" | "bottom" | "none";
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
  const walls: {
    d: string; nx: number; ny: number; dep: number;
    /** 끝 단면 표시 — 참이면 아래 faces를 그대로 쓴다(옆면 명암 규칙을 안 탄다). */
    cap?: boolean; faces?: ShapeFace[];
  }[] = [];
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
  /* 끝 단면도 옆면과 같은 줄에 세워 깊이로 정렬한다(지적: "안쪽 수평 단면이 안 가려짐")
     — 여태는 옆면을 다 그린 뒤에 단면을 덧칠했다. 그러면 카메라를 향한 단면이든
     기둥 속을 향한 단면이든 언제나 맨 앞이라, 뒤쪽 끝의 단면이 앞 옆면 위로 떠올라
     기둥이 잘린 것처럼 보였다. 단면의 깊이는 '고리 중심 + 반지름 × 마주보는 정도'다:
     정면으로 열린 단면은 그 끝 옆면들보다 앞이고, 비스듬한 단면은 옆면 사이에 낀다.
     아래 뚜껑의 법선은 -T, 위 뚜껑은 +T다 — 안쪽을 향한 뚜껑은 애초에 안 그린다. */
  const T0 = tangentAt(0);
  const T1 = tangentAt(1);
  const capMode = o.caps ?? "both";
  const addCap = (t: number, n: [number, number, number]): void => {
    const lit = faceLight(n[0], n[1], n[2]);
    if (!lit.visible) return;
    const c9 = axis(t);
    const face = polyPath3(ring(t));
    walls.push({
      d: face, nx: 0, ny: 0, cap: true,
      dep: depthNow(c9[0], c9[1])
        + widthAt(t) * Math.max(0, Math.min(1, facingRatio(n[0], n[1]))) + 0.001,
      faces: [bodyFace(face), ...lit.face(face)],
    });
  };
  if (capMode === "both" || capMode === "bottom") addCap(0, [-T0[0], -T0[1], -T0[2]]);
  if (tipW > 0.01 && (capMode === "both" || capMode === "top")) addCap(1, T1);
  walls.sort((q, w) => q.dep - w.dep);
  for (const wl of walls) {
    if (wl.cap) { out.push(...(wl.faces ?? [])); continue; }
    const fl = faceLight(wl.nx, wl.ny, 0.3);
    // 앞·뒤 색을 따로 받으면 면 법선의 y 부호로 갈라 칠한다(요청).
    const side = wl.ny >= 0 ? o.fillFront : o.fillBack;
    out.push(side ? [wl.d, 1, side] as ShapeFace : bodyFace(wl.d),
      ...(fl.visible ? fl.face(wl.d) : [sideFace(wl.d, 0.42)]));
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
  return faces.map(([d, o, f, k, l]) => [d, o, f ?? IVORY, k, l] as ShapeFace);
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
  return faces.map(([d, o, f, k, l]) => [d, o, f ?? base, k, l] as ShapeFace);
}

/* 종족 바탕색(재작도 규칙) — 테란은 실버, 프로토스는 골드, 저그는 연한 주황이
   몸 전체의 바탕이다(요청: "테란의 은색 프로토스 금색 저그 연한 주황색 모두 기본색이야").
   저그가 여태 빠져 있어서 저그 건물 열일곱은 몸통이 통째로 개인색이었다 — 그래서
   해처리와 히드라 덴이 "같은 색"으로 보였지만 그건 저그 테마색이 아니라 그 임자의
   색이었고, 임자가 바뀌면 함께 바뀌었다. */
/* 세 바탕색은 다 한 단 낮춰 잡았다(요청) — 밝고 쨍한 금속은 위에 얹히는 개인색
   포인트를 잡아먹는다. 바탕이 물러서야 임자 색이 읽힌다.
     테란 #aab1b9 — 마모된 은색. 앞서 #c9ced6은 갓 뽑은 새 금속처럼 희었다.
     토스  #b08e33 — 전투 금색. 앞서 #c9a227은 장식용 순금에 가까웠다.
     저그  #c9835c — 연한 주황과 진한 살색 사이의 장기빛("저그의 그 장기색 같은
                     연한 주황~진한 살색"). 순주황보다 살짝 붉게 기울여 금속 둘과
                     확실히 갈린다.
   밝기는 셋을 나란히 놓고 맞췄다(대략 0.67 / 0.55 / 0.55) — 한 종족만 튀지 않게.
   여기 한 줄만 고치면 그 종족 건물·유닛 전체가 바뀐다. */
/* 테란과 저그만 한 단 더 낮췄다(요청: "더더 어둡게 — 특히 테란이 밝아 / 프로토스는
   괜찮"). 앞서 한 번 낮춘 값도 화면에서는 여전히 흰끼가 돌아, 위에 얹는 개인색이
   바탕에 묻혔다 — 은색이 제일 심했다. 토스 금색은 이미 알맞다고 해 그대로 둔다.
     테란 #aab1b9 → #6c737b  (가장 크게 낮춘다)
     저그 #c9835c → #935c3e
     토스 #b08e33 그대로
   그 뒤 테란만 다시 한 번 조정했다(요청: "좀더 실버에 가까운 iron 컬러") — #6c737b은
   푸른끼가 도는 회색이라 강철보다 콘크리트에 가까웠다. #868d94는 한 단 밝으면서
   중립에 가까워, 은빛 쇠붙이로 읽힌다. */
const RACE_BASE_TONE = { terran: "#868d94", toss: "#c9a63f", zerg: "#935c3e" } as const;
/** 몸에는 종족 바탕색을 입히고, 뒤에 붙이는 accent 면만 개인색으로 남긴다(규칙 1·4).
 *  accent는 칠하지 않은 채로 두어야 그리는 쪽이 임자 색을 넣는다 — 건물마다 눈에 띄는
 *  한두 곳만. */
function raceBase(
  faces: ShapeFace[], tone: keyof typeof RACE_BASE_TONE, accent: ShapeFace[] = [],
): ShapeFace[] {
  const painted = paintBase(faces, RACE_BASE_TONE[tone]);
  /* 프로토스만 금속 광을 세게 준다(요청: "프로토스 기본색 좀더 밝게하고 메탈 느낌나게
     표현할수 없나"). 바탕색만 밝히면 노란 물감이 될 뿐 금속이 안 된다 — 이 렌더러에서
     금속은 색이 아니라 **명암 차**로 읽힌다. 면마다 얹히는 흰 광(#fff)을 1.7배로 올려
     하이라이트를 날카롭게 하고 검은 그늘(#000)은 1.25배만 깊게 해, 밝은 쪽이 확 튀고
     어두운 쪽은 완전히 죽지 않는 금속 대비를 만든다. 테란·저그는 그대로다 — 셋이 같은
     광을 받으면 종족이 안 갈린다. */
  /* 테란 광택을 프로토스와 **같게**(요청) — 1.32/1.1로 은은하게 두었더니 강철이
     콘크리트처럼 무광이었다. 이제 둘 다 1.7/1.25다: 흰 광은 쨍하게 올리고 검은 그늘은
     덜 깊게 해, 밝은 쪽이 확 튀고 어두운 쪽은 안 죽는 금속 대비가 된다. 종족은 이제
     광이 아니라 바탕색(은색 대 금색)이 가른다. 저그는 유기체라 광을 안 준다.
     raceBase는 건물·유닛을 안 가리므로 테란 유닛의 금속도 함께 밝아진다 — 같은 재질을
     한 종족 안에서 둘로 나눌 이유는 없다. */
  const GLOSS: Partial<Record<keyof typeof RACE_BASE_TONE, [number, number]>> = {
    toss: [1.7, 1.25],
    terran: [1.7, 1.25],
  };
  const g9 = GLOSS[tone];
  const lit = g9
    ? painted.map(([d, o, f, k, l]) => (f === "#fff" || f === "#000"
      ? [d, Math.min(0.9, o * (f === "#fff" ? g9[0] : g9[1])), f, k, l] as ShapeFace
      : [d, o, f, k, l] as ShapeFace))
    : painted;
  return [...lit, ...accent];
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
    /* 지적: "해처리 본체 색은 짙은 살색? 연한 주황색 -> 이건 저그테마색이고 히드라덴
       막과 같은색임. 통일하되" — 여태 둔덕을 칠하지 않아 임자 색이 통째로 칠해졌다.
       히드라덴의 막도 같은 사정(칠하지 않은 면)이라 둘이 늘 같은 색으로 보였던 것이
       맞다. 다만 그건 저그 테마색이 아니라 그때 그 임자의 색이었고, 임자가 바뀌면
       함께 바뀌었다. 이제 몸은 저그 테마 바탕색 하나로 고정하고, 임자 색은 아래
       옆선 띠가 맡는다. 색은 RACE_BASE_TONE.zerg를 그대로 쓴다 — 사용자가 말한
       "짙은 살색? 연한 주황색"이 곧 이 상수이고, 색값을 여기 또 박으면 저그 테마색이
       두 곳이 되어 다음에 한쪽만 바뀐다. */
    out.push(...tagKey(paintBase(spirePillar({
      x: 0, y: 0, z0: 0, h: MND_H, w: MND_RB, tipW: MND_RT,
      segs: 9, sides: 16, hold: 0, taper: MND_P,
    }), RACE_BASE_TONE.zerg), 0));
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
        /* 옆선의 축과 굵기를 식으로 꺼내 둔다 — 아래 개인색 띠가 같은 식을 써야
           기둥에 어긋나지 않고 딱 물린다(따로 눈대중하면 요잉마다 어긋난다). */
        const SEAM_W = 0.92;
        const SEAM_TIP = 0.4;
        const SEAM_HOLD = 0.08;
        const seamAxis = (t9: number): [number, number, number] => {
          const r9 = moundR(t9) * 0.99;
          return [dxr * r9, dyr * r9, MND_H * t9];
        };
        const seamW = (t9: number): number => (t9 <= SEAM_HOLD ? SEAM_W
          : SEAM_TIP + (SEAM_W - SEAM_TIP) * (1 - (t9 - SEAM_HOLD) / (1 - SEAM_HOLD)) ** 1.6);
        const seamPillar = spirePillar({
          // 밑동은 굵게 열고 위로 갈수록 가늘게 — 아래 단면이 곧 입구다.
          x: 0, y: 0, h: 1, w: SEAM_W, tipW: SEAM_TIP,
          segs: 8, sides: 6, hold: SEAM_HOLD, taper: 1.6,
          // 둔덕 옆선을 그대로 타는 축 — 표면에 반쯤 묻혀 한 몸으로 이어진다.
          path: seamAxis,
          fill: seamColor,
        });
        /* 캐노피·동그라미 입구 표현 모두 제거(재지적) — 옆면 기둥의 굵게 열린 아래
           단면 자체가 들머리 노릇을 한다. */
        out.push(...tagKey(seamPillar, dep * 1.6));
        /* 지적: "통일하되 옆선기둥들 중간중간에 개인색 띠 넣기" — 몸통을 테마색
           하나로 굳히면 임자 색이 갈 데가 없어진다. 옆선 기둥의 같은 축 위에 짧은
           마디 셋을 한 뼘(1.16배) 굵게 끼워 넣었다: 여섯 옆선이 60도로 둘러서 있어
           어느 요잉에서도 앞으로 돌아온 두어 개가 임자 색을 보여 준다.
           색을 주지 않는 것이 곧 개인색이다 — 여기서 fill을 주면 고정색이 되어
           지적이 뒤집힌다. 등급도 매기지 않는다(형체 1) — 작게 구운 판에서도 남는다.
           해처리·레어·하이브가 이 함수를 함께 쓰므로 띠 자리는 셋 다 같고, 옆선 색이
           검회색(해처리·레어)이든 진한 상아(하이브)든 임자 색과 갈린다. */
        /* 마디는 통이 아니라 **앞을 향한 면만** 그린다(지적: "개인색 포인트 부분
           단면이 밖으로 비쳐보여").
           원인은 캡이 아니었다. 여태 마디를 기둥보다 굵은 spirePillar 토막으로 끼워
           넣었는데, 그 함수는 **뒷면을 안 걷어낸다** — 여섯 옆벽을 깊이순으로 다 그린다.
           마디가 기둥보다 굵으니 뒤쪽 옆벽이 기둥 실루엣 안에 들어오고, 마디가 기둥보다
           **나중에** 그려지므로(같은 키, 뒤 차례) 그 뒷벽이 기둥 겉면 위에 얹혔다.
           보는 사람에게는 속이 비쳐 보이는 단면이다. caps를 꺼도 안 없어지는 이유가 이것이다.
           이제 마디를 손수 짠다: 축을 따라 여섯 조각으로 나누고, 바깥 법선이 카메라를
           향한 조각만 그린다. 뒷면이 애초에 없으니 비칠 것도 없다. 가운데를 1.16배로
           부풀리고 두 끝은 기둥 굵기 그대로라 이음매도 안 보인다.
           색을 안 주는 것이 곧 개인색이다(fill을 주면 고정색이 되어 지적이 뒤집힌다). */
        for (const [t0, t1] of [[0.2, 0.35], [0.45, 0.6], [0.7, 0.85]] as [number, number][]) {
          const tm = (t0 + t1) / 2;
          const A9 = seamAxis(t0);
          const M9 = seamAxis(tm);
          const B9 = seamAxis(t1);
          const axv = B9[0] - A9[0];
          const ayv = B9[1] - A9[1];
          const azv = B9[2] - A9[2];
          const L9 = Math.hypot(axv, ayv, azv) || 1;
          const tX = axv / L9;
          const tY = ayv / L9;
          const tZ = azv / L9;
          /* 단면을 세울 두 벡터 — 축이 거의 수직이라 수평면에서 잡으면 충분하다. */
          let uX = -tY;
          let uY = tX;
          let uZ = 0;
          const uL = Math.hypot(uX, uY, uZ);
          if (uL < 1e-3) { uX = 1; uY = 0; uZ = 0; } else { uX /= uL; uY /= uL; uZ /= uL; }
          const vX = tY * uZ - tZ * uY;
          const vY = tZ * uX - tX * uZ;
          const vZ = tX * uY - tY * uX;
          const N9 = 6;
          const ring = (
            P9: [number, number, number], r9: number, i9: number,
          ): [number, number, number] => {
            const a9 = (i9 / N9) * Math.PI * 2;
            const c9 = Math.cos(a9);
            const s9 = Math.sin(a9);
            return [
              P9[0] + (uX * c9 + vX * s9) * r9,
              P9[1] + (uY * c9 + vY * s9) * r9,
              P9[2] + (uZ * c9 + vZ * s9) * r9,
            ];
          };
          const rA = seamW(t0);
          const rM = seamW(tm) * 1.16;
          const rB = seamW(t1);
          for (let i9 = 0; i9 < N9; i9 += 1) {
            const am = ((i9 + 0.5) / N9) * Math.PI * 2;
            const cm = Math.cos(am);
            const sm = Math.sin(am);
            if (facingRatio(uX * cm + vX * sm, uY * cm + vY * sm) <= 0.06) continue;
            const lo = polyPath3([
              ring(A9, rA, i9), ring(A9, rA, i9 + 1), ring(M9, rM, i9 + 1), ring(M9, rM, i9),
            ]);
            const hi9 = polyPath3([
              ring(M9, rM, i9), ring(M9, rM, i9 + 1), ring(B9, rB, i9 + 1), ring(B9, rB, i9),
            ]);
            out.push(...tagKey([
              bodyFace(lo), bodyFace(hi9), topFace(hi9, 0.16),
            ], dep * 1.6));
          }
        }
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
  /* 커맨드 센터(재작도 — 사진 기준, 기존 비율·자세는 그대로) ─────────────────────
     여태 선체 전체가 개인색이라 종족이 안 읽히고 팀마다 딴 건물처럼 보였다. 테란의
     바탕은 실버다: 3단 원반 선체를 은빛~강철빛으로 깔고, 그 위에 검회색 장갑 패널과
     유리창, 호박색 항행등, 노랑·검정 안전 빗금을 얹는다. 개인색은 딱 두 곳 —
     선체 허리띠와 관제 돔이다(과하지 않게, 그러나 확실히 보이게).
     키값은 한 자로: 몸통 부품은 제 자리의 depthNow×1.6, 지붕에 얹힌 것만 상수. */
  tomb: () => {
    /* 지역 은·강철도 새 테란 바탕(#7d848c)에 맞춰 낮췄다 — 커맨드만 예전 흰 은색으로
       두면 이 건물 하나가 화면에서 튄다. */
    const SILVER = "#8b929a";
    const STEEL = "#626871";
    /** 굴뚝용 어두운 은색(요청) — 구리였던 것을 어두운 금속으로 바꾼다. */
    const DARKSIL = "#4e545c";
    const GLASS = "#7fd4e8";
    const LAMP = "#ffb347";
    /* 구리는 '가장자리'가 아니라 '큰 면'으로 간다(지적: "구리색 테두리는 돔 양쪽 옆에
       큰 세로띠로 넣어주고 돔 꼭대기 사각형물체도 구리색으로") — 사진의 커맨드는 돔
       좌우에 넓은 청동 판이 붙고 꼭대기 관제실이 통째로 청동이다. 여태처럼 창틀·링에만
       실선으로 두르면 축소하면 사라져 포인트 노릇을 못 한다. */
    /* 살짝 더 붉고 어둡게(요청) — #b87333은 주황에 가까워 은색 선체 위에서 튀었다. */
    const COPPER = "#9c5528";
    /* 발은 공용 규칙을 쓴다(재지적: "커맨드 센터는 바닥이 약간 띄워져있는 구조야 …
       다리는 자연스럽게 거의 수직으로 아래로 향하고 그 밑에 발판이 달리는 거야").
       여태 이 건물만 제 다리를 따로 갖고 있었고 그것이 바깥·아래로 눕혀 뻗는 팔이라
       몸이 땅에 주저앉아 보였다. 배럭·팩토리·스타포트·퍼실리티와 같은 legAndFoot을
       쓴다 — 거의 수직으로 내려가는 각진 다리와 그 밑의 팔각 발판이다. */
    /** 선체가 지면에서 뜨는 높이 — 이 틈이 곧 다리 길이다. 0.72로는 다리가 겨우
     *  0.34밖에 안 보여, 발판만 따로 놓인 것처럼 읽혔다(지적: "몸체와 다리가 멀리
     *  떨어져있어"). 1.15면 다리가 제 길이로 선다. */
    const HULL_Z = 1.15;
    /** 다리 자리 — 선체 반지름(5.4)보다 한참 안쪽이다(지적: "다리가 몸체 안쪽으로
     *  붙어야해"). 4.55는 테에 가까워 다리가 옆구리에 매달린 꼴이었다. */
    const POD_R = 3.55;
    /* 다리 키는 선체보다 **아래**다(지적: "커맨드 다리 아직도 비치는데"). keyBase 0.5는
       앞다리를 1.1로 올려 선체 단(0.4·0.5·0.6)보다 앞세웠고, 그래서 다리 기둥이 치마
       위로 그어져 몸을 뚫고 비쳤다. 커맨드의 선체는 다리 자리(반지름 5.02)를 통째로
       덮는 넓은 원반이라 네 다리 모두 뒤로 가야 옳다 — 그러면 선체 실루엣 아래로
       삐져나온 아랫도리와 발판만 보인다. keyBase −1이면 앞 −0.4, 뒤 −1.6이라 모든
       단 밑이다. lean은 아주 조금만(요청: "완전 수직은 아니고 살짝 바깥"). */
    const out: ShapeFace[] = [
      ...legAndFoot(-POD_R, -POD_R, HULL_Z + 0.25, 0.035),
      ...legAndFoot(POD_R, -POD_R, HULL_Z + 0.25, 0.035),
    ];
    /* 받침 세 단 — 반지름 5.4의 은색 원반. 높이를 1/3로 낮췄다(요청) — 2.47이던 것이
       0.82다. 사진의 선체도 두툼한 통이 아니라 얇은 원반이고, 통이 높으면 그 위의
       층진 돔이 눌려 보인다. 발(pod)도 같은 비로 낮춰야 발이 몸보다 높아지지 않는다. */
    /* 선체를 지면에서 띄운다(재지적) — 여태 밑판이 z0에서 시작해 몸이 땅에 앉아
       있었고, 그래서 다리가 설 자리가 없어 실루엣 안에 묻혔다. HULL_Z만큼 올려
       그 틈이 곧 다리의 키가 된다. */
    out.push(...tagKey(paintBase(spirePillar({
      x: 0, y: 0, z0: HULL_Z, h: 0.8, w: 5.15, tipW: 5.4,
      segs: 1, sides: 16, hold: 0, taper: 1, caps: "bottom",
    }), SILVER), 0.4));
    out.push(...tagKey(paintBase(spirePillar({
      x: 0, y: 0, z0: HULL_Z + 0.8, h: 0.14, w: 5.16, tipW: 5.16,
      segs: 1, sides: 16, hold: 0.5, caps: "none",
    }), STEEL), 0.5));
    out.push(...tagKey(paintBase(spirePillar({
      x: 0, y: 0, z0: HULL_Z + 0.94, h: 0.28, w: 5.4, tipW: 5.34,
      segs: 1, sides: 16, hold: 0.5, caps: "top",
    }), SILVER), 0.6));
    /* 받침 윗면 테두리는 은색이다. 여태 여기 구리 링을 5.62로 둘렀는데, 돔 밑을
       4.9로 좁히자 그 링이 통째로 드러나 '청동 챙을 두른 접시'가 됐다. 구리는 요청대로
       돔 옆 세로띠와 꼭대기 상자 둘로 몰고, 이 자리는 강철 테두리만 남긴다. */
    out.push(...tagKey(paintBase(spirePillar({
      x: 0, y: 0, z0: HULL_Z + 1.1, h: 0.12, w: 5.46, tipW: 5.46,
      segs: 1, sides: 16, hold: 0.5, caps: "none",
    }), STEEL), 1.6));

    /* ── 층진 돔(요청: "돔을 한번 윗둥을 자르고 그위에 또 돔을 얹는식으로 층을") ──
       사진의 커맨드는 매끈한 밥그릇 하나가 아니라 계단이다: 넓은 아랫단의 윗둥이
       잘려 갑판이 되고 그 갑판 위에 좁은 돔이 한 겹 더 앉는다. 아랫단은 잘린 원뿔
       (spirePillar)로 낸다 — 그 함수의 w가 곧 반지름이고 taper 0.65가 아래는 완만·
       위는 급한 옆선을 준다. 잘린 윗면(caps "top")이 그대로 둘째 단의 갑판이다.
       돔 밑을 받침(5.4)보다 좁은 4.9로 잡은 것은 사진처럼 둘레에 테두리 갑판을
       남기기 위해서다 — 아래 입구 구조물과 그릇들이 그 갑판 위에 앉는다. */
    const DOME_Z = HULL_Z + 1.22;   // 받침 윗면 = 돔 밑
    /* 2층 기둥 높이 — 2.78에서 20% 낮춘 값이다(요청). "안 커보여"(지적)로 잠깐 2.75로
       되돌렸다가 **원복했다**(지적: "커맨드 높이는 원복해줘 일부러 맞춘 비율이야").
       크기는 이 비율이 아니라 다른 자리에서 본다 — 도록이 건물 정규화를 안 태우고 있던
       것이 그 지적의 진짜 원인이었다(ShapeIcon 주석). */
    const T1_H = 2.22;
    const T1_RB = 4.9;        // 아랫단 밑 반지름
    const T1_RT = 3.55;       // 아랫단 잘린 윗 반지름
    /* 아래쪽을 더 수직에 가깝게(요청) — 폭을 그대로 쥐는 구간(hold)을 늘리고 taper를
       낮춘다. taper가 작을수록 밑에서는 완만히, 위로 갈수록 급히 좁아진다. */
    const T1_HOLD = 0.2;
    const T1_TAPER = 0.42;
    const T2_Z = DOME_Z + T1_H;   // 4.07 — 갑판
    /** 아랫단 겉면의 반지름 — 데칼·구리띠를 돔 살에 딱 붙이려면 같은 식을 써야 한다. */
    const t1R = (z: number): number => {
      const t = Math.max(0, Math.min(1, (z - DOME_Z) / T1_H));
      if (t <= T1_HOLD) return T1_RB;
      const k = (t - T1_HOLD) / (1 - T1_HOLD);
      return T1_RT + (T1_RB - T1_RT) * (1 - k) ** T1_TAPER;
    };
    /* 키를 손수 매긴다(수리: 돔이 통째로 구리로 보였다) — spirePillar는 제 몸 전체에
       depthNow(x,y) 하나를 매기는데 중심(0,0)의 그 값이 구리 이음 링의 키(1.6)보다
       낮았다. 그래서 링의 윗판(반지름 5.62짜리 원반)이 돔 위에 그려져 돔을 통째로
       덮어 버렸다 — 색이 바뀐 게 아니라 가려진 것이었다. 링 뒤에 세운다. */
    out.push(...tagKey(paintBase(spirePillar({
      x: 0, y: 0, z0: DOME_Z, h: T1_H, w: T1_RB, tipW: T1_RT,
      segs: 4, sides: 14, hold: T1_HOLD, taper: T1_TAPER, caps: "top",
    }), SILVER), 2));
    // 둘째 단 — 갑판 위에 얹은 좁은 돔. 아랫단보다 뒤에 서면 안 되니 한 칸 위다.
    /* 3층 돔의 바닥은 2층 돔의 옥상보다 좁아야 한다(요청) — 그래야 잘린 옥상면이
       고리처럼 아주 살짝 드러나 '층'이 눈에 잡힌다. 0.45만 좁힌다. */
    out.push(...tagKey(paintBase(spirePillar({
      /* 3층은 절반쯤에서 싹 잘린 토막이다(요청) — 뾰족하게 모으지 않고 넓은 윗면을
         그대로 남겨, 그 위에 앉는 관제 모듈의 받침이 되게 한다. */
      x: 0, y: 0, z0: T2_Z, h: 0.85, w: T1_RT - 0.45, tipW: 2.28,
      segs: 3, sides: 14, hold: 0.08, taper: 0.62, caps: "top",
    }), SILVER), 8));

    /* 돔 양옆 큰 구리 세로띠(요청) — 평평한 네모로 붙이면 모서리가 돔 밖으로
       삐져나오므로(현 5도짜리 활을 네모가 못 따라간다) 호를 여러 마디로 나눈
       띠로 낸다. 좌우 두 자리(±90도)에만 넣어 '양쪽 옆'이라는 말 그대로다. */
    const arcBand = (
      aMid: number, half: number, rB: number, rT: number, zB: number, zT: number,
    ): string => {
      const pts: [number, number, number][] = [];
      const N = 7;
      for (let i = 0; i <= N; i += 1) {
        const a = aMid - half + (half * 2 * i) / N;
        pts.push([Math.sin(a) * rB, Math.cos(a) * rB, zB]);
      }
      for (let i = N; i >= 0; i -= 1) {
        const a = aMid - half + (half * 2 * i) / N;
        pts.push([Math.sin(a) * rT, Math.cos(a) * rT, zT]);
      }
      return polyPath3(pts);
    };
    for (const side9 of [1, -1]) {
      const aMid = (side9 * Math.PI) / 2;
      const sx9 = Math.sin(aMid);
      const sy9 = Math.cos(aMid);
      if (facingRatio(sx9, sy9) <= 0.02) continue;
      /* 좁고 긴 세로줄이다(요청: "세로로 길게 2층 위에서 아래로 칠한다는 느낌") —
         2층 기둥 꼭대기에서 밑동까지 한 번에 내리긋는다. 앞서 위쪽만 짧게 칠했더니
         띠가 아니라 얼룩으로 보였다. 폭은 좁은 채로 두고(반각 0.26) 길이만 늘린다. */
      const zB = DOME_Z + 0.04;
      const zT = T2_Z - 0.04;
      out.push(...tagKey([
        [arcBand(aMid, 0.26, t1R(zB) + 0.03, t1R(zT) + 0.03, zB, zT), 1, COPPER] as ShapeFace,
        topFace(arcBand(aMid, 0.245, t1R(zT - 0.3) + 0.05, t1R(zT) + 0.05, zT - 0.3, zT), 0.22),
      ], 2.2));
    }

    /* 개인색 데칼(요청: "사진처럼 좀 긴 직사각형 형태고 사이사이는 멀리 떨어뜨려야해
       구리색 테두리도 없고") — 여태는 창틀을 두른 가로로 넓적한 판 열둘이 촘촘히
       둘러 '창문 띠'였다. 사진의 그것은 돔 살에 길쭉하게 박힌 세로 판이고 사이가
       넓게 비어 있다. 가로 1.9 → 0.84, 세로 1.24 → 1.35로 바꿔 세로가 긴 직사각형이
       되게 하고 구리 테두리는 걷었다. 색을 안 주면 임자 색이 칠해진다.
       개수는 여덟 → 열둘이다(요청: 1.5배로 더 촘촘히) — 판 폭은 그대로 둬 사이가
       좁아질 뿐 판이 서로 붙지는 않는다. */
    for (let w9 = 0; w9 < 12; w9 += 1) {
      const a9 = ((w9 + 0.5) / 12) * Math.PI * 2;
      const sx9 = Math.sin(a9);
      const sy9 = Math.cos(a9);
      if (facingRatio(sx9, sy9) <= 0.08) continue;
      const tx9 = Math.cos(a9);
      const ty9 = -Math.sin(a9);
      /* 데칼을 위로 올린다(요청) — 맨 밑까지 이어지는 띠가 아니라 기둥 중턱에서
         끊기는 판이다. 아래를 1.05만큼 띄워 밑판·테두리에 안 닿게 한다. */
      const zB = DOME_Z + 1.05;
      const zT = T2_Z - 0.12;
      const seal = (rB: number, rT: number, hw: number): string =>
        polyPath3([
          [sx9 * rB - tx9 * hw, sy9 * rB - ty9 * hw, zB],
          [sx9 * rB + tx9 * hw, sy9 * rB + ty9 * hw, zB],
          [sx9 * rT + tx9 * hw, sy9 * rT + ty9 * hw, zT],
          [sx9 * rT - tx9 * hw, sy9 * rT - ty9 * hw, zT],
        ]);
      out.push(...tagKey([
        bodyFace(seal(t1R(zB) + 0.02, t1R(zT) + 0.02, 0.42)),
        topFace(seal(t1R(zT - 0.3) + 0.04, t1R(zT) + 0.04, 0.42), 0.2),
      /* 키는 2층 기둥(2) 바로 위 고정값이다(요청: "데칼은 2층 기둥에 완전 부착") —
         자리별 depthNow를 태우면 뒤쪽 데칼이 3층 기둥(8)보다 앞서거나 뒤서며 떠 보였다.
         앞을 향한 것만 그리므로 한 값이면 충분하다. */
      ], 2.4));
    }

    /* 통신 접시 — 잘린 갑판(T2_Z) 위에 선다. 여태 (3.2,−2.1)이었는데 돔이 좁아지며
       갑판 밖으로 밀려나 허공에 뜬다 — 갑판 반지름(3.55) 안쪽으로 당겼다. */
    out.push(...tagKey([
      ...paintBase(spirePillar({
        x: 2.5, y: -1.65, z0: T2_Z, h: 1.05, w: 0.85, tipW: 0.85,
        segs: 1, sides: 10, hold: 0.5, caps: "none",
      }), DARKSIL),
      [discPath3(2.5, -1.65, T2_Z + 1.05, 0.84), 1, STEEL] as ShapeFace,
      capFace(discPath3(2.5, -1.65, T2_Z + 1.09, 0.6), 0.5),
    ], 30));

    /* 관제 모듈 — 꼭대기의 사각형 물체. 요청대로 통째로 구리다. 밑동 스커트는 강철로
       남겨 둬야 구리 상자가 어디서 시작하는지 눈에 잡힌다(둘 다 구리면 한 덩어리로
       뭉개진다). */
    const MOD_Z = T2_Z + 0.85;   // 3층 기둥 꼭대기(잘린 면)
    /* 구리 상자 아래 회색 받침판을 키운다(요청: "그 회색 상자도 더 확대해야함 너비와
       높이 모두") — 캐노피 위의 짐과 이 판이 맞닿는 자리라 판이 작으면 짐이 허공에
       걸린 것처럼 보인다. 3.2×2.85×0.26 → 4.05×3.5×0.5(한 번 키웠다가 조금 줄인 값). */
    out.push(...tagKey(paintBase(boxFaces3(0, 0.2, 4.05, 3.5, 0.5, MOD_Z - 0.46), STEEL), 30.6));
    out.push(...tagKey(paintBase(boxFaces3(0, 0.2, 2.6, 2.25, 1.48, MOD_Z), COPPER), 31));
    /* 앞면 장식(창)은 앞이 보일 때만 — 뒤로 돌린 각도에서도 그리면 몸 위로 떠올라
       팔처럼 삐져나와 보였다. */
    const frontVisible = faceLight(0, 1).visible;
    if (frontVisible) {
      out.push(...tagKey([
        [polyPath3([[-1.08, 1.33, MOD_Z + 0.34], [1.08, 1.33, MOD_Z + 0.34],
          [1.08, 1.33, MOD_Z + 1.0], [-1.08, 1.33, MOD_Z + 1.0]]), 1, GLASS] as ShapeFace,
        topFace(polyPath3([[-1.08, 1.34, MOD_Z + 0.82], [1.08, 1.34, MOD_Z + 0.82],
          [1.08, 1.34, MOD_Z + 1.0], [-1.08, 1.34, MOD_Z + 1.0]]), 0.4),
      ], 32));
    }
    // 꼭대기 — 구리 링 위의 작은 은색 돔.
    const TOP_Z = MOD_Z + 1.48;
    out.push(...tagKey(paintBase(cylinderFaces3(0, 0.2, 1.22, 0.16, TOP_Z), COPPER), 32.6));
    out.push(...tagKey(paintBase(domeFaces3(0, 0.2, 0.98, 0.72, TOP_Z), SILVER), 33));

    /* 선체 둘레 장갑 패널 상자 열 개는 걷었다(요청: "아래쪽에 달린 상자모양들은 다
       제거해도 될듯") — 돔이 층으로 갈리며 실루엣이 이미 복잡해져, 밑동의 상자들이
       테두리를 톱니처럼 만들고 있었다. 그 사이에 켜져 있던 호박색 항행등만 남긴다:
       등은 상자가 아니라 선체에 박힌 점이고, 밤바다의 배처럼 둘레를 읽게 해 준다. */
    for (let k9 = 0; k9 < 10; k9 += 2) {
      const a9 = ((k9 + 0.5) / 10) * Math.PI * 2;
      const sx9 = Math.sin(a9);
      const sy9 = Math.cos(a9);
      if (facingRatio(sx9, sy9) <= 0.05) continue;
      out.push(...tagKey(paintBase(
        cylinderFaces3(sx9 * 5.06, sy9 * 5.06, 0.2, 0.14, HULL_Z + 0.42), LAMP,
      ), depthNow(sx9 * 5.3, sy9 * 5.3) * 1.6 + 2));
    }

    /* 입구 구조물(요청: "입구 위로 캐노피느낌(은색)과 그 위에 상자형태(은색)와 작은
       드럼통 배치, 입구 양 옆에 그릇 뒤집은거 같은 모양") — 돔 밑을 받침보다 좁게
       잡아 남긴 테두리 갑판이 이것들의 자리다. 캐노피는 돔 살에 등을 붙이고 앞으로
       내려오는 판이라, 뒷변은 그 높이의 돔 반지름(t1R)에 맞춰 붙인다. */
    /* 캐노피는 판때기가 아니라 두께 있는 지붕이다 — 평면 사각 하나로 내면 어느 각도에서
       보나 종잇장이 앞으로 뻗은 꼴이라 '차양'으로 안 읽혔다. 얇은 상자로 두께를 주고
       앞 두 귀에 기둥을 세워, 진입로 위에 걸친 현관 지붕이 되게 한다. */
    /* 현관을 위로 팍 올린다(요청) — 받침 바로 위에 얹혀 있어 진입로에 눌려 있었다.
       2층 기둥 중턱 높이로 올리고, 지붕과 그 위 짐(상자·드럼통) 사이에 눈에 보이는
       갭을 둔다(요청) — 붙여 놓으면 한 덩어리로 뭉개진다. */
    /* 현관 지붕을 2층 옥상 높이에 맞춘다(요청) — 잘린 갑판과 같은 켜라야 지붕이
       기둥에서 뻗어 나온 것으로 읽힌다. 폭도 줄였다(3.4 → 2.5). */
    const CANOPY_Z = T2_Z;
    out.push(...tagKey(paintBase(boxFaces3(0, 4.75, 2.5, 2.1, 0.24, CANOPY_Z), SILVER),
      depthNow(0, 4.75) * 1.6 + 7));
    for (const cx9 of [-0.95, 0.95]) {
      out.push(...tagKey(paintBase(cylinderFaces3(cx9, 4.6, 0.14, CANOPY_Z - DOME_Z, DOME_Z), STEEL),
        depthNow(cx9, 4.6) * 1.6 + 6));
    }
    /* 상자와 드럼통은 3층 기둥 옆구리에 붙인다(요청: "캐노피 위 상자랑 드럼통 파묻힘
       3층 돔에 붙이기") — 지붕 위에 얹어 두니 지붕과 받침판 사이에 끼어 파묻혔다.
       2층 옥상(갑판) 위, 3층 기둥의 밑동 겉면에 등을 대고 선다: 그 자리의 기둥
       반지름이 T1_RT − 0.45이므로 상자 뒷변이 그 원에 닿는 y를 풀어 놓는다.
       둘은 서로 딱 붙고(상자 오른변에 드럼통 왼끝), 윗면은 4층 판 밑면에 닿는다. */
    /* 둘을 3층 기둥 옆구리를 따라 **더 위로** 올린다(요청: "상자와 드럼통 둘다 좀더
       돔의위쪽에 배치") — 여태는 2층 갑판(T2_Z)에 바로 앉아 받침판 밑에 낀 서랍처럼
       보였다. 0.3만큼 띄우고 키를 0.6으로 늘리면 윗면이 구리 상자 받침판 켜에 올라와
       기둥 중턱에 붙은 짐으로 읽힌다. 다만 3층 기둥은 위로 갈수록 좁아지므로 등을
       댈 반지름도 그 높이의 값이어야 한다 — t3R이 3층 spirePillar와 같은 식이다. */
    const T3_RB = T1_RT - 0.45;
    const t3R = (z: number): number => {
      const t = Math.max(0, Math.min(1, (z - T2_Z) / 0.85));
      if (t <= 0.08) return T3_RB;
      const k = (t - 0.08) / 0.92;
      return 2.28 + (T3_RB - 2.28) * (1 - k) ** 0.62;
    };
    const LOAD_Z = T2_Z + 0.3;
    const LOAD_H = 0.6;
    const T3_R = t3R(LOAD_Z);
    const boxHX = 0.92;
    const boxHY = 0.78;
    /* 상자는 정면 한가운데다(요청: "상자를 가운데 정면배치") — 왼쪽으로 1.1 밀려 있어
       현관·경사로와 축이 어긋나 보였다. 드럼통은 그 오른쪽에 딱 붙는다. */
    const boxCX = 0;
    const boxCY = Math.sqrt(Math.max(0.01, T3_R * T3_R - boxCX * boxCX)) + boxHY - 0.35;
    out.push(...tagKey(paintBase(boxFaces3(boxCX, boxCY, boxHX * 2, boxHY * 2, LOAD_H, LOAD_Z), SILVER),
      depthNow(boxCX, boxCY) * 1.6 + 9));
    const drumX = boxCX + boxHX + 0.46;
    const drumY = Math.sqrt(Math.max(0.01, T3_R * T3_R - drumX * drumX)) + 0.42 - 0.35;
    out.push(...tagKey(paintBase([
      ...cylinderFaces3(drumX, drumY, 0.42, LOAD_H, LOAD_Z),
      ...cylinderFaces3(drumX, drumY, 0.46, 0.08, LOAD_Z + LOAD_H - 0.08),
    ], SILVER), depthNow(drumX, drumY) * 1.6 + 9));
    // 입구 양옆 — 엎어 놓은 그릇. 돔 밑(4.9)과 받침 테(5.4) 사이 갑판에 박힌다.
    for (const bx9 of [-3.95, 3.95]) {
      out.push(...tagKey(paintBase([
        ...cylinderFaces3(bx9, 3.2, 0.9, 0.1, DOME_Z - 0.08),
        ...domeFaces3(bx9, 3.2, 0.84, 0.64, DOME_Z + 0.02),
      ], SILVER), depthNow(bx9, 3.2) * 1.6 + 4));
    }

    /* 입구 왼쪽 갑판 두 판은 걷었다(요청) — 통로 판과 그 끝 난간이었는데, 현관 지붕이
       들어오면서 앞이 붐볐고 두 판이 몸에서 떨어져 나온 조각처럼 보였다. */
    if (frontVisible) {
      // 진입로 — 데칼 없는 작은 은판 하나.
      /* 진출 경사로는 **2층 바닥에서 시작해 지면으로 내려온다**(지적) — 여태 받침
         옆구리에 붙은 짧은 판이라 어디서 나오는 길인지가 안 읽혔다. 2층 기둥의
         밑동(DOME_Z)에서 출발해 앞으로 뻗으며 지면(0)에 닿는다. */
      /* 길이·폭 모두 줄였다(요청: "진입로 길이및 폭 축소") — 7.35까지 뻗고 아래가
         2.7이나 벌어져 건물보다 길이 먼저 눈에 들었다. 6.3까지, 폭은 1.56→2.1이다. */
      const ramp = polyPath3([
        [-0.78, t1R(DOME_Z) - 0.15, DOME_Z], [0.78, t1R(DOME_Z) - 0.15, DOME_Z],
        [1.05, 6.3, 0], [-1.05, 6.3, 0]]);
      out.push(...tagKey([[ramp, 1, SILVER] as ShapeFace, topFace(ramp, 0.16)],
        depthNow(0, 6.4) + 0.5));
      /* 입구는 **2층 바닥에서 캐노피까지**다(지적) — 경사로가 물려 들어가는 그 한 칸을
         푸른 하얀빛으로 반투명하게 비춘다. 2층 기둥은 위로 갈수록 좁아지므로 위·아래
         너비를 그 높이의 기둥 반지름(t1R)에 맞춰야 벽에 딱 붙는다. 세 겹이라(어두운
         안쪽 → 푸른 막 → 하얀 심) 가운데가 환하고 가장자리로 갈수록 옅다. */
      const gzB = DOME_Z + 0.04;
      const gzT = CANOPY_Z - 0.02;
      const gate = (hw: number, inset: number): string => polyPath3([
        [-hw, t1R(gzB) + inset, gzB], [hw, t1R(gzB) + inset, gzB],
        [hw * 0.88, t1R(gzT) + inset, gzT], [-hw * 0.88, t1R(gzT) + inset, gzT],
      ]);
      out.push(...tagKey([
        [gate(1.28, 0.02), 1, "#1d2733"] as ShapeFace,
        [gate(1.14, 0.05), 0.5, "#7fc9ff"] as ShapeFace,
        [gate(0.78, 0.08), 0.72, "#eaf6ff"] as ShapeFace,
      ], depthNow(0, T1_RB) * 1.6 + 3));
    }
    out.push(
      ...legAndFoot(-POD_R, POD_R, HULL_Z + 0.25, 0.035),
      ...legAndFoot(POD_R, POD_R, HULL_Z + 0.25, 0.035),
    );
    return out;
  },
  /* 배럭(실물 참고) — 중앙 몸통 + 좌우로 더 높은 쌍탑 + 벌어진 네 다리와 원반 발. */
  cube: () => {
    /* 배럭(사진 참고·요청) — 크게 보면 얇은 직육면체 판 셋(가운데·좌·우)이 나란히
       서고 그 사이를 입체 상자가 잇는 꼴이다. 지붕에는 앞으로 기운 경사 벤트가 얹힌다.

       이번 손질(지적·요청 한 묶음):
        · **판이 각도에 따라 커졌다 작아졌다** 하던 것 — 원인은 두께가 뒤집혀 있었다.
          판 셋(1.9·1.6)보다 그 사이를 잇는 상자(2.9)가 더 두꺼워, 정면에서는 얇은 판이
          옆에서는 두꺼운 사이 상자가 실루엣을 잡았다. 이제 판이 두껍고(바깥 2.7·가운데
          2.4) 사이 상자가 얇다(1.9) — 어느 각도에서 봐도 판 셋이 덩치를 쥔다.
        · 데칼은 판마다 하나씩(요청). 사이 상자에 두 짝씩 붙던 것을 걷었다.
        · 옆면 데칼은 작은 네모가 아니라 앞뒤로 긴 가로띠다(요청).
        · 벤트는 상자가 아니라 **경사로**다(요청: 옆에서 보면 삼각형) — 뒤가 높고
          앞으로 미끄러져 내려온다.
        · 다리를 조금만 더 드러냈다(요청) — 몸통 전체를 LIFT만큼 올린다.
        · 노란 창을 앞면과 옆면에 몇 개씩 냈다(요청). */
    const out: ShapeFace[] = [];
    const pc: ShapeFace[] = [];
    /** 몸통을 통째로 올리는 값(요청: "다리 길이 조금만 높이기") — 다리는 z 0.38에서
     *  시작하므로 몸이 오른 만큼 그대로 드러나는 다리가 된다. 지붕 위에 얹히는 것들도
     *  이 값을 함께 탄다. */
    const LIFT = 0.36;
    /** 판 셋 — 바깥 둘은 크고 두껍게, 가운데는 한 뼘 작게. */
    const PX = 3.95;        // 바깥 판의 x 중심
    const PW = 2.7;         // 바깥 판 두께(x)
    const PD = 7.6;         // 판 깊이(y)
    const PH = 7.2;         // 바깥 판 높이
    const MW = 2.4;         // 가운데 판 두께
    const MD = 6.4;
    const MH = 5.8;
    const PZ = 1.05 + LIFT; // 판 밑면
    /** 사이 상자 — 판보다 얇고·낮고·얕다. 판에 물려 이음매 노릇만 한다. */
    const GX = 1.95;
    const GW = 1.9;
    const GD = 7;
    const GH = 4.6;
    const GZ = 1.55 + LIFT;
    const PTOP = PZ + PH;   // 바깥 판 지붕
    const MTOP = PZ + MH;   // 가운데 판 지붕
    // 다리 여섯 — 앞뒤 세 쌍. 가운데 다리는 몸통 안쪽으로.
    out.push(
      ...legAndFoot(-3.9, 3.4, 1.45 + LIFT), ...legAndFoot(0, 3.7, 1.45 + LIFT),
      ...legAndFoot(3.9, 3.4, 1.45 + LIFT),
      ...legAndFoot(-3.9, -3.4, 1.45 + LIFT), ...legAndFoot(0, -3.7, 1.45 + LIFT),
      ...legAndFoot(3.9, -3.4, 1.45 + LIFT),
    );
    /* 키는 제 자리 깊이 하나로(지적: 배럭 키값) — 붙박이 상수가 깊이 항보다 커서
       요잉과 무관하게 순서를 지배하던 것을 고친 자리다. 판 셋과 사이 상자는 나란히 선
       것들이라 제 자리 깊이만으로 앞뒤가 옳고, 위에 얹힌 벤트·띠만 제 판의 깊이에
       +0.3을 더해 따라다닌다. */
    // 사이 상자 둘 — 판보다 뒤에 그려도 얇아서 안 가린다.
    out.push(...tagKey(boxFaces3(-GX, 0, GW, GD, GH, GZ), depthNow(-GX, 0) * 1.6));
    out.push(...tagKey(boxFaces3(GX, 0, GW, GD, GH, GZ), depthNow(GX, 0) * 1.6));
    // 판 셋.
    out.push(...tagKey(boxFaces3(-PX, 0, PW, PD, PH, PZ), depthNow(-PX, 0) * 1.6));
    out.push(...tagKey(boxFaces3(PX, 0, PW, PD, PH, PZ), depthNow(PX, 0) * 1.6));
    out.push(...tagKey(boxFaces3(0, 0, MW, MD, MH, PZ), depthNow(0, 0) * 1.6));
    /** 지붕 경사 벤트(요청: "경사로 모양으로 앞으로 기울이기 옆에서 보면 삼각형") —
     *  뒤(−y)가 높고 앞(+y)으로 미끄러져 내려오는 쐐기다. 옆 삼각 둘 · 뒷벽 · 경사면으로
     *  이루어지고, 경사면 위에는 밝은 살을 몇 줄 긋는다(환풍구의 격자). */
    const rampVent = (
      cx: number, hw: number, yBack: number, yFront: number, zBase: number, hi: number,
      ribs: number,
    ): ShapeFace[] => {
      const f: ShapeFace[] = [];
      const zTop = zBase + hi;
      for (const m9 of [-1, 1] as const) {
        const d9 = polyPath3([
          [cx + m9 * hw, yBack, zBase], [cx + m9 * hw, yBack, zTop], [cx + m9 * hw, yFront, zBase],
        ]);
        const fl9 = faceLight(m9, 0, 0);
        if (fl9.visible) f.push(bodyFace(d9), ...fl9.face(d9));
      }
      const back = polyPath3([
        [cx - hw, yBack, zBase], [cx + hw, yBack, zBase], [cx + hw, yBack, zTop], [cx - hw, yBack, zTop],
      ]);
      const flB = faceLight(0, -1, 0);
      if (flB.visible) f.push(bodyFace(back), ...flB.face(back));
      /* 경사면의 법선 — 뒤위에서 앞아래로 내려오는 모서리에 수직이고 하늘을 본다.
         모서리 e=(ey,ez)에 대해 n=(−ez,ey)/|e| 다. */
      const ey = yFront - yBack;
      const ez = -hi;
      const l9 = Math.hypot(ey, ez) || 1;
      const slope = polyPath3([
        [cx - hw, yBack, zTop], [cx + hw, yBack, zTop], [cx + hw, yFront, zBase], [cx - hw, yFront, zBase],
      ]);
      const flS = faceLight(0, -ez / l9, ey / l9);
      f.push(bodyFace(slope), ...(flS.visible ? flS.face(slope) : [sideFace(slope, 0.34)]));
      /* 살 — 경사면을 가로지르는 줄. 면을 따라 앉게 t로 보간한다.
         밝은 줄 바로 아래에 **검은 줄**을 붙여 두 톤으로 낸다(요청: "배럭과 팩토리
         벤트에 검은 가로 줄들 추가") — 한 톤짜리 흰 줄만으로는 판에 그은 선으로 보이고,
         밝고 어두운 짝이 이어져야 살이 겹쳐 난 루버로 읽힌다. */
      for (let i9 = 1; i9 <= ribs; i9 += 1) {
        const t0 = i9 / (ribs + 1);
        const at = (t9: number): [number, number] => [yBack + ey * t9, zTop - hi * t9];
        const bar = (ta: number, tb: number): string => {
          const [ya, za] = at(ta);
          const [yb, zb] = at(tb);
          return polyPath3([
            [cx - hw * 0.78, ya, za], [cx + hw * 0.78, ya, za],
            [cx + hw * 0.78, yb, zb], [cx - hw * 0.78, yb, zb],
          ]);
        };
        f.push(topFace(bar(t0, t0 + 0.07), 0.3));
        f.push(sideFace(bar(t0 + 0.07, t0 + 0.15), 0.55));
      }
      return f;
    };
    for (const sx9 of [-1, 1] as const) {
      out.push(...tagKey(rampVent(sx9 * PX, 0.95, -2.9, 1.5, PTOP, 1.55, 3),
        depthNow(sx9 * PX, 0) * 1.6 + 0.3));
    }
    out.push(...tagKey(rampVent(0, 0.66, -2.1, 0.9, MTOP, 1.05, 2), depthNow(0, 0) * 1.6 + 0.3));
    // 바깥 판 어깨의 밝은 띠(기존 포인트 유지) — 제 판을 따라다닌다.
    for (const sx9 of [-1, 1] as const) {
      out.push(...tagKey([topFace(polyPath3([
        [sx9 * PX - 1.1, 2.6, PTOP], [sx9 * PX + 1.1, 2.6, PTOP],
        [sx9 * PX + 1.1, 1.7, PTOP], [sx9 * PX - 1.1, 1.7, PTOP],
      ]), 0.3)], depthNow(sx9 * PX, 0) * 1.6 + 0.3));
    }
    /** 노란 창(요청: "노란 네모 창문도 앞과 옆면에 몇개씩") — 불이 켜진 유리라 음영을
     *  안 태우고 제 색 그대로 앉는다. 벽보다 아주 조금 밖에 눕혀 z-싸움을 피한다. */
    const GLASS = "#f2c94c";
    const win = (
      pts: [number, number, number][], key: number,
    ): void => { out.push(...tagKey(paintBase([bodyFace(polyPath3(pts))], GLASS), key)); };
    for (const sy9 of [1, -1] as const) {
      if (facingRatio(0, sy9) <= 0.12) continue;
      const py9 = sy9 * (PD / 2 + 0.03);
      const my9 = sy9 * (MD / 2 + 0.03);
      // 바깥 판 앞면 — 창 둘 · 그 아래 개인색 데칼 하나.
      for (const sx9 of [-1, 1] as const) {
        const cx9 = sx9 * PX;
        const key9 = depthNow(cx9, sy9 * PD) * 1.6 + 0.3;
        for (const dx9 of [-0.68, 0.68]) {
          win([
            [cx9 + dx9 - 0.36, py9, 5.3 + LIFT], [cx9 + dx9 + 0.36, py9, 5.3 + LIFT],
            [cx9 + dx9 + 0.36, py9, 6.1 + LIFT], [cx9 + dx9 - 0.36, py9, 6.1 + LIFT],
          ], key9);
        }
        pc.push(...tagKey([bodyFace(polyPath3([
          [cx9 - 0.85, py9, 2.6 + LIFT], [cx9 + 0.85, py9, 2.6 + LIFT],
          [cx9 + 0.85, py9, 4.1 + LIFT], [cx9 - 0.85, py9, 4.1 + LIFT],
        ]))], key9));
      }
      // 가운데 판 앞면 — 창 하나 · 데칼 하나.
      const keyM = depthNow(0, sy9 * MD) * 1.6 + 0.3;
      win([
        [-0.42, my9, 4.9 + LIFT], [0.42, my9, 4.9 + LIFT],
        [0.42, my9, 5.6 + LIFT], [-0.42, my9, 5.6 + LIFT],
      ], keyM);
      pc.push(...tagKey([bodyFace(polyPath3([
        [-0.75, my9, 2.5 + LIFT], [0.75, my9, 2.5 + LIFT],
        [0.75, my9, 3.9 + LIFT], [-0.75, my9, 3.9 + LIFT],
      ]))], keyM));
    }
    /* 옆면(±x) — 개인색은 앞뒤로 긴 가로띠 하나(요청: "작은 네모말고 가로띠로 길게"),
       그 위에 노란 창 셋. */
    for (const sx9 of [1, -1] as const) {
      if (facingRatio(sx9, 0) <= 0.12) continue;
      const xw9 = sx9 * (PW / 2 + PX + 0.03);
      const key9 = depthNow(sx9 * PX, 0) * 1.6 + 0.3;
      pc.push(...tagKey([bodyFace(polyPath3([
        [xw9, -3.05, 2.7 + LIFT], [xw9, 3.05, 2.7 + LIFT],
        [xw9, 3.05, 3.7 + LIFT], [xw9, -3.05, 3.7 + LIFT],
      ]))], key9));
      for (const dy9 of [-2, 0, 2]) {
        win([
          [xw9, dy9 - 0.42, 5 + LIFT], [xw9, dy9 + 0.42, 5 + LIFT],
          [xw9, dy9 + 0.42, 5.9 + LIFT], [xw9, dy9 - 0.42, 5.9 + LIFT],
        ], key9);
      }
    }
    return raceBase(out, "terran", pc);
  },
  /* 서플라이(단순화, 지적) — 본체 상자 + 지붕 큰 회전 통풍구 + 앞면의 더 큰 둥근 팬
     둘 + 왼앞 줄무늬 차단바. 잔장식(등판·캐니스터·탱크)은 걷어냈다. */
  trapezoid: () => {
    /* 서플라이 디포(재작도·사진) — 검회색 장갑 상자다. 지붕 뒤에 드럼통 하나가 서고,
       지붕 가운데와 앞면 두 곳에는 환풍구가 뚫린다. 왼쪽 지붕에는 은빛 보급 상자 줄과
       그 아래 초록 발광, 왼쪽 옆면에는 초록 창과 해저드 띠, 앞에는 경사로와 드럼 둘.
       개인색은 보급 상자 줄과 드럼통 뚜껑 데칼이다. */
    const STEEL = "#5c636d";
    const DARK = "#3a3f46";
    /** 몸통 — 테란 기본색(요청: "서플라이 본체 색 테란 기본색"). 여태 DARK(#3a3f46)라
     *  커맨드·배럭 옆에 서면 혼자 새까맸다. 어두운 색은 드럼 뚜껑에만 남긴다. */
    const BODY = "#868d94";
    /** 환풍팬 뒤판 — 검정이 아니라 회색이다(요청, 두 번째: "더 연하게").
     *  #15181c는 구멍이 뚫린 것처럼 보여 날개 셋이 허공에 떠 있는 꼴이었고,
     *  #3c424a는 아직 어두워 날개와 대비가 약했다. #5c646f면 뒤판이 판으로 읽히고
     *  그 위의 밝은 날개(#98a1ab)가 또렷하게 뜬다. */
    const HOLE = "#5c646f";
    const BLADE = "#98a1ab";
    const FRAME = "#6b727c";
    const out: ShapeFace[] = [];
    // 몸통 — 위로 살짝 좁아지는 장갑 덩치.
    /* 높이를 살짝 올렸다(요청) — 2.2 → 2.6. 지붕 위에 앉는 것들(환풍구·드럼·상자
       줄)과 사면을 재는 wallX·wallY도 같은 값으로 함께 옮긴다. */
    out.push(...tagKey(paintBase(frustumFaces3(0, 0, 7.2, 5.6, 6.4, 4.8, 2.6, 0), BODY), 0));
    // 몸통 옆구리 골 — 앞이 보일 때만.
    if (facingRatio(0, 1) > 0.12) {
      const rib: ShapeFace[] = [];
      for (let k = 0; k < 6; k += 1) {
        rib.push(sideFace(polyPath3([
          [-3 + k * 1.05, 2.75, 0.3], [-2.5 + k * 1.05, 2.75, 0.3],
          [-2.5 + k * 1.05, 2.75, 2.4], [-3 + k * 1.05, 2.75, 2.4],
        ]), 0.32));
      }
      out.push(...tagKey(rib, 1 + depthNow(0, 2.7) * 1.6));
    }
    /* 환풍구 셋(재지적: "세개는 디스크가 아니고 환풍구들이네", "동그라미 모양에 날개
       3개씩 있음") — 지붕 하나와 앞면 둘. 둥근 테 안에 검은 구멍이 파이고 그 위로 날개
       셋이 허브에서 뻗어 나가며 바깥으로 갈수록 넓어진다.
       평면 위의 원이라 화면 타원을 직접 그리지 않는다: 중심 C와 그 평면을 이루는 두
       방향 u·v를 받아 P(r,t) = C + r·cos t·u + r·sin t·v 로 모형 좌표를 만들고, 투영은
       polyPath3에 맡긴다. 앞면처럼 기운 벽에서도 원이 벽에 제대로 눕는 이유다. */
    const fanVent = (
      c: [number, number, number], u: [number, number, number], v: [number, number, number],
      r: number, key: number,
    ): void => {
      const P = (rr: number, t: number): [number, number, number] => {
        const ct = Math.cos(t) * rr; const st = Math.sin(t) * rr;
        return [c[0] + ct * u[0] + st * v[0], c[1] + ct * u[1] + st * v[1],
          c[2] + ct * u[2] + st * v[2]];
      };
      const ring = (rr: number, n = 24): [number, number, number][] =>
        Array.from({ length: n }, (_, k) => P(rr, (k / n) * Math.PI * 2));
      const parts: ShapeFace[] = [
        [polyPath3(ring(r * 1.18)), 1, FRAME] as ShapeFace,
        [polyPath3(ring(r * 1.03)), 1, "#4a505a"] as ShapeFace,
        [polyPath3(ring(r)), 1, HOLE] as ShapeFace,
      ];
      // 날개 셋 — 허브에서 나와 살짝 휘며 넓어진다. 사이는 검은 구멍이 그대로 비친다.
      const SEG = 6;
      for (let k = 0; k < 3; k += 1) {
        const a0 = (k / 3) * Math.PI * 2;
        const pts: [number, number, number][] = [];
        const rAt = (t: number): number => r * (0.2 + 0.78 * t);
        const half = (t: number): number => 0.16 + 0.52 * t;
        for (let j = 0; j <= SEG; j += 1) {
          const t = j / SEG;
          pts.push(P(rAt(t), a0 + t * 0.62 - half(t)));
        }
        for (let j = SEG; j >= 0; j -= 1) {
          const t = j / SEG;
          pts.push(P(rAt(t), a0 + t * 0.62 + half(t)));
        }
        parts.push([polyPath3(pts), 1, BLADE] as ShapeFace);
      }
      // 가운데 허브.
      parts.push([polyPath3(ring(r * 0.24, 14)), 1, "#8b8f96"] as ShapeFace);
      out.push(...tagKey(parts, key));
    };
    // 지붕 환풍구 — 바닥면(위를 보는 면)에 눕는다.
    /* 지붕 환풍구는 원래 자리(가운데 살짝 뒤)로 되돌린다 — 드럼을 피하려고 앞오른쪽
       으로 밀었었는데, 드럼이 오른쪽 뒤로 가면서 자리를 다툴 일이 없어졌다. */
    fanVent([0.3, -0.5, 2.64], [1, 0, 0], [0, 1, 0], 1.75, 20 + depthNow(0.3, -0.5));
    /* 앞면 환풍구 둘 — 앞벽은 위로 좁아지는 사면이라 높이마다 벽의 y가 다르다.
       벽을 따라 올라가는 방향(0, dy/dz, 1)을 단위로 만들어 v로 주면 원이 사면에 눕는다.
       벽에서 살짝(0.06) 앞으로 띄워 몸통 면과 겹쳐 깜빡이지 않게 했다. */
    const wallY = (z9: number): number => 2.8 - (0.4 / 2.6) * z9;
    if (facingRatio(0, 1) > 0.12) {
      const sl = -0.4 / 2.2;
      const vn = Math.hypot(sl, 1);
      for (const fx of [-1.75, 1.75]) {
        fanVent([fx, wallY(1.2) + 0.06, 1.2], [1, 0, 0], [0, sl / vn, 1 / vn], 0.92,
          22 + depthNow(fx, 2.7));
      }
    }
    /* 드럼통(재지적: "아까 없앴던 떨어진 디스크도 실제로 존재함. 크기 줄여서 복구하되
       디스크 아래에 본체기둥도 있게해서 드럼통 느낌") — 예전에는 원판만 지붕 위 허공에
       떠 있어 어느 방향에서 봐도 본체와 안 닿는 낱개로 보였고, 그래서 걷었던 것이다.
       원판 아래에 기둥을 세우면 밑동이 지붕에 닿아 통 하나로 읽힌다. 크기는 줄였다
       (반지름 1.6 → 0.92). 뚜껑 안쪽 원이 개인색 데칼이다(요청). */
    {
      // 키는 낮추고(재지적: "드럼통 높이 낮추기") 배는 그대로 — 1.5 → 0.85.
      /* 드럼은 윗면의 **뒤쪽 오른쪽 귀**다(정정 요청: "디스크는 뒷면 오른쪽이야").
         윗면은 6.4×4.8(x ±3.2 · y ±2.4)이고 드럼 반지름이 0.92라, (2.2, −1.4)면
         바깥 끝이 x 3.12 · y −2.32로 귀에 바짝 붙되 테두리를 안 넘는다.
         왼쪽 뒤는 지붕 보급 상자 줄이 쓴다 — 둘이 좌우로 갈려 지붕이 안 붐빈다. */
      const dx = 2.2; const dy = -1.4; const dr = 0.92; const dz = 2.6; const dh = 0.85;
      out.push(...tagKey([
        ...paintBase(cylinderFaces3(dx, dy, dr, dh, dz), STEEL),
        // 허리 테 둘 — 드럼통으로 읽히게 하는 표식.
        ...paintBase(cylinderFaces3(dx, dy, dr * 1.07, 0.13, dz + dh * 0.3), "#828a94"),
        ...paintBase(cylinderFaces3(dx, dy, dr * 1.07, 0.13, dz + dh * 0.62), "#828a94"),
        // 뚜껑 — 어두운 강철 원판, 그 안쪽 원은 칠하지 않아 임자 색이 든다(개인색 데칼).
        [discPath3(dx, dy, dz + dh + 0.02, dr), 1, DARK] as ShapeFace,
        [discPath3(dx, dy, dz + dh + 0.04, dr * 0.62), 1] as ShapeFace,
        topFace(discPath3(dx, dy, dz + dh + 0.06, dr * 0.26), 0.3),
      ], 26 + depthNow(dx, dy)));
    }
    /* 환풍팬 둘 사이의 배기 파이프(요청: "옆면에 환풍팬 사이에 지상으로 이어지는
       파이프 구조물") — 벽 앞으로 살짝 나와 선 굵은 관이 지붕 밑에서 땅까지 내려온다.
       위쪽은 팔꿈치로 꺾여 벽 안으로 들어가고, 중간에 이음매 테 둘, 밑동에는 바닥판이
       깔린다. 벽에 그린 데칼이 아니라 제 부피를 가진 구조물이라 깊이 키로 정렬한다. */
    {
      const py = 3.06;
      const pipe: ShapeFace[] = [
        // 밑동 바닥판.
        ...paintBase(cylinderFaces3(0, py, 0.62, 0.16, 0), FRAME),
        // 세운 관.
        ...paintBase(cylinderFaces3(0, py, 0.36, 2.45, 0.1), STEEL),
        // 이음매 테 둘.
        ...paintBase(cylinderFaces3(0, py, 0.44, 0.14, 0.66), FRAME),
        ...paintBase(cylinderFaces3(0, py, 0.44, 0.14, 1.46), FRAME),
        // 벽으로 꺾여 들어가는 팔꿈치.
        ...paintBase(tubeFaces(0, py, 0, wallY(2.45) - 0.1, 0.33, 2.45), STEEL),
      ];
      out.push(...tagKey(pipe, depthNow(0, py) * 1.6 + 6));
    }
    /* 왼쪽 지붕 보급 상자 줄 — 개인색(요청: 건물마다 개인색 포인트). 드럼통이 뒤
       귀퉁이를 차지해 세 칸으로 줄이고 앞으로 물렸다. */
    for (let k = 0; k < 3; k += 1) {
      out.push(...tagKey(boxFaces3(-2.4, 1.7 - k * 1.15, 1.5, 1, 0.9, 2.6),
        20 + depthNow(-2.4, 1.7 - k * 1.15)));
    }
    /* 왼쪽 옆면 초록 창과 해저드 띠 — 그 면은 아래가 넓고 위가 좁은 사면이라
       (3.6→3.2) 높이마다 벽의 x가 다르다. wallX가 그 기울기를 재 주므로 데칼 네 귀가
       벽 평면에 정확히 눕는다. 켜는 조건은 몸통 옆벽과 똑같이 faceLight로 잡았다 —
       벽이 사라진 각도에 데칼만 남아 허공에 뜨지 않게. */
    const wallX = (z9: number): number => -(3.6 - (0.4 / 2.6) * z9) - 0.06;
    if (faceLight(-1, 0, 0.18).visible) {
      /* 초록 창(재지적: "앞쪽 초록창은 반투명 처리하고 더 크게 확대") — 꽉 찬 초록
         네모가 아니라 안쪽이 비쳐 보이는 유리다. 벽 자리에 어두운 창틀을 먼저 깔고
         그 위에 반투명 초록을 덮어, 뒤가 비치면서도 벽 색에 묻히지 않게 했다.
         크기는 세로 0.8 → 1.55, 가로 1.8 → 3.2로 키웠다. */
      const gz0 = 0.72; const gz1 = 2.05; const gy = 1.6;
      const pane = (inset: number, z0: number, z1: number): string => polyPath3([
        [wallX(z0) - inset, -gy - inset * 0.4, z0], [wallX(z0) - inset, gy + inset * 0.4, z0],
        [wallX(z1) - inset, gy + inset * 0.4, z1], [wallX(z1) - inset, -gy - inset * 0.4, z1],
      ]);
      out.push(...tagKey([
        [pane(0, gz0 - 0.16, gz1 + 0.16), 1, "#22262b"] as ShapeFace,
        [pane(0.04, gz0, gz1), 0.55, "#4cd86a"] as ShapeFace,
        // 유리에 비친 하늘 — 위쪽 모서리를 따라 흐르는 옅은 띠.
        [pane(0.06, gz1 - 0.34, gz1 - 0.06), 0.3, "#eafff0"] as ShapeFace,
      ], depthNow(-3.4, 0) * 1.6 + 3));
      // 해저드 빗금 띠 — 위로 갈수록 앞(+y)으로 밀어 비스듬한 경고 무늬가 된다.
      const haz: ShapeFace[] = [];
      for (let k = 0; k < 7; k += 1) {
        const y0 = -2.35 + k * 0.62;
        haz.push([polyPath3([
          [wallX(0.34), y0, 0.34], [wallX(0.34), y0 + 0.34, 0.34],
          [wallX(0.96), y0 + 0.79, 0.96], [wallX(0.96), y0 + 0.45, 0.96],
        ]), 1, k % 2 === 0 ? "#e8c33a" : "#22262b"] as ShapeFace);
      }
      out.push(...tagKey(haz, depthNow(-3.4, 0) * 1.6 + 4));
    }
    // 앞 드럼 둘 — 앞면 가운데를 환풍구가 차지해 오른쪽 귀로 물렸다.
    for (const [dx9, dy9] of [[2.9, 3.5], [3.9, 2.9]] as [number, number][]) {
      out.push(...tagKey(paintBase([
        ...cylinderFaces3(dx9, dy9, 0.55, 1.1, 0),
        ...domeFaces3(dx9, dy9, 0.55, 0.28, 1.1),
      ], STEEL), depthNow(dx9, dy9) * 1.6 + 4));
    }
    return out;
  },
  factory: () => {
    /* 팩토리(요청·사진) — 직육면체가 아니라, 위아래 모서리를 크게 깎은 넓적한 8각
       단면을 길이 방향으로 뽑은 장갑 몸통이다. 옆면에는 패널 홈이 줄지어 파이고,
       지붕에는 굴뚝 셋과 관제 모듈이 얹힌다.

       이번 손질(요청 한 묶음):
        · 본체를 1.2배로 키웠다 — 아래 K 하나로 x·y·z를 함께 곱한다.
        · 앞 오른쪽에 붙어 있던 개인색 상자를 걷었다. 그 노릇은 새로 낸 옆면 출입구
          위의 데칼이 물려받는다(넓은 면에 칠하는 개인색 규약은 그대로).
        · 화살표 지시등을 옆면 출입구 옆으로 옮겼다 — 진출 방향을 가리키는 표시라
          나가는 문 곁에 있어야 뜻이 통한다.
        · 옆면에 출입 경사로를 냈다. **바깥에 덧댄 판이 아니라 안에서 시작한다** —
          옆벽에 어두운 문간을 파고, 바닥(z FLOOR)에서 시작한 경사면이 그 문을 지나
          밖으로 나와 땅에 닿는다.
        · 앞쪽 경사로 셋은 절반으로 줄였고, 지붕의 굴뚝·관제 상자는 1/3로 줄였다.
        · 지붕 한가운데에 두께 있는 직각삼각형 벤트를 얹었다. */
    /* 전체 1.1배(요청) — 1.2 → 1.32. y·z는 이 배수 하나가 다 태운다. */
    const K = 1.2 * 1.1;
    /** 앞면(정면에서 보이는 넓은 벽)의 폭 = 길이축(x)이다. 1.2배로 키우니 너무 길어
     *  보여 이 축만 덜 키웠고(요청: "앞면에서 봤을때 폭은 살짝 축소"), 이번엔 거기서
     *  다시 10%를 뺀다(요청: "앞뒷면만 폭 10프로 줄이고"). 1.05 × 1.1 × 0.9 = 1.0395라
     *  x는 사실상 제자리고, 커지는 것은 y·z뿐이다 — 옆에서 본 덩치가 커지고 정면은
     *  좁아지는, 요청 두 줄이 함께 노리던 그 모양이다. */
    const KX = 1.05 * 1.1 * 0.9;
    const X0 = -5.5 * KX;
    const X1 = 4.3 * KX;
    const ZT = 6.9 * K;
    /** 8각 단면의 밑면 높이 — 옆면 경사로가 여기서 시작한다. */
    const FLOOR = 1.2 * K;
    const YW = 3 * K;      // 옆벽의 y(단면 최대 폭)
    // 8각 단면 — (y, z). 바닥·천장은 넓고 네 모서리는 45도로 깎였다.
    const SEC: [number, number][] = ([
      [-3, 2.2], [-2, 1.2], [2, 1.2], [3, 2.2], [3, 5.9], [2, 6.9], [-2, 6.9], [-3, 5.9],
    ] as [number, number][]).map(([y9, z9]) => [y9 * K, z9 * K] as [number, number]);
    /** 몸통 한 덩이의 키 — 8각 기둥은 면을 안에서 정렬한 뒤 **한 키**로 묶어 올린다.
     *  벽에 붙는 데칼은 반드시 이 값보다 커야 몸에 안 묻힌다(지적: "데칼과 창문이
     *  사선에서 잘 안보임"). 데칼 키를 제 벽의 깊이로만 매기면, 요잉에 따라 그 깊이가
     *  몸 키보다 작아지는 구간이 생겨 보이는 벽인데도 데칼이 몸 뒤로 들어갔다. */
    const BODYK = depthNow(-0.6, -0.6) * 1.6;
    /** 벽 데칼의 키 — 제 벽 깊이를 쓰되 몸통 아래로는 안 내려간다. */
    const wallKey = (dx9: number, dy9: number): number =>
      Math.max(depthNow(dx9, dy9) * 1.6, BODYK) + 0.4;
    const out: ShapeFace[] = [
      /* 본체 바닥 패드 넷 — 8각 단면의 밑면(y −2.4~2.4, z 1.44) 안에서 시작해 몸에
         딱 붙는다. 몸이 1.2배가 되었으므로 자리도 함께 1.2배다. */
      ...legAndFoot(-4 * KX, 1.68, FLOOR + 0.06, 0.05),
      ...legAndFoot(2.8 * KX, 1.68, FLOOR + 0.06, 0.05),
      ...legAndFoot(-4 * KX, -1.68, FLOOR + 0.06, 0.05),
      ...legAndFoot(2.8 * KX, -1.68, FLOOR + 0.06, 0.05),
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
      out.push(...tagKey(body, BODYK));
    }
    const pc: ShapeFace[] = [];
    /* 긴 벽(±y)에는 패널 홈만 얹는다 — 보이는 쪽 벽에만. */
    for (const sy of [1, -1] as const) {
      /* 보임은 눈금으로 본다(지적: 사선에서 데칼·창이 잘 안 보임) — faceLight의 참·거짓
         컷은 문턱을 넘는 순간 통째로 사라져, 비스듬한 각에서 벽은 아직 보이는데 그 위의
         데칼만 없어지는 구간을 만든다. facingRatio는 같은 값을 눈금으로 주므로 컷을
         낮춰(0.06) 벽이 사실상 사라질 때까지 데칼을 붙들 수 있다. */
      if (facingRatio(0, sy) <= 0.06) continue;
      const key = wallKey(0, sy * YW);
      const det: ShapeFace[] = [];
      const yw = sy * (YW + 0.02);
      for (const px of [-4.2 * KX, -1.9 * KX, 0.4 * KX, 2.7 * KX]) {
        det.push(sideFace(polyPath3([
          [px - 0.9, yw, 3.72], [px + 0.9, yw, 3.72], [px + 0.9, yw, 6.36], [px - 0.9, yw, 6.36],
        ]), 0.34));
        det.push(topFace(polyPath3([
          [px - 0.74, yw, 5.4], [px + 0.74, yw, 5.4], [px + 0.74, yw, 6.18], [px - 0.74, yw, 6.18],
        ]), 0.2));
      }
      /* 노란 반투명 창 줄(요청: "앞옆뒷면에 노란반투명 창 여러개") — 홈 줄 위쪽에
         한 줄. 안에서 새어 나오는 빛이라 음영을 안 태운다. */
      for (const px of [-4.2 * KX, -2.6 * KX, -1 * KX, 0.6 * KX, 2.2 * KX, 3.6 * KX]) {
        det.push([polyPath3([
          [px - 0.52, yw, 6.7], [px + 0.52, yw, 6.7],
          [px + 0.52, yw, 7.34], [px - 0.52, yw, 7.34],
        ]), 0.5, "#f2c94c"] as ShapeFace);
      }
      out.push(...tagKey(det, key));
      /* 개인색 데칼(요청: "가로 띠 느낌인데 중간중간 끊긴") — 한 장으로 두르면 벽의
         절반이 임자 색이 되어 건물보다 색이 먼저 읽힌다. 토막으로 끊으면 띠의 결은
         남고 칠해진 넓이는 1/3이 된다. */
      const dash: ShapeFace[] = [];
      for (let i9 = 0; i9 < 7; i9 += 1) {
        const px = X0 + 0.8 + i9 * ((X1 - X0 - 1.6) / 6);
        dash.push(bodyFace(polyPath3([
          [px - 0.46, yw + 0.01, 3.12], [px + 0.46, yw + 0.01, 3.12],
          [px + 0.46, yw + 0.01, 3.7], [px - 0.46, yw + 0.01, 3.7],
        ])));
      }
      pc.push(...tagKey(dash, key + 0.05));
    }
    /* 옆면(±x 짧은 벽) — 같은 규약으로 창 줄과 끊긴 개인색 띠를 두른다(요청).
       오른쪽(+x)에는 출입문이 있어(z 2.95~5.25 · |y| ≤ 1.45) 띠가 문을 지나지 않게
       가운데 토막을 건너뛴다. */
    for (const sx of [1, -1] as const) {
      if (facingRatio(sx, 0) <= 0.06) continue;
      const xw9 = sx > 0 ? X1 + 0.02 : X0 - 0.02;
      const key9 = wallKey(sx > 0 ? X1 : X0, 0);
      const win9: ShapeFace[] = [];
      const dash9: ShapeFace[] = [];
      for (const dy9 of [-2.2, 0, 2.2]) {
        win9.push([polyPath3([
          [xw9, dy9 - 0.5, 7], [xw9, dy9 + 0.5, 7],
          [xw9, dy9 + 0.5, 7.6], [xw9, dy9 - 0.5, 7.6],
        ]), 0.5, "#f2c94c"] as ShapeFace);
      }
      for (const dy9 of [-2.9, -2, -1.1, -0.2, 0.7, 1.6, 2.5]) {
        if (sx > 0 && Math.abs(dy9) < 1.75) continue;
        dash9.push(bodyFace(polyPath3([
          [xw9 + sx * 0.01, dy9 - 0.32, 3.12], [xw9 + sx * 0.01, dy9 + 0.32, 3.12],
          [xw9 + sx * 0.01, dy9 + 0.32, 3.7], [xw9 + sx * 0.01, dy9 - 0.32, 3.7],
        ])));
      }
      out.push(...tagKey(win9, key9));
      pc.push(...tagKey(dash9, key9 + 0.05));
    }
    /* 출입 경사로는 **오른쪽 옆면(+x 짧은 벽) 하나뿐**이다(요청: "팩토리 출입경사로는
       오른쪽 옆면에만 놓여야하고"). 여태 좌우 긴 벽 양쪽에 냈는데, 그러면 문이 둘인
       건물이 되고 어느 각도에서 봐도 하나는 어색하게 걸린다.
       그리고 화살표는 벽이 아니라 **경사로 바닥에 칠한다**(요청) — 노면 표시라 그게
       실제 모습이고, 벽에 붙어 있을 때는 문 옆에 뜬금없이 떠 있었다. */
    {
      const GHW = 1.45;                 // 문·경사로 반폭(y)
      const SILL = 2.95;                // 문턱 — 벽이 가장 넓은 구간(z 2.64~7.08) 안
      const xw = X1 + 0.02;
      if (facingRatio(1, 0) > 0.06) {
        const det: ShapeFace[] = [
          // 문간 — 벽에 판 어두운 구멍.
          [polyPath3([
            [xw, -GHW, SILL], [xw, GHW, SILL], [xw, GHW, SILL + 2.3], [xw, -GHW, SILL + 2.3],
          ]), 1, "#1b1e23"] as ShapeFace,
          topFace(polyPath3([
            [xw, -GHW, SILL + 2], [xw, GHW, SILL + 2],
            [xw, GHW, SILL + 2.3], [xw, -GHW, SILL + 2.3],
          ]), 0.3),
        ];
        out.push(...tagKey(det, wallKey(X1, 0)));
        /* 문 위 개인색 데칼 — 앞 오른쪽 상자를 걷은 자리를 이것이 물려받는다. */
        pc.push(...tagKey([bodyFace(polyPath3([
          [xw + 0.02, -GHW - 0.2, SILL + 2.55], [xw + 0.02, GHW + 0.2, SILL + 2.55],
          [xw + 0.02, GHW + 0.2, SILL + 3.85], [xw + 0.02, -GHW - 0.2, SILL + 3.85],
        ]))], wallKey(X1, 0) + 0.05));
      }
      /* 경사로 — 안(문턱 안쪽 0.6)에서 시작해 문을 지나 밖으로 나오며 땅에 닿는다.
         화살표는 이 판 위에 그대로 얹는다 — 같은 평면이라 요잉을 함께 탄다. */
      const rx0 = X1 - 0.6;
      /* 길이 반으로(요청) — 뻗는 길이 4.0(문턱 안 0.6 + 밖 3.4)이 2.0(안 0.6 + 밖 1.4)이
         된다. 밖으로 내민 몫만 줄여 문간에 물리는 자리는 그대로 두었다. 같은 높이
         (SILL)를 절반 거리에서 내려오므로 비탈만 가팔라진다. */
      const rx1 = X1 + 1.4;
      const P = (t: number, hw: number): [number, number, number][] => {
        const x9 = rx0 + (rx1 - rx0) * t;
        const y9 = GHW + (0.35 * t);
        const z9 = SILL * (1 - t);
        return [[x9, -y9 * hw, z9], [x9, y9 * hw, z9]];
      };
      const quad = (t0: number, t1: number, hw: number): string => {
        const A = P(t0, hw); const B = P(t1, hw);
        return polyPath3([A[0], A[1], B[1], B[0]]);
      };
      const ramp: ShapeFace[] = [
        [quad(0, 1, 1), 1, "#c9ced6"] as ShapeFace,
        topFace(quad(0, 1, 1), 0.14),
      ];
      // 노면 화살표 셋(요청) — 밖을 가리키게 삼각으로.
      for (const t9 of [0.32, 0.55, 0.78]) {
        const A = P(t9 - 0.09, 0.5);
        const B = P(t9 + 0.09, 0.0001);
        ramp.push([polyPath3([A[0], A[1], B[0]]), 1, "#e08a2b"] as ShapeFace);
      }
      out.push(...tagKey(ramp, depthNow(X1 + 1.4, 0) * 1.6));
    }

    return raceBase(out.concat(
      /* 지붕 규칙(지적: 굴뚝 가려짐) — 지붕 얹힘들은 붙박이 큰 키. 굴뚝 셋 은색.
         크기는 1/3로 줄였다(요청) — 반지름 0.85 → 0.28, 높이 1.7 → 0.57. */
      /* 굴뚝 셋은 앞뒤로 나란히 선다(요청) — 가로로 흩어 놓았더니 지붕에 점 셋을
         찍어 놓은 꼴이었다. 한 x에 모아 y만 벌리면 한 계통의 배기구로 읽힌다. */
      ...([[-3.9, -1.6], [-3.9, 0], [-3.9, 1.6]] as [number, number][]).map(([cx9, cy9]) =>
        tagKey(paintBase(cylinderFaces3(cx9, cy9, 0.28, 0.57, ZT), "#c9ced6"),
          24 + depthNow(cx9, cy9))),
      /* 지붕 한가운데 직각삼각형 벤트(요청) — 두께가 있는 쐐기다. 옆면(x = ±hw)이
         직각삼각형이고, 그 사이를 빗면·뒷벽·바닥이 잇는다. 빗면에 살을 세 줄 긋는다. */
      ((): ShapeFace[] => {
        /* 벤트는 지붕 정중앙의 뒷쪽이다(요청) — 앞으로 나와 있으면 굴뚝 줄과 겹쳐 보였다.
           직각은 뒤(y0) 아래 귀에 있으므로, 뒤로 물릴수록 쐐기가 뒷벽 쪽에 붙는다. */
        const cx9 = (X0 + X1) / 2;
        const hw = 1.35;
        const y0 = -2.35;
        const y1 = -0.15;
        const h9 = 1.45;
        // (y, z) 직각삼각형 — 직각은 뒤(y0) 아래 귀에 있다.
        const tri = (x9: number): [number, number, number][] =>
          [[x9, y0, ZT], [x9, y1, ZT], [x9, y0, ZT + h9]];
        const L = tri(cx9 - hw);
        const R = tri(cx9 + hw);
        const w: ShapeFace[] = [
          bodyFace(polyPath3(L)), bodyFace(polyPath3(R)),
          // 빗면(앞아래로 기운 면) · 뒷벽(수직) · 바닥.
          bodyFace(polyPath3([L[1], L[2], R[2], R[1]])),
          bodyFace(polyPath3([L[0], L[2], R[2], R[0]])),
          topFace(polyPath3([L[1], L[2], R[2], R[1]]), 0.26),
          sideFace(polyPath3([L[0], L[2], R[2], R[0]]), 0.3),
        ];
        // 빗면의 검은 가로 줄(요청) — 셋 → 여섯, 더 짙게. 루버(가로 살) 결이 난다.
        for (let k9 = 1; k9 <= 6; k9 += 1) {
          const t9 = k9 / 7;
          const py = y1 + (y0 - y1) * t9;
          const pz = ZT + h9 * t9;
          w.push(sideFace(polyPath3([
            [cx9 - hw + 0.18, py, pz], [cx9 + hw - 0.18, py, pz],
            [cx9 + hw - 0.18, py - 0.12, pz + 0.07], [cx9 - hw + 0.18, py - 0.12, pz + 0.07],
          ]), 0.55));
        }
        return tagKey(w, 25 + depthNow(cx9, 0.3));
      })(),
      // 관제 모듈의 안테나(모듈 상자는 개인색이라 아래 accent로).
      tagKey(tubeFaces(3.12, -3.12, 5.2, -3.12, 0.22, ZT + 1.5), 26 + depthNow(4.2, -3.12)),
      /* 앞으로 나란히 내려오는 경사로 셋 — 다시 한 번 줄이고 몸 안쪽으로 밀어 넣었다
         (요청: "경사로 축소 및 본건물 안쪽으로 더 밀어넣고"). 위끝은 몸 밑판의 앞
         모서리(y 2K · z FLOOR)에 그대로 물리고, 밖으로 나오는 길이를 1.5 → 0.78로,
         폭을 0.55/0.65 → 0.4/0.46으로 줄인다. 좌표를 K로 매어 두어 몸이 커지면
         경사로도 같이 큰다(여태 y만 붙박이 2.4/3.9라 1.1배에서 벽과 어긋났다). */
      [-3.8, -1, 1.8].flatMap((rx) => {
        const y0r = 2 * K;
        const y1r = y0r + 0.78;
        const d = polyPath3([[rx - 0.4, y0r, FLOOR], [rx + 0.4, y0r, FLOOR],
          [rx + 0.46, y1r, 0], [rx - 0.46, y1r, 0]]);
        /* 그 위의 입구(요청: "위에 입구 표현(반투명 노란 불빛)추가") — 앞벽(y = YW)에
           난 문이다. 안에서 새어 나오는 불빛이라 음영을 안 태우고 노란색 반투명 하나로
           앉힌다. 벽보다 아주 조금 밖에 눕혀 z-싸움을 피한다. */
        const lit: ShapeFace[] = faceLight(0, 1, 0).visible ? [[polyPath3([
          [rx - 0.62, YW + 0.02, FLOOR + 0.15], [rx + 0.62, YW + 0.02, FLOOR + 0.15],
          [rx + 0.62, YW + 0.02, FLOOR + 1.75], [rx - 0.62, YW + 0.02, FLOOR + 1.75],
        ]), 0.5, "#f2c94c"] as ShapeFace] : [];
        // 진출 경사로 은색(요청).
        return [
          ...tagKey([
            [d, 1, "#c9ced6"] as ShapeFace,
            topFace(d, 0.14),
          ], depthNow(rx, y1r) * 1.6),
          ...tagKey(lit, depthNow(rx, YW) * 1.6 + 0.4),
        ];
      }),
    ), "terran", [
      /* 개인색 — 옆면 출입구 위 데칼(위에서 모았다)과 지붕 관제 모듈.
         앞 오른쪽 상자는 걷었다(요청). 관제 모듈도 1/3로 줄였다. */
      ...pc,
      ...tagKey(boxFaces3(3.6, -1.92, 1.12, 0.88, 0.96, ZT), 24 + depthNow(3.6, -1.92)),
    ]);
  },

  plane: () => {
    /* 스타포트(재작도 — 게임 스프라이트 기준) ──────────────────────────────────────
       앞선 판은 몸통·칼라·패드를 층층이 쌓아 너무 높았다(지적: "너가 만든거랑 너무
       달라"). 실제 스프라이트는 **납작하다**: 낮은 팔각 몸통 위에 큼직한 원형 착륙판이
       거의 곧바로 얹히고, 그 둘레에 길쭉한 슬래브 모듈이 눕고, 네 귀에서 가는 팔이
       뻗어 끝에 어두운 마디가 달린다. 앞에는 노란 불이 이글거리는 격납고 상자와
       옆으로 긴 구조물이 붙고, 발은 짧고 어둡게 둘레에 박힌다.
       개인색은 스프라이트의 **파랑**(= 임자 색) — 착륙판 둘레에 눕힌 슬래브들이다. */
    const out: ShapeFace[] = [];
    const pc: ShapeFace[] = [];
    const GREY = "#8b929a";
    const PADTOP = "#b7ac97";
    const AMBER = "#e8c33a";

    /* 몸통을 1.5배로, 다리도 그만큼 길게(요청). 납작하기만 하면 이 건물이 접시
       하나로 보인다 — 몸이 서야 착륙판이 '지붕'으로 읽힌다. */
    const BODY_Z0 = 1.35;   // 몸통 밑 — 발 위로 떠 있다(다리 길이가 이 값이다).
    /* 몸통 높이 1.2배(요청) — 2.25 → 2.7. 착륙판(PAD_Z)과 그 위의 모든 것이 이 값을
       따라 함께 올라간다. 앞 구조물 둘도 같은 배수로 키운다(아래 FRONT_H1·FRONT_H2). */
    const BODY_H = 2.25 * 1.2;
    const FRONT_H1 = 1.35 * 1.2;
    const FRONT_H2 = 1.55 * 1.2;
    const PAD_Z = BODY_Z0 + BODY_H;   // 2.35 — 착륙판 테

    // 짧고 어두운 발 여섯 — 둘레에 박힌다. 스프라이트의 발은 기둥이 아니라 굽이다.
    for (const deg9 of [30, 90, 150, 210, 270, 330]) {
      const a9 = (deg9 * Math.PI) / 180;
      // 몸통 반지름(4.75~5.15) 안에서 시작해야 다리가 안 뜬다(수리: 5.35는 밖이었다).
      const fx9 = Math.sin(a9) * 4.55;
      const fy9 = Math.cos(a9) * 4.55;
      out.push(...legAndFoot(fx9, fy9, BODY_Z0 + 0.25, 0.04));
    }

    // 낮은 팔각 몸통.
    out.push(...tagKey(spirePillar({
      x: 0, y: 0, z0: BODY_Z0, h: BODY_H, w: 4.75, tipW: 5.15,
      segs: 2, sides: 8, hold: 0.4, caps: "bottom",
    }), 4));

    /* 앞(0도)에는 길다란 구조물이 앞으로 뻗고, 그 끝에 옆으로 긴 구조물이 가로로
       붙는다(지적). 끝 구조물의 앞면에는 노란 창이 길게 난다. 격납고 아가리는 여기가
       아니라 45도 자리다(아래). */
    // ① 앞으로 뻗는 길다란 구조물 — 세로(앞뒤)로 길고 좁다.
    out.push(...tagKey(paintBase(boxFaces3(0, 5.5, 2.0, 3.8, FRONT_H1, BODY_Z0 - 0.05), "#767d86"),
      46 + depthNow(0, 5.5) * 1.6));
    // ② 그 끝의 옆으로 긴 구조물 — 가로로 넓고 얕다.
    out.push(...tagKey(paintBase(boxFaces3(0, 7.65, 5.8, 1.4, FRONT_H2, BODY_Z0 - 0.12), GREY),
      47 + depthNow(0, 7.65) * 1.6));
    if (facingRatio(0, 1) > 0.1) {
      /* ③ 끝 구조물 앞면의 긴 노란 창 — 반투명 노란 불빛(요청). 어두운 안쪽 위에 노란
         막을 덮고 살을 얹어, 가운데가 환하고 가장자리로 갈수록 옅다. */
      const wy = 8.36;
      const wz = BODY_Z0 + 0.28;
      const win: ShapeFace[] = [
        [polyPath3([[-2.5, wy, wz], [2.5, wy, wz], [2.5, wy, wz + 0.86], [-2.5, wy, wz + 0.86]]),
          1, "#23262b"] as ShapeFace,
        [polyPath3([[-2.34, wy + 0.02, wz + 0.08], [2.34, wy + 0.02, wz + 0.08],
          [2.34, wy + 0.02, wz + 0.78], [-2.34, wy + 0.02, wz + 0.78]]),
          0.55, "#ffd84a"] as ShapeFace,
        [polyPath3([[-2.2, wy + 0.04, wz + 0.2], [2.2, wy + 0.04, wz + 0.2],
          [2.2, wy + 0.04, wz + 0.62], [-2.2, wy + 0.04, wz + 0.62]]),
          0.82, "#fff2b0"] as ShapeFace,
      ];
      out.push(...tagKey(win, 60));
      // 긴 구조물 옆구리의 안전 빗금.
      const warn: ShapeFace[] = [];
      for (let k9 = 0; k9 < 5; k9 += 1) {
        const u9 = -2.4 + k9 * 0.55;
        warn.push([polyPath3([
          [u9, 8.34, BODY_Z0 - 0.08], [u9 + 0.26, 8.34, BODY_Z0 - 0.08],
          [u9 + 0.5, 8.34, BODY_Z0 + 0.24], [u9 + 0.24, 8.34, BODY_Z0 + 0.24],
        ]), 1, k9 % 2 === 0 ? AMBER : "#22262b"] as ShapeFace);
      }
      out.push(...tagKey(warn, 59));
    }

    /* 비행기 출입구는 45도 자리다(지적) — 팔각 몸통의 그 면에 난 노란 아가리다.
       반투명 세 겹이라 안이 이글거린다. */
    {
      const a9 = Math.PI / 4;
      const dsx = Math.sin(a9);
      const dsy = Math.cos(a9);
      if (facingRatio(dsx, dsy) > 0.1) {
        const dtx = Math.cos(a9);
        const dty = -Math.sin(a9);
        const r9 = 5.05;
        const quad = (hw: number, zB: number, zT: number): string => polyPath3([
          [dsx * r9 - dtx * hw, dsy * r9 - dty * hw, zB],
          [dsx * r9 + dtx * hw, dsy * r9 + dty * hw, zB],
          [dsx * r9 + dtx * hw, dsy * r9 + dty * hw, zT],
          [dsx * r9 - dtx * hw, dsy * r9 - dty * hw, zT],
        ]);
        const door: ShapeFace[] = [
          [quad(1.7, BODY_Z0 + 0.16, BODY_Z0 + 1.34), 1, "#23262b"] as ShapeFace,
          [quad(1.56, BODY_Z0 + 0.24, BODY_Z0 + 1.26), 0.55, "#ffd84a"] as ShapeFace,
        ];
        for (let k9 = 0; k9 < 3; k9 += 1) {
          const z9 = BODY_Z0 + 0.34 + k9 * 0.32;
          door.push([quad(1.4, z9, z9 + 0.18), 0.82, "#fff2b0"] as ShapeFace);
        }
        out.push(...tagKey(door, 58));
      }
    }

    /* 착륙판 — 테를 두른 큰 원판이고 안쪽이 파여 있다. 스프라이트에서 가장 큰 면이라
       지붕 규칙 키로 못 박아 어느 각에서도 맨 위다. */
    /* 판을 몸통보다 작게(수리: 판이 몸통과 같은 크기라 앞 격납고와 개인색 슬래브를
       통째로 덮었다) — 스프라이트에서도 판은 지붕 한가운데에 얹힌 원이고 그 둘레로
       슬래브와 앞 구조물이 드러난다. 5.05 → 4.15. */
    out.push(...tagKey(paintBase(cylinderFaces3(0, 0, 4.15, 0.32, PAD_Z), GREY), 40));
    out.push(...tagKey([
      [discPath3(0, 0, PAD_Z + 0.3, 3.75), 1, PADTOP] as ShapeFace,
      capFace(discPath3(0, 0, PAD_Z + 0.31, 3.25), 0.26),
      topFace(discPath3(0, 0, PAD_Z + 0.32, 2.25), 0.15),
    ], 42));

    /* 안테나는 셋이고 120도 간격이다(지적) — 넷을 90도로 두었더니 앞의 긴 구조물과
       겹쳤다. 60·180·300도에 두어 정면(0도)을 비워 준다. 가늘게 뻗어 끝에 어두운
       마디가 달린다. */
    for (const deg9 of [60, 180, 300]) {
      const a9 = (deg9 * Math.PI) / 180;
      const sx9 = Math.sin(a9);
      const sy9 = Math.cos(a9);
      const bx9 = sx9 * 4.0;
      const by9 = sy9 * 4.0;
      /* 안테나를 길게(요청) — 7.15에서 7.55로. 8.3까지 뽑았더니 16칸 모델 상자(±8)를
         넘겨 끝 마디가 잘렸다. 마디 반지름(0.5)까지 세면 7.55가 상한이다. */
      const tx9 = sx9 * 7.55;
      const ty9 = sy9 * 7.55;
      const dep9 = depthNow(tx9, ty9);
      out.push(...tagKey(paintBase(spirePillar({
        x: 0, y: 0, h: 1, w: 0.34, tipW: 0.28, segs: 1, sides: 6, hold: 0.25, caps: "none",
        path: (t9: number): [number, number, number] => [
          bx9 + (tx9 - bx9) * t9, by9 + (ty9 - by9) * t9, PAD_Z + 0.42 + 0.22 * t9,
        ],
      }), "#6a707a"), 44 + dep9));
      /* 끝 부품은 수직으로 가늘고 길게(요청) — 여태 반지름 0.5의 납작한 원통 + 돔이라
         '뭉툭한 혹'으로 보였다. 이제 얇은 받침 위에 가는 장대가 곧게 선다. */
      out.push(...tagKey(paintBase([
        ...cylinderFaces3(tx9, ty9, 0.26, 0.16, PAD_Z + 0.56),
        ...cylinderFaces3(tx9, ty9, 0.13, 1.85, PAD_Z + 0.7),
      ], "#4a505a"), 45 + dep9));
    }

    /* 개인색 — 착륙판 둘레에 눕힌 길쭉한 슬래브 넷(스프라이트의 파랑). 팔과 어긋난
       자리에 놓아 서로 안 가린다. 색을 안 주므로 임자 색이 칠해진다. */
    /* 앞 길다란 구조물 위에는 세로로 길게 개인색 데칼이 들어간다(지적) — 앞뒤로
       길쭉한 띠라, 정면에서 이 건물의 임자 색이 가장 먼저 읽힌다. */
    pc.push(...tagKey(
      boxFaces3(0, 5.5, 0.95, 3.3, 0.2, BODY_Z0 - 0.05 + FRONT_H1),
      48 + depthNow(0, 5.5) * 1.6,
    ));
    /* 정면(0도) 슬래브는 왼쪽으로 옮겼다(지적: "원통 정면의 개인색 구조물은 오른쪽
       개인색 구조물과 대칭으로 왼쪽 옆으로 이동해야해") — 정면에는 이미 길다란
       구조물과 그 위의 세로 데칼이 있어 색이 겹쳤고 좌우 짝도 안 맞아 보였다.
       이제 90도(오른쪽)·270도(왼쪽)가 짝을 이루고 180도(뒤)가 하나 더 있다. */
    for (const deg9 of [90, 180, 270]) {
      const a9 = (deg9 * Math.PI) / 180;
      const sx9 = Math.sin(a9);
      const sy9 = Math.cos(a9);
      const mx9 = sx9 * 4.6;
      const my9 = sy9 * 4.6;
      /* 각도로 걸러 내지 않는다(지적: "옆 뒤 개인색 부품 각도에 따라 안보이는 문제") —
         이건 벽에 칠한 데칼이 아니라 착륙판 둘레에 **눕힌 상자**라, 바깥 법선이 뒤를
         향해도 내려다보는 카메라에는 윗면이 그대로 보인다. facingRatio 컷은 평평한
         데칼용 잣대인데 그것을 상자에 대는 바람에, 임자 색이 어떤 요잉에서는 하나도
         안 남았다. 상자 자신의 faceLight가 이미 안 보이는 면을 걸러 준다. */
      /* 길쭉한 쪽이 둘레를 따라 눕는다 — 앞뒤(0·180)는 가로로 길고 좌우(90·270)는
         세로로 길다. 상자는 못 돌리므로 두 폭을 바꿔 끼운다. */
      const along = Math.abs(sy9) > 0.5;
      pc.push(...tagKey(
        boxFaces3(mx9, my9, along ? 3.6 : 1.25, along ? 1.25 : 3.6, 0.6, PAD_Z),
        44 + depthNow(mx9, my9) * 1.6,
      ));
    }
    return raceBase(out, "terran", pc);
  },
  /* 벙커(실물 참고) — 사방으로 비탈진 날개 판(정사각 배치) + 날개마다 내려오는 계단 +
     가운데 강철 돔 + 윗면 원형 해치. 날개 밝기는 세계 광원(faceLight)이 정한다. */
  tombFlat: () => {
    /* 몸은 통째로 은색이다(지적: 벙커 전체 은색) — 여태 날개·능선·뚜껑이 밑칠 없이
       남아 벙커 전체가 임자 색 덩어리였다. 개인색은 뚜껑 밑동을 한 바퀴 두르는
       포인트 띠 하나만 맡는다. */
    const SILVER9 = "#c9ced6";
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
      out.push([d, 1, SILVER9] as ShapeFace, ...face(d));
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
      out.push([d, 1, SILVER9] as ShapeFace, ...face(d));
    }
    // 뚜껑은 납작하게(지적) — 낮은 돔과 그 높이에 맞춘 해치.
    out.push(...paintBase(domeFaces3(0, 0, 3.6, 2.4, 1.6), SILVER9));
    out.push(topFace(discPath3(0, 0, 4.05, 1.7), 0.3));
    out.push(capFace(discPath3(0, 0, 4.08, 0.7), 0.35));
    /* 개인색 포인트 띠 — 뚜껑 밑동을 한 바퀴 두른다. 돔(제 키 = 깊이 + 2.4)보다
       작은 키를 줘 돔이 띠의 윗면을 덮게 한다 — 안 그러면 납작한 원통이 뚜껑 위에
       초록 판때기로 얹힌다. */
    out.push(...tagKey(cylinderFaces3(0, 0, 3.74, 0.4, 1.2), depthNow(0, 0) + 1));
    /* 사진 디테일 보강(요청) — 앞면에 초록 총안 셋, 네 모서리에 은빛 기둥, 발치에
       노랑·검정 빗금 띠, 왼쪽에 배관 하나. 형태는 지금 것 그대로. */
    if (facingRatio(0, 1) > 0.12) {
      const det: ShapeFace[] = [];
      for (const lx9 of [-1.5, 0, 1.5]) {
        det.push([polyPath3([
          [lx9 - 0.5, 2.62, 0.9], [lx9 + 0.5, 2.62, 0.9],
          [lx9 + 0.5, 2.62, 1.5], [lx9 - 0.5, 2.62, 1.5],
        ]), 1, "#4cd86a"] as ShapeFace);
      }
      for (let k9 = 0; k9 < 7; k9 += 1) {
        const u0 = -3 + k9 * 0.5;
        det.push([polyPath3([
          [u0, 2.64, 0], [u0 + 0.24, 2.64, 0], [u0 + 0.48, 2.64, 0.6], [u0 + 0.24, 2.64, 0.6],
        ]), 1, k9 % 2 === 0 ? "#e8c33a" : "#22262b"] as ShapeFace);
      }
      out.push(...tagKey(det, 12 + depthNow(0, 2.6) * 1.6));
    }
    for (const [cx9, cy9] of [[-2.5, 2.2], [2.5, 2.2], [-2.5, -2.2], [2.5, -2.2]] as
      [number, number][]) {
      out.push(...tagKey(paintBase(boxFaces3(cx9, cy9, 0.5, 0.5, 2.2, 0), "#c9ced6"),
        depthNow(cx9, cy9) * 1.6 + 2));
    }
    out.push(...tagKey(paintBase(tubeFaces(-3.6, 0.6, -3.6, -1.4, 0.32, 0.8), "#8b8f96"),
      depthNow(-3.6, -0.4) * 1.6 + 1));
    return out;
  },
  /* 넥서스(실물 참고) — 절두 황금 피라미드(높이 한 단 낮춤) + 면의 능선 띠 + 꼭대기
     파란 수정 + 사방 삼각 진입받침 + 네 귀 오벨리스크. 뒤 기둥은 피라미드가 가리도록
     먼저 그린다(지적: 기둥이 비쳐 보였다). */
  /* 넥서스(재작도 — 사진 기준, 기존 비율·자세는 그대로) ─────────────────────────
     프로토스의 바탕은 골드다. 여태 절두 피라미드 몸통이 통째로 개인색이라 종족이
     안 읽혔다: 몸을 금빛으로 깔고, 능선 띠에 짙은 금 그림자를 넣어 층을 세운 뒤,
     사이언 수정과 유리 창을 포인트로 얹는다. 개인색은 두 곳 — 꼭대기 수정 받침의
     띠와 네 귀 오벨리스크의 보석이다(가장 눈에 띄는 자리, 그러나 몸은 안 덮는다).
     키값은 한 자로: 부품은 제 자리 depthNow(×1.6), 꼭대기 얹힘만 상수. */
  pyramidWide: () => {
    // 네 모서리 기둥은 형체 확정(요청: "넥서스 4기둥도 형태쪽이라 1티어").
    const pillar = (px: number, py: number): ShapeFace[] => shape(((): ShapeFace[] => {
      const [kx, ky] = project(px, py, 5.8);
      return [
        // 받침 원반도 제 깊이(지적: 기둥 바닥의 원들이 안 가려짐).
        ...tagKey([
          bodyFace(discPath3(px, py, 0.45, 1.6)),
          sideFace(discPath3(px, py, 0.42, 1.6), 0.25),
        ], depthNow(px, py)),
        /* 끝을 도려내고 팁을 꽂는다(재재재지적: 화살촉처럼 튀지 않게) — 팁 원뿔이
           그 높이의 기둥 굵기보다 늘 살짝 굵어 기둥 끝을 완전히 감싼다.
           기둥 몸도 금빛(재작도) — 넷이 통째로 개인색이면 종족이 안 읽힌다. */
        ...paintBase(hornFaces(px, py, 0.4, px, py, 8.8, 1.7), "#c9a227"),
        /* 오벨리스크 보석은 **개인색**이다(지적: "넥서스 사선에서 개인색 장식 포인트가
           안보임") — 여태 여기까지 사이언으로 못 박혀 있어서, 화면에 남은 개인색은
           꼭대기 받침 띠 하나뿐이었다. 그 띠는 지붕에 가려 사선에서 거의 안 보인다.
           네 귀 기둥 끝은 어느 방향에서 봐도 둘 이상 보이는 자리다 — 색을 안 줘
           임자 색이 들게 한다. */
        ...hornFaces(px, py, 6.8, px, py, 8.9, 0.5),
        topFace(groundEllipse(kx, ky, 0.45, 0.65), 0.5),
      ];
    })());
    /* 기둥 자리 6.6 → 6.0(수리: 대각 모서리 기둥이 요잉 투영에서 뷰박스 가로(±8)를
       넘어 잘려 떨어져 나간 듯 보였다 — rx = 6.6cos20 + 6.6sin20 ≈ 8.46). */
    // 6.0 → 5.6(재지적: 왼뒤 기둥이 너무 바깥) — 받침 원반이 피라미드 모서리에 걸치게 붙인다.
    /* 상자 정규화(지적: 넥서스가 발자국을 초과) — 기둥·받침이 요잉 투영에서 ±9까지
       나가 16칸 상자를 넘쳤다. 전체를 0.85배로 눌러 안에 들인다. */
    const GOLD9 = "#c9a227";
    const GOLDD = "#8e6f1a";
    const CYAN9 = "#3bd8c2";
    const GLASS9 = "#7fd4e8";
    const out: ShapeFace[] = [...pillar(-4.7, -4.7), ...pillar(4.7, -4.7)];
    // 몸통은 금빛 바탕(재작도) — 프로토스의 바탕색은 골드다.
    out.push(...paintBase(frustumFaces3(0, 0, 9, 9, 2.8, 2.8, 6.4), GOLD9));
    /* 밑동 한 단(사진) — 몸보다 조금 넓은 짙은 금 받침이 깔려, 피라미드가 땅에서
       솟은 것이 아니라 단 위에 앉은 것으로 읽힌다. */
    out.push(...paintBase(frustumFaces3(0, 0, 9.8, 9.8, 9.2, 9.2, 0.55), GOLDD));
    // 앞면 능선 띠 — 경사면을 따라 층층이 가로 띠. 짙은 금으로 그늘을 넣어 층이 산다.
    const half = (z: number): number => 4.5 - (4.5 - 1.4) * (z / 6.4);
    for (const bz of [1.4, 3, 4.6]) {
      const w0 = half(bz) - 0.35;
      const w1 = half(bz + 0.6) - 0.35;
      const band = polyPath3([
        [-w0, half(bz), bz], [w0, half(bz), bz],
        [w1, half(bz + 0.6), bz + 0.6], [-w1, half(bz + 0.6), bz + 0.6],
      ]);
      out.push([band, 1, GOLDD] as ShapeFace);
      out.push(topFace(band, 0.2));
    }
    /* 앞면 유리 창(사진) — 능선 사이에 세로로 긴 사이언 유리 셋. 앞이 보일 때만
       그린다(뒤로 돌면 몸 위로 떠오른다). */
    if (faceLight(0, 1).visible) {
      for (const wx9 of [-1.55, 0, 1.55] as const) {
        out.push(...tagKey([[polyPath3([
          [wx9 - 0.45, half(2.1), 2.1], [wx9 + 0.45, half(2.1), 2.1],
          [wx9 + 0.36, half(4.4), 4.4], [wx9 - 0.36, half(4.4), 4.4],
        ]), 1, GLASS9] as ShapeFace], depthNow(wx9, 3.6) * 1.6 + 1));
      }
    }
    // 꼭대기 받침 + 수정 — 지붕 키로 가림 해결(지적) + 옥색~시안 고정색(지적).
    // 받침 띠는 개인색(칠하지 않는다) — 가장 높고 사방에서 보이는 첫째 포인트.
    out.push(...tagKey([
      ...paintBase(boxFaces3(0, 0, 3.1, 3.1, 0.45, 6.4), GOLDD),
      // 받침 띠도 한 뼘 키운다 — 사선에서 지붕에 덜 가리게(지적).
      ...boxFaces3(0, 0, 3.2, 3.2, 0.55, 6.8),
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
      // 발판도 제 깊이(지적: 기둥과 가려짐 순서) — 앞 발판만 기둥 위로. 몸과 같은 금빛.
      out.push(...tagKey([[d, 1, GOLD9] as ShapeFace, ...face(d)], depthNow(sx * 5.5, sy * 5.5)));
    }
    out.push(...pillar(-5.6, 5.6), ...pillar(5.6, 5.6));
    /* 옆면 사이언 빗살(사진) — 몸이 금빛이 된 만큼 빗살은 종족 팔레트의 사이언으로
       또렷하게 세운다(전엔 탁한 청록이라 금빛 위에서 묻혔다). */
    for (const m9 of [-1, 1] as const) {
      const fin: ShapeFace[] = [];
      for (let k9 = 0; k9 < 5; k9 += 1) {
        fin.push(...paintBase(boxFaces3(m9 * 3.4, -1.6 + k9 * 0.85, 0.8, 0.24, 1.2, 1.2), CYAN9));
      }
      out.push(...tagKey(fin, depthNow(m9 * 3.4, 0) * 1.6 + 1));
    }
    /* 네 귀 오벨리스크 받침 — 짙은 금 원반 둘. 그 위 보석만 개인색(둘째 포인트).
       은색은 테란의 바탕색이라 여기서 걷었다. */
    for (const [ox9, oy9] of [[-4.3, 3], [4.3, 2.8], [-4.5, -2.4], [4.5, -2.6]] as
      [number, number][]) {
      out.push(...tagKey(paintBase([
        ...cylinderFaces3(ox9, oy9, 1.05, 0.35, 0),
        ...cylinderFaces3(ox9, oy9, 0.62, 0.45, 0.35),
      ], GOLDD), depthNow(ox9, oy9) * 1.6 - 2));
      out.push(...tagKey(domeFaces3(ox9, oy9, 0.42, 0.5, 0.8), depthNow(ox9, oy9) * 1.6));
    }
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
    /* 소환구도 화면 원으로(지적: "구 형태가 찌그러져 보이잖아") — 세로로 긴 타원
       (1.1×1.4)이라 서 있는 빛기둥처럼 보였다. 구는 어느 시점에서도 원이다. */
    out.push(...tagKey([
      [screenCircle(wx, wy, 1.2), 0.5, "#a9ecf2"] as ShapeFace,
      topFace(screenCircle(wx - 0.3, wy - 0.3, 0.6), 0.4),
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
    /* 사진 디테일(요청) — 탑 밑동에 금 무늬 골. 발판 위 원판은 청록을 걷고 개인색
       자리로 삼는다(요청) — 네 발판에 하나씩이라 사방 어디서 봐도 임자 색이 깔린다.
       칠하지 않아야 임자 색이 드니 아래 gated.push로 따로 얹는다. */
    /* 탑 밑동을 두르던 금 원판 둘은 걷었다(지적: 게이트 기둥쪽 원판 제거) — 납작한
       원통이라 탑에 판때기가 꽂힌 꼴이었다. */
    /* 몸은 금빛 바탕(재작도) — 여태 발판·마당·어금니 탑이 통째로 개인색이라 종족이
       안 읽혔다. 남은 밑칠을 금으로 덮고, 개인색은 아래 두 곳만 남긴다. */
    const gated: ShapeFace[] = paintBase(out, "#c9a227");
    /* 발판 위 장식(지적: "게이트 발판위 장식을 긴 직육면체 띠모양으로하고 색이 연하게
       들어가고 있어서 원래색으로 변경") — 여태는 반지름 1.05·높이 0.16짜리 납작한
       원통이었다. 그렇게 납작하면 실루엣이 곧 윗면이라, cylinderFaces3가 마지막에
       얹는 흰 윗면(topFace, 농도 0.3)이 원판을 통째로 덮었다. 임자 색 위에 흰색이
       3할 깔린 셈이라 "색이 연하게" 보인 것 — 알파도 밝기 보정도 아니고 이 흰 덮개가
       원인이다. 그래서 원통을 걷고, 흰 덮개 없이 몸판과 옆 그늘만 쓰는 직육면체 띠를
       손으로 짠다. 윗면이 밑칠 그대로라 임자 색이 제 색으로 든다.
       띠는 중심에서 발판으로 가는 축과 직각으로 길게 눕혀, 발판을 가로지르는 긴
       직육면체가 된다. */
    {
      /* 발판은 안쪽 변 h에서 바깥 변 0.32로 기운 쐐기다(pad의 LO9) — 그 한복판
         높이에 띠를 앉혀야 한쪽 끝이 뜨거나 파묻히지 않는다. */
      /* 두께 없는 데칼로(요청: "게이트 발판위 개인색은 두께없는 데칼로 발판 윗면에 딱
         붙이기") — 직육면체 띠는 옆벽 넷과 윗면을 가져 발판 위에 올라앉은 '블록'으로
         읽혔다. 이제 발판 윗면과 **같은 기울기**의 얇은 사각 하나만 얹는다: 발판은
         안쪽 변 h에서 바깥 변 0.32로 기운 쐐기라, 네 꼭짓점의 높이를 그 규칙 그대로
         셈해 0.02만 띄운다. 면이 하나뿐이라 어느 각도에서도 두께가 안 보인다. */
      const PAD_R9 = 1.8;
      for (const [px9, py9] of [[0, 3.6], [0, -3.6], [3.8, 0], [-3.8, 0]] as [number, number][]) {
        // 중심에서 발판으로 가는 축(바깥 방향) — 발판이 기운 축과 같다.
        const ang9 = Math.atan2(py9, px9);
        const ox9 = Math.cos(ang9);
        const oy9 = Math.sin(ang9);
        /* 그 축과 나란히 긴 데칼(재지적 때의 방향 그대로) — 방사 방향 1.45, 접선 0.34. */
        const zAt9 = (x9: number, y9: number): number => {
          const u9 = ((x9 - px9) * ox9 + (y9 - py9) * oy9) / PAD_R9;
          return (h + 0.32) / 2 - u9 * ((h - 0.32) / 2) + 0.02;
        };
        const lx9 = py9 === 0 ? 1.45 : 0.34;
        const ly9 = py9 === 0 ? 0.34 : 1.45;
        const quad9: [number, number, number][] = [
          [px9 - lx9, py9 - ly9, 0], [px9 + lx9, py9 - ly9, 0],
          [px9 + lx9, py9 + ly9, 0], [px9 - lx9, py9 + ly9, 0],
        ].map(([qx9, qy9]) => [qx9, qy9, zAt9(qx9, qy9)] as [number, number, number]);
        // 색을 안 준 면이라 임자 색이 제 색으로 든다(흰 덮개도 안 얹는다).
        gated.push(...tagKey([bodyFace(polyPath3(quad9))], depthNow(px9, py9) * 1.6 + 0.3));
      }
    }
    /* 문틈 소환 빛은 고정 플라즈마색(요청) — 임자 색이면 어두운 색을 만났을 때 빛이
       아니라 구멍으로 보인다. 반투명 사이언으로 못 박고 흰 심을 얹는다. */
    gated.push(...tagKey([
      [screenCircle(wx, wy, 0.95), 0.62, "#6fe4ff"] as ShapeFace,
      [screenCircle(wx, wy, 0.52), 0.5, "#e8fbff"] as ShapeFace,
    ], 30.1));
    // 탑 어깨의 개인색 띠도 같은 이유로 걷었다 — 개인색은 문틈 빛과 발판 원판이 맡는다.
    return gated;
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
    /* 잎 한 점 — a는 앞뒤(−1~1), w는 접선 반폭(−1~1).
       입체감(요청) — 가운데가 바깥으로 볼록한 얕은 등을 넣어(BULGE) 판이 널빤지가
       아니라 굽은 껍데기로 읽히게 한다.
       옆 휨(요청) — 앞뒤로 갈수록 접선 방향으로 밀어(BEND) 판이 한쪽으로 살짝
       휘어진다. 잎 넷 모두 같은 규칙이라 관문이 한 방향으로 감긴 꼴이 된다. */
    const BULGE = 0.24;
    const BEND = 0.32;
    const HALFW = (a: number): number => Math.min(1, (1 - Math.abs(a)) / 0.5);
    const leafPt = (
      phi: number, rr: number, ll: number, ww: number, a: number, w: number,
    ): [number, number, number] => {
      const rx = Math.sin(phi); // 축에서 바깥 방향(x·z 평면)
      const rz = Math.cos(phi);
      const tx = Math.cos(phi); // 접선 방향
      const tz = -Math.sin(phi);
      const t9 = w * HALFW(a) * ww + BEND * (a * a - 0.42);
      const r9 = rr + BULGE * (1 - w * w);
      return [rx * r9 + tx * t9, a * ll, C + rz * r9 + tz * t9];
    };
    /* 곧은 관(정정: 자꾸 뒤쪽을 벌리지 말 것) — 나팔 벌림을 걷었다. 잎 넷이
       나란히 서서 반지름이 앞뒤 내내 같다.
       수평으로 눕는다(정정: 대각선으로 눕는 게 아니라) — 앞들림(35도)도 걷었다. */
    const AS9 = [-1, -0.62, -0.24, 0.14, 0.52, 0.86, 1];
    const WS9 = [-1, -0.34, 0.34, 1];
    // 겉 윤곽(두께 테·발광판이 쓰는 옛 꼴) — 격자의 테두리를 그대로 돈다.
    const leaf = (phi: number, rr: number, ll: number, ww: number): [number, number, number][] => [
      ...AS9.map((a) => leafPt(phi, rr, ll, ww, a, 1)),
      ...[...AS9].reverse().map((a) => leafPt(phi, rr, ll, ww, a, -1)),
    ];
    const PHIS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    for (const phi of PHIS) {
      // 판 크기 확대(요청) — 길이 2.2 → 3.1, 접선 반폭 1.05 → 1.5.
      const inPts = leaf(phi, R, 3.1, 1.5);
      /* 판 두께(지적) — 바깥쪽(축 반대 방향)으로 한 겹 더 깔면 가장자리로 두께 테가
         비친다. */
      const outPts = leaf(phi, R + 0.42, 3.1, 1.5);
      /* 명암·순서는 현재 시점 기준(재재지적: 겉판·속판 순서 — 시청자 쪽 잎은 겉판이
         가깝다) — 위 잎과 카메라를 마주 보는 옆 잎은 겉판을 나중에, 아래 잎과 등 돌린
         옆 잎은 속판을 나중에 그린다. */
      const fSide = facingRatio(Math.sin(phi), 0);
      const outerNear = Math.cos(phi) > 0.5 ? true
        : Math.cos(phi) < -0.5 ? false : fSide > 0;
      /* 잎 판은 금빛(재작도) — 프로토스의 바탕색은 골드다. 여태 네 잎이 통째로
         개인색이라 종족이 안 읽혔다. 개인색은 아래 '목구멍 발광'만 맡는다. */
      const GOLD9 = "#c9a227";
      /* 껍데기 한 겹을 접선 방향 띠 셋으로 나눠 그린다(요청: 입체감 있는 판) —
         가운데 띠는 바깥으로 볼록해 밝고, 양 가장자리 띠는 말려 들어가 어둡다.
         한 장짜리 다각형으로는 어떤 음영을 얹어도 널빤지로 보였다. */
      const shell = (rr: number, lift: number): ShapeFace[] => {
        const fs: ShapeFace[] = [];
        for (let wi = 0; wi < WS9.length - 1; wi += 1) {
          const w0 = WS9[wi];
          const w1 = WS9[wi + 1];
          const dd = polyPath3([
            ...AS9.map((a9) => leafPt(phi, rr, 3.1, 1.5, a9, w0)),
            ...[...AS9].reverse().map((a9) => leafPt(phi, rr, 3.1, 1.5, a9, w1)),
          ]);
          fs.push([dd, 1, GOLD9] as ShapeFace);
          const mid9 = (w0 + w1) / 2;
          if (Math.abs(mid9) < 0.4) fs.push(topFace(dd, 0.1 + lift));
          else fs.push(sideFace(dd, 0.2 - lift * 0.4));
        }
        return fs;
      };
      const litOut = Math.cos(phi) > 0.5 ? 0.12 : Math.cos(phi) < -0.5 ? 0 : fSide < -0.3 ? 0 : 0.06;
      const faces: ShapeFace[] = outerNear ? shell(R, 0) : shell(R + 0.42, litOut);
      /* 옆면 봉합(지적: 판 사이가 떠 보임) — 안판·바깥판의 대응 변 사이를 네모 띠로
         이어 두께의 옆구리를 채운다. 윤곽 전부라 어느 각에서도 틈이 없다. */
      for (let i = 0; i < inPts.length; i += 1) {
        const j = (i + 1) % inPts.length;
        faces.push([polyPath3([inPts[i], inPts[j], outPts[j], outPts[i]]), 1, GOLD9] as ShapeFace,
          sideFace(polyPath3([inPts[i], inPts[j], outPts[j], outPts[i]]), 0.22));
      }
      faces.push(...(outerNear ? shell(R + 0.42, litOut) : shell(R, 0)));
      /* 잎 안쪽(배) 발광 — 배가 시점을 향할 때만(지적: 바깥판 위에 밝은 점이 얹혀
         보였다). 위 잎은 늘 바깥이 보이니 빼고, 아래 잎은 배가 위라 늘 켜고, 옆
         잎은 바깥이 등을 돌린 쪽만 켠다. */
      const bellyOn = Math.cos(phi) > 0.5 ? false
        : Math.cos(phi) < -0.5 ? true : fSide < -0.1;
      /* 목구멍 발광이 개인색 자리다(재작도) — 잎 안쪽의 빛나는 면을 팀색으로 두고
         그 위에 흰 하이라이트를 얹는다. 관문 속이 임자의 색으로 타오른다. */
      if (bellyOn) {
        const belly9 = polyPath3(leaf(phi, R - 0.18, 1.35, 0.58));
        faces.push(bodyFace(belly9), topFace(belly9, 0.45));
      }
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
       수평 링이 감싼다. 링 둘레에는 세로 갈고리 여섯이 위아래로 뻗고, 링 자체엔
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
    /* 요청: "크기 1.5배로 키우고 대신 링 반지름은 살짝 줄임" — 화면에 찍히는 덩치는
       모델 좌표가 아니라 발자국 채움 목표가 정한다(구운 판의 잉크 폭을 재서 발자국의
       몇 할이 되게 늘렸다 줄였다 한다). 그래서 1.5배는 BLD_FILL_TARGET.diamond 쪽에
       주고, 여기서는 가장 넓은 부품인 링만 한 뼘 줄인다(5.5 → 5.1). 같은 폭 안에서
       수정이 차지하는 몫이 그만큼 커진다. 갈고리·보석 자리(4.95 → 4.6)도 링을 따라
       안으로 들어온다. */
    const rxo = 5.1;
    const ryo = rxo * 0.45;
    const rxi = 4.1;
    const ryi = rxi * 0.45;
    /** 갈고리·보석이 걸리는 링 허리 반지름. */
    const RING_R = 4.6;
    const ringBack = `M${cx - rxo} ${cy} A${rxo} ${ryo} 0 0 1 ${cx + rxo} ${cy} L${cx + rxi} ${cy} A${rxi} ${ryi} 0 0 0 ${cx - rxi} ${cy} Z`;
    const ringFront = `M${cx - rxo} ${cy} A${rxo} ${ryo} 0 0 0 ${cx + rxo} ${cy} L${cx + rxi} ${cy} A${rxi} ${ryi} 0 0 1 ${cx - rxi} ${cy} Z`;
    /* 세로 갈고리 — 링 자리에서 위·아래로 뻗는 한 쌍의 뿔. 끝이 안쪽으로 모여
       수정을 감싼다. */
    /* 갈고리는 링에 안 가린다(지적) — 링은 무깊이 손 면이라 직전 깊이를 물려받아
       요잉에 따라 갈고리를 덮었다. 갈고리마다 제 자리 깊이를 달아, 앞쪽 갈고리는
       링 위로 뒤쪽 갈고리는 링 뒤로 간다. */
    /* 요청: "개인색을 고리에 적용하고 두르는 조각들은 금색으로 변경" — 임자 색과
       금색의 자리를 통째로 맞바꿨다. 링을 두르는 조각이 곧 이 갈고리들이라 금색을
       못 박고, 색을 안 준 면(=임자 색)은 링만 갖는다. */
    const CLAW9 = "#c9a227";
    const claw = (ang: number): ShapeFace[] => {
      const a = (ang * Math.PI) / 180;
      const bx = Math.sin(a) * RING_R;
      const by = Math.cos(a) * RING_R;
      return tagKey(paintBase([
        ...hornFaces(bx, by, PY_M - 0.4, bx * 0.72, by * 0.72, PY_M + 3, 1.05),
        ...hornFaces(bx, by, PY_M + 0.4, bx * 0.72, by * 0.72, PY_M - 3.4, 1.05),
      ], CLAW9), depthNow(bx, by) + 1);
    };
    // 링에 박힌 청록 띠 — 갈고리 사이사이.
    const gems: ShapeFace[] = [];
    for (const ang of [30, 90, 150, 210, 270, 330]) {
      const a = (ang * Math.PI) / 180;
      gems.push([groundEllipse(cx + Math.cos(a) * RING_R, cy + Math.sin(a) * (RING_R * 0.45), 0.62, 0.3),
        0.9, "#3bd8c2"] as ShapeFace);
    }
    // 뒤 갈고리 → 뒤 링 → 수정 → 앞 링 → 앞 갈고리 순으로 겹친다.
    for (const ang of [180, 120, 240]) out.push(...claw(ang));
    // 링은 색을 안 준다 = 임자 색(요청). 금색은 두르는 갈고리들이 맡는다.
    out.push(...tagKey([bodyFace(ringBack), sideFace(ringBack, 0.3),
      ...gems.slice(3)], depthNow(0, -RING_R)));
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
      depthNow(0, RING_R)));
    for (const ang of [0, 60, 300]) out.push(...claw(ang));
    return out;
  },
  /* 로보틱스(실물 참고, 곡선의 미) — 둥근 대야와 도톰한 링 테두리, 어두운 격자 구덩이,
     테두리의 매끈한 흰 가시, 그리고 테두리에서 구덩이 위로 부드럽게 굽어 드리우는 팔. */
  dome: () => {
    const out: ShapeFace[] = [];
    const pc: ShapeFace[] = [];
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
      /* 벽을 위아래로 가른다 — 위 띠(mid→hi)만 개인색이다(재지적: 몸통 전체 말고
         테두리만). 대야를 통째로 칠하면 건물이 임자 색 덩어리가 되고, 위 링 테두리는
         청록 띠에, 밑동 테는 대야 그림자에 묻혀 안 보였다. */
      const md9 = rim9(4.42, 1.95);
      const wall: ShapeFace[] = [];
      const band: ShapeFace[] = [];
      for (let i9 = 0; i9 < N9; i9 += 1) {
        const mid9 = ((i9 + 0.5) / N9) * Math.PI * 2;
        const nx9 = Math.cos(mid9);
        const ny9 = Math.sin(mid9);
        const fl9 = faceLight(nx9, ny9, 0.35);
        if (!fl9.visible) continue;
        const d9 = polyPath3([lo9[i9], lo9[i9 + 1], md9[i9 + 1], md9[i9]]);
        wall.push(bodyFace(d9), ...fl9.face(d9));
        const b9 = polyPath3([md9[i9], md9[i9 + 1], hi9[i9 + 1], hi9[i9]]);
        band.push(bodyFace(b9), ...fl9.face(b9));
      }
      out.push(...tagKey([bodyFace(polyPath3(lo9)), ...wall], depthNow(0, 0) + 2.7));
      pc.push(...tagKey(band, depthNow(0, 0) + 2.72));
      /* 대야 윗면은 개인색이 아니다(지적: 청록 판을 걷으니 통째로 임자 색이 드러났다)
         — 띠 뒤에 그려 테만 남긴다. */
      out.push(...tagKey([
        bodyFace(polyPath3(hi9)), topFace(polyPath3(hi9), 0.1),
      ], depthNow(0, 0) + 2.74));
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
    out.push(bodyFace(annulusPath(rcx, rcy, 4.15, 3.35, 0.484)));
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
        /* 뿌리 마디만 굵게(지적: "로보틱스 집게의 첫번째 뿌리 마디 두껍게 수정.
           나머지는 지금두께 유지") — 팔은 1.15 → 1 → 0.9 → 0.8로 가늘어지는 네
           마디인데, 첫 마디가 다음 마디와 거의 같은 굵기라 대야에 박힌 뿌리가 아니라
           그냥 긴 막대로 읽혔다. 여기만 1.75로 키워 밑동이 굵고 끝이 가는 팔이 된다.
           나머지 셋과 집게 손가락은 지금 굵기 그대로다. */
        ...rodFaces(0, -3.5, 2.6, 0, -2.9, 8.2, 1.75),
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
    /* 사진 디테일(요청) — 밑동에 금 무늬 골을 판다. 대야 테를 두르던 청록 띠는
       걷었다(지적: 프로토스 짙은 녹색판 제거) — 넓고 납작한 원통이라 위에서 보면
       건물 위에 초록 판때기가 얹힌 꼴이었다. */
    out.push(...tagKey(paintBase(cylinderFaces3(0, 0, 5.2, 0.28, 0.3), "#8a6f2a"),
      depthNow(0, 0) * 1.6 - 1));
    return raceBase(out, "toss", pc);
  },
  /* 터렛(실물 참고) — 원통 받침 + 상자 머리 + 세로 미사일 랙 둘 + 옆으로 빠지는 배관. */
  turret: () => [
    /* 받침은 사각기둥이다(요청: "터렛 받침은 사각기둥") — 원기둥이었는데, 위에 얹힌
       머리 상자·포드가 전부 각진 것이라 밑동만 둥글어 따로 놀았다.
       그리고 **개인색을 뺀다**(요청: "본체 개인색 제거") — 색을 안 준 맨 원기둥이라
       임자 색이 통째로 칠해져, 터렛이 색 막대 위에 머리를 얹은 꼴이었다. 다른 테란
       건물과 같은 기본색으로 굳히고, 임자 색은 아래 포드 앞면 데칼 하나만 갖는다. */
    /* 몸통을 줄인다(요청: "터렛 몸통 크기 줄이고") — 6.2 → 5.2. 터렛의 실루엣은 위에
       얹힌 포드 한 쌍이지 밑동이 아닌데, 밑동이 굵어 '기둥에 얹은 상자'로 읽혔다. */
    ...paintBase(boxFaces3(0, 0.4, 5.2, 5.2, 3.4), "#868d94"),
    /* 밑동 공사장 노랑·검정 대각선 띠 — 사각기둥이 되었으니 네 벽에 하나씩 두른다.
       보이는 벽만 그리고, 위 모서리를 앞으로 밀어 사선을 만든다. */
    ...((): ShapeFace[] => {
      const faces: ShapeFace[] = [];
      const HW = 2.63;   // 밑동 반폭(위 5.2의 절반에서 살짝 안쪽)
      const side = (
        nx9: number, ny9: number, pt: (t: number, z: number) => [number, number, number],
      ): void => {
        if (facingRatio(nx9, ny9) < 0.05) return;
        faces.push([polyPath3([pt(0, 0.2), pt(5.2, 0.2), pt(5.2, 1.4), pt(0, 1.4)]),
          1, "#d9ae35"] as ShapeFace);
        for (let t = 0.3; t < 4.4; t += 1.25) {
          faces.push([polyPath3([pt(t, 0.2), pt(t + 0.5, 0.2), pt(t + 0.9, 1.4), pt(t + 0.4, 1.4)]),
            1, "#1b1e23"] as ShapeFace);
        }
      };
      side(0, 1, (t, z) => [-HW + t, 0.4 + HW, z]);
      side(0, -1, (t, z) => [HW - t, 0.4 - HW, z]);
      side(1, 0, (t, z) => [HW, 0.4 + HW - t, z]);
      side(-1, 0, (t, z) => [-HW, 0.4 - HW + t, z]);
      return faces;
    })(),
    // (제거·지적: 기둥 옆 막대기 제거) — 옆으로 삐친 관이 정체불명 막대로 보였다.
    /* 머리 상자는 밑둥 위 얹힘 — 밑둥(키 없음)보다 큰 붙박이 키 2를 갖는다. 둘레
       포드는 이 20을 기준으로 제 자리 깊이만큼 앞뒤로 갈린다(지적: 터렛 키값 — 포드가
       24+깊이라 뒤로 돌아간 포드까지 늘 머리 위에 그려졌다). 20은 밑둥이 제 몫으로
       다는 키(깊이 + 반지름 3.1)를 늘 이기는 값이다. */
    ...tagKey(paintBase(boxFaces3(0, 0, 3.6, 2.8, 3.6, 3.6), "#c9ced6"), 20), // 윗부분 은색(요청)
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
      /* 개인색은 **옆면 맨 앞쪽 띠**다(요청: "포드 데칼은 포드 앞면이 아니라 옆면 맨
         앞쪽을 띠로 두름") — 앞면에 붙이면 정면에서만 보이고 옆에서는 사라졌다. 옆면
         앞 끝을 세로로 두르면 어느 쪽에서 봐도 둘 중 하나는 보인다. 면보다 아주 조금
         (0.01) 밖에 띄워 z-싸움을 피한다. */
      const bandF0 = pvt(1.9, 0.6);
      const bandF1 = pvt(1.9, 4.6);
      const bandB0 = pvt(1.18, 0.6);
      const bandB1 = pvt(1.18, 4.6);
      const sideBand = (m2: 1 | -1): string => polyPath3([
        [rx + m2 * 0.76, bandF0[0], bandF0[1]], [rx + m2 * 0.76, bandF1[0], bandF1[1]],
        [rx + m2 * 0.76, bandB1[0], bandB1[1]], [rx + m2 * 0.76, bandB0[0], bandB0[1]],
      ]);
      /* 포드는 머리 위 얹힘(지적) — 지붕 규칙로 큰 키. 면들은 고정으로 그리지 않고
         faceLight 판정(재지적: 옆면이 한쪽뿐이라 가려지거나 남았다) — 앞·뒤는 기운
         법선(0,±0.96,0.27), 옆은 (±1,0)로 보이는 면만 제 음영과 함께. */
      const faces: ShapeFace[] = [];
      const fr = faceLight(0, 0.96, 0.27);
      if (fr.visible) faces.push(bodyFace(front), ...fr.face(front));
      const bk = faceLight(0, -0.96, 0.27);
      if (bk.visible) faces.push(bodyFace(backQ), ...bk.face(backQ));
      for (const m2 of [1, -1] as const) {
        const sl = faceLight(m2, 0);
        if (!sl.visible) continue;
        const d = sideQ(m2);
        faces.push(bodyFace(d), ...sl.face(d));
      }
      faces.push(bodyFace(top), topFace(top, 0.2));
      /* 포드 은색(요청) — 머리(키 2)를 기준으로 제 자리 깊이만큼 앞뒤가 갈린다.
         앞면 띠만 색을 안 줘 임자 색이 든다(요청: "포드 앞쪽에 개인색 데칼 넣기") —
         paintBase는 색 없는 면만 칠하므로, 칠한 뒤에 얹어야 데칼이 살아남는다. */
      return tagKey([
        ...paintBase(faces, "#c9ced6"),
        // 색을 안 준 면이라 임자 색이 든다 — 칠한 뒤에 얹어야 데칼이 살아남는다.
        ...([1, -1] as const).filter((m2) => faceLight(m2, 0).visible)
          .map((m2) => bodyFace(sideBand(m2))),
      ], 20 + depthNow(rx, 0.2) * 1.6);
    }),
    // 꼭대기 작은 상자 — 머리·포드보다 위라 붙박이 키 26.
    ...tagKey(paintBase(boxFaces3(0, -0.2, 2.2, 1.8, 1.6, 7.2), "#c9ced6"), 26),
    /* 사진 디테일 보강(요청) — 머리 둘레에 붉은 미사일 슬롯 여덟이 방사로 박힌다.
       요잉을 따라 돌고 뒤로 간 것은 안 그린다. 형태는 지금 것 그대로. */
    ...Array.from({ length: 8 }, (_, k9) => {
      const a9 = (k9 / 8) * Math.PI * 2;
      const sx9 = Math.sin(a9);
      const sy9 = Math.cos(a9);
      if (facingRatio(sx9, sy9) <= 0.05) return [];
      // 슬롯은 꼭대기 상자(키 26)를 둘러 박히므로 그 26을 기준으로 앞뒤가 갈린다.
      return tagKey(paintBase(
        boxFaces3(sx9 * 1.7, sy9 * 1.7 - 0.2, 0.55, 0.55, 0.9, 7.4), "#a8322a",
      ), 26 + depthNow(sx9 * 1.7, sy9 * 1.7) * 1.6);
    }).flat(),
  ],
  /* 포톤 캐논(실물 참고) — 납작한 원형 판(고리 무늬) + 테두리 포드 여덟 + 가운데 가는
     수정 기둥(빛나는 끝). */
  coil: () => {
    /* 키는 프리미티브 규약대로(지적: 포토 키 검토) — 붙박이 −6·−5.5·−5는 받침 안팎을
       한 줄로 세워, 뒤로 돌아간 톱니까지 늘 받침 위에 그려졌다. 받침·톱니는 제 몫으로
       키를 다는 프리미티브라 그대로 두고(앞 톱니는 앞, 뒤 톱니는 뒤), 손으로 그린
       뚜껑 면들만 받침 바로 위 키를 준다. */
    const out: ShapeFace[] = [...cylinderFaces3(0, 0, 5.6, 1.3)];
    /* 지적: "포톤캐논 본체는 금색으로 변경하고 개인색은 톱니 윗면들에 적용" — 뚜껑
       안쪽 판이 쥐고 있던 임자 색을 걷어 몸 전체를 종족 금색(raceBase)으로 넘기고,
       개인색은 둘레 톱니 여덟의 윗면만 맡는다. 사방 45도로 박힌 톱니라 어느 요잉에서도
       서너 장은 눈에 든다. */
    const pc: ShapeFace[] = [];
    out.push(...tagKey([bodyFace(discPath3(0, 0, 1.34, 4.4))], 1.35));
    out.push(...tagKey([
      topFace(discPath3(0, 0, 1.38, 3.2), 0.2),
      capFace(discPath3(0, 0, 1.41, 2.1), 0.3),
    ], 1.4));
    /* 뚜껑 가운데의 링 구조물(지적: "포토 윗뚜껑은 평평하지 않고 가운데 링모양의 입체
       구조물이 붙어있음") — 여태 뚜껑은 원반 셋을 겹친 **평면**이라, 위에서 내려다볼수록
       접시에 무늬만 그린 꼴이었다. 두께 있는 짧은 원통을 얹고 가운데를 어둡게 파, 가운데
       포탑이 그 구멍을 뚫고 서는 고리로 만든다. */
    {
      const RZ = 1.42;   // 뚜껑 윗면
      const RH = 0.62;   // 고리 높이
      out.push(...tagKey([
        ...cylinderFaces3(0, 0, 3.05, RH, RZ),
        capFace(discPath3(0, 0, RZ + RH + 0.01, 1.95), 0.42),
        topFace(annulusPath(...((): [number, number, number, number] => {
          const [ax9, ay9] = project(0, 0, RZ + RH + 0.02);
          return [ax9, ay9, 3, 2];
        })()), 0.16),
      ], 1.45));
    }
    /* 톱니는 몸통 밖에(지적: 반쯤 파묻힌 톱니가 통째로 비쳐 어색) — 벽에 살짝만 닿게
       반지름을 밖으로 빼면, 앞 톱니는 벽 앞·뒤 톱니는 벽 뒤로 자연히 갈린다. */
    /* 톱니를 방사 방향으로 돌려 세운다(지적: "포토 이빨 회전시 안 도는 느낌") —
       여태는 여덟 개가 모두 모형 축에 나란한 네모 상자였다. 자리는 45도씩 돌아
       있어도 면의 법선은 여덟 개가 전부 같은 네 방향이라, 명암이 톱니마다 똑같이
       들고 요잉을 돌려도 무늬가 그대로였다. 이제 톱니마다 제 방사 방향(u)과 접선
       방향(v)으로 상자를 세운다 — 바깥 면이 저마다 다른 쪽을 보므로 밝은 톱니가
       요잉을 따라 둘레를 돌아간다. 바깥으로 갈수록 좁아지는 쐐기라 방향도 읽힌다. */
    for (let i = 0; i < 8; i += 1) {
      const a = (i * 45 * Math.PI) / 180;
      const ux9 = Math.sin(a); const uy9 = Math.cos(a);   // 방사(바깥)
      const vx9 = Math.cos(a); const vy9 = -Math.sin(a);  // 접선
      const tx9 = ux9 * 6.15;
      const ty9 = uy9 * 6.15;
      // 안쪽 반폭 0.86, 바깥 반폭 0.5 — 밖으로 좁아지는 쐐기.
      const quad9 = (z9: number): [number, number, number][] => ([
        [tx9 - ux9 * 0.75 - vx9 * 0.86, ty9 - uy9 * 0.75 - vy9 * 0.86, z9],
        [tx9 - ux9 * 0.75 + vx9 * 0.86, ty9 - uy9 * 0.75 + vy9 * 0.86, z9],
        [tx9 + ux9 * 0.75 + vx9 * 0.5, ty9 + uy9 * 0.75 + vy9 * 0.5, z9],
        [tx9 + ux9 * 0.75 - vx9 * 0.5, ty9 + uy9 * 0.75 - vy9 * 0.5, z9],
      ]);
      const lo9 = quad9(0);
      const hi9 = quad9(1.7);
      const tooth9: ShapeFace[] = [bodyFace(polyPath3(lo9))];
      const walls9 = lo9.map((_, k9) => {
        const j9 = (k9 + 1) % 4;
        const mx9 = (lo9[k9][0] + lo9[j9][0]) / 2 - tx9;
        const my9 = (lo9[k9][1] + lo9[j9][1]) / 2 - ty9;
        const ml9 = Math.hypot(mx9, my9) || 1;
        return {
          d: polyPath3([lo9[k9], lo9[j9], hi9[j9], hi9[k9]]),
          nx: mx9 / ml9, ny: my9 / ml9, f: facingRatio(mx9 / ml9, my9 / ml9),
        };
      }).sort((q9, w9) => q9.f - w9.f);
      for (const wl9 of walls9) {
        const fl9 = faceLight(wl9.nx, wl9.ny, 0.3);
        tooth9.push(bodyFace(wl9.d), ...(fl9.visible ? fl9.face(wl9.d) : [sideFace(wl9.d, 0.46)]));
      }
      out.push(...tagKey(tooth9, depthNow(tx9, ty9) * 1.6));
      /* 윗면만 개인색이다 — 몸판 위에 같은 네모를 한 장 더 얹는다. 깊이 키는 제 톱니
         바로 위(+0.4)라 어느 요잉에서도 제 톱니에 붙어 다닌다. */
      const capD = polyPath3(hi9);
      pc.push(...tagKey([bodyFace(capD), topFace(capD, 0.2)], depthNow(tx9, ty9) * 1.6 + 0.4));
    }
    /* 가운데 포탑은 받침 위 얹힘(재지적: 바닥이 포탑을 가림) — 지붕 띠 키로 받침
       (반지름 키)·이음 원반들을 늘 이긴다. */
    out.push(...tagKey([
      ...cylinderFaces3(0, 0, 0.55, 4.6, 1.3),
      /* 꼭대기 주사바늘(재지적: 가운데 포탑이 안 돎) — 화면 고정 사선 대신 모델 좌표
         뿔로: 축에서 −x 쪽으로 기운 높은 끝이라, 요잉하면 기운 방향이 함께 돈다. */
      ...hornFaces(0, 0, 5.7, -0.45, 0, 7.6, 1.05),
    ], 24 + depthNow(0, 0)));
    /* 사진 디테일(요청) — 금 포드가 둘레로 박힌다. 받침의 초록 원반은 걷었다
       (지적: 프로토스 짙은 녹색판 제거). */
    for (let k9 = 0; k9 < 8; k9 += 1) {
      const a9 = (k9 / 8) * Math.PI * 2;
      const px9 = Math.sin(a9) * 2.7;
      const py9 = Math.cos(a9) * 2.7;
      if (facingRatio(Math.sin(a9), Math.cos(a9)) <= 0.05) continue;
      /* 포드는 뚜껑 위 얹힘 — 뚜껑(키 1.4)을 늘 이기게 2를 기준으로 제 깊이만큼
         살짝 갈린다(붙박이 큰 값이면 뒤 포드가 포탑 위로 튄다). */
      out.push(...tagKey(paintBase(boxFaces3(px9, py9, 0.75, 0.75, 0.7, 0.3), "#c9a227"),
        2 + depthNow(px9, py9) * 0.1));
    }
    return raceBase(out, "toss", pc);
  },
  /* 성큰(실물 참고) — 납작한 크립 더미 + 잔가시들 + 웅크린 큰 낫 발톱(끝 밝은 날). */
  sunken: () => {
    /* 성큰 콜로니(전면 재작도·사진) — 낮게 퍼진 짙은 갈색 살덩이 위로 구릿빛 촉수
       그루터기들이 솟고, 그 사이사이에 상아빛 낫 날이 사방으로 눕는다. 등에는 검은
       가시가 돋고, 가운데 큰 촉수만 개인색이라 임자가 한눈에 읽힌다. */
    const FLESH = "#6b4732";
    /* 지적: "콜로니류 바닥판은 검회색으로" — 성큰에는 바닥판이 없어 살덩이 둔덕이
       땅에 바로 앉아 있었다. 스포어에만 있던 검회색 받침을 같은 상수(COLONY_BASE)로
       깔아 콜로니 셋의 발치를 통일한다. 크립 얼룩을 감싸던 paintBase는 걷었다 —
       얼룩의 면은 이미 검정이 박혀 있어 그 껍데기는 아무 일도 하지 않았고, 바닥판이
       칠해진 것처럼 읽히게 해 이 지적을 늦게 만든 원인이기도 하다. */
    const out: ShapeFace[] = [...creepSplat(6.6)];
    out.push(...tagKey(paintBase(spirePillar({
      x: 0, y: 0, z0: 0, h: 0.9, w: 5.5, tipW: 4.5,
      segs: 3, sides: 14, hold: 0.15, taper: 1.8,
    }), COLONY_BASE), -1));
    // 몸 — 볼록한 살덩이 둔덕.
    out.push(...tagKey(paintBase(spirePillar({
      x: 0, y: 0, z0: 0, h: 2.4, w: 4.3, tipW: 1.8,
      segs: 6, sides: 14, hold: 0, taper: 0.55,
    }), FLESH), 0));
    /* 상아빛 낫 날 여섯 — 바닥에 눕듯 사방으로 뻗는 납작한 칼. 뿌리는 몸에 묻힌다. */
    /* 날은 가시가 아니라 뾰족한 혓바닥(요청) — 훨씬 길고 두껍게 뽑아 살덩이에서
       늘어진 혀처럼 보이게 한다. 길이 3.3~4.3 → 5.2~6.4, 밑동 두께 0.6~0.72 → 1.5~1.8. */
    for (const [ang, len, w9] of [
      [-160, 5.4, 1.55], [-105, 6.2, 1.75], [-45, 5.8, 1.65],
      [25, 6.4, 1.8], [85, 5.5, 1.6], [145, 5.2, 1.5],
    ] as [number, number, number][]) {
      const a9 = (ang * Math.PI) / 180;
      const dx = Math.sin(a9);
      const dy = Math.cos(a9);
      out.push(...tagKey(ivory(hornFaces(
        dx * 1.6, dy * 1.6, 1.5, dx * (1.6 + len), dy * (1.6 + len), 0.35, w9,
      )), depthNow(dx * 3.4, dy * 3.4) * 1.6 + 1));
    }
    /* 구릿빛 촉수 그루터기 넷은 걷었다(지적: 성큰 위 굴뚝 제거) — 굵고 곧게 서서
       촉수가 아니라 굴뚝 넷으로 읽혔다. 가운데 큰 촉수 하나만 남긴다. */
    /* 가운데 큰 촉수 — 개인색(요청: 건물마다 개인색 포인트). 끝이 아가리처럼 벌어진다. */
    out.push(...tagKey([
      // 낮게(요청) — 높이 3.2 → 1.9, 밑동도 한 뼘 내린다.
      ...spirePillar({
        x: 0.2, y: -0.3, z0: 1.9, h: 1.9, w: 1.05, tipW: 0.5,
        segs: 4, sides: 10, hold: 0.1, taper: 1.3, leanY: 0.45, curveY: -0.3,
      }),
      capFace(discPath3(0.35, 0.15, 3.7, 0.46), 0.5),
    ], 12));
    /* 쏘는 순간의 혓바닥(요청: "현재 모델에 구릿빛 혓바닥만 추가") — 몸은 한 톨도
       안 건드리고, 가운데 촉수의 아가리에서 구릿빛 가시가 앞위로 감겨 나온다.
       가시가 나가는 타이밍에만 이 판을 쓰므로(SHAPE_BUILDERS.sunkenfire), 평소 모습과
       실루엣이 어긋나 건물이 들썩이는 일이 없다. */
    if (sunkenFire) {
      out.push(...tagKey(paintBase(spirePillar({
        x: 0.25, y: -0.15, z0: 3.4, h: 4.4, w: 0.6, tipW: 0.14,
        segs: 9, sides: 8, hold: 0.04, taper: 1.25, leanY: 1.5, curveY: 1.8,
      }), "#b5713a"), 13));
    }
    // 등 검은 가시들 — 몸 옆선 위에 돋는다.
    for (const [ang, sz] of [
      // 더 크고 굵게(요청) — 길이 1.5배, 굵기 0.34 → 0.72.
      [-170, 2.4], [-120, 3], [-70, 2.5], [10, 2.9], [70, 2.4], [130, 2.7],
    ] as [number, number][]) {
      const a9 = (ang * Math.PI) / 180;
      const dx = Math.sin(a9) * 2.9;
      const dy = Math.cos(a9) * 2.9;
      out.push(...tagKey(paintBase(hornFaces(
        dx, dy, 1.1, dx * 1.3, dy * 1.3, 1.1 + sz, 0.72,
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
    /* 밑동 — 검회색 받침(지적: "콜로니류 바닥판은 검회색으로"). 색값을 여기 박아
       두면 성큰·크립과 따로 놀게 되므로 공용 상수로 돌렸다. 셋 중 이것만 키가 높은
       것은 몸통이 그만큼 가늘게 시작하기 때문이라 지름·높이는 그대로 둔다. */
    out.push(...tagKey(paintBase(spirePillar({
      x: 0, y: 0, z0: 0, h: 1.5, w: 5.2, tipW: 3.2,
      segs: 3, sides: 14, hold: 0.15, taper: 1.8,
    }), COLONY_BASE), 0));
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
    /* 지적: "콜로니류 바닥판은 검회색으로" — 성큰과 같은 사연이다. 얼룩만 있고
       바닥판이 없어 둔덕이 땅에 바로 앉았다. 같은 상수(COLONY_BASE)로 받침을 깔되
       지름은 제 둔덕 밑동(CR_RB 4.6)보다 한 뼘 넓게 잡아 테가 드러나게 했다. */
    const out: ShapeFace[] = [...creepSplat(6.2)];
    out.push(...tagKey(paintBase(spirePillar({
      x: 0, y: 0, z0: 0, h: 0.9, w: 5.8, tipW: 4.8,
      segs: 3, sides: 14, hold: 0.15, taper: 1.8,
    }), COLONY_BASE), -1));
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
    /* 리파이너리(전면 재작도·사진) — 검회색 각진 덩이 여럿이 붙어 서고, 그 사이를
       마디진 은빛 관이 굽어 넘는다. 뒤 가운데엔 검은 나팔 흡입구, 앞에는 은빛 갓을
       쓴 탱크 둘, 발치와 드럼에는 노랑·검정 빗금, 왼앞에는 층진 경사로. 탱크 갓
       하나가 개인색이다. */
    const DARK = "#3a3f46";
    /** 주 덩이 — 테란 기본색(요청). 받침만 DARK로 남긴다. */
    const BODY = "#868d94";
    const STEEL = "#8b8f96";
    const SILVER = "#c2c7cf";
    const out: ShapeFace[] = [];
    // 받침 — 낮고 넓은 검회색 단.
    out.push(...tagKey(paintBase(boxFaces3(0, 0, 8.6, 6, 0.8, 0), DARK), 0));
    // 각진 덩이 넷 — 높이가 제각각인 상자 무리.
    for (const [bx, by, bw, bh, bz] of [
      [-2.4, -1.6, 2.6, 2.2, 3.4], [1.4, -2, 2.4, 2, 4.2],
      [3.2, 0.6, 2.2, 2.6, 3], [-3, 1.8, 2.2, 2, 2.4],
    ] as [number, number, number, number, number][]) {
      out.push(...tagKey(paintBase(boxFaces3(bx, by, bw, bh, bz, 0.8), BODY),
        10 + depthNow(bx, by) * 1.6));
    }
    /* 뒤 검은 나팔 흡입구 — 위로 벌어지는 통. */
    out.push(...tagKey([
      ...paintBase(spirePillar({
        x: -0.2, y: -2.6, z0: 3.4, h: 1.8, w: 1.05, tipW: 1.75,
        segs: 3, sides: 12, hold: 0.2,
      }), "#22262b"),
      capFace(discPath3(-0.2, -2.6, 5.2, 1.55), 0.55),
    ], 20 + depthNow(-0.2, -2.6)));
    /* 마디진 은빛 관 셋 — 덩이 사이를 굽어 넘는다. 마디 테를 군데군데 물린다. */
    ([
      [[-2.4, -1.6, 3.6], [-0.6, 0.4, 4.4], [1.4, -0.6, 4.2]],
      [[1.4, -2, 5], [2.6, 0.4, 4.2], [3.2, 2, 3.2]],
      [[-3, 1.8, 3.2], [-1.6, 2.4, 2.6], [0.4, 2.2, 2.2]],
    ] as [number, number, number][][]).forEach((way, wi) => {
      out.push(...tagKey(paintBase(spirePillar({
        x: 0, y: 0, h: 1, w: 0.42, tipW: 0.42, segs: 12, sides: 8, hold: 1,
        path: (t9: number): [number, number, number] => {
          const u9 = 1 - t9;
          const b9 = (a: number, b: number, c: number): number =>
            u9 * u9 * a + 2 * u9 * t9 * b + t9 * t9 * c;
          return [
            b9(way[0][0], way[1][0], way[2][0]),
            b9(way[0][1], way[1][1], way[2][1]),
            b9(way[0][2], way[1][2], way[2][2]),
          ];
        },
      }), SILVER), 24 + wi * 0.2 + depthNow(way[1][0], way[1][1]) * 1.6));
    });
    /* 앞 탱크 둘 — 은빛 갓을 쓴 통. 오른쪽 갓은 개인색(요청). */
    // 개인색 몫 확대(요청) — 두 탱크 갓 모두 개인색.
    ([[-1.6, 2.6, 1], [1.9, 2.4, 1]] as [number, number, number][]).forEach(([tx, ty, own]) => {
      out.push(...tagKey([
        ...paintBase(cylinderFaces3(tx, ty, 1.15, 1.9, 0.8), STEEL),
        ...(own
          ? domeFaces3(tx, ty, 1.2, 0.85, 2.7)
          : paintBase(domeFaces3(tx, ty, 1.2, 0.85, 2.7), SILVER)),
        capFace(discPath3(tx, ty, 3.5, 0.5), 0.3),
      ], 22 + depthNow(tx, ty)));
    });
    /* 발치 노랑·검정 빗금 띠 — 앞면 아래를 두른다. */
    if (facingRatio(0, 1) > 0.1) {
      const warn: ShapeFace[] = [];
      for (let k = 0; k < 9; k += 1) {
        const u0 = -4.2 + k * 0.52;
        warn.push([polyPath3([
          [u0, 3.02, 0], [u0 + 0.26, 3.02, 0], [u0 + 0.54, 3.02, 0.8], [u0 + 0.28, 3.02, 0.8],
        ]), 1, k % 2 === 0 ? "#e8c33a" : "#22262b"] as ShapeFace);
      }
      out.push(...tagKey(warn, 2 + depthNow(0, 3) * 1.6));
    }
    // 왼앞 층진 경사로.
    out.push(...tagKey(paintBase([
      ...boxFaces3(-3.4, 3.2, 2.4, 1.4, 0.5, 0),
      ...boxFaces3(-3.4, 4.3, 2.1, 1.1, 0.25, 0),
    ], "#5c636d"), depthNow(-3.4, 3.8) * 1.6 + 3));
    return out;
  },
  assim: () => {
    const GOLD = "#c9a227";
    const GOLD_D = "#8a6f2a";
    /* (걷어냄) TEAL — 청록 #2f8f86. 녹색기가 돌아 황금 껍데기 위에서 이끼로 보였다는
       지적으로 렌즈·눈금은 사이언으로, 굴뚝 띠는 개인색으로 옮겼다. */
    const CYAN = "#4fd8ee";
    const out: ShapeFace[] = [];
    /* 개인색 자리(수리) — 바탕색 도우미가 out의 밑칠을 전부 칠하므로, 임자 색으로
       남길 활 띠는 out이 아니라 이 accent에 담는다. */
    const pc: ShapeFace[] = [];
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
    const DR9 = 3.2;
    const DH9 = 2.4;
    out.push(...tagKey(paintBase(domeFaces3(0, -0.2, DR9, DH9, 0), GOLD), 2));
    /* 몸을 타넘는 활 띠 넷 — 앞에서 뒤로 나란히 걸린다. 하나(가운데 앞)는 개인색. */
    // 개인색 몫 확대(요청) — 가운데 두 줄을 개인색으로, 굵기도 키운다.
    /* 띠 순서(요청: "등의 개인색을 맨앞금색 그다음줄 개인색 그다음줄 금색 순서대로
       반복") — 앞에서부터 금·개인·금·개인이다. 여태는 앞 셋이 내리 개인색이라 등판이
       통째로 임자 색으로 읽혔다. */
    ([[1.1, 0], [0.2, 1], [-0.7, 0], [-1.6, 1]] as [number, number][])
      .forEach(([by9, own9]) => {
        /* 활은 껍데기 겉면을 정확히 탄다(지적: 지도에서 정·후면이 같이 보인다) —
           예전엔 반지름을 손으로 줘 다리가 껍데기 밖으로 삐져나왔고, 뒤에서 보면 그
           삐죽한 다리 때문에 앞쪽 띠까지 실루엣 밖에 드러났다. 이제 그 y에서의 돔
           단면(반지름 rho, 높이 DH·rho/DR)을 그대로 따라 3%만 띄운다. */
        const dy9 = by9 + 0.2;
        const rho9 = Math.sqrt(Math.max(0.04, DR9 * DR9 - dy9 * dy9));
        const arcPt = (u9: number): [number, number, number] => {
          const th = Math.PI * u9;
          return [
            Math.cos(th) * rho9 * 1.03, by9,
            Math.sin(th) * DH9 * (rho9 / DR9) * 1.03,
          ];
        };
        /* 활을 토막 내 토막마다 제 깊이로 키를 준다(지적: 지도에서 정·후면이 같이
           보인다) — 띠 하나에 키 하나뿐이라, 옆에서 보면 껍데기 뒤로 넘어간 다리까지
           통째로 껍데기 위에 그려져 넓적한 판때기가 됐다. 토막마다 제 자리 깊이를
           매기면 뒤로 돌아간 쪽은 황금 껍데기가 가린다. 정면에서는 띠 안의 깊이가
           일정해(활은 y가 고정) 종전 그림 그대로다. */
        const SEG9 = 8;
        for (let s9 = 0; s9 < SEG9; s9 += 1) {
          const band = spirePillar({
            x: 0, y: 0, h: 1, w: own9 ? 0.46 : 0.3, tipW: own9 ? 0.46 : 0.3,
            segs: 2, sides: 5, hold: 1,
            path: (t9: number): [number, number, number] => arcPt((s9 + t9) / SEG9),
            ...(own9 ? {} : { fill: GOLD_D }),
          });
          /* 키는 깊이와 높이를 함께 본다 — 껍데기(키 2) 위로 넘어간 마루는 높이가
             띄워 주고, 뒤로 돌아 내려간 다리는 깊이가 껍데기 밑으로 내린다. */
          const [mx9, my9, mz9] = arcPt((s9 + 0.5) / SEG9);
          (own9 ? pc : out).push(...tagKey(band, depthNow(mx9, my9) * 1.6 + mz9 * 2.2));
        }
        // 띠 위 청록 눈금 — 마루에 박힌 짧은 조각 셋. 눈금도 저마다 제 깊이다.
        if (!own9) {
          for (const u9 of [0.34, 0.5, 0.66]) {
            const [tx9, ty9, tz9] = arcPt(u9);
            out.push(...tagKey(
              // 눈금도 녹색기를 뺀다(요청) — 청록(#2f8f86) → 사이언.
              paintBase(domeFaces3(tx9, ty9, 0.24, 0.16, tz9), CYAN),
              depthNow(tx9, ty9) * 1.6 + tz9 * 2.2 + 0.6,
            ));
          }
        }
      });
    /* 앞면 큰 청록 렌즈 — 벽에 수직으로 붙은 볼록 원판(공용 렌즈 도형). */
    /* 앞면 렌즈(요청: "정면 렌즈 장식 더 크게 하고 녹색톤 제거 및 전체를 반투명
       사이언색으로") — 반지름 1.25 → 1.75, 볼록도 0.3 → 0.42. 속을 채우던 짙은 청록
       (#1f7f97)은 녹색기가 돌아 황금 껍데기 위에서 이끼처럼 보였다. 여덟 자리 색으로
       알파를 실어 반투명 사이언으로 바꾼다. */
    out.push(...lensFaces({
      x: 0, y: 2.15, z: 1.35, nx: 0, ny: 1, r: 1.75, bulge: 0.42, lift: 12,
      rim: GOLD_D, fill: "#6fe4ffcc", core: "#c9f4ff", glint: "#f2fdff",
    }));
    /* 네 귀 기둥 — 뒤 둘은 높고 곧게, 앞 둘은 낮고 바깥으로 기운다. 청록 띠와 황금 갓. */
    ([[-2.3, -1.9, 3.4, 0], [2.3, -1.9, 3.4, 0], [-2.7, 1.5, 2.2, -1], [2.7, 1.5, 2.2, 1]] as
      [number, number, number, number][]).forEach(([px, py, ph, lean]) => {
      out.push(...tagKey(paintBase(spirePillar({
        x: px, y: py, z0: 0.3, h: ph, w: 0.55, tipW: 0.42,
        segs: 3, sides: 6, hold: 0.3, leanX: lean * 0.9, leanY: lean === 0 ? 0 : 0.4,
      }), GOLD), 10 + depthNow(px, py) * 1.6));
      /* 굴뚝 띠는 개인색이다(요청: "굴뚝들 녹색데칼 개인색으로 변경") — 색을 안 주면
         임자 색이 들므로 pc에 담는다(out은 밑칠이 통째로 금빛을 덮어쓴다). */
      pc.push(...tagKey(cylinderFaces3(px + lean * 0.45, py + (lean === 0 ? 0 : 0.2),
        0.6, 0.45, 0.3 + ph * 0.55), 10 + depthNow(px, py) * 1.6 + 0.2));
    });
    /* 오른뒤 기둥에서 오르는 초록 가스(사진) — 위로 갈수록 넓고 옅어지는 세 켜. */
    for (const [gz, gr, ga] of [[4, 0.6, 0.3], [5.1, 0.9, 0.18], [6.2, 1.2, 0.1]] as
      [number, number, number][]) {
      out.push(...tagKey([[groundEllipse(
        ...project(2.3 + (gz - 4) * 0.1, -1.9 + (gz - 4) * 0.15, gz), gr, gr * 0.6,
      ), ga, "#7ee03a"] as ShapeFace], 20 + depthNow(2.3, -1.9)));
    }
    // 개인색은 몸을 타넘는 가운데 활 띠 둘(위 own9) — 덧붙였던 원판은 걷어냈다(요청).
    return raceBase(out, "toss", pc);
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
    /* 키를 통 위로 올린다(지적: "가운데 개인색 부분 속부품인가 비쳐보이는거 같음") —
       +4는 양옆 통의 가시·힘줄(키 +11까지)보다 낮아서, 앞에 선 애벌레 위로 통의 속부품이
       그려져 '비쳐 보이는' 그림이 됐다. +14면 통의 어느 부품보다 위다. */
    out.push(...tagKey(spirePillar({
      x: 0, y: 0, h: 1, w: 1.5, tipW: 1.05, segs: 10, sides: 10, hold: 0.1, taper: 1.2,
      path: GRB,
    }), depthNow(0, 0.4) * 1.6 + 14));
    /* 입구(요청: "프리미티브로 바꾸면서 입구쪽 부품 하나 없어진듯?") — 애벌레 앞 끝의
       벌어진 아가리다. 끝점에 어두운 단면을 세우고 그 둘레를 살빛 입술 고리로 두른다. */
    {
      const [mx9, my9, mz9] = GRB(1);
      out.push(...tagKey([
        ...paintBase(domeFaces3(mx9, my9 + 0.15, 1.15, 0.5, mz9 - 0.25), "#8a4a2a"),
        capFace(groundEllipse(...project(mx9, my9 + 0.35, mz9 + 0.05), 0.72, 0.42), 0.62),
      ], depthNow(mx9, my9) * 1.6 + 15));
    }
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
    const STEEL = "#868d94";   // 테란 기본색(요청)
    const DARK = "#3f444b";
    // 붉던 세 자리(드럼 띠·굴뚝 갓·대야 속)는 개인색이 됐다(요청) — 붉은색 상수는 뺀다.
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
    out.push(...tagKey(paintBase(boxFaces3(0, 0.2, 8.4, 5.4, 2, 0), DARK), 4));
    /* 왼쪽 리벳 드럼 돔(사진) — 통 몸에 붉은 띠를 두르고 위는 잿빛 돔 뚜껑. */
    out.push(...tagKey([
      // 전체 높이 상향(요청) — 드럼 몸 2.2 → 3.4, 돔 1.5 → 2.1.
      ...paintBase(cylinderFaces3(-2.6, 0.6, 2.15, 3.4, 1.2), STEEL),
    ], 12 + depthNow(-2.6, 0.6) * 1.6));
    out.push(...tagKey([
      ...paintBase(domeFaces3(-2.6, 0.6, 2.15, 2.1, 4.6), "#7b8088"),
      capFace(discPath3(-2.6, 0.6, 6.75, 0.8), 0.3),
    ], 13 + depthNow(-2.6, 0.6) * 1.6));
    /* 개인색은 여태 붉던 자리들(요청) — 드럼 허리 띠, 굴뚝 두 갓, 오른쪽 대야 속.
       셋이 몸통 좌우와 뒤에 흩어져 어느 요잉에서도 하나는 보인다. */
    const pc: ShapeFace[] = [...tagKey(
      cylinderFaces3(-2.6, 0.6, 2.24, 0.6, 3.4), 12.5 + depthNow(-2.6, 0.6) * 1.6,
    )];
    /* 뒤 굴뚝 탑 둘 — 붉은 갓을 쓴 가는 기둥. 하나는 더 높다. */
    for (const [cx9, cy9, ch9, cr9] of [
      [-1.2, -2.1, 7.2, 0.55], [1.5, -2.4, 5.8, 0.62],
    ] as [number, number, number, number][]) {
      out.push(...tagKey(
        paintBase(cylinderFaces3(cx9, cy9, cr9, ch9, 1.2), DARK),
        16 + depthNow(cx9, cy9) * 1.6,
      ));
      pc.push(...tagKey([
        ...cylinderFaces3(cx9, cy9, cr9 * 1.35, 0.7, 1.2 + ch9 - 0.7),
        capFace(discPath3(cx9, cy9, 1.2 + ch9, cr9 * 0.9), 0.45),
      ], 16.5 + depthNow(cx9, cy9) * 1.6));
    }
    // 가운데 잿빛 원통 — 돔 뚜껑을 쓴 짧은 통.
    out.push(...tagKey([
      ...paintBase(cylinderFaces3(0.2, -0.9, 0.95, 3.8, 1.2), "#8b8f96"),
      ...paintBase(domeFaces3(0.2, -0.9, 0.95, 1, 5), "#9ba3ad"),
    ], 14 + depthNow(0.2, -0.9) * 1.6));
    /* 오른쪽 큰 고리 대야(사진) — 잿빛 테 안이 붉게 파인 원형 우물. 테는 굵다. */
    out.push(...tagKey([
      ...paintBase(cylinderFaces3(3, -0.8, 2.5, 2.6, 1.2), STEEL),
      [discPath3(3, -0.8, 3.82, 2.5), 1, STEEL] as ShapeFace,
    ], 12 + depthNow(3, -0.8) * 1.6));
    pc.push(...tagKey([
      bodyFace(discPath3(3, -0.8, 3.72, 1.75)),
      capFace(discPath3(3, -0.8, 3.65, 1.35), 0.4),
    ], 12.5 + depthNow(3, -0.8) * 1.6));
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
      out.push(...tagKey(paintBase(tab, "#8a6a44"), 18 + depthNow(1.9, 1.7) * 1.6));
      // 단 위 잔 부속 — 작은 원반과 상자.
      out.push(...tagKey([
        ...paintBase(cylinderFaces3(1.2, 1.3, 0.42, 0.24, 3), "#9ba3ad"),
        ...paintBase(boxFaces3(2.5, 1.9, 0.6, 0.5, 0.4, 2.6), DARK),
      ], 20 + depthNow(1.9, 1.6) * 1.6));
    }
    return raceBase(out, "terran", pc);
  },
  /* 엔지니어링 베이(복원) — 사방 대각 팔 끝의 원반 발 넷, 각진 몸체 더미, 끝이
     빛나는 앞 통, 지붕 안테나. */
  ebay: () => {
    const SILVER = "#c9ced6";
    /* 엔지니어링 베이 — 몸통은 **아주 낮은 절두 사각뿔**이다(지적: "본체는 엄청 높이가
       낮은 느낌의 옆면이 사다리꼴 4면으로 되어있는 형태야 앞뒤가 폭이 넓고 옆면 폭은
       비교적 좁은"). 여태는 그냥 직육면체 상자라 옆선이 수직이었고 키도 3이나 돼
       '낮고 넓적한 정비고'가 아니라 창고 같았다. frustumFaces3로 밑 8.4×5.28 → 위
       7.2×3.74, 높이 2.04로 깎으면 네 옆면이 모두 사다리꼴이 되고, 앞뒤 면(폭 8.4)이
       옆면(폭 5.28)보다 훨씬 넓다. 처음 잡은 7×4.4 → 5×2.6, 높이 1.7을 1.2배로
       키우고, 다시 가로세로만 1.2배 한 값이다(요청: "엔지니어링 베이 본체 크기 1.2배
       확대, 높이는 그대로 유지 다리위치는 옮기지 않기") — 높이 2.04와 다리 자리
       (±5.85, ±3.65)는 손대지 않았다.

       배치는 90도 시계방향으로 돌린 그대로다(지적: "엔베 90도 시계방향 요잉") — 드럼은
       왼 옆구리를 따라 눕고, 개인색 큰 드럼이 오른앞으로 튀어나오며, 지붕 더미는 좌우로
       늘어선다. 뷰어 요잉을 건드리면 사용자가 시점을 돌릴 때 같이 돌아 버리므로 모델
       좌표 자체를 돌려 구웠다.

       다리는 여섯 건물 중 가장 크게 벌어지고 가장 긴 사선 다리다(지적) — 그리고 붙는
       자리는 밑판 한복판이 아니라 **거의 끝**이다(지적: "다리는 건물 바닥의 거의 끝에
       달려야해"). 밑판이 7×4.4니 네 귀는 (±3.5, ±2.2)이고, 발판을 (±4.4, ±2.75)로
       내보낸 뒤 lean 0.22를 주면 위끝이 (±3.43, ±2.15) — 밑판 모서리에 딱 걸린다.
       내려오면서 0.97만큼 바깥으로 벌어져 수직에서 31도 누운 사선이 되고, 드러나는
       길이 1.57로 스타포트(1.22)·배럭(1.07)·팩토리(0.92)보다 길다.

       더 눕히되 길이는 다시 조금 줄이고 안으로 당겼다(지적: "더 수평쪽으로 눕도록",
       "다리길이 살짝 줄이고 더 안쪽으로 이동"). 몸통을 1.2배로 키우면서 붙는 자리도
       같이 커진 밑판(±4.2, ±2.64)의 네 귀로 다시 맞췄다 — 발판 (±5.85, ±3.65),
       lean 0.44면 위끝이 (±3.28, ±2.04)다. 모서리에 딱 걸치면 기둥 반지름(0.42)만큼
       단면이 밖으로 삐져나오므로(지적: "다리 단면이 밖으로 안튀어나오게") 한 뼘 안으로
       들였다 — 이제 위끝의 바깥 끝이 (3.7, 2.46)이라 밑판(±4.2, ±2.64) 안이고, 다리는
       몸 뒤에 그려지므로 붙는 자리가 통째로 가려진다. 발판은 그대로 밖에 두어 아래로
       내려오며 평면으로 2.9 벌어지는 사이 높이는 1.37만 떨어진다 — 수직에서 65도
       누운 다리다. */
    const BODY_Z = 1.5;
    /** 몸통 지붕 — 지붕 더미가 앉는 갑판(위 5.0×2.6). */
    const TOP = BODY_Z + 2.04;
    const foot = (fx: number, fy: number): ShapeFace[] =>
      legAndFoot(fx, fy, BODY_Z + 0.25, 0.44);
    /* 지적: "현재 빨간색으로 된 두개의 포인트를 개인색으로 변경" — 오른앞 드럼과 왼뒤
       지붕 돔, 그 둘이 여태 붉은색(#a8322a)이던 포인트다. 색을 지정하지 않은 채 accent
       (pc)로 넘겨야 raceBase가 안 칠하고 임자 색이 들어간다(개인색 규약). 둘 다 덩치가
       있고 앞·뒤로 갈려 있어 어느 요잉에서도 한쪽은 보인다. */
    const pc: ShapeFace[] = [];
    const out: ShapeFace[] = [
      ...foot(-5.85, -3.65), ...foot(5.85, -3.65),
      /* 몸통·드럼은 반드시 제 키를 달아야 한다 — 태그 없는 면은 앞 면의 키를
         물려받는데, 바로 앞이 다리(−40대)라 몸통이 통째로 다리 뒤로 가라앉는다. */
      ...tagKey(paintBase(frustumFaces3(0, 0, 10.08, 6.34, 7.2, 3.74, 2.04, BODY_Z), SILVER), 0),
      // 왼 옆구리를 따라 눕는 작은 드럼 — 끝면이 빛난다.
      ...tagKey([
        ...tubeFaces(-5.3, 1.3, -3.2, 1.3, 0.68, BODY_Z + 1),
        topFace(groundEllipse(...project(-5.3, 1.3, BODY_Z + 1.34), 0.5, 0.4), 0.35),
      ], 6),
      ...foot(-5.85, 3.65), ...foot(5.85, 3.65),
    ];
    // 오른앞 개인색 드럼 — 앞으로 튀어나온 큰 통이라 옆에서도 임자 색이 넓게 읽힌다.
    pc.push(...tagKey(tubeFaces(2.6, 0.6, 2.6, 4.2, 1.1, BODY_Z + 1.05),
      14 + depthNow(2.6, 2.4) * 1.6));
    // 지붕 더미 둘 — 윗면·옆면 은색.
    out.push(...tagKey(paintBase(boxFaces3(-1, 0, 2.8, 2.4, 1.4, TOP), SILVER),
      10 + depthNow(-1, 0) * 1.6));
    out.push(...tagKey(paintBase(boxFaces3(1.4, -0.1, 1.9, 1.9, 2, TOP), SILVER),
      10 + depthNow(1.4, -0.1) * 1.6));
    // 왼뒤 지붕 돔 — 개인색(위 지적). 옆에 붙은 은빛 판은 그대로 둔다.
    pc.push(...tagKey(domeFaces3(-1.5, -0.3, 0.95, 0.8, TOP + 1.4),
      16 + depthNow(-1.5, -0.3) * 1.6));
    out.push(...tagKey(paintBase(boxFaces3(-0.1, -0.3, 1.2, 1.6, 0.35, TOP + 1.4), "#dfe3e6"),
      16 + depthNow(-0.1, -0.3) * 1.6));
    // 지붕 안테나.
    out.push(...tagKey(hornFaces(-2.1, 0.7, TOP + 1.4, -2.1, 0.7, TOP + 3.2, 0.3),
      16 + depthNow(-2.1, 0.7) * 1.6));
    // 앞면 초록 발광 띠 — 앞이 보일 때만.
    if (facingRatio(0, 1) > 0.12) {
      const led: ShapeFace[] = [];
      for (const lx of [-2, -1.2, -0.4]) {
        led.push([polyPath3([
          [lx - 0.24, 1.22, TOP + 0.3], [lx + 0.24, 1.22, TOP + 0.3],
          [lx + 0.24, 1.22, TOP + 1.1], [lx - 0.24, 1.22, TOP + 1.1],
        ]), 1, "#4cd86a"] as ShapeFace);
      }
      out.push(...tagKey(led, 12 + depthNow(-1.2, 1.2) * 1.6));
    }
    return raceBase(out, "terran", pc);
  },
  /* 아머리(실물 참고) — 가운데 우물 드럼(어두운 속·테두리 빛 눈금·비스듬한 뚜껑 판),
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
    return raceBase([
      // 기둥은 셋(지적) — 뒤 첨탑 둘 + 앞 첨탑 하나.
      ...boxFaces3(-3.2, -2.2, 1.4, 1.4, 5.4),
      ...boxFaces3(-3.2, -2.2, 0.7, 0.7, 1.8, 5.4),
      // 뒤 첨탑 꼭대기 안테나와 깃대(사진).
      ...paintBase(cylinderFaces3(-3.2, -2.2, 0.09, 2.4, 7.2), "#c9ced6"),
      ...paintBase(boxFaces3(-2.7, -2.2, 0.9, 0.1, 0.6, 8.6), "#4cd86a"),
      ...boxFaces3(3.4, -1.8, 1.5, 1.5, 6.2),
      ...boxFaces3(3.4, -1.8, 0.8, 0.8, 2, 6.2),
      // 방사 팔 모듈.
      ...boxFaces3(2.4, 0.9, 2, 1.3, 1.5),
      ...boxFaces3(-2.5, 0.7, 1.9, 1.3, 1.4),
      // 앞 팔 모듈의 초록 발광 창(사진).
      ...(facingRatio(0, 1) > 0.12 ? [
        [polyPath3([[1.7, 1.56, 0.5], [3.1, 1.56, 0.5], [3.1, 1.56, 1.1], [1.7, 1.56, 1.1]]),
          1, "#4cd86a"] as ShapeFace,
        [polyPath3([[-3.2, 1.36, 0.5], [-1.8, 1.36, 0.5], [-1.8, 1.36, 1.1], [-3.2, 1.36, 1.1]]),
          1, "#4cd86a"] as ShapeFace,
      ] : []),
      // 가운데 우물 드럼 — 테는 구릿빛, 둘레엔 초록 발광 칸이 빙 둘러 박힌다(사진).
      ...paintBase(cylinderFaces3(0, 0, 2.6, 3), "#8a6a44"),
      capFace(discPath3(0, 0, 3.05, 1.85), 0.45),
      ...Array.from({ length: 14 }, (_, k9) => {
        const a9 = (k9 / 14) * Math.PI * 2;
        return facingRatio(Math.sin(a9), Math.cos(a9)) > 0.05
          ? paintBase(boxFaces3(Math.sin(a9) * 2.65, Math.cos(a9) * 2.65, 0.5, 0.5, 0.9, 1.9),
            "#4cd86a")
          : [];
      }).flat(),
      rim(50), rim(90), rim(130),
      // 앞 첨탑 하나 + 빛 포스트 — 뚜껑 판(개인색)보다 뒤에 그리던 순서를 키로 못 박는다.
      ...tagKey([
        ...boxFaces3(-3.4, 2.4, 1.4, 1.4, 4.6),
        ...boxFaces3(-3.4, 2.4, 0.7, 0.7, 1.6, 4.6),
        ...post(3.7, 2.7, 2.7),
      ], 20),
    ], "terran", [
      /* 개인색은 우물 위 비스듬한 뚜껑 판(요청: 덧붙인 원판 말고 실제 부품에) —
         아머리에서 가장 넓게 눈에 드는 면이라 위에서 임자 색이 그대로 읽힌다. */
      ...tagKey([
        bodyFace(discPath3(0.4, -0.9, 4.3, 1.6)),
        topFace(discPath3(0.4, -0.9, 4.33, 1.15), 0.25),
      ], 10),
    ]);
  },
  /* 사이언스 퍼실리티(정정: 엔베가 아니라 이 건물이었다) — 드럼 발 위에 떠 있는
     둥근 층층 플랫폼, 가운데 큰 갈빗살 돔(농구공 반쪽), 원통 모듈, 초록 불 띠. */
  scifac: () => {
    /* 사이언스 퍼실리티(재작도 — 원작 스프라이트 기준) ──────────────────────────────
       "회원들이 못알아봐 — 만들 때 가장 중요한 건 원작의 특징을 살려서 알아볼 수 있게
       하는 것"이라는 지적을 받았다. 그래서 이 건물을 알아보게 하는 **두 가지**를 먼저
       세우고 나머지를 거기 맞췄다:
         ① 지붕을 덮는 **크고 납작한 타원 접시** — 원작에서 가장 먼저 눈에 드는 것이고,
            둥근 돔이 아니라 한쪽으로 길쭉한 타원이라는 점이 특징이다. 여태 반지름 3의
            원뿔이라 작고 동그래서 딴 건물처럼 보였다. 가로 4.9 · 세로 2.7로 키우고
            납작하게 눕혀 지붕을 거의 덮게 한다. 개인색은 이 접시다(요청).
         ② 옆구리의 **초록 발광 띠** — 원작의 초록 불이 이 건물의 두 번째 표지다.
            네 칸짜리 작은 띠를 크게 키우고 둘레 포드에도 한 줄씩 넣어 어느 각에서도
            초록이 보이게 한다.
       몸은 다리 위에 떠 있다(테란 건물 공통) — 지면에 앉히면 원작의 실루엣이 안 나온다. */
    const BRONZE = "#c2c7cf";
    const BRONZE_D = "#8b8f96";
    const STEEL = "#dfe3e6";
    const GRID = "#22262b";
    const LED = "#4cd86a";
    const out: ShapeFace[] = [];
    const BASE_Z = 0.95;

    // 다리 넷 — 거의 수직으로 내려가고 밑에 발판(테란 건물 공통 구조).
    for (const [gx9, gy9] of [[-3.6, 2.6], [3.6, 2.4], [-3.8, -2.4], [3.8, -2.6]] as
      [number, number][]) {
      out.push(...legAndFoot(gx9, gy9, BASE_Z + 0.2));
    }
    // 받침 — 넓고 낮은 단. 다리 위에 뜬다.
    out.push(...tagKey(paintBase(frustumFaces3(0, 0, 8.2, 6.2, 7, 5.2, 1.3, BASE_Z), BRONZE_D), 0));
    // 본체 — 위로 좁아지는 덩치.
    out.push(...tagKey(paintBase(frustumFaces3(0, -0.2, 5.6, 4.2, 4.4, 3.2, 1.9, BASE_Z + 1.3), BRONZE), 6));

    /* 둘레 포드 넷 — 어두운 격자 뚜껑을 쓴 둥근 통. 원작에도 네 귀에 이런 통이 앉는다.
       통마다 초록 띠를 한 줄 둘러, 접시에 가려 몸통 띠가 안 보이는 각도에서도 초록이
       살아 있게 한다. */
    for (const [px, py] of [[-3, 1.7], [3, 1.5], [-3.2, -1.5], [3.2, -1.7]] as [number, number][]) {
      const dep9 = depthNow(px, py) * 1.6;
      out.push(...tagKey([
        ...paintBase(cylinderFaces3(px, py, 1.35, 1.15, BASE_Z + 1.3), BRONZE),
        ...paintBase(cylinderFaces3(px, py, 1.42, 0.3, BASE_Z + 2.45), GRID),
        capFace(discPath3(px, py, BASE_Z + 2.78, 1.15), 0.4),
      ], 12 + dep9));
      // 포드 허리의 초록 띠 — 앞을 향한 쪽만.
      const nx9 = px / Math.hypot(px, py);
      const ny9 = py / Math.hypot(px, py);
      if (facingRatio(nx9, ny9) > 0.1) {
        const tx9 = -ny9;
        const ty9 = nx9;
        const r9 = 1.38;
        out.push(...tagKey([[polyPath3([
          [px + nx9 * r9 - tx9 * 0.85, py + ny9 * r9 - ty9 * 0.85, BASE_Z + 1.62],
          [px + nx9 * r9 + tx9 * 0.85, py + ny9 * r9 + ty9 * 0.85, BASE_Z + 1.62],
          [px + nx9 * r9 + tx9 * 0.85, py + ny9 * r9 + ty9 * 0.85, BASE_Z + 2.14],
          [px + nx9 * r9 - tx9 * 0.85, py + ny9 * r9 - ty9 * 0.85, BASE_Z + 2.14],
        ]), 0.95, LED] as ShapeFace], 13 + dep9));
      }
    }

    /* 옆구리 초록 발광 띠 — 원작의 표지 둘째. 네 칸을 크게 키웠다. 앞이 보일 때만. */
    if (facingRatio(0, 1) > 0.1) {
      const led: ShapeFace[] = [];
      led.push([polyPath3([
        [-2.0, 1.9, BASE_Z + 1.5], [2.0, 1.9, BASE_Z + 1.5],
        [2.0, 1.9, BASE_Z + 2.62], [-2.0, 1.9, BASE_Z + 2.62],
      ]), 1, GRID] as ShapeFace);
      for (const lx of [-1.42, -0.47, 0.48, 1.43]) {
        led.push([polyPath3([
          [lx - 0.34, 1.93, BASE_Z + 1.62], [lx + 0.34, 1.93, BASE_Z + 1.62],
          [lx + 0.34, 1.93, BASE_Z + 2.5], [lx - 0.34, 1.93, BASE_Z + 2.5],
        ]), 0.95, LED] as ShapeFace);
      }
      out.push(...tagKey(led, 9 + depthNow(0, 1.9) * 1.6));
    }

    // 가운데 원통 모듈 — 본체 위에 누운 통.
    out.push(...tagKey(paintBase(tubeFaces(-1.6, -0.6, 1.6, -0.6, 0.8, BASE_Z + 3.1), STEEL),
      16 + depthNow(0, -0.6)));

    /* ★ 크고 납작한 타원 접시 — 이 건물의 얼굴이다. 개인색(요청).
       바탕색 도우미가 몸의 밑칠을 전부 칠하므로, 개인색 부품은 out이 아니라 accent에
       담아야 색 없이 남는다(수리: 접시가 은색으로 묻혀 있었다).
       원기둥·돔 도우미는 전부 정원이라 타원이 안 나온다 — 화면 타원(groundEllipse)을
       두 켜로 겹쳐 두께 있는 접시를 만든다. 아래 켜를 조금 내려 그리면 그 사이가
       접시의 옆테로 읽힌다. */
    /* 접시를 건물 한가운데로 옮기고 조금 줄였으며, 화면 타원 대신 각진 기둥으로
       낸다(요청: "반구 건물의 중앙으로 위치좀 맞추고 크기 살짝 줄이고 스파이어필라
       사용"). 화면 타원은 어느 요잉에서도 같은 방향으로 누워 있어 몸이 돌아도 접시만
       안 도는 것처럼 보였다 — spirePillar는 단면을 실제로 세우므로 요잉을 따라 돌고
       면이 살아 금속으로 읽힌다. 낮고 넓게(높이 0.8, 밑 2.7 → 윗 1.95) 잡아 반구라기
       보다 접시에 가깝게 둔다. 개인색이다(요청). */
    const pc: ShapeFace[] = [...tagKey(spirePillar({
      x: 0, y: 0, z0: BASE_Z + 3.4, h: 0.8, w: 2.7, tipW: 1.95,
      segs: 2, sides: 16, hold: 0.25, caps: "top",
    }), 30)];

    /* 뒤 가는 안테나 둘 — 원작의 왼뒤 안테나. */
    for (const [ax, ay, ah] of [[-2.6, -2.6, 3.2], [-1.7, -3.0, 2.4]] as [number, number, number][]) {
      out.push(...tagKey([
        ...paintBase(cylinderFaces3(ax, ay, 0.13, ah, BASE_Z + 2.4), STEEL),
        capFace(discPath3(ax, ay, BASE_Z + 2.4 + ah, 0.28), 0.4),
      ], 20 + depthNow(ax, ay)));
    }
    return raceBase(out, "terran", pc);
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
    const pc: ShapeFace[] = [];
    // 은빛 발 넷 — 바닥에 낮게 깔린 판.
    for (const [fx, fy] of [[-3.4, 2.6], [3.4, 2.4], [-3.6, -1.6], [3.6, -2]] as [number, number][]) {
      // 발은 바닥에 깔리므로 한 칸 아래.
      out.push(...tagKey(paintBase(boxFaces3(fx, fy, 1.5, 1.1, 0.35, 0), "#c9ced6"),
        depthNow(fx, fy) - 2));
    }
    /* 큰 황금 돔(오른뒤) — 위에 청록 눈. 옆구리에 붉은 띠. */
    out.push(...tagKey([
      ...paintBase(cylinderFaces3(2.2, -0.6, 3, 1.4, 0.3), GOLD_D),
      ...paintBase(domeFaces3(2.2, -0.6, 3, 3.4, 1.7), GOLD),
      /* 붉은 띠는 겉면만 두른다(수리: 위 태엽과 같은 결의 비침) — 원통 도형은 실루엣을
         통째로 채우는 몸판 + 밝은 윗면 원반이라, 돔 허리에 끼워 넣은 이 띠가 돔 속에
         숨기는커녕 돔 앞면을 큼직한 원반으로 덮어 버렸다(흰 윗면까지 겹쳐 분홍 얼룩으로
         보였다). 띠에 필요한 것은 돔을 두르는 겉벽뿐이므로, 위·아래 타원의 '앞 반호'
         둘을 이어 초승달 띠로 직접 그린다 — 뒤로 돌아간 반쪽은 돔이 가리는 게 맞다. */
      ...((): ShapeFace[] => {
        const BR = 3.04;
        const [btx, bty] = project(2.2, -0.6, 2.3);
        const [bbx, bby] = project(2.2, -0.6, 1.9);
        const bry = BR * groundSquashNow();
        // 앞 반호는 sweep 0(왼→아래→오른), 되돌아오는 아래 반호는 sweep 1이다.
        const strip = `M${btx - BR} ${bty} A${BR} ${bry} 0 0 0 ${btx + BR} ${bty}`
          + ` L${bbx + BR} ${bby} A${BR} ${bry} 0 0 1 ${bbx - BR} ${bby} Z`;
        return [[strip, 1, RED] as ShapeFace, sideFace(strip, 0.16)];
      })(),
    /* 키는 한 자로(재지적: 포지 키값이 아직 문제) — 붙박이 상수(6·8·10·12·14·16)가
       깊이 항(±5)보다 커서 요잉과 무관하게 상수가 순서를 지배했다. 부품들은 서로
       옆에 선 것들이라 제 자리 깊이만으로 앞뒤가 옳다. 같은 부품 안에서 '위에 얹힌'
       것(돔의 눈, 관 팔)만 소수점 한 자리를 더한다. */
    ], depthNow(2.2, -0.6) + 3));
    // 큰 돔 꼭대기 청록 눈 — 테 두른 발광 원반.
    out.push(...tagKey([
      [discPath3(2.2, -0.6, 5.05, 1.15), 1, GOLD_D] as ShapeFace,
      [discPath3(2.2, -0.6, 5.12, 0.86), 0.95, CYAN] as ShapeFace,
      topFace(discPath3(2.2, -0.6, 5.18, 0.45), 0.5),
    ], depthNow(2.2, -0.6) + 3.5));
    /* 앞오른쪽 작은 돔 — 같은 눈을 인다. */
    out.push(...tagKey([
      ...paintBase(domeFaces3(2.6, 2.4, 1.6, 1.7, 0.35), GOLD),
      [discPath3(2.6, 2.4, 2.08, 0.62), 0.95, CYAN] as ShapeFace,
    ], depthNow(2.6, 2.4) + 1.6));
    /* 왼쪽 황금 뿔탑 셋(사진) — 밑동이 굵고 끝이 뾰족한 첨탑. 세로 골이 있다. */
    for (const [tx, ty, th, tw] of [
      [-3, -1.2, 5.4, 0.95], [-1.9, -1.9, 6.4, 1.05], [-0.8, -1.2, 4.6, 0.85],
    ] as [number, number, number, number][]) {
      out.push(...tagKey(paintBase(spirePillar({
        x: tx, y: ty, z0: 0.3, h: th, w: tw, tipW: 0.1,
        segs: 5, sides: 8, hold: 0.18, taper: 1.4,
      }), GOLD), depthNow(tx, ty) + tw));
    }
    /* 뿔탑에서 큰 돔으로 건너가는 관 팔 넷 — 마디진 황금 관. */
    // 장식 축소(요청: 과도한 장식 제거) — 관 팔 넷 → 둘.
    for (let k = 0; k < 2; k += 1) {
      const sy9 = -1.6 + k * 0.9;
      const ax = -2.1 + k * 0.5;
      out.push(...tagKey([
        ...paintBase(tubeFaces(ax, sy9, 1.4, sy9 + 0.9, 0.26, 3.2 - k * 0.35), GOLD_D),
        ...paintBase(tubeFaces(ax + 0.9, sy9 + 0.3, ax + 1.1, sy9 + 0.36, 0.34, 3.2 - k * 0.35), GOLD),
      // 관 팔은 뿔탑과 돔 사이를 건너므로 제 가운데 깊이 + 반 칸만 얹는다.
      ], depthNow((ax + 1.4) / 2, sy9 + 0.45) + 0.5));
    }
    /* 앞왼쪽 골진 황금 단(사진) — 층층이 골이 팬 낮은 상자. 개인색은 이 단만(재지적:
       몸통 전체 말고 일부만) — 큰 돔을 통째로 칠하니 건물이 임자 색 덩어리가 됐다.
       앞자리 낮은 상자라 색은 눈에 들되 황금 몸은 그대로 남는다. 골 줄은 제 색. */
    {
      const blk: ShapeFace[] = [...boxFaces3(-2.4, 2.3, 3.6, 2.6, 1.7, 0.3)];
      // 골은 셋만(요청: 장식 축소). 곁 혹도 걷는다.
      for (let k = 0; k < 3; k += 1) {
        const gx = -3.5 + k * 1.1;
        blk.push(...paintBase(boxFaces3(gx, 2.3, 0.3, 2.7, 0.34, 2), GOLD_D));
      }
      pc.push(...tagKey(blk, depthNow(-2.4, 2.3) + 1.3));
    }
    /* 앞쪽 톱니 바퀴(복원·지적: 포지의 킥인데 빠졌다) — 좌우를 보고 선 2/3 원 판에
       이빨이 둘러 박힌다. 안팎 두 판을 이빨 슬래브로 봉합해 두께를 준다. */
    {
      /* 바퀴를 왼쪽으로 물린다(지적: 포지 키값) — 여태 바퀴(x −4.4~−3.1, y ±3.3)와
         앞왼쪽 골진 단(x −4.2~−0.6, y 1.0~3.6)이 서로의 속을 파고들어, 어떤 키를 줘도
         한쪽이 다른 쪽을 잘라 먹었다. 겹치는 건 키가 아니라 자리 문제다. */
      const WX0 = -5.7;
      const WX1 = -4.4;
      const CZ = 1.8;
      const RIM = 2.5;
      const half = (x9: number): [number, number, number][] => Array.from(
        { length: 15 },
        (_, i9) => {
          const a9 = -Math.PI / 6 + ((Math.PI * 4) / 3) * (i9 / 14);
          return [x9, 1.6 - Math.cos(a9) * RIM, CZ + Math.sin(a9) * RIM] as [number, number, number];
        },
      );
      /* 옆판 둘은 깊이 순으로 쌓는다(수리·지적: 태엽 속이 비친다) — 여태 바깥판(WX0)을
         먼저, 안판(WX1)을 맨 나중에 그렸는데 이 건물이 서는 요잉에서는 WX0 쪽이 오히려
         시청자에게 가깝다. 가까운 판을 먼저 깔고 먼 판으로 덮은 셈이라, 바퀴 겉이 아니라
         속(뒤판과 그 위에 얹힌 흰 윗면 음영)이 앞으로 나와 판이 비쳐 보였다. 이 묶음은
         키(tagKey)를 하나만 쓰므로 zsorted가 안을 다시 세워 주지 않는다 — 여기서 직접
         먼 판 → 둘레 띠 → 가까운 판 차례로 못 박는다. */
      const nearX = depthNow(WX0, 0) >= depthNow(WX1, 0) ? WX0 : WX1;
      const farX = nearX === WX0 ? WX1 : WX0;
      const lp = half(farX);
      const rp = half(nearX);
      /* 이빨을 '먼 켜 / 옆벽 / 가까운 켜'로 흩어 놓는다(지적: "포지 태엽반원뒤의 이가
         비쳐보임") — 앞선 수리(9ac89de)는 이빨 한 짝 **안에서만** 먼 뚜껑 → 옆벽 →
         가까운 뚜껑 차례를 잡았을 뿐, 이빨 묶음 전체를 앞판(가까운 옆판)보다 나중에
         그리는 건 그대로 뒀다. 옆판 둘은 x로 1.3 떨어져 있어 화면에서 0.9쯤 어긋나
         찍히므로, 바퀴 뒤쪽 이빨의 '먼 쪽' 면들은 앞판 실루엣 **안**으로 떨어진다
         (재 보면 deg -18은 먼 뚜껑 네 점이 모두 앞판 안, deg 12는 둘이 안이다).
         뒤 이빨이 앞판을 뚫고 비쳐 보인 게 그것이다. x로 밀어낸 기둥 몸의 옳은 화가
         순서는 '먼 뚜껑 전부 → 옆벽 전부 → 가까운 뚜껑 전부'라, 맨 나중에 오는 앞판이
         제 뒤에 놓인 것들을 한 번에 덮는다. */
      const g: ShapeFace[] = [bodyFace(polyPath3(lp))];
      const walls: ShapeFace[] = [];
      const nearCaps: ShapeFace[] = [];
      /* 드러난 판의 명암은 세계 광원이 정한다(요청: 돌려도 광원 고정) — 왼쪽을 보는
         판이면 밝고 오른쪽을 보는 판이면 어둡다. 붙박이 밝기(0.2·0.14)는 어느 판이
         앞에 서느냐에 따라 뒤집혀 보였다. */
      const nearLit = faceLight(nearX === WX0 ? -1 : 1, 0);
      // 이빨 — 테 둘레에 고르게 박힌 사다리 슬래브.
      for (const deg of [-18, 12, 42, 72, 102, 132, 162, 192]) {
        const a3 = (deg * Math.PI) / 180;
        const c3 = Math.cos(a3);
        const s3 = Math.sin(a3);
        const tooth = (xx: number): [number, number, number][] => [
          [xx, 1.6 - c3 * RIM + s3 * 0.2, CZ + s3 * RIM + c3 * 0.2],
          [xx, 1.6 - c3 * RIM - s3 * 0.2, CZ + s3 * RIM - c3 * 0.2],
          [xx, 1.6 - c3 * (RIM + 0.85) - s3 * 0.14, CZ + s3 * (RIM + 0.85) - c3 * 0.14],
          [xx, 1.6 - c3 * (RIM + 0.85) + s3 * 0.14, CZ + s3 * (RIM + 0.85) + c3 * 0.14],
        ];
        const tf = tooth(farX);
        const tn = tooth(nearX);
        const fa = polyPath3([tf[1], tn[1], tn[2], tf[2]]);
        const fb = polyPath3([tf[0], tn[0], tn[3], tf[3]]);
        // 먼 뚜껑은 뒷판과 같은 켜로, 옆벽은 테 띠와 같은 켜로, 가까운 뚜껑은 앞판 뒤로.
        g.push(bodyFace(polyPath3(tf)));
        walls.push(bodyFace(polyPath3([tf[3], tn[3], tn[2], tf[2]])));
        walls.push(bodyFace(fa), sideFace(fa, 0.18));
        walls.push(bodyFace(fb), topFace(fb, 0.1));
        nearCaps.push(bodyFace(polyPath3(tn)), ...nearLit.face(polyPath3(tn)));
      }
      // 테 둘레 띠와 이빨 옆벽은 한 켜다 — 둘 다 옆판 둘 사이를 잇는 벽이라 자리가 같다.
      for (let i9 = 0; i9 < lp.length - 1; i9 += 1) {
        g.push(bodyFace(polyPath3([lp[i9], lp[i9 + 1], rp[i9 + 1], rp[i9]])));
      }
      g.push(...walls);
      g.push(bodyFace(polyPath3(rp)), ...nearLit.face(polyPath3(rp)));
      g.push(...nearCaps);
      /* 앞쪽 중심축(요청: "포지 톱니 앞쪽에 중심축을 납작한 원통 붙임") — 바퀴 한가운데
         (y 1.6 · z CZ)에서 가까운 판 밖으로 짧게 튀어나온 원통이다. 축이 있어야 반원
         톱니가 '돌아가는 바퀴'로 읽힌다. 가까운 판이 어느 쪽이냐에 따라 나가는 방향이
         뒤집히므로 nearX의 부호를 그대로 쓴다. */
      const axOut = nearX === WX0 ? -0.5 : 0.5;
      g.push(...paintBase(tubeFaces(nearX, 1.6, nearX + axOut, 1.6, 0.62, CZ, true), GOLD_D));
      /* 톱니 바퀴는 y로 깊은 부품(반지름 2.5) — 가운데 깊이만 쓰면 제 앞쪽이 실제보다
         뒤로 잡힌다. 프리미티브와 같은 규약으로 앞점을 더한다. */
      out.push(...tagKey(paintBase(g, GOLD_D), depthNow(-3.8, 1.6)
        + Math.min(5, 0.65 * Math.abs(depthNow(1, 0)) + RIM * Math.abs(depthNow(0, 1)))));
    }
    return raceBase(out, "toss", pc);
  },
  /* 사이버네틱스 코어(실물 참고) — 가운데 드럼 위 파란 발광 고리, 그 뒤로 솟는 발톱
     손가락 셋, 둘레 네 포드마다 파란 구슬이 얹힌다. */
  cyber: () => {
    /* 사이버네틱스 코어(재작도) — 지적: "코어 구슬 안가려짐 및 코어 구슬 4개를 앞쪽에
       주르륵 이어붙여 놓기 및 본체 위쪽에 쌩쌩 돌아가는 플라즈마 디스크 모양 추가(링
       모양). 구슬받침은 금색으로 하고 개인색은 본체 옆을 두르는띠로 표현".
       사방에 흩어 두었던 포드 넷을 통째로 걷었다 — 포드 몸이 개인색이었고 구슬이 그
       위에 얹혀 뒤로 돈 것은 드럼에 가렸다. 대신 구슬 넷을 건물 앞(+y)에 서로 닿게
       한 줄로 늘어놓고, 무엇에도 안 가리도록 그리는 순서 키를 가장 크게 못 박았다.
       "쌩쌩 돌아가는"은 줄 수 없다 — SHAPE_FACES가 빌더를 한 번 구워 쓰는 정지 화면
       이라 이 렌더러엔 시간 축이 없다. 그래서 수평 링 하나에 서로 반대로 42도 기운
       링 둘을 엇갈려 얹어, 도는 고리의 잔상처럼 읽히게 했다.
       개인색은 본체 허리를 두르는 띠 하나로만 남긴다(지적) — raceBase의 accent에
       그 띠만 넣고 나머지(구슬·받침·링·발광 고리)는 모두 고정색으로 못 박았다. */
    const PLASMA_RING = "#6fe4ff";
    /* 구슬 넷을 둥근 몸에 맞춰 두른다(재지적: "코어는 일자가 아니라 둥근 몸체에 맞게
       붙어야 하고 발판도 각각") — 여태는 앞으로 내민 긴 선반 하나 위에 넷이 일자로
       서 있었다. 이제 드럼 둘레를 따라 앞쪽 ±54도 안에 넷을 벌려 놓고, 저마다 제
       금색 발판을 딛는다. 발판도 방사 방향으로 세워 드럼 벽에 붙는다.
       앞으로 돌아온 구슬은 드럼 위로(키 16+), 뒤로 넘어간 구슬은 드럼 뒤로(키 -7+)
       간다 — 늘 맨 앞에 두면 뒤에 있어야 할 구슬이 드럼 위에 떠 보인다. */
    const ORB_R = 3.15;
    const ORB_ANG = [-54, -18, 18, 54];
    const orbAt = (deg9: number): { x: number; y: number } => {
      const a9 = (deg9 * Math.PI) / 180;
      return { x: Math.sin(a9) * ORB_R, y: -0.2 + Math.cos(a9) * ORB_R };
    };
    const orb9 = (ox9: number, oy9: number): ShapeFace[] => {
      const [gx9, gy9] = project(ox9, oy9, 2.55);
      return [
        [groundEllipse(gx9, gy9, 0.88, 0.84), 0.62, "#a9ecf2"] as ShapeFace,
        [groundEllipse(gx9, gy9, 0.54, 0.51), 0.5, "#e8fbff"] as ShapeFace,
        topFace(groundEllipse(gx9 - 0.26, gy9 - 0.25, 0.29, 0.27), 0.5),
      ];
    };
    const [cx2, cy2] = project(0, -0.2, 3.6);
    return raceBase([
      /* 발치 금 테는 맨 앞에 그린다(지적: 코어 키 검토) — 납작한 원통이라 나중에
         그리면 몸 아래를 판때기로 덮는다. 프리미티브는 제 몫으로 키(깊이+높이)를
         달기 때문에 배열 맨 앞에 둬도 소용없어, 다른 부품보다 낮은 키를 못 박는다. */
      ...tagKey(paintBase(cylinderFaces3(0, 0, 3.3, 0.3, 0.15), "#8a6f2a"), -9),
      /* 뒤 발톱 손가락 셋 — 세로로 선 뿔은 뿌리·끝의 평면 깊이 차가 작아 자동 키가
         너무 얕고, 드럼(반지름 키)이 요잉 따라 덮었다(지적: 기둥 가려짐). 제 자리
         깊이 + 키 높이만큼으로 명시한다. */
      ...tagKey(hornFaces(-0.9, -1.5, 3.8, -1.3, -2.1, 8, 1), depthNow(-1.1, -1.8) + 1.2),
      ...tagKey(hornFaces(0, -1.8, 3.8, 0, -2.5, 8.6, 1.1), depthNow(0, -2.1) + 1.2),
      ...tagKey(hornFaces(0.9, -1.5, 3.8, 1.3, -2.1, 8, 1), depthNow(1.1, -1.8) + 1.2),
      // 가운데 드럼.
      ...tagKey(cylinderFaces3(0, -0.2, 2.5, 3.3), -6),
      // 위 파란 발광 고리의 금 뚜껑.
      ...tagKey([
        bodyFace(groundEllipse(cx2, cy2, 1.45, 0.72)),
        topFace(groundEllipse(cx2, cy2, 1.05, 0.5), 0.25),
      ], -4.8),
      // 위 파란 발광 고리 — 반투명 판(색을 안 줘 raceBase의 금 바탕이 든다).
      ...tagKey([[groundEllipse(cx2, cy2, 2.3, 1.15), 0.55] as ShapeFace], -5),
      /* 플라즈마 디스크(재지적: "디스크 크기 줄이고 본체 위에 딱 붙여 올리기") —
         겹쳐 기울인 링 셋을 걷고 원판 한 장만 남긴 데 이어, 받치던 금 축도 걷었다.
         축이 있으면 원판이 본체에서 1.7만큼 떠서 따로 노는 부품으로 보인다. 반지름도
         2.55 → 1.75로 줄여 드럼(2.5)보다 좁게 두어, 몸 위에 얹힌 뚜껑으로 읽힌다. */
      ...tagKey(paintBase(cylinderFaces3(0, -0.2, 1.75, 0.3, 3.66), PLASMA_RING), 13),
      ...tagKey([topFace(discPath3(0, -0.2, 3.99, 1.05), 0.28)], 13.4),
      // 구슬 넷과 저마다의 금색 발판 — 드럼 둘레를 따라 앞쪽에 벌려 선다.
      ...ORB_ANG.flatMap((deg9) => {
        const o9 = orbAt(deg9);
        const front9 = facingRatio(o9.x, o9.y - (-0.2)) > 0.02;
        /* 뒤로 넘어간 구슬은 드럼(키 -6)보다 확실히 아래여야 한다(지적: "내부 개인색
           부품 비쳐보이는 거 수정") — 예전엔 -7에 제 깊이의 0.4배를 더했더니, 그
           흔들림이 1을 넘어 어떤 각에서는 키가 -6을 웃돌았다. 그러면 반투명한 구슬이
           드럼 위로 떠올라 몸 속이 비쳐 보인다. 흔들림 폭을 0.02로 조여 못 넘게 했다. */
        const base9 = front9
          ? 16 + depthNow(o9.x, o9.y) * 0.4
          : -6.5 + depthNow(o9.x, o9.y) * 0.02;
        return [
          ...tagKey(paintBase(cylinderFaces3(o9.x, o9.y, 1.05, 0.5, 1.6), P_GOLD), base9),
          ...tagKey(orb9(o9.x, o9.y), base9 + 0.2),
        ];
      }),
    ], "toss", [
      /* 개인색은 본체 옆을 두르는 띠 하나(지적) — 드럼보다 조금 굵은 납작 원통을
         드럼 위(키 -6 다음)에 덧그리면, 어느 요잉에서도 앞 반쪽이 허리띠로 보인다. */
      ...tagKey(cylinderFaces3(0, -0.2, 2.62, 0.62, 1.25), -5.4),
    ]);
  },
  /* 시타델 오브 아둔 — 물병 받침 + 앞으로 숙인 황금 두건 + 얇고 긴 날개 셋. */
  citadel: () => {
    /* 시타델 오브 아둔(리디자인, 실물 참고) — 렌즈 점 박힌 물병 몸통, 그 위로 앞으로
       숙인 각진 황금 두건(뒤로 솟는 뿔), 좌·우·뒤로 뻗은 가는 팔 끝의 세로 날개. */
    const lens = (lx: number, ly: number, lz: number): ShapeFace => {
      const [px2, py2] = project(lx, ly, lz);
      return topFace(groundEllipse(px2, py2, 0.34, 0.28), 0.45);
    };
    /* 지적: "밭침은 저런 반구형이 아니라 물병모양 입체" — 엎어 놓은 밥그릇(domeFaces3)을
       걷고 회전체 기둥(spirePillar)으로 다시 세웠다. 굵기를 배(3.0)에서 오래 붙들었다가
       (hold 0.22) 어깨에서 급히 오므려(taper 2.4) 목(0.95)까지 뽑으면 물병 옆선이 나온다.
       배보다 아래가 더 잘록한 진짜 병목 굽을 내려고 기둥 둘을 겹쳐도 봤지만, 아래 기둥의
       윗 뚜껑이 배 높이에 접시 같은 턱으로 삐져나와 못 쓴다 — 내려다보는 시점이라 가장
       굵은 자리 아래는 어차피 제 배에 가려 안 보이니, 한 기둥이면 족하다. 발치 금 테가
       바닥에서 병굽 노릇을 하고, 목에 두른 테가 두건 앉을 자리를 끊어 준다. */
    const flask: ShapeFace[] = [
      ...spirePillar({
        x: 0, y: 0, z0: 0.1, h: 4.1, w: 3, tipW: 0.95,
        segs: 11, sides: 16, hold: 0.22, taper: 2.4,
      }),
      ...paintBase(cylinderFaces3(0, 0, 1.2, 0.25, 3.6), "#8a6f2a"),
    ];
    /* 지적: "아둔 양 날개를 더 얇고 긴형태로 변경" — 길이 3.3 → 5.2로 늘리고 두께는
       0.65 → 0.5(끝 0.32)로 깎았다. 함께 날개 판을 90도 돌려 세운 것이 핵심이다:
       건물은 지도에서 늘 요잉 0으로만 그려지는데(방향값이 없다) 예전처럼 판이 바깥을
       보고 서 있으면 영영 옆날로만 보여 막대기 두 개로 읽힌다. 판이 시청자를 보게
       돌리면 얇고 긴 날개꼴이 그대로 드러난다. 팔도 그만큼 가늘게(0.4 → 0.3) 뽑았다. */
    const wing = (m: 1 | -1): ShapeFace[] => [
      ...tubeFaces(m * 0.9, -0.2, m * 3.6, -0.2, 0.3, 3),
      ...frustumFaces3(m * 4.3, -0.2, 1.7, 0.5, 0.75, 0.32, 5.2, 1.5),
      lens(m * 4.3, 0.05, 4.2),
    ];
    return raceBase([
      /* 발치 금 테는 맨 앞에 그린다(지적: 코어 키 검토) — 납작한 원통이라 나중에
         그리면 몸 아래를 판때기로 덮는다. 프리미티브는 제 몫으로 키(깊이+높이)를
         달기 때문에 배열 맨 앞에 둬도 소용없어, 다른 부품보다 낮은 키를 못 박는다. */
      ...tagKey(paintBase(cylinderFaces3(0, 0, 3.1, 0.3, 0.2), "#8a6f2a"), -9),
      /* 지적: "뒤쪽으로도 날개가 하나 나오고 그 날개는 옆날개들보다 큼" — 뒤(-y)로
         뻗은 팔 끝에 옆 날개보다 길고(5.2 → 6.2) 넓은(1.7 → 2.7) 날개를 하나 세운다.
         제 자리 깊이가 몸통보다 뒤라 밑동은 물병에 가리고 윗동만 어깨 너머로 솟는다.
         끝을 뾰족하게(0.7) 좁힌 건 두건 뿔이 그 위로 지나가며 묻히지 않게 하려는 것이다.
         옆 날개와 달리 렌즈 점은 안 박았다 — 이 날개의 앞면은 어느 높이에서든 두건이나
         뿔에 정확히 가려, 점을 찍어 봐야 한 번도 안 보인다. */
      ...tubeFaces(0, -0.9, 0, -4.3, 0.32, 3.2),
      ...frustumFaces3(0, -4.6, 2.7, 0.5, 0.7, 0.32, 6.2, 1.4),
      // 양옆 팔 + 세로 날개(보는 사람 기준 왼쪽이 −x다).
      ...wing(-1),
      ...wing(1),
      // 물병 받침 + 배에 박힌 렌즈 점 셋.
      ...flask,
      lens(-1.15, 2, 1.5), lens(0.2, 2.25, 1.35), lens(1.15, 1.8, 1.6),
      // 두건 뒤로 솟는 뿔과 그 앞 렌즈 — 개인색 두건(키 40) 위에 얹힌다.
      ...tagKey([...hornFaces(0, -0.7, 6, 0, -1.5, 8, 1), lens(0, 0.85, 5.1)], 41),
    ], "toss", [
      /* 개인색은 앞으로 숙인 각진 두건(재지적: 뿔·렌즈 같은 특이 포인트 말고 넓은
         면에 페인트 칠하듯) — 장식 없는 넓은 판이라 통째로 칠하기 좋다. 뒤로 솟는
         뿔과 렌즈 점은 제 색으로 둔다. 물병 목이 z 4.2에서 끝나 두건도 3.4 → 3.9로
         같이 올렸다. */
      ...tagKey([...frustumFaces3(0, -0.3, 2.4, 2, 1.5, 1.3, 2.2, 3.9)], 40),
    ]);
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
    return raceBase([
      /* 발치 금 테는 맨 앞에 그린다(지적: 코어 키 검토) — 납작한 원통이라 나중에
         그리면 몸 아래를 판때기로 덮는다. 프리미티브는 제 몫으로 키(깊이+높이)를
         달기 때문에 배열 맨 앞에 둬도 소용없어, 다른 부품보다 낮은 키를 못 박는다. */
      ...tagKey(paintBase(cylinderFaces3(0, 0, 3.4, 0.3, 0.2), "#8a6f2a"), -9),
      // 왼뒤 뿔 한 쌍 — 개인색 받침 테(키 −1)보다 앞서 그린다.
      ...tagKey([
        ...hornFaces(-1.6, -1.4, 2.6, -3.2, -2.4, 6.6, 1.1),
        ...hornFaces(-0.2, -2, 2.8, -0.8, -3.2, 7, 1.2),
      ], -3),
      // 큰 황금 몸 — 위는 분화구처럼 깎는다. 개인색은 아래 받침 테만.
      ...tagKey(domeFaces3(0, 0, 2.9, 1.6, 0.7), 0),
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
      // 골진 껍데기 꼬리(45도 반시계 이동) — 굽은 마디 둘 + 골 줄 + 끝 옥색 구.
      ...tagKey([
        ...domeFaces3(d1x, d1y, 1.3, 1),
        ...domeFaces3(d2x, d2y, 1, 0.8),
        sideFace(polyPath3([seam(1.8, 0.6, 1), seam(2.2, 1, 1.9), seam(2.6, 1.5, 1), seam(2.5, 1.4, 0.6)]), 0.18),
        sideFace(polyPath3([seam(2.7, 1.6, 0.9), seam(3, 2, 1.6), seam(3.4, 2.5, 0.9), seam(3.3, 2.4, 0.5)]), 0.18),
        // 꼬리 끝 동그란 구도 옥색(요청).
        [groundEllipse(tx3, ty3, 0.5, 0.4), 0.55, "#3bd8c2"] as ShapeFace,
      ], 20),
    ], "toss", [
      /* 개인색은 아래 받침 테만(재지적: 몸통 전체 말고 테두리·뚜껑만) — 큰 몸까지
         칠하니 건물이 임자 색 덩어리가 됐다. 몸을 두르는 낮은 테라 사방에서 보인다.
         뿔·껍데기 꼬리·옥색 렌즈·세로줄·분화구 그늘은 제 색으로 둔다. */
      ...tagKey(cylinderFaces3(0, 0, 2.9, 0.7), -1),
    ]);
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
    /* 개인색은 이 뒤 넙적판 셋(요청: 덧붙인 원판 말고 실제 부품에) — 로보베이에서
       가장 크고 높이 선 부품이라 임자 색이 실루엣째로 읽힌다. */
    const pc: ShapeFace[] = [
      ...plate(-1.4, -1.2, 1, -2.5, -2, 6.6, 2.1),
      ...plate(0.4, -1.7, 1, 0.7, -3, 7.2, 2.2),
      ...plate(1.7, -0.6, 1, 2.8, -1.1, 5.8, 2),
    ];
    // 굽은 관 팔 — 받침 밖에서 포드 쪽으로 넘어온다.
    out.push(...hornFaces(-3.6, 0.9, 0.8, -4, 0.2, 3.6, 0.7));
    out.push(...hornFaces(-4, 0.2, 3.5, -2.9, -0.9, 4.6, 0.55));
    out.push(...hornFaces(3.6, 1.3, 0.8, 4, 0.6, 3.2, 0.7));
    out.push(...hornFaces(4, 0.6, 3.1, 3, -0.3, 4.2, 0.55));
    /* 사진 디테일(요청) — 밑동에 금 테. 받침 테를 두르던 청록 띠는 걷었다
       (지적: 프로토스 짙은 녹색판 제거). */
    out.push(...tagKey(paintBase(cylinderFaces3(0, 0, 5.1, 0.3, 0), "#8a6f2a"),
      depthNow(0, 0) * 1.6 - 1));
    return raceBase(out, "toss", pc);
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
    const pc: ShapeFace[] = [];
    /* 초승달 받침 — 앞을 감싸는 굵은 관. 마디 테를 군데군데 물린다. */
    const R9 = 3.6;
    /* 개인색은 이 초승달 받침(재지적: 랜턴 같은 불빛 포인트 말고 넓은 면에 페인트
       칠하듯) — 앞을 감싸는 굵은 관이라 어느 요잉에서도 임자 색이 깔린다. 랜턴·청록
       띠·마디 테는 제 색으로 둔다. */
    pc.push(...tagKey(spirePillar({
      x: 0, y: 0, h: 1, w: 0.85, tipW: 0.85, segs: 14, sides: 7, hold: 1,
      path: (t9: number): [number, number, number] => {
        const a9 = Math.PI * (-0.12 + 1.24 * t9);
        return [Math.cos(a9) * R9, -0.6 + Math.sin(a9) * R9 * 0.62, 0.8];
      },
    }), 0));
    /* 받침에 물리던 마디 테 넷은 걷었다(지적: 프로토스 짙은 녹색판 제거) — 납작한
       원통이라 초승달 위에 초록 판때기 넷이 누운 꼴이었다. 마디는 관 자체의 각으로
       읽힌다. */
    /* 기둥 셋 — 청록 띠를 두른 황금 대. 가운데가 가장 높다. */
    ([[-2.5, 0.4, 3.2, 0], [0, -1.6, 4.4, 1], [2.5, 0.4, 3.2, 0]] as
      [number, number, number, number][]).forEach(([px, py, ph, own9]) => {
      const key = 12 + depthNow(px, py) * 1.6;
      // 기둥 셋은 모두 황금(재지적) — 개인색은 아래 받침이 맡는다.
      out.push(...tagKey([
        ...paintBase(spirePillar({
          x: px, y: py, z0: 0.8, h: ph, w: 0.62, tipW: 0.48,
          segs: 3, sides: 7, hold: 0.35,
        }), GOLD),
        ...paintBase(cylinderFaces3(px, py, 0.68, 0.4, 0.8 + ph * 0.4), TEAL),
        ...paintBase(cylinderFaces3(px, py, 0.68, 0.34, 0.8 + ph * 0.72), GOLD_D),
      ], key));
      /* 랜턴 머리 — 청록 발광 알. 불빛은 고유색이라 셋 다 청록으로 돌린다(재지적) —
         가운데 것만 크게 남겨 형태의 강약은 그대로 둔다. */
      out.push(...tagKey(paintBase(own9
        ? [
          ...spirePillar({
            x: px, y: py, z0: 0.8 + ph * 0.72, h: ph * 0.28, w: 0.7, tipW: 0.95,
            segs: 2, sides: 10, hold: 0.2,
          }),
          ...domeFaces3(px, py, 1.05, 1.15, 0.8 + ph),
        ]
        : domeFaces3(px, py, 0.72, 0.8, 0.8 + ph), CYAN),
      key + 1));
      out.push(...tagKey([[groundEllipse(...project(px, py, 1.68 + ph), 0.42, 0.42), 0.55,
        "#d8f7ff"] as ShapeFace], key + 2));
    });
    return raceBase(out, "toss", pc);
  },
  /* 플릿 비컨(리디자인, 실물 참고) — 낮고 둥근 몸 위에 큰 파란 구슬이 박히고,
     바닥에는 게발처럼 벌어지는 다리들, 왼팔 드럼 포드와 오른쪽 원반. */
  fleetbeacon: () => {
    const [gx2, gy2] = project(0, 0.2, 3.5);
    const [rx2, ry2] = project(3.3, -0.9, 3.2);
    return raceBase([
      /* 발치 금 테는 맨 앞에 그린다(지적: 코어 키 검토) — 납작한 원통이라 나중에
         그리면 몸 아래를 판때기로 덮는다. 프리미티브는 제 몫으로 키(깊이+높이)를
         달기 때문에 배열 맨 앞에 둬도 소용없어, 다른 부품보다 낮은 키를 못 박는다. */
      ...tagKey(paintBase(cylinderFaces3(0, 0, 3.4, 0.3, 0.15), "#8a6f2a"), -9),
      // 게발 다리 — 사방으로 벌어져 끝이 바닥을 짚는다. 개인색 몸(키 0)보다 앞서 그린다.
      ...tagKey([
        ...hornFaces(-2, 1.6, 1.6, -3.4, 3, 0.2, 0.9),
        ...hornFaces(2, 1.6, 1.6, 3.4, 3, 0.2, 0.9),
        ...hornFaces(-2.8, 0.2, 1.6, -4.4, 0.6, 0.2, 0.9),
        ...hornFaces(2.8, 0.2, 1.6, 4.4, 0.6, 0.2, 0.9),
        ...hornFaces(-2, -1.4, 1.5, -3.2, -2.6, 0.2, 0.85),
        ...hornFaces(2, -1.4, 1.5, 3.2, -2.6, 0.2, 0.85),
      ], -3),
      // 낮고 둥근 몸 — 개인색 다리(키 −3)보다 뒤에 온다.
      ...tagKey(domeFaces3(0, 0, 3.1, 2.3), 0),
      // 큰 파란 구슬 — 몸 위 얹힘이라 지붕 키(지적: 구슬 가려짐 오류).
      ...tagKey([
        // 수정구를 감싸던 겉 구는 제거(요청) — 연한 시안 반투명 구슬만.
        [groundEllipse(gx2, gy2, 1.55, 1.45), 0.55, "#a9ecf2"] as ShapeFace,
        topFace(groundEllipse(gx2 - 0.5, gy2 - 0.5, 0.6, 0.5), 0.5),
      ], 30),
    ], "toss", [
      /* 개인색은 양팔 부속만(재지적: 몸통 전체 말고 일부만) — 둥근 몸까지 칠하니
         건물이 임자 색 덩어리가 됐다. 왼팔 드럼 포드와 오른 원반은 몸 밖으로 나와
         있어 작아도 좌우에서 또렷하다. 다리·구슬·청록 띠·금 테는 제 색으로 둔다. */
      ...tagKey([
        ...tubeFaces(-3, -0.6, -4.4, -0.6, 0.5, 2.5),
        ...cylinderFaces3(-4.7, -0.6, 0.75, 0.9, 2.1),
        capFace(discPath3(-4.7, -0.6, 3.05, 0.5), 0.35),
      ], 10 + depthNow(-4, -0.6)),
      ...tagKey([
        ...cylinderFaces3(3.3, -0.9, 0.9, 0.6, 2.5),
        topFace(groundEllipse(rx2, ry2, 0.6, 0.4), 0.3),
      ], 10 + depthNow(3.3, -0.9)),
    ]);
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
    return raceBase([
      /* 발치 금 테는 맨 앞에 그린다(지적: 코어 키 검토) — 납작한 원통이라 나중에
         그리면 몸 아래를 판때기로 덮는다. 프리미티브는 제 몫으로 키(깊이+높이)를
         달기 때문에 배열 맨 앞에 둬도 소용없어, 다른 부품보다 낮은 키를 못 박는다. */
      ...tagKey(paintBase(cylinderFaces3(0, 0, 3.2, 0.3, 0.2), "#8a6f2a"), -9),
      // 불가사리 팔 넷.
      ...tagKey([...arm(135), ...arm(225), ...arm(45), ...arm(-45)], -3),
      // 가운데 돔 — 개인색은 그 위 기둥 다섯이 맡는다.
      ...tagKey(domeFaces3(0, 0, 2.6, 2.2, 0.8), 0),
    ], "toss", [
      /* 개인색은 돔 위 기둥 다섯만(재지적: 몸통 전체 말고 일부만) — 돔까지 칠하니
         건물이 임자 색 덩어리가 됐다. 기둥은 꼭대기에 곧게 서서 어느 요잉에서도
         보인다. 불가사리 팔·돔·청록 띠·금 테는 제 색으로 둔다. */
      ...post(180), ...post(108), ...post(252), ...post(36), ...post(-36),
    ]);
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
    return raceBase([
      /* 발치 금 테는 맨 앞에 그린다(지적: 코어 키 검토) — 납작한 원통이라 나중에
         그리면 몸 아래를 판때기로 덮는다. 프리미티브는 제 몫으로 키(깊이+높이)를
         달기 때문에 배열 맨 앞에 둬도 소용없어, 다른 부품보다 낮은 키를 못 박는다. */
      ...tagKey(paintBase(cylinderFaces3(0, 0, 2.7, 0.3, 0.12), "#8a6f2a"), -9),
      ...leg(157), ...leg(203), ...leg(112), ...leg(248),
      ...cylinderFaces3(0, 0, 1.5, 1),
      ...leg(67), ...leg(-67), ...leg(22), ...leg(-22),
    ], "toss", [
      /* 개인색은 머리 돔(요청: 덧붙인 원판 말고 실제 부품에) — 얇은 몸 위 유일하게
         도톰한 부품이라 작은 건물에서도 임자 색이 바로 읽힌다. 허리 청록 띠(키 30)가
         돔보다 넓어 위에서 덮으므로 돔을 그 위 키로 올린다. */
      ...tagKey([
        ...domeFaces3(0, 0, 1.5, 0.95, 1),
        topFace(groundEllipse(gx2, gy2, 0.55, 0.4), 0.4),
      ], 40),
    ]);
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
    /* 혈관 다발은 **두 장기 사이 뒤쪽**에 모인다(요청: "챔버 혈관부품들은 두 장기 사이
       뒤쪽에 모여있어야 함") — 여태 앞오른쪽 바닥에서 기어 나와, 두 살덩이 엽과 상관없는
       자리에서 혼자 뻗는 촉수 다발로 보였다. 두 엽의 가운데(x ≈ 0)에서 뒤(−y)로 모아
       등걸 밑동을 감싸게 옮긴다. */
    for (const [tx9, ty9, ex9, ey9, ez9] of [
      [-0.9, -1, -1.7, -2.6, 0.9], [-0.3, -1.2, -0.6, -3.1, 0.8],
      [0.4, -1.1, 0.9, -3, 0.7], [1, -0.9, 1.9, -2.4, 1], [0.05, -0.8, 0.1, -3.6, 0.6],
    ] as [number, number, number, number, number][]) {
      out.push(...tagKey(spikeHorn(tx9, ty9, 0.5, ex9, ey9, ez9, 0.42, "#2b241d", 6, 0.5,
        ex9 - tx9, ey9 - ty9), depthNow(ex9, ey9) * 1.6 + 1));
    }
    return out;
  },

  /* 히드라리스크 덴(실물 참고) — 둔덕 위로 갈퀴막이 걸린 큰 돛가시들이 둘러서고,
     앞에는 마디진 꼬리가 똬리를 튼다. */
  hydraden: () => {
    /* 히드라리스크 덴(재작도·사진) — 뒤에 막 날개가 크게 펴진다: 굽은 뿔이 살을
       받치고 막에는 둥근 구멍이 뚫린다. 앞 가운데엔 창백한 마디 등뼈와 살빛 주둥이,
       그 옆으로 검은 엄니가 앞으로 말린다.
       색 자리를 맞바꿨다(지적: "막은 저그 고유색이고 본체에 개인색 부여") — 여태
       개인색이던 막을 저그 기본색으로 못 박고, 붉은 살덩이 몸통을 칠하지 않아
       그 자리에 임자 색이 들게 했다. */
    const RED = "#a5342a";
    const BONE = "#c8ccd0";
    const HORN = "#241f1c";
    const out: ShapeFace[] = [...tagKey(paintBase(creepSplat(6.8), "#3a3f46"), -20)];
    /* 뒤 막 날개 — 뿔 넷이 위로 벌어져 막을 받친다. 뿔을 더 넓게 벌리고(지적) 막의
       아랫변을 바닥(z 0)까지 내려 땅에 닿게 이었다(지적). */
    const SP: [number, number, number][] = [
      [-6.4, -2.2, 7.2], [-2.3, -3.6, 8.6], [2.3, -3.6, 8.4], [6.1, -2, 6.8],
    ];
    // 막 — 뿔 끝들을 잇는 위 변에서 바닥까지 늘어진다. 저그 기본색(지적).
    out.push(...membraneFaces(
      SP,
      SP.map(([sx, sy]) => [sx * 1.12, sy * 0.72 + 1.2, 0] as [number, number, number]),
      RACE_BASE_TONE.zerg,
      { shade: 0.16, notch: 0.3, key: 6 },
    ));
    // 막의 둥근 구멍 넷 — 어두운 원. 막이 넓어진 만큼 사이도 벌린다.
    for (let k = 0; k < 4; k += 1) {
      const sx = -4.7 + k * 3.13;
      out.push(...tagKey([[polyPath3(Array.from({ length: 13 }, (_, q) => {
        const a9 = (q / 12) * Math.PI * 2;
        return [sx + Math.cos(a9) * 0.95, -2.2, 4.4 + Math.sin(a9) * 0.95] as [number, number, number];
      })), 0.92, "#2a1512"] as ShapeFace], 7));
    }
    // 막을 받치는 굽은 뿔 넷 — 붉은 살에서 솟아 위로 벌어진다.
    for (const [sx, sy, sz] of SP) {
      out.push(...tagKey(paintBase(spirePillar({
        x: sx * 0.42, y: sy * 0.42 + 0.6, z0: 1.2, h: sz - 1.2, w: 0.75, tipW: 0.14,
        segs: 6, sides: 6, hold: 0.12, taper: 1.4,
        leanX: sx * 0.55, leanY: sy * 0.5 - 0.4, curveX: -sx * 0.14,
      }), RED), 10 + depthNow(sx, sy) * 1.6));
    }
    // 몸 — 살덩이 둔덕. 칠하지 않는다 = 개인색(지적: "본체에 개인색 부여").
    out.push(...tagKey(spirePillar({
      x: 0, y: 0.4, z0: 0, h: 3.4, w: 3.6, tipW: 1.3,
      segs: 6, sides: 12, hold: 0, taper: 0.55,
    }), 12));
    /* 앞 창백한 마디 등뼈 — 몸 앞으로 내려오는 마디 다섯. */
    for (let k = 0; k < 5; k += 1) {
      const u9 = k / 4;
      out.push(...tagKey(paintBase(domeFaces3(
        0, 0.9 + u9 * 2.2, 1.15 - u9 * 0.28, 0.85 - u9 * 0.2, 2.6 - u9 * 1.9,
      ), BONE), 14 + k * 0.2 + depthNow(0, 0.9 + u9 * 2.2) * 1.6));
    }
    // 살빛 주둥이 — 등뼈 끝에 붙은 통통한 코.
    out.push(...tagKey(paintBase([
      ...domeFaces3(0, 3.5, 1.05, 0.85, 0.3),
      ...domeFaces3(0, 4.2, 0.7, 0.6, 0.3),
    ], "#c9613a"), 18 + depthNow(0, 3.9) * 1.6));
    /* 검은 엄니 한 쌍 — 주둥이 옆에서 앞으로 크게 말린다. */
    for (const m9 of [-1, 1] as const) {
      out.push(...tagKey(paintBase(spirePillar({
        x: 0, y: 0, h: 1, w: 0.52, tipW: 0.1, segs: 10, sides: 6, hold: 0.1, taper: 1.4,
        path: (t9: number): [number, number, number] => {
          const a9 = Math.PI * (0.75 * t9);
          return [m9 * (1.5 + Math.sin(a9) * 2.6), 2.2 + (1 - Math.cos(a9)) * 2.4, 1.6 - t9 * 1.1];
        },
      }), HORN), 20 + depthNow(m9 * 3, 4) * 1.6));
    }
    return out;
  },
  /* 스파이어(실물 참고) — 초록 밑동에서 촉수 여러 가닥이 모여 오르는 기둥, 그 위
     잿빛 머리와 골진 도넛 왕관(가운데 구멍). */
  spire: () => {
    /* 스파이어(요청·사진: 뿔기둥 전면 활용) — 초록 연못 위 후지산 밑동에서 촉수
       기둥 여섯이 위로 모여 오르고, 그 위에 잿빛 머리와 골진 도넛 왕관이 얹힌다. */
    const PURPLE = "#7a4fa8";
    const out: ShapeFace[] = [];
    // 바닥 연못은 한 뼘 줄인다(지적: "스파이어 바닥 풀 크기 축소") — 6.1 → 4.7.
    /* 연못은 평평한 형광 연두다(지적: "연못이 볼록 솟았어. 연못은 평평해야하고 … 연못색
       형광 연두색으로") — 판 자체는 원래 바닥에 누운 타원이라 평평한데, **밑동**이
       짙은 초록(#4f7a2e)이라 그 후지산 꼴 기둥이 연못의 일부로 읽혀 '볼록 솟은 연못'이
       됐다. 밑동을 저그 살색으로 돌리고(아래) 연못만 형광 연두로 밝힌다. */
    const POND = "#a8ff3d";
    const [plx, ply] = project(0, 0.6, 0.02);
    out.push(sideFace(groundEllipse(plx, ply, 4.7, 2.25), 0.22));
    out.push([groundEllipse(plx, ply, 4.2, 1.98), 0.85, POND] as ShapeFace);
    // 밑동 — 후지산 꼴 기둥 하나.
    const MB_H = 2.6;
    const MB_RB = 4.5;
    const MB_RT = 2.2;
    const mbR = (t9: number): number => MB_RT + (MB_RB - MB_RT) * (1 - t9) ** 2;
    out.push(...tagKey(paintBase(spirePillar({
      x: 0, y: 0.6, z0: 0, h: MB_H, w: MB_RB, tipW: MB_RT,
      segs: 5, sides: 14, hold: 0, taper: 2,
    }), RACE_BASE_TONE.zerg), 0));
    // 촉수 기둥 여섯 — 밑동 옆구리에 뿌리를 두고 위로 모이며 가늘어진다.
    for (const ang of [150, 210, 90, 270, 30, -30]) {
      const a2 = (ang * Math.PI) / 180;
      const dxr = Math.sin(a2);
      const dyr = Math.cos(a2);
      // 다리를 더 안쪽으로(요청) — 밑동 옆구리 0.96 → 0.78 자리에 뿌리를 박는다.
      const rr9 = mbR(0.35) * 0.78;
      const bx9 = dxr * rr9;
      const by9 = 0.6 + dyr * rr9;
      /* 다리는 저그 기본색이다(요청: "다리가 아니라 위쪽 건물 옆면에 개인색 적용,
         다리는 저그 기본색") — 여태 이 촉수 여섯이 개인색이라 스파이어가 통째로 임자
         색 기둥 다발로 읽혔다. 개인색은 아래 머리 옆면이 맡는다. */
      /* 다리는 **바닥에서 위로 휜 갈고리**로 시작한다(지적: "다리의 바닥에 닿는 부분이
         위로 휘어지는 지팡이 거꾸로 한 모양임") — 여태는 밑동 옆구리에서 곧장 솟아
         땅에 닿는 데가 없었다. 이제 길을 손수 준다:
           t 0~0.2  갈고리 — 자유로운 끝(바깥·위)에서 휘어 내려와 바닥에 닿는다.
           t 0.2~1  줄기 — 접점에서 안쪽으로 모이며 머리까지 오른다.
         굵기는 갈고리 끝 0.5 → 꼭대기 0.36으로 가늘어진다(요청: 살짝 가늘게). */
      const R_OUT = rr9 + 0.35;
      const LEG_TOP = 13.6;
      out.push(...tagKey(paintBase(spirePillar({
        // 더 얇게(재요청) — 갈고리 끝 0.5 → 0.34, 꼭대기 0.36 → 0.24.
        x: 0, y: 0, h: 1, w: 0.34, tipW: 0.24, segs: 12, sides: 6, hold: 0.04,
        path: (t9: number): [number, number, number] => {
          if (t9 < 0.2) {
            /* 갈고리 끝은 **바깥으로** 휜다(지적: "다리 끝은 바깥으로 휨") — 앞 판은
               끝이 안쪽을 향해 말려 있었다. 자유로운 끝을 접점보다 0.9 더 바깥에 두고
               위로 들어 올리면, 바닥에서 바깥·위로 휘어 오르는 지팡이 손잡이가 된다. */
            const u9 = t9 / 0.2;
            const rr = R_OUT + 0.9 * Math.cos(u9 * Math.PI * 0.5);
            const zz = 1.25 - 1.2 * u9;
            return [dxr * rr, 0.6 + dyr * rr, Math.max(0.05, zz)];
          }
          const u9 = (t9 - 0.2) / 0.8;
          const rr = R_OUT + (1.15 - R_OUT) * u9 ** 0.85;
          return [dxr * rr, 0.6 + dyr * rr, 0.05 + LEG_TOP * u9 ** 1.05];
        },
      }), RACE_BASE_TONE.zerg), depthNow(bx9, by9) * 1.6));
    }
    /* 머리(윗건물)를 세 배로(요청: "스파이어 윗건물 높이 3배로 증가") — 1.9 → 5.7.
       스파이어의 실루엣은 이 머리라, 촉수 다발 위에 얹힌 뚜껑처럼 낮으면 '기둥 다발'로만
       읽힌다. 그리고 **옆면이 개인색이다**(요청) — 칠하지 않으면 임자 색이 든다.
       상자(16)를 넘지만 굽는 판의 여백이 62%라 잘리지 않고, 정규화가 폭 기준이라
       높이는 그대로 살아난다. */
    /* 머리 높이는 절반으로(재요청: "스파이어 원통 높이 1/2로") — 세 배(5.7)는 기둥이
       됐다. 2.85면 촉수 다발 위에 얹힌 '원통 머리'로 읽힌다. */
    const HEAD_Z0 = 11.1;
    const HEAD_H = 2.85;
    out.push(...tagKey(spirePillar({
      // 중심은 촉수가 모이는 자리(0, 0.6)와 같아야 한다(지적: 다리·뚜껑 중심 어긋남).
      x: 0, y: 0.6, z0: HEAD_Z0, h: HEAD_H, w: 2.6, tipW: 3.3,
      segs: 3, sides: 14, hold: 0.15,
    }), 20));
    /* 개인색 옆면에 세로 줄무늬를 띄엄띄엄 한 바퀴(요청) — 머리 옆면이 임자 색인데
       민둥해서 원통 하나로만 보였다. 여덟 자리에 좁은 세로 띠를 세워 골을 낸다:
       띠는 저그 기본색이라 그 사이로 임자 색이 드러난다. 요잉을 타는 자리라 앞으로
       돌아온 서넛만 보이고 뒤엣것은 제 깊이로 묻힌다. */
    for (let k9 = 0; k9 < 8; k9 += 1) {
      const a9 = (k9 / 8) * Math.PI * 2;
      const dx9 = Math.sin(a9);
      const dy9 = Math.cos(a9);
      if (facingRatio(dx9, dy9) < 0.1) continue;
      out.push(...tagKey(paintBase(spirePillar({
        x: 0, y: 0, h: 1, w: 0.42, tipW: 0.42, segs: 3, sides: 4, hold: 1,
        path: (t9: number): [number, number, number] => {
          // 옆면은 아래 2.6에서 위 3.3으로 벌어진다 — 띠도 그 기울기를 그대로 탄다.
          const rr = (2.6 + (3.3 - 2.6) * t9) * 1.01;
          return [dx9 * rr, 0.6 + dy9 * rr, HEAD_Z0 + 0.25 + t9 * (HEAD_H - 0.5)];
        },
      }), RACE_BASE_TONE.zerg), 21 + depthNow(dx9, dy9) * 0.4));
    }
    // 골진 도넛 왕관 — 방사 골 + 가운데 구멍. 뚜껑은 저그 기본색(지적).
    const [cx2, cy2] = project(0, 0.6, HEAD_Z0 + HEAD_H + 0.1);
    out.push(...tagKey([[groundEllipse(cx2, cy2, 3.55, 2.05), 1, RACE_BASE_TONE.zerg] as ShapeFace], 22));
    /* 골도 요잉을 탄다(지적: 뚜껑이 안 돎) — 화면 고정 각이던 골 위치에 현재 요잉을
       더해, 뚜껑이 함께 도는 것으로 보인다. */
    const yawRad = Math.atan2(-depthNow(1, 0), depthNow(0, 1));
    const crown: ShapeFace[] = [];
    for (const ang of [200, 240, 280, 320, 20, 60, 100, 140]) {
      const a = (ang * Math.PI) / 180 + yawRad;
      // 줄무늬는 보라(지적) — 뚜껑의 저그 기본색 위에 방사 골이 보라로 갈린다.
      crown.push([`M${cx2 + Math.cos(a) * 1.55} ${cy2 + Math.sin(a) * 0.9}`
        + ` L${cx2 + Math.cos(a) * 3.35} ${cy2 + Math.sin(a) * 1.94}`
        + ` L${cx2 + Math.cos(a + 0.16) * 3.35} ${cy2 + Math.sin(a + 0.16) * 1.94}`
        + ` L${cx2 + Math.cos(a + 0.16) * 1.55} ${cy2 + Math.sin(a + 0.16) * 0.9} Z`,
      1, PURPLE] as ShapeFace);
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
    /* 연못도 스파이어 식으로(요청) — 5.9/5.3이라 그레이터만 발자국을 넘게 퍼져 있었다.
       스파이어와 같은 4.7/4.2로 맞춘다. */
    // 연못색은 스파이어와 같은 형광 연두다(요청: 둘 다).
    const [plx, ply] = project(0, 0.4, 0.02);
    out.push(sideFace(groundEllipse(plx, ply, 4.7, 2.25), 0.22));
    out.push([groundEllipse(plx, ply, 4.2, 1.98), 0.85, "#a8ff3d"] as ShapeFace);
    const GS_W = 9;
    const GS_T = 14;
    /** 윗건물을 세 배로 키운 뒤의 꼭대기 높이 — 아가리·깃 뿔이 이 값을 따라 올라간다. */
    const GS_TOP = GS_W + (GS_T - GS_W) * 3;
    /* 기둥을 두껍게(요청: "그레이트 스파이어 기둥 두껍게") — 위아래 줄기의 지름을
       한 단씩 올린다(밑동 3.4 → 4.2 · 허리 1.7 → 2.3 · 꼭대기 3.1 → 4.0). 높이는
       그대로라 같은 키에 몸만 굵어진다. gsLoR는 아래 줄기의 옆선을 되짚는 자라
       같은 값으로 함께 옮겨야 붉은 살 띠와 동굴 입구가 줄기에 붙어 있는다. */
    const gsLoR = (z9: number): number => 2.3 + 1.9 * (1 - z9 / GS_W) ** 1.6;
    // 아래 줄기 — 넓은 밑동에서 허리로.
    out.push(...tagKey(paintBase(spirePillar({
      x: 0, y: 0.4, z0: 0, h: GS_W, w: 4.2, tipW: 2.3,
      segs: 8, sides: 14, hold: 0, taper: 1.6,
    }), "#8a5f43"), 0));
    /* 위 줄기 = **윗건물**이다 — 높이를 세 배로 키우고(5 → 15) 옆면을 개인색으로 둔다
       (요청: "그레이터 스파이어도 마찬가지"). 아래 줄기는 저그 기본색 그대로다. */
    out.push(...tagKey(spirePillar({
      x: 0, y: 0.4, z0: GS_W, h: (GS_T - GS_W) * 3, w: 2.3, tipW: 4,
      segs: 9, sides: 14, hold: 0,
    }), 1));
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
      const bz9 = GS_TOP - 2.6;
      const rr9 = 2.5;
      const bx9 = dxr * rr9;
      const by9 = 0.4 + dyr * rr9;
      /* 가시가 아니라 **솜사탕/구름**이다(요청: "위쪽 가시는 솜사탕/구름같은 느낌의
         물질로 변경(저그 기본색)") — 상아 뿔 대신 크기가 제각각인 둥근 덩이 셋을
         겹쳐 뭉게구름 한 송이를 만든다. 길이(len)는 그대로 쓰되 뾰족함이 없어지고,
         색은 저그 기본색이라 줄기와 한 몸으로 읽힌다. */
      /* 구름은 아래위로 길고 크게, 회백색으로(재요청: "그레이터 스파이어 구름모양은
         더 아래위로 긴형태로 더 크게 그리고 회백색 계열") — 저그 기본색 뭉치는 줄기와
         한 몸으로 묻혔다. 회백색이면 꼭대기에서 또렷하고, 세로로 늘이면 '피어오르는
         연기 기둥'으로 읽힌다: 반지름은 1.5배, 높이는 그 두 배 가까이(r×1.7) 준다. */
      const PUFF = "#c7c9c4";
      const puff = (t9: number, r9: number): ShapeFace[] => paintBase(domeFaces3(
        bx9 + dxr * (0.5 + t9 * 1.2), by9 + dyr * (0.5 + t9 * 1.2), r9, r9 * 1.7,
        bz9 + len * (0.2 + t9 * 0.85),
      ), PUFF);
      out.push(...tagKey([
        ...puff(0, 1.45 + len * 0.14),
        ...puff(0.5, 1.2 + len * 0.12),
        ...puff(1, 0.9 + len * 0.1),
      ], depthNow(bx9, by9) * 1.6));
    }
    // 꼭대기 살덩이 엽 아가리.
    const [cx2, cy2] = project(0, 0.4, GS_TOP + 0.7);
    const maw: ShapeFace[] = [
      ...domeFaces3(-1.15, 0, 1.1, 0.9, GS_TOP - 0.2),
      ...domeFaces3(1.15, 0, 1.05, 0.85, GS_TOP - 0.2),
      ...domeFaces3(-0.75, 1.15, 0.95, 0.8, GS_TOP - 0.2),
      ...domeFaces3(0.85, 1.15, 0.95, 0.8, GS_TOP - 0.2),
      ...domeFaces3(0, -0.65, 0.95, 0.8, GS_TOP - 0.2),
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
    // 크기 대폭 축소(요청) — 폭 3/1.7 → 1.35/0.75, 길이 2.4 → 1.4, 내민 몫 2.5 → 1.4.
    out.push(...tagKey(spirePillar({
      x: 0, y: -0.9, z0: 3.1, h: 1.4, w: 1.35, tipW: 0.75,
      segs: 5, sides: 12, hold: 0.08, taper: 0.7,
      leanY: 1.4, curveY: 0.5,
    }), hoodKey));
    /* 뚜껑 등의 잿빛 기관 한 쌍(사진) — 둔덕 속에 묻히지 않게 뚜껑 위에 얹고,
       뚜껑보다 한 칸만 위 키를 준다. */
    for (const m9 of [1, -1] as const) {
      out.push(...tagKey(spirePillar({
        x: m9 * 1.05, y: -0.5, z0: 3.5, h: 1, w: 0.5, tipW: 0.2,
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
    /** 하이브 전용 어두운 상아·황토(요청) — 옆선 기둥·가시와 뿔 셋에만 쓴다. */
    const HIVE_IVORY = "#8f8467";
    const HIVE_HORN = "#7d5c31";
    const horns: [number, number, number, number, number, number, number, number, number][] = [
      // 휨 방향 반전(재지적) — 배가 바깥으로 부풀며 끝이 안으로 감긴다.
      // 뿌리를 조금 더 바깥으로(요청).
      [-0.95, -5.35, 1.1, -1.2, -7, 13, 2.9, -0.17, -0.98],
      [-3.45, 4.1, 1.1, -4.1, 5.4, 14.4, 3.1, -0.64, 0.77],
      [5.3, 0.95, 1.2, 6.3, 1.2, 15.4, 3.3, 0.98, 0.17],
    ];
    let hi = 0;
    for (const [bx, by, bz, tx, ty, tz, w, inX, inY] of horns) {
      /* 하이브 옆선·가시는 진한 상아였는데 화면에서 밝게 떠 보였다(요청: "하이브
         옆선 기둥색과 뿔 세개 색 다 좀더 어둡게") — 이 건물에서만 한 단 낮춘 상아를
         쓴다. IVORY_DEEP 자체는 다른 열 곳이 함께 쓰므로 안 건드린다. */
      if (hi === 1) out.push(...hatcheryMoundFaces(HIVE_IVORY, HIVE_IVORY));
      hi += 1;
      // 뿔은 황토색, 가시는 상아색(요청).
      // 뿔에 제 자리 깊이(지적: 가려짐) — 첫 뿔(뒤)은 둔덕 뒤, 나머지는 둔덕 앞.
      /* 앞뒤는 요잉이 정한다(재지적: 뒤로 돈 뿔이 안 가려짐) — 고정 키를 쓰면 뒤로
         돌아도 늘 앞에 그려진다. 제 자리 깊이를 키워 쓰면 앞은 둔덕 위, 뒤는 아래다. */
      out.push(...tagKey(spikeHorn(bx, by, bz, tx, ty, tz, w, HIVE_HORN, 6, 1.8, inX, inY),
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
    /* 스포닝 풀(재작도) — 지적: "스포닝풀 동그란 풀 3개임. 왼쪽에 큰거 하나, 밑에
       작은거 하나, 오른쪽에 긴거 하나. 가운데 띠같은건 제거". 여태 웅덩이가 둘이고
       그 사이를 개인색 두렁이 가로질렀는데, 웅덩이를 셋(화면 왼쪽 큰 원 · 그 아래
       작은 원 · 오른쪽 가로로 긴 타원)으로 늘리고 가운데 두렁은 지적대로 걷었다.
       웅덩이 반지름을 화면값이 아니라 모형값으로 받는다 — 옛 코드는 세로 반지름에
       화면 눌림이 이미 든 값을 직접 줘서, 모형 좌표로 도는 두렁과 세로 크기가 어긋나
       두렁이 웅덩이 안으로 파고들었다. 눌림비(groundSquashNow)를 곱해 두렁·웅덩이가
       어느 시점(표준·부감)에서나 같은 타원을 그리게 맞췄다.
       가운데 두렁이 없어져 개인색 자리가 비므로, 큰 웅덩이를 감싸는 두렁을 칠하지 않은
       채로 둬 그 자리에 임자 색이 들게 했다(건물마다 개인색 포인트 하나 규칙). */
    const FLESH = "#8a4a2a";
    const FLESH_D = "#5f3320";
    const GOO = "#4cd63a";
    const out: ShapeFace[] = [...tagKey(paintBase(creepSplat(6.8), "#3a3f46"), -20)];
    const sq9 = groundSquashNow();
    /* 웅덩이 — 얕게 파인 초록 못. 테는 어둡고 속은 밝다. rx·ry는 모형 반지름이다. */
    const pond = (px: number, py: number, rx: number, ry: number, key: number): void => {
      const [sx, sy] = project(px, py, 0.12);
      out.push(...tagKey([
        [groundEllipse(sx, sy, rx, ry * sq9), 1, FLESH_D] as ShapeFace,
        [groundEllipse(sx, sy, rx * 0.86, ry * 0.86 * sq9), 1, "#2f7a24"] as ShapeFace,
        [groundEllipse(sx, sy, rx * 0.7, ry * 0.7 * sq9), 1, GOO] as ShapeFace,
        topFace(groundEllipse(
          sx - rx * 0.2, sy - ry * 0.2 * sq9, rx * 0.32, ry * 0.32 * sq9,
        ), 0.35),
      ], key));
    };
    /* 화면 왼쪽이 -x다(project에서 +x가 오른쪽으로 간다) — 지적의 "왼쪽에 큰거"는
       -x 쪽 큰 원, "밑에 작은거"는 화면 아래(=+y) 쪽 작은 원, "오른쪽에 긴거"는
       +x 쪽 가로로 긴 타원이다. 앞(큰 y)일수록 나중에 그린다. */
    /* 몸을 키운다(정정: "본체를 키운다") — 웅덩이 셋을 한 뼘씩 넓혔다. 아래 가시를
       줄인 만큼 잉크 폭이 좁아져 채움 보정이 모델을 더 키워 주는데, 그 위에 몸까지
       키워야 발자국이 웅덩이로 찬다. 2.5/2.8×1.3/1.3 → 3.15/3.45×1.62/1.68. */
    /* 웅덩이끼리의 앞뒤(지적: "풀간 키값 조정") — 여태 0·0.4·0.8, 두렁은 4·4.2·4.4로
       못 박혀 있었다. 시점과 무관한 고정값이라 요잉을 돌리면 뒤에 있어야 할 웅덩이가
       앞엣것을 덮는 각이 생겼다. 이제 각자의 자리 깊이로 키를 매겨 어느 각에서도
       가까운 것이 나중에 그려지고, 두렁은 제 웅덩이보다 딱 0.5만 위에 선다. */
    const kBig = depthNow(-2.9, -1.5) * 1.6;
    const kLong = depthNow(2.75, 0.5) * 1.6;
    const kSmall = depthNow(-0.15, 3.5) * 1.6;
    pond(-2.9, -1.5, 3.15, 3.15, kBig);
    /* 오른쪽 긴 웅덩이는 90도 돌려 세로로 눕히고(지적) 한 뼘 줄였다(재지적: "오른쪽
       풀 크기 살짝 축소") — 1.62×3.45 → 1.45×3.05. 줄인 만큼 아래 작은 웅덩이와
       떨어지므로 둘을 서로 쪽으로 조금씩 당겨 계속 맞닿게 뒀다. */
    pond(2.75, 0.5, 1.45, 3.05, kLong);
    pond(-0.15, 3.5, 1.68, 1.68, kSmall);
    /* 웅덩이를 감싸는 두렁 — 굵은 살덩이 관이 둘레를 돈다. */
    const ridge = (
      cx9: number, cy9: number, rx9: number, ry9: number, w9: number, fill?: string, key = 4,
    ): void => {
      out.push(...tagKey(spirePillar({
        x: 0, y: 0, h: 1, w: w9, tipW: w9, segs: 16, sides: 6, hold: 1,
        path: (t9: number): [number, number, number] => {
          const a9 = Math.PI * 2 * t9;
          return [cx9 + Math.cos(a9) * rx9, cy9 + Math.sin(a9) * ry9, 0.45];
        },
        ...(fill ? { fill } : {}),
      }), key));
    };
    /* 큰 웅덩이 두렁도 저그 기본색이다(요청: "제일큰 연못둘레도 다른 연못들과 똑같이
       저그 기본색적용해주고 대신 둘레 중간중간 개인색 데칼 넣기") — 두렁 하나가
       통째로 임자 색이라 그 원이 건물의 주인공이 돼 있었다. 살색으로 되돌리고, 대신
       그 둘레에 개인색 마디 여섯을 일정한 간격으로 박는다. */
    ridge(-2.9, -1.5, 3.46, 3.46, 0.6, FLESH, kBig + 0.5);
    for (let d9 = 0; d9 < 6; d9 += 1) {
      const a9 = (d9 / 6) * Math.PI * 2 + 0.26;
      // 마디는 두렁을 그대로 타는 짧은 토막이다 — 두렁과 같은 반지름·같은 높이.
      out.push(...tagKey(spirePillar({
        x: 0, y: 0, h: 1, w: 0.66, tipW: 0.66, segs: 3, sides: 6, hold: 1,
        path: (t9: number): [number, number, number] => {
          const aa9 = a9 + (t9 - 0.5) * 0.5;
          return [-2.9 + Math.cos(aa9) * 3.46, -1.5 + Math.sin(aa9) * 3.46, 0.47];
        },
      }), kBig + 0.6 + depthNow(Math.cos(a9) * 3.46, Math.sin(a9) * 3.46) * 0.2));
    }
    ridge(2.75, 0.5, 1.76, 3.38, 0.55, FLESH, kLong + 0.5);
    ridge(-0.15, 3.5, 2, 2, 0.48, FLESH, kSmall + 0.5);
    /* 가장자리 뿌리 가시 — 바깥으로 뻗는 뿌리 여섯. 크기를 대폭 줄였다(정정: "뿌리
       가시를 엄청 작게 축소하고 본체를 키운다"). 뮤탈에서 겪은 것과 같은 원인이다:
       길게 뻗은 가시가 모델의 잉크 폭을 부풀려, 발자국을 채우는 보정이 '이미 큰 모델'
       이라 보고 몸을 줄여 버렸다. 길이 1.8~2.2 → 0.5~0.65, 밑동 0.9 → 0.3. */
    for (const [ang, len] of [
      [-165, 0.6], [-115, 0.5], [-55, 0.6], [15, 0.65], [75, 0.5], [130, 0.6],
    ] as [number, number][]) {
      const a9 = (ang * Math.PI) / 180;
      const bx = Math.sin(a9) * 3.9;
      const by = Math.cos(a9) * 3.1;
      out.push(...tagKey(spikeHorn(
        bx, by, 0.4, bx + Math.sin(a9) * len, by + Math.cos(a9) * len, 0.3, 0.24,
        FLESH_D, 6, 0.4, Math.sin(a9), Math.cos(a9),
      ), depthNow(bx, by) * 1.6 + 1));
    }
    return out;
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
    ...paintBase(boxFaces3(0, -0.2, 3.2, 4.4, 1.3, 1.2), "#c9ced6"), // 차체 축소(요청) 3.9×5.6 → 3.2×4.4
    /* 포탑은 사다리꼴면체(요청) — 아래가 넓고 위가 좁다. 렌더 순서 정리(지적:
       가려짐이 잦다): 궤도·차체는 제 깊이, 포탑 40, 포신 45로 층을 못 박는다.
       앉는 자리는 차체 한가운데(지적: 포탑이 한쪽으로 쏠려 있다) — 차체 중심 y가
       -0.2인데 포탑만 -0.4에 얹혀 뒤로 밀려 있었다. 뚜껑·쌍포신도 같은 0.2만큼
       함께 옮겨 포탑부가 통째로 중앙에 선다(크기는 그대로). */
    ...tagKey(frustumFaces3(0, -0.2, 3, 3, 1.9, 1.9, 1.5, 2.4), 40),
    /* 뚜껑만 은색(요청) — 옆면은 개인색 그대로. frustum은 윗판과 옆면을 한 몸으로
       칠하므로, 같은 윗판을 은색으로 한 겹 덧그린다. */
    ...tagKey([
      [polyPath3([[-0.95, 0.75, 3.9], [0.95, 0.75, 3.9], [0.95, -1.15, 3.9], [-0.95, -1.15, 3.9]]),
        1, "#c9ced6"] as ShapeFace,
      topFace(polyPath3([[-0.95, 0.75, 3.9], [0.95, 0.75, 3.9], [0.95, -1.15, 3.9], [-0.95, -1.15, 3.9]]), 0.16),
    ], 41),
    ...tagKey(paintBase([
      ...tubeFaces(-0.55, 1.4, -0.55, 4.6, 0.24, 3.3),
      ...tubeFaces(0.55, 1.4, 0.55, 4.6, 0.24, 3.3),
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
    ...paintBase(boxFaces3(0, -0.2, 3.2, 4.4, 1.3, 1.2), "#c9ced6"), // 차체 축소(요청) 3.9×5.6 → 3.2×4.4
  ],
  tankgun: () => [
    // 포탑 사다리꼴면체 + 층 못 박기(요청·지적) — 포탑 40, 포신 45.
    ...tagKey(frustumFaces3(0, -0.2, 3, 3, 1.9, 1.9, 1.5, 2.4), 40),
    /* 뚜껑만 은색(요청) — 옆면은 개인색 그대로. frustum은 윗판과 옆면을 한 몸으로
       칠하므로, 같은 윗판을 은색으로 한 겹 덧그린다. */
    ...tagKey([
      [polyPath3([[-0.95, 0.75, 3.9], [0.95, 0.75, 3.9], [0.95, -1.15, 3.9], [-0.95, -1.15, 3.9]]),
        1, "#c9ced6"] as ShapeFace,
      topFace(polyPath3([[-0.95, 0.75, 3.9], [0.95, 0.75, 3.9], [0.95, -1.15, 3.9], [-0.95, -1.15, 3.9]]), 0.16),
    ], 41),
    ...tagKey(paintBase([
      ...tubeFaces(-0.55, 1.4, -0.55, 4.6, 0.24, 3.3),
      ...tubeFaces(0.55, 1.4, 0.55, 4.6, 0.24, 3.3),
    ], GUNMETAL), 45),
  ],
  /* 시즈 모드(실물 참고) — 사방으로 벌린 궤도 발 넷 + 올라선 포탑 + 위-앞으로 겨눈
     큰 포신. */
  tanksiege: () => {
    /* 포신(수리: 요잉 때 뒤틀림) — 화면 사각형 대신 모델 공간 슬래브: 윗면·옆 두께·
       포구 단면이 전부 모형 좌표라 어느 요잉에서도 결이 맞는다. */
    const barrelTop = polyPath3([[-0.7, 1.2, 4], [0.7, 1.2, 4], [0.7, 3.4, 6.9], [-0.7, 3.4, 6.9]]);
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
      ...paintBase(boxFaces3(0, -0.2, 3.2, 4.4, 1.3, 1.2), "#c9ced6"), // 차체 축소(요청) 3.9×5.6 → 3.2×4.4
      /* 포신 입체 벽 두르기(재지적: 캐리어처럼) — 오른벽 하나만 박혀 있던 것을 윗판·
         밑판 + 좌우 옆벽(faceLight 판정) + 포구 단면(앞이 보일 때만)으로 닫는다.
         포신은 받침(키 40)보다 위(재지적: 포신 가려짐). */
      /* 면 순서(재지적: 비침·순서) — 내려다보는 카메라라 밑판이 맨 아래, 옆벽,
         포구 단면, 윗판 차례로 얹혀야 한다. 윗판을 먼저 그리면 옆벽이 그 위를 덮어
         포신이 뚫린 것처럼 보였다. 키(45)는 첫 면인 밑판이 정의하고 나머지가 물려받는다. */
      [polyPath3([[-0.7, 1.2, 3.6], [0.7, 1.2, 3.6], [0.7, 3.4, 6.5], [-0.7, 3.4, 6.5]]),
        1, GUNMETAL, 45] as ShapeFace,
      /* 좌우 벽은 둘 다 그리되 뒤 향한 쪽부터(재지적: 면이 비치고 서로 가림) —
         하나를 걸러내면 그 자리로 뒤가 비친다. */
      ...([1, -1] as [1, -1])
        .sort((q2: number, w2: number) => facingRatio(q2, 0) - facingRatio(w2, 0))
        .flatMap((m2: 1 | -1): ShapeFace[] => {
          const sl = faceLight(m2, 0);
          const d = polyPath3([
            [m2 * 0.7, 1.2, 4], [m2 * 0.7, 3.4, 6.9], [m2 * 0.7, 3.4, 6.5], [m2 * 0.7, 1.2, 3.6],
          ]);
          return [[d, 1, GUNMETAL] as ShapeFace, ...(sl.visible ? sl.face(d) : [sideFace(d, 0.42)])];
        }),
      ...((): ShapeFace[] => {
        const mz = faceLight(0, 0.71, 0.71);
        const d = polyPath3([[-0.7, 3.4, 6.9], [0.7, 3.4, 6.9], [0.7, 3.4, 6.5], [-0.7, 3.4, 6.5]]);
        // 포구 단면도 늘 그린다(재지적: 걸러내면 그 틈으로 비친다).
        return [[d, 1, GUNMETAL] as ShapeFace, ...(mz.visible ? [capFace(d, 0.4)] : [capFace(d, 0.5)])];
      })(),
      // 윗판은 맨 나중 — 위에서 보는 화면에서 늘 꼭대기다.
      [barrelTop, 1, GUNMETAL] as ShapeFace,
      topFace(barrelTop, 0.18),
      /* 포탑 받침은 맨 나중에(재수리: 앞에 두면 무깊이 포신 면들이 깊이 40을 물려받아
         결국 위에 그려졌다 — zsorted는 무깊이 면에 직전 깊이를 준다). */
      // 받침도 차체 한가운데로(지적: 한쪽 쏠림) — y -0.7 → -0.2, 뚜껑·포신도 같은 몫.
      ...tagKey(frustumFaces3(0, -0.2, 2.3, 3.2, 1.7, 2.4, 1.6, 2.5), 40),
      // 뚜껑만 은색(요청) — 옆면은 개인색.
      ...tagKey([
        [polyPath3([[-0.85, 1, 4.1], [0.85, 1, 4.1], [0.85, -1.4, 4.1], [-0.85, -1.4, 4.1]]),
          1, "#c9ced6"] as ShapeFace,
        topFace(polyPath3([[-0.85, 1, 4.1], [0.85, 1, 4.1], [0.85, -1.4, 4.1], [-0.85, -1.4, 4.1]]), 0.16),
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
    ...paintBase(boxFaces3(0, -0.2, 3.2, 4.4, 1.3, 1.2), "#c9ced6"), // 차체 축소(요청) 3.9×5.6 → 3.2×4.4
  ],
  tanksiegegun: () => {
    const barrelTop = polyPath3([[-0.7, 1.2, 4], [0.7, 1.2, 4], [0.7, 3.4, 6.9], [-0.7, 3.4, 6.9]]);
    return [
      // 포신은 받침(키 40)보다 위(재지적: 포신 가려짐) — 뒤 무깊이 면들이 45를 상속한다.
      /* 면 순서(재지적: 비침·순서) — 내려다보는 카메라라 밑판이 맨 아래, 옆벽,
         포구 단면, 윗판 차례로 얹혀야 한다. 윗판을 먼저 그리면 옆벽이 그 위를 덮어
         포신이 뚫린 것처럼 보였다. 키(45)는 첫 면인 밑판이 정의하고 나머지가 물려받는다. */
      [polyPath3([[-0.7, 1.2, 3.6], [0.7, 1.2, 3.6], [0.7, 3.4, 6.5], [-0.7, 3.4, 6.5]]),
        1, GUNMETAL, 45] as ShapeFace,
      /* 좌우 벽은 둘 다 그리되 뒤 향한 쪽부터(재지적: 면이 비치고 서로 가림) —
         하나를 걸러내면 그 자리로 뒤가 비친다. */
      ...([1, -1] as [1, -1])
        .sort((q2: number, w2: number) => facingRatio(q2, 0) - facingRatio(w2, 0))
        .flatMap((m2: 1 | -1): ShapeFace[] => {
          const sl = faceLight(m2, 0);
          const d = polyPath3([
            [m2 * 0.7, 1.2, 4], [m2 * 0.7, 3.4, 6.9], [m2 * 0.7, 3.4, 6.5], [m2 * 0.7, 1.2, 3.6],
          ]);
          return [[d, 1, GUNMETAL] as ShapeFace, ...(sl.visible ? sl.face(d) : [sideFace(d, 0.42)])];
        }),
      ...((): ShapeFace[] => {
        const mz = faceLight(0, 0.71, 0.71);
        const d = polyPath3([[-0.7, 3.4, 6.9], [0.7, 3.4, 6.9], [0.7, 3.4, 6.5], [-0.7, 3.4, 6.5]]);
        // 포구 단면도 늘 그린다(재지적: 걸러내면 그 틈으로 비친다).
        return [[d, 1, GUNMETAL] as ShapeFace, ...(mz.visible ? [capFace(d, 0.4)] : [capFace(d, 0.5)])];
      })(),
      // 윗판은 맨 나중 — 위에서 보는 화면에서 늘 꼭대기다.
      [barrelTop, 1, GUNMETAL] as ShapeFace,
      topFace(barrelTop, 0.18),
      // 포탑 받침은 맨 나중에(재수리: zsorted 무깊이 상속 탓 — 위 합본과 같은 이유).
      ...tagKey(frustumFaces3(0, -0.2, 2.3, 3.2, 1.7, 2.4, 1.6, 2.5), 40),
      // 뚜껑만 은색(요청) — 옆면은 개인색.
      ...tagKey([
        [polyPath3([[-0.85, 1, 4.1], [0.85, 1, 4.1], [0.85, -1.4, 4.1], [-0.85, -1.4, 4.1]]),
          1, "#c9ced6"] as ShapeFace,
        topFace(polyPath3([[-0.85, 1, 4.1], [0.85, 1, 4.1], [0.85, -1.4, 4.1], [-0.85, -1.4, 4.1]]), 0.16),
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
      return [
        bodyFace(bandPath(ax2, ay2, bx2, by2, 0.17)),
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
    /* 피칭은 45도에서 완만하게(지적: 몸통이 원반으로 안 읽힘) — y를 그대로 z에
       더하면 몸이 통째로 45도로 서서, 납작한 원반도 옆에서 보면 비스듬한 널빤지가
       된다. 0.35로 낮춰 접시가 접시로 보이게 두고 앞쪽만 살짝 든다. */
    const PT = (y9: number): number => y9 * 0.55;
    /* 키는 한 자로 잰다(지적: 키값 재수정) — 몸통을 0으로 두고 나머지는 제 자리
       깊이 × 1.6. 앞으로 돈 부품은 몸 위로, 뒤로 돈 부품은 몸 뒤로 저절로 갈린다.
       머리·집게는 몸 앞에 얹히므로 한 단씩 더 올린다. */
    const out: ShapeFace[] = [];
    // 갈퀴막 — 이웃 다리 끝까지 잇는 여섯 폭 치마.
    for (let i = 0; i < 6; i += 1) {
      const a1 = i * 60 + 30;
      // 몸 축소에 맞춰 갈퀴막·다리도 함께 줄인다(요청) — 반지름 ×0.87.
      const [x1, y1] = P(a1, 1.05);
      const [t1x, t1y] = P(a1, 2.1);
      const [x2, y2] = P(a1 + 60, 1.05);
      const [t2x, t2y] = P(a1 + 60, 2.1);
      out.push(...membraneFaces(
        [[x1, y1, 5.1 + PT(y1)], [x2, y2, 5.1 + PT(y2)]],
        [[t1x, t1y, 4.05 + PT(t1y)], [t2x, t2y, 4.05 + PT(t2y)]],
        "#c68a62",
        { shade: 0.15, notch: 0.26, key: depthNow((t1x + t2x) / 2, (t1y + t2y) / 2) * 1.6 },
      ));
    }
    // 다리 여섯 — 막의 뼈대.
    for (let i = 0; i < 6; i += 1) {
      const [x1, y1] = P(i * 60 + 30, 1.05);
      const [t1x, t1y] = P(i * 60 + 30, 2.15);
      // 다리 짙은 갈색(재지적).
      out.push(...tagKey(paintBase(
        hornFaces(x1, y1, 5.2 + PT(y1), t1x, t1y, 4 + PT(t1y), 0.65), "#6b4732",
      ), depthNow(t1x, t1y) * 1.6));
    }
    /* 몸통 — 납작한 원반(지적: 퀸 몸통은 원반형, 등배가 평평) — 기운 축을 따라
       자라는 기둥은 통통한 알이라 원반으로 안 읽혔다. 위·아래를 평평한 판으로 깎고
       옆벽만 두른 접시로 바꾼다. 앞뒤(2.6)가 좌우(1.85)보다 길어 방향이 읽히고,
       판이 45도 기운 축을 그대로 타 피칭도 살아 있다. 개인색. */
    {
      const N9 = 12;
      // 몸 축소(요청) — 좌우 1.85 → 1.45, 앞뒤 2.6 → 2.05, 두께 0.42 → 0.34.
      const RX9 = 1.45;
      const RY9 = 2.05;
      const TH9 = 0.34;
      const CY9 = -0.2;
      const rim9 = (dz: number): [number, number, number][] =>
        Array.from({ length: N9 }, (_, i9) => {
          const a9 = (i9 / N9) * Math.PI * 2;
          const x9 = Math.sin(a9) * RX9;
          const y9 = CY9 + Math.cos(a9) * RY9;
          return [x9, y9, 5.3 + PT(y9) + dz] as [number, number, number];
        });
      const topR = rim9(TH9);
      const botR = rim9(-TH9);
      const body9: ShapeFace[] = [bodyFace(polyPath3(botR))];
      for (let i9 = 0; i9 < N9; i9 += 1) {
        const j9 = (i9 + 1) % N9;
        const a9 = ((i9 + 0.5) / N9) * Math.PI * 2;
        const fl9 = faceLight(Math.sin(a9), Math.cos(a9), 0.2);
        if (!fl9.visible) continue;
        const d9 = polyPath3([botR[i9], botR[j9], topR[j9], topR[i9]]);
        body9.push(bodyFace(d9), ...fl9.face(d9));
      }
      body9.push(bodyFace(polyPath3(topR)), topFace(polyPath3(topR), 0.16));
      out.push(...tagKey(body9, 0));
    }
    /* 머리 — 원반 앞끝에 얹힌 작은 구(지적: 퀸 머리 작은 구형으로). 긴 뿔 기둥은
       정면에서 몸 전체를 덮어 접시가 안 보였다. 위아래 반구를 맞붙여 공으로 만들고
       살짝 앞으로 내민다. 짙은 갈색. */
    {
      const HY9 = 2.05;
      const HR9 = 0.68;
      const HZ9 = 5.3 + PT(HY9) - 0.05;
      out.push(...tagKey(paintBase([
        ...domeFaces3(0, HY9, HR9, HR9 * 0.62, HZ9),
        ...domeFaces3(0, HY9, HR9 * 0.99, -HR9 * 0.42, HZ9),
      ], "#6b4732"), depthNow(0, HY9) * 1.6 + 2));
    }
    // 큰 집게 한 쌍 — 앞팔 짙은 갈색(요청). 몸 앞에 얹히므로 한 단 더 위.
    for (const m9 of [1, -1] as const) {
      out.push(...tagKey(paintBase([
        ...hornFaces(m9 * 1.15, 0.9, 5.8 + PT(0.9), m9 * 2.25, 1.95, 5.6 + PT(1.95), 0.82),
        ...hornFaces(m9 * 2.25, 1.95, 5.6 + PT(1.95), m9 * 1.65, 3.05, 5.2 + PT(3.05), 0.6),
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
      frustumFaces3(-0.4, -0.5, 3.6, 2.8, 2.6, 1.9, 1.5, 1.45), "#868d94",
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
      const tw: ShapeFace[] = [...paintBase(cylinderFaces3(2.3, -1.6, 0.3, 3.2, 0.9), "#868d94")];
      for (let k = 0; k < 3; k += 1) {
        tw.push(...paintBase(cylinderFaces3(2.3, -1.6, 0.52, 0.26, 1.6 + k * 0.9), "#5c636d"));
      }
      tw.push(capFace(discPath3(2.3, -1.6, 4.1, 0.26), 0.35));
      out.push(...tagKey(tw, 24 + depthNow(2.3, -1.6)));
    }
    /* 본체 색은 테란 기본색이다(요청: "서플라이 본체 색 테란 기본색", "리파이너리
       아카데미도", "애드온들도") — 이 건물들만 제 회색을 손으로 박아 두고 있어서,
       커맨드·배럭·팩토리 옆에 서면 혼자 어둡고 칙칙했다. 주 덩이를 raceBase가 칠하는
       톤(#868d94)으로 맞추고, 어두운 받침·구멍·밝은 은빛 디테일은 그대로 둔다.
       raceBase로 감싸는 것은 색뿐 아니라 종족별 광택(테란 1.7/1.25)까지 받기 위해서다. */
    return raceBase(out, "terran");
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
        ...paintBase(cylinderFaces3(dx, dy, r, hBody, 1), "#868d94"),
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
      const tower: ShapeFace[] = [...paintBase(cylinderFaces3(tx, ty, tr, th, 1), "#868d94")];
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
    /* 본체 색은 테란 기본색이다(요청: "서플라이 본체 색 테란 기본색", "리파이너리
       아카데미도", "애드온들도") — 이 건물들만 제 회색을 손으로 박아 두고 있어서,
       커맨드·배럭·팩토리 옆에 서면 혼자 어둡고 칙칙했다. 주 덩이를 raceBase가 칠하는
       톤(#868d94)으로 맞추고, 어두운 받침·구멍·밝은 은빛 디테일은 그대로 둔다.
       raceBase로 감싸는 것은 색뿐 아니라 종족별 광택(테란 1.7/1.25)까지 받기 위해서다. */
    return raceBase(out, "terran");
  },
  /* 머신 샵(재모델링·사진) — 톱니처럼 각진 강철 덩치다: 앞면에 주황 테를 두른
     세로살 방열 격자, 왼쪽에 초록 발광 띠와 노랑·검정 빗금 블록, 지붕 왼쪽에 배기관
     둘, 오른쪽에 옆으로 누운 밝은 드럼 하나. */
  mshop: () => {
    const out: ShapeFace[] = [
      // 받침 슬래브는 중심 깊이만(지적: 애드온 바닥이 위 부품을 덮음).
      ...tagKey(paintBase(boxFaces3(0, 0.2, 5.6, 4.4, 1), "#3a3f46"), depthNow(0, 0.2)),
      // 본체 — 위로 살짝 좁아지는 각진 덩치.
      ...tagKey(paintBase(frustumFaces3(0, 0.2, 5.4, 4.2, 4.8, 3.6, 2.4, 1), "#868d94"),
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
    /* 본체 색은 테란 기본색이다(요청: "서플라이 본체 색 테란 기본색", "리파이너리
       아카데미도", "애드온들도") — 이 건물들만 제 회색을 손으로 박아 두고 있어서,
       커맨드·배럭·팩토리 옆에 서면 혼자 어둡고 칙칙했다. 주 덩이를 raceBase가 칠하는
       톤(#868d94)으로 맞추고, 어두운 받침·구멍·밝은 은빛 디테일은 그대로 둔다.
       raceBase로 감싸는 것은 색뿐 아니라 종족별 광택(테란 1.7/1.25)까지 받기 위해서다. */
    return raceBase(out, "terran");
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
      ...tagKey(paintBase(cylinderFaces3(-0.6, 0.2, 1.45, 1.9, 2.2), "#868d94"),
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
    /* 본체 색은 테란 기본색이다(요청: "서플라이 본체 색 테란 기본색", "리파이너리
       아카데미도", "애드온들도") — 이 건물들만 제 회색을 손으로 박아 두고 있어서,
       커맨드·배럭·팩토리 옆에 서면 혼자 어둡고 칙칙했다. 주 덩이를 raceBase가 칠하는
       톤(#868d94)으로 맞추고, 어두운 받침·구멍·밝은 은빛 디테일은 그대로 둔다.
       raceBase로 감싸는 것은 색뿐 아니라 종족별 광택(테란 1.7/1.25)까지 받기 위해서다. */
    return raceBase(out, "terran");
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
      out.push(...tagKey(paintBase(f, "#868d94"), 24 + depthNow(sx, sy)));
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
    /* 본체 색은 테란 기본색이다(요청: "서플라이 본체 색 테란 기본색", "리파이너리
       아카데미도", "애드온들도") — 이 건물들만 제 회색을 손으로 박아 두고 있어서,
       커맨드·배럭·팩토리 옆에 서면 혼자 어둡고 칙칙했다. 주 덩이를 raceBase가 칠하는
       톤(#868d94)으로 맞추고, 어두운 받침·구멍·밝은 은빛 디테일은 그대로 둔다.
       raceBase로 감싸는 것은 색뿐 아니라 종족별 광택(테란 1.7/1.25)까지 받기 위해서다. */
    return raceBase(out, "terran");
  },
  /* 피직스 랩(재모델링·사진) — 왼쪽에 큰 강철 구형 포드가 앉고 그 뒤로 노랑·검정
     빗금 날개가 부챗살로 펴진다. 오른쪽으로는 초록 발광 띠가 박힌 기계 팔이 뻗어
     끝에 테 고리가 물리고, 발치에는 층진 받침과 앞 오른쪽 판이 깔린다. */
  physlab: () => {
    const out: ShapeFace[] = [
      // 받침 슬래브는 중심 깊이만(지적: 애드온 바닥이 위 부품을 덮음).
      ...tagKey(paintBase(boxFaces3(0, 0.2, 5.6, 4.4, 0.8), "#868d94"), depthNow(0, 0.2)),
    ];
    // 층진 받침 — 위로 좁아지는 단.
    out.push(...tagKey(paintBase(
      frustumFaces3(-0.8, -0.2, 3.4, 2.8, 2.5, 2, 1.1, 0.8), "#5c636d",
    ), 22 + depthNow(-0.8, -0.2)));
    /* 해저드 패턴은 건물 둘레에 두른다(재지적: 잘못 입힌 듯 — 주위로 두르는 것
       아니냐) — 부챗살 날개에 칠하던 것을 걷고, 받침 옆면을 빙 둘러 노랑·검정 빗금
       띠를 두른다. 보이는 쪽 면에만 그린다. */
    for (let k9 = 0; k9 < 20; k9 += 1) {
      const a9 = (k9 / 20) * Math.PI * 2;
      const sx9 = Math.sin(a9);
      const sy9 = Math.cos(a9);
      if (facingRatio(sx9, sy9) <= 0.05) continue;
      out.push(...tagKey(paintBase(
        boxFaces3(sx9 * 3.55, sy9 * 2.75, 0.62, 0.62, 0.7, 0.1),
        k9 % 2 === 0 ? "#e8c33a" : "#22262b",
      ), depthNow(sx9 * 3.55, sy9 * 2.75) * 1.6 - 1));
    }
    /* 큰 구형 포드(사진) — 위·아래 돔을 맞붙여 진짜 구로. 허리에 리벳 테. */
    out.push(...tagKey([
      ...paintBase(domeFaces3(-1.5, 0.1, 1.75, 1.6, 2.2), "#9ba3ad"),
      ...paintBase(cylinderFaces3(-1.5, 0.1, 1.75, 1.1, 1.1), "#8b8f96"),
      ...paintBase(cylinderFaces3(-1.5, 0.1, 1.82, 0.24, 2), "#5c636d"),
      capFace(discPath3(-1.5, 0.1, 3.4, 0.9), 0.2),
    ], 26 + depthNow(-1.5, 0.1)));
    /* 오른쪽 기계 팔(사진) — 구에서 오른앞으로 뻗는 각진 통. 옆구리에 초록 발광 띠. */
    out.push(...tagKey(paintBase(boxFaces3(1.1, 0.1, 3.4, 1.3, 1.2, 2.3), "#868d94"),
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
    /* 본체 색은 테란 기본색이다(요청: "서플라이 본체 색 테란 기본색", "리파이너리
       아카데미도", "애드온들도") — 이 건물들만 제 회색을 손으로 박아 두고 있어서,
       커맨드·배럭·팩토리 옆에 서면 혼자 어둡고 칙칙했다. 주 덩이를 raceBase가 칠하는
       톤(#868d94)으로 맞추고, 어두운 받침·구멍·밝은 은빛 디테일은 그대로 둔다.
       raceBase로 감싸는 것은 색뿐 아니라 종족별 광택(테란 1.7/1.25)까지 받기 위해서다. */
    return raceBase(out, "terran");
  },
  /* ── 공사 표현 공용 셋(요청: 아이콘 대신 모델) ───────────────────────────── */
  /* 저그 고치 — 크립 위 통통한 번데기(재생 쪽 CSS가 바운스시킨다). */
  /* 저그 변태 고치 — 고정색(요청: 팀색 말고): 장기 느낌의 연한 살색 몸 + 붉은·갈·보라
     힘줄 선. 크립은 탁한 보라. */
  cocoon: () => [
    // 가시는 걷었다(지적: 성큰류와 헷갈린다) — 민둥한 겹돔 고치만.
    // 가시 돋친 크립 대신 부드러운 원반(재지적: 고치 옆 가시 제거).
    /* 그 원반은 크립이지 그림자가 아니다(지적: "고치나 소환구 등의 건물에 미리
       렌더링된 그림자는 공중에 떠 있는 것만 적용해야 하지 않나") — 검정 30%로 깔려
       있어 땅에 앉은 고치가 그림자를 지는 것처럼 읽혔다. 화면의 규칙은 뜬 것만
       그림자를 진다는 것이고(소환구는 WARP_LIFT만큼 떠 있어 바닥 타원을 받는다),
       고치는 땅에 앉는다. 다른 저그 건물의 크립과 같은 잿빛으로 칠해, 같은 원반이
       크립으로 읽히게 한다. */
    /* 바닥 원반은 통째로 걷었다(요청: "저그 고치도 기본 바닥 그림자 모델링 제거하고
       고치를 정가운데 배치하고 크기도 기본 크기를 크게 채우기") — 크립으로 칠해 두었어도
       화면에서는 고치 밑에 깔린 검은 자국 하나였다. 원반이 빠지면 잉크 상자가 고치 몸만
       재게 되므로, 정규화(MODEL_NORM)가 저절로 고치를 그만큼 크게 키운다.
       덩어리도 상자 한가운데로 옮긴다 — 원반이 있던 시절의 y 치우침(-0.25/0.55)은
       그 원반까지 함께 재던 무게중심이었다. */
    /* 축에 딱 맞춘다(지적: "공사 고치 오른쪽으로 치우침") — 겹돔이 y로 0.1·0.9만큼
       앞에 나가 있었다. 고치는 건물 요잉(buildingYawOf)을 타므로 그 **앞쪽 치우침이
       돌아가면서 옆쪽 치우침이 된다**: 45도면 0.9의 0.7배가 그대로 x로 간다. 게다가
       정규화가 발 가운데를 축으로 2.835배를 걸어, 모델의 작은 어긋남이 화면에서는
       세 배로 커진다. 두 돔과 두 이음 틈을 모두 x=0·y=0 축에 세운다. */
    ...paintBase([
      ...domeFaces3(0, 0, 2.6, 3.2),
      ...domeFaces3(0, 0, 1.9, 1.5),
    ], "#d9b8a2"),
    capFace(polyPath3([[-1.9, 0.2, 2.1], [1.9, 0.2, 2.1], [1.7, 0, 2.5], [-1.7, 0, 2.5]]), 0.18),
    capFace(polyPath3([[-1.5, 0.2, 1.2], [1.5, 0.2, 1.2], [1.35, 0, 1.6], [-1.35, 0, 1.6]]), 0.18),
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
        project(Math.sin(aa) * 2.6 * rf, Math.cos(aa) * 2.6 * rf, z);
      const seg = (
        p1: [number, number], p2: [number, number], w: number, col: string,
      ): ShapeFace => [bandPath(p1[0], p1[1], p2[0], p2[1], w), 0.8, col] as ShapeFace;
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
    /* 껍질 셋은 화면 원으로 그린다(지적: "구 형태가 찌그러져 보이잖아") — 여태
       바닥 원을 썼는데, 가로세로 반지름을 같게 줘도 그 함수가 시각 밀림을 먹여
       비스듬한 타원이 됐다. 위 주석의 "어느 시점에서도 안 눌린다"는 밀림이 들어오기
       전 이야기라 더는 사실이 아니었다. 바닥 빛무리만 진짜 바닥이라 그대로 둔다. */
    /* 바닥 빛무리는 걷었다(지적: "그림자는 두개가 나와서 하나만 나오게") — 그리는 쪽이
       이미 접지 그림자를 따로 깔고 있어(op.groundShadow), 모델 안의 이 원반까지 있으면
       땅에 자국이 둘 남았다. 높이를 말하는 것은 그리는 쪽 그림자 하나면 된다.
       색은 플라즈마 쪽으로(요청) — 가운데는 더 희게(푸른끼), 바깥은 더 파랗고 옅게. */
    void bx0; void by0;
    return [
      [screenCircle(ox, oy, 3.05), 0.3, "#5aa8ff"] as ShapeFace,
      [screenCircle(ox, oy, 2.1), 0.45, "#93cdff"] as ShapeFace,
      [screenCircle(ox, oy, 1.05), 0.95, "#f2fbff"] as ShapeFace,
      topFace(screenCircle(ox - 0.8, oy - 0.8, 0.72), 0.55),
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
  /* 애드온 연결부(지적: "테란 부속건물 연결부를 1자로하되 본 건물 옆면의 가장 뒷부분에서
     시작해서 부속건물 옆면의 앞부분으로 쭉 이어지는 구조로. 각 옆면에는 수직임") — 칼라
     두 개를 낀 넓은 관을 걷고 곧은 막대 하나만 남긴다.
     왜 막대를 x축에 그냥 눕히면 "각 옆면에 수직"이 되는가: 건물은 전부 45도로 요잉해 서
     있어(BUILDING_BASE_YAW) 서로 마주 보는 두 옆면 — 본체의 +x 벽과 애드온의 −x 벽 —
     이 화면에서 비스듬한 채 나란하다. 그 두 벽에 동시에 수직인 방향이 곧 모형의 +x축이라,
     x축에 눕힌 막대 하나면 조건이 저절로 지켜진다. 다만 통로도 건물과 같은 각으로 구워야
     하므로 부르는 쪽에서 rotDeg를 건물 요잉으로 준다(옛 0은 이 벽을 비껴 찔렀다).
     그 +x 방향은 화면에서 오른쪽 아래로 내려가므로, 막대는 본체 옆면이 가장 뒤로 물러난
     끝(오른 모서리)에서 나와 애드온 옆면의 가장 앞 끝(왼 모서리)으로 들어간다 — 지적한
     구조 그대로다.
     길이 13은 요잉·원근·시각 밀림을 다 먹인 뒤에도 16칸 뷰박스를 안 넘는 한계에서 잡았다
     (넘으면 굽는 판에서 끝이 잘린다). z0을 3으로 띄운 것도 같은 이유로 아래쪽 잘림을
     피하려는 것뿐이다 — 자리는 그린 잉크의 바닥을 기준으로 다시 앉히므로, 띄운 높이가
     화면에서 통로를 위로 올리지는 않는다. */
  addonlink: () => {
    /* 통로 색과 무늬(요청: "애드온 연결부 테란 기본 은색 적용 및 해저드 데칼 넣기") —
       여태 색을 안 준 맨 상자라 임자 색이 통째로 칠해졌다. 본체와 애드온은 테란 기본색인데
       그 사이를 잇는 통로만 형광 임자 색 막대로 서 있어, 건물 둘을 잇는 구조물이 아니라
       그어 놓은 선처럼 보였다. raceBase로 다른 테란 건물과 같은 톤·광택을 받는다.
       그 위에 해저드 빗금을 두른다 — 공사장 슬래브·서플라이 옆구리에 쓴 그 무늬다.
       사람이 지나다니는 통로라는 것을 한눈에 말해 주고, 은색 막대 하나로는 밋밋하다. */
    const L = 6.5;      // 막대 반길이(x)
    const W = 1.5;      // 막대 반폭(y)
    const zB = 4;       // 띠 아래
    const zT = 4.9;     // 띠 위
    const band = (ny: 1 | -1): ShapeFace[] => {
      if (facingRatio(0, ny) < 0.05) return [];
      // 보이는 쪽 벽을 살짝(0.02) 밖으로 띄워 벽과 z-싸움을 안 하게 한다.
      const y9 = ny * (W + 0.02);
      const pt = (t: number, z: number): [number, number, number] => [ny > 0 ? -L + t : L - t, y9, z];
      const out: ShapeFace[] = [
        [polyPath3([pt(0, zB), pt(L * 2, zB), pt(L * 2, zT), pt(0, zT)]), 1, "#d9ae35"] as ShapeFace,
      ];
      for (let t = 0.3; t < L * 2 - 0.9; t += 1.25) {
        out.push([polyPath3([pt(t, zB), pt(t + 0.5, zB), pt(t + 0.85, zT), pt(t + 0.35, zT)]),
          1, "#1b1e23"] as ShapeFace);
      }
      return out;
    };
    return [
      ...raceBase(boxFaces3(0, 0, L * 2, W * 2, 3, 3), "terran"),
      ...band(1),
      ...band(-1),
    ];
  },
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
      return [bodyFace(annulusPath(ex, ey, ro, ri, sq))];
    })(), "#7a6a52"),
    // 어두운 구멍.
    capFace(discPath3(0, 0, 0.1, 3), 0.6),
    /* 숨은 유닛 비침(재지적: 납작한 렌즈 반구의 윗부분만 살짝) — 낮은 돔을 유닛색
       반투명으로 구멍 위에 살짝 내민다. */
    ...domeFaces3(0, 0, 1.9, 0.55, 0.05).map(([d, o, f, k, l]) => [d, o * 0.45, f, k, l] as ShapeFace),
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
    /* 뒷날개 끝에 개인색(지적: "프로브 개인색을 뒷날개 끝에도 살짝씩 추가") — 금색
       날개판을 뿌리 3/4(금색)과 끝 1/4(개인색)로 갈라 그린다. 금색 판 위에 개인색 조각을
       덧그리지 않고 아예 갈라 놓은 까닭은 깊이 정렬 때문이다: 뒷날개는 y가 음수라 바깥으로
       갈수록 깊이 키가 작아져(zsorted), 덧판이 도리어 원판 밑에 깔린다. 두 토막은 이음매
       에서 폭·높이가 같아 한 판처럼 이어지고 색만 갈린다 — 칠하지 않은 쪽이 임자 색이다. */
    const backWing = (
      ang: number, r0: number, len: number, wRoot: number, wTip: number, z0: number, z1: number,
    ): ShapeFace[] => {
      const f = 0.75;
      const wMid = wRoot + (wTip - wRoot) * f;
      const zMid = z0 + (z1 - z0) * f;
      return [
        ...paintBase(wing(ang, r0, len * f, wRoot, wMid, z0, zMid), "#d4af37"),
        ...wing(ang, r0 + len * f, len * (1 - f), wMid, wTip, zMid, z1),
      ];
    };
    // 뒤 위 날개 한 쌍 + 뒤 아래로 처지는 날개 한 쌍(옆다리는 제거 — 지적).
    /* 1.6배 확대 + 더 높이 부양(지적: 프로브가 너무 작고 땅에 붙어 있음) — 몸통이
       상자의 16%만 채우고 있었다. 다리 얇음·가파름 비율은 유지. */
    // 꼬리 두 가닥은 안테나처럼 얇게(지적).
    // 등딱지(몸통 원판)만 개인색, 날개·다리 금색(요청).
    // 다리 뿌리를 몸통(팔각 반지름 1.55) 안으로 밀어 틈 없이 붙인다(지적).
    // 꼬리 두 가닥 길이 1/3(요청) — 2.4 → 0.8.
    for (const ang of [168, 192]) out.push(...backWing(ang, 1.1, 0.8, 0.16, 0.06, 6.2, 5.85));
    // 긴 뒷다리 한 쌍은 길이·두께 2/3(지적).
    // 짧은 뒷다리 한 쌍은 더 짧게(지적) — 1.67 → 1.05.
    for (const ang of [138, 222]) out.push(...backWing(ang, 1.1, 1.05, 0.37, 0.15, 6.1, 4.4));
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
    /* 매딕은 같은 파워드 아머지만 한 단 작다(요청: "매딕은 팔다리몸통어깨보호구 크기
       살짝 축소") — 전투복이 아니라 의무복이라 마린보다 여려 보여야 한다.
       몸통 1.06 → 0.96 · 어깨 0.95 → 0.85 · 다리 0.52 → 0.46 · 발 0.6 → 0.54 ·
       팔 0.58/0.52 → 0.5/0.45. */
    /* 앞 가림치마 — 몸쪽으로 당기고 제 깊이 키를 준다(요청: "좀더 몸쪽으로 붙이기
       (뒤로이동) 및 키값조절 몸에 안가려짐"). y 1.05는 몸통 앞면(0.76)보다 0.3 앞이라
       허공에 뜬 판이었고, 키가 없어 앞 면의 키를 물려받는 바람에 뒤에서 봐도 몸 위에
       그려졌다. y 0.72로 당기고 depthNow로 제 앞뒤를 갖게 한다. */
    const apron = polyPath3([[-0.46, 0.72, 2.9], [0.46, 0.72, 2.9],
      [0.33, 0.86, 0.9], [-0.33, 0.86, 0.9]]);
    return [
      // 앞 가림치마만 개인색, 나머지 흰회색(요청).
      ...tagKey(paintBase([
        ...cylinderFaces3(-0.58, 0, 0.46, 2.3, 0.1),
        ...cylinderFaces3(0.58, 0, 0.46, 2.3, 0.1),
        ...domeFaces3(-0.58, 0.25, 0.54, 0.36, 0.05),
        ...domeFaces3(0.58, 0.25, 0.54, 0.36, 0.05),
        ...cylinderFaces3(0, -0.2, 0.96, 1.9, 2.3),
        ...domeFaces3(-1.36, -0.3, 0.85, 0.76, 3.6),
        ...domeFaces3(1.36, -0.3, 0.85, 0.76, 3.6),
      ], "#dfe3e6"), depthNow(0, -0.2)),
      /* 헬멧은 원시 구다(요청: "헬멧은 구형 원시 도형 사용으로 변경") — 반구(domeFaces3)는
         밑이 잘려 어깨 위에 얹힌 '그릇'으로 읽혔다. sphereFaces3는 중심만 투영하고
         반지름은 화면 원이라 어느 요잉에서도 동그랗고, 광택·그늘이 세계 광원과 같은
         좌상 방향으로 붙는다. 키 20은 그대로 — 몸통·어깨보다 위다. */
      /* 헬멧은 반쯤만 드러난다(요청: "테란 보병들 헬멧 반정도만 보이게(거의 반구형)")
         — 구를 반구로 바꾸면 어느 각도에서는 밑이 잘린 그릇으로 보이므로(앞선 지적),
         구는 그대로 두고 **어깨선 아래로 내려앉히고 몸통보다 뒤에 그린다**: 아래 절반이
         가슴·어깨에 가려 결과가 반구다. 키 20(맨 앞)이 그 가림을 막고 있었다. */
      ...tagKey(sphereFaces3(0, -0.2, 4.22, 0.84, "#bfe0ef"), depthNow(0, -0.9)),
      ...tagKey([bodyFace(apron), topFace(apron, 0.3)], depthNow(0, 0.79)),
      /* 가슴 빨간 십자(요청) — 병원 표시. 몸통은 원기둥이라 벽이 굽어 있으니, 앞을 볼
         때만 그리고 몸통 앞면(반지름 0.96)보다 아주 조금 앞(0.02)에 눕힌다. 세로·가로
         두 막대가 만나 십자가 되고, 앞가리개 바로 위 가슴 높이에 앉는다. */
      /* 몸에 딱 붙인다(지적: "매딕 적십자 몸에 딱 붙이기") — 0.98은 몸통 앞면보다 0.12
         앞이라 십자가 가슴에서 떠 있었다(몸통은 중심 y −0.2에 반지름 1.06이므로 앞면이
         0.86이다). 0.88이면 딱 0.02 앞 — 표면에 붙은 데칼이다. */
      ...(facingRatio(0, 1) > 0.12 ? tagKey(([
        [[-0.16, 0.88, 3.02], [0.16, 0.88, 3.02], [0.16, 0.88, 3.86], [-0.16, 0.88, 3.86]],
        [[-0.45, 0.88, 3.3], [0.45, 0.88, 3.3], [0.45, 0.88, 3.58], [-0.45, 0.88, 3.58]],
      ] as [number, number, number][][]).map((q) =>
        [polyPath3(q), 1, "#d8362c"] as ShapeFace), depthNow(0, 0.9)) : []),
      /* 두 팔(재지적: 위치·굽힘) — 위팔은 어깨뽕 아래(z 3.7)에서 나와 내려가고,
         팔꿈치에서 굽는다. 왼팔은 앞으로, 오른팔은 주사기 뿌리로. */
      ...tagKey(paintBase([
        ...hornFaces(-1.32, 0.1, 3.7, -1.1, 0.7, 2.8, 0.5),
        ...hornFaces(-1.1, 0.7, 2.8, -0.8, 1.3, 3.1, 0.45),
        ...hornFaces(1.36, 0.1, 3.7, 1.18, 0.5, 2.85, 0.5),
        ...hornFaces(1.18, 0.5, 2.85, 1.22, 0.98, 3.1, 0.45),
      ], "#dfe3e6"), depthNow(0, 0.6)),
      // 오른팔 주사기 — 녹색(요청).
      ...tagKey(paintBase([
        ...tubeFaces(1.22, 0.3, 1.22, 1.3, 0.27, 3),
        ...hornFaces(1.22, 1.3, 3.1, 1.22, 2.05, 3, 0.15),
      ], "#4db964"), depthNow(0, 1.2)),
    ];
  },
  /* 마린(실물 참고) — 큰 어깨 뽕 한 쌍의 파워드 아머, 금빛 바이저 머리, 가슴 앞에
     가로로 든 가우스 소총. */
  gunner: () => {
    return [
      // 다리를 또렷하게(지적: 다리가 없어 헷갈림) — 벌린 두 기둥 + 둥근 발.
      ...cylinderFaces3(-0.64, 0, 0.52, 2.3, 0.1),
      ...cylinderFaces3(0.64, 0, 0.52, 2.3, 0.1),
      ...domeFaces3(-0.64, 0.25, 0.6, 0.4, 0.05),
      ...domeFaces3(0.64, 0.25, 0.6, 0.4, 0.05),
      ...cylinderFaces3(0, -0.2, 1.06, 1.9, 2.3),
      ...domeFaces3(-1.5, -0.3, 0.95, 0.85, 3.6),
      ...domeFaces3(1.5, -0.3, 0.95, 0.85, 3.6),
      /* 헬멧은 원시 구다(요청: "헬멧은 구형 원시 도형 사용으로 변경") — 반구(domeFaces3)는
         밑이 잘려 어깨 위에 얹힌 '그릇'으로 읽혔다. sphereFaces3는 중심만 투영하고
         반지름은 화면 원이라 어느 요잉에서도 동그랗고, 광택·그늘이 세계 광원과 같은
         좌상 방향으로 붙는다. 키 20은 그대로 — 몸통·어깨보다 위다. */
      /* 헬멧은 반쯤만 드러난다(요청: "테란 보병들 헬멧 반정도만 보이게(거의 반구형)")
         — 구를 반구로 바꾸면 어느 각도에서는 밑이 잘린 그릇으로 보이므로(앞선 지적),
         구는 그대로 두고 **어깨선 아래로 내려앉히고 몸통보다 뒤에 그린다**: 아래 절반이
         가슴·어깨에 가려 결과가 반구다. 키 20(맨 앞)이 그 가림을 막고 있었다. */
      ...tagKey(sphereFaces3(0, -0.2, 4.22, 0.84, "#bfe0ef"), depthNow(0, -0.9)),
      /* 두 팔(재지적: 위치·굽힘) — 위팔은 어깨뽕 '아래'(z 3.7)에서 나와 앞-아래로
         내려가고, 팔꿈치에서 굽어 아래팔이 총몸으로 올라가 쥔다. 왼손은 앞손잡이,
         오른손은 방아쇠 쪽. */
      ...hornFaces(-1.45, 0.1, 3.7, -1.05, 0.8, 2.75, 0.64),
      ...hornFaces(-1.05, 0.8, 2.75, 0.3, 1.85, 3.25, 0.54),
      ...hornFaces(1.5, 0.1, 3.7, 1.25, 0.7, 2.8, 0.64),
      ...hornFaces(1.25, 0.7, 2.8, 0.75, 1, 3.25, 0.54),
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
    return [
      // 가는 다리 + 작은 발 — 회흰색(요청).
      ...paintBase([
        ...cylinderFaces3(-0.47, 0, 0.33, 2.3, 0.1),
        ...cylinderFaces3(0.47, 0, 0.33, 2.3, 0.1),
        ...domeFaces3(-0.47, 0.22, 0.4, 0.28, 0.05),
        ...domeFaces3(0.47, 0.22, 0.4, 0.28, 0.05),
      ], "#d3d7db"),
      /* 가는 몸통(마린 1.25 → 0.7). 어깨 라운드 둘은 걷었다(요청: "고스트 어깨갑옷 제거")
         — 작아도 그것이 있으면 어깨가 부푼 실루엣이라 마린과 안 갈린다. */
      ...cylinderFaces3(0, -0.1, 0.6, 2, 2.3),
      // 작은 헬멧 — 마린과 같은 원시 구, 반지름만 작다(요청).
      // 고스트도 같은 규칙(요청) — 머리가 작아 내리는 몫도 조금 작다.
      ...tagKey(sphereFaces3(0, -0.1, 4.34, 0.56, "#bfe0ef"), depthNow(0, -0.8)),
      /* 팔은 **어깨 자리에서** 나오고 더 길다(요청: "팔자체를 어깨위치로 올리고 길이
         늘리기") — 어깨 라운드를 걷으면서 팔 뿌리를 몸통 꼭대기(z 4.3) 바로 아래인
         4.15로 올리고, 아래팔이 앞으로 0.25 더 뻗는다. 가늘고 긴 팔이 고스트의 실루엣이다. */
      ...paintBase([
        ...hornFaces(-0.85, 0.1, 4.15, -0.62, 1, 2.8, 0.4),
        ...hornFaces(-0.62, 1, 2.8, 0.3, 1.95, 3.35, 0.35),
        ...hornFaces(0.9, 0.1, 4.15, 0.72, 0.9, 2.85, 0.4),
        ...hornFaces(0.72, 0.9, 2.85, 0.5, 1.45, 3.35, 0.35),
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
      ...cylinderFaces3(-0.64, 0, 0.52, 2.3, 0.1),
      ...cylinderFaces3(0.64, 0, 0.52, 2.3, 0.1),
      ...domeFaces3(-0.64, 0.25, 0.6, 0.4, 0.05),
      ...domeFaces3(0.64, 0.25, 0.6, 0.4, 0.05),
      ...cylinderFaces3(0, -0.2, 1.06, 1.9, 2.3),
      ...domeFaces3(-1.5, -0.3, 0.95, 0.85, 3.6),
      ...domeFaces3(1.5, -0.3, 0.95, 0.85, 3.6),
      /* 헬멧은 원시 구다(요청: "헬멧은 구형 원시 도형 사용으로 변경") — 반구(domeFaces3)는
         밑이 잘려 어깨 위에 얹힌 '그릇'으로 읽혔다. sphereFaces3는 중심만 투영하고
         반지름은 화면 원이라 어느 요잉에서도 동그랗고, 광택·그늘이 세계 광원과 같은
         좌상 방향으로 붙는다. 키 20은 그대로 — 몸통·어깨보다 위다. */
      /* 헬멧은 반쯤만 드러난다(요청: "테란 보병들 헬멧 반정도만 보이게(거의 반구형)")
         — 구를 반구로 바꾸면 어느 각도에서는 밑이 잘린 그릇으로 보이므로(앞선 지적),
         구는 그대로 두고 **어깨선 아래로 내려앉히고 몸통보다 뒤에 그린다**: 아래 절반이
         가슴·어깨에 가려 결과가 반구다. 키 20(맨 앞)이 그 가림을 막고 있었다. */
      ...tagKey(sphereFaces3(0, -0.2, 4.22, 0.84, "#bfe0ef"), depthNow(0, -0.9)),
      // 두 팔(요청) — 어깨에서 건틀릿 뿌리로.
      ...hornFaces(-1.45, -0.2, 4.9, -1.4, 0.6, 3.2, 0.64),
      ...hornFaces(1.45, -0.2, 4.9, 1.4, 0.6, 3.2, 0.64),
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
    /** 다리 살빛(요청: "짙은 살색") — 껍질 검회색과 갈라서 근육질 다리로 읽히게. */
    const LEG_FLESH = "#8a5a4c";
    const out: ShapeFace[] = [];
    for (const m2 of [1, -1] as const) {
      /* 칼다리는 꺽쇠(재재지적: 더 완만하게) — 뿌리에서 바깥·위로 살짝만 올라
         꼭대기를 찍고, 완만한 각도로 내려와 땅을 짚는다. 내려오는 끝마디는
         상아색 발톱(지적)이다. */
      /* 대퇴부는 길고 굵게, 가시부는 짧게(요청: "럴커 다리 대퇴부를 더 길게 가시부는
         더 짧게 수정하고 대퇴부 두께 증가(근육질 털다리 느낌) 그리고 색도 짙은 살색") —
         검회색 껍질 대신 짙은 살색(#8a5a4c)으로 바꾸고 굵기를 0.7 → 1.05로 키운다.
         무릎을 더 바깥·위로 보내 허벅지를 길게 뽑고, 그만큼 발톱 마디는 짧아진다. */
      out.push(...paintBase(hornFaces(m2 * 1.5, -0.9, 3.8, m2 * 4.2, -2.6, 4.7, 1.05), LEG_FLESH));
      out.push(...ivory(hornFaces(m2 * 4.2, -2.6, 4.7, m2 * 4.85, -3.2, 2.1, 0.42)));
      out.push(...paintBase(hornFaces(m2 * 1.6, 0.6, 3.8, m2 * 4.3, 2.1, 4.7, 1.05), LEG_FLESH));
      out.push(...ivory(hornFaces(m2 * 4.3, 2.1, 4.7, m2 * 4.95, 2.8, 2.1, 0.42)));
      /* 앞 가시갈고리 한 쌍(지적) — 몸 앞에서 앞을 향해 뻗다 끝이 갈고리처럼
         아래로 말린다. 상부 검회색(재지적). */
      out.push(...paintBase(hornFaces(m2 * 0.6, 1.9, 3.5, m2 * 1.1, 3.4, 2.3, 0.42), "#3a3f46"));
      out.push(...ivory(hornFaces(m2 * 1.1, 3.4, 2.3, m2 * 0.8, 4.1, 0.5, 0.28)));
    }
    // 꽁무니 다리도 같은 규칙(요청) — 굵은 살색 허벅지 + 짧은 발톱.
    out.push(...paintBase(hornFaces(0, -1.5, 3.6, 0, -3.8, 4.8, 0.9), LEG_FLESH));
    out.push(...ivory(hornFaces(0, -3.8, 4.8, 0, -4.7, 2, 0.4)));
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
    const legs: string[] = [];
    // 끝마디는 상아 발톱(지적: 모든 다리·팔 끝마디) — 몸색과 갈라 따로 칠한다.
    const tips: string[] = [];
    /** 앞 집게 날 — 여기만 개인색이다(요청). */
    const claws: string[] = [];
    /* 마디 — 시작·끝 굵기를 따로 받아 사다리꼴로 그린다(재지적: 집게팔은 뿌리가
       얇고 집게 쪽에서 확 두꺼워져야 한다). 끝 굵기를 안 주면 곧은 막대다. */
    const seg = (
      x1: number, y1: number, z1: number, x2: number, y2: number, z2: number,
      w: number, w2: number = w,
    ): string => {
      const [ax, ay] = project(x1, y1, z1);
      const [bx, by] = project(x2, y2, z2);
      return bandPath(ax, ay, bx, by, w / 2, w2 / 2);
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
        // 몸 80%·다리 120%(요청) — 뿌리는 줄어든 몸에, 끝은 더 길게 아래로.
        // 길이 80%(요청) — 끝을 위로 당긴다.
        /* 관절 둘 + 수직으로 떨어졌다가 안쪽으로 아주 살짝(요청) — 예전엔 바깥
           (x 1.78)으로 뻗었다가 발끝에서 도로 안(1.45)으로 들어와 마디마다 꺾인 곤충
           다리로 읽혔고, 그걸 고친 '한 직선' 판은 이번엔 내려갈수록 바깥으로 벌어졌다.
           이제 위 마디는 뿌리에서 곧장 수직으로 떨어지고(x 그대로 — 풍선 밑으로
           빠져나오는 구간이 여기라 실루엣에서 곧게 보인다), 무릎 둘을 지나며 몸
           안쪽으로 0.22만큼만 오므린다. 굵기는 발끝으로 갈수록 가늘어진다. */
        const ry9 = lyy * 0.8;
        const KX = [0.96, 0.96, 0.88, 0.74]; // 뿌리·무릎1·무릎2·발끝의 x.
        const KZ = [rootZ(0.96, ry9), 1.1, -0.2, -1.35]; // 같은 차례의 z.
        const KW = [0.34, 0.3, 0.26, 0.2]; // 같은 차례의 굵기.
        for (let j9 = 0; j9 < 3; j9 += 1) {
          // 끝마디만 발톱 판(tips)으로 — 몸색과 갈라 칠하는 자리다.
          (j9 === 2 ? tips : legs).push(seg(
            sx * KX[j9], ry9, KZ[j9], sx * KX[j9 + 1], ry9, KZ[j9 + 1], KW[j9], KW[j9 + 1],
          ));
        }
      }
      // 앞 집게팔(재재지적: 뒷다리보다 살짝 짧게, 뿌리는 얇고 집게 쪽에서 확 굵게) —
      // 사다리꼴 마디로 아래로 갈수록 부풀고, 발끝은 옆다리(-0.9)보다 조금 위에서 끝난다.
      // 앞 집게팔은 수직에 가깝게(요청) — 앞으로 크게 뻗던 것을 곧게 내린다.
      legs.push(seg(sx * 0.64, 1.36, rootZ(0.64, 1.36), sx * 0.95, 1.85, 1.4, 0.3, 0.5));
      legs.push(seg(sx * 0.95, 1.85, 1.4, sx * 1, 2.05, 0.2, 0.5, 0.95));
      /* 집게 날만 개인색이다(요청: "집게다리 중 집게 부분만 개인색") — 굵은 밑동에서
         두 갈래로 좁아지는 이 두 날을 따로 담아 아래에서 색을 안 준 채 붙인다. */
      claws.push(seg(sx * 1, 2.05, 0.2, sx * 1.45, 2.35, -0.5, 0.7, 0.25));
      claws.push(seg(sx * 1, 2.05, 0.2, sx * 0.55, 2.45, -0.45, 0.7, 0.25));
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
        // 기관 1.2배(요청) — 반지름 0.98 → 1.18, 볼록도도 같은 비로.
        x: lx, y: ly, z: 5.65, nx: lx, ny: ly, r: 1.18, bulge: 0.31, tiltDeg: 9,
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
    /* 등의 가스 주머니는 걷었다(요청: 뒤통수 혹들 제거) — 공식 컨셉의 물집을 옮긴
       것이었는데, 크기를 두 번 줄이고 광택까지 뺀 뒤로는 뒤통수에 난 군더더기 두
       덩이로만 보였다. 등은 매끈한 풍선 하나로 둔다. */
    /* 팔다리는 **저그 기본색**이다(요청: "오버로드 팔다리 색은 저그 기본색 + 집게다리
       중 집게 부분만 개인색") — 여태 짙은 갈색(#6b4732)이 못 박혀 있어 다른 저그
       유닛과 톤이 갈렸다. 색을 안 준 채 raceBase에 태우면 저그 바탕색이 들고, 집게
       날만 accent로 빠져 임자 색이 든다. */
    return raceBase([
      [legs.join(" "), 1] as ShapeFace,
      [tips.join(" "), 1] as ShapeFace,
      ...lens(-1),
      ...lens(1),
      ...face,
      /* 풍선을 진짜 구로(지적: "구 형태가 찌그러져 보이잖아") — 여태 바닥 원
         (groundEllipse)으로 그렸는데, 그건 땅에 누운 원반이라 시점을 따라 눌리고
         시각 밀림까지 먹어 비스듬히 찌그러졌다. 떠 있는 공은 회전 대칭이라 어느
         방향에서 봐도 원이다. 원시 구(sphereFaces3)는 중심만 투영하고 반지름은
         화면 원이라 안 눌리고, 덤으로 제 명암(좌상 광택·우하 그늘)을 달고 나온다 —
         손으로 그린 몸판이라 빛이 안 들어가던 문제도 함께 풀린다. */
      ...tagKey(sphereFaces3(0, 0, 5.2, 2.4), depthNow(0, 0)),
    ], "zerg", [[claws.join(" "), 1] as ShapeFace]);
  },
  /* 드랍십(실물 참고) — 양옆 굵은 엔진 포드(앞 단면이 둥글게 보인다) + 가운데 각진
     몸통 + 뒤쪽 수직 꼬리날개. */
  /* 드랍십(다시 셋, 지적) — 완만하게 휘어진 판의 양쪽 끝에 실린더가 달린 꼴: 좌우
     굵은 통 한 쌍과 그 사이를 잇는 활처럼 젖혀진 판. 앞끝은 뭉뚝한 뚜껑, 뒤엔 꼬리. */
  dship: () => {
    // (정리) 손 좌표 문자열 헬퍼 pt — 굽은 판이 전부 curvePath3로 옮겨져 쓸 데가 없다.
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
    const plate = curvePath3([-2.6, 2.6, 6.1], [
      [[0, 3.4, 6.95], [2.6, 2.6, 6.1]], [[2.6, -1.8, 5.9]], [[0, -2.8, 6.55], [-2.6, -1.8, 5.9]],
    ]);
    // 판 두께감(지적) — 앞 가장자리 아래로 내려앉는 옆면 띠.
    const edge = curvePath3([-2.6, 2.6, 6.1], [
      [[0, 3.4, 6.95], [2.6, 2.6, 6.1]], [[2.6, 2.6, 5.4]], [[0, 3.4, 6.25], [-2.6, 2.6, 5.4]],
    ]);
    /* 좌우 옆면(재지적: 등판 옆면이 안 보임) — 판 좌우 변에서 아래로 내려앉는 두께
       띠. 보이는 쪽만 그린다. */
    const flank = (m9: 1 | -1): string => curvePath3([m9 * 2.6, 2.6, 6.1], [
      [[m9 * 2.6, -1.8, 5.9]], [[m9 * 2.6, -1.8, 5.2]], [[m9 * 2.6, 2.6, 5.4]],
    ]);
    /* 뒤 가장자리 두께(재지적: 등판 뒷면도 안 보임) — 앞 edge와 짝이 되는 뒤쪽 띠.
       뒤가 보일 때만 그린다. */
    const rearEdge = curvePath3([-2.6, -1.8, 5.9], [
      [[0, -2.8, 6.55], [2.6, -1.8, 5.9]], [[2.6, -1.8, 5.2]], [[0, -2.8, 5.85], [-2.6, -1.8, 5.2]],
    ]);
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
      bodyFace(curvePath3([-2.55, 1.9, 6.11], [
        [[0, 2.6, 6.9], [2.55, 1.9, 6.11]], [[2.55, 0.6, 6.06]], [[0, 1.3, 6.83], [-2.55, 0.6, 6.06]],
      ])),
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
    out.push(topFace(curvePath3([-1.6, 1.1, 3.9], [
      [[0, 2, 3.9], [1.6, 1.1, 3.9]], [[1.4, 1.5, 3.9]], [[0, 2.4, 3.9], [-1.4, 1.5, 3.9]],
    ]), 0.5));
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
     쓰지 않는다: 모든 면에 제 색을 박는다. 지적("분화구 외의 나머지 부품들 삭제")에
     따라 둘러서던 바위 덩이들을 걷어, 이제 흙바닥 위에 잿빛 분화구 셋만 크기·높이를
     달리해 열린다. 안에 초록 베스핀이 고이고 그 위로 초록 김이 층층이 오른다. */
  geyser: () => {
    const ROCK = "#7a7264";
    const GAS = "#7ee03a";
    const GAS_D = "#3f7a1c";
    const out: ShapeFace[] = [
      // 흙바닥 — 고정 회갈색.
      [groundEllipse(...project(0, 0, 0.02), 4.7, 2.25), 1, "#413c35"] as ShapeFace,
    ];
    /* 둘러선 바위 덩이(정정: "삭제하지 말고 수와 크기를 대폭 축소") — 여섯을 셋으로
       줄이고 키도 3분의 1 아래로 낮춘 자갈이다. 이 덩이들이 잉크 폭만 넓히고 시선은
       분화구에서 뺏어 가던 것이 문제였지, 있어야 할 자리가 아닌 건 아니었다.
       팀색은 한 점도 쓰지 않는다(개인색 없는 고유색 전용). */
    for (const [ang, r9, h9, w9, dark] of [
      [-120, 3.4, 0.8, 0.5, 0], [10, 3.6, 0.62, 0.42, 1], [140, 3.2, 0.9, 0.55, 0],
    ] as [number, number, number, number, number][]) {
      const a9 = (ang * Math.PI) / 180;
      const bx9 = Math.sin(a9) * r9;
      const by9 = Math.cos(a9) * r9 * 0.55;
      /* 등급(요청: 간헐천은 분화구 형태 1 · 음영 등 2 · 가스 3) — 둘러선 자갈은
         분화구를 거드는 장식이라 2티어다. */
      out.push(...trim(tagKey(paintBase(spirePillar({
        x: bx9, y: by9, z0: 0, h: h9, w: w9, tipW: w9 * 0.35,
        segs: 4, sides: 5, hold: 0.15, taper: 1.5,
        leanX: Math.sin(a9) * 0.3, leanY: Math.cos(a9) * 0.3,
      }), dark ? "#4e483f" : ROCK), depthNow(bx9, by9) * 1.6)));
    }
    /* 가운데 분화구 — 위로 좁아지는 바위 그릇. 테 안쪽은 어둡고 바닥에 초록 가스가
       고여 빛난다. */
    const crater = (cx9: number, cy9: number, r9: number, h9: number, key: number): void => {
      out.push(...tagKey(paintBase(spirePillar({
        x: cx9, y: cy9, z0: 0, h: h9, w: r9, tipW: r9 * 0.72,
        segs: 4, sides: 12, hold: 0.1, taper: 1.4,
      }), ROCK), key));
      const rim = r9 * 0.72;
      // 테 안쪽 그늘 — 구멍으로 읽히는 어두운 원. 음영이라 2티어(요청).
      out.push(...trim(tagKey([
        [discPath3(cx9, cy9, h9, rim * 0.94), 1, "#241f19"] as ShapeFace,
      ], key + 0.6)));
      /* 고인 베스핀 — 깊은 초록 위에 밝은 심. 가스는 3티어(요청)라 가장 먼저 빠진다:
         빠져도 분화구 그릇은 그대로라 무엇인지는 읽힌다. */
      out.push(...fine(tagKey([
        [discPath3(cx9, cy9, h9 - 0.12, rim * 0.72), 0.3, GAS_D] as ShapeFace,
        [discPath3(cx9, cy9, h9 - 0.18, rim * 0.42), 0.26, GAS] as ShapeFace,
      ], key + 0.6)));
      // 초록 김 — 위로 갈수록 넓고 옅어지는 세 켜. 이것도 가스라 3티어(요청).
      out.push(...fine(tagKey([
        [groundEllipse(...project(cx9 - 0.1, cy9 + 0.15, h9 + 0.9), rim * 0.8, rim * 0.5), 0.15, GAS] as ShapeFace,
        [groundEllipse(...project(cx9 - 0.25, cy9 + 0.3, h9 + 1.8), rim * 1.05, rim * 0.62), 0.09, GAS] as ShapeFace,
        [groundEllipse(...project(cx9 - 0.4, cy9 + 0.45, h9 + 2.7), rim * 1.3, rim * 0.72), 0.05, GAS] as ShapeFace,
      ], key + 1)));
    };
    // 분화구는 반대로 키운다(정정: "분화구들은 크기 증가") — 2.6/1.35/1.0 → 3.2/1.85/1.35.
    crater(-0.7, 0.4, 3.2, 2.6, depthNow(-0.7, 0.4) * 1.6 + 0.2);
    crater(2.6, -1.5, 1.85, 1.75, depthNow(2.6, -1.5) * 1.6 + 0.2);
    /* 지적: "작은 분화구 앞바깥쪽에 더 낮은 분화구 하나 추가" — 작은 분화구는
       (2.3, -1.4), 화면으로는 오른쪽 뒤에 있다. 그 앞(+y가 시청자 쪽)이자 바깥
       (+x가 화면 오른쪽)인 (3.4, 0.9)에 셋째를 판다. 높이는 1.5 → 0.9로 더 낮춰
       큰 것·작은 것·이것이 계단처럼 층지게 했고, 지름 1.0은 흙바닥 타원(4.7) 안에
       들어와 발자국을 넘지 않는다. */
    crater(3.5, 1, 1.35, 1.1, depthNow(3.5, 1) * 1.6 + 0.2);
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
/* 성큰의 두 자세(요청) — 몸은 한 벌이고 촉수만 자란다. 굽기 깃발을 켠 채로 같은
   빌더를 불러, 낫날·가시·둔덕을 두 번 적지 않는다. */
{
  const sunkenBase = SHAPE_BUILDERS.sunken;
  SHAPE_BUILDERS.sunkenfire = () => {
    sunkenFire = true;
    try { return sunkenBase(); } finally { sunkenFire = false; }
  };
}
/* ── 일꾼이 나르는 짐(요청: "각 일꾼들별로 미네랄 가스 들고 있는 모델링 필요 —
   유닛별로 모양이 다름") ─────────────────────────────────────────────────────────
   짐은 두 가지고, 드는 자리는 일꾼마다 다르다. 미네랄은 셋 다 같은 푸른 결정 덩이지만
   (원작도 그렇다), 가스통은 종족마다 생김새가 다르다(요청: "가스통은 프로토스 테란은
   정육면체 박스, 저그는 둥근 모양이고 저그는 무슨 힘줄같은걸로 감싸고 있어").
   짐은 늘 몸보다 앞에 오도록 큰 키를 달아 둔다 — 일꾼은 짐을 몸 앞으로 안고 온다. */
/** 미네랄 덩이 — 밑이 넓고 위가 좁은 결정 조각 셋이 모인 덩어리. */
function mineralLoad(cx: number, cy: number, cz: number, s = 1): ShapeFace[] {
  const shard = (dx: number, dy: number, w: number, h: number): ShapeFace[] =>
    frustumFaces3(cx + dx * s, cy + dy * s, w * s, w * s, w * 0.32 * s, w * 0.32 * s, h * s, cz);
  return tagKey(paintBase([
    ...shard(-0.5, -0.16, 0.62, 0.86),
    ...shard(0.48, 0.14, 0.56, 0.72),
    ...shard(0, 0, 0.92, 1.28),
  ], "#6cc3e8"), depthNow(cx, cy) * 1.6 + 30);
}
/** 가스통(테란·프로토스) — 정육면체 상자다. 앞·윗면에 베스핀 초록 창이 난다. */
function gasBoxLoad(cx: number, cy: number, cz: number, s = 1): ShapeFace[] {
  const w = 1.35 * s;
  const f: ShapeFace[] = [...paintBase(boxFaces3(cx, cy, w, w, w, cz), "#59626d")];
  // 윗면 초록 창 — 위에서 내려다보므로 늘 보인다.
  f.push([polyPath3([
    [cx - w * 0.32, cy - w * 0.32, cz + w + 0.02], [cx + w * 0.32, cy - w * 0.32, cz + w + 0.02],
    [cx + w * 0.32, cy + w * 0.32, cz + w + 0.02], [cx - w * 0.32, cy + w * 0.32, cz + w + 0.02],
  ]), 0.9, "#4fd06a"] as ShapeFace);
  // 앞면 창 — 앞이 보일 때만.
  if (facingRatio(0, 1) > 0.12) {
    f.push([polyPath3([
      [cx - w * 0.3, cy + w / 2 + 0.02, cz + w * 0.24], [cx + w * 0.3, cy + w / 2 + 0.02, cz + w * 0.24],
      [cx + w * 0.3, cy + w / 2 + 0.02, cz + w * 0.72], [cx - w * 0.3, cy + w / 2 + 0.02, cz + w * 0.72],
    ]), 0.9, "#4fd06a"] as ShapeFace);
  }
  return tagKey(f, depthNow(cx, cy) * 1.6 + 30);
}
/** 가스 주머니(저그) — 둥근 살덩이를 힘줄 넷이 세로로 감싼다(요청). 꼭지는 어두운 관. */
function gasSacLoad(cx: number, cy: number, cz: number, s = 1): ShapeFace[] {
  const r = 0.86 * s;
  /* 안의 구는 네온색이다(요청: "베스핀 가스 저그도 안의 구형태는 네온색") — 담는
     그릇이 종족마다 달라도 담긴 것은 같은 베스핀이라, 색은 테란·프로토스 통의 초록
     창과 한 계열이어야 한다. 감싼 힘줄만 저그의 살빛으로 남는다. */
  const f: ShapeFace[] = [...sphereFaces3(cx, cy, cz + r, r * 1.05, "#4ff08a")];
  /* 힘줄 — 밑에서 위로 넘어가는 띠 넷. 구는 화면 원이라 띠도 화면에서 걸치게 두면
     되지만, 요잉을 함께 타야 하므로 모형 좌표의 두 점을 잇는 뿔로 세운다. */
  for (const [dx9, dy9] of [[-0.72, 0], [0.72, 0], [0, -0.72], [0, 0.72]] as [number, number][]) {
    f.push(...paintBase(hornFaces(
      cx + dx9 * r, cy + dy9 * r, cz + r * 0.15,
      cx + dx9 * r * 0.28, cy + dy9 * r * 0.28, cz + r * 2,
      0.17 * s,
    ), "#c9a86a"));
  }
  // 꼭지 — 위로 난 짧고 어두운 관.
  f.push(...paintBase(cylinderFaces3(cx, cy, 0.2 * s, 0.3 * s, cz + r * 2), "#3f4046"));
  return tagKey(f, depthNow(cx, cy) * 1.6 + 30);
}
/* 일꾼 셋 × 짐 둘 = 여섯 별본. 짐 자리는 일꾼마다 다르다 —
   SCV는 두 팔 사이(y 2.1~3.1 · z 4.6)에 안고, 프로브는 몸(z 5.7~6.8) 앞 아래에 띄우고,
   드론은 집게(z 3) 사이에 문다. */
SHAPE_BUILDERS.scvMin = () => [...SHAPE_BUILDERS.scv(), ...mineralLoad(0, 2.6, 3.95)];
SHAPE_BUILDERS.scvGas = () => [...SHAPE_BUILDERS.scv(), ...gasBoxLoad(0, 2.6, 3.95)];
SHAPE_BUILDERS.probeMin = () => [...SHAPE_BUILDERS.probe(), ...mineralLoad(0, 1.35, 4.35, 0.9)];
SHAPE_BUILDERS.probeGas = () => [...SHAPE_BUILDERS.probe(), ...gasBoxLoad(0, 1.35, 4.35, 0.9)];
SHAPE_BUILDERS.droneMin = () => [...SHAPE_BUILDERS.drone(), ...mineralLoad(0, 2.15, 2.7, 0.95)];
SHAPE_BUILDERS.droneGas = () => [...SHAPE_BUILDERS.drone(), ...gasSacLoad(0, 2.15, 2.7, 0.95)];
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
  ...Object.fromEntries(Object.entries(SHAPE_BUILDERS).map(([k, b]) => [k, bake(b)])),
  // (2D 기호 삭제·요청) — 갈래 기호도 전부 3D 빌더가 만든다: 삼각형은 삼각뿔로.
};
/* 위에서 본 판(요청: 입체 아닌 모드에서 좀 더 부감으로) — 같은 빌더를 납작비 0.66·
   높이 0.6으로 다시 구운 것. 입체 보기가 아닐 때 지도 마커가 이쪽을 쓴다. */
const SHAPE_FACES_TOP: Record<string, ShapeFace[]> = withTopView(() =>
  Object.fromEntries(Object.entries(SHAPE_BUILDERS).map(([k, b]) => [k, bake(b)])));
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
/** 짐을 진 일꾼의 판(요청: 일꾼별로 미네랄·가스 들고 있는 모델) — 코어가 말하는 상태가
 *  짐을 가른다. 짐이 없으면 맨몸 판 그대로다. 판 이름은 맨몸 + Min/Gas 규약이고,
 *  NORM_PAIR가 맨몸 배수를 물려주므로 몸 크기는 안 변한다. */
const workerLoadKind = (base: string, st: number | null): string =>
  (st === ST_CARRY_MIN ? `${base}Min` : st === ST_CARRY_GAS ? `${base}Gas` : base);
/** 일꾼 정체 — 살아 있는 일꾼을 셀 때 개체 트랙에서 고르는 이름들. */
const WORKER_KINDS = new Set(["SCV", "Probe", "Drone"]);
/** 커맨드 없이 시작하는 일꾼 수 — 세 종족 모두 4기다(개체 트랙에는 첫 클릭에야 나타난다). */
const WORKER_START = 4;
/* 기본 쐐기도 폐기(요청) — 표에 없는 낯선 유닛은 그 종족의 기본 보병 꼴로 그린다. */
/* 유닛별 전투 효과(요청: 불 말고 무기 특성) — 근접은 없음. */
/* 무기 세분화(재지적: 이왕 한 거 세분화) — 드라군은 포톤캐논과 같은 광자포(photon),
   커세어는 광자 집중 지지기(flare), 배틀·레이스는 광선 뾱뾱(laser, 레이스·골리앗은
   공중 상대면 미사일 — 그리는 쪽에서 가른다), 캐리어는 두두두두 다발총(burst), 아콘은
   번개 줄기 지지기(zap), 뮤탈은 가시 투척(glave를 투척 다트로), 럴커는 초록 줄이 아닌
   가시(spike), 가디언은 노란 독구체(acidball). 템플러는 물리 공격이 없고(스톰은 캐스트
   가 따로 그린다) 스커지는 자폭(죽음이 곧 공격)이라 뺀다. */
/* 갈래는 **무기의 결**로 나눈다(요청: "트레이서 세분화") — 같은 총이라도 지상·대공이
   갈리는 종류(레이스·골리앗·스카우트)는 아래 렌더가 표적의 공중 여부로 갈아 끼운다.
     gun 짧은 노란 빛(마린·고스트·벌처·골리앗 지상·벙커) · heal 노란 작은 동그란 빛(메딕)
     missile 연기 낀 길고 흰 빛(레이스·발키리·골리앗 대공·스카우트 대공·터렛)
     spine 중간 길이 형광 녹색(히드라) · spike 갈색 길고 가는 가시(럴커·성큰)
     flame 중간 길이 붉고 두꺼운 화염(파이어뱃) · plasma 길게 늘어진 플라즈마(드라군·포톤)
     venom 노랑-연두 독구슬(가디언·스포어) · acid 두껍고 연기 낀 보라(디바우러)
     cannon 짧고 두꺼운 주황(탱크 모드) · siege 굵고 긴 주황(시즈 모드) */
const ATTACK_FX: Record<string, string> = {
  Marine: "gun", Ghost: "gun", Vulture: "gun", Goliath: "gun", Wraith: "laser",
  Battlecruiser: "laser", "Siege Tank": "cannon", "Siege Tank (Tank Mode)": "cannon",
  "Siege Tank (Siege Mode)": "siege", Firebat: "flame", Medic: "heal",
  Hydralisk: "spine", Lurker: "spike", Mutalisk: "glave", Devourer: "acid",
  Guardian: "venom", Queen: "acid", Valkyrie: "missile",
  Dragoon: "plasma", Scout: "plasma", Corsair: "flare", Arbiter: "bolt", Carrier: "burst",
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
/** 사주경계를 하는 정체([어림] — 위 bodyHdg 주석) — 커뮤니티 문서가 확인해 주는 보병만.
 *  차량·기계·일꾼·공중은 원작에서도 제자리에서 두리번거리지 않는다. */
const IDLE_SCAN = new Set(["Marine", "Firebat", "Ghost", "Medic", "Zergling", "Hydralisk", "Zealot"]);
/** 두리번 주기(초) — [어림]. iscript의 wait 값을 못 읽어 눈대중으로 잡은 박자다. */
const IDLE_SCAN_SEC = 3.2;
/* (걷어냄) MELEE_JAB_SEC — 근접 유닛이 앞으로 파고들었다 빠지는 '잽' 동작의 길이표.
   그 동작을 만들던 렌더러 교전 당김이 사라지면서(코어가 제 이동 모형으로 붙는다)
   표만 남아 있었다. */
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
  "Spore Colony": 5,
};
/** 제 힘으로 쏘는 방어 건물 — 사거리·표적 갈래는 저마다 아래 방어 사격에서 갈린다. */
const DEF_FIRE = new Set([
  "Missile Turret", "Bunker", "Photon Cannon", "Sunken Colony", "Spore Colony",
]);
/* 총구 모델 앵커(요청: 오프셋 표 말고 모델별로 — 승인) — 모델 공간 [x(우), y(앞), z(위)].
   트레이서가 몸 중심이 아니라 이 점의 '투영 자리'에서 시작한다: 요잉 버킷·시각 밀림·
   피칭까지 스프라이트 굽기와 같은 변환(project)을 태우므로 어느 방향을 보든 정확히 그
   부위(탱크 포신·히드라 입·마린 총구·매딕 주사기)다. 좌표는 각 빌더의 해당 부품
   좌표에서 따 왔고(마린·고스트는 빌더의 총구 캡 그대로), 표에 없는 유닛만 예전 픽셀
   오프셋(MUZZLE_PX)으로 물러난다. */
const MUZZLE_ANCHOR: Record<string, [number, number, number]> = {
  gunner: [0.55, 2.8, 3.35], ghost: [0.5, 3.4, 3.5], fbat: [0.8, 2.6, 3],
  inf: [0.5, 2.2, 3.2],
  tank: [0.55, 4.6, 3.3], tanksiege: [0, 3.4, 6.9], goliath: [1.4, 2.2, 3.4],
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
   (가운데로 틀린다).
   이제 이 등급은 **화면 크기의 손잡이가 아니다** — 크기는 아래 UNIT_BW_TILES(원작
   치수)가 유닛마다 정하고, 이 표는 그 표에 이름이 없는 유닛의 폴백으로만 쓰인다.
   럴커를 대형으로 고쳐 놨던 것은 되돌렸다: 원전 `UnitType.cpp` unitSize[103]은
   Zerg_Lurker = Medium이다(원래가 맞았다). */
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
  /* 럴커는 원전이 중형이다 — `UnitType.cpp` unitSize[103](Zerg_Lurker) = Medium.
     여기 있던 "원작에서 대형이다(조사)"라는 주석은 원전과 반대라 지웠다. */
  Lurker: 1, Ultralisk: 2, Overlord: 2, Guardian: 2, Devourer: 2,
};

/* ── 유닛 크기의 세 층(요청: "모델 좌표를 키우는 쪽이 낫겠다. 모든 모델을 같은 크기로
   디자인해놓고 쓸 때만 크기를 달리 적용하는 것", "나중에 커스텀으로 유닛크기를 조절하기도
   쉽게", "표준은 실제 게임 크기") ────────────────────────────────────────────────
   섞으면 안 되는 두 자를 여기서 못박는다.

   ① 모델 공간(MODEL_NORM) — "모델이 제 16-상자를 얼마나 채우나". **설계 공간**의 자다.
      화면에서 몇 픽셀인지와 아무 상관이 없고, 굽기(unitSprite)와 도록(ShapeIcon)에서
      상자 한가운데를 축으로 한 번 걸린다.
   ② 화면 크기(unitTilesOf) — "화면에서 몇 타일인가". **쓰는 자리**의 자다.
      모델이 어떻게 생겼는지와 아무 상관이 없다.

   두 자가 만나는 지점이 곧 이 설계의 핵심이다:
       화면에 보이는 몸(타일) = 상자(타일) × (잉크 상자 / 16)
   그래서 상자를 `원작 치수 × 16 / 잉크 상자`로 잡으면 **보이는 몸이 정확히 원작 치수**가
   된다. 옛 설계처럼 계수 K 하나로 어림하면 모델마다 가로세로비가 달라 2.4배가 어긋난다
   (실측: 마린은 맞고 오버로드 0.67배·스카웃 1.71배). 여기서는 K를 종류마다 잰 값
   (16 / MODEL_INK)으로 나눠 그 어긋남을 0으로 만든다 — 전형값은 16/5.2 = 3.08이다.

   예전엔 이 둘이 한 몸이었다(옛 FILL_CACHE 채움 보정): 화면 크기를 정한 뒤 구운 판의
   잉크 폭을 재서 되키우는 방식이라 ⓐ 모델을 고치면 화면 크기가 따라 흔들리고 ⓑ 상한
   (1.55)에 걸린 모델은 아무리 작아도 더 못 커졌다. 다시 섞지 마라.

   화면 크기는 아래 곱셈 사슬이고, 손잡이가 층으로 갈려 있다:
     최종 타일 = 원작 치수(UNIT_BW_TILES, 자료에서 유도)
               × 16 / MODEL_INK[그리는 kind]   // 모델이 상자를 채운 몫 되돌리기
               × SPRITE_OVERHANG               // 충돌 상자 → 스프라이트 (지금 1)
               × (UNIT_SIZE_TUNE[유닛] ?? 1)   // 종류별 손보기 — 여기만 고치면 그 유닛만
               × UNIT_SIZE_GLOBAL              // 전체 배수
               × unitMul                       // 화면의 '모델 크기' 라디오(unitGlyphPx에서)
   그리고 SIZE_CONTRAST(시네마틱 비율)가 원작 치수 자리에 지수로 걸린다(1~1.35로 잘린다). */

/** ① 모델 공간 정규화 배수 — 상자 한가운데(8,8)를 축으로 곱한다. **화면 크기가 아니다.**
 *
 *  이 표는 **`npm run model-norm -- --emit`이 낸 값이다. 손으로 고치지 마라.**
 *  모델 면을 한 줄이라도 고쳤으면 그 명령을 다시 돌려 이 표와 MODEL_INK를 함께 갈아라
 *  (안 갈면 그 종류만 조용히 크기가 어긋난다 — 여태 그것을 알아차릴 방법이 없었다).
 *
 *  근거(scripts/model-norm.mjs 실측): 유닛 kind 49종을 **실제로 굽는 사슬 그대로**
 *  (resolveShapeFaces → lodFilter → shadeBoost) 16방향에서 구워 잉크 상자
 *  √(폭×높이)를 쟀다. 기준은 top 모드다 — `pitched`가 useState(false)라 기본 화면이
 *  그것이고, top은 시각 밀림이 구조적으로 0이라(viewYawOf가 `if (!pitched) return 0`)
 *  표가 화면 폭·맵 격자에 안 흔들린다. 입체(pitch) 보기는 높이 배율이 0.66 → 1로 서면서
 *  잉크 상자가 커지는데, 그 몫은 **평균이 아니라 밴드로 적어야 맞다**: 기하평균 1.035배,
 *  종류별로는 0.973배(버로우 구멍) ~ 1.111배(변태고치)로 1.14배가 벌어진다.
 *  즉 입체에서는 어떤 모델이 다른 모델보다 제 크기의 12%쯤 더 커 보인다.
 *  모드마다 표를 따로 두면 표가 세 벌이 되므로 하나로 간다 — 없애려면 MODEL_INK에
 *  pitch 열을 더하는 것이 해법이고, 그 전까지 이 12%는 알고 남기는 오차다.
 *
 *  목표 잉크 상자 = NORM_TARGET_INK(5.2). 넓이(√잉크면적)가 아니라 **상자**를 맞춘다:
 *  화면 크기표가 원작 치수 √(폭×높이)로 유도되므로 같은 자라야 두 층이 같은 말을 한다.
 *  값 5.2는 취향이 아니라 상자가 정한다 — 목표를 올릴수록 16-상자를 넘어 잘리는 종류가
 *  는다(5.20에서 2종, 5.25에서 3종, 5.40에서 7종, 5.6에서 8종). 5.2가 클램프 수가
 *  바닥(2종)을 유지하는 마지막 자리다.
 *
 *  상한: 배수를 곱한 뒤에도 잉크가 16-상자 안에 있어야 한다(굽는 판의 여백은 pad 2px
 *  뿐이라 넘치면 잘리고, 잘린 자리로 발·가로중심·머리(contentBox)까지 밀린다). 상한은
 *  **16방위 × 시각 밀림 ±36도 전 범위(6도 눈금 13칸) × top·pitch·base 세 모드**에서
 *  가장 빡빡한 것을 쓰고 훑기 해상도만큼(0.97) 물러선다. 걸린 것은 둘뿐이다:
 *    scourge 2.057→1.634 (잉크 상자 4.13 = 목표의 79%) · mine 1.465→1.293 (4.59 = 88%).
 *  덤: 지금 코드는 **입체 보기에서 배수 없이도 이미 7종이 잘리고 있다**(ultra가 2.50
 *  모델 단위, dship 1.13, shuttle 0.88, muta 0.75, darchon 0.38, bc 0.25, archon 0.13).
 *  이 표가 그 일곱을 상한 안으로 끌어들여 함께 고친다 — 적용 뒤 넘침 0종을 실측했다.
 *
 *  짝(옛 FILL_PAIR): **이 표에 포신(tankgun·tanksiegegun)은 없다.** 앞선 설계는 포신도
 *  제 배수를 받게 두고 "축이 둘 다 상자 중심이니 상대 위치가 안 어긋난다"고 적었는데,
 *  그 진단이 틀렸다 — 축은 원래부터 같았고 어긋나는 것은 **배율**이다. 포신 op은 차체
 *  op을 `...last`로 복사해 sizePx가 같으므로, 배수가 갈리면 그 몫이 그대로 상대 크기
 *  차가 된다(재측정: 포신/차체 잉크 상자 비가 탱크 1.377배·시즈탱크 1.561배로 8방위
 *  전부에서 일정하고, 시즈탱크 90·135도에서는 포신 상자가 차체보다 커졌다).
 *  그래서 짝은 아래 NORM_PAIR로 **차체 배수를 그대로 물려받는다** — 옛 FILL_PAIR가
 *  하던 일을 채움 보정이 아니라 이 층으로 옮긴 것이다. 스크립트도 짝은 안 찍는다.
 *  표에 없는 종류는 1(모델 그대로)이다 — 건물이 여기로 떨어진다. */
const MODEL_NORM: Record<string, number> = {
  arbiter: 1.192,
  archon: 0.525,
  bc: 0.677,
  burrowhole: 0.832,
  carrier: 0.911,
  carrierbay: 0.810,
  corsair: 1.128,
  darchon: 0.475,
  defiler: 0.861,
  devourer: 0.945,
  drone: 1.056,
  dship: 0.716,
  dtemp: 0.896,
  fbat: 1.061,
  ghost: 1.409,
  goliath: 0.829,
  goon: 0.667,
  guardian: 0.949,
  gunner: 1.160,
  htemp: 1.077,
  hydra: 0.758,
  inf: 1.286,
  lurker: 0.603,
  lurkeregg: 0.886,
  mine: 1.293,  // 상자 상한(원한 배수 1.465)
  muta: 0.741,
  mutacocoon: 1.100,
  observer: 1.896,
  ovie: 0.841,
  probe: 1.582,
  queen: 1.091,
  reaver: 1.234,
  scourge: 1.634,  // 상자 상한(원한 배수 2.057)
  scout: 0.951,
  scv: 0.936,
  shuttle: 0.673,
  tank: 0.766,
  tankbody: 0.846,
  tanksiege: 0.660,
  tanksiegebody: 0.756,
  ultra: 0.618,
  valk: 0.949,
  vessel: 0.810,
  vulture: 1.058,
  wraith: 0.774,
  zealot: 0.797,
  zling: 1.113,
  // tankgun: 없음 — 짝이라 소스의 NORM_PAIR가 tankbody 배수로 접는다.
  // tanksiegegun: 없음 — 짝이라 소스의 NORM_PAIR가 tanksiegebody 배수로 접는다.
};
/** ①-a-짝 부품 → 본체(옛 FILL_PAIR와 같은 뜻, 옮긴 자리만 다르다).
 *  포신 판은 차체 판과 **같은 sizePx·같은 상자 중심**에 그려지므로 배수도 같아야 한다.
 *  다른 배수를 주면 그 비가 그대로 '포탑만 부푼' 그림이 된다 — 옛 채움 보정이 이 표를
 *  두고 있던 이유이고, 재측정에서 포신/차체 1.377배(시즈 1.561배)로 되살아났다.
 *  차체 쪽 상한(head 1.208·1.123)이 포신 쪽보다 빡빡해, 차체 배수를 포신에 씌워도
 *  16-상자를 안 넘는다(넘침 훑기 0종 실측). */
const NORM_PAIR: Record<string, string> = {
  tankgun: "tankbody", tanksiegegun: "tanksiegebody",
  /* 짐을 든 일꾼도 **맨몸 배수 그대로**다(요청: 일꾼별 자원 들기 모델) — 짐이 늘어난
     만큼 배수를 다시 재면 그 순간 일꾼의 몸이 쪼그라든다. 짐은 몸 앞에 얹히는 것이지
     몸이 커지는 것이 아니므로, 캐러 갈 때와 돌아올 때 몸 크기가 같아야 한다. */
  scvMin: "scv", scvGas: "scv",
  probeMin: "probe", probeGas: "probe",
  droneMin: "drone", droneGas: "drone",
};
/** 모델 공간 배수의 유일한 입구 — 굽기·도록·총구 앵커가 전부 이것을 쓴다.
 *  짝은 본체 배수로 접힌다. */
const modelNormOf = (kind: string): number => MODEL_NORM[NORM_PAIR[kind] ?? kind] ?? 1;
/** 건물 배수의 유일한 입구 — 별본(자세만 다른 판)은 본판 배수를 그대로 물려받는다.
 *  성큰의 혓바닥 판이 제 배수를 따로 가지면, 쏘는 순간 건물이 통째로 커졌다 작아진다. */
const BLD_NORM_PAIR: Record<string, string> = { sunkenfire: "sunken" };
const bldNormOf = (kind: string): number => BLD_NORM[BLD_NORM_PAIR[kind] ?? kind] ?? 1;
/** ①-a-총구 마커 이름 → 총구 앵커가 실제로 붙어 있는 판.
 *  MUZZLE_ANCHOR의 tank·tanksiege 좌표는 **포신 빌더**에서 따온 것인데, 마커 이름은
 *  합본(tank·tanksiege)이라 그대로 배수를 찾으면 엉뚱한 판의 값이 나온다
 *  (tank 0.766 vs tankgun→tankbody 0.846 = 1.10배, tanksiege 0.660 vs 0.756 = 1.15배;
 *  짝을 안 접었던 앞선 설계에서는 1.52·1.79배까지 벌어졌다).
 *  여기 없는 종류는 마커 이름과 그리는 판이 같다. */
const MUZZLE_PLATE: Record<string, string> = {
  tank: "tankgun", tanksiege: "tanksiegegun",
};
/** ①-b 정규화가 맞추는 목표 잉크 상자(모델 단위, 16이 상자 한 변). 크기표가 이 값으로
 *  나눈다 — scripts/model-norm.mjs의 TARGET_GM과 **같은 값이어야 한다**. */
const NORM_TARGET_INK = 5.2;
/** ①-c 목표(NORM_TARGET_INK)에 못 미치는 종류만 적는다. 둘로 갈린다:
 *   · mine·scourge — 상자 상한에 걸려 목표까지 못 큰 것.
 *   · tankgun·tanksiegegun — **일부러** 목표를 안 맞춘 것. 짝이라 차체 배수를 쓰므로
 *     제 잉크 상자는 5.2가 아니다(포신은 완결 유닛이 아니라 부품이다).
 *  이 표도 --emit이 낸 값이다. */
const MODEL_INK: Record<string, number> = {
  mine: 4.591, scourge: 4.129, tankgun: 3.779, tanksiegegun: 3.330,
};
/** 그리는 kind가 정규화 뒤 실제로 차지하는 잉크 상자(모델 단위). */
const modelInkOf = (kind: string): number => MODEL_INK[kind] ?? NORM_TARGET_INK;

/** ②-a 원작 자료 — **BWAPI 원전 그대로다. 한 칸도 손보지 마라**(손볼 곳은 UNIT_SIZE_TUNE).
 *  [폭px, 높이px, 등급(0 소·1 중·2 대), 공중(1)]
 *   · 폭·높이: `BWAPILIB/Source/UnitType.cpp` unitDimensions의 L/U/R/D에서
 *     폭 = L+1+R, 높이 = U+1+D (BWAPI 자신의 width()/height() 정의). JBWAPI의 같은 표와
 *     234/234 일치했고 Liquipedia와도 마린 17×20 · 저글링 16×16 · 울트라 38×32로 맞았다.
 *   · 등급: 같은 파일 unitSize[]. 지금 UNIT_BULK가 쓰는 바로 그 자료다.
 *   · 공중: 같은 파일 unitFlags[]의 Flyer 비트.
 *  세 자료가 한 줄에 나란히 있어야 아래 보정 규칙을 자료에서 유도할 수 있다.
 *  **손본 값과 원작값이 한 표에 섞이지 않게** 여기에는 원자료만 두고, 보정은 전부
 *  아래 코드로 유도한다(옛 표는 퀸 48×48을 1.000으로 적어 두어 되찾을 수 없었다). */
const UNIT_BW_RAW = {
  // ── 테란 ──
  scv: [23, 23, 0, 0], gunner: [17, 20, 0, 0], ghost: [15, 22, 0, 0], fbat: [23, 22, 0, 0],
  inf: [17, 20, 0, 0], vulture: [32, 32, 1, 0], mine: [15, 15, 0, 0], tank: [32, 32, 2, 0],
  tanksiege: [32, 32, 2, 0], goliath: [32, 32, 2, 0], wraith: [38, 30, 2, 1],
  dship: [49, 37, 2, 1], vessel: [65, 50, 2, 1], valk: [49, 37, 2, 1], bc: [75, 59, 2, 1],
  // ── 프로토스 ──
  probe: [23, 23, 0, 0], zealot: [23, 19, 0, 0], dtemp: [24, 26, 0, 0], htemp: [24, 24, 0, 0],
  goon: [32, 32, 2, 0], archon: [32, 32, 2, 0], darchon: [32, 32, 2, 0], reaver: [32, 32, 2, 0],
  shuttle: [40, 32, 2, 1], observer: [32, 32, 0, 1], scout: [36, 32, 2, 1],
  corsair: [36, 32, 1, 1], carrier: [64, 64, 2, 1], arbiter: [44, 44, 2, 1],
  // ── 저그 ──
  drone: [23, 23, 0, 0], zling: [16, 16, 0, 0], hydra: [21, 23, 1, 0], lurker: [32, 32, 1, 0],
  ultra: [38, 32, 2, 0], defiler: [27, 25, 1, 0], queen: [48, 48, 1, 1], ovie: [50, 50, 2, 1],
  muta: [44, 44, 0, 1], scourge: [24, 24, 0, 1], guardian: [44, 44, 2, 1],
  devourer: [44, 44, 2, 1],
} as const;
/** 기하평균 — '전체 크기감을 안 바꾸는' 평균이다. 곱셈으로 크기를 만지는 이 파일에서
 *  산술평균은 큰 쪽에 끌려간다. */
const gmOf = (v: number[]): number => Math.exp(v.reduce((t, x) => t + Math.log(x), 0) / v.length);
const BW_ROWS: readonly (readonly [number, number, number, number])[] = Object.values(UNIT_BW_RAW);
/** 충돌 상자의 대각(타일) = √(폭×높이)/32. 1타일 = 32px. */
const bwBoxTiles = (r: readonly [number, number, number, number]): number => Math.sqrt(r[0] * r[1]) / 32;
/** 등급 대표 크기(타일) — **지상 유닛만의 기하평균**이다. 손으로 고른 수가 아니라
 *  자료에서 유도한다(지상 = 충돌 상자가 몸에 딱 붙는 쪽이라 등급의 기준으로 쓸 수 있다).
 *  실측: 소 0.636 · 중 0.864 · 대 1.011. */
const CLASS_TILES = ([0, 1, 2] as const).map(
  (c) => gmOf(BW_ROWS.filter((r) => r[3] === 0 && r[2] === c).map(bwBoxTiles)),
);
const AIR_ROWS = BW_ROWS.filter((r) => r[3] === 1);
/** 공중 상자 여유 — 공중 유닛은 충돌이 없어 dimensions가 표적 획득·클릭용으로 넉넉하다
 *  (원값 그대로면 스커지 0.75 > 저글링 0.50, 옵저버 1.00 = 탱크, 오버로드 1.56 > 울트라).
 *  얼마나 넉넉한지도 **자료가 말한다**: 공중 무리의 상자 기하평균(1.318)이 그들의 등급이
 *  말하는 크기(0.915)보다 1.441배 크다. 그 몫을 그대로 나눈다 — 지어낸 수가 없다.
 *  **다만 상수 하나로는 안 맞는 자리가 있다(정직하게 적는다)**: 종류별 잔차
 *  (상자 ÷ 등급 기대)가 레이스 1.044 · 스카웃 1.049 · 셔틀 1.106에서 뮤탈 2.161까지
 *  2.07배로 흩어진다. 잔차가 1에 가까운 셋은 상자에 여유가 애초에 없는데도 1.441로
 *  나뉘어 제 등급의 0.72배까지 내려앉고, 그 바람에 지상 중형(벌처·럴커) 아래로 떨어졌다.
 *  그 셋만 아래 UNIT_SIZE_TUNE에서 되올린다 — 상수를 종류별 표로 바꾸는 것은 자료
 *  한 층을 더 만드는 일이라, 손잡이 층에서 세 칸으로 끝낸다.
 *  (진짜 그림 크기는 GRP 헤더인데 MPQ 없이는 못 캔다. 캐게 되면 이 줄이 아니라
 *   SPRITE_OVERHANG 하나만 갈아 끼우면 된다.) */
/** (지금은 안 쓴다 — 요청: 원작 비율 그대로) 값 자체는 자료가 말하는 사실이라 남긴다:
 *  공중 무리의 상자 기하평균이 그들 등급이 말하는 크기보다 이만큼(1.441배) 크다.
 *  화면 크기를 다시 등급 쪽으로 당기고 싶으면 UNIT_BW_TILES에서 이 값을 나누면 된다. */
export const AIR_BOX_SLACK = gmOf(AIR_ROWS.map(bwBoxTiles))
  / gmOf(AIR_ROWS.map((r) => CLASS_TILES[r[2]]));
/** 등급을 섞는 무게 — 0.5는 "두 자료(충돌 상자·등급)를 같은 무게로" 곧 기하평균이다.
 *  왜 섞나: units.dat의 기본값 32×32에 벌처·탱크·골리앗·드라군·아콘·다크아콘·리버·러커가
 *  통째로 뭉쳐(41종 중 14종이 세 값에 몰린다) 상자만으로는 벌처(중)와 시즈탱크(대)를
 *  구분하지 못한다 — 있던 자료(unitSize[])를 버리는 셈이다. 섞으면 벌처 0.930 <
 *  탱크 1.005로 제 순서(등급 사이)가 선다. 등급 하나만 쓰면(무게 1) 같은 등급이 전부 한
 *  값이 되어 이번엔 배틀크루저와 레이스가 같아진다. 등급 역전쌍은 무게 0에서 57쌍,
 *  0.5에서 10쌍, 1에서 0쌍이다.
 *  **섞기가 고치는 것은 등급 사이 순서뿐이고, 같은 등급 안 뭉개짐은 못 고친다** —
 *  등급이 같으면 √(상자×등급)이 상자의 단조함수라 상자까지 같은 종은 원리적으로 못
 *  가른다(32×32 대형 지상 일곱, 44×44 대형 공중 셋 …). 그 몫은 UNIT_SIZE_TUNE이 진다.
 *  남는 10쌍도 전부 자료발은 **아니다**: 4쌍(퀸·뮤탈 쪽)만 원상자에서도 역전이고,
 *  6쌍(벌처·럴커 vs 레이스·셔틀·스카웃)은 원상자에서는 정상 순서였는데 AIR_BOX_SLACK
 *  나눗셈이 뒤집은 것이다 — 그래서 그 셋을 손잡이로 되올린다. */
/* 0.5 → 0(요청: "유닛 크기 비율 원작과 똑같이") — 섞기는 units.dat의 기본값 뭉침
   (32×32에 일곱 종)을 등급으로 갈라 주는 대신, 크기 비율을 원작에서 밀어낸다. 이제
   화면 크기는 **원작 상자 그대로**다: 같은 상자·같은 등급인 종류는 화면에서도 같은
   크기가 된다(벌처 = 탱크 = 골리앗 = 드라군 = 아콘 = 리버 = 러커, 다 32×32다).
   섞기로 세워 두던 순서는 그 대가로 사라진다 — 되살리려면 이 값만 0.5로 돌리면 된다. */
const SIZE_BLEND = 0;
/** ②-b 원작 치수(타일) — 위 원자료에서 **유도한다. 손으로 옮겨 적지 않는다.**
 *  결과 검산(손잡이 전, 41종 전수를 실제로 세어 적는다 — 어림수를 쓰지 않는다):
 *   · 지상 24종이 원상자에서 벗어나는 폭은 −9.7% ~ +16.5%다(전에 "±5% 안"이라고
 *     적었던 것은 **거짓**이었다 — 24종 중 13종이 5%를 넘고, 예시로 들었던 마린조차
 *     +5.09%다). 가장 큰 것부터: 마인 +16.5 · 저글링 +12.8 · 히드라 +12.2 ·
 *     다크템플러 −9.7 · 하이템플러 −7.9 · 벌처/럴커 −7.0 · 일꾼 셋 −5.9 · 고스트 +5.9.
 *     등급을 반 몫 섞으니 당연한 결과이고(그것이 섞는 이유다), 여기 적는 이유는
 *     "원작 그대로"라는 말이 ±5%가 아니라 이 밴드라는 뜻임을 못박기 위해서다.
 *   · 공중은 등급이 말하는 크기 언저리로 앉는다. 1차·2차가 지목한 역전은 전부 풀렸다
 *     (손잡이까지 태운 최종값: 셔틀 0.946 > SCV 0.676, 스카웃 0.934 > 마린 0.606,
 *     뮤탈 0.779 < 아비터 1.041, 벌처 0.874 < 시즈탱크 1.026, 스커지 0.506 < 저글링
 *     0.564). 같은 등급 안에서 원상자 순서가 뒤집힌 쌍은 0이다. */
const UNIT_BW_TILES: Record<string, number> = Object.fromEntries(
  Object.entries(UNIT_BW_RAW).map(([k, r]) => {
    /* 공중 슬랙도 안 나눈다(요청: 원작 비율 그대로) — 원작 상자가 곧 화면 크기다.
       그 대신 원작 상자가 표적 획득용으로 넉넉한 공중 종류(스커지 24×24·옵저버 32×32·
       오버로드 50×50)는 화면에서도 그만큼 크게 나온다. 되돌리려면 아래 한 줄에서
       AIR_BOX_SLACK을 다시 나누면 된다. */
    const box = bwBoxTiles(r);
    return [k, SIZE_BLEND === 0 ? box : box ** (1 - SIZE_BLEND) * CLASS_TILES[r[2]] ** SIZE_BLEND];
  }),
);
/** ②-c 원작 몸 지름(타일) — **밀어내기 전용**이다. 등급 섞기도 공중 보정도 안 탄
 *  순수 충돌 상자라, 그리기 크기를 아무리 만져도 진형 간격이 안 흔들린다(지적: 크기표가
 *  진형 간격까지 바꾼다). 겹침의 진실은 simCore의 BODY_R이고 이것은 그 화면판이다. */
const UNIT_BODY_TILES: Record<string, number> = Object.fromEntries(
  Object.entries(UNIT_BW_RAW).map(([k, r]) => [k, bwBoxTiles(r)]),
);
/** ②-d 충돌 상자 → 화면 그림. 원작 스프라이트는 어깨·총·날개가 충돌 상자 밖으로
 *  나가지만 그 크기(GRP 헤더)는 MPQ 없이 못 캔다 — **추측으로 계수를 얹지 않는다.**
 *  1은 "충돌 상자 그대로"라는 뜻이고, GRP를 캐면 여기 한 줄만 갈면 된다. */
const SPRITE_OVERHANG: number = 1;
/** ③-a-상한 시네마틱 비율의 허용 범위 — 이제 사실상 열려 있다(요청: 나중에 시네마틱
 *  모드로 강한 대비도 설정할 것이라 상한을 없애야 한다).
 *
 *  왜 있었나: 상한의 근거는 크기 자체가 아니라 **스프라이트 보관함의 구멍**이었다.
 *  보관함이 '장수'로만 잘려(700장), 대비를 키우면 한 장이 950×950(DPR 2) ≈ 3.6MB까지
 *  커져 이론상 2.5GB가 됐다. 그래서 "가장 큰 유닛의 그리는 상자가 작은 맵에서도 화면 안"
 *  인 마지막 자리(1.35)에 묶어 두었다.
 *  왜 없앴나: 보관함을 **바이트 예산 + LRU**로 바꾸고(SPRITE_BYTES_MAX), 한 장이 너무
 *  커지면 굽지 않고 직접 그리기로 떨어지는 문(SPRITE_SIDE_MAX)을 냈다. 이제 대비를
 *  키워도 메모리가 그 값에 딸려 오르지 않는다 — 큰 판은 캐시를 안 타고 그때그때
 *  그려질 뿐이다(그만큼 느려지는 것은 화면에 그렇게 큰 유닛이 있을 때뿐이다).
 *  남겨 둔 3은 오타 방지용 안전판이다(원작 대비를 다 살려도 1.7 언저리다). */
const SIZE_CONTRAST_MAX = 3;
/** ③-a 시네마틱 비율(요청: "유닛간 크기 대비가 커지면서 좀더 역동적인 장면") —
 *  균일 배수로는 '대비'가 안 커지므로 기준 크기에 대한 **지수**로 건다:
 *      크기' = SIZE_REF × (크기 / SIZE_REF) ^ SIZE_CONTRAST
 *  1이면 그대로, 1보다 크면 큰 유닛은 더 크고 작은 유닛은 더 작아진다. **지금은 UI가
 *  없다** — 손잡이 자리만 만들어 둔 것이고, 붙일 때 손댈 곳은 이 상수 하나다.
 *  기준값 SIZE_REF를 기하평균으로 잡는 것은 취향이 아니라 항등식이다: 이 변환의
 *  기하평균은 REF × (기하평균/REF)^C 이므로, 모든 C에서 전체 크기감이 안 변하는 REF는
 *  기하평균뿐이다(중앙값은 중앙값만, 마린 기준은 마린만 고정하고 전체가 부푼다).
 *  실측(41종): C=1.35에서 큰/작은 비 2.21 → 2.92, 기하평균 0.834 불변(산술평균만 +1.9%).
 *  가장 큰 배틀크루저의 몸이 1.207 → 1.374타일(확대에서 4.26타일)로 커맨드센터 발자국
 *  (4타일)만 하다 — 전장을 가리지 않는다. */
/* 1 → 1.35(요청: 소·중·대 구분이 거의 안 된다. 충돌은 그대로 두고 보이는 것만) —
   상한(SIZE_CONTRAST_MAX)까지 올린다. 실측으로 그리는 상자의 큰/작은 비가 원작 충돌
   상자는 4.43배인데 우리는 2.39배였고(등급비도 원작 1:1.40:1.82 대 우리 1:1.31:1.58),
   그 압축의 절반은 등급 섞기(SIZE_BLEND), 절반은 모델 정규화(16/modelInk)가 만든다.
   ★ 충돌·간격은 한 톨도 안 움직인다 — 겹침의 진실은 simCore의 BODY_R이고, 화면
     진형 간격은 UNIT_BODY_TILES(등급 섞기도 이 지수도 안 타는 순수 충돌 상자)가
     정한다. 이 상수는 UNIT_BW_TILES(그리기 전용)에만 걸린다.
   1.35는 옛 상한이 묶어 두던 자리다. 상한은 이제 풀렸으므로(위 SIZE_CONTRAST_MAX)
   시네마틱 모드가 붙을 때 이 값만 올리면 된다 — 원작 충돌 상자의 대비를 다 살리는
   값이 1.7 언저리다. */
/* 1.35 → 1(요청: "유닛 크기 비율 원작과 똑같이") — 이 지수는 원작 비율을 **일부러
   과장하는** 손잡이다(큰 유닛은 더 크게·작은 유닛은 더 작게). 원작 그대로를 원하면
   1이 그 값이다. 시네마틱 모드가 붙을 때 이 상수만 올리면 과장이 돌아온다. */
const SIZE_CONTRAST: number = 1;
/** 실제로 쓰이는 값 — 1 미만(작은 유닛이 더 커지는 방향)과 상한 밖을 막는다. */
const SIZE_CONTRAST_C = Math.min(SIZE_CONTRAST_MAX, Math.max(1, SIZE_CONTRAST));
const SIZE_REF = gmOf(Object.values(UNIT_BW_TILES));
/** ③-b 종류별 손보기(기본 1) — **여기가 사람이 만지는 자리다.** 열쇠는 원작 자료표의
 *  것이라 오타가 컴파일에서 잡힌다(예전 표는 `zergling: 1.2`가 조용히 무시됐다).
 *
 *  왜 채워야 하나: 위 크기표는 원작 자료가 말하는 데까지만 간다. 그런데 units.dat의
 *  치수 열에는 **기본값이 그대로 남은 칸**이 많다 — 32×32에 여덟 종, 44×44에 넷이
 *  몰려 있고, 등급까지 같으면 √(상자×등급)이 상자의 단조함수라 원리적으로 못 가른다.
 *  손보기 전에는 41종 중 19종이 여섯 무리로 뭉쳤고 서로 다른 값이 28개뿐이었다.
 *  아래 15칸을 채워 **동률 19종 → 7종, 서로 다른 값 28 → 37**이 됐다.
 *  남는 7종(SCV·프로브·드론 / 마린·메딕 / 드랍십·발키리)은 **원전 상자가 글자
 *  그대로 같은 값**이라(23×23 · 17×20 · 49×37) 자료에 더 없는 자리다 — 뭉갠 것이
 *  아니라 자료가 같다고 말하는 것이라 손대지 않았다.
 *
 *  값의 출처를 칸마다 밝힌다. 세 갈래다:
 *   (자료-공중) 레이스·스카웃·셔틀 — AIR_BOX_SLACK 상수가 만든 역전을 되돌린다.
 *      상수 1.4413 대신 제 잔차 r을 절반 몫만 쓰는 것과 같게 (1.4413/r)^(1/4)로 잡았다
 *      (상자가 지수 0.5로 들어가므로 슬랙 보정의 반이 네제곱근이다).
 *      레이스 r=1.044 → 1.084 · 스카웃 1.049 → 1.083 · 셔틀 1.106 → 1.068.
 *      덤으로 "UNIT_FILL_TARGET으로 키웠던 레이스가 도리어 0.947배로 작아진다"는
 *      회귀도 이 칸이 닫는다(0.947 × 1.084 = 1.027배 — 지금보다 조금 커진다).
 *   (자료-무리) 32×32·44×44 뭉치 — 순서만 원전의 다른 열에서 끌어온다.
 *      수송칸(unitSpaceRequired) · 인구(unitSupplyRequired) · 내구(HP+실드)를 이 순서로
 *      본다. 세 열 모두 같은 UnitType.cpp에 있고, 수송칸은 "이 유닛이 배에서 몇 칸을
 *      차지하나"라 부피에 가장 가까운 원전 진술이다.
 *      골리앗 수송2·HP125 → 가장 작게 / 드라군 수송4·인구4·내구180 /
 *      탱크 수송4·인구4·내구150(기준, 손 안 댐) / 다크아콘 인구8·내구225 /
 *      시즈탱크(같은 유닛의 편 자세라 탱크보다 조금 크게) / 아콘 인구8·내구360 /
 *      리버 인구8·수송4(가장 둔한 공성 기계) 순.
 *      벌처 수송2 < 럴커 수송4로 32×32 중형 둘도 갈린다.
 *      **폭은 임의다**: 세 열이 순서만 주고 배수는 안 주므로, 울트라(원전 38×32로
 *      실측치가 있는 유일한 대형 지상)의 1.0495를 넘지 않는 선에서 2~4%씩 벌렸다.
 *   (눈대중) 스커지·오버로드·가디언 쪽 — 자료가 아니라 화면을 보고 정한 값이다.
 *      스커지 0.88: 원전 24×24는 공중 표적 획득용 상자이고(잔차 1.179) 실제 몸은
 *      저글링(16×16)보다 작다. 저글링 아래로 내리는 데 필요한 최소치는 0.980인데,
 *      눈에 확실히 작게 보이도록 0.88까지 내렸다 — 이 폭은 **임의다**.
 *      오버로드 1.05: 원전 상자 50×50이 41종 중 넷째로 크지만 울트라와 0.26% 차라
 *      사실상 동률이었다. 4.7%로 벌렸다 — 방향은 자료, **폭은 임의다**.
 *      디바우러 1.02 · 아비터 1.06: 44×44 셋 중 가디언을 기준으로 두고
 *      내구(250 / 350+150)와 인구(4 / 8) 순으로 벌렸다. **폭은 임의다.** */
const UNIT_SIZE_TUNE: Partial<Record<keyof typeof UNIT_BW_RAW, number>> = {
  /* 원작 비율로 돌린 뒤 **화면을 보고** 다시 잡은 값들이다(요청: 축소 마인·옵저버 /
     확대 아비터·디파일러·울트라). 앞선 15칸(등급 섞기·공중 슬랙의 왜곡을 되돌리던 값)은
     원인을 껐으므로 전부 비웠고, 여기 남는 것은 '자료가 말하는 상자'와 '눈에 보이는 몸'이
     갈리는 종류뿐이다 — 그 갈림의 뿌리는 units.dat의 상자가 표적 획득용이라 실제 그림과
     다른 데 있다(마인 15×15인데 모델은 납작한 원반, 옵저버 32×32인데 그림은 작은 구슬,
     아비터·디파일러·울트라는 반대로 그림이 상자보다 크다). GRP 헤더를 캐면 이 표는
     통째로 필요 없어진다. 폭은 ±20% 안에서 눈대중이다 — [어림]. */
  /* 2차 조정(요청: "다시한번 — 축소: 일꾼류·테란 보병 4종·프로토스 인간형 3종·옵저버·
     커세어 / 확대: 울트라"). 사람 크기의 것들이 한 덩이로 커 보였다는 뜻이라 그 무리를
     같은 몫(0.85)으로 함께 내리고, 두 번 지적된 옵저버는 한 단 더(0.8 → 0.68), 울트라는
     한 단 더 올린다(1.2 → 1.35). 무리를 같은 값으로 움직이는 것이 핵심이다 — 낱개로
     흩으면 원작이 정해 준 그들 사이의 비율이 깨진다. */
  scv: 0.85, probe: 0.85, drone: 0.85,
  gunner: 0.85, fbat: 0.85, ghost: 0.85, inf: 0.85,
  zealot: 0.85, dtemp: 0.85, htemp: 0.85,
  corsair: 0.85,
  mine: 0.8, observer: 0.68, scourge: 0.7,
  arbiter: 1.2, defiler: 1.2, ultra: 1.5,
};
/** ③-c 전체 배수 — "다 조금 크게/작게"를 한 값으로. */
const UNIT_SIZE_GLOBAL: number = 1;
/** 화면 크기의 유일한 입구(타일).
 *  열쇠가 둘인 것이 핵심이다(지적: 손잡이가 못 닿는 종류가 7개) —
 *   · sizeKind(원작 치수)는 **유닛의 성질**이다. 버로우한 히드라의 구멍은 히드라 크기다.
 *   · drawKind(잉크 몫)는 **모델의 성질**이다. 시즈탱크는 tankbody로 그려진다.
 *  이 둘을 갈라 놓으면 tankbody·tankgun·tanksiegebody·tanksiegegun·lurkeregg·
 *  mutacocoon·burrowhole까지 전부 손잡이가 닿는다. */
// 계측 스크립트가 화면과 같은 값을 읽을 수 있게 내보낸다(scripts/… 실측용).
export const unitTilesOf = (drawKind: string, sizeKind: string, bulk: 0 | 1 | 2): number => {
  const bw0 = UNIT_BW_TILES[sizeKind] ?? CLASS_TILES[bulk];
  const bw = SIZE_CONTRAST_C === 1 ? bw0 : SIZE_REF * (bw0 / SIZE_REF) ** SIZE_CONTRAST_C;
  return bw * SPRITE_OVERHANG * (16 / modelInkOf(drawKind))
    * (UNIT_SIZE_TUNE[sizeKind as keyof typeof UNIT_BW_RAW] ?? 1) * UNIT_SIZE_GLOBAL;
};/** 도형째 돌려 그리는 각도(시계방향) — 옛 스타게이트(반쪽 원통)용 45도는 봉오리
 *  재설계로 걷었다: 잎이 정확히 위아래·좌우에 서야 하고(요청), 화면 회전은 바닥
 *  그림자까지 대각선으로 돌려 검은 얼룩처럼 보였다. */
const SHAPE_ROT: Record<string, number> = {};
/** 관리자 모델링 뷰어(요청) — 도형 카탈로그. 건물은 SHAPE_KIND에서, 유닛 갈래는 손으로. */
/* 도록 차례(재편·요청) — 유닛/건물로 가르고, 각 갈래는 테란 → 프로토스 → 저그,
   그 안에서는 기본 → 고급·후반 순이다. 갤러리 목록과 시트가 같은 차례를 쓴다. */
export const SHAPE_GALLERY: { kind: string; label: string; group: "유닛" | "건물" }[] = [
  // ── 유닛 · 테란 ──
  { kind: "scv", label: "SCV", group: "유닛" },
  { kind: "scvMin", label: "SCV(미네랄)", group: "유닛" },
  { kind: "scvGas", label: "SCV(가스)", group: "유닛" },
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
  { kind: "probeMin", label: "프로브(미네랄)", group: "유닛" },
  { kind: "probeGas", label: "프로브(가스)", group: "유닛" },
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
  { kind: "droneMin", label: "드론(미네랄)", group: "유닛" },
  { kind: "droneGas", label: "드론(가스)", group: "유닛" },
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
  { kind: "tribunal", label: "아비터 트리뷰널", group: "건물" },
  { kind: "warpin", label: "소환구(프로토스)", group: "건물" },
  // ── 건물 · 저그 ──
  { kind: "hatchery", label: "해처리", group: "건물" },
  { kind: "lair", label: "레어", group: "건물" },
  { kind: "hive", label: "하이브", group: "건물" },
  { kind: "creep", label: "크립 콜로니", group: "건물" },
  { kind: "sunken", label: "성큰", group: "건물" },
  { kind: "sunkenfire", label: "성큰(발사)", group: "건물" },
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

/** 도형 kind → 그 kind로 그려지는 건물의 원작 이름 — SHAPE_KIND를 뒤집은 것이다.
 *  이름이 여럿인 kind(ComSat·Comsat Station)는 먼저 걸린 하나로 족하다: 발자국이 같다. */
const BLD_NAME_OF_KIND: Record<string, string> = Object.fromEntries(
  Object.entries(SHAPE_KIND).map(([name, k]) => [k, name]).reverse(),
);
/** 도록 kind → 원작 치수를 가진 kind — 제 치수가 표에 없는 변형들만 적는다. */
const GALLERY_SIZE_KIND: Record<string, string> = {
  carrierbay: "carrier",   // 인터셉터를 문 캐리어 — 몸은 캐리어다
  lurkeregg: "lurker",     // 알은 러커의 한 시절
  mutacocoon: "muta",      // 고치도 마찬가지
  // 짐을 진 일꾼 — 지도에서 차지하는 상자는 맨몸 그대로다(짐은 몸을 안 키운다).
  scvMin: "scv", scvGas: "scv",
  probeMin: "probe", probeGas: "probe",
  droneMin: "drone", droneGas: "drone",
};
/** 도록 kind → 지도에서 차지하는 상자의 **한 변**(타일) — 모델 갤러리의 '지도상 크기'가
 *  이 값으로 모델을 줄이고 늘인다(요청).
 *  ★ 한 변인 것이 핵심이다(수리: 켜면 건물이 납작해 보인다) — 처음에 건물을 발자국
 *    가로·세로(4×3)로 눌렀는데, **지도는 그렇게 그리지 않는다**: 건물 op은 fitWidth라
 *    상자의 한 변을 발자국 **폭**으로만 잡고(UnitLayer의 `sidePx = op.fitWidth ? wPx`),
 *    스프라이트는 정사각 판에 균일 배율로 굽는다(`c2.scale(sideQ/16, sideQ/16)`).
 *    세로로 따로 누르면 지도에 없는 눌림을 도록이 지어내는 셈이었다.
 *  자가 둘인데 눈금은 하나다: 유닛은 원작 치수표가 정한 상자(unitTilesOf — 지도의
 *  unitGlyphPx가 tilePx를 곱하기 **직전**의 바로 그 값), 건물은 발자국 폭이다. 둘 다
 *  단위가 타일이라 유닛과 건물을 한 자로 나란히 견줄 수 있다.
 *  ⚠ **크기만** 지도와 같다. 도록은 사선(base) 시점이고 지도 기본은 위에서 본(top)
 *    시점이라, 같은 모델도 −9.1%(스카웃)~+15.1%(변태고치)로 어긋난다(ShapeIcon 주석).
 *    또 지도에는 화면 크기에 따른 자동 등급 강등이 걸리는데 여기엔 없다 — 부품이 얼마나
 *    빠지는지는 사양 라디오가 따로 말한다. */
export const shapeMapTiles = (kind: string): number => {
  const bld = BLD_NAME_OF_KIND[kind];
  if (bld) return (FOOTPRINT[bld] ?? [3, 2])[0];
  // 자원 둘은 건물표에 없다 — 원작 발자국 폭 그대로(미네랄 2, 간헐천 4).
  if (kind === "mineral") return 2;
  if (kind === "geyser") return 4;
  // 공사장·고치는 무엇이 될지에 따라 달라진다 — 흔한 3×2의 폭 3으로 둔다(건물 폴백).
  if (kind === "scaffold" || kind === "cocoon") return 3;
  const sk = GALLERY_SIZE_KIND[kind] ?? kind;
  return unitTilesOf(sk, sk, 1);
};

/** 유닛(지상 이동체) 모델 kind 집합 — 겹침 방지 이완의 대상 판별에 쓴다(도록의 유닛
 *  갈래 그대로). 건물·자원·크립은 여기 없어 안 밀린다. */
const UNIT_KIND_SET = new Set(SHAPE_GALLERY.filter((g) => g.group === "유닛").map((g) => g.kind));
/** 일꾼 모델 — 겹침 이완에서 제 일꾼끼리는 서로 안 밀어낸다(지적: 자원 곁 포개짐 허용). */
const WORKER_KIND_SET = new Set([
  "scv", "probe", "drone",
  // 짐을 지고 오는 일꾼도 일꾼이다 — 밭 곁 포개짐은 짐 유무를 안 가린다.
  "scvMin", "scvGas", "probeMin", "probeGas", "droneMin", "droneGas",
]);

/** ShapeIcon의 면 목록 결정을 떼어 낸 것 — 캔버스 유닛 층(UnitLayer)이 같은 판(같은
 *  굽기 캐시)을 그대로 그리려면 SVG 밖에서도 이 결정을 불러야 한다. 결과가 같은 함수
 *  하나이므로 SVG와 캔버스의 픽셀이 같은 도형에서 나온다(품질 동일의 근거). */
/* 본 게임과 같은 요잉(지적: 45도 시계방향) — 건물 모델의 기본 방향을 원작 아이소메트릭
   느낌으로 튼다. 원작 스프라이트 방향이 다른 모델(서플라이 디포 등)은 아래 보정표에
   도(°)를 더한다 — 값은 지적받는 대로 채운다. */
const BUILDING_BASE_YAW = 45;
const MODEL_YAW_TWEAK: Record<string, number> = {
  /* 어시밀레이터는 보정을 걷었다(지적: 각도 문제 — 앞선 요청들을 되돌린다) — 합계
     135로 총 180도였는데, 그러면 이 건물만 사선이 아니라 축에 나란히, 그것도 정면을
     등지고 서서 제일 눈에 띄는 앞면 청록 렌즈가 어느 방향에서도 안 보였다. 기본
     요잉(45도) 그대로 두어 보정 없는 다른 건물들과 같은 사선 자세가 된다. */
  // 반시계 90도(지적) — 히드라 덴·서플·포지·테란 공사장.
  hydraden: -90, trapezoid: -90, forge: -90, scaffold: -90,
  // 시계 90도(지적) — 템플러 아카이브. 로보틱스는 모델 자체가 앞을 보게 고쳐 보정 0.
  // 아카이브 시계 90도(요청) — -90 → 0.
  dome: 0, archives: 0,
  /* 에볼루션 챔버·옵저버토리 시계 90도(지적: "에볼루션 챔버, 옵저버토리 시계 90도
     요잉") — 둘 다 앞뒤가 뒤바뀌어 서 있었다: 에볼루션 챔버는 살덩이 엽 둘이 옆을
     보고 검은 등걸이 앞을 가렸고, 옵저버토리는 앞을 감싸야 할 초승달 받침이 옆으로
     누웠다. 이 표는 시계방향이 +다(위 히드라 덴·포지의 반시계 −90과 짝). */
  evo: 90,
  /* 옵저버토리 시계 180도(요청) — 90에서 한 번 더 돌린다: 초승달 받침이 앞을 감싸야
     하는데 90에서는 뒤를 감싸고 있었다. */
  observatory: 270,
  /* 익스트랙터 시계 45도(요청) — 간헐천 구멍이 정면을 보게 반 칸 돌린다. */
  extract: 45,
};
export const buildingYawOf = (kind: string): number =>
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
      // bake(부품 번호 새로 세기)를 가장 바깥에 둔다 — 굽는 판 하나가 곧 부품 한 벌이다.
      const bake0 = (): ShapeFace[] => withViewShear(sh, () => withYaw(-bucket, builder));
      const baked = pitchView ? (): ShapeFace[] => withPitchView(bake0) : bake0;
      f = bake(() => (flat ? withTopView(baked) : baked()));
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
  /** 도형 한 변(px) — 크기표 × 모델 크기 라디오 × 깊이 배율까지 포함한 **그리는 상자**다.
   *  화면에 보이는 몸은 이것의 약 1/3(NORM_TARGET_INK/16)이고, 몸을 자로 삼는 장식은
   *  이 값이 아니라 구운 판의 잉크 폭(inkW)을 쓴다. */
  sizePx: number;
  /** 진형 간격용 몸 지름(px, 줌 전) — 원작 충돌 상자다. **그리기 크기와 따로 간다**:
   *  크기표·'모델 크기' 라디오·시네마틱 대비를 아무리 만져도 유닛끼리 벌어지는 간격은
   *  안 바뀐다. 없으면 sizePx 어림으로 물러난다(공사 SCV·마인처럼 안 밀어내는 op). */
  sepPx?: number;
  color: string;
  alpha: number;
  /* ── 건물용(캔버스 전환 둘째 판) — 발자국 비례 상자에 그린다. ───────────────── */
  /** 상자 폭·높이 — 캔버스 '폭'에 대한 분수(스팬의 % 폭 + aspectRatio와 같은 자).
   *  있으면 sizePx 대신 이 상자를 쓴다. */
  wFrac?: number; hFrac?: number;
  /** 상자 채우기 방식 — "meet"는 비율 유지·바닥 정렬(keepRatio), "fill"은 맨 네모 채움. */
  boxFit?: "meet" | "fill";
  /** 공사 단계 1~3 — 모델의 아래쪽 stg/3만 그린다(요청: 아래 부품부터 점점 위로).
   *  0이나 3이면 통째로. */
  buildStage?: number;
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
  /** 방금 명령을 받아 잡혀 있음 — 발밑에 임자 색 선택 링(지적: 드래그 선택 구분). */
  selRing?: boolean;
  /* ── 정보 팝업(요청: 유닛·건물 클릭하면 정보 툴팁) ─────────────────────────────
     클릭 판정과 툴팁이 이 셋만 본다. 열쇠는 프레임이 바뀌어도 같은 몸을 가리켜야
     하므로 유닛은 개체 태그, 건물은 임자·종류·자리로 짓는다. */
  pickKey?: string;
  /** 영문 유닛·건물 이름(표 조회용). */
  pickName?: string;
  /** 임자(플레이어 raw). */
  pickRaw?: string;
  /** 건물인가 — 툴팁이 생산·연구·큐를 보여 줄지 가른다. */
  pickBld?: boolean;
  /** 지금 무슨 상태인가(요청: 건설·변태 등 모든 상태 노출) — 툴팁 첫 줄에 그대로 뜬다. */
  pickState?: string;
  /** 걸려 있는 마법(키) — 팝업이 그 효과와 색까지 적는다. */
  pickStatus?: string;
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
/* ── 부품 등급(LOD, 요청: "모델들의 부품 중요도도 3단계 정도로 나눠서 사양에 따라
      부분 렌더링") ────────────────────────────────────────────────────────────────
   판을 굽는 순간 딱 한 번 거른다. 등급이 캐시 열쇠에 들어가므로 프레임마다 재는 비용이
   없고, 같은 크기·같은 등급이면 판을 그대로 재활용한다.

   등급을 정하는 자는 둘을 곱한 것이다.
     ① 화면에 실제로 몇 픽셀로 그려지는가 — 건물이 14px로 보일 때 리벳을 그리는 것은
        순수한 낭비다. 설정이 필요 없고 효과가 가장 크다(축소해서 볼 때 유닛 수백이
        한꺼번에 작아진다).
     ② 기기 여력 — 느린 기기에서는 한 단 낮춘다. 모바일에서 특히.
   지금은 아무 면에도 등급이 안 달려 있어(전부 기본 1) 이 필터는 아무것도 안 걸러낸다.
   모델을 다시 쓸 때마다 장식에 deco(), 포인트에 accent()를 씌워 나가면 그때부터 는다. */
const LOD_PX_POINT = 22;
const LOD_PX_DECO = 44;
/* 유닛 전용 문턱(지적: 상자로 등급을 정하면 상자가 줄어든 종류가 한 단 떨어져 장식이
   사라진다) — 건물은 제 발자국 상자를 거의 꽉 채워 그려지므로 상자 px이 곧 몸 px이지만,
   유닛은 정규화 뒤에도 상자의 32%(NORM_TARGET_INK/16)만 잉크다. 같은 22/44를 쓰면
   유닛만 세 배 후하게 판정된다. 유닛은 잉크 px으로 재고 문턱도 그 자로 옮긴다.
   문턱 값은 **전수로 다시 잡았다**. 앞선 설계의 6.5/13은 12칸짜리 화면 표본
   (타일 8·2.8 × 줌 1·2·4 × 표준·확대)에서만 '하락 0종'이었고, 그 표본이 문턱을
   비껴갔다 — 타일 4·확대·줌1처럼 흔한 화면(128타일 맵을 512px로 보는 자리)에서
   대형 일곱이 3→2로 떨어져 실루엣 광원(lod>=3 게이트)을 잃었다.
   지금 값은 41종 × 타일 1.0~20.9(0.1 눈금) × 줌 1·2·4 × 표준·확대 = 49,200칸을
   **전수로** 돌려 잡았다. 지금 코드 대비 등급이 떨어지는 칸이 0이 되는 상한은
   5.20/11.05(둘 다 골리앗이 정한다)이고, 여기서 조금 물러선 자리가 5.0/11이다.
   이 값에서 하락 0칸 · 상승 13,676칸(더 선명해지는 쪽)이다. 옛 채움 보정의 몫
   (FILL_CACHE)이 방향 버킷에 따라 흔들리므로, 그 몫을 버킷0·최소·최대·평균 넷으로
   바꿔 가며 네 번 다 돌려도 하락은 0칸이었다. */
const LOD_INK_POINT = 5.0;
const LOD_INK_DECO = 11;
/** 사양 라디오가 정하는 등급 상한(요청: "LOD 적용 및 성능 3단계로 — 딱 LOD랑 맞고
 *  편하지") — 저 1(형체만) · 중 2(+포인트) · 고 3(+장식). 크기로 정한 등급과 이 상한
 *  중 낮은 쪽이 실제 등급이라, 사양을 내리면 큰 모델도 부품을 덜 그린다. */
let lodCap = LOD_FINE;
function lodSetCap(q: number): void {
  lodCap = q <= 1 ? 1 : q === 2 ? LOD_TRIM : LOD_FINE;
}
/** 기기 여력 벌점(0 또는 1) — 프레임이 계속 밀리면 1로 올라 등급이 한 단 내려간다. */
let lodPenalty = 0;
let lodSlowFrames = 0;
/** 재생 루프가 프레임마다 부른다 — 느린 프레임이 이어지면 등급을 한 단 내린다. */
function lodNoteFrame(ms: number): void {
  if (ms > 34) {
    lodSlowFrames += 1;
    if (lodSlowFrames > 45 && lodPenalty === 0) { lodPenalty = 1; lodSlowFrames = 0; }
  } else if (lodSlowFrames > 0) lodSlowFrames -= 1;
}
/** 이 크기로 그릴 때의 등급 — 1 형체 / 2 포인트 / 3 장식. */
function lodOf(px: number, ptPx = LOD_PX_POINT, dcPx = LOD_PX_DECO): number {
  const base = px < ptPx ? 1 : px < dcPx ? 2 : 3;
  // 크기가 정한 등급과 사양 상한 중 낮은 쪽 — 거기서 기기 벌점을 또 한 단 뺀다.
  return Math.max(1, Math.min(base, lodCap) - lodPenalty);
}

/* 실루엣 광원(요청: "사양 최고에서는 유닛과 건물 모두 밝음 어두움 표현 필요") —
   판을 다 그린 뒤, **이미 그려진 픽셀 위에만**(source-atop) 세계 광원 방향의 밝기
   기울기를 얹는다.

   왜 이게 필요한가: 이 렌더러의 명암은 두 갈래로 들어온다. 프리미티브(돔·기둥·상자·뿔)는
   제 면의 법선을 광원과 내적해 스스로 밝기를 매기지만(faceLight), 손으로 그린 몸판
   (bodyFace)은 그냥 단색이다 — bodyFace(d)는 말 그대로 [d, 1]이다. 그래서 프리미티브로
   지은 모델(시즈탱크·골리앗)은 입체로 보이고, 손으로 그린 모델은 납작하다.
   지적한 오버로드가 정확히 뒤쪽이다: 몸통이 bodyFace(타원) 한 장이라 어느 각도에서도
   같은 색이었다("오버로드 몸도 입체인데 빛 효과가 안 들어감").

   면마다 고치려면 모델 아흔 개를 다 손봐야 하고, 손 그림 면에는 법선이라는 것이 아예
   없다. 대신 실루엣 전체에 한 장을 얹으면 손 그림이든 프리미티브든 똑같이 형태가 산다.
   판은 어차피 한 번만 굽고 캐시되므로 프레임당 비용은 0이고, 이미 명암이 있는 모델에도
   해가 없도록 기울기는 얕게 잡았다(밝은 쪽 +14%, 어두운 쪽 -20%).

   광원은 세계 왼쪽 앞(faceLight와 같은 방향)이라 화면에서는 좌상 → 우하다.
   최고 등급(장식까지 그리는 판)에서만 얹는다 — 작게 그릴 땐 어차피 안 보인다. */
function silhouetteLight(c2: CanvasRenderingContext2D, cv: HTMLCanvasElement): void {
  const prev = c2.getTransform();
  c2.setTransform(1, 0, 0, 1, 0, 0);
  c2.globalCompositeOperation = "source-atop";
  c2.globalAlpha = 1;
  const g = c2.createLinearGradient(0, 0, cv.width, cv.height);
  g.addColorStop(0, "rgba(255,255,255,0.14)");
  g.addColorStop(0.42, "rgba(255,255,255,0)");
  g.addColorStop(0.58, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.20)");
  c2.fillStyle = g;
  c2.fillRect(0, 0, cv.width, cv.height);
  c2.globalCompositeOperation = "source-over";
  c2.setTransform(prev);
}

/* (삭제) 유닛 상자 채움 보정 — 옛 FILL_SKIP·FILL_PAIR·FILL_CACHE·UNIT_FILL_TARGET.
   구운 판의 잉크 폭을 재서 되키우던 자다. 모델 공간을 종류마다 같은 몫으로 맞추는
   MODEL_NORM이 그 일을 설계 단계에서 끝내므로 통째로 걷었다(상한 1.55에 걸려 저글링·
   프로브·스커지가 아무리 작아도 못 커지던 문제도 함께 사라진다). 뮤탈처럼 '날개는
   넓은데 몸은 작은' 모델을 위한 목표표도 필요 없다 — 잉크 폭이 아니라 잉크 **상자**
   (√(폭×높이))로 맞추므로 옆으로만 퍼진 모델이 '이미 큰 모델'로 재지지 않는다.
   **짝(포신·차체)을 묶던 몫만은 없애지 않고 옮겼다** — MODEL_NORM 옆의 NORM_PAIR가
   그 자리다. 축이 같은 상자 중심이라는 것만으로는 부족하고, 배율까지 같아야 포탑이
   차체 위에서 안 미끄러진다(이 주석의 옛 판이 적어 둔 실패 모드가 바로 그것이다).
   **건물 쪽(BLD_FILL_*)은 발자국이 크기를 정하는 다른 체계라 그대로 둔다.** */
/* 스프라이트 보관함의 잘라내기(수리: 장수로만 자르면 큰 판이 쌓일 때 메모리가 터진다)
   — 여태 기준이 '장수'뿐이라, 한 장이 얼마나 큰지는 보지 않고 700장까지 쌓았다. 판
   크기는 유닛의 그리는 상자에 비례하므로, 대비를 키우거나 깊게 확대하면 한 장이
   950×950(DPR 2) ≈ 3.6MB까지 간다 — 700장이면 이론상 2.5GB다. 그 구멍 때문에 크기
   대비 상수(SIZE_CONTRAST)에 상한을 걸어 두어야 했다.
   이제 **바이트로 재고 오래된 것부터 덜어낸다**(LRU). Map은 넣은 차례를 지키므로,
   찾을 때마다 지웠다 다시 넣어 맨 뒤로 보내면 맨 앞이 늘 '가장 오래 안 쓴 것'이다.
   통째로 비우던 옛 방식은 다음 프레임에 화면 전체를 다시 굽게 만들어 그 순간 끊겼다. */
const SPRITE_BYTES_MAX = 96 * 1024 * 1024;
/** 판 한 장의 한 변 상한(장치 픽셀) — 이보다 커야 하는 요청은 굽지 않고 **직접 그리기**로
 *  떨어진다(호출부가 판이 없을 때의 길을 이미 갖고 있다). 예산(LRU)은 '여러 장이 쌓여'
 *  터지는 것을 막지만, 한 장이 통째로 거대한 경우는 못 막는다 — 이 문이 그것을 막고,
 *  그래서 크기 대비 상수의 상한이 필요 없어졌다.
 *  값 1536은 실측으로 잡았다(DPR 2): 흔히 가장 큰 그림인 '깊게 확대한 배틀크루저'가
 *  요청 271px → 장치 940px이라 1024로 두면 문턱에 바로 닿아, 제일 눈에 띄는 유닛이
 *  늘 캐시를 못 타고 매 프레임 다시 그려진다. 1536이면 그 판(9MB)까지 캐시에 들어오고,
 *  예산 96MB 안이라 그런 판이 열 장 쌓여도 LRU가 감당한다. */
const SPRITE_SIDE_MAX = 1536;
const BLD_SPRITE_BYTES_MAX = 64 * 1024 * 1024;
/** 캔버스 한 장이 먹는 바이트 — 픽셀당 RGBA 4바이트. */
const canvasBytes = (cv: HTMLCanvasElement): number => cv.width * cv.height * 4;
/** 예산을 넘는 동안 가장 오래 안 쓴 것부터 덜어낸다. */
function trimSpriteCache<T extends { cv: HTMLCanvasElement }>(
  cache: Map<string, T>, bytes: { n: number }, budget: number,
): void {
  while (bytes.n > budget && cache.size > 1) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    const got = cache.get(oldest.value);
    if (got) bytes.n -= canvasBytes(got.cv);
    cache.delete(oldest.value);
  }
}
const SPRITE_CACHE = new Map<string, { cv: HTMLCanvasElement; pad: number; l: number; bot: number; cx: number; top: number; w: number }>();
const spriteBytes = { n: 0 };
function unitSprite(
  op: UnitDrawOp, pxq: number, B: number,
): { cv: HTMLCanvasElement; pad: number; l: number; bot: number; cx: number; top: number; w: number } | null {
  const rotB = op.rotDeg !== undefined
    ? ((Math.round(op.rotDeg / 22.5) * 22.5) % 360 + 360) % 360 : -1;
  const vq = op.viewYaw ? Math.max(-36, Math.min(36, Math.round(op.viewYaw / 6) * 6)) : 0;
  // 등급은 상자가 아니라 이 모델이 실제로 칠하는 잉크 폭으로 정한다(위 LOD_INK_* 참고).
  const lod = lodOf((pxq * modelInkOf(op.kind)) / 16, LOD_INK_POINT, LOD_INK_DECO);
  const key = `${op.kind}|${rotB}|${op.flat ? 1 : 0}|${vq}|${op.pitch ? 1 : 0}`
    + `|${op.color}|${pxq}|${B.toFixed(2)}|${lod}`;
  const hit = SPRITE_CACHE.get(key);
  // 찾은 것은 맨 뒤로 — 그래야 맨 앞이 '가장 오래 안 쓴 것'이 된다(LRU).
  if (hit) { SPRITE_CACHE.delete(key); SPRITE_CACHE.set(key, hit); return hit; }
  const { faces: all } = resolveShapeFaces(op.kind, op.rotDeg, op.flat, op.viewYaw, op.pitch);
  if (!all) return null;
  const faces = lodFilter(autoTier(op.kind, `u|${op.kind}|${op.rotDeg ?? 0}|${op.flat ? 1 : 0}|${vq}|${op.pitch ? 1 : 0}`, all), lod);
  /* (제거·요청) 드롭섀도 굽기 — 건물·유닛 그림자를 다 걷어 굽는 판도 그림자 없이 민다.
     pad는 안티에일리어싱 여유만. */
  const pad = 2;
  const l = pxq + pad * 2;
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.ceil(l * B));
  cv.height = cv.width;
  // 너무 큰 판은 굽지 않는다(위 SPRITE_SIDE_MAX) — 직접 그리기로 떨어진다.
  if (cv.width > SPRITE_SIDE_MAX) return null;
  const c2 = cv.getContext("2d");
  if (!c2) return null;
  c2.setTransform(B, 0, 0, B, 0, 0);
  c2.translate(pad, pad);
  c2.scale(pxq / 16, pxq / 16);
  /* 모델 공간 정규화(요청: "모델 좌표를 키우는 쪽이 낫겠다") — 면을 채우기 **전에**,
     상자 한가운데를 축으로 종류별 배수를 건다. 이것이 곧 '모델 좌표를 키우는 것'이고,
     배수는 종류마다 상수이며 캐시 열쇠에 종류가 이미 들어 있으므로 추가 비용은 0이다.
     짝(차체·포신)은 modelNormOf가 **같은 배수**로 접어 준다 — 축이 같은 것만으로는
     안 되고 배율까지 같아야 포탑이 차체 위에서 안 미끄러진다(옛 FILL_PAIR의 뜻).
     도록(ShapeIcon)·총구 앵커도 같은 입구를 탄다 — 셋이 갈리면 트레이서가 포신을
     벗어나고 자료실 크기와 지도 크기가 어긋난다. */
  const nrm = modelNormOf(op.kind);
  if (nrm !== 1) { c2.translate(8, 8); c2.scale(nrm, nrm); c2.translate(-8, -8); }
  for (const [d, o, fill] of faces) {
    c2.globalAlpha = shadeBoost(o, fill);
    c2.fillStyle = fill ?? op.color;
    c2.fill(pathOf(d));
  }
  if (lod >= 3) silhouetteLight(c2, cv);
  const entry = { cv, pad, l, ...contentBox(cv) };
  SPRITE_CACHE.set(key, entry);
  spriteBytes.n += canvasBytes(cv);
  trimSpriteCache(SPRITE_CACHE, spriteBytes, SPRITE_BYTES_MAX);
  return entry;
}
/* 건물 스프라이트(요청: 건물도 병목 감축) — meet(비율 유지) 상자 건물을 같은 방식으로
   굽는다. 뷰박스 밖으로 살짝 삐치는 모델(높은 첨탑 등)을 위해 15% 머리방을 둔다. */
/* 건물 채움 보정에서 빼는 것들 — 크립 판(clipWalk)은 지형이고, 애드온 통로는 본체와
   부속 사이를 잇는 폭이 곧 제 길이라 늘리면 어긋난다. 미네랄은 발자국이 아니라 덩이
   넷을 흩어 놓은 무리라 요청대로 손대지 않는다. */
/** 화가 순서의 한 타일(수리: 겹치는 건물의 앞뒤가 뒤바뀐다 · 소환구가 앞 건물에 안 가려짐)
 *  — 여태 한 타일이 80이었는데, 건물의 '나이' 항이 최대 30이었다. 그래서 아랫변이
 *  0.375타일 안으로 붙은 두 건물은 **자리가 아니라 나이가 앞뒤를 정했다**: 나란히 선
 *  건물끼리 뒤엣것이 앞을 덮었고, 갓 소환을 시작한 소환구(나이 항이 가장 크다)는 이미
 *  서 있던 앞 건물 위로 올라왔다.
 *  한 타일을 800으로 넓혀 나이는 0.1타일 미만의 **진짜 동점**만 가른다. 층 편향
 *  (자원 +1200 = 1.5타일, 유닛 +400 = 0.5타일)도 같은 배수로 따라온다. */
const Z_TILE = 800;
/** 공중은 늘 위층 — 지상 z가 아무리 커도(맵 256타일 × Z_TILE) 못 넘는 값이어야 한다. */
const Z_AIR = 10000000;
/** 프로토스 소환구 상자(타일)와 지면에서 띄우는 높이(타일) — 요청: 축소 + 더 띄우기. */
const WARP_TILES = 1.8;
/* 0.75 → 1.35(요청: "프로토스 소환구 높이가 너무 낮아 땅에서 더 높게 띄워줘") —
   소환구는 아직 땅에 안 앉은 빛덩이라, 발자국에 가까이 붙으면 '지어진 건물'로 읽힌다.
   바닥 그림자와의 틈이 곧 높이라서 이 값이 그대로 높이감이 된다. */
const WARP_LIFT = 1.35;
/** 공사 모델(소환구·고치·공사장)을 발자국 한가운데보다 이만큼 아래(앞)에 앉힌다(요청). */
const CONSTRUCT_DROP = 0.55;
/* 그림자 색은 검정으로 되돌렸다(지적: "그림자의 개인색 적용 롤백") — 임자 색을 0.34로
   눌러 칠하던 shadowTint와 그 캐시를 통째로 걷었다. 부르는 데가 없어진 함수를 남겨 두면
   noUnusedLocals가 막는 죽은 코드라 정의째 지운다. 짙기(건물 0.5 · 부양 0.5/0.34 ·
   지상 0.32)는 색과 무관한 다른 지적("그림자가 너무 흐려 안 보인다")으로 올려 둔 값이라
   롤백 대상이 아니다 — 색만 되돌린다. */
/** 건물 모델의 발·가로중심 자리 [cx몫, bot몫] — 구운 판 크기에 대한 비로 잰다.
 *  종류마다 한 번만 재는 것이 핵심이다(지적: 같은 넥서스인데 하나만 살짝 오른쪽으로
 *  나온다): 판은 요잉 6도 칸마다 따로 굽는데, 잉크 테두리 상자의 가로중심은 칸마다
 *  조금씩 달라 같은 건물이 자리마다 다르게 밀렸다. 채움 몫(BLD_FILL_CACHE)과 같은
 *  결로 한 번 재서 모두에게 같은 보정을 준다. */
const BLD_ANCHOR_CACHE = new Map<string, [number, number]>();
/* 발자국 대비 그릴 몫 — 기본은 0.95(발자국을 꽉 채운다). 본진 셋만 예외로 넘겨 그린다
   (요청: "넥서스 해처리 커맨드는 예외로 더 크게, 실제 게임처럼") — 원작에서도 이 셋의
   그림은 4×3 발자국을 넘어 앉는다. 레어·하이브는 해처리의 다음 단계라 같은 몫이다. */
export const BLD_FILL_TARGET: Record<string, number> = {
  /* 커맨드는 1.2로 되돌린다(요청: "1.2로 내리고 모델링쪽 봐봐") — 채움을 1.4·1.6으로
     올려도 "안 커보여"가 그대로였다. 실측을 보면 이유가 있다: 커맨드의 잉크는 이미
     도록에서 가장 넓은데(적용 후 폭 25.4로 넥서스 22.2·배럭 14.2보다 크다) **높이/폭이
     0.75로 유독 납작하다**(배럭 1.10 · 아머리 1.25 · 해처리 0.96). 넓적한 것은 아무리
     넓혀도 '큰 건물'이 아니라 '넓은 접시'로 읽힌다 — 손잡이가 아니라 모델의 몫이라
     아래 tomb 모델의 돔 키를 올렸다. */
  tomb: 1.2, pyramidWide: 1.2, hatchery: 1.2, lair: 1.2, hive: 1.2,
  /* 스타포트·게이트웨이가 제 발자국보다 좁아 보인다(지적: "일부 건물들이 실제 캔버스보다
     작게(좁게) 그려지는 느낌 … 게이트웨이 스타포트 등" · "스타포트는 안테나를 크기계산
     에서 살짝 빼줘야하고") — 진단이 맞다. 정규화가 재는 것은 **잉크 폭 전체**라, 몸통
     밖으로 가늘게 뻗은 것(스타포트의 안테나 팔, 게이트웨이 아치의 바깥 다리)이 폭을
     대신 채우면 정작 몸통은 발자국의 절반 언저리에 머문다. 부품을 골라 빼는 자를 새로
     만드는 대신, 이 표가 원래 그 손잡이다(풀 1.3·파일런 1.425와 같은 자리): 목표를
     올려 몸통이 발자국을 채우게 하고 가는 팔은 조금 넘치게 둔다. */
  plane: 1.12,
  /* 프로토스 쪽이 한 무리로 작게 보인다(지적: "아카이브 트리뷰널 비콘 스타게이트
     게이트웨이 어시밀 작게 모델링된듯") — 여섯 다 몸이 가늘거나 속이 빈 형태라(아치·
     기둥·고리), 잉크 폭을 발자국의 95%에 맞춰도 눈에 잡히는 덩어리는 그 절반이다.
     같은 무리를 같은 몫으로 올린다 — 스타게이트(arch)만 상자 상한이 낮아 덜 오른다. */
  gate: 1.25, archives: 1.15, tribunal: 1.15, fleetbeacon: 1.15, arch: 1.15, assim: 1.15,
  /* 스포닝 풀이 너무 작게 나온다(지적) — 이 모델은 바닥 크립 얼룩(반지름 6.8)이
     16-상자를 거의 가득 채워, 채움 보정이 '이미 큰 건물'로 재고 몸을 도로 줄였다.
     실제로 보이는 웅덩이·두렁은 상자의 절반쯤뿐이다. 목표 채움을 올려 몸을 키운다. */
  pool: 1.3,
  /* 요청: "파일런 수정. 크기 1.5배로 키우고" — 화면에 찍히는 덩치는 모델 좌표가 아니라
     이 표가 정한다(구운 판의 잉크 폭을 재서 발자국의 몇 할이 되게 다시 굽는다). 그래서
     파일런은 모델을 건드리는 대신 기본값 0.95의 1.5배인 1.425를 못 박아, 다른 건물보다
     반쯤 더 크게 선다. */
  diamond: 1.425,
};
/** 건물 모델 공간 정규화 배수 — 발 가운데(8,16)를 축으로 곱한다. **화면 크기가 아니다.**
 *
 *  이 표는 **`npm run bld-norm -- --emit`이 낸 값이다. 손으로 고치지 마라.**
 *  건물 모델 면을 한 줄이라도 고쳤으면 그 명령을 다시 돌려 갈아라.
 *
 *  왜 필요했나(요청: "건물들 크기가 제각각이 되지않도록 모델링은 정규화해놓고 그걸
 *  캔버스에 맞게 사용해야할거 같거든? 건물 모델링 정규화는 아까 안했지?") — 안 했다.
 *  유닛 정규화는 SHAPE_GALLERY의 group === "유닛"만 돌았고, 건물은 배수 1로 떨어졌다.
 *  실측하니 55종의 잉크 폭이 6.79 ~ 18.15로 **2.67배** 벌어져 있었고, 같은 발자국끼리도
 *  갈렸다(4×3: 사이언스 퍼실리티 11.07 대 팩토리 14.30).
 *
 *  화면에서 안 그렇게 보이던 것은 렌더러가 런타임에 가리고 있었기 때문이다 — 구운 판의
 *  잉크 폭을 재서 발자국의 95%가 되게 다시 굽던 BLD_FILL_CACHE다. 유닛에서 걷어낸 바로
 *  그 방식이고 같은 값을 치렀다: 모델을 고치면 화면 크기가 따라 흔들리고, 보정을 kind마다
 *  한 번만 재 캐시하며, 16-상자를 넘는 종류는 **잘린 잉크**를 재느라 오차가 겹쳤다.
 *  이제 그 일을 모델 좌표로 옮겼고 런타임 보정은 지웠다.
 *
 *  자: 건물은 발자국 상자에 fitWidth로 맞추므로(UnitLayer의 `sidePx = op.fitWidth ? wPx`)
 *  덩치를 정하는 것은 **잉크 '폭'** 하나다(유닛은 √(폭×높이)였다). 목표는
 *  BLD_FILL_TARGET(기본 0.95) × 16이고, 상한은 굽는 캔버스(16 + 여백 5.6×2)를
 *  안 넘는 선이다. 상한이 1보다 작은 종류는 이미 넘치고 있다는 뜻이라 "더 키우지만
 *  않는다"로 그친다 — 상한을 이유로 줄이면 멀쩡히 보이던 건물이 갑자기 작아진다.
 *  표에 없는 종류는 1(모델 그대로)이다. */
export const BLD_NORM: Record<string, number> = {
  academy: 1.408,
  arch: 1.883,
  archives: 2.275,  // 상자 상한에 걸림
  armory: 1.452,
  assim: 2.069,
  cavern: 1.082,
  citadel: 1.749,
  cocoon: 2.856,
  coil: 1.058,
  comsat: 1.968,
  covert: 2.065,
  creep: 1.219,
  ctower: 2.238,
  cube: 1.112,
  cyber: 1.972,
  diamond: 1.876,  // 상자 상한에 걸림
  dmound: 1.115,
  dome: 1.418,
  ebay: 0.982,
  evo: 1.214,
  extract: 1.023,
  factory: 1.117,
  fleetbeacon: 2.071,
  forge: 1.398,
  gate: 1.979,
  geyser: 1.513,
  gspire: 1.048,  // 상자 상한에 걸림
  hatchery: 1.367,
  hive: 1.165,
  hydraden: 1.036,
  lair: 1.223,
  mineral: 1.963,
  mshop: 1.958,
  nsilo: 1.950,
  nydus: 1.184,
  observatory: 1.959,
  physlab: 2.008,
  plane: 1.209,
  pool: 1.525,
  pyramidWide: 1.058,
  queensnest: 1.184,
  refinery: 1.266,
  robobay: 1.423,
  sbattery: 2.032,
  scaffold: 1.733,
  scifac: 1.373,
  spire: 1.409,  // 상자 상한에 걸림
  spore: 1.422,
  sunken: 1.072,
  tomb: 1.534,
  tombFlat: 1.140,
  trapezoid: 1.514,
  tribunal: 1.954,
  turret: 1.770,
  warpin: 2.483,
};
const BLD_SPRITE_CACHE = new Map<string, { cv: HTMLCanvasElement; pad: number; l: number; side: number; bot: number; top: number; w: number; cx: number }>();
const bldSpriteBytes = { n: 0 };
/** 경로의 세로 범위 [위, 아래] — 공사에서 부품을 높이 순으로 세우는 데 쓴다.
 *  우리 도형 문법은 M·L·Q·C·A(a)·Z뿐이다. 호는 끝점 ± ry로 어림한다(순서를 정하는
 *  데는 충분하다). 상대 좌표는 호(`a`)에서만 쓰이고 그 앞은 늘 절대 M이다. */
function pathYRange(d: string): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  let cx = 0;
  let cy = 0;
  const re = /([MmLlQqCcSsTtAaHhVvZz])([^A-Za-z]*)/g;
  let m: RegExpExecArray | null = re.exec(d);
  while (m) {
    const up = m[1].toUpperCase();
    const rel = m[1] !== up;
    const nums = (m[2].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    const put = (x: number, y: number): void => {
      cx = x;
      cy = y;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    };
    if (up === "H") { for (const n of nums) put(rel ? cx + n : n, cy); }
    else if (up === "V") { for (const n of nums) put(cx, rel ? cy + n : n); }
    else if (up === "A") {
      for (let i = 0; i + 6 < nums.length; i += 7) {
        const ry = Math.abs(nums[i + 1]);
        const x = rel ? cx + nums[i + 5] : nums[i + 5];
        const y = rel ? cy + nums[i + 6] : nums[i + 6];
        if (y - ry < lo) lo = y - ry;
        if (y + ry > hi) hi = y + ry;
        put(x, y);
      }
    } else if (up !== "Z") {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const x = rel ? cx + nums[i] : nums[i];
        const y = rel ? cy + nums[i + 1] : nums[i + 1];
        if (y < lo) lo = y;
        if (y > hi) hi = y;
        if (i + 3 >= nums.length) put(x, y);
      }
    }
    m = re.exec(d);
  }
  return [lo, hi];
}

/** 그 패스가 차지하는 상자 [x0,y0,x1,y1](뷰박스 칸) — 부품 크기·자리 재기용. */
// 계측 스크립트도 같은 자를 쓴다(scripts/… 실측용) — 내보낸다.
export function pathBox(d: string): [number, number, number, number] {
  const nums: number[] = [];
  const re = /([MmLlQqCcSsTtAaHhVvZz])([^A-Za-z]*)/g;
  let m: RegExpExecArray | null = re.exec(d);
  let cx = 0;
  let cy = 0;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const put = (x: number, y: number): void => {
    cx = x; cy = y;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  };
  while (m) {
    const up = m[1].toUpperCase();
    const rel = m[1] !== up;
    nums.length = 0;
    for (const t of m[2].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []) nums.push(Number(t));
    if (up === "H") { for (const n of nums) put(rel ? cx + n : n, cy); }
    else if (up === "V") { for (const n of nums) put(cx, rel ? cy + n : n); }
    else if (up === "A") {
      // 호는 반지름만큼 사방으로 부푼다 — 끝점만 보면 타원 고리를 통째로 놓친다.
      for (let i = 0; i + 6 < nums.length; i += 7) {
        const rx = Math.abs(nums[i]);
        const ry = Math.abs(nums[i + 1]);
        const x = rel ? cx + nums[i + 5] : nums[i + 5];
        const y = rel ? cy + nums[i + 6] : nums[i + 6];
        put(x - rx, y - ry);
        put(x + rx, y + ry);
        put(x, y);
      }
    } else if (up !== "Z") {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        put(rel ? cx + nums[i] : nums[i], rel ? cy + nums[i + 1] : nums[i + 1]);
      }
    }
    m = re.exec(d);
  }
  if (!Number.isFinite(x0) || !Number.isFinite(y0)) return [0, 0, 0, 0];
  return [x0, y0, x1, y1];
}

/* 부품 크기로 등급 매기기(지적: "건물 LOD 잘 안먹히는거 같기두하고") — 면 헬퍼가
   다는 등급은 명암·단면까지다. 부품 **몸통**은 전부 형체(1)라, 사양을 내려도 잔기둥·
   뿔·배관이 그대로 남아 실루엣이 거의 안 준다. 그런데 요청의 티어 정의가 곧 크기다:
   형체를 정하는 큰 덩이가 1, 그 위에 얹힌 것이 2, 자잘한 것이 3.
   그래서 부품(깊이 열쇠로 묶인 면 무리)의 상자 넓이를 모델 전체 상자와 견줘 자동으로
   매긴다 — 106개 모델을 손으로 안 건드려도 전부 걸리고, 모델러가 명시로 매긴 등급은
   그대로 존중한다(내려가기만 하고 올라가지 않는다). */
/** 부품 크기(그 부품 상자 넓이 ÷ 가장 큰 부품 상자 넓이)로 등급을 매기는 문턱.
 *  이 아래면 세부(3), 그 위 TIER_TRIM 아래면 장식(2), 그 위는 형체(1).
 *  ⚠ 길이(긴 변)로 재 보았다가 되돌렸다 — 각도에 따라 부품이 나타났다 사라지는 것이
 *    "옆에서 보면 넓이가 무너져서"일 것이라 짚었는데, 실측으로 흔들림이 그대로였고
 *    (유닛 88건 중 67건, 최대 57%p) 실루엣만 나빠졌다(깨짐 2건 → 16건). 진짜 원인은
 *    따로 있다 — 부품 묶기 자체가 각도마다 달라진다(autoTier 위 주석 참고). */
const TIER_FINE = 0.12;
const TIER_TRIM = 0.3;
/** 명암 잔조각의 문턱(요청: 명시 2티어가 너무 많다 — 디테일을 조금 줄이자).
 *  제 부품 상자의 이 몫보다 작은 **명암 면**(제 색을 지닌 면 = topFace·sideFace가
 *  얹는 흰·검 판)은 포인트가 아니라 장식으로 본다. 실측으로 건물 면의 48%가 명시
 *  2티어인데, 그 대부분이 한 부품에 여럿씩 붙은 명암 조각이다 — 큰 판 하나면 그 부품의
 *  형태는 이미 읽히고, 나머지 잔조각은 고에서만 얹으면 된다.
 *  ⚠ 임자 색이 칠해질 면(fill 없음)은 여기서 건드리지 않는다 — 그것이 '누구 것인가'를
 *    말하는 면이라, lodFilter도 따로 지켜 준다. */
const SHADE_MINOR = 0.35;
const AUTO_TIER_CACHE = new Map<string, ShapeFace[]>();
/** 종류별 부품 등급표 — 부품 번호 → 등급. 0은 '형체 확정'(실루엣을 책임지는 부품). */
const TIER_TABLE = new Map<string, Map<number, number>>();
/** 그 종류의 등급표를 만든다 — **기준 각도에서 한 번만** 재고 모든 각도가 이 표를 쓴다.
 *
 *  ★ 왜 한 번인가(수리: "각도에 따라 팔·다리 같은 게 안 보일 때가 많다. 고에서는 다
 *    보이는데 저·중에서만 이상했다") — 여태는 굽는 각도마다 **투영된** 도형을 다시 재서
 *    등급을 매겼다. 팔·다리를 옆에서 보면 상자가 무너져 그 각도에서만 3티어로 떨어지고,
 *    몸을 돌리면 도로 살아난다. 실측으로 유닛 88건 중 66건이 각도에 따라 남는 부품
 *    비율이 흔들렸다(평균 21.7%p, 최대 54%p — 셔틀 중이 13%~67%).
 *    부품 번호(ShapeFace 여섯째)가 각도와 무관한 신원을 주므로, 등급은 그 번호에
 *    한 번만 매겨 두면 된다. 각도는 이제 등급에 영향을 못 준다.
 *  ★ 덤으로 가볍다 — 굽는 판마다 돌던 셈이 종류마다 한 번으로 준다(실측: 면 하나당
 *    2.5µs · 판 하나당 0.79ms였다. 요잉 16방 × 시점 버킷만큼 곱해지던 값이다). */
function tierTableOf(kind: string): Map<number, number> {
  const hit = TIER_TABLE.get(kind);
  if (hit) return hit;
  const table = new Map<number, number>();
  TIER_TABLE.set(kind, table);
  const builder = Object.prototype.hasOwnProperty.call(SHAPE_BUILDERS, kind)
    ? SHAPE_BUILDERS[kind] : undefined;
  if (!builder) return table;
  /* 한 각도만 보면 안 된다(수리: 기준 각도로만 표를 만들었더니 다른 각도에서 실루엣이
     깨졌다 — 198건 중 44건, 최대 −59%). 옆에서 가려지는 부품이 정면에서는 윤곽을
     만들기 때문이다. 여덟 방을 다 보고 **어느 한 각도에서라도 크면 크다**로 정한다.
     비용은 종류마다 여덟 판이고 한 번뿐이다(그 뒤로는 표만 읽는다). */
  const YAWS = [0, 45, 90, 135, 180, 225, 270, 315];
  const areaOf = (b: [number, number, number, number]): number =>
    (b[2] - b[0]) * (b[3] - b[1]);
  /** 각도별 부품 상자 — [요잉 차례][부품 번호]. */
  const perYaw: Map<number, [number, number, number, number]>[] = [];
  const explicitOf = new Map<number, number>();
  const bestRatio = new Map<number, number>();
  /* 지배색·개인색 장부(요청: "LOD 티어0에 현재 부품들에 더해서 지배색(그 모델에서 가장
     넓게 사용된 색), 개인색 부품은 모두 포함시켜줘") — 색깔별 넓이를 모으고, 개인색
     (fill 없음 = 임자 색이 칠해질 면)을 가진 부품에 표를 세운다. 명암 판(#fff·#000)은
     제 색이 아니라 얹은 그림자·광택이라 지배색 셈에서 뺀다. */
  const colorArea = new Map<string, number>();
  const partColors = new Map<number, Set<string>>();
  const ownColorParts = new Set<number>();
  for (const y of YAWS) {
    const faces = bake(() => withYaw(y, builder));
    const boxes = new Map<number, [number, number, number, number]>();
    for (const f of faces) {
      const pid = f[5];
      if (pid === undefined) continue;
      const cur = f[4] ?? 1;
      const prev = explicitOf.get(pid);
      // 부품의 명시 등급은 그 부품에서 가장 낮은(=가장 중요한) 값으로 본다.
      if (prev === undefined || cur < prev) explicitOf.set(pid, cur);
      const b = pathBox(f[0]);
      if (f[2] === undefined) ownColorParts.add(pid);
      else if (f[2] !== "#fff" && f[2] !== "#000") {
        colorArea.set(f[2], (colorArea.get(f[2]) ?? 0) + (b[2] - b[0]) * (b[3] - b[1]));
        const set = partColors.get(pid);
        if (set) set.add(f[2]);
        else partColors.set(pid, new Set([f[2]]));
      }
      const bb = boxes.get(pid);
      if (!bb) { boxes.set(pid, [b[0], b[1], b[2], b[3]]); continue; }
      if (b[0] < bb[0]) bb[0] = b[0];
      if (b[1] < bb[1]) bb[1] = b[1];
      if (b[2] > bb[2]) bb[2] = b[2];
      if (b[3] > bb[3]) bb[3] = b[3];
    }
    let big = 0.0001;
    for (const b of boxes.values()) big = Math.max(big, areaOf(b));
    for (const [pid, b] of boxes) {
      const r = areaOf(b) / big;
      if (r > (bestRatio.get(pid) ?? 0)) bestRatio.set(pid, r);
    }
    perYaw.push(boxes);
  }
  /* 크기로 매긴 1차 등급 — 명시 등급보다 내려가지는 않는다(모델러가 장식이라 한 것을
     형체로 올리지 않는다). 여기서 쓰는 크기는 여덟 방 중 가장 크게 잡힌 값이라, 옆에서
     납작해지는 팔·다리가 그 각도에서만 사라지는 일이 없다. */
  for (const [pid, r] of bestRatio) {
    const cur = explicitOf.get(pid) ?? 1;
    if (cur === 0) { table.set(pid, 0); continue; }
    const auto = r < TIER_FINE ? LOD_FINE : r < TIER_TRIM ? LOD_TRIM : 1;
    table.set(pid, Math.max(cur, auto));
  }
  /* 형체(1티어 이하)는 실루엣을 책임진다 — 각도마다 1티어 부품들의 상자를 재고, 그
     밖으로(축마다 여유 2%) 뻗는 부품은 '형체 확정'(0)으로 끌어올린다. 각도마다 따로
     보고 합집합을 취하는 것이 핵심이다: 어느 한 각도에서 윤곽을 만들면 그 부품은
     모든 각도에서 형체다(등급이 각도마다 달라지면 그것이 곧 깜빡임이다).
     그리기 헬퍼(topFace·sideFace)의 기본 등급이 장식(2)인데 모델러가 그것으로 몸을
     그린 모델이 많아, 명시 등급을 존중하기만 해서는 벌처(가로 −59%)·사이언스
     베슬(세로 −52%)처럼 몸이 날아간다. */
  for (const boxes of perYaw) {
    const lo: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [pid, b] of boxes) {
      if ((table.get(pid) ?? 1) > 1) continue;
      if (b[0] < lo[0]) lo[0] = b[0];
      if (b[1] < lo[1]) lo[1] = b[1];
      if (b[2] > lo[2]) lo[2] = b[2];
      if (b[3] > lo[3]) lo[3] = b[3];
    }
    if (!Number.isFinite(lo[0])) continue;
    const epsX = Math.max(lo[2] - lo[0], 0.001) * 0.02;
    const epsY = Math.max(lo[3] - lo[1], 0.001) * 0.02;
    for (const [pid, b] of boxes) {
      if (lo[0] - b[0] > epsX || b[2] - lo[2] > epsX
        || lo[1] - b[1] > epsY || b[3] - lo[3] > epsY) table.set(pid, 0);
    }
  }
  /* 지배색·개인색은 형체 확정(0)이다(요청) — 작게 그릴수록 '무엇인가'는 실루엣과
     그 모델의 바탕색이, '누구 것인가'는 개인색이 말한다. 여기 걸리는 부품이 많아
     사양을 내려도 면이 크게 안 줄어드는 것은 트레이드오프로 받는다(요청) — 대신
     낮은 사양에서 그림자 같은 화면 효과를 끈다(qShadows). */
  let domColor = "";
  let domArea = 0;
  for (const [c, a] of colorArea) if (a > domArea) { domArea = a; domColor = c; }
  for (const [pid, cols] of partColors) {
    if (domColor && cols.has(domColor)) table.set(pid, 0);
  }
  for (const pid of ownColorParts) table.set(pid, 0);
  return table;
}
/** 등급 입히기 — 표가 정한 부품 등급을 그 각도의 면들에 얹는다.
 *  번호 없는 면(빌더가 tagKey·tagDepth를 안 거친 15%)은 제 명시 등급 그대로 둔다:
 *  각도마다 다르게 판정하면 그 면들이 다시 깜빡이게 된다.
 *  명암 잔조각 줄이기(요청)는 그 각도의 실제 크기로 본다 — 명암은 그림자·광택이라
 *  드나들어도 형태가 흔들리지 않고, 형체 확정(0) 부품에는 손대지 않는다. */
export function autoTier(kind: string, key: string, faces: ShapeFace[]): ShapeFace[] {
  const hit = AUTO_TIER_CACHE.get(key);
  if (hit) return hit;
  const table = tierTableOf(kind);
  const partSpan = new Map<number, number>();
  /* 명암**만**으로 이루어진 부품은 잔조각 줄이기에서 통째로 뺀다(수리: 어느 각도에서
     몸이 사라졌다) — 명암 면을 내리면 그 부품에 남는 것이 없어 부품 자체가 없어진다.
     줄여도 되는 것은 '몸 위에 얹힌 명암'이지 '명암으로 그린 몸'이 아니다. 실측으로 이
     한 줄이 실루엣 깨짐 350건 → 214건, 각도 흔들림 8.9%p → 3.4%p를 만든다(값은 감축률
     로 치른다: 저 59%→80%). */
  const hasBody = new Set<number>();
  for (const f of faces) {
    const pid = f[5];
    if (pid === undefined) continue;
    if (f[2] === undefined) hasBody.add(pid);
    const b = pathBox(f[0]);
    const a = (b[2] - b[0]) * (b[3] - b[1]);
    partSpan.set(pid, Math.max(partSpan.get(pid) ?? 0, a));
  }
  const out = faces.map((f) => {
    const pid = f[5];
    if (pid === undefined) return f;
    const cur = f[4] ?? 1;
    let t = table.get(pid) ?? cur;
    if (t > 0 && f[2] !== undefined && hasBody.has(pid)) {
      const b = pathBox(f[0]);
      const pa = partSpan.get(pid) ?? 0;
      const fa = (b[2] - b[0]) * (b[3] - b[1]);
      if (pa > 0 && fa / pa < SHADE_MINOR) t = Math.max(t, LOD_FINE);
    }
    return (t === cur ? f : [f[0], f[1], f[2], f[3], t, pid]) as ShapeFace;
  });
  AUTO_TIER_CACHE.set(key, out);
  return out;
}

/** 공사 단계 — 모델을 **부품 단위로** 아래에서부터 드러낸다.
 *
 *  여태는 구운 판을 화면 사각형으로 잘라 보여 줬다(지적: "그냥 구운 이미지를 잘라서
 *  보여줬어. 그게 아니라 실제 부품을 아래에서부터 몇개씩 보여주자는 얘기였어").
 *  그러면 기둥이 반 토막 난 채 서고 지붕이 가로로 잘려 '짓는 중'이 아니라 '가려진'
 *  것으로 보인다.
 *
 *  부품 경계는 이미 자료에 있다 — 빌더가 부품마다 tagKey로 깊이 키를 매기고, 키를
 *  안 단 면은 바로 앞 면의 키를 물려받는다(zsorted 규약). 그 묶음이 곧 부품이다.
 *  묶음마다 꼭대기(경로 최소 y — 이 좌표계는 y가 아래로 커진다)를 재고, 꼭대기가
 *  낮은 것부터 세운다: 발판·다리·바닥 슬래브가 먼저 서고 지붕·굴뚝·안테나가 마지막에
 *  얹힌다. 고른 부품은 **통째로** 그리므로 잘린 단면이 안 생긴다.
 *  그리는 차례는 원래 순서 그대로 둔다(칠하는 순서가 곧 앞뒤라 재정렬하면 안 된다). */
/** 공사 단계 수(요청: 3단계 부족하면 5단계로) — 부품이 많은 건물일수록 3칸으로는 한
 *  칸에 3분의 1이 통째로 솟아 '자라는' 대신 '툭 나타나는' 것으로 보인다. */
export const BUILD_STAGES = 5;
export function stageFaces(faces: ShapeFace[], stg: number): ShapeFace[] {
  if (stg <= 0 || stg >= BUILD_STAGES) return faces;
  const gid: number[] = [];
  const tops: number[] = [];
  let g = -1;
  let lastKey: number | undefined;
  for (const f of faces) {
    const k = f[3];
    if (g < 0 || (k !== undefined && k !== lastKey)) { g += 1; tops.push(Infinity); }
    if (k !== undefined) lastKey = k;
    gid.push(g);
    const lo = pathYRange(f[0])[0];
    if (lo < tops[g]) tops[g] = lo;
  }
  const n = tops.length;
  if (n <= 1) return faces;
  const order = tops.map((_, i) => i).sort((a, b) => tops[b] - tops[a]);
  const keep = new Set(order.slice(0, Math.max(1, Math.round((n * stg) / BUILD_STAGES))));
  return faces.filter((_, i) => keep.has(gid[i]));
}

function buildingSprite(
  op: UnitDrawOp, sideQ: number, B: number,
): { cv: HTMLCanvasElement; pad: number; l: number; side: number; bot: number; top: number; w: number; cx: number } | null {
  const vq = op.viewYaw ? Math.max(-36, Math.min(36, Math.round(op.viewYaw / 6) * 6)) : 0;
  const lod = lodOf(sideQ);
  /* 공사 단계(요청: "3단계로 하고 실제 모델의 부품을 일부만 표현하다가 완성되는 형태로
     수정. 아래쪽 부품부터 표현 → 점점 위로") — stageFaces가 **부품을 골라** 준다.
     예전에는 굽는 좌표계의 아래쪽만 오려 냈는데, 그건 결과가 같지 않았다(지적):
     기둥이 반 토막 나고 지붕이 가로로 잘려 '짓는 중'이 아니라 '가려진' 것으로 보였다.
     단계가 캐시 열쇠에 들어가므로 판은 단계별로 따로 구워져 프레임 비용이 없다. */
  const stg = op.buildStage ?? 0;
  const key = `${op.kind}|${op.rotDeg ?? 0}|${op.flat ? 1 : 0}|${vq}|${op.pitch ? 1 : 0}|${op.color}|${sideQ}|${B.toFixed(2)}|${lod}|${stg}`;
  const hit = BLD_SPRITE_CACHE.get(key);
  if (hit) { BLD_SPRITE_CACHE.delete(key); BLD_SPRITE_CACHE.set(key, hit); return hit; }
  const { faces: all } = resolveShapeFaces(op.kind, op.rotDeg, op.flat, op.viewYaw, op.pitch);
  if (!all) return null;
  const faces = stageFaces(
    lodFilter(autoTier(op.kind, `b|${op.kind}|${op.rotDeg ?? 0}|${op.flat ? 1 : 0}|${vq}|${op.pitch ? 1 : 0}`, all), lod), stg);
  /* 여백을 15% → 35%로 넓혔다(과제 #67) — 이 여백이 곧 모델이 쓸 수 있는 자리다.
     15%면 모델 단위로 양옆 2.4뿐이라, 정규화 배수를 재 보니 55종 중 30종이 목표에
     못 가고 여기서 잘렸다(그리고 지금도 7종은 이미 넘쳐 잘리고 있다: 하이브·레어·
     피라미드·스타포트·익스트랙터·히드라덴·그레이터 스파이어).
     35%면 양옆 5.6이라 캡이 거의 안 걸린다. 값은 캔버스 넓이로 치른다(1.3² → 1.7²,
     1.7배) — 건물 판은 종류·요잉당 한 번만 굽고 캐시하므로 감당할 만하다.
     자리 계산은 전부 이 pad와 l에서 파생되므로(bAnc는 l에 대한 비) 함께 따라온다. */
  /* 0.35 → 0.62(요청: "스파이어는 충분히 높이 올라갈수있게 높이 제한 없애야한다") —
     이 여백이 곧 모델이 쓸 수 있는 자리이고, 정규화 배수의 상한도 여기서 나온다.
     35%(모델 단위 양옆 5.6)에서는 위로 긴 모델이 상한에 먼저 걸려 목표 폭까지 못 컸다:
     스파이어 1.45가 필요한데 1.27에서 잘렸고(적용 후 폭이 목표의 85%), 그레이터
     스파이어·하이브·레어도 같은 자리에서 잘렸다. 62%(양옆 9.9)면 그 아홉이 다 풀린다.
     값은 캔버스 넓이로 치른다(1.7² → 2.24², 1.7배) — 건물 판은 종류·요잉당 한 번만
     굽고 LRU 예산 안에서 캐시되므로 프레임 비용은 0이다. */
  const pad = Math.ceil(sideQ * 0.62) + 2;
  const l = sideQ + pad * 2;
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.ceil(l * B));
  cv.height = cv.width;
  // 너무 큰 판은 굽지 않는다(위 SPRITE_SIDE_MAX) — 직접 그리기로 떨어진다.
  if (cv.width > SPRITE_SIDE_MAX) return null;
  const c2 = cv.getContext("2d");
  if (!c2) return null;
  c2.setTransform(B, 0, 0, B, 0, 0);
  c2.translate(pad + sideQ / 2, pad + sideQ);
  c2.scale(sideQ / 16, sideQ / 16);
  c2.translate(-8, -16);
  /* 정규화(과제 #67) — 발 가운데(8,16)를 축으로 모델을 키우거나 줄인다. 축이 발이라
     밑동이 발자국 바닥에 그대로 앉고, 모델이 커져도 자리가 안 흔들린다. */
  const bn = bldNormOf(op.kind);
  if (bn !== undefined && bn !== 1) {
    c2.translate(8, 16);
    c2.scale(bn, bn);
    c2.translate(-8, -16);
  }
  for (const [d, o, fill] of faces) {
    c2.globalAlpha = shadeBoost(o, fill);
    c2.fillStyle = fill ?? op.color;
    c2.fill(pathOf(d));
  }
  if (lod >= 3) silhouetteLight(c2, cv);
  const box9 = contentBox(cv);
  const entry = {
    cv, pad, l, side: sideQ, bot: box9.bot, top: box9.top, w: box9.w, cx: box9.cx,
  };
  BLD_SPRITE_CACHE.set(key, entry);
  bldSpriteBytes.n += canvasBytes(cv);
  trimSpriteCache(BLD_SPRITE_CACHE, bldSpriteBytes, BLD_SPRITE_BYTES_MAX);
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
    const sorted = [...ops].sort((a, b) => (a.z + (a.air ? Z_AIR : 0)) - (b.z + (b.air ? Z_AIR : 0))).filter(inView0);
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
        /* 진형 간격은 **그리기 크기와 무관**해야 한다(지적: 크기표가 진형 간격까지
           바꾼다) — sizePx에는 크기표·모델 크기 라디오·시네마틱 대비가 다 실려 있어,
           '크게' 한 번에 유닛들이 4.8배로 벌어졌다. 차지하는 공간은 원작 몸 지름
           (UNIT_BODY_TILES, 순수 충돌 상자)이 정한다 — 라디오를 돌려도 진형은 그대로다.
           **지금 이 고리에 실제로 드는 유닛 op은 스파이더 마인 하나뿐이다** — v2 유닛
           op·공사 SCV·채굴 일꾼은 전부 noSep이라 이완에서 빠지고, 포탑 op은 `...last`로
           그것을 물려받는다. 그래서 마인 op에 sepPx를 실어(아래 마인 자리) 이 주장이
           코드로 성립하게 했다. 폴백(sizePx*0.64)은 sepPx 없는 낯선 op이 생겼을 때만
           쓰이는 종전 어림이고, 지금은 아무도 안 탄다. */
        const pr = mov.map((i) => Math.max(2, (sorted[i].sepPx ?? sorted[i].sizePx * 0.64) * zoom * 0.5));
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
        const bspr = buildingSprite(op, sideQ, B);
        /* 런타임 채움 보정은 없앴다(과제 #67) — 구운 판의 잉크 폭을 재서 발자국의
           95%가 되게 다시 굽던 자리다. 그 일을 이제 BLD_NORM이 모델 좌표에서 한다.
           보정이 있으면 모델을 고칠 때마다 화면 크기가 조용히 흔들리고, 16-상자를
           넘는 종류는 잘린 잉크를 재느라 오차가 겹쳤다. 판도 한 번만 굽는다. */
        // 발·가로중심 보정은 종류마다 한 번만(요잉 칸마다 달라지면 자리가 흔들린다).
        let bAnc = BLD_ANCHOR_CACHE.get(op.kind);
        if (bAnc === undefined && bspr && bspr.w > 0) {
          bAnc = [(bspr.cx / B) / bspr.l, (bspr.bot / B) / bspr.l];
          BLD_ANCHOR_CACHE.set(op.kind, bAnc);
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
             실제로 그려지는 잉크 폭의 0.88배로 잡는다.
             입체에서는 임의 축소를 걷고 바닥면 그대로 눕힌다(지적: 3D 그림자는 바닥
             팔레트에 맞아야 한다) — 세로 한 타일이 화면에서 가로 한 타일의 몇 배로
             보이는지(groundSquash)를 자리마다 실제로 재어 넘겨받는다. 그 값이 곧
             바닥면의 눌림이라, 그림자가 지면 격자와 같은 각도로 깔린다. */
          const squish = 0.55;
          const inkW9 = bspr && bspr.w > 0 ? (bspr.w / B) * (sidePx / sideQ) : wPx;
          /* 2D는 그린 몸에만 맞춘다(지적: 평면에선 건물이 높이까지 바닥 상자 안으로
             눌려 들어가, 발자국 폭(wPx) 바닥은 그린 몸보다 늘 크다) — 발자국 하한을
             걷고 잉크 폭의 0.72만 덮는다. 입체는 종전대로 발자국 하한을 지킨다. */
          const footW = op.pitch
            ? Math.max(wPx * 0.7, inkW9 * 0.88)
            : inkW9 * 0.72;
          const fdPx = footW * (op.footRatio ?? 0.6) * squish;
          ctx.save();
          ctx.shadowColor = "transparent";
          // 검정 그림자로 롤백(지적: "그림자의 개인색 적용 롤백") — 임자 색을 눌러 칠하던
          // 것을 걷고 예전 검정으로 돌아간다. 짙기는 별개 지적으로 올려 둔 값이라 유지:
          // 이제 뜬 건물만 그림자를 지므로 공중 유닛과 같은 0.5.
          ctx.globalAlpha = op.alpha * 0.5;
          ctx.fillStyle = "#000";
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
          const k = sidePx / sideQ;
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
      /* 화면 크기는 크기표가 정한다(요청: 모델 정규화 + 원작 치수 크기표) — 옛 '상자
         채움 보정'은 걷었다. 모델이 상자를 채우는 몫은 이제 굽는 쪽(MODEL_NORM)에서
         종류마다 같게 맞춰지고, 남은 몫(MODEL_INK)은 크기표가 미리 나눠 놓았다.
         여기서 잉크 폭을 되재서 되키울 까닭이 없다 — 판을 두 번 굽던 것도 사라진다. */
      const px = op.sizePx * zoom;
      /* 이 종류가 상자에서 잉크로 쓰는 몫(0~1) — 그림자·링·체력바·LOD가 상자가 아니라
         몸을 자로 삼게 하는 열쇠다. 판이 없을 때의 폴백에만 쓴다. */
      const inkK = modelInkOf(op.kind) / 16;
      /* 공중 유닛(요청: 높이 더 높이 + 바닥 그림자) — 발밑 자리에 그림자 타원을 깔고
         몸은 반 키만큼 위로 띄운다. 떠 있음이 땅 유닛과 한눈에 갈린다. */
      // 높이 반으로(재재지적) — 1.6 → 0.8.
      const lift = (op.air ? px * 0.8 : 0) + (op.rise ?? 0) * px;
      /* 판을 먼저 굽는다 — 그림자를 어림 오프셋이 아니라 판의 실제 바닥 픽셀
         (contentBottom)에 붙이기 위해서다(재재지적: 드론이 높이 떠 있다). */
      const pxq = Math.max(4, Math.round(px / 2) * 2);
      const spr = unitSprite(op, pxq, B);
      const kU = px / pxq;
      /* 몸의 실제 폭(화면 px) — contentBox가 이미 재 둔 값이라 공짜다(지적: 체력바가
         몸을 덮는다 / 그림자가 몸만큼 크다 / 링이 몸보다 크다). 정규화가 맞추는 것은
         잉크 **상자**이고 폭 몫은 가로세로비 때문에 종류마다 1.7배까지 남는다 —
         모델들의 세로/가로 비가 실제로 그만큼 다르기 때문이라 정규화로는 못 없앤다.
         그러니 장식이 상자(px)가 아니라 이 몸 폭(inkW)을 봐야 한다. 그러면 "바는 제
         유닛보다 넓지 않다" 같은 조건이 종류를 안 가리고 식만으로 보장된다. */
      const inkW = spr && spr.w > 0 ? (spr.w / B) * kU : px * inkK;
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
        /* 몸 폭 기준(지적: 그림자가 유닛 크기를 반영 못 한다 / 옵저버·스커지 그림자가
           몸의 세 배다) — 지름이 몸 폭의 0.97배(공중)·0.70배(부양)로 종류를 안 가린다.
           예전 상자 기준으로는 같은 식이 옵저버 1.99배 ~ 다크아콘 0.49배로 4배 벌어졌다. */
        const shw = inkW * (op.air ? 0.44 : 0.32);
        /* 하이템플러 부양 로브(지적: 그림자가 몸에서 떨어져 분신 같다) — 그림자를
           위로 당겨 몸에 겹친다. */
        const shUp = op.kind === "htemp" ? px * 0.16 : 0;
        // 짙기 상향(지적: 그림자가 너무 흐려 안 보인다) — 0.26/0.16 → 0.5/0.34.
        // 색은 검정으로 롤백(지적: "그림자의 개인색 적용 롤백") — 짙기는 위 지적대로 둔다.
        ctx.globalAlpha = op.alpha * (op.air ? 0.5 : 0.34);
        ctx.fillStyle = "#000";
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
        /* 바닥과 같은 평면에(지적: 그림자가 안 눕는다 → 재지적: "3D에서 그림자 눌림
           현상") — 0.38은 실제 바닥이 0.523으로 눌려 있던 시절에 거기서 한 번 더
           눌러 맞춘 손값이었다. 바닥을 PITCH_FLAT(0.74)으로 바로잡은 뒤에는 그림자만
           바닥의 절반 두께로 남아, 이번엔 반대로 짓눌려 보였다. 바닥 눌림 그대로
           쓴다 — 손값이 아니라 지면과 같은 수다. */
        ctx.ellipse(footX, footY - shw * 0.22 - shUp, shw * 1.1, shw * (op.air ? 0.5 : 0.42) * (op.pitch ? PITCH_FLAT : 1), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (showShadows !== false && !op.air && UNIT_KIND_SET.has(op.kind)) {
        /* 지상 유닛 접지 그림자(재지적: 전부 떠 있는 느낌 — 발이 그림자에 닿아야 하고
           훨씬 작아야) — 발끝 자리에 딱 붙는 아주 작은 타원. */
        ctx.save();
        ctx.shadowColor = "transparent";
        // 짙기 상향(지적) — 0.15 → 0.32. 색만 검정으로 롤백(지적: "그림자의 개인색 적용 롤백").
        ctx.globalAlpha = op.alpha * 0.32;
        ctx.fillStyle = "#000";
        ctx.beginPath();
        /* 그림자는 몸 폭(inkW)으로 잰다(지적: "그림자 크기가 유닛 크기 반영 못한 듯 —
           프로브 질럿 드라군이 다 비슷"). 예전엔 채움 보정이 잉크가 적은 모델만 1.55배
           까지 부풀려 보정 뒤 크기가 서로 가까워졌고, 그래서 보정 전 크기(px0)를 따로
           들고 있어야 했다. 보정이 없어진 지금 상자(px)는 종류마다 몸을 담는 여유가
           달라(잉크 몫 0.26~0.33) 다시 같은 흠이 난다 — 몸 폭이 유일하게 옳은 자다.
           지름은 몸 폭의 0.84배로 모든 종류에서 몸 안에 들어온다. */
        const shR = inkW * 0.42;
        ctx.ellipse(footX, footY - px * 0.09 - (op.kind === "htemp" ? px * 0.16 : 0), shR, shR * 0.58 * (op.pitch ? PITCH_FLAT : 1), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      /* 선택 링(지적: 드래그 선택 구분) — 잡힌 유닛 발밑의 가는 타원 테.
         색은 임자 색이다(요청: 흰색 말고 개인색) — 누가 잡은 유닛인지 링만 보고 안다.
         공중 유닛은 링도 공중이다(지적: 유닛 바닥에) — 들린 몸의 바닥선에 붙인다. */
      if (op.selRing) {
        ctx.save();
        ctx.shadowColor = "transparent";
        /* 선 굵기는 화면 고정(지적: 링은 UI 요소 — 확대에 굵어지면 안 됨) — 반지름은
           유닛(px)을 따라가되 굵기에서 zoom을 뺀다. */
        // 굵기 한 단 더 감소(요청: 마우스 마커·선택 링 모두 더 가늘게)
        // — 0.7~×0.025 → 0.45~×0.016 → 0.32~×0.011. 마우스 마커(0.28px)와 같은 결.
        // 굵기도 몸을 따른다 — 상자를 따르면 잉크가 적은 모델만 굵어진다(0.011 → 상자
        // 대신 몸이므로 잉크 몫 0.325로 나눈 0.034가 지금과 같은 굵기다).
        const ringW = Math.max(0.32, op.sizePx * inkK * 0.034);
        // 링도 내용물 발끝에(재지적) — 상자 고정 오프셋은 작은 모델에서 몸 아래로 떨어졌다.
        const ringY = op.air ? footY - lift : footY - px * 0.03;
        const ringPath = (): void => {
          ctx.beginPath();
          /* 링은 몸 폭의 1.1배 — 발 언저리에 살짝 걸친다(지적: 링이 몸보다 크다).
             상자 기준이던 예전엔 종류에 따라 0.64~2.61배로 벌어졌다. */
          ctx.ellipse(footX, ringY, inkW * 0.55, inkW * 0.31 * (op.pitch ? PITCH_FLAT : 1), 0, 0, Math.PI * 2);
        };
        /* 검은 테는 걷었다(지적: 깔려면 마우스 마커에도 깔아야 한다) — 링만 두 겹이라
           둘이 따로 놀았다. 임자 색 실선 한 겹으로 통일한다. */
        ctx.globalAlpha = op.alpha * 0.95;
        ctx.strokeStyle = op.color;
        ctx.lineWidth = ringW;
        ringPath();
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
        /* 자를 상자(px)에서 **몸 폭(inkW)**으로 옮긴다(회귀: 아콘 바가 몸의 1.49배).
           HP_BAR_W 0.78 × hpScale 상한 1.25 = 0.975 — 어떤 종류에서도 바는 몸보다
           넓지 않다. 이것이 표가 아니라 **식으로** 보장되는 것이 핵심이다: 예전 상자
           기준으로는 잉크 몫이 0.19~0.78로 벌어져 같은 식이 옵저버 2.53배·다크아콘
           0.62배가 됐고, 모델을 고칠 때마다 다시 깨졌다.
           길이가 최대 체력을 따르는 것(요청)은 그대로다 — 저글링 0.585배 ↔ 울트라
           0.975배에 몸 크기 차이가 곱해져 바 길이는 여전히 네 배쯤 벌어진다. */
        const bw2 = Math.max(1.5, inkW * 0.78 * hpScale);
        const bh2 = Math.max(0.5, inkW * 0.08);
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

export function ShapeIcon({
  kind, className, faces: facesOverride, rotDeg, flat, keepRatio, viewYaw, pitchView, wide, fit,
}: {
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
  /** 넓은 창(도록 전용) — 16-상자 밖까지 보여 준다(지적: "스파이어, 파일런 등이 안나옴").
   *  건물 정규화는 잉크를 상자의 1.2~2.8배까지 채우고(파일런 1.88·고치 2.84) 스파이어는
   *  키가 상자를 훌쩍 넘는다. 지도는 그 넘침이 제 모습이지만 도록은 **모델 전체**를
   *  봐야 하므로, 창을 사방으로 한 상자씩 넓혀 32-상자로 본다. */
  wide?: boolean;
  /** 잉크에 창을 맞춘다(도록의 "크기: 최대" — 요청: "최대는 진짜 최대야, 각 유닛을
   *  그리드에 패딩만 빼고 최대로 채우기"). 정규화(MODEL_NORM·BLD_NORM)는 **모델끼리
   *  같은 몫으로 채우는가**를 보는 자라 창을 남기는 것이 제 일이고, 그래서 칸의 절반쯤은
   *  늘 빈다. 여기서는 그 자를 아예 안 태우고 실제로 칠해진 상자를 재서 그 상자를 창으로
   *  삼는다 — 어느 모델이든 칸을 꽉 채운다. 비율은 지키고(meet) 가운데 놓는다.
   *  "인게임"은 이 문을 안 지난다: 거기서는 서로 얼마나 큰지가 물음이라 창이 공통이어야
   *  한다. */
  fit?: boolean;
}) {
  /* 방향은 요잉으로(지적: 화면 회전은 2D 시점에서 모델을 뒤집는다) — 3D 빌더가 있는
     도형은 rotDeg를 화면 회전 대신 모델 요잉 재투영으로 처리한다. 15도 버킷으로 한 번
     굽어 갈무리한다. 위쪽을 봐도 높이는 늘 위를 향한다. */
  const resolved = facesOverride
    ? { faces: facesOverride, rot: SHAPE_ROT[kind] ?? 0 }
    : resolveShapeFaces(kind, rotDeg, flat, viewYaw, pitchView);
  const faces = resolved.faces;
  const rot = resolved.rot;
  /* 잉크 상자 — 칠해진 패스를 다 훑어 합집합을 낸다. 선 굵기·둥근 마감이 살짝 넘치므로
     짧은 변의 3%를 사방에 여유로 둔다. 아무것도 안 칠해졌으면(빈 목록) 여느 창으로. */
  let fitBox: string | undefined;
  if (fit && faces && faces.length) {
    let bx0 = Infinity; let by0 = Infinity; let bx1 = -Infinity; let by1 = -Infinity;
    for (const [d9] of faces) {
      const [a9, b9, c9, e9] = pathBox(d9);
      if (a9 < bx0) bx0 = a9;
      if (b9 < by0) by0 = b9;
      if (c9 > bx1) bx1 = c9;
      if (e9 > by1) by1 = e9;
    }
    if (bx1 > bx0 && by1 > by0) {
      const pad9 = Math.min(bx1 - bx0, by1 - by0) * 0.03;
      fitBox = `${(bx0 - pad9).toFixed(3)} ${(by0 - pad9).toFixed(3)} `
        + `${(bx1 - bx0 + pad9 * 2).toFixed(3)} ${(by1 - by0 + pad9 * 2).toFixed(3)}`;
    }
  }
  return (
    // preserveAspectRatio="none" — 상자(발자국 비율)에 맞춰 그림째 눌린다(요청: 캔버스
    // 비율을 정확하게). 정사각 상자(유닛 마커 등)에서는 아무 일도 안 일어난다.
    <svg
      className={cx("scr-motion-shape-svg", className)}
      viewBox={fitBox ?? (wide ? "-8 -12 32 32" : "0 0 16 16")}
      preserveAspectRatio={fitBox || keepRatio ? (fitBox ? "xMidYMid meet" : "xMidYMax meet") : "none"} aria-hidden
    >
      {/* 도록도 모델 공간 정규화를 탄다(지적: 정작 모델을 보는 화면에 정규화가 없어
          "같은 크기로 디자인"을 확인할 수단이 없다) — 굽기(unitSprite)와 **같은 배수·
          같은 축(상자 중심)**이다. 여기서 확인되는 것은 "모든 모델이 제 상자를 같은
          몫으로 채우는가"이지 **지도에서 보이는 크기가 아니다**: ① 도록은 유닛마다
          크기표를 안 태우므로 전 유닛이 같은 크기로 보이는 반면 지도에서는 배틀크루저
          몸 3.74타일 : 저글링 1.75타일로 2.1배 다르고, ② 도록은 base 모드(사선), 지도
          기본은 top 모드라 같은 모델도 −9.1%(스카웃) ~ +15.1%(변태고치)로 어긋난다.
          표에 없는 종류(건물·핵 등)는 1이라 아무 일도 안 일어난다. */}
      {/* ★ 건물 정규화(BLD_NORM)도 여기서 태운다(지적: "지도 크기 끄면 다 크기가
          똑같아야하는거지") — 여태 이 자리는 유닛 표(MODEL_NORM)만 봤고 건물은 배수 1로
          떨어졌다. 그래서 도록은 건물을 **정규화 전 날것**으로 보여 주고 있었다: 실측으로
          날것의 잉크 폭이 6.79~18.15로 2.67배 벌어져 있으니, 도록에서 "이 건물은 작게
          모델링됐다"고 보이던 것 중 상당수가 실은 지도에서는 정규화로 이미 채워지고
          있었다는 뜻이다. 이제 도록과 지도가 같은 배수를 본다.
          축도 지도와 같다 — 유닛은 상자 한가운데(8,8), 건물은 발 가운데(8,16)에서 키운다
          (buildingSprite가 쓰는 그 축이다). */}
      <g transform={fitBox ? (rot ? `rotate(${rot} 8 8)` : undefined) : ([
        rot ? `rotate(${rot} 8 8)` : "",
        modelNormOf(kind) !== 1 ? `translate(8 8) scale(${modelNormOf(kind)}) translate(-8 -8)` : "",
        modelNormOf(kind) === 1 && bldNormOf(kind) !== 1
          ? `translate(8 16) scale(${bldNormOf(kind)}) translate(-8 -16)` : "",
      ].filter(Boolean).join(" ") || undefined)}>
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
/** 땅에 숨을 수 있는 것들(공식) — 저글링·히드라·드론·러커·디파일러·인페스티드
 *  테란. 울트라·퀸·스커지는 못 숨는다. 버로우 커맨드는 고른 무리 전체에 실려
 *  오므로(못 숨는 것이 섞여 있어도 같은 증거가 붙는다) 이 명단으로 거른다. */
const BURROWABLE = new Set(["Drone", "Zergling", "Hydralisk", "Lurker", "Defiler", "Infested Terran"]);
/** 지금 땅속인가 — 땅속이면 '판 시각', 아니면 -1. 시즈와 같은 잣대(켬/끔 증거를
 *  시간순으로 접는다)다. 판 시각을 돌려주는 이유는 그 자리에 못 박기 위해서다
 *  (지적: 러커와 버로우 러커가 같이 움직인다 — 구멍이 자취를 따라 미끄러졌다). */
const burrowStartOf = (spans: [number, number][], t: number): number => {
  let at = -1;
  for (const [bs, on] of spans) {
    if (bs > t) break;
    at = on === 1 ? bs : -1;
  }
  return at;
};
const STATUS_TINT: Record<string, string> = {
  ensnare: "#79c74c", plague: "#b4452e", stasis: "#69b7e8",
  mael: "#a86ae0", lock: "#c8c8d2", irr: "#e8c84a",
};
/** 상태의 한국어 이름(요청: 건설·변태 등 모든 상태 노출) — 정보 팝업이 쓴다. */
const STATUS_KO: Record<string, string> = {
  ensnare: "인스네어", plague: "플레이그", stasis: "스테이시스",
  mael: "마엘스트롬", lock: "락다운", irr: "이레디에이트",
};
/** 그 마법이 지금 이 몸에 하는 일(요청: 마법 걸린 상태도 피해나 상승 오라도 표시) —
 *  글과 색까지. 피해를 주는 것은 붉게, 묶는 것은 보라, 늦추는 것은 청록이다. */
const STATUS_FX: Record<string, { fx: string; col: string }> = {
  plague: { fx: "지속 피해(체력 1까지)", col: "#e0705a" },
  irr: { fx: "지속 피해 + 곁 아군까지", col: "#e8c84a" },
  ensnare: { fx: "이동·공격 속도 저하", col: "#79c74c" },
  stasis: { fx: "무적·행동 불가", col: "#69b7e8" },
  mael: { fx: "행동 불가(생체)", col: "#a86ae0" },
  lock: { fx: "행동 불가(기계)", col: "#c8c8d2" },
};
/** 디텍터(전수조사: 투명화 카운터) — 이들이 곁에 있으면 은신이 벗겨진다. */
const DETECTOR_UNITS = new Set(["Overlord", "Observer", "Science Vessel"]);
/* 같은 자리 변태·재건의 계보(지적: 성큰 변태에서 고치가 페이드아웃되고 성큰이 안 남음)
   — 예전엔 'Colony끼리'·'해처리 계열끼리'를 서로 후계로 쳤다. 방향이 없으니 옆에 새로
   심은 크립 콜로니가 방금 변태를 마친 성큰을 제 후계로 잡아 지웠다(저그 본진의 콜로니는
   한 타일 간격으로 붙어 선다). 변태는 한 방향이다 — 크립은 성큰·스포어가 되지만 그
   반대는 없고, 성큰은 종착지다. */
const MORPH_NEXT: Record<string, string[]> = {
  "Creep Colony": ["Sunken Colony", "Spore Colony"],
  Hatchery: ["Lair", "Hive"],
  Lair: ["Hive"],
};
/** 뒤 건물(to)이 앞 건물(from)의 후계인가 — 같은 종류의 재건이거나 변태의 다음 단계. */
const succeedsBld = (from: string, to: string): boolean =>
  to === from || (MORPH_NEXT[from] ?? []).includes(to);
/** 같은 자리인가 — ±1.5타일은 한 칸 간격으로 붙어 선 콜로니를 서로 삼켰다(지적). */
const SAME_SITE_TILES = 0.6;
/** 디텍터가 은신을 벗기는 거리(타일) — 표시 투명도와 표적 판정이 같은 자를 쓴다. */
const DETECT_TILES = 9;
/** 스캐너 스윕이 그 자리를 디텍터로 만드는 시간(초) — 화면 효과도 같은 길이로 남는다.
 *  원작의 스캔 수명은 220프레임(빠른 속도에서 약 9초)이라 12초는 길었다(지적). */
const SCAN_DETECT_SEC = 9;
/* 스캔 별가루의 자리(%) — 황금각 나선으로 원 안에 고르게 흩고, 반짝임 박자만 어긋낸다.
   한 번 셈해 두는 상수라 프레임마다 자리가 안 바뀐다. */
const SCAN_DUST: [number, number, number][] = Array.from({ length: 16 }, (_, i) => {
  const a9 = i * 2.399963;
  const r9 = Math.sqrt((i + 0.4) / 16) * 42;
  return [50 + Math.cos(a9) * r9, 50 + Math.sin(a9) * r9, ((i * 5) % 16) * 0.11];
});
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
/* 건물 짓는 시간(초) — 원작의 프레임 수를 23.81로 나눈 값이다(지적: 3시 첫 포톤캐논이
   너무 빨리 지어진다). 예전엔 열두 개만 적어 두고 나머지는 30초로 뭉갰는데, 게이트웨이
   (37.8)·연결체(75.6)·사이버네틱스(37.8)가 죄다 그 30초로 떨어져 있었다.
   이 리플레이로 상한을 대조했다 — 건설 명령과 '그 건물이 있어야 낼 수 있는 첫 명령'의
   간격은 (짓는 시간 + 일꾼 걸음 + 사람 반응)이라 늘 표값보다 커야 한다:
     게이트웨이 58.3→질럿 100.7 (걸음 2.7 빼고 39.7) ≥ 37.8 ✓
     포지     111.4→캐논 146.5 (걸음 8.5 빼고 26.5) ≥ 25.2 ✓
     사이버   203.1→드라군 246.6 (2 빼고 41.5) ≥ 37.8 ✓
     스포닝풀  50.9→저글링 117.8 ≥ 50.4 ✓   시타델 295.3→발업 353.9 ≥ 37.8 ✓
   앞의 둘은 여유가 2초도 안 되게 딱 맞는다 — 표가 맞다는 가장 센 증거다. */
const BUILD_SEC: Record<string, number> = {
  // 테란
  "Command Center": 75.6, "Comsat Station": 25.2, "Supply Depot": 25.2, Refinery: 25.2,
  Barracks: 50.4, Academy: 50.4, Factory: 50.4, Starport: 44.1, "Control Tower": 25.2,
  "Science Facility": 37.8, "Covert Ops": 25.2, "Physics Lab": 25.2, "Machine Shop": 25.2,
  "Engineering Bay": 37.8, Armory: 50.4, "Missile Turret": 18.9, Bunker: 18.9,
  "Nuclear Silo": 37.8,
  // 프로토스
  Nexus: 75.6, Pylon: 18.9, Assimilator: 25.2, Gateway: 37.8, Forge: 25.2,
  "Photon Cannon": 31.5, "Shield Battery": 18.9, "Cybernetics Core": 37.8,
  "Citadel of Adun": 37.8, "Templar Archives": 37.8, "Robotics Facility": 50.4,
  "Robotics Support Bay": 18.9, Observatory: 18.9, Stargate: 44.1,
  "Fleet Beacon": 37.8, "Arbiter Tribunal": 37.8,
  // 저그
  Hatchery: 75.6, Lair: 63, Hive: 75.6, Extractor: 25.2, "Spawning Pool": 50.4,
  "Creep Colony": 12.6, "Sunken Colony": 12.6, "Spore Colony": 12.6,
  "Evolution Chamber": 25.2, "Hydralisk Den": 25.2, "Queens Nest": 37.8,
  Spire: 75.6, "Greater Spire": 75.6, "Nydus Canal": 25.2, "Defiler Mound": 37.8,
  "Ultralisk Cavern": 50.4,
};
/** 공사가 실제로 자란 시간(초) — 붙어 있던 구간들을 t까지 더한다(테란 건설 중단). */
const workedBy = (wins: [number, number][], t: number): number => {
  let s = 0;
  for (const [a, b] of wins) {
    if (t <= a) break;
    s += Math.min(t, b) - a;
  }
  return s;
};
/** 지금 일꾼이 붙어 있나 — 구간 안이면 자라는 중, 아니면 중단이다. */
const workingAt = (wins: [number, number][], t: number): boolean =>
  wins.some(([a, b]) => t >= a && t < b);

/* (걷어냄) UNIT_SEC — '유닛 뽑는 시간' 어림표. 완성 시각을 되짚는 데 쓰던 자리는
   전부 원작 표(UNIT_BUILD_SEC)와 개체 트랙의 출생 시각으로 옮겨 갔다. */
/* (걷어냄) 자원 고갈 상수(MINERAL_DEPLETE_SEC·GAS_DEPLETE_SEC) — 고갈 어림을
   걷으면서 함께. */

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

/* 걸음 시계가 빚을 갚는 속도(요청: 교전 뒤 이동이 부자연스럽다) — 뒤처진 시계는
   1.4배로 달려 따라잡는다. 화면 스무딩 상한(제 걸음 ×1.5)보다 낮아, 따라잡는 동안에도
   몸이 자취를 벗어나 가로지르지 않는다. 빚 상한은 그 위의 안전판이다. */
/* (걷어냄) TRACK_CATCHUP·TRACK_DEBT_MAX — 렌더러가 명령 좌표를 '언제 지날까'로
   어림하던 시절의 빚·따라잡기 상수. 코어 자취는 제 시각에 제자리다. */

/* (걷어냄) nearestTrackSec — 교전이 끝난 뒤 '지금 선 자리와 가장 가까운 앞쪽 시각'을
   찾아 시계를 옮기던 자. 렌더러 교전 당김과 함께. */

/* (걷어냄) unitAt — '이 부대의 우세 유닛' 어림. 개체마다 제 정체(e.k)가 있으니
   부대의 대표 이름을 고를 일이 없다. */

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
  grid, endSec, bases, teamOfRaw, active = true, winnerTeam, side,
  onDetailClose, loadUnitTracks, initialSec, clockKey, shareNode,
}: {
  grid: ReplayMapGrid;
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
  /* 경기 길이는 경기 메타(endSec)가 유일한 주다 — v1 모션을 걷어내면서 '건물·마법
     시각으로 어림하던' 폴백도 함께 걷었다. 메타가 없으면 60초로 서서 눈에 띈다. */
  const total = useMemo(() => (endSec && endSec > 0 ? endSec : 60), [endSec]);

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
  /* 개인색은 개체 트랙(entData.players[].color)에서만 온다 — v1 모션 트랙의 color는
     걷었다. 아래 modeColor가 이 표를 먼저 보고, 없으면 entData를 직접 뒤진다. */
  const colorByRaw = useMemo(() => new Map<string, string>(), []);
  /* 색은 한 벌만 칠한다(요청: 중복 표시 제거) — 팀색/개인색을 전환 버튼으로 오간다.
     개인색이 없는 옛 기록은 개인색 모드여도 팀색으로 떨어진다. */
  const [colorMode, setColorMode] = useState<"team" | "personal">("personal");
  /* 개체 트랙 — 화면이 그리는 **유일한** 자료다(v1 부대 추적은 걷었다). 뜨자마자 한 번
     내려받고, 못 받으면 아래 보기 줄이 '재분석 필요'라고 말한다: 자료가 없는 것과
     "그 경기엔 아무 일도 없었다"가 화면에서 갈려야 한다. */
  const [entData, setEntData] = useState<UnitTracksV2 | null>(null);
  const [entLoad, setEntLoad] = useState<"idle" | "loading" | "none">("idle");
  /* 시뮬 코어 미리보기(기획서 docs/plan-sim-core-v4.md P1) — 주소에 ?sim=1을 붙이면
     유닛의 자리·방향을 명령 자취가 아니라 시뮬 결과에서 읽는다. 기존 길과 나란히 두고
     눈으로 견줄 수 있게 깃발로 켠다 — 확인이 끝나면 이쪽이 기본이 되고 보정 코드가
     통째로 걷힌다. 시뮬은 워커가 돌고 결과는 IndexedDB에 캐시된다(열 때마다 안 돈다). */
  const [simTracks, setSimTracks] = useState<Map<number, SimTrack> | null>(null);
  const [simEvents, setSimEvents] = useState<SimEventArr | null>(null);
  /* 진행 알림(지적: 로딩 시간이 전혀 없는데 되는 건가) — 워커에서 도니 화면이 안 멈춰
     제대로 돌았는지 눈으로 가릴 수가 없다. 지도 귀퉁이에 상태를 적어 둔다. */
  const [simNote, setSimNote] = useState<string | null>(null);
  /* 클릭 자국 토글(요청) — 기본은 끔: 클릭이 많은 경기에서는 자국이 화면을 덮는다. */
  const [clickFx, setClickFx] = useState(true); // 기본 켬(요청)
  /* 사양 라디오(요청: "성능 3단계로 수정(저/중/고) 이러면 딱 LOD랑 맞고 편하지") —
     값이 **곧 모델 부품 등급(LOD)**이다: 1 저=형체만 · 2 중=+포인트 · 3 고=+장식.
     렌더 요소도 같은 세 칸에 접었다(옛 다섯 칸의 최저는 저로, 최고는 고로 합쳤다):
       저 1 — 접지 그림자·체력바·죽음 효과
       중 2 — +전투·공사 애니·크립
       고 3 — +겹침 그림자·핑(전부 켬)
     한 자리에서 모델 정밀도와 효과가 같이 오르내려, 고르는 쪽도 한 눈금만 본다. */
  const [quality, setQuality] = useState(2);
  // 체력바 보임/숨김(요청: 라디오화) — 사양 게이트와 곱해진다.
  const [hpShow, setHpShow] = useState(true);
  // 모델 굽기가 이 상한을 읽는다 — 그리기 전에 세워 둔다(모듈 전역, lodPenalty와 같은 결).
  lodSetCap(quality);
  const qHp = true;
  const qDeath = true;
  /* 낮은 사양에서는 그림자를 끈다(요청: "대신 그림자 반사 등 효과를 없애서 부하
     감축하지뭐") — LOD 티어0에 지배색·개인색 부품이 다 들어오면서 부품 솎기로 버는
     몫이 줄었다. 그 값을 화면 효과 쪽에서 치른다. 실루엣 광원은 원래부터 최고 등급
     에서만 얹는다. */
  const qShadows = quality >= 2;
  const qCombat = quality >= 2;
  const qBuildFx = quality >= 2;
  const qCreep = quality >= 2;
  const qOverlap = quality >= 3;
  const qPing = quality >= 3;
  /* (제거·요청) 좌우 동시 보기(비교) — forceEnt·syncKey·syncRole·신호줄까지 걷었다. */
  useEffect(() => {
    if (loadUnitTracks && !entData && entLoad === "idle") void loadEnt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadUnitTracks]);
  /* 토글이 아니라 로더다 — 켜고 끄는 길은 없다(갈래가 하나뿐인데 스위치를 두면 거짓말
     이다). 실패는 entLoad === "none"으로 남아 화면에 그대로 드러난다. */
  const loadEnt = async (): Promise<void> => {
    if (entData || !loadUnitTracks || entLoad === "loading") return;
    setEntLoad("loading");
    try {
      const raw = await loadUnitTracks();
      const parsed = raw ? (JSON.parse(raw) as UnitTracksV2) : null;
      if (parsed && parsed.v === 2 && Array.isArray(parsed.ents)) {
        setEntData(parsed);
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
  const buildsV2 = useMemo<BuildRow[]>(() => {
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
      /* 죽음의 주인은 하나다(과제 #69) — 분석이 체력 자취를 **d에서** 0으로 맞춰
         내보내므로, 여기서 체력 0을 따로 볼 이유가 없어졌다. 옛 코드는 hpZero가 d보다
         이르면 그쪽을 골랐는데, 실측으로 그 둘이 거의 늘 달랐다(경기1: 체력 0에 닿은
         1042기 중 d와 같은 것이 6기, 934기가 평균 6초 일렀고 62기는 증거상 살았는데도
         바가 0이었다). 이제 분석 쪽에서 하나로 모았다. */
      const gone = e.d ?? 0;
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
    const out: BuildRow[] = [];
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
  const castsV2 = useMemo<CastRow[]>(() => {
    if (!entData) return [];
    const nameOfId = new Map(entData.players.map((pl) => [pl.id, pl.name]));
    return (entData.casts ?? []).map(([s, x, y, tech, pidc]) =>
      [s, x, y, tech, nameOfId.get(pidc) ?? ""] as CastRow);
  }, [entData]);
  /* 건물 체력 자취(요청: 건물 체력바 — 실드·회복·불·수리 반영은 분석이 했다) —
     자리 열쇠(raw|x|y)로 그 건물의 체력 변곡점을 찾는다. */
  const entBldHp = useMemo(() => {
    const m = new Map<string, { born: number; hp: [number, number][] }[]>();
    if (!entData) return m;
    const nameOfId = new Map(entData.players.map((pl) => [pl.id, pl.name]));
    for (const e of entData.ents) {
      if (!e.bld || !e.hp || e.hp.length === 0) continue;
      const site = [...e.ev].reverse().find((v) => v[3] === 2 || v[3] === 5 || v[3] === 17);
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
    const rows: {
      tag: number; x: number; y: number; raw: string; born: number; gone: number; k: string;
      /** 이륙 시각 — 뜬 뒤로는 표적 자리가 앉았던 자리가 아니라 나는 자리다. */
      lift?: number;
    }[] = [];
    /* 태그 없는 물리 건물 자리(기획서 2-D) — 시작 홀 등 태그 생애가 없는 건물의
       자리 색인. 태그 미해석 어택의 폴백 표적이 된다. */
    const sites: {
      x: number; y: number; raw: string; born: number; gone: number; k: string; lift?: number;
    }[] = [];
    if (!entData) return { rows, sites };
    const nameOfId = new Map(entData.players.map((pl) => [pl.id, pl.name]));
    for (const e of entData.ents) {
      if (!e.bld) continue;
      const site = [...e.ev].reverse().find((v) => v[3] === 2 || v[3] === 5 || v[3] === 17);
      if (!site) continue;
      // 죽음의 주인은 하나다(과제 #69) — 위 주석 참조.
      const gone = e.d ?? 0;
      /* 이륙 증거(f=6)를 같이 싣는다 — 여태 이 색인은 건설·착륙(f=2/5/17)만 봐서, 떠서
         날아가는 건물의 표적 자리가 마지막 착륙 지점에 못박혀 있었다(몸은 날아가는데
         어택으로 찍은 총알은 빈 땅으로 갔다). */
      const lifted = [...e.ev].reverse().find((v) => v[3] === 6 && v[0] >= site[0]);
      const row = {
        tag: e.t, x: site[1] + footDx(e.k), y: site[2] + footDy(e.k),
        raw: nameOfId.get(e.o) ?? "", born: e.b, gone, k: e.k,
        ...(lifted ? { lift: lifted[0] } : {}),
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
  /* 벙커에 누가 들었나(원전: 벙커 **자신은** 표적 획득도 발사도 안 한다 — UNITS.Bunker의
     ground/air가 둘 다 null이다. 쏘는 것은 안에 든 마린·파이어뱃·고스트이고 메딕·SCV는
     타기만 한다). 리플레이에는 '누가 안에 있는지'가 따로 안 남고 남는 것은 제 벙커를 찍은
     우클릭뿐인데, 분석이 그것을 승선 증거(f=12)로 옮겨 두었고 다섯째 칸이 태운 쪽 태그다.
     짝이 되는 하차(f=13)까지가 탑승 구간이고, 하차 명령이 없으면 그 개체가 사라질 때까지다.
     자리는 넷뿐이라(BUNKER_SEATS) 먼저 들어간 넷만 센다. */
  const bunkerCrew = useMemo(() => {
    const m = new Map<number, { kind: string; from: number; to: number }[]>();
    if (!entData) return m;
    const bunkers = new Set(entData.ents.filter((e) => e.bld && e.k === "Bunker").map((e) => e.t));
    for (const e of entData.ents) {
      if (e.bld || !e.k) continue;
      for (let i = 0; i < e.ev.length; i += 1) {
        const v = e.ev[i];
        if (v[3] !== 12) continue;
        const host = v[4] ?? 0;
        if (!bunkers.has(host)) continue;
        const off = e.ev.find((v2, j) => j > i && v2[3] === 13);
        const arr = m.get(host) ?? [];
        arr.push({ kind: e.k, from: v[0], to: off ? off[0] : (e.d ?? Infinity) });
        m.set(host, arr);
      }
    }
    for (const arr of m.values()) arr.sort((a, b) => a.from - b.from);
    return m;
  }, [entData]);
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
  /* 테란 건설 중단(요청) — 원작에서 테란 건물은 **SCV가 붙어 있는 동안만** 자란다:
     짓던 SCV가 딴 명령을 받아 걸어 나가거나 죽으면 공사는 그 진행률에서 멈춰 서고
     (건설 중단), 아무 SCV나 그 건물을 다시 찍으면 그 자리에서 이어 짓는다. 여태 화면은
     '착공 시각 + 표의 건설 시간'이면 무조건 완성이라, 러시에 일꾼이 죽어 영영 안 지어진
     건물이 멀쩡히 서 있었다(저그 변태·프로토스 소환은 일꾼이 없어도 자라므로 그대로다).

     증거는 개체 트랙에 이미 다 있다 — 일꾼의 위치 증거 하나가 '그 자리로 간다'는 뜻이고
     다음 위치 증거(또는 죽음 e.d)가 그 구간을 닫는다. 착공 앵커(f=2)로 열린 구간이 곧
     처음 붙어 있던 동안이고, 그 뒤 **발자국 안을 찍은 일꾼 클릭**이 이어 짓기다(아직 다
     안 지어진 건물 자리는 걸어 들어갈 수 있는 땅이 아니라, 그 안을 찍는 클릭은 이어
     짓기·수리뿐이다). 시프트 예약 명령(다섯째 칸 1)은 지금 움직이지 않으니 구간을 안
     닫는다 — 짓고 나서 캐러 갈 예약은 중단이 아니다.

     ★ 안전망: 그 건물이 나중에 실제로 일한 증거(생산·랠리 f=4, 이륙 f=6, 남이 찍은
       자리 f=1, 부속건물 건설 f=2)가 있으면 그때는 이미 완성이다 — 증거가 어림을 이긴다. */
  const bldWork = useMemo(() => {
    const m = new Map<number, { wins: [number, number][]; doneAt: number }>();
    if (!entData) return m;
    const nameOfId = new Map(entData.players.map((pl) => [pl.id, pl.name]));
    const raceOfRaw = new Map(entData.players.map((pl) => [pl.name, pl.race]));
    /* 일꾼이 어디에 있었나 — 타일 바구니에 담아 건물마다 훑을 값을 줄인다(건물 수백 ×
       일꾼 증거 수천이면 그냥 훑기엔 무겁다). */
    type Win = { raw: string; x: number; y: number; f: number; a: number; b: number };
    const bucket = new Map<string, Win[]>();
    for (const e of entData.ents) {
      if (e.bld || e.t === -1) continue;
      if (e.k !== "SCV" && e.k !== "") continue;
      const raw = nameOfId.get(e.o) ?? "";
      if (!raw) continue;
      for (let i = 0; i < e.ev.length; i += 1) {
        const v = e.ev[i];
        if (v[1] < 0 || (v[3] !== 0 && v[3] !== 2 && v[3] !== 10)) continue;
        let end = e.d ?? Infinity;
        for (let j = i + 1; j < e.ev.length; j += 1) {
          const w = e.ev[j];
          if (w[1] < 0 || w[0] <= v[0] + 1) continue;
          if (w[3] === 0 && w[4] === 1) continue;      // 예약 명령은 아직 안 움직인다
          end = Math.min(end, w[0]);
          break;
        }
        if (!(end > v[0])) continue;
        const key = `${Math.floor(v[1])}|${Math.floor(v[2])}`;
        const arr = bucket.get(key);
        const win: Win = { raw, x: v[1], y: v[2], f: v[3], a: v[0], b: end };
        if (arr) arr.push(win);
        else bucket.set(key, [win]);
      }
    }
    /* 그 건물이 실제로 일한 첫 시각 — 생산·랠리(f=4)·이륙(f=6)·부속건물 건설(f=2)·
       착륙(f=5)은 다 지어진 건물만 할 수 있는 일이다. '남이 찍은 자리'(f=1)는 뺐다 —
       적이 짓다 만 건물을 때리는 클릭이 그것이라, 완성의 증거가 아니다.
       자리 열쇠는 건물 렌더가 쓰는 것과 같다. */
    const actAt = new Map<string, number>();
    for (const e of entData.ents) {
      if (!e.bld) continue;
      const anchor0 = e.ev.find((v) => v[3] === 2 || v[3] === 5);
      if (!anchor0) continue;
      const act = e.ev.find((v) => v[0] > anchor0[0] + 1
        && (v[3] === 4 || v[3] === 6 || v[3] === 2 || v[3] === 5));
      if (!act) continue;
      const key = `${nameOfId.get(e.o) ?? ""}|${Math.round(anchor0[1])}|${Math.round(anchor0[2])}`;
      const prev = actAt.get(key);
      if (prev === undefined || act[0] < prev) actAt.set(key, act[0]);
    }
    buildsV2.forEach((row, i) => {
      const [sec, x, y, unit, raw] = row;
      if (sec <= 0 || raceOfRaw.get(raw) !== "테란" || ADDONS.has(unit)) return;
      const need = BUILD_SEC[unit] ?? 30;
      const [fw, fh] = FOOTPRINT[unit] ?? [3, 2];
      const cand: Win[] = [];
      for (let ty = Math.floor(y) - 1; ty <= Math.floor(y + fh) + 1; ty += 1) {
        for (let tx = Math.floor(x) - 1; tx <= Math.floor(x + fw) + 1; tx += 1) {
          const arr = bucket.get(`${tx}|${ty}`);
          if (arr) for (const w of arr) cand.push(w);
        }
      }
      /* 착공을 낸 일꾼의 앵커 — 이것이 있어야 '일꾼이 지은 건물'이다. 시작 커맨드나
         착륙으로 앉은 줄은 여기서 걸러진다(공사 자체가 없었다). */
      const anchor = cand.find((w) => w.raw === raw && w.f === 2
        && Math.abs(w.a - sec) <= 2 && Math.hypot(w.x - x, w.y - y) <= 1.5);
      if (!anchor) return;
      const spans: [number, number][] = [[sec, Math.max(sec, anchor.b)]];
      for (const w of cand) {
        if (w === anchor || w.raw !== raw || w.b <= sec) continue;
        if (w.x < x - 0.5 || w.x > x + fw + 0.5 || w.y < y - 0.5 || w.y > y + fh + 0.5) continue;
        spans.push([Math.max(sec, w.a), w.b]);
      }
      spans.sort((p2, q2) => p2[0] - q2[0]);
      const wins: [number, number][] = [];
      for (const sp of spans) {
        const last = wins[wins.length - 1];
        if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
        else wins.push([sp[0], sp[1]]);
      }
      let acc = 0;
      let doneAt = Infinity;
      for (const [a, b] of wins) {
        if (b - a >= need - acc) { doneAt = a + (need - acc); break; }
        acc += b - a;
      }
      /* 증거가 어림을 이긴다 — 다만 표의 건설 시간보다 빨리 세울 수는 없으니 하한을
         함께 건다(실측: 8초 만에 끊긴 벙커가 클릭 증거로 155초에 완성이 될 뻔했다). */
      const act = actAt.get(`${raw}|${Math.round(x)}|${Math.round(y)}`);
      if (act !== undefined && act < doneAt) doneAt = Math.max(sec + need, act);
      // 한 번도 안 멈춘 공사는 표에 안 담는다 — 렌더가 종전 셈(착공 + 건설 시간)으로 간다.
      if (doneAt <= sec + need + 0.01) return;
      m.set(i, { wins, doneAt });
    });
    return m;
  }, [entData, buildsV2]);
  /* 살아 있는 일꾼 수(요청: 일꾼 수도 사망 일꾼 반영해 실시간으로) ────────────────
     옛 값은 생산 **누계**였다 — 한 번 는 뒤로 절대 줄지 않아서, 실측 1855초 팀전에서
     한 테란이 133기로 표시되는 동안 실제로 살아 있는 것은 13기였다(저그는 더 심했다:
     121기 대 0기 — 드론이 건물로 변태한 몫까지 그대로 남아 있었다).
     개체 트랙은 개체마다 태어난 초(b)와 끝난 초(d)를 지닌다. 그 둘을 +1/−1 사건으로
     늘어놓으면 시각별 생존 수가 그대로 나온다. 변태(드론→익스트랙터)도 d가 찍히므로
     저그 가스만 따로 빼 주던 손보정이 필요 없어진다 — 해처리·성큰이 된 드론도 함께
     빠진다(옛 보정은 익스트랙터만 알았다).
     ★ 시작 4기는 커맨드가 없어 트랙에 늦게 나타난다(첫 클릭에야 잡힌다 — 실측으로
       0초에 0기, 10초에 3~4기). 그 공백만 바닥값으로 메운다: max(생존 수, 4 − 여태
       죽은 수). 후반에는 죽은 수가 4를 넘어 바닥이 저절로 0이 되므로 개입하지 않는다. */
  const workerLive = useMemo(() => {
    /** raw → [초, 그때의 생존 일꾼 수] (계단 자취) */
    const m = new Map<string, [number, number][]>();
    if (!entData) return m;
    const nameOfId = new Map(entData.players.map((pl) => [pl.id, pl.name]));
    const evs = new Map<string, [number, number][]>();
    for (const e of entData.ents) {
      if (e.bld || !WORKER_KINDS.has(e.k)) continue;
      const raw = nameOfId.get(e.o);
      if (raw === undefined) continue;
      const a = evs.get(raw) ?? [];
      a.push([e.b, 1]);
      if (e.d !== null) a.push([e.d, -1]);
      evs.set(raw, a);
    }
    for (const [raw, a] of evs) {
      a.sort((p, q) => p[0] - q[0]);
      const series: [number, number][] = [];
      let live = 0;
      let dead = 0;
      for (const [sec, dz] of a) {
        live += dz;
        if (dz < 0) dead += 1;
        const n = Math.max(live, WORKER_START - dead);
        // 같은 초의 사건 여럿은 마지막 값 하나로 — 계단이 한 초에 두 번 서지 않게.
        if (series.length > 0 && series[series.length - 1][0] === sec) series[series.length - 1][1] = n;
        else series.push([sec, n]);
      }
      m.set(raw, series);
    }
    return m;
  }, [entData]);
  /** 지금(t) 살아 있는 일꾼 수 — raw별. 개체 트랙이 없는 옛 경기는 비어 있고, 부르는
   *  쪽이 옛 누계 모형으로 떨어진다. */
  const workerNow = useMemo(() => {
    const m = new Map<string, number>();
    for (const [raw, series] of workerLive) {
      let n = WORKER_START;   // 첫 증거 전에도 시작 4기는 서 있다
      for (const [sec, v] of series) {
        if (sec > t) break;
        n = v;
      }
      m.set(raw, n);
    }
    return m;
  }, [workerLive, t]);
  /* 그리는 재료는 개체 트랙 하나뿐이다(요청: 정식 운영 — 안 나오면 문제인 것이 보이게).
     예전엔 v1 부대 추적으로 떨어지는 갈래가 있었는데, 그 v1 자리에는 이미 오래전부터
     빈 배열만 실려 왔다(요약 폐지). 폴백이 남아 있으면 트랙 적재가 실패해도 화면이
     그냥 조용히 비어, 고장과 '아무 일도 없던 경기'가 구분되지 않는다. */
  const buildsSrc = buildsV2;
  const castsSrc = castsV2;
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
  const engageHoldRef = useRef(new Map<string, {
    x: number; y: number; t0: number; tLast: number; adv: number;
    /** 마지막으로 화면에 그린 교전 자리 — 유예·해제 때 여기서 이어 간다. */
    px: number; py: number;
    /** 그때 겨누던 표적 자리 — 표적이 바뀌면 기준점을 다시 잡는 자다. */
    fx: number; fy: number;
  }>());
  /* 걸음 시계(요청: 교전 시뮬로 움직이다 다음 명령이 오면 막 되돌아가서 부자연스럽다) —
     예전엔 교전으로 멈춘 시간만큼 시계를 '되감아' 이어 걸었는데, 그 되감기가 곧 화면의
     후진이었다: 표적으로 파고든 몸이 싸움이 끝나는 순간 싸우기 전 자리로 물러났다.
     이제 시계는 절대 뒤로 안 간다 — 싸우는 동안 멈춰 있다가(held), 풀리면 지금 서 있는
     자리에 가장 가까운 '앞쪽' 시각으로 건너뛰어(파고든 몫을 걸음으로 인정) 거기서 이어
     걷고, 뒤처진 빚은 TRACK_CATCHUP 걸음으로 천천히 갚는다. */
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
  /* 팀색은 미니맵과 한 벌이다(요청: 덜 파스텔·진하게·원작 색) — 값은 ReplayMinimap의
     TEAM_COLOR 한 곳에서만 정한다. 여태 두 파일이 각자 다른 색을 들고 있어(재생 #5ea2ff·
     #ff7d95, 미니맵 #2b9bff·#ff4d68) 같은 팀이 화면마다 다른 파랑이었다. */
  const TEAM_EDGE: Record<1 | 2, string> = { 1: TEAM_COLOR[1], 2: TEAM_COLOR[2] };
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
  /* 시뮬이 실제로 본 지형의 지문 — 위 캐시 열쇠가 쓴다. 코어가 받는 것과 같은 격자
     (terrainRaw가 있으면 그것, 없으면 terrain)를 봐야 지문이 거짓말을 안 한다. */
  const simTerrainKey = useMemo(() => {
    const tg = terrainRaw ?? terrain;
    if (!tg) return "0";
    let walkable = 0;
    for (let i = 0; i < tg.walk.length; i += 1) if (tg.walk[i]) walkable += 1;
    /* 언덕 층도 지문에 넣는다(요청: 검수 격자에 언덕 층) — 안 넣으면 언덕을 칠해 저장해도
       열쇠가 그대로라 캐시가 옛 자취를 되돌려 준다(지형 지문이 없던 시절과 같은 구멍). */
    let hi = 0;
    if (tg.high) for (let i = 0; i < tg.high.length; i += 1) if (tg.high[i]) hi += 1;
    return `${tg.w}x${tg.h}.${walkable}.${hi}`;
  }, [terrain, terrainRaw]);
  /* 편 지문(지적: "동맹 판단도 해야지") — 팀은 개체 트랙이 아니라 화면 쪽 로스터가 안다.
     로스터가 늦게 붙을 수 있으므로 지문을 deps에 넣어, 팀이 정해지는 순간 시뮬을 다시
     돌린다(열쇠에도 같은 지문이 들어가 옛 결과와 안 섞인다). */
  const simTeamKey = useMemo(
    () => (entData ? entData.players.map((pl) => teamOfRaw(pl.name) ?? 0).join("") : ""),
    [entData, teamOfRaw],
  );
  /* 시뮬 자취 적재(위 simFlag 주석) — 개체 트랙과 지형이 다 오면 워커에 맡긴다. 결과가
     오기 전까지는 기존 길로 그린다(깜빡임 없이 갈아 끼운다). */
  useEffect(() => {
    if (!entData) {
      /* 알약도 함께 띄운다 — 아무것도 안 뜨면 깃발이 안 먹은 건지 자료가 없는 건지
         구분할 수가 없다(지적). */
      setSimNote("시뮬 대기 — 개체 트랙 기다리는 중");
      logSim("개체 트랙(v2)이 아직 없다 — 시뮬은 그것이 온 뒤에 돈다");
      return undefined;
    }
    let cancelled = false;
    logSim(`시작 — 개체 ${entData.ents.length}, 맵 ${grid.width}x${grid.height}, `
      + `지형 ${(terrainRaw ?? terrain) ? "있음" : "없음"}, 자원 ${(grid.resources ?? []).length}`);
    void loadSimTracks(
      /* 캐시 열쇠 — 경기를 가르는 값(clockKey)에 개체 수·증거 수를 지문으로 붙인다.
         clockKey가 없는 자리에서도 다른 경기끼리 섞이지 않게.
         ★ 지형·자원 지문을 뒤에 붙인다(병합 검증이 잡은 구멍). 여태 열쇠에는 지도가
           아예 없었다 — terrain·resources는 opts로 워커에 넘어가고 effect의 deps에도
           있어 effect는 다시 돌지만, 열쇠가 같으니 캐시가 **옛 자취를 되돌려 줬다**.
           맵연결·지형검수로 지도를 고쳐도 시뮬은 영영 옛 지형 판이었다는 뜻이다. 걸음이
           지형을 보는 이번 병합에서는 곧장 눈에 띄는 결함이 된다.
           격자 전체를 해싱하지 않고 '걸을 수 있는 칸 수'로 줄인 것은 값싸게 갈리는
           지문이면 충분해서다 — 칸 하나만 칠해도 이 수가 움직인다. 자원은 개수만
           센다(자리가 바뀌는 일이 없다). [어림] */
      `${clockKey ?? "g"}:${entData.ents.length}:${entData.ents.reduce((n, x) => n + x.ev.length, 0)}:${grid.width}x${grid.height}`
      + `:t${simTerrainKey}:r${(grid.resources ?? []).length}`
      // 편 지문 — 팀 배정이 갈리면 아군·적군이 갈리므로 시뮬 결과가 통째로 다르다.
      + `:m${simTeamKey}`,
      entData as unknown as Parameters<typeof loadSimTracks>[1],
      {
        width: grid.width, height: grid.height, terrain: terrainRaw ?? terrain,
        // 자원표 — 일꾼 채취 왕복의 재료(P3). 없으면 시뮬이 채취를 안 만든다.
        resources: (grid.resources ?? []) as [number, number, number][],
        /* 편 가르기(지적: "동맹 판단도 해야지") — 개체 트랙에는 팀이 안 실려 있고
           화면 쪽 로스터(bases)가 그것을 안다. 여기서 임자 번호에 붙여 넘긴다:
           팀을 모르면 시뮬은 임자 하나를 한 편으로 보므로 아군끼리 서로를 쏜다. */
        teams: entData.players.map((pl) => [pl.id, teamOfRaw(pl.name) ?? 0] as [number, number]),
      },
      setSimNote,
    ).then((got) => {
      if (cancelled || !got) return;
      setSimTracks(new Map(got.tracks.map((tr) => [tr.tag, tr])));
      setSimEvents(got.events);
    });
    return () => { cancelled = true; };
  }, [entData, terrain, terrainRaw, grid.width, grid.height, grid.resources, clockKey,
    simTerrainKey, simTeamKey, teamOfRaw]);
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
  /* (걷어냄) walkTrack — 렌더러가 제 길찾기(A*)·속도표·대기점으로 자취를 펴던 함수.
     코어(simCore)가 걸음의 진실이 되면서 나란한 두 세계 모형 중 이쪽을 걷는다. */
  /* 개체 걷기(v2·요청: 유닛 위치를 저마다 기억하고 브루드워 엔진처럼 분석) — 태그 하나가
     곧 마커 하나다. 저장된 증거 점(이동 명령의 목적지·남이 찍은 자리·건설 자리·정지)을
     그 유닛의 속도와 지형 길찾기(walkTrack)로 걸린다. 걷어낸 옛 부대 어림과 달리 묶고
     가르는 어림이 없어, 갑자기 나타나고 사라지는 유령이 원리상 안 생긴다. 생애의
     죽음(d)이 오면 마커를 걷는다. */
  /* 속업(이동 속도 업그레이드) 목록 — raw별 [초, 업그레이드 영문명].
     ★ 여태 이 자리는 v1 부대 트랙(p.ups)이 채웠는데, 요약이 폐지되며 그 트랙이 빈
       껍데기가 된 뒤로 **속업이 하나도 안 걸리고 있었다**(질럿 다리·오버로드 날개·
       벌처 부스터가 전부 기본 속도로 걸었다). 개체 트랙의 연구 기록에서 곧장 만든다.
     연구가 **끝난** 시각(upsDone)이 있으면 그쪽이 맞다 — ups는 누른 때다. */
  const upsByRaw = useMemo(() => {
    const m = new Map<string, [number, string][]>();
    if (!entData) return m;
    const nameOfId = new Map(entData.players.map((pl) => [pl.id, pl.name]));
    const src = entData.upsDone && entData.upsDone.length > 0 ? entData.upsDone : entData.ups;
    for (const [sec, name, pid] of src) {
      const raw = nameOfId.get(pid);
      if (raw === undefined) continue;
      const a = m.get(raw) ?? [];
      a.push([sec, name]);
      m.set(raw, a);
    }
    for (const a of m.values()) a.sort((x, y) => x[0] - y[0]);
    return m;
  }, [entData]);
  /* 사람별 유닛 완성 시각표 — raw → { 유닛 영문명: [완성 초…] }.
     ★ 이 자리도 v1 부대 트랙(p.prod)이 채우던 곳이라, 요약 폐지 뒤로는 비어 있었다.
       정보 팝업의 '생산 완료·큐'와 벙커 추정 사수가 그 빈 표를 읽고 있었다.
       개체 트랙에서는 개체의 출생(b)이 곧 그 유닛이 완성된 순간이라 곧장 만들 수 있다. */
  const prodDoneByRaw = useMemo(() => {
    const m = new Map<string, Record<string, number[]>>();
    if (!entData) return m;
    const nameOfId = new Map(entData.players.map((pl) => [pl.id, pl.name]));
    for (const e of entData.ents) {
      if (e.bld || !e.k) continue;
      const raw = nameOfId.get(e.o);
      if (raw === undefined) continue;
      const rec = m.get(raw) ?? {};
      (rec[e.k] ??= []).push(e.b);
      m.set(raw, rec);
    }
    for (const rec of m.values()) for (const a of Object.values(rec)) a.sort((x, y) => x - y);
    return m;
  }, [entData]);
  /** 그 사람의 첫 마린 완성 시각 — 빈 벙커에 사수 하나를 추정해도 되는 때. */
  const marineBornOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const [raw, rec] of prodDoneByRaw) {
      const a = rec.Marine;
      if (a && a.length > 0) m.set(raw, a[0]);
    }
    return m;
  }, [prodDoneByRaw]);
  const entWalks = useMemo(() => {
    if (!entData) return [];
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
      /** 버로우 켬·해제 [초, 켬1/해제0] — 시즈와 같이 커맨드 그대로. */
      burrows: [number, number][];
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
      /** 그 사람의 연구 기록 — 걸음 속도 상한(요청)이 속업을 반영하는 재료. */
      ups: [number, string][] | undefined;
      walk: [number, number, number][];
      /** 걸음이 코어(simCore)에서 왔나 — 렌더러 보정을 끄는 열쇠(과제 #61). */
    }[] = [];
    for (const e of entData.ents) {
      // 건물(태그·물리 모두)은 v1 층이 계속 그린다 — 여기는 유닛만.
      /* 건물(태그·물리 -1)은 v1 건물 층이 그린다. 합성 개체(원장 출신, -1000 이하)는
         유닛이다(요청: 한 번도 안 집힌 유닛도 태어나 랠리로 걸어간다). */
      if (e.bld || e.t === -1) continue;
      const raw = nameOfId.get(e.o) ?? "";
      const pUps = upsByRaw.get(raw);
      // 위치 없는 증거(생산·랠리, x=-1)는 걷기 재료가 아니다.
      /* 행렬 물리(지적: 이동을 찍으면 한 번에 출발하는 게 아니라 한 줄이 되면서 간다) +
         새 겹침 방지(지적: 다시 넣되 세련되게) — 같은 클릭(같은 사람·초·자리)을 받은
         개체들에 차례를 매겨, (a) 출발을 0.22초씩 늦춰 자연스럽게 한 줄 행렬이 되고,
         (b) 도착 자리는 클릭 지점 둘레 해바라기 나선으로 벌려 서로 안 포개진다 —
         프레임마다 밀치는 이완 대신 목적지 대형으로 푸는 방식이라 떨림이 없다. */
      /* 승선 구간(수리: 태운 아콘이 지도에 남고, 셔틀을 따라 벽을 뚫고 가고, 일부는
         제 발로 걸어가 공격한다) — 예전엔 승선(f=12) 다음에 오는 '아무' 증거를 구간의
         끝으로 삼았다. 그런데 셔틀과 승객을 함께 잡아 둔 채 이동을 찍는 것이 보통이라,
         비행 중에 찍힌 그 명령이 곧바로 구간을 닫았다 — 승객이 배 안에서 도로 튀어나와
         제 발로 100타일을 가로질렀다(실측: 게임 1의 승선 21건 중 5건).
         구간의 끝은 짝이 되는 하차(f=13)다. 하차 기록이 없으면, 배 안에서 낼 수 없는
         제 명령(8초 뒤의 이동·공격)이 나오기 전까지 배 안이다. */
      const rideSpans: [number, number][] = [];
      for (let i = 0; i < e.ev.length; i += 1) {
        if (e.ev[i][3] !== 12) continue;
        const bs2 = e.ev[i][0];
        const off = e.ev.find((v, j) => j > i && v[3] === 13);
        const own = e.ev.find((v, j) => j > i && (v[3] === 0 || v[3] === 7) && v[0] >= bs2 + 8);
        rideSpans.push([bs2, off ? off[0] : (own ? own[0] : Infinity)]);
      }
      /* 배 안에서 받은 명령은 걷기 재료가 아니다 — 배가 실어 나르는 동안의 클릭이라,
         자취에 넣으면 승객이 그 좌표로 제 발로 간다. 승하차 점(12·13)만 남긴다. */
      const aboardAt = (s: number): boolean =>
        rideSpans.some(([ra, rb]) => s > ra + 0.01 && s < rb - 0.01);
      const pts: TrackPt[] = [];
      // 일꾼은 대형 없이 그대로(지적: 일꾼끼리는 자원 캐는 동안 겹침이 원작 동작).
      const isWk = e.k === "SCV" || e.k === "Probe" || e.k === "Drone";
      for (const v of e.ev) {
        if (v[1] < 0 || v[3] === 4) continue;
        if (v[3] !== 12 && v[3] !== 13 && aboardAt(v[0])) continue;
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
      /* ★ 걸음은 코어 하나뿐이다(과제 #61 → 정식 배포) — 여태는 렌더러가 제 길찾기·
         속도표·대기점으로 자취를 하나 더 만들어 두고 그리기 직전에 코어 자리로
         덮어썼다. 둘이 나란히 돌면 **표적 지도가 덮어쓰기 전 자리를 본다**: 몸은
         코어가 낸 데 서 있는데 겨눠지는 자리는 렌더러 어림이라, 총알이 딴 데로 갔다.
         이제 코어 자취가 없으면 그 개체는 **안 그린다** — 대역으로 비슷한 것을
         지어내면 코어가 못 낸 개체가 있다는 사실이 화면에서 사라진다. */
      const simTr0 = simTracks?.get(e.t);
      if (!simTr0 || simTr0.keys.length < 5) continue;
      const ks = simTr0.keys;
      const wk: [number, number, number][] = new Array(Math.floor(ks.length / 5));
      for (let q = 0, w2 = 0; q + 4 < ks.length; q += 5, w2 += 1) {
        wk[w2] = [ks[q], ks[q + 1], ks[q + 2]];
      }
      /* 상태(전수조사) — 시전 순간 그 자리에 있었으면 걸린다. 적이 건 것만(스태시스는
         아군 오폭도 언다). */
      const statuses: [number, number, string][] = [];
      for (const [cs5, cx9, cy9, tech5, craw5] of castsV2) {
        const cfg = STATUS_CASTS[tech5];
        if (!cfg) continue;
        if (!cfg.any && craw5 === raw) continue;
        const pp5 = posAt(wk, cs5);
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
        /* 프로토스는 소환하고 곧장 자유다 — 공사 내내 붙어 있는 건 테란 SCV뿐이고,
           그동안의 모습도 합성 건설 SCV가 대신 그린다.
           ★ 프로브는 **한 순간도 안 숨긴다**(수리: 건설한 프로브가 잠깐 안 보였다 나타남)
             — 소환 순간 1.6초를 숨겨 뒀는데, 그 자리를 채울 합성 일꾼이 프로토스에는
             없다(builderLeave는 SCV만 본다). 그래서 진짜로 아무것도 없는 1.6초의
             구멍이었다. 소환 연출은 소환구가 이미 말한다. */
        const warpOnly = e.k === "Probe";
        if (lastPosF === 2 && wk.length > 0 && !warpOnly) {
          /* 흡수 시각의 뜻은 '현장 도착'이다. 렌더러 자취에서는 마지막 점이 곧 도착이라
             그대로 썼는데, 코어 자취의 마지막 점은 그 몸의 **생애 끝**이다(공사 뒤에도
             계속 산다). 그래서 코어일 때는 마지막 건설 앵커 자리에 몸이 처음 닿은
             순간을 찾는다 — 못 닿으면 옛 규칙 그대로 마지막 점이다. */
          buildHideAt = wk[wk.length - 1][0];
          {
            let anc: [number, number, number] | null = null;
            for (let i = e.ev.length - 1; i >= 0; i -= 1) {
              const v3 = e.ev[i];
              if (v3[3] === 2 && v3[1] >= 0) { anc = [v3[0], v3[1], v3[2]]; break; }
            }
            if (anc) {
              for (const [ws, wx, wy] of wk) {
                if (ws < anc[0]) continue;
                if (Math.hypot(wx - anc[1], wy - anc[2]) <= 3.5) { buildHideAt = ws; break; }
              }
            }
          }
        }
        for (let i = 0; i < e.ev.length; i += 1) {
          const v2 = e.ev[i];
          if (v2[3] !== 2) continue;
          let end = Infinity;
          for (let j = i + 1; j < e.ev.length; j += 1) {
            if (e.ev[j][1] >= 0 && e.ev[j][0] > v2[0] + 1) { end = e.ev[j][0]; break; }
          }
          if (warpOnly) continue;   // 프로브는 안 숨긴다(위 주석)
          buildHides.push([v2[0], end]);
        }
      }
      out.push({
        raw, unit: e.k, b: e.b, d: e.d, tag: e.t, buildHideAt, buildHides, ups: pUps,
        /* 건설 앵커 자리(요청: 드론 변태도 고치 중앙에) — 흡수되기 직전 이 자리로
           걸어 들어가야 고치가 솟는 자리와 겹친다. */
        buildSites: e.ev.filter((v) => v[3] === 2 && v[1] >= 0)
          .map((v) => [v[0], v[1], v[2]] as [number, number, number]),
        atkAt: e.ev.filter((v) => v[3] === 7).map((v) => [v[0], v[4] ?? 0, v[1], v[2]] as [number, number, number, number]),
        sieges: e.ev.filter((v) => v[3] === 8 || v[3] === 9)
          .map((v) => [v[0], v[3] === 8 ? 1 : 0] as [number, number]),
        burrows: e.ev.filter((v) => v[3] === 18 || v[3] === 19)
          .map((v) => [v[0], v[3] === 18 ? 1 : 0] as [number, number]),
        fixes: e.ev.filter((v) => v[3] === 10).map((v) => v[0]),
        hp: e.hp ?? [],
        ic: e.ic ?? [],
        orders: e.ev.filter((v) => v[3] === 0 || v[3] === 7 || v[3] === 3).map((v) => v[0]),
        // 승선 구간 — 위 rideSpans(짝이 되는 하차까지)를 그대로 쓴다.
        rides: rideSpans,
        // 걸음은 늘 코어가 낸 자취다 — 렌더러가 따로 어림하는 갈래는 없앴다.
        walk: wk,
        statuses,
        cloaks,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entData, terrain, terrainRaw, grid.width, grid.height, upsByRaw, simTracks]);
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
  type FoeRow = {
    team: number; x: number; y: number; air: boolean; bld?: boolean; k?: string;
    /** 유닛 행일 때의 원작 유닛 이름 — 방어 건물이 공중 표적을 겨눌 때 그 표적의 제
     *  크기를 알아야 조준 높이가 맞는다. `k`는 **건물 행에만** 실리므로(방어 건물
     *  갈래) 공중 갈래에서는 언제나 undefined였다 — 그 자리를 이 필드가 채운다. */
    uk?: string;
    /** 은신·버로우로 '안 보이는' 표적(요청) — 디텍터가 있는 편에게만 표적이 된다. */
    hidden?: boolean;
    /** 떠 있는 건물(요청: 띄운 건물은 공중 유닛이다) — 대공 무기를 지닌 쪽만 친다. */
    lifted?: boolean;
  };
  /* (걷어냄) 띄운 건물의 비행 보간 afloatPosAt — 재료였던 v1 비행 클릭 자취(fpts)가
     요약 폐지로 사라진 뒤 늘 출발 자리를 그대로 돌려주고 있었다. 개체 트랙은 이·착륙을
     **자리마다 한 줄**로 나눠 싣는다(buildsV2: ev 2·5마다 새 줄) — 뜨기 전 자리와 내린
     자리는 각각 제 줄이 정확히 안다. 잃은 것은 그 사이를 잇는 비행 애니메이션뿐이고,
     그것은 이미 나오지 않고 있었다. */
  const engageFoes: FoeRow[] = [];
  /** 아비터 은신장(전수조사) — 같은 사람 유닛이 곁(4.5타일)에 있으면 흐려진다. */
  const arbiterSpots: { raw: string; x: number; y: number }[] = [];
  /** 디텍터 명단 — 적 디텍터가 곁(9타일)이면 은신이 벗겨진다. */
  const detectorSpots: { team: number; x: number; y: number }[] = [];
  /* v2 개체의 지금 위치(태그별) — 어택이 찍은 '그 대상'을 겨누는 지도(지적). */
  const entPosByTag = new Map<number, FoeRow>();
  /** 은신 판정을 뒤로 미루려고 잡아 두는 짝 — 아비터·디텍터 명단이 다 찬 뒤에 매긴다. */
  const foeEnts: { row: FoeRow; e: (typeof entWalks)[number]; q: TrackPos }[] = [];
  {
    /* 교전 상대 목록은 개체 위치로 채운다(지적: 유닛-건물 상호작용·어택땅 교전) —
       적의 방어 건물(성큰·캐논·터렛·벙커)도 상대다: 행군하던 유닛이 그 곁에서 멈춰
       싸우고, 터렛·벙커 발사도 이 목록으로 겨눈다. */
    for (const e of entWalks) {
      if (e.walk.length === 0 || t < e.walk[0][0]) continue;
      if (e.d !== null && t >= e.d) continue;
      /* 유령 상대 제거(지적: 주변에 공격할 게 없는데 공격 모션) — 화면 규칙으로 이미
         죽었거나(체력 0 조기 사망) 숨은(수송 탑승·건설 흡수) 개체가 목록에 남아, 곁
         유닛이 빈 땅에 대고 계속 쐈다. 표시와 같은 잣대로 거른다. */
      // 죽음의 주인은 하나다(과제 #69) — 체력 0은 이제 d에서만 나온다.
      const dieAt0 = e.d;
      if (dieAt0 !== null && t >= dieAt0) continue;
      if (e.rides.some(([ra0, rb0]) => t >= ra0 + 1 && t < rb0)) continue;
      if (e.buildHides.some(([ba0, bb0]) => t >= ba0 && t < bb0)) continue;
      const q = posAt(e.walk, t);
      if (!q) continue;
      const row: FoeRow = {
        team: teamOfRaw(e.raw) ?? 0, x: q.x, y: q.y,
        air: e.unit !== "" && isAirUnit(e.unit),
        uk: e.unit !== "" ? e.unit : undefined,
      };
      engageFoes.push(row);
      foeEnts.push({ row, e, q });
      if (e.tag > 0) entPosByTag.set(e.tag, row);
      // 아비터 은신장·디텍터(전수조사) — 이번 프레임 위치를 명단에 올린다.
      if (e.unit === "Arbiter") arbiterSpots.push({ raw: e.raw, x: q.x, y: q.y });
      if (DETECTOR_UNITS.has(e.unit)) detectorSpots.push({ team: row.team, x: q.x, y: q.y });
    }
    for (let bi = 0; bi < buildsSrc.length; bi += 1) {
      const [bs, bx2, by2, bu, br, bg] = buildsSrc[bi];
      if (!["Sunken Colony", "Spore Colony", "Photon Cannon", "Missile Turret", "Bunker"].includes(bu)) continue;
      /* 다 지어져야 쏜다 — 테란 벙커·터렛은 공사가 멈춰 선 동안 완성이 미뤄진다
         (bldWork, 테란 건설 중단). 나머지는 종전대로 착공 + 표의 건설 시간. */
      if (t < (bldWork.get(bi)?.doneAt ?? bs + (BUILD_SEC[bu] ?? 30))) continue;
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
    /* 띄운 건물은 공중 유닛이다(요청) — 이륙한 순간부터 지상 무기가 못 닿고 대공이 친다.
       여태 건물은 예외 없이 air:false라, 떠 있는 커맨드 센터를 질럿이 겨누고 정작
       스포어·미사일 터렛은 못 겨눴다. 자리도 마지막 착륙 지점이 아니라 지금 나는 자리다. */
    for (const brow of buildsSrc) {
      const [, bx3, by3, bu2, br2, bg2, bl2] = brow;
      if (bl2 === undefined || t < bl2) continue;
      if ((bg2 ?? 0) > 0 && t >= (bg2 ?? 0)) continue;
      engageFoes.push({
        team: teamOfRaw(br2) ?? 0,
        x: bx3 + footDx(bu2), y: by3 + footDy(bu2),
        air: true, bld: true, k: bu2, lifted: true,
      });
    }
    /* 일반 건물도 표적 지도에(지적: 질럿이 해처리에 안 붙음) — engageFoes(교전 유발)엔
       안 넣는다: 건물이 보인다고 싸움이 시작되면 안 되고, 어택이 그 태그를 찍었을 때만
       겨눔·접근의 표적이 된다. 유닛 태그와 겹치면 유닛이 우선(위에서 이미 set). */
    for (const bt of bldTagSpots.rows) {
      if (t < bt.born + 2 || (bt.gone > 0 && t >= bt.gone)) continue;
      if (entPosByTag.has(bt.tag)) continue;
      // 뜬 건물은 공중 표적이다 — 자리는 제 줄이 아는 그 자리다(비행 보간은 걷었다).
      const afloat9 = bt.lift !== undefined && t >= bt.lift;
      entPosByTag.set(bt.tag, {
        x: bt.x, y: bt.y,
        team: teamOfRaw(bt.raw) ?? 0, air: afloat9, bld: true, k: bt.k,
        ...(afloat9 ? { lifted: true } : {}),
      });
    }
    // 스캐너 스윕(전수조사) — 12초 동안 그 자리가 디텍터다.
    for (const [cs6, cx10, cy10, tech6, craw6] of castsSrc) {
      if (tech6 !== "Scanner Sweep" || t < cs6 || t - cs6 > SCAN_DETECT_SEC) continue;
      detectorSpots.push({ team: teamOfRaw(craw6) ?? 0, x: cx10, y: cy10 });
    }
    /* 안 보이는 것은 표적이 아니다(요청: 클로킹·아비터 은신장·버로우한 러커를 그냥
       공격하는 일이 없게) — 개인 클록(f=14/15)·상시 은신(다크·옵저버)·아비터 은신장
       ·버로우한 러커에 '은신' 딱지를 붙인다. 아래 nearestFoe와 어택 표적 고르기가
       디텍터 없는 편에게서 이들을 감춘다. 아비터·디텍터 명단이 다 찬 뒤라야 옳게
       매겨지므로 목록을 다 채우고 여기서 한 번에 훑는다(표시 투명도와 같은 잣대). */
    for (const { row, e, q } of foeEnts) {
      const cloaked9 = e.cloaks.some(([ca9, cb9]) => t >= ca9 && t < cb9)
        || e.unit === "Dark Templar" || e.unit === "Observer"
        || (e.unit !== "Arbiter" && arbiterSpots.some((asp) =>
          asp.raw === e.raw && Math.hypot(asp.x - q.x, asp.y - q.y) <= 4.5));
      // 버로우(요청) — 화면의 버로우 판정과 같은 자, 곧 커맨드 증거다.
      const burrowed9 = BURROWABLE.has(e.unit) && burrowStartOf(e.burrows, t) >= 0;
      if (cloaked9 || burrowed9) row.hidden = true;
    }
  }
  /** 그 편이 이 자리를 탐지하고 있나 — 디텍터(오버로드·옵저버·베슬·터렛·스포어·캐논
   *  ·스캔)가 9타일 안이면 참. 은신·버로우 표적은 이것이 참이어야 겨눌 수 있다. */
  const detectedBy = (team: number | undefined, x: number, y: number): boolean =>
    !!team && detectorSpots.some((dsp) => dsp.team === team
      && Math.hypot(dsp.x - x, dsp.y - y) <= DETECT_TILES);
  /* ── 지형 시야 가림(요청) — 언덕 위·벽 너머는 안 보인다. 두 자리 사이를 곧은 줄로
     이어 지형 격자를 훑고, 못 걷는 칸이 걸리면 시야가 없다: 그 적은 없는 셈 친다.
     단 '그 지역에 아군 공중유닛이나 건물이 있으면' 가림을 무시한다 — 원작에서 시야는
     편끼리 나누므로, 언덕 위에 아군 오버로드가 떠 있거나 곁에 아군 건물이 서 있으면
     그들이 대신 보고 있는 것이다.
     격자는 실틈을 조이기 전의 원본(terrainRaw)을 쓴다 — 조인 판은 길목까지 막아, 시야
     로는 없는 벽을 세운다. 칸 하나짜리 잡음에 안 넘어가게 못 걷는 칸이 잇달아 둘일
     때만 벽으로 친다. */
  const losSeers: { team: number; x: number; y: number }[] = [];
  if (terrainRaw) {
    for (const f of engageFoes) if (f.air && f.team > 0) losSeers.push({ team: f.team, x: f.x, y: f.y });
    for (const [bs9, bx9, by9, bu9, br9, bg9] of buildsSrc) {
      if (bs9 > t || ((bg9 ?? 0) > 0 && t >= (bg9 ?? 0))) continue;
      const bteam9 = teamOfRaw(br9) ?? 0;
      if (bteam9 > 0) losSeers.push({ team: bteam9, x: bx9 + footDx(bu9), y: by9 + footDy(bu9) });
    }
  }
  const losCache = new Map<string, boolean>();
  const sightBlocked = (
    team: number | undefined, ax: number, ay: number, bx: number, by: number,
  ): boolean => {
    const g9 = terrainRaw;
    if (!g9 || !team) return false;
    const key = `${team}|${Math.round(ax)},${Math.round(ay)}|${Math.round(bx)},${Math.round(by)}`;
    const had = losCache.get(key);
    if (had !== undefined) return had;
    const x0 = (ax / grid.width) * g9.w;
    const y0 = (ay / grid.height) * g9.h;
    const x1 = (bx / grid.width) * g9.w;
    const y1 = (by / grid.height) * g9.h;
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    let blocked = false;
    let run = 0;
    // 끝 칸은 뺀다 — 유닛이 선 칸 자체가 격자 해상도 탓에 벽으로 찍혀 있을 수 있다.
    for (let i = 1; i < steps; i += 1) {
      const cx = Math.floor(x0 + ((x1 - x0) * i) / steps);
      const cy = Math.floor(y0 + ((y1 - y0) * i) / steps);
      if (cx < 0 || cy < 0 || cx >= g9.w || cy >= g9.h) continue;
      if (g9.walk[cy * g9.w + cx]) { run = 0; continue; }
      run += 1;
      if (run >= 2) { blocked = true; break; }
    }
    // 아군의 눈(공중유닛·건물)이 그 지역에 있으면 가림을 무시한다(요청).
    if (blocked) {
      blocked = !losSeers.some((s9) => s9.team === team
        && Math.hypot(s9.x - bx, s9.y - by) <= ENGAGE_SIGHT_TILES);
    }
    losCache.set(key, blocked);
    return blocked;
  };
  /* only(요청: 포톤·성큰·스포어가 사거리 안 대상을 안 친다) — 대공 전용(스포어)·대지
     전용(성큰)은 못 치는 갈래를 아예 안 본다. 안 주면 종전대로 아무나 가장 가까운 적. */
  const nearestFoe = (
    team: number | undefined, x: number, y: number, only?: "air" | "ground",
    /** 대공 무기가 없는 유닛인가 — 그렇다면 떠 있는 건물은 아예 표적이 아니다(요청). */
    groundOnly?: boolean,
  ) => {
    let bx = 0;
    let by = 0;
    let bd = Infinity;
    let bAir = false;
    let bBld: boolean | undefined;
    let bK: string | undefined;
    /** 고른 표적이 유닛이면 그 원작 이름 — 방어 건물의 공중 조준 높이가 이것을 쓴다. */
    let bUk: string | undefined;
    for (const f of engageFoes) {
      /* 팀 미상(0)은 상대가 아니다(지적: 자기 유닛을 왜 공격해) — 로스터와 리플레이
         이름이 안 맞아 팀을 못 찾은 마커를 적으로 치면 제 편끼리 쏘는 그림이 된다. */
      if (!team || f.team === 0 || f.team === team) continue;
      if (only === "air" && !f.air) continue;
      if (only === "ground" && f.air) continue;
      // 뜬 건물은 공중이라 대공만 친다 — 지상 무기밖에 없는 유닛에게는 없는 것과 같다.
      if (groundOnly && f.lifted) continue;
      // 안 보이는 것은 못 친다(요청) — 은신·버로우는 디텍터가 있어야 표적이 된다.
      if (f.hidden && !detectedBy(team, f.x, f.y)) continue;
      const d = Math.hypot(f.x - x, f.y - y);
      if (d >= bd) continue;
      // 벽 너머는 못 본다(요청) — 가까워도 시야가 막혔으면 상대가 아니다.
      if (sightBlocked(team, x, y, f.x, f.y)) continue;
      bd = d; bx = f.x; by = f.y; bAir = f.air; bBld = f.bld; bK = f.k; bUk = f.uk;
    }
    return { bx, by, bd, air: bAir, bld: bBld, k: bK, uk: bUk };
  };
  /* 정찰 자취도 걸어서 가고(지적: 갑자기 이동 — 직선이되 일꾼 걸음), 갈래·부대로 갈라
     각자의 점이 된다(지적: 드랍십 순간이동 — 일꾼 정찰과 셔틀 원정이 한 점을 놓고
     밀당했다). 갈래는 이름을 정한다(지적: 오버로드 이름이 안 나온다). */
  /* (걷어냄) 정찰 자취 한 벌 — 일꾼·수송선·단독 클릭의 자취(spts·tpts·opts)를 본진에서
     이어 걷게 하던 어림이다. 재료가 전부 v1 부대 트랙이었고, 요약 폐지 뒤로는 빈
     배열이라 아무것도 그리지 않았다. 지금은 개체 트랙(entWalks)이 정찰 유닛도 제 태그로
     걷게 하므로 따로 어림할 것이 없다. */
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
  /* 지도를 '남는 세로에 꽉 맞춘다'(지적: "세로 스크롤 안 만드는 건 좋은데 그건 세로
     높이에 맞추라는 얘기지 저렇게 작게 고정하라는 게 아녀" / "scr-motion-wide 높이를
     페이지 높이랑 맞게! 대신 가로 스크롤은 생길 수도 있겠지").
     앞서 100dvh에서 상수(278/320px)를 빼 봤는데, 그 상수는 페이지 머리와 지도 아래 줄들의
     높이를 어림한 값이라 화면·배치마다 틀렸고 대개 너무 크게 잡혀 지도가 작아졌다.
     이제는 잰다: 지도줄의 화면 위 여백과, 뿌리 상자 안에서 지도줄 아래에 있는 것들의
     높이를 그때그때 재고 남는 세로를 지도 비율로 되돌려 폭으로 준다. 가로가 넘치면
     가로 스크롤이 나는데, 그건 사용자가 받아들인 쪽이다.
     지도가 커지면 뿌리도 커지므로 되먹임이 생길 수 있어 4px보다 작은 변화는 무시한다. */
  useEffect(() => {
    const host = rootRef.current?.parentElement;
    if (!host || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setWide(host.clientWidth >= 860));
    ro.observe(host);
    return () => ro.disconnect();
  }, []);
  /* 맵 뷰어 크기는 고정이다(요청: "맵뷰어 크기는 1024*1024로 고정, 가로 세로 중 더 긴
     쪽을 맞추면 돼") — 화면 높이에 맞춰 폭을 되돌리던 자동 계산을 통째로 걷었다.
     그 계산은 넓은 배치에서 **한 번도 작동한 적이 없다**: 맵줄(.scr-motion-maprow)이
     display:contents라 상자를 안 만들고, 그런 요소의 getBoundingClientRect()는 전부 0을
     돌려준다. 그래서 남은 세로가 늘 음수로 나와 조기 반환됐고, PC의 맵 크기는 사실
     그리드의 minmax(0,1fr) 칸이 정하고 있었다.
     이제 긴 쪽을 1024에 맞춘다 — 정사각 맵이면 1024×1024, 가로가 긴 맵이면 폭이 1024다.
     좁은 화면(넓은 배치 아님)은 종전대로 폭 100%로 흐른다. */
  const MAP_VIEW_PX = 1024;
  const mapViewW = grid.width >= grid.height
    ? MAP_VIEW_PX : Math.round((MAP_VIEW_PX * grid.width) / grid.height);
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
  /* 확대 배율 — 더블클릭·더블탭이 이 값과 1배 사이만 오간다(중간 단계 없음).
     6 → 4로 낮췄다(요청: "더블클릭 시 확대비율을 좀 낮추기"). 6은 "게임 화면이 가로
     20타일쯤 보여 준다"에서 온 값인데, 실제로는 너무 깊이 들어가 주변 상황이 통째로
     화면 밖으로 나갔다. 4는 가로 32타일쯤을 보여 준다.
     덤으로 자리가 좋다: 맵 뷰어 1024px에 128타일 맵이면 한 타일이 8px이라, 4배에서
     한 타일이 정확히 32px — 원작의 타일 크기 그대로다. */
  const ZOOM_GAME = 4;
  /* 이어서 늘릴 때의 상한(요청: "재생 확대 최대 8배로 수정") — 휠·핀치처럼 배율이
     연속으로 움직이는 길이 여기까지 간다. 더블클릭·더블탭이 한 번에 뛰는 자리는
     ZOOM_GAME 그대로다(그건 앞서 6 → 4로 낮춰 달라던 값이라 건드리지 않는다).
     핀치 상한이 20이라 다른 길과 안 맞던 것도 여기로 모은다. */
  const ZOOM_MAX = 8;
  const [zoom, setZoom] = useState(1);
  /* 확대·축소 빗장(지적: 실기 진단 — 판정은 매번 '확대'로 떨어지는데 화면이 그대로다)
     — iOS 사파리는 더블탭에서 touchend와 함께 dblclick도 쏜다. 우리 더블탭이 확대해
     놓으면 곧이어 온 dblclick이 zoomRef가 이미 6인 걸 보고 도로 1로 되돌려, 두 번
     누를 때마다 확대→축소가 한 프레임 안에 겹쳐 아무 일도 없는 것처럼 보였다.
     갈래가 셋(더블클릭·터치·포인터)이라 400ms 안의 두 번째 발동은 무조건 무시한다. */
  const zoomAtRef = useRef(0);
  const zoomGate = (): boolean => {
    const t0 = performance.now();
    if (t0 - zoomAtRef.current < 450) return false;
    zoomAtRef.current = t0;
    return true;
  };
  /* 피칭 보기(요청) — 수직 부감 대신 약간 비스듬한 정면. 바닥(지형 그림과 마커 자리)만
     세로로 눌리고, 건물·유닛 도형은 제 크기로 서 있어 3D로 바닥에 붙는다. 눌림은
     컨테이너 세로비가 맡아서 %자리가 저절로 따라온다. 휠 확대·드래그 이동은 기존
     렌즈(zoom·pan) 그대로다. */
  const [pitched, setPitched] = useState(false);
  /** 정보 팝업으로 집어 둔 몸의 열쇠(요청) — null이면 닫힘. */
  const [picked, setPicked] = useState<string | null>(null);
  /** 이번 프레임에 그린 op — 클릭 판정과 팝업 내용이 여기서 지금 값을 읽는다. */
  const opsRef = useRef<UnitDrawOp[]>([]);
  // 유닛 크기 토글(요청) — 기본은 실제 크기, 누르면 2배.
  const [unitBig, setUnitBig] = useState(false);
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
    /* 휠 줌은 걷고 더블클릭 토글로(요청) — PC·모바일 모두 '두 번 눌러 확대/축소'
       한 가지 방법만 남긴다. 배율은 실제 게임에서 한 화면에 들어오는 몫(ZOOM_GAME)
       하나뿐이라, 중간 단계 없이 켜고 끈다. 누른 지점 아래의 지도 지점이 그 자리에
       남도록 팬을 함께 푼다. */
    const onDbl = (e: MouseEvent) => {
      e.preventDefault();
      if (!zoomGate()) return;
      const rect = el.getBoundingClientRect();
      if (zoomRef.current > 1.05) {
        setZoom(1);
        setPan({ x: 0, y: 0 });
        return;
      }
      const ox = rect.left + rect.width / 2;
      const oy = rect.top + rect.height / 2;
      const ux = (e.clientX - ox - panRef.current.x) / zoomRef.current;
      const uy = (e.clientY - oy - panRef.current.y) / zoomRef.current;
      const nx = e.clientX - ox - ZOOM_GAME * ux;
      const ny = e.clientY - oy - ZOOM_GAME * uy;
      const maxX = ((ZOOM_GAME - 1) * rect.width) / 2;
      const maxY = ((ZOOM_GAME - 1) * rect.height) / 2;
      setZoom(ZOOM_GAME);
      setPan({
        x: Math.min(maxX, Math.max(-maxX, nx)),
        y: Math.min(maxY, Math.max(-maxY, ny)),
      });
    };
    /* PC 휠 줌 복구(요청) — 없앴던 이유는 버벅임이었다. 원인은 배율 자체가 아니라
       '휠 한 틱마다 setState'였다: 휠은 초당 수십 번 오는데 그때마다 리액트가 마커
       수천 개를 통째로 다시 그렸다. 이제 손짓이 도는 동안은 리액트를 아예 안 건드린다 —
       렌즈 상자의 transform을 직접 써서 합성기(compositor)만 일하게 하고, 휠이 멎은
       뒤(140ms)에 딱 한 번 상태로 굳힌다. 그 사이 zoomRef·panRef는 지금 값을 들고
       있어 더블클릭·드래그 같은 다른 손짓도 어긋나지 않는다. */
    /* 수리(지적: 휠로 조금 한 번 확대되고 마는데다 지도 그림만 커져 맵을 벗어난다) —
       위 방식에 구멍이 둘 있었다.
       ① 재생 중에는 매 프레임 리렌더가 나는데, 렌더마다 하는 zoomRef.current = zoom
          대입이 휠이 방금 올린 배율을 곧바로 옛 상태로 되돌렸다(그래서 한 틱만 먹었다).
          손짓이 도는 동안에는 그 대입을 멈춘다(wheelingRef).
       ② 유닛 캔버스는 렌즈 밖이라 zoom·pan을 '그리기 좌표'로 받는다. 리액트가 굳기
          전까지 캔버스는 옛 배율 그대로여서, 지도 그림만 커지고 유닛은 제자리였다.
          손짓 동안에는 이미 그려진 캔버스를 같은 비율로 옮겨 두고(흐릿하지만 따라온다),
          굳은 뒤 아래 effect가 또렷하게 다시 그리며 그 변환을 걷는다. */
    let wheelTimer = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && Math.abs(e.deltaY) < 0.5) return;
      e.preventDefault();
      const lens = lensRef.current;
      if (!lens) return;
      const rect = el.getBoundingClientRect();
      if (!wheelingRef.current) {
        wheelingRef.current = true;
        wheelBaseRef.current = { z: zoomRef.current, x: panRef.current.x, y: panRef.current.y };
      }
      const z0 = zoomRef.current;
      /* 한 틱에 배율을 곱으로 바꾼다 — 더할 때보다 확대·축소가 대칭이고, 트랙패드의
         잔 델타에도 결이 고르다. 상한은 더블클릭과 같은 게임 화면 배율.
         델타 단위를 먼저 픽셀로 맞춘다(수리) — 브라우저·기기에 따라 휠은 줄(deltaMode 1,
         한 틱에 3쯤)이나 쪽(2)으로도 오는데, 그걸 픽셀로 알고 곱하면 한 틱이 0.5%라
         아무리 굴려도 배율이 안 움직인다. */
      const dy9 = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1);
      const step = Math.exp(-dy9 * 0.0016);
      const z1 = Math.min(ZOOM_MAX, Math.max(1, z0 * step));
      const ox = rect.left + rect.width / 2;
      const oy = rect.top + rect.height / 2;
      // 커서 아래의 지도 지점이 그 자리에 남도록 팬을 함께 푼다(더블클릭과 같은 자).
      const ux = (e.clientX - ox - panRef.current.x) / z0;
      const uy = (e.clientY - oy - panRef.current.y) / z0;
      const maxX = ((z1 - 1) * rect.width) / 2;
      const maxY = ((z1 - 1) * rect.height) / 2;
      const px = Math.min(maxX, Math.max(-maxX, e.clientX - ox - z1 * ux));
      const py = Math.min(maxY, Math.max(-maxY, e.clientY - oy - z1 * uy));
      zoomRef.current = z1;
      panRef.current = { x: px, y: py };
      lens.style.setProperty("--mz", `${z1}`);
      lens.style.transform = z1 > 1 ? `translate(${px}px, ${py}px) scale(${z1})` : "";
      /* 유닛 캔버스도 같이 따라온다(위 ②) — 이미 그려진 그림(손짓 시작 배율)을 지금
         배율로 옮기는 변환이다. 굳으면 아래 effect가 다시 그리며 이 변환을 지운다. */
      const cv9 = el.querySelector<HTMLCanvasElement>(".scr-motion-unitlayer");
      if (cv9) {
        const b9 = wheelBaseRef.current;
        const s9 = z1 / b9.z;
        cv9.style.transformOrigin = "center";
        cv9.style.transform =
          `translate(${(px - s9 * b9.x).toFixed(2)}px, ${(py - s9 * b9.y).toFixed(2)}px) scale(${s9.toFixed(4)})`;
      }
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => {
        wheelingRef.current = false;
        setZoom(zoomRef.current);
        setPan({ ...panRef.current });
      }, 140);
    };
    el.addEventListener("dblclick", onDbl);
    // passive:false 라야 브라우저의 페이지 스크롤을 막을 수 있다.
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("dblclick", onDbl);
      el.removeEventListener("wheel", onWheel);
      window.clearTimeout(wheelTimer);
    };
    // 확대창(포털 재부착)이 사라져 맵 엘리먼트는 안 바뀐다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* 팬 재죔(지적: 줌인아웃하다 맵을 벗어나면 문제) — 팬 한계는 '그때의 맵 상자'로
     계산되는데, 줌 단계·보기 전환(3D 피칭은 세로가 0.74로 눌린다)으로 상자가 변하면
     이미 서 있던 팬이 새 한계를 넘어 맵 가장자리 밖(빈 바탕)이 드러나고 마커가 맵을
     벗어나 그려졌다. 상자가 변할 때마다 팬을 새 한계 안으로 되죈다. */
  /* 맵 상자의 실제 CSS 폭 — 3D 과표본 배수와 원본 그림 승급 판단이 이 값을 쓴다.
     MAP_VIEW_PX(1024)는 넓은 배치의 상한일 뿐이고, 좁은 화면에서는 칸이 정한다. */
  const [mapPx, setMapPx] = useState(0);
  /** 지금 깔린 그림의 원본 한 변(px) — <img>의 naturalWidth다. 격자 개략도면 0. */
  const [imgSide, setImgSide] = useState(0);
  useEffect(() => {
    const el = mapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setMapPx(Math.round(el.getBoundingClientRect().width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  /* 원본 그림 승급(지적: "미니맵 배경이 화질이 너무 안좋아") — 목록으로 내려오는 그림은
     512px 작은 판이다. 이 화면이 실제로 크게 그릴 때, 곧 확대했거나 재생 중이면서 상자가
     화면 픽셀로 560을 넘을 때만 원본(2048px)을 그 한 장 다시 받는다.
     해시마다 한 번만 조르는 것은 훅 안에서 막는다 — 승급이 캐시에 새 객체를 심고 그것이
     이 컴포넌트를 리렌더하므로, 여기서 막으려 들면 무한 루프가 된다. */
  useEffect(() => {
    if (!grid.image) return;
    const dpr = typeof window === "undefined" ? 1 : (window.devicePixelRatio || 1);
    if (zoom <= 1 && !(playing && mapPx * dpr >= 560)) return;
    void promoteReplayMap(grid.hash);
  }, [grid.image, grid.hash, zoom, playing, mapPx]);
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
  /** 렌즈 상자 — 휠 줌이 리액트를 거치지 않고 직접 변환을 쓰는 자리(위 onWheel 주석). */
  const lensRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  /** 휠 손짓이 도는 중인가 — 도는 동안은 상태로 덮지 않는다(위 onWheel ① 주석). */
  const wheelingRef = useRef(false);
  /** 손짓 시작 시점의 배율·팬 — 캔버스는 그때 그려진 그림이라 그 기준으로 옮긴다. */
  const wheelBaseRef = useRef({ z: 1, x: 0, y: 0 });
  if (!wheelingRef.current) {
    zoomRef.current = zoom;
    panRef.current = pan;
  }
  /* 렌즈 변환은 리액트 스타일이 아니라 이 effect가 쓴다(위 렌즈 상자 주석) — 손짓
     동안의 직접 변환과 싸우지 않게. 캔버스에 걸어 뒀던 임시 변환도 여기서 걷는다:
     자식(UnitLayer)의 그리기 effect가 먼저 돌아, 이 시점엔 이미 새 배율로 또렷하다. */
  useEffect(() => {
    const lens = lensRef.current;
    if (lens) {
      lens.style.transform = zoom > 1
        ? `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` : "";
    }
    const cv = mapRef.current?.querySelector<HTMLCanvasElement>(".scr-motion-unitlayer");
    if (cv) cv.style.transform = "";
  }, [zoom, pan]);
  useEffect(() => {
    /* 리스너는 전부 문서에 단다(재지적) — 맵은 데이터가 온 뒤에 그려지기도 해서, 마운트
       순간 mapRef가 비어 있으면 맵에 걸려던 리스너가 영영 안 달린다. 그러면 더블탭도
       핀치도 이벤트 자체를 못 받는다. 맵 상자는 이벤트마다 mapRef로 다시 읽으므로
       나중에 생겨도 그대로 동작한다. */
    let pinch: { d: number; z: number; cx: number; cy: number; px: number; py: number } | null = null;
    let pinchPend: { z: number; p: { x: number; y: number } } | null = null;
    let pinchRaf = 0;
    /* 더블탭 확대·축소(요청: 모바일에서 더블클릭류) — 한 손가락 탭 두 번이면 탭 지점
       중심으로 확대, 이미 확대 중이면 원래대로.
       판정 폭(지적: 모바일에서 더블탭이 안 됨) — 실기로 재보니 320ms·36px·끌림 10px은
       손가락에 너무 빡빡했다. 두 번째 탭이 조금만 늦거나(브라우저 더블클릭 기준도
       500ms다) 손가락이 10px만 굴러도 탭이 아니라고 버렸다. 520ms·56px·끌림 18px로
       넓힌다. 시각은 이벤트의 timeStamp를 쓴다 — 재생 렌더가 프레임을 오래 잡으면
       핸들러가 늦게 돌아, 손은 빨랐는데 performance.now() 간격만 길어졌다. */
    /* 520 → 650ms(재지적: 아직도 안 됨) — 손을 뗀 순간부터 재므로 첫 탭을 오래 누르면
       그만큼 간격이 는다. 지도엔 한 번 탭으로 하는 일이 없어 넓혀도 잃을 게 없다. */
    const TAP_MS = 650;
    /* 두 탭 거리 56 → 110px, 한 탭 안 끌림 26 → 60px(재지적: 두 탭 위치가 달라서
       그런 것 같다) — 엄지로 작은 지도를 두 번 두드리면 두 자리가 쉽게 반 뼘씩
       어긋나고, 손가락도 그만큼 구른다. 지도엔 한 번 탭으로 하는 일이 없으니 넓게
       잡아도 잃을 게 없다. 진짜 끌기는 아래 '오래 눌렀나'로 갈라낸다. */
    const TAP_GAP = 110;
    const TAP_MOVE = 60;
    // 오래 누르면 탭이 아니라 끌기다 — 눌린 시간으로 한 번 더 거른다.
    const TAP_HOLD_MS = 600;
    const evTime = (e: TouchEvent): number => (e.timeStamp > 0 ? e.timeStamp : performance.now());
    /* 실기 진단(요청 대응) — 주소에 ?dbg=tap을 붙이면 왼쪽 아래에 마지막 탭들의 숫자가
       뜬다. 에뮬레이터에서는 다 되는데 실기에서만 안 되는 상황이라, 실제 기기에서 어떤
       값이 나오는지 봐야 다음 수를 둘 수 있다. 평소에는 만들지도 않는다. */
    const dbgOn = typeof location !== "undefined" && /[?&]dbg=tap/.test(location.search);
    let dbgEl: HTMLDivElement | null = null;
    if (dbgOn) {
      dbgEl = document.createElement("div");
      dbgEl.style.cssText = "position:fixed;left:6px;bottom:6px;z-index:99999;background:rgba(0,0,0,.78);"
        + "color:#fff;font:11px/1.35 monospace;padding:6px 8px;border-radius:6px;white-space:pre;pointer-events:none";
      dbgEl.textContent = "탭 진단 대기";
      document.body.appendChild(dbgEl);
    }
    const dbg = (m: string): void => {
      if (!dbgEl) return;
      dbgEl.textContent = [m, ...(dbgEl.textContent ?? "").split("\n")].slice(0, 7).join("\n");
    };
    let tap: { t: number; x: number; y: number } | null = null;
    let tapStart: { x: number; y: number; moved: boolean; t: number } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    /** 두 손가락의 가운데가 지도 안인가 — 지도 밖에서 시작한 손짓은 페이지 몫이다. */
    const twoInMap = (e: TouchEvent): boolean => e.touches.length === 2
      && inMap((e.touches[0].clientX + e.touches[1].clientX) / 2,
        (e.touches[0].clientY + e.touches[1].clientY) / 2);
    const onTS = (e: TouchEvent) => {
      /* 두 손가락이면 핀치 줌이다(지적: 모바일 핀치줌이 안 된다).
         한동안 "확대는 더블탭 하나"로 두면서 이 자리가 pinch를 **세우지 않고 지우기만**
         했다. 아래 onTM의 셈(배율 잡기·손가락 가운데 고정)은 그대로 살아 있었는데 시작
         점이 없어 통째로 죽은 코드였다 — 그래서 두 손가락을 벌려도 아무 일도 안 났다. */
      if (!twoInMap(e)) return;
      const el2 = mapRef.current;
      if (!el2) return;
      if (e.cancelable) e.preventDefault();
      pinch = {
        d: Math.max(1, dist(e.touches)),
        z: zoomRef.current,
        cx: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        cy: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        px: panRef.current.x,
        py: panRef.current.y,
      };
      gestureRef.current = true;
    };
    const onTM = (e: TouchEvent) => {
      const el2 = mapRef.current;
      const t1 = e.touches[0];
      /* 지도 안에서 난 손짓만 우리 몫이다 — 문서에서 받으므로(아래 등록 주석) 좌표로
         가른다. 지도 밖의 스크롤·확대는 브라우저에 그대로 넘긴다. */
      const inside = !!t1 && inMap(t1.clientX, t1.clientY);
      gestureRef.current = e.touches.length >= 2 && inside;
      /* 삼키는 건 지도 조작일 때만(재재지적: 모바일에서 아래로 스와이프가 안 됨) —
         무조건 preventDefault가 확대 안 한 한 손가락 스와이프(페이지 스크롤)까지
         막았다. 두 손가락(핀치)이거나 확대 중(드래그 팬)일 때만 기본 동작을 끊고,
         평상시 한 손가락은 페이지 스크롤로 흘려보낸다. */
      if (inside && (e.touches.length >= 2 || zoomRef.current > 1)) {
        if (e.cancelable) e.preventDefault();
      }
      if (!pinch || e.touches.length !== 2 || !el2) return;
      const r = el2.getBoundingClientRect();
      const ox = r.left + r.width / 2;
      const oy = r.top + r.height / 2;
      // 상한 12 → 20(재요청: 더 높게) — 그 위는 선명도가 배킹 한계(4096px)에 막혀 무의미하다.
      const z = Math.min(ZOOM_MAX, Math.max(1, (pinch.z * dist(e.touches)) / pinch.d));
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
    };
    /* 더블탭 판정은 문서에서 자리로 한다(재지적: 모바일 더블탭 안 됨) — 맵에 건 리스너는
       손가락이 닿은 그 노드가 사라지면 touchend를 못 받는다. 재생 중엔 마커·오버레이가
       프레임마다 다시 그려져, 첫 탭과 둘째 탭 사이에 노드가 바뀌면 이벤트가 통째로
       빠졌다. 문서에서 받아 맵 상자 안인지 좌표로 따지면 어느 자식을 눌렀든 똑같이 센다.
       맵 상자는 그때그때 mapRef로 다시 읽는다(재지적) — 마운트 때 잡아 둔 el을 쓰면
       레이아웃이 바뀌며 맵 엘리먼트가 갈릴 때 낡은 상자로 재게 되고, 그러면 모든 탭이
       "맵 밖"으로 떨어져 더블탭이 통째로 죽는다. */
    const mapBox = (): DOMRect | null => {
      const m = mapRef.current;
      if (!m) return null;
      const r = m.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? r : null;
    };
    const inMap = (x: number, y: number): boolean => {
      const r = mapBox();
      return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };
    const onDocTS = (e: TouchEvent) => {
      if (e.touches.length !== 1) { tapStart = null; tap = null; return; }
      const t0 = e.touches[0];
      tapStart = inMap(t0.clientX, t0.clientY)
        ? { x: t0.clientX, y: t0.clientY, moved: false, t: evTime(e) } : null;
    };
    const onDocTM = (e: TouchEvent) => {
      // 크게 끌렸으면 탭이 아니다 — 그 아래는 손가락 굴림으로 본다.
      if (!tapStart || e.touches.length !== 1) return;
      const t0 = e.touches[0];
      if (Math.hypot(t0.clientX - tapStart.x, t0.clientY - tapStart.y) > TAP_MOVE) tapStart.moved = true;
    };
    // 확대·복귀 한 번 — 위 zoomGate가 갈래 셋(더블클릭·터치·포인터)을 한 번으로 묶는다.
    const fireDouble = (cx0: number, cy0: number): boolean => {
      if (!zoomGate()) return false;
      dbg(zoomRef.current > 1.05 ? "→ 축소" : "→ 확대");
      if (zoomRef.current > 1.05) {
        setZoom(1);
        setPan({ x: 0, y: 0 });
        return true;
      }
      const r2 = mapBox();
      if (!r2) return true;
      const ox2 = r2.left + r2.width / 2;
      const oy2 = r2.top + r2.height / 2;
      const z2 = ZOOM_GAME;
      // 핀치와 같은 수식 — 탭한 지점 아래의 지도 지점이 그 자리에 남는다.
      const ux2 = (cx0 - ox2 - panRef.current.x) / zoomRef.current;
      const uy2 = (cy0 - oy2 - panRef.current.y) / zoomRef.current;
      setZoom(z2);
      setPan({ x: cx0 - ox2 - z2 * ux2, y: cy0 - oy2 - z2 * uy2 });
      return true;
    };
    const onDocTE = (e: TouchEvent) => {
      if (e.touches.length !== 0 || !tapStart || e.changedTouches.length !== 1) {
        if (e.touches.length === 0) tapStart = null;
        return;
      }
      const ct = e.changedTouches[0];
      const now = evTime(e);
      const held = Math.round(now - tapStart.t);
      const ok = !tapStart.moved && now - tapStart.t < TAP_HOLD_MS
        && inMap(ct.clientX, ct.clientY);
      tapStart = null;
      const gap = tap ? Math.round(Math.hypot(ct.clientX - tap.x, ct.clientY - tap.y)) : -1;
      const wait = tap ? Math.round(now - tap.t) : -1;
      dbg(`T 누름${held}ms 끌림${ok ? "N" : "Y/밖"} 간격${wait}ms 거리${gap}px`);
      if (!ok) { tap = null; return; }
      if (tap && now - tap.t < TAP_MS && Math.hypot(ct.clientX - tap.x, ct.clientY - tap.y) < TAP_GAP) {
        // 두 번째 탭 — 브라우저 더블탭 페이지 확대를 끊고 지도만 확대·복귀한다.
        if (e.cancelable) e.preventDefault();
        tap = null;
        fireDouble(ct.clientX, ct.clientY);
        return;
      }
      tap = { t: now, x: ct.clientX, y: ct.clientY };
    };
    /* 포인터로도 같은 판정을 한다(재지적: 모바일 더블탭 안 됨) — 인앱 웹뷰나 기기에
       따라 touch 갈래가 통째로 안 오는 경우가 있다. 포인터 이벤트는 어디서나 오므로
       같은 자를 하나 더 대 둔다. 둘 다 맞으면 위 빗장이 한 번만 듣게 막는다. */
    let pStart: { x: number; y: number; moved: boolean; t: number } | null = null;
    let pTap: { t: number; x: number; y: number } | null = null;
    const onPD = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      pStart = inMap(e.clientX, e.clientY)
        ? { x: e.clientX, y: e.clientY, moved: false, t: e.timeStamp } : null;
    };
    const onPM = (e: PointerEvent) => {
      if (!pStart || e.pointerType !== "touch") return;
      if (Math.hypot(e.clientX - pStart.x, e.clientY - pStart.y) > TAP_MOVE) pStart.moved = true;
    };
    const onPU = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      const st = pStart;
      pStart = null;
      const now = e.timeStamp > 0 ? e.timeStamp : performance.now();
      if (!st || st.moved || now - st.t > TAP_HOLD_MS || !inMap(e.clientX, e.clientY)) {
        pTap = null;
        return;
      }
      const pg = pTap ? Math.round(Math.hypot(e.clientX - pTap.x, e.clientY - pTap.y)) : -1;
      dbg(`P 간격${pTap ? Math.round(now - pTap.t) : -1}ms 거리${pg}px`);
      if (pTap && now - pTap.t < TAP_MS
        && Math.hypot(e.clientX - pTap.x, e.clientY - pTap.y) < TAP_GAP) {
        pTap = null;
        dbg(fireDouble(e.clientX, e.clientY) ? "P 더블탭 발동" : "P 빗장에 막힘");
        return;
      }
      pTap = { t: now, x: e.clientX, y: e.clientY };
    };
    /* 핀치도 문서에서 받는다(지적: 모바일 핀치줌이 안 된다) — 더블탭이 이미 같은 이유로
       문서로 옮겨 와 있다: 맵은 자료가 온 뒤에 그려지기도 해서 마운트 순간 mapRef가
       비어 있으면 el에 건 리스너가 **영영 안 달렸다**. 그러면 핀치는 코드가 멀쩡해도
       이벤트 자체를 못 받는다. 지도 안인지는 좌표(inMap)로 가린다. */
    /* 사파리의 손짓 이벤트도 막는다 — 아이폰은 touch-action과 별개로 gesturestart로
       페이지 확대를 시작한다. 지도 위에서만 끊고 그 밖은 그대로 둔다. */
    const onGesture = (e: Event) => {
      const g = e as Event & { clientX?: number; clientY?: number };
      if (g.clientX === undefined || g.clientY === undefined) return;
      if (!inMap(g.clientX, g.clientY)) return;
      if (e.cancelable) e.preventDefault();
    };
    document.addEventListener("gesturestart", onGesture, { passive: false });
    document.addEventListener("gesturechange", onGesture, { passive: false });
    document.addEventListener("touchstart", onTS, { passive: false });
    document.addEventListener("touchmove", onTM, { passive: false });
    document.addEventListener("touchend", onTE);
    document.addEventListener("touchcancel", onTE);
    document.addEventListener("touchstart", onDocTS, { passive: true });
    document.addEventListener("touchmove", onDocTM, { passive: true });
    /* 문서 touchend는 수동 등록 아님(passive: false) — 두 번째 탭에서 브라우저 제
       더블탭 확대를 끊어야 하는데, 수동 등록이면 preventDefault가 무시된다. */
    document.addEventListener("touchend", onDocTE, { passive: false });
    document.addEventListener("touchcancel", onDocTE, { passive: true });
    document.addEventListener("pointerdown", onPD, { passive: true });
    document.addEventListener("pointermove", onPM, { passive: true });
    document.addEventListener("pointerup", onPU, { passive: true });
    document.addEventListener("pointercancel", onPU, { passive: true });
    return () => {
      if (pinchRaf) cancelAnimationFrame(pinchRaf);
      document.removeEventListener("gesturestart", onGesture);
      document.removeEventListener("gesturechange", onGesture);
      document.removeEventListener("touchstart", onTS);
      document.removeEventListener("touchmove", onTM);
      document.removeEventListener("touchend", onTE);
      document.removeEventListener("touchcancel", onTE);
      document.removeEventListener("touchstart", onDocTS);
      document.removeEventListener("touchmove", onDocTM);
      document.removeEventListener("touchend", onDocTE);
      document.removeEventListener("touchcancel", onDocTE);
      document.removeEventListener("pointerdown", onPD);
      document.removeEventListener("pointermove", onPM);
      document.removeEventListener("pointerup", onPU);
      document.removeEventListener("pointercancel", onPU);
      dbgEl?.remove();
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
  /* 바닥이 상자의 절반밖에 안 찼다(지적: "3D에서 왜 아래쪽 공간을 남기는거야 굳이").
     **상자는 한 픽셀도 안 건드린다**(재지적: "여백은 있어도 되는데 틀 자체가 좁아지면
     안 돼") — 앞서 상자 비율을 바꿨다가 폭이 그리드 칸에 고정된 탓에 세로만 285px
     늘어나 탐색바 아래가 통째로 밀렸다. 이번엔 상자 밖은 손대지 않고 바닥만 키운다.

     원인은 둘이었다.
     ① 회전 전 판이 상자와 같은 세로였다. 45도 회전이 세로를 cos45(0.707)배로 줄이므로
        바닥은 애초에 상자를 못 채운다. 판을 미리 1/cos45배 늘려 두면 회전 뒤에 상자
        세로가 된다.
     ② 원근 거리가 520px 고정이었다. 상자가 커질수록 원근이 상대적으로 세지고, 세질수록
        맞춤 축소(q)가 더 깎는다 — 실측: 상자 폭 360에서 바닥이 60%를 채우는데 1097에서는
        46%뿐이고, 원근 세기도 1.44배에서 3.46배로 제멋대로였다. 같은 경기가 기기마다
        다른 각도로 보였다는 뜻이다. 거리를 상자 세로에 비례시키면 둘 다 고정된다.
     고친 뒤 실측: 어느 크기에서든 바닥 채움 76% · 원근 1.91배.

     덤으로 이미 있던 불일치도 사라진다 — 그림자·트레이서는 바닥 눌림을 0.74로 알고
     그리는데(상자 비율 1/0.74가 그 값을 노린 것이다) 실제 바닥은 0.523으로 눌려
     있었다. 판을 늘리면 실제 눌림이 정확히 0.74가 되어 셋이 같은 바닥을 본다. */
  /* 눌림(PITCH_FLAT)은 예전에 **상자 비율**에 숨어 있었다(지적: "3D에서 맵이 세로로
     길어지는데?" — aspectRatio의 1/0.74). 상자를 1024 고정으로 바꾸면서 그 몫이
     사라져 눌림이 1.0이 되었고, 바닥이 안 눕고 서 버렸다. 눌림은 상자가 아니라 회전
     전 판이 맡는 것이 맞다 — 그래야 상자 크기를 어떻게 바꾸든 눕는 정도가 안 흔들린다.
     원근 거리(PITCH_DIST)와 함께 모듈 스코프에 있다. */
  /* 맞춤 축소(지적: 또 예전 끝 잘림) — 원근 확대로 가까운 변이 상자를 넘쳤다. 가까운
     변이 상자에 딱 맞는 배율 q로 전체를 줄이고, 세로는 cy만큼 올려 가운데 정렬한다.
     지형 그림(transform)과 마커 공식이 같은 q·cy를 쓴다. */
  const pitchGeom = () => {
    const el = mapRef.current;
    const w = el?.clientWidth ?? 320;
    const h = el?.clientHeight ?? 220;
    const S = Math.sin(PITCH_TH);
    const C = Math.cos(PITCH_TH);
    /* 회전 전 판의 세로 — 회전이 C배로 누르므로 1/C배 늘려 두면 회전 뒤 상자 세로가
       되고, 거기에 눌림(PITCH_FLAT)을 곱해 그만큼만 눕는다. */
    const hPre = (h * PITCH_FLAT) / C;
    const P = Math.max(240, h * PITCH_DIST);
    const H = hPre / 2;
    const q = Math.max(0.2, (P - H * S) / P);
    const kFar = P / (P + H * S);
    const cy = (C * H * (1 - q * kFar)) / 2;
    return { w, h, hPre, P, S, C, q, cy };
  };
  /* 3D 변환 레이어의 과표본(지적: 3D가 2D보다 흐리다) ───────────────────────────
     perspective가 낀 변환에는 단일 배율이 없어, 크로뮴은 그 요소를 제 합성 레이어로
     떼어 내고 **래스터 배율을 1로 못 박는다**. 그래서 3D 지형만 화면 픽셀비를 통째로
     버린다 — 레티나에서 2D의 절반 해상도로 그려진다(DPR 2·3에서 값이 한 톨도 안 움직인다).
     will-change·preserve-3d·backface-visibility·부모 perspective 어느 것도 안 통한다.

     통하는 것은 하나뿐이다: 그림을 R배 크게 깔고 변환 맨 끝(=가장 먼저 먹는 자리)에
     scale(1/R)을 끼운다. 레이어가 R배 크기로 래스터되고 화면 기하는 그대로다.
     R은 화면 픽셀비가 아니라 **저장 그림 한 변 ÷ 상자 CSS 폭**이다 — 픽셀비를 보면
     휴대폰(상자 390)에서 R=2가 아무 일도 안 하고, 비레티나 PC(픽셀비 1)에서는 R=1이
     되어 통째로 무효가 된다. 있는 화소를 다 쓰는 것이 기준이고, 그 위는 없는 것을
     늘리는 것뿐이라 1~4로 자른다. */
  const pitchStyle = (): React.CSSProperties | undefined => {
    if (!pitched) return undefined;
    const { q, cy, P, C } = pitchGeom();
    const base = `translateY(${(-cy).toFixed(1)}px) scale(${q.toFixed(4)}) perspective(${P.toFixed(0)}px) rotateX(45deg) scaleY(${(PITCH_FLAT / C).toFixed(4)})`;
    const box = mapPx || mapViewW;
    const R = imgSide && box
      ? Math.min(4, Math.max(1, Math.round(imgSide / box)))
      : 1;
    if (R <= 1) return { transform: base };
    // 커진 만큼 왼쪽·위로 물려 상자 가운데에 그대로 앉힌다(변환 원점이 제 가운데다).
    const off = `${(-(R - 1) * 50).toFixed(2)}%`;
    return {
      transform: `${base} scale(${(1 / R).toFixed(4)})`,
      left: off, top: off, width: `${R * 100}%`, height: `${R * 100}%`,
    };
  };
  const pitchK = (y: number): number => {
    if (!pitched) return 1;
    const { hPre, P, S, q } = pitchGeom();
    const v = (y / grid.height - 0.5) * hPre;
    return (q * P) / (P - v * S);
  };
  /** 자리의 0~1 분수 — posStyle(%)과 캔버스 유닛 층이 같은 값을 쓴다. */
  const posFrac = (x: number, y: number): [number, number] => {
    if (!pitched) return [x / grid.width, y / grid.height];
    const { w, h, hPre, P, S, C, q, cy } = pitchGeom();
    const u = (x / grid.width - 0.5) * w;
    const v = (y / grid.height - 0.5) * hPre;
    const k = (q * P) / (P - v * S);
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
    const { w, P } = pitchGeom();
    const u = (x / grid.width - 0.5) * w;
    void y; // 자리 호환 — 기울기는 u/P라 세로 좌표가 안 든다.
    /* 요잉이 아니라 시각 밀림의 각(지적: 소실점이 시각을 반영해야 — 돌리면 찌그러짐).
       ShapeIcon이 tan을 취하면 u/P — 지도 남북 선의 소실 기울기 그 값이다(지적:
       노란선-빨간선 정합). 부호는 실화면 확인으로 이쪽이 정답 — 다시 뒤집지 말 것. */
    return (Math.atan2(u, P) * 180) / Math.PI;
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
      const hp = posAt(walk, Math.max(0, t - back));
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
  /* 이번 프레임의 시뮬 발사(P2) — 태그마다 마지막 한 발의 표적 자리. 0.35초 창은
     트레이서 애니가 살아 있는 길이 어림이다. 시뮬이 꺼져 있으면 null이고, 그때는
     렌더가 종전대로 제 교전 판정으로 그린다. */
  const simShots = simEvents ? shotsAt(simEvents, t, 0.35) : null;
  /* 누가 나를 쐈나 — 피격 불티를 '맞는 방향'에 놓는 자다(지적). 창은 불티가 떠 있는
     동안(0.45초)보다 조금 넓게 잡아, 불티가 뜬 뒤에도 방향을 잃지 않게 한다. */
  const simHits = simEvents ? hitsAt(simEvents, t, 0.6) : null;
  const unitOps: UnitDrawOp[] = [];
  /* (제거) 어택 명령 표적 집합으로 피격을 그리던 자 — 명령이 찍힌 곳과 실제로 맞는
     곳이 다르고 8초 내내 켜져, 싸움과 무관한 자리에서 불티가 텄다(지적). 이제 각
     개체의 체력 자취가 내려간 순간을 피격으로 삼는다(hurtAt). */
  // 글자 크기 CSS(모바일/PC 미디어)와 같은 값 — 캔버스는 CSS를 못 읽으니 여기서 정한다.
  // 이제 크기는 캔버스가 정한다 — 이 값은 그리기 주기(아래 DRAW_GAP_MS)에만 쓰인다.
  const pcView = typeof window !== "undefined" && !!window.matchMedia?.("(min-width: 1160px)").matches;
  /* 모델 크기 — 표준은 원작 크기 그대로, 확대는 그보다 더 크게.
     배수를 여러 번 다시 잡아야 했던(4 → 8 → 4.8) 까닭이 이번에 없어졌다: 눈에 보이는
     크기는 상자가 아니라 상자 안의 잉크인데 그 잉크가 상자의 5분의 1뿐이라, 배수를 두
     배로 올려야 겨우 두 배로 보였다. 이제 모델 공간 정규화가 그 몫을 잡고 크기표가
     원작 치수를 그대로 준다 — **표준이 곧 실제 게임 크기다**(실측: 표준 몸 크기가
     41종 중앙값 1.56배로 커졌다. 마린 잉크 폭 0.359 → 0.632타일 = 원작 0.531타일 위,
     저글링 0.370 → 0.577, 프로브 0.279 → 0.742).
     그래서 4.8은 이제 과하다. 3.1은 **확대에서 보이는 몸을 지금과 같게 두는** 값이다
     (4.8 ÷ 1.56 = 3.07). 사용자의 처음 말(“확대는 유닛만 1.5배”)대로 하고 싶으면
     이 한 줄만 1.5로 내리면 된다 — 그러면 확대가 지금 화면의 절반으로 작아진다.
     건물(bldMul)은 이번 변경 밖이라 그대로 둔다. */
  const unitMul = unitBig ? 3.1 : 1;
  const bldMul = unitBig ? 1.2 : 1;
  /* ── 유닛 크기의 자(전수조사·요청: "실제 캔버스 × 소·중·대로 균일하게") ─────────
     예전엔 등급마다 고정 픽셀(모바일 6·8·11 / PC 8·11·15)이었다. 화면 폭이나 맵
     격자와 무관한 값이라, 같은 마린이 맵마다 제멋대로 커 보였다: 64×64 맵의 한 타일은
     128×128의 두 배라 같은 6px이 절반 크기로 읽힌다. 건물은 진작부터 발자국(타일)
     비례였으니 유닛만 홀로 다른 자를 쓰고 있었던 셈이다.
     이제 둘이 한 자를 쓴다 — 한 타일의 화면 픽셀 × 등급비(소·중·대). 줌은 그리기
     단계에서 곱해지므로 어느 배율에서도 타일 대비 크기는 그대로다. */
  const tilePx = Math.max(1.2, (mapRef.current?.clientWidth ?? 320) / Math.max(1, grid.width));
  /* (폐기) 등급 3칸 표(UNIT_TILES 0.8/1.1/1.5) — 소·중·대 셋으로는 벌처와 탱크,
     저글링과 드론을 가르지 못했고, 무엇보다 '상자 크기'라 화면에 보이는 몸이 되지
     못했다. 이제 크기는 원작 치수표(UNIT_BW_TILES)가 유닛마다 정하고, 상자에서 몸으로
     가는 환산(16/MODEL_INK)은 정규화가 잰 값이 맡는다 — 위 unitTilesOf 무리 참고.
     등급은 표에 이름이 없는 유닛의 폴백(CLASS_TILES)으로만 남는다.
     **차지하는 공간은 안 건드린다** — 겹침·충돌은 simCore의 BODY_R이 따로 정하고 그
     값은 원작 그대로다. 화면 진형 간격도 이제 그리기 크기가 아니라 원작 몸 지름
     (UNIT_BODY_TILES → op.sepPx)에서 온다. */
  /** 낱개 유닛 도형 상자(px) — 크기표 × 모델 크기 배수 × 깊이.
   *  열쇠가 둘이다: drawKind는 **그려지는 모델**(tankbody·burrowhole…), sizeKind는
   *  **원작 치수를 가진 유닛**(tank·hydra…). 둘이 갈리는 자리가 곧 여태 손잡이가
   *  못 닿던 일곱 종류다. */
  const unitGlyphPx = (drawKind: string, sizeKind: string, bulk: 0 | 1 | 2, depthY: number): number =>
    tilePx * unitTilesOf(drawKind, sizeKind, bulk) * unitMul * pitchK(depthY);
  /** 유닛 이름 → 낱개 도형 상자(px). 그리는 모델이 유닛과 다르면 drawKind로 알려 준다. */
  const unitPxOf = (u: string, depthY: number, drawKind?: string): number => {
    const sk = UNIT_3D[u] ?? "";
    return unitGlyphPx(drawKind ?? sk, sk, u === "?" ? 0 : (UNIT_BULK[u] ?? 1), depthY);
  };
  /** 유닛 이름(또는 kind) → 진형 간격용 몸 지름(px, 줌 전) — 원작 충돌 상자 그대로.
   *  UNIT_3D에 없는 이름은 kind로도 한 번 찾는다: 스파이더 마인은 유닛 이름표에 없고
   *  op이 kind("mine")만 아는데, 그 op이 **지금 이완에 드는 유일한 유닛 op**이다. */
  const unitSepPxOf = (u: string): number =>
    tilePx * (UNIT_BODY_TILES[UNIT_3D[u] ?? u]
      ?? CLASS_TILES[u === "?" ? 0 : (UNIT_BULK[u] ?? 1)]);
  /* 끌기 문턱(지적: 확대된 상태에서 더블탭이 축소가 아니라 조금씩 이동으로 읽힘) —
     여태 문턱이 없어 손가락이 1px만 굴러도 곧장 팬이었다. 탭할 때마다 지도가 밀리고,
     그 흔들림이 더블탭 판정의 '안 끌린 탭' 기준도 함께 넘겨 확대·축소가 안 걸렸다.
     10px을 넘어서야 끌기로 보고, 그 전까지는 아무 일도 하지 않는다. */
  const DRAG_SLOP = 10;
  const dragRef = useRef<
    { id: number; sx: number; sy: number; px: number; py: number; live: boolean } | null
  >(null);
  const onMapPointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1 || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      id: e.pointerId, sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y, live: false,
    };
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
    if (!d.live) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) <= DRAG_SLOP) return;
      d.live = true;
    }
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
    const dragged = dragRef.current?.id === e.pointerId && dragRef.current.live;
    if (dragRef.current?.id === e.pointerId) dragRef.current = null;
    // 끌던 손가락이 아니면 클릭이다 — 유닛·건물을 집어 정보 팝업을 연다(요청).
    if (!dragged) pickAt(e.clientX, e.clientY);
  };
  /* 정보 팝업(요청: 유닛·건물 클릭하면 정보 툴팁, 딴 데 누르면 닫힘, 다른 몸을 누르면
     새 툴팁) — 집는 것은 '열쇠' 하나뿐이고, 내용은 프레임마다 지금 그린 op에서 다시
     읽는다. 그래서 체력·생산·업그레이드가 저절로 실시간이다. */
  const pickAt = (clientX: number, clientY: number): void => {
    const el = mapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    let best: string | null = null;
    let bestD = Infinity;
    for (const o of opsRef.current) {
      if (!o.pickKey) continue;
      // UnitLayer의 분수→화면 사상과 같은 식(zx/zy 주석 참고).
      const ox = (o.fx - 0.5) * r.width * zoom + r.width / 2 + pan.x;
      const oy = (o.fy - 0.5) * r.height * zoom + r.height / 2 + pan.y;
      const box = o.wFrac ? Math.max(o.wFrac, o.hFrac ?? 0) * r.width : o.sizePx;
      // 작은 유닛도 손가락으로 집을 수 있게 최소 반경을 준다.
      const rad = Math.max(14, box * zoom * 0.5);
      const d = Math.hypot(px - ox, py - oy);
      if (d <= rad && d < bestD) { bestD = d; best = o.pickKey; }
    }
    setPicked(best);
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
      if (c) lodNoteFrame((now - c.last));
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
    if (!entData) return m;
    const nameOfId = new Map(entData.players.map((pl) => [pl.id, pl.name]));
    for (const e of entData.ents) {
      if (!e.bld || !e.k || e.t === -1) continue;
      const raw = nameOfId.get(e.o);
      if (raw === undefined) continue;
      const key = `${raw}|${e.k}`;
      const a = m.get(key) ?? [];
      // f=4는 '이 건물이 일했다'는 증거다(생산 또는 랠리 지정). 태그가 개체 제 것이라
      // 순번 어림 없이 그 건물 하나만 켤 수 있다 — 옛 v1 표는 태그가 있을 때도 없을 때도
      // 있어 대표 건물로 떨어지곤 했다.
      for (const v of e.ev) if (v[3] === 4) a.push([v[0], e.t]);
      if (a.length > 0) m.set(key, a);
    }
    for (const a of m.values()) a.sort((x, y) => x[0] - y[0]);
    return m;
  }, [entData]);

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


  /* (제거) 유닛별 완성 시각 unitDoneByRaw — 쓰던 곳이 벙커 화염 판정 하나뿐이었다.
     "이 임자가 그때까지 파이어뱃을 뽑은 적이 있나"로 벙커 안을 어림하던 자리인데, 지도가
     지적한 그대로 안에 몇이 무엇을 타고 있는지와 아무 상관이 없는 값이었다. 이제 승선
     증거(아래 bunkerCrew)로 실제 탑승자를 보므로 근거 자체가 필요 없어졌다. */


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
    .map((row, i) => [row, i] as const)
    .filter(([[, , , unit]]) => ["Refinery", "Assimilator", "Extractor"].includes(unit))
    .map(([[sec, x, y, unit, raw, gone], i]) => ({
      sec, x: x + footDx(unit), y: y + footDy(unit), raw, gone: gone ?? 0,
      /* 완공 시각(요청: "간헐천은 건물을 짓는 동안만 보이고 완공되면 안보임") — 테란은
         건설 중단이 있어 표의 건설 시간이 아니라 실제로 자란 시각(bldWork)이 답이다. */
      done: bldWork.get(i)?.doneAt ?? sec + (BUILD_SEC[unit] ?? 30),
    })), [buildsSrc, bldWork]);
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
  /* (걷어냄) moneyMap — '겹쳐 쌓인 자원이면 돈맵'이라는 검출. 고갈 어림을 무한맵에서만
     빼려고 두었던 것이라, 어림이 사라지면서 쓸 곳이 없어졌다. */
  /* 자원별 고갈 시각(위 MINERAL_DEPLETE_SEC 주석) — 미네랄은 '가까운 차례'가 처음
     일꾼으로 채워진 시각 + 12분, 가스는 그 자리 가스 건물의 첫 완공 + 17분. 임자·차례는
     채굴 표시와 같은 어림(가장 가까운 본진·홀)이되, 시각 의존을 피해 홀은 선 시각과
     무관하게 본다 — 고갈은 분 단위 어림이라 그 오차는 티가 안 난다. */
  /* (걷어냄) depleteAt — 일꾼 수로 '이쯤이면 다 캤겠다'를 짐작하던 자원 고갈 어림.
     인과 증거가 없어 화면에서 이미 꺼 두고 있었다(자원 모델은 늘 세워 둔다). */
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
  /* 스캔은 탐지 시간만큼 남는다(요청: 스캔 뿌린 게 효과가 있어야 할 듯) — 여태 6초
     (CAST_HOLD_SEC)만 그려 놓고 탐지는 12초를 먹였다. 눈에 보이는 동안이 곧 그 자리가
     디텍터인 동안이라야, 안 보이던 것이 왜 갑자기 표적이 되는지가 화면에서 읽힌다. */
  const castsNow = castsSrc.filter((c) => c[0] <= t
    && t - c[0] <= (c[3] === "Nuclear Strike" ? NUKE_FALL_SEC + 4
      : c[3] === "Dark Swarm" ? 30
        : c[3] === "Disruption Web" ? 25
          : c[3] === "Stasis Field" ? 20
            : c[3] === "Scanner Sweep" ? SCAN_DETECT_SEC : CAST_HOLD_SEC));
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

  /* (걷어냄) 수송·드랍 어림 한 벌 — 드랍/태움 신호(drops·loads)와 수송선 자취로
     '내린 자리·태운 자리'를 짚던 어림이다. 재료가 전부 v1 부대 트랙이라 요약 폐지 뒤로는
     아무것도 안 나왔다. 개체 트랙에는 승선(f=12)·하차(f=13)가 개체마다 실려 있어,
     다시 만든다면 어림이 아니라 그 증거로 만드는 것이 맞다. */
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
              {/* 일꾼 수(요청: 사망 일꾼까지 반영해 실시간으로) — 지금 살아 있는 수다.
                  줄은 늘 자리를 잡아 둔다: 값이 생겼다 사라졌다 하면 아바타가 위아래로
                  들썩인다(옛 지적). 개체 트랙이 없는 옛 경기는 아예 빈 줄로 남는다. */}
              <span
                className="scr-motion-workers"
                style={workerNow.has(m.key) ? undefined : { visibility: "hidden" }}
              >
                일꾼 {workerNow.get(m.key) ?? 0}
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
      /* 폭 제한은 여기 걸지 않는다(수리) — 뿌리 상자에는 지도만이 아니라 양옆 로스터와
         아래 조작 줄들이 함께 들어 있어서, 여기를 좁히면 화면 전체가 왼쪽 한 기둥으로
         쪼그라들었다(실측: 지도가 140px). 세로 맞춤은 지도 자신에게 건다(아래 참조). */
      style={{ margin: "0 auto" }}
    >
      <div className="scr-motion-maprow">
      {/* 로스터를 한 덩어리로 묶는다(지적: "조작부쪽을 댓글쪽처럼 1열짜리 그리드로") —
          예전에는 팀 기둥 둘이 페이지 그리드의 1열·2열을 **직접** 차지했다. 그래서 왼쪽이
          110px 두 칸으로 쪼개져 있었고, 그 위아래의 색상·보기·조작 줄은 매번 두 칸을
          걸쳐야 했다(안 걸치면 절반만 쓴다 — 실제로 색상 줄이 그랬다).
          로스터가 둘로 나뉜 것은 로스터 안의 사정이지 페이지 그리드가 알 일이 아니다.
          한 덩어리로 묶어 페이지에서는 한 칸만 차지하게 한다 — 댓글 기둥과 같은 꼴이다. */}
      <div className="scr-motion-rosterwrap">
        {teamCol(1)}
        {/* 로스터 가운데 vs(요청: 구분선 말고 vs — 모바일·PC 공통). */}
        <span className="scr-motion-teamvs" aria-hidden>vs</span>
        {teamCol(2)}
      </div>
      <div
        className={cx("scr-motion-map", pitched && "scr-motion-pitched")} ref={mapRef}
        onPointerDown={onMapPointerDown}
        onPointerMove={onMapPointerMove}
        onPointerUp={onMapPointerUp}
        onPointerCancel={onMapPointerUp}
        style={{
          /* 넓은 배치에서만 고정 크기다(요청: 1024 고정) — 좁은 화면은 폭 100%로 흐른다.
             보기(2D·3D)와 무관하다: 3D일 때만 상자를 넓히면 보기를 바꿀 때마다 세로가
             달라져 탐색바 아래가 통째로 밀린다(실측 285px). 3D의 눕힘은 상자가 아니라
             회전 전 판(pitchGeom의 hPre)이 맡는다. */
          /* 1024는 상한이다(요청: min(1024px, 100%)) — 고정만 두면 왼쪽 기둥(232)과
             댓글 기둥(232)에 간격까지 476px을 더한 값이 화면을 넘어, 대략 1560px보다
             좁은 화면에서 페이지에 가로 스크롤이 생겼다(실측: 1440에서 28px, 1280에서
             188px). 100%는 그리드 칸(minmax(0,1fr)) 폭이라 순환하지 않는다. */
          ...(wide ? { width: `min(${mapViewW}px, 100%)`, flex: "0 0 auto" } : {}),
          aspectRatio: `${grid.width} / ${grid.height}`,
          ...(zoom > 1 || pitched ? { overflow: "hidden" } : {}),
          ...(zoom > 1 ? { cursor: dragRef.current ? "grabbing" : "grab" } : {}),
          /* 손짓 격리(지적 둘: 맵 조정 시 모달이 딸려 움직임 + 2D 모드에서 드래그가
             모달로 전파) — 맵 위 손짓은 확대 여부와 무관하게 브라우저에 안 넘긴다.
             확대 전 세로 스크롤만 열어 두던 pan-y가 2D에서 모달을 끌었다. 모달 훑기는
             맵 밖(로스터·댓글)에서 하면 된다. */
          touchAction: "none",
        }}
      >
        {/* 시뮬 상태 — 코어가 정식 경로가 된 뒤로는 **자취가 아직 없을 때만** 뜬다.
            다 실린 뒤의 telemetry(몇 기·몇 초)는 콘솔(logSim) 몫이다: 잘 된 것을 화면에
            계속 알릴 이유는 없고, 안 된 것은 반드시 보여야 한다(요청). */}
        {!simTracks && simNote && (
          <span className="scr-motion-simnote">{simNote}</span>
        )}
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
          ref={lensRef}
          className="scr-motion-lens"
          style={{
            /* 줌 역배율 변수(지적: 클릭 마커·링은 UI라 확대에 굵어지면 안 됨) —
               UI성 마커가 scale(1/--mz)로 제 화면 크기를 지킨다. */
            "--mz": zoom,
            /* transform은 여기서 안 쓴다(수리: 휠 확대가 한 번만 먹는다) — 재생 중엔
               매 프레임 리렌더가 나서, 상태에서 나온 변환이 휠이 방금 쓴 변환을 계속
               되돌렸다. 아래 lensZoom effect가 상태가 바뀔 때만 써 준다. */
          } as React.CSSProperties}
        >
        {grid.image
          ? (
            <img
              className="scr-motion-canvas" src={grid.image} alt={`${grid.name} 미니맵`}
              draggable={false}
              onLoad={(e) => setImgSide(e.currentTarget.naturalWidth || 0)}
              style={pitchStyle()}
            />
          )
          : (
            /* 매핑 안 된 맵(정정: 샘플 녹색이 아니라 맵에서 실제 추출한 지형) — 리플레이
               타일 격자 개략도(ReplayMapCanvas)를 바탕으로 깐다. 초록 계열 지형 램프가
               곧 기본색이다. 3D에선 실제 그림과 똑같은 기울임을 입는다(지적: 기본 파싱
               맵은 입체 효과가 안 됨). */
            <div
              /* 격자 개략도는 과표본을 안 건다 — 캔버스 배킹이 512로 고정이라 상자만
                 키워 봐야 화소가 안 는다(메모리만 든다). */
              className="scr-motion-canvas scr-motion-canvas-blank"
              style={pitched ? (() => {
                const { q, cy, P, C } = pitchGeom();
                return { transform: `translateY(${(-cy).toFixed(1)}px) scale(${q.toFixed(4)}) perspective(${P.toFixed(0)}px) rotateX(45deg) scaleY(${(PITCH_FLAT / C).toFixed(4)})` };
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
            /* 저그는 페이드가 없다(요청: "저그 드론 건물 변태/취소시 페이드인 아웃 없게")
               — 드론이 그 자리에서 건물로 변하는 것이라, 스르륵 나타나면 '어디선가
               생겨난 것'으로 읽힌다. 취소도 마찬가지로 그 자리에서 도로 드론이 된다. */
            const FADE_SEC = (bases.find((b9) => b9.key === raw)?.race) === "저그" ? 0 : 1.2;
            const fade = FADE_SEC <= 0 ? 1 : Math.min(
              sec > 0 ? Math.min(1, (t - sec) / FADE_SEC) : 1,
              goneEff > 0 && t >= goneEff ? Math.max(0, 1 - (t - goneEff) / FADE_SEC) : 1,
            );
            if (goneEff > 0 && t >= goneEff + FADE_SEC) return null;
            if (fade <= 0) return null;
            // 떠 있는 구간(지적: 건물 떠 있는 게 표현이 안 된다) — 이륙부터 착륙(=goneAt)
            // 까지 옛 자리에서 둥실거린다.
            const afloat = !!liftAt && t >= liftAt;
            const razed = false;
            /* 같은 자리에 제 후계가 서면(레어 진화·재건·콜로니 변태) 옛 것은 걷는다
               (지적: 비활성 건물이 글자와 도형으로 동시 표시). 계보는 한 방향이고
               자리는 발자국 안이라야 한다(위 succeedsBld 주석 — 성큰이 옆 크립 콜로니에
               지워지던 자리). */
            if (!razed && buildsSrc.some(([s2, x2, y2, u2, r2], j) =>
              j !== i && r2 === raw && s2 > sec && s2 <= t
              && Math.hypot(x2 - x, y2 - y) <= SAME_SITE_TILES && succeedsBld(unit, u2))) {
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
            /* 이사 비행 중인가 — 떠 있는 건물만 그림자를 지니는 데 쓴다(요청). */
            let landing = false;
            if (flownFrom) {
              const flyDist = Math.hypot(flownFrom[1] - x, flownFrom[2] - y);
              const flyDur = Math.min(40, flyDist / BUILDING_FLY_SPEED);
              if (t < sec + flyDur && flyDur > 0) {
                const k = Math.max(0, (t - sec) / flyDur);
                bx = flownFrom[1] + (x - flownFrom[1]) * k;
                by = flownFrom[2] + (y - flownFrom[2]) * k;
                landing = true;
              }
            }
            /* 뜬 건물의 자리 — 개체 트랙이 착륙 자리마다 줄을 나눠 싣기 때문에, 이 줄의
               좌표가 곧 지금 그 건물이 있는 자리다. 표적 지도(engageFoes·entPosByTag)도
               같은 좌표를 본다 — 몸과 겨눠지는 자리가 갈리면 총알이 빈 땅으로 간다. */
            // 짓는 동안은 공사중 아이콘(요청: 반투명 말고) — 반투명은 "저기 뭐가 있긴 한데"
            // 로만 읽히고, 도형의 반투명(뒤 비침)과도 헷갈렸다. 날아온 건물은 이미 다 선
            // 건물이라 망치를 안 든다.
            // 시작 건물(합성된 0초 홀)도 망치를 안 든다(지적: 처음 홀에 망치 표시는 왜?) —
            // 경기 시작에 이미 다 서 있던 건물이지, 짓는 중이 아니다.
            /* 완성 시각 — 테란 건설 중단(bldWork)이 있으면 'SCV가 붙어 있던 만큼만
               자란' 그 시각이고, 없으면 종전대로 착공 + 표의 건설 시간이다. */
            const work = bldWork.get(i);
            const bldNeed = BUILD_SEC[unit] ?? 30;
            const doneAt = work ? work.doneAt : sec + bldNeed;
            const raising = !razed && !flownFrom && sec > 0 && t < doneAt;
            /** 공사가 멈춰 선 동안인가 — 일꾼이 하나도 안 붙어 있는 구간 사이다. */
            const halted = !!work && raising && !workingAt(work.wins, t);
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
              && (upsByRaw.get(raw) ?? []).some(([us, name]) =>
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
            /* 그리는 상자는 발자국이 아니라 **몸 상자**다(요청: 건물 틈) — 원작은 건물마다
               자리 상자(발자국, 타일 배수)와 몸 상자(units.dat dimensions)를 따로 들고,
               둘의 차이가 곧 건물 사이의 틈이다. 네 변이 저마다 달라(배럭 좌16·우8·상8·
               하16px) 상자 중심도 발자국 중심에서 조금 밀린다. 그래서 나란히 선 건물
               사이가 종류·배치에 따라 열리고 닫힌다(docs/note-building-gaps.md).
               ⚠ 예전 확정("바닥 폭 = 타일 발자국")을 이 요청이 뒤집는다 — 발자국을 꽉
                 채워 그리면 틈이 원리적으로 안 생긴다. */
            const [boxW, boxH, boxOx, boxOy] = buildingBox(unit);
            const bodyX = centerX + boxOx;
            const bodyY = centerY + boxOy;
            const anchorX = bodyX - (addonPlus ? 1.6 : 0);
            const anchorY = bodyY + (addonPlus ? 0.4 : 0)
              + (!addonPlus ? (shapeKind ? -riseOf(unit) / 2 : boxH * 0.1) : 0);
            const [fxF, fyF] = posFrac(anchorX, anchorY);
            const mkK = pitchK(centerY);
            /* 나이는 **진짜 동점만** 가른다(수리: 겹치는 건물의 앞뒤가 뒤바뀜 · 소환구가
               앞 건물에 안 가려짐) — 한 타일이 Z_TILE(800)이고 나이 항은 60까지라,
               아랫변이 0.075타일보다 벌어져 있으면 자리가 언제나 이긴다. 예전에는 한
               타일이 80인데 나이가 30까지여서, 0.375타일 안에 붙은 건물끼리 나이가
               앞뒤를 뒤집었다. */
            const z = pitched
              ? 1000 + Math.round((bodyY + boxH / 2) * Z_TILE)
                + Math.min(60, Math.round(sec / 45))
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
               폭을 재서 발자국을 채우므로(지금은 BLD_NORM) 상자는 제 발자국(2×2) 그대로
               두면 된다. 그대로 두면 부속만 발자국보다 28% 넓게 그려진다. */
            const wTiles = boxW * (shapeKind ? 1 : 0.8) * bldMul;
            const hTiles = wTiles * ((boxH + (shapeKind ? riseOf(unit) : 0)) / boxW);
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
              const bs2 = bldNeed;
              /* 일꾼이 불티를 따라간다(지적: "테란은 건설시 스파크는 이동하는데 일꾼은
                 제자리임") — 불티 자리는 아래 buildfx가 6초마다 시계 방향으로 옮기는데
                 (CORNER_SEC) 합성 SCV만 왼쪽 아래에 붙박이라, 용접 불티가 저 혼자
                 건물을 돌았다. 같은 식으로 같은 귀퉁이를 쓴다 — 둘이 한 몸이어야 한다. */
              const scvIdx = (Math.floor(t / 6) + i) % 4;
              const scvX = bodyX + (scvIdx === 0 || scvIdx === 3 ? -1 : 1) * (boxW / 2 - 0.35);
              const scvY = bodyY + (scvIdx === 0 || scvIdx === 1 ? 1 : -1) * (boxH / 2 - 0.35);
              let scvShow = t - sec >= 0;
              /* 중단 중에는 현장에 아무도 없다(요청: 테란 건설 중단) — 붙어 있던 구간
                 안에서만 합성 SCV가 선다. 이어 짓기로 다른 SCV가 오면 다시 선다. */
              if (work && t < doneAt) scvShow = workingAt(work.wins, t);
              if (t >= doneAt) {
                /* 공사가 끝난 뒤 이 SCV가 언제 자리를 뜨나 — 개체 트랙의 건설 앵커 창
                   (builderLeave)이 '앵커 시각 → 그 뒤 첫 위치 증거'를 이미 색인해 둔다.
                   옛 v1 일꾼 클릭 자취로 뒤지던 자리다. */
                let nextCmd = Infinity;
                for (const bl of builderLeave) {
                  if (bl.end === Infinity || bl.end < doneAt - 2) continue;
                  if (Math.hypot(bl.x - scvX, bl.y - scvY) <= 5) { nextCmd = bl.end; break; }
                }
                if (t >= nextCmd) scvShow = false;
              }
              /* v2에선 진짜 개체가 답을 안다(지적: SCV들이 건설현장에 남는다 — v2 모드는
                 motion이 빈 껍데기라 위 spts 게이트가 영영 안 열렸다) — 이 현장의 건설
                 앵커(f=2)를 남긴 일꾼 개체의 '앵커 뒤 첫 위치 증거' 시각이 곧 그 SCV가
                 현장을 떠난 순간이다. 그때부터는 개체 마커가 걸어 나가며 그리므로 합성
                 SCV를 걷는다. */
              /* 공사 이력을 아는 건물(bldWork)은 위에서 이미 갈랐다 — 아래 옛 잣대는
                 첫 일꾼이 떠난 시각 하나뿐이라, 이어 짓는 SCV까지 지운다. */
              if (scvShow && !work) {
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
                  sizePx: unitGlyphPx("scv", "scv", 0, scvY),
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
              const prog = Math.min(1, (work ? workedBy(work.wins, t) : t - sec) / bldNeed);
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
              const bAnchorY = bodyY + boxH / 2 - modelHT / 2 + CONSTRUCT_DROP
                - (race2 === "프로토스" ? WARP_LIFT : 0);
              const [bfxF, bfyF] = posFrac(bodyX, bAnchorY);
              unitOps.push({
                fx: bfxF, fy: bfyF, z,
                /* 짓는 중에도 집힌다(요청: 건설 중 상태에서도 클릭 가능) — 열쇠는 완성
                   뒤와 같은 자로 지어, 다 지어져도 팝업이 그대로 이어진다. */
                pickKey: `b${raw}|${unit}|${Math.round(bx * 4)}|${Math.round(by * 4)}`,
                pickName: unit, pickRaw: raw, pickBld: true,
                /* 상태 줄 — 테란은 '건설 중단'을 따로 말한다(요청): 일꾼이 떠나거나
                   죽어 공사가 그 진행률에 멈춰 선 동안이다. */
                pickState: race2 === "저그"
                  ? `변태 중 ${Math.round(prog * 100)}%`
                  : `${halted ? "건설 중단" : "건설 중"} ${Math.round(prog * 100)}%`,
                /* 테란 공사는 제 건물 모델을 아래부터 드러낸다(요청: "3단계로 하고 실제
                   모델의 부품을 일부만 표현하다가 완성되는 형태로. 아래쪽 부품부터 →
                   점점 위로"). 뼈대·크레인 한 벌(scaffold)을 모든 건물에 똑같이 쓰던
                   것을 걷는다 — 무엇을 짓는지 완성될 때까지 알 수 없었다.
                   모델이 없는 건물(부속 등 폴백)만 예전 공사장으로 떨어진다. */
                kind: race2 === "저그" ? "cocoon"
                  : race2 === "프로토스" ? "warpin"
                    : (shapeKind || "scaffold"),
                /* 아래 부품부터 다섯 칸에 나눠 솟는다(요청: 3단계 부족 시 5단계) —
                   진행률을 그대로 칸으로 바꾼다. 마지막 칸(=BUILD_STAGES)이 완성 모델
                   이라, 다 짓기 전에 완성형이 서 버리지 않게 진행률 1 미만은 한 칸
                   아래로 묶어 둔다. 단계가 굽기 캐시 열쇠에 들어가므로 판은 단계마다
                   한 번만 구워진다(프레임 비용 없음). */
                ...(race2 === "테란" && shapeKind
                  ? { buildStage: Math.max(1, Math.min(BUILD_STAGES - 1,
                    Math.ceil(prog * BUILD_STAGES))) }
                  : {}),
                // 공사 모델도 45도 요잉(지적) + 종류별 보정(지적: 테란 공사장 반시계 90).
                rotDeg: buildingYawOf(race2 === "저그" ? "cocoon"
                  : race2 === "프로토스" ? "warpin"
                    : (race2 === "테란" && shapeKind ? unit : "scaffold")),
                viewYaw: viewYawOf(centerX, centerY), flat: !pitched, pitch: pitched,
                // 공사 모델도 완성 건물과 같은 지면선에 선다.
                baseFy: posFrac(bodyX, bodyY + boxH / 2)[1],
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
              /* 테란 일꾼은 네 귀퉁이를 돈다(요청: "프로브가 4귀퉁이를 돌면서 공사") —
                 여태 왼쪽 아래 한 자리에 붙박이로 서서 용접했다. 건물 번호로 시작
                 귀퉁이를 흩어 두고(같은 기지의 공사가 나란히 같은 자리에서 시작하면
                 눈에 띄게 어색하다) 6초마다 시계 방향으로 옮긴다.
                 ⚠ 원작의 실제 순회 패턴은 아직 대조 전이다(지적: "이 패턴은 공식문서
                 조사 필요") — 조사가 오면 이 자리만 바꾸면 된다. */
              /* 불티 자리 — 합성 SCV와 **같은 차례·같은 주기**다(지적: 둘이 따로 돌았다).
                 SCV보다 조금 안쪽에 두어 불티가 몸에 반쯤 얹힌다. */
              const CORNER_SEC = 6;
              const cIdx = (Math.floor(t / CORNER_SEC) + i) % 4;
              const cDx = (cIdx === 0 || cIdx === 3 ? -1 : 1) * (boxW / 2 - 0.7);
              const cDy = (cIdx === 0 || cIdx === 1 ? 1 : -1) * (boxH / 2 - 0.5);
              const bfxX = race2 === "테란" ? bodyX + cDx : bodyX;
              const bfxY = race2 === "테란" ? bodyY + cDy
                : bodyY + boxH / 2 - modelHT / 2;
              // 멈춰 선 공사에는 불티가 없다(요청: 테란 건설 중단) — 아무도 안 붙어 있다.
              if (!qBuildFx || halted) return null;
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
                          width: "0.2px",
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
              const arr = entBldHp.get(`${raw}|${Math.round(x)}|${Math.round(y)}`);
              if (!arr) return { frac: 1, hurt: -99 }; // 기록 없는 성한 건물도 만피 바(요청).
              const rec = [...arr].filter((r2) => r2.born <= sec + 5)
                .sort((a2, b2) => b2.born - a2.born)[0] ?? arr[0];
              /* 체력은 실제 수치다(지적) — 만피는 건물 표에서 가져와 나눈다. */
              const bs0 = BLD_STATS[unit];
              const full0 = bs0 ? bs0[0] + bs0[1] : 850;
              let now0 = full0;
              let hurt = -99;
              for (const [hs3, hv3] of rec.hp) {
                if (hs3 > t) break;
                if (hv3 < now0) hurt = hs3;
                now0 = hv3;
              }
              return { frac: Math.max(0.04, Math.min(1, now0 / Math.max(1, full0))), hurt };
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
            // 건물도 같은 잣대로 잠깐만(지적) — 0.8 → 0.35초.
            const bldHitFx = bldHp.hurt > -99 && t - bldHp.hurt <= 0.35 ? (
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
            /* 성큰은 쏘는 동안 혓바닥을 내민 판으로 바꾼다(요청: "가시가 나오는 타이밍에
               이 모양이") — 아래 방어 사격이 트레이서를 그리는 조건과 **같은 자**를 쓴다:
               사거리 안에 지상 표적이 있고, 다 지어졌고, 아직 안 걷혔을 때. 조건을 따로
               두면 혓바닥과 가시가 서로 다른 순간에 나가 둘 다 거짓말이 된다. */
            const sunkenOut = unit === "Sunken Colony" && qCombat && !raising
              && (goneEff === 0 || t < goneEff)
              && (() => {
                const f9 = nearestFoe(teamOfRaw(raw), centerX, centerY, "ground");
                return f9.bd <= fireRangeTilesOf(unit, false);
              })();
            if (shapeKind) {
              unitOps.push({
                fx: fxF, fy: fyF, z, kind: sunkenOut ? "sunkenfire" : shapeKind,
                /* 원작처럼 45도 요잉(지적) — 2D에도 적용(재지적: 2D도 45도 요잉해야지).
                   쐐기의 진범은 요잉이 아니라 hover 그림자의 beginPath 누락이었다. */
                rotDeg: buildingYawOf(shapeKind),
                hpMax: (() => {
                  const bs2 = BLD_STATS[unit];
                  return bs2 ? bs2[0] + bs2[1] : undefined;
                })(),
                hpFrac: bldHp.frac,
                /* 정보 팝업 신원(요청) — 건물은 태그가 없어 임자·종류·착공 자리로
                   짓는다(같은 자리에 다시 지어도 착공 시각이 다르면 다른 몸이다). */
                pickKey: `b${raw}|${unit}|${Math.round(bx * 4)}|${Math.round(by * 4)}`,
                pickName: unit, pickRaw: raw, pickBld: true,
                /* 땅에 앉은 건물은 그림자를 안 진다(요청: 건물 바닥 그림자는 제거) —
                   건물은 발자국이 곧 제 자리라 바닥 타원이 정보를 더하지 않고, 모델
                   발치에 검은 테를 둘러 도형을 흐리기만 했다. 떠 있는 건물만 제 것으로
                   따로 만든다(요청: 떠 있는 건물만 자체적으로 제작) — 이륙해 둥실대거나
                   이사 비행 중일 때, 발자국보다 작은 타원을 땅에 깔아 높이를 말한다. */
                groundShadow: afloat || landing,
                // 접지 그림자의 발자국 비(지적: 그림자는 바닥 발자국만) — 세로/가로.
                footRatio: boxH / boxW,
                /* 바닥에 실제로 깔리는 그림자(요청) — 발자국 크기의 타원을 타일 공간
                   에서 열두 점으로 찍고, 그 점들을 자리 사상(posFrac)으로 옮긴다.
                   화면에서 타원을 눌러 흉내 내는 것이 아니라 지면 위에 그린 도형이라,
                   원근·기울기가 지면 격자와 정확히 같다.
                   뜬 건물은 발자국의 0.6배로 줄여 깐다 — 몸과 그림자의 크기 차가 곧
                   비행 높이로 읽힌다(공중 유닛 그림자와 같은 결). */
                shadowPts: ((): [number, number][] => {
                  const sk9 = 0.6;
                  const rx9 = (boxW / 2) * sk9;
                  const ry9 = (boxH / 2) * sk9;
                  const pts9: [number, number][] = [];
                  for (let q9 = 0; q9 < 12; q9 += 1) {
                    const a9 = (q9 / 12) * Math.PI * 2;
                    pts9.push(posFrac(
                      bodyX + Math.cos(a9) * rx9 * 0.98,
                      bodyY + Math.sin(a9) * ry9 * 0.98,
                    ));
                  }
                  return pts9;
                })(),
                // 지면선 — 몸 상자 아랫변(그림자 타원의 아래 끝과 같은 지면).
                baseFy: posFrac(bodyX, bodyY + boxH / 2)[1],
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
                /* 두 끝은 **몸 상자** 변이다(요청: 건물 틈) — 발자국 변으로 재면 이제
                   본체·애드온이 발자국보다 작게 서므로 통로가 허공에서 시작한다. */
                const parBox = par ? buildingBox(par[3]) : null;
                const leftEdge = par && parBox
                  ? par[1] + footDx(par[3]) + parBox[2] + parBox[0] / 2 - 0.5
                  : bodyX - boxW / 2 - 1.2;
                const rightEdge = bodyX - boxW / 2 + 0.5;
                const linkW = Math.max(1.6, rightEdge - leftEdge);
                const [lfx, lfy] = posFrac((leftEdge + rightEdge) / 2, bodyY + boxH * 0.1);
                unitOps.push({
                  /* 통로도 건물과 같은 45도로 굽는다(지적: "각 옆면에는 수직임") —
                     본체·애드온이 다 요잉해 서 있어 서로 마주 보는 옆면도 비스듬한데,
                     통로만 요잉 0으로 구우면 그 벽을 비껴 찌른다. 같은 각으로 구워야
                     모형의 x축이 두 벽의 법선과 나란해져, 막대가 양쪽 벽에 직각으로
                     꽂힌다(까닭은 addonlink 모델 쪽 주석에 적어 두었다). */
                  fx: lfx, fy: lfy, z: z - 1, kind: "addonlink",
                  rotDeg: buildingYawOf("addonlink"),
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
              /* 포톤·성큰·스포어도 쏜다(지적: 사거리 안에 대상이 있는데 공격을 안 한다)
                 — 여태 터렛·벙커만 이 갈래에 들어 있어, 프로토스·저그 방어 건물은
                 화력이 체력에만 접혀 있고 화면에는 아무 일도 안 일어났다. 성큰은 대지
                 (7타일)·스포어는 대공(7타일)·포톤은 둘 다(7타일)라, 못 치는 갈래는
                 nearestFoe의 only로 아예 안 본다. */
              if (qCombat && DEF_FIRE.has(unit)
                && !raising && (goneEff === 0 || t < goneEff)) {
                const teamB = teamOfRaw(raw);
                /* 벙커 승무원 — 이 벙커 태그의 탑승 구간 중 지금 살아 있는 것들. 자리 넷을
                   넘겨 잡히면 먼저 들어간 넷만 센다. 이 목록이 비면 벙커는 아무것도 안
                   한다(빈 벙커가 쏘던 것이 예전 거짓말이다). */
                const bunkTag = unit !== "Bunker" ? 0
                  : (bldTagSpots.rows.find((r9) => r9.k === "Bunker" && r9.raw === raw
                    && Math.abs(r9.x - centerX) <= 1.5 && Math.abs(r9.y - centerY) <= 1.5)?.tag ?? 0);
                const crew = bunkTag === 0 ? [] : (bunkerCrew.get(bunkTag) ?? [])
                  .filter((c9) => t >= c9.from && t < c9.to).slice(0, BUNKER_SEATS);
                /* 승선 증거가 하나도 없는 벙커는 마린 한 기가 든 것으로 친다 [어림] —
                   벙커를 골라 누르는 Load 버튼으로 태우면 우클릭 증거가 안 남기 때문이다.
                   빈 벙커로 두면 지어 놓고 지켜 낸 방어선이 화면에서 통째로 사라지고, 넷을
                   채운 것으로 치면 아무도 못 본 화력을 지어낸다. 인원을 모를 때 가장 작은
                   참값이 1이고, 그 임자가 마린을 뽑은 뒤부터만 그렇게 본다. */
                const presumed = unit === "Bunker" && crew.length === 0
                  && (marineBornOf.get(raw) ?? Infinity) <= t;
                const crewGun = presumed
                  || crew.some((c9) => c9.kind === "Marine" || c9.kind === "Ghost");
                const crewBat = crew.some((c9) => c9.kind === "Firebat");
                /* 사거리는 표에서 온다(과제 #48) — 여기 박혀 있던 캐논 7·성큰 7·스포어 7·
                   터렛 8·벙커 6·화염 3.5는 서로 다른 자리에 흩어진 채 표와 어긋나 있었다
                   (터렛은 원작 7이다). 벙커는 표에서 무기가 아예 없으므로 승무원의 무기를
                   벙커 보너스(+64px=2타일)와 함께 받아 온다 — profileOf(정체, 업글, 벙커=참)
                   가 그 덧셈과 U-238 같은 사거리 업글을 이미 물고 나온다. */
                const bunkUps = unit === "Bunker"
                  ? (upsByRaw.get(raw) ?? []).filter(([us9]) => us9 <= t).map(([, nm9]) => nm9) : [];
                // 사거리가 가장 긴 사수가 갈래를 정한다 — 고스트(C-10)가 있으면 그쪽.
                const gunProf = unit === "Bunker"
                  ? profileOf(crew.some((c9) => c9.kind === "Ghost") ? "Ghost" : "Marine",
                    bunkUps, true) : null;
                const batProf = unit === "Bunker" && crewBat
                  ? profileOf("Firebat", bunkUps, true) : null;
                const batRG = batProf ? (weaponVs(batProf, false)?.rangeTiles ?? -1) : -1;
                const rgG = unit === "Bunker"
                  ? (crewGun && gunProf ? (weaponVs(gunProf, false)?.rangeTiles ?? -1) : -1)
                  : fireRangeTilesOf(unit, false);
                const rgA = unit === "Bunker"
                  ? (crewGun && gunProf ? (weaponVs(gunProf, true)?.rangeTiles ?? -1) : -1)
                  : fireRangeTilesOf(unit, true);
                /* 못 치는 갈래는 표적으로도 안 삼는다 — 벙커는 승무원이 정한다: 마린·
                   고스트는 공중도 치므로(그래서 공중 표적이라고 사격이 통째로 사라지던 것이
                   지도가 잡은 버그다) 갈래를 안 나누고, 화염뿐이면 지상 전용이다. */
                const onlyB = unit === "Bunker" ? (crewGun ? undefined : "ground")
                  : rgA < 0 ? "ground" : rgG < 0 ? "air" : undefined;
                const foeB = nearestFoe(teamB, centerX, centerY, onlyB);
                const rgB = foeB.air ? rgA : rgG;
                // 화면 기준 조준(지적: 공중 각도·지면 평행) — 유닛 트레이서와 같은 셈.
                const tPxB = (mapRef.current?.clientWidth ?? 320) / grid.width;
                let dgy = (foeB.by - centerY) * tPxB * (pitched ? PITCH_FLAT : 1);
                // 표적의 제 크기로 조준 높이를 뺀다 — 표적 유닛 이름은 FoeRow.uk에 있다
                // (예전 코드는 건물 행에만 실리는 k를 공중 갈래에서 읽어 늘 폴백이었다).
                if (foeB.air) dgy -= unitPxOf(foeB.uk ?? "?", foeB.by) * 1.6;
                const degB = Math.atan2(-((foeB.bx - centerX) * tPxB), dgy) * (180 / Math.PI);
                const fire: React.ReactNode[] = [];
                /* 포톤은 대공·대지 한 자루, 성큰은 촉수(표적까지 실거리로 뻗는다 — 럴커
                   가시와 같은 셈), 스포어는 포자. 사거리 숫자는 위 rgB가 표에서 받아 왔다. */
                if (unit === "Photon Cannon" && foeB.bd <= rgB) {
                  fire.push(<span key="p" className="scr-motion-tracer scr-tracer-photon" style={{ transform: `rotate(${degB.toFixed(1)}deg) translateY(${MUZZLE_PX[unit] ?? 5}px)` }} />);
                }
                if (unit === "Sunken Colony" && foeB.bd <= rgB) {
                  fire.push(<span
                    key="s"
                    className="scr-motion-tracer scr-tracer-spike"
                    style={{
                      transform: `rotate(${degB.toFixed(1)}deg) translateY(${MUZZLE_PX[unit] ?? 5}px)`,
                      height: `${(foeB.bd * tPxB).toFixed(1)}px`,
                    }}
                  />);
                }
                if (unit === "Spore Colony" && foeB.bd <= rgB) {
                  // 스포어는 가디언과 같은 독 갈래다(요청: "스포어/가디언은 독느낌 노랑 연두 길게").
                  fire.push(<span key="o" className="scr-motion-tracer scr-tracer-venom" style={{ transform: `rotate(${degB.toFixed(1)}deg) translateY(${MUZZLE_PX[unit] ?? 5}px)` }} />);
                }
                if (unit === "Missile Turret" && foeB.air && foeB.bd <= rgB) {
                  fire.push(<span key="t" className="scr-motion-tracer scr-tracer-missile" style={{ transform: `rotate(${degB.toFixed(1)}deg) translateY(${MUZZLE_PX[unit] ?? 5}px)` }} />);
                }
                if (unit === "Bunker" && (crew.length > 0 || presumed)) {
                  if (crewGun && rgB >= 0 && foeB.bd <= rgB) {
                    fire.push(<span key="g" className="scr-motion-tracer" style={{ transform: `rotate(${degB.toFixed(1)}deg) translateY(${MUZZLE_PX[unit] ?? 5}px)` }} />);
                  }
                  // 화염은 지상 전용이고 사거리도 제 것(가우스 6에 견줘 3)이다.
                  if (crewBat && !foeB.air && batRG >= 0 && foeB.bd <= batRG) {
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
          /* 가스 위 건물(재지적: "간헐천에 건물 지을때 간헐천 모델링도 보이면서 겹쳐지게
             해야함(원작 반영)") — 앞선 지적("건물을 지으면 간헐천 모델은 사라져야")을
             뒤집는 요청이다. 원작에서 정제소·어시밀레이터·익스트랙터는 간헐천을 지우지
             않고 그 위에 얹힌다: 건물 몸(정제소 3.5타일)이 간헐천(4타일)보다 좁아 테두리가
             삐져나오고, 그 겹침이 '가스 위에 지었다'를 말한다.
             그래서 감추는 대신 **건물 뒤로 보낸다** — 아래 z에서 자원의 앞섬 몫(+1200)을
             빼고 두 타일치를 더 물려, 같은 자리에 선 건물이 무슨 일이 있어도 앞에 온다.
             ★ 다만 **짓는 동안만**이다(재요청: "완공되면 안보임") — 공사 중에는 간헐천이
               건물 뒤로 비치고, 완공되는 순간 감춘다. 정제소가 뚜껑을 덮는 그림이다. */
          const gasOn = gasSpot ? gasHideOf.find((g) =>
            g.sec <= t && (g.gone === 0 || t < g.gone) && g.gd <= 4
            && Math.abs(g.gx - res[0]) < 0.5 && Math.abs(g.gy - res[1]) < 0.5) : undefined;
          if (gasOn && t >= gasOn.done) return null;
          const underGas = !!gasOn;
          // 고갈된 미네랄(요청)은 밭이 사라진다. 가스는 아래에서 색만 죽인다.
          /* 고갈 어림은 끈다(지적: 미네랄·간헐천에 모델 적용해야지 — 후반에 자원이
             통째로 사라져 있었다). 일꾼 수로 짐작하던 v1 어림이라 인과 증거가 없었다:
             자원 모델은 늘 세워 둔다. 가스 색이 죽는 연출까지 함께 걷었다. */
          // 미네랄 살짝 확대(요청) — 2.4 → 2.9타일 폭.
          /* 간헐천은 제 발자국 그대로 4타일(전수조사: 6.4타일로 그려져 제 발자국(4×2)
             보다 60% 넓었다 — 그 위에 앉는 정제소(4타일)가 못 덮어 가스 건물 주위로
             간헐천이 삐져나오던 원인이기도 하다). */
          // 미네랄 확대(재지적: 크기도 너무 작아) — 2.9 → 4.2타일 폭.
          /* 미네랄 폭을 4.2 → 3.0타일로(지적: 넥서스와 간헐천에 가려짐) — 실제 밭은
             2×1인데 4.2타일로 그리다 보니, 옆 간헐천(4타일)과 그림이 통째로 겹쳐
             화가 순서가 누가 이기든 한쪽이 가려졌다. 자원끼리의 가림은 순서로는 못
             푼다(둘 다 자원이라 같은 자를 쓴다) — 그림을 제 발자국에 가깝게 되돌려야
             겹치지 않는다. 3.0은 여전히 밭(2타일)보다 5할 크다. */
          const wTiles = gasSpot ? 4 : 3;
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
            /* 자원이 건물에 가리는 것을 더 넓게 막는다(지적: 미네랄이 뒤에 있는 가스나
               건물에 가려짐) — 화가 순서는 '그림 아랫변'만 보는데, 건물 모형은 제 발자국
               보다 훨씬 크게 그려져(어시밀레이터의 지느러미·기둥) 한 줄 뒤에 서 있어도
               앞 미네랄을 덮는다. 자원의 앞섬 몫을 반 타일(40)에서 한 타일 반(120)으로
               넓혀, 정말 한 타일 반 넘게 앞에 선 건물만 자원을 가린다. 자원은 배경이라
               가려지면 지도가 안 읽히고, 반대로 자원이 조금 앞서 그려져도 어색하지 않다.
               가스 간헐천은 그 위에 정제소가 서면 아예 감춰지므로 같은 몫을 줘도 안전하다. */
            z: pitched
              ? 1000 + Math.round((res[1] + (wTiles * 0.75) / 2) * Z_TILE)
                + (underGas ? -2 * Z_TILE : 1200)
              : (underGas ? 700 : 900) + ri,
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
            color: gasSpot ? "#8f8274" : "#8fb9e8",
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
              sizePx: unitGlyphPx("mine", "mine", 0, m.y),
              /* 진형 간격 — 마인은 noSep이 아니라서 이완(밀어내기)에 드는 **유일한**
                 유닛 op이다.
                 3차 설계는 여기에 원작 몸 지름(15×15 = 0.469타일)을 **고정값**으로 실어
                 '모델 크기' 라디오가 간격을 못 흔들게 했는데, 검증이 그것이 회귀임을
                 실측으로 잡았다: 라디오와 크기표는 그림만 키우고 간격은 그대로라, 확대
                 화면에서 그려지는 몸폭이 중심거리의 457%가 된다(지금은 68%라 절대 안
                 겹친다). 마인은 한 자리에 여럿이 깔리는 물건이라 이게 바로 눈에 띈다.
                 그래서 반지름을 **그려지는 몸**에 매단다 — 그려지는 몸폭이
                 sizePx × (잉크상자/16)이므로, 그 폭이 중심거리(2×반지름)의 68%가 되는
                 값을 쓴다. 라디오를 어디에 두든 비율이 지금 그대로다. */
              sepPx: (unitGlyphPx("mine", "mine", 0, m.y) * modelInkOf("mine")) / 16 / 1.36,
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
              // 자리·계보는 위 succeedsBld와 같은 자를 쓴다 — 곁 콜로니의 시계를 안 물어온다.
              if (r2 !== raw || s2 >= startSec
                || Math.hypot(x2 - x, y2 - y) > SAME_SITE_TILES) continue;
              if (succeedsBld(u2, unit)) startSec = s2;
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
          // 후계가 선 자리는 무너진 것이 아니라 변태·재건이다(위 succeedsBld와 같은 자).
          if (buildsSrc.some(([s2, x2, y2, u2, r2], j) => j !== i && r2 === raw
            && s2 > sec && Math.hypot(x2 - x, y2 - y) <= SAME_SITE_TILES
            && succeedsBld(unit, u2))) return null;
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
        {/* (걷어냄) 채굴 일꾼 점 층 — 일꾼 '수'로 자원 곁에 점을 찍던 v1 장식 어림이다.
            실제 조작과 무관하게 그려져, 가스를 안 지었는데도 캐러 다니곤 했다(지적).
            개체 트랙에서는 실제 일꾼 개체가 제 클릭을 따라 움직이므로 어림이 필요 없다. */}
        {/* 개체 트랙 v2(요청: 태그 단위 분석을 별도 테이블에 담아 비교) — 태그 하나가
            곧 마커 하나다. 부대 어림의 묶음·흡수·합류 규칙이 전혀 없이, 각 개체가 제
            증거를 따라 걷고 제 죽음(d)에 종족 효과와 함께 걷힌다. 유닛 층만 바꿔 그리고
            건물·자원·크립·마법은 v1 그대로다. 정체를 모르는 개체는 그 종족의 기본 보병
            꼴을 반투명으로 — 아는 척은 안 하되 존재는 보인다. */}
        {entWalks.map((e, ei) => {
          const rp = e.walk;
          if (rp.length === 0 || t < rp[0][0]) return null;
          /* 죽음의 주인은 하나다(과제 #69) — 시뮬이 돌면 시뮬, 아니면 분석의 d다.
             분석이 체력 자취를 d에서 0으로 맞춰 주므로 '체력바가 0이면 즉사'는 저절로
             성립한다(체력 0 = d). 셋을 견주던 옛 사슬은 걷었다 — 그 셋이 서로 달라서
             화면·시뮬·체력바가 제각각 다른 순간에 유닛을 죽이고 있었다. */
          const simDie = simTracks?.get(e.tag)?.died ?? null;
          const dieAt = simDie !== null ? simDie : e.d;
          if (dieAt !== null && t >= dieAt + 1.2) return null;
          const team = teamOfRaw(e.raw);
          /* 걸음 속도 상한(요청) — 제 속도표로 죈다. 15%만 여유를 둔다: 교전 지연을
             따라잡는 몫이라, 이보다 크면 다시 '순간적으로 빨라짐'이 된다.
             드랍·리콜은 예외 — 원작에서도 순간이동이다. 수송 구간 앞뒤 여유를 두어
             하차 자리로 제때 나타나게 하고, 리콜은 같은 임자의 시전 전후 창으로 뺀다. */
          const ridingNow9 = e.rides.some(([ra9, rb9]) => t >= ra9 - 1 && t < rb9 + 2);
          const recallNow9 = castsSrc.some(([cs9, , , tech9, craw9]) =>
            tech9 === "Recall" && craw9 === e.raw && t >= cs9 - 1 && t <= cs9 + 4);
          const vCap9 = ridingNow9 || recallNow9
            ? undefined : speedOf(e.unit || "Marine", t, e.ups) * 1.15;
          /* 걸음 시계 — 코어 자취가 제 시각에 제자리라 지금 시각 그대로다.
             탐색(1.5초 넘는 건너뜀)은 지금 시각으로 맞추고, 싸우는 동안은 멈추며,
             그 밖에는 빚이 있으면 TRACK_CATCHUP으로 달려 따라잡는다. */
          /* 걸음 시계는 코어 것이다(과제 #61 → 정식 배포) — 빚·따라잡기·상한은
             "명령 좌표를 언제 지날까"를 렌더러가 어림하던 시절의 장치다. 코어
             자취는 이미 제 시각에 제자리라, 여기서 시각을 미루면 코어가 낸 값을
             렌더러가 도로 흔드는 꼴이 된다. */
          const eff9 = t;
          const rawPos = posAt(rp, eff9);
          if (!rawPos) return null;
          /* 탑승 중(요청: 수송선 승하차) — 배 안에 있으니 마커를 걷는다. 하차 지점
             (f=13)이나 다음 제 명령에서 다시 나타나 걷는다.
             승하차 연출(요청) — 태울 땐 빛기둥이 내리고 그 안에서 몸이 작아지며 떠올라
             사라지고, 내릴 땐 거꾸로다. rideK 0=제 모습, 1=완전히 빨려듦. */
          /* 승하차 길이는 **원작의 딜레이 그대로**다(요청: "탑승 딜레이시간에 딱 맞추기")
             — 태우기는 게이트 주기 9프레임(0.378초), 내리기는 한 기당 18프레임(0.756초)
             이고 그 값은 표(bwTransport)가 든다. 0.9초 고정이던 옛 값은 태우기가 실제
             딜레이의 2.4배라, 배가 벌써 떠난 뒤에도 몸이 남아 빨려 들어가고 있었다. */
          const rideInSec = PICKUP_POLL_SEC;
          const rideOutSec = UNLOAD_GAP_SEC;
          if (e.rides.some(([ra, rb]) => t >= ra + rideInSec && t < rb)) return null;
          let rideK = 0;
          /** 승하차 회전(도) — 한 바퀴 뱅글(요청). 태울 땐 0→360, 내릴 땐 그 반대다. */
          let rideSpin = 0;
          const rideIn9 = e.rides.find(([ra]) => t >= ra && t < ra + rideInSec);
          const rideOut9 = e.rides.find(([, rb]) => t >= rb && t < rb + rideOutSec);
          if (rideIn9) {
            rideK = Math.min(1, (t - rideIn9[0]) / rideInSec);
            rideSpin = rideK * 360;
          } else if (rideOut9) {
            rideK = Math.max(0, 1 - (t - rideOut9[1]) / rideOutSec);
            rideSpin = -rideK * 360;
          }
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
          /* 버로우(지적: 러커와 버로우 러커가 같이 움직인다 / 변태 알에서 나오자마자
             버로우 상태로 나온다) — 여태 '러커가 안 움직이면 땅속'이라는 어림이었다.
             그 한 줄이 두 가지를 동시에 틀리게 했다: 걸음이 멎기만 하면(랠리 도착·
             교전 홀드·갓 태어난 순간) 땅속으로 보이고, 반대로 땅속인데 자취가 흐르면
             구멍이 따라 미끄러졌다. 이제 커맨드 증거(f=18/19)를 시즈와 같은 잣대로
             읽는다. 판 시각(burrowAt)은 아래에서 그 자리에 못 박는 데 쓴다. */
          const burrowAt = BURROWABLE.has(drawUnit) ? burrowStartOf(e.burrows, t) : -1;
          const burrowed = burrowAt >= 0;
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
          /* 대공 무기가 없으면 떠 있는 건물은 표적이 아니다(요청: 띄운 건물은 공중
             유닛이다). 명단을 또 적지 않고 표에 묻는다 — 대공 사거리가 −1이면 그 유닛은
             하늘을 못 친다. 이름을 모르는 개체(k="")는 표가 기본값으로 떨어져 조용히
             틀리므로 아는 이름일 때만 가른다. */
          const noAir9 = drawUnit !== "" && isKnownKind(drawUnit)
            && fireRangeTilesOf(drawUnit, true) < 0;
          let foe: { bx: number; by: number; bd: number; air: boolean; bld?: boolean; k?: string } =
            nearestFoe(team, rawPos.x, rawPos.y, undefined, noAir9);
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
            /* 팀 미상(0)은 표적으로도 안 삼는다(위 nearestFoe 주석과 같은 오인 방지).
               아군은 표적이 될 수 있다(요청: 명시적 어택은 아군도 지정) — 여기 오는
               태그는 A를 누르고 직접 찍은 명령뿐이라(우클릭 격상은 적에게만 붙는다)
               같은 편 태그가 실렸다면 사람이 정말 제 유닛을 찍은 것이다. */
            // 은신·버로우는 콕 찍은 어택이라도 디텍터 없이는 못 겨눈다(요청).
            if (tp && tp.hidden && !detectedBy(team, tp.x, tp.y)) continue;
            if (tp && tp.team > 0 && (team ?? 0) > 0
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
          /* 붙는 거리는 시야가 아니라 **자동 획득 사거리**다(과제 #48) — 여태 이 파일의
             교전은 전부 ENGAGE_SIGHT_TILES 9 하나로 갈렸다. 그래서 저글링(획득 3)이
             화면 반대편의 적을 보고 달려들고, 시즈 모드(12)는 오히려 사거리 안에 든
             적을 보고도 더 걸어 들어갔다. 원작은 시야·자동 획득·무기 사거리가 셋 다
             다른 값이고, 여기 필요한 것은 가운데 것이다. 표에 없는 이름과 획득값 0
             (드랍십·베슬·오버로드처럼 스스로 표적을 안 잡는 것들)만 옛 9로 물러난다 —
             지어낸 값을 쓰느니 알던 어림이 낫고, 그것들은 어차피 canFight에서 걸린다. */
          const acq9 = drawUnit !== "" && isKnownKind(drawUnit)
            ? (acquireTilesOf(drawUnit) || ENGAGE_SIGHT_TILES) : ENGAGE_SIGHT_TILES;
          let fighting = canFight && !frzSt && !burrowed && Number.isFinite(foe.bd)
            && (foe.bd <= acq9 * (engagedBefore ? 1.3 : 1)
              /* 어택이 찍은 건물은 14.4타일부터 접근 시작(기획서 1-E — 수리: 시야
                 게이트가 철거 행군을 9타일 밖에서 세워 뒀다). */
              || (foe.bld === true && foe.bd <= ENGAGE_SIGHT_TILES * 1.6));
          let pos = rawPos;
          /* 교전 당김·홀드·잽은 코어가 켜지면 안 돈다(과제 #61) — 코어는 표적까지
             걸어가 사거리에서 멈추는 일을 제 이동 모형으로 이미 했다. 여기서 한 번 더
             끌면 두 모형이 같은 몸을 밀고, 어차피 아래에서 코어 자리로 덮여 버려질
             값을 프레임마다 셈하는 것이기도 하다. */
          // 다음 프레임을 위한 걸음 시계 기록 — 싸우는(유예 포함) 동안은 멈춰 둔다.
          /* 가스 왕복(지적: 가스 캐는 일꾼이 하나도 없다) — 배정 클릭은 한 번만 남고
             그 뒤는 게임이 자동 순환이라, 개체가 정제소 위에 서서 건물에 가려져 있었다.
             제 정제소 곁(2타일)에 선 일꾼은 가장 가까운 홀과 그 사이를 결정적으로
             왕복한다 — 어림 장식이 아니라, 그 일꾼이 실제로 가스에 배정된 개체다. */
          /* 채취 왕복도 코어 몫이다(과제 #61) — 코어에는 밭 배정과 왕복이 들어 있다
             (simCore.assignJob). 렌더러의 결정적 왕복은 코어가 없던 때의 대역이라,
             켜져 있으면 같은 일꾼을 두 박자로 흔들 뿐이다. */
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
          /* 코어 자리로 못 박는다(기획서 P1, ?sim=1) — 이제 위의 걸음(rawPos)부터가
             코어 자취를 읽은 값이라(과제 #61) 여기서 자리가 달라질 일은 사실상 없다.
             남는 몫은 둘이다: 코어만 아는 몸 방향(hdg)과, 배 안(ST_INSIDE)이면 아예
             안 그리는 판정. 코어 결과가 아직 없으면(계산 중·실패) 렌더러 길 그대로다.
             아래 스무딩도 코어면 건너뛴다 — 이미 제 속도로 적분된 자리다. */
          let simHdg: number | null = null;
          /** 코어가 말하는 지금 상태 — 사주경계는 '정말 서 있을 때'만이라 이 값이 필요하다. */
          let simState: number | null = null;
          const simTr = simTracks?.get(e.tag);
          if (simTr) {
            const sp = posAtSim(simTr, t);
            if (sp) {
              if (sp.state === ST_INSIDE) return null;
              pos = { ...pos, x: sp.x, y: sp.y };
              simHdg = sp.hdg;
              simState = sp.state;
            }
          }
          /* 얼어붙은 것은 코어보다 위다(전수조사: 스태시스·마엘스톰·락다운) — 코어는
             그 기술을 모르니 제 갈 길을 계속 걷는다. 못 박는 쪽은 증거다. 여태 이
             덮어쓰기가 코어 덮어쓰기보다 **앞**에 있어, 코어를 켜면 언 유닛이 그대로
             걸어 다녔다(과제 #61 — 두 모형이 같은 몸을 밀던 자리). */
          if (frzSt) {
            const fp2 = posAt(rp, Math.max(rp[0][0], frzSt[0]));
            if (fp2) pos = { ...pos, x: fp2.x, y: fp2.y };
          }
          /* 땅에 박혀 있다(지적: 러커와 버로우 러커가 같이 움직인다) — 땅속인 동안은
             자취·교전 당김·시뮬이 무슨 자리를 내놓든 판 그 자리다. 아래 스무딩보다
             앞에 둬, 파고드는 순간에는 미끄러져 들어가고 그 뒤로는 못 박힌다. */
          if (burrowed) {
            const bp2 = posAt(rp, Math.max(rp[0][0], burrowAt));
            if (bp2) pos = { ...pos, x: bp2.x, y: bp2.y };
          }
          /* 화면 스무딩(지적: 뚝뚝 끊김 → 재요청: 순간이동 무조건 제거, 아무리 짧아도
             스무스) — 지난 프레임 표시 자리에서 목표로 지수 추종. 거리 상한(6타일 스냅)
             을 걷어 드랍·리콜 급 큰 이동도 빠른 미끄럼으로 잇는다. 시간 되감기·큰 시간
             건너뜀(탐색)만 그 자리 리셋이다. */
          if (!simTr) {
            const mem2 = drawPosRef.current.get(holdKey);
            if (mem2 && t >= mem2.at && t - mem2.at < 1.5) {
              const dt5 = t - mem2.at;
              const k5 = 1 - Math.exp(-dt5 * 6);
              let nx5 = mem2.x + (pos.x - mem2.x) * k5;
              let ny5 = mem2.y + (pos.y - mem2.y) * k5;
              /* 활강 속도 상한(지적: 갓 태어난 유닛이 랠리로 확 미끄러짐) — 지수 추종은
                 먼 어긋남일수록 초반이 광속이라 표시 이동을 죈다. 상한은 제 속도표의
                 1.5배(요청: 걸음 속도 상한) — 한 자로 9타일을 쓰면 걸음 3타일짜리
                 질럿도 초당 9타일까지 미끄러졌다. 추종의 따라잡기 몫이라 걸음보다는
                 넉넉히 준다. 드랍·리콜은 걸음 상한에서 빠지지만 화면 추종은 종전대로
                 9타일로 죈다 — 순간이동 무조건 금지가 화면의 원칙이다. */
              const md5 = Math.hypot(nx5 - mem2.x, ny5 - mem2.y);
              const cap5 = (vCap9 === undefined ? 9 : (vCap9 / 1.15) * 1.5) * dt5;
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
            const dp0 = dmem0 ?? posAt(rp, Math.max(rp[0][0], dieAt));
            const dpx = dp0 ? dp0.x : ax3;
            const dpy = dp0 ? dp0.y : ay3;
            /* 공중은 떠 있던 몸 자리에서 터진다(지적) — 비행 높이만큼 위로. */
            const dieLift = uAir
              ? (drawUnit === "" ? unitGlyphPx(unitMarkerKind("", race), unitMarkerKind("", race), 0, dpy)
                : unitPxOf(drawUnit, dpy)) * 1.6 : 0;
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
          /* 시즈모드(지적: 판정을 리플레이에서) — Siege/Unsiege 커맨드 증거 그대로. */
          let siegeOn = 0;
          for (const [ss2, on2] of e.sieges) { if (ss2 <= t) siegeOn = on2; else break; }
          const drawUnit2 = siegeOn === 1 && drawUnit.startsWith("Siege Tank")
            ? "Siege Tank (Siege Mode)" : drawUnit;
          /* 표적 거리는 '그려지는 몸'에서 다시 잰다(지적: 맞는 대상이 없는데 공격한다 /
             둘이 너무 멀어 따로 놀아 보인다) — foe.bd는 원자취(명령 좌표) 기준인데,
             화면의 몸은 교전 당김·잽·채굴 왕복·겹침까지 실린 딴 자리에 있다. 그 둘이
             몇 타일씩 벌어진 채로 사격 판정과 조준각을 원자취 거리로 내리다 보니, 몸
             옆에 아무도 없는데 트레이서가 나가고 각도도 엉뚱한 데를 겨눴다. 아래 사격
             ·조준·가시 길이는 전부 이 값을 쓴다. */
          /* 시뮬이 켜져 있으면 사격도 시뮬 것이다(P2) — 렌더가 제 나름의 교전 판정으로
             그리면 시뮬과 따로 논다(몸은 싸우는데 트레이서는 딴 데를 겨눈다). 이번 틱에
             그 태그가 쏜 발이 있으면 그 표적이 곧 조준점이고, 없으면 안 쏜다. */
          const simShot = simShots?.get(e.tag) ?? null;
          if (simShots) {
            if (simShot) {
              foe = { bx: simShot[0], by: simShot[1], bd: Math.hypot(simShot[0] - pos.x, simShot[1] - pos.y), air: false };
              fighting = true;
            } else {
              fighting = false;
            }
          }
          const foeDist = Number.isFinite(foe.bd)
            ? Math.hypot(foe.bx - pos.x, foe.by - pos.y) : Infinity;
          /* 몸 방향(지적: 트레이서와 불일치 + 뒤로 걷기) — 싸울 땐 표적을 바라보고,
             걸을 땐 실제 화면 이동 방향을 본다(headingOfDisplay). */
          const foeDeg = foeDist <= ENGAGE_SIGHT_TILES
            ? Math.atan2(-(foe.bx - pos.x), foe.by - pos.y) * (180 / Math.PI) : null;
          /* 싸울 때도 '움직이면 이동 방향'이 먼저다(요청) — 표적 고정 요잉은 잽으로
             파고들거나 진형이 밀릴 때 몸이 옆·뒤로 미끄러지게 만들었다. 제자리에 선
             순간에만 표적을 본다. */
          const bodyHdg0 = simHdg !== null ? simHdg : headingOfDisplay(
            holdKey, pos.x, pos.y, headingOf(rp, rawPos),
            fighting && foeDeg !== null ? foeDeg : null,
          );
          /* 사주경계(요청: "제자리 서있는 유닛들이 주기적으로 사주경계를 함 … 하는 유닛이
             있고 안 하는 유닛이 있고 패턴도 다르다") — 원전의 정체는 iscript 옵코드
             turnrand다([OBW] bwgame.h:14921): 몸을 8_dir×a(11.25도의 배수)만큼 돌리되
             네 번에 한 번만 반시계, 나머지는 시계다(시계 쪽으로 치우친 무작위).
             ⚠ **누가 어떤 박자로 도는가는 iscript.bin에 있고 우리 자료에는 없다** —
               BWAPI·units.dat·flingy.dat 어느 덤프에도 스크립트는 안 들어 있다(게임 MPQ를
               IceCC로 풀어야 나온다). 그래서 여기 [어림]은 둘이다:
                 ① 도는 유닛 — 커뮤니티 문서가 확인해 주는 보병(마린이 총을 들었다 내리며
                    두리번거린다)만 켠다. 차량·기계·일꾼·공중은 안 켠다.
                 ② 박자 — 3.2초마다 한 번, 태그로 위상을 흩어 부대가 한꺼번에 안 돈다.
               도는 **양과 방향**만은 원전 그대로다(11.25도 배수·시계 3:1).
             iscript 덤프를 구하면 이 블록의 표만 갈면 정확해진다. */
          const bodyHdg = (() => {
            if (!IDLE_SCAN.has(drawUnit2) || fighting || burrowed) return bodyHdg0;
            if (simState !== null && simState !== 0) return bodyHdg0;   // 0 = ST_IDLE
            const step = Math.floor(t / IDLE_SCAN_SEC + (e.tag % 7) / 7);
            const r = (step * 2654435761 + e.tag * 40503) >>> 0;   // 결정론 난수(같은 입력=같은 그림)
            const amt = 1 + (r % 2);                                // 11.25 또는 22.5도
            const ccw = (r >>> 8) % 4 === 1;                        // 네 번에 한 번만 반시계
            return bodyHdg0 + (ccw ? -1 : 1) * amt * 11.25;
          })();
          /* 지금 체력(요청: 체력을 지니고 다닌다) — 변곡점 목록에서 t 시점 값.
             내려간 변곡점의 시각은 곧 '이 개체가 실제로 맞은 순간'이라, 피격 불티를
             그 자리·그 때에 띄우는 자로 함께 쓴다(요청: 피격 표현 재검토). */
          /* 체력은 실제 수치다(지적: "체력은 반올림 없이 실제 수치로") — 자취의 값이
             곧 남은 체력(실드 포함)이라, 만피는 표에서 가져와 나눈다. */
          const hpFull = (() => {
            const st0 = UNIT_STATS[drawUnit2] ?? UNIT_STATS[drawUnit];
            return st0 ? st0.hp + (st0.sh ?? 0) : 40;
          })();
          let hpNow = hpFull;
          let hurtAt = -99;
          for (const [hs2, hv2] of e.hp) {
            if (hs2 > t) break;
            if (hv2 < hpNow) hurtAt = hs2;
            hpNow = hv2;
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
            : isWorker ? workerLoadKind(workerKindOf(race), simState)
              : unitMarkerKind(drawUnit2, race));
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
            z: pitched || uAir ? 1000 + Math.round(ay3 * Z_TILE) + 400 : 1000 + (ei % 137),
            kind: kindMain,
            selRing: selNow || undefined,
            // 보임 토글이면 만피여도 표시(요청: 모든 유닛·건물 다 표시).
            hpFrac: Math.max(0.04, Math.min(1, hpNow / Math.max(1, hpFull))),
            hpMax: hpFull,
            // 정보 팝업 신원(요청) — 개체 태그가 프레임을 건너 같은 몸을 가리킨다.
            pickKey: `u${e.tag}`, pickName: e.unit, pickRaw: e.raw,
            /* 지금 무슨 상태인가(요청: 모든 상태 노출) — 땅속·은신·얼음·전투까지, 몸이
               이미 아는 것을 글로 옮긴다. 없으면 상태 줄을 안 적는다. */
            pickStatus: (() => {
              const a4 = e.statuses.find(([sa5, sb5]) => t >= sa5 && t < sb5);
              return a4 ? a4[2] : undefined;
            })(),
            pickState: (() => {
              const st: string[] = [];
              if (burrowed) st.push("땅속");
              /* 은신(요청) — 연구로 켠 창(e.cloaks)과 늘 은신인 둘. 아비터 은신장은
                 곁 유닛 사정이라 이 자리에서 모른다. */
              if (e.cloaks.some(([ca2, cb2]) => t >= ca2 && t < cb2)
                || e.unit === "Dark Templar" || e.unit === "Observer") st.push("은신");
              const actSt2 = e.statuses.find(([sa4, sb4]) => t >= sa4 && t < sb4);
              if (actSt2) st.push(STATUS_KO[actSt2[2]] ?? actSt2[2]);
              return st.length > 0 ? st.join(" · ") : undefined;
            })(),
            tint: (() => {
              const actSt = e.statuses.find(([sa3, sb3]) => t >= sa3 && t < sb3);
              return actSt ? STATUS_TINT[actSt[2]] : undefined;
            })(),
            // 승하차 뱅글(요청) — 몸 방향에 한 바퀴를 얹는다. 요잉 버킷이 16방이라
            // 스프라이트는 이미 구워 둔 판을 돌아가며 쓸 뿐, 새로 굽지 않는다.
            rotDeg: burrowed ? undefined : bodyHdg + rideSpin,
            viewYaw: viewYawOf(ax3, ay3), flat: !pitched, pitch: pitched,
            /* 크기 열쇠 셋을 바로잡는다(지적 셋을 한 줄에서 고친다):
               ① drawUnit이 아니라 drawUnit2 — 시즈모드 탱크가 "tank" 줄에서 크기를 받아
                  tanksiege 손잡이가 죽은 값이었다.
               ② 그리는 모델은 kindMain(tankbody·burrowhole·lurkeregg…)이므로 잉크 몫은
                  그쪽에서 찾는다. 원작 치수는 여전히 유닛 것이다(버로우한 히드라 구멍은
                  히드라 크기).
               ③ 이름 없는 유닛은 제가 그려지는 모델(kindMain = 종족 기본 보병)의 크기다.
                  예전엔 그림은 마린인데 상자는 SCV라 25% 어긋났다. */
            sizePx: (drawUnit === ""
              ? unitGlyphPx(kindMain, kindMain, 0, ay3) : unitPxOf(drawUnit2, ay3, kindMain))
              * (1 - rideK * 0.75), // 승하차 축소(요청)
            // 진형 간격은 원작 몸 지름 — 그리기 크기를 만져도 안 흔들린다.
            sepPx: drawUnit === "" ? unitSepPxOf("?") : unitSepPxOf(drawUnit2),
            /* 태울 땐 떠오르며 사라지고, 내릴 땐 그 반대로 내려오며 드러난다(요청)
               — rideK가 태우기에서 0→1, 내리기에서 1→0이라 한 식이 둘을 다 낸다. */
            rise: rideK * 1.6,
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
          // 잠깐만 뜬다(지적: "절대 움직임 없게 잠깐 표시") — 0.7 → 0.3초.
          const hitNow = t - hurtAt <= 0.3;
          /* 효과는 가슴 높이(지적: 공격 효과가 너무 낮다 — 발밑에서 튀었다) — 마커
             기준점은 발 자리라, 유닛 키의 1/3만큼 띄워 몸통에 맞춘다. */
          const fxPx = drawUnit === ""
            ? unitGlyphPx(kindMain, kindMain, 0, ay3) : unitPxOf(drawUnit2, ay3, kindMain);
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
          const shieldUp9 = shShare9 > 0
            && hpNow / Math.max(1, hpFull) > 1 - shShare9 + 0.001;
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
                  /* 맞는 방향에, 움직임 없이 잠깐(지적) — 코어의 발사 사건에서 쏜 쪽
                     자리를 찾아 몸 테두리 쪽으로 옮긴다. 방향을 모르면(사건이 없거나
                     증거만으로 아는 피격) 예전처럼 몸 가운데다. */
                  width: `${(fxPx * 0.42).toFixed(1)}px`,
                  height: `${(fxPx * 0.42).toFixed(1)}px`,
                  transform: (() => {
                    const from9 = simHits?.get(e.tag);
                    if (!from9) return "translate(-50%, -60%)";
                    const dx9 = from9[0] - pos.x;
                    const dy9 = (from9[1] - pos.y) * (pitched ? PITCH_FLAT : 1);
                    const len9 = Math.hypot(dx9, dy9) || 1;
                    const r9 = fxPx * 0.34;      // 몸 반지름 언저리
                    return `translate(calc(-50% + ${((dx9 / len9) * r9).toFixed(1)}px), `
                      + `calc(-60% + ${((dy9 / len9) * r9).toFixed(1)}px))`;
                  })(),
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
             버로우한 채 적이 사거리 안이면 명령 없이도 가시를 쏜다. 럴커는 수가 적으니
             1/3 솎기도 안 태운다.
             값은 표에서 온다: 무기 사거리 6타일(Subterranean_Spines 192px). 주석은 6이라
             적어 놓고 코드는 '여유 7'을 사거리로 쓰고 있었다. 그리고 가시는 지상 전용
             무기라 공중 표적에는 안 나간다. */
          const lurkRange = fireRangeTilesOf("Lurker", false);
          const lurkStrike = burrowed && !frzSt && !foe.air && foeDist <= lurkRange
            /* 시뮬이 돌면 쿨다운(36~39프레임)도 시뮬 것이다 — 이번 틱에 그 태그의 발사가
               없으면 가시도 없다. 안 그러면 사거리 안에 적이 있는 내내 가시가 끊기지 않고
               솟는다. */
            && (!simShots || simShot !== null);
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
            let ddy = (fy9 - pos.y) * tPx9 * (pitched ? PITCH_FLAT : 1);
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
          /* 앵커도 몸과 같은 배수를 탄다(정규화) — 모델 공간을 상자 중심으로 키웠으니
             앵커의 '중심 대비 좌표'도 같은 배수로 늘어난다. 안 태우면 트레이서가 포신
             끝을 벗어난다.
             단 **배수는 앵커가 붙은 판의 것**이어야 한다. 탱크·시즈탱크의 총구는 차체가
             아니라 포신 판(tankgun·tanksiegegun)에 있는데 fxKind는 합본 이름(tank·
             tanksiege)이라, 그대로 쓰면 1.52배·1.79배 어긋난다. 짝은 modelNormOf가
             차체 배수로 접으므로 결국 차체·포신·앵커 셋이 한 배수를 쓴다. */
          /* 버로우 상태에서는 몸이 제 모델이 아니라 **구멍 판**으로 그려진다(kind0가
             "burrowhole"이다). 앵커 배수도 그 판을 따라야 한다 — 럴커 0.627 대 구멍
             0.832라 그대로 두면 1.327배 어긋나 가시가 구멍의 32% 자리에서 솟는다
             (지금은 53%다). 히드라가 버로우한 채 맞을 때도 같은 갈래다. */
          /* 그 무기의 쿨다운(초) — 트레이서 번쩍임 길이의 자다(위 animationDuration 주석).
             업그레이드·스팀은 안 본다: 눈에 보이는 것은 '이 무기가 얼마나 자주 쏘나'다. */
          const fxCd = (() => {
            const pf9 = isKnownKind(fxUnit) ? profileOf(fxUnit) : null;
            const w9 = pf9 ? weaponVs(pf9, foe.air) : null;
            const cd9 = w9 ? w9.cd : 0.6;
            return Math.min(0.32, Math.max(0.08, cd9 * 0.35));
          })();
          const mzS = modelNormOf(burrowed ? "burrowhole" : (MUZZLE_PLATE[fxKind] ?? fxKind));
          const mzTf = mzP
            ? `translate(${(((mzP[0] - 8) * mzS * fxPx) / 16).toFixed(1)}px, ${((((mzP[1] - 8) * mzS * fxPx) / 16) + 0.1 * fxPx).toFixed(1)}px) rotate(${beamDeg!.toFixed(1)}deg)`
            : `rotate(${beamDeg?.toFixed(1)}deg) translateY(${MUZZLE_PX[fxUnit] ?? 4}px)`;
          return (
            <span
              key={`v2fx-${ei}`}
              className="scr-motion-army scr-motion-dot scr-v2fx"
              /* 럴커 가시는 가슴 높이가 아니라 땅에서 솟는다 — 들어올림 없이. */
              style={{ ...posStyle(ax3, ay3), zIndex: 1310, ...glyphStyle(e.raw, team), ...(lurkStrike ? {} : fxLift) }}
            >
              {/* 메딕도 그린다(요청: "메딕 노란 작은 동그란 빛") — 여태 heal만 갈래에서
                  빠져 있어 매딕은 아무 표시가 없었다. 빛 하나라 조준각만 타면 된다. */}
              {atkDeg !== null && ATTACK_FX[fxUnit] && (
                <span
                  /* 지상·대공이 다른 무기는 표적을 보고 갈아 끼운다(요청) — 레이스(지상
                     레이저/대공 미사일)·골리앗(총/대공 미사일)·스카우트(플라즈마/대공
                     미사일)가 그 셋이다. */
                  className={`scr-motion-tracer scr-tracer-${
                    (fxUnit === "Wraith" || fxUnit === "Goliath" || fxUnit === "Scout") && foe.air
                      ? "missile" : ATTACK_FX[fxUnit]}`}
                  /* 럴커 가시는 표적에서 멈추지 않는다 — 원작의 가시는 표적 자리가 아니라
                     늘 '제 자리 + 방향 × 최대 사거리'로 나아가(iscript behaviour 9), 그
                     직선 위의 적 지상 유닛을 모두 훑고 지나간다. 그래서 길이는 표적까지
                     거리가 아니라 212px 고정이고, 훑는 시간도 가시 속도(18.75px/프레임)가
                     정한 0.475초다. 예전의 '표적까지 실거리'는 지나쳐 맞는 그림을 지웠다.
                     px→타일은 원작의 한 타일 = 32px. */
                  style={{
                    transform: mzTf, animationDelay: `${((ei * 7) % 5) / 10}s`,
                    /* 길이는 그 무기의 쿨다운에 매인다(지적: "타이밍을 아주 짧게 가져간다
                       (공속에 반비례)") — 빨리 쏘는 무기일수록 번쩍임이 짧아 다음 발과 안
                       겹치고, 느린 무기(시즈·가디언)는 조금 길게 남는다. 쿨다운의 35%를
                       0.08~0.32초로 죈다. 표 값이라 손으로 정한 수는 상한·하한 둘뿐이다. */
                    animationDuration: `${fxCd.toFixed(3)}s`,
                    ...(lurkStrike ? {
                      height: `${((LURKER_SPINE_TRAVEL_PX / 32) * ((mapRef.current?.clientWidth ?? 320) / grid.width)).toFixed(1)}px`,
                      animationDuration: `${(LURKER_SPINE_TRAVEL_PX / LURKER_SPINE_SPEED_PX * FRAME_SEC).toFixed(3)}s`,
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
        {clickFx && entClicks.map(([cs, cx2, cy2, raw, ck], i) => {
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
        {qPing && (entData?.pings ?? []).map(([ps, px, py, ppid], i) => {
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
              /* 스캔 지름은 실제 탐지 반경 그대로(요청) — 8타일짜리 장식 고리가 아니라,
                 그 안의 은신이 벗겨지는 바로 그 원이다. */
              "Scanner Sweep": ["scan", DETECT_TILES * 2], "Disruption Web": ["dweb", 5.5],
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
                >
                  {/* 스캔 별가루(요청: 뿌리면 그 자리에 별가루) — 원 안에 황금각으로
                      고르게 흩뿌린 작은 네 갈래 별들이 저마다 어긋난 박자로 반짝인다.
                      자리는 결정적이라 프레임마다 안 떨린다. */}
                  {tech === "Scanner Sweep" && SCAN_DUST.map(([dx9, dy9, dl9], di9) => (
                    <span
                      key={`d${di9}`}
                      className="scr-fx-dust"
                      style={{ left: `${dx9}%`, top: `${dy9}%`, animationDelay: `${dl9}s` }}
                    />
                  ))}
                </span>
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

        </div>
        {/* 유닛 캔버스 층(요청: 캔버스 전환 — 성능, 지적: 확대가 선명해야) — 렌즈 밖에
            둔다: CSS 확대에 태우지 않고 줌·팬을 그리기 좌표에 직접 입혀, 어느 배율에서도
            화면 해상도 그대로 또렷하다. unitOps는 렌즈 안 마커 계산부가 이 렌더에서
            채우고, 커밋 뒤 effect가 그린다. */}
        {/* 정보 팝업(요청) — 그린 op 목록을 붙들어 둬 클릭 판정이 훑는다. UnitLayer가
            겹침 이완으로 fx를 손보므로, 판정도 '그려진 자리'와 같은 값을 본다. */}
        {((): null => { opsRef.current = unitOps; return null; })()}
        {(() => {
          if (!picked) return null;
          const op = unitOps.find((o) => o.pickKey === picked);
          // 죽거나 무너져 이번 프레임에 없으면 팝업도 닫힌 것처럼 사라진다.
          if (!op) return null;
          const en = op.pickName ?? "";
          const ko = op.pickBld ? BUILDING_KO[en] ?? en : UNIT_KO[en] ?? en;
          const max = op.hpMax ?? 0;
          const cur = Math.max(0, Math.round((op.hpFrac ?? 1) * max));
          const sh = op.pickBld ? (BLD_STATS[en]?.[1] ?? 0) : (UNIT_STATS[en]?.sh ?? 0);
          const lines: React.ReactNode[] = [];
          /* 진행 바(요청: 스타 원작처럼 칸 수를 따라) — 원작 진행 바는 통짜가 아니라
             칸이 하나씩 차오른다. 열 칸으로 나눠 채운 만큼만 밝힌다. */
          const bar = (label: string, p9: number, col = "#6fe36f"): React.ReactNode => (
            <div className="scr-motion-info-prog" key={`${label}${p9.toFixed(2)}`}>
              <span className="scr-motion-info-line">{label}</span>
              <span className="scr-motion-info-bar">
                {Array.from({ length: 10 }, (_, k) => (
                  <i
                    key={k}
                    className={k < Math.round(p9 * 10) ? "is-on" : undefined}
                    style={k < Math.round(p9 * 10) ? { background: col } : undefined}
                  />
                ))}
              </span>
            </div>
          );
          /* 걸린 마법은 제 줄에 효과까지(요청) — 무엇에 걸렸는지보다 '그래서 어떻게
             되는가'가 읽는 사람이 알고 싶은 것이다. */
          if (op.pickStatus && STATUS_FX[op.pickStatus]) {
            const sfx = STATUS_FX[op.pickStatus];
            lines.push(
              <div className="scr-motion-info-line" key="fx" style={{ color: sfx.col }}>
                {`${STATUS_KO[op.pickStatus] ?? op.pickStatus} — ${sfx.fx}`}
              </div>,
            );
          }
          if (op.pickState) {
            // 건설·변태도 글 대신 칸 바로(요청).
            const m9 = /(\d+)%$/.exec(op.pickState);
            if (m9) lines.push(bar(op.pickState.replace(/\s*\d+%$/, ""), Number(m9[1]) / 100));
            else lines.push(op.pickState);
          }
          /* 실드는 따로 한 줄(요청) — 원작은 실드부터 깎이므로, 남은 값이 체력 몫을
             넘으면 그 초과분이 곧 남은 실드다. */
          /* 체력·실드도 원작 색을 따른다(요청: 실드 흰색·체력 연녹색 등 게임 테마를
             충실히) — 원작 체력 바는 가득하면 연녹, 절반 아래로 노랑, 3분의 1 아래로
             빨강이다. 실드는 그 위에 흰(옅은 하늘) 칸으로 얹힌다. */
          const hpOnly = Math.max(1, max - sh);
          const hpCur = Math.min(cur, hpOnly);
          const hpR = hpCur / hpOnly;
          lines.push(bar(`체력 ${hpCur} / ${hpOnly}`, hpR,
            hpR > 0.5 ? "#7ee07e" : hpR > 0.33 ? "#e8d94a" : "#e05a4a"));
          if (sh > 0) {
            const shCur = Math.max(0, cur - hpOnly);
            lines.push(bar(`실드 ${shCur} / ${sh}`, shCur / sh, "#f2f6ff"));
          }
          if (op.pickBld) {
            /* 생산·연구·큐(요청) — 생산 기록은 '완성 시각'이라, 지금 창 안이면 방금
               나온 것, 앞엣것은 큐로 읽는다(무엇이 언제 나오는지가 그대로 큐다). */
            const evs: [number, string, number][] = [];
            for (const u of PRODUCED_BY[en] ?? []) {
              const sec = UNIT_BUILD_SEC[u] ?? 30;
              for (const ps of prodDoneByRaw.get(op.pickRaw ?? "")?.[u] ?? []) evs.push([ps, UNIT_KO[u] ?? u, sec]);
            }
            evs.sort((a, b) => a[0] - b[0]);
            /* 진행률(요청) — 리플레이에 남는 건 완성 시각뿐이라, 거기서 생산 시간을
               빼 시작을 되짚는다. 지금이 그 사이면 '생산 중 NN%'다. */
            const making = evs.filter(([ps, , sec]) => t < ps && t >= ps - sec);
            const queue = evs.filter(([ps, , sec]) => t < ps - sec).slice(0, 4);
            const justOut = evs.filter(([ps]) => ps <= t && t - ps <= PROD_FLASH_SEC);
            if (making.length > 0) {
              for (const [ps, n, sec] of making) {
                lines.push(bar(`생산 중 ${n}`, Math.min(0.99, (t - (ps - sec)) / sec)));
              }
            } else if (justOut.length > 0) {
              lines.push(`생산 완료 ${justOut.map(([, n]) => n).join(" · ")}`);
            } else lines.push("생산 대기");
            if (queue.length > 0) {
              lines.push(`큐 ${queue.map(([ps, n, sec]) => `${n} +${Math.max(0, Math.round(ps - sec - t))}초`).join(" · ")}`);
            }
            const doing = (upsByRaw.get(op.pickRaw ?? "") ?? []).filter(([us]) =>
              RESEARCH_BUILDING[en === "Lair" || en === "Hive" ? "Hatchery" : en] === undefined
                ? false
                : RESEARCH_BUILDING[en === "Lair" || en === "Hive" ? "Hatchery" : en] === en
                  && us <= t && t - us <= RESEARCH_SEC);
            for (const [us, n] of doing) {
              lines.push(bar(`연구 중 ${TECH_KO[n] ?? n}`, Math.min(0.99, (t - us) / RESEARCH_SEC)));
            }
          } else {
            /* 그 유닛에 실제로 걸리는 공/방 줄만 레벨로 보여 준다(요청: 인게임보다
               풍부하게 — 해당 유닛의 업그레이드 상태). 줄 고르기는 종족과 공중 여부,
               테란만 보병/메카닉 갈래를 더 본다. */
            const race9 = bases.find((b) => b.key === op.pickRaw)?.race ?? "";
            const pairs = ARMOR_WEAPON_PAIRS[race9] ?? [];
            const air9 = isAirUnit(en);
            const infantry9 = new Set(["Marine", "Firebat", "Medic", "Ghost", "SCV"]);
            const melee9 = new Set(["Zergling", "Ultralisk", "Broodling", "Drone"]);
            const pick9 = pairs.find((pr) => {
              const w = pr.weapon;
              if (race9 === "테란") {
                return air9 ? w === "Terran Ship Weapons"
                  : infantry9.has(en) ? w === "Terran Infantry Weapons" : w === "Terran Vehicle Weapons";
              }
              if (race9 === "저그") {
                return air9 ? w === "Zerg Flyer Attacks"
                  : melee9.has(en) ? w === "Zerg Melee Attacks" : w === "Zerg Missile Attacks";
              }
              return air9 ? w === "Protoss Air Weapons" : w === "Protoss Ground Weapons";
            });
            const lv = (name: string): number =>
              (upsByRaw.get(op.pickRaw ?? "") ?? []).filter(([us, n]) => n === name && us <= t).length;
            if (pick9) {
              lines.push(`${UPGRADE_LINE_KO[pick9.weapon] ?? "공/방"} ${lv(pick9.weapon)}-${lv(pick9.armor)}`);
            }
            /* 공/방 말고 그 유닛에 붙는 기술(속업·사업 등)은 이름으로 걸러 준다 —
               표가 유닛을 직접 가리키지 않으므로, 임자가 마친 것 중 최근 것을 곁들인다. */
            const other = (upsByRaw.get(op.pickRaw ?? "") ?? []).filter(([us, n]) => us <= t && !pairs.some((pr) => pr.weapon === n || pr.armor === n));
            if (other.length > 0) {
              lines.push(`연구 완료 ${other.slice(-6).map(([, n]) => TECH_KO[n] ?? n).join(" · ")}`);
            }
          }
          const el = mapRef.current;
          const w9 = el?.clientWidth ?? 1;
          const h9 = el?.clientHeight ?? 1;
          const lx = ((op.fx - 0.5) * zoom + 0.5) * w9 + pan.x;
          const ly = ((op.fy - 0.5) * zoom + 0.5) * h9 + pan.y;
          return (
            <div
              className="scr-motion-info"
              style={{ left: Math.round(lx), top: Math.round(ly) }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="scr-motion-info-name">{ko}</div>
              {lines.map((ln, li) => (typeof ln === "string"
                ? <div key={li} className="scr-motion-info-line">{ln}</div>
                : <React.Fragment key={li}>{ln}</React.Fragment>))}
            </div>
          );
        })()}
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
      </div>

      {/* 색상 전환은 지도 바로 아래 왼쪽에 제 줄로 둔다(요청) — 보기 설정 줄에 성능·보기·
          모델 크기와 나란히 있던 것을 뺐다. 저것들은 한 번 맞춰 두고 마는 것이지만 색은
          재생 도중에도 계속 오간다. 라벨은 위가 아니라 왼쪽. 알약 자체는 다른 줄과 같은
          크기 그대로다(지적: 키웠더니 깨졌다 — scr-motion-colorrow 주석 참고).
          진행바는 이 줄 다음에 온다(지적: 진행바는 이 버튼 아래로). */}
      <div className="scr-motion-colorrow">
        {/* 라벨은 걷었다(요청) — 개인색/팀색이라 적혀 있어 '색상'은 같은 말의 되풀이다.
            알약도 보기·모델 크기와 완전히 같은 크기다(요청: 다른 토글들과 동일하게). */}
        <PillTabs
          options={[{ value: "personal", label: "개인색" }, { value: "team", label: "팀색" }]}
          value={colorMode}
          onChange={(v) => setColorMode(v)}
          aria-label="색상"
          toggle
        />
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
              { value: "1", label: "저" }, { value: "2", label: "중" }, { value: "3", label: "고" },
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
            toggle
            value={pitched ? "3d" : "2d"}
            onChange={(v) => setPitched(v === "3d")}
            aria-label="보기"
          />
        </span>
        <span className="scr-motion-radio">
          <span className="scr-motion-radio-label">모델 크기</span>
          <PillTabs
            options={[{ value: "s", label: "표준" }, { value: "l", label: "확대" }]}
            toggle
            value={unitBig ? "l" : "s"}
            onChange={(v) => setUnitBig(v === "l")}
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
            toggle
          />
        </span>
        {/* 마우스 조작 표시 — 개체 트랙이 오기 전에도 자리를 지킨다(지적: "마우스 조작이
            늦게 뜨는데 같이 처음부터 뜨게"). 예전에는 entOn 문턱에 걸려 자료가 도착한
            뒤에야 나타나 버튼 줄이 한 번 출렁였다. 켜 놔도 해가 없다 — 실제로 자국을
            그리는 층(아래 entOn && clickFx)이 자료를 따로 확인한다. */}
        <span className="scr-motion-radio">
          <span className="scr-motion-radio-label">마우스 조작</span>
          <PillTabs
            options={[{ value: "on", label: "보임" }, { value: "off", label: "숨김" }]}
            value={clickFx ? "on" : "off"}
            onChange={(v) => setClickFx(v === "on")}
            aria-label="마우스 조작"
            fit
            toggle
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
      {/* 진행바 아랫줄 — 왼쪽 배속, 오른쪽 현재 장면 공유(요청: "배속은 크기를 줄이고
          진행바 쪽으로 이동, 현재 장면 공유랑 같은 라인으로"). 공유 버튼이 없는 경기도
          있으므로 줄 자체는 배속만으로도 선다. */}
      <div className="scr-motion-bar scr-motion-sharerow">
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
        {shareNode}
      </div>
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
