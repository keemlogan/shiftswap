# ShiftSwap — Final Vibe-Coding Prompt (v3)

> Version history: v1 → v2 after iteration 1 (build ambiguities and document review), v2 → v3 after iteration 2 (UI review of the running app). Earlier versions are kept as `prompts/prompt-v1.md` and `prompts/prompt-v2.md`; the reasons for every change are in `prompts/prompt-log.md`.
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
  - `app/core/services.js` — one exported function per use-case step, each running inside `tx()`: `registerWorker`, `saveFixedSchedule`, `saveAvailability`, `generateWeek`, `editShift`, `createSubRequest`, `respondToRequest`, `decideRequest`, `cancelRequest`, `expireOverdue`, `recordAttendance`, `confirmAttendance`, `markAbsent`, `recomputeWeek`, `generatePayroll`, `confirmPayroll`, `updateSettings`, `listNotifications`, `markNotificationsRead`, `acknowledgeMinWage`. Services call rules for every decision and write Notification rows exactly as the recipients table in spec §8 says. `services.js` also exports read-only query functions for the screens (not wrapped in `tx`), e.g. `getWeekShifts`, `listMyRequests`, `listOwnerRequests`, `getApprovalPreview`, `getPayroll`, `unreadCount`, `defaultDeadline`, and a `ServiceError(code, message, params)` class that the UI translates by `code`.
  - `app/ui/` — one module per screen: `login.js`, `schedule.js` (weekly board, both roles), `requests.js` (worker: my requests + new request form), `inbox.js`, `approvals.js` (owner), `attendance.js`, `weekly.js` (owner weekly summary), `payroll.js`, `workers.js` (owner: workers, fixed schedules), `availability.js` (worker), `settings.js` (owner: workplace + minimum wage), `i18n.js` (translations plus shared helpers: HTML escaping, number/date/money formatting, the form error box).
  - `tests/rules.test.js` and `tests/services.test.js` run with `node --test` (use the `sql.js` npm package in Node for service tests). Name each test with its spec test ID (e.g. `TC-081 holiday allowance at exactly 15 h`).
  - `package.json` with `"type": "module"` and script `"test": "node --test tests/*.test.js"` (a bare directory argument fails on Node 24).
- `expireOverdue()` (the System Clock actor, UC-11) runs on app start, on every route change, and after the demo clock changes.

## 2. Screens and behaviour

- **Sign-in (UC-13)**: list of demo accounts (owner + four workers). Each row shows the name, the role, and a one-line summary of what that person has in the seed: for the owner "Owner · Dalbit Café · 4 workers", for a worker their fixed shifts and weekly contract hours, e.g. "Mon, Wed 18:00–23:00 · 10 h/week". Choosing one enters the app. Show a note that this is a demo without passwords. The chosen account is kept in `sessionStorage`.
- **Header**: store name, signed-in user, unread notification count linking to the inbox, the demo clock (date-time input + "+1 hour" and "+1 day" buttons), language switch (English / 한국어), menu with "Reset demo data" and "Sign out".
- **Every page** starts with a header: the page title and one sentence saying what the page is for (e.g. Payroll: "Monthly pay per worker, computed from worked hours, holiday allowance and premiums.").
- **Owner overview strip** above the owner's weekly board: three figures that link to their pages — approvals waiting, open substitute requests, and this week's total scheduled shifts and hours (e.g. "11 shifts · 60 h").
- **Weekly board (UC-03)**: a time grid. Seven day columns Monday–Sunday; a vertical hour axis from the earliest shift start to the latest shift end of the displayed week, rounded to whole hours (seed: 10:00–23:00), 44 px per hour, with a thin line every hour and the hour label in the left gutter; today's column header is marked. Each shift is a block positioned and sized by its start and end time, showing time range and worker name; the signed-in worker's shifts are emphasised. A shift that was handed over shows the new worker, and the original worker struck through, with the handover marker (see design). Owner can generate the displayed week (FR-04) and edit/delete a shift (FR-05). Week navigation with previous / next.
- **Request substitute (UC-04)**: from one of the worker's own future shifts, open a form: reason (optional), deadline (default: the earlier of now + 24 h and shift start). On submit show the list of candidates who were notified, or the "no eligible worker" message (FR-08).
- **Inbox (UC-05, FR-21)**: notifications newest first; a `REQUEST_RECEIVED` item for a PENDING target has **Accept** and **Decline** buttons directly on the item (NFR-01: at most 2 clicks). If someone else accepted first, show "Already taken by <name>".
- **Approvals (UC-06)**: owner list of ACCEPTED requests. Each opens a comparison panel with a before/after table for requester and acceptor (contract hours, scheduled hours this week, holiday-allowance eligibility, holiday hours) and a highlighted line when eligibility changes (FR-11); buttons **Approve** / **Reject**. Also show open REQUESTED requests read-only with their candidates' responses.
- **My requests (UC-12)**: worker's requests with status chips; Cancel for REQUESTED/ACCEPTED.
- **Attendance (UC-07)**: worker records clock-in/out for own past shifts; owner confirms or marks absent.
- **Weekly summary (UC-08)**: owner picks a week; table per worker with the FR-14 columns and a short reason text when not eligible ("contract hours below 15", "absent on Tue 09-29").
- **Payroll (UC-09)**: owner picks a month; "Generate draft", table per worker (base hours, base pay, holiday pay, premium pay, total, flags), minimum-wage warning on the row with an **Acknowledge** button (`acknowledgeMinWage` sets `Payroll.minWageAck = 1`, persisted); "Confirm" is disabled until every warning row is acknowledged; confirmed rows read-only; rows with `estimated = 1` carry an "Estimated" chip.
- **Workers & schedules (UC-01)**, **Availability (UC-02)**, **Settings (UC-10)**: simple forms with validation messages that say what is wrong and how to fix it.
- **Empty states** say what will appear there and offer the next action as a button, e.g. Payroll with no draft: "No payroll for September 2026 yet." + primary button "Generate draft for September 2026"; Approvals with nothing waiting: "No swaps are waiting for approval." + link to open requests.
- Role guard: worker never sees other workers' phone numbers or wages (NFR-11).

