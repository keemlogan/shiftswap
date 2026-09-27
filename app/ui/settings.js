// UC-10 Workplace settings and minimum wage table (FR-17). Owner only.
import * as svc from '../core/services.js';
import { t, esc, showFormError } from './i18n.js';

function wageRow(r = {}) {
  return `
    <li class="slot wage-row">
      <label>${esc(t('settings.year'))}<input type="number" name="year" class="num" min="2000" max="2100" step="1" value="${esc(r.year ?? '')}" required></label>
      <label>${esc(t('settings.hourly'))}<input type="number" name="hourly" class="num" min="1" step="1" value="${esc(r.hourly ?? '')}" required></label>
      <button type="button" class="btn btn-quiet" data-remove>${esc(t('common.remove'))}</button>
    </li>`;
}

export function render(view, ctx) {
  const { workplace, minimumWages } = svc.getSettings();
  view.innerHTML = `
    <div class="page-head"><h1>${esc(t('settings.title'))}</h1></div>
    <form class="card form" id="settings-form" novalidate>
      <div class="fields">
        <label>${esc(t('settings.storeName'))}<input type="text" name="name" value="${esc(workplace.name)}" required autocomplete="off"></label>
        <label>${esc(t('settings.employees'))}<input type="number" name="regularEmployees" class="num" min="0" step="1" value="${workplace.regularEmployees}" required aria-describedby="emp-hint">
          <span class="hint" id="emp-hint">${esc(t('settings.employeesHint'))}</span></label>
      </div>
      <fieldset>
        <legend>${esc(t('settings.policy'))}</legend>
        ${['EXCUSED', 'ABSENT'].map((p) => `<label class="check"><input type="radio" name="subAttendancePolicy" value="${p}" ${workplace.subAttendancePolicy === p ? 'checked' : ''}> ${esc(t(`settings.policy${p}`))}</label>`).join('')}
      </fieldset>
      <fieldset>
        <legend>${esc(t('settings.minWage'))}</legend>
        <ul class="slots plain" id="wage-rows">${minimumWages.map(wageRow).join('')}</ul>
        <button type="button" class="btn" id="add-wage">${esc(t('common.addRow'))}</button>
      </fieldset>
      <div class="actions"><button type="submit" class="btn btn-primary">${esc(t('settings.save'))}</button></div>
    </form>`;

  const form = view.querySelector('#settings-form');
  const list = view.querySelector('#wage-rows');
  view.querySelector('#add-wage').addEventListener('click', () => {
    list.insertAdjacentHTML('beforeend', wageRow());
    list.lastElementChild.querySelector('input').focus();
  });
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (btn) btn.closest('li').remove();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = new FormData(form);
    try {
      svc.updateSettings({
        name: d.get('name'),
        regularEmployees: d.get('regularEmployees') === '' ? NaN : Number(d.get('regularEmployees')),
        subAttendancePolicy: d.get('subAttendancePolicy'),
        minimumWages: [...list.querySelectorAll('li')].map((li) => ({
          year: li.querySelector('[name="year"]').value === '' ? NaN : Number(li.querySelector('[name="year"]').value),
          hourly: li.querySelector('[name="hourly"]').value === '' ? NaN : Number(li.querySelector('[name="hourly"]').value),
        })),
      });
      ctx.flash(t('settings.saved'));
      ctx.refresh();
    } catch (err) {
      showFormError(form, err);
    }
  });
}
