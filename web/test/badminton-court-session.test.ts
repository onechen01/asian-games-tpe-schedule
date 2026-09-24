import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseDaily as parseSchedule,buildCourtSessionChains} from '../../src/parsers/schedule.ts';
import {mergeDaily} from '../../src/parsers/merge-daily.ts';
import {parseBroadcasts,broadcastsForRow} from '../lib/broadcasts.ts';

const rawPath='data/raw/2026-09-24T16-27-58-773Z-09c0548f9ed8-0121403f.json';
const targetIds=[
  'X.DOUBLES-----------.R32-.000400--','X.DOUBLES-----------.R32-.001200--',
  'W.SINGLES-----------.R64-.001600--','M.SINGLES-----------.R64-.001200--',
  'W.DOUBLES-----------.R32-.000400--','M.DOUBLES-----------.R32-.000900--',
  'W.DOUBLES-----------.R32-.001300--','M.DOUBLES-----------.R32-.000300--',
];

async function real925(){
  const raw=JSON.parse(await readFile(rawPath,'utf8'));
  const built=buildCourtSessionChains(parseSchedule(raw,{url:'fixture'}));
  // mergeDaily is the TPE filter. The chains already exist on the complete 57-unit response.
  const merged=mergeDaily({date:'2026-09-25',rows:built.rows,sessionChains:built.chains,
    coverage:{fetchComplete:true,missing:[]},errors:[]},null,null);
  const rows=merged.rows.filter(r=>r.disciplineCode==='BDM'&&r.participationState==='TPE_CONFIRMED');
  const broadcasts=parseBroadcasts(await readFile('data/reference/broadcasts.json','utf8'));
  const matchRow=(r:typeof rows[number])=>({
    disciplineCode:r.disciplineCode, opponentCode:null,
    athletesEn:r.athletesEn, startTimeTaipei:r.startTimeTaipei, phase:r.phase, event:r.event,
    locationCode:r.locationCode, locationName:r.locationName,
    courtSessionChainId:r.courtSessionChainId,
  });
  const idOf=(r:typeof rows[number])=>r.sources.results?.unitId as string;
  return {built,merged,rows,broadcasts,matchRow,idOf};
}

test('real 9/25 BDM court sessions attach seven TPE units and leave Court 3 unattached',async()=>{
  const {built,merged,rows,broadcasts,matchRow,idOf}=await real925();
  assert.equal(rows.length,8);
  assert.equal(merged.sessionChains.length,built.chains.length);
  const found=new Map(rows.map(r=>[idOf(r),broadcastsForRow(broadcasts,'2026-09-25',matchRow(r),merged.sessionChains)]));
  for(const id of targetIds) assert.equal(found.get(id)?.length,id==='W.DOUBLES-----------.R32-.000400--'?0:1,id);

  const attached=(channel:string,start:string)=>rows.filter(r=>found.get(idOf(r))?.some(b=>
    b.channelName===channel&&b.broadcastStartTimeTaipei===start)).map(idOf).sort();
  assert.deepEqual(attached('愛爾達體育MAX4台','2026-09-25T08:25:00+08:00'),[
    'M.SINGLES-----------.R64-.001200--','W.SINGLES-----------.R64-.001600--',
    'X.DOUBLES-----------.R32-.000400--',
  ]);
  assert.deepEqual(attached('愛爾達體育MAX5台','2026-09-25T14:55:00+08:00'),[
    'M.DOUBLES-----------.R32-.000900--','W.DOUBLES-----------.R32-.001300--',
  ]);
});

test('court chains are built from non-TPE anchors and retain safe predecessor evidence',async()=>{
  const {built,rows,idOf}=await real925();
  const lower=built.chains.filter(c=>['001','002'].includes(c.locationCode)&&c.anchorTimeKind==='LOWER_BOUND');
  assert.equal(lower.length,2);
  assert.ok(lower.every(c=>c.anchorTimeTaipei==='2026-09-25T15:00:00+08:00'));
  assert.ok(lower.every(c=>built.rows.find(r=>r.unitId===c.anchorUnitId)?.hasTpe===false));
  assert.ok(rows.every(r=>r.courtPredecessorUnitId));
  assert.ok(rows.every(r=>built.chains.find(c=>c.id===r.courtSessionChainId)?.units
    .find(u=>u.unitId===idOf(r))?.timeKind==='NONE'));
  assert.equal(rows.find(r=>idOf(r)==='X.DOUBLES-----------.R32-.000400--')?.courtPredecessorUnitId,
    'X.DOUBLES-----------.R32-.000600--');
});

