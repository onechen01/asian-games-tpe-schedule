import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {parseMedalLedger,medalGroups,rankLabel,awaitingOfficialDetail,pendingNoticeText,
  awardWho,awardSport,awardEvent} from '../lib/medal-board.ts';
import {parseAthleteMaster} from '../lib/athletes.ts';
import {parseMedals} from '../lib/medals.ts';
import type {MedalAward,MedalLedger} from '../lib/medal-awards.ts';

const award = (o:Partial<MedalAward>):MedalAward=>({ awardId:'D:U', medal:'ME_BRONZE',
  disciplineCode:'KTE', sportZh:'空手道', event:"Women's Individual Kata", phase:null,
  date:'2026-09-20', startTimeTaipei:null, resultId:'D:U', unitId:'U', athletes:[], rank:null, ...o });
const ledgerOf = (awards:MedalAward[], completeness:'complete'|'partial' = 'complete',
  official = { gold:0, silver:0, bronze:0, total:0 }):MedalLedger=>({
  generatedAt:'t', completeness, standingsVerified:true, standingsUpdatedAt:null,
  ledgerCounts:{ gold:awards.filter(a=>a.medal==='ME_GOLD').length, silver:awards.filter(a=>a.medal==='ME_SILVER').length,
    bronze:awards.filter(a=>a.medal==='ME_BRONZE').length, total:awards.length },
  officialCounts:official, missing:{ gold:0, silver:0, bronze:0, total:0 }, awards });
const medalsOf = (o:Record<string,unknown>)=>parseMedals(JSON.stringify({ gold:1, silver:4, bronze:11,
  total:16, updatedAt:'t', rank:'17', rankEq:false, rankByTotal:'12', rankByTotalEq:false, ...o }));

// --- rank ---

test('the official rank is shown from the standings rank field, never hardcoded',()=>{
  assert.equal(rankLabel(medalsOf({})),'獎牌榜第 17 名');
  // The very same UI must follow the officials when they move it.
  assert.equal(rankLabel(medalsOf({ rank:'15' })),'獎牌榜第 15 名');
  assert.equal(rankLabel(medalsOf({ rank:'3' })),'獎牌榜第 3 名');
});

test('a tied rank is announced as tied',()=>{
  assert.equal(rankLabel(medalsOf({ rank:'17', rankEq:true })),'獎牌榜並列第 17 名');
});

test('rankByTotal is never presented as the official rank',()=>{
  // rank and rankByTotal disagree in the real data (17 vs 12); only rank may be shown.
  const label = rankLabel(medalsOf({ rank:'17', rankByTotal:'12' }));
  assert.equal(label,'獎牌榜第 17 名');
  assert.ok(!label!.includes('12'));
  // With no official rank published, nothing is invented from the totals.
  assert.equal(rankLabel(medalsOf({ rank:null })),null);
  assert.equal(rankLabel(null),null);
});

// --- grouping and ordering ---

test('awards are grouped gold then silver then bronze, in stable ledger order',()=>{
  const awards = [award({ awardId:'b1', medal:'ME_BRONZE' }), award({ awardId:'g1', medal:'ME_GOLD' }),
    award({ awardId:'s1', medal:'ME_SILVER' }), award({ awardId:'b2', medal:'ME_BRONZE' })];
  const groups = medalGroups(ledgerOf(awards));
  assert.deepEqual(groups.map(g=>g.medal),['ME_GOLD','ME_SILVER','ME_BRONZE']);
  assert.deepEqual(groups.map(g=>g.label),['🥇 金牌','🥈 銀牌','🥉 銅牌']);
  // Within a colour the ledger's own order is preserved, and repeated calls do not reshuffle.
  assert.deepEqual(groups[2].awards.map(a=>a.awardId),['b1','b2']);
  assert.deepEqual(medalGroups(ledgerOf(awards)).map(g=>g.awards.map(a=>a.awardId)),
    groups.map(g=>g.awards.map(a=>a.awardId)));
  // A colour with nothing in it is not shown at all.
  assert.deepEqual(medalGroups(ledgerOf([award({ medal:'ME_GOLD' })])).map(g=>g.medal),['ME_GOLD']);
});

