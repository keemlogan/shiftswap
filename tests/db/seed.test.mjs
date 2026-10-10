// TC-19x: the seed of spec §10, reset_demo_data (NFR-05), re-running the SQL file and the API surface of §9.3.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, TestDb, SQL_TEXT, TABLES, API_FUNCTIONS, READ_FUNCTIONS } from './support.mjs';

const db = await setup({ beforeEach, afterEach });

test('TC-191 the seed reproduces spec §10: store, demo clock, minimum wages, accounts and fixed shifts', async () => {
  assert.deepEqual(await db.one('select id, name, regular_employees, sub_attendance_policy, demo_clock::text from public.workplace'),
    { id: 1, name: 'Dalbit Café', regular_employees: 4, sub_attendance_policy: 'EXCUSED', demo_clock: '2026-09-28 09:00:00' });
  assert.equal(await db.value('select public.app_now()::text'), '2026-09-28 09:00:00');
  assert.deepEqual(await db.rows('select year, hourly from public.minimum_wage order by year'), [{ year: 2025, hourly: 10030 }, { year: 2026, hourly: 10320 }]);
  assert.deepEqual(await db.rows(
    `select id, workplace_id, role, name, phone, hourly_wage, contract_start::text, contract_end::text, probation_end::text, simple_labor, active
     from public.worker order by id`), [
    { id: 1, workplace_id: 1, role: 'OWNER', name: 'Park Jiyoung', phone: '010-3827-1150', hourly_wage: null, contract_start: null, contract_end: null, probation_end: null, simple_labor: false, active: true },
    { id: 2, workplace_id: 1, role: 'WORKER', name: 'Lee Seoyeon', phone: '010-4172-2083', hourly_wage: 10500, contract_start: '2026-03-02', contract_end: '2027-02-28', probation_end: null, simple_labor: false, active: true },
    { id: 3, workplace_id: 1, role: 'WORKER', name: 'Choi Minho', phone: '010-5290-3316', hourly_wage: 10320, contract_start: '2026-06-01', contract_end: '2026-12-31', probation_end: null, simple_labor: false, active: true },
    { id: 4, workplace_id: 1, role: 'WORKER', name: 'Jung Hana', phone: '010-6631-4427', hourly_wage: 10320, contract_start: '2026-09-01', contract_end: null, probation_end: '2026-11-30', simple_labor: false, active: true },
    { id: 5, workplace_id: 1, role: 'WORKER', name: 'Kang Doyun', phone: '010-7748-5539', hourly_wage: 10000, contract_start: '2026-08-15', contract_end: '2026-11-15', probation_end: null, simple_labor: true, active: true },
  ]);
  assert.deepEqual((await db.rows("select worker_id, weekday, to_char(start_time, 'HH24:MI') as s, to_char(end_time, 'HH24:MI') as e from public.fixed_schedule order by worker_id, weekday"))
    .map((f) => `${f.worker_id}:${f.weekday} ${f.s}-${f.e}`),
  ['2:1 18:00-23:00', '2:3 18:00-23:00', '3:2 18:00-23:00', '3:4 18:00-23:00', '3:6 12:00-18:00', '4:5 17:00-23:00', '4:7 10:00-16:00', '5:6 10:00-16:00', '5:7 16:00-22:00']);
  assert.deepEqual((await db.fn('demo_accounts')).map((a) => [a.id, a.contract_hours]), [[1, null], [2, 10], [3, 16], [4, 12], [5, 12]]);
});

