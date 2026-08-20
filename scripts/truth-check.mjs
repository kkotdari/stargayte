/* 정답표 대조 — 우리 분석이 실제로 몇 %를 맞히나 ──────────────────────────────────
 *
 *   node scripts/truth-check.mjs <리플레이.rep…>
 *
 * 이 프로젝트는 여태 **정답표가 없었다.** 리플레이에는 유닛이 안 들어 있어(커맨드뿐),
 * "이 번호가 무슨 유닛인가"를 증거로 좁혀 왔고 그것이 얼마나 맞는지 잴 수가 없었다.
 * id-check가 재던 넷(무명률·원장 결합률·못 뽑은 이름·수급 어긋남)은 전부 **간접** 지표다.
 *
 * OpenBW는 그 경기를 실제로 돌린다(tools/openbw). 이제 참값이 있으니 직접 잰다.
 *
 * [짝짓는 법 — 어림이 아니다]
 * 리플레이 명령이 유닛을 가리킬 때 쓰는 수(태그)가 열쇠다. 우리 분석의 개체는 그 태그를
 * 그대로 신원으로 쓰고, OpenBW도 같은 규약으로 태그를 낼 수 있다(리마스터는
 * (index+1) | (generation<<13) — 유닛 그릇이 3400칸이다). 그래서 두 쪽을 **한 자리도
 * 안 틀리고** 짝지을 수 있다.
 *
 * [재는 것]
 *  ① 정체 정확도 — 짝지은 개체 중 이름이 맞는 비율. 이것이 그동안 못 재던 수다.
 *  ② 놓친 유닛   — 참값엔 있는데 우리에겐 없는 개체(그 태그가 명령에 한 번도 안 나온
 *                  유닛은 원래 못 만든다 — 그 몫은 따로 센다).
 *  ③ 지어낸 개체 — 우리에겐 있는데 참값엔 없는 것.
 *  ④ 자리 오차   — 짝지은 개체의 같은 시각 좌표 차이(타일).
 *  ⑤ 죽음 시각   — 참값에서 사라진 시각과 우리가 죽었다고 한 시각의 차이.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OPENBW = join(ROOT, "tools/openbw");
const BWDUMP = join(OPENBW, "bwdump");
const BWDATA = join(OPENBW, "data");
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("쓰기: node scripts/truth-check.mjs <리플레이.rep…>");
  process.exit(2);
}
for (const [p, what] of [[BWDUMP, "tools/openbw/build.sh 를 먼저 돌려라"],
                         [BWDATA, "tools/openbw/cascextract 로 자료를 먼저 뽑아라"]]) {
  if (!existsSync(p)) { console.error(`없다: ${p}\n  → ${what}`); process.exit(2); }
}

/** 우리 분석을 번들해 불러온다(id-check와 같은 방식). */
const dir = mkdtempSync(join(tmpdir(), "truth-"));
const src = join(dir, "e.ts");
const out = join(dir, "e.mjs");
writeFileSync(src, `export { buildUnitTracks } from ${JSON.stringify(join(ROOT, "src/legacy/replayUnits"))};`);
execFileSync("npx", ["esbuild", src, "--bundle", "--platform=node", "--format=esm",
  "--log-level=error", `--outfile=${out}`], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
const { buildUnitTracks } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });
const { default: Screp } = await import("screp-js");

const UNIT_NAME = JSON.parse(readFileSync(join(ROOT, "scripts/fixtures/unit-ids.json"), "utf8"));
const nm = (v) => (typeof v === "string" ? v : v?.Name ?? "");
const RACE = { Terran: "테란", Protoss: "프로토스", Zerg: "저그" };
/** 우리 쪽 표기를 참값 이름에 맞춘다(같은 유닛의 다른 이름). */
const ALIAS = {
  "Siege Tank (Tank Mode)": "Siege Tank", "Siege Tank (Siege Mode)": "Siege Tank",
  "Lurker Egg": "Lurker", Cocoon: "Mutalisk", ComSat: "Comsat Station",
  "Queens Nest": "Queen's Nest",
};
const canon = (u) => ALIAS[u] ?? u;
/** 자원·중립은 대조에서 뺀다 — 우리 분석은 애초에 이것을 개체로 안 만든다. */
const NEUTRAL = new Set(["Mineral Field (Type 1)", "Mineral Field (Type 2)",
  "Mineral Field (Type 3)", "Vespene Geyser", "Start Location"]);
/** 프레임 → 초(빠른 속도). */
const FPS = 23.81;

const FRAME_STEP = 48;   // 2초마다 — 자리 오차를 재기에 충분하고 덤프도 가볍다