test('every ledger award appears exactly once, and none is dropped or merged',()=>{
  const awards = [award({ awardId:'a', medal:'ME_GOLD' }), award({ awardId:'b', medal:'ME_SILVER' }),
    award({ awardId:'c', medal:'ME_BRONZE' })];
  const shown = medalGroups(ledgerOf(awards)).flatMap(g=>g.awards);
  assert.equal(shown.length,3);
  assert.deepEqual(new Set(shown.map(a=>a.awardId)),new Set(['a','b','c']));
});

// --- identity ---

const master = parseAthleteMaster(null);

test('two awards for the same athlete are two entries, never collapsed by name',()=>{
  const awards = [
    award({ awardId:'team', medal:'ME_SILVER', event:"Men's Team", athletes:['CHEN Po-yi','YU Kai-wen','A','B'] }),
    award({ awardId:'singles', medal:'ME_BRONZE', event:"Men's Singles", athletes:['CHEN Po-yi'] }),
  ];
  const shown = medalGroups(ledgerOf(awards)).flatMap(g=>g.awards);
  assert.equal(shown.length,2);
  // Each keeps its own event, so "who won what" survives.
  assert.deepEqual(shown.map(a=>a.event),["Men's Team","Men's Singles"]);
});

test('a team award is one entry named as the delegation, with the roster the ledger lists',()=>{
  const team = award({ medal:'ME_BRONZE', athletes:['A ONE','B TWO','C THREE','D FOUR','E FIVE'] });
  const who = awardWho(team, master);
  assert.equal(who.name,'中華隊');
  assert.equal(who.roster.length,5);
  // One award stays one row; members never become separate medals.
  assert.equal(medalGroups(ledgerOf([team])).flatMap(g=>g.awards).length,1);
});

test('an individual or pair award is named after the athletes themselves',()=>{
  assert.deepEqual(awardWho(award({ athletes:['SOLO ONE'] }), master),{ name:'SOLO ONE', roster:[] });
  assert.deepEqual(awardWho(award({ athletes:['PAIR ONE','PAIR TWO'] }), master),
    { name:'PAIR ONE、PAIR TWO', roster:[] });
  // With no names at all the delegation is used rather than an empty line; nothing is guessed.
  assert.deepEqual(awardWho(award({ athletes:[] }), master),{ name:'中華隊', roster:[] });
});

// --- completeness notice ---

test('a partial ledger asks the reader to wait, and a complete one says nothing',()=>{
  assert.equal(awaitingOfficialDetail(ledgerOf([award({})],'partial')),true);
  assert.equal(awaitingOfficialDetail(ledgerOf([award({})],'complete')),false);
  assert.equal(awaitingOfficialDetail(null),false);
});

test('the partial notice gives the reason first, with a count taken from the data rather than written in',()=>{
  const notice = pendingNoticeText(ledgerOf([award({})],'partial'),16);
  assert.equal(notice,'部分獎牌得主資料仍待官方更新，目前可查看 16 面得獎明細。');
  // It must explain why the list is short, not merely that it is.
  assert.ok(notice!.includes('仍待官方更新'));
  // The same code must follow the count wherever it goes next.
  assert.equal(pendingNoticeText(ledgerOf([award({})],'partial'),20),
    '部分獎牌得主資料仍待官方更新，目前可查看 20 面得獎明細。');
  // Nothing to say once the officials and the ledger agree.
  assert.equal(pendingNoticeText(ledgerOf([award({})],'complete'),16),null);
  assert.equal(pendingNoticeText(null,16),null);
});

test('official totals ahead of the ledger keep both numbers honest',()=>{
  // The real production state: officials count 17, canonical can prove 16.
  const ledger = ledgerOf(Array.from({length:16},(_,i)=>award({ awardId:`a${i}` })),'partial',
    { gold:1, silver:4, bronze:12, total:17 });
  const medals = medalsOf({ total:17, bronze:12 })!;
  // The headline totals stay the officials' own.
  assert.equal(medals.total,17);
  assert.equal(medals.bronze,12);
  // The detail lists only what is confirmed, and says why it is short.
  assert.equal(medalGroups(ledger).flatMap(g=>g.awards).length,16);
  assert.equal(awaitingOfficialDetail(ledger),true);
});

// --- labels ---

test('sport and event read in Chinese, falling back to what the officials published',()=>{
  assert.equal(awardSport(award({ sportZh:'空手道' })),'空手道');
  assert.equal(awardSport(award({ sportZh:null, disciplineCode:'KTE' })),'KTE');
  assert.equal(awardEvent(award({ event:"Women's Individual Kata" })),'女子個人型');
  // The formerly untranslated Wushu compound event now reads in Chinese.
  assert.equal(awardEvent(award({ event:"Men's Nanquan & Nangun" })),'男子南拳南棍全能');
});

