import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Avatar from "../common/Avatar";
import { cx } from "../../utils/format";
import { UNIT_KO, TECH_KO } from "../../utils/replaySummaryText";
import type { ReplayMapGrid } from "../../utils/replayParser";
import type { SummaryMotion } from "../../utils/replayMotion";
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

/** 배속 갈래 — 실시간(×1)은 30분짜리 판을 30분 보는 것이라 뜻이 없다. */
const SPEEDS = [8, 16, 32] as const;
/** 건물 텍스트가 이름을 달고 있는 시간(초, 게임 시간) — 지나면 점만 남는다. */
const BUILD_LABEL_SEC = 45;
/** 마법 텍스트가 떠 있는 시간(초, 게임 시간). */
const CAST_HOLD_SEC = 6;
/** 자취 점 사이가 이보다 벌어지면 잇지 않고 건너뛴다(초) — 한참 조용하다 다른 곳을 찍은
 *  것은 이동이 아니라 시선 전환이라, 이으면 부대가 맵을 순간이동으로 가로지른다. */
const LERP_MAX_GAP_SEC = 24;

const pct = (v: number, span: number) => `${(v / span) * 100}%`;

/** 자취에서 t 시각의 자리 — 사이는 직선 보간, 틈이 크면 앞 점에 머문다. */
function posAt(
  pts: [number, number, number][], t: number,
): { x: number; y: number; stale: boolean } | null {
  if (pts.length === 0) return null;
  if (t <= pts[0][0]) return { x: pts[0][1], y: pts[0][2], stale: false };
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [s0, x0, y0] = pts[i];
    const [s1, x1, y1] = pts[i + 1];
    if (t < s1) {
      if (s1 - s0 > LERP_MAX_GAP_SEC) return { x: x0, y: y0, stale: t - s0 > LERP_MAX_GAP_SEC };
      const k = (t - s0) / Math.max(1, s1 - s0);
      return { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, stale: false };
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
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(16);
  const [done, setDone] = useState(false);

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

  const buildsNow = motion.builds.filter((b) => b[0] <= t);
  const castsNow = motion.casts.filter((c) => c[0] <= t && t - c[0] <= CAST_HOLD_SEC);

  return (
    <div className="scr-motion">
      <div className="scr-motion-map" style={{ aspectRatio: `${grid.width} / ${grid.height}` }}>
        {grid.image
          ? <img className="scr-motion-canvas" src={grid.image} alt={`${grid.name} 미니맵`} />
          : <div className="scr-motion-canvas scr-motion-canvas-blank" />}

        {/* 건물 — 자리·시각이 정확한 유일한 층이다. 갓 지은 것만 이름을 달고, 지나면 점만. */}
        {buildsNow.map(([sec, x, y, unit, raw], i) => {
          const team = teamOfRaw(raw);
          const freshBuild = t - sec <= BUILD_LABEL_SEC;
          return (
            <span
              key={`b-${i}`}
              className={cx(
                "scr-motion-build",
                team === 2 ? "scr-motion-team2" : "scr-motion-team1",
                freshBuild && "scr-motion-build-fresh",
              )}
              style={{ left: pct(x, grid.width), top: pct(y, grid.height) }}
            >
              {freshBuild ? (UNIT_KO[unit] ?? unit) : "▪"}
            </span>
          );
        })}

        {/* 본진 — 스냅 미니맵과 같은 표시(아바타+이름), 늘 떠 있다. */}
        {bases.map((m) => (
          <span
            key={m.key}
            className={cx("scr-motion-base", m.ghost && "scr-motion-base-ghost")}
            style={{ left: pct(m.x, grid.width), top: pct(m.y, grid.height) }}
          >
            <Avatar member={{ id: m.memberId, nickname: m.name, avatar: m.avatar }} size={16} />
            {m.withName && (
              <span className={cx("scr-motion-base-name", m.team === 2 ? "scr-motion-team2" : "scr-motion-team1")}>
                {m.name}
              </span>
            )}
          </span>
        ))}

        {/* 부대 자취 — 명령 좌표 기반 어림(모듈 주석). 우세 유닛 이름이 팀 색으로 흐른다. */}
        {motion.players.map((p) => {
          const pos = posAt(p.pts, t);
          if (!pos) return null;
          const unit = unitAt(p.units, t);
          const team = teamOfRaw(p.raw);
          return (
            <span
              key={p.raw}
              className={cx(
                "scr-motion-army",
                team === 2 ? "scr-motion-team2" : "scr-motion-team1",
                pos.stale && "scr-motion-army-stale",
              )}
              style={{ left: pct(pos.x, grid.width), top: pct(pos.y, grid.height) }}
            >
              {unit ? (UNIT_KO[unit] ?? unit) : "·"}
            </span>
          );
        })}

        {/* 마법 — 떨어진 자리에 이름이 잠깐 떠오른다. */}
        {castsNow.map(([, x, y, tech, raw], i) => (
          <span
            key={`c-${i}`}
            className={cx("scr-motion-cast", teamOfRaw(raw) === 2 ? "scr-motion-team2" : "scr-motion-team1")}
            style={{ left: pct(x, grid.width), top: pct(y, grid.height) }}
          >
            {TECH_KO[tech] ?? tech}
          </span>
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

      {/* 조종간 — 재생/일시정지 · 배속 · 시간 스크러버. 스냅 눈금이 아니라 진짜 시간축이다. */}
      <div className="scr-motion-bar">
        <button
          type="button" className="scr-motion-btn"
          onClick={() => {
            if (done) { setT(0); setDone(false); setPlaying(true); return; }
            setPlaying((v) => !v);
          }}
          aria-label={playing ? "일시정지" : "재생"}
        >
          {done ? "↻" : playing ? "❚❚" : "▶"}
        </button>
        <button
          type="button" className="scr-motion-btn scr-motion-speed"
          onClick={() => setSpeed((v) => SPEEDS[(SPEEDS.indexOf(v) + 1) % SPEEDS.length])}
          aria-label="배속"
        >
          ×{speed}
        </button>
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
        <span className="scr-motion-clock">{fmtClock(t)} / {fmtClock(total)}</span>
      </div>
    </div>
  );
}
