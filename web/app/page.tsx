import {loadSchedule,loadAthletes,loadDisplayNames,loadSportOptions} from '../lib/load';
import {taipeiDate,formatTaipei,matchTimeLabel,sportLabel,displayNames,entryNames,emptyState,isEntered,
 statusLabel,isFinished,taiwanRows,pendingRows,hasTimeConflict,resultHeading} from '../lib/schedule';
import type {CourtSessionChain,Daily,Row,TimeNote} from '../lib/schedule';
import {athleteLabel} from '../lib/athletes';
import type {AthleteMaster} from '../lib/athletes';
import {orgLabel,venueLabel} from '../lib/display-names';
import {loadBroadcasts,loadMedals,loadMedalLedger,loadLaterRows} from '../lib/load';
import {medalGroups,rankLabel,pendingNoticeText,awardWho,awardSport,awardEvent} from '../lib/medal-board';
import type {MedalLedger} from '../lib/medal-awards';
import type {Medals} from '../lib/medals';
import {advanceFor} from '../lib/progression';
import {medalOf,medalLabel,competitorMedal} from '../lib/medal-match';
import {broadcastsForRow,broadcastsForSpecialEvent,disciplineBroadcasts,feedLabel} from '../lib/broadcasts';
import type {Broadcast,Broadcasts} from '../lib/broadcasts';
import type {SpecialEvent} from '../../src/special-events';
import {eventLabel,phaseLabel} from '../lib/event-names';
import type {DisplayNames} from '../lib/display-names';
import ScheduleExplorer from './ScheduleExplorer';
import {parseFilterQuery,scheduleUrl} from '../lib/schedule-filter';
import type {ScheduleItemMeta} from '../lib/schedule-filter';
import {GAMES_FIRST,GAMES_LAST,relativeDateLinks,resolveScheduleDate,scheduleNavigation} from '../lib/games-date';
export const dynamic='force-dynamic';
export const revalidate=0;
// A registered-but-undrawn event is never shown as a confirmed start time: it names the event
// window, the number of units that day, and who is entered.
function EnteredCard({row,master,names:display,shows=[]}:{row:Row;master:AthleteMaster;names:DisplayNames;shows?:Broadcast[]}){
 const names=entryNames(row,master),venue=venueLabel(row.venueZh,row.venue,display);
 // The delegation is named through the same NOC mapping as any other country.
 const tpe=orgLabel('TPE','Chinese Taipei',display);
 return <article className="match"><div className="match-time"><time>{matchTimeLabel(row)}</time><span>本項起始・台灣時間</span></div><div className="match-main"><div className="match-top"><span className="sport">{sportLabel(row)}</span><span className="badge">待確認</span></div><h3>{eventLabel(row.event)||'待確認'}</h3>{names.length>0&&<p className="opponent">{tpe}報名：{names.slice(0,4).join('、')}{names.length>4&&` 等 ${names.length} 人`}</p>}<dl><div><dt>比賽項目</dt><dd>{eventLabel(row.event)||'待確認'}</dd></div>{row.unitCount?<div><dt>當日場次</dt><dd>{row.unitCount} 場</dd></div>:null}{venue&&<div><dt>場館</dt><dd>{venue}</dd></div>}</dl><p className="result-pending">官方尚未公布台灣選手的分組與出賽順序。{matchTimeLabel(row)} 是本項目的起始時間，不是台灣選手的出賽時間。</p><BroadcastList items={shows} heading="轉播（時間不等於台灣選手出賽時間）"/>{names.length>4&&<details className="roster"><summary>查看完整報名名單（{names.length} 人）</summary><p>{names.join('、')}</p><p>報名名單不代表全部在該場出賽，實際名單以官方公布為準。</p></details>}</div></article>
}
function Card({row,conflict,pending,master,names:display,shows=[],advance,chains=[]}:{row:Row;conflict:boolean;pending?:boolean;master:AthleteMaster;names:DisplayNames;shows?:Broadcast[];chains?:CourtSessionChain[];advance?:{stage:string;nextDate:string;nextTimeTaipei:string|null;nextTimeNote?:TimeNote|null}|null}){
 const {names}=displayNames(row,master),status=statusLabel(row),score=row.result;
 // An individual event can carry several Chinese Taipei entrants; each keeps their own mark.
 const solo=row.tpeEntrants??[];
 // Only an official gold or bronze medal match decides this; everything else stays silent.
 const medal=row.resultScope==='aggregate'&&solo.length>1?null:medalOf(row);
 const venue=venueLabel(row.venueZh,row.venue,display);
 const opponent=orgLabel(row.opponentCode,row.opponent,display);
 const tpe=orgLabel('TPE','Chinese Taipei',display);
 const timeLabel=matchTimeLabel(row,chains);
 return <article className="match"><div className="match-time"><time className={timeLabel.includes('\n')?'sequence':undefined}>{timeLabel}</time><span>台灣時間</span></div><div className="match-main"><div className="match-top"><span className="sport">{sportLabel(row)}</span>{status&&<span className={'badge '+(isFinished(row)?'finished':'')}>{status}</span>}</div><h3>{names.length?names.join('、'):tpe}</h3>{opponent&&<p className="opponent">對手：{opponent}</p>}<dl><div><dt>比賽項目</dt><dd>{eventLabel(row.event)||'待確認'}</dd></div><div><dt>階段</dt><dd>{phaseLabel(row.phase,row.event)||'待確認'}</dd></div>{venue&&<div><dt>場館</dt><dd>{venue}</dd></div>}</dl>{solo.length>1?<div className="result solo"><span>{resultHeading(row,true)}</span>{solo.map(e=>{const ownMedal=competitorMedal(row.status,e.medal);const athlete=athleteLabel(e.name??'',master,{reg:e.registration,discipline:row.disciplineCode});const key=e.registration??e.name;return row.resultScope==='aggregate'?<div className="solo-entrant" key={key}><strong>{athlete} <b>{e.result??'尚無成績'}</b>{e.rank?<i>第 {e.rank} 名</i>:null}</strong>{ownMedal&&<p className="medal-result">{medalLabel(ownMedal)}</p>}</div>:<strong key={key}>{athlete} <b>{e.result??'尚無成績'}</b>{e.rank?<i>第 {e.rank} 名</i>:null}{ownMedal?<i>{medalLabel(ownMedal)}</i>:null}</strong>;})}</div>
  :score&&(score.tpe!==null||score.opponent!==null)?<div className="result"><span>{resultHeading(row)}</span><strong>{tpe} <b>{score.tpe??'-'}</b></strong><strong>{opponent||'對手'} <b>{score.opponent??'-'}</b></strong></div>:<p className="result-pending">賽果尚無資料</p>}{medal&&<p className="medal-result">{medalLabel(medal)}</p>}{advance&&<p className="advance">✓ 晉級{advance.stage}{advance.nextTimeTaipei?`・下一場 ${advance.nextDate===row.date?'':advance.nextDate.slice(5).replace('-','/')+' '}${matchTimeLabel({startTimeTaipei:advance.nextTimeTaipei,timeNote:advance.nextTimeNote})}`:''}</p>}{conflict&&<p className="result-pending">官方來源時間不一致，請以最新公告為準。</p>}{pending&&<p className="result-pending">這場的參賽資訊待確認，尚未確定台灣是否出賽。</p>}<BroadcastList items={shows}/>{row.athletesEn.length>0&&<details className="roster"><summary>查看英文名單</summary><p>{row.athletesEn.join('、')}</p></details>}{row.note&&<details className="roster"><summary>查看分組與備註</summary><p>{row.note}</p></details>}</div></article>
}
function CeremonyCard({event,shows=[]}:{event:SpecialEvent;shows?:Broadcast[]}){
 return <article className="match ceremony"><div className="match-time"><time>{formatTaipei(event.startTimeTaipei)}</time><span>官方典禮時間・台灣時間</span></div><div className="match-main"><div className="match-top"><span className="sport">典禮</span></div><h3>{event.titleZh}</h3><BroadcastList items={shows} qualifier="非官方典禮時間"/></div></article>;
}
// The official totals and rank stay visible; the confirmed per-medal detail behind them opens on
// demand. A native <details> keeps this a server component with no client JavaScript, and the
// browser owns the expanded state, so assistive technology is told the truth without a hand-written
// aria-expanded that a static page could never keep in sync.
function MedalBoard({medals,ledger,master}:{medals:Medals;ledger:MedalLedger|null;master:AthleteMaster}){
 const groups=medalGroups(ledger),rank=rankLabel(medals);
 const total=groups.reduce((n,g)=>n+g.awards.length,0);
 const pending=pendingNoticeText(ledger,total);
 return <section className="medals" aria-label="台灣獎牌">
  <div className="medals-head"><h2>台灣獎牌</h2>{rank&&<span className="medals-rank">{rank}</span>}</div>
  <p><span>🥇 {medals.gold}</span><span>🥈 {medals.silver}</span><span>🥉 {medals.bronze}</span></p>
  <small>共 {medals.total} 面・官方獎牌榜</small>
  {groups.length>0&&<details className="medal-detail">
   <summary><span className="when-closed">查看獎牌明細（{total} 面）</span><span className="when-open">收起獎牌明細</span></summary>
   {pending&&<p className="medal-pending"><span aria-hidden="true">⚠ </span>{pending}</p>}
   {groups.map(group=><div key={group.medal} className="medal-group">
    <h3>{group.label}</h3>
    <ul>{group.awards.map(award=>{const who=awardWho(award,master);return <li key={award.awardId}>
     <strong>{who.name}</strong>
     <span className="medal-sport">{awardSport(award)}</span>
     <span className="medal-event">{awardEvent(award)||'待確認'}</span>
     {who.roster.length>0&&<span className="medal-roster">{who.roster.join('、')}</span>}
    </li>;})}</ul>
   </div>)}
  </details>}
 </section>;
}
// Any provider, any number of them: the list never assumes a single broadcaster, and a
// broadcast time is always labelled as such so it is not read as the competition start.
function BroadcastList({items,heading='轉播',qualifier='非比賽時間'}:{items:Broadcast[];heading?:string;qualifier?:string}){
 if(!items.length)return null;
 return <div className="broadcast"><span>{heading}（{qualifier}）</span><ul>{items.map(b=>
  <li key={b.providerId+b.broadcastStartTimeTaipei+(b.title??'')}><b>{formatTaipei(b.broadcastStartTimeTaipei)}{b.broadcastEndTimeTaipei?`–${formatTaipei(b.broadcastEndTimeTaipei)}`:''}</b>
   <span className="provider">{b.channelName||b.providerName}</span>{feedLabel(b.feed)&&<i>{feedLabel(b.feed)}</i>}{b.isLive===false&&<i>D-LIVE</i>}
   {b.title&&<span className="programme">{b.title}</span>}</li>)}</ul></div>;
}

