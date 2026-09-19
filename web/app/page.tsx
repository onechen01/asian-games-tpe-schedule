import {loadSchedule,loadRoster} from '../lib/load';
import {taipeiDate,shiftDate,validDate,formatTaipei,sportLabel,venueLabel,displayNames,entryNames,emptyState,isEntered,
 statusLabel,isFinished,taiwanRows,pendingRows,hasTimeConflict} from '../lib/schedule';
import type {Daily,Row} from '../lib/schedule';
import type {Roster} from '../lib/roster';
export const dynamic='force-dynamic';
export const revalidate=0;
// A registered-but-undrawn event is never shown as a confirmed start time: it names the event
// window, the number of units that day, and who is entered.
function EnteredCard({row,roster}:{row:Row;roster:Roster|null}){
 const names=entryNames(row,roster),venue=venueLabel(row);
 return <article className="match"><div className="match-time"><time>{formatTaipei(row.startTimeTaipei)}</time><span>本項起始・台灣時間</span></div><div className="match-main"><div className="match-top"><span className="sport">{sportLabel(row)}</span><span className="badge">待確認</span></div><h3>{row.event||'待確認'}</h3>{names.length>0&&<p className="opponent">中華隊報名：{names.slice(0,4).join('、')}{names.length>4&&` 等 ${names.length} 人`}</p>}<dl><div><dt>比賽項目</dt><dd>{row.event||'待確認'}</dd></div>{row.unitCount?<div><dt>當日場次</dt><dd>{row.unitCount} 場</dd></div>:null}{venue&&<div><dt>場館</dt><dd>{venue}</dd></div>}</dl><p className="result-pending">官方尚未公布分組，實際出賽時間待確認。本項自 {formatTaipei(row.startTimeTaipei)} 開始。</p>{names.length>4&&<details className="roster"><summary>查看完整報名名單（{names.length} 人）</summary><p>{names.join('、')}</p><p>報名名單不代表全部在該場出賽，實際名單以官方公布為準。</p></details>}</div></article>
}
function Card({row,conflict,pending,roster}:{row:Row;conflict:boolean;pending?:boolean;roster:Roster|null}){
 const {names}=displayNames(row,roster),status=statusLabel(row),score=row.result;
 const venue=venueLabel(row);
 return <article className="match"><div className="match-time"><time>{formatTaipei(row.startTimeTaipei)}</time><span>台灣時間</span></div><div className="match-main"><div className="match-top"><span className="sport">{sportLabel(row)}</span>{status&&<span className={'badge '+(isFinished(row)?'finished':'')}>{status}</span>}</div><h3>{names.length?names.join('、'):'中華隊'}</h3>{row.opponent&&<p className="opponent">對手：{row.opponent}</p>}<dl><div><dt>比賽項目</dt><dd>{row.event||'待確認'}</dd></div><div><dt>階段</dt><dd>{row.phase||'待確認'}</dd></div>{venue&&<div><dt>場館</dt><dd>{venue}</dd></div>}</dl>{score&&(score.tpe!==null||score.opponent!==null)?<div className="result"><span>官方已公布成績</span><strong>中華隊 <b>{score.tpe??'-'}</b></strong><strong>{row.opponent||'對手'} <b>{score.opponent??'-'}</b></strong></div>:<p className="result-pending">賽果尚無資料</p>}{conflict&&<p className="result-pending">官方來源時間不一致，請以最新公告為準。</p>}{pending&&<p className="result-pending">這場的參賽資訊待確認，尚未確定中華隊是否出賽。</p>}{row.athletesEn.length>0&&<details className="roster"><summary>查看英文名單</summary><p>{row.athletesEn.join('、')}</p></details>}{row.note&&<details className="roster"><summary>查看分組與備註</summary><p>{row.note}</p></details>}</div></article>
}
export default async function Page({searchParams}:{searchParams:Promise<{date?:string|string[]}>}){
 const query=await searchParams,today=taipeiDate(),requested=typeof query.date==='string'?query.date:today,invalid=!validDate(requested),date=invalid?today:requested;
 const [loaded,roster]=await Promise.all([loadSchedule(date),loadRoster()]);
 const data:Daily|null=loaded.kind==='ready'?loaded.data:null;
 const rows=data?taiwanRows(data):[],pending=data?pendingRows(data):[];
 const dayLabel=date===today?'今天':date===shiftDate(today,1)?'明天':date===shiftDate(today,-1)?'昨天':'所選日期';
 const dateTitle=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'long',day:'numeric',weekday:'long'}).format(new Date(date+'T04:00:00Z'));
 const incomplete=data?.sources?.results?.coverage?.fetchComplete===false;
 return <main><header><a href="/" className="brand"><span className="brand-mark">TPE</span><span>台灣亞運賽程<small>2026 愛知・名古屋</small></span></a><span className="zone">台灣時間 UTC+8</span></header><section className="intro"><p className="eyebrow">中華隊賽程</p><h1>{dayLabel}，為台灣加油。</h1><p>查出賽時間、對手與官方賽果。</p></section>
 <nav className="quick" aria-label="快速選擇日期">{[-1,0,1].map((offset)=><a key={offset} href={'/?date='+shiftDate(today,offset)} aria-current={date===shiftDate(today,offset)?'date':undefined}>{['昨天','今天','明天'][offset+1]}</a>)}</nav>
 <section className="date-panel" aria-label="日期查詢"><div className="date-title"><a className="arrow" aria-label="前一天" href={'/?date='+shiftDate(date,-1)}>‹</a><h2>{dateTitle}<small>{date.slice(0,4)}</small></h2><a className="arrow" aria-label="後一天" href={'/?date='+shiftDate(date,1)}>›</a></div><form action="/" method="get"><label htmlFor="date">選擇日期</label><input id="date" name="date" type="date" defaultValue={date} required/><button type="submit">查詢</button></form></section>
 {invalid&&<p className="notice" role="alert">日期格式不正確，已顯示今天。</p>}
 <section className="coverage" aria-label="資料範圍"><strong>只顯示中華隊相關賽事，未涵蓋全部亞運項目。</strong>{data&&<span>資料更新：{formatTaipei(data.generatedAt,true)}（台灣時間）・<a href={'/?date='+date}>重新讀取</a></span>}<span>賽果與狀態為上次同步的官方快照，尚待交叉查核。</span></section>
 {incomplete&&<div className="notice" role="alert">這一天的資料同步未完整完成，以下只顯示已取得的賽事。</div>}
 {pending.length>0&&<aside className="notice"><strong>部分參賽資訊待確認</strong><p>{pending.length} 場比賽尚無法確認參賽名單，不能據此判定中華隊未參賽。</p></aside>}
 <div className="list-heading"><h2>中華隊出賽</h2>{data&&<span>{rows.filter(r=>!isEntered(r)).length} 場確定{rows.filter(isEntered).length>0&&`・${rows.filter(isEntered).length} 項待確認`}</span>}</div>
 {loaded.kind==='error'?<section className="empty" role="alert"><h3>這一天的資料暫時無法讀取</h3><p>本機檔案格式有誤，請重新整理資料後再查看；這不代表沒有賽事。</p></section>
 :!data?<section className="empty"><span className="empty-symbol">—</span><h3>這一天的中華隊賽程資料尚未更新</h3><p>目前沒有可顯示的資料，並非中華隊沒有參賽。</p>{loaded.dates.length>0&&<div className="available"><span>已有資料的日期</span>{loaded.dates.map(d=><a key={d} href={'/?date='+d}>{d.slice(5).replace('-','/')}</a>)}</div>}</section>
 :rows.length===0&&pending.length===0?<section className="empty"><span className="empty-symbol">—</span>{(()=>{const state=emptyState(data);
  if(state==='confirmed-none')return <><h3>這一天中華隊沒有賽程</h3><p>已與官方資料核對。</p></>;
  if(state==='incomplete')return <><h3>目前查到 0 場，但這天的資料同步未完成</h3><p>不能據此判定當天沒有中華隊出賽。</p></>;
  return <><h3>這一天尚無已確認的中華隊賽事</h3><p>僅限已取得的項目，不能據此判定當天沒有中華隊出賽。</p></>;})()}</section>
 :<div className="matches">{rows.map(row=>isEntered(row)
   ?<EnteredCard key={'entered-'+row.disciplineCode+'-'+row.event+'-'+row.startTimeTaipei} row={row} roster={roster}/>
   :<Card key={row.sources.results?.id||row.sources.tpenoc?.sport+'-'+row.startTimeTaipei} row={row} conflict={hasTimeConflict(data,row)} roster={roster}/>)}{pending.map(row=><Card key={'tbd-'+(row.sources.results?.id||row.startTimeTaipei)} row={row} conflict={false} pending roster={roster}/>)}</div>}
 <footer><span>資料來源：亞運官方 Results ＋ 中華奧會每日賽程</span><span>本機 MVP・非官方網站・手動同步</span></footer></main>
}
