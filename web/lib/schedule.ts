export type Result = { tpe:string | null; opponent:string | null; source:string };
// The single source of truth for how a card should show its time. Null means startTimeTaipei is
// trustworthy as-is; otherwise `code` says why and, for NOT_BEFORE/RESCHEDULED, clockTaipei is
// the already-converted Taipei clock -- the display layer never parses English or does timezone
// math itself.
export type TimeNote = { code:'FOLLOWED_BY' | 'NOT_BEFORE' | 'RESCHEDULED' | 'PENDING';
  clockTaipei:string | null; raw:string | null };
export type Row = {
  date:string; startTimeTaipei:string | null; startTimeJst:string | null;
  timeNote?:TimeNote | null;
  disciplineCode:string | null; sportZh:string | null; sportEn:string | null;
  event:string | null; phase:string | null; unit:string | null;
  athletes:string[]; athletesEn:string[]; opponent:string | null; opponentCode:string | null;
  venue:string | null; venueZh:string | null; status:string | null; result:Result | null;
  locationCode?:string | null; locationName?:string | null;
  courtSessionChainId?:string | null; courtPredecessorUnitId?:string | null;
  tpenocResult:string | null; rank:string | null; note:string | null;
  // Present when one unit carried more than one Chinese Taipei entrant in an individual event.
  tpeEntrants?:{ name:string | null; registration:string | null; result:string | null; rank:string | null;
    medal?:string | null }[];
  resultScope?:'component' | 'aggregate' | null;
  tpeRank?:string | null; orgCount?:number | null; tpeMedal?:string | null;
  participationState:'TPE_CONFIRMED' | 'TPE_ENTERED' | 'PARTICIPANTS_TBD';
  entryLevel?:'unit' | 'event'; unitCount?:number | null; enteredAthletes?:string[];
  matchStatus:'MATCHED' | 'TPENOC_ONLY' | 'RESULTS_ONLY';
  matchConfidence:string; matchSignals:string[];
  sources:{ results?:{ unitId?:string; id:string }; tpenoc?:{ sport:string; timeJst:string } };
};
export type Warning = { code:string; message:string; row?:string };
export type CourtSessionChain = {
  id:string; disciplineCode:'BDM'; locationCode:string; locationName:string;
  anchorUnitId:string; anchorTimeKind:'EXACT'|'LOWER_BOUND'|'NONE'; anchorTimeTaipei:string|null;
  units:{ unitId:string; unitName:string|null; predecessorUnitId:string|null;
    timeNoteCode:TimeNote['code']|null; timeKind:'EXACT'|'LOWER_BOUND'|'NONE'; timeTaipei:string|null }[];
};
export type Daily = {
  schemaVersion:number; date:string; generatedAt:string; timezone:string;
  // Set by the merge step only when the official sync finished cleanly and found nobody.
  officialNoCompetition?:boolean; coverageComplete?:boolean;
  rows:Row[]; warnings:Warning[]; sessionChains?:CourtSessionChain[];
  summary:{ matched:number; tpenocOnly:number; resultsOnly:number; unresolvedTbd:number; warnings:number };
  sources:{ results?:{ path:string; coverage?:{ sports?:string[]; fetchComplete?:boolean } } | null;
    tpenoc?:{ path:string; sourceFileName?:string; updatedAtJst?:string | null } | null };
};

export function validDate(date:string){return /^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;}
export function taipeiDate(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function shiftDate(date:string,days:number){return new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);}
// Every displayed time is Asia/Taipei; the Japanese source time stays in the data only.
export function formatTaipei(value?:string|null,withDate=false){
  if(!value||!/(Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))return '時間待確認';
  return new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hourCycle:'h23',
    ...(withDate?{month:'numeric',day:'numeric'}:{})}).format(new Date(value));
}
// The one place that turns Row.timeNote into a displayed string. Every caller (Card,
// EnteredCard, the progression "next round" line) must go through this -- none of them re-decide
// the label on their own, and none of them branch on disciplineCode. The underlying
// startTimeTaipei is still used internally for sorting and day bucketing. Broadcast matching
// separately applies the timeNote semantics and must not treat every hidden value as exact.
type TimeLabelRow = { startTimeTaipei?:string|null; timeNote?:TimeNote|null;
  courtSessionChainId?:string|null; courtPredecessorUnitId?:string|null;
  sources?:{results?:{unitId?:string}} };

export function matchTimeLabel(row:TimeLabelRow,chains:CourtSessionChain[]=[]){
  const note = row.timeNote;
  if (!note) return formatTaipei(row.startTimeTaipei);
  switch (note.code) {
    case 'FOLLOWED_BY': {
      const chain=chains.find(c=>c.id===row.courtSessionChainId);
      const current=chain?.units.find(u=>u.unitId===row.sources?.results?.unitId);
      const predecessorId=row.courtPredecessorUnitId??current?.predecessorUnitId;
      const predecessor=chain?.units.find(u=>u.unitId===predecessorId);
      // FOLLOWED_BY's own startTimeTaipei is only a sorting placeholder. Display evidence
      // comes exclusively from the preceding unit or the already-built official court chain.
      if(predecessor?.timeKind==='EXACT'&&predecessor.timeTaipei){
        return `前場 ${formatTaipei(predecessor.timeTaipei)} 開始\n前場結束後開賽`;
      }
      if(predecessor?.timeNoteCode==='FOLLOWED_BY'&&chain?.anchorTimeKind==='EXACT'&&chain.anchorTimeTaipei){
        return `本球場 ${formatTaipei(chain.anchorTimeTaipei)} 起依序進行\n前場結束後開賽`;
      }
      if(chain?.anchorTimeKind==='LOWER_BOUND'&&chain.anchorTimeTaipei){
        return `本球場不早於 ${formatTaipei(chain.anchorTimeTaipei)} 起依序進行\n前場結束後開賽`;
      }
      return '前場結束後';
    }
    case 'NOT_BEFORE': return note.clockTaipei ? `不早於 ${note.clockTaipei}` : '時間未定';
    case 'RESCHEDULED': return note.clockTaipei ? `已改期至 ${note.clockTaipei}` : '時間未定';
    // Includes both a genuinely empty official note and an EstText shape this parser does not
    // yet recognise -- neither is safe to show as a precise time, so both fail safe the same way.
    case 'PENDING': default: return '時間未定';
  }
}

