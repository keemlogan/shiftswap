// Shared mode (spec §9, iteration 8): the gateway between the in-memory replica of one store (db.js) and the shared
// database (db/app-shared.sql). Commands run the unchanged services against the replica; the row changes are sent to
// app_commit with the revision they were computed from. The server decides: it refuses stale revisions, enforces the
// state machine of spec §7 against its own time, and limits the rate and size of changes.
import { TABLES, keyOf, loadTables, dumpTables } from './db.js';
import { useServerTime } from './clock.js';
import { ServiceError } from './services.js';

export const snake = (key) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
export const camel = (key) => key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

const mapKeys = (row, fn) => Object.fromEntries(Object.entries(row).map(([k, v]) => [fn(k), v]));

function sameRow(a, b) {
  const keys = Object.keys(b);
  return keys.length === Object.keys(a).length && keys.every((k) => a[k] === b[k]);
}

/**
 * The row changes that turn `before` into `after` ({Table: [rows]} as dumpTables returns them):
 * [{t: table, op: 'insert'|'update'|'delete', row: every column in snake_case}].
 */
export function diffTables(before, after) {
  const changes = [];
  for (const t of TABLES) {
    const key = keyOf(t);
    const old = new Map((before[t] || []).map((row) => [row[key], row]));
    for (const row of after[t] || []) {
      const prev = old.get(row[key]);
      old.delete(row[key]);
      if (!prev) changes.push({ t, op: 'insert', row: mapKeys(row, snake) });
      else if (!sameRow(prev, row)) changes.push({ t, op: 'update', row: mapKeys(row, snake) });
    }
    for (const row of old.values()) changes.push({ t, op: 'delete', row: mapKeys(row, snake) });
  }
  return changes;
}

/** PostgREST access with the publishable key: the three RPCs and the store revision (read-only). */
export function restTransport({ url, key, fetchFn = (...args) => fetch(...args) }) {
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  async function call(path, init) {
    let res;
    try {
      res = await fetchFn(`${url}${path}`, { ...init, headers, cache: 'no-store' });
    } catch (err) {
      throw Object.assign(new Error('The shared database cannot be reached.'), { offline: true, cause: err });
    }
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const message = body && typeof body === 'object' && typeof body.message === 'string' ? body.message : String(text || res.statusText);
      throw Object.assign(new Error(message), { status: res.status, serverMessage: message });
    }
    return body;
  }
  return {
    rpc: (name, args) => call(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(args) }),
    rev: async (store) => {
      const rows = await call(`/rest/v1/app_store?slug=eq.${encodeURIComponent(store)}&select=rev`, { method: 'GET' });
      return Array.isArray(rows) && rows.length ? rows[0].rev : null;
    },
  };
}

const LIMITS = [
  ['RESET_RATE_LIMIT', 'RESET_RATE_LIMIT'], ['RESET_DAILY_LIMIT', 'RESET_DAILY_LIMIT'], ['RATE_LIMIT', 'SHARED_RATE_LIMIT'],
  ['DAILY_LIMIT', 'SHARED_DAILY_LIMIT'], ['STORE_FULL', 'SHARED_FULL'], ['UNKNOWN_STORE', 'SHARED_UNAVAILABLE'], ['STALE', 'STALE'],
];

/** The error code of a failed request: STALE, SHARED_OFFLINE, SHARED_UNAVAILABLE, a limit, or SHARED_REFUSED. */
export function classify(err) {
  if (err && err.code && !err.status && !err.offline) return err.code; // already a ServiceError
  if (!err || err.offline) return 'SHARED_OFFLINE';
  const message = err.serverMessage || '';
  const found = LIMITS.find(([prefix]) => message.startsWith(prefix));
  if (found) return found[1];
  if (!err.status || err.status >= 500 || [401, 403, 404].includes(err.status)) return 'SHARED_UNAVAILABLE';
  return 'SHARED_REFUSED'; // a rule of the server (trigger RULE:, CONFLICT, constraint) refused the change
}

const MESSAGES = {
  SHARED_BUSY: 'Other people changed the same data at the same moment several times. Try again.',
  SHARED_REFUSED: 'The shared database did not accept this change. The latest data were loaded again.',
  SHARED_OFFLINE: 'The shared database cannot be reached. The change was not saved.',
  SHARED_UNAVAILABLE: 'The shared database is not available.',
  SHARED_RATE_LIMIT: 'The demo store accepts at most 60 changes a minute.',
  SHARED_DAILY_LIMIT: 'The demo store accepts at most 3000 changes a day.',
  SHARED_FULL: 'The demo store is full; reset the demo data.',
  RESET_RATE_LIMIT: 'The demo data can be reset once a minute.',
  RESET_DAILY_LIMIT: 'The demo data can be reset 50 times a day.',
};

