// UC-02 Register availability (FR-03). Also exports the weekday/start/end row editor used for fixed schedules.
import * as svc from '../core/services.js';
import { t, esc, dayName, showFormError } from './i18n.js';

function slotRow(slot = {}) {
  return `
    <li class="slot" ${slot.id ? `data-id="${slot.id}"` : ''}>
      <label>${esc(t('common.weekday'))}
        <select name="weekday">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<option value="${d}" ${d === slot.weekday ? 'selected' : ''}>${esc(dayName(d))}</option>`).join('')}</select>
      </label>
      <label>${esc(t('common.start'))}<input type="time" name="startTime" class="num" value="${esc(slot.startTime || '')}" required></label>
      <label>${esc(t('common.end'))}<input type="time" name="endTime" class="num" value="${esc(slot.endTime || '')}" required></label>
      <button type="button" class="btn btn-quiet" data-remove>${esc(t('common.remove'))}</button>
    </li>`;
}

/** Rows of weekday + start + end with "Add row" and "Remove". */
export function slotEditorHtml(slots, emptyKey) {
  return `
    <ul class="slots plain">${slots.map(slotRow).join('')}</ul>
    <p class="empty slots-empty" ${slots.length ? 'hidden' : ''}>${esc(t(emptyKey))}</p>
    <button type="button" class="btn" data-add-row>${esc(t('common.addRow'))}</button>`;
}

export function bindSlotEditor(form) {
  const list = form.querySelector('.slots');
  const empty = form.querySelector('.slots-empty');
  const sync = () => { empty.hidden = list.children.length > 0; };
  form.querySelector('[data-add-row]').addEventListener('click', () => {
    list.insertAdjacentHTML('beforeend', slotRow({ weekday: 1 }));
    sync();
    list.lastElementChild.querySelector('select').focus();
  });
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    btn.closest('.slot').remove();
    sync();
  });
}

export function readSlots(form) {
  return [...form.querySelectorAll('.slot')].map((li) => ({
    id: li.dataset.id ? Number(li.dataset.id) : undefined,
    weekday: Number(li.querySelector('[name="weekday"]').value),
    startTime: li.querySelector('[name="startTime"]').value,
    endTime: li.querySelector('[name="endTime"]').value,
  }));
}

export function render(view, ctx) {
  const { user } = ctx;
  view.innerHTML = `
    <div class="page-head"><h1>${esc(t('availability.title'))}</h1></div>
    <form class="card form" id="avail-form" novalidate>
      <p class="muted">${esc(t('availability.intro'))}</p>
      ${slotEditorHtml(svc.getAvailability(user.id), 'availability.empty')}
      <div class="actions"><button type="submit" class="btn btn-primary">${esc(t('availability.save'))}</button></div>
    </form>`;
  const form = view.querySelector('#avail-form');
  bindSlotEditor(form);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      svc.saveAvailability(user.id, readSlots(form));
      ctx.flash(t('availability.saved'));
      ctx.refresh();
    } catch (err) {
      showFormError(form, err);
    }
  });
}
