// UC-06 Approve or reject substitution: the owner's decision card (prompt §2.5) with the effect of the swap on
// both people (FR-11) and the full before/after table behind "Details". Also the effect sentences reused by
// the worker's accept card (NFR-13: consequence before commitment).
import * as svc from '../core/services.js';
import { t, esc, fmtShift, fmtWhen, fmtHours, fmtWon, given, displayName, dayLong } from './i18n.js';
import { icon, button } from './components.js';

/**
 * Effect of a swap on one person, as sentences: hours this week before → after, and holiday allowance
 * (unchanged amount, none either way, or a highlighted change). mode 'accept' speaks to the acceptor,
 * mode 'owner' names the person.
 */
export function effectLines(row, mode) {
  const b = row.before;
  const a = row.after;
  const hours = mode === 'accept'
    ? t('effect.accept', { from: fmtHours(b.scheduledHours), to: fmtHours(a.scheduledHours) })
    : `${t('owner.person', { name: given(row.name) })} ${t('effect.hours', { from: fmtHours(b.scheduledHours), to: fmtHours(a.scheduledHours) })}`;
  let holiday = '';
  let change = '';
  if (row.eligibilityChanged || b.holidayPay !== a.holidayPay) {
    const from = b.holidayEligible ? fmtWon(b.holidayPay) : t('eligible.false');
    const to = a.holidayEligible ? fmtWon(a.holidayPay) : t('eligible.false');
    change = `<p class="effect-change">${icon('alert')}<span><strong>${esc(t('owner.eligibilityChanges'))}</strong> · ${esc(t('effect.holidayChanged', { from, to }))}</span></p>`;
  } else if (a.holidayEligible) {
    holiday = t(mode === 'accept' ? 'effect.holidaySame' : 'effect.holidayKeep', { amount: fmtWon(a.holidayPay) });
  } else {
    holiday = t('effect.holidayNoneSame', { h: t('common.perWeek', { h: a.contractHours }) });
  }
  return `
    <div class="effect ${change ? 'effect-changed' : ''}">
      <p><span class="num">${esc(hours)}</span>${holiday ? ` · ${esc(holiday)}` : ''}</p>
      ${change}
    </div>`;
}

function detailsTable(d) {
  const items = [
    ['table.contract', (x) => fmtHours(x.contractHours)],
    ['table.scheduled', (x) => fmtHours(x.scheduledHours)],
    ['table.eligible', (x) => t(`eligible.${x.holidayEligible}`)],
    ['table.holidayHours', (x) => fmtHours(x.holidayHours)],
    ['table.holidayPay', (x) => fmtWon(x.holidayPay)],
  ];
  return d.rows.map((row) => `
    <table class="compare">
      <caption>${esc(displayName(row.name))}</caption>
      <thead><tr><th scope="col"><span class="sr-only">${esc(t('table.person'))}</span></th><th scope="col">${esc(t('table.before'))}</th><th scope="col">${esc(t('table.after'))}</th></tr></thead>
      <tbody>${items.map(([key, f]) => {
        const b = f(row.before);
        const a = f(row.after);
        return `<tr class="${b !== a ? 'is-changed' : ''}"><th scope="row">${esc(t(key))}</th><td class="num">${esc(b)}</td><td class="num">${esc(a)}</td></tr>`;
      }).join('')}</tbody>
    </table>`).join('');
}

/** Decision card for one ACCEPTED request (the approve button is the screen's primary action when `primary`). */
export function decisionCard(d, { primary }) {
  const [req, acc] = d.rows;
  return `
    <article class="card decision-card" aria-labelledby="dec-${d.id}">
      <h3 class="card-title" id="dec-${d.id}">${esc(t('owner.covers', { req: given(req.name), acc: given(acc.name), shift: fmtShift(d) }))}</h3>
      ${d.reason ? `<p class="muted">${esc(t('home.reason', { text: d.reason }))}</p>` : ''}
      <div class="effects">${effectLines(req, 'owner')}${effectLines(acc, 'owner')}</div>
      ${acc.overtime && acc.overtime.warn ? `<p class="notice notice-warn">${icon('alert')}<span>${esc(t('owner.overtimeWarn', { name: given(acc.name), h: fmtHours(acc.overtime.beyondContract) }))}</span></p>` : ''}
      <div class="details is-hidden" id="details-${d.id}">${detailsTable(d)}</div>
      <div class="actions">
        ${button({ label: t('owner.approve'), kind: primary ? 'primary' : 'secondary', block: true, attrs: `data-approve="${d.id}" data-acc="${esc(given(acc.name))}" data-day="${esc(dayLong(d.workDate))}"` })}
        ${button({ label: t('owner.reject'), kind: 'text', attrs: `data-reject="${d.id}" data-req="${esc(given(req.name))}"` })}
        ${button({ label: t('owner.details'), kind: 'text', attrs: `data-details="${d.id}" aria-expanded="false" aria-controls="details-${d.id}"` })}
      </div>
    </article>`;
}

/** An open (REQUESTED) request, read-only for the owner, with the deadline and every candidate's answer. */
export function openRequestCard(r, now) {
  return `
    <article class="card req-card">
      <div class="card-row"><h3 class="card-title">${esc(t('owner.openLine', { name: given(r.requesterName), shift: fmtShift(r) }))}</h3></div>
      <p class="deadline">${icon('clock')}<span>${esc(t('common.until', { when: fmtWhen(r.deadline, now) }))}</span></p>
      ${r.targets.length
    ? `<ul class="answers">${r.targets.map((x) => `<li class="answer answer-${x.response.toLowerCase()}">${esc(t('answer.line', { name: given(x.workerName), answer: t(`answer.${x.response}`) }))}</li>`).join('')}</ul>`
    : `<p class="muted">${esc(t('answer.none'))}</p>`}
    </article>`;
}

export function bindDecisionActions(view, ctx) {
  view.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await ctx.run(() => svc.decideRequest(Number(b.dataset.approve), 'APPROVED'));
      ctx.toast(t('owner.approved', { acc: b.dataset.acc, day: b.dataset.day }));
      ctx.refresh();
    } catch (err) {
      ctx.fail(err);
    }
  }));
  view.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await ctx.run(() => svc.decideRequest(Number(b.dataset.reject), 'REJECTED'));
      ctx.toast(t('owner.rejected', { req: b.dataset.req }));
      ctx.refresh();
    } catch (err) {
      ctx.fail(err);
    }
  }));
  view.querySelectorAll('[data-details]').forEach((b) => b.addEventListener('click', () => {
    const box = view.querySelector(`#details-${b.dataset.details}`);
    const open = box.classList.toggle('is-hidden') === false;
    b.setAttribute('aria-expanded', String(open));
    b.querySelector('span').textContent = t(open ? 'owner.hideDetails' : 'owner.details');
  }));
}
