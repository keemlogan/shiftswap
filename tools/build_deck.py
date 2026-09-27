#!/usr/bin/env python3
"""Build the presentation (PowerPoint + web preview) from one content list.

Run with a Python that has python-pptx:  <venv>/bin/python tools/build_deck.py
Outputs: presentation/ShiftSwap-Team7.pptx, presentation/index.html
"""
import html
import pathlib
import re
import subprocess
import xml.etree.ElementTree as ET

from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN
from pptx.util import Emu, Pt

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "presentation"
OUT.mkdir(exist_ok=True)

INK = RGBColor(0x1C, 0x22, 0x30)
INK2 = RGBColor(0x4A, 0x51, 0x63)
LINE = RGBColor(0xDD, 0xE1, 0xE8)
SHIFT = RGBColor(0x2B, 0x5B, 0xD7)
AMBER = RGBColor(0xE9, 0xA2, 0x3B)
SURFACE = RGBColor(0xF4, 0xF6, 0xF9)
FONT = "Arial"
MONO = "Courier New"

# Facts computed from the repository so the slides never drift from the code.
junit = ET.parse(ROOT / "docs" / "test-results.xml")
TESTS = sum(1 for _ in junit.iter("testcase"))
PASSED = sum(1 for tc in junit.iter("testcase") if tc.find("failure") is None and tc.find("skipped") is None)
LOC = sum(len(p.read_text().splitlines()) for p in list((ROOT / "app").rglob("*.js")) + [ROOT / "app/styles.css", ROOT / "app/index.html"]
          if "vendor" not in p.parts)
TEST_LOC = sum(len(p.read_text().splitlines()) for p in (ROOT / "tests").glob("*.js"))

HW, HD, MK = "Hyewon Kim", "Hyoungdo Kim", "Minkyung Kim"

