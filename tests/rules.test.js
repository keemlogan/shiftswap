import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  overlaps, durationHours, weekStartOf, isEligibleCandidate, hasNoTaker, validateRequest, contractHours,
  computeWeeklySummary, holidayHours, premiumHours, minimumWageFor, probationApplies, computePayrollRow,
} from '../app/core/rules.js';

const wedShift = { workDate: '2026-09-30', startTime: '18:00', endTime: '23:00' };

// ---- TC-01x overlap & eligibility (BR-01) ----

test('TC-011 overlap is half-open: touching ranges do not overlap', () => {
  assert.equal(overlaps('10:00', '16:00', '16:00', '22:00'), false);
  assert.equal(overlaps('10:00', '16:01', '16:00', '22:00'), true);
  assert.equal(overlaps('18:00', '23:00', '17:00', '19:00'), true);
});

test('TC-012 durationHours supports end <= start as next day', () => {
  assert.equal(durationHours('18:00', '23:00'), 5);
  assert.equal(durationHours('22:00', '06:00'), 8);
  assert.equal(durationHours('12:00', '12:00'), 24);
  assert.equal(overlaps('22:00', '02:00', '23:00', '23:30'), true);
});

test('TC-013 weekStartOf returns the ISO Monday', () => {
  assert.equal(weekStartOf('2026-09-30'), '2026-09-28');
  assert.equal(weekStartOf('2026-09-28'), '2026-09-28');
  assert.equal(weekStartOf('2026-10-04'), '2026-09-28');
});

test('TC-014 eligible when an active worker, not the requester and free at that time (no availability, spec §15)', () => {
  assert.equal(isEligibleCandidate({ worker: { id: 3, active: 1 }, requesterId: 2, shift: wedShift, workerShifts: [] }), true);
  assert.equal(isEligibleCandidate({ worker: { id: 3, active: 1, role: 'WORKER' }, requesterId: 2, shift: wedShift, workerShifts: [] }), true);
  // A shift that only touches the requested one, or one on another day, does not exclude.
  const touching = [{ workDate: '2026-09-30', startTime: '12:00', endTime: '18:00' }, { workDate: '2026-10-01', startTime: '18:00', endTime: '23:00' }];
  assert.equal(isEligibleCandidate({ worker: { id: 3, active: 1 }, requesterId: 2, shift: wedShift, workerShifts: touching }), true);
});

test('TC-015 not eligible: requester, inactive, owner, or overlapping shift that day', () => {
  const base = { requesterId: 2, shift: wedShift, workerShifts: [] };
  assert.equal(isEligibleCandidate({ ...base, worker: { id: 2, active: 1 } }), false);
  assert.equal(isEligibleCandidate({ ...base, worker: { id: 3, active: 0 } }), false);
  assert.equal(isEligibleCandidate({ ...base, worker: { id: 1, active: 1, role: 'OWNER' } }), false);
  assert.equal(isEligibleCandidate({ ...base, worker: { id: 3, active: 1 }, workerShifts: [{ workDate: '2026-09-30', startTime: '12:00', endTime: '18:30' }] }), false);
});

test('TC-13F BR-13: no taker when there is no target or every target declined', () => {
  assert.equal(hasNoTaker([]), true);
  assert.equal(hasNoTaker(['DECLINED', 'DECLINED', 'DECLINED']), true);
  assert.equal(hasNoTaker(['DECLINED', 'PENDING']), false);
  assert.equal(hasNoTaker(['DECLINED', 'ACCEPTED']), false);
});

// ---- TC-02x request validity (BR-03) ----

const shift = { workerId: 2, status: 'SCHEDULED', workDate: '2026-09-30', startTime: '18:00', endTime: '23:00' };
const now = '2026-09-28T09:00';

