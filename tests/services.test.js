import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import { createDatabase, openDatabase, all, get, DB_KEY } from '../app/core/db.js';
import { setNow, resetClock, now } from '../app/core/clock.js';
import * as svc from '../app/core/services.js';

const SQL = await initSqlJs();

beforeEach(() => {
  resetClock();
  createDatabase(SQL, { seed: true });
});

const wedShiftId = () => get("SELECT id FROM Shift WHERE COALESCE(originalWorkerId, workerId) = 2 AND workDate = '2026-09-30'").id;

// ---- Seed state (spec §10) ----

test('TC-001 seed reproduces spec §10', () => {
  assert.equal(now(), '2026-09-28T09:00');
  assert.equal(svc.getWorkplace().name, 'Dalbit Café');
  assert.equal(svc.getWorkplace().regularEmployees, 4);
  assert.equal(svc.getWorkplace().subAttendancePolicy, 'EXCUSED');
  assert.deepEqual(all('SELECT year, hourly FROM MinimumWage ORDER BY year'), [{ year: 2025, hourly: 10030 }, { year: 2026, hourly: 10320 }]);
  assert.deepEqual(all('SELECT id, name, role, hourlyWage FROM Worker ORDER BY id').map((w) => [w.id, w.name, w.role, w.hourlyWage]), [
    [1, 'Park Jiyoung', 'OWNER', null], [2, 'Lee Seoyeon', 'WORKER', 10500], [3, 'Choi Minho', 'WORKER', 10320],
    [4, 'Jung Hana', 'WORKER', 10320], [5, 'Kang Doyun', 'WORKER', 10000],
  ]);
  const shifts = all('SELECT * FROM Shift');
  assert.equal(shifts.length, 18);
  assert.ok(shifts.filter((s) => s.workDate < '2026-09-28').every((s) => s.status === 'WORKED'));
  assert.equal(get('SELECT count(*) AS n FROM Attendance WHERE confirmed = 1').n, 9);
  const r = get('SELECT * FROM SubRequest');
  assert.equal(r.status, 'REQUESTED');
  assert.equal(r.deadline, '2026-09-29T21:00');
  assert.equal(r.reason, 'Midterm exam');
  assert.equal(r.shiftId, wedShiftId());
  assert.deepEqual(all('SELECT workerId, response FROM SubRequestTarget ORDER BY workerId'), [{ workerId: 3, response: 'PENDING' }, { workerId: 5, response: 'PENDING' }]);
});

test('TC-016 seed request candidates equal the BR-01 computation', () => {
  svc.cancelRequest(1, 2);
  const { candidates } = svc.createSubRequest({ shiftId: wedShiftId(), requesterId: 2, deadline: '2026-09-29T21:00' });
  assert.deepEqual(candidates.map((c) => c.name), ['Choi Minho', 'Kang Doyun']);
});

// ---- UC-01..03 ----

test('TC-017 fixed schedules of one worker must not overlap (FR-02)', () => {
  assert.throws(() => svc.saveFixedSchedule(3, [
    { weekday: 2, startTime: '18:00', endTime: '23:00' },
    { weekday: 2, startTime: '22:00', endTime: '23:30' },
  ]), { code: 'FIXED_OVERLAP' });
});

test('TC-018 generating the same week twice creates no duplicates (FR-04)', () => {
  assert.equal(svc.generateWeek('2026-09-28').created, 0);
  assert.equal(svc.generateWeek('2026-10-05').created, 9);
  assert.equal(svc.generateWeek('2026-10-07').created, 0);
  assert.equal(get("SELECT count(*) AS n FROM Shift WHERE workDate >= '2026-10-05'").n, 9);
});

test('TC-019 owner edits a shift; overlap with the same worker is refused (FR-05)', () => {
  const id = svc.editShift(null, { workDate: '2026-10-01', startTime: '12:00', endTime: '16:00', workerId: 2 });
  assert.throws(() => svc.editShift(id, { startTime: '17:00', endTime: '19:00', workerId: 3 }), { code: 'SHIFT_OVERLAP' });
  svc.editShift(id, { startTime: '13:00' });
  assert.equal(get('SELECT startTime FROM Shift WHERE id = ?', [id]).startTime, '13:00');
  svc.editShift(id, { delete: true });
  assert.equal(get('SELECT id FROM Shift WHERE id = ?', [id]), null);
});