function sharedError(code, err) {
  const final = code === 'STALE' ? 'SHARED_BUSY' : code;
  return new ServiceError(final, MESSAGES[final] || MESSAGES.SHARED_REFUSED, { detail: err && err.serverMessage ? err.serverMessage : '' });
}

/**
 * The shared-mode gateway of one store. Every operation waits for the previous one (commands, system work, polling
 * and reset never overlap). onReload() is called when the replica was reloaded outside a command, so that the
 * screen can be drawn again.
 */
export function createGateway({ SQL, transport, store, onReload = () => {}, retries = { stale: 3, refused: 1 }, pause = 60000 }) {
  let rev = null;
  let base = null;
  let queue = Promise.resolve();
  let pending = 0;
  let pausedUntil = 0;

  function enqueue(job) {
    pending += 1;
    const next = queue.then(job).finally(() => { pending -= 1; });
    queue = next.catch(() => {});
    return next;
  }

  function apply(snapshot, localMs) {
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.tables) {
      throw new ServiceError('SHARED_UNAVAILABLE', MESSAGES.SHARED_UNAVAILABLE, { detail: `store ${store} not found` });
    }
    const tables = {};
    for (const t of TABLES) tables[t] = (snapshot.tables[t] || []).map((row) => mapKeys(row, camel));
    loadTables(SQL, tables);
    base = dumpTables();
    rev = snapshot.rev;
    useServerTime(snapshot.now, localMs);
  }

  // The server time is read when the answer arrives, so the local clock never runs ahead of the server.
  async function fetchSnapshot() {
    let snapshot;
    try {
      snapshot = await transport.rpc('app_snapshot', { p_store: store });
    } catch (err) {
      throw sharedError(classify(err), err);
    }
    apply(snapshot, Date.now());
  }

  async function commit(changes, after) {
    const res = await transport.rpc('app_commit', { p_store: store, p_base_rev: rev, p_changes: changes });
    base = after;
    rev = res.rev;
    useServerTime(res.now, Date.now());
  }

  /** After a failed commit: load the server state again; without a connection, go back to the last saved state. */
  async function recover(code) {
    if (code !== 'SHARED_OFFLINE') {
      try {
        await fetchSnapshot();
        return;
      } catch {
        // fall through: keep the last saved state
      }
    }
    loadTables(SQL, base);
  }

  async function runCommand(fn) {
    let stale = 0;
    let refused = 0;
    for (;;) {
      let result;
      let error = null;
      try {
        result = fn();
      } catch (err) {
        error = err;
      }
      const after = dumpTables();
      const changes = diffTables(base, after);
      if (changes.length) {
        try {
          await commit(changes, after);
        } catch (err) {
          const code = classify(err);
          await recover(code);
          if (code === 'STALE' && stale < retries.stale) { stale += 1; continue; }
          if (code === 'SHARED_REFUSED' && refused < retries.refused) { refused += 1; continue; }
          onReload(); // the screen may show changes that were not saved
          throw sharedError(code, err);
        }
      }
      if (error) throw error;
      return result;
    }
  }

  return {
    get rev() { return rev; },
    /** True while a command, system work, polling or a reset is running or waiting. */
    busy: () => pending > 0,
    /** Load the store (boot). */
    load: () => enqueue(fetchSnapshot),
    /** Run a user command (a service call) and save its changes; errors are ServiceErrors. */
    command: (fn) => enqueue(() => runCommand(fn)),
    /** Whether the System Clock duties may run now (paused for a minute after the server refused them). */
    systemAllowed: () => Date.now() >= pausedUntil,
    /** Save the changes made while drawing the screen (System Clock duties, weekly recompute). */
    settle: () => enqueue(async () => {
      if (Date.now() < pausedUntil) return false;
      const after = dumpTables();
      const changes = diffTables(base, after);
      if (!changes.length) return false;
      try {
        await commit(changes, after);
        return true;
      } catch (err) {
        const code = classify(err);
        if (code !== 'STALE') pausedUntil = Date.now() + pause;
        await recover(code);
        onReload();
        return false;
      }
    }),
    /** Read the revision of the store; when another person changed it, load it again. */
    poll: () => enqueue(async () => {
      const remote = await transport.rev(store);
      if (remote === null || remote === rev) return false;
      await fetchSnapshot();
      onReload();
      return true;
    }),
    /** Reset the demo data of the store for everyone (app_reset) and load the new state. */
    reset: () => enqueue(async () => {
      try {
        await transport.rpc('app_reset', { p_store: store });
      } catch (err) {
        throw sharedError(classify(err), err);
      }
      pausedUntil = 0;
      await fetchSnapshot();
    }),
  };
}
