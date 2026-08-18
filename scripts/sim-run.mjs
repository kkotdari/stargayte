/* 시뮬 코어를 돌려 결과와 품질 지표를 낸다 (기획서 docs/plan-sim-core-v4.md P1)
 *
 *   node scripts/sim-run.mjs --db <sqlite>          로컬 DB의 개체 트랙 전부
 *   node scripts/sim-run.mjs tracks/*.json
 *
 * 렌더를 안 건드리고 시뮬만 검증하는 자리다 — 앵커 드리프트(시뮬이 '그때 거기 있었다'는
 * 증거와 얼마나 벌어지나)가 이 단계의 성적표다. 걸음 허구는 시뮬에서 구조적으로 0이라
 * 재지 않는다(제 속도표보다 빨리 갈 방법이 없다).
 *
 * ★ 지형(과제 #50) — 여태 여기는 `terrain: null`을 박아 넣고 돌았다. 그래서 지금까지의
 *   드리프트 숫자(중앙 3.31타일 등)는 전부 **벽이 하나도 없는 판**에서 나온 것이다.
 *   simCore는 진작 지형을 받을 준비가 돼 있었고(liveGrid·blockedAt·findPath) 재료만
 *   안 들어가고 있었다. 이제 사람이 검수한 격자(minimap_images.walk)를 맵에 붙어 있는
 *   대로 실어 넘긴다. --no-terrain으로 옛 방식(벽 없음)과 나란히 잴 수 있고,
 *   --walk로 DB 없이 격자 파일 하나만 물릴 수도 있다
 *   (scripts/fixtures/walk-fastest.json — 빠른무한 검수본, 이 계측의 붙박이 표본).
 *
 *   지형은 사람이 검수한 walk가 진실이다. 리플레이에 든 타일 격자(replay_maps.tiles)로
 *   자동 추출하는 길도 재 봤지만(이 맵에서는 그룹 다수결로 100% 맞았다) 그 길은 안
 *   간다 — 타일 그룹 번호는 타일셋마다 뜻이 달라 맵 하나에서 맞은 것이 다음 맵에서
 *   맞는다는 보장이 없고, 지형은 사람 손에 맡기기로 했다.
 *
 * ★ 실측(세 경기 모두 같은 빠른무한 지형) — 지형 없음 → 있음:
 *
 *     경기   개체   앵커     관통            드리프트 중앙
 *     1      3073   893   12.0% →  5.5%     2.86 → 2.91
 *     2       139    36   25.1% → 11.1%     1.26 → 1.70
 *     3       703   226   20.6% →  5.8%     0.50 → 0.48
 *
 *   앞선 기록에는 경기 2만 적혀 있었다(앵커 36개). 그 하나만 보면 "벽을 지키면
 *   드리프트를 치른다"로 읽히는데, 앵커 893개짜리 경기 1과 226개짜리 경기 3에서는
 *   드리프트가 사실상 그대로다. 벽을 지키는 값은 거의 안 치른다는 뜻이다.
 *   남은 관통 ~5.5%는 groundPathSoft 폴백(길이 아예 없으면 벽을 비싸게 치고 지난다)과
 *   증거 앵커 스냅에서 온다 — 다음에 손댈 곳이다. */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function bundle(entry) {
  const dir = mkdtempSync(join(tmpdir(), "simrun-"));
  const out = join(dir, "m.mjs");
  execFileSync("npx", ["esbuild", join(ROOT, entry), "--bundle", "--format=esm",
    "--log-level=error", `--outfile=${out}`], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  const mod = await import(pathToFileURL(out).href);
  rmSync(dir, { recursive: true, force: true });
  return mod;
}

async function fromDb(path) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path, { readOnly: true });
  const rows = db.prepare(
    "select game_result_id as id, data from game_result_unit_tracks order by game_result_id").all();
  /* 자원표와 지형은 둘 다 맵에 붙어 있다 — 자원은 replay_maps.resources, 지형은
     그 맵이 연결한 미니맵 그림의 검수 격자(minimap_images.walk)다. 일꾼 채취를 재려면
     자원이, 벽 막기를 재려면 지형이 있어야 한다. */
  const res = db.prepare(`select o.match_id as id, m.resources as res, i.walk as walk
     from game_outcomes o
     join replay_maps m on m.map_hash = o.map_hash
     left join minimap_images i on i.id = m.image_id`).all();
  const byId = new Map(res.map((r) => [r.id, r]));
  db.close();
  return rows.map((r) => ({
    label: `game ${r.id}`,
    json: r.data,
    resources: byId.get(r.id)?.res ? JSON.parse(byId.get(r.id).res) : [],
    walk: byId.get(r.id)?.walk ?? null,
  }));
}

