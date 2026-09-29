// Pay (owner, prompt §2.7): Weekly summary (UC-08) and Monthly payroll (UC-09) as two segments. The monthly
// primary action is "create draft" or "confirm", disabled with its reason until every minimum-wage warning
// is acknowledged (BR-09). The month switcher reaches back to the first contract month; confirmed months are
// read-only and a draft the System Clock prepared (UC-14) says so.
import * as svc from '../core/services.js';
import { minimumWageFor, probationApplies, weekStartOf, addDays, addMonths } from '../core/rules.js';
import { t, esc, fmtHours, fmtWon, fmtMonth, fmtMonthShort, fmtDateShort, given, displayName } from './i18n.js';
import { icon, button, pageHead, emptyState } from './components.js';
import { weeklyCards } from './weekly.js';
import { weekNav } from './schedule.js';

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

function segments(active, week, month) {
  return `
    <div class="segmented" role="tablist" aria-label="${esc(t('pay.title'))}">
      <a role="tab" href="#/pay/week/${week}" aria-selected="${active === 'week'}" class="${active === 'week' ? 'is-active' : ''}">${esc(t('pay.weekly'))}</a>
      <a role="tab" href="#/pay/month/${month}" aria-selected="${active === 'month'}" class="${active === 'month' ? 'is-active' : ''}">${esc(t('pay.monthly'))}</a>
    </div>`;
}

/** The first month with payroll history: the month of the earliest contractStart (spec §10, BR-14). */
function firstMonth() {
  const months = svc.listPayrollMonths().map((m) => m.yearMonth).sort();
  return months[0] || null;
}

/** ‹ month › switcher; ‹ stops at the first contract month. The label carries the month's payroll status. */
function monthNav(month, status) {
  const prev = addMonths(`${month}-01`, -1).slice(0, 7);
  const next = addMonths(`${month}-01`, 1).slice(0, 7);
  const first = firstMonth();
  const chip = status === 'CONFIRMED' ? `<span class="chip chip-ok">${esc(t('pay.monthConfirmed'))}</span>`
    : status === 'DRAFT' ? `<span class="chip chip-shift">${esc(t('pay.monthDraft'))}</span>` : '';
  return `
    <nav class="period-nav" aria-label="${esc(fmtMonth(month))}">
      ${first && prev < first ? '<span class="icon-btn-spacer" aria-hidden="true"></span>'
        : `<a class="icon-btn" href="#/pay/month/${prev}" aria-label="${esc(t('common.prevMonth'))}">${icon('chevronLeft')}</a>`}
      <p class="period-label">${esc(fmtMonth(month))}</p>
      <a class="icon-btn" href="#/pay/month/${next}" aria-label="${esc(t('common.nextMonth'))}">${icon('chevronRight')}</a>
      ${chip}
    </nav>`;
}

export function render(view, ctx) {
  const seg = ctx.args[0] === 'week' ? 'week' : 'month';
  const today = ctx.now.slice(0, 10);
  const week = seg === 'week' && /^\d{4}-\d{2}-\d{2}$/.test(ctx.args[1] || '') ? weekStartOf(ctx.args[1]) : weekStartOf(today);
  const month = seg === 'month' && YM.test(ctx.args[1] || '') ? ctx.args[1] : (seg === 'week' ? addDays(week, 6).slice(0, 7) : today.slice(0, 7));
  if (seg === 'week') renderWeek(view, ctx, week, month);
  else renderMonth(view, ctx, week, month);
}

function renderWeek(view, ctx, week, month) {
  const policy = svc.getWorkplace().subAttendancePolicy;
  const cta = button({ label: t('pay.toMonth', { month: fmtMonthShort(month) }), kind: 'primary', block: true, href: `#/pay/month/${month}` });
  view.innerHTML = `
    ${pageHead({ title: t('pay.title'), cta })}
    ${segments('week', week, month)}
    ${weekNav('pay/week', week, ctx.now, t('common.weekOf', { date: fmtDateShort(week) }))}
    <p class="muted">${esc(t(`pay.policyNote${policy}`))}</p>
    ${weeklyCards(week)}`;
}

