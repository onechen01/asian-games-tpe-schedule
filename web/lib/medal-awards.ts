// Single source of truth for which Chinese Taipei rows the officials have already turned into a
// medal, and for turning a day's worth of canonical rows into a deduplicated award list. Both
// medalOf() (medal-match.ts, per-card display) and the ledger builder (scripts/build-medal-ledger.ts)
// call the same extractTpeMedalAwards() below, so the two never drift into disagreeing about what
// counts as a medal.
export type OfficialMedalCode = 'ME_GOLD' | 'ME_SILVER' | 'ME_BRONZE';
const isMedal = (value:unknown):value is OfficialMedalCode =>
  value === 'ME_GOLD' || value === 'ME_SILVER' || value === 'ME_BRONZE';

// The minimal shape extraction needs from a canonical row (src/parsers/merge-daily.ts's DailyRow,
// or web/lib/schedule.ts's Row -- both match this structurally, so neither needs to be imported
// and this file stays usable from both the Node scripts side and the Next app).
export type MedalAwardSource = {
  status?:string | null;
  disciplineCode?:string | null; sportZh?:string | null;
  event?:string | null; phase?:string | null;
  date?:string | null; startTimeTaipei?:string | null;
  resultScope?:'component' | 'aggregate' | null;
  tpeMedal?:string | null; tpeRank?:string | null;
  tpeEntrants?:{ name?:string | null; registration?:string | null; rank?:string | null; medal?:string | null }[] | null;
  athletesEn?:string[] | null;
  sources?:{ results?:{ unitId?:string; id:string } } | null;
};

export type MedalAward = {
  // Stable dedup key. A unit-level award is the row's own resultId; an entrant-level award (an
  // aggregate unit with two or more Chinese Taipei entrants, where only some of them medal)
  // appends the entrant's identity, so each entrant's medal is its own award.
  awardId:string;
  medal:OfficialMedalCode;
  // The sport's Chinese name as canonical already resolved it (merge-daily.ts SPORT_ZH). Carried on
  // the award so the display layer needs nothing but this ledger: web/ has no discipline-code table
  // of its own, and duplicating one across the package boundary would only invite drift.
  disciplineCode:string | null; sportZh:string | null; event:string | null; phase:string | null;
  date:string | null; startTimeTaipei:string | null;
  resultId:string | null; unitId:string | null;
  athletes:string[]; rank:string | null;
  // Set only when no official registration id was available for an entrant-level award and a
  // less stable identity (the entrant's rank, or failing that its position in the list) had to
  // be used instead. Every entrant seen so far has carried a registration id -- see the audit
  // this was designed against -- so this should stay unset in practice; it exists so a future
  // gap is reported instead of silently trusted.
  identityUnstable?:boolean;
};

// A component result (one apparatus of a multi-apparatus Wushu event, for example) never decides
// a medal on its own -- only the phase-level aggregate does. An aggregate unit's medal lives at
// unit level when a single Chinese Taipei entrant competed; with two or more, merge-daily.ts
// deliberately leaves the unit-level field null and each entrant carries their own medal instead,
// so only that path is read once the unit-level field is empty.
export function extractTpeMedalAwards(row:MedalAwardSource):MedalAward[] {
  if (row.status !== 'OFFICIAL') return [];
  if (row.resultScope === 'component') return [];
  const resultId = row.sources?.results?.id ?? null;
  const unitId = row.sources?.results?.unitId ?? null;
  const base = {
    disciplineCode:row.disciplineCode ?? null, sportZh:row.sportZh ?? null,
    event:row.event ?? null, phase:row.phase ?? null,
    date:row.date ?? null, startTimeTaipei:row.startTimeTaipei ?? null,
    resultId, unitId,
  };
  // Rule 6: a unit-level medal decides the whole row by itself -- entrant-level medals on the
  // same row are never also read, so one official medal can never become two awards.
  if (isMedal(row.tpeMedal)) {
    return [{ ...base, awardId:resultId ?? unitId ?? '', medal:row.tpeMedal,
      athletes:row.athletesEn ?? [], rank:row.tpeRank ?? null }];
  }
  if (row.resultScope !== 'aggregate') return [];
  const entrants = row.tpeEntrants ?? [];
  const awards:MedalAward[] = [];
  entrants.forEach((entrant,index)=>{
    if (!isMedal(entrant.medal)) return;
    // Never a bare name (rule 7): registration first, then the entrant's own rank (unique within
    // one unit and still an official field), then finally a positional fallback flagged unstable.
    const identity = entrant.registration ?? entrant.rank ?? null;
    const awardId = identity != null
      ? `${resultId ?? unitId ?? ''}#${identity}`
      : `${resultId ?? unitId ?? ''}#entrant-${index}`;
    awards.push({ ...base, awardId, medal:entrant.medal,
      athletes:entrant.name ? [entrant.name] : [], rank:entrant.rank ?? null,
      ...(identity == null ? { identityUnstable:true } : {}) });
  });
  return awards;
}

