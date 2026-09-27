// Application services: one function per use-case step (spec §3). Every command runs inside tx(),
// calls rules.js for each decision and writes the Notification rows of spec §4.
import { tx, all, get, run } from './db.js';
import { now, addMinutes } from './clock.js';
import {
  addDays, isoWeekday, weekStartOf, durationHours, overlaps, round2,
  isEligibleCandidate, validateRequest, contractHours, computeWeeklySummary,
  minimumWageFor, probationApplies, computePayrollRow,
} from './rules.js';

/** A rule or validation failure. `code` is translated by the UI; `message` is the English text. */
export class ServiceError extends Error {
  constructor(code, message, params = {}) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.params = params;
  }
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function ownerId() {
  return get("SELECT id FROM Worker WHERE role = 'OWNER' ORDER BY id LIMIT 1").id;
}

function workerName(id) {
  const w = get('SELECT name FROM Worker WHERE id = ?', [id]);
  return w ? w.name : '';
}

function notify(workerId, subRequestId, kind, message) {
  run('INSERT INTO Notification (workerId, subRequestId, kind, message, createdAt) VALUES (?, ?, ?, ?, ?)',
    [workerId, subRequestId, kind, message, now()]);
}

function shiftLabel(s) {
  return `${DAY_NAMES[isoWeekday(s.workDate)]} ${s.workDate} ${s.startTime}–${s.endTime}`;
}

function requestWithShift(requestId) {
  const r = get(
    `SELECT r.*, s.workDate, s.startTime, s.endTime, s.workerId AS shiftWorkerId, s.status AS shiftStatus
     FROM SubRequest r JOIN Shift s ON s.id = r.shiftId WHERE r.id = ?`, [requestId]);
  if (!r) throw new ServiceError('REQUEST_NOT_FOUND', 'This request no longer exists. Reload the page.');
  return r;
}

function checkTimes(start, end) {
  if (!TIME.test(start || '') || !TIME.test(end || '')) {
    throw new ServiceError('TIME_INVALID', 'Enter start and end times as HH:MM.');
  }
}

/** BR-12: an open request is overdue when its deadline or its shift start has passed. */
function isOverdue(r, t) {
  return r.deadline <= t || `${r.workDate}T${r.startTime}` <= t;
}

/** BR-02: the acceptor's other shift on the request's date that overlaps the requested shift, if any. */
function acceptorClash(r, workerId) {
  return all('SELECT * FROM Shift WHERE workerId = ? AND workDate = ? AND id != ?', [workerId, r.workDate, r.shiftId])
    .find((s) => overlaps(s.startTime, s.endTime, r.startTime, r.endTime));
}

function acceptorBusyError(workerId, clash) {
  const name = workerName(workerId);
  const range = `${clash.startTime}–${clash.endTime}`;
  return new ServiceError('ACCEPTOR_BUSY', `${name} already works ${range} that day, so they cannot cover this shift.`, { name, range });
}

// ---- UC-13 / FR-20 role guard -------------------------------------------------

const MENUS = {
  WORKER: ['home', 'schedule', 'swaps', 'me'],
  OWNER: ['home', 'schedule', 'staff', 'pay'],
};
/** Screens opened from the header (bell, header menu) rather than from the tab bar. */
const HEADER_ROUTES = {
  WORKER: ['notifications'],
  OWNER: ['notifications', 'settings'],
};

/** FR-20: the navigation items (tabs) of a role, in order. */
export function menuFor(role) {
  return MENUS[role] ? [...MENUS[role]] : [];
}

/** FR-20: every route a role may open (its tabs plus the header screens); the router redirects any other route to Home. */
export function routesFor(role) {
  return MENUS[role] ? [...MENUS[role], ...HEADER_ROUTES[role]] : [];
}

// ---- Read queries used by the screens ------------------------------------

export function getWorkplace() {
  return get('SELECT * FROM Workplace ORDER BY id LIMIT 1');
}

export function getSettings() {
  return { workplace: getWorkplace(), minimumWages: all('SELECT * FROM MinimumWage ORDER BY year') };
}

export function getWorker(id) {
  return get('SELECT * FROM Worker WHERE id = ?', [id]);
}

/**
 * All accounts. NFR-11: when the viewer is a worker, phone and wage of other people are removed here.
 */
export function listWorkers(viewer = null) {
  const rows = all("SELECT * FROM Worker ORDER BY CASE role WHEN 'OWNER' THEN 0 ELSE 1 END, id");
  if (!viewer || viewer.role === 'OWNER') return rows;
  return rows.map((w) => (w.id === viewer.id ? w : { ...w, phone: null, hourlyWage: null }));
}

export function getFixedSchedules(workerId) {
  return all('SELECT * FROM FixedSchedule WHERE workerId = ? ORDER BY weekday, startTime', [workerId]);
}

export function getAvailability(workerId) {
  return all('SELECT * FROM Availability WHERE workerId = ? ORDER BY weekday, startTime', [workerId]);
}

/** Shifts of the week (Mon–Sun) with worker names, attendance and the open request flag. */
export function getWeekShifts(weekStart) {
  return all(
    `SELECT s.*, w.name AS workerName, o.name AS originalWorkerName,
       a.clockIn, a.clockOut, a.confirmed,
       (SELECT r.id FROM SubRequest r WHERE r.shiftId = s.id AND r.status IN ('REQUESTED','ACCEPTED')) AS openRequestId
     FROM Shift s JOIN Worker w ON w.id = s.workerId
     LEFT JOIN Worker o ON o.id = s.originalWorkerId
     LEFT JOIN Attendance a ON a.shiftId = s.id
     WHERE s.workDate BETWEEN ? AND ? ORDER BY s.workDate, s.startTime, w.name`,
    [weekStart, addDays(weekStart, 6)]);
}

/** Future SCHEDULED shifts of a worker that have no open request (candidates for UC-04). */
export function listRequestableShifts(workerId) {
  const t = now();
  return all(
    `SELECT s.* FROM Shift s WHERE s.workerId = ? AND s.status = 'SCHEDULED'
       AND NOT EXISTS (SELECT 1 FROM SubRequest r WHERE r.shiftId = s.id AND r.status IN ('REQUESTED','ACCEPTED'))
     ORDER BY s.workDate, s.startTime`, [workerId])
    .filter((s) => `${s.workDate}T${s.startTime}` > t);
}

function targetsOf(requestId) {
  return all(
    `SELECT t.*, w.name AS workerName FROM SubRequestTarget t JOIN Worker w ON w.id = t.workerId
     WHERE t.subRequestId = ? ORDER BY t.id`, [requestId]);
}

const REQUEST_SELECT = `
  SELECT r.*, s.workDate, s.startTime, s.endTime, rq.name AS requesterName, ac.name AS acceptorName
  FROM SubRequest r JOIN Shift s ON s.id = r.shiftId
  JOIN Worker rq ON rq.id = r.requesterId LEFT JOIN Worker ac ON ac.id = r.acceptorId`;

