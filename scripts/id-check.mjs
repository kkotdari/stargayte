/* 유닛 정체 판정 성적표 (과제 #71)
 *
 *   node scripts/id-check.mjs <리플레이.rep…>
 *
 * 지적: "가장 큰 문제는 분석에서 유닛 유추다. 유닛 위치 + 마우스 커맨드 기반이라 특정이
 * 아니다 보니 — 질럿·드라군처럼 기술 없는 애들이 프로브로 잡히는 경우도 많다."
 *
 * 고치려면 먼저 재야 한다(#68에서 배운 것). 리플레이에는 태그별 유닛 종류가 **안 들어
 * 있으므로** 정답표는 없다. 대신 커맨드가 말해 주는 것과 분석이 붙인 이름을 견준다.
 *
 * [네 가지]
 *  1. 무명률 — 이름을 못 붙인 개체의 비율. 그리는 쪽이 못 그리고 싸우지도 못한다.
 *  2. 원장 결합률 — 생산 원장의 유닛이 실제 태그에 묶인 비율. 묶이면 정체가 확실하다.
 *  3. 못 뽑은 이름 — 그 사람이 한 번도 안 뽑은 종류가 붙은 개체 수. 순전한 오류다.
 *  4. 수급 어긋남 — 뽑은 개수와 붙은 개수의 총변동거리(TVD). 0이면 개수가 딱 맞는다.
 *
 * [뽑은 개수를 세는 규칙 — 지적으로 바로잡은 것]
 *  · 건물 여럿을 골라도 Train은 **하나**만 나온다. BW는 다중 생산이 없다.
 *  · 라바는 유닛이라 Unit Morph가 **고른 라바 전부**에 걸린다 — 저그만 여럿 나온다.
 *  · 저글링·스커지는 알 하나에서 둘이 나온다.
 *  · 시작 유닛(일꾼 4 + 저그 오버로드 1)은 커맨드가 없다.
 *  · 러커·가디언·디바우러·아콘은 있던 유닛이 변한 것이라, 원본이 그만큼 준다.
 * 그래도 이 수는 정답이 아니다 — 인구 막힘·취소·건물 파괴로 커맨드가 유닛이 안 되기도
 * 한다(지적). 그래서 4번은 '얼마나 어긋나나'를 보는 상대 지표로만 쓴다. */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("쓰기: node scripts/id-check.mjs <리플레이.rep…>");
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), "idchk-"));
const src = join(dir, "e.ts");
const out = join(dir, "e.mjs");
writeFileSync(src, `export { buildUnitTracks } from ${JSON.stringify(join(ROOT, "src/utils/replayUnits"))};`);
execFileSync("npx", ["esbuild", src, "--bundle", "--platform=node", "--format=esm",
  "--log-level=error", `--outfile=${out}`], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
const { buildUnitTracks } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });
const { default: Screp } = await import("screp-js");

const nm = (v) => (typeof v === "string" ? v : v?.Name ?? "");
const RACE = { Terran: "테란", Protoss: "프로토스", Zerg: "저그" };
/** 알 하나에서 둘이 나오는 것. */
const TWINS = new Set(["Zergling", "Scourge"]);
/** 있던 유닛이 변하는 것 — 원본이 그만큼 준다. */
const FROM = {
  Lurker: "Hydralisk", Guardian: "Mutalisk", Devourer: "Mutalisk",
  "Lurker Egg": "Hydralisk", Archon: "High Templar", "Dark Archon": "Dark Templar",
};
/** 같은 유닛의 다른 표기 — 분석(replayUnits.KIND_ALIAS)과 같은 잣대여야 한다. */
const ALIAS = { "Siege Tank": "Siege Tank (Tank Mode)" };
const canon = (u) => ALIAS[u] ?? u;
const RACE_WORKER = { 테란: "SCV", 프로토스: "Probe", 저그: "Drone" };

