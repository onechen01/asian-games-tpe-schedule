// ELTA adapter: turns the broadcaster's own published schedule into the shared broadcast
// schema. It is one provider among others — nothing here may leak into the generic layer,
// and nothing here may touch a competition time, an opponent or a result.
import { SPORT_ZH, NOC_BY_ZH } from '../parsers/merge-daily.ts';

export const PROVIDER = { providerId:'elta', providerName:'愛爾達',
  sourceUrl:'https://eltaott.tv/asg2026/' } as const;

export type BroadcastRecord = {
  date:string; providerId:string; providerName:string; broadcastStartTimeTaipei:string;
  // The broadcaster publishes its own end; it is never derived from the next programme.
  broadcastEndTimeTaipei:string|null;
  disciplineCode:string; title:string|null; feed:'main'|'original'|null; note:string|null;
  channelId:string|null; channelName:string|null; isLive:boolean|null;
  sourceUrl:string|null; capturedAt:string|null; matchLevel:'unit'|'discipline';
  matchHint:{ opponentCodes?:string[]; athleteNames?:string[]; phaseKeywords?:string[]; eventKeywords?:string[];
    courtSession?:CourtSessionHint };
};
export type CourtSessionHint = {
  locationLabel:string; roundKeyword:string; sourceSessionLabel:string;
};
export type Unresolved = { time:string|null; title:string; reason:string };

const recordIdentity = (r:BroadcastRecord)=>JSON.stringify([
  r.providerId,r.date,r.broadcastStartTimeTaipei,r.disciplineCode,r.title ?? '',
]);

export function preserveVerifiedMatchHints(next:BroadcastRecord[],previous:BroadcastRecord[]):BroadcastRecord[] {
  const verified = new Map(previous
    .filter(r=>r.matchHint.eventKeywords?.length)
    .map(r=>[recordIdentity(r),r.matchHint]));
  return next.map(r=>r.matchHint.eventKeywords?.length || r.matchHint.courtSession ? r
    : verified.has(recordIdentity(r)) ? {...r,matchHint:verified.get(recordIdentity(r))!} : r);
}

const CODE_BY_ZH = Object.fromEntries(Object.entries(SPORT_ZH).map(([code,zh])=>[zh,code]));

// The programme list is published as a JSON literal inside the public page. Reading it is a
// plain GET; nothing is logged into, and no private endpoint is used.
const BACKSLASH = String.fromCharCode(92);
export function extractScheduleList(html:string):Record<string,Record<string,unknown>> {
  const start = html.indexOf('let schedule_list =');
  if (start < 0) throw new Error('ELTA page no longer publishes schedule_list');
  const open = html.indexOf('{', start);
  let depth = 0, end = -1, inString = false, escape = false;
  for (let i = open; i < html.length; i++) {
    const ch = html[i];
    if (inString) { if (escape) escape = false; else if (ch === BACKSLASH) escape = true; else if (ch === '"') inString = false; continue; }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (!depth) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error('ELTA schedule_list is not a complete JSON object');
  const parsed = JSON.parse(html.slice(open,end)) as Record<string,Record<string,unknown>>;
  if (!parsed || typeof parsed !== 'object' || !Object.keys(parsed).length) {
    throw new Error('ELTA schedule_list is empty');
  }
  return parsed;
}

// "中國VS中華" names one opponent; anything vaguer stays discipline-level rather than being
// pinned to a competition it may not be.
const opponentOf = (title:string, nocByZh:Record<string,string>):string|null => {
  const m = title.match(/([\u4e00-\u9fff]{2,6})\s*VS\s*([\u4e00-\u9fff]{2,6})/i);
  if (!m) return null;
  const sides = [m[1],m[2]];
  if (!sides.some(s=>s === '中華' || s === '台灣')) return null;
  const other = sides.find(s=>s !== '中華' && s !== '台灣');
  return other ? nocByZh[other] ?? NOC_BY_ZH[other] ?? null : null;
};

// Epoch seconds as published, read at the Taipei offset the whole site uses.
export const taipeiFromEpoch = (seconds:unknown):string|null => {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date((value + 8*3600) * 1000).toISOString().replace('T',' ').slice(0,19)
    .replace(' ','T') + '+08:00';
};

// A session programme says which phase it covers; that is what lets it cover several units.
const PHASE_WORDS:[RegExp,string[]][] = [
  [/預賽/, ['Heats','Preliminar','Qualification','Round Robin','Group']],
  [/資格賽/, ['Qualification']],
  [/決賽/, ['Final']],
];
export const phaseHint = (title:string)=>{
  const words = PHASE_WORDS.filter(([pattern])=>pattern.test(title)).flatMap(([,keys])=>keys);
  return words.length ? [...new Set(words)] : [];
};

const ordinal = (value:number)=>{
  const mod100=value%100, mod10=value%10;
  const suffix=mod100>=11&&mod100<=13?'th':mod10===1?'st':mod10===2?'nd':mod10===3?'rd':'th';
  return `${value}${suffix} Round`;
};
// ELTA explicitly describes these as a badminton court session. Upper/lower is retained only
// for diagnosis; the matcher must select the official chain from court, round and time evidence.
export function badmintonCourtSessionHint(title:string):CourtSessionHint|null {
  const hit=/羽球\s+個人賽第(\d+)輪\s*[（(]\s*([^\-)）]+)\s*-\s*第(\d+)球場\s*[)）]/.exec(title);
  if (!hit) return null;
  return { locationLabel:`Court ${Number(hit[3])}`, roundKeyword:ordinal(Number(hit[1])),
    sourceSessionLabel:hit[2].trim() };
}

