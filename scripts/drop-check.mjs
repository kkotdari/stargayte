/* 드랍(수송) 판단의 자 — 태운 것이 내리나, 땅에 복제품이 남나 (지적 대응)
 *
 *   npm run drop-check <리플레이.rep…>
 *
 * 지적: "드랍 판단 아직 부족한 듯. 드랍 간 유닛이 타고 난 뒤 다시 복제품들이 땅에
 * 나타나서는 곧 혼자 죽음. 그리고 수송선에서 내리는 일 없음."
 *
 * 리플레이에는 '누가 언제 탔다 내렸다'가 커맨드로만 남는다 — 태우기(f=12)와
 * 내리기(f=13). 그래서 이 자는 그 두 증거가 짝을 이루는지, 안 이루면 무엇이 그
 * 자리를 메우는지를 센다.
 *
 *  ① 탑승 구간이 무엇으로 닫히나 — 하차(f=13)로 닫힌 것 / 배 안에서 낼 수 없는 제
 *     명령으로 닫힌 것 / 끝내 안 닫힌 것. 셋째가 많으면 "내리는 일이 없다"가 된다.
 *  ② 태운 뒤 하차까지 걸린 시간 — 중앙값. 터무니없이 길면 구간을 잘못 닫고 있다.
 *  ③ 복제품 후보 — 실개체가 배 안에 있는 동안, 같은 임자·같은 종류의 **합성 개체**가
 *     땅에 서 있는 수. 합성은 생산 원장이 '뽑혔는데 관측 못 한 유닛'을 메우려고 지어
 *     내는 개체라, 태운 유닛을 관측에서 놓치면 바로 여기서 쌍둥이가 된다.
 *  ④ 혼자 죽는 합성 — 죽는 자리 8타일 안에 적의 공격 클릭이 하나도 없는 죽음.
 *     화면에서는 '아무도 안 때렸는데 혼자 죽는' 유닛으로 보인다.
 *  ⑤ 트립의 적재 자리 — 한 배가 한 번에 실은 자리 합(원작의 수송칸은 8, 벙커는 4).
 *     정원을 넘긴 트립이 있으면 태울 수 없는 것을 태운 것이고, 못 탄 유닛까지 사라졌다가
 *     하차 자리에 나타난다.
 *  ⑥ 하차 줄서기 — 같은 배에서 잇달아 내린 간격. 원작은 18프레임(0.756초)에 한 기씩이다.
 *  ⑦ 내리는 자리와 배 사이 — 하차 시각에 **배가 실제로 있던 자리**와 승객이 나타나는
 *     자리의 거리. 이것이 벌어지면 화면에서는 '배가 내려 준 것'으로 안 보인다.
 *  ⑧ 타러 가는 걸음 — 승선 직전 증거에서 배까지의 거리를 그 사이 시간으로 나눈 속도.
 *     제 최고 속도를 넘으면 걸어간 것이 아니라 순간이동해서 탄 것이다. */

import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("쓰기: node scripts/drop-check.mjs <리플레이.rep…>");
  process.exit(2);
}
const dir = mkdtempSync(join(tmpdir(), "dropchk-"));
/* 계측판 — 승선 후보가 **어느 문턱에서 걸러지나**를 세는 계수기만 끼운 replayUnits
   복사본을 만든다(앱에는 계측 코드가 한 줄도 안 들어간다). 후보를 만드는 곳과 거르는
   곳이 한 함수 안에 있어 바깥에서는 못 재는 값이다. */
