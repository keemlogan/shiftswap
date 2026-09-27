// UC-03 Schedule (prompt §2.6): time grid on desktop, day-by-day list on mobile, and a detail sheet per shift
// with its history and only the actions relevant to the viewer.
import * as svc from '../core/services.js';
import { addDays, weekStartOf, toMinutes } from '../core/rules.js';
import { t, esc, fmtDate, fmtDateShort, fmtShift, given, displayName, showFormError, num } from './i18n.js';
import { icon, button, pageHead, emptyState, shiftChips, shiftClasses, openSheet, timeOptions } from './components.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HOUR_PX = 44;

/** The week shown: the Monday of the date in the route, or of the demo clock. */
export function weekFromArgs(args, nowIso) {
  return weekStartOf(args[0] && DATE.test(args[0]) ? args[0] : nowIso.slice(0, 10));
}

/** ‹ label › and "This week" for weekly screens. */
export function weekNav(route, week, nowIso, label) {
  const thisWeek = weekStartOf(nowIso.slice(0, 10));
  return `
    <nav class="period-nav" aria-label="${esc(label)}">
      <a class="icon-btn" href="#/${route}/${addDays(week, -7)}" aria-label="${esc(t('common.prevWeek'))}">${icon('chevronLeft')}</a>
      <p class="period-label">${esc(label)}</p>
      <a class="icon-btn" href="#/${route}/${addDays(week, 7)}" aria-label="${esc(t('common.nextWeek'))}">${icon('chevronRight')}</a>
      ${week !== thisWeek ? `<a class="btn btn-text btn-small" href="#/${route}/${thisWeek}">${esc(t('common.thisWeek'))}</a>` : ''}
    </nav>`;
}

function span(s) {
  const a = toMinutes(s.startTime);
  let b = toMinutes(s.endTime);
  if (b <= a) b += 1440;
  return [a, b];
}

/** Overlapping shifts of one day share the column width in lanes. */
function layoutDay(dayShifts) {
  const items = dayShifts.map((s) => ({ s, span: span(s) })).sort((a, b) => a.span[0] - b.span[0]);
  let cluster = [];
  let clusterEnd = -1;
  let laneEnds = [];
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((x) => x.lane + 1));
    cluster.forEach((x) => { x.lanes = lanes; });
    cluster = [];
    laneEnds = [];
  };
  for (const item of items) {
    if (cluster.length && item.span[0] >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= item.span[0]);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = item.span[1];
    item.lane = lane;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.span[1]);
  }
  if (cluster.length) flush();
  return items;
}

export function render(view, ctx) {
  const { user } = ctx;
  const week = weekFromArgs(ctx.args, ctx.now);
  const isOwner = user.role === 'OWNER';
  const shifts = svc.getWeekShifts(week);
  const label = `${fmtDate(week)} – ${fmtDate(addDays(week, 6))}`;

  let cta;
  if (isOwner) {
    cta = shifts.length
      ? button({ label: t('schedule.add'), kind: 'primary', block: true, id: 'add-shift', iconName: 'plus' })
      : button({ label: t('schedule.generate'), kind: 'primary', block: true, id: 'generate' });
  } else {
    const canRequest = svc.listRequestableShifts(user.id).length > 0;
    cta = button({ label: t('schedule.findCover'), kind: 'primary', block: true, href: '#/swaps/new/1', disabled: !canRequest, reason: t('schedule.findDisabled') });
  }

  view.innerHTML = `
    ${pageHead({ title: t('schedule.title'), cta })}
    ${weekNav('schedule', week, ctx.now, label)}
    ${shifts.length ? board(week, shifts, ctx) : emptyState(t(isOwner ? 'schedule.emptyOwner' : 'schedule.emptyWorker'))}
    ${shifts.length ? `<ul class="legend">
      ${isOwner ? '' : `<li><span class="swatch swatch-own" aria-hidden="true"></span>${esc(t('schedule.legendOwn'))}</li>`}
      <li><span class="swatch swatch-handover" aria-hidden="true"></span>${esc(t('schedule.legendHandover'))}</li>
      <li><span class="swatch swatch-pending" aria-hidden="true"></span>${esc(t('schedule.legendPending'))}</li>
    </ul>` : ''}`;

  view.querySelectorAll('[data-shift]').forEach((b) => b.addEventListener('click', () => openDetail(ctx, Number(b.dataset.shift), week)));
  view.querySelectorAll('[data-day-toggle]').forEach((b) => b.addEventListener('click', () => {
    const day = b.closest('.day');
    const open = day.classList.toggle('is-collapsed') === false;
    b.setAttribute('aria-expanded', String(open));
  }));
  const gen = view.querySelector('#generate');
  if (gen) gen.addEventListener('click', () => {
    try {
      const { created } = svc.generateWeek(week);
      ctx.toast(created ? t('schedule.generated', { n: created }) : t('schedule.generatedNone'));
      ctx.refresh();
    } catch (err) {
      ctx.fail(err);
    }
  });
  const add = view.querySelector('#add-shift');
  if (add) add.addEventListener('click', () => openAdd(ctx, week));
}

