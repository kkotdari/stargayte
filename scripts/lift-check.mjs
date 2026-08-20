/* 테란 건물의 이·착륙을 재는 자 (지적: "11시 테란이 건물을 다 띄웠는데 리플에선
 * 안 보여. 건물을 내린 걸 새로 지은 걸로 착각하기도 하고")
 *
 *   node scripts/lift-check.mjs <리플레이.rep…>
 *
 * 리플레이가 말하는 이·착륙 커맨드 수와, 분석이 실제로 남긴 증거(f=6 이륙 · f=5 착륙)를
 * 나란히 센다. 둘이 어긋나면 그만큼이 화면에서 사라진 이·착륙이다. 착륙을 새 건물로
 * 착각했는지는 **같은 자리에 같은 종류가 둘 이상 서 있는지**로 잡는다.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (files.length === 0) {
  console.error("쓰기: node scripts/lift-check.mjs <리플레이.rep…>");
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), "liftchk-"));
const src = join(dir, "e.ts");
const out = join(dir, "e.mjs");
writeFileSync(src, `export { buildUnitTracks } from ${JSON.stringify(join(ROOT, "src/utils/replayUnits"))};`);
{
  const ebin = join(ROOT, "node_modules", "esbuild", "bin", "esbuild");
  const head = readFileSync(ebin).subarray(0, 4);
  /* 실행 파일인가 — 아니면 esbuild 껍데기 스크립트라 node로 돌려야 한다.
     ★ 맥(Mach-O)을 빠뜨리고 있었다(수리: 이 자가 아예 안 돌았다) — ELF·PE만 보다가
     맥의 실행 파일을 스크립트로 알고 node에 먹여 SyntaxError가 났다. */
  const mg = (a, b, c, d) => head[0] === a && head[1] === b && head[2] === c && head[3] === d;
  const native = mg(0x7f, 0x45, 0x4c, 0x46)          // ELF (리눅스)
    || (head[0] === 0x4d && head[1] === 0x5a)        // PE  (윈도)
    || mg(0xcf, 0xfa, 0xed, 0xfe) || mg(0xce, 0xfa, 0xed, 0xfe)
    || mg(0xfe, 0xed, 0xfa, 0xcf) || mg(0xfe, 0xed, 0xfa, 0xce)
    || mg(0xca, 0xfe, 0xba, 0xbe);                   // Mach-O (맥)
  const a = [src, "--bundle", "--platform=node", "--format=esm", "--log-level=error", `--outfile=${out}`];
  execFileSync(native ? ebin : process.execPath, native ? a : [ebin, ...a],
    { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
}
const { buildUnitTracks } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });
const { default: Screp } = await import("screp-js");

const nm = (v) => (typeof v === "string" ? v : v?.Name ?? "");
const RACE = { Terran: "테란", Protoss: "프로토스", Zerg: "저그" };
const CLOCK = (x, y, w, h) => {
  const a = (Math.atan2(x - w / 2, (h / 2) - y) * 180) / Math.PI;
  const hh = Math.round((((a + 360) % 360) / 30)) % 12;
  return `${hh === 0 ? 12 : hh}시`;
};