const argv = process.argv.slice(2);
/** --no-terrain: 지형을 일부러 빼고 돈다(옛 기준선과 나란히 재려고).
 *  --walk <파일>: DB에 없는 격자를 손으로 물린다(검수본 JSON 그대로). */
const NO_TERRAIN = argv.includes("--no-terrain");
const walkFlagAt = argv.indexOf("--walk");
const WALK_FILE = walkFlagAt >= 0 ? argv[walkFlagAt + 1] : null;
const args = argv.filter((a, i) => a !== "--no-terrain"
  && (walkFlagAt < 0 || (i !== walkFlagAt && i !== walkFlagAt + 1)));
if (args.length === 0) {
  console.error("쓰기: node scripts/sim-run.mjs <트랙.json…> | --db <sqlite 경로>"
    + "  [--no-terrain] [--walk <검수격자.json>]");
  process.exit(2);
}
const walkOverride = WALK_FILE ? readFileSync(WALK_FILE, "utf8") : null;
const inputs = (args[0] === "--db"
  ? await fromDb(args[1])
  : args.map((p) => ({
    label: p.split("/").pop(), json: readFileSync(p, "utf8"), resources: [], walk: null,
  }))
).map((x) => ({ ...x, walk: walkOverride ?? x.walk }));

const { simulate } = await bundle("src/utils/simCore.ts");
const { decodeWalk } = await bundle("src/utils/minimapTerrain.ts");
const { isAir } = await bundle("src/utils/bwUnits.ts");

/** 벽뚫기 — 지상 개체의 자취 토막 중 못 걷는 칸을 지나는 것의 비율(과제 #50).
 *
 *  드리프트는 이걸 못 잰다. 시뮬이 절벽을 곧장 가로질러도 증거 자리에 제때 닿기만 하면
 *  드리프트는 오히려 **좋아진다** — 벽을 지키면 돌아가느라 늦어 나빠진다. 그래서 지형을
 *  넣는 일의 성적표는 따로 있어야 한다.
 *
 *  토막마다 0.25타일 간격으로 훑어 한 점이라도 막힌 칸이면 그 토막을 벽뚫기로 센다.
 *  공중은 뺀다(날아가는 게 맞다). 건물·자원 발자국은 여기서 안 본다 — 지도가 말하는
 *  진짜 벽만 재는 자리다. */
function wallRun(tracks, terrain) {
  if (!terrain) return null;
  const { w, h, walk } = terrain;
  const blocked = (x, y) => {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    if (gx < 0 || gy < 0 || gx >= w || gy >= h) return false;
    return walk[gy * w + gx] === 0;
  };
  let segs = 0;
  let bad = 0;
  let dist = 0;
  let badDist = 0;
  /* 남는 벽뚫기가 어디서 오는지 가른다 — 둘은 고칠 곳이 다르다.
     · 서 있는 자리(pts): 키프레임 자체가 막힌 칸에 앉아 있다. 대개 증거가 "그때 거기
       있었다"고 못 박은 자리라, 격자와 증거가 서로 다른 말을 하는 것이다(격자 검수
       또는 증거 좌표의 문제이지 길찾기 문제가 아니다).
     · 관통(thru): 양 끝은 멀쩡한 땅인데 사이가 벽을 가로지른다. 이건 순전히 길찾기의
       거짓말이라 우리가 고칠 몫이다. */
  let pts = 0;
  let ptsBad = 0;
  let thru = 0;
  let thruDist = 0;
  for (const tr of tracks) {
    if (isAir(tr.kind)) continue;
    const n = tr.keys.length / 5;
    for (let i = 0; i < n; i += 1) {
      pts += 1;
      if (blocked(tr.keys[i * 5 + 1], tr.keys[i * 5 + 2])) ptsBad += 1;
    }
    for (let i = 1; i < n; i += 1) {
      const x0 = tr.keys[(i - 1) * 5 + 1];
      const y0 = tr.keys[(i - 1) * 5 + 2];
      const x1 = tr.keys[i * 5 + 1];
      const y1 = tr.keys[i * 5 + 2];
      const d = Math.hypot(x1 - x0, y1 - y0);
      if (d < 1e-6) continue;
      segs += 1;
      dist += d;
      const steps = Math.max(1, Math.ceil(d / 0.25));
      let hit = false;
      let inner = false;
      for (let k = 0; k <= steps; k += 1) {
        if (blocked(x0 + ((x1 - x0) * k) / steps, y0 + ((y1 - y0) * k) / steps)) {
          hit = true;
          if (k > 0 && k < steps) inner = true;
        }
      }
      if (hit) { bad += 1; badDist += d; }
      const ends = blocked(x0, y0) || blocked(x1, y1);
      if (inner && !ends) { thru += 1; thruDist += d; }
    }
  }
  return {
    segs, bad, rate: segs ? (bad / segs) * 100 : 0, dist, badDist,
    distRate: dist ? (badDist / dist) * 100 : 0,
    ptRate: pts ? (ptsBad / pts) * 100 : 0,
    thru, thruDistRate: dist ? (thruDist / dist) * 100 : 0,
  };
}

