/* 피격 판정의 자 — '맞았다'가 얼마나 넓게 잡히나 (지적 대응)
 *
 *   npm run hit-check <리플레이.rep…>
 *
 * 지적: "시야에만 잡혀도 피격판정? 좀 의심스러워. 아직 저글링 질럿이 멀리 있는데
 * 상대편 질럿 피가 달고, 건물들 대부분에 실드 피격효과가 난다."
 *
 * 건물 체력 원장(replayUnits의 bldHpSimOf)은 **적의 공격 클릭이 건물 중심에서 7타일
 * 안이면** 그 클릭의 DPS로 건물을 깎는다. 7타일은 화면에서 건물 서너 채 너비다 —
 * 어택무브가 기지 곁을 스쳐 지나기만 해도 그 반경 안 건물이 다 함께 맞는다.
 *
 * 이 자는 정답을 모른다(리플레이에는 '무엇이 언제 맞았나'가 없다). 대신 **반경을
 * 줄이면 무엇이 달라지나**를 그대로 드러낸다:
 *
 *  ① 맞은 건물 몫 — 반경별로, 적 공격 클릭을 한 번이라도 받은 건물의 비율.
 *     여기가 100%에 가까우면 화면에서는 "건물 대부분에 피격 효과"가 된다.
 *  ② 건물당 피격 클릭 — 중앙값. 클릭 하나가 곧 한 모금의 피해다.
 *  ③ 거리 분포 — 클릭이 실제로 건물에서 얼마나 떨어져 있나. 진짜 그 건물을 때린
 *     클릭은 발자국 위(0~2타일)에 몰려야 한다.
 *  ④ 지금 원장이 낸 결과 — 체력이 한 번이라도 깎인 건물 수(화면의 피격 효과가 이것)와
 *     끝내 무너진 수. ①과 견주면 반경이 얼마나 부풀렸는지가 보인다.
 *
 * 유닛 쪽은 다른 자다. 교전 시뮬은 '어택 클릭 뭉치'로 교전 하나를 만들고, 그 중심에서
 * 8타일 안에 있는 개체를 모두 참가시킨 뒤 **편끼리 화력을 흩는다** — 참가만 하면 서로
 * 얼마나 떨어져 있든 피해가 오간다(원 지름이 16타일이다). 그래서 ⑤ 피해가 실제로
 * 오간 두 개체의 거리와, 그중 **제 사거리 밖**이었던 몫을 잰다. 이 값은 앱이 아니라
 * 이 자가 잰다 — replayUnits.ts를 임시로 복사해 계수기 몇 줄만 끼운 판을 번들한다
 * (앱에는 계측 코드가 한 줄도 안 들어간다). */

import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("쓰기: node scripts/hit-check.mjs <리플레이.rep…>");
  process.exit(2);
}
const dir = mkdtempSync(join(tmpdir(), "hitchk-"));
/* 계측판 — 교전 피해가 오가는 그 줄에 계수기만 끼운 replayUnits 복사본을 만든다.
   원본을 못 찾으면(코드가 바뀌면) 계측 없이 그냥 돈다 — 자가 조용히 거짓말하지 않게
   찾은 자리 수를 아래에서 알린다. */
const RU = join(ROOT, "src/legacy/replayUnits.ts");
const ruSrc = readFileSync(RU, "utf8");
/* 계수기는 **실제로 피해가 흐르는 줄 바로 앞**에 끼워야 한다 — 앞선 걸러내기(갈래·
   사거리) 뒤여야 '오간 쌍'을 세는 것이 된다. */
