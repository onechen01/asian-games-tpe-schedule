// The official per-medal list for one NOC (ALL/medals/org/{NOC}) -- the endpoint the official
// Medals Searcher itself requests. This is where a medal comes from: a row here with an explicit
// Medal code IS the award. Nothing is ever derived from a rank, a placing or a final's status.
//
// The officials publish exactly one row per medal. A team medal is a single row carrying its roster
// in Members, never one row per member, so a squad of twelve is still one award.
export type OfficialMedalCode = 'ME_GOLD' | 'ME_SILVER' | 'ME_BRONZE';
export const isOfficialMedal = (v:unknown):v is OfficialMedalCode =>
  v === 'ME_GOLD' || v === 'ME_SILVER' || v === 'ME_BRONZE';

export type OfficialAward = {
  // Discipline, event and the official registration id. Reg is the athlete id for an individual and
  // a structured team code ("TSTMTEAM-------TPE01") for a squad, so one medal keeps one identity
  // whichever it is.
  awardId:string;
  medal:OfficialMedalCode;
  disc:string; discDesc:string | null;
  eventCode:string; eventDesc:string | null;
  reg:string | null; type:string | null; name:string | null;
  members:{ reg:string | null; name:string | null }[];
};

// A problem that must never be silently swallowed: each one blocks the ledger from claiming to be
// complete, because a ledger that quietly dropped a malformed or contradictory row would be lying.
export type AwardProblem = { code:'malformed_row' | 'duplicate_identity' | 'medal_conflict'; detail:string };

const str = (v:unknown)=>typeof v === 'string' && v.trim() ? v.trim() : null;

// "M.200MBF------------.----" (official) and "M.200MBF------------.FNL-.000100--" (a Results unit)
// describe the same event. Only the first two segments are shared: the officials write ".----",
// ".FNL-" or ".REPF" for the same medal depending on the endpoint, so the phase must never be part
// of an identity or a join key.
export function eventCodeOf(value:unknown):string | null {
  const parts = String(value ?? '').split('.');
  return parts.length >= 2 && parts[0] ? `${parts[0]}.${parts[1]}` : null;
}
export const awardIdOf = (disc:string, eventCode:string, reg:string | null)=>
  `${disc}|${eventCode}|${reg ?? '-'}`;

export function parseOfficialAwards(data:unknown):{ awards:OfficialAward[]; problems:AwardProblem[] } {
  const list = Array.isArray(data) ? data
    : data && typeof data === 'object' ? Object.values(data as Record<string,unknown>) : [];
  const problems:AwardProblem[] = [];
  const byId = new Map<string,OfficialAward>();
  const awards:OfficialAward[] = [];

  for (const raw of list as Record<string,unknown>[]) {
    const medal = raw?.Medal, disc = str(raw?.Disc), eventCode = eventCodeOf(raw?.Event);
    // A row without an explicit medal code, discipline or event cannot be turned into an award.
    // It is reported rather than skipped quietly, so the ledger downgrades instead of pretending.
    if (!isOfficialMedal(medal) || !disc || !eventCode) {
      problems.push({ code:'malformed_row',
        detail:`Disc=${String(raw?.Disc)} Event=${String(raw?.Event)} Medal=${String(raw?.Medal)}` });
      continue;
    }
    const reg = str(raw?.Reg);
    const award:OfficialAward = {
      awardId:awardIdOf(disc, eventCode, reg), medal, disc, discDesc:str(raw?.DiscDesc),
      eventCode, eventDesc:str(raw?.EventDesc), reg, type:str(raw?.Type), name:str(raw?.Name),
      members:(Array.isArray(raw?.Members) ? raw.Members as Record<string,unknown>[] : [])
        .map(m=>({ reg:str(m?.Reg), name:str(m?.Name) })),
    };
    const clash = byId.get(award.awardId);
    if (clash) {
      // Two rows sharing one identity is either a duplicate or a contradiction. Either way the
      // first is kept and the collision is reported; the ledger must not deduplicate in silence.
      problems.push(clash.medal === award.medal
        ? { code:'duplicate_identity', detail:`${award.awardId} appears more than once` }
        : { code:'medal_conflict', detail:`${award.awardId}: ${clash.medal} vs ${award.medal}` });
      continue;
    }
    byId.set(award.awardId, award);
    awards.push(award);
  }
  return { awards, problems };
}

export const countAwards = (awards:{ medal:OfficialMedalCode }[])=>({
  gold:awards.filter(a=>a.medal === 'ME_GOLD').length,
  silver:awards.filter(a=>a.medal === 'ME_SILVER').length,
  bronze:awards.filter(a=>a.medal === 'ME_BRONZE').length,
  total:awards.length,
});
