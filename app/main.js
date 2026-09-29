// Bootstrap, header, navigation and hash router. Every route change first lets the System Clock expire
// overdue requests (UC-11) and prepare last month's payroll draft (UC-14, BR-14).
// Iteration 8 (spec §9): shared mode, the default, keeps the data in the shared database (core/shared.js) and uses the
// server's time; the local demonstration mode (?mode=local) keeps them in this browser with the demo clock (v7).
import { openDatabase, resetDatabase } from './core/db.js';
import { attachClockStorage, now, setNow, advance, resetClock } from './core/clock.js';
import { createGateway, restTransport } from './core/shared.js';
import { SUPABASE_URL, SUPABASE_KEY, STORE } from './config.js';
import * as svc from './core/services.js';
import { t, esc, getLang, setLang, errorText, fmtClock, displayName, initial } from './ui/i18n.js';
import { icon, openSheet, closeSheet, toast, button } from './ui/components.js';
import * as login from './ui/login.js';
import * as home from './ui/home.js';
import * as schedule from './ui/schedule.js';
import * as requests from './ui/requests.js';
import * as inbox from './ui/inbox.js';
import * as payroll from './ui/payroll.js';
import * as workers from './ui/workers.js';
import * as me from './ui/me.js';
import * as settings from './ui/settings.js';

const SCREENS = {
  home, schedule, swaps: requests, me, staff: workers, pay: payroll, notifications: inbox, settings,
};
const NAV_ICONS = { home: 'home', schedule: 'calendar', swaps: 'swap', me: 'user', staff: 'users', pay: 'pay' };
const SESSION_KEY = 'shiftswap.user';
const TOUR_KEY = 'shiftswap.tour.v1';
const MODE_KEY = 'shiftswap.mode';

const root = document.getElementById('app');
let pendingToast = null;

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

/** ?mode=local|shared chooses the mode and is remembered in this browser; shared is the default. */
function chooseMode() {
  const asked = new URLSearchParams(location.search).get('mode');
  if (asked === 'local' || asked === 'shared') local.setItem(MODE_KEY, asked);
  if (!SUPABASE_URL || !SUPABASE_KEY) return 'local';
  return local.getItem(MODE_KEY) === 'local' ? 'local' : 'shared';
}

/** The demo store: config.js, or ?store= (used by the tests with a throwaway store). */
function storeSlug() {
  const asked = new URLSearchParams(location.search).get('store');
  return asked && /^[a-z0-9][a-z0-9-]{0,39}$/.test(asked) ? asked : STORE;
}

const shared = chooseMode() === 'shared';
let gateway = null; // shared mode: core/shared.js
let pendingRender = false; // shared mode: another person changed the data; draw again when the user is idle
let edited = false; // the user typed into the current screen

function switchMode(next) {
  local.setItem(MODE_KEY, next);
  session.removeItem(SESSION_KEY);
  const params = new URLSearchParams(location.search);
  params.set('mode', next);
  location.assign(`${location.pathname}?${params}#/login`);
}

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

/** Tour progress kept in this browser (prompt §2.2). */
function tourState() {
  try {
    return JSON.parse(local.getItem(TOUR_KEY)) || {};
  } catch {
    return {};
  }
}

function markTour(step) {
  local.setItem(TOUR_KEY, JSON.stringify({ ...tourState(), [step]: true }));
}

/** System Clock duties before drawing; in shared mode they are paused for a minute after the server refused them. */
function systemDuties() {
  if (shared && !gateway.systemAllowed()) return;
  try {
    if (shared) svc.completeSharedSeed();
    svc.expireOverdue();
    svc.prepareMonthlyPayroll();
  } catch (err) {
    console.error(err);
  }
}

function render() {
  pendingRender = false;
  edited = false;
  closeSheet();
  systemDuties();
  draw();
  // Shared mode: save what the System Clock and the screens changed while drawing (a no-op when nothing changed).
  if (shared) gateway.settle();
}

