// UC-04 / UC-05 / UC-12: the Swaps tab (requests for me, my requests, history) and the three-step
// request flow (choose shift → reason and deadline → review and send → result), prompt §2.4.
import * as svc from '../core/services.js';
import { addMinutes } from '../core/clock.js';
import { t, esc, fmtShift, fmtDate, fmtWhen, dday, given, displayName, initial, joinPeople, dayLong, showFormError, errorText } from './i18n.js';
import { icon, button, pageHead, sectionHead, emptyState, tracker } from './components.js';
import { effectLines } from './approvals.js';

// ---- Cards shared with Home -----------------------------------------------------

/** A request sent to me: who asks, the shift, reason, deadline, the effect of accepting, Accept / Can't (DECLINED). */
export function incomingCard(r, { now, primary }) {
  return `
    <article class="card req-card" aria-labelledby="in-${r.id}">
      <div class="card-row">
        <h3 class="card-title" id="in-${r.id}">${esc(t('home.asks', { name: given(r.requesterName) }))}</h3>
        <span class="chip chip-handover">${esc(dday(r.workDate, now))}</span>
      </div>
      <p class="shift-line num">${esc(fmtShift(r))}</p>
      ${r.reason ? `<p class="muted">${esc(t('home.reason', { text: r.reason }))}</p>` : ''}
      <p class="deadline">${icon('clock')}<span>${esc(t('home.replyBy', { when: fmtWhen(r.deadline, now) }))}</span></p>
      ${effectLines(r.effect, 'accept')}
      <div class="actions">
        ${button({ label: t('home.accept'), kind: primary ? 'primary' : 'secondary', attrs: `data-accept="${r.id}" data-day="${esc(dayLong(r.workDate))}"`, block: true })}
        ${button({ label: t('home.decline'), kind: 'text', attrs: `data-decline="${r.id}"` })}
      </div>
    </article>`;
}

/** A request I was asked for but someone else accepted first. */
export function takenCard(r) {
  return `
    <article class="card req-card req-closed">
      <div class="card-row"><h3 class="card-title">${esc(t('home.taken', { name: given(r.acceptorName) }))}</h3>${icon('check', 'muted-icon')}</div>
      <p class="muted">${esc(t('home.takenSub', { shift: fmtShift(r) }))}</p>
    </article>`;
}

function answersLine(r) {
  if (!r.targets.length) return `<p class="muted">${esc(t('answer.none'))}</p>`;
  return `<ul class="answers">${r.targets.map((x) => `<li class="answer answer-${x.response.toLowerCase()}">${esc(t('answer.line', { name: given(x.workerName), answer: t(`answer.${x.response}`) }))}</li>`).join('')}</ul>`;
}

/** BR-13: one of my requests that ended FAILED, shown until I acknowledge its notification. */
export function failedCard(f, { primary }) {
  return `
    <article class="card req-card">
      <div class="card-row"><h3 class="card-title num">${esc(fmtShift(f))}</h3></div>
      ${tracker('FAILED')}
      <div class="actions">${button({ label: t('failed.ack'), kind: primary ? 'primary' : 'secondary', block: true, attrs: `data-ack-failed="${f.notificationId}"` })}</div>
    </article>`;
}

/** One of my requests, as a tracker card; open ones can be cancelled. */
export function myRequestCard(r, { now }) {
  const open = r.status === 'REQUESTED' || r.status === 'ACCEPTED';
  let status = '';
  if (r.status === 'REQUESTED') status = `<p class="status-line">${esc(t('status.waitingReplies'))} · ${esc(t('common.until', { when: fmtWhen(r.deadline, now) }))}</p>${answersLine(r)}`;
  if (r.status === 'FAILED') status = answersLine(r);
  if (r.status === 'ACCEPTED') status = `<p class="status-line">${esc(t('status.waitingOwner', { name: given(r.acceptorName) }))}</p>`;
  if (r.status === 'APPROVED') status = `<p class="status-line">${esc(t('status.approved', { name: given(r.acceptorName) }))}</p>`;
  return `
    <article class="card req-card">
      <div class="card-row"><h3 class="card-title num">${esc(fmtShift(r))}</h3></div>
      ${tracker(r.status)}
      ${status}
      ${open ? `<div class="actions actions-end">${button({ label: t('swaps.cancel'), kind: 'text', attrs: `data-cancel="${r.id}"` })}</div>` : ''}
    </article>`;
}

