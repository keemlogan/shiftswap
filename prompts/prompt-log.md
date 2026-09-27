# ShiftSwap — Prompt log

## Iteration 1 — ambiguities found while building

Each bullet: what was unclear → what the implementation does → suggested wording for the next prompt version.

- **`node --test tests/` fails on Node 24** (a directory argument is treated as a module path, error `Cannot find module …/tests`) → the script is `"test": "node --test tests/*.test.js"` → "script `"test": "node --test tests/*.test.js"`".
- **Read queries are not in the service list** (the UI needs week shifts, request lists, the approval comparison, payroll rows, …) → `services.js` also exports read-only queries (`getWorkplace`, `getSettings`, `getWorker`, `listWorkers`, `getFixedSchedules`, `getAvailability`, `getWeekShifts`, `listRequestableShifts`, `listMyRequests`, `listOwnerRequests`, `getApprovalPreview`, `listAttendance`, `getPayroll`, `unreadCount`, `defaultDeadline`) plus a `ServiceError` class carrying an error `code` → "services.js also exports read-only query functions for the screens (not wrapped in `tx`) and a `ServiceError(code, message, params)` that the UI translates by code."
- **Perfect attendance in a week that has not finished** (BR-06 says every own shift "was WORKED") → only an `ABSENT` shift (or a given-away shift under policy `ABSENT`) breaks attendance; a still-`SCHEDULED` shift does not. Without this, the approval panel could never show Minho as "eligible" before the week ends, contradicting the worked example → "In BR-06, a shift that is still SCHEDULED does not break perfect attendance; only ABSENT does (the weekly result is a projection until the week is over)."
- **Which workers get a WeeklySummary, and which weeks count for holiday pay** → `recomputeWeek` covers each worker with at least one shift (as current or original worker) in the week; payroll holiday pay sums only those weeks, so weeks that were never generated pay nothing → "A WeeklySummary exists only for workers who have a shift in that week."
- **No WeeklySummary rows in the seed** (§10 does not list them) → none are seeded; they are computed when the owner opens the weekly summary, approves a swap, confirms attendance or generates payroll → "The seed contains no WeeklySummary/Payroll rows; they are derived."
- **Base hours for shifts without confirmed attendance** (BR-11) → `WORKED` shifts use the recorded clock-in/out; `SCHEDULED` shifts in the month use scheduled hours and set `estimated = 1`; `ABSENT` shifts count 0 → state this explicitly in BR-11.
- **Premium pay at month level** (BR-08 mixes daily, weekly and night rules) → computed over the month's worked intervals: daily excess over 8 h per work date, weekly excess over 40 h of the remaining regular hours per ISO week (only the part of the week inside the month), plus night minutes 22:00–06:00; premium pay = premium hours × wage × 0.5, rounded down → "Weekly overtime in a payroll month uses only the days of that week inside the month."
- **The date used for BR-10 in a monthly payroll** → the first day of the month, or the contract start if later → "Evaluate BR-10 on the first day of the payroll month (or the contract start if later)."
- **"Effective hourly wage" in BR-07** → the worker's own `hourlyWage` (BR-09 says payroll computes with the worker's wage) → "effective hourly wage = Worker.hourlyWage."
- **Holiday pay rounding** → rounded down per week, then summed (TC-113) → "Round holiday pay down per week, then sum."
- **Attendance time format** (`clockIn`/`clockOut` are TEXT) → stored as `HH:MM` on the shift's date, end ≤ start meaning next day, like shift times → "Attendance.clockIn/clockOut are HH:MM on the shift date."
- **Who is notified on cancel and on expiry** → cancel: every target that was PENDING or ACCEPTED gets `REQUEST_CANCELLED`; expiry: requester and owner get `REQUEST_EXPIRED`, pending targets are closed without a message; acceptance: the other pending targets get `TARGET_CLOSED`; a decline notifies no one → list the recipients of each Notification.kind in §8.
- **Seed request `createdAt` and notification times** are not given → `2026-09-28T08:30` (before the demo clock) → give the value in §10.
- **Worker phone numbers** are not in §10 but NFR-11 needs them → fictional numbers `010-3827-1150`, `010-4172-2083`, `010-5290-3316`, `010-6631-4427`, `010-7748-5539` for ids 1–5 → list them in §10.
- **Names in the database** (§10 gives English and Korean names, the schema has one `name`) → English names stored (`Park Jiyoung`, `Dalbit Café`, …); the Korean UI shows them unchanged → "Store the English names; the Korean UI does not translate names."
- **Deleting a shift that already has a request or attendance** (FR-05) → refused with an explanatory message; the owner changes time or worker instead → state it in FR-05.
- **Deleting a fixed schedule row that already generated shifts** → the row is removed and those shifts keep existing with `fixedScheduleId = NULL` → state it in FR-02.
- **Demo clock persistence** → stored in `localStorage` under `shiftswap.clock.v1`; "Reset demo data" also resets the clock to `2026-09-28T09:00`; the language choice is stored under `shiftswap.lang` → name these keys in section 1.
- **Shared UI helpers** (escaping, number/date formatting, form error box, week navigation, row editor) have no module in the layout → formatting and the form error box live in `ui/i18n.js`, week navigation in `ui/schedule.js`, the weekday/start/end row editor in `ui/availability.js` (reused by `workers.js`) → "Shared UI helpers may live in `i18n.js`."
- **Stripe pattern vs "no gradients"** → the 45° amber stripe of the handed-over shift uses `repeating-linear-gradient`, the only gradient in the stylesheet → "the stripe may use `repeating-linear-gradient`; no other gradients."
- **Tables at 360 px** (NFR-02, no horizontal scroll) → below 720 px each table row turns into a stacked card with the column name before each value → state the pattern in section 3.

## Iteration 2 — changes from v1 to v2 and result

v2 of the prompt (`prompts/prompt-v2.md`; v1 kept as `prompts/prompt-v1.md`) and the matching spec edits fold in the 21 build ambiguities of iteration 1 and the gaps found in the document review. The app was then brought to v2.

| # | Source | Change in prompt / spec | Change in code | Verification |
|---|---|---|---|---|
| 1 | Build ambiguity | Prompt §1: test script `node --test tests/*.test.js` | none (already so) | `npm test` runs |
| 2 | Build ambiguity | Prompt §1: services.js also exports read-only queries and `ServiceError(code, message, params)` | none (already so) | all service tests |
| 3 | Build ambiguity | BR-06: a still-SCHEDULED shift does not break perfect attendance (projection until the week ends) | none (already so) | TC-085, TC-063 |
| 4 | Build ambiguity | §8 note: WeeklySummary only for workers with a shift that week; seed has no WeeklySummary/Payroll rows | none (already so) | TC-001, TC-088 |
| 5 | Build ambiguity + document review (BR-11 "estimated" semantics) | BR-11: WORKED → recorded hours, SCHEDULED → scheduled hours + `estimated = 1`, ABSENT → 0 | none (already so) | TC-114, TC-112 |
| 6 | Build ambiguity | BR-08: monthly weekly overtime uses only the days of the ISO week inside the month; premium pay rounded down | none (already so) | TC-092–TC-094, TC-095 |
| 7 | Build ambiguity | BR-10: evaluated on the first day of the month, or contractStart if later | none (already so) | TC-102, TC-104 |
| 8 | Build ambiguity | BR-07: pay uses `Worker.hourlyWage`, rounded down per week, then summed | none (already so) | TC-111, TC-113 |
| 9 | Build ambiguity | §8 note: Attendance clockIn/clockOut are `HH:MM` on the shift date | none (already so) | TC-071 |
| 10 | Build ambiguity + document review (UC-12 cancel recipients) | §8 recipients table; FR-19 (cancel notifies every PENDING or ACCEPTED target); a decline notifies no one | none needed (implementation already matched); recipients now asserted explicitly | TC-133 (new), TC-052, TC-121, TC-123 |
| 11 | Build ambiguity + document review (seed request createdAt) | §10: seed request `createdAt 2026-09-28T08:30`; fictional phone numbers; English names in DB | none (already so) | TC-001, TC-131 |
| 12 | Build ambiguity | FR-05: deleting a shift with a request or attendance is refused | none (already so) | TC-01A (new) |
| 13 | Build ambiguity | FR-02: deleting a fixed-schedule row keeps its shifts (`fixedScheduleId = NULL`) | none (already so) | TC-01B (new) |
| 14 | Build ambiguity | Prompt §1: keys `shiftswap.clock.v1`, `shiftswap.lang`; Reset also resets the clock | none (already so) | headless check (reset, reload) |
| 15 | Build ambiguity | Prompt §1: shared UI helpers (escaping, formatting, form error box) in `i18n.js` | none (already so) | review |
| 16 | Build ambiguity | Prompt §3: stripe may use `repeating-linear-gradient`, no other gradient; tables become stacked cards below 720 px | none (already so) | headless check: 360 px, no overflow on any screen |
| 17 | Document review | Schema: `Payroll.minWageAck INTEGER NOT NULL DEFAULT 0`; BR-09: acknowledgement sets it; prompt: `acknowledgeMinWage` service, Acknowledge button on the warning row, Confirm disabled until every warning row is acknowledged, "Estimated" chip | `db.js` schema column; new `acknowledgeMinWage(yearMonth, workerId)`; `confirmPayroll(yearMonth)` now checks the persisted `minWageAck` (the v1 `acknowledgeWarnings` option was removed); payroll screen: per-row Acknowledge button → "Acknowledged" chip, Confirm disabled with a hint until all are acknowledged | TC-104, TC-105 (new), TC-115; headless: Confirm disabled → Acknowledge → enabled → survives reload → confirmed |
| 18 | Follows from #17 (schema change) | Schema change vs. saved browser copies | `openDatabase` checks `PRAGMA table_info(Payroll)` for `minWageAck`; an older saved copy is replaced by the seed (key stays `shiftswap.db.v1`, a console warning explains it) | TC-002 (new) |
| 19 | Document review | §10: demo walkthrough S7 (ABSENT policy, Minho's Sat 10-03 12:00–18:00; Seoyeon and Hana eligible, Doyun excluded by overlap; Minho loses eligibility after approval); done criterion 2 requires a test | none needed in the app; new test | TC-08B (new) |
| 20 | Document review (§14 calendar) | NFR-07 date corrected to 2026-12-04; §14 course calendar | none (not app behaviour) | — |

Decisions made while building v2:

- **Regenerating a draft resets the acknowledgement.** "Re-generating a month replaces DRAFT rows only", so the new row starts with `minWageAck = 0` and must be acknowledged again (TC-105). This rule has since been added to BR-09.
- **Old saved databases are replaced, not migrated.** Replacing keeps the schema exactly as spec §8 (an `ALTER TABLE` would append the column at the end); the cost is that demo edits made before v2 are lost, which is acceptable for demo data.

Result: `npm test` 58 tests, 58 pass, 0 fail (52 in v1, plus TC-002, TC-01A, TC-01B, TC-105, TC-08B, TC-133). Headless Chrome: 70/70 checks pass, 0 console errors. The checks cover: sign-in; the done-criterion 4 walkthrough; the payroll acknowledgement flow including reload; and every screen for both roles in English and Korean at 1440 px and 360 px with no horizontal scroll.

## Iteration 3 — changes from v2 to v3 and result

Source for every row: UI review of the running v2 app (text too small, content in a narrow centred column with large empty areas, weekly board read as a list of cards rather than a schedule). All prompt changes are in §2/§3 and spec.md is unchanged; the only service-layer change is row 9 (from the traceability check), which added tests.

| # | Source | Change in prompt | Change in code | Verification |
|---|---|---|---|---|
| 1 | UI review | Sign-in rows show name, role and a one-line summary (owner: "Owner · Dalbit Café · 4 workers"; worker: fixed shifts + weekly contract hours) | `ui/login.js`: summary built from `getFixedSchedules` and `contractHours`, days with the same time range grouped ("Tue, Thu 18:00–23:00, Sat 12:00–18:00 · 16 h/week") | headless: all five summaries read back as expected |
| 2 | UI review | Every page starts with the title and one sentence on what the page is for | `pageHead(title, purpose, actions)` helper in `ui/i18n.js`, used by all 11 screens; `purpose.*` sentences in English and Korean (attendance has one per role) | headless: every route for both roles has `.page-head .purpose` |
| 3 | UI review | Owner overview strip above the board: approvals waiting, open substitute requests, this week's shifts · hours, each linking to its page | `ui/schedule.js` `overviewStrip()`; counts from `listOwnerRequests`, hours from `getWeekShifts` of the demo-clock week; links to Approvals / Weekly summary | headless: three figures ("This week 9 shifts · 50 h" in the seed) |
| 4 | UI review | Weekly board as a time grid: hour axis from the earliest start to the latest end (whole hours), 44 px/hour, hourly lines, hour labels in a left gutter, today's header marked, blocks positioned and sized by time; handover/pending markers unchanged | `ui/schedule.js` rewritten around `board()` + `layoutDay()`: blocks get `--top/--height` from their minutes; overlapping shifts of one day share the width in lanes; overnight ends extend past 24:00; today's header gets a "Today" chip and underline | headless geometry: Sat 10:00–16:00 = 264 px (6 h) at the axis start, Sat 12:00–18:00 starts 88 px lower and sits beside it, Mon 18:00–23:00 at 8 h, axis 10:00–23:00, today = Mon 09-28 |
| 5 | UI review | Empty states say what will appear and offer the next action as a button | `emptyState(text, action)` helper; board (owner: "Generate week of …"; worker: availability or "Go to this week"), payroll ("No payroll for September 2026 yet." + "Generate draft for September 2026"), approvals (+ "See open requests"), inbox, my requests, attendance, weekly summary | manual review of each screen; unused v2 empty-text keys removed |
| 6 | UI review | Type scale: base 15 px / 1.6; page title 28 px / 800 / −0.02em; section 18 px / 700; small 13 px (min 12 px); inputs 16 px on mobile | `styles.css` heading and body rules; inputs 16 px below 900 px; no font size below 12 px | headless: h1 computes to 28 px / 800 |
| 7 | UI review | Layout: nav 220 px; content starts right after the nav, 32 px padding, max-width 1200 px, left-aligned; gaps between groups at least twice the gaps inside a group | nav column 220 px; content no longer centred; `#view` is a flex column with 32 px between groups, 8–12 px inside (`.group`) | headless: nav width 220 px, content left edge 220 px |
| 8 | UI review (kept) | < 900 px day-by-day list; < 720 px stacked-card tables | below 900 px the grid drops its gutter and hour lines and blocks become static cards in day order; the table rule is unchanged | headless: every screen for both roles, EN/KO, 1440 and 360 px, no horizontal scroll; at 360 px blocks are `position: static` |
| 9 | Traceability check (FR-01, FR-20 / NFR-11 had no automated test) | none yet. Suggested for §1: "services.js exports `menuFor(role)`, the screens a role may open (FR-20); the router uses it for the menu and the role guard." | The role-to-menu table moved from `main.js` into a pure exported `menuFor(role)` in `services.js` (returns a copy); `main.js` uses it for the navigation and the redirect of other routes. NFR-11 visibility was already decided in the service layer (`listWorkers(viewer)`, `listAttendance(week, viewer)`), so no new helper was needed for it. | TC-01C, TC-01D (FR-01 register/edit and every validation error), TC-134 (FR-20 menus), TC-135 (NFR-11 attendance rows and phone/wage) |

Found and fixed during verification: the 32 px group gap was first set on `.content`, but the screens render inside `#view`, so the header, overview strip and week navigation touched; the gap now sits on `#view`.

Found while capturing the report screenshots (docs/img) and fixed:
- the "Substitute requested" chip was clipped inside a narrow shift block (chips inside blocks now wrap);
- the reply-deadline date-time field was too narrow for its value (form columns now have a 240 px minimum);
- the Korean "수정" button broke onto two lines in the narrow overlapping Saturday blocks (block buttons no longer wrap);
- on phones the week navigation wrapped awkwardly (the week label now takes its own line above the buttons).

Result: `npm test` 62 tests, 62 pass, 0 fail (58 + TC-01C, TC-01D, TC-134, TC-135 from row 9). Headless Chrome: 82/82 checks pass, 0 console errors. Screenshots of the owner board: `/tmp/shiftswap-owner-board-1440.png`, `/tmp/shiftswap-owner-board-360.png`.
