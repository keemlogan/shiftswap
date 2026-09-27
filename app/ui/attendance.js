// UC-07 Record (worker) and confirm or mark absent (owner).
import * as svc from '../core/services.js';
import { now } from '../core/clock.js';
import { t, esc, fmtDay, num, showFormError, pageHead, emptyState } from './i18n.js';
import { weekFromArgs, weekNavHtml } from './schedule.js';

export function render(view, ctx) {
  const { user, args } = ctx;
  const week = weekFromArgs(args);
  const isOwner = user.role === 'OWNER';
  const shifts = svc.listAttendance(week, user);
  view.innerHTML = `
    ${pageHead(t('attendance.title'), t(`purpose.attendance.${user.role}`))}
    <section class="group">
      ${weekNavHtml('attendance', week)}
      ${shifts.length ? `<ul class="stack plain">${shifts.map((s) => row(s, isOwner)).join('')}</ul>` : emptyState(t('attendance.noneText'), `<a class="btn btn-primary" href="#/schedule/${week}">${esc(t('weekly.toSchedule'))}</a>`)}
    </section>`;

  view.querySelectorAll('form[data-record]').forEach((form) => form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
      svc.recordAttendance(Number(form.dataset.record), user.id, data.clockIn, data.clockOut);
      ctx.flash(t('attendance.recordedMsg'));
      ctx.refresh();
    } catch (err) {
      showFormError(form, err);
    }
  }));
  view.querySelectorAll('[data-confirm]').forEach((b) => b.addEventListener('click', () => act(ctx, () => svc.confirmAttendance(Number(b.dataset.confirm)), 'attendance.confirmed')));
  view.querySelectorAll('[data-absent]').forEach((b) => b.addEventListener('click', () => act(ctx, () => svc.markAbsent(Number(b.dataset.absent)), 'attendance.markedAbsent')));
}

function act(ctx, fn, messageKey) {
  try {
    fn();
    ctx.flash(t(messageKey));
    ctx.refresh();
  } catch (err) {
    ctx.fail(err);
  }
}

function stateChip(s, started) {
  if (s.status === 'ABSENT') return `<span class="chip chip-alert">${esc(t('attendance.absent'))}</span>`;
  const range = s.clockIn ? `${s.clockIn}–${s.clockOut}` : '';
  if (s.status === 'WORKED') return `<span class="chip chip-ok">${esc(t('attendance.confirmedAt', { range }))}</span>`;
  if (s.clockIn) return `<span class="chip chip-handover">${esc(t('attendance.recorded', { range }))}</span>`;
  return `<span class="chip">${esc(t(started ? 'attendance.notRecorded' : 'attendance.notStarted'))}</span>`;
}

function row(s, isOwner) {
  const started = `${s.workDate}T${s.startTime}` <= now();
  const open = s.status === 'SCHEDULED';
  const head = `
    <div class="request-head">
      <h3>${esc(fmtDay(s.workDate))} ${num(`${s.startTime}–${s.endTime}`)}${isOwner ? ` · ${esc(s.workerName)}` : ''}</h3>
      ${stateChip(s, started)}
    </div>`;
  if (isOwner) {
    return `<li class="card">${head}
      ${open && started ? `<div class="actions">
        ${s.clockIn ? `<button type="button" class="btn btn-primary" data-confirm="${s.id}">${esc(t('attendance.confirm'))}</button>` : ''}
        <button type="button" class="btn btn-danger" data-absent="${s.id}">${esc(t('attendance.markAbsent'))}</button>
      </div>` : ''}
    </li>`;
  }
  if (!open || !started) return `<li class="card">${head}</li>`;
  return `<li class="card">
    <form class="form" data-record="${s.id}">
      ${head}
      <div class="fields">
        <label>${esc(t('attendance.clockIn'))}<input type="time" name="clockIn" class="num" value="${esc(s.clockIn || s.startTime)}" required></label>
        <label>${esc(t('attendance.clockOut'))}<input type="time" name="clockOut" class="num" value="${esc(s.clockOut || s.endTime)}" required></label>
      </div>
      <div class="actions"><button type="submit" class="btn btn-primary">${esc(t('attendance.record'))}</button></div>
    </form>
  </li>`;
}
