import { competitor } from './schedule.ts';
import type { RawCompetitor, Schedule } from './schedule.ts';

type ResultTarget = Pick<Schedule,'unitId' | 'eventId' | 'status'> & {
  phaseId?:string | null; resultScope?:'component' | 'aggregate' | null;
};

// A null body can mean the official Results view has not been created yet. Only the
// schedule's explicit not-started status makes that safe; all other nulls stay failures.
export function parseRequestedResult(data:unknown,row:ResultTarget,resultKey:string) {
  if (data === null && row.status === 'not_started') return null;
  const result = data as { Info?:{ Key?:string; Status?:string; IsLive?:boolean;
    IsPhase?:boolean; Event?:string; Phase?:string };
    Competitors?:RawCompetitor[]; Results?:{ CurrentPeriod?:number } } | null;
  const identityMatches = row.resultScope === 'aggregate'
    ? result?.Info?.Key === resultKey && result?.Info?.IsPhase === true
      && result?.Info?.Event === row.eventId && result?.Info?.Phase === row.phaseId
    : result?.Info?.Key === row.unitId;
  if (!result?.Info || !identityMatches || !Array.isArray(result.Competitors)) {
    throw new Error('Schema change: Results identity/structure mismatch');
  }
  return { sourceStatus:result.Info.Status,isLive:result.Info.IsLive,
    currentPeriod:result.Results?.CurrentPeriod ?? null,
    competitors:result.Competitors.map(competitor) };
}