export type LedgerCounts = { gold:number; silver:number; bronze:number; total:number };
export type MedalLedger = {
  generatedAt:string;
  completeness:'complete' | 'partial';
  // Whether officialCounts came from a standings response the caller actually verified on this
  // run. A stale snapshot cannot prove anything, so an unverified comparison stays 'partial' even
  // when the two sets of numbers happen to line up -- otherwise a standings outage during which
  // canonical caught up would read as a confirmed complete ledger.
  standingsVerified:boolean;
  // When the compared totals were produced, if the caller knows; null when it does not.
  standingsUpdatedAt:string | null;
  ledgerCounts:LedgerCounts;
  officialCounts:LedgerCounts;
  // officialCounts minus ledgerCounts, per colour and total; zero everywhere when complete.
  missing:LedgerCounts;
  awards:MedalAward[];
};

// Pure aggregation: no fetching, no file reads. The officially-confirmed totals are supplied by
// the caller (a live standings fetch), never derived from the awards themselves -- the ledger
// must be able to say "we only have 14 of the official 15" instead of quietly agreeing with itself.
export function buildMedalLedger(rows:MedalAwardSource[], officialCounts:LedgerCounts, generatedAt:string,
  standings:{ verified:boolean; updatedAt:string | null } = { verified:true, updatedAt:null }):MedalLedger {
  const byId = new Map<string,MedalAward>();
  for (const row of rows) for (const award of extractTpeMedalAwards(row)) {
    if (!byId.has(award.awardId)) byId.set(award.awardId, award);
  }
  const awards = [...byId.values()].sort((a,b)=>
    (a.date ?? '').localeCompare(b.date ?? '') || a.awardId.localeCompare(b.awardId));
  const count = (medal:OfficialMedalCode)=>awards.filter(a=>a.medal === medal).length;
  const ledgerCounts:LedgerCounts = { gold:count('ME_GOLD'), silver:count('ME_SILVER'),
    bronze:count('ME_BRONZE'), total:awards.length };
  const matches = ledgerCounts.gold === officialCounts.gold && ledgerCounts.silver === officialCounts.silver
    && ledgerCounts.bronze === officialCounts.bronze && ledgerCounts.total === officialCounts.total;
  return {
    generatedAt, completeness:matches && standings.verified ? 'complete' : 'partial',
    standingsVerified:standings.verified, standingsUpdatedAt:standings.updatedAt,
    ledgerCounts, officialCounts,
    missing:{ gold:officialCounts.gold-ledgerCounts.gold, silver:officialCounts.silver-ledgerCounts.silver,
      bronze:officialCounts.bronze-ledgerCounts.bronze, total:officialCounts.total-ledgerCounts.total },
    awards,
  };
}

// Both timestamps move on every run -- generatedAt by definition, and standingsUpdatedAt because a
// live standings fetch stamps the moment it was checked, not the moment the totals last changed.
// Comparing without them keeps an unchanged ledger from being rewritten on every updater pass,
// matching how fetch-medals.ts leaves tpe-medals.json alone when the counts have not moved. The
// medals, the official totals and whether the comparison was verified are all still compared.
const withoutTimestamps = (ledger:MedalLedger)=>({ ...ledger, generatedAt:'', standingsUpdatedAt:'' });
export const ledgerContentChanged = (next:MedalLedger, previous:MedalLedger | null)=>
  !previous || JSON.stringify(withoutTimestamps(next)) !== JSON.stringify(withoutTimestamps(previous));
