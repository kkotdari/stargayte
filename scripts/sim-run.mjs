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

/* ── 시작·끝 성적표 (과제 #68) ────────────────────────────────────────────────
 *
 * 드리프트는 **모든** 앵커와의 거리다. 그건 "시뮬이 진실이 된다"를 목표로 삼던 때의
 * 자다. 목표가 "시작과 끝이 진실"로 바뀐 뒤로는 그 자로 합격을 가릴 수 없다 — 중간
 * 과정은 애초에 재현 대상이 아니다.
 *
 * 그래서 목표에 맞는 자를 따로 둔다. 셋 다 증거에 있는 것만 쓰고 하나도 지어내지 않는다.
 *
 *  출생 — 코어가 첫 증거 자리에서 그냥 시작하므로 구조적으로 0이다. 확인만 하고 끝.
 *
 *  사망 — ★ 여기서 순환을 조심해야 한다. simCore의 dieBy는 증거의 d를 **상한**으로
 *    쓴다: 시뮬이 그때까지 못 죽였으면 증거 시각에 그냥 죽인다(:1082). 그래서 죽음을
 *    통째로 세면 '놓친 죽음 0%, 시각 오차 0초'가 구조적으로 나온다 — 아무것도 안
 *    재는 숫자다. 처음 짤 때 실제로 그 숫자가 나왔다(놓친죽음 0%, 시각 중앙 1.00초).
 *
 *    갈라야 한다. 죽음 사건(EV_DIE)의 넷째 칸이 죽인 자의 태그인데, 시뮬이 스스로
 *    죽였으면 그 자리에 진짜 태그가 들어가고 증거가 시켜 죽였으면 0이 들어간다.
 *      · 자력 사망률 — 증거가 말한 죽음 중 시뮬이 **스스로** 죽인 몫. 이게 전투
 *        모형의 성적이다. 나머지는 시뮬이 못 죽여 증거가 떠먹여 준 것이다.
 *      · 시각 오차 — 자력으로 죽인 것만 잰다. 떠먹은 것은 늘 0이라 섞으면 안 된다.
 *      · 지어낸 죽음 — 증거는 끝까지 살았다는데 시뮬이 죽인 것.
 *      · 자리 오차 — 이건 둘 다 잰다. 시각을 떠먹었어도 그때 **어디** 있었는지는
 *        시뮬이 스스로 낸 답이다. d 직전의 마지막 자리 증거와 견주되, 그 증거가
 *        얼마나 오래된 것인지로 거른다(30초 전 자리와 견주면 그 사이 걸어간 거리를
 *        오차로 세는 셈이다). 신선도 5초/15초 두 칸.
 *
 *  교전 참여 — "전투 단위"를 새로 지어내지 않는다(그 나누기가 애매하다는 지적이
 *    있었다). 대신 증거가 이미 갖고 있는 **맞은 순간**을 쓴다: 체력 자취(hp)가
 *    내려간 시각이 곧 "그때 그 유닛은 전투 안에 있었다"는 증거다. 시뮬에서도 그
 *    무렵 그 태그가 표적이 됐는지를 본다. 반대쪽(시뮬은 때렸는데 증거엔 체력이 안 준
 *    것)도 센다 — 일치율만 보면 '아무도 안 때린다'와 '엉뚱한 놈을 때린다'가 구분이
 *    안 된다.
 *
 * [한계] 태그는 재사용된다. 같은 태그의 여러 생애는 출생 시각이 가장 가까운 것끼리
 *   짝짓는다. 자리 없는 물리 건물(t=-1)은 태그가 없어 통째로 뺀다. */

/** 죽음으로 셀 것 — 변태(morph)는 다음 생애로 이어지는 것이고, 건설 취소(cxl)는
 *  애초에 선 적이 없다. 둘 다 죽음이 아니다. */
const DEATH_KINDS = new Set(["tag", "atk", ""]);
/** 사망 시각이 맞았다고 볼 창(초). */
const DIE_OK_SEC = 2;
/** 맞은 순간을 견줄 창(초) — 시뮬의 발사가 이만큼 안이면 같은 교전으로 본다. */
const HIT_WIN_SEC = 3;

