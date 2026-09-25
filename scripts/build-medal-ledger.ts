// npm run build:medal-ledger
// Builds data/reference/tpe-medal-ledger.json from the official per-medal list
// (ALL/medals/org/TPE) -- the endpoint the official Medals Searcher itself requests. A row there
// carrying an explicit Medal code IS the award; nothing is ever derived from a rank, a placing or
// a final's status.
//
// The Results units are no longer what proves a medal exists. They are read from published
// canonical purely to enrich an award with the things the officials' medal list does not carry:
// the unit and phase it was won in, the start time, the sport in Chinese and the athlete spellings
// the site already resolves Chinese names from. An award whose Results unit has no Medal set, or
// which canonical has not caught up with at all, is still published in full.
//
// ALL/medals/standings stays the independent check on how many medals exist: when the two agree the
// ledger is complete, and when they do not it says so rather than inventing the difference.
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { get } from '../src/api/asianGames.ts';
import { extractTpe } from '../src/parsers/medals.ts';
import { SPORT_ZH } from '../src/parsers/merge-daily.ts';
import { parseOfficialAwards, eventCodeOf } from '../src/parsers/medal-awards-official.ts';
import type { OfficialAward } from '../src/parsers/medal-awards-official.ts';
import { save, ROOT } from '../src/utils/storage.ts';
import { buildMedalLedger, ledgerContentChanged } from '../web/lib/medal-awards.ts';
import type { MedalAward, MedalLedger, LedgerCounts } from '../web/lib/medal-awards.ts';

const FILE = 'data/reference/tpe-medal-ledger.json';
const STANDINGS = 'data/reference/tpe-medals.json';
const NOC = 'TPE';

type CanonicalRow = {
  status?:string | null; disciplineCode?:string | null; sportZh?:string | null;
  event?:string | null; phase?:string | null; date?:string | null; startTimeTaipei?:string | null;
  tpeRank?:string | null; athletesEn?:string[]; resultScope?:string | null;
  tpeEntrants?:{ registration?:string | null; name?:string | null; rank?:string | null }[];
  sources?:{ results?:{ unitId?:string; id:string } };
};

const readJson = async (relative:string)=>{
  try { return JSON.parse(await readFile(resolve(ROOT,relative),'utf8')); } catch { return null; }
};
const counts = (v:{gold?:unknown;silver?:unknown;bronze?:unknown;total?:unknown} | null):LedgerCounts | null=>{
  if (!v) return null;
  const [gold,silver,bronze,total] = [v.gold,v.silver,v.bronze,v.total];
  if (![gold,silver,bronze,total].every(n=>Number.isInteger(n) && (n as number) >= 0)) return null;
  if ((gold as number)+(silver as number)+(bronze as number) !== total) return null;
  return { gold:gold as number, silver:silver as number, bronze:bronze as number, total:total as number };
};

