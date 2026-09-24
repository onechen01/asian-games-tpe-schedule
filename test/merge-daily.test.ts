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
  sourceStatus:'PROVISIONAL', entryFallbackInitialPhase:true });
const swimEntries = entryIndex(parseTpeEntries(extractTpeEntries({ participants:[
  { Disc:'SWM', Reg:'1', Org:'TPE', Gender:'M', Name:'CHUANG Mu-lun',
    Inscriptions:[{EvKey:'M.50MBA-------------',EvDesc:"Men's 50m Backstroke"}] },
  { Disc:'SWM', Reg:'2', Org:'TPE', Gender:'M', Name:'HUANG Yu-teng',
    Inscriptions:[{EvKey:'M.50MBA-------------',EvDesc:"Men's 50m Backstroke"}] },
  { Disc:'SWM', Reg:'3', Org:'JPN', Gender:'M', Name:'SOMEONE Else',
    Inscriptions:[{EvKey:'M.100MFR------------',EvDesc:"Men's 100m Freestyle"}] },
] }, '2026-09-19T00:00:00.000Z')));
const day = (rows:ResultsRow[])=>({ date:'2026-09-21', rows, coverage:{fetchComplete:true,missing:[]}, errors:[] });

test('Entries only fills an undrawn first phase; later team rounds require their own TPE unit',()=>{
  const entries=new Map([
    ['GAR|M.TEAM',{evDesc:"Men's Team",athletes:['Gymnast A']}],
    ['BDM|M.TEAM',{evDesc:"Men's Team",athletes:['Player B']}],
    ['TTE|W.TEAM',{evDesc:"Women's Team",athletes:['Player C']}],
  ]);
  const row=(disc:string,event:string,phase:string,first:boolean,orgs:string[]=[]):ResultsRow=>({
    id:`${disc}:${event}.${phase}`,unitId:`${event}.${phase}`,disciplineCode:disc,eventId:event,
    eventName:event,phaseName:phase,startTimeTaipei:'2026-09-21T12:00:00+08:00',
    hasTpe:orgs.includes('TPE')?true:orgs.length?false:null,orgs,
    entryFallbackInitialPhase:first,sourceStatus:'SCHEDULED' });
  const gar=row('GAR','M.TEAM','FNL-',false,['TPE','CHN']);
  assert.equal(mergeDaily(day([gar]),null,entries).rows[0].participationState,'TPE_CONFIRMED');
  const first=row('BDM','M.TEAM','8FNL',true);
  assert.equal(mergeDaily(day([first]),null,entries).rows[0].participationState,'TPE_ENTERED');
  const semifinal=row('BDM','M.TEAM','SFNL',false);
  const final=row('BDM','M.TEAM','FNL-',false);
  const womenSemi=row('TTE','W.TEAM','SFNL',false);
  const womenFinal=row('TTE','W.TEAM','FNL-',false);
  for(const unit of [semifinal,final,womenSemi,womenFinal])
    assert.equal(mergeDaily(day([unit]),null,entries).rows.length,0);
  assert.equal(mergeDaily(day([{...semifinal,hasTpe:true,orgs:['TPE','CHN']}]),null,entries)
    .rows[0].participationState,'TPE_CONFIRMED');
  assert.equal(mergeDaily(day([{...first,entryFallbackInitialPhase:undefined}]),null,entries).rows.length,0);
});

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

// Both soft tennis semifinals are against Korea, so the opponent alone cannot tell them apart.
const semi = (event:string, phase:string, time:string):ResultsRow=>({ id:'test-only-'+event+time,
  disciplineCode:'TST', eventName:event, phaseName:phase, startTimeTaipei:`2026-09-20T${time}:00+08:00`,
  hasTpe:true, orgs:['KOR','TPE'], sourceStatus:'SCHEDULED',
  result:{ sourceStatus:'SCHEDULED', competitors:[{org:'TPE'},{org:'KOR',name:'Republic of Korea'}] } });
const sheet = (event:string, timeJst:string, timeTaipei:string):TpenocMatch=>({ sport:'軟式網球',
  timeJst, timeTaipei, startTimeJst:`2026-09-20T${timeJst}:00+09:00`,
  startTimeTaipei:`2026-09-20T${timeTaipei}:00+08:00`, event, athletes:['測試'], opponent:'南韓',
  result:null, venue:null, rank:null, note:null });

