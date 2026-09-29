// REST test of the shared database (spec §11, NFR-14) with the publishable key, i.e. with the rights of the app.
// It works on a throwaway store 'e2e-<time>' that it creates and deletes with the owner connection of the kit
// (SHIFTSWAP_RUN, default ~/work/shiftswap-kit/run.mjs); the demo store 'dalbit' is only read.
// Usage: node tools/shared-rest.mjs
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

const env = Object.fromEntries(readFileSync(`${homedir()}/.config/shiftswap/supabase.env`, 'utf8').trim().split('\n')
  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const U = `${env.SUPABASE_URL}/rest/v1`;
const KEY = env.SUPABASE_PUBLISHABLE_KEY;
const H = { apikey: KEY, 'Content-Type': 'application/json', ...(KEY.startsWith('eyJ') ? { Authorization: `Bearer ${KEY}` } : {}) };
const RUN = process.env.SHIFTSWAP_RUN || `${homedir()}/work/shiftswap-kit/run.mjs`;
const sql = (q) => execFileSync('node', [RUN, '-c', q], { encoding: 'utf8' });
const STORE = `e2e-${Date.now().toString(36)}`;

const rpc = async (fn, body) => {
  const r = await fetch(`${U}/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const snapshot = async (store = STORE) => (await rpc('app_snapshot', { p_store: store })).body;
const commit = (rev, changes, store = STORE) => rpc('app_commit', { p_store: store, p_base_rev: rev, p_changes: changes });
const refused = (r, code) => r.status >= 400 && new RegExp(`\\b${code}\\b`).test(JSON.stringify(r.body));
let pass = 0;
let fail = 0;
const check = (name, ok, info) => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  ${JSON.stringify(info).slice(0, 400)}`}`);
};
const kst = (ms, minutes = 0) => new Date(ms + (9 * 60 + minutes) * 60e3).toISOString().slice(0, 16);
const row = (s, table, id) => ({ ...s.tables[table].find((r) => r.id === id) });

sql(`insert into public.app_store (slug) values ('${STORE}'); select public.app_reset_store(id) from public.app_store where slug = '${STORE}'`);
const storeId = JSON.parse(sql(`select id from public.app_store where slug = '${STORE}'`))[0].id;
try {
  // ---- Read access ----------------------------------------------------------------------------------------------
  let s = await snapshot();
  const count = (t) => s.tables[t].length;
  check('snapshot of a new store: rev 1, the seed without payroll', s.rev === 1 && count('Shift') === 142 && count('Worker') === 5
    && count('SubRequest') === 1 && count('Notification') === 3 && count('Payroll') === 0, { rev: s.rev, shifts: count('Shift') });
  check('snapshot carries the server time (within 2 minutes of this machine)', Math.abs(s.now - Date.now()) < 120e3, s.now);
  const req = s.tables.SubRequest[0];
  const reqShift = row(s, 'Shift', req.shift_id);
  const nowText = kst(s.now);
  check('reset keeps the seed request open: deadline more than 6 h ahead, same weekday and time',
    req.status === 'REQUESTED' && req.deadline > kst(s.now, 6 * 60) && req.deadline.slice(11) === '21:00'
      && new Date(`${req.deadline.slice(0, 10)}T00:00Z`).getUTCDay() === 2 && reqShift.start_time === '18:00'
      && new Date(`${reqShift.work_date}T00:00Z`).getUTCDay() === 3, { req, reqShift });
  check('reset moves the dates inside notification messages as well',
    s.tables.Notification.every((n) => n.message.includes(reqShift.work_date) && n.message.includes(req.deadline.slice(0, 10))), s.tables.Notification[0]);
  check('reset: no shift that has not ended is WORKED, and no creation time lies ahead of the server',
    s.tables.Shift.every((x) => x.status === 'SCHEDULED' || `${x.work_date}T${x.end_time}` <= nowText)
      && [...s.tables.SubRequest, ...s.tables.Notification].every((x) => x.created_at <= nowText), null);
  check('unknown store: snapshot is null', (await snapshot('no-such-store')) === null, null);
  let x = await fetch(`${U}/app_shift?store_id=eq.${storeId}&select=id&limit=1`, { headers: H });
  check('the tables are readable with the publishable key', x.status === 200 && (await x.json()).length === 1, x.status);
  x = await fetch(`${U}/app_store_gate?select=*`, { headers: H });
  check('the rate-limit counters are not readable', x.status === 401 || x.status === 403, x.status);

  // ---- No direct writes ------------------------------------------------------------------------------------------
  x = await fetch(`${U}/app_notification`, { method: 'POST', headers: H,
    body: JSON.stringify({ store_id: storeId, id: 999, worker_id: 3, kind: 'REQUEST_RECEIVED', message: 'x', created_at: nowText }) });
  check('direct insert is denied', x.status === 401 || x.status === 403, x.status);
  x = await fetch(`${U}/app_worker?store_id=eq.${storeId}&id=eq.2`, { method: 'PATCH', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify({ name: 'X' }) });
  check('direct update is denied', (x.status === 401 || x.status === 403) && row(await snapshot(), 'Worker', 2).name === 'Lee Seoyeon', x.status);
  x = await fetch(`${U}/app_shift?store_id=eq.${storeId}`, { method: 'DELETE', headers: H });
  check('direct delete is denied', (x.status === 401 || x.status === 403) && (await snapshot()).tables.Shift.length === 142, x.status);
  let r = await rpc('app_reset_store', { p_store_id: storeId });
  check('the internal reset function cannot be called', r.status >= 400, r);
  r = await rpc('app_seed_template', {});
  check('the template function cannot be called', r.status >= 400, r.status);

  // ---- Change sets ----------------------------------------------------------------------------------------------
  r = await commit(0, [{ t: 'Notification', op: 'update', row: { ...s.tables.Notification[0], read_at: nowText } }]);
  check('a stale base revision is refused (STALE)', refused(r, 'STALE'), r);
  r = await commit(1, []);
  check('an empty change set is refused (BAD_CHANGES)', refused(r, 'BAD_CHANGES'), r);
  r = await commit(1, [{ t: 'app_store', op: 'update', row: { id: storeId } }]);
  check('an unknown table is refused (BAD_CHANGES)', refused(r, 'BAD_CHANGES'), r);
  r = await commit(1, [{ t: 'Notification', op: 'update', row: { ...s.tables.Notification[0], read_at: nowText } }], 'no-such-store');
  check('an unknown store is refused (UNKNOWN_STORE)', refused(r, 'UNKNOWN_STORE'), r);
  r = await commit(1, [{ t: 'Worker', op: 'update', row: { ...row(s, 'Worker', 2), id: 999999 } }]);
  check('an update of a row the store does not have is refused (CONFLICT)', refused(r, 'CONFLICT'), r);
  const many = Array.from({ length: 2001 }, (_, i) => ({ t: 'Notification', op: 'update', row: { id: i } }));
  r = await commit(1, many);
  check('more than 2,000 rows are refused (TOO_LARGE)', refused(r, 'TOO_LARGE'), r.body?.message);
  r = await commit(1, [{ t: 'Worker', op: 'update', row: { ...row(s, 'Worker', 2), phone: 'x'.repeat(270000) } }]);
  check('more than 256 kB are refused (TOO_LARGE)', r.status === 413 || refused(r, 'TOO_LARGE'), r.status);

  const unread = s.tables.Notification[0];
  r = await commit(1, [{ t: 'Notification', op: 'update', row: { ...unread, read_at: nowText } }]);
  check('marking a notification read is committed (rev 1 -> 2)', r.status === 200 && r.body.rev === 2, r);
  s = await snapshot();
  check('the snapshot shows the change and the new revision', s.rev === 2 && row(s, 'Notification', unread.id).read_at === nowText, s.rev);
  r = await commit(2, [{ t: 'Notification', op: 'update', row: { ...row(s, 'Notification', unread.id), message: 'changed' } }]);
  check('a notification text does not change (RULE)', refused(r, 'RULE'), r);
  r = await commit(2, [{ t: 'Notification', op: 'delete', row: { id: unread.id } }]);
  check('notifications are never deleted (FORBIDDEN_DELETE)', refused(r, 'FORBIDDEN_DELETE'), r);
  r = await commit(2, [{ t: 'SubRequest', op: 'delete', row: { id: req.id } }]);
  check('requests are never deleted (FORBIDDEN_DELETE)', refused(r, 'FORBIDDEN_DELETE'), r);

  // First acceptance (BR-02) and the transitions of spec §7.
  const targets = s.tables.SubRequestTarget;
  const accept = (workerId) => [
    { t: 'SubRequest', op: 'update', row: { ...req, status: 'ACCEPTED', acceptor_id: workerId } },
    ...targets.map((t) => ({ t: 'SubRequestTarget', op: 'update',
      row: { ...t, response: t.worker_id === workerId ? 'ACCEPTED' : 'CLOSED', responded_at: nowText } })),
  ];
  r = await commit(2, accept(2));
  check('the requester cannot accept their own request (RULE)', refused(r, 'RULE'), r);
  r = await commit(2, [{ t: 'SubRequest', op: 'update', row: { ...req, status: 'ACCEPTED', acceptor_id: 1 } }]);
  check('a worker who was not asked cannot accept (RULE)', refused(r, 'RULE'), r);
  r = await commit(2, [{ t: 'SubRequest', op: 'update', row: { ...req, reason: 'changed' } }]);
  check('the reason of a request does not change (RULE)', refused(r, 'RULE'), r);
  r = await commit(2, [{ t: 'SubRequest', op: 'update', row: { ...req, status: 'EXPIRED', decided_at: nowText } }]);
  check('a request that is not overdue cannot expire (RULE)', refused(r, 'RULE'), r);
  r = await commit(2, [{ t: 'SubRequest', op: 'update', row: { ...req, status: 'APPROVED', decided_at: nowText } }]);
  check('REQUESTED -> APPROVED is not a transition (RULE)', refused(r, 'RULE'), r);
  const both = await Promise.all([commit(2, accept(3)), commit(2, accept(4))]);
  const ok = both.filter((b) => b.status === 200);
  check('two acceptances on the same revision: exactly one succeeds, the other is STALE',
    ok.length === 1 && both.some((b) => refused(b, 'STALE')), both.map((b) => b.body?.message || b.body));
  s = await snapshot();
  const accepted = row(s, 'SubRequest', req.id);
  check('the request is ACCEPTED once with one acceptor', accepted.status === 'ACCEPTED' && [3, 4].includes(accepted.acceptor_id), accepted);
  r = await commit(3, [{ t: 'SubRequest', op: 'update', row: { ...accepted, acceptor_id: accepted.acceptor_id === 3 ? 4 : 3 } }]);
  check('the acceptor does not change after acceptance (RULE)', refused(r, 'RULE'), r);
  r = await commit(3, [{ t: 'SubRequestTarget', op: 'update',
    row: { ...s.tables.SubRequestTarget.find((t) => t.response === 'CLOSED'), response: 'ACCEPTED' } }]);
  check('a closed target does not change (RULE)', refused(r, 'RULE'), r);
  r = await commit(3, [{ t: 'SubRequest', op: 'update', row: { ...accepted, status: 'REQUESTED', acceptor_id: null } }]);
  check('ACCEPTED -> REQUESTED is not a transition (RULE)', refused(r, 'RULE'), r);
  r = await commit(3, [
    { t: 'SubRequest', op: 'update', row: { ...accepted, status: 'APPROVED', decided_at: nowText } },
    { t: 'Shift', op: 'update', row: { ...reqShift, worker_id: accepted.acceptor_id, original_worker_id: 2 } },
  ]);
  check('approval before the deadline is committed with the shift handover (rev 4)', r.status === 200 && r.body.rev === 4, r);
  s = await snapshot();
  const handed = row(s, 'Shift', reqShift.id);
  r = await commit(4, [{ t: 'Shift', op: 'update', row: { ...handed, original_worker_id: 5 } }]);
  check('the original worker of a shift is kept (RULE)', refused(r, 'RULE'), r);

  // New requests (BR-03): one open request per shift, times checked against the server.
  const newRequest = (id, over = {}) => ({ t: 'SubRequest', op: 'insert', row: { id, shift_id: handed.id, requester_id: handed.worker_id,
    acceptor_id: null, reason: null, deadline: kst(s.now, 60), status: 'REQUESTED', created_at: kst(s.now), decided_at: null, ...over } });
  r = await commit(4, [newRequest(2), newRequest(3)]);
  check('two open requests for one shift are refused', r.status >= 400, r.body?.message);
  r = await commit(4, [newRequest(2, { created_at: kst(s.now, -30) })]);
  check('a creation time 30 minutes off the server time is refused (RULE)', refused(r, 'RULE'), r);
  r = await commit(4, [newRequest(2, { deadline: kst(s.now, -5) })]);
  check('a deadline in the past is refused (RULE)', refused(r, 'RULE'), r);
  r = await commit(4, [newRequest(2, { requester_id: 2 })]);
  check('only the current worker of the shift can ask (RULE)', refused(r, 'RULE'), r);
  r = await commit(4, [newRequest(2, { status: 'ACCEPTED', acceptor_id: 4 })]);
  check('a new request starts REQUESTED without acceptor (RULE)', refused(r, 'RULE'), r);
  r = await commit(4, [newRequest(2)]);
  check('a valid new request is committed (rev 5)', r.status === 200 && r.body.rev === 5, r);

  // Expiry by server time (BR-12): move the deadline into the past with the owner connection, as time would.
  sql(`select set_config('app.seeding', 'on', true); update public.app_sub_request set deadline = '${kst(s.now, -1)}' where store_id = ${storeId} and id = 2`);
  s = await snapshot();
  const overdue = row(s, 'SubRequest', 2);
  const worker4 = s.tables.Worker.find((w) => w.id === 4);
  r = await commit(5, [{ t: 'SubRequest', op: 'update', row: { ...overdue, status: 'ACCEPTED', acceptor_id: worker4.id } }]);
  check('acceptance after the deadline is refused by server time (RULE)', refused(r, 'RULE'), r);
  r = await commit(5, [{ t: 'SubRequest', op: 'update', row: { ...overdue, status: 'EXPIRED', decided_at: kst(s.now) } }]);
  check('an overdue request expires (rev 6)', r.status === 200 && r.body.rev === 6, r);

  // Attendance, shifts and payroll.
  const worked = s.tables.Shift.find((z) => z.status === 'WORKED');
  const att = s.tables.Attendance.find((a) => a.shift_id === worked.id);
  r = await commit(6, [{ t: 'Shift', op: 'update', row: { ...worked, status: 'SCHEDULED' } }]);
  check('a WORKED shift stays WORKED (RULE)', refused(r, 'RULE'), r);
  r = await commit(6, [{ t: 'Attendance', op: 'update', row: { ...att, clock_out: '23:59' } }]);
  check('a confirmed attendance record does not change (RULE)', refused(r, 'RULE'), r);
  r = await commit(6, [{ t: 'Shift', op: 'insert', row: { ...worked, id: 9001, status: 'WORKED' } }]);
  check('a new shift is SCHEDULED (RULE)', refused(r, 'RULE'), r);
  const payroll = (id, over = {}) => ({ id, worker_id: 5, year_month: '2026-07', base_hours: 48, base_pay: 480000, holiday_pay: 0,
    premium_pay: 0, total: 480000, min_wage_warning: 1, min_wage_ack: 1, estimated: 0, status: 'CONFIRMED', ...over });
  r = await commit(6, [{ t: 'Payroll', op: 'insert', row: payroll(1) }]);
  check('a payroll row cannot be inserted as CONFIRMED (RULE)', refused(r, 'RULE'), r);
  r = await commit(6, [{ t: 'Payroll', op: 'insert', row: payroll(1, { status: 'DRAFT', min_wage_ack: 0 }) }]);
  check('a payroll row is inserted as DRAFT (rev 7)', r.status === 200 && r.body.rev === 7, r);
  r = await commit(7, [{ t: 'Payroll', op: 'update', row: payroll(1, { min_wage_ack: 0 }) }]);
  check('payroll with an unacknowledged minimum-wage warning cannot be confirmed (RULE)', refused(r, 'RULE'), r);
  r = await commit(7, [{ t: 'Payroll', op: 'update', row: payroll(1) }]);
  check('acknowledged payroll is confirmed (rev 8)', r.status === 200 && r.body.rev === 8, r);
  r = await commit(8, [{ t: 'Payroll', op: 'update', row: payroll(1, { total: 1 }) }]);
  check('confirmed payroll is read-only (RULE)', refused(r, 'RULE'), r);
  r = await commit(8, [{ t: 'Payroll', op: 'delete', row: { id: 1 } }]);
  check('confirmed payroll cannot be deleted (RULE)', refused(r, 'RULE'), r);
  r = await commit(8, [{ t: 'Payroll', op: 'insert', row: payroll(2 ** 53 + 2, { status: 'DRAFT', year_month: '2026-06' }) }]);
  check('a new key outside 1..2^31-1 is refused (BAD_CHANGES)', refused(r, 'BAD_CHANGES'), r);
  r = await commit(8, [{ t: 'Workplace', op: 'insert', row: { id: 2, name: 'Second', regular_employees: 4, sub_attendance_policy: 'EXCUSED' } }]);
  check('a store keeps its one workplace (RULE)', refused(r, 'RULE'), r);
  r = await commit(8, [{ t: 'Worker', op: 'update', row: { ...row(s, 'Worker', 2), workplace_id: 77 } }]);
  check('references are checked inside the store', r.status >= 400, r.body?.message);

  // ---- Limits --------------------------------------------------------------------------------------------------
  const gate = () => JSON.parse(sql(`select minute_count, day_count from public.app_store_gate where store_id = ${storeId}`))[0];
  check('successful change sets are counted per store', gate().minute_count === 7 && gate().day_count === 7, gate());
  sql(`update public.app_store_gate set minute_count = 60 where store_id = ${storeId}`);
  s = await snapshot();
  const note = row(s, 'Notification', 2);
  r = await commit(8, [{ t: 'Notification', op: 'update', row: { ...note, read_at: kst(s.now) } }]);
  check('the 61st change set in a minute is refused (RATE_LIMIT)', refused(r, 'RATE_LIMIT'), r);
  sql(`update public.app_store_gate set minute_count = 0, day_count = 3000 where store_id = ${storeId}`);
  r = await commit(8, [{ t: 'Notification', op: 'update', row: { ...note, read_at: kst(s.now) } }]);
  check('the 3,001st change set in a day is refused (DAILY_LIMIT)', refused(r, 'DAILY_LIMIT'), r);
  sql(`update public.app_store_gate set minute_start = now() - interval '2 minutes', minute_count = 60, day = day - 1, day_count = 3000 where store_id = ${storeId}`);
  r = await commit(8, [{ t: 'Notification', op: 'update', row: { ...note, read_at: kst(s.now) } }]);
  check('the counters start again in the next minute and the next day (rev 9)', r.status === 200 && r.body.rev === 9, r);
  sql(`select set_config('app.seeding', 'on', true); insert into public.app_notification (store_id, id, worker_id, kind, message, created_at)
    select ${storeId}, 1000 + g, 3, 'REQUEST_RECEIVED', 'filler', '2026-01-01T00:00' from generate_series(1, 19700) g`);
  s = await snapshot();
  r = await commit(9, [newRequest(3, { shift_id: s.tables.Shift.find((z) => z.status === 'SCHEDULED' && `${z.work_date}T${z.start_time}` > kst(s.now, 120)).id,
    requester_id: s.tables.Shift.find((z) => z.status === 'SCHEDULED' && `${z.work_date}T${z.start_time}` > kst(s.now, 120)).worker_id })]);
  check('an insert into a store with more than 20,000 rows is refused (STORE_FULL)', refused(r, 'STORE_FULL'), r);

  // ---- Reset ---------------------------------------------------------------------------------------------------
  r = await rpc('app_reset', { p_store: STORE });
  s = await snapshot();
  check('app_reset restores the seed', r.status === 200 && s.tables.Notification.length === 3 && s.tables.Payroll.length === 0
    && s.tables.SubRequest.length === 1 && s.tables.SubRequest[0].status === 'REQUESTED' && s.rev === r.body.rev, { r, rev: s.rev });
  r = await rpc('app_reset', { p_store: STORE });
  check('a second reset within a minute is refused (RESET_RATE_LIMIT)', refused(r, 'RESET_RATE_LIMIT'), r);
  sql(`update public.app_store_gate set reset_last = now() - interval '2 minutes', reset_day_count = 50 where store_id = ${storeId}`);
  r = await rpc('app_reset', { p_store: STORE });
  check('the 51st reset in a day is refused (RESET_DAILY_LIMIT)', refused(r, 'RESET_DAILY_LIMIT'), r);
  const demo = await snapshot('dalbit');
  check('the demo store dalbit exists and is readable', demo && demo.rev >= 1 && demo.tables.Worker.length === 5, demo && demo.rev);
} finally {
  sql(`select set_config('app.seeding', 'on', true); delete from public.app_store where slug = '${STORE}'`);
  const left = JSON.parse(sql(`select count(*)::int as n from public.app_store where slug like 'e2e-%'`))[0].n;
  check('the throwaway store is deleted', left === 0, left);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
