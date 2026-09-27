// UC-03 Weekly board for both roles: a time grid (44 px per hour). The owner generates the week (FR-04)
// and edits single shifts (FR-05); the owner also sees an overview strip above the board.
import * as svc from '../core/services.js';
import { now } from '../core/clock.js';
import { addDays, weekStartOf, toMinutes, durationHours, round2 } from '../core/rules.js';
import { t, esc, fmtDay, num, showFormError, pageHead, emptyState } from './i18n.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HOUR_PX = 44;

/** The week shown by a screen: the Monday of the date in the route, or of the demo clock. */
export function weekFromArgs(args) {
  return weekStartOf(args[0] && DATE.test(args[0]) ? args[0] : now().slice(0, 10));
}

/** Previous / this / next week navigation used by the board, attendance and weekly summary. */
export function weekNavHtml(route, week) {
  const label = t('common.weekOf', { from: fmtDay(week), to: fmtDay(addDays(week, 6)) });
  return `
    <div class="weeknav">
      <a class="btn" href="#/${route}/${addDays(week, -7)}">${esc(t('common.prevWeek'))}</a>
      <h2 class="weeknav-label">${esc(label)}</h2>
      <a class="btn" href="#/${route}/${addDays(week, 7)}">${esc(t('common.nextWeek'))}</a>
      <a class="btn btn-quiet" href="#/${route}/${weekStartOf(now().slice(0, 10))}">${esc(t('common.thisWeek'))}</a>
    </div>`;
}

/** Minutes on the work date's axis; an end ≤ start runs into the next day. */
function span(s) {
  const a = toMinutes(s.startTime);
  let b = toMinutes(s.endTime);
  if (b <= a) b += 1440;
  return [a, b];
}

export function render(view, ctx) {
  const { user, args } = ctx;
  const week = weekFromArgs(args);
  const isOwner = user.role === 'OWNER';
  const shifts = svc.getWeekShifts(week);
  const mode = isOwner ? args[1] : null;
  const editing = mode === 'edit' ? shifts.find((s) => s.id === Number(args[2])) : null;
  const thisWeek = weekStartOf(now().slice(0, 10));

  const actions = isOwner ? `
    <button type="button" class="btn btn-primary" data-generate>${esc(t('schedule.generate'))}</button>
    <a class="btn" href="#/schedule/${week}/add">${esc(t('schedule.addShift'))}</a>` : '';

  let empty = '';
  if (!shifts.length) {
    empty = isOwner
      ? emptyState(t('schedule.emptyOwnerTitle'), `<button type="button" class="btn btn-primary" data-generate>${esc(t('schedule.generateWeek', { date: fmtDay(week) }))}</button>`)
      : emptyState(t('schedule.emptyWorkerTitle'), week === thisWeek
        ? `<a class="btn btn-primary" href="#/availability">${esc(t('schedule.setAvailability'))}</a>`
        : `<a class="btn btn-primary" href="#/schedule/${thisWeek}">${esc(t('schedule.goThisWeek'))}</a>`);
  }

  view.innerHTML = `
    ${pageHead(t('schedule.title'), t('purpose.schedule'), actions)}
    ${isOwner ? overviewStrip(thisWeek) : ''}
    <section class="group">
      ${weekNavHtml('schedule', week)}
      ${mode === 'add' || editing ? editForm(editing, week) : ''}
      ${shifts.length ? board(week, shifts, user) : empty}
      ${shifts.length ? `<ul class="legend">
        ${isOwner ? '' : `<li><span class="swatch swatch-own" aria-hidden="true"></span>${esc(t('schedule.legendOwn'))}</li>`}
        <li><span class="swatch swatch-handover" aria-hidden="true"></span>${esc(t('schedule.legendHandover'))}</li>
        <li><span class="swatch swatch-pending" aria-hidden="true"></span>${esc(t('schedule.legendPending'))}</li>
      </ul>` : ''}
    </section>`;

  if (isOwner) bindOwner(view, ctx, week, editing);
}

