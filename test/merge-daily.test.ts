import test from 'node:test';import assert from 'node:assert/strict';import { readFile } from 'node:fs/promises';
import { mergeDaily } from '../src/parsers/merge-daily.ts';
import { extractTpeEntries, entryIndex, parseTpeEntries } from '../src/parsers/entries.ts';
import type { ResultsRow, TpenocMatch } from '../src/parsers/merge-daily.ts';

const load = async (file:string)=>JSON.parse(await readFile(file,'utf8'));
const real = async ()=>mergeDaily(await load('data/normalized/schedule-2026-09-18-AUTO.json'),
  await load('data/normalized/tpenoc-2026-09-18.json'));

test('every committee row reaches the canonical day and keeps its Chinese names',async()=>{
  const merged = await real(), sheet = await load('data/normalized/tpenoc-2026-09-18.json');
  for (const entry of sheet.matches as TpenocMatch[]) {
    const row = merged.rows.find(r=>r.sources.tpenoc?.sport === entry.sport && r.sources.tpenoc?.timeJst === entry.timeJst);
    assert.ok(row, `${entry.sport} ${entry.timeJst} 未出現在 canonical daily`);
    assert.deepEqual(row.athletes, entry.athletes);
  }
  assert.equal(merged.summary.matched, 5);
  assert.equal(merged.summary.tpenocOnly, 0);
});

test('women basketball pairs with Results and keeps both rosters and the official score',async()=>{
  const row = (await real()).rows.find(r=>r.disciplineCode === 'BKB')!;
  assert.equal(row.matchStatus,'MATCHED');
  assert.equal(row.matchConfidence,'high');
  assert.deepEqual(row.matchSignals,['discipline','gender','opponent']);
  assert.equal(row.athletes[0],'彭曉彤');
  assert.equal(row.athletesEn.length,12);
  assert.deepEqual(row.result,{ tpe:'76', opponent:'67', source:'results' });
  assert.equal(row.status,'OFFICIAL');
  assert.equal(row.startTimeTaipei,'2026-09-18T12:00:00+08:00');
  assert.equal(row.startTimeJst,'2026-09-18T13:00:00+09:00');
  assert.equal(row.sources.results?.unitId,'W.TEAM5-------------.GPC-.000200--');
});

test('soft tennis, hockey and volleyball pair too, and a time difference is warned not silenced',async()=>{
  const merged = await real();
  for (const code of ['TST','HOC','VVO']) {
    assert.ok(merged.rows.some(r=>r.disciplineCode === code && r.matchStatus === 'MATCHED'),`${code} 未配對`);
  }
  assert.equal(merged.rows.filter(r=>r.disciplineCode === 'TST' && r.matchStatus === 'MATCHED').length,2);
  assert.ok(merged.warnings.some(w=>w.code === 'TIME_DIFFERS'));
});

test('Results-only TPE rows survive with a warning instead of disappearing',async()=>{
  const merged = await real();
  assert.equal(merged.summary.resultsOnly,4);
  assert.equal(merged.warnings.filter(w=>w.code === 'RESULTS_ONLY').length,4);
  for (const row of merged.rows.filter(r=>r.matchStatus === 'RESULTS_ONLY')) {
    assert.equal(row.participationState,'TPE_CONFIRMED');
    assert.deepEqual(row.athletes,[]);
  }
});

const tbd:ResultsRow = { id:'test-only-tbd', disciplineCode:'TEQ', eventName:'Mixed Doubles',
  startTimeTaipei:'2026-09-18T10:00:00+08:00', hasTpe:null, orgs:[], sourceStatus:'SCHEDULED' };
const scored:ResultsRow = { id:'test-only-bkb', disciplineCode:'BKB', eventName:'Women',
  startTimeTaipei:'2026-09-18T12:00:00+08:00', hasTpe:true, orgs:['TPE','MGL'], sourceStatus:'OFFICIAL',
  result:{ sourceStatus:'OFFICIAL', competitors:[{org:'TPE',result:'76'},{org:'MGL',name:'Mongolia',result:'67'}] } };
