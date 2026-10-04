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
    courtSession?:CourtSessionHint; sessionScopes?:SessionScope[] };
};
export type CourtSessionHint = {
  locationLabel:string; roundKeyword:string; sourceSessionLabel:string;
};
// A provider may explicitly describe one programme as covering several event scopes. Each scope
// is conjunctive, while the array is disjunctive: e.g. women's 48kg OR women's 52kg, never the
// unsafe cross product of every gender and weight mentioned anywhere in the title.
export type SessionScope = {
  gender?:'MEN'|'WOMEN'; eventFamily?:'INDIVIDUAL'|'TEAM'; weightKg?:number;
  roundNumber?:number; competitionGroup?:'A'|'B';
  stage?:'ELIMINATION_SESSION'|'ROUND_OF_16'|'QUARTERFINAL'|'REPECHAGE';
};
export type Unresolved = { time:string|null; title:string; reason:string };

const recordIdentity = (r:BroadcastRecord)=>JSON.stringify([
  r.providerId,r.date,r.broadcastStartTimeTaipei,r.disciplineCode,r.title ?? '',
]);

export function preserveVerifiedMatchHints(next:BroadcastRecord[],previous:BroadcastRecord[]):BroadcastRecord[] {
  const verified = new Map(previous
    .filter(r=>r.matchHint.eventKeywords?.length)
    .map(r=>[recordIdentity(r),r.matchHint]));
  return next.map(r=>r.matchHint.eventKeywords?.length || r.matchHint.courtSession
    || r.matchHint.sessionScopes?.length ? r
    : verified.has(recordIdentity(r)) ? {...r,matchHint:verified.get(recordIdentity(r))!} : r);
}

const CODE_BY_ZH:Record<string,string> = {
  ...Object.fromEntries(Object.entries(SPORT_ZH).map(([code,zh])=>[zh,code])),
  // ELTA uses the shorter common label while Results canonical calls ELS "電子競技".
  電競:'ELS',
};

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

const chineseRound = (value:string):number|null => {
  if (/^\d+$/.test(value)) return Number(value);
  const simple:Record<string,number>={一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};
  return simple[value] ?? null;
};

function golfSessionScopes(title:string):SessionScope[] {
  const roundHit=/第([一二三四五六七八九十\d]+)輪/.exec(title);
  const roundNumber=roundHit ? chineseRound(roundHit[1]) : null;
  const genders:('MEN'|'WOMEN')[] = /男\s*[／/]\s*女/.test(title)
    ? ['MEN','WOMEN'] : /男子/.test(title) ? ['MEN'] : /女子/.test(title) ? ['WOMEN'] : [];
  const families:('INDIVIDUAL'|'TEAM')[]=[];
  if (/個人/.test(title)) families.push('INDIVIDUAL');
  if (/團體/.test(title)) families.push('TEAM');
  if (!roundNumber || !genders.length || !families.length) return [];
  return genders.flatMap(gender=>families.map(eventFamily=>({gender,eventFamily,roundNumber})));
}

function genderWeightScopes(title:string):Pick<SessionScope,'gender'|'weightKg'>[] {
  const marker=/男(?:子)?|女(?:子)?/g;
  const hits=[...title.matchAll(marker)];
  const scopes:Pick<SessionScope,'gender'|'weightKg'>[]=[];
  for (let i=0;i<hits.length;i++) {
    const start=hits[i].index!+hits[i][0].length;
    const next=hits[i+1]?.index ?? title.length;
    const kg=title.indexOf('公斤',start);
    const end=kg>=0&&kg<next?kg:next;
    const weights=title.slice(start,end).match(/\d+(?:\.\d+)?/g)?.map(Number)??[];
    const gender=hits[i][0].startsWith('男')?'MEN':'WOMEN';
    for (const weightKg of weights) scopes.push({gender,weightKg});
  }
  return scopes;
}

function combatEliminationSessionScopes(title:string):SessionScope[] {
  if (!/預賽\s*[／/]\s*複賽/.test(title)) return [];
  return genderWeightScopes(title).map(scope=>({...scope,stage:'ELIMINATION_SESSION'}));
}

