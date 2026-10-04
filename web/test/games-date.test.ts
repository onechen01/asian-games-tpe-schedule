import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GAMES_FIRST,GAMES_LAST,resolveScheduleDate,scheduleHeading,scheduleNavigation} from '../lib/games-date.ts';
import {loadSchedule} from '../lib/load.ts';
import {parseDaily} from '../lib/schedule.ts';

test('default and requested dates clamp to the published Games period',()=>{
 const cases:[string,string][]=[
  ['2026-09-09','2026-09-10'],
  ['2026-09-10','2026-09-10'],
  ['2026-10-03','2026-10-03'],
  ['2026-10-04','2026-10-04'],
  ['2026-10-05','2026-10-04'],
  ['2027-06-01','2026-10-04'],
 ];
 for(const [today,expected] of cases)assert.equal(resolveScheduleDate(undefined,today).date,expected,today);
 assert.equal(GAMES_FIRST,'2026-09-10');
 assert.equal(GAMES_LAST,'2026-10-04');
});

test('manual out-of-period dates clamp before schedule loading',async()=>{
 const after=resolveScheduleDate('2026-10-05','2026-10-05');
 assert.deepEqual(after,{date:'2026-10-04',reason:'after-games'});
 assert.equal((await loadSchedule(after.date)).kind,'ready');
 assert.deepEqual(resolveScheduleDate('2026-09-09','2026-09-09'),
  {date:'2026-09-10',reason:'before-games'});
});

test('navigation stops at both Games boundaries and post-Games copy names the final day',()=>{
 assert.deepEqual(scheduleNavigation('2026-09-10'),{previous:null,next:'2026-09-11'});
 assert.deepEqual(scheduleNavigation('2026-10-04'),{previous:'2026-10-03',next:null});
 const visited:string[]=[];
 for(let date=GAMES_FIRST;date;date=scheduleNavigation(date).next??'')visited.push(date);
 assert.equal(visited[0],GAMES_FIRST);
 assert.equal(visited.at(-1),GAMES_LAST);
 assert.equal(new Set(visited).size,visited.length);
 assert.equal(scheduleHeading('2026-10-04','2026-10-05'),'最後比賽日賽程');
 assert.equal(scheduleHeading('2026-10-04','2027-01-01'),'最後比賽日賽程');
});

test('opening and closing days remain readable with their existing cards',async()=>{
 const opening=parseDaily(JSON.parse(await readFile('data/normalized/daily-2026-09-19.json','utf8')),'2026-09-19');
 assert.equal(opening.specialEvents?.[0]?.ceremonyType,'OPENING');
 const closing=parseDaily(JSON.parse(await readFile('data/normalized/daily-2026-10-04.json','utf8')),'2026-10-04');
 assert.equal(closing.specialEvents?.[0]?.ceremonyType,'CLOSING');
 assert.equal(closing.rows.length,2);
});
