# ShiftSwap — Final Vibe-Coding Prompt (v4)

> Version history: v1 → v2 after iteration 1 (build ambiguities and document review), v2 → v3 after iteration 2 (UI review of the running app), v3 → v4 after iteration 3 (UX redesign review from the point of view of a consumer-app product team: task-first home screens, one primary action per screen, consequences shown before committing). Earlier versions are kept as `prompts/prompt-v1.md`, `prompts/prompt-v2.md` and `prompts/prompt-v3.md`; the reasons for every change are in `prompts/prompt-log.md`.
>
> How to use: paste this whole prompt, followed by the complete contents of `spec/spec.md`, into a coding agent that can create files and run shell commands, in an empty folder. The agent must produce the same system that is deployed at https://keemlogan.github.io/shiftswap/app/.

---

You are building **ShiftSwap**, a shift schedule and substitute management web application for a small café with part-time workers. The complete specification (actors, use cases UC-01…UC-13, functional requirements FR-01…FR-21, non-functional requirements NFR-01…NFR-12, business rules BR-01…BR-12, states, SQLite schema, seed data, test IDs) follows this prompt. Treat the specification as the contract: use its identifiers, table and column names, state names and seed data exactly. Do not add features that are not in it.

## 1. Technology constraints

- Static site only: `index.html`, CSS, and JavaScript ES modules. No build step, no framework, no server. It must work when the folder is served by GitHub Pages under the sub-path `/shiftswap/app/` (use only relative URLs).
- Database: SQLite in the browser with **sql.js** (WebAssembly). Vendor `sql-wasm.js` and `sql-wasm.wasm` into `app/vendor/` (copy them from the `sql.js` npm package) so the app does not depend on a CDN at runtime.
- Persistence: after every committed transaction, export the database and save it to `localStorage` under the key `shiftswap.db.v1` (base64). The demo clock is stored under `shiftswap.clock.v1` and the language under `shiftswap.lang`. On start, load them if present, otherwise create the schema and insert the seed data. Provide "Reset demo data" in the header menu; it also resets the clock to `2026-09-28T09:00`.
- Folder layout:
  - `app/index.html`, `app/styles.css`, `app/main.js` (router + bootstrap)
  - `app/core/db.js` — init, schema (exactly the SQL of spec §8), seed (spec §10), `tx(fn)` helper that runs `BEGIN`…`COMMIT` / `ROLLBACK` and persists after commit, `all(sql, params)`, `get(sql, params)`, `run(sql, params)`.
  - `app/core/clock.js` — demo clock: `now()` returns the stored demo datetime (default `2026-09-28T09:00`), `setNow(iso)`, `advance(minutes)`.
  - `app/core/rules.js` — pure functions only (no DB, no DOM): `overlaps`, `durationHours` (supports end ≤ start as next day), `weekStartOf`, `isEligibleCandidate`, `validateRequest`, `contractHours`, `computeWeeklySummary`, `holidayHours`, `premiumHours`, `minimumWageFor`, `probationApplies`, `computePayrollRow`. Each function has a JSDoc comment citing the BR it implements.
  - `app/core/services.js` — one exported function per use-case step, each running inside `tx()`: `registerWorker`, `saveFixedSchedule`, `saveAvailability`, `generateWeek`, `editShift`, `createSubRequest`, `respondToRequest`, `decideRequest`, `cancelRequest`, `expireOverdue`, `recordAttendance`, `confirmAttendance`, `markAbsent`, `recomputeWeek`, `generatePayroll`, `confirmPayroll`, `updateSettings`, `listNotifications`, `markNotificationsRead`, `acknowledgeMinWage`. Services call rules for every decision and write Notification rows exactly as the recipients table in spec §8 says. `services.js` also exports read-only query functions for the screens (not wrapped in `tx`), e.g. `getWeekShifts`, `listMyRequests`, `listOwnerRequests`, `getApprovalPreview`, `getPayroll`, `unreadCount`, `defaultDeadline`, and a `ServiceError(code, message, params)` class that the UI translates by `code`. It also exports the pure function `menuFor(role)` returning the navigation items a role may open (the router uses it to hide menus and to redirect routes the role may not open, FR-20), and home-screen queries `getWorkerHome(workerId)` and `getOwnerHome()` that return, in one call, every item §2.3 / §2.5 needs (including the before/after effect of accepting or approving).
  - `app/ui/` — one module per screen: `login.js`, `schedule.js` (weekly board, both roles), `requests.js` (worker: my requests + new request form), `inbox.js`, `approvals.js` (owner), `attendance.js`, `weekly.js` (owner weekly summary), `payroll.js`, `workers.js` (owner: workers, fixed schedules), `availability.js` (worker), `settings.js` (owner: workplace + minimum wage), `i18n.js` (translations plus shared helpers: HTML escaping, number/date/money formatting, the form error box).
  - `tests/rules.test.js` and `tests/services.test.js` run with `node --test` (use the `sql.js` npm package in Node for service tests). Name each test with its spec test ID (e.g. `TC-081 holiday allowance at exactly 15 h`).
  - `package.json` with `"type": "module"` and script `"test": "node --test tests/*.test.js"` (a bare directory argument fails on Node 24).
