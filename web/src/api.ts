// The only way to the data (spec §9.1): database functions called with supabase.rpc(). The front end never reads or
// writes a table. A refusal arrives as { code: 'P0001', message: '<CODE>', details: '<json>', hint: '<sentence>' } and
// becomes an ApiError with the code of §9.2 and its parameters.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from './config';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

export class ApiError extends Error {
  /** A code of spec §9.2, 'CHECK_VIOLATION' (SQLSTATE 23514), 'NETWORK' or 'UNKNOWN'. */
  code: string;
  params: Record<string, unknown>;
  hint: string;

  constructor(code: string, params: Record<string, unknown>, hint: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.params = params;
    this.hint = hint;
  }
}

function parseDetails(details: string | null | undefined): Record<string, unknown> {
  if (!details) return {};
  try {
    const value: unknown = JSON.parse(details);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Calls in flight, shown as aria-busy on the page so that people (and the headless check) can tell when it is idle.
let inFlight = 0;
const busyListeners = new Set<(busy: boolean) => void>();

function setInFlight(delta: number) {
  inFlight += delta;
  document.body.setAttribute('aria-busy', inFlight > 0 ? 'true' : 'false');
  busyListeners.forEach((l) => l(inFlight > 0));
}

export function onBusyChange(listener: (busy: boolean) => void): () => void {
  busyListeners.add(listener);
  return () => busyListeners.delete(listener);
}

/** Call one database function; resolves to its result or throws an ApiError. */
export async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  setInFlight(1);
  try {
    const { data, error } = await supabase.rpc(name, args);
    if (error) {
      const code = /^[A-Z][A-Z_]+$/.test(error.message) ? error.message
        : error.code === '23514' ? 'CHECK_VIOLATION'
          : !error.code ? 'NETWORK' : 'UNKNOWN';
      throw new ApiError(code, parseDetails(error.details), error.hint || '', error.message);
    }
    return data as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError('NETWORK', {}, '', String(err));
  } finally {
    setInFlight(-1);
  }
}

let clockRun: Promise<void> | null = null;

/**
 * The System Clock's duties (A3, §9.4): expire overdue requests and prepare missing payroll drafts before a screen
 * reads its data. Concurrent callers share one call, so one browser never drafts the same month twice at once.
 */
export function runSystemClock(): Promise<void> {
  if (!clockRun) {
    clockRun = rpc('run_system_clock')
      .then(() => undefined)
      .finally(() => { clockRun = null; });
  }
  return clockRun;
}