function board(week, shifts, ctx) {
  const spans = shifts.map(span);
  const axisStart = Math.floor(Math.min(...spans.map((x) => x[0])) / 60) * 60;
  const axisEnd = Math.ceil(Math.max(...spans.map((x) => x[1])) / 60) * 60;
  const hours = [];
  for (let m = axisStart; m <= axisEnd; m += 60) hours.push(m);
  const px = (m) => ((m - axisStart) / 60) * HOUR_PX;
  const hourLabel = (m) => `${String((m / 60) % 24).padStart(2, '0')}:00`;
  const today = ctx.now.slice(0, 10);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const openDay = days.includes(today) ? today : days.find((d) => shifts.some((s) => s.workDate === d));
  const lines = hours.map((m) => `<div class="hour-line" style="--top:${px(m)}px"></div>`).join('');

  return `
    <div class="board" style="--grid-h:${px(axisEnd)}px">
      <div class="gutter" aria-hidden="true">
        <div class="day-head"></div>
        <div class="lane-area">${hours.map((m) => `<span class="hour-label num" style="--top:${px(m)}px">${hourLabel(m)}</span>`).join('')}</div>
      </div>
      ${days.map((d) => {
        const dayShifts = layoutDay(shifts.filter((s) => s.workDate === d));
        const isToday = d === today;
        const open = d === openDay;
        return `
        <section class="day ${isToday ? 'today' : ''} ${open ? '' : 'is-collapsed'}" aria-label="${esc(fmtDate(d))}">
          <h3 class="day-head">
            <button type="button" class="day-toggle" data-day-toggle aria-expanded="${open}">
              <span class="day-name">${esc(fmtDateShort(d))}</span>
              ${isToday ? `<span class="chip chip-shift">${esc(t('common.today'))}</span>` : ''}
              <span class="day-count muted">${esc(dayShifts.length ? t(dayShifts.length === 1 ? 'schedule.count1' : 'schedule.count', { n: dayShifts.length }) : t('schedule.noShifts'))}</span>
              ${icon('chevronDown', 'chev')}
            </button>
          </h3>
          <div class="lane-area">
            <div class="hour-lines" aria-hidden="true">${lines}</div>
            ${dayShifts.map((x) => shiftBlock(x, px, ctx.user)).join('')}
          </div>
        </section>`;
      }).join('')}
    </div>`;
}

function shiftBlock({ s, span: [a, b], lane, lanes }, px, user) {
  const handedOver = s.originalWorkerId && s.originalWorkerId !== s.workerId;
  const style = `--top:${px(a)}px;--height:${px(b) - px(a)}px;--lane:${lane};--lanes:${lanes}`;
  const label = `${fmtShift(s)}, ${displayName(s.workerName)}${handedOver ? `, ${t('schedule.covering', { name: displayName(s.originalWorkerName) })}` : ''}${s.openRequestId ? `, ${t('schedule.pending')}` : ''}`;
  return `
    <button type="button" class="shift ${shiftClasses(s, user)}" style="${style}" data-shift="${s.id}" aria-label="${esc(label)}">
      <span class="shift-time num">${esc(`${s.startTime}–${s.endTime}`)}</span>
      <span class="shift-worker">${handedOver ? `<strong>${esc(displayName(s.workerName))}</strong>` : esc(displayName(s.workerName))}</span>
      ${handedOver ? `<s class="shift-original">${esc(displayName(s.originalWorkerName))}</s>` : ''}
      ${shiftChips(s)}
    </button>`;
}

