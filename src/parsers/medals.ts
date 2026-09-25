// Chinese Taipei's official medal totals, read from the medal table the official front end
// loads. Counts must be whole, non-negative and add up, or the batch is refused.
export type Medals = { gold:number; silver:number; bronze:number; total:number;
  updatedAt:string; source:string;
  // The medal-table rank (sorted gold, then silver, then bronze) and the separate rank by total
  // medal count alone, verbatim from the officials -- confirmed against the live standings
  // response (Rk/RkTotal are the officially displayed rank, a string because a tie shares one
  // value with no "=" prefix seen so far; RkEq/RkEqTotal say whether this rank is currently tied
  // with another NOC). Never computed here: null when the officials have not published one.
  rank:string | null; rankEq:boolean | null;
  rankByTotal:string | null; rankByTotalEq:boolean | null };
const int = (v:unknown)=>Number.isInteger(v) && (v as number) >= 0 ? v as number : null;
const str = (v:unknown)=>typeof v === 'string' ? v : null;
const bool = (v:unknown)=>typeof v === 'boolean' ? v : null;

export function extractTpe(data:unknown, checkedAt:string, url:string):Medals {
  const rows = Object.values((data ?? {}) as Record<string,unknown>) as
    { Org?:unknown; Count?:{ ME_GOLD?:{total?:unknown}; ME_SILVER?:{total?:unknown};
      ME_BRONZE?:{total?:unknown}; total?:{total?:unknown} };
      Rk?:unknown; RkEq?:unknown; RkTotal?:unknown; RkEqTotal?:unknown }[];
  const tpe = rows.find(r=>r?.Org === 'TPE');
  if (!tpe) throw new Error('Medal standings contain no TPE row');
  const gold = int(tpe.Count?.ME_GOLD?.total), silver = int(tpe.Count?.ME_SILVER?.total);
  const bronze = int(tpe.Count?.ME_BRONZE?.total), total = int(tpe.Count?.total?.total);
  if (gold === null || silver === null || bronze === null || total === null) {
    throw new Error('Medal counts are not non-negative integers');
  }
  if (gold + silver + bronze !== total) throw new Error('Medal counts do not add up');
  return { gold, silver, bronze, total, updatedAt:checkedAt, source:url,
    rank:str(tpe.Rk), rankEq:bool(tpe.RkEq), rankByTotal:str(tpe.RkTotal), rankByTotalEq:bool(tpe.RkEqTotal) };
}

