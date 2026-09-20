// npm run fetch:schedule -- 2026-09-21 [BKB,SWM|ALL|AUTO]
import { get, BASE, ApiError, recordFailure } from '../src/api/asianGames.ts';
import { parseDaily, competitor } from '../src/parsers/schedule.ts';
import { parseMatrix, activeDisciplineDays } from '../src/parsers/matrix.ts';
import type { Schedule, RawCompetitor } from '../src/parsers/schedule.ts';
import { validateDate, nextDay } from '../src/utils/timezone.ts';
import { save, ROOT } from '../src/utils/storage.ts';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Meta, Failure } from '../src/api/asianGames.ts';

const date = validateDate(process.argv[2]);
// Discipline codes come from the official ALL/disc/list index saved by npm run fetch:disciplines,
// never from guessing. Run that first; codes not in the index are rejected.
const indexPath = 'data/normalized/disciplines.json';
let index: { disciplines?:{code?:unknown}[] };
try { index = JSON.parse(await readFile(resolve(ROOT,indexPath),'utf8')); }
catch { throw new Error(`Missing ${indexPath}; run: npm run fetch:disciplines`); }
const known = (index.disciplines ?? []).map(d=>d.code).filter((c):c is string=>typeof c === 'string');
if (!known.length) throw new Error(`${indexPath} has no discipline codes; re-run npm run fetch:disciplines`);
const argument = process.argv[3] || 'BKB,SWM';
// AUTO asks the official schedule matrix which disciplines actually compete, so a day costs
// one small request plus the active disciplines, instead of every discipline blindly.
// A Taiwan day covers two Japanese days, so both are used and the result is their union.
const requests:Meta[] = [];
const days = [date, nextDay(date)];
type Target = { code:string; date:string; medalDay?:boolean };
let matrixNote = '';
// AUTO asks the matrix which discipline competes on which Japanese day and requests only
// those pairs. A day the matrix marks as no competition is skipped, not requested and not
// recorded as a gap. Explicit and ALL keep requesting both Japanese days per discipline.
async function autoTargets(): Promise<Target[]> {
  const { data, meta } = await get('ALL/schedule/matrix');
  requests.push(meta);
  const matrix = parseMatrix(data);
  for (const discipline of matrix.disciplines) officialDays.set(discipline.code, discipline.dates);
  const { targets, unlistedDays } = activeDisciplineDays(matrix, days);
  if (unlistedDays.length) throw new Error(`Matrix has no entry for ${unlistedDays.join(', ')}; refusing to assume no competition`);
  matrixNote = `matrix（日本日期 ${days.join('、')}）判定 ${new Set(targets.map(t=>t.code)).size} 項運動、${targets.length} 個運動×日期組合有賽事`;
  return targets;
}
const officialDays = new Map<string,string[]>();
const auto = argument === 'AUTO' ? await autoTargets() : null;
const sports = auto ? [...new Set(auto.map(t=>t.code))]
  : argument === 'ALL' ? known : [...new Set(argument.split(','))];
const unknownCodes = sports.filter(s=>!known.includes(s));
if (unknownCodes.length) throw new Error(`Not in the official discipline index: ${unknownCodes.join(', ')}`);
const targets: Target[] = auto ?? sports.flatMap(code=>days.map(day=>({ code, date:day })));
const label = argument === 'ALL' || argument === 'AUTO' ? argument : sports.join('-');
type Result = { sourceStatus:unknown; isLive:unknown; currentPeriod:unknown;
  competitors:ReturnType<typeof competitor>[]; source:Meta };
type Row = Schedule & { result?:Result };
const errors:Failure[] = [], rows = new Map<string,Row>(), unresolved:Row[] = [];
type Missing = { kind:'schedule-daily' | 'results'; disciplineCode:string; endpoint:string;
  date?:string; unitId?:string; http_status:number | null; error:string };
const missing:Missing[] = [];
// Units whose official offset is not the venue's; recovered ones are placed correctly, the
// rest stay out of the day and are reported rather than disappearing.
type Anomaly = { disciplineCode:string; date:string; unitId?:string; code:string;
  sourceOffset:string | null; originalStartTime:string | null; recoveredStartTime:string | null };
