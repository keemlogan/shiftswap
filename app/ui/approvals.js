// UC-06 Approve or reject substitution, with the FR-11 before/after comparison panel.
import * as svc from '../core/services.js';
import { t, esc, fmtShift, fmtDay, fmtDateTime, fmtHours, pageHead, emptyState } from './i18n.js';
import { statusChip } from './requests.js';

export function render(view, ctx) {
  const all = svc.listOwnerRequests();
  const accepted = all.filter((r) => r.status === 'ACCEPTED');
  const open = all.filter((r) => r.status === 'REQUESTED');
  const selectedId = Number(ctx.args[0]) || null;
  const selected = accepted.find((r) => r.id === selectedId);

  view.innerHTML = `
    ${pageHead(t('approvals.title'), t('purpose.approvals'))}
    ${selectedId && !selected ? `<p class="notice notice-alert" role="status">${esc(t('approvals.gone'))}</p>` : ''}
    <section class="group stack" aria-labelledby="waiting-title">
      <h2 id="waiting-title">${esc(t('approvals.waiting'))}</h2>
      ${accepted.length ? accepted.map((r) => acceptedCard(r, r.id === selectedId)).join('') : emptyState(t('approvals.noneWaiting'), `<button type="button" class="btn" data-scroll="open-title">${esc(t('approvals.noneWaitingAction'))}</button>`)}
    </section>
    <section class="group stack" aria-labelledby="open-title">
      <h2 id="open-title" tabindex="-1">${esc(t('approvals.open'))}</h2>
      ${open.length ? open.map(openCard).join('') : `<p class="empty">${esc(t('approvals.noneOpen'))}</p>`}
    </section>`;

  view.querySelectorAll('[data-scroll]').forEach((b) => b.addEventListener('click', () => {
    const target = view.querySelector(`#${b.dataset.scroll}`);
    target.scrollIntoView({ block: 'start' });
    target.focus();
  }));
  view.querySelectorAll('[data-decide]').forEach((b) => b.addEventListener('click', () => {
    const decision = b.dataset.decide;
    const r = accepted.find((x) => x.id === Number(b.dataset.request));
    try {
      svc.decideRequest(r.id, decision);
      ctx.flash(decision === 'APPROVED' ? t('approvals.approved') : t('approvals.rejected', { name: r.requesterName }));
      ctx.go('#/approvals');
    } catch (err) {
      ctx.fail(err);
    }
  }));
}

function acceptedCard(r, expanded) {
  return `
    <article class="card request">
      <div class="request-head">
        <h3>${esc(t('approvals.swapLine', { requester: r.requesterName, acceptor: r.acceptorName }))}</h3>
        ${statusChip(r.status)}
      </div>
      <p class="num-title">${esc(fmtShift(r))}</p>
      ${r.reason ? `<p class="muted">${esc(t('requests.reasonText', { text: r.reason }))}</p>` : ''}
      ${expanded ? comparison(r) : `<div class="actions"><a class="btn btn-primary" href="#/approvals/${r.id}">${esc(t('approvals.review'))}</a></div>`}
    </article>`;
}

function eligibleText(v) {
  return t(`eligible.${v}`);
}

function comparison(r) {
  const preview = svc.getApprovalPreview(r.id);
  const changed = preview.rows.filter((row) => row.eligibilityChanged);
  const cell = (label, value) => `<td data-label="${esc(label)}">${value}</td>`;
  const rows = preview.rows.map((row) => ['before', 'after'].map((phase, i) => {
    const s = row[phase];
    return `
      <tr class="${row.eligibilityChanged ? 'row-changed' : ''} ${i === 0 ? 'row-first' : ''}">
        ${i === 0 ? `<th scope="rowgroup" rowspan="2" class="person">${esc(row.name)}<span class="muted block">${esc(t(`approvals.${row.role}`))}</span></th>` : ''}
        <th scope="row" class="phase">${esc(t(`approvals.${phase}`))}</th>
        ${cell(t('approvals.contract'), `<span class="num">${esc(fmtHours(s.contractHours))}</span>`)}
        ${cell(t('approvals.scheduled'), `<span class="num">${esc(fmtHours(s.scheduledHours))}</span>`)}
        ${cell(t('approvals.eligible'), `<span class="chip ${s.holidayEligible ? 'chip-ok' : ''}">${esc(eligibleText(s.holidayEligible))}</span>`)}
        ${cell(t('approvals.holidayHours'), `<span class="num">${esc(fmtHours(s.holidayHours))}</span>`)}
      </tr>`;
  }).join('')).join('');
  return `
    <div class="compare">
      <h4>${esc(t('approvals.compareTitle', { week: fmtDay(preview.weekStart) }))}</h4>
      <table class="rtable compare-table">
        <thead><tr>
          <th scope="col">${esc(t('approvals.person'))}</th><th scope="col"><span class="sr-only">${esc(t('approvals.before'))} / ${esc(t('approvals.after'))}</span></th>
          <th scope="col">${esc(t('approvals.contract'))}</th><th scope="col">${esc(t('approvals.scheduled'))}</th>
          <th scope="col">${esc(t('approvals.eligible'))}</th><th scope="col">${esc(t('approvals.holidayHours'))}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${changed.length
    ? changed.map((row) => `<p class="notice notice-alert">${esc(t('approvals.changed', { name: row.name, from: eligibleText(row.before.holidayEligible), to: eligibleText(row.after.holidayEligible) }))}</p>`).join('')
    : `<p class="notice">${esc(t('approvals.unchanged'))}</p>`}
      <div class="actions">
        <button type="button" class="btn btn-primary" data-decide="APPROVED" data-request="${r.id}">${esc(t('approvals.approve'))}</button>
        <button type="button" class="btn btn-danger" data-decide="REJECTED" data-request="${r.id}">${esc(t('approvals.reject'))}</button>
        <a class="btn btn-quiet" href="#/approvals">${esc(t('common.close'))}</a>
      </div>
    </div>`;
}

function openCard(r) {
  return `
    <article class="card request">
      <div class="request-head">
        <h3>${esc(r.requesterName)} · <span class="num-title">${esc(fmtShift(r))}</span></h3>
        ${statusChip(r.status)}
      </div>
      <p class="muted">${esc(t('requests.deadlineAt', { when: fmtDateTime(r.deadline) }))}${r.reason ? ` · ${esc(t('requests.reasonText', { text: r.reason }))}` : ''}</p>
      <p class="targets"><span class="muted">${esc(t('requests.candidates'))}:</span>
        ${r.targets.length ? r.targets.map((x) => `${esc(x.workerName)} <span class="chip">${esc(t(`target.${x.response}`))}</span>`).join(' ') : esc(t('requests.noTargets'))}
      </p>
    </article>`;
}
