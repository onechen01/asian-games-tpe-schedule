import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { decode, safeData } from '../src/api/asianGames.ts';
import { normalize, parseDaily, wushuResultTarget } from '../src/parsers/schedule.ts';

test('multi-routine Wushu medal unit uses the official phase summary; single units keep their result',()=>{
  const phase='M.TEST--------------.FNL-';
  const unit=(n:string,medal:string)=>normalize({ Key:`${phase}.${n}`,Disc:'WSU',
    Event:'M.TEST--------------',Phase:phase,ResCode:`${phase}.${n}`,Medal:medal,isH2H:false },source);
  const component=unit('000100--','0'),final=unit('000200--','1');
  assert.deepEqual(wushuResultTarget(component,[component,final]),
    {code:component.resultCode,scope:'component'});
  assert.deepEqual(wushuResultTarget(final,[component,final]),
    {code:`${phase}.--------`,scope:'aggregate'});
  const bout=normalize({ Key:`${phase}.000300--`,Disc:'WSU',Event:'M.TEST--------------',
    Phase:phase,ResCode:`${phase}.000300--`,Medal:'1',isH2H:true },source);
  assert.deepEqual(wushuResultTarget(bout,[component,bout]),{code:bout.resultCode,scope:null});
  const single=normalize({Key:'single',Disc:'WSU',Event:'M.SINGLE',Phase:'M.SINGLE.FNL-',
    ResCode:'single',Medal:'1'},source);
  assert.deepEqual(wushuResultTarget(single,[single]),{code:'single',scope:null});
  const other=normalize({Key:'other',Disc:'SWM',Event:'M.TEST',Phase:phase,
    ResCode:'other',Medal:'1'},source);
  assert.deepEqual(wushuResultTarget(other,[other,component]),{code:'other',scope:null});
});
import { offsetOf, readAtVenueOffset } from '../src/utils/timezone.ts';
import { parseMatrix, activeDisciplines, activeDisciplineDays } from '../src/parsers/matrix.ts';
import { parseTime, taipeiTime, nextDay, validateDate } from '../src/utils/timezone.ts';
const source={url:'https://example.invalid/fixture'};

test('decode all observed encodings without changing JSON text or Unicode',()=>{
  const json='{ "name": "中華隊", "score": 0 }',zipped=deflateSync(json);
  for (const input of [json,Buffer.from(json),zipped,zipped.toString('latin1'),Buffer.from(zipped.toString('latin1'))]) {
    assert.deepEqual(decode(input).data,{name:'中華隊',score:0});
    assert.equal(decode(input).json,json);
  }
  assert.throws(()=>decode('<html>Error</html>'));
});
test('IANA timezone conversion handles Japanese midnight and UTC input',()=>{
  assert.deepEqual(parseTime('2026-09-20T00:30:00+09:00'),{utc:'2026-09-19T15:30:00.000Z',taipei:'2026-09-19T23:30:00+08:00'});
  assert.equal(taipeiTime('2026-09-20T01:00:00Z'),'2026-09-20T09:00:00+08:00');
  assert.equal(taipeiTime('2026-09-20T10:00:00'),null);
  assert.equal(taipeiTime(null),null);
  assert.equal(nextDay('2026-09-30'),'2026-10-01');
  assert.throws(()=>validateDate('2026-02-30'));
});
test('empty Orgs is unknown; TPE is determined by code, not display name',()=>{
  const row={Key:'fixture',Disc:'SWM',Orgs:[],Status:'NEW_STATUS'};
  assert.equal(normalize(row,source).hasTpe,null);
  assert.equal(normalize(row,source).status,'unknown');
  assert.equal(normalize({...row,Home:{Org:'TPE'}},source).hasTpe,true);
  assert.equal(normalize({...row,Home:{Org:'JPN',Name:'Taiwan'}},source).hasTpe,false);
});
test('hidden start times stay hidden while original and UTC remain auditable',()=>{
  const row=normalize({Key:'fixture',Disc:'BKB',HideStartDate:true,DateTimeRaw:'2026-09-20T10:00:00+09:00'},source);
  assert.equal(row.startTimeTaipei,null);
  assert.equal(row.startTimeUtc,'2026-09-20T01:00:00.000Z');
});
test('schema changes fail closed',()=>{
  assert.throws(()=>parseDaily({rows:[]},source));
  assert.throws(()=>parseDaily([{Key:'fixture',Disc:'BKB',Orgs:'TPE'}],source));
  assert.throws(()=>parseDaily([{Key:'fixture',Disc:'BKB',DateTimeRaw:123}],source));
});
test('config analysis excludes authentication fields',()=>{
  assert.deepEqual(safeData('config',{venueTimeZone:'+09:00',oauth:{clientSecret:'fixture'}}),{venueTimeZone:'+09:00'});
});

