// npm run har -- <har-path> [<har-path> ...]
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { BASE, decode, safeData, saveRaw } from '../src/api/asianGames.ts';
import { save } from '../src/utils/storage.ts';
import { normalize } from '../src/parsers/schedule.ts';
import type { Schedule, Source } from '../src/parsers/schedule.ts';

type Entry = { request:{url:string};startedDateTime:string;
  response:{status:number;content:{text?:string;encoding?:string}} };
const paths = process.argv.slice(2);
if (!paths.length) throw new Error('Provide HAR file paths');
const captures:{path:string;source:Source;encoding:string;data:unknown}[] = [];
const summaries = [], observations = new Map<string,Schedule>();
for (const file of paths) {
  const bytes = await readFile(file);
  const har = JSON.parse(bytes.toString('utf8')) as {log:{entries:Entry[]}};
  const summary = {file:basename(file),sha256:createHash('sha256').update(bytes).digest('hex'),
    totalRequests:har.log.entries.length,apiRequests:0,decoded:0,failures:[] as {path:string;error:string}[]};
  for (const entry of har.log.entries) {
    if (!entry.request.url.startsWith(BASE)) continue;
    summary.apiRequests++;
    const path = new URL(entry.request.url).pathname.slice(new URL(BASE).pathname.length);
    try {
      const content=entry.response.content;
      if (!content.text) throw new Error('No saved response body');
      const decoded=decode(content.encoding==='base64' ? Buffer.from(content.text,'base64') : content.text);
      const source:Source={mode:'har_snapshot',file:basename(file),url:BASE+path,
        captured_at:entry.startedDateTime,http_status:entry.response.status,
        note:entry.response.status===304 ? 'Saved HAR body, not a new HTTP response payload' : null};
      if (path!=='config') source.raw_file=await saveRaw(path,decoded,source);
      const data=safeData(path,decoded.data);
      captures.push({path,source,encoding:decoded.encoding,data});
      summary.decoded++;
      const rows=Array.isArray(data) ? data : (data as {phase?:unknown[]})?.phase || [];
      for (const raw of rows) {
        const row=normalize(raw,source),prior=observations.get(row.id);
        if (!prior || String(source.captured_at)>String(prior.source.captured_at)) observations.set(row.id,row);
      }
    } catch(e) {summary.failures.push({path,error:e instanceof Error ? e.message : String(e)});}
  }
  summaries.push(summary);
}
const rows=[...observations.values()].sort((a,b)=>(a.originalStartTime || '').localeCompare(b.originalStartTime || ''));
await save('outputs/har-import-v2.json',{generatedAt:new Date().toISOString(),summaries,captures});
await save('data/normalized/har-schedule.json',{schemaVersion:2,mode:'historical_snapshot',editorialVerification:'pending',
  coverage:'Only rows captured in supplied HAR; not complete Asian Games data',summaries,count:rows.length,
  taiwan:rows.filter(r=>r.hasTpe===true),unknownParticipation:rows.filter(r=>r.hasTpe===null),rows});
console.log(JSON.stringify({summaries,uniqueRows:rows.length,taiwan:rows.filter(r=>r.hasTpe===true).length,
  unknown:rows.filter(r=>r.hasTpe===null).length},null,2));
if (summaries.some(s=>s.failures.length)) process.exitCode=1;
