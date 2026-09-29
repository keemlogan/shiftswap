# Reproducibility check — run 1 (prompt v3 + spec)

Date: 2026-09-27. Method: a new assistant session with no history and no access to the project was given one file, PROMPT.md = prompts/final-prompt.md (v3) followed by spec/spec.md, in an empty folder, and told to do what it says. Nothing else was provided.

## Result of the rebuilt system against its own tests and the done criteria

- Rebuilt code size: 4540 lines (app code incl. UI and CSS).
- Its own test suite: ℹ tests 54 ℹ pass 54 ℹ fail 0 
- Done criteria 1–4: met (own report + headless Chrome walkthrough with no console errors; "Already taken by Choi Minho"; 16 → 21 h; handover marker; 360 px without horizontal scroll).

## Our test suite run against the rebuilt code

- tests/rules.test.js: ℹ tests 25 ℹ pass 13 ℹ fail 12 
- tests/services.test.js: did not load — `SyntaxError: The requested module '../app/core/db.js' does not provide an export named 'createDatabase'` (the rebuild exports `initDb`).

Failing rule tests (names):

```
✖ TC-014 eligible when active, not requester, free and covered by availability
✖ TC-021 valid request passes
✖ TC-022 only the current worker of a SCHEDULED future shift can request
✖ TC-023 at most one open request, deadline after now and not after shift start
✖ TC-082 no holiday allowance at 14.99 h
✖ TC-084 an ABSENT own shift breaks perfect attendance
✖ TC-086 given-away shift under policy ABSENT breaks attendance
✖ TC-101 minimum wage by year
✖ TC-103 minimum-wage warning uses 90 % only under probation
✖ TC-111 payroll totals: base + holiday + premium, rounded down
✖ TC-112 premium pay at 5 employees and estimated flag
✖ TC-113 fractional amounts are rounded down to the won
✖ failing tests:
```

## Diagnosis

The prompt fixed module and function **names** but not their **signatures and return shapes** (e.g. whether `validateRequest` returns a list of error objects or a boolean, how `computeWeeklySummary` reports the reason for ineligibility, how the database is created in Node). Two correct implementations of the same specification therefore disagree at the API level, and a test suite written against one does not run against the other. Behaviour at the level of the specification (worked example 3.2 h / 33,024 KRW, first acceptance wins, S7) was reproduced.

## Change made (iteration 5, prompt v5)

The test files become part of the input: the prompt now states that `tests/rules.test.js` and `tests/services.test.js` are supplied, must not be modified, and define the API contract; the implementation is done when they pass. See prompt-log.md, Iteration 5.

## Ambiguities reported by the clean session (run 1)

1. Overview example "11 shifts · 60 h" did not match the seed (9 shifts · 50 h); the seed was followed.
2. `listNotifications` treated as a read query, not wrapped in `tx`.
3. Expiry runs in its own transaction before accept/approve/cancel so an error in the action does not roll back expiry.
4. `tx()` made re-entrant (approval calls the weekly recompute service).
5. Weekly summary definitions (scheduled vs actual hours, "given away").
6. Premium rules at month level (night 22–06 additive, weekly overtime after daily).
7. BR-10 window: from contractStart to three months later, exclusive; no probationEnd → no probation. **Folded into spec BR-10 (v5).**
8. Payroll regeneration replaces DRAFT rows only; refused when the whole month is confirmed.
9. Own choices: registerWorker also updates; acceptor overlap re-checked at accept and approve (**folded into spec BR-02, v5**); shifts with open requests or attendance cannot be edited; direct owner reassignment shows no handover marker; generateWeek duplicate rule.
10. Notification text rendered from kind + linked data so it follows the UI language.
11. Extra tests TC-03x, TC-016/017 added.
12. Extra read queries and date helpers.
13. Owner mobile tab bar: four items + "Menu".
14. Fonts load from CDNs; offline falls back to system fonts.

