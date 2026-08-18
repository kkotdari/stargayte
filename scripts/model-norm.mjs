/* 모델 정규화 계측 CLI — 유닛 모델이 16×16 모델 상자를 실제로 얼마나 채우는지 잰다.
 *
 *   node scripts/model-norm.mjs                     (기본: 전 유닛 kind, 세 모드)
 *   node scripts/model-norm.mjs --kinds gunner,ultra
 *   node scripts/model-norm.mjs --scales /tmp/mul.json   (배수를 걸고 다시 재기)
 *   node scripts/model-norm.mjs --emit                   (소스에 붙일 두 표를 찍는다)
 *   node scripts/model-norm.mjs --clamp                  (시각 밀림별 배수 상한)
 *   node scripts/model-norm.mjs --json /tmp/out.json
 * (package.json 의 "model-norm" 으로 걸려 있다 — npm run model-norm)
 *
 * 왜 필요한가: 화면에 보이는 유닛 크기는 크기표(타일)가 아니라
 * '상자 타일 × 모델이 제 상자를 채운 몫'이다. 그 몫은 모델 면을 한 줄만 고쳐도
 * 조용히 달라지는데, 여태 재는 도구가 저장소 밖에만 있었다. 이 스크립트가 그 자다.
 * 소스의 MODEL_NORM·MODEL_INK 두 표는 **여기서 나온 값이다** — 손으로 고치지 마라.
 * 모델 면을 고쳤으면 `npm run model-norm -- --emit` 을 돌려 두 표를 갈아라.
 *
 * 무엇을 그대로 흉내내는가 (ReplayMotionPlayer.tsx:7831 resolveShapeFaces):
 *   const vq = viewYaw ? clamp(±36, round(viewYaw/6)*6) : 0;
 *   const bucket = round(rotDeg/22.5)*22.5;
 *   const sh = tan(vq°);
 *   const bake0 = () => withViewShear(sh, () => withYaw(-bucket, builder));
 *   const bake  = pitchView ? () => withPitchView(bake0) : bake0;
 *   f = flat ? withTopView(bake) : bake();
 * 유닛 op는 언제나 { flat: !pitched, pitch: pitched } 라서 유닛이 실제로 만나는
 * 조합은 top(flat) 과 pitch 둘뿐이다. base(둘 다 아님)는 모델 도록(ShapeIcon)만 쓴다.
 * 굽고 나서 그리는 쪽(unitSprite, :8057)이 lodFilter → shadeBoost 를 태우므로
 * 잉크를 그것까지 그대로 흉내내야 화면의 잉크와 같은 수가 나온다.
 *
 * src/를 그때그때 esbuild로 번들해 헤드리스 크로뮴에서 굽는다 — 개발 서버가 필요 없다. */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ── 기준값(상수로 둔다 — 주석 산문이 아니라 코드가 진실이어야 한다) ───────────── */

/** 기준 모드 — 유닛의 기본 화면. pitched는 useState(false)라 켜기 전까지 전부 top이다. */
export const NORM_MODE = "top";
/** 정규화가 맞추는 자 = 잉크 상자의 기하평균 √(폭×높이), 모델 단위(16이 상자 한 변).
 *  넓이(√잉크면적)가 아니라 **상자**를 맞추는 이유: 화면 크기표가 원작 치수
 *  √(폭타일×높이타일)로 유도되므로, 같은 자라야 두 층이 같은 말을 한다.
 *  넓이로 맞추면 모델마다 잉크 밀도가 달라(0.30~0.79) 상자가 2.4배 어긋난다. */
export const TARGET_GM = 5.2;
/** 확대 축(모델 좌표) — 상자 한가운데. unitSprite 의 배수도 이 점을 쓴다.
 *  발밑이 아니라 중심인 이유: 그리는 쪽이 발자리·가로중심·머리를 전부
 *  contentBox(구운 판의 실제 잉크)에서 다시 재므로 모델이 상자 안에서
 *  어디에 앉든 상관없고, 중심축이 상한이 가장 균형 있게 남는 자리다. */
export const NORM_ANCHOR = [8, 8];
/** 상한 안전 여유 — 훑기 해상도가 0.125단위라 그 오차만큼 물러선다. */
export const CAP_SAFETY = 0.97;
/** 시각 밀림 각(도)의 굽기 눈금과 상한 — resolveShapeFaces(:7838)와 같은 값.
 *  vq는 6도로 갈무리되고 ±36도에서 잘린다. */
