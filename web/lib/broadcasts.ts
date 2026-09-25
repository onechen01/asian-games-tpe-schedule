// Broadcast layer: a secondary, display-only source that answers "where and when can I watch".
// It never supplies a competition time, an opponent, a result or a participation state — those
// come from the Results canonical alone. Any number of providers may cover the same event.
import type {CourtSessionChain} from './schedule.ts';

export type Broadcast = {
  date:string; providerId:string; providerName:string; broadcastStartTimeTaipei:string;
  broadcastEndTimeTaipei?:string|null;
  disciplineCode:string; title:string|null; feed:'main'|'original'|null; note:string|null;
  // Where to watch: a channel, service or stream name, whatever the provider publishes.
  channelId?:string|null; channelName?:string|null; isLive?:boolean|null;
  sourceUrl:string|null; capturedAt:string|null;
  matchLevel:'unit'|'discipline';
  matchHint?:{ athleteNames?:string[]; opponentCodes?:string[]; opponentNames?:string[];
    phaseKeywords?:string[]; eventKeywords?:string[];
    courtSession?:{locationLabel:string;roundKeyword:string;sourceSessionLabel:string} };
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
  startTimeTaipei?:string|null; phase?:string|null; event?:string|null; unit?:string|null;
  locationCode?:string|null; locationName?:string|null; courtSessionChainId?:string|null;
  // Present when the official unit response gave one or more Chinese Taipei entrants their own
  // clock time (e.g. an equestrian rider's turn within one long qualifying session) — a row's
  // own startTimeTaipei is otherwise the unit's, which for a sequential-entry session can be a
  // different competitor's slot entirely. See hasWindowEvidence below.
  tpeEntrants?:{ registration?:string|null; startTimeTaipei?:string|null }[];
  // An entered row's time is the event window's start, not a Taiwan start time.
  participationState?:string|null; entryLevel?:string|null };
const key = (name:string)=>name.replace(/[^A-Za-z]/g,'').toUpperCase();

