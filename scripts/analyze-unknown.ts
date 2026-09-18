// Offline: node scripts/analyze-unknown.ts
import fs from 'node:fs';
const base=JSON.parse(fs.readFileSync('data/normalized/schedule-2026-09-21-BKB-SWM.json','utf8'));
const details=base.unknownParticipation.map((n:any)=>{
 const raw=JSON.parse(fs.readFileSync(n.source.raw_file,'utf8'));
 const row=raw.find((r:any)=>r.Key===n.unitId&&r.Disc===n.disciplineCode);
 if(!row)throw Error('Missing raw row '+n.id);
 return {id:n.id,event:row.Event,key:row.Key,orgs:row.Orgs,status:row.Status,resCode:row.ResCode,
 isAlt:row.IsAlt,showLink:row.ShowLink,category:row.Phase.endsWith('.VICT')?'ceremony':row.Phase.endsWith('.HEAT')?'heat':'final',
 participantFields:Object.keys(row).filter(k=>/org|noc|competitor|athlete|home|away|member/i.test(k)),rawFile:n.source.raw_file};
});
const counts={total:details.length,events:new Set(details.map((r:any)=>r.event)).size,
 heats:details.filter((r:any)=>r.category==='heat').length,finals:details.filter((r:any)=>r.category==='final').length,
 ceremonies:details.filter((r:any)=>r.category==='ceremony').length};
fs.writeFileSync('outputs/phase2-offline-inventory.json',JSON.stringify({counts,details},null,2)+'\n');
console.log(JSON.stringify(counts));
