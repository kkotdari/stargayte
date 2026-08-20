/* 이진 트랙이 글자 트랙과 같은 내용인지 대조한다 ──────────────────────────────
 *
 *   node scripts/openbw-tracks-check.mjs <리플레이.rep> [--step 3]
 *
 * `bwdump --tracks`(글자)와 `bwdump --tracks --bin`(조밀 이진)을 둘 다 돌리고, 이진 쪽을
 * **앱이 실제로 쓰는 해독기**(src/utils/openbwTracks.ts)로 풀어서 견준다. 쓰개(C++)와
 * 해독기(TS)가 따로 있으니, 한쪽만 고치면 조용히 어긋난다 — 그걸 막는 자물쇠다.
 *
 * 견주는 것: 트랙 수 · 태그 집합 · 트랙마다 키 수 · 키 값(시각·자리·방향·상태).
 * 자리는 픽셀→타일로 나누며 생기는 반올림이 있으므로 1/64타일까지만 본다.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BWDUMP = join(ROOT, "tools/openbw/bwdump");
const BWDATA = join(ROOT, "tools/openbw/data");

const args = process.argv.slice(2);
const rep = args.find((a) => !a.startsWith("--"));
const stepAt = args.indexOf("--step");
const step = stepAt >= 0 ? args[stepAt + 1] : "3";
if (!rep) {
  console.error("쓰기: node scripts/openbw-tracks-check.mjs <리플레이.rep> [--step 3]");
  process.exit(2);
}
for (const p of [BWDUMP, BWDATA]) {
  if (!existsSync(p)) { console.error(`없다: ${p}`); process.exit(2); }
}

/* 앱의 해독기를 그대로 불러온다 — 베낀 사본으로 견주면 자물쇠가 안 된다. */
const dir = mkdtempSync(join(tmpdir(), "obwt-"));
const src = join(dir, "e.ts");
const out = join(dir, "e.mjs");
writeFileSync(src, `export { decodeTruthTracks } from ${JSON.stringify(join(ROOT, "src/utils/openbwTracks"))};\n`
  + `export { bwUpgradeName } from ${JSON.stringify(join(ROOT, "src/utils/bwUpgradeNames"))};`);
