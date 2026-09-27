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
