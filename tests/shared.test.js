// TC-16x shared mode (spec §9, NFR-04, NFR-14, NFR-15): change sets, stale re-run, error mapping and the seed template,
// against an in-process fake of the shared database that behaves like app_snapshot / app_commit / app_reset.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { createDatabase, dumpTables, loadTables, get, all, TABLES, keyOf } from '../app/core/db.js';
import { resetClock, now, setNow, usesServerTime } from '../app/core/clock.js';
import * as svc from '../app/core/services.js';
import { diffTables, classify, createGateway, restTransport, snake, camel } from '../app/core/shared.js';
import { SQL_FILE, templateSql, withTemplate } from '../tools/seed-sql.mjs';
import { t, setLang } from '../app/ui/i18n.js';

const SQL = await initSqlJs();
globalThis.document ??= { documentElement: {} }; // setLang() sets the page language
const SERVER_NOW = Date.parse('2026-09-28T00:00:00Z'); // 09:00 in Korea, the seed time

/** The seed of spec §10 as the server keeps it: {Table: [snake_case rows]}. */
function seedTables({ payroll = true } = {}) {
  resetClock();
  createDatabase(SQL);
  const dump = dumpTables();
  const out = {};
  for (const table of TABLES) out[table] = table === 'Payroll' && !payroll ? [] : dump[table].map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [snake(k), v])));
  return out;
}

/** A fake shared database: one store, revisions, STALE, and errors queued with fail(). */
function fakeServer(tables, { serverNow = SERVER_NOW } = {}) {
  const state = {};
  const load = (src) => {
    for (const table of TABLES) state[table] = new Map(src[table].map((r) => [r[keyOf(table)], { ...r }]));
  };
  load(tables);
  const server = { rev: 1, commits: [], failures: [], serverNow, resets: 0 };
  const snapshot = () => ({
    rev: server.rev,
    now: server.serverNow,
    tables: Object.fromEntries(TABLES.map((table) => [table, [...state[table].values()].sort((a, b) => a[keyOf(table)] - b[keyOf(table)])])),
  });
  server.state = () => snapshot().tables;
  server.fail = (error) => server.failures.push(error);
  /** Another person's change set, applied directly (it moves the revision). */
  server.apply = (changes) => {
    const order = { delete: 0, update: 1, insert: 2 };
    for (const c of [...changes].sort((a, b) => order[a.op] - order[b.op])) {
      const key = c.row[keyOf(c.t)];
      if (c.op === 'delete') state[c.t].delete(key);
      else state[c.t].set(key, { ...c.row });
    }
    server.rev += 1;
  };
  server.transport = {
    async rpc(name, args) {
      if (name === 'app_snapshot') return snapshot();
      if (name === 'app_reset') {
        server.resets += 1;
        load(tables);
        server.rev += 1;
        return { rev: server.rev, now: server.serverNow };
      }
      assert.equal(name, 'app_commit');
      if (server.failures.length) throw server.failures.shift();
      if (args.p_base_rev !== server.rev) throw Object.assign(new Error('stale'), { status: 400, serverMessage: `STALE: the store is at revision ${server.rev}` });
      server.commits.push(args.p_changes);
      server.apply(args.p_changes);
      return { rev: server.rev, now: server.serverNow };
    },
    async rev() {
      return server.rev;
    },
  };
  return server;
}

const refused = (message) => Object.assign(new Error(message), { status: 400, serverMessage: message });

async function open(server, options = {}) {
  const reloads = [];
  const gateway = createGateway({ SQL, transport: server.transport, store: 'test', onReload: () => reloads.push(1), ...options });
  await gateway.load();
  return { gateway, reloads };
}

beforeEach(() => {
  resetClock();
  setLang('en');
});

test('TC-160 every column name survives the snake_case mapping of the shared database', () => {
  createDatabase(SQL);
  for (const table of TABLES) {
    const columns = all(`PRAGMA table_info(${table})`).map((c) => c.name);
    for (const c of columns) assert.equal(camel(snake(c)), c, `${table}.${c}`);
  }
});

test('TC-161 diffTables finds inserts, updates and deletes with every column in snake_case', () => {
  const before = { Shift: [{ id: 1, workDate: '2026-09-30', workerId: 2 }, { id: 2, workDate: '2026-10-01', workerId: 3 }], MinimumWage: [{ year: 2026, hourly: 10320 }] };
  const after = { Shift: [{ id: 1, workDate: '2026-09-30', workerId: 3 }, { id: 3, workDate: '2026-10-02', workerId: 4 }], MinimumWage: [{ year: 2026, hourly: 10320 }] };
  assert.deepEqual(diffTables(before, after), [
    { t: 'Shift', op: 'update', row: { id: 1, work_date: '2026-09-30', worker_id: 3 } },
    { t: 'Shift', op: 'insert', row: { id: 3, work_date: '2026-10-02', worker_id: 4 } },
    { t: 'Shift', op: 'delete', row: { id: 2, work_date: '2026-10-01', worker_id: 3 } },
  ]);
  assert.deepEqual(diffTables(after, after), []);
});

