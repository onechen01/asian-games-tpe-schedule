import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {extractTpeMedalAwards,buildMedalLedger,ledgerContentChanged} from '../lib/medal-awards.ts';
import type {MedalAwardSource} from '../lib/medal-awards.ts';

const row = (o:Partial<MedalAwardSource>):MedalAwardSource=>({ status:'OFFICIAL',
  disciplineCode:'KTE', event:"Men's Kumite -67kg", phase:"Men's Kumite -67kg Bronze Medal Bout",
  date:'2026-09-21', startTimeTaipei:'2026-09-21T10:00:00+08:00',
  sources:{ results:{ unitId:'M.67KG--------------.REPF.000100--', id:'KTE:M.67KG--------------.REPF.000100--' } },
  ...o });

test('unit-level individual medal produces one award keyed by resultId',()=>{
  const awards = extractTpeMedalAwards(row({ tpeMedal:'ME_BRONZE', tpeRank:'3', athletesEn:['SHIH Cheng-chung'] }));
  assert.equal(awards.length,1);
  assert.equal(awards[0].medal,'ME_BRONZE');
  assert.equal(awards[0].awardId,'KTE:M.67KG--------------.REPF.000100--');
  assert.deepEqual(awards[0].athletes,['SHIH Cheng-chung']);
});

test('a team medal produces exactly one award regardless of roster size',()=>{
  const awards = extractTpeMedalAwards(row({ disciplineCode:'TST', event:"Women's Team",
    phase:'Women\'s Team Finals Gold Medal Match',
    sources:{ results:{ unitId:'W.TEAM--------------.FNL-.00010000', id:'TST:W.TEAM--------------.FNL-.00010000' } },
    tpeMedal:'ME_SILVER', tpeRank:'2',
    athletesEn:['ZHOU Yan-zhen','CHIANG Min-yu','LO Shu-ting','HSU Chiao-ying','HUANG Shih-yuan'] }));
  assert.equal(awards.length,1);
  assert.equal(awards[0].medal,'ME_SILVER');
  assert.equal(awards[0].athletes.length,5);
});

test('an aggregate unit with a single Chinese Taipei entrant reads the unit-level medal',()=>{
  const awards = extractTpeMedalAwards(row({ disciplineCode:'WSU', event:"Men's Taijiquan & Taijijian",
    resultScope:'aggregate',
    sources:{ results:{ unitId:'M.TAIJ--------------.FNL-.000200--', id:'WSU:M.TAIJ--------------.FNL-.000200--' } },
    tpeMedal:'ME_SILVER', tpeRank:'2', athletesEn:['SUN Chia-hung'] }));
  assert.equal(awards.length,1);
  assert.equal(awards[0].medal,'ME_SILVER');
});

test('an aggregate unit with two Chinese Taipei entrants reads the medal off the medalled entrant only',()=>{
  const awards = extractTpeMedalAwards(row({ disciplineCode:'WSU', event:"Men's Nanquan & Nangun",
    resultScope:'aggregate', tpeMedal:null,
    sources:{ results:{ unitId:'M.NANG--------------.FNL-.000200--', id:'WSU:M.NANG--------------.FNL-.000200--' } },
    tpeEntrants:[
      { name:'LIU Chang-min', registration:'6020214', rank:'3', medal:'ME_BRONZE' },
      { name:'HUANG Wen-sheng', registration:'16537768', rank:'4' },
    ] }));
  assert.equal(awards.length,1);
  assert.equal(awards[0].medal,'ME_BRONZE');
  assert.deepEqual(awards[0].athletes,['LIU Chang-min']);
  assert.equal(awards[0].awardId,'WSU:M.NANG--------------.FNL-.000200--#6020214');
  assert.equal(awards[0].identityUnstable,undefined);
});

