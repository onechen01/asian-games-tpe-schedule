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

// Explicit conflict veto — checked before any positive evidence. A shared athlete or opponent
// must never override an explicit mismatch: a broadcast that names one event or one round can
// never stand for a Chinese Taipei row in a different, equally explicit, event or round.
// Recognition fires only on literal keywords on both sides; if either side is not recognised,
// the axis stays neutral rather than guessing a conflict.
type FamilyTable = { family:string; title?:RegExp; row?:RegExp }[];
const EVENT_FAMILIES:FamilyTable = [
  { family:'INDIVIDUAL', title:/個人|个人/, row:/\bIndividual\b/i },
  { family:'TEAM', title:/男團|女團|團體/, row:/\bTeam\b/i },
  { family:'MIXED', title:/混雙|混合雙打/, row:/\bMixed\b/i },
  // Singles/doubles are kept gender-specific: a "女單" broadcast must not be read as covering
  // a men's row just because both are, generically, "singles".
  { family:'WOMENS_SINGLES', title:/女單/, row:/Women's Singles/i },
  { family:'MENS_SINGLES', title:/男單/, row:/Men's Singles/i },
  { family:'WOMENS_DOUBLES', title:/女雙/, row:/Women's Doubles/i },
  { family:'MENS_DOUBLES', title:/男雙/, row:/Men's Doubles/i },
  // Trap ("定向飛靶") and Skeet ("雙向飛靶") are different shooting events, not a phase of one.
  { family:'TRAP', title:/定向飛靶/, row:/\bTrap\b/i },
  { family:'SKEET', title:/雙向飛靶/, row:/\bSkeet\b/i },
];
const PHASE_FAMILIES:FamilyTable = [
  // The "-finals" suffix of "Quarter-finals"/"Semi-finals" would otherwise match \bFinals?\b
  // too (some disciplines write it hyphenated, others solid), so those two are excluded here.
  { family:'FINAL', title:/決賽|金牌戰/, row:/(?<!Quarter-?)(?<!Semi-?)\bFinals?\b|Gold Medal/i },
  // \bGroup\b (not "Groups") avoids matching weightlifting's "All Groups" final-ranking phase.
  { family:'PRELIM', title:/資格賽|預賽/, row:/Qualification|Heats|Preliminar|Round Robin|\bGroup\b/i },
  { family:'PLAYIN', title:/附加賽/, row:/\bPlay-in\b/i },
  { family:'QUARTERFINAL', title:/八強/, row:/\bQuarter-?finals?\b/i },
  { family:'SEMIFINAL', title:/四強|準決賽/, row:/\bSemi-?finals?\b/i },
  { family:'BRONZE', title:/銅牌戰/, row:/Bronze Medal/i },
];
const familiesIn = (text:string|null|undefined, table:FamilyTable, side:'title'|'row')=>{
  const out = new Set<string>();
  if (text) for (const entry of table) if (entry[side]?.test(text)) out.add(entry.family);
  return out;
};
// A broadcast naming a specific athlete, with none of the event markers above, follows the same
// convention the adapter itself uses to tell a personal broadcast from a team match (an explicit
// "VS" opponent): it is that athlete's own individual or paired participation, never an unnamed
// team roster.
const titleEventFamilies = (r:Broadcast)=>{
  const found = familiesIn(r.title,EVENT_FAMILIES,'title');
  if (!found.size && r.matchHint?.athleteNames?.length) found.add('INDIVIDUAL');
  return found;
};
// Two non-empty family sets that share nothing are an explicit mismatch. Either side being
// unrecognised (empty) leaves nothing to compare, so nothing is vetoed.
const explicitConflict = (a:Set<string>, b:Set<string>)=>
  a.size>0 && b.size>0 && ![...a].some(f=>b.has(f));
const hasExplicitConflict = (r:Broadcast, row:MatchRow)=>
  explicitConflict(titleEventFamilies(r), familiesIn(row.event,EVENT_FAMILIES,'row'))
  || explicitConflict(familiesIn(r.title,PHASE_FAMILIES,'title'), familiesIn(row.phase,PHASE_FAMILIES,'row'));

// Strong evidence (a named athlete or opponent) attaches on its own. A session programme may
// cover several units, but only inside the broadcaster's own [start, end) window and only
// when it says which phase it covers — matching times alone is never evidence.
export function broadcastsForRow(all:Broadcasts, date:string, row:MatchRow):Broadcast[] {
  return forDate(all,date).filter(r=>{
    if (r.disciplineCode !== row.disciplineCode) return false;
    if (hasExplicitConflict(r,row)) return false;
    const hint = r.matchHint ?? {};
    if (hint.opponentCodes?.length) return !!row.opponentCode && hint.opponentCodes.includes(row.opponentCode);
    if (hint.athleteNames?.length) {
      const names = [...(row.athletesEn ?? []), ...(row.enteredAthletes ?? [])].map(key);
      return hint.athleteNames.some(n=>names.includes(key(n)));
    }
    // Phase evidence: either the stored hint (manually verified, may use English round names
    // the shared tables don't know, e.g. "Round 2") or the shared PHASE_FAMILIES recognised
    // directly in the title — the same table the veto above already checked for conflicts, so
    // one alias list serves both. Neither is required to know about the other's vocabulary.
    const sharedPhase = familiesIn(r.title,PHASE_FAMILIES,'title');
    const rowPhase = familiesIn(row.phase,PHASE_FAMILIES,'row');
    const phaseMatch = hits(hint.phaseKeywords, row.phase)
      || (sharedPhase.size>0 && rowPhase.size>0 && [...sharedPhase].some(f=>rowPhase.has(f)));
    if (!hint.phaseKeywords?.length && !sharedPhase.size) return false;
    // A delayed broadcast covers a session whose real extent is unknown, so it stays off cards.
    if (r.isLive === false) return false;
    if (!phaseMatch) return false;
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
