import { competitor } from './schedule.ts';
import type { RawCompetitor, Schedule } from './schedule.ts';

type ResultTarget = Pick<Schedule,'unitId' | 'eventId' | 'phaseId' | 'resultCode' | 'status' | 'hasTpe'
  | 'originalStartTime'> & {
  resultScope?:'component' | 'aggregate' | null;
};

// A null body can mean the official Results view has not been created yet. Only the
// schedule's explicit not-started status makes that safe; all other nulls stay failures.
export function parseRequestedResult(data:unknown,row:ResultTarget,resultKey:string) {
  if (data === null && row.status === 'not_started') return null;
  const result = data as { Info?:{ Key?:string; Status?:string; IsLive?:boolean; ShowResults?:boolean;
    IsPhase?:boolean; Event?:string; Phase?:string };
    Competitors?:RawCompetitor[]; Results?:{ CurrentPeriod?:number } } | null;
  const phaseRequest = row.resultScope === 'aggregate' || row.resultCode !== row.unitId;
  const expectedKey = row.resultScope === 'aggregate'
    ? row.phaseId ? `${row.phaseId}.--------` : null
    : row.resultCode;
  const identityMatches = resultKey === expectedKey && result?.Info?.Key === resultKey
    && (phaseRequest
      ? !!row.eventId && !!row.phaseId && result?.Info?.IsPhase === true
        && result.Info.Event === row.eventId && result.Info.Phase === row.phaseId
      : resultKey === row.unitId && result?.Info?.IsPhase !== true);
  if (!result?.Info || !identityMatches || !Array.isArray(result.Competitors)) {
    throw new Error('Schema change: Results identity/structure mismatch');
  }
  const resultStarted = row.status === 'in_progress' || row.status === 'finished'
    || ['RUNNING','OFFICIAL','FINISHED','UNOFFICIAL','INTERMEDIATE','LIVE'].includes(result.Info.Status ?? '')
    || result.Info.ShowResults === true;
  if (row.hasTpe === true && resultStarted && !result.Competitors.some(c=>c.Org === 'TPE')) {
    throw new Error('Incomplete Results snapshot: confirmed TPE competitor is missing');
  }
  // The unit's own wall date (at venue offset), the same reading DateTimeRaw already uses
  // elsewhere -- a per-competitor STARTTIME is a clock time within this same session's day.
  const wallDate = typeof row.originalStartTime === 'string' ? row.originalStartTime.slice(0,10) : null;
  return { sourceStatus:result.Info.Status,isLive:result.Info.IsLive,
    currentPeriod:result.Results?.CurrentPeriod ?? null,
    competitors:result.Competitors.map(c=>competitor(c,wallDate)) };
}

export function officialQualifiedCompetitors(data:unknown,row:ResultTarget,resultKey:string) {
  const result=parseRequestedResult(data,row,resultKey);
  if (!result || result.sourceStatus!=='OFFICIAL') return [];
  return result.competitors.filter(c=>c.qualified !== null);
}

export function confirmFromQualifiedCompetitors(row:Schedule,
  competitors:ReturnType<typeof competitor>[]):boolean {
  const qualified=competitors.filter(c=>c.org==='TPE' && c.qualified !== null);
  if (!qualified.length) return false;
  row.hasTpe=true;
  row.participation='confirmed';
  row.orgs=['TPE'];
  // Previous-phase scores, ranks, medals and start slots belong to that previous competition.
  // Only the official identity and Qualified marker cross into the later unit.
  row.competitors=qualified.map(c=>({ ...c, result:null, winner:null, rank:null, medal:null,
    startTimeTaipei:null }));
  return true;
}
