// TC-16x security (NFR-14, spec §9.6): the API roles read the 11 tables but cannot write them; every change goes
// through the SECURITY DEFINER functions, which validate their arguments; the internal helpers are not callable.
// The roles anon and authenticated are created before the SQL file is loaded, as on Supabase / Lovable Cloud.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { TestDb, TABLES, API_FUNCTIONS, READ_FUNCTIONS } from './support.mjs';

const db = await TestDb.open({ roles: true });
beforeEach(() => db.begin());
afterEach(async () => {
  await db.pg.exec('reset role');
  await db.rollback();
});

const asRole = (role) => db.pg.exec(`set local role ${role}`);

async function denied(sql) {
  let error;
  try {
    await db.rows(sql);
  } catch (err) {
    error = err;
  }
  assert.ok(error, `refused: ${sql}`);
  assert.equal(error.code, '42501', `${sql}: ${error.message}`);
}

const WRITES = {
  workplace: ["insert into public.workplace (id, name) values (2, 'Other')", "update public.workplace set name = 'X'", 'delete from public.workplace'],
  worker: ["insert into public.worker (workplace_id, role, name) values (1, 'WORKER', 'Intruder')", 'update public.worker set hourly_wage = 1', 'delete from public.worker'],
  fixed_schedule: ["insert into public.fixed_schedule (worker_id, weekday, start_time, end_time) values (2, 1, '08:00', '09:00')", 'update public.fixed_schedule set weekday = 2', 'delete from public.fixed_schedule'],
  shift: ["insert into public.shift (work_date, start_time, end_time, worker_id) values ('2026-10-10', '08:00', '09:00', 2)", "update public.shift set status = 'WORKED'", 'delete from public.shift'],
  sub_request: ["update public.sub_request set status = 'ACCEPTED', acceptor_id = 5", 'delete from public.sub_request',
    "insert into public.sub_request (shift_id, requester_id, deadline, status, created_at) values (1, 2, now(), 'REQUESTED', now())"],
  sub_request_target: ["update public.sub_request_target set response = 'ACCEPTED'", 'delete from public.sub_request_target',
    'insert into public.sub_request_target (sub_request_id, worker_id) values (1, 1)'],
  attendance: ["insert into public.attendance (shift_id, clock_in, clock_out) values (140, '18:00', '23:00')", 'update public.attendance set confirmed = false', 'delete from public.attendance'],
  weekly_summary: ['update public.weekly_summary set holiday_pay = 0', 'delete from public.weekly_summary',
    "insert into public.weekly_summary (worker_id, week_start, contract_hours, scheduled_hours, actual_hours, perfect_attendance, holiday_eligible, holiday_hours, holiday_pay) values (2, '2026-10-05', 1, 1, 1, true, true, 1, 1)"],
  payroll: ["update public.payroll set status = 'DRAFT'", 'delete from public.payroll',
    "insert into public.payroll (worker_id, year_month, base_hours, base_pay, holiday_pay, premium_pay, total) values (2, '2026-09', 1, 1, 0, 0, 1)"],
  minimum_wage: ['insert into public.minimum_wage (year, hourly) values (2027, 1)', 'update public.minimum_wage set hourly = 1', 'delete from public.minimum_wage'],
  notification: ["insert into public.notification (worker_id, kind, created_at) values (1, 'REQUEST_FAILED', now())", 'update public.notification set read_at = now()', 'delete from public.notification'],
};

test('TC-161 the API roles read every table but cannot insert, update, delete or truncate any of the 11 tables (NFR-14, §9.6)', async () => {
  assert.deepEqual(Object.keys(WRITES).sort(), [...TABLES].sort());
  for (const role of ['anon', 'authenticated']) {
    await asRole(role);
    assert.equal(await db.value('select current_user::text'), role);
    for (const table of TABLES) {
      assert.ok((await db.value(`select count(*)::int from public.${table}`)) > 0, `${role} reads ${table}`);
      for (const sql of WRITES[table]) await denied(sql);
      await denied(`truncate public.${table}`);
    }
    await denied("select nextval('public.sub_request_id_seq')");
    await db.pg.exec('reset role');
  }
  assert.deepEqual(await db.one('select status, acceptor_id from public.sub_request where id = 1'), { status: 'REQUESTED', acceptor_id: null });
});

test('TC-162 the API roles change data only through the functions: S2 runs as anon; the internal ss_ helpers cannot be called (NFR-14)', async () => {
  await asRole('anon');
  assert.equal(await db.value('select public.app_now()::text'), '2026-09-28 09:00:00');
  assert.equal((await db.fn('accept_sub_request', 1, 3)).status, 'ACCEPTED');
  await db.refused(db.fn('accept_sub_request', 1, 5), 'ALREADY_TAKEN');
  assert.equal((await db.fn('approval_preview', 1)).store_total_change, -900);
  assert.deepEqual(await db.fn('decide_sub_request', 1, 'APPROVE'), { id: 1, status: 'APPROVED' });
  assert.equal((await db.fn('notifications', 2)).unread, 2);
  assert.deepEqual(await db.fn('run_system_clock'), { expired: 0, drafted_months: [] });
  await denied("select public.ss_recompute_week('2026-09-28', null)");
  await denied("select public.ss_generate_payroll('2026-09')");
  await denied("select public.ss_notify(1, null, 'PAYROLL_DRAFT_READY', '{}')");
  await denied('select public.ss_week_calc(3, \'2026-09-28\')');
  await db.pg.exec('reset role');
  assert.deepEqual(await db.one("select worker_id, original_worker_id from public.shift where id = (select shift_id from public.sub_request where id = 1)"),
    { worker_id: 3, original_worker_id: 2 });
});

