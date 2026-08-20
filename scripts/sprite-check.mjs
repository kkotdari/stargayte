/* 스프라이트 캐시 계측 CLI(요청: "8인전 버벅임 — 추측 금지, 계측부터") ──────────
 *
 *   node scripts/sprite-check.mjs                     기본(유닛 12종 · 8인까지)
 *   node scripts/sprite-check.mjs --players 8 --zooms 3
 *   node scripts/sprite-check.mjs --kinds gunner,zling,hydra
 *
 * 무엇을 재는가 — 화면에서 판 한 장이 만들어지는 값을 그대로 재고, 그 값으로 캐시
 * 열쇠 공간이 임자 수에 따라 어떻게 불어나는지를 셈한다. 두 수가 답을 가른다:
 *   ① 굽는 값(ms) — 한 장을 굽는 데 실제로 드는 시간. 면 수에 비례한다.
 *   ② 보관 바이트 — 한 장이 차지하는 캔버스 바이트(가로² × 4).
 * 이 둘로 "8인전의 작업 집합이 예산(96MB)을 넘는가"를 셈하면, 넘는 순간부터 LRU가
 * 매 프레임 쫓아내고 다시 굽는다 — 그것이 버벅임의 얼개다.
 *
 * 왜 이 셈이 필요한가(코드가 말하는 것):
 *   unitSprite의 캐시 열쇠는 `kind|rot|flat|vq|pitch|color|pxq|B|lod`이고,
 *   그중 **color가 임자 색**이다. 색 없는 면(개인색 자리)이 굽는 순간 이미 칠해지므로
 *   열쇠에 들어갈 수밖에 없는데, 그 대가로 같은 유닛의 판이 **임자 수만큼 갈린다**.
 *   이 스크립트는 그 곱셈이 예산을 언제 넘기는지를 수로 못 박는다.
 *
 * 셋째 몫 — **자르기 검산**. 소스의 cropToInk를 그대로 불러 자른 뒤, 그리는 쪽과 같은
 * 식으로 (ox, oy)에 되돌려 붙이고 원판과 픽셀을 하나씩 견준다. 자르기는 화면의 모든
 * 유닛 위치 계산에 걸리는 자리라, "식이 맞다"는 말 대신 **차이 0px**이라는 수가 나와야
 * 한다. 한 종류라도 어긋나면 표 아래에 이름과 어긋난 픽셀 수를 찍는다.
 *
 * ⚠ 이것은 정적 셈이다 — 진짜 프레임의 수는 브라우저 콘솔의 `__spritePerf.line()`이
 *   말한다(소스의 SPRITE_PERF). 둘을 같이 봐야 원인이 확정된다.
 *
 * src/를 그때그때 esbuild로 번들해 헤드리스 크로뮴에서 굽는다 — 개발 서버가 필요 없다. */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ── 소스와 **같은 값이어야 하는** 상수들(ReplayMotionPlayer.tsx) ──────────── */
/** unitSprite의 바이트 예산(:SPRITE_BYTES_MAX). */
const SPRITE_BYTES_MAX = 96 * 1024 * 1024;
/** 굽는 판의 여백(:unitSprite `const pad = 2`). */
const PAD = 2;
/** 원작과 같은 16방향 — 열쇠의 rotB가 22.5도로 갈무리된다. */
const BUCKETS = 16;

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(n);
  return i < 0 ? d : (argv[i + 1] ?? true);
};
const PLAYERS = Number(flag("--players", 8));
/** 화면에서 만나는 pxq 갈래 수 — 줌을 몇 단 쓰는가(열쇠의 pxq가 2px 칸으로 갈무리된다). */
const ZOOMS = Number(flag("--zooms", 3));
const DPR = Number(flag("--dpr", 2));
const KINDS = String(flag("--kinds",
  "gunner,fbat,ghost,inf,scv,tankbody,tankgun,vulture,goliath,wraith,dship,vessel,"
  + "zealot,goon,dtemp,htemp,probe,shuttle,corsair,scout,"
  + "zling,hydra,muta,drone,lurker,ovie,scourge,ultra")).split(",").filter(Boolean);
/** 8인전에서 화면에 흔한 pxq(모델 상자 한 변의 화면 픽셀) — 줌 단계별. */
const PXQ = [24, 36, 52, 72, 96].slice(0, Math.max(1, ZOOMS));

const ENTRY = `
import { SHAPE_BUILDERS, autoTier, cropToInk } from ${JSON.stringify(join(ROOT, "src/components/replay/ReplayMotionPlayer"))};
window.__cropToInk = cropToInk;
import { lodFilter, withTopView, withViewShear, withYaw, bake }
  from ${JSON.stringify(join(ROOT, "src/utils/shapeOblique"))};
window.__faces = (kind, bucket, lod) => {
  const b = SHAPE_BUILDERS[kind];
  if (!b) return null;
  const all = withTopView(() => bake(() => withViewShear(0, () => withYaw(-bucket, b))));
  if (!all) return null;
  return lodFilter(autoTier(kind, kind + "|" + bucket, all), lod);
};
`;