export const VQ_STEP = 6;
export const VQ_MAX = 36;
/** 방향 버킷 — 원작 스프라이트와 같은 16방향(22.5도). */
export const BUCKETS = Array.from({ length: 16 }, (_, i) => i * 22.5);
/** 클램프 검사에 쓰는 시각 밀림 — 굽기 눈금 그대로 ±36도를 6도씩 전부 훑는다. */
export const VQ_PROBE = Array.from(
  { length: (2 * VQ_MAX) / VQ_STEP + 1 }, (_, i) => -VQ_MAX + i * VQ_STEP,
);
/** 방향이 없는 kind — op가 rotDeg를 안 실어(버로우 :13463, 마인 :12479) 버킷 0 하나뿐이다.
 *  16방향을 평균하면 있지도 않은 각의 그림까지 섞여 값이 흐려진다. */
export const NO_ROT = new Set(["burrowhole", "mine"]);
/* 지도에 실제로 그려지는 kind vs 도록(자료실 > 모델)에만 있는 kind.
   kindMain(:13441)이 tank→tankbody, tanksiege→tanksiegebody 로 갈아치우므로
   'tank'·'tanksiege' 합본과 'carrierbay'는 화면에 한 번도 안 나온다 — 크기 손잡이가
   그 이름으로 걸리면 죽은 값이다(지적 G). */
export const GALLERY_ONLY = new Set(["tank", "tanksiege", "carrierbay"]);
/** 부품 → 본체(소스의 NORM_PAIR와 **같은 표여야 한다**).
 *  포신 판은 차체 판과 같은 sizePx·같은 상자 중심에 그려지므로 배수도 같아야 한다.
 *  각자 제 목표(5.2)를 맞추면 포신만 1.38~1.56배 부풀어 포탑이 차체 밖으로 나간다.
 *  그래서 --emit은 짝을 **안 찍고**(소스가 NORM_PAIR로 접는다), 본체의 상한을 잡을 때
 *  짝의 상한도 함께 본다. 짝의 잉크 상자는 목표와 다르므로 MODEL_INK 쪽에 실린다. */
export const NORM_PAIR = { tankgun: "tankbody", tanksiegegun: "tanksiegebody" };
/** 참고로 함께 재는 발밑 원점 — shapeOblique originYNow 와 같은 값(top 12 · 그 외 12.6). */
export const FOOT_Y = { top: 12, pitch: 12.6, base: 12.6 };

const RES_MAIN = 320;  // 모델 1단위당 20px — 잉크 면적을 0.05단위로 읽는다.
const RES_SWEEP = 128; // 클램프 훑기용(빠르게) — 0.125단위.
const MARGIN = 2;      // 상자 밖으로 나간 잉크도 보이게 캔버스를 2배로.

/* ── 인자 ─────────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(n);
  return i < 0 ? d : (argv[i + 1] ?? true);
};
const has = (n) => argv.includes(n);
const MODES = String(flag("--modes", "top,pitch,base")).split(",");
const SCALES = flag("--scales") ? JSON.parse(readFileSync(flag("--scales"), "utf8")) : {};
const OUT_JSON = flag("--json", join(tmpdir(), "model-norm.json"));
const LOD = Number(flag("--lod", 3));

/* ── 브라우저에 넣을 번들 ─────────────────────────────────────────────────── */
const ENTRY = `
import { SHAPE_BUILDERS, SHAPE_GALLERY } from ${JSON.stringify(join(ROOT, "src/components/replay/ReplayMotionPlayer"))};
import { lodFilter, withPitchView, withTopView, withViewShear, withYaw }
  from ${JSON.stringify(join(ROOT, "src/utils/shapeOblique"))};
window.__unitKinds = () => {
  const g = new Set(SHAPE_GALLERY.filter((x) => x.group === "유닛").map((x) => x.kind));
  /* 도록에 없지만 실제로 그려지는 kind(지적 G) — 시즈탱크는 차체·포신 두 판으로 갈리고,
     버로우/변태는 딴 kind로 바뀐다. 크기 손잡이는 이 열쇠 공간에 닿아야 한다. */
  for (const k of ["tankbody", "tankgun", "tanksiegebody", "tanksiegegun", "burrowhole"]) g.add(k);
  /* 도록의 tank/tanksiege는 '합친 그림'이라 화면에서는 안 쓰인다 — 참고로 남겨 둔다. */
  return [...g].filter((k) => SHAPE_BUILDERS[k]);
};
/** resolveShapeFaces(:7831)와 같은 사슬로 굽고, unitSprite(:8057)와 같은 lod를 태운다. */
window.__bake = (kind, bucket, mode, vq, lod) => {
  const builder = SHAPE_BUILDERS[kind];
  if (!builder) return null;
  const sh = Math.tan((vq * Math.PI) / 180);
  const bake0 = () => withViewShear(sh, () => withYaw(-bucket, builder));
  const bake = mode === "pitch" ? () => withPitchView(bake0) : bake0;
  const all = mode === "top" ? withTopView(bake) : bake();
  return all ? lodFilter(all, lod) : null;
};
`;