test('TC-163 functions validate their arguments, also when called by the API role (NFR-14, §9.2)', async () => {
  await asRole('authenticated');
  await db.refused(db.fn('accept_sub_request', 999, 3), 'REQUEST_NOT_FOUND');
  await db.refused(db.fn('accept_sub_request', 1, 1), 'NOT_A_TARGET');
  await db.refused(db.fn('create_sub_request', 1, 3, null, '2026-10-01 12:00'), 'NOT_YOUR_SHIFT');
  await db.refused(db.fn('decide_sub_request', 1, 'YES'), 'DECISION_INVALID');
  await db.refused(db.fn('save_worker', null, ' ', null, 10320, '2026-10-01', null, null, false, true), 'WORKER_INVALID');
  await db.refused(db.fn('save_worker', null, 'Yoon Jisu', null, 0, '2026-10-01', null, null, false, true), 'WORKER_INVALID');
  await db.refused(db.fn('save_worker', null, 'Yoon Jisu', null, 10320, null, null, null, false, true), 'WORKER_INVALID');
  await db.refused(db.fn('save_worker', null, 'Yoon Jisu', null, 10320, '2026-10-01', '2026-09-30', null, false, true), 'WORKER_INVALID');
  await db.refused(db.fn('save_worker', null, 'Yoon Jisu', '0'.repeat(31), 10320, '2026-10-01', null, null, false, true), 'WORKER_INVALID');
  await db.refused(db.fn('save_worker', 1, 'Park Jiyoung', null, 10320, '2026-10-01', null, null, false, true), 'WORKER_INVALID');
  await db.refused(db.fn('update_settings', '', 4, 'EXCUSED', null), 'SETTINGS_INVALID');
  await db.refused(db.fn('update_settings', 'Dalbit Café', -1, 'EXCUSED', null), 'SETTINGS_INVALID');
  await db.refused(db.fn('update_settings', 'Dalbit Café', 4, 'LENIENT', null), 'SETTINGS_INVALID');
  await db.refused(db.fn('update_settings', 'Dalbit Café', 4, 'EXCUSED', '[{"year": 2026, "hourly": 0}]'), 'SETTINGS_INVALID');
  await db.refused(db.fn('update_settings', 'Dalbit Café', 4, 'EXCUSED', '[{"year": 2026, "hourly": 10320}, {"year": 2026, "hourly": 10030}]'), 'SETTINGS_INVALID');
  await db.refused(db.fn('generate_payroll', '2026-13'), 'MONTH_INVALID');
  await db.refused(db.fn('mark_notifications_read', 999, null), 'WORKER_INVALID');
  await db.refused(db.fn('worker_home', 1), 'WORKER_INVALID');
  // A valid settings change is applied.
  await db.fn('update_settings', ' Dalbit Café Seongsu ', 5, 'ABSENT', '[{"year": 2026, "hourly": 10320}, {"year": 2027, "hourly": 10600}]');
  const settings = await db.fn('get_settings');
  assert.deepEqual([settings.workplace.name, settings.workplace.regular_employees, settings.workplace.sub_attendance_policy, settings.minimum_wages],
    ['Dalbit Café Seongsu', 5, 'ABSENT', [{ year: 2026, hourly: 10320 }, { year: 2027, hourly: 10600 }]]);
});

test('TC-164 row-level security on all 11 tables with read policies for anon and authenticated; execute grants only on the API (NFR-14)', async () => {
  const tables = await db.rows(
    `select c.relname as name, c.relrowsecurity as rls,
            (select string_agg(p.polname || ':' || p.polcmd::text, ',') from pg_policy p where p.polrelid = c.oid) as policies,
            has_table_privilege('anon', c.oid, 'select') as anon_select,
            has_table_privilege('anon', c.oid, 'insert,update,delete,truncate') as anon_write,
            has_table_privilege('authenticated', c.oid, 'insert,update,delete,truncate') as auth_write
     from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by c.relname`);
  assert.deepEqual(tables.map((t) => t.name), [...TABLES].sort());
  for (const t of tables) {
    assert.deepEqual([t.rls, t.policies, t.anon_select, t.anon_write, t.auth_write], [true, `read ${t.name}:r`, true, false, false], t.name);
  }
  const policyRoles = await db.rows("select distinct array_to_string(array(select rolname from pg_roles where oid = any (polroles) order by rolname), ',') as roles from pg_policy");
  assert.deepEqual(policyRoles, [{ roles: 'anon,authenticated' }]);
  const functions = await db.rows(
    `select p.proname as name, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth,
            has_function_privilege('public', p.oid, 'execute') as everyone
     from pg_proc p where p.pronamespace = 'public'::regnamespace order by p.proname`);
  const api = new Set([...Object.keys(API_FUNCTIONS), ...Object.keys(READ_FUNCTIONS)]);
  for (const f of functions) {
    if (api.has(f.name)) assert.deepEqual([f.anon, f.auth], [true, true], f.name);
    else {
      assert.match(f.name, /^ss_/);
      assert.deepEqual([f.anon, f.auth, f.everyone], [false, false, false], f.name);
    }
  }
  assert.equal(functions.filter((f) => api.has(f.name)).length, api.size);
});
