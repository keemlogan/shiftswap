// UC-07 Record and confirm attendance: the worker's record sheet and attendance list (Home, Me) and the
// owner's confirm cards (Owner Home).
import * as svc from '../core/services.js';
import { addDays, weekStartOf } from '../core/rules.js';
import { t, esc, fmtShift, fmtDate, given, showFormError } from './i18n.js';
import { button, openSheet } from './components.js';

/** Sheet to record actual clock-in / clock-out of one of my shifts (FR-13). */
export function openRecordSheet(ctx, shift) {
  openSheet({
    title: t('record.title'),
    body: `
      <form class="form" id="record-form" novalidate>
        <p class="shift-line num">${esc(fmtShift(shift))}</p>
        <div class="row-2">
          <label class="field"><span class="field-label">${esc(t('record.in'))}</span>
            <input type="time" name="clockIn" class="num" value="${esc(shift.clockIn || shift.startTime)}" required></label>
          <label class="field"><span class="field-label">${esc(t('record.out'))}</span>
            <input type="time" name="clockOut" class="num" value="${esc(shift.clockOut || shift.endTime)}" required></label>
        </div>
        ${button({ label: t('record.save'), kind: 'primary', block: true, id: 'record-save' })}
      </form>`,
    onMount: (panel, close) => {
      const form = panel.querySelector('#record-form');
      panel.querySelector('#record-save').addEventListener('click', () => {
        try {
          svc.recordAttendance(shift.id, ctx.user.id, form.clockIn.value, form.clockOut.value);
          close();
          ctx.toast(t('record.saved'));
          ctx.refresh();
        } catch (err) {
          showFormError(form, err);
        }
      });
    },
  });
}

/** Binds every [data-record] button in `view`; `shifts` are the shifts those buttons refer to. */
export function bindRecordButtons(view, ctx, shifts) {
  view.querySelectorAll('[data-record]').forEach((b) => b.addEventListener('click', () => {
    const shift = shifts.find((s) => s.id === Number(b.dataset.record));
    if (shift) openRecordSheet(ctx, shift);
  }));
}

/** A shift of mine waiting to be recorded (Worker Home). */
export function toRecordRow(s, { primary }) {
  return `
    <li class="list-row">
      <div class="list-main"><strong>${esc(fmtDate(s.workDate))}</strong><span class="muted num">${esc(`${s.startTime}–${s.endTime}`)}</span></div>
      ${button({ label: t('home.record'), kind: primary ? 'primary' : 'secondary', small: !primary, attrs: `data-record="${s.id}"` })}
    </li>`;
}

/** Recorded, unconfirmed attendance for the owner (Owner Home). */
export function confirmCard(s, { primary }) {
  return `
    <article class="card req-card">
      <div class="card-row"><h3 class="card-title">${esc(given(s.workerName))} · <span class="num">${esc(fmtShift(s))}</span></h3></div>
      <p class="muted num">${esc(t('owner.recorded', { range: `${s.clockIn}–${s.clockOut}` }))}</p>
      <div class="actions">
        ${button({ label: t('owner.confirm'), kind: primary ? 'primary' : 'secondary', block: true, attrs: `data-confirm="${s.id}"` })}
        ${button({ label: t('owner.absent'), kind: 'text', attrs: `data-absent="${s.id}"` })}
      </div>
    </article>`;
}

export function bindConfirmActions(view, ctx) {
  const act = (fn, msg) => {
    try {
      fn();
      ctx.toast(msg);
      ctx.refresh();
    } catch (err) {
      ctx.fail(err);
    }
  };
  view.querySelectorAll('[data-confirm]').forEach((b) => b.addEventListener('click', () => act(() => svc.confirmAttendance(Number(b.dataset.confirm)), t('owner.confirmed'))));
  view.querySelectorAll('[data-absent]').forEach((b) => b.addEventListener('click', () => act(() => svc.markAbsent(Number(b.dataset.absent)), t('owner.markedAbsent'))));
}

/** My attendance for last week and this week (Me), newest first. */
export function myAttendance(ctx) {
  const thisWeek = weekStartOf(ctx.now.slice(0, 10));
  const shifts = [...svc.listAttendance(addDays(thisWeek, -7), ctx.user), ...svc.listAttendance(thisWeek, ctx.user)]
    .sort((a, b) => `${b.workDate}${b.startTime}`.localeCompare(`${a.workDate}${a.startTime}`));
  const rows = shifts.map((s) => {
    const started = `${s.workDate}T${s.startTime}` <= ctx.now;
    let state;
    if (s.status === 'ABSENT') state = `<span class="chip chip-alert">${esc(t('me.absent'))}</span>`;
    else if (s.status === 'WORKED') state = `<span class="chip chip-ok num">${esc(t('me.confirmed', { range: `${s.clockIn}–${s.clockOut}` }))}</span>`;
    else if (s.clockIn) state = `<span class="chip chip-handover num">${esc(t('me.recorded', { range: `${s.clockIn}–${s.clockOut}` }))}</span>`;
    else if (started) state = button({ label: t('me.record'), kind: 'secondary', small: true, attrs: `data-record="${s.id}"` });
    else state = `<span class="chip">${esc(t('me.upcoming'))}</span>`;
    return `<li class="list-row">
      <div class="list-main"><strong>${esc(fmtDate(s.workDate))}</strong><span class="muted num">${esc(`${s.startTime}–${s.endTime}`)}</span></div>
      <div class="list-side">${state}</div>
    </li>`;
  });
  return { html: rows.length ? `<ul class="card list">${rows.join('')}</ul>` : '', shifts };
}