/** Owner overview: approvals waiting, open requests, and this week's shifts and hours, each linking to its page. */
function overviewStrip(thisWeek) {
  const requests = svc.listOwnerRequests();
  const waiting = requests.filter((r) => r.status === 'ACCEPTED').length;
  const open = requests.filter((r) => r.status === 'REQUESTED').length;
  const weekShifts = svc.getWeekShifts(thisWeek);
  const hours = round2(weekShifts.reduce((sum, s) => sum + durationHours(s.startTime, s.endTime), 0));
  const stat = (href, label, value, alert) => `
    <a class="stat ${alert ? 'stat-alert' : ''}" href="${href}">
      <span class="stat-label">${esc(label)}</span>
      <span class="stat-value num">${esc(value)}</span>
    </a>`;
  return `
    <nav class="overview" aria-label="${esc(t('overview.label'))}">
      ${stat('#/approvals', t('overview.approvals'), waiting, waiting > 0)}
      ${stat('#/approvals', t('overview.open'), open, false)}
      ${stat(`#/weekly/${thisWeek}`, t('overview.week'), t('overview.weekValue', { n: weekShifts.length, h: hours }), false)}
    </nav>`;
}

/** Lane layout: overlapping shifts of one day sit side by side. */
function layoutDay(dayShifts) {
  const items = dayShifts.map((s) => ({ s, span: span(s) })).sort((a, b) => a.span[0] - b.span[0]);
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((x) => x.lane + 1));
    cluster.forEach((x) => { x.lanes = lanes; });
    cluster = [];
  };
  let laneEnds = [];
  for (const item of items) {
    if (item.span[0] >= clusterEnd && cluster.length) {
      flush();
      laneEnds = [];
    }
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

function board(week, shifts, user) {
  const spans = shifts.map(span);
  const axisStart = Math.floor(Math.min(...spans.map((x) => x[0])) / 60) * 60;
  const axisEnd = Math.ceil(Math.max(...spans.map((x) => x[1])) / 60) * 60;
  const hours = [];
  for (let m = axisStart; m <= axisEnd; m += 60) hours.push(m);
  const px = (m) => ((m - axisStart) / 60) * HOUR_PX;
  const label = (m) => `${String((m / 60) % 24).padStart(2, '0')}:00`;
  const today = now().slice(0, 10);
  const lines = hours.map((m) => `<div class="hour-line" style="--top:${px(m)}px"></div>`).join('');

  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  return `
    <div class="board" style="--grid-h:${px(axisEnd)}px">
      <div class="gutter" aria-hidden="true">
        <div class="day-head"></div>
        <div class="lane-area">${hours.map((m) => `<span class="hour-label num" style="--top:${px(m)}px">${label(m)}</span>`).join('')}</div>
      </div>
      ${days.map((d) => {
        const dayShifts = layoutDay(shifts.filter((s) => s.workDate === d));
        const isToday = d === today;
        return `
        <section class="day ${isToday ? 'today' : ''}" aria-label="${esc(fmtDay(d))}">
          <h3 class="day-head">${esc(fmtDay(d))}${isToday ? ` <span class="chip chip-shift">${esc(t('schedule.today'))}</span>` : ''}</h3>
          <div class="lane-area">
            <div class="hour-lines" aria-hidden="true">${lines}</div>
            ${dayShifts.length ? dayShifts.map((x) => shiftBlock(x, px, user)).join('') : `<p class="day-empty">${esc(t('schedule.noShiftsDay'))}</p>`}
          </div>
        </section>`;
      }).join('')}
    </div>`;
}

function shiftBlock({ s, span: [a, b], lane, lanes }, px, user) {
  const handedOver = s.originalWorkerId && s.originalWorkerId !== s.workerId;
  const own = user.role === 'WORKER' && s.workerId === user.id;
  const classes = ['shift', own ? 'own' : '', handedOver ? 'handover' : '', s.openRequestId ? 'pending' : ''].filter(Boolean).join(' ');
  const future = `${s.workDate}T${s.startTime}` > now();
  const canRequest = own && future && s.status === 'SCHEDULED' && !s.openRequestId;
  const style = `--top:${px(a)}px;--height:${px(b) - px(a)}px;--lane:${lane};--lanes:${lanes}`;
  return `
    <article class="${classes}" style="${style}" data-shift="${s.id}">
      <p class="shift-time">${num(`${s.startTime}–${s.endTime}`)}</p>
      <p class="shift-worker">${handedOver ? `<strong>${esc(s.workerName)}</strong>` : esc(s.workerName)}</p>
      ${handedOver ? `<p class="shift-original"><span class="sr-only">${esc(t('schedule.handover', { name: s.originalWorkerName }))}: </span><s>${esc(s.originalWorkerName)}</s></p>` : ''}
      ${s.openRequestId ? `<span class="chip chip-handover">${esc(t('schedule.pending'))}</span>` : ''}
      ${s.status !== 'SCHEDULED' ? `<span class="chip ${s.status === 'ABSENT' ? 'chip-alert' : 'chip-ok'}">${esc(t(`shift.${s.status}`))}</span>` : ''}
      ${canRequest ? `<a class="btn btn-small btn-primary" href="#/requests/new/${s.id}">${esc(t('schedule.request'))}</a>` : ''}
      ${user.role === 'OWNER' ? `<a class="btn btn-small btn-quiet" href="#/schedule/${weekStartOf(s.workDate)}/edit/${s.id}"
          aria-label="${esc(`${t('schedule.editTitle')}: ${fmtDay(s.workDate)} ${s.startTime}–${s.endTime} ${s.workerName}`)}">${esc(t('workers.edit'))}</a>` : ''}
    </article>`;
}

function editForm(shift, week) {
  const workers = svc.listWorkers().filter((w) => w.role === 'WORKER' && (w.active || (shift && w.id === shift.workerId)));
  const s = shift || { workDate: week, startTime: '', endTime: '', workerId: '' };
  return `
    <form class="card form" id="shift-form">
      <h2>${esc(t(shift ? 'schedule.editTitle' : 'schedule.addTitle'))}</h2>
      <div class="fields">
        <label>${esc(t('common.date'))}<input type="date" name="workDate" value="${esc(s.workDate)}" required></label>
        <label>${esc(t('common.start'))}<input type="time" name="startTime" value="${esc(s.startTime)}" required></label>
        <label>${esc(t('common.end'))}<input type="time" name="endTime" value="${esc(s.endTime)}" required></label>
        <label>${esc(t('common.worker'))}
          <select name="workerId" required>
            ${workers.map((w) => `<option value="${w.id}" ${w.id === s.workerId ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="actions">
        <button type="submit" class="btn btn-primary">${esc(t('common.save'))}</button>
        ${shift ? `<button type="button" class="btn btn-danger" id="delete-shift">${esc(t('common.delete'))}</button>` : ''}
        <a class="btn btn-quiet" href="#/schedule/${week}">${esc(t('common.close'))}</a>
      </div>
    </form>`;
}

function bindOwner(view, ctx, week, editing) {
  view.querySelectorAll('[data-generate]').forEach((b) => b.addEventListener('click', () => {
    try {
      const { created } = svc.generateWeek(week);
      ctx.flash(created ? t('schedule.generated', { n: created }) : t('schedule.generatedNone'));
      ctx.refresh();
    } catch (err) {
      ctx.fail(err);
    }
  }));
  const form = view.querySelector('#shift-form');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
      svc.editShift(editing ? editing.id : null, { ...data, workerId: Number(data.workerId) });
      ctx.flash(t('common.saved'));
      ctx.go(`#/schedule/${weekStartOf(data.workDate)}`);
    } catch (err) {
      showFormError(form, err);
    }
  });
  const del = view.querySelector('#delete-shift');
  if (del) del.addEventListener('click', () => {
    try {
      svc.editShift(editing.id, { delete: true });
      ctx.flash(t('schedule.deleted'));
      ctx.go(`#/schedule/${week}`);
    } catch (err) {
      showFormError(form, err);
    }
  });
}
