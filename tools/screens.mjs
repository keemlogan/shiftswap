// Reproducible screenshots of ShiftSwap.
//   node tools/screens.mjs review <dir>   every scene at 1280 px and 360 px in English and Korean (1× scale)
//   node tools/screens.mjs report         the report set in docs/img (2× scale; English, plus ko-*.png)
// Every scene starts from a fresh seed (storage cleared) with the demo clock at 2026-09-28T09:00; the S9 scenes
// then move it to 2026-10-01 through Demo tools.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serve, chrome, app, sleep, ROOT } from './lib.mjs';
import { SCENES } from './scenes.mjs';

/** Report screenshots: file name → scene, width, and whether to capture the whole page. */
const REPORT = [
  ['ui-01-signin.png', 'signin', 1280],
  ['ui-02-board-owner.png', 'schedule-owner', 1280],
  ['ui-03-board-worker.png', 'schedule-worker', 1280],
  ['ui-04-request-form.png', 'flow-3', 360],
  ['ui-05-inbox.png', 'worker-home-minho', 360],
  ['ui-06-approval.png', 'owner-home-decision', 1280],
  ['ui-07-my-requests.png', 'swaps-seoyeon-accepted', 360],
  ['ui-08-attendance.png', 'me', 360],
  ['ui-09-weekly.png', 'pay-week', 1280],
  ['ui-10-payroll.png', 'pay-month', 1280],
  ['ui-11-workers.png', 'staff-detail', 1280],
  ['ui-12-settings.png', 'settings', 1280],
  ['ui-13-mobile-board.png', 'schedule-owner', 360],
  ['ui-14-board-handover.png', 'schedule-handover', 1280],
  ['ui-15-korean.png', 'owner-home-decision', 1280, 'ko'],
  ['ui-16-failed-owner.png', 'failed-owner', 1280],
  ['ui-17-payroll-history.png', 'pay-month-history', 1280],
  ['ui-18-payroll-auto.png', 'owner-home-payroll-ready', 1280],
];
const REPORT_KO = [
  ['ko-signin.png', 'signin', 360],
  ['ko-worker-home.png', 'worker-home-minho', 360],
  ['ko-request-review.png', 'flow-3', 360],
  ['ko-owner-home.png', 'owner-home-decision', 360],
  ['ko-board.png', 'schedule-handover', 1280],
  ['ko-payroll.png', 'pay-month', 360],
  ['ko-failed-worker.png', 'failed-worker', 360],
  ['ko-payroll-auto.png', 'owner-home-payroll-ready', 360],
];

/** Capture the whole page: the viewport is made as tall as the page so fixed bars sit at its bottom. */
async function capture(page, a, file, width, scale, maxHeight = 4000) {
  await page.evaluate(`document.getElementById('toast-root').innerHTML = ''`);
  await a.viewport(width, 900, scale);
  await sleep(250);
  const full = await page.evaluate('Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))');
  const height = Math.min(full, maxHeight);
  await a.viewport(width, height, scale);
  await sleep(350);
  const shot = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } });
  writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
  return `${Math.round(width * scale)}x${Math.round(height * scale)}`;
}

async function runScene(page, a, name, lang, width) {
  await a.viewport(width, 900, 1);
  await a.fresh(lang);
  await SCENES[name](a);
  await sleep(200);
}

const mode = process.argv[2] || 'review';
const server = await serve();
const page = await chrome();
const a = app(page, server.url);
try {
  if (mode === 'review') {
    const dir = process.argv[3] || join(ROOT, 'tools', 'out');
    mkdirSync(dir, { recursive: true });
    const only = process.argv[4] ? process.argv[4].split(',') : Object.keys(SCENES);
    for (const name of only) {
      for (const lang of ['en', 'ko']) {
        for (const width of [1280, 360]) {
          await runScene(page, a, name, lang, width);
          const size = await capture(page, a, join(dir, `${name}-${lang}-${width}.png`), width, 1);
          console.log(`${name}-${lang}-${width}.png ${size}`);
        }
      }
    }
  } else {
    const dir = join(ROOT, 'docs', 'img');
    mkdirSync(dir, { recursive: true });
    for (const [file, name, width, lang = 'en'] of [...REPORT, ...REPORT_KO.map((r) => [...r, 'ko'])]) {
      await runScene(page, a, name, lang, width);
      const size = await capture(page, a, join(dir, file), width, 2, width < 900 ? 2400 : 1800);
      console.log(`${file} ${size} (${name}, ${lang}, ${width} px)`);
    }
  }
  if (page.problems.length) console.log(`console problems: ${page.problems.join(' | ')}`);
} finally {
  page.close();
  server.close();
}
