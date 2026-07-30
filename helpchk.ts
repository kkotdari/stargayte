import { readFileSync, readdirSync } from "node:fs";
import { parseReplayFile } from "./src/utils/replayParser";
import { buildReplaySummary } from "./src/utils/replaySummary";
import { renderReplaySummarySentences } from "./src/utils/replaySummaryText";

const DIR = "/root/.claude/uploads/53242f3e-572a-56a1-939c-90f0639744ef";
const main = async () => {
  for (const f of readdirSync(DIR).filter((n) => n.endsWith(".rep")).sort()) {
    const buf = readFileSync(`${DIR}/${f}`);
    const parsed = await parseReplayFile(new File([new Uint8Array(buf)], f));
    const sum = buildReplaySummary(parsed);
    if (!sum) continue;
    const help = (sum.beats ?? []).filter((b) => b.k === "ally-help");
    const lines = renderReplaySummarySentences(sum, (r) => r, () => undefined) ?? [];
    const last = lines[lines.length - 1];
    const lastBeats = (last?.beats ?? []).map((i) => sum.beats?.[i]?.k);
    console.log(`\n${f.slice(0, 10)} 문장 ${lines.length}개 · 아군지원 ${help.length}건`);
    help.forEach((b) => console.log(`  헬프: ${b.who?.join(",")} → ${b.whom?.join(",")}`));
    console.log(`  마지막 문장 beat: ${JSON.stringify(lastBeats)}`);
    console.log(`  마지막 문장: ${last?.parts.map((p) => p.text).join("")}`);
  }
};
void main();
