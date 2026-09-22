import { parseTime, DISPLAY_TIMEZONE, VENUE_OFFSET, offsetOf, readAtVenueOffset } from '../utils/timezone.ts';

export type RawMember = { Name?: string; Org?: string; Bib?: string; FuncDesc?: string; PosDesc?: string };
export type RawCompetitor = {
  Org?: string; Name?: string; Reg?: string; Result?: string; Winner?: boolean; Rk?: string;
  Members?: RawMember[];
};
export type RawSchedule = {
  Key: string; Disc: string; Orgs?: string[]; Org?: string; Home?: RawCompetitor; Away?: RawCompetitor;
  DiscDesc?: string; Event?: string; EventDesc?: string; Phase?: string; PhaseDesc?: string;
  UnitDesc?: string; UnitDescA?: string; DateTimeRaw?: string; HideStartDate?: boolean;
  HideLocation?: boolean; Estimated?: boolean; Venue?: string; VenueDesc?: string; isH2H?:boolean;
  ResCode?: string; Status?: string; StatusDesc?: string; IsLive?: boolean; Medal?: string;
};
export type Source = {
  url: string; data_fetched_at?: string; checked_at?: string; captured_at?: string;
  raw_file?: string | null; mode?: string; [key: string]: unknown;
};
export function competitor(c: RawCompetitor) {
  return { org: c.Org ?? null, name: c.Name ?? null, registration: c.Reg ?? null,
    result: c.Result ?? null, winner: c.Winner ?? null, rank: c.Rk ?? null,
    // The officials mark the medal on the competitor itself (ME_GOLD/ME_SILVER/ME_BRONZE).
    medal: (c as {Medal?:string}).Medal ?? null,
    members: (c.Members || []).map(m => ({ name: m.Name ?? null, org: m.Org ?? null,
      bib: m.Bib ?? null, role: m.FuncDesc ?? null, position: m.PosDesc ?? null })) };
}
export function assertRow(value: unknown): asserts value is RawSchedule {
  if (!value || typeof value !== 'object') throw new Error('Schedule row must be an object');
  const row = value as Record<string, unknown>;
  if (typeof row.Key !== 'string' || !row.Key || typeof row.Disc !== 'string' || !row.Disc) {
    throw new Error('Schedule row missing Key or Disc');
  }
  for (const name of ['DateTimeRaw','DiscDesc','Status','EventDesc','PhaseDesc','VenueDesc']) {
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
    startTimeUtc: suspectTimezone && !recovered ? null : parsed?.utc ?? null,
    startTimeTaipei: row.HideStartDate || (suspectTimezone && !recovered) ? null : parsed?.taipei ?? null,
    displayTimezone: DISPLAY_TIMEZONE, timeHidden: row.HideStartDate === true, estimated: row.Estimated === true,
    venueCode: row.Venue ?? null, venueName: row.HideLocation ? null : row.VenueDesc ?? null,
    status: statusMap[row.Status || ''] || 'unknown', sourceStatus: row.Status ?? null,
    sourceStatusDescription: row.StatusDesc ?? null, isLive: row.IsLive ?? null,
    hasTpe: participation === 'confirmed' ? true : participation === 'unknown' ? null : false,
    participation, orgs, competitors: [row.Home,row.Away].filter((c): c is RawCompetitor => !!c).map(competitor),
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
