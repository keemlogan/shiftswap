// Hub collaboration (hub/collab.js): version labels and the HTML change highlighter. Pure functions only, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignLabel, tokenizeHtml, diffHtml, josa } from '../hub/collab.js';

/** A version store that applies assignLabel exactly like LocalBackend and the save_version / restore_version SQL. */
function store() {
  const versions = [{ id: 1, label: '1', parent_id: null, is_main: true, kind: 'seed' }];
  const head = { head_id: 1, main_count: 1 };
  let seq = 1;
  const save = (baseId) => {
    const { label, is_main } = assignLabel(versions, head, baseId);
    const id = ++seq;
    versions.push({ id, label, parent_id: baseId, is_main, kind: 'edit' });
    if (is_main) Object.assign(head, { head_id: id, main_count: head.main_count + 1 });
    return { id, label, is_main };
  };
  const restore = (versionId) => {
    const id = ++seq, label = String(head.main_count + 1);
    versions.push({ id, label, parent_id: head.head_id, is_main: true, kind: 'restore', restored_from: versionId });
    Object.assign(head, { head_id: id, main_count: head.main_count + 1 });
    return { id, label };
  };
  return { versions, head, save, restore };
}

// Remove the highlighter markup: unwrap <ins class="ss-ins…">, drop <del class="ss-del…">…</del>.
const strip = (html) => html.replace(/<ins class="ss-ins[^"]*">([\s\S]*?)<\/ins>/g, '$1').replace(/<del class="ss-del[^"]*">[\s\S]*?<\/del>/g, '');
const count = (html, re) => (html.match(re) || []).length;

test('collab: B saves first on v1 → v2 (main); A saves later on v1 → v1.1 (branch); nothing is overwritten', () => {
  const s = store();
  const b = s.save(1);                      // B started from v1 while v1 was the head
  assert.deepEqual([b.label, b.is_main], ['2', true]);
  const a = s.save(1);                      // A also started from v1; the head is now v2
  assert.deepEqual([a.label, a.is_main], ['1.1', false]);
  assert.equal(s.head.head_id, b.id);
  assert.equal(s.versions.length, 3);
});

test('collab: a later branch from v1 is v1.2, a save based on v1.1 is v1.1.1, a save based on the head is the next main', () => {
  const s = store();
  s.save(1);                                // v2
  const v11 = s.save(1);                    // v1.1
  assert.equal(s.save(1).label, '1.2');
  const v111 = s.save(v11.id);
  assert.deepEqual([v111.label, v111.is_main], ['1.1.1', false]);
  assert.equal(s.save(v11.id).label, '1.1.2');
  assert.equal(s.save(v111.id).label, '1.1.1.1');
  const v3 = s.save(s.head.head_id);
  assert.deepEqual([v3.label, v3.is_main], ['3', true]);
  // Main saves are not counted as branches of their parent: the next branch of v2 is v2.1.
  assert.equal(s.save(s.versions.find((v) => v.label === '2').id).label, '2.1');
});

test('collab: restore always creates the next main version; saving on it continues the main line', () => {
  const s = store();
  s.save(1);                                // v2
  const v11 = s.save(1);                    // v1.1
  const r = s.restore(v11.id);
  assert.equal(r.label, '3');
  assert.equal(s.head.head_id, r.id);
  const restored = s.versions.find((v) => v.id === r.id);
  assert.deepEqual([restored.parent_id, restored.restored_from, restored.kind], [s.versions.find((v) => v.label === '2').id, v11.id, 'restore']);
  assert.equal(s.save(r.id).label, '4');
  assert.equal(s.restore(1).label, '5');    // restoring the seed is just another main version
  assert.equal(s.save(v11.id).label, '1.1.1');
});

test('collab: tokenizeHtml splits tags, words, whitespace runs, punctuation and entities, and loses nothing', () => {
  const html = '<p class="a" title="x > y">Hi,  R&amp;D-team é2026 </p>\n<br><!-- note -->';
  const tokens = tokenizeHtml(html);
  assert.deepEqual(tokens, ['<p class="a" title="x > y">', 'Hi', ',', '  ', 'R', '&amp;', 'D', '-', 'team', ' ', 'é2026', ' ', '</p>', '\n', '<br>', '<!-- note -->']);
  assert.equal(tokens.join(''), html);
  assert.deepEqual(tokenizeHtml(''), []);
});

test('collab: diffHtml wraps inserted words in ins and keeps surrounding whitespace outside', () => {
  const r = diffHtml('<p>Hello world</p>', '<p>Hello brave new world</p>');
  assert.equal(r.html, '<p>Hello <ins class="ss-ins ss-hunk">brave new</ins> world</p>');
  assert.equal(r.count, 1);
});

test('collab: diffHtml shows deleted words as del and drops the tags of removed elements', () => {
  const r = diffHtml('<p>Hello brave world</p>', '<p>Hello world</p>');
  assert.equal(count(r.html, /<del class="ss-del ss-hunk">/g), 1);
  assert.match(r.html, /<del class="ss-del ss-hunk">\s?brave\s?<\/del>/);
  assert.equal(strip(r.html), '<p>Hello world</p>');

  const gone = diffHtml('<p>A</p><p>Old paragraph.</p>', '<p>A</p>');
  assert.equal(count(gone.html, /<p>/g), 1, 'the removed <p> is not emitted');
  assert.match(gone.html, /<del class="ss-del ss-hunk">Old paragraph\.<\/del>/);
});

