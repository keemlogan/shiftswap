// TC-01x: time line, overlap and eligibility (BR-01, BR-05), weekly schedule (FR-02, FR-04, FR-05, FR-25).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.mjs';

const db = await setup({ beforeEach, afterEach });

const slot = (weekday, start_time, end_time) => ({ weekday, start_time, end_time });
const names = (list) => list.map((c) => c.name);

test('TC-011 S9: Fri 2026-10-02 22:00-02:00 belongs to Friday and the week of 09-28, lasts 4 h; Sat 01:00-05:00 overlaps it (BR-05)', async () => {
  const id = await db.fn('add_shift', '2026-10-02', '22:00', '02:00', 5);
  const shift = await db.fn('shift_detail', id);
  assert.deepEqual([shift.work_date, shift.start_time, shift.end_time, shift.minutes, shift.hours, shift.end_at],
    ['2026-10-02', '22:00', '02:00', 240, 4, '2026-10-03T02:00:00']);
  const board = await db.fn('week_board', '2026-09-28');
  assert.ok(board.shifts.some((s) => s.id === id && s.worker_name === 'Kang Doyun'));
  const { detail, hint } = await db.refused(db.fn('add_shift', '2026-10-03', '01:00', '05:00', 5), 'OVERLAP');
  assert.deepEqual([detail.shift_id, detail.work_date, detail.start_time, detail.end_time], [id, '2026-10-02', '22:00', '02:00']);
  assert.match(hint, /Kang Doyun already works 2026-10-02 22:00-02:00/);
  // Intervals are half-open: a shift starting at 02:00 only touches it.
  assert.ok(await db.fn('add_shift', '2026-10-03', '02:00', '05:00', 5));
});

test('TC-012 single shifts: Mon 22:00-02:00 overlaps Tue 01:00-05:00, Sun 22:00-02:00 overlaps the next Monday 01:00-05:00 (BR-05, FR-05)', async () => {
  await db.fn('add_shift', '2026-10-05', '22:00', '02:00', 4);
  await db.refused(db.fn('add_shift', '2026-10-06', '01:00', '05:00', 4), 'OVERLAP');
  // Across the end of the ISO week.
  const sunday = await db.fn('add_shift', '2026-10-04', '22:00', '02:00', 2);
  const { detail } = await db.refused(db.fn('add_shift', '2026-10-05', '01:00', '05:00', 2), 'OVERLAP');
  assert.equal(detail.shift_id, sunday);
  // Moving a shift into the night is checked the same way.
  const monday = await db.shift(2, '2026-09-28');
  await db.refused(db.fn('update_shift', monday, '2026-10-05', '00:30', '03:00', 2), 'OVERLAP');
  await db.fn('update_shift', monday, '2026-10-05', '02:00', '06:00', 2);
  assert.deepEqual(await db.one(
    "select work_date::text, start_time::text, end_time::text from public.shift where id = $1", [monday]),
    { work_date: '2026-10-05', start_time: '02:00:00', end_time: '06:00:00' });
});

test('TC-013 fixed slots of one worker are compared on the weekly time line, across midnight and from Sunday into Monday (FR-02, BR-05)', async () => {
  await db.refused(db.fn('save_fixed_schedule', 4, JSON.stringify([slot(1, '22:00', '02:00'), slot(2, '01:00', '05:00')])), 'OVERLAP');
  const { detail } = await db.refused(
    db.fn('save_fixed_schedule', 4, JSON.stringify([slot(7, '22:00', '02:00'), slot(1, '01:00', '05:00')])), 'OVERLAP');
  assert.deepEqual([detail.a.weekday, detail.b.weekday], [7, 1]);
  await db.refused(db.fn('save_fixed_schedule', 4, JSON.stringify([slot(3, '09:00', '12:00'), slot(3, '11:00', '13:00')])), 'OVERLAP');
  for (const bad of [slot(1, '10:00', '10:00'), slot(1, '10:00', '10:20'), slot(1, '06:00', '23:00'), slot(8, '10:00', '12:00'),
    slot(1, '25:00', '26:00'), slot(1, 'ten', '12:00')]) {
    await db.refused(db.fn('save_fixed_schedule', 4, JSON.stringify([bad])), 'TIME_INVALID');
  }
  await db.refused(db.fn('save_fixed_schedule', 1, '[]'), 'WORKER_INVALID');
  // Touching slots are allowed; the Sunday slot ends on Monday 02:00 and counts 4 h.
  const saved = await db.fn('save_fixed_schedule', 4, JSON.stringify([slot(7, '22:00', '02:00'), slot(1, '02:00', '05:00')]));
  assert.equal(saved.contract_hours, 7);
  assert.deepEqual(saved.slots.map((s) => [s.weekday, s.start_time, s.end_time, s.hours]), [[1, '02:00', '05:00', 3], [7, '22:00', '02:00', 4]]);
  // Deleting a fixed slot keeps the shifts it generated (FR-02).
  assert.deepEqual(await db.one(
    'select count(*)::int as n, count(fixed_schedule_id)::int as linked from public.shift where worker_id = 4'), { n: 10, linked: 0 });
  // The new slots are generated, the Sunday one ending on the next Monday.
  assert.equal(await db.fn('generate_week', '2026-10-05'), 9);
  assert.deepEqual(await db.rows(
    "select work_date::text, start_time::text, end_time::text from public.shift where worker_id = 4 and work_date >= '2026-10-05' order by work_date"),
    [{ work_date: '2026-10-05', start_time: '02:00:00', end_time: '05:00:00' }, { work_date: '2026-10-11', start_time: '22:00:00', end_time: '02:00:00' }]);
});

