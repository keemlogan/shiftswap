// TC-19x (continued): the read functions the screens call instead of reading tables (FR-20, FR-21, UC-01, UC-04,
// UC-07, UC-09, NFR-13), each checked against the seed of spec §10.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.mjs';

const db = await setup({ beforeEach, afterEach });

const fixed = (slots) => slots.map((f) => `${f.weekday} ${f.start_time}-${f.end_time}`);

test('TC-19A demo_accounts: the active accounts, owner first, with weekly contractual hours and fixed shifts (FR-20)', async () => {
  const accounts = await db.fn('demo_accounts');
  assert.deepEqual(accounts.map((a) => [a.id, a.role, a.name, a.contract_hours, fixed(a.fixed)]), [
    [1, 'OWNER', 'Park Jiyoung', null, []],
    [2, 'WORKER', 'Lee Seoyeon', 10, ['1 18:00-23:00', '3 18:00-23:00']],
    [3, 'WORKER', 'Choi Minho', 16, ['2 18:00-23:00', '4 18:00-23:00', '6 12:00-18:00']],
    [4, 'WORKER', 'Jung Hana', 12, ['5 17:00-23:00', '7 10:00-16:00']],
    [5, 'WORKER', 'Kang Doyun', 12, ['6 10:00-16:00', '7 16:00-22:00']],
  ]);
  await db.fn('save_worker', 5, 'Kang Doyun', '010-7748-5539', 10000, '2026-08-15', '2026-11-15', null, true, false);
  assert.deepEqual((await db.fn('demo_accounts')).map((a) => a.id), [1, 2, 3, 4]);
});

test('TC-19B get_settings: store, regular employees, policy, demo clock, now and the minimum wages (UC-10)', async () => {
  assert.deepEqual(await db.fn('get_settings'), {
    workplace: { id: 1, name: 'Dalbit Café', regular_employees: 4, sub_attendance_policy: 'EXCUSED', demo_clock: '2026-09-28T09:00:00' },
    now: '2026-09-28T09:00:00',
    minimum_wages: [{ year: 2025, hourly: 10030 }, { year: 2026, hourly: 10320 }],
  });
  assert.equal(await db.clock(null), await db.value("select (now() at time zone 'Asia/Seoul')::text"));
  const settings = await db.fn('get_settings');
  assert.equal(settings.workplace.demo_clock, null);
  assert.equal(await db.clock('2026-10-01 09:00'), '2026-10-01 09:00:00');
});

test('TC-19C list_workers and worker_detail: the staff with contract data and contractual hours (UC-01)', async () => {
  const staff = await db.fn('list_workers');
  assert.deepEqual(staff.map((w) => [w.id, w.name, w.role, w.phone, w.hourly_wage, w.contract_start, w.contract_end, w.probation_end, w.simple_labor, w.active, w.contract_hours]), [
    [2, 'Lee Seoyeon', 'WORKER', '010-4172-2083', 10500, '2026-03-02', '2027-02-28', null, false, true, 10],
    [3, 'Choi Minho', 'WORKER', '010-5290-3316', 10320, '2026-06-01', '2026-12-31', null, false, true, 16],
    [4, 'Jung Hana', 'WORKER', '010-6631-4427', 10320, '2026-09-01', null, '2026-11-30', false, true, 12],
    [5, 'Kang Doyun', 'WORKER', '010-7748-5539', 10000, '2026-08-15', '2026-11-15', null, true, true, 12],
  ]);
  const minho = await db.fn('worker_detail', 3);
  assert.deepEqual([minho.name, minho.hourly_wage, minho.contract_hours, fixed(minho.fixed)],
    ['Choi Minho', 10320, 16, ['2 18:00-23:00', '4 18:00-23:00', '6 12:00-18:00']]);
  assert.deepEqual(minho.fixed.map((f) => f.hours), [5, 5, 6]);
  await db.refused(db.fn('worker_detail', 999), 'WORKER_INVALID');
  // A new worker is listed after save_worker (FR-01).
  const id = await db.fn('save_worker', null, '  Yoon Jisu ', ' 010-1234-5678 ', 10500, '2026-10-01', null, '2026-12-31', false, true);
  const added = await db.fn('worker_detail', id);
  assert.deepEqual([added.name, added.phone, added.role, added.contract_hours, added.fixed], ['Yoon Jisu', '010-1234-5678', 'WORKER', 0, []]);
  assert.equal((await db.fn('list_workers')).length, 5);
});

