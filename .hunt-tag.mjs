import fs from 'fs';
const Screp=(await import('screp-js')).default;
const path=process.argv[2], tag=+process.argv[3], f0=+process.argv[4], f1=+process.argv[5];
const res=await Screp.parseBuffer(new Uint8Array(fs.readFileSync(path)),{header:false,computed:false,cmds:true});
for(const c of res.Commands.Cmds){
  if(c.Frame<f0||c.Frame>f1) continue;
  const tags=[]; if(c.UnitTags) tags.push(...c.UnitTags); if(c.UnitTag!==undefined) tags.push(c.UnitTag);
  if(tags.includes(tag)) console.log(JSON.stringify(c));
}
