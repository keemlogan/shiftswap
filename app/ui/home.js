// Home (NFR-13): what is waiting for this person right now, most urgent first, each item with its own action.
// The first actionable item carries the screen's single primary button; the rest are secondary.
import * as svc from '../core/services.js';
import { t, esc, fmtDate, fmtShift, fmtHours, fmtWon, fmtMonthShort, dday, given, displayName } from './i18n.js';
import { icon, button, sectionHead, shiftChips, shiftClasses } from './components.js';
import { incomingCard, takenCard, failedCard, myRequestCard, bindRequestActions, bindFailedAck } from './requests.js';
import { decisionCard, openRequestCard, bindDecisionActions } from './approvals.js';
import { toRecordRow, bindRecordButtons, confirmCard, bindConfirmActions } from './attendance.js';

export function render(view, ctx) {
  if (ctx.user.role === 'OWNER') renderOwner(view, ctx);
  else renderWorker(view, ctx);
}

function primaryPicker() {
  let used = false;
  return () => {
    if (used) return false;
    used = true;
    return true;
  };
}

// ---- Worker ------------------------------------------------------------------------

function holidaySentence(week) {
  if (week.holidayEligible) return { ok: true, text: t('holiday.yes', { amount: fmtWon(week.holidayPay) }) };
  const reason = week.reasons.find((r) => r.code !== 'CONTRACT_BELOW_15');
  if (week.contractHours < 15) return { ok: false, text: t('holiday.noContract', { h: week.contractHours }) };
  if (reason && reason.code === 'ABSENT') return { ok: false, text: t('holiday.noAbsent', { day: fmtDate(reason.date) }) };
  return { ok: false, text: t('holiday.noGaveAway', { day: reason ? fmtDate(reason.date) : '' }) };
}

function weekCard(week) {
  const scale = Math.max(20, week.contractHours + 2);
  const fill = Math.min(100, (week.contractHours / scale) * 100);
  const line = (15 / scale) * 100;
  const h = holidaySentence(week);
  return `
    <section class="card week-card" aria-labelledby="week-title">
      <h2 class="card-title" id="week-title">${esc(t('home.week'))}</h2>
      <div class="kpis">
        <div class="kpi"><span class="kpi-label">${esc(t('home.scheduled'))}</span><span class="kpi-value num">${esc(fmtHours(week.scheduledHours))}</span></div>
        <div class="kpi"><span class="kpi-label">${esc(t('home.contract'))}</span><span class="kpi-value num">${esc(t('common.perWeek', { h: week.contractHours }))}</span></div>
      </div>
      <div class="meter" role="img" aria-label="${esc(`${t('home.contract')} ${t('common.perWeek', { h: week.contractHours })}, ${t('home.line15')}`)}">
        <span class="meter-fill ${week.contractHours >= 15 ? 'is-ok' : ''}" style="width:${fill}%"></span>
        <span class="meter-line" style="left:${line}%"><span class="meter-line-label">${esc(t('home.line15'))}</span></span>
      </div>
      <p class="holiday ${h.ok ? 'is-ok' : ''}">${icon(h.ok ? 'check' : 'info')}<span>${esc(h.text)}</span></p>
    </section>`;
}

function nextShiftCard(s, ctx, takePrimary) {
  const pending = !!s.openRequestId;
  return `
    <section class="card next-card ${shiftClasses(s, ctx.user)}" aria-labelledby="next-title">
      <div class="card-row">
        <h2 class="card-title" id="next-title">${esc(t('home.next'))}</h2>
        <span class="chip chip-shift">${esc(dday(s.workDate, ctx.now))}</span>
      </div>
      <p class="big-date">${esc(fmtDate(s.workDate))}</p>
      <p class="big-time num">${esc(`${s.startTime}–${s.endTime}`)}</p>
      ${shiftChips(s)}
      ${pending ? '' : `<div class="actions">${button({ label: t('home.findCover'), kind: takePrimary() ? 'primary' : 'secondary', block: true, href: `#/swaps/new/1/${s.id}` })}</div>`}
    </section>`;
}