test('TC-192 the seed work history: every fixed slot from contract start to 2026-09-20 WORKED and confirmed, weeks 09-21 and 09-28 generated (spec §10)', async () => {
  assert.deepEqual(await db.rows("select worker_id, count(*)::int as n from public.shift where work_date <= '2026-09-20' group by worker_id order by worker_id"),
    [{ worker_id: 2, n: 58 }, { worker_id: 3, n: 48 }, { worker_id: 4, n: 6 }, { worker_id: 5, n: 12 }]);
  assert.deepEqual(await db.rows(
    "select min(work_date)::text as first, count(*)::int as n from public.shift group by worker_id order by worker_id"),
  [{ first: '2026-03-02', n: 62 }, { first: '2026-06-02', n: 54 }, { first: '2026-09-04', n: 10 }, { first: '2026-08-15', n: 16 }]);
  assert.equal(await db.value("select count(*)::int from public.shift where work_date between '2026-09-21' and '2026-10-04'"), 18);
  assert.deepEqual(await db.rows('select status, count(*)::int as n, min(work_date)::text as first, max(work_date)::text as last from public.shift group by status order by status'),
    [{ status: 'SCHEDULED', n: 9, first: '2026-09-28', last: '2026-10-04' }, { status: 'WORKED', n: 133, first: '2026-03-02', last: '2026-09-27' }]);
  assert.equal(await db.value('select count(*)::int from public.shift where original_worker_id is not null or fixed_schedule_id is null'), 0);
  // Every shift follows its worker's fixed schedule and contract: the history has no gap and no duplicate.
  assert.equal(await db.value(
    `select count(*)::int from public.shift s join public.fixed_schedule f on f.id = s.fixed_schedule_id join public.worker w on w.id = s.worker_id
     where extract(isodow from s.work_date) <> f.weekday or s.start_time <> f.start_time or s.end_time <> f.end_time
        or s.worker_id <> f.worker_id or s.work_date < w.contract_start`), 0);
  assert.equal(await db.value('select count(*)::int from (select worker_id, work_date from public.shift group by 1, 2 having count(*) > 1) d'), 0);
});

test('TC-193 the seed payroll: March–August generated, acknowledged and confirmed by the functions; no September row (spec §10, BR-14)', async () => {
  const rows = await db.rows('select worker_id, year_month, base_hours::float8 as h, base_pay, holiday_pay, premium_pay, total, min_wage_warning, min_wage_ack, estimated, status from public.payroll order by year_month, worker_id');
  assert.deepEqual(rows.map((p) => `${p.worker_id}:${p.year_month}`),
    ['2:2026-03', '2:2026-04', '2:2026-05', '2:2026-06', '3:2026-06', '2:2026-07', '3:2026-07', '2:2026-08', '3:2026-08', '5:2026-08']);
  assert.ok(rows.every((p) => p.status === 'CONFIRMED' && !p.estimated && p.premium_pay === 0));
  assert.deepEqual(rows.filter((p) => p.worker_id === 3).map((p) => p.holiday_pay), [4 * 33024, 4 * 33024, 5 * 33024]);
  assert.ok(rows.filter((p) => p.worker_id === 2).every((p) => p.holiday_pay === 0 && p.base_pay === p.h * 10500));
  const doyun = rows.find((p) => p.worker_id === 5);
  assert.deepEqual([doyun.h, doyun.total, doyun.min_wage_warning, doyun.min_wage_ack], [36, 360000, true, true]);
  assert.ok(rows.filter((p) => p.worker_id !== 5).every((p) => !p.min_wage_warning && !p.min_wage_ack));
  assert.deepEqual(await db.fn('run_system_clock'), { expired: 0, drafted_months: [] });
  assert.equal(await db.value("select count(*)::int from public.payroll where year_month >= '2026-09'"), 0);
});

