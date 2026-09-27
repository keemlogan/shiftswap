// UC-08 Weekly hours and holiday allowance (FR-14), with the reason when a worker is not eligible.
import * as svc from '../core/services.js';
import { t, esc, fmtDay, fmtHours, pageHead, emptyState } from './i18n.js';
import { weekFromArgs, weekNavHtml } from './schedule.js';

export function render(view, ctx) {
  const week = weekFromArgs(ctx.args);
  const rows = svc.recomputeWeek(week);
  const policy = svc.getWorkplace().subAttendancePolicy;
  const cols = ['weekly.contract', 'weekly.scheduled', 'weekly.actual', 'weekly.perfect', 'weekly.eligible', 'weekly.holidayHours', 'weekly.reason'];
  view.innerHTML = `
    ${pageHead(t('weekly.title'), t('purpose.weekly'))}
    <section class="group">
    ${weekNavHtml('weekly', week)}
    <p class="muted">${esc(t('weekly.policy', { policy: t(`policy.${policy}`) }))}</p>
    ${rows.length ? `
    <table class="rtable">
      <thead><tr><th scope="col">${esc(t('common.worker'))}</th>${cols.map((c) => `<th scope="col">${esc(t(c))}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `
        <tr>
          <th scope="row">${esc(r.name)}</th>
          <td data-label="${esc(t(cols[0]))}" class="num">${esc(fmtHours(r.contractHours))}</td>
          <td data-label="${esc(t(cols[1]))}" class="num">${esc(fmtHours(r.scheduledHours))}</td>
          <td data-label="${esc(t(cols[2]))}" class="num">${esc(fmtHours(r.actualHours))}</td>
          <td data-label="${esc(t(cols[3]))}"><span class="chip ${r.perfectAttendance ? 'chip-ok' : 'chip-alert'}">${esc(t(r.perfectAttendance ? 'common.yes' : 'common.no'))}</span></td>
          <td data-label="${esc(t(cols[4]))}"><span class="chip ${r.holidayEligible ? 'chip-ok' : ''}">${esc(t(`eligible.${r.holidayEligible}`))}</span></td>
          <td data-label="${esc(t(cols[5]))}" class="num">${esc(fmtHours(r.holidayHours))}</td>
          <td data-label="${esc(t(cols[6]))}">${esc(reasonText(r.reasons))}</td>
        </tr>`).join('')}
      </tbody>
    </table>` : emptyState(t('weekly.noneText'), `<a class="btn btn-primary" href="#/schedule/${week}">${esc(t('weekly.toSchedule'))}</a>`)}
    </section>`;
}

export function reasonText(reasons) {
  return reasons.map((r) => t(`reason.${r.code}`, { day: r.date ? fmtDay(r.date) : '' })).join(', ');
}
