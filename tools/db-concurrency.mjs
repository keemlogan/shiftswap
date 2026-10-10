// TC-05x with two concurrent connections (NFR-04, spec §9.5): against a real PostgreSQL that has db/shiftswap.sql
// loaded, reset the demo data, then let Choi Minho (3) and Kang Doyun (5) accept the seed request 1 at the same time,
// each in its own transaction. Exactly one acceptance must succeed and the other must be refused with ALREADY_TAKEN
// naming the first acceptor; the request row is changed once.
//
//   DATABASE_URL=postgres://user:pass@localhost:5432/db node tools/db-concurrency.mjs
//
// The script resets the demo data before and after the run, so it refuses a database that is not on this computer
// unless --allow-remote is given. The PostgreSQL client `pg` is not a dependency of the project: when it cannot be
// imported, install it outside the project and point PG_MODULE_DIR at that directory (see the hint printed below).
import { createRequire } from 'node:module';
import path from 'node:path';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '']);

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

async function loadPg() {
  try {
    return (await import('pg')).default;
  } catch {
    // not installed in the project
  }
  if (process.env.PG_MODULE_DIR) {
    try {
      return createRequire(path.join(path.resolve(process.env.PG_MODULE_DIR), 'index.js'))('pg');
    } catch {
      // fall through to the hint
    }
  }
  return fail([
    'The PostgreSQL client "pg" is not installed (it is not a dependency of this project).',
    'Install it in a scratch directory outside the project and run the script with PG_MODULE_DIR:',
    '  mkdir -p /tmp/pg-scratch && npm install --prefix /tmp/pg-scratch pg@8',
    '  PG_MODULE_DIR=/tmp/pg-scratch DATABASE_URL=postgres://… node tools/db-concurrency.mjs',
  ].join('\n'), 2);
}

const url = process.env.DATABASE_URL;
if (!url) fail('Set DATABASE_URL to a PostgreSQL database with db/shiftswap.sql loaded, e.g. postgres://postgres@localhost:5432/shiftswap', 2);
let host;
try {
  host = new URL(url).hostname;
} catch {
  fail('DATABASE_URL is not a valid URL.', 2);
}
if (!LOCAL_HOSTS.has(host) && !process.argv.includes('--allow-remote')) {
  fail(`Refusing to run against ${host}: the script resets the demo data. Use a local database, or pass --allow-remote on purpose.`, 2);
}

const pg = await loadPg();
const connect = async (name) => {
  const client = new pg.Client({ connectionString: url, application_name: `shiftswap-tc05x-${name}` });
  await client.connect();
  return client;
};

const minho = await connect('minho');
const doyun = await connect('doyun');
let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures += 1;
};

try {
  await minho.query('select public.reset_demo_data()');
  const before = (await minho.query("select status, acceptor_id from public.sub_request where id = 1")).rows[0];
  check(before && before.status === 'REQUESTED' && before.acceptor_id === null, 'seed request 1 is REQUESTED without an acceptor');

  // Two transactions, both calls sent before either commits. The call that changes the row first holds its lock; the
  // other UPDATE waits for that transaction, re-checks status = 'REQUESTED' on the new row version and changes nothing.
  await minho.query('begin');
  await doyun.query('begin');
  const calls = [
    { name: 'Choi Minho', workerId: 3, client: minho },
    { name: 'Kang Doyun', workerId: 5, client: doyun },
  ].map((call) => ({
    ...call,
    outcome: call.client.query('select public.accept_sub_request(1, $1) as r', [call.workerId]).then(
      (res) => ({ call, ok: true, result: res.rows[0].r, at: Date.now() }),
      (err) => ({ call, ok: false, error: err, at: Date.now() }),
    ),
  }));
  const first = await Promise.race(calls.map((c) => c.outcome));
  const other = calls.find((c) => c.name !== first.call.name);
  // Keep the first transaction open a moment, so the other call is visibly waiting for its row lock.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const committedAt = Date.now();
  await first.call.client.query(first.ok ? 'commit' : 'rollback');
  const second = await other.outcome;
  await other.client.query(second.ok ? 'commit' : 'rollback');

  console.log(`first:  ${first.call.name} → ${first.ok ? JSON.stringify(first.result) : `${first.error.message} ${first.error.detail ?? ''}`}`);
  console.log(`second: ${second.call.name} → ${second.ok ? JSON.stringify(second.result) : `${second.error.message} ${second.error.detail ?? ''}`} ` +
    `(${second.at >= committedAt ? 'answered after the first transaction committed' : 'answered before the first commit'})`);
  const results = [first, second];
  const winners = results.filter((r) => r.ok);
  const losers = results.filter((r) => !r.ok);
  check(winners.length === 1, 'exactly one acceptance succeeded');
  check(losers.length === 1 && losers[0].error.message === 'ALREADY_TAKEN', 'the other acceptance was refused with ALREADY_TAKEN');
  if (winners.length === 1 && losers.length === 1 && losers[0].error.detail) {
    const detail = JSON.parse(losers[0].error.detail);
    check(detail.acceptor_id === winners[0].call.workerId && detail.acceptor_name === winners[0].call.name,
      `the refusal names the first acceptor (${detail.acceptor_name}; hint: "${losers[0].error.hint}")`);
  }
  const after = (await minho.query('select status, acceptor_id from public.sub_request where id = 1')).rows[0];
  check(after.status === 'ACCEPTED' && winners.length === 1 && after.acceptor_id === winners[0].call.workerId,
    `request 1 is ACCEPTED by ${winners[0]?.call.name ?? '—'}`);
  const targets = (await minho.query('select worker_id, response from public.sub_request_target where sub_request_id = 1 order by worker_id')).rows;
  check(targets.filter((t) => t.response === 'ACCEPTED').length === 1 && targets.filter((t) => t.response === 'CLOSED').length === 2,
    `one target ACCEPTED, two CLOSED (${targets.map((t) => `${t.worker_id}:${t.response}`).join(', ')})`);
  const accepted = Number((await minho.query("select count(*) from public.notification where sub_request_id = 1 and kind = 'REQUEST_ACCEPTED'")).rows[0].count);
  check(accepted === 2, 'REQUEST_ACCEPTED was sent once each to the requester and the owner');
} finally {
  try {
    await minho.query('rollback').catch(() => {});
    await minho.query('select public.reset_demo_data()');
  } finally {
    await minho.end();
    await doyun.end();
  }
}

console.log(failures === 0 ? 'TC-05x two connections: passed' : `TC-05x two connections: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
