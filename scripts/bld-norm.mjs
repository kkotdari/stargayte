/* 건물 모델 정규화 배수를 잰다 (과제 #67)
 *
 *   npm run bld-norm              표만 본다
 *   npm run bld-norm -- --emit    소스에 붙일 BLD_NORM을 찍는다
 *
 * 왜 유닛(model-norm.mjs)과 따로인가 — **재는 자가 다르다.**
 *  · 유닛은 16-상자를 sizePx에 통째로 사상하고, 잉크 상자의 기하평균 √(폭×높이)를 맞춘다.
 *  · 건물은 발자국(타일) 상자에 fitWidth로 맞춘다(UnitLayer의 `sidePx = op.fitWidth ? wPx …`).
 *    즉 화면에서 덩치를 정하는 것은 **잉크 '폭'** 하나다. 높이는 따라올 뿐이다.
 *  · 유닛은 16방위 전부로 굽지만, 건물은 제 요잉 하나(buildingYawOf)로만 굽는다.
 *    그래서 16방위 평균을 쓰면 실제로 서는 자세와 다른 값이 나온다.
 *
 * 목표: 잉크 폭 = BLD_FILL_TARGET(기본 0.95) × 16. 그러면 그려지는 몸이 발자국의
 * 그 몫을 정확히 차지한다 — 여태 런타임에서 재서 다시 굽던(BLD_FILL_CACHE) 일을
 * 모델 좌표로 옮긴 것이다. 상한은 잉크가 16-상자를 안 넘는 선이고, 발(8,16)을
 * 축으로 재므로 밑동이 상자 밖으로 안 나간다. */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);
const flag = (n, d = null) => { const i = argv.indexOf(n); return i < 0 ? d : (argv[i + 1] ?? true); };

const RES = 320;          // 모델 1단위당 20px
const MARGIN = 2;         // 상자 밖 잉크도 보이게 캔버스를 2배로
const LOD = Number(flag("--lod", 3));
/** 시각 밀림 훑기 — 실제로 만나는 ±36도를 6도 눈금으로. */
const VQS = [-36, -24, -12, 0, 12, 24, 36];
/** 축이 되는 자리 = 발 가운데. 건물은 바닥이 발자국에 앉으므로 여기서 키운다. */
const ANCHOR = [8, 16];
/** 상한에서 물러서는 몫 — 훑기 해상도만큼. */
const CAP_SLACK = 0.97;

const ENTRY = `
import { SHAPE_BUILDERS, SHAPE_GALLERY, buildingYawOf, BLD_FILL_TARGET }
  from ${JSON.stringify(join(ROOT, "src/components/replay/ReplayMotionPlayer"))};
import { lodFilter, withPitchView, withViewShear, withYaw }
  from ${JSON.stringify(join(ROOT, "src/utils/shapeOblique"))};
window.__bldKinds = () => SHAPE_GALLERY
  .filter((x) => x.group === "건물").map((x) => x.kind)
  .filter((k) => SHAPE_BUILDERS[k]);
window.__fillTarget = (k) => BLD_FILL_TARGET[k] ?? 0.95;
/** buildingSprite(:9290)와 같은 사슬 — 제 요잉 하나, 6도 밀림, 같은 lod. */
window.__bakeBld = (kind, pitch, vq, lod) => {
  const builder = SHAPE_BUILDERS[kind];
  if (!builder) return null;
  const bucket = ((Math.round(buildingYawOf(kind) / 22.5) * 22.5) % 360 + 360) % 360;
  const sh = Math.tan((vq * Math.PI) / 180);
  const bake0 = () => withViewShear(sh, () => withYaw(-bucket, builder));
  const all = pitch ? withPitchView(bake0) : bake0();
  return all ? lodFilter(all, lod) : null;
};
`;

