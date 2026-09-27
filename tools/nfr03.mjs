// NFR-03 measurement: with 20 workers and 12 weeks of shifts, time from a route change to the rendered and
// painted screen for the schedule, the weekly summary and the monthly payroll.
//   node tools/nfr03.mjs
// The extra data is created through the services in a throwaway browser profile; the seed is not changed.
import { execSync } from 'node:child_process';
import { serve, chrome, app, sleep } from './lib.mjs';

const server = await serve();
const page = await chrome();
const a = app(page, server.url);
const { evaluate, send } = page;
try {
  await a.viewport(1280, 800);
  await a.fresh('en');

  const setup = await evaluate(`(async () => {
    const svc = await import('./core/services.js');
    const { now } = await import('./core/clock.js');
    const t0 = performance.now();
    const patterns = [
      [[1, '09:00', '14:00'], [3, '09:00', '14:00'], [5, '09:00', '14:00']],
      [[2, '14:00', '19:00'], [4, '14:00', '19:00']],
      [[6, '08:00', '13:00'], [7, '13:00', '18:00']],
      [[1, '17:00', '22:00'], [2, '17:00', '22:00'], [3, '17:00', '22:00']],
    ];
    for (let i = 0; i < 16; i++) {
      const id = svc.registerWorker({ name: 'Load Worker' + String(i + 1).padStart(2, '0'), phone: '010-9000-' + String(1000 + i),
        hourlyWage: 10320 + (i % 4) * 100, contractStart: '2026-03-02', contractEnd: '', probationEnd: '', simpleLabor: i % 3 === 0, active: true });
      svc.saveFixedSchedule(id, patterns[i % 4].map(([weekday, startTime, endTime]) => ({ weekday, startTime, endTime })));
      svc.saveAvailability(id, [{ weekday: ((i + 2) % 7) + 1, startTime: '09:00', endTime: '23:00' }]);
    }
    const weeks = [];
    for (let d = new Date(Date.UTC(2026, 7, 10)), k = 0; k < 12; k++, d.setUTCDate(d.getUTCDate() + 7)) weeks.push(d.toISOString().slice(0, 10));
    for (const w of weeks) svc.generateWeek(w);
    let recorded = 0;
    for (const w of weeks) for (const s of svc.getWeekShifts(w)) {
      if (s.workDate + 'T' + s.startTime >= now() || s.status !== 'SCHEDULED') continue;
      svc.recordAttendance(s.id, s.workerId, s.startTime, s.endTime);
      svc.confirmAttendance(s.id);
      recorded++;
    }
    svc.generatePayroll('2026-09');
    return {
      workers: svc.listWorkers().filter((w) => w.role === 'WORKER').length, weeks: weeks.length, shifts: weeks.reduce((n, w) => n + svc.getWeekShifts(w).length, 0),
      recorded, dbKB: Math.round((localStorage.getItem('shiftswap.db.v1') || '').length * 3 / 4 / 1024), setupMs: Math.round(performance.now() - t0),
    };
  })()`);
  await a.signIn(1, '#/home');

  const measure = (hash, marker) => evaluate(`(async () => {
    location.hash = '#/notifications';
    await new Promise((r) => setTimeout(r, 120));
    return await new Promise((resolve) => {
      const t0 = performance.now();
      window.addEventListener('hashchange', () => {
        const dom = performance.now() - t0;
        const ok = !!document.querySelector(${JSON.stringify(marker)});
        requestAnimationFrame(() => requestAnimationFrame(() => resolve({ dom, paint: performance.now() - t0, ok })));
      }, { once: true });
      location.hash = ${JSON.stringify(hash)};
    });
  })()`);
  const screens = [
    ['Schedule (owner), week of 09-28', '#/schedule/2026-09-28', '.board .shift'],
    ['Pay → Weekly, week of 09-21', '#/pay/week/2026-09-21', '.pay-card'],
    ['Pay → Monthly, September 2026', '#/pay/month/2026-09', '.pay-table tbody tr'],
  ];
  const results = [];
  for (const [label, hash, marker] of screens) {
    await measure(hash, marker);
    const runs = [];
    for (let i = 0; i < 10; i++) runs.push(await measure(hash, marker));
    const items = await evaluate(`document.querySelectorAll(${JSON.stringify(marker)}).length`);
    const stat = (k) => { const v = runs.map((r) => r[k]).sort((x, y) => x - y); return { median: +v[5].toFixed(1), max: +v[9].toFixed(1) }; };
    results.push({ label, hash, items, ok: runs.every((r) => r.ok), dom: stat('dom'), paint: stat('paint') });
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `new MutationObserver((_, o) => { if (document.querySelector('.board .shift')) { window.__at = performance.now(); o.disconnect(); } }).observe(document, { childList: true, subtree: true });` });
  await a.go('#/schedule/2026-09-28');
  const cold = [];
  for (let i = 0; i < 5; i++) {
    await send('Page.reload', {});
    await sleep(2500);
    cold.push(await evaluate('Math.round(window.__at)'));
  }
  cold.sort((x, y) => x - y);
  let cpu = '';
  try { cpu = execSync('sysctl -n machdep.cpu.brand_string').toString().trim(); } catch { cpu = 'unknown'; }
  console.log(JSON.stringify({ cpu, chrome: page.version, setup, results, cold, problems: page.problems }, null, 2));
} finally {
  page.close();
  server.close();
}