/** UC-12: the worker's own requests, newest first. */
export function listMyRequests(workerId) {
  return all(`${REQUEST_SELECT} WHERE r.requesterId = ? ORDER BY r.createdAt DESC, r.id DESC`, [workerId])
    .map((r) => ({ ...r, targets: targetsOf(r.id) }));
}

/** UC-06: requests the owner acts on (ACCEPTED) and open ones shown read-only (REQUESTED). */
export function listOwnerRequests() {
  const rows = all(`${REQUEST_SELECT} WHERE r.status IN ('ACCEPTED','REQUESTED') ORDER BY s.workDate, s.startTime`);
  return rows.map((r) => ({ ...r, targets: targetsOf(r.id) }));
}

function weekShiftsFor(workerId, weekStart) {
  return all(
    `SELECT s.*, a.clockIn, a.clockOut FROM Shift s LEFT JOIN Attendance a ON a.shiftId = s.id
     WHERE s.workDate BETWEEN ? AND ? AND (s.workerId = ? OR s.originalWorkerId = ?)`,
    [weekStart, addDays(weekStart, 6), workerId, workerId]);
}

function summaryFor(workerId, weekStart, shifts, policy) {
  return computeWeeklySummary({
    workerId,
    weekStart,
    contractHours: contractHours(getFixedSchedules(workerId)),
    shifts,
    policy,
  });
}

/** BR-07: holiday pay of a weekly summary in won, rounded down. */
function holidayPayOf(summary, workerId) {
  const w = getWorker(workerId);
  return Math.floor(round2(summary.holidayHours * (w.hourlyWage || 0)));
}

/**
 * FR-11 / NFR-13: the effect of handing `shiftId` from its current worker to `acceptorId` on the week of the
 * shift, for both people: summary before and after, holiday pay before and after, and whether eligibility changes.
 */
function swapEffect(shiftId, acceptorId) {
  const target = get('SELECT s.*, a.clockIn, a.clockOut FROM Shift s LEFT JOIN Attendance a ON a.shiftId = s.id WHERE s.id = ?', [shiftId]);
  const weekStart = weekStartOf(target.workDate);
  const policy = getWorkplace().subAttendancePolicy;
  const people = [
    { role: 'requester', id: target.workerId },
    { role: 'acceptor', id: acceptorId },
  ];
  return {
    weekStart,
    rows: people.map(({ role, id }) => {
      const before = weekShiftsFor(id, weekStart);
      const after = before.filter((s) => s.id !== shiftId);
      after.push({ ...target, workerId: acceptorId, originalWorkerId: target.originalWorkerId ?? target.workerId });
      const b = summaryFor(id, weekStart, before, policy);
      const a = summaryFor(id, weekStart, after, policy);
      return {
        role,
        workerId: id,
        name: workerName(id),
        before: { ...b, holidayPay: holidayPayOf(b, id) },
        after: { ...a, holidayPay: holidayPayOf(a, id) },
        eligibilityChanged: b.holidayEligible !== a.holidayEligible,
      };
    }),
  };
}

/**
 * FR-11: before/after comparison for the requester and the acceptor of an ACCEPTED request.
 */
export function getApprovalPreview(requestId) {
  const r = requestWithShift(requestId);
  if (!r.acceptorId) throw new ServiceError('NOT_ACCEPTED', 'No one has accepted this request yet, so there is nothing to compare.');
  return { request: r, ...swapEffect(r.shiftId, r.acceptorId) };
}

/** BR-01: the workers who are eligible for `shift` right now (used on creation and for the review step of the flow). */
function eligibleCandidates(shift, requesterId) {
  return all("SELECT * FROM Worker WHERE role = 'WORKER' ORDER BY id").filter((w) => isEligibleCandidate({
    worker: w,
    requesterId,
    shift,
    workerShifts: all('SELECT * FROM Shift WHERE workerId = ? AND workDate = ?', [w.id, shift.workDate]),
    availability: getAvailability(w.id),
  }));
}

/** UC-04 review step: who would receive a request for this shift if it were sent now (names only). */
export function previewCandidates(shiftId, requesterId) {
  const shift = get('SELECT * FROM Shift WHERE id = ?', [shiftId]);
  if (!shift) throw new ServiceError('SHIFT_NOT_FOUND', 'This shift no longer exists. Reload the page.');
  return eligibleCandidates(shift, requesterId).map((w) => ({ id: w.id, name: w.name }));
}

/** UC-03 detail: one shift with names, attendance, the open request and its substitution history. */
export function getShiftDetail(shiftId) {
  const s = get(
    `SELECT s.*, w.name AS workerName, o.name AS originalWorkerName, a.clockIn, a.clockOut, a.confirmed,
       (SELECT r.id FROM SubRequest r WHERE r.shiftId = s.id AND r.status IN ('REQUESTED','ACCEPTED')) AS openRequestId
     FROM Shift s JOIN Worker w ON w.id = s.workerId LEFT JOIN Worker o ON o.id = s.originalWorkerId
     LEFT JOIN Attendance a ON a.shiftId = s.id WHERE s.id = ?`, [shiftId]);
  if (!s) throw new ServiceError('SHIFT_NOT_FOUND', 'This shift no longer exists. Reload the page.');
  const history = all(`${REQUEST_SELECT} WHERE r.shiftId = ? ORDER BY r.createdAt, r.id`, [shiftId]);
  const inUse = history.length + get('SELECT count(*) AS n FROM Attendance WHERE shiftId = ?', [shiftId]).n > 0;
  return { ...s, history, canDelete: !inUse };
}

/** Holiday pay a worker gets for a week, with the summary it is based on (stored summaries are not needed). */
function weekStatus(workerId, weekStart, policy) {
  const summary = summaryFor(workerId, weekStart, weekShiftsFor(workerId, weekStart), policy);
  return { ...summary, holidayPay: holidayPayOf(summary, workerId) };
}

/**
 * Worker Home (NFR-13, prompt §2.3): everything waiting for this worker, in one call.
 * - incoming: PENDING targets of REQUESTED requests, with the effect of accepting on this worker's week;
 * - taken: requests this worker was asked for that someone else accepted and the owner has not decided yet;
 * - myOpen: the worker's own REQUESTED / ACCEPTED requests with their candidates' answers;
 * - nextShift: the next own future SCHEDULED shift; week: this week's hours and holiday allowance;
 * - toRecord: own shifts that have started but have no attendance record yet.
 */
