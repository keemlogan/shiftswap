# ShiftSwap — Final Vibe-Coding Prompt for Lovable (v9, draft)

> Version history: v1–v8 (iterations 1–8) were prompts for a coding agent with file and shell access (Claude Code) and are kept as `prompts/prompt-v1.md` … `prompts/prompt-v8.md`. v9 (iteration 9) follows the instructor's feedback on the proposal: every business rule is a PostgreSQL function in `db/shiftswap.sql`, and the prompt targets Lovable, the tool with which the instructor re-runs it, while the team builds the same system with Claude Code from the same specification (`spec/spec.md` v9). This draft is tried in Lovable in Week 9; every change is recorded in `prompts/prompt-log.md`.
>
> **How to reproduce in Lovable.** Create a new Lovable project that uses the built-in backend (Lovable Cloud). Send the five messages below in order, each one only after the previous one has finished (Lovable no longer queues a stream of messages). Attach the file `db/shiftswap.sql` from the repository to Message 1. Lovable's free plan grants five build credits a day; the credits used by the team's runs are recorded in the prompt log.
>
> Why five messages: Lovable recommends small steps that can be checked one at a time and refuses destructive database changes by default, so the database is created first and completely, and the pages are added on top of it without changing it.

---

## Message 1 — Database

Build the backend of an app called **ShiftSwap** on Lovable Cloud.

The attached file `shiftswap.sql` is the complete database of the app: 11 tables with row-level security (read-only for the app), 41 database functions that contain every business rule, and the demo data. Apply it **exactly as it is, as one migration**: do not rename, rewrite, split, remove or add anything, and do not create other tables. The file ends with `select public.reset_demo_data();`, which inserts the demo data.

Do not build any page yet. When the migration has run, call `select public.demo_accounts();` and show me the result. It must list five accounts: Park Jiyoung (OWNER) and the workers Lee Seoyeon (10 h a week), Choi Minho (16 h), Jung Hana (12 h) and Kang Doyun (12 h). Then call `select public.get_settings();` — the demo clock must be 2026-09-28 09:00.

---

## Message 2 — Product brief, design system, app shell and sign-in

**Project goal.** ShiftSwap is a web app for a small café with part-time workers (the demo store is Dalbit Café, 달빛카페). It manages the weekly shift schedule, lets a worker find a substitute among co-workers (the first one to accept gets the shift, the owner approves), shows the owner what a swap costs before approving, and computes the weekly holiday allowance (주휴수당) and monthly pay under Korean labour law.

**User roles.** Owner (Park Jiyoung) and Worker (Lee Seoyeon, Choi Minho, Jung Hana, Kang Doyun). There are no passwords: a user picks a demo account on the sign-in page. All data are fictional demo data shared by everyone who opens the app.

**Data access — strict rules.**
- The app calls **only the database functions** of the migration with `supabase.rpc('<name>', { p_…: … })`. It never reads or writes a table directly (the tables are read-only for the app anyway).
- Before a page loads its data, call `run_system_clock()` once (it expires overdue requests and prepares missing payroll drafts).
- A refused action returns an error whose `message` is a code (for example `ALREADY_TAKEN`) and whose `details` is JSON with names and values; show a translated sentence for the code (list below) and use the error's `hint` only when the code is unknown.
- Every page needs at most three function calls. After any action, show a toast with the result and reload the page's data; refresh the open page every 10 seconds and when the window regains focus, unless a dialog or form is open.

**Design system.** Calm, clear and friendly, like a modern Korean banking app. Font Pretendard (`https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css`) with system fallbacks. Colours: text #191F28, secondary text #4E5968, tertiary #8B95A1, page background #F2F4F6, cards #FFFFFF, lines #E5E8EB; primary blue #2B5BD7 (pressed #2350C0, soft #EBF1FD) for own shifts and the primary button; amber #E9A23B (soft #FDF3E1, dark text #8A5300) only for substitution: open requests and handed-over shifts; alert red #D93A30 (soft #FDECEB); success green #1F8A55 (soft #E6F4EC); secondary buttons #E8EBF0. Cards with 16 px radius, buttons with 12 px radius, 52 px high on phones and 44 px from 900 px wide. Exactly **one filled primary button per page**; other actions grey or text buttons; a disabled button always shows why it is disabled; touch targets at least 44 px; no horizontal scrolling at 360 px. Status chips always carry text, not only colour. Numbers in KRW with thousands separators (33,024원 / ₩33,024).

