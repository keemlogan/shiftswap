// Domain rules of ShiftSwap (spec §6). Pure functions only: no database, no DOM.
// Dates are 'YYYY-MM-DD', times 'HH:MM', datetimes 'YYYY-MM-DDTHH:MM'.

const DAY_MS = 86400000;

/** Minutes since midnight of an 'HH:MM' time. */
export function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Round to 2 decimals (hours are stored with 2 decimals). */
export function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

function parseDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function formatDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Add n days to an ISO date. */
export function addDays(date, n) {
  return formatDate(parseDate(date) + n * DAY_MS);
}

/** Whole days from date a to date b (b − a). */
export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
}

/** Add n calendar months to an ISO date (day clamped to the month length). */
export function addMonths(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return formatDate(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last)));
}

/** ISO weekday of a date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date) {
  const wd = new Date(parseDate(date)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/** Start and end of a shift on the minute axis of its work date; an end ≤ start means the next day. */
function span(start, end) {
  const s = toMinutes(start);
  let e = toMinutes(end);
  if (e <= s) e += 1440;
  return [s, e];
}

/**
 * BR-01: two time ranges [aStart, aEnd) and [bStart, bEnd) on the same date overlap.
 * An end time ≤ its start time is read as ending the next day.
 */
export function overlaps(aStart, aEnd, bStart, bEnd) {
  const [as, ae] = span(aStart, aEnd);
  const [bs, be] = span(bStart, bEnd);
  return as < be && bs < ae;
}

/** BR-06/BR-07/BR-11: hours between two times; end ≤ start means the shift ends the next day. */
export function durationHours(start, end) {
  const [s, e] = span(start, end);
  return round2((e - s) / 60);
}

/** BR-05: the Monday (ISO week start) of the week that contains the date. */
export function weekStartOf(date) {
  return addDays(date, 1 - isoWeekday(date));
}

/**
 * BR-01: worker W is eligible for a request on shift S (date d, start s, end e) iff W is an active WORKER,
 * W is not the requester and W has no shift on d overlapping [s, e). Availability is not used (spec §15).
 * `worker.role` may be omitted; when given it must be 'WORKER'.
 * @param {{worker:{id:number,active:number|boolean,role?:string}, requesterId:number,
 *   shift:{workDate:string,startTime:string,endTime:string},
 *   workerShifts:Array<{workDate:string,startTime:string,endTime:string}>}} input
 */
export function isEligibleCandidate({ worker, requesterId, shift, workerShifts }) {
  if (!worker.active) return false;
  if (worker.role && worker.role !== 'WORKER') return false;
  if (worker.id === requesterId) return false;
  return !workerShifts.some(
    (x) => x.workDate === shift.workDate && overlaps(x.startTime, x.endTime, shift.startTime, shift.endTime),
  );
}

/**
 * BR-13: a REQUESTED request has no taker left (and ends FAILED) when it has no target at all or every
 * target answered DECLINED.
 * @param {string[]} responses the SubRequestTarget.response values of the request
 */
export function hasNoTaker(responses) {
  return responses.every((r) => r === 'DECLINED');
}

/**
 * BR-03: request validity. Only the shift's current worker can request; the shift must be SCHEDULED
 * and start in the future; at most one open (REQUESTED/ACCEPTED) request per shift; the deadline must
 * be after now and no later than the shift start.
 * @returns {string[]} error codes, empty when the request is valid
 */
export function validateRequest({ shift, requesterId, now, deadline, openRequests }) {
  const errors = [];
  const shiftStart = `${shift.workDate}T${shift.startTime}`;
  if (shift.workerId !== requesterId) errors.push('NOT_OWN_SHIFT');
  if (shift.status !== 'SCHEDULED') errors.push('NOT_SCHEDULED');
  if (shiftStart <= now) errors.push('SHIFT_STARTED');
  if (openRequests > 0) errors.push('OPEN_REQUEST_EXISTS');
  if (!deadline || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(deadline)) errors.push('DEADLINE_INVALID');
  else {
    if (deadline <= now) errors.push('DEADLINE_NOT_FUTURE');
    if (deadline > shiftStart) errors.push('DEADLINE_AFTER_START');
  }
  return errors;
}

/** BR-06: weekly contractual hours = sum of the worker's fixed-schedule hours per week. */
export function contractHours(fixedSchedules) {
  return round2(fixedSchedules.reduce((sum, f) => sum + durationHours(f.startTime, f.endTime), 0));
}

/** BR-07: holiday-allowance hours = min(contractualHours, 40) / 40 × 8, rounded to 2 decimals. */
export function holidayHours(contractualHours) {
  return round2((Math.min(contractualHours, 40) / 40) * 8);
}

/**
 * BR-06/BR-07: weekly summary of worker W.
 * `shifts` are the week's shifts whose current worker or original worker is W; each has
 * workerId, originalWorkerId, workDate, startTime, endTime, status and optional clockIn/clockOut.
 * Perfect attendance: no shift originally W's and not given away is ABSENT; a shift W gave away by an
 * approved substitution breaks attendance only when policy = 'ABSENT'.
 * A SCHEDULED shift of a week that has not finished yet does not break attendance.
 * @returns {{contractHours:number, scheduledHours:number, actualHours:number, perfectAttendance:boolean,
 *   holidayEligible:boolean, holidayHours:number, reasons:Array<{code:string, date?:string}>}}
 */