test('TC-01A deleting a shift with a request or attendance is refused (FR-05)', () => {
  assert.throws(() => svc.editShift(wedShiftId(), { delete: true }), { code: 'SHIFT_IN_USE' });
  const worked = get("SELECT id FROM Shift WHERE workerId = 3 AND workDate = '2026-09-22'").id;
  assert.throws(() => svc.editShift(worked, { delete: true }), { code: 'SHIFT_IN_USE' });
});

test('TC-01B deleting a fixed-schedule row keeps the shifts it generated (FR-02)', () => {
  const kept = svc.getFixedSchedules(3).filter((f) => f.weekday !== 6);
  const sat = svc.getFixedSchedules(3).find((f) => f.weekday === 6);
  svc.saveFixedSchedule(3, kept);
  assert.equal(get('SELECT count(*) AS n FROM FixedSchedule WHERE id = ?', [sat.id]).n, 0);
  const shifts = all("SELECT * FROM Shift WHERE workerId = 3 AND workDate IN ('2026-09-26', '2026-10-03')");
  assert.equal(shifts.length, 2);
  assert.ok(shifts.every((s) => s.fixedScheduleId === null));
});

test('TC-01C owner registers and edits a worker with all FR-01 fields', () => {
  const id = svc.registerWorker({
    name: '  Yoon Jisu ', phone: '010-1234-5678', hourlyWage: 10500, contractStart: '2026-10-01',
    contractEnd: '', probationEnd: '2026-12-31', simpleLabor: false, active: true,
  });
  const w = svc.getWorker(id);
  assert.deepEqual(
    [w.role, w.name, w.phone, w.hourlyWage, w.contractStart, w.contractEnd, w.probationEnd, w.simpleLabor, w.active, w.workplaceId],
    ['WORKER', 'Yoon Jisu', '010-1234-5678', 10500, '2026-10-01', null, '2026-12-31', 0, 1, 1]);
  svc.registerWorker({ ...w, id, hourlyWage: 10800, simpleLabor: true, active: false });
  const edited = svc.getWorker(id);
  assert.deepEqual([edited.hourlyWage, edited.simpleLabor, edited.active], [10800, 1, 0]);
  // An inactive worker's fixed shifts are not generated (FR-04): only the 9 seed shifts are created.
  svc.saveFixedSchedule(id, [{ weekday: 1, startTime: '10:00', endTime: '14:00' }]);
  assert.equal(svc.generateWeek('2026-10-05').created, 9);
});

test('TC-01D worker registration refuses invalid input with a message that says how to fix it (FR-01)', () => {
  const ok = { name: 'Yoon Jisu', hourlyWage: 10500, contractStart: '2026-10-01' };
  const cases = [
    [{ ...ok, name: '   ' }, 'NAME_REQUIRED'],
    [{ ...ok, hourlyWage: 0 }, 'WAGE_INVALID'],
    [{ ...ok, hourlyWage: 10320.5 }, 'WAGE_INVALID'],
    [{ ...ok, hourlyWage: NaN }, 'WAGE_INVALID'],
    [{ ...ok, contractStart: '' }, 'CONTRACT_START_REQUIRED'],
    [{ ...ok, contractEnd: '2026-09-30' }, 'CONTRACT_END_BEFORE_START'],
    [{ ...ok, probationEnd: '2026-09-01' }, 'PROBATION_BEFORE_START'],
  ];
  const before = get("SELECT count(*) AS n FROM Worker").n;
  for (const [data, code] of cases) {
    assert.throws(() => svc.registerWorker(data), (err) => err.code === code && err.message.length > 10, code);
  }
  assert.equal(get("SELECT count(*) AS n FROM Worker").n, before);
});

// ---- TC-02x request creation ----

test('TC-024 creating a request notifies each candidate (FR-07)', () => {
  const shiftId = get("SELECT id FROM Shift WHERE workerId = 5 AND workDate = '2026-10-03'").id;
  const { id, candidates } = svc.createSubRequest({ shiftId, requesterId: 5, reason: 'Family event', deadline: '2026-10-02T12:00' });
  assert.deepEqual(candidates.map((c) => c.name), ['Lee Seoyeon', 'Jung Hana']);
  assert.equal(get("SELECT count(*) AS n FROM Notification WHERE subRequestId = ? AND kind = 'REQUEST_RECEIVED'", [id]).n, 2);
});

