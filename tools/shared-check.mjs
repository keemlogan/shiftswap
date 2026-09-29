// Headless browser check of the shared mode (spec §9, NFR-04, NFR-14, TC-16x): two browsers on a throwaway store
// 'e2e-<time>' that the script creates and deletes with the owner connection of the kit (SHIFTSWAP_RUN, default
// ~/work/shiftswap-kit/run.mjs); the demo store 'dalbit' is not touched.
//   node tools/shared-check.mjs
// 1. The sign-in screen says that the demo is shared; the header clock is the server time and cannot be set.
// 2. Minho and Doyun tap 수락하기 at the same moment in two browsers: exactly one wins, the other gets the normal
//    business message (먼저 수락했어요), and the server holds one ACCEPTED request.
// 3. The owner approves in the first browser; the second browser shows the new state after polling (≤ 15 s).
// 4. The reset for everyone brings the open request back.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { serve, chrome, app, sleep } from './lib.mjs';

const env = Object.fromEntries(readFileSync(`${homedir()}/.config/shiftswap/supabase.env`, 'utf8').trim().split('\n')
  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const RUN = process.env.SHIFTSWAP_RUN || `${homedir()}/work/shiftswap-kit/run.mjs`;
const sql = (q) => execFileSync('node', [RUN, '-c', q], { encoding: 'utf8' });
const STORE = `e2e-${Date.now().toString(36)}`;
const H = { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' };
const snapshot = async () => (await (await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/app_snapshot`, {
  method: 'POST', headers: H, body: JSON.stringify({ p_store: STORE }) })).json());

let failures = 0;
function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${!ok && detail ? `\n     ${detail}` : ''}`);
  if (!ok) failures++;
}

sql(`insert into public.app_store (slug) values ('${STORE}'); select public.app_reset_store(id) from public.app_store where slug = '${STORE}'`);
const server = await serve();
const pages = [await chrome(), await chrome()];
const [a, b] = pages.map((p) => app(p, server.url, { mode: 'shared', store: STORE }));
const toast = (x) => x.evaluate(`document.getElementById('toast-root').innerText`);
/** The first non-empty toast within the timeout (toasts disappear after a few seconds). */
async function nextToast(x, timeout = 10000) {
  for (const until = Date.now() + timeout; Date.now() < until; await sleep(150)) {
    const text = await toast(x);
    if (text.trim()) return text;
  }
  return '';
}
try {
  await a.viewport(1280, 900);
  await b.viewport(390, 844);
  await a.fresh('ko');
  await b.fresh('ko');
  const signin = await a.text();
  check(signin.includes('공유 데모') && signin.includes('로컬 데모 모드로 바꾸기') && signin.includes('3분 체험'),
    'SC-1 the sign-in screen says the demo is shared and offers the local mode', signin.slice(0, 300));

  await a.click('#open-demo');
  const tools = await a.text('#sheet-root');
  const clock = await a.evaluate(`document.querySelector('.server-time .num').innerText`);
  const kstNow = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  const [d1, d2] = [clock, kstNow].map((x) => Date.parse(`${x.replace(/[^\d:\- ]/g, '').trim().replace(' ', 'T')}Z`));
  check(tools.includes('서버 시각') && !(await a.evaluate('!!document.querySelector("#clock-input")'))
    && (Number.isNaN(d1) || Math.abs(d1 - d2) <= 120e3),
    'SC-1 demo tools show the server time without the clock controls', `${clock} vs ${kstNow}`);
  await a.evaluate(`document.querySelector('#sheet-root .sheet-close, #sheet-root [data-close]')?.click()`);
  await sleep(300);

  // ---- First acceptance across two browsers (BR-02, NFR-04) ----
  await a.signIn(3, '#/home');
  await b.signIn(5, '#/home');
  const both = await Promise.all([a, b].map((x) => x.evaluate('!!document.querySelector("[data-accept]")')));
  check(both.every(Boolean), 'SC-2 Minho and Doyun both see the open request with 수락하기');
  await Promise.all([a, b].map((x) => x.evaluate(`document.getElementById('toast-root').innerHTML = ''; document.querySelector('[data-accept]').click()`)));
  const [ta, tb] = await Promise.all([nextToast(a), nextToast(b)]);
  const won = [ta, tb].filter((x) => x.includes('근무를 맡았어요')).length;
  const lost = [ta, tb].filter((x) => x.includes('먼저 수락했어요')).length;
  check(won === 1 && lost === 1, 'SC-2 simultaneous 수락하기: one wins, the other is told who was faster', `A: ${ta} | B: ${tb}`);
  let s = await snapshot();
  const req = s.tables.SubRequest[0];
  check(req.status === 'ACCEPTED' && s.tables.SubRequestTarget.filter((x) => x.response === 'ACCEPTED').length === 1,
    'SC-2 the server holds one ACCEPTED request with one accepting target', JSON.stringify(req));

  // ---- The owner approves; the other browser follows through polling ----
  await a.signIn(1, '#/home');
  const warnOrCard = await a.text();
  check(warnOrCard.includes('승인하기'), "SC-3 the owner's Home shows the decision card", warnOrCard.slice(0, 300));
  await a.evaluate(`document.getElementById('toast-root').innerHTML = ''`);
  await a.click('[data-approve]');
  const approved = await nextToast(a);
  check(approved.includes('승인했어요'), 'SC-3 승인하기 is saved in the shared database', approved);
  s = await snapshot();
  check(s.tables.SubRequest[0].status === 'APPROVED', 'SC-3 the server holds the APPROVED request', s.tables.SubRequest[0].status);
  await b.evaluate(`document.activeElement && document.activeElement.blur()`);
  let seen = false;
  for (let i = 0; i < 20 && !seen; i++) {
    await sleep(1000);
    seen = await b.evaluate(`!document.querySelector('[data-accept]')`);
  }
  const bRev = await b.evaluate(`document.body.dataset.rev || ''`);
  check(seen, 'SC-3 the second browser shows the new state within 20 s (polling)', bRev);

  // ---- Reset for everyone ----
  await a.click('#open-demo');
  await a.click('#reset-ask');
  await a.evaluate(`document.getElementById('toast-root').innerHTML = ''`);
  await a.click('#reset-yes');
  const resetToast = await nextToast(a);
  s = await snapshot();
  check(s.tables.SubRequest.length === 1 && s.tables.SubRequest[0].status === 'REQUESTED' && resetToast.includes('처음 상태'),
    'SC-4 the reset for everyone brings the open request back', `${s.tables.SubRequest.map((x) => x.status)} ${resetToast}`);
  const problems = pages.flatMap((p) => p.problems).filter((p) => !/40[0-9]|Failed to load resource/.test(p));
  check(problems.length === 0, 'SC-5 no console errors in either browser', problems.join(' | '));
} catch (err) {
  check(false, 'shared check crashed', err.stack);
} finally {
  pages.forEach((p) => p.close());
  server.close();
  sql(`select set_config('app.seeding', 'on', true); delete from public.app_store where slug = '${STORE}'`);
  const left = JSON.parse(sql(`select count(*)::int as n from public.app_store where slug like 'e2e-%'`))[0].n;
  check(left === 0, 'throwaway store deleted', String(left));
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall shared-mode checks passed');
process.exit(failures ? 1 : 0);
