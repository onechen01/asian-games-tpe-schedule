import test from 'node:test';import assert from 'node:assert/strict';
import { extractScheduleList, toBroadcasts, gateBroadcasts, athleteHint, badmintonCourtSessionHint,
  preserveVerifiedMatchHints, structuredSessionHint, PROVIDER } from '../src/broadcast/elta.ts';
import type {SpecialEvent} from '../src/special-events.ts';

const page = (json:string)=>`<html><script>\n let schedule_list = ${json};\n</script></html>`;
const programme = (o:Record<string,unknown>)=>({ is_taipei_team:1, ...o });
const day = (list:Record<string,unknown>[])=>page(JSON.stringify(
  { '2026-09-21':Object.fromEntries(list.map((p,i)=>[String(i),p])) }));
const parse = (html:string, athletesByZh?:Map<string,string>, nocByZh?:Record<string,string>)=>
  toBroadcasts(extractScheduleList(html),{ capturedAt:'2026-09-20', athletesByZh, nocByZh });

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

test('verified event hints survive only an exact record identity match',()=>{
  const generated = parse(day([programme({ format_s_time:'2026-09-21 13:00:00',
    program_desc:'亞運 中華隊 桌球 預賽', sport_item:{ sp_name:'桌球' } })])).records[0];
  const manual={...generated,matchHint:{eventKeywords:['Mixed Doubles'],phaseKeywords:['Round 1']}};
  assert.deepEqual(preserveVerifiedMatchHints([generated],[manual])[0].matchHint,manual.matchHint);
  for(const changed of [
    {...manual,providerId:'other'}, {...manual,date:'2026-09-22'},
    {...manual,broadcastStartTimeTaipei:'2026-09-21T13:01:00+08:00'},
    {...manual,disciplineCode:'KTE'}, {...manual,title:'different'},
  ]) assert.deepEqual(preserveVerifiedMatchHints([generated],[changed])[0].matchHint,generated.matchHint);
  const structured={...generated,matchHint:{eventKeywords:['Parser Event'],phaseKeywords:['Parser Phase']}};
  assert.deepEqual(preserveVerifiedMatchHints([structured],[manual])[0].matchHint,structured.matchHint);
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
  // Two named athletes are both kept; a session with no name gives nothing.
  assert.equal(athleteHint('杜承翰/甘家葳 空手道',byZh).length,2);
  assert.deepEqual(athleteHint('中華隊 游泳 預賽',byZh),[]);
});

test('a badminton Court programme stays a multi-unit session even when its title names athletes',()=>{
  const byZh=new Map([['葉宏蔚','YE Hong-Wei'],['詹又蓁','CHAN Nicole Gonzales']]);
  const {records}=parse(day([programme({format_s_time:'2026-09-21 08:25:00',
    program_desc:'亞運 葉宏蔚/詹又蓁 羽球 個人賽第1輪(上-第2球場) 9/21(原音) LIVE',
    sport_item:{sp_name:'羽球'}})]),byZh);
  assert.equal(records[0].matchLevel,'discipline');
  assert.deepEqual(records[0].matchHint.athleteNames,['YE Hong-Wei','CHAN Nicole Gonzales']);
  assert.deepEqual(records[0].matchHint.courtSession,
    {locationLabel:'Court 2',roundKeyword:'1st Round',sourceSessionLabel:'上'});
});

test('badminton knockout stage plus court syntax is parsed without inventing an event family',()=>{
  for (const [title,expected] of [
    ['亞運 葉宏蔚/詹又蓁 羽球 四強(第2球場) 9/28 LIVE',['Court 2','Semifinal','四強']],
    ['亞運 中華隊 羽球 四強（第2球場） LIVE',['Court 2','Semifinal','四強']],
    ['亞運 中華隊 羽球 四強 第2球場 LIVE',['Court 2','Semifinal','四強']],
    ['亞運 中華隊 羽球 八強(第1球場) LIVE',['Court 1','Quarterfinal','八強']],
    ['亞運 中華隊 羽球 決賽（第3球場） LIVE',['Court 3','Final','決賽']],
  ] as const) {
    const hint=badmintonCourtSessionHint(title)!;
    assert.deepEqual([hint.locationLabel,hint.roundKeyword,hint.sourceSessionLabel],expected,title);
  }
  assert.equal(badmintonCourtSessionHint('亞運 中華隊 羽球 四強 LIVE'),null,
    '沒有官方 court resolver 時不可製造 court hint');
});