/** Accept / Decline / Cancel handlers for the cards above. */
export function bindRequestActions(view, ctx) {
  view.querySelectorAll('[data-accept]').forEach((b) => b.addEventListener('click', () => {
    try {
      svc.respondToRequest(Number(b.dataset.accept), ctx.user.id, 'ACCEPTED');
      ctx.toast(t('home.accepted', { day: b.dataset.day }));
      ctx.refresh();
    } catch (err) {
      if (err.code === 'ALREADY_TAKEN') {
        ctx.toast(t('home.taken', { name: given(err.params.name) }), 'alert');
        ctx.refresh();
      } else if (err.code === 'REQUEST_CLOSED') {
        ctx.toast(errorText(err), 'alert');
        ctx.refresh();
      } else ctx.fail(err);
    }
  }));
  view.querySelectorAll('[data-decline]').forEach((b) => b.addEventListener('click', () => {
    try {
      svc.respondToRequest(Number(b.dataset.decline), ctx.user.id, 'DECLINED');
      ctx.toast(t('home.declined'));
      ctx.refresh();
    } catch (err) {
      if (err.code === 'ALREADY_TAKEN' || err.code === 'REQUEST_CLOSED') {
        ctx.toast(errorText(err), 'alert');
        ctx.refresh();
      } else ctx.fail(err);
    }
  }));
  view.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => {
    try {
      svc.cancelRequest(Number(b.dataset.cancel), ctx.user.id);
      ctx.toast(t('swaps.cancelled'));
      ctx.refresh();
    } catch (err) {
      ctx.fail(err);
    }
  }));
  bindFailedAck(view, ctx);
}

/** 확인했어요 on a FAILED card (worker or owner, BR-13): marks that one notification read. */
export function bindFailedAck(view, ctx) {
  view.querySelectorAll('[data-ack-failed]').forEach((b) => b.addEventListener('click', () => {
    try {
      svc.markNotificationsRead(ctx.user.id, [Number(b.dataset.ackFailed)]);
      ctx.toast(t('failed.acked'));
      ctx.refresh();
    } catch (err) {
      ctx.fail(err);
    }
  }));
}

// ---- Swaps tab ---------------------------------------------------------------------

export function render(view, ctx) {
  if (ctx.args[0] === 'new') {
    renderFlow(view, ctx);
    return;
  }
  const home = svc.getWorkerHome(ctx.user.id);
  const mine = svc.listMyRequests(ctx.user.id);
  const past = mine.filter((r) => !['REQUESTED', 'ACCEPTED'].includes(r.status));
  const canRequest = svc.listRequestableShifts(ctx.user.id).length > 0;
  const cta = button({
    label: t('swaps.find'), kind: 'primary', block: true, href: '#/swaps/new/1',
    disabled: !canRequest, reason: t('swaps.findDisabled'),
  });

  view.innerHTML = `
    ${pageHead({ title: t('swaps.title'), sub: t('swaps.sub'), cta })}
    <section class="section">
      ${sectionHead(t('swaps.received'), home.incoming.length || null)}
      ${home.incoming.length || home.taken.length
    ? `<div class="stack">${home.incoming.map((r) => incomingCard(r, { now: ctx.now, primary: false })).join('')}${home.taken.map(takenCard).join('')}</div>`
    : emptyState(t('swaps.receivedEmpty'))}
    </section>
    <section class="section">
      ${sectionHead(t('swaps.sent'), home.myOpen.length + home.failed.length || null)}
      ${home.myOpen.length || home.failed.length
    ? `<div class="stack">${home.failed.map((f) => failedCard(f, { primary: false })).join('')}${home.myOpen.map((r) => myRequestCard(r, ctx)).join('')}</div>`
    : emptyState(t('swaps.sentEmpty'))}
    </section>
    ${past.length ? `
    <section class="section">
      <details class="history">
        <summary>${esc(t('swaps.past', { n: past.length }))}${icon('chevronDown', 'chev')}</summary>
        <div class="stack">${past.map((r) => myRequestCard(r, ctx)).join('')}</div>
      </details>
    </section>` : ''}`;
  bindRequestActions(view, ctx);
}

// ---- Request flow ------------------------------------------------------------------

const DRAFT_KEY = 'shiftswap.flow';
const REASONS = ['Exam', 'Hospital', 'Family', 'Personal', 'Other'];

function loadDraft() {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY)) || {};
  } catch {
    return {};
  }
}

function saveDraft(d) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    // Storage blocked: the draft lives only in memory for this step.
  }
}

function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // nothing to clear
  }
}

function shiftStart(s) {
  return `${s.workDate}T${s.startTime}`;
}