execFileSync("npx", ["esbuild", src, "--bundle", "--platform=node", "--format=esm",
  "--log-level=error", `--outfile=${out}`], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
const { decodeTruthTracks, bwUpgradeName } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

const runDump = (extra) => execFileSync(BWDUMP, [BWDATA, rep, step, "--tracks", ...extra], {
  maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"],
});

// ── 글자 쪽
const text = runDump([]).toString();
let trustText = -1;
const byTag = new Map();
const hpText = new Map(), icText = new Map();
const upText = [], castText = [], pingText = [], playerText = [];
for (const line of text.split("\n")) {
  if (!line) continue;
  if (line[0] === "#") {
    const p = line.split("\t");
    if (p[0] === "#trust") trustText = Number(p[1]);
    else if (p[0] === "#player") playerText.push(p.slice(1));
    else if (p[0] === "#hp" || p[0] === "#ic") {
      const m = p[0] === "#hp" ? hpText : icText;
      const tg = Number(p[1]);
      if (!m.has(tg)) m.set(tg, []);
      m.get(tg).push([Number(p[2]), Number(p[3])]);
    } else if (p[0] === "#up") upText.push(p.slice(1).map(Number));
    else if (p[0] === "#cast") castText.push(p.slice(1).map(Number));
    else if (p[0] === "#ping") pingText.push(p.slice(1).map(Number));
    continue;
  }
  if (line[0] === "f") continue;
  const [frame, tag, , type, x, y, head, state] = line.split("\t").map(Number);
  let a = byTag.get(tag);
  if (!a) { a = []; byTag.set(tag, a); }
  a.push([frame, x, y, head, state, type]);
}

// ── 이진 쪽
const bin = runDump(["--bin"]);
const decoded = await decodeTruthTracks(bin.toString("base64"));
if (!decoded) { console.error("이진 트랙을 못 풀었다"); process.exit(1); }

const FPS = 23.81;
let bad = 0;
const say = (m) => { if (bad < 12) console.log("  ✗ " + m); bad += 1; };

/* 지도 자원은 이진 쪽에서 빠져 있다(앱이 지도에서 그린다) — 글자 쪽에서도 뺀다. */
const RES = new Set([176, 177, 178, 188, 214]);
const textTypes = new Map();
for (const line of text.split("\n")) {
  if (!line || line[0] === "#" || line[0] === "f") continue;
  const p = line.split("\t");
  if (!textTypes.has(Number(p[1]))) textTypes.set(Number(p[1]), Number(p[3]));
}
for (const [tag, t] of textTypes) if (RES.has(t)) byTag.delete(tag);

if (decoded.tracks.length !== byTag.size) say(`트랙 수 ${decoded.tracks.length} vs 글자 ${byTag.size}`);
const trustBin = decoded.trustUntil === null ? -1 : Math.round(decoded.trustUntil * FPS);
if (Math.abs(trustBin - trustText) > 1) say(`믿을프레임 ${trustBin} vs ${trustText}`);

let keys = 0;
for (const tr of decoded.tracks) {
  const a = byTag.get(tr.tag);
  if (!a) { say(`이진에만 있는 태그 ${tr.tag}`); continue; }
  const n = tr.keys.length / 5;
  if (n !== a.length) { say(`태그 ${tr.tag} 키 ${n} vs ${a.length}`); continue; }
  for (let i = 0; i < n; i += 1) {
    const [frame, x, y, head, state, type] = a[i];
    const o = i * 5;
    const near = (got, want, tol) => Math.abs(got - want) <= tol;
    if (!near(tr.keys[o], frame / FPS, 1e-3)) { say(`태그 ${tr.tag} 키 ${i} 시각`); break; }
    if (!near(tr.keys[o + 1], x / 32, 1 / 64)) { say(`태그 ${tr.tag} 키 ${i} x`); break; }
    if (!near(tr.keys[o + 2], y / 32, 1 / 64)) { say(`태그 ${tr.tag} 키 ${i} y`); break; }
    if (!near(tr.keys[o + 3], (head * 360) / 256, 1e-2)) { say(`태그 ${tr.tag} 키 ${i} 방향`); break; }
    if (tr.keys[o + 4] !== state) { say(`태그 ${tr.tag} 키 ${i} 상태`); break; }
    if (tr.types[i] !== type) { say(`태그 ${tr.tag} 키 ${i} 종류 ${tr.types[i]} vs ${type}`); break; }
  }
  keys += n;
  /* 체력·인터셉터도 견준다 — 자리 키와 따로 실려 오므로 차례가 한 칸만 밀려도
     엉뚱한 유닛의 체력이 붙는다. 그 어긋남은 화면에서 눈에 잘 안 띈다. */
  for (const [nm, got, want] of [["체력", tr.hp, hpText.get(tr.tag)], ["인터셉터", tr.ic, icText.get(tr.tag)]]) {
    const gn = got?.length ?? 0, wn = want?.length ?? 0;
    if (gn !== wn) { say(`태그 ${tr.tag} ${nm} 키 ${gn} vs ${wn}`); continue; }
    for (let i = 0; i < gn; i += 1) {
      if (Math.abs(got[i][0] - want[i][0] / FPS) > 1e-3 || got[i][1] !== want[i][1]) {
        say(`태그 ${tr.tag} ${nm} 키 ${i}`); break;
      }
    }
  }
}

// ── 판 전체에 하나씩인 것들
if (decoded.players.length !== playerText.length) say(`사람 ${decoded.players.length} vs ${playerText.length}`);
decoded.players.forEach((pl, i) => {
  const w = playerText[i];
  if (!w) return;
  if (pl.owner !== Number(w[0]) || pl.pid !== Number(w[1]) || pl.race !== Number(w[2])
    || pl.force !== Number(w[3]) || pl.controller !== Number(w[4])) say(`사람 ${i} 값`);
  // 색은 번호 → 팔레트라 글자 쪽 수와 직접 못 견준다. 꼴만 본다.
  if (!/^#[0-9a-f]{6}$/.test(pl.color)) say(`사람 ${i} 색 ${pl.color}`);
  if (pl.name !== w[6]) say(`사람 ${i} 이름 ${pl.name} vs ${w[6]}`);
});
/* 업그레이드는 이름을 못 붙인 번호(unk_*)를 해독기가 버리므로 수가 줄 수 있다 —
   견줄 때도 같은 자로 걸러 낸다. */
const upWant = upText.filter(([, id]) => bwUpgradeName(id) !== "");
if (decoded.ups.length !== upWant.length) say(`업그레이드 ${decoded.ups.length} vs ${upWant.length}`);
decoded.ups.forEach((u, i) => {
  const w = upWant[i];
  if (!w) return;
  const nm = bwUpgradeName(w[1]);
  if (Math.abs(u[0] - w[0] / FPS) > 1e-3 || u[2] !== w[3]
    || u[1] !== (w[2] > 1 ? `${nm} ${w[2]}` : nm)) say(`업그레이드 ${i}`);
});
if (decoded.casts.length !== castText.length) say(`마법 ${decoded.casts.length} vs ${castText.length}`);
decoded.casts.forEach((cst, i) => {
  const w = castText[i];
  if (!w) return;
  if (Math.abs(cst[0] - w[0] / FPS) > 1e-3 || Math.abs(cst[1] - w[1] / 32) > 1 / 64
    || Math.abs(cst[2] - w[2] / 32) > 1 / 64 || cst[4] !== w[4]) say(`마법 ${i}`);
});
if (decoded.pings.length !== pingText.length) say(`핑 ${decoded.pings.length} vs ${pingText.length}`);
decoded.pings.forEach((pg, i) => {
  const w = pingText[i];
  if (!w) return;
  if (Math.abs(pg[0] - w[0] / FPS) > 1e-3 || Math.abs(pg[1] - w[1] / 32) > 1 / 64
    || Math.abs(pg[2] - w[2] / 32) > 1 / 64 || pg[3] !== w[3]) say(`핑 ${i}`);
});
{

}
const b64 = bin.toString("base64").length;
console.log(`\n▸ ${rep.split("/").pop().slice(0, 56)}`);
console.log(`  트랙 ${decoded.tracks.length}개 · 키 ${keys}개`);
console.log(`  사람 ${decoded.players.length} · 업그레이드 ${decoded.ups.length}`
  + ` · 마법 ${decoded.casts.length} · 핑 ${decoded.pings.length}`);
console.log(`  이진 ${(bin.length / 1048576).toFixed(2)}MB · base64 ${(b64 / 1048576).toFixed(2)}MB (서버 상한 12MB)`);
console.log(`  믿을 수 있는 구간: ${decoded.trustUntil === null ? "끝까지" : `0 ~ ${(decoded.trustUntil / 60).toFixed(1)}분`}`);
console.log(bad ? `  ✗ 어긋난 곳 ${bad}군데` : "  ✓ 이진과 글자가 한 자리도 안 틀린다");
process.exit(bad ? 1 : 0);
