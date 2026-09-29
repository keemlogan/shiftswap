// Headless check of the proposal collaboration in the hub (hub/collab.js) with the browser-local backend:
//   node tools/collab-check.mjs [screenshot dir]
// Two tabs A and B of one Chrome profile open index.html?collab=local&collabDoc=e2e#/r/P-1/0, so they share
// localStorage and navigator.locks the way two team members share the database. B saves first (v2), A saves later
// from the same base (v1.1), then highlights, restore, the Korean view and the print preparation are checked.
// Prints PASS/FAIL per check and exits non-zero on failure. Screenshots at 1280 and 390 px of the history and the
// highlighted view go to the given directory (default: <tmp>/shiftswap-collab-shots).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { serve, chrome, sleep } from './lib.mjs';

let failures = 0;
function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${!ok && detail ? `\n     ${detail}` : ''}`);
  if (!ok) failures++;
  return ok;
}

/** A second tab in the same browser profile; lib.mjs's chrome() connects to the first tab only. */
async function openTab(port, url) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let seq = 0;
  const pending = new Map();
  const problems = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.exceptionThrown') problems.push(`exception: ${msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text}`);
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) problems.push(`console.${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') problems.push(`log: ${msg.params.entry.text} ${msg.params.entry.url || ''}`);
    if (msg.method === 'Page.javascriptDialogOpening') problems.push(`dialog: ${msg.params.type} ${msg.params.message}`);
  });
  const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expr) => {
    const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (res.result.exceptionDetails) throw new Error(`${expr.slice(0, 300)}\n${JSON.stringify(res.result.exceptionDetails).slice(0, 600)}`);
    return res.result.result.value;
  };
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  return { send, evaluate, problems, close: () => ws.close() };
}

/** Page helpers: every state change is awaited with waitFor instead of fixed sleeps. */
function tab(p, name) {
  const t = {
    ...p,
    name,
    async front() { await p.send('Page.bringToFront'); await sleep(150); },
    async waitFor(expr, timeout = 8000) {
      const end = Date.now() + timeout;
      for (;;) {
        const v = await p.evaluate(expr).catch(() => undefined);
        if (v) return v;
        if (Date.now() > end) return false;
        await sleep(100);
      }
    },
    async click(sel) {
      const ok = await p.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el || el.disabled) return false; el.click(); return true; })()`);
      if (!ok) throw new Error(`${name}: cannot click ${sel}`);
    },
    /** Evaluate inside the preview iframe: d = its document, w = its window. */
    frame: (expr) => p.evaluate(`(() => { const f = document.querySelector('.pv-frame'); const d = f.contentDocument, w = f.contentWindow; return (${expr}); })()`),
    text: (sel) => p.evaluate(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`),
    /** Put the caret at the start of an element in the iframe and type like a user. */
    async typeInFrame(sel, text) {
      await p.evaluate(`(() => { const f = document.querySelector('.pv-frame'); const d = f.contentDocument; const el = d.querySelector(${JSON.stringify(sel)});
        const r = d.createRange(); r.setStart(el.firstChild, 0); r.collapse(true); const s = d.getSelection(); s.removeAllRanges(); s.addRange(r); f.contentWindow.focus(); })()`);
      await p.send('Input.insertText', { text });
      await sleep(50);
    },
    async typeName(sel, text) {
      await p.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.focus(); el.select(); })()`);
      await p.send('Input.insertText', { text });
      await sleep(50);
    },
    async viewport(width) {
      await p.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 900 });
      await sleep(350);
    },
    async shot(file, width, sel) {
      await t.viewport(width);
      const r = await p.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
        return { x: Math.floor(b.left + scrollX), y: Math.floor(b.top + scrollY), width: Math.ceil(b.width), height: Math.ceil(b.height) }; })()`);
      const s = await p.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...r, scale: 1 } });
      writeFileSync(file, Buffer.from(s.result.data, 'base64'));
      return `${file} ${r.width}x${r.height}`;
    },
  };
  return t;
}

const MARKS = '.ss-ins, .ss-del, .ss-chg-block, .ss-hunk';
const verLabel = `document.querySelector('.cl-bar .cl-ver')?.textContent`;
const notice = `[...document.querySelectorAll('.cl-msg p')].map((p) => p.textContent).join(' | ')`;
const backend = (body) => `(async () => { const m = await import('./hub/collab.js'); const b = new m.LocalBackend('e2e');
  const vs = await b.listVersions(); const v = (l) => vs.find((x) => x.label === l); ${body} })()`;

