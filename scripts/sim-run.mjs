/* 시뮬 코어를 돌려 결과와 품질 지표를 낸다 (기획서 docs/plan-sim-core-v4.md P1)
 *
 *   node scripts/sim-run.mjs --db <sqlite>          로컬 DB의 개체 트랙 전부
 *   node scripts/sim-run.mjs tracks/*.json
 *
 * 렌더를 안 건드리고 시뮬만 검증하는 자리다 — 앵커 드리프트(시뮬이 '그때 거기 있었다'는
 * 증거와 얼마나 벌어지나)가 이 단계의 성적표다. 걸음 허구는 시뮬에서 구조적으로 0이라
 * 재지 않는다(제 속도표보다 빨리 갈 방법이 없다). */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function bundle(entry) {
  const dir = mkdtempSync(join(tmpdir(), "simrun-"));
  const out = join(dir, "m.mjs");
  execFileSync("npx", ["esbuild", join(ROOT, entry), "--bundle", "--format=esm",
    "--log-level=error", `--outfile=${out}`], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  const mod = await import(pathToFileURL(out).href);
  rmSync(dir, { recursive: true, force: true });
  return mod;
}

async function fromDb(path) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path, { readOnly: true });
  const rows = db.prepare(
    "select game_result_id as id, data from game_result_unit_tracks order by game_result_id").all();
  db.close();
  return rows.map((r) => ({ label: `game ${r.id}`, json: r.data }));
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("쓰기: node scripts/sim-run.mjs <트랙.json…> | --db <sqlite 경로>");
  process.exit(2);
}
const inputs = args[0] === "--db"
  ? await fromDb(args[1])
  : args.map((p) => ({ label: p.split("/").pop(), json: readFileSync(p, "utf8") }));

const { simulate } = await bundle("src/utils/simCore.ts");

for (const { label, json } of inputs) {
  const data = JSON.parse(json);
  if (!data || !Array.isArray(data.ents)) { console.error(`${label}: 개체 트랙이 아니다`); continue; }
  /* 맵 크기는 트랙에 없다 — 증거 좌표의 최대치로 어림한다(대개 128×128). */
  let mx = 0;
  let my = 0;
  for (const e of data.ents) for (const v of e.ev) { if (v[1] > mx) mx = v[1]; if (v[2] > my) my = v[2]; }
  const W = mx > 96 ? 128 : mx > 64 ? 96 : 64;
  const H = my > 96 ? 128 : my > 64 ? 96 : 64;
  const r = simulate(data, { width: W, height: H, terrain: null });
  const s = r.stats;
  const bytes = r.tracks.reduce((n, t) => n + t.keys.length, 0) * 4;
  console.log([
    label.padEnd(14),
    `${W}x${H}`,
    `개체 ${String(s.ents).padStart(5)}`,
    `틱 ${String(s.ticks).padStart(6)}`,
    `키 ${String(Math.round(s.keys)).padStart(7)}`,
    `앵커 ${String(s.anchors).padStart(6)}`,
    `드리프트 중앙 ${String(s.driftMedian).padStart(5)} / 90분위 ${String(s.driftP90).padStart(6)} / 1.5타일초과 ${String(s.driftBadRate).padStart(5)}%`,
    `${String(s.ms).padStart(6)}ms`,
    `${(bytes / 1024 / 1024).toFixed(2)}MB`,
  ].join("  "));
}