function draw() {
  document.documentElement.lang = getLang();
  const user = currentUser();
  const { name, args } = parseHash();
  if (!user) {
    if (name !== 'login') history.replaceState(null, '', '#/login');
    renderShell(null, 'login', false);
    login.render(root.querySelector('#view'), { signIn, tour: tourState(), resetDemo, shared, switchMode });
    document.title = `${t('login.title')} · ShiftSwap`;
    flushToast();
    return;
  }
  const allowed = svc.routesFor(user.role);
  const route = allowed.includes(name) ? name : 'home';
  if (route !== name) history.replaceState(null, '', `#/${route}`);
  const flow = route === 'swaps' && args[0] === 'new';
  renderShell(user, route, flow);
  const view = root.querySelector('#view');
  const ctx = {
    user,
    args,
    now: now(),
    go,
    refresh: render,
    toast: (msg, kind) => { pendingToast = { msg, kind }; },
    fail: (err) => {
      if (!err || !err.code) console.error(err);
      toast(errorText(err), 'alert');
    },
    /** Every command goes through run(): shared mode saves its changes in the shared database (await it). */
    run: shared ? (fn) => saving(gateway.command(fn)) : async (fn) => fn(),
    markTour,
  };
  try {
    SCREENS[route].render(view, ctx);
  } catch (err) {
    console.error(err);
    view.insertAdjacentHTML('afterbegin', `<p class="notice notice-alert" role="alert">${esc(errorText(err))}</p>`);
  }
  document.title = `${t(`nav.${route}`)} · ShiftSwap`;
  flushToast();
}

/** Screens call ctx.toast() before ctx.refresh()/go(); the message is shown once the new screen is on. */
function flushToast() {
  if (!pendingToast) return;
  const { msg, kind } = pendingToast;
  pendingToast = null;
  toast(msg, kind);
}

function signIn(id, hash = '#/home') {
  session.setItem(SESSION_KEY, String(id));
  go(hash);
}

function signOut() {
  document.getElementById('toast-root').innerHTML = '';
  session.removeItem(SESSION_KEY);
  go('#/login');
}

async function resetDemo() {
  if (shared) {
    try {
      await saving(gateway.reset());
    } catch (err) {
      toast(errorText(err), 'alert');
      return;
    }
  } else {
    resetDatabase();
    resetClock();
  }
  local.removeItem(TOUR_KEY);
  session.removeItem(SESSION_KEY);
  pendingToast = { msg: t(shared ? 'demo.resetSharedDone' : 'demo.resetDone'), kind: 'ok' };
  go('#/login');
}

/** Shared mode: the screen is busy while a change is being saved. */
async function saving(promise) {
  document.body.classList.add('is-saving');
  root.setAttribute('aria-busy', 'true');
  try {
    return await promise;
  } finally {
    document.body.classList.remove('is-saving');
    root.removeAttribute('aria-busy');
  }
}

/** Shared mode: nothing open, typed or being saved, so the screen can be drawn again with the new data. */
function idle() {
  const active = document.activeElement;
  const typing = active && root.contains(active) && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName);
  return !document.getElementById('sheet-root').childElementCount && !typing && !edited
    && !document.body.classList.contains('in-flow') && !gateway.busy();
}

function requestRender() {
  pendingRender = true;
  setTimeout(renderIfIdle, 0);
}

function renderIfIdle() {
  if (pendingRender && idle()) render();
}

/** Shared mode, every second: draw pending changes, move the server clock in the header and expire requests on time. */
function tick() {
  renderIfIdle();
  const chip = root.querySelector('#open-demo');
  const when = fmtClock(now());
  if (!chip || chip.querySelector('.num').textContent === when) return;
  chip.querySelector('.num').textContent = when;
  chip.setAttribute('aria-label', t('header.serverClock', { when }));
  if (idle() && gateway.systemAllowed() && svc.expireOverdue()) render();
}

function startSharedTimers() {
  const poll = () => { if (!document.hidden) gateway.poll().catch(() => {}); };
  setInterval(poll, 10000);
  setInterval(tick, 1000);
  window.addEventListener('focus', poll);
  document.addEventListener('visibilitychange', poll);
}

function navHtml(user, route) {
  return `<nav class="nav" aria-label="${esc(t('nav.label'))}"><ul>${svc.menuFor(user.role).map((key) => `
    <li><a href="#/${key}" ${key === route ? 'aria-current="page"' : ''}>${icon(NAV_ICONS[key])}<span>${esc(t(`nav.${key}`))}</span></a></li>`).join('')}
  </ul></nav>`;
}

