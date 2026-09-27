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

## Summary of the three runs

| Run | Prompt | Input | Team's acceptance tests against the rebuild | Done criteria |
|---|---|---|---|---|
| 1 | v3 | prompt + spec | rules 13/25, services did not load | 1–4 met |
| 2 | v5 | prompt + spec + tests | 77/77 | 1–5 met |
| 3 | v6 | prompt + spec + tests | 84/84 | 1–6 met |
