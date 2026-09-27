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

### Team members

| Name (EN) | Name (KR) | Student ID | Affiliation | E-mail | Role |
|---|---|---|---|---|---|
| Hyewon Kim | 김혜원 | 24102028 | Dept. of Industrial Engineering, ITM Program, SeoulTech | (to be provided by member) | Requirements lead — problem definition, owner/worker interviews, functional & non-functional requirements, scenarios |
| Hyoungdo Kim | 김형도 | 18102075 | Dept. of Industrial Engineering, ITM Program, SeoulTech | zloganway@gmail.com | Project manager & design/implementation lead — WBS/schedule, UML design models, vibe-coding prompts, deployment |
| Minkyung Kim | 김민경 | 23102004 | Dept. of Industrial Engineering, ITM Program, SeoulTech | (to be provided by member) | UI & quality lead — UI screens, test cases, presentation deck, report integration |

(Topic origin: proposed by Hyewon Kim from her own part-time job experience; selected by the team after comparing seven candidate topics on 2026-09-27.)

## 1. Problem statement (short)

In small stores (cafés, convenience stores, restaurants) with fewer than ten part-time workers, each worker has **fixed weekly shifts** (e.g. every Monday 18:00–23:00). When a worker cannot come, the **owner phones or messages other workers one by one** to find a substitute, then **edits a spreadsheet** by hand, and at month end must **re-check each worker's weekly hours** to decide whether the **weekly holiday allowance (주휴수당)** is owed. Three problems follow:

