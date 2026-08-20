/* 건물 성적표 — 세운 건물이 남아 있나, 부서질 것이 부서지나 (지적 대응)
 *
 *   npm run bld-check <리플레이.rep…>
 *
 * 지적: "3시 포지 지었는데 안 나오고, 5시 해처리·성큰 부서진 게 안 나오고, 3시 포톤
 * 부서진 게 안 나온다. 지어진 건물은 안 부서지는 듯."
 *
 * 건물에는 정답표가 없다 — 리플레이에는 '무엇이 언제 무너졌나'가 안 들어 있다. 그래서
 * 커맨드가 말해 주는 것과 분석이 낸 것을 견주고, 뒤집기(무르기·격퇴)가 얼마나 세게
 * 도는지를 드러낸다. 뒤집기는 둘 다 '어림'이라 여기가 부풀면 화면이 거짓말을 한다.
 *
 *  ① 세운 것 — Build/Hatch 커맨드 수 대비 분석이 낸 건물 수. 빠지면 화면에서 사라진다.
 *  ② 무르기 — '안 지어진 것'으로 지운 수. 진짜 무르기는 같은 일꾼의 재건설이 증거다.
 *  ③ 부서짐 — 발치 공격을 받은 건물 중 무너졌다고 본 몫. 나머지는 '격퇴'로 살아난다.
 *  ④ 끝에 남은 것 — 마지막 순간 임자별 생존 건물. 진 쪽이 멀쩡하면 ③이 약한 것이다.
 *  ⑤ 근거 한클릭뿐 — 발치 공격 클릭 한 번으로 무너뜨린 건물. 여기가 부풀면 어택무브가
 *     스쳐 지난 자리를 철거로 읽고 있는 것이다(반대쪽 실패, 과잉 파괴). */

import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("쓰기: node scripts/bld-check.mjs <리플레이.rep…>");
  process.exit(2);
}
const dir = mkdtempSync(join(tmpdir(), "bldchk-"));
const src = join(dir, "e.ts");
const out = join(dir, "e.mjs");
writeFileSync(src, `export { buildUnitTracks } from ${JSON.stringify(join(ROOT, "src/legacy/replayUnits"))};`);
execFileSync("npx", ["esbuild", src, "--bundle", "--platform=node", "--format=esm",
  "--log-level=error", `--outfile=${out}`], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
const { buildUnitTracks } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });
const { default: Screp } = await import("screp-js");

const nm = (v) => (typeof v === "string" ? v : v?.Name ?? "");
const RACE = { Terran: "테란", Protoss: "프로토스", Zerg: "저그" };
const SEC = 1 / 23.81;

console.log("\n── 건물 성적표 ────────────────────────────────────────────────────");
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
  const d = buildUnitTracks(cmds, players);
  const endSec = (res.Header.Frames ?? 0) * SEC;

  /* 커맨드가 낸 건설 — 자리를 가진 Build/Hatch만 센다(착륙은 건설이 아니다). */
  const ordered = new Map();
  for (const c of cmds) {
    const t = nm(c.Type);
    if (t !== "Build" && t !== "Hatch") continue;
    if ((c.Order && typeof c.Order === "object" ? c.Order.Name : c.Order) === "BuildingLand") continue;
    if (!c.Pos) continue;
    ordered.set(c.PlayerID, (ordered.get(c.PlayerID) ?? 0) + 1);
  }
  /* 저그 건물은 드론 변태라 태그 줄과 물리 줄이 같은 자리에 겹친다 — 자리로 하나로 센다. */
  const key = (e) => {
    const s = e.ev.find((v) => v[3] === 2 || v[3] === 5);
    return s ? `${e.o}|${e.k}|${Math.round(s[1])},${Math.round(s[2])}` : null;
  };
  const site = new Map();
  for (const e of d.ents) {
    if (!e.bld || !e.k) continue;
    const k = key(e);
    if (!k) continue;
    /* 무너뜨린 근거가 얼마나 두꺼운가 — 발치 공격(f=1) 클릭 수. 한 번뿐인 것으로 부순
       건물이 많으면 어택무브가 스쳐 지난 것을 철거로 읽고 있을 수 있다(과잉 파괴의 자). */
    const hits = e.ev.reduce((n, v) => n + (v[3] === 1 ? 1 : 0), 0);
    const cur = site.get(k);
    if (!cur) site.set(k, { o: e.o, k: e.k, b: e.b, d: e.d, dk: e.dk, hits });
    else {
      if (cur.d === null && e.d !== null) { cur.d = e.d; cur.dk = e.dk; }
      if (hits > cur.hits) cur.hits = hits;
    }
  }
  console.log(`\n${path.split("/").pop()}  ${(endSec / 60).toFixed(1)}분`);
  let tOrd = 0;
  let tStood = 0;
  let tDead = 0;
  let tZom = 0;
  for (const p of players) {
    const mine = [...site.values()].filter((s) => s.o === p.id);
    const ord = ordered.get(p.id) ?? 0;
    // 시작 홀은 커맨드가 없다 — 셈에서 뺀다.
    const stood = mine.length - 1;
    const dead = mine.filter((s) => s.d !== null && s.dk !== "morph" && s.dk !== "cxl").length;
    const aliveEnd = mine.filter((s) => s.d === null || s.d > endSec - 5).length;
    const thin = mine.filter((s) => s.d !== null && s.dk === "atk" && s.hits <= 1).length;
    tOrd += ord; tStood += stood; tDead += dead; tZom += thin;
    console.log(`  임자 ${p.id} ${String(p.name).padEnd(14)} ${p.race.padEnd(5)}`
      + ` 커맨드 ${String(ord).padStart(3)}채 → 선 것 ${String(stood).padStart(3)}채`
      + ` (${ord > 0 ? ((stood / ord) * 100).toFixed(0).padStart(3) : " —"}%)`
      + `  부서짐 ${String(dead).padStart(3)}채  끝에 남음 ${String(aliveEnd).padStart(3)}채`
      + `  근거 한클릭뿐 ${String(thin).padStart(2)}채`);
  }
  console.log(`  합계  커맨드 ${tOrd}채 → 선 것 ${tStood}채 (${((tStood / Math.max(1, tOrd)) * 100).toFixed(0)}%)`
    + `  부서짐 ${tDead}채  그중 근거 한클릭뿐 ${tZom}채`);
}
