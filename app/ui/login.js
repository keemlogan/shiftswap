// UC-13 Sign-in as a guided demo: a three-step tour plus the list of all accounts (prompt §2.2). In shared mode a notice
// says that everyone who opens the page sees and changes the same fictional data (spec §9, iteration 8).
import * as svc from '../core/services.js';
import { contractHours } from '../core/rules.js';
import { t, esc, dayName, getLang, displayName, initial } from './i18n.js';
import { icon, button, openSheet } from './components.js';

/** '월·수 18:00–23:00' / 'Mon, Wed 18:00–23:00' — fixed shifts grouped by identical time range. */
function fixedSummary(fixed) {
  const groups = new Map();
  for (const f of fixed) {
    const range = `${f.startTime}–${f.endTime}`;
    if (!groups.has(range)) groups.set(range, []);
    groups.get(range).push(dayName(f.weekday));
  }
  const sep = getLang() === 'ko' ? '·' : ', ';
  return [...groups].map(([range, days]) => `${days.join(sep)} ${range}`).join(', ');
}

function summary(w, workers) {
  if (w.role === 'OWNER') {
    return t('login.ownerSummary', { store: displayName(svc.getWorkplace().name), n: workers.filter((x) => x.role === 'WORKER').length });
  }
  const fixed = svc.getFixedSchedules(w.id);
  if (!fixed.length) return t('login.noFixed');
  return t('login.workerSummary', { shifts: fixedSummary(fixed), h: contractHours(fixed) });
}

/** Which tour steps are done: step 1 is remembered in this browser, steps 2 and 3 follow the seed request. */
function tourProgress(tour) {
  const seed = svc.listMyRequests(2).find((r) => r.id === 1);
  return [
    !!tour.step1,
    !!(seed && seed.acceptorId),
    !!(seed && seed.status === 'APPROVED'),
  ];
}

export function render(view, { signIn, tour, resetDemo, shared = false, switchMode = () => {} }) {
  const accounts = svc.listWorkers().filter((w) => w.active);
  const done = tourProgress(tour);
  const current = done.indexOf(false);
  const steps = [
    { title: t('tour.step1'), hint: t('tour.step1Hint'), id: 2, hash: '#/swaps' },
    { title: t('tour.step2'), hint: t('tour.step2Hint'), id: 3, hash: '#/home' },
    { title: t('tour.step3'), hint: t('tour.step3Hint'), id: 1, hash: '#/home' },
  ];

  view.innerHTML = `
    <section class="signin">
      <header class="page-title hero">
        <h1>${esc(t('login.title'))}</h1>
        <p class="purpose">${esc(t('login.sub'))}</p>
      </header>

      <div class="notice mode-notice" role="note">${icon('info')}
        <div><p>${esc(t(shared ? 'login.sharedNotice' : 'login.localNotice'))}</p>
          ${button({ label: t(shared ? 'demo.toLocal' : 'demo.toShared'), kind: 'text', small: true, id: 'mode-switch' })}</div>
      </div>

      <section class="card tour" aria-labelledby="tour-title">
        <div class="card-head">
          <h2 class="card-title" id="tour-title">${esc(t('tour.title'))}</h2>
          <p class="muted">${esc(current === -1 ? t('tour.allDone') : t('tour.sub'))}</p>
        </div>
        <ol class="tour-steps">
          ${steps.map((s, i) => `
            <li class="tour-step ${done[i] ? 'is-done' : ''} ${i === current ? 'is-current' : ''}">
              <span class="tour-num" aria-hidden="true">${done[i] ? icon('check') : `<span class="num">${i + 1}</span>`}</span>
              <div class="tour-text">
                <strong>${esc(s.title)}</strong>
                <span class="muted">${esc(s.hint)}</span>
                ${done[i] ? `<span class="sr-only">${esc(t('tour.done'))}</span>` : ''}
              </div>
              ${button({
                label: i === current ? t('tour.start') : done[i] ? t('tour.again') : t('tour.open'),
                kind: i === current ? 'primary' : 'secondary',
                small: i !== current,
                attrs: `data-step="${i}"`,
              })}
            </li>`).join('')}
        </ol>
        ${current === -1 ? `<div class="card-foot">${button({ label: t('tour.restart'), kind: 'primary', block: true, id: 'restart' })}</div>` : ''}
      </section>

      <section aria-labelledby="all-title">
        <h2 class="section-title" id="all-title">${esc(t('login.all'))}</h2>
        <ul class="accounts">
          ${accounts.map((w) => `
            <li>
              <button type="button" class="account" data-id="${w.id}">
                <span class="avatar avatar-lg" aria-hidden="true">${esc(initial(w.name))}</span>
                <span class="account-main">
                  <span class="account-name">${esc(displayName(w.name))} <span class="chip ${w.role === 'OWNER' ? 'chip-ink' : ''}">${esc(t(`role.${w.role}`))}</span></span>
                  <span class="account-summary">${esc(summary(w, accounts))}</span>
                </span>
                ${icon('chevronRight', 'chev')}
              </button>
            </li>`).join('')}
        </ul>
      </section>
    </section>`;

  view.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.step);
    if (i === 0) {
      tour.step1 = true;
      try {
        localStorage.setItem('shiftswap.tour.v1', JSON.stringify(tour));
      } catch {
        // Storage blocked: progress is not remembered.
      }
    }
    signIn(steps[i].id, steps[i].hash);
  }));
  view.querySelectorAll('.account').forEach((b) => b.addEventListener('click', () => signIn(Number(b.dataset.id))));
  view.querySelector('#mode-switch').addEventListener('click', () => switchMode(shared ? 'local' : 'shared'));
  const restart = view.querySelector('#restart');
  if (restart) restart.addEventListener('click', () => openSheet({
    title: t('demo.reset'),
    body: `<p>${esc(t(shared ? 'demo.resetSharedConfirm' : 'demo.resetConfirm'))}</p><div class="row-2 sheet-actions">${button({ label: t('common.cancel'), attrs: 'data-close' })}${button({ label: t('demo.resetYes'), kind: 'danger', id: 'restart-yes' })}</div>`,
    onMount: (panel, close) => {
      panel.querySelector('#restart-yes').addEventListener('click', () => { close(); resetDemo(); });
      panel.querySelectorAll('[data-close]').forEach((x) => x.addEventListener('click', close));
    },
  }));
}
