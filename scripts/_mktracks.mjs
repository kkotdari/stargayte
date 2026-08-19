import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "mk-"));
const src = join(dir, "e.ts"); const out = join(dir, "e.mjs");
writeFileSync(src, `export { buildUnitTracks } from ${JSON.stringify(join(ROOT, "src/utils/replayUnits"))};`);
execFileSync("npx", ["esbuild", src, "--bundle", "--platform=node", "--format=esm", "--log-level=error", `--outfile=${out}`], { cwd: ROOT, stdio: ["ignore","ignore","inherit"] });
const { buildUnitTracks } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });
const { default: Screp } = await import("screp-js");
const nm = (v) => (typeof v === "string" ? v : v?.Name ?? "");
const RACE = { Terran: "테란", Protoss: "프로토스", Zerg: "저그" };
const [inp, outp] = process.argv.slice(2);
const res = await Screp.parseBuffer(new Uint8Array(readFileSync(inp)), { cmds: true, mapData: true, mapTiles: true, mapResLoc: true });
const spots = new Map((res.MapData?.StartLocations ?? []).map((sp) => [sp.SlotID, sp]));
const players = (res.Header.Players ?? []).filter((p) => !p.Observer && nm(p.Type) !== "Observer").map((p) => {
  const sp = spots.get(p.SlotID);
  return { id: p.ID, name: p.Name, race: RACE[nm(p.Race)] ?? "", team: typeof p.Team === "number" ? p.Team : null,
    startX: sp ? sp.X/32 : null, startY: sp ? sp.Y/32 : null };
});
const d = buildUnitTracks(res.Commands?.Cmds ?? [], players);
writeFileSync(outp, JSON.stringify(d));
console.log(outp, "ents", d.ents.length);
