// npm run fetch:schedule -- 2026-09-21 [BKB,SWM|ALL|AUTO]
import { get, BASE, ApiError, recordFailure } from '../src/api/asianGames.ts';
import { parseDaily, buildCourtSessionChains, competitor, initialEventPhases,
  qualificationPredecessors, wushuResultTarget } from '../src/parsers/schedule.ts';
import { confirmFromQualifiedCompetitors, officialQualifiedCompetitors,
  parseRequestedResult } from '../src/parsers/results.ts';
import { entryIndex, parseTpeEntries } from '../src/parsers/entries.ts';
import { parseMatrix, activeDisciplineDays } from '../src/parsers/matrix.ts';
import type { Schedule, CourtSessionChain } from '../src/parsers/schedule.ts';
import { validateDate, nextDay } from '../src/utils/timezone.ts';
import { save, ROOT } from '../src/utils/storage.ts';
import { recoverMissing } from '../src/utils/recovery.ts';
import { readFile } from 'node:fs/promises';
import { setTimeout as pause } from 'node:timers/promises';
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
type Row = Schedule & { result?:Result; resultScope?:'component' | 'aggregate' | null;
  entryFallbackInitialPhase?:boolean };
const errors:Failure[] = [], rows = new Map<string,Row>(), unresolved:Row[] = [];
const courtSessionChains = new Map<string,CourtSessionChain>();
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
// Each endpoint is fetched through these two helpers so the recovery pass can repeat exactly
// the failed ones, and nothing else.
async function fetchDailyUnits(sport:string, day:string):Promise<boolean> {
  const path = `${sport}/schedule/daily/${day}`;
  const outcome = await attempt(path, async()=>{
    const {data,meta} = await get(path);
    requests.push(meta);
    // The requested day and the discipline's official competition days are what let a
    // wrong timezone offset be recovered instead of silently moving a unit to another day.
    // Chain the complete official response here. This is intentionally before the hasTpe/day
    // filters below because a session anchor or predecessor may be a non-TPE unit.
    return buildCourtSessionChains(parseDaily(data,{mode:'api',...meta},
      { requestedDate:day, officialDays:officialDays.get(sport) }));
  });
  if (!outcome.ok) {
    missing.push({ kind:'schedule-daily',disciplineCode:sport,endpoint:BASE+path,date:day,
      http_status:outcome.failure.http_status,error:outcome.failure.error });
    return false;
  }
  for (const chain of outcome.value.chains) courtSessionChains.set(chain.id,chain);
  for (const row of outcome.value.rows) {
    if (row.timezoneAnomaly) {
      anomalies.push({ disciplineCode:sport, date:day, unitId:row.unitId,
        code:row.timezoneAnomaly.code, sourceOffset:row.timezoneAnomaly.sourceOffset,
        originalStartTime:row.originalStartTime, recoveredStartTime:row.timezoneAnomaly.recoveredStartTime });
    }
    if (!row.startTimeTaipei) { unresolved.push(row); continue; }
    if (row.startTimeTaipei.slice(0,10)===date) rows.set(row.id,row);
  }
  return true;
}
async function fetchUnitResult(row:Row):Promise<boolean> {
  const resultKey = row.resultScope === 'aggregate' ? `${row.phaseId}.--------` : row.resultCode!;
  const path = `${row.disciplineCode}/results/${resultKey}`;
  const outcome = await attempt(path, async()=>{
    const {data,meta} = await get(path);
    requests.push(meta);
    const result = parseRequestedResult(data,row,resultKey);
    return result ? { ...result,source:meta } satisfies Result : null;
  });
  if (!outcome.ok) {
    missing.push({ kind:'results',disciplineCode:row.disciplineCode,endpoint:BASE+path,unitId:row.unitId,
      http_status:outcome.failure.http_status,error:outcome.failure.error });
    return false;
  }
  if (outcome.value) row.result = outcome.value;
  return true;
}

for (const { code:sport, date:day } of targets) await fetchDailyUnits(sport, day);
const dayRows = [...rows.values()];
// Entries can suggest an undrawn first phase, but cannot qualify a team for a later phase.
// Event metadata is optional enrichment: if it is unavailable, no Entries-only card is made.
let enteredEvents = new Set<string>();
try {
  const entries = parseTpeEntries(JSON.parse(await readFile(resolve(ROOT,'data/normalized/tpe-entries.json'),'utf8')));
  enteredEvents = new Set(entryIndex(entries).keys());
} catch { /* The merge already handles an unavailable Entries file. */ }
const undrawn = dayRows.filter(row=>row.hasTpe === null
  || (row.hasTpe === false && row.orgs.length === 1));
