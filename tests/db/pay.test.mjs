// TC-08x holiday allowance (BR-06/07, FR-14, FR-25), TC-09x premium (BR-08), TC-10x minimum wage and probation
// (BR-09/10), TC-11x monthly payroll (BR-11), TC-14x automatic drafts (BR-14), TC-15x part-time limit warning (BR-15),
// TC-17x swap cost estimate (BR-16) — with the numbers of spec §10.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.mjs';

const db = await setup({ beforeEach, afterEach });

const slot = (weekday, start_time, end_time) => ({ weekday, start_time, end_time });
const nextDay = (date) => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
/** A shift interval on the time line (an end not later than the start is on the next day). */
const span = (date, start, end) => ({ work_date: date, start: `${date}T${start}:00`, end: `${end <= start ? nextDay(date) : date}T${end}:00` });

/** BR-08 premium hours of intervals, through public.ss_premium (minutes converted to hours). */
async function premium(shifts, { contractHours = 0, employees = 5, from = '2000-01-01', to = '2100-12-31' } = {}) {
  const p = await db.value('select public.ss_premium($1, $2, $3, $4, $5) as r',
    [JSON.stringify(shifts), Math.round(contractHours * 60), employees, from, to]);
  return { daily: p.daily_minutes / 60, weekly: p.weekly_minutes / 60, night: p.night_minutes / 60, partTime: p.part_time_minutes / 60, total: p.total_minutes / 60 };
}

const summaryOf = async (week, workerId) => (await db.fn('week_summary', week)).rows.find((r) => r.worker_id === workerId);
const rowOf = (payroll, workerId) => payroll.rows.find((r) => r.worker_id === workerId);

/** S8 (spec §10): regular employees set, a shift for Minho on Fri 10-02 10:00–`end`, Minho accepts Seoyeon's request. */
async function s8(employees, end = '18:00') {
  await db.fn('update_settings', 'Dalbit Café', employees, 'EXCUSED', null);
  await db.fn('add_shift', '2026-10-02', '10:00', end, 3);
  await db.fn('accept_sub_request', 1, 3);
  return db.fn('approval_preview', 1);
}

/** S7 (spec §10): policy ABSENT, Minho requests a substitute for Sat 10-03 12:00–18:00, Hana accepts. */
async function s7() {
  await db.fn('update_settings', 'Dalbit Café', 4, 'ABSENT', null);
  const r = await db.fn('create_sub_request', await db.shift(3, '2026-10-03'), 3, null, '2026-10-02 12:00');
  assert.deepEqual(r.candidates.map((c) => c.name), ['Lee Seoyeon', 'Jung Hana']);
  await db.fn('accept_sub_request', r.id, 4);
  return { id: r.id, preview: await db.fn('approval_preview', r.id) };
}

// ---- TC-08x holiday allowance ------------------------------------------------------------------------------------------

test('TC-081 holiday allowance needs 15 contractual hours: 14.99 h → none, 15 h → 3 h (BR-06 a, BR-07)', async () => {
  assert.equal(Number(await db.value('select public.ss_holiday_hours(14.99)')), 0);
  assert.equal(Number(await db.value('select public.ss_holiday_hours(15)')), 3);
  assert.equal(Number(await db.value('select public.ss_holiday_hours(16)')), 3.2);
  // Through the week summary: fixed slots of 14 h 59 min (14.98 h) give none, 15 h give 3 h.
  const id = await db.fn('save_worker', null, 'Yoon Jisu', null, 10320, '2026-09-28', null, null, false, true);
  await db.fn('save_fixed_schedule', id, JSON.stringify([slot(1, '09:00', '16:30'), slot(2, '09:00', '16:29')]));
  await db.fn('generate_week', '2026-10-05');
  let row = await summaryOf('2026-10-05', id);
  assert.deepEqual([row.contract_hours, row.holiday_eligible, row.holiday_hours, row.holiday_pay, row.reasons],
    [14.98, false, 0, 0, [{ code: 'CONTRACT_BELOW_15' }]]);
  await db.fn('save_fixed_schedule', id, JSON.stringify([slot(1, '09:00', '16:30'), slot(2, '09:00', '16:30')]));
  row = await summaryOf('2026-10-05', id);
  assert.deepEqual([row.contract_hours, row.perfect_attendance, row.holiday_eligible, row.holiday_hours, row.holiday_pay, row.reasons],
    [15, true, true, 3, 30960, []]);
});