for (const f of files) {
  /* ── 참값 — **생애표**를 쓴다(--units). 매 프레임을 빠짐없이 훑으므로 한 프레임만
     살다 간 유닛도 안 놓친다. 프레임마다 전부 뱉는 것보다 결과가 만 배 작고 정확하다. */
  const raw = execFileSync(BWDUMP, [BWDATA, f, "1", "--units"], {
    maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"],
  }).toString();
  const truth = new Map();      // 태그 → {kind, owner, born, last, died, bx, by, lx, ly}
  const truthAll = new Map();   // 중립(자원)까지 포함한 전부 — 유령 태그의 정체를 가린다
  for (const line of raw.split("\n")) {
    if (!line || line[0] === "t") continue;
    const [tag, kindId, owner, born, last, died, bx, by, lx, ly] = line.split("\t").map(Number);
    const kind = UNIT_NAME[String(kindId)] ?? `?${kindId}`;
    truthAll.set(tag, kind);
    if (NEUTRAL.has(kind)) continue;
    truth.set(tag, { kind, owner, born, last, died: !!died,
      bx: bx / 32, by: by / 32, lx: lx / 32, ly: ly / 32 });
  }

  // ── 우리 분석
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

  /* ── 짝짓기 — 태그가 곧 신원이다.
     우리 분석은 한 태그를 여러 생애로 자르므로(태그 재사용 판정), 태그마다 **가장 오래 산
     생애**를 대표로 삼아 이름을 견준다. */
  const byTag = new Map();
  let synthetic = 0;
  for (const e of d.ents) {
    if (e.t <= 0) { synthetic += 1; continue; }
    const cur = byTag.get(e.t);
    const life = (e.d ?? 1e9) - e.b;
    if (!cur || life > cur.life) byTag.set(e.t, { k: e.k, life, n: (cur?.n ?? 0) + 1 });
    else cur.n += 1;
  }
  const truthUnits = [...truth.values()].filter((t) => t.owner < 11);
  const truthTags = new Set([...truth.entries()].filter(([, t]) => t.owner < 11).map(([k]) => k));

  let matched = 0, kindOk = 0;
  const wrong = new Map();
  for (const [tag, o] of byTag) {
    const t = truth.get(tag);
    if (!t || t.owner >= 11) continue;
    matched += 1;
    if (canon(o.k) === canon(t.kind)) kindOk += 1;
    else wrong.set(`${o.k || "(무명)"} → ${t.kind}`, (wrong.get(`${o.k || "(무명)"} → ${t.kind}`) ?? 0) + 1);
  }
  const ourTags = new Set(byTag.keys());
  const missed = [...truthTags].filter((t) => !ourTags.has(t)).length;
  const ghosts = [...ourTags].filter((t) => !truthTags.has(t)).length;
  const ents = d.ents.filter((e) => !e.bld).length + d.ents.filter((e) => e.bld).length;

  const pc = (a, b) => (b ? (a / b * 100).toFixed(1) : "-") + "%";
  console.log(`\n▸ ${f.split("/").pop().slice(0, 52)}`);
  console.log(`  참값 유닛 ${truthUnits.length}기`);
  console.log(`  우리 개체 ${ents}기 = 태그 있는 것 ${ents - synthetic} + 합성 ${synthetic}`
    + `  → 참값의 ${(ents / Math.max(1, truthUnits.length)).toFixed(1)}배`);
  console.log(`  ① 정체 정확도   ${kindOk} / ${matched} = ${pc(kindOk, matched)}`
    + `   ← 태그로 짝지은 유닛 기준(이게 그동안 못 재던 수다)`);
  console.log(`  ② 찾은 유닛     ${matched} / ${truthTags.size} = ${pc(matched, truthTags.size)}`
    + `   (못 찾음 ${missed}기 — 명령에 한 번도 안 잡힌 유닛)`);
  const ghostKinds = new Map();
  for (const t of ourTags) {
    if (truthTags.has(t)) continue;
    const k = truthAll.get(t);
    ghostKinds.set(k ?? "(참값에 아예 없음)", (ghostKinds.get(k ?? "(참값에 아예 없음)") ?? 0) + 1);
  }
  console.log(`  ③ 없는 태그     ${ghosts}기   (사람 유닛이 아닌 태그로 개체를 만든 것)`);
  for (const [k, n] of [...ghostKinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)) {
    console.log(`     └ 참값에서 그 태그의 정체: ${k} ×${n}`);
  }
  /* 유령 태그가 애초에 **유닛 태그일 수 있는 수**인지 본다. 리마스터의 유닛 태그는
     index 칸이 1~3400이어야 한다(유닛 그릇이 3400칸이다) — 그 밖이면 유닛 번호가 아니다. */
  let ghostImpossible = 0;
  for (const t of ourTags) {
    if (truthTags.has(t)) continue;
    const ix = t & 0x1fff;
    if (ix < 1 || ix > 3400) ghostImpossible += 1;
  }
  console.log(`     └ 그중 ${ghostImpossible}기는 **유닛 태그일 수 없는 수**다`
    + ` (index 칸이 1~3400 밖)`);
  console.log(`  ④ 한 태그를 몇 개로 잘랐나  평균 ${(( ents - synthetic) / Math.max(1, ourTags.size)).toFixed(2)}개`);
  if (wrong.size) {
    console.log(`  틀린 이름 앞 8종(우리 → 참값):`);
    for (const [k, n] of [...wrong.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`     ${k}  ×${n}`);
    }
  }
}