export function getWorkerHome(workerId) {
  const t = now();
  const today = t.slice(0, 10);
  const worker = getWorker(workerId);
  const policy = getWorkplace().subAttendancePolicy;
  const targets = all(
    `SELECT t.response, r.id AS requestId FROM SubRequestTarget t JOIN SubRequest r ON r.id = t.subRequestId
     WHERE t.workerId = ? ORDER BY r.deadline, r.id`, [workerId]);
  const incoming = [];
  const taken = [];
  for (const tg of targets) {
    const r = get(`${REQUEST_SELECT} WHERE r.id = ?`, [tg.requestId]);
    if (r.status === 'REQUESTED' && tg.response === 'PENDING') {
      const effect = swapEffect(r.shiftId, workerId).rows.find((x) => x.role === 'acceptor');
      incoming.push({ ...r, effect });
    } else if (r.status === 'ACCEPTED' && r.acceptorId !== workerId && tg.response === 'CLOSED') {
      taken.push(r);
    }
  }
  const myOpen = all(`${REQUEST_SELECT} WHERE r.requesterId = ? AND r.status IN ('REQUESTED','ACCEPTED') ORDER BY s.workDate, s.startTime`, [workerId])
    .map((r) => ({ ...r, targets: targetsOf(r.id) }));
  const own = all(
    `SELECT s.*, a.clockIn, a.clockOut,
       (SELECT r.id FROM SubRequest r WHERE r.shiftId = s.id AND r.status IN ('REQUESTED','ACCEPTED')) AS openRequestId
     FROM Shift s LEFT JOIN Attendance a ON a.shiftId = s.id
     WHERE s.workerId = ? ORDER BY s.workDate, s.startTime`, [workerId]);
  const nextShift = own.find((s) => s.status === 'SCHEDULED' && `${s.workDate}T${s.startTime}` > t) || null;
  const toRecord = own.filter((s) => s.status === 'SCHEDULED' && !s.clockIn && `${s.workDate}T${s.startTime}` <= t);
  const weekStart = weekStartOf(today);
  return {
    worker: { id: worker.id, name: worker.name },
    today,
    incoming,
    taken,
    myOpen,
    nextShift,
    week: { weekStart, ...weekStatus(workerId, weekStart, policy) },
    toRecord,
  };
}

/**
 * Owner Home (NFR-13, prompt §2.5): decisions and checks waiting for the owner, in one call.
 * - decisions: ACCEPTED requests with the before/after effect for requester and acceptor;
 * - open: REQUESTED requests with their candidates' answers;
 * - toConfirm: recorded, unconfirmed attendance; payWarnings: unacknowledged minimum-wage warnings of DRAFT payrolls;
 * - today: today's shifts; week: this week's shifts, hours and the estimated holiday-allowance total.
 * `taskCount` counts the items only the owner can act on (decisions, attendance, pay warnings).
 */
export function getOwnerHome() {
  const t = now();
  const today = t.slice(0, 10);
  const policy = getWorkplace().subAttendancePolicy;
  const requests = listOwnerRequests();
  const decisions = requests.filter((r) => r.status === 'ACCEPTED')
    .map((r) => ({ ...r, ...swapEffect(r.shiftId, r.acceptorId) }));
  const open = requests.filter((r) => r.status === 'REQUESTED');
  const toConfirm = all(
    `SELECT s.*, w.name AS workerName, a.clockIn, a.clockOut FROM Shift s JOIN Worker w ON w.id = s.workerId
     JOIN Attendance a ON a.shiftId = s.id WHERE a.confirmed = 0 AND s.status = 'SCHEDULED' ORDER BY s.workDate, s.startTime`);
  const payWarnings = all(
    `SELECT p.*, w.name AS workerName, w.hourlyWage FROM Payroll p JOIN Worker w ON w.id = p.workerId
     WHERE p.status = 'DRAFT' AND p.minWageWarning = 1 AND p.minWageAck = 0 ORDER BY p.yearMonth, w.id`);
  const weekStart = weekStartOf(today);
  const weekShifts = getWeekShifts(weekStart);
  const people = [...new Set(weekShifts.flatMap((s) => [s.workerId, s.originalWorkerId]).filter(Boolean))];
  const holidayTotal = people.reduce((sum, id) => sum + weekStatus(id, weekStart, policy).holidayPay, 0);
  return {
    today,
    decisions,
    open,
    toConfirm,
    payWarnings,
    taskCount: decisions.length + toConfirm.length + payWarnings.length,
    todayShifts: weekShifts.filter((s) => s.workDate === today),
    week: {
      weekStart,
      shifts: weekShifts.length,
      hours: round2(weekShifts.reduce((sum, s) => sum + durationHours(s.startTime, s.endTime), 0)),
      holidayTotal,
    },
  };
}

/** UC-07: shifts of a week with attendance; a worker sees only their own shifts. */
export function listAttendance(weekStart, viewer) {
  const rows = getWeekShifts(weekStart);
  return viewer && viewer.role === 'WORKER' ? rows.filter((s) => s.workerId === viewer.id) : rows;
}

export function getPayroll(yearMonth) {
  return all(
    `SELECT p.*, w.name AS workerName, w.hourlyWage FROM Payroll p JOIN Worker w ON w.id = p.workerId
     WHERE p.yearMonth = ? ORDER BY w.id`, [yearMonth]);
}

export function unreadCount(workerId) {
  return get('SELECT count(*) AS n FROM Notification WHERE workerId = ? AND readAt IS NULL', [workerId]).n;
}

// ---- UC-01 Register worker and fixed schedule -----------------------------

/** UC-01 / FR-01: insert a worker, or update one when data.id is given. Returns the worker id. */
export function registerWorker(data) {
  return tx(() => {
    const name = (data.name || '').trim();
    if (!name) throw new ServiceError('NAME_REQUIRED', 'Enter the worker\'s name.');
    const wage = Number(data.hourlyWage);
    if (!Number.isInteger(wage) || wage <= 0) throw new ServiceError('WAGE_INVALID', 'Enter the hourly wage as a whole number of won, for example 10320.');
    if (!DATE.test(data.contractStart || '')) throw new ServiceError('CONTRACT_START_REQUIRED', 'Enter the contract start date.');
    const contractEnd = data.contractEnd || null;
    if (contractEnd && contractEnd < data.contractStart) throw new ServiceError('CONTRACT_END_BEFORE_START', 'The contract end date is before the start date. Change one of the two dates.');
    const probationEnd = data.probationEnd || null;
    if (probationEnd && probationEnd < data.contractStart) throw new ServiceError('PROBATION_BEFORE_START', 'The probation end date is before the contract start date. Change it or leave it empty.');
    const phone = (data.phone || '').trim() || null;
    const values = [name, phone, wage, data.contractStart, contractEnd, probationEnd, data.simpleLabor ? 1 : 0, data.active === false || data.active === 0 ? 0 : 1];
    if (data.id) {
      run(`UPDATE Worker SET name = ?, phone = ?, hourlyWage = ?, contractStart = ?, contractEnd = ?, probationEnd = ?,
           simpleLabor = ?, active = ? WHERE id = ? AND role = 'WORKER'`, [...values, data.id]);
      return data.id;
    }
    const wp = getWorkplace();
    return run(`INSERT INTO Worker (workplaceId, role, name, phone, hourlyWage, contractStart, contractEnd, probationEnd, simpleLabor, active)
                VALUES (?, 'WORKER', ?, ?, ?, ?, ?, ?, ?, ?)`, [wp.id, ...values]).id;
  });
}

