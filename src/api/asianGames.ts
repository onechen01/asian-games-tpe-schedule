import { inflateSync } from 'node:zlib';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { ROOT, save } from '../utils/storage.ts';

export const BASE = 'https://back.results.asiangames2026.org/s/AG2026/en/';
export function decode(input: string | Buffer): { data: unknown; json: string; encoding: string } {
  const text = typeof input === 'string' ? input : input.toString('utf8');
  try { return { data:JSON.parse(text), json:text, encoding:'json' }; } catch {}
  const candidates: [string, Buffer][] = [];
  if (Buffer.isBuffer(input)) candidates.push(['zlib', input]);
  if ([...text].every(c=>c.charCodeAt(0)<=255)) candidates.push(['zlib-latin1-text', Buffer.from(text,'latin1')]);
  for (const [encoding,bytes] of candidates) {
    try {
      const json = inflateSync(bytes, { maxOutputLength:32*1024*1024 }).toString('utf8');
      return { data:JSON.parse(json), json, encoding };
    } catch {}
  }
  throw new Error('Unsupported response encoding or non-JSON body');
}
export function safeData(path: string, data: unknown): unknown {
  if (path !== 'config') return data;
  const object = data as Record<string,unknown>;
  return Object.fromEntries(['venueTimeZone','refreshSch','refreshCfg','useSockets','champDays','champDesc']
    .filter(k=>k in object).map(k=>[k,object[k]]));
}
export type Meta = {
  url:string; http_status:number; checked_at:string; data_fetched_at:string;
  elapsed_ms:number; bytes:number | null; content_type:string | null; etag:string | null;
  payload_encoding:string; raw_file:string | null; cache_revalidated:boolean;
};
export type Failure = { timestamp:string; endpoint:string; http_status:number | null; error:string };
export class ApiError extends Error {
  details: Failure;
  constructor(details: Failure) { super(details.error); this.details = details; }
}
export async function recordFailure(endpoint: string, status: number | null, error: unknown): Promise<Failure> {
  const info = { timestamp:new Date().toISOString(), endpoint, http_status:status,
    error:error instanceof Error ? error.message : String(error) };
  await save(`outputs/errors/${randomUUID()}.json`, info);
  return info;
}
export async function saveRaw(path: string, decoded: ReturnType<typeof decode>, metadata: unknown): Promise<string> {
  if (path === 'config') throw new Error('Config authentication data must not be exported as raw');
  const hash = createHash('sha256').update(path).digest('hex').slice(0,12);
  const file = `data/raw/${new Date().toISOString().replace(/[:.]/g,'-')}-${hash}-${randomUUID().slice(0,8)}.json`;
  await mkdir(resolve(ROOT,'data/raw'), {recursive:true});
  // Preserve the exact decoded JSON string, without reserializing or changing fields.
  await writeFile(resolve(ROOT,file), decoded.json, { flag:'wx' });
  await save(file.replace(/\.json$/,'.meta.json'), metadata);
  return file;
}

// The official API intermittently answers 200 with a body that is not JSON. That is a
// transport fault, never "no competition", so a request is retried a bounded number of
// times before it is recorded as missing.
export const RETRY_DELAYS = [5000, 15000, 30000];
export const MAX_ATTEMPTS = 3;
export async function withRetry<T>(run:(attempt:number)=>Promise<T>,
  options:{ delays?:number[]; attempts?:number; sleep?:(ms:number)=>Promise<unknown> } = {}): Promise<T> {
  const delays = options.delays ?? RETRY_DELAYS;
  const attempts = options.attempts ?? MAX_ATTEMPTS;
  const sleep = options.sleep ?? ((ms:number)=>pause(ms));
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await run(attempt); }
    catch (error) {
      last = error;
      if (attempt === attempts) break;
      await sleep(delays[attempt-1] ?? delays[delays.length-1]);
    }
  }
  throw last;
}

let lastRequest = 0;
export async function get(path: string, options: {conditional?:boolean; attempts?:number} = {}): Promise<{data:unknown; meta:Meta}> {
  // ALL/disc/list is the discipline index the official Results front end itself requests.
  // Discipline codes are accepted generically, but callers must take them from that list
  // rather than guessing them.
  const disc = '[A-Z0-9]{3}';
  const pattern = new RegExp(`^(config|ALL/disc/list|ALL/schedule/matrix|ALL/entries/list|ALL/medals/standings|${disc}/disc/data|${disc}/schedule/daily/\\d{4}-\\d{2}-\\d{2}|${disc}/(?:schedule/(?:unit|event)|results)/[A-Za-z0-9.\\-]+)$`);
  if (!pattern.test(path)) throw new Error('Only verified endpoint patterns are enabled');
  const url = BASE + path;
  const key = createHash('sha256').update(url).digest('hex');
  const cachePath = `data/cache-v2/${key}.json`;
  let cache: {data:unknown; meta:Meta} | undefined;
  if (options.conditional !== false) {
    try { cache = JSON.parse(await readFile(resolve(ROOT,cachePath),'utf8')); }
    catch(e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
  }
  const headers: Record<string,string> = { Accept:'application/json' };
  if (cache?.meta.etag) headers['If-None-Match'] = cache.meta.etag;
  let status: number | null = null;
  try {
    return await withRetry(async()=>{
      const started = performance.now();
      const delay = 1000 - (Date.now()-lastRequest);
      if (delay>0) await pause(delay);
      lastRequest = Date.now();
      const response = await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(20000)});
    status = response.status;
    const checked = new Date().toISOString();
    if (status === 304) {
      if (!cache) throw new Error('304 without same-URL local cache');
      return { data:cache.data, meta:{...cache.meta,http_status:304,checked_at:checked,
        elapsed_ms:Math.round(performance.now()-started),bytes:null,content_type:response.headers.get('content-type'),cache_revalidated:true} };
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${status}`); }
    const body = Buffer.from(await response.arrayBuffer());
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Non-JSON Content-Type');
    const decoded = decode(body);
    const meta: Meta = { url,http_status:status,checked_at:checked,data_fetched_at:checked,
      elapsed_ms:Math.round(performance.now()-started),bytes:body.length,
      content_type:response.headers.get('content-type'),etag:response.headers.get('etag'),
      payload_encoding:decoded.encoding,raw_file:null,cache_revalidated:false };
    if (path !== 'config') meta.raw_file = await saveRaw(path,decoded,meta);
    const data = safeData(path,decoded.data);
    await save(cachePath,{data,meta});
    return {data,meta};
    }, { attempts:options.attempts });
  } catch(error) {
    const err = error as Error & {cause?:{code?:string}};
    throw new ApiError(await recordFailure(url,status,new Error(err.cause?.code ? `${err.message}: ${err.cause.code}` : err.message)));
  }
}