/** The deadline options of step 2 for this shift; an option is unavailable when it is not after now or is after the start. */
function deadlineOptions(shift, now) {
  const start = shiftStart(shift);
  const in24 = addMinutes(now, 24 * 60);
  const before2 = addMinutes(start, -120);
  return {
    d24: { value: in24, ok: in24 > now && in24 <= start },
    d2h: { value: before2, ok: before2 > now && before2 <= start },
    custom: { value: null, ok: true },
  };
}

function flowHead(step, backHref, ctx) {
  return `
    <div class="flow-head">
      ${step <= 3 && backHref ? `<a class="icon-btn" href="${backHref}" aria-label="${esc(t('common.back'))}">${icon('chevronLeft')}</a>` : '<span class="icon-btn-spacer"></span>'}
      ${step <= 3 ? `<p class="step-indicator"><span aria-hidden="true" class="num">${esc(t('flow.step', { n: step }))}</span><span class="sr-only">${esc(t('flow.stepSr', { n: step }))}</span></p>` : '<span></span>'}
      <a class="icon-btn" href="#/${ctx.user.role === 'WORKER' ? 'swaps' : 'home'}" aria-label="${esc(t('flow.exit'))}" data-exit>${icon('x')}</a>
    </div>
    ${step <= 3 ? `<div class="step-bar" aria-hidden="true"><span style="width:${(step / 3) * 100}%"></span></div>` : ''}`;
}

function renderFlow(view, ctx) {
  const step = ctx.args[1] || '1';
  const draft = loadDraft();
  if (step === '1' && ctx.args[2]) {
    draft.shiftId = Number(ctx.args[2]);
    saveDraft(draft);
  }
  if (step === '1') return flowStep1(view, ctx, draft);
  const shift = draft.shiftId ? svc.listRequestableShifts(ctx.user.id).find((s) => s.id === draft.shiftId) : null;
  if (step === 'done') return flowDone(view, ctx, draft);
  if (!shift) {
    ctx.go('#/swaps/new/1');
    return undefined;
  }
  if (step === '2') return flowStep2(view, ctx, draft, shift);
  return flowStep3(view, ctx, draft, shift);
}

function flowStep1(view, ctx, draft) {
  const t0 = ctx.now;
  const requestable = svc.listRequestableShifts(ctx.user.id);
  const busy = svc.listMyRequests(ctx.user.id).filter((r) => ['REQUESTED', 'ACCEPTED'].includes(r.status) && shiftStart(r) > t0);
  const all = [
    ...requestable.map((s) => ({ ...s, busy: false })),
    ...busy.map((r) => ({ id: r.shiftId, workDate: r.workDate, startTime: r.startTime, endTime: r.endTime, busy: true })),
  ].sort((a, b) => shiftStart(a).localeCompare(shiftStart(b)));
  if (!requestable.some((s) => s.id === draft.shiftId)) delete draft.shiftId;
  if (!draft.shiftId && requestable.length === 1) {
    draft.shiftId = requestable[0].id;
    saveDraft(draft);
  }

  const ctaHtml = () => button({
    label: t('common.next'), kind: 'primary', block: true, id: 'next',
    disabled: !draft.shiftId, reason: requestable.length ? t('flow.s1Need') : t('flow.s1None'),
  });
  view.innerHTML = `
    ${flowHead(1, null, ctx)}
    <div class="flow-body">
      ${pageHead({ title: t('flow.s1Title'), sub: t('flow.s1Sub'), cta: ctaHtml() })}
      ${all.length ? `<fieldset class="options"><legend class="sr-only">${esc(t('flow.s1Title'))}</legend>
        ${all.map((s) => `
          <label class="option-card ${s.busy ? 'is-disabled' : ''}">
            <input type="radio" name="shift" value="${s.id}" ${s.busy ? 'disabled' : ''} ${s.id === draft.shiftId ? 'checked' : ''}>
            <span class="option-main">
              <span class="option-title">${esc(fmtDate(s.workDate))}</span>
              <span class="option-sub num">${esc(`${s.startTime}–${s.endTime}`)}</span>
              ${s.busy ? `<span class="chip chip-handover">${esc(t('flow.s1Busy'))}</span>` : ''}
            </span>
            <span class="chip">${esc(dday(s.workDate, t0))}</span>
          </label>`).join('')}
      </fieldset>` : emptyState(t('flow.s1None'))}
    </div>`;
  view.querySelectorAll('input[name="shift"]').forEach((r) => r.addEventListener('change', () => {
    draft.shiftId = Number(r.value);
    saveDraft(draft);
    view.querySelector('.cta-bar').innerHTML = ctaHtml();
    bindNext();
  }));
  const bindNext = () => {
    const next = view.querySelector('#next');
    if (next && !next.disabled) next.addEventListener('click', () => { draft.deadlineMode = null; saveDraft(draft); ctx.go('#/swaps/new/2'); });
  };
  bindNext();
}

