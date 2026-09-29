// 제안서 공동 편집. hub.js 의 상세 화면이 편집 가능한 문서를 보여 줄 때 mountCollab 으로 붙인다.
// - 미리보기 iframe 을 designMode 로 바꿔 영어 원문을 직접 고치고, 작업자명을 붙여 새 버전으로 저장한다.
// - 버전은 지우지 않는다. 현재본을 기준으로 저장하면 다음 현재본(v2), 다른 사람이 먼저 저장했거나 이전 버전을
//   기준으로 저장하면 분기(v1.1)로 따로 남는다. 복원은 옛 내용을 복사한 새 현재본을 만든다.
// - 조회할 때는 부모 버전과 비교해 바뀐 곳을 형광펜으로 칠한다. 편집·인쇄·저장에는 칠하지 않은 본문만 쓴다.
// - 한국어 번역은 읽기 전용이다(저장된 번역, 없으면 Chrome 내장 Translator API 로 만든다).
// 저장소: Supabase REST/RPC(collab-config.js) 또는 이 브라우저의 localStorage.
// 외부 라이브러리(hub/vendor, npm 패키지 파일 그대로): DOMPurify 3.4.16, jsdiff 8.0.4(diffArrays).
import DOMPurify from "./vendor/purify.es.mjs";
import { diffArrays } from "./vendor/diff/array.js";
import { SUPABASE_URL, SUPABASE_KEY, EDITABLE } from "./collab-config.js";

/* ---------- 라벨 ---------- */

// 현재본을 기준으로 저장하면 다음 현재본 번호, 아니면 기준 버전 아래의 분기 번호(v1.1, v1.1.1 …).
// LocalBackend 와 화면(저장 라벨 예측)이 함께 쓰고, Supabase 의 save_version 도 같은 규칙을 따른다.
export function assignLabel(versions, head, baseId) {
  if (baseId === head.head_id) return { label: String(head.main_count + 1), is_main: true };
  const base = versions.find((v) => v.id === baseId);
  const n = versions.filter((v) => v.parent_id === baseId && !v.is_main).length + 1;
  return { label: `${base.label}.${n}`, is_main: false };
}

// 라벨 끝 숫자를 읽은 소리에 맞춰 조사를 고른다. 0(영·십·백)·3·6 은 받침, 1·7·8 은 ㄹ 받침, 나머지는 받침 없음.
const FINAL = { 0: "c", 1: "l", 3: "c", 6: "c", 7: "l", 8: "l" };
export function josa(label, pair) {
  const f = FINAL[String(label).slice(-1)];
  if (pair === "으로/로") return f === "c" ? "으로" : "로";
  const [withFinal, without] = pair.split("/");
  return f ? withFinal : without;
}

/* ---------- 변경 비교 ---------- */

