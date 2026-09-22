import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../src/parsers/schedule.ts';
import { parseRequestedResult } from '../src/parsers/results.ts';
import { mergeDaily } from '../src/parsers/merge-daily.ts';
import { qualityGate } from '../src/parsers/publish-gate.ts';

const key='M.TEST--------------.FNL-.000200--';
const phase='M.TEST--------------.FNL-';
const source={url:'https://example.invalid/schedule'};
const unit=(status:string)=>normalize({ Key:key,Disc:'WSU',Event:'M.TEST--------------',
  EventDesc:'Combined event',Phase:phase,PhaseDesc:'Final',UnitDesc:'Second routine',
  ResCode:key,Orgs:['TPE'],Status:status,DateTimeRaw:'2026-09-23T14:30:00+09:00' },source);

test('not-started 200 null leaves confirmed schedule publishable without a fabricated result',()=>{
  const row=unit('START_LIST');
  assert.equal(row.hasTpe,true);
  assert.equal(parseRequestedResult(null,row,key),null);
  const schedule={date:'2026-09-23',rows:[row],coverage:{fetchComplete:true,missing:[]},errors:[]};
  const daily=mergeDaily(schedule,null);
  assert.equal(daily.rows.length,1);
  assert.equal(daily.rows[0].participationState,'TPE_CONFIRMED');
  assert.equal(daily.rows[0].result,null);
  assert.equal(daily.coverageComplete,true);
  assert.equal(qualityGate({daily,schedule}).pass,true);
});

test('started or completed 200 null remains an error and fails the quality gate',()=>{
  for(const status of ['RUNNING','OFFICIAL','UNKNOWN']) {
    const row=unit(status);
    assert.throws(()=>parseRequestedResult(null,row,key),/Results identity\/structure mismatch/);
  }
  const schedule={coverage:{fetchComplete:false,missing:[{kind:'results'}]},errors:[{error:'null result'}]};
  const daily={date:'2026-09-23',coverageComplete:false,rows:[]};
  assert.equal(qualityGate({daily,schedule}).pass,false);
});

test('normal unit and aggregate JSON retain identity checks and competitor data',()=>{
  const row=unit('START_LIST');
  const competitor={Org:'TPE',Name:'Athlete A',Reg:'123'};
  const result=parseRequestedResult({Info:{Key:key,Status:'START_LIST'},
    Competitors:[competitor]},row,key);
  assert.equal(result?.competitors[0].name,'Athlete A');
  assert.equal(result?.sourceStatus,'START_LIST');
  const aggregateKey=`${phase}.--------`;
  const aggregate=parseRequestedResult({Info:{Key:aggregateKey,IsPhase:true,
    Event:row.eventId,Phase:phase,Status:'OFFICIAL'},Competitors:[competitor]},
  {...row,resultScope:'aggregate'},aggregateKey);
  assert.equal(aggregate?.competitors[0].registration,'123');
  assert.throws(()=>parseRequestedResult({Info:{Key:'wrong'},Competitors:[]},row,key));
  assert.throws(()=>parseRequestedResult({Info:{Key:key,IsPhase:true},Competitors:[]},row,key));
  assert.throws(()=>parseRequestedResult({},row,key));
});

test('schedule ResCode may identify a phase result for a different unitId',()=>{
  const phaseKey=`${phase}.--------`;
  const row=normalize({Key:'M.TEST--------------.FNL-.000001--',Disc:'GAR',
    Event:'M.TEST--------------',Phase:phase,ResCode:phaseKey,Orgs:['TPE'],
    Status:'SCHEDULED',DateTimeRaw:'2026-09-23T13:00:00+09:00'},source);
  const info={Key:phaseKey,IsPhase:true,Event:row.eventId,Phase:row.phaseId,Status:'START_LIST'};
  const payload={Info:info,Competitors:[{Org:'TPE',Name:'Team'}]};
  assert.equal(parseRequestedResult(payload,row,phaseKey)?.competitors[0].org,'TPE');
  for(const badInfo of [
    {...info,Key:'other'},
    {...info,IsPhase:false},
    {...info,Event:'M.OTHER-------------'},
    {...info,Phase:'M.TEST--------------.SFNL'},
  ]) assert.throws(()=>parseRequestedResult({Info:badInfo,Competitors:[]},row,phaseKey),
    /Results identity\/structure mismatch/);
  assert.throws(()=>parseRequestedResult(payload,row,row.unitId),/Results identity\/structure mismatch/);
});