**Language.** Korean by default, with an English switch in the user menu (remember it in localStorage). Korean display names: Park Jiyoung 박지영, Lee Seoyeon 이서연, Choi Minho 최민호, Jung Hana 정하나, Kang Doyun 강도윤, Dalbit Café 달빛카페. Dates in Korean like "9월 30일(수) 18:00–23:00", in English "Wed, Sep 30 · 18:00–23:00". A shift whose end time is earlier than its start time ends the next day ("다음 날 02:00까지" / "until 02:00 next day").

**Error codes and messages** (Korean / English): ALREADY_TAKEN "{name}님이 먼저 수락했어요." / "{name} accepted first."; REQUEST_CLOSED "이미 끝난 요청이에요." / "This request is already closed."; ACCEPTOR_BUSY "그 시간에 이미 근무가 있어요." / "You already have a shift at that time."; DEADLINE_INVALID "마감은 지금 이후, 근무 시작 전이어야 해요." / "The deadline must be after now and not after the shift start."; OPEN_REQUEST_EXISTS "이 근무에는 이미 진행 중인 요청이 있어요." / "This shift already has an open request."; OVERLAP "같은 사람의 다른 근무와 시간이 겹쳐요." / "It overlaps another shift of the same worker."; SHIFT_LOCKED "진행 중인 대타 요청이 있어 바꿀 수 없어요." / "This shift has an open request."; SHIFT_HAS_HISTORY "요청이나 출근 기록이 있어 지울 수 없어요." / "It has a request or attendance record."; OUTSIDE_CONTRACT "계약 기간 밖의 날짜예요." / "The date is outside the contract."; SHIFT_NOT_STARTED "아직 시작하지 않은 근무예요." / "This shift has not started yet."; SHIFT_NOT_ENDED "근무가 끝난 뒤에 기록할 수 있어요." / "You can record it after the shift ends."; ATTENDANCE_IMPLAUSIBLE "근무 시간과 맞지 않는 시각이에요." / "These times do not fit the shift."; ATTENDANCE_CLOSED "이미 확정된 근무예요." / "This shift is already closed."; MIN_WAGE_UNACKNOWLEDGED "최저임금 경고를 모두 확인한 뒤 확정할 수 있어요." / "Acknowledge every minimum-wage warning first."; MONTH_CONFIRMED "확정된 달은 바꿀 수 없어요." / "A confirmed month cannot change."; NO_DRAFT "먼저 급여 초안을 만들어 주세요." / "Generate the draft first."; TIME_INVALID / SETTINGS_INVALID / WORKER_INVALID / MONTH_INVALID / DECISION_INVALID "입력값을 확인해 주세요." / "Please check the input."; NOT_YOUR_SHIFT, NOT_SCHEDULED, SHIFT_STARTED, NOT_A_TARGET, NOT_REQUESTER, NOT_ACCEPTED, NO_ATTENDANCE, SHIFT_NOT_FOUND, REQUEST_NOT_FOUND: a short sentence that says what is not possible and why.

**Navigation.** Worker: Home, Schedule, Swaps, Me. Owner: Home, Schedule, Staff, Pay, Settings. Both: a bell in the header that opens Notifications and shows the unread count. Desktop (≥ 900 px): left navigation; phone: bottom tab bar. Header: store name, the demo clock from `get_settings().now`, the bell, a user menu (language, sign out).