/** 커맨드에서 '뽑은 개수'를 센다 — 위 규칙 그대로. */
function producedOf(cmds, players) {
  const sel = new Map();
  const prod = new Map();      // pid → Map<unit, n>
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
    /* 헛친 커맨드는 유닛이 안 된다(지적: 인구 막힘·전력 끊김·건물 파괴 취소) —
       분석과 같은 잣대를 써야 앞뒤가 맞는다. */
    const ik = c.IneffKind;
    const ikv = typeof ik === "number" ? ik : String(ik ?? "");
    if (ik !== undefined && ik !== null && ikv !== 0 && ikv !== "0" && ikv !== "" && ikv !== "Effective") continue;
    if (t === "Train") { add(pid, unit, TWINS.has(unit) ? 2 : 1); continue; }
    /* 합체(아콘·다크아콘)는 Train도 Unit Morph도 아니라 여태 '뽑은 적 없음'으로 셌다 —
       고른 템플러 둘이 하나가 되므로 원본이 그만큼 준다. */
    if (t === "Merge Archon" || t === "Merge Dark Archon") {
      const made = t === "Merge Archon" ? "Archon" : "Dark Archon";
      const src = t === "Merge Archon" ? "High Templar" : "Dark Templar";
      const n = Math.max(2, (sel.get(pid) ?? []).length);
      add(pid, made, Math.floor(n / 2));
      add(pid, src, -Math.floor(n / 2) * 2);
      continue;
    }
    if (t === "Unit Morph") {
      // 라바 변태는 고른 라바 전부에 걸린다. 유닛 변태(러커 등)도 고른 전부다.
      const n = Math.max(1, (sel.get(pid) ?? []).length);
      add(pid, unit, TWINS.has(unit) ? n * 2 : n);
      const from = FROM[unit];
      if (from) add(pid, from, -n);
      continue;
    }
  }
  // 시작 유닛 — 커맨드가 없다.
  for (const p of players) {
    const w = RACE_WORKER[p.race];
    if (w) add(p.id, w, 4);
    if (p.race === "저그") add(p.id, "Overlord", 1);
  }
  return prod;
}

console.log("\n── 정체 판정 성적표 ───────────────────────────────────────────────");
for (const path of files) {
  const buf = new Uint8Array(readFileSync(path));
  const res = await Screp.parseBuffer(buf, { cmds: true, mapData: true, mapTiles: true, mapResLoc: true });
  const cmds = res.Commands?.Cmds ?? [];
  /* 시작 지점을 꼭 함께 넘겨야 한다 — 이게 없으면 분석이 시작 홀을 못 세우고,
     그러면 초반 생산이 '자리를 모르는 원장'이 되어 통째로 버려진다. 실측으로 여기를
     빠뜨렸더니 경기2의 원장 77건 중 45건이 사라져, 없는 결함을 쫓을 뻔했다. */
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
  const prod = producedOf(cmds, players);

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
  let ghost = 0;         // 뽑은 적 없는 이름
  let tvdNum = 0;
  let tvdDen = 0;
  for (const p of players) {
    const P = prod.get(p.id) ?? new Map();
    const N = named.get(p.id) ?? new Map();
    for (const [k, n] of N) if ((P.get(k) ?? 0) <= 0) ghost += n;
    const keys = new Set([...P.keys(), ...N.keys()]);
    let diff = 0;
    let tot = 0;
    for (const k of keys) {
      const a = Math.max(0, P.get(k) ?? 0);
      const b = N.get(k) ?? 0;
      diff += Math.abs(a - b);
      tot += a;
    }
    tvdNum += diff / 2;
    tvdDen += tot;
  }
  const st = d.stats;
  const name = path.split("/").pop().slice(0, 28);
  console.log(`\n${name}`);
  console.log(`  개체 ${String(ents).padStart(5)}  태그 ${String(st.tags).padStart(5)}`);
  console.log(`  ① 무명률        ${String(unnamed).padStart(5)} / ${String(ents).padStart(5)}`
    + `  = ${(unnamed / Math.max(1, ents) * 100).toFixed(1).padStart(5)}%`);
  console.log(`  ② 원장 결합률   ${String(st.prodBound ?? 0).padStart(5)} / ${String(st.prod ?? 0).padStart(5)}`
    + `  = ${((st.prodBound ?? 0) / Math.max(1, st.prod ?? 1) * 100).toFixed(1).padStart(5)}%`);
  console.log(`  ③ 못 뽑은 이름  ${String(ghost).padStart(5)} 기`
    + `  = ${(ghost / Math.max(1, ents) * 100).toFixed(1).padStart(5)}%`);
  console.log(`  ④ 수급 어긋남   ${String(Math.round(tvdNum)).padStart(5)} / ${String(tvdDen).padStart(5)}`
    + `  = ${(tvdNum / Math.max(1, tvdDen) * 100).toFixed(1).padStart(5)}%  (0이 완벽)`);
  console.log(`     └ 선택 동반이 채운 이름 ${String(st.coSelFilled ?? 0).padStart(5)} 기`
    + `  · 건물 파괴로 취소한 생산 ${String(st.prodRazed ?? 0).padStart(4)} 건`
    + `  · 원장 몫이 없어 물러남 ${String(st.coSelOverQuota ?? 0).padStart(4)} 회`
    + `  · 잔여 원장이 채움 ${String(st.quotaAssigned ?? 0).padStart(4)} 기`
    + `  · 합성 개체 ${String(st.prodSyn ?? 0).padStart(4)} 기`
    + `  · 몫 넘겨 준 이름 ${String(st.coSelOverFilled ?? 0).padStart(4)} 기`
    + `  · 자리 못 정해 버린 원장 ${String(st.prodNoSite ?? 0).padStart(4)} 건`);
}
console.log("");
