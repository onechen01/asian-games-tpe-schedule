// Derived medals, display only.
// Only a unit the officials themselves name as a gold or bronze medal match decides a medal,
// and only once it is official. Ordinary finals, multi-competitor finals, semifinals and the
// medalCode flag are never interpreted: they stay undecided instead of being guessed.
export type Medal = 'GOLD' | 'SILVER' | 'BRONZE';
export type MedalRow = { unit?:string|null; phase?:string|null; status?:string|null;
  tpeRank?:string|null; orgCount?:number|null };

const GOLD = /gold medal (match|bout)/i;
const BRONZE = /bronze medal (match|bout)/i;

export function medalOf(row:MedalRow):Medal|null {
  if (row?.status !== 'OFFICIAL') return null;
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
