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
writeFileSync(src, `export { decodeTruthTracks } from ${JSON.stringify(join(ROOT, "src/utils/openbwTracks"))};`);
execFileSync("npx", ["esbuild", src, "--bundle", "--platform=node", "--format=esm",
  "--log-level=error", `--outfile=${out}`], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
const { decodeTruthTracks } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

const runDump = (extra) => execFileSync(BWDUMP, [BWDATA, rep, step, "--tracks", ...extra], {
  maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"],
});

// ── 글자 쪽
const text = runDump([]).toString();
let trustText = -1;
const byTag = new Map();
for (const line of text.split("\n")) {
  if (!line) continue;
  if (line[0] === "#") { if (line.startsWith("#trust")) trustText = Number(line.split("\t")[1]); continue; }
  if (line[0] === "f") continue;
  const [frame, tag, , , x, y, head, state] = line.split("\t").map(Number);
  let a = byTag.get(tag);
  if (!a) { a = []; byTag.set(tag, a); }
  a.push([frame, x, y, head, state]);
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
    const [frame, x, y, head, state] = a[i];
    const o = i * 5;
    const near = (got, want, tol) => Math.abs(got - want) <= tol;
    if (!near(tr.keys[o], frame / FPS, 1e-3)) { say(`태그 ${tr.tag} 키 ${i} 시각`); break; }
    if (!near(tr.keys[o + 1], x / 32, 1 / 64)) { say(`태그 ${tr.tag} 키 ${i} x`); break; }
    if (!near(tr.keys[o + 2], y / 32, 1 / 64)) { say(`태그 ${tr.tag} 키 ${i} y`); break; }
    if (!near(tr.keys[o + 3], (head * 360) / 256, 1e-2)) { say(`태그 ${tr.tag} 키 ${i} 방향`); break; }
    if (tr.keys[o + 4] !== state) { say(`태그 ${tr.tag} 키 ${i} 상태`); break; }
  }
  keys += n;
}

const b64 = bin.toString("base64").length;
console.log(`\n▸ ${rep.split("/").pop().slice(0, 56)}`);
console.log(`  트랙 ${decoded.tracks.length}개 · 키 ${keys}개`);
console.log(`  이진 ${(bin.length / 1048576).toFixed(2)}MB · base64 ${(b64 / 1048576).toFixed(2)}MB (서버 상한 4MB)`);
console.log(`  믿을 수 있는 구간: ${decoded.trustUntil === null ? "끝까지" : `0 ~ ${(decoded.trustUntil / 60).toFixed(1)}분`}`);
console.log(bad ? `  ✗ 어긋난 곳 ${bad}군데` : "  ✓ 이진과 글자가 한 자리도 안 틀린다");
process.exit(bad ? 1 : 0);
