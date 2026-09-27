// Staff (owner, prompt §2.8; UC-01): worker cards and a worker detail with the fixed-schedule editor.
import * as svc from '../core/services.js';
import { contractHours } from '../core/rules.js';
import { t, esc, fmtHours, fmtWon, fmtYMD, given, displayName, initial, showFormError } from './i18n.js';
import { icon, button, pageHead } from './components.js';
import { slotEditorHtml, bindSlotEditor, readSlots } from './slots.js';

export function render(view, ctx) {
  const id = ctx.args[0];
  if (id) renderDetail(view, ctx, id === 'new' ? null : svc.getWorker(Number(id)));
  else renderList(view, ctx);
}

function renderList(view, ctx) {
  const workers = svc.listWorkers(ctx.user).filter((w) => w.role === 'WORKER');
  const cta = button({ label: t('staff.add'), kind: 'primary', block: true, href: '#/staff/new', iconName: 'plus' });
  view.innerHTML = `
    ${pageHead({ title: t('staff.title'), sub: t('staff.sub'), cta })}
    <ul class="stack">
      ${workers.map((w) => `
        <li>
          <a class="card link-card" href="#/staff/${w.id}">
            <span class="avatar avatar-lg" aria-hidden="true">${esc(initial(w.name))}</span>
            <span class="link-main">
              <span class="card-title">${esc(displayName(w.name))} ${w.active ? '' : `<span class="chip">${esc(t('staff.inactive'))}</span>`}</span>
              <span class="muted num">${esc(t('staff.card', { h: fmtHours(contractHours(svc.getFixedSchedules(w.id))), wage: fmtWon(w.hourlyWage) }))}</span>
              <span class="muted num">${esc(t('staff.period', { from: fmtYMD(w.contractStart), to: w.contractEnd ? fmtYMD(w.contractEnd) : t('staff.openEnded') }))}</span>
            </span>
            ${icon('chevronRight', 'chev')}
          </a>
        </li>`).join('')}
    </ul>`;
}

function field(name, label, value, { type = 'text', hint = '', attrs = '' } = {}) {
  const hid = hint ? `hint-${name}` : '';
  return `<label class="field"><span class="field-label">${esc(label)}</span>
    <input type="${type}" name="${name}" value="${esc(value ?? '')}" ${hid ? `aria-describedby="${hid}"` : ''} ${attrs} ${type === 'number' || type === 'tel' ? 'class="num"' : ''}>
    ${hint ? `<span class="hint" id="${hid}">${esc(hint)}</span>` : ''}</label>`;
}

function renderDetail(view, ctx, w) {
  const v = w || { name: '', phone: '', hourlyWage: '', contractStart: '', contractEnd: '', probationEnd: '', simpleLabor: 0, active: 1 };
  const cta = button({ label: w ? t('staff.save') : t('staff.create'), kind: 'primary', block: true, id: 'save-worker' });
  const back = `<a class="back-link" href="#/staff">${icon('chevronLeft')}<span>${esc(t('staff.back'))}</span></a>`;
  view.innerHTML = `
    ${pageHead({ title: w ? displayName(w.name) : t('staff.newTitle'), back, cta })}
    <form class="stack-sections" id="worker-form" novalidate>
      <section class="section">
        <h2 class="section-title">${esc(t('staff.info'))}</h2>
        <div class="card form">
          <div class="fields">
            ${field('name', t('staff.name'), v.name, { attrs: 'autocomplete="off"' })}
            ${field('phone', t('staff.phone'), v.phone, { type: 'tel', attrs: 'autocomplete="off"' })}
            ${field('hourlyWage', t('staff.wage'), v.hourlyWage, { type: 'number', attrs: 'min="1" step="1" inputmode="numeric"' })}
            ${field('contractStart', t('staff.start'), v.contractStart, { type: 'date' })}
            ${field('contractEnd', t('staff.end'), v.contractEnd, { type: 'date', hint: t('staff.endHint') })}
            ${field('probationEnd', t('staff.probation'), v.probationEnd, { type: 'date', hint: t('staff.probationHint') })}
          </div>
          <label class="switch-row"><span><strong>${esc(t('staff.simpleLabor'))}</strong><span class="hint">${esc(t('staff.simpleLaborHint'))}</span></span>
            <input type="checkbox" role="switch" name="simpleLabor" ${v.simpleLabor ? 'checked' : ''}></label>
          <label class="switch-row"><span><strong>${esc(t('staff.active'))}</strong></span>
            <input type="checkbox" role="switch" name="active" ${v.active ? 'checked' : ''}></label>
        </div>
      </section>
      <section class="section">
        <h2 class="section-title">${esc(t('staff.fixed'))}</h2>
        <div class="card" id="fixed-card">
          <p class="muted">${esc(t('staff.fixedHint'))}</p>
          ${slotEditorHtml(w ? svc.getFixedSchedules(w.id) : [], { defaults: ['18:00', '23:00'], total: true })}
        </div>
      </section>
    </form>`;
  const form = view.querySelector('#worker-form');
  bindSlotEditor(view.querySelector('#fixed-card'));
  view.querySelector('#save-worker').addEventListener('click', () => {
    let id = w ? w.id : null;
    try {
      id = svc.registerWorker({
        id: w ? w.id : undefined,
        name: form.name.value,
        phone: form.phone.value,
        hourlyWage: form.hourlyWage.value === '' ? NaN : Number(form.hourlyWage.value),
        contractStart: form.contractStart.value,
        contractEnd: form.contractEnd.value,
        probationEnd: form.probationEnd.value,
        simpleLabor: form.simpleLabor.checked,
        active: form.active.checked,
      });
    } catch (err) {
      showFormError(form, err);
      return;
    }
    const slots = readSlots(view.querySelector('#fixed-card'));
    try {
      svc.saveFixedSchedule(id, slots);
    } catch (err) {
      if (!w) {
        // The worker was created; continue on their page so a second save does not create them again.
        ctx.fail(err);
        ctx.go(`#/staff/${id}`);
      } else showFormError(form, err);
      return;
    }
    ctx.toast(t(w ? 'staff.saved' : 'staff.created', { name: given(form.name.value), h: fmtHours(contractHours(slots)) }));
    ctx.go('#/staff');
  });
}
