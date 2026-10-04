import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseSpecialEvents,specialEventsForDate} from '../src/special-events.ts';

test('the curated special-event registry contains only the two sourced ceremonies',async()=>{
  const events=parseSpecialEvents(JSON.parse(await readFile('data/reference/special-events.json','utf8')));
  assert.deepEqual(events.map(event=>event.ceremonyType),['OPENING','CLOSING']);
  assert.deepEqual(events.map(event=>event.startTimeTaipei),[
    '2026-09-19T17:00:00+08:00','2026-10-04T17:00:00+08:00',
  ]);
  assert.ok(events.every(event=>event.originalStartTime.endsWith('18:00:00+09:00')));
  assert.ok(events.every(event=>event.source.sourceUrl.includes('aichi-nagoya2026.org/files/')));
  assert.equal(specialEventsForDate(events,'2026-10-03').length,0,
    '運動頒獎典禮不得混入 specialEvents');
});

test('unknown ceremony types and missing provenance fail closed',()=>{
  const base={id:'x',kind:'CEREMONY',ceremonyType:'AWARD',titleZh:'頒獎典禮',date:'2026-10-03',
    originalStartTime:'2026-10-03T18:00:00+09:00',startTimeTaipei:'2026-10-03T17:00:00+08:00',
    originalTimezone:'Asia/Tokyo',displayTimezone:'Asia/Taipei',source:{}};
  assert.throws(()=>parseSpecialEvents({schemaVersion:1,events:[base]}),/Invalid special event/);
});
