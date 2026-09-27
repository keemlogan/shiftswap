// UC-08 Weekly hours and holiday allowance (FR-14), shown in Pay → Weekly as one card per worker (prompt §2.7).
import * as svc from '../core/services.js';
import { t, esc, fmtHours, fmtWon, fmtDateShort, displayName } from './i18n.js';
import { emptyState } from './components.js';

function reasonText(r) {
  const parts = [];
  for (const x of r.reasons) {
    if (x.code === 'CONTRACT_BELOW_15') parts.push(t('pay.reasonContract', { h: fmtHours(r.contractHours) }));
    if (x.code === 'ABSENT') parts.push(t('pay.reasonAbsent', { day: fmtDateShort(x.date) }));
    if (x.code === 'GAVE_AWAY') parts.push(t('pay.reasonGaveAway', { day: fmtDateShort(x.date) }));
  }
  return parts.join(' · ');
}

/** Recompute the week (UC-08) and return one card per worker with a shift in it. */
export function weeklyCards(week) {
  const rows = svc.recomputeWeek(week);
  if (!rows.length) return emptyState(t('pay.weekEmpty'));
  return `<div class="grid-cards">${rows.map((r) => {
    const w = svc.getWorker(r.workerId);
    const pay = Math.floor(Math.round(r.holidayHours * w.hourlyWage * 100) / 100);
    return `
      <article class="card pay-card ${r.holidayEligible ? 'is-ok' : ''}">
        <div class="card-row">
          <h3 class="card-title">${esc(displayName(r.name))}</h3>
          <span class="chip ${r.holidayEligible ? 'chip-ok' : ''}">${esc(t(r.holidayEligible ? 'pay.eligible' : 'pay.notEligible'))}</span>
        </div>
        ${r.holidayEligible
    ? `<p class="key-number num">${esc(fmtWon(pay))}</p><p class="muted num">${esc(t('pay.holidayLine', { h: fmtHours(r.holidayHours), c: fmtHours(r.contractHours) }))}</p>`
    : `<p class="reason">${esc(reasonText(r))}</p>`}
        <p class="muted num">${esc(t('pay.contractLine', { s: fmtHours(r.scheduledHours), a: fmtHours(r.actualHours) }))}</p>
      </article>`;
  }).join('')}</div>`;
}