test('synthetic: two Chinese Taipei entrants in the same aggregate unit each medal, producing two distinct awards',()=>{
  const awards = extractTpeMedalAwards(row({ disciplineCode:'SHO', event:"Synthetic Pair Event",
    resultScope:'aggregate', tpeMedal:null,
    sources:{ results:{ unitId:'X.PAIR--------------.FNL-.000900--', id:'SHO:X.PAIR--------------.FNL-.000900--' } },
    tpeEntrants:[
      { name:'ATHLETE A', registration:'111', rank:'1', medal:'ME_GOLD' },
      { name:'ATHLETE B', registration:'222', rank:'2', medal:'ME_SILVER' },
    ] }));
  assert.equal(awards.length,2);
  const ids = awards.map(a=>a.awardId).sort();
  assert.deepEqual(ids,['SHO:X.PAIR--------------.FNL-.000900--#111','SHO:X.PAIR--------------.FNL-.000900--#222']);
  assert.deepEqual(new Set(awards.map(a=>a.medal)),new Set(['ME_GOLD','ME_SILVER']));
});

test('a component result never produces an award, even if medal-shaped fields are present',()=>{
  const componentUnit = row({ disciplineCode:'WSU', resultScope:'component',
    tpeMedal:'ME_GOLD', athletesEn:['SUN Chia-hung'] });
  assert.deepEqual(extractTpeMedalAwards(componentUnit),[]);
  const componentAggregateEntrant = row({ disciplineCode:'WSU', resultScope:'component', tpeMedal:null,
    tpeEntrants:[{ name:'LIU Chang-min', registration:'6020214', rank:'5', medal:'ME_BRONZE' }] });
  assert.deepEqual(extractTpeMedalAwards(componentAggregateEntrant),[]);
});

test('a unit-level medal blocks the entrant-level path, so one official medal never becomes two awards',()=>{
  const awards = extractTpeMedalAwards(row({ resultScope:'aggregate', tpeMedal:'ME_GOLD',
    tpeEntrants:[{ name:'SOMEONE', registration:'1', rank:'1', medal:'ME_BRONZE' }] }));
  assert.equal(awards.length,1);
  assert.equal(awards[0].medal,'ME_GOLD');
});

test('awardId is stable across repeated calls on the same row',()=>{
  const r = row({ tpeMedal:'ME_BRONZE', tpeRank:'3' });
  assert.equal(extractTpeMedalAwards(r)[0].awardId, extractTpeMedalAwards(r)[0].awardId);
  const aggregate = row({ resultScope:'aggregate', tpeMedal:null,
    tpeEntrants:[{ name:'X', registration:'999', rank:'1', medal:'ME_GOLD' }] });
  assert.equal(extractTpeMedalAwards(aggregate)[0].awardId, extractTpeMedalAwards(aggregate)[0].awardId);
});

