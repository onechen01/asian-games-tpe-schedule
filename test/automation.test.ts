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

import { isAutomationFailure, runExitCode } from '../src/parsers/publish-gate.ts';
import { readFile as readFileAsync } from 'node:fs/promises';

test('a day that produced nothing is an automation failure, not a quiet no-change',()=>{
  assert.equal(isAutomationFailure(['daily-missing']),true);
  assert.equal(isAutomationFailure(['fetch-failed: Missing data/normalized/disciplines.json']),true);
  assert.equal(isAutomationFailure(['merge-failed: boom']),true);
  // An incomplete official sync is the safe, expected outcome.
  assert.equal(isAutomationFailure(['coverageComplete-false','missing-1','errors-1']),false);
  const allBroken = [1,2,3].map(n=>({date:`2026-09-2${n}`,reasons:['daily-missing']}));
  assert.equal(runExitCode(allBroken,3,0),1);
  const apiHeld = [{date:'2026-09-22',reasons:['missing-1','errors-1']}];
  assert.equal(runExitCode(apiHeld,3,2),0,'部分日期官方資料不完整仍保留舊 canonical，屬正常');
  assert.equal(runExitCode([{date:'x',reasons:['daily-missing']}],3,2),0);
});

test('the updater fetches its generated inputs instead of trusting an untracked working copy',async()=>{
  const script = await readFileAsync('scripts/update-results.ts','utf8');
  const ignored = await readFileAsync('.gitignore','utf8');
  // These inputs are gitignored, so a fresh checkout has neither; both must be rebuildable.
  for (const [file,builder] of [['data/normalized/disciplines.json','scripts/fetch-disciplines.ts'],
    ['data/normalized/tpe-entries.json','scripts/fetch-entries.ts']]) {
    assert.ok(script.includes(file) && script.includes(builder),`${file} 未在 updater 自動補齊`);
    await readFileAsync(builder,'utf8');
  }
  assert.ok(ignored.includes('data/normalized/*'));
  // Child failures are reported, never swallowed into a silent success.
  assert.ok(script.includes('process.exit(1)'));
  assert.ok(script.includes('runExitCode'));
});

test('a day that produced nothing carries the child process reason, never a bare label',async()=>{
  const script = await readFileAsync('scripts/update-results.ts','utf8');
  // The hold reason for a broken day must include the child's own output.
  assert.ok(/reasons:broken \? \[\.\.\.gate\.reasons, `\$\{label\}: \$\{why\}`\]/.test(script));
  assert.ok(script.includes('fetch-failed(exit'));
  assert.ok(script.includes('merge-failed(exit'));
  // Bootstrap verifies the file is really on disk before the daily loop starts.
  assert.ok(script.includes('existsSync(resolve(ROOT,file))'));
  assert.ok(script.includes('bootstrap 失敗'));
});

import { recoverMissing } from '../src/utils/recovery.ts';
import { RETRY_DELAYS } from '../src/api/asianGames.ts';

test('a single request waits longer between its three attempts',()=>{
  assert.deepEqual(RETRY_DELAYS.slice(0,2),[5000,15000]);
});

test('recovery repeats only the failed endpoints, and the day passes when they come back',async()=>{
  const failed = [{ endpoint:'A' },{ endpoint:'B' }];
  const tried:string[] = [];
  const out = await recoverMissing(failed, async(i)=>{ tried.push(i.endpoint); return true; },{ sleep:async()=>{} });
  assert.deepEqual(tried,['A','B'],'不得重抓已成功的端點');
  assert.equal(out.recovered.length,2);
  assert.equal(out.remaining.length,0);
  // With nothing left missing the existing gate passes unchanged.
  assert.equal(qualityGate({ daily:{ coverageComplete:true, rows:[] },
    schedule:{ errors:[], coverage:{ missing:[], fetchComplete:true } } }).pass,true);
});

test('a still-failing endpoint holds the day, and the gate is not relaxed',async()=>{
  const out = await recoverMissing([{ endpoint:'A' }], async()=>false, { sleep:async()=>{} });
  assert.equal(out.recovered.length,0);
  assert.equal(out.remaining.length,1);
  const gate = qualityGate({ daily:{ coverageComplete:false, rows:[] },
    schedule:{ errors:[{}], coverage:{ missing:[{}], fetchComplete:false } } });
  assert.equal(gate.pass,false);
  assert.equal(isAutomationFailure(gate.reasons),false,'官方資料不完整仍是 HOLD，不是 automation 失敗');
});

test('a clean run never enters recovery',async()=>{
  let started = 0;
  const out = await recoverMissing([], async()=>true, { sleep:async()=>{ started++; } });
  assert.equal(started,0);
  assert.deepEqual([out.attempted.length,out.recovered.length,out.remaining.length],[0,0,0]);
});
