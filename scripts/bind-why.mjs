/* 원장이 왜 짝을 못 찾는지 사유별로 재는 자 (물음: "합성 개체 수와 나머지 수치도
 * 좋아지려면 뭘 더 고쳐야 하나")
 *
 *   node scripts/bind-why.mjs <리플레이.rep…>
 *
 * 결합률이 안 오르면 남는 만큼이 합성 개체가 되고, 합성 개체는 증거 없이 서 있다가
 * 인구 상한에 물려 사라진다. 그러니 "어디서 막히나"를 알아야 다음에 손댈 자리가
 * 정해진다. 짝을 못 찾은 원장마다 **모든 후보 생애를 훑어 탈락 사유를 세고**, 가장
 * 아까운 사유가 무엇인지 본다.
 *
 * ★ 먼저 볼 것은 사유가 아니라 **천장**이다: 생애 후보 수 ÷ 원장 수. 리플레이에 한 번도
 * 안 골라진 유닛은 태그 자취를 하나도 안 남기므로 짝지을 대상이 아예 없다 — 그런 몫은
 * 합성으로 세우는 것이 옳고, 아무리 좋은 짝짓기도 그 천장을 못 넘는다.
 *   실측 — 90300: 생애 1080 / 원장 1367 = 천장 79.0% (지금 69.1%)
 *          30800: 생애  552 / 원장  704 = 천장 78.4% (지금 70.0%)
 *          경기1: 생애 1538 / 원장 1813 = 천장 84.8% (지금 72.1%)
 *
 * 천장까지 남은 몫은 '끝까지 짝 없이 남은 자유 생애' 수와 같다. 그 생애들이 왜 안 쓰였나를
 * 루프 안 계수기로 센다 — 창 앞끝·뒤끝·정체·행동 넷이다. 뒤늦게 다시 따지면 kinds와 born이
 * 이미 바뀌어 있어 사유가 틀리게 나오므로(실측으로 밟은 함정), 탈락하는 그 자리에서 센다.
 *
 * 계측은 원본을 안 건드린다 — 사본을 떠서 진단 블록만 끼운다.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (files.length === 0) {
  console.error("쓰기: node scripts/bind-why.mjs <리플레이.rep…>");
  process.exit(2);
}

/** 진짜 루프 안에 계수기를 심는다 — 뒤늦게 다시 따지면 kinds·born이 이미 바뀌어 있어
 *  사유가 틀리게 나온다(실측으로 그 함정을 밟았다). 탈락하는 그 자리에서 센다. */
