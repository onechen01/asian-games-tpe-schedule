import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../src/parsers/schedule.ts';
import { confirmFromQualifiedCompetitors, officialQualifiedCompetitors,
  parseRequestedResult } from '../src/parsers/results.ts';
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

test('only an explicit official Qualified marker is progression evidence',()=>{
  const row=unit('OFFICIAL');
  const payload={Info:{Key:key,Status:'OFFICIAL'},Competitors:[
    {Org:'TPE',Name:'Qualified Athlete',Reg:'1',Result:'137.148',Rk:'7',Qualified:'Q'},
    {Org:'TPE',Name:'Ranked Only',Reg:'2',Result:'136.000',Rk:'8',Qualified:''},
  ]};
  const parsed=parseRequestedResult(payload,row,key)!;
  assert.deepEqual(parsed.competitors.map(c=>c.qualified),['Q',null]);
  assert.deepEqual(officialQualifiedCompetitors(payload,row,key).map(c=>c.name),['Qualified Athlete']);
  assert.deepEqual(officialQualifiedCompetitors({...payload,Info:{Key:key,Status:'UNOFFICIAL'}},row,key),[],
    'rank and a provisional marker never seed the next phase before Results is official');
  const next=normalize({Key:'M.TEST--------------.NEXT.000100--',Disc:'WSU',
    Event:'M.TEST--------------',Phase:'M.TEST--------------.NEXT',Orgs:[],Status:'SCHEDULED',
    DateTimeRaw:'2026-09-24T14:30:00+09:00'},source);
  assert.equal(confirmFromQualifiedCompetitors(next,parsed.competitors),true);
  assert.equal(next.hasTpe,true);
  assert.deepEqual(next.competitors.map(c=>({name:c.name,result:c.result,rank:c.rank,qualified:c.qualified})),[
    {name:'Qualified Athlete',result:null,rank:null,qualified:'Q'},
  ],'only identity and the official progression marker cross into the next phase');
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

test('started or completed confirmed-TPE results reject an incomplete competitor snapshot',()=>{
  for(const status of ['RUNNING','OFFICIAL']) {
    const row=unit(status);
    assert.throws(()=>parseRequestedResult({Info:{Key:key,Status:status},Competitors:[]},row,key),
      /confirmed TPE competitor is missing/);
    assert.throws(()=>parseRequestedResult({Info:{Key:key,Status:status},
      Competitors:[{Org:'JPN',Name:'Athlete B'}]},row,key),/confirmed TPE competitor is missing/);
  }
  const row=unit('START_LIST');
  assert.throws(()=>parseRequestedResult({Info:{Key:key,Status:'START_LIST',ShowResults:true},
    Competitors:[]},row,key),/confirmed TPE competitor is missing/);
});

test('blank organisation-only TPE competitor remains a valid result',()=>{
  const row=unit('OFFICIAL');
  const parsed=parseRequestedResult({Info:{Key:key,Status:'OFFICIAL',ShowResults:true},
    Competitors:[{Org:'TPE',Name:'Chinese Taipei',Reg:'SWMX4X100MMD---TPE01',
      Members:[],Result:'',Rk:''}]},row,key);
  assert.equal(parsed?.competitors[0].org,'TPE');
  assert.equal(parsed?.competitors[0].name,'Chinese Taipei');
  assert.equal(parsed?.competitors[0].result,'');
  assert.equal(parsed?.competitors[0].rank,'');
  assert.deepEqual(parsed?.competitors[0].members,[]);
});

test('individual, multiple-entrant, and relay TPE result structures remain valid',()=>{
  const row=unit('OFFICIAL');
  const info={Key:key,Status:'OFFICIAL',ShowResults:true};
  const individual=parseRequestedResult({Info:info,
    Competitors:[{Org:'TPE',Name:'Athlete A',Reg:'1',Result:'28.39',Rk:'6'}]},row,key);
  assert.equal(individual?.competitors[0].result,'28.39');

  const multiple=parseRequestedResult({Info:info,Competitors:[
    {Org:'TPE',Name:'Athlete A',Reg:'1',Result:'27.13',Rk:'4'},
    {Org:'TPE',Name:'Athlete B',Reg:'2',Result:'27.52',Rk:'5'},
  ]},row,key);
  assert.deepEqual(multiple?.competitors.map(c=>c.name),['Athlete A','Athlete B']);

  const relay=parseRequestedResult({Info:info,Competitors:[{Org:'TPE',Name:'Chinese Taipei',
    Reg:'SWMW4X100MMD---TPE01',Result:'4:08.83',Rk:'2',Members:[
      {Name:'Athlete A',Org:'TPE'},{Name:'Athlete B',Org:'TPE'},
    ]}]},row,key);
  assert.deepEqual(relay?.competitors[0].members.map(m=>m.name),['Athlete A','Athlete B']);
});

test('not-started confirmed-TPE results may still have no competitors',()=>{
  const row=unit('START_LIST');
  const parsed=parseRequestedResult({Info:{Key:key,Status:'START_LIST',ShowResults:false},
    Competitors:[]},row,key);
  assert.deepEqual(parsed?.competitors,[]);
});

test('non-SWM results retain the same guarded and valid behavior',()=>{
  const row=normalize({Key:key,Disc:'JUD',Event:'M.TEST--------------',EventDesc:'Test event',
    Phase:phase,PhaseDesc:'Final',UnitDesc:'Final',ResCode:key,Orgs:['TPE'],Status:'OFFICIAL',
    DateTimeRaw:'2026-09-23T14:30:00+09:00'},source);
  assert.equal(parseRequestedResult({Info:{Key:key,Status:'OFFICIAL'},
    Competitors:[{Org:'TPE',Name:'Judoka A',Result:'10'}]},row,key)?.competitors[0].name,'Judoka A');
  assert.throws(()=>parseRequestedResult({Info:{Key:key,Status:'OFFICIAL'},Competitors:[]},row,key),
    /confirmed TPE competitor is missing/);
});
