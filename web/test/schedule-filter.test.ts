import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSportOptions} from '../lib/load.ts';
import {taipeiDate} from '../lib/schedule.ts';
import {EMPTY_FILTERS,matchesScheduleFilters,normalizeFilters,parseFilterQuery,scheduleStatusCategory,
  scheduleUrl,selectJumpTarget,visibleScheduleItems,zipScheduleItems} from '../lib/schedule-filter.ts';
import type {FilterState,ScheduleItemMeta} from '../lib/schedule-filter.ts';

const item=(id:string,extra:Partial<ScheduleItemMeta>={}):ScheduleItemMeta=>({
  id,disciplineCode:'BDM',sportLabel:'羽球',status:'SCHEDULED',hasBroadcast:false,timeNoteCode:null,...extra,
});

test('sport selections are OR within their filter group',()=>{
  const rows=[item('bdm'),item('tte',{disciplineCode:'TTE',sportLabel:'桌球'}),item('swm',{disciplineCode:'SWM',sportLabel:'游泳'})];
  assert.deepEqual(visibleScheduleItems(rows,{sports:['BDM'],statuses:[],broadcast:false}).map(row=>row.id),['bdm']);
  assert.deepEqual(visibleScheduleItems(rows,{sports:['BDM','TTE'],statuses:[],broadcast:false}).map(row=>row.id),['bdm','tte']);
});

test('status selections are OR, while sport, status and broadcast groups are AND',()=>{
  const rows=[
    item('live-bdm',{status:'RUNNING',hasBroadcast:true}),
    item('upcoming-bdm',{status:'START_LIST',hasBroadcast:false}),
    item('live-tte',{disciplineCode:'TTE',sportLabel:'桌球',status:'LIVE',hasBroadcast:true}),
    item('finished-bdm',{status:'OFFICIAL',hasBroadcast:true}),
  ];
  const statuses:FilterState={sports:[],statuses:['upcoming','live'],broadcast:false};
  assert.deepEqual(visibleScheduleItems(rows,statuses).map(row=>row.id),['live-bdm','upcoming-bdm','live-tte']);
  const allGroups:FilterState={sports:['BDM'],statuses:['upcoming','live'],broadcast:true};
  assert.deepEqual(visibleScheduleItems(rows,allGroups).map(row=>row.id),['live-bdm']);
});

test('no filters impose no restriction and clear keeps the requested date in the URL',()=>{
  const unknown=item('unknown',{status:null});
  assert.equal(matchesScheduleFilters(unknown,EMPTY_FILTERS),true);
  assert.equal(scheduleUrl('2026-09-27',EMPTY_FILTERS),'/?date=2026-09-27');
});

test('canonical statuses map only to the three proven categories',()=>{
  for(const status of ['SCHEDULED','START_LIST','PROVISIONAL','GETTING_READY'])assert.equal(scheduleStatusCategory(status),'upcoming');
  for(const status of ['RUNNING','LIVE'])assert.equal(scheduleStatusCategory(status),'live');
  for(const status of ['OFFICIAL','FINISHED'])assert.equal(scheduleStatusCategory(status),'finished');
  for(const status of ['UNOFFICIAL','INTERMEDIATE','SOMETHING_NEW',null])assert.equal(scheduleStatusCategory(status),'unknown');
  const selected:FilterState={sports:[],statuses:['upcoming','live','finished'],broadcast:false};
  assert.equal(matchesScheduleFilters(item('unknown',{status:'UNOFFICIAL'}),selected),false);
  assert.equal(matchesScheduleFilters(item('null',{status:null}),selected),false);
});