function bundle() {
  const dir = mkdtempSync(join(tmpdir(), "modelnorm-"));
  const src = join(dir, "entry.ts");
  const out = join(dir, "entry.mjs");
  writeFileSync(src, ENTRY);
  execFileSync("npx", [
    "esbuild", src, "--bundle", "--format=esm", "--log-level=error",
    "--define:process.env.NODE_ENV=\"production\"", "--define:import.meta.env={}", `--outfile=${out}`,
  ], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  const js = readFileSync(out, "utf8");
  rmSync(dir, { recursive: true, force: true });
  return js;
}

/* ── 페이지 안에서 도는 계측기 — 이 함수 몸은 브라우저에서 직렬화돼 돈다.
   바깥 스코프를 하나도 못 보므로 필요한 값은 전부 인자로 넘긴다. ─────────────── */
function inBrowser({ KINDS, MODES, BUCKETS, VQ_PROBE, SCALES, FOOT_Y, NORM_ANCHOR,
  NO_ROT, GALLERY_ONLY, RES_MAIN, RES_SWEEP, MARGIN, LOD, CLAMP_DETAIL }) {
  /** unitSprite가 그리기 직전에 거는 음영 증폭(:7828 shadeBoost) — 잉크 문턱에 영향을 준다. */
  const shadeBoost = (o, fill) => (fill ? Math.min(0.85, o * 1.45) : o);
  const mk = (N) => {
    const cv = document.createElement("canvas");
    cv.width = N * MARGIN; cv.height = N * MARGIN;
    return { cv, c: cv.getContext("2d", { willReadFrequently: true }), N };
  };
  const main = mk(RES_MAIN);
  const sweep = mk(RES_SWEEP);

  /** 한 판을 굽고 잉크 상자·면적을 잰다. 좌표는 모델 단위(0~16)로 돌려준다. */
  const shot = (g, kind, bucket, mode, vq, s) => {
    const faces = window.__bake(kind, bucket, mode, vq, LOD);
    if (!faces || !faces.length) return null;
    const { c, N } = g;
    const W = N * MARGIN;
    const k = N / 16;                       // 모델 1단위 → 픽셀
    const off = (N * (MARGIN - 1)) / 2;     // 16-상자를 캔버스 가운데로
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, W);
    c.setTransform(k, 0, 0, k, off, off);
    if (s !== 1) {
      c.translate(NORM_ANCHOR[0], NORM_ANCHOR[1]);
      c.scale(s, s);
      c.translate(-NORM_ANCHOR[0], -NORM_ANCHOR[1]);
    }
    for (const f of faces) {
      c.globalAlpha = shadeBoost(f[1], f[2]);
      c.fillStyle = f[2] ?? "#fff";
      try { c.fill(new Path2D(f[0])); } catch (e) { /* 못 읽는 패스는 건너뛴다 */ }
    }
    const buf = new Uint32Array(c.getImageData(0, 0, W, W).data.buffer);
    let x0 = W, x1 = -1, y0 = W, y1 = -1, ink = 0;
    for (let y = 0; y < W; y += 1) {
      const row = y * W;
      let any = false;
      for (let x = 0; x < W; x += 1) {
        if ((buf[row + x] >>> 24) > 8) {
          ink += 1; any = true;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
        }
      }
      if (any) { if (y < y0) y0 = y; y1 = y; }
    }
    if (x1 < 0) return null;
    const u = (v) => (v - off) / k;          // 픽셀 → 모델 단위
    return {
      x0: u(x0), x1: u(x1 + 1), y0: u(y0), y1: u(y1 + 1),
      w: (x1 - x0 + 1) / k, h: (y1 - y0 + 1) / k,
      area: ink / (k * k), faces: faces.length,
      soft: faces.filter((f) => f[1] < 1).length,
    };
  };

  /** 지금 이 판이 16-상자 밖으로 얼마나(모델 단위) 삐져나갔나 — 0이면 안 잘린다.
   *  unitSprite(:8073)의 여백은 pad=2px(그리기 좌표)뿐이라, 모델 단위로는
   *  2×(16/pxq)만큼만 봐준다: pxq 32에서 1.0, pxq 64에서 0.5. 즉 확대할수록 잘린다.
   *  그래서 여기서는 여백을 0으로 놓고 잰다 — 어느 배율에서도 안 잘리는 답을 내려면. */
  const overflow = (bb) => Math.max(0, -bb.x0, bb.x1 - 16, -bb.y0, bb.y1 - 16);
  /** 배수를 걸었을 때 잉크가 16-상자를 안 넘는 상한 — 기준점 a에서 잰다. */
  const headroom = (bb, a) => {
    const lim = (lo, hi, c) => Math.min(
      hi > c ? (16 - c) / (hi - c) : Infinity,
      lo < c ? c / (c - lo) : Infinity,
    );
    return Math.min(lim(bb.x0, bb.x1, a[0]), lim(bb.y0, bb.y1, a[1]));
  };

  const rows = [];
  for (const kind of KINDS) {
    const s = SCALES[kind] ?? 1;
    const BK = NO_ROT.includes(kind) ? [0] : BUCKETS;
    for (const mode of MODES) {
      /* 크기 재기 — vq=0, 16방향 전부.
         top 모드는 시각 밀림이 아예 안 걸린다: 유닛 op가 flat=!pitched인데
         viewYawOf(:11106)가 `if (!pitched) return 0`이라 flat일 때 vq는 언제나 0이다.
         평균은 '보통 이만큼', 최대는 '가장 넓게 보일 때'다. */
      const ms = BK.map((b) => shot(main, kind, b, mode, 0, s)).filter(Boolean);
      if (!ms.length) { rows.push({ kind, mode, err: true }); continue; }
      const avg = (f) => ms.reduce((t, m) => t + f(m), 0) / ms.length;
      const mx = (f) => Math.max(...ms.map(f));
      /* 클램프 훑기 — 실제로 만나는 시각 밀림 전 범위(±36도, 6도 눈금) × 16방위 전부.
         위 이유로 top·base는 vq가 늘 0이라 0만 본다. */
      const vqs = mode === "pitch" ? VQ_PROBE : [0];
      const head = { anchor: Infinity, foot: Infinity };
      const foot = [8, FOOT_Y[mode] ?? 12.6];
      const perVq = [];
      let over = 0;
      let worst = null;
      for (const vq of vqs) {
        let hv = Infinity;
        for (const b0 of BK) {
          const b = shot(sweep, kind, b0, mode, vq, s);
          if (!b) continue;
          const ha = headroom(b, NORM_ANCHOR);
          over = Math.max(over, overflow(b));
          if (ha < hv) hv = ha;
          if (ha < head.anchor) {
            head.anchor = ha;
            worst = { vq, bucket: b0, x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 };
          }
          const hf = headroom(b, foot);
          if (hf < head.foot) head.foot = hf;
        }
        if (CLAMP_DETAIL) perVq.push({ vq, head: hv });
      }
      const w = avg((m) => m.w);
      const h = avg((m) => m.h);
      rows.push({
        kind, mode, use: GALLERY_ONLY.includes(kind) ? "도록" : "지도",
        scale: s, faces: ms[0].faces, soft: ms[0].soft,
        w, h, gm: Math.sqrt(w * h),
        wMax: mx((m) => m.w), hMax: mx((m) => m.h),
        area: avg((m) => m.area),
        rad: Math.sqrt(avg((m) => m.area)),
        headAnchor: head.anchor, headFoot: head.foot, over, worst,
        perVq: CLAMP_DETAIL ? perVq : undefined,
      });
    }
  }
  return rows;
}