function historyLines(detail) {
  if (!detail.history.length) return `<p class="muted">${esc(t('detail.noHistory'))}</p>`;
  return `<ul class="history-list">${detail.history.map((r) => {
    const date = fmtDateShort((r.decidedAt || r.createdAt).slice(0, 10));
    const from = given(r.requesterName);
    const to = r.acceptorName ? given(r.acceptorName) : '';
    let line;
    if (r.status === 'APPROVED') line = t('detail.hApproved', { from, to, date });
    else if (r.status === 'ACCEPTED') line = t('detail.hAccepted', { from, to });
    else if (r.status === 'REQUESTED') line = t('detail.hRequested', { from, date });
    else line = t('detail.hEnded', { from, date, status: t(`end.${r.status}`) });
    return `<li>${esc(line)}</li>`;
  }).join('')}</ul>`;
}

function openDetail(ctx, shiftId, week) {
  const d = svc.getShiftDetail(shiftId);
  const isOwner = ctx.user.role === 'OWNER';
  const handedOver = d.originalWorkerId && d.originalWorkerId !== d.workerId;
  const ownFuture = !isOwner && d.workerId === ctx.user.id && d.status === 'SCHEDULED' && `${d.workDate}T${d.startTime}` > ctx.now && !d.openRequestId;
  let actions = '';
  if (ownFuture) {
    actions = `<p class="muted">${esc(t('detail.ownFuture'))}</p>${button({ label: t('schedule.findCover'), kind: 'primary', block: true, href: `#/swaps/new/1/${d.id}` })}`;
  } else if (isOwner) {
    actions = `
      <div class="stack-tight">
        ${button({ label: t('detail.changeTime'), kind: 'primary', block: true, id: 'act-time', disabled: !!d.openRequestId, reason: t('err.SHIFT_OPEN_REQUEST') })}
        ${button({ label: t('detail.changeWorker'), kind: 'secondary', block: true, id: 'act-worker', disabled: !!d.openRequestId, reason: t('err.SHIFT_OPEN_REQUEST') })}
        ${button({ label: t('detail.delete'), kind: 'danger', block: true, id: 'act-delete', disabled: !d.canDelete, reason: t('detail.deleteBlocked') })}
      </div>`;
  }
  openSheet({
    title: fmtShift(d),
    body: `
      <div>
        <dl class="summary-list detail ${shiftClasses(d, ctx.user)}">
          <div><dt>${esc(t('detail.worker'))}</dt><dd>${handedOver ? `<strong>${esc(displayName(d.workerName))}</strong> <s class="muted">${esc(displayName(d.originalWorkerName))}</s>` : esc(displayName(d.workerName))}</dd></div>
          <div><dt>${esc(t('detail.status'))}</dt><dd>${esc(t(`shift.${d.status}`))} ${shiftChips(d)}</dd></div>
          ${d.clockIn ? `<div><dt>${esc(t('record.title'))}</dt><dd>${num(`${d.clockIn}–${d.clockOut}`)}</dd></div>` : ''}
        </dl>
        <h3 class="sub-title">${esc(t('detail.history'))}</h3>
        ${historyLines(d)}
      </div>
      <div class="sheet-actions" id="detail-actions">${actions}</div>`,
    onMount: (panel, close) => {
      const area = panel.querySelector('#detail-actions');
      const time = panel.querySelector('#act-time');
      if (time && !time.disabled) time.addEventListener('click', () => {
        area.innerHTML = `
          <form class="form" id="time-form" novalidate>
            <label class="field"><span class="field-label">${esc(t('detail.date'))}</span><input type="date" name="workDate" value="${esc(d.workDate)}"></label>
            <div class="row-2">
              <label class="field"><span class="field-label">${esc(t('detail.start'))}</span><select name="startTime" class="num">${timeOptions(d.startTime)}</select></label>
              <label class="field"><span class="field-label">${esc(t('detail.end'))}</span><select name="endTime" class="num">${timeOptions(d.endTime)}</select></label>
            </div>
            ${button({ label: t('detail.saveTime'), kind: 'primary', block: true, id: 'save-time' })}
          </form>`;
        const form = area.querySelector('#time-form');
        area.querySelector('#save-time').addEventListener('click', () => {
          try {
            svc.editShift(d.id, { workDate: form.workDate.value, startTime: form.startTime.value, endTime: form.endTime.value });
            close();
            ctx.toast(t('detail.changed'));
            ctx.go(`#/schedule/${weekStartOf(form.workDate.value)}`);
          } catch (err) {
            showFormError(form, err);
          }
        });
        form.workDate.focus();
      });
      const who = panel.querySelector('#act-worker');
      if (who && !who.disabled) who.addEventListener('click', () => {
        const workers = svc.listWorkers().filter((w) => w.role === 'WORKER' && w.active);
        area.innerHTML = `
          <form class="form" id="worker-form" novalidate>
            <label class="field"><span class="field-label">${esc(t('detail.worker'))}</span>
              <select name="workerId">${workers.map((w) => `<option value="${w.id}" ${w.id === d.workerId ? 'selected' : ''}>${esc(displayName(w.name))}</option>`).join('')}</select></label>
            ${button({ label: t('detail.saveWorker'), kind: 'primary', block: true, id: 'save-worker' })}
          </form>`;
        const form = area.querySelector('#worker-form');
        area.querySelector('#save-worker').addEventListener('click', () => {
          try {
            svc.editShift(d.id, { workerId: Number(form.workerId.value) });
            close();
            ctx.toast(t('detail.changed'));
            ctx.refresh();
          } catch (err) {
            showFormError(form, err);
          }
        });
        form.workerId.focus();
      });
      const del = panel.querySelector('#act-delete');
      if (del && !del.disabled) del.addEventListener('click', () => {
        try {
          svc.editShift(d.id, { delete: true });
          close();
          ctx.toast(t('detail.deleted'));
          ctx.go(`#/schedule/${week}`);
        } catch (err) {
          ctx.fail(err);
        }
      });
    },
  });
}

