// TC-02x request validity (BR-03), TC-05x first acceptance (BR-02, NFR-04; sequential here, two connections in
// tools/db-concurrency.mjs), TC-06x approval effect (BR-04), TC-12x expiry (BR-12), TC-13x no taker (BR-13).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.mjs';

const db = await setup({ beforeEach, afterEach });

const notified = async (requestId, kind) => (await db.rows(
  'select worker_id from public.notification where sub_request_id = $1 and kind = $2 order by worker_id', [requestId, kind]))
  .map((n) => n.worker_id);
const requestRow = (id) => db.one(
  'select status, acceptor_id, decided_at::text from public.sub_request where id = $1', [id]);
const targets = async (requestId) => (await db.rows(
  'select worker_id, response from public.sub_request_target where sub_request_id = $1 order by worker_id', [requestId]))
  .map((t) => [t.worker_id, t.response]);

/** Doyun's Sat 10-03 10:00-16:00 with every co-worker busy then (Minho already works 12:00-18:00). */
async function doyunSaturdayWithoutTaker() {
  await db.fn('add_shift', '2026-10-03', '09:00', '17:00', 2);
  await db.fn('add_shift', '2026-10-03', '11:00', '15:00', 4);
  return db.shift(5, '2026-10-03');
}

test('TC-021 a valid request: own future SCHEDULED shift, deadline after now and not after the start; one target and notification per candidate (BR-03, FR-06, FR-07)', async () => {
  const tue = await db.shift(3, '2026-09-29');
  const created = await db.fn('create_sub_request', tue, 3, '  Family event ', '2026-09-29 18:00');
  assert.equal(created.status, 'REQUESTED');
  assert.deepEqual(created.candidates, [{ id: 2, name: 'Lee Seoyeon' }, { id: 4, name: 'Jung Hana' }, { id: 5, name: 'Kang Doyun' }]);
  assert.deepEqual(await db.one(
    'select requester_id, reason, deadline::text, status, created_at::text, decided_at from public.sub_request where id = $1', [created.id]),
  { requester_id: 3, reason: 'Family event', deadline: '2026-09-29 18:00:00', status: 'REQUESTED', created_at: '2026-09-28 09:00:00', decided_at: null });
  assert.deepEqual(await targets(created.id), [[2, 'PENDING'], [4, 'PENDING'], [5, 'PENDING']]);
  assert.deepEqual(await notified(created.id, 'REQUEST_RECEIVED'), [2, 4, 5]);
});

test('TC-022 invalid requests are refused: SHIFT_NOT_FOUND, NOT_YOUR_SHIFT, NOT_SCHEDULED, OPEN_REQUEST_EXISTS, DEADLINE_INVALID, SHIFT_STARTED (BR-03)', async () => {
  const tue = await db.shift(3, '2026-09-29');
  await db.refused(db.fn('create_sub_request', 999999, 3, null, '2026-09-29 12:00'), 'SHIFT_NOT_FOUND');
  await db.refused(db.fn('create_sub_request', tue, 2, null, '2026-09-29 12:00'), 'NOT_YOUR_SHIFT');
  await db.refused(db.fn('create_sub_request', await db.shift(3, '2026-09-22'), 3, null, '2026-09-29 12:00'), 'NOT_SCHEDULED');
  const open = await db.refused(db.fn('create_sub_request', await db.shift(2, '2026-09-30'), 2, null, '2026-09-29 12:00'), 'OPEN_REQUEST_EXISTS');
  assert.equal(open.detail.request_id, 1);
  await db.refused(db.fn('create_sub_request', tue, 3, null, '2026-09-28 09:00'), 'DEADLINE_INVALID');
  await db.refused(db.fn('create_sub_request', tue, 3, null, '2026-09-29 18:01'), 'DEADLINE_INVALID');
  await db.refused(db.fn('create_sub_request', tue, 3, null, null), 'DEADLINE_INVALID');
  await db.clock('2026-09-29 18:00');
  await db.refused(db.fn('create_sub_request', tue, 3, null, '2026-09-29 18:00'), 'SHIFT_STARTED');
  assert.equal(await db.value('select count(*)::int from public.sub_request'), 1);
});