# Each slide: speaker, minutes, kind, title, content, notes (EN), notes (KO)
SLIDES = [
    dict(who=HD, min=0.5, kind="title", title="ShiftSwap",
         sub="A shift schedule and substitute management system for small part-time workplaces",
         body=["Team 7 · Software Engineering, Fall 2026 · SeoulTech", "Hyewon Kim · Hyoungdo Kim · Minkyung Kim"],
         en="Good afternoon. We are Team 7. Our project is ShiftSwap, a system that manages part-time shift schedules and substitute requests in small stores. Hyewon will present the problem and the requirements, I will present the design and how we built it with vibe coding, and Minkyung will show the system, the tests and our results.",
         ko="안녕하세요, 7조입니다. 저희 프로젝트는 소규모 매장의 아르바이트 근무표와 대타 요청을 관리하는 ShiftSwap입니다. 문제와 요구사항은 혜원, 설계와 바이브 코딩 구현은 제가, 시스템 시연과 테스트·결과는 민경이 발표합니다."),
    dict(who=HW, min=0.8, kind="statement", title="One exam, five phone calls",
         body=["Wednesday 18:00–23:00 — Seoyeon has a midterm exam.",
               "The owner calls co-workers one by one until someone says yes.",
               "Then edits the spreadsheet, and later re-checks two workers' weekly hours for holiday allowance."],
         en="This is a real situation from the café where I work. When a worker cannot come, the owner phones the other workers one at a time. In our store that is usually three to five contacts per request. After someone agrees, the owner edits the spreadsheet, and at month end has to check again whether each of the two workers still qualifies for the weekly holiday allowance.",
         ko="제가 일하는 카페에서 실제로 있는 상황입니다. 근무자가 못 나오면 사장님이 다른 근무자에게 한 명씩 전화합니다. 저희 매장에서는 보통 요청 한 건에 3~5번 연락합니다. 누군가 수락하면 엑셀 근무표를 고치고, 월말에 두 사람의 주휴수당 조건을 다시 확인해야 합니다."),
    dict(who=HW, min=0.9, kind="three", title="Three problems",
         cols=[("P1", "Finding a substitute", "Repeated one-to-one contacts for every request (3–5 in the reference store)."),
               ("P2", "Keeping records right", "Every swap changes the schedule and weekly hours of two workers; all recalculation is manual."),
               ("P3", "Applying pay law", "Minimum wage, 15-hour holiday-allowance threshold, 5-employee premium rule and probation are applied from memory.")],
         en="We grouped the difficulties into three problems. P1 is the cost of finding a substitute. P2 is that every swap changes two workers' schedules and weekly hours, and nothing recalculates them. P3 is that labour-law pay rules are applied from memory, so mistakes are found only on payday, if at all.",
         ko="어려움을 세 가지 문제로 정리했습니다. P1은 대타를 구하는 비용, P2는 대타 한 건마다 두 사람의 근무표와 주간 근로시간이 바뀌지만 다시 계산해 주는 것이 없다는 점, P3는 노동법 급여 규칙을 기억에 의존해 적용해서 실수가 월급날에야 드러난다는 점입니다."),
    dict(who=HW, min=0.9, kind="numbers", title="Requirements in numbers",
         nums=[("3", "actors", "Worker, Owner, System Clock"), ("13", "use cases", "UC-14 added, UC-02 retired"),
               ("22", "functional req.", "FR-01 … FR-23, FR-03 retired"), ("13", "non-functional req.", "Product · Organisational · External"),
               ("14", "business rules", "BR-01 … BR-14, each tested"), ("11", "tables", "SQLite schema")],
         en="From interviews and the legal sources we wrote twenty-one functional requirements and thirteen non-functional requirements, classified as product, organisational and external requirements as in Chapter 8. The core logic is captured in twelve business rules, and the data in twelve tables. This is well above the course minimum of five use cases and four tables.",
         ko="인터뷰 계획과 법령 자료를 바탕으로 기능 요구사항 21개와 비기능 요구사항 13개를 작성했고, 비기능 요구사항은 8장처럼 Product·Organisational·External로 분류했습니다. 핵심 로직은 업무 규칙 12개, 데이터는 테이블 12개입니다. 과제 최소 기준인 유스케이스 5개, 테이블 4개를 충분히 넘습니다."),
    dict(who=HW, min=1.0, kind="image", title="Use cases", img="uml/usecase-substitute.png",
         caption="Substitution use cases with «include» / «extend» (overview of all 12 in the report)",
         en="This diagram shows the substitution part of the use-case model. A worker requests a substitute; the request includes finding eligible candidates. A candidate responds, and the owner approves, which includes recomputing the weekly hours. Cancellation by the worker and expiry by the system clock extend the request use case.",
         ko="대타 관련 유스케이스입니다. 근무자가 대타를 요청하면 가능한 후보 찾기가 포함되고, 후보가 응답하면 사장이 승인하며 승인에는 주간 근로시간 재계산이 포함됩니다. 근무자의 취소와 시스템 시계의 만료 처리는 요청 유스케이스를 확장합니다."),
    dict(who=HW, min=1.0, kind="rules", title="Pay law as testable rules",
         rows=[("BR-06", "Holiday allowance only with ≥ 15 contract hours a week and no absence", "Labor Standards Act Art. 18 ③, 55"),
               ("BR-07", "Holiday hours = min(hours, 40) ÷ 40 × 8", "Enforcement Decree Art. 30"),
               ("BR-08", "50 % premiums only with 5 or more regular employees", "Art. 11, 56"),
               ("BR-09/10", "Warn below KRW 10,320; 90 % only in qualifying probation", "Minimum Wage Act Art. 5 ②")],
         en="The legal rules became business rules that can be tested. For example, the holiday allowance exists only when the contract has at least fifteen hours a week and the worker was not absent; the hours are capped at forty. Because handing a shift over is legally unclear, the attendance effect of a swap is a setting the owner chooses.",
         ko="법 기준을 테스트할 수 있는 업무 규칙으로 바꿨습니다. 예를 들어 주휴수당은 주 소정근로시간이 15시간 이상이고 결근이 없을 때만 생기고, 시간은 40시간을 상한으로 계산합니다. 대타로 넘긴 날의 개근 판정은 법 해석이 분명하지 않아 사장이 고르는 설정값으로 두었습니다."),
    dict(who=HW, min=0.8, kind="three", title="A requirement we changed",
         cols=[("Found", "A dead end", "When nobody's availability matched, the owner was only told 'no candidate' and could do nothing."),
               ("Decided", "Ask everyone, allow 'can't'", "Availability is no longer collected. Every co-worker not already working is asked; the first to accept takes it."),
               ("Result", "A clear ending", "If everyone answers 'can't', the requester is told to call the owner and the owner gets one card to acknowledge.")],
         en="Using the running system showed us a dead end: when nobody's registered availability matched, the owner was told there was no candidate but had nothing to do, and workers had to keep their availability up to date. We changed the requirement. Availability is gone; every co-worker who is not already working is asked, and anyone can answer 'can't'. If all of them do, the request ends clearly: the requester is asked to call the owner, and the owner gets one card to acknowledge. We retired UC-02 and FR-03 instead of reusing their numbers, so traceability stays intact. I now hand over to Hyoungdo.",
         ko="실제로 써 보니 막다른 길이 있었습니다. 등록된 가능 시간에 맞는 사람이 없으면 사장님은 '후보 없음' 알림만 받고 할 수 있는 일이 없었고, 근무자는 가능 시간을 계속 관리해야 했습니다. 그래서 요구사항을 바꿨습니다. 가능 시간을 없애고, 그 시간에 근무가 없는 모든 동료에게 요청을 보내며, 누구나 '불가'로 답할 수 있게 했습니다. 모두 불가라고 하면 요청자에게는 사장님께 연락하라는 안내가, 사장님께는 확인 카드 한 장이 갑니다. UC-02와 FR-03은 번호를 재사용하지 않고 폐기로 표시해 추적성을 유지했습니다. 이제 형도에게 넘기겠습니다."),
    dict(who=HD, min=0.9, kind="image", title="Architecture: a client-only web app", img="uml/component.png",
         caption="Presentation → application services → pure rules → SQLite (sql.js, WebAssembly) → localStorage",
         en="The system runs entirely in the browser, so it can be hosted on GitHub Pages without a server. The user interface calls application services, one per use-case step. The services call pure rule functions that contain no database code, which is why every rule can be unit-tested. The data lives in a real SQLite database compiled to WebAssembly and is saved in the browser.",
         ko="시스템은 전부 브라우저에서 동작해 서버 없이 GitHub Pages에 올릴 수 있습니다. 화면은 유스케이스 단계별 서비스 함수를 부르고, 서비스는 DB 코드가 없는 순수 규칙 함수를 호출합니다. 그래서 모든 규칙을 단위 테스트할 수 있습니다. 데이터는 WebAssembly로 컴파일된 실제 SQLite에 저장되고 브라우저에 보관됩니다."),
    dict(who=HD, min=1.0, kind="image", title="First acceptance wins", img="uml/seq-2-accept.png",
         caption="Sequence SD-2: the second acceptance re-checks the state inside its transaction and is refused",
         en="The most delicate interaction is two candidates accepting at almost the same time. Each acceptance runs in one transaction that first re-reads the request state. Only the first finds it REQUESTED; the second sees ACCEPTED, rolls back, and the worker is told who already took the shift.",
         ko="가장 까다로운 상호작용은 두 후보가 거의 동시에 수락하는 경우입니다. 수락은 하나의 트랜잭션 안에서 먼저 요청 상태를 다시 읽습니다. 첫 번째만 REQUESTED를 보고, 두 번째는 ACCEPTED를 보고 롤백하며 누가 이미 수락했는지 안내받습니다."),
    dict(who=HD, min=0.9, kind="image", title="Life of a substitute request", img="uml/state-subrequest.png",
         caption="State diagram: REQUESTED → ACCEPTED → APPROVED / REJECTED, with EXPIRED and CANCELLED",
         en="This state diagram is the contract between screens, services and tests: every transition has a triggering function and at least one test. For example, a request that reaches its deadline or its shift start without approval expires automatically.",
         ko="이 상태 다이어그램은 화면·서비스·테스트 사이의 약속입니다. 모든 전이에는 호출 함수와 테스트가 하나 이상 있습니다. 예를 들어 마감이나 근무 시작까지 승인되지 않은 요청은 자동으로 만료됩니다."),
    dict(who=HD, min=1.4, kind="iterations", title="Vibe coding: seven prompt versions",
         rows=[("v1", "Specification + technology, screens, design, done criteria", "App built; 21 ambiguities logged by the build"),
               ("v2", "Ambiguities and document-review gaps resolved in the spec", "Acknowledgement column, notification recipients, S7 walkthrough"),
               ("v3", "UI review of the running app", "Time-grid board, page purposes, overview strip, empty states"),
               ("v4", "UX redesign review: task-first, one primary action", "Role Home screens, 3-step request flow, consequences shown before commit"),
               ("v5", "Rebuild in an empty folder + independent code review", "Tests become input; 7 defects fixed"),
               ("v6", "Requirements change after using the app", "Availability removed; 'can't' answer; FAILED ending"),
               ("v7", "Owner request: history and automatic payroll", "Contract history seeded; last month's draft on the 1st")],
         en="We did not write code by hand. We wrote one prompt that treats the specification as a contract, and let the AI coding assistant build the system. Every ambiguity the build found went into a prompt log and back into the specification. Seven versions were needed. The last one came from re-running the prompt in an empty folder: the rebuilt system worked, but its function signatures differed from ours, so version five supplies our test files as the contract. I hand over to Minkyung.",
         ko="코드를 손으로 쓰지 않았습니다. 명세를 계약으로 넣은 프롬프트 하나를 작성해 AI 코딩 도구가 시스템을 만들게 했습니다. 빌드 중 발견된 모호점은 모두 프롬프트 로그에 기록하고 명세에 반영해 일곱 번의 버전을 거쳤습니다. 마지막 버전은 빈 폴더에서 프롬프트를 다시 실행해 본 결과로 나왔습니다. 시스템은 동작했지만 함수 형태가 달라서, v5에서는 저희 테스트 파일을 계약으로 함께 넣습니다. 민경에게 넘기겠습니다."),
    dict(who=MK, min=1.2, kind="image", title="Demo: the request comes to you", img="docs/img/ui-05-inbox.png",
         caption="Minho's Home: the request card shows the effect on his week before he taps Accept (one tap, NFR-01)",
         en="Here is the system with our demo café. Seoyeon requested a substitute for Wednesday. The system asked the three co-workers who are free at that time, all at once. Minho does not have to look for it: his Home screen shows the request first, together with what accepting means for him — sixteen to twenty-one hours this week, holiday allowance unchanged. One tap accepts. When Doyun tries a moment later, he is told Minho was faster.",
         ko="데모 카페로 시스템을 보여 드리겠습니다. 서연이 수요일 대타를 요청하자 시스템이 그 시간에 근무가 없는 동료 세 명에게 한 번에 요청을 보냈습니다. 민호는 요청을 찾을 필요가 없습니다. 홈 화면 맨 위에 요청과 함께, 수락하면 이번 주가 16시간에서 21시간이 되고 주휴수당은 그대로라는 결과가 먼저 보입니다. 한 번 탭하면 수락되고, 잠시 뒤 도윤이 수락하려 하면 민호가 먼저 수락했다는 안내가 나옵니다."),
    dict(who=MK, min=1.2, kind="image", title="The owner decides on one card", img="docs/img/ui-06-approval.png",
         caption="Owner Home: '1 thing to handle today' — the swap, its effect on both workers, and one Approve button",
         en="The owner opens the app and sees one thing to handle today. The card states the effect on both workers. Minho's scheduled hours rise from sixteen to twenty-one, but his contract hours stay sixteen, so he keeps the holiday allowance of three point two hours, which is 33,024 won. After approval the board shows the handover in amber.",
         ko="사장님이 앱을 열면 오늘 처리할 일 한 건이 보이고, 카드에 두 사람에게 미치는 영향이 적혀 있습니다. 민호의 이번 주 근무 시간은 16시간에서 21시간으로 늘지만 소정근로시간은 16시간 그대로라 주휴 3.2시간, 33,024원이 유지됩니다. 승인하면 근무표에 호박색으로 넘김이 표시됩니다."),
    dict(who=MK, min=0.9, kind="image", title="Month end: payroll prepares itself", img="docs/img/ui-10-payroll.png",
         caption="Doyun's wage is below the 2026 minimum: 'Confirm September pay' stays disabled, with the reason, until acknowledged",
         en="On the first day of each month the system prepares last month's payroll as a draft and tells the owner. March to August are already confirmed from the employees' contracts. Doyun's hourly wage is below the 2026 minimum wage, so the row is flagged and the month cannot be confirmed until the owner acknowledges the warning.",
         ko="매월 1일에는 시스템이 지난달 급여 초안을 자동으로 만들어 사장님께 알립니다. 3월부터 8월까지는 계약 기록을 바탕으로 이미 확정되어 있습니다. 도윤의 시급이 2026년 최저임금보다 낮아 경고가 표시되고, 사장이 확인하기 전에는 확정할 수 없습니다."),
    dict(who=MK, min=1.0, kind="numbers", title="Testing",
         nums=[(f"{PASSED}/{TESTS}", "tests pass", "npm test, Node test runner"), ("14/14", "business rules tested", "every BR has ≥ 1 test"), ("89/89", "tests pass in a clean rebuild", "final prompt v7 re-run in an empty folder"),
               ("21/21", "FRs traced", "FR → UC → screen → function → test"), ("2", "screen widths", "360 px and 1440 px, no horizontal scroll")],
         en=f"All {TESTS} automated tests pass. They include boundary values such as fourteen point nine nine versus fifteen hours, the forty-hour cap, both attendance policies, and the concurrent acceptance. The traceability matrix in the report links every functional requirement to its use case, screen, function and tests.",
         ko=f"자동 테스트 {TESTS}개가 모두 통과합니다. 14.99시간과 15시간 같은 경계값, 40시간 상한, 두 가지 개근 정책, 동시 수락을 포함합니다. 보고서의 추적 매트릭스는 모든 기능 요구사항을 유스케이스, 화면, 함수, 테스트와 연결합니다."),
    dict(who=MK, min=1.0, kind="results", title="Results and limits",
         rows=[("Achieved", "0 owner contacts per request · 2-click accept · automatic recomputation for both workers · legal checks before payday"),
               ("Size", f"13 use cases · 11 tables · {LOC:,} lines of application code · {TEST_LOC:,} lines of tests"),
               ("Limits", "Demo accounts without passwords · data stays in one browser · no messaging outside the app"),
               ("Next", "Server-side database and login · KakaoTalk notifications · field test in the reference store")],
         en="To sum up: the owner no longer contacts workers one by one, candidates answer in two clicks, and every swap updates both workers' hours and pay eligibility. The limits are those of a client-only demo: no real login and data kept in one browser. The next step would be a server and a field test in the café. Thank you. We are happy to take questions.",
         ko="정리하면, 사장은 더 이상 한 명씩 연락하지 않고, 후보는 두 번의 클릭으로 응답하며, 대타 한 건마다 두 사람의 시간과 주휴 조건이 자동으로 갱신됩니다. 한계는 클라이언트 데모라서 실제 로그인이 없고 데이터가 한 브라우저에만 남는다는 점입니다. 다음 단계는 서버를 두고 실제 카페에서 시험하는 것입니다. 감사합니다. 질문 받겠습니다."),
]

