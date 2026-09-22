// Chinese Taipei entry list, taken from the official ALL/entries/list index.
//
// An entry proves only that Chinese Taipei registered for an event. It never proves who is in
// a given heat, lane or bout, and it must never override what a unit's own Orgs field says.
// Its one authoritative use is the negative: an event absent from the delegation's entries is
// an event Chinese Taipei is not in.
export type Inscription = { evKey:string; evDesc:string | null };
export type Entry = { reg:string; disciplineCode:string; gender:string | null; name:string;
  inscriptions:Inscription[] };
export type Malformed = { index:number; missing:string[]; reg:string | null;
  name:string | null; disciplineCode:string | null };
export type EntryQuarantine = { nameOnlyMissing:Malformed[]; structuralMalformed:Malformed[] };
export type TpeEntries = { schemaVersion:number; org:string; generatedAt:string;
  athleteCount:number; eventCount:number; entries:Entry[] };

type RawParticipant = { Disc?:unknown; Reg?:unknown; Org?:unknown; Gender?:unknown; Name?:unknown;
  Inscriptions?:{ EvKey?:unknown; EvDesc?:unknown }[] };

export function extractTpeEntries(value:unknown, generatedAt:string,
  report?:(quarantine:EntryQuarantine)=>void):TpeEntries {
  const root = value as { participants?:unknown };
  if (!Array.isArray(root?.participants) || !root.participants.length) {
    throw new Error('Schema change: entries list has no participants array');
  }
  const entries:Entry[] = [];
  // A single broken entry is quarantined, not fatal: the entry list only enriches the official
  // Results data, and one bad row must never stop the day's schedule from updating. A broken
  // row is skipped whole — no field is guessed, and skipping it never means "did not enter".
  const quarantine:EntryQuarantine = { nameOnlyMissing:[], structuralMalformed:[] };
  const text = (value:unknown)=>typeof value === 'string' && value.trim() ? value : null;
  let tpeSeen = 0;
  const participants = root.participants as RawParticipant[];
  for (const [index, raw] of participants.entries()) {
    if (raw?.Org !== 'TPE') continue;
    tpeSeen++;
    const { Disc:disc, Reg:reg, Name:name } = raw;
    const missing = ([['Disc',disc],['Reg',reg],['Name',name]] as const)
      .filter(([,v])=>typeof v !== 'string' || !v.trim()).map(([k])=>k);
    if (missing.length) {
      const bad = { index, reg:text(reg), name:text(name), disciplineCode:text(disc), missing };
      (missing.includes('Disc') || missing.includes('Reg')
        ? quarantine.structuralMalformed : quarantine.nameOnlyMissing).push(bad);
      continue;
    }
    // Only the fields the matching needs; nothing else about the athlete is stored.
    entries.push({ reg:reg as string, disciplineCode:disc as string, name:name as string,
      gender:typeof raw.Gender === 'string' ? raw.Gender : null,
      inscriptions:(raw.Inscriptions ?? []).flatMap(i=>typeof i?.EvKey === 'string'
        ? [{ evKey:i.EvKey, evDesc:typeof i.EvDesc === 'string' ? i.EvDesc : null }] : []) });
  }
  report?.(quarantine);
  if (!entries.length) throw new Error('Schema change: no Chinese Taipei entries found');
  // Wholesale corruption is still fatal: a fifth of the delegation, or more than 20 rows,
  // failing at once is a schema change, not a stray record.
  const structuralCount = quarantine.structuralMalformed.length;
  if (structuralCount > 20 || structuralCount > tpeSeen / 5) {
    throw new Error(`Schema change: ${structuralCount} of ${tpeSeen} Chinese Taipei entries have structural malformed Disc or Reg`);
  }
  const events = new Set(entries.flatMap(e=>e.inscriptions.map(i=>e.disciplineCode + '|' + i.evKey)));
  return { schemaVersion:1, org:'TPE', generatedAt, athleteCount:entries.length,
    eventCount:events.size, entries };
}

export function parseTpeEntries(value:unknown):TpeEntries {
  const doc = value as TpeEntries;
  if (!doc || doc.schemaVersion !== 1 || doc.org !== 'TPE' || !Array.isArray(doc.entries) || !doc.entries.length) {
    throw new Error('中華隊報名檔格式不符');
  }
  return doc;
}

// Which events Chinese Taipei entered, keyed by "<discipline>|<event key>".
export function entryIndex(entries:TpeEntries){
  const index = new Map<string,{ evDesc:string | null; athletes:string[] }>();
  for (const entry of entries.entries) {
    for (const inscription of entry.inscriptions) {
      const key = entry.disciplineCode + '|' + inscription.evKey;
      const item = index.get(key) ?? { evDesc:inscription.evDesc, athletes:[] };
      if (!item.athletes.includes(entry.name)) item.athletes.push(entry.name);
      if (!item.evDesc) item.evDesc = inscription.evDesc;
      index.set(key, item);
    }
  }
  return index;
}
