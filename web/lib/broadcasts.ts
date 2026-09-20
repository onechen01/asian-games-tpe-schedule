// Broadcast layer: a secondary, display-only source that answers "where and when can I watch".
// It never supplies a competition time, an opponent, a result or a participation state — those
// come from the Results canonical alone. Any number of providers may cover the same event.
export type Broadcast = {
  date:string; providerId:string; providerName:string; broadcastStartTimeTaipei:string;
  disciplineCode:string; title:string|null; feed:'main'|'original'|null; note:string|null;
  // Where to watch: a channel, service or stream name, whatever the provider publishes.
  channelId?:string|null; channelName?:string|null; isLive?:boolean|null;
  sourceUrl:string|null; capturedAt:string|null;
  matchLevel:'unit'|'discipline';
  matchHint?:{ athleteNames?:string[]; opponentCodes?:string[]; opponentNames?:string[];
    phaseKeywords?:string[]; eventKeywords?:string[] };
};
export type Broadcasts = { records:Broadcast[] };

const isRecord = (value:unknown):value is Broadcast => {
  const r = value as Broadcast;
  return !!r && typeof r.date === 'string' && typeof r.providerId === 'string'
    && typeof r.providerName === 'string' && typeof r.broadcastStartTimeTaipei === 'string'
    && Number.isFinite(Date.parse(r.broadcastStartTimeTaipei))
    && typeof r.disciplineCode === 'string'
    && (r.matchLevel === 'unit' || r.matchLevel === 'discipline');
};

export function parseBroadcasts(text:string|null):Broadcasts {
  if (!text) return { records:[] };
  try {
    const doc = JSON.parse(text) as { schemaVersion?:number; records?:unknown[] };
    if (doc.schemaVersion !== 1 || !Array.isArray(doc.records)) return { records:[] };
    return { records:doc.records.filter(isRecord) };
  } catch { return { records:[] }; }
}

const byTime = (a:Broadcast,b:Broadcast)=>
  a.broadcastStartTimeTaipei.localeCompare(b.broadcastStartTimeTaipei)
  || a.providerName.localeCompare(b.providerName);

export const forDate = (all:Broadcasts, date:string)=>
  all.records.filter(r=>r.date === date).sort(byTime);

type MatchRow = { disciplineCode:string|null; opponentCode:string|null;
  athletesEn?:string[]; enteredAthletes?:string[] };
const key = (name:string)=>name.replace(/[^A-Za-z]/g,'').toUpperCase();

// A unit-level record only attaches when the hint identifies this row on its own. Anything
// weaker stays at discipline level rather than being guessed onto a card.
export function broadcastsForRow(all:Broadcasts, date:string, row:MatchRow):Broadcast[] {
  return forDate(all,date).filter(r=>{
    if (r.matchLevel !== 'unit' || r.disciplineCode !== row.disciplineCode) return false;
    const hint = r.matchHint ?? {};
    if (hint.opponentCodes?.length) return !!row.opponentCode && hint.opponentCodes.includes(row.opponentCode);
    if (hint.athleteNames?.length) {
      const names = [...(row.athletesEn ?? []), ...(row.enteredAthletes ?? [])].map(key);
      return hint.athleteNames.some(n=>names.includes(key(n)));
    }
    return false;
  });
}

// Programmes that could not be tied to one unit, grouped per discipline so they are shown once.
export function disciplineBroadcasts(all:Broadcasts, date:string, rows:MatchRow[]):Map<string,Broadcast[]> {
  const attached = new Set(rows.flatMap(row=>broadcastsForRow(all,date,row))
    .map(r=>r.providerId + '|' + r.broadcastStartTimeTaipei + '|' + r.disciplineCode));
  const out = new Map<string,Broadcast[]>();
  for (const r of forDate(all,date)) {
    if (attached.has(r.providerId + '|' + r.broadcastStartTimeTaipei + '|' + r.disciplineCode)) continue;
    out.set(r.disciplineCode, [...(out.get(r.disciplineCode) ?? []), r]);
  }
  return out;
}

export const feedLabel = (feed:Broadcast['feed'])=>feed === 'original' ? '原音' : null;
