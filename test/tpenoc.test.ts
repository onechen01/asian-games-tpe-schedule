import test from 'node:test';import assert from 'node:assert/strict';import { readFile } from 'node:fs/promises';
import { parseTpenoc } from '../src/parsers/tpenoc.ts';
import type { Fragment } from '../src/parsers/tpenoc.ts';

const load = async (file:string)=>JSON.parse(await readFile(file,'utf8'));
const sample = async ()=>{
  const { fragments } = await load('outputs/tpenoc-sample-2026-09-18-fragments.json') as { fragments:Fragment[] };
  return parseTpenoc(fragments,'2026名古屋亞運每日賽程表0918(0917_1800).pdf');
};

test('TPENOC PDF parses to the hand-checked 2026-09-18 rows',async()=>{
  const doc = await sample(), expected = await load('outputs/tpenoc-sample-2026-09-18.json');
  assert.equal(doc.scheduleDate,'2026-09-18');
  assert.equal(doc.updatedAtJst,'2026-09-17T18:00:00+09:00');
  assert.deepEqual(doc.unresolved,[]);
  assert.equal(doc.matches.length,expected.rows.length);
  for (const [i,row] of expected.rows.entries()) {
    const m = doc.matches[i];
    assert.deepEqual([m.sport,m.timeJst,m.event,m.opponent,m.venue,m.result,m.rank,m.note,m.athletes],
      [row.sport,row.timeJst,row.event,row.opponent,row.venue,row.result,row.rank,row.note,row.athletes]);
  }
});

test('Japanese start times convert to Asia/Taipei while the original is kept',async()=>{
  const doc = await sample();
  assert.deepEqual(doc.matches.map(m=>[m.timeJst,m.timeTaipei]),
    [['11:00','10:00'],['13:00','12:00'],['13:00','12:00'],['13:00','12:00'],['19:00','18:00']]);
  assert.equal(doc.matches[0].startTimeJst,'2026-09-18T11:00:00+09:00');
  assert.equal(doc.matches[0].startTimeTaipei,'2026-09-18T10:00:00+08:00');
});

test('Multi-line cells stay in their own column and names keep inner spaces',async()=>{
  const doc = await sample();
  const hockey = doc.matches.find(m=>m.sport==='曲棍球')!;
  // 20 names span five lines; the neighbouring opponent and venue must not be pulled in.
  assert.equal(hockey.athletes.length,20);
  assert.equal(hockey.athletes.at(-1),'王文岑');
  assert.equal(hockey.opponent,'南韓');
  assert.equal(hockey.venue,'岐阜縣綠地體育場');
  assert.deepEqual(hockey.noteLines,['A組：韓國、馬來西亞、哈薩','克、孟加拉、中國']);
  assert.ok(doc.matches.find(m=>m.sport==='排球')!.athletes.includes('陳 潔'));
});

test('A document without a parsable date fails closed',()=>{
  assert.throws(()=>parseTpenoc([{x:66,y:109,text:'日期：不明'}],'x.pdf'),/文件日期/);
  assert.throws(()=>parseTpenoc([{x:66,y:109,text:'日期：2026/9/18'}],'x.pdf'),/賽事列/);
});