test('TC-023 at most one open request per shift; a closed request does not block a new one (BR-03, one_open_request_per_shift)', async () => {
  const index = await db.value("select indexdef from pg_indexes where schemaname = 'public' and indexname = 'one_open_request_per_shift'");
  assert.match(index, /UNIQUE INDEX one_open_request_per_shift ON public\.sub_request USING btree \(shift_id\) WHERE \(status = ANY \(ARRAY\['REQUESTED'::text, 'ACCEPTED'::text\]\)\)/);
  await db.fn('cancel_sub_request', 1, 2);
  const again = await db.fn('create_sub_request', await db.shift(2, '2026-09-30'), 2, 'Exam moved', '2026-09-29 21:00');
  assert.equal(again.status, 'REQUESTED');
  await db.refused(db.fn('create_sub_request', await db.shift(2, '2026-09-30'), 2, null, '2026-09-29 21:00'), 'OPEN_REQUEST_EXISTS');
});

test('TC-051 S2: the first acceptance wins; Doyun\'s later acceptance is refused with ALREADY_TAKEN naming Choi Minho (BR-02, FR-09, FR-10)', async () => {
  assert.deepEqual(await db.fn('accept_sub_request', 1, 3), { id: 1, status: 'ACCEPTED', acceptor_id: 3, acceptor_name: 'Choi Minho' });
  const { detail, hint } = await db.refused(db.fn('accept_sub_request', 1, 5), 'ALREADY_TAKEN');
  assert.deepEqual(detail, { request_id: 1, acceptor_id: 3, acceptor_name: 'Choi Minho' });
  assert.equal(hint, 'Choi Minho accepted first.');
  assert.deepEqual(await requestRow(1), { status: 'ACCEPTED', acceptor_id: 3, decided_at: null });
  assert.deepEqual(await targets(1), [[3, 'ACCEPTED'], [4, 'CLOSED'], [5, 'CLOSED']]);
  assert.deepEqual(await db.rows("select worker_id, kind from public.notification where sub_request_id = 1 and kind <> 'REQUEST_RECEIVED' order by worker_id"),
    [{ worker_id: 1, kind: 'REQUEST_ACCEPTED' }, { worker_id: 2, kind: 'REQUEST_ACCEPTED' },
      { worker_id: 4, kind: 'TARGET_CLOSED' }, { worker_id: 5, kind: 'TARGET_CLOSED' }]);
  const params = await db.value("select params from public.notification where sub_request_id = 1 and kind = 'REQUEST_ACCEPTED' and worker_id = 1");
  assert.deepEqual([params.requester_name, params.acceptor_name, params.work_date, params.start_time, params.end_time],
    ['Lee Seoyeon', 'Choi Minho', '2026-09-30', '18:00', '23:00']);
  await db.refused(db.fn('accept_sub_request', 1, 4), 'ALREADY_TAKEN');
  await db.refused(db.fn('decline_sub_request', 1, 5), 'ALREADY_TAKEN');
  await db.refused(db.fn('accept_sub_request', 1, 3), 'REQUEST_CLOSED');
  assert.equal(await db.value("select count(*)::int from public.notification where kind = 'REQUEST_ACCEPTED'"), 2);
});

test('TC-052 accepting a FAILED or an EXPIRED request is refused with REQUEST_CLOSED (BR-02, BR-13)', async () => {
  await db.fn('decline_sub_request', 1, 3);
  await db.fn('decline_sub_request', 1, 4);
  assert.deepEqual(await db.fn('decline_sub_request', 1, 5), { id: 1, status: 'FAILED' });
  let refusal = await db.refused(db.fn('accept_sub_request', 1, 3), 'REQUEST_CLOSED');
  assert.equal(refusal.detail.status, 'FAILED');
  const tue = await db.shift(3, '2026-09-29');
  const other = await db.fn('create_sub_request', tue, 3, null, '2026-09-29 12:00');
  await db.clock('2026-09-29 12:00');
  assert.deepEqual(await db.fn('run_system_clock'), { expired: 1, drafted_months: [] });
  refusal = await db.refused(db.fn('accept_sub_request', other.id, 2), 'REQUEST_CLOSED');
  assert.equal(refusal.detail.status, 'EXPIRED');
});

