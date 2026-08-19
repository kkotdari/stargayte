/* 건물 틈 성적표 — 두 건물을 위아래로 딱 붙여 놓고 그 사이로 유닛을 걷게 해 본다
 *
 *   npm run gap-check
 *
 * 원작 규칙(docs/note-building-gaps.md): 건물은 발자국(타일 배수)이 아니라 몸 상자로
 * 막고, 틈 = 위 건물 '하' 여백 + 아래 건물 '상' 여백이다. 몸 상자가 들어가면 지난다
 * (저글링 16px · 드라군 32px). 그래서 같은 두 건물도 순서를 바꾸면 열리고 닫힌다:
 * 서플→배럭 13px은 저글링도 막고, 배럭→서플 25px은 저글링만 지난다.
 *
 * 옆으로 돌아가지 못하게 복도를 만들어 두 건물이 그 높이를 꽉 채우게 놓는다. 유닛은
 * 복도 위쪽에서 출발해 오른쪽으로 간다 — 벽 한가운데를 지날 때 몸이 틈 높이에 있으면
 * '틈으로', 출발 높이 그대로면 '몸통 뚫고'다.
 *
 * ⚠ '몸통 뚫고'는 고장이 아니라 설계다 — 길이 아예 없으면 코어는 소프트 폴백으로 벽을
 *   비싸게 치고 지난다(증거가 "그 유닛은 저쪽에 있었다"고 말하면 어떻게든 가야 한다).
 *   여기서 보는 것은 '틈이 있으면 그 틈으로 도는가'다.
 *   복도 위·아래 끝에는 건물 몸 상자의 상·하 여백만큼 실틈이 남는다(엔지니어링 베이는
 *   위로 16px) — 저글링이 그 틈으로 새는 줄이 있으면 그것도 원작 그대로다. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "gap-"));
const src = join(dir, "e.ts"); const out = join(dir, "e.mjs");
writeFileSync(src, `export { simulate } from ${JSON.stringify(join(ROOT, "src/utils/simCore"))};\n`
  + `export { buildingBox, unitBoxTiles, BUILDING_FOOT } from ${JSON.stringify(join(ROOT, "src/utils/bwUnits"))};`);
execFileSync("npx", ["esbuild", src, "--bundle", "--platform=node", "--format=esm", "--log-level=error", `--outfile=${out}`], { cwd: ROOT, stdio: ["ignore","ignore","inherit"] });
const { simulate, buildingBox, unitBoxTiles, BUILDING_FOOT } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

const W = 40, H = 40;
/** 위 건물(top)의 발자국 아랫변에 아래 건물(bot)을 딱 붙인다. */
function run(top, bot, unit) {
  const ftop = BUILDING_FOOT[top], fbot = BUILDING_FOOT[bot];
  const tx = 16, ty = 14;                       // 위 건물 왼쪽 위 타일
  const by = ty + ftop[1];                      // 아래 건물은 바로 밑
  const bx = 16;
  const gapY = by;                              // 틈의 y(두 발자국이 맞닿는 줄)
  const startY = ty + 0.5;                      // 복도 위쪽에서 출발한다
  const ents = [
    { t: 101, o: 1, k: top, b: 0, bld: true, ev: [[0, tx, ty, 2]] },
    { t: 102, o: 1, k: bot, b: 0, bld: true, ev: [[0, bx, by, 2]] },
    // 유닛: 왼쪽에서 오른쪽으로 — 틈 한가운데 높이로 가로지른다.
    /* 같은 목적지를 20초까지 되풀이해 시계를 늘린다 — 시뮬은 마지막 '명령' 시각까지만
       돈다(endSec). 20초면 40타일도 걷고 남는다. */
    { t: 201, o: 2, k: unit, b: 0,
      ev: [[0, 10, startY, 3], [1, 30, startY, 0], [10, 30, startY, 0], [20, 30, startY, 0]] },
  ];
  /* 옆으로 돌아가지 못하게 복도를 만든다 — 두 건물이 복도 높이를 꽉 채우므로, 왼쪽에서
     오른쪽으로 가는 길은 두 건물 사이 틈 하나뿐이다. */
  const walk = new Uint8Array(W * H);
  for (let yy = ty; yy < by + fbot[1]; yy += 1) for (let xx = 0; xx < W; xx += 1) walk[yy * W + xx] = 1;
  const r = simulate({ players: [{ id: 1, name: "T" }, { id: 2, name: "Z" }], ents },
    { width: W, height: H, epsilon: 0.01, terrain: { w: W, h: H, walk } });
  const tr = r.tracks.find((q) => q.tag === 201);
  if (process.env.DBG) {
    const pts = [];
    for (let i = 0; i + 4 < tr.keys.length; i += 5) pts.push(`${tr.keys[i].toFixed(1)}s (${tr.keys[i+1].toFixed(1)},${tr.keys[i+2].toFixed(1)})`);
    console.log("   keys:", pts.slice(0, 20).join(" "));
  }
  let maxX = 10;
  for (let i = 0; i + 4 < tr.keys.length; i += 5) maxX = Math.max(maxX, tr.keys[i + 1]);
  /* 몸이 건물 상자를 뚫었나 — 키프레임 사이를 잘게 나눠 본다. 틈으로 지나갔으면 한 번도
     안 겹치고, 길이 없어 소프트 폴백으로 가로질렀으면 겹친다(= 원작이라면 못 지나감). */
  const rects = [
    [tx, ty, top], [bx, by, bot],
  ].map(([px, py, kind]) => {
    const f = BUILDING_FOOT[kind], b = buildingBox(kind);
    const cx = px + f[0] / 2 + b[2], cy = py + f[1] / 2 + b[3];
    return [cx - b[0] / 2, cy - b[1] / 2, cx + b[0] / 2, cy + b[1] / 2];
  });
  const [uw0, uh0] = unitBoxTiles(unit);
  /* 벽 한가운데(x)를 지날 때 몸 중심이 어느 높이였나 — 틈 한가운데면 틈으로 지난 것이고,
     출발 높이 그대로면 건물 몸통을 뚫고 간 것이다. */
  const wallX = (rects[0][0] + rects[0][2]) / 2;
  const gapMid = (rects[0][3] + rects[1][1]) / 2;
  let yAtWall = null;
  for (let i = 0; i + 9 < tr.keys.length; i += 5) {
    const x1k = tr.keys[i + 1]; const x2k = tr.keys[i + 6];
    if ((x1k - wallX) * (x2k - wallX) > 0) continue;
    const f = Math.abs(x2k - x1k) < 1e-6 ? 0 : (wallX - x1k) / (x2k - x1k);
    yAtWall = tr.keys[i + 2] + (tr.keys[i + 7] - tr.keys[i + 2]) * f;
    break;
  }
  const thru = yAtWall !== null && Math.abs(yAtWall - gapMid) < 0.4;
  const pierced = yAtWall !== null && !thru;
  // 두 몸 상자 사이 실제 틈(px)
  const bt = buildingBox(top), bb = buildingBox(bot);
  const topBottom = ty + ftop[1] / 2 + bt[3] + bt[1] / 2;
  const botTop = by + fbot[1] / 2 + bb[3] - bb[1] / 2;
  const gapPx = Math.round((botTop - topBottom) * 32);
  const [uw, uh] = unitBoxTiles(unit);
  return { gapPx, unitPx: Math.round(uh * 32), passed: maxX > 22 && thru, pierced,
    maxX: maxX.toFixed(1), yAtWall: yAtWall === null ? "-" : yAtWall.toFixed(2),
    gapMid: gapMid.toFixed(2) };
}

const pairs = [
  ["Supply Depot", "Barracks"], ["Barracks", "Supply Depot"],
  ["Barracks", "Barracks"], ["Supply Depot", "Supply Depot"],
  ["Supply Depot", "Factory"], ["Factory", "Supply Depot"],
  ["Command Center", "Barracks"], ["Engineering Bay", "Barracks"],
];
console.log("위 건물 → 아래 건물         틈px  유닛(세로px)  통과?  도달 x");
for (const [a, b] of pairs) {
  for (const u of ["Zergling", "Dragoon"]) {
    const r = run(a, b, u);
    console.log(`${(a + " → " + b).padEnd(28)} ${String(r.gapPx).padStart(4)}  ${u.padEnd(9)}${String(r.unitPx).padStart(3)}   ${(r.passed ? "틈으로" : r.pierced ? "몸통 뚫고" : "못 감").padEnd(10)} 벽에서 y=${r.yAtWall} (틈 한가운데 ${r.gapMid})`);
  }
}
