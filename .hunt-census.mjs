import fs from 'fs';
const Screp = (await import('screp-js')).default;
const T='/Users/kkotdari/workspace/stargayte/temp/';
const REPS=[
 ['151231', T+'151231_235017_SilenTkoN_uniQuestyLe_TealSilverSteal_SturgeonaV_xSMenace EOeAbkaZt7s3g9pnVqkWb_Wo3z2w1Qj4E0cVjxzUmRE.rep'],
 ['251108', T+'251108_152835_ImbaTerraN_Welli_Fancerr_Zoobie_achoraoo_gogosharu gK-IsYHjjNytqhNbA0pZ8-0lc9kBnpDmzwUS1k4yjTE.rep'],
 ['SG1333', T+'SG_26081613330800.rep'],
 ['SG2359', T+'SG_26081623590300.rep'],
 ['DJKisoo', T+'[26080219480200] DJKisoo,Sohee_Min,ccumputer VS ------..------,forge_saygay (New Super빠른무한).rep'],
 ['BT', T+'[26080922230400] ------..------,TodayDalsu,jediknight81,ccumputer VS [Jeong9],100000g,gun_beom,Taschen_Ever (Super빠른무한 BT).rep'],
];
const out={};
for (const [name,path] of REPS){
  const buf=new Uint8Array(fs.readFileSync(path));
  const res=await Screp.parseBuffer(buf,{header:true,computed:true,mapData:true,cmds:true});
  const h=res.Header, cmds=res.Commands.Cmds;
  const o={name};
  o.engine=h.Engine.Name; o.frames=h.Frames; o.minutes=+(h.Frames/23.81/60).toFixed(1);
  o.gameType=h.Type.Name+'('+h.Type.ID+')'; o.subType=h.SubType;
  o.map=h.Map; o.mapSize=h.MapWidth+'x'+h.MapHeight; o.speed=h.Speed.Name;
  o.players=h.Players.map(p=>`${p.Name}[${p.Race.ShortName}|T${p.Team}|S${p.SlotID}]`);
  o.nPlayers=h.Players.length;
  const teams={}; h.Players.forEach(p=>teams[p.Team]=(teams[p.Team]||0)+1);
  o.teams=teams;
  const races={}; h.Players.forEach(p=>races[p.Race.ShortName]=(races[p.Race.ShortName]||0)+1);
  o.races=races;
  // map data
  const md=res.MapData||{};
  o.mapDataKeys=Object.keys(md);
  o.mdTitle=md.Title; o.mdVersion=md.Version; o.mdTileSet=md.TileSet&&md.TileSet.Name;
  if (md.PlacedUnits) o.placedUnits=md.PlacedUnits.length;
  // command histograms
  const ct={},trains={},morphs={},builds={},bmorphs={},techs={},upgs={},orders={};
  for (const c of cmds){
    ct[c.Type.Name]=(ct[c.Type.Name]||0)+1;
    if(c.Type.ID===31&&c.Unit) trains[c.Unit.Name]=(trains[c.Unit.Name]||0)+1;
    if(c.Type.ID===35&&c.Unit) morphs[c.Unit.Name]=(morphs[c.Unit.Name]||0)+1;
    if(c.Type.ID===12&&c.Unit) builds[c.Unit.Name]=(builds[c.Unit.Name]||0)+1;
    if(c.Type.ID===53&&c.Unit) bmorphs[c.Unit.Name]=(bmorphs[c.Unit.Name]||0)+1;
    if(c.Type.ID===48&&c.Tech) techs[c.Tech.Name]=(techs[c.Tech.Name]||0)+1;
    if(c.Type.ID===50&&c.Upgrade) upgs[c.Upgrade.Name]=(upgs[c.Upgrade.Name]||0)+1;
    if(c.Order) orders[c.Order.Name]=(orders[c.Order.Name]||0)+1;
  }
  o.cmdTypes=ct; o.trains=trains; o.unitMorphs=morphs; o.builds=builds;
  o.buildingMorphs=bmorphs; o.techs=techs; o.upgrades=upgs; o.orders=orders;
  o.totalCmds=cmds.length;
  // first-frame of each interesting thing
  const first={};
  for (const c of cmds){
    const keys=[];
    if(c.Type.ID===31&&c.Unit) keys.push('train:'+c.Unit.Name);
    if(c.Type.ID===35&&c.Unit) keys.push('morph:'+c.Unit.Name);
    if(c.Type.ID===12&&c.Unit) keys.push('build:'+c.Unit.Name);
    if(c.Type.ID===53&&c.Unit) keys.push('bmorph:'+c.Unit.Name);
    if(c.Type.ID===48&&c.Tech) keys.push('tech:'+c.Tech.Name);
    if(c.Order) keys.push('order:'+c.Order.Name);
    keys.push('cmd:'+c.Type.Name);
    for(const k of keys) if(first[k]===undefined) first[k]=c.Frame;
  }
  o.first=first;
  out[name]=o;
}
fs.writeFileSync('/tmp/hunt-stats/census.json', JSON.stringify(out,null,1));
console.log('done');
