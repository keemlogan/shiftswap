// Named UI states used by the screenshots and the headless checks. Each scene starts from a fresh seed.
import { sleep } from './lib.mjs';

/** S8 (spec §10): as Jung Hana, request a substitute for Sun 2026-10-04 10:00–16:00 through the three-step flow. */
export async function hanaRequestsSunday(a) {
  await a.signIn(4, '#/swaps/new/1');
  await a.evaluate(`[...document.querySelectorAll('input[name="shift"]')].find((r) => r.closest('label').innerText.includes('10:00–16:00')).click()`);
  await sleep(200);
  await a.click('#next');
  await a.click('#next');
  await a.click('#send');
}

/** As worker `id`, answer 불가 / Can't on the request card for the 10:00–16:00 shift. */
export async function declineSunday(a, id) {
  await a.signIn(id, '#/home');
  const ok = await a.evaluate(`(() => { const card = [...document.querySelectorAll('.req-card')].find((c) => c.querySelector('[data-decline]') && c.innerText.includes('10:00–16:00'));
    if (!card) return false; card.querySelector('[data-decline]').click(); return true; })()`);
  if (!ok) throw new Error(`no Sunday request card for worker ${id}`);
  await sleep(280);
}

/** S8 up to the end: Hana's request, then Lee Seoyeon, Choi Minho and Kang Doyun all answer can't → FAILED. */
export async function s8Failed(a) {
  await hanaRequestsSunday(a);
  for (const id of [2, 3, 5]) await declineSunday(a, id);
}

/** Scenes: a name and the steps that bring a fresh seed into the state the screenshot shows. */
export const SCENES = {
  signin: async () => {},
  'worker-home-minho': async (a) => a.signIn(3, '#/home'),
  'worker-home-seoyeon': async (a) => a.signIn(2, '#/home'),
  'swaps-seoyeon': async (a) => a.signIn(2, '#/swaps'),
  'flow-1': async (a) => {
    await a.signIn(2, '#/swaps/new/1');
  },
  'flow-2': async (a) => {
    await a.signIn(2, '#/swaps/new/1');
    await a.click('input[name="shift"]:not([disabled])');
    await a.click('#next');
    await a.click('input[name="reason"][value="Family"]');
  },
  'flow-3': async (a) => {
    await SCENES['flow-2'](a);
    await a.click('#next');
  },
  'flow-done': async (a) => {
    await SCENES['flow-3'](a);
    await a.click('#send');
  },
  'owner-home': async (a) => a.signIn(1, '#/home'),
  'owner-home-decision': async (a) => {
    await a.signIn(3, '#/home');
    await a.click('[data-accept]');
    await a.signIn(1, '#/home');
  },
  'owner-home-details': async (a) => {
    await SCENES['owner-home-decision'](a);
    await a.click('[data-details]');
  },
  'worker-home-doyun-taken': async (a) => {
    await a.signIn(3, '#/home');
    await a.click('[data-accept]');
    await a.signIn(5, '#/home');
  },
  'swaps-seoyeon-accepted': async (a) => {
    await a.signIn(3, '#/home');
    await a.click('[data-accept]');
    await a.signIn(2, '#/swaps');
  },
  'schedule-owner': async (a) => a.signIn(1, '#/schedule/2026-09-28'),
  'schedule-worker': async (a) => a.signIn(2, '#/schedule/2026-09-28'),
  'schedule-detail': async (a) => {
    await a.signIn(1, '#/schedule/2026-09-28');
    await a.evaluate(`[...document.querySelectorAll('[data-shift]')].find((b) => b.getAttribute('aria-label').includes('18:00') && b.classList.contains('pending')).click()`);
    await sleep(300);
  },
  'schedule-handover': async (a) => {
    await SCENES['owner-home-decision'](a);
    await a.click('[data-approve]');
    await a.go('#/schedule/2026-09-28');
  },
  'pay-week': async (a) => a.signIn(1, '#/pay/week/2026-09-21'),
  'pay-month-empty': async (a) => a.signIn(1, '#/pay/month/2026-09'),
  'pay-month': async (a) => {
    await a.signIn(1, '#/pay/month/2026-09');
    await a.click('#make-draft');
  },
  'staff-list': async (a) => a.signIn(1, '#/staff'),
  'staff-detail': async (a) => a.signIn(1, '#/staff/3'),
  me: async (a) => a.signIn(2, '#/me'),
  'failed-worker': async (a) => {
    await s8Failed(a);
    await a.signIn(4, '#/swaps');
  },
  'failed-owner': async (a) => {
    await s8Failed(a);
    await a.signIn(1, '#/home');
  },
  'notifications-minho': async (a) => a.signIn(3, '#/notifications'),
  settings: async (a) => a.signIn(1, '#/settings'),
  'demo-tools': async (a) => {
    await a.signIn(1, '#/home');
    await a.click('#open-demo');
  },
};

