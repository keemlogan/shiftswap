// Headless check of the iteration-9 system (web/ built into system/) against the deployed database (spec §11):
//   (cd web && npm run build) && node tools/check-system.mjs
// It serves the repository root, opens <server>/system/ in headless Chrome and
//   1. resets the demo data (reset_demo_data over REST with the publishable key of web/src/config.ts),
//   2. walks through the scenarios S1–S11 of spec §10 and a week without a day worked (BR-06 c) in the UI and checks
//      the numbers on the screens,
//   3. audits every page at 1280 and 360 px in Korean and English (NFR-02, NFR-13): exactly one filled primary button,
//      every disabled button with a visible reason, touch targets of at least 44 × 44 px, no horizontal scroll,
//   4. checks that no console error or exception occurred, and
//   5. resets the demo data again, so the shared database is left in its starting state.
// Expected refusals (ALREADY_TAKEN in S2, OVERLAP in S9) are HTTP 400 answers of PostgREST, which Chrome logs as
// "Failed to load resource"; only those entries, for exactly the function that is expected to refuse, are discounted.
// Prints PASS/FAIL lines and exits non-zero on any failure.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve, chrome, sleep, ROOT } from './lib.mjs';

const CONFIG = readFileSync(join(ROOT, 'web', 'src', 'config.ts'), 'utf8');
const SUPABASE_URL = /SUPABASE_URL = '([^']+)'/.exec(CONFIG)[1];
const SUPABASE_KEY = /SUPABASE_KEY = '([^']+)'/.exec(CONFIG)[1];

const ACCOUNTS = {
  1: { id: 1, role: 'OWNER', name: 'Park Jiyoung' },
  2: { id: 2, role: 'WORKER', name: 'Lee Seoyeon' },
  3: { id: 3, role: 'WORKER', name: 'Choi Minho' },
  4: { id: 4, role: 'WORKER', name: 'Jung Hana' },
  5: { id: 5, role: 'WORKER', name: 'Kang Doyun' },
};

let failures = 0;
let passes = 0;
function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${!ok && detail ? `\n     ${String(detail).replace(/\s+/g, ' ').slice(0, 1200)}` : ''}`);
  if (ok) passes += 1;
  else failures += 1;
  return ok;
}

/** One database function over REST, as the app's anonymous role. */
async function rest(name, args = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const err = new Error(`${name}: HTTP ${res.status} ${text}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}
const reset = () => rest('reset_demo_data');

const AUDIT = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[inert]'); };
  const primaries = [...document.querySelectorAll('.btn-primary')].filter(visible).map((b) => b.innerText.trim());
  const disabled = [...document.querySelectorAll('button[disabled], [aria-disabled="true"]')].filter(visible).map((b) => {
    const id = b.getAttribute('aria-describedby');
    const reason = id && document.getElementById(id);
    return { label: b.innerText.trim(), reason: reason && visible(reason) ? reason.innerText.trim() : '' };
  });
  const small = [...document.querySelectorAll('button, a[href], input, select, textarea, summary, [role="tab"], label.chip-option')]
    .filter(visible).filter((el) => {
      // A radio or checkbox inside a label is hit through the whole label, which is what counts.
      if (el.matches('input[type="radio"], input[type="checkbox"]') && el.closest('label')) return false;
      if (el.matches('.chip-option input')) return false;
      const r = el.getBoundingClientRect();
      return r.width < 43.5 || r.height < 43.5;
    }).map((el) => (el.innerText || el.getAttribute('aria-label') || el.name || el.tagName).trim().slice(0, 40)
      + ' ' + Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height));
  const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  return { primaries, disabled, small, overflow };
})()`;

/** Page helpers on top of tools/lib.mjs chrome(): load, wait, click, fill, act (click + wait for the result toast). */
function makeUi(page, base) {
  const { send, evaluate } = page;
  let loads = 0;
  const ui = {
    page,
    evaluate,
    async viewport(width) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 900 });
    },
    async waitFor(expr, what = expr, timeout = 25000) {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        const ok = await evaluate(`(() => { try { return !!(${expr}); } catch { return false; } })()`).catch(() => false);
        if (ok) return true;
        await sleep(120);
      }
      throw new Error(`timeout waiting for ${String(what).slice(0, 200)}`);
    },
    idle: () => ui.waitFor(`document.readyState === 'complete' && document.body.getAttribute('aria-busy') !== 'true'`, 'idle'),
    /** Wait until a screen has drawn its data and no database call is in flight. */
    async screen(name) {
      await ui.waitFor(`document.querySelector('[data-screen="${name}"][data-loaded="true"]') && document.body.getAttribute('aria-busy') !== 'true'`, `screen ${name}`);
      await sleep(200);
      await ui.idle();
    },
    /** A full page load of `hash` with the language, the signed-in account and the request-flow draft set. */
    async load(hash, { lang, user, flow } = {}) {
      const href = await evaluate('location.href').catch(() => '');
      if (!href.startsWith(base)) {
        await send('Page.navigate', { url: `${base}#/login` });
        await ui.waitFor(`document.readyState === 'complete'`, 'first load');
      }
      const user$ = user === undefined ? '' : user === null ? "sessionStorage.removeItem('shiftswap9.user');"
        : `sessionStorage.setItem('shiftswap9.user', ${JSON.stringify(JSON.stringify(ACCOUNTS[user]))});`;
      const flow$ = flow === undefined ? '' : flow === null ? "sessionStorage.removeItem('shiftswap9.flow');"
        : `sessionStorage.setItem('shiftswap9.flow', ${JSON.stringify(JSON.stringify(flow))});`;
      await evaluate(`(() => { ${lang ? `localStorage.setItem('shiftswap9.lang', '${lang}');` : ''} ${user$} ${flow$} return true; })()`);
      loads += 1;
      await send('Page.navigate', { url: `${base}?load=${loads}${hash}` });
      await sleep(300);
      await ui.waitFor(`document.readyState === 'complete' && document.getElementById('root').childElementCount > 0`, 'app start');
    },
    /** Sign in as an account (session storage) and open a screen. */
    async as(id, hash, screen, lang) {
      await ui.load(hash, { user: id, lang });
      await ui.screen(screen);
    },
    async go(hash, screen) {
      await evaluate(`location.hash = ${JSON.stringify(hash)}`);
      await sleep(200);
      if (screen) await ui.screen(screen);
    },
    async click(selector) {
      const ok = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false;
        el.scrollIntoView({ block: 'center' }); el.click(); return true; })()`);
      if (!ok) throw new Error(`missing ${selector}`);
      await sleep(150);
    },
    /** Set an input or select the way a person does, so React sees the change. */
    async fill(selector, value) {
      const ok = await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(String(value))});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true; })()`);
      if (!ok) throw new Error(`missing ${selector}`);
      await sleep(100);
    },
    text: (selector = '#main') => evaluate(`(document.querySelector(${JSON.stringify(selector)}) || { innerText: '' }).innerText`),
    exists: (selector) => evaluate(`!!document.querySelector(${JSON.stringify(selector)})`),
    toastId: () => evaluate(`document.querySelector('#toast-root .toast')?.dataset.toastId || ''`),
    toast: () => evaluate(`document.querySelector('#toast-root .toast')?.innerText.trim() || ''`),
    /** Click an action and wait for its result toast and the reload of the screen; returns the toast text. */
    async act(selector) {
      const before = await ui.toastId();
      await ui.click(selector);
      await ui.waitFor(`(document.querySelector('#toast-root .toast')?.dataset.toastId || '') !== ${JSON.stringify(before)}`, `result of ${selector}`);
      await sleep(150);
      await ui.idle();
      await sleep(150);
      return ui.toast();
    },
    audit: () => evaluate(AUDIT),
  };
  return ui;
}

