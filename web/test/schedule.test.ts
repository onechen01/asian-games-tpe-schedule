import test from 'node:test';import assert from 'node:assert/strict';import {readFile,mkdir,writeFile} from 'node:fs/promises';import path from 'node:path';
import {taipeiDate,formatTaipei,statusLabel,taiwanRows,pendingRows,hasTimeConflict,nameList,parseDaily,emptyState,isEntered,entryNames} from '../lib/schedule.ts';
import type {Daily,Row} from '../lib/schedule.ts';
import {loadSchedule,loadAthletes,loadDisplayNames} from '../lib/load.ts';
import {orgLabel,venueLabel,parseDisplayNames} from '../lib/display-names.ts';

const daily = async ()=>parseDaily(JSON.parse(await readFile('data/normalized/daily-2026-09-18.json','utf8')),'2026-09-18');
const row = (r:Partial<Row>):Row=>({date:'2026-09-18',startTimeTaipei:null,startTimeJst:null,disciplineCode:null,
  sportZh:null,sportEn:null,event:null,phase:null,unit:null,athletes:[],athletesEn:[],opponent:null,opponentCode:null,
  venue:null,venueZh:null,status:null,result:null,tpenocResult:null,rank:null,note:null,
  participationState:'TPE_CONFIRMED',matchStatus:'MATCHED',matchConfidence:'high',matchSignals:[],sources:{},...r});

test('Taiwan calendar day and displayed times are independent of the host timezone',()=>{
  assert.equal(taipeiDate(new Date('2026-09-18T17:00:00Z')),'2026-09-19');
  assert.equal(formatTaipei('2026-09-18T12:00:00+08:00'),'12:00');
});

test('only Chinese Taipei rows are shown, never confirmed non-TPE matches',async()=>{
  const data = await daily();
  const shown = taiwanRows(data);
  assert.equal(shown.length,9);
  assert.ok(shown.every(r=>r.participationState==='TPE_CONFIRMED'));
  assert.deepEqual([...new Set(shown.map(r=>r.matchStatus))].sort(),['MATCHED','RESULTS_ONLY']);
  assert.equal(pendingRows(data).length,0);
});

test('the basketball card carries Chinese names, the official score and the venue',async()=>{
  const data = await daily();
  const bkb = taiwanRows(data).find(r=>r.disciplineCode==='BKB')!;
  assert.equal(nameList(bkb).length,12);
  assert.equal(nameList(bkb)[0],'彭曉彤');
  assert.equal(bkb.athletesEn.length,12);
  assert.equal(statusLabel(bkb),'已結束');
  assert.deepEqual([bkb.result?.tpe,bkb.result?.opponent],['76','67']);
  assert.equal(formatTaipei(bkb.startTimeTaipei),'12:00');
});

test('a source time conflict surfaces on its own card only',async()=>{
  const data = await daily();
  const flagged = taiwanRows(data).filter(r=>hasTimeConflict(data,r));
  assert.equal(flagged.length,1);
  assert.equal(flagged[0].disciplineCode,'TST');
  assert.equal(flagged[0].opponent,'菲律賓');
});

test('status codes translate only when recognised',()=>{
  assert.equal(statusLabel(row({status:'OFFICIAL'})),'已結束');
  assert.equal(statusLabel(row({status:'RUNNING'})),'比賽中');
  assert.equal(statusLabel(row({status:'START_LIST'})),'尚未開始');
  assert.equal(statusLabel(row({status:'SOMETHING_NEW'})),'SOMETHING_NEW');
  assert.equal(statusLabel(row({status:null})),null);
});

test('a TPENOC-only row keeps its Chinese names with no invented status or score',()=>{
  const only = row({matchStatus:'TPENOC_ONLY',athletes:['林蝶'],sportZh:'籃球(5*5)'});
  assert.deepEqual(nameList(only),['林蝶']);
  assert.deepEqual(nameList(row({athletes:[],athletesEn:['CHEN Yu-hsun']})),[]);
  assert.equal(statusLabel(only),null);
  assert.equal(only.result,null);
});

test('pending participation is listed separately and never dropped',()=>{
  const data = {schemaVersion:1,date:'2026-09-18',generatedAt:'2026-09-18T00:00:00.000Z',timezone:'Asia/Taipei',
    rows:[row({participationState:'PARTICIPANTS_TBD',matchStatus:'RESULTS_ONLY'})],warnings:[],
    summary:{matched:0,tpenocOnly:0,resultsOnly:0,unresolvedTbd:1,warnings:0},sources:{}} as unknown as Daily;
  assert.equal(taiwanRows(data).length,0);
  assert.equal(pendingRows(data).length,1);
});

test('missing, invalid date and damaged files stay distinct states',async()=>{
  const folder=path.resolve('outputs/mvp-test-fixtures');
  await mkdir(folder,{recursive:true});
  await writeFile(path.join(folder,'daily-2026-09-20.json'),'{invalid test fixture');
  assert.equal((await loadSchedule('2026-09-20',folder)).kind,'error');
  assert.equal((await loadSchedule('2026-09-19',folder)).kind,'missing');
  assert.equal((await loadSchedule('../../',folder)).kind,'invalid');
});

const emptyDay=(extra:Partial<Daily>)=>({schemaVersion:1,date:'2026-09-11',generatedAt:'2026-09-18T00:00:00.000Z',
  timezone:'Asia/Taipei',rows:[],warnings:[],
  summary:{matched:0,tpenocOnly:0,resultsOnly:0,unresolvedTbd:0,warnings:0},sources:{},...extra} as unknown as Daily);