test('TC-021 valid request passes', () => {
  assert.deepEqual(validateRequest({ shift, requesterId: 2, now, deadline: '2026-09-29T21:00', openRequests: 0 }), []);
  assert.deepEqual(validateRequest({ shift, requesterId: 2, now, deadline: '2026-09-30T18:00', openRequests: 0 }), []);
});

test('TC-022 only the current worker of a SCHEDULED future shift can request', () => {
  assert.ok(validateRequest({ shift, requesterId: 3, now, deadline: '2026-09-29T21:00', openRequests: 0 }).includes('NOT_OWN_SHIFT'));
  assert.ok(validateRequest({ shift: { ...shift, status: 'WORKED' }, requesterId: 2, now, deadline: '2026-09-29T21:00', openRequests: 0 }).includes('NOT_SCHEDULED'));
  assert.ok(validateRequest({ shift, requesterId: 2, now: '2026-09-30T18:00', deadline: '2026-09-30T18:00', openRequests: 0 }).includes('SHIFT_STARTED'));
});

test('TC-023 at most one open request, deadline after now and not after shift start', () => {
  assert.ok(validateRequest({ shift, requesterId: 2, now, deadline: '2026-09-29T21:00', openRequests: 1 }).includes('OPEN_REQUEST_EXISTS'));
  assert.ok(validateRequest({ shift, requesterId: 2, now, deadline: '2026-09-28T09:00', openRequests: 0 }).includes('DEADLINE_NOT_FUTURE'));
  assert.ok(validateRequest({ shift, requesterId: 2, now, deadline: '2026-09-30T18:01', openRequests: 0 }).includes('DEADLINE_AFTER_START'));
});

// ---- TC-08x holiday allowance (BR-06/07) ----

const own = (date, status = 'SCHEDULED', extra = {}) => ({ workerId: 3, originalWorkerId: null, workDate: date, startTime: '18:00', endTime: '23:00', status, ...extra });

test('TC-081 holiday allowance at exactly 15 h', () => {
  const s = computeWeeklySummary({ workerId: 3, contractHours: 15, shifts: [own('2026-09-29')], policy: 'EXCUSED' });
  assert.equal(s.holidayEligible, true);
  assert.equal(s.holidayHours, 3);
});

test('TC-082 no holiday allowance at 14.99 h', () => {
  const s = computeWeeklySummary({ workerId: 3, contractHours: 14.99, shifts: [own('2026-09-29')], policy: 'EXCUSED' });
  assert.equal(s.holidayEligible, false);
  assert.equal(s.holidayHours, 0);
  assert.deepEqual(s.reasons, [{ code: 'CONTRACT_BELOW_15' }]);
});

test('TC-083 holiday hours are capped at 40 contractual hours', () => {
  assert.equal(holidayHours(40), 8);
  assert.equal(holidayHours(52), 8);
  assert.equal(holidayHours(16), 3.2);
  assert.equal(contractHours([{ startTime: '18:00', endTime: '23:00' }, { startTime: '18:00', endTime: '23:00' }, { startTime: '12:00', endTime: '18:00' }]), 16);
});

test('TC-084 an ABSENT own shift breaks perfect attendance', () => {
  const s = computeWeeklySummary({ workerId: 3, contractHours: 16, shifts: [own('2026-09-29', 'ABSENT'), own('2026-10-01', 'WORKED', { clockIn: '18:00', clockOut: '23:00' })], policy: 'EXCUSED' });
  assert.equal(s.perfectAttendance, false);
  assert.equal(s.holidayEligible, false);
  assert.deepEqual(s.reasons, [{ code: 'ABSENT', date: '2026-09-29' }]);
  assert.equal(s.actualHours, 5);
});

test('TC-085 given-away shift under policy EXCUSED keeps attendance', () => {
  const given = own('2026-09-29', 'SCHEDULED', { workerId: 5, originalWorkerId: 3 });
  const s = computeWeeklySummary({ workerId: 3, contractHours: 16, shifts: [given, own('2026-10-01')], policy: 'EXCUSED' });
  assert.equal(s.holidayEligible, true);
  assert.equal(s.scheduledHours, 5);
});