test('TC-082 holiday hours are capped at 40 contractual hours: 16 h → 3.2 h, 45 h → 8 h (BR-07)', async () => {
  assert.equal(Number(await db.value('select public.ss_holiday_hours(40)')), 8);
  assert.equal(Number(await db.value('select public.ss_holiday_hours(52)')), 8);
  const id = await db.fn('save_worker', null, 'Full Timer', null, 10320, '2026-09-28', null, null, false, true);
  await db.fn('save_fixed_schedule', id, JSON.stringify([1, 2, 3, 4, 5].map((d) => slot(d, '09:00', '18:00'))));
  await db.fn('generate_week', '2026-10-05');
  const row = await summaryOf('2026-10-05', id);
  assert.deepEqual([row.contract_hours, row.scheduled_hours, row.holiday_hours, row.holiday_pay], [45, 45, 8, 82560]);
  const minho = await summaryOf('2026-10-05', 3);
  assert.deepEqual([minho.contract_hours, minho.holiday_hours, minho.holiday_pay], [16, 3.2, 33024]);
});

test('TC-083 both substitution-attendance policies: a shift given away by an approved swap keeps (EXCUSED) or breaks (ABSENT) attendance (BR-06)', async () => {
  const r = await db.fn('create_sub_request', await db.shift(3, '2026-09-29'), 3, null, '2026-09-29 12:00');
  await db.fn('accept_sub_request', r.id, 2);
  await db.fn('decide_sub_request', r.id, 'APPROVE');
  let minho = await summaryOf('2026-09-28', 3);
  assert.deepEqual([minho.scheduled_hours, minho.holiday_eligible, minho.holiday_pay, minho.reasons], [11, true, 33024, []]);
  // Substitute shifts taken do not change the contractual hours of the acceptor (Seoyeon 10 h).
  const seoyeon = await summaryOf('2026-09-28', 2);
  assert.deepEqual([seoyeon.contract_hours, seoyeon.scheduled_hours], [10, 15]);
  await db.fn('update_settings', 'Dalbit Café', 4, 'ABSENT', null);
  minho = await summaryOf('2026-09-28', 3);
  assert.deepEqual([minho.perfect_attendance, minho.holiday_eligible, minho.holiday_pay, minho.reasons],
    [false, false, 0, [{ code: 'GAVE_AWAY', date: '2026-09-29' }]]);
});

test('TC-084 S3 holiday allowance: Minho 3.2 h = 33,024 before and after taking the shift; Seoyeon none (contract 10 h) (BR-06, BR-07)', async () => {
  await db.fn('accept_sub_request', 1, 3);
  const p = await db.fn('approval_preview', 1);
  assert.deepEqual([p.acceptor.before.holiday_hours, p.acceptor.before.holiday_pay, p.acceptor.after.holiday_pay, p.acceptor.eligibility_changed],
    [3.2, 33024, 33024, false]);
  assert.deepEqual([p.requester.before.holiday_eligible, p.requester.after.holiday_eligible, p.requester.after.reasons],
    [false, false, [{ code: 'CONTRACT_BELOW_15' }]]);
  await db.fn('decide_sub_request', 1, 'APPROVE');
  const minho = await summaryOf('2026-09-28', 3);
  assert.deepEqual([minho.contract_hours, minho.scheduled_hours, minho.holiday_hours, minho.holiday_pay], [16, 21, 3.2, 33024]);
});

test('TC-085 S11 no-show: at 2026-09-29 23:30 the owner marks Minho\'s Tue shift absent without a record; his week loses 33,024 → 0 (FR-25, BR-06)', async () => {
  assert.equal((await summaryOf('2026-09-28', 3)).holiday_pay, 33024);
  await db.clock('2026-09-29 23:30');
  const tue = await db.shift(3, '2026-09-29');
  assert.equal(await db.value('select count(*)::int from public.attendance where shift_id = $1', [tue]), 0);
  await db.fn('mark_absent', tue);
  const stored = await db.one("select perfect_attendance, holiday_eligible, holiday_hours::float8 as h, holiday_pay from public.weekly_summary where worker_id = 3 and week_start = '2026-09-28'");
  assert.deepEqual(stored, { perfect_attendance: false, holiday_eligible: false, h: 0, holiday_pay: 0 });
  const minho = await summaryOf('2026-09-28', 3);
  assert.deepEqual([minho.perfect_attendance, minho.holiday_pay, minho.reasons], [false, 0, [{ code: 'ABSENT', date: '2026-09-29' }]]);
});

test('TC-086 BR-06 default: a past shift that was not marked absent counts as worked (no attendance needed)', async () => {
  await db.clock('2026-10-05 09:00');
  const week = await db.fn('week_summary', '2026-09-28');
  assert.equal(week.frozen, false);
  const minho = week.rows.find((r) => r.worker_id === 3);
  assert.deepEqual([minho.actual_hours, minho.perfect_attendance, minho.holiday_eligible, minho.holiday_pay], [0, true, true, 33024]);
  assert.equal(await db.value("select count(*)::int from public.shift where work_date between '2026-09-28' and '2026-10-04' and status = 'SCHEDULED'"), 9);
});

