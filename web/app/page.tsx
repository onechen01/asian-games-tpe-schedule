import {loadSchedule,loadAthletes,loadDisplayNames} from '../lib/load';
import {taipeiDate,shiftDate,validDate,formatTaipei,sportLabel,displayNames,entryNames,emptyState,isEntered,
 statusLabel,isFinished,taiwanRows,pendingRows,hasTimeConflict,resultHeading} from '../lib/schedule';
import type {Daily,Row} from '../lib/schedule';
import {athleteLabel} from '../lib/athletes';
import type {AthleteMaster} from '../lib/athletes';
import {orgLabel,venueLabel} from '../lib/display-names';
import {loadBroadcasts,loadMedals,loadLaterRows} from '../lib/load';
import {advanceFor} from '../lib/progression';
import {medalOf,medalLabel,competitorMedal} from '../lib/medal-match';
import {broadcastsForRow,disciplineBroadcasts,feedLabel} from '../lib/broadcasts';
import type {Broadcast,Broadcasts} from '../lib/broadcasts';
import {eventLabel,phaseLabel} from '../lib/event-names';
import type {DisplayNames} from '../lib/display-names';
export const dynamic='force-dynamic';
export const revalidate=0;
// A registered-but-undrawn event is never shown as a confirmed start time: it names the event
// window, the number of units that day, and who is entered.
function EnteredCard({row,master,names:display,shows=[]}:{row:Row;master:AthleteMaster;names:DisplayNames;shows?:Broadcast[]}){
 const names=entryNames(row,master),venue=venueLabel(row.venueZh,row.venue,display);
 // The delegation is named through the same NOC mapping as any other country.
 const tpe=orgLabel('TPE','Chinese Taipei',display);
 return <article className="match"><div className="match-time"><time>{formatTaipei(row.startTimeTaipei)}</time><span>本項起始・台灣時間</span></div><div className="match-main"><div className="match-top"><span className="sport">{sportLabel(row)}</span><span className="badge">待確認</span></div><h3>{eventLabel(row.event)||'待確認'}</h3>{names.length>0&&<p className="opponent">{tpe}報名：{names.slice(0,4).join('、')}{names.length>4&&` 等 ${names.length} 人`}</p>}<dl><div><dt>比賽項目</dt><dd>{eventLabel(row.event)||'待確認'}</dd></div>{row.unitCount?<div><dt>當日場次</dt><dd>{row.unitCount} 場</dd></div>:null}{venue&&<div><dt>場館</dt><dd>{venue}</dd></div>}</dl><p className="result-pending">官方尚未公布台灣選手的分組與出賽順序。{formatTaipei(row.startTimeTaipei)} 是本項目的起始時間，不是台灣選手的出賽時間。</p><BroadcastList items={shows} heading="轉播（時間不等於台灣選手出賽時間）"/>{names.length>4&&<details className="roster"><summary>查看完整報名名單（{names.length} 人）</summary><p>{names.join('、')}</p><p>報名名單不代表全部在該場出賽，實際名單以官方公布為準。</p></details>}</div></article>
}
function Card({row,conflict,pending,master,names:display,shows=[],advance}:{row:Row;conflict:boolean;pending?:boolean;master:AthleteMaster;names:DisplayNames;shows?:Broadcast[];advance?:{stage:string;nextDate:string;nextTimeTaipei:string|null}|null}){
 const {names}=displayNames(row,master),status=statusLabel(row),score=row.result;
 // An individual event can carry several Chinese Taipei entrants; each keeps their own mark.
 const solo=row.tpeEntrants??[];
 // Only an official gold or bronze medal match decides this; everything else stays silent.
 const medal=row.resultScope==='aggregate'&&solo.length>1?null:medalOf(row);
 const venue=venueLabel(row.venueZh,row.venue,display);
 const opponent=orgLabel(row.opponentCode,row.opponent,display);
 const tpe=orgLabel('TPE','Chinese Taipei',display);
 return <article className="match"><div className="match-time"><time>{formatTaipei(row.startTimeTaipei)}</time><span>台灣時間</span></div><div className="match-main"><div className="match-top"><span className="sport">{sportLabel(row)}</span>{status&&<span className={'badge '+(isFinished(row)?'finished':'')}>{status}</span>}</div><h3>{names.length?names.join('、'):tpe}</h3>{opponent&&<p className="opponent">對手：{opponent}</p>}<dl><div><dt>比賽項目</dt><dd>{eventLabel(row.event)||'待確認'}</dd></div><div><dt>階段</dt><dd>{phaseLabel(row.phase,row.event)||'待確認'}</dd></div>{venue&&<div><dt>場館</dt><dd>{venue}</dd></div>}</dl>{solo.length>1?<div className="result solo"><span>{resultHeading(row,true)}</span>{solo.map(e=>{const ownMedal=competitorMedal(row.status,e.medal);const athlete=athleteLabel(e.name??'',master,{reg:e.registration,discipline:row.disciplineCode});const key=e.registration??e.name;return row.resultScope==='aggregate'?<div className="solo-entrant" key={key}><strong>{athlete} <b>{e.result??'尚無成績'}</b>{e.rank?<i>第 {e.rank} 名</i>:null}</strong>{ownMedal&&<p className="medal-result">{medalLabel(ownMedal)}</p>}</div>:<strong key={key}>{athlete} <b>{e.result??'尚無成績'}</b>{e.rank?<i>第 {e.rank} 名</i>:null}{ownMedal?<i>{medalLabel(ownMedal)}</i>:null}</strong>;})}</div>
  :score&&(score.tpe!==null||score.opponent!==null)?<div className="result"><span>{resultHeading(row)}</span><strong>{tpe} <b>{score.tpe??'-'}</b></strong><strong>{opponent||'對手'} <b>{score.opponent??'-'}</b></strong></div>:<p className="result-pending">賽果尚無資料</p>}{medal&&<p className="medal-result">{medalLabel(medal)}</p>}{advance&&<p className="advance">✓ 晉級{advance.stage}{advance.nextTimeTaipei?`・下一場 ${advance.nextDate===row.date?'':advance.nextDate.slice(5).replace('-','/')+' '}${formatTaipei(advance.nextTimeTaipei)}`:''}</p>}{conflict&&<p className="result-pending">官方來源時間不一致，請以最新公告為準。</p>}{pending&&<p className="result-pending">這場的參賽資訊待確認，尚未確定台灣是否出賽。</p>}<BroadcastList items={shows}/>{row.athletesEn.length>0&&<details className="roster"><summary>查看英文名單</summary><p>{row.athletesEn.join('、')}</p></details>}{row.note&&<details className="roster"><summary>查看分組與備註</summary><p>{row.note}</p></details>}</div></article>
}
// Any provider, any number of them: the list never assumes a single broadcaster, and a
// broadcast time is always labelled as such so it is not read as the competition start.
function BroadcastList({items,heading='轉播'}:{items:Broadcast[];heading?:string}){
 if(!items.length)return null;
 return <div className="broadcast"><span>{heading}（非比賽時間）</span><ul>{items.map(b=>
  <li key={b.providerId+b.broadcastStartTimeTaipei+(b.title??'')}><b>{formatTaipei(b.broadcastStartTimeTaipei)}{b.broadcastEndTimeTaipei?`–${formatTaipei(b.broadcastEndTimeTaipei)}`:''}</b>
   <span className="provider">{b.channelName||b.providerName}</span>{feedLabel(b.feed)&&<i>{feedLabel(b.feed)}</i>}{b.isLive===false&&<i>D-LIVE</i>}
   {b.title&&<span className="programme">{b.title}</span>}</li>)}</ul></div>;
}