const PATCHES = [
  [
    "        for (const life of candLives) {\n          if (life.spawned || life.owner !== r.it.pid) continue;",
    "        for (const life of candLives) {\n"
    + "          if (life.owner !== r.it.pid) continue;\n"
    + "          if (life.spawned) { __W.taken += 1; continue; }\n"
    + "          __W.saw += 1;",
  ],
  [
    "          if (life.born < front || life.born - r.it.done > 300) continue;",
    /* 조건들을 **따로따로** 재 둔다 — 순서대로 걸러 내면 맨 앞 조건이 탈락을 다 먹어,
       뒤 조건이 진짜 병목인지 아닌지가 안 보인다(실측: 앞끝이 86,400회를 먹었는데
       정작 창을 무한히 열어도 결합률이 한 자리도 안 움직였다). 네 조건 중 **딱 하나만
       걸리는 쌍**이 곧 "그 하나만 고치면 붙는" 몫이다. */
    "          {\n"
    + "            const _mk = (() => { let b = '', n = 0; for (const [k, c] of life.kinds) if (c > n) { b = k; n = c; } return b; })();\n"
    + "            const _isW = r.it.unit === (RACE_WORKER[raceOf.get(r.it.pid) ?? ''] ?? '');\n"
    + "            const _atk = life.ev.some((v) => v[3] === 7);\n"
    + "            const _bld = life.ev.some((v) => v[3] === 2);\n"
    + "            const bad = [\n"
    + "              life.born < front,\n"
    + "              life.born - r.it.done > 300,\n"
    + "              pass === 0 ? _mk !== r.it.unit : _mk !== '',\n"
    + "              pass === 1 && ((_isW && _atk) || (!_isW && _bld)),\n"
    + "            ];\n"
    + "            const nBad = bad.filter(Boolean).length;\n"
    + "            if (nBad === 1) __W.only[bad.findIndex(Boolean)] += 1;\n"
    + "          }\n"
    + "          if (life.born < front) { __W.front += 1; continue; }\n"
    + "          if (life.born - r.it.done > 300) { __W.back += 1; continue; }",
  ],
  [
    "          if (pass === 0 ? mk !== r.it.unit : mk !== \"\") continue;",
    "          if (pass === 0 ? mk !== r.it.unit : mk !== \"\") {\n"
    + "            if (pass === 0) __W.kind0 += 1; else __W.kind1 += 1;\n"
    + "            continue;\n"
    + "          }",
  ],
  [
    "            if (isWorkerItem && attacked) continue;\n            if (!isWorkerItem && builtSomething) continue;",
    "            if (isWorkerItem && attacked) { __W.act += 1; continue; }\n"
    + "            if (!isWorkerItem && builtSomething) { __W.act += 1; continue; }",
  ],
  [
    "          if (pass === 1) life.kinds.set(r.it.unit, 1);\n          attach(life, r);",
    "          if (pass === 1) life.kinds.set(r.it.unit, 1);\n"
    + "          __W.bind[pass] += 1;\n"
    + "          attach(life, r);",
  ],
  [
    "    // ③ 잔여는 합성 개체 — 한 번도 안 집힌 유닛도 태어나 랠리까지는 산다(요청).",
    "    {\n"
    + "      const lostBy = new Map();\n"
    + "      let noCand = 0;\n"
    + "      for (const r of items) {\n"
    + "        if (r.it.bound) continue;\n"
    + "        lostBy.set(r.it.unit, (lostBy.get(r.it.unit) ?? 0) + 1);\n"
    + "        if (!candLives.some((l) => l.owner === r.it.pid && !l.spawned)) noCand += 1;\n"
    + "      }\n"
    + "      __W.noCand = noCand;\n"
    + "      __W.freeLives = candLives.filter((l) => !l.spawned).length;\n"
    /* 자유 생애의 임자에게 **아직 안 붙은 원장이 남아 있나** — 남아 있는데도 자유라면
       조건이 막은 것이고, 안 남아 있다면 애초에 붙을 데가 없던 것이다(그 임자의 원장이
       먼저 동났다). 둘은 고칠 자리가 아예 다르다. */
    + "      const openBy = new Map();\n"
    + "      for (const r of items) if (!r.it.bound) openBy.set(r.it.pid, (openBy.get(r.it.pid) ?? 0) + 1);\n"
    + "      let freeWithItem = 0; let freeNoItem = 0;\n"
    + "      for (const l of candLives) {\n"
    + "        if (l.spawned) continue;\n"
    + "        if ((openBy.get(l.owner) ?? 0) > 0) freeWithItem += 1; else freeNoItem += 1;\n"
    + "      }\n"
    + "      __W.freeWithItem = freeWithItem;\n"
    /* 마지막 결정타 — **이름 없는** 자유 생애 하나하나에 대해, 임자의 안 붙은 원장을
       전부 훑어 어느 조건이 막았는지 센다. 여기서 0이 아닌 칸이 곧 다음에 손댈 자리다. */
    + "      const blk = { front: 0, back: 0, act: 0, none: 0, lives: 0 };\n"
    + "      for (const l of candLives) {\n"
    + "        if (l.spawned || l.kinds.size > 0) continue;\n"
    + "        blk.lives += 1;\n"
    + "        const c = { front: 0, back: 0, act: 0, ok: 0 };\n"
    + "        for (const r of items) {\n"
    + "          if (r.it.bound || r.it.pid !== l.owner) continue;\n"
    + "          if (l.born < r.it.done - 8) { c.front += 1; continue; }\n"
    + "          if (l.born - r.it.done > 300) { c.back += 1; continue; }\n"
    + "          const isW = r.it.unit === (RACE_WORKER[raceOf.get(r.it.pid) ?? ''] ?? '');\n"
    + "          const atk = l.ev.some((v) => v[3] === 7);\n"
    + "          const bl = l.ev.some((v) => v[3] === 2);\n"
    + "          if ((isW && atk) || (!isW && bl)) { c.act += 1; continue; }\n"
    + "          c.ok += 1;\n"
    + "        }\n"
    + "        if (c.ok > 0) blk.none += 1;\n"
    + "        else if (c.front >= c.back && c.front >= c.act) blk.front += 1;\n"
    + "        else if (c.back >= c.act) blk.back += 1;\n"
    + "        else blk.act += 1;\n"
    + "      }\n"
    + "      __W.blk = blk;\n"
    + "      __W.freeNoItem = freeNoItem;\n"
    /* 남은 자유 생애가 **무슨 이름**인지 — 여기가 다음에 손댈 자리를 정한다.
       이름이 없으면(무명) 2차가 아무 원장에나 붙일 수 있었는데도 안 붙은 것이고,
       이름이 있으면 그 이름의 원장이 동나서 못 붙은 것이다. 둘은 고칠 방법이 다르다. */
    + "      const freeMix = new Map();\n"
    + "      for (const l of candLives) {\n"
    + "        if (l.spawned) continue;\n"
    + "        let mk9 = ''; let bn9 = 0;\n"
    + "        for (const [k9, n9] of l.kinds) if (n9 > bn9) { mk9 = k9; bn9 = n9; }\n"
    + "        const g9 = [...l.groupKinds][0] ?? '';\n"
    + "        const key9 = mk9 || (g9 ? `(무리 ${g9})` : (l.bld ? '(건물)' : '(무명)'));\n"
    + "        freeMix.set(key9, (freeMix.get(key9) ?? 0) + 1);\n"
    + "      }\n"
    + "      __W.freeMix = [...freeMix.entries()].sort((a, b) => b[1] - a[1]);\n"
    + "      __W.candLives = candLives.length;\n"
    + "      globalThis.__BIND_WHY = { why: __W, lostBy: [...lostBy.entries()].sort((a, b) => b[1] - a[1]) };\n"
    + "    }\n"
    + "    // ③ 잔여는 합성 개체 — 한 번도 안 집힌 유닛도 태어나 랠리까지는 산다(요청).",
  ],
];
const HEAD = "const __W = { bind: [0, 0], only: [0, 0, 0, 0], taken: 0, saw: 0, front: 0, back: 0, kind0: 0, kind1: 0, act: 0 };\n";