test('TC-19D requestable_shifts: own future SCHEDULED shifts without an open request, with the default deadline (UC-04)', async () => {
  assert.deepEqual((await db.fn('requestable_shifts', 3)).map((s) => [s.work_date, s.start_time, s.end_time, s.default_deadline]), [
    ['2026-09-29', '18:00', '23:00', '2026-09-29T09:00:00'],
    ['2026-10-01', '18:00', '23:00', '2026-09-29T09:00:00'],
    ['2026-10-03', '12:00', '18:00', '2026-09-29T09:00:00'],
  ]);
  // Seoyeon's Wednesday has the open seed request; Monday's default deadline is its start (earlier than now + 24 h).
  assert.deepEqual((await db.fn('requestable_shifts', 2)).map((s) => [s.work_date, s.default_deadline]), [['2026-09-28', '2026-09-28T18:00:00']]);
  await db.fn('cancel_sub_request', 1, 2);
  assert.deepEqual((await db.fn('requestable_shifts', 2)).map((s) => s.work_date), ['2026-09-28', '2026-09-30']);
  await db.clock('2026-09-28 18:00');
  assert.deepEqual((await db.fn('requestable_shifts', 2)).map((s) => s.work_date), ['2026-09-30']);
  await db.refused(db.fn('requestable_shifts', 999), 'WORKER_INVALID');
});

test('TC-19E my_requests: my own requests newest first and the requests for me, open ones first, with the effect on my week (UC-04, UC-05, UC-12)', async () => {
  const seoyeon = await db.fn('my_requests', 2);
  assert.deepEqual(seoyeon.for_me, []);
  assert.equal(seoyeon.mine.length, 1);
  const mine = seoyeon.mine[0];
  assert.deepEqual([mine.id, mine.status, mine.shift.work_date, mine.shift.start_time, mine.shift.end_time, mine.reason, mine.deadline, mine.acceptor, mine.created_at, mine.decided_at],
    [1, 'REQUESTED', '2026-09-30', '18:00', '23:00', 'Midterm exam', '2026-09-29T21:00:00', null, '2026-09-28T08:30:00', null]);
  assert.deepEqual(mine.targets.map((t) => [t.worker_id, t.name, t.response]), [[3, 'Choi Minho', 'PENDING'], [4, 'Jung Hana', 'PENDING'], [5, 'Kang Doyun', 'PENDING']]);
  const minho = await db.fn('my_requests', 3);
  assert.deepEqual(minho.mine, []);
  const forMinho = minho.for_me[0];
  assert.deepEqual([forMinho.id, forMinho.status, forMinho.requester, forMinho.my_response], [1, 'REQUESTED', { id: 2, name: 'Lee Seoyeon' }, 'PENDING']);
  assert.deepEqual(forMinho.effect, { scheduled_before: 16, scheduled_after: 21, holiday_pay_before: 33024, holiday_pay_after: 33024,
    eligible_before: true, eligible_after: true, total_change: 51600 });
  // After the approval: Doyun's card is closed (no effect) and comes after a new open request.
  await db.fn('accept_sub_request', 1, 3);
  await db.fn('decide_sub_request', 1, 'APPROVE');
  const thursday = await db.fn('create_sub_request', await db.shift(3, '2026-10-01'), 3, null, '2026-09-30 12:00');
  const doyun = (await db.fn('my_requests', 5)).for_me;
  assert.deepEqual(doyun.map((r) => [r.id, r.status, r.my_response, r.effect === null]), [[thursday.id, 'REQUESTED', 'PENDING', false], [1, 'APPROVED', 'CLOSED', true]]);
  assert.deepEqual(doyun[1].acceptor, { id: 3, name: 'Choi Minho' });
  const own = (await db.fn('my_requests', 2)).mine[0];
  assert.deepEqual([own.status, own.acceptor, own.decided_at], ['APPROVED', { id: 3, name: 'Choi Minho' }, '2026-09-28T09:00:00']);
  await db.refused(db.fn('my_requests', 999), 'WORKER_INVALID');
});

