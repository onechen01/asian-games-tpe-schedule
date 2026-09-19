// Canonical daily view: Results API rows plus the Chinese Taipei Olympic Committee sheet.
// Neither source file is modified. Every canonical row keeps its provenance, and a pairing
// is only made when several independent signals agree -- no fuzzy name similarity.
export type ResultsRow = {
  id:string; unitId?:string; disciplineCode:string; disciplineName?:string | null;
  eventName?:string | null; phaseName?:string | null; unitName?:string | null;
  startTimeTaipei?:string | null; originalStartTime?:string | null; venueName?:string | null;
  eventId?:string | null; hasTpe?:boolean | null; orgs?:string[]; sourceStatus?:string | null;
  competitors?:Competitor[];
  result?:{ sourceStatus?:string; competitors?:Competitor[] };
};
export type Competitor = { org?:string | null; name?:string | null; result?:string | null;
  registration?:string | null; members?:{ name?:string | null }[] };
// A competitor is one person when it carries no member list and its registration is the
// numeric athlete id. A team slot instead carries a structured id such as
// "BBLMTEAM9------TPE01", and its name is the delegation, not a person.
const isIndividual = (c:Competitor)=>!(c.members ?? []).length
  && typeof c.registration === 'string' && /^\d+$/.test(c.registration)
  && !!c.name && c.name !== 'Chinese Taipei';
// The roster of a team entry; empty for an individual competitor.
const memberNames = (c:Competitor)=>(c.members ?? []).map(m=>m.name ?? '').filter(Boolean);
export type TpenocMatch = {
  sport:string; timeJst:string; timeTaipei:string; startTimeJst:string; startTimeTaipei:string;
  event:string; athletes:string[]; opponent:string | null; result:string | null;
  venue:string | null; rank:string | null; note:string | null; noteLines?:string[];
};
export type MatchStatus = 'MATCHED' | 'TPENOC_ONLY' | 'RESULTS_ONLY';
// TPE_ENTERED is weaker than TPE_CONFIRMED: the delegation entered the event, but the official
// draw has not placed anyone in a specific heat, lane or bout yet.
export type Participation = 'TPE_CONFIRMED' | 'TPE_ENTERED' | 'PARTICIPANTS_TBD';
// 'unit' means a unit's own Orgs named Chinese Taipei; 'event' means only the entry list did.
export type EntryLevel = 'unit' | 'event';
export type Confidence = 'high' | 'medium' | 'none';
export type DailyRow = {
  date:string; startTimeTaipei:string | null; startTimeJst:string | null;
  disciplineCode:string | null; sportZh:string | null; sportEn:string | null;
  event:string | null; phase:string | null; unit:string | null;
  athletes:string[]; athletesEn:string[]; opponent:string | null; opponentCode:string | null;
  venue:string | null; venueZh:string | null; status:string | null;
  result:{ tpe:string | null; opponent:string | null; source:'results' } | null;
  tpenocResult:string | null; rank:string | null; note:string | null;
  participationState:Participation; entryLevel:EntryLevel;
  // Event-level rows only: how many units of this event run that day, and who is entered.
  unitCount:number | null; enteredAthletes:string[];
  matchStatus:MatchStatus; matchConfidence:Confidence;
  matchSignals:string[]; sources:{ results?:{ unitId?:string; id:string }; tpenoc?:{ sport:string; timeJst:string };
    entries?:{ eventId:string } };
};
export type MergeWarning = { code:string; message:string; row?:string };
export type ResultsSnapshot = { date:string; rows:ResultsRow[];
  coverage?:{ fetchComplete?:boolean; missing?:unknown[] }; errors?:unknown[] };
export type DailyReport = {
  date:string; rows:DailyRow[];
  // True only when the official sync finished cleanly and still found nobody: a day with no
  // Chinese Taipei event, as opposed to a day whose data is missing or incomplete.
  officialNoCompetition:boolean;
  coverageComplete:boolean;
  summary:{ matched:number; tpenocOnly:number; resultsOnly:number; entered:number;
    unresolvedTbd:number; warnings:number };
  warnings:MergeWarning[];
};

