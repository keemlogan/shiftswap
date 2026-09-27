// UC-04 Request substitute (form) and UC-12 My requests (list with Cancel).
import * as svc from '../core/services.js';
import { t, esc, fmtShift, fmtDateTime, showFormError } from './i18n.js';

let lastResult = null;

export function render(view, ctx) {
  const { user, args } = ctx;
  const shifts = svc.listRequestableShifts(user.id);
  const chosenId = args[0] === 'new' ? Number(args[1]) : null;
  const chosen = shifts.find((s) => s.id === chosenId) || shifts[0];
  const mine = svc.listMyRequests(user.id);
  const result = lastResult;
  lastResult = null;

  view.innerHTML = `
    <div class="page-head"><h1>${esc(t('requests.title'))}</h1></div>
    ${result ? resultPanel(result) : ''}
    <form class="card form" id="request-form">
      <h2>${esc(t('requests.newTitle'))}</h2>
      ${shifts.length ? `
      <div class="fields">
        <label class="wide">${esc(t('requests.shift'))}
          <select name="shiftId" id="shift-select">
            ${shifts.map((s) => `<option value="${s.id}" ${s.id === chosen.id ? 'selected' : ''}>${esc(fmtShift(s))}</option>`).join('')}
          </select>
        </label>
        <label class="wide">${esc(t('requests.reason'))}
          <input type="text" name="reason" maxlength="200" autocomplete="off">
        </label>
        <label>${esc(t('requests.deadline'))}
          <input type="datetime-local" name="deadline" id="deadline" class="num" value="${esc(svc.defaultDeadline(chosen))}" required aria-describedby="deadline-hint">
        </label>
      </div>
      <p class="hint" id="deadline-hint">${esc(t('requests.deadlineHint'))}</p>
      <div class="actions"><button type="submit" class="btn btn-primary">${esc(t('requests.submit'))}</button></div>`
      : `<p class="empty">${esc(t('requests.noShifts'))}</p>`}
    </form>
    <section class="stack" aria-labelledby="mine-title">
      <h2 id="mine-title">${esc(t('requests.title'))}</h2>
      ${mine.length ? mine.map(requestCard).join('') : `<p class="empty">${esc(t('requests.none'))}</p>`}
    </section>`;

  const form = view.querySelector('#request-form');
  const select = view.querySelector('#shift-select');
  if (select) {
    select.addEventListener('change', () => {
      const s = shifts.find((x) => x.id === Number(select.value));
      view.querySelector('#deadline').value = svc.defaultDeadline(s);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      try {
        const res = svc.createSubRequest({ shiftId: Number(data.shiftId), requesterId: user.id, reason: data.reason, deadline: data.deadline.slice(0, 16) });
        lastResult = res;
        ctx.go('#/requests');
      } catch (err) {
        showFormError(form, err);
      }
    });
  }
  view.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => {
    try {
      svc.cancelRequest(Number(b.dataset.cancel), user.id);
      ctx.flash(t('requests.cancelled'));
      ctx.refresh();
    } catch (err) {
      ctx.fail(err);
    }
  }));
}

function resultPanel(res) {
  if (!res.candidates.length) {
    return `<div class="notice notice-alert" role="status">${esc(t('requests.noCandidate'))}</div>`;
  }
  return `<div class="notice notice-ok" role="status">
    <p>${esc(t('requests.sentTo'))}</p>
    <ul class="plain">${res.candidates.map((c) => `<li>${esc(c.name)}</li>`).join('')}</ul>
  </div>`;
}

export function statusChip(status) {
  const tone = { REQUESTED: 'chip-handover', ACCEPTED: 'chip-shift', APPROVED: 'chip-ok', REJECTED: 'chip-alert', EXPIRED: '', CANCELLED: '' }[status];
  return `<span class="chip ${tone}">${esc(t(`request.${status}`))}</span>`;
}

function requestCard(r) {
  const open = r.status === 'REQUESTED' || r.status === 'ACCEPTED';
  return `
    <article class="card request">
      <div class="request-head">
        <h3 class="num-title">${esc(fmtShift(r))}</h3>
        ${statusChip(r.status)}
      </div>
      <p class="muted">${esc(t('requests.deadlineAt', { when: fmtDateTime(r.deadline) }))}${r.reason ? ` · ${esc(t('requests.reasonText', { text: r.reason }))}` : ''}</p>
      ${r.acceptorName ? `<p>${esc(t('requests.acceptor', { name: r.acceptorName }))}</p>` : ''}
      <p class="targets"><span class="muted">${esc(t('requests.candidates'))}:</span>
        ${r.targets.length ? r.targets.map((x) => `${esc(x.workerName)} <span class="chip">${esc(t(`target.${x.response}`))}</span>`).join(' ') : esc(t('requests.noTargets'))}
      </p>
      ${open ? `<div class="actions"><button type="button" class="btn btn-danger" data-cancel="${r.id}">${esc(t('requests.cancel'))}</button></div>` : ''}
    </article>`;
}
