// Bootstrap and hash router. Every route change first lets the System Clock expire overdue requests (UC-11).
import { openDatabase, resetDatabase } from './core/db.js';
import { attachClockStorage, now, setNow, advance, resetClock } from './core/clock.js';
import * as svc from './core/services.js';
import { t, esc, getLang, setLang, errorText } from './ui/i18n.js';
import * as login from './ui/login.js';
import * as schedule from './ui/schedule.js';
import * as requests from './ui/requests.js';
import * as inbox from './ui/inbox.js';
import * as approvals from './ui/approvals.js';
import * as attendance from './ui/attendance.js';
import * as weekly from './ui/weekly.js';
import * as payroll from './ui/payroll.js';
import * as workers from './ui/workers.js';
import * as availability from './ui/availability.js';
import * as settings from './ui/settings.js';

const SCREENS = { schedule, requests, inbox, approvals, attendance, weekly, payroll, workers, availability, settings };
const SESSION_KEY = 'shiftswap.user';

const root = document.getElementById('app');
let flash = null;

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

function usable(getStore) {
  try {
    const store = getStore();
    store.setItem('shiftswap.probe', '1');
    store.removeItem('shiftswap.probe');
    return store;
  } catch {
    return memoryStorage();
  }
}

const local = usable(() => window.localStorage);
const session = usable(() => window.sessionStorage);

function currentUser() {
  const id = Number(session.getItem(SESSION_KEY));
  const user = id ? svc.getWorker(id) : null;
  return user && user.active ? user : null;
}

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { name: parts[0] || '', args: parts.slice(1).map(decodeURIComponent) };
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function setFlash(text, kind = 'ok') {
  flash = { text, kind };
}

function render() {
  svc.expireOverdue();
  document.documentElement.lang = getLang();
  const user = currentUser();
  const { name, args } = parseHash();
  if (!user) {
    if (name !== 'login') {
      history.replaceState(null, '', '#/login');
    }
    renderShell(null, 'login');
    login.render(root.querySelector('#view'), { go, signIn });
    return;
  }
  const allowed = svc.menuFor(user.role);
  const route = allowed.includes(name) ? name : 'schedule';
  if (route !== name) history.replaceState(null, '', `#/${route}`);
  renderShell(user, route);
  const view = root.querySelector('#view');
  const ctx = {
    user,
    args,
    go,
    refresh: render,
    flash: setFlash,
    fail: (err) => showError(err),
    setUnread: (n) => updateBadge(n),
  };
  try {
    SCREENS[route].render(view, ctx);
  } catch (err) {
    console.error(err);
    view.insertAdjacentHTML('afterbegin', `<p class="notice notice-alert" role="alert">${esc(errorText(err))}</p>`);
  }
  document.title = `${t(`nav.${route}`)} · ShiftSwap`;
}

function showError(err) {
  if (!err || !err.code) console.error(err);
  setFlash(errorText(err), 'alert');
  render();
}

function signIn(id) {
  session.setItem(SESSION_KEY, String(id));
  go('#/schedule');
}

function updateBadge(n) {
  const navCount = root.querySelector('.nav-count');
  if (navCount && n === 0) navCount.remove();
  const badge = root.querySelector('.badge-count');
  if (!badge) return;
  badge.textContent = n;
  badge.hidden = n === 0;
  badge.closest('a').setAttribute('aria-label', `${t('nav.inbox')}, ${t('header.unread', { n })}`);
}

function navHtml(user, route) {
  const unread = svc.unreadCount(user.id);
  return `<nav class="nav" aria-label="${esc(t('nav.label'))}"><ul>${svc.menuFor(user.role).map((key) => `
    <li><a href="#/${key}" ${key === route ? 'aria-current="page"' : ''}>${esc(t(`nav.${key}`))}${key === 'inbox' && unread ? ` <span class="nav-count num">${unread}</span>` : ''}</a></li>`).join('')}
  </ul></nav>`;
}

function renderShell(user, route) {
  const wp = svc.getWorkplace();
  const unread = user ? svc.unreadCount(user.id) : 0;
  const message = flash;
  flash = null;
  root.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <span class="store">${esc(wp.name)}</span>
        <span class="product">ShiftSwap</span>
      </div>
      <div class="controls">
        ${user ? `<span class="who">${esc(t('header.signedIn', { name: user.name }))} <span class="chip">${esc(t(`role.${user.role}`))}</span></span>
        <a class="inbox-link" href="#/inbox" aria-label="${esc(t('nav.inbox'))}, ${esc(t('header.unread', { n: unread }))}">${esc(t('nav.inbox'))}
          <span class="badge-count num" ${unread ? '' : 'hidden'}>${unread}</span></a>` : ''}
        <form class="clock" aria-label="${esc(t('header.clock'))}">
          <label for="clock-input">${esc(t('header.clock'))}</label>
          <input id="clock-input" type="datetime-local" class="num" value="${esc(now())}" step="60" required>
          <button type="button" class="btn-small" data-advance="60">${esc(t('header.plusHour'))}</button>
          <button type="button" class="btn-small" data-advance="1440">${esc(t('header.plusDay'))}</button>
        </form>
        <label class="lang"><span class="sr-only">${esc(t('header.language'))}</span>
          <select id="lang-select">
            <option value="en" ${getLang() === 'en' ? 'selected' : ''}>English</option>
            <option value="ko" ${getLang() === 'ko' ? 'selected' : ''}>한국어</option>
          </select>
        </label>
        <details class="menu">
          <summary>${esc(t('header.menu'))}</summary>
          <div class="menu-panel">
            <button type="button" id="reset-demo">${esc(t('header.reset'))}</button>
            ${user ? `<button type="button" id="sign-out">${esc(t('header.signOut'))}</button>` : ''}
          </div>
        </details>
      </div>
    </header>
    <div class="layout ${user ? 'with-nav' : ''}">
      ${user ? navHtml(user, route) : ''}
      <main id="main" class="content">
        ${message ? `<p class="notice notice-${message.kind}" role="${message.kind === 'alert' ? 'alert' : 'status'}">${esc(message.text)}</p>` : ''}
        <div id="view"></div>
      </main>
    </div>`;
  bindShell();
}

function bindShell() {
  const clock = root.querySelector('#clock-input');
  clock.addEventListener('change', () => {
    const value = clock.value.slice(0, 16);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
      showError({ code: 'CLOCK_INVALID', params: {} });
      return;
    }
    setNow(value);
    render();
  });
  root.querySelectorAll('[data-advance]').forEach((b) => b.addEventListener('click', () => {
    advance(Number(b.dataset.advance));
    render();
  }));
  root.querySelector('#lang-select').addEventListener('change', (e) => {
    setLang(e.target.value);
    render();
  });
  root.querySelector('#reset-demo').addEventListener('click', () => {
    if (!window.confirm(t('header.resetConfirm'))) return;
    resetDatabase();
    resetClock();
    session.removeItem(SESSION_KEY);
    go('#/login');
  });
  const out = root.querySelector('#sign-out');
  if (out) out.addEventListener('click', () => {
    session.removeItem(SESSION_KEY);
    go('#/login');
  });
}

async function boot() {
  document.documentElement.lang = getLang();
  try {
    const SQL = await window.initSqlJs({ locateFile: (file) => `vendor/${file}` });
    attachClockStorage(local);
    openDatabase(SQL, local);
  } catch (err) {
    console.error(err);
    root.innerHTML = `<p class="notice notice-alert" role="alert">${esc(t('app.loadFailed'))}</p>`;
    return;
  }
  window.addEventListener('hashchange', render);
  render();
}

boot();