const hasEntry = (row:Row)=>{
  const key=`${row.disciplineCode}|${row.eventId ?? ''}`;
  if (enteredEvents.has(key)) return true;
  const gender=/^([MWX])\.-+$/.exec(row.eventId ?? '')?.[1];
  return !!gender && [...enteredEvents].some(event=>event.startsWith(`${row.disciplineCode}|${gender}.`));
};
const candidateEvents = new Map<string,Row[]>();
for (const row of undrawn) {
  if (!row.eventId || !row.phaseId || !hasEntry(row)) continue;
  const key=`${row.disciplineCode}|${row.eventId}`;
  candidateEvents.set(key,[...(candidateEvents.get(key) ?? []),row]);
}
for (const eventRows of candidateEvents.values()) {
  const {disciplineCode,eventId}=eventRows[0];
  const path=`${disciplineCode}/schedule/event/${eventId}`;
  try {
    const {data,meta}=await get(path);
    requests.push(meta);
    const first=initialEventPhases(data,disciplineCode,eventId!);
    for (const row of eventRows) if (first.has(row.phaseId!)) row.entryFallbackInitialPhase=true;
    // Entries prove only that TPE entered the event. A later phase becomes confirmed solely from
    // the official previous-phase Results marker (Qualified), and only when every qualifier feeds
    // one unambiguous destination unit. Scores/ranks from the previous phase are deliberately not
    // copied onto the later unit.
    for (const row of eventRows.filter(row=>!row.entryFallbackInitialPhase)) {
      const previous=qualificationPredecessors(data,disciplineCode,eventId!,row.unitId)
        .filter(unit=>unit.hasTpe===true);
      if (!previous.length) continue;
      const qualified:ReturnType<typeof competitor>[]=[];
      const metas:Meta[]=[];
      let complete=true;
      for (const unit of previous) {
        const resultKey=unit.resultCode!;
        const resultPath=`${disciplineCode}/results/${resultKey}`;
        try {
          const fetched=await get(resultPath);
          requests.push(fetched.meta); metas.push(fetched.meta);
          qualified.push(...officialQualifiedCompetitors(fetched.data,unit,resultKey)
            .filter(c=>c.org==='TPE'));
        } catch(e) {
          complete=false;
          console.error(`晉級證據無法取得，略過 ${resultPath}: ${e instanceof Error ? e.message : String(e)}`);
          break;
        }
      }
      if (!complete || !confirmFromQualifiedCompetitors(row,qualified)) continue;
      row.qualificationSource={ kind:'previous-results-qualified',
        previousUnitIds:previous.map(unit=>unit.unitId), urls:metas.map(item=>item.url),
        rawFiles:metas.map(item=>item.raw_file) };
    }
  } catch(e) {
    console.error(`Entries 首階段無法驗證，略過 ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
for (const row of dayRows) {
  const scope = wushuResultTarget(row, dayRows).scope;
  if (scope) row.resultScope = scope;
}
for (const row of rows.values()) {
  if (row.hasTpe!==true || !row.resultCode) continue;
  await fetchUnitResult(row);
}

// One recovery pass. The official API answers 200 with a non-JSON body now and then; waiting
// and repeating only the failed endpoints lets a day finish cleanly instead of being held.
// Nothing is relaxed: a day still publishes only when it ends with no missing and no errors.
const initialMissing = [...missing];
let recovered = 0;
if (initialMissing.length) {
  missing.length = 0;
  const outcome = await recoverMissing(initialMissing, async(item)=>{
    const ok = item.kind === 'schedule-daily'
      ? await fetchDailyUnits(item.disciplineCode, item.date as string)
      : await (async()=>{
          const row = [...rows.values()].find(r=>r.unitId === item.unitId);
          return row ? fetchUnitResult(row) : false;
        })();
    // A recovered endpoint's earlier failure no longer counts against the day.
    if (ok) { const at = errors.findIndex(e=>e.endpoint === item.endpoint); if (at >= 0) errors.splice(at,1); }
    return ok;
  }, { sleep:pause, onStart:(count)=>console.error(`initial missing=${count}；30 秒後只重抓失敗的端點`) });
  recovered = outcome.recovered.length;
  console.error(`recovery attempted=${outcome.attempted.length}｜recovered=${recovered}｜remaining=${missing.length}`);
}

const all = [...rows.values()].sort((a,b)=>(a.startTimeTaipei || '').localeCompare(b.startTimeTaipei || ''));
const selectedUnitIds = new Set(all.map(row=>row.unitId));
const sessionChains = [...courtSessionChains.values()].filter(chain=>
  chain.units.some(unit=>selectedUnitIds.has(unit.unitId)));
const taiwan = all.filter(r=>r.hasTpe===true), unknown = all.filter(r=>r.hasTpe===null);
const report = { schemaVersion:2,generatedAt:new Date().toISOString(),date,timezone:'Asia/Taipei',
  editorialVerification:'pending',coverage:{sports,allSports:argument === 'ALL',
    selection:{ mode:argument === 'AUTO' ? 'schedule-matrix' : argument === 'ALL' ? 'all' : 'explicit',
      japaneseDays:days, targets },missing,
    timezoneAnomalies:anomalies,
    recovery:{ initialMissing:initialMissing.length, recovered, remaining:missing.length },
    unrecoveredTimezone:anomalies.filter(a=>a.code !== 'RECOVERED_OFFICIAL_TIME').length,
    // A day is only complete when nothing failed and no unit was left unplaceable.
    fetchComplete:errors.length===0 && missing.length===0
      && anomalies.every(a=>a.code === 'RECOVERED_OFFICIAL_TIME'),
    participationComplete:errors.length===0 && missing.length===0 && unknown.length===0 && unresolved.length===0},
  errors,requests,count:all.length,taiwan,unknownParticipation:unknown,unresolvedTime:unresolved,
  sessionChains,rows:all };
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
