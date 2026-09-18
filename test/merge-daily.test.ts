import test from 'node:test';import assert from 'node:assert/strict';import { readFile } from 'node:fs/promises';
import { mergeDaily } from '../src/parsers/merge-daily.ts';
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