const dir = process.argv[2] || join(tmpdir(), 'shiftswap-collab-shots');
mkdirSync(dir, { recursive: true });
const shots = [];
const server = await serve();
const root = server.url.replace(/app\/$/, '');
const url = `${root}index.html?collab=local&collabDoc=e2e#/r/P-1/0`;
const port = 9300 + Math.floor(Math.random() * 500);
const pageA = await chrome({ port });
let pageB;
try {
  const A = tab(pageA, 'A');
  await A.send('Page.navigate', { url });
  check(await A.waitFor(`${verLabel} === 'v1'`, 10000), 'A opens P-1: the toolbar shows v1 seeded from the static document');
  const seed = await A.evaluate(backend(`const h = await b.getHead(); return { n: vs.length, v1: vs[0], head: h,
    same: (await b.getHtml(vs[0].id)).includes('Small stores such as') };`));
  check(seed.n === 1 && seed.v1.kind === 'seed' && seed.v1.author === '초기본' && seed.v1.label === '1' && seed.v1.parent_id === null
    && seed.head.main_count === 1 && seed.same, 'LocalBackend seeds v1 (kind seed, author 초기본) from the static iframe body', JSON.stringify(seed));
  const anchored = await A.frame(`Math.abs(d.getElementById('need').getBoundingClientRect().top) < 40 && w.scrollY > 0`);
  const bar1 = await A.text('.cl-bar');
  check(anchored && bar1.includes('현재본') && bar1.includes('초기본') && (await A.text('.cl-history')).includes('v1'),
    'after replacing the body the iframe is scrolled to #need; toolbar and history show v1 현재본 · 초기본', bar1);

  pageB = await openTab(port, url);
  const B = tab(pageB, 'B');
  check(await B.waitFor(`${verLabel} === 'v1'`, 10000), 'B opens the same page and also sees v1 as the head');

  // ---- A starts editing v1 (unsaved) ----
  await A.front();
  await A.click('[data-act="edit"]');
  await A.waitFor(`document.querySelector('.cl-editing')?.textContent === '편집 중 · v1 기준'`);
  const editA = await A.frame(`({ mode: d.designMode, marks: d.querySelectorAll('${MARKS}').length })`);
  check(editA.mode === 'on' && editA.marks === 0 && await A.evaluate(`document.querySelector('[data-act="save"]').disabled`),
    'A enters edit mode on v1: designMode on, clean English (no highlights), 저장 disabled', JSON.stringify(editA));
  await A.typeInFrame('#s1 + p', 'Edited by A. ');
  const saveA = await A.evaluate(`(() => { const b = document.querySelector('[data-act="save"]'); return { disabled: b.disabled, title: b.title }; })()`);
  check(saveA.disabled && saveA.title === '작업자명을 입력하세요.' && await A.evaluate(`document.querySelector('[data-act="lang"][data-lang="ko"]').disabled`),
    'A typed: 저장 stays disabled until the worker name is entered; 한국어 is disabled while editing', JSON.stringify(saveA));

  // ---- B edits v1 too and saves first → v2 ----
  await B.front();
  await B.click('[data-act="edit"]');
  await B.waitFor(`document.querySelector('.cl-editing')?.textContent === '편집 중 · v1 기준'`);
  await B.typeInFrame('#s2 + p', 'Edited by B. ');
  await B.typeName('.cl-bar [data-author]', 'B');
  await B.waitFor(`!document.querySelector('[data-act="save"]').disabled`);
  await B.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 83 });
  await B.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 83 });
  const savedB = await B.waitFor(`${verLabel} === 'v2' && ${notice}`);
  check(savedB && savedB.includes('v2로 저장했습니다.') && (await B.text('.cl-bar')).includes('현재본') && await B.frame(`d.designMode === 'off'`),
    'B saves with Ctrl+S as "B" → v2 (main): "v2로 저장했습니다.", edit mode ends', savedB);

  // ---- A is told, then saves from v1 → v1.1 ----
  await A.front();   // becoming visible makes A check the head at once (then every 20 s)
  const moved = '편집하는 동안 B님이 v2를 저장했습니다. 지금 저장하면 v1.1(분기)로 따로 저장됩니다.';
  const movedShown = await A.waitFor(`${notice}.includes(${JSON.stringify(moved)})`);
  check(movedShown && await A.frame(`d.designMode === 'on' && d.querySelector('#s1 + p').textContent.startsWith('Edited by A.')`),
    `A (still editing) sees: ${moved} — A's unsaved text is untouched`, await A.evaluate(notice));
  await A.typeName('.cl-bar [data-author]', 'A');
  await A.click('[data-act="save"]');
  const branch = '다른 작업자가 먼저 v2를 저장해서, 이번 수정은 v1.1로 따로 저장했습니다. 형광펜으로 표시된 v1.1의 변경 내용을 확인한 뒤 현재본에 다시 반영하거나 v1.1을 복원하세요.';
  const branchShown = await A.waitFor(`${verLabel} === 'v1.1' && ${notice}.includes(${JSON.stringify(branch)})`);
  check(branchShown && (await A.text('.cl-bar')).includes('분기'), 'A saves as "A" → v1.1 (branch) with the branch notice', await A.evaluate(notice));

  const tree = await A.evaluate(`[...document.querySelectorAll('.cl-tree > li')].map((li) => ({
    label: li.querySelector(':scope > .cl-entry .cl-label').textContent,
    chips: [...li.querySelectorAll(':scope > .cl-entry .cl-chip')].map((c) => c.textContent),
    kids: [...li.querySelectorAll(':scope > ol > li > .cl-entry .cl-label')].map((c) => c.textContent),
    restore: !!li.querySelector(':scope > .cl-entry [data-act="ask-restore"]') }))`);
  check(JSON.stringify(tree) === JSON.stringify([
    { label: 'v2', chips: ['현재본'], kids: [], restore: false },
    { label: 'v1', chips: ['초기본'], kids: ['v1.1'], restore: true },
  ]) && await A.evaluate(`document.querySelector('.cl-tree li[aria-current="true"] .cl-label').textContent === 'v1.1'`),
  'history: v2 (현재본, no 복원) first, v1.1 under v1, the viewed v1.1 is aria-current', JSON.stringify(tree));

  // ---- Highlights ----
  await A.click('[aria-label="v2 조회"]');
  const insV2 = await A.waitFor(`${verLabel} === 'v2' && (() => { const d = document.querySelector('.pv-frame').contentDocument;
    return [...d.querySelectorAll('.ss-ins')].map((e) => e.textContent).join('|'); })()`);
  const count2 = await A.text('.cl-count');
  check(insV2 && insV2.includes('Edited by B') && count2 === '변경 1곳', 'viewing v2 highlights B\'s words with .ss-ins (변경 1곳)', `${insV2} / ${count2}`);
  await A.click('[data-act="next"]');
  check(await A.waitFor(`(() => { const f = document.querySelector('.pv-frame'); const r = f.contentDocument.querySelector('.ss-hunk').getBoundingClientRect(); return r.top >= 0 && r.bottom <= f.contentWindow.innerHeight; })()`),
    '다음 변경 scrolls the iframe to the highlight');
  await A.click('[data-act="marks"]');
  const off = await A.waitFor(`document.querySelector('[data-act="marks"]').getAttribute('aria-pressed') === 'false'
    && document.querySelector('.pv-frame').contentDocument.querySelectorAll('${MARKS}').length === 0`);
  check(off && await A.evaluate(`localStorage.getItem('ss.collab.marks') === '0' && !document.querySelector('.cl-count')`),
    '변경 표시 off leaves 0 highlight elements and is remembered');
  await A.click('[data-act="marks"]');
  check(await A.waitFor(`document.querySelector('.pv-frame').contentDocument.querySelectorAll('.ss-ins').length > 0`), '변경 표시 on brings the highlights back');

  await A.click('[aria-label="v1.1 조회"]');
  const nonHead = await A.waitFor(`${verLabel} === 'v1.1' && ${notice}.includes('v1.1 조회 중입니다(현재본 v2 아님).')
    && [...document.querySelector('.pv-frame').contentDocument.querySelectorAll('.ss-ins')].some((e) => e.textContent.includes('Edited by A'))`);
  check(nonHead && await A.evaluate(`!!document.querySelector('.cl-msg [data-act="show-head"]') && !!document.querySelector('.cl-msg [data-act="ask-restore"]')`),
    'viewing v1.1 shows the banner "v1.1 조회 중입니다(현재본 v2 아님)." with 현재본 보기 / 이 버전 복원 and A\'s highlighted words');

  // ---- Restore v1.1 → v3 ----
  await A.click('[aria-label="v1.1 복원"]');
  const ask = await A.waitFor(`document.querySelector('.cl-history .cl-confirm p')?.textContent`);
  await A.evaluate(`(() => { const i = document.querySelector('.cl-history .cl-confirm [data-author]'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await A.click('.cl-history .cl-confirm [data-act="restore"]');
  await sleep(200);
  const blocked = await A.evaluate(`document.activeElement === document.querySelector('.cl-history .cl-confirm [data-author]')`);
  const stillFour = (await A.evaluate(backend('return vs.length;'))) === 3;
  await A.typeName('.cl-history .cl-confirm [data-author]', 'A');
  await A.click('.cl-history .cl-confirm [data-act="restore"]');
  await A.waitFor(`${verLabel} === 'v3'`);
  const restored = await A.evaluate(backend(`const h = await b.getHead(); return { head: h, v3: v('3'), same: (await b.getHtml(v('3').id)) === (await b.getHtml(v('1.1').id)),
    ids: { v2: v('2').id, v11: v('1.1').id } };`));
  const chips3 = await A.evaluate(`[...document.querySelectorAll('.cl-tree > li:first-child > .cl-entry .cl-chip')].map((c) => c.textContent).join(',')`);
  check(ask === 'v1.1의 내용으로 새 현재본(v3)을 만듭니다.' && blocked && stillFour
    && restored.v3.is_main && restored.v3.kind === 'restore' && restored.v3.restored_from === restored.ids.v11 && restored.v3.parent_id === restored.ids.v2
    && restored.head.head_id === restored.v3.id && restored.same && chips3 === '현재본,복원: v1.1',
  'restore v1.1 (inline confirm, name required) → v3 main whose html equals v1.1', JSON.stringify({ ask, blocked, stillFour, restored, chips3 }));
  const hl3 = await A.frame(`({ ins: d.querySelectorAll('.ss-ins').length, del: d.querySelectorAll('.ss-del').length })`);
  check(hl3.ins > 0 && hl3.del > 0, 'v3 is compared with its parent v2: A\'s words inserted, B\'s words struck through', JSON.stringify(hl3));
  shots.push(await A.shot(join(dir, 'history-1280.png'), 1280, '.cl-history'));
  shots.push(await A.shot(join(dir, 'history-390.png'), 390, '.cl-history'));
  await A.viewport(1280);

  // ---- B: told about v3; a stale restore is refused (HEAD_CHANGED) ----
  await B.front();
  const newer = await B.waitFor(`${notice}.includes('새 버전 v3(A)이 저장되었습니다.')`);
  check(newer && await B.evaluate(`!!document.querySelector('[data-act="load-newer"]')`), 'B (viewing v2) is told "새 버전 v3(A)이 저장되었습니다." with 불러오기');
  await B.click('[aria-label="v1 복원"]');
  await B.waitFor(`!!document.querySelector('.cl-history .cl-confirm')`);
  await B.typeName('.cl-history .cl-confirm [data-author]', 'B');
  await B.click('.cl-history .cl-confirm [data-act="restore"]');
  const refused = await B.waitFor(`${notice}.includes('복원하지 않았습니다')`);
  check(refused && (await B.evaluate(backend('return vs.length;'))) === 4, 'B restoring v1 with a stale head gets HEAD_CHANGED: nothing saved, B is told and the history reloads', await B.evaluate(notice));
  await B.click('[data-act="load-newer"]');
  check(await B.waitFor(`${verLabel} === 'v3' && !document.querySelector('[data-act="load-newer"]')`), '불러오기 shows v3 in B');

  // ---- Korean view ----
  await A.front();
  await A.evaluate('delete window.Translator');   // headless Chrome exposes the API (model "downloadable"); test the path without it
  await A.click('[data-act="lang"][data-lang="ko"]');
  const missing = '이 버전의 한국어 번역이 아직 없습니다. 데스크톱 Chrome에서 열면 자동 번역을 만들 수 있습니다.';
  const koNone = await A.waitFor(`${notice}.includes(${JSON.stringify(missing)})`);
  const editKo = await A.evaluate(`(() => { const b = document.querySelector('[data-act="edit"]'); return { disabled: b.disabled, title: b.title }; })()`);
  check(koNone && editKo.disabled && editKo.title === '편집은 영어 원문에서만 할 수 있습니다.',
    'Korean without a translation (no Translator API): the message, 편집 disabled with its tooltip', JSON.stringify(editKo));
  const inserted = await A.evaluate(backend(`const d = new DOMParser().parseFromString('<!doctype html><body>' + await b.getHtml(v('3').id), 'text/html');
    const segs = m.blockSegments(d.body);
    m.applySegments(d.body, segs.map((s, i) => '한국어 문단 ' + (i + 1)));
    await b.addTranslation({ versionId: v('3').id, lang: 'ko', engine: 'claude', html: m.sanitize(d.body.innerHTML) });
    return { segs: segs.length, stored: (await b.getTranslation(v('3').id))?.engine };`));
  await A.click('[data-act="lang"][data-lang="en"]');
  await A.waitFor(`document.querySelector('[data-lang="en"]').getAttribute('aria-pressed') === 'true' && !document.querySelector('.cl-chip.is-ko')`);
  await A.click('[data-act="lang"][data-lang="ko"]');
  const koShown = await A.waitFor(`!!document.querySelector('.cl-chip.is-ko')`);
  const ko = await A.frame(`({ lang: d.documentElement.lang, text: d.body.textContent.includes('한국어 문단 1'), english: d.body.textContent.includes('Small stores such as'),
    keepAll: w.getComputedStyle(d.body).wordBreak, blocks: d.querySelectorAll('.ss-chg-block').length,
    s1: d.querySelector('#s1 + p').classList.contains('ss-chg-block'), s2: d.querySelector('#s2 + p').classList.contains('ss-chg-block') })`);
  const koBar = await A.text('.cl-bar');
  const editKo2 = await A.evaluate(`document.querySelector('[data-act="edit"]').disabled`);
  check(koShown && inserted.stored === 'claude' && ko.lang === 'ko' && ko.text && !ko.english && ko.keepAll === 'keep-all'
    && koBar.includes('한국어 번역 · 읽기 전용') && koBar.includes('Claude 번역') && editKo2,
  'after a translation (engine claude) is added through the backend: Korean shown read-only (lang ko, keep-all, Claude 번역), 편집 disabled', JSON.stringify({ inserted, ko, koBar }));
  check(ko.blocks === 2 && ko.s1 && ko.s2 && (await A.text('.cl-count')) === '변경 2곳',
    'changed blocks are marked in Korean: the paragraphs A and B edited (.ss-chg-block, 변경 2곳)', JSON.stringify(ko));

  // ---- PDF 저장: clean HTML, title, then back to the highlighted view ----
  await A.frame(`(w.print = () => { window.parent.__printed = (window.parent.__printed || 0) + 1; }, true)`);   // headless: no print dialog
  await A.click('[data-act="print"]');
  await A.waitFor('window.__printed === 1');
  const printKo = await A.frame(`({ marks: d.querySelectorAll('${MARKS}').length, title: d.title, ko: d.body.textContent.includes('한국어 문단 1') })`);
  await A.frame(`w.dispatchEvent(new Event('afterprint'))`);
  const backKo = await A.waitFor(`document.querySelector('.pv-frame').contentDocument.querySelectorAll('.ss-chg-block').length === 2
    && document.querySelector('.pv-frame').contentDocument.title === 'ShiftSwap Project Proposal'`);
  check(printKo.marks === 0 && printKo.title === 'ShiftSwap_Proposal_v3_KO' && printKo.ko && backKo,
    'PDF 저장 (한국어): print preparation renders 0 .ss-* elements, title ShiftSwap_Proposal_v3_KO; afterprint restores the marks', JSON.stringify(printKo));
  await A.click('[data-act="lang"][data-lang="en"]');
  await A.waitFor(`document.querySelector('.pv-frame').contentDocument.querySelectorAll('.ss-ins').length > 0`);
  await A.click('[data-act="print"]');
  await A.waitFor('window.__printed === 2');
  const printEn = await A.frame(`({ marks: d.querySelectorAll('${MARKS}').length, title: d.title, lang: d.documentElement.lang })`);
  await A.frame(`w.dispatchEvent(new Event('afterprint'))`);
  const backEn = await A.waitFor(`document.querySelector('.pv-frame').contentDocument.querySelectorAll('.ss-ins').length > 0`);
  check(printEn.marks === 0 && printEn.title === 'ShiftSwap_Proposal_v3_EN' && printEn.lang === 'en' && backEn
    && (await A.evaluate(`document.querySelector('[data-act="print"]').title`)) === "인쇄 창에서 대상을 'PDF로 저장'으로 선택하세요.",
  'PDF 저장 (EN): 0 .ss-* elements, title ShiftSwap_Proposal_v3_EN, highlights back after printing; the button explains PDF로 저장', JSON.stringify(printEn));

  // ---- Block model and sanitizer on the real document ----
  const model = await A.evaluate(backend(`const parse = (h) => new DOMParser().parseFromString('<!doctype html><body>' + h, 'text/html');
    const clean = parse(m.sanitize(await b.getHtml(v('3').id)));
    const diff = parse(m.diffHtml(m.sanitize(await b.getHtml(v('2').id)), m.sanitize(await b.getHtml(v('3').id))).html);
    const segs = m.blockSegments(clean.body);
    const links = clean.querySelectorAll('nav.toc a[href]').length;
    m.applySegments(clean.body, segs.map((s, i) => 'T' + i));
    const after = m.blockSegments(clean.body).map((s) => s.text);
    const dirty = m.sanitize('<p id="need" class="c" style="color:red" data-x="1" onclick="x()">a<script>1<\/script><iframe></iframe><form><input></form><td colspan="2" rowspan="3">t</td></p>');
    return { clean: segs.length, diff: m.blockSegments(diff.body, { ignore: '.ss-del' }).length, round: after.length === segs.length && after.every((t, i) => t === 'T' + i),
      links, linksAfter: clean.querySelectorAll('nav.toc a[href]').length, dirty };`));
  check(model.clean > 100 && model.clean === model.diff && model.round && model.links === model.linksAfter && model.links > 10,
    `block model: ${model.clean} blocks in the clean v3 DOM and in its diff DOM (ignoring .ss-del); applySegments round-trips and keeps the TOC links`, JSON.stringify(model));
  check(!/script|iframe|form|input|onclick|data-x/.test(model.dirty) && /id="need"/.test(model.dirty) && /style="color:red"/.test(model.dirty),
    'sanitize removes script/iframe/form/input, event handlers and data-* but keeps id, class and style', model.dirty);

  // ---- Cancel with unsaved edits: inline confirm, nothing saved ----
  await A.click('[data-act="edit"]');
  await A.waitFor(`document.querySelector('.cl-editing')?.textContent === '편집 중 · v3 기준'`);
  await A.typeInFrame('#s3-1 + p', 'Throwaway text. ');
  await A.click('[data-act="cancel"]');
  const askCancel = await A.waitFor(`${notice}.includes('저장하지 않은 수정 내용을 버립니다.')`);
  await A.click('[data-act="discard"]');
  const discarded = await A.waitFor(`${verLabel} === 'v3' && !document.querySelector('.pv-frame').contentDocument.body.textContent.includes('Throwaway text.')`);
  check(askCancel && discarded && await A.frame(`d.designMode === 'off'`) && (await A.evaluate(backend('return vs.length;'))) === 4,
    '취소 with unsaved edits asks inline (no dialog), 버리기 restores v3 and saves nothing');

  // ---- Highlighted view screenshots ----
  await A.click('[data-act="next"]');
  await sleep(200);
  shots.push(await A.shot(join(dir, 'view-1280.png'), 1280, '.dpreview'));
  shots.push(await A.shot(join(dir, 'view-390.png'), 390, '.dpreview'));
  await A.viewport(1280);

  // ---- Other routes are unchanged ----
  await A.evaluate(`location.hash = '#/r/P-5/0'`);
  const img = await A.waitFor(`!!document.querySelector('.pv-img img') && !document.querySelector('.cl-bar') && !document.querySelector('.cl-history')`);
  await A.evaluate(`location.hash = '#/r/P-5/1'`);
  const wbs = await A.waitFor(`document.querySelector('.cl-bar .cl-ver')?.textContent === 'v3'`);
  await A.evaluate(`location.hash = '#w5'`);
  const list = await A.waitFor(`!!document.querySelector('.board') && !document.querySelector('.cl-bar') && document.querySelectorAll('.rows .row').length > 30`);
  check(img && wbs && list, 'P-5 image tab has no collab UI, the P-5 proposal tab (#wbs) gets it, the list view renders without it');

  check(pageA.problems.length === 0 && pageB.problems.length === 0, 'no console errors, exceptions or dialogs in either tab',
    [...pageA.problems.map((x) => `A ${x}`), ...pageB.problems.map((x) => `B ${x}`)].join(' | '));
} catch (err) {
  check(false, 'the check ran to the end', err.stack || String(err));
} finally {
  pageB?.close();
  pageA.close();
  server.close();
}
for (const s of shots) console.log(`screenshot ${s}`);
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;