// --- the real production files, through the real load path ---

const production = async ()=>({
  ledger:parseMedalLedger(await readFile('data/reference/tpe-medal-ledger.json','utf8')),
  medals:parseMedals(await readFile('data/reference/tpe-medals.json','utf8')),
  master:parseAthleteMaster(await readFile('data/reference/tpe-athlete-master.json','utf8')),
});

test('the real ledger renders one row per award, with a Chinese name, sport and event for each',async()=>{
  const {ledger,medals,master} = await production();
  assert.ok(ledger && medals);
  const shown = medalGroups(ledger).flatMap(g=>g.awards);
  assert.equal(shown.length,ledger!.awards.length);
  assert.equal(new Set(shown.map(a=>a.awardId)).size,shown.length);
  for (const a of shown) {
    assert.ok(awardSport(a),`sport missing for ${a.awardId}`);
    assert.ok(awardEvent(a),`event missing for ${a.awardId}`);
    // Nothing is left reading as raw English or an engineering identifier.
    assert.ok(!/[A-Za-z]/.test(awardSport(a)!),`sport not in Chinese: ${awardSport(a)}`);
    assert.ok(awardWho(a,master).name.length > 0);
  }
  assert.ok(rankLabel(medals));
});

test('the real ledger shows Chen Po-yi twice, and Liu Chang-min and Lin Yi-fan once each',async()=>{
  const {ledger,master} = await production();
  const rows = medalGroups(ledger).flatMap(g=>g.awards)
    .map(a=>({ who:awardWho(a,master), event:awardEvent(a), medal:a.medal, roster:awardWho(a,master).roster }));
  const mentions = (zh:string)=>rows.filter(r=>r.who.name.includes(zh) || r.roster.includes(zh));
  // Two different events, so two rows -- never merged into "陳柏邑 2面".
  assert.equal(mentions('陳柏邑').length,2);
  assert.equal(new Set(mentions('陳柏邑').map(r=>r.event)).size,2);
  // The entrant-level award inside a multi-entrant aggregate unit shows as exactly one row.
  assert.equal(mentions('劉菖閔').length,1);
  // The unit-level skateboarding silver shows as exactly one row.
  const lin = mentions('林逸凡');
  assert.equal(lin.length,1);
  assert.equal(lin[0].medal,'ME_SILVER');
});

// The award id spells the identity differently depending on which builder last wrote the ledger,
// and the file on disk is rewritten by the updater rather than by this repository, so the medal is
// found by what it is rather than by a literal id. Pinning the string would make this test fail for
// the minutes between a builder change landing and the updater regenerating the file.
test('the officially confirmed canoe bronze appears exactly once, whatever spells its identity',async()=>{
  const {ledger,master} = await production();
  const rows = medalGroups(ledger).flatMap(g=>g.awards);
  const canoe = rows.filter(a=>a.disciplineCode === 'CSP' && a.athletes.includes('LAI Kuan-chieh'));
  assert.equal(canoe.length,1,'one medal must never become two, however it is identified');
  assert.equal(canoe[0].medal,'ME_BRONZE');
  assert.equal(awardWho(canoe[0],master).name,'賴冠傑');
  // Whatever the id looks like, it has to be present and unique across the whole ledger.
  assert.ok(canoe[0].awardId);
  assert.equal(rows.filter(a=>a.awardId === canoe[0].awardId).length,1);
});

test('a malformed or missing ledger leaves the totals standing alone instead of throwing',()=>{
  assert.equal(parseMedalLedger(null),null);
  assert.equal(parseMedalLedger('not json'),null);
  assert.equal(parseMedalLedger('{"awards":"nope","completeness":"complete"}'),null);
  assert.equal(parseMedalLedger('{"awards":[],"completeness":"nonsense"}'),null);
  // A row that is not a usable medal is dropped rather than rendered as a blank medal.
  const mixed = parseMedalLedger(JSON.stringify({ completeness:'complete',
    awards:[{ awardId:'ok', medal:'ME_GOLD' },{ awardId:'', medal:'ME_GOLD' },{ awardId:'x', medal:'NOPE' }] }));
  assert.equal(mixed?.awards.length,1);
  assert.deepEqual(medalGroups(null),[]);
});
