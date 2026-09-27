#!/usr/bin/env python3
"""Rebuild every generated deliverable from its sources.

  python3 tools/build.py            # all steps
  python3 tools/build.py report     # only the final report

Steps: prompts (md -> html), test report (runs npm test), final report
(assemble docs/parts, number figures/tables, table of contents, PDF),
proposal/interim PDFs, code zip.
"""
import html
import json
import pathlib
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DOCS = ROOT / "docs"

PAGE_HEAD = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>{title}</title>
<link rel="stylesheet" href="{css}"></head><body>"""


def pdf(html_path: pathlib.Path, pdf_path: pathlib.Path):
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                    "--virtual-time-budget=15000", f"--print-to-pdf={pdf_path}",
                    html_path.resolve().as_uri()], check=True, capture_output=True)
    pages = subprocess.run(["pdfinfo", str(pdf_path)], capture_output=True, text=True).stdout
    n = re.search(r"Pages:\s+(\d+)", pages).group(1)
    print(f"  {pdf_path.relative_to(ROOT)}: {n} pages")
    return int(n)


# ------------------------------------------------------------------ prompts
def build_prompts():
    for name, title in [("final-prompt", "ShiftSwap — Final prompt"), ("prompt-log", "ShiftSwap — Prompt log"),
                        ("prompt-v1", "ShiftSwap — Prompt v1"), ("prompt-v2", "ShiftSwap — Prompt v2"), ("prompt-v3", "ShiftSwap — Prompt v3"), ("prompt-v4", "ShiftSwap — Prompt v4")]:
        src = ROOT / "prompts" / f"{name}.md"
        if not src.exists():
            continue
        body = subprocess.run(["pandoc", "-f", "gfm", "-t", "html", str(src)],
                              capture_output=True, text=True, check=True).stdout
        out = ROOT / "prompts" / f"{name}.html"
        out.write_text(PAGE_HEAD.format(title=title, css="../docs/web.css") + '<main class="doc">' + body + "</main></body></html>")
        print(f"  {out.relative_to(ROOT)}")


# ------------------------------------------------------------------ tests
def build_test_report():
    junit = ROOT / "docs" / "test-results.xml"
    run = subprocess.run(["node", "--test", "--test-reporter=junit", f"--test-reporter-destination={junit}",
                          *sorted(str(p) for p in (ROOT / "tests").glob("*.test.js"))],
                         cwd=ROOT, capture_output=True, text=True)
    tree = ET.parse(junit)
    cases = []
    for tc in tree.iter("testcase"):
        failed = tc.find("failure") is not None
        skipped = tc.find("skipped") is not None
        cases.append((tc.get("name"), tc.get("file", tc.get("classname", "")), float(tc.get("time", 0)),
                      "fail" if failed else "skip" if skipped else "pass"))
    node_v = subprocess.run(["node", "-v"], capture_output=True, text=True).stdout.strip()
    lock = json.loads((ROOT / "package-lock.json").read_text())
    sqljs = lock.get("packages", {}).get("node_modules/sql.js", {}).get("version", "?")
    passed = sum(1 for c in cases if c[3] == "pass")
    rows = "".join(
        f"<tr class='{s}'><td class='id'>{html.escape(n.split(' ')[0])}</td><td>{html.escape(' '.join(n.split(' ')[1:]))}</td>"
        f"<td>{html.escape(pathlib.Path(f).name) if f else ''}</td><td class='num'>{t*1000:.1f} ms</td><td class='st'>{s}</td></tr>"
        for n, f, t, s in cases)
    from datetime import datetime
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    body = f"""<main class="doc"><h1>Test report</h1>
<p class="lead"><b>{passed} of {len(cases)} tests passed</b> ({len(cases)-passed} failed or skipped). Run on {stamp} with Node {node_v} and sql.js {sqljs}, command <code>npm test</code> (<code>node --test tests/*.test.js</code>). Exit code {run.returncode}.</p>
<p>Unit tests cover the pure rules in <code>app/core/rules.js</code>; service tests run every use case against an in-memory SQLite database created with the same schema and seed data as the deployed app. Test IDs follow spec §11.</p>
<table><thead><tr><th>ID</th><th>Test</th><th>File</th><th>Time</th><th>Result</th></tr></thead><tbody>{rows}</tbody></table>
<p class="small">Raw JUnit output: <a href="test-results.xml">test-results.xml</a></p></main>"""
    out = DOCS / "test-report.html"
    out.write_text(PAGE_HEAD.format(title="ShiftSwap — Test report", css="web.css") + body + "</body></html>")
    print(f"  docs/test-report.html: {passed}/{len(cases)} passed")
    return passed, len(cases)


# ------------------------------------------------------------------ final report
APPENDICES = [
    ("90-appendix-a.html", "appendix-prompt", "Appendix A. Final Vibe-Coding Prompt (v5)", "prompts/final-prompt.md",
     "The complete prompt, verbatim. To reproduce the system it is given to the coding assistant together with the two test files and followed by the specification file spec/spec.md (all in the repository)."),
    ("91-appendix-b.html", "appendix-log", "Appendix B. Prompt Log", "prompts/prompt-log.md",
     "The log of every ambiguity, review finding and change made between prompt versions, verbatim."),
]


def build_appendices():
    (DOCS / "parts" / "92-appendix-c.html").unlink(missing_ok=True)
    for fname, hid, title, src, intro in APPENDICES:
        body = subprocess.run(["pandoc", "-f", "gfm", "-t", "html", "--shift-heading-level-by=2", f"--id-prefix={hid}-", str(ROOT / src)],
                              capture_output=True, text=True, check=True).stdout
        # Tables inside the appendices use the report's caption numbering too.
        (DOCS / "parts" / fname).write_text(
            f'<h1 id="{hid}">{title}</h1>\n<p>{intro} Source file: <code>{src}</code>.</p>\n<div class="appendix small">{body}</div>\n')


def build_report():
    build_appendices()
    parts = sorted((DOCS / "parts").glob("*.html"))
    body = "\n".join(p.read_text() for p in parts)
    fig = tab = 0

    def nf(m):
        nonlocal fig
        fig += 1
        return str(fig)

    def nt(m):
        nonlocal tab
        tab += 1
        return str(tab)
    body = re.sub(r"\{\{fig\}\}", nf, body)
    body = re.sub(r"\{\{tab\}\}", nt, body)
    left = re.findall(r"\{\{\w+\}\}", body)
    assert not left, f"unreplaced placeholders: {left[:5]}"

    # Table of contents from h1/h2 with ids (headings are hand-numbered).
    toc = []
    for level, hid, text in re.findall(r"<h([12])[^>]*\bid=\"([^\"]+)\"[^>]*>(.*?)</h\1>", body, flags=re.S):
        if hid == "title-heading":
            continue
        label = re.sub(r"<[^>]+>", "", text).strip()
        toc.append((int(level), hid, label))
    items, open_sub = [], False
    for level, hid, label in toc:
        if level == 1:
            if open_sub:
                items.append("</ol></li>")
                open_sub = False
            items.append(f'<li><a href="#{hid}">{html.escape(label)}</a>')
            items.append("<ol>")
            open_sub = True
        else:
            items.append(f'<li><a href="#{hid}">{html.escape(label)}</a></li>')
    if open_sub:
        items.append("</ol></li>")
    toc_html = '<nav class="toc" id="contents"><h1 id="toc-heading">Table of Contents</h1><ol>' + "".join(items) + "</ol></nav>"
    toc_html = toc_html.replace("<ol></ol>", "")

    # Put the TOC right after the title page (first element with class title-page).
    # The table of contents goes after the title page, i.e. right before the first chapter-level h1 outside it.
    at = body.find('<h1 id="roles"')
    assert at > 0, "roles heading not found"
    body = body[:at] + toc_html + body[at:]
    out = DOCS / "final-report.html"
    out.write_text(PAGE_HEAD.format(title="ShiftSwap — Final Report (Team 7)", css="report.css").replace('lang="en"', 'lang="en"') + body + "</body></html>")
    n = pdf(out, DOCS / "final-report.pdf")
    print(f"  figures {fig}, tables {tab}, toc entries {len(toc)}")
    return n


def build_other_pdfs():
    for name in ("proposal", "interim"):
        pdf(DOCS / f"{name}.html", DOCS / f"{name}.pdf")


def build_zip():
    dl = ROOT / "downloads"
    dl.mkdir(exist_ok=True)
    out = dl / "shiftswap-code.zip"
    files = subprocess.run(["git", "ls-files", "app", "tests", "package.json", "package-lock.json", "prompts", "spec"],
                           cwd=ROOT, capture_output=True, text=True).stdout.split()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            z.write(ROOT / f, f"shiftswap/{f}")
    print(f"  downloads/shiftswap-code.zip: {len(files)} files, {out.stat().st_size//1024} KB")


if __name__ == "__main__":
    steps = sys.argv[1:] or ["prompts", "tests", "report", "pdfs", "zip"]
    for s in steps:
        print(f"[{s}]")
        {"prompts": build_prompts, "tests": build_test_report, "report": build_report,
         "pdfs": build_other_pdfs, "zip": build_zip}[s]()
