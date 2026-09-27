// UC-13 Sign in by role: pick a demo account.
import * as svc from '../core/services.js';
import { contractHours } from '../core/rules.js';
import { t, esc, dayName } from './i18n.js';

/** 'Mon, Wed 18:00–23:00' — fixed shifts grouped by identical time range. */
function fixedSummary(fixed) {
  const groups = new Map();
  for (const f of fixed) {
    const range = `${f.startTime}–${f.endTime}`;
    if (!groups.has(range)) groups.set(range, []);
    groups.get(range).push(dayName(f.weekday));
  }
  return [...groups].map(([range, days]) => `${days.join(', ')} ${range}`).join(', ');
}

function summary(w, workers) {
  if (w.role === 'OWNER') {
    return t('login.ownerSummary', { store: svc.getWorkplace().name, n: workers.filter((x) => x.role === 'WORKER').length });
  }
  const fixed = svc.getFixedSchedules(w.id);
  if (!fixed.length) return t('login.noFixed');
  return t('login.workerSummary', { shifts: fixedSummary(fixed), h: contractHours(fixed) });
}

export function render(view, { signIn }) {
  const accounts = svc.listWorkers().filter((w) => w.active);
  view.innerHTML = `
    <section class="signin">
      <header class="page-title">
        <h1>${esc(t('login.title'))}</h1>
        <p class="purpose">${esc(t('login.note'))}</p>
      </header>
      <ul class="accounts">
        ${accounts.map((w) => `
          <li>
            <button type="button" class="account" data-id="${w.id}">
              <span class="account-main">
                <span class="account-name">${esc(w.name)}</span>
                <span class="account-summary">${esc(summary(w, accounts))}</span>
              </span>
              <span class="chip ${w.role === 'OWNER' ? 'chip-ink' : ''}">${esc(t(`role.${w.role}`))}</span>
            </button>
          </li>`).join('')}
      </ul>
    </section>`;
  view.querySelectorAll('.account').forEach((b) => b.addEventListener('click', () => signIn(Number(b.dataset.id))));
}
