import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {parseRoster,matchAthleteName,chineseNamesFor,normalizeName} from '../lib/roster.ts';
import {displayNames,parseDaily,taiwanRows} from '../lib/schedule.ts';
import {loadRoster} from '../lib/load.ts';
import type {Row} from '../lib/schedule.ts';

const roster = async ()=>parseRoster(JSON.parse(await readFile('data/reference/tpe-roster-2026.json','utf8')));
const daily = async ()=>parseDaily(JSON.parse(await readFile('data/normalized/daily-2026-09-18.json','utf8')),'2026-09-18');

const TST:[string,string][] = [['CHEN Yu-hsun','陳郁勲'],['CHEN Po-yi','陳柏邑'],['YU Kai-wen','余凱文'],
  ['LIN Wei-chieh','林韋傑'],['CHANG Yu-sung','張祐菘'],['HUANG Shih-yuan','黃詩媛'],
  ['HSU Chiao-ying','徐巧楹'],['ZHOU Yan-zhen','周宴甄'],['CHIANG Min-yu','江旻育'],['LO Shu-ting','羅舒婷']];

test('the reference file declares itself reference-only',async()=>{
  const r = await roster();
  assert.equal(r.metadata.referenceOnly,true);
  assert.equal(r.metadata.notForParticipation,true);
  assert.equal(r.metadata.rosterMayBeOutdated,true);
});

test('all ten soft tennis athletes resolve with high confidence',async()=>{
  const r = await roster();
  for (const [en,zh] of TST) {
    const m = matchAthleteName(en,'TST',r);
    assert.equal(m.status,'MATCHED_HIGH',`${en} 未高信心對應`);
    assert.equal(m.zh,zh);
  }
  assert.equal(matchAthleteName('chen  YU--HSUN','TST',r).zh,'陳郁勲');
  assert.equal(normalizeName('CHEN Yu-hsun'),'CHEN YU HSUN');
});

test('lookup never crosses disciplines and never guesses on surname alone',async()=>{
  const r = await roster();
  // The same athlete looked up under another discipline must not resolve.
  assert.equal(matchAthleteName('YU Kai-wen','BKB',r).status,'NO_MATCH');
  assert.equal(matchAthleteName('LIN Tieh','BKB',r).status,'NO_MATCH');
  // A shared surname is not a match.
  assert.equal(matchAthleteName('CHEN Something-else','TST',r).status,'NO_MATCH');
  assert.equal(matchAthleteName('LIN','TST',r).status,'NO_MATCH');
  assert.equal(matchAthleteName('CHEN Yu-hsun',null,r).status,'NO_MATCH');
});

test('ambiguity yields AMBIGUOUS and is never resolved automatically',()=>{
  const twin = {schemaVersion:1,metadata:{referenceOnly:true,notForParticipation:true,rosterMayBeOutdated:true},
    disciplines:[{disciplineCode:'ZZZ',sportZh:'測試',athletesZh:['甲一','甲二'],
      verifiedNames:[{en:'CHIA One',zh:'甲一'},{en:'Chia one',zh:'甲二'}]}]};
  const m = matchAthleteName('CHIA One','ZZZ',parseRoster(twin));
  assert.equal(m.status,'AMBIGUOUS');
  assert.equal(m.zh,null);
});

test('soft tennis rows with no committee names now show the five Chinese names',async()=>{
  const [data,r] = await Promise.all([daily(),roster()]);
  const rows = taiwanRows(data).filter(row=>row.disciplineCode==='TST' && row.athletes.length===0);
  assert.equal(rows.length,4);
  for (const row of rows) {
    const shown = displayNames(row,r);
    assert.equal(shown.fromReference,true);
    assert.equal(shown.names.length,5);
    assert.ok(shown.names.every(n=>/^[\u4e00-\u9fff]+$/.test(n)),'應全為中文姓名');
    // The English roster is still intact in the data.
    assert.equal(row.athletesEn.length,5);
  }
});

test('regression: the outdated squad list never replaces the daily line-up (林蝶 vs 羅蘋)',async()=>{
  const [data,r] = await Promise.all([daily(),roster()]);
  const bkb = taiwanRows(data).find(row=>row.disciplineCode==='BKB')!;
  const shown = displayNames(bkb,r);
  assert.equal(shown.fromReference,false);
  assert.ok(shown.names.includes('林蝶'),'每日資料的林蝶必須保留');
  assert.ok(!shown.names.includes('羅蘋'),'舊名單的羅蘋不得出現');
  assert.ok(!shown.names.includes('羅 蘋'));
  assert.equal(shown.names.length,bkb.athletes.length);
  assert.deepEqual(shown.names,bkb.athletes);
  // The reference file does still carry the outdated name; it simply must never be used here.
  const squad = r.disciplines.find(d=>d.disciplineCode==='BKB')!;
  assert.ok(squad.athletesZh.includes('羅 蘋'));
  assert.ok(!squad.athletesZh.includes('林蝶'));
});

test('a partial resolution shows nothing rather than an incomplete line-up',async()=>{
  const r = await roster();
  const row = {disciplineCode:'TST',athletes:[],athletesEn:['YU Kai-wen','SOMEONE Unknown']} as unknown as Row;
  assert.deepEqual(displayNames(row,r),{names:[],fromReference:false});
  assert.equal(chineseNamesFor(['YU Kai-wen','SOMEONE Unknown'],'TST',r).complete,false);
});

test('a missing reference file degrades quietly',async()=>{
  assert.equal(await loadRoster('data/reference/does-not-exist.json'),null);
  const row = {disciplineCode:'TST',athletes:[],athletesEn:['YU Kai-wen']} as unknown as Row;
  assert.deepEqual(displayNames(row,null),{names:[],fromReference:false});
});