function flowStep2(view, ctx, draft, shift) {
  const opts = deadlineOptions(shift, ctx.now);
  const start = shiftStart(shift);
  if (!draft.deadlineMode) {
    const def = svc.defaultDeadline(shift);
    draft.deadlineMode = opts.d24.ok && def === opts.d24.value ? 'd24' : 'custom';
    draft.deadline = def;
  }
  if (draft.deadlineMode !== 'custom') draft.deadline = opts[draft.deadlineMode].value;
  if (draft.reasonKey === undefined) draft.reasonKey = null;
  saveDraft(draft);

  const valid = () => draft.deadline && draft.deadline > ctx.now && draft.deadline <= start;
  const sentence = () => (valid() ? t('flow.dSentence', { when: fmtWhen(draft.deadline, ctx.now) }) : t('err.DEADLINE_AFTER_START', { start: fmtShift(shift) }));
  const ctaHtml = () => button({
    label: t('common.next'), kind: 'primary', block: true, id: 'next',
    disabled: !valid(), reason: draft.deadline && draft.deadline <= ctx.now ? t('err.DEADLINE_NOT_FUTURE') : t('err.DEADLINE_INVALID'),
  });
  const chip = (group, value, label, checked, disabled = false) => `
    <label class="chip-option ${disabled ? 'is-disabled' : ''}">
      <input type="radio" name="${group}" value="${value}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
      <span>${esc(label)}</span>
    </label>`;

  view.innerHTML = `
    ${flowHead(2, '#/swaps/new/1', ctx)}
    <div class="flow-body">
      ${pageHead({ title: t('flow.s2Title'), sub: fmtShift(shift), cta: ctaHtml() })}
      <form class="form" id="s2" novalidate>
        <fieldset class="field-group">
          <legend class="field-label">${esc(t('flow.reason'))}</legend>
          <div class="chip-row" role="radiogroup">
            ${REASONS.map((k) => chip('reason', k, t(`flow.reason${k}`), draft.reasonKey === k)).join('')}
          </div>
          <label class="field ${draft.reasonKey === 'Other' ? '' : 'is-hidden'}" id="reason-other">
            <span class="field-label">${esc(t('flow.reasonInput'))}</span>
            <input type="text" name="reasonText" maxlength="60" autocomplete="off" value="${esc(draft.reasonText || '')}">
          </label>
          <p class="hint">${esc(t('flow.reasonOptional'))}</p>
        </fieldset>
        <fieldset class="field-group">
          <legend class="field-label">${esc(t('flow.deadline'))}</legend>
          <div class="chip-row" role="radiogroup">
            ${chip('deadline', 'd24', t('flow.d24'), draft.deadlineMode === 'd24', !opts.d24.ok)}
            ${chip('deadline', 'd2h', t('flow.d2h'), draft.deadlineMode === 'd2h', !opts.d2h.ok)}
            ${chip('deadline', 'custom', t('flow.dCustom'), draft.deadlineMode === 'custom')}
          </div>
          ${!opts.d24.ok || !opts.d2h.ok ? `<p class="hint">${esc(t('flow.dUnavailable'))}</p>` : ''}
          <label class="field ${draft.deadlineMode === 'custom' ? '' : 'is-hidden'}" id="deadline-custom">
            <span class="field-label">${esc(t('flow.dCustomLabel'))}</span>
            <input type="datetime-local" name="deadlineCustom" class="num" value="${esc(draft.deadline || '')}" max="${esc(start)}">
          </label>
          <p class="sentence" id="deadline-sentence" aria-live="polite">${icon('clock')}<span>${esc(sentence())}</span></p>
        </fieldset>
      </form>
    </div>`;

  const form = view.querySelector('#s2');
  const refreshBits = () => {
    view.querySelector('#reason-other').classList.toggle('is-hidden', draft.reasonKey !== 'Other');
    view.querySelector('#deadline-custom').classList.toggle('is-hidden', draft.deadlineMode !== 'custom');
    view.querySelector('#deadline-sentence span').textContent = sentence();
    view.querySelector('.cta-bar').innerHTML = ctaHtml();
    bindNext();
    saveDraft(draft);
  };
  form.querySelectorAll('input[name="reason"]').forEach((r) => r.addEventListener('change', () => { draft.reasonKey = r.value; refreshBits(); }));
  form.reasonText.addEventListener('input', () => { draft.reasonText = form.reasonText.value; saveDraft(draft); });
  form.querySelectorAll('input[name="deadline"]').forEach((r) => r.addEventListener('change', () => {
    draft.deadlineMode = r.value;
    draft.deadline = r.value === 'custom' ? (form.deadlineCustom.value || draft.deadline) : opts[r.value].value;
    if (r.value === 'custom') form.deadlineCustom.value = draft.deadline;
    refreshBits();
  }));
  form.deadlineCustom.addEventListener('change', () => { draft.deadline = form.deadlineCustom.value.slice(0, 16); refreshBits(); });
  const bindNext = () => {
    const next = view.querySelector('#next');
    if (next && !next.disabled) next.addEventListener('click', () => ctx.go('#/swaps/new/3'));
  };
  bindNext();
}