function renderWorker(view, ctx) {
  const home = svc.getWorkerHome(ctx.user.id);
  const takePrimary = primaryPicker();
  const incoming = home.incoming.map((r) => incomingCard(r, { now: ctx.now, primary: takePrimary() })).join('');
  const failed = home.failed.map((f) => failedCard(f, { primary: takePrimary() })).join('');
  const next = home.nextShift ? nextShiftCard(home.nextShift, ctx, takePrimary) : '';
  const record = home.toRecord.length ? `<ul class="card list">${home.toRecord.map((s) => toRecordRow(s, { primary: takePrimary() })).join('')}</ul>` : '';
  const somethingToDo = home.incoming.length || home.failed.length || home.myOpen.length || home.toRecord.length;
  const fallback = takePrimary() ? button({ label: t('home.openSchedule'), kind: 'primary', block: true, href: '#/schedule' }) : '';

  view.innerHTML = `
    <header class="hero">
      <p class="hero-date">${esc(fmtDate(home.today))}</p>
      <h1>${esc(t('home.greeting', { name: given(home.worker.name) }))}</h1>
      ${somethingToDo ? '' : `<p class="purpose">${esc(t('home.nothing'))}</p>`}
    </header>
    ${fallback ? `<div class="cta-bar">${fallback}</div>` : ''}
    ${home.incoming.length || home.taken.length ? `<section class="section">${sectionHead(t('home.incoming'), home.incoming.length || null)}<div class="stack">${incoming}${home.taken.map(takenCard).join('')}</div></section>` : ''}
    ${home.myOpen.length || home.failed.length ? `<section class="section">${sectionHead(t('home.myRequests'))}<div class="stack">${failed}${home.myOpen.map((r) => myRequestCard(r, ctx)).join('')}</div></section>` : ''}
    ${next ? `<section class="section">${next}</section>` : ''}
    <section class="section">${weekCard(home.week)}</section>
    ${record ? `<section class="section">${sectionHead(t('home.toRecord'), home.toRecord.length)}${record}</section>` : ''}`;
  bindRequestActions(view, ctx);
  bindRecordButtons(view, ctx, home.toRecord);
}

// ---- Owner -------------------------------------------------------------------------