test('the real 9/28 knockout title carries athletes and a Court 2 semifinal hint',()=>{
  const byZh=new Map([['葉宏蔚','YE Hong-wei'],['詹又蓁','CHAN Nicole Gonzales']]);
  const html=page(JSON.stringify({'2026-09-28':{0:programme({format_s_time:'2026-09-28 08:25:00',
    program_desc:'亞運 葉宏蔚/詹又蓁 羽球 四強(第2球場) 9/28 LIVE',
    sport_item:{sp_name:'羽球'}})}}));
  const record=toBroadcasts(extractScheduleList(html),{capturedAt:'2026-09-27',athletesByZh:byZh}).records[0];
  assert.equal(record.matchLevel,'discipline');
  assert.deepEqual(record.matchHint,{athleteNames:['YE Hong-wei','CHAN Nicole Gonzales'],
    courtSession:{locationLabel:'Court 2',roundKeyword:'Semifinal',sourceSessionLabel:'四強'}});
});

test('the eight production golf, judo and wrestling session titles produce explicit structured scopes',()=>{
  const cases:[string,string,number][]=[
    ['GLF','亞運 中華隊 高爾夫 男子個人/團體第一輪 9/30(原音) LIVE',2],
    ['GLF','亞運 中華隊 高爾夫 男/女個人/團體第一輪 9/30(原音) LIVE',4],
    ['GLF','亞運 中華隊 高爾夫 男/女個人/團體第一輪 9/30(原音) LIVE',4],
    ['GLF','亞運 中華隊 高爾夫 女子個人/團體第一輪 9/30(原音) LIVE',2],
    ['JUD','亞運 中華隊 柔道 女48/52/男60/66公斤級預賽/複賽 9/30 LIVE',4],
    ['GLF','亞運 中華隊 高爾夫 男/女個人/團體第二輪 10/1(原音) LIVE',4],
    ['WRE','亞運 白欣平 角力 男子希羅式77/97/60/女子62公斤級預賽/複賽 10/1(原音) LIVE',4],
    ['JUD','亞運 中華隊 柔道 男子73/81/女子57/63/70公斤級預賽/複賽 10/1 LIVE',5],
  ];
  for(const [discipline,title,count] of cases){
    const scopes=structuredSessionHint(title,discipline);
    assert.equal(scopes.length,count,title);
    assert.ok(scopes.every(scope=>Object.keys(scope).length>=3),title);
  }
  assert.deepEqual(structuredSessionHint('亞運 中華隊 高爾夫 第一輪 LIVE','GLF'),[],
    '缺性別與個人／團體 scope 時必須 fail closed');
  assert.deepEqual(structuredSessionHint('亞運 中華隊 柔道 預賽/複賽 LIVE','JUD'),[],
    '缺性別與量級 scope 時不得擴成整個 discipline/day');
});

test('a named athlete and structured session scopes coexist instead of reverting to an exact phase hint',()=>{
  const html=page(JSON.stringify({'2026-10-01':{0:programme({format_s_time:'2026-10-01 09:25:00',
    program_desc:'亞運 白欣平 角力 男子希羅式77/97/60/女子62公斤級預賽/複賽 10/1(原音) LIVE',
    sport_item:{sp_name:'角力'},live_type:'LIVE'})}}));
  const record=toBroadcasts(extractScheduleList(html),{capturedAt:'2026-10-01',
    athletesByZh:new Map([['白欣平','PAI Hsin-ping']])}).records[0];
  assert.equal(record.matchLevel,'discipline');
  assert.deepEqual(record.matchHint.athleteNames,['PAI Hsin-ping']);
  assert.equal(record.matchHint.sessionScopes?.length,4);
  assert.equal(record.matchHint.phaseKeywords,undefined);
});