## 3. Visual design (do not deviate)

- Fonts: Pretendard Variable for all text (`https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css`), JetBrains Mono (Google Fonts) for times, hours and money with `font-variant-numeric: tabular-nums`. Korean text: `word-break: keep-all`, line-height 1.6.
- Type scale: base 15 px / line-height 1.6; page title 28 px weight 800 letter-spacing −0.02em; section title 18 px weight 700; small text 13 px (never smaller than 12 px); inputs 16 px on mobile.
- Colors (CSS custom properties): `--ink #1C2230`, `--ink-2 #4A5163`, `--line #DDE1E8`, `--surface #F4F6F9`, `--paper #FFFFFF`, `--shift #2B5BD7` (primary, own shifts), `--handover #E9A23B` (substitution), `--alert #C93A31`, `--ok #2E7D4F`.
- Signature element: on the weekly board, a handed-over shift has a 6 px amber left edge and a subtle 45° amber stripe pattern, the new worker's name in bold and the original worker struck through beneath it. Pending requests show a dashed amber outline on the shift. This is the only decorative element; everything else is quiet: white cards on the surface color, 8 px radius, 1 px borders, no gradients (the stripe may use `repeating-linear-gradient`; no other gradient), no emoji, no drop shadows larger than `0 1px 2px rgba(28,34,48,.06)`.
- Layout: left navigation 220 px wide on ≥ 900 px, bottom tab bar on < 900 px; the content column starts right after the navigation with 32 px padding and a max-width of 1200 px (left-aligned, not centred in the remaining space); gaps between groups are at least twice the gaps inside a group; at 360 px width no horizontal scroll (the weekly board becomes a day-by-day list; below 720 px every data table turns each row into a stacked card with the column name before each value).
- Copy: sentence case, plain verbs ("Request substitute", "Approve swap"), errors explain the cause and the fix.
- Accessibility: visible focus rings, buttons are `<button>`, form labels, status chips have text not only color, `prefers-reduced-motion` respected.

## 4. Done criteria

1. `npm test` passes and covers every test ID group listed in spec §11 with at least one test each, including: two acceptances of the same request where only the first succeeds; holiday eligibility at 14.99 h vs 15 h; the 40 h cap; both substitution-attendance policies; premium zero at 4 employees and non-zero at 5; probation applies only when all BR-10 conditions hold; the worked example of spec §10 (Choi Minho 3.2 h, 33,024 KRW).
2. The seed state reproduces spec §10 exactly, including the open request with two candidates, and the S7 walkthrough of §10 works (a test proves it).
3. Serving the repository root with any static server and opening `/app/` shows the sign-in screen with no console errors.
4. Walking through: sign in as Choi Minho → accept → sign in as Kang Doyun → sees "Already taken" → sign in as owner → approval panel shows Minho scheduled 16 → 21 h and eligibility unchanged → approve → weekly board shows the handover marker.