function bundle() {
  const dir = mkdtempSync(join(tmpdir(), "bldnorm-"));
  const src = join(dir, "e.ts");
  const out = join(dir, "e.js");
  writeFileSync(src, ENTRY);
  execFileSync("npx", ["esbuild", src, "--bundle", "--format=iife", "--jsx=automatic",
    "--log-level=error", `--outfile=${out}`,
    `--define:import.meta.env={"VITE_API_BASE":"","MODE":"production","DEV":false,"PROD":true}`],
  { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  const js = readFileSync(out, "utf8");
  rmSync(dir, { recursive: true, force: true });
  return js;
}

function inBrowser({ KINDS, VQS, LOD, RES, MARGIN, ANCHOR }) {
  const g = (() => {
    const c = document.createElement("canvas");
    c.width = RES * MARGIN; c.height = RES * MARGIN;
    return { c: c.getContext("2d", { willReadFrequently: true }), N: RES };
  })();
  const shadeBoost = (o, fill) => (fill ? Math.min(0.85, o * 1.45) : o);
  const shot = (kind, pitch, vq) => {
    const faces = window.__bakeBld(kind, pitch, vq, LOD);
    if (!faces || !faces.length) return null;
    const { c, N } = g;
    const W = N * MARGIN;
    const k = N / 16;
    const off = (N * (MARGIN - 1)) / 2;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, W);
    c.setTransform(k, 0, 0, k, off, off);
    for (const f of faces) {
      c.globalAlpha = shadeBoost(f[1], f[2]);
      c.fillStyle = f[2] ?? "#fff";
      try { c.fill(new Path2D(f[0])); } catch (e) { /* 못 읽는 패스는 건너뛴다 */ }
    }
    const buf = new Uint32Array(c.getImageData(0, 0, W, W).data.buffer);
    let x0 = W, x1 = -1, y0 = W, y1 = -1;
    for (let y = 0; y < W; y += 1) {
      const row = y * W;
      let any = false;
      for (let x = 0; x < W; x += 1) {
        if ((buf[row + x] >>> 24) > 8) {
          any = true;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
        }
      }
      if (any) { if (y < y0) y0 = y; y1 = y; }
    }
    if (x1 < 0) return null;
    const u = (v) => (v - off) / k;
    return { x0: u(x0), x1: u(x1 + 1), y0: u(y0), y1: u(y1 + 1), w: (x1 - x0 + 1) / k };
  };
  /** 축 a에서 키웠을 때 잉크가 **굽는 캔버스**에 처음 닿는 배수.
   *  16-상자가 아니라 pad까지 포함한 실제 캔버스로 재야 한다 — buildingSprite는
   *  pad = 0.62·sideQ + 2 를 두르므로 모델 단위로 양옆 9.9씩 여유가 있다. 16-상자로
   *  재면 발선(y=16) 아래로 조금이라도 삐친 건물이 전부 상한 0이 되어 버린다
   *  (실측: 55종 중 13종이 그랬다 — 바닥 얼룩·받침 슬래브가 발선 아래로 내려간다). */
  /* 굽는 쪽 pad와 **같은 값이어야 한다**(buildingSprite: `Math.ceil(sideQ * 0.62) + 2`)
     — 0.62 × 16 = 9.92. 여기만 어긋나면 표가 상한을 잘못 잡는다. */
  const PAD = 9.92;
  const headroom = (bb, a) => {
    const lim = (lo, hi, c) => Math.min(
      hi > c ? (16 + PAD - c) / (hi - c) : Infinity,
      lo < c ? (c + PAD) / (c - lo) : Infinity,
    );
    return Math.min(lim(bb.x0, bb.x1, a[0]), lim(bb.y0, bb.y1, a[1]));
  };
  const rows = [];
  for (const kind of KINDS) {
    const per = [];
    let cap = Infinity;
    let err = false;
    for (const pitch of [false, true]) {
      for (const vq of VQS) {
        const bb = shot(kind, pitch, vq);
        if (!bb) { err = true; continue; }
        per.push(bb.w);
        cap = Math.min(cap, headroom(bb, ANCHOR));
      }
    }
    if (!per.length) { rows.push({ kind, err: true }); continue; }
    // 폭은 평균, 상한은 최악.
    const w = per.reduce((t, v) => t + v, 0) / per.length;
    rows.push({ kind, w, wMax: Math.max(...per), cap, target: window.__fillTarget(kind), err });
  }
  return rows;
}

const js = bundle();
/* 크로뮴 자리는 환경마다 다르다 — model-norm.mjs와 같은 손잡이(PW_CHROMIUM)를 준다.
   (맥 로컬은 ~/Library/Caches/ms-playwright/… 아래에 있고, 리눅스 상자는 /opt다.) */
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium",
  args: ["--no-proxy-server"],
});
const page = await (await browser.newContext({ viewport: { width: 900, height: 900 } })).newPage();
page.on("pageerror", (e) => console.error("PAGEERR", String(e).slice(0, 300)));
/* 어떤 http 출처든 하나는 있어야 한다 — 번들이 localStorage를 건드리는데 about:blank·
   data: 문서에서는 브라우저가 그 접근을 막는다(SecurityError). 내용은 안 쓴다. */