test('TC-162 a command saves exactly its row changes; replica, server and server time agree', async () => {
  const server = fakeServer(seedTables());
  await open(server).then(async ({ gateway }) => {
    assert.ok(usesServerTime());
    assert.equal(now(), '2026-09-28T09:00');
    assert.throws(() => setNow('2026-09-29T09:00'), /cannot be set/);
    await gateway.command(() => svc.respondToRequest(1, 3, 'ACCEPTED'));
    assert.equal(server.commits.length, 1);
    const changes = server.commits[0];
    assert.deepEqual([...new Set(changes.map((c) => `${c.t}:${c.op}`))].sort(), ['Notification:insert', 'SubRequest:update', 'SubRequestTarget:update']);
    assert.equal(gateway.rev, 2);
    assert.deepEqual(server.state(), seedTablesFromReplica());
    assert.equal(server.state().SubRequest[0].acceptor_id, 3);
  });
});

function seedTablesFromReplica() {
  const dump = dumpTables();
  return Object.fromEntries(TABLES.map((table) => [table, dump[table].map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [snake(k), v])))]));
}

test('TC-163 first acceptance across browsers: a stale change set is recomputed on the current data (NFR-04)', async () => {
  const server = fakeServer(seedTables());
  const { gateway } = await open(server);
  // Minho accepts in another browser first.
  const before = dumpTables();
  svc.respondToRequest(1, 3, 'ACCEPTED');
  const minho = diffTables(before, dumpTables());
  loadTables(SQL, before);
  server.apply(minho);
  // Doyun's replica is one revision behind: STALE, reload, re-run, and the rule answers.
  await assert.rejects(gateway.command(() => svc.respondToRequest(1, 5, 'ACCEPTED')), (err) => err.code === 'ALREADY_TAKEN');
  assert.equal(server.commits.length, 0);
  assert.equal(get('SELECT acceptorId FROM SubRequest WHERE id = 1').acceptorId, 3);
  assert.equal(gateway.rev, 2);
});

test('TC-164 still stale after three re-runs: SHARED_BUSY, and the replica shows the server data', async () => {
  const server = fakeServer(seedTables());
  const { gateway, reloads } = await open(server);
  for (let i = 0; i < 4; i++) server.fail(refused(`STALE: the store is at revision ${server.rev}`));
  await assert.rejects(gateway.command(() => svc.markNotificationsRead(3)), (err) => err.code === 'SHARED_BUSY');
  assert.equal(server.failures.length, 0);
  assert.equal(reloads.length, 1);
  assert.equal(get('SELECT count(*) AS n FROM Notification WHERE workerId = 3 AND readAt IS NULL').n, 1);
});

test('TC-165 a change the server refuses is re-run once on reloaded data, then reported as SHARED_REFUSED', async () => {
  const server = fakeServer(seedTables());
  const { gateway } = await open(server);
  server.fail(refused('RULE: SubRequest 1 cannot go from REQUESTED to APPROVED'));
  await gateway.command(() => svc.respondToRequest(1, 3, 'ACCEPTED')); // second run succeeds
  assert.equal(server.commits.length, 1);
  server.fail(refused('RULE: the deadline has passed (server time)'));
  server.fail(refused('RULE: the deadline has passed (server time)'));
  await assert.rejects(gateway.command(() => svc.decideRequest(1, 'APPROVED')), (err) => err.code === 'SHARED_REFUSED' && /deadline/.test(err.params.detail));
  assert.equal(get('SELECT status FROM SubRequest WHERE id = 1').status, 'ACCEPTED');
  assert.deepEqual(server.state(), seedTablesFromReplica());
});

test('TC-166 server answers map to the error codes shown in both languages', () => {
  const cases = [
    [refused('STALE: the store is at revision 7'), 'STALE'],
    [refused('RATE_LIMIT: at most 60 changes a minute per store'), 'SHARED_RATE_LIMIT'],
    [refused('DAILY_LIMIT: at most 3000 changes a day per store'), 'SHARED_DAILY_LIMIT'],
    [refused('STORE_FULL: a store holds at most 20000 rows; reset it'), 'SHARED_FULL'],
    [refused('RESET_RATE_LIMIT: one reset a minute'), 'RESET_RATE_LIMIT'],
    [refused('RESET_DAILY_LIMIT: 50 resets a day'), 'RESET_DAILY_LIMIT'],
    [refused('UNKNOWN_STORE'), 'SHARED_UNAVAILABLE'],
    [refused('RULE: a confirmed attendance record cannot be changed'), 'SHARED_REFUSED'],
    [Object.assign(new Error('duplicate key'), { status: 409, serverMessage: 'duplicate key value violates unique constraint' }), 'SHARED_REFUSED'],
    [Object.assign(new Error('x'), { status: 503, serverMessage: '' }), 'SHARED_UNAVAILABLE'],
    [Object.assign(new Error('x'), { status: 401, serverMessage: 'Invalid API key' }), 'SHARED_UNAVAILABLE'],
    [Object.assign(new Error('x'), { offline: true }), 'SHARED_OFFLINE'],
  ];
  for (const [err, code] of cases) assert.equal(classify(err), code, err.serverMessage);
  for (const lang of ['ko', 'en']) {
    setLang(lang);
    for (const code of ['SHARED_BUSY', 'SHARED_REFUSED', 'SHARED_OFFLINE', 'SHARED_UNAVAILABLE', 'SHARED_RATE_LIMIT', 'SHARED_DAILY_LIMIT', 'SHARED_FULL', 'RESET_RATE_LIMIT', 'RESET_DAILY_LIMIT']) {
      assert.notEqual(t(`err.${code}`), `err.${code}`, `${lang} err.${code}`);
    }
  }
});

