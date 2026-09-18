// npm run fetch:tpenoc -- "https://drive.google.com/file/d/<FILE_ID>/view"
// Downloads one publicly shared Chinese Taipei Olympic Committee daily schedule PDF and
// parses it. Independent of the Results API pipeline: nothing is merged here.
// tpenoc.net itself is never contacted; the caller supplies the Drive link.
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { parseTpenoc } from '../src/parsers/tpenoc.ts';
import type { Fragment } from '../src/parsers/tpenoc.ts';
import { ROOT, save } from '../src/utils/storage.ts';

const run = promisify(execFile);
const input = process.argv[2];
if (!input) throw new Error('用法：npm run fetch:tpenoc -- "<Google Drive 檔案網址>"');
const url = new URL(input);
if (url.hostname !== 'drive.google.com') throw new Error('只接受 drive.google.com 的公開檔案網址');
const id = /\/file\/d\/([A-Za-z0-9_-]{10,})/.exec(url.pathname)?.[1] ?? url.searchParams.get('id');
if (!id || !/^[A-Za-z0-9_-]{10,}$/.test(id)) throw new Error('網址中找不到 Google Drive file ID');

const download = `https://drive.google.com/uc?export=download&id=${id}`;
const started = performance.now();
const response = await fetch(download, { redirect:'follow', signal:AbortSignal.timeout(30000) });
const checkedAt = new Date().toISOString();
if (!response.ok) throw new Error(`下載失敗：HTTP ${response.status}；不重試`);
const body = Buffer.from(await response.arrayBuffer());
// Fail closed on anything that is not a PDF: a Drive permission page is HTML, not a file.
if (body.subarray(0,5).toString('latin1') !== '%PDF-') {
  throw new Error('回應不是 PDF（可能是權限頁或檔案已更換），停止解析');
}
const disposition = response.headers.get('content-disposition') ?? '';
const rawName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? '';
// Drive sends the filename as UTF-8 bytes in a latin1 header.
const sourceFileName = rawName ? Buffer.from(rawName,'latin1').toString('utf8') : `${id}.pdf`;

const stamp = checkedAt.replace(/[:.]/g,'-');
const rawFile = `data/raw/tpenoc-${stamp}-${id.slice(0,8)}.pdf`;
await mkdir(resolve(ROOT,'data/raw'), { recursive:true });
await writeFile(resolve(ROOT,rawFile), body, { flag:'wx' });
const meta = { url:download, sourceUrl:input, http_status:response.status, checked_at:checkedAt,
  data_fetched_at:checkedAt, elapsed_ms:Math.round(performance.now()-started), bytes:body.length,
  content_type:response.headers.get('content-type'), source_file_name:sourceFileName, raw_file:rawFile };
await save(rawFile.replace(/\.pdf$/,'.meta.json'), meta);

// Text layer only; no OCR. A missing Python or pypdf stops the run instead of degrading.
const helper = resolve(ROOT,'scripts/extract-pdf-fragments.py');
let extracted: { pages:number; fragments:Fragment[] };
try {
  const { stdout } = await run('python',[helper,resolve(ROOT,rawFile)],{ encoding:'buffer', maxBuffer:32*1024*1024 });
  extracted = JSON.parse(stdout.toString('utf8'));
} catch(e) {
  throw new Error(`PDF 文字抽取失敗（需要 Python 與 pypdf）：${(e as Error).message}`);
}
if (!extracted.fragments?.length) throw new Error('PDF 沒有可讀文字圖層；本工具不使用 OCR');

const parsed = parseTpenoc(extracted.fragments, sourceFileName);
const report = { schemaVersion:1, source:'TPENOC daily schedule PDF', generatedAt:new Date().toISOString(),
  timezone:'Asia/Taipei', sourceTimezone:'Asia/Tokyo', editorialVerification:'pending',
  crossCheckedWithResultsApi:false, pages:extracted.pages, request:meta, ...parsed };
const output = `data/normalized/tpenoc-${parsed.scheduleDate}.json`;
await save(output, report);

console.log(`中華奧會每日賽程：${parsed.scheduleDate}（檔名 ${sourceFileName}）`);
console.log(`更新時間（日本）：${parsed.updatedAtJst ?? '未標示'}；共 ${parsed.matches.length} 場`);
for (const m of parsed.matches) {
  console.log(`  ${m.timeTaipei} 台灣（${m.timeJst} 日本）  ${m.sport}  ${m.event}  對 ${m.opponent ?? '未列'}`
    + `  ${m.venue ?? '場館未列'}  ${m.athletes.length} 人`);
}
if (parsed.unresolved.length) {
  console.error(`${parsed.unresolved.length} 筆內容無法歸位，需人工確認：`);
  for (const u of parsed.unresolved) console.error(`  ${u.reason}：${u.text}`);
  process.exitCode = 1;
}
console.log(`保存：${output}；原始 PDF：${rawFile}`);