test('two semifinals against the same country are told apart, not paired by luck',()=>{
  const results = { date:'2026-09-20', coverage:{fetchComplete:true,missing:[]}, errors:[],
    rows:[semi("Women's Team","Women's Team Semifinals",'08:00'), semi("Men's Team","Men's Team Semifinals",'10:30')] };
  const merged = mergeDaily(results, { scheduleDate:'2026-09-20', matches:[
    sheet('女子團體準決賽','09:00','08:00'), sheet('男子團體準決賽','11:00','10:00')] }, null);
  const women = merged.rows.find(r=>r.event === "Women's Team")!;
  const men = merged.rows.find(r=>r.event === "Men's Team")!;
  assert.equal(women.matchStatus,'MATCHED');
  assert.equal(men.matchStatus,'MATCHED');
  // The women's times agree; the men's differ by 30 minutes, not by two hours.
  assert.ok(!merged.warnings.some(w=>w.code === 'TIME_DIFFERS' && w.message.includes('08:00')));
  const timeWarning = merged.warnings.find(w=>w.code === 'TIME_DIFFERS');
  assert.ok(timeWarning && timeWarning.message.includes('10:00') && timeWarning.message.includes('10:30'));
});

test('when the候選 cannot be narrowed to one, nothing is paired',()=>{
  // Same discipline, same gender, same opponent, same time: genuinely ambiguous.
  const results = { date:'2026-09-20', coverage:{fetchComplete:true,missing:[]}, errors:[],
    rows:[semi("Women's Team","Group A",'08:00'), semi("Women's Team","Group B",'08:00')] };
  const merged = mergeDaily(results, { scheduleDate:'2026-09-20',
    matches:[sheet('女子團體賽','09:00','08:00')] }, null);
  assert.ok(merged.warnings.some(w=>w.code === 'AMBIGUOUS_MATCH'));
  assert.equal(merged.rows.filter(r=>r.matchStatus === 'MATCHED').length,0);
  // Both official rows survive on their own.
  assert.equal(merged.rows.filter(r=>r.matchStatus === 'RESULTS_ONLY').length,2);
});

test('two Chinese Taipei entrants in one individual unit keep their own mark and place',()=>{
  const unit = { id:'u1', unitId:'u1', disciplineCode:'SWM', eventName:"Men's 200m Individual Medley",
    startTimeTaipei:'2026-09-20T19:00:00+08:00', hasTpe:true, orgs:['TPE','JPN'], sourceStatus:'OFFICIAL',
    result:{ sourceStatus:'OFFICIAL', competitors:[
      { org:'TPE', name:'WANG Hsing-hao', registration:'3559226', result:'2:01.21', rank:'4' },
      { org:'TPE', name:'FU Kun-ming', registration:'8599764', result:'2:04.80', rank:'7' },
      { org:'JPN', name:'Someone', registration:'1', result:'1:59.00', rank:'1' }] } };
  const merged = mergeDaily({ date:'2026-09-20', rows:[unit as unknown as ResultsRow],
    coverage:{ fetchComplete:true, missing:[], sports:['SWM'] } } as never,null,null);
  const row = merged.rows[0];
  assert.equal(row.tpeEntrants.length,2);
  assert.deepEqual(row.tpeEntrants.map(e=>e.result),['2:01.21','2:04.80']);
  assert.deepEqual(row.tpeEntrants.map(e=>e.rank),['4','7']);
  // No single "Taiwan result" may stand for both athletes.
  assert.equal(row.result,null);
  const unchanged=mergeDaily({ date:'2026-09-20', rows:[{
    ...unit,result:{sourceStatus:'OFFICIAL',competitors:[
      {org:'TPE',name:'WANG Hsing-hao',registration:'3559226',result:'2:01.21',rank:'4',medal:'ME_BRONZE'},
      {org:'TPE',name:'FU Kun-ming',registration:'8599764',result:'2:04.80',rank:'7'}]}
  } as unknown as ResultsRow],coverage:{fetchComplete:true,missing:[]} },null,null).rows[0];
  assert.equal(unchanged.tpeMedal,'ME_BRONZE');
  assert.ok(unchanged.tpeEntrants.every(e=>e.medal===undefined));
});

