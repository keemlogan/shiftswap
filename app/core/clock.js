// Demo clock (System Clock actor A3). The app never reads the real time; every rule uses now().

export const DEFAULT_NOW = '2026-09-28T09:00';
const KEY = 'shiftswap.clock.v1';

let storage = null;
let current = DEFAULT_NOW;

/** Attach browser storage so the demo clock survives reloads (not used in Node tests). */
export function attachClockStorage(store) {
  storage = store;
  const saved = store && store.getItem(KEY);
  current = saved && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(saved) ? saved : DEFAULT_NOW;
}

export function now() {
  return current;
}

export function setNow(iso) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(iso)) throw new Error(`Invalid demo time: ${iso}`);
  current = iso;
  if (storage) storage.setItem(KEY, current);
  return current;
}

/** Move the demo clock forward by the given number of minutes. */
export function advance(minutes) {
  const ms = Date.parse(`${current}:00Z`) + minutes * 60000;
  return setNow(new Date(ms).toISOString().slice(0, 16));
}

/** Add minutes to an ISO datetime without touching the clock. */
export function addMinutes(iso, minutes) {
  return new Date(Date.parse(`${iso}:00Z`) + minutes * 60000).toISOString().slice(0, 16);
}

export function resetClock() {
  current = DEFAULT_NOW;
  if (storage) storage.removeItem(KEY);
}
