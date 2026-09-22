// Derived medals, display only.
// Only a unit the officials themselves name as a gold or bronze medal match decides a medal,
// and only once it is official. Ordinary finals, multi-competitor finals, semifinals and the
// medalCode flag are never interpreted: they stay undecided instead of being guessed.
export type Medal = 'GOLD' | 'SILVER' | 'BRONZE';
export type MedalRow = { unit?:string|null; phase?:string|null; status?:string|null;
  tpeRank?:string|null; orgCount?:number|null; tpeMedal?:string|null };

const OFFICIAL_MEDAL:Record<string,Medal> = { ME_GOLD:'GOLD', ME_SILVER:'SILVER', ME_BRONZE:'BRONZE' };

const GOLD = /gold medal (match|bout)/i;
const BRONZE = /bronze medal (match|bout)/i;

export const competitorMedal=(status:string|null|undefined,code:string|null|undefined):Medal|null=>
  status === 'OFFICIAL' && code ? OFFICIAL_MEDAL[code] ?? null : null;

export function medalOf(row:MedalRow):Medal|null {
  if (row?.status !== 'OFFICIAL') return null;
  // The officials' own medal on the competitor wins: it needs no rank, no head-to-head unit
  // and no wording in the unit name, and it works the same in every sport.
  const official = competitorMedal(row.status,row.tpeMedal);
  if (official) return official;
  if ((row.orgCount ?? 0) !== 2) return null;
  const rank = row.tpeRank;
  if (rank !== '1' && rank !== '2') return null;
  const text = `${row.unit ?? ''} ${row.phase ?? ''}`;
  if (GOLD.test(text)) return rank === '1' ? 'GOLD' : 'SILVER';
  if (BRONZE.test(text)) return rank === '1' ? 'BRONZE' : null;
  return null;
}
export const medalLabel = (medal:Medal)=>
  medal === 'GOLD' ? '🥇 金牌' : medal === 'SILVER' ? '🥈 銀牌' : '🥉 銅牌';