test('TC-053 ACCEPTOR_BUSY: a candidate with an overlapping shift cannot accept; the overlap is checked again at approval (BR-02)', async () => {
  const busy = await db.fn('add_shift', '2026-09-30', '19:00', '21:00', 3);
  const { detail } = await db.refused(db.fn('accept_sub_request', 1, 3), 'ACCEPTOR_BUSY');
  assert.equal(detail.shift_id, busy);
  assert.deepEqual(await requestRow(1), { status: 'REQUESTED', acceptor_id: null, decided_at: null });
  assert.deepEqual(await targets(1), [[3, 'PENDING'], [4, 'PENDING'], [5, 'PENDING']]);
  await db.fn('delete_shift', busy);
  await db.fn('accept_sub_request', 1, 3);
  const late = await db.fn('add_shift', '2026-09-30', '12:00', '19:00', 3);
  const refusal = await db.refused(db.fn('decide_sub_request', 1, 'APPROVE'), 'ACCEPTOR_BUSY');
  assert.equal(refusal.detail.shift_id, late);
  assert.deepEqual(await db.one('select worker_id, original_worker_id from public.shift where id = (select shift_id from public.sub_request where id = 1)'),
    { worker_id: 2, original_worker_id: null });
  assert.deepEqual(await db.fn('decide_sub_request', 1, 'REJECT'), { id: 1, status: 'REJECTED' });
});

test('TC-054 only a target can answer: NOT_A_TARGET for the requester and the owner, REQUEST_NOT_FOUND for an unknown request (BR-02)', async () => {
  await db.refused(db.fn('accept_sub_request', 1, 2), 'NOT_A_TARGET');
  await db.refused(db.fn('accept_sub_request', 1, 1), 'NOT_A_TARGET');
  await db.refused(db.fn('decline_sub_request', 1, 1), 'NOT_A_TARGET');
  await db.refused(db.fn('accept_sub_request', 999999, 3), 'REQUEST_NOT_FOUND');
  await db.refused(db.fn('decline_sub_request', 999999, 3), 'REQUEST_NOT_FOUND');
  assert.deepEqual(await requestRow(1), { status: 'REQUESTED', acceptor_id: null, decided_at: null });
});

test('TC-055 a single "can\'t" keeps the request open and notifies no one; that candidate cannot accept afterwards (FR-22)', async () => {
  const before = await db.value('select count(*)::int from public.notification');
  assert.deepEqual(await db.fn('decline_sub_request', 1, 5), { id: 1, status: 'REQUESTED' });
  assert.equal(await db.value('select count(*)::int from public.notification'), before);
  const { hint } = await db.refused(db.fn('accept_sub_request', 1, 5), 'REQUEST_CLOSED');
  assert.equal(hint, 'You have already answered this request.');
  assert.equal((await db.fn('accept_sub_request', 1, 3)).status, 'ACCEPTED');
  assert.deepEqual(await targets(1), [[3, 'ACCEPTED'], [4, 'CLOSED'], [5, 'DECLINED']]);
  assert.deepEqual(await notified(1, 'TARGET_CLOSED'), [4]);
});

test('TC-061 approval hands the shift to the acceptor, keeps the original worker, recomputes both weeks and notifies both (BR-04, FR-12)', async () => {
  await db.fn('accept_sub_request', 1, 3);
  assert.deepEqual(await db.fn('decide_sub_request', 1, 'APPROVE'), { id: 1, status: 'APPROVED' });
  assert.deepEqual(await db.one('select worker_id, original_worker_id, status from public.shift where id = (select shift_id from public.sub_request where id = 1)'),
    { worker_id: 3, original_worker_id: 2, status: 'SCHEDULED' });
  assert.deepEqual(await requestRow(1), { status: 'APPROVED', acceptor_id: 3, decided_at: '2026-09-28 09:00:00' });
  assert.deepEqual(await db.rows(
    "select worker_id, scheduled_hours::float8 as s, holiday_hours::float8 as h, holiday_pay from public.weekly_summary where week_start = '2026-09-28' and worker_id in (2, 3) order by worker_id"),
  [{ worker_id: 2, s: 5, h: 0, holiday_pay: 0 }, { worker_id: 3, s: 21, h: 3.2, holiday_pay: 33024 }]);
  assert.deepEqual(await notified(1, 'REQUEST_APPROVED'), [2, 3]);
  await db.refused(db.fn('approval_preview', 1), 'NOT_ACCEPTED');
});

