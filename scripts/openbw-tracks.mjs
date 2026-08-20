/* OpenBW 덤프를 앱이 먹는 트랙 꼴로 접는다 ─────────────────────────────────────
 *
 *   node scripts/openbw-tracks.mjs <리플레이.rep> [--out <파일.json>] [--step 3]
 *
 * 여태 트랙은 리플레이 명령에서 **추론**해 만들었다(src/legacy). 이제 OpenBW가 그 경기를
 * 실제로 돌리므로 추론할 것이 없다 — 매 프레임의 자리·방향·상태를 그대로 받아 적으면 된다.
 *
 * [무엇을 내나]
 *   { tag, owner, kind, born, died, keys: [t, x, y, heading, state] × n }
 * 이것이 앱의 SimTrack과 같은 꼴이다(src/legacy/simCore.ts). 좌표는 타일, 방향은 도,
 * 시각은 초다 — 덤프는 픽셀·0~255·프레임으로 주므로 여기서 바꾼다.
 *
 * [믿을 수 있는 구간]
 * 덤프 첫 줄의 `#trust`는 "시뮬이 여기까지는 실제 게임과 같다"는 프레임이다(-1이면 끝까지).
 * 리플레이 명령이 가리킨 유닛을 시뮬이 못 찾기 시작한 시각이고, 그 뒤로는 참값이 아니다.
 * 그대로 실어 보내서 쓰는 쪽이 알게 한다.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BWDUMP = join(ROOT, "tools/openbw/bwdump");
const BWDATA = join(ROOT, "tools/openbw/data");
const UNIT_NAME = JSON.parse(readFileSync(join(ROOT, "scripts/fixtures/unit-ids.json"), "utf8"));
/** 참값의 표기를 앱의 표기로 — 같은 유닛의 다른 이름이다. */
const ALIAS = { "Dark Templar (Unit)": "Dark Templar" };
/** 지도가 놓아 준 자원은 트랙으로 안 낸다 — 앱은 그것을 지도에서 그린다.
 *  경기 하나에 미네랄 덩이만 400~1556개라 짐의 절반이 이것이다. */
const MAP_RESOURCE = new Set(["Mineral Field (Type 1)", "Mineral Field (Type 2)",
  "Mineral Field (Type 3)", "Vespene Geyser", "Start Location"]);
const nameOf = (type) => { const n = UNIT_NAME[String(type)]; return ALIAS[n] ?? n ?? `?${type}`; };

const args = process.argv.slice(2);
const rep = args.find((a) => !a.startsWith("--"));
const outAt = args.indexOf("--out");
const out = outAt >= 0 ? args[outAt + 1] : null;
const stepAt = args.indexOf("--step");
const step = stepAt >= 0 ? Number(args[stepAt + 1]) : 3;
if (!rep) {
  console.error("쓰기: node scripts/openbw-tracks.mjs <리플레이.rep> [--out 파일.json] [--step 3]");
  process.exit(2);
}
for (const [p, what] of [[BWDUMP, "tools/openbw/build.sh 를 먼저 돌려라"],
                         [BWDATA, "tools/openbw/cascextract 로 자료를 먼저 뽑아라"]]) {
  if (!existsSync(p)) { console.error(`없다: ${p}\n  → ${what}`); process.exit(2); }
}

/** 프레임 → 초(빠른 속도). */
const FPS = 23.81;

const t0 = Date.now();
const raw = execFileSync(BWDUMP, [BWDATA, rep, String(step), "--tracks"], {
  maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"],
}).toString();
const dumpMs = Date.now() - t0;

let trust = -1;
/** 태그 → 트랙. 키는 일단 보통 배열에 모으고 마지막에 Float32Array로 굳힌다. */
const byTag = new Map();
let lines = 0;
const skipped = new Set();     // 지도 자원 — 트랙에서 뺀다
for (const line of raw.split("\n")) {
  if (!line) continue;
  if (line[0] === "#") {
    if (line.startsWith("#trust")) trust = Number(line.split("\t")[1]);
    continue;
  }
  if (line[0] === "f") continue;                    // 머리줄
  const [frame, tag, owner, type, x, y, head, state] = line.split("\t").map(Number);
  if (skipped.has(tag)) continue;
  lines += 1;
  let tr = byTag.get(tag);
  if (!tr) {
    const kind = nameOf(type);
    if (MAP_RESOURCE.has(kind)) { skipped.add(tag); continue; }
    tr = { tag, owner, kind, born: frame / FPS, died: null, keys: [] };
    byTag.set(tag, tr);
  }
  /* 갈래가 바뀌면(변태·주인 바뀜) 이름과 임자를 따라간다 — 라바가 알이 되고 저글링이
     되는 것이 한 태그의 한 생애다. 마지막에 무엇이었나로 이름을 잡는다. */
  if (state !== 3) { tr.kind = nameOf(type); tr.owner = owner; }
  else tr.died = frame / FPS;
  tr.keys.push(frame / FPS, x / 32, y / 32, head * 360 / 256, state);
}

const tracks = [...byTag.values()].map((tr) => ({ ...tr, keys: Float32Array.from(tr.keys) }));
const keyCount = tracks.reduce((n, tr) => n + tr.keys.length / 5, 0);
const bytes = keyCount * 5 * 4;

/** 앱이 아는 이름인가 — 모르면 모델도 값 표도 못 찾는다. */
let unknown = new Map();
try {
  const src = readFileSync(join(ROOT, "src/utils/bwUnits.ts"), "utf8");
  const known = new Set([...src.matchAll(/^\s*"?([A-Za-z][A-Za-z0-9 ()'.\-]*)"?:\s*mkU\(/gm)]
    .map((m) => m[1]));
  if (known.size > 20) {
    for (const tr of tracks) if (!known.has(tr.kind)) unknown.set(tr.kind, (unknown.get(tr.kind) ?? 0) + 1);
  }
} catch { /* 표를 못 읽으면 검사만 건너뛴다 */ }

console.log(`\n▸ ${rep.split("/").pop().slice(0, 56)}`);
console.log(`  덤프 ${(dumpMs / 1000).toFixed(1)}초 · 표본 간격 ${step}프레임`);
console.log(`  지도 자원 ${skipped.size}개는 뺐다 — 앱은 그것을 지도에서 그린다`);
console.log(`  트랙 ${tracks.length}개 · 키 ${keyCount}개 · ${(bytes / 1024 / 1024).toFixed(1)}MB(32비트 실수)`);
console.log(`  믿을 수 있는 구간: ${trust < 0 ? "끝까지" : `0 ~ ${(trust / FPS / 60).toFixed(1)}분`}`);
if (unknown.size) {
  console.log(`  ⚠ 앱이 모르는 이름 ${unknown.size}종:`);
  for (const [k, n] of [...unknown].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`     ${k} ×${n}`);
  }
}

if (out) {
  writeFileSync(out, JSON.stringify({
    trustFrame: trust, fps: FPS, step,
    tracks: tracks.map((tr) => ({ ...tr, keys: [...tr.keys] })),
  }));
  console.log(`  → ${out} (${(readFileSync(out).length / 1024 / 1024).toFixed(1)}MB JSON)`);
}