const median = (a) => {
  if (a.length === 0) return null;
  const v = [...a].sort((x, y) => x - y);
  return v[Math.floor(v.length / 2)];
};
const pct = (n, d) => (d > 0 ? (n / d) * 100 : 0);

/** 키프레임 배열에서 t 시각의 자리 — posAtSim과 같은 셈(여기선 자리만 쓴다). */
function posOfKeys(keys, t) {
  const n = keys.length / 5;
  if (n === 0 || t < keys[0]) return null;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (keys[mid * 5] <= t) lo = mid; else hi = mid - 1;
  }
  const i = lo * 5;
  if (lo === n - 1) return [keys[i + 1], keys[i + 2]];
  const j = i + 5;
  const span = keys[j] - keys[i];
  const u = span > 0 ? Math.min(1, Math.max(0, (t - keys[i]) / span)) : 0;
  return [keys[i + 1] + (keys[j + 1] - keys[i + 1]) * u,
    keys[i + 2] + (keys[j + 2] - keys[i + 2]) * u];
}

function goalReport(data, r) {
  /* 태그마다 생애가 여럿일 수 있다 — 출생 시각이 가장 가까운 자취와 짝짓는다. */
  const byTag = new Map();
  for (const tr of r.tracks) {
    const arr = byTag.get(tr.tag);
    if (arr) arr.push(tr); else byTag.set(tr.tag, [tr]);
  }
  const mate = (e) => {
    const arr = byTag.get(e.t);
    if (!arr || arr.length === 0) return null;
    let best = arr[0];
    for (const tr of arr) if (Math.abs(tr.born - e.b) < Math.abs(best.born - e.b)) best = tr;
    return best;
  };

  /* 사건은 8칸씩 [초, 갈래, 주체, 표적, x, y, tx, ty].
     · 발사(0) — 표적 태그별로 시각을 모은다.
     · 죽음(1) — 태그별로 [시각, 죽인 자]를 모은다. 죽인 자가 0이면 증거가 시킨 것이다. */
  const hitAt = new Map();
  const dieEv = new Map();
  for (let i = 0; i < r.events.length; i += 8) {
    const sec = r.events[i];
    if (r.events[i + 1] === 1) {
      const tag = r.events[i + 2];
      const arr = dieEv.get(tag);
      if (arr) arr.push([sec, r.events[i + 3]]); else dieEv.set(tag, [[sec, r.events[i + 3]]]);
      continue;
    }
    const tgt = r.events[i + 3];
    const arr = hitAt.get(tgt);
    if (arr) arr.push(sec); else hitAt.set(tgt, [sec]);
  }
  for (const arr of hitAt.values()) arr.sort((a, b) => a - b);
  const nearIn = (arr, sec, win) => {
    if (!arr) return false;
    for (const s2 of arr) {
      if (s2 > sec + win) return false;
      if (s2 >= sec - win) return true;
    }
    return false;
  };
  /** 이 자취의 죽음을 낸 사건 — 시각이 맞는 것. 없으면 null. */
  const dieOf = (tr) => {
    if (!tr || tr.died === null || tr.died === undefined) return null;
    const arr = dieEv.get(tr.tag);
    if (!arr) return null;
    return arr.find(([sec]) => Math.abs(sec - tr.died) < 0.05) ?? null;
  };

  const dieDt = [];
  /* 부호까지 남긴다 — 늦게 죽이는 것과 일찍 죽이는 것은 고칠 곳이 다르다.
     (simCore는 자력 사망 시각을 aliveUntil 아래로 못 내리므로 늦는 쪽으로 쏠린다.) */
  const dieSign = [];
  const dieD5 = [];
  const dieD15 = [];
  let evDeaths = 0;
  let selfKill = 0;
  let fab = 0;
  let survived = 0;
  let bornN = 0;
  let hits = 0;
  let hitsOk = 0;
  let simHits = 0;
  let simHitsOk = 0;
  for (const e of data.ents) {
    if (e.t === -1) continue;
    const tr = mate(e);
    if (tr) bornN += 1;
    const dead = e.d !== null && e.d !== undefined && DEATH_KINDS.has(e.dk ?? "");

    if (dead) {
      evDeaths += 1;
      const dv = dieOf(tr);
      /* 죽인 자가 0이 아니면 시뮬이 스스로 죽인 것 — 시각 오차는 그것만 잰다. */
      if (dv && dv[1] !== 0) { selfKill += 1; dieDt.push(Math.abs(tr.died - e.d)); dieSign.push(tr.died - e.d); }
      /* 자리는 떠먹은 죽음에서도 시뮬이 스스로 낸 답이라 둘 다 잰다. */
      if (tr && tr.died !== null && tr.died !== undefined) {
        let last = null;
        for (const v of e.ev) {
          if (v[1] < 0 || v[0] > e.d) continue;
          if (!last || v[0] >= last[0]) last = v;
        }
        const sp = last ? posOfKeys(tr.keys, e.d) : null;
        if (last && sp) {
          const d2 = Math.hypot(sp[0] - last[1], sp[1] - last[2]);
          const age = e.d - last[0];
          if (age <= 5) dieD5.push(d2);
          if (age <= 15) dieD15.push(d2);
        }
      }
    } else if (!e.bld) {
      /* 증거는 끝까지 살았다는데 시뮬이 스스로 죽인 것 — 지어낸 죽음. 건물은 뺀다
         (분석이 파괴를 못 잡은 건물이 많아 이 칸이 건물로 채워진다). */
      survived += 1;
      const dv = dieOf(tr);
      if (dv && dv[1] !== 0) fab += 1;
    }

    /* 맞은 순간 — 체력이 내려간 변곡점. 첫 점은 기준선이라 건너뛴다. */
    const hp = e.hp;
    if (tr && Array.isArray(hp)) {
      const drops = [];
      for (let i = 1; i < hp.length; i += 1) {
        if (hp[i][1] >= hp[i - 1][1]) continue;
        drops.push(hp[i][0]);
        hits += 1;
        if (nearIn(hitAt.get(e.t), hp[i][0], HIT_WIN_SEC)) hitsOk += 1;
      }
      /* 반대쪽 — 시뮬이 이 태그를 때린 순간마다 증거에 체력 하락이 곁에 있나. */
      const sh = hitAt.get(e.t);
      if (sh) {
        drops.sort((a, b) => a - b);
        for (const sec of sh) {
          simHits += 1;
          if (nearIn(drops, sec, HIT_WIN_SEC)) simHitsOk += 1;
        }
      }
    }
  }
  return {
    bornN,
    evDeaths,
    selfPct: pct(selfKill, evDeaths),
    selfN: selfKill,
    fabPct: pct(fab, survived),
    fab,
    dieMed: median(dieDt),
    dieSigned: median(dieSign),
    dieOk: pct(dieDt.filter((v) => v <= DIE_OK_SEC).length, dieDt.length),
    d5: median(dieD5), d5n: dieD5.length,
    d15: median(dieD15), d15n: dieD15.length,
    hits, hitOk: pct(hitsOk, hits),
    simHits, simHitOk: pct(simHitsOk, simHits),
  };
}

