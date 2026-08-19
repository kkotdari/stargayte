/* 저그 해처리의 라바·변태알을 재는 자 (지적: "저그 시작부터 알 두 개 변태",
 * "라바 자리가 아닌 다른 곳에서 알로 변태된다")
 *
 *   node scripts/larva-check.mjs [--db <sqlite>] [--t 0,1,2,5,10,20]
 *
 * 렌더러(ReplayMotionPlayer)가 해처리마다 라바 수와 알 목록을 되짚는 자리를 그대로
 * 떼어 와, 실제 개체 트랙을 먹여 시각별로 찍는다. 그림을 눈으로 세는 대신 숫자로
 * 본다 — "시작하자마자 알 둘"이 몇 초에 몇 개인지, 그 알이 어느 기록에서 왔는지,
 * 알과 라바가 어느 칸에 앉는지가 여기서 다 나온다.
 *
 * 규칙은 원작 표(bwUnits의 LARVA_*)와 개체 트랙의 출생 시각뿐이다. 지어낸 값은 없다.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* esbuild 진입점은 자바스크립트 껍데기일 때도 네이티브 실행 파일일 때도 있다
   (model-norm에서 겪은 자리) — 앞 네 바이트를 보고 고른다. */
async function bundle(entry) {
  const dir = mkdtempSync(join(tmpdir(), "larvachk-"));
  const out = join(dir, "m.mjs");
  const ebin = join(ROOT, "node_modules", "esbuild", "bin", "esbuild");
  const head = readFileSync(ebin).subarray(0, 4);
  const native = (head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46)
    || (head[0] === 0x4d && head[1] === 0x5a);
  const argv = [join(ROOT, entry), "--bundle", "--format=esm", "--log-level=error",
    `--outfile=${out}`];
  execFileSync(native ? ebin : process.execPath, native ? argv : [ebin, ...argv],
    { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  const mod = await import(pathToFileURL(out).href);
  rmSync(dir, { recursive: true, force: true });
  return mod;
}

const argv = process.argv.slice(2);
const at = (f, d) => (argv.indexOf(f) >= 0 ? argv[argv.indexOf(f) + 1] : d);
const ti = argv.indexOf("--t");
const di = argv.indexOf("--dump");
const DUMP = di >= 0 ? argv[di + 1] : null;
const DUMP_T = Number(at("--dumpT", "90"));
const dti = argv.indexOf("--dumpT");
const files = argv.filter((a, i) => !a.startsWith("--") && i !== ti + 1 && i !== di + 1 && i !== dti + 1);
const TS = at("--t", "0,1,2,4,8,15,30,60,120").split(",").map(Number);
if (files.length === 0) {
  console.error("쓰기: node scripts/larva-check.mjs <리플레이.rep…> [--t 0,1,2,…]");
  process.exit(2);
}

const { UNIT_BUILD_SEC, buildUnitTracks } = await bundle("src/utils/replayUnits.ts");
const { LARVA_MAX, hatchState, START_MINERALS } = await bundle("src/utils/bwUnits.ts");
const { default: Screp } = await import("screp-js");

const nm = (v) => (typeof v === "string" ? v : v?.Name ?? "");
const RACE = { Terran: "테란", Protoss: "프로토스", Zerg: "저그" };
const RACE_WORKER = { 테란: "SCV", 프로토스: "Probe", 저그: "Drone" };

const HALLS = new Set(["Hatchery", "Lair", "Hive"]);
const FOOT = [4, 3];

/** 렌더러와 같은 규칙 — 규칙 층(bwUnits.hatchState)을 그대로 부른다. */
function stateNow(recs, hallSec, bx, by, t) {
  const mine = recs.filter((r) => r.x >= bx - 1.5 && r.x <= bx + FOOT[0] + 1.5
    && r.y >= by - 1.5 && r.y <= by + FOOT[1] + 2);
  const spots = hatchState(mine, hallSec, hallSec <= 0, t, (u) => UNIT_BUILD_SEC[u] ?? 30);
  return {
    mine,
    larva: spots.filter((v) => v.kind === "larva").length,
    eggs: spots.filter((v) => v.kind === "egg"),
    slots: spots,
  };
}

let badEarly = 0;
let dup = 0;
let halls = 0;
let overEgg = 0;
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
  const d = buildUnitTracks(cmds, players);
  const nameOf = new Map(d.players.map((p) => [p.id, p.name]));
  const raceOf = new Map(d.players.map((p) => [p.id, p.race]));

  console.log(`\n══ ${path.split("/").pop()} ═════════════════════════════════`);

  /* ── ① 시작 개체 수 — 일꾼 넷 + (저그) 오버로드 하나여야 한다. */
  const t0 = new Map();
  for (const e of d.ents) {
    if (e.bld || !e.k) continue;
    const b0 = e.ev?.[0];
    if (!b0 || b0[0] !== 0) continue;
    const m = t0.get(e.o) ?? new Map();
    m.set(e.k, (m.get(e.k) ?? 0) + 1);
    t0.set(e.o, m);
  }
  console.log("\n── 0초 개체(있어야 할 것: 일꾼 4 + 저그 오버로드 1)");
  for (const p of d.players) {
    const m = t0.get(p.id) ?? new Map();
    const w = RACE_WORKER[p.race] ?? "";
    const nw = m.get(w) ?? 0;
    const no = m.get("Overlord") ?? 0;
    const wantO = p.race === "저그" ? 1 : 0;
    const bad = (nw !== 4 ? ` ← 일꾼 ${nw}≠4` : "") + (no !== wantO ? ` ← 오버로드 ${no}≠${wantO}` : "");
    console.log(`  ${String(p.name).padEnd(16)} ${p.race.padEnd(5)} `
      + [...m].map(([k, n]) => `${k}×${n}`).join(" ").padEnd(34) + bad);
  }

  /* ── ② 해처리별 라바·알 */
  const prod = new Map();
  for (const e of d.ents) {
    if (e.bld || !e.k) continue;
    const b0 = e.ev?.[0];
    if (!b0 || b0[3] !== 3 || b0[1] < 0) continue;
    const raw = nameOf.get(e.o);
    if (raw === undefined) continue;
    if (!prod.has(raw)) prod.set(raw, []);
    prod.get(raw).push({ u: e.k, s: b0[0], x: b0[1], y: b0[2], tag: e.t, ev0: b0, ev1: e.ev[1] ?? null, n: e.ev.length, d: e.d, dk: e.dk });
  }
  for (const a of prod.values()) a.sort((x, y) => x.s - y.s);

  console.log("\n── 시작 해처리의 라바·알");
  for (const e of d.ents) {
    if (!e.bld || !HALLS.has(e.k) || raceOf.get(e.o) !== "저그") continue;
    if (e.b !== 0 || !e.ev?.length) continue;
    const raw = nameOf.get(e.o);
    const bx = e.ev[0][1];
    const by = e.ev[0][2];
    const recs = prod.get(raw) ?? [];
    halls += 1;
    const line = [];
    for (const t of TS) {
      const st = stateNow(recs, e.b, bx, by, t);
      line.push(`t=${t} 라바${st.larva} 알${st.eggs.length}`);
      dup += new Set(st.slots.map((v) => v.slot)).size !== st.slots.length ? 1 : 0;
      // 0~2초에 알이 하나는 옳다(50미네랄로 드론 하나) — 둘부터가 어긋난 것이다.
      if (t <= 2 && st.eggs.length > 1) badEarly += 1;
      if (st.eggs.length > LARVA_MAX) overEgg += 1;
    }
    console.log(`  ${String(raw).padEnd(16)} (${bx},${by})  ${line.join("  ")}`);
    const near = recs.filter((r) => r.x >= bx - 1.5 && r.x <= bx + FOOT[0] + 1.5
      && r.y >= by - 1.5 && r.y <= by + FOOT[1] + 2 && r.s <= 120);
    console.log(`      120초까지 발자국 언저리 기록 ${near.length}건: `
      + near.slice(0, 12).map((r) => `${r.u}@${r.s}`).join(" "));
    /* --dump <이름> — 그 사람의 시작 해처리를 1초씩 찍는다. 칸 여섯을 그대로 늘어놓아
       어느 칸이 라바에서 알로 바뀌고 언제 비는지가 한눈에 보인다. */
    if (DUMP && String(raw).includes(DUMP)) {
      console.log(`      ── ${DUMP} 1초씩 (·=빈칸 l=라바 대문자=알)`);
      const kept = recs.filter((r) => r.x >= bx - 1.5 && r.x <= bx + FOOT[0] + 1.5
        && r.y >= by - 1.5 && r.y <= by + FOOT[1] + 2);
      console.log("        알 후보(태그<0 = 합성 개체):");
      for (const r of kept.slice(0, 22)) {
        const need = UNIT_BUILD_SEC[r.u] ?? 30;
        console.log(`          ${r.u.padEnd(9)} 변태 ${String((r.s - need).toFixed(0)).padStart(5)}`
          + ` → 부화 ${String(r.s).padStart(4)}  태그 ${String(r.tag).padStart(7)}`
          + `  증거 ${String(r.n).padStart(3)}개  죽음 ${String(r.d ?? "-").padStart(5)}(${r.dk || "-"})`
          + `  첫증거 ${JSON.stringify(r.ev0)}`);
      }
      for (let tt = 0; tt <= DUMP_T; tt += 1) {
        const st = stateNow(recs, e.b, bx, by, tt);
        const row = Array.from({ length: 6 }, () => "·");
        for (const v of st.slots) row[v.slot] = v.kind === "larva" ? "l" : (v.u[0] ?? "E");
        console.log(`        t=${String(tt).padStart(3)}  ${row.join(" ")}`);
      }
    }
  }
}
console.log(`\n요약 — 시작 해처리 ${halls}개 · 시작 자원 ${START_MINERALS}미네랄`
  + ` · t≤2s에 알이 둘 이상 뜬 자리 ${badEarly}건 · 알이 라바 최대(${LARVA_MAX})를 넘은 자리 ${overEgg}건`
  + ` · 한 칸에 둘이 겹친 자리 ${dup}건`);