test('TC-014 S1: the seed request asks Minho, Hana and Doyun, each with a REQUEST_RECEIVED notification (BR-01, FR-07)', async () => {
  const wed = await db.shift(2, '2026-09-30');
  assert.deepEqual(await db.fn('preview_candidates', wed, 2),
    [{ id: 3, name: 'Choi Minho' }, { id: 4, name: 'Jung Hana' }, { id: 5, name: 'Kang Doyun' }]);
  assert.deepEqual(await db.rows('select worker_id, response from public.sub_request_target where sub_request_id = 1 order by worker_id'),
    [{ worker_id: 3, response: 'PENDING' }, { worker_id: 4, response: 'PENDING' }, { worker_id: 5, response: 'PENDING' }]);
  const notes = await db.rows("select worker_id, created_at::text, params from public.notification where kind = 'REQUEST_RECEIVED' order by worker_id");
  assert.deepEqual(notes.map((n) => n.worker_id), [3, 4, 5]);
  for (const n of notes) {
    assert.equal(n.created_at, '2026-09-28 08:30:00');
    assert.deepEqual([n.params.request_id, n.params.requester_name, n.params.work_date, n.params.start_time, n.params.end_time, n.params.deadline, n.params.reason],
      [1, 'Lee Seoyeon', '2026-09-30', '18:00', '23:00', '2026-09-29T21:00:00', 'Midterm exam']);
  }
  await db.refused(db.fn('preview_candidates', 999999, 2), 'SHIFT_NOT_FOUND');
});

test('TC-015 S7 / S5: Doyun is not asked for Minho\'s Sat 12:00-18:00 (his Sat 10:00-16:00 overlaps); a touching shift does not exclude (BR-01)', async () => {
  assert.deepEqual(names(await db.fn('preview_candidates', await db.shift(3, '2026-10-03'), 3)), ['Lee Seoyeon', 'Jung Hana']);
  // Hana's Sun 10:00-16:00: Doyun's Sun 16:00-22:00 only touches it.
  assert.deepEqual(names(await db.fn('preview_candidates', await db.shift(4, '2026-10-04'), 4)), ['Lee Seoyeon', 'Choi Minho', 'Kang Doyun']);
});

test('TC-016 a co-worker whose overnight shift of the previous evening runs into the shift is not eligible (BR-01 on the time line)', async () => {
  const early = await db.fn('add_shift', '2026-10-01', '01:00', '05:00', 2);
  assert.deepEqual(names(await db.fn('preview_candidates', early, 2)), ['Choi Minho', 'Jung Hana', 'Kang Doyun']);
  await db.fn('add_shift', '2026-09-30', '22:00', '02:00', 5);
  assert.deepEqual(names(await db.fn('preview_candidates', early, 2)), ['Choi Minho', 'Jung Hana']);
  const created = await db.fn('create_sub_request', early, 2, null, '2026-09-30 12:00');
  assert.deepEqual(names(created.candidates), ['Choi Minho', 'Jung Hana']);
});

