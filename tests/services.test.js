import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import { createDatabase, openDatabase, all, get, run, DB_KEY } from '../app/core/db.js';
import { setNow, resetClock, now } from '../app/core/clock.js';
import * as svc from '../app/core/services.js';

const SQL = await initSqlJs();

beforeEach(() => {
  resetClock();
  createDatabase(SQL, { seed: true });
});

const wedShiftId = () => get("SELECT id FROM Shift WHERE COALESCE(originalWorkerId, workerId) = 2 AND workDate = '2026-09-30'").id;

/** Doyun's Sat 10-03 10:00-16:00 with every co-worker busy then (Minho already works 12:00-18:00): no eligible candidate. */
function doyunSaturdayWithNoTaker() {
  svc.editShift(null, { workDate: '2026-10-03', startTime: '09:00', endTime: '17:00', workerId: 2 });
  svc.editShift(null, { workDate: '2026-10-03', startTime: '11:00', endTime: '15:00', workerId: 4 });
  return get("SELECT id FROM Shift WHERE workerId = 5 AND workDate = '2026-10-03'").id;
}

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
  // Weeks of 09-21 and 09-28: 9 fixed slots each; before them the work history up to 09-20 (TC-141).
  assert.equal(shifts.filter((s) => s.workDate >= '2026-09-21').length, 18);
  const past = shifts.filter((s) => s.workDate < '2026-09-28');
  assert.ok(past.every((s) => s.status === 'WORKED'));
  assert.ok(shifts.filter((s) => s.workDate >= '2026-09-28').every((s) => s.status === 'SCHEDULED'));
  assert.equal(get('SELECT count(*) AS n FROM Attendance WHERE confirmed = 1').n, past.length);
  assert.equal(get('SELECT count(*) AS n FROM Attendance').n, past.length);
  // Payroll: confirmed up to 2026-08, nothing for September yet (spec §10).
  assert.equal(get("SELECT count(*) AS n FROM Payroll WHERE status != 'CONFIRMED' OR yearMonth >= '2026-09'").n, 0);
  assert.deepEqual(all("SELECT kind FROM Notification WHERE kind != 'REQUEST_RECEIVED'"), []);
  const r = get('SELECT * FROM SubRequest');
  assert.equal(r.status, 'REQUESTED');
  assert.equal(r.deadline, '2026-09-29T21:00');
  assert.equal(r.reason, 'Midterm exam');
  assert.equal(r.shiftId, wedShiftId());
  assert.deepEqual(all('SELECT workerId, response FROM SubRequestTarget ORDER BY workerId'),
    [{ workerId: 3, response: 'PENDING' }, { workerId: 4, response: 'PENDING' }, { workerId: 5, response: 'PENDING' }]);
  assert.deepEqual(all("SELECT workerId FROM Notification WHERE kind = 'REQUEST_RECEIVED' ORDER BY workerId").map((n) => n.workerId), [3, 4, 5]);
  assert.deepEqual(all("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Availability'"), []);
});

