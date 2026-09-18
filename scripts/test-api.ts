// npm run health -- [verified-path] [--revalidate]
import { get, ApiError } from '../src/api/asianGames.ts';
import { save } from '../src/utils/storage.ts';
const path = process.argv.slice(2).find(x=>!x.startsWith('--')) || 'SWM/schedule/daily/2026-09-20';
try {
  const first = await get(path,{conditional:false});
  const conditional = process.argv.includes('--revalidate') ? (await get(path)).meta : null;
  const data = first.data;
  const result = { ok:true,path,first:first.meta,conditional,
    shape:Array.isArray(data) ? { type:'array',rows:data.length,firstRowKeys:Object.keys(data[0] || {}) } :
      {type:typeof data,keys:data && typeof data==='object' ? Object.keys(data) : []} };
  await save('outputs/api-health-v2.json',result);
  console.log(JSON.stringify(result,null,2));
} catch(e) {
  const result = { ok:false, path, error:e instanceof ApiError ? e.details : String(e) };
  await save('outputs/api-health-v2.json',result);
  console.error(JSON.stringify(result,null,2));
  process.exitCode = 1;
}
