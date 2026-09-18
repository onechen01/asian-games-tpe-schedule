import {readFile} from 'node:fs/promises';
import {get,ApiError} from '../src/api/asianGames.ts';
import {save} from '../src/utils/storage.ts';
const baseline=JSON.parse(await readFile('data/normalized/schedule-2026-09-21-BKB-SWM.json','utf8'));
const rows=baseline.unknownParticipation;
const sample=process.argv[2]==='relay' ? rows.find((r:any)=>r.eventId.includes('4X')) : rows[0];
const kind=process.argv[3] || 'event';
if(!['event','unit','results'].includes(kind))throw Error('Invalid probe kind');
const path=kind==='event' ? 'SWM/schedule/event/'+sample.eventId : 'SWM/'+(kind==='unit'?'schedule/unit/':'results/')+sample.unitId;
try{
 const response=await get(path,{conditional:false});
 await save('outputs/phase2-'+process.argv[2]+'-'+kind+'.json',{sampleId:sample.id,path,...response});
 const d=response.data as any;
 console.log(JSON.stringify({path,meta:response.meta,type:Array.isArray(d)?'array':typeof d,keys:Object.keys(d||{}),
 summary:Array.isArray(d)?d.map((r:any)=>({Key:r.Key,Orgs:r.Orgs,ResCode:r.ResCode,Status:r.Status,keys:Object.keys(r)})):d},null,2));
}catch(e){console.error(JSON.stringify(e instanceof ApiError?e.details:String(e)));process.exitCode=1;}

