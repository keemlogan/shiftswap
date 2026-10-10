// Screenshots of the iteration-9 system for the interim report (docs/img/interim-v2/), against the deployed database.
//   (cd web && npm run build) && node tools/screens-system.mjs
// Each scene starts from reset_demo_data (demo clock 2026-09-28 09:00) and sets up its state with the database
// functions over REST, as the scenarios of spec §10 do; the screen is then opened as the account named and captured
// at 2× scale. The database is reset again at the end. English screens, plus two in Korean.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve, chrome, sleep, ROOT } from './lib.mjs';

const CONFIG = readFileSync(join(ROOT, 'web', 'src', 'config.ts'), 'utf8');
const SUPABASE_URL = /SUPABASE_URL = '([^']+)'/.exec(CONFIG)[1];
const SUPABASE_KEY = /SUPABASE_KEY = '([^']+)'/.exec(CONFIG)[1];
const OUT = join(ROOT, 'docs', 'img', 'interim-v2');
const ACCOUNTS = {
  1: { id: 1, role: 'OWNER', name: 'Park Jiyoung' }, 2: { id: 2, role: 'WORKER', name: 'Lee Seoyeon' },
  3: { id: 3, role: 'WORKER', name: 'Choi Minho' }, 4: { id: 4, role: 'WORKER', name: 'Jung Hana' },
  5: { id: 5, role: 'WORKER', name: 'Kang Doyun' },
};

async function rest(name, args = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const reset = () => rest('reset_demo_data');
const shiftOf = async (worker, date) => (await rest('week_board', { p_week_start: '2026-09-28' })).shifts
  .find((s) => s.worker_id === worker && s.work_date === date).id;

const server = await serve();
const base = server.url.replace(/\/app\/$/, '/system/');
const page = await chrome({ port: 9660 });
const { send, evaluate } = page;
let loads = 0;

async function waitFor(expr, what = expr, timeout = 25000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await evaluate(`(() => { try { return !!(${expr}); } catch { return false; } })()`).catch(() => false)) return;
    await sleep(120);
  }
  throw new Error(`timeout waiting for ${what}`);
}
async function viewport(width, height, scale = 2) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: width < 900 });
}
/** Open `hash` as account `user` in language `lang`, with an optional request-flow draft, and wait for the screen. */
async function open(hash, screen, { user = null, lang = 'en', flow = null } = {}) {
  const href = await evaluate('location.href').catch(() => '');
  if (!href.startsWith(base)) {
    await send('Page.navigate', { url: `${base}#/login` });
    await waitFor(`document.readyState === 'complete'`);
  }
  await evaluate(`(() => { localStorage.setItem('shiftswap9.lang', '${lang}');
    ${user ? `sessionStorage.setItem('shiftswap9.user', ${JSON.stringify(JSON.stringify(ACCOUNTS[user]))});` : "sessionStorage.removeItem('shiftswap9.user');"}
    ${flow ? `sessionStorage.setItem('shiftswap9.flow', ${JSON.stringify(JSON.stringify(flow))});` : "sessionStorage.removeItem('shiftswap9.flow');"}
    return true; })()`);
  loads += 1;
  await send('Page.navigate', { url: `${base}?shot=${loads}${hash}` });
  await sleep(300);
  await waitFor(`document.querySelector('[data-screen="${screen}"][data-loaded="true"]') && document.body.getAttribute('aria-busy') !== 'true'`, screen);
  await sleep(400);
}
/** Capture the whole page (the viewport grows to the page height, up to maxHeight CSS px). */
async function shot(file, width, { maxHeight = 2200 } = {}) {
  await evaluate(`(() => { const t = document.getElementById('toast-root'); if (t) t.innerHTML = ''; return true; })()`);
  await viewport(width, 900);
  await sleep(300);
  const full = await evaluate('Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))');
  const height = Math.min(full, maxHeight);
  await viewport(width, height);
  await sleep(450);
  const res = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } });
  writeFileSync(join(OUT, file), Buffer.from(res.result.data, 'base64'));
  console.log(`${file} ${width}x${height} (2x)`);
}
async function click(selector) {
  const ok = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
  if (!ok) throw new Error(`missing ${selector}`);
  await sleep(400);
}