- P1. Finding a substitute costs the owner repeated one-to-one contacts (reference store: typically 3–5 contacts per request, Hyewon's store).
- P2. The schedule, weekly hours and holiday-allowance eligibility of **two** workers change with every swap, and all recalculation is manual.
- P3. Legal pay rules (minimum wage, holiday allowance, 5-employee threshold for premiums, probation reduction) are applied from memory, so errors are not caught before payday.

## 2. Actors

| ID | Actor | Type | Description |
|---|---|---|---|
| A1 | Worker | Primary, human | Part-time employee. Views own schedule, registers availability, requests substitutes, responds to requests, records attendance. |
| A2 | Owner | Primary, human | Store owner (also acts as manager). Registers workers and fixed schedules, approves/rejects substitutions, confirms attendance, reviews weekly summaries, confirms monthly payroll, edits settings. |
| A3 | System Clock | Secondary, system | Time-triggered actor. Expires unanswered/unapproved requests at their deadline and closes weeks for weekly summary. (In the demo app this is driven by the adjustable "demo clock".) |

## 3. Use cases (core = UC-01…UC-09 map 1:1 to the nine functions of the proposal)

| ID | Name | Primary actor | Priority | Main tables |
|---|---|---|---|---|
| UC-01 | Register worker and fixed schedule | Owner | Must | Worker, FixedSchedule |
| UC-02 | Register availability | Worker | Must | Availability |
| UC-03 | Generate weekly schedule | Owner | Must | Shift |
| UC-04 | Request substitute | Worker | Must | SubRequest, SubRequestTarget, Notification |
| UC-05 | Respond to substitute request (accept / decline) | Worker (candidate) | Must | SubRequestTarget, SubRequest |
| UC-06 | Approve or reject substitution | Owner | Must | SubRequest, Shift, WeeklySummary |
| UC-07 | Record and confirm attendance | Worker, Owner | Should | Attendance, Shift |
| UC-08 | Compute weekly hours and holiday allowance | Owner (System) | Must | WeeklySummary, Workplace |
| UC-09 | Generate and confirm monthly payroll | Owner | Should | Payroll, MinimumWage, Worker |
| UC-10 | Manage workplace settings and minimum wage table | Owner | Should | Workplace, MinimumWage |
| UC-11 | Expire overdue substitute request | System Clock | Must | SubRequest, SubRequestTarget, Notification |
| UC-12 | Cancel own substitute request | Worker | Should | SubRequest, SubRequestTarget |
| UC-13 | Sign in by role (demo account selection) | Worker, Owner | Must | Worker |

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
| FR-03 | A worker shall register availability slots (weekday, start, end) during which they can take substitute shifts. | UC-02 |
| FR-04 | The system shall generate the shifts of a given week (Mon–Sun) from all active fixed schedules; generating the same week twice shall not create duplicates. | UC-03 |
| FR-05 | The owner shall be able to add, move or delete a single shift of a generated week. Deleting a shift that has a substitute request or an attendance record is refused with an explanatory message. | UC-03 |
| FR-06 | A worker shall create a substitute request for one of their own future SCHEDULED shifts, with an optional reason and a response deadline. | UC-04 |
| FR-07 | On creation the system shall compute the eligible candidates (BR-01), create one SubRequestTarget per candidate, and put a notification in each candidate's inbox at once. | UC-04 |
| FR-08 | If no worker is eligible, the system shall still create the request and notify the owner that no candidate exists. | UC-04 |
| FR-09 | A candidate shall accept or decline a request from their inbox. The first acceptance makes that candidate the request's acceptor (BR-02); later acceptances shall be refused with an explanatory message. | UC-05 |
| FR-10 | When a request is accepted, the system shall notify the requester and the owner, and close all other pending targets. | UC-05 |
| FR-11 | The approval screen shall show, for both the requester and the acceptor, the weekly contractual hours, weekly scheduled hours and holiday-allowance eligibility **before and after** the swap, and highlight any eligibility change. | UC-06 |
| FR-12 | On approval the system shall reassign the shift to the acceptor (keeping the original worker), recompute the weekly summaries of both workers, and notify both. On rejection the shift stays unchanged and both are notified. | UC-06 |
| FR-13 | A worker shall record actual start and end time of a shift they worked; the owner shall confirm it or mark the shift ABSENT. | UC-07 |
| FR-14 | The system shall compute, per worker and week, contractual hours, scheduled hours, actual hours, perfect-attendance flag, holiday-allowance eligibility and holiday-allowance hours (BR-06, BR-07). | UC-08 |
| FR-15 | The owner shall generate a monthly payroll draft per worker (base pay, holiday allowance, premium pay, total) and confirm it; a confirmed payroll is read-only. | UC-09 |
| FR-16 | The payroll screen shall warn when a worker's hourly wage is below the applicable minimum wage (BR-09), and apply the probation reduction only when BR-10 holds. | UC-09 |
| FR-17 | The owner shall edit workplace settings: store name, number of regular employees, substitution-attendance policy (BR-06), and yearly minimum wage rows. | UC-10 |
| FR-18 | When a request's deadline passes, or its shift starts, while it is still REQUESTED or ACCEPTED, the system shall mark it EXPIRED, close its targets and notify requester and owner. | UC-11 |
| FR-19 | A requester shall cancel their own request while it is REQUESTED or ACCEPTED; all PENDING targets become CLOSED, and every target that was PENDING or ACCEPTED receives a REQUEST_CANCELLED notification. | UC-12 |
| FR-20 | Users shall sign in by choosing a demo account; the UI shows only the menus of that role. | UC-13 |
| FR-21 | Every user shall have an in-app notification inbox listing notifications newest first with unread count. | UC-04–06, 11, 12 |

## 5. Non-functional requirements (classified as in Chapter 8: Product / Organisational / External)

| ID | Class | Sub-class | Requirement | Verification |
|---|---|---|---|---|
| NFR-01 | Product | Usability | A candidate can accept a request in at most 2 clicks from the inbox. | UI walkthrough |
| NFR-02 | Product | Usability | All screens are usable at 360 px width (mobile) and 1440 px (desktop) without horizontal scrolling. | Browser check at both widths |
| NFR-03 | Product | Efficiency / Performance | With 20 workers and 12 weeks of shifts, any screen renders in under 1 second on a mid-range laptop. | Timed load with seeded data |
| NFR-04 | Product | Reliability | "First acceptance wins" is enforced inside one database transaction that re-checks the request state; two acceptances can never both succeed. | Unit test TC-05x |
| NFR-05 | Product | Reliability | Data persists across page reloads (browser storage) and can be reset to seed data. | Manual test |
| NFR-06 | Product | Portability | Runs in current Chrome, Edge, Safari, Firefox without installation or server. | Manual test |
| NFR-07 | Organisational | Delivery | Working system deployed by Week 14 (2026-12-04). | Deployed URL |
| NFR-08 | Organisational | Implementation | Static web application (HTML/CSS/JavaScript ES modules) with an embedded SQLite database (sql.js, WebAssembly); built by vibe coding from the final prompt; hosted on GitHub Pages. | Repository |
| NFR-09 | Organisational | Standards | Models follow UML 2.5 notation; code identifiers in English. | Review |
| NFR-10 | External | Legislative | Pay rules follow the Minimum Wage Act (2026 minimum hourly wage KRW 10,320) and the Labor Standards Act (Art. 18 ③, Art. 55, Enforcement Decree Art. 30; Art. 11 / 56 premium threshold). | Unit tests TC-08x, TC-09x |
| NFR-11 | External | Privacy | A worker's phone number and wage are visible only to the owner and that worker (Personal Information Protection Act principle of minimum disclosure). | Role test |
| NFR-12 | External | Ethical | The system does not collect location data; attendance is self-reported and owner-confirmed. | Design review |

## 6. Business rules

- **BR-01 Eligible candidates.** A worker W is eligible for a request on shift S (date d, start s, end e) iff: W is active; W ≠ requester; W has no shift on date d overlapping [s, e); W has an availability slot on weekday(d) with slotStart ≤ s and slotEnd ≥ e.
- **BR-02 First acceptance wins.** Acceptance succeeds only if the request is REQUESTED at the moment of the transaction; it sets request.status = ACCEPTED, request.acceptorId = W, target(W).response = ACCEPTED, and all other PENDING targets → CLOSED.
- **BR-03 Request validity.** Only the shift's current worker can request; shift must be SCHEDULED and start in the future; at most one open (REQUESTED/ACCEPTED) request per shift; deadline must be after now and no later than the shift start.
- **BR-04 Approval effect.** Approve: shift.workerId = acceptor; shift.originalWorkerId keeps the first worker (set only if null); request → APPROVED. Reject: request → REJECTED, shift unchanged. Owner can approve only an ACCEPTED request.
- **BR-05 Week.** A week runs Monday 00:00 to Sunday 24:00 (ISO week). Weekly records are keyed by the Monday date.
- **BR-06 Holiday-allowance eligibility (주휴).** Eligible iff (a) weekly contractual hours ≥ 15, and (b) perfect attendance: every shift of the week whose *original* worker is W and that was not given away was not ABSENT (a shift that is still SCHEDULED does not break attendance, so the weekly result is a projection until the week is over). Shifts W gave away by an APPROVED substitution count according to Workplace.subAttendancePolicy: `EXCUSED` (default — the working day was changed by agreement, so it does not break attendance) or `ABSENT` (it breaks attendance). Contractual hours = sum of W's fixed-schedule hours per week. Substitute shifts W took do not change contractual hours. (Legal basis: Labor Standards Act Art. 55 ①, Enforcement Decree Art. 30 ①, Art. 18 ③. The law averages 15 h over four weeks; the system uses the weekly contractual hours from the fixed schedule, which is constant, so the average equals the weekly value.)
- **BR-07 Holiday-allowance hours.** hours = min(contractualHours, 40) / 40 × 8, rounded to 2 decimals; pay = hours × Worker.hourlyWage, rounded down to the won per week (monthly holiday pay is the sum of the rounded weekly amounts).
- **BR-08 Premium pay.** Applies only if Workplace.regularEmployees ≥ 5 (Labor Standards Act Art. 11, 56). Then +50 % of wage for (i) daily hours beyond 8, (ii) weekly hours beyond 40 not already counted in (i), (iii) night hours 22:00–06:00. Night premium adds to overtime premium. If regularEmployees < 5 → premium = 0. In a monthly payroll, weekly overtime uses only the days of that ISO week that fall inside the month. Premium pay = premium hours × wage × 0.5, rounded down.
- **BR-09 Minimum-wage check.** Warn if worker.hourlyWage < MinimumWage(year).hourly × (0.9 if BR-10 applies else 1). The payroll still computes with the worker's wage; the warning is shown on the payroll row and blocks confirmation until the owner acknowledges it, which sets Payroll.minWageAck = 1. Re-generating a DRAFT month replaces its rows, so acknowledgements must be given again.
- **BR-10 Probation reduction.** The minimum may be reduced to 90 % only if all hold: contract length ≥ 1 year (contractEnd − contractStart ≥ 365 days, or contractEnd empty = open-ended), the date is within 3 months of contractStart and ≤ probationEnd, and simpleLabor = false (Minimum Wage Act Art. 5 ②, Enforcement Decree Art. 3). In a monthly payroll the conditions are evaluated on the first day of the month, or on contractStart if later.
- **BR-11 Monthly payroll.** Month = calendar month. Base pay = Σ actual hours of WORKED shifts in the month × wage for WORKED shifts (recorded clock-in/out); SCHEDULED shifts in the month count with their scheduled hours and set estimated = 1 on the row; ABSENT shifts count 0. Holiday allowance = Σ holiday pay of weeks whose Sunday falls in the month. Total = base + holiday + premium. Amounts are integers in KRW, rounded down.
- **BR-12 Expiry.** A REQUESTED or ACCEPTED request whose deadline ≤ now, or whose shift start ≤ now, becomes EXPIRED.

## 7. States

**SubRequest.status**: `REQUESTED` → `ACCEPTED` (UC-05) → `APPROVED` | `REJECTED` (UC-06). `REQUESTED`/`ACCEPTED` → `EXPIRED` (UC-11) | `CANCELLED` (UC-12). Final states: APPROVED, REJECTED, EXPIRED, CANCELLED.

**SubRequestTarget.response**: `PENDING` → `ACCEPTED` | `DECLINED` | `CLOSED`.

**Shift.status**: `SCHEDULED` → `WORKED` (attendance confirmed) | `ABSENT` (owner marks). A SCHEDULED shift may be reassigned (BR-04) — status stays SCHEDULED.

**Attendance.confirmed**: 0 (recorded by worker) → 1 (confirmed by owner).

**Payroll.status**: `DRAFT` → `CONFIRMED`. Re-generating a month replaces DRAFT rows only.

## 8. Data model (SQLite; 12 tables)

```sql
CREATE TABLE Workplace (id INTEGER PRIMARY KEY, name TEXT NOT NULL, regularEmployees INTEGER NOT NULL DEFAULT 4,
  subAttendancePolicy TEXT NOT NULL DEFAULT 'EXCUSED' CHECK (subAttendancePolicy IN ('EXCUSED','ABSENT')));
CREATE TABLE Worker (id INTEGER PRIMARY KEY, workplaceId INTEGER NOT NULL REFERENCES Workplace(id), role TEXT NOT NULL CHECK (role IN ('OWNER','WORKER')),
  name TEXT NOT NULL, phone TEXT, hourlyWage INTEGER, contractStart TEXT, contractEnd TEXT, probationEnd TEXT,
  simpleLabor INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE FixedSchedule (id INTEGER PRIMARY KEY, workerId INTEGER NOT NULL REFERENCES Worker(id), weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  startTime TEXT NOT NULL, endTime TEXT NOT NULL);
CREATE TABLE Availability (id INTEGER PRIMARY KEY, workerId INTEGER NOT NULL REFERENCES Worker(id), weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  startTime TEXT NOT NULL, endTime TEXT NOT NULL);
CREATE TABLE Shift (id INTEGER PRIMARY KEY, workDate TEXT NOT NULL, startTime TEXT NOT NULL, endTime TEXT NOT NULL,
  workerId INTEGER NOT NULL REFERENCES Worker(id), originalWorkerId INTEGER REFERENCES Worker(id), fixedScheduleId INTEGER REFERENCES FixedSchedule(id),
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','WORKED','ABSENT')));
CREATE TABLE SubRequest (id INTEGER PRIMARY KEY, shiftId INTEGER NOT NULL REFERENCES Shift(id), requesterId INTEGER NOT NULL REFERENCES Worker(id),
  acceptorId INTEGER REFERENCES Worker(id), reason TEXT, deadline TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','ACCEPTED','APPROVED','REJECTED','EXPIRED','CANCELLED')), createdAt TEXT NOT NULL, decidedAt TEXT);
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

Attendance.clockIn/clockOut are `HH:MM` on the shift date (end ≤ start means next day). A WeeklySummary row exists only for workers who have a shift (as current or original worker) in that week; the seed contains no WeeklySummary or Payroll rows — they are derived.

Notification recipients:

| kind | recipients |
|---|---|
| REQUEST_RECEIVED | each eligible candidate (UC-04) |
| NO_CANDIDATE | owner (UC-04, FR-08) |
| REQUEST_ACCEPTED | requester and owner (UC-05) |
| TARGET_CLOSED | the other PENDING targets when someone accepts (UC-05) |
| REQUEST_APPROVED / REQUEST_REJECTED | requester and acceptor (UC-06) |
| REQUEST_EXPIRED | requester and owner; pending targets are closed silently (UC-11) |
| REQUEST_CANCELLED | every target that was PENDING or ACCEPTED (UC-12) |

A decline notifies no one.

## 9. Design (architecture)

Layered, client-only architecture:

| Layer | Module (file) | Responsibility |
|---|---|---|
| Presentation | `app/index.html`, `app/ui/*.js`, `app/styles.css` | Screens per role, routing by hash (`#/schedule`, `#/requests`, …) |
| Application services | `app/core/services.js` | Use-case operations (one function per UC step), transactions |
| Domain rules | `app/core/rules.js` | Pure functions: eligibility, overlap, weekly summary, holiday allowance, premium, payroll, minimum wage/probation — no DB access (unit-tested) |
| Data access | `app/core/db.js` | sql.js initialisation, schema, seed, persistence to `localStorage`, `tx()` helper |
| Clock | `app/core/clock.js` | Demo clock (`now()`), adjustable from the UI; System Clock actor ticks expiry on every navigation |

Key classes for the class diagram (domain view): Workplace, Worker (role OWNER/WORKER), FixedSchedule, Availability, Shift, SubRequest, SubRequestTarget, Attendance, WeeklySummary, Payroll, MinimumWage, Notification; services: ScheduleService, SubstituteService, AttendanceService, PayrollService, NotificationService; rule object: LaborRules.

Sequence diagrams required: SD-1 Request substitute (UC-04), SD-2 Accept request with concurrent second acceptance (UC-05), SD-3 Approve substitution with weekly recomputation (UC-06), SD-4 Generate monthly payroll (UC-09).

State diagrams: SubRequest, Shift, Payroll. Activity diagrams: AD-1 Holiday-allowance determination (BR-06/07), AD-2 Candidate selection (BR-01).

## 10. Seed / demo data (fixed; used in screenshots and tests)

- Workplace: **Dalbit Café (달빛카페)**, regularEmployees = 4, policy EXCUSED.
- MinimumWage: 2025 → 10,030; 2026 → 10,320.
- Names are stored in English (e.g. `Park Jiyoung`, `Dalbit Café`); the Korean UI shows them unchanged. Phone numbers (fictional): ids 1–5 → `010-3827-1150`, `010-4172-2083`, `010-5290-3316`, `010-6631-4427`, `010-7748-5539`.
- Owner: **Park Jiyoung (박지영)**, id 1.
- Workers (hourly wage KRW, contract, fixed shifts, availability):
  - id 2 **Lee Seoyeon (이서연)** 10,500; 2026-03-02 ~ 2027-02-28; Mon & Wed 18:00–23:00 (10 h/wk); avail Tue 17:00–23:00, Thu 17:00–23:00, Sat 10:00–22:00.
  - id 3 **Choi Minho (최민호)** 10,320; 2026-06-01 ~ 2026-12-31; Tue & Thu 18:00–23:00, Sat 12:00–18:00 (16 h/wk); avail Mon 17:00–23:00, Wed 17:00–23:00.
  - id 4 **Jung Hana (정하나)** 10,320; 2026-09-01 ~ open-ended, probationEnd 2026-11-30, simpleLabor 0; Fri 17:00–23:00, Sun 10:00–16:00 (12 h/wk); avail Mon 18:00–23:00, Sat 10:00–18:00.
  - id 5 **Kang Doyun (강도윤)** 10,000 (below minimum — triggers BR-09 warning); 2026-08-15 ~ 2026-11-15, simpleLabor 1; Sat 10:00–16:00 & Sun 16:00–22:00 (12 h/wk); avail Wed 18:00–23:00, Thu 18:00–23:00, Fri 17:00–23:00.
- Demo clock default: **2026-09-28T09:00** (Monday). Weeks of 2026-09-21 and 2026-09-28 are generated; week of 2026-09-21 has confirmed attendance for all shifts.
- Seed request: Lee Seoyeon requests a substitute for Wed 2026-09-30 18:00–23:00, deadline 2026-09-29T21:00, reason "Midterm exam", createdAt 2026-09-28T08:30 → eligible: Choi Minho (avail Wed 17–23). Kang Doyun also has Wed 18:00–23:00 availability → also eligible. Status REQUESTED.

Demo walkthrough S7 (ABSENT policy, used in the reports): the owner sets the policy to ABSENT; Choi Minho requests a substitute for Sat 2026-10-03 12:00–18:00 → eligible: Lee Seoyeon (avail Sat 10–22) and Jung Hana (avail Sat 10–18); Kang Doyun is excluded because his Sat 10:00–16:00 shift overlaps. If the swap is approved, Minho's week of 2026-09-28 loses perfect attendance and he is not eligible for holiday allowance that week.

Worked example used in the reports (must match the app): if Choi Minho takes Seoyeon's Wednesday shift, Seoyeon's contractual hours stay 10 (not eligible either way, < 15), Minho's contractual hours stay 16 (eligible, holiday hours = 16/40×8 = 3.2 h → 3.2 × 10,320 = 33,024 KRW) while his scheduled hours for the week rise from 16 to 21.

## 11. Test case IDs (unit tests in `tests/rules.test.js`, run with `node --test`)

TC-01x overlap & eligibility (BR-01); TC-02x request validity (BR-03); TC-05x first-acceptance concurrency (BR-02, NFR-04); TC-06x approval effect (BR-04); TC-08x holiday allowance incl. 15 h boundary (14.99 / 15) and 40 h cap, both policies (BR-06/07); TC-09x premium below/at 5 employees, night hours (BR-08); TC-10x minimum wage & probation conditions (BR-09/10); TC-11x monthly payroll totals (BR-11); TC-12x expiry (BR-12).

## 12. Traceability rule

Every FR maps to ≥1 UC, every UC to ≥1 screen and service function, every BR to ≥1 test case. The final report contains the full matrix.

## 13. Legal sources (reference list entries)

1. Ministry of Employment and Labor, "2026 minimum wage KRW 10,320 per hour" (MOEL notice, 2025-08). https://www.moel.go.kr/news/enews/report/enewsView.do?news_seq=18144
2. Korea Policy Briefing, "2026년 시간당 최저임금 10,320원". https://www.korea.kr/news/policyNewsView.do?newsId=148956812
3. Labor Standards Act (근로기준법) Art. 11, 18, 55, 56; Enforcement Decree Art. 30. https://www.law.go.kr
4. Minimum Wage Act (최저임금법) Art. 5 ②; Enforcement Decree Art. 3. https://www.law.go.kr
5. Easy-Law (찾기쉬운 생활법령정보), part-time workers' rest and holidays. https://easylaw.go.kr/CSP/CnpClsMain.laf?popMenu=ov&csmSeq=896&ccfNo=2&cciNo=3&cnpClsNo=1
6. D. A. Gustafson, *Schaum's Outline of Software Engineering*, McGraw-Hill, 2002 (course textbook; Ch. 1 life cycle, Ch. 2 process & UML models, Ch. 8 requirements).
7. I. Sommerville, *Software Engineering*, 10th ed., Pearson, 2016 (requirements classification used in lecture Ch. 8).
8. OMG, *Unified Modeling Language Specification* v2.5.1, 2017.
9. sql.js — SQLite compiled to WebAssembly. https://sql.js.org
10. Related products (for related-work section): Shiftee, 알바몬 근무관리 / 알바천국 스케줄, When I Work, Homebase, Deputy — shift scheduling products; none links substitute approval to Korean holiday-allowance eligibility at the moment of approval.

## 14. Course calendar (fixed)

Week n runs Monday–Sunday starting 2026-08-31 (Week 1 = 08-31…09-06). Deadlines are Fridays: Week 3 team formation **2026-09-18**, Week 5 proposal **2026-10-02**, Week 7 interim report **2026-10-16**, Week 14 final report + slides + presentation **2026-12-04** (Week 14 = 11-30…12-06). Topic comparison ran in Week 4 (09-21…09-27); the topic was selected on 2026-09-27. Increment 1 (Must) is due end of Week 10 (11-06), Increment 2 (Should) end of Week 11 (11-13).
