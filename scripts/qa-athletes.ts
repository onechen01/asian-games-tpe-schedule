// npm run qa:athletes -- 2026-09-21
// Which Chinese Taipei athletes the site would show in English today. Read-only: it never
// changes the master, never transliterates, and never fails the Results pipeline.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT } from '../src/utils/storage.ts';
import { parseAthleteMaster, athleteLabel } from '../web/lib/athletes.ts';

const date = process.argv[2] ?? new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date());
const master = parseAthleteMaster(await readFile(resolve(ROOT,'data/reference/tpe-athlete-master.json'),'utf8'));
const day = JSON.parse(await readFile(resolve(ROOT,`data/normalized/daily-${date}.json`),'utf8')) as
  { rows:{ disciplineCode:string|null; athletesEn?:string[]; enteredAthletes?:string[];
    tpeEntrants?:{ name:string|null; registration:string|null }[] }[] };

const seen = new Map<string,{ name:string; discipline:string|null; reg:string|null }>();
for (const row of day.rows) {
  const regs = new Map((row.tpeEntrants ?? []).map(e=>[e.name ?? '', e.registration ?? null]));
  for (const name of [...(row.athletesEn ?? []), ...(row.enteredAthletes ?? [])]) {
    seen.set(`${row.disciplineCode}|${name}`, { name, discipline:row.disciplineCode, reg:regs.get(name) ?? null });
  }
}
const unresolved = [...seen.values()]
  .filter(a=>athleteLabel(a.name, master, { reg:a.reg, discipline:a.discipline }) === a.name);
console.log(`TPE visible athletes: ${seen.size}`);
console.log(`Chinese resolved: ${seen.size - unresolved.length}`);
console.log(`Unresolved: ${unresolved.length}`);
for (const a of unresolved) console.log(`  ${a.discipline ?? '--'} | ${a.reg ?? 'no reg'} | ${a.name}`);
