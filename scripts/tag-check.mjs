/* 태그 재사용을 가리는 자 (제안: "원장 해석에는 오차가 있으니 태그를 중심으로 하되,
 * 태그 재할당을 정확히 가려내자")
 *
 *   node scripts/tag-check.mjs <리플레이.rep…> [--cap 6.4]
 *
 * 태그는 유닛이 아니라 **슬롯 번호**다. 유닛이 죽으면 다음 유닛이 그 번호를 물려받는다.
 * 지금 분석이 재사용을 가리는 자는 둘뿐이다.
 *   ① 임자가 바뀜        — 확실하다
 *   ② 정체가 부딪힘      — 시즈를 켰던 번호가 버로우를 하면 딴 유닛이다. 확실하다
 * 둘 다 '어쩌다 드러나는' 자라, 같은 사람의 같은 종류가 번호를 물려받으면 안 걸린다.
 *
 * 셋째 자가 있다. **속력은 불변이다.** 개체가 실제로 '있던' 자리 두 점 사이를 그 유닛이
 * 낼 수 있는 속력으로 못 가면, 그 둘은 같은 유닛이 아니다. 커맨드와 원작 표만 쓰므로
 * 어림이 아니다.
 *
 * 자리 증거만 쓴다 — f=1(남이 찍은 자리)·2(건설)·3(멈춤)·5(착륙)·6(이륙)은 '있던 자리'고,
 * f=0(이동 목적지)·7(공격 목적지)은 '가려던 자리'라 못 쓴다.
 * 수송선·리콜은 뺀다 — 그 사이에 승선(f=12)이 있으면 순간이동이 정상이다.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const ci = argv.indexOf("--cap");
const CAP_UNKNOWN = Number(ci >= 0 ? argv[ci + 1] : "6.4");
const files = argv.filter((a, i) => !a.startsWith("--") && !(ci >= 0 && i === ci + 1));
if (files.length === 0) {
  console.error("쓰기: node scripts/tag-check.mjs <리플레이.rep…> [--cap 6.4]");
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), "tagchk-"));
const src = join(dir, "e.ts");
const out = join(dir, "e.mjs");
writeFileSync(src, `export { buildUnitTracks } from ${JSON.stringify(join(ROOT, "src/utils/replayUnits"))};\n`
  + `export { speedOfUnit } from ${JSON.stringify(join(ROOT, "src/utils/bwUnits"))};`);
{
  const ebin = join(ROOT, "node_modules", "esbuild", "bin", "esbuild");
  const head = readFileSync(ebin).subarray(0, 4);
  const native = (head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46)
    || (head[0] === 0x4d && head[1] === 0x5a);
  const a = [src, "--bundle", "--platform=node", "--format=esm", "--log-level=error", `--outfile=${out}`];
  execFileSync(native ? ebin : process.execPath, native ? a : [ebin, ...a],
    { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
}
const { buildUnitTracks, speedOfUnit } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });
const { default: Screp } = await import("screp-js");

const nm = (v) => (typeof v === "string" ? v : v?.Name ?? "");
const RACE = { Terran: "테란", Protoss: "프로토스", Zerg: "저그" };
/** '있던 자리' 증거만 — 목적지는 못 쓴다. */
const REAL_SPOT = new Set([1, 2, 3, 5, 6]);