test('TC-19F attendance_list: my shifts of the previous and the current week with their records; can_record after the end (UC-07, BR-17)', async () => {
  let list = await db.fn('attendance_list', 2);
  assert.deepEqual(list.map((s) => [s.work_date, s.status, s.attendance && `${s.attendance.clock_in}-${s.attendance.clock_out} ${s.attendance.confirmed}`, s.can_record]), [
    ['2026-09-21', 'WORKED', '18:00-23:00 true', false],
    ['2026-09-23', 'WORKED', '18:00-23:00 true', false],
    ['2026-09-28', 'SCHEDULED', null, false],
    ['2026-09-30', 'SCHEDULED', null, false],
  ]);
  await db.clock('2026-09-29 09:00');
  list = await db.fn('attendance_list', 2);
  assert.deepEqual(list.filter((s) => s.can_record).map((s) => s.work_date), ['2026-09-28']);
  await db.fn('record_attendance', list[2].id, 2, '18:00', '23:00');
  list = await db.fn('attendance_list', 2);
  assert.deepEqual([list[2].attendance, list[2].can_record], [{ clock_in: '18:00', clock_out: '23:00', confirmed: false }, false]);
  const home = await db.fn('owner_home');
  assert.deepEqual(home.to_confirm.map((s) => [s.id, s.worker_name, s.clock_in, s.clock_out, s.recorded_minutes]), [[list[2].id, 'Lee Seoyeon', '18:00', '23:00', 300]]);
  await db.refused(db.fn('attendance_list', 999), 'WORKER_INVALID');
});

test('TC-19G payroll_month and payroll_months: stored rows, flags, status and totals; nothing is generated (UC-09, UC-14)', async () => {
  const august = await db.fn('payroll_month', '2026-08');
  assert.deepEqual([august.status, august.auto_prepared, august.minimum_hourly, august.unacknowledged_warnings], ['CONFIRMED', false, 10320, 0]);
  assert.deepEqual(august.rows.map((r) => [r.worker_id, r.name, r.base_hours, r.base_pay, r.holiday_pay, r.total, r.min_wage_warning, r.min_wage_ack, r.estimated, r.status, r.probation_minimum]), [
    [2, 'Lee Seoyeon', 45, 472500, 0, 472500, false, false, false, 'CONFIRMED', null],
    [3, 'Choi Minho', 70, 722400, 165120, 887520, false, false, false, 'CONFIRMED', null],
    [5, 'Kang Doyun', 36, 360000, 0, 360000, true, true, false, 'CONFIRMED', null],
  ]);
  assert.deepEqual(august.totals, { base_hours: 151, base_pay: 1554900, holiday_pay: 165120, premium_pay: 0, total: 1720020 });
  const september = await db.fn('payroll_month', '2026-09');
  assert.deepEqual([september.status, september.rows, september.unacknowledged_warnings, september.totals.total], ['NONE', [], 0, 0]);
  assert.equal(await db.value("select count(*)::int from public.payroll where year_month = '2026-09'"), 0);
  assert.deepEqual(await db.fn('payroll_months'), ['03', '04', '05', '06', '07', '08']
    .map((m) => ({ year_month: `2026-${m}`, status: 'CONFIRMED', auto_prepared: false })));
  await db.fn('generate_payroll', '2026-09');
  assert.deepEqual((await db.fn('payroll_months')).at(-1), { year_month: '2026-09', status: 'DRAFT', auto_prepared: false });
  assert.equal((await db.fn('payroll_month', '2026-09')).rows.find((r) => r.worker_id === 4).probation_minimum, 9288);
});

test('TC-19H notifications and mark_notifications_read: the inbox newest first with the unread count (FR-21)', async () => {
  let inbox = await db.fn('notifications', 3);
  assert.equal(inbox.unread, 1);
  assert.deepEqual(inbox.items.map((n) => [n.id, n.kind, n.sub_request_id, n.created_at, n.read_at, n.params.requester_name]),
    [[1, 'REQUEST_RECEIVED', 1, '2026-09-28T08:30:00', null, 'Lee Seoyeon']]);
  assert.deepEqual(await db.fn('notifications', 1), { items: [], unread: 0 });
  await db.fn('accept_sub_request', 1, 3);
  await db.fn('decide_sub_request', 1, 'APPROVE');
  inbox = await db.fn('notifications', 2);
  assert.deepEqual([inbox.unread, inbox.items.map((n) => n.kind)], [2, ['REQUEST_APPROVED', 'REQUEST_ACCEPTED']]);
  assert.equal(await db.fn('mark_notifications_read', 2, `{${inbox.items[1].id}}`), 1);
  assert.equal((await db.fn('notifications', 2)).unread, 1);
  assert.equal(await db.fn('mark_notifications_read', 2, null), 1);
  inbox = await db.fn('notifications', 2);
  assert.deepEqual([inbox.unread, inbox.items.every((n) => n.read_at === '2026-09-28T09:00:00')], [0, true]);
  await db.refused(db.fn('notifications', 999), 'WORKER_INVALID');
});