test('query parsing ignores unknown values, de-duplicates and serializes in canonical order',()=>{
  const filters=parseFilterQuery({sports:'TTE,BDM,TTE,NOPE',status:'live,upcoming,live,nope',broadcast:'1'},['BDM','TTE','SWM']);
  assert.deepEqual(filters,{sports:['BDM','TTE'],statuses:['upcoming','live'],broadcast:true});
  assert.equal(scheduleUrl('2026-09-25',filters),'/?date=2026-09-25&sports=BDM%2CTTE&status=upcoming%2Clive&broadcast=1');
  const url=new URL('https://example.test'+scheduleUrl('2026-09-25',filters,true));
  assert.equal(url.searchParams.get('jump'),'1');
  assert.deepEqual(parseFilterQuery(Object.fromEntries(url.searchParams),['BDM','TTE','SWM']),filters);
  assert.deepEqual(normalizeFilters({sports:['TTE','BDM','TTE'],statuses:['finished','upcoming','finished'],broadcast:false}),
    {sports:['BDM','TTE'],statuses:['upcoming','finished'],broadcast:false});
});

test('jump target prefers first visible live, then first upcoming',()=>{
  const rows=[item('finished',{status:'OFFICIAL'}),item('live-1',{status:'RUNNING'}),item('live-2',{status:'LIVE'}),item('next')];
  assert.deepEqual(selectJumpTarget(rows),{
    id:'live-1',kind:'live',message:'已定位到第一場進行中的賽程。',
  });
  assert.equal(selectJumpTarget(rows.filter(row=>scheduleStatusCategory(row.status)!=='live'))?.id,'next');
});

test('jump target uses last finished only when every visible status is safely finished',()=>{
  const finished=[item('first',{status:'OFFICIAL'}),item('last',{status:'FINISHED'})];
  assert.deepEqual(selectJumpTarget(finished),{
    id:'last',kind:'finished',message:'今天符合條件的後續賽程已全部結束，已定位到最後一場。',
  });
  const mixed=[item('done',{status:'OFFICIAL'}),item('uncertain',{status:'UNOFFICIAL'})];
  assert.equal(selectJumpTarget(mixed)?.id,'uncertain');
  assert.equal(selectJumpTarget(mixed)?.kind,'unknown');
  assert.equal(selectJumpTarget([]),null);
});

test('FOLLOWED_BY placeholder values never influence jump selection',()=>{
  const followed=item('followed',{status:'START_LIST',timeNoteCode:'FOLLOWED_BY'}) as ScheduleItemMeta&{startTimeTaipei?:string};
  followed.startTimeTaipei='2099-12-31T23:59:00+08:00';
  assert.equal(selectJumpTarget([followed])?.id,'followed');
  followed.startTimeTaipei='2000-01-01T00:00:00+08:00';
  assert.equal(selectJumpTarget([followed])?.id,'followed');
});

test('Taipei calendar day is independent from the host UTC day',()=>{
  assert.equal(taipeiDate(new Date('2026-09-25T15:59:59Z')),'2026-09-25');
  assert.equal(taipeiDate(new Date('2026-09-25T16:00:00Z')),'2026-09-26');
});

test('sport options come from actual canonical Taiwan rows with unique existing Chinese labels',async()=>{
  const sports=await loadSportOptions();
  assert.equal(sports.length,45);
  assert.equal(new Set(sports.map(sport=>sport.code)).size,sports.length);
  assert.ok(sports.every(sport=>sport.code&&sport.label&&/[^A-Za-z]/.test(sport.label)));
  assert.deepEqual(sports.find(sport=>sport.code==='BDM'),{code:'BDM',label:'羽球'});
  assert.deepEqual(sports.find(sport=>sport.code==='TTE'),{code:'TTE',label:'桌球'});
  assert.deepEqual(sports.find(sport=>sport.code==='SWM'),{code:'SWM',label:'游泳'});
});

test('metadata and server-rendered cards must stay one-to-one',()=>{
  const rows=[item('a'),item('b')];
  assert.deepEqual(zipScheduleItems(rows,['card-a','card-b']).map(pair=>[pair.item.id,pair.card]),[['a','card-a'],['b','card-b']]);
  assert.throws(()=>zipScheduleItems(rows,['only-one']),/not aligned/);
});
