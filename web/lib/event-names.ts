// Display-only Chinese for official event and phase names.
// The canonical data keeps the official English verbatim; this file only decides what the
// page shows. A string is translated in full or not at all: if any part is unrecognised the
// official English is shown, so nothing is invented and nothing comes out half-translated.
type Rule = [RegExp, string];

const rules:Rule[] = [
  // Gender and participation
  // A placeholder event ("Men's") is still a real name to the reader: it is the men's event.
  [/^Men's$|^Men$/, '男子'], [/^Women's$|^Women$/, '女子'],
  [/^Men's |^Men /, '男子'], [/^Women's |^Women /, '女子'], [/^Mixed(?:'s)? /, '混合'],
  // Shooting, archery, fencing and combat-sport wording that the Games data uses verbatim
  [/(\d+)m Air Rifle/, '$1公尺空氣步槍'], [/(\d+)m Air Pistol/, '$1公尺空氣手槍'],
  [/(\d+)m Rifle 3 Positions/, '$1公尺步槍三姿'], [/(\d+)m Pistol/, '$1公尺手槍'],
  [/Skeet/, '雙向飛靶'], [/Trap/, '定向飛靶'],
  [/Recurve/, '反曲弓'], [/Compound/, '複合弓'],
  [/Épée/, '銳劍'], [/Sabre/, '軍刀'], [/Foil/, '鈍劍'],
  [/Kumite/, '對打'], [/Kata/, '型'],
  [/Traditional/, '傳統'], [/Modern/, '現代'],
  [/Baseball/, '棒球'], [/Softball/, '壘球'],
  [/Dinghy/, '帆船'], [/Shortboard/, '短板'],
  [/Elimination Round of (\d+)/, '$1強淘汰賽'], [/Eliminations?/, '淘汰賽'],
  [/1\/(\d+) (?:Eliminations|Finals)/, '$1強賽'],
  [/Group Phase - Group ([A-Z])/, '小組賽$1組'],
  [/Preliminary Round - Pool ([A-Z])/, '預賽$1組'],
  [/Opening Round Group ([A-Z])/, '首輪$1組'],
  [/Round Robin Pool ([A-Z])/, '循環賽$1組'],
  [/Classification Match (\S+)/, '排名賽$1'], [/Classification \((\S+)\)/, '排名賽$1'],
  [/Play-in/, '附加賽'], [/Placement Round/, '排名賽'],
  [/All Groups/, '總量級'], [/Scratch Race/, '捕捉賽'],
  [/^Men$/, '男子'], [/^Women$/, '女子'],
  [/(\d+) x (\d+)m Medley Relay/, '$1×$2公尺混合式接力'],
  [/Wrestling/, '角力'], [/Dressage/, '馬場馬術'], [/Jumping/, '障礙超越'],
  [/Group All-Around/, '團體全能'],
  [/B-Boys/, '霹靈舞男子組'], [/B-Girls/, '霹靈舞女子組'],
  // Distances, relays and weights
  [/(\d+) x (\d+)m Relay/, '$1×$2公尺接力'],
  [/(\d+)m Hurdles/, '$1公尺跨欄'], [/(\d+)m Race Walk/, '$1公尺競走'],
  [/Half Marathon Race Walk/, '半程馬拉松競走'],
  [/(\d+)m Freestyle/, '$1公尺自由式'], [/(\d+)m Backstroke/, '$1公尺仰式'],
  [/(\d+)m Breaststroke/, '$1公尺蛙式'], [/(\d+)m Butterfly/, '$1公尺蝶式'],
  [/(\d+)m Individual Medley/, '$1公尺個人混合式'], [/(\d+)m Medley Relay/, '$1公尺混合式接力'],
  [/(\d+)m\b/, '$1公尺'],
  [/-(\d+(?:\.\d+)?) ?kg/i, '$1公斤級以下'], [/\+(\d+(?:\.\d+)?) ?kg/i, '$1公斤級以上'],
  [/\b(\d+(?:\.\d+)?) ?kg\b/i, '$1公斤級'],
  // Formats
  [/Individual Time Trial/, '個人計時賽'], [/Team Pursuit/, '團隊追逐賽'],
  [/Individual Medley/, '個人混合式'], [/Medley Relay/, '混合式接力'],
  [/Road Race/, '公路賽'], [/Cross-country/, '越野賽'],
  [/Team Kata/, '團體型'], [/Individual Kata/, '個人型'],
  [/Individual Poomsae/, '個人品勢'],
  [/Individual Stroke Play/, '個人桿數賽'],
  [/Double Sculls/, '雙人雙槳'], [/Single Sculls/, '單人雙槳'],
  [/Kayak Double/, '雙人輕艇'], [/Kayak Single/, '單人輕艇'], [/Canoe Single/, '單人划艇'],
  [/Mixed Doubles/, '混合雙打'], [/Mixed Team/, '混合團體'], [/Mixed Relay/, '混合接力'],
  [/Doubles/, '雙打'], [/Singles/, '單打'],
  [/Team/, '團體'], [/Individual/, '個人'], [/Relay/, '接力'],
  // Phases
  [/Victory Ceremony/, '頒獎典禮'],
  [/Bronze Medal Bout|Bronze Medal Match/, '銅牌戰'],
  [/Quarter-?finals?|Quarter-?Finals?/, '8強賽'],
  [/Semi-?finals?|Semi-?Finals?/, '準決賽'],
  [/Round of (\d+)/, '$1強賽'],
  [/Qualification Round|Qualifications|Qualification|Qualifier/, '資格賽'],
  [/Preliminaries|Preliminary race|Preliminary/, '預賽'],
  [/Heats|Heat\b/, '預賽'],
  [/Finals?/, '決賽'],
  [/Round Robin/, '循環賽'],
  [/Round (\d+)/, '第$1輪'], [/First Round/, '第1輪'], [/Second Round/, '第2輪'],
  [/Third Round/, '第3輪'],
  [/Group Phase - Group ([A-Z])/, '小組賽$1組'], [/Group ([A-Z])\b/, '小組賽$1組'],
  [/Pool ([A-Z])\b/, '$1組'],
  // Apparatus and events that appear as whole words
  [/Floor Exercise/, '地板'], [/Pommel Horse/, '鞍馬'], [/Uneven Bars/, '高低槓'],
  [/High Jump/, '跳高'], [/Long Jump/, '跳遠'], [/Triple Jump/, '三級跳遠'],
  [/Shot Put/, '鉛球'], [/Javelin Throw/, '標槍'], [/Decathlon/, '十項全能'],
  [/Heptathlon/, '七項全能'], [/Rings/, '吊環'], [/Vault/, '跳馬'],
  [/Springboard/, '跳板'], [/Synchronised/, '雙人同步'],
  [/Changquan/, '長拳'], [/Taijiquan & Taijijian/, '太極拳與太極劍'],
  [/Daoshu & Gunshu/, '刀術與棍術'],
  [/All-Around/, '全能'], [/Sprint/, '競速賽'], [/Keirin/, '競輪'], [/Omnium/, '全能賽'],
  [/Madison/, '麥迪遜賽'], [/Park/, '公園賽'],
];

const clean = (value:string)=>value.replace(/\s+/g,' ').trim();
// The official names put the gender in different places ("Skeet Men Team", "Baseball Men");
// Chinese always leads with it, so it is moved to the front before anything is translated.
const GENDER_FIRST = /^(?!Men|Women|Mixed)(.+?) (Men|Women|Mixed)(?:'s)? ?(.*)$/;
function frontGender(value:string){
  const m = value.match(GENDER_FIRST);
  if (!m || /[[\]]/.test(value)) return value;
  return clean(`${m[2]}'s ${m[1]} ${m[3]}`);
}
// Anything still holding Latin letters or a leftover connector was not fully understood.
const complete = (value:string)=>!/[A-Za-z]/.test(value);

export function localizeName(value:string|null|undefined):string|null {
  if (!value) return value ?? null;
  let out = frontGender(clean(value));
  for (const [pattern, replacement] of rules) out = out.replace(pattern, replacement);
  out = clean(out.replace(/,/g,'').replace(/\s+/g,''));
  return complete(out) && out ? out : clean(value);
}

// The event is already shown on its own line, so the phase drops the repeated event prefix
// instead of printing "女子團體 女子團體準決賽".
export function phaseLabel(phase:string|null|undefined, event?:string|null):string|null {
  if (!phase) return phase ?? null;
  const p = clean(phase), e = event ? clean(event) : '';
  if (e && p.toLowerCase().startsWith(e.toLowerCase())) {
    const rest = clean(p.slice(e.length));
    if (!rest) return localizeName(p);
    return localizeName(rest);
  }
  return localizeName(p);
}
export const eventLabel = (event:string|null|undefined)=>localizeName(event);