test('TC-19I worker_home: requests for me with the effect on my week, my open requests, next shift, this week (NFR-13, UC-05)', async () => {
  const minho = await db.fn('worker_home', 3);
  assert.deepEqual([minho.worker.name, minho.today, minho.unread, minho.taken, minho.my_open, minho.failed, minho.to_record], ['Choi Minho', '2026-09-28', 1, [], [], [], []]);
  assert.equal(minho.incoming.length, 1);
  const card = minho.incoming[0];
  assert.deepEqual([card.request_id, card.requester_name, card.work_date, card.start_time, card.reason, card.deadline],
    [1, 'Lee Seoyeon', '2026-09-30', '18:00', 'Midterm exam', '2026-09-29T21:00:00']);
  assert.deepEqual([card.effect.before.scheduled_hours, card.effect.after.scheduled_hours, card.effect.before.holiday_pay, card.effect.after.holiday_pay, card.effect.eligibility_changed],
    [16, 21, 33024, 33024, false]);
  assert.deepEqual([minho.next_shift.work_date, minho.next_shift.start_time], ['2026-09-29', '18:00']);
  assert.deepEqual([minho.week.contract_hours, minho.week.scheduled_hours, minho.week.holiday_eligible, minho.week.holiday_pay], [16, 16, true, 33024]);
  await db.fn('accept_sub_request', 1, 3);
  assert.deepEqual((await db.fn('worker_home', 3)).incoming, []);
  const doyun = await db.fn('worker_home', 5);
  assert.deepEqual([doyun.incoming.length, doyun.taken.map((r) => r.acceptor_name)], [0, ['Choi Minho']]);
  const seoyeon = await db.fn('worker_home', 2);
  assert.deepEqual([seoyeon.my_open[0].status, seoyeon.my_open[0].acceptor_name, seoyeon.my_open[0].targets.map((t) => t.response)],
    ['ACCEPTED', 'Choi Minho', ['ACCEPTED', 'CLOSED', 'CLOSED']]);
  assert.deepEqual([seoyeon.week.contract_hours, seoyeon.week.holiday_eligible, seoyeon.week.reasons], [10, false, [{ code: 'CONTRACT_BELOW_15' }]]);
});

test('TC-19J owner_home: decisions with the preview, open requests, today\'s shifts and week totals (NFR-13, UC-06)', async () => {
  let home = await db.fn('owner_home');
  assert.deepEqual([home.today, home.decisions, home.failed, home.to_confirm, home.payroll_ready, home.pay_warnings, home.unread], ['2026-09-28', [], [], [], [], [], 0]);
  assert.deepEqual(home.open.map((r) => [r.request_id, r.targets.map((t) => `${t.name}:${t.response}`)]),
    [[1, ['Choi Minho:PENDING', 'Jung Hana:PENDING', 'Kang Doyun:PENDING']]]);
  assert.deepEqual(home.today_shifts.map((s) => [s.worker_name, s.start_time]), [['Lee Seoyeon', '18:00']]);
  assert.deepEqual(home.week, { week_start: '2026-09-28', shifts: 9, hours: 50, holiday_total: 33024, labour_cost: 546984 });
  await db.fn('accept_sub_request', 1, 3);
  home = await db.fn('owner_home');
  assert.deepEqual([home.open, home.unread, home.decisions.length], [[], 1, 1]);
  const decision = home.decisions[0];
  assert.deepEqual([decision.request_id, decision.requester.name, decision.acceptor.name, decision.store_total_change, decision.warning], [1, 'Lee Seoyeon', 'Choi Minho', -900, null]);
  await db.fn('decide_sub_request', 1, 'APPROVE');
  home = await db.fn('owner_home');
  assert.deepEqual([home.decisions, home.week.hours, home.week.holiday_total], [[], 50, 33024]);
});