test('TC-167 offline: nothing is saved and the replica goes back to the last saved state', async () => {
  const server = fakeServer(seedTables());
  const { gateway } = await open(server);
  server.fail(Object.assign(new Error('fetch failed'), { offline: true }));
  await assert.rejects(gateway.command(() => svc.cancelRequest(1, 2)), (err) => err.code === 'SHARED_OFFLINE');
  assert.equal(get('SELECT status FROM SubRequest WHERE id = 1').status, 'REQUESTED');
  assert.equal(server.rev, 1);
  // A rule error without changes is passed on unchanged and sends nothing.
  await assert.rejects(gateway.command(() => svc.respondToRequest(1, 2, 'ACCEPTED')), (err) => err.code && !err.code.startsWith('SHARED_'));
  assert.equal(server.commits.length, 0);
});

test('TC-168 System Clock duties are saved after drawing; a refusal pauses them for a minute', async () => {
  const server = fakeServer(seedTables({ payroll: false }), { serverNow: Date.parse('2026-10-01T00:00:00Z') });
  const { gateway, reloads } = await open(server);
  assert.equal(svc.completeSharedSeed(), true);
  svc.expireOverdue();
  const { yearMonth, created } = svc.prepareMonthlyPayroll();
  assert.equal(yearMonth, '2026-09');
  assert.ok(created > 0);
  assert.equal(await gateway.settle(), true);
  const months = all("SELECT yearMonth, MIN(status) AS status FROM Payroll GROUP BY yearMonth ORDER BY yearMonth");
  assert.deepEqual(months.at(-1), { yearMonth: '2026-09', status: 'DRAFT' });
  assert.ok(months.slice(0, -1).every((m) => m.status === 'CONFIRMED' && m.yearMonth <= '2026-08'));
  assert.deepEqual(server.state(), seedTablesFromReplica());
  assert.equal(svc.completeSharedSeed(), false);
  // A duty the server refuses: reload, onReload, and no duties for a minute.
  svc.markNotificationsRead(1);
  server.fail(refused('RULE: expiry before the deadline'));
  assert.equal(await gateway.settle(), false);
  assert.equal(gateway.systemAllowed(), false);
  assert.equal(reloads.length, 1);
  assert.deepEqual(server.state(), seedTablesFromReplica());
});

test('TC-169 polling reloads another person\'s change; reset for everyone reloads the seed', async () => {
  const server = fakeServer(seedTables());
  const { gateway, reloads } = await open(server);
  assert.equal(await gateway.poll(), false);
  server.apply([{ t: 'Notification', op: 'update', row: { ...server.state().Notification[0], read_at: '2026-09-28T08:59' } }]);
  assert.equal(await gateway.poll(), true);
  assert.equal(reloads.length, 1);
  assert.equal(get('SELECT readAt FROM Notification WHERE id = 1').readAt, '2026-09-28T08:59');
  await gateway.reset();
  assert.equal(server.resets, 1);
  assert.equal(get('SELECT readAt FROM Notification WHERE id = 1').readAt, null);
});

test('TC-16A the seed template of the shared database is up to date with the seed code (spec §10)', () => {
  const text = readFileSync(SQL_FILE, 'utf8');
  assert.equal(withTemplate(text, templateSql(SQL)), text, 'run node tools/seed-sql.mjs');
});

test('TC-16B the REST transport sends only the publishable key and reports server errors', async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('app_commit')) return { ok: false, status: 400, statusText: 'Bad Request', text: async () => JSON.stringify({ code: 'P0001', message: 'STALE: the store is at revision 9' }) };
    return { ok: true, status: 200, text: async () => JSON.stringify([{ rev: 9 }]) };
  };
  const transport = restTransport({ url: 'https://example.supabase.co', key: 'sb_publishable_test', fetchFn });
  assert.equal(await transport.rev('dalbit'), 9);
  await assert.rejects(transport.rpc('app_commit', { p_store: 'dalbit' }), (err) => classify(err) === 'STALE');
  assert.equal(calls[0].url, 'https://example.supabase.co/rest/v1/app_store?slug=eq.dalbit&select=rev');
  assert.equal(calls[0].init.headers.apikey, 'sb_publishable_test');
  assert.equal(calls[0].init.headers.Authorization, undefined);
  const offline = restTransport({ url: 'https://example.supabase.co', key: 'k', fetchFn: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(offline.rpc('app_snapshot', {}), (err) => classify(err) === 'SHARED_OFFLINE');
});
