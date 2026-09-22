import test from 'node:test';import assert from 'node:assert/strict';import {readFile,mkdir,writeFile} from 'node:fs/promises';import path from 'node:path';
import {taipeiDate,formatTaipei,statusLabel,taiwanRows,pendingRows,hasTimeConflict,nameList,parseDaily,emptyState,isEntered,entryNames,resultHeading} from '../lib/schedule.ts';
import type {Daily,Row} from '../lib/schedule.ts';
import {loadSchedule,loadAthletes,loadDisplayNames} from '../lib/load.ts';
import {athleteLabel} from '../lib/athletes.ts';
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
  // Entered rows disappear as the official draw fills in, so the rules are checked on
  // whichever ones the day still carries.
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
  assert.ok(swimming.every(r=>(r.unitCount ?? 0) >= 1),'應保留當日場次數');
  // Confirmed rows on the same day stay unit-level.
  assert.ok(shown.filter(r=>!isEntered(r)).every(r=>r.entryLevel === 'unit'));
});

test('entered athletes now resolve to verified Chinese names, and an unverified one stays English',async()=>{
  const day = parseDaily(JSON.parse(await readFile('data/normalized/daily-2026-09-21.json','utf8')),'2026-09-21');
  const master = await loadAthletes();
  // Entered rows disappear as the official draw fills in, so the assertion holds for
  // whichever ones the day still carries.
  for (const entry of taiwanRows(day).filter(isEntered)) {
    const names = entryNames(entry,master);
    assert.equal(names.length,entry.enteredAthletes!.length);
    assert.ok(names.every(n=>/[一-鿿]/.test(n)),'已驗證的選手顯示中文');
  }
  assert.equal(athleteLabel('CHENG I-ching',master,{discipline:'TTE'}),'鄭怡靜');
  // Nothing outside the master is ever translated.
  assert.equal(athleteLabel('SOMEONE Not-in-master',master),'SOMEONE Not-in-master');
});

test('the basketball and boxing LIN Yu-Ting are two verified people, not one',async()=>{
  const master = await loadAthletes();
  assert.equal(athleteLabel('LIN Yu-Ting',master,{reg:'13990355',discipline:'BKB'}),'林育庭');
  assert.equal(athleteLabel('LIN Yu-Ting',master,{reg:'6116922',discipline:'BOX'}),'林郁婷');
  const doc = JSON.parse(await readFile('data/reference/tpe-athlete-master.json','utf8'));
  // No basketball record may carry the boxer's name, and vice versa.
  assert.ok(doc.athletes.every((a:{zh:string;disciplines:string[]})=>
    !(a.zh === '林郁婷' && a.disciplines.includes('BKB'))));
  assert.ok(doc.athletes.every((a:{zh:string;disciplines:string[]})=>
    !(a.zh === '林育庭' && a.disciplines.includes('BOX'))));
});

test('two different people sharing one romanisation never overwrite each other',async()=>{
  const master = await loadAthletes();
  assert.equal(athleteLabel('LIN Yi-chen',master,{reg:'10199742'}),'林翊榛');
  assert.equal(athleteLabel('LIN Yi-chen',master,{reg:'15976727'}),'林宜蓁');
  assert.equal(athleteLabel('LIN Yi-chen',master,{discipline:'TKW'}),'林翊榛');
  assert.equal(athleteLabel('LIN Yi-chen',master,{discipline:'GAR'}),'林宜蓁');
  // Without a discriminator the ambiguous name stays in English rather than picking one person.
  assert.equal(athleteLabel('LIN Yi-chen',master),'LIN Yi-chen');
});