test('TC-025 no eligible worker still creates the request and notifies the owner (FR-08)', () => {
  const shiftId = get("SELECT id FROM Shift WHERE workerId = 4 AND workDate = '2026-10-04'").id;
  const { id, candidates } = svc.createSubRequest({ shiftId, requesterId: 4, deadline: '2026-10-03T12:00' });
  assert.equal(candidates.length, 0);
  assert.equal(get('SELECT status FROM SubRequest WHERE id = ?', [id]).status, 'REQUESTED');
  assert.equal(get("SELECT workerId FROM Notification WHERE subRequestId = ? AND kind = 'NO_CANDIDATE'", [id]).workerId, 1);
});

test('TC-026 invalid requests are refused (BR-03)', () => {
  assert.throws(() => svc.createSubRequest({ shiftId: wedShiftId(), requesterId: 2, deadline: '2026-09-29T20:00' }), { code: 'OPEN_REQUEST_EXISTS' });
  const past = get("SELECT id FROM Shift WHERE workerId = 3 AND workDate = '2026-09-22'").id;
  assert.throws(() => svc.createSubRequest({ shiftId: past, requesterId: 3, deadline: '2026-09-29T20:00' }), { code: 'NOT_SCHEDULED' });
  const tue = get("SELECT id FROM Shift WHERE workerId = 3 AND workDate = '2026-09-29'").id;
  assert.throws(() => svc.createSubRequest({ shiftId: tue, requesterId: 2, deadline: '2026-09-29T12:00' }), { code: 'NOT_OWN_SHIFT' });
  assert.throws(() => svc.createSubRequest({ shiftId: tue, requesterId: 3, deadline: '2026-09-29T19:00' }), { code: 'DEADLINE_AFTER_START' });
});

// ---- TC-05x first acceptance wins (BR-02, NFR-04) ----

test('TC-051 two acceptances of the same request: only the first succeeds', () => {
  assert.equal(svc.respondToRequest(1, 3, 'ACCEPTED').status, 'ACCEPTED');
  assert.throws(() => svc.respondToRequest(1, 5, 'ACCEPTED'), (err) => err.code === 'ALREADY_TAKEN' && err.params.name === 'Choi Minho');
  const r = get('SELECT * FROM SubRequest WHERE id = 1');
  assert.equal(r.acceptorId, 3);
  assert.deepEqual(all('SELECT workerId, response FROM SubRequestTarget ORDER BY workerId'), [{ workerId: 3, response: 'ACCEPTED' }, { workerId: 5, response: 'CLOSED' }]);
});

test('TC-052 acceptance notifies requester and owner, closed target is told (FR-10)', () => {
  svc.respondToRequest(1, 3, 'ACCEPTED');
  const kinds = all('SELECT workerId, kind FROM Notification WHERE subRequestId = 1 AND kind != ? ORDER BY workerId', ['REQUEST_RECEIVED']);
  assert.deepEqual(kinds, [{ workerId: 1, kind: 'REQUEST_ACCEPTED' }, { workerId: 2, kind: 'REQUEST_ACCEPTED' }, { workerId: 5, kind: 'TARGET_CLOSED' }]);
});

test('TC-053 a decline keeps the request open for other candidates', () => {
  svc.respondToRequest(1, 5, 'DECLINED');
  assert.equal(get('SELECT status FROM SubRequest WHERE id = 1').status, 'REQUESTED');
  assert.equal(svc.respondToRequest(1, 3, 'ACCEPTED').status, 'ACCEPTED');
});

// ---- TC-06x approval effect (BR-04) ----

test('TC-061 approval reassigns the shift and keeps the original worker; weekly summaries recomputed', () => {
  svc.respondToRequest(1, 3, 'ACCEPTED');
  svc.decideRequest(1, 'APPROVED');
  const s = get('SELECT * FROM Shift WHERE id = ?', [wedShiftId()]);
  assert.equal(s.workerId, 3);
  assert.equal(s.originalWorkerId, 2);
  assert.equal(s.status, 'SCHEDULED');
  assert.equal(get('SELECT status FROM SubRequest WHERE id = 1').status, 'APPROVED');
  const minho = get("SELECT * FROM WeeklySummary WHERE workerId = 3 AND weekStart = '2026-09-28'");
  assert.equal(minho.scheduledHours, 21);
  assert.equal(minho.holidayHours, 3.2);
  assert.equal(get("SELECT scheduledHours FROM WeeklySummary WHERE workerId = 2 AND weekStart = '2026-09-28'").scheduledHours, 5);
  assert.equal(get("SELECT count(*) AS n FROM Notification WHERE subRequestId = 1 AND kind = 'REQUEST_APPROVED'").n, 2);
});