test('a missing mark is left empty rather than filled from the other athlete',()=>{
  const unit = { id:'u2', unitId:'u2', disciplineCode:'SHO', eventName:'10m Air Rifle Women Individual',
    startTimeTaipei:'2026-09-20T08:45:00+08:00', hasTpe:true, orgs:['TPE'], sourceStatus:'OFFICIAL',
    result:{ sourceStatus:'OFFICIAL', competitors:[
      { org:'TPE', name:'A', registration:'1', result:'626.6', rank:'3' },
      { org:'TPE', name:'B', registration:'2', result:'', rank:'' }] } };
  const row = mergeDaily({ date:'2026-09-20', rows:[unit as unknown as ResultsRow],
    coverage:{ fetchComplete:true, missing:[], sports:['SHO'] } } as never,null,null).rows[0];
  assert.deepEqual(row.tpeEntrants.map(e=>e.result),['626.6',null]);
  assert.deepEqual(row.tpeEntrants.map(e=>e.rank),['3',null]);
});

test('a team or relay entry is never split into separate athletes',()=>{
  const unit = { id:'u3', unitId:'u3', disciplineCode:'TST', eventName:"Women's Team",
    startTimeTaipei:'2026-09-20T08:00:00+08:00', hasTpe:true, orgs:['TPE','KOR'], sourceStatus:'OFFICIAL',
    result:{ sourceStatus:'OFFICIAL', competitors:[
      { org:'TPE', name:'Chinese Taipei', registration:'TSTWTEAM-TPE01', result:'2',
        members:[{name:'CHOU Yen-chen'},{name:'CHIANG Min-yu'}] },
      { org:'KOR', name:'Korea', registration:'TSTWTEAM-KOR01', result:'1', members:[{name:'KIM'}] }] } };
  const row = mergeDaily({ date:'2026-09-20', rows:[unit as unknown as ResultsRow],
    coverage:{ fetchComplete:true, missing:[], sports:['TST'] } } as never,null,null).rows[0];
  assert.equal(row.tpeEntrants.length,0);
  assert.deepEqual(row.result,{ tpe:'2', opponent:'1', source:'results' });
});

test('a qualification unit with a placeholder event id is matched through the entry list',()=>{
  // Artistic gymnastics publishes "M.------------------" for an all-apparatus qualification,
  // so the per-event entry keys never match it directly.
  const unit = (id:string)=>({ id, unitId:id, disciplineCode:'GAR', eventId:'M.------------------',
    eventName:"Men's", phaseName:"Men's Qualification", unitName:`Men's Qualification - Subdivision ${id}`,
    startTimeTaipei:`2026-09-21T0${id}:00:00+08:00`, hasTpe:null, orgs:[],
    entryFallbackInitialPhase:true }) as unknown as ResultsRow;
  const entries = new Map([
    ['GAR|M.TEAM--------------',{ evDesc:"Men's Team", athletes:['TANG Chia-hung','LEE Chih-kai'] }],
    ['GAR|M.1APFX-------------',{ evDesc:"Men's Floor Exercise", athletes:['LEE Chih-kai','HUNG Yuan-hsi'] }],
    ['GAR|W.TEAM--------------',{ evDesc:"Women's Team", athletes:['SOMEONE Else'] }],
  ]);
  const merged = mergeDaily({ date:'2026-09-21', rows:[unit('9'),unit('1')],
    coverage:{ fetchComplete:true, missing:[], sports:['GAR'] } } as never, null, entries);
  const row = merged.rows.find(r=>r.disciplineCode === 'GAR')!;
  assert.equal(row.participationState,'TPE_ENTERED');
  assert.equal(row.entryLevel,'event');
  assert.equal(row.unitCount,2,'兩個 subdivision 併成一列');
  assert.deepEqual(row.enteredAthletes,['TANG Chia-hung','LEE Chih-kai','HUNG Yuan-hsi']);
  // The other gender's entries never leak in.
  assert.ok(!row.enteredAthletes.includes('SOMEONE Else'));
});