/** Run `action`, which is expected to be refused by database function `fn`; its HTTP 400 log entries are discounted. */
async function expectRefusal(ui, fn, action) {
  const before = ui.page.problems.length;
  const result = await action();
  await sleep(500);
  const added = ui.page.problems.splice(before);
  const expected = added.filter((p) => p.includes('status of 400') && p.includes(`/rest/v1/rpc/${fn}`));
  ui.page.problems.push(...added.filter((p) => !expected.includes(p)));
  return { result, refusals: expected.length };
}

const server = await serve();
const base = server.url.replace(/\/app\/$/, '/system/');
const pageA = await chrome({ port: 9620 });
const pageB = await chrome({ port: 9640 });
const a = makeUi(pageA, base);
const b = makeUi(pageB, base);

async function scenario(name, fn) {
  try {
    await fn();
  } catch (err) {
    check(false, `${name} ran to the end`, err.stack || err.message);
  }
}

/** The owner moves the demo clock in Settings → Demo tools (set_demo_clock); the reload runs the System Clock. */
async function setClock(ui, at, lang = 'ko') {
  await ui.as(1, '#/settings', 'settings', lang);
  await ui.fill('input[name="demoClock"]', at);
  return ui.act('#clock-apply');
}

/** A worker sends a request in the three-step flow for the shift on `date`; returns the result screen's text. */
async function requestFlow(ui, worker, date, reason) {
  await ui.as(worker, '#/swaps', 'swaps');
  await ui.click('#find-cover');
  await ui.screen('flow-1');
  const shiftId = await ui.evaluate(`[...document.querySelectorAll('[data-option-shift]')].find((x) => x.innerText.includes(${JSON.stringify(date)}))?.dataset.optionShift || null`);
  if (!shiftId) throw new Error(`no requestable shift on ${date}`);
  await ui.click(`[data-option-shift="${shiftId}"] input`);
  await ui.click('#flow-next');
  await ui.screen('flow-2');
  if (reason) await ui.click(`[data-reason="${reason}"] input`);
  await ui.click('#flow-next');
  await ui.screen('flow-3');
  const step3 = await ui.text();
  const deadline = await ui.evaluate(`document.querySelector('input[name="deadline"]').value`);
  const toast = await ui.act('#flow-send');
  await ui.screen('flow-done');
  return { step3, deadline, toast, done: await ui.text() };
}