test('TC-062 rejection leaves the shift unchanged; only ACCEPTED can be decided', () => {
  assert.throws(() => svc.decideRequest(1, 'APPROVED'), { code: 'NOT_ACCEPTED' });
  svc.respondToRequest(1, 3, 'ACCEPTED');
  svc.decideRequest(1, 'REJECTED');
  const s = get('SELECT * FROM Shift WHERE id = ?', [wedShiftId()]);
  assert.equal(s.workerId, 2);
  assert.equal(s.originalWorkerId, null);
  assert.equal(get("SELECT count(*) AS n FROM Notification WHERE subRequestId = 1 AND kind = 'REQUEST_REJECTED'").n, 2);
});

test('TC-063 done-criterion 4 walkthrough: accept, already taken, approval panel, approve, handover on board', () => {
  // Choi Minho accepts from the inbox.
  const minhoInbox = svc.listNotifications(3);
  const item = minhoInbox.items.find((n) => n.kind === 'REQUEST_RECEIVED');
  assert.equal(item.state, 'OPEN');
  svc.respondToRequest(item.subRequestId, 3, 'ACCEPTED');
  // Kang Doyun sees "Already taken by Choi Minho".
  const doyun = svc.listNotifications(5).items.find((n) => n.kind === 'REQUEST_RECEIVED');
  assert.equal(doyun.state, 'TAKEN');
  assert.equal(doyun.acceptorName, 'Choi Minho');
  // Owner opens the approval panel.
  assert.deepEqual(svc.listOwnerRequests().filter((r) => r.status === 'ACCEPTED').map((r) => r.id), [1]);
  const preview = svc.getApprovalPreview(1);
  const minho = preview.rows.find((r) => r.role === 'acceptor');
  assert.equal(minho.name, 'Choi Minho');
  assert.equal(minho.before.scheduledHours, 16);
  assert.equal(minho.after.scheduledHours, 21);
  assert.equal(minho.before.contractHours, 16);
  assert.equal(minho.after.contractHours, 16);
  assert.equal(minho.before.holidayEligible, true);
  assert.equal(minho.after.holidayEligible, true);
  assert.equal(minho.eligibilityChanged, false);
  assert.equal(minho.after.holidayHours, 3.2);
  const seoyeon = preview.rows.find((r) => r.role === 'requester');
  assert.equal(seoyeon.before.scheduledHours, 10);
  assert.equal(seoyeon.after.scheduledHours, 5);
  assert.equal(seoyeon.before.holidayEligible, false);
  assert.equal(seoyeon.eligibilityChanged, false);
  // Approve; the weekly board shows the handover.
  svc.decideRequest(1, 'APPROVED');
  const board = svc.getWeekShifts('2026-09-28').find((s) => s.workDate === '2026-09-30' && s.startTime === '18:00' && s.originalWorkerId);
  assert.equal(board.workerName, 'Choi Minho');
  assert.equal(board.originalWorkerName, 'Lee Seoyeon');
  assert.equal(board.openRequestId, null);
});

// ---- TC-08x weekly summary through the service ----

test('TC-088 worked example: Minho 3.2 h holiday allowance, 33,024 KRW in September payroll', () => {
  const rows = svc.recomputeWeek('2026-09-21');
  const minho = rows.find((r) => r.workerId === 3);
  assert.equal(minho.holidayHours, 3.2);
  const seoyeon = rows.find((r) => r.workerId === 2);
  assert.equal(seoyeon.holidayEligible, false);
  assert.deepEqual(seoyeon.reasons, [{ code: 'CONTRACT_BELOW_15' }]);
  const payroll = svc.generatePayroll('2026-09').find((p) => p.workerId === 3);
  assert.equal(payroll.holidayPay, 33024);
});

test('TC-089 marking a shift absent removes holiday eligibility for that week', () => {
  const tue = get("SELECT id FROM Shift WHERE workerId = 3 AND workDate = '2026-09-22'").id;
  svc.markAbsent(tue);
  const minho = svc.recomputeWeek('2026-09-21').find((r) => r.workerId === 3);
  assert.equal(minho.holidayEligible, false);
  assert.deepEqual(minho.reasons, [{ code: 'ABSENT', date: '2026-09-22' }]);
});