test('TC-017 only active workers within their contract period are asked: Doyun after 2026-11-15, an inactive Hana (BR-01, FR-04)', async () => {
  await db.fn('generate_week', '2026-11-16');
  const monday = await db.shift(2, '2026-11-16');
  assert.deepEqual(names(await db.fn('preview_candidates', monday, 2)), ['Choi Minho', 'Jung Hana']);
  await db.fn('save_worker', 4, 'Jung Hana', '010-6631-4427', 10320, '2026-09-01', null, '2026-11-30', false, false);
  assert.deepEqual(names(await db.fn('preview_candidates', monday, 2)), ['Choi Minho']);
  // The owner is never a candidate and the requester is not asked.
  assert.ok(!(await db.fn('preview_candidates', await db.shift(3, '2026-10-01'), 3)).some((c) => c.id === 1 || c.id === 3));
});

test('TC-018 generate_week creates each fixed slot once and only within each contract; Doyun has no shift after 2026-11-15 (FR-04)', async () => {
  assert.equal(await db.fn('generate_week', '2026-09-28'), 0);
  assert.equal(await db.fn('generate_week', '2026-10-05'), 9);
  assert.equal(await db.fn('generate_week', '2026-10-07'), 0, 'any day of a week means its Monday');
  assert.equal(await db.fn('generate_week', '2026-11-09'), 9, 'Sat 11-14 and Sun 11-15 are within Doyun\'s contract');
  assert.equal(await db.fn('generate_week', '2026-11-16'), 7);
  assert.equal(await db.value("select count(*)::int from public.shift where worker_id = 5 and work_date > '2026-11-15'"), 0);
  // Minho's contract ends on Thursday 2026-12-31: his Saturday 2027-01-02 is not generated.
  assert.equal(await db.fn('generate_week', '2026-12-28'), 6);
  assert.deepEqual((await db.rows("select work_date::text as d from public.shift where worker_id = 3 and work_date >= '2026-12-28' order by work_date")).map((r) => r.d),
    ['2026-12-29', '2026-12-31']);
  await db.refused(db.fn('generate_week', null), 'TIME_INVALID');
});

test('TC-019 generate_week skips a slot whose shift was moved or that would overlap a shift the worker already has (FR-04)', async () => {
  const monday = await db.shift(2, '2026-09-28');
  await db.fn('update_shift', monday, '2026-09-29', '10:00', '15:00', 2);
  assert.equal(await db.fn('generate_week', '2026-09-28'), 0);
  assert.equal(await db.value("select count(*)::int from public.shift where worker_id = 2 and work_date = '2026-09-28'"), 0);
  // Fixed slots replaced by equal ones keep their rows; a new slot that overlaps an existing shift is skipped.
  await db.fn('save_fixed_schedule', 2, JSON.stringify([slot(1, '18:00', '23:00'), slot(3, '18:00', '23:00'), slot(2, '14:00', '16:00')]));
  assert.equal(await db.fn('generate_week', '2026-09-28'), 0, 'Tue 14:00-16:00 overlaps the moved shift');
  assert.equal(await db.fn('generate_week', '2026-10-05'), 10);
});

test('TC-01A add, move and delete a single shift; SHIFT_LOCKED, SHIFT_HAS_HISTORY, OUTSIDE_CONTRACT, WORKER_INVALID, TIME_INVALID (FR-05)', async () => {
  const id = await db.fn('add_shift', '2026-10-01', '12:00', '16:00', 2);
  await db.fn('update_shift', id, '2026-10-01', '13:00', '17:00', 2);
  await db.refused(db.fn('update_shift', id, '2026-10-01', '17:00', '19:00', 3), 'OVERLAP');
  await db.fn('delete_shift', id);
  assert.equal(await db.value('select count(*)::int from public.shift where id = $1', [id]), 0);
  const wed = await db.shift(2, '2026-09-30');
  await db.refused(db.fn('update_shift', wed, '2026-09-30', '19:00', '23:00', 2), 'SHIFT_LOCKED');
  await db.refused(db.fn('delete_shift', wed), 'SHIFT_HAS_HISTORY');
  await db.refused(db.fn('delete_shift', await db.shift(3, '2026-09-22')), 'SHIFT_HAS_HISTORY');
  const outside = await db.refused(db.fn('add_shift', '2026-11-20', '10:00', '14:00', 5), 'OUTSIDE_CONTRACT');
  assert.deepEqual([outside.detail.name, outside.detail.contract_end], ['Kang Doyun', '2026-11-15']);
  await db.refused(db.fn('add_shift', '2026-08-31', '10:00', '14:00', 4), 'OUTSIDE_CONTRACT');
  await db.refused(db.fn('add_shift', '2026-10-01', '10:00', '14:00', 1), 'WORKER_INVALID');
  await db.refused(db.fn('add_shift', '2026-10-01', '10:00', '14:00', 999), 'WORKER_INVALID');
  for (const [start, end] of [['10:00', '10:20'], ['10:00', '10:00'], ['06:00', '23:00'], ['10:00:30', '12:00'], [null, '12:00']]) {
    await db.refused(db.fn('add_shift', '2026-10-01', start, end, 2), 'TIME_INVALID');
  }
  await db.refused(db.fn('update_shift', 999999, '2026-10-01', '10:00', '12:00', 2), 'SHIFT_NOT_FOUND');
  await db.refused(db.fn('delete_shift', 999999), 'SHIFT_NOT_FOUND');
  // Once the request is cancelled the shift can be changed.
  await db.fn('cancel_sub_request', 1, 2);
  await db.fn('update_shift', wed, '2026-09-30', '19:00', '23:00', 2);
  assert.equal(await db.value('select start_time::text from public.shift where id = $1', [wed]), '19:00:00');
});

