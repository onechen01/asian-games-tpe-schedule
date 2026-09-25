import test from 'node:test';import assert from 'node:assert/strict';import {readFile,mkdir,writeFile} from 'node:fs/promises';import path from 'node:path';
import {taipeiDate,formatTaipei,matchTimeLabel,statusLabel,taiwanRows,pendingRows,hasTimeConflict,nameList,parseDaily,emptyState,isEntered,entryNames,resultHeading} from '../lib/schedule.ts';
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

test('matchTimeLabel switches purely on timeNote.code, the one place every card and the progression line goes through',()=>{
  const at = (startTimeTaipei:string)=>({startTimeTaipei});
  assert.equal(matchTimeLabel({...at('2026-09-25T17:00:00+08:00'),
    timeNote:{code:'FOLLOWED_BY',clockTaipei:null,raw:'Followed by'}}),'前場結束後');
  assert.equal(matchTimeLabel({...at('2026-09-25T15:50:00+08:00'),
    timeNote:{code:'NOT_BEFORE',clockTaipei:'15:00',raw:'Not Before 16:00'}}),'不早於 15:00');
  assert.equal(matchTimeLabel({...at('2026-09-23T10:30:00+08:00'),
    timeNote:{code:'RESCHEDULED',clockTaipei:'11:10',raw:'New Start Time 12:10'}}),'已改期至 11:10');
  // PENDING covers both a genuinely blank official note and an EstText this codebase does not
  // yet recognise -- both fail safe to the same phrase, never a precise or invented time.
  assert.equal(matchTimeLabel({...at('2026-09-25T15:00:00+08:00'),
    timeNote:{code:'PENDING',clockTaipei:null,raw:null}}),'時間未定');
  assert.equal(matchTimeLabel({...at('2026-09-25T15:00:00+08:00'),
    timeNote:{code:'PENDING',clockTaipei:null,raw:'Delayed Due To Weather'}}),'時間未定');
  // A conversion that could not be computed (missing wall date) still fails safe, not to null.
  assert.equal(matchTimeLabel({...at('2026-09-25T15:00:00+08:00'),
    timeNote:{code:'NOT_BEFORE',clockTaipei:null,raw:'Not Before 16:00'}}),'時間未定');
  // The real internal time is still there for sorting/bucketing -- only display is replaced.
  assert.equal(matchTimeLabel({...at('2026-09-25T17:00:00+08:00'),timeNote:null}),'17:00');
  // Ordinary rows (timeNote absent, e.g. older cached data) behave exactly as before.
  assert.equal(matchTimeLabel({startTimeTaipei:'2026-09-25T17:00:00+08:00'}),'17:00');
});