/* ── 실행 ─────────────────────────────────────────────────────────────────── */
const { chromium } = await import("playwright-core");
const js = bundle();
const exe = process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-proxy-server"] });
const page = await (await browser.newContext({ viewport: { width: 400, height: 300 } })).newPage();
page.on("pageerror", (e) => console.error("페이지 오류:", String(e).slice(0, 300)));
/* 진짜 오리진이 있어야 한다 — about:blank(불투명 오리진)에서는 번들 안의 localStorage
   접근이 SecurityError로 죽는다. 네트워크는 안 타고 가로채서 빈 문서만 돌려준다. */
await page.route("http://model-norm.local/*", (r) => r.fulfill({
  contentType: "text/html", body: "<!doctype html><meta charset=utf-8><body>",
}));
await page.goto("http://model-norm.local/");
await page.addScriptTag({ content: js, type: "module" });
await page.waitForFunction("!!window.__bake");

const KINDS = flag("--kinds")
  ? String(flag("--kinds")).split(",")
  : await page.evaluate("window.__unitKinds()");

const rows = await page.evaluate(inBrowser, {
  KINDS, MODES, BUCKETS, VQ_PROBE, SCALES, FOOT_Y, NORM_ANCHOR,
  NO_ROT: [...NO_ROT], GALLERY_ONLY: [...GALLERY_ONLY],
  RES_MAIN, RES_SWEEP, MARGIN, LOD, CLAMP_DETAIL: has("--clamp"),
});
await browser.close();
writeFileSync(OUT_JSON, JSON.stringify({
  target: TARGET_GM, mode: NORM_MODE, anchor: NORM_ANCHOR, lod: LOD, scales: SCALES, rows,
}, null, 1));