// The official window a programme covers. It is used to limit a session programme, never to
// reject an athlete or opponent match: a delayed competition is still that competition.
const timeIsInsideWindow = (r:Broadcast, timeTaipei:string|null|undefined)=>{
  if (!r.broadcastEndTimeTaipei || !timeTaipei) return false;
  const start = Date.parse(r.broadcastStartTimeTaipei), end = Date.parse(r.broadcastEndTimeTaipei);
  const competition = Date.parse(timeTaipei);
  if (![start,end,competition].every(Number.isFinite) || end <= start) return false;
  return competition >= start && competition < end;
};
const insideWindow = (r:Broadcast, row:MatchRow)=>timeIsInsideWindow(r, row.startTimeTaipei);
// A Chinese Taipei entrant's own official start time is strictly more precise than the unit's —
// when at least one exists, it alone decides the time axis, never falling back to the coarser
// unit time just because every precise time happens to land outside the window (that would
// silently discard the more trustworthy evidence). Only a unit with no such per-entrant time at
// all keeps the previous, unit-level behaviour untouched.
const hasWindowEvidence = (r:Broadcast, row:MatchRow)=>{
  const withTime = (row.tpeEntrants ?? []).filter(e=>typeof e.startTimeTaipei === 'string');
  if (withTime.length) return withTime.some(e=>timeIsInsideWindow(r, e.startTimeTaipei));
  return insideWindow(r, row);
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
  // \bQualif (not the full word "Qualification") also reaches "Qualifier"/"Qualifying"/
  // "Qualifications" — official phase names use all four for the same qualifying stage (e.g.
  // shooting's "...Qualification" vs equestrian's "...Qualifier"). The \b keeps it from firing
  // inside an unrelated word like "Disqualified", which never appears as a phase name anyway.
  { family:'PRELIM', title:/資格賽|預賽/, row:/\bQualif|Heats|Preliminar|Round Robin|\bGroup\b/i },
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
// Some team sports use a broad row phase such as "Women Finals" for the entire medal stage,
// while the canonical unit names the actual game (for example, "Bronze Medal Game"). That
// unit-level medal evidence is more specific than the umbrella phase. Keep genuinely different
// rounds (quarterfinal/semifinal) on the ordinary phase path; this is not an opponent-based
// bypass and does not weaken their conflict veto.
const rowPhaseFamilies = (row:MatchRow)=>{
  const unitFamilies=familiesIn(row.unit,PHASE_FAMILIES,'row');
  if (unitFamilies.has('BRONZE')) return new Set(['BRONZE']);
  return familiesIn(row.phase,PHASE_FAMILIES,'row');
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
  || explicitConflict(familiesIn(r.title,PHASE_FAMILIES,'title'), rowPhaseFamilies(row));

const sameLabel = (a:string,b:string)=>a.trim().toLowerCase() === b.trim().toLowerCase();
const anchorInsideWindow = (r:Broadcast,chain:CourtSessionChain)=>{
  if (!r.broadcastEndTimeTaipei || !chain.anchorTimeTaipei || chain.anchorTimeKind === 'NONE') return false;
  const start=Date.parse(r.broadcastStartTimeTaipei),end=Date.parse(r.broadcastEndTimeTaipei);
  const anchor=Date.parse(chain.anchorTimeTaipei);
  if (![start,end,anchor].every(Number.isFinite) || end<=start) return false;
  // A lower bound is not an actual start. Requiring the programme to span that bound proves
  // only that it covers the possible beginning of the chain; it is never compared to a unit's
  // FOLLOWED_BY placeholder.
  return start<=anchor && anchor<end;
};
function matchesBdmCourtSession(r:Broadcast,row:MatchRow,chains:CourtSessionChain[]):boolean|null {
  const hint=r.matchHint?.courtSession;
  if (!hint) return null;
  if (r.disciplineCode!=='BDM' || row.disciplineCode!=='BDM' || !row.locationCode
    || !row.courtSessionChainId || !hits([hint.roundKeyword],row.phase)) return false;
  // LocDesc is only a resolver for the broadcaster's literal Court label. A unique official
  // Loc is required and becomes the identity used below.
  const codes=[...new Set(chains.filter(c=>c.disciplineCode==='BDM'
    && sameLabel(c.locationName,hint.locationLabel)).map(c=>c.locationCode))];
  if (codes.length!==1 || row.locationCode!==codes[0]) return false;
  const relevant=chains.filter(c=>c.disciplineCode==='BDM' && c.locationCode===codes[0]
    && c.units.some(unit=>hits([hint.roundKeyword],unit.unitName)));
  // An unclocked chain of the same court and round could be the programme's session. It cannot
  // be ruled out by the window, so selecting a clocked neighbour would be a guess.
  if (relevant.some(c=>c.anchorTimeKind==='NONE')) return false;
  const candidates=relevant.filter(c=>anchorInsideWindow(r,c));
  // Upper/lower is deliberately not consulted. If court + official anchor evidence + window
  // cannot select exactly one chain, the broadcast stays unattached.
  return candidates.length===1 && candidates[0].id===row.courtSessionChainId;
}

// Strong evidence (a named athlete or opponent) attaches on its own, live or delayed. A session
// programme (phase evidence only) additionally requires the broadcast to be live — matching
// times alone is never evidence, and a session's real extent is unknown once it is delayed.
function matchesDirectly(r:Broadcast, row:MatchRow, chains:CourtSessionChain[]):boolean {
  if (r.disciplineCode !== row.disciplineCode) return false;
  const courtSession=matchesBdmCourtSession(r,row,chains);
  if (courtSession!==null) return courtSession;
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
  const rowPhase = rowPhaseFamilies(row);
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
  return hasWindowEvidence(r, row);
}

// A D-LIVE rerun with no evidence of its own — the exact situation the phase branch above
// blocks with `isLive === false` — can still inherit whatever cards its LIVE original already
// safely matched, but only when the two titles are identical once pure playback noise (LIVE,
// D-LIVE, 原音, 續看) is stripped. Nothing substantive (event, phase, athlete, opponent) is ever
// removed to force two different programmes to look alike, so a rerun credited to a different
// athlete or covering a different round is left exactly as unmatched as it was before.
const stripPlaybackMarkers = (title:string|null|undefined)=>(title ?? '')
  .replace(/D-LIVE/gi,'').replace(/\bLIVE\b/gi,'')
  .replace(/[(（]原音[)）]/g,'').replace(/[(（]續看[)）]|續看/g,'')
  .replace(/\s+/g,' ').trim();
function inheritsFromLive(r:Broadcast, row:MatchRow, sameDate:Broadcast[], chains:CourtSessionChain[]):boolean {
  if (r.isLive !== false) return false;
  const normalized = stripPlaybackMarkers(r.title);
  if (!normalized) return false;
  return sameDate.some(live=>live !== r && live.isLive !== false && live.providerId === r.providerId
    && live.disciplineCode === r.disciplineCode && stripPlaybackMarkers(live.title) === normalized
    && matchesDirectly(live,row,chains));
}

export function broadcastsForRow(all:Broadcasts, date:string, row:MatchRow,
  chains:CourtSessionChain[]=[]):Broadcast[] {
  const sameDate = forDate(all,date);
  return sameDate.filter(r=>matchesDirectly(r,row,chains) || inheritsFromLive(r,row,sameDate,chains));
}

// Programmes that could not be tied to one unit, grouped per discipline so they are shown once.
export function disciplineBroadcasts(all:Broadcasts, date:string, rows:MatchRow[],
  chains:CourtSessionChain[]=[]):Map<string,Broadcast[]> {
  const attached = new Set(rows.flatMap(row=>broadcastsForRow(all,date,row,chains))
    .map(r=>r.providerId + '|' + r.broadcastStartTimeTaipei + '|' + r.disciplineCode));
  const out = new Map<string,Broadcast[]>();
  for (const r of forDate(all,date)) {
    if (attached.has(r.providerId + '|' + r.broadcastStartTimeTaipei + '|' + r.disciplineCode)) continue;
    out.set(r.disciplineCode, [...(out.get(r.disciplineCode) ?? []), r]);
  }
  return out;
}

export const feedLabel = (feed:Broadcast['feed'])=>feed === 'original' ? '原音' : null;
