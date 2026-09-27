// UC-09 Monthly payroll: generate a draft, acknowledge minimum-wage warnings (BR-09), confirm (FR-15, FR-16).
import * as svc from '../core/services.js';
import { now } from '../core/clock.js';
import { minimumWageFor, probationApplies } from '../core/rules.js';
import { t, esc, fmtHours, fmtWon } from './i18n.js';

export function render(view, ctx) {
  const month = /^\d{4}-\d{2}$/.test(ctx.args[0] || '') ? ctx.args[0] : now().slice(0, 7);
  const rows = svc.getPayroll(month);
  const { workplace, minimumWages } = svc.getSettings();
  const year = Number(month.slice(0, 4));
  const minimum = minimumWageFor(year, minimumWages);
  const drafts = rows.filter((r) => r.status === 'DRAFT');
  const unacknowledged = drafts.filter((r) => r.minWageWarning && !r.minWageAck);
  const cols = ['payroll.baseHours', 'payroll.basePay', 'payroll.holidayPay', 'payroll.premiumPay', 'payroll.total', 'payroll.flags'];
  const sum = rows.reduce((a, r) => a + r.total, 0);

  view.innerHTML = `
    <div class="page-head"><h1>${esc(t('payroll.title'))}</h1></div>
    <form class="toolbar" id="month-form">
      <label>${esc(t('payroll.month'))} <input type="month" name="month" class="num" value="${esc(month)}" required></label>
      <button type="submit" class="btn btn-primary">${esc(t('payroll.generate'))}</button>
    </form>
    <p class="muted">${esc(t('payroll.premiumNote', { n: workplace.regularEmployees }))}</p>
    ${rows.length ? `
    <table class="rtable">
      <thead><tr><th scope="col">${esc(t('common.worker'))}</th>${cols.map((c) => `<th scope="col">${esc(t(c))}</th>`).join('')}</tr></thead>
      <tbody>
        ${rows.map((r) => {
          const w = svc.getWorker(r.workerId);
          const date = w.contractStart && w.contractStart > `${month}-01` ? w.contractStart : `${month}-01`;
          const probation = probationApplies(w, date);
          return `
          <tr class="${r.minWageWarning ? 'row-warning' : ''}">
            <th scope="row">${esc(r.workerName)}</th>
            <td data-label="${esc(t(cols[0]))}" class="num">${esc(fmtHours(r.baseHours))}</td>
            <td data-label="${esc(t(cols[1]))}" class="num">${esc(fmtWon(r.basePay))}</td>
            <td data-label="${esc(t(cols[2]))}" class="num">${esc(fmtWon(r.holidayPay))}</td>
            <td data-label="${esc(t(cols[3]))}" class="num">${esc(fmtWon(r.premiumPay))}</td>
            <td data-label="${esc(t(cols[4]))}" class="num strong">${esc(fmtWon(r.total))}</td>
            <td data-label="${esc(t(cols[5]))}" class="flags">
              <span class="chip ${r.status === 'CONFIRMED' ? 'chip-ok' : ''}">${esc(t(`payroll.status${r.status}`))}</span>
              ${r.estimated ? `<span class="chip">${esc(t('payroll.estimated'))}</span>` : ''}
              ${r.minWageWarning ? `<span class="chip chip-alert">${esc(t('payroll.belowMin'))}</span>` : ''}
              ${probation ? `<span class="chip">${esc(t('payroll.probation'))}</span>` : ''}
            </td>
          </tr>
          ${r.minWageWarning ? `<tr class="warning-row"><td colspan="7"><div class="notice notice-alert warning-box">
            <p>${esc(t('payroll.warning', {
              name: r.workerName, wage: Number(r.hourlyWage).toLocaleString('en-US'), year, min: Number(minimum * (probation ? 0.9 : 1)).toLocaleString('en-US'),
            }))}</p>
            ${r.minWageAck
              ? `<span class="chip chip-ok">${esc(t('payroll.acknowledged'))}</span>`
              : `<button type="button" class="btn btn-small" data-ack="${r.workerId}">${esc(t('payroll.acknowledge'))}</button>`}
          </div></td></tr>` : ''}`;
        }).join('')}
      </tbody>
      <tfoot><tr><th scope="row">${esc(t('payroll.sum'))}</th><td colspan="4"></td><td class="num strong" data-label="${esc(t('payroll.total'))}">${esc(fmtWon(sum))}</td><td></td></tr></tfoot>
    </table>
    ${rows.some((r) => r.estimated) ? `<p class="hint">${esc(t('payroll.estimatedHint'))}</p>` : ''}
    ${drafts.length ? `
    <form class="card form" id="confirm-form">
      ${unacknowledged.length ? `<p class="hint" id="confirm-hint">${esc(t('payroll.ackNeeded', { n: unacknowledged.length }))}</p>` : ''}
      <div class="actions"><button type="submit" class="btn btn-primary" ${unacknowledged.length ? 'disabled aria-describedby="confirm-hint"' : ''}>${esc(t('payroll.confirm'))}</button></div>
    </form>` : `<p class="notice notice-ok">${esc(t('payroll.allConfirmed'))}</p>`}`
    : `<p class="empty">${esc(t('payroll.none'))}</p>`}`;

  view.querySelector('#month-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const chosen = new FormData(e.target).get('month');
    try {
      svc.generatePayroll(chosen);
      ctx.flash(t('payroll.generated'));
      ctx.go(`#/payroll/${chosen}`);
    } catch (err) {
      ctx.fail(err);
    }
  });
  view.querySelector('input[name="month"]').addEventListener('change', (e) => {
    if (/^\d{4}-\d{2}$/.test(e.target.value)) ctx.go(`#/payroll/${e.target.value}`);
  });
  view.querySelectorAll('[data-ack]').forEach((b) => b.addEventListener('click', () => {
    try {
      svc.acknowledgeMinWage(month, Number(b.dataset.ack));
      ctx.flash(t('payroll.acknowledgedMsg'));
      ctx.refresh();
    } catch (err) {
      ctx.fail(err);
    }
  }));
  const confirmForm = view.querySelector('#confirm-form');
  if (!confirmForm) return;
  confirmForm.addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      svc.confirmPayroll(month);
      ctx.flash(t('payroll.confirmedMsg'));
      ctx.refresh();
    } catch (err) {
      ctx.fail(err);
    }
  });
}