Items 1–6 and 8–14 are consistent with the reference implementation or are presentation choices; with the acceptance tests supplied in v5, the API-level choices (2, 4, 9) are fixed by the tests.

---

# Reproducibility check — run 2 (prompt v5 + spec + supplied tests)

Date: 2026-09-27. Method: a new assistant session with no history, working only inside an empty folder, received PROMPT.md (prompts/final-prompt.md v5 followed by spec/spec.md) and the two supplied test files tests/rules.test.js and tests/services.test.js (77 tests). It was told to do what the prompt says and to report the checksums of the supplied test files at the start and at the end.

## Result

- `npm test`: 85 tests, 85 pass, 0 fail — the 77 supplied tests plus 8 tests the session added in tests/extra.test.js. The supplied tests passed on the first run of the core modules.
- Supplied test files unchanged (shasum at start = at end): rules.test.js 93d3c5c8168255b20a2d0013f513fb1d899d2204, services.test.js b6846b7233733db054bbb71883bf863c01c544f5. The team independently re-ran the 77 supplied tests in the rebuilt folder: 77/77 pass, same checksums.
- Done criteria: 1 PASS, 2 PASS (seed and S7), 3 PASS (sign-in, 0 console errors), 4 PASS (tour walkthrough at 360 and 1280 px), 5 PASS (exactly one primary button per screen, visible reasons on disabled buttons, targets ≥ 44 px, no horizontal scroll at 360 px).

## Comparison with run 1

| | Run 1 (v3) | Run 2 (v5) |
|---|---|---|
| Rebuild's own tests | 54/54 | 85/85 |
| Team's rules tests against the rebuild | 13/25 | all pass |
| Team's services tests against the rebuild | did not load (API mismatch) | all pass |

Supplying the acceptance tests as part of the input removed the API-level divergence found in run 1.

## Ambiguities reported in run 2 (19) — main ones

1. No UI module named for the Home screens (added home.js). 2. Spec kept English names while the prompt's examples used Korean names — the prompt was afterwards clarified with a Korean display-name map (added after run 2 had started). 3. Primary-button placement on Home vs the sticky bottom bar. 4. "Reset demo data" both in the header menu and in Demo tools. 5. Late accept/approve saves EXPIRED and then fails with REQUEST_CLOSED (required by the tests). 6. Expiry closes only PENDING targets. The remaining points (storage keys, month-end probation date, payroll row set, settings save semantics) are consistent with the reference build.

Limits: one run; the user interface is compared through the done criteria, not pixel by pixel.

---

# Reproducibility check — run 3 (prompt v6 + spec + supplied tests)

Date: 2026-09-27. Same method as run 2, with the final prompt v6 (iteration 6: availability removed, "can't" answer, FAILED ending) and the 84 supplied tests.

## Result

- `npm test`: 89 tests, 89 pass, 0 fail — the 84 supplied tests plus 5 added by the session. The supplied files alone passed 84/84 on the first run. The team re-ran them in the rebuilt folder: 84/84.
- Supplied test files unchanged (shasum at start = at end): rules.test.js 83182afc4cc26a0fea6b127fbb379b63b01f6668, services.test.js 1032e7d08436da7010f94b88e1ea1fa61d3c7fb6.
- Done criteria 1–6 all PASS: seed and S7 (2); sign-in "달빛카페 데모" without console errors (3); tour walkthrough incl. "16시간 → 21시간", one-tap accept, "최민호님이 먼저 수락했어요", decision card "(33,024원 유지)", handover marker (4); S8 in the browser — three recipients, three 불가 answers, Hana's FAILED card, the owner's "대타를 못 구했어요" card whose only action 확인했어요 removes it (5); one filled primary per screen, reasons on disabled buttons, targets ≥ 44 px, no horizontal scroll at 360 px (6).

## Ambiguities reported in run 3 — main ones