- `expireOverdue()` (the System Clock actor, UC-11) runs on app start, on every route change, and after the demo clock changes.

## 2. Screens and behaviour

### 2.0 UX principles (apply to every screen; they override any screen description that seems to conflict)

1. **One screen, one job.** Every screen has exactly one primary action, drawn as the only filled blue button on that screen. On screens narrower than 900 px the primary action is a full-width button fixed to the bottom (16 px side inset, above the tab bar, `env(safe-area-inset-bottom)` respected). Other actions are grey filled (secondary) or text buttons.
2. **What needs me comes first.** Each role opens on a **Home** screen that lists the things waiting for this person right now, most urgent first, and each item carries its own action button, so the user never has to find the right menu.
3. **Show the consequence before the commitment.** Whenever an action changes someone's hours or pay (accepting, approving, confirming payroll), the screen states the effect in one plain sentence plus numbers before the button — e.g. "민호님 이번 주 16시간 → 21시간 · 주휴수당 변화 없음 (33,024원 유지)".
4. **Ask one thing at a time.** Requesting a substitute is a three-step flow (choose shift → reason and deadline → review and send) with a step indicator ("1/3"), a back button, and a review screen that names the people who will receive the request.
5. **Say what happened and what happens next.** After every action show a result screen or a toast that states the outcome and the next step — e.g. "민호님, 도윤님에게 요청을 보냈어요. 누군가 수락하면 알려 드릴게요." — never a silent state change.
6. **Status as progress.** A substitute request is shown everywhere as a three-step tracker 요청 → 수락 → 승인 (Requested → Accepted → Approved); REJECTED, EXPIRED and CANCELLED are shown as a clearly labelled end state with the reason.
7. **The user's words.** The default UI language is Korean in polite 해요체 ("대타를 구하고 있어요"), with a complete English translation selectable in the menu. IDs such as FR/UC/BR, status codes and table names never appear in the UI. Dates read like "9월 30일(수) 18:00–23:00" / "Wed, Sep 30 · 18:00–23:00"; relative times where they help ("내일 21:00까지", "D-2").
8. **Nothing blocks without a reason.** A disabled button always has a one-line explanation beneath it (e.g. "최저임금 경고 1건을 확인해야 확정할 수 있어요").

### 2.1 Navigation

- Worker tabs: **홈** (Home), **근무표** (Schedule), **대타** (Swaps), **내 정보** (Me: availability and attendance). Owner tabs: **홈**, **근무표**, **직원** (Staff: workers and fixed schedules), **급여** (Pay: weekly summary and monthly payroll). **설정** (Settings), language and sign-out are in the header menu.
- ≥ 900 px: left navigation (220 px) with the same items and inline SVG line icons; < 900 px: bottom tab bar (64 px, icon + label), hidden while the request flow is open.
- Header: store name; a bell icon with the unread count opening the notification list (FR-21); the compact demo clock chip ("9/28(월) 09:00") that opens **Demo tools**; the current person's name with **다른 사람으로 보기** (switch account) that opens the account list without resetting data.
- **Demo tools** panel (sheet on mobile, popover on desktop): demo clock date-time input, **+1시간**, **+1일**, **데모 데이터 초기화** (Reset demo data, asks for confirmation in the panel itself). The clock no longer sits permanently in the header.

### 2.2 Sign-in = demo guide (UC-13)

- Title "달빛카페 데모" and one sentence: "비밀번호 없이 사람을 골라 체험해요."
- A **3분 체험** (3-minute tour) card listing three numbered steps — the order matters, so numbers are used: ① 이서연으로 대타 요청 보기 ② 최민호로 수락하기 ③ 박지영 사장님으로 승인하기. Each step has a button that signs in as that person and opens the screen where the step happens (Swaps / Home / Home). The card marks steps already done in this browser.
- Below, **모든 계정**: each account with name, role and its one-line summary (owner: "사장님 · 달빛카페 · 직원 4명"; worker: fixed shifts and weekly contract hours, e.g. "월·수 18:00–23:00 · 주 10시간").
- The chosen account is kept in `sessionStorage`.

### 2.3 Worker Home