test('TC-062 rejection leaves the shift unchanged; only an ACCEPTED request can be decided; the decision is APPROVE or REJECT (BR-04)', async () => {
  const { detail } = await db.refused(db.fn('decide_sub_request', 1, 'APPROVE'), 'NOT_ACCEPTED');
  assert.equal(detail.status, 'REQUESTED');
  await db.refused(db.fn('approval_preview', 1), 'NOT_ACCEPTED');
  await db.fn('accept_sub_request', 1, 3);
  await db.refused(db.fn('decide_sub_request', 1, 'MAYBE'), 'DECISION_INVALID');
  await db.refused(db.fn('decide_sub_request', 999999, 'APPROVE'), 'REQUEST_NOT_FOUND');
  assert.deepEqual(await db.fn('decide_sub_request', 1, 'REJECT'), { id: 1, status: 'REJECTED' });
  assert.deepEqual(await db.one('select worker_id, original_worker_id from public.shift where id = (select shift_id from public.sub_request where id = 1)'),
    { worker_id: 2, original_worker_id: null });
  assert.deepEqual(await requestRow(1), { status: 'REJECTED', acceptor_id: 3, decided_at: '2026-09-28 09:00:00' });
  assert.deepEqual(await notified(1, 'REQUEST_REJECTED'), [2, 3]);
  await db.refused(db.fn('decide_sub_request', 1, 'APPROVE'), 'NOT_ACCEPTED');
  await db.refused(db.fn('accept_sub_request', 1, 4), 'REQUEST_CLOSED');
});

test('TC-063 a shift swapped twice keeps its first worker as original worker (BR-04)', async () => {
  await db.fn('accept_sub_request', 1, 3);
  await db.fn('decide_sub_request', 1, 'APPROVE');
  const wed = await db.value('select shift_id from public.sub_request where id = 1');
  const second = await db.fn('create_sub_request', wed, 3, null, '2026-09-30 12:00');
  assert.deepEqual(second.candidates.map((c) => c.id), [2, 4, 5]);
  await db.fn('accept_sub_request', second.id, 4);
  await db.fn('decide_sub_request', second.id, 'APPROVE');
  assert.deepEqual(await db.one('select worker_id, original_worker_id from public.shift where id = $1', [wed]), { worker_id: 4, original_worker_id: 2 });
  await db.refused(db.fn('create_sub_request', wed, 3, null, '2026-09-30 12:00'), 'NOT_YOUR_SHIFT');
});

test('TC-121 S4: nobody answers; at 2026-09-29 21:00 the System Clock expires the request and notifies requester and owner (BR-12, FR-18)', async () => {
  await db.clock('2026-09-29 20:59');
  assert.deepEqual(await db.fn('run_system_clock'), { expired: 0, drafted_months: [] });
  await db.clock('2026-09-29 21:00');
  assert.deepEqual(await db.fn('run_system_clock'), { expired: 1, drafted_months: [] });
  assert.deepEqual(await requestRow(1), { status: 'EXPIRED', acceptor_id: null, decided_at: '2026-09-29 21:00:00' });
  assert.deepEqual(await targets(1), [[3, 'CLOSED'], [4, 'CLOSED'], [5, 'CLOSED']]);
  assert.deepEqual(await notified(1, 'REQUEST_EXPIRED'), [1, 2]);
  assert.equal(await db.value("select count(*)::int from public.notification where sub_request_id = 1 and worker_id in (3, 4, 5) and kind <> 'REQUEST_RECEIVED'"), 0);
  assert.deepEqual(await db.fn('run_system_clock'), { expired: 0, drafted_months: [] });
  assert.equal(await db.fn('expire_overdue_requests'), 0);
});

test('TC-122 an ACCEPTED request expires at the shift start; expire_overdue_requests returns the number expired (BR-12)', async () => {
  const tue = await db.shift(3, '2026-09-29');
  const r = await db.fn('create_sub_request', tue, 3, null, '2026-09-29 18:00');
  await db.fn('accept_sub_request', r.id, 2);
  await db.clock('2026-09-29 17:59');
  assert.equal(await db.fn('expire_overdue_requests'), 0);
  await db.clock('2026-09-29 18:00');
  assert.equal(await db.fn('expire_overdue_requests'), 1);
  assert.deepEqual(await requestRow(r.id), { status: 'EXPIRED', acceptor_id: 2, decided_at: '2026-09-29 18:00:00' });
  assert.deepEqual(await notified(r.id, 'REQUEST_EXPIRED'), [1, 3]);
  await db.refused(db.fn('decide_sub_request', r.id, 'APPROVE'), 'REQUEST_CLOSED');
});