test('a withdrawn athlete keeps the verified Chinese identity',async()=>{
  const master = await loadAthletes();
  const doc = JSON.parse(await readFile('data/reference/tpe-athlete-master.json','utf8'));
  const gone = doc.athletes.find((a:{reg:string})=>a.reg === '10452144');
  assert.equal(gone.participationStatus,'WITHDRAWN');
  assert.equal(gone.confidence,'VERIFIED');
  assert.equal(athleteLabel(gone.officialEn,master,{reg:gone.reg}),'古林睿煬');
  // UNKNOWN is never silently promoted to ACTIVE.
  assert.ok(doc.athletes.some((a:{participationStatus:string})=>a.participationStatus === 'UNKNOWN'));
});

test('Chinese Taipei is shown to readers as 台灣, never 中華隊',async()=>{
  const names = await loadDisplayNames();
  assert.equal(names.orgs.TPE,'台灣');
  const page = await readFile('web/app/page.tsx','utf8');
  assert.ok(!page.includes('中華隊'),'頁面文案不得出現中華隊');
  assert.ok(!(await readFile('web/lib/schedule.ts','utf8')).includes('中華隊'));
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

import {eventLabel,phaseLabel,localizeName} from '../lib/event-names.ts';

test('event and phase names display in Chinese, and an unknown one stays official English',()=>{
  assert.equal(eventLabel("Women's Individual Time Trial"),'女子個人計時賽');
  assert.equal(eventLabel("Men's 200m Individual Medley"),'男子200公尺個人混合式');
  assert.equal(eventLabel("Women's Team"),'女子團體');
  assert.equal(localizeName('Skeet Men Team'),'男子雙向飛靶團體');
  assert.equal(phaseLabel("Women's Team Semifinals",null),'女子團體準決賽');
  assert.equal(phaseLabel("Men's Singles Quarterfinals",null),'男子單打8強賽');
  assert.equal(phaseLabel("Women's 200m Butterfly Heats",null),'女子200公尺蝶式預賽');
  assert.equal(phaseLabel("Men's Individual Kata Round of 16",null),'男子個人型16強賽');
  assert.equal(eventLabel('MOBA [League of Legends]'),'英雄聯盟');
  assert.equal(eventLabel('Pokémon UNITE'),'寶可夢大集結');
  assert.equal(eventLabel('PUBG Mobile Asian Games Version'),'絕地求生M亞運版');
  assert.equal(eventLabel('Identity V'),'第五人格亞運版');
  assert.equal(eventLabel('Naraka: Bladepoint'),'永劫無間');
  assert.equal(eventLabel('Puyo Puyo Champions'),'魔法氣泡');
  assert.equal(eventLabel('Competitive Martial Arts'),'競技武術');
  assert.equal(eventLabel('Street Fighter Series'),'快打旋風6');
  assert.equal(eventLabel('TEKKEN 8'),'鐵拳8');
  assert.equal(eventLabel('THE KING OF FIGHTERS XV'),'拳皇XV');
  // A name that cannot be translated in full is shown exactly as the officials published it.
  assert.equal(eventLabel('Unknown Esport'),'Unknown Esport');
  assert.equal(eventLabel(null),null);
});

test('the phase does not repeat the event that is already on screen',()=>{
  assert.equal(phaseLabel("Women's Team Semifinals","Women's Team"),'準決賽');
  assert.equal(phaseLabel("Women's Team","Women's Team"),'女子團體');
  assert.equal(phaseLabel("Men's Singles Round of 16","Men's Singles"),'16強賽');
});

test('the existing venue, country and athlete Chinese mappings do not regress',async()=>{
  const names = await loadDisplayNames();
  assert.equal(names.orgs.TPE,'台灣');
  assert.equal(names.venues['Aichi Prefectural Martial Arts Hall'],'愛知縣武道館');
  const master = await loadAthletes();
  assert.equal(athleteLabel('CHENG I-ching',master,{discipline:'TTE'}),'鄭怡靜');
});

import {parseBroadcasts,broadcastsForRow,disciplineBroadcasts,feedLabel} from '../lib/broadcasts.ts';
import {loadBroadcasts} from '../lib/load.ts';

const day21 = async ()=>parseDaily(JSON.parse(await readFile('data/normalized/daily-2026-09-21.json','utf8')),'2026-09-21');

test('broadcast records never supply a competition time',async()=>{
  const shows = await loadBroadcasts();
  const day = await day21();
  const box = taiwanRows(day).find(r=>r.disciplineCode === 'BOX')!;
  // The broadcaster may run more than one programme for the same athlete; all of them show.
  const matched = broadcastsForRow(shows,'2026-09-21',box);
  assert.ok(matched.length >= 1);
  assert.ok(matched.every(b=>b.providerName === '愛爾達'));
  assert.ok(matched.every(b=>b.broadcastStartTimeTaipei.startsWith('2026-09-21T')));
  // The card's own time is still the official one.
  assert.equal(box.startTimeTaipei,'2026-09-21T16:45:00+08:00');
  assert.notEqual(box.startTimeTaipei,matched[0].broadcastStartTimeTaipei);
  // Nothing in the canonical row carries a broadcast field.
  assert.ok(!Object.keys(box).some(k=>/broadcast/i.test(k)));
});

test('swimming heats keep their own official times, and the session programme stays at sport level',async()=>{
  const shows = await loadBroadcasts();
  const day = await day21();
  const swims = taiwanRows(day).filter(r=>r.disciplineCode === 'SWM');
  assert.ok(swims.length > 1);
  // Heats may now be covered by the session programme, but only inside its official window.
  for (const row of swims) {
    for (const b of broadcastsForRow(shows,'2026-09-21',row)) {
      assert.ok(Date.parse(row.startTimeTaipei!) >= Date.parse(b.broadcastStartTimeTaipei));
      assert.ok(Date.parse(row.startTimeTaipei!) < Date.parse(b.broadcastEndTimeTaipei!));
    }
  }
  assert.deepEqual(new Set(swims.map(r=>r.startTimeTaipei)).size,swims.length);
  const grouped = disciplineBroadcasts(shows,'2026-09-21',taiwanRows(day));
  assert.ok((grouped.get('SWM')?.length ?? 0) >= 1,'游泳整場節目留在運動層級');
});

test('several programmes and several providers can cover one day without overwriting',()=>{
  const doc = JSON.stringify({ schemaVersion:1, records:[
    { date:'2026-09-21',providerId:'elta',providerName:'愛爾達',broadcastStartTimeTaipei:'2026-09-21T17:20:00+08:00',
      disciplineCode:'BBL',title:'南韓VS中華',feed:'main',matchLevel:'unit',matchHint:{opponentCodes:['KOR']} },
    { date:'2026-09-21',providerId:'other',providerName:'其他平台',broadcastStartTimeTaipei:'2026-09-21T17:30:00+08:00',
      disciplineCode:'BBL',title:'南韓VS中華',feed:'original',matchLevel:'unit',matchHint:{opponentCodes:['KOR']} },
    { date:'2026-09-21',providerId:'elta',providerName:'愛爾達',broadcastStartTimeTaipei:'2026-09-21T08:55:00+08:00',
      disciplineCode:'KTE',title:'預賽',feed:'main',matchLevel:'discipline',matchHint:{} },
    { date:'2026-09-21',providerId:'elta',providerName:'愛爾達',broadcastStartTimeTaipei:'2026-09-21T12:55:00+08:00',
      disciplineCode:'KTE',title:'複賽/決賽',feed:'main',matchLevel:'discipline',matchHint:{} }]});
  const shows = parseBroadcasts(doc);
  const row = { disciplineCode:'BBL', opponentCode:'KOR', athletesEn:[] };
  const found = broadcastsForRow(shows,'2026-09-21',row);
  assert.equal(found.length,2);
  assert.deepEqual(found.map(b=>b.providerId),['elta','other']);
  assert.equal(feedLabel(found[1].feed),'原音');
  // Two karate programmes on one day coexist and stay off every card.
  assert.equal(disciplineBroadcasts(shows,'2026-09-21',[row]).get('KTE')?.length,2);
});

test('a programme with no canonical row never invents a competition',async()=>{
  const shows = await loadBroadcasts();
  const day = await day21();
  const rows = taiwanRows(day);
  // Any gymnastics row comes from the official entry list, never from a broadcast programme.
  assert.ok(rows.filter(r=>r.disciplineCode === 'GAR').every(r=>isEntered(r)));
  // The gymnastics programmes exist only in the broadcast block.
  // A gymnastics programme now reaches the entered card itself, or the sport block when it
  // cannot be tied to a row; either way no competition row is created for it.
  const onCards = rows.filter(r=>r.disciplineCode === 'GAR')
    .flatMap(r=>broadcastsForRow(shows,'2026-09-21',r)).length;
  const inBlock = disciplineBroadcasts(shows,'2026-09-21',rows).get('GAR')?.length ?? 0;
  assert.ok(onCards + inBlock >= 1);
  assert.equal(rows.length,taiwanRows(day).length);
});

test('the broadcast layer is provider-agnostic in code and in the page',async()=>{
  const lib = await readFile('web/lib/broadcasts.ts','utf8');
  const page = await readFile('web/app/page.tsx','utf8');
  for (const text of [lib,page]) {
    assert.ok(!/elta/i.test(text),'程式不得寫死任何單一 provider');
    assert.ok(!/愛爾達/.test(text));
  }
  assert.ok(page.includes('BroadcastList'));
  // The page reads provider names from the data, so more than one can appear.
  assert.ok(lib.includes('providerName'));
});

test('unknown or malformed broadcast data degrades to nothing, never to a wrong time',()=>{
  assert.deepEqual(parseBroadcasts(null).records,[]);
  assert.deepEqual(parseBroadcasts('{"schemaVersion":2,"records":[]}').records,[]);
  assert.deepEqual(parseBroadcasts('{"schemaVersion":1,"records":[{"date":"x"}]}').records,[]);
});

const windowShow = (over:Record<string,unknown> = {})=>parseBroadcasts(JSON.stringify({ schemaVersion:1, records:[
  { date:'2026-09-20',providerId:'elta',providerName:'愛爾達',channelId:'101',channelName:'愛爾達體育1台',
    isLive:true,broadcastStartTimeTaipei:'2026-09-20T08:55:00+08:00',
    broadcastEndTimeTaipei:'2026-09-20T10:30:00+08:00',disciplineCode:'SWM',title:'中華隊 游泳 預賽',
    feed:'main',matchLevel:'discipline',matchHint:{phaseKeywords:['Heats']},...over }]}));
const swimRow = (time:string, phase='Men\'s 100m Freestyle Heats')=>
  ({ disciplineCode:'SWM', opponentCode:null, athletesEn:[], startTimeTaipei:`2026-09-20T${time}:00+08:00`, phase });

test('a session programme covers the units inside the official window, and nothing outside it',()=>{
  const shows = windowShow();
  const attached = (time:string)=>broadcastsForRow(shows,'2026-09-20',swimRow(time)).length;
  assert.equal(attached('08:50'),0,'早於開播');
  assert.equal(attached('08:55'),1);
  assert.equal(attached('09:20'),1);
  assert.equal(attached('10:29'),1);
  assert.equal(attached('10:30'),0,'結束時間本身不含');
  assert.equal(attached('10:40'),0);
  // A different phase in the same window is not covered by a heats programme.
  assert.equal(broadcastsForRow(shows,'2026-09-20',swimRow('09:20',"Men's 100m Freestyle Final")).length,0);
});

test('time alone is never evidence, and a delayed session stays off the cards',()=>{
  const noHint = windowShow({ matchHint:{} });
  assert.equal(broadcastsForRow(noHint,'2026-09-20',swimRow('09:20')).length,0);
  const delayed = windowShow({ isLive:false });
  assert.equal(broadcastsForRow(delayed,'2026-09-20',swimRow('09:20')).length,0);
});

test('an athlete or opponent match survives a competition outside the broadcast window',()=>{
  const strong = parseBroadcasts(JSON.stringify({ schemaVersion:1, records:[
    { date:'2026-09-20',providerId:'elta',providerName:'愛爾達',isLive:false,
      broadcastStartTimeTaipei:'2026-09-20T20:30:00+08:00',broadcastEndTimeTaipei:'2026-09-20T22:00:00+08:00',
      disciplineCode:'BOX',title:'甘家葳 拳擊',feed:'main',matchLevel:'unit',matchHint:{athleteNames:['KAN Chia-wei']} },
    { date:'2026-09-20',providerId:'elta',providerName:'愛爾達',isLive:true,
      broadcastStartTimeTaipei:'2026-09-20T18:10:00+08:00',broadcastEndTimeTaipei:'2026-09-20T20:00:00+08:00',
      disciplineCode:'VVO',title:'日本VS中華 排球',feed:'main',matchLevel:'unit',matchHint:{opponentCodes:['JPN']} }]}));
  const box = broadcastsForRow(strong,'2026-09-20',
    { disciplineCode:'BOX', opponentCode:null, athletesEn:['KAN Chia-wei'], startTimeTaipei:'2026-09-20T16:45:00+08:00' });
  assert.equal(box.length,1,'延誤或 D-LIVE 都不該讓強配對消失');
  assert.equal(box[0].isLive,false);
  const volley = broadcastsForRow(strong,'2026-09-20',
    { disciplineCode:'VVO', opponentCode:'JPN', athletesEn:[], startTimeTaipei:'2026-09-20T23:30:00+08:00' });
  assert.equal(volley.length,1);
});

test('the real 9/20 swimming session covers its heats only, and finals only in their own window',async()=>{
  const shows = await loadBroadcasts();
  const day = parseDaily(JSON.parse(await readFile('data/normalized/daily-2026-09-20.json','utf8')),'2026-09-20');
  const swims = taiwanRows(day).filter(r=>r.disciplineCode === 'SWM');
  for (const row of swims) {
    const found = broadcastsForRow(shows,'2026-09-20',row);
    if (!found.length) continue;
    for (const b of found) {
      assert.ok(Date.parse(row.startTimeTaipei!) >= Date.parse(b.broadcastStartTimeTaipei));
      assert.ok(Date.parse(row.startTimeTaipei!) < Date.parse(b.broadcastEndTimeTaipei!));
      assert.ok(b.matchHint?.phaseKeywords?.some(k=>row.phase?.includes(k)));
    }
  }
  // The competition times themselves are untouched by any of this.
  assert.ok(swims.every(r=>!Object.keys(r).some(k=>/broadcast/i.test(k))));
});

test('several channels at the same time coexist',()=>{
  const two = parseBroadcasts(JSON.stringify({ schemaVersion:1, records:[
    { date:'2026-09-20',providerId:'elta',providerName:'愛爾達',channelId:'105',channelName:'愛爾達體育2台',
      isLive:true,broadcastStartTimeTaipei:'2026-09-20T14:55:00+08:00',broadcastEndTimeTaipei:'2026-09-20T17:50:00+08:00',
      disciplineCode:'TTE',title:'中華VS北韓',feed:'main',matchLevel:'unit',matchHint:{opponentCodes:['PRK']} },
    { date:'2026-09-20',providerId:'other',providerName:'其他平台',channelId:'9',channelName:'其他平台頻道',
      isLive:true,broadcastStartTimeTaipei:'2026-09-20T14:55:00+08:00',broadcastEndTimeTaipei:'2026-09-20T17:50:00+08:00',
      disciplineCode:'TTE',title:'中華VS北韓',feed:'original',matchLevel:'unit',matchHint:{opponentCodes:['PRK']} }]}));
  const found = broadcastsForRow(two,'2026-09-20',{ disciplineCode:'TTE', opponentCode:'PRK', athletesEn:[], startTimeTaipei:'2026-09-20T15:00:00+08:00' });
  assert.equal(found.length,2);
  assert.deepEqual(new Set(found.map(b=>b.channelName)),new Set(['愛爾達體育2台','其他平台頻道']));
});

import {medalOf,medalLabel,competitorMedal} from '../lib/medal-match.ts';

test('Wushu component and aggregate labels stay distinct, with medal on the correct entrant',()=>{
  assert.equal(resultHeading({resultScope:'component',unit:'Nanquan'},true),'官方分項成績（Nanquan）');
  assert.equal(resultHeading({resultScope:'aggregate',unit:'Nangun Final'},true),'官方全能總分／排名');
  assert.equal(competitorMedal('OFFICIAL','ME_BRONZE'),'BRONZE');
  assert.equal(competitorMedal('OFFICIAL',null),null);
  assert.equal(competitorMedal('SCHEDULED','ME_BRONZE'),null);
  assert.equal(resultHeading({unit:'200m Freestyle'},true),'官方已公布成績（每人各自計分）');
});
const medalRow = (o:Record<string,unknown>)=>({ status:'OFFICIAL', orgCount:2, ...o });

test('only an official two-sided medal match decides a medal',()=>{
  assert.equal(medalOf(medalRow({ unit:"Women's Team Finals Gold Medal Match", tpeRank:'1' })),'GOLD');
  assert.equal(medalOf(medalRow({ unit:"Men's Team Finals Gold Medal Match", tpeRank:'2' })),'SILVER');
  assert.equal(medalOf(medalRow({ unit:"Women's Individual Kata Bronze Medal Bout B", tpeRank:'1' })),'BRONZE');
  assert.equal(medalOf(medalRow({ unit:"Women's Individual Kata Bronze Medal Bout B", tpeRank:'2' })),null);
  assert.equal(medalLabel('BRONZE'),'🥉 銅牌');
});

test('anything the officials did not name a medal match stays undecided',()=>{
  // Not yet official.
  assert.equal(medalOf(medalRow({ unit:"Men's Team Finals Gold Medal Match", tpeRank:'1', status:'SCHEDULED' })),null);
  // An ordinary final, a semifinal and a multi-competitor final decide nothing here.
  assert.equal(medalOf(medalRow({ unit:"Men's 200m Individual Medley Final", phase:"Men's 200m Individual Medley Final", tpeRank:'1' })),null);
  assert.equal(medalOf(medalRow({ unit:"Women's Team Semifinals Match 2", tpeRank:'1' })),null);
  assert.equal(medalOf(medalRow({ unit:'10m Air Rifle Women Team - Final', tpeRank:'11', orgCount:16 })),null);
  assert.equal(medalOf(medalRow({ unit:'Gold Medal Match', tpeRank:null })),null);
});

test('the real 9/20 medal matches derive a bronze and a silver, and nothing else',async()=>{
  const day = parseDaily(JSON.parse(await readFile('data/normalized/daily-2026-09-20.json','utf8')),'2026-09-20');
  const medals = taiwanRows(day).map(r=>({ r, m:medalOf(r) })).filter(x=>x.m);
  for (const { r, m } of medals) {
    assert.ok(/gold medal (match|bout)|bronze medal (match|bout)/i.test(`${r.unit} ${r.phase}`));
    assert.equal(r.status,'OFFICIAL');
    assert.ok(m === 'GOLD' || m === 'SILVER' || m === 'BRONZE');
  }
  // No medal may come from a rank in an ordinary final.
  assert.ok(taiwanRows(day).every(r=>medalOf(r) === null || (r.orgCount ?? 0) === 2));
});

test('the official medal on the competitor decides, whatever the unit looks like',()=>{
  // 石政中 9/21: the officials left Rk empty but marked ME_BRONZE on the competitor.
  assert.equal(medalOf({ status:'OFFICIAL', unit:"Men's Kumite -67kg Bronze Medal Bout A",
    phase:"Men's Kumite -67kg Bronze Medal Bout", tpeRank:null, orgCount:2, tpeMedal:'ME_BRONZE' }),'BRONZE');
  // No rank, no head-to-head, no medal-match wording needed.
  assert.equal(medalOf({ status:'OFFICIAL', unit:"Men's Taijiquan Final - Final", orgCount:13, tpeMedal:'ME_GOLD' }),'GOLD');
  assert.equal(medalOf({ status:'OFFICIAL', unit:'anything', orgCount:13, tpeMedal:'ME_SILVER' }),'SILVER');
  // Not official, or no medal set: nothing is displayed.
  assert.equal(medalOf({ status:'SCHEDULED', unit:'Gold Medal Match', tpeMedal:'ME_GOLD', orgCount:2, tpeRank:'1' }),null);
  assert.equal(medalOf({ status:'OFFICIAL', unit:"Men's Taijijian Final - Final", tpeRank:'2', orgCount:13, tpeMedal:null }),null);
  // The medal-match wording still works as the fallback.
  assert.equal(medalOf({ status:'OFFICIAL', unit:'Gold Medal Match', tpeRank:'2', orgCount:2, tpeMedal:null }),'SILVER');
});

test('a placeholder gymnastics event reads in Chinese and never claims a Taiwan start time',async()=>{
  assert.equal(eventLabel("Men's"),'男子');
  assert.equal(phaseLabel("Men's Qualification","Men's"),'資格賽');
  const page = await readFile('web/app/page.tsx','utf8');
  // The event window is labelled as such; the old "實際出賽時間待確認" wording is gone.
  assert.ok(page.includes('是本項目的起始時間，不是台灣選手的出賽時間'));
  assert.ok(!page.includes('實際出賽時間待確認'));
});

test('a provisional row only takes a broadcast when the official window covers it',()=>{
  const shows = windowShow({ disciplineCode:'GAR', matchHint:{ phaseKeywords:['Qualification'] } });
  const inside = { disciplineCode:'GAR', opponentCode:null, athletesEn:[],
    startTimeTaipei:'2026-09-20T09:00:00+08:00', phase:"Men's Qualification" };
  assert.equal(broadcastsForRow(shows,'2026-09-20',inside).length,1);
  // A programme in the afternoon does not cover a morning subdivision.
  assert.equal(broadcastsForRow(shows,'2026-09-20',{ ...inside, startTimeTaipei:'2026-09-20T13:30:00+08:00' }).length,0);
});

const garShow = (over:Record<string,unknown> = {})=>parseBroadcasts(JSON.stringify({ schemaVersion:1, records:[
  { date:'2026-09-21',providerId:'elta',providerName:'愛爾達',channelName:'愛爾達體育1台',isLive:true,
    broadcastStartTimeTaipei:'2026-09-21T13:25:00+08:00',broadcastEndTimeTaipei:'2026-09-21T16:00:00+08:00',
    disciplineCode:'GAR',title:'中華隊 男子資格賽',feed:'main',matchLevel:'discipline',
    matchHint:{phaseKeywords:['Qualification']},...over }]}));
const enteredRow = (over:Record<string,unknown> = {})=>({ disciplineCode:'GAR', opponentCode:null,
  athletesEn:[], startTimeTaipei:'2026-09-21T09:00:00+08:00', phase:"Men's Qualification",
  participationState:'TPE_ENTERED', entryLevel:'event', ...over });

test('an event-level row keeps its broadcast even when the programme starts later',()=>{
  const found = broadcastsForRow(garShow(),'2026-09-21',enteredRow());
  assert.equal(found.length,1,'本項起始時間不得用來排除轉播');
  assert.equal(found[0].broadcastStartTimeTaipei,'2026-09-21T13:25:00+08:00');
  // The row's own time is untouched: the broadcast never becomes the competition time.
  assert.equal(enteredRow().startTimeTaipei,'2026-09-21T09:00:00+08:00');
});

test('the looser provisional rule still needs the sport, the day and the phase to agree',()=>{
  // Another sport, same day.
  assert.equal(broadcastsForRow(garShow(),'2026-09-21',enteredRow({ disciplineCode:'SWM' })).length,0);
  // Same sport, different phase.
  assert.equal(broadcastsForRow(garShow(),'2026-09-21',enteredRow({ phase:"Men's Team Final" })).length,0);
  // Another day.
  assert.equal(broadcastsForRow(garShow(),'2026-09-20',enteredRow()).length,0);
  // A programme with no phase evidence stays off the card.
  assert.equal(broadcastsForRow(garShow({ matchHint:{} }),'2026-09-21',enteredRow()).length,0);
  // Delayed programmes keep their existing restriction.
  assert.equal(broadcastsForRow(garShow({ isLive:false }),'2026-09-21',enteredRow()).length,0);
  // A confirmed row still obeys the official window.
  assert.equal(broadcastsForRow(garShow(),'2026-09-21',
    enteredRow({ participationState:'TPE_CONFIRMED', entryLevel:'unit' })).length,0);
});

test('athlete identity is scoped to the discipline, and a shared romanisation never leaks',async()=>{
  const master = await loadAthletes();
  // The boxer is verified; the basketball record with the same romanisation is under review.
  assert.equal(athleteLabel('LIN Yu-Ting',master,{discipline:'BOX'}),'林郁婷');
  assert.equal(athleteLabel('LIN Yu-Ting',master,{discipline:'BKB'}),'林育庭');
  assert.equal(athleteLabel('LIN Yu-Ting',master,{reg:'13990355',discipline:'BKB'}),'林育庭');
  // Reg wins, and pure formatting differences still resolve.
  assert.equal(athleteLabel('LIN YU-TING',master,{reg:'6116922'}),'林郁婷');
  assert.equal(athleteLabel('Lin Yu Ting',master,{discipline:'BOX'}),'林郁婷');
  // Two people sharing one romanisation resolve separately by discipline, never globally.
  assert.equal(athleteLabel('LIN Yi-chen',master,{discipline:'TKW'}),'林翊榛');
  assert.equal(athleteLabel('LIN Yi-chen',master,{discipline:'GAR'}),'林宜蓁');
  assert.equal(athleteLabel('LIN Yi-chen',master),'LIN Yi-chen');
  // A name that is unique in the master still resolves without a discipline.
  assert.equal(athleteLabel('CHENG I-ching',master),'鄭怡靜');
  // Nobody outside the master is ever translated.
  assert.equal(athleteLabel('NOBODY In-master',master,{discipline:'BBL'}),'NOBODY In-master');
});

test('phase and status read in Chinese, and unknown wording is left alone',()=>{
  assert.equal(phaseLabel('Women Group Phase - Group C',null),'女子小組賽C組');
  assert.equal(phaseLabel("Men's Opening Round Group B",null),'男子預賽B組');
  assert.equal(phaseLabel('Totally Special Phase',null),'Totally Special Phase');
  assert.equal(statusLabel({status:'UNOFFICIAL'} as never),'暫定');
  assert.equal(statusLabel({status:'OFFICIAL'} as never),'已結束');
  assert.equal(statusLabel({status:'WEIRD_CODE'} as never),'WEIRD_CODE');
});

test('venues use the verified mapping and are never invented',async()=>{
  const names = await loadDisplayNames();
  assert.equal(venueLabel(null,'Aichi Prefectural Martial Arts Hall',names),'愛知縣武道館');
  assert.equal(venueLabel(null,'Nagoya City General Gymnasium [Rainbow Hall]',names),
    'Nagoya City General Gymnasium [Rainbow Hall]');
});
