/* 「무리대표 마린」 성적표 ─────────────────────────────────────────────────────────
 *   node scripts/bionic-check.mjs <리플레이.rep…>
 *
 * 스팀(f=16)만 있고 제 정체 증거가 하나도 없던 개체는 마린인지 파이어뱃인지 모른다.
 * 여태는 상수 하나(GROUP_FALLBACK)가 그런 무명을 통째로 마린으로 못 박았다.
 * 이 자는 그 무명이 몇이고 어느 이름으로 갈렸는지, 그리고 그 임자의 **실제 조성**과
 * 얼마나 맞는지를 잰다:
 *   · 무명 수 — 스팀 증거를 지녔는데 이름을 말해 줄 다른 증거가 없던 개체.
 *   · 갈린 몫 — 그 무명들이 마린/파벳으로 나뉜 수.
 *   · 조성 어긋남 — 임자별 (마린:파벳) 비를 구체 증거만으로 잰 것과, 무명까지 더한
 *     것 사이의 총변동거리(TVD). 0이면 무명이 조성을 한 톨도 안 흔들었다는 뜻이다. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("쓰기: node scripts/bionic-check.mjs <리플레이.rep…>");
  process.exit(2);
}
const dir = mkdtempSync(join(tmpdir(), "bionic-"));
const src = join(dir, "e.ts");
const out = join(dir, "e.mjs");
writeFileSync(src, `export { buildUnitTracks } from ${JSON.stringify(join(ROOT, "src/utils/replayUnits"))};`);
execFileSync("npx", ["esbuild", src, "--bundle", "--platform=node", "--format=esm",
  "--log-level=error", `--outfile=${out}`], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
const { buildUnitTracks } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });
const { default: Screp } = await import("screp-js");
const { readFileSync } = await import("node:fs");

const nm = (v) => (typeof v === "string" ? v : v?.Name ?? "");
const RACE = { Terran: "테란", Protoss: "프로토스", Zerg: "저그" };
const BIONIC = ["Marine", "Firebat"];

for (const f of files) {
  const res = await Screp.parseBuffer(readFileSync(f), { cmds: true, mapData: true });
  const cmds = res.Commands?.Cmds ?? [];
  const spots = new Map((res.MapData?.StartLocations ?? []).map((sp) => [sp.SlotID, sp]));
  const players = (res.Header.Players ?? [])
    .filter((p) => !p.Observer && nm(p.Type) !== "Observer")
    .map((p) => {
      const sp = spots.get(p.SlotID);
      return {
        id: p.ID, name: p.Name, race: RACE[nm(p.Race)] ?? "",
        team: typeof p.Team === "number" ? p.Team : null,
        startX: sp ? sp.X / 32 : null, startY: sp ? sp.Y / 32 : null,
      };
    });
  const d = buildUnitTracks(cmds, players);

  /** 스팀 증거를 지닌 개체 — f=16. 그중 '제 정체를 말해 주는 다른 증거'가 없던 것이 무명. */
  const stimmed = d.ents.filter((e) => !e.bld && (e.ev ?? []).some((v) => v[3] === 16));
  const own = new Map();     // pid → {solid:{Marine,Firebat}, all:{...}, guessed:{...}}
  for (const e of d.ents) {
    if (e.bld || !BIONIC.includes(e.k)) continue;
    const r = own.get(e.o) ?? { solid: {}, all: {}, guessed: {} };
    r.all[e.k] = (r.all[e.k] ?? 0) + 1;
    own.set(e.o, r);
  }
  /* 무명 판별은 분석 밖에서 다시 못 한다(kinds는 안 나온다) — 대신 스팀만 있고 제
     행동 증거(시즈 8·9 · 힐/수리 10 · 건설 2)가 없는 것을 같은 잣대로 센다. */
  let unknown = 0;
  const split = {};
  for (const e of stimmed) {
    if ((e.ev ?? []).some((v) => v[3] === 8 || v[3] === 9 || v[3] === 10 || v[3] === 2)) continue;
    unknown += 1;
    split[e.k] = (split[e.k] ?? 0) + 1;
    const r = own.get(e.o);
    if (r) r.guessed[e.k] = (r.guessed[e.k] ?? 0) + 1;
  }
  let tvd = 0;
  let owners = 0;
  for (const [, r] of own) {
    const solid = {};
    let sTot = 0;
    let aTot = 0;
    for (const k of BIONIC) {
      solid[k] = (r.all[k] ?? 0) - (r.guessed[k] ?? 0);
      sTot += solid[k];
      aTot += r.all[k] ?? 0;
    }
    if (sTot === 0 || aTot === 0) continue;
    owners += 1;
    let v = 0;
    for (const k of BIONIC) v += Math.abs(solid[k] / sTot - (r.all[k] ?? 0) / aTot);
    tvd += v / 2;
  }
  console.log(`\n▸ ${f.split("/").pop()}`);
  console.log(`  스팀 증거 개체 ${stimmed.length}기 · 그중 정체 무명 ${unknown}기`);
  console.log(`  무명이 갈린 몫: ${BIONIC.map((k) => `${k} ${split[k] ?? 0}`).join(" · ")}`);
  console.log(`  조성 어긋남(TVD, 임자 ${owners}명 합): ${tvd.toFixed(3)}  (0이면 무명이 조성을 안 흔들었다)`);
  const st = d.stats ?? {};
  console.log(`  ▷ 진짜 무명 ${st.groupUnknown ?? "?"}기 — 선택 다수결 ${st.groupBySel ?? "?"} ·`
    + ` 임자 비율 ${st.groupByMix ?? "?"} · 옛 대표 ${st.groupByFallback ?? "?"}`);
}
