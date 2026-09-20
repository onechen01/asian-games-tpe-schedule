// npm run merge:daily -- 2026-09-18
// Builds the canonical daily view from the two normalized sources already on disk.
// Reads only; neither the Results pipeline nor the committee parser is touched, and no
// network request is made here.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { mergeDaily } from '../src/parsers/merge-daily.ts';
import { parseTpeEntries, entryIndex } from '../src/parsers/entries.ts';
import { validateDate } from '../src/utils/timezone.ts';
import { save, ROOT } from '../src/utils/storage.ts';

const date = validateDate(process.argv[2]);
const read = async (relative:string)=>JSON.parse(await readFile(resolve(ROOT,relative),'utf8'));
const scheduleDir = process.env.SCHEDULE_OUT_DIR ?? 'data/normalized';
const resultsPath = `${scheduleDir}/schedule-${date}-AUTO.json`;
const tpenocPath = `data/normalized/tpenoc-${date}.json`;

let results;
try { results = await read(resultsPath); }
catch { throw new Error(`找不到 ${resultsPath}；請先執行 npm run fetch:schedule -- ${date} AUTO`); }
// Without a usable entry list the merge runs entry-blind: unseeded units stay unresolved
// rather than being reported as "no Chinese Taipei event".
let entries = null;
const entriesPath = 'data/normalized/tpe-entries.json';
try { entries = entryIndex(parseTpeEntries(await read(entriesPath))); }
catch { console.error(`注意：沒有可用的 ${entriesPath}，未編組場次維持待確認；請先執行 npm run fetch:entries。`); }
let tpenoc = null;
try { tpenoc = await read(tpenocPath); }
catch { console.error(`注意：沒有 ${tpenocPath}，本次只有 Results 單一來源，中文姓名與中華奧會核對缺席。`); }

const merged = mergeDaily(results, tpenoc, entries);
const report = { schemaVersion:1, generatedAt:new Date().toISOString(), timezone:'Asia/Taipei',
  editorialVerification:'pending',
  sources:{
    results:{ path:resultsPath, generatedAt:results.generatedAt, coverage:results.coverage },
    tpenoc:tpenoc ? { path:tpenocPath, generatedAt:tpenoc.generatedAt,
      sourceFileName:tpenoc.sourceFileName, updatedAtJst:tpenoc.updatedAtJst } : null,
    entries:entries ? { path:entriesPath, events:entries.size } : null },
  ...merged };
const output = `${process.env.DAILY_OUT_DIR ?? 'data/normalized'}/daily-${date}.json`;
await save(output, report);

console.log(`${date} 中華隊每日整合（台灣時間）`);
if (merged.officialNoCompetition) console.log('官方資料已完整同步，這一天沒有中華隊賽事。');
else if (!merged.coverageComplete) console.log(merged.rows.length
  ? '注意：這一天的 Results 同步未完整，以下只是已取得的部分。'
  : '注意：這一天的 Results 同步未完整，0 場不代表沒有賽事。');
const s = merged.summary;
console.log(`matched ${s.matched}｜tpenocOnly ${s.tpenocOnly}｜resultsOnly ${s.resultsOnly}｜entered ${s.entered}｜unresolvedTbd ${s.unresolvedTbd}｜warnings ${s.warnings}`);
for (const row of merged.rows.filter(r=>r.participationState !== 'PARTICIPANTS_TBD')) {
  if (row.participationState === 'TPE_ENTERED') {
    console.log(`  ${row.startTimeTaipei?.slice(11,16) ?? '--:--'}起 ${row.sportZh ?? row.sportEn ?? row.disciplineCode}`
      + `  ${row.event ?? ''}  [報名待編組・當日 ${row.unitCount} 場次]  ${row.enteredAthletes.join('、')}`);
    continue;
  }
  const score = row.result ? `${row.result.tpe ?? '-'}:${row.result.opponent ?? '-'}` : '尚無';
  console.log(`  ${row.startTimeTaipei?.slice(11,16) ?? '--:--'}  ${row.sportZh ?? row.sportEn ?? row.disciplineCode}`
    + `  ${row.event ?? ''} ${row.phase ?? ''}`.trimEnd()
    + `  對 ${row.opponent ?? '未列'}  ${row.status ?? '狀態未知'}  ${score}  [${row.matchStatus}/${row.matchConfidence}]`
    + `  ${row.athletes.length ? row.athletes.length + ' 人（中文）' : '無中文名單'}`);
}
if (merged.warnings.length) {
  console.error(`${merged.warnings.length} 筆警告，需人工確認：`);
  for (const w of merged.warnings) console.error(`  [${w.code}] ${w.message}`);
}
console.log(`保存：${output}`);
