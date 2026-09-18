import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { decode, safeData } from '../src/api/asianGames.ts';
import { normalize, parseDaily } from '../src/parsers/schedule.ts';
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
