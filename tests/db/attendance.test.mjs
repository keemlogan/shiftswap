// TC-18x: attendance recording after the shift's end and plausibility on the shift's time line (BR-17, FR-13).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.mjs';

const db = await setup({ beforeEach, afterEach });

const record = (shiftId, workerId, clockIn, clockOut) => db.fn('record_attendance', shiftId, workerId, clockIn, clockOut);

test('TC-181 attendance can be recorded only after the scheduled end (SHIFT_NOT_ENDED), by the shift\'s worker (BR-17, FR-13)', async () => {
  const mon = await db.shift(2, '2026-09-28');
  const early = await db.refused(record(mon, 2, '18:00', '23:00'), 'SHIFT_NOT_ENDED');
  assert.equal(early.detail.end_at, '2026-09-28T23:00:00');
  await db.clock('2026-09-28 22:59');
  await db.refused(record(mon, 2, '18:00', '23:00'), 'SHIFT_NOT_ENDED');
  await db.clock('2026-09-28 23:00');
  await db.refused(record(mon, 3, '18:00', '23:00'), 'NOT_YOUR_SHIFT');
  await db.refused(record(999999, 2, '18:00', '23:00'), 'SHIFT_NOT_FOUND');
  assert.deepEqual(await record(mon, 2, '18:05', '23:00'),
    { shift_id: mon, clock_in: '18:05', clock_out: '23:00', start_at: '2026-09-28T18:05:00', end_at: '2026-09-28T23:00:00', minutes: 295, hours: 4.92 });
  assert.deepEqual(await db.one('select clock_in::text, clock_out::text, confirmed from public.attendance where shift_id = $1', [mon]),
    { clock_in: '18:05:00', clock_out: '23:00:00', confirmed: false });
});

test('TC-182 23:00 → 18:00 on an 18:00-23:00 shift lies on the next day and is implausible (BR-17)', async () => {
  await db.clock('2026-09-29 09:00');
  const mon = await db.shift(2, '2026-09-28');
  const { detail } = await db.refused(record(mon, 2, '23:00', '18:00'), 'ATTENDANCE_IMPLAUSIBLE');
  assert.deepEqual([detail.recorded_start, detail.recorded_end, detail.minutes], ['2026-09-28T23:00:00', '2026-09-29T18:00:00', 1140]);
  // Shorter than 30 minutes, or ending more than 4 h after the scheduled end, or starting more than 2 h early.
  await db.refused(record(mon, 2, '18:00', '18:20'), 'ATTENDANCE_IMPLAUSIBLE');
  await db.refused(record(mon, 2, '18:00', '03:30'), 'ATTENDANCE_IMPLAUSIBLE');
  await db.refused(record(mon, 2, '15:30', '23:00'), 'ATTENDANCE_IMPLAUSIBLE');
  await db.refused(record(mon, 2, '18:00', null), 'TIME_INVALID');
  // The limits themselves are plausible: from 16:00 (start − 2 h) to 03:00 the next day (end + 4 h), 11 h.
  assert.deepEqual([(await record(mon, 2, '16:00', '03:00')).minutes, (await record(mon, 2, '18:00', '18:30')).minutes], [660, 30]);
  assert.equal(await db.value('select count(*)::int from public.attendance where shift_id = $1', [mon]), 1, 'recording again replaces the unconfirmed record');
});

test('TC-183 an overnight shift: clock-out after midnight is on the next day and accepted; an early clock-in stays on the work date (BR-17)', async () => {
  const fri = await db.fn('add_shift', '2026-10-02', '22:00', '02:00', 5);
  await db.clock('2026-10-03 01:59');
  await db.refused(record(fri, 5, '22:00', '02:00'), 'SHIFT_NOT_ENDED');
  await db.clock('2026-10-03 02:00');
  let r = await record(fri, 5, '22:05', '02:10');
  assert.deepEqual([r.start_at, r.end_at, r.minutes], ['2026-10-02T22:05:00', '2026-10-03T02:10:00', 245]);
  r = await record(fri, 5, '21:30', '02:00');
  assert.deepEqual([r.start_at, r.end_at, r.minutes], ['2026-10-02T21:30:00', '2026-10-03T02:00:00', 270]);
  // A clock-in after midnight belongs to the next day.
  r = await record(fri, 5, '00:30', '02:00');
  assert.deepEqual([r.start_at, r.end_at, r.minutes], ['2026-10-03T00:30:00', '2026-10-03T02:00:00', 90]);
  await db.refused(record(fri, 5, '19:30', '02:00'), 'ATTENDANCE_IMPLAUSIBLE');
  await db.refused(record(fri, 5, '22:00', '06:30'), 'ATTENDANCE_IMPLAUSIBLE');
  await record(fri, 5, '22:00', '02:00');
  await db.fn('confirm_attendance', fri);
  assert.equal((await db.fn('shift_detail', fri)).attendance.minutes, 240);
});

test('TC-184 the owner confirms a record (WORKED) or the shift stays open; a WORKED or ABSENT shift cannot change again (FR-13, spec §7)', async () => {
  await db.clock('2026-09-29 09:00');
  const mon = await db.shift(2, '2026-09-28');
  await db.refused(db.fn('confirm_attendance', mon), 'NO_ATTENDANCE');
  await record(mon, 2, '18:05', '23:00');
  await db.fn('confirm_attendance', mon);
  assert.deepEqual(await db.one('select s.status, a.confirmed from public.shift s join public.attendance a on a.shift_id = s.id where s.id = $1', [mon]),
    { status: 'WORKED', confirmed: true });
  await db.refused(db.fn('confirm_attendance', mon), 'ATTENDANCE_CLOSED');
  await db.refused(db.fn('mark_absent', mon), 'ATTENDANCE_CLOSED');
  await db.refused(record(mon, 2, '18:00', '23:00'), 'ATTENDANCE_CLOSED');
  await db.refused(db.fn('confirm_attendance', 999999), 'SHIFT_NOT_FOUND');
  // The confirmed record gives the week's actual hours (4 h 55 min).
  const seoyeon = (await db.fn('week_summary', '2026-09-28')).rows.find((r) => r.worker_id === 2);
  assert.deepEqual([seoyeon.scheduled_hours, seoyeon.actual_hours], [10, 4.92]);
  assert.equal(await db.value("select actual_hours::text from public.weekly_summary where worker_id = 2 and week_start = '2026-09-28'"), '4.92');
});

test('TC-185 the seed history and the week of 09-21 are recorded at the scheduled times and confirmed (spec §10, BR-17)', async () => {
  assert.deepEqual(await db.one(
    `select count(*)::int as shifts, count(a.id)::int as records, count(*) filter (where a.confirmed and s.status = 'WORKED')::int as worked,
            count(*) filter (where a.clock_in = s.start_time and a.clock_out = s.end_time)::int as as_scheduled
     from public.shift s left join public.attendance a on a.shift_id = s.id where s.work_date <= '2026-09-27'`),
  { shifts: 133, records: 133, worked: 133, as_scheduled: 133 });
  assert.equal(await db.value("select count(*)::int from public.attendance a join public.shift s on s.id = a.shift_id where s.work_date >= '2026-09-28'"), 0);
});