test('a placeholder unit in a discipline the delegation did not enter is still dropped',()=>{
  const unit = { id:'u1', unitId:'u1', disciplineCode:'GRY', eventId:'W.------------------',
    phaseName:"Women's Qualification", startTimeTaipei:'2026-09-21T09:00:00+08:00',
    hasTpe:null, orgs:[] } as unknown as ResultsRow;
  const merged = mergeDaily({ date:'2026-09-21', rows:[unit],
    coverage:{ fetchComplete:true, missing:[], sports:['GRY'] } } as never, null,
    new Map([['GAR|M.TEAM--------------',{ evDesc:null, athletes:['TANG Chia-hung'] }]]));
  assert.equal(merged.rows.length,0);
});

test('a confirmed unit replaces the provisional row instead of doubling it',()=>{
  const base = { disciplineCode:'GAR', eventId:'M.------------------', eventName:"Men's",
    phaseName:"Men's Qualification", startTimeTaipei:'2026-09-21T09:00:00+08:00' };
  const tbd = { ...base, id:'u1', unitId:'u1', hasTpe:null, orgs:[] } as unknown as ResultsRow;
  const confirmed = { ...base, id:'u2', unitId:'u2', hasTpe:true, orgs:['TPE'],
    startTimeTaipei:'2026-09-21T13:30:00+08:00',
    competitors:[{ org:'TPE', name:'TANG Chia-hung', registration:'1' }] } as unknown as ResultsRow;
  const entries = new Map([['GAR|M.TEAM--------------',{ evDesc:null, athletes:['TANG Chia-hung'] }]]);
  const merged = mergeDaily({ date:'2026-09-21', rows:[tbd,confirmed],
    coverage:{ fetchComplete:true, missing:[], sports:['GAR'] } } as never, null, entries);
  assert.equal(merged.rows.filter(r=>r.disciplineCode === 'GAR').length,1);
  assert.equal(merged.rows[0].participationState,'TPE_CONFIRMED');
});

test('timeNote survives from the Results row into the canonical daily row (display trust signal)',()=>{
  const hidden:ResultsRow = { id:'test-hidden', disciplineCode:'BDM', eventName:'Mixed Doubles',
    startTimeTaipei:'2026-09-25T08:30:00+08:00', hasTpe:true, orgs:['TPE','MAS'], sourceStatus:'SCHEDULED',
    timeNote:{ code:'FOLLOWED_BY', clockTaipei:null, raw:'Followed by' } };
  const visible:ResultsRow = { id:'test-visible', disciplineCode:'BDM', eventName:'Mixed Doubles',
    startTimeTaipei:'2026-09-25T09:00:00+08:00', hasTpe:true, orgs:['TPE','MAS'], sourceStatus:'SCHEDULED',
    timeNote:null };
  const merged = mergeDaily({ date:'2026-09-25', rows:[hidden,visible],
    coverage:{ fetchComplete:true, missing:[] }, errors:[] }, null, null);
  assert.deepEqual(merged.rows.find(r=>r.sources.results?.id==='test-hidden')?.timeNote,
    { code:'FOLLOWED_BY', clockTaipei:null, raw:'Followed by' });
  assert.equal(merged.rows.find(r=>r.sources.results?.id==='test-visible')?.timeNote,null);
});

// The real 9/25 badminton case this whole fix is for: 8 confirmed TPE units, all HideStartDate,
// none of them may fall out of canonical and every one must land on Taiwan 9/25.
test('the real 9/25 BDM units all reach canonical on 9/25, whatever their timeNote code',()=>{
  const unit=(id:string,startTimeTaipei:string,timeNote:ResultsRow['timeNote']):ResultsRow=>({
    id, disciplineCode:'BDM', eventName:'x', startTimeTaipei, hasTpe:true, orgs:['TPE','MAS'],
    sourceStatus:'SCHEDULED', timeNote });
  const rows=[
    unit('m1','2026-09-25T08:30:00+08:00',{code:'FOLLOWED_BY',clockTaipei:null,raw:'Followed by'}),
    unit('m2','2026-09-25T09:10:00+08:00',{code:'FOLLOWED_BY',clockTaipei:null,raw:'Followed by'}),
    unit('m3','2026-09-25T10:10:00+08:00',{code:'FOLLOWED_BY',clockTaipei:null,raw:'Followed by'}),
    unit('m4','2026-09-25T10:50:00+08:00',{code:'FOLLOWED_BY',clockTaipei:null,raw:'Followed by'}),
    unit('m5','2026-09-25T15:50:00+08:00',{code:'NOT_BEFORE',clockTaipei:'15:00',raw:'Not Before 16:00'}),
    unit('m6','2026-09-25T16:00:00+08:00',{code:'FOLLOWED_BY',clockTaipei:null,raw:'Followed by'}),
    unit('m7','2026-09-25T19:00:00+08:00',null), // HideStartDate=false: no note, ordinary time
    unit('m8','2026-09-25T19:40:00+08:00',{code:'PENDING',clockTaipei:null,raw:null}),
  ];
  const merged=mergeDaily({ date:'2026-09-25', rows, coverage:{fetchComplete:true,missing:[]}, errors:[] },null,null);
  assert.equal(merged.rows.length,8);
  assert.ok(merged.rows.every(r=>r.date==='2026-09-25'));
  assert.ok(merged.rows.every(r=>r.startTimeTaipei?.slice(0,10)==='2026-09-25'));
  assert.deepEqual(new Set(merged.rows.map(r=>r.participationState)),new Set(['TPE_CONFIRMED']));
});