type Programme = { format_s_time?:unknown; start_datetime?:unknown; program_desc?:unknown;
  is_taipei_team?:unknown; sport_item?:{ sp_name?:unknown };
  cl_num?:unknown; cl_title?:unknown; live_type?:unknown; end_time?:unknown };

// A programme title often names the athlete ("甘家葳 拳擊 男子70公斤級預賽"). When exactly one
// verified athlete is named, that is a safe hint; two or none stays discipline-level.
// One programme may name several athletes ("張立/林郁芬"); every verified name found is a
// hint, and a row matches when it features any one of them.
export function athleteHint(title:string, byZh:Map<string,string>):string[] {
  const found = new Set<string>();
  for (const [zh,en] of byZh) if (title.includes(zh)) found.add(en);
  return [...found];
}

export function toBroadcasts(scheduleList:Record<string,Record<string,unknown>>,
  options:{ capturedAt:string; dates?:string[]; athletesByZh?:Map<string,string>;
    nocByZh?:Record<string,string> }):{ records:BroadcastRecord[]; unresolved:Unresolved[] } {
  const records:BroadcastRecord[] = [], unresolved:Unresolved[] = [];
  const seen = new Set<string>();
  for (const [date, programmes] of Object.entries(scheduleList)) {
    if (options.dates && !options.dates.includes(date)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    for (const value of Object.values(programmes ?? {})) {
      const p = value as Programme;
      const title = typeof p.program_desc === 'string' ? p.program_desc.trim() : '';
      const raw = typeof p.format_s_time === 'string' ? p.format_s_time
        : typeof p.start_datetime === 'string' ? p.start_datetime : null;
      if (!title) continue;
      // Only programmes the broadcaster itself marks as Chinese Taipei are taken. A guess
      // from the title alone would quietly add competitions Taiwan is not in.
      if (String(p.is_taipei_team) !== '1') continue;
      if (!raw || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw)) {
        unresolved.push({ time:raw, title, reason:'time-unparsable' });
        continue;
      }
      const sportZh = typeof p.sport_item?.sp_name === 'string' ? p.sport_item.sp_name.trim() : '';
      const disciplineCode = CODE_BY_ZH[sportZh];
      if (!disciplineCode) {
        unresolved.push({ time:raw, title, reason:`unknown-sport:${sportZh || 'none'}` });
        continue;
      }
      const startsOn = raw.slice(0,10);
      const broadcastStartTimeTaipei = `${startsOn}T${raw.slice(11,16)}:00+08:00`;
      const opponent = opponentOf(title, options.nocByZh ?? {});
      const named = opponent ? [] : athleteHint(title, options.athletesByZh ?? new Map());
      const courtSession = disciplineCode === 'BDM' ? badmintonCourtSessionHint(title) : null;
      // The channel is part of "where to watch", so it travels with the record; the field is
      // generic because another provider will have its own channels or services.
      const channelId = p.cl_num === undefined || p.cl_num === null ? null : String(p.cl_num);
      const rawChannel = typeof p.cl_title === 'string' ? p.cl_title.replace(/\s+/g,'') : '';
      const liveType = typeof p.live_type === 'string' ? p.live_type.toUpperCase() : '';
      const record:BroadcastRecord = {
        date:startsOn, ...PROVIDER, broadcastStartTimeTaipei, disciplineCode,
        channelId, channelName:rawChannel ? `${PROVIDER.providerName}${rawChannel}` : null,
        isLive:liveType ? liveType === 'LIVE' : null,
        title, feed:/原音/.test(title) ? 'original' : 'main',
        note:/原音/.test(title) ? '原音' : null,
        capturedAt:options.capturedAt,
        broadcastEndTimeTaipei:taipeiFromEpoch(p.end_time),
        // A session programme is still discipline-level; the phase hint plus the official
        // window is what allows it to cover several units, never the time alone.
        matchLevel:courtSession ? 'discipline' : opponent || named.length ? 'unit' : 'discipline',
        matchHint:courtSession ? { ...(named.length ? {athleteNames:named} : {}), courtSession }
          : opponent ? { opponentCodes:[opponent] }
          : named.length ? { athleteNames:named }
          : phaseHint(title).length ? { phaseKeywords:phaseHint(title) } : {},
      };
      const key = [record.date,record.broadcastStartTimeTaipei,record.disciplineCode,record.title].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      records.push(record);
    }
  }
  records.sort((a,b)=>a.broadcastStartTimeTaipei.localeCompare(b.broadcastStartTimeTaipei)
    || a.disciplineCode.localeCompare(b.disciplineCode));
  return { records, unresolved };
}

// The gate a fetched batch must pass before it may replace the stored provider records.
export function gateBroadcasts(next:BroadcastRecord[], previous:BroadcastRecord[]):{ pass:boolean; reasons:string[] } {
  const reasons:string[] = [];
  if (!next.length) reasons.push('empty-batch');
  const keys = next.map(r=>[r.date,r.broadcastStartTimeTaipei,r.disciplineCode,r.title].join('|'));
  if (keys.length !== new Set(keys).size) reasons.push('duplicate-records');
  for (const r of next) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(r.broadcastStartTimeTaipei)) { reasons.push('invalid-time'); break; }
  }
  for (const r of next) {
    if (!SPORT_ZH[r.disciplineCode]) { reasons.push(`invalid-discipline:${r.disciplineCode}`); break; }
    if (r.providerId !== PROVIDER.providerId) { reasons.push('wrong-provider'); break; }
    if (r.date < '2026-09-10' || r.date > '2026-10-04') { reasons.push(`date-out-of-range:${r.date}`); break; }
  }
  // A sudden collapse is treated as a source problem, not as "the broadcaster cancelled".
  if (previous.length >= 4 && next.length < previous.length / 2) reasons.push('suspicious-shrink');
  return { pass:reasons.length === 0, reasons };
}