test('TC-08A both substitution-attendance policies through approval', () => {
  const tue = get("SELECT id FROM Shift WHERE workerId = 3 AND workDate = '2026-09-29'").id;
  svc.saveAvailability(2, [{ weekday: 2, startTime: '17:00', endTime: '23:00' }]);
  const { id } = svc.createSubRequest({ shiftId: tue, requesterId: 3, deadline: '2026-09-29T12:00' });
  svc.respondToRequest(id, 2, 'ACCEPTED');
  svc.decideRequest(id, 'APPROVED');
  assert.equal(svc.recomputeWeek('2026-09-28').find((r) => r.workerId === 3).holidayEligible, true);
  svc.updateSettings({ name: 'Dalbit Café', regularEmployees: 4, subAttendancePolicy: 'ABSENT', minimumWages: [{ year: 2026, hourly: 10320 }] });
  const strict = svc.recomputeWeek('2026-09-28').find((r) => r.workerId === 3);
  assert.equal(strict.holidayEligible, false);
  assert.deepEqual(strict.reasons, [{ code: 'GAVE_AWAY', date: '2026-09-29' }]);
});

test('TC-08B demo walkthrough S7: ABSENT policy, Minho gives away Sat 10-03 and loses holiday allowance', () => {
  svc.updateSettings({ name: 'Dalbit Café', regularEmployees: 4, subAttendancePolicy: 'ABSENT', minimumWages: [{ year: 2025, hourly: 10030 }, { year: 2026, hourly: 10320 }] });
  const sat = get("SELECT id FROM Shift WHERE workerId = 3 AND workDate = '2026-10-03'").id;
  const { id, candidates } = svc.createSubRequest({ shiftId: sat, requesterId: 3, deadline: '2026-10-02T12:00' });
  assert.deepEqual(candidates.map((c) => c.name), ['Lee Seoyeon', 'Jung Hana']);
  // Kang Doyun is excluded: his Sat 10:00-16:00 shift overlaps 12:00-18:00.
  assert.equal(get('SELECT count(*) AS n FROM SubRequestTarget WHERE subRequestId = ? AND workerId = 5', [id]).n, 0);
  assert.equal(svc.recomputeWeek('2026-09-28').find((r) => r.workerId === 3).holidayEligible, true);
  svc.respondToRequest(id, 2, 'ACCEPTED');
  const minhoPreview = svc.getApprovalPreview(id).rows.find((r) => r.workerId === 3);
  assert.equal(minhoPreview.before.holidayEligible, true);
  assert.equal(minhoPreview.after.holidayEligible, false);
  assert.equal(minhoPreview.eligibilityChanged, true);
  svc.decideRequest(id, 'APPROVED');
  const minho = get("SELECT * FROM WeeklySummary WHERE workerId = 3 AND weekStart = '2026-09-28'");
  assert.equal(minho.perfectAttendance, 0);
  assert.equal(minho.holidayEligible, 0);
  assert.equal(minho.holidayHours, 0);
});

// ---- TC-09x premium through payroll ----

test('TC-095 payroll premium is zero at 4 employees and non-zero at 5', () => {
  assert.ok(svc.generatePayroll('2026-09').every((p) => p.premiumPay === 0));
  svc.updateSettings({ name: 'Dalbit Café', regularEmployees: 5, subAttendancePolicy: 'EXCUSED', minimumWages: [{ year: 2026, hourly: 10320 }] });
  const seoyeon = svc.generatePayroll('2026-09').find((p) => p.workerId === 2);
  // Seoyeon's September shifts are 18:00-23:00: Mon 21, Wed 23 (worked), Mon 28, Wed 30 (scheduled) → 4 night hours.
  assert.equal(seoyeon.premiumPay, Math.floor(4 * 10500 * 0.5));
});

// ---- TC-10x minimum wage in payroll ----

test('TC-104 payroll warns for Kang Doyun and blocks confirmation until acknowledged', () => {
  const rows = svc.generatePayroll('2026-09');
  assert.equal(rows.find((p) => p.workerId === 5).minWageWarning, 1);
  assert.equal(rows.find((p) => p.workerId === 4).minWageWarning, 0);
  assert.equal(rows.find((p) => p.workerId === 4).probation, true);
  assert.throws(() => svc.confirmPayroll('2026-09'), { code: 'MIN_WAGE_UNACKNOWLEDGED' });
  assert.throws(() => svc.acknowledgeMinWage('2026-09', 4), { code: 'NO_WARNING' });
  svc.acknowledgeMinWage('2026-09', 5);
  assert.equal(get("SELECT minWageAck FROM Payroll WHERE workerId = 5 AND yearMonth = '2026-09'").minWageAck, 1);
  assert.equal(svc.confirmPayroll('2026-09').confirmed, rows.length);
});

