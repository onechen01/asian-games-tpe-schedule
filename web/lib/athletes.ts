// Chinese Taipei athlete master, keyed by the official Reg id.
// Display only: the canonical data keeps the official English name, and a name without a
// verified Chinese spelling stays in English rather than being guessed.
export type Athlete = { reg:string|null; officialEn:string; zh:string|null;
  disciplines:string[]; confidence:string; aliases:string[]; participationStatus?:string };
export type AthleteMaster = { byEnglish:Map<string,string>; byReg:Map<string,string>;
  byDisciplineEnglish:Map<string,string>; blocked:Set<string> };

const key = (name:string)=>name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .replace(/['’`.]/g,'').replace(/[-\u2010-\u2015_]/g,' ').replace(/\s+/g,' ').trim().toUpperCase();

export function parseAthleteMaster(text:string|null):AthleteMaster {
  const empty = { byEnglish:new Map<string,string>(), byReg:new Map<string,string>(),
    byDisciplineEnglish:new Map<string,string>(), blocked:new Set<string>() };
  if (!text) return empty;
  try {
    const doc = JSON.parse(text) as { schemaVersion?:number; athletes?:Athlete[];
      records?:Athlete[]; review?:Athlete[] };
    if (doc.schemaVersion !== 1 && doc.schemaVersion !== 2) return empty;
    const list = Array.isArray(doc.athletes) ? doc.athletes
      : Array.isArray(doc.records) ? doc.records : null;
    if (!list) return empty;
    const master = { byEnglish:new Map<string,string>(), byReg:new Map<string,string>(),
      byDisciplineEnglish:new Map<string,string>(), blocked:new Set<string>() };
    // A record under review has no safe Chinese identity. Another athlete may share its
    // romanisation (BKB LIN Yu-Ting vs the boxer 林郁婷), so the reviewed row is blocked
    // outright and falls back to the official English name.
    for (const a of (doc.review ?? [])) {
      if (typeof a?.reg === 'string' && a.reg) master.blocked.add('reg:' + a.reg);
      if (typeof a?.officialEn === 'string')
        for (const disc of (a.disciplines ?? [])) master.blocked.add(disc + '|' + key(a.officialEn));
    }
    // Two different people can share one romanisation (LIN Yi-chen: TKW 林翊榛 / GAR 林宜蓁),
    // so an English name that is not unique never decides a Chinese name on its own.
    const ambiguous = new Set<string>();
    const remember = (map:Map<string,string>, k:string, zh:string, drop?:Set<string>)=>{
      const seen = map.get(k);
      if (seen === undefined) map.set(k, zh);
      else if (seen !== zh) { map.delete(k); drop?.add(k); }
    };
    for (const a of list) {
      // Only a confirmed pairing may reach the page; REVIEW records stay English.
      if (a?.confidence !== 'VERIFIED' || typeof a.zh !== 'string' || !a.zh) continue;
      // participationStatus says whether they still compete, not who they are: a withdrawn
      // athlete keeps their verified Chinese name.
      if (typeof a.reg === 'string' && a.reg) master.byReg.set(a.reg, a.zh);
      const names = [a.officialEn, ...(a.aliases ?? [])].filter((n):n is string=>typeof n === 'string' && !!n);
      for (const name of names) {
        if (!ambiguous.has(key(name))) remember(master.byEnglish, key(name), a.zh, ambiguous);
        for (const disc of (a.disciplines ?? [])) remember(master.byDisciplineEnglish, disc + '|' + key(name), a.zh);
      }
    }
    for (const k of ambiguous) master.byEnglish.delete(k);
    return master;
  } catch { return empty; }
}

// Verified Chinese name, else the official English name as published.
// Reg wins; then the discipline-scoped name; a bare English name only when it is unambiguous.
export const athleteLabel = (officialEn:string, master:AthleteMaster,
  opts?:{ reg?:string|null; discipline?:string|null })=>{
  if (opts?.reg && master.blocked.has('reg:' + opts.reg)) return officialEn;
  if (opts?.discipline && master.blocked.has(opts.discipline + '|' + key(officialEn))) return officialEn;
  const byReg = opts?.reg ? master.byReg.get(opts.reg) : undefined;
  if (byReg) return byReg;
  const scoped = opts?.discipline
    ? master.byDisciplineEnglish.get(opts.discipline + '|' + key(officialEn)) : undefined;
  return scoped ?? master.byEnglish.get(key(officialEn)) ?? officialEn;
};
export const athleteLabels = (names:string[], master:AthleteMaster, discipline?:string|null)=>
  names.map(name=>athleteLabel(name, master, { discipline }));