function openAdd(ctx, week) {
  const workers = svc.listWorkers().filter((w) => w.role === 'WORKER' && w.active);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const today = ctx.now.slice(0, 10);
  openSheet({
    title: t('detail.addTitle'),
    body: `
      <form class="form" id="add-form" novalidate>
        <label class="field"><span class="field-label">${esc(t('detail.date'))}</span>
          <select name="workDate">${days.map((d) => `<option value="${d}" ${d === today ? 'selected' : ''}>${esc(fmtDate(d))}</option>`).join('')}</select></label>
        <div class="row-2">
          <label class="field"><span class="field-label">${esc(t('detail.start'))}</span><select name="startTime" class="num">${timeOptions('10:00')}</select></label>
          <label class="field"><span class="field-label">${esc(t('detail.end'))}</span><select name="endTime" class="num">${timeOptions('15:00')}</select></label>
        </div>
        <label class="field"><span class="field-label">${esc(t('detail.worker'))}</span>
          <select name="workerId">${workers.map((w) => `<option value="${w.id}">${esc(displayName(w.name))}</option>`).join('')}</select></label>
        ${button({ label: t('detail.addSave'), kind: 'primary', block: true, id: 'add-save' })}
      </form>`,
    onMount: (panel, close) => {
      const form = panel.querySelector('#add-form');
      panel.querySelector('#add-save').addEventListener('click', () => {
        try {
          svc.editShift(null, { workDate: form.workDate.value, startTime: form.startTime.value, endTime: form.endTime.value, workerId: Number(form.workerId.value) });
          close();
          ctx.toast(t('detail.added'));
          ctx.refresh();
        } catch (err) {
          showFormError(form, err);
        }
      });
    },
  });
}
