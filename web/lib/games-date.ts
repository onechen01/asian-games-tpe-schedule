import {GAMES_FIRST,GAMES_LAST} from '../../src/games-period.ts';
import {shiftDate,validDate} from './schedule.ts';

export type DateResolutionReason = 'invalid' | 'before-games' | 'after-games' | null;

export function clampGamesDate(date:string){
 if(date<GAMES_FIRST)return GAMES_FIRST;
 if(date>GAMES_LAST)return GAMES_LAST;
 return date;
}

export function resolveScheduleDate(requested:string|undefined,today:string){
 const candidate=requested&&validDate(requested)?requested:today;
 const reason:DateResolutionReason=requested&&!validDate(requested)?'invalid'
  :candidate<GAMES_FIRST?'before-games':candidate>GAMES_LAST?'after-games':null;
 return {date:clampGamesDate(candidate),reason};
}

export function scheduleNavigation(date:string){
 return {
  previous:date>GAMES_FIRST?shiftDate(date,-1):null,
  next:date<GAMES_LAST?shiftDate(date,1):null,
 };
}

export function relativeDateLinks(today:string){
 return [
  {label:'昨天',date:shiftDate(today,-1)},
  {label:'今天',date:today},
  {label:'明天',date:shiftDate(today,1)},
 ].filter(item=>item.date>=GAMES_FIRST&&item.date<=GAMES_LAST);
}

export function scheduleHeading(date:string,today:string){
 if(today>GAMES_LAST&&date===GAMES_LAST)return '最後比賽日賽程';
 const label=date===today?'今天':date===shiftDate(today,1)?'明天':date===shiftDate(today,-1)?'昨天':'所選日期';
 return `${label}，為台灣加油。`;
}

export {GAMES_FIRST,GAMES_LAST};
