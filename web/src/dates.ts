// Calendar arithmetic on the database's strings ('YYYY-MM-DD', 'YYYY-MM-DDTHH:MM[:SS]', Korea time without a zone).
// Everything is computed in UTC so the browser's own time zone never shifts a date.

function utc(date: string): Date {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const day = utc(date).getUTCDay();
  return day === 0 ? 7 : day;
}

export function addDays(date: string, n: number): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}

/** The Monday of the ISO week of a date. */
export function weekStart(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

/** Whole days from a to b. */
export function daysBetween(a: string, b: string): number {
  return Math.round((utc(b).getTime() - utc(a).getTime()) / 86400000);
}

/** 'YYYY-MM' plus n months. */
export function addMonths(yearMonth: string, n: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** A timestamp plus n minutes, as 'YYYY-MM-DDTHH:MM:SS'. */
export function addMinutes(ts: string, n: number): string {
  const d = new Date(`${ts.slice(0, 16)}:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + n);
  return d.toISOString().slice(0, 19);
}

/** 'YYYY-MM-DDTHH:MM' for datetime-local inputs. */
export function toInputDateTime(ts: string | null | undefined): string {
  return ts ? ts.slice(0, 16) : '';
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