try {
  // Every error code of spec §9.2 has a Korean and an English sentence (the server hint is only the fallback).
  const spec = readFileSync(join(ROOT, 'spec', 'spec.md'), 'utf8');
  const codes = /Codes: ([A-Z_, ()a-z]+?)\. A reason/.exec(spec)[1].replace(/\([^)]*\)/g, '').match(/\b[A-Z][A-Z_]{3,}\b/g);
  const i18nSource = readFileSync(join(ROOT, 'web', 'src', 'i18n.ts'), 'utf8');
  const missing = codes.filter((c) => (i18nSource.match(new RegExp(`'err\\.${c}':`, 'g')) || []).length !== 2);
  check(codes.length >= 30 && missing.length === 0, `i18n: a Korean and an English message for each of the ${codes.length} error codes of spec §9.2`, missing.join(', '));

  await a.viewport(1280);
  await b.viewport(1280);
  await reset();
  check(true, 'reset_demo_data before the walkthrough');

  // ---- S1: Seoyeon's request (seed): three candidates, three REQUEST_RECEIVED notifications ----------------------
  await scenario('S1', async () => {
    await a.load('#/login', { lang: 'ko', user: null, flow: null });
    await a.evaluate(`localStorage.removeItem('shiftswap9.tour'); true`);
    await a.load('#/login');
    await a.screen('signin');
    const signin = await a.text();
    check(['박지영', '이서연', '최민호', '정하나', '강도윤'].every((n) => signin.includes(n)) && signin.includes('3분 체험')
      && signin.includes('모든 데이터는 가상의 데모 데이터예요. 이 앱을 여는 누구나 같은 데이터를 보고 바꿀 수 있어요.')
      && signin.includes('주 16시간'),
    'Sign-in: shared fictional-data notice, three-step tour, all five accounts with role and weekly hours', signin);
    await a.click('[data-step="0"]');
    await a.screen('swaps');
    const swaps = await a.text();
    const answers = await a.evaluate(`[...document.querySelectorAll('[data-my-request="1"] .answer')].map((x) => x.innerText)`);
    check(await a.exists('[data-my-request="1"][data-status="REQUESTED"] .step.current') && swaps.includes('9월 30일(수) 18:00–23:00')
      && JSON.stringify(answers) === JSON.stringify(['최민호님 대기 중', '정하나님 대기 중', '강도윤님 대기 중']),
    "S1 tour step 1 signs in as Seoyeon: Swaps shows her request with the tracker and three candidates", `${JSON.stringify(answers)} ${swaps.slice(0, 300)}`);
    const received = await Promise.all([3, 4, 5].map((id) => rest('notifications', { p_worker_id: id })));
    check(received.every((n) => n.items.filter((x) => x.kind === 'REQUEST_RECEIVED').length === 1),
      'S1 Minho, Hana and Doyun each have one REQUEST_RECEIVED notification', JSON.stringify(received.map((n) => n.items.map((x) => x.kind))));
  });

  // ---- S2: Minho accepts first (one tap from Home); Doyun's later acceptance is refused --------------------------
  await scenario('S2', async () => {
    await b.as(5, '#/home', 'home', 'en');
    check(await b.exists('[data-accept="1"]'), "S2 Doyun's Home (English) offers Accept on Seoyeon's request");
    await a.go('#/login', 'signin');
    await a.click('[data-step="1"]');
    await a.screen('home');
    const home = await a.text();
    const badge = await a.evaluate(`document.querySelector('.bell .badge')?.innerText || ''`);
    check(home.includes('이서연님이 대타를 구해요') && home.includes('수락하면 이번 주 16시간 → 21시간') && home.includes('주휴수당 그대로 (33,024원)')
      && home.includes('내일 21:00까지 답해 주세요') && badge === '1',
    "S2 tour step 2: Minho's Home card shows the effect 16시간 → 21시간, holiday allowance 33,024원, the deadline; bell 1", `${badge} ${home.slice(0, 500)}`);
    await a.go('#/notifications', 'notifications');
    check((await a.text()).includes('이서연님이 9월 30일(수) 18:00–23:00 근무 대타를 구해요. 내일 21:00까지 답해 주세요.'),
      "S1 Minho's inbox shows the REQUEST_RECEIVED sentence");
    await a.click('.notif .btn');
    await a.screen('home');
    const toast = await a.act('[data-accept="1"]');
    check(toast.includes('수요일 근무를 맡았어요. 사장님 승인을 기다려요.') && !(await a.exists('[data-accept="1"]')),
      'S2 Minho accepts from the inbox in two clicks (Open → Accept, NFR-01) and sees the result', toast);
    const refused = await expectRefusal(b, 'accept_sub_request', () => b.act('[data-accept="1"]'));
    const bHome = await b.text();
    check(refused.result.includes('Choi Minho accepted first') && refused.refusals === 1 && bHome.includes('Choi Minho accepted first'),
      "S2 Doyun's later Accept is refused: \"Choi Minho accepted first\" (ALREADY_TAKEN) and his Home shows the taken card",
      `${refused.result} | refusals ${refused.refusals} | ${bHome.slice(0, 300)}`);
    let restError = null;
    try { await rest('accept_sub_request', { p_request_id: 1, p_worker_id: 5 }); } catch (err) { restError = err.body; }
    check(restError && restError.message === 'ALREADY_TAKEN' && restError.hint === 'Choi Minho accepted first.',
      'S2 accept_sub_request for Doyun answers ALREADY_TAKEN with the hint "Choi Minho accepted first."', JSON.stringify(restError));
  });

  // ---- S3: the owner's preview and approval ---------------------------------------------------------------------
  await scenario('S3', async () => {
    await a.go('#/login', 'signin');
    await a.click('[data-step="2"]');
    await a.screen('home');
    const home = await a.text();
    const card = await a.text('[data-decision="1"]');
    const seoyeon = await a.text('[data-decision="1"] [data-person="2"]');
    const minho = await a.text('[data-decision="1"] [data-person="3"]');
    check(home.includes('오늘 처리할 일 1개'), 'S3 the owner\'s Home says "오늘 처리할 일 1개"', home.slice(0, 200));
    check(seoyeon.includes('이번 주 10시간 → 5시간') && seoyeon.includes('주휴수당 없음 (계약 주 10시간)') && seoyeon.includes('급여 −52,500원'),
      'S3 Seoyeon: 10 → 5 h, no holiday allowance (contract below 15 h), pay −52,500', seoyeon);
    check(minho.includes('이번 주 16시간 → 21시간') && minho.includes('주휴수당 변화 없음 (33,024원 유지)') && minho.includes('급여 +51,600원'),
      'S3 Minho: 16 → 21 h, holiday allowance unchanged 33,024, pay +51,600', minho);
    check(card.includes('매장 인건비 이번 주 −900원') && !card.includes('가산수당'),
      "S3 store labour cost −900 for the week; no premium with 4 regular employees", card);
    await a.click('[data-details="1"]');
    const details = await a.text('[data-decision="1"] .details');
    check(details.includes('105,000원') && details.includes('52,500원') && details.includes('165,120원') && details.includes('216,720원'),
      'S3 Details shows the full preview table (base pay 105,000 → 52,500 and 165,120 → 216,720)', details);
    const toast = await a.act('[data-approve="1"]');
    check(toast.includes('승인했어요. 최민호님이 수요일 근무를 맡아요.'), 'S3 Approve (primary) approves with a result message', toast);
    await a.go('#/schedule/2026-09-28', 'schedule');
    const marker = await a.evaluate(`(() => { const s = document.querySelector('.shift.handover[data-date="2026-09-30"]'); if (!s) return null;
      const cs = getComputedStyle(s); return { bold: s.querySelector('.shift-worker strong')?.innerText, struck: s.querySelector('s')?.innerText, edge: cs.borderLeftWidth, color: cs.borderLeftColor }; })()`);
    check(marker && marker.bold === '최민호' && marker.struck === '이서연' && marker.edge === '6px' && marker.color === 'rgb(233, 162, 59)',
      'S3 the Schedule shows the handover: amber edge, 최민호 with 이서연 struck through', JSON.stringify(marker));
    await a.go('#/login', 'signin');
    check(await a.evaluate(`document.querySelectorAll('.tour-step.is-done').length`) === 3, 'S3 the sign-in tour marks all three steps as done');
  });

  // ---- S4: expiry -------------------------------------------------------------------------------------------------
  await scenario('S4', async () => {
    await reset();
    const toast = await setClock(a, '2026-09-29T21:00');
    check(toast.includes('9/29(화) 21:00'), 'S4 Demo tools move the clock to 2026-09-29 21:00', toast);
    await a.as(2, '#/swaps', 'swaps');
    const swaps = await a.text();
    check(await a.exists('[data-my-request="1"][data-status="EXPIRED"]') && swaps.includes('만료됐어요'),
      "S4 the next screen load expires the request: Seoyeon's Swaps shows 만료됐어요", swaps.slice(0, 400));
    await a.go('#/notifications', 'notifications');
    const sentence = '9월 30일(수) 18:00–23:00 대타 요청이 승인 없이 만료됐어요. 이서연님이 그대로 근무해요.';
    const mine = await a.text();
    await a.as(1, '#/notifications', 'notifications');
    const owner = await a.text();
    check(mine.includes(sentence) && owner.includes(sentence), 'S4 requester and owner receive REQUEST_EXPIRED', `${mine.slice(0, 200)} | ${owner.slice(0, 200)}`);
  });

  // ---- S5: no taker ---------------------------------------------------------------------------------------------------
  await scenario('S5', async () => {
    await reset();
    const flow = await requestFlow(a, 4, '10월 4일(일)', 'Personal');
    check(flow.deadline === '2026-09-29T09:00' && ['이서연', '최민호', '강도윤'].every((n) => flow.step3.includes(n)) && flow.step3.includes('3명에게 바로 알림이 가요.')
      && flow.step3.includes('개인 사정'),
    "S5 Hana's request flow: reason chip 개인 사정, deadline pre-filled 2026-09-29 09:00, candidates Seoyeon, Minho, Doyun",
    `${flow.deadline} ${flow.step3.slice(0, 400)}`);
    check(flow.toast.includes('요청을 보냈어요') && flow.done.includes('이서연님, 최민호님, 강도윤님에게 요청을 보냈어요.'),
      'S5 Send swap request shows the result screen', `${flow.toast} | ${flow.done.slice(0, 300)}`);
    const sent = await a.audit();
    check(sent.primaries.length === 1 && sent.small.length === 0 && sent.overflow <= 0, 'S5 the result screen: one primary, targets ≥ 44 px, no h-scroll', JSON.stringify(sent));
    const requestId = (await rest('my_requests', { p_worker_id: 4 })).mine[0].id;
    await b.as(1, '#/home', 'home', 'ko');
    for (const worker of [2, 3, 5]) {
      await a.as(worker, '#/home', 'home');
      const toast = await a.act(`[data-decline="${requestId}"]`);
      check(toast.includes('불가로 답했어요.'), `S5 worker ${worker} answers 불가 in one tap`, toast);
    }
    await a.as(4, '#/home', 'home');
    const hana = await a.text();
    check(await a.exists('[data-failed]') && hana.includes('모든 동료가 대타가 불가능하다고 해요. 사장님께 연락드려 보세요.'),
      'S5 Hana sees "모든 동료가 대타가 불가능하다고 해요. 사장님께 연락드려 보세요."', hana.slice(0, 400));
    // NFR-15: the owner's open Home shows the FAILED card within 10 s (plus the call time) without being reloaded.
    let fresh = false;
    try { await b.waitFor(`document.querySelector('[data-owner-failed]')`, 'owner FAILED card', 14000); fresh = true; } catch { fresh = false; }
    check(fresh, "NFR-15 the owner's Home, open in another browser, shows the FAILED card within 10 s without a reload");
    await a.as(1, '#/home', 'home');
    const buttons = await a.evaluate(`[...document.querySelectorAll('[data-owner-failed] button, [data-owner-failed] a')].map((x) => x.innerText.trim())`);
    const ownerText = await a.text('[data-owner-failed]');
    check(JSON.stringify(buttons) === JSON.stringify(['확인했어요']) && ownerText.includes('정하나님의 10월 4일(일) 10:00–16:00 근무는 동료 모두 불가예요. 직접 연락해 주세요.'),
      "S5 the owner's FAILED card has only 확인했어요", `${JSON.stringify(buttons)} ${ownerText}`);
    const toast = await a.act('[data-owner-failed] [data-ack-failed]');
    check(toast.includes('확인했어요') && !(await a.exists('[data-owner-failed]')), 'S5 the owner acknowledges the card (marks the notification read)', toast);
  });

  // ---- S7: ABSENT policy --------------------------------------------------------------------------------------------
  await scenario('S7', async () => {
    await reset();
    await a.as(1, '#/settings', 'settings', 'ko');
    await a.click('[data-policy-option="ABSENT"] input');
    const saved = await a.act('#save-settings');
    check(saved.includes('설정을 저장했어요.'), 'S7 the owner sets the policy to ABSENT', saved);
    const flow = await requestFlow(a, 3, '10월 3일(토)');
    check(flow.step3.includes('이서연') && flow.step3.includes('정하나') && !flow.step3.includes('강도윤') && flow.step3.includes('2명에게'),
      "S7 Minho's request for Sat 10-03 goes to Seoyeon and Hana (Doyun's Saturday overlaps)", flow.step3.slice(0, 400));
    const requestId = (await rest('my_requests', { p_worker_id: 3 })).mine[0].id;
    await a.as(4, '#/home', 'home');
    const toast = await a.act(`[data-accept="${requestId}"]`);
    check(toast.includes('토요일 근무를 맡았어요'), 'S7 Hana accepts', toast);
    await a.as(1, '#/home', 'home');
    const minho = await a.text(`[data-decision="${requestId}"] [data-person="3"]`);
    const hana = await a.text(`[data-decision="${requestId}"] [data-person="4"]`);
    const store = await a.text(`[data-decision="${requestId}"] .store-line`);
    const highlighted = await a.exists(`[data-decision="${requestId}"] [data-person="3"] [data-holiday-change]`);
    check(minho.includes('16시간 → 10시간') && minho.includes('주휴수당 33,024원 → 없음 (−33,024원)') && minho.includes('급여 −61,920원') && highlighted,
      'S7 the preview shows Minho eligible → not eligible, holiday pay −33,024 (highlighted), pay −61,920', minho);
    check(hana.includes('12시간 → 18시간') && hana.includes('급여 +61,920원') && store.includes('−33,024원'),
      'S7 Hana +61,920; store −33,024', `${hana} | ${store}`);
  });

  // ---- S8: part-time overtime with 5 regular employees -------------------------------------------------------------
  await scenario('S8', async () => {
    await reset();
    await a.as(1, '#/settings', 'settings', 'ko');
    await a.fill('input[name="regularEmployees"]', '5');
    check((await a.act('#save-settings')).includes('설정을 저장했어요.'), 'S8 the owner sets 5 regular employees');
    await a.go('#/schedule/2026-09-28', 'schedule');
    await a.click('#add-shift');
    await a.waitFor(`document.querySelector('#add-save')`, 'add sheet');
    await a.fill('#add-form select[name="workDate"]', '2026-10-02');
    await a.fill('#add-form input[name="startTime"]', '10:00');
    await a.fill('#add-form input[name="endTime"]', '18:00');
    await a.fill('#add-form select[name="workerId"]', '3');
    const added = await a.act('#add-save');
    check(added.includes('근무를 추가했어요.') && await a.exists('.shift[data-worker="3"][data-date="2026-10-02"]'),
      'S8 the owner adds Fri 2026-10-02 10:00–18:00 for Minho', added);
    await a.as(3, '#/home', 'home');
    const card = await a.text('[data-incoming="1"]');
    check(card.includes('24시간 → 29시간'), "S8 Minho's card shows his week 24 → 29 h before he accepts", card);
    await a.act('[data-accept="1"]');
    await a.as(1, '#/home', 'home');
    const minho = await a.text('[data-decision="1"] [data-person="3"]');
    const seoyeon = await a.text('[data-decision="1"] [data-person="2"]');
    const warning = await a.text('[data-decision="1"] [data-warning]');
    const approveEnabled = await a.evaluate(`!document.querySelector('[data-approve="1"]').disabled`);
    check(minho.includes('24시간 → 29시간') && warning.includes('최민호님은 이번 주 계약보다 13시간 더 일하게 돼요') && approveEnabled,
      'S8 the preview shows Minho 24 → 29 h and the BR-15 warning (13 h beyond contract); Approve stays enabled', `${minho} | ${warning}`);
    check(minho.includes('급여 +51,600원') && minho.includes('가산수당 +30,960원') && seoyeon.includes('급여 −52,500원') && seoyeon.includes('가산수당 −5,250원'),
      'S8 BR-16 estimate: Minho base +51,600, premium +30,960; Seoyeon base −52,500, premium −5,250', `${minho} | ${seoyeon}`);
    // With 10:00–17:00 instead: 23 → 28 h, exactly 12 h beyond contract, no warning.
    await a.go('#/schedule/2026-09-28', 'schedule');
    await a.click('.shift[data-worker="3"][data-date="2026-10-02"]');
    await a.waitFor(`document.querySelector('#act-time')`, 'shift sheet');
    await a.click('#act-time');
    await a.fill('#time-form input[name="endTime"]', '17:00');
    check((await a.act('#save-time')).includes('근무를 바꿨어요.'), 'S8 the owner changes the Friday shift to 10:00–17:00');
    await a.go('#/home', 'home');
    const minho12 = await a.text('[data-decision="1"] [data-person="3"]');
    check(minho12.includes('23시간 → 28시간') && !(await a.exists('[data-decision="1"] [data-warning]')),
      'S8 with 10:00–17:00 the preview shows 23 → 28 h, exactly 12 h beyond contract, and no warning', minho12);
  });

  // ---- S9: overnight shift (continues S8: 5 regular employees) ------------------------------------------------------
  await scenario('S9', async () => {
    await a.as(1, '#/schedule/2026-09-28', 'schedule', 'ko');
    await a.click('#add-shift');
    await a.waitFor(`document.querySelector('#add-save')`, 'add sheet');
    await a.fill('#add-form select[name="workDate"]', '2026-10-02');
    await a.fill('#add-form input[name="startTime"]', '22:00');
    await a.fill('#add-form input[name="endTime"]', '02:00');
    await a.fill('#add-form select[name="workerId"]', '5');
    const hint = await a.text('#add-form');
    const added = await a.act('#add-save');
    const block = await a.text('.shift[data-worker="5"][data-date="2026-10-02"]');
    check(added.includes('근무를 추가했어요.') && hint.includes('다음 날 02:00에 끝나요') && block.includes('22:00–02:00') && block.includes('다음 날 02:00까지'),
      "S9 the owner adds Fri 2026-10-02 22:00–02:00 for Doyun; the board shows it on Friday with 다음 날 02:00까지", `${added} | ${block}`);
    const week = await rest('worker_home', { p_worker_id: 5 });
    check(week.week.week_start === '2026-09-28' && week.week.scheduled_hours === 16 && week.week.premium.night_minutes === 240,
      'S9 it belongs to the week of 2026-09-28, lasts 4 h (Doyun 12 → 16 h) and all 4 h are night hours with 5 employees',
      JSON.stringify({ week_start: week.week.week_start, scheduled: week.week.scheduled_hours, premium: week.week.premium }));
    await a.click('#add-shift');
    await a.waitFor(`document.querySelector('#add-save')`, 'add sheet');
    await a.fill('#add-form select[name="workDate"]', '2026-10-03');
    await a.fill('#add-form input[name="startTime"]', '01:00');
    await a.fill('#add-form input[name="endTime"]', '05:00');
    await a.fill('#add-form select[name="workerId"]', '5');
    const refused = await expectRefusal(a, 'add_shift', () => a.act('#add-save'));
    const inline = await a.text('#add-form .form-error');
    check(refused.refusals === 1 && refused.result.includes('강도윤님은 이미 10/2(금) 22:00–다음 날 02:00 근무가 있어 이 시간과 겹쳐요.') && inline === refused.result,
      'S9 Sat 2026-10-03 01:00–05:00 for Doyun is refused (OVERLAP), with the reason in the sheet and the toast', `${refused.result} | ${inline}`);
    await a.click('.sheet-head .icon-btn');
  });

  // ---- S10 and S6: the automatic September draft and its confirmation ---------------------------------------------
  await scenario('S10/S6', async () => {
    await reset();
    const toast = await setClock(a, '2026-10-01T09:00');
    check(toast.includes('10/1(목) 09:00'), 'S10 the demo clock is moved to 2026-10-01 09:00', toast);
    await a.go('#/home', 'home');
    const home = await a.text();
    check(home.includes('9월 급여 초안이 준비됐어요. 확인하고 확정해 주세요.') && await a.exists('[data-payroll-ready="2026-09"]'),
      'S10 the owner\'s Home shows "9월 급여 초안이 준비됐어요" with 급여 확인하기', home.slice(0, 500));
    await a.click('[data-payroll-ready="2026-09"]');
    await a.screen('pay-month');
    const hash = await a.evaluate('location.hash');
    const month = await a.text();
    check(hash === '#/pay/month/2026-09' && await a.exists('[data-screen="pay-month"][data-status="DRAFT"]') && month.includes('매월 1일에 자동으로 만든 초안이에요.'),
      'S10 급여 확인하기 opens Pay → Monthly with the automatic September DRAFT', `${hash} ${month.slice(0, 300)}`);
    const totals = await a.evaluate(`Object.fromEntries([...document.querySelectorAll('[data-pay-row]')].map((r) => [r.dataset.payRow, Number(r.dataset.total)]))`);
    const total = await a.evaluate(`Number(document.querySelector('[data-pay-total]').dataset.payTotal)`);
    check(totals['2'] === 472500 && totals['3'] === 844176 && totals['4'] === 495360 && totals['5'] === 480000 && total === 2292036
      && ['472,500원', '844,176원', '495,360원', '480,000원', '2,292,036원'].every((x) => month.includes(x)),
    'S6 September rows 472,500 / 844,176 / 495,360 / 480,000 and total 2,292,036', `${JSON.stringify(totals)} ${total}`);
    const doyun = await a.text('[data-min-warning="5"]');
    const hana = await a.text('[data-pay-row="4"]');
    check(doyun.includes('강도윤님 시급 10,000원이 2026년 최저임금 10,320원보다 낮아요') && (await a.text('[data-pay-row="5"]')).includes('최저임금 미만')
      && hana.includes('수습 최저임금 90 % · 9,288원') && !(await a.exists('[data-min-warning="4"]')),
    "S6 Doyun's row shows the minimum-wage warning; Hana's probation minimum 9,288 applies and her wage is above it", `${doyun} | ${hana}`);
    const blocked = await a.evaluate(`(() => { const b = document.querySelector('#confirm-payroll'); const r = b && document.getElementById(b.getAttribute('aria-describedby'));
      return { disabled: !!b && b.disabled, reason: r ? r.innerText : '' }; })()`);
    check(blocked.disabled && blocked.reason.includes('최저임금 경고 1건을 확인해야 확정할 수 있어요.'),
      'S6 confirmation is blocked, with its reason, until the warning is acknowledged', JSON.stringify(blocked));
    const ack = await a.act('[data-ack="5"]');
    const enabled = await a.evaluate(`!document.querySelector('#confirm-payroll').disabled`);
    check(ack.includes('경고를 확인했어요.') && enabled, 'S6 after 확인했어요 on Doyun\'s warning, 9월 급여 확정하기 is enabled', ack);
    const confirmed = await a.act('#confirm-payroll');
    check(confirmed.includes('9월 급여를 확정했어요.') && await a.exists('[data-screen="pay-month"][data-status="CONFIRMED"]'),
      'S6 the September payroll is confirmed', confirmed);
    await a.go('#/home', 'home');
    check(!(await a.exists('[data-payroll-ready]')), 'S10 opening the draft marked PAYROLL_DRAFT_READY read (the Home card is gone)');
  });

  // ---- S11: no-show ---------------------------------------------------------------------------------------------------
  await scenario('S11', async () => {
    await reset();
    await setClock(a, '2026-09-29T23:30');
    await a.go('#/pay/week/2026-09-28', 'pay-week');
    const before = await a.evaluate(`(() => { const r = document.querySelector('[data-week-row="3"]'); return r ? { eligible: r.dataset.eligible, pay: Number(r.dataset.holidayPay) } : null; })()`);
    await a.go('#/schedule/2026-09-28', 'schedule');
    await a.click('.shift[data-worker="3"][data-date="2026-09-29"]');
    await a.waitFor(`document.querySelector('#act-absent')`, 'Mark absent in the shift sheet');
    const sheet = await a.text('.sheet');
    check(!sheet.includes('출근 기록') && await a.exists('#act-absent'), "S11 the owner's sheet of Minho's started Tue 09-29 shift (no attendance) offers 결근 처리", sheet.slice(0, 300));
    const toast = await a.act('#act-absent');
    check(toast.includes('결근으로 처리했어요.'), 'S11 결근 처리 marks the no-show ABSENT', toast);
    await a.go('#/pay/week/2026-09-28', 'pay-week');
    const after = await a.evaluate(`(() => { const r = document.querySelector('[data-week-row="3"]'); return r ? { eligible: r.dataset.eligible, pay: Number(r.dataset.holidayPay), text: r.innerText } : null; })()`);
    check(before && before.eligible === 'true' && before.pay === 33024 && after && after.eligible === 'false' && after.pay === 0 && after.text.includes('9/29(화) 결근'),
      "S11 Minho's week of 2026-09-28 loses perfect attendance and its holiday allowance (33,024 → 0)", `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    await a.as(3, '#/home', 'home');
    check((await a.text('[data-week-card]')).includes('9월 29일(화) 결근으로 이번 주 주휴수당이 없어요'), "S11 Minho's Home explains the lost holiday allowance");
  });

  // ---- BR-06 (c): a week without a day worked (TC-089 on the screens) ---------------------------------------------
  await scenario('BR-06c', async () => {
    await reset();
    // Minho hands over all three shifts of the week of 09-28 (Tue and Thu to Seoyeon, Sat to Hana); the owner approves.
    const shifts = (await rest('requestable_shifts', { p_worker_id: 3 }))
      .filter((s) => ['2026-09-29', '2026-10-01', '2026-10-03'].includes(s.work_date));
    for (const s of shifts) {
      const r = await rest('create_sub_request', { p_shift_id: s.id, p_requester_id: 3, p_reason: null, p_deadline: s.default_deadline });
      await rest('accept_sub_request', { p_request_id: r.id, p_worker_id: s.work_date === '2026-10-03' ? 4 : 2 });
      await rest('decide_sub_request', { p_request_id: r.id, p_decision: 'APPROVE' });
    }
    await a.as(1, '#/pay/week/2026-09-28', 'pay-week');
    const row = await a.evaluate(`(() => { const r = document.querySelector('[data-week-row="3"]'); return r ? { eligible: r.dataset.eligible, pay: Number(r.dataset.holidayPay), text: r.innerText } : null; })()`);
    check(shifts.length === 3 && row && row.eligible === 'false' && row.pay === 0 && row.text.includes('이번 주 일한 날 없음'),
      "BR-06 (c): after handing over all three shifts (EXCUSED) Minho's week of 2026-09-28 has no holiday allowance, reason 이번 주 일한 날 없음", `${shifts.length} ${JSON.stringify(row)}`);
    await a.as(3, '#/home', 'home');
    check((await a.text('[data-week-card]')).includes('이번 주에 일한 날이 없어서 주휴수당이 없어요'), "BR-06 (c): Minho's Home explains why there is no holiday allowance");
  });

  // ---- Role-based access (spec §19) -----------------------------------------------------------------------------
  await scenario('RBAC', async () => {
    await reset();
    await a.as(3, '#/home', 'home', 'ko');
    await a.go('#/pay/week');
    await sleep(400);
    const worker = await a.evaluate('location.hash');
    await a.as(1, '#/home', 'home');
    await a.go('#/swaps');
    await sleep(400);
    const owner = await a.evaluate('location.hash');
    await a.load('#/home', { user: null });
    await sleep(600);
    const anonymous = await a.evaluate('location.hash');
    check(worker === '#/home' && owner === '#/home' && anonymous === '#/login',
      'RBAC: a worker cannot open Pay, the owner cannot open Swaps, no account → sign-in', `${worker} ${owner} ${anonymous}`);
    const me = await (async () => { await a.as(2, '#/me', 'me'); return a.text(); })();
    check(me.includes('010-4172-2083') && me.includes('10,500원') && me.includes('화면에서는 나와 사장님만 전화번호와 시급을 볼 수 있어요. 데모용 가상 데이터예요.'),
      "NFR-11: Seoyeon's Me shows her own phone and wage with the note that, on screen, only she and the owner see them and the data are fictional", me.slice(0, 300));
  });

  // ---- Language switch: the sign-in header and the user menu (stored in localStorage shiftswap9.lang) -------------
  await scenario('language', async () => {
    await a.load('#/login', { lang: 'ko', user: null });
    await a.screen('signin');
    await a.click('#lang-switch');
    await a.waitFor(`document.querySelector('[data-screen="signin"] h1')?.innerText === 'Dalbit Café demo'`, 'English sign-in');
    const stored = await a.evaluate(`localStorage.getItem('shiftswap9.lang') + ' ' + document.documentElement.lang`);
    await a.click('[data-account="3"]');
    await a.screen('home');
    const english = await a.text();
    await a.click('#user-menu');
    await a.waitFor(`document.querySelector('#menu-lang')`, 'user menu');
    await a.click('#menu-lang');
    await a.waitFor(`document.querySelector('[data-screen="home"] h1')?.innerText === '최민호님, 안녕하세요'`, 'Korean Home');
    const back = await a.evaluate(`localStorage.getItem('shiftswap9.lang') + ' ' + document.documentElement.lang`);
    check(stored === 'en en' && english.includes('Hi, Choi Minho') && english.includes('Lee Seoyeon needs someone to cover') && back === 'ko ko',
      'Language: English from the sign-in header, Korean again from the user menu; the choice is kept in localStorage', `${stored} | ${back}`);
  });

  // ---- Audits: every page at 1280 and 360 px in Korean and English ------------------------------------------------
  await scenario('audits', async () => {
    await reset();
    const minhoShift = (await rest('requestable_shifts', { p_worker_id: 3 })).find((s) => s.work_date === '2026-10-03').id;
    const workerPages = [
      { name: 'sign-in', user: null, hash: '#/login', screen: 'signin' },
      { name: 'worker Home', user: 3, hash: '#/home', screen: 'home' },
      { name: 'worker Schedule', user: 3, hash: '#/schedule/2026-09-28', screen: 'schedule' },
      { name: 'Swaps', user: 2, hash: '#/swaps', screen: 'swaps' },
      { name: 'request step 1', user: 3, hash: '#/swaps/new/1', screen: 'flow-1', flow: {} },
      { name: 'request step 2', user: 3, hash: '#/swaps/new/2', screen: 'flow-2', flow: { shiftId: minhoShift } },
      { name: 'request step 3', user: 3, hash: '#/swaps/new/3', screen: 'flow-3', flow: { shiftId: minhoShift, reasonKey: 'Exam' } },
      { name: 'request result', user: 3, hash: '#/swaps/new/done', screen: 'flow-done',
        flow: { result: { status: 'REQUESTED', candidates: ['Lee Seoyeon', 'Jung Hana'], shift: { work_date: '2026-10-03', start_time: '12:00', end_time: '18:00' } } } },
      { name: 'Me', user: 3, hash: '#/me', screen: 'me' },
      { name: 'worker Notifications', user: 3, hash: '#/notifications', screen: 'notifications' },
    ];
    const ownerPages = [
      { name: 'owner Home (decision)', user: 1, hash: '#/home', screen: 'home' },
      { name: 'owner Schedule', user: 1, hash: '#/schedule/2026-09-28', screen: 'schedule' },
      { name: 'Staff', user: 1, hash: '#/staff', screen: 'staff' },
      { name: 'Staff detail', user: 1, hash: '#/staff/3', screen: 'staff-detail' },
      { name: 'new worker', user: 1, hash: '#/staff/new', screen: 'staff-detail' },
      { name: 'Pay weekly', user: 1, hash: '#/pay/week/2026-09-28', screen: 'pay-week' },
      { name: 'Pay monthly (confirmed)', user: 1, hash: '#/pay/month/2026-08', screen: 'pay-month' },
      { name: 'Pay monthly (no draft)', user: 1, hash: '#/pay/month/2026-09', screen: 'pay-month' },
      { name: 'Settings', user: 1, hash: '#/settings', screen: 'settings' },
      { name: 'owner Notifications', user: 1, hash: '#/notifications', screen: 'notifications' },
    ];
    const audit = async (pages) => {
      for (const lang of ['ko', 'en']) {
        for (const width of [1280, 360]) {
          await a.viewport(width);
          for (const p of pages) {
            await a.load(p.hash, { lang, user: p.user, flow: p.flow === undefined ? null : p.flow });
            await a.screen(p.screen);
            const r = await a.audit();
            const reasonsOk = r.disabled.every((d) => d.reason);
            check(r.primaries.length === 1 && reasonsOk && r.small.length === 0 && r.overflow <= 0,
              `Audit ${p.name} ${lang} ${width}px: 1 primary (${r.primaries.join(' / ')}), ${r.disabled.length} disabled with reason, targets ≥ 44 px, no h-scroll`,
              JSON.stringify(r));
          }
        }
      }
    };
    await audit(workerPages);
    // The owner pages are audited with a decision waiting. The database is shared with the team: if someone changed it
    // meanwhile, start again from the seed.
    try {
      await rest('accept_sub_request', { p_request_id: 1, p_worker_id: 3 });
    } catch {
      await reset();
      await rest('accept_sub_request', { p_request_id: 1, p_worker_id: 3 });
    }
    await audit(ownerPages);
    await a.viewport(1280);
  });

  const problems = [...pageA.problems, ...pageB.problems];
  check(problems.length === 0, 'no console errors or exceptions in either browser (expected refusals discounted)', problems.join(' | '));
} catch (err) {
  check(false, 'the check ran to the end', err.stack || err.message);
} finally {
  try {
    await reset();
    check(true, 'reset_demo_data at the end (the shared database is back at the seed)');
  } catch (err) {
    check(false, 'reset_demo_data at the end', err.message);
  }
  pageA.close();
  pageB.close();
  server.close();
}
console.log(`\n${passes} passed, ${failures} failed`);
process.exitCode = failures ? 1 : 0;