import {athleteLabels} from './athletes.ts';
import type {AthleteMaster} from './athletes.ts';
import {localizeName} from './event-names.ts';

export const sportLabel=(row:Row)=>row.sportZh||row.sportEn||row.disciplineCode||'運動待確認';
export const resultHeading=(row:Pick<Row,'resultScope'|'unit'>,multiple=false)=>
  row.resultScope==='component' ? `官方分項成績（${localizeName(row.unit)||row.unit||'分項'}）`
  : row.resultScope==='aggregate' ? '官方全能總分／排名'
  : multiple ? '官方已公布成績（每人各自計分）' : '官方已公布成績';
// Chinese names come from the committee sheet when it supplied them; otherwise each official
// English name is looked up in the athlete master, and an unverified name stays in English.
// TODO(athlete-identity): single-athlete canonical rows currently reach this layer as bare
// athletesEn strings without their Results Reg. Carry Reg through the canonical/display boundary
// and make it the primary identity; English spellings should remain aliases/fallbacks only.
export function displayNames(row:Row,master:AthleteMaster):{names:string[];fromMaster:boolean}{
 if(row.athletes.length)return {names:row.athletes,fromMaster:false};
 if(!row.athletesEn.length)return {names:[],fromMaster:false};
 return {names:athleteLabels(row.athletesEn,master,row.disciplineCode),fromMaster:true};
}
// The committee's Chinese names, when it supplied any.
export const nameList=(row:Row)=>row.athletes;
// Entered rows carry the officially registered athletes, same lookup rule.
export const entryNames=(row:Row,master:AthleteMaster)=>athleteLabels(row.enteredAthletes??[],master,row.disciplineCode);

const STATUS:Record<string,string>={UNOFFICIAL:'暫定',OFFICIAL:'已結束',FINISHED:'已結束',RUNNING:'比賽中',LIVE:'比賽中',
  SCHEDULED:'尚未開始',START_LIST:'尚未開始',PROVISIONAL:'尚未開始',GETTING_READY:'尚未開始'};
// An unrecognised code is shown as-is rather than translated into something invented.
export function statusLabel(row:Row){
  if(!row.status)return null;
  return STATUS[row.status]??row.status;
}
export const isFinished=(row:Row)=>row.status==='OFFICIAL'||row.status==='FINISHED';

export const isTaiwanRow=(row:Row)=>row.participationState==='TPE_CONFIRMED'||row.participationState==='TPE_ENTERED';
// Entered means the delegation registered for the event; the draw has not placed anyone yet.
export const isEntered=(row:Row)=>row.participationState==='TPE_ENTERED';
export const isPending=(row:Row)=>row.participationState==='PARTICIPANTS_TBD';
export function taiwanRows(daily:Daily){
  return daily.rows.filter(isTaiwanRow)
    .sort((a,b)=>(a.startTimeTaipei||'').localeCompare(b.startTimeTaipei||''));
}
export function pendingRows(daily:Daily){return daily.rows.filter(isPending);}
// An empty day means three different things; the page must not blur them together.
export function emptyState(daily:Daily):'confirmed-none'|'incomplete'|'none-found'{
 if(daily.officialNoCompetition===true)return 'confirmed-none';
 if(daily.coverageComplete===false)return 'incomplete';
 return 'none-found';
}

// A source time conflict must not be swallowed: the card carries a short, non-technical hint.
const rowKey=(row:Row)=>row.sources.tpenoc?`${row.sources.tpenoc.sport} ${row.sources.tpenoc.timeJst}`:row.sources.results?.id;
export function hasTimeConflict(daily:Daily,row:Row){
  const key=rowKey(row);
  return !!key&&daily.warnings.some(w=>w.code==='TIME_DIFFERS'&&w.row===key);
}

export function parseDaily(value:unknown,date:string):Daily{
  if(!value||typeof value!=='object')throw Error('資料格式無法讀取');
  const d=value as Daily;
  if(d.schemaVersion!==1||d.date!==date||d.timezone!=='Asia/Taipei'||!Array.isArray(d.rows)
    ||!Array.isArray(d.warnings)||!d.summary||!Number.isFinite(Date.parse(d.generatedAt))){
    throw Error('資料格式或日期不符');
  }
  if(d.rows.some(r=>!r||typeof r.participationState!=='string'||!Array.isArray(r.athletes)||!Array.isArray(r.athletesEn))){
    throw Error('賽事欄位不完整');
  }
  return d;
}