let totalLift = 0;
let seenLift = 0;
let totalLand = 0;
let seenLand = 0;
let ghosts = 0;
let noSite = 0;
let liftedB = 0;
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
  const mw = res.MapData?.Width ?? 128;
  const mh = res.MapData?.Height ?? 128;

  // ① 리플레이가 말하는 이·착륙 커맨드.
  const cmdLift = new Map();
  const cmdLand = new Map();
  for (const c of cmds) {
    const t = nm(c.Type);
    if (t === "Lift Off") cmdLift.set(c.PlayerID, (cmdLift.get(c.PlayerID) ?? 0) + 1);
    else if (t === "Land" || (t === "Build" && nm(c.Order) === "BuildingLand")) {
      cmdLand.set(c.PlayerID, (cmdLand.get(c.PlayerID) ?? 0) + 1);
    }
  }

  // ② 분석이 남긴 증거.
  const d = buildUnitTracks(cmds, players);
  const evLift = new Map();
  const evLand = new Map();
  const bldAt = new Map();          // 임자|종류|자리 → 건물 수(같은 자리 겹침 = 유령 의심)
  for (const e of d.ents) {
    for (const v of e.ev ?? []) {
      if (v[3] === 6) evLift.set(e.o, (evLift.get(e.o) ?? 0) + 1);
      if (v[3] === 5) evLand.set(e.o, (evLand.get(e.o) ?? 0) + 1);
    }
    /* 화면이 읽는 줄 그대로 — 자리 증거마다 한 줄이고, 다음 자리 증거 때 걷힌다.
       겹침은 **같은 때 같은 자리**여야 겹침이다(시각을 안 보면 띄운 건물의 앉았던 줄과
       땅에 있던 줄이 늘 겹쳐 보인다 — 실제로는 이륙 순간에 하나가 끝나고 하나가 연다). */
    if (e.bld && e.k && e.ev?.length) {
      const sp = e.ev.filter((v) => v[3] === 2 || v[3] === 5);
      for (let i = 0; i < sp.length; i += 1) {
        const end = i + 1 < sp.length ? sp[i + 1][0] : (e.d || Infinity);
        const k = `${e.o}|${e.k}|${Math.round(sp[i][1])},${Math.round(sp[i][2])}`;
        const arr = bldAt.get(k) ?? [];
        arr.push({ b: sp[i][0], g: end, t: e.t });
        bldAt.set(k, arr);
      }
    }
  }

  console.log(`\n══ ${path.split("/").pop().slice(0, 44)} ═════════════════════`);
  console.log("  자리    이름              종족   이륙 커맨드→증거   착륙 커맨드→증거");
  for (const p of players) {
    const cl = cmdLift.get(p.id) ?? 0;
    const el = evLift.get(p.id) ?? 0;
    const cd = cmdLand.get(p.id) ?? 0;
    const ed = evLand.get(p.id) ?? 0;
    if (cl === 0 && cd === 0 && el === 0 && ed === 0) continue;
    totalLift += cl; seenLift += Math.min(cl, el);
    totalLand += cd; seenLand += Math.min(cd, ed);
    const spot = p.startX !== null ? CLOCK(p.startX, p.startY, mw, mh) : "?";
    const badL = el < cl ? `  ← ${cl - el}건이 사라졌다` : "";
    const badD = ed < cd ? `  ← ${cd - ed}건이 사라졌다` : "";
    console.log(`  ${spot.padEnd(4)}  ${String(p.name).padEnd(16)} ${p.race.padEnd(5)}`
      + `  ${String(cl).padStart(4)} → ${String(el).padStart(4)}${badL.padEnd(18)}`
      + `  ${String(cd).padStart(4)} → ${String(ed).padStart(4)}${badD}`);
  }

  /* ③ 화면이 읽는 줄(buildsSrc)을 그대로 만들어 본다 — 건물 하나의 생애가 자리
     증거(f=2 건설 · f=5 착륙)마다 한 줄로 쪼개지고, 각 줄은 다음 자리 증거 때 걷힌다.
     이륙(f=6)이 그 줄 구간에 있으면 그 줄은 '떠 있는 줄'이다. */
  for (const p of players) {
    if (p.race !== "테란") continue;
    const mine = d.ents.filter((e) => e.bld && e.o === p.id && (e.ev ?? []).some((v) => v[3] === 6));
    if (mine.length === 0) continue;
    console.log(`  · ${p.name} — 이륙 증거를 지닌 건물 ${mine.length}기`);
    for (const e of mine.slice(0, 12)) {
      const spots = e.ev.filter((v) => v[3] === 2 || v[3] === 5);
      const rows = spots.map((sp, i) => {
        const nextS = i + 1 < spots.length ? spots[i + 1][0] : null;
        const lift = e.ev.find((v) => v[3] === 6 && v[0] >= sp[0] && (nextS === null || v[0] <= nextS));
        return `[${sp[0]}s (${sp[1]},${sp[2]}) ${sp[3] === 5 ? "착륙" : "건설"}`
          + `${lift ? ` 이륙${lift[0]}s` : ""} → 걷힘 ${nextS ?? (e.d ?? 0)}]`;
      });
      liftedB += 1;
      if (spots.length === 0) noSite += 1;
      console.log(`      ${String(e.k).padEnd(14)} 태그${String(e.t).padStart(7)}`
        + ` 자리증거 ${spots.length}개 · 이륙증거 ${e.ev.filter((v) => v[3] === 6).length}개`);
      console.log(`        ${rows.join(" ") || "자리 증거가 없다 ← 이 건물은 화면에 아예 안 선다"}`);
    }
  }

  // ④ 착륙을 새 건물로 착각했나 — 같은 임자·같은 종류가 같은 자리에 여럿.
  const dup = [];
  for (const [k, a] of bldAt) {
    let n = 0;
    for (let i = 0; i < a.length; i += 1) {
      for (let j = i + 1; j < a.length; j += 1) {
        if (a[i].b < a[j].g && a[j].b < a[i].g) n += 1;
      }
    }
    if (n > 0) dup.push([k, a, n]);
  }
  ghosts += dup.reduce((n, [, , c]) => n + c, 0);
  if (dup.length > 0) {
    console.log(`  같은 때 같은 자리에 겹쳐 선 건물 ${dup.length}자리 (앞 6자리):`);
    for (const [k, a] of dup.slice(0, 6)) {
      console.log(`    ${k}  ${a.map((e) => `[${e.b}~${e.g === Infinity ? "끝" : e.g}]`).join(" ")}`);
    }
  }
}
console.log(`\n요약 — 띄운 건물 ${liftedB}기 중 **앉았던 자리를 모르는 것 ${noSite}기**`
  + "(그런 건물은 화면에 아예 안 선다)");
console.log(`       이륙 커맨드 ${totalLift}건 중 증거로 남은 것 ${seenLift}건`
  + ` · 착륙 커맨드 ${totalLand}건 중 ${seenLand}건 · 같은 때 같은 자리에 겹쳐 선 건물 ${ghosts}쌍`);
