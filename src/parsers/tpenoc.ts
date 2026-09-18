// Chinese Taipei Olympic Committee daily schedule PDF (2026 Asian Games).
// Input is the positioned text of a text-layer PDF (see scripts/extract-pdf-fragments.py).
// Columns drift, empty cells vanish and cells wrap over several lines, so rows are rebuilt
// from x bands rather than from flat text. Anything that cannot be resolved is reported,
// never guessed.
export type Fragment = { page?:number; x:number; y:number; text:string };
export type Match = {
  sport:string; timeJst:string; timeTaipei:string;
  startTimeJst:string; startTimeTaipei:string;
  event:string; athletes:string[]; opponent:string | null;
  result:string | null; venue:string | null; rank:string | null;
  note:string | null; noteLines:string[];
};
export type TpenocDocument = {
  scheduleDate:string; updatedAtJst:string | null; sourceFileName:string;
  matches:Match[]; unresolved:{ reason:string; text:string }[];
};

// Column bands measured on the 2026-09-18 sheet; cells sit well inside them.
const COLUMN = { sport:[0,100], time:[100,200], event:[200,340],
  athletes:[340,520], opponent:[520,700], venue:[700,850], note:[850,1100] } as const;
type Column = keyof typeof COLUMN;
const columnOf = (x:number): Column | null =>
  (Object.keys(COLUMN) as Column[]).find(c=>x >= COLUMN[c][0] && x < COLUMN[c][1]) ?? null;

const TIME = /^(\d{1,2}):(\d{2})$/;
// This sheet's y grows downward, so document order is ascending y.
const byReadingOrder = (a:Fragment,b:Fragment)=>a.y-b.y || a.x-b.x;

function lines(fragments: Fragment[]): Fragment[][] {
  const grouped: Fragment[][] = [];
  for (const fragment of [...fragments].sort(byReadingOrder)) {
    const last = grouped.at(-1);
    if (last && Math.abs(last[0].y - fragment.y) < 3) last.push(fragment);
    else grouped.push([fragment]);
  }
  for (const line of grouped) line.sort((a,b)=>a.x-b.x);
  return grouped;
}

function jstToTaipei(date:string, time:string): { jst:string; taipei:string; hhmm:string } {
  const [,hour,minute] = TIME.exec(time) ?? [];
  const jst = `${date}T${hour!.padStart(2,'0')}:${minute}:00+09:00`;
  const moment = new Date(jst);
  if (!Number.isFinite(moment.getTime())) throw new Error(`無法解析日本時間：${date} ${time}`);
  // Shift the instant into +08:00 before formatting; toISOString() prints UTC.
  const taipei = new Date(moment.getTime() + 8*60*60*1000);
  const iso = taipei.toISOString().slice(0,19);
  return { jst, taipei:`${iso}+08:00`, hhmm:iso.slice(11,16) };
}

export function parseTpenoc(fragments: Fragment[], sourceFileName: string): TpenocDocument {
  const rows = lines(fragments);
  const flat = rows.flat().map(f=>f.text.trim()).join(' ');
  const date = /日期[：:]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(flat);
  if (!date) throw new Error('找不到文件日期（日期：YYYY/M/D），停止解析');
  const scheduleDate = `${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}`;
  const updated = /更新時間[：:]\s*日本當地時間\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(上午|下午)(\d{1,2}):(\d{2})/.exec(flat);
  let updatedAtJst: string | null = null;
  if (updated) {
    let hour = Number(updated[5]) % 12;
    if (updated[4] === '下午') hour += 12;
    updatedAtJst = `${updated[1]}-${updated[2].padStart(2,'0')}-${updated[3].padStart(2,'0')}`
      + `T${String(hour).padStart(2,'0')}:${updated[6]}:00+09:00`;
  }

  // A row is anchored by its time cell; every other line belongs to the nearest anchor.
  const anchors = rows.filter(line=>line.some(f=>columnOf(f.x) === 'time' && TIME.test(f.text.trim())));
  if (!anchors.length) throw new Error('找不到任何含時間的賽事列，停止解析');
  // Everything down to the column headers is the title block, not schedule data. A cell can
  // start slightly above its own time cell, so the header row -- not the first anchor -- is
  // the cut-off.
  const headerLabels = ['運動種類','當地時間','(姓名)','對手國','備註'];
  const headerBottom = Math.max(...rows
    .filter(line=>line[0].y < anchors[0][0].y && headerLabels.some(label=>line.map(f=>f.text).join('').includes(label)))
    .map(line=>line[0].y), 0);
  const cells = anchors.map(()=>({} as Record<Column,string[]>));
  const unresolved: { reason:string; text:string }[] = [];
  const anchorY = anchors.map(line=>line[0].y);
  for (const line of rows) {
    const index = anchorY.reduce((best,y,i)=>Math.abs(y-line[0].y) < Math.abs(anchorY[best]-line[0].y) ? i : best, 0);
    const isAnchor = anchors.includes(line);
    for (const fragment of line) {
      const text = fragment.text.trim();
      if (!text) continue;
      const column = columnOf(fragment.x);
      if (!column) { unresolved.push({ reason:'欄位位置超出已知範圍', text }); continue; }
      if (!isAnchor && line[0].y <= headerBottom + 3) continue;
      const bucket = (cells[index][column] ??= []);
      // One run can carry several cells separated by a single space, e.g.
      // "寮國 名古屋市東山公園網球中心 C組：蒙古、印度、寮國". Athlete cells never merge
      // this way (names are '/'-separated and may contain spaces), so they are kept whole.
      if (column !== 'athletes' && /\s/.test(text) && !text.includes('/')) {
        const pieces = text.split(/\s+/).filter(Boolean);
        const order: Column[] = ['opponent','venue','note'];
        const start = order.indexOf(column);
        if (start >= 0 && pieces.length > 1 && start + pieces.length <= order.length) {
          pieces.forEach((piece,offset)=>((cells[index][order[start+offset]] ??= []).push(piece)));
          continue;
        }
      }
      bucket.push(text);
    }
  }

  const matches = anchors.map((line,index)=>{
    const cell = cells[index];
    const one = (column:Column)=>cell[column]?.length ? cell[column].join('') : null;
    const time = line.find(f=>columnOf(f.x) === 'time' && TIME.test(f.text.trim()))!.text.trim();
    const sport = one('sport'), event = one('event');
    const athletes = (cell.athletes ?? []).join('').split('/').map(a=>a.trim()).filter(Boolean);
    const { jst, taipei, hhmm } = jstToTaipei(scheduleDate, time);
    const noteLines = cell.note ?? [];
    if (!sport || !event || !athletes.length) {
      unresolved.push({ reason:'缺少運動、項目或選手，未納入賽事', text:line.map(f=>f.text.trim()).join(' | ') });
    }
    return { sport:sport ?? '', timeJst:time, timeTaipei:hhmm, startTimeJst:jst, startTimeTaipei:taipei,
      event:event ?? '', athletes, opponent:one('opponent'), venue:one('venue'),
      // 成績 and 名次 are blank on every observed row, so their x bands are unknown and the
      // fields stay null instead of being guessed from a neighbouring column.
      result:null, rank:null,
      // Wrapped text and a separate remark look identical here, so the lines are kept as-is.
      note:noteLines.length ? noteLines.join('\n') : null, noteLines };
  }).filter(m=>m.sport && m.event && m.athletes.length);

  return { scheduleDate, updatedAtJst, sourceFileName, matches, unresolved };
}
