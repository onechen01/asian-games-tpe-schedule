export type Result = { tpe:string | null; opponent:string | null; source:string };
export type Row = {
  date:string; startTimeTaipei:string | null; startTimeJst:string | null;
  disciplineCode:string | null; sportZh:string | null; sportEn:string | null;
  event:string | null; phase:string | null; unit:string | null;
  athletes:string[]; athletesEn:string[]; opponent:string | null; opponentCode:string | null;
  venue:string | null; venueZh:string | null; status:string | null; result:Result | null;
  tpenocResult:string | null; rank:string | null; note:string | null;
  // Present when one unit carried more than one Chinese Taipei entrant in an individual event.
  tpeEntrants?:{ name:string | null; registration:string | null; result:string | null; rank:string | null }[];
  tpeRank?:string | null; orgCount?:number | null; tpeMedal?:string | null;
  participationState:'TPE_CONFIRMED' | 'TPE_ENTERED' | 'PARTICIPANTS_TBD';
  entryLevel?:'unit' | 'event'; unitCount?:number | null; enteredAthletes?:string[];
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

import {athleteLabels} from './athletes.ts';
import type {AthleteMaster} from './athletes.ts';

export const sportLabel=(row:Row)=>row.sportZh||row.sportEn||row.disciplineCode||'運動待確認';
// Chinese names come from the committee sheet when it supplied them; otherwise each official
// English name is looked up in the athlete master, and an unverified name stays in English.
export function displayNames(row:Row,master:AthleteMaster):{names:string[];fromMaster:boolean}{
 if(row.athletes.length)return {names:row.athletes,fromMaster:false};
 if(!row.athletesEn.length)return {names:[],fromMaster:false};
 return {names:athleteLabels(row.athletesEn,master,row.disciplineCode),fromMaster:true};
}
// The committee's Chinese names, when it supplied any.
export const nameList=(row:Row)=>row.athletes;
// Entered rows carry the officially registered athletes, same lookup rule.
export const entryNames=(row:Row,master:AthleteMaster)=>athleteLabels(row.enteredAthletes??[],master,row.disciplineCode);

const STATUS:Record<string,string>={OFFICIAL:'已結束',FINISHED:'已結束',RUNNING:'比賽中',LIVE:'比賽中',
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