test('TC-105 minimum-wage acknowledgement is persisted and a regenerated draft needs a new one', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  openDatabase(SQL, storage);
  svc.generatePayroll('2026-09');
  svc.acknowledgeMinWage('2026-09', 5);
  openDatabase(SQL, storage); // reload from the saved copy
  assert.equal(get("SELECT minWageAck FROM Payroll WHERE workerId = 5 AND yearMonth = '2026-09'").minWageAck, 1);
  svc.generatePayroll('2026-09');
  assert.equal(get("SELECT minWageAck FROM Payroll WHERE workerId = 5 AND yearMonth = '2026-09'").minWageAck, 0);
  assert.throws(() => svc.confirmPayroll('2026-09'), { code: 'MIN_WAGE_UNACKNOWLEDGED' });
});

// ---- TC-11x monthly payroll ----

test('TC-114 September payroll for Choi Minho: worked + estimated hours, holiday week of 09-21', () => {
  const minho = svc.generatePayroll('2026-09').find((p) => p.workerId === 3);
  // Worked 16 h (week 09-21) + scheduled Tue 09-29 5 h (estimated).
  assert.equal(minho.baseHours, 21);
  assert.equal(minho.basePay, 21 * 10320);
  assert.equal(minho.holidayPay, 33024);
  assert.equal(minho.total, 21 * 10320 + 33024);
  assert.equal(minho.estimated, 1);
});

test('TC-115 confirmed payroll is read-only; regenerating replaces drafts only', () => {
  svc.generatePayroll('2026-09');
  svc.acknowledgeMinWage('2026-09', 5);
  svc.confirmPayroll('2026-09');
  const before = svc.getPayroll('2026-09');
  const tue = get("SELECT id FROM Shift WHERE workerId = 3 AND workDate = '2026-09-29'").id;
  setNow('2026-09-30T09:00');
  svc.markAbsent(tue);
  const after = svc.generatePayroll('2026-09');
  assert.deepEqual(after.map((p) => [p.workerId, p.total, p.status]), before.map((p) => [p.workerId, p.total, p.status]));
});

// ---- TC-12x expiry (BR-12) ----

test('TC-121 request expires at its deadline; requester and owner notified', () => {
  setNow('2026-09-29T20:59');
  assert.equal(svc.expireOverdue(), 0);
  setNow('2026-09-29T21:00');
  assert.equal(svc.expireOverdue(), 1);
  assert.equal(get('SELECT status FROM SubRequest WHERE id = 1').status, 'EXPIRED');
  assert.deepEqual(all("SELECT DISTINCT response FROM SubRequestTarget WHERE subRequestId = 1"), [{ response: 'CLOSED' }]);
  assert.deepEqual(all("SELECT workerId FROM Notification WHERE kind = 'REQUEST_EXPIRED' ORDER BY workerId").map((n) => n.workerId), [1, 2]);
});

test('TC-122 an ACCEPTED request expires when the shift starts without approval', () => {
  const tue = get("SELECT id FROM Shift WHERE workerId = 3 AND workDate = '2026-09-29'").id;
  svc.saveAvailability(2, [{ weekday: 2, startTime: '17:00', endTime: '23:00' }]);
  const { id } = svc.createSubRequest({ shiftId: tue, requesterId: 3, deadline: '2026-09-29T18:00' });
  svc.respondToRequest(id, 2, 'ACCEPTED');
  setNow('2026-09-29T18:00');
  svc.expireOverdue();
  assert.equal(get('SELECT status FROM SubRequest WHERE id = ?', [id]).status, 'EXPIRED');
  assert.throws(() => svc.decideRequest(id, 'APPROVED'), { code: 'NOT_ACCEPTED' });
});

