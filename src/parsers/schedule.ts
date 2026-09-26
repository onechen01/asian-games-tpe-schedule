import { parseTime, DISPLAY_TIMEZONE, VENUE_OFFSET, offsetOf, readAtVenueOffset } from '../utils/timezone.ts';

export type RawMember = { Name?: string; Org?: string; Bib?: string; FuncDesc?: string; PosDesc?: string };
export type RawExtension = { Code?: string; Value?: string };
export type RawCompetitor = {
  Org?: string; Name?: string; Reg?: string; Result?: string; Winner?: boolean; Rk?: string;
  Qualified?: string;
  Members?: RawMember[];
  // Only some disciplines' unit responses carry a per-competitor STARTTIME extension (e.g. an
  // equestrian qualifier where each rider goes in sequence). Most do not -- a head-to-head bout
  // or a simultaneous shooting relay has nothing to put here, and that is expected, not missing.
  Extensions?: RawExtension[];
};
export type RawSchedule = {
  Key: string; Disc: string; Orgs?: string[]; Org?: string; Home?: RawCompetitor; Away?: RawCompetitor;
  DiscDesc?: string; Event?: string; EventDesc?: string; Phase?: string; PhaseDesc?: string;
  UnitDesc?: string; UnitDescA?: string; DateTimeRaw?: string; HideStartDate?: boolean;
  HideLocation?: boolean; Estimated?: boolean; EstText?: string; Venue?: string; VenueDesc?: string;
  Loc?: string; LocDesc?: string; isH2H?:boolean;
  ResCode?: string; Status?: string; StatusDesc?: string; IsLive?: boolean; Medal?: string;
};
// What HideStartDate=true actually means, classified from the official EstText note. The parser
// is the only place that reads English officialese or does venue-to-Taipei clock math; the
// display layer only ever switches on `code` and interpolates the already-converted clockTaipei.
// A pattern this classifier does not recognise still degrades to PENDING (never invented, never
// thrown) -- `raw` keeps the original text so a newly observed officials' phrasing can be found
// later without a whole day's schedule failing to publish.
export type TimeNoteCode = 'FOLLOWED_BY' | 'NOT_BEFORE' | 'RESCHEDULED' | 'PENDING';
export type TimeNote = { code: TimeNoteCode; clockTaipei: string | null; raw: string | null };
const FOLLOWED_BY_RE = /^follow(?:ed)?\s+by$/i;
const NOT_BEFORE_RE = /^not\s+before\s+(\d{1,2}):(\d{2})$/i;
const RESCHEDULED_RE = /^new\s+start\s+time\s+(\d{1,2}):(\d{2})$/i;
// An HH:MM read at the venue's own offset, the same assumption already used for DateTimeRaw
// everywhere else in this parser -- not a new, unverified conversion. Exported so a per-
// competitor clock time (see competitor() below) can reuse the identical reading instead of a
// second, easy-to-get-wrong implementation.
export function venueClockToTaipeiISO(wallDate: string | null, hh: string, mm: string): string | null {
  if (!wallDate) return null;
  return parseTime(`${wallDate}T${hh.padStart(2,'0')}:${mm}:00${VENUE_OFFSET}`)?.taipei ?? null;
}
function venueClockToTaipei(wallDate: string | null, hh: string, mm: string): string | null {
  return venueClockToTaipeiISO(wallDate, hh, mm)?.slice(11,16) ?? null;
}
export function classifyTimeNote(row: RawSchedule, wallDate: string | null): TimeNote | null {
  if (row.HideStartDate !== true) return null;
  const text = typeof row.EstText === 'string' ? row.EstText.trim() : '';
  if (!text) return { code:'PENDING', clockTaipei:null, raw:null };
  if (FOLLOWED_BY_RE.test(text)) return { code:'FOLLOWED_BY', clockTaipei:null, raw:text };
  const notBefore = NOT_BEFORE_RE.exec(text);
  if (notBefore) return { code:'NOT_BEFORE', clockTaipei:venueClockToTaipei(wallDate,notBefore[1],notBefore[2]), raw:text };
  const rescheduled = RESCHEDULED_RE.exec(text);
  if (rescheduled) return { code:'RESCHEDULED', clockTaipei:venueClockToTaipei(wallDate,rescheduled[1],rescheduled[2]), raw:text };
  // An EstText shape not seen before: never guessed, never fails the batch -- PENDING with the
  // raw text preserved so it can be found and classified properly later.
  return { code:'PENDING', clockTaipei:null, raw:text };
}
export type Source = {
  url: string; data_fetched_at?: string; checked_at?: string; captured_at?: string;
  raw_file?: string | null; mode?: string; [key: string]: unknown;
};
export type QualificationSource = { kind:'previous-results-qualified'; previousUnitIds:string[];
  urls:string[]; rawFiles:(string|null)[] };
