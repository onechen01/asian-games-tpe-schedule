import test from 'node:test';import assert from 'node:assert/strict';
import { extractScheduleList, toBroadcasts, gateBroadcasts, athleteHint, PROVIDER } from '../src/broadcast/elta.ts';

const page = (json:string)=>`<html><script>\n let schedule_list = ${json};\n</script></html>`;
const programme = (o:Record<string,unknown>)=>({ is_taipei_team:1, ...o });
const day = (list:Record<string,unknown>[])=>page(JSON.stringify(
  { '2026-09-21':Object.fromEntries(list.map((p,i)=>[String(i),p])) }));
const parse = (html:string, athletesByZh?:Map<string,string>)=>
  toBroadcasts(extractScheduleList(html),{ capturedAt:'2026-09-20', athletesByZh });

test('a Chinese Taipei programme becomes one record in the shared schema',()=>{
  const { records } = parse(day([programme({ format_s_time:'2026-09-21 17:20:00',
    program_desc:'亞運 南韓VS中華 棒球 預賽 9/21 LIVE', sport_item:{ sp_name:'棒球' } })]));
  assert.equal(records.length,1);
  const r = records[0];
  assert.equal(r.providerId,PROVIDER.providerId);
  assert.equal(r.providerName,'愛爾達');
  assert.equal(r.broadcastStartTimeTaipei,'2026-09-21T17:20:00+08:00');
  assert.equal(r.disciplineCode,'BBL');
  assert.equal(r.matchLevel,'unit');
  assert.deepEqual(r.matchHint.opponentCodes,['KOR']);
  assert.equal(r.feed,'main');
});

test('原音 is kept as its own feed',()=>{
  const { records } = parse(day([programme({ format_s_time:'2026-09-21 09:50:00',
    program_desc:'亞運 中國VS中華 曲棍球 女子預賽 9/21(原音) LIVE', sport_item:{ sp_name:'曲棍球' } })]));
  assert.equal(records[0].feed,'original');
  assert.equal(records[0].note,'原音');
});

test('a named athlete gives a unit hint, an unnamed session stays at discipline level',()=>{
  const byZh = new Map([['甘家葳','KAN Chia-wei'],['杜承翰','TU Cheng-han']]);
  const { records } = parse(day([
    programme({ format_s_time:'2026-09-21 20:30:00', program_desc:'亞運 甘家葳 拳擊 男子70公斤級預賽 9/21 D-LIVE',
      sport_item:{ sp_name:'拳擊' } }),
    programme({ format_s_time:'2026-09-21 13:00:00', program_desc:'亞運 中華隊 游泳 預賽 9/21 LIVE',
      sport_item:{ sp_name:'游泳' } })]),byZh);
  const box = records.find(r=>r.disciplineCode === 'BOX')!;
  assert.equal(box.matchLevel,'unit');
  assert.deepEqual(box.matchHint.athleteNames,['KAN Chia-wei']);
  const swim = records.find(r=>r.disciplineCode === 'SWM')!;
  assert.equal(swim.matchLevel,'discipline');
  // Two names in one title is not a safe hint.
  assert.deepEqual(athleteHint('杜承翰/甘家葳 空手道',byZh),[]);
  assert.deepEqual(athleteHint('中華隊 游泳 預賽',byZh),[]);
});

test('several programmes of one sport on one day all survive, duplicates do not',()=>{
  const { records } = parse(day([
    programme({ format_s_time:'2026-09-21 08:55:00', program_desc:'亞運 空手道 預賽 9/21 LIVE', sport_item:{ sp_name:'空手道' } }),
    programme({ format_s_time:'2026-09-21 11:25:00', program_desc:'亞運 空手道 複賽/決賽 9/21 LIVE', sport_item:{ sp_name:'空手道' } }),
    programme({ format_s_time:'2026-09-21 11:25:00', program_desc:'亞運 空手道 複賽/決賽 9/21 LIVE', sport_item:{ sp_name:'空手道' } })]));
  assert.equal(records.length,2);
  assert.deepEqual(gateBroadcasts(records,[]).pass,true);
});

test('programmes that are not flagged as Chinese Taipei are never added',()=>{
  const { records, unresolved } = parse(day([
    { is_taipei_team:0, format_s_time:'2026-09-21 12:30:00', program_desc:'亞運 棒球 即時賽況(原音) LIVE', sport_item:{ sp_name:'棒球' } },
    { is_taipei_team:0, format_s_time:'2026-09-21 08:30:00', program_desc:'亞運 鐵人三項 混合接力', sport_item:{ sp_name:'鐵人三項' } }]));
  assert.equal(records.length,0);
  assert.equal(unresolved.length,0);
});

test('unparsable time or unknown sport is reported, never guessed',()=>{
  const { records, unresolved } = parse(day([
    programme({ format_s_time:'soon', program_desc:'亞運 中華隊 拳擊', sport_item:{ sp_name:'拳擊' } }),
    programme({ format_s_time:'2026-09-21 10:00:00', program_desc:'亞運 中華隊 某新項目', sport_item:{ sp_name:'某新項目' } })]));
  assert.equal(records.length,0);
  assert.deepEqual(unresolved.map(u=>u.reason),['time-unparsable','unknown-sport:某新項目']);
});

test('the gate holds an empty, duplicated, malformed or collapsed batch',()=>{
  const good = parse(day([programme({ format_s_time:'2026-09-21 17:20:00',
    program_desc:'亞運 南韓VS中華 棒球 預賽', sport_item:{ sp_name:'棒球' } })])).records;
  assert.equal(gateBroadcasts(good,[]).pass,true);
  assert.ok(gateBroadcasts([],good).reasons.includes('empty-batch'));
  assert.ok(gateBroadcasts([...good,...good],[]).reasons.includes('duplicate-records'));
  assert.ok(gateBroadcasts([{...good[0],broadcastStartTimeTaipei:'2026-09-21 17:20'}],[]).reasons.includes('invalid-time'));
  assert.ok(gateBroadcasts([{...good[0],disciplineCode:'ZZZ'}],[]).reasons.some(r=>r.startsWith('invalid-discipline')));
  assert.ok(gateBroadcasts([{...good[0],date:'2027-01-01'}],[]).reasons.some(r=>r.startsWith('date-out-of-range')));
  assert.ok(gateBroadcasts([{...good[0],providerId:'other'}],[]).reasons.includes('wrong-provider'));
  const many = [1,2,3,4,5,6].map(i=>({...good[0],broadcastStartTimeTaipei:`2026-09-21T0${i}:00:00+08:00`}));
  assert.ok(gateBroadcasts([good[0]],many).reasons.includes('suspicious-shrink'));
});

test('a page that stopped publishing the schedule fails loudly',()=>{
  assert.throws(()=>extractScheduleList('<html>no data</html>'),/schedule_list/);
  assert.throws(()=>extractScheduleList(page('{}')),/empty/);
});
