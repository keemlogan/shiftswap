// Me (prompt §2.8; UC-07): the worker's profile and attendance records. Availability was removed in iteration 6.
import * as svc from '../core/services.js';
import { contractHours } from '../core/rules.js';
import { t, esc, fmtWon, fmtYMD, displayName } from './i18n.js';
import { button, pageHead, sectionHead, emptyState } from './components.js';
import { myAttendance, bindRecordButtons } from './attendance.js';

export function render(view, ctx) {
  const me = svc.getWorker(ctx.user.id);
  const cta = button({ label: t('home.openSchedule'), kind: 'primary', block: true, href: '#/schedule' });
  const attendance = myAttendance(ctx);
  view.innerHTML = `
    ${pageHead({ title: t('me.title'), sub: t('me.sub'), cta })}
    <section class="section">
      <div class="card profile">
        <div class="card-row"><h2 class="card-title">${esc(displayName(me.name))}</h2><span class="chip">${esc(t('role.WORKER'))}</span></div>
        <dl class="summary-list">
          <div><dt>${esc(t('me.contract'))}</dt><dd class="num">${esc(t('staff.period', { from: fmtYMD(me.contractStart), to: me.contractEnd ? fmtYMD(me.contractEnd) : t('staff.openEnded') }))}</dd></div>
          <div><dt>${esc(t('me.hours'))}</dt><dd class="num">${esc(t('common.perWeek', { h: contractHours(svc.getFixedSchedules(me.id)) }))}</dd></div>
          <div><dt>${esc(t('me.wage'))}</dt><dd class="num">${esc(fmtWon(me.hourlyWage))}</dd></div>
          <div><dt>${esc(t('me.phone'))}</dt><dd class="num">${esc(me.phone || '')}</dd></div>
        </dl>
        <p class="hint">${esc(t('me.privacy'))}</p>
      </div>
    </section>
    <section class="section">
      ${sectionHead(t('me.attendance'))}
      ${attendance.html || emptyState(t('me.attendanceEmpty'))}
    </section>`;
  bindRecordButtons(view, ctx, attendance.shifts);
}