const STARTTIME_RE = /^(\d{1,2}):(\d{2})$/;
// The competitor's own STARTTIME extension, when the discipline's unit response carries one, at
// the same wall date as the unit itself (the unit is one competition session; a rider going at
// 14:48 is still that day). Malformed or absent extensions resolve to null -- never guessed,
// never thrown -- so a discipline without this data behaves exactly as before.
function competitorStartTimeTaipei(c: RawCompetitor, wallDate: string | null): string | null {
  const raw = c.Extensions?.find(e => e.Code === 'STARTTIME')?.Value;
  const match = typeof raw === 'string' ? STARTTIME_RE.exec(raw.trim()) : null;
  return match ? venueClockToTaipeiISO(wallDate, match[1], match[2]) : null;
}
export function competitor(c: RawCompetitor, wallDate: string | null = null) {
  return { org: c.Org ?? null, name: c.Name ?? null, registration: c.Reg ?? null,
    result: c.Result ?? null, winner: c.Winner ?? null, rank: c.Rk ?? null,
    // An explicit official progression marker (normally "Q"). It is evidence for a later
    // undrawn phase; an empty value is neutral and a rank is never treated as qualification.
    qualified:typeof c.Qualified === 'string' && c.Qualified.trim() ? c.Qualified.trim() : null,
    // The officials mark the medal on the competitor itself (ME_GOLD/ME_SILVER/ME_BRONZE).
    medal: (c as {Medal?:string}).Medal ?? null,
    // Optional: only set when this competitor carries its own STARTTIME (see RawCompetitor).
    startTimeTaipei: competitorStartTimeTaipei(c, wallDate),
    members: (c.Members || []).map(m => ({ name: m.Name ?? null, org: m.Org ?? null,
      bib: m.Bib ?? null, role: m.FuncDesc ?? null, position: m.PosDesc ?? null })) };
}
export function assertRow(value: unknown): asserts value is RawSchedule {
  if (!value || typeof value !== 'object') throw new Error('Schedule row must be an object');
  const row = value as Record<string, unknown>;
  if (typeof row.Key !== 'string' || !row.Key || typeof row.Disc !== 'string' || !row.Disc) {
    throw new Error('Schedule row missing Key or Disc');
  }
  for (const name of ['DateTimeRaw','DiscDesc','Status','EventDesc','PhaseDesc','VenueDesc','EstText']) {
    if (row[name] != null && typeof row[name] !== 'string') throw new Error(`Schema change: ${name}`);
  }
  if (row.Orgs != null && (!Array.isArray(row.Orgs) || !row.Orgs.every(x => typeof x === 'string'))) {
    throw new Error('Schema change: Orgs must be an array of NOC codes');
  }
  for (const name of ['Home','Away']) {
    const c = row[name];
    if (c != null && (typeof c !== 'object' || Array.isArray(c))) throw new Error(`Schema change: ${name}`);
  }
}
// Recovery is only allowed when the Results API itself proves the competition day: the day
// the row was requested for, which must also be one of the discipline's official days.
export type DayEvidence = { requestedDate?: string; officialDays?: string[] };
export function normalize(value: unknown, source: Source, evidence: DayEvidence = {}) {
  assertRow(value);
  const row = value;
  const orgs = [...new Set([...(row.Orgs || []), row.Home?.Org, row.Away?.Org, row.Org].filter((x): x is string => !!x))];
  // An offset other than the venue's is a source defect: read as-is it silently moves a unit
  // to the wrong calendar day. The raw string is kept and the anomaly is reported either way.
  const sourceOffset = offsetOf(row.DateTimeRaw);
  const suspectTimezone = sourceOffset !== null && sourceOffset !== VENUE_OFFSET;
  const wallDate = typeof row.DateTimeRaw === 'string' ? row.DateTimeRaw.slice(0,10) : null;
  const dayProven = !!wallDate && !!evidence.requestedDate && wallDate === evidence.requestedDate
    && (!evidence.officialDays || evidence.officialDays.includes(wallDate));
  const recovered = suspectTimezone && dayProven ? readAtVenueOffset(row.DateTimeRaw) : null;
  const parsed = parseTime(recovered ?? row.DateTimeRaw);
  const participation = orgs.includes('TPE') ? 'confirmed' : orgs.length ? 'not_listed' : 'unknown';
  const statusMap: Record<string,string> = { RUNNING:'in_progress', OFFICIAL:'finished',
    SCHEDULED:'not_started', START_LIST:'not_started', PROVISIONAL:'not_started' };
  return {
    id: `${row.Disc}:${row.Key}`, unitId: row.Key, eventId: row.Event ?? null,
    phaseId:row.Phase ?? null,
    ...(row.Disc === 'WSU' ? { isH2H:row.isH2H ?? null } : {}),
    resultCode: row.ResCode || null,
    disciplineCode: row.Disc, disciplineName: row.DiscDesc ?? null,
    eventName: row.EventDesc ?? null, phaseName: row.PhaseDesc ?? null,
    unitName: row.UnitDesc || row.UnitDescA || row.PhaseDesc || null,
    // The official string is never rewritten; a recovered reading is recorded beside it.
    originalStartTime: row.DateTimeRaw ?? null, sourceOffset,
    timezoneAnomaly: suspectTimezone ? { code: recovered ? 'RECOVERED_OFFICIAL_TIME' : 'SUSPECT_TIMEZONE',
      sourceOffset, venueOffset: VENUE_OFFSET, recoveredStartTime: recovered,
      evidence: recovered ? { requestedDate: evidence.requestedDate ?? null,
        officialDays: evidence.officialDays ?? null, venueTimeZoneSource: 'config.venueTimeZone' } : null } : null,
    // HideStartDate only means the official clock time must not be shown to a reader as exact
    // (e.g. an order-dependent "Followed by" match) -- it is not evidence the unit's calendar
    // day is unknown. The internal time is still derived from DateTimeRaw so date bucketing and
    // sorting keep working; timeHidden below tells the display layer
    // not to render it as a precise clock time.
    startTimeUtc: suspectTimezone && !recovered ? null : parsed?.utc ?? null,
    startTimeTaipei: suspectTimezone && !recovered ? null : parsed?.taipei ?? null,
    // The single source of truth for how a card should show its time: null means startTimeTaipei
    // is trustworthy as-is; otherwise the display layer switches on `code`, never on disciplineCode.
    timeNote: classifyTimeNote(row, wallDate),
    displayTimezone: DISPLAY_TIMEZONE, timeHidden: row.HideStartDate === true, estimated: row.Estimated === true,
    venueCode: row.Venue ?? null, venueName: row.HideLocation ? null : row.VenueDesc ?? null,
    // Loc is the official stable sub-venue identity. LocDesc is retained only for display and
    // for resolving a broadcaster's literal "Court N" label to that identity.
    locationCode: row.Loc ?? null, locationName: row.HideLocation ? null : row.LocDesc ?? null,
    courtSessionChainId: null as string | null,
    courtPredecessorUnitId: null as string | null,
    status: statusMap[row.Status || ''] || 'unknown', sourceStatus: row.Status ?? null,
    sourceStatusDescription: row.StatusDesc ?? null, isLive: row.IsLive ?? null,
    hasTpe: participation === 'confirmed' ? true : participation === 'unknown' ? null : false,
    participation, orgs, competitors: [row.Home,row.Away].filter((c): c is RawCompetitor => !!c).map(c=>competitor(c)),
    qualificationSource:null as QualificationSource | null,
    medalCode: row.Medal ?? null, broadcast: { status:'unverified', platforms:[] as string[] },
    sourceUrl: source.url, fetchedAt: source.data_fetched_at ?? source.captured_at ?? null,
    checkedAt: source.checked_at ?? source.captured_at ?? null, source
  };
}
export function parseDaily(data: unknown, source: Source, evidence: DayEvidence = {}) {
  if (!Array.isArray(data)) throw new Error('Schema change: daily schedule must be an array');
  return data.map(row => normalize(row, source, evidence));
}
export type Schedule = ReturnType<typeof normalize>;

