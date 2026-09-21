// Broadcast layer: a secondary, display-only source that answers "where and when can I watch".
// It never supplies a competition time, an opponent, a result or a participation state — those
// come from the Results canonical alone. Any number of providers may cover the same event.
export type Broadcast = {
  date:string; providerId:string; providerName:string; broadcastStartTimeTaipei:string;
  broadcastEndTimeTaipei?:string|null;
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
  athletesEn?:string[]; enteredAthletes?:string[];
  startTimeTaipei?:string|null; phase?:string|null; event?:string|null;
  // An entered row's time is the event window's start, not a Taiwan start time.
  participationState?:string|null; entryLevel?:string|null };
const key = (name:string)=>name.replace(/[^A-Za-z]/g,'').toUpperCase();

// The official window a programme covers. It is used to limit a session programme, never to
// reject an athlete or opponent match: a delayed competition is still that competition.
const insideWindow = (r:Broadcast, row:MatchRow)=>{
  if (!r.broadcastEndTimeTaipei || !row.startTimeTaipei) return false;
  const start = Date.parse(r.broadcastStartTimeTaipei), end = Date.parse(r.broadcastEndTimeTaipei);
  const competition = Date.parse(row.startTimeTaipei);
  if (![start,end,competition].every(Number.isFinite) || end <= start) return false;
  return competition >= start && competition < end;
};
export const isProvisional = (row:MatchRow)=>
  row.participationState === 'TPE_ENTERED' || row.entryLevel === 'event';
const hits = (keywords:string[]|undefined, text:string|null|undefined)=>
  !!keywords?.length && !!text && keywords.some(k=>text.toLowerCase().includes(k.toLowerCase()));

// Strong evidence (a named athlete or opponent) attaches on its own. A session programme may
// cover several units, but only inside the broadcaster's own [start, end) window and only
// when it says which phase it covers — matching times alone is never evidence.
export function broadcastsForRow(all:Broadcasts, date:string, row:MatchRow):Broadcast[] {
  return forDate(all,date).filter(r=>{
    if (r.disciplineCode !== row.disciplineCode) return false;
    const hint = r.matchHint ?? {};
    if (hint.opponentCodes?.length) return !!row.opponentCode && hint.opponentCodes.includes(row.opponentCode);
    if (hint.athleteNames?.length) {
      const names = [...(row.athletesEn ?? []), ...(row.enteredAthletes ?? [])].map(key);
      return hint.athleteNames.some(n=>names.includes(key(n)));
    }
    if (!hint.phaseKeywords?.length) return false;
    // A delayed broadcast covers a session whose real extent is unknown, so it stays off cards.
    if (r.isLive === false) return false;
    if (!hits(hint.phaseKeywords, row.phase)) return false;
    if (hint.eventKeywords?.length && !hits(hint.eventKeywords, row.event)) return false;
    // An event-level row has no Taiwan start time to compare with, so the window cannot be
    // used against it; the sport, the day and the phase still have to agree.
    if (isProvisional(row)) return true;
    return insideWindow(r, row);
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
