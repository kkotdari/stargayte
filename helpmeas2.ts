/* 같은 편 사람의 명령이 아군 본진 반경 안에 얼마나 몰렸나 — 짝마다 전체 경기로 센다.
   '도우러 갔다'를 어느 값에서 끊을지 정하려고 분포를 본다. */
import { readFileSync, readdirSync } from "node:fs";
import { parseReplayFile } from "./src/utils/replayParser";

const DIR = "/root/.claude/uploads/53242f3e-572a-56a1-939c-90f0639744ef";
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const main = async () => {
  for (const f of readdirSync(DIR).filter((n) => n.endsWith(".rep")).sort()) {
    const parsed = await parseReplayFile(new File([new Uint8Array(readFileSync(`${DIR}/${f}`))], f));
    const sides = [parsed.team1, parsed.team2];
    if (parsed.team1.length + parsed.team2.length < 4) continue;
    console.log(`\n${f.slice(0, 10)} (${parsed.team1.length}v${parsed.team2.length})`);
    for (const side of sides) {
      for (const me of side) {
        for (const ally of side) {
          if (me.rawName === ally.rawName) continue;
          if (me.startX === null || ally.startX === null || ally.startY === null || me.startY === null) continue;
          const home = { x: ally.startX, y: ally.startY };
          const mine = { x: me.startX, y: me.startY };
          const base = dist(home, mine);
          const r = base * 0.45;
          const os = me.signals?.orderPositions ?? [];
          const near = os.filter((o) => dist(o, home) < r);
          // 자기 집 반경 안은 뺀다 — 두 집이 가까우면 자기 집 클릭이 섞인다.
          const own = near.filter((o) => dist(o, mine) < r).length;
          const only = near.length - own;
          if (only >= 15) {
            console.log(`  ${me.rawName} → ${ally.rawName}: 아군집근처 ${near.length} (자기집제외 ${only}) / 전체 ${os.length}, 집간거리 ${base.toFixed(0)} r=${r.toFixed(0)}`);
          }
        }
      }
    }
  }
};
void main();