function judoRepechageScopes(title:string):SessionScope[] {
  if (!/複賽/.test(title) || /預賽\s*[／/]\s*複賽/.test(title)) return [];
  const weighted=genderWeightScopes(title);
  if (weighted.length) return weighted.map(scope=>({...scope,stage:'REPECHAGE'}));
  return /團體/.test(title) ? [{eventFamily:'TEAM',stage:'REPECHAGE'}] : [];
}

function taekwondoSessionScopes(title:string):SessionScope[] {
  const stages:NonNullable<SessionScope['stage']>[]=[];
  if (/16強/.test(title)) stages.push('ROUND_OF_16');
  if (/八強/.test(title)) stages.push('QUARTERFINAL');
  if (!stages.length) return [];
  return genderWeightScopes(title).flatMap(scope=>stages.map(stage=>({...scope,stage})));
}

function equestrianSessionScopes(title:string):SessionScope[] {
  const hit=/([AB])組第(\d+)輪/.exec(title);
  return hit ? [{competitionGroup:hit[1] as 'A'|'B',roundNumber:Number(hit[2])}] : [];
}

// Provider parsing only: these scopes describe text the broadcaster actually wrote. They are
// never participation evidence and can only select already-existing canonical rows.
export function structuredSessionHint(title:string,disciplineCode:string):SessionScope[] {
  const scopes=disciplineCode==='GLF' ? golfSessionScopes(title)
    : disciplineCode==='JUD' ? [...combatEliminationSessionScopes(title),...judoRepechageScopes(title)]
    : disciplineCode==='WRE' ? combatEliminationSessionScopes(title)
    : disciplineCode==='TKW' ? taekwondoSessionScopes(title)
    : disciplineCode==='EQU' ? equestrianSessionScopes(title) : [];
  return [...new Map(scopes.map(scope=>[JSON.stringify(scope),scope])).values()];
}

const ordinal = (value:number)=>{
  const mod100=value%100, mod10=value%10;
  const suffix=mod100>=11&&mod100<=13?'th':mod10===1?'st':mod10===2?'nd':mod10===3?'rd':'th';
  return `${value}${suffix} Round`;
};
// ELTA explicitly describes these as a badminton court session. Upper/lower is retained only
// for diagnosis; the matcher must select the official chain from court, round and time evidence.
export function badmintonCourtSessionHint(title:string):CourtSessionHint|null {
  const hit=/羽球\s+個人賽第(\d+)輪\s*[（(]\s*([^\-)）]+)\s*-\s*第(\d+)球場\s*[)）]/.exec(title);
  if (hit) return { locationLabel:`Court ${Number(hit[3])}`, roundKeyword:ordinal(Number(hit[1])),
    sourceSessionLabel:hit[2].trim() };
  // Knockout programmes use a shorter "stage + court" form. The court is only a resolver for
  // an already-existing official canonical unit; it never supplies participation or a schedule.
  const knockout=/羽球(?:\s+[^\s（）()]+)*?\s+(八強|四強|準決賽|決賽)\s*(?:[（(]\s*)?第(\d+)球場\s*[)）]?/.exec(title);
  if (!knockout) return null;
  const roundKeyword=knockout[1]==='八強'?'Quarterfinal'
    : knockout[1]==='決賽'?'Final':'Semifinal';
  return {locationLabel:`Court ${Number(knockout[2])}`,roundKeyword,
    sourceSessionLabel:knockout[1]};
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
      const sessionScopes = structuredSessionHint(title,disciplineCode);
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
        // A session programme is still discipline-level. A structured scope may cover several
        // already-existing units; without one, the ordinary phase hint still needs its official
        // window. Neither path lets time alone create a match.
        matchLevel:courtSession || sessionScopes.length ? 'discipline'
          : opponent || named.length ? 'unit' : 'discipline',
        matchHint:courtSession ? { ...(named.length ? {athleteNames:named} : {}), courtSession }
          : opponent ? { opponentCodes:[opponent] }
          : sessionScopes.length ? { ...(named.length ? {athleteNames:named} : {}), sessionScopes }
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