async function bundleProbe() {
  const src = readFileSync(join(ROOT, "src/utils/replayUnits.ts"), "utf8");
  let text = src;
  for (const [a, b] of PATCHES) {
    if (!text.includes(a)) throw new Error(`계수기 자리를 못 찾았다: ${a.slice(0, 50)}`);
    text = text.replace(a, b);
  }
  text = HEAD + text.replaceAll('from "./', `from "${join(ROOT, "src/utils")}/`);
  const dir = mkdtempSync(join(tmpdir(), "bindwhy-"));
  const ts = join(dir, "probe.ts");
  const out = join(dir, "probe.mjs");
  writeFileSync(ts, text);
  const ebin = join(ROOT, "node_modules", "esbuild", "bin", "esbuild");
  const head = readFileSync(ebin).subarray(0, 4);
  /* 실행 파일인가 — 아니면 esbuild 껍데기 스크립트라 node로 돌려야 한다.
     ★ 맥(Mach-O)을 빠뜨리고 있었다(수리: 이 자가 아예 안 돌았다) — ELF·PE만 보다가
     맥의 실행 파일을 스크립트로 알고 node에 먹여 SyntaxError가 났다. Mach-O는
     cf fa ed fe(64비트 LE) · fe ed fa cf(BE) · ca fe ba be(유니버설)로 시작한다. */
  const mg = (a, b, c, d) => head[0] === a && head[1] === b && head[2] === c && head[3] === d;
  const native = mg(0x7f, 0x45, 0x4c, 0x46)          // ELF (리눅스)
    || (head[0] === 0x4d && head[1] === 0x5a)        // PE  (윈도)
    || mg(0xcf, 0xfa, 0xed, 0xfe) || mg(0xce, 0xfa, 0xed, 0xfe)
    || mg(0xfe, 0xed, 0xfa, 0xcf) || mg(0xfe, 0xed, 0xfa, 0xce)
    || mg(0xca, 0xfe, 0xba, 0xbe);                   // Mach-O (맥)
  const a = [ts, "--bundle", "--platform=node", "--format=esm", "--log-level=error", `--outfile=${out}`];
  execFileSync(native ? ebin : process.execPath, native ? a : [ebin, ...a],
    { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  const mod = await import(pathToFileURL(out).href);
  rmSync(dir, { recursive: true, force: true });
  return mod;
}

const { buildUnitTracks } = await bundleProbe();
const { default: Screp } = await import("screp-js");
const nm = (v) => (typeof v === "string" ? v : v?.Name ?? "");
const RACE = { Terran: "테란", Protoss: "프로토스", Zerg: "저그" };

const LABEL = {
  taken: "이미 다른 원장이 집어 간 생애를 다시 본 횟수",
  saw: "짝을 따져 본 (원장, 자유 생애) 쌍",
  front: "└ 창 앞끝에서 탈락 (born < 완성−8초)",
  back: "└ 창 뒤끝에서 탈락 (born − 완성 > 300초)",
  kind0: "└ 1차(같은 이름만)에서 정체 어긋남",
  kind1: "└ 2차(무명만)에서 이미 이름이 있음",
  act: "└ 행동 어긋남 (공격한 일꾼·건물 지은 비일꾼)",
};

console.log("\n── 원장이 짝을 못 찾은 사유 ────────────────────────────────────────");
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
  const st = d.stats ?? {};
  const { why, lostBy } = globalThis.__BIND_WHY ?? { why: {}, lostBy: [] };
  const unbound = (st.prod ?? 0) - (st.prodBound ?? 0);
  console.log(`\n${path.split("/").pop().slice(0, 46)}`);
  console.log(`  원장 ${st.prod} · 짝지음 ${st.prodBound} (${(((st.prodBound ?? 0) / (st.prod || 1)) * 100).toFixed(1)}%)`
    + ` · 못 지음 ${unbound} · 합성 개체 ${st.prodSyn}`);
  console.log(`  생애 후보 ${why.candLives} · 끝까지 짝 없이 남은 자유 생애 ${why.freeLives}`
    + ` · 자유 생애가 아예 없던 원장 ${why.noCand}건`);
  if (why.bind) console.log(`  ▷ 붙인 곳: 1차(같은 이름) ${why.bind[0]}건 · 2차(무명) ${why.bind[1]}건`);
  if (why.freeWithItem !== undefined) {
    console.log(`  ▷ 자유 생애 ${why.freeLives}기 중 임자에게 안 붙은 원장이 **남아 있는데도** 자유인 것`
      + ` ${why.freeWithItem}기 · 붙을 원장이 아예 없던 것 ${why.freeNoItem}기`);
  }
  if (why.blk) {
    const b = why.blk;
    console.log(`  ▷ 이름 없는 자유 생애 ${b.lives}기를 막은 것: 창 앞끝 ${b.front} · 창 뒤끝 ${b.back}`
      + ` · 행동 ${b.act} · **아무것도 안 막았는데 자유** ${b.none}`);
  }
  if (why.only) {
    const L = ["창 앞끝", "창 뒤끝", "정체", "행동"];
    console.log(`  ▷ 넷 중 **딱 하나만** 걸린 쌍(그것만 고치면 붙는다): `
      + why.only.map((n, i) => `${L[i]} ${n}`).join(" · "));
  }
  if (why.freeMix) {
    console.log(`  남은 자유 생애의 이름 앞 10종: `
      + why.freeMix.slice(0, 10).map(([k, n]) => `${k}×${n}`).join(" "));
  }
  for (const k of ["taken", "saw", "front", "back", "kind0", "kind1", "act"]) {
    const v = why[k] ?? 0;
    console.log(`    ${String(v).padStart(7)}회  ${LABEL[k]}`);
  }
  console.log("  못 지은 원장이 많은 정체 앞 8종: "
    + lostBy.slice(0, 8).map(([k, n]) => `${k}×${n}`).join(" "));

  /* ── 원장이 맞나 — 뽑은 수와 붙은 수를 정체별로 견준다. 짝짓기를 아무리 잘해도
     원장 자체가 부풀어 있으면 그만큼이 합성 개체가 된다. 부호가 답을 나눈다:
       원장 > 개체 : 원장이 부풀었다(또는 그 유닛이 한 번도 안 골라졌다)
       원장 < 개체 : 이름을 과하게 붙였다(순전한 오류에 가깝다) */
  const RACE_W = { 테란: "SCV", 프로토스: "Probe", 저그: "Drone" };
  const TWINS2 = new Set(["Zergling", "Scourge"]);
  const FROM2 = {
    Lurker: "Hydralisk", Guardian: "Mutalisk", Devourer: "Mutalisk",
    "Lurker Egg": "Hydralisk", Archon: "High Templar", "Dark Archon": "Dark Templar",
  };
  const canon2 = (u) => (u === "Siege Tank" ? "Siege Tank (Tank Mode)" : u);
  const sel2 = new Map();
  const P2 = new Map();
  const addP = (pid, u, n) => {
    const m = P2.get(pid) ?? new Map();
    m.set(canon2(u), (m.get(canon2(u)) ?? 0) + n);
    P2.set(pid, m);
  };
  for (const c of cmds) {
    const tt = nm(c.Type);
    const pid = c.PlayerID;
    if (tt === "Select") { sel2.set(pid, [...(c.UnitTags ?? [])]); continue; }
    if (tt === "Select Add") { sel2.set(pid, [...(sel2.get(pid) ?? []), ...(c.UnitTags ?? [])]); continue; }
    if (tt === "Select Remove") {
      const rm = new Set(c.UnitTags ?? []);
      sel2.set(pid, (sel2.get(pid) ?? []).filter((x) => !rm.has(x)));
      continue;
    }
    const u = nm(c.Unit);
    if (!u && tt !== "Merge Archon" && tt !== "Merge Dark Archon") continue;
    const ik = c.IneffKind;
    const ikv = typeof ik === "number" ? ik : String(ik ?? "");
    if (ik !== undefined && ik !== null && ikv !== 0 && ikv !== "0" && ikv !== "" && ikv !== "Effective") continue;
    if (tt === "Train") { addP(pid, u, TWINS2.has(u) ? 2 : 1); continue; }
    if (tt === "Merge Archon" || tt === "Merge Dark Archon") {
      const made = tt === "Merge Archon" ? "Archon" : "Dark Archon";
      const from = tt === "Merge Archon" ? "High Templar" : "Dark Templar";
      const n = Math.max(2, (sel2.get(pid) ?? []).length);
      addP(pid, made, Math.floor(n / 2));
      addP(pid, from, -Math.floor(n / 2) * 2);
      continue;
    }
    if (tt === "Unit Morph") {
      const n = Math.max(1, (sel2.get(pid) ?? []).length);
      addP(pid, u, TWINS2.has(u) ? n * 2 : n);
      if (FROM2[u]) addP(pid, FROM2[u], -n);
      continue;
    }
  }
  for (const p of players) {
    const w = RACE_W[p.race];
    if (w) addP(p.id, w, 4);
    if (p.race === "저그") addP(p.id, "Overlord", 1);
  }
  const N2 = new Map();
  for (const e of d.ents) {
    if (e.bld || !e.k) continue;
    const m = N2.get(e.o) ?? new Map();
    m.set(e.k, (m.get(e.k) ?? 0) + 1);
    N2.set(e.o, m);
  }
  const gap = new Map();
  for (const p of players) {
    const P = P2.get(p.id) ?? new Map();
    const N = N2.get(p.id) ?? new Map();
    /* ★ 어긋난 사람만 더하면 총량이 아니다(이 자의 결함이었다 — 마린 '뽑음 192'가
       실은 어긋난 사람들의 합이고, 진짜 Train은 229건이었다). 총합을 그대로 더하고
       어긋난 몫은 따로 센다. */
    for (const k of new Set([...P.keys(), ...N.keys()])) {
      const a = Math.max(0, P.get(k) ?? 0);
      const b = N.get(k) ?? 0;
      const g = gap.get(k) ?? { prod: 0, ent: 0, off: 0 };
      g.prod += a; g.ent += b; g.off += Math.abs(a - b);
      gap.set(k, g);
    }
  }
  const rows = [...gap.entries()].map(([k, g]) => [k, g.prod, g.ent, g.ent - g.prod, g.off])
    .sort((x, y) => y[4] - x[4]);
  /* ── 합성 개체의 삶 — 인구 상한이 물린 것(dk="cap")이 태어나 얼마 만에 물렸나.
     곧바로 물린다면 그 원장은 애초에 유닛이 안 된 것이다(인구 막힘·취소를 우리가 못
     걸렀다는 뜻). 한참 살다 물린다면 원장은 옳고 죽음을 못 본 것뿐이다. */
  const syn = d.ents.filter((e) => !e.bld && e.t <= -1000 && e.t > -20000);
  const capped = syn.filter((e) => e.dk === "cap" && e.d !== null && e.d !== undefined);
  const lifeSpan = capped.map((e) => e.d - e.b).sort((a, b) => a - b);
  const q = (f) => (lifeSpan.length ? lifeSpan[Math.min(lifeSpan.length - 1, Math.floor(lifeSpan.length * f))] : 0);
  const short = lifeSpan.filter((v) => v <= 30).length;
  console.log(`  합성 개체 ${syn.length}기 · 그중 인구가 물린 것 ${capped.length}기`
    + ` · 산 시간 중앙 ${q(0.5)}초 (1사분 ${q(0.25)} · 3사분 ${q(0.75)})`
    + ` · 30초 안에 물린 것 ${short}기`);
  const capBy = new Map();
  for (const e of capped) capBy.set(e.k, (capBy.get(e.k) ?? 0) + 1);
  console.log("    인구가 물린 정체 앞 8종: "
    + [...capBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k}×${n}`).join(" "));

  console.log("  ── 뽑은 수 vs 붙은 수 (사람별 어긋남이 큰 정체 앞 10종)");
  for (const [k, a, b, dd, off] of rows.slice(0, 10)) {
    console.log(`     ${String(k).padEnd(24)} 뽑음 ${String(a).padStart(5)} · 개체 ${String(b).padStart(5)}`
      + ` · 총차 ${dd > 0 ? "+" : ""}${String(dd).padStart(4)} · 사람별 어긋남 합 ${String(off).padStart(4)}`);
  }
}