**Build now:** the app shell, the navigation by role (a role never sees the other role's pages), the **Sign-in page** and the **Notifications page**.
- Sign-in (`demo_accounts`): a notice "모든 데이터는 가상의 데모 데이터예요. 이 앱을 여는 누구나 같은 데이터를 보고 바꿀 수 있어요." (EN: "All data are fictional demo data. Everyone who opens this app sees and changes the same data."); a three-step tour: (1) "See Lee Seoyeon's request" signs in as Seoyeon and opens Swaps, (2) "Accept as Choi Minho" opens Minho's Home, (3) "Approve as the owner" opens the owner's Home; below, all accounts with role and weekly hours. The chosen account is kept for the browser session.
- Notifications (`notifications`, `mark_notifications_read`): newest first; one sentence per kind built from its params (REQUEST_RECEIVED, REQUEST_ACCEPTED, TARGET_CLOSED, REQUEST_APPROVED, REQUEST_REJECTED, REQUEST_EXPIRED, REQUEST_CANCELLED, REQUEST_FAILED, PAYROLL_DRAFT_READY); "Mark all as read".

---

## Message 3 — Worker pages

Build the four worker pages. Use only the functions named for each page.

1. **Home** (`worker_home`, `accept_sub_request`, `decline_sub_request`). Sections in this order: "대타 요청이 왔어요 / Swap requests for you" — one card per open request for me with the requester, the shift, the reason, the reply deadline and the effect on my week (hours before → after and holiday pay, from the function), and the buttons **Accept** (the page's primary button) and "Can't"; accepting takes at most two clicks. My open requests with a tracker Requested → Accepted → Approved. A card for my FAILED request: "모든 동료가 대타가 불가능하다고 해요. 사장님께 연락드려 보세요." / "Every co-worker said they can't cover this shift. Please contact the owner." My next shift with "Find a substitute". This week's hours. Shifts I can record.
2. **Schedule** (`week_board`, `shift_detail`): the week (Monday–Sunday) with week navigation; desktop seven day columns, phone a list of days. My own shifts in primary blue. A shift with an open request has an amber dashed outline and the chip "대타 구하는 중 / Looking for cover". A handed-over shift has an amber left edge and shows the new worker with the original worker struck through. A shift that ends after midnight is shown on its start day with "→ next day". Tapping my own future shift offers "Find a substitute".
3. **Swaps** (`my_requests`, `requestable_shifts`, `preview_candidates`, `create_sub_request`, `cancel_sub_request`): "My requests" with the tracker and "Cancel request" while open; "Requests for me". The request flow in three steps: (1) choose one of my shifts from `requestable_shifts`; (2) optional reason with quick chips (시험 / 아파요 / 집안 일 / 기타; EN Exam / Sick / Family / Other) and free text; (3) the deadline pre-filled with the shift's `default_deadline` and the list of co-workers who will be asked (`preview_candidates`), then **Send swap request**. After sending, a result screen; if the request ended FAILED at once, say so with the FAILED sentence.
4. **Me** (`worker_detail`, `attendance_list`, `record_attendance`): my contract, hourly wage and phone, with the note "전화번호와 시급은 나와 사장님만 볼 수 있어요 (화면 기준)" / "Only you and the owner see your phone and wage (on screen)". Attendance list of this and last week with the state of each shift; "Record" on rows where `can_record` is true, with clock-in and clock-out time inputs (a clock-out after midnight is allowed).

---

## Message 4 — Owner pages

Build the five owner pages. Use only the functions named for each page.

1. **Home** (`owner_home`, `approval_preview`, `decide_sub_request`, `mark_notifications_read`, `confirm_attendance`): a count line "오늘 처리할 일 N개 / N things to handle today". "Swaps waiting for approval": one card per accepted request with the preview from `approval_preview` — one line per worker (requester and acceptor) showing this week's hours before → after, holiday allowance before → after (highlight it when eligibility changes) and the pay change; then the change in the store's labour cost for the week; when `warning` is present, an amber notice "{name}님은 이번 주 계약보다 {n}시간 더 일하게 돼요 (한도 12시간)" / "{name} would work {n} h beyond contract this week (limit 12 h)" — it never disables Approve. Buttons **Approve** (primary), Reject, Details (a table with all preview numbers: contract, scheduled before/after, holiday before/after, base, premium, total change). FAILED requests: a card whose only button is "확인했어요 / Got it". Attendance records to confirm. "September payroll draft is ready" with "Review payroll" when a PAYROLL_DRAFT_READY notification is unread. Today's shifts and this week's totals.
2. **Schedule** (owner view; `week_board`, `shift_detail`, `generate_week`, `add_shift`, `update_shift`, `delete_shift`, `mark_absent`): the same board as the worker's, plus "Add shift" (date, start, end, worker; end before start = next day). When a week has no shifts, call `generate_week` first. The shift dialog shows the history of requests and offers: "결근 처리 / Mark absent" only when the shift has started and is still SCHEDULED, change time, change worker, delete — show the refusal sentence when the function refuses.
3. **Staff** (`list_workers`, `worker_detail`, `save_worker`, `save_fixed_schedule`): the workers with their weekly contractual hours; a worker form with name, phone, hourly wage, contract start, contract end (optional), probation end (optional), simple labour, currently employed; the fixed shifts (weekday, start, end; an end before the start means "ends next day"); "Add worker".
4. **Pay** with two tabs. **Weekly** (`week_summary`): week navigation; one card per worker with eligibility for the holiday allowance, the amount, the hours (contract, scheduled, worked) and the reason when not eligible (contract under 15 h; absent on 9/29; gave the shift away under the "count as absence" policy); a note on the store's policy. **Monthly** (`payroll_months`, `payroll_month`, `generate_payroll`, `acknowledge_min_wage`, `confirm_payroll`): month navigation; one row per worker with hours, base pay, holiday pay, premium, total and chips (Draft, Confirmed, Estimated, Probation minimum 90 %, Below minimum wage); "Acknowledge" on a minimum-wage warning; the totals; **Confirm** (primary) disabled with the reason until every warning is acknowledged; "Generate draft" / "Rebuild draft" for a month that is not confirmed.
5. **Settings** (`get_settings`, `update_settings`, `set_demo_clock`, `reset_demo_data`): store name; number of regular employees with the hint "5명 이상이면 연장·야간 가산수당이 붙어요 / From 5, overtime and night premiums apply"; the policy for handed-over shifts: "결근으로 보지 않아요 (기본) / Do not count as absence (default)" or "결근으로 봐요 / Count as absence"; minimum wage per year (add, remove). **Demo tools**: the demo clock with "+1 hour", "+1 day", a date-time field with "Set", "Use real time"; "Reset demo data" with a confirmation.

---

## Message 5 — Acceptance checklist

Walk through these scenarios in the app. Before each one, open Settings → Demo tools → "Reset demo data". For every step, report PASS or FAIL; fix every FAIL in the pages (never in the database functions) and repeat the step.

1. **S1** Sign in as Lee Seoyeon → Swaps: her request for Wed 9/30 18:00–23:00 ("Midterm exam", deadline 9/29 21:00) is open; the candidates were Choi Minho, Jung Hana and Kang Doyun.
2. **S2** As Choi Minho: Home shows the request with "16 h → 21 h" and holiday allowance 33,024원 unchanged; Accept. As Kang Doyun: the request is no longer open; accepting is refused with "Choi Minho accepted first".
3. **S3** As the owner: the decision card shows Seoyeon 10 → 5 h, pay −52,500; Minho 16 → 21 h, holiday allowance 33,024 → 33,024, pay +51,600; store labour cost −900. Approve; Schedule shows Minho on Wed 9/30 with Seoyeon struck through.
4. **S4** Reset; as the owner set the demo clock to 2026-09-29 21:00 and open any page: Seoyeon's request is expired; Seoyeon and the owner have a notification.
5. **S5** Reset; as Jung Hana request a substitute for Sun 10/4 10:00–16:00; as Seoyeon, Minho and Doyun answer "Can't": the request ends failed; Hana sees the FAILED sentence; the owner's card has only "Got it".
6. **S7** Reset; owner sets the policy to "Count as absence"; Minho requests a substitute for Sat 10/3 12:00–18:00 (candidates Seoyeon and Hana only); Hana accepts; the owner's card shows Minho eligible → not eligible, holiday −33,024, pay −61,920; Hana +61,920; store −33,024.
7. **S8** Reset; owner sets 5 regular employees and adds a shift for Minho on Fri 10/2 10:00–18:00; Minho accepts Seoyeon's request; the card shows Minho 24 → 29 h, the warning "13 h beyond contract (limit 12 h)", Minho premium +30,960 and Seoyeon premium −5,250. With Fri 10:00–17:00 instead: 23 → 28 h and no warning.
8. **S9** Reset; owner adds a shift for Kang Doyun on Fri 10/2 22:00–02:00: it is shown on Friday, ending the next day, 4 h. Adding Sat 10/3 01:00–05:00 for Doyun is refused (overlap).
9. **S10** Reset; owner sets the demo clock to 2026-10-01 09:00: Home shows "September payroll draft is ready".
10. **S6** Continue: Pay → Monthly, September 2026: Seoyeon 472,500; Minho 844,176 (holiday 132,096); Hana 495,360 (probation minimum 9,288, no warning); Doyun 480,000 with "Below minimum wage"; total 2,292,036. Confirm is disabled until Doyun's warning is acknowledged; then all rows are confirmed.
11. **S11** Reset; owner sets the demo clock to 2026-09-29 23:30, opens Minho's Tue 9/29 shift and marks it absent: Pay → Weekly (week of 9/28) shows Minho without holiday allowance, "absent on 9/29".
12. Every page at 360 px and 1280 px wide in Korean and English: one primary button, no horizontal scrolling, no console errors.

End with "Reset demo data".