test('TC-086 given-away shift under policy ABSENT breaks attendance', () => {
  const given = own('2026-09-29', 'SCHEDULED', { workerId: 5, originalWorkerId: 3 });
  const s = computeWeeklySummary({ workerId: 3, contractHours: 16, shifts: [given, own('2026-10-01')], policy: 'ABSENT' });
  assert.equal(s.holidayEligible, false);
  assert.deepEqual(s.reasons, [{ code: 'GAVE_AWAY', date: '2026-09-29' }]);
});

test('TC-087 substitute shifts taken do not change contractual hours; absence on them does not count', () => {
  const taken = { workerId: 3, originalWorkerId: 2, workDate: '2026-09-30', startTime: '18:00', endTime: '23:00', status: 'ABSENT' };
  const s = computeWeeklySummary({ workerId: 3, contractHours: 16, shifts: [taken, own('2026-09-29')], policy: 'EXCUSED' });
  assert.equal(s.contractHours, 16);
  assert.equal(s.scheduledHours, 10);
  assert.equal(s.holidayEligible, true);
});

// ---- TC-09x premium pay (BR-08) ----

const longDay = [{ workDate: '2026-09-29', startTime: '10:00', endTime: '23:00' }];

test('TC-091 premium is zero with 4 regular employees', () => {
  assert.deepEqual(premiumHours(longDay, 4), { daily: 0, weekly: 0, night: 0, total: 0 });
});

test('TC-092 premium with 5 employees: daily overtime and night hours add up', () => {
  const p = premiumHours(longDay, 5);
  assert.equal(p.daily, 5);
  assert.equal(p.night, 1);
  assert.equal(p.total, 6);
});

test('TC-093 overnight shift night hours 22:00-06:00', () => {
  const p = premiumHours([{ workDate: '2026-09-29', startTime: '21:00', endTime: '07:00' }], 5);
  assert.equal(p.night, 8);
  assert.equal(p.daily, 2);
});

test('TC-094 weekly hours beyond 40 not already counted as daily overtime', () => {
  const days = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'];
  const shifts = days.map((d) => ({ workDate: d, startTime: '09:00', endTime: '17:00' }));
  shifts[5] = { workDate: '2026-10-03', startTime: '09:00', endTime: '19:00' };
  const p = premiumHours(shifts, 5);
  assert.equal(p.daily, 2);
  assert.equal(p.weekly, 8);
  assert.equal(p.night, 0);
});

// ---- TC-10x minimum wage & probation (BR-09/10) ----

const wages = [{ year: 2025, hourly: 10030 }, { year: 2026, hourly: 10320 }];
const hana = { contractStart: '2026-09-01', contractEnd: null, probationEnd: '2026-11-30', simpleLabor: 0 };

test('TC-101 minimum wage by year', () => {
  assert.equal(minimumWageFor(2026, wages), 10320);
  assert.equal(minimumWageFor(2025, wages), 10030);
  assert.equal(minimumWageFor(2027, wages), 10320);
  assert.equal(minimumWageFor(2024, wages), null);
});

test('TC-102 probation applies only when all BR-10 conditions hold', () => {
  assert.equal(probationApplies(hana, '2026-09-15'), true);
  assert.equal(probationApplies(hana, '2026-11-30'), true);
  assert.equal(probationApplies({ ...hana, simpleLabor: 1 }, '2026-09-15'), false);
  assert.equal(probationApplies({ ...hana, contractEnd: '2027-08-30' }, '2026-09-15'), false);
  assert.equal(probationApplies({ ...hana, contractEnd: '2027-09-01' }, '2026-09-15'), true);
  assert.equal(probationApplies({ ...hana, probationEnd: '2026-10-15' }, '2026-10-16'), false);
  assert.equal(probationApplies({ ...hana, probationEnd: '2027-03-01' }, '2026-12-01'), false);
  assert.equal(probationApplies({ ...hana, probationEnd: null }, '2026-09-15'), false);
});

