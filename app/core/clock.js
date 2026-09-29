// System Clock (actor A3). Every rule uses now(). Local demonstration mode: a demo clock that the user can set;
// shared mode (iteration 8): the server's time in Korea, taken from the shared database, which cannot be set.

export const DEFAULT_NOW = '2026-09-28T09:00';
const KEY = 'shiftswap.clock.v1';
const KST = 9 * 3600000;

let storage = null;
let current = DEFAULT_NOW;
let offset = null; // shared mode: server time minus this computer's time, in ms

/** Attach browser storage so the demo clock survives reloads (not used in Node tests). */
export function attachClockStorage(store) {
  storage = store;
  const saved = store && store.getItem(KEY);
  current = saved && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(saved) ? saved : DEFAULT_NOW;
}

export function now() {
  if (offset !== null) return new Date(Date.now() + offset + KST).toISOString().slice(0, 16);
  return current;
}

/** Shared mode: follow the server clock. serverMs = server time (epoch ms) measured at localMs on this computer. */
export function useServerTime(serverMs, localMs = Date.now()) {
  offset = serverMs - localMs;
}

export function usesServerTime() {
  return offset !== null;
}

export function setNow(iso) {
  if (offset !== null) throw new Error('The server clock cannot be set.');
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
  offset = null;
  current = DEFAULT_NOW;
  if (storage) storage.removeItem(KEY);
}
