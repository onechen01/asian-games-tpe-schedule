// Derived progression: a Chinese Taipei athlete or team is only marked as advanced when the
// official data already lists them in a later stage. Nothing is inferred from a win, a score
// or a rank, and canonical data is never modified.
type TimeNote = { code:'FOLLOWED_BY' | 'NOT_BEFORE' | 'RESCHEDULED' | 'PENDING';
  clockTaipei:string | null; raw:string | null };
export type Row = { date:string; startTimeTaipei:string|null; timeNote?:TimeNote|null; disciplineCode:string|null;
  event:string|null; phase:string|null; athletesEn?:string[]; athletes?:string[] };
// nextTimeNote alone carries the display decision for the next round's time -- no separate
// boolean is kept alongside it, so there is only one thing that can go stale.
export type Advance = { stage:string; nextDate:string; nextTimeTaipei:string|null; nextTimeNote?:TimeNote|null };

// Stages that form a ladder. Anything else (classification, placement, repechage, bronze
// match, an unnamed group game) has no safe ordering and is ignored.
const LADDER:[RegExp,number,string][] = [
  [/qualification|heats?\b|preliminar/i, 0, ''],
  [/round of 64/i, 1, '64強'],
  [/round of 32/i, 2, '32強'],
  [/round of 16/i, 3, '16強'],
  [/quarter-?final/i, 4, '8強'],
  [/semi-?final/i, 5, '4強'],
  [/\bfinals?\b/i, 6, '決賽'],
];
const EXCLUDED = /classification|placement|repechage|bronze|5th|7th|9th|11th|consolation|group|round robin|pool/i;

export function stageOf(phase:string|null|undefined):{ level:number; label:string }|null {
  if (!phase || EXCLUDED.test(phase)) return null;
  for (let i = LADDER.length - 1; i >= 0; i--) {
    if (LADDER[i][0].test(phase)) return { level:LADDER[i][1], label:LADDER[i][2] };
  }
  return null;
}

const key = (name:string)=>name.replace(/[^A-Za-z]/g,'').toUpperCase();
const names = (row:Row)=>(row.athletesEn ?? []).map(key);
const sameEvent = (a:Row,b:Row)=>a.disciplineCode === b.disciplineCode
  && !!a.event && !!b.event && a.event === b.event;

// `later` may span several days: a final is often the next day.
export function advanceFor(row:Row, later:Row[]):Advance|null {
  const here = stageOf(row.phase);
  if (!here) return null;
  const mine = names(row);
  const candidates = later
    .filter(next=>sameEvent(row,next))
    .map(next=>({ next, stage:stageOf(next.phase) }))
    .filter((c):c is {next:Row;stage:{level:number;label:string}}=>!!c.stage && c.stage.level > here.level)
    .filter(({next})=>{
      const theirs = names(next);
      // An individual is matched by their own official name; a team by the event it plays.
      if (mine.length && theirs.length) return mine.some(n=>theirs.includes(n));
      return false;
    })
    .sort((a,b)=>a.stage.level - b.stage.level
      || String(a.next.startTimeTaipei).localeCompare(String(b.next.startTimeTaipei)));
  const hit = candidates[0];
  if (!hit || !hit.stage.label) return null;
  return { stage:hit.stage.label, nextDate:hit.next.date, nextTimeTaipei:hit.next.startTimeTaipei,
    nextTimeNote:hit.next.timeNote ?? null };
}