const { simulate } = await bundle("src/legacy/simCore.ts");
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
  const g = goalReport(data, r);
  const f2 = (v, u) => (v === null ? "  —  " : `${v.toFixed(2)}${u}`);
  console.log([
    "".padEnd(14),
    `└ 시작·끝  자력사망 ${g.selfPct.toFixed(0).padStart(3)}%(${g.selfN}/${g.evDeaths})`,
    `지어낸죽음 ${g.fabPct.toFixed(0).padStart(3)}%(${g.fab})`,
    `사망시각 중앙 ${f2(g.dieMed, "초")}(부호 ${g.dieSigned === null ? "—" : (g.dieSigned >= 0 ? "+" : "") + g.dieSigned.toFixed(1)})/${DIE_OK_SEC}초이내 ${g.dieOk.toFixed(0).padStart(3)}%`,
    `사망자리 ≤5초 ${f2(g.d5, "타일")}(n=${g.d5n}) ≤15초 ${f2(g.d15, "타일")}(n=${g.d15n})`,
    `맞은순간 증거→시뮬 ${g.hitOk.toFixed(0).padStart(3)}%(n=${g.hits})`,
    `시뮬→증거 ${g.simHitOk.toFixed(0).padStart(3)}%(n=${g.simHits})`,
  ].join("  "));
}
