/* 피해 공식 검산 (과제 #54)
 *
 *   npm run dmg-check
 *
 * 표(bwUnits)와 공식(dealOneHit)이 원작과 맞는지 아는 유일한 방법은 **아는 답과 견주는
 * 것**이다. 공식을 고칠 때마다 이걸 돌려, 알려진 교전 결과가 그대로인지 본다.
 *
 * 공식 자체는 bwgame.h weapon_deal_damage의 문장 순서를 그대로 옮긴 것이다 —
 * 매트릭스 → 실드(방어력·크기배수 면제) → 유닛 방어력 → 크기 배수 → 하한. 순서가
 * 뒤바뀌면 아래 숫자들이 어긋나므로, 이 표가 그 순서의 회귀 시험이다.
 *
 * 확인된 값(원작):
 *   마린 → 저글링   6피해 · 6방      드라군 → 저글링  10피해(폭발 20의 절반)
 *   질럿 → 저글링  16피해 · 3방      시즈(시즈모드) → 마린  35피해 · 2방
 *   벌처 → 저글링  20피해 · 2방      아콘 → 마린  30피해 · 2방
 *   마린 → 질럿     5피해(방어 1) · 30방(실드 60을 6씩 열 번 + 체력 100을 5씩)
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "dmgchk-"));
const src = join(dir, "e.ts");
const out = join(dir, "e.mjs");
writeFileSync(src, `export { profileOf, targetFor, attackOf } from ${JSON.stringify(join(ROOT, "src/utils/bwCombat"))};`);
execFileSync("npx", ["esbuild", src, "--bundle", "--format=esm", "--log-level=error", `--outfile=${out}`],
  { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
const { profileOf, targetFor, attackOf } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

/** [공격자, 표적, 기대 한방피해?, 기대 방수?] — 기대값을 적은 줄만 합/불을 가린다. */
const CASES = [
  ["Marine", "Zergling", 6, 6], ["Marine", "Marine", 6, 7], ["Marine", "Zealot", 5, 30],
  ["Marine", "Ultralisk", 5], ["Zealot", "Zergling", 16, 3], ["Zealot", "Marine", 16, 3],
  ["Zealot", "Dragoon", 14], ["Zergling", "Marine", 5, 8], ["Zergling", "Zealot", 4],
  ["Dragoon", "Zergling", 10, 4], ["Dragoon", "Marine", 10, 4], ["Dragoon", "Dragoon", 19],
  ["Siege Tank (Siege Mode)", "Marine", 35, 2], ["Siege Tank (Tank Mode)", "Marine", 15, 3],
  ["Hydralisk", "Marine", 5, 8], ["Hydralisk", "Zealot", 5],
  ["Vulture", "Zergling", 20, 2], ["Vulture", "Marine", 20, 2],
  ["Firebat", "Zergling", 16, 3], ["Mutalisk", "Marine", 9, 5],
  ["Archon", "Zergling", 30, 2], ["Archon", "Marine", 30, 2],
  ["Ultralisk", "Marine", 20, 2], ["Lurker", "Marine", 20, 2],
  ["Dark Templar", "Zealot", 39],
];

let bad = 0;
const run = (a, tgt, ups) => {
  const atk = profileOf(a, ups);
  const w = atk.ground ?? atk.air;
  if (!w) return null;
  const probe = targetFor(tgt, undefined, { hp: 1 << 30, shield: 0, hasShield: false });
  const one = attackOf(w, atk, probe).hp / 256;
  const t = targetFor(tgt);
  const maxHp = t.hp / 256;
  const maxSh = t.shield / 256;
  let n = 0;
  while (t.hp > 0 && n < 9999) { attackOf(w, atk, t); n += 1; }
  return { one, n, maxHp, maxSh, w, armor: probe.armor, size: probe.size };
};

console.log("\n── 피해 공식 검산 (업글 0) ────────────────────────────────────────");
console.log("공격자                   표적          한방   방수   무기                 표적 스탯");
for (const [a, tgt, wantOne, wantN] of CASES) {
  const r = run(a, tgt);
  if (!r) { console.log(`${a}: 무기 없음`); bad += 1; continue; }
  const okOne = wantOne === undefined || Math.round(r.one) === wantOne;
  const okN = wantN === undefined || r.n === wantN;
  if (!okOne || !okN) bad += 1;
  console.log(`${a.padEnd(24)} ${tgt.padEnd(12)} ${String(Math.round(r.one)).padStart(4)}`
    + `${okOne ? " " : "✗"} ${String(r.n).padStart(4)}${okN ? " " : "✗"}`
    + `  ${`${r.w.hits}×${r.w.dmg} ${r.w.type}`.padEnd(20)}`
    + ` 체력 ${r.maxHp}${r.maxSh ? `+실드 ${r.maxSh}` : ""} 방어 ${r.armor} ${r.size}`);
}

console.log("\n── 업그레이드 ─────────────────────────────────────────────────");
const UP = [
  ["Marine", "Zergling", ["Terran Infantry Weapons", "Terran Infantry Weapons", "Terran Infantry Weapons"], 9, 4],
  ["Zealot", "Zergling", ["Protoss Ground Weapons", "Protoss Ground Weapons", "Protoss Ground Weapons"], 22, 2],
  ["Dragoon", "Marine", ["Protoss Ground Weapons"], 11, 4],
];
for (const [a, tgt, ups, wantOne, wantN] of UP) {
  const r = run(a, tgt, ups);
  const okOne = Math.round(r.one) === wantOne;
  const okN = r.n === wantN;
  if (!okOne || !okN) bad += 1;
  console.log(`${a.padEnd(24)} ${tgt.padEnd(12)} ${String(Math.round(r.one)).padStart(4)}`
    + `${okOne ? " " : "✗"} ${String(r.n).padStart(4)}${okN ? " " : "✗"}  (${ups.length}업)`);
}

console.log(bad === 0 ? "\n모두 통과.\n" : `\n★ 어긋난 줄 ${bad}개 — 위의 ✗를 보라.\n`);
process.exit(bad === 0 ? 0 : 1);
