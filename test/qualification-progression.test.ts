import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDaily, qualificationPredecessors } from '../src/parsers/schedule.ts';
import { confirmFromQualifiedCompetitors, officialQualifiedCompetitors } from '../src/parsers/results.ts';
import { mergeDaily } from '../src/parsers/merge-daily.ts';
import { broadcastsForRow, parseBroadcasts } from '../web/lib/broadcasts.ts';

test('real-shaped 9/27 dressage progression uses official Q evidence and reaches the broadcast matcher',()=>{
  const event='O.DRESINDV----------';
  const qualifierId=`${event}.2Q--.000100--`;
  const finalId=`${event}.FNL-.000100--`;
  const qualifier={Key:qualifierId,ResCode:qualifierId,Disc:'EQU',Event:event,
    EventDesc:'Dressage Individual',Phase:`${event}.2Q--`,PhaseDesc:'Dressage 2nd Individual Qualifier',
    UnitDesc:'Dressage Individual 2nd Individual Qualifier',DateTimeRaw:'2026-09-26T09:30:00+09:00',
    Status:'OFFICIAL',Orgs:['TPE','JPN']};
  const final={Key:finalId,ResCode:finalId,Disc:'EQU',Event:event,EventDesc:'Dressage Individual',
    Phase:`${event}.FNL-`,PhaseDesc:'Dressage Individual Final',
    UnitDesc:'Dressage Individual Individual Final',DateTimeRaw:'2026-09-27T09:30:00+09:00',
    Status:'SCHEDULED',Orgs:[]};
  const [row]=parseDaily([final],{url:'official-daily',raw_file:'daily.json'},
    {requestedDate:'2026-09-27'});
  const [previous]=qualificationPredecessors([qualifier,final],'EQU',event,finalId)
    .filter(item=>item.hasTpe===true);
  const previousResults={Info:{Key:qualifierId,Status:'OFFICIAL'},Competitors:[
    {Org:'TPE',Name:'YEH Hsiu-hua',Reg:'10513535',Rk:'7',Result:'137.148',Qualified:'Q'},
    {Org:'TPE',Name:'CHEN Yi-ju',Reg:'2724373',Rk:'32',Result:'126.412',Qualified:''},
  ]};
  const qualifiers=officialQualifiedCompetitors(previousResults,previous,qualifierId);
  assert.equal(confirmFromQualifiedCompetitors(row,qualifiers),true);
  row.qualificationSource={kind:'previous-results-qualified',previousUnitIds:[qualifierId],
    urls:[`https://example.invalid/EQU/results/${qualifierId}`],rawFiles:['qualifier.json']};

  const report=mergeDaily({date:'2026-09-27',rows:[row],coverage:{fetchComplete:true,missing:[]},errors:[]},null,null);
  assert.equal(report.rows.length,1);
  const card=report.rows[0];
  assert.equal(card.participationState,'TPE_CONFIRMED');
  assert.equal(card.startTimeTaipei,'2026-09-27T08:30:00+08:00');
  assert.deepEqual(card.athletesEn,['YEH Hsiu-hua']);
  assert.equal(card.tpeRank,null,'the qualifier rank must not be shown as the final rank');
  assert.equal(card.sources.results?.qualification?.previousUnitIds[0],qualifierId);

  const shows=parseBroadcasts(JSON.stringify({schemaVersion:1,records:[{
    date:'2026-09-27',providerId:'elta',providerName:'愛爾達',isLive:true,
    broadcastStartTimeTaipei:'2026-09-27T08:25:00+08:00',
    broadcastEndTimeTaipei:'2026-09-27T11:55:00+08:00',disciplineCode:'EQU',
    title:'亞運 中華隊 馬術 馬場馬術個人賽決賽 9/27(原音) LIVE',feed:'original',
    matchLevel:'discipline',matchHint:{phaseKeywords:['Final']},
  }]}));
  assert.equal(broadcastsForRow(shows,'2026-09-27',card).length,1);
});