test('TC-087 weeks of a month whose payroll is confirmed are not recomputed (FR-14)', async () => {
  // August is confirmed in the seed: the week of 08-24 (Sunday 08-30) is read-only; September's are not.
  const stored = await db.one("select contract_hours::float8 as c, holiday_pay from public.weekly_summary where worker_id = 3 and week_start = '2026-08-24'");
  assert.deepEqual(stored, { c: 16, holiday_pay: 33024 });
  await db.fn('save_fixed_schedule', 3, JSON.stringify([slot(2, '18:00', '23:00'), slot(4, '18:00', '23:00')]));
  const august = await db.fn('week_summary', '2026-08-24');
  assert.equal(august.frozen, true);
  const kept = august.rows.find((r) => r.worker_id === 3);
  assert.deepEqual([kept.contract_hours, kept.holiday_eligible, kept.holiday_pay], [16, true, 33024]);
  assert.deepEqual(await db.one("select contract_hours::float8 as c, holiday_pay from public.weekly_summary where worker_id = 3 and week_start = '2026-08-24'"), stored);
  // The week of 08-31 (Sunday 09-06) belongs to September and is recomputed.
  const september = await db.fn('week_summary', '2026-08-31');
  assert.equal(september.frozen, false);
  assert.deepEqual([september.rows.find((r) => r.worker_id === 3).contract_hours, september.rows.find((r) => r.worker_id === 3).holiday_pay], [10, 0]);
  await db.refused(db.fn('generate_payroll', '2026-08'), 'MONTH_CONFIRMED');
  await db.refused(db.fn('week_summary', null), 'TIME_INVALID');
});

test('TC-088 monthly holiday pay is the sum over the weeks whose Sunday falls in the month (BR-07, BR-11)', async () => {
  const sep = await db.fn('generate_payroll', '2026-09');
  assert.equal(rowOf(sep, 3).holiday_pay, 4 * 33024, 'weeks of 08-31, 09-07, 09-14, 09-21');
  const oct = await db.fn('generate_payroll', '2026-10');
  assert.equal(rowOf(oct, 3).holiday_pay, 33024, 'the week of 09-28 ends on Sunday 10-04');
});

// ---- TC-09x premium pay --------------------------------------------------------------------------------------------------

test('TC-091 premium is zero below five regular employees and paid from five (BR-08)', async () => {
  let sep = await db.fn('generate_payroll', '2026-09');
  assert.ok(sep.rows.every((r) => r.premium_pay === 0 && r.premium.total_minutes === 0));
  await db.fn('update_settings', 'Dalbit Café', 5, 'EXCUSED', null);
  sep = await db.fn('generate_payroll', '2026-09');
  // Seoyeon's nine September shifts end at 23:00: 9 night hours, and her 10 contractual hours are never exceeded.
  assert.deepEqual([rowOf(sep, 2).premium.night_minutes, rowOf(sep, 2).premium.part_time_minutes, rowOf(sep, 2).premium_pay], [540, 0, 47250]);
  assert.deepEqual([rowOf(sep, 3).premium.night_minutes, rowOf(sep, 3).premium_pay], [540, 46440]);
  assert.equal(rowOf(sep, 5).premium_pay, 0);
  assert.deepEqual((await premium([span('2026-09-29', '10:00', '23:00')], { employees: 4 })), { daily: 0, weekly: 0, night: 0, partTime: 0, total: 0 });
});

test('TC-092 night hours are the minutes between 22:00 and 06:00 on the actual time line: 22:00-02:00 is 4 h, on its work date (BR-08 iii, S9)', async () => {
  const night = (from, to) => db.value('select public.ss_night_minutes($1, $2) as r', [from, to]);
  assert.equal(await night('2026-10-02 22:00', '2026-10-03 02:00'), 240);
  assert.equal(await night('2026-09-29 21:00', '2026-09-30 07:00'), 480);
  assert.equal(await night('2026-09-29 18:00', '2026-09-29 23:00'), 60);
  assert.equal(await night('2026-09-29 04:00', '2026-09-29 07:00'), 120);
  assert.equal(await night('2026-09-29 10:00', '2026-09-29 16:00'), 0);
  await db.fn('update_settings', 'Dalbit Café', 5, 'EXCUSED', null);
  await db.fn('add_shift', '2026-10-02', '22:00', '02:00', 5);
  assert.equal(rowOf(await db.fn('generate_payroll', '2026-10'), 5).premium.night_minutes, 240);
  // A shift of Wed 09-30 22:00-02:00 belongs to September, also its hours after midnight.
  await db.fn('add_shift', '2026-09-30', '22:00', '02:00', 5);
  const sep = rowOf(await db.fn('generate_payroll', '2026-09'), 5);
  assert.deepEqual([sep.base_minutes, sep.premium.night_minutes], [48 * 60 + 240, 240]);
});

