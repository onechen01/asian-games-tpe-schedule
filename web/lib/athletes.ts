// Chinese Taipei athlete master, keyed by the official Reg id.
// Display only: the canonical data keeps the official English name, and a name without a
// verified Chinese spelling stays in English rather than being guessed.
export type Athlete = { reg:string|null; officialEn:string; zh:string|null;
  disciplines:string[]; confidence:string; aliases:string[] };
export type AthleteMaster = { byEnglish:Map<string,string>; byReg:Map<string,string> };

const key = (name:string)=>name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .replace(/['’`.]/g,'').replace(/[-\u2010-\u2015_]/g,' ').replace(/\s+/g,' ').trim().toUpperCase();

export function parseAthleteMaster(text:string|null):AthleteMaster {
  const empty = { byEnglish:new Map<string,string>(), byReg:new Map<string,string>() };
  if (!text) return empty;
  try {
    const doc = JSON.parse(text) as { schemaVersion?:number; athletes?:Athlete[] };
    if (doc.schemaVersion !== 1 || !Array.isArray(doc.athletes)) return empty;
    const master = { byEnglish:new Map<string,string>(), byReg:new Map<string,string>() };
    for (const a of doc.athletes) {
      // Only a confirmed pairing may reach the page.
      if (a?.confidence !== 'VERIFIED' || typeof a.zh !== 'string' || !a.zh) continue;
      if (typeof a.officialEn === 'string') master.byEnglish.set(key(a.officialEn), a.zh);
      for (const alias of (a.aliases ?? [])) master.byEnglish.set(key(alias), a.zh);
      if (typeof a.reg === 'string' && a.reg) master.byReg.set(a.reg, a.zh);
    }
    return master;
  } catch { return empty; }
}

// Verified Chinese name, else the official English name as published.
export const athleteLabel = (officialEn:string, master:AthleteMaster)=>
  master.byEnglish.get(key(officialEn)) ?? officialEn;
export const athleteLabels = (names:string[], master:AthleteMaster)=>
  names.map(name=>athleteLabel(name, master));