const NEEDLE = `                const bite = dpsVs(w, e2.prof, lvOf(wUpsBy, e2.life.owner, sec), a.kind, aLv);`;
const PROBE = `
                {
                  const g9 = globalThis as unknown as { __hist?: {
                    n: number; over: number; sum: number; bins: number[] } };
                  const h9 = g9.__hist ?? { n: 0, over: 0, sum: 0, bins: new Array(9).fill(0) };
                  g9.__hist = h9;
                  const dd9 = Math.hypot(e2.x - a.x, e2.y - a.y);
                  const rr9 = w.rangeTiles + e2.prof.radius + a.prof.radius;
                  h9.n += 1;
                  h9.sum += dd9;
                  if (dd9 > rr9) h9.over += 1;
                  h9.bins[Math.min(8, Math.floor(dd9 / 2))] += 1;
                }
${NEEDLE}`;
const probed = ruSrc.includes(NEEDLE);
/* 복사본은 딴 곳에 놓이므로 상대 임포트를 절대 경로로 돌린다. */
const absImports = (t) => t.replace(/from "\.\//g, `from "${join(ROOT, "src/utils")}/`);
writeFileSync(join(dir, "replayUnits.ts"), absImports(probed ? ruSrc.replace(NEEDLE, PROBE) : ruSrc));
const src = join(dir, "e.ts");
const out = join(dir, "e.mjs");
writeFileSync(src, `export { buildUnitTracks } from ${JSON.stringify(probed ? join(dir, "replayUnits") : join(ROOT, "src/legacy/replayUnits"))};`);
execFileSync("npx", ["esbuild", src, "--bundle", "--platform=node", "--format=esm",
  "--log-level=error", `--outfile=${out}`], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
const { buildUnitTracks } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });
if (!probed) console.log("  ⚠ 교전 계측 자리를 못 찾았다 — 유닛 쪽 수치는 안 나온다.");
const { default: Screp } = await import("screp-js");

const nm = (v) => (typeof v === "string" ? v : v?.Name ?? "");
const RACE = { Terran: "테란", Protoss: "프로토스", Zerg: "저그" };
const SEC = 1 / 23.81;
const RADII = [7, 5, 4, 3, 2];
const pad = (v, n) => String(v).padStart(n);
const med = (a) => (a.length === 0 ? 0 : a.slice().sort((x, y) => x - y)[a.length >> 1]);

console.log("\n── 피격 판정의 자 ──────────────────────────────────────────────────");
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
        startX: sp ? sp.X / 32 : null, startY: sp ? sp.Y / 32 : null,
      };
    });
  globalThis.__hist = undefined;
  const d = buildUnitTracks(cmds, players);
  const hist = globalThis.__hist;
  const mins = ((res.Header.Frames ?? 0) * SEC / 60).toFixed(1);

  const teamOf = new Map(players.map((p) => [p.id, p.team]));
  const foe = (a, b) => {
    const ta = teamOf.get(a);
    const tb = teamOf.get(b);
    return ta !== undefined && tb !== undefined && ta !== null && tb !== null ? ta !== tb : a !== b;
  };
  /* 적의 공격 클릭 — 원장이 세는 것과 같은 증거(f=7)다. */
  const atk = [];
  for (const e of d.ents) {
    for (const v of e.ev) if (v[3] === 7) atk.push({ s: v[0], x: v[1], y: v[2], o: e.o });
  }
  atk.sort((a, b) => a.s - b.s);

  /* 건물 — 자리 증거를 가진 것만. 원장과 같은 중심(자리 + 1.5)을 쓴다. */
  const blds = [];
  for (const e of d.ents) {
    if (!e.bld || !e.k) continue;
    const st = [...e.ev].reverse().find((v) => v[3] === 2 || v[3] === 5 || v[3] === 17);
    if (!st) continue;
    blds.push({
      o: e.o, k: e.k, x: st[1] + 1.5, y: st[2] + 1.5,
      born: e.b, gone: e.g ?? Infinity, hp: e.hp ?? [],
    });
  }
  const hurt = blds.filter((b) => b.hp.some((q, i) => i > 0 && q[1] < b.hp[i - 1][1])).length;
  const dead = blds.filter((b) => b.hp.some((q) => q[1] <= 0)).length;

  console.log(`\n${path.split("/").pop()}  ${mins}분`);
  console.log(`  건물 ${blds.length}채 · 적 공격 클릭 후보 ${atk.length}번`);
  const bins = new Array(8).fill(0);
  const hitByR = RADII.map(() => 0);
  const cntByR = RADII.map(() => []);
  for (const b of blds) {
    const cnt = RADII.map(() => 0);
    for (const a of atk) {
      if (a.s < b.born + 2) continue;
      if (a.s > b.gone + 60) break;
      if (!foe(a.o, b.o)) continue;
      const dd = Math.hypot(a.x - b.x, a.y - b.y);
      if (dd > 7) continue;
      bins[Math.min(7, Math.floor(dd))] += 1;
      for (let i = 0; i < RADII.length; i += 1) if (dd <= RADII[i]) cnt[i] += 1;
    }
    for (let i = 0; i < RADII.length; i += 1) {
      if (cnt[i] > 0) hitByR[i] += 1;
      cntByR[i].push(cnt[i]);
    }
  }
  for (let i = 0; i < RADII.length; i += 1) {
    const pct = blds.length ? Math.round((hitByR[i] / blds.length) * 100) : 0;
    console.log(`  반경 ${pad(RADII[i], 2)}타일${i === 0 ? "(지금)" : "      "}  맞은 건물 ${pad(hitByR[i], 4)}채 (${pad(pct, 3)}%)`
      + `  건물당 클릭 중앙값 ${pad(med(cntByR[i]), 3)}번`);
  }
  console.log(`  클릭 거리 분포(타일): ${bins.map((n, i) => `${i}~${i + 1} ${n}`).join(" · ")}`);
  console.log(`  지금 원장이 낸 것: 체력이 깎인 건물 ${hurt}채 (${blds.length ? Math.round((hurt / blds.length) * 100) : 0}%) · 0에 닿은 건물 ${dead}채`);
  if (hist && hist.n > 0) {
    const units = d.ents.filter((e) => !e.bld);
    const died = units.filter((e) => e.d !== null && e.d !== undefined && e.dk !== "morph" && e.dk !== "cxl").length;
    console.log(`  ── 유닛 교전 ──`);
    console.log(`  피해가 오간 쌍 ${hist.n}건 · 평균 거리 ${(hist.sum / hist.n).toFixed(1)}타일`
      + `  사거리 밖이었던 몫 ${Math.round((hist.over / hist.n) * 100)}%`);
    console.log(`  쌍 거리 분포(타일): ${hist.bins.map((n, i) => `${i * 2}~${i * 2 + 2} ${n}`).join(" · ")}`);
    console.log(`  유닛 ${units.length}기 중 죽은 것 ${died}기 (${Math.round((died / Math.max(1, units.length)) * 100)}%)`);
  }
}
console.log("");