test('TC-093 premium vectors: daily beyond 8 h, weekly beyond 40 h, night hours, part-time beyond contract counted once (BR-08 i-iv)', async () => {
  assert.deepEqual(await premium([span('2026-09-29', '10:00', '23:00')]), { daily: 5, weekly: 0, night: 1, partTime: 0, total: 6 });
  assert.deepEqual(await premium([span('2026-09-29', '21:00', '07:00')]), { daily: 2, weekly: 0, night: 8, partTime: 0, total: 10 });
  const days = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'].map((d) => span(d, '09:00', '17:00'));
  const fifty = [...days, span('2026-10-03', '09:00', '19:00')];
  assert.deepEqual(await premium(fifty), { daily: 2, weekly: 8, night: 0, partTime: 0, total: 10 });
  // (iv) for a part-time worker (0 < C < 40): every hour after the first C hours of the week, each hour once.
  assert.deepEqual(await premium(fifty, { contractHours: 30 }), { daily: 2, weekly: 8, night: 0, partTime: 10, total: 20 });
  const partWeek = [span('2026-09-28', '10:00', '15:00'), span('2026-09-30', '10:00', '15:00'), span('2026-10-02', '10:00', '14:00')];
  assert.deepEqual(await premium(partWeek, { contractHours: 10 }), { daily: 0, weekly: 0, night: 0, partTime: 4, total: 4 });
  assert.equal((await premium([...partWeek, span('2026-10-05', '10:00', '15:00')], { contractHours: 10 })).partTime, 4, 'the test is weekly');
  assert.equal((await premium(partWeek, { contractHours: 40 })).total, 0, 'C >= 40 is not part-time');
  assert.equal((await premium(partWeek, { contractHours: 0 })).total, 0, 'no fixed schedule is not part-time');
  assert.equal((await premium(partWeek, { contractHours: 10, employees: 4 })).total, 0);
  // A 10 h day with C = 5: the larger of 2 h beyond 8 and 5 h beyond contract.
  assert.deepEqual(await premium([span('2026-09-29', '10:00', '20:00')], { contractHours: 5 }), { daily: 2, weekly: 0, night: 0, partTime: 3, total: 5 });
  // Night hours add to hours beyond contract, also on an overnight shift.
  const week = [span('2026-09-28', '18:00', '23:00'), span('2026-09-30', '18:00', '23:00'), span('2026-10-02', '19:00', '23:00')];
  assert.deepEqual(await premium(week, { contractHours: 10 }), { daily: 0, weekly: 0, night: 3, partTime: 4, total: 7 });
  assert.deepEqual(await premium([week[0], span('2026-09-29', '22:00', '06:00')], { contractHours: 10 }), { daily: 0, weekly: 0, night: 9, partTime: 3, total: 12 });
});

test('TC-094 in a monthly payroll the days of an ISO week outside the month only decide where the first C and the first 40 hours end (BR-08 e)', async () => {
  const sep = [span('2026-09-29', '18:00', '23:00'), span('2026-09-30', '18:00', '23:00')];
  const oct = [span('2026-10-01', '18:00', '23:00'), span('2026-10-02', '10:00', '18:00'), span('2026-10-03', '12:00', '18:00')];
  const october = { from: '2026-10-01', to: '2026-10-31', contractHours: 16 };
  assert.deepEqual(await premium([...sep, ...oct], october), { daily: 0, weekly: 0, night: 1, partTime: 13, total: 14 });
  assert.deepEqual(await premium([...sep, ...oct], { ...october, from: '2026-09-01', to: '2026-09-30' }), { daily: 0, weekly: 0, night: 2, partTime: 0, total: 2 });
  // Beyond 40 h (ii): six 8-hour days Mon 09-28 … Sat 10-03 are 8 h beyond 40, all on Saturday, paid in October.
  const sixDays = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'].map((d) => span(d, '09:00', '17:00'));
  assert.equal((await premium(sixDays, { from: '2026-10-01', to: '2026-10-31' })).weekly, 8);
  assert.equal((await premium(sixDays, { from: '2026-09-01', to: '2026-09-30' })).weekly, 0);
});

test('TC-095 S8 worked: October pays Minho 13 h beyond contract = 67,080 plus 1 night hour; September only night hours (BR-08 iv)', async () => {
  await s8(5);
  await db.fn('decide_sub_request', 1, 'APPROVE');
  await db.clock('2026-10-04 09:00');
  for (const s of await db.rows("select id, start_time::text as s, end_time::text as e from public.shift where worker_id = 3 and work_date between '2026-09-28' and '2026-10-04' order by work_date")) {
    await db.fn('record_attendance', s.id, 3, s.s, s.e);
    await db.fn('confirm_attendance', s.id);
  }
  const october = rowOf(await db.fn('generate_payroll', '2026-10'), 3);
  assert.deepEqual([october.base_hours, october.premium.part_time_minutes, october.premium.night_minutes, october.estimated],
    [19, 13 * 60, 60, false]);
  assert.equal(Math.floor(october.premium.part_time_minutes * 10320 / 120), 67080);
  assert.equal(october.premium_pay, 67080 + 5160);
  const september = rowOf(await db.fn('generate_payroll', '2026-09'), 3);
  assert.deepEqual([september.premium.part_time_minutes, september.premium.night_minutes, september.premium_pay], [0, 600, 51600]);
});