function bundle() {
  const dir = mkdtempSync(join(tmpdir(), "spritechk-"));
  const src = join(dir, "entry.ts");
  const out = join(dir, "entry.mjs");
  writeFileSync(src, ENTRY);
  const ebin = join(ROOT, "node_modules", "esbuild", "bin", "esbuild");
  const head = readFileSync(ebin).subarray(0, 4);
  const magic = ((head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3]) >>> 0;
  const native = magic === 0x7f454c46 || (head[0] === 0x4d && head[1] === 0x5a)
    || magic === 0xcffaedfe || magic === 0xcefaedfe || magic === 0xcafebabe;
  const args = [src, "--bundle", "--format=esm", "--log-level=error",
    "--define:process.env.NODE_ENV=\"production\"", "--define:import.meta.env={}", `--outfile=${out}`];
  execFileSync(native ? ebin : process.execPath, native ? args : [ebin, ...args],
    { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  const js = readFileSync(out, "utf8");
  rmSync(dir, { recursive: true, force: true });
  return js;
}

/** 브라우저 안 — 한 장을 unitSprite와 같은 얼개로 굽고 ms와 면 수를 잰다. */
function inBrowser({ KINDS, PXQ, DPR, PAD, BUCKETS }) {
  const shadeBoost = (o, fill) => (fill ? Math.min(0.85, o * 1.45) : o);
  const rows = [];
  for (const kind of KINDS) {
    let faceN = 0;
    let ms = 0;
    let bytes = 0;
    let cropBytes = 0;
    let diff = 0;
    let ok = false;
    for (const pxq of PXQ) {
      const l = pxq + PAD * 2;
      const side = Math.max(1, Math.ceil(l * DPR));
      const cv = document.createElement("canvas");
      cv.width = side; cv.height = side;
      const c = cv.getContext("2d", { willReadFrequently: true });
      // 등급은 화면 크기가 정한다 — unitSprite의 lodOf와 같은 눈금(잉크 5.2 기준).
      const inkPx = (pxq * 5.2) / 16;
      const lod = inkPx < 5 ? 1 : inkPx < 11 ? 2 : 3;
      const faces = window.__faces(kind, 0, lod);
      if (!faces) continue;
      ok = true;
      faceN = Math.max(faceN, faces.length);
      bytes += side * side * 4;
      // 같은 판을 여러 번 굽어 평균을 낸다(한 번은 잡음이 크다).
      const N = 12;
      const t0 = performance.now();
      for (let r = 0; r < N; r += 1) {
        c.setTransform(DPR, 0, 0, DPR, 0, 0);
        c.clearRect(0, 0, side, side);
        c.translate(PAD, PAD);
        c.scale(pxq / 16, pxq / 16);
        for (const f of faces) {
          c.globalAlpha = shadeBoost(f[1], f[2]);
          c.fillStyle = f[2] ?? "#4aa3ff";
          try { c.fill(new Path2D(f[0])); } catch (e) { /* 못 읽는 패스는 건너뛴다 */ }
        }
      }
      ms += (performance.now() - t0) / N;
      /* 자른 뒤의 바이트 — 소스의 cropToInk와 같은 자다(잉크 상자 + 가장자리 1px).
         '자르기 전 대비 몇 분의 일인가'가 이 도구가 답해야 할 수다. */
      const buf = new Uint32Array(c.getImageData(0, 0, side, side).data.buffer);
      let x0 = side; let x1 = -1; let y0 = side; let y1 = -1;
      for (let y = 0; y < side; y += 1) {
        for (let x = 0; x < side; x += 1) {
          if ((buf[y * side + x] >>> 24) > 10) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      const cw = x1 < 0 ? side : Math.min(side, x1 + 2) - Math.max(0, x0 - 1);
      const ch = y1 < 0 ? side : Math.min(side, y1 + 2) - Math.max(0, y0 - 1);
      cropBytes += cw * ch * 4;
      /* 자르기가 그림을 안 바꾸는지 **실제로** 확인한다 — 소스의 cropToInk를 그대로
         불러 자른 뒤, 그리는 쪽과 같은 식으로 (ox, oy)에 되돌려 붙이고 원판과
         픽셀을 하나씩 견준다. 위치 계산이 모든 유닛에 걸리는 자리라, 식이 맞다는
         말 대신 수로 보여야 한다. */
      const box = {
        bot: y1 < 0 ? side : y1 + 1, top: y1 < 0 ? 0 : y0,
        cx: x1 < 0 ? side / 2 : (x0 + x1 + 1) / 2, w: x1 < 0 ? side : x1 - x0 + 1,
      };
      const cr = window.__cropToInk(cv, box);
      const back = document.createElement("canvas");
      back.width = side; back.height = side;
      const bc = back.getContext("2d", { willReadFrequently: true });
      bc.drawImage(cr.cv, cr.ox, cr.oy);
      const A = new Uint32Array(c.getImageData(0, 0, side, side).data.buffer);
      const Bp = new Uint32Array(bc.getImageData(0, 0, side, side).data.buffer);
      for (let i = 0; i < A.length; i += 1) if (A[i] !== Bp[i]) diff += 1;
    }
    if (ok) rows.push({ kind, faceN, ms, bytes, cropBytes, diff, buckets: BUCKETS });
  }
  return rows;
}

const js = bundle();
const { chromium } = await import("playwright-core");
const CANDIDATES = [
  process.env.PW_CHROMIUM,
  "/opt/pw-browsers/chromium",
  join(homedir(), "Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64",
    "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const exe = CANDIDATES.find((p) => existsSync(p));
const browser = await chromium.launch(
  exe ? { executablePath: exe, args: ["--no-proxy-server"] } : { args: ["--no-proxy-server"] },
);
const page = await (await browser.newContext({ viewport: { width: 400, height: 300 } })).newPage();
page.on("pageerror", (e) => console.error("페이지 오류:", String(e).slice(0, 300)));
await page.route("http://sprite-check.local/*", (r) => r.fulfill({
  contentType: "text/html", body: "<!doctype html><meta charset=utf-8><body>",
}));
await page.goto("http://sprite-check.local/");
await page.addScriptTag({ content: js, type: "module" });
await page.waitForFunction("!!window.__faces");
const rows = await page.evaluate(inBrowser, { KINDS, PXQ, DPR, PAD, BUCKETS });
await browser.close();

const f = (v, n = 2) => (Number.isFinite(v) ? v.toFixed(n) : "  ∞ ");
const MB = (b) => (b / 1048576).toFixed(1);

console.log(`\n── 판 한 장의 값(pxq ${PXQ.join("·")} · DPR ${DPR}) ` + "─".repeat(30));
console.log("kind          면수   굽기ms   자르기 전   자른 뒤   줄어든 배   되돌림 차이");
for (const r of rows.sort((a, b) => b.ms - a.ms)) {
  console.log(`${r.kind.padEnd(13)} ${String(r.faceN).padStart(4)}  ${f(r.ms).padStart(7)}`
    + `   ${MB(r.bytes).padStart(6)}MB  ${MB(r.cropBytes).padStart(6)}MB`
    + `   ${f(r.bytes / Math.max(1, r.cropBytes), 1).padStart(5)}배`
    + `   ${String(r.diff).padStart(7)}px`);
}
const bad = rows.filter((r) => r.diff > 0);
console.log(bad.length
  ? `\n★ 자르기가 그림을 바꿨다 — ${bad.length}종에서 픽셀이 어긋난다: `
    + bad.map((r) => `${r.kind}(${r.diff})`).join(" ")
  : "\n자르기 되돌림 차이 0px — 전 종류에서 원판과 픽셀 단위로 같다.");

/* 작업 집합 — 한 종류가 화면에 있으면 그 종류는 **방향 16 × 줌 갈래 × 임자 수**만큼
   갈린 판을 갖는다. 그 합이 예산을 넘으면 LRU가 매 프레임 쫓아내고 다시 굽는다. */
const rawOne = rows.reduce((t, r) => t + r.bytes * BUCKETS, 0);
const cropOne = rows.reduce((t, r) => t + r.cropBytes * BUCKETS, 0);
const bakeOneColor = rows.reduce((t, r) => t + r.ms * BUCKETS, 0);
console.log(`\n── 임자 수별 작업 집합(전 종류가 화면에 있고 16방향을 다 쓴다고 볼 때) `
  + "─".repeat(10));
console.log("임자   판 수    자르기 전   예산대비    자른 뒤   예산대비   전부 굽는 값");
for (let p = 1; p <= PLAYERS; p += 1) {
  const plates = rows.length * BUCKETS * PXQ.length * p;
  const a = rawOne * p;
  const b = cropOne * p;
  const mark = b / SPRITE_BYTES_MAX > 1 ? "  ← 아직 예산 초과" : "";
  console.log(`${String(p).padStart(3)}  ${String(plates).padStart(7)}`
    + `  ${MB(a).padStart(8)}MB ${(a / SPRITE_BYTES_MAX * 100).toFixed(0).padStart(5)}%`
    + `  ${MB(b).padStart(8)}MB ${(b / SPRITE_BYTES_MAX * 100).toFixed(0).padStart(5)}%`
    + `   ${f(bakeOneColor * p / 1000, 2).padStart(6)}s${mark}`);
}
console.log(`\n예산 ${MB(SPRITE_BYTES_MAX)}MB · 종류 ${rows.length} · 방향 ${BUCKETS} · 줌 갈래 ${PXQ.length}`);
console.log("※ 진짜 프레임의 수는 브라우저 콘솔에서 __spritePerf.line() 으로 본다.");