test('TC-103 minimum-wage warning uses 90 % only under probation', () => {
  const base = { shifts: [], holidayWeeks: [], regularEmployees: 4, minimumHourly: 10320 };
  assert.equal(computePayrollRow({ ...base, hourlyWage: 10000, probation: false }).minWageWarning, true);
  assert.equal(computePayrollRow({ ...base, hourlyWage: 10000, probation: true }).minWageWarning, false);
  assert.equal(computePayrollRow({ ...base, hourlyWage: 9000, probation: true }).minWageWarning, true);
  assert.equal(computePayrollRow({ ...base, hourlyWage: 10320, probation: false }).minWageWarning, false);
});

test('TC-106 BR-10 window: contractStart inclusive to the same date three months later exclusive; no probationEnd, no probation', () => {
  const long = { ...hana, probationEnd: '2027-03-01' };
  assert.equal(probationApplies(long, '2026-08-31'), false);
  assert.equal(probationApplies(long, '2026-09-01'), true);
  assert.equal(probationApplies(long, '2026-11-30'), true);
  assert.equal(probationApplies(long, '2026-12-01'), false);
  assert.equal(probationApplies({ ...hana, probationEnd: null }, '2026-09-01'), false);
  assert.equal(probationApplies({ ...hana, probationEnd: '' }, '2026-09-01'), false);
  assert.equal(probationApplies({ ...hana, probationEnd: undefined }, '2026-10-01'), false);
});

test('TC-107 the 90 % probation floor is exact: 9,288 won at a 10,320 minimum gives no warning', () => {
  const base = { shifts: [], holidayWeeks: [], regularEmployees: 4, minimumHourly: 10320, probation: true };
  assert.equal(computePayrollRow({ ...base, hourlyWage: 9288 }).minWageWarning, false);
  assert.equal(computePayrollRow({ ...base, hourlyWage: 9287 }).minWageWarning, true);
});

// ---- TC-11x monthly payroll (BR-11) ----

test('TC-111 payroll totals: base + holiday + premium, rounded down', () => {
  const shifts = [
    { workDate: '2026-09-22', startTime: '18:00', endTime: '23:00', estimated: false },
    { workDate: '2026-09-24', startTime: '18:00', endTime: '23:00', estimated: false },
    { workDate: '2026-09-26', startTime: '12:00', endTime: '18:00', estimated: false },
  ];
  const row = computePayrollRow({ hourlyWage: 10320, shifts, holidayWeeks: [3.2], regularEmployees: 4, minimumHourly: 10320, probation: false });
  assert.equal(row.baseHours, 16);
  assert.equal(row.basePay, 165120);
  assert.equal(row.holidayPay, 33024);
  assert.equal(row.premiumPay, 0);
  assert.equal(row.total, 198144);
  assert.equal(row.estimated, false);
});

test('TC-112 premium pay at 5 employees and estimated flag', () => {
  const shifts = [{ workDate: '2026-09-28', startTime: '18:00', endTime: '23:00', estimated: true }];
  const row = computePayrollRow({ hourlyWage: 10500, shifts, holidayWeeks: [], regularEmployees: 5, minimumHourly: 10320, probation: false });
  assert.equal(row.premiumPay, 5250);
  assert.equal(row.total, 52500 + 5250);
  assert.equal(row.estimated, true);
});

test('TC-113 fractional amounts are rounded down to the won', () => {
  const shifts = [{ workDate: '2026-09-28', startTime: '18:00', endTime: '18:20', estimated: false }];
  const row = computePayrollRow({ hourlyWage: 10001, shifts, holidayWeeks: [1.33], regularEmployees: 4, minimumHourly: 10000, probation: false });
  assert.equal(row.baseHours, 0.33);
  assert.equal(row.basePay, 3300);
  assert.equal(row.holidayPay, 13301);
});