function renderOwner(view, ctx) {
  const home = svc.getOwnerHome();
  const takePrimary = primaryPicker();
  const decisions = home.decisions.map((d) => decisionCard(d, { primary: takePrimary() })).join('');
  const failed = home.failed.map((f) => `
    <article class="card req-card">
      <div class="card-row"><h3 class="card-title">${esc(t('owner.failedLine', { name: given(f.requesterName), shift: fmtShift(f) }))}</h3>${icon('alert', 'alert-icon')}</div>
      <div class="actions">${button({ label: t('failed.ack'), kind: takePrimary() ? 'primary' : 'secondary', block: true, attrs: `data-ack-failed="${f.notificationId}"` })}</div>
    </article>`).join('');
  const confirms = home.toConfirm.map((s) => confirmCard(s, { primary: takePrimary() })).join('');
  const ready = home.payrollReady;
  const readyCard = ready ? `
    <article class="card req-card">
      <div class="card-row"><h3 class="card-title">${esc(t('owner.payrollReadyLine', { month: fmtMonthShort(ready.yearMonth) }))}</h3>${icon('pay')}</div>
      <div class="actions">${button({ label: t('owner.payrollOpen'), kind: takePrimary() ? 'primary' : 'secondary', block: true, attrs: `data-payroll-ready="${ready.notificationId}" data-month="${esc(ready.yearMonth)}"` })}</div>
    </article>` : '';
  const warnings = home.payWarnings.map((p) => `
    <article class="card req-card">
      <div class="card-row"><h3 class="card-title">${esc(t('owner.payWarning', { name: given(p.workerName), year: p.yearMonth.slice(0, 4) }))}</h3>${icon('alert', 'alert-icon')}</div>
      <div class="actions">${button({ label: t('owner.toPay'), kind: takePrimary() ? 'primary' : 'secondary', block: true, href: `#/pay/month/${p.yearMonth}` })}</div>
    </article>`).join('');
  const fallback = takePrimary() ? button({ label: t('home.openSchedule'), kind: 'primary', block: true, href: '#/schedule' }) : '';
  const weekLine = t('owner.weekLine', { n: home.week.shifts, h: fmtHours(home.week.hours), amount: fmtWon(home.week.holidayTotal) });

  view.innerHTML = `
    <header class="hero">
      <p class="hero-date">${esc(fmtDate(home.today))}</p>
      <h1>${esc(home.taskCount ? t(home.taskCount === 1 ? 'owner.task1' : 'owner.tasks', { n: home.taskCount }) : t('owner.noTasks'))}</h1>
      ${home.taskCount ? '' : `<p class="purpose">${esc(weekLine)}</p>`}
    </header>
    ${fallback ? `<div class="cta-bar">${fallback}</div>` : ''}
    ${home.decisions.length ? `<section class="section">${sectionHead(t('owner.decisions'), home.decisions.length)}<div class="stack">${decisions}</div></section>` : ''}
    ${home.failed.length ? `<section class="section">${sectionHead(t('owner.failed'), home.failed.length)}<div class="stack">${failed}</div></section>` : ''}
    ${home.toConfirm.length ? `<section class="section">${sectionHead(t('owner.toConfirm'), home.toConfirm.length)}<div class="stack">${confirms}</div></section>` : ''}
    ${readyCard ? `<section class="section">${sectionHead(t('owner.payrollReady'))}<div class="stack">${readyCard}</div></section>` : ''}
    ${home.payWarnings.length ? `<section class="section">${sectionHead(t('owner.payWarnings'), home.payWarnings.length)}<div class="stack">${warnings}</div></section>` : ''}
    ${home.open.length ? `<section class="section">${sectionHead(t('owner.open'), home.open.length)}<div class="stack">${home.open.map((r) => openRequestCard(r, ctx.now)).join('')}</div></section>` : ''}
    <section class="section">
      ${sectionHead(t('owner.today'))}
      ${home.todayShifts.length ? `<ul class="card list">${home.todayShifts.map((s) => `
        <li class="list-row ${shiftClasses(s, null)}">
          <div class="list-main"><strong>${esc(displayName(s.workerName))}</strong><span class="muted num">${esc(`${s.startTime}–${s.endTime}`)}</span></div>
          <div class="list-side">${shiftChips(s)}</div>
        </li>`).join('')}</ul>` : `<p class="card muted">${esc(t('owner.todayNone'))}</p>`}
    </section>
    <section class="section">
      ${sectionHead(t('owner.week'))}
      <div class="card kpis kpis-3">
        <div class="kpi"><span class="kpi-label">${esc(t('owner.kpiShifts'))}</span><span class="kpi-value num">${esc(t('owner.kpiShiftsValue', { n: home.week.shifts }))}</span></div>
        <div class="kpi"><span class="kpi-label">${esc(t('owner.kpiHours'))}</span><span class="kpi-value num">${esc(fmtHours(home.week.hours))}</span></div>
        <div class="kpi"><span class="kpi-label">${esc(t('owner.kpiHoliday'))}</span><span class="kpi-value num">${esc(fmtWon(home.week.holidayTotal))}</span></div>
      </div>
    </section>`;
  bindDecisionActions(view, ctx);
  bindFailedAck(view, ctx);
  bindConfirmActions(view, ctx);
  const readyBtn = view.querySelector('[data-payroll-ready]');
  if (readyBtn) readyBtn.addEventListener('click', () => {
    // UC-14: opening the draft is what "read" means for this notification.
    svc.markNotificationsRead(ctx.user.id, [Number(readyBtn.dataset.payrollReady)]);
    ctx.go(`#/pay/month/${readyBtn.dataset.month}`);
  });
}
