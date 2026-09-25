// Display-only Chinese for things the official feed publishes in English.
// The canonical data keeps the official NOC code and the official English venue name; these
// tables only decide what the page shows, and anything unmapped falls back to the official text.
export type DisplayNames = { orgs:Record<string,string>; venues:Record<string,string> };

export function parseDisplayNames(noc:string|null, venue:string|null):DisplayNames {
  const orgs = safe(noc, (d)=>(d as {orgs?:Record<string,string>}).orgs);
  const venues = safe(venue, (d)=>Object.fromEntries(
    Object.entries((d as {venues?:Record<string,{zh?:string}>}).venues ?? {})
      .flatMap(([en,v])=>typeof v?.zh === 'string' && v.zh ? [[en,v.zh]] : [])));
  return { orgs, venues };
}
function safe(text:string|null, pick:(d:unknown)=>Record<string,string>|undefined):Record<string,string>{
  if (!text) return {};
  try {
    const value = pick(JSON.parse(text));
    if (!value || typeof value !== 'object') return {};
    return Object.fromEntries(Object.entries(value).filter(([k,v])=>typeof k === 'string' && typeof v === 'string' && v));
  } catch { return {}; }
}

// A country is shown in Chinese when the mapping knows its code; otherwise the official name.
export const orgLabel = (code:string|null|undefined, fallback:string|null|undefined, names:DisplayNames)=>
  (code && names.orgs[code]) || fallback || code || null;
// The committee's Chinese venue name wins, then the mapping, then the official English.
function mappedVenue(venueEn:string, names:DisplayNames):string|null {
  if (names.venues[venueEn]) return names.venues[venueEn];
  const normalized = venueEn.replace(/\s*\([^()]+\)\s*$/, '').trim();
  if (!normalized || normalized === venueEn) return null;
  const matches = Object.entries(names.venues)
    .filter(([official])=>official.replace(/\s*\([^()]+\)\s*$/, '').trim() === normalized);
  return matches.length === 1 ? matches[0][1] : null;
}
export const venueLabel = (venueZh:string|null|undefined, venueEn:string|null|undefined, names:DisplayNames)=>
  venueZh || (venueEn && mappedVenue(venueEn,names)) || venueEn || null;
