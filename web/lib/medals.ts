// Official Chinese Taipei medal totals, display only.
// rank is the official medal-table standing (gold first, then silver, then bronze) and rankEq says
// it is shared with another NOC. rankByTotal ranks by total medals alone and is NOT the official
// standing, so the page never shows it as one. All four are written by src/parsers/medals.ts and
// are optional here because a snapshot taken before they existed is still perfectly usable.
export type Medals = { gold:number; silver:number; bronze:number; total:number; updatedAt:string;
  rank?:string|null; rankEq?:boolean|null; rankByTotal?:string|null; rankByTotalEq?:boolean|null };
export function parseMedals(text:string|null):Medals|null {
  if (!text) return null;
  try {
    const d = JSON.parse(text) as Medals;
    const ok = [d.gold,d.silver,d.bronze,d.total].every(n=>Number.isInteger(n) && n >= 0);
    if (!ok || d.gold + d.silver + d.bronze !== d.total) return null;
    return d;
  } catch { return null; }
}
