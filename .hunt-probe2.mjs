import fs from 'fs';
const Screp = (await import('screp-js')).default;
const buf = new Uint8Array(fs.readFileSync(process.argv[2]));
const res = await Screp.parseBuffer(buf, {header:true, computed:false, mapData:false, cmds:true});
const cmds = res.Commands.Cmds;
console.log('n cmds', cmds.length);
const types = {};
for (const c of cmds) { const k = c.Type.ID+' '+c.Type.Name; types[k]=(types[k]||0)+1; }
console.log(types);
// sample of interesting ones
const seen = new Set();
for (const c of cmds) { if (!seen.has(c.Type.ID)) { seen.add(c.Type.ID); console.log(JSON.stringify(c)); } }
