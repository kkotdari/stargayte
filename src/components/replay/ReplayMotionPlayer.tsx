import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import Avatar from "../common/Avatar";
import { cx } from "../../utils/format";
import { UNIT_KO, TECH_KO } from "../../utils/replaySummaryText";
import type { ReplayMapGrid } from "../../utils/replayParser";
import { isAirUnit, type SummaryMotion } from "../../utils/replayMotion";
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

/** 자취에서 t 시각의 자리 — 사이는 보간(지상은 가운데로 휘는 곡선), 틈이 크면 앞 점에 머문다. */
function posAt(
  pts: [number, number, number][], t: number,
  bendCenter: { x: number; y: number } | null,
): { x: number; y: number; stale: boolean } | null {
  if (pts.length === 0) return null;
  if (t <= pts[0][0]) return { x: pts[0][1], y: pts[0][2], stale: false };
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [s0, x0, y0] = pts[i];
    const [s1, x1, y1] = pts[i + 1];
    if (t < s1) {
      if (s1 - s0 > LERP_MAX_GAP_SEC) return { x: x0, y: y0, stale: t - s0 > LERP_MAX_GAP_SEC };
      const k = (t - s0) / Math.max(1, s1 - s0);
      if (!bendCenter) {
        return { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, stale: false };
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
        stale: false,
      };
    }
  }
  const last = pts[pts.length - 1];
  return { x: last[1], y: last[2], stale: t - last[0] > LERP_MAX_GAP_SEC };
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
  /* 색 모드(요청) — 팀색(두 색)과 개인색(게임 내 유저 컬러) 사이를 오간다. 유저 컬러는
     어느 모드든 테두리에 입힌다(요청). 색을 못 읽은 옛 기록은 개인색 모드여도 팀색으로. */
  const [colorMode, setColorMode] = useState<"team" | "personal">("team");
  const colorByRaw = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of motion.players) if (p.color) m.set(p.raw, p.color);
    return m;
  }, [motion]);
  const chipStyle = (raw: string): React.CSSProperties => {
    const c = colorByRaw.get(raw);
    if (!c) return {};
    return {
      borderColor: c,
      ...(colorMode === "personal" ? { color: c } : {}),
    };
  };
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

  /* 무너진 건물(어림)은 그 시각 뒤로 그리지 않는다 — 무너진 직후 몇 초만 ✕로 말한다. */
  const buildsNow = motion.builds.filter((b) => {
    const gone = b[5] ?? 0;
    return b[0] <= t && (gone === 0 || t < gone + 6);
  });
  const castsNow = motion.casts.filter((c) => c[0] <= t && t - c[0] <= CAST_HOLD_SEC);

  return (
    <div className="scr-motion">
      <div className="scr-motion-map" ref={mapRef} style={{ aspectRatio: `${grid.width} / ${grid.height}` }}>
        {grid.image
          ? <img className="scr-motion-canvas" src={grid.image} alt={`${grid.name} 미니맵`} />
          : <div className="scr-motion-canvas scr-motion-canvas-blank" />}

        {/* 건물 — 자리·시각이 정확한 유일한 층이다. 갓 지은 것만 이름을 달고, 지나면 점만.
            무너진(어림) 건물은 ✕를 잠깐 보이고 사라진다(요청: 파괴 파악). */}
        {buildsNow.map(([sec, x, y, unit, raw, gone], i) => {
          const team = teamOfRaw(raw);
          const razed = (gone ?? 0) > 0 && t >= (gone ?? 0);
          const freshBuild = !razed && t - sec <= BUILD_LABEL_SEC;
          return (
            <span
              key={`b-${i}`}
              className={cx(
                "scr-motion-build",
                team === 2 ? "scr-motion-team2" : "scr-motion-team1",
                freshBuild && "scr-motion-build-fresh scr-motion-chip",
                razed && "scr-motion-build-razed",
              )}
              style={{
                left: pct(x, grid.width), top: pct(y, grid.height),
                ...(freshBuild ? chipStyle(raw) : colorMode === "personal" && colorByRaw.get(raw)
                  ? { color: colorByRaw.get(raw) } : {}),
              }}
            >
              {/* 한글명만 적는다(요청) — 이름을 모르는 건물은 점으로만. */}
              {razed ? "✕" : freshBuild ? (UNIT_KO[unit] ?? "▪") : "▪"}
            </span>
          );
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
              <Avatar member={{ id: m.memberId, nickname: m.name, avatar: m.avatar }} size={16} />
              {m.withName && (
                <span
                  className={cx("scr-motion-base-name", "scr-motion-chip", m.team === 2 ? "scr-motion-team2" : "scr-motion-team1")}
                  style={chipStyle(m.key)}
                >
                  {m.name}
                </span>
              )}
              {m.withName && workerN > 0 && (
                <span className="scr-motion-workers">일꾼 {workerN}</span>
              )}
            </span>
          );
        })}

        {/* 부대 자취 — 명령 좌표 기반 어림(모듈 주석). 우세 유닛 이름이 팀 색으로 흐른다. */}
        {motion.players.map((p) => {
          const unit = unitAt(p.units, t);
          const pos = posAt(
            p.pts, t,
            isAirUnit(unit) ? null : { x: grid.width / 2, y: grid.height / 2 },
          );
          if (!pos) return null;
          const team = teamOfRaw(p.raw);
          /* 규모를 크기로(요청) — 최근에 몰아 뽑은 병력 수의 제곱근으로 글자를 키운다.
             덩어리가 작거나(4 미만) 자취가 식었으면 점만 — 중요하지 않은 것은 점이다(요청). */
          let size = 0;
          for (const [sec, n] of p.size ?? []) {
            if (sec > t) break;
            size = n;
          }
          const small = size < 4;
          const fontPx = Math.min(16, 8 + Math.round(Math.sqrt(size) * 1.6));
          return (
            <span
              key={p.raw}
              className={cx(
                "scr-motion-army",
                !small && "scr-motion-chip",
                team === 2 ? "scr-motion-team2" : "scr-motion-team1",
                pos.stale && "scr-motion-army-stale",
              )}
              style={{
                left: pct(pos.x, grid.width), top: pct(pos.y, grid.height),
                fontSize: small ? undefined : fontPx,
                ...(small ? {} : chipStyle(p.raw)),
              }}
            >
              {/* 수도 함께 적는다(요청) — "질럿 12" 꼴. 이름을 모르면 수만. */}
              {small || !unit ? "●" : `${UNIT_KO[unit] ?? ""} ${size}`.trim()}
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
              style={{ left: pct(x, grid.width), top: pct(y, grid.height), ...chipStyle(raw) }}
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
          <button
            type="button"
            className={cx("scr-motion-btn", "scr-motion-colorbtn")}
            onClick={() => setColorMode((v) => (v === "team" ? "personal" : "team"))}
            aria-label="색 기준 전환"
            title="색 기준 전환"
          >
            {colorMode === "team" ? "팀색" : "개인색"}
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
    </div>
  );
}