/**
 * UC-01 / FR-02: replace the worker's fixed weekly shifts with `slots` ({id?, weekday, startTime, endTime}).
 * Slots of the same worker must not overlap on the same weekday.
 */
export function saveFixedSchedule(workerId, slots) {
  return tx(() => {
    validateSlots(slots);
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i];
        const b = slots[j];
        if (a.weekday === b.weekday && overlaps(a.startTime, a.endTime, b.startTime, b.endTime)) {
          throw new ServiceError('FIXED_OVERLAP', `Two fixed shifts on ${DAY_NAMES[a.weekday]} overlap (${a.startTime}–${a.endTime} and ${b.startTime}–${b.endTime}). Change one of the times.`,
            { day: a.weekday, a: `${a.startTime}–${a.endTime}`, b: `${b.startTime}–${b.endTime}` });
        }
      }
    }
    const keep = slots.filter((s) => s.id).map((s) => s.id);
    for (const old of getFixedSchedules(workerId)) {
      if (!keep.includes(old.id)) {
        run('UPDATE Shift SET fixedScheduleId = NULL WHERE fixedScheduleId = ?', [old.id]);
        run('DELETE FROM FixedSchedule WHERE id = ?', [old.id]);
      }
    }
    for (const s of slots) {
      if (s.id) run('UPDATE FixedSchedule SET weekday = ?, startTime = ?, endTime = ? WHERE id = ? AND workerId = ?', [s.weekday, s.startTime, s.endTime, s.id, workerId]);
      else run('INSERT INTO FixedSchedule (workerId, weekday, startTime, endTime) VALUES (?, ?, ?, ?)', [workerId, s.weekday, s.startTime, s.endTime]);
    }
    return getFixedSchedules(workerId);
  });
}

function validateSlots(slots) {
  for (const s of slots) {
    if (!(s.weekday >= 1 && s.weekday <= 7)) throw new ServiceError('WEEKDAY_INVALID', 'Choose a weekday for every row.');
    checkTimes(s.startTime, s.endTime);
    if (s.startTime === s.endTime) throw new ServiceError('TIME_EMPTY', 'Start and end time are the same. Enter a later end time.');
  }
}

// ---- UC-02 Register availability -----------------------------------------

/** UC-02 / FR-03: replace the worker's availability slots. An availability slot must end after it starts. */
export function saveAvailability(workerId, slots) {
  return tx(() => {
    validateSlots(slots);
    for (const s of slots) {
      if (s.endTime <= s.startTime) throw new ServiceError('AVAIL_END_BEFORE_START', `The slot ${s.startTime}–${s.endTime} ends before it starts. Availability must end on the same day; enter a later end time.`, { range: `${s.startTime}–${s.endTime}` });
    }
    run('DELETE FROM Availability WHERE workerId = ?', [workerId]);
    for (const s of slots) run('INSERT INTO Availability (workerId, weekday, startTime, endTime) VALUES (?, ?, ?, ?)', [workerId, s.weekday, s.startTime, s.endTime]);
    return getAvailability(workerId);
  });
}

// ---- UC-03 Generate weekly schedule ---------------------------------------

/** UC-03 / FR-04: create the week's shifts from all active fixed schedules; existing ones are not duplicated. */
export function generateWeek(weekStart) {
  return tx(() => {
    const monday = weekStartOf(weekStart);
    const schedules = all(
      `SELECT f.* FROM FixedSchedule f JOIN Worker w ON w.id = f.workerId
       WHERE w.active = 1 AND w.role = 'WORKER' ORDER BY f.id`);
    const sunday = addDays(monday, 6);
    let created = 0;
    for (const f of schedules) {
      const date = addDays(monday, f.weekday - 1);
      // Skip a slot that already produced a shift this week (possibly moved to another day) or that
      // would overlap a shift the worker already has that day (a moved or re-created fixed slot).
      if (get('SELECT id FROM Shift WHERE fixedScheduleId = ? AND workDate BETWEEN ? AND ?', [f.id, monday, sunday])) continue;
      const clash = all('SELECT * FROM Shift WHERE workerId = ? AND workDate = ?', [f.workerId, date])
        .some((s) => overlaps(s.startTime, s.endTime, f.startTime, f.endTime));
      if (clash) continue;
      run('INSERT INTO Shift (workDate, startTime, endTime, workerId, fixedScheduleId) VALUES (?, ?, ?, ?, ?)',
        [date, f.startTime, f.endTime, f.workerId, f.id]);
      created++;
    }
    return { weekStart: monday, created };
  });
}

/**
 * UC-03 / FR-05: add (shiftId = null), move (changes = {workDate, startTime, endTime, workerId}) or
 * delete (changes = {delete: true}) a single shift.
 */
export function editShift(shiftId, changes) {
  return tx(() => {
    const existing = shiftId ? get('SELECT * FROM Shift WHERE id = ?', [shiftId]) : null;
    if (shiftId && !existing) throw new ServiceError('SHIFT_NOT_FOUND', 'This shift no longer exists. Reload the page.');
    if (changes.delete) {
      const used = get('SELECT count(*) AS n FROM SubRequest WHERE shiftId = ?', [shiftId]).n
        + get('SELECT count(*) AS n FROM Attendance WHERE shiftId = ?', [shiftId]).n;
      if (used) throw new ServiceError('SHIFT_IN_USE', 'This shift has a substitute request or an attendance record, so it cannot be deleted. Change its time or worker instead.');
      run('DELETE FROM Shift WHERE id = ?', [shiftId]);
      return null;
    }
    const next = { ...(existing || {}), ...changes };
    if (existing && (next.workDate !== existing.workDate || next.startTime !== existing.startTime
      || next.endTime !== existing.endTime || Number(next.workerId) !== existing.workerId)
      && get("SELECT id FROM SubRequest WHERE shiftId = ? AND status IN ('REQUESTED','ACCEPTED')", [shiftId])) {
      throw new ServiceError('SHIFT_OPEN_REQUEST', 'This shift has an open substitute request. Wait until it is decided, or ask the worker to cancel it, before changing the worker, date or time.');
    }
    if (!DATE.test(next.workDate || '')) throw new ServiceError('DATE_INVALID', 'Choose the date of the shift.');
    checkTimes(next.startTime, next.endTime);
    if (next.startTime === next.endTime) throw new ServiceError('TIME_EMPTY', 'Start and end time are the same. Enter a later end time.');
    const worker = get("SELECT * FROM Worker WHERE id = ? AND role = 'WORKER'", [Number(next.workerId)]);
    if (!worker || !worker.active) throw new ServiceError('WORKER_INVALID', 'Choose an active worker for the shift.');
    const clash = all('SELECT * FROM Shift WHERE workerId = ? AND workDate = ? AND id IS NOT ?', [worker.id, next.workDate, shiftId || null])
      .find((s) => overlaps(s.startTime, s.endTime, next.startTime, next.endTime));
    if (clash) {
      throw new ServiceError('SHIFT_OVERLAP', `${worker.name} already works ${clash.startTime}–${clash.endTime} that day. Choose another time or worker.`,
        { name: worker.name, range: `${clash.startTime}–${clash.endTime}` });
    }
    if (existing) {
      run('UPDATE Shift SET workDate = ?, startTime = ?, endTime = ?, workerId = ? WHERE id = ?',
        [next.workDate, next.startTime, next.endTime, worker.id, shiftId]);
      return shiftId;
    }
    return run('INSERT INTO Shift (workDate, startTime, endTime, workerId) VALUES (?, ?, ?, ?)',
      [next.workDate, next.startTime, next.endTime, worker.id]).id;
  });
}