test('schedule matrix marks competition days per discipline and unions two Japanese days',()=>{
  const value={dates:['2026-09-18','2026-09-19','2026-09-20'],
    matrix:[{Disc:{Key:'BKB',Desc:'Basketball'},Dates:['0','0','1']},
      {Disc:{Key:'SWM',Desc:'Swimming'},Dates:['N','N','1']},
      {Disc:{Key:'JUD',Desc:'Judo'},Dates:['N','N','N']}],
    live:[{Key:'BKB'}]};
  const matrix=parseMatrix(value);
  assert.deepEqual(matrix.disciplines.find(d=>d.code==='SWM')?.dates,['2026-09-20']);
  assert.deepEqual(matrix.live,['BKB']);
  // A Taiwan day needs both Japanese days, or a late-evening Taiwan match would be missed.
  assert.deepEqual(activeDisciplines(matrix,['2026-09-19']).codes,['BKB']);
  assert.deepEqual(activeDisciplines(matrix,['2026-09-19','2026-09-20']).codes,['BKB','SWM']);
  assert.deepEqual(activeDisciplines(matrix,['2026-09-19','2026-10-04']).unlistedDays,['2026-10-04']);
  // Only the discipline/day pairs that actually compete become requests; 'N' days are skipped.
  const {targets,unlistedDays}=activeDisciplineDays(matrix,['2026-09-19','2026-09-20']);
  assert.deepEqual(targets,[{code:'BKB',date:'2026-09-19',medalDay:false},
    {code:'BKB',date:'2026-09-20',medalDay:true},{code:'SWM',date:'2026-09-20',medalDay:true}]);
  assert.deepEqual(unlistedDays,[]);
  assert.deepEqual(activeDisciplineDays(matrix,['2026-10-04']).unlistedDays,['2026-10-04']);
  assert.throws(()=>parseMatrix({dates:['2026-09-18'],matrix:[{Disc:{Key:'BKB',Desc:'Basketball'},Dates:['0','0']}]}));
  assert.throws(()=>parseMatrix({dates:['2026-09-18'],matrix:[{Disc:{Key:'BKB',Desc:'Basketball'},Dates:['X']}]}));
});

const unitAt = (raw:string)=>({ Key:'M.T77KG-------------.8FNL.000700--', Disc:'MMA',
  Orgs:['TPE','KAZ'], DateTimeRaw:raw, Status:'START_LIST', EventDesc:"Men's Traditional -77kg" });
const src = { url:'https://example.invalid/fixture' };

test('a venue-offset timestamp is read as before',()=>{
  const row = normalize(unitAt('2026-09-20T10:50:00+09:00'), src, { requestedDate:'2026-09-20' });
  assert.equal(row.timezoneAnomaly,null);
  assert.equal(row.startTimeTaipei,'2026-09-20T09:50:00+08:00');
  assert.equal(row.originalStartTime,'2026-09-20T10:50:00+09:00');
});