test('TC-123 accept_sub_request evaluates the expiry first: a late acceptance is refused even if no screen was loaded (BR-12)', async () => {
  await db.clock('2026-09-29 22:00');
  const { detail } = await db.refused(db.fn('accept_sub_request', 1, 3), 'REQUEST_CLOSED');
  assert.deepEqual(detail, { request_id: 1, status: 'EXPIRED' });
  // The refusal ends the call's transaction, so the expiry it found is written by the next System Clock run.
  assert.deepEqual(await requestRow(1), { status: 'REQUESTED', acceptor_id: null, decided_at: null });
  assert.equal(await db.value("select count(*)::int from public.notification where kind = 'REQUEST_ACCEPTED'"), 0);
  assert.deepEqual(await db.fn('run_system_clock'), { expired: 1, drafted_months: [] });
  assert.deepEqual(await requestRow(1), { status: 'EXPIRED', acceptor_id: null, decided_at: '2026-09-29 22:00:00' });
  // Also at the shift start of a request whose deadline equals the start.
  await db.clock('2026-09-30 09:00');
  const thu = await db.shift(3, '2026-10-01');
  const r = await db.fn('create_sub_request', thu, 3, null, '2026-10-01 18:00');
  await db.clock('2026-10-01 18:00');
  await db.refused(db.fn('accept_sub_request', r.id, 2), 'REQUEST_CLOSED');
  await db.refused(db.fn('decline_sub_request', r.id, 2), 'REQUEST_CLOSED');
});

test('TC-124 decide_sub_request evaluates the expiry first: approval at the deadline or after the shift start is refused (BR-12, BR-04)', async () => {
  await db.fn('accept_sub_request', 1, 3);
  await db.clock('2026-09-29 21:00');
  const { detail } = await db.refused(db.fn('decide_sub_request', 1, 'APPROVE'), 'REQUEST_CLOSED');
  assert.equal(detail.status, 'EXPIRED');
  assert.equal(await db.value('select worker_id from public.shift where id = (select shift_id from public.sub_request where id = 1)'), 2);
  assert.equal(await db.value("select count(*)::int from public.notification where kind = 'REQUEST_APPROVED'"), 0);
  assert.equal(await db.fn('expire_overdue_requests'), 1);
  await db.refused(db.fn('decide_sub_request', 1, 'REJECT'), 'REQUEST_CLOSED');
  // Shift start: a request whose deadline is the start, accepted, decided once the shift has started.
  await db.clock('2026-09-30 09:00');
  const thu = await db.shift(3, '2026-10-01');
  const r = await db.fn('create_sub_request', thu, 3, null, '2026-10-01 18:00');
  await db.fn('accept_sub_request', r.id, 2);
  await db.clock('2026-10-01 18:00');
  await db.refused(db.fn('decide_sub_request', r.id, 'APPROVE'), 'REQUEST_CLOSED');
  assert.equal(await db.value('select worker_id from public.shift where id = $1', [thu]), 3);
});

test('TC-125 cancel: the requester cancels; every PENDING or ACCEPTED target is told; a closed request cannot be cancelled (UC-12, FR-19)', async () => {
  await db.refused(db.fn('cancel_sub_request', 1, 3), 'NOT_REQUESTER');
  await db.refused(db.fn('cancel_sub_request', 999999, 2), 'REQUEST_NOT_FOUND');
  assert.deepEqual(await db.fn('cancel_sub_request', 1, 2), { id: 1, status: 'CANCELLED' });
  assert.deepEqual(await requestRow(1), { status: 'CANCELLED', acceptor_id: null, decided_at: '2026-09-28 09:00:00' });
  assert.deepEqual(await targets(1), [[3, 'CLOSED'], [4, 'CLOSED'], [5, 'CLOSED']]);
  assert.deepEqual(await notified(1, 'REQUEST_CANCELLED'), [3, 4, 5]);
  await db.refused(db.fn('cancel_sub_request', 1, 2), 'REQUEST_CLOSED');
  // An accepted request: only the acceptor is told (the other targets were closed at acceptance).
  const r = await db.fn('create_sub_request', await db.shift(2, '2026-09-30'), 2, null, '2026-09-29 21:00');
  await db.fn('accept_sub_request', r.id, 5);
  await db.fn('cancel_sub_request', r.id, 2);
  assert.deepEqual(await notified(r.id, 'REQUEST_CANCELLED'), [5]);
});