// ---- UC-04 Request substitute ---------------------------------------------

/** Default response deadline: the earlier of now + 24 h and the shift start. */
export function defaultDeadline(shift) {
  const plus24 = addMinutes(now(), 24 * 60);
  const start = `${shift.workDate}T${shift.startTime}`;
  return plus24 < start ? plus24 : start;
}

/**
 * UC-04 / FR-06–FR-08: validate (BR-03), find eligible candidates (BR-01), create one target and one
 * REQUEST_RECEIVED notification per candidate, or a NO_CANDIDATE notification to the owner.
 * @returns {{id:number, candidates:Array<{id:number,name:string}>}}
 */
export function createSubRequest({ shiftId, requesterId, reason = '', deadline }) {
  return tx(() => {
    const shift = get('SELECT * FROM Shift WHERE id = ?', [shiftId]);
    if (!shift) throw new ServiceError('SHIFT_NOT_FOUND', 'This shift no longer exists. Reload the page.');
    const openRequests = get("SELECT count(*) AS n FROM SubRequest WHERE shiftId = ? AND status IN ('REQUESTED','ACCEPTED')", [shiftId]).n;
    const errors = validateRequest({ shift, requesterId, now: now(), deadline, openRequests });
    if (errors.length) throw requestError(errors[0], shift);

    const t = now();
    const id = run("INSERT INTO SubRequest (shiftId, requesterId, reason, deadline, status, createdAt) VALUES (?, ?, ?, ?, 'REQUESTED', ?)",
      [shiftId, requesterId, (reason || '').trim() || null, deadline, t]).id;
    const requester = workerName(requesterId);
    const candidates = eligibleCandidates(shift, requesterId);
    const label = shiftLabel(shift);
    for (const c of candidates) {
      run("INSERT INTO SubRequestTarget (subRequestId, workerId, response) VALUES (?, ?, 'PENDING')", [id, c.id]);
      notify(c.id, id, 'REQUEST_RECEIVED', `${requester} asks for a substitute on ${label}. Reply by ${deadline.replace('T', ' ')}.`);
    }
    if (!candidates.length) {
      notify(ownerId(), id, 'NO_CANDIDATE', `No worker is available for ${requester}'s shift on ${label}. Contact workers directly or change the shift.`);
    }
    return { id, candidates: candidates.map((c) => ({ id: c.id, name: c.name })) };
  });
}

const REQUEST_ERRORS = {
  NOT_OWN_SHIFT: 'You can only request a substitute for your own shift.',
  NOT_SCHEDULED: 'This shift is already closed (worked or absent), so it cannot be handed over.',
  SHIFT_STARTED: 'This shift has already started. Talk to the owner directly.',
  OPEN_REQUEST_EXISTS: 'This shift already has an open request. Cancel it first if you want to change it.',
  DEADLINE_INVALID: 'Enter the response deadline as a date and time.',
  DEADLINE_NOT_FUTURE: 'The deadline has already passed. Choose a later time.',
  DEADLINE_AFTER_START: 'The deadline is after the shift starts. Choose a time no later than the shift start.',
};

function requestError(code, shift) {
  return new ServiceError(code, REQUEST_ERRORS[code], { start: `${shift.workDate} ${shift.startTime}` });
}

// ---- UC-05 Respond to substitute request ----------------------------------

/**
 * UC-05 / FR-09, FR-10, BR-02: a candidate accepts or declines. The request state is re-read inside
 * the transaction, so only the first acceptance can succeed.
 * @param {'ACCEPTED'|'DECLINED'} response
 */
export function respondToRequest(requestId, workerId, response) {
  return throwIfExpired(tx(() => {
    const r = requestWithShift(requestId);
    const target = get('SELECT * FROM SubRequestTarget WHERE subRequestId = ? AND workerId = ?', [requestId, workerId]);
    if (!target) throw new ServiceError('NOT_A_CANDIDATE', 'You were not asked to cover this shift.');
    if (['REQUESTED', 'ACCEPTED'].includes(r.status) && isOverdue(r, now())) return expireRequest(r, now());
    if (r.status !== 'REQUESTED' || target.response !== 'PENDING') {
      if (r.acceptorId && r.acceptorId !== workerId) {
        const name = workerName(r.acceptorId);
        throw new ServiceError('ALREADY_TAKEN', `Already taken by ${name}. No action is needed from you.`, { name });
      }
      throw new ServiceError('REQUEST_CLOSED', `This request is ${r.status.toLowerCase()} and can no longer be answered.`, { status: r.status });
    }
    const t = now();
    if (response === 'DECLINED') {
      run("UPDATE SubRequestTarget SET response = 'DECLINED', respondedAt = ? WHERE id = ?", [t, target.id]);
      return { status: r.status };
    }
    if (response !== 'ACCEPTED') throw new ServiceError('RESPONSE_INVALID', 'Choose accept or decline.');
    const clash = acceptorClash(r, workerId);
    if (clash) throw acceptorBusyError(workerId, clash);
    const updated = run("UPDATE SubRequest SET status = 'ACCEPTED', acceptorId = ? WHERE id = ? AND status = 'REQUESTED'", [workerId, requestId]);
    if (updated.changes !== 1) throw new ServiceError('ALREADY_TAKEN', 'Someone else accepted first.', { name: '' });
    run("UPDATE SubRequestTarget SET response = 'ACCEPTED', respondedAt = ? WHERE id = ?", [t, target.id]);
    const name = workerName(workerId);
    const label = shiftLabel(r);
    for (const other of all("SELECT * FROM SubRequestTarget WHERE subRequestId = ? AND response = 'PENDING'", [requestId])) {
      run("UPDATE SubRequestTarget SET response = 'CLOSED', respondedAt = ? WHERE id = ?", [t, other.id]);
      notify(other.workerId, requestId, 'TARGET_CLOSED', `Already taken by ${name}: ${label}.`);
    }
    const msg = `${name} accepted to cover ${workerName(r.requesterId)}'s shift on ${label}. Waiting for the owner's approval.`;
    notify(r.requesterId, requestId, 'REQUEST_ACCEPTED', msg);
    notify(ownerId(), requestId, 'REQUEST_ACCEPTED', msg);
    return { status: 'ACCEPTED' };
  }));
}

// ---- UC-06 Approve or reject substitution --------------------------------

