// npm run fetch:broadcasts -- --provider=elta [--dry-run] [--dates=2026-09-21,...]
// Fetches one provider's published schedule, checks it, and replaces only that provider's
// records in data/reference/broadcasts.json. Other providers are never touched, and a batch
// that fails the gate leaves the stored records exactly as they were.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { save, ROOT } from '../src/utils/storage.ts';
import { extractScheduleList, toBroadcasts, gateBroadcasts, PROVIDER } from '../src/broadcast/elta.ts';
import type { BroadcastRecord } from '../src/broadcast/elta.ts';

const argv = process.argv.slice(2);
const provider = argv.find(a=>a.startsWith('--provider='))?.slice('--provider='.length) ?? 'elta';
const dryRun = argv.includes('--dry-run');
const dates = argv.find(a=>a.startsWith('--dates='))?.slice('--dates='.length).split(',');
if (provider !== PROVIDER.providerId) throw new Error(`No adapter for provider ${provider}`);

const FILE = 'data/reference/broadcasts.json';
const doc = JSON.parse(await readFile(resolve(ROOT,FILE),'utf8')) as
  { schemaVersion:number; records:BroadcastRecord[] } & Record<string,unknown>;
const others = doc.records.filter(r=>r.providerId !== provider);
const previous = doc.records.filter(r=>r.providerId === provider);

const response = await fetch(PROVIDER.sourceUrl,{ headers:{ Accept:'text/html' },
  redirect:'follow', signal:AbortSignal.timeout(20000) });
if (!response.ok) { console.error(`${provider} fetch failed: HTTP ${response.status}；保留既有資料`); process.exit(1); }
const html = await response.text();

// Verified Chinese names only; an unverified one must never decide a match.
const master = JSON.parse(await readFile(resolve(ROOT,'data/reference/tpe-athlete-master.json'),'utf8')) as
  { athletes?:{ zh?:string; officialEn?:string; confidence?:string }[] };
const athletesByZh = new Map((master.athletes ?? [])
  .filter(a=>a.confidence === 'VERIFIED' && a.zh && a.officialEn)
  .map(a=>[a.zh as string, a.officialEn as string]));

// Opponent names are matched against the same Chinese NOC table the site displays.
const nocDoc = JSON.parse(await readFile(resolve(ROOT,'data/reference/noc-zh.json'),'utf8')) as
  { orgs?:Record<string,string> } & Record<string,unknown>;
const orgs = (nocDoc.orgs ?? nocDoc) as Record<string,string>;
const nocByZh = Object.fromEntries(Object.entries(orgs)
  .filter(([,zh])=>typeof zh === 'string').map(([code,zh])=>[zh,code]));

let batch;
try { batch = toBroadcasts(extractScheduleList(html),
  { capturedAt:new Date().toISOString().slice(0,10), dates, athletesByZh, nocByZh }); }
catch (error) {
  console.error(`${provider} parse failed: ${(error as Error).message}；保留既有資料`);
  process.exit(1);
}
const gate = gateBroadcasts(batch.records, previous);
const same = JSON.stringify(batch.records.map(r=>({...r,capturedAt:null})))
  === JSON.stringify(previous.map(r=>({...r,capturedAt:null})));

console.log(`${PROVIDER.providerName} fetched ${batch.records.length + batch.unresolved.length}`);
console.log(`accepted ${batch.records.length}`);
console.log(`unresolved ${batch.unresolved.length}`);
for (const u of batch.unresolved.slice(0,10)) console.log(`  - ${u.time ?? '--'} ${u.title} [${u.reason}]`);
console.log(`gate ${gate.pass ? 'pass' : 'hold: ' + gate.reasons.join(', ')}`);
console.log(same ? 'no-change' : 'changed');
if (dryRun) { console.log('dry run：未寫入任何檔案'); process.exit(0); }
if (!gate.pass) { console.error('品質檢查未通過，保留上一版 records'); process.exit(1); }
if (same) process.exit(0);
await save(FILE, { ...doc, records:[...others, ...batch.records] });
console.log(`保存：${FILE}（${provider} ${batch.records.length} 筆，其他 provider ${others.length} 筆保留）`);