// Traditional Chinese names as used in Taiwan, one per official discipline code. Written out
// rather than transliterated; a code with no entry here falls back to the official English.
export const SPORT_ZH: Record<string,string> = {
  ARC:'射箭', ATH:'田徑', BBL:'棒球', BDM:'羽球', BK3:'3x3籃球', BKB:'籃球',
  BKG:'霹靂舞', BMF:'自由車BMX自由式', BMX:'自由車BMX競速', BOX:'拳擊', CKT:'板球',
  CLB:'運動攀登', CRD:'自由車公路賽', CSL:'輕艇激流', CSP:'輕艇靜水', CTR:'自由車場地賽',
  DIV:'跳水', ELS:'電子競技', EQU:'馬術', FBL:'足球', FEN:'擊劍', GAR:'競技體操',
  GLF:'高爾夫', GRY:'韻律體操', GTR:'彈翻床', HBL:'手球', HOC:'曲棍球', JJI:'柔術',
  JUD:'柔道', KAB:'卡巴迪', KTE:'空手道', KUR:'克拉術', MMA:'綜合格鬥', MPN:'現代五項',
  MTB:'自由車登山車', PDL:'帕德網球', ROW:'划船', RU7:'七人制橄欖球', SAL:'帆船',
  SBL:'壘球', SHO:'射擊', SKB:'滑板', SPK:'藤球', SQU:'壁球', SRF:'衝浪',
  SWA:'水上芭蕾', SWM:'游泳', TEN:'網球', TEQ:'桌式足球', TKW:'跆拳道', TRI:'鐵人三項',
  TST:'軟式網球', TTE:'桌球', VBV:'沙灘排球', VVO:'排球', WLF:'舉重', WPO:'水球',
  WRE:'角力', WSU:'武術',
};
// The committee sheet writes some sports its own way, so matching accepts those spellings too.
// Display always uses SPORT_ZH above.
const SPORT_ALIASES: Record<string,string> = {
  '籃球(5*5)':'BKB', '籃球(5X5)':'BKB', '籃球5*5':'BKB', '籃球':'BKB',
  '3x3籃球':'BK3', '籃球3*3':'BK3',
  '軟式網球':'TST', '曲棍球':'HOC', '排球':'VVO', '足球':'FBL', '棒球':'BBL',
  '壘球':'SBL', '羽球':'BDM', '桌球':'TTE', '游泳':'SWM', '射擊':'SHO', '武術':'WSU',
};
const CODE_BY_ZH: Record<string,string> = { ...SPORT_ALIASES,
  ...Object.fromEntries(Object.entries(SPORT_ZH).map(([code,zh])=>[zh,code])) };
// Only NOC codes actually seen on these sheets; anything else stays unmapped.
export const NOC_BY_ZH: Record<string,string> = {
  菲律賓:'PHI', 寮國:'LAO', 南韓:'KOR', 韓國:'KOR', 蒙古:'MGL', 泰國:'THA', 印度:'IND',
  日本:'JPN', 中國:'CHN', 馬來西亞:'MAS', 哈薩克:'KAZ', 孟加拉:'BAN', 越南:'VIE',
  香港:'HKG', 吉爾吉斯:'KGZ', 印尼:'INA',
};
// 'Women' contains 'men', so it must be tested first.
const genderOf = (text:string | null | undefined): 'W' | 'M' | null =>
  !text ? null : /女子|女|Women/i.test(text) ? 'W' : /男子|男|Men/i.test(text) ? 'M' : null;
