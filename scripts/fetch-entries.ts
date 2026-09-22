// npm run fetch:entries
// One request for the whole Games: the official entry index, reduced to Chinese Taipei.
// A failure leaves the previous file untouched and exits non-zero, because an empty or stale
// entry list must never be read as "Chinese Taipei did not enter".
import { get, ApiError } from '../src/api/asianGames.ts';
import { extractTpeEntries } from '../src/parsers/entries.ts';
import { save } from '../src/utils/storage.ts';

const { data, meta } = await get('ALL/entries/list').catch((e)=>{
  if (e instanceof ApiError) console.error(JSON.stringify(e.details,null,2));
  throw e;
});
const entries = extractTpeEntries(data, meta.checked_at);
const output = 'data/normalized/tpe-entries.json';
await save(output, { ...entries, source:meta });

console.log(`中華隊報名名單：${entries.athleteCount} 人、${entries.eventCount} 個項目`);
console.log(`來源 ${meta.url}（HTTP ${meta.http_status}）`);
console.log(`涵蓋 ${new Set(entries.entries.map(entry=>entry.disciplineCode)).size} 個運動`);
for (const bad of entries.malformed ?? []) {
  console.error(`略過不完整的報名資料 #${bad.index}：缺 ${bad.missing.join('、')}`
    + `（Reg ${bad.reg ?? '無'}／Name ${bad.name ?? '無'}／Disc ${bad.disciplineCode ?? '無'}）`);
}
if (entries.malformed?.length) console.error(`共略過 ${entries.malformed.length} 筆；略過不代表該選手未參賽。`);
console.log(`保存：${output}`);
