# ShiftSwap — Canonical Specification (single source of truth)

> Every artifact in this repository (app code, UML, proposal, interim report, final report, slides, prompts) MUST use the IDs, names, states, rules and numbers defined here. If something is not defined here, do not invent it in one artifact only — add it here first.

## 0. Project identity

| Item | Value |
|---|---|
| System name | **ShiftSwap** |
| Full title | ShiftSwap: A Shift Schedule and Substitute Management System for Small Part-Time Workplaces |
| Korean title | 소규모 매장 아르바이트 근무표·대타 관리 시스템 |
| Course | Software Engineering (2026 Fall), Seoul National University of Science and Technology (SeoulTech) |
| Team | Team 7 |
| Instructor submission e-mail | jihjim@gmail.com |
| Deployed app | `https://keemlogan.github.io/shiftswap/app/` |
| Repository | `https://github.com/keemlogan/shiftswap` |
| Shared database | Supabase project `shiftswap` (ref `dbahxuegxnqsthntpuqy`), PostgreSQL, public schema, tables `app_*` (§8, §9; iteration 8) |

### Team members

| Name (EN) | Name (KR) | Student ID | Affiliation | E-mail | Role |
|---|---|---|---|---|---|
| Hyewon Kim | 김혜원 | 24102028 | Dept. of Industrial Engineering, ITM Program, SeoulTech | gokhw123@g.seoultech.ac.kr | Requirements lead — problem definition, owner/worker interviews, functional & non-functional requirements, scenarios |
| Hyoungdo Kim | 김형도 | 18102075 | Dept. of Industrial Engineering, ITM Program, SeoulTech | domo5776@seoultech.ac.kr | Project manager & design/implementation lead — WBS/schedule, UML design models, vibe-coding prompts, deployment |
| Minkyung Kim | 김민경 | 23102004 | Dept. of Industrial Engineering, ITM Program, SeoulTech | min23@g.seoultech.ac.kr | UI & quality lead — UI screens, test cases, presentation deck, report integration |

(Topic origin: proposed by Hyewon Kim from her own part-time job experience; selected by the team after comparing seven candidate topics on 2026-09-27.)

## 1. Problem statement (short)

In small stores (cafés, convenience stores, restaurants) with fewer than ten part-time workers, each worker has **fixed weekly shifts** (e.g. every Monday 18:00–23:00). When a worker cannot come, the **owner phones or messages other workers one by one** to find a substitute, then **edits a spreadsheet** by hand, and at month end must **re-check each worker's weekly hours** to decide whether the **weekly holiday allowance (주휴수당)** is owed. Three problems follow:

