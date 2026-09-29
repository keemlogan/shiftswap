// Settings (owner, prompt §2.8; UC-10): store name, regular employees, substitution-attendance policy as two
// radio cards, and the minimum-wage table.
import * as svc from '../core/services.js';
import { t, esc, showFormError } from './i18n.js';
import { icon, button, pageHead } from './components.js';

function wageRow(r = {}) {
  return `
    <li class="wage-row">
      <label class="field"><span class="field-label">${esc(t('settings.year'))}</span>
        <input type="number" name="year" class="num" min="2000" max="2100" step="1" inputmode="numeric" value="${esc(r.year ?? '')}"></label>
      <label class="field"><span class="field-label">${esc(t('settings.hourly'))}</span>
        <input type="number" name="hourly" class="num" min="1" step="1" inputmode="numeric" value="${esc(r.hourly ?? '')}"></label>
      <button type="button" class="icon-btn" data-remove aria-label="${esc(`${r.year || ''} ${t('common.remove')}`.trim())}">${icon('x')}</button>
    </li>`;
}

export function render(view, ctx) {
  const { workplace, minimumWages } = svc.getSettings();
  const cta = button({ label: t('common.save'), kind: 'primary', block: true, id: 'save-settings' });
  view.innerHTML = `
    ${pageHead({ title: t('settings.title'), sub: t('settings.sub'), cta })}
    <form class="stack-sections" id="settings-form" novalidate>
      <section class="section">
        <div class="card form">
          <label class="field"><span class="field-label">${esc(t('settings.store'))}</span>
            <input type="text" name="name" value="${esc(workplace.name)}" autocomplete="off"></label>
          <label class="field"><span class="field-label">${esc(t('settings.employees'))}</span>
            <input type="number" name="regularEmployees" class="num" min="0" step="1" inputmode="numeric" value="${workplace.regularEmployees}" aria-describedby="emp-hint">
            <span class="hint" id="emp-hint">${esc(t('settings.employeesHint', { n: workplace.regularEmployees }))}</span></label>
        </div>
      </section>
      <section class="section">
        <fieldset class="radio-cards">
          <legend class="section-title">${esc(t('settings.policy'))}</legend>
          ${['EXCUSED', 'ABSENT'].map((p) => `
            <label class="radio-card">
              <input type="radio" name="subAttendancePolicy" value="${p}" ${workplace.subAttendancePolicy === p ? 'checked' : ''}>
              <span><strong>${esc(t(`settings.policy${p}`))}</strong><span class="muted">${esc(t(`settings.policy${p}hint`))}</span></span>
            </label>`).join('')}
        </fieldset>
      </section>
      <section class="section">
        <h2 class="section-title">${esc(t('settings.minWage'))}</h2>
        <div class="card">
          <ul class="wage-rows" id="wage-rows">${minimumWages.map(wageRow).join('')}</ul>
          ${button({ label: t('common.addRow'), kind: 'text', id: 'add-wage', iconName: 'plus' })}
        </div>
      </section>
    </form>`;

  const form = view.querySelector('#settings-form');
  const list = view.querySelector('#wage-rows');
  view.querySelector('#add-wage').addEventListener('click', () => {
    list.insertAdjacentHTML('beforeend', wageRow());
    list.lastElementChild.querySelector('input').focus();
  });
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove]');
    if (b) b.closest('li').remove();
  });
  const numOrNaN = (v) => (v === '' ? NaN : Number(v));
  view.querySelector('#save-settings').addEventListener('click', async () => {
    try {
      await ctx.run(() => svc.updateSettings({
        name: form.name.value,
        regularEmployees: numOrNaN(form.regularEmployees.value),
        subAttendancePolicy: (form.querySelector('input[name="subAttendancePolicy"]:checked') || {}).value,
        minimumWages: [...list.querySelectorAll('li')].map((li) => ({
          year: numOrNaN(li.querySelector('[name="year"]').value),
          hourly: numOrNaN(li.querySelector('[name="hourly"]').value),
        })),
      }));
      ctx.toast(t('settings.saved'));
      ctx.refresh();
    } catch (err) {
      showFormError(form, err);
    }
  });
}