// An EstText this codebase has never seen must degrade one row to PENDING, not drop it and not
// take the rest of the day down with it.
test('an unrecognised EstText degrades its own row to PENDING without losing it or any other row',()=>{
  const known:ResultsRow = { id:'known', disciplineCode:'BDM', eventName:'x',
    startTimeTaipei:'2026-09-25T09:00:00+08:00', hasTpe:true, orgs:['TPE','MAS'], sourceStatus:'SCHEDULED',
    timeNote:{ code:'FOLLOWED_BY', clockTaipei:null, raw:'Followed by' } };
  const unknown:ResultsRow = { id:'unknown', disciplineCode:'BDM', eventName:'y',
    startTimeTaipei:'2026-09-25T09:00:00+08:00', hasTpe:true, orgs:['TPE','KOR'], sourceStatus:'SCHEDULED',
    timeNote:{ code:'PENDING', clockTaipei:null, raw:'Delayed Due To Weather' } };
  const merged=mergeDaily({ date:'2026-09-25', rows:[known,unknown],
    coverage:{fetchComplete:true,missing:[]}, errors:[] },null,null);
  assert.equal(merged.rows.length,2);
  assert.equal(merged.rows.find(r=>r.sources.results?.id==='unknown')?.timeNote?.raw,'Delayed Due To Weather');
});

test('a Wushu component rank cannot carry an aggregate medal; final medals stay with their athlete',()=>{
  const athletes=[{org:'TPE',name:'ATHLETE A',registration:'101',result:'9.720',rank:'5',medal:'ME_BRONZE'},
    {org:'TPE',name:'ATHLETE B',registration:'102',result:'9.703',rank:'7',medal:null}];
  const base={disciplineCode:'WSU',eventId:'M.TEST',eventName:'Combined routines',
    startTimeTaipei:'2026-09-22T09:00:00+08:00',hasTpe:true,orgs:['TPE'],sourceStatus:'OFFICIAL'};
  const component={...base,id:'component',unitId:'component',unitName:'Routine 1',resultScope:'component',
    result:{sourceStatus:'OFFICIAL',competitors:athletes}} as unknown as ResultsRow;
  const aggregate={...base,id:'final',unitId:'final',unitName:'Routine 2 Final',resultScope:'aggregate',
    result:{sourceStatus:'OFFICIAL',competitors:[
      {...athletes[0],result:'19.430',rank:'3'},
      {...athletes[1],result:'19.429',rank:'4'}]}} as unknown as ResultsRow;
  const rows=mergeDaily({date:'2026-09-22',rows:[component,aggregate],
    coverage:{fetchComplete:true,missing:[]}},null,null).rows;
  const part=rows.find(r=>r.sources.results?.id==='component')!;
  const final=rows.find(r=>r.sources.results?.id==='final')!;
  assert.deepEqual(part.tpeEntrants.map(e=>[e.result,e.rank,e.medal]),
    [['9.720','5',undefined],['9.703','7',undefined]]);
  assert.equal(part.tpeMedal,null);
  assert.deepEqual(final.tpeEntrants.map(e=>[e.result,e.rank,e.medal]),
    [['19.430','3','ME_BRONZE'],['19.429','4',undefined]]);
  assert.equal(final.tpeMedal,null);
  assert.equal(final.resultScope,'aggregate');
});
