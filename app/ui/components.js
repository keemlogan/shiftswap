// Shared UI building blocks: line icons, buttons, page header with its one primary action, request tracker,
// shift markers, bottom sheets / side panels and toasts.
import { t, esc } from './i18n.js';

const PATHS = {
  home: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11h13V9"/><path d="M10 20v-5.5h4V20"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  swap: '<path d="M7.5 4 4 7.5 7.5 11"/><path d="M4 7.5h13"/><path d="M16.5 13l3.5 3.5-3.5 3.5"/><path d="M20 16.5H7"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1.4-3.8 4.2-5.8 7.5-5.8s6.1 2 7.5 5.8"/>',
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20c1.2-3.4 3.6-5.2 6.5-5.2s5.3 1.8 6.5 5.2"/><path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6"/><path d="M17.5 14.9c2 .7 3.3 2.4 4 5.1"/>',
  pay: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5v5M18 9.5v5"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  chevronLeft: '<path d="M14.5 5 8 12l6.5 7"/>',
  chevronRight: '<path d="M9.5 5 16 12l-6.5 7"/>',
  chevronDown: '<path d="M5.5 9.5 12 16l6.5-6.5"/>',
  check: '<path d="M5 12.5 10 17.5 19 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.7M12 18.5v2.7M4.9 4.9l1.9 1.9M17.2 17.2l1.9 1.9M2.8 12h2.7M18.5 12h2.7M4.9 19.1l1.9-1.9M17.2 6.8l1.9-1.9"/>',
  more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.6 3.5 5.5 3.5 8.5s-1.1 5.9-3.5 8.5c-2.4-2.6-3.5-5.5-3.5-8.5s1.1-5.9 3.5-8.5z"/>',
  logout: '<path d="M14 4.5h4.5v15H14"/><path d="M10 8l-4 4 4 4M6 12h9.5"/>',
  alert: '<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.2M12 16.9v.1"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.1"/>',
};