// ---- TC-10x minimum wage and probation -----------------------------------------------------------------------------------

test('TC-101 S6: September draft at 2026-10-01: Doyun\'s warning, Hana\'s probation minimum 9,288; confirmation waits for the acknowledgement (BR-09, BR-10, FR-16)', async () => {
  await db.clock('2026-10-01 09:00');
  assert.deepEqual(await db.fn('run_system_clock'), { expired: 1, drafted_months: ['2026-09'] });
  const month = await db.fn('payroll_month', '2026-09');
  assert.deepEqual([month.status, month.auto_prepared, month.minimum_hourly, month.unacknowledged_warnings], ['DRAFT', true, 10320, 1]);
  const doyun = month.rows.find((r) => r.worker_id === 5);
  assert.deepEqual([doyun.hourly_wage, doyun.min_wage_warning, doyun.min_wage_ack, doyun.probation_minimum], [10000, true, false, null]);
  const hana = month.rows.find((r) => r.worker_id === 4);
  assert.deepEqual([hana.hourly_wage, hana.min_wage_warning, hana.probation_minimum], [10320, false, 9288]);
  const { detail } = await db.refused(db.fn('confirm_payroll', '2026-09'), 'MIN_WAGE_UNACKNOWLEDGED');
  assert.deepEqual(detail.workers, [{ worker_id: 5, name: 'Kang Doyun' }]);
  await db.fn('acknowledge_min_wage', '2026-09', 4);
  assert.equal(await db.value("select min_wage_ack from public.payroll where year_month = '2026-09' and worker_id = 4"), false, 'no warning, nothing to acknowledge');
  await db.fn('acknowledge_min_wage', '2026-09', 5);
  await db.fn('confirm_payroll', '2026-09');
  const confirmed = await db.fn('payroll_month', '2026-09');
  assert.deepEqual([confirmed.status, confirmed.unacknowledged_warnings], ['CONFIRMED', 0]);
  assert.ok(confirmed.rows.every((r) => r.status === 'CONFIRMED'));
});

test('TC-102 probation applies only when all BR-10 conditions hold (one-year contract, first 3 months, until probation_end, not simple labour)', async () => {
  const probation = (date) => db.value('select public.ss_probation(4, $1) as r', [date]);
  const hana = (changes) => {
    const w = { end: null, probationEnd: '2026-11-30', simple: false, ...changes };
    return db.fn('save_worker', 4, 'Jung Hana', '010-6631-4427', 10320, '2026-09-01', w.end, w.probationEnd, w.simple, true);
  };
  assert.deepEqual([await probation('2026-08-31'), await probation('2026-09-01'), await probation('2026-11-30'), await probation('2026-12-01')],
    [false, true, true, false]);
  await hana({ probationEnd: '2027-03-01' });
  assert.deepEqual([await probation('2026-11-30'), await probation('2026-12-01')], [true, false], 'three months end on 12-01 (exclusive)');
  await hana({ probationEnd: '2026-10-15' });
  assert.deepEqual([await probation('2026-10-15'), await probation('2026-10-16')], [true, false]);
  await hana({ end: '2027-08-30' });
  assert.equal(await probation('2026-09-15'), false, 'contract shorter than 365 days');
  await hana({ end: '2027-09-01' });
  assert.equal(await probation('2026-09-15'), true);
  await hana({ simple: true });
  assert.equal(await probation('2026-09-15'), false);
  await hana({ probationEnd: null });
  assert.equal(await probation('2026-09-15'), false);
  assert.equal(await db.value("select public.ss_probation(5, '2026-09-01') as r"), false);
});

test('TC-103 the probation floor is exactly 9,288; a regenerated draft needs a new acknowledgement (BR-09)', async () => {
  let sep = await db.fn('generate_payroll', '2026-09');
  assert.deepEqual([sep.minimum_hourly, rowOf(sep, 4).probation, rowOf(sep, 4).applicable_minimum, rowOf(sep, 4).min_wage_warning], [10320, true, 9288, false]);
  assert.deepEqual([rowOf(sep, 5).probation, rowOf(sep, 5).applicable_minimum, rowOf(sep, 5).min_wage_warning], [false, 10320, true]);
  await db.fn('save_worker', 4, 'Jung Hana', '010-6631-4427', 9288, '2026-09-01', null, '2026-11-30', false, true);
  assert.equal(rowOf(await db.fn('generate_payroll', '2026-09'), 4).min_wage_warning, false);
  await db.fn('save_worker', 4, 'Jung Hana', '010-6631-4427', 9287, '2026-09-01', null, '2026-11-30', false, true);
  sep = await db.fn('generate_payroll', '2026-09');
  assert.equal(rowOf(sep, 4).min_wage_warning, true);
  await db.fn('acknowledge_min_wage', '2026-09', 4);
  await db.fn('acknowledge_min_wage', '2026-09', 5);
  await db.fn('generate_payroll', '2026-09');
  assert.equal(await db.value("select count(*)::int from public.payroll where year_month = '2026-09' and min_wage_ack"), 0);
  await db.refused(db.fn('confirm_payroll', '2026-09'), 'MIN_WAGE_UNACKNOWLEDGED');
});