/**
 * UC-06 / FR-12, BR-04: approve (reassign the shift, keep the original worker, recompute both
 * weekly summaries) or reject an ACCEPTED request; both workers are notified.
 * @param {'APPROVED'|'REJECTED'} decision
 */
export function decideRequest(requestId, decision) {
  return throwIfExpired(tx(() => {
    const r = requestWithShift(requestId);
    if (['REQUESTED', 'ACCEPTED'].includes(r.status) && isOverdue(r, now())) return expireRequest(r, now());
    if (r.status !== 'ACCEPTED') {
      throw new ServiceError('NOT_ACCEPTED', `Only an accepted request can be approved or rejected; this one is ${r.status.toLowerCase()}.`, { status: r.status });
    }
    const t = now();
    const label = shiftLabel(r);
    const acceptor = workerName(r.acceptorId);
    const requester = workerName(r.requesterId);
    if (decision === 'APPROVED') {
      const clash = acceptorClash(r, r.acceptorId);
      if (clash) throw acceptorBusyError(r.acceptorId, clash);
      run('UPDATE Shift SET workerId = ?, originalWorkerId = COALESCE(originalWorkerId, ?) WHERE id = ?', [r.acceptorId, r.shiftWorkerId, r.shiftId]);
      run("UPDATE SubRequest SET status = 'APPROVED', decidedAt = ? WHERE id = ?", [t, requestId]);
      recomputeWeek(weekStartOf(r.workDate), [r.requesterId, r.acceptorId]);
      const msg = `The owner approved the swap: ${acceptor} works ${label} instead of ${requester}.`;
      notify(r.requesterId, requestId, 'REQUEST_APPROVED', msg);
      notify(r.acceptorId, requestId, 'REQUEST_APPROVED', msg);
    } else if (decision === 'REJECTED') {
      run("UPDATE SubRequest SET status = 'REJECTED', decidedAt = ? WHERE id = ?", [t, requestId]);
      const msg = `The owner rejected the swap for ${label}. ${requester} keeps the shift.`;
      notify(r.requesterId, requestId, 'REQUEST_REJECTED', msg);
      notify(r.acceptorId, requestId, 'REQUEST_REJECTED', msg);
    } else {
      throw new ServiceError('DECISION_INVALID', 'Choose approve or reject.');
    }
    return { status: decision };
  }));
}

// ---- UC-12 Cancel own substitute request ----------------------------------

/** UC-12 / FR-19: the requester cancels a REQUESTED or ACCEPTED request; every target is closed and notified. */
export function cancelRequest(requestId, requesterId) {
  return tx(() => {
    const r = requestWithShift(requestId);
    if (r.requesterId !== requesterId) throw new ServiceError('NOT_REQUESTER', 'Only the worker who asked for the substitute can cancel the request.');
    if (!['REQUESTED', 'ACCEPTED'].includes(r.status)) {
      throw new ServiceError('REQUEST_CLOSED', `This request is ${r.status.toLowerCase()} and can no longer be cancelled.`, { status: r.status });
    }
    const t = now();
    run("UPDATE SubRequest SET status = 'CANCELLED', decidedAt = ? WHERE id = ?", [t, requestId]);
    const label = shiftLabel(r);
    for (const target of targetsOf(requestId)) {
      if (target.response === 'PENDING') run("UPDATE SubRequestTarget SET response = 'CLOSED', respondedAt = ? WHERE id = ?", [t, target.id]);
      if (target.response === 'PENDING' || target.response === 'ACCEPTED') {
        notify(target.workerId, requestId, 'REQUEST_CANCELLED', `${workerName(r.requesterId)} cancelled the substitute request for ${label}.`);
      }
    }
    return { status: 'CANCELLED' };
  });
}

// ---- UC-11 Expire overdue substitute request ------------------------------

/** UC-11 / FR-18, BR-12: requests still open at their deadline or shift start become EXPIRED. */
export function expireOverdue() {
  return tx(() => {
    const t = now();
    const open = all(
      `SELECT r.*, s.workDate, s.startTime, s.endTime FROM SubRequest r JOIN Shift s ON s.id = r.shiftId
       WHERE r.status IN ('REQUESTED','ACCEPTED')`);
    const overdue = open.filter((r) => isOverdue(r, t));
    for (const r of overdue) expireRequest(r, t);
    return overdue.length;
  });
}

const EXPIRED = Symbol('expired');

/** BR-12 / UC-11: mark one open request EXPIRED, close its pending targets silently, notify requester and owner. */
function expireRequest(r, t) {
  run("UPDATE SubRequest SET status = 'EXPIRED', decidedAt = ? WHERE id = ?", [t, r.id]);
  run("UPDATE SubRequestTarget SET response = 'CLOSED', respondedAt = ? WHERE subRequestId = ? AND response = 'PENDING'", [t, r.id]);
  const msg = `The substitute request for ${shiftLabel(r)} expired without an approved swap. ${workerName(r.requesterId)} keeps the shift.`;
  notify(r.requesterId, r.id, 'REQUEST_EXPIRED', msg);
  notify(ownerId(), r.id, 'REQUEST_EXPIRED', msg);
  return EXPIRED;
}

/**
 * BR-12: accept and approve expire an overdue request themselves. The expiry is committed first and the
 * REQUEST_CLOSED error is thrown afterwards, so throwing does not roll the expiry back.
 */
function throwIfExpired(result) {
  if (result === EXPIRED) {
    throw new ServiceError('REQUEST_CLOSED', 'This request expired at its deadline or when the shift started, so it can no longer be answered or decided.', { status: 'EXPIRED' });
  }
  return result;
}

// ---- UC-07 Record and confirm attendance ----------------------------------

/** UC-07 / FR-13: the worker records actual start and end of a past shift of their own. */
export function recordAttendance(shiftId, workerId, clockIn, clockOut) {
  return tx(() => {
    const s = get('SELECT * FROM Shift WHERE id = ?', [shiftId]);
    if (!s) throw new ServiceError('SHIFT_NOT_FOUND', 'This shift no longer exists. Reload the page.');
    if (s.workerId !== workerId) throw new ServiceError('NOT_OWN_SHIFT', 'You can only record attendance for your own shift.');
    if (`${s.workDate}T${s.startTime}` > now()) throw new ServiceError('SHIFT_NOT_STARTED', 'This shift has not started yet. Record it after you work it.');
    if (s.status !== 'SCHEDULED') throw new ServiceError('ATTENDANCE_CLOSED', 'The owner has already closed this shift, so the record cannot be changed.');
    checkTimes(clockIn, clockOut);
    if (clockIn === clockOut) throw new ServiceError('TIME_EMPTY', 'Start and end time are the same. Enter a later end time.');
    const existing = get('SELECT id FROM Attendance WHERE shiftId = ?', [shiftId]);
    if (existing) run('UPDATE Attendance SET clockIn = ?, clockOut = ?, confirmed = 0 WHERE id = ?', [clockIn, clockOut, existing.id]);
    else run('INSERT INTO Attendance (shiftId, clockIn, clockOut, confirmed) VALUES (?, ?, ?, 0)', [shiftId, clockIn, clockOut]);
    return { shiftId, hours: durationHours(clockIn, clockOut) };
  });
}

