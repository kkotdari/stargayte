/* 아군 지원이 왜 하나도 안 잡히나 — 실제 숫자를 본다. 각 '당한' beat마다, 같은 편 사람들이
   그 창 안에 아군 본진 반경 안으로 명령을 몇 번 찍었는지 센다. */
import { readFileSync, readdirSync } from "node:fs";
import { parseReplayFile } from "./src/utils/replayParser";
import { buildReplaySummary } from "./src/utils/replaySummary";

const DIR = "/root/.claude/uploads/53242f3e-572a-56a1-939c-90f0639744ef";
const SPF = 0.042;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

const main = async () => {
  for (const f of readdirSync(DIR).filter((n) => n.endsWith(".rep")).sort()) {
    const parsed = await parseReplayFile(new File([new Uint8Array(readFileSync(`${DIR}/${f}`))], f));
    const sum = buildReplaySummary(parsed);
    if (!sum || parsed.team2.length < 2) continue;
    const homes = new Map<string, { x: number; y: number }>();
    for (const p of [...parsed.team1, ...parsed.team2]) {
      if (p.startX !== null && p.startY !== null) homes.set(p.rawName, { x: p.startX, y: p.startY });
    }
    const teamOf = new Map<string, number>();
    parsed.team1.forEach((p) => teamOf.set(p.rawName, 1));
    parsed.team2.forEach((p) => teamOf.set(p.rawName, 2));
    const orders = new Map<string, { frame: number; x: number; y: number }[]>();
    for (const p of [...parsed.team1, ...parsed.team2]) {
      orders.set(p.rawName, p.signals?.orderPositions ?? []);
    }
    const rows: string[] = [];
    for (const b of sum.beats ?? []) {
      const victim = (b.whom ?? [])[0];
      if (!victim || b.at == null || !Number.isFinite(b.at)) continue;
      const vh = homes.get(victim);
      const vt = teamOf.get(victim);
      if (!vh || !vt) continue;
      const mates = [...teamOf].filter(([n, t]) => t === vt && n !== victim).map(([n]) => n);
      const base = Math.min(...mates.map((m) => (homes.get(m) ? dist(vh, homes.get(m)!) : Infinity)));
      const r = base * 0.45;
      const from = (b.at as number) - 60 / SPF;
      const to = (b.at as number) + 240 / SPF;
      const counts = mates.map((m) => {
        const n = (orders.get(m) ?? []).filter((o) => o.frame >= from && o.frame <= to && dist(o, vh) < r).length;
        return `${m}:${n}`;
      });
      rows.push(`  ${b.k} 피해자 ${victim} r=${r.toFixed(0)} → ${counts.join(" ")}`);
    }
    console.log(`\n${f.slice(0, 10)} (${parsed.team1.length}v${parsed.team2.length})`);
    rows.slice(0, 4).forEach((r) => console.log(r));
  }
};
void main();