test('TC-194 the seed request: Lee Seoyeon, Wed 2026-09-30 18:00-23:00, deadline 09-29 21:00, "Midterm exam", created 08:30 (spec §10, S1)', async () => {
  assert.deepEqual(await db.one(
    `select r.id, r.requester_id, r.acceptor_id, r.reason, r.deadline::text, r.status, r.created_at::text, r.decided_at,
            s.worker_id, s.work_date::text, s.start_time::text, s.end_time::text
     from public.sub_request r join public.shift s on s.id = r.shift_id`),
  { id: 1, requester_id: 2, acceptor_id: null, reason: 'Midterm exam', deadline: '2026-09-29 21:00:00', status: 'REQUESTED',
    created_at: '2026-09-28 08:30:00', decided_at: null, worker_id: 2, work_date: '2026-09-30', start_time: '18:00:00', end_time: '23:00:00' });
  assert.deepEqual(await db.rows('select worker_id, response, responded_at from public.sub_request_target order by id'),
    [{ worker_id: 3, response: 'PENDING', responded_at: null }, { worker_id: 4, response: 'PENDING', responded_at: null }, { worker_id: 5, response: 'PENDING', responded_at: null }]);
  assert.deepEqual(await db.rows('select id, worker_id, sub_request_id, kind, created_at::text, read_at from public.notification order by id'), [
    { id: 1, worker_id: 3, sub_request_id: 1, kind: 'REQUEST_RECEIVED', created_at: '2026-09-28 08:30:00', read_at: null },
    { id: 2, worker_id: 4, sub_request_id: 1, kind: 'REQUEST_RECEIVED', created_at: '2026-09-28 08:30:00', read_at: null },
    { id: 3, worker_id: 5, sub_request_id: 1, kind: 'REQUEST_RECEIVED', created_at: '2026-09-28 08:30:00', read_at: null },
  ]);
});

test('TC-195 reset_demo_data restores the same data with the same ids, also after changes, and resets the demo clock (NFR-05)', async () => {
  const loaded = await db.dump();
  await db.fn('accept_sub_request', 1, 3);
  await db.fn('decide_sub_request', 1, 'APPROVE');
  await db.fn('update_settings', 'Other café', 7, 'ABSENT', '[{"year": 2026, "hourly": 11000}]');
  await db.fn('add_shift', '2026-10-06', '09:00', '12:00', 4);
  await db.fn('save_worker', null, 'Yoon Jisu', null, 10500, '2026-10-01', null, null, false, true);
  await db.clock('2026-12-02 09:00');
  await db.fn('run_system_clock');
  await db.fn('reset_demo_data');
  const first = await db.dump();
  await db.fn('reset_demo_data');
  const second = await db.dump();
  assert.deepEqual(first, loaded);
  assert.deepEqual(second, first);
  assert.equal(await db.value('select public.app_now()::text'), '2026-09-28 09:00:00');
  assert.deepEqual(TABLES.map((t) => second[t].length), [1, 5, 9, 142, 1, 3, 133, 62, 10, 2, 3]);
});

test('TC-196 the SQL file can be run again on the same database (with the API roles): same objects, same demo data (spec §9.8)', async () => {
  const other = await TestDb.open({ roles: true });
  const before = await other.dump();
  await other.pg.exec(SQL_TEXT);
  assert.deepEqual(await other.dump(), before);
  assert.equal(await other.value("select count(*)::int from pg_policy"), 11);
  assert.equal(await other.value("select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = 'accept_sub_request'"), 1);
  await other.pg.close();
});

test('TC-197 the API of §9.3 (and the screen reads) exist with the exact names, arguments and result types; every function has an empty search_path (NFR-14)', async () => {
  const functions = await db.rows(
    `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as result,
            p.prosecdef as definer, p.provolatile as volatility, array_to_string(p.proconfig, ',') as config
     from pg_proc p where p.pronamespace = 'public'::regnamespace order by p.proname`);
  const byName = new Map(functions.map((f) => [f.name, f]));
  for (const [name, [args, result]] of Object.entries({ ...API_FUNCTIONS, ...READ_FUNCTIONS })) {
    const f = byName.get(name);
    assert.ok(f, `${name} exists`);
    assert.deepEqual([f.args, f.result, f.definer], [args, result, true], name);
  }
  assert.equal(Object.keys(API_FUNCTIONS).length, 31);
  for (const f of functions) {
    assert.equal(f.config, 'search_path=""', `${f.name} sets an empty search_path`);
    if (!Object.hasOwn(API_FUNCTIONS, f.name) && !Object.hasOwn(READ_FUNCTIONS, f.name)) {
      assert.match(f.name, /^ss_/, 'helpers are prefixed ss_');
      assert.ok(f.definer || f.volatility === 'i', `${f.name} is SECURITY DEFINER or IMMUTABLE`);
    }
  }
});
