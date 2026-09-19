export type Result = { tpe:string | null; opponent:string | null; source:string };
export type Row = {
  date:string; startTimeTaipei:string | null; startTimeJst:string | null;
  disciplineCode:string | null; sportZh:string | null; sportEn:string | null;
  event:string | null; phase:string | null; unit:string | null;
  athletes:string[]; athletesEn:string[]; opponent:string | null; opponentCode:string | null;
  venue:string | null; venueZh:string | null; status:string | null; result:Result | null;
  tpenocResult:string | null; rank:string | null; note:string | null;
  participationState:'TPE_CONFIRMED' | 'PARTICIPANTS_TBD';
  matchStatus:'MATCHED' | 'TPENOC_ONLY' | 'RESULTS_ONLY';
  matchConfidence:string; matchSignals:string[];
  sources:{ results?:{ unitId?:string; id:string }; tpenoc?:{ sport:string; timeJst:string } };
};
export type Warning = { code:string; message:string; row?:string };
export type Daily = {
  schemaVersion:number; date:string; generatedAt:string; timezone:string;
  // Set by the merge step only when the official sync finished cleanly and found nobody.
  officialNoCompetition?:boolean; coverageComplete?:boolean;
  rows:Row[]; warnings:Warning[];
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

import {chineseNamesFor} from './roster.ts';
import type {Roster} from './roster.ts';

export const sportLabel=(row:Row)=>row.sportZh||row.sportEn||row.disciplineCode||'運動待確認';
export const venueLabel=(row:Row)=>row.venueZh||row.venue||null;
// Chinese names are the headline. When only the English roster exists it stays in the data
// and is shown as secondary detail instead, so no name is invented or dropped.
export const nameList=(row:Row)=>row.athletes;
// The reference roster is consulted only when the daily sources gave no Chinese names, and
// only when every athlete on court resolves with high confidence -- a partial list would
// misrepresent the line-up. It never adds, removes or replaces anyone.
export function displayNames(row:Row,roster:Roster|null):{names:string[];fromReference:boolean}{
 if(row.athletes.length)return {names:row.athletes,fromReference:false};
 if(!roster||!row.athletesEn.length)return {names:[],fromReference:false};
 const {names,complete}=chineseNamesFor(row.athletesEn,row.disciplineCode,roster);
 return complete?{names,fromReference:true}:{names:[],fromReference:false};
}
export const hasChineseNames=(row:Row)=>row.athletes.length>0;

const STATUS:Record<string,string>={OFFICIAL:'已結束',FINISHED:'已結束',RUNNING:'比賽中',LIVE:'比賽中',
  SCHEDULED:'尚未開始',START_LIST:'尚未開始',PROVISIONAL:'尚未開始',GETTING_READY:'尚未開始'};
// An unrecognised code is shown as-is rather than translated into something invented.
export function statusLabel(row:Row){
  if(!row.status)return null;
  return STATUS[row.status]??row.status;
}
export const isFinished=(row:Row)=>row.status==='OFFICIAL'||row.status==='FINISHED';

export const isTaiwanRow=(row:Row)=>row.participationState==='TPE_CONFIRMED';
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
