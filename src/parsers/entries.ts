// Chinese Taipei entry list, taken from the official ALL/entries/list index.
//
// An entry proves only that Chinese Taipei registered for an event. It never proves who is in
// a given heat, lane or bout, and it must never override what a unit's own Orgs field says.
// Its one authoritative use is the negative: an event absent from the delegation's entries is
// an event Chinese Taipei is not in.
export type Inscription = { evKey:string; evDesc:string | null };
export type Entry = { reg:string; disciplineCode:string; gender:string | null; name:string;
  inscriptions:Inscription[] };
export type TpeEntries = { schemaVersion:number; org:string; generatedAt:string;
  athleteCount:number; eventCount:number; entries:Entry[] };

type RawParticipant = { Disc?:unknown; Reg?:unknown; Org?:unknown; Gender?:unknown; Name?:unknown;
  Inscriptions?:{ EvKey?:unknown; EvDesc?:unknown }[] };

export function extractTpeEntries(value:unknown, generatedAt:string):TpeEntries {
  const root = value as { participants?:unknown };
  if (!Array.isArray(root?.participants) || !root.participants.length) {
    throw new Error('Schema change: entries list has no participants array');
  }
  const entries:Entry[] = [];
  for (const raw of root.participants as RawParticipant[]) {
    if (raw?.Org !== 'TPE') continue;
    const { Disc:disc, Reg:reg, Name:name } = raw;
    if (typeof disc !== 'string' || typeof reg !== 'string' || typeof name !== 'string' || !name.trim()) {
      throw new Error('Schema change: a Chinese Taipei entry is missing Disc, Reg or Name');
    }
    // Only the fields the matching needs; nothing else about the athlete is stored.
    entries.push({ reg, disciplineCode:disc, name,
      gender:typeof raw.Gender === 'string' ? raw.Gender : null,
      inscriptions:(raw.Inscriptions ?? []).flatMap(i=>typeof i?.EvKey === 'string'
        ? [{ evKey:i.EvKey, evDesc:typeof i.EvDesc === 'string' ? i.EvDesc : null }] : []) });
  }
  if (!entries.length) throw new Error('Schema change: no Chinese Taipei entries found');
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
