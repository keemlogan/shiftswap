// Shared helpers for the headless checks and screenshots: a static file server for the repository root and a
// small Chrome DevTools Protocol client. Requires Google Chrome (set CHROME to its path on non-macOS systems).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

export const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Serve the repository root on a free port; resolves to { url, close }. */
export function serve() {
  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = normalize(join(ROOT, path));
      if (!file.startsWith(ROOT)) throw new Error('outside root');
      await stat(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ url: `http://127.0.0.1:${server.address().port}/app/`, close: () => server.close() });
  }));
}

/**
 * Launch headless Chrome with an English (en-US) system locale so native date/time inputs read the same on every
 * machine, and connect to its first page. Returns { send, evaluate, on, problems, close, version }.
 */
export async function chrome({ port = 9300 + Math.floor(Math.random() * 500) } = {}) {
  const bin = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const proc = spawn(bin, [
    '--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'shiftswap-'))}`,
    '--no-first-run', '--hide-scrollbars', '--lang=en-US', '-AppleLanguages', '(en-US)',
  ], { stdio: 'ignore', env: { ...process.env, LANG: 'en_US.UTF-8' } });
  let targets;
  for (let i = 0; i < 60 && !targets; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); }
  }
  const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).Browser;
  const ws = new WebSocket(targets.find((x) => x.type === 'page').webSocketDebuggerUrl);
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
  await send('Emulation.setLocaleOverride', { locale: 'en-US' });
  return { send, evaluate, problems, version, close: () => { ws.close(); proc.kill(); } };
}

/** App-level helpers on top of a page. */
export function app(page, base) {
  const { send, evaluate } = page;
  const api = {
    evaluate,
    async viewport(width, height = 900, scale = 1) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: width < 900 });
    },
    /** Fresh seed: clear storage, set the language, reload on the sign-in screen. */
    async fresh(lang = 'en') {
      await send('Page.navigate', { url: `${base}#/login` });
      await sleep(900);
      await evaluate(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('shiftswap.lang', '${lang}'); history.replaceState(null, '', '#/login')`);
      await send('Page.reload', { ignoreCache: true });
      await sleep(1400);
    },
    async go(hash) {
      await evaluate(`location.hash = ${JSON.stringify(hash)}`);
      await sleep(260);
    },
    async click(sel) {
      const ok = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
      if (!ok) throw new Error(`missing ${sel}`);
      await sleep(280);
    },
    async signIn(id, hash = '#/home') {
      await evaluate(`document.getElementById('toast-root').innerHTML = ''; sessionStorage.setItem('shiftswap.user', '${id}')`);
      await api.go('#/login');
      await api.go(hash);
      await evaluate('dispatchEvent(new HashChangeEvent("hashchange"))');
      await sleep(250);
    },
    text: (sel = '#view') => evaluate(`(document.querySelector(${JSON.stringify(sel)}) || document.body).innerText`),
    /**
     * Done criterion 5 on the current screen: filled primary buttons that are visible, disabled buttons and
     * whether each has a visible reason, and interactive elements smaller than 44 × 44 px.
     */
    audit: () => evaluate(`(() => {
      const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[inert]'); };
      const primaries = [...document.querySelectorAll('.btn-primary')].filter(visible).map((b) => b.innerText.trim());
      const disabled = [...document.querySelectorAll('button[disabled], [aria-disabled="true"]')].filter(visible).map((b) => {
        const id = b.getAttribute('aria-describedby');
        const reason = id && document.getElementById(id);
        return { label: b.innerText.trim(), reason: reason && visible(reason) ? reason.innerText.trim() : '' };
      });
      const small = [...document.querySelectorAll('button, a[href], input, select, summary, [role="tab"], label.chip-option')].filter(visible).filter((el) => {
        // A radio, checkbox or switch inside a label is hit through the whole label row, which is measured instead.
        if (el.matches('input[type="radio"], input[type="checkbox"]') && el.closest('label')) return false;
        if (el.matches('.chip-option input')) return false;
        const r = el.getBoundingClientRect();
        return r.width < 43.5 || r.height < 43.5;
      }).map((el) => (el.innerText || el.getAttribute('aria-label') || el.name || el.tagName).trim().slice(0, 40) + ' ' + Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height));
      const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      return { primaries, disabled, small, overflow };
    })()`),
  };
  return api;
}