mkdirSync(OUT, { recursive: true });
try {
  // Seed state (S1): sign-in, Seoyeon's request, Minho's Home with the request card, the request flow, Me, Staff, Settings.
  await reset();
  await open('#/login', 'signin');
  await shot('ui2-01-signin.png', 1280);
  await open('#/home', 'home', { user: 3 });
  await shot('ui2-02-worker-home.png', 390);
  const minhoSat = (await rest('requestable_shifts', { p_worker_id: 3 })).find((s) => s.work_date === '2026-10-03').id;
  await open('#/swaps/new/3', 'flow-3', { user: 3, flow: { shiftId: minhoSat, reasonKey: 'Exam' } });
  await shot('ui2-03-request-step3.png', 390);
  await open('#/me', 'me', { user: 2 });
  await shot('ui2-04-me.png', 390);
  await open('#/staff/3', 'staff-detail', { user: 1 });
  await shot('ui2-05-staff-detail.png', 1280);
  await open('#/settings', 'settings', { user: 1 });
  await shot('ui2-06-settings.png', 1280);

  // S2/S3: Minho accepted; Seoyeon's tracker; the owner's decision card with the cost of the swap (EN and KO phone).
  await rest('accept_sub_request', { p_request_id: 1, p_worker_id: 3 });
  await open('#/swaps', 'swaps', { user: 2 });
  await shot('ui2-07-swaps-accepted.png', 390);
  await open('#/home', 'home', { user: 1 });
  await shot('ui2-08-owner-decision.png', 1280);
  await open('#/home', 'home', { user: 1, lang: 'ko' });
  await shot('ui2-09-owner-decision-ko.png', 390);

  // S3 approved + S9: the week board with the handover and an overnight shift for Doyun on Friday 22:00–02:00.
  await rest('decide_sub_request', { p_request_id: 1, p_decision: 'APPROVE' });
  await rest('add_shift', { p_work_date: '2026-10-02', p_start: '22:00', p_end: '02:00', p_worker_id: 5 });
  await open('#/schedule/2026-09-28', 'schedule', { user: 1 });
  await shot('ui2-10-schedule-owner.png', 1280);

  // S8: five regular employees, Minho's extra Friday shift, Minho accepts: warning and premium in the decision card.
  await reset();
  const settings = await rest('get_settings');
  await rest('update_settings', { p_name: settings.workplace.name, p_regular_employees: 5, p_policy: 'EXCUSED', p_minimum_wages: null });
  await rest('add_shift', { p_work_date: '2026-10-02', p_start: '10:00', p_end: '18:00', p_worker_id: 3 });
  await rest('accept_sub_request', { p_request_id: 1, p_worker_id: 3 });
  await open('#/home', 'home', { user: 1 });
  await shot('ui2-11-owner-overtime.png', 1280);

  // S11: at 2026-09-29 23:30 the owner opens Minho's Tuesday shift (no attendance) and marks it absent.
  await reset();
  await rest('set_demo_clock', { p_at: '2026-09-29T23:30:00' });
  const tue = await shiftOf(3, '2026-09-29');
  await open('#/schedule/2026-09-28', 'schedule', { user: 1 });
  await click(`.shift[data-worker="3"][data-date="2026-09-29"]`);
  await waitFor(`document.querySelector('#act-absent')`, 'Mark absent');
  await sleep(400);
  await shot('ui2-12-mark-absent.png', 1280);
  await rest('mark_absent', { p_shift_id: tue });
  await open('#/pay/week/2026-09-28', 'pay-week', { user: 1 });
  await shot('ui2-13-pay-week.png', 1280);

  // S10/S6: at 2026-10-01 09:00 the September draft is prepared; the owner's Home notice and the monthly payroll.
  await reset();
  await rest('set_demo_clock', { p_at: '2026-10-01T09:00:00' });
  await rest('run_system_clock');
  await open('#/pay/month/2026-09', 'pay-month', { user: 1 });
  await shot('ui2-14-pay-month.png', 1280);
} finally {
  await reset().catch((err) => console.error('final reset failed', err.message));
  page.close();
  server.close();
}
console.log('problems:', page.problems.length ? page.problems.slice(0, 8) : 'none');