test('TC-01B FR-25: the owner marks a started SCHEDULED shift absent with or without a record; not before the start, not twice', async () => {
  const tue = await db.shift(3, '2026-09-29');
  await db.refused(db.fn('mark_absent', tue), 'SHIFT_NOT_STARTED');
  await db.clock('2026-09-29 18:00');
  await db.fn('mark_absent', tue);
  assert.deepEqual(await db.one('select status, (select count(*)::int from public.attendance a where a.shift_id = s.id) as records from public.shift s where id = $1', [tue]),
    { status: 'ABSENT', records: 0 });
  await db.refused(db.fn('mark_absent', tue), 'ATTENDANCE_CLOSED');
  await db.refused(db.fn('confirm_attendance', tue), 'ATTENDANCE_CLOSED');
  await db.refused(db.fn('mark_absent', await db.shift(3, '2026-09-22')), 'ATTENDANCE_CLOSED');
  await db.refused(db.fn('mark_absent', 999999), 'SHIFT_NOT_FOUND');
  // With a record: the worker's record is closed together with the shift.
  const mon = await db.shift(2, '2026-09-28');
  await db.fn('record_attendance', mon, 2, '18:00', '23:00');
  await db.fn('mark_absent', mon);
  assert.deepEqual(await db.one('select s.status, a.confirmed from public.shift s join public.attendance a on a.shift_id = s.id where s.id = $1', [mon]),
    { status: 'ABSENT', confirmed: true });
});

test('TC-01C week board and shift detail: names, open-request and handover markers, allowed actions (UC-03)', async () => {
  let board = await db.fn('week_board', '2026-09-30');
  assert.deepEqual([board.week_start, board.week_end, board.days.length, board.shifts.length], ['2026-09-28', '2026-10-04', 7, 9]);
  let wed = board.shifts.find((s) => s.work_date === '2026-09-30');
  assert.deepEqual([wed.worker_name, wed.open_request.id, wed.open_request.status, wed.handover, wed.attendance], ['Lee Seoyeon', 1, 'REQUESTED', false, null]);
  let detail = await db.fn('shift_detail', wed.id);
  assert.deepEqual(detail.actions, { can_edit: false, can_delete: false, can_mark_absent: false, can_confirm_attendance: false });
  assert.deepEqual(detail.requests.map((r) => [r.request_id, r.status, r.targets.length]), [[1, 'REQUESTED', 3]]);
  const free = await db.fn('shift_detail', await db.shift(3, '2026-10-03'));
  assert.deepEqual(free.actions, { can_edit: true, can_delete: true, can_mark_absent: false, can_confirm_attendance: false });
  const worked = await db.fn('shift_detail', await db.shift(3, '2026-09-22'));
  assert.deepEqual([worked.status, worked.attendance.confirmed, worked.attendance.minutes, worked.actions.can_delete], ['WORKED', true, 300, false]);
  await db.fn('accept_sub_request', 1, 3);
  await db.fn('decide_sub_request', 1, 'APPROVE');
  board = await db.fn('week_board', '2026-09-28');
  wed = board.shifts.find((s) => s.work_date === '2026-09-30');
  assert.deepEqual([wed.worker_name, wed.original_worker_name, wed.handover, wed.open_request], ['Choi Minho', 'Lee Seoyeon', true, null]);
  detail = await db.fn('shift_detail', wed.id);
  assert.deepEqual([detail.requests[0].status, detail.requests[0].decided_at, detail.actions.can_edit], ['APPROVED', '2026-09-28T09:00:00', true]);
  await db.refused(db.fn('week_board', null), 'TIME_INVALID');
});