test('TC-123 cancel closes and notifies all targets (UC-12)', () => {
  svc.cancelRequest(1, 2);
  assert.equal(get('SELECT status FROM SubRequest WHERE id = 1').status, 'CANCELLED');
  assert.deepEqual(all("SELECT workerId FROM Notification WHERE kind = 'REQUEST_CANCELLED' ORDER BY workerId").map((n) => n.workerId), [3, 5]);
  assert.throws(() => svc.cancelRequest(1, 2), { code: 'REQUEST_CLOSED' });
});

// ---- UC-07 attendance, NFR-11 privacy, FR-21 inbox ----

test('TC-071 worker records attendance for a past shift; owner confirms it', () => {
  const mon = get("SELECT id FROM Shift WHERE workerId = 2 AND workDate = '2026-09-28'").id;
  assert.throws(() => svc.recordAttendance(mon, 2, '18:00', '23:00'), { code: 'SHIFT_NOT_STARTED' });
  setNow('2026-09-29T09:00');
  assert.throws(() => svc.recordAttendance(mon, 3, '18:00', '23:00'), { code: 'NOT_OWN_SHIFT' });
  svc.recordAttendance(mon, 2, '18:05', '23:00');
  svc.confirmAttendance(mon);
  assert.equal(get('SELECT status FROM Shift WHERE id = ?', [mon]).status, 'WORKED');
  assert.equal(svc.recomputeWeek('2026-09-28').find((r) => r.workerId === 2).actualHours, 4.92);
});

test('TC-131 a worker never receives other workers\' phone or wage (NFR-11)', () => {
  const seen = svc.listWorkers({ id: 3, role: 'WORKER' });
  for (const w of seen.filter((x) => x.id !== 3)) {
    assert.equal(w.phone, null);
    assert.equal(w.hourlyWage, null);
  }
  assert.equal(seen.find((w) => w.id === 3).hourlyWage, 10320);
  assert.ok(svc.listWorkers({ id: 1, role: 'OWNER' }).every((w) => w.role === 'OWNER' || w.phone));
});

test('TC-132 inbox lists newest first with unread count; mark read clears it (FR-21)', () => {
  svc.respondToRequest(1, 3, 'ACCEPTED');
  const inbox = svc.listNotifications(2);
  assert.equal(inbox.unread, 1);
  assert.equal(inbox.items[0].kind, 'REQUEST_ACCEPTED');
  svc.markNotificationsRead(2);
  assert.equal(svc.unreadCount(2), 0);
});

test('TC-133 notification recipients follow the spec §8 table', () => {
  const who = (reqId, kind) => all('SELECT workerId FROM Notification WHERE subRequestId = ? AND kind = ? ORDER BY workerId', [reqId, kind]).map((n) => n.workerId);
  // Seed request 1: REQUEST_RECEIVED to both candidates; a decline notifies no one.
  assert.deepEqual(who(1, 'REQUEST_RECEIVED'), [3, 5]);
  const before = get('SELECT count(*) AS n FROM Notification').n;
  svc.respondToRequest(1, 5, 'DECLINED');
  assert.equal(get('SELECT count(*) AS n FROM Notification').n, before);
  svc.respondToRequest(1, 3, 'ACCEPTED');
  assert.deepEqual(who(1, 'REQUEST_ACCEPTED'), [1, 2]);
  assert.deepEqual(who(1, 'TARGET_CLOSED'), []);
  svc.decideRequest(1, 'REJECTED');
  assert.deepEqual(who(1, 'REQUEST_REJECTED'), [2, 3]);
  // Approval goes to requester and acceptor.
  const sat = get("SELECT id FROM Shift WHERE workerId = 3 AND workDate = '2026-10-03'").id;
  const r2 = svc.createSubRequest({ shiftId: sat, requesterId: 3, deadline: '2026-10-02T12:00' }).id;
  svc.respondToRequest(r2, 4, 'ACCEPTED');
  assert.deepEqual(who(r2, 'TARGET_CLOSED'), [2]);
  svc.decideRequest(r2, 'APPROVED');
  assert.deepEqual(who(r2, 'REQUEST_APPROVED'), [3, 4]);
  // NO_CANDIDATE to the owner only.
  const sun = get("SELECT id FROM Shift WHERE workerId = 4 AND workDate = '2026-10-04'").id;
  const r3 = svc.createSubRequest({ shiftId: sun, requesterId: 4, deadline: '2026-10-03T12:00' }).id;
  assert.deepEqual(who(r3, 'NO_CANDIDATE'), [1]);
  // Cancel: every target that was PENDING or ACCEPTED; expiry: requester and owner, targets closed silently.
  const thu = get("SELECT id FROM Shift WHERE workerId = 3 AND workDate = '2026-10-01'").id;
  const r4 = svc.createSubRequest({ shiftId: thu, requesterId: 3, deadline: '2026-09-30T12:00' }).id;
  assert.deepEqual(who(r4, 'REQUEST_RECEIVED'), [2, 5]);
  setNow('2026-09-30T12:00');
  svc.expireOverdue();
  assert.deepEqual(who(r4, 'REQUEST_EXPIRED'), [1, 3]);
  assert.equal(get("SELECT count(*) AS n FROM Notification WHERE subRequestId = ? AND workerId IN (2, 5) AND kind != 'REQUEST_RECEIVED'", [r4]).n, 0);
  assert.deepEqual(all('SELECT DISTINCT response FROM SubRequestTarget WHERE subRequestId = ?', [r4]), [{ response: 'CLOSED' }]);
  // Cancel of an ACCEPTED request: the acceptor (ACCEPTED) is notified; the target closed at acceptance is not.
  svc.generateWeek('2026-10-05');
  const wed = get("SELECT id FROM Shift WHERE workerId = 2 AND workDate = '2026-10-07'").id;
  const r5 = svc.createSubRequest({ shiftId: wed, requesterId: 2, deadline: '2026-10-06T12:00' }).id;
  assert.deepEqual(who(r5, 'REQUEST_RECEIVED'), [3, 5]);
  svc.respondToRequest(r5, 5, 'ACCEPTED');
  svc.cancelRequest(r5, 2);
  assert.deepEqual(who(r5, 'REQUEST_CANCELLED'), [5]);
});