export type CourtTimeKind = 'EXACT' | 'LOWER_BOUND' | 'NONE';
export type CourtSessionUnit = {
  unitId:string; unitName:string | null; predecessorUnitId:string | null;
  timeNoteCode:TimeNoteCode | null; timeKind:CourtTimeKind; timeTaipei:string | null;
};
export type CourtSessionChain = {
  id:string; disciplineCode:'BDM'; locationCode:string; locationName:string;
  anchorUnitId:string; anchorTimeKind:CourtTimeKind; anchorTimeTaipei:string | null;
  units:CourtSessionUnit[];
};

const clockOnRowDate = (row:Schedule, clock:string | null):string | null => {
  const date = row.startTimeTaipei?.slice(0,10);
  return date && clock ? `${date}T${clock}:00+08:00` : null;
};
const courtTimeEvidence = (row:Schedule):{kind:CourtTimeKind;time:string|null} => {
  if (!row.timeNote) return { kind:'EXACT', time:row.startTimeTaipei };
  if (row.timeNote.code === 'RESCHEDULED') {
    return { kind:'EXACT', time:clockOnRowDate(row,row.timeNote.clockTaipei) };
  }
  if (row.timeNote.code === 'NOT_BEFORE') {
    return { kind:'LOWER_BOUND', time:clockOnRowDate(row,row.timeNote.clockTaipei) };
  }
  // FOLLOWED_BY's DateTimeRaw is an ordering slot, not a time claim. PENDING has no reliable
  // clock either. Both remain usable in the official order but never become time evidence.
  return { kind:'NONE', time:null };
};