export function computeWeeklySummary({ workerId, contractHours: contract, shifts, policy }) {
  let scheduled = 0;
  let actual = 0;
  const reasons = [];
  if (contract < 15) reasons.push({ code: 'CONTRACT_BELOW_15' });
  const sorted = [...shifts].sort((a, b) => (a.workDate + a.startTime).localeCompare(b.workDate + b.startTime));
  for (const s of sorted) {
    const original = s.originalWorkerId ?? s.workerId;
    if (s.workerId === workerId) {
      scheduled += durationHours(s.startTime, s.endTime);
      if (s.status === 'WORKED' && s.clockIn && s.clockOut) actual += durationHours(s.clockIn, s.clockOut);
    }
    if (original !== workerId) continue;
    if (s.workerId === workerId && s.status === 'ABSENT') reasons.push({ code: 'ABSENT', date: s.workDate });
    if (s.workerId !== workerId && policy === 'ABSENT') reasons.push({ code: 'GAVE_AWAY', date: s.workDate });
  }
  const perfectAttendance = !reasons.some((r) => r.code !== 'CONTRACT_BELOW_15');
  const holidayEligible = contract >= 15 && perfectAttendance;
  return {
    contractHours: round2(contract),
    scheduledHours: round2(scheduled),
    actualHours: round2(actual),
    perfectAttendance,
    holidayEligible,
    holidayHours: holidayEligible ? holidayHours(contract) : 0,
    reasons,
  };
}

/** Minutes of [s, e) that fall in the night windows 22:00–06:00 (e may exceed 1440). */
function nightMinutes(s, e) {
  const windows = [[-120, 360], [1320, 1800], [2760, 3240]];
  return windows.reduce((sum, [ws, we]) => sum + Math.max(0, Math.min(e, we) - Math.max(s, ws)), 0);
}

/** BR-08 (a): a worker with weekly contractual hours C (BR-06, the current fixed schedule) is part-time iff 0 < C < 40. */
export function isPartTime(contractHours) {
  return contractHours > 0 && contractHours < 40;
}

/**
 * BR-08: premium hours. Applies only if regularEmployees ≥ 5; then (i) daily hours beyond 8,
 * (ii) weekly hours beyond 40 not already counted in (i), (iii) night hours 22:00–06:00 and (iv) for a part-time
 * worker (rule (a), C = options.contractHours) the hours beyond C not already counted in (i) or (ii).
 * Night hours add to overtime hours. Each premium hour is paid +50 % of the wage.
 * (iv), system rules (b)–(e): the test is weekly against C (b); the hours of an ISO week are taken in chronological
 * order, a shift's hours on its work date, and every hour after the first C hours is beyond contract (c); an hour is
 * counted once, so a day's overtime is the larger of its hours beyond 8 and its hours beyond contract, and hours
 * counted in (ii) are not counted again (d); night hours are added separately (e).
 * In a monthly payroll `month` ('YYYY-MM') is the payroll month and `context` the worker's shifts of the same ISO
 * weeks on dates outside it: they only move where the first C hours end and are never paid (c). Without `month`,
 * `context` is ignored. (i)–(iii) use `shifts` only.
 * @param {Array<{workDate:string,startTime:string,endTime:string}>} shifts worked intervals
 * @param {number} regularEmployees
 * @param {{contractHours?:number, month?:string|null, context?:Array<{workDate:string,startTime:string,endTime:string}>}} [options]
 * @returns {{daily:number, weekly:number, night:number, partTime?:number, total:number}} `partTime` is (iv); a call
 *   without options returns the (i)–(iii) result without the `partTime` key, exactly as before iteration 8
 */