const sheetRow:TpenocMatch = { sport:'籃球(5*5)', timeJst:'13:00', timeTaipei:'12:00',
  startTimeJst:'2026-09-18T13:00:00+09:00', startTimeTaipei:'2026-09-18T12:00:00+08:00',
  event:'女子小組賽-C組', athletes:['林蝶'], opponent:'蒙古', result:null, venue:'愛知國際競技場',
  rank:null, note:null };

test('an absent committee row never downgrades a TBD row',()=>{
  const merged = mergeDaily({ date:'2026-09-18', rows:[tbd] }, { scheduleDate:'2026-09-18', matches:[] });
  assert.equal(merged.rows.length,1);
  assert.equal(merged.rows[0].participationState,'PARTICIPANTS_TBD');
  assert.equal(merged.summary.unresolvedTbd,1);
  assert.equal(merged.summary.matched,0);
});

test('blank committee cells never overwrite the Results score, status or English roster',()=>{
  const merged = mergeDaily({ date:'2026-09-18', rows:[scored] }, { scheduleDate:'2026-09-18', matches:[sheetRow] });
  const row = merged.rows[0];
  assert.equal(row.matchStatus,'MATCHED');
  assert.deepEqual(row.result,{ tpe:'76', opponent:'67', source:'results' });
  assert.equal(row.status,'OFFICIAL');
  assert.equal(row.tpenocResult,null);
  assert.equal(row.rank,null);
  assert.deepEqual(row.athletes,['林蝶']);
});

test('a committee row with no Results counterpart is kept as TPENOC_ONLY',()=>{
  const merged = mergeDaily({ date:'2026-09-18', rows:[] }, { scheduleDate:'2026-09-18', matches:[sheetRow] });
  assert.equal(merged.rows.length,1);
  assert.equal(merged.rows[0].matchStatus,'TPENOC_ONLY');
  assert.equal(merged.rows[0].participationState,'TPE_CONFIRMED');
  assert.equal(merged.summary.tpenocOnly,1);
  assert.ok(merged.warnings.some(w=>w.code === 'TPENOC_ONLY'));
});

test('mismatched dates fail closed',()=>{
  assert.throws(()=>mergeDaily({ date:'2026-09-18', rows:[] }, { scheduleDate:'2026-09-19', matches:[] }),/日期不一致/);
});

test('a confirmed rest day needs a clean sync, zero gaps, zero errors and zero rows',()=>{
  const clean = { date:'2026-09-11', rows:[], coverage:{ fetchComplete:true, missing:[] }, errors:[] };
  assert.equal(mergeDaily(clean,null).officialNoCompetition,true);
  assert.equal(mergeDaily({...clean,coverage:{fetchComplete:false,missing:[]}},null).officialNoCompetition,false);
  assert.equal(mergeDaily({...clean,coverage:{fetchComplete:true,missing:[{}]}},null).officialNoCompetition,false);
  assert.equal(mergeDaily({...clean,errors:[{}]},null).officialNoCompetition,false);
  // A day with Chinese Taipei events is never a rest day.
  assert.equal(mergeDaily({...clean,rows:[scored]},null).officialNoCompetition,false);
});

const heat = (n:number, event='M.50MBA-------------'):ResultsRow=>({ id:'test-only-heat'+n,
  disciplineCode:'SWM', eventId:event, eventName:"Men's 50m Backstroke", phaseName:'Heats',
  startTimeTaipei:`2026-09-21T09:${String(n).padStart(2,'0')}:00+08:00`, hasTpe:null, orgs:[],
  sourceStatus:'PROVISIONAL' });
const swimEntries = entryIndex(parseTpeEntries(extractTpeEntries({ participants:[
  { Disc:'SWM', Reg:'1', Org:'TPE', Gender:'M', Name:'CHUANG Mu-lun',
    Inscriptions:[{EvKey:'M.50MBA-------------',EvDesc:"Men's 50m Backstroke"}] },
  { Disc:'SWM', Reg:'2', Org:'TPE', Gender:'M', Name:'HUANG Yu-teng',
    Inscriptions:[{EvKey:'M.50MBA-------------',EvDesc:"Men's 50m Backstroke"}] },
  { Disc:'SWM', Reg:'3', Org:'JPN', Gender:'M', Name:'SOMEONE Else',
    Inscriptions:[{EvKey:'M.100MFR------------',EvDesc:"Men's 100m Freestyle"}] },
] }, '2026-09-19T00:00:00.000Z')));
const day = (rows:ResultsRow[])=>({ date:'2026-09-21', rows, coverage:{fetchComplete:true,missing:[]}, errors:[] });