// ---- TC-11x monthly payroll -----------------------------------------------------------------------------------------------

test('TC-111 September payroll of Choi Minho: 64 h worked + 5 h scheduled (estimated), four holiday weeks, total (BR-11)', async () => {
  const sep = await db.fn('generate_payroll', '2026-09');
  assert.deepEqual(sep.rows.map((r) => r.worker_id), [2, 3, 4, 5]);
  const minho = rowOf(sep, 3);
  assert.deepEqual([minho.base_minutes, minho.base_hours, minho.base_pay, minho.holiday_pay, minho.premium_pay, minho.total, minho.estimated],
    [69 * 60, 69, 712080, 132096, 0, 844176, true]);
  assert.deepEqual([rowOf(sep, 4).base_hours, rowOf(sep, 4).total, rowOf(sep, 4).estimated], [48, 495360, false]);
  assert.deepEqual(await db.one("select base_hours::float8 as h, base_pay, holiday_pay, total, status, estimated from public.payroll where year_month = '2026-09' and worker_id = 3"),
    { h: 69, base_pay: 712080, holiday_pay: 132096, total: 844176, status: 'DRAFT', estimated: true });
});

test('TC-112 hours are summed in minutes and converted once; WORKED shifts count their recorded minutes (BR-11)', async () => {
  const id = await db.fn('save_worker', null, 'Yoon Jisu', null, 10001, '2026-10-01', null, null, false, true);
  for (const d of ['2026-10-05', '2026-10-06', '2026-10-07']) await db.fn('add_shift', d, '10:00', '10:50', id);
  const row = rowOf(await db.fn('generate_payroll', '2026-10'), id);
  // 150 min × 10,001 / 60 = 25,002 (rounding each shift to 0.83 h would give 2.49 h and 24,902).
  assert.deepEqual([row.base_minutes, row.base_hours, row.base_pay], [150, 2.5, 25002]);
  await db.clock('2026-09-29 09:00');
  const mon = await db.shift(2, '2026-09-28');
  await db.fn('record_attendance', mon, 2, '18:05', '23:00');
  await db.fn('confirm_attendance', mon);
  const seoyeon = rowOf(await db.fn('generate_payroll', '2026-09'), 2);
  assert.deepEqual([seoyeon.base_minutes, seoyeon.base_hours, seoyeon.base_pay, seoyeon.estimated], [2695, 44.92, 471625, true]);
});

test('TC-113 ABSENT shifts are paid 0; a month of worked shifts only is not estimated (BR-11)', async () => {
  await db.clock('2026-09-29 23:30');
  await db.fn('mark_absent', await db.shift(3, '2026-09-29'));
  const minho = rowOf(await db.fn('generate_payroll', '2026-09'), 3);
  assert.deepEqual([minho.base_hours, minho.base_pay, minho.holiday_pay, minho.estimated], [64, 660480, 132096, false]);
  const october = rowOf(await db.fn('generate_payroll', '2026-10'), 3);
  assert.deepEqual([october.base_hours, october.holiday_pay, october.estimated], [11, 0, true]);
});

test('TC-114 a confirmed month is read-only; NO_DRAFT and MONTH_INVALID (FR-15)', async () => {
  const august = await db.rows("select worker_id, total, status from public.payroll where year_month = '2026-08' order by worker_id");
  await db.refused(db.fn('generate_payroll', '2026-08'), 'MONTH_CONFIRMED');
  await db.refused(db.fn('confirm_payroll', '2026-08'), 'NO_DRAFT');
  await db.refused(db.fn('acknowledge_min_wage', '2026-08', 5), 'NO_DRAFT');
  await db.refused(db.fn('confirm_payroll', '2026-09'), 'NO_DRAFT');
  for (const bad of ['2026-13', '2026-9', '202609', 'abc', null]) {
    await db.refused(db.fn('generate_payroll', bad), 'MONTH_INVALID');
    await db.refused(db.fn('payroll_month', bad), 'MONTH_INVALID');
  }
  await db.fn('update_settings', 'Dalbit Café', 5, 'EXCUSED', null);
  await db.clock('2026-12-02 09:00');
  await db.fn('run_system_clock');
  assert.deepEqual(await db.rows("select worker_id, total, status from public.payroll where year_month = '2026-08' order by worker_id"), august);
});

// ---- TC-14x automatic payroll drafts ------------------------------------------------------------------------------------