test('TC-002 a saved database from before spec v2 (no Payroll.minWageAck) is replaced by the seed', () => {
  const old = new SQL.Database();
  old.run(`CREATE TABLE Workplace (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO Workplace VALUES (1, 'Old copy');
    CREATE TABLE Payroll (id INTEGER PRIMARY KEY, workerId INTEGER, minWageWarning INTEGER, estimated INTEGER);`);
  const bytes = old.export();
  const store = new Map([[DB_KEY, Buffer.from(bytes).toString('base64')]]);
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const warn = console.warn;
  console.warn = () => {};
  try {
    openDatabase(SQL, storage);
  } finally {
    console.warn = warn;
  }
  assert.equal(svc.getWorkplace().name, 'Dalbit Café');
  assert.ok(all('PRAGMA table_info(Payroll)').some((c) => c.name === 'minWageAck'));
  assert.notEqual(store.get(DB_KEY), Buffer.from(bytes).toString('base64'));
});

test('TC-134 each role sees only its own menus; other routes are not offered (FR-20)', () => {
  assert.deepEqual(svc.menuFor('WORKER'), ['schedule', 'requests', 'inbox', 'attendance', 'availability']);
  assert.deepEqual(svc.menuFor('OWNER'), ['schedule', 'approvals', 'inbox', 'attendance', 'weekly', 'payroll', 'workers', 'settings']);
  for (const ownerOnly of ['approvals', 'weekly', 'payroll', 'workers', 'settings']) assert.ok(!svc.menuFor('WORKER').includes(ownerOnly), ownerOnly);
  for (const workerOnly of ['requests', 'availability']) assert.ok(!svc.menuFor('OWNER').includes(workerOnly), workerOnly);
  assert.deepEqual(svc.menuFor('GUEST'), []);
  svc.menuFor('WORKER').push('payroll');
  assert.ok(!svc.menuFor('WORKER').includes('payroll'), 'callers cannot widen the menu');
});

test('TC-135 a worker sees only their own attendance rows and no one else\'s phone or wage (NFR-11)', () => {
  const seoyeon = svc.getWorker(2);
  const rows = svc.listAttendance('2026-09-21', seoyeon);
  assert.ok(rows.length > 0 && rows.every((s) => s.workerId === 2));
  assert.equal(svc.listAttendance('2026-09-21', svc.getWorker(1)).length, 9);
  const seen = svc.listWorkers(seoyeon);
  assert.deepEqual(seen.filter((w) => w.id !== 2).map((w) => [w.phone, w.hourlyWage]), [[null, null], [null, null], [null, null], [null, null]]);
  assert.deepEqual([seen.find((w) => w.id === 2).phone, seen.find((w) => w.id === 2).hourlyWage], ['010-4172-2083', 10500]);
});