function renderMonth(view, ctx, week, month) {
  const rows = svc.getPayroll(month);
  const { workplace, minimumWages } = svc.getSettings();
  const year = Number(month.slice(0, 4));
  const minimum = minimumWageFor(year, minimumWages);
  const drafts = rows.filter((r) => r.status === 'DRAFT');
  const open = drafts.filter((r) => r.minWageWarning && !r.minWageAck);
  const m = fmtMonthShort(month);
  const status = !rows.length ? 'NONE' : drafts.length ? 'DRAFT' : 'CONFIRMED';
  const auto = drafts.length > 0 && rows.some((r) => r.autoPrepared);

  let cta;
  if (!rows.length) cta = button({ label: t('pay.makeDraft', { month: m }), kind: 'primary', block: true, id: 'make-draft' });
  else if (drafts.length) cta = button({ label: t('pay.confirm', { month: m }), kind: 'primary', block: true, id: 'confirm', disabled: open.length > 0, reason: t('pay.confirmBlocked', { n: open.length }) });
  else cta = button({ label: t('pay.confirmedButton', { month: m }), kind: 'primary', block: true, disabled: true, reason: t('pay.confirmedNote', { month: m }) });

  const cols = ['pay.baseHours', 'pay.basePay', 'pay.holidayPay', 'pay.premiumPay', 'pay.total'];
  const sum = rows.reduce((a, r) => a + r.total, 0);
  const table = rows.length ? `
    <table class="dtable pay-table">
      <thead><tr><th scope="col">${esc(t('pay.worker'))}</th>${cols.map((c) => `<th scope="col" class="numh">${esc(t(c))}</th>`).join('')}<th scope="col">${esc(t('pay.flags'))}</th></tr></thead>
      <tbody>
        ${rows.map((r) => {
          const w = svc.getWorker(r.workerId);
          const first = `${month}-01`;
          const probation = probationApplies(w, w.contractStart && w.contractStart > first ? w.contractStart : first);
          const flags = [
            `<span class="chip ${r.status === 'CONFIRMED' ? 'chip-ok' : ''}">${esc(t(`pay.status${r.status}`))}</span>`,
            r.estimated ? `<span class="chip">${esc(t('pay.estimated'))}</span>` : '',
            probation ? `<span class="chip">${esc(t('pay.probation'))}</span>` : '',
            r.minWageWarning ? `<span class="chip chip-alert">${esc(t('pay.belowMin'))}</span>` : '',
          ].join('');
          return `
          <tr class="${r.minWageWarning ? 'row-warning' : ''}">
            <th scope="row">${esc(displayName(r.workerName))}</th>
            <td class="num" data-label="${esc(t(cols[0]))}">${esc(fmtHours(r.baseHours))}</td>
            <td class="num" data-label="${esc(t(cols[1]))}">${esc(fmtWon(r.basePay))}</td>
            <td class="num" data-label="${esc(t(cols[2]))}">${esc(fmtWon(r.holidayPay))}</td>
            <td class="num" data-label="${esc(t(cols[3]))}">${esc(fmtWon(r.premiumPay))}</td>
            <td class="num strong" data-label="${esc(t(cols[4]))}">${esc(fmtWon(r.total))}</td>
            <td class="flags" data-label="${esc(t('pay.flags'))}">${flags}</td>
          </tr>
          ${r.minWageWarning ? `<tr class="warning-row"><td colspan="7">
            <div class="warning-box">
              <p>${esc(t('pay.minSentence', { name: given(r.workerName), wage: fmtWon(r.hourlyWage), year, min: fmtWon(Math.round(minimum * (probation ? 0.9 : 1))) }))}</p>
              ${r.minWageAck ? `<span class="chip chip-ok">${esc(t('pay.acked'))}</span>` : button({ label: t('pay.ack'), kind: 'secondary', small: true, attrs: `data-ack="${r.workerId}"` })}
            </div></td></tr>` : ''}`;
        }).join('')}
      </tbody>
      <tfoot><tr><th scope="row">${esc(t('pay.sum'))}</th><td colspan="4" class="spacer"></td><td class="num strong" data-label="${esc(t('pay.total'))}">${esc(fmtWon(sum))}</td><td class="spacer"></td></tr></tfoot>
    </table>` : emptyState(t('pay.noDraft', { month: fmtMonth(month) }));

  view.innerHTML = `
    ${pageHead({ title: t('pay.title'), cta })}
    ${segments('month', week, month)}
    ${monthNav(month, status)}
    ${status === 'CONFIRMED' ? `<p class="notice notice-ok">${esc(t('pay.confirmedNote', { month: m }))}</p>` : ''}
    ${auto ? `<p class="notice">${icon('clock')}<span>${esc(t('pay.autoNote'))}</span></p>` : ''}
    ${table}
    ${rows.length ? `<div class="notes">
      ${rows.some((r) => r.estimated) ? `<p class="hint">${esc(t('pay.estimatedHint'))}</p>` : ''}
      <p class="hint">${esc(t('pay.premiumNote', { n: workplace.regularEmployees }))}</p>
      ${drafts.length ? button({ label: t('pay.remake'), kind: 'text', id: 'remake' }) : ''}
    </div>` : ''}`;

  const make = async () => {
    try {
      await ctx.run(() => svc.generatePayroll(month));
      ctx.toast(t('pay.drafted', { month: m }));
      ctx.go(`#/pay/month/${month}`);
    } catch (err) {
      ctx.fail(err);
    }
  };
  const makeBtn = view.querySelector('#make-draft');
  if (makeBtn) makeBtn.addEventListener('click', make);
  const remake = view.querySelector('#remake');
  if (remake) remake.addEventListener('click', make);
  view.querySelectorAll('[data-ack]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await ctx.run(() => svc.acknowledgeMinWage(month, Number(b.dataset.ack)));
      ctx.toast(t('pay.ackDone'));
      ctx.refresh();
    } catch (err) {
      ctx.fail(err);
    }
  }));
  const confirm = view.querySelector('#confirm');
  if (confirm && !confirm.disabled) confirm.addEventListener('click', async () => {
    try {
      await ctx.run(() => svc.confirmPayroll(month));
      ctx.toast(t('pay.confirmed', { month: m }));
      ctx.refresh();
    } catch (err) {
      ctx.fail(err);
    }
  });
}