test('TC-131 S5: Hana\'s Sun 10-04 request; all three answer "can\'t" → FAILED; Hana and the owner receive REQUEST_FAILED and acknowledge it (BR-13, FR-22)', async () => {
  const sun = await db.shift(4, '2026-10-04');
  const r = await db.fn('create_sub_request', sun, 4, null, '2026-10-03 12:00');
  assert.deepEqual(r.candidates.map((c) => c.name), ['Lee Seoyeon', 'Choi Minho', 'Kang Doyun']);
  const before = await db.value('select count(*)::int from public.notification');
  assert.equal((await db.fn('decline_sub_request', r.id, 2)).status, 'REQUESTED');
  assert.equal((await db.fn('decline_sub_request', r.id, 3)).status, 'REQUESTED');
  assert.equal(await db.value('select count(*)::int from public.notification'), before);
  assert.deepEqual(await db.fn('decline_sub_request', r.id, 5), { id: r.id, status: 'FAILED' });
  assert.deepEqual(await requestRow(r.id), { status: 'FAILED', acceptor_id: null, decided_at: '2026-09-28 09:00:00' });
  assert.deepEqual(await notified(r.id, 'REQUEST_FAILED'), [1, 4]);
  assert.equal(await db.value("select count(*)::int from public.notification where sub_request_id = $1 and worker_id in (2, 3, 5) and kind <> 'REQUEST_RECEIVED'", [r.id]), 0);
  const hana = await db.fn('worker_home', 4);
  assert.deepEqual(hana.failed.map((f) => [f.request_id, f.work_date, f.start_time, f.end_time]), [[r.id, '2026-10-04', '10:00', '16:00']]);
  let owner = await db.fn('owner_home');
  assert.deepEqual(owner.failed.map((f) => [f.request_id, f.requester_name]), [[r.id, 'Jung Hana']]);
  // Acknowledge (mark read) the owner's card; another user's id is ignored.
  assert.equal(await db.fn('mark_notifications_read', 1, `{${hana.failed[0].notification_id}}`), 0);
  assert.equal(await db.fn('mark_notifications_read', 1, `{${owner.failed[0].notification_id}}`), 1);
  owner = await db.fn('owner_home');
  assert.deepEqual(owner.failed, []);
  assert.equal(await db.value('select worker_id from public.shift where id = $1', [sun]), 4);
  // FAILED is final: the expiry passes it by (only the seed request expires), it cannot be cancelled.
  await db.clock('2026-10-03 12:00');
  assert.equal(await db.fn('expire_overdue_requests'), 1);
  assert.deepEqual(await requestRow(r.id), { status: 'FAILED', acceptor_id: null, decided_at: '2026-09-28 09:00:00' });
  assert.deepEqual(await notified(r.id, 'REQUEST_EXPIRED'), []);
  await db.refused(db.fn('cancel_sub_request', r.id, 4), 'REQUEST_CLOSED');
});

test('TC-132 no eligible worker at creation: the request ends FAILED at once without targets (BR-13, FR-08)', async () => {
  const sat = await doyunSaturdayWithoutTaker();
  assert.deepEqual(await db.fn('preview_candidates', sat, 5), []);
  const r = await db.fn('create_sub_request', sat, 5, 'Family event', '2026-10-02 12:00');
  assert.deepEqual([r.status, r.candidates], ['FAILED', []]);
  assert.equal(await db.value('select count(*)::int from public.sub_request_target where sub_request_id = $1', [r.id]), 0);
  assert.deepEqual(await db.rows('select worker_id, kind from public.notification where sub_request_id = $1 order by worker_id', [r.id]),
    [{ worker_id: 1, kind: 'REQUEST_FAILED' }, { worker_id: 5, kind: 'REQUEST_FAILED' }]);
  assert.deepEqual(await requestRow(r.id), { status: 'FAILED', acceptor_id: null, decided_at: '2026-09-28 09:00:00' });
});