// 태그·주석, 문자 참조(&amp;), 단어(글자·숫자), 공백 덩어리, 그 밖의 한 글자(문장 부호). 이어 붙이면 원문 그대로다.
const TOKEN = /<!--[\s\S]*?-->|<[a-zA-Z/!](?:[^>"']|"[^"]*"|'[^']*')*>|&(?:#\d+|#x[\da-fA-F]+|[a-zA-Z][a-zA-Z\d]*);|[\p{L}\p{M}\p{N}]+|\s+|[^]/gu;
export const tokenizeHtml = (html) => String(html ?? "").match(TOKEN) || [];

const isTag = (t) => t.length > 1 && t[0] === "<" && t.endsWith(">");
const BLANK = /^(?:\s|&nbsp;|&#160;|&#xa0;)*$/i;
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
// 표 행 사이에 글자를 넣으면 HTML 파서가 표 밖으로 옮겨 버린다.
const TABLE_CTX = new Set(["table", "thead", "tbody", "tfoot", "tr", "colgroup"]);

// 새 문서 기준으로 열린 태그를 쌓는다.
function track(stack, tag) {
  const m = /^<(\/?)([a-zA-Z][\w-]*)/.exec(tag);
  if (!m) return;
  const name = m[2].toLowerCase();
  if (m[1]) {
    const i = stack.lastIndexOf(name);
    if (i >= 0) stack.length = i;
  } else if (!VOID.has(name) && !tag.endsWith("/>")) stack.push(name);
}

/**
 * oldHtml → newHtml 의 변경을 새 문서의 태그 구조 위에 표시한다. 더한 글자는 <ins class="ss-ins">, 지운 글자는
 * <del class="ss-del">(지운 태그는 버린다). 공백만 바뀐 곳은 칠하지 않는다. 변경 덩어리마다 첫 표시에 ss-hunk 를
 * 붙이고 count 는 덩어리 수다. 비교가 시간·편집 거리 한도를 넘으면 null(호출하는 쪽이 문단 단위로 대신한다).
 */
export function diffHtml(oldHtml, newHtml, { timeout = 1000, maxEditLength = 8000 } = {}) {
  const parts = diffArrays(tokenizeHtml(oldHtml), tokenizeHtml(newHtml), { timeout, maxEditLength });
  if (!parts) return null;
  const stack = [];
  let html = "", count = 0, inHunk = false;
  const mark = (added, text) => {
    if (BLANK.test(text)) { if (added) html += text; return; }
    if (!added && TABLE_CTX.has(stack.at(-1))) return;
    const cls = (added ? "ss-ins" : "ss-del") + (inHunk ? "" : " ss-hunk");
    if (!inHunk) { count++; inHunk = true; }
    if (added) {
      // 앞뒤 공백은 새 문서의 것이므로 칠하지 않고 밖에 둔다.
      const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
      html += `${lead}<ins class="${cls}">${core}</ins>${trail}`;
    } else html += `<del class="${cls}">${text}</del>`;
  };
  for (const { value, added, removed } of parts) {
    if (!added && !removed) {
      for (const t of value) { html += t; if (isTag(t)) track(stack, t); }
      if (value.some((t) => !BLANK.test(t))) inHunk = false;   // 공백만 사이에 있으면 한 덩어리로 센다
      continue;
    }
    let run = "";
    for (const t of value) {
      if (!isTag(t)) { run += t; continue; }
      if (run) { mark(added, run); run = ""; }
      if (added) { html += t; track(stack, t); }
    }
    if (run) mark(added, run);
  }
  return { html, count };
}

/* ---------- 블록 모델(번역과 문단 단위 변경 표시가 함께 쓴다) ---------- */

export const BLOCK_TAGS = "address,article,aside,blockquote,caption,dd,div,dt,figcaption,footer,h1,h2,h3,h4,h5,h6,header,li,main,nav,p,pre,section,td,th";
const BLOCKS = new Set(BLOCK_TAGS.split(","));
const squash = (s) => s.replace(/\s+/g, " ").trim();

// root 안에서 node 에 가장 가까운 블록 조상(root 자신 포함). 없으면 null.
function blockOf(node, root) {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (BLOCKS.has(el.localName)) return el;
    if (el === root) break;
  }
  return null;
}

// 블록마다 자기 글자 노드(가장 가까운 블록 조상이 그 블록인 글자 노드)를 모아, 글자가 있는 블록만 문서 순서대로.
function segments(root, ignore) {
  const own = new Map();
  const walker = (root.ownerDocument || root).createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (ignore && n.parentElement?.closest(ignore)) continue;
    const b = blockOf(n, root);
    if (b) (own.get(b) || own.set(b, []).get(b)).push(n);
  }
  const els = [...root.querySelectorAll(BLOCK_TAGS)];
  if (BLOCKS.has(root.localName)) els.unshift(root);
  return els.map((el) => {
    const nodes = own.get(el) || [];
    return { el, nodes, text: squash(nodes.map((n) => n.data).join("")) };
  }).filter((s) => s.text);
}

/** 자기 글자가 있는 블록을 문서 순서대로 [{ el, text }]. ignore(선택자) 안의 글자는 세지 않는다. */
export function blockSegments(root, { ignore } = {}) {
  return segments(root, ignore).map(({ el, text }) => ({ el, text }));
}

/**
 * i 번째 블록의 글자를 texts[i] 로 바꾼다. 블록에 바로 붙은 첫 글자 노드(없으면 첫 글자 노드)에 쓰고 블록의 다른
 * 글자 노드는 비운다. 링크·강조 요소는 남긴다(글자가 링크 안에만 있으면 링크 안에 쓴다).
 */
export function applySegments(root, texts) {
  segments(root).forEach(({ el, nodes }, i) => {
    if (typeof texts[i] !== "string") return;
    const filled = nodes.filter((n) => n.data.trim());
    const target = filled.find((n) => n.parentNode === el) || filled[0];
    for (const n of filled) n.data = n === target ? texts[i] : "";
  });
}

/** 비교 DOM(ss-ins/ss-del/ss-chg-block 표시)에서 바뀐 블록 번호. 번호는 지운 글자를 빼고 센 blockSegments 순서. */
export function changedBlocks(root) {
  const segs = blockSegments(root, { ignore: ".ss-del" });
  const hit = new Set();
  for (const m of root.querySelectorAll(".ss-ins, .ss-del")) hit.add(blockOf(m, root));
  const indices = [];
  segs.forEach(({ el }, i) => { if (hit.has(el) || el.classList.contains("ss-chg-block")) indices.push(i); });
  return { indices, total: segs.length };
}

const parseHtml = (html) => new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html");

// 비교가 한도를 넘었을 때: 새 문서에서 옛 문서에 같은 글자가 없는 블록만 칠한다.
function blockDiff(oldHtml, newHtml) {
  const left = new Map();
  for (const { text } of blockSegments(parseHtml(oldHtml).body)) left.set(text, (left.get(text) || 0) + 1);
  const d = parseHtml(newHtml);
  let count = 0;
  for (const { el, text } of blockSegments(d.body)) {
    const n = left.get(text) || 0;
    if (n) left.set(text, n - 1);
    else { el.classList.add("ss-chg-block"); count++; }
  }
  return { html: d.body.innerHTML, count };
}

/* ---------- 정화 ---------- */

const PURIFY = {
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button", "textarea", "select"],
  ALLOW_DATA_ATTR: false,
};
/** 저장하거나 iframe 에 넣는 HTML 은 모두 이 함수를 거친다(id·class·href·src·alt·colspan·rowspan·style 은 남는다). */
export const sanitize = (html) => DOMPurify.sanitize(String(html ?? ""), PURIFY);

/* ---------- 저장소 ---------- */

const fail = (message, code) => Object.assign(new Error(message), { code });
const now = () => new Date().toISOString();

// 같은 버전의 번역이 여럿이면 Claude 번역을 먼저, 그다음 최신 순.
function pickTranslation(rows) {
  const claude = (r) => (r.engine === "claude" ? 0 : 1);
  const [t] = [...(rows || [])].sort((a, b) => claude(a) - claude(b) || String(b.created_at).localeCompare(String(a.created_at)));
  return t ? { engine: t.engine, html: t.html, created_at: t.created_at } : null;
}

/**
 * 이 브라우저의 localStorage(ss.collab.<doc>)에 저장한다. 처음 쓰일 때 정적 문서 본문으로 v1(초기본)을 만든다.
 * 저장·복원은 navigator.locks 안에서 읽고 쓰므로 탭 두 개가 동시에 저장해도 DB 행 잠금처럼 차례로 처리된다.
 */
export class LocalBackend {
  constructor(doc, { seedHtml = null } = {}) {
    this.doc = doc;
    this.key = `ss.collab.${doc}`;
    this.seedHtml = seedHtml;
  }
  read() {
    const raw = localStorage.getItem(this.key);
    return raw ? JSON.parse(raw) : null;
  }
  write(state) {
    try { localStorage.setItem(this.key, JSON.stringify(state)); }
    catch { throw fail("브라우저 저장 공간이 부족해 저장하지 못했습니다.", "QUOTA"); }
  }
  lock(fn) {
    return globalThis.navigator?.locks?.request ? navigator.locks.request(this.key, fn) : fn();
  }
  empty() {
    return { seq: 0, head: { head_id: null, main_count: 0 }, versions: [], translations: [] };
  }
  async state() {
    const s = this.read();
    if (s || this.seedHtml == null) return s || this.empty();
    return this.lock(async () => {
      let st = this.read();
      if (st) return st;
      st = this.empty();
      st.versions.push({ id: ++st.seq, label: "1", parent_id: null, is_main: true, author: "초기본", note: null,
        kind: "seed", restored_from: null, html: this.seedHtml, created_at: now() });
      st.head = { head_id: st.seq, main_count: 1 };
      this.write(st);
      return st;
    });
  }
  async listVersions() {
    return (await this.state()).versions.map(({ html, ...v }) => v);
  }
  async getHead() {
    return { ...(await this.state()).head };
  }
  async getHtml(id) {
    const v = (await this.state()).versions.find((x) => x.id === id);
    if (!v) throw fail("버전을 찾을 수 없습니다.", "NOT_FOUND");
    return v.html;
  }
  async saveVersion({ baseId, author, html, note = null }) {
    await this.state();   // 잠금은 다시 들어갈 수 없으므로 v1 준비는 밖에서 끝낸다
    return this.lock(async () => {
      const st = this.read() || this.empty();
      if (baseId !== st.head.head_id && !st.versions.some((v) => v.id === baseId)) throw fail("기준 버전을 찾을 수 없습니다.", "NOT_FOUND");
      const { label, is_main } = assignLabel(st.versions, st.head, baseId);
      const id = ++st.seq;
      st.versions.push({ id, label, parent_id: baseId, is_main, author, note, kind: "edit", restored_from: null, html, created_at: now() });
      if (is_main) st.head = { head_id: id, main_count: st.head.main_count + 1 };
      this.write(st);
      return { id, label, is_main, head_label: st.versions.find((v) => v.id === st.head.head_id).label };
    });
  }
  async restoreVersion({ versionId, expectedHeadId, author }) {
    await this.state();
    return this.lock(async () => {
      const st = this.read() || this.empty();
      if (st.head.head_id !== expectedHeadId) throw fail("HEAD_CHANGED", "HEAD_CHANGED");
      const src = st.versions.find((v) => v.id === versionId);
      if (!src) throw fail("버전을 찾을 수 없습니다.", "NOT_FOUND");
      const id = ++st.seq, label = String(st.head.main_count + 1);
      st.versions.push({ id, label, parent_id: st.head.head_id, is_main: true, author, note: null, kind: "restore",
        restored_from: versionId, html: src.html, created_at: now() });
      st.head = { head_id: id, main_count: st.head.main_count + 1 };
      this.write(st);
      return { id, label };
    });
  }
  async getTranslation(versionId, lang = "ko") {
    return pickTranslation((await this.state()).translations.filter((t) => t.version_id === versionId && t.lang === lang));
  }
  async addTranslation({ versionId, lang = "ko", engine = "chrome", html }) {
    await this.state();
    await this.lock(async () => {
      const st = this.read() || this.empty();
      if (st.translations.some((t) => t.version_id === versionId && t.lang === lang && t.engine === engine)) return;   // 이미 있으면 그대로
      st.translations.push({ id: st.translations.length + 1, version_id: versionId, lang, engine, html, created_at: now() });
      this.write(st);
    });
  }
}

/** Supabase REST(PostgREST)와 RPC. supabase-js 없이 fetch 만 쓴다. 쓰기는 DB 함수가 잠금·라벨을 맡는다. */
export class SupabaseBackend {
  constructor(url, key) {
    this.base = `${String(url).replace(/\/+$/, "")}/rest/v1`;
    this.headers = { apikey: key, "Content-Type": "application/json" };
    if (String(key).startsWith("eyJ")) this.headers.Authorization = `Bearer ${key}`;   // 예전 anon JWT 키일 때만
  }
  async req(path, body) {
    let res;
    try {
      res = await fetch(this.base + path, {
        method: body ? "POST" : "GET", headers: this.headers, body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout?.(15000),
      });
    } catch (e) {
      throw fail(`공유 저장소에 연결할 수 없습니다. (${e.message})`, "NETWORK");
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const message = (data && (data.message || data.error_description || data.error || data.msg)) || `HTTP ${res.status}`;
      throw fail(message, /HEAD_CHANGED/.test(message) ? "HEAD_CHANGED" : String(data?.code || res.status));
    }
    return data;
  }
  listVersions(doc) {
    return this.req(`/doc_versions?doc=eq.${encodeURIComponent(doc)}&select=id,label,parent_id,is_main,author,note,kind,restored_from,created_at&order=id.asc`);
  }
  async getHead(doc) {
    const [h] = await this.req(`/doc_heads?doc=eq.${encodeURIComponent(doc)}&select=head_id,main_count`);
    return h || { head_id: null, main_count: 0 };
  }
  async getHtml(id) {
    const [v] = await this.req(`/doc_versions?id=eq.${encodeURIComponent(id)}&select=html`);
    if (!v) throw fail("버전을 찾을 수 없습니다.", "NOT_FOUND");
    return v.html;
  }
  async saveVersion({ doc, baseId, author, html, note = null }) {
    const rows = await this.req("/rpc/save_version", { p_doc: doc, p_base_id: baseId, p_author: author, p_html: html, p_note: note });
    return Array.isArray(rows) ? rows[0] : rows;
  }
  async restoreVersion({ doc, versionId, expectedHeadId, author }) {
    const rows = await this.req("/rpc/restore_version", { p_doc: doc, p_version_id: versionId, p_expected_head_id: expectedHeadId, p_author: author });
    return Array.isArray(rows) ? rows[0] : rows;
  }
  async getTranslation(versionId, lang = "ko") {
    return pickTranslation(await this.req(`/doc_translations?version_id=eq.${encodeURIComponent(versionId)}&lang=eq.${encodeURIComponent(lang)}&select=engine,html,created_at&order=created_at.desc`));
  }
  async addTranslation({ versionId, lang = "ko", html }) {
    // engine 은 서버가 'chrome' 으로 정한다. 이미 있으면 무시한다.
    try { await this.req("/rpc/add_translation", { p_version_id: versionId, p_lang: lang, p_html: html }); }
    catch (e) { if (e.code !== "23505" && !/already exists|duplicate/i.test(e.message)) throw e; }
  }
}

/* ---------- 화면 ---------- */

const FRAME_CSS = ".ss-ins{background:#fff59d;color:inherit;text-decoration:none;border-radius:2px;box-shadow:0 0 0 1px #fff59d}"
  + ".ss-del{background:#ffe0e0;color:#a33;text-decoration:line-through}.ss-chg-block{background:#fff9c4}"
  + "@media print{.ss-ins{background:none!important;box-shadow:none!important}.ss-del{display:none!important}.ss-chg-block{background:none!important}}"
  // 브라우저 머리말·꼬리말(날짜·제목·주소·쪽 번호)은 쪽 여백에 찍히므로 쪽 여백을 0으로 하고, 같은 1인치 여백을
  // 쪽마다 반복되는 본문 안쪽 여백으로 만든다(쪽수 18쪽은 그대로).
  + "@media print{@page{margin:0}@page :first{margin:0}html body{margin:0;padding:1in;box-decoration-break:clone;-webkit-box-decoration-break:clone}}";
const KO_MISSING = "이 버전의 한국어 번역이 아직 없습니다. 데스크톱 Chrome에서 열면 자동 번역을 만들 수 있습니다.";
const PRINT_HINT = "인쇄 창에서 대상을 'PDF로 저장'으로 선택하세요.";
const AUTHOR_KEY = "ss.collab.author";
const MARKS_KEY = "ss.collab.marks";
const POLL_MS = 20000;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
/** 저장 시각을 이 브라우저의 시간대로 YYYY-MM-DD HH:mm. */
export function fmtTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// 사생활 보호 모드 등에서 localStorage 가 막혀도 화면은 동작해야 한다.
const pref = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 기억하지 못할 뿐 */ } },
};
const hasTranslator = () => typeof self !== "undefined" && "Translator" in self;
const btn = (act, label, attrs = "", cls = "") => `<button type="button" class="cl-btn sm ${cls}" data-act="${act}" ${attrs}>${label}</button>`;