test('taekwondo gender, weight and explicitly listed knockout stages become structured scopes',()=>{
  const title='亞運 中華隊 跆拳道 女子49/67、男子58/80公斤級16強/八強 10/2 LIVE';
  const scopes=structuredSessionHint(title,'TKW');
  assert.equal(scopes.length,8);
  assert.ok(scopes.some(scope=>scope.gender==='WOMEN'&&scope.weightKg===49&&scope.stage==='ROUND_OF_16'));
  assert.ok(scopes.some(scope=>scope.gender==='MEN'&&scope.weightKg===80&&scope.stage==='QUARTERFINAL'));
  assert.deepEqual(structuredSessionHint('亞運 中華隊 跆拳道 16強/八強 LIVE','TKW'),[],
    '缺性別與量級時不得變成全日 session');
});

test('judo repechage and equestrian competition-group rounds become complete structured scopes',()=>{
  assert.deepEqual(structuredSessionHint('亞運 中華隊 柔道 混合團體複賽 10/3 LIVE','JUD'),
    [{eventFamily:'TEAM',stage:'REPECHAGE'}]);
  assert.deepEqual(structuredSessionHint('亞運 中華隊 馬術 障礙超越個人決賽A組第2輪 LIVE','EQU'),
    [{competitionGroup:'A',roundNumber:2}]);
  assert.deepEqual(structuredSessionHint('亞運 中華隊 馬術 障礙超越個人決賽第2輪 LIVE','EQU'),[],
    '缺 competition group 時必須 fail closed');
});