function renderShell(user, route, flow) {
  const wp = svc.getWorkplace();
  const unread = user ? svc.unreadCount(user.id) : 0;
  document.body.classList.toggle('in-flow', flow);
  document.body.classList.toggle('signed-in', !!user);
  root.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#/${user ? 'home' : 'login'}">${esc(displayName(wp.name))}</a>
      <div class="top-actions">
        <button type="button" class="clock-chip" id="open-demo" aria-label="${esc(t(shared ? 'header.serverClock' : 'header.clock', { when: fmtClock(now()) }))}">${icon('clock')}<span class="num">${esc(fmtClock(now()))}</span></button>
        ${user ? `
        <a class="icon-btn bell" href="#/notifications" aria-label="${esc(unread ? t('header.bellCount', { n: unread }) : t('header.bell'))}" ${route === 'notifications' ? 'aria-current="page"' : ''}>${icon('bell')}${unread ? `<span class="badge num" aria-hidden="true">${unread}</span>` : ''}</a>
        <button type="button" class="person-btn" id="switch-person" aria-label="${esc(`${displayName(user.name)}, ${t('header.switch')}`)}">
          <span class="avatar" aria-hidden="true">${esc(initial(user.name))}</span>
          <span class="person-name">${esc(displayName(user.name))}</span>
        </button>` : ''}
        <button type="button" class="icon-btn" id="open-menu" aria-label="${esc(t('header.menu'))}">${icon('more')}</button>
      </div>
    </header>
    <div class="layout ${user && !flow ? 'with-nav' : ''}">
      ${user && !flow ? navHtml(user, route) : ''}
      <main id="main" class="content content-${route}">
        <div id="view" class="view view-${route}"></div>
      </main>
    </div>`;
  bindShell(user);
}

function bindShell(user) {
  root.querySelector('#open-demo').addEventListener('click', openDemoTools);
  root.querySelector('#open-menu').addEventListener('click', () => openMenu(user));
  const sw = root.querySelector('#switch-person');
  if (sw) sw.addEventListener('click', signOut);
}

/** Demo tools, shared mode: the server time (read-only), the reset for everyone and the switch to local mode. */
function openSharedTools() {
  openSheet({
    title: t('demo.title'),
    variant: 'popover',
    body: `
      <p class="muted">${esc(t('demo.sharedIntro'))}</p>
      <p class="server-time"><span class="field-label">${esc(t('demo.serverTime'))}</span> <strong class="num">${esc(fmtClock(now()))}</strong></p>
      <div class="divider"></div>
      <div id="reset-area">${button({ label: t('demo.resetShared'), kind: 'text', id: 'reset-ask', iconName: 'alert' })}</div>
      ${button({ label: t('demo.toLocal'), kind: 'text', id: 'mode-switch', iconName: 'swap' })}`,
    onMount: (panel, close) => {
      panel.querySelector('#mode-switch').addEventListener('click', () => switchMode('local'));
      panel.querySelector('#reset-ask').addEventListener('click', () => {
        const area = panel.querySelector('#reset-area');
        area.innerHTML = `<div class="confirm-box" role="alert">
          <p>${esc(t('demo.resetSharedConfirm'))}</p>
          <div class="row-2">${button({ label: t('common.cancel'), id: 'reset-no' })}${button({ label: t('demo.resetYes'), kind: 'danger', id: 'reset-yes' })}</div>
        </div>`;
        area.querySelector('#reset-no').addEventListener('click', () => { close(); openDemoTools(); });
        area.querySelector('#reset-yes').addEventListener('click', () => { close(); resetDemo(); });
        area.querySelector('#reset-yes').focus();
      });
    },
  });
}

/** Demo tools: the demo clock and the data reset (prompt §2.1); in shared mode openSharedTools. */
function openDemoTools() {
  if (shared) {
    openSharedTools();
    return;
  }
  openSheet({
    title: t('demo.title'),
    variant: 'popover',
    body: `
      <p class="muted">${esc(t('demo.intro'))}</p>
      <form class="form" id="clock-form">
        <label class="field"><span class="field-label">${esc(t('demo.now'))}</span>
          <input id="clock-input" type="datetime-local" class="num" value="${esc(now())}" step="60" required></label>
        ${button({ label: t('demo.apply'), kind: 'primary', block: true, id: 'clock-apply' })}
        <div class="row-2">
          ${button({ label: t('demo.plusHour'), attrs: 'data-advance="60"' })}
          ${button({ label: t('demo.plusDay'), attrs: 'data-advance="1440"' })}
        </div>
      </form>
      <div class="divider"></div>
      <div id="reset-area">${button({ label: t('demo.reset'), kind: 'text', id: 'reset-ask', iconName: 'alert' })}</div>
      ${SUPABASE_URL ? button({ label: t('demo.toShared'), kind: 'text', id: 'mode-switch', iconName: 'swap' }) : ''}`,
    onMount: (panel, close) => {
      const input = panel.querySelector('#clock-input');
      const modeSwitch = panel.querySelector('#mode-switch');
      if (modeSwitch) modeSwitch.addEventListener('click', () => switchMode('shared'));
      panel.querySelector('#clock-apply').addEventListener('click', () => {
        const value = input.value.slice(0, 16);
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
          toast(t('err.CLOCK_INVALID'), 'alert');
          return;
        }
        setNow(value);
        pendingToast = { msg: t('demo.clockSet', { when: fmtClock(value) }), kind: 'ok' };
        close();
        render();
      });
      panel.querySelectorAll('[data-advance]').forEach((b) => b.addEventListener('click', () => {
        advance(Number(b.dataset.advance));
        pendingToast = { msg: t('demo.clockSet', { when: fmtClock(now()) }), kind: 'ok' };
        close();
        render();
      }));
      panel.querySelector('#reset-ask').addEventListener('click', () => {
        const area = panel.querySelector('#reset-area');
        area.innerHTML = `<div class="confirm-box" role="alert">
          <p>${esc(t('demo.resetConfirm'))}</p>
          <div class="row-2">${button({ label: t('common.cancel'), id: 'reset-no' })}${button({ label: t('demo.resetYes'), kind: 'danger', id: 'reset-yes' })}</div>
        </div>`;
        area.querySelector('#reset-no').addEventListener('click', () => { close(); openDemoTools(); });
        area.querySelector('#reset-yes').addEventListener('click', () => { close(); resetDemo(); });
        area.querySelector('#reset-yes').focus();
      });
    },
  });
}

/** Header menu: settings (owner), language, switch person, sign out. */
function openMenu(user) {
  const items = [];
  if (user && user.role === 'OWNER') items.push(`<a class="menu-item" href="#/settings">${icon('settings')}<span>${esc(t('nav.settings'))}</span></a>`);
  items.push(`<button type="button" class="menu-item" id="menu-lang">${icon('globe')}<span>${esc(t('header.language'))}</span></button>`);
  if (user) {
    items.push(`<button type="button" class="menu-item" id="menu-switch">${icon('users')}<span>${esc(t('header.switch'))}</span></button>`);
    items.push(`<button type="button" class="menu-item" id="menu-out">${icon('logout')}<span>${esc(t('header.signOut'))}</span></button>`);
  }
  openSheet({
    title: t('header.menu'),
    variant: 'popover',
    body: `<div class="menu-list">${items.join('')}</div>`,
    onMount: (panel, close) => {
      panel.querySelector('#menu-lang').addEventListener('click', () => {
        setLang(getLang() === 'ko' ? 'en' : 'ko');
        close();
        render();
      });
      const settingsLink = panel.querySelector('a[href="#/settings"]');
      if (settingsLink) settingsLink.addEventListener('click', close);
      const sw = panel.querySelector('#menu-switch');
      if (sw) sw.addEventListener('click', () => { close(); signOut(); });
      const out = panel.querySelector('#menu-out');
      if (out) out.addEventListener('click', () => { close(); signOut(); });
    },
  });
}

async function boot() {
  document.documentElement.lang = getLang();
  document.body.classList.toggle('mode-shared', shared);
  let SQL;
  try {
    SQL = await window.initSqlJs({ locateFile: (file) => `vendor/${file}` });
    if (!shared) {
      attachClockStorage(local);
      openDatabase(SQL, local);
    }
  } catch (err) {
    console.error(err);
    root.innerHTML = `<p class="notice notice-alert" role="alert">${esc(t('app.loadFailed'))}</p>`;
    return;
  }
  if (shared) {
    gateway = createGateway({ SQL, transport: restTransport({ url: SUPABASE_URL, key: SUPABASE_KEY }), store: storeSlug(), onReload: requestRender });
    try {
      await gateway.load();
    } catch (err) {
      console.error(err);
      root.innerHTML = `<div class="shared-failed">
        <p class="notice notice-alert" role="alert">${esc(t('app.sharedFailed'))}</p>
        ${button({ label: t('app.openLocal'), kind: 'primary', block: true, href: '?mode=local#/login' })}</div>`;
      return;
    }
    startSharedTimers();
    root.addEventListener('input', (e) => { if (e.target.closest('#view')) edited = true; });
  }
  window.addEventListener('hashchange', render);
  render();
}

boot();
