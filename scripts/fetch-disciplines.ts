// npm run fetch:disciplines
// Reads the discipline index that the official Results front end itself loads
// (observed as ALL/disc/list in its own network requests). One GET, no scanning.
import { get, ApiError } from '../src/api/asianGames.ts';
import { save } from '../src/utils/storage.ts';

type RawDiscipline = { Key?:unknown; Desc?:unknown; DescL?:unknown; Order?:unknown; NonSport?:unknown };
const { data, meta } = await get('ALL/disc/list').catch((e)=>{
  if (e instanceof ApiError) console.error(JSON.stringify(e.details,null,2));
  throw e;
});
const list = (Array.isArray(data) ? data : (data as {Disciplines?:unknown})?.Disciplines) as RawDiscipline[] | undefined;
if (!Array.isArray(list) || !list.length) throw new Error('Schema change: discipline list is not a non-empty array');
const disciplines = list.map((d)=>{
  const code = d.Key, name = d.Desc;
  if (typeof code !== 'string' || !/^[A-Z0-9]{3}$/.test(code)) throw new Error(`Schema change: unexpected discipline code ${String(code)}`);
  if (typeof name !== 'string' || !name.trim()) throw new Error(`Schema change: discipline ${code} has no name`);
  // The source exposes one flat discipline list; it has no separate sport grouping field.
  return { code, name, longName:typeof d.DescL === 'string' ? d.DescL : null,
    order:typeof d.Order === 'number' ? d.Order : null,
    nonSport:d.NonSport === true };
});
const codes = new Set(disciplines.map(d=>d.code));
if (codes.size !== disciplines.length) throw new Error('Schema change: duplicate discipline codes');
const report = { schemaVersion:1, generatedAt:new Date().toISOString(), source:meta,
  count:disciplines.length, competitionCount:disciplines.filter(d=>!d.nonSport).length,
  rawKeys:[...new Set(list.flatMap(d=>Object.keys(d as object)))].sort(), disciplines };
await save('data/normalized/disciplines.json', report);
console.log(`官方 discipline 清單：${disciplines.length} 筆；來源 ${meta.url}（HTTP ${meta.http_status}）`);
console.log(`原始欄位：${report.rawKeys.join(', ')}`);
for (const d of disciplines) console.log(`  ${d.code}  ${d.name}${d.nonSport ? '  [NonSport]' : ''}`);
console.log('保存：data/normalized/disciplines.json');