const RU = join(ROOT, "src/utils/replayUnits.ts");
const ruSrc = readFileSync(RU, "utf8");
const NEEDLE = "    void promoted;";
const PROBE = `    {
      const g9 = globalThis as unknown as { __board?: Record<string, number> };
      const st9 = {
        cand: pendBoard.length, promoted,
        noTrans: 0, riderTrans: 0, noLife: 0, isTrans: 0, noDrop: 0, pass: 0,
      };
      for (const [bsec9, rtag9, ttag9, , , bpid9] of pendBoard) {
        if (transTagOwner.get(ttag9) !== bpid9) { st9.noTrans += 1; continue; }
        if (transTagOwner.has(rtag9)) { st9.riderTrans += 1; continue; }
        const rl9 = lifeAt(rtag9, bsec9);
        if (!rl9 || rl9.bld || rl9.owner !== bpid9) { st9.noLife += 1; continue; }
        if (isTransportLife(rl9)) { st9.isTrans += 1; continue; }
        const dr9 = (unloadsBy.get(ttag9) ?? []).find(([u9]) => u9 > bsec9 && u9 - bsec9 < 600);
        if (!dr9) { st9.noDrop += 1; continue; }
        st9.pass += 1;
      }
      g9.__board = st9;
    }
${NEEDLE}`;
const probed = ruSrc.includes(NEEDLE);
const absImports = (t) => t.replace(/from "\.\//g, `from "${join(ROOT, "src/utils")}/`);
writeFileSync(join(dir, "replayUnits.ts"), absImports(probed ? ruSrc.replace(NEEDLE, PROBE) : ruSrc));
const src = join(dir, "e.ts");
const out = join(dir, "e.mjs");
writeFileSync(src, `export { buildUnitTracks } from ${JSON.stringify(probed ? join(dir, "replayUnits") : join(ROOT, "src/utils/replayUnits"))};`);
execFileSync("npx", ["esbuild", src, "--bundle", "--platform=node", "--format=esm",
  "--log-level=error", `--outfile=${out}`], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
const { buildUnitTracks } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });
const { default: Screp } = await import("screp-js");

const nm = (v) => (typeof v === "string" ? v : v?.Name ?? "");
const RACE = { Terran: "테란", Protoss: "프로토스", Zerg: "저그" };
const SEC = 1 / 23.81;
const TRANSPORT = new Set(["Dropship", "Shuttle", "Overlord"]);
const SYN = (t) => t <= -1000 && t > -20000;
const med = (a) => (a.length === 0 ? 0 : a.slice().sort((x, y) => x - y)[a.length >> 1]);

console.log("\n── 드랍 판단의 자 ──────────────────────────────────────────────────");
for (const path of files) {
  const buf = new Uint8Array(readFileSync(path));
  const res = await Screp.parseBuffer(buf, { cmds: true, mapData: true, mapTiles: true, mapResLoc: true });
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
  globalThis.__board = undefined;
  const d = buildUnitTracks(res.Commands?.Cmds ?? [], players);
  const board = globalThis.__board;
  const endSec = (res.Header.Frames ?? 0) * SEC;

  /* 탑승 구간 — 재생기(ReplayMotionPlayer의 rideSpans)와 **같은 규칙**으로 짓는다.
     자가 딴 규칙을 쓰면 화면과 다른 것을 재게 된다. */
  const spans = [];
  for (const e of d.ents) {
    if (e.bld) continue;
    for (let i = 0; i < e.ev.length; i += 1) {
      if (e.ev[i][3] !== 12) continue;
      const bs = e.ev[i][0];
      const off = e.ev.find((v, j) => j > i && v[3] === 13);
      const own = e.ev.find((v, j) => j > i && (v[3] === 0 || v[3] === 7) && v[0] >= bs + 8);
      spans.push({
        e, from: bs, to: off ? off[0] : (own ? own[0] : Infinity),
        how: off ? "하차" : (own ? "제명령" : "안닫힘"),
        host: e.ev[i][4] ?? 0,
      });
    }
  }
  const byOff = spans.filter((s) => s.how === "하차");
  const byOwn = spans.filter((s) => s.how === "제명령");
  const open = spans.filter((s) => s.how === "안닫힘");
  const ships = d.ents.filter((e) => !e.bld && TRANSPORT.has(e.k));

  const units = d.ents.filter((e) => !e.bld);
  const syn = units.filter((e) => SYN(e.t));
  /* 복제품 후보 — 실개체가 배 안인 동안, 같은 임자·같은 종류의 합성이 땅에 살아 있다. */
  let twins = 0;
  for (const s of spans) {
    if (!s.e.k) continue;
    const hi = Math.min(s.to, endSec);
    for (const u of syn) {
      if (u.o !== s.e.o || u.k !== s.e.k) continue;
      const ub = u.b;
      const ud = u.d ?? endSec;
      if (ub < hi && ud > s.from) { twins += 1; break; }
    }
  }
  /* 혼자 죽는 합성 — 죽는 자리 곁 8타일에 적 공격 클릭이 없다. */
  const teamOf = new Map(players.map((p) => [p.id, p.team]));
  const foe = (a, b) => {
    const ta = teamOf.get(a);
    const tb = teamOf.get(b);
    return ta !== undefined && tb !== undefined && ta !== null && tb !== null ? ta !== tb : a !== b;
  };
  const atk = [];
  for (const e of d.ents) for (const v of e.ev) if (v[3] === 7) atk.push({ s: v[0], x: v[1], y: v[2], o: e.o });
  atk.sort((a, b) => a.s - b.s);
  let lonely = 0;
  let synDead = 0;
  /** 인구 상한이 무른 합성 — 죽음이 아니라 원장의 과잉 계상 취소다(사망 효과 없음). */
  let capRetired = 0;
  for (const u of syn) {
    if (u.d === null || u.d === undefined || u.dk === "morph" || u.dk === "cxl") continue;
    if (u.dk === "cap") { capRetired += 1; continue; }
    synDead += 1;
    let last = null;
    for (let i = u.ev.length - 1; i >= 0; i -= 1) if (u.ev[i][1] >= 0) { last = u.ev[i]; break; }
    const near = last !== null && atk.some((a) => foe(a.o, u.o)
      && Math.abs(a.s - u.d) <= 20 && Math.hypot(a.x - last[1], a.y - last[2]) <= 8);
    if (!near) lonely += 1;
  }

  console.log(`\n${path.split("/").pop()}  ${(endSec / 60).toFixed(1)}분`);
  /* 하차 명령 자체는 커맨드에 그대로 있다 — 이 수가 곧 '드랍을 몇 번 했나'다.
     탑승 증거가 이보다 한참 적으면, 화면에서는 배가 내리는 장면 없이 유닛이 제 발로
     걸어 다닌다(지적: "수송선에서 내리는 일 없음"). */
  const unloadCmds = (res.Commands?.Cmds ?? []).filter((c) => {
    const t2 = nm(c.Type);
    if (t2 === "Unload" || t2 === "Unload All") return true;
    const o2 = c.Order && typeof c.Order === "object" ? c.Order.Name : c.Order;
    return o2 === "MoveUnload";
  }).length;
  console.log(`  수송선 ${ships.length}기 · 하차 명령 ${unloadCmds}번 · 탑승 증거 ${spans.length}건`);
  if (board) {
    console.log(`  승선 후보 ${board.cand}건이 걸러지는 자리 — 표적이 수송선이 아님 ${board.noTrans}`
      + ` · 승객 자리가 수송선 ${board.riderTrans} · 생애 못 찾음 ${board.noLife}`
      + ` · 승객 정체가 수송선 ${board.isTrans} · **하차 기록 없음 ${board.noDrop}** → 통과 ${board.pass}`);
  }
  {
    /* 못 내린 승객이 어떻게 끝나나 — 배가 격추되면 함께 죽어야 한다(원작). 아무 일도
       없으면 화면에서 조용히 사라지고 인구 셈에만 남아, 애먼 합성이 대신 물린다. */
    const sunk = open.filter((s2) => s2.e.d !== null && s2.e.d !== undefined).length;
    console.log(`  탑승 구간이 닫힌 방식 — 하차 ${byOff.length}건 · 제 명령 ${byOwn.length}건`
      + ` · 끝내 안 닫힘 ${open.length}건(그중 배와 함께 죽은 것 ${sunk}건)`);
  }
  console.log(`  태우고 내릴 때까지(하차로 닫힌 것) 중앙값 ${med(byOff.map((s) => Math.round(s.to - s.from)))}초`
    + ` · 제 명령으로 닫힌 것 중앙값 ${med(byOwn.map((s) => Math.round(s.to - s.from)))}초`);
  {
    /* 배 안에 있던 시간의 분포 — 진짜 드랍은 십수 초다. 오른쪽 꼬리가 두꺼우면 승선과
       엉뚱한 하차를 짝지어 승객이 한참 사라져 있는 것이다. */
    const cut = [10, 20, 40, 80, 160, Infinity];
    const lab = ["~10", "~20", "~40", "~80", "~160", "160+"];
    const b2 = new Array(cut.length).fill(0);
    for (const s2 of byOff) {
      const dt = s2.to - s2.from;
      b2[cut.findIndex((c) => dt <= c)] += 1;
    }
    console.log(`  배 안에 있던 시간(초): ${b2.map((n, i) => `${lab[i]} ${n}`).join(" · ")}`);
  }
  {
    /* 배의 자리 — 증거 사이를 잇는 선형 보간. 재생기의 posAt과 같은 규칙이라,
       "그때 화면에서 배가 어디 있었나"를 그대로 되짚는다. */
    /* 태그는 재사용된다 — 한 태그에 여러 생애가 있으면 **그 시각에 살아 있던 생애**의
       자취를 봐야 한다(마지막 것만 남기면 옛 주인 자리를 재게 된다). */
    const trackOf = new Map();
    for (const e of d.ents) {
      const pts = e.ev.filter((v) => v[1] >= 0).map((v) => [v[0], v[1], v[2]]).sort((a, b) => a[0] - b[0]);
      if (pts.length === 0) continue;
      const a = trackOf.get(e.t) ?? [];
      a.push({ b: e.b, d: e.d ?? Infinity, pts });
      trackOf.set(e.t, a);
    }
    for (const a of trackOf.values()) a.sort((x, y) => x.b - y.b);
    const posAt9 = (tag, t) => {
      const lives = trackOf.get(tag);
      if (!lives || lives.length === 0) return null;
      let pick = lives[0];
      for (const l of lives) { if (l.b <= t + 1) pick = l; else break; }
      const pts = pick.pts;
      if (!pts || pts.length === 0) return null;
      if (t <= pts[0][0]) return [pts[0][1], pts[0][2]];
      if (t >= pts[pts.length - 1][0]) return [pts[pts.length - 1][1], pts[pts.length - 1][2]];
      let i = 0;
      while (i + 1 < pts.length && pts[i + 1][0] < t) i += 1;
      const [t0, x0, y0] = pts[i];
      const [t1, x1, y1] = pts[i + 1];
      const k = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
      return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k];
    };
    /** 유닛 최고 속도(타일/초) — 어림이라도 '순간이동'을 가르기엔 넉넉하다. */
    const TOP = {
      Marine: 4.0, Firebat: 4.0, Ghost: 4.0, Medic: 4.0, SCV: 4.9, Vulture: 6.4,
      Goliath: 4.6, "Siege Tank": 4.3, "Siege Tank (Tank Mode)": 4.3,
      Probe: 4.9, Zealot: 3.4, "High Templar": 3.3, "Dark Templar": 5.0,
      Dragoon: 5.0, Archon: 5.0, "Dark Archon": 5.0, Reaver: 1.8,
      Drone: 5.0, Zergling: 5.5, Hydralisk: 3.7, Defiler: 4.0, Lurker: 5.5, Ultralisk: 5.9,
    };
    const gapPos = [];
    const walkSpd = [];
    for (const s2 of spans) {
      if (s2.how === "하차" && s2.host) {
        const sp = posAt9(s2.host, s2.to);
        const off = s2.e.ev.find((v) => v[3] === 13 && Math.abs(v[0] - s2.to) < 0.01);
        if (sp && off) {
          const g9 = Math.round(Math.hypot(sp[0] - off[1], sp[1] - off[2]) * 10) / 10;
          gapPos.push(g9);
          if (process.env.DROP_DEBUG && g9 > 2) {
            console.log(`     [먼 하차] ${s2.e.k}#${s2.e.t} 배#${s2.host} 승선 ${Math.round(s2.from)} 하차 ${s2.to}`
              + ` 승객(${off[1]},${off[2]}) 배(${sp[0].toFixed(1)},${sp[1].toFixed(1)}) = ${g9}타일`);
          }
        }
      }
      const bev = s2.e.ev.find((v) => v[3] === 12 && Math.abs(v[0] - s2.from) < 0.01);
      const prev = [...s2.e.ev].filter((v) => v[1] >= 0 && v[0] < s2.from).pop();
      if (bev && prev) {
        const dt = s2.from - prev[0];
        const dd = Math.hypot(bev[1] - prev[1], bev[2] - prev[2]);
        const top = TOP[s2.e.k] ?? 4.5;
        walkSpd.push(dt <= 0.01 ? (dd > 0.5 ? 99 : 0) : Math.round((dd / dt / top) * 100) / 100);
      }
    }
    const over9 = walkSpd.filter((v) => v > 1.15).length;
    console.log(`  내리는 자리와 배 사이(타일) 중앙값 ${med(gapPos)} · 최대 ${gapPos.length ? Math.max(...gapPos) : 0}`);
    console.log(`  타러 가는 걸음 — 제 최고 속도 대비 중앙값 ${med(walkSpd)}배 · 넘긴 것 ${over9}/${walkSpd.length}건`);
  }
  {
    /* 트립 — 한 배가 한 번 실어 나른 무리. 원작의 수송칸은 8이고(벙커 4) 유닛마다
       차지하는 자리가 다르다. 넘치는 트립이 있으면 태우지 못할 것을 태운 것이다. */
    const SPACE = {
      Marine: 1, Firebat: 1, Ghost: 1, Medic: 1, SCV: 1, Vulture: 2,
      Goliath: 4, "Siege Tank": 4, "Siege Tank (Tank Mode)": 4, "Siege Tank (Siege Mode)": 4,
      Probe: 1, Zealot: 2, "High Templar": 2, "Dark Templar": 2,
      Dragoon: 4, Archon: 4, "Dark Archon": 4, Reaver: 4,
      Drone: 1, Zergling: 1, Broodling: 1, "Infested Terran": 1,
      Hydralisk: 2, Defiler: 2, Lurker: 4, Ultralisk: 8,
    };
    const kindOfTag = new Map(d.ents.map((e) => [e.t, e.k]));
    /* 트립은 '한 배가 한 번 쏟은 무리'다. 타는 시각으로 묶으면 배까지 걸어간 시간이
       저마다 달라 쪼개지고, 내리는 시각으로 묶어도 줄서기(0.756초 간격) 때문에 쪼개진다.
       그래서 배마다 하차 시각을 늘어놓고 **1.5초보다 벌어지는 곳에서 끊는다**. */
    const trips = new Map();
    {
      const byHost = new Map();
      for (const s2 of spans) {
        const g = byHost.get(s2.host) ?? [];
        g.push(s2);
        byHost.set(s2.host, g);
      }
      for (const [h, g] of byHost) {
        g.sort((a, b) => a.to - b.to);
        let n = 0;
        let prev = null;
        for (const s2 of g) {
          if (prev !== null && s2.to - prev > 1.5) n += 1;
          prev = s2.to;
          const key = `${h}|${n}`;
          const t9 = trips.get(key) ?? [];
          t9.push(s2);
          trips.set(key, t9);
        }
      }
    }
    let over = 0;
    const loads = [];
    const gaps = [];
    for (const g of trips.values()) {
      const slots = kindOfTag.get(g[0].host) === "Bunker" ? 4 : 8;
      const load = g.reduce((n, s2) => n + (SPACE[s2.e.k] ?? 2), 0);
      loads.push(load);
      if (load > slots) over += 1;
      const outs = g.filter((s2) => s2.how === "하차").map((s2) => s2.to).sort((a, b) => a - b);
      for (let i = 1; i < outs.length; i += 1) gaps.push(Math.round((outs[i] - outs[i - 1]) * 100) / 100);
    }
    console.log(`  트립 ${trips.size}개 · 적재 자리 중앙값 ${med(loads)}/8 · 최대 ${loads.length ? Math.max(...loads) : 0}`
      + ` · **정원 넘긴 트립 ${over}개**`);
    console.log(`  하차 줄서기 — 같은 배에서 잇달아 내린 간격 중앙값 ${med(gaps)}초 (원작 0.756초)`);
  }
  console.log(`  유닛 ${units.length}기 중 합성 ${syn.length}기 (${Math.round((syn.length / Math.max(1, units.length)) * 100)}%)`);
  console.log(`  복제품 후보(배 안인데 땅에 같은 종류 합성) ${twins}건 / 탑승 ${spans.length}건`);
  console.log(`  죽은 합성 ${synDead}기 중 곁에 적 공격이 없던 죽음 ${lonely}기 (${synDead ? Math.round((lonely / synDead) * 100) : 0}%)`
    + ` · 인구 상한이 무른 합성 ${capRetired}기(사망 효과 없음)`);
}
console.log("");
