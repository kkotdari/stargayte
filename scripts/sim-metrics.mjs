/* 연속 재생 완성도 계측 CLI (기획서 docs/plan-sim-core-v4.md P0)
 *
 *   node scripts/sim-metrics.mjs tracks/*.json
 *   node scripts/sim-metrics.mjs --db /path/to/app.db      (game_result_unit_tracks에서 바로)
 *
 * 개체 트랙(UnitTracksV2) JSON을 받아 사용자가 지적한 어색함 넷을 각각 하나의 수로 낸다.
 * 값을 고치는 도구가 아니라 '고쳐졌는지 알아보는' 도구다 — 변경 전후로 돌려 비교하고,
 * 나중에는 CI가 리플레이 묶음에 대해 돌린다.
 *
 * src/utils/simMetrics.ts를 그때그때 번들해 쓴다(리액트 의존이 없어 그대로 돈다). */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function loadMetrics() {
  const dir = mkdtempSync(join(tmpdir(), "simmetrics-"));
  const out = join(dir, "m.mjs");
  execFileSync("npx", [
    "esbuild", join(ROOT, "src/utils/simMetrics.ts"),
    "--bundle", "--format=esm", "--log-level=error", `--outfile=${out}`,
  ], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  const mod = await import(pathToFileURL(out).href);
  rmSync(dir, { recursive: true, force: true });
  return mod;
}

/** 로컬 SQLite에서 개체 트랙을 통째로 꺼낸다 — 노드 22의 node:sqlite를 쓴다. */
async function fromDb(path) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path, { readOnly: true });
  const rows = db.prepare(
    "select game_result_id as id, data from game_result_unit_tracks order by game_result_id",
  ).all();
  db.close();
  return rows.map((r) => ({ label: `game ${r.id}`, json: r.data }));
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("쓰기: node scripts/sim-metrics.mjs <트랙.json…> | --db <sqlite 경로>");
  process.exit(2);
}

const inputs = args[0] === "--db"
  ? await fromDb(args[1])
  : args.map((p) => ({ label: p.split("/").pop(), json: readFileSync(p, "utf8") }));

const { computeMetrics, formatMetrics } = await loadMetrics();

const all = [];
for (const { label, json } of inputs) {
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    console.error(`${label}: JSON이 아니다 — 건너뛴다`);
    continue;
  }
  if (!data || !Array.isArray(data.ents)) {
    console.error(`${label}: 개체 트랙이 아니다 — 건너뛴다`);
    continue;
  }
  const m = computeMetrics(data);
  all.push(m);
  console.log(formatMetrics(label, m));
}

if (all.length > 1) {
  // 합계가 아니라 개체 수 가중 평균 — 큰 경기가 작은 경기에 묻히지 않게.
  const w = all.reduce((s, m) => s + m.units, 0) || 1;
  const wavg = (f) => Math.round((all.reduce((s, m) => s + f(m) * m.units, 0) / w) * 10) / 10;
  console.log("-".repeat(96));
  console.log(formatMetrics("전체(가중평균)", {
    units: w,
    reviveRate: wavg((m) => m.reviveRate),
    reviveMedianSec: wavg((m) => m.reviveMedianSec),
    fictionRate: wavg((m) => m.fictionRate),
    backtrackPer100: wavg((m) => m.backtrackPer100),
    lonelyDeathRate: wavg((m) => m.lonelyDeathRate),
    deaths: all.reduce((s, m) => s + m.deaths, 0),
    legs: all.reduce((s, m) => s + m.legs, 0),
  }));
}