let allLives = 0;
let allBad = 0;
const speedHist = new Map();
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

  /* 우리가 가진 증거가 무엇인지부터 — 자리 증거가 적으면 속력 자는 볼 것이 없다. */
  const evKind = new Map();
  for (const e of d.ents) {
    if (e.bld) continue;
    for (const v of e.ev) evKind.set(v[3], (evKind.get(v[3]) ?? 0) + 1);
  }
  const EVNAME = {
    0: "이동 목적지(가려던 곳)", 1: "남이 찍은 자리(있던 곳)", 2: "건설 자리",
    3: "멈춤·홀드(있던 곳)", 4: "생산·랠리", 5: "착륙", 6: "이륙", 7: "공격 목적지",
    8: "시즈 켬", 9: "시즈 끔", 12: "탑승", 13: "하차", 14: "클로킹 켬", 15: "끔",
    16: "스팀", 18: "버로우 켬", 19: "끔",
  };
  const evTot = [...evKind.values()].reduce((a, b) => a + b, 0) || 1;

  /* ── 도착이 확실한 목적지를 자리로 승격해 다시 잰다 ─────────────────────────
     f=0(이동 목적지)은 '가려던 곳'이지만, 다음 명령까지 걸린 시간이 거기까지 걷는
     시간보다 넉넉하면 그 유닛은 **도착해 있었다**. 그때 그 점은 자리다.
     길이 굽어 있고 교전에 멈추기도 하니 여유(SLACK)를 곱해 넉넉할 때만 승격한다. */
  const SLACK = 1.6;
  let lives2 = 0;
  let bad2 = 0;
  let pairs2 = 0;
  for (const e of d.ents) {
    if (e.bld) continue;
    lives2 += 1;
    const sp = e.k ? speedOfUnit(e.k) : 4;
    const cap = e.k ? speedOfUnit(e.k) * 1.5 : CAP_UNKNOWN;
    // 자리 목록 만들기 — 진짜 자리 + 도착이 확실한 목적지.
    const track = [];
    let pendMove = null;
    for (const v of e.ev) {
      if (v[3] === 12) { pendMove = null; track.push(null); continue; }  // 승선 — 끊는다
      if (REAL_SPOT.has(v[3]) && v[1] >= 0) { track.push([v[0], v[1], v[2]]); pendMove = null; continue; }
      if (v[3] !== 0 || v[1] < 0) continue;
      if (pendMove) {
        const dt = v[0] - pendMove[0];
        const need = Math.hypot(v[1] - pendMove[1], v[2] - pendMove[2]) / Math.max(0.5, sp);
        if (dt >= need * SLACK) track.push([pendMove[0] + need, pendMove[1], pendMove[2]]);
      }
      pendMove = [v[0], v[1], v[2]];
    }
    let prev = null;
    let hit = false;
    for (const t of track) {
      if (!t) { prev = null; continue; }
      if (prev) {
        const dt = t[0] - prev[0];
        const dd = Math.hypot(t[1] - prev[1], t[2] - prev[2]);
        if (dt >= 0 && dd > 1) {
          pairs2 += 1;
          if (dd / Math.max(0.5, dt) > cap * SLACK) hit = true;
        }
      }
      prev = t;
    }
    if (hit) bad2 += 1;
  }
  console.log(`  ★ 도착 승격까지 넣으면 — 견준 자리쌍 ${pairs2}쌍 (개체당 ${(pairs2 / Math.max(1, lives2)).toFixed(2)})`
    + ` · 못 갈 거리를 건넌 개체 ${bad2}기 (${((bad2 / Math.max(1, lives2)) * 100).toFixed(1)}%)`);

  let lives = 0;
  let bad = 0;
  let jumps = 0;
  let boarded = 0;
  const badBy = new Map();
  const worst = [];
  for (const e of d.ents) {
    if (e.bld) continue;
    lives += 1;
    const cap = e.k ? speedOfUnit(e.k) * 1.5 : CAP_UNKNOWN;  // 업그레이드 여유 1.5배
    let prev = null;
    let hit = false;
    for (const v of e.ev) {
      if (v[3] === 12) { prev = null; boarded += 1; continue; }   // 승선 — 자리가 끊긴다
      if (!REAL_SPOT.has(v[3]) || v[1] < 0) continue;
      if (prev) {
        const dt = v[0] - prev[0];
        const dd = Math.hypot(v[1] - prev[1], v[2] - prev[2]);
        if (dt >= 0 && dd > 1) {
          const need = dd / Math.max(0.5, dt);
          const bucket = need <= cap ? "정상"
            : need <= cap * 2 ? "1~2배" : need <= cap * 4 ? "2~4배" : "4배 넘음";
          speedHist.set(bucket, (speedHist.get(bucket) ?? 0) + 1);
          if (need > cap) {
            jumps += 1;
            hit = true;
            if (worst.length < 6) {
              worst.push(`태그 ${e.t} ${e.k || "무명"} — ${prev[0]}s (${prev[1]},${prev[2]})`
                + ` → ${v[0]}s (${v[1]},${v[2]}) : ${dd.toFixed(0)}타일을 ${dt}초에`
                + ` (필요 ${need.toFixed(1)} / 최대 ${cap.toFixed(1)} 타일/초)`);
            }
          }
        }
      }
      prev = v;
    }
    if (hit) { bad += 1; badBy.set(e.k || "무명", (badBy.get(e.k || "무명") ?? 0) + 1); }
  }
  allLives += lives;
  allBad += bad;
  console.log(`\n══ ${path.split("/").pop().slice(0, 44)}`);
  console.log(`  개체(건물 제외) ${lives} · 그중 **못 갈 거리를 건넌 것 ${bad}기**`
    + ` (${((bad / Math.max(1, lives)) * 100).toFixed(1)}%) · 건넌 횟수 ${jumps}회 · 승선으로 끊은 자리 ${boarded}회`);
  console.log("  ── 우리가 가진 증거(유닛만)");
  for (const [k, n] of [...evKind.entries()].sort((a, b) => b[1] - a[1])) {
    const real = REAL_SPOT.has(k) ? " ← 자리 증거" : "";
    console.log(`     f=${String(k).padStart(2)} ${String(EVNAME[k] ?? "?").padEnd(22)}`
      + ` ${String(n).padStart(6)}건 ${((n / evTot) * 100).toFixed(1).padStart(5)}%${real}`);
  }
  /* ── f=7(공격 목적지)에 대상 태그가 붙어 있나 — 붙어 있으면 그 자리에 **뭔가 있었다**.
     그리고 f=0(이동 목적지)은 시간이 충분히 지나면 '도착한 자리'가 된다. 자리 증거를
     늘릴 두 갈래가 얼마나 되는지 센다. */
  let atkTagged = 0;
  let atkGround = 0;
  let moveArrived = 0;
  let moveTotal = 0;
  for (const e of d.ents) {
    if (e.bld) continue;
    const sp = e.k ? speedOfUnit(e.k) : 4;
    let prevMove = null;
    for (const v of e.ev) {
      if (v[3] === 7) { if ((v[4] ?? 0) > 0) atkTagged += 1; else atkGround += 1; }
      if (v[3] !== 0 || v[1] < 0) continue;
      moveTotal += 1;
      /* 앞 목적지에서 이 명령까지 걸린 시간이 '거기까지 걷는 시간'보다 길면, 그 유닛은
         앞 목적지에 **도착해 있었다**. 그때 그 점은 목적지가 아니라 자리다. */
      if (prevMove) {
        const dt = v[0] - prevMove[0];
        const need = Math.hypot(v[1] - prevMove[1], v[2] - prevMove[2]) / Math.max(0.5, sp);
        if (dt >= need) moveArrived += 1;
      }
      prevMove = v;
    }
  }
  console.log(`  ── 자리 증거를 늘릴 두 갈래`);
  console.log(`     f=7 중 대상 태그가 붙은 것 ${atkTagged}건 · 땅 어택 ${atkGround}건`);
  console.log(`     f=0 중 '다음 명령까지 걸을 시간이 넉넉해 도착이 확실한 것'`
    + ` ${moveArrived} / ${moveTotal}건 (${((moveArrived / Math.max(1, moveTotal)) * 100).toFixed(1)}%)`);
  console.log("  정체별 앞 8종: "
    + [...badBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k}×${n}`).join(" "));
  for (const w of worst) console.log(`    ${w}`);
}
console.log("\n필요 속력이 최대의 몇 배였나: "
  + [...speedHist.entries()].sort().map(([k, v]) => `${k} ${v}회`).join(" · "));
console.log(`요약 — 개체 ${allLives} 중 못 갈 거리를 건넌 것 ${allBad}기`
  + ` (${((allBad / Math.max(1, allLives)) * 100).toFixed(1)}%). 이만큼이 태그 재사용을 못 가른 몫이다.`);
