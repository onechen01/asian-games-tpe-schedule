// Canonical daily view: Results API rows plus the Chinese Taipei Olympic Committee sheet.
// Neither source file is modified. Every canonical row keeps its provenance, and a pairing
// is only made when several independent signals agree -- no fuzzy name similarity.
export type ResultsRow = {
  id:string; unitId?:string; disciplineCode:string; disciplineName?:string | null;
  eventName?:string | null; phaseName?:string | null; unitName?:string | null;
  startTimeTaipei?:string | null; originalStartTime?:string | null; venueName?:string | null;
  hasTpe?:boolean | null; orgs?:string[]; sourceStatus?:string | null;
  competitors?:Competitor[];
  result?:{ sourceStatus?:string; competitors?:Competitor[] };
};
export type Competitor = { org?:string | null; name?:string | null; result?:string | null; members?:{ name?:string | null }[] };
export type TpenocMatch = {
  sport:string; timeJst:string; timeTaipei:string; startTimeJst:string; startTimeTaipei:string;
  event:string; athletes:string[]; opponent:string | null; result:string | null;
  venue:string | null; rank:string | null; note:string | null; noteLines?:string[];
};
export type MatchStatus = 'MATCHED' | 'TPENOC_ONLY' | 'RESULTS_ONLY';
export type Participation = 'TPE_CONFIRMED' | 'PARTICIPANTS_TBD';
export type Confidence = 'high' | 'medium' | 'none';
export type DailyRow = {
  date:string; startTimeTaipei:string | null; startTimeJst:string | null;
  disciplineCode:string | null; sportZh:string | null; sportEn:string | null;
  event:string | null; phase:string | null; unit:string | null;
  athletes:string[]; athletesEn:string[]; opponent:string | null; opponentCode:string | null;
  venue:string | null; venueZh:string | null; status:string | null;
  result:{ tpe:string | null; opponent:string | null; source:'results' } | null;
  tpenocResult:string | null; rank:string | null; note:string | null;
  participationState:Participation; matchStatus:MatchStatus; matchConfidence:Confidence;
  matchSignals:string[]; sources:{ results?:{ unitId?:string; id:string }; tpenoc?:{ sport:string; timeJst:string } };
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
  summary:{ matched:number; tpenocOnly:number; resultsOnly:number; unresolvedTbd:number; warnings:number };
  warnings:MergeWarning[];
};

// Written out per discipline: no transliteration, no guessing.
export const SPORT_ZH: Record<string,string> = {
  TST:'軟式網球', HOC:'曲棍球', BKB:'籃球(5*5)', VVO:'排球',
};
const CODE_BY_ZH = Object.fromEntries(Object.entries(SPORT_ZH).map(([code,zh])=>[zh,code]));
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
const otherSide = (row:ResultsRow)=>competitors(row).find(c=>c.org && c.org !== 'TPE') ?? null;

export function mergeDaily(results:ResultsSnapshot, tpenoc:{ scheduleDate:string; matches:TpenocMatch[] } | null): DailyReport {
  const date = results.date;
  if (tpenoc && tpenoc.scheduleDate !== date) throw new Error(`日期不一致：Results ${date}，中華奧會 ${tpenoc.scheduleDate}`);
  const warnings:MergeWarning[] = [];
  const tpeRows = results.rows.filter(r=>r.hasTpe === true);
  const tbdRows = results.rows.filter(r=>r.hasTpe === null);
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
  // A row missing from the committee sheet is not evidence of absence, so TBD stays TBD.
  for (const row of tbdRows) rows.push(canonical(date, row, null, 'RESULTS_ONLY', 'none', []));

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
    sportZh:tpenoc?.sport ?? (results ? SPORT_ZH[results.disciplineCode] ?? null : null),
    sportEn:results?.disciplineName ?? null,
    event:results?.eventName ?? tpenoc?.event ?? null,
    phase:results?.phaseName ?? (results ? null : tpenoc?.event ?? null),
    unit:results?.unitName ?? null,
    // Chinese names come from the committee sheet; the English roster is kept separately.
    athletes:tpenoc?.athletes ?? [],
    athletesEn:(results ? competitors(results) : []).filter(c=>c.org === 'TPE')
      .flatMap(c=>(c.members ?? []).map(m=>m.name ?? '').filter(Boolean)),
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
    matchStatus, matchConfidence, matchSignals,
    sources:{ ...(results ? { results:{ unitId:results.unitId, id:results.id } } : {}),
      ...(tpenoc ? { tpenoc:{ sport:tpenoc.sport, timeJst:tpenoc.timeJst } } : {}) },
  };
}