test('eight heats plus an entry produce exactly one pending event row',()=>{
  const merged = mergeDaily(day([1,2,3,4,5,6,7,8].map(n=>heat(n))), null, swimEntries);
  assert.equal(merged.rows.length,1);
  const [row] = merged.rows;
  assert.equal(row.participationState,'TPE_ENTERED');
  assert.equal(row.entryLevel,'event');
  assert.equal(row.unitCount,8);
  assert.deepEqual(row.enteredAthletes,['CHUANG Mu-lun','HUANG Yu-teng']);
  // The event window starts at the earliest unit, not at some invented start time.
  assert.equal(row.startTimeTaipei,'2026-09-21T09:01:00+08:00');
  assert.equal(merged.summary.entered,1);
});

test('an entry never overrides what a unit says',()=>{
  // Unit says Chinese Taipei is in it: confirmed, at unit level.
  const seeded = { ...heat(1), hasTpe:true, orgs:['TPE','JPN'], sourceStatus:'SCHEDULED' };
  const confirmed = mergeDaily(day([seeded]), null, swimEntries);
  assert.equal(confirmed.rows[0].participationState,'TPE_CONFIRMED');
  assert.equal(confirmed.rows[0].entryLevel,'unit');
  // Unit says the nations are others: the entry list must not resurrect it.
  const others = { ...heat(2), hasTpe:false, orgs:['JPN','KOR'], sourceStatus:'SCHEDULED' };
  const merged = mergeDaily(day([others]), null, swimEntries);
  assert.equal(merged.rows.length,0);
  assert.equal(merged.summary.entered,0);
});

test('once the draw is published the pending row is replaced, not duplicated',()=>{
  const before = mergeDaily(day([heat(1),heat(2)]), null, swimEntries);
  assert.deepEqual(before.rows.map(r=>r.participationState),['TPE_ENTERED']);
  // Same event, now drawn: heat 2 has Chinese Taipei, heat 1 does not.
  const after = mergeDaily(day([
    { ...heat(1), hasTpe:false, orgs:['JPN','KOR'], sourceStatus:'SCHEDULED' },
    { ...heat(2), hasTpe:true, orgs:['TPE','JPN'], sourceStatus:'SCHEDULED' },
  ]), null, swimEntries);
  assert.equal(after.rows.length,1);
  assert.equal(after.rows[0].participationState,'TPE_CONFIRMED');
  assert.equal(after.summary.entered,0);
});

test('a confirmed event with undrawn later units warns instead of adding a second card',()=>{
  const merged = mergeDaily(day([
    { ...heat(1), hasTpe:true, orgs:['TPE','JPN'], sourceStatus:'SCHEDULED' },
    heat(9),
  ]), null, swimEntries);
  assert.equal(merged.rows.length,1);
  assert.equal(merged.rows[0].participationState,'TPE_CONFIRMED');
  assert.ok(merged.warnings.some(w=>w.code === 'PENDING_LATER_UNITS'));
});

test('without an entry list nothing is assumed: unseeded units stay unresolved',()=>{
  const merged = mergeDaily(day([heat(1),heat(2)]), null, null);
  assert.equal(merged.rows.length,2);
  assert.ok(merged.rows.every(r=>r.participationState === 'PARTICIPANTS_TBD'));
  assert.equal(merged.summary.unresolvedTbd,2);
  // A failed entry fetch must never turn into a confirmed rest day.
  assert.equal(merged.officialNoCompetition,false);
});

test('a malformed or empty entry list is rejected rather than read as "nobody entered"',()=>{
  assert.throws(()=>extractTpeEntries({participants:[]},'x'),/participants/);
  assert.throws(()=>extractTpeEntries({participants:[{Disc:'SWM',Org:'JPN',Reg:'1',Name:'X'}]},'x'),/no Chinese Taipei/);
  assert.throws(()=>parseTpeEntries({schemaVersion:2,org:'TPE',entries:[]}),/格式不符/);
});

