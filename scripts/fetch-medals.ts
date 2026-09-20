// npm run fetch:medals
// Taiwan's official medal totals, from the medal table the official front end itself loads.
// Display only: it never touches canonical schedule data, and a bad response keeps the
// previous file rather than writing zeros.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { get } from '../src/api/asianGames.ts';
import { save, ROOT } from '../src/utils/storage.ts';
import { extractTpe } from '../src/parsers/medals.ts';
import type { Medals } from '../src/parsers/medals.ts';

const FILE = 'data/reference/tpe-medals.json';
const previous = await readFile(resolve(ROOT,FILE),'utf8').catch(()=>null);
let medals:Medals;
try {
  const { data, meta } = await get('ALL/medals/standings');
  medals = extractTpe(data, meta.checked_at, meta.url);
} catch (error) {
  console.error(`獎牌榜取得失敗：${(error as Error).message}；保留既有資料`);
  process.exit(previous ? 0 : 1);
}
const same = previous && JSON.stringify({ ...JSON.parse(previous), updatedAt:'' })
  === JSON.stringify({ ...medals, updatedAt:'' });
if (same) { console.log('獎牌數未變動'); process.exit(0); }
await save(FILE, medals);
console.log(`台灣獎牌：${medals.gold} 金 ${medals.silver} 銀 ${medals.bronze} 銅，共 ${medals.total} 面`);
