// npm run build:medal-ledger
// Builds data/reference/tpe-medal-ledger.json from the canonical daily-*.json files, using the
// single shared extractor (web/lib/medal-awards.ts) that medalOf() also calls -- there is no
// second, independently maintained notion of "what counts as a medal" here.
//
// It reads production canonical only, never data/staging, so a day the quality gate held cannot
// reach the ledger: update-results.ts swaps a day into data/normalized only after it passes.
//
// The official standings total is the authority on how many medals exist; this ledger only says
// how many of them canonical can currently prove, and never invents the difference. Standings
// freshness is established here rather than taken on trust, because neither existing signal is
// sufficient: fetch-medals.ts leaves tpe-medals.json untouched when the counts have not moved (so
// its updatedAt is "last time the numbers changed", not "last time we checked"), and it exits 0
// after a failed fetch whenever an old file survives. So a live fetch that succeeds marks the
// comparison verified; falling back to the stored snapshot marks it unverified, which can never
// report 'complete'.
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { get } from '../src/api/asianGames.ts';
import { extractTpe } from '../src/parsers/medals.ts';
import { save, ROOT } from '../src/utils/storage.ts';
import { buildMedalLedger, ledgerContentChanged } from '../web/lib/medal-awards.ts';
import type { MedalAwardSource, MedalLedger, LedgerCounts } from '../web/lib/medal-awards.ts';

const FILE = 'data/reference/tpe-medal-ledger.json';
const STANDINGS = 'data/reference/tpe-medals.json';

const readJson = async (relative:string)=>{
  try { return JSON.parse(await readFile(resolve(ROOT,relative),'utf8')); } catch { return null; }
};
const counts = (value:{gold?:unknown;silver?:unknown;bronze?:unknown;total?:unknown} | null):LedgerCounts | null=>{
  if (!value) return null;
  const [gold,silver,bronze,total] = [value.gold,value.silver,value.bronze,value.total];
  const ok = [gold,silver,bronze,total].every(n=>Number.isInteger(n) && (n as number) >= 0);
  if (!ok || (gold as number)+(silver as number)+(bronze as number) !== total) return null;
  return { gold:gold as number, silver:silver as number, bronze:bronze as number, total:total as number };
};

// Everything runs inside main() so an early exit is a plain return. Calling process.exit() here
// instead aborts on Windows while the standings connection is still open (libuv
// "!(handle->flags & UV_HANDLE_CLOSING)"), which would hand the updater a non-zero status and make
// it report a failed rebuild that in fact succeeded.
async function main() {
  // Production canonical, in date order; the staging directory is deliberately not consulted.
  const dir = resolve(ROOT, 'data/normalized');
  const files = (await readdir(dir)).filter((f:string)=>/^daily-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const rows:MedalAwardSource[] = [];
  for (const file of files) {
    const parsed = JSON.parse(await readFile(resolve(dir,file),'utf8')) as { rows?:MedalAwardSource[] };
    for (const row of parsed.rows ?? []) rows.push(row);
  }

  let officialCounts:LedgerCounts | null = null;
  let standings = { verified:false, updatedAt:null as string | null };
  try {
    const { data, meta } = await get('ALL/medals/standings');
    const official = extractTpe(data, meta.checked_at, meta.url);
    officialCounts = counts(official);
    if (officialCounts) standings = { verified:true, updatedAt:official.updatedAt };
  } catch (error) {
    console.error(`獎牌榜即時取得失敗：${(error as Error).message}；改用既有快照，且不會宣告 complete`);
  }
  if (!officialCounts) {
    const stored = await readJson(STANDINGS);
    officialCounts = counts(stored);
    standings = { verified:false, updatedAt:stored?.updatedAt ?? null };
  }
  // With no usable totals at all there is nothing to compare against, and a ledger that claimed
  // otherwise would be worse than the one already on disk, so the existing file is left alone.
  if (!officialCounts) {
    console.error('沒有可用的官方獎牌總數（即時與既有快照都不可用）；保留既有 ledger，不覆寫');
    return;
  }

  const ledger = buildMedalLedger(rows, officialCounts, new Date().toISOString(), standings);
  const previous = await readJson(FILE) as MedalLedger | null;
  if (!ledgerContentChanged(ledger, previous)) {
    console.log('ledger 未變動');
    return;
  }
  await save(FILE, ledger);

  console.log(`ledger：金${ledger.ledgerCounts.gold} 銀${ledger.ledgerCounts.silver} 銅${ledger.ledgerCounts.bronze} 共${ledger.ledgerCounts.total}`);
  console.log(`official：金${officialCounts.gold} 銀${officialCounts.silver} 銅${officialCounts.bronze} 共${officialCounts.total}`
    + `（${standings.verified ? '本次已驗證' : '既有快照，未驗證'}）`);
  console.log(`completeness：${ledger.completeness}`);
  if (ledger.completeness === 'partial') {
    console.log(`缺少：金${ledger.missing.gold} 銀${ledger.missing.silver} 銅${ledger.missing.bronze} 共${ledger.missing.total}`);
  }
}

await main();
