// One recovery pass over the endpoints that failed in this run.
// It repeats only those endpoints, never the ones that already succeeded, and it changes no
// rule about what may be published: the caller still has to end with nothing missing.
export type Retryable = { endpoint:string };
export async function recoverMissing<T extends Retryable>(
  failed:T[], retry:(item:T)=>Promise<boolean>,
  options:{ wait?:number; sleep?:(ms:number)=>Promise<unknown>; onStart?:(count:number)=>void } = {},
):Promise<{ attempted:T[]; recovered:T[]; remaining:T[] }> {
  if (!failed.length) return { attempted:[], recovered:[], remaining:[] };
  options.onStart?.(failed.length);
  if (options.sleep) await options.sleep(options.wait ?? 30000);
  const recovered:T[] = [], remaining:T[] = [];
  for (const item of failed) (await retry(item) ? recovered : remaining).push(item);
  return { attempted:failed, recovered, remaining };
}
