// Headless browser checks (done criteria 3–6 of the prompt):
//   node tools/check.mjs
// 3. /app/ opens on the sign-in screen with no console errors.
// 4. The sign-in tour walkthrough in Korean: Seoyeon's tracker; Minho's card with "16시간 → 21시간" accepted in one
//    tap; Doyun sees that Minho was faster; the owner's decision card (16 → 21 h, holiday allowance unchanged) is
//    approved; the schedule shows the handover marker.
// 5. The S8 walkthrough in Korean: Hana requests Sun 10-04 10:00–16:00; Seoyeon, Minho and Doyun tap 불가; Hana's
//    Swaps tab shows the FAILED card; the owner's Home shows "대타를 못 구했어요" and 확인했어요 removes it.
// 6. Every scene at 1280 px and 360 px (NFR-02) in Korean and English: exactly one filled primary button, every
//    disabled button with a visible reason, touch targets of at least 44 × 44 px, no horizontal scroll.
import { serve, chrome, app, sleep } from './lib.mjs';
import { SCENES, hanaRequestsSunday, declineSunday } from './scenes.mjs';

let failures = 0;
function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${!ok && detail ? `\n     ${detail}` : ''}`);
  if (!ok) failures++;
}

const server = await serve();
const page = await chrome();
const a = app(page, server.url);
try {
  // ---- Done criterion 3 ----
  await a.viewport(1280, 900);
  await a.fresh('ko');
  const signin = await a.text();
  check(['박지영', '이서연', '최민호', '정하나', '강도윤'].every((n) => signin.includes(n)) && signin.includes('3분 체험'),
    'DC-3 sign-in screen with the tour and all five accounts');
  check(page.problems.length === 0, 'DC-3 no console errors on first load', page.problems.join(' | '));

  // ---- Done criterion 4 (Korean, through the tour buttons) ----
  await a.click('[data-step="0"]');
  let text = await a.text();
  check(text.includes('보낸 요청') && await a.evaluate('!!document.querySelector(".tracker .step.current")') && text.includes('9월 30일(수) 18:00–23:00'),
    "DC-4 Seoyeon's Swaps tab shows her open request as a tracker");
  await a.evaluate(`document.getElementById('toast-root').innerHTML = ''; sessionStorage.clear(); location.hash = '#/login'`);
  await sleep(300);
  await a.click('[data-step="1"]');
  text = await a.text();
  check(text.includes('이서연님이 대타를 구해요') && text.includes('16시간 → 21시간'), "DC-4 Minho's Home card shows the effect 16시간 → 21시간", text.slice(0, 300));
  const clicksBefore = await a.evaluate('document.querySelectorAll("[data-accept]").length');
  await a.click('[data-accept]');
  const toastText = await a.evaluate(`document.getElementById('toast-root').innerText`);
  check(clicksBefore === 1 && toastText.includes('근무를 맡았어요') && !(await a.evaluate('!!document.querySelector("[data-accept]")')),
    'DC-4 수락하기 accepts in one tap with a result message', toastText);
  await a.signIn(5, '#/home');
  text = await a.text();
  check(text.includes('최민호님이 먼저 수락했어요') && !(await a.evaluate('!!document.querySelector("[data-accept]")')), "DC-4 Doyun's Home says Minho was faster");
  await a.evaluate(`sessionStorage.clear(); location.hash = '#/login'`);
  await sleep(300);
  await a.click('[data-step="2"]');
  text = await a.text();
  check(text.includes('최민호님 이번 주 16시간 → 21시간') && text.includes('변화 없음') && text.includes('33,024원 유지'),
    "DC-4 owner's decision card: Minho 16 → 21 h, holiday allowance unchanged", text.slice(0, 400));
  await a.click('[data-approve]');
  check((await a.evaluate(`document.getElementById('toast-root').innerText`)).includes('승인했어요'), 'DC-4 승인하기 approves with a result message');
  await a.go('#/schedule/2026-09-28');
  const marker = await a.evaluate(`(() => { const b = document.querySelector('.shift.handover'); if (!b) return null; const cs = getComputedStyle(b);
    return { bold: b.querySelector('.shift-worker strong')?.innerText, struck: b.querySelector('s')?.innerText, edge: cs.borderLeftWidth, stripe: cs.backgroundImage.startsWith('repeating-linear-gradient') }; })()`);
  check(marker && marker.bold === '최민호' && marker.struck === '이서연' && marker.edge === '6px' && marker.stripe,
    'DC-4 the schedule shows the handover marker', JSON.stringify(marker));
  await a.go('#/login');
  await a.evaluate(`sessionStorage.clear(); dispatchEvent(new HashChangeEvent('hashchange'))`);
  await sleep(300);
  check((await a.evaluate('document.querySelectorAll(".tour-step.is-done").length')) === 3, 'DC-4 the tour marks all three steps as done');

  // ---- Done criterion 5 (S8, Korean) ----
  await a.fresh('ko');
  await hanaRequestsSunday(a);
  text = await a.text();
  check(text.includes('요청을 보냈어요') && ['이서연', '최민호', '강도윤'].every((n) => text.includes(`${n}님`)),
    'DC-5 Hana sends the Sunday request to Seoyeon, Minho and Doyun', text.slice(0, 300));
  await declineSunday(a, 2);
  const declineToast = await a.evaluate(`document.getElementById('toast-root').innerText`);
  check(declineToast.includes('불가로 답했어요'), 'DC-5 불가 is one tap with the toast 불가로 답했어요', declineToast);
  await declineSunday(a, 3);
  await declineSunday(a, 5);
  await a.signIn(4, '#/swaps');
  text = await a.text();
  check(text.includes('모든 동료가 대타가 불가능하다고 해요. 사장님께 연락드려 보세요.') && await a.evaluate('!!document.querySelector("[data-ack-failed]")'),
    "DC-5 Hana's Swaps tab shows the FAILED card with the contact-the-owner message", text.slice(0, 400));
  await a.signIn(1, '#/home');
  text = await a.text();
  const ownerButtons = await a.evaluate(`(() => { const card = document.querySelector('[data-ack-failed]')?.closest('.card'); return card ? [...card.querySelectorAll('button, a')].map((b) => b.innerText.trim()) : null; })()`);
  check(text.includes('대타를 못 구했어요') && text.includes('정하나님의 10월 4일(일) 10:00–16:00 근무는 동료 모두 불가예요. 직접 연락해 주세요.')
    && JSON.stringify(ownerButtons) === JSON.stringify(['확인했어요']),
    'DC-5 the owner\'s Home shows the 대타를 못 구했어요 card with only 확인했어요', `${JSON.stringify(ownerButtons)} ${text.slice(0, 400)}`);
  await a.click('[data-ack-failed]');
  text = await a.text();
  check(!text.includes('동료 모두 불가예요') && !(await a.evaluate('!!document.querySelector("[data-ack-failed]")')), 'DC-5 확인했어요 removes the owner card');

  // ---- Done criterion 6 ----
  const problemsBefore = page.problems.length;
  for (const name of Object.keys(SCENES)) {
    for (const lang of ['ko', 'en']) {
      for (const width of [1280, 360]) {
        await a.viewport(width, 900);
        await a.fresh(lang);
        await SCENES[name](a);
        await sleep(150);
        const r = await a.audit();
        const label = `DC-6 ${name} ${lang} ${width}px`;
        const reasonsOk = r.disabled.every((d) => d.reason);
        check(r.primaries.length === 1 && reasonsOk && r.small.length === 0 && r.overflow <= 0,
          `${label}: 1 primary (${r.primaries.join(' / ')}), ${r.disabled.length} disabled with reason, targets ≥ 44 px, no h-scroll`,
          JSON.stringify(r));
      }
    }
  }
  check(page.problems.length === problemsBefore, 'no console errors while visiting every scene', page.problems.slice(problemsBefore).join(' | '));
} finally {
  page.close();
  server.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;
