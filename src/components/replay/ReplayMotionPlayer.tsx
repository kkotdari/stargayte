import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Mountain, Pause, Play, RotateCcw } from "lucide-react";
import TerrainReviewModal from "../../modals/TerrainReviewModal";
import Avatar from "../common/Avatar";
import { cx } from "../../utils/format";
import { UNIT_KO, BUILDING_KO, TECH_KO } from "../../utils/replaySummaryText";
import type { ReplayMapGrid } from "../../utils/replayParser";
import { isAirUnit, type SummaryMotion } from "../../utils/replayMotion";
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
/** 건물 텍스트가 이름을 달고 있는 시간(초, 게임 시간) — 지나면 점만 남는다. */
const BUILD_LABEL_SEC = 45;
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

/** 커맨드를 받은 지 이 안이면 아직 '활동 중'이다(요청) — 이름표를 유지한다. */
const ACTIVE_HOLD_SEC = 8;
/** 재생 전용 이름 보강 — UNIT_KO에 없는 정찰 유닛(일꾼·오버로드). UNIT_KO에 넣으면 통계
 *  도넛·Top5까지 일꾼이 섞이므로(replayBuildMix가 그 표로 거른다) 여기서만 얹는다. */
const SCOUT_KO: Record<string, string> = {
  SCV: "SCV", Probe: "프로브", Drone: "드론", Overlord: "오버로드",
};
/** 생산 뒤 이 안이면 그 건물이 '일하는 중'이다(요청: 생산할 때 이름 표시). */
const PROD_FLASH_SEC = 6;