test('a wrong offset never moves a unit to another day in silence',()=>{
  // No evidence of the competition day: the unit cannot be placed, and says so.
  const row = normalize(unitAt('2026-09-20T10:50:00-12:00'), src, {});
  assert.equal(row.timezoneAnomaly?.code,'SUSPECT_TIMEZONE');
  assert.equal(row.timezoneAnomaly?.sourceOffset,'-12:00');
  assert.equal(row.startTimeTaipei,null,'不得換算出台灣時間');
  assert.equal(row.startTimeUtc,null);
  // Reading it naively would have pushed this unit to 2026-09-21 in Taipei.
  assert.equal(new Date('2026-09-20T10:50:00-12:00').toISOString().slice(0,10),'2026-09-20');
  assert.equal(row.originalStartTime,'2026-09-20T10:50:00-12:00','原始字串必須保留');
});

test('the official day proves the reading, and the raw value is still kept',()=>{
  const row = normalize(unitAt('2026-09-20T10:50:00-12:00'), src,
    { requestedDate:'2026-09-20', officialDays:['2026-09-20','2026-09-21','2026-09-22'] });
  assert.equal(row.timezoneAnomaly?.code,'RECOVERED_OFFICIAL_TIME');
  assert.equal(row.timezoneAnomaly?.recoveredStartTime,'2026-09-20T10:50:00+09:00');
  assert.equal(row.startTimeTaipei,'2026-09-20T09:50:00+08:00');
  assert.equal(row.originalStartTime,'2026-09-20T10:50:00-12:00','官方原始字串不得被改寫');
  assert.equal(row.timezoneAnomaly?.evidence?.venueTimeZoneSource,'config.venueTimeZone');
  assert.deepEqual(row.timezoneAnomaly?.evidence?.officialDays,['2026-09-20','2026-09-21','2026-09-22']);
});

test('recovery is refused when the day cannot be proved',()=>{
  // The wall-clock day is not the day that was requested: nothing proves which day is right.
  const mismatch = normalize(unitAt('2026-09-21T10:50:00-12:00'), src,
    { requestedDate:'2026-09-20', officialDays:['2026-09-20'] });
  assert.equal(mismatch.timezoneAnomaly?.code,'SUSPECT_TIMEZONE');
  assert.equal(mismatch.startTimeTaipei,null);
  // The day is not one the discipline competes on.
  const offDay = normalize(unitAt('2026-09-20T10:50:00-12:00'), src,
    { requestedDate:'2026-09-20', officialDays:['2026-09-23'] });
  assert.equal(offDay.timezoneAnomaly?.code,'SUSPECT_TIMEZONE');
});

test('the real 9/20 mixed martial arts units stay on their Taiwan day, anomaly or not',async()=>{
  const day = JSON.parse(await readFile('data/normalized/schedule-2026-09-20-AUTO.json','utf8'));
  const mma = day.taiwan.filter((r:any)=>r.disciplineCode === 'MMA');
  assert.equal(mma.length,3,'三場中華隊綜合格鬥賽事必須留在 9/20');
  for (const row of mma) {
    assert.equal(row.startTimeTaipei.slice(0,10),'2026-09-20');
    // The official side published a wrong offset here once and has since corrected it. The
    // guard must hold either way: a correct offset is read as published, and a wrong one is
    // kept verbatim and recovered as the wall clock minus one hour.
    if (!row.timezoneAnomaly) {
      assert.equal(row.originalStartTime.slice(-6),'+09:00');
      continue;
    }
    assert.equal(row.timezoneAnomaly.code,'RECOVERED_OFFICIAL_TIME');
    assert.ok(!row.originalStartTime.endsWith('+09:00'),'原始 offset 必須保留');
    assert.equal(row.originalStartTime.slice(-6),row.timezoneAnomaly.sourceOffset);
    const wall = row.originalStartTime.slice(11,16);
    const hour = String(Number(wall.slice(0,2)) - 1).padStart(2,'0');
    assert.equal(row.startTimeTaipei.slice(11,16), hour + wall.slice(2));
  }
  // A day carrying anomalies is never reported as cleanly complete.
  if (day.coverage.timezoneAnomalies.length) assert.equal(day.coverage.fetchComplete,
    day.coverage.timezoneAnomalies.every((a:any)=>a.code === 'RECOVERED_OFFICIAL_TIME')
      && day.errors.length === 0 && day.coverage.missing.length === 0);
});

