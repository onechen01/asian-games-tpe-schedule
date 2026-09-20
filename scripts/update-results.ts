// npm run update:results [-- --discovery] [--dates 2026-09-20,2026-09-21]
// The unattended updater. It never writes production canonical directly: every day is
// rebuilt in a staging directory, checked, and only then swapped in. A day that fails the
// check keeps whatever production already had.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { save, ROOT } from '../src/utils/storage.ts';
import { qualityGate, changed, isAutomationFailure, runExitCode } from '../src/parsers/publish-gate.ts';
import { nextDay } from '../src/utils/timezone.ts';

// The official schedule matrix spans these venue days; outside them the Games are over and
// the updater exits without a single request.
const GAMES_FIRST = '2026-09-10', GAMES_LAST = '2026-10-04';
const taipeiToday = ()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',
  year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shift = (date:string,days:number)=>new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);

const argv = process.argv.slice(2);
const discovery = argv.includes('--discovery');
const explicit = argv.find(a=>a.startsWith('--dates='))?.slice('--dates='.length);
const today = taipeiToday();
if (!explicit && (today < GAMES_FIRST || today > GAMES_LAST)) {
  console.log(`今天 ${today} 不在亞運期間（${GAMES_FIRST}～${GAMES_LAST}），不發送任何請求。`);
  process.exit(0);
}
// Live refresh covers results, status, opponents and time changes around now; discovery
// walks the rest of the Games so a newly published Taiwan match appears on its own.
const live = [shift(today,-1), today, shift(today,1)].filter(d=>d >= GAMES_FIRST && d <= GAMES_LAST);
const future:string[] = [];
for (let d = shift(today,2); d <= GAMES_LAST; d = nextDay(d)) future.push(d);
const dates = explicit ? explicit.split(',') : discovery ? [...live, ...future] : live;

const run = (script:string, args:string[], env:Record<string,string> = {})=>
  spawnSync(process.execPath,[script,...args],{cwd:ROOT,env:{...process.env,...env},encoding:'utf8'});
const read = async (relative:string)=>{
  try { return JSON.parse(await readFile(resolve(ROOT,relative),'utf8')); } catch { return null; }
};

// A fresh checkout has none of the generated inputs (they are gitignored), so the updater
// fetches them itself instead of assuming a working copy that has been used before.
const REQUIRED_INPUTS:[string,string][] = [
  ['data/normalized/disciplines.json','scripts/fetch-disciplines.ts'],
  ['data/normalized/tpe-entries.json','scripts/fetch-entries.ts'],
];
for (const [file, script] of REQUIRED_INPUTS) {
  if (existsSync(resolve(ROOT,file)) && await read(file)) continue;
  console.log(`缺少 ${file}，先向官方取得（${script}）。`);
  const built = run(script,[]);
  const tail = (out?:string)=>(out ?? '').trim().slice(-600);
  console.log(`  ${script} exit=${built.status}`);
  if (tail(built.stdout)) console.log(`  stdout: ${tail(built.stdout)}`);
  if (tail(built.stderr)) console.error(`  stderr: ${tail(built.stderr)}`);
  const exists = existsSync(resolve(ROOT,file));
  console.log(`  ${file} exists=${exists}`);
  if (built.status !== 0 || !exists || !(await read(file))) {
    console.error(`bootstrap 失敗，無法產生 ${file}；不進入每日更新。`);
    process.exit(1);
  }
}

// Medal totals ride along with the existing run: no new scheduler, and a failure here never
// affects canonical publishing.
const medals = run('scripts/fetch-medals.ts',[]);
console.log(`獎牌榜 ${medals.status === 0 ? '已更新' : '取得失敗，保留既有資料'}`);

const published:string[] = [], held:{date:string;reasons:string[]}[] = [], unchanged:string[] = [];
for (const date of dates) {
  const stage = `data/staging/${date}`;
  const env = { SCHEDULE_OUT_DIR:stage, DAILY_OUT_DIR:stage };
  const fetched = run('scripts/fetch-schedule.ts',[date,'AUTO'],env);
  // fetch-schedule exits non-zero when any endpoint failed, but it still writes what it got.
  // The merge runs anyway so the gate can name the real reason instead of "no file".
  const schedule = await read(`${stage}/schedule-${date}-AUTO.json`);
  const merged = schedule ? run('scripts/merge-daily.ts',[date],env) : null;
  const daily = merged?.status === 0 ? await read(`${stage}/daily-${date}.json`) : null;
  const gate = qualityGate({ daily, schedule });
  if (!gate.pass) {
    // When nothing was produced, the child's own message is the only explanation there is,
    // so it is always carried into the log instead of being reduced to "daily-missing".
    const child = schedule ? merged : fetched;
    const why = (child?.stderr || child?.stdout || '').trim().slice(-400);
    const broken = !schedule || !daily;
    const label = !schedule ? `fetch-failed(exit ${fetched.status})` : `merge-failed(exit ${merged?.status})`;
    held.push({ date, reasons:broken ? [...gate.reasons, `${label}: ${why}`] : gate.reasons });
    await rm(resolve(ROOT,stage),{recursive:true,force:true});
    continue;
  }
  const current = await read(`data/normalized/daily-${date}.json`);
  if (!changed(daily,current)) {
    unchanged.push(date);
    await rm(resolve(ROOT,stage),{recursive:true,force:true});
    continue;
  }
  // save() writes to a temp file and renames, so production never holds a half-written day.
  await save(`data/normalized/schedule-${date}-AUTO.json`, schedule);
  await save(`data/normalized/daily-${date}.json`, daily);
  published.push(date);
  await rm(resolve(ROOT,stage),{recursive:true,force:true});
}
await rm(resolve(ROOT,'data/staging'),{recursive:true,force:true});

console.log(`更新範圍：${dates.join('、')}${discovery ? '（含未來賽程探索）' : ''}`);
console.log(`已發布 ${published.length} 天：${published.join('、') || '無'}`);
console.log(`內容未變動 ${unchanged.length} 天`);
if (held.length) {
  console.error(`品質檢查未通過、保留既有 canonical 的日期：`);
  for (const h of held) console.error(`  ${h.date}  ${h.reasons.join(', ')}`);
}
const automation = held.filter(h=>isAutomationFailure(h.reasons));
if (automation.length) console.error(`其中 ${automation.length} 天是 automation 失敗（不是官方資料不完整）：`
  + automation.map(h=>h.date).join('、'));
// A day held by the quality gate is a safe outcome; a day that never produced anything is not.
console.log(published.length ? 'CHANGED' : 'NO_CHANGE');
process.exitCode = runExitCode(held, dates.length, published.length + unchanged.length);