test('a Taiwan day is bounded by Taiwan time, even across the Japanese midnight',()=>{
  // 2026-09-22 00:30 Japan is still 2026-09-21 23:30 in Taipei, so it belongs to the 21st and
  // must be the row's start time; a unit truly on the 22nd must not be counted.
  const late = { ...heat(1), startTimeTaipei:'2026-09-21T23:30:00+08:00' };
  const early = { ...heat(2), startTimeTaipei:'2026-09-21T09:02:00+08:00' };
  const nextDay = { ...heat(3), startTimeTaipei:'2026-09-22T09:03:00+08:00' };
  const merged = mergeDaily({ date:'2026-09-21', rows:[late,early,nextDay],
    coverage:{fetchComplete:true,missing:[]}, errors:[] }, null, swimEntries);
  assert.equal(merged.rows.length,1);
  const [row] = merged.rows;
  assert.equal(row.startTimeTaipei,'2026-09-21T09:02:00+08:00');
  assert.equal(row.unitCount,3);
});

test('a half-drawn unit keeps the event pending instead of ruling Chinese Taipei out',()=>{
  const halfDrawn = { ...heat(1), hasTpe:false, orgs:['HKG'], sourceStatus:'START_LIST' };
  const bothKnown = { ...heat(2), hasTpe:false, orgs:['HKG','JPN'], sourceStatus:'START_LIST' };
  const pending = mergeDaily(day([halfDrawn]), null, swimEntries);
  assert.equal(pending.rows.length,1);
  assert.equal(pending.rows[0].participationState,'TPE_ENTERED');
  const settled = mergeDaily(day([bothKnown]), null, swimEntries);
  assert.equal(settled.rows.length,0);
});

const unit = (competitors:unknown[]):ResultsRow=>({ id:'test-only-unit', disciplineCode:'WSU',
  eventName:"Men's Changquan", startTimeTaipei:'2026-09-20T08:00:00+08:00', hasTpe:true,
  orgs:['TPE'], sourceStatus:'START_LIST',
  result:{ sourceStatus:'START_LIST', competitors:competitors as never } });

test('an individual competitor is the athlete; a team slot is not a person',()=>{
  const individual = mergeDaily(day([unit([{ org:'TPE', name:'CHENG Yu-hsuan', registration:'607139' }])]),null,null);
  assert.deepEqual(individual.rows[0].athletesEn,['CHENG Yu-hsuan']);
  // A team slot carries a structured registration and the delegation's name, never a person.
  const team = mergeDaily(day([unit([{ org:'TPE', name:'Chinese Taipei', registration:'BBLMTEAM9------TPE01' }])]),null,null);
  assert.deepEqual(team.rows[0].athletesEn,[]);
  // Team entries with a published roster keep listing the roster, as before.
  const roster = mergeDaily(day([unit([{ org:'TPE', name:'Chinese Taipei', registration:'KABMTEAM7------TPE01',
    members:[{name:'A One'},{name:'B Two'}] }])]),null,null);
  assert.deepEqual(roster.rows[0].athletesEn,['A One','B Two']);
  // No registration at all is not enough to call something a person.
  const nameless = mergeDaily(day([unit([{ org:'TPE', name:'Someone' }])]),null,null);
  assert.deepEqual(nameless.rows[0].athletesEn,[]);
});

test('the real 9/20 individual units now carry their official English names',async()=>{
  const day20 = JSON.parse(await readFile('data/normalized/daily-2026-09-20.json','utf8'));
  const named = day20.rows.filter((r:any)=>r.participationState === 'TPE_CONFIRMED' && r.athletesEn.length);
  assert.ok(named.some((r:any)=>r.athletesEn.includes('CHENG Yu-hsuan')));
  assert.ok(named.some((r:any)=>r.athletesEn.includes('SUNG Yu-Ting') && r.athletesEn.includes('CHOU Ya-Hsuan')));
  // The delegation name must never appear as an athlete.
  assert.ok(day20.rows.every((r:any)=>!r.athletesEn.includes('Chinese Taipei')));
});