test('offset helpers read the source string without editing it',()=>{
  assert.equal(offsetOf('2026-09-20T10:50:00-12:00'),'-12:00');
  assert.equal(offsetOf('2026-09-20T10:50:00+09:00'),'+09:00');
  assert.equal(offsetOf('2026-09-20T10:50:00Z'),'+00:00');
  assert.equal(offsetOf('nonsense'),null);
  assert.equal(readAtVenueOffset('2026-09-20T10:50:00-12:00'),'2026-09-20T10:50:00+09:00');
  assert.equal(readAtVenueOffset(null),null);
});

import { extractTpeEntries } from '../src/parsers/entries.ts';

test('Name-only entries are quarantined without blocking Results; structural corruption fails closed',()=>{
  const ok = (n:number)=>({ Org:'TPE', Disc:'SWM', Reg:String(n), Name:`ATHLETE ${n}`,
    Inscriptions:[{ EvKey:'M.100M--------------', EvDesc:"Men's 100m" }] });
  const broken = { Org:'TPE', Disc:'ELS', Reg:'ELSOPYO--------TPE01', Name:'' };
  const many = [...Array(20).keys()].map(n=>ok(n+1));
  const reports:import('../src/parsers/entries.ts').EntryQuarantine[] = [];
  const report = (value:import('../src/parsers/entries.ts').EntryQuarantine)=>{ reports.push(value); };
  const parsed = extractTpeEntries({ participants:[many[0],broken,...many.slice(1),{ Org:'JPN' }] },'2026-09-22',report);
  assert.equal(parsed.entries.length,20);
  assert.ok(parsed.entries.every(e=>e.name && e.reg && e.disciplineCode));
  assert.ok(!JSON.stringify(parsed.entries).includes('ELSOPYO'),'壞資料不得進入輸出');
  assert.deepEqual(reports.at(-1)?.nameOnlyMissing,[{ index:1, missing:['Name'], reg:'ELSOPYO--------TPE01',
    name:null, disciplineCode:'ELS' }]);
  assert.deepEqual(reports.at(-1)?.structuralMalformed,[]);
  assert.ok(!JSON.stringify(parsed).includes('ELSOPYO'));
  // Normal data is unchanged and carries no malformed list.
  const clean = extractTpeEntries({ participants:[ok(1),ok(2)] },'2026-09-22');
  assert.equal(clean.entries.length,2);
  assert.equal('malformed' in clean,false);
  const manyNameOnly = extractTpeEntries({ participants:[...[...Array(60).keys()].map(ok),
    ...[...Array(41).keys()].map(()=>broken)] },'2026-09-22',report);
  assert.equal(reports.at(-1)?.nameOnlyMissing.length,41);
  assert.equal(reports.at(-1)?.structuralMalformed.length,0);
  assert.equal(manyNameOnly.entries.length,60);
  assert.ok(!JSON.stringify(manyNameOnly).includes('ELSOPYO'));
  const noDisc = { Org:'TPE', Reg:'NO-DISC', Name:'ATHLETE' };
  const noReg = { Org:'TPE', Disc:'SWM', Name:'ATHLETE' };
  extractTpeEntries({ participants:[...many,noDisc,noReg] },'2026-09-22',report);
  assert.deepEqual(reports.at(-1)?.structuralMalformed.map(b=>b.missing),[['Disc'],['Reg']]);
  assert.equal(reports.at(-1)?.nameOnlyMissing.length,0);
  assert.throws(()=>extractTpeEntries({ participants:[...many.slice(0,2),noDisc] },'2026-09-22'),
    /Schema change/,'大量結構損壞仍應 fail closed');
  assert.throws(()=>extractTpeEntries({ participants:[...[...Array(60).keys()].map(ok),
    ...[...Array(21).keys()].map(()=>noReg)] },'2026-09-22'),/Schema change/);
});