/* 무엇이 어디서 나오나 — 유닛이 나온 순간 그 종류의 건물이 일하고 있었다는 뜻이다. 어느
   채인지는 리플레이가 안 알려줘(생산 커맨드에 건물 번호가 없다) 같은 종류가 함께 켜진다.
   저그는 전부 해처리 계열(라바)이고, 러커·가디언처럼 유닛에서 변태하는 것은 건물 몫이
   아니라 뺀다. */
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
  grid, motion, endSec, bases, teamOfRaw, active = true, caps = [],
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
  /** 자막(요청: 예전처럼 미니맵 아래) — 재생 시각이 문장의 시각을 지나면 그 문장이 뜬다.
   *  시각 없는 문장(맺음말)은 재생이 끝까지 닿았을 때 나온다. beat 자체는 여기서 몰라도
   *  된다 — 문장과 초만 받는다. */
  caps?: { atSec: number | null; node: ReactNode }[];
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
  /* 색 규칙(요청: 위치 바꿈) — 안쪽 배경이 개인(게임 내) 컬러, 테두리가 팀 컬러다.
     테두리는 선명한 팀색으로 굵게(2px). 글자는 배경 밝기에 따라 흰/검. */
  const TEAM_EDGE: Record<1 | 2, string> = { 1: "#2f80ff", 2: "#e0435c" };
  /* 도형(●▪▲)의 색(요청) — 안쪽(글자색)이 개인색, 테두리(외곽선)가 팀색이다. */
  const shapeStyle = (raw: string, team: 1 | 2 | undefined): React.CSSProperties => ({
    color: colorByRaw.get(raw) ?? (team === 2 ? "#e0435c" : "#2f80ff"),
    WebkitTextStroke: `0.7px ${team === 2 ? "#e0435c" : "#2f80ff"}`,
  });
  const chipStyle = (raw: string, team: 1 | 2 | undefined): React.CSSProperties => {
    const personal = colorByRaw.get(raw);
    const bg = personal ?? (team === 2 ? "#5a2a31" : "#233c5c");
    const r = parseInt(bg.slice(1, 3), 16);
    const g = parseInt(bg.slice(3, 5), 16);
    const b = parseInt(bg.slice(5, 7), 16);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return {
      background: bg,
      color: lum > 150 ? "#111" : "#fff",
      borderColor: team === 2 ? TEAM_EDGE[2] : TEAM_EDGE[1],
      borderWidth: 2,
    };
  };

  /* 지형(요청: 미니맵 이미지 분석) — 그림에서 걷는 땅 격자를 만들어, 지상 부대의 자취를
     그 위의 경로로 편다. 분석 전·실패 시에는 기존 곡선 폴백. */
  const [terrain, setTerrain] = useState<TerrainGrid | null>(null);
  /* 지형 수정(요청: 모든 경기 리플레이 화면에서, 아무나) — 산 버튼이 검수 모달을 연다.
     저장하면 이 자리에서 바로 새 지형으로 갈아 끼운다(맵 캐시는 다음 로드에 새 값을 받는다). */
  const [terrainOpen, setTerrainOpen] = useState(false);
  const [walkOverride, setWalkOverride] = useState<string | null>(null);
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
  const refinedPts = useMemo(() => motion.players.map((p) => {
    if (p.pts.length === 0) return p.pts;
    const out: [number, number, number][] = [[p.pts[0][0], p.pts[0][1], p.pts[0][2]]];
    let atX = p.pts[0][1];
    let atY = p.pts[0][2];
    let atSec = p.pts[0][0];
    for (let i = 1; i < p.pts.length; i += 1) {
      const [orderSec, tx, ty] = p.pts[i];
      const nextOrderSec = i + 1 < p.pts.length ? p.pts[i + 1][0] : Infinity;
      // 명령이 올 때까지 서 있던 자리 — 같은 좌표의 점을 박아 그 구간을 정지로 만든다.
      if (orderSec > atSec) out.push([orderSec, atX, atY]);
      const startSec = Math.max(atSec, orderSec);
      const unit = unitAt(p.units, orderSec);
      const air = unit !== "" && isAirUnit(unit);
      let path: [number, number][] | null = null;
      if (!air && terrain) {
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
      const v = Math.max(0.5, speedOf(unit || "Marine", orderSec, p.ups));
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
  }), [motion, terrain, grid.width, grid.height]);
  // 기본은 ×2다(요청) — 처음부터 빨리 감으면 초반 정찰·빌드가 통째로 지나가 버린다.
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(2);
  const [done, setDone] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);

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

  /* 시계 — rAF로 게임 시간 t를 배속만큼 민다. state로 두는 이유는 매 프레임 그리는 것들
     (자취·건물·마법)이 전부 t의 함수라서다. */
  const clockRef = useRef<{ raf: number; last: number } | null>(null);
  useEffect(() => {
    if (!playing || !active) return undefined;
    const tick = (now: number) => {
      const c = clockRef.current;
      const dt = c ? (now - c.last) / 1000 : 0;
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

  /* 생산 시각 되짚기(요청: 생산할 때 건물 이름) — 사람×건물종류별로 생산 초들을 미리
     모아, 재생 중에는 "지금 창(6초) 안에 있나"만 본다. */
  const prodByRawType = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const p of motion.players) {
      for (const [type, units] of Object.entries(PRODUCED_BY)) {
        const secs: number[] = [];
        for (const u of units) for (const sec of p.prod?.[u] ?? []) secs.push(sec);
        if (secs.length > 0) {
          secs.sort((a, b) => a - b);
          m.set(`${p.raw}|${type}`, secs);
        }
      }
    }
    return m;
  }, [motion]);

  /* 본진 건물(확장 포함)의 자리 — 채굴 일꾼이 오갈 목적지다(지적: 자원 지대가 기준이고,
     거기서 가장 가까운 본진 건물로 왔다 갔다). 커맨드·넥서스·해처리 계열이 대상이다. */
  const halls = useMemo(() => motion.builds
    .filter(([, , , unit]) => ["Command Center", "Nexus", "Hatchery", "Lair", "Hive"].includes(unit))
    .map(([sec, x, y, , raw, gone]) => ({ sec, x, y, raw, gone: gone ?? 0 })), [motion]);
  const castsNow = motion.casts.filter((c) => c[0] <= t && t - c[0] <= CAST_HOLD_SEC);

  return (
    <div className="scr-motion">
      <div className="scr-motion-map" ref={mapRef} style={{ aspectRatio: `${grid.width} / ${grid.height}` }}>
        {grid.image
          ? <img className="scr-motion-canvas" src={grid.image} alt={`${grid.name} 미니맵`} />
          : <div className="scr-motion-canvas scr-motion-canvas-blank" />}

        {/* 건물(요청: 합치기 대신) — 기본은 작은 폰트의 이름이 늘 떠 있고, 활성화(건설·
            생산 중)일 때만 바운스로 커진다. 이름을 모르는 건물만 도형(▪/▲)이다. 색은
            안=개인·테두리=팀(요청). 무너진 것(어림)은 ✕로 잠깐. */}
        {motion.builds.map(([sec, x, y, unit, raw, gone], i) => {
          if (sec > t) return null;
          const goneAt = gone ?? 0;
          if (goneAt > 0 && t >= goneAt + 6) return null;
          const razed = goneAt > 0 && t >= goneAt;
          const team = teamOfRaw(raw);
          const producing = !razed && (prodByRawType.get(`${raw}|${unit}`) ?? [])
            .some((ps) => ps <= t && t - ps <= PROD_FLASH_SEC);
          const activeBuild = !razed && (producing || t - sec <= BUILD_LABEL_SEC);
          const name = BUILDING_KO[unit] ?? UNIT_KO[unit];
          return (
            <span
              key={`b-${i}`}
              className={cx(
                "scr-motion-build",
                activeBuild && "scr-motion-build-on",
                razed && "scr-motion-build-razed",
              )}
              style={{
                left: pct(x, grid.width), top: pct(y, grid.height),
                ...(razed ? {} : shapeStyle(raw, team)),
              }}
            >
              {razed ? "✕" : name ?? (DEFENSE_BUILDINGS.has(unit) ? "▲" : "▪")}
            </span>
          );
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
                  color: colorByRaw.get(owner!.raw) ?? (team === 2 ? "#e0435c" : "#2f80ff"),
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
              {/* 이중 테두리(요청) — 안쪽이 개인색, 바깥이 팀색이다. */}
              <span
                className="scr-motion-base-ring"
                style={{
                  boxShadow: `0 0 0 2px ${colorByRaw.get(m.key) ?? "rgba(255,255,255,0.35)"}, 0 0 0 4px ${m.team === 2 ? TEAM_EDGE[2] : TEAM_EDGE[1]}`,
                }}
              >
                <Avatar member={{ id: m.memberId, nickname: m.name, avatar: m.avatar }} size={16} />
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

        {/* 부대 자취 — 명령 좌표 기반 어림(모듈 주석). 우세 유닛 이름이 팀 색으로 흐른다. */}
        {motion.players.map((p, pi) => {
          const unit = unitAt(p.units, t);
          /* 지형 경로가 있으면 그 점들을 그대로 잇고(곡선 불필요), 없으면 가운데로 휘는
             곡선 폴백이다. 활동 판정(sinceLast)은 원본 명령 점으로 따로 잰다 — 경로로 편
             점들은 촘촘해서 그걸로 재면 늘 '방금 명령받음'이 된다. */
          const pos = posAt(
            refinedPts[pi], t,
            terrain || isAirUnit(unit) ? null : { x: grid.width / 2, y: grid.height / 2 },
          );
          if (!pos) return null;
          let sinceCmd = Infinity;
          for (const [sec] of p.pts) {
            if (sec > t) break;
            sinceCmd = t - sec;
          }
          const team = teamOfRaw(p.raw);
          /* 겉모습 규칙(요청) — 유닛은 동그라미가 기본이고, 커맨드를 받았거나 이동 중일
             때만 이름+수로 바뀐다(나중에 이미지가 이 자리를 물려받는다). 크기는 규모의
             제곱근(요청: 뭉친 병력은 크기로 수를 표현). */
          let size = 0;
          for (const [sec, n] of p.size ?? []) {
            if (sec > t) break;
            size = n;
          }
          const activeNow = pos.moving || sinceCmd <= ACTIVE_HOLD_SEC;
          const showName = activeNow && !!unit && (size >= 1 || !!SCOUT_KO[unit]);
          const fontPx = Math.min(16, 8 + Math.round(Math.sqrt(size) * 1.6));
          return (
            <span
              key={p.raw}
              className={cx(
                "scr-motion-army",
                showName && "scr-motion-chip",
                team === 2 ? "scr-motion-team2" : "scr-motion-team1",
                pos.stale && "scr-motion-army-stale",
              )}
              style={{
                left: pct(pos.x, grid.width), top: pct(pos.y, grid.height),
                fontSize: showName ? fontPx : Math.min(14, 7 + Math.round(Math.sqrt(size))),
                ...(showName ? chipStyle(p.raw, team) : shapeStyle(p.raw, team)),
              }}
            >
              {/* 수도 함께 적는다(요청) — "질럿 12" 꼴. 정찰 유닛(일꾼·오버로드)은 수 없이
                  이름만 — 세는 값(size)이 전투 유닛이라 정찰에는 뜻이 없다. */}
              {showName
                ? (UNIT_KO[unit] ? `${UNIT_KO[unit]} ${size}`.trim() : SCOUT_KO[unit] ?? "●")
                : "●"}
            </span>
          );
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

      {/* 자막 — 예전처럼 지도 아래다(요청). 문장을 전부 겹쳐 두고 지금 것만 보인다:
          칸 높이가 늘 가장 긴 문장이라 재생 중에 아래가 위아래로 안 흔들린다(스냅 시절과
          같은 수법). 지금 문장 = 시각이 t를 안 넘긴 마지막 문장, 맺음말(null)은 끝에서. */}
      {caps.length > 0 && (() => {
        let cur = -1;
        caps.forEach((c, i) => {
          if (c.atSec !== null ? c.atSec <= t : done) cur = i;
        });
        return (
          <div className="scr-motion-caps">
            {caps.map((c, i) => (
              <p key={i} className="scr-motion-cap-line" data-on={i === cur} aria-hidden={i !== cur}>
                {c.atSec !== null && <span className="scr-motion-cap-time">[{fmtClock(c.atSec)}]</span>}
                {c.node}
              </p>
            ))}
          </div>
        );
      })()}

      {/* 조종간(요청: 두 줄) — 윗줄은 스크러버 하나, 아랫줄에 재생·배속·시간이 선다. */}
      <div className="scr-motion-bar">
        <input
          className="scr-motion-range" type="range"
          min={0} max={total} step={1} value={Math.floor(t)}
          onChange={(e) => {
            const v = Number(e.target.value);
            setT(v);
            setDone(v >= total);
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
        {/* 지형 수정(요청) — 산 아이콘, 회원 누구나. 그림이 등록된 맵에서만 선다. */}
        {typeof grid.imageId === "number" && grid.image && (
          <button
            type="button" className="scr-motion-btn scr-motion-terrain"
            onClick={() => setTerrainOpen(true)}
            aria-label="지형 수정" title="지형 수정"
          >
            <Mountain size={12} />
          </button>
        )}
        <span className="scr-motion-clock">{fmtClock(t)} / {fmtClock(total)}</span>
      </div>
      {terrainOpen && typeof grid.imageId === "number" && grid.image && (
        <TerrainReviewModal
          image={{
            id: grid.imageId, name: grid.name || "미니맵",
            image: grid.image, walk: walkOverride ?? grid.walk,
          }}
          onClose={() => setTerrainOpen(false)}
          onSaved={(updated) => setWalkOverride(updated.walk ?? null)}
        />
      )}
    </div>
  );
}
