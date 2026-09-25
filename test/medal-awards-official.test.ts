import test from 'node:test';import assert from 'node:assert/strict';
import { parseOfficialAwards, eventCodeOf, awardIdOf, countAwards, isOfficialMedal }
  from '../src/parsers/medal-awards-official.ts';

// One row of ALL/medals/org/TPE, shaped exactly as the officials publish it.
const row = (o:Record<string,unknown> = {})=>({ Medal:'ME_BRONZE', Reg:'9606559', Type:'A',
  Name:'SHIH Cheng-chung', Disc:'KTE', DiscDesc:'Karate',
  Event:'M.67KG--------------.FNL-', EventDesc:"Men's Kumite -67kg Final", ...o });
const team = (o:Record<string,unknown> = {})=>row({ Medal:'ME_SILVER', Type:'T',
  Reg:'TSTMTEAM-------TPE01', Name:'Chinese Taipei', Disc:'TST',
  Event:'M.TEAM--------------.----', EventDesc:"Men's Team",
  Members:[{Reg:'1',Name:'A'},{Reg:'2',Name:'B'},{Reg:'3',Name:'C'},{Reg:'4',Name:'D'},{Reg:'5',Name:'E'}], ...o });

test('an individual award keeps the athlete registration as its identity',()=>{
  const { awards, problems } = parseOfficialAwards([row()]);
  assert.equal(problems.length,0);
  assert.equal(awards.length,1);
  assert.equal(awards[0].awardId,'KTE|M.67KG--------------|9606559');
  assert.equal(awards[0].medal,'ME_BRONZE');
  assert.equal(awards[0].type,'A');
});

test('a team award is one award carrying its roster, never one per member',()=>{
  const { awards } = parseOfficialAwards([team()]);
  assert.equal(awards.length,1,'five members must not become five medals');
  assert.equal(awards[0].members.length,5);
  assert.equal(awards[0].awardId,'TST|M.TEAM--------------|TSTMTEAM-------TPE01');
  assert.equal(countAwards(awards).total,1);
});

test('a doubles award (Type=D) is also a single award',()=>{
  const { awards } = parseOfficialAwards([team({ Type:'D', Reg:'TSTXDOUBLES----TPE01',
    Name:'YU Kai-wen / HUANG Shih-yuan', Event:'X.DOUBLES-----------.----',
    Members:[{Reg:'a',Name:'YU Kai-wen'},{Reg:'b',Name:'HUANG Shih-yuan'}] })]);
  assert.equal(awards.length,1);
  assert.equal(awards[0].type,'D');
  assert.equal(awards[0].members.length,2);
});

test('the identity ignores the phase segment the two endpoints spell differently',()=>{
  // The official list calls this final; the Results unit that decided it is the repechage.
  assert.equal(eventCodeOf('M.67KG--------------.FNL-'),'M.67KG--------------');
  assert.equal(eventCodeOf('M.67KG--------------.REPF.000100--'),'M.67KG--------------');
  assert.equal(eventCodeOf('M.200MBF------------.----'),eventCodeOf('M.200MBF------------.FNL-.000100--'));
  assert.equal(eventCodeOf('M.TEAM--------------.SFNL.00010000'),'M.TEAM--------------');
  assert.equal(eventCodeOf(''),null);
  // So the same medal keeps one identity whichever phase either side names.
  assert.equal(awardIdOf('KTE','M.67KG--------------','9606559'),'KTE|M.67KG--------------|9606559');
});

test('identities are unique across a realistic mixed payload',()=>{
  const { awards, problems } = parseOfficialAwards([
    row(), team(),
    row({ Medal:'ME_GOLD', Reg:'399162', Name:'WANG Kuan-hung', Disc:'SWM', Event:'M.200MBF------------.----' }),
    row({ Medal:'ME_SILVER', Reg:'2585854', Name:'KU Yong-yan', Disc:'SKB', Event:'M.PARK--------------.----' }),
    row({ Medal:'ME_SILVER', Reg:'8000441', Name:'LIN Yi-fan', Disc:'SKB', Event:'W.PARK--------------.----' }),
  ]);
  assert.equal(problems.length,0);
  assert.equal(new Set(awards.map(a=>a.awardId)).size,awards.length);
  // Men's and women's Park are different events despite sharing a discipline.
  assert.notEqual(awards[3].awardId,awards[4].awardId);
  assert.deepEqual(countAwards(awards),{ gold:1, silver:3, bronze:1, total:5 });
});

test('two rows sharing an identity are reported rather than quietly collapsed',()=>{
  const { awards, problems } = parseOfficialAwards([row(), row()]);
  assert.equal(awards.length,1);
  assert.equal(problems.length,1);
  assert.equal(problems[0].code,'duplicate_identity');
});

test('one identity claiming two colours is a conflict, and neither is chosen quietly',()=>{
  const { awards, problems } = parseOfficialAwards([row(), row({ Medal:'ME_GOLD' })]);
  assert.equal(awards.length,1);
  assert.equal(problems.length,1);
  assert.equal(problems[0].code,'medal_conflict');
  assert.ok(problems[0].detail.includes('ME_BRONZE'));
  assert.ok(problems[0].detail.includes('ME_GOLD'));
});

test('a row with no usable medal, discipline or event is reported, never guessed at',()=>{
  const { awards, problems } = parseOfficialAwards([
    row(),
    row({ Medal:'' }),          // no medal code
    row({ Medal:'ME_WOOD' }),   // not a medal we recognise
    row({ Disc:null }),
    row({ Event:null }),
    { nothing:'useful' },
  ]);
  assert.equal(awards.length,1);
  assert.equal(problems.length,5);
  assert.ok(problems.every(p=>p.code === 'malformed_row'));
  // A placing is never a medal: only the explicit medal code counts.
  assert.equal(isOfficialMedal('ME_GOLD'),true);
  assert.equal(isOfficialMedal('1'),false);
  assert.equal(isOfficialMedal('Rk1'),false);
});

test('a payload that is an object keyed by index parses the same as an array',()=>{
  const { awards } = parseOfficialAwards({ '0':row(), '1':team() });
  assert.equal(awards.length,2);
  assert.deepEqual(parseOfficialAwards(null).awards,[]);
  assert.deepEqual(parseOfficialAwards('nonsense').awards,[]);
});

// The migration case: the officials had already published this gold in their medal list while the
// Results unit for the same race still carried an empty Medal on every competitor. Under the old
// rule it was invisible; the award must now come from the official list alone.
test('a gold the official list publishes is an award even with no Results medal evidence at all',()=>{
  const { awards, problems } = parseOfficialAwards([
    row({ Medal:'ME_GOLD', Reg:'399162', Type:'A', Name:'WANG Kuan-hung', Disc:'SWM',
      DiscDesc:'Swimming', Event:'M.200MBF------------.----', EventDesc:"Men's 200m Butterfly" }),
  ]);
  assert.equal(problems.length,0);
  assert.equal(awards.length,1);
  assert.equal(awards[0].medal,'ME_GOLD');
  assert.equal(awards[0].name,'WANG Kuan-hung');
  assert.equal(awards[0].awardId,'SWM|M.200MBF------------|399162');
});

test('the same medal reported by both sources still yields exactly one award',()=>{
  // The official row is the only source of awards, so Results agreeing adds nothing to count.
  const { awards } = parseOfficialAwards([row()]);
  assert.equal(awards.length,1);
  assert.equal(countAwards(awards).bronze,1);
});