// 다시 그린 뒤에도 키보드 초점(작업자명 입력란이면 커서 위치까지)을 같은 자리에 둔다.
function keepFocus(box, render) {
  const a = document.activeElement;
  const d = box.contains(a) ? a.dataset || {} : {};
  const typing = "author" in d;
  const sel = typing ? "[data-author]"
    : d.act ? `[data-act="${d.act}"]${d.lang ? `[data-lang="${d.lang}"]` : ""}${d.id ? `[data-id="${d.id}"]` : ""}` : null;
  const caret = typing ? [a.selectionStart, a.selectionEnd] : null;
  render();
  const el = sel && box.querySelector(sel);
  el?.focus();
  if (el && caret) el.setSelectionRange(...caret);
}

let active = null;

/** 상세 화면을 다시 그리기 전에 부른다. 폴링·이벤트·진행 중인 번역을 모두 멈춘다. */
export function unmountCollab() {
  active?.destroy();
  active = null;
}

/** 편집 가능한 문서 미리보기에 도구 막대(previewEl)와 변경 이력(leftEl)을 붙인다. */
export function mountCollab({ item, evidence, leftEl, previewEl }) {
  unmountCollab();
  const [path, anchor = ""] = String(evidence?.href || "").split("#");
  const cfg = EDITABLE[path];
  const iframe = previewEl?.querySelector("iframe");
  if (!cfg || !iframe || !leftEl) return;
  active = createCollab({ item, cfg, path, anchor, iframe, leftEl, previewEl });
}