/** UC-07 / FR-13: the owner confirms a recorded attendance; the shift becomes WORKED. */
export function confirmAttendance(shiftId) {
  return tx(() => {
    const s = get('SELECT * FROM Shift WHERE id = ?', [shiftId]);
    const a = get('SELECT * FROM Attendance WHERE shiftId = ?', [shiftId]);
    if (!s) throw new ServiceError('SHIFT_NOT_FOUND', 'This shift no longer exists. Reload the page.');
    if (s.status !== 'SCHEDULED') throw new ServiceError('ATTENDANCE_CLOSED', `This shift is already ${s.status.toLowerCase()}, so its status cannot change again.`, { status: s.status });
    if (!a) throw new ServiceError('NO_ATTENDANCE', 'The worker has not recorded this shift yet. Ask them to record it, or mark the shift absent.');
    run('UPDATE Attendance SET confirmed = 1 WHERE id = ?', [a.id]);
    run("UPDATE Shift SET status = 'WORKED' WHERE id = ?", [shiftId]);
    recomputeWeek(weekStartOf(s.workDate), [s.workerId, s.originalWorkerId].filter(Boolean));
    return { status: 'WORKED' };
  });
}

/** UC-07 / FR-13: the owner marks a started shift ABSENT. */
export function markAbsent(shiftId) {
  return tx(() => {
    const s = get('SELECT * FROM Shift WHERE id = ?', [shiftId]);
    if (!s) throw new ServiceError('SHIFT_NOT_FOUND', 'This shift no longer exists. Reload the page.');
    if (s.status !== 'SCHEDULED') throw new ServiceError('ATTENDANCE_CLOSED', `This shift is already ${s.status.toLowerCase()}, so its status cannot change again.`, { status: s.status });
    if (`${s.workDate}T${s.startTime}` > now()) throw new ServiceError('SHIFT_NOT_STARTED', 'This shift has not started yet, so it cannot be marked absent.');
    run("UPDATE Shift SET status = 'ABSENT' WHERE id = ?", [shiftId]);
    run('UPDATE Attendance SET confirmed = 1 WHERE shiftId = ?', [shiftId]);
    recomputeWeek(weekStartOf(s.workDate), [s.workerId, s.originalWorkerId].filter(Boolean));
    return { status: 'ABSENT' };
  });
}

// ---- UC-08 Compute weekly hours and holiday allowance ----------------------

/**
 * UC-08 / FR-14: compute and store the WeeklySummary of each worker who has a shift in the week
 * (or only of `workerIds`). Returns the rows with the reasons for non-eligibility.
 * Spec §8: a worker without a shift (as current or original worker) in the week has no row; stale rows are deleted.
 */
export function recomputeWeek(weekStart, workerIds = null) {
  return tx(() => {
    const monday = weekStartOf(weekStart);
    const policy = getWorkplace().subAttendancePolicy;
    const ids = workerIds || all(
      `SELECT DISTINCT w.id FROM Worker w JOIN Shift s ON (s.workerId = w.id OR s.originalWorkerId = w.id)
       WHERE w.role = 'WORKER' AND s.workDate BETWEEN ? AND ? ORDER BY w.id`, [monday, addDays(monday, 6)]).map((r) => r.id);
    if (!workerIds) {
      run(`DELETE FROM WeeklySummary WHERE weekStart = ?${ids.length ? ` AND workerId NOT IN (${ids.map(() => '?').join(',')})` : ''}`, [monday, ...ids]);
    }
    const rows = [];
    for (const id of ids) {
      const shifts = weekShiftsFor(id, monday);
      if (!shifts.length) {
        run('DELETE FROM WeeklySummary WHERE workerId = ? AND weekStart = ?', [id, monday]);
        continue;
      }
      const s = summaryFor(id, monday, shifts, policy);
      run(`INSERT INTO WeeklySummary (workerId, weekStart, contractHours, scheduledHours, actualHours, perfectAttendance, holidayEligible, holidayHours)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (workerId, weekStart) DO UPDATE SET contractHours = excluded.contractHours, scheduledHours = excluded.scheduledHours,
             actualHours = excluded.actualHours, perfectAttendance = excluded.perfectAttendance,
             holidayEligible = excluded.holidayEligible, holidayHours = excluded.holidayHours`,
        [id, monday, s.contractHours, s.scheduledHours, s.actualHours, s.perfectAttendance ? 1 : 0, s.holidayEligible ? 1 : 0, s.holidayHours]);
      rows.push({ workerId: id, name: workerName(id), weekStart: monday, ...s });
    }
    return rows;
  });
}

// ---- UC-09 Generate and confirm monthly payroll ----------------------------

function monthDays(yearMonth) {
  const first = `${yearMonth}-01`;
  const [y, m] = yearMonth.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { first, last };
}

/** BR-10 is checked on the first day of the month, or on the contract start when the contract starts later. */
function payrollDate(worker, first) {
  return worker.contractStart && worker.contractStart > first ? worker.contractStart : first;
}

/**
 * UC-09 / FR-15, FR-16, BR-11: build the DRAFT payroll of a month for every worker with shifts in it.
 * CONFIRMED rows are kept; DRAFT rows are replaced, so a regenerated draft needs a new acknowledgement.
 */
export function generatePayroll(yearMonth) {
  return tx(() => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth || '')) throw new ServiceError('MONTH_INVALID', 'Choose a month.');
    const { first, last } = monthDays(yearMonth);
    const wp = getWorkplace();
    const minimumWages = all('SELECT * FROM MinimumWage');
    const minimumHourly = minimumWageFor(Number(yearMonth.slice(0, 4)), minimumWages);
    // Weeks whose Sunday falls in the month (BR-11).
    const weeks = [];
    for (let sunday = addDays(weekStartOf(first), 6); sunday <= last; sunday = addDays(sunday, 7)) {
      if (sunday >= first) weeks.push(addDays(sunday, -6));
    }
    for (const monday of weeks) recomputeWeek(monday);

    run("DELETE FROM Payroll WHERE yearMonth = ? AND status = 'DRAFT'", [yearMonth]);
    const workers = all("SELECT * FROM Worker WHERE role = 'WORKER' ORDER BY id");
    for (const w of workers) {
      if (get("SELECT id FROM Payroll WHERE workerId = ? AND yearMonth = ? AND status = 'CONFIRMED'", [w.id, yearMonth])) continue;
      const shifts = all(
        `SELECT s.*, a.clockIn, a.clockOut FROM Shift s LEFT JOIN Attendance a ON a.shiftId = s.id
         WHERE s.workerId = ? AND s.workDate BETWEEN ? AND ? AND s.status != 'ABSENT'`, [w.id, first, last])
        .map((s) => (s.status === 'WORKED' && s.clockIn
          ? { workDate: s.workDate, startTime: s.clockIn, endTime: s.clockOut, estimated: false }
          : { workDate: s.workDate, startTime: s.startTime, endTime: s.endTime, estimated: true }));
      const holidayWeeks = all(
        `SELECT holidayHours FROM WeeklySummary WHERE workerId = ? AND weekStart IN (${weeks.map(() => '?').join(',') || "''"})`,
        [w.id, ...weeks]).map((r) => r.holidayHours);
      if (!shifts.length && !holidayWeeks.some((h) => h > 0)) continue;
      const row = computePayrollRow({
        hourlyWage: w.hourlyWage,
        shifts,
        holidayWeeks,
        regularEmployees: wp.regularEmployees,
        minimumHourly,
        probation: probationApplies(w, payrollDate(w, first)),
      });
      run(`INSERT INTO Payroll (workerId, yearMonth, baseHours, basePay, holidayPay, premiumPay, total, minWageWarning, estimated, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')`,
        [w.id, yearMonth, row.baseHours, row.basePay, row.holidayPay, row.premiumPay, row.total, row.minWageWarning ? 1 : 0, row.estimated ? 1 : 0]);
    }
    return getPayroll(yearMonth).map((p) => ({ ...p, minimumHourly, probation: probationApplies(getWorker(p.workerId), payrollDate(getWorker(p.workerId), first)) }));
  });
}

