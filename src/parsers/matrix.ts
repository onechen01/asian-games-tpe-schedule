// Schedule matrix: one small response that says which discipline competes on which day.
// Source: ALL/schedule/matrix, an endpoint the official Results front end loads itself.
// Cell values observed: 'N' = no competition, '0' = competition, '1' = medal day.
// Dates are venue-local (Japan) calendar days, the same semantics the daily endpoint uses.
export type MatrixDiscipline = { code:string; name:string; dates:string[]; medalDates:string[] };
export type Matrix = { dates:string[]; disciplines:MatrixDiscipline[]; live:string[] };

export function parseMatrix(value: unknown): Matrix {
  const root = value as { dates?:unknown; matrix?:unknown; live?:unknown };
  const dates = root?.dates;
  if (!Array.isArray(dates) || !dates.length || !dates.every(d=>typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))) {
    throw new Error('Schema change: matrix dates are not a non-empty list of calendar days');
  }
  if (!Array.isArray(root.matrix) || !root.matrix.length) throw new Error('Schema change: matrix rows missing');
  const disciplines = (root.matrix as unknown[]).map((entry)=>{
    const row = entry as { Disc?:{Key?:unknown;Desc?:unknown}; Dates?:unknown };
    const code = row?.Disc?.Key, name = row?.Disc?.Desc, cells = row?.Dates;
    if (typeof code !== 'string' || !/^[A-Z0-9]{3}$/.test(code)) throw new Error(`Schema change: unexpected matrix discipline code ${String(code)}`);
    if (typeof name !== 'string' || !name.trim()) throw new Error(`Schema change: matrix discipline ${code} has no name`);
    if (!Array.isArray(cells) || cells.length !== dates.length) throw new Error(`Schema change: ${code} cell count does not match the date list`);
    if (!cells.every(c=>c === 'N' || c === '0' || c === '1')) throw new Error(`Schema change: ${code} has an unrecognised cell value`);
    return { code, name,
      dates:dates.filter((_,i)=>cells[i] !== 'N'),
      medalDates:dates.filter((_,i)=>cells[i] === '1') };
  });
  if (new Set(disciplines.map(d=>d.code)).size !== disciplines.length) throw new Error('Schema change: duplicate discipline in matrix');
  const live = Array.isArray(root.live)
    ? (root.live as {Key?:unknown}[]).map(d=>d?.Key).filter((k):k is string=>typeof k === 'string') : [];
  return { dates, disciplines, live };
}

// The discipline/day pairs the matrix marks as competing, in the given day order.
// Pairs marked 'N' are left out, so no request is spent on a day with no competition.
export function activeDisciplineDays(matrix: Matrix, days: string[]): { targets:{code:string;date:string;medalDay:boolean}[]; unlistedDays:string[] } {
  const unlistedDays = days.filter(d=>!matrix.dates.includes(d));
  const targets = days.flatMap(day=>matrix.disciplines
    .filter(d=>d.dates.includes(day))
    .map(d=>({ code:d.code, date:day, medalDay:d.medalDates.includes(day) })));
  return { targets, unlistedDays };
}

// A Taiwan calendar day spans two Japanese days, so callers pass both and get the union.
// An unknown day (outside the published date list) is reported rather than silently treated as empty.
export function activeDisciplines(matrix: Matrix, days: string[]): { codes:string[]; unlistedDays:string[] } {
  const unlistedDays = days.filter(d=>!matrix.dates.includes(d));
  const codes = matrix.disciplines
    .filter(d=>days.some(day=>d.dates.includes(day)))
    .map(d=>d.code);
  return { codes, unlistedDays };
}