1. Spec §10 still said the Korean UI shows English names while prompt §2.0.7 required a Korean display map — the session followed the prompt; the spec sentence had been corrected after the run had started.
2. "Exactly one primary per screen" vs Home cards that each carry an action — the first enabled card action stays primary, the rest are drawn grey.
3. The file layout listed no Home module — the session placed Home in existing modules; the module list in prompt §1 (home.js, me.js, components.js, slots.js) was added after the run had started.
4. Saving settings replaces the minimum-wage table; generating payroll for a confirmed month returns the confirmed rows; attendance can be recorded once the shift has started.


---

# Reproducibility check — run 4 (prompt v7 + spec + supplied tests)

Date: 2026-09-27. Same method, with the final prompt v7 (iteration 7: work and payroll history from the contracts, automatic monthly payroll draft) and the 89 supplied tests.

## Result

- `npm test`: 94 tests, 94 pass, 0 fail — the 89 supplied tests plus 5 added by the session; the core modules passed all 89 supplied tests on their first run. The team re-ran the supplied tests in the rebuilt folder: 89/89.
- Supplied test files unchanged (shasum at start = at end): rules.test.js 83182afc4cc26a0fea6b127fbb379b63b01f6668, services.test.js 72f08f2d5c9f17c031a0ad0d1b0891a6dedd2482.
- Done criteria 1–7 all PASS. The session's own headless check (68 screen states at 360 and 1280 px, 249 assertions, 0 failures, no console errors) covered the tour (4), S8 (5), S9 (6: March–August confirmed; at 2026-10-01 the Home card "9월 급여 초안이 준비됐어요" and the automatic September draft with Doyun's warning; no second draft at 10-03 and 10-20) and the one-primary audit (7).
- The rebuild reproduced the same UI module layout as the reference (home.js, me.js, components.js, slots.js …).

## Ambiguities reported in run 4 (21) — main ones

1. The prompt's export lists omit several functions the tests require (hasNoTaker, prepareMonthlyPayroll, listPayrollMonths, routesFor, previewCandidates, …) — built as the tests call them (prompt §0 rule).
2. One filled primary per screen vs. an action on every Home card — the first stays primary, later ones grey; screens without a natural action get a navigation primary.
3. Seeded weekly summaries stated "up to the week of 09-14" although 09-21 is also worked — seeded through 09-14, later weeks recomputed on demand.
4. BR-12 expiry inside the accept/approve transaction vs. tests that need EXPIRED saved — expiry committed first, then REQUEST_CLOSED.
5. Unspecified choices: payroll rows only for workers with shifts or holiday pay in the month; "prepared automatically" derived from the notification; reason chips stored in English and shown in Korean; Pay opens on the weekly segment.

# Reproducibility check — run 5 (prompt v8 + spec + supplied tests + server files)

Date: 2026-09-29. Same method, with the final prompt v8 (iteration 8: shared database as the default data mode, local demonstration mode, part-time overtime rule BR-08 (iv) with the approval warning BR-15/FR-24). The empty folder received the prompt followed by the specification (`PROMPT.md`), the three supplied test files (113 tests) and the two supplied server files `db/app-shared.sql` and `tools/seed-sql.mjs`. The session had no database connection and was told not to run the SQL.

## Result