const minutes = (iso:string | null | undefined)=>iso && Number.isFinite(Date.parse(iso)) ? Date.parse(iso)/60000 : null;
const competitors = (row:ResultsRow)=>row.result?.competitors ?? row.competitors ?? [];
const tpeSide = (row:ResultsRow)=>competitors(row).find(c=>c.org === 'TPE') ?? null;
// "Opponent" only means something in a two-sided unit. A heat or a routine final lists many
// nations, and naming one of them as the opponent would be a plain error.
const headToHead = (row:ResultsRow)=>{
  const sides = competitors(row).filter(c=>c.org);
  if (sides.length === 2) return true;
  return sides.length === 0 && (row.orgs ?? []).length === 2;
};
const otherSide = (row:ResultsRow)=>headToHead(row)
  ? competitors(row).find(c=>c.org && c.org !== 'TPE')
    ?? ((row.orgs ?? []).filter(o=>o !== 'TPE').map(org=>({ org, name:null, result:null }))[0] ?? null)
  : null;

export type EntryLookup = Map<string,{ evDesc:string | null; athletes:string[] }>;
export function mergeDaily(results:ResultsSnapshot, tpenoc:{ scheduleDate:string; matches:TpenocMatch[] } | null,
  entries:EntryLookup | null = null): DailyReport {
  const date = results.date;
  if (tpenoc && tpenoc.scheduleDate !== date) throw new Error(`日期不一致：Results ${date}，中華奧會 ${tpenoc.scheduleDate}`);
  const warnings:MergeWarning[] = [];
  const tpeRows = results.rows.filter(r=>r.hasTpe === true);
  // A unit with a single nation listed is half-drawn: the other side is still open, so it
  // counts as undecided rather than as a unit Chinese Taipei is known not to be in.
  const tbdRows = results.rows.filter(r=>r.hasTpe === null
    || (r.hasTpe === false && (r.orgs ?? []).length === 1));
  const paired = new Map<string,TpenocMatch>();
  const rows:DailyRow[] = [];

  for (const entry of tpenoc?.matches ?? []) {
    const code = CODE_BY_ZH[entry.sport] ?? null;
    const where = `${entry.sport} ${entry.timeJst}`;
    if (!code) warnings.push({ code:'SPORT_UNMAPPED', message:`中華奧會運動名稱「${entry.sport}」沒有對應的 discipline code，無法配對`, row:where });
    const opponentCode = entry.opponent ? NOC_BY_ZH[entry.opponent] ?? null : null;
    if (entry.opponent && !opponentCode) warnings.push({ code:'OPPONENT_UNMAPPED', message:`對手國「${entry.opponent}」沒有對應的 NOC code`, row:where });
    const gender = genderOf(entry.event);
    // Two independent signals are required: discipline plus opponent, or discipline plus a
    // unique same-gender row at the same Taiwan time. Time alone never decides a pairing.
    const pool = code ? tpeRows.filter(r=>r.disciplineCode === code && !paired.has(r.id)) : [];
    const sameGender = pool.filter(r=>!gender || genderOf(r.eventName) === gender);
    const byOpponent = opponentCode
      ? sameGender.filter(r=>(r.orgs ?? []).includes(opponentCode) || otherSide(r)?.org === opponentCode) : [];
    const sameTime = sameGender.filter(r=>minutes(r.startTimeTaipei) === minutes(entry.startTimeTaipei));
    let hit:ResultsRow | null = null, confidence:Confidence = 'none';
    const signals:string[] = [];
    if (byOpponent.length === 1) { hit = byOpponent[0]; confidence = 'high'; signals.push('discipline','gender','opponent'); }
    else if (byOpponent.length > 1) warnings.push({ code:'AMBIGUOUS_MATCH', message:`${where} 對 ${entry.opponent} 有 ${byOpponent.length} 個候選，未合併`, row:where });
    else if (code && sameTime.length === 1) { hit = sameTime[0]; confidence = 'medium'; signals.push('discipline','gender','startTimeTaipei'); }
    else if (sameTime.length > 1) warnings.push({ code:'AMBIGUOUS_MATCH', message:`${where} 同時間有 ${sameTime.length} 個候選，未合併`, row:where });

    if (!hit) {
      warnings.push({ code:'TPENOC_ONLY', message:`中華奧會列出 ${entry.sport} ${entry.timeTaipei} 對 ${entry.opponent ?? '未列'}，Results 無法配對`, row:where });
      rows.push(canonical(date, null, entry, 'TPENOC_ONLY', 'none', signals));
      continue;
    }
    paired.set(hit.id, entry);
    if (minutes(hit.startTimeTaipei) !== minutes(entry.startTimeTaipei)) {
      warnings.push({ code:'TIME_DIFFERS', message:`${entry.sport}：中華奧會 ${entry.timeTaipei}，Results ${hit.startTimeTaipei?.slice(11,16) ?? '未知'}（台灣時間），兩者都保留`, row:where });
      signals.push('timeDiffers');
    }
    if (gender && genderOf(hit.eventName) !== gender) {
      warnings.push({ code:'EVENT_UNCERTAIN', message:`${entry.sport}：項目「${entry.event}」與 Results「${hit.eventName ?? ''}」無法安全對應`, row:where });
    }
    rows.push(canonical(date, hit, entry, 'MATCHED', confidence, signals));
  }

  for (const row of tpeRows) {
    if (paired.has(row.id)) continue;
    warnings.push({ code:'RESULTS_ONLY', message:`Results 確認 TPE 但中華奧會未列出：${row.disciplineCode} ${row.startTimeTaipei?.slice(11,16) ?? ''} ${row.unitName ?? ''}`.trim(), row:row.id });
    rows.push(canonical(date, row, null, 'RESULTS_ONLY', 'none', []));
  }
  // Units the official draw has not filled yet. The entry list can say the delegation is in
  // that event, but never which unit, so the whole event collapses into a single pending row.
  // Without an entry list nothing is assumed and every unit stays unresolved.
  const confirmedEvents = new Set(tpeRows.map(row=>row.disciplineCode + '|' + (row.eventId ?? '')));
  const pending = new Map<string,{ rows:ResultsRow[]; athletes:string[] }>();
  for (const row of tbdRows) {
    const key = row.disciplineCode + '|' + (row.eventId ?? '');
    const entry = entries?.get(key);
    if (!entries) { rows.push(canonical(date, row, null, 'RESULTS_ONLY', 'none', [])); continue; }
    // The entry list is complete for the delegation, so an event it does not list is an event
    // Chinese Taipei is not in; those units simply do not belong on a Chinese Taipei page.
    if (!entry) continue;
    if (confirmedEvents.has(key)) continue;
    const bucket = pending.get(key) ?? { rows:[], athletes:entry.athletes };
    bucket.rows.push(row);
    pending.set(key, bucket);
  }
  // A later phase of an already-confirmed event stays a machine-readable warning only: being
  // drawn into the next round is never assumed.
  for (const row of tbdRows) {
    const key = row.disciplineCode + '|' + (row.eventId ?? '');
    if (!entries || !confirmedEvents.has(key) || !entries.get(key)) continue;
    if (warnings.some(w=>w.code === 'PENDING_LATER_UNITS' && w.row === key)) continue;
    warnings.push({ code:'PENDING_LATER_UNITS', row:key,
      message:`${row.disciplineCode} ${row.eventName ?? ''} 當日尚有未編組場次，官方公布後才知道中華隊是否出賽`.trim() });
  }
  for (const [key,bucket] of pending) {
    const first = [...bucket.rows].sort((a,b)=>(a.startTimeTaipei ?? '').localeCompare(b.startTimeTaipei ?? ''))[0];
    rows.push({ ...canonical(date, first, null, 'RESULTS_ONLY', 'none', []),
      participationState:'TPE_ENTERED', entryLevel:'event',
      unitCount:bucket.rows.length, enteredAthletes:bucket.athletes,
      unit:null, opponent:null, opponentCode:null, result:null, status:null,
      sources:{ entries:{ eventId:key } } });
  }

  rows.sort((a,b)=>(a.startTimeTaipei ?? '').localeCompare(b.startTimeTaipei ?? ''));
  // Every condition must hold; a single failed endpoint means the day is unknown, not empty.
  const coverageComplete = results.coverage?.fetchComplete === true
    && (results.coverage?.missing?.length ?? 0) === 0
    && (results.errors?.length ?? 0) === 0;
  return { date, rows,
    coverageComplete,
    officialNoCompetition:coverageComplete && rows.length === 0,
    summary:{ matched:rows.filter(r=>r.matchStatus === 'MATCHED').length,
      tpenocOnly:rows.filter(r=>r.matchStatus === 'TPENOC_ONLY').length,
      resultsOnly:rows.filter(r=>r.matchStatus === 'RESULTS_ONLY' && r.participationState === 'TPE_CONFIRMED').length,
      entered:rows.filter(r=>r.participationState === 'TPE_ENTERED').length,
      unresolvedTbd:rows.filter(r=>r.participationState === 'PARTICIPANTS_TBD').length,
      warnings:warnings.length },
    warnings };
}

