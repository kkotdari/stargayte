/* 자취 읽기의 자 — posAt(src/utils/replayTrack.ts)이 옛 훑기와 같은 답을 내는지,
 * 그리고 코어 자취를 읽을 때 코어 자신의 읽기(posAtSim)와 같은 답을 내는지 잰다.
 *
 *   npm run pos-check
 *
 * 왜 필요한가(과제 #61): posAt은 재생 화면이 "그때 그 개체는 어디 있었나"를 묻는
 * 유일한 창구다. 두 가지를 한꺼번에 고쳤다 —
 *   ① 앞에서부터 훑던 것을 이분 탐색으로 바꿨다(코어 자취는 개체 하나가 수천 점이라
 *      선형 훑기가 프레임을 먹는다). 답이 달라지면 안 된다.
 *   ② 코어 자취를 읽는 결(plain)을 새로 냈다 — 걸음 상한·다리 놓기·굽힘 없이 곧게만
 *      잇는다. 이건 코어의 posAtSim이 하는 일과 **같아야** 한다. 다르면 화면의 몸과
 *      코어가 아는 몸이 갈린다.
 * 두 물음 다 자료 없이 답할 수 있어(무작위 자취·합성 코어 자취) 어디서나 돈다. */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function bundle(entry) {
  const dir = mkdtempSync(join(tmpdir(), "poschk-"));
  const out = join(dir, "m.mjs");
  execFileSync("npx", ["esbuild", join(ROOT, entry), "--bundle", "--format=esm",
    "--log-level=error", `--outfile=${out}`], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  const mod = await import(pathToFileURL(out).href);
  rmSync(dir, { recursive: true, force: true });
  return mod;
}

const { posAt } = await bundle("src/utils/replayTrack.ts");
const { posAtSim } = await bundle("src/utils/simCore.ts");

/* ── ① 옛 훑기 그대로(이 파일이 기준선이다) ─────────────────────────────────── */
const LERP_MAX_GAP_SEC = 24;
const GLIDE_MAX_SPEED = 6.5;
const BRIDGE_WALK_SPEED = 4.5;
const BRIDGE_MAX_SPEED = 10;
const GROUND_BEND = 0.35;

function posAtOld(pts, t, bendCenter, maxSpeed) {
  if (pts.length === 0) return null;
  if (t <= pts[0][0]) return { x: pts[0][1], y: pts[0][2], stale: false, moving: false, sinceLast: Infinity };
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [s0, x0, y0] = pts[i];
    const [s1, x1, y1] = pts[i + 1];
    if (t < s1) {
      const gap = s1 - s0;
      const dist = Math.hypot(x1 - x0, y1 - y0);
      if (gap > LERP_MAX_GAP_SEC) {
        const walkSec = Math.min(gap, Math.max(2, dist / BRIDGE_WALK_SPEED));
        if (dist > 0.01 && t >= s1 - walkSec) {
          const k = (t - (s1 - walkSec)) / walkSec;
          return { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, stale: false, moving: true, sinceLast: 0 };
        }
        return { x: x0, y: y0, stale: t - s0 > LERP_MAX_GAP_SEC, moving: false, sinceLast: t - s0 };
      }
      if (maxSpeed !== undefined && dist / Math.max(0.001, gap) > maxSpeed) {
        const walkSec9 = Math.min(gap, dist / maxSpeed);
        if (t >= s1 - walkSec9) {
          const k9 = (t - (s1 - walkSec9)) / Math.max(0.001, walkSec9);
          return { x: x0 + (x1 - x0) * k9, y: y0 + (y1 - y0) * k9, stale: false, moving: true, sinceLast: 0 };
        }
        return { x: x0, y: y0, stale: false, moving: false, sinceLast: t - s0 };
      }
      if (dist / Math.max(0.001, gap) > GLIDE_MAX_SPEED) {
        if (dist / Math.max(0.001, gap) <= BRIDGE_MAX_SPEED) {
          const k2 = (t - s0) / Math.max(0.001, gap);
          return { x: x0 + (x1 - x0) * k2, y: y0 + (y1 - y0) * k2, stale: false, moving: true, sinceLast: 0 };
        }
        return { x: x0, y: y0, stale: false, moving: false, sinceLast: t - s0 };
      }
      const k = (t - s0) / Math.max(0.001, s1 - s0);
      const still = x0 === x1 && y0 === y1;
      if (!bendCenter || still) {
        return {
          x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k,
          stale: false, moving: !still, sinceLast: still ? t - s0 : 0,
        };
      }
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

/* 씨 고정 난수 — 같은 판이 매번 나와야 실패를 되짚을 수 있다. */
let seed = 20260818;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

/** 자취 하나 — 멈춤·긴 침묵·초고속 점프·같은 시각 겹침을 일부러 섞는다. */
function makeTrack(n) {
  const pts = [];
  let s = Math.round(rnd() * 20);
  let x = rnd() * 128;
  let y = rnd() * 128;
  for (let i = 0; i < n; i += 1) {
    pts.push([s, x, y]);
    const r = rnd();
    if (r < 0.12) { /* 같은 시각 겹침 */ }
    else if (r < 0.25) s += 30 + rnd() * 40;      // 긴 침묵
    else s += 0.2 + rnd() * 6;
    if (r < 0.18) { /* 제자리 */ }
    else if (r < 0.3) { x += (rnd() - 0.5) * 90; y += (rnd() - 0.5) * 90; }  // 점프
    else { x += (rnd() - 0.5) * 8; y += (rnd() - 0.5) * 8; }
    x = Math.min(127, Math.max(0, x));
    y = Math.min(127, Math.max(0, y));
  }
  return pts;
}

const near = (a, b) => Math.abs(a - b) < 1e-9 || (!Number.isFinite(a) && !Number.isFinite(b));
const same = (p, q) => (p === null || q === null ? p === q
  : near(p.x, q.x) && near(p.y, q.y) && p.stale === q.stale && p.moving === q.moving
    && near(p.sinceLast, q.sinceLast));

let bad1 = 0;
let n1 = 0;
for (let g = 0; g < 400; g += 1) {
  const pts = makeTrack(4 + Math.floor(rnd() * 60));
  const bend = g % 3 === 0 ? { x: 64, y: 64 } : null;
  const cap = g % 4 === 0 ? 3.2 : undefined;
  const t0 = pts[0][0] - 5;
  const t1 = pts[pts.length - 1][0] + 5;
  for (let k = 0; k < 200; k += 1) {
    const t = t0 + ((t1 - t0) * k) / 199;
    n1 += 1;
    if (!same(posAt(pts, t, bend, cap), posAtOld(pts, t, bend, cap))) {
      if (bad1 < 3) console.log(`  다름: t=${t.toFixed(3)} 자취 ${g}`);
      bad1 += 1;
    }
  }
  // 자취 점 시각을 콕 찍은 자리도 — 경계가 갈리기 쉬운 곳이다.
  for (const [s] of pts) {
    for (const t of [s - 1e-6, s, s + 1e-6]) {
      n1 += 1;
      if (!same(posAt(pts, t, bend, cap), posAtOld(pts, t, bend, cap))) bad1 += 1;
    }
  }
}
console.log(`① 이분 탐색 = 옛 훑기 : ${n1}번 중 다름 ${bad1}`);

/* ── ② 코어 자취를 읽는 결(plain) = 코어 자신의 읽기(posAtSim) ───────────────── */
let bad2 = 0;
let n2 = 0;
let worst = 0;
for (let g = 0; g < 200; g += 1) {
  const m = 3 + Math.floor(rnd() * 80);
  const keys = new Float32Array(m * 5);
  let s = rnd() * 10;
  let x = rnd() * 128;
  let y = rnd() * 128;
  for (let i = 0; i < m; i += 1) {
    keys[i * 5] = Math.round(s * 100) / 100;
    keys[i * 5 + 1] = Math.round(x * 100) / 100;
    keys[i * 5 + 2] = Math.round(y * 100) / 100;
    keys[i * 5 + 3] = Math.round(rnd() * 359);
    keys[i * 5 + 4] = Math.floor(rnd() * 5);
    // 서 있는 구간(수십 초 같은 자리)도 섞는다 — 옛 규칙이면 '침묵'으로 잡힐 자리다.
    if (rnd() < 0.2) s += 20 + rnd() * 60; else s += 0.126 + rnd() * 1.5;
    if (rnd() > 0.25) { x += (rnd() - 0.5) * 4; y += (rnd() - 0.5) * 4; }
    x = Math.min(127, Math.max(0, x));
    y = Math.min(127, Math.max(0, y));
  }
  const tr = { tag: g, owner: 1, kind: "Marine", born: keys[0], died: null, keys };
  const wk = [];
  for (let q = 0; q + 4 < keys.length; q += 5) wk.push([keys[q], keys[q + 1], keys[q + 2]]);
  const tA = keys[0];
  const tB = keys[(m - 1) * 5];
  for (let k = 0; k < 300; k += 1) {
    const t = tA + ((tB - tA) * k) / 299;
    const a = posAt(wk, t, null, undefined, true);
    const b = posAtSim(tr, t);
    n2 += 1;
    if (!a || !b) { bad2 += 1; continue; }
    const d = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    if (d > worst) worst = d;
    if (d > 1e-6) bad2 += 1;
  }
}
console.log(`② 코어 자취 읽기 = posAtSim : ${n2}번 중 다름 ${bad2} (최대 어긋남 ${worst.toExponential(1)}타일)`);

if (bad1 === 0 && bad2 === 0) console.log("모두 통과.");
else { console.log("실패."); process.exit(1); }
