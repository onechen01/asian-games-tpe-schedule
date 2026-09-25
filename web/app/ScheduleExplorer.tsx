'use client';

import {Children,useEffect,useMemo,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {useRouter} from 'next/navigation';
import {taipeiDate} from '../lib/schedule';
import {activeFilterCount,EMPTY_FILTERS,hasActiveFilters,matchesScheduleFilters,
  scheduleUrl,selectJumpTarget,zipScheduleItems} from '../lib/schedule-filter';
import type {FilterState,ScheduleItemMeta,SportOption,StatusFilter} from '../lib/schedule-filter';

const STATUS_OPTIONS:{value:StatusFilter;label:string}[]=[
  {value:'upcoming',label:'未開始'},
  {value:'live',label:'進行中'},
  {value:'finished',label:'已結束'},
];

const sameFilters=(a:FilterState,b:FilterState)=>JSON.stringify(a)===JSON.stringify(b);

export default function ScheduleExplorer({date,sports,initialFilters,jumpRequested,items,baseSummary,
  emptyContent,children}:{date:string;sports:SportOption[];initialFilters:FilterState;jumpRequested:boolean;
  items:ScheduleItemMeta[];baseSummary:string|null;emptyContent?:ReactNode;children:ReactNode}){
  const router=useRouter();
  const [filters,setFilters]=useState(initialFilters);
  const [announcement,setAnnouncement]=useState('');
  const targets=useRef(new Map<string,HTMLDivElement>());
  const handledJump=useRef(false);
  const replaceTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const cards=Children.toArray(children);
  const pairs=zipScheduleItems(items,cards);

  useEffect(()=>{setFilters(current=>sameFilters(current,initialFilters)?current:initialFilters);},[initialFilters]);
  useEffect(()=>{if(!jumpRequested)handledJump.current=false;},[jumpRequested]);
  useEffect(()=>()=>{if(replaceTimer.current)clearTimeout(replaceTimer.current);},[]);

  const visible=useMemo(()=>items.filter(item=>matchesScheduleFilters(item,filters)),[items,filters]);
  const visibleIds=useMemo(()=>new Set(visible.map(item=>item.id)),[visible]);
  const active=hasActiveFilters(filters);
  const count=activeFilterCount(filters);

  const apply=(next:FilterState)=>{
    setFilters(next);
    setAnnouncement('');
    if(replaceTimer.current)clearTimeout(replaceTimer.current);
    replaceTimer.current=setTimeout(()=>{
      router.replace(scheduleUrl(date,next),{scroll:false});
      replaceTimer.current=null;
    },150);
  };
  const toggleSport=(code:string)=>apply({...filters,sports:filters.sports.includes(code)
    ?filters.sports.filter(value=>value!==code):[...filters.sports,code]});
  const toggleStatus=(status:StatusFilter)=>apply({...filters,statuses:filters.statuses.includes(status)
    ?filters.statuses.filter(value=>value!==status):[...filters.statuses,status]});
  const clear=()=>apply(EMPTY_FILTERS);
  const jump=()=>{
    if(replaceTimer.current){clearTimeout(replaceTimer.current);replaceTimer.current=null;}
    setAnnouncement('正在切換到今天並尋找目前賽程。');
    router.push(scheduleUrl(taipeiDate(new Date()),filters,true),{scroll:false});
  };

  useEffect(()=>{
    if(!jumpRequested||handledJump.current)return;
    handledJump.current=true;
    const target=selectJumpTarget(visible);
    const finish=()=>router.replace(scheduleUrl(date,filters),{scroll:false});
    if(!target){
      setAnnouncement(active?'今天沒有符合篩選條件的賽程，已保留目前的篩選條件。':'今天目前沒有可定位的台灣賽程。');
      finish();
      return;
    }
    const frame=requestAnimationFrame(()=>{
      const element=targets.current.get(target.id);
      if(element){element.scrollIntoView({behavior:'smooth',block:'start'});element.focus({preventScroll:true});}
      setAnnouncement(target.message);
      finish();
    });
    return ()=>cancelAnimationFrame(frame);
  },[active,date,filters,jumpRequested,router,visible]);

  const sportName=(code:string)=>sports.find(option=>option.code===code)?.label??code;
  const statusName=(status:StatusFilter)=>STATUS_OPTIONS.find(option=>option.value===status)?.label??status;
  const removeSport=(code:string)=>apply({...filters,sports:filters.sports.filter(value=>value!==code)});
  const removeStatus=(status:StatusFilter)=>apply({...filters,statuses:filters.statuses.filter(value=>value!==status)});

  return <>
    <section className="schedule-tools" aria-label="賽程篩選與定位">
      <div className="schedule-tool-actions">
        <details className="filter-panel">
          <summary>篩選賽程{count>0&&<span>（已選 {count}）</span>}</summary>
          <div className="filter-panel-body">
            <fieldset><legend>運動</legend><div className="sport-options">{sports.map(option=><label key={option.code}>
              <input type="checkbox" checked={filters.sports.includes(option.code)} onChange={()=>toggleSport(option.code)}/><span>{option.label}</span>
            </label>)}</div></fieldset>
            <fieldset><legend>狀態</legend><div className="compact-options">{STATUS_OPTIONS.map(option=><label key={option.value}>
              <input type="checkbox" checked={filters.statuses.includes(option.value)} onChange={()=>toggleStatus(option.value)}/><span>{option.label}</span>
            </label>)}</div></fieldset>
            <fieldset><legend>快速條件</legend><div className="compact-options"><label>
              <input type="checkbox" checked={filters.broadcast} onChange={()=>apply({...filters,broadcast:!filters.broadcast})}/><span>有轉播</span>
            </label></div></fieldset>
          </div>
        </details>
        <button className="jump-button" type="button" onClick={jump}>跳到目前賽程</button>
      </div>
      {active&&<div className="active-filters" aria-label="已套用的篩選條件">
        <div className="filter-chips">
          {filters.sports.map(code=><button type="button" key={code} onClick={()=>removeSport(code)} aria-label={`移除${sportName(code)}篩選`}><span>{sportName(code)}</span><b aria-hidden="true">×</b></button>)}
          {filters.statuses.map(status=><button type="button" key={status} onClick={()=>removeStatus(status)} aria-label={`移除${statusName(status)}篩選`}><span>{statusName(status)}</span><b aria-hidden="true">×</b></button>)}
          {filters.broadcast&&<button type="button" onClick={()=>apply({...filters,broadcast:false})} aria-label="移除有轉播篩選"><span>有轉播</span><b aria-hidden="true">×</b></button>}
        </div>
        <button className="clear-filters" type="button" onClick={clear}>清除篩選</button>
      </div>}
    </section>
    <p className="visually-hidden" aria-live="polite">{announcement}</p>
    <div className="list-heading"><h2>台灣出賽</h2>{items.length>0&&<span>{active?`${visible.length} / ${items.length} 筆符合`:baseSummary}</span>}</div>
    {items.length===0?emptyContent:<>
      {visible.length===0&&<section className="empty filtered-empty"><span className="empty-symbol">—</span><h3>目前沒有符合篩選條件的賽程</h3><p>已保留目前的篩選條件。</p><button type="button" onClick={clear}>清除篩選</button></section>}
      <div className="matches">{pairs.map(({item,card})=><div key={item.id} className="schedule-item" hidden={!visibleIds.has(item.id)}
        tabIndex={-1} ref={element=>{if(element)targets.current.set(item.id,element);else targets.current.delete(item.id);}}>{card}</div>)}</div>
    </>}
  </>;
}
