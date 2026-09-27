// Me (prompt §2.8; UC-02 availability, UC-07 attendance). Also exports the weekday-chip schedule editor
// used for fixed schedules on the Staff screen.
import * as svc from '../core/services.js';
import { contractHours } from '../core/rules.js';
import { t, esc, dayName, fmtWon, fmtYMD, showFormError } from './i18n.js';
import { icon, button, pageHead, sectionHead, emptyState, timeOptions } from './components.js';
import { myAttendance, bindRecordButtons } from './attendance.js';

/**
 * Weekday chips + one start/end row per chosen weekday. `slots` are {id?, weekday, startTime, endTime}
 * (at most one per weekday); `defaults` are the times a newly chosen day starts with.
 */
export function slotEditorHtml(slots, { defaults, total = false }) {
  const byDay = new Map(slots.map((s) => [s.weekday, s]));
  return `
    <div class="slot-editor" data-default-start="${defaults[0]}" data-default-end="${defaults[1]}" ${total ? 'data-total' : ''}>
      <div class="daychips" role="group" aria-label="${esc(t('slots.day'))}">
        ${[1, 2, 3, 4, 5, 6, 7].map((d) => `<button type="button" class="daychip" data-day="${d}" aria-pressed="${byDay.has(d)}">${esc(dayName(d))}</button>`).join('')}
      </div>
      <ul class="slot-rows">${[...byDay.values()].sort((a, b) => a.weekday - b.weekday).map(slotRow).join('')}</ul>
      <p class="hint slots-empty ${byDay.size ? 'is-hidden' : ''}">${esc(t('slots.empty'))}</p>
      ${total ? `<p class="sentence slot-total" aria-live="polite">${icon('clock')}<span></span></p>` : ''}
    </div>`;
}

function slotRow(s) {
  return `
    <li class="slot-row" data-day="${s.weekday}" ${s.id ? `data-id="${s.id}"` : ''}>
      <span class="slot-day">${esc(dayName(s.weekday))}</span>
      <label class="sr-only" for="s-${s.weekday}">${esc(`${dayName(s.weekday)} ${t('slots.start')}`)}</label>
      <select id="s-${s.weekday}" name="start" class="num">${timeOptions(s.startTime)}</select>
      <span class="slot-dash" aria-hidden="true">–</span>
      <label class="sr-only" for="e-${s.weekday}">${esc(`${dayName(s.weekday)} ${t('slots.end')}`)}</label>
      <select id="e-${s.weekday}" name="end" class="num">${timeOptions(s.endTime)}</select>
      <button type="button" class="icon-btn" data-remove-day="${s.weekday}" aria-label="${esc(`${dayName(s.weekday)} ${t('common.remove')}`)}">${icon('x')}</button>
    </li>`;
}

export function readSlots(root) {
  return [...root.querySelectorAll('.slot-row')].map((li) => ({
    id: li.dataset.id ? Number(li.dataset.id) : undefined,
    weekday: Number(li.dataset.day),
    startTime: li.querySelector('[name="start"]').value,
    endTime: li.querySelector('[name="end"]').value,
  }));
}

export function bindSlotEditor(root) {
  const editor = root.querySelector('.slot-editor');
  const list = editor.querySelector('.slot-rows');
  const updateTotal = () => {
    editor.querySelector('.slots-empty').classList.toggle('is-hidden', list.children.length > 0);
    const total = editor.querySelector('.slot-total span');
    if (total) total.textContent = t('staff.fixedTotal', { h: t('common.hours', { h: contractHours(readSlots(editor)) }) });
  };
  const setDay = (day, on) => {
    const chip = editor.querySelector(`.daychip[data-day="${day}"]`);
    chip.setAttribute('aria-pressed', String(on));
    const row = list.querySelector(`.slot-row[data-day="${day}"]`);
    if (on && !row) {
      const html = slotRow({ weekday: day, startTime: editor.dataset.defaultStart, endTime: editor.dataset.defaultEnd });
      const after = [...list.children].find((li) => Number(li.dataset.day) > day);
      if (after) after.insertAdjacentHTML('beforebegin', html);
      else list.insertAdjacentHTML('beforeend', html);
    }
    if (!on && row) row.remove();
    updateTotal();
  };
  editor.querySelectorAll('.daychip').forEach((c) => c.addEventListener('click', () => setDay(Number(c.dataset.day), c.getAttribute('aria-pressed') !== 'true')));
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove-day]');
    if (b) {
      setDay(Number(b.dataset.removeDay), false);
      editor.querySelector(`.daychip[data-day="${b.dataset.removeDay}"]`).focus();
    }
  });
  list.addEventListener('change', updateTotal);
  updateTotal();
}

export function render(view, ctx) {
  const me = svc.getWorker(ctx.user.id);
  const cta = button({ label: t('me.save'), kind: 'primary', block: true, id: 'save-avail' });
  const attendance = myAttendance(ctx);
  view.innerHTML = `
    ${pageHead({ title: t('me.title'), sub: t('me.sub'), cta })}
    <section class="section">
      <div class="card profile">
        <div class="card-row"><h2 class="card-title">${esc(me.name)}</h2><span class="chip">${esc(t('role.WORKER'))}</span></div>
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
      ${sectionHead(t('me.availability'))}
      <form class="card form" id="avail-form" novalidate>
        <p class="muted">${esc(t('me.availabilityHint'))}</p>
        ${slotEditorHtml(svc.getAvailability(me.id), { defaults: ['17:00', '23:00'] })}
      </form>
    </section>
    <section class="section">
      ${sectionHead(t('me.attendance'))}
      ${attendance.html || emptyState(t('me.attendanceEmpty'))}
    </section>`;
  const form = view.querySelector('#avail-form');
  bindSlotEditor(form);
  view.querySelector('#save-avail').addEventListener('click', () => {
    try {
      svc.saveAvailability(me.id, readSlots(form));
      ctx.toast(t('me.saved'));
      ctx.refresh();
    } catch (err) {
      showFormError(form, err);
    }
  });
  bindRecordButtons(view, ctx, attendance.shifts);
}
