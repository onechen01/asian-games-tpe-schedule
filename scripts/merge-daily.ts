// npm run merge:daily -- 2026-09-18
// Builds the canonical daily view from the two normalized sources already on disk.
// Reads only; neither the Results pipeline nor the committee parser is touched, and no
// network request is made here.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { mergeDaily } from '../src/parsers/merge-daily.ts';
import { validateDate } from '../src/utils/timezone.ts';
import { save, ROOT } from '../src/utils/storage.ts';

const date = validateDate(process.argv[2]);
const read = async (relative:string)=>JSON.parse(await readFile(resolve(ROOT,relative),'utf8'));
const resultsPath = `data/normalized/schedule-${date}-AUTO.json`;
const tpenocPath = `data/normalized/tpenoc-${date}.json`;

let results;
try { results = await read(resultsPath); }
catch { throw new Error(`找不到 ${resultsPath}；請先執行 npm run fetch:schedule -- ${date} AUTO`); }
let tpenoc = null;
try { tpenoc = await read(tpenocPath); }
catch { console.error(`注意：沒有 ${tpenocPath}，本次只有 Results 單一來源，中文姓名與中華奧會核對缺席。`); }

const merged = mergeDaily(results, tpenoc);
const report = { schemaVersion:1, generatedAt:new Date().toISOString(), timezone:'Asia/Taipei',
  editorialVerification:'pending',
  sources:{
    results:{ path:resultsPath, generatedAt:results.generatedAt, coverage:results.coverage },
    tpenoc:tpenoc ? { path:tpenocPath, generatedAt:tpenoc.generatedAt,
      sourceFileName:tpenoc.sourceFileName, updatedAtJst:tpenoc.updatedAtJst } : null },
  ...merged };
const output = `data/normalized/daily-${date}.json`;
await save(output, report);

console.log(`${date} 中華隊每日整合（台灣時間）`);
const s = merged.summary;
console.log(`matched ${s.matched}｜tpenocOnly ${s.tpenocOnly}｜resultsOnly ${s.resultsOnly}｜unresolvedTbd ${s.unresolvedTbd}｜warnings ${s.warnings}`);
for (const row of merged.rows.filter(r=>r.matchStatus !== 'RESULTS_ONLY' || r.participationState === 'TPE_CONFIRMED')) {
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