test('a missing registration falls back to the entrant rank, never to the athlete name, and is not flagged unstable',()=>{
  const awards = extractTpeMedalAwards(row({ resultScope:'aggregate', tpeMedal:null,
    tpeEntrants:[{ name:'NO REG ATHLETE', registration:null, rank:'2', medal:'ME_SILVER' }] }));
  assert.equal(awards.length,1);
  assert.match(awards[0].awardId,/#2$/);
  assert.equal(awards[0].identityUnstable,undefined);
});

test('a missing registration AND rank falls back to a positional identity, flagged unstable',()=>{
  const awards = extractTpeMedalAwards(row({ resultScope:'aggregate', tpeMedal:null,
    tpeEntrants:[{ name:'NO ID ATHLETE', registration:null, rank:null, medal:'ME_SILVER' }] }));
  assert.equal(awards.length,1);
  assert.match(awards[0].awardId,/#entrant-0$/);
  assert.equal(awards[0].identityUnstable,true);
});

// The Games are still running, so the medal count grows. This asserts the invariants that must
// hold at any count rather than a frozen total, which would start failing the moment a new medal
// lands and would tempt someone to "fix" it by editing the number.
const realCanonicalRows = async()=>{
  const {readdir} = await import('node:fs/promises');
  const dir = 'data/normalized';
  const files = (await readdir(dir)).filter(f=>/^daily-\d{4}-\d{2}-\d{2}\.json$/.test(f));
  const rows:MedalAwardSource[] = [];
  for (const f of files) rows.push(...(JSON.parse(await readFile(`${dir}/${f}`,'utf8')).rows ?? []));
  return rows;
};

test('the real canonical data yields one award per official medal, with stable unique identities',async()=>{
  const rows = await realCanonicalRows();
  const counts = { gold:0, silver:0, bronze:0, total:0 };
  const ledger = buildMedalLedger(rows, counts, '2026-09-25T00:00:00Z');
  const {gold,silver,bronze,total} = ledger.ledgerCounts;
  assert.equal(gold+silver+bronze,total);
  // Every award is uniquely identified, and no identity fell back to an unstable one.
  assert.equal(new Set(ledger.awards.map(a=>a.awardId)).size, ledger.awards.length);
  assert.equal(ledger.awards.filter(a=>a.identityUnstable).length,0);
  // A component result never becomes a medal, whatever else changes.
  assert.equal(rows.filter(r=>r.resultScope==='component').flatMap(r=>extractTpeMedalAwards(r)).length,0);
  // The two cases this extractor was built around: an entrant-level medal inside a multi-entrant
  // aggregate unit, and a unit-level one that only a manual backfill recovered.
  assert.ok(ledger.awards.some(a=>a.athletes.includes('LIU Chang-min') && a.medal==='ME_BRONZE'
    && a.awardId.includes('#')));
  assert.ok(ledger.awards.some(a=>a.athletes.includes('CHEN Po-yi') && a.medal==='ME_BRONZE'));
});

test('an official total higher than what canonical currently has yields a partial ledger, keeping every known award',async()=>{
  const rows = await realCanonicalRows();
  const actual = buildMedalLedger(rows, { gold:0, silver:0, bronze:0, total:0 }, '2026-09-25T00:00:00Z').ledgerCounts;
  // One more bronze than canonical can see, whatever canonical currently holds.
  const ledger = buildMedalLedger(rows,
    { ...actual, bronze:actual.bronze+1, total:actual.total+1 }, '2026-09-25T00:00:00Z');
  assert.equal(ledger.completeness,'partial');
  // A partial ledger still publishes everything it does know, and never invents the shortfall.
  assert.equal(ledger.awards.length,actual.total);
  assert.deepEqual(ledger.missing,{ gold:0, silver:0, bronze:1, total:1 });
});

// The real shape of the 9/25 skateboarding silver: an eight-competitor final with no head-to-head
// opponent, where the officials put the medal straight onto the competitor. It needs no rule of
// its own -- the unit-level path already covers it -- and this pins that down.
test('a many-competitor final with an official medal on the competitor yields exactly one unit-level award',()=>{
  const awards = extractTpeMedalAwards(row({ disciplineCode:'SKB', event:"Women's Park",
    phase:"Women's Park Final", date:'2026-09-25',
    sources:{ results:{ unitId:'W.PARK--------------.FNL-.000100--', id:'SKB:W.PARK--------------.FNL-.000100--' } },
    tpeMedal:'ME_SILVER', tpeRank:'2', athletesEn:['LIN Yi-fan'] }));
  assert.equal(awards.length,1);
  assert.equal(awards[0].medal,'ME_SILVER');
  assert.equal(awards[0].awardId,'SKB:W.PARK--------------.FNL-.000100--');
  assert.ok(!awards[0].awardId.includes('#'));
});

// The 9/25 canoe bronze: the unit is OFFICIAL with a finishing time and Rk=3, but the officials
// have not put a Medal on any competitor in it, not even gold or silver. A rank in a medal final
// must never be promoted to a medal on its own, or the ledger starts guessing.
test('an official final with a medal-winning rank but no official Medal field yields no award',()=>{
  const awards = extractTpeMedalAwards(row({ disciplineCode:'CSP', event:"Men's Canoe Single 500m",
    phase:"Men's Canoe Single 500m Final", date:'2026-09-25',
    sources:{ results:{ unitId:'M.C1-500M-----------.FNL-.000100--', id:'CSP:M.C1-500M-----------.FNL-.000100--' } },
    tpeMedal:null, tpeRank:'3', athletesEn:['LAI Kuan-chieh'] }));
  assert.deepEqual(awards,[]);
});

// --- ledger lifecycle: what the updater relies on when it rebuilds the ledger every run ---

// One unit-level medal and one entrant-level medal inside a multi-entrant aggregate unit.
const twoMedalRows = ():MedalAwardSource[]=>[
  row({ tpeMedal:'ME_BRONZE', tpeRank:'3', athletesEn:['A ATHLETE'] }),
  row({ resultScope:'aggregate', tpeMedal:null, date:'2026-09-22',
    sources:{ results:{ unitId:'M.NANG--------------.FNL-.000200--', id:'WSU:M.NANG--------------.FNL-.000200--' } },
    tpeEntrants:[{ name:'B ATHLETE', registration:'6020214', rank:'3', medal:'ME_BRONZE' },
      { name:'C ATHLETE', registration:'16537768', rank:'4' }] }),
];

test('canonical and verified standings agreeing yields a complete ledger',()=>{
  const ledger = buildMedalLedger(twoMedalRows(), { gold:0, silver:0, bronze:2, total:2 },
    '2026-09-25T00:00:00Z', { verified:true, updatedAt:'2026-09-25T03:00:00Z' });
  assert.equal(ledger.completeness,'complete');
  assert.equal(ledger.standingsVerified,true);
  assert.deepEqual(ledger.missing,{ gold:0, silver:0, bronze:0, total:0 });
});

test('a medal newly present in canonical raises the ledger on the next build, with no code change',()=>{
  const before = buildMedalLedger(twoMedalRows(), { gold:0, silver:0, bronze:3, total:3 },
    't1', { verified:true, updatedAt:null });
  assert.equal(before.ledgerCounts.total,2);
  assert.equal(before.completeness,'partial');
  assert.deepEqual(before.missing,{ gold:0, silver:0, bronze:1, total:1 });
  // The officials fill in the Medal field on a third unit; nothing else changes.
  const after = buildMedalLedger([...twoMedalRows(),
    row({ disciplineCode:'CSP', event:"Men's Canoe Single 500m", date:'2026-09-25',
      sources:{ results:{ unitId:'M.C1-500M-----------.FNL-.000100--', id:'CSP:M.C1-500M-----------.FNL-.000100--' } },
      tpeMedal:'ME_BRONZE', tpeRank:'3', athletesEn:['LAI Kuan-chieh'] })],
    { gold:0, silver:0, bronze:3, total:3 }, 't2', { verified:true, updatedAt:null });
  assert.equal(after.ledgerCounts.total,3);
  assert.equal(after.completeness,'complete');
});

test('standings one ahead of canonical stays partial and never fabricates the missing award',()=>{
  const ledger = buildMedalLedger(twoMedalRows(), { gold:0, silver:0, bronze:3, total:3 },
    '2026-09-25T00:00:00Z', { verified:true, updatedAt:null });
  assert.equal(ledger.completeness,'partial');
  assert.equal(ledger.awards.length,2);
  assert.deepEqual(ledger.missing,{ gold:0, silver:0, bronze:1, total:1 });
});

// A standings outage must not let a lucky match read as confirmed: fetch-medals.ts keeps the old
// snapshot and still exits 0, and its updatedAt does not move when the counts are unchanged, so
// an unverified comparison is the only safe reading even when the numbers line up exactly.
test('an unverified standings snapshot can never report complete, even when the counts match',()=>{
  const matching = { gold:0, silver:0, bronze:2, total:2 };
  const verified = buildMedalLedger(twoMedalRows(), matching, 't', { verified:true, updatedAt:null });
  const stale = buildMedalLedger(twoMedalRows(), matching, 't', { verified:false, updatedAt:'2026-09-24T00:00:00Z' });
  assert.equal(verified.completeness,'complete');
  assert.equal(stale.completeness,'partial');
  assert.equal(stale.standingsVerified,false);
  assert.equal(stale.standingsUpdatedAt,'2026-09-24T00:00:00Z');
  // The awards themselves are unaffected: only the claim about completeness is withheld.
  assert.deepEqual(stale.awards.map(a=>a.awardId),verified.awards.map(a=>a.awardId));
});

test('an unchanged ledger is not rewritten, but a changed medal or official total is',()=>{
  const official = { gold:0, silver:0, bronze:2, total:2 };
  const first = buildMedalLedger(twoMedalRows(), official, '2026-09-25T01:00:00Z');
  const laterSameContent = buildMedalLedger(twoMedalRows(), official, '2026-09-25T02:00:00Z');
  assert.equal(ledgerContentChanged(laterSameContent, first),false);
  // A live standings fetch stamps the moment it checked, so that timestamp moves every run on its
  // own; by itself it must not count as a change or the ledger would churn on every updater pass.
  const reverified = buildMedalLedger(twoMedalRows(), official, '2026-09-25T03:00:00Z',
    { verified:true, updatedAt:'2026-09-25T03:00:00Z' });
  assert.equal(ledgerContentChanged(reverified, first),false);
  // Losing verification, though, is a real state change worth recording.
  const unverified = buildMedalLedger(twoMedalRows(), official, '2026-09-25T03:00:00Z',
    { verified:false, updatedAt:'2026-09-25T03:00:00Z' });
  assert.equal(ledgerContentChanged(unverified, first),true);
  assert.equal(ledgerContentChanged(first, null),true);
  const officialMoved = buildMedalLedger(twoMedalRows(), { ...official, bronze:3, total:3 }, '2026-09-25T02:00:00Z');
  assert.equal(ledgerContentChanged(officialMoved, first),true);
  const medalAdded = buildMedalLedger([...twoMedalRows(),
    row({ date:'2026-09-25', tpeMedal:'ME_GOLD', tpeRank:'1', athletesEn:['D ATHLETE'],
      sources:{ results:{ unitId:'X', id:'ZZZ:X' } } })], official, '2026-09-25T02:00:00Z');
  assert.equal(ledgerContentChanged(medalAdded, first),true);
});

// The remaining guarantees live in how the updater wires the rebuild in, not in any single
// function, so they are asserted against the scripts themselves. They are the reason a held day
// cannot reach the ledger and a failed rebuild cannot damage canonical.
test('the ledger reads published canonical only, never the staging directory',async()=>{
  // Comments are allowed to discuss staging; the code must not touch it.
  const code = (await readFile('scripts/build-medal-ledger.ts','utf8'))
    .split('\n').filter(line=>!line.trim().startsWith('//')).join('\n');
  assert.ok(code.includes("'data/normalized'"),'must read production canonical');
  assert.ok(!code.includes('data/staging'),'must never read the staging directory');
});

test('the updater rebuilds the ledger after publishing, and a failed rebuild cannot change the run outcome',async()=>{
  const src = await readFile('scripts/update-results.ts','utf8');
  const stagingCleanup = src.indexOf("rm(resolve(ROOT,'data/staging')");
  const ledgerRun = src.indexOf("run('scripts/build-medal-ledger.ts'");
  const exitCode = src.indexOf('process.exitCode = runExitCode(');
  assert.ok(stagingCleanup > 0 && ledgerRun > 0 && exitCode > 0);
  // Ordering: every day has been swapped in or held, and staging is gone, before the ledger runs.
  assert.ok(ledgerRun > stagingCleanup,'ledger must be rebuilt after canonical publish and staging cleanup');
  // spawnSync reports a crash as a status instead of throwing, so the rebuild cannot abort the run.
  assert.ok(/const ledger = run\('scripts\/build-medal-ledger\.ts'/.test(src));
  // The published/held bookkeeping that decides the exit code owes nothing to the ledger.
  const exitLine = src.slice(exitCode, src.indexOf('\n', exitCode));
  assert.ok(!exitLine.includes('ledger'),'exit code must not depend on the ledger rebuild');
});