- P1. Finding a substitute costs the owner repeated one-to-one contacts (reference store: typically 3–5 contacts per request, Hyewon's store).
- P2. The schedule, weekly hours and holiday-allowance eligibility of **two** workers change with every swap, and all recalculation is manual.
- P3. Legal pay rules (minimum wage, holiday allowance, 5-employee threshold for premiums, overtime of part-time workers beyond contractual hours, probation reduction) are applied from memory, so errors are not caught before payday.

## 2. Actors

| ID | Actor | Type | Description |
|---|---|---|---|
| A1 | Worker | Primary, human | Part-time employee. Views own schedule, requests substitutes, accepts or declines requests from co-workers, records attendance. |
| A2 | Owner | Primary, human | Store owner (also acts as manager). Registers workers and fixed schedules, approves/rejects substitutions, confirms attendance, reviews weekly summaries, confirms monthly payroll, edits settings. |
| A3 | System Clock | Secondary, system | Time-triggered actor. Expires unanswered/unapproved requests at their deadline, closes weeks for weekly summary and prepares last month's payroll draft. In the shared mode (§9) it uses the time of the shared database server (Korea Standard Time, read-only in the app); in the local demonstration mode it is driven by the adjustable "demo clock". |

## 3. Use cases (core = UC-01…UC-09 map 1:1 to the nine functions of the proposal)

| ID | Name | Primary actor | Priority | Main tables |
|---|---|---|---|---|
| UC-01 | Register worker and fixed schedule | Owner | Must | Worker, FixedSchedule |
| ~~UC-02~~ | ~~Register availability~~ — **removed in iteration 6** (see §15) | — | — | — |
| UC-03 | Generate weekly schedule | Owner | Must | Shift |
| UC-04 | Request substitute | Worker | Must | SubRequest, SubRequestTarget, Notification |
| UC-05 | Respond to substitute request (accept / can't) | Worker (candidate) | Must | SubRequestTarget, SubRequest, Notification |
| UC-06 | Approve or reject substitution | Owner | Must | SubRequest, Shift, WeeklySummary |
| UC-07 | Record and confirm attendance | Worker, Owner | Should | Attendance, Shift |
| UC-08 | Compute weekly hours and holiday allowance | Owner (System) | Must | WeeklySummary, Workplace |
| UC-09 | Generate and confirm monthly payroll | Owner | Should | Payroll, MinimumWage, Worker |
| UC-10 | Manage workplace settings and minimum wage table | Owner | Should | Workplace, MinimumWage |
| UC-11 | Expire overdue substitute request | System Clock | Must | SubRequest, SubRequestTarget, Notification |
| UC-12 | Cancel own substitute request | Worker | Should | SubRequest, SubRequestTarget |
| UC-13 | Sign in by role (demo account selection, no password — §17) | Worker, Owner | Must | Worker |
| UC-14 | Prepare last month's payroll automatically | System Clock | Must | Payroll, Notification |

Relationships for the use case diagram:
- UC-04 «include» *Find eligible candidates* (BR-01).
- UC-06 «include» UC-08 (approval triggers recomputation for both workers).
- UC-11 «extend» UC-04 (extension point: deadline reached with no approved acceptance).
- UC-12 «extend» UC-04.
- UC-09 «include» UC-08.
- All UCs except UC-11 «include» UC-13 (must be signed in).

## 4. Functional requirements

| ID | Requirement | UC |
|---|---|---|
| FR-01 | The owner shall register a worker with name, phone, hourly wage (KRW), contract start date, contract end date, probation end date (optional), simple-labor flag, and active flag. | UC-01 |
| FR-02 | The owner shall register one or more fixed weekly shifts per worker (weekday, start time, end time); fixed shifts of the same worker must not overlap. Deleting a fixed-schedule row keeps the shifts it already generated (their fixedScheduleId becomes NULL). | UC-01 |
| ~~FR-03~~ | Removed in iteration 6: availability slots are no longer collected (§15). | — |
| FR-04 | The system shall generate the shifts of a given week (Mon–Sun) from all active fixed schedules; generating the same week twice shall not create duplicates: a fixed-schedule slot is skipped when that fixed schedule already produced a shift in the week, or when the worker already has an overlapping shift on that date (e.g. after the owner moved or re-created it). | UC-03 |
| FR-05 | The owner shall be able to add, move or delete a single shift of a generated week. Deleting a shift that has a substitute request or an attendance record is refused with an explanatory message; changing the worker, date or time of a shift that has an open (REQUESTED/ACCEPTED) request is refused (SHIFT_OPEN_REQUEST). | UC-03 |
| FR-06 | A worker shall create a substitute request for one of their own future SCHEDULED shifts, with an optional reason and a response deadline. | UC-04 |
| FR-07 | On creation the system shall compute the eligible candidates (BR-01), create one SubRequestTarget per candidate, and put a notification in each candidate's inbox at once. | UC-04 |
| FR-08 | If no worker is eligible, the system shall still create the request and end it at once as FAILED (BR-13): the requester is told that no co-worker can take the shift and to contact the owner, and the owner receives a REQUEST_FAILED notification. | UC-04 |
| FR-09 | A candidate shall accept a request, or answer **can't** (decline), from their inbox or Home. The first acceptance makes that candidate the request's acceptor (BR-02); later acceptances shall be refused with an explanatory message. | UC-05 |
| FR-10 | When a request is accepted, the system shall notify the requester and the owner, and close all other pending targets. | UC-05 |
| FR-11 | The approval screen shall show, for both the requester and the acceptor, the weekly contractual hours, weekly scheduled hours and holiday-allowance eligibility **before and after** the swap, and highlight any eligibility change. | UC-06 |
| FR-12 | On approval the system shall reassign the shift to the acceptor (keeping the original worker), recompute the weekly summaries of both workers, and notify both. On rejection the shift stays unchanged and both are notified. | UC-06 |
| FR-24 | In a workplace with five or more regular employees, the approval screen (FR-11) shall warn when the swap would leave a part-time acceptor with more than 12 hours beyond their weekly contractual hours in that week (BR-15), showing the hours beyond contract; the warning does not block the decision. Priority: Should (iteration 8). | UC-06 |
| FR-13 | A worker shall record actual start and end time of a shift they worked; the owner shall confirm it or mark the shift ABSENT. Both actions require the shift to be SCHEDULED; a WORKED or ABSENT shift cannot change status again (ATTENDANCE_CLOSED). | UC-07 |
| FR-14 | The system shall compute, per worker and week, contractual hours, scheduled hours, actual hours, perfect-attendance flag, holiday-allowance eligibility and holiday-allowance hours (BR-06, BR-07). | UC-08 |
| FR-15 | The owner shall generate a monthly payroll draft per worker (base pay, holiday allowance, premium pay, total) and confirm it; a confirmed payroll is read-only. | UC-09 |
| FR-16 | The payroll screen shall warn when a worker's hourly wage is below the applicable minimum wage (BR-09), and apply the probation reduction only when BR-10 holds. | UC-09 |
| FR-17 | The owner shall edit workplace settings: store name, number of regular employees, substitution-attendance policy (BR-06), and yearly minimum wage rows. | UC-10 |
| FR-22 | When every target of a REQUESTED request has answered can't (DECLINED), the request ends as FAILED (BR-13): the requester receives "모든 동료가 대타가 불가능하다고 해요. 사장님께 연락드려 보세요." and the owner receives a REQUEST_FAILED notification whose only action is **확인했어요** (mark as read). | UC-05 |
| FR-18 | When a request's deadline passes, or its shift starts, while it is still REQUESTED or ACCEPTED, the system shall mark it EXPIRED, close its targets and notify requester and owner. | UC-11 |
| FR-19 | A requester shall cancel their own request while it is REQUESTED or ACCEPTED; all PENDING targets become CLOSED, and every target that was PENDING or ACCEPTED receives a REQUEST_CANCELLED notification. | UC-12 |
| FR-20 | Users shall sign in by choosing a demo account without a password (password authentication is out of scope, §17), either from the list of all accounts or from a guided three-step demo tour; the UI shows only the menus of that role. In the shared mode the sign-in screen states that the data are shared with everyone who opens the app and must be fictional; the tour's progress follows the shared data, and restarting the tour there resets the demo data for everyone (the rate-limited reset of §9). | UC-13 |
| FR-23 | On or after the first day of a month, the system shall prepare the previous month's payroll as a DRAFT (the same computation as FR-15) without any user action, notify the owner with PAYROLL_DRAFT_READY, and never overwrite rows that already exist; the owner still reviews, acknowledges warnings and confirms (FR-15, FR-16). | UC-14 |
| FR-21 | Every user shall have an in-app notification inbox listing notifications newest first with unread count. | UC-04–06, 11, 12 |

## 5. Non-functional requirements (classified as in Chapter 8: Product / Organisational / External)

| ID | Class | Sub-class | Requirement | Verification |
|---|---|---|---|---|
| NFR-01 | Product | Usability | A candidate can accept a request in at most 2 clicks from the inbox. | UI walkthrough |
| NFR-02 | Product | Usability | All screens are usable at 360 px width (mobile) and 1440 px (desktop) without horizontal scrolling. | Browser check at both widths |
| NFR-03 | Product | Efficiency / Performance | With 20 workers and 12 weeks of shifts, any screen renders in under 1 second on a mid-range laptop. | Timed load with seeded data |
| NFR-04 | Product | Reliability | "First acceptance wins" is enforced inside one database transaction that re-checks the request state; two acceptances can never both succeed. In the shared mode the server applies each change set in one transaction under a row lock on the store and refuses a change set computed on an older revision, which the app then recomputes on the current data (§9). | Unit tests TC-05x, TC-16x; REST test of the shared database |
| NFR-05 | Product | Reliability | Data persists across page reloads — in the shared database (shared mode) or in browser storage (local demonstration mode) — and can be reset to the seed data (in the shared mode by the rate-limited reset for everyone, §9). | Manual test; REST test |
| NFR-06 | Product | Portability | Runs in current Chrome, Edge, Safari, Firefox without installation and without an application server of its own (the shared mode uses only the hosted database service). | Manual test |
| NFR-07 | Organisational | Delivery | Working system deployed by Week 14 (2026-12-04). | Deployed URL |
| NFR-08 | Organisational | Implementation | Static web application (HTML/CSS/JavaScript ES modules) hosted on GitHub Pages; shared data in a Supabase PostgreSQL database reached with the publishable key through its REST and RPC interface; SQLite compiled to WebAssembly (sql.js) as the working copy in the browser (shared mode) and as the only store of the local demonstration mode; built by vibe coding from the final prompt. | Repository |
| NFR-09 | Organisational | Standards | Models follow UML 2.5 notation; code identifiers in English. | Review |
| NFR-10 | External | Legislative | Pay rules follow the Minimum Wage Act (2026 minimum hourly wage KRW 10,320), the Labor Standards Act (Art. 18 ③, Art. 55, Enforcement Decree Art. 30; Art. 11 / 56 premium threshold) and the Fixed-term and Part-time Employees Act (Art. 6, work of part-time workers beyond contractual hours); where the law leaves the method open, the system's rule is stated as a design decision (BR-08, BR-15). | Unit tests TC-08x, TC-09x, TC-15x |
| NFR-11 | External | Privacy | A worker's phone number and wage are visible only to the owner and that worker (Personal Information Protection Act principle of minimum disclosure). | Role test |
| NFR-12 | External | Ethical | The system does not collect location data; attendance is self-reported and owner-confirmed. | Design review |
| NFR-13 | Product | Usability | Task-first design: each role starts on a Home screen that lists the items waiting for that person with the action on the item; every screen has exactly one primary action; any action that changes hours or pay shows its effect (hours before → after, holiday-allowance amount) before the user commits; the default UI language is Korean with a complete English alternative. | Headless check counts one primary button per screen; walkthrough |
| NFR-14 | Product | Security | The shared database accepts writes only through SECURITY DEFINER functions with an empty `search_path` (`app_commit`, `app_reset`); the API roles may only read the `app_` tables (row-level-security read policies, explicit grants, no write grants). The server itself re-checks what it can decide without knowing the user: the state transitions of §7, acceptance and approval only before the deadline and the shift start, expiry only when overdue (BR-12, server time), at most one open request per shift, read-only confirmed payroll, creation times within 10 minutes of server time. It limits every store to 60 change sets per minute and 3,000 per day, a change set to 256 kB and 2,000 rows, a store to 20,000 rows, and resets to one per minute and 50 per day. Identity is not verified (demo accounts without passwords, §17). | REST test of the shared database (iteration 8) |
| NFR-15 | Product | Efficiency | In the shared mode a change saved by one user appears on the open screen of every other user within 10 seconds (revision polling, and at once when the window regains focus). | Two-browser check |
| NFR-16 | Product | Dependability | The shared database is kept active by a scheduled read query every six hours (GitHub Actions, `.github/workflows/supabase-keepalive.yml`); when it cannot be reached, the app offers the local demonstration mode with the seed data (risk R6). | Workflow log; manual test |

## 6. Business rules

- **BR-01 Eligible candidates.** A worker W is eligible for a request on shift S (date d, start s, end e) iff: W is an active WORKER; W ≠ requester; W has no shift on date d overlapping [s, e) (someone already working then cannot take it). Availability is not used (removed in iteration 6): every other co-worker is asked.
- **BR-02 First acceptance wins.** Acceptance succeeds only if the request is REQUESTED at the moment of the transaction and the candidate still has no overlapping shift on that date (re-checked at acceptance and again at approval, error ACCEPTOR_BUSY); it sets request.status = ACCEPTED, request.acceptorId = W, target(W).response = ACCEPTED, and all other PENDING targets → CLOSED.
- **BR-03 Request validity.** Only the shift's current worker can request; shift must be SCHEDULED and start in the future; at most one open (REQUESTED/ACCEPTED) request per shift; deadline must be after now and no later than the shift start.
- **BR-04 Approval effect.** Approve: shift.workerId = acceptor; shift.originalWorkerId keeps the first worker (set only if null); request → APPROVED. Reject: request → REJECTED, shift unchanged. Owner can approve only an ACCEPTED request.
- **BR-05 Week.** A week runs Monday 00:00 to Sunday 24:00 (ISO week). Weekly records are keyed by the Monday date.
- **BR-06 Holiday-allowance eligibility (주휴).** Eligible iff (a) weekly contractual hours ≥ 15, and (b) perfect attendance: every shift of the week whose *original* worker is W and that was not given away was not ABSENT (a shift that is still SCHEDULED does not break attendance, so the weekly result is a projection until the week is over). Shifts W gave away by an APPROVED substitution count according to Workplace.subAttendancePolicy: `EXCUSED` (default — the working day was changed by agreement, so it does not break attendance) or `ABSENT` (it breaks attendance). Contractual hours = sum of W's fixed-schedule hours per week. Substitute shifts W took do not change contractual hours. (Legal basis: Labor Standards Act Art. 55 ①, Enforcement Decree Art. 30 ①, Art. 18 ③. The law averages 15 h over four weeks; the system uses the weekly contractual hours from the fixed schedule, which is constant, so the average equals the weekly value.)
- **BR-07 Holiday-allowance hours.** hours = min(contractualHours, 40) / 40 × 8, rounded to 2 decimals; pay = hours × Worker.hourlyWage, rounded down to the won per week (monthly holiday pay is the sum of the rounded weekly amounts).
- **BR-08 Premium pay.** Applies only if Workplace.regularEmployees ≥ 5 (Labor Standards Act Art. 11, 56; Fixed-term and Part-time Employees Act Art. 3 ②, Art. 6 and Enforcement Decree Art. 2, Annex 1). Then +50 % of wage for (i) daily hours beyond 8, (ii) weekly hours beyond 40 not already counted in (i), (iii) night hours 22:00–06:00, and (iv) for a part-time worker, hours beyond the weekly contractual hours not already counted in (i) or (ii) (iteration 8). Night premium adds to overtime premium. If regularEmployees < 5 → premium = 0. In a monthly payroll, weekly overtime (ii) uses only the days of that ISO week that fall inside the month. Premium pay = premium hours × wage × 0.5, rounded down.
  System rules for (iv) — design decisions of this system where the law does not fix the method, not statements of law: (a) a worker whose weekly contractual hours C (the sum of the current fixed schedule, as in BR-06) satisfy 0 < C < 40 is treated as part-time; a worker without a fixed schedule (C = 0) or with C ≥ 40 is not; (b) the test is weekly against C, not daily; (c) the hours of an ISO week are taken in chronological order and every hour after the first C hours is beyond contract; as for (i) and the payroll month, the hours of a shift count on its work date (a shift that ends after midnight counts on the date it starts); in a monthly payroll the days of that week outside the month only determine where the first C hours end, and only hours on dates inside the month are paid in that month; (d) an hour that meets more than one of (i), (ii) and (iv) is counted once, so the overtime hours of a part-time worker on a day are the larger of the daily hours beyond 8 and the hours beyond contract; (e) the night premium (iii) is added separately. The worker's consent to hours beyond contract is outside the system; the 12-hour weekly limit is checked before approval (BR-15). Considered and not adopted: a daily test against daily contractual hours, and the definition of part-time by comparison with a full-time worker doing the same kind of work in the same workplace — both need data the system does not keep.
- **BR-09 Minimum-wage check.** Warn if worker.hourlyWage < MinimumWage(year).hourly × (0.9 if BR-10 applies else 1). The payroll still computes with the worker's wage; the warning is shown on the payroll row and blocks confirmation until the owner acknowledges it, which sets Payroll.minWageAck = 1. Re-generating a DRAFT month replaces its rows, so acknowledgements must be given again.
- **BR-10 Probation reduction.** The minimum may be reduced to 90 % only if all hold: contract length ≥ 1 year (contractEnd − contractStart ≥ 365 days, or contractEnd empty = open-ended), the date is within 3 months of contractStart and ≤ probationEnd, and simpleLabor = false (Minimum Wage Act Art. 5 ②, Enforcement Decree Art. 3). In a monthly payroll the conditions are evaluated on the first day of the month, or on contractStart if later. "Within 3 months" means from contractStart (inclusive) to the same calendar date three months later (exclusive); a worker without probationEnd is never on probation.
- **BR-11 Monthly payroll.** Month = calendar month. Base pay = Σ actual hours of WORKED shifts in the month × wage for WORKED shifts (recorded clock-in/out); SCHEDULED shifts in the month count with their scheduled hours and set estimated = 1 on the row; ABSENT shifts count 0. Holiday allowance = Σ holiday pay of weeks whose Sunday falls in the month. Total = base + holiday + premium. Amounts are integers in KRW, rounded down.
- **BR-12 Expiry.** A REQUESTED or ACCEPTED request whose deadline ≤ now, or whose shift start ≤ now, becomes EXPIRED. Accept and approve check this themselves inside their transaction (REQUEST_CLOSED), independent of the periodic expiry run. In the shared mode "now" is the server time: the server refuses an acceptance or approval at or after the deadline or the shift start, and an expiry before it (NFR-14).
- **BR-13 No taker.** A REQUESTED request ends as FAILED (final) when it has no eligible candidate at creation, or when every SubRequestTarget has response DECLINED. FAILED sends REQUEST_FAILED to the requester and the owner; the owner's only action is to acknowledge (mark the notification read). Accepting a FAILED request is refused (REQUEST_CLOSED).
- **BR-14 Automatic monthly payroll draft.** Whenever the System Clock runs (app start, every route change, after the demo clock changes), let M be the month of now and P = M − 1. If P is not earlier than the month of the earliest contractStart and no Payroll row exists yet for P, generate the DRAFT for P exactly as generatePayroll does and insert one PAYROLL_DRAFT_READY notification for the owner. It runs at most once per month (existing rows — DRAFT or CONFIRMED — mean it has already run) and never confirms anything.
- **BR-15 Part-time weekly limit warning (F6, iteration 8).** When Workplace.regularEmployees ≥ 5 and the acceptor of an ACCEPTED request is part-time (0 < C < 40, BR-08 (a)), let S be the acceptor's scheduled hours in the ISO week of the requested shift after the swap (every shift of the week of which they would be the current worker, as WeeklySummary.scheduledHours). If S − C > 12, the approval preview (FR-11, FR-24) shows the warning with S − C (for example "13 h beyond contract, limit 12 h"). Exactly 12 hours beyond contract gives no warning. The warning does not block approval: the worker's consent and the owner's decision are outside the system. (Legal basis: Fixed-term and Part-time Employees Act Art. 6; the weekly test against the fixed-schedule hours is the system rule of BR-08 (a)–(c).)

## 7. States

**SubRequest.status**: `REQUESTED` → `ACCEPTED` (UC-05) → `APPROVED` | `REJECTED` (UC-06). `REQUESTED` → `FAILED` when there is no eligible candidate or every target answered can't (BR-13). `REQUESTED`/`ACCEPTED` → `EXPIRED` (UC-11) | `CANCELLED` (UC-12). Final states: APPROVED, REJECTED, FAILED, EXPIRED, CANCELLED.

**SubRequestTarget.response**: `PENDING` → `ACCEPTED` | `DECLINED` | `CLOSED`.

**Shift.status**: `SCHEDULED` → `WORKED` (attendance confirmed) | `ABSENT` (owner marks). A SCHEDULED shift may be reassigned (BR-04) — status stays SCHEDULED.

**Attendance.confirmed**: 0 (recorded by worker) → 1 (confirmed by owner).

**Payroll.status**: `DRAFT` → `CONFIRMED`. Re-generating a month replaces DRAFT rows only.

## 8. Data model (SQLite; 11 tables)

The same 11 tables exist in both data modes (§9). The DDL below is the SQLite schema of the browser working copy. The shared database (`db/app-shared.sql`) holds them in PostgreSQL as `app_workplace`, `app_worker`, `app_fixed_schedule`, `app_shift`, `app_sub_request`, `app_sub_request_target`, `app_attendance`, `app_weekly_summary`, `app_payroll`, `app_minimum_wage` and `app_notification`, with the same columns in snake_case (`workDate` → `work_date`), a `store_id` column in every table, primary key `(store_id, id)` (`(store_id, year)` for MinimumWage) and composite foreign keys; dates are `date`, times and datetimes text in the formats below, flags `smallint`, hours `double precision`. Two service tables complete it: `app_store` (id, slug, revision; readable) and `app_store_gate` (rate-limit counters; not readable).

```sql
CREATE TABLE Workplace (id INTEGER PRIMARY KEY, name TEXT NOT NULL, regularEmployees INTEGER NOT NULL DEFAULT 4,
  subAttendancePolicy TEXT NOT NULL DEFAULT 'EXCUSED' CHECK (subAttendancePolicy IN ('EXCUSED','ABSENT')));
CREATE TABLE Worker (id INTEGER PRIMARY KEY, workplaceId INTEGER NOT NULL REFERENCES Workplace(id), role TEXT NOT NULL CHECK (role IN ('OWNER','WORKER')),
  name TEXT NOT NULL, phone TEXT, hourlyWage INTEGER, contractStart TEXT, contractEnd TEXT, probationEnd TEXT,
  simpleLabor INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE FixedSchedule (id INTEGER PRIMARY KEY, workerId INTEGER NOT NULL REFERENCES Worker(id), weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  startTime TEXT NOT NULL, endTime TEXT NOT NULL);
CREATE TABLE Shift (id INTEGER PRIMARY KEY, workDate TEXT NOT NULL, startTime TEXT NOT NULL, endTime TEXT NOT NULL,
  workerId INTEGER NOT NULL REFERENCES Worker(id), originalWorkerId INTEGER REFERENCES Worker(id), fixedScheduleId INTEGER REFERENCES FixedSchedule(id),
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','WORKED','ABSENT')));
CREATE TABLE SubRequest (id INTEGER PRIMARY KEY, shiftId INTEGER NOT NULL REFERENCES Shift(id), requesterId INTEGER NOT NULL REFERENCES Worker(id),
  acceptorId INTEGER REFERENCES Worker(id), reason TEXT, deadline TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','ACCEPTED','APPROVED','REJECTED','FAILED','EXPIRED','CANCELLED')), createdAt TEXT NOT NULL, decidedAt TEXT);
CREATE TABLE SubRequestTarget (id INTEGER PRIMARY KEY, subRequestId INTEGER NOT NULL REFERENCES SubRequest(id), workerId INTEGER NOT NULL REFERENCES Worker(id),
  response TEXT NOT NULL DEFAULT 'PENDING' CHECK (response IN ('PENDING','ACCEPTED','DECLINED','CLOSED')), respondedAt TEXT);
CREATE TABLE Attendance (id INTEGER PRIMARY KEY, shiftId INTEGER NOT NULL UNIQUE REFERENCES Shift(id), clockIn TEXT NOT NULL, clockOut TEXT NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE WeeklySummary (id INTEGER PRIMARY KEY, workerId INTEGER NOT NULL REFERENCES Worker(id), weekStart TEXT NOT NULL,
  contractHours REAL NOT NULL, scheduledHours REAL NOT NULL, actualHours REAL NOT NULL, perfectAttendance INTEGER NOT NULL,
  holidayEligible INTEGER NOT NULL, holidayHours REAL NOT NULL, UNIQUE (workerId, weekStart));
CREATE TABLE Payroll (id INTEGER PRIMARY KEY, workerId INTEGER NOT NULL REFERENCES Worker(id), yearMonth TEXT NOT NULL,
  baseHours REAL NOT NULL, basePay INTEGER NOT NULL, holidayPay INTEGER NOT NULL, premiumPay INTEGER NOT NULL, total INTEGER NOT NULL,
  minWageWarning INTEGER NOT NULL DEFAULT 0, minWageAck INTEGER NOT NULL DEFAULT 0, estimated INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','CONFIRMED')), UNIQUE (workerId, yearMonth));
CREATE TABLE MinimumWage (year INTEGER PRIMARY KEY, hourly INTEGER NOT NULL);
CREATE TABLE Notification (id INTEGER PRIMARY KEY, workerId INTEGER NOT NULL REFERENCES Worker(id), subRequestId INTEGER REFERENCES SubRequest(id),
  kind TEXT NOT NULL, message TEXT NOT NULL, createdAt TEXT NOT NULL, readAt TEXT);
```

Dates are ISO `YYYY-MM-DD`, times `HH:MM` (24 h; an end time ≤ start time means the shift ends next day — seed data contains no overnight shift, but the rule functions support it and TC-09x test it). Datetimes are ISO `YYYY-MM-DDTHH:MM`.

Attendance.clockIn/clockOut are `HH:MM` on the shift date (end ≤ start means next day). A WeeklySummary row exists only for workers who have a shift (as current or original worker) in that week — recomputing a week deletes the rows of workers who no longer have one; the seed contains the Payroll rows and WeeklySummary rows that its work history produces (confirmed payroll up to 2026-08, summaries up to the week of 2026-09-14); everything else is derived.

Notification recipients:

| kind | recipients |
|---|---|
| REQUEST_RECEIVED | each eligible candidate (UC-04) |
| PAYROLL_DRAFT_READY | owner, once per month, when the System Clock prepared last month's draft (UC-14, BR-14) |
| REQUEST_FAILED | requester ("no co-worker can take it — contact the owner") and owner (acknowledge only) when the request ends FAILED (FR-08, FR-22, BR-13) |
| REQUEST_ACCEPTED | requester and owner (UC-05) |
| TARGET_CLOSED | the other PENDING targets when someone accepts (UC-05) |
| REQUEST_APPROVED / REQUEST_REJECTED | requester and acceptor (UC-06) |
| REQUEST_EXPIRED | requester and owner; pending targets are closed silently (UC-11) |
| REQUEST_CANCELLED | every target that was PENDING or ACCEPTED (UC-12) |

A single can't (decline) notifies no one; the last one that makes every target DECLINED triggers REQUEST_FAILED.

## 9. Design (architecture)

Layered architecture with two data modes (iteration 8): the **shared mode** (default whenever `app/config.js` contains the database URL and publishable key) keeps one store for everyone in the shared database; the **local demonstration mode** keeps the same tables only in this browser.

| Layer | Module (file) | Responsibility |
|---|---|---|
| Presentation | `app/index.html`, `app/ui/*.js`, `app/styles.css` | Screens per role, routing by hash (`#/schedule`, `#/requests`, …); every command goes through `ctx.run()`, which waits for the save |
| Application services | `app/core/services.js` | Use-case operations (one function per UC step), transactions — the same code in both modes |
| Domain rules | `app/core/rules.js` | Pure functions: eligibility, overlap, weekly summary, holiday allowance, premium, payroll, minimum wage/probation — no DB access (unit-tested) |
| Data access | `app/core/db.js` | sql.js initialisation, schema, seed, `tx()` helper; local mode: persistence to `localStorage`; shared mode: in-memory working copy loaded from the server, table snapshots for change sets |
| Shared-data gateway | `app/core/shared.js`, `app/config.js` | Shared mode only: loads the store snapshot, sends the change set of each command to the server with the revision it was computed on, re-runs a command whose revision is stale, polls the revision, maps server errors to messages |
| Clock | `app/core/clock.js` | `now()`: server time (Korea Standard Time) in the shared mode, the adjustable demo clock in the local mode; the System Clock actor ticks expiry and BR-14 on every navigation |
| Shared database | `db/app-shared.sql` (Supabase PostgreSQL) | `app_` tables with read-only access for the API roles, RPC functions `app_snapshot`, `app_commit`, `app_reset`, row triggers that re-check the rules the server can decide itself (NFR-14) |

Shared mode, step by step:
1. On start the app calls `app_snapshot(store)` (store slug `dalbit`; `?store=` selects another existing store, e.g. a throwaway test store). It returns every row of the store, the store revision and the server time; the rows are loaded into an in-memory SQLite working copy with the schema of §8, and `now()` follows the server time from then on (the demo clock cannot be changed).
2. A command runs the unchanged service function inside `tx()` on the working copy. The gateway compares the tables before and after the command and sends the changed rows (inserts, updates, deletes by primary key) with the revision it started from to `app_commit(store, base_rev, changes)`. A command that fails with a ServiceError before changing anything sends nothing; a command that saves a change and then reports an error (BR-12: expire, then REQUEST_CLOSED) sends its change first.
3. `app_commit` (SECURITY DEFINER, `search_path = ''`) locks the store row (`SELECT … FOR UPDATE`), refuses a change set whose base revision is not the current one (STALE), checks the rate limits and sizes of NFR-14, applies the rows, lets the row triggers check the state machine and server-time rules, and increments the revision — all in one transaction; a violation rolls everything back.
4. On STALE the gateway reloads the snapshot and runs the same command again on the current data (at most three attempts). Of two simultaneous acceptances the second is therefore recomputed on data in which the request is already ACCEPTED and fails with the normal message (BR-02, NFR-04). On a rule violation the gateway reloads and runs the command once more, so the user sees the service's own message (e.g. REQUEST_CLOSED when the deadline passed by server time).
5. System Clock work that a screen triggers (BR-12 expiry, BR-14 draft, the weekly recomputation of the Week screen) runs the same way and is saved in the background; if it is refused, the working copy is reloaded.
6. Other users' changes: the gateway reads the store revision every 10 seconds and when the window regains focus; if it changed, it reloads the snapshot and redraws the screen, except while a sheet is open or a command is being saved (NFR-15).
7. Reset: `app_reset(store)` (SECURITY DEFINER, at most once a minute and 50 times a day per store) replaces the store's rows with the seed of §10, moved to the current date.
8. Trust boundary: without passwords the server cannot know who acts. It guarantees integrity (NFR-14), first acceptance, server time and the limits, not identity; anyone who opens the app can act as any demo account. All shared data are fictional seed data and readable by anyone with the publishable key; the screens still show phone numbers and wages only to the owner and that worker (NFR-11).

Local demonstration mode: the same app with the sql.js database persisted in `localStorage` and the adjustable demo clock (behaviour of iterations 1–7). It is selected in Demo tools or with `?mode=local` (`?mode=shared` returns to the shared mode; the choice is remembered in `localStorage`), and it is offered when the shared database cannot be reached (NFR-16). The automated checks and the screenshots use it because they need a fixed clock.

Key classes for the class diagram (domain view): Workplace, Worker (role OWNER/WORKER), FixedSchedule, Shift, SubRequest, SubRequestTarget, Attendance, WeeklySummary, Payroll, MinimumWage, Notification; services: ScheduleService, SubstituteService, AttendanceService, PayrollService, NotificationService; rule object: LaborRules; shared-data gateway: SharedGateway (iteration 8).

Sequence diagrams required: SD-1 Request substitute (UC-04), SD-2 Accept request with concurrent second acceptance (UC-05; shown in the shared mode: change set, `app_commit`, STALE and re-run), SD-3 Approve substitution with weekly recomputation (UC-06, including the BR-15 warning in the preview), SD-4 Generate monthly payroll (UC-09).

Component and deployment diagrams show both data modes: the browser (static files from GitHub Pages, sql.js working copy) and the Supabase PostgreSQL database reached over HTTPS (REST and RPC).

State diagrams: SubRequest, Shift, Payroll. Activity diagrams: AD-1 Holiday-allowance determination (BR-06/07), AD-2 Candidate selection (BR-01).

## 10. Seed / demo data (fixed; used in screenshots and tests)

- Workplace: **Dalbit Café (달빛카페)**, regularEmployees = 4, policy EXCUSED.
- MinimumWage: 2025 → 10,030; 2026 → 10,320.
- Names are stored in English (e.g. `Park Jiyoung`, `Dalbit Café`); the Korean UI displays the seed people and store with the Korean names given below (display map only; names not in the map are shown as stored). Phone numbers (fictional): ids 1–5 → `010-3827-1150`, `010-4172-2083`, `010-5290-3316`, `010-6631-4427`, `010-7748-5539`.
- Owner: **Park Jiyoung (박지영)**, id 1.
- Workers (hourly wage KRW, contract, fixed shifts):
  - id 2 **Lee Seoyeon (이서연)** 10,500; 2026-03-02 ~ 2027-02-28; Mon & Wed 18:00–23:00 (10 h/wk).
  - id 3 **Choi Minho (최민호)** 10,320; 2026-06-01 ~ 2026-12-31; Tue & Thu 18:00–23:00, Sat 12:00–18:00 (16 h/wk).
  - id 4 **Jung Hana (정하나)** 10,320; 2026-09-01 ~ open-ended, probationEnd 2026-11-30, simpleLabor 0; Fri 17:00–23:00, Sun 10:00–16:00 (12 h/wk).
  - id 5 **Kang Doyun (강도윤)** 10,000 (below minimum — triggers BR-09 warning); 2026-08-15 ~ 2026-11-15, simpleLabor 1; Sat 10:00–16:00 & Sun 16:00–22:00 (12 h/wk).
- Work history (iteration 7): for every worker, shifts are generated from the fixed schedule for every date from contractStart up to 2026-09-20 (Seoyeon from 2026-03-02, Minho from 2026-06-01, Doyun from 2026-08-15, Hana from 2026-09-01), each WORKED with a confirmed attendance at the scheduled times. Payroll rows for every month from the contract-start month to **2026-08** are CONFIRMED, computed exactly as generatePayroll (BR-06…BR-11); rows with a minimum-wage warning carry minWageAck = 1 (Doyun, 2026-08). No payroll row exists for 2026-09 in the seed, and the demo clock is in September, so no automatic draft is due until 2026-10-01 (demo walkthrough S9).
- Demo clock default (local demonstration mode): **2026-09-28T09:00** (Monday); the shared mode uses the server time and the moved seed described below. Weeks of 2026-09-21 and 2026-09-28 are generated; week of 2026-09-21 has confirmed attendance for all shifts.
- Seed request: Lee Seoyeon requests a substitute for Wed 2026-09-30 18:00–23:00, deadline 2026-09-29T21:00, reason "Midterm exam", createdAt 2026-09-28T08:30 → eligible: Choi Minho, Jung Hana and Kang Doyun (all co-workers; none works Wed 18–23). Status REQUESTED.

Demo walkthrough S7 (ABSENT policy, used in the reports): the owner sets the policy to ABSENT; Choi Minho requests a substitute for Sat 2026-10-03 12:00–18:00 → eligible: Lee Seoyeon and Jung Hana; Kang Doyun is excluded because his Sat 10:00–16:00 shift overlaps. If the swap is approved, Minho's week of 2026-09-28 loses perfect attendance and he is not eligible for holiday allowance that week.

Demo walkthrough S8 (no taker, iteration 6): Jung Hana requests a substitute for Sun 2026-10-04 10:00–16:00 → targets Lee Seoyeon, Choi Minho and Kang Doyun (Doyun's Sun 16:00–22:00 does not overlap); all three answer can't → the request ends FAILED; Hana sees "모든 동료가 대타가 불가능하다고 해요. 사장님께 연락드려 보세요." and the owner's Home shows a "대타를 못 구했어요" card with only 확인했어요.

Demo walkthrough S9 (automatic payroll, iteration 7): the owner opens Pay → Monthly and sees March–August 2026 as confirmed months; in Demo tools the clock is moved to 2026-10-01; the owner's Home then shows "9월 급여 초안이 준비됐어요" and Pay → Monthly shows the September 2026 DRAFT (Doyun's below-minimum warning still has to be acknowledged before confirming).

Worked example used in the reports (must match the app): if Choi Minho takes Seoyeon's Wednesday shift, Seoyeon's contractual hours stay 10 (not eligible either way, < 15), Minho's contractual hours stay 16 (eligible, holiday hours = 16/40×8 = 3.2 h → 3.2 × 10,320 = 33,024 KRW) while his scheduled hours for the week rise from 16 to 21.

Demo walkthrough S10 (part-time overtime, iteration 8): in Settings the owner sets 5 regular employees and adds a shift for Choi Minho on Fri 2026-10-02 10:00–18:00 (his week of 2026-09-28 then has 24 scheduled hours, contract 16). Minho accepts Seoyeon's Wednesday request; the owner's approval preview shows Minho 24 → 29 h and the BR-15 warning "13 h beyond contract (limit 12 h)". With 10:00–17:00 instead of 10:00–18:00 the preview shows 23 → 28 h, 12 h beyond contract, and no warning. With 4 regular employees there is no warning. Worked example (BR-08 iv): if the 29 hours are worked as scheduled, the chronological order Tue 5, Wed 5 (the swapped shift), Thu 5, Fri 8, Sat 6 reaches the 16 contractual hours one hour into Friday, so 7 h on Friday and 6 h on Saturday are beyond contract — 13 h, all in October — and October's premium includes 13 × 10,320 × 0.5 = 67,080 KRW for them (no day exceeds 8 h; the night hours 22:00–23:00 are paid separately under (iii)).

Shared-mode seed (iteration 8): the shared database keeps the same seed as a template generated from the seed code (`tools/seed-sql.mjs` writes it into `db/app-shared.sql`; a unit test checks that it is up to date). `app_reset` moves every date of the template by whole weeks so that the seed request is still open: by 7k days, where k is the smallest k ≥ 0 with 2026-09-29T21:00 + 7k days later than server time + 6 hours; weekdays, times and the walkthroughs stay the same, only the dates move. Shifts that have not ended by server time (a shift that ends at or before its start time ends on the next day) become SCHEDULED without attendance, and creation times later than server time become server time. Payroll rows are not part of the template, because calendar months do not move with whole weeks: the first app that opens a store without any Payroll row confirms the payroll of every month from the first contract month to two months before the current one, exactly as the local seed does (generate, acknowledge BR-09 warnings, confirm), and BR-14 then prepares the draft of the previous month and notifies the owner.

## 11. Test case IDs (unit tests in `tests/rules.test.js`, run with `node --test`)

TC-01x overlap & eligibility (BR-01); TC-02x request validity (BR-03); TC-05x first-acceptance concurrency (BR-02, NFR-04); TC-06x approval effect (BR-04); TC-08x holiday allowance incl. 15 h boundary (14.99 / 15) and 40 h cap, both policies (BR-06/07); TC-09x premium below/at 5 employees, night hours (BR-08); TC-10x minimum wage & probation conditions (BR-09/10); TC-11x monthly payroll totals (BR-11); TC-12x expiry (BR-12); TC-13x no taker (BR-13); TC-14x automatic monthly payroll draft and seeded history (BR-14, FR-23); TC-09x also covers part-time overtime beyond contract (BR-08 iv: weekly test, chronological order, month boundary, counted once, night separate, C = 0 and C ≥ 40 excluded); TC-15x part-time weekly limit warning, 12 h no warning / 13 h warning, 4 vs 5 regular employees (BR-15, FR-24); TC-16x shared mode — change sets, stale re-run, error mapping, seed template up to date (NFR-04, NFR-14, NFR-15; unit tests in `tests/shared.test.js` against an in-process fake server). The shared database itself is tested over REST with the publishable key (`tools/shared-rest.mjs`) and in two headless browsers (`tools/shared-check.mjs`: shared notice, server time, two simultaneous acceptances, approval seen by the other browser through polling, reset for everyone), both on throwaway stores `e2e-…` that are deleted afterwards.

## 12. Traceability rule

Every FR maps to ≥1 UC, every UC to ≥1 screen and service function, every BR to ≥1 test case. The final report contains the full matrix.

## 13. Sources (reference list entries)

The proposal's reference list [1]–[22] is authoritative for facts about laws and products (web pages accessed on 29 September 2026); the proposal's number is given in brackets.

1. Ministry of Employment and Labor, "2026 minimum wage KRW 10,320 per hour" (MOEL notice, 2025-08). https://www.moel.go.kr/news/enews/report/enewsView.do?news_seq=18144 [1]
2. Korea Policy Briefing, "2026년 시간당 최저임금 10,320원". https://www.korea.kr/news/policyNewsView.do?newsId=148956812 [2]
3. Labor Standards Act (근로기준법) Art. 11, 18, 55, 56; Enforcement Decree Art. 30. https://www.law.go.kr/법령/근로기준법 [3]
4. Minimum Wage Act (최저임금법) Art. 5 ②; Enforcement Decree Art. 3. https://www.law.go.kr/법령/최저임금법 [6]
5. Easy-Law (찾기쉬운 생활법령정보), "기간제 및 단시간근로자: 「근로기준법」 적용의 특례" (paid holidays of part-time workers and the 15-hour threshold). https://www.easylaw.go.kr/CSP/CnpClsMain.laf?csmSeq=1347&ccfNo=3&cciNo=2&cnpClsNo=1 [4] (replaces the earlier csmSeq=896 link, which now opens a general list page)
6. D. A. Gustafson, *Schaum's Outline of Software Engineering*, McGraw-Hill, 2002 (course textbook; Ch. 1 life cycle, Ch. 2 process & UML models, Ch. 8 requirements). [17]
7. I. Sommerville, *Software Engineering*, 10th ed., Pearson, 2016 (requirements classification used in lecture Ch. 8). [18]
8. OMG, *Unified Modeling Language Specification* v2.5.1, 2017. [21]
9. sql.js — SQLite compiled to WebAssembly. https://sql.js.org [20]
10. Related products (related-work section; only what the products' own help pages and public descriptions state, [7]–[16]): Deputy, When I Work and Homebase support a substitute workflow between co-workers — in Deputy a worker offers a shift to qualified and available co-workers and swaps can require the manager's approval [7]; When I Work lets a worker offer a shift to all or selected eligible co-workers, by default subject to a manager's approval, and its Find Replacement function gives the shift to the first eligible worker who picks it up [8, 9]; in Homebase a worker asks co-workers to cover a shift and a manager gives final approval after one accepts [10]. Deputy's employee app is available in Korean, but managers who build schedules on its web interface must work in English [11]. The help centres of these three products do not mention the Korean weekly holiday allowance. Shiftee, Shopl, Albami and Gig follow a workflow in which the manager edits the schedule or an employee sends a change request to the manager; Shiftee computes the weekly holiday allowance automatically and recognises it only when every contractual working day is worked [12, 13]; Shopl lets employees request schedule changes that the manager approves or rejects [14]; Albami and Gig manage schedules and the holiday allowance [15, 16]. The public feature descriptions of these four products do not include a substitute request between co-workers. No product found combines the co-worker substitute request with the Korean holiday-allowance rule at the moment of approval.
11. Act on the Protection, etc. of Fixed-term and Part-time Employees (기간제 및 단시간근로자 보호 등에 관한 법률), Art. 3 ②, Art. 6; Enforcement Decree Art. 2 and Annex 1 (work of part-time workers beyond contractual hours: consent, at most 12 hours a week, premium of at least 50 %; application to workplaces with five or more regular employees). https://www.law.go.kr/법령/기간제및단시간근로자보호등에관한법률 [5]
12. Supabase Docs, "Free project pausing" (a free-plan project with low activity over seven days is paused; a few requests to the database each day are typically enough to prevent it). https://supabase.com/docs/guides/platform/free-project-pausing [19]
13. GitHub Docs, "Events that trigger workflows" (schedule: in a public repository, scheduled workflows are disabled after 60 days without repository activity). https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows [22]

## 14. Course calendar (fixed)

Week n runs Monday–Sunday starting 2026-08-31 (Week 1 = 08-31…09-06). Deadlines are Fridays: Week 3 team formation **2026-09-18**, Week 5 proposal **2026-10-02**, Week 7 interim report **2026-10-16**, Week 14 final report + slides + presentation **2026-12-04** (Week 14 = 11-30…12-06). Topic comparison ran in Week 4 (09-21…09-27); the topic was selected on 2026-09-27. Increment 1 (Must) is due end of Week 10 (11-06), Increment 2 (Should) end of Week 11 (11-13).

## 15. Requirements change in iteration 6 (product-owner review, 2026-09-27)

Finding: when no co-worker's availability matched, the owner was only told "no candidate" and had nothing to do; availability slots were extra data workers had to maintain. Decision: availability is removed (UC-02, FR-03, table Availability, availability condition of BR-01 retired; IDs are kept retired, not reused). Every other active co-worker without an overlapping shift is asked; the first acceptance still wins (BR-02); a new "can't" answer lets the request end early as FAILED when nobody can take it (BR-13, FR-22), with a message to the requester to contact the owner and an acknowledge-only notification for the owner. Counts after the change: use cases 12 (UC-01, UC-03…UC-13), functional requirements 21 (FR-01, FR-02, FR-04…FR-22), business rules 13, tables 11.

## 16. Iteration 7 — history data and automatic monthly payroll (product-owner request, 2026-09-27)

Request: payroll data for past months based on the employees' contracts, and last month's payroll filled in automatically on the first day of every month. Decision: the seed now contains the full work history of each worker from contractStart (shifts, confirmed attendance) and confirmed payroll up to August 2026; a new use case UC-14 (actor System Clock), FR-23 and BR-14 prepare the previous month's draft automatically and notify the owner. Confirmation stays with the owner because of the minimum-wage acknowledgement (BR-09). Counts after the change: use cases 13 active (UC-01, UC-03…UC-14), functional requirements 22 active, business rules 14, tables 11.

## 17. Iteration 8 — shared database and part-time overtime (proposal revision, 2026-09-29)

Request: the revised proposal (2026-09-29) adopts a shared relational database on Supabase, so that the owner and every worker use one store from their own phones, and keeps the browser-only version as a local demonstration mode (fallback, risk R6). It adds the rule for part-time workers in workplaces with five or more regular employees — hours beyond the contractual hours need the worker's consent, are limited to 12 a week and earn a premium of at least 50 % — to BR-08, with a warning in the approval panel (F6, Should) when a swap would leave the acceptor with more than 12 hours beyond contract in that week. It rewrites the related work on facts confirmed in the products' own pages (§13 item 10), adds risk R6 (a free-plan project is paused after seven days of low activity; scheduled workflows of a public repository are disabled after 60 days without repository activity; a keep-alive read runs every six hours), and states that password authentication is out of scope and that the System Clock uses the server time in the shared mode. The product owner decided to convert the app to the shared database.

Decisions:
- Shared mode by working copy and change sets (§9). The service layer, the rules and their tests stay the same in both modes; the server applies a change set only to the revision it was computed on, under a row lock, and its triggers re-check what it can decide without knowing the user (NFR-14). Considered and not adopted: one RPC per use-case step (every rule would exist twice, in SQL and in JavaScript, and the two could disagree) and direct table writes under row-level-security policies (no transaction across several tables, so no guarantee of first acceptance).
- Authentication stays out of scope (demo accounts without passwords, FR-20); the server guarantees integrity, first acceptance, server time and limits, not identity (§9 step 8), and all shared data are fictional.
- A reset for everyone restores the seed, moved by whole weeks to the current date, at most once a minute (§10).
- Part-time overtime as system rules (BR-08 (iv) with rules (a)–(e), BR-15, FR-24); the readings considered and not adopted are recorded in BR-08.
- IDs: FR-24, NFR-14, NFR-15, NFR-16, BR-15, TC-15x and TC-16x are new; A3, UC-13, FR-20, NFR-04, NFR-05, NFR-06, NFR-08, NFR-10, BR-08 and BR-12 changed; nothing was renumbered.

Counts after the change: use cases 13 active (UC-01, UC-03…UC-14), functional requirements 23 active (FR-01, FR-02, FR-04…FR-24), non-functional requirements 16, business rules 15, tables 11 (the shared database holds them as 11 `app_` tables plus the service tables `app_store` and `app_store_gate`).
