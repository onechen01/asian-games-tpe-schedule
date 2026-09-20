import test from 'node:test';import assert from 'node:assert/strict';
import { extractTpe } from '../src/parsers/medals.ts';
import { advanceFor, stageOf } from '../web/lib/progression.ts';
import { readFile } from 'node:fs/promises';

const standings = (count:Record<string,unknown>)=>({ '0':{ Org:'CHN' }, '1':{ Org:'TPE', Count:count } });
const tpe = { ME_GOLD:{total:0}, ME_SILVER:{total:2}, ME_BRONZE:{total:1}, total:{total:3} };

test('the official TPE medal row is read as published',()=>{
  const m = extractTpe(standings(tpe),'2026-09-20T15:00:00Z','url');
  assert.deepEqual([m.gold,m.silver,m.bronze,m.total],[0,2,1,3]);
});

test('an inconsistent or missing medal row is refused, so the stored file survives',()=>{
  assert.throws(()=>extractTpe({ '0':{ Org:'CHN' } },'t','u'),/no TPE/);
  assert.throws(()=>extractTpe(standings({ ...tpe, total:{total:9} }),'t','u'),/add up/);
  assert.throws(()=>extractTpe(standings({ ...tpe, ME_GOLD:{total:-1} }),'t','u'),/integers/);
});

const row = (o:Partial<Parameters<typeof advanceFor>[0]>)=>({ date:'2026-09-20',
  startTimeTaipei:'2026-09-20T09:00:00+08:00', disciplineCode:'KTE', event:"Women's Individual Kata",
  phase:"Women's Individual Kata Round of 16", athletesEn:['CHIEN Hui-hsuan'], ...o });

test('an athlete listed in a later stage is advanced; a same-phase heat is not',()=>{
  const qf = row({ phase:"Women's Individual Kata Quarterfinals", startTimeTaipei:'2026-09-20T09:40:00+08:00' });
  const found = advanceFor(row({}),[qf])!;
  assert.equal(found.stage,'8強');
  assert.equal(found.nextTimeTaipei,'2026-09-20T09:40:00+08:00');
  // Another heat of the same phase proves nothing.
  assert.equal(advanceFor(row({}),[row({ startTimeTaipei:'2026-09-20T09:20:00+08:00' })]),null);
});

test('group games, classification and bronze matches are never read as advancing',()=>{
  for (const phase of ['Women Group Phase - Group C','Men Round Robin Pool C',
    "Women's Classification Match 5th-8th",'Repechage Round 1','Bronze Medal Bout']) {
    assert.equal(stageOf(phase),null,phase);
  }
  const group = row({ disciplineCode:'FBL', event:'Women', phase:'Women Group E' });
  assert.equal(advanceFor(group,[{ ...group, phase:'Women Group E', startTimeTaipei:'2026-09-23T18:30:00+08:00' }]),null);
});

test('a different athlete in the later unit does not advance this one',()=>{
  const qf = row({ phase:"Women's Individual Kata Quarterfinals", athletesEn:['SOMEONE Else'] });
  assert.equal(advanceFor(row({}),[qf]),null);
});

test('a later stage on another day is found and reported with its date',()=>{
  const final = row({ date:'2026-09-21', phase:"Women's Individual Kata Final",
    startTimeTaipei:'2026-09-21T15:20:00+08:00' });
  const found = advanceFor(row({ phase:"Women's Individual Kata Semifinals" }),[final])!;
  assert.equal(found.stage,'決賽');
  assert.equal(found.nextDate,'2026-09-21');
});

test('the real 9/20 data advances only through the official ladder',async()=>{
  const dates = ['2026-09-20','2026-09-21'];
  const all = (await Promise.all(dates.map(async d=>
    (JSON.parse(await readFile(`data/normalized/daily-${d}.json`,'utf8')).rows as never[])
      .map(r=>({ ...(r as object), date:d } as Parameters<typeof advanceFor>[0])))))
    .flat();
  const today = all.filter(r=>r.date === '2026-09-20');
  const advanced = today.map(r=>({ r, a:advanceFor(r,all) })).filter(x=>x.a);
  assert.ok(advanced.length >= 5);
  // Nothing was derived from a score, a rank or a medal flag.
  for (const { r, a } of advanced) {
    assert.ok(stageOf(r.phase)!.level < 6 || a!.stage === '決賽');
    assert.ok(!/group|classification|repechage|bronze/i.test(r.phase ?? ''));
  }
});