const anomalies:Anomaly[] = [];
// One endpoint failing is recorded and skipped; the remaining endpoints still run in the
// original order, without retrying the failed one and without changing request spacing.
async function attempt<T>(path:string, run:()=>Promise<T>): Promise<{ok:true;value:T} | {ok:false;failure:Failure}> {
  try { return { ok:true, value:await run() }; }
  catch(e) {
    // get() already recorded HTTP failures; only non-ApiError (e.g. schema change) needs a record.
    const failure = e instanceof ApiError ? e.details : await recordFailure(BASE+path,null,e);
    errors.push(failure);
    return { ok:false, failure };
  }
}
for (const { code:sport, date:day } of targets) {
  {
    const path = `${sport}/schedule/daily/${day}`;
    const outcome = await attempt(path, async()=>{
      const {data,meta} = await get(path);
      requests.push(meta);
      // The requested day and the discipline's official competition days are what let a
      // wrong timezone offset be recovered instead of silently moving a unit to another day.
      return parseDaily(data,{mode:'api',...meta},{ requestedDate:day, officialDays:officialDays.get(sport) });
    });
    if (!outcome.ok) {
      missing.push({ kind:'schedule-daily',disciplineCode:sport,endpoint:BASE+path,date:day,
        http_status:outcome.failure.http_status,error:outcome.failure.error });
      continue;
    }
    for (const row of outcome.value) {
      if (row.timezoneAnomaly) {
        anomalies.push({ disciplineCode:sport, date:day, unitId:row.unitId,
          code:row.timezoneAnomaly.code, sourceOffset:row.timezoneAnomaly.sourceOffset,
          originalStartTime:row.originalStartTime, recoveredStartTime:row.timezoneAnomaly.recoveredStartTime });
      }
      if (!row.startTimeTaipei) { unresolved.push(row); continue; }
      if (row.startTimeTaipei.slice(0,10)===date) rows.set(row.id,row);
    }
  }
}
for (const row of rows.values()) {
  if (row.hasTpe!==true || !row.resultCode) continue;
  const path = `${row.disciplineCode}/results/${row.resultCode}`;
  const outcome = await attempt(path, async()=>{
    const {data,meta} = await get(path);
    requests.push(meta);
    const result = data as {Info?:{Key?:string;Status?:string;IsLive?:boolean};
      Competitors?:RawCompetitor[];Results?:{CurrentPeriod?:number}};
    if (result?.Info?.Key!==row.unitId || !Array.isArray(result.Competitors)) {
      throw new Error('Schema change: Results identity/structure mismatch');
    }
    return { sourceStatus:result.Info.Status,isLive:result.Info.IsLive,
      currentPeriod:result.Results?.CurrentPeriod ?? null,
      competitors:result.Competitors.map(competitor),source:meta } satisfies Result;
  });
  if (!outcome.ok) {
    missing.push({ kind:'results',disciplineCode:row.disciplineCode,endpoint:BASE+path,unitId:row.unitId,
      http_status:outcome.failure.http_status,error:outcome.failure.error });
    continue;
  }
  row.result = outcome.value;
}
const all = [...rows.values()].sort((a,b)=>(a.startTimeTaipei || '').localeCompare(b.startTimeTaipei || ''));
const taiwan = all.filter(r=>r.hasTpe===true), unknown = all.filter(r=>r.hasTpe===null);
const report = { schemaVersion:2,generatedAt:new Date().toISOString(),date,timezone:'Asia/Taipei',
  editorialVerification:'pending',coverage:{sports,allSports:argument === 'ALL',
    selection:{ mode:argument === 'AUTO' ? 'schedule-matrix' : argument === 'ALL' ? 'all' : 'explicit',
      japaneseDays:days, targets },missing,
    timezoneAnomalies:anomalies,
    unrecoveredTimezone:anomalies.filter(a=>a.code !== 'RECOVERED_OFFICIAL_TIME').length,
    // A day is only complete when nothing failed and no unit was left unplaceable.
    fetchComplete:errors.length===0 && missing.length===0
      && anomalies.every(a=>a.code === 'RECOVERED_OFFICIAL_TIME'),
    participationComplete:errors.length===0 && missing.length===0 && unknown.length===0 && unresolved.length===0},
  errors,requests,count:all.length,taiwan,unknownParticipation:unknown,unresolvedTime:unresolved,rows:all };
// The automated updater points this at a staging directory so an incomplete sync never
// replaces a good production file.
const outDir = process.env.SCHEDULE_OUT_DIR ?? 'data/normalized';
const output = `${outDir}/schedule-${date}-${label}.json`;
await save(output,report);
console.log(`${date.replaceAll('-','/')} 中華隊賽程（台灣時間）`);
if (matrixNote) console.log(matrixNote);
console.log(`查詢範圍：${sports.join('、')}，未涵蓋全部運動；資料尚待交叉查核。`);
for (const row of taiwan) {
  const names = (row.result?.competitors.length ? row.result.competitors : row.competitors).map(c=>c.name || c.org);
  console.log(`${row.startTimeTaipei?.slice(11,16)}  ${row.disciplineName}  ${names.length ? names.join(' vs ') : row.unitName}  [${row.sourceStatus}]`);
}
if (!taiwan.length) console.log('此查詢範圍尚無可確認 TPE 的資料；不代表中華隊當天沒有賽事。');
console.log(`全部 ${all.length} 筆；TPE ${taiwan.length} 筆；參賽國未知 ${unknown.length} 筆；時間待確認 ${unresolved.length} 筆。`);
console.log(`保存：${output}；每筆原始資料路徑見 source.raw_file。`);
if (anomalies.length) {
  const recovered = anomalies.filter(a=>a.code === 'RECOVERED_OFFICIAL_TIME').length;
  console.error(`${anomalies.length} 筆官方時間的時區與場館不符（已依官方證據還原 ${recovered} 筆）：`);
  for (const a of anomalies.slice(0,5)) console.error(`  ${a.disciplineCode} ${a.unitId ?? ''} ${a.originalStartTime} → ${a.recoveredStartTime ?? '無法還原'}`);
}
if (missing.length) {
  console.error(`有 ${missing.length} 個端點未取得，已記錄並跳過，未重試：`);
  for (const m of missing) console.error(`  ${m.endpoint}  [${m.http_status ?? 'no status'}] ${m.error}`);
}
if (errors.length) { console.error(JSON.stringify(errors,null,2)); process.exitCode=1; }