function createCollab({ cfg, path, anchor, iframe, leftEl, previewEl }) {
  const q = new URLSearchParams(location.search);
  const S = {
    alive: true, started: false, ready: false, offline: false, localOnly: false,
    doc: q.get("collabDoc") || cfg.doc, backend: null, fdoc: null, fwin: null, staticHtml: "",
    versions: [], head: { head_id: null, main_count: 0 },
    viewId: null, lang: "en", marks: pref.get(MARKS_KEY) !== "0", mode: "view",
    edit: null,      // { baseId, startHeadId, clean, dirty, confirmCancel, error }
    newer: null,     // 조회 중 다른 사람이 새 현재본을 저장했다 { label, author }
    notice: null,    // { tone, text }
    ko: null,        // 한국어 보기 안내 { kind: missing | offer | busy, text }
    confirm: null,   // 복원 확인 { id, where: history | banner }
    shown: { count: null, note: "", engine: "" }, hunk: -1,
    gen: 0, polling: false, saving: false, timer: 0, trAbort: null,
    html: new Map(), tr: new Map(), diffs: new Map(),
  };
  const pdfBase = `ShiftSwap_${cfg.name.replace(/^Project\s+/, "").replace(/\s+/g, "_")}`;

  // 미리보기 위 도구 막대·안내, 왼쪽 열 맨 아래 변경 이력
  const top = document.createElement("div");
  top.className = "cl-top";
  top.innerHTML = `<div class="cl-bar" role="group" aria-label="문서 버전 도구"></div><div class="cl-msgs" role="status" aria-live="polite"></div>`;
  iframe.before(top);
  const bar = top.firstElementChild, msgs = top.lastElementChild;
  const hist = document.createElement("section");
  hist.className = "cl-history";
  hist.setAttribute("aria-labelledby", "cl-history-h");
  hist.innerHTML = `<h3 id="cl-history-h">변경 이력</h3><p class="cl-local" hidden>공유 저장소가 설정되지 않아 이 브라우저에만 저장됩니다.</p>`
    + `<div class="cl-scroll"><p class="cl-empty">불러오는 중…</p></div>`;
  leftEl.append(hist);
  const tree = hist.querySelector(".cl-scroll");

  const byId = (id) => S.versions.find((v) => v.id === id);
  const author = () => pref.get(AUTHOR_KEY) || "";

  /* --- 저장소 읽기(버전 본문은 바뀌지 않으므로 기억해 둔다) --- */
  async function refresh() {
    const head = await S.backend.getHead(S.doc);   // 현재본을 먼저 읽어야 목록에 반드시 들어 있다
    const versions = await S.backend.listVersions(S.doc);
    if (!S.alive) return;
    S.head = head || { head_id: null, main_count: 0 };
    S.versions = versions || [];
  }
  function getHtml(id) {
    if (!S.html.has(id)) {
      const p = S.backend.getHtml(id).then(sanitize);
      p.catch(() => S.html.delete(id));
      S.html.set(id, p);
    }
    return S.html.get(id);
  }
  // 번역은 있을 때만 기억한다(없던 번역이 나중에 생길 수 있다).
  async function translationFor(id) {
    if (S.tr.has(id)) return S.tr.get(id);
    const t = await S.backend.getTranslation(id, "ko").catch(() => null);
    if (t) S.tr.set(id, { ...t, html: sanitize(t.html) });
    return S.tr.get(id) || null;
  }
  function diffFor(v) {
    if (!S.diffs.has(v.id)) {
      const p = Promise.all([getHtml(v.parent_id), getHtml(v.id)]).then(([a, b]) =>
        diffHtml(a, b) || { ...blockDiff(a, b), note: "변경이 많아 바뀐 문단만 표시합니다." });
      p.catch(() => S.diffs.delete(v.id));
      S.diffs.set(v.id, p);
    }
    return S.diffs.get(v.id).then((d) => ({ note: "", ...d }));
  }
  // 한국어 보기의 문단 표시: 영어 비교 결과에서 바뀐 블록 번호를 찾아 번역본의 같은 번호 블록에 칠한다.
  async function koMarks(v, koHtml) {
    const { indices, total } = changedBlocks(parseHtml((await diffFor(v)).html).body);
    const ko = parseHtml(koHtml);
    const segs = blockSegments(ko.body);
    if (segs.length !== total) return { html: koHtml, count: null, note: "번역본의 문단 구성이 원문과 달라 변경 표시를 생략했습니다." };
    for (const i of indices) segs[i].el.classList.add("ss-chg-block");
    return { html: ko.body.innerHTML, count: indices.length, note: "" };
  }

  /* --- iframe --- */
  function setBody(html, lang = "en") {
    const d = S.fdoc;
    d.body.innerHTML = sanitize(html);
    d.documentElement.lang = lang;
    let ko = d.getElementById("ss-collab-ko");
    if (lang === "ko" && !ko) {
      ko = d.createElement("style");
      ko.id = "ss-collab-ko";
      ko.textContent = "body{word-break:keep-all}";
      d.head.append(ko);
    } else if (lang !== "ko") ko?.remove();
  }
  // scrollIntoView 는 허브 페이지까지 움직이므로 iframe 안에서만 스크롤한다.
  const yOf = (el) => el.getBoundingClientRect().top + S.fwin.scrollY;
  const anchorY = () => {
    const el = anchor && S.fdoc.getElementById(anchor);
    return el ? yOf(el) : 0;
  };

  async function renderDoc({ toAnchor = false } = {}) {
    if (!S.fdoc || S.mode === "edit") return;
    const gen = ++S.gen;
    const v = byId(S.viewId);
    let html = S.staticHtml, count = null, note = "", engine = "";
    if (v && S.lang === "ko") {
      const tr = await translationFor(v.id);
      if (tr) {
        S.ko = null;
        engine = tr.engine;
        html = tr.html;
        if (S.marks && v.parent_id != null) ({ html, count, note } = await koMarks(v, tr.html));
      } else {
        html = await getHtml(v.id);   // 번역이 없으면 영어 원문을 그대로 보여 주고 안내한다
        if (!S.ko) S.ko = { kind: hasTranslator() ? "offer" : "missing" };
      }
    } else if (v) {
      if (S.marks && v.parent_id != null) ({ html, count, note } = await diffFor(v));
      else html = await getHtml(v.id);
    }
    if (gen !== S.gen || !S.alive || S.mode === "edit") return;   // 그사이 다른 화면으로 바뀌었다
    const y = S.fwin.scrollY;
    setBody(html, engine ? "ko" : "en");
    S.fwin.scrollTo(0, toAnchor ? anchorY() : y);
    S.shown = { count, note, engine };
    S.hunk = -1;
    renderBar();
    renderMsgs();
  }

  /* --- 도구 막대 --- */
  const langToggle = (lockKo) => `<span class="cl-seg" role="group" aria-label="보기 언어">`
    + `<button type="button" data-act="lang" data-lang="en" aria-pressed="${S.lang === "en"}">EN</button>`
    + `<button type="button" data-act="lang" data-lang="ko" aria-pressed="${S.lang === "ko"}"${lockKo ? ' disabled title="편집 중에는 한국어 보기로 바꿀 수 없습니다."' : ""}>한국어</button></span>`;

  function renderBar() {
    keepFocus(bar, () => { bar.innerHTML = S.mode === "edit" ? editBar() : viewBar(); });
    updateSave();
  }
  function viewBar() {
    const v = byId(S.viewId);
    const ko = S.lang === "ko";
    let id = `<span class="cl-ver">${S.offline || (S.ready && !v) ? "정적 사본" : "불러오는 중…"}</span>`;
    if (v) {
      const state = v.id === S.head.head_id ? `<span class="cl-chip is-head">현재본</span>`
        : v.is_main ? `<span class="cl-chip">이전 버전</span>` : `<span class="cl-chip is-branch">분기</span>`;
      id = `<span class="cl-ver">v${esc(v.label)}</span>${state}<span class="cl-by">${esc(v.author)} · ${fmtTime(v.created_at)}</span>`;
    }
    if (S.shown.engine) {
      id += `<span class="cl-chip is-ko">한국어 번역 · 읽기 전용</span><span class="cl-by">${S.shown.engine === "claude" ? "Claude 번역" : "브라우저 자동 번역"}</span>`;
    }
    const counted = S.marks && S.shown.count != null;
    const editOff = !S.ready ? (S.offline ? "공유 저장소에 연결할 수 없어 편집할 수 없습니다." : "불러오는 중입니다.")
      : ko ? "편집은 영어 원문에서만 할 수 있습니다." : "";
    return `<div class="cl-id">${id}</div>
      <div class="cl-tools">
        <span class="cl-marks">
          <button type="button" class="cl-btn" data-act="marks" aria-pressed="${S.marks}">변경 표시</button>
          ${counted ? `<span class="cl-count">변경 ${S.shown.count}곳</span>` : ""}
          <button type="button" class="cl-btn" data-act="next"${counted && S.shown.count ? "" : " disabled"}>다음 변경</button>
          ${S.marks && S.shown.note ? `<span class="cl-note">${esc(S.shown.note)}</span>` : ""}
        </span>
        ${langToggle(false)}
        <button type="button" class="cl-btn" data-act="edit"${editOff ? ` disabled title="${editOff}"` : ""}>편집</button>
        <button type="button" class="cl-btn" data-act="print" title="${PRINT_HINT}"${S.ready || S.offline ? "" : " disabled"}>PDF 저장</button>
      </div>`;
  }
  function editBar() {
    const base = byId(S.edit.baseId);
    return `<div class="cl-id"><span class="cl-editing">편집 중 · ${base ? `v${esc(base.label)}` : "정적 사본"} 기준</span></div>
      <div class="cl-tools">
        ${langToggle(true)}
        <label class="cl-name"><span>작업자명</span><input type="text" data-author maxlength="40" autocomplete="name" aria-required="true" value="${esc(author())}"></label>
        <button type="button" class="cl-btn primary" data-act="save" disabled>저장</button>
        <button type="button" class="cl-btn" data-act="cancel">취소</button>
      </div>`;
  }
  // 저장 버튼만 고친다(작업자명을 입력하는 중에 막대를 다시 그리지 않으려고).
  function updateSave() {
    const b = bar.querySelector('[data-act="save"]');
    if (!b || S.mode !== "edit") return;
    const name = bar.querySelector("[data-author]").value.trim();
    b.disabled = S.saving || !name || !S.edit.dirty;
    b.textContent = S.saving ? "저장 중…" : "저장";
    b.title = !name ? "작업자명을 입력하세요." : !S.edit.dirty ? "고친 내용이 없습니다." : "Ctrl/⌘+S";
  }

  /* --- 안내 --- */
  const msg = (tone, text, buttons = "", after = "") => `<div class="cl-msg ${tone}"><p>${text}</p>${buttons ? `<span class="cl-acts">${buttons}</span>` : ""}${after}</div>`;
  const confirmHtml = (v, where) => `<div class="cl-confirm" data-where="${where}">
      <p>v${esc(v.label)}의 내용으로 새 현재본(v${S.head.main_count + 1})을 만듭니다.</p>
      <label class="cl-name"><span>작업자명</span><input type="text" data-author maxlength="40" autocomplete="name" aria-required="true" value="${esc(author())}"></label>
      <span class="cl-acts">${btn("restore", "복원", `data-id="${v.id}"`, "primary")}${btn("cancel-restore", "취소")}</span>
    </div>`;

  function renderMsgs() {
    const out = [];
    if (S.offline) out.push(msg("warn", "공유 저장소에 연결할 수 없어 저장본을 불러오지 못했습니다. 정적 사본을 표시합니다."));
    if (S.notice) out.push(msg(S.notice.tone, esc(S.notice.text), btn("dismiss", "닫기")));
    if (S.mode === "edit") {
      const e = S.edit, base = byId(e.baseId);
      if (base && e.baseId !== e.startHeadId) {
        const p = assignLabel(S.versions, S.head, e.baseId).label;
        out.push(msg("warn", `현재본이 아닌 v${esc(base.label)}${josa(base.label, "을/를")} 기준으로 편집합니다. 저장하면 v${esc(p)}(분기)${josa(p, "으로/로")} 저장됩니다.`));
      } else if (base && S.head.head_id !== e.baseId) {
        const h = byId(S.head.head_id), p = assignLabel(S.versions, S.head, e.baseId).label;
        out.push(msg("warn", `편집하는 동안 ${esc(h.author)}님이 v${esc(h.label)}${josa(h.label, "을/를")} 저장했습니다. 지금 저장하면 v${esc(p)}(분기)${josa(p, "으로/로")} 따로 저장됩니다.`));
      }
      if (e.error) out.push(msg("warn", esc(e.error)));
      if (e.confirmCancel) out.push(msg("warn", "저장하지 않은 수정 내용을 버립니다.", btn("discard", "버리기", "", "primary") + btn("keep", "계속 편집")));
    } else if (S.ready) {
      const v = byId(S.viewId), h = byId(S.head.head_id);
      if (!v) out.push(msg("info", "저장된 버전이 없어 정적 사본을 표시합니다. 편집해서 저장하면 v1이 됩니다."));
      else if (v.id !== S.head.head_id && h) {
        out.push(msg("info", `v${esc(v.label)} 조회 중입니다(현재본 v${esc(h.label)} 아님).`,
          btn("show-head", "현재본 보기") + btn("ask-restore", "이 버전 복원", `data-id="${v.id}" data-where="banner"`),
          S.confirm && S.confirm.where === "banner" && S.confirm.id === v.id ? confirmHtml(v, "banner") : ""));
      }
      if (S.newer) {
        out.push(msg("info", `새 버전 v${esc(S.newer.label)}(${esc(S.newer.author)})${josa(S.newer.label, "이/가")} 저장되었습니다.`, btn("load-newer", "불러오기", "", "primary")));
      }
      if (S.lang === "ko" && S.ko) {
        if (S.ko.kind === "missing") out.push(msg("info", KO_MISSING));
        else if (S.ko.kind === "busy") out.push(msg("info", esc(S.ko.text)));
        else out.push(msg("info", esc(S.ko.text || "이 버전의 한국어 번역이 아직 없습니다. 이 브라우저의 자동 번역으로 만들 수 있습니다."), btn("translate", "자동 번역 만들기", "", "primary")));
      }
    }
    keepFocus(msgs, () => { msgs.innerHTML = out.join(""); });
  }

  /* --- 변경 이력 --- */
  function entry(v) {
    const isHead = v.id === S.head.head_id;
    const src = v.restored_from != null ? byId(v.restored_from) : null;
    const chips = [
      isHead && `<span class="cl-chip is-head">현재본</span>`,
      !v.is_main && `<span class="cl-chip is-branch">분기</span>`,
      v.kind === "restore" && `<span class="cl-chip">복원: v${esc(src ? src.label : "?")}</span>`,
      v.kind === "seed" && `<span class="cl-chip">초기본</span>`,
    ].filter(Boolean).join("");
    const lock = S.mode === "edit" ? ' disabled title="편집을 마치거나 취소한 뒤 사용할 수 있습니다."' : "";
    return `<div class="cl-entry">
        <p class="cl-line"><span class="cl-label">v${esc(v.label)}</span>${chips}</p>
        <p class="cl-meta">${esc(v.author)} · ${fmtTime(v.created_at)}</p>
        ${v.note ? `<p class="cl-vnote">${esc(v.note)}</p>` : ""}
        <p class="cl-acts">${btn("view", "조회", `data-id="${v.id}" aria-label="v${esc(v.label)} 조회"${lock}`)}${isHead ? ""
          : btn("ask-restore", "복원", `data-id="${v.id}" data-where="history" aria-label="v${esc(v.label)} 복원"${lock}`)}</p>
        ${S.confirm && S.confirm.where === "history" && S.confirm.id === v.id ? confirmHtml(v, "history") : ""}
      </div>`;
  }
  function renderHistory() {
    keepFocus(hist, () => {
      if (S.offline) { tree.innerHTML = `<p class="cl-empty">이력을 불러오지 못했습니다.</p>`; return; }
      if (!S.ready) return;
      if (!S.versions.length) { tree.innerHTML = `<p class="cl-empty">아직 저장된 버전이 없습니다.</p>`; return; }
      // 현재본 계열은 최신부터, 각 버전 아래에 그 버전에서 갈라진 분기(분기의 분기까지)를 단다.
      const kids = new Map();
      for (const v of S.versions) if (!v.is_main) kids.set(v.parent_id, [...(kids.get(v.parent_id) || []), v]);
      const node = (v) => `<li${v.id === S.viewId ? ' aria-current="true"' : ""}>${entry(v)}${kids.has(v.id) ? `<ol>${kids.get(v.id).map(node).join("")}</ol>` : ""}</li>`;
      tree.innerHTML = `<ol class="cl-tree">${S.versions.filter((v) => v.is_main).reverse().map(node).join("")}</ol>`;
    });
  }
  const renderAll = () => { renderBar(); renderMsgs(); renderHistory(); };

  /* --- 동작 --- */
  async function view(id) {
    if (S.mode === "edit" || !byId(id)) return;
    abortTranslation();
    S.viewId = id;
    S.confirm = null;
    S.ko = null;
    S.shown = { count: null, note: "", engine: "" };
    renderAll();
    // 한 열 화면에서는 이력이 미리보기 위에 있으므로 바뀐 미리보기로 내려 준다.
    if (matchMedia("(max-width: 880px)").matches) previewEl.scrollIntoView({ block: "start" });
    await renderDoc();
  }

  function toggleMarks() {
    S.marks = !S.marks;
    pref.set(MARKS_KEY, S.marks ? "1" : "0");
    renderBar();
    return renderDoc();
  }

  function nextChange() {
    const els = [...S.fdoc.querySelectorAll(".ss-hunk, .ss-chg-block")];
    if (!els.length) return;
    S.hunk = (S.hunk + 1) % els.length;
    S.fwin.scrollTo(0, Math.max(0, yOf(els[S.hunk]) - 72));
  }

  const availability = () => (hasTranslator()
    ? self.Translator.availability({ sourceLanguage: "en", targetLanguage: "ko" }).catch(() => "unavailable")
    : Promise.resolve("unavailable"));

  async function setLang(lang) {
    if (lang === S.lang || S.mode === "edit") return;
    abortTranslation();
    S.lang = lang;
    S.ko = null;
    S.shown = { count: null, note: "", engine: "" };
    renderBar();
    renderMsgs();
    const v = byId(S.viewId);
    if (lang === "ko" && v) {
      // 저장된 번역과 번역 기능 확인을 함께 시작한다(번역기 생성은 클릭 직후에만 허용된다).
      const [tr, avail] = await Promise.all([translationFor(v.id), availability()]);
      if (!S.alive || S.lang !== "ko" || S.viewId !== v.id || S.mode === "edit") return;
      if (!tr && avail !== "unavailable") return translateWithChrome(v);
      if (!tr) S.ko = { kind: "missing" };
    } else if (lang === "ko") S.ko = { kind: "missing" };
    await renderDoc();
  }

  function abortTranslation() {
    if (!S.trAbort) return;
    S.trAbort.abort();
    S.trAbort = null;
    if (S.ko?.kind === "busy") S.ko = null;
  }

  // Chrome 내장 번역: 깨끗한 영어 DOM 의 블록을 하나씩 번역해 같은 자리에 쓰고, 공유 저장소에 남긴다.
  async function translateWithChrome(v) {
    if (!v || !hasTranslator()) return;
    abortTranslation();
    const ac = new AbortController();
    S.trAbort = ac;
    const say = (text) => { if (S.trAbort === ac && S.alive) { S.ko = { kind: "busy", text }; renderMsgs(); } };
    say("번역 준비 중…");
    renderDoc().catch(() => {});   // 번역이 끝날 때까지 영어 원문을 보여 준다
    let translator;
    try {
      translator = await self.Translator.create({
        sourceLanguage: "en", targetLanguage: "ko", signal: ac.signal,
        monitor(m) { m.addEventListener("downloadprogress", (e) => say(`번역 모델 내려받는 중… ${Math.round(e.loaded * 100)}%`)); },
      });
      const d = parseHtml(await getHtml(v.id));
      const segs = blockSegments(d.body);
      const texts = [];
      for (const [i, s] of segs.entries()) {
        if (ac.signal.aborted) return;
        say(`번역 중… ${i + 1}/${segs.length}`);
        texts.push(await translator.translate(s.text, { signal: ac.signal }));
      }
      applySegments(d.body, texts);
      const html = sanitize(d.body.innerHTML);
      S.tr.set(v.id, { engine: "chrome", html, created_at: now() });
      S.ko = null;
      try { await S.backend.addTranslation({ versionId: v.id, lang: "ko", engine: "chrome", html }); }
      catch { S.notice = { tone: "warn", text: "번역을 공유 저장소에 남기지 못했습니다. 이 화면에서만 보입니다." }; }
    } catch (e) {
      if (ac.signal.aborted) return;
      S.ko = { kind: "offer", text: e?.name === "NotAllowedError" ? "자동 번역을 시작하려면 버튼을 한 번 더 누르세요."
        : "자동 번역을 만들지 못했습니다. 다시 시도할 수 있습니다." };
    } finally {
      translator?.destroy?.();
      if (S.trAbort === ac) S.trAbort = null;
    }
    if (S.alive && S.lang === "ko" && S.viewId === v.id) await renderDoc();
  }

  async function enterEdit() {
    if (S.mode === "edit" || S.lang !== "en" || !S.ready) return;
    const baseId = S.viewId;
    const clean = baseId == null ? S.staticHtml : await getHtml(baseId);
    if (!S.alive || S.mode === "edit") return;
    abortTranslation();
    S.gen++;   // 진행 중인 그리기가 편집 본문을 덮지 않게 한다
    S.mode = "edit";
    S.confirm = null;
    S.newer = null;
    S.notice = null;
    S.edit = { baseId, startHeadId: S.head.head_id, clean: "", dirty: false, confirmCancel: false, error: "" };
    const y = S.fwin.scrollY;
    setBody(clean, "en");   // 형광펜 없는 영어 원문
    S.edit.clean = S.fdoc.body.innerHTML;
    S.fdoc.designMode = "on";
    S.fwin.scrollTo(0, y);
    renderAll();
    S.fwin.focus();
    poll();   // 조회하는 동안 현재본이 바뀌었을 수 있다
  }

  function syncDirty() {
    if (S.mode === "edit") S.edit.dirty = S.fdoc.body.innerHTML !== S.edit.clean;
  }

  function exitEdit() {
    S.fdoc.designMode = "off";
    S.mode = "view";
    S.edit = null;
    S.shown = { count: null, note: "", engine: "" };
  }

  function cancelEdit(force) {
    if (S.mode !== "edit") return;
    syncDirty();
    if (S.edit.dirty && !force) {
      S.edit.confirmCancel = true;
      renderMsgs();
      msgs.querySelector('[data-act="discard"]')?.focus();
      return;
    }
    exitEdit();
    renderAll();
    bar.querySelector('[data-act="edit"]')?.focus();
    return renderDoc();
  }

  async function save() {
    if (S.mode !== "edit" || S.saving) return;
    syncDirty();
    const input = bar.querySelector("[data-author]");
    const name = input.value.trim();
    if (!name) { input.focus(); updateSave(); return; }
    if (!S.edit.dirty) return;
    const { baseId, startHeadId } = S.edit;
    const html = sanitize(S.fdoc.body.innerHTML);
    S.saving = true;
    S.edit.error = "";
    updateSave();
    let r;
    try {
      r = await S.backend.saveVersion({ doc: S.doc, baseId, author: name, html, note: null });
    } catch (e) {
      if (S.alive && S.mode === "edit") S.edit.error = `저장하지 못했습니다. 수정 내용은 그대로 남아 있습니다. (${e.message})`;
      return;
    } finally {
      S.saving = false;
      if (S.alive) { updateSave(); renderMsgs(); }
    }
    if (!S.alive) return;
    pref.set(AUTHOR_KEY, name);
    exitEdit();
    await refresh().catch(() => {});
    if (!S.alive) return;
    S.viewId = byId(r.id) ? r.id : S.viewId;
    S.newer = null;
    const L = r.label, H = r.head_label;
    S.notice = { tone: r.is_main ? "ok" : "warn", text: r.is_main ? `v${L}${josa(L, "으로/로")} 저장했습니다.`
      : baseId === startHeadId
        ? `다른 작업자가 먼저 v${H}${josa(H, "을/를")} 저장해서, 이번 수정은 v${L}${josa(L, "으로/로")} 따로 저장했습니다. 형광펜으로 표시된 v${L}의 변경 내용을 확인한 뒤 현재본에 다시 반영하거나 v${L}${josa(L, "을/를")} 복원하세요.`
        : `v${L}(분기)${josa(L, "으로/로")} 저장했습니다. 현재본은 v${H} 그대로입니다.` };
    renderAll();
    bar.querySelector('[data-act="edit"]')?.focus();
    await renderDoc();
  }

  function askRestore(id, where) {
    if (S.mode === "edit" || !byId(id)) return;
    S.confirm = { id, where };
    renderHistory();
    renderMsgs();
    const box = (where === "banner" ? msgs : hist).querySelector(".cl-confirm");
    const input = box?.querySelector("[data-author]");
    (input && !input.value.trim() ? input : box?.querySelector('[data-act="restore"]'))?.focus();
  }

  async function restore(id, el) {
    const input = el.closest(".cl-confirm")?.querySelector("[data-author]");
    const name = (input?.value || "").trim();
    if (!name) { input?.focus(); return; }
    const src = byId(id);
    if (!src || S.mode === "edit") return;
    pref.set(AUTHOR_KEY, name);
    el.disabled = true;
    try {
      const r = await S.backend.restoreVersion({ doc: S.doc, versionId: id, expectedHeadId: S.head.head_id, author: name });
      await refresh();
      if (!S.alive) return;
      S.viewId = r.id;
      S.newer = null;
      S.notice = { tone: "ok", text: `v${src.label}${josa(src.label, "을/를")} 복원해 v${r.label}${josa(r.label, "으로/로")} 저장했습니다.` };
    } catch (e) {
      if (!S.alive) return;
      if (e.code === "HEAD_CHANGED") {
        await refresh().catch(() => {});
        const h = byId(S.head.head_id);
        S.notice = { tone: "warn", text: `그사이 ${h ? `${h.author}님이 v${h.label}${josa(h.label, "을/를")}` : "다른 작업자가 새 버전을"} 저장해 복원하지 않았습니다. 이력을 새로 불러왔으니 확인한 뒤 다시 복원하세요.` };
      } else S.notice = { tone: "warn", text: `복원하지 못했습니다. (${e.message})` };
    }
    S.confirm = null;
    S.shown = { count: null, note: "", engine: "" };
    renderAll();
    await renderDoc();
  }

  async function loadNewer() {
    await refresh();
    if (!S.alive || S.mode === "edit") return;
    S.newer = null;
    await view(S.head.head_id);
  }

  async function printPdf() {
    if (S.mode === "edit" || !S.fdoc) return;
    const v = byId(S.viewId);
    const tr = v && S.lang === "ko" ? await translationFor(v.id) : null;
    const html = tr ? tr.html : v ? await getHtml(v.id) : S.staticHtml;
    if (!S.alive || S.mode === "edit") return;
    S.gen++;
    const d = S.fdoc, w = S.fwin, title = d.title, y = w.scrollY;
    // 형광펜 없는 본문으로 바꿔 인쇄하고, 인쇄 창이 닫히면 원래 보기로 돌린다.
    setBody(html, tr ? "ko" : "en");
    d.title = `${pdfBase}${v ? `_v${v.label}` : ""}_${tr ? "KO" : "EN"}`;
    w.scrollTo(0, y);
    const back = () => {
      w.removeEventListener("afterprint", back);
      if (!S.alive) return;
      d.title = title;
      renderDoc();
    };
    w.addEventListener("afterprint", back);
    S.notice = { tone: "info", text: PRINT_HINT };
    renderMsgs();
    w.focus();
    w.print();
  }

  // 현재본이 바뀌었는지 확인한다. 편집 중이면 본문은 두고 안내만, 현재본을 보는 중이면 불러오기를 권한다.
  async function poll() {
    if (!S.ready || S.polling) return;
    S.polling = true;
    try {
      const head = await S.backend.getHead(S.doc);
      if (!S.alive || head.head_id === S.head.head_id) return;
      const versions = await S.backend.listVersions(S.doc);
      if (!S.alive) return;
      const nv = versions.find((x) => x.id === head.head_id);
      if (S.mode === "view" && S.viewId === S.head.head_id && nv) {
        S.newer = { label: nv.label, author: nv.author };
        renderMsgs();
        return;
      }
      S.head = head;
      S.versions = versions;
      if (S.mode === "view") renderBar();   // 편집 중에는 작업자명 입력란이 있는 막대를 다시 그리지 않는다
      renderMsgs();
      renderHistory();
    } catch { /* 다음 주기에 다시 확인한다 */ } finally {
      S.polling = false;
    }
  }

  async function act(name, el) {
    const id = el.dataset.id != null ? Number(el.dataset.id) : null;
    switch (name) {
      case "marks": return toggleMarks();
      case "next": return nextChange();
      case "lang": return setLang(el.dataset.lang);
      case "edit": return enterEdit();
      case "print": return printPdf();
      case "save": return save();
      case "cancel": return cancelEdit(false);
      case "discard": return cancelEdit(true);
      case "keep": S.edit.confirmCancel = false; renderMsgs(); return S.fwin.focus();
      case "dismiss": S.notice = null; return renderMsgs();
      case "show-head": return view(S.head.head_id);
      case "ask-restore": return askRestore(id, el.dataset.where);
      case "cancel-restore": S.confirm = null; renderHistory(); return renderMsgs();
      case "restore": return restore(id, el);
      case "load-newer": return loadNewer();
      case "translate": return translateWithChrome(byId(S.viewId));
      case "view": return view(id);
    }
  }

  /* --- 이벤트 --- */
  const onClick = (e) => {
    const el = e.target.closest("[data-act]");
    if (!el || el.disabled || !S.alive) return;
    act(el.dataset.act, el).catch((err) => {
      if (!S.alive) return;
      S.notice = { tone: "warn", text: `처리하지 못했습니다. (${err.message})` };
      renderMsgs();
    });
  };
  const onInput = (e) => {
    if (!e.target.matches("[data-author]")) return;
    pref.set(AUTHOR_KEY, e.target.value);
    updateSave();
  };
  const onEnter = (e) => {
    if (e.key !== "Enter" || !e.target.matches("[data-author]")) return;
    e.preventDefault();
    const box = e.target.closest(".cl-confirm");
    if (box) box.querySelector('[data-act="restore"]')?.click();
    else save();
  };
  const onKey = (e) => {
    if (S.mode === "edit" && (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
    }
  };
  const onFrameInput = () => {
    if (S.mode !== "edit") return;
    syncDirty();
    updateSave();
  };
  const onBeforeUnload = (e) => {
    syncDirty();
    if (S.mode === "edit" && S.edit.dirty) { e.preventDefault(); e.returnValue = ""; }
  };
  const onVisible = () => { if (document.visibilityState === "visible") poll(); };
  for (const box of [top, hist]) {
    box.addEventListener("click", onClick);
    box.addEventListener("input", onInput);
    box.addEventListener("keydown", onEnter);
  }
  document.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("beforeunload", onBeforeUnload);

  // iframe 이 읽히면(이미 읽혔으면 바로) 정적 본문을 v1 씨앗으로 삼고 저장본으로 바꾼다.
  async function init() {
    const d = iframe.contentDocument;
    if (!S.alive || !d?.body || !d.location.pathname.endsWith(`/${path}`)) return;   // 다른 문서로 이동한 경우는 두고 본다
    S.fdoc = d;
    S.fwin = iframe.contentWindow;
    if (!d.getElementById("ss-collab-style")) {
      const s = d.createElement("style");
      s.id = "ss-collab-style";
      s.textContent = FRAME_CSS;
      d.head.append(s);
    }
    d.addEventListener("keydown", onKey);
    d.addEventListener("input", onFrameInput);
    if (S.started) {   // 문서가 다시 읽혔다: 편집 중이던 본문은 이미 사라졌다
      if (S.mode === "edit") { exitEdit(); renderAll(); }
      return renderDoc();
    }
    S.started = true;
    S.staticHtml = sanitize(d.body.innerHTML);
    const local = q.get("collab") === "local";
    if (!local && SUPABASE_URL && SUPABASE_KEY) S.backend = new SupabaseBackend(SUPABASE_URL, SUPABASE_KEY);
    else {
      S.backend = new LocalBackend(S.doc, { seedHtml: S.staticHtml });
      S.localOnly = !local;
    }
    hist.querySelector(".cl-local").hidden = !S.localOnly;
    try {
      await refresh();
      if (!S.alive) return;
      S.ready = true;
      S.viewId = S.head.head_id;
      renderAll();
      await renderDoc({ toAnchor: true });
    } catch {
      if (!S.alive) return;
      S.ready = false;
      S.offline = true;   // 정적 사본은 iframe 에 그대로 있다
      S.fwin.scrollTo(0, anchorY());
      renderAll();
      return;
    }
    if (S.alive) S.timer = setInterval(() => { if (document.visibilityState === "visible") poll(); }, POLL_MS);
  }
  const onLoad = () => { init(); };
  iframe.addEventListener("load", onLoad);
  const d0 = iframe.contentDocument;
  if (d0?.readyState === "complete" && d0.location.pathname.endsWith(`/${path}`)) onLoad();
  renderAll();

  return {
    destroy() {
      S.alive = false;
      clearInterval(S.timer);
      abortTranslation();
      iframe.removeEventListener("load", onLoad);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("beforeunload", onBeforeUnload);
      S.fdoc?.removeEventListener("keydown", onKey);
      S.fdoc?.removeEventListener("input", onFrameInput);
      if (S.fdoc) S.fdoc.designMode = "off";
      top.remove();
      hist.remove();
    },
  };
}