function canonical(date:string, results:ResultsRow | null, tpenoc:TpenocMatch | null,
  matchStatus:MatchStatus, matchConfidence:Confidence, matchSignals:string[]): DailyRow {
  const tpe = results ? tpeSide(results) : null, other = results ? otherSide(results) : null;
  const status = results?.result?.sourceStatus ?? results?.sourceStatus ?? null;
  const scored = ['RUNNING','OFFICIAL','FINISHED','UNOFFICIAL','INTERMEDIATE'].includes(status ?? '');
  return {
    date,
    // Canonical time is Asia/Taipei; the Japanese source time is kept alongside it.
    startTimeTaipei:results?.startTimeTaipei ?? tpenoc?.startTimeTaipei ?? null,
    startTimeJst:results?.originalStartTime ?? tpenoc?.startTimeJst ?? null,
    disciplineCode:results?.disciplineCode ?? (tpenoc ? CODE_BY_ZH[tpenoc.sport] ?? null : null),
    // One display name per discipline, from the table above; the committee's own wording for
    // the same sport stays in sources.tpenoc.
    sportZh:(results ? SPORT_ZH[results.disciplineCode] : null)
      ?? (tpenoc ? SPORT_ZH[CODE_BY_ZH[tpenoc.sport] ?? ''] ?? tpenoc.sport : null),
    sportEn:results?.disciplineName ?? null,
    event:results?.eventName ?? tpenoc?.event ?? null,
    phase:results?.phaseName ?? (results ? null : tpenoc?.event ?? null),
    unit:results?.unitName ?? null,
    // Chinese names come from the committee sheet; the English roster is kept separately.
    athletes:tpenoc?.athletes ?? [],
    // Team entries publish a member list; individual events publish the athlete as the
    // competitor itself, which used to be dropped and left those cards without a name.
    athletesEn:(results ? competitors(results) : []).filter(c=>c.org === 'TPE')
      .flatMap(c=>memberNames(c).length ? memberNames(c) : isIndividual(c) ? [c.name as string] : []),
    opponent:tpenoc?.opponent ?? other?.name ?? null,
    opponentCode:other?.org ?? (tpenoc?.opponent ? NOC_BY_ZH[tpenoc.opponent] ?? null : null),
    venue:results?.venueName ?? tpenoc?.venue ?? null,
    venueZh:tpenoc?.venue ?? null,
    status,
    // Scores and status always come from Results; a blank committee cell never overwrites them.
    result:results && scored && (tpe?.result ?? other?.result) != null
      ? { tpe:tpe?.result ?? null, opponent:other?.result ?? null, source:'results' } : null,
    tpenocResult:tpenoc?.result ?? null,
    rank:tpenoc?.rank ?? null,
    note:tpenoc?.note ?? null,
    participationState:results && results.hasTpe !== true && !tpenoc ? 'PARTICIPANTS_TBD' : 'TPE_CONFIRMED',
    entryLevel:'unit', unitCount:null, enteredAthletes:[],
    matchStatus, matchConfidence, matchSignals,
    sources:{ ...(results ? { results:{ unitId:results.unitId, id:results.id } } : {}),
      ...(tpenoc ? { tpenoc:{ sport:tpenoc.sport, timeJst:tpenoc.timeJst } } : {}) },
  };
}
