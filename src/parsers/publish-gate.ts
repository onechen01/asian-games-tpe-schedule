// Quality gate for a freshly built daily canonical file.
// A day is published only when the official sync for that day finished cleanly; anything
// short of that keeps the previous production file, because a partial sync must never be
// read as "fewer events" or "no competition".
export type GateInput = {
  daily: { date?:unknown; coverageComplete?:unknown; rows?:unknown[] } | null;
  schedule: { errors?:unknown[]; coverage?:{ missing?:unknown[]; fetchComplete?:unknown } } | null;
};
export type Gate = { pass:boolean; reasons:string[]; duplicates:number };

export function qualityGate({ daily, schedule }:GateInput): Gate {
  const reasons:string[] = [];
  if (!daily || !Array.isArray(daily.rows)) return { pass:false, reasons:['daily-missing'], duplicates:0 };
  if (!schedule) return { pass:false, reasons:['schedule-missing'], duplicates:0 };
  if (daily.coverageComplete !== true) reasons.push('coverageComplete-false');
  if (schedule.coverage?.fetchComplete !== true) reasons.push('fetchComplete-false');
  const missing = schedule.coverage?.missing ?? [];
  if (!Array.isArray(missing) || missing.length) reasons.push(`missing-${Array.isArray(missing) ? missing.length : 'invalid'}`);
  const errors = schedule.errors ?? [];
  if (!Array.isArray(errors) || errors.length) reasons.push(`errors-${Array.isArray(errors) ? errors.length : 'invalid'}`);
  const ids = (daily.rows as {sources?:{results?:{id?:string}}}[])
    .map(r=>r?.sources?.results?.id).filter((id):id is string=>typeof id === 'string');
  const duplicates = ids.length - new Set(ids).size;
  if (duplicates) reasons.push(`duplicate-${duplicates}`);
  return { pass:reasons.length === 0, reasons, duplicates };
}

// Timestamps and per-request metadata change on every run; only the published content decides
// whether there is anything to commit.
const VOLATILE = new Set(['generatedAt','checked_at','data_fetched_at','elapsed_ms','bytes',
  'etag','raw_file','cache_revalidated','requests','http_status','capturedAt']);
export function stableContent(value:unknown):unknown {
  if (Array.isArray(value)) return value.map(stableContent);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string,unknown>)
      .filter(([k])=>!VOLATILE.has(k)).map(([k,v])=>[k,stableContent(v)]));
  }
  return value;
}
export const changed = (next:unknown, previous:unknown)=>
  JSON.stringify(stableContent(next)) !== JSON.stringify(stableContent(previous));

// A day can be held for two very different reasons, and they must not look alike in a log or
// in an exit code: the official data was incomplete (safe, keep the previous canonical), or
// the updater never produced anything to check (automation failure).
export const AUTOMATION_FAILURES = ['daily-missing','schedule-missing','fetch-failed','merge-failed','inputs-missing'];
export const isAutomationFailure = (reasons:string[])=>
  reasons.some(r=>AUTOMATION_FAILURES.some(f=>r === f || r.startsWith(f + ':')));
// Non-zero only when nothing ran at all; a day whose official sync was incomplete is a
// normal, safe outcome that keeps whatever production already had.
export function runExitCode(held:{date:string;reasons:string[]}[], attempted:number, publishedOrUnchanged:number){
  if (!attempted) return 0;
  const automation = held.filter(h=>isAutomationFailure(h.reasons)).length;
  if (automation === attempted) return 1;
  return publishedOrUnchanged === 0 && automation > 0 ? 1 : 0;
}
