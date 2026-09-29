// Print check of the hub's PDF 저장 (hub/collab.js) for the editable documents:
//   node tools/print-check.mjs [proposal] [interim] [final-report]      (default: all three; KEEP=1 keeps the PDFs)
// For each document it prints, with headless Chrome WITH the browser's header and footer (date, title, URL, n/N),
//   1. a copy of the static document with the hub's frame CSS (FRAME_CSS, appended to <head> the way the hub does it,
//      and the print title the hub sets), and
//   2. a control: the static document as it is (its own @page margins).
// PASS when the hub copy has the same page count as the control (the control has the page count of the build
// command in tools/build.py; the built PDF in docs/ is also compared but may be older than the HTML), no page of the
// hub copy has browser header/footer text in its first or last lines, and the top and bottom strips of every page
// are blank. The control must show the header/footer text and ink in the strips, otherwise the detector is broken.
// WARN when something in the document is wider than the text column: Chrome then shrinks the whole built PDF (the
// hub's copy is not shrunk the same way), which is the usual reason for different page counts. To try a fix of the
// document's CSS without editing it: DOC_CSS='img{max-width:100%;box-sizing:border-box}' node tools/print-check.mjs
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { FRAME_CSS } from '../hub/collab.js';
import { EDITABLE } from '../hub/collab-config.js';
import { chrome, sleep } from './lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const STRIP_IN = 0.8;   // blank strip at the top and bottom of every page (the hub prints with a 1-inch padding)
const DPI = 30;
const docs = process.argv.slice(2).length ? process.argv.slice(2) : ['proposal', 'interim', 'final-report'];
const tmp = mkdtempSync(join(tmpdir(), 'shiftswap-print-'));
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });

// Chrome with its own profile writes the PDF and then does not always exit: wait for the message, then stop it.
async function print(htmlFile, pdfFile) {
  const t0 = Date.now();
  const p = spawn(CHROME, ['--headless=new', '--disable-gpu', '--lang=en-US', `--user-data-dir=${join(tmp, 'profile')}`, '--no-first-run',
    '--virtual-time-budget=15000', `--print-to-pdf=${pdfFile}`, pathToFileURL(htmlFile).href], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`Chrome did not print ${htmlFile} in 4 minutes`)), 240000);
    const on = (b) => { log += b; if (/bytes written to file/.test(log)) { clearTimeout(timer); done(); } };
    p.stdout.on('data', on);
    p.stderr.on('data', on);
    p.on('exit', () => { clearTimeout(timer); /bytes written to file/.test(log) ? done() : fail(new Error(`Chrome failed: ${log.slice(-400)}`)); });
  }).finally(() => p.kill());
  return Date.now() - t0;
}
const pages = (pdf) => Number(/Pages:\s+(\d+)/.exec(run('pdfinfo', [pdf]))[1]);

/** Pages whose first or last text lines look like a browser header/footer: the URL/path, the title, a date, n/N. */
function headerPages(pdf, { title, file }) {
  const out = [];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pats = [
    /file:\/\/\/\S/i, new RegExp(esc(file.split('/').pop())), new RegExp(esc(title)),
    /\b\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}/,   // en-US date of the header (9/29/26, 8:45 PM)
    /\b\d{2,4}\.\s?\d{1,2}\.\s?\d{1,2}\.\s+(오[전후]\s*)?\d{1,2}:\d{2}/,   // ko-KR date of the header (26. 9. 29. 오후 8:41)
  ];
  // Chrome's footer ends with <page>/<pages> (e.g. 7/18); a body line such as "a confirmed 0/1" is not one.
  const pageNo = (l, i, n) => { const m = /(?:^|\s)(\d{1,4})\/(\d{1,4})\s*$/.exec(l); return !!m && +m[1] === i + 1 && +m[2] === n; };
  run('pdftotext', ['-layout', pdf, join(tmp, 'text.txt')]);
  const all = readFileSync(join(tmp, 'text.txt'), 'utf8').split('\f');
  const n = all.length - (all.at(-1).trim() ? 0 : 1);
  all.forEach((page, i) => {
    const lines = page.split('\n').map((l) => l.trim()).filter(Boolean);
    const edge = [...lines.slice(0, 2), ...lines.slice(-2)];
    const hit = edge.find((l) => pats.some((p) => p.test(l)) || pageNo(l, i, n));
    if (hit) out.push({ page: i + 1, line: hit.slice(0, 90) });
  });
  return out;
}

/** Pages with non-white pixels in the top or bottom strip (rendered in grey at DPI). */
function inkPages(pdf) {
  const prefix = join(tmp, `ink-${Date.now()}`);
  run('pdftoppm', ['-r', String(DPI), '-gray', pdf, prefix]);
  const files = readdirSync(tmp).filter((f) => f.startsWith(prefix.split('/').pop()) && f.endsWith('.pgm')).sort();
  const hits = [];
  files.forEach((f, i) => {
    const buf = readFileSync(join(tmp, f));
    // binary PGM: P5\n<w> <h>\n<max>\n<data>
    const head = buf.subarray(0, 40).toString('latin1').split(/\s+/);
    const w = Number(head[1]), h = Number(head[2]);
    const data = buf.subarray(buf.length - w * h);
    const strip = Math.floor(STRIP_IN * DPI);
    let ink = 0;
    for (const [y0, y1] of [[0, strip], [h - strip, h]]) {
      for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) if (data[y * w + x] < 235) ink++;
    }
    if (ink) hits.push(i + 1);
    rmSync(join(tmp, f));
  });
  return hits;
}