await page.goto(process.env.PW_ORIGIN ?? "http://127.0.0.1:5212/");
await page.addScriptTag({ content: js });
await page.waitForFunction("!!window.__bakeBld");
const KINDS = flag("--kinds") ? String(flag("--kinds")).split(",") : await page.evaluate("window.__bldKinds()");
const rows = await page.evaluate(inBrowser, { KINDS, VQS, LOD, RES, MARGIN, ANCHOR });
await browser.close();

const f = (v, n = 2) => (Number.isFinite(v) ? v.toFixed(n) : "  ∞ ");
const ok = rows.filter((r) => !r.err && r.w > 0).sort((a, b) => a.w - b.w);
/* 상한이 1보다 작다는 것은 **이미 캔버스를 넘고 있다**는 뜻이다(모델이 너무 크다).
   그건 정규화가 아니라 모델을 고칠 일이라, 여기서는 "더 키우지만 않는다"로 그친다 —
   상한을 이유로 줄이면 멀쩡히 보이던 건물이 갑자기 작아진다. 넘치는 종류는 아래
   표에 표시해 따로 손보게 남긴다. */
const normOf = (r) => Math.min((r.target * 16) / r.w, Math.max(1, r.cap * CAP_SLACK));
console.log("\n── 건물 정규화 (제 요잉 · pitch/top × 시각밀림 7칸) ──────────────");
console.log("kind            잉크폭  최대폭  목표채움   상한   배수   적용뒤폭  넘침");
for (const r of ok) {
  const m = normOf(r);
  console.log(`${r.kind.padEnd(15)} ${f(r.w).padStart(6)} ${f(r.wMax).padStart(6)} `
    + `${f(r.target).padStart(7)} ${f(r.cap).padStart(6)} ${f(m, 3).padStart(6)} ${f(r.w * m).padStart(8)}`
    + `  ${r.cap < 1 ? "★" : " "}`);
}
const after = ok.map((r) => r.w * normOf(r) / (r.target * 16));
console.log(`\n요약 n=${ok.length}  적용 전 잉크폭 ${f(ok[0].w)} ~ ${f(ok[ok.length - 1].w)} (${f(ok[ok.length - 1].w / ok[0].w)}배)`);
console.log(`      적용 후 목표 대비 ${f(Math.min(...after) * 100, 1)}% ~ ${f(Math.max(...after) * 100, 1)}%`
  + `  (상한에 걸린 것 ${after.filter((v) => v < 0.995).length}종)`);
console.log(`      ★ = 지금도 굽는 캔버스를 넘는 모델(잘린다) — ${ok.filter((r) => r.cap < 1).length}종. 모델을 줄여야 한다.`);

if (has("--emit")) {
  console.log("\n/* npm run bld-norm -- --emit 이 낸 값이다. 손으로 고치지 마라. */");
  console.log("const BLD_NORM: Record<string, number> = {");
  for (const r of [...ok].sort((a, b) => (a.kind < b.kind ? -1 : 1))) {
    const m = normOf(r);
    if (Math.abs(m - 1) < 5e-4) continue;
    const capped = (r.target * 16) / r.w > r.cap * CAP_SLACK;
    console.log(`  ${r.kind}: ${m.toFixed(3)},${capped ? "  // 상자 상한에 걸림" : ""}`);
  }
  console.log("};");
}
