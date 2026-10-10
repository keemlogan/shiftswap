// Test support for the database functions (spec §11): db/shiftswap.sql loaded into an embedded PostgreSQL (PGlite).
// Each test file opens one database; every test runs inside a transaction that is rolled back afterwards, and every
// call runs inside a savepoint, so a refused call (an exception) undoes only itself, as its own transaction would.
// Sequences are not transactional: ids of rows a test creates differ between tests, so tests use the returned ids.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

export const SQL_TEXT = readFileSync(new URL('../../db/shiftswap.sql', import.meta.url), 'utf8');

/** The functions of spec §9.3 with their exact identity arguments and result types. */
export const API_FUNCTIONS = {
  app_now: ['', 'timestamp without time zone'],
  run_system_clock: ['', 'jsonb'],
  expire_overdue_requests: ['', 'integer'],
  save_worker: ['p_id integer, p_name text, p_phone text, p_hourly_wage integer, p_contract_start date, p_contract_end date, p_probation_end date, p_simple_labor boolean, p_active boolean', 'integer'],
  save_fixed_schedule: ['p_worker_id integer, p_slots jsonb', 'jsonb'],
  generate_week: ['p_week_start date', 'integer'],
  add_shift: ['p_work_date date, p_start time without time zone, p_end time without time zone, p_worker_id integer', 'integer'],
  update_shift: ['p_shift_id integer, p_work_date date, p_start time without time zone, p_end time without time zone, p_worker_id integer', 'void'],
  delete_shift: ['p_shift_id integer', 'void'],
  mark_absent: ['p_shift_id integer', 'void'],
  preview_candidates: ['p_shift_id integer, p_requester_id integer', 'jsonb'],
  create_sub_request: ['p_shift_id integer, p_requester_id integer, p_reason text, p_deadline timestamp without time zone', 'jsonb'],
  accept_sub_request: ['p_request_id integer, p_worker_id integer', 'jsonb'],
  decline_sub_request: ['p_request_id integer, p_worker_id integer', 'jsonb'],
  approval_preview: ['p_request_id integer', 'jsonb'],
  decide_sub_request: ['p_request_id integer, p_decision text', 'jsonb'],
  cancel_sub_request: ['p_request_id integer, p_requester_id integer', 'jsonb'],
  record_attendance: ['p_shift_id integer, p_worker_id integer, p_clock_in time without time zone, p_clock_out time without time zone', 'jsonb'],
  confirm_attendance: ['p_shift_id integer', 'void'],
  week_summary: ['p_week_start date', 'jsonb'],
  generate_payroll: ['p_year_month text', 'jsonb'],
  acknowledge_min_wage: ['p_year_month text, p_worker_id integer', 'void'],
  confirm_payroll: ['p_year_month text', 'void'],
  update_settings: ['p_name text, p_regular_employees integer, p_policy text, p_minimum_wages jsonb', 'void'],
  mark_notifications_read: ['p_worker_id integer, p_ids integer[]', 'integer'],
  worker_home: ['p_worker_id integer', 'jsonb'],
  owner_home: ['', 'jsonb'],
  week_board: ['p_week_start date', 'jsonb'],
  shift_detail: ['p_shift_id integer', 'jsonb'],
  set_demo_clock: ['p_at timestamp without time zone', 'timestamp without time zone'],
  reset_demo_data: ['', 'void'],
};

/** The read functions the front end calls instead of reading tables (added to the API for iteration 9). */
export const READ_FUNCTIONS = {
  demo_accounts: ['', 'jsonb'],
  get_settings: ['', 'jsonb'],
  list_workers: ['', 'jsonb'],
  worker_detail: ['p_worker_id integer', 'jsonb'],
  requestable_shifts: ['p_worker_id integer', 'jsonb'],
  my_requests: ['p_worker_id integer', 'jsonb'],
  attendance_list: ['p_worker_id integer', 'jsonb'],
  payroll_month: ['p_year_month text', 'jsonb'],
  payroll_months: ['', 'jsonb'],
  notifications: ['p_worker_id integer', 'jsonb'],
};

export const TABLES = ['workplace', 'worker', 'fixed_schedule', 'shift', 'sub_request', 'sub_request_target',
  'attendance', 'weekly_summary', 'payroll', 'minimum_wage', 'notification'];

export class TestDb {
  constructor(pg) {
    this.pg = pg;
    this.inTransaction = false;
  }

  /** A fresh database with the SQL file loaded; `roles` creates anon and authenticated first (TC-16x). */
  static async open({ roles = false } = {}) {
    const pg = new PGlite();
    if (roles) await pg.exec('create role anon nologin; create role authenticated nologin;');
    await pg.exec(SQL_TEXT);
    return new TestDb(pg);
  }

  async begin() {
    await this.pg.exec('begin');
    this.inTransaction = true;
  }

  async rollback() {
    await this.pg.exec('rollback');
    this.inTransaction = false;
  }

  /** Rows of one statement; inside a test's transaction it runs in a savepoint, so an error undoes only itself. */
  async rows(sql, params = []) {
    if (!this.inTransaction) return (await this.pg.query(sql, params)).rows;
    await this.pg.exec('savepoint test_call');
    try {
      const result = await this.pg.query(sql, params);
      await this.pg.exec('release savepoint test_call');
      return result.rows;
    } catch (err) {
      await this.pg.exec('rollback to savepoint test_call');
      await this.pg.exec('release savepoint test_call');
      throw err;
    }
  }

  async one(sql, params) {
    return (await this.rows(sql, params))[0];
  }

  async value(sql, params) {
    const row = await this.one(sql, params);
    return row === undefined ? undefined : Object.values(row)[0];
  }

  /** Call public.<name>(args…) and return its result (jsonb is parsed). */
  async fn(name, ...args) {
    const list = args.map((_, i) => `$${i + 1}`).join(', ');
    return this.value(`select public.${name}(${list}) as r`, args);
  }

  /** Set the demo clock (Korea time, 'YYYY-MM-DD HH:MM'). */
  async clock(at) {
    return this.value('select public.set_demo_clock($1)::text as r', [at]);
  }

  /** The id of a worker's shift on a date (the earliest one when there are several). */
  async shift(workerId, date) {
    const id = await this.value(
      'select id from public.shift where worker_id = $1 and work_date = $2 order by start_time, id limit 1',
      [workerId, date]);
    assert.ok(id, `worker ${workerId} has a shift on ${date}`);
    return id;
  }

  /** Assert that a call is refused with the §9.2 code; returns the parsed detail and the hint. */
  async refused(promise, code) {
    let error;
    try {
      await promise;
    } catch (err) {
      error = err;
    }
    assert.ok(error, `expected the call to be refused with ${code}`);
    assert.equal(error.message, code, `expected ${code}, got ${error.message}: ${error.detail ?? ''}`);
    assert.ok(typeof error.hint === 'string' && error.hint.length > 10, `${code} has an English hint`);
    return { detail: error.detail ? JSON.parse(error.detail) : null, hint: error.hint };
  }

  /** Every row of the 11 tables, ordered by key, with timestamps as text (for comparing whole states). */
  async dump() {
    const out = {};
    for (const table of TABLES) {
      const key = table === 'minimum_wage' ? 'year' : 'id';
      out[table] = (await this.rows(`select to_jsonb(t) as row from public.${table} t order by ${key}`)).map((r) => r.row);
    }
    return out;
  }
}

/** Open the database of a test file and wrap every test in a transaction that is rolled back. */
export async function setup(hooks, options) {
  const db = await TestDb.open(options);
  hooks.beforeEach(() => db.begin());
  hooks.afterEach(() => db.rollback());
  return db;
}