test('TC-141 S10: no draft is due before 2026-10-01; at 10-01 09:00 the System Clock drafts September once and tells the owner (BR-14, FR-23)', async () => {
  assert.deepEqual(await db.fn('run_system_clock'), { expired: 0, drafted_months: [] });
  await db.clock('2026-09-30 23:59');
  assert.deepEqual((await db.fn('run_system_clock')).drafted_months, []);
  await db.clock('2026-10-01 09:00');
  assert.deepEqual((await db.fn('run_system_clock')).drafted_months, ['2026-09']);
  assert.deepEqual(await db.rows("select worker_id, sub_request_id, params, created_at::text, read_at from public.notification where kind = 'PAYROLL_DRAFT_READY'"),
    [{ worker_id: 1, sub_request_id: null, params: { year_month: '2026-09' }, created_at: '2026-10-01 09:00:00', read_at: null }]);
  const home = await db.fn('owner_home');
  assert.deepEqual(home.payroll_ready.map((p) => p.year_month), ['2026-09']);
  assert.deepEqual(home.pay_warnings.map((w) => [w.year_month, w.name]), [['2026-09', 'Kang Doyun']]);
  assert.deepEqual((await db.fn('payroll_months')).at(-1), { year_month: '2026-09', status: 'DRAFT', auto_prepared: true });
  // The draft is exactly what generate_payroll computes; nothing is drafted again or confirmed.
  const drafted = await db.rows("select worker_id, base_pay, holiday_pay, premium_pay, total, min_wage_warning, estimated from public.payroll where year_month = '2026-09' order by worker_id");
  await db.clock('2026-10-20 09:00');
  assert.deepEqual((await db.fn('run_system_clock')).drafted_months, []);
  assert.equal(await db.value("select count(*)::int from public.notification where kind = 'PAYROLL_DRAFT_READY'"), 1);
  await db.fn('generate_payroll', '2026-09');
  assert.deepEqual(await db.rows("select worker_id, base_pay, holiday_pay, premium_pay, total, min_wage_warning, estimated from public.payroll where year_month = '2026-09' order by worker_id"), drafted);
});

test('TC-142 every missing month is drafted: clock 2026-09-28 → 2026-12-02 drafts September, October and November, one notification each (BR-14)', async () => {
  await db.clock('2026-12-02 09:00');
  assert.deepEqual(await db.fn('run_system_clock'), { expired: 1, drafted_months: ['2026-09', '2026-10', '2026-11'] });
  assert.deepEqual((await db.rows("select params->>'year_month' as m, worker_id from public.notification where kind = 'PAYROLL_DRAFT_READY' order by id"))
    .map((n) => [n.m, n.worker_id]), [['2026-09', 1], ['2026-10', 1], ['2026-11', 1]]);
  assert.deepEqual(await db.rows("select year_month, count(*)::int as n, bool_and(status = 'DRAFT') as drafts from public.payroll where year_month >= '2026-09' group by year_month order by year_month"),
    [{ year_month: '2026-09', n: 4, drafts: true }, { year_month: '2026-10', n: 4, drafts: true }, { year_month: '2026-11', n: 4, drafts: true }]);
  // Existing rows are never overwritten (an acknowledgement stays) and nothing is confirmed.
  await db.fn('acknowledge_min_wage', '2026-10', 5);
  assert.deepEqual(await db.fn('run_system_clock'), { expired: 0, drafted_months: [] });
  assert.equal(await db.value("select min_wage_ack from public.payroll where year_month = '2026-10' and worker_id = 5"), true);
  assert.equal(await db.value("select count(*)::int from public.notification where kind = 'PAYROLL_DRAFT_READY'"), 3);
  assert.deepEqual((await db.fn('payroll_months')).slice(-3).map((m) => [m.year_month, m.status, m.auto_prepared]),
    [['2026-09', 'DRAFT', true], ['2026-10', 'DRAFT', true], ['2026-11', 'DRAFT', true]]);
});

// ---- TC-15x part-time weekly limit warning ------------------------------------------------------------------------------

test('TC-151 S8: with 5 regular employees the preview shows Minho 24 → 29 h and warns of 13 h beyond contract (limit 12); approval is not blocked (BR-15, FR-24)', async () => {
  const p = await s8(5);
  assert.deepEqual([p.acceptor.name, p.acceptor.before.scheduled_hours, p.acceptor.after.scheduled_hours, p.acceptor.contract_hours, p.acceptor.part_time],
    ['Choi Minho', 24, 29, 16, true]);
  assert.deepEqual(p.warning, { beyond_contract: 13, limit: 12 });
  assert.deepEqual((await db.fn('owner_home')).decisions[0].warning, { beyond_contract: 13, limit: 12 });
  assert.deepEqual(await db.fn('decide_sub_request', 1, 'APPROVE'), { id: 1, status: 'APPROVED' });
});