- `npm test`: 113 tests, 113 pass, 0 fail — the supplied tests only (the session added none). The team re-ran them in the rebuilt folder: 113/113.
- Supplied files unchanged (shasum at start = at end): rules.test.js f8e84742b5b68e32cb8a8600afd727f33277a717, services.test.js 0249358faee378ab9372c432b91db1af52e2887e, shared.test.js 49ca71a6d05e15e18917912ee509ff26669c824d, app-shared.sql 3c86cdbdd92bbc5387f87be4309b90277c48e63a, seed-sql.mjs 266da489ca92dad34721b561307cf18e1650a1ff.
- The run was interrupted once: the first session built the core modules, the UI modules and passed 113/113, but stopped before it had written `app/index.html` and `app/styles.css`. A second session with the same restrictions (only the folder, no view of the repository) read the prompt, wrote the two missing files from prompt §3, and checked the done criteria. The rebuild has 4,319 lines under `app/` without the vendored sql.js (core 1,853; UI 1,720).
- Done criteria 1–7 PASS in the local demonstration mode. The session's own headless check (Node static server, Chrome DevTools protocol, storage cleared per scenario) passed 25 of 25 checks, including 50 screen audits at 360 and 1280 px: sign-in without console errors (3); the tour with "16시간 → 21시간", one-tap accept, "최민호님이 먼저 수락했어요", the decision card "(33,024원 유지)" and the handover marker (4); S8 with three 불가 answers and the owner's acknowledge-only card (5); S9 with March–August confirmed and the automatic September draft at 2026-10-01, no second draft at 10-02 and 10-20 (6); one filled primary per screen, reasons on disabled buttons, targets ≥ 44 px, no horizontal scroll (7). The check first found three small defects of the rebuild (arrows and weekday chips disabled without a reason, a missing favicon), which the session fixed.
- Done criterion 8 (two browsers on a throwaway store) needs the owner's database connection and was not run by the session. The team ran it afterwards at the data level: two separate Node processes, each loading the rebuilt `app/core/shared.js` gateway and `services.js` with the real REST transport and the publishable key on a throwaway store `e2e-r5-…`, accepted request 1 at the same moment; the server held one ACCEPTED request with exactly one ACCEPTED target, one process succeeded and the other received ALREADY_TAKEN after its stale change set was re-run on the current data (two runs, both PASS; the stores were deleted). The rebuilt screens were not driven in two browsers, because the team's two-browser script depends on the reference app's element names.
- Later changes, not covered by run 5: run 5 used the files of commit f9100cf. The independent review after iteration 8 (commit 5d3c3a0; prompt log, "Independent review after iteration 8") then added a 15-second request timeout to the shared-mode transport, length limits for worker names, phone numbers and the store name, a key range check and a DRAFT-only rule for new payroll rows in `db/app-shared.sql`. These fixes added assertions to two existing tests (TC-01D and TC-16B; still 113 tests), so the current `tests/services.test.js`, `tests/shared.test.js` and `db/app-shared.sql` no longer match the shasums above. The prompt and the specification were not changed, and run 5 was not repeated after the review.

## Ambiguities reported in run 5 (17) — main ones

1. Conflict in the supplied material: prompt §1 says the publishable key is given in the header comment of `db/app-shared.sql`, but the header did not contain it, so the rebuild started in the local demonstration mode only. The team added the URL, the key and the demo store to the header comment (a comment only; the SQL is unchanged; prompt log, iteration 8, item 7). For the criterion-8 check the team supplied the key to the rebuilt gateway directly.
2. One filled primary per screen vs. an action on every Home card — as in runs 3 and 4, the first card action stays primary.
3. "Someone was faster" as a toast after a late tap (§2.3) vs. a card without a tap (criterion 4) — the TARGET_CLOSED notification is shown as a card with 확인했어요.
4. The payroll draft month and the "prepared automatically" note have no column — both derived from the PAYROLL_DRAFT_READY notification (as in run 4).
5. Unspecified choices: notification text stored in English and rendered from its kind; one fixed-schedule row per weekday in 30-minute steps; the System Clock duties also run after every command; the expiry inside accept/approve committed before REQUEST_CLOSED (as in run 4).


---

## Summary of the five runs

| Run | Prompt | Input | Team's acceptance tests against the rebuild | Done criteria |
|---|---|---|---|---|
| 1 | v3 | prompt + spec | rules 13/25, services did not load | 1–4 met |
| 2 | v5 | prompt + spec + tests | 77/77 | 1–5 met |
| 3 | v6 | prompt + spec + tests | 84/84 | 1–6 met |
| 4 | v7 | prompt + spec + tests | 89/89 | 1–7 met |
| 5 | v8 | prompt + spec + tests + server files | 113/113 | 1–7 met; 8 at the data level by the team |