/**
 * UC-09 / BR-09: the owner acknowledges the minimum-wage warning of one DRAFT row (Payroll.minWageAck = 1).
 */
export function acknowledgeMinWage(yearMonth, workerId) {
  return tx(() => {
    const row = get("SELECT * FROM Payroll WHERE yearMonth = ? AND workerId = ? AND status = 'DRAFT'", [yearMonth, workerId]);
    if (!row) throw new ServiceError('NO_DRAFT', 'There is no draft to confirm. Generate the draft first.');
    if (!row.minWageWarning) throw new ServiceError('NO_WARNING', 'This row has no minimum-wage warning to acknowledge.');
    run('UPDATE Payroll SET minWageAck = 1 WHERE id = ?', [row.id]);
    return { workerId, minWageAck: 1 };
  });
}

/**
 * UC-09 / FR-15, BR-09: confirm the month's DRAFT rows. Every row with a minimum-wage warning must be
 * acknowledged first (acknowledgeMinWage); confirmed rows are read-only.
 */
export function confirmPayroll(yearMonth) {
  return tx(() => {
    const drafts = all("SELECT * FROM Payroll WHERE yearMonth = ? AND status = 'DRAFT'", [yearMonth]);
    if (!drafts.length) throw new ServiceError('NO_DRAFT', 'There is no draft to confirm. Generate the draft first.');
    const open = drafts.filter((p) => p.minWageWarning && !p.minWageAck);
    if (open.length) {
      const names = open.map((p) => workerName(p.workerId)).join(', ');
      throw new ServiceError('MIN_WAGE_UNACKNOWLEDGED', `${names}: hourly wage is below the minimum wage. Select "Acknowledge" on the row after checking the wage, then confirm again.`, { names });
    }
    run("UPDATE Payroll SET status = 'CONFIRMED' WHERE yearMonth = ? AND status = 'DRAFT'", [yearMonth]);
    return { confirmed: drafts.length };
  });
}

// ---- UC-10 Manage workplace settings --------------------------------------

/** UC-10 / FR-17: store name, number of regular employees, substitution-attendance policy and minimum wage rows. */
export function updateSettings({ name, regularEmployees, subAttendancePolicy, minimumWages }) {
  return tx(() => {
    const store = (name || '').trim();
    if (!store) throw new ServiceError('STORE_NAME_REQUIRED', 'Enter the store name.');
    const n = Number(regularEmployees);
    if (!Number.isInteger(n) || n < 0) throw new ServiceError('EMPLOYEES_INVALID', 'Enter the number of regular employees as a whole number, for example 4.');
    if (!['EXCUSED', 'ABSENT'].includes(subAttendancePolicy)) throw new ServiceError('POLICY_INVALID', 'Choose a substitution-attendance policy.');
    const years = new Set();
    for (const r of minimumWages) {
      const y = Number(r.year);
      const h = Number(r.hourly);
      if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new ServiceError('MIN_YEAR_INVALID', 'Enter each minimum wage year as four digits, for example 2026.');
      if (!Number.isInteger(h) || h <= 0) throw new ServiceError('MIN_HOURLY_INVALID', `Enter the ${y} minimum wage as a whole number of won.`, { year: y });
      if (years.has(y)) throw new ServiceError('MIN_YEAR_DUPLICATE', `The year ${y} appears twice. Keep one row per year.`, { year: y });
      years.add(y);
    }
    run('UPDATE Workplace SET name = ?, regularEmployees = ?, subAttendancePolicy = ? WHERE id = ?', [store, n, subAttendancePolicy, getWorkplace().id]);
    run('DELETE FROM MinimumWage');
    for (const r of minimumWages) run('INSERT INTO MinimumWage (year, hourly) VALUES (?, ?)', [Number(r.year), Number(r.hourly)]);
    return getSettings();
  });
}

// ---- FR-21 Notifications --------------------------------------------------

/**
 * FR-21: the user's notifications newest first, with the unread count. REQUEST_RECEIVED items carry
 * the live state of the request so the inbox can show Accept / Decline or "Already taken by …".
 */
export function listNotifications(workerId) {
  return tx(() => {
    const items = all(
      `SELECT n.*, r.status AS requestStatus, r.acceptorId, ac.name AS acceptorName, t.response AS myResponse,
         s.workDate, s.startTime, s.endTime, rq.name AS requesterName, r.deadline, r.reason
       FROM Notification n
       LEFT JOIN SubRequest r ON r.id = n.subRequestId
       LEFT JOIN Shift s ON s.id = r.shiftId
       LEFT JOIN Worker rq ON rq.id = r.requesterId
       LEFT JOIN Worker ac ON ac.id = r.acceptorId
       LEFT JOIN SubRequestTarget t ON t.subRequestId = n.subRequestId AND t.workerId = n.workerId
       WHERE n.workerId = ? ORDER BY n.createdAt DESC, n.id DESC`, [workerId])
      .map((n) => ({ ...n, state: n.kind === 'REQUEST_RECEIVED' ? receivedState(n, workerId) : null }));
    return { items, unread: items.filter((n) => !n.readAt).length };
  });
}

function receivedState(n, workerId) {
  if (n.requestStatus === 'REQUESTED' && n.myResponse === 'PENDING') return 'OPEN';
  if (n.acceptorId === workerId) return 'ACCEPTED_BY_ME';
  if (n.myResponse === 'DECLINED') return 'DECLINED';
  if (n.acceptorId) return 'TAKEN';
  return n.requestStatus;
}

/** FR-21: mark all of the user's notifications as read. */
export function markNotificationsRead(workerId) {
  return tx(() => run('UPDATE Notification SET readAt = ? WHERE workerId = ? AND readAt IS NULL', [now(), workerId]).changes);
}