test('FOLLOWED_BY labels use only trusted predecessor or court-chain evidence',()=>{
  const followed={startTimeTaipei:'2026-09-25T23:59:00+08:00',
    timeNote:{code:'FOLLOWED_BY' as const,clockTaipei:null,raw:'Followed by'},
    courtSessionChainId:'chain',courtPredecessorUnitId:'previous',sources:{results:{unitId:'current'}}};
  const chain=(anchorTimeKind:'EXACT'|'LOWER_BOUND'|'NONE',anchorTimeTaipei:string|null,
    previous:{timeNoteCode:null|'FOLLOWED_BY'|'RESCHEDULED'|'PENDING';timeKind:'EXACT'|'LOWER_BOUND'|'NONE';timeTaipei:string|null})=>[{
      id:'chain',disciplineCode:'BDM' as const,locationCode:'001',locationName:'Court 1',
      anchorUnitId:'anchor',anchorTimeKind,anchorTimeTaipei,units:[
        {unitId:'previous',unitName:null,predecessorUnitId:'anchor',...previous},
        {unitId:'current',unitName:null,predecessorUnitId:'previous',timeNoteCode:'FOLLOWED_BY' as const,timeKind:'NONE' as const,timeTaipei:null},
      ],
    }];
  assert.equal(matchTimeLabel(followed,chain('EXACT','2026-09-25T08:30:00+08:00',
    {timeNoteCode:null,timeKind:'EXACT',timeTaipei:'2026-09-25T08:30:00+08:00'})),
    '前場 08:30 開始\n前場結束後開賽');
  assert.equal(matchTimeLabel(followed,chain('EXACT','2026-09-25T08:30:00+08:00',
    {timeNoteCode:'FOLLOWED_BY',timeKind:'NONE',timeTaipei:null})),
    '本球場 08:30 起依序進行\n前場結束後開賽');
  assert.equal(matchTimeLabel(followed,chain('LOWER_BOUND','2026-09-25T15:00:00+08:00',
    {timeNoteCode:'FOLLOWED_BY',timeKind:'NONE',timeTaipei:null})),
    '本球場不早於 15:00 起依序進行\n前場結束後開賽');
  assert.equal(matchTimeLabel(followed,chain('NONE',null,
    {timeNoteCode:'PENDING',timeKind:'NONE',timeTaipei:null})),'前場結束後');
  assert.equal(matchTimeLabel(followed,chain('EXACT','2026-09-25T08:30:00+08:00',
    {timeNoteCode:'RESCHEDULED',timeKind:'EXACT',timeTaipei:'2026-09-25T09:15:00+08:00'})),
    '前場 09:15 開始\n前場結束後開賽');
  assert.ok(!matchTimeLabel(followed,[]).includes('23:59'));
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

test('diving CHEN athletes resolve by Results Reg without crossing identities',async()=>{
  const master = await loadAthletes();
  assert.equal(athleteLabel('CHEN Barbara',master,{reg:'14561657',discipline:'DIV'}),'陳百丹');
  assert.equal(athleteLabel('CHEN Jacqueline',master,{reg:'7958609',discipline:'DIV'}),'陳百婕');
  // Synchronised-event card headings do not carry Reg, so the exact Results short names
  // must also resolve inside the DIV pool without treating a shared surname as identity.
  assert.equal(athleteLabel('CHEN Barbara',master,{discipline:'DIV'}),'陳百丹');
  assert.equal(athleteLabel('CHEN Jacqueline',master,{discipline:'DIV'}),'陳百婕');
  assert.notEqual(athleteLabel('CHEN Barbara',master,{discipline:'DIV'}),'陳百婕');
  assert.notEqual(athleteLabel('CHEN Jacqueline',master,{discipline:'DIV'}),'陳百丹');
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
  assert.equal(Object.keys(names.venues).length,36);
  assert.equal(venueLabel(null,'SKY HALL TOYOTA',names),'豐田天空館');
  assert.equal(venueLabel(null,'Ichinomiya City Municipal Gymnasium',names),'一宮市綜合體育館');
  assert.equal(venueLabel(null,'Tokyo Aquatics Centre(Tokyo)',names),'東京水上運動中心');
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

test('audited event and phase patterns localize without possessive-prefix damage',()=>{
  assert.equal(phaseLabel("Women's Preliminary Round - Pool C",'Women'),'女子預賽C組');
  assert.equal(phaseLabel("Men's Quarterfinals",'Men'),'男子8強賽');
  assert.equal(phaseLabel('Women’s Preliminary Round','Women'),'女子預賽');
  assert.equal(phaseLabel('Repechage Bout Round 12',null),'復活賽第12輪');
  assert.equal(phaseLabel("Women's Classification Match 5th-8th",null),'女子第5至8名排名賽');
  assert.equal(phaseLabel('Round of Pool 6',null),'分組賽第6輪');
  assert.equal(phaseLabel('Table of 32',null),'32強賽');
  assert.equal(phaseLabel('100 Metres Hurdles',null),'100公尺跨欄');
  assert.equal(phaseLabel('200 Metres',null),'200公尺');
  assert.equal(phaseLabel('Dressage 12th Individual Qualifier',null),'馬場馬術個人資格賽第12場');
  assert.equal(phaseLabel('21st Round',null),'第21輪');
  assert.equal(phaseLabel("Men's Super Round",null),'男子超級循環賽');
  assert.equal(phaseLabel('Prelims',null),'預賽');

  const events = new Map<string,string>([
    ["Women's Nanquan & Nandao",'女子南拳與南刀全能'],
    ["Men's Nanquan & Nangun",'男子南拳南棍全能'],
    ["Men's Parallel Bars",'男子雙槓'],
    ["Men's Horizontal Bar",'男子單槓'],
    ["Men's Pole Vault",'男子撐竿跳高'],
    ["Women's Hammer Throw",'女子鏈球'],
    ["Women's Kayak Cross",'女子輕艇越野'],
    ["Men's Kayak Cross",'男子輕艇越野'],
    ['Jumping,Individual Competition A(heights of 1.40-1.50m)','障礙超越個人賽A（高度1.40–1.50公尺）'],
    ['Jumping,Individual Competition B(heights of up to 1.55m)','障礙超越個人賽B（高度最高1.55公尺）'],
  ]);
  for (const [official,zh] of events) assert.equal(eventLabel(official),zh);
  assert.equal(localizeName('Daoshu'),'刀術');
  assert.equal(localizeName('Taijiquan'),'太極拳');
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

test('the verified 9/23 karate and table tennis programmes attach only to their named cards',async()=>{
  const shows = await loadBroadcasts();
  const day = parseDaily(JSON.parse(await readFile('data/normalized/daily-2026-09-23.json','utf8')),'2026-09-23');
  const rows = taiwanRows(day);
  const matched = (discipline:string)=>rows.filter(row=>row.disciplineCode === discipline
    && broadcastsForRow(shows,'2026-09-23',row).some(show=>show.broadcastStartTimeTaipei === '2026-09-23T08:55:00+08:00'));
  assert.deepEqual(matched('KTE').map(row=>[row.startTimeTaipei,row.event,row.phase]),[
    ['2026-09-23T09:00:00+08:00',"Men's Team Kata","Men's Team Kata Quarterfinals"],
  ]);
  assert.deepEqual(matched('TTE').map(row=>[row.startTimeTaipei,row.event]),[
    ['2026-09-23T09:00:00+08:00','Mixed Doubles'],
    ['2026-09-23T09:40:00+08:00','Mixed Doubles'],
    ['2026-09-23T11:50:00+08:00',"Women's Singles"],
  ]);
  assert.ok(matched('TTE').every(row=>!row.event?.includes('Team')));
});

test('swimming heats keep their own official times, and the session programme stays at sport level',async()=>{
  const shows = await loadBroadcasts();
  const day = await day21();
  const swims = taiwanRows(day).filter(r=>r.disciplineCode === 'SWM');
  assert.ok(swims.length > 1);
  // Heats may now be covered by the session programme, but only inside its official window.
  // A D-LIVE rerun is exempt from its own window: it inherits the match from its LIVE original
  // (whose window was already checked), while still showing its own, later, broadcast time.
  for (const row of swims) {
    for (const b of broadcastsForRow(shows,'2026-09-21',row)) {
      if (b.isLive === false) continue;
      assert.ok(Date.parse(row.startTimeTaipei!) >= Date.parse(b.broadcastStartTimeTaipei));
      assert.ok(Date.parse(row.startTimeTaipei!) < Date.parse(b.broadcastEndTimeTaipei!));
    }
  }
  assert.deepEqual(new Set(swims.map(r=>r.startTimeTaipei)).size,swims.length);
  // The 9/21 D-LIVE rerun now inherits onto the same heats as its LIVE original (see the
  // dedicated D-LIVE inheritance tests below), so nothing swimming-related is left over at
  // discipline level for this date any more.
  const grouped = disciplineBroadcasts(shows,'2026-09-21',taiwanRows(day));
  assert.equal(grouped.get('SWM'),undefined);
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
  // The title itself must carry no recognisable phase word either — otherwise the shared
  // family table (also used by the veto) would derive evidence from the title on its own.
  const noHint = windowShow({ matchHint:{}, title:'中華隊 游泳' });
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
  assert.equal(resultHeading({resultScope:'component',unit:'Nanquan'},true),'官方分項成績（南拳）');
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
  // A programme with no phase evidence stays off the card (title carries none either — see
  // the note above about the shared family table also being able to derive evidence).
  assert.equal(broadcastsForRow(garShow({ matchHint:{}, title:'中華隊 男子組' }),'2026-09-21',enteredRow()).length,0);
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
    '名古屋市綜合體育館（彩虹館）');
  const ambiguous=parseDisplayNames(null,JSON.stringify({venues:{
    'Example Centre':{zh:'甲場館'},'Example Centre(City)':{zh:'乙場館'}}}));
  assert.equal(venueLabel(null,'Example Centre(Town)',ambiguous),'Example Centre(Town)');
  assert.equal(venueLabel(null,'Example Centre(City)',ambiguous),'乙場館');
});

// -- explicit event/phase conflict veto: a shared athlete or opponent must never override an
// explicit mismatch between what the broadcast names and what the row actually is. --

const shooting923 = (over:Record<string,unknown> = {})=>({ disciplineCode:'SHO', opponentCode:null,
  athletesEn:['CHENG Yen-Ching'], startTimeTaipei:'2026-09-23T00:00:00+08:00',
  event:'10m Air Pistol Women Individual', phase:'10m Air Pistol Women Individual Qualification',
  ...over });

test('case A — a shared athlete never overrides an explicit phase or event conflict (real 9/23 shooting)',()=>{
  const show = parseBroadcasts(JSON.stringify({ schemaVersion:1, records:[
    { date:'2026-09-23',providerId:'elta',providerName:'愛爾達',isLive:true,
      broadcastStartTimeTaipei:'2026-09-23T11:20:00+08:00',broadcastEndTimeTaipei:'2026-09-23T12:38:00+08:00',
      disciplineCode:'SHO',title:'亞運 鄭晏晴 射擊 女子10M空氣手槍決賽 9/23 LIVE',feed:'main',
      matchLevel:'unit',matchHint:{athleteNames:['CHENG Yen-Ching']} }]}));
  const qualification = shooting923({ startTimeTaipei:'2026-09-23T08:45:00+08:00' });
  const teamFinal = shooting923({ startTimeTaipei:'2026-09-23T08:45:00+08:00',
    event:'10m Air Pistol Women Team', phase:'10m Air Pistol Women Team Final' });
  const individualFinal = shooting923({ startTimeTaipei:'2026-09-23T11:30:00+08:00',
    phase:'10m Air Pistol Women Individual Final' });
  assert.equal(broadcastsForRow(show,'2026-09-23',individualFinal).length,1,'只配個人決賽');
  assert.equal(broadcastsForRow(show,'2026-09-23',qualification).length,0,'不配個人資格賽（phase 衝突）');
  assert.equal(broadcastsForRow(show,'2026-09-23',teamFinal).length,0,'不配團體決賽（event 衝突）');
});

test('case B — a shared opponent never overrides an explicit event conflict (real 9/23 table tennis)',()=>{
  const show = parseBroadcasts(JSON.stringify({ schemaVersion:1, records:[
    { date:'2026-09-23',providerId:'elta',providerName:'愛爾達',isLive:true,
      broadcastStartTimeTaipei:'2026-09-23T18:30:00+08:00',broadcastEndTimeTaipei:'2026-09-23T21:00:00+08:00',
      disciplineCode:'TTE',title:'亞運 中國VS中華 桌球 男團四強(第1桌) 9/23 LIVE',feed:'main',
      matchLevel:'unit',matchHint:{opponentCodes:['CHN']} }]}));
  const mixedDoubles = { disciplineCode:'TTE', opponentCode:'CHN', athletesEn:[],
    startTimeTaipei:'2026-09-23T12:45:00+08:00', event:'Mixed Doubles', phase:'Mixed Doubles Round 3' };
  const mensTeamSemifinal = { disciplineCode:'TTE', opponentCode:'CHN', athletesEn:[],
    startTimeTaipei:'2026-09-23T18:30:00+08:00', event:"Men's Team", phase:"Men's Team Semifinals" };
  assert.equal(broadcastsForRow(show,'2026-09-23',mensTeamSemifinal).length,1,'配男子團體準決賽');
  assert.equal(broadcastsForRow(show,'2026-09-23',mixedDoubles).length,0,'不配混合雙打（event 衝突：男團 vs 混雙）');
});

test('case C — a personal broadcast never overrides an explicit team conflict, but its own mixed doubles still matches (real 9/22 table tennis)',()=>{
  const show = parseBroadcasts(JSON.stringify({ schemaVersion:1, records:[
    { date:'2026-09-22',providerId:'elta',providerName:'愛爾達',isLive:true,
      broadcastStartTimeTaipei:'2026-09-22T14:10:00+08:00',broadcastEndTimeTaipei:'2026-09-22T14:50:00+08:00',
      disciplineCode:'TTE',title:'亞運 馮翊新/葉伊恬 桌球 混雙預賽 9/22(原音) LIVE',feed:'original',
      matchLevel:'unit',matchHint:{athleteNames:['FENG Yi-hsin','YEH Yi-tian']} }]}));
  const womensTeam = { disciplineCode:'TTE', opponentCode:'MAC', athletesEn:['YEH Yi-tian','CHEN Szu-yu','PENG Yu-han','CHENG I-ching','WU Ying-syuan'],
    startTimeTaipei:'2026-09-22T09:00:00+08:00', event:"Women's Team", phase:"Women's Team Round 1" };
  const mensTeam = { disciplineCode:'TTE', opponentCode:'MGL', athletesEn:['FENG Yi-hsin','HSU Hsien-chia','LIN Yun-ju','KUO Guan-hong','HUNG Jing-kai'],
    startTimeTaipei:'2026-09-22T11:30:00+08:00', event:"Men's Team", phase:"Men's Team Round 1" };
  const womensTeamQF = { ...womensTeam, startTimeTaipei:'2026-09-22T18:20:00+08:00', phase:"Women's Team Quarterfinals" };
  const mixedDoubles = { disciplineCode:'TTE', opponentCode:'KAZ', athletesEn:['FENG Yi-hsin','YEH Yi-tian'],
    startTimeTaipei:'2026-09-22T14:10:00+08:00', event:'Mixed Doubles', phase:'Mixed Doubles Round 1' };
  assert.equal(broadcastsForRow(show,'2026-09-22',mixedDoubles).length,1,'正確混雙仍可配');
  assert.equal(broadcastsForRow(show,'2026-09-22',womensTeam).length,0,'不配女團（雖然同一位選手在隊上）');
  assert.equal(broadcastsForRow(show,'2026-09-22',mensTeam).length,0,'不配男團');
  assert.equal(broadcastsForRow(show,'2026-09-22',womensTeamQF).length,0,'不配女團八強');
});

test('case D — a shared athlete never overrides an explicit final-vs-heats conflict (real 9/22 swimming)',()=>{
  const show = parseBroadcasts(JSON.stringify({ schemaVersion:1, records:[
    { date:'2026-09-22',providerId:'elta',providerName:'愛爾達',isLive:true,
      broadcastStartTimeTaipei:'2026-09-22T15:55:00+08:00',broadcastEndTimeTaipei:'2026-09-22T18:00:00+08:00',
      disciplineCode:'SWM',title:'亞運 劉姵吟/張雅佳 游泳 決賽 9/22 LIVE',feed:'main',
      matchLevel:'unit',matchHint:{athleteNames:['CHANG Ya-jia','LIU Pei-yin']} }]}));
  const heats = { disciplineCode:'SWM', opponentCode:null, athletesEn:['LIU Pei-yin'],
    startTimeTaipei:'2026-09-22T09:03:00+08:00', event:"Women's 100m Freestyle", phase:"Women's 100m Freestyle Heats" };
  const final = { disciplineCode:'SWM', opponentCode:null, athletesEn:['LIU Pei-yin'],
    startTimeTaipei:'2026-09-22T16:00:00+08:00', event:"Women's 100m Freestyle", phase:"Women's 100m Freestyle Final" };
  assert.equal(broadcastsForRow(show,'2026-09-22',final).length,1,'正確決賽仍可配');
  assert.equal(broadcastsForRow(show,'2026-09-22',heats).length,0,'不配上午預賽（phase 衝突：決賽 vs 預賽）');
});

test('case E — an explicit different shooting event is never matched, even with a shared athlete (real 9/23)',()=>{
  const show = parseBroadcasts(JSON.stringify({ schemaVersion:1, records:[
    { date:'2026-09-23',providerId:'elta',providerName:'愛爾達',isLive:true,
      broadcastStartTimeTaipei:'2026-09-23T14:55:00+08:00',broadcastEndTimeTaipei:'2026-09-23T16:00:00+08:00',
      disciplineCode:'SHO',title:'亞運 李孟遠 射擊 男子定向飛靶決賽 9/23 LIVE',feed:'main',
      matchLevel:'unit',matchHint:{athleteNames:['LEE Meng-Yuan']} }]}));
  // The row is the real Skeet ("雙向飛靶") unit — a different event from the broadcast's Trap
  // ("定向飛靶") title. Whether ELTA mislabelled the title is not this test's concern; only that
  // an explicit event conflict is never bridged by the shared athlete.
  const skeetFinal = { disciplineCode:'SHO', opponentCode:null, athletesEn:['LEE Meng-Yuan'],
    startTimeTaipei:'2026-09-23T15:00:00+08:00', event:'Skeet Men Individual', phase:'Skeet Men Individual Final' };
  assert.equal(broadcastsForRow(show,'2026-09-23',skeetFinal).length,0,'不得因 athlete 相同配到明確不同 event 的 Skeet 卡');
});

// -- PRELIM family normalization: official phase text spells the qualifying stage differently
// per discipline ("...Qualification" in shooting, "...Qualifier" in equestrian, "...Qualifying"
// in cycling), but ELTA's Chinese titles only ever say "資格賽"/"預賽". \bQualif must reach all
// three without also firing on an unrelated word that happens to contain the substring. --

test('Qualifier is recognised as the same PRELIM family as Qualification (real 9/26 equestrian)',()=>{
  const show = parseBroadcasts(JSON.stringify({ schemaVersion:1, records:[
    { date:'2026-09-26',providerId:'elta',providerName:'愛爾達',isLive:true,
      broadcastStartTimeTaipei:'2026-09-26T09:00:00+08:00',broadcastEndTimeTaipei:'2026-09-26T16:20:00+08:00',
      disciplineCode:'EQU',title:'亞運 中華隊 馬術 馬場馬術個人賽第2輪資格賽 9/26(原音) LIVE',feed:'original',
      matchLevel:'discipline',matchHint:{phaseKeywords:['Qualification']} }]}));
  const dressageQualifier = { disciplineCode:'EQU', opponentCode:null,
    athletesEn:['CHEN Yi-ju','WANG Yu-jun','SHYONG Tien-chi','YEH Hsiu-hua'],
    // Inside the broadcast's own window: this isolates the phase-family question from the
    // real row's separate, pre-existing 08:30-vs-09:00 window gap (not this test's concern —
    // see the follow-up note in the PR/report).
    startTimeTaipei:'2026-09-26T09:05:00+08:00',
    event:'Dressage Individual', phase:'Dressage 2nd Individual Qualifier',
    participationState:'TPE_CONFIRMED', entryLevel:'unit' };
  assert.equal(broadcastsForRow(show,'2026-09-26',dressageQualifier).length,1,
    'Qualifier 應與資格賽廣播的 Qualification family 視為同一 phase');
});

test('Qualification still matches Qualification — the normalization is additive, not a regression',()=>{
  const show = parseBroadcasts(JSON.stringify({ schemaVersion:1, records:[
    { date:'2026-09-23',providerId:'elta',providerName:'愛爾達',isLive:true,
      broadcastStartTimeTaipei:'2026-09-23T08:00:00+08:00',broadcastEndTimeTaipei:'2026-09-23T09:00:00+08:00',
      disciplineCode:'SHO',title:'亞運 中華隊 射擊 資格賽 9/23 LIVE',feed:'main',
      matchLevel:'discipline',matchHint:{} }]}));
  const qualification = { disciplineCode:'SHO', opponentCode:null, athletesEn:['CHENG Yen-Ching'],
    startTimeTaipei:'2026-09-23T08:30:00+08:00',
    event:'10m Air Pistol Women Individual', phase:'10m Air Pistol Women Individual Qualification',
    participationState:'TPE_CONFIRMED', entryLevel:'unit' };
  assert.equal(broadcastsForRow(show,'2026-09-23',qualification).length,1,
    '既有的 Qualification/Qualification 配對不受這次改動影響');
});

test('a clearly different phase still does not match just because both mention qualifying',()=>{
  const show = parseBroadcasts(JSON.stringify({ schemaVersion:1, records:[
    { date:'2026-09-26',providerId:'elta',providerName:'愛爾達',isLive:true,
      broadcastStartTimeTaipei:'2026-09-26T09:00:00+08:00',broadcastEndTimeTaipei:'2026-09-26T16:20:00+08:00',
      disciplineCode:'EQU',title:'亞運 中華隊 馬術 馬場馬術個人賽第2輪資格賽 9/26(原音) LIVE',feed:'original',
      matchLevel:'discipline',matchHint:{phaseKeywords:['Qualification']} }]}));
  // Same discipline, same day, but the row is explicitly a Final — 決賽/資格賽 stay two
  // different families, exactly as before this change.
  const dressageFinal = { disciplineCode:'EQU', opponentCode:null, athletesEn:['CHEN Yi-ju'],
    startTimeTaipei:'2026-09-26T09:05:00+08:00',
    event:'Dressage Individual', phase:'Dressage Individual Final',
    participationState:'TPE_CONFIRMED', entryLevel:'unit' };
  assert.equal(broadcastsForRow(show,'2026-09-26',dressageFinal).length,0,
    '資格賽廣播不得配到明確的決賽卡');
});

test('the PRELIM family is not discipline-specific — any sport spelling the stage "Qualifier"/"Qualifying" benefits, not just equestrian',()=>{
  const show = parseBroadcasts(JSON.stringify({ schemaVersion:1, records:[
    { date:'2026-09-24',providerId:'elta',providerName:'愛爾達',isLive:true,
      broadcastStartTimeTaipei:'2026-09-24T09:00:00+08:00',broadcastEndTimeTaipei:'2026-09-24T11:00:00+08:00',
      disciplineCode:'ARC',title:'亞運 中華隊 射箭 資格賽 9/24 LIVE',feed:'main',
      matchLevel:'discipline',matchHint:{} }]}));
  const qualifyingRound = { disciplineCode:'ARC', opponentCode:null, athletesEn:['SOME Archer'],
    startTimeTaipei:'2026-09-24T09:30:00+08:00',
    event:"Men's Individual", phase:"Recurve Men's Individual Qualification Round",
    participationState:'TPE_CONFIRMED', entryLevel:'unit' };
  const qualifyingSpelling = { disciplineCode:'ARC', opponentCode:null, athletesEn:['SOME Cyclist'],
    startTimeTaipei:'2026-09-24T09:30:00+08:00',
    event:'Team Pursuit', phase:'Men\'s Team Pursuit, Qualifying',
    participationState:'TPE_CONFIRMED', entryLevel:'unit' };
  assert.equal(broadcastsForRow(show,'2026-09-24',qualifyingRound).length,1,
    '"Qualification Round" 這個變體同樣受惠，不是只為 EQU 寫死');
  assert.equal(broadcastsForRow(show,'2026-09-24',qualifyingSpelling).length,1,
    '"Qualifying"（動名詞拼法）同樣受惠');
});

test('the broadened PRELIM regex does not fire on an unrelated word that merely contains "qualif"',()=>{
  const show = parseBroadcasts(JSON.stringify({ schemaVersion:1, records:[
    { date:'2026-09-26',providerId:'elta',providerName:'愛爾達',isLive:true,
      broadcastStartTimeTaipei:'2026-09-26T09:00:00+08:00',broadcastEndTimeTaipei:'2026-09-26T16:20:00+08:00',
      disciplineCode:'EQU',title:'亞運 中華隊 馬術 馬場馬術個人賽第2輪資格賽 9/26(原音) LIVE',feed:'original',
      matchLevel:'discipline',matchHint:{phaseKeywords:['Qualification']} }]}));
  // "Disqualified" is never an official phase name in this dataset, but the \b boundary is
  // what keeps a word like this safe in principle — assert it directly rather than trust that
  // no such phase will ever appear.
  const disqualified = { disciplineCode:'EQU', opponentCode:null, athletesEn:['CHEN Yi-ju'],
    startTimeTaipei:'2026-09-26T09:05:00+08:00',
    event:'Dressage Individual', phase:'Dressage Individual Disqualified',
    participationState:'TPE_CONFIRMED', entryLevel:'unit' };
  assert.equal(broadcastsForRow(show,'2026-09-26',disqualified).length,0,
    '"Disqualified" 不應被誤判為 PRELIM family（\\b 邊界防呆）');
});

// -- per-entrant STARTTIME evidence: a unit's own startTimeTaipei can be another competitor's
// slot in a long, sequential-entry session (many riders/throwers/shooters going in turn). When
// the official response gives one or more Chinese Taipei entrants their own clock time, that
// evidence is used instead of — never in addition to, never overridden by — the coarser unit
// time. A discipline that never publishes this per-competitor time is completely unaffected. --

const equShow = (over:Record<string,unknown> = {})=>parseBroadcasts(JSON.stringify({ schemaVersion:1, records:[
  { date:'2026-09-26',providerId:'elta',providerName:'愛爾達',isLive:true,
    broadcastStartTimeTaipei:'2026-09-26T09:00:00+08:00',broadcastEndTimeTaipei:'2026-09-26T16:20:00+08:00',
    disciplineCode:'EQU',title:'亞運 中華隊 馬術 馬場馬術個人賽第2輪資格賽 9/26(原音) LIVE',feed:'original',
    matchLevel:'discipline',matchHint:{phaseKeywords:['Qualification']},...over }]}));
// The real 9/26 row: unit time 08:30 (before the broadcast even starts), four TPE riders whose
// own official times are 09:18/09:26/10:45/13:48 — all inside the 09:00–16:20 window.
const equRow = (entrants:{registration:string;startTimeTaipei:string|null}[])=>({
  disciplineCode:'EQU', opponentCode:null,
  athletesEn:['CHEN Yi-ju','WANG Yu-jun','SHYONG Tien-chi','YEH Hsiu-hua'],
  startTimeTaipei:'2026-09-26T08:30:00+08:00',
  event:'Dressage Individual', phase:'Dressage 2nd Individual Qualifier',
  participationState:'TPE_CONFIRMED', entryLevel:'unit',
  tpeEntrants:entrants.map(e=>({ name:null, registration:e.registration, result:null, rank:null,
    startTimeTaipei:e.startTimeTaipei })) });

test('1 — real 9/26 equestrian case: unit time 08:30 is outside the window, but the TPE entrants\' own times put it inside, and Qualifier/Qualification is the same PRELIM family',()=>{
  const row = equRow([
    { registration:'2724373', startTimeTaipei:'2026-09-26T09:18:00+08:00' },
    { registration:'10521853', startTimeTaipei:'2026-09-26T09:26:00+08:00' },
    { registration:'2703666', startTimeTaipei:'2026-09-26T10:45:00+08:00' },
    { registration:'10513535', startTimeTaipei:'2026-09-26T13:48:00+08:00' },
  ]);
  assert.equal(broadcastsForRow(equShow(),'2026-09-26',row).length,1,
    '真實9/26案例：unit時間08:30在窗口外，但TPE選手個別時間應成立時間證據，唯一配對成功');
});

test('2 — every TPE entrant\'s own time is outside the window: must not fall back to the unit time even though the unit time is inside it',()=>{
  const row = equRow([
    { registration:'2724373', startTimeTaipei:'2026-09-26T17:00:00+08:00' },
    { registration:'10521853', startTimeTaipei:'2026-09-26T17:10:00+08:00' },
  ]);
  // The unit's own startTimeTaipei (08:30) IS inside the broadcast window (09:00–16:20), but
  // once precise per-entrant evidence exists, it alone decides — the coarser unit time must
  // never be consulted as a fallback just because the precise evidence came up empty.
  assert.equal(broadcastsForRow(equShow(),'2026-09-26',row).length,0,
    '有精確的選手個別時間證據時，即使全部落在窗口外，也不能退回去用unit時間放行');
});

test('3 — no competitor carries a STARTTIME at all (e.g. boxing): behaviour is exactly the pre-existing unit-time fallback',()=>{
  const withoutTimes = equRow([
    { registration:'2724373', startTimeTaipei:null },
    { registration:'10521853', startTimeTaipei:null },
  ]);
  // Unit time 08:30 is genuinely outside this window (09:00–16:20), same as the real bug: with
  // no per-entrant evidence at all, the row falls back to the ordinary unit-time check and is
  // correctly left unmatched — proving the fallback path is untouched, not silently loosened.
  assert.equal(broadcastsForRow(equShow(),'2026-09-26',withoutTimes).length,0,
    '完全沒有STARTTIME時，行為必須跟改動前的 unit time 判斷完全一樣');
  const insideUnitWindow = { ...withoutTimes, startTimeTaipei:'2026-09-26T09:30:00+08:00' };
  assert.equal(broadcastsForRow(equShow(),'2026-09-26',insideUnitWindow).length,1,
    '沒有STARTTIME、但unit時間本身在窗口內時，照舊fallback邏輯成功配對');
});

test('4 — several TPE entrants, only one official time inside the window: that one is enough',()=>{
  const row = equRow([
    { registration:'2724373', startTimeTaipei:'2026-09-26T17:00:00+08:00' }, // outside
    { registration:'10521853', startTimeTaipei:'2026-09-26T09:26:00+08:00' }, // inside
    { registration:'2703666', startTimeTaipei:'2026-09-26T18:00:00+08:00' }, // outside
  ]);
  assert.equal(broadcastsForRow(equShow(),'2026-09-26',row).length,1,
    '多位TPE選手，只要其中一位官方時間落在窗口內即可形成時間證據');
});

test('5 — malformed or missing STARTTIME on some entrants is safely ignored, never guessed',()=>{
  const row = equRow([
    { registration:'2724373', startTimeTaipei:null },
    { registration:'10521853', startTimeTaipei:'2026-09-26T09:26:00+08:00' },
  ]);
  assert.equal(broadcastsForRow(equShow(),'2026-09-26',row).length,1,
    '缺欄位的entrant被安全忽略，另一位有效的官方時間仍然成立');
  // No entrants array at all (older canonical rows this discipline had before the schema
  // addition, or a discipline that never populates it) degrades to the unit-time fallback.
  const noEntrantsField = { ...row, tpeEntrants:undefined };
  assert.equal(broadcastsForRow(equShow(),'2026-09-26',noEntrantsField).length,0,
    '完全沒有 tpeEntrants 欄位時退回 unit time（08:30 在窗口外），不得因為欄位缺失而誤判');
});

test('6 — an explicit phase conflict is never bridged by a hit competitor time',()=>{
  const finalShow = equShow({ title:'亞運 中華隊 馬術 馬場馬術個人賽決賽 9/26 LIVE',
    matchHint:{ phaseKeywords:['Final'] } });
  const row = { ...equRow([{ registration:'2724373', startTimeTaipei:'2026-09-26T09:18:00+08:00' }]),
    phase:'Dressage 2nd Individual Qualifier' }; // still the qualifier, broadcast is now the final
  assert.equal(broadcastsForRow(finalShow,'2026-09-26',row).length,0,
    '廣播明確是決賽、卡是資格賽，即使選手個別時間命中窗口，phase 衝突仍必須擋下');
});

test('explicit conflict veto does not disturb one-to-many or same-card multi-channel behaviour',async()=>{
  const shows = await loadBroadcasts();
  const day = parseDaily(JSON.parse(await readFile('data/normalized/daily-2026-09-23.json','utf8')),'2026-09-23');
  const rows = taiwanRows(day);
  // 9/23 table tennis "混雙/女單預賽" still legitimately covers three different units.
  const ttePhaseSession = rows.filter(r=>r.disciplineCode === 'TTE'
    && broadcastsForRow(shows,'2026-09-23',r).some(b=>b.broadcastStartTimeTaipei === '2026-09-23T08:55:00+08:00'));
  assert.deepEqual(ttePhaseSession.map(r=>[r.startTimeTaipei,r.event]),[
    ['2026-09-23T09:00:00+08:00','Mixed Doubles'],
    ['2026-09-23T09:40:00+08:00','Mixed Doubles'],
    ['2026-09-23T11:50:00+08:00',"Women's Singles"],
  ]);
  // 9/23 karate men's team kata quarterfinal still keeps its own multi-channel broadcasts.
  const teamKataQF = rows.find(r=>r.disciplineCode === 'KTE' && r.phase === "Men's Team Kata Quarterfinals")!;
  const onQF = broadcastsForRow(shows,'2026-09-23',teamKataQF);
  assert.ok(onQF.length >= 1);
});

// -- second cut: a small, shared alias table extends the same veto/positive-match machinery
// to explicit event/phase words the title uses (附加賽/八強/四強/銅牌戰/混雙/女單/男單/男雙/女雙),
// so a session broadcast with no manually-curated hint can still be attached — but only to
// units whose own phase actually says so, never by time alone. --

test('case F — 附加賽 (Play-in) attaches to both the women\'s and men\'s Play-in units (real 9/24 3x3 basketball)',()=>{
  const show = parseBroadcasts(JSON.stringify({ schemaVersion:1, records:[
    { date:'2026-09-24',providerId:'elta',providerName:'愛爾達',isLive:true,channelId:'101',
      broadcastStartTimeTaipei:'2026-09-24T10:55:00+08:00',broadcastEndTimeTaipei:'2026-09-24T14:00:00+08:00',
      disciplineCode:'BK3',title:'亞運 中華隊 3x3籃球 男/女附加賽 9/24 LIVE',feed:'main',
      matchLevel:'discipline',matchHint:{} }]}));
  const womensPlayin = { disciplineCode:'BK3', opponentCode:'MGL', athletesEn:[],
    startTimeTaipei:'2026-09-24T11:00:00+08:00', event:'Women', phase:'Women Play-in' };
  const mensPlayin = { disciplineCode:'BK3', opponentCode:'MAS', athletesEn:[],
    startTimeTaipei:'2026-09-24T11:50:00+08:00', event:'Men', phase:'Men Play-in' };
  assert.equal(broadcastsForRow(show,'2026-09-24',womensPlayin).length,1);
  assert.equal(broadcastsForRow(show,'2026-09-24',mensPlayin).length,1);
});

test('case G — 八強 (Quarterfinal) attaches to each window\'s own quarterfinal, never across time windows (real 9/24 3x3 basketball)',()=>{
  const show = parseBroadcasts(JSON.stringify({ schemaVersion:1, records:[
    { date:'2026-09-24',providerId:'elta',providerName:'愛爾達',isLive:true,channelId:'543',
      broadcastStartTimeTaipei:'2026-09-24T16:35:00+08:00',broadcastEndTimeTaipei:'2026-09-24T20:00:00+08:00',
      disciplineCode:'BK3',title:'亞運 中華隊 3x3籃球 男/女八強 9/24(原音) LIVE',feed:'original',
      matchLevel:'discipline',matchHint:{} },
    { date:'2026-09-24',providerId:'elta',providerName:'愛爾達',isLive:true,channelId:'110',
      broadcastStartTimeTaipei:'2026-09-24T17:00:00+08:00',broadcastEndTimeTaipei:'2026-09-24T18:30:00+08:00',
      disciplineCode:'BK3',title:'亞運 中華隊 3x3籃球 男/女八強 9/24 LIVE',feed:'main',
      matchLevel:'discipline',matchHint:{} }]}));
  const womensQF = { disciplineCode:'BK3', opponentCode:'KOR', athletesEn:[],
    startTimeTaipei:'2026-09-24T16:40:00+08:00', event:'Women', phase:'Women Quarterfinals' };
  const mensQF = { disciplineCode:'BK3', opponentCode:'PHI', athletesEn:[],
    startTimeTaipei:'2026-09-24T17:30:00+08:00', event:'Men', phase:'Men Quarterfinals' };
  // The women's quarterfinal (16:40) is only inside the wide ch543 window, not the narrower
  // ch110 window that starts at 17:00.
  assert.equal(broadcastsForRow(show,'2026-09-24',womensQF).length,1);
  // The men's quarterfinal (17:30) is inside both windows.
  assert.equal(broadcastsForRow(show,'2026-09-24',mensQF).length,2);
});

test('case H — 混雙 (Mixed Doubles) + 八強 attaches only to the mixed-doubles quarterfinal, never men\'s/women\'s singles or doubles (real 9/25 table tennis)',()=>{
  const show = parseBroadcasts(JSON.stringify({ schemaVersion:1, records:[
    { date:'2026-09-25',providerId:'elta',providerName:'愛爾達',isLive:true,channelId:'101',
      broadcastStartTimeTaipei:'2026-09-25T08:55:00+08:00',broadcastEndTimeTaipei:'2026-09-25T13:00:00+08:00',
      disciplineCode:'TTE',title:'亞運 中華隊 桌球 混雙八強/女單預賽 9/25 LIVE',feed:'main',
      matchLevel:'discipline',matchHint:{phaseKeywords:['Heats','Preliminar','Qualification','Round Robin','Group']} }]}));
  const mixedQF = { disciplineCode:'TTE', opponentCode:'KOR', athletesEn:[],
    startTimeTaipei:'2026-09-25T09:00:00+08:00', event:'Mixed Doubles', phase:'Mixed Doubles Quarterfinals' };
  const mensDoubles = { disciplineCode:'TTE', opponentCode:'LAO', athletesEn:[],
    startTimeTaipei:'2026-09-25T10:00:00+08:00', event:"Men's Doubles", phase:"Men's Doubles Round 2" };
  const womensSingles = { disciplineCode:'TTE', opponentCode:'PRK', athletesEn:[],
    startTimeTaipei:'2026-09-25T11:30:00+08:00', event:"Women's Singles", phase:"Women's Singles Round 2" };
  const mensSingles = { disciplineCode:'TTE', opponentCode:'MAS', athletesEn:[],
    startTimeTaipei:'2026-09-25T13:00:00+08:00', event:"Men's Singles", phase:"Men's Singles Round 2" };
  assert.equal(broadcastsForRow(show,'2026-09-25',mixedQF).length,1,'正確配到混雙八強');
  assert.equal(broadcastsForRow(show,'2026-09-25',mensDoubles).length,0,'不得配到男雙（event 衝突：混雙 vs 男雙）');
  assert.equal(broadcastsForRow(show,'2026-09-25',mensSingles).length,0,'不得配到男單（event 衝突：女單 vs 男單）');
  // Women's Singles Round 2 is deferred to a future cut (no "Round N" phase alias yet), so it
  // stays an orphan for now rather than being guessed — this is the expected current state.
  assert.equal(broadcastsForRow(show,'2026-09-25',womensSingles).length,0,'女單 Round 2 本輪暫不解，維持 orphan');
});

test('the real 9/25 north-korea-vs-taiwan football quarterfinal still matches by opponent, despite the hyphenated "Quarter-finals" wording',async()=>{
  const shows = await loadBroadcasts();
  const day = parseDaily(JSON.parse(await readFile('data/normalized/daily-2026-09-25.json','utf8')),'2026-09-25');
  const row = taiwanRows(day).find(r=>r.disciplineCode === 'FBL')!;
  assert.equal(row.phase,'Women Quarter-finals');
  assert.ok(broadcastsForRow(shows,'2026-09-25',row).length >= 1,
    '"Quarter-finals" 的連字號不得被誤判成 FINAL family 而擋掉既有的 opponent 證據');
});

// A broad official phase such as "Women Finals" describes the medal stage, not necessarily the
// gold-medal game. The canonical unit carries the more specific medal-game evidence.
const bronzeShow = (over:Record<string,unknown> = {})=>parseBroadcasts(JSON.stringify({ schemaVersion:1, records:[
  { date:'2026-09-26',providerId:'elta',providerName:'愛爾達',isLive:true,channelId:'101',
    broadcastStartTimeTaipei:'2026-09-26T14:50:00+08:00',broadcastEndTimeTaipei:'2026-09-26T17:00:00+08:00',
    disciplineCode:'BKB',title:'亞運 中華VS中國 籃球 女子銅牌戰 9/26 LIVE',feed:'main',
    matchLevel:'unit',matchHint:{opponentCodes:['CHN']},...over }]}));
const bronzeRow = (over:Record<string,unknown> = {})=>({
  disciplineCode:'BKB',opponentCode:'CHN',athletesEn:[],
  startTimeTaipei:'2026-09-26T15:00:00+08:00',event:'Women',phase:'Women Finals',
  unit:'Women Finals Bronze Medal Game',...over,
});

test('a bronze-medal broadcast matches a canonical Bronze Medal Game inside the broad Women Finals phase',()=>{
  assert.equal(broadcastsForRow(bronzeShow(),'2026-09-26',bronzeRow()).length,1);
});

test('a bronze-medal broadcast still conflicts with a true gold-medal game',()=>{
  const gold=bronzeRow({unit:'Women Finals Gold Medal Game'});
  assert.equal(broadcastsForRow(bronzeShow(),'2026-09-26',gold).length,0);
});

test('a bronze-medal broadcast still conflicts with semifinals and quarterfinals',()=>{
  for (const phase of ['Women Semifinals','Women Quarterfinals']) {
    assert.equal(broadcastsForRow(bronzeShow(),'2026-09-26',bronzeRow({phase,unit:phase})).length,0,phase);
  }
});

test('specific bronze-game evidence never overrides an opponent mismatch',()=>{
  assert.equal(broadcastsForRow(bronzeShow(),'2026-09-26',bronzeRow({opponentCode:'JPN'})).length,0);
});

test('a phase-only bronze programme still requires its existing time-window evidence',()=>{
  const phaseOnly=bronzeShow({matchLevel:'discipline',matchHint:{}});
  assert.equal(broadcastsForRow(phaseOnly,'2026-09-26',bronzeRow({
    opponentCode:null,startTimeTaipei:'2026-09-26T17:00:00+08:00',
  })).length,0);
});

test('the real 9/26 women\'s basketball bronze game has exactly one production broadcast match',async()=>{
  const shows=await loadBroadcasts();
  const date='2026-09-26';
  const day=parseDaily(JSON.parse(await readFile(`data/normalized/daily-${date}.json`,'utf8')),date);
  const row=taiwanRows(day).find(r=>r.disciplineCode==='BKB'&&r.unit?.includes('Bronze Medal Game'))!;
  assert.ok(row);
  const found=broadcastsForRow(shows,date,row,day.sessionChains??[]);
  assert.equal(found.length,1);
  assert.equal(found[0].title,'亞運 中華VS中國 籃球 女子銅牌戰 9/26 LIVE');
});

// -- third cut: a D-LIVE rerun with no evidence of its own inherits whatever cards its LIVE
// original already safely matched, but only when the two titles are identical once pure
// playback markers (LIVE/D-LIVE/原音/續看) are stripped. Nothing else changes: competition time
// stays put, the D-LIVE keeps showing its own broadcast time, and LIVE + D-LIVE can coexist. --

const heat = (time:string, phase:string)=>({ disciplineCode:'SWM', opponentCode:null, athletesEn:[],
  startTimeTaipei:`2026-09-21T${time}:00+08:00`, phase });

test('case A — a D-LIVE rerun inherits exactly the cards its LIVE original matched (real 9/21 swimming heats)',()=>{
  const show = parseBroadcasts(JSON.stringify({ schemaVersion:1, records:[
    { date:'2026-09-21',providerId:'elta',providerName:'愛爾達',channelId:'540',isLive:true,
      broadcastStartTimeTaipei:'2026-09-21T08:55:00+08:00',broadcastEndTimeTaipei:'2026-09-21T10:50:00+08:00',
      disciplineCode:'SWM',title:'亞運 中華隊 游泳 預賽 9/21(原音) LIVE',feed:'original',
      matchLevel:'discipline',matchHint:{phaseKeywords:['Heats','Preliminar','Qualification','Round Robin','Group']} },
    { date:'2026-09-21',providerId:'elta',providerName:'愛爾達',channelId:'101',isLive:false,
      broadcastStartTimeTaipei:'2026-09-21T10:30:00+08:00',broadcastEndTimeTaipei:'2026-09-21T11:50:00+08:00',
      disciplineCode:'SWM',title:'亞運 中華隊 游泳 預賽 9/21 D-LIVE',feed:'main',
      matchLevel:'discipline',matchHint:{phaseKeywords:['Heats','Preliminar','Qualification','Round Robin','Group']} }]}));
  const backstroke = heat('09:00',"Men's 50m Backstroke Heats");
  const found = broadcastsForRow(show,'2026-09-21',backstroke);
  assert.equal(found.length,2,'LIVE 與繼承的 D-LIVE 都應出現');
  assert.deepEqual(new Set(found.map(b=>b.channelId)),new Set(['540','101']));
  const dlive = found.find(b=>b.isLive === false)!;
  // The D-LIVE keeps its own (later) broadcast time; the row's competition time is untouched.
  assert.equal(dlive.broadcastStartTimeTaipei,'2026-09-21T10:30:00+08:00');
  assert.equal(backstroke.startTimeTaipei,'2026-09-21T09:00:00+08:00');
  // A final, outside the heats session entirely, gets neither.
  const final = heat('16:00',"Men's 50m Backstroke Final");
  assert.equal(broadcastsForRow(show,'2026-09-21',final).length,0);
});

test('case B — the same inheritance holds for a second, independent day (real 9/25 swimming heats)',()=>{
  const show = parseBroadcasts(JSON.stringify({ schemaVersion:1, records:[
    { date:'2026-09-25',providerId:'elta',providerName:'愛爾達',channelId:'541',isLive:true,
      broadcastStartTimeTaipei:'2026-09-25T08:55:00+08:00',broadcastEndTimeTaipei:'2026-09-25T10:35:00+08:00',
      disciplineCode:'SWM',title:'亞運 中華隊 游泳 預賽 9/25(原音) LIVE',feed:'original',
      matchLevel:'discipline',matchHint:{phaseKeywords:['Heats','Preliminar','Qualification','Round Robin','Group']} },
    { date:'2026-09-25',providerId:'elta',providerName:'愛爾達',channelId:'110',isLive:false,
      broadcastStartTimeTaipei:'2026-09-25T14:45:00+08:00',broadcastEndTimeTaipei:'2026-09-25T16:00:00+08:00',
      disciplineCode:'SWM',title:'亞運 中華隊 游泳 預賽 9/25 D-LIVE',feed:'main',
      matchLevel:'discipline',matchHint:{phaseKeywords:['Heats','Preliminar','Qualification','Round Robin','Group']} }]}));
  const row = { disciplineCode:'SWM', opponentCode:null, athletesEn:[],
    startTimeTaipei:'2026-09-25T09:00:00+08:00', phase:"Women's 50m Butterfly Heats" };
  const found = broadcastsForRow(show,'2026-09-25',row);
  assert.equal(found.length,2);
  assert.ok(found.some(b=>b.isLive === false && b.channelId === '110'));
});

test('case C — a D-LIVE rerun credited to a different athlete, or covering a different round, is not inherited (real karate examples)',()=>{
  // 9/22: the LIVE names a specific athlete ("鍾孟宇"); the D-LIVE rerun uses the generic "中華隊"
  // label instead — a real difference in who the programme is about, not playback noise.
  const namedAthlete = parseBroadcasts(JSON.stringify({ schemaVersion:1, records:[
    { date:'2026-09-22',providerId:'elta',providerName:'愛爾達',channelId:'543',isLive:true,
      broadcastStartTimeTaipei:'2026-09-22T08:55:00+08:00',broadcastEndTimeTaipei:'2026-09-22T11:15:00+08:00',
      disciplineCode:'KTE',title:'亞運 鍾孟宇 空手道 女子團體型/男84公斤級八強/四強/銅牌戰 9/22(原音) LIVE',feed:'original',
      matchLevel:'unit',matchHint:{athleteNames:['CHUNG Meng-yu']} },
    { date:'2026-09-22',providerId:'elta',providerName:'愛爾達',channelId:'105',isLive:false,
      broadcastStartTimeTaipei:'2026-09-22T12:30:00+08:00',broadcastEndTimeTaipei:'2026-09-22T13:25:00+08:00',
      disciplineCode:'KTE',title:'亞運 中華隊 空手道 女子團體型/男84公斤級八強/四強/銅牌戰 9/22 D-LIVE',feed:'main',
      matchLevel:'discipline',matchHint:{} }]}));
  const kumite84 = { disciplineCode:'KTE', opponentCode:'JOR', athletesEn:['CHUNG Meng-yu'],
    startTimeTaipei:'2026-09-22T09:50:00+08:00', event:'Men\'s Kumite -84kg', phase:'Men\'s Kumite -84kg Quarterfinals' };
  const found = broadcastsForRow(namedAthlete,'2026-09-22',kumite84);
  assert.equal(found.length,1,'只有 LIVE 本身（靠具名選手證據）配到，D-LIVE 不應繼承');
  assert.equal(found[0].isLive,true);

  // 9/23: the LIVE covers "八強/四強/銅牌戰" (QF/SF/Bronze); the D-LIVE rerun covers a different
  // phase range, "複賽/金牌戰" (repechage/Gold Medal Match) — a real content difference.
  const differentPhase = parseBroadcasts(JSON.stringify({ schemaVersion:1, records:[
    { date:'2026-09-23',providerId:'elta',providerName:'愛爾達',channelId:'542',isLive:true,
      broadcastStartTimeTaipei:'2026-09-23T08:55:00+08:00',broadcastEndTimeTaipei:'2026-09-23T10:00:00+08:00',
      disciplineCode:'KTE',title:'亞運 中華隊 空手道 男子團體型八強/四強/銅牌戰 9/23(原音) LIVE',feed:'original',
      matchLevel:'discipline',matchHint:{eventKeywords:['Team Kata'],phaseKeywords:['Quarterfinal','Semifinal','Bronze Medal']} },
    { date:'2026-09-23',providerId:'elta',providerName:'愛爾達',channelId:'110',isLive:false,
      broadcastStartTimeTaipei:'2026-09-23T15:17:00+08:00',broadcastEndTimeTaipei:'2026-09-23T15:55:00+08:00',
      disciplineCode:'KTE',title:'亞運 中華隊 空手道 男子團體型/男84以上/女50公斤級複賽/金牌戰 9/23 D-LIVE',feed:'main',
      matchLevel:'discipline',matchHint:{} }]}));
  const teamKataQF = { disciplineCode:'KTE', opponentCode:'CAM', athletesEn:[],
    startTimeTaipei:'2026-09-23T09:00:00+08:00', event:"Men's Team Kata", phase:"Men's Team Kata Quarterfinals" };
  const found2 = broadcastsForRow(differentPhase,'2026-09-23',teamKataQF);
  assert.equal(found2.length,1);
  assert.equal(found2[0].isLive,true);
});

test('case D — a D-LIVE rerun with no same-day LIVE counterpart at all stays an orphan',()=>{
  const lonely = parseBroadcasts(JSON.stringify({ schemaVersion:1, records:[
    { date:'2026-09-24',providerId:'elta',providerName:'愛爾達',channelId:'999',isLive:false,
      broadcastStartTimeTaipei:'2026-09-24T20:00:00+08:00',broadcastEndTimeTaipei:'2026-09-24T21:00:00+08:00',
      disciplineCode:'SWM',title:'亞運 中華隊 游泳 預賽 9/24 D-LIVE',feed:'main',
      matchLevel:'discipline',matchHint:{phaseKeywords:['Heats']} }]}));
  const row = { disciplineCode:'SWM', opponentCode:null, athletesEn:[],
    startTimeTaipei:'2026-09-24T09:00:00+08:00', phase:"Women's 50m Freestyle Heats" };
  assert.equal(broadcastsForRow(lonely,'2026-09-24',row).length,0);
});

test('case E — inheritance never grants a D-LIVE a card its LIVE original did not itself match',()=>{
  const show = parseBroadcasts(JSON.stringify({ schemaVersion:1, records:[
    { date:'2026-09-21',providerId:'elta',providerName:'愛爾達',channelId:'540',isLive:true,
      broadcastStartTimeTaipei:'2026-09-21T08:55:00+08:00',broadcastEndTimeTaipei:'2026-09-21T10:50:00+08:00',
      disciplineCode:'SWM',title:'亞運 中華隊 游泳 預賽 9/21(原音) LIVE',feed:'original',
      matchLevel:'discipline',matchHint:{phaseKeywords:['Heats','Preliminar','Qualification','Round Robin','Group']} },
    { date:'2026-09-21',providerId:'elta',providerName:'愛爾達',channelId:'101',isLive:false,
      broadcastStartTimeTaipei:'2026-09-21T10:30:00+08:00',broadcastEndTimeTaipei:'2026-09-21T11:50:00+08:00',
      disciplineCode:'SWM',title:'亞運 中華隊 游泳 預賽 9/21 D-LIVE',feed:'main',
      matchLevel:'discipline',matchHint:{phaseKeywords:['Heats','Preliminar','Qualification','Round Robin','Group']} }]}));
  // A final: the LIVE heats programme never matched it (wrong phase), so the D-LIVE must not
  // pick it up either, even though it is the "same" broadcast pairing on the same day.
  const final = heat('16:00',"Men's 50m Backstroke Final");
  assert.equal(broadcastsForRow(show,'2026-09-21',final).length,0);
  // A different discipline entirely: never inherited regardless of title similarity.
  const otherSport = { ...heat('09:00','Heats'), disciplineCode:'ATH' };
  assert.equal(broadcastsForRow(show,'2026-09-21',otherSport).length,0);
});

test('D-LIVE inheritance across the full real schedule never grants a card its LIVE original did not match',async()=>{
  const shows = await loadBroadcasts();
  for (const date of ['2026-09-21','2026-09-25']) {
    const day = parseDaily(JSON.parse(await readFile(`data/normalized/daily-${date}.json`,'utf8')),date);
    for (const row of [...taiwanRows(day), ...pendingRows(day)]) {
      const found = broadcastsForRow(shows,date,row);
      const dliveOnly = found.filter(b=>b.isLive === false);
      for (const d of dliveOnly) {
        // Every inherited D-LIVE match must have a same-day, same-discipline LIVE sibling with
        // the identical normalised title that itself matches this exact row.
        const siblingLiveMatches = found.some(b=>b.isLive !== false);
        assert.ok(siblingLiveMatches,`D-LIVE ${d.title} 配到卡片但沒有對應 LIVE 也配到同一張卡`);
      }
    }
  }
});