# ------------------------------------------------------------------ pptx
W, H = Emu(12192000), Emu(6858000)  # 16:9
prs = Presentation()
prs.slide_width, prs.slide_height = W, H
BLANK = prs.slide_layouts[6]
M = Emu(640000)  # outer margin


def text(slide, x, y, w, h, s, size=18, bold=False, color=INK, font=FONT, align=PP_ALIGN.LEFT):
    box = slide.shapes.add_textbox(x, y, w, h)
    tf = box.text_frame
    tf.word_wrap = True
    lines = s if isinstance(s, list) else [s]
    for i, line in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        r = p.add_run()
        r.text = line
        r.font.size, r.font.bold, r.font.color.rgb, r.font.name = Pt(size), bold, color, font
        p.space_after = Pt(size * 0.5)
    return box


def rect(slide, x, y, w, h, fill, line=None):
    shp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, h)
    shp.fill.solid()
    shp.fill.fore_color.rgb = fill
    if line:
        shp.line.color.rgb = line
        shp.line.width = Pt(1)
    else:
        shp.line.fill.background()
    shp.shadow.inherit = False
    return shp


def chrome(slide, n, s):
    rect(slide, 0, 0, Emu(120000), H, AMBER if s["who"] == HD else SHIFT if s["who"] == HW else INK)
    text(slide, M, Emu(430000), W - 2 * M, Emu(700000), s["title"], size=30, bold=True)
    text(slide, M, H - Emu(520000), W - 2 * M, Emu(300000), f"{n} / {len(SLIDES)}   ·   {s['who']}", size=11, color=INK2)


