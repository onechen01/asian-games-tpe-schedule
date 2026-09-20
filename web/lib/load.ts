import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {parseDaily,validDate} from './schedule.ts';
import {parseRoster} from './roster.ts';
import type {Roster} from './roster.ts';
import {parseDisplayNames} from './display-names.ts';
import type {DisplayNames} from './display-names.ts';
import {parseAthleteMaster} from './athletes.ts';
import type {AthleteMaster} from './athletes.ts';

// The working directory differs between `next start` from the repo root, `next start` inside
// web/, and a deployed serverless function, so data/ is located by probing instead of being
// assumed. DATA_DIR overrides everything when a host needs an explicit path.
const CANDIDATES=['../data','data','../../data'];
function dataDirs(){
 const dirs=process.env.DATA_DIR?[process.env.DATA_DIR]:CANDIDATES.map(d=>path.resolve(process.cwd(),d));
 return [...new Set(dirs)];
}
async function readFirst(relative:string){
 for(const dir of dataDirs()){
  try{return await readFile(path.join(dir,relative),'utf8');}catch{}
 }
 return null;
}
async function listFirst(relative:string){
 for(const dir of dataDirs()){
  try{return {files:await readdir(path.join(dir,relative)),folder:path.join(dir,relative)};}catch{}
 }
 return null;
}
// The site reads the canonical daily file only. It never calls the official API.
export async function loadSchedule(date:string,override?:string){
 if(!validDate(date))return {kind:'invalid' as const,dates:[] as string[]};
 let files:string[],folder:string;
 if(override){
  folder=override;
  try{files=await readdir(folder);}catch{return {kind:'missing' as const,dates:[] as string[]};}
 }else{
  const found=await listFirst('normalized');
  if(!found)return {kind:'missing' as const,dates:[] as string[]};
  ({files,folder}=found);
 }
 const dates=[...new Set(files.map(f=>/^daily-(\d{4}-\d{2}-\d{2})\.json$/.exec(f)?.[1]).filter((d):d is string=>!!d))].sort();
 const filename='daily-'+date+'.json';
 if(!files.includes(filename))return {kind:'missing' as const,dates};
 try{return {kind:'ready' as const,data:parseDaily(JSON.parse(await readFile(path.join(folder,filename),'utf8')),date),dates};}
 catch{return {kind:'error' as const,dates};}
}

// Static Chinese-name reference. Missing or malformed means no Chinese fallback, never a crash.
export async function loadRoster(file?:string):Promise<Roster|null>{
 try{
  const text=file?await readFile(file,'utf8'):await readFirst('reference/tpe-roster-2026.json');
  return text?parseRoster(JSON.parse(text)):null;
 }catch{return null;}
}

// Display-only Chinese for NOC codes and venues. Missing or malformed means the page keeps the
// official English, never a crash.
export async function loadDisplayNames():Promise<DisplayNames>{
 const [noc,venue]=await Promise.all([readFirst('reference/noc-zh.json'),readFirst('reference/venue-zh.json')]);
 return parseDisplayNames(noc,venue);
}

// Verified Chinese athlete names. Missing or malformed leaves every name in English.
export async function loadAthletes():Promise<AthleteMaster>{
 return parseAthleteMaster(await readFirst('reference/tpe-athlete-master.json'));
}