test('collab: diffHtml follows the new document (tags as is, added text wrapped); removing the markup gives the new HTML exactly', () => {
  const before = '<h1 id="s1">1. Need</h1>\n<p>Small stores such as <em>cafés</em> run with few workers.</p>\n<ul><li>One</li><li>Two</li></ul>';
  const after = '<h1 id="s1">1. Need for the system</h1>\n<p>Small stores such as <strong>cafés</strong> and shops run with few workers.</p>\n<p>New paragraph.</p>\n<ul><li>One</li><li>Three</li></ul>';
  const r = diffHtml(before, after);
  assert.equal(strip(r.html), after);
  assert.ok(r.html.includes('<p><ins class="ss-ins'), 'the new paragraph keeps its <p> and its text is wrapped');
  assert.ok(r.html.includes('<strong>'), 'changed tags come from the new document');
  assert.ok(!r.html.includes('<em>'), 'tags of the old document are dropped');
  assert.ok(count(r.html, /<ins /g) >= 3 && r.count >= 3);
  assert.equal(count(r.html, /ss-hunk/g), r.count, 'one ss-hunk marker per counted change');
  for (const m of r.html.matchAll(/<ins [^>]*>([\s\S]*?)<\/ins>/g)) assert.ok(!/[<>]/.test(m[1]), 'no tag inside a highlight');
});

test('collab: diffHtml does not highlight whitespace-only or attribute-only changes', () => {
  for (const [a, b] of [
    ['<p>a b</p>', '<p>a  b</p>'],
    ['<p>a b</p>', '<p>a\n  b</p>'],
    ['<p>a b</p>', '<p>a&nbsp; b</p>'],
    ['<p class="x">text</p>', '<p class="y" style="margin:0">text</p>'],
  ]) {
    const r = diffHtml(a, b);
    assert.equal(r.html, b, `${a} → ${b}`);
    assert.equal(r.count, 0);
  }
  assert.deepEqual(diffHtml('<p>same</p>', '<p>same</p>'), { html: '<p>same</p>', count: 0 });
});

test('collab: diffHtml does not put deleted text between table rows (the parser would move it out of the table)', () => {
  const before = '<table><tbody><tr><td>x</td></tr><tr><td>y</td></tr></tbody></table>';
  const after = '<table><tbody><tr><td>x</td></tr></tbody></table>';
  const r = diffHtml(before, after);
  assert.equal(r.html, after);
  assert.equal(r.count, 0);
  const inCell = diffHtml('<table><tr><td>x y</td></tr></table>', '<table><tr><td>x</td></tr></table>');
  assert.match(inCell.html, /<td>x<del class="ss-del ss-hunk"> y<\/del><\/td>/);
});

test('collab: diffHtml leaves text inside an inline SVG figure unmarked (ins/del would hide it there) and still marks the text around it', () => {
  const oldHtml = '<figure><svg viewBox="0 0 10 10"><text x="1" y="5">Request</text></svg><figcaption>Figure 1. Old flow</figcaption></figure>';
  const newHtml = '<figure><svg viewBox="0 0 10 10"><text x="1" y="5">Swap request</text></svg><figcaption>Figure 1. New flow</figcaption></figure>';
  const d = diffHtml(oldHtml, newHtml);
  assert.equal(d.count, 1);
  assert.match(d.html, /<text x="1" y="5">Swap request<\/text>/);
  assert.match(d.html, /<figcaption>Figure 1\. <del class="ss-del ss-hunk">Old<\/del><ins class="ss-ins">New<\/ins> flow<\/figcaption>/);
  assert.equal(strip(d.html), newHtml);
});

test('collab: diffHtml returns null when the edit exceeds the limit (the caller falls back to changed blocks)', () => {
  const a = Array.from({ length: 60 }, (_, i) => `<p>alpha ${i}</p>`).join('');
  const b = Array.from({ length: 60 }, (_, i) => `<p>omega ${i * 7}</p>`).join('');
  assert.equal(diffHtml(a, b, { maxEditLength: 5 }), null);
  assert.ok(diffHtml(a, b).count > 0);
});

test('collab: Korean particles follow the reading of the last digit (v2를, v3을, v1.1로, v3으로, v3이)', () => {
  assert.equal(josa('2', '을/를'), '를');
  assert.equal(josa('3', '을/를'), '을');
  assert.equal(josa('1.1', '을/를'), '을');
  assert.equal(josa('1.1', '으로/로'), '로');
  assert.equal(josa('3', '으로/로'), '으로');
  assert.equal(josa('2', '으로/로'), '로');
  assert.equal(josa('10', '으로/로'), '으로');
  assert.equal(josa('7', '으로/로'), '로');
  assert.equal(josa('3', '이/가'), '이');
  assert.equal(josa('4', '이/가'), '가');
});