for (const { label, json, resources, walk } of inputs) {
  const data = JSON.parse(json);
  if (!data || !Array.isArray(data.ents)) { console.error(`${label}: 개체 트랙이 아니다`); continue; }
  /* 맵 크기는 트랙에 없다 — 증거 좌표의 최대치로 어림한다(대개 128×128). */
  let mx = 0;
  let my = 0;
  for (const e of data.ents) for (const v of e.ev) { if (v[1] > mx) mx = v[1]; if (v[2] > my) my = v[2]; }
  const W = mx > 96 ? 128 : mx > 64 ? 96 : 64;
  const H = my > 96 ? 128 : my > 64 ? 96 : 64;
  /* 검수 격자는 맵 타일 격자와 같은 자다(128×128) — 시뮬의 좌표도 타일이라 그대로 쓴다.
     격자 크기가 증거로 어림한 W×H와 다르면 격자 쪽이 진실이다(맵이 실제로 그 크기다). */
  /* --no-terrain은 시뮬에서만 지형을 뺀다 — 자(벽뚫기)는 그대로 두어야 옛 판이 얼마나
     뚫고 다녔는지가 보인다. */
  const ruler = decodeWalk(walk);
  const terrain = NO_TERRAIN ? null : ruler;
  const [SW, SH] = terrain ? [terrain.w, terrain.h] : [W, H];
  const r = simulate(data, { width: SW, height: SH, terrain, resources });
  const wr = wallRun(r.tracks, ruler);
  const s = r.stats;
  const bytes = r.tracks.reduce((n, t) => n + t.keys.length, 0) * 4;
  console.log([
    label.padEnd(14),
    `${SW}x${SH}`,
    terrain ? `지형 O(막힘 ${terrain.walk.reduce((n, v) => n + (v ? 0 : 1), 0)}칸)` : "지형 X          ",
    `자원 ${String((resources ?? []).length).padStart(3)}`,
    `개체 ${String(s.ents).padStart(5)}`,
    `틱 ${String(s.ticks).padStart(6)}`,
    `키 ${String(Math.round(s.keys)).padStart(7)}`,
    `앵커 ${String(s.anchors).padStart(6)}`,
    `드리프트 중앙 ${String(s.driftMedian).padStart(5)} / 90분위 ${String(s.driftP90).padStart(6)} / 1.5타일초과 ${String(s.driftBadRate).padStart(5)}%`,
    `죽임 ${String(s.kills).padStart(5)} / 증거구조 ${String(s.saved).padStart(5)} / 발사 ${String(s.shots).padStart(7)}`,
    wr ? `벽뚫기 거리 ${String(wr.distRate.toFixed(1)).padStart(5)}%`
      + ` (관통 ${String(wr.thruDistRate.toFixed(1)).padStart(5)}% · 선자리 ${String(wr.ptRate.toFixed(1)).padStart(5)}%)`
      : "벽뚫기 —                          ",
    `${String(s.ms).padStart(6)}ms`,
    `${(bytes / 1024 / 1024).toFixed(2)}MB`,
  ].join("  "));
}
