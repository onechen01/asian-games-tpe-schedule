// Official Chinese Taipei medal totals, display only.
export type Medals = { gold:number; silver:number; bronze:number; total:number; updatedAt:string };
export function parseMedals(text:string|null):Medals|null {
  if (!text) return null;
  try {
    const d = JSON.parse(text) as Medals;
    const ok = [d.gold,d.silver,d.bronze,d.total].every(n=>Number.isInteger(n) && n >= 0);
    if (!ok || d.gold + d.silver + d.bronze !== d.total) return null;
    return d;
  } catch { return null; }
}