test('TC-152 S8 with Friday 10:00-17:00: Minho 23 → 28 h is exactly 12 h beyond contract, no warning (BR-15)', async () => {
  const p = await s8(5, '17:00');
  assert.deepEqual([p.acceptor.before.scheduled_hours, p.acceptor.after.scheduled_hours, p.warning], [23, 28, null]);
});

test('TC-153 S8 with 4 regular employees: 13 h beyond contract but no warning and no premium (BR-15, BR-08)', async () => {
  const p = await s8(4);
  assert.deepEqual([p.acceptor.after.scheduled_hours, p.warning, p.acceptor.change.premium_pay, p.requester.change.premium_pay], [29, null, 0, 0]);
});

// ---- TC-17x swap cost estimate ------------------------------------------------------------------------------------------

test('TC-171 S3: Seoyeon 10 → 5 h, pay −52,500; Minho 16 → 21 h, holiday 33,024 unchanged, pay +51,600; premium 0; store −900 (BR-16, FR-11)', async () => {
  await db.fn('accept_sub_request', 1, 3);
  const p = await db.fn('approval_preview', 1);
  assert.deepEqual([p.request_id, p.week_start, p.policy, p.regular_employees, p.warning, p.store_total_change], [1, '2026-09-28', 'EXCUSED', 4, null, -900]);
  const s = p.requester;
  assert.deepEqual([s.name, s.contract_hours, s.before.scheduled_hours, s.after.scheduled_hours, s.before.holiday_eligible, s.after.holiday_eligible, s.before.holiday_pay, s.after.holiday_pay],
    ['Lee Seoyeon', 10, 10, 5, false, false, 0, 0]);
  assert.deepEqual(s.change, { scheduled_hours: -5, base_pay: -52500, premium_pay: 0, holiday_pay: 0, total: -52500 });
  const m = p.acceptor;
  assert.deepEqual([m.name, m.contract_hours, m.before.scheduled_hours, m.after.scheduled_hours, m.before.holiday_eligible, m.after.holiday_eligible, m.before.holiday_hours, m.after.holiday_pay],
    ['Choi Minho', 16, 16, 21, true, true, 3.2, 33024]);
  assert.deepEqual(m.change, { scheduled_hours: 5, base_pay: 51600, premium_pay: 0, holiday_pay: 0, total: 51600 });
  assert.deepEqual([p.shift.work_date, p.shift.start_time, p.shift.end_time, p.shift.worker_name], ['2026-09-30', '18:00', '23:00', 'Lee Seoyeon']);
  const home = await db.fn('owner_home');
  assert.deepEqual(home.decisions.map((d) => [d.request_id, d.store_total_change]), [[1, -900]]);
});

test('TC-172 S7: policy ABSENT; Minho gives away Sat 12:00-18:00 to Hana: Minho eligible → not, holiday −33,024, pay −61,920; Hana +61,920; store −33,024 (BR-16)', async () => {
  const { preview: p } = await s7();
  assert.deepEqual([p.policy, p.store_total_change, p.warning], ['ABSENT', -33024, null]);
  const m = p.requester;
  assert.deepEqual([m.name, m.before.holiday_eligible, m.after.holiday_eligible, m.eligibility_changed, m.after.reasons],
    ['Choi Minho', true, false, true, [{ code: 'GAVE_AWAY', date: '2026-10-03' }]]);
  assert.deepEqual(m.change, { scheduled_hours: -6, base_pay: -61920, premium_pay: 0, holiday_pay: -33024, total: -94944 });
  const h = p.acceptor;
  assert.deepEqual([h.name, h.contract_hours, h.before.scheduled_hours, h.after.scheduled_hours], ['Jung Hana', 12, 12, 18]);
  assert.deepEqual(h.change, { scheduled_hours: 6, base_pay: 61920, premium_pay: 0, holiday_pay: 0, total: 61920 });
});

test('TC-173 S8: Minho base +51,600 and premium +30,960 (beyond contract 8 → 13 h, night 2 → 3 h); Seoyeon base −52,500 and premium −5,250 (night 2 → 1 h) (BR-16, BR-08)', async () => {
  const p = await s8(5);
  const m = p.acceptor;
  assert.deepEqual([m.before.premium.part_time_minutes, m.after.premium.part_time_minutes, m.before.premium.night_minutes, m.after.premium.night_minutes],
    [8 * 60, 13 * 60, 2 * 60, 3 * 60]);
  assert.deepEqual([m.change.base_pay, m.change.premium_pay, m.change.holiday_pay], [51600, 30960, 0]);
  assert.equal(m.change.premium_pay, 6 * 10320 * 0.5);
  const s = p.requester;
  assert.deepEqual([s.before.premium.night_minutes, s.after.premium.night_minutes, s.before.premium.part_time_minutes, s.after.premium.part_time_minutes],
    [2 * 60, 60, 0, 0]);
  assert.deepEqual([s.change.base_pay, s.change.premium_pay], [-52500, -5250]);
  assert.equal(p.store_total_change, (51600 + 30960) + (-52500 - 5250));
});