function reasonOf(draft) {
  if (!draft.reasonKey) return '';
  if (draft.reasonKey === 'Other') return (draft.reasonText || '').trim();
  return t(`flow.reason${draft.reasonKey}`);
}

function flowStep3(view, ctx, draft, shift) {
  const candidates = svc.previewCandidates(shift.id, ctx.user.id);
  const reason = reasonOf(draft);
  const cta = button({ label: t('flow.send'), kind: 'primary', block: true, id: 'send' });
  view.innerHTML = `
    ${flowHead(3, '#/swaps/new/2', ctx)}
    <div class="flow-body">
      ${pageHead({ title: t('flow.s3Title'), cta })}
      <form id="s3">
        <dl class="card summary-list">
          <div><dt>${esc(t('flow.shift'))}</dt><dd class="num">${esc(fmtShift(shift))}</dd></div>
          <div><dt>${esc(t('flow.reason'))}</dt><dd>${esc(reason || t('flow.reasonNone'))}</dd></div>
          <div><dt>${esc(t('flow.deadline'))}</dt><dd>${esc(t('common.until', { when: fmtWhen(draft.deadline, ctx.now) }))}</dd></div>
        </dl>
      </form>
      <section class="section">
        ${sectionHead(t('flow.to'), candidates.length || null)}
        ${candidates.length ? `
          <ul class="card people">${candidates.map((c) => `<li><span class="avatar" aria-hidden="true">${esc(initial(c.name))}</span><span>${esc(displayName(c.name))}</span></li>`).join('')}</ul>
          <p class="hint">${esc(t('flow.toCount', { n: candidates.length }))}</p>`
    : `<p class="notice notice-warn">${icon('alert')}<span>${esc(t('flow.toNone'))}</span></p>`}
      </section>
    </div>`;
  view.querySelector('#send').addEventListener('click', () => {
    try {
      const res = svc.createSubRequest({ shiftId: shift.id, requesterId: ctx.user.id, reason, deadline: draft.deadline });
      saveDraft({ result: { id: res.id, status: res.status, candidates: res.candidates.map((c) => c.name), shift: { workDate: shift.workDate, startTime: shift.startTime, endTime: shift.endTime } } });
      ctx.go('#/swaps/new/done');
    } catch (err) {
      showFormError(view.querySelector('#s3'), err);
    }
  });
}

function flowDone(view, ctx, draft) {
  const res = draft.result;
  if (!res) {
    ctx.go('#/swaps');
    return;
  }
  const failed = res.status === 'FAILED';
  const cta = button({ label: t('common.goHome'), kind: 'primary', block: true, id: 'home' });
  view.innerHTML = `
    ${flowHead(4, null, ctx)}
    <div class="flow-body flow-done">
      <div class="done-mark ${failed ? 'is-alert' : ''}" aria-hidden="true">${icon(failed ? 'alert' : 'check')}</div>
      ${pageHead({ title: t(failed ? 'flow.doneFailedTitle' : 'flow.doneTitle'), sub: fmtShift(res.shift), cta })}
      <div class="card">${tracker(failed ? 'FAILED' : 'REQUESTED')}
        <p class="status-line">${esc(failed ? t('flow.doneNone') : t('flow.doneSent', { names: joinPeople(res.candidates) }))}</p>
      </div>
    </div>`;
  view.querySelector('#home').addEventListener('click', () => { clearDraft(); ctx.go('#/home'); });
  view.querySelector('[data-exit]').addEventListener('click', clearDraft);
}