/**
 * Chrome shrinks the whole printout when anything is wider than the text column (it lays the page out wider and
 * scales it down). Returns the layout width of the document in print media at the column width, and the widest
 * elements. Only the document itself (control copy) is measured.
 */
async function overflow(page, file) {
  await page.send('Page.navigate', { url: pathToFileURL(file).href });
  for (let i = 0; i < 300 && (await page.evaluate('document.readyState').catch(() => '')) !== 'complete'; i++) await sleep(100);
  await sleep(800);
  return page.evaluate(`(() => { const W = document.documentElement.clientWidth, out = [];
    for (const el of document.body.querySelectorAll('*')) {
      const b = el.getBoundingClientRect();
      if (b.right > W + 1 && !out.some((o) => o.el.contains(el))) out.push({ el, right: Math.round(b.right) });
    }
    out.sort((a, b) => b.right - a.right);
    return { W, width: document.documentElement.scrollWidth, widest: out.slice(0, 3).map(({ el, right }) =>
      \`\${el.localName} \${right} px "\${(el.textContent || el.getAttribute('src') || '').trim().replace(/\\s+/g, ' ').slice(0, 50)}"\`) }; })()`);
}

let failed = 0;
const say = (ok, text) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${text}`); };
const page = await chrome();
try {
  for (const name of docs) {
    const rel = `docs/${name}.html`;
    const cfg = EDITABLE[rel];
    if (!cfg) { say(false, `${name}: ${rel} is not editable in hub/collab-config.js`); continue; }
    // One snapshot of the document for both prints (the HTML may be rebuilt meanwhile). DOC_CSS (optional) is added
    // to both copies, to try a fix of the document's own CSS before editing it.
    const base = `<base href="${pathToFileURL(join(ROOT, 'docs')).href}/">`;
    const html = readFileSync(join(ROOT, rel), 'utf8').replace(/<head>/i, `<head>${base}`)
      .replace(/<\/head>/i, `${process.env.DOC_CSS ? `<style>${process.env.DOC_CSS}</style>` : ''}</head>`);
    // The hub appends FRAME_CSS to <head> and sets the print title ShiftSwap_<name>_v<label>_EN (v1 here).
    const title = `ShiftSwap_${cfg.name.replace(/^Project\s+/, '').replace(/\s+/g, '_')}_v1_EN`;
    const hub = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`)
      .replace(/<\/head>/i, `<style id="ss-collab-style">${process.env.PRINT_CSS ?? FRAME_CSS}</style></head>`);
    const ctlFile = join(tmp, `${name}.html`), hubFile = join(tmp, `${name}-hub.html`);
    const ctlPdf = join(tmp, `${name}-control.pdf`), hubPdf = join(tmp, `${name}-hub.pdf`);
    writeFileSync(ctlFile, html);
    writeFileSync(hubFile, hub);
    await print(ctlFile, ctlPdf);
    const ms = await print(hubFile, hubPdf);
    const n = pages(hubPdf), control = pages(ctlPdf);
    let built = null;
    try { built = pages(join(ROOT, `docs/${name}.pdf`)); } catch { /* not built */ }
    const ctlTitle = (/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1].trim() || name).replace(/&amp;/g, '&');
    const hdr = headerPages(hubPdf, { title, file: hubFile });
    const ink = inkPages(hubPdf);
    const ctlHdr = headerPages(ctlPdf, { title: ctlTitle, file: ctlFile });
    const ctlInk = inkPages(ctlPdf);
    console.log(`${name}: hub print ${n} pages in ${(ms / 1000).toFixed(1)} s; control (own @page margins) ${control}; built docs/${name}.pdf ${built ?? 'missing'}`);
    // A4 with the documents' 1-inch margins: a 6.27 in (602 px) text column.
    await page.send('Emulation.setDeviceMetricsOverride', { width: 602, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setEmulatedMedia', { media: 'print' });
    const o = await overflow(page, ctlFile);
    if (o.width > o.W) {
      console.log(`WARN ${name}: the document is ${o.width} px wide in print layout, wider than its ${o.W} px text column, so Chrome`
        + ` prints it (the built PDF) scaled to ${((100 * o.W) / o.width).toFixed(1)}%; PDF 저장 lays the overflow into the 1-inch padding and`
        + ` prints at 100%, so the page counts can differ. Widest: ${o.widest.join('; ')}`);
    }
    say(n === control, `${name}: PDF 저장 page count ${n} = control ${control}`);
    if (built != null && built !== control) console.log(`WARN ${name}: built docs/${name}.pdf has ${built} pages, the current HTML prints ${control} (rebuild the PDF)`);
    else if (built != null) say(n === built, `${name}: PDF 저장 page count ${n} = built docs/${name}.pdf ${built}`);
    say(hdr.length === 0, `${name}: no browser header/footer text on any of ${n} pages${hdr.length ? ` (${hdr.length} pages, e.g. p.${hdr[0].page}: "${hdr[0].line}")` : ''}`);
    say(ink.length === 0, `${name}: top and bottom ${STRIP_IN} in of every page blank${ink.length ? ` (ink on pages ${ink.slice(0, 8).join(', ')}${ink.length > 8 ? ' …' : ''})` : ''}`);
    say(ctlHdr.length === control && ctlInk.length === control,
      `${name}: detector sanity: the control shows header/footer text on ${ctlHdr.length}/${control} pages and ink in the strips on ${ctlInk.length}/${control}`);
  }
} finally {
  page.close();
  if (process.env.KEEP) console.log(`kept ${tmp}`); else rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `\nFAIL (${failed} check(s) failed)` : '\nPASS');
process.exitCode = failed ? 1 : 0;