In this order, each section omitted when empty:
1. Greeting "서연님, 안녕하세요" and today's date.
2. **대타 요청이 왔어요** — one card per PENDING target: who asks, the shift ("9월 30일(수) 18:00–23:00"), reason, deadline countdown ("내일 21:00까지 답해 주세요"), the effect on me ("수락하면 이번 주 16시간 → 21시간 · 주휴수당 그대로"), and two buttons **수락하기** (primary) / **거절** (text). Accept is one tap (NFR-01). After accepting: result toast "수요일 근무를 맡았어요. 사장님 승인을 기다려요." If someone else was faster: "민호님이 먼저 수락했어요" and the card closes.
3. **내가 보낸 요청** — tracker cards for the worker's open requests with who has answered so far and a text button **요청 취소**.
4. **다음 근무** — a large card with date, time, D-day and the button **이 근무 대타 구하기** (starts the flow with this shift preselected).
5. **이번 주** — scheduled hours, contract hours, and holiday allowance in words and money: eligible "주휴수당 받아요 · 약 33,024원" or not "계약이 주 15시간 미만이라 주휴수당이 없어요 (주 10시간)", with a bar showing contract hours against the 15-hour line.
6. **기록할 근무** — past own shifts without attendance, each with **기록하기**.

### 2.4 Request substitute flow (UC-04, UC-12)

- Step 1 "어떤 근무를 바꿀까요?": own future SCHEDULED shifts as selectable cards; a shift that already has an open request is shown disabled with "이미 대타를 구하고 있어요".
- Step 2 "사유와 마감을 정해 주세요": reason chips 시험 / 병원 / 가족 행사 / 개인 사정 / 직접 입력 (optional); deadline chips "24시간 뒤" / "근무 2시간 전" / "직접 선택", default = the earlier of now + 24 h and shift start (BR-03); the chosen deadline is shown as a sentence.
- Step 3 "이렇게 보낼게요": summary of shift, reason and deadline, and **받는 사람** — the eligible candidates computed now (BR-01) with names, or the warning "지금 가능한 사람이 없어요. 보내면 사장님께 알려 드려요." (FR-08). Primary **대타 요청 보내기**.
- Result screen: the tracker at step 1, the recipients, and **홈으로**.
- **대타** tab: sections **받은 요청** (same cards as Home), **보낸 요청** (tracker cards with cancel), **지난 요청** (collapsed history with end states). Primary action of the tab: **대타 구하기**.

### 2.5 Owner Home

