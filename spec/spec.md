# ShiftSwap — Canonical Specification v9 (single source of truth)

> Every artifact in this repository (database, app code, UML, interim report, final report, slides, prompts) MUST use the IDs, names, states, rules and numbers defined here. If something is not defined here, do not invent it in one artifact only — add it here first. Version 8 is kept as `prompts/spec-v8.md`; the reasons for every change are in §15–§18 and in `prompts/prompt-log.md`.

## 0. Project identity

| Item | Value |
|---|---|
| System name | **ShiftSwap** |
| Full title | ShiftSwap: A Shift Schedule and Substitute Management System for Small Part-Time Workplaces |
| Korean title | 소규모 매장 아르바이트 근무표·대타 관리 시스템 |
| Course | Software Engineering (2026 Fall), Seoul National University of Science and Technology (SeoulTech) |
| Team | Team 7 |
| Instructor submission e-mail | jihjim@gmail.com |
| Repository | `https://github.com/keemlogan/shiftswap` |
| Database | PostgreSQL. One SQL file, `db/shiftswap.sql` (tables, rules as database functions, seed), runs unchanged on the team's Supabase project `shiftswap` (ref `dbahxuegxnqsthntpuqy`, the team's deployment) and on Lovable Cloud (the reproduction run of the final prompt, §9.8) |
| Vibe-coding tools | Development and verification: **Claude Code** (Anthropic). Reproduction target of the final prompt: **Lovable** (the course's vibe-coding tool, with which the instructor re-runs the prompt) |
| UI prototype (requirements validation, iterations 1–8) | `https://keemlogan.github.io/shiftswap/app/` until the system of iteration 9 replaces it; the code stays in the repository history |

### Team members

| Name (EN) | Name (KR) | Student ID | Affiliation | E-mail | Role |
|---|---|---|---|---|---|
| Hyewon Kim | 김혜원 | 24102028 | Dept. of Industrial Engineering, ITM Program, SeoulTech | gokhw123@g.seoultech.ac.kr | Requirements lead — problem definition, owner/worker interviews, functional & non-functional requirements, scenarios |
| Hyoungdo Kim | 김형도 | 18102075 | Dept. of Industrial Engineering, ITM Program, SeoulTech | domo5776@seoultech.ac.kr | Project manager & design/implementation lead — WBS/schedule, UML design models, vibe-coding prompts, deployment |
| Mingyeong Kim | 김민경 | 23102004 | Dept. of Industrial Engineering, ITM Program, SeoulTech | min23@g.seoultech.ac.kr | UI & quality lead — UI screens, test cases, presentation deck, report integration |

Owner abbreviations in plans: HW, HD, MG. (The spelling "Mingyeong" follows the revised proposal; to be confirmed by the member.)

## 1. Problem statement (short)

In small stores (cafés, convenience stores, restaurants) with fewer than ten part-time workers, each worker has **fixed weekly shifts** (e.g. every Monday 18:00–23:00). When a worker cannot come, the **owner phones or messages other workers one by one** to find a substitute, then **edits a spreadsheet** by hand, and at month end must **re-check each worker's weekly hours** to decide whether the **weekly holiday allowance (주휴수당)** is owed. Three problems follow:

- P1. Finding a substitute costs the owner repeated one-to-one contacts (reference store: typically 3–5 contacts per request, Hyewon's store).
- P2. The schedule, weekly hours, pay and holiday-allowance eligibility of **two** workers change with every swap, and all recalculation is manual.
- P3. Legal pay rules (minimum wage, holiday allowance, 5-employee threshold for premiums, overtime of part-time workers beyond contractual hours, probation reduction) are applied from memory, so errors are not caught before payday.

## 2. Actors

| ID | Actor | Type | Description |
|---|---|---|---|
| A1 | Worker | Primary, human | Part-time employee. Views own schedule, requests substitutes, accepts or answers "can't" to requests from co-workers, records attendance. |
| A2 | Owner | Primary, human | Store owner (also acts as manager). Registers workers and fixed schedules, edits shifts and marks no-shows absent, approves/rejects substitutions, confirms attendance, reviews weekly summaries, confirms monthly payroll, edits settings. |
| A3 | System Clock | Secondary, system | Time-triggered actor. Ends open requests at their deadline (UC-11) and prepares missing past payroll drafts (UC-14). It has no process of its own: the database function `run_system_clock()` performs its duties whenever a screen is loaded (query-time evaluation, §9.4), and the request functions re-check the deadline inside their own transaction. "Now" is `app_now()`: the demo clock while it is set, otherwise the database server time in Korea Standard Time (§9.4). |

## 3. Use cases

Core use cases UC-01…UC-09 are the nine main functions of the proposal.

| ID | Name | Primary actor | Priority | Main tables |
|---|---|---|---|---|
| UC-01 | Register worker and fixed schedule | Owner | Must | worker, fixed_schedule |
| ~~UC-02~~ | ~~Register availability~~ — retired (§15); the ID is not reused | — | — | — |
| UC-03 | Manage weekly schedule | Owner | Must | shift |
| UC-04 | Request substitute | Worker | Must | sub_request, sub_request_target, notification |
| UC-05 | Respond to substitute request | Worker (candidate) | Must | sub_request_target, sub_request, notification |
| UC-06 | Approve or reject substitution | Owner | Must | sub_request, shift, weekly_summary, notification |
| UC-07 | Record and confirm attendance | Worker, Owner | Should | attendance, shift |
| UC-08 | Compute weekly hours and holiday allowance | Owner (System) | Must | weekly_summary, workplace |
| UC-09 | Generate and confirm monthly payroll | Owner | Should | payroll, minimum_wage, worker |
| UC-10 | Manage workplace settings and minimum wage table | Owner | Should | workplace, minimum_wage |
| UC-11 | Expire overdue substitute request | System Clock | Must | sub_request, sub_request_target, notification |
| UC-12 | Cancel own substitute request | Worker | Should | sub_request, sub_request_target, notification |
| UC-13 | Sign in by role (demo account selection, no password) | Worker, Owner | Must | worker |
| UC-14 | Prepare past payroll drafts automatically | System Clock | Should | payroll, notification |

UC-03 was "Generate weekly schedule"; it now also covers editing a single shift and marking a no-show absent (FR-05, FR-25), so its name is "Manage weekly schedule". UC-14 is Should because it reuses the computation of UC-09 (Should); a Must use case may not depend on a Should one (§3.1).

Relationships for the use case diagram:
- UC-04 «include» *Find eligible candidates* (BR-01).
- UC-06 «include» UC-08 (approval recomputes both workers' weeks).
- UC-09 «include» UC-08.
- UC-11 «extend» UC-04 (extension point: deadline reached before an approved acceptance).
- UC-12 «extend» UC-04 (extension point: requester withdraws).
- UC-14 «include» UC-09.
- Every use case except UC-11 and UC-14 requires a signed-in user (UC-13); the diagram states this in a note instead of drawing twelve «include» arrows.

Packages for the use case diagram: **Schedule** (UC-01, UC-03), **Substitution** (UC-04, UC-05, UC-06, UC-11, UC-12), **Attendance and pay** (UC-07, UC-08, UC-09, UC-14), **Administration** (UC-10, UC-13).

### 3.1 Increment 1 dependencies (Must use cases need nothing from Should use cases)

| Must use case | Needs | Provided in increment 1 by |
|---|---|---|
| UC-08 holiday allowance | whether each past shift was worked (BR-06 b) | BR-06 default: a past shift that the owner has not marked ABSENT counts as worked; marking ABSENT is FR-25 (UC-03, Must). Recording clock times (UC-07) is not needed. |
| UC-08 | substitution-attendance policy | seeded default EXCUSED (workplace row); editing it is UC-10 (Should) |
| UC-06 approval preview | hourly wages, regular-employee count, minimum wages | wages from UC-01 (Must); employee count 4 and minimum wages 2025 / 2026 are seeded defaults (UC-10 edits them) |
| UC-11 expiry | current time | `app_now()` (database function, no Should use case) |
| UC-04 / UC-05 | in-app notifications | FR-21 (Must) |

## 4. Functional requirements

Category = the package of the use case. Name = the use case name, as the course template requires.

| ID | Name | Category | Requirement | UC | Priority |
|---|---|---|---|---|---|
| FR-01 | Register worker and fixed schedule | Schedule | The owner shall register a worker with name, phone, hourly wage (KRW), contract start date, contract end date (optional), probation end date (optional), simple-labor flag and active flag. | UC-01 | Must |
| FR-02 | Register worker and fixed schedule | Schedule | The owner shall register one or more fixed weekly shifts per worker (weekday, start time, end time); an end time not later than the start time means the shift ends the next day (BR-05). Fixed shifts of the same worker must not overlap on the weekly time line, including across midnight and from Sunday into Monday. Deleting a fixed shift keeps the shifts it already generated. | UC-01 | Must |
| ~~FR-03~~ | — | — | Retired with UC-02 (availability is not collected). | — | — |
| FR-04 | Manage weekly schedule | Schedule | The system shall generate the shifts of a week (Monday–Sunday) from the fixed schedules of active workers, only on dates within each worker's contract period; generating the same week again creates no duplicate (a fixed slot is skipped when it already produced a shift that week or when the worker already has an overlapping shift). | UC-03 | Must |
| FR-05 | Manage weekly schedule | Schedule | The owner shall add, move (date, times, worker) or delete a single shift. A shift that has a substitute request or an attendance record cannot be deleted; a shift with an open request cannot be changed; a change that makes two shifts of one worker overlap is refused. | UC-03 | Must |
| FR-25 | Manage weekly schedule | Schedule | The owner shall mark a shift that has started and is still SCHEDULED as ABSENT, whether or not an attendance record exists (a no-show has none). | UC-03 | Must |
| FR-06 | Request substitute | Substitution | A worker shall create a substitute request for one of their own future SCHEDULED shifts, with an optional reason and a reply deadline. | UC-04 | Must |
| FR-07 | Request substitute | Substitution | On creation the system shall compute the eligible candidates (BR-01), create one target per candidate and put a notification in each candidate's inbox, all in the same transaction. | UC-04 | Must |
| FR-08 | Request substitute | Substitution | If no worker is eligible, the request ends at once as FAILED (BR-13): the requester is told that no co-worker can take the shift and to contact the owner, and the owner receives a REQUEST_FAILED notification. | UC-04 | Must |
| FR-09 | Respond to substitute request | Substitution | A candidate shall accept a request or answer "can't". The first acceptance makes that candidate the acceptor; it is decided by one database function in one statement (BR-02), so a later acceptance is refused with a message that names the first acceptor. | UC-05 | Must |
| FR-10 | Respond to substitute request | Substitution | When a request is accepted, the system shall notify the requester and the owner and close all other pending targets. | UC-05 | Must |
| FR-22 | Respond to substitute request | Substitution | When every target of a REQUESTED request has answered "can't", the request ends as FAILED (BR-13); the requester is told to contact the owner and the owner receives a REQUEST_FAILED notification that can only be acknowledged. | UC-05 | Must |
| FR-11 | Approve or reject substitution | Substitution | Before the decision the approval screen shall show, for the requester and the acceptor: weekly contractual hours, scheduled hours of that week before → after, holiday-allowance eligibility and amount before → after (with any change highlighted), and the estimated pay change of the week (base pay, and premium pay when the workplace has five or more regular employees), plus the change in the store's labour cost for that week (BR-16). | UC-06 | Must |
| FR-24 | Approve or reject substitution | Substitution | In a workplace with five or more regular employees the approval screen shall warn when the swap would leave a part-time acceptor with more than 12 hours beyond their weekly contractual hours in that week (BR-15); the warning does not block the decision. | UC-06 | Should |
| FR-12 | Approve or reject substitution | Substitution | On approval the system shall reassign the shift to the acceptor (keeping the original worker), recompute both workers' weekly summaries and notify both, in one database function (BR-04). On rejection the shift stays unchanged and both are notified. | UC-06 | Must |
| FR-13 | Record and confirm attendance | Attendance and pay | After a shift has ended, its worker shall record the actual clock-in and clock-out times, which must be plausible (BR-17); the owner shall confirm the record (the shift becomes WORKED) or mark the shift ABSENT. A WORKED or ABSENT shift cannot change status again. | UC-07 | Should |
| FR-14 | Compute weekly hours and holiday allowance | Attendance and pay | The system shall compute, per worker and ISO week, contractual hours, scheduled hours, actual hours, perfect attendance, holiday-allowance eligibility and holiday hours (BR-05–BR-07). A week is not recomputed when the month of its Sunday has a confirmed payroll. | UC-08 | Must |
| FR-15 | Generate and confirm monthly payroll | Attendance and pay | The owner shall generate a monthly payroll draft per worker (base pay, holiday pay, premium pay, total; BR-08–BR-11) and confirm it; a confirmed payroll is read-only. | UC-09 | Should |
| FR-16 | Generate and confirm monthly payroll | Attendance and pay | The payroll shall warn when a worker's hourly wage is below the applicable minimum (BR-09), apply the probation minimum only when BR-10 holds, and block confirmation until every warning of the month is acknowledged. | UC-09 | Should |
| FR-23 | Prepare past payroll drafts automatically | Attendance and pay | When the System Clock runs, every past month (from the first contract month to the month before now) that has no payroll row gets a DRAFT computed as in FR-15, and the owner receives one PAYROLL_DRAFT_READY notification per month; existing rows are never overwritten and nothing is confirmed automatically (BR-14). | UC-14 | Should |
| FR-17 | Manage workplace settings and minimum wage table | Administration | The owner shall edit the store name, the number of regular employees, the substitution-attendance policy (BR-06) and the yearly minimum wage rows. | UC-10 | Should |
| FR-18 | Expire overdue substitute request | Substitution | A request still REQUESTED or ACCEPTED when its deadline or its shift start has passed shall become EXPIRED, its pending targets closed and the requester and owner notified; the function runs whenever a screen is loaded and inside the accept and decide functions (BR-12). | UC-11 | Must |
| FR-19 | Cancel own substitute request | Substitution | A requester shall cancel their own request while it is REQUESTED or ACCEPTED; pending targets become CLOSED and every target that was pending or accepted is notified. | UC-12 | Should |
| FR-20 | Sign in by role | Administration | Users shall sign in by choosing a demo account without a password (password authentication is out of scope); the screen states that all data are fictional demo data shared by everyone who opens the app, and the UI shows only the menus of the chosen role. The owner's Demo tools set the demo clock and reset the demo data. | UC-13 | Must |
| FR-21 | (Notification inbox) | Substitution | Every user shall have an in-app notification inbox, newest first, with an unread count in the header. | UC-04–06, 11, 12 | Must |

## 5. Non-functional requirements

Classified as in Chapter 8. Numbers NFR-01…NFR-16 are kept from the proposal and earlier versions for traceability.

| ID | Type | Name | Specification | Verification |
|---|---|---|---|---|
| NFR-01 | Product · Usability | Quick answer | A candidate can accept a request in at most 2 clicks from Home or the inbox. | UI walkthrough |
| NFR-02 | Product · Usability | Phone and desktop | All screens are usable at 360 px (phone) and 1280 px (desktop) width without horizontal scrolling. | Browser check at both widths |
| NFR-03 | Product · Performance | Response time | With 20 workers and 12 weeks of shifts, every screen shows its data within 1 second after the database answers (each screen needs at most three database calls). | Timed load with seeded data |
| NFR-04 | Product · Reliability | First acceptance wins | Acceptance, decision, cancellation and expiry each run as one database function in one transaction; the state change is one conditional `UPDATE … WHERE status = …` so that, of two concurrent acceptances, exactly one succeeds. | Function tests; two-connection test |
| NFR-05 | Product · Reliability | Persistence and reset | Data persist in the database; the owner can restore the demo data, which also resets the demo clock. | Function test; manual test |
| NFR-06 | Product · Portability | Browsers | Runs in current Chrome, Edge, Safari and Firefox without installation. | Manual test |
| NFR-07 | Organisational · Delivery | Deadline | Working system deployed by Week 14 (2026-12-04). | Deployed URL |
| NFR-08 | Organisational · Implementation | Platform and method | Web front end in React with TypeScript; PostgreSQL with all business rules as database functions (§9); built by vibe coding with Claude Code from the final prompt; the final prompt also re-builds the system in Lovable, which provides the same PostgreSQL as Lovable Cloud. | Repository; reproduction run |
| NFR-09 | Organisational · Standards | Models and names | Models follow UML 2.5 notation; code identifiers in English. | Review |
| NFR-10 | External · Legislative | Labour law | Pay rules follow the Minimum Wage Act (2026 minimum hourly wage KRW 10,320), the Labor Standards Act (Art. 18 ③, Art. 55, Enforcement Decree Art. 30; Art. 11 / 56 premium threshold) and the Fixed-term and Part-time Employees Act (Art. 6); where the law leaves the method open, the system's rule is stated as a design decision (BR-06, BR-08, BR-15, BR-16). | Function tests TC-08x, TC-09x, TC-15x, TC-17x |
| NFR-11 | External · Privacy | Minimum disclosure on screen | The screens show a worker's phone number and wage only to the owner and to that worker. Because sign-in is a choice of demo account and the database is readable with the public key, this is screen-level protection only; therefore all data are fictional demo data, which the sign-in screen states. | Role test; design review |
| NFR-12 | External · Ethical | No location data | The system collects no location data; attendance is self-reported and owner-confirmed. | Design review |
| NFR-13 | Product · Usability | Task-first screens | Each role starts on a Home screen that lists the items waiting for that person with the action on each item; each screen has one primary action; an action that changes hours or pay shows its effect before the user commits; the UI language is Korean with an English alternative. | Walkthrough; headless check |
| NFR-14 | Product · Security | Writes only through functions | Row-level security is enabled on every table with read-only policies; the API roles have no insert, update or delete rights; every change goes through a database function (`SECURITY DEFINER`, empty `search_path`) that validates its input and the state transition. Identity is not verified (demo accounts, FR-20). | Function tests; REST test |
| NFR-15 | Product · Efficiency | Fresh screens | A change made by one user appears on the open screens of the others within 10 seconds (refresh on an interval and when the window regains focus). | Two-browser check |
| NFR-16 | Product · Dependability | Availability | Free plans pause inactive databases (Supabase after seven days of low activity; Lovable Cloud after a period of inactivity). The team's Supabase project is kept active by a scheduled read query every six hours (GitHub Actions, shared with the project hub); because GitHub disables scheduled workflows of a public repository after 60 days without activity, the deployed URL is also checked weekly until grading ends and before every submission (risk R6). | Workflow log; check log |

## 6. Business rules

- **BR-01 Eligible candidates.** A worker W is eligible for a request on shift S iff W is an active WORKER, W ≠ requester, the shift date lies within W's contract period, and W has no shift whose time interval overlaps the interval of S (BR-05 time line, so a shift ending after midnight on the previous day counts). Availability is not used (§15): every other co-worker is asked.
- **BR-02 First acceptance wins.** `accept_sub_request` performs one statement `UPDATE sub_request SET status = 'ACCEPTED', acceptor_id = W WHERE id = R AND status = 'REQUESTED' AND deadline > now AND shift start > now`. If it changes no row, the acceptance is refused (ALREADY_TAKEN when another candidate is the acceptor, otherwise REQUEST_CLOSED). The candidate must have a PENDING target and no overlapping shift (ACCEPTOR_BUSY); the overlap is checked again at approval. On success W's target becomes ACCEPTED and all other PENDING targets CLOSED.
- **BR-03 Request validity.** Only the shift's current worker can request; the shift must be SCHEDULED and start in the future; at most one open (REQUESTED/ACCEPTED) request per shift; the deadline must be after now and not later than the shift start.
- **BR-04 Approval effect.** Approve: shift.worker_id = acceptor; shift.original_worker_id keeps the first worker (set only if null); request → APPROVED with decided_at. Reject: request → REJECTED, shift unchanged. Only an ACCEPTED request can be decided, and only before its deadline and shift start.
- **BR-05 Time line and week.** A shift occupies the interval [work_date + start_time, work_date + end_time) when end_time > start_time, otherwise [work_date + start_time, work_date + 1 day + end_time) (it ends the next day). Its length is between 30 minutes and 16 hours. The shift belongs to its work_date and to the ISO week (Monday 00:00 – Sunday 24:00) of that date, even when it ends after midnight. Two shifts overlap iff their intervals overlap. Fixed shifts are compared on the weekly time line in the same way (Monday 22:00–02:00 overlaps Tuesday 01:00–05:00, Sunday 22:00–02:00 overlaps Monday 01:00–05:00). Weekly records are keyed by the Monday date.
- **BR-06 Holiday-allowance eligibility (주휴).** W is eligible for an ISO week iff (a) W's weekly contractual hours C ≥ 15, where C is the sum of W's fixed-schedule hours, and (b) perfect attendance: no shift of the week whose original worker is W and that W still holds is ABSENT. A shift that has not been marked ABSENT counts as worked (a past shift that is still SCHEDULED does not break attendance, so the owner's only duty is to mark no-shows; the result for the current week is a projection). Shifts W gave away by an APPROVED substitution count by Workplace.sub_attendance_policy: `EXCUSED` (default — the working day was changed by agreement, so attendance is not broken) or `ABSENT` (attendance is broken). Substitute shifts W took do not change C. (Legal basis: Labor Standards Act Art. 55 ①, Enforcement Decree Art. 30 ①, Art. 18 ③; the law averages 15 h over four weeks; the fixed schedule is constant, so the average equals C.)
- **BR-07 Holiday-allowance hours.** hours = min(C, 40) / 40 × 8, rounded to 2 decimals; weekly holiday pay = floor(hours × hourly wage). Monthly holiday pay is the sum of the weekly amounts.
- **BR-08 Premium pay.** Applies only if Workplace.regular_employees ≥ 5 (Labor Standards Act Art. 11, 56; Fixed-term and Part-time Employees Act Art. 3 ②, Art. 6, Enforcement Decree Art. 2 and Annex 1). Then +50 % of the hourly wage for (i) the hours of a work date beyond 8, (ii) the hours of an ISO week beyond 40 not counted in (i), (iii) night hours — the minutes of a shift's interval that fall between 22:00 and 06:00 of the next day on the actual time line, so a shift 22:00–02:00 has 4 night hours — and (iv) for a part-time worker, hours beyond the weekly contractual hours not counted in (i) or (ii). The night premium is added to the others. If regular_employees < 5, premium = 0. Hours count on the shift's work date (BR-05).
  System rules for (iv) — design decisions where the law does not fix the method: (a) a worker with 0 < C < 40 is part-time; C = 0 or C ≥ 40 is not; (b) the test is weekly against C; (c) the hours of an ISO week are taken in chronological order and every hour after the first C hours is beyond contract; (d) an hour that meets more than one of (i), (ii), (iv) counts once, so the overtime hours of a day are the larger of the daily hours beyond 8 and the hours beyond contract on that day; (e) the night premium is separate. In a monthly payroll, the days of an ISO week outside the month only decide where the first C hours (and the first 40 hours) end; only hours on dates inside the month are paid in that month. The worker's consent is outside the system; the 12-hour limit is checked before approval (BR-15).
- **BR-09 Minimum-wage check.** Warn if hourly_wage < minimum(year) × (0.9 if BR-10 applies else 1). The payroll still uses the worker's wage; the warning blocks confirmation of the month until the owner acknowledges it (min_wage_ack). Re-generating a DRAFT month replaces its rows, so acknowledgements must be given again.
- **BR-10 Probation reduction.** The minimum may be reduced to 90 % only if all hold: contract length ≥ 1 year (contract_end − contract_start ≥ 365 days, or contract_end empty = open-ended), the date is within 3 months of contract_start (from contract_start inclusive to the same calendar day three months later exclusive) and not after probation_end, and simple_labor = false. In a monthly payroll the conditions are evaluated on the first day of the month, or on contract_start if later; a worker without probation_end is never on probation.
- **BR-11 Monthly payroll.** Month = calendar month. A worker gets a row for the month if they have a paid shift or holiday pay in it, or if they are active and their contract overlaps the month. Hours are summed in minutes and converted once. Base pay = floor(Σ minutes × wage / 60) over the month's shifts of the worker: WORKED shifts with their recorded minutes, SCHEDULED shifts with their scheduled minutes (the row is then flagged estimated), ABSENT shifts 0. Holiday pay = Σ weekly holiday pay of the weeks whose Sunday falls in the month. Premium pay = floor(premium minutes × wage × 0.5 / 60). Total = base + holiday + premium. Amounts are integers in KRW.
- **BR-12 Expiry.** A REQUESTED or ACCEPTED request whose deadline ≤ now, or whose shift start ≤ now, becomes EXPIRED: pending targets are closed silently, requester and owner receive REQUEST_EXPIRED. `run_system_clock()` evaluates this whenever a screen is loaded; `accept_sub_request`, `decide_sub_request`, `decline_sub_request` and `cancel_sub_request` check the deadline themselves, so a late action is refused (REQUEST_CLOSED) even if no screen was loaded. Because the refusal rolls back the function's transaction, the expiry itself is stored by the next run of the System Clock.
- **BR-13 No taker.** A REQUESTED request ends as FAILED (final) when it has no eligible candidate at creation, or when every target has answered "can't" (DECLINED). FAILED sends REQUEST_FAILED to the requester and the owner; the owner's only action is to acknowledge it. Accepting a FAILED request is refused (REQUEST_CLOSED).
- **BR-14 Automatic payroll drafts.** When the System Clock runs, for every month M from the earliest contract_start month to the month before now: if no payroll row exists for M, generate the DRAFT of M exactly as `generate_payroll` does and notify the owner once (PAYROLL_DRAFT_READY). It never overwrites a row and never confirms.
- **BR-15 Part-time weekly limit warning.** When regular_employees ≥ 5 and the acceptor of an ACCEPTED request is part-time (0 < C < 40), let S be the acceptor's scheduled hours in the ISO week of the shift after the swap. If S − C > 12, the approval preview shows a warning with S − C ("13 h beyond contract, limit 12 h"). Exactly 12 hours gives no warning. The warning does not block approval. (Fixed-term and Part-time Employees Act Art. 6.)
- **BR-16 Swap cost estimate.** For an ACCEPTED request on shift S of ISO week W, the approval preview computes, for the requester R and the acceptor A, the week's pay before and after the swap with S moved from R to A: base = scheduled minutes of the worker's shifts in W that are not ABSENT × wage / 60 (floor); premium = BR-08 applied to the worker's non-ABSENT shifts of W as one week (floor of premium minutes × wage × 0.5 / 60; zero below five regular employees); holiday = BR-07 pay of W with BR-06 applied under the workplace policy. The change of each worker is after − before per component, and the store's labour cost change is the sum of both workers' changes. Worked examples in §10.
- **BR-17 Attendance plausibility.** Attendance can be recorded only after the shift's scheduled end. clock_in and clock_out are times; clock_in is placed on the day (the day before, the work date or the day after) on which it falls within [scheduled start − 2 h, scheduled end + 4 h), and clock_out is placed after clock_in, on the next day when it is not later than clock_in. The recorded interval must lie within [scheduled start − 2 h, scheduled end + 4 h] and last between 30 minutes and 16 hours (a 21:30 clock-in on a 22:00–02:00 shift is accepted; 23:00 → 18:00 on an 18:00–23:00 shift is not).

## 7. States

**sub_request.status**: `REQUESTED` → `ACCEPTED` (UC-05) → `APPROVED` | `REJECTED` (UC-06). `REQUESTED` → `FAILED` (BR-13). `REQUESTED`/`ACCEPTED` → `EXPIRED` (UC-11) | `CANCELLED` (UC-12). Final states: APPROVED, REJECTED, FAILED, EXPIRED, CANCELLED (five). Every transition is made only by the database function named in §9.3; no other path exists.

**sub_request_target.response**: `PENDING` → `ACCEPTED` | `DECLINED` | `CLOSED`.

**shift.status**: `SCHEDULED` → `WORKED` (attendance confirmed, UC-07) | `ABSENT` (owner marks, FR-13 / FR-25). A SCHEDULED shift may be reassigned by approval (BR-04); the status stays SCHEDULED.

**attendance.confirmed**: false (recorded by the worker) → true (confirmed by the owner).

**payroll.status**: `DRAFT` → `CONFIRMED`. Re-generating a month replaces DRAFT rows only; CONFIRMED rows are read-only.

## 8. Data model (PostgreSQL; 11 tables)

Canonical DDL is in `db/shiftswap.sql`; the essentials:

```sql
create table public.workplace (
  id int primary key,
  name text not null check (char_length(name) between 1 and 100),
  regular_employees int not null default 4 check (regular_employees between 0 and 1000),
  sub_attendance_policy text not null default 'EXCUSED' check (sub_attendance_policy in ('EXCUSED','ABSENT')),
  demo_clock timestamp            -- the demo clock (Korea time); null = real time (§9.4)
);
create table public.worker (
  id int generated by default as identity primary key,
  workplace_id int not null references public.workplace(id),
  role text not null check (role in ('OWNER','WORKER')),
  name text not null check (char_length(name) between 1 and 60),
  phone text check (char_length(phone) <= 30),
  hourly_wage int check (hourly_wage > 0),
  contract_start date, contract_end date, probation_end date,
  simple_labor boolean not null default false,
  active boolean not null default true
);
create table public.fixed_schedule (id int generated by default as identity primary key,
  worker_id int not null references public.worker(id), weekday int not null check (weekday between 1 and 7),
  start_time time not null, end_time time not null);
create table public.shift (id int generated by default as identity primary key,
  work_date date not null, start_time time not null, end_time time not null,
  worker_id int not null references public.worker(id), original_worker_id int references public.worker(id),
  fixed_schedule_id int references public.fixed_schedule(id) on delete set null,
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED','WORKED','ABSENT')));
create table public.sub_request (id int generated by default as identity primary key,
  shift_id int not null references public.shift(id), requester_id int not null references public.worker(id),
  acceptor_id int references public.worker(id), reason text check (char_length(reason) <= 200),
  deadline timestamp not null,
  status text not null check (status in ('REQUESTED','ACCEPTED','APPROVED','REJECTED','FAILED','EXPIRED','CANCELLED')),
  created_at timestamp not null, decided_at timestamp);
create unique index one_open_request_per_shift on public.sub_request(shift_id) where status in ('REQUESTED','ACCEPTED');
create table public.sub_request_target (id int generated by default as identity primary key,
  sub_request_id int not null references public.sub_request(id), worker_id int not null references public.worker(id),
  response text not null default 'PENDING' check (response in ('PENDING','ACCEPTED','DECLINED','CLOSED')),
  responded_at timestamp, unique (sub_request_id, worker_id));
create table public.attendance (id int generated by default as identity primary key,
  shift_id int not null unique references public.shift(id), clock_in time not null, clock_out time not null,
  confirmed boolean not null default false);
create table public.weekly_summary (id int generated by default as identity primary key,
  worker_id int not null references public.worker(id), week_start date not null,
  contract_hours numeric(6,2) not null, scheduled_hours numeric(6,2) not null, actual_hours numeric(6,2) not null,
  perfect_attendance boolean not null, holiday_eligible boolean not null, holiday_hours numeric(6,2) not null,
  holiday_pay int not null, unique (worker_id, week_start));
create table public.payroll (id int generated by default as identity primary key,
  worker_id int not null references public.worker(id), year_month text not null check (year_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  base_hours numeric(7,2) not null, base_pay int not null, holiday_pay int not null, premium_pay int not null, total int not null,
  min_wage_warning boolean not null default false, min_wage_ack boolean not null default false,
  estimated boolean not null default false,
  status text not null default 'DRAFT' check (status in ('DRAFT','CONFIRMED')), unique (worker_id, year_month));
create table public.minimum_wage (year int primary key, hourly int not null check (hourly > 0));
create table public.notification (id int generated by default as identity primary key,
  worker_id int not null references public.worker(id), sub_request_id int references public.sub_request(id),
  kind text not null check (kind in ('REQUEST_RECEIVED','REQUEST_ACCEPTED','TARGET_CLOSED','REQUEST_APPROVED',
    'REQUEST_REJECTED','REQUEST_EXPIRED','REQUEST_CANCELLED','REQUEST_FAILED','PAYROLL_DRAFT_READY')),
  params jsonb not null default '{}', created_at timestamp not null, read_at timestamp);
```

Times are `time` (24 h), datetimes `timestamp` in Korea time (no time zone). A notification stores its `kind` and `params` (names, shift, month); the screen composes the sentence in the chosen language. A weekly_summary row exists only for workers who have a shift (as current or original worker) in that week.

Notification recipients:

| kind | recipients |
|---|---|
| REQUEST_RECEIVED | each eligible candidate (UC-04) |
| REQUEST_FAILED | requester and owner (FR-08, FR-22, BR-13) |
| REQUEST_ACCEPTED | requester and owner (UC-05) |
| TARGET_CLOSED | the other PENDING targets when someone accepts (UC-05) |
| REQUEST_APPROVED / REQUEST_REJECTED | requester and acceptor (UC-06) |
| REQUEST_EXPIRED | requester and owner; pending targets are closed silently (UC-11) |
| REQUEST_CANCELLED | every target that was PENDING or ACCEPTED (UC-12) |
| PAYROLL_DRAFT_READY | owner, once per month prepared by the System Clock (UC-14) |

A single "can't" notifies no one; the one that makes every target DECLINED triggers REQUEST_FAILED.

## 9. Design (architecture)

### 9.1 Layers

| Layer | Element | Responsibility |
|---|---|---|
| Presentation | Web front end (React + TypeScript): pages per role (§19) | Shows data, collects input, calls one database function per user action; holds no business rule |
| API | PostgREST of Supabase / Lovable Cloud (`supabase.rpc(name, args)`) | HTTPS access with the public (publishable / anon) key |
| Domain rules and use-case steps | PostgreSQL functions in `db/shiftswap.sql` (PL/pgSQL, `SECURITY DEFINER`, `set search_path = ''`) | One function per use-case step (§9.3); validation, state transitions, notifications, computations of BR-01…BR-17 |
| Data | 11 tables (§8) with row-level security: read-only for the API roles | Storage |

The front end calls only database functions: one for every action and the read functions of §9.3 for every screen; it never reads or writes a table directly. There is no application server of the team's own and no copy of the data in the browser.

### 9.2 Errors

A function refuses an action with `raise exception using message = '<CODE>', detail = '<json params>', hint = '<English sentence>'`. The front end maps CODE to the sentence of the chosen language. Codes: SHIFT_NOT_FOUND, NOT_YOUR_SHIFT, NOT_SCHEDULED, SHIFT_STARTED, OPEN_REQUEST_EXISTS, DEADLINE_INVALID, REQUEST_NOT_FOUND, NOT_A_TARGET, ALREADY_TAKEN, REQUEST_CLOSED, ACCEPTOR_BUSY, NOT_REQUESTER, NOT_ACCEPTED, ATTENDANCE_CLOSED, SHIFT_NOT_STARTED, SHIFT_NOT_ENDED, ATTENDANCE_IMPLAUSIBLE, NO_ATTENDANCE, OVERLAP, SHIFT_LOCKED, SHIFT_HAS_HISTORY, OUTSIDE_CONTRACT, TIME_INVALID, WORKER_INVALID, MONTH_INVALID, MONTH_CONFIRMED, NO_DRAFT, MIN_WAGE_UNACKNOWLEDGED, SETTINGS_INVALID, DECISION_INVALID (a decision other than APPROVE or REJECT). A reason longer than 200 characters is refused by the table check (SQLSTATE 23514); the front end limits the input. Times are whole minutes (TIME_INVALID otherwise).

### 9.3 Functions (the API)

All functions are granted to `anon` and `authenticated`. Arguments that name the acting person (`p_worker_id`, `p_requester_id`) are the chosen demo account (identity is not verified, NFR-14).

| Function | UC / FR | Effect |
|---|---|---|
| `app_now() returns timestamp` | A3 | demo_clock if set, otherwise now() in Asia/Seoul |
| `run_system_clock() returns jsonb` | UC-11, UC-14 | `expire_overdue_requests()` then BR-14 drafts; returns `{expired, drafted_months}` |
| `expire_overdue_requests() returns int` | UC-11, FR-18 | BR-12 |
| `save_worker(p_id int, p_name text, p_phone text, p_hourly_wage int, p_contract_start date, p_contract_end date, p_probation_end date, p_simple_labor boolean, p_active boolean) returns int` | UC-01, FR-01 | insert (p_id null) or update |
| `save_fixed_schedule(p_worker_id int, p_slots jsonb) returns jsonb` | UC-01, FR-02 | replaces the worker's fixed slots `[{weekday, start_time, end_time}]`; OVERLAP / TIME_INVALID; returns slots and contract hours |
| `generate_week(p_week_start date) returns int` | UC-03, FR-04 | number of shifts created |
| `add_shift(p_work_date date, p_start time, p_end time, p_worker_id int) returns int` | UC-03, FR-05 | OVERLAP, OUTSIDE_CONTRACT, TIME_INVALID |
| `update_shift(p_shift_id int, p_work_date date, p_start time, p_end time, p_worker_id int) returns void` | UC-03, FR-05 | SHIFT_LOCKED when an open request exists; OVERLAP |
| `delete_shift(p_shift_id int) returns void` | UC-03, FR-05 | SHIFT_HAS_HISTORY |
| `mark_absent(p_shift_id int) returns void` | UC-03 / UC-07, FR-25 / FR-13 | SHIFT_NOT_STARTED, ATTENDANCE_CLOSED; recomputes the week |
| `preview_candidates(p_shift_id int, p_requester_id int) returns jsonb` | UC-04 | `[{id, name}]` by BR-01 |
| `create_sub_request(p_shift_id int, p_requester_id int, p_reason text, p_deadline timestamp) returns jsonb` | UC-04, FR-06–08 | BR-03, BR-01, BR-13; `{id, status, candidates}` |
| `accept_sub_request(p_request_id int, p_worker_id int) returns jsonb` | UC-05, FR-09–10 | BR-12 first, then BR-02 |
| `decline_sub_request(p_request_id int, p_worker_id int) returns jsonb` | UC-05, FR-22 | DECLINED; FAILED when all declined |
| `approval_preview(p_request_id int) returns jsonb` | UC-06, FR-11, FR-24 | BR-06, BR-07, BR-15, BR-16 for requester and acceptor |
| `decide_sub_request(p_request_id int, p_decision text) returns jsonb` | UC-06, FR-12 | `APPROVE` / `REJECT`; BR-12 first, then BR-04 |
| `cancel_sub_request(p_request_id int, p_requester_id int) returns jsonb` | UC-12, FR-19 | |
| `record_attendance(p_shift_id int, p_worker_id int, p_clock_in time, p_clock_out time) returns jsonb` | UC-07, FR-13 | BR-17 |
| `confirm_attendance(p_shift_id int) returns void` | UC-07, FR-13 | NO_ATTENDANCE, ATTENDANCE_CLOSED |
| `week_summary(p_week_start date) returns jsonb` | UC-08, FR-14 | recomputes and returns one row per worker with reasons; weeks of a confirmed month are returned as stored |
| `generate_payroll(p_year_month text) returns jsonb` | UC-09, FR-15–16 | BR-08–BR-11; MONTH_CONFIRMED |
| `acknowledge_min_wage(p_year_month text, p_worker_id int) returns void` | UC-09, FR-16 | |
| `confirm_payroll(p_year_month text) returns void` | UC-09, FR-15 | NO_DRAFT, MIN_WAGE_UNACKNOWLEDGED |
| `update_settings(p_name text, p_regular_employees int, p_policy text, p_minimum_wages jsonb) returns void` | UC-10, FR-17 | SETTINGS_INVALID |
| `mark_notifications_read(p_worker_id int, p_ids int[]) returns int` | FR-21 | null ids = all of that worker |
| `worker_home(p_worker_id int) returns jsonb` | UC-05, NFR-13 | requests for me (with my week's effect), my open requests, my FAILED requests, next shift, this week's hours, shifts to record |
| `owner_home() returns jsonb` | UC-06, NFR-13 | decisions waiting (with `approval_preview`), FAILED to acknowledge, attendance to confirm, payroll drafts ready, today's shifts, week totals |
| `week_board(p_week_start date) returns jsonb` | UC-03 | the week's shifts with worker names, open-request and handover markers |
| `shift_detail(p_shift_id int) returns jsonb` | UC-03 | shift, attendance, request history, allowed owner actions |
| `set_demo_clock(p_at timestamp) returns timestamp` | FR-20 | null = real time |
| `reset_demo_data() returns void` | FR-20, NFR-05 | deletes all rows and inserts the seed of §10; demo clock 2026-09-28 09:00 |

Read functions (the front end calls only functions, never tables, so every screen needs at most three calls, NFR-03):

| Function | Page | Returns |
|---|---|---|
| `demo_accounts() returns jsonb` | Sign-in | active accounts, owner first, with contract hours and fixed shifts |
| `get_settings() returns jsonb` | Settings, header | workplace, `app_now()`, minimum wages |
| `list_workers() returns jsonb` | Staff | workers with contract hours |
| `worker_detail(p_worker_id int) returns jsonb` | Staff detail, Me | worker, fixed slots, contract hours |
| `requestable_shifts(p_worker_id int) returns jsonb` | Request flow | own future SCHEDULED shifts without an open request, with the default deadline (earlier of now + 24 h and the shift start) |
| `my_requests(p_worker_id int) returns jsonb` | Swaps | `{mine, for_me}` with progress, acceptor, targets and the effect on my week |
| `attendance_list(p_worker_id int) returns jsonb` | Me | shifts of this and last week with attendance and `can_record` |
| `payroll_month(p_year_month text) returns jsonb` | Pay → Monthly | stored rows with flags, month status, open warnings, totals |
| `payroll_months() returns jsonb` | Pay → Monthly | months with rows and their status |
| `notifications(p_worker_id int) returns jsonb` | Notifications, header | items newest first and the unread count |

### 9.4 Time

`app_now()` returns workplace.demo_clock when it is set, otherwise `now() at time zone 'Asia/Seoul'`. The seed sets the demo clock to Monday 2026-09-28 09:00, so the demo data and the scenarios of §10 behave the same whenever the system is opened, also in a reproduction run months later. The owner's Demo tools move the clock (+1 hour, +1 day, a chosen date) or switch to real time. A new hour does not pass on its own while the demo clock is set; the System Clock duties run whenever a screen is loaded (query-time evaluation), which answers both the expiry and the monthly draft without a scheduler.

### 9.5 Concurrency

Each user action is one function call and one transaction. The state change of a request is one conditional `UPDATE … WHERE status = '…'`; under PostgreSQL's READ COMMITTED isolation a second concurrent update of the same row waits for the first and then re-evaluates its WHERE clause, so it changes no row and is refused. The unique partial index allows one open request per shift.

### 9.6 Security (NFR-14) and trust boundary

Row-level security is enabled on all tables with `select` policies `using (true)` for `anon` and `authenticated`; insert, update and delete are revoked from both roles. Functions are `SECURITY DEFINER` with `set search_path = ''` and fully qualified names, and validate every argument. Without passwords the database cannot know who acts: it guarantees integrity (valid transitions, one acceptor, time checks), not identity. All data are fictional demo data (FR-20, NFR-11).

### 9.7 Front end

React + TypeScript with Tailwind CSS. The team's build uses Vite and is published as static files on GitHub Pages; the reproduction run in Lovable produces Lovable's default React application (TanStack Start). Both call the same functions; screens and texts follow §19. The demo account choice is kept in the browser session.

### 9.8 Reproduction (final prompt)

The final prompt is a short ordered set of messages for Lovable (Lovable recommends small steps and its message queue no longer runs a stream of messages in order): (1) the database — the complete `db/shiftswap.sql`; (2) the design system and the application shell with sign-in; (3) the worker pages; (4) the owner pages; (5) the acceptance checklist of §11 run through the pages. Each message is sent after the previous one has finished. The same text is used to build the team's system with Claude Code. Acceptance is the checklist of §11 with the numbers of §10.

Design classes for the class diagram: domain «entity» classes Workplace, Worker, FixedSchedule, Shift, SubRequest, SubRequestTarget, Attendance, WeeklySummary, Payroll, MinimumWage, Notification; «control» classes ScheduleControl (UC-01, UC-03), SubstituteControl (UC-04–06, UC-11, UC-12), AttendanceControl (UC-07), PayControl (UC-08, UC-09, UC-14), AdminControl (UC-10, UC-13); in the design view each control class is realised by the functions of §9.3.

Sequence diagrams: SD-1 Request substitute (UC-04), SD-2 Accept with a concurrent second acceptance (UC-05; two calls of `accept_sub_request`, one row changed), SD-3 Approve substitution with preview and recomputation (UC-06), SD-4 Generate monthly payroll (UC-09).

State diagrams: SubRequest, Shift, Payroll. Activity diagrams: AD-1 Holiday-allowance determination (BR-06/07), AD-2 Candidate selection (BR-01).

## 10. Seed / demo data (fixed; used in screenshots and tests)

- Workplace id 1: **Dalbit Café (달빛카페)**, regular_employees = 4, policy EXCUSED, demo clock **2026-09-28 09:00** (Monday).
- minimum_wage: 2025 → 10,030; 2026 → 10,320.
- Names are stored in English; the Korean UI shows the seed people and store with the Korean names below (display map; other names as stored). Phones (fictional): ids 1–5 → `010-3827-1150`, `010-4172-2083`, `010-5290-3316`, `010-6631-4427`, `010-7748-5539`.
- Owner: **Park Jiyoung (박지영)**, id 1.
- Workers (hourly wage KRW; contract; fixed shifts):
  - id 2 **Lee Seoyeon (이서연)** 10,500; 2026-03-02 ~ 2027-02-28; Mon & Wed 18:00–23:00 (10 h/wk).
  - id 3 **Choi Minho (최민호)** 10,320; 2026-06-01 ~ 2026-12-31; Tue & Thu 18:00–23:00, Sat 12:00–18:00 (16 h/wk).
  - id 4 **Jung Hana (정하나)** 10,320; 2026-09-01 ~ open-ended, probation_end 2026-11-30, simple_labor false; Fri 17:00–23:00, Sun 10:00–16:00 (12 h/wk).
  - id 5 **Kang Doyun (강도윤)** 10,000 (below minimum — BR-09 warning); 2026-08-15 ~ 2026-11-15, simple_labor true; Sat 10:00–16:00 & Sun 16:00–22:00 (12 h/wk).
- Work history: for every worker, shifts from the fixed schedule for every date from contract_start to 2026-09-20, each WORKED with a confirmed attendance at the scheduled times; payroll for every month from the first contract month (2026-03) to **2026-08** generated, acknowledged and CONFIRMED by the same functions. Weeks of 2026-09-21 and 2026-09-28 generated; the week of 2026-09-21 has confirmed attendance for all shifts. No payroll row for 2026-09, so no automatic draft is due before 2026-10-01 (S10).
- Seed request: Lee Seoyeon, Wed 2026-09-30 18:00–23:00, deadline 2026-09-29 21:00, reason "Midterm exam", created 2026-09-28 08:30 → candidates Choi Minho, Jung Hana, Kang Doyun (no overlapping shift on Wed 18–23). Status REQUESTED.

Scenarios and worked examples (must match the system; the reports use these numbers):

- **S1** Seoyeon's request (seed): three candidates, three REQUEST_RECEIVED notifications.
- **S2** Minho accepts first; Doyun's later acceptance is refused with "Choi Minho accepted first" (ALREADY_TAKEN).
- **S3** Owner's preview and approval (4 regular employees, EXCUSED): Seoyeon contract 10 h, this week 10 → 5 h, no holiday allowance (contract below 15 h), pay **−52,500** (5 h × 10,500); Minho contract 16 h, 16 → 21 h, holiday allowance unchanged **33,024** (16/40 × 8 = 3.2 h × 10,320), pay **+51,600** (5 h × 10,320); premium 0; store labour cost **−900** for the week.
- **S4** Expiry: neither candidate answers; the demo clock is moved to 2026-09-29 21:00; the next screen load expires the request; requester and owner receive REQUEST_EXPIRED.
- **S5** No taker: Jung Hana requests a substitute for Sun 2026-10-04 10:00–16:00 → targets Seoyeon, Minho, Doyun (Doyun's Sun 16:00–22:00 does not overlap); all three answer "can't" → FAILED; Hana sees "모든 동료가 대타가 불가능하다고 해요. 사장님께 연락드려 보세요."; the owner acknowledges the card.
- **S6** September payroll at 2026-10-01 (S10's draft): Doyun's row shows the minimum-wage warning (10,000 < 10,320; BR-10 does not apply: contract under one year and simple labour); Hana's probation minimum 9,288 (10,320 × 0.9) applies and her wage is above it; confirmation is blocked until Doyun's warning is acknowledged.
- **S7** ABSENT policy: the owner sets the policy to ABSENT; Minho requests a substitute for Sat 2026-10-03 12:00–18:00 → candidates Seoyeon and Hana (Doyun's Sat 10:00–16:00 overlaps); Hana accepts; the preview shows Minho eligible → not eligible, holiday pay **−33,024**, pay −61,920 (6 h × 10,320); Hana +61,920; store −33,024.
- **S8** Part-time overtime (5 regular employees): the owner sets 5 regular employees and adds a shift for Minho on Fri 2026-10-02 10:00–18:00 (his week: 24 h scheduled, contract 16 h); Minho accepts Seoyeon's request; the preview shows Minho 24 → 29 h and the BR-15 warning "13 h beyond contract (limit 12 h)"; the BR-16 estimate for Minho: base +51,600, premium +30,960 (part-time hours beyond contract 8 → 13 and night hours 2 → 3, i.e. 6 premium hours × 10,320 × 0.5); for Seoyeon: base −52,500, premium −5,250 (night hours 2 → 1). With 10:00–17:00 instead the preview shows 23 → 28 h, exactly 12 h beyond contract, and no warning. If the 29 hours are worked, October's premium includes 13 × 10,320 × 0.5 = **67,080** for the hours beyond contract (Tue 5, Wed 5, Thu 5, Fri 8, Sat 6 in time order; contract reached one hour into Friday, so 7 h Fri + 6 h Sat) plus the night hours.
- **S9** Overnight shift: the owner adds a shift for Doyun on Fri 2026-10-02 22:00–02:00. It belongs to Friday and to the week of 2026-09-28; it lasts 4 h; with 5 regular employees all 4 h are night hours; an attempt to add a shift for Doyun on Sat 2026-10-03 01:00–05:00 is refused (OVERLAP).
- **S10** Automatic payroll draft: the demo clock is moved to 2026-10-01 09:00; the owner's Home shows "9월 급여 초안이 준비됐어요" and Pay → Monthly shows the September DRAFT (S6).
- **S11** No-show: the demo clock is moved to 2026-09-29 23:30; the owner opens Minho's Tue 2026-09-29 18:00–23:00 shift (no attendance recorded) and marks it absent; Minho's week of 2026-09-28 loses perfect attendance and its holiday allowance (33,024 → 0).

## 11. Tests and acceptance checklist

Function tests (`tests/db/*.test.mjs`, run against the SQL file in an embedded PostgreSQL, PGlite) are named with these IDs:

TC-01x eligibility and overlap on the time line (BR-01, BR-05); TC-02x request validity (BR-03); TC-05x first acceptance (BR-02, NFR-04) — sequential in PGlite and with two concurrent connections against PostgreSQL; TC-06x approval effect (BR-04); TC-08x holiday allowance incl. 14.99 / 15 h and the 40 h cap, both policies, the S3 and S11 examples (BR-06/07); TC-09x premium below/at five employees, night hours across midnight, part-time hours beyond contract incl. the S8 example (BR-08); TC-10x minimum wage and probation (BR-09/10); TC-11x monthly payroll totals and minute rounding (BR-11); TC-12x expiry by the System Clock and inside accept/decide (BR-12); TC-13x no taker (BR-13); TC-14x automatic drafts for every missing month (BR-14); TC-15x part-time limit warning 12 / 13 h and 4 / 5 employees (BR-15); TC-16x security: the API roles cannot write tables, functions validate their arguments (NFR-14); TC-17x swap cost estimate S3, S7, S8 (BR-16); TC-18x attendance plausibility and recording after the end (BR-17); TC-19x seed and reset (§10, NFR-05).

Acceptance checklist (screens; used by the team and by the reproduction run): S1–S11 of §10 walked through on the deployed system, each with the numbers given there, plus NFR-02 at 360 and 1280 px.

## 12. Traceability rule

Every FR maps to ≥ 1 UC, every UC to ≥ 1 page and ≥ 1 function, every BR to ≥ 1 test group, every scenario to the FRs it exercises. The final report contains the full matrix.

## 13. Sources (reference list entries)

The proposal's references remain authoritative for facts about laws and products (accessed 29 September 2026). Added for this version (accessed 10 October 2026):

1. Ministry of Employment and Labor, "2026 minimum wage KRW 10,320 per hour". https://www.moel.go.kr/news/enews/report/enewsView.do?news_seq=18144
2. Korea Policy Briefing, "2026년 시간당 최저임금 10,320원". https://www.korea.kr/news/policyNewsView.do?newsId=148956812
3. Labor Standards Act (근로기준법) Art. 11, 18, 55, 56; Enforcement Decree Art. 30. https://www.law.go.kr/법령/근로기준법
4. Minimum Wage Act (최저임금법) Art. 5 ②; Enforcement Decree Art. 3. https://www.law.go.kr/법령/최저임금법
5. Easy-Law, "기간제 및 단시간근로자: 「근로기준법」 적용의 특례". https://www.easylaw.go.kr/CSP/CnpClsMain.laf?csmSeq=1347&ccfNo=3&cciNo=2&cnpClsNo=1
6. D. A. Gustafson, *Schaum's Outline of Software Engineering*, McGraw-Hill, 2002.
7. I. Sommerville, *Software Engineering*, 10th ed., Pearson, 2016.
8. OMG, *Unified Modeling Language Specification* v2.5.1, 2017.
9. Act on the Protection, etc. of Fixed-term and Part-time Employees, Art. 3 ②, Art. 6; Enforcement Decree Art. 2 and Annex 1. https://www.law.go.kr/법령/기간제및단시간근로자보호등에관한법률
10. Related products (Deputy, When I Work, Homebase, Shiftee, Shopl, Albami, Gig) — as in the proposal.
11. PostgreSQL Documentation, "Transaction Isolation" (READ COMMITTED: a concurrent UPDATE re-checks its WHERE condition on the updated row). https://www.postgresql.org/docs/current/transaction-iso.html
12. Supabase Docs, "Database Functions" and "Row Level Security". https://supabase.com/docs/guides/database/functions ; https://supabase.com/docs/guides/database/postgres/row-level-security
13. Lovable Documentation, "Lovable Cloud", "Database", "Build with URL", "Credits and usage". https://docs.lovable.dev/features/cloud ; https://docs.lovable.dev/features/database ; https://docs.lovable.dev/integrations/build-with-url ; https://docs.lovable.dev/introduction/credits-and-usage

## 14. Course calendar (fixed)

Week n runs Monday–Sunday starting 2026-08-31 (Week 1 = 08-31…09-06). Deadlines are Fridays: Week 3 team formation 2026-09-18, Week 5 proposal 2026-10-02, Week 7 interim report **2026-10-16**, Week 14 final report + slides + presentation **2026-12-04**. Plan from the interim report on: Week 8 (10-19…10-25) design models and the test cases of §11 frozen; Week 9 (10-26…11-01) final prompt v1 and a Lovable trial of the database message (step 1 of §9.8); Week 10 increment 1 (Must) by 11-06; Week 11 increment 2 (Should) by 11-13; Week 12 deployment and test runs; Week 13 the final prompt re-run in an empty Lovable project and fixes; Week 14 submission.

## 15. Requirements change in iteration 6 (product-owner review, 2026-09-27)

Finding: when no co-worker's availability matched, the owner was only told "no candidate" and had nothing to do; availability slots were extra data workers had to maintain. Decision: availability is removed (UC-02, FR-03, table Availability, the availability condition of BR-01; IDs retired, not reused). Every other active co-worker without an overlapping shift is asked; a "can't" answer lets a request end early as FAILED (BR-13, FR-22).

## 16. Iteration 7 — history data and automatic monthly payroll (2026-09-27)

The seed contains each worker's work history and confirmed payroll to August 2026; UC-14, FR-23 and BR-14 prepare the previous month's draft automatically.

## 17. Iteration 8 — shared database and part-time overtime (proposal revision, 2026-09-29)

A shared database on Supabase as the default data mode of the prototype (a working copy in the browser and change sets applied by one function), the part-time overtime rule (BR-08 iv, BR-15, FR-24).

## 18. Iteration 9 — proposal feedback (2026-10-10)

Input: the instructor's feedback on the proposal and the team's review of the interim draft (10-07, 10-09).

Decisions:
- Architecture: one database function per use-case step; the browser keeps no copy of the data; the prototype's working copy, change sets and local demonstration mode are not part of the system (feedback ①-2, ①-3, ②-2). The scheduled keep-alive read of the Supabase project stays (feedback ②-2 found it adequate; NFR-16).
- Tools: Claude Code for development; the final prompt targets Lovable, the instructor's tool, and is tried there in Week 9 and re-run in Week 13 (feedback ①-3).
- Increment 1 needs nothing from increment 2: BR-06 default (unmarked past shift = worked), FR-25 marking absent (UC-03, Must), seeded settings, UC-14 → Should (feedback ③-1, ④-1).
- Approval shows money: BR-16 and FR-11 (feedback ③-2, ④-3).
- Overnight shifts: BR-05 time line, BR-08 (iii), BR-17 (feedback ③-3).
- Sign-in stays a demo-account choice; privacy is screen-level and all data are fictional (feedback ③-4; NFR-11, FR-20).
- In-app notifications remain; slow answers are risk R7 with mitigations (unread badge, deadline on every card, refresh every 10 s; feedback ②-1).
- Defects of the prototype found in the review and closed by rules: no-show could not be marked absent (FR-25), same-date-only overlap checks (BR-05), implausible clock times (BR-17), shifts after contract end (FR-04, BR-01), rounding per shift (BR-11), only the previous month drafted (BR-14), confirmed weeks rewritten (FR-14).
- IDs: FR-25, BR-16, BR-17, TC-17x, TC-18x, TC-19x are new; UC-03 is renamed; UC-14 is Should; TC-16x now tests security; no ID was renumbered.

Counts: use cases 13 active (UC-01, UC-03…UC-14), functional requirements 24 active (FR-01, FR-02, FR-04…FR-25), non-functional requirements 16, business rules 17, tables 11.

## 19. Pages and role-based access

| Page | Role | Content | Functions |
|---|---|---|---|
| Sign-in (demo) | all | "가상 데이터" notice; three-step tour (see Seoyeon's request → accept as Minho → approve as owner); all five accounts with role and weekly hours | reads worker |
| Home (worker) | Worker | requests for me with the effect on my week and Accept / Can't; my open requests with progress; my FAILED requests; next shift; this week's hours; shifts to record | `worker_home`, `accept_sub_request`, `decline_sub_request` |
| Home (owner) | Owner | decisions waiting with the preview of FR-11 / BR-16 and Approve / Reject; FAILED requests to acknowledge; attendance to confirm; payroll drafts ready; today's shifts; week totals | `owner_home`, `decide_sub_request`, `mark_notifications_read`, `confirm_attendance` |
| Schedule | both | week board (7 days); own shifts highlighted; open-request and handover markers; owner: add, move, delete, mark absent; worker: find a substitute | `week_board`, `shift_detail`, `generate_week`, `add_shift`, `update_shift`, `delete_shift`, `mark_absent` |
| Swaps | Worker | my requests (progress Requested → Accepted → Approved, cancel); requests for me; the three-step request flow (shift → reason → deadline and candidates → send) | `create_sub_request`, `preview_candidates`, `cancel_sub_request` |
| Me | Worker | contract, wage and phone (own only); attendance list and recording | `record_attendance` |
| Staff | Owner | worker list; worker detail with fixed shifts and contract hours | `save_worker`, `save_fixed_schedule` |
| Pay | Owner | Weekly (holiday allowance per worker with reasons); Monthly (draft, warnings, acknowledge, confirm, history) | `week_summary`, `generate_payroll`, `acknowledge_min_wage`, `confirm_payroll` |
| Settings | Owner | store name, regular employees, policy, minimum wages; Demo tools (clock, reset) | `update_settings`, `set_demo_clock`, `reset_demo_data` |
| Notifications | both | inbox, newest first | `mark_notifications_read` |

RBAC:

| Feature | Owner | Worker |
|---|---|---|
| View week board | O | O |
| Add / move / delete a shift, mark absent | O | X |
| Request a substitute for own shift | X | O |
| Accept / can't | X | O |
| Approve / reject a swap | O | X |
| Cancel own request | X | O |
| Record attendance | X | O (own shift) |
| Confirm attendance | O | X |
| Weekly summary, payroll | O | X |
| Register workers and fixed shifts | O | X |
| Settings and Demo tools | O | X |
| Notifications | O | O |