export function premiumHours(shifts, regularEmployees, options) {
  const { contractHours: contract = 0, month = null, context = [] } = options || {};
  const result = (daily, weekly, night, partTime) => ({
    daily: round2(daily),
    weekly: round2(weekly),
    night: round2(night),
    ...(options ? { partTime: round2(partTime) } : {}),
    total: round2(daily + weekly + night + partTime),
  });
  if (regularEmployees < 5) return result(0, 0, 0, 0);
  const byDay = new Map();
  let night = 0;
  for (const s of shifts) {
    const [a, b] = span(s.startTime, s.endTime);
    byDay.set(s.workDate, (byDay.get(s.workDate) || 0) + (b - a) / 60);
    night += nightMinutes(a, b) / 60;
  }
  const byWeek = new Map();
  let daily = 0;
  for (const [date, hours] of byDay) {
    const extra = Math.max(0, hours - 8);
    daily += extra;
    const wk = weekStartOf(date);
    byWeek.set(wk, (byWeek.get(wk) || 0) + hours - extra);
  }
  const weeklyOf = new Map();
  let weekly = 0;
  for (const [wk, regular] of byWeek) {
    weeklyOf.set(wk, Math.max(0, regular - 40));
    weekly += weeklyOf.get(wk);
  }
  let partTime = 0;
  if (isPartTime(contract)) {
    const hoursOf = new Map(byDay);
    for (const s of month ? context : []) {
      if (s.workDate.slice(0, 7) === month) continue;
      const [a, b] = span(s.startTime, s.endTime);
      hoursOf.set(s.workDate, (hoursOf.get(s.workDate) || 0) + (b - a) / 60);
    }
    const done = new Map(); // week → its hours before the current day
    const beyond = new Map(); // week → hours beyond C on the paid days, less those counted in (i)
    for (const date of [...hoursOf.keys()].sort()) {
      const wk = weekStartOf(date);
      const before = done.get(wk) || 0;
      const upTo = before + hoursOf.get(date);
      done.set(wk, upTo);
      if (!byDay.has(date)) continue;
      const overContract = Math.max(0, upTo - Math.max(contract, before));
      const overEight = Math.max(0, byDay.get(date) - 8);
      beyond.set(wk, (beyond.get(wk) || 0) + Math.max(0, overContract - overEight));
    }
    for (const [wk, hours] of beyond) partTime += Math.max(0, hours - weeklyOf.get(wk));
  }
  return result(daily, weekly, night, partTime);
}

/**
 * BR-15 / FR-24: part-time weekly limit warning for the acceptor of a swap. S = `scheduledHours`, the acceptor's
 * scheduled hours in the ISO week of the requested shift after the swap (WeeklySummary.scheduledHours), and
 * C = `contractHours` (BR-06). Warn when regularEmployees ≥ 5, the acceptor is part-time (BR-08 (a)) and S − C > 12;
 * exactly 12 hours beyond contract gives no warning. The warning never blocks the approval.
 * @returns {{beyondContract:number, warn:boolean}} beyondContract = max(0, S − C), rounded to 2 decimals
 */
export function partTimeLimitCheck({ regularEmployees, contractHours: contract, scheduledHours }) {
  const beyondContract = round2(Math.max(0, scheduledHours - contract));
  return { beyondContract, warn: regularEmployees >= 5 && isPartTime(contract) && beyondContract > 12 };
}

/** BR-09: the minimum hourly wage of a year (the latest row not after that year). */
export function minimumWageFor(year, rows) {
  const usable = rows.filter((r) => r.year <= year).sort((a, b) => b.year - a.year);
  return usable.length ? usable[0].hourly : null;
}

/**
 * BR-10: the probation reduction (90 % of the minimum) applies only if all hold: contract length
 * ≥ 1 year (contractEnd − contractStart ≥ 365 days, or contractEnd empty), the date is within 3 months
 * of contractStart and ≤ probationEnd, and simpleLabor = false.
 */
export function probationApplies(worker, date) {
  if (!worker.contractStart || !worker.probationEnd) return false;
  if (worker.simpleLabor) return false;
  if (worker.contractEnd && daysBetween(worker.contractStart, worker.contractEnd) < 365) return false;
  if (date < worker.contractStart) return false;
  if (date >= addMonths(worker.contractStart, 3)) return false;
  return date <= worker.probationEnd;
}

/**
 * BR-07/BR-08/BR-09/BR-11: one monthly payroll row.
 * `shifts` are the month's shifts of the worker as {workDate, startTime, endTime, estimated};
 * times are the actual clock-in/out of WORKED shifts, or the scheduled times when no attendance
 * is recorded yet (estimated = true). `holidayWeeks` are the holiday-allowance hours of the weeks
 * whose Sunday falls in the month. Amounts are integers in KRW, rounded down.
 * BR-08 (iv): `contractHours` is the worker's weekly contractual hours C, `month` the payroll month ('YYYY-MM') and
 * `context` the worker's shifts (same form) of the month's first and last ISO weeks on dates outside the month;
 * they only place the first C hours of those weeks and are not paid (see premiumHours).
 */
export function computePayrollRow({
  hourlyWage, shifts, holidayWeeks, regularEmployees, minimumHourly, probation, contractHours: contract = 0, month = null, context = [],
}) {
  const baseHours = round2(shifts.reduce((sum, s) => sum + durationHours(s.startTime, s.endTime), 0));
  const basePay = Math.floor(round2(baseHours * hourlyWage));
  const holidayPay = holidayWeeks.reduce((sum, h) => sum + Math.floor(round2(h * hourlyWage)), 0);
  const premium = premiumHours(shifts, regularEmployees, { contractHours: contract, month, context });
  const premiumPay = Math.floor(round2(premium.total * hourlyWage * 0.5));
  const floor = minimumHourly == null ? 0 : (probation ? (minimumHourly * 9) / 10 : minimumHourly); // 9/10, not 0.9: 10,320 × 0.9 is not exactly 9,288 in floating point
  return {
    baseHours,
    basePay,
    holidayPay,
    premiumPay,
    total: basePay + holidayPay + premiumPay,
    minWageWarning: hourlyWage < floor,
    estimated: shifts.some((s) => s.estimated),
  };
}