1. Heading "오늘 처리할 일 N개" (or "지금 처리할 일이 없어요" with the week's summary).
2. **승인 기다리는 대타** — a decision card per ACCEPTED request: the sentence "서연님의 9월 30일(수) 18:00–23:00 근무를 민호님이 대신해요", then one impact line per person (scheduled hours before → after this week, holiday allowance status and amount before → after; a changed eligibility is highlighted in amber with the words "주휴수당이 바뀌어요"), then **승인하기** (primary) / **거절** (text). A **자세히** toggle shows the full FR-11 before/after table.
3. **답을 기다리는 요청** — open REQUESTED requests with deadline countdown and each candidate's response.
4. **확인할 출근 기록** — recorded but unconfirmed attendance with **확인** / **결근 처리**.
5. **급여 경고** — unacknowledged minimum-wage warnings of the current draft, linking to Pay.
6. **오늘 근무** — who works today and when; **이번 주** — shifts, hours and the estimated holiday-allowance total.

### 2.6 Schedule (UC-03)

- ≥ 900 px: the time grid of v3 (day columns Mon–Sun, hour axis from earliest start to latest end rounded to whole hours, 44 px per hour, hourly lines, today marked, blocks positioned by time, overlapping shifts side by side). < 900 px: day-by-day list with today first expanded.
- Tapping a shift opens a detail sheet (mobile) or side panel (desktop) with its details, its history ("서연 → 민호 · 9/28 승인") and only the actions relevant to the viewer: the worker's own future shift → **대타 구하기**; owner → **시간 바꾸기**, **담당자 바꾸기**, **삭제** (refused with the reason when it has a request or attendance, FR-05).
- Owner: when the displayed week has no shifts, the empty state's primary button is **이번 주 근무표 만들기** (FR-04); otherwise the primary button is **근무 추가**. Week navigation: previous / next / 이번 주.
- The handover and pending markers of §3 are used here and on every shift card elsewhere.

### 2.7 Pay (owner; UC-08, UC-09)

- Two segments: **주간 집계** and **월 급여**; period chosen with ‹ › buttons ("2026년 9월").
- Weekly summary: one card per worker: contract hours, scheduled/actual hours, eligibility as words with the reason ("계약 주 10시간 · 15시간 미만"; "9/29(화) 결근") and holiday hours/amount.
- Monthly payroll: primary **9월 급여 초안 만들기** when no draft exists; then one card (mobile) / row (desktop) per worker with base hours, base pay, holiday pay, premium, total and flags (예상치 = estimated, 수습 최저임금 90 %, 최저임금 미만). A below-minimum row shows the sentence "도윤님 시급 10,000원이 2026년 최저임금 10,320원보다 낮아요" and **확인했어요** (`acknowledgeMinWage`). The sticky primary **9월 급여 확정하기** is disabled with its reason until all warnings are acknowledged; confirmed months are read-only and say so.

### 2.8 Staff, Me, Settings

- **직원** (UC-01): worker cards (name, contract hours per week, hourly wage, contract period); tapping opens the worker's detail with the fixed-schedule editor: weekday chips + start/end time selects, one row per weekday, add/remove; save shows the resulting weekly contract hours. Primary **직원 추가**.
- **내 정보** (UC-02, UC-07): availability editor with the same weekday-chip pattern ("대타 가능한 시간") and the list of attendance records; the worker's own phone and wage are visible here only.
- **설정** (UC-10): store name, number of regular employees with the sentence of what it changes ("5명 이상이면 연장·야간 가산수당이 붙어요"), the substitution-attendance policy as two radio cards each explaining the effect in one sentence, and the minimum-wage table.
- Notifications list: each notification as a sentence with time; actionable ones link to the card where the action is.
- Role guard: a worker never sees other workers' phone numbers or wages (NFR-11).

## 3. Visual design (do not deviate)

- Font: Pretendard Variable for everything (`https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css`) with `font-variant-numeric: tabular-nums` on times, hours and money. No second font. Korean: `word-break: keep-all`.
- Type scale: body 16 px / 1.6; home heading 26 px / 700 / −0.02em; card title 17 px / 700; key number 28 px / 700; caption 13 px (never below 12 px).
- Colors: `--ink #191F28`, `--ink-2 #4E5968`, `--ink-3 #8B95A1`, `--surface #F2F4F6` (page background), `--paper #FFFFFF` (cards), `--line #E5E8EB`, `--shift #2B5BD7` (primary and own shifts), `--shift-soft #EBF1FD`, `--handover #E9A23B`, `--handover-soft #FDF3E1`, `--alert #D93A30`, `--alert-soft #FDECEB`, `--ok #1F8A55`.
- Cards: white on the grey page, 16 px radius, 20 px padding (24 px ≥ 900 px), no border, no shadow; 12 px between cards, 32 px between sections.
- Buttons: height 52 px on mobile / 44 px on desktop, 12 px radius, 16 px / 600 label; primary filled `--shift`; secondary filled `#E8EBF0` with `--ink`; text buttons `--ink-2`; pressed state `scale(0.96)`; minimum touch target 44 × 44 px.
- Icons: inline SVG line icons (24 px, 1.75 px stroke, `currentColor`) for tabs, bell, clock, chevrons; no icon fonts, no emoji.
- Signature element: a handed-over shift has a 6 px amber left edge and a subtle 45° amber stripe (`repeating-linear-gradient`, the only gradient), the new worker's name in bold and the original worker struck through; a shift with an open request has a dashed amber outline and the chip "대타 구하는 중".
- Motion: sheets and step changes slide/fade in 180 ms `cubic-bezier(0.2, 0, 0, 1)`; no motion under `prefers-reduced-motion`.
- Layout: content max-width 720 px for Home, flows and lists (centred in the content area), full width up to 1200 px for the schedule grid and payroll table; at 360 px no horizontal scroll.
- Accessibility: visible focus rings, real `<button>`s, labelled inputs, status never by colour alone, the step indicator announced ("3단계 중 2단계").

## 4. Done criteria

1. `npm test` passes and covers every test ID group listed in spec §11 with at least one test each, including: two acceptances of the same request where only the first succeeds; holiday eligibility at 14.99 h vs 15 h; the 40 h cap; both substitution-attendance policies; premium zero at 4 employees and non-zero at 5; probation applies only when all BR-10 conditions hold; the worked example of spec §10 (Choi Minho 3.2 h, 33,024 KRW).
2. The seed state reproduces spec §10 exactly, including the open request with two candidates, and the S7 walkthrough of §10 works (a test proves it).
3. Serving the repository root with any static server and opening `/app/` shows the sign-in screen with no console errors.
4. Walking through the sign-in tour in the browser: as Lee Seoyeon the Swaps tab shows her open request as a tracker; as Choi Minho, Home shows the request card with the effect "16시간 → 21시간" and **수락하기** accepts it in one tap; as Kang Doyun the card says Minho was faster; as the owner, Home shows the decision card for Minho (16 → 21 h, holiday allowance unchanged) and **승인하기** approves it; the schedule then shows the handover marker.
5. Every screen has exactly one filled primary button (a headless check counts them), every disabled button has a visible reason, and all touch targets are at least 44 × 44 px.