/** A 24 px line icon (1.75 px stroke, currentColor). */
export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`;
}

let reasonSeq = 0;

/**
 * A button (or link when `href` is given). kind: primary | secondary | text | danger.
 * A disabled button always carries a one-line reason beneath it (prompt §2.0 rule 8).
 */
export function button({ label, kind = 'secondary', id = '', attrs = '', href = '', disabled = false, reason = '', block = false, small = false, iconName = '' }) {
  const cls = ['btn', `btn-${kind}`, block ? 'btn-block' : '', small ? 'btn-small' : ''].filter(Boolean).join(' ');
  const inner = `${iconName ? icon(iconName) : ''}<span>${esc(label)}</span>`;
  const idAttr = id ? ` id="${id}"` : '';
  if (href && !disabled) return `<a class="${cls}" href="${href}"${idAttr} ${attrs}>${inner}</a>`;
  if (!disabled) return `<button type="button" class="${cls}"${idAttr} ${attrs}>${inner}</button>`;
  const rid = `reason-${++reasonSeq}`;
  return `<span class="btn-wrap ${block ? 'btn-wrap-block' : ''}">
    <button type="button" class="${cls}"${idAttr} ${attrs} disabled aria-describedby="${rid}">${inner}</button>
    <span class="btn-reason" id="${rid}">${esc(reason)}</span></span>`;
}

/**
 * Page header: title, one sentence on what the page is for, and the page's one primary action (`cta`),
 * which is fixed to the bottom of the screen below 900 px.
 */
export function pageHead({ title, sub = '', cta = '', back = '' }) {
  return `
    <header class="page-head">
      ${back}
      <div class="page-title">
        <h1>${esc(title)}</h1>
        ${sub ? `<p class="purpose">${esc(sub)}</p>` : ''}
      </div>
    </header>
    ${cta ? `<div class="cta-bar">${cta}</div>` : ''}`;
}

/** Section heading with an optional count. */
export function sectionHead(title, count = null) {
  return `<h2 class="section-title">${esc(title)}${count != null ? ` <span class="count num">${count}</span>` : ''}</h2>`;
}

/** Empty state: what will appear here and, when there is one, the next action. */
export function emptyState(text, action = '') {
  return `<div class="empty-state"><p>${esc(text)}</p>${action}</div>`;
}

const STEPS = ['REQUESTED', 'ACCEPTED', 'APPROVED'];

/** The three-step tracker 요청 → 수락 → 승인, or a labelled end state (prompt §2.0 rule 6). */
export function tracker(status) {
  if (['REJECTED', 'EXPIRED', 'CANCELLED'].includes(status)) {
    return `<div class="endstate endstate-${status.toLowerCase()}" role="status">
      ${icon(status === 'CANCELLED' ? 'x' : 'alert')}
      <div><strong>${esc(t(`end.${status}`))}</strong><span>${esc(t(`end.${status}why`))}</span></div>
    </div>`;
  }
  const at = STEPS.indexOf(status);
  return `<ol class="tracker" aria-label="${esc(t('track.label'))}">
    ${STEPS.map((s, i) => {
      const state = i < at || status === 'APPROVED' ? 'done' : i === at ? 'current' : 'todo';
      return `<li class="step ${state}" ${i === at ? 'aria-current="step"' : ''}>
        <span class="step-dot">${state === 'done' ? icon('check') : `<span class="num">${i + 1}</span>`}</span>
        <span class="step-label">${esc(t(`track.${s}`))}</span>
      </li>`;
    }).join('')}
  </ol>`;
}

/** Chips shown on any shift card: handed over / looking for cover / worked / absent. */
export function shiftChips(s) {
  const chips = [];
  if (s.openRequestId) chips.push(`<span class="chip chip-handover">${esc(t('schedule.pending'))}</span>`);
  if (s.status === 'WORKED') chips.push(`<span class="chip chip-ok">${esc(t('shift.WORKED'))}</span>`);
  if (s.status === 'ABSENT') chips.push(`<span class="chip chip-alert">${esc(t('shift.ABSENT'))}</span>`);
  return chips.join('');
}

/** CSS classes of the signature element for a shift (handover stripe, dashed pending outline, own shift). */
export function shiftClasses(s, viewer) {
  return [
    s.originalWorkerId && s.originalWorkerId !== s.workerId ? 'handover' : '',
    s.openRequestId ? 'pending' : '',
    viewer && viewer.role === 'WORKER' && s.workerId === viewer.id ? 'own' : '',
  ].filter(Boolean).join(' ');
}

// ---- Sheets (mobile) / side panels (desktop) ------------------------------

let openSheetState = null;

/**
 * Open a sheet with a title and body HTML. `onMount(panel, close)` binds its controls. The rest of the app is
 * made inert while the sheet is open, Escape and the backdrop close it, and focus returns afterwards.
 */
export function openSheet({ title, body, onMount = () => {}, variant = 'sheet' }) {
  closeSheet();
  const root = document.getElementById('sheet-root');
  const app = document.getElementById('app');
  const returnFocus = document.activeElement;
  root.className = `sheet-root-${variant}`;
  root.innerHTML = `
    <div class="sheet-backdrop" data-close></div>
    <section class="sheet sheet-${variant}" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <header class="sheet-head">
        <h2 id="sheet-title" tabindex="-1">${esc(title)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="${esc(t('common.close'))}">${icon('x')}</button>
      </header>
      <div class="sheet-body">${body}</div>
    </section>`;
  app.inert = true;
  const panel = root.querySelector('.sheet');
  const close = () => closeSheet();
  root.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close));
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  openSheetState = { root, app, returnFocus, onKey };
  onMount(panel, close);
  panel.querySelector('#sheet-title').focus();
  return close;
}

export function closeSheet() {
  if (!openSheetState) return;
  const { root, app, returnFocus, onKey } = openSheetState;
  openSheetState = null;
  document.removeEventListener('keydown', onKey);
  root.innerHTML = '';
  root.className = '';
  app.inert = false;
  if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
}

// ---- Toasts ------------------------------------------------------------------

let toastTimer = null;

/** A short result message that says what happened and what happens next (prompt §2.0 rule 5). */
export function toast(message, kind = 'ok') {
  const root = document.getElementById('toast-root');
  if (!root) return;
  root.innerHTML = `<div class="toast toast-${kind}">${icon(kind === 'ok' ? 'check' : 'alert')}<span>${esc(message)}</span></div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { root.innerHTML = ''; }, 4200);
}

/** Time options every 30 minutes for the start/end selects. */
export function timeOptions(selected) {
  const out = [];
  for (let m = 0; m < 1440; m += 30) {
    const v = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    out.push(`<option value="${v}" ${v === selected ? 'selected' : ''}>${v}</option>`);
  }
  if (selected && !out.some((o) => o.includes(`"${selected}"`))) out.unshift(`<option value="${selected}" selected>${selected}</option>`);
  return out.join('');
}