export default async function Page({searchParams}:{searchParams:Promise<{date?:string|string[]}>}){
 const query=await searchParams,today=taipeiDate(),requested=typeof query.date==='string'?query.date:today,invalid=!validDate(requested),date=invalid?today:requested;
 const [loaded,master,display,broadcasts,medals]=await Promise.all([loadSchedule(date),loadAthletes(),loadDisplayNames(),loadBroadcasts(),loadMedals()]);
 const data:Daily|null=loaded.kind==='ready'?loaded.data:null;
 const rows=data?taiwanRows(data):[],pending=data?pendingRows(data):[];
 const later=data?await loadLaterRows(date,loaded.kind==='ready'?loaded.dates:[]):[];
 const dayLabel=date===today?'今天':date===shiftDate(today,1)?'明天':date===shiftDate(today,-1)?'昨天':'所選日期';
 const dateTitle=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'long',day:'numeric',weekday:'long'}).format(new Date(date+'T04:00:00Z'));
 const incomplete=data?.sources?.results?.coverage?.fetchComplete===false;
 return <main><header><a href="/" className="brand"><span className="brand-mark">TPE</span><span>台灣亞運賽程<small>2026 愛知・名古屋</small></span></a><span className="zone">台灣時間 UTC+8</span></header><section className="intro"><p className="eyebrow">台灣賽程</p><h1>{dayLabel}，為台灣加油。</h1><p>查出賽時間、對手與官方賽果。</p></section>
 {medals&&<section className="medals" aria-label="台灣獎牌"><h2>台灣獎牌</h2>
  <p><span>🥇 {medals.gold}</span><span>🥈 {medals.silver}</span><span>🥉 {medals.bronze}</span></p>
  <small>共 {medals.total} 面・官方獎牌榜</small></section>}
 <nav className="quick" aria-label="快速選擇日期">{[-1,0,1].map((offset)=><a key={offset} href={'/?date='+shiftDate(today,offset)} aria-current={date===shiftDate(today,offset)?'date':undefined}>{['昨天','今天','明天'][offset+1]}</a>)}</nav>
 <section className="date-panel" aria-label="日期查詢"><div className="date-title"><a className="arrow" aria-label="前一天" href={'/?date='+shiftDate(date,-1)}>‹</a><h2>{dateTitle}<small>{date.slice(0,4)}</small></h2><a className="arrow" aria-label="後一天" href={'/?date='+shiftDate(date,1)}>›</a></div><form action="/" method="get"><label htmlFor="date">選擇日期</label><input id="date" name="date" type="date" defaultValue={date} required/><button type="submit">查詢</button></form></section>
 {invalid&&<p className="notice" role="alert">日期格式不正確，已顯示今天。</p>}
 <section className="coverage" aria-label="資料範圍"><strong>只顯示台灣相關賽事，未涵蓋全部亞運項目。</strong>{data&&<span>資料更新：{formatTaipei(data.generatedAt,true)}（台灣時間）・<a href={'/?date='+date}>重新讀取</a></span>}<span>賽果與狀態為上次同步的官方快照，尚待交叉查核。</span></section>
 {incomplete&&<div className="notice" role="alert">這一天的資料同步未完整完成，以下只顯示已取得的賽事。</div>}
 {pending.length>0&&<aside className="notice"><strong>部分參賽資訊待確認</strong><p>{pending.length} 場比賽尚無法確認參賽名單，不能據此判定台灣未參賽。</p></aside>}
 <div className="list-heading"><h2>台灣出賽</h2>{data&&<span>{rows.filter(r=>!isEntered(r)).length} 場確定{rows.filter(isEntered).length>0&&`・${rows.filter(isEntered).length} 項待確認`}</span>}</div>
 {loaded.kind==='error'?<section className="empty" role="alert"><h3>這一天的資料暫時無法讀取</h3><p>本機檔案格式有誤，請重新整理資料後再查看；這不代表沒有賽事。</p></section>
 :!data?<section className="empty"><span className="empty-symbol">—</span><h3>這一天的台灣賽程資料尚未更新</h3><p>目前沒有可顯示的資料，並非台灣沒有參賽。</p>{loaded.dates.length>0&&<div className="available"><span>已有資料的日期</span>{loaded.dates.map(d=><a key={d} href={'/?date='+d}>{d.slice(5).replace('-','/')}</a>)}</div>}</section>
 :rows.length===0&&pending.length===0?<section className="empty"><span className="empty-symbol">—</span>{(()=>{const state=emptyState(data);
  if(state==='confirmed-none')return <><h3>這一天台灣沒有賽程</h3><p>已與官方資料核對。</p></>;
  if(state==='incomplete')return <><h3>目前查到 0 場，但這天的資料同步未完成</h3><p>不能據此判定當天沒有台灣出賽。</p></>;
  return <><h3>這一天尚無已確認的台灣賽事</h3><p>僅限已取得的項目，不能據此判定當天沒有台灣出賽。</p></>;})()}</section>
 :<div className="matches">{rows.map(row=>isEntered(row)
   ?<EnteredCard key={'entered-'+row.disciplineCode+'-'+row.event+'-'+row.startTimeTaipei} row={row} master={master} names={display} shows={broadcastsForRow(broadcasts,date,row)}/>
   :<Card key={row.sources.results?.id||row.sources.tpenoc?.sport+'-'+row.startTimeTaipei} row={row} conflict={hasTimeConflict(data,row)} master={master} names={display} shows={broadcastsForRow(broadcasts,date,row)} advance={advanceFor({...row,date},later)}/>)}{pending.map(row=><Card key={'tbd-'+(row.sources.results?.id||row.startTimeTaipei)} row={row} conflict={false} pending master={master} names={display} shows={broadcastsForRow(broadcasts,date,row)}/>)}</div>}
 {(()=>{const groups=[...disciplineBroadcasts(broadcasts,date,rows.concat(pending)).entries()];
  if(!groups.length)return null;
  // Programmes that cover a whole session are listed once per sport, never copied onto cards.
  return <section className="broadcast-block" aria-label="轉播資訊"><h2>轉播資訊</h2>
   <p>以下節目無法對應到單一場次，僅代表該運動的轉播時段；比賽時間一律以上方各場次為準。</p>
   {groups.map(([code,items])=>{const label=rows.concat(pending).find(r=>r.disciplineCode===code);
    return <div key={code} className="broadcast-sport"><h3>{label?sportLabel(label):code}</h3>
     <BroadcastList items={items} heading="轉播時段"/></div>;})}</section>;})()}
 <footer>
  <p className="source">資料來源：亞運官方 Results ＋ 中華奧會每日賽程 ＋ 各轉播平台公告</p>
  <div className="legal">
   <p><b>免責聲明</b>　本網站為個人製作的非官方亞運賽程整理工具，賽程、比賽時間、參賽名單、比賽結果、獎牌及轉播資訊可能因大會或轉播單位調整而變動，實際資訊請以官方最新公告為準。</p>
   <p><b>版權聲明</b>　本網站之程式、介面設計與原創內容 © 2026 Cony。賽事名稱、標誌、比賽資料及其他第三方內容之權利均屬其原權利人所有。本網站與愛知・名古屋2026亞洲運動會主辦單位及相關官方機構無隸屬或合作關係。</p>
  </div>
  <p className="author">製作：Cony</p>
 </footer></main>
}
