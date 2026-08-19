/* 생산 원장 결합 창의 앞끝을 재는 자 (지적: "완성 8초 전은 왜 있는 거야")
 *
 *   node scripts/bind-check.mjs <리플레이.rep…> [--slack 0,4,8,12,16,24,32,48]
 *
 * 원장은 "이 유닛을 이때 뽑았다"를 알고, 개체는 "이 태그가 이때부터 명령을 받았다"를
 * 안다. 둘을 짝지어야 뽑은 유닛이 제 자취를 갖는다. 짝짓는 창의 뒤끝은 완성 뒤
 * 300초인데, **앞끝만 붙박이 8초**로 박혀 있었다 — 어디서 온 값인지 주석도 없다.
 *
 * 앞끝이 뜻하는 것은 하나다: "우리가 셈한 완성 시각이 얼마나 늦을 수 있나".
 * 개체는 존재하기 전에는 명령을 못 받으므로 이론상 born ≥ done이지만, 완성 시각은
 * 어림(주문 시각 + 빌드 시간 + 큐)이라 늦게 잡힐 수 있다. 그 어긋남만큼 앞을 열어
 * 준 것이 이 값이다.
 *
 * 그래서 이 자는 앞끝을 여러 값으로 바꿔 가며 네 가지를 함께 본다. 결합률만 보면
 * 창을 무한히 열수록 좋아 보이지만, 잘못 짝지으면 못 뽑은 이름과 수급 어긋남이 는다.
 *
 *   ① 원장 결합률   — 높을수록 좋다(합성 개체가 준다)
 *   ② 합성 개체     — 짝을 못 찾아 새로 세운 유닛. 적을수록 좋다
 *   ③ 못 뽑은 이름  — 그 사람이 한 번도 안 뽑은 종류가 붙은 개체. 순전한 오류다
 *   ④ 수급 어긋남   — 뽑은 개수와 붙은 개수의 총변동거리. 0이 완벽
 *
 * 계측은 **원본을 안 건드린다** — replayUnits.ts를 임시 사본으로 떠서 그 안의
 * 붙박이 8만 바깥에서 넣는 값으로 바꾼다(hit-check·drop-check와 같은 수법).
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const si = argv.indexOf("--slack");
const bi = argv.indexOf("--back");
const SLACKS = (si >= 0 ? argv[si + 1] : "8").split(",").map(Number);
const BACKS = (bi >= 0 ? argv[bi + 1] : "300").split(",").map(Number);
const files = argv.filter((a, i) => !a.startsWith("--") && i !== si + 1 && i !== bi + 1);
if (files.length === 0) {
  console.error("쓰기: node scripts/bind-check.mjs <리플레이.rep…> [--slack 0,4,8,…]");
  process.exit(2);
}

/** 원본을 사본으로 떠서 창의 앞끝(8초)과 뒤끝(300초)을 바깥 값으로 바꾼다. */
function probeSource() {
  const src = readFileSync(join(ROOT, "src/utils/replayUnits.ts"), "utf8");
  const before = "r.it.done - 8";
  const back = "life.born - r.it.done > 300";
  const n = src.split(before).length - 1;
  const nb = src.split(back).length - 1;
  if (n === 0 || nb === 0) throw new Error("창 상수를 못 찾았다 — 원본이 바뀌었다");
  return {
    n: n + nb,
    text: "const __SLACK = Number(globalThis.__BIND_SLACK ?? 8);\n"
      + "const __BACK = Number(globalThis.__BIND_BACK ?? 300);\n"
      + src.replaceAll(before, "r.it.done - __SLACK")
        .replaceAll(back, "life.born - r.it.done > __BACK")
        .replaceAll('from "./', `from "${join(ROOT, "src/utils")}/`),
  };
}