test('an empty day distinguishes a confirmed rest day from missing or partial data',async()=>{
  assert.equal(emptyState(emptyDay({officialNoCompetition:true,coverageComplete:true})),'confirmed-none');
  assert.equal(emptyState(emptyDay({officialNoCompetition:false,coverageComplete:false})),'incomplete');
  assert.equal(emptyState(emptyDay({officialNoCompetition:false,coverageComplete:true})),'none-found');
  // A file written before the flags existed must never claim a confirmed rest day.
  assert.equal(emptyState(emptyDay({})),'none-found');
});

test('the real 9/11 and 9/15 files are confirmed rest days, 9/18 is not',async()=>{
  for (const date of ['2026-09-11','2026-09-15']) {
    const day = parseDaily(JSON.parse(await readFile('data/normalized/daily-'+date+'.json','utf8')),date);
    assert.equal(day.rows.length,0);
    assert.equal(emptyState(day),'confirmed-none');
  }
  const busy = parseDaily(JSON.parse(await readFile('data/normalized/daily-2026-09-18.json','utf8')),'2026-09-18');
  assert.equal(busy.rows.length,9);
  assert.equal(busy.officialNoCompetition,false);
});

test('an entered event is listed but never counted as a confirmed start',async()=>{
  const day = parseDaily(JSON.parse(await readFile('data/normalized/daily-2026-09-21.json','utf8')),'2026-09-21');
  const shown = taiwanRows(day);
  const entered = shown.filter(isEntered);
  assert.ok(entered.length > 0,'9/21 應有待確認項目');
  for (const row of entered) {
    assert.equal(row.participationState,'TPE_ENTERED');
    assert.equal(row.entryLevel,'event');
    assert.ok((row.unitCount ?? 0) >= 1);
    assert.ok((row.enteredAthletes ?? []).length > 0);
    // A pending event has no opponent, score or status to show.
    assert.equal(row.opponent,null);
    assert.equal(row.result,null);
    assert.equal(row.status,null);
  }
  // Swimming: one row per event, never one per heat.
  const swimming = entered.filter(r=>r.disciplineCode === 'SWM');
  assert.equal(new Set(swimming.map(r=>r.event)).size, swimming.length);
  assert.ok(swimming.some(r=>(r.unitCount ?? 0) >= 5),'應保留當日場次數');
  // Confirmed rows on the same day stay unit-level.
  assert.ok(shown.filter(r=>!isEntered(r)).every(r=>r.entryLevel === 'unit'));
});

test('entered athletes keep official English names when no verified Chinese mapping exists',async()=>{
  const day = parseDaily(JSON.parse(await readFile('data/normalized/daily-2026-09-21.json','utf8')),'2026-09-21');
  const swim = taiwanRows(day).find(r=>isEntered(r) && r.disciplineCode === 'SWM')!;
  const master = await loadAthletes();
  const names = entryNames(swim,master);
  assert.deepEqual(names,swim.enteredAthletes);
  assert.ok(names.every(n=>/^[A-Za-z]/.test(n)),'沒有可靠中文對照時保留官方英文');
});

test('countries and venues display in Chinese and fall back to the official text',async()=>{
  const names = await loadDisplayNames();
  assert.equal(Object.keys(names.orgs).length,46);
  assert.equal(names.orgs.KOR,'南韓');
  assert.equal(names.orgs.PRK,'北韓');
  assert.equal(names.orgs.TPE,'台灣');
  assert.equal(Object.keys(names.venues).length,8);
  assert.equal(venueLabel(null,'SKY HALL TOYOTA',names),'豐田天空館');
  // Still under review, so the official English stands.
  assert.equal(venueLabel(null,'Ichinomiya City Municipal Gymnasium',names),'Ichinomiya City Municipal Gymnasium');
  assert.equal(orgLabel('ZZZ','Some Country',names),'Some Country');
  assert.equal(venueLabel('名古屋市東山公園網球中心','Nagoya City Higashiyama Park Tennis Center',names),'名古屋市東山公園網球中心');
  // Missing or broken files leave everything in English rather than breaking the page.
  const empty = parseDisplayNames(null,'not json');
  assert.deepEqual(empty,{orgs:{},venues:{}});
  assert.equal(orgLabel('KOR','Republic of Korea',empty),'Republic of Korea');
});

test('the 9/20 page shows every opponent and venue in Chinese',async()=>{
  const [day,names] = await Promise.all([
    parseDaily(JSON.parse(await readFile('data/normalized/daily-2026-09-20.json','utf8')),'2026-09-20'),
    loadDisplayNames()]);
  const rows = taiwanRows(day);
  const opponents = rows.map(r=>orgLabel(r.opponentCode,r.opponent,names)).filter(Boolean) as string[];
  assert.ok(opponents.length > 0);
  assert.ok(opponents.every(o=>!/[A-Za-z]{2,}/.test(o)),'對手應全為中文：'+opponents.filter(o=>/[A-Za-z]{2,}/.test(o)));
  const venues = rows.map(r=>venueLabel(r.venueZh,r.venue,names)).filter(Boolean) as string[];
  const english = [...new Set(venues.filter(v=>/[A-Za-z]{2,}/.test(v)))];
  // A venue only stays in English when the mapping has no confirmed Chinese name for it.
  assert.ok(english.every(v=>!names.venues[v]),'已對照的場館不應再顯示英文：'+english.join(', '));
  assert.ok(venues.some(v=>!/[A-Za-z]{2,}/.test(v)),'應有場館已中文化');
});
