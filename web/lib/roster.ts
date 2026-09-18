// Chinese-name reference layer.
//
// Hard rule: this file never decides who competes. Participation comes from the Results API
// and the committee's daily sheet. The squad list only supplies a Chinese spelling for an
// athlete the daily data already says is competing, and it may be out of date.
export type RosterDiscipline = { disciplineCode:string; sportZh:string; athletesZh:string[];
  verifiedNames?:{ en:string; zh:string }[] };
export type Roster = { schemaVersion:number;
  metadata:{ referenceOnly:boolean; notForParticipation:boolean; rosterMayBeOutdated:boolean };
  disciplines:RosterDiscipline[]; unmapped?:{ section:string; reason:string }[] };
export type NameMatch = { status:'MATCHED_HIGH' | 'AMBIGUOUS' | 'NO_MATCH'; zh:string | null; en:string };

// "CHEN Yu-hsun", "CHEN YU-HSUN" and "Chen  Yu Hsun" all normalise to the same key.
export function normalizeName(value:string){
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[''`.]/g,'').replace(/[-\u2010-\u2015_]/g,' ')
    .replace(/\s+/g,' ').trim().toUpperCase();
}

export function parseRoster(value:unknown):Roster{
  const r = value as Roster;
  if (!r || r.schemaVersion !== 1 || !Array.isArray(r.disciplines)) throw new Error('名單參考檔格式不符');
  if (!r.metadata?.referenceOnly || !r.metadata?.notForParticipation) {
    throw new Error('名單參考檔必須標示 referenceOnly 與 notForParticipation');
  }
  return r;
}

// Lookup is restricted to one discipline's own squad: never the whole delegation, because
// identical romanisations across 470 athletes would produce false matches.
export function matchAthleteName(en:string, disciplineCode:string | null, roster:Roster):NameMatch {
  const key = normalizeName(en ?? '');
  if (!key || !disciplineCode) return { status:'NO_MATCH', zh:null, en };
  const discipline = roster.disciplines.find(d=>d.disciplineCode === disciplineCode);
  if (!discipline) return { status:'NO_MATCH', zh:null, en };
  // Only pairs a human confirmed are usable; nothing is derived from the Chinese characters.
  const hits = (discipline.verifiedNames ?? []).filter(p=>normalizeName(p.en) === key);
  const distinct = [...new Set(hits.map(p=>p.zh))];
  if (distinct.length === 1) {
    // A pair whose Chinese name is not in this squad list is treated as unusable.
    if (!discipline.athletesZh.includes(distinct[0])) return { status:'NO_MATCH', zh:null, en };
    return { status:'MATCHED_HIGH', zh:distinct[0], en };
  }
  if (distinct.length > 1) return { status:'AMBIGUOUS', zh:null, en };
  return { status:'NO_MATCH', zh:null, en };
}

// Used only when the daily data gave no Chinese names at all. The English list is the source
// of truth for who is on court: order and count are preserved, unmatched entries drop out,
// and an empty result means the caller keeps showing what it showed before.
export function chineseNamesFor(athletesEn:string[], disciplineCode:string | null, roster:Roster){
  const matches = athletesEn.map(en=>matchAthleteName(en, disciplineCode, roster));
  return { names:matches.filter(m=>m.status === 'MATCHED_HIGH').map(m=>m.zh as string),
    complete:matches.length > 0 && matches.every(m=>m.status === 'MATCHED_HIGH'),
    matches };
}