async function bundleProbe() {
  const { n, text } = probeSource();
  const dir = mkdtempSync(join(tmpdir(), "bindchk-"));
  const ts = join(dir, "probe.ts");
  const out = join(dir, "probe.mjs");
  writeFileSync(ts, text);
  const ebin = join(ROOT, "node_modules", "esbuild", "bin", "esbuild");
  const head = readFileSync(ebin).subarray(0, 4);
  const native = (head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46)
    || (head[0] === 0x4d && head[1] === 0x5a);
  const a = [ts, "--bundle", "--platform=node", "--format=esm", "--log-level=error",
    `--outfile=${out}`];
  execFileSync(native ? ebin : process.execPath, native ? a : [ebin, ...a],
    { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  const mod = await import(pathToFileURL(out).href);
  rmSync(dir, { recursive: true, force: true });
  console.log(`계측용 사본에 앞끝 자리 ${n}곳을 바깥 값으로 뚫었다.`);
  return mod;
}

const { buildUnitTracks } = await bundleProbe();
const { default: Screp } = await import("screp-js");

const nm = (v) => (typeof v === "string" ? v : v?.Name ?? "");
const RACE = { Terran: "테란", Protoss: "프로토스", Zerg: "저그" };
const RACE_WORKER = { 테란: "SCV", 프로토스: "Probe", 저그: "Drone" };
const TWINS = new Set(["Zergling", "Scourge"]);
const FROM = {
  Lurker: "Hydralisk", Guardian: "Mutalisk", Devourer: "Mutalisk",
  "Lurker Egg": "Hydralisk", Archon: "High Templar", "Dark Archon": "Dark Templar",
};
const ALIAS = { "Siege Tank": "Siege Tank (Tank Mode)" };
const canon = (u) => ALIAS[u] ?? u;

/** id-check와 같은 잣대로 '뽑은 개수'를 센다. */
function producedOf(cmds, players) {
  const sel = new Map();
  const prod = new Map();
  const add = (pid, unit0, n) => {
    const unit = canon(unit0);
    const m = prod.get(pid) ?? new Map();
    m.set(unit, (m.get(unit) ?? 0) + n);
    prod.set(pid, m);
  };
  for (const c of cmds) {
    const t = nm(c.Type);
    const pid = c.PlayerID;
    if (t === "Select") { sel.set(pid, [...(c.UnitTags ?? [])]); continue; }
    if (t === "Select Add") { sel.set(pid, [...(sel.get(pid) ?? []), ...(c.UnitTags ?? [])]); continue; }
    if (t === "Select Remove") {
      const rm = new Set(c.UnitTags ?? []);
      sel.set(pid, (sel.get(pid) ?? []).filter((x) => !rm.has(x)));
      continue;
    }
    const unit = nm(c.Unit);
    if (!unit && t !== "Merge Archon" && t !== "Merge Dark Archon") continue;
    const ik = c.IneffKind;
    const ikv = typeof ik === "number" ? ik : String(ik ?? "");
    if (ik !== undefined && ik !== null && ikv !== 0 && ikv !== "0" && ikv !== "" && ikv !== "Effective") continue;
    if (t === "Train") { add(pid, unit, TWINS.has(unit) ? 2 : 1); continue; }
    if (t === "Merge Archon" || t === "Merge Dark Archon") {
      const made = t === "Merge Archon" ? "Archon" : "Dark Archon";
      const src = t === "Merge Archon" ? "High Templar" : "Dark Templar";
      const n = Math.max(2, (sel.get(pid) ?? []).length);
      add(pid, made, Math.floor(n / 2));
      add(pid, src, -Math.floor(n / 2) * 2);
      continue;
    }
    if (t === "Unit Morph") {
      const n = Math.max(1, (sel.get(pid) ?? []).length);
      add(pid, unit, TWINS.has(unit) ? n * 2 : n);
      const from = FROM[unit];
      if (from) add(pid, from, -n);
      continue;
    }
  }
  for (const p of players) {
    const w = RACE_WORKER[p.race];
    if (w) add(p.id, w, 4);
    if (p.race === "저그") add(p.id, "Overlord", 1);
  }
  return prod;
}

function scoreOf(d, prod, players) {
  const named = new Map();
  let ents = 0;
  let unnamed = 0;
  for (const e of d.ents) {
    if (e.bld) continue;
    ents += 1;
    if (!e.k) { unnamed += 1; continue; }
    const m = named.get(e.o) ?? new Map();
    m.set(e.k, (m.get(e.k) ?? 0) + 1);
    named.set(e.o, m);
  }
  let ghost = 0;
  let tvdNum = 0;
  let tvdDen = 0;
  for (const p of players) {
    const P = prod.get(p.id) ?? new Map();
    const N = named.get(p.id) ?? new Map();
    for (const [k, n] of N) if ((P.get(k) ?? 0) <= 0) ghost += n;
    const keys = new Set([...P.keys(), ...N.keys()]);
    for (const k of keys) {
      const a = Math.max(0, P.get(k) ?? 0);
      const b = N.get(k) ?? 0;
      tvdNum += Math.abs(a - b);
      tvdDen += a;
    }
  }
  const st = d.stats ?? {};
  return {
    ents,
    unnamed,
    bound: st.prodBound ?? 0,
    prod: st.prod ?? 0,
    syn: st.prodSyn ?? 0,
    ghost,
    tvd: tvdDen > 0 ? (tvdNum / tvdDen) * 100 : 0,
  };
}

console.log("\n── 결합 창 앞끝 민감도 ─────────────────────────────────────────────");
for (const path of files) {
  const buf = new Uint8Array(readFileSync(path));
  const res = await Screp.parseBuffer(buf, { cmds: true, mapData: true, mapTiles: true, mapResLoc: true });
  const cmds = res.Commands?.Cmds ?? [];
  const spots = new Map((res.MapData?.StartLocations ?? []).map((sp) => [sp.SlotID, sp]));
  const players = (res.Header.Players ?? [])
    .filter((p) => !p.Observer && nm(p.Type) !== "Observer")
    .map((p) => {
      const sp = spots.get(p.SlotID);
      return {
        id: p.ID, name: p.Name, race: RACE[nm(p.Race)] ?? "",
        team: typeof p.Team === "number" ? p.Team : null,
        startX: sp ? sp.X / 32 : null,
        startY: sp ? sp.Y / 32 : null,
      };
    });
  const prod = producedOf(cmds, players);
  console.log(`\n${path.split("/").pop().slice(0, 46)}`);
  console.log("  앞끝  뒤끝     결합률          합성개체   무명   못뽑은이름   수급어긋남");
  for (const s of SLACKS) {
    for (const b of BACKS) {
      globalThis.__BIND_SLACK = s;
      globalThis.__BIND_BACK = b;
      const d = buildUnitTracks(cmds, players);
      const q = scoreOf(d, prod, players);
      const pct = q.prod > 0 ? (q.bound / q.prod) * 100 : 0;
      console.log(`  ${String(s).padStart(3)}초 ${String(b).padStart(5)}초`
        + `  ${String(q.bound).padStart(5)}/${String(q.prod).padStart(5)}`
        + ` = ${pct.toFixed(1).padStart(5)}%   ${String(q.syn).padStart(5)}기`
        + `  ${String(q.unnamed).padStart(4)}기  ${String(q.ghost).padStart(6)}기`
        + `  ${q.tvd.toFixed(1).padStart(8)}%`);
    }
  }
}
console.log("\n결합률만 보고 창을 넓히면 안 된다 — 못 뽑은 이름과 수급 어긋남이 함께 안 나빠지는"
  + " 가장 넓은 앞끝이 옳은 값이다.");