// Enrichment index over published canonical only, never data/staging: a day the quality gate held
// has not reached data/normalized, so it cannot reach the ledger either.
async function canonicalIndex():Promise<Map<string,CanonicalRow[]>> {
  const dir = resolve(ROOT, 'data/normalized');
  const files = (await readdir(dir)).filter((f:string)=>/^daily-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const index = new Map<string,CanonicalRow[]>();
  for (const file of files) {
    const doc = JSON.parse(await readFile(resolve(dir,file),'utf8')) as { rows?:CanonicalRow[] };
    for (const row of doc.rows ?? []) {
      const unitId = row.sources?.results?.unitId, disc = row.disciplineCode;
      const code = eventCodeOf(unitId);
      if (!unitId || !disc || !code) continue;
      const key = `${disc}|${code}`;
      index.set(key, [...(index.get(key) ?? []), row]);
    }
  }
  return index;
}

// Which canonical row describes the unit a medal was actually won in. Only the event is shared
// with the official list -- the phase segments differ between the two endpoints -- so the row is
// chosen within the event: the entrant's own row when a registration identifies them, otherwise the
// last official unit of that event, which is the final rather than an earlier heat.
function enrichmentFor(award:OfficialAward, rows:CanonicalRow[]):CanonicalRow | null {
  if (!rows.length) return null;
  const official = rows.filter(r=>r.status === 'OFFICIAL' && r.resultScope !== 'component');
  const pool = official.length ? official : rows;
  if (award.reg) {
    const own = pool.find(r=>(r.tpeEntrants ?? []).some(e=>e.registration && e.registration === award.reg));
    if (own) return own;
  }
  return [...pool].sort((a,b)=>
    (a.startTimeTaipei ?? a.date ?? '').localeCompare(b.startTimeTaipei ?? b.date ?? '')).at(-1) ?? null;
}

// The names the site shows. Canonical spellings win when the same medal is found there, because the
// verified Chinese-name table is keyed on them; otherwise the officials' own spelling is used, so a
// medal canonical has not caught up with still reads properly.
function athletesFor(award:OfficialAward, row:CanonicalRow | null):string[] {
  if (award.members.length) {
    const members = award.members.map(m=>m.name).filter((n):n is string=>!!n);
    if (members.length) return members;
  }
  if (award.type === 'A') {
    const entrant = award.reg
      ? (row?.tpeEntrants ?? []).find(e=>e.registration === award.reg)?.name : null;
    if (entrant) return [entrant];
    if (row?.athletesEn?.length === 1) return row.athletesEn;
    return award.name ? [award.name] : (row?.athletesEn ?? []);
  }
  return row?.athletesEn?.length ? row.athletesEn : award.name ? [award.name] : [];
}

function rankFor(award:OfficialAward, row:CanonicalRow | null):string | null {
  if (!row) return null;
  if (award.reg) {
    const own = (row.tpeEntrants ?? []).find(e=>e.registration === award.reg);
    if (own?.rank) return own.rank;
  }
  return row.tpeRank ?? null;
}

async function main() {
  let official:{ awards:OfficialAward[]; problems:{code:string;detail:string}[] } | null = null;
  try {
    const { data } = await get(`ALL/medals/org/${NOC}`);
    official = parseOfficialAwards(data);
  } catch (error) {
    console.error(`官方獎牌明細取得失敗：${(error as Error).message}；保留既有 ledger，不覆寫`);
    return;
  }
  // Without the official medal list there are no awards to publish, and writing an empty ledger
  // would erase medals the site is already showing, so the existing file is left untouched.
  if (!official.awards.length && official.problems.length) {
    console.error('官方獎牌明細無法解析出任何 award；保留既有 ledger，不覆寫');
    return;
  }

  const index = await canonicalIndex();
  const awards:MedalAward[] = official.awards.map(a=>{
    const row = enrichmentFor(a, index.get(`${a.disc}|${a.eventCode}`) ?? []);
    return {
      awardId:a.awardId, medal:a.medal,
      disciplineCode:a.disc,
      sportZh:row?.sportZh ?? SPORT_ZH[a.disc] ?? null,
      // Canonical's event name is what the display layer's Chinese mapping understands; the
      // officials' own EventDesc appends the phase ("… Final"), which that mapping cannot read.
      event:row?.event ?? a.eventDesc ?? null,
      phase:row?.phase ?? null,
      date:row?.date ?? null,
      startTimeTaipei:row?.startTimeTaipei ?? null,
      resultId:row?.sources?.results?.id ?? null,
      unitId:row?.sources?.results?.unitId ?? null,
      athletes:athletesFor(a, row),
      rank:rankFor(a, row),
    };
  });

  let officialCounts:LedgerCounts | null = null;
  let standings = { verified:false, updatedAt:null as string | null };
  try {
    const { data, meta } = await get('ALL/medals/standings');
    const m = extractTpe(data, meta.checked_at, meta.url);
    officialCounts = counts(m);
    if (officialCounts) standings = { verified:true, updatedAt:m.updatedAt };
  } catch (error) {
    console.error(`獎牌榜即時取得失敗：${(error as Error).message}；改用既有快照，且不會宣告 complete`);
  }
  if (!officialCounts) {
    const stored = await readJson(STANDINGS);
    officialCounts = counts(stored);
    standings = { verified:false, updatedAt:stored?.updatedAt ?? null };
  }
  if (!officialCounts) {
    console.error('沒有可用的官方獎牌總數（即時與既有快照都不可用）；保留既有 ledger，不覆寫');
    return;
  }

  const problems = official.problems.map(p=>`${p.code}: ${p.detail}`);
  const ledger = buildMedalLedger(awards, officialCounts, new Date().toISOString(), standings, problems);
  const previous = await readJson(FILE) as MedalLedger | null;
  if (!ledgerContentChanged(ledger, previous)) { console.log('ledger 未變動'); return; }
  await save(FILE, ledger);

  const enriched = awards.filter(a=>a.unitId).length;
  console.log(`ledger：金${ledger.ledgerCounts.gold} 銀${ledger.ledgerCounts.silver} 銅${ledger.ledgerCounts.bronze} 共${ledger.ledgerCounts.total}（官方明細 ${official.awards.length} 面，其中 ${enriched} 面已由 Results 補齊賽事資訊）`);
  console.log(`official：金${officialCounts.gold} 銀${officialCounts.silver} 銅${officialCounts.bronze} 共${officialCounts.total}`
    + `（${standings.verified ? '本次已驗證' : '既有快照，未驗證'}）`);
  console.log(`completeness：${ledger.completeness}`);
  if (ledger.problems.length) console.error(`  資料問題 ${ledger.problems.length} 項：${ledger.problems.join(' / ')}`);
  if (ledger.completeness === 'partial') {
    console.log(`缺少：金${ledger.missing.gold} 銀${ledger.missing.silver} 銅${ledger.missing.bronze} 共${ledger.missing.total}`);
  }
}

await main();