/* ── 표 ───────────────────────────────────────────────────────────────────── */
const f = (v, n = 2) => (Number.isFinite(v) ? v.toFixed(n) : "  ∞ ");
for (const mode of MODES) {
  const rs = rows.filter((r) => r.mode === mode && !r.err).sort((a, b) => a.gm - b.gm);
  if (!rs.length) continue;
  console.log(`\n── ${mode} 모드 ${mode === NORM_MODE ? "(기준)" : ""} — 목표 잉크상자 ${TARGET_GM} `
    + "─".repeat(24));
  console.log("kind           면수 반투명   잉크폭 잉크높이 잉크상자 √잉크 필요배수  "
    + "상한(축) 상한(발) 넘침");
  for (const r of rs) {
    console.log(
      `${(r.use === "도록" ? `${r.kind}*` : r.kind).padEnd(14)} `
      + `${String(r.faces).padStart(4)} ${String(r.soft).padStart(5)}   `
      + `${f(r.w)}  ${f(r.h)}    ${f(r.gm)}  ${f(r.rad)}  `
      + `${f(TARGET_GM / r.gm, 3)}    ${f(r.headAnchor, 2)}    ${f(r.headFoot, 2)}`
      + `   ${r.over > 0 ? f(r.over, 2) : "  · "}`);
  }
  const gms = rs.map((r) => r.gm).sort((a, b) => a - b);
  const q = (p) => gms[Math.min(gms.length - 1, Math.floor(p * (gms.length - 1)))];
  if (rs.some((r) => r.use === "도록")) {
    console.log("* = 도록(자료실 > 모델)에만 나오는 kind — 지도에는 안 그려진다.");
  }
  console.log(`요약 n=${rs.length}  잉크상자 최소 ${f(gms[0])} · 1사분 ${f(q(0.25))} · 중앙 ${f(q(0.5))}`
    + ` · 3사분 ${f(q(0.75))} · 최대 ${f(gms[gms.length - 1])}`
    + `   상자 밖으로 나간 kind ${rs.filter((r) => r.over > 0).length}종`);
}

/* 기준 모드와 다른 모드의 편차 — 한 배수로 맞추면 나머지가 얼마나 벌어지는지. */
const base = new Map(rows.filter((r) => r.mode === NORM_MODE).map((r) => [r.kind, r]));
for (const mode of MODES.filter((m) => m !== NORM_MODE)) {
  const d = rows.filter((r) => r.mode === mode && !r.err && base.has(r.kind))
    .map((r) => ({ kind: r.kind, k: r.gm / base.get(r.kind).gm }))
    .sort((a, b) => a.k - b.k);
  if (!d.length) continue;
  const g = Math.exp(d.reduce((t, x) => t + Math.log(x.k), 0) / d.length);
  console.log(`\n${NORM_MODE} 대비 ${mode} 잉크상자 비 — 기하평균 ${f(g, 3)} · `
    + `최소 ${d[0].kind} ${f(d[0].k, 3)} · 최대 ${d[d.length - 1].kind} ${f(d[d.length - 1].k, 3)}`);
}

