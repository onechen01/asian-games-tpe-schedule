export type StatusFilter = 'upcoming' | 'live' | 'finished';
export type StatusCategory = StatusFilter | 'unknown';

export type FilterState = {
  sports:string[];
  statuses:StatusFilter[];
  broadcast:boolean;
};
export type SportOption = {code:string;label:string};

export type ScheduleItemMeta = {
  id:string;
  disciplineCode:string | null;
  sportLabel:string;
  status:string | null;
  hasBroadcast:boolean;
  timeNoteCode?:'FOLLOWED_BY' | 'NOT_BEFORE' | 'RESCHEDULED' | 'PENDING' | null;
};

export type JumpTarget = {
  id:string;
  kind:'live' | 'upcoming' | 'finished' | 'unknown';
  message:string;
};

export const EMPTY_FILTERS:FilterState = { sports:[], statuses:[], broadcast:false };

const STATUS_ORDER:StatusFilter[] = ['upcoming','live','finished'];
const STATUS_VALUES = new Set<StatusFilter>(STATUS_ORDER);
const STATUS_CATEGORIES:Record<string,StatusFilter> = {
  SCHEDULED:'upcoming', START_LIST:'upcoming', PROVISIONAL:'upcoming', GETTING_READY:'upcoming',
  RUNNING:'live', LIVE:'live',
  OFFICIAL:'finished', FINISHED:'finished',
};

export function scheduleStatusCategory(status:string|null|undefined):StatusCategory {
  return status ? STATUS_CATEGORIES[status] ?? 'unknown' : 'unknown';
}

const uniqueSorted = (values:string[])=>[...new Set(values)].sort((a,b)=>a.localeCompare(b));

export function normalizeFilters(filters:FilterState,allowedSports?:Iterable<string>):FilterState {
  const allowed = allowedSports ? new Set(allowedSports) : null;
  const sports = uniqueSorted(filters.sports.filter(code=>!allowed || allowed.has(code)));
  const selected = new Set(filters.statuses.filter(status=>STATUS_VALUES.has(status)));
  return {
    sports,
    statuses:STATUS_ORDER.filter(status=>selected.has(status)),
    broadcast:filters.broadcast === true,
  };
}

const firstQueryValue = (value:string|string[]|undefined)=>Array.isArray(value)?value[0]:value;
const commaValues = (value:string|string[]|undefined)=>(firstQueryValue(value)??'')
  .split(',').map(part=>part.trim()).filter(Boolean);

export function parseFilterQuery(query:Record<string,string|string[]|undefined>,allowedSports:Iterable<string>):FilterState {
  return normalizeFilters({
    sports:commaValues(query.sports),
    statuses:commaValues(query.status).filter((value):value is StatusFilter=>STATUS_VALUES.has(value as StatusFilter)),
    broadcast:firstQueryValue(query.broadcast)==='1',
  },allowedSports);
}

export function activeFilterCount(filters:FilterState){
  return filters.sports.length + filters.statuses.length + (filters.broadcast?1:0);
}

export function hasActiveFilters(filters:FilterState){return activeFilterCount(filters)>0;}

export function matchesScheduleFilters(item:ScheduleItemMeta,filters:FilterState){
  if(filters.sports.length && (!item.disciplineCode || !filters.sports.includes(item.disciplineCode)))return false;
  const category=scheduleStatusCategory(item.status);
  if(filters.statuses.length && (category==='unknown'||!filters.statuses.includes(category)))return false;
  if(filters.broadcast&&!item.hasBroadcast)return false;
  return true;
}

export function visibleScheduleItems(items:ScheduleItemMeta[],filters:FilterState){
  return items.filter(item=>matchesScheduleFilters(item,filters));
}

export function scheduleUrl(date:string,filters:FilterState,jump=false){
  const normalized=normalizeFilters(filters);
  const params=new URLSearchParams({date});
  if(normalized.sports.length)params.set('sports',normalized.sports.join(','));
  if(normalized.statuses.length)params.set('status',normalized.statuses.join(','));
  if(normalized.broadcast)params.set('broadcast','1');
  if(jump)params.set('jump','1');
  return '/?'+params.toString();
}

export function selectJumpTarget(items:ScheduleItemMeta[]):JumpTarget|null {
  if(!items.length)return null;
  const live=items.find(item=>scheduleStatusCategory(item.status)==='live');
  if(live)return {id:live.id,kind:'live',message:'已定位到第一場進行中的賽程。'};
  const upcoming=items.find(item=>scheduleStatusCategory(item.status)==='upcoming');
  if(upcoming)return {id:upcoming.id,kind:'upcoming',message:'目前沒有進行中的符合賽程，已定位到下一場尚未開始的賽程。'};
  const unknown=items.find(item=>scheduleStatusCategory(item.status)==='unknown');
  if(unknown)return {id:unknown.id,kind:'unknown',message:'目前無法安全判斷下一場，已定位到狀態待確認的賽程。'};
  const last=items.at(-1)!;
  return {id:last.id,kind:'finished',message:'今天符合條件的後續賽程已全部結束，已定位到最後一場。'};
}

export function zipScheduleItems<T>(items:ScheduleItemMeta[],cards:T[]){
  if(items.length!==cards.length)throw new Error('Schedule metadata and cards are not aligned');
  return items.map((item,index)=>({item,card:cards[index]}));
}
