export const DISPLAY_TIMEZONE = 'Asia/Taipei';
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: DISPLAY_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

export function parseTime(raw: unknown): { utc: string; taipei: string } | null {
  if (typeof raw !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(raw)) return null;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));
  const wall = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  // Compute the display zone offset from Intl; do not assume source time is Japanese.
  const offsetMinutes = Math.round((Date.parse(wall + 'Z') - date.getTime()) / 60000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const offset = `${sign}${String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2,'0')}:${String(Math.abs(offsetMinutes) % 60).padStart(2,'0')}`;
  return { utc: date.toISOString(), taipei: wall + offset };
}
export const taipeiTime = (raw: unknown): string | null => parseTime(raw)?.taipei ?? null;
export function validateDate(value: string | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0,10) !== value) throw new Error('Use a valid date: YYYY-MM-DD');
  return value;
}
export const nextDay = (date: string): string => new Date(Date.parse(date) + 86400000).toISOString().slice(0,10);
