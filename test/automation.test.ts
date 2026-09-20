import test from 'node:test';import assert from 'node:assert/strict';
import { withRetry, decode } from '../src/api/asianGames.ts';
import { qualityGate, changed } from '../src/parsers/publish-gate.ts';
import { mergeDaily } from '../src/parsers/merge-daily.ts';
import type { ResultsRow } from '../src/parsers/merge-daily.ts';

const noSleep = async ()=>{};
// A body that parses is a success on the first try; a body that does not is a transport
// fault, never evidence that nobody competed.
const attempt = (bodies:string[])=>{
  let i = 0;
  return async()=>decode(bodies[Math.min(i++, bodies.length-1)]).data;
};

test('a valid JSON body succeeds without a retry',async()=>{
  let calls = 0;
  const value = await withRetry(async()=>{ calls++; return decode('{"ok":true}').data; },{sleep:noSleep});
  assert.deepEqual(value,{ok:true});
  assert.equal(calls,1);
});

test('two non-JSON responses then a good one still succeed',async()=>{
  const run = attempt(['<html>503</html>','<html>503</html>','{"ok":true}']);
  let calls = 0;
  const value = await withRetry(async()=>{ calls++; return run(); },{sleep:noSleep});
  assert.deepEqual(value,{ok:true});
  assert.equal(calls,3);
});

test('three non-JSON responses fail, and the day is held back',async()=>{
  const run = attempt(['<html>503</html>']);
  let calls = 0;
  await assert.rejects(withRetry(async()=>{ calls++; return run(); },{sleep:noSleep}));
  assert.equal(calls,3);
  const gate = qualityGate({ daily:{ coverageComplete:false, rows:[] },
    schedule:{ errors:[], coverage:{ missing:[{kind:'schedule-daily'}], fetchComplete:false } } });
  assert.equal(gate.pass,false);
});

const good = { daily:{ date:'2026-09-23', coverageComplete:true, rows:[] as unknown[] },
  schedule:{ errors:[] as unknown[], coverage:{ missing:[] as unknown[], fetchComplete:true } } };
const clone = ()=>JSON.parse(JSON.stringify(good));

test('the quality gate refuses anything short of a clean sync',()=>{
  assert.equal(qualityGate(clone()).pass,true);
  const incomplete = clone(); incomplete.daily.coverageComplete = false;
  assert.equal(qualityGate(incomplete).pass,false);
  const missing = clone(); missing.schedule.coverage.missing = [{kind:'results'}];
  assert.ok(qualityGate(missing).reasons.some(r=>r.startsWith('missing')));
  const errored = clone(); errored.schedule.errors = [{error:'HTTP 503'}];
  assert.ok(qualityGate(errored).reasons.some(r=>r.startsWith('errors')));
  const duplicated = clone();
  duplicated.daily.rows = [{sources:{results:{id:'A'}}},{sources:{results:{id:'A'}}}];
  const gate = qualityGate(duplicated);
  assert.equal(gate.duplicates,1);
  assert.equal(gate.pass,false);
});

test('one failing day does not hold back the days that passed',()=>{
  const failed = clone(); failed.daily.coverageComplete = false;
  assert.equal(qualityGate(clone()).pass,true);
  assert.equal(qualityGate(failed).pass,false);
});

test('identical canonical content is not a change, but an official time edit is',async()=>{
  const before = { generatedAt:'2026-09-20T02:00:00Z', rows:[{unit:'A',startTimeTaipei:'2026-09-20T12:00:00+08:00'}] };
  const sameAgain = { generatedAt:'2026-09-20T09:00:00Z', rows:[{unit:'A',startTimeTaipei:'2026-09-20T12:00:00+08:00'}] };
  const moved = { generatedAt:'2026-09-20T09:00:00Z', rows:[{unit:'A',startTimeTaipei:'2026-09-20T13:30:00+08:00'}] };
  assert.equal(changed(sameAgain,before),false);
  assert.equal(changed(moved,before),true);
});

const row = (r:Partial<ResultsRow>):ResultsRow=>({ id:'u1', unitId:'u1', disciplineCode:'BDM',
  startTimeTaipei:'2026-09-23T10:00:00+08:00', hasTpe:null, orgs:[], ...r });
const results = (rows:ResultsRow[])=>({ date:'2026-09-23', rows,
  coverage:{ fetchComplete:true, missing:[], sports:['BDM'] } });

test('a bracket placeholder is never presented as a confirmed Taiwan start',()=>{
  const merged = mergeDaily(results([row({ unitName:'Winner Match 12', hasTpe:null, orgs:[] })]),null,null);
  assert.ok(merged.rows.every(r=>r.participationState !== 'TPE_CONFIRMED'));
  assert.equal(merged.rows.filter(r=>r.participationState === 'PARTICIPANTS_TBD').length,1);
});

test('a future day with no Taiwan event still accepts one once the official data lists it',()=>{
  const empty = mergeDaily(results([]),null,null);
  assert.equal(empty.rows.filter(r=>r.participationState === 'TPE_CONFIRMED').length,0);
  assert.equal(empty.officialNoCompetition,true);
  const later = mergeDaily(results([row({ hasTpe:true, orgs:['TPE','JPN'],
    competitors:[{org:'TPE',name:'Chinese Taipei'},{org:'JPN',name:'Japan'}] })]),null,null);
  const confirmed = later.rows.filter(r=>r.participationState === 'TPE_CONFIRMED');
  assert.equal(confirmed.length,1);
  assert.equal(confirmed[0].opponentCode,'JPN');
  assert.notEqual(later.officialNoCompetition,true);
});