def add_picture_fit(slide, path, x, y, w, h):
    im = Image.open(path)
    r = min(w / im.width, h / im.height)
    pw, ph = int(im.width * r), int(im.height * r)
    slide.shapes.add_picture(str(path), x + (w - pw) // 2, y + (h - ph) // 2, pw, ph)


for n, s in enumerate(SLIDES, 1):
    sl = prs.slides.add_slide(BLANK)
    top = Emu(1250000)
    if s["kind"] == "title":
        rect(sl, 0, 0, W, H, INK)
        rect(sl, M, Emu(2300000), Emu(900000), Emu(90000), AMBER)
        text(sl, M, Emu(2500000), W - 2 * M, Emu(1200000), s["title"], size=60, bold=True, color=RGBColor(255, 255, 255))
        text(sl, M, Emu(3500000), Emu(9000000), Emu(900000), s["sub"], size=22, color=RGBColor(0xD6, 0xDB, 0xE5))
        text(sl, M, Emu(5000000), W - 2 * M, Emu(900000), s["body"], size=14, color=RGBColor(0xB9, 0xC0, 0xCE))
    else:
        chrome(sl, n, s)
    k = s["kind"]
    if k == "statement":
        text(sl, M, top + Emu(200000), Emu(10400000), Emu(4000000), s["body"], size=26)
    elif k == "three":
        cw = (W - 2 * M - Emu(400000)) // 3
        for i, (tag, head, body) in enumerate(s["cols"]):
            x = M + i * (cw + Emu(200000))
            rect(sl, x, top + Emu(200000), cw, Emu(3800000), SURFACE)
            text(sl, x + Emu(200000), top + Emu(350000), cw - Emu(400000), Emu(500000), tag, size=16, bold=True, color=SHIFT, font=MONO)
            text(sl, x + Emu(200000), top + Emu(850000), cw - Emu(400000), Emu(700000), head, size=22, bold=True)
            text(sl, x + Emu(200000), top + Emu(1700000), cw - Emu(400000), Emu(2200000), body, size=16, color=INK2)
    elif k == "numbers":
        cols = 3 if len(s["nums"]) > 4 else len(s["nums"])
        cw = (W - 2 * M) // cols
        for i, (num, lab, sub) in enumerate(s["nums"]):
            x = M + (i % cols) * cw
            y = top + Emu(200000) + (i // cols) * Emu(2000000)
            text(sl, x, y, cw - Emu(200000), Emu(900000), num, size=48, bold=True, color=SHIFT)
            text(sl, x, y + Emu(900000), cw - Emu(200000), Emu(400000), lab, size=18, bold=True)
            text(sl, x, y + Emu(1300000), cw - Emu(200000), Emu(500000), sub, size=13, color=INK2)
    elif k == "image":
        add_picture_fit(sl, ROOT / s["img"], M, top, W - 2 * M, Emu(4450000))
        text(sl, M, top + Emu(4500000), W - 2 * M, Emu(400000), s["caption"], size=13, color=INK2)
    elif k in ("rules", "iterations", "results"):
        rows = s["rows"]
        ncol = len(rows[0])
        tbl = sl.shapes.add_table(len(rows), ncol, M, top + Emu(200000), W - 2 * M, Emu(700000) * len(rows)).table
        widths = {2: [0.16, 0.84], 3: [0.12, 0.48, 0.40]}[ncol]
        for c, f in enumerate(widths):
            tbl.columns[c].width = int((W - 2 * M) * f)
        for r, row in enumerate(rows):
            for c, val in enumerate(row):
                cell = tbl.cell(r, c)
                cell.fill.solid()
                cell.fill.fore_color.rgb = SURFACE if c == 0 else RGBColor(255, 255, 255)
                cell.text = val
                p = cell.text_frame.paragraphs[0]
                p.runs[0].font.size = Pt(15 if c else 14)
                p.runs[0].font.bold = c == 0
                p.runs[0].font.name = MONO if c == 0 else FONT
                p.runs[0].font.color.rgb = INK
    notes = sl.notes_slide.notes_text_frame
    notes.text = f"[{s['who']} · about {s['min']} min]\n{s['en']}"

pptx_path = OUT / "ShiftSwap-Team7.pptx"
prs.save(pptx_path)

# ------------------------------------------------------------------ web preview
def slide_html(n, s):
    k = s["kind"]
    if k == "title":
        inner = f"<div class='title'><i></i><h2>{s['title']}</h2><p class='sub'>{html.escape(s['sub'])}</p>" + "".join(f"<p class='meta'>{html.escape(b)}</p>" for b in s["body"]) + "</div>"
    else:
        head = f"<h3>{html.escape(s['title'])}</h3>"
        if k == "statement":
            inner = head + "<div class='stmt'>" + "".join(f"<p>{html.escape(b)}</p>" for b in s["body"]) + "</div>"
        elif k == "three":
            inner = head + "<div class='three'>" + "".join(f"<div><b>{t}</b><strong>{html.escape(h)}</strong><p>{html.escape(b)}</p></div>" for t, h, b in s["cols"]) + "</div>"
        elif k == "numbers":
            inner = head + "<div class='nums'>" + "".join(f"<div><span>{html.escape(a)}</span><strong>{html.escape(b)}</strong><small>{html.escape(c)}</small></div>" for a, b, c in s["nums"]) + "</div>"
        elif k == "image":
            inner = head + f"<figure><img src='../{s['img']}' alt='{html.escape(s['caption'])}'><figcaption>{html.escape(s['caption'])}</figcaption></figure>"
        else:
            inner = head + "<table>" + "".join("<tr>" + "".join(f"<td>{html.escape(v)}</td>" for v in row) + "</tr>" for row in s["rows"]) + "</table>"
    cls = {HW: "hw", HD: "hd", MK: "mk"}[s["who"]]
    return f"<section class='slide {cls} {k}' id='s{n}'>{inner}<footer>{n} / {len(SLIDES)} · {s['who']}</footer></section>"


total = sum(s["min"] for s in SLIDES)
per = {p: sum(s["min"] for s in SLIDES if s["who"] == p) for p in (HW, HD, MK)}
script = "".join(
    f"<tr><td class='n'><a href='#s{n}'>{n}</a></td><td>{s['who']}<br><small>{s['min']} min</small></td><td><b>{html.escape(s['title'])}</b><p>{html.escape(s['en'])}</p><p class='ko' lang='ko'>{html.escape(s['ko'])}</p></td></tr>"
    for n, s in enumerate(SLIDES, 1))
page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ShiftSwap · Presentation</title><link rel="stylesheet" href="deck.css"></head><body>
<header class="top"><h1>Presentation · Team 7</h1><p>{len(SLIDES)} slides, about {total:.0f} minutes: {HW} {per[HW]:.1f} min, {HD} {per[HD]:.1f} min, {MK} {per[MK]:.1f} min.
<a href="ShiftSwap-Team7.pptx">Download PowerPoint (.pptx)</a></p></header>
<main>{''.join(slide_html(n, s) for n, s in enumerate(SLIDES, 1))}
<h2 id="script">Speaker script and timing</h2><p>English script as in the PowerPoint speaker notes, with a Korean translation for rehearsal.</p>
<table class="script"><thead><tr><th>#</th><th>Speaker</th><th>Script</th></tr></thead><tbody>{script}</tbody></table></main></body></html>"""
(OUT / "index.html").write_text(page)
print(f"{pptx_path.relative_to(ROOT)}: {len(SLIDES)} slides, {total:.1f} min ({', '.join(f'{k} {v:.1f}' for k, v in per.items())})")
