// Display layer for the medal board. Every medal shown on the page comes from the ledger
// (data/reference/tpe-medal-ledger.json) and every official total and rank from the standings
// snapshot (data/reference/tpe-medals.json). Nothing here re-decides what won a medal: the ledger
// already did that once, from the officials' own Medal evidence, and this file only arranges it.
import type {MedalAward,MedalLedger,OfficialMedalCode} from './medal-awards.ts';
import type {Medals} from './medals.ts';
import {athleteLabel} from './athletes.ts';
import type {AthleteMaster} from './athletes.ts';
import {eventLabel} from './event-names.ts';

export type MedalGroup = { medal:OfficialMedalCode; label:string; awards:MedalAward[] };

const MEDAL_LABEL:Record<OfficialMedalCode,string> = {
  ME_GOLD:'🥇 金牌', ME_SILVER:'🥈 銀牌', ME_BRONZE:'🥉 銅牌',
};
// Gold, then silver, then bronze -- the order the official table itself ranks by.
const MEDAL_ORDER:OfficialMedalCode[] = ['ME_GOLD','ME_SILVER','ME_BRONZE'];

export function parseMedalLedger(text:string|null):MedalLedger|null {
  if (!text) return null;
  try {
    const d = JSON.parse(text) as MedalLedger;
    if (!Array.isArray(d?.awards)) return null;
    if (d.completeness !== 'complete' && d.completeness !== 'partial') return null;
    // An award with no medal code or no identity cannot be displayed as a medal.
    const awards = d.awards.filter(a=>a && typeof a.awardId === 'string' && !!a.awardId
      && (a.medal === 'ME_GOLD' || a.medal === 'ME_SILVER' || a.medal === 'ME_BRONZE'));
    return { ...d, awards };
  } catch { return null; }
}

// One group per colour, in medal order, each keeping the ledger's own order so the list does not
// reshuffle between renders. A colour with no medals is dropped rather than shown empty.
export function medalGroups(ledger:MedalLedger|null):MedalGroup[] {
  if (!ledger) return [];
  return MEDAL_ORDER
    .map(medal=>({ medal, label:MEDAL_LABEL[medal], awards:ledger.awards.filter(a=>a.medal === medal) }))
    .filter(group=>group.awards.length > 0);
}

// "獎牌榜第 17 名", or "獎牌榜並列第 17 名" when the officials flag the rank as shared. Null when
// they have not published one -- the rank is never computed here from the medal counts. rankByTotal
// is deliberately not consulted: it ranks by total medals alone and is not the official standing.
export function rankLabel(medals:Medals|null):string|null {
  const rank = medals?.rank;
  if (typeof rank !== 'string' || !rank.trim()) return null;
  return `獎牌榜${medals?.rankEq ? '並列' : ''}第 ${rank.trim()} 名`;
}

// True while the officials' own totals are ahead of the medals canonical can prove -- typically a
// medal already counted in the standings whose unit has no Medal on the competitor yet. The page
// says so in plain language instead of silently showing a short list; it clears itself as soon as
// the ledger reaches 'complete'.
export const awaitingOfficialDetail = (ledger:MedalLedger|null)=>ledger?.completeness === 'partial';

// A quiet line explaining why the list is shorter than the official total above it -- the officials
// have not published every medallist yet. Saying only how many are listed would read as if the site
// had lost one, so the reason comes first. The count is whatever the page actually rendered, so the
// sentence can never drift from the list under it, and the whole line goes once the ledger is complete.
export function pendingNoticeText(ledger:MedalLedger|null, shownCount:number):string|null {
  if (!awaitingOfficialDetail(ledger)) return null;
  return `部分獎牌得主資料仍待官方更新，目前可查看 ${shownCount} 面得獎明細。`;
}

// Who the medal belongs to, in Chinese where a verified name exists. A team award carries its whole
// roster, so it is named as the delegation with the roster alongside; no membership is ever guessed
// -- whatever the ledger lists is what is shown.
export function awardWho(award:MedalAward, master:AthleteMaster, teamLabel = '中華隊'):
  { name:string; roster:string[] } {
  const names = (award.athletes ?? [])
    .filter(n=>typeof n === 'string' && !!n)
    .map(n=>athleteLabel(n, master, { discipline:award.disciplineCode }));
  if (names.length === 0) return { name:teamLabel, roster:[] };
  // A doubles or pairs award is still two named people, not a delegation.
  if (names.length <= 2) return { name:names.join('、'), roster:[] };
  return { name:teamLabel, roster:names };
}

// The sport's Chinese name the ledger carries, then the official code as a last resort.
export const awardSport = (award:MedalAward)=>award.sportZh || award.disciplineCode || null;
// The event in Chinese when the mapping understands it in full, else the official English.
export const awardEvent = (award:MedalAward)=>eventLabel(award.event) || award.event || null;