if (has("--clamp")) {
  for (const mode of MODES) {
    const rs = rows.filter((r) => r.mode === mode && !r.err && r.perVq?.length > 1);
    if (!rs.length) continue;
    console.log(`\n── ${mode} 모드 시각 밀림별 배수 상한(축 ${NORM_ANCHOR}) ` + "─".repeat(20));
    console.log("kind          " + VQ_PROBE.map((v) => `${String(v).padStart(4)}`).join(" ") + "    최소");
    for (const r of rs.sort((a, b) => a.headAnchor - b.headAnchor)) {
      console.log(`${r.kind.padEnd(13)} ` + r.perVq.map((p) => f(p.head, 2).padStart(4)).join(" ")
        + `   ${f(r.headAnchor, 2)}`);
    }
  }
}

if (has("--emit") && MODES.includes(NORM_MODE)) {
  /** 이 본체를 배수로 함께 타는 kind들(자기 자신 + 딸린 짝). */
  const family = (kind) => [kind,
    ...Object.keys(NORM_PAIR).filter((g) => NORM_PAIR[g] === kind)];
  const capOf = (kind) => CAP_SAFETY * Math.min(...rows
    .filter((x) => family(kind).includes(x.kind) && !x.err).map((x) => x.headAnchor));
  const list = rows.filter((x) => x.mode === NORM_MODE && !x.err
      && NORM_PAIR[x.kind] === undefined)
    .sort((a, b) => a.kind.localeCompare(b.kind));
  const gmOfKind = (kind) => (rows.find((x) => x.mode === NORM_MODE && x.kind === kind && !x.err) ?? {}).gm;
  console.log("\n/* 아래 두 표는 소스에 붙일 것이다 — 이 스크립트가 낸 값이므로 손으로 고치지 마라. */");
  console.log(`/* npm run model-norm -- --emit · 기준 ${NORM_MODE} 모드 · 목표 잉크상자 ${TARGET_GM}`
    + ` · 축 (${NORM_ANCHOR}) · 상한 여유 ${CAP_SAFETY} */`);
  console.log("const MODEL_NORM: Record<string, number> = {");
  for (const r of list) {
    const m = TARGET_GM / r.gm;
    const cap = capOf(r.kind);
    console.log(`  ${r.kind}: ${Math.min(m, cap).toFixed(3)},`
      + (m > cap ? `  // 상자 상한(원한 배수 ${m.toFixed(3)})` : ""));
  }
  for (const g of Object.keys(NORM_PAIR)) {
    console.log(`  // ${g}: 없음 — 짝이라 소스의 NORM_PAIR가 ${NORM_PAIR[g]} 배수로 접는다.`);
  }
  console.log("};");
  /* 목표에 도달한 종류는 값이 전부 TARGET_GM이라 적을 것이 없다 — 상한에 걸려
     목표에 못 미친 종류와, 목표를 **일부러** 안 맞추는 짝만 낸다
     (소스의 modelInkOf 가 나머지를 폴백으로 채운다). */
  const off = list.map((r) => [r.kind, r.gm * Math.min(TARGET_GM / r.gm, capOf(r.kind))])
    .filter(([, v]) => Math.abs(v - TARGET_GM) > 5e-4);
  for (const g of Object.keys(NORM_PAIR)) {
    const gg = gmOfKind(g);
    const b = rows.find((x) => x.mode === NORM_MODE && x.kind === NORM_PAIR[g] && !x.err);
    if (gg && b) off.push([g, gg * Math.min(TARGET_GM / b.gm, capOf(NORM_PAIR[g]))]);
  }
  console.log(`const MODEL_INK: Record<string, number> = { ${
    off.map(([k, v]) => `${k}: ${v.toFixed(3)}`).join(", ")} };`);
  /* 정규화 배수를 그대로 쓸 수 있게 --scales 용 JSON도 함께 낸다(검증 재측정용). */
  const sc = {};
  for (const r of list) sc[r.kind] = Number(Math.min(TARGET_GM / r.gm, capOf(r.kind)).toFixed(3));
  // 짝은 본체 배수를 그대로 물려받는다 — 다시 재기(--scales)도 화면과 같은 그림이 되게.
  for (const g of Object.keys(NORM_PAIR)) if (sc[NORM_PAIR[g]] !== undefined) sc[g] = sc[NORM_PAIR[g]];
  writeFileSync(`${OUT_JSON}.scales.json`, JSON.stringify(sc, null, 1));
  console.log(`\n--scales 용 배수 JSON: ${OUT_JSON}.scales.json`);
}
if (has("--emit") && !MODES.includes(NORM_MODE)) {
  console.error(`--emit은 기준 모드(${NORM_MODE})를 재야 나온다 — --modes에 넣어라.`);
}
console.log(`\n결과 JSON: ${OUT_JSON}`);