test('ELTA 電競 is the ELS discipline alias and its named opponent remains the unit evidence',()=>{
  const html=page(JSON.stringify({'2026-10-02':{0:programme({format_s_time:'2026-10-02 10:55:00',
    program_desc:'亞運 中華VS南韓 電競 英雄聯盟金牌戰 10/2(原音) LIVE',
    sport_item:{sp_name:'電競'},live_type:'LIVE'})}}));
  const record=toBroadcasts(extractScheduleList(html),{capturedAt:'2026-10-01',nocByZh:{南韓:'KOR'}}).records[0];
  assert.equal(record.disciplineCode,'ELS');
  assert.equal(record.matchLevel,'unit');
  assert.deepEqual(record.matchHint,{opponentCodes:['KOR']});
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

test('only registered opening and closing ceremonies bypass the Chinese Taipei sport gate',()=>{
  const specialEvents=[
    {id:'ceremony-opening-2026-09-19',kind:'CEREMONY',ceremonyType:'OPENING',date:'2026-09-19'},
    {id:'ceremony-closing-2026-10-04',kind:'CEREMONY',ceremonyType:'CLOSING',date:'2026-10-04'},
  ] as SpecialEvent[];
  const html=page(JSON.stringify({
    '2026-09-19':{0:{is_taipei_team:0,format_s_time:'2026-09-19 16:50:00',
      program_desc:'亞運 開幕典禮 9/19 LIVE',sport_item:{sp_name:''},live_type:'LIVE'}},
    '2026-10-03':{0:{is_taipei_team:1,format_s_time:'2026-10-03 15:00:00',
      program_desc:'亞運 高爾夫 頒獎典禮 10/3 LIVE',sport_item:{sp_name:'高爾夫'}}},
    '2026-10-04':{
      0:{is_taipei_team:0,format_s_time:'2026-10-04 16:50:00',program_desc:'亞運 閉幕典禮 10/4 LIVE',sport_item:{sp_name:''},live_type:'LIVE'},
      1:{is_taipei_team:0,format_s_time:'2026-10-04 16:50:00',program_desc:'亞運 閉幕典禮 10/4(原音) LIVE',sport_item:{sp_name:''},live_type:'LIVE'},
    },
  }));
  const result=toBroadcasts(extractScheduleList(html),{capturedAt:'2026-10-04',specialEvents});
  const ceremonies=result.records.filter(record=>record.specialEventId);
  assert.deepEqual(ceremonies.map(record=>record.specialEventId),[
    'ceremony-opening-2026-09-19','ceremony-closing-2026-10-04','ceremony-closing-2026-10-04',
  ]);
  assert.ok(ceremonies.every(record=>record.disciplineCode===null&&record.matchLevel==='special-event'));
  assert.deepEqual(ceremonies.slice(1).map(record=>record.feed),['main','original']);
  const award=result.records.find(record=>record.title?.includes('頒獎典禮'))!;
  assert.equal(award.specialEventId,undefined);
  assert.equal(award.disciplineCode,'GLF');
  assert.equal(gateBroadcasts(result.records,[]).pass,true);
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

test('the channel and live type are kept as generic fields',()=>{
  const { records } = parse(day([programme({ format_s_time:'2026-09-20 08:50:00', cl_num:545,
    cl_title:'體育MAX6台', live_type:'LIVE', program_desc:'亞運 林明典 綜合格鬥 預賽 9/20(原音) LIVE',
    sport_item:{ sp_name:'綜合格鬥' } })]));
  const r = records[0];
  assert.equal(r.channelId,'545');
  assert.equal(r.channelName,'愛爾達體育MAX6台');
  assert.equal(r.isLive,true);
  assert.equal(r.feed,'original');
  // A delayed broadcast is still a broadcast, just not live.
  const delayed = parse(day([programme({ format_s_time:'2026-09-21 20:30:00', cl_num:101,
    cl_title:'體育 1 台', live_type:'D-LIVE', program_desc:'亞運 甘家葳 拳擊 9/21 D-LIVE',
    sport_item:{ sp_name:'拳擊' } })])).records[0];
  assert.equal(delayed.isLive,false);
  assert.equal(delayed.channelName,'愛爾達體育1台');
});

test('an opponent named in Chinese resolves through the shared NOC table',()=>{
  const nocByZh = { 尼泊爾:'NEP', 北韓:'PRK' };
  const { records } = parse(day([
    programme({ format_s_time:'2026-09-20 11:25:00', program_desc:'亞運 中華VS尼泊爾 桌球 男團預賽 9/20 LIVE',
      sport_item:{ sp_name:'桌球' } }),
    programme({ format_s_time:'2026-09-20 14:55:00', program_desc:'亞運 中華VS北韓 桌球 女團預賽 9/20 LIVE',
      sport_item:{ sp_name:'桌球' } })]),undefined,nocByZh);
  assert.deepEqual(records.map(r=>r.matchHint.opponentCodes?.[0]),['NEP','PRK']);
  assert.ok(records.every(r=>r.matchLevel === 'unit'));
});

test('a programme naming two athletes keeps both as hints',()=>{
  const byZh = new Map([['張立','CHANG Li'],['林郁芬','LIN Yu-fen']]);
  const { records } = parse(day([programme({ format_s_time:'2026-09-20 13:50:00',
    program_desc:'亞運 張立/林郁芬 綜合格鬥 八強 9/20(原音) LIVE', sport_item:{ sp_name:'綜合格鬥' } })]),byZh);
  assert.deepEqual(records[0].matchHint.athleteNames,['CHANG Li','LIN Yu-fen']);
  assert.equal(records[0].matchLevel,'unit');
});

test('the official end time is taken as published, never derived',()=>{
  const { records } = parse(day([programme({ format_s_time:'2026-09-20 08:55:00',
    start_time:1789865700, end_time:1789871400, cl_num:101, cl_title:'體育 1 台', live_type:'LIVE',
    program_desc:'亞運 中華隊 游泳 預賽 9/20 LIVE', sport_item:{ sp_name:'游泳' } })]));
  assert.equal(records[0].broadcastStartTimeTaipei,'2026-09-20T08:55:00+08:00');
  assert.equal(records[0].broadcastEndTimeTaipei,'2026-09-20T10:30:00+08:00');
  assert.deepEqual(records[0].matchHint.phaseKeywords?.includes('Heats'),true);
  // A programme without an end keeps null rather than borrowing the next one's start.
  const open = parse(day([programme({ format_s_time:'2026-09-20 08:55:00',
    program_desc:'亞運 中華隊 游泳 預賽', sport_item:{ sp_name:'游泳' } })])).records[0];
  assert.equal(open.broadcastEndTimeTaipei,null);
});
