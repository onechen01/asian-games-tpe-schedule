// One bounded probe: node scripts/probe-athlete-schema.ts
// Source: official daily page 2026-09-18, visible Men's Individual Semi-final Swimming results link.
import {decode,saveRaw,recordFailure,BASE} from '../src/api/asianGames.ts';
import {save} from '../src/utils/storage.ts';
const path='MPN/results/M.INDIVID-----------.SFNL.0001SW00';
const sourcePage='https://results.asiangames2026.org/#/discipline/MPN/results/M.INDIVID-----------.SFNL.0001SW00';
let status:number|null=null;
try{
 const started=performance.now();
 const r=await fetch(BASE+path,{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});
 status=r.status;
 const meta={url:BASE+path,sourcePage,http_status:status,content_type:r.headers.get('content-type'),fetchedAt:new Date().toISOString(),etag:r.headers.get('etag')};
 if(!r.ok){await r.body?.cancel();throw Error('HTTP '+status)}
 if(!meta.content_type?.includes('application/json')){await r.body?.cancel();throw Error('Non-JSON Content-Type: '+meta.content_type)}
 const bytes=Buffer.from(await r.arrayBuffer()),decoded=decode(bytes);
 const rawFile=await saveRaw(path,decoded,meta);
 const d=decoded.data as any;
 const summary={...meta,rawFile,elapsedMs:Math.round(performance.now()-started),bytes:bytes.length,encoding:decoded.encoding,
 topLevelKeys:Object.keys(d||{}),info:d.Info,resultsKeys:Object.keys(d.Results||{}),
 competitorCount:Array.isArray(d.Competitors)?d.Competitors.length:null,
 competitorKeys:Array.isArray(d.Competitors)?[...new Set(d.Competitors.flatMap((c:any)=>Object.keys(c)))]:[],
 competitors:Array.isArray(d.Competitors)?d.Competitors.map((c:any)=>Object.fromEntries(Object.entries(c).filter(([k])=>!['Stats','Extensions','Splits'].includes(k)))):null};
 await save('outputs/individual-athlete-probe.json',summary);
 console.log(JSON.stringify(summary,null,2));
}catch(e){
 const failure=await recordFailure(BASE+path,status,e);
 await save('outputs/individual-athlete-probe-error.json',failure);
 console.error(JSON.stringify(failure));process.exitCode=1;
}