// This must run on the complete official discipline/day response, before any TPE filtering.
// A chain starts at a unit that is not FOLLOWED_BY and owns the following units on the same
// official Loc until the next such anchor. DateTimeRaw supplies order only; it is never promoted
// to a precise clock for FOLLOWED_BY. "Upper/lower" broadcaster wording is deliberately absent.
export function buildCourtSessionChains(input:Schedule[]):{rows:Schedule[];chains:CourtSessionChain[]} {
  const rows = input.map(row=>({...row,courtSessionChainId:null,courtPredecessorUnitId:null}));
  const position = new Map(rows.map((row,index)=>[row.id,index]));
  const groups = new Map<string,Schedule[]>();
  for (const row of rows) {
    if (row.disciplineCode !== 'BDM' || !row.locationCode || !row.locationName
      || !/^Court\s+\d+$/i.test(row.locationName)) continue;
    const key = row.locationCode;
    groups.set(key,[...(groups.get(key) ?? []),row]);
  }
  const chains:CourtSessionChain[] = [];
  for (const courtRows of groups.values()) {
    courtRows.sort((a,b)=>(a.originalStartTime ?? '').localeCompare(b.originalStartTime ?? '')
      || (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
    let chain:CourtSessionChain | null = null;
    let predecessor:string | null = null;
    for (const row of courtRows) {
      row.courtPredecessorUnitId = predecessor;
      if (row.timeNote?.code !== 'FOLLOWED_BY') {
        const evidence = courtTimeEvidence(row);
        chain = {
          id:`BDM|${row.originalStartTime?.slice(0,10) ?? 'unknown'}|${row.locationCode}|${row.unitId}`,
          disciplineCode:'BDM', locationCode:row.locationCode!, locationName:row.locationName!,
          anchorUnitId:row.unitId, anchorTimeKind:evidence.kind, anchorTimeTaipei:evidence.time,
          units:[],
        };
        chains.push(chain);
      }
      if (chain) {
        const evidence = courtTimeEvidence(row);
        row.courtSessionChainId = chain.id;
        chain.units.push({ unitId:row.unitId, unitName:row.unitName,
          predecessorUnitId:row.courtPredecessorUnitId,
          timeNoteCode:row.timeNote?.code ?? null, timeKind:evidence.kind, timeTaipei:evidence.time });
      }
      predecessor = row.unitId;
    }
  }
  return { rows, chains };
}

// The event endpoint lists every phase, including earlier days. Only phases starting at
// the event's first official start time may use an Entries-only provisional card.
export function initialEventPhases(value:unknown,disciplineCode:string,eventId:string):Set<string> {
  if (!Array.isArray(value) || !value.length) throw new Error('Event schedule missing units');
  const starts=new Map<string,number>();
  for (const item of value) {
    const row=item as {Disc?:unknown;Event?:unknown;Phase?:unknown;DateTimeRaw?:unknown};
    if (row?.Disc !== disciplineCode || row.Event !== eventId
      || typeof row.Phase !== 'string' || !row.Phase
      || typeof row.DateTimeRaw !== 'string') throw new Error('Event phase identity/structure mismatch');
    const time=parseTime(row.DateTimeRaw);
    if (!time) throw new Error('Event phase start time missing');
    const start=Date.parse(time.utc);
    starts.set(row.Phase,Math.min(starts.get(row.Phase) ?? Infinity,start));
  }
  const first=Math.min(...starts.values());
  return new Set([...starts].filter(([,start])=>start===first).map(([phase])=>phase));
}

// For an undrawn later phase, identify the immediately preceding official phase only when the
// destination phase has exactly one unit. This makes an official Qualified marker safe to carry
// forward into a single final/session, while multi-unit brackets remain unresolved because this
// endpoint does not say which destination unit a qualifier belongs in.
export function qualificationPredecessors(value:unknown,disciplineCode:string,eventId:string,
  currentUnitId:string):Schedule[] {
  if (!Array.isArray(value) || !value.length) throw new Error('Event schedule missing units');
  const rows=value.map(item=>normalize(item,{url:'event-schedule'}));
  if (rows.some(row=>row.disciplineCode!==disciplineCode || row.eventId!==eventId)) {
    throw new Error('Event qualification identity mismatch');
  }
  const current=rows.filter(row=>row.unitId===currentUnitId);
  if (current.length!==1 || !current[0].phaseId) throw new Error('Current event unit missing or ambiguous');
  const destination=rows.filter(row=>row.phaseId===current[0].phaseId);
  if (destination.length!==1 || !current[0].startTimeUtc) return [];
  const currentStart=Date.parse(current[0].startTimeUtc);
  const phases=new Map<string,{start:number;rows:Schedule[]}>();
  for (const row of rows) {
    if (!row.phaseId || !row.startTimeUtc || row.phaseId===current[0].phaseId) continue;
    const start=Date.parse(row.startTimeUtc);
    if (!Number.isFinite(start) || start>=currentStart) continue;
    const phase=phases.get(row.phaseId) ?? {start,rows:[]};
    phase.start=Math.min(phase.start,start);
    phase.rows.push(row);
    phases.set(row.phaseId,phase);
  }
  if (!phases.size) return [];
  const latest=Math.max(...[...phases.values()].map(phase=>phase.start));
  const previous=[...phases.values()].filter(phase=>phase.start===latest);
  if (previous.length!==1 || previous[0].rows.some(row=>row.status!=='finished' || !row.resultCode)) return [];
  return previous[0].rows;
}

// The official Wushu event lists separate routines, then a medal unit. Its Results UI reads
// the phase-level key for the combined score; the routine keys contain component scores.
export function wushuResultTarget(row:Schedule, dayRows:Schedule[]) {
  const samePhase = dayRows.filter(other=>other.disciplineCode === row.disciplineCode
    && other.eventId === row.eventId && other.phaseId === row.phaseId && other.resultCode);
  if (row.disciplineCode !== 'WSU' || row.isH2H !== false || !row.eventId || !row.phaseId
    || samePhase.length < 2 || samePhase.some(other=>other.isH2H !== false)
    || !samePhase.some(other=>other.medalCode === '0')
    || !samePhase.some(other=>other.medalCode === '1')) {
    return { code:row.resultCode, scope:null } as const;
  }
  return row.medalCode === '1'
    ? { code:`${row.phaseId}.--------`, scope:'aggregate' } as const
    : { code:row.resultCode, scope:'component' } as const;
}
