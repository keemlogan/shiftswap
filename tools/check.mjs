// Headless browser checks (done criteria 3–7 of the prompt):
//   node tools/check.mjs
// 3. /app/ opens on the sign-in screen with no console errors.
// 4. The sign-in tour walkthrough in Korean: Seoyeon's tracker; Minho's card with "16시간 → 21시간" accepted in one
//    tap; Doyun sees that Minho was faster; the owner's decision card (16 → 21 h, holiday allowance unchanged) is
//    approved; the schedule shows the handover marker.
// 5. The S8 walkthrough in Korean: Hana requests Sun 10-04 10:00–16:00; Seoyeon, Minho and Doyun tap 불가; Hana's
//    Swaps tab shows the FAILED card; the owner's Home shows "대타를 못 구했어요" and 확인했어요 removes it.
// 6. The S9 walkthrough in Korean: Pay → Monthly shows March–August 2026 as confirmed (‹ stops at March); at
//    2026-10-01 the owner's Home shows "9월 급여 초안이 준비됐어요" and 급여 확인하기 opens the automatic September
//    draft with Doyun's warning; at 2026-10-15 there is still one draft and one notification.
// S10. The part-time overtime warning (FR-24, BR-15) on the owner's decision card, which does not block the approval.
// 7. Every scene at 1280 px and 360 px (NFR-02) in Korean and English: exactly one filled primary button, every
//    disabled button with a visible reason, touch targets of at least 44 × 44 px, no horizontal scroll.
import { serve, chrome, app, sleep } from './lib.mjs';
import { SCENES, hanaRequestsSunday, declineSunday, setClock, ownerOvertimeWarning } from './scenes.mjs';

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

  // ---- Done criterion 6 (S9, Korean) ----
  await a.fresh('ko');
  await a.signIn(1, '#/pay/month/2026-09');
  const seen = [];
  for (let i = 0; i < 12; i++) {
    const prev = await a.evaluate(`document.querySelector('.period-nav a[aria-label="이전 달"]')?.getAttribute('href') || null`);
    if (!prev) break;
    await a.go(prev);
    seen.push(await a.evaluate(`(() => ({ month: location.hash.slice(-7), label: document.querySelector('.period-nav').innerText,
      rows: document.querySelectorAll('.pay-table tbody tr:not(.warning-row)').length,
      editable: document.querySelectorAll('#confirm, #make-draft, #remake, [data-ack]').length }))()`));
  }
  check(JSON.stringify(seen.map((m) => m.month)) === JSON.stringify(['2026-08', '2026-07', '2026-06', '2026-05', '2026-04', '2026-03'])
    && seen.every((m) => m.label.includes('확정됨') && m.rows > 0 && m.editable === 0),
    'DC-6 Pay → Monthly reaches back to March 2026 and shows March–August as 확정됨, read-only', JSON.stringify(seen));
  await setClock(a, '2026-10-01T09:00');
  await a.go('#/home');
  text = await a.text();
  check(text.includes('9월 급여 초안이 준비됐어요. 확인하고 확정해 주세요.') && await a.evaluate('!!document.querySelector("[data-payroll-ready]")'),
    'DC-6 at 2026-10-01 the owner\'s Home shows "9월 급여 초안이 준비됐어요" with 급여 확인하기', text.slice(0, 400));
  const readyLabel = await a.evaluate('document.querySelector("[data-payroll-ready]")?.innerText.trim()');
  await a.click('[data-payroll-ready]');
  text = await a.text();
  const hash = await a.evaluate('location.hash');
  check(hash === '#/pay/month/2026-09' && readyLabel === '급여 확인하기' && text.includes('매월 1일에 자동으로 만든 초안이에요')
    && text.includes('강도윤님 시급 10,000원이 2026년 최저임금 10,320원보다 낮아요') && await a.evaluate('!!document.querySelector("[data-ack]") && document.querySelector("#confirm").disabled'),
    'DC-6 급여 확인하기 opens the automatic September draft with Doyun\'s warning to acknowledge', `${hash} ${text.slice(0, 500)}`);
  await a.go('#/home');
  check(!(await a.evaluate('!!document.querySelector("[data-payroll-ready]")')), 'DC-6 opening the draft marks the notification read (the Home card is gone)');
  const s9 = `(async () => { const svc = await import('./core/services.js');
    return { drafts: svc.getPayroll('2026-09').filter((r) => r.status === 'DRAFT').length,
      notes: svc.listNotifications(1).items.filter((n) => n.kind === 'PAYROLL_DRAFT_READY').length,
      months: svc.listPayrollMonths().filter((m) => m.status === 'DRAFT').map((m) => m.yearMonth) }; })()`;
  const before = await a.evaluate(s9);
  await setClock(a, '2026-10-15T09:00');
  await a.go('#/pay/month/2026-09');
  const after = await a.evaluate(s9);
  check(before.notes === 1 && JSON.stringify(after) === JSON.stringify(before) && JSON.stringify(after.months) === '["2026-09"]',
    'DC-6 at 2026-10-15 there is still one September draft and one PAYROLL_DRAFT_READY notification', `${JSON.stringify(before)} → ${JSON.stringify(after)}`);

  // ---- S10 (spec §10, FR-24, BR-15): the part-time warning on the owner's decision card ----
  await a.viewport(1280, 900);
  await a.fresh('ko');
  await ownerOvertimeWarning(a);
  text = await a.text();
  check(text.includes('최민호님 이번 주 24시간 → 29시간') && text.includes('최민호님은 이번 주 계약보다 13시간 더 일하게 돼요.')
    && await a.evaluate(`!!document.querySelector('.decision-card .notice-warn') && !document.querySelector('[data-approve]').disabled`),
    "S10 the owner's decision card shows Minho 24 → 29 h and the BR-15 warning (13 h beyond contract); 승인하기 stays enabled", text.slice(0, 400));

  // ---- Done criterion 7 ----
  const problemsBefore = page.problems.length;
  for (const name of Object.keys(SCENES)) {
    for (const lang of ['ko', 'en']) {
      for (const width of [1280, 360]) {
        await a.viewport(width, 900);
        await a.fresh(lang);
        await SCENES[name](a);
        await sleep(150);
        const r = await a.audit();
        const label = `DC-7 ${name} ${lang} ${width}px`;
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
