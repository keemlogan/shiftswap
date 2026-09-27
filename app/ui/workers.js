// UC-01 Register worker (FR-01) and fixed weekly schedule (FR-02). Owner only.
import * as svc from '../core/services.js';
import { contractHours } from '../core/rules.js';
import { t, esc, fmtHours, fmtWon, showFormError } from './i18n.js';
import { slotEditorHtml, bindSlotEditor, readSlots } from './availability.js';

export function render(view, ctx) {
  const workers = svc.listWorkers(ctx.user).filter((w) => w.role === 'WORKER');
  const sel = ctx.args[0] === 'new' ? 'new' : workers.find((w) => w.id === Number(ctx.args[0])) || null;
  const cols = ['workers.phone', 'workers.wage', 'workers.contract', 'workers.contractHours', 'common.status'];

  view.innerHTML = `
    <div class="page-head">
      <h1>${esc(t('workers.title'))}</h1>
      <div class="actions"><a class="btn btn-primary" href="#/workers/new">${esc(t('workers.add'))}</a></div>
    </div>
    <table class="rtable">
      <thead><tr><th scope="col">${esc(t('workers.name'))}</th>${cols.map((c) => `<th scope="col">${esc(t(c))}</th>`).join('')}<th scope="col"><span class="sr-only">${esc(t('workers.edit'))}</span></th></tr></thead>
      <tbody>${workers.map((w) => `
        <tr>
          <th scope="row">${esc(w.name)}</th>
          <td data-label="${esc(t(cols[0]))}" class="num">${esc(w.phone || '')}</td>
          <td data-label="${esc(t(cols[1]))}" class="num">${esc(fmtWon(w.hourlyWage))}</td>
          <td data-label="${esc(t(cols[2]))}" class="num">${esc(w.contractStart)} ~ ${esc(w.contractEnd || t('workers.openEnded'))}</td>
          <td data-label="${esc(t(cols[3]))}" class="num">${esc(fmtHours(contractHours(svc.getFixedSchedules(w.id))))}</td>
          <td data-label="${esc(t(cols[4]))}"><span class="chip ${w.active ? 'chip-ok' : ''}">${esc(t(w.active ? 'workers.active' : 'workers.inactive'))}</span></td>
          <td><a class="btn btn-small" href="#/workers/${w.id}" aria-label="${esc(`${t('workers.edit')}: ${w.name}`)}">${esc(t('workers.edit'))}</a></td>
        </tr>`).join('')}
      </tbody>
    </table>
    ${sel ? workerForm(sel === 'new' ? null : sel) : ''}
    ${sel && sel !== 'new' ? fixedForm(sel) : ''}`;

  const wf = view.querySelector('#worker-form');
  if (wf) wf.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(wf));
    try {
      const id = svc.registerWorker({
        id: sel === 'new' ? undefined : sel.id,
        name: d.name,
        phone: d.phone,
        hourlyWage: d.hourlyWage === '' ? NaN : Number(d.hourlyWage),
        contractStart: d.contractStart,
        contractEnd: d.contractEnd,
        probationEnd: d.probationEnd,
        simpleLabor: d.simpleLabor === 'on',
        active: d.active === 'on',
      });
      ctx.flash(t('workers.savedWorker'));
      ctx.go(`#/workers/${id}`);
    } catch (err) {
      showFormError(wf, err);
    }
  });
  const ff = view.querySelector('#fixed-form');
  if (ff) {
    bindSlotEditor(ff);
    ff.addEventListener('submit', (e) => {
      e.preventDefault();
      try {
        svc.saveFixedSchedule(sel.id, readSlots(ff));
        ctx.flash(t('workers.savedFixed'));
        ctx.refresh();
      } catch (err) {
        showFormError(ff, err);
      }
    });
  }
}

function workerForm(w) {
  const v = w || { name: '', phone: '', hourlyWage: '', contractStart: '', contractEnd: '', probationEnd: '', simpleLabor: 0, active: 1 };
  return `
    <form class="card form" id="worker-form" novalidate>
      <h2>${esc(w ? t('workers.editTitle', { name: w.name }) : t('workers.newTitle'))}</h2>
      <div class="fields">
        <label>${esc(t('workers.name'))}<input type="text" name="name" value="${esc(v.name)}" required autocomplete="off"></label>
        <label>${esc(t('workers.phone'))}<input type="tel" name="phone" class="num" value="${esc(v.phone || '')}" autocomplete="off"></label>
        <label>${esc(t('workers.wage'))}<input type="number" name="hourlyWage" class="num" min="1" step="1" value="${esc(v.hourlyWage ?? '')}" required></label>
        <label>${esc(t('workers.contractStart'))}<input type="date" name="contractStart" value="${esc(v.contractStart || '')}" required></label>
        <label>${esc(t('workers.contractEnd'))}<input type="date" name="contractEnd" value="${esc(v.contractEnd || '')}" aria-describedby="end-hint">
          <span class="hint" id="end-hint">${esc(t('workers.contractEndHint'))}</span></label>
        <label>${esc(t('workers.probationEnd'))}<input type="date" name="probationEnd" value="${esc(v.probationEnd || '')}" aria-describedby="prob-hint">
          <span class="hint" id="prob-hint">${esc(t('workers.probationHint'))}</span></label>
      </div>
      <label class="check"><input type="checkbox" name="simpleLabor" ${v.simpleLabor ? 'checked' : ''}> ${esc(t('workers.simpleLabor'))}</label>
      <label class="check"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}> ${esc(t('workers.active'))}</label>
      <div class="actions">
        <button type="submit" class="btn btn-primary">${esc(t('workers.saveWorker'))}</button>
        <a class="btn btn-quiet" href="#/workers">${esc(t('common.close'))}</a>
      </div>
    </form>`;
}

function fixedForm(w) {
  return `
    <form class="card form" id="fixed-form" novalidate>
      <h2>${esc(t('workers.fixedTitle', { name: w.name }))}</h2>
      ${slotEditorHtml(svc.getFixedSchedules(w.id), 'workers.noFixed')}
      <div class="actions"><button type="submit" class="btn btn-primary">${esc(t('workers.saveFixed'))}</button></div>
    </form>`;
}