type PageQuery={date?:string|string[];sports?:string|string[];status?:string|string[];broadcast?:string|string[];jump?:string|string[]};

export default async function Page({searchParams}:{searchParams:Promise<PageQuery>}){
 const query=await searchParams,today=taipeiDate(),requested=typeof query.date==='string'?query.date:undefined;
 const {date,reason:dateResolution}=resolveScheduleDate(requested,today);
 const [loaded,master,display,broadcasts,medals,ledger,sportOptions]=await Promise.all([loadSchedule(date),loadAthletes(),loadDisplayNames(),loadBroadcasts(),loadMedals(),loadMedalLedger(),loadSportOptions()]);
 const data:Daily|null=loaded.kind==='ready'?loaded.data:null;
 const rows=data?taiwanRows(data):[],pending=data?pendingRows(data):[];
 const specialEvents=data?.specialEvents??[];
 const later=data?await loadLaterRows(date,loaded.kind==='ready'?loaded.dates:[]):[];
 const filters=parseFilterQuery(query,sportOptions.map(option=>option.code));
 const jumpRequested=(Array.isArray(query.jump)?query.jump[0]:query.jump)==='1';
 const navigation=scheduleNavigation(date),quickDates=relativeDateLinks(today);
 const dateTitle=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'long',day:'numeric',weekday:'long'}).format(new Date(date+'T04:00:00Z'));
 const incomplete=data?.sources?.results?.coverage?.fetchComplete===false;
 const itemRows=[...rows.map(row=>({row,pending:false})),...pending.map(row=>({row,pending:true}))];
 const competitionRendered=itemRows.map(({row,pending:pendingCard},index)=>{
  const shows=data?broadcastsForRow(broadcasts,date,row,data.sessionChains):[];
  const id=row.sources.results?.id??`schedule-${date}-${row.disciplineCode??'unknown'}-${row.event??'event'}-${row.startTimeTaipei??index}-${index}`;
  const item:ScheduleItemMeta={id,disciplineCode:row.disciplineCode,sportLabel:sportLabel(row),status:row.status,
   hasBroadcast:shows.length>0,timeNoteCode:row.timeNote?.code??null};
  const card=isEntered(row)
   ?<EnteredCard key={id} row={row} master={master} names={display} shows={shows}/>
   :<Card key={id} row={row} conflict={pendingCard?false:!!data&&hasTimeConflict(data,row)} pending={pendingCard||undefined}
     master={master} names={display} shows={shows} chains={data?.sessionChains}
     advance={!pendingCard?advanceFor({...row,date},later):undefined}/>;
  return {item,card,sortTime:row.startTimeTaipei??''};
 });
 const ceremonyRendered=specialEvents.map(event=>{
  const shows=broadcastsForSpecialEvent(broadcasts,event);
  const item:ScheduleItemMeta={id:event.id,disciplineCode:null,sportLabel:'典禮',status:null,
   hasBroadcast:shows.length>0,timeNoteCode:null};
  return {item,card:<CeremonyCard key={event.id} event={event} shows={shows}/>,sortTime:event.startTimeTaipei};
 });
 const rendered=[...competitionRendered,...ceremonyRendered]
  .sort((a,b)=>a.sortTime.localeCompare(b.sortTime)||a.item.id.localeCompare(b.item.id));
 const items=rendered.map(entry=>entry.item),cards=rendered.map(entry=>entry.card);
 const baseSummary=data?`${rows.filter(row=>!isEntered(row)).length} 場確定${rows.filter(isEntered).length>0?`・${rows.filter(isEntered).length} 項待確認`:''}${specialEvents.length?`・${specialEvents.length} 場典禮`:''}`:null;
 const emptyContent=loaded.kind==='error'?<section className="empty" role="alert"><h3>這一天的資料暫時無法讀取</h3><p>本機檔案格式有誤，請重新整理資料後再查看；這不代表沒有賽事。</p></section>
  :!data?<section className="empty"><span className="empty-symbol">—</span><h3>這一天的台灣賽程資料尚未更新</h3><p>目前沒有可顯示的資料，並非台灣沒有參賽。</p>{loaded.dates.length>0&&<div className="available"><span>已有資料的日期</span>{loaded.dates.map(day=><a key={day} href={scheduleUrl(day,filters)}>{day.slice(5).replace('-','/')}</a>)}</div>}</section>
  :<section className="empty"><span className="empty-symbol">—</span>{(()=>{const state=emptyState(data);
   if(state==='confirmed-none')return <><h3>這一天台灣沒有賽程</h3><p>已與官方資料核對。</p></>;
   if(state==='incomplete')return <><h3>目前查到 0 場，但這天的資料同步未完成</h3><p>不能據此判定當天沒有台灣出賽。</p></>;
   return <><h3>這一天尚無已確認的台灣賽事</h3><p>僅限已取得的項目，不能據此判定當天沒有台灣出賽。</p></>;})()}</section>;
 return <main><header><a href="/" className="brand"><span className="brand-mark">TPE</span><span>台灣亞運賽程<small>2026 愛知・名古屋</small></span></a><span className="zone">台灣時間 UTC+8</span></header><section className="intro"><p className="eyebrow">台灣賽程</p><h1>今天，為台灣加油。</h1><p>查出賽時間、對手與官方賽果。</p></section>
 {medals&&<MedalBoard medals={medals} ledger={ledger} master={master}/>}
 {quickDates.length>0&&<nav className="quick" aria-label="快速選擇日期">{quickDates.map(item=><a key={item.date} href={scheduleUrl(item.date,filters)} aria-current={date===item.date?'date':undefined}>{item.label}</a>)}</nav>}
 <section className="date-panel" aria-label="日期查詢"><div className="date-title">{navigation.previous&&<a className="arrow" aria-label="前一天" href={scheduleUrl(navigation.previous,filters)}>‹</a>}<h2>{dateTitle}<small>{date.slice(0,4)}</small></h2>{navigation.next&&<a className="arrow" aria-label="後一天" href={scheduleUrl(navigation.next,filters)}>›</a>}</div><form action="/" method="get"><label htmlFor="date">選擇日期</label><input id="date" name="date" type="date" min={GAMES_FIRST} max={GAMES_LAST} defaultValue={date} required/>{filters.sports.length>0&&<input type="hidden" name="sports" value={filters.sports.join(',')}/>} {filters.statuses.length>0&&<input type="hidden" name="status" value={filters.statuses.join(',')}/>} {filters.broadcast&&<input type="hidden" name="broadcast" value="1"/>}<button type="submit">查詢</button></form></section>
 {dateResolution&&<p className="notice" role="alert">{dateResolution==='invalid'?'日期格式不正確':dateResolution==='before-games'?'指定日期早於賽期':'指定日期晚於賽期'}，已顯示{date===GAMES_FIRST?'第一個比賽日':'最後比賽日'}。</p>}
 <section className="coverage" aria-label="資料範圍"><strong>比賽只顯示台灣相關賽事，未涵蓋全部亞運項目；另列開閉幕典禮。</strong>{data&&<span>資料更新：{formatTaipei(data.generatedAt,true)}（台灣時間）・<a href={scheduleUrl(date,filters)}>重新讀取</a></span>}<span>賽果與狀態為上次同步的官方快照，尚待交叉查核。</span></section>
 {incomplete&&<div className="notice" role="alert">這一天的資料同步未完整完成，以下只顯示已取得的賽事。</div>}
 {pending.length>0&&<aside className="notice"><strong>部分參賽資訊待確認</strong><p>{pending.length} 場比賽尚無法確認參賽名單，不能據此判定台灣未參賽。</p></aside>}
 <ScheduleExplorer date={date} sports={sportOptions} initialFilters={filters} jumpRequested={jumpRequested}
  items={items} baseSummary={baseSummary} emptyContent={emptyContent}
  listHeading={specialEvents.length?'台灣賽程與大會典禮':'台灣出賽'}>{cards}</ScheduleExplorer>
 {(()=>{const groups=[...disciplineBroadcasts(broadcasts,date,rows.concat(pending),data?.sessionChains).entries()];
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