test('FOLLOWED_BY placeholders and upper/lower labels are not matcher time or identity evidence',async()=>{
  const {built,rows,broadcasts,matchRow,idOf}=await real925();
  const row=rows.find(r=>idOf(r)==='X.DOUBLES-----------.R32-.000400--')!;
  const altered={...matchRow(row),startTimeTaipei:'2026-09-25T23:59:00+08:00'};
  const shows={records:broadcasts.records.map(b=>b.disciplineCode==='BDM'&&b.channelId==='543'
    && b.broadcastStartTimeTaipei.endsWith('08:25:00+08:00')
    ? {...b,matchHint:{...b.matchHint,courtSession:{...b.matchHint?.courtSession!,sourceSessionLabel:'diagnostic-only'}}}:b)};
  assert.equal(broadcastsForRow(shows,'2026-09-25',altered,built.chains).length,1);
});

test('ambiguous or unsupported court chains fail closed',async()=>{
  const {built,rows,broadcasts,matchRow,idOf}=await real925();
  const row=rows.find(r=>idOf(r)==='X.DOUBLES-----------.R32-.000400--')!;
  const original=built.chains.find(c=>c.id===row.courtSessionChainId)!;
  const ambiguous={...original,id:original.id+'-duplicate',anchorUnitId:original.anchorUnitId+'-duplicate'};
  assert.equal(broadcastsForRow(broadcasts,'2026-09-25',matchRow(row),[...built.chains,ambiguous]).length,0);
  const unknown={...original,id:original.id+'-pending',anchorUnitId:original.anchorUnitId+'-pending',
    anchorTimeKind:'NONE' as const,anchorTimeTaipei:null};
  assert.equal(broadcastsForRow(broadcasts,'2026-09-25',matchRow(row),[...built.chains,unknown]).length,0,
    'a same-court/round PENDING chain makes selection ambiguous');

  const lowerRow=rows.find(r=>idOf(r)==='M.DOUBLES-----------.R32-.000900--')!;
  const lowerBroadcast={records:broadcasts.records.map(b=>b.disciplineCode==='BDM'&&b.channelId==='544'
    && b.broadcastStartTimeTaipei.endsWith('14:55:00+08:00')
    ? {...b,broadcastStartTimeTaipei:'2026-09-25T15:10:00+08:00'}:b)};
  assert.equal(broadcastsForRow(lowerBroadcast,'2026-09-25',matchRow(lowerRow),built.chains).length,0,
    'NOT_BEFORE is a lower bound: a programme beginning after it cannot claim the chain');
  const pending=built.chains.map(c=>c.id===lowerRow.courtSessionChainId
    ? {...c,anchorTimeKind:'NONE' as const,anchorTimeTaipei:null}:c);
  assert.equal(broadcastsForRow(broadcasts,'2026-09-25',matchRow(lowerRow),pending).length,0);
});

test('RESCHEDULED chain anchors use the new official clock',()=>{
  const raw=[
    {Key:'anchor',Disc:'BDM',Loc:'001',LocDesc:'Court 1',DateTimeRaw:'2026-09-25T13:00:00+09:00',
      HideStartDate:true,Estimated:true,EstText:'New Start Time 16:00'},
    {Key:'next',Disc:'BDM',Loc:'001',LocDesc:'Court 1',DateTimeRaw:'2026-09-25T13:40:00+09:00',
      HideStartDate:true,Estimated:true,EstText:'Followed by'},
  ];
  const built=buildCourtSessionChains(parseSchedule(raw,{url:'fixture'}));
  assert.equal(built.chains[0].anchorTimeKind,'EXACT');
  assert.equal(built.chains[0].anchorTimeTaipei,'2026-09-25T15:00:00+08:00');
  assert.equal(built.chains[0].units[1].timeTaipei,null);
});