test('TC-016 seed request candidates equal the BR-01 computation', () => {
  svc.cancelRequest(1, 2);
  const { candidates } = svc.createSubRequest({ shiftId: wedShiftId(), requesterId: 2, deadline: '2026-09-29T21:00' });
  assert.deepEqual(candidates.map((c) => c.name), ['Choi Minho', 'Jung Hana', 'Kang Doyun']);
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

test('TC-025 no eligible worker still creates the request, which ends FAILED at once (FR-08, BR-13)', () => {
  const shiftId = doyunSaturdayWithNoTaker();
  const { id, status, candidates } = svc.createSubRequest({ shiftId, requesterId: 5, deadline: '2026-10-02T12:00' });
  assert.deepEqual([candidates.length, status], [0, 'FAILED']);
  assert.equal(get('SELECT status FROM SubRequest WHERE id = ?', [id]).status, 'FAILED');
  assert.deepEqual(all("SELECT workerId FROM Notification WHERE subRequestId = ? AND kind = 'REQUEST_FAILED' ORDER BY workerId", [id]).map((n) => n.workerId), [1, 5]);
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
  assert.deepEqual(all('SELECT workerId, response FROM SubRequestTarget ORDER BY workerId'),
    [{ workerId: 3, response: 'ACCEPTED' }, { workerId: 4, response: 'CLOSED' }, { workerId: 5, response: 'CLOSED' }]);
});

test('TC-052 acceptance notifies requester and owner, closed target is told (FR-10)', () => {
  svc.respondToRequest(1, 3, 'ACCEPTED');
  const kinds = all('SELECT workerId, kind FROM Notification WHERE subRequestId = 1 AND kind != ? ORDER BY workerId', ['REQUEST_RECEIVED']);
  assert.deepEqual(kinds, [{ workerId: 1, kind: 'REQUEST_ACCEPTED' }, { workerId: 2, kind: 'REQUEST_ACCEPTED' },
    { workerId: 4, kind: 'TARGET_CLOSED' }, { workerId: 5, kind: 'TARGET_CLOSED' }]);
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

test('TC-064 worker home: Minho sees the request with the effect of accepting (16 -> 21 h, 33,024 won unchanged)', () => {
  const home = svc.getWorkerHome(3);
  assert.equal(home.worker.name, 'Choi Minho');
  assert.equal(home.incoming.length, 1);
  const card = home.incoming[0];
  assert.deepEqual([card.id, card.requesterName, card.workDate, card.startTime, card.reason], [1, 'Lee Seoyeon', '2026-09-30', '18:00', 'Midterm exam']);
  assert.deepEqual([card.effect.before.scheduledHours, card.effect.after.scheduledHours], [16, 21]);
  assert.deepEqual([card.effect.before.holidayEligible, card.effect.after.holidayEligible, card.effect.eligibilityChanged], [true, true, false]);
  assert.deepEqual([card.effect.before.holidayPay, card.effect.after.holidayPay], [33024, 33024]);
  assert.deepEqual([home.week.scheduledHours, home.week.contractHours, home.week.holidayEligible, home.week.holidayPay], [16, 16, true, 33024]);
  assert.deepEqual([home.nextShift.workDate, home.nextShift.startTime], ['2026-09-29', '18:00']);
  assert.deepEqual(home.myOpen, []);
  assert.deepEqual(home.toRecord, []);
  // After accepting, the card is gone; Doyun's home says Minho was faster; Seoyeon sees her tracker at "accepted".
  svc.respondToRequest(1, 3, 'ACCEPTED');
  assert.equal(svc.getWorkerHome(3).incoming.length, 0);
  const doyun = svc.getWorkerHome(5);
  assert.deepEqual([doyun.incoming.length, doyun.taken.length, doyun.taken[0].acceptorName], [0, 1, 'Choi Minho']);
  const seoyeon = svc.getWorkerHome(2);
  assert.deepEqual([seoyeon.myOpen.length, seoyeon.myOpen[0].status, seoyeon.myOpen[0].acceptorName], [1, 'ACCEPTED', 'Choi Minho']);
  assert.deepEqual([seoyeon.week.contractHours, seoyeon.week.holidayEligible, seoyeon.week.reasons[0].code], [10, false, 'CONTRACT_BELOW_15']);
});

test('TC-065 owner home: decision card with the approval effect, then nothing left after approval', () => {
  let home = svc.getOwnerHome();
  assert.deepEqual([home.decisions.length, home.open.length, home.failed, home.taskCount], [0, 1, [], 0]);
  assert.deepEqual(home.open[0].targets.map((x) => [x.workerName, x.response]), [['Choi Minho', 'PENDING'], ['Jung Hana', 'PENDING'], ['Kang Doyun', 'PENDING']]);
  assert.deepEqual([home.week.shifts, home.week.hours, home.todayShifts.length, home.todayShifts[0].workerName], [9, 50, 1, 'Lee Seoyeon']);
  assert.equal(home.week.holidayTotal, 33024);
  svc.respondToRequest(1, 3, 'ACCEPTED');
  home = svc.getOwnerHome();
  assert.deepEqual([home.decisions.length, home.open.length, home.taskCount], [1, 0, 1]);
  const [requester, acceptor] = home.decisions[0].rows;
  assert.deepEqual([requester.name, requester.before.scheduledHours, requester.after.scheduledHours, requester.after.holidayPay], ['Lee Seoyeon', 10, 5, 0]);
  assert.deepEqual([acceptor.name, acceptor.before.scheduledHours, acceptor.after.scheduledHours], ['Choi Minho', 16, 21]);
  assert.deepEqual([acceptor.before.holidayPay, acceptor.after.holidayPay, acceptor.eligibilityChanged], [33024, 33024, false]);
  svc.decideRequest(1, 'APPROVED');
  home = svc.getOwnerHome();
  assert.deepEqual([home.decisions.length, home.taskCount], [0, 0]);
  // Pay warnings and attendance to confirm are counted as tasks.
  svc.generatePayroll('2026-09');
  setNow('2026-09-29T09:00');
  svc.recordAttendance(get("SELECT id FROM Shift WHERE workerId = 2 AND workDate = '2026-09-28'").id, 2, '18:00', '23:00');
  home = svc.getOwnerHome();
  assert.deepEqual([home.payWarnings.map((p) => p.workerName), home.toConfirm.map((s) => s.workerName), home.taskCount], [['Kang Doyun'], ['Lee Seoyeon'], 2]);
});

test('TC-066 review step previews recipients; shift detail explains why a shift cannot be deleted', () => {
  const sat = get("SELECT id FROM Shift WHERE workerId = 3 AND workDate = '2026-10-03'").id;
  assert.deepEqual(svc.previewCandidates(sat, 3).map((c) => c.name), ['Lee Seoyeon', 'Jung Hana']);
  const sun = get("SELECT id FROM Shift WHERE workerId = 4 AND workDate = '2026-10-04'").id;
  assert.deepEqual(svc.previewCandidates(sun, 4).map((c) => c.name), ['Lee Seoyeon', 'Choi Minho', 'Kang Doyun']);
  assert.deepEqual(svc.previewCandidates(doyunSaturdayWithNoTaker(), 5), []);
  const wed = svc.getShiftDetail(wedShiftId());
  assert.deepEqual([wed.workerName, wed.openRequestId, wed.history.length, wed.canDelete], ['Lee Seoyeon', 1, 1, false]);
  assert.equal(svc.getShiftDetail(sat).canDelete, true);
});

// ---- TC-08x weekly summary through the service ----

test('TC-088 worked example: Minho 3.2 h holiday allowance, 33,024 KRW per week in September payroll', () => {
  const rows = svc.recomputeWeek('2026-09-21');
  const minho = rows.find((r) => r.workerId === 3);
  assert.equal(minho.holidayHours, 3.2);
  const seoyeon = rows.find((r) => r.workerId === 2);
  assert.equal(seoyeon.holidayEligible, false);
  assert.deepEqual(seoyeon.reasons, [{ code: 'CONTRACT_BELOW_15' }]);
  const payroll = svc.generatePayroll('2026-09').find((p) => p.workerId === 3);
  // BR-11: the four weeks whose Sunday is in September (08-31, 09-07, 09-14, 09-21) each pay 33,024.
  assert.equal(payroll.holidayPay, 4 * 33024);
});

test('TC-089 marking a shift absent removes holiday eligibility for that week', () => {
  // Only a SCHEDULED shift can be marked absent (spec §7), so use Minho's Tue of the current week after it started.
  setNow('2026-09-29T23:30');
  const tue = get("SELECT id FROM Shift WHERE workerId = 3 AND workDate = '2026-09-29'").id;
  assert.equal(svc.recomputeWeek('2026-09-28').find((r) => r.workerId === 3).holidayEligible, true);
  svc.markAbsent(tue);
  const minho = svc.recomputeWeek('2026-09-28').find((r) => r.workerId === 3);
  assert.equal(minho.holidayEligible, false);
  assert.deepEqual(minho.reasons, [{ code: 'ABSENT', date: '2026-09-29' }]);
});

test('TC-08A both substitution-attendance policies through approval', () => {
  const tue = get("SELECT id FROM Shift WHERE workerId = 3 AND workDate = '2026-09-29'").id;
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
  // Seoyeon's September shifts are 18:00-23:00: Wed 2, 9, 16, 23, 30 and Mon 7, 14, 21, 28 → 9 night hours.
  assert.equal(seoyeon.premiumPay, Math.floor(9 * 10500 * 0.5));
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

test('TC-114 September payroll for Choi Minho: worked + estimated hours, four holiday weeks', () => {
  const minho = svc.generatePayroll('2026-09').find((p) => p.workerId === 3);
  // Worked Tue 1, 8, 15, 22 and Thu 3, 10, 17, 24 (8 × 5 h) and Sat 5, 12, 19, 26 (4 × 6 h) = 64 h,
  // plus the scheduled Tue 09-29 5 h (estimated) = 69 h.
  assert.equal(minho.baseHours, 69);
  assert.equal(minho.basePay, 69 * 10320);
  assert.equal(minho.holidayPay, 4 * 33024);
  assert.equal(minho.total, 69 * 10320 + 4 * 33024);
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
  assert.deepEqual(all("SELECT workerId FROM Notification WHERE kind = 'REQUEST_CANCELLED' ORDER BY workerId").map((n) => n.workerId), [3, 4, 5]);
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
  // Seed request 1: REQUEST_RECEIVED to all three candidates; a decline that leaves someone pending notifies no one.
  assert.deepEqual(who(1, 'REQUEST_RECEIVED'), [3, 4, 5]);
  const before = get('SELECT count(*) AS n FROM Notification').n;
  svc.respondToRequest(1, 5, 'DECLINED');
  assert.equal(get('SELECT count(*) AS n FROM Notification').n, before);
  svc.respondToRequest(1, 3, 'ACCEPTED');
  assert.deepEqual(who(1, 'REQUEST_ACCEPTED'), [1, 2]);
  assert.deepEqual(who(1, 'TARGET_CLOSED'), [4]);
  svc.decideRequest(1, 'REJECTED');
  assert.deepEqual(who(1, 'REQUEST_REJECTED'), [2, 3]);
  // Approval goes to requester and acceptor.
  const sat = get("SELECT id FROM Shift WHERE workerId = 3 AND workDate = '2026-10-03'").id;
  const r2 = svc.createSubRequest({ shiftId: sat, requesterId: 3, deadline: '2026-10-02T12:00' }).id;
  svc.respondToRequest(r2, 4, 'ACCEPTED');
  assert.deepEqual(who(r2, 'TARGET_CLOSED'), [2]);
  svc.decideRequest(r2, 'APPROVED');
  assert.deepEqual(who(r2, 'REQUEST_APPROVED'), [3, 4]);
  // REQUEST_FAILED to the requester and the owner when every target answered can't (BR-13); targets get nothing more.
  const sun = get("SELECT id FROM Shift WHERE workerId = 4 AND workDate = '2026-10-04'").id;
  const r3 = svc.createSubRequest({ shiftId: sun, requesterId: 4, deadline: '2026-10-03T12:00' }).id;
  assert.deepEqual(who(r3, 'REQUEST_RECEIVED'), [2, 3, 5]);
  for (const w of [2, 3, 5]) svc.respondToRequest(r3, w, 'DECLINED');
  assert.deepEqual(who(r3, 'REQUEST_FAILED'), [1, 4]);
  assert.equal(get("SELECT count(*) AS n FROM Notification WHERE subRequestId = ? AND workerId IN (2, 3, 5) AND kind != 'REQUEST_RECEIVED'", [r3]).n, 0);
  // Cancel: every target that was PENDING or ACCEPTED; expiry: requester and owner, targets closed silently.
  const thu = get("SELECT id FROM Shift WHERE workerId = 3 AND workDate = '2026-10-01'").id;
  const r4 = svc.createSubRequest({ shiftId: thu, requesterId: 3, deadline: '2026-09-30T12:00' }).id;
  assert.deepEqual(who(r4, 'REQUEST_RECEIVED'), [2, 4, 5]);
  setNow('2026-09-30T12:00');
  svc.expireOverdue();
  assert.deepEqual(who(r4, 'REQUEST_EXPIRED'), [1, 3]);
  assert.equal(get("SELECT count(*) AS n FROM Notification WHERE subRequestId = ? AND workerId IN (2, 4, 5) AND kind != 'REQUEST_RECEIVED'", [r4]).n, 0);
  assert.deepEqual(all('SELECT DISTINCT response FROM SubRequestTarget WHERE subRequestId = ?', [r4]), [{ response: 'CLOSED' }]);
  // Cancel of an ACCEPTED request: the acceptor (ACCEPTED) is notified; the target closed at acceptance is not.
  svc.generateWeek('2026-10-05');
  const wed = get("SELECT id FROM Shift WHERE workerId = 2 AND workDate = '2026-10-07'").id;
  const r5 = svc.createSubRequest({ shiftId: wed, requesterId: 2, deadline: '2026-10-06T12:00' }).id;
  assert.deepEqual(who(r5, 'REQUEST_RECEIVED'), [3, 4, 5]);
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
  assert.deepEqual(svc.menuFor('WORKER'), ['home', 'schedule', 'swaps', 'me']);
  assert.deepEqual(svc.menuFor('OWNER'), ['home', 'schedule', 'staff', 'pay']);
  assert.deepEqual(svc.routesFor('WORKER'), ['home', 'schedule', 'swaps', 'me', 'notifications']);
  assert.deepEqual(svc.routesFor('OWNER'), ['home', 'schedule', 'staff', 'pay', 'notifications', 'settings']);
  for (const ownerOnly of ['staff', 'pay', 'settings']) assert.ok(!svc.routesFor('WORKER').includes(ownerOnly), ownerOnly);
  for (const workerOnly of ['swaps', 'me']) assert.ok(!svc.routesFor('OWNER').includes(workerOnly), workerOnly);
  assert.deepEqual(svc.menuFor('GUEST'), []);
  assert.deepEqual(svc.routesFor('GUEST'), []);
  svc.menuFor('WORKER').push('pay');
  assert.ok(!svc.routesFor('WORKER').includes('pay'), 'callers cannot widen the menu');
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

// ---- Regression tests from the independent code review (reproduction run 1) ----

test('TC-054 acceptance is refused when the candidate already works an overlapping shift that day (BR-02, ACCEPTOR_BUSY)', () => {
  svc.editShift(null, { workDate: '2026-09-30', startTime: '19:00', endTime: '21:00', workerId: 3 });
  assert.throws(() => svc.respondToRequest(1, 3, 'ACCEPTED'), { code: 'ACCEPTOR_BUSY' });
  const r = get('SELECT status, acceptorId FROM SubRequest WHERE id = 1');
  assert.deepEqual({ ...r }, { status: 'REQUESTED', acceptorId: null });
  assert.deepEqual(all('SELECT workerId, response FROM SubRequestTarget WHERE subRequestId = 1 ORDER BY workerId').map((t) => [t.workerId, t.response]),
    [[3, 'PENDING'], [4, 'PENDING'], [5, 'PENDING']]);
  assert.equal(get("SELECT count(*) AS n FROM Notification WHERE kind = 'REQUEST_ACCEPTED'").n, 0);
  svc.respondToRequest(1, 5, 'ACCEPTED');
  assert.equal(get('SELECT acceptorId FROM SubRequest WHERE id = 1').acceptorId, 5);
});

test('TC-055 approval is refused when the acceptor got an overlapping shift after accepting (BR-02, ACCEPTOR_BUSY)', () => {
  svc.respondToRequest(1, 3, 'ACCEPTED');
  svc.editShift(null, { workDate: '2026-09-30', startTime: '12:00', endTime: '19:00', workerId: 3 });
  assert.throws(() => svc.decideRequest(1, 'APPROVED'), { code: 'ACCEPTOR_BUSY' });
  assert.equal(get('SELECT status FROM SubRequest WHERE id = 1').status, 'ACCEPTED');
  const wed = get('SELECT workerId, originalWorkerId FROM Shift WHERE id = ?', [wedShiftId()]);
  assert.deepEqual({ ...wed }, { workerId: 2, originalWorkerId: null });
  assert.equal(get("SELECT count(*) AS n FROM Notification WHERE kind = 'REQUEST_APPROVED'").n, 0);
  svc.decideRequest(1, 'REJECTED');
  assert.equal(get('SELECT status FROM SubRequest WHERE id = 1').status, 'REJECTED');
});

test('TC-072 an ABSENT shift cannot be confirmed as worked (spec §7, FR-13, ATTENDANCE_CLOSED)', () => {
  setNow('2026-09-29T23:30');
  const tue = get("SELECT id FROM Shift WHERE workerId = 3 AND workDate = '2026-09-29'").id;
  svc.recordAttendance(tue, 3, '18:00', '23:00');
  svc.markAbsent(tue);
  assert.throws(() => svc.confirmAttendance(tue), { code: 'ATTENDANCE_CLOSED' });
  assert.throws(() => svc.markAbsent(tue), { code: 'ATTENDANCE_CLOSED' });
  assert.equal(get('SELECT status FROM Shift WHERE id = ?', [tue]).status, 'ABSENT');
});

test('TC-073 a WORKED shift cannot be marked absent or confirmed again (spec §7, FR-13, ATTENDANCE_CLOSED)', () => {
  const worked = get("SELECT id FROM Shift WHERE workerId = 3 AND workDate = '2026-09-22'").id;
  assert.equal(get('SELECT status FROM Shift WHERE id = ?', [worked]).status, 'WORKED');
  assert.throws(() => svc.markAbsent(worked), { code: 'ATTENDANCE_CLOSED' });
  assert.throws(() => svc.confirmAttendance(worked), { code: 'ATTENDANCE_CLOSED' });
  assert.equal(get('SELECT status FROM Shift WHERE id = ?', [worked]).status, 'WORKED');
});

test('TC-01E regenerating a week does not re-create a shift the owner moved to another day (FR-04)', () => {
  const mon = get("SELECT id FROM Shift WHERE workerId = 2 AND workDate = '2026-09-28'").id;
  svc.editShift(mon, { workDate: '2026-09-29' });
  assert.equal(svc.generateWeek('2026-09-28').created, 0);
  assert.equal(get("SELECT count(*) AS n FROM Shift WHERE workerId = 2 AND workDate = '2026-09-28'").n, 0);
  assert.equal(get("SELECT count(*) AS n FROM Shift WHERE workerId = 2 AND workDate = '2026-09-29'").n, 1);
});

test('TC-01F regenerating a week after the fixed rows were deleted and re-added creates no overlapping duplicates (FR-04)', () => {
  svc.saveFixedSchedule(2, [{ weekday: 1, startTime: '18:00', endTime: '23:00' }, { weekday: 3, startTime: '18:00', endTime: '23:00' }]);
  assert.equal(svc.generateWeek('2026-09-28').created, 0);
  assert.equal(get("SELECT count(*) AS n FROM Shift WHERE workerId = 2 AND workDate = '2026-09-28'").n, 1);
  assert.equal(get("SELECT count(*) AS n FROM Shift WHERE workerId = 2 AND workDate = '2026-09-30'").n, 1);
  assert.equal(svc.generateWeek('2026-10-05').created, 9);
});

test('TC-01G changing worker, date or time of a shift with an open request is refused (FR-05, SHIFT_OPEN_REQUEST)', () => {
  const wed = wedShiftId();
  assert.throws(() => svc.editShift(wed, { workerId: 4 }), { code: 'SHIFT_OPEN_REQUEST' });
  assert.throws(() => svc.editShift(wed, { workDate: '2026-10-01' }), { code: 'SHIFT_OPEN_REQUEST' });
  assert.throws(() => svc.editShift(wed, { startTime: '19:00' }), { code: 'SHIFT_OPEN_REQUEST' });
  svc.respondToRequest(1, 3, 'ACCEPTED');
  assert.throws(() => svc.editShift(wed, { endTime: '22:00' }), { code: 'SHIFT_OPEN_REQUEST' });
  assert.deepEqual({ ...get('SELECT workDate, startTime, endTime, workerId FROM Shift WHERE id = ?', [wed]) },
    { workDate: '2026-09-30', startTime: '18:00', endTime: '23:00', workerId: 2 });
  svc.cancelRequest(1, 2);
  svc.editShift(wed, { startTime: '19:00' });
  assert.equal(get('SELECT startTime FROM Shift WHERE id = ?', [wed]).startTime, '19:00');
});

test('TC-08C recomputing a week deletes the summary of a worker who no longer has a shift that week (spec §8)', () => {
  svc.recomputeWeek('2026-09-28');
  assert.equal(get("SELECT holidayHours FROM WeeklySummary WHERE workerId = 3 AND weekStart = '2026-09-28'").holidayHours, 3.2);
  for (const s of all("SELECT id FROM Shift WHERE workerId = 3 AND workDate BETWEEN '2026-09-28' AND '2026-10-04'")) {
    svc.editShift(s.id, { workerId: 2 });
  }
  const rows = svc.recomputeWeek('2026-09-28');
  assert.equal(rows.find((r) => r.workerId === 3), undefined);
  assert.equal(get("SELECT id FROM WeeklySummary WHERE workerId = 3 AND weekStart = '2026-09-28'"), null);
  const minho = svc.generatePayroll('2026-10').find((p) => p.workerId === 3);
  assert.ok(!minho || minho.holidayPay === 0, 'no stale 33,024 won holiday pay');
});

test('TC-124 accepting after the deadline expires the request and is refused (BR-12, REQUEST_CLOSED)', () => {
  setNow('2026-09-29T22:00');
  assert.throws(() => svc.respondToRequest(1, 3, 'ACCEPTED'), { code: 'REQUEST_CLOSED' });
  const r = get('SELECT status, acceptorId FROM SubRequest WHERE id = 1');
  assert.deepEqual({ ...r }, { status: 'EXPIRED', acceptorId: null });
  assert.deepEqual(all('SELECT DISTINCT response FROM SubRequestTarget WHERE subRequestId = 1'), [{ response: 'CLOSED' }]);
  assert.deepEqual(all("SELECT workerId FROM Notification WHERE kind = 'REQUEST_EXPIRED' ORDER BY workerId").map((n) => n.workerId), [1, 2]);
  assert.equal(get("SELECT count(*) AS n FROM Notification WHERE kind = 'REQUEST_ACCEPTED'").n, 0);
});

test('TC-125 approving at the deadline or after the shift start expires the request and is refused (BR-12, REQUEST_CLOSED)', () => {
  svc.respondToRequest(1, 3, 'ACCEPTED');
  setNow('2026-09-29T21:00');
  assert.throws(() => svc.decideRequest(1, 'APPROVED'), { code: 'REQUEST_CLOSED' });
  assert.equal(get('SELECT status FROM SubRequest WHERE id = 1').status, 'EXPIRED');
  assert.equal(get('SELECT workerId FROM Shift WHERE id = ?', [wedShiftId()]).workerId, 2);
  assert.equal(get("SELECT count(*) AS n FROM Notification WHERE kind = 'REQUEST_APPROVED'").n, 0);

  // Shift start: a request whose deadline equals the shift start, decided once the shift has started.
  const tue = get("SELECT id FROM Shift WHERE workerId = 3 AND workDate = '2026-10-01'").id;
  setNow('2026-09-30T09:00');
  const { id } = svc.createSubRequest({ shiftId: tue, requesterId: 3, deadline: '2026-10-01T18:00' });
  svc.respondToRequest(id, 2, 'ACCEPTED');
  setNow('2026-10-01T18:00');
  assert.throws(() => svc.decideRequest(id, 'APPROVED'), { code: 'REQUEST_CLOSED' });
  assert.equal(get('SELECT status FROM SubRequest WHERE id = ?', [id]).status, 'EXPIRED');
  assert.equal(get('SELECT workerId FROM Shift WHERE id = ?', [tue]).workerId, 3);
});

// ---- TC-13x no taker: can't answers and FAILED (BR-13, FR-08, FR-22; iteration 6) ----

test('TC-13A all three targets answer can\'t: FAILED, requester and owner notified, later accept refused (FR-22, BR-13)', () => {
  assert.equal(svc.respondToRequest(1, 3, 'DECLINED').status, 'REQUESTED');
  assert.equal(svc.respondToRequest(1, 4, 'DECLINED').status, 'REQUESTED');
  assert.equal(svc.respondToRequest(1, 5, 'DECLINED').status, 'FAILED');
  const r = get('SELECT status, acceptorId, decidedAt FROM SubRequest WHERE id = 1');
  assert.deepEqual({ ...r }, { status: 'FAILED', acceptorId: null, decidedAt: '2026-09-28T09:00' });
  assert.deepEqual(all('SELECT DISTINCT response FROM SubRequestTarget WHERE subRequestId = 1'), [{ response: 'DECLINED' }]);
  const failed = all("SELECT workerId, message FROM Notification WHERE subRequestId = 1 AND kind = 'REQUEST_FAILED' ORDER BY workerId");
  assert.deepEqual(failed.map((n) => n.workerId), [1, 2]);
  assert.ok(failed.every((n) => n.message.length > 10));
  assert.throws(() => svc.respondToRequest(1, 3, 'ACCEPTED'), (err) => err.code === 'REQUEST_CLOSED' && err.params.status === 'FAILED');
  assert.throws(() => svc.cancelRequest(1, 2), (err) => err.code === 'REQUEST_CLOSED' && err.params.status === 'FAILED');
  assert.throws(() => svc.decideRequest(1, 'APPROVED'), { code: 'NOT_ACCEPTED' });
  assert.equal(get('SELECT status FROM SubRequest WHERE id = 1').status, 'FAILED');
  // FAILED is final: expiry does not touch it, and the shift can be requested again.
  setNow('2026-09-29T21:00');
  assert.equal(svc.expireOverdue(), 0);
  assert.equal(get("SELECT count(*) AS n FROM Notification WHERE kind = 'REQUEST_EXPIRED'").n, 0);
});

test('TC-13B no eligible candidate at creation: FAILED immediately, no targets (FR-08, BR-13)', () => {
  const shiftId = doyunSaturdayWithNoTaker();
  assert.deepEqual(svc.previewCandidates(shiftId, 5), []);
  const result = svc.createSubRequest({ shiftId, requesterId: 5, reason: 'Family event', deadline: '2026-10-02T12:00' });
  assert.deepEqual([result.status, result.candidates], ['FAILED', []]);
  assert.equal(get('SELECT count(*) AS n FROM SubRequestTarget WHERE subRequestId = ?', [result.id]).n, 0);
  assert.deepEqual(all('SELECT workerId, kind FROM Notification WHERE subRequestId = ? ORDER BY workerId', [result.id]).map((n) => [n.workerId, n.kind]),
    [[1, 'REQUEST_FAILED'], [5, 'REQUEST_FAILED']]);
  assert.deepEqual(svc.getWorkerHome(5).failed.map((f) => f.requestId), [result.id]);
  assert.deepEqual(svc.getOwnerHome().failed.map((f) => [f.requestId, f.requesterName]), [[result.id, 'Kang Doyun']]);
});

test('TC-13C one can\'t and one pending: still REQUESTED and no notification (FR-22)', () => {
  const sun = get("SELECT id FROM Shift WHERE workerId = 4 AND workDate = '2026-10-04'").id;
  const { id } = svc.createSubRequest({ shiftId: sun, requesterId: 4, deadline: '2026-10-03T12:00' });
  const before = get('SELECT count(*) AS n FROM Notification').n;
  svc.respondToRequest(id, 2, 'DECLINED');
  svc.respondToRequest(id, 3, 'DECLINED');
  assert.equal(get('SELECT status FROM SubRequest WHERE id = ?', [id]).status, 'REQUESTED');
  assert.equal(get('SELECT count(*) AS n FROM Notification').n, before);
  assert.deepEqual(svc.getWorkerHome(4).failed, []);
  assert.deepEqual(svc.getOwnerHome().failed, []);
  assert.ok(svc.getWorkerHome(5).incoming.some((r) => r.id === id));
  // The last pending target can still accept.
  assert.equal(svc.respondToRequest(id, 5, 'ACCEPTED').status, 'ACCEPTED');
});

test('TC-13D Home exposes the failed item; markNotificationsRead with its id removes it (BR-13, FR-21)', () => {
  for (const w of [3, 4, 5]) svc.respondToRequest(1, w, 'DECLINED');
  const seoyeon = svc.getWorkerHome(2);
  assert.equal(seoyeon.failed.length, 1);
  const mine = seoyeon.failed[0];
  assert.deepEqual([mine.requestId, mine.workDate, mine.startTime, mine.endTime], [1, '2026-09-30', '18:00', '23:00']);
  assert.equal(get('SELECT kind FROM Notification WHERE id = ?', [mine.notificationId]).kind, 'REQUEST_FAILED');
  assert.deepEqual(seoyeon.myOpen, []);
  const tracked = svc.listMyRequests(2).find((r) => r.id === 1);
  assert.equal(tracked.status, 'FAILED');
  assert.deepEqual(tracked.targets.map((t) => [t.workerName, t.response]), [['Choi Minho', 'DECLINED'], ['Jung Hana', 'DECLINED'], ['Kang Doyun', 'DECLINED']]);
  // Targets see no failed card of their own.
  assert.deepEqual(svc.getWorkerHome(3).failed, []);
  let owner = svc.getOwnerHome();
  assert.equal(owner.failed.length, 1);
  const card = owner.failed[0];
  assert.deepEqual([card.requestId, card.requesterName, card.workDate, card.startTime, card.endTime], [1, 'Lee Seoyeon', '2026-09-30', '18:00', '23:00']);
  assert.deepEqual([owner.open.length, owner.taskCount], [0, 1]);
  // Another user's id is ignored; the owner's own id acknowledges only that card.
  assert.equal(svc.markNotificationsRead(1, [mine.notificationId]), 0);
  assert.equal(svc.markNotificationsRead(1, [card.notificationId]), 1);
  owner = svc.getOwnerHome();
  assert.deepEqual([owner.failed, owner.taskCount], [[], 0]);
  assert.equal(svc.getWorkerHome(2).failed.length, 1);
  assert.equal(svc.markNotificationsRead(2, [mine.notificationId]), 1);
  assert.deepEqual(svc.getWorkerHome(2).failed, []);
  // The old call form still marks everything read.
  assert.ok(svc.unreadCount(3) > 0);
  svc.markNotificationsRead(3);
  assert.equal(svc.unreadCount(3), 0);
});

test('TC-13E demo walkthrough S8: Hana\'s Sun 10-04 request, all three can\'t, FAILED card for Hana and the owner (spec §10)', () => {
  const sun = get("SELECT id FROM Shift WHERE workerId = 4 AND workDate = '2026-10-04'").id;
  assert.deepEqual(svc.previewCandidates(sun, 4).map((c) => c.name), ['Lee Seoyeon', 'Choi Minho', 'Kang Doyun']);
  const { id, status, candidates } = svc.createSubRequest({ shiftId: sun, requesterId: 4, deadline: '2026-10-03T12:00' });
  assert.equal(status, 'REQUESTED');
  // Kang Doyun's Sun 16:00-22:00 does not overlap 10:00-16:00, so he is asked too.
  assert.deepEqual(candidates.map((c) => c.name), ['Lee Seoyeon', 'Choi Minho', 'Kang Doyun']);
  for (const w of [2, 3, 5]) {
    const card = svc.getWorkerHome(w).incoming.find((r) => r.id === id);
    assert.ok(card, `worker ${w} sees the request on Home`);
    svc.respondToRequest(id, w, 'DECLINED');
    assert.equal(svc.getWorkerHome(w).incoming.find((r) => r.id === id), undefined);
  }
  assert.equal(get('SELECT status FROM SubRequest WHERE id = ?', [id]).status, 'FAILED');
  const hana = svc.getWorkerHome(4);
  assert.deepEqual(hana.failed.map((f) => [f.requestId, f.workDate, f.startTime, f.endTime]), [[id, '2026-10-04', '10:00', '16:00']]);
  assert.equal(svc.listMyRequests(4).find((r) => r.id === id).status, 'FAILED');
  const owner = svc.getOwnerHome();
  assert.deepEqual(owner.failed.map((f) => [f.requestId, f.requesterName, f.workDate, f.startTime, f.endTime]), [[id, 'Jung Hana', '2026-10-04', '10:00', '16:00']]);
  assert.equal(owner.taskCount, 1);
  svc.markNotificationsRead(1, [owner.failed[0].notificationId]);
  assert.deepEqual([svc.getOwnerHome().failed, svc.getOwnerHome().taskCount], [[], 0]);
  // The shift stays Hana's.
  assert.equal(get('SELECT workerId FROM Shift WHERE id = ?', [sun]).workerId, 4);
});

test('TC-003 a saved database from before iteration 6 (Availability table, no FAILED status) is replaced by the seed', () => {
  const old = new SQL.Database();
  old.run(`CREATE TABLE Payroll (id INTEGER PRIMARY KEY, minWageAck INTEGER);
    CREATE TABLE Availability (id INTEGER PRIMARY KEY, workerId INTEGER);
    CREATE TABLE SubRequest (id INTEGER PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('REQUESTED','ACCEPTED','APPROVED','REJECTED','EXPIRED','CANCELLED')));`);
  const store = new Map([[DB_KEY, Buffer.from(old.export()).toString('base64')]]);
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const warn = console.warn;
  console.warn = () => {};
  try {
    openDatabase(SQL, storage);
  } finally {
    console.warn = warn;
  }
  assert.equal(svc.getWorkplace().name, 'Dalbit Café');
  assert.deepEqual(all("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Availability'"), []);
  for (const w of [3, 4, 5]) svc.respondToRequest(1, w, 'DECLINED');
  assert.equal(get('SELECT status FROM SubRequest WHERE id = 1').status, 'FAILED');
});

// ---- TC-14x seeded work history and automatic monthly payroll (spec §10, BR-14, FR-23) ----

const CONTRACT_STARTS = { 2: '2026-03-02', 3: '2026-06-01', 4: '2026-09-01', 5: '2026-08-15' };

/** ISO weekday 1 (Mon) … 7 (Sun) of a date. */
function weekdayOf(date) {
  return ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

function nextDay(date) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}

test('TC-141 seed history: shifts from contractStart to 09-20 follow the fixed schedule, all WORKED and confirmed (spec §10)', () => {
  for (const [id, start] of Object.entries(CONTRACT_STARTS)) {
    const workerId = Number(id);
    const fixed = svc.getFixedSchedules(workerId);
    const expected = [];
    for (let d = start; d <= '2026-10-04'; d = nextDay(d)) {
      for (const f of fixed) if (f.weekday === weekdayOf(d)) expected.push(`${d} ${f.startTime}-${f.endTime}`);
    }
    const actual = all(
      `SELECT s.*, a.clockIn, a.clockOut, a.confirmed FROM Shift s LEFT JOIN Attendance a ON a.shiftId = s.id
       WHERE s.workerId = ? ORDER BY s.workDate, s.startTime`, [workerId]);
    // No gap and no duplicate around 09-20 / 09-21: history and the two seeded weeks form one series.
    assert.deepEqual(actual.map((s) => `${s.workDate} ${s.startTime}-${s.endTime}`), expected);
    const history = actual.filter((s) => s.workDate <= '2026-09-20');
    assert.equal(history.length, expected.filter((e) => e.slice(0, 10) <= '2026-09-20').length);
    assert.ok(history.every((s) => s.status === 'WORKED' && s.confirmed === 1 && s.clockIn === s.startTime && s.clockOut === s.endTime));
    assert.ok(history.every((s) => s.fixedScheduleId && s.originalWorkerId === null));
  }
  assert.deepEqual(all("SELECT workerId, count(*) AS n FROM Shift WHERE workDate <= '2026-09-20' GROUP BY workerId ORDER BY workerId")
    .map((r) => [r.workerId, r.n]), [[2, 58], [3, 48], [4, 6], [5, 12]]);
  assert.equal(get("SELECT count(*) AS n FROM Shift WHERE workDate < ?", [CONTRACT_STARTS[2]]).n, 0);
});

test('TC-142 seed payroll: confirmed months per worker equal the generatePayroll recomputation (BR-06…BR-11)', () => {
  const stored = all('SELECT * FROM Payroll ORDER BY yearMonth, workerId');
  assert.deepEqual(stored.map((p) => `${p.workerId}:${p.yearMonth}`), [
    '2:2026-03', '2:2026-04', '2:2026-05', '2:2026-06', '3:2026-06', '2:2026-07', '3:2026-07', '2:2026-08', '3:2026-08', '5:2026-08',
  ]);
  assert.ok(stored.every((p) => p.status === 'CONFIRMED' && p.estimated === 0 && p.premiumPay === 0));
  // Minho (16 h/week) gets 3.2 h × 10,320 = 33,024 for each week whose Sunday is in the month: 4, 4 and 5 Sundays.
  assert.deepEqual(stored.filter((p) => p.workerId === 3).map((p) => p.holidayPay), [4 * 33024, 4 * 33024, 5 * 33024]);
  assert.ok(stored.filter((p) => p.workerId === 2).every((p) => p.holidayPay === 0 && p.basePay === p.baseHours * 10500));
  const doyun = stored.find((p) => p.workerId === 5);
  assert.deepEqual([doyun.baseHours, doyun.total, doyun.minWageWarning, doyun.minWageAck], [36, 360000, 1, 1]);
  assert.ok(stored.filter((p) => p.workerId !== 5).every((p) => p.minWageWarning === 0 && p.minWageAck === 0));
  // Recompute each month from the same shifts: drop its rows (test only — the app never deletes confirmed payroll)
  // and generate the draft again.
  const fields = ['workerId', 'yearMonth', 'baseHours', 'basePay', 'holidayPay', 'premiumPay', 'total', 'minWageWarning', 'estimated'];
  const pick = (p) => fields.map((f) => p[f]);
  const recomputed = [];
  for (const m of [...new Set(stored.map((p) => p.yearMonth))]) {
    run('DELETE FROM Payroll WHERE yearMonth = ?', [m]);
    recomputed.push(...svc.generatePayroll(m));
  }
  assert.deepEqual(recomputed.map(pick).sort(), stored.map(pick).sort());
});

const payrollReadyRows = () => all("SELECT * FROM Notification WHERE kind = 'PAYROLL_DRAFT_READY' ORDER BY id");

test('TC-143 prepareMonthlyPayroll: September draft on 10-01 with one notification, nothing again in October, nothing before (BR-14, FR-23)', () => {
  // Before October the previous month (August) is already confirmed and September is never touched.
  for (const t of ['2026-09-28T09:00', '2026-09-30T23:59']) assert.deepEqual(svc.prepareMonthlyPayroll(t), { yearMonth: '2026-08', created: 0 });
  // Before the first contract month there is nothing to prepare.
  assert.deepEqual(svc.prepareMonthlyPayroll('2026-03-15T09:00'), { yearMonth: '2026-02', created: 0 });
  assert.equal(get("SELECT count(*) AS n FROM Payroll WHERE yearMonth >= '2026-09'").n, 0);
  assert.equal(payrollReadyRows().length, 0);

  assert.deepEqual(svc.prepareMonthlyPayroll('2026-10-01T00:00'), { yearMonth: '2026-09', created: 4 });
  const draft = svc.getPayroll('2026-09');
  assert.deepEqual(draft.map((p) => [p.workerId, p.status]), [[2, 'DRAFT'], [3, 'DRAFT'], [4, 'DRAFT'], [5, 'DRAFT']]);
  assert.ok(draft.every((p) => p.autoPrepared === true));
  const notes = payrollReadyRows();
  assert.equal(notes.length, 1);
  assert.deepEqual([notes[0].workerId, notes[0].subRequestId, notes[0].createdAt, notes[0].readAt],
    [1, null, '2026-10-01T00:00', null]);
  assert.equal(notes[0].message, 'The September 2026 payroll draft is ready. Review and confirm it.');
  // The draft is exactly what generatePayroll computes.
  const fields = (p) => [p.workerId, p.baseHours, p.basePay, p.holidayPay, p.premiumPay, p.total, p.minWageWarning, p.estimated];
  const first = draft.map(fields);
  svc.acknowledgeMinWage('2026-09', 5);
  // Later in October (explicit time and the demo clock) nothing is created or overwritten.
  assert.deepEqual(svc.prepareMonthlyPayroll('2026-10-15T09:00'), { yearMonth: '2026-09', created: 0 });
  setNow('2026-10-31T23:59');
  assert.deepEqual(svc.prepareMonthlyPayroll(), { yearMonth: '2026-09', created: 0 });
  assert.equal(payrollReadyRows().length, 1);
  assert.equal(get("SELECT minWageAck FROM Payroll WHERE workerId = 5 AND yearMonth = '2026-09'").minWageAck, 1);
  assert.equal(get("SELECT count(*) AS n FROM Payroll WHERE status = 'CONFIRMED' AND yearMonth = '2026-09'").n, 0);
  assert.deepEqual(svc.generatePayroll('2026-09').map(fields), first);
  // On 11-01 the October draft follows, with its own notification.
  assert.equal(svc.prepareMonthlyPayroll('2026-11-01T09:00').yearMonth, '2026-10');
  assert.deepEqual(payrollReadyRows().map((n) => n.message), [
    'The September 2026 payroll draft is ready. Review and confirm it.',
    'The October 2026 payroll draft is ready. Review and confirm it.',
  ]);
});

test('TC-144 owner Home payrollReady, listPayrollMonths and the notification yearMonth (UC-14)', () => {
  assert.equal(svc.getOwnerHome().payrollReady, null);
  assert.deepEqual(svc.listPayrollMonths(), [
    ...['03', '04', '05', '06', '07', '08'].map((m) => ({ yearMonth: `2026-${m}`, status: 'CONFIRMED', autoPrepared: false })),
    { yearMonth: '2026-09', status: 'NONE', autoPrepared: false },
  ]);
  assert.ok(svc.getPayroll('2026-08').every((p) => p.autoPrepared === false));
  setNow('2026-10-01T09:00');
  svc.prepareMonthlyPayroll();
  let home = svc.getOwnerHome();
  const id = payrollReadyRows()[0].id;
  assert.deepEqual(home.payrollReady, { notificationId: id, yearMonth: '2026-09' });
  // payrollReady and Doyun's unacknowledged warning are both owner tasks.
  assert.deepEqual([home.payWarnings.map((p) => p.workerId), home.taskCount], [[5], 2]);
  assert.deepEqual(svc.listPayrollMonths().slice(-3), [
    { yearMonth: '2026-08', status: 'CONFIRMED', autoPrepared: false },
    { yearMonth: '2026-09', status: 'DRAFT', autoPrepared: true },
    { yearMonth: '2026-10', status: 'NONE', autoPrepared: false },
  ]);
  const item = svc.listNotifications(1).items.find((n) => n.kind === 'PAYROLL_DRAFT_READY');
  assert.deepEqual([item.id, item.yearMonth], [id, '2026-09']);
  assert.ok(svc.listNotifications(1).items.filter((n) => n.kind !== 'PAYROLL_DRAFT_READY').every((n) => n.yearMonth === null));
  assert.equal(svc.markNotificationsRead(1, [id]), 1);
  home = svc.getOwnerHome();
  assert.deepEqual([home.payrollReady, home.taskCount], [null, 1]);
});

test('TC-145 demo walkthrough S9: confirmed Mar–Aug, clock to 10-01, September draft with Doyun\'s warning, no second draft (spec §10)', () => {
  const systemClock = () => { svc.expireOverdue(); svc.prepareMonthlyPayroll(); };
  systemClock();
  assert.deepEqual(svc.listPayrollMonths().filter((m) => m.status === 'CONFIRMED').map((m) => m.yearMonth),
    ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']);
  assert.ok(svc.getPayroll('2026-06').every((p) => p.status === 'CONFIRMED'));
  assert.equal(svc.getOwnerHome().payrollReady, null);
  setNow('2026-10-01T09:00');
  systemClock();
  const home = svc.getOwnerHome();
  assert.equal(home.payrollReady.yearMonth, '2026-09');
  const draft = svc.getPayroll('2026-09');
  assert.deepEqual(draft.filter((p) => p.minWageWarning && !p.minWageAck).map((p) => p.workerName), ['Kang Doyun']);
  assert.throws(() => svc.confirmPayroll('2026-09'), { code: 'MIN_WAGE_UNACKNOWLEDGED' });
  svc.markNotificationsRead(1, [home.payrollReady.notificationId]);
  svc.acknowledgeMinWage('2026-09', 5);
  assert.equal(svc.confirmPayroll('2026-09').confirmed, 4);
  setNow('2026-10-20T09:00');
  systemClock();
  assert.equal(payrollReadyRows().length, 1);
  assert.equal(get("SELECT count(*) AS n FROM Payroll WHERE yearMonth = '2026-09'").n, 4);
  assert.equal(svc.listPayrollMonths().find((m) => m.yearMonth === '2026-09').status, 'CONFIRMED');
  assert.equal(svc.getOwnerHome().payrollReady, null);
});
