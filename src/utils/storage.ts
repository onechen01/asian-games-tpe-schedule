import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export async function save(relative: string, value: unknown): Promise<void> {
  const path = resolve(ROOT, relative);
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n');
  await rename(temp, path);
}
