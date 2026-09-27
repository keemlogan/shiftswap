# NFR-03 measurement — render time with 20 workers and 12 weeks of shifts

**Requirement (spec §5, NFR-03):** with 20 workers and 12 weeks of shifts, any screen renders in under 1 second on a mid-range laptop.

**Result:** met with a wide margin. The slowest measured screen took 15.4 ms from the route change to the rendered DOM, and 30.9 ms including paint. The limit is 1,000 ms.

## Environment

| Item | Value |
|---|---|
| Machine | Apple M2 (`sysctl -n machdep.cpu.brand_string`), 24 GB RAM, macOS 26.5.2 |
| Browser | Google Chrome 153.0.8010.54, headless (`--headless=new`), viewport 1280×800 |
| App | ShiftSwap v3 (`app/`), served with `python3 -m http.server` from the repository root |
| Date | 2026-09-27 |

## Data set

The data was built in a throwaway browser profile through the application services (`registerWorker`, `saveFixedSchedule`, `saveAvailability`, `generateWeek`, `recordAttendance`, `confirmAttendance`, `generatePayroll`). It starts from the normal seed, which is not modified in the repository.

| Item | Value |
|---|---|
| Workers (role WORKER) | 20: the 4 seed workers + 16 load workers with 2–3 fixed shifts each |
| Generated weeks | 12: Mondays 2026-08-10 … 2026-10-26 |
| Shifts | 588 (49 per week) |
| Confirmed attendance records | 334: every shift that started before the demo clock, 2026-09-28T09:00 |
| Payroll | September 2026 draft for 20 workers |
| Saved database size | about 100 KB |
| Time to build the data set | about 1.4 s (one-off; not part of the requirement) |

## Method

- **Signed-in user:** the owner (the owner's screens do the most work).
- **Screens:** the weekly board, the weekly summary and payroll.
- **Before each run:** the app is first sent to `#/inbox`, so every run is a real route change.
- **t0:** read just before `location.hash` is set to the target route.
- **DOM rendered:** read in a `hashchange` listener registered after the app's router. The router renders synchronously, so at that moment the screen's DOM is complete. The listener also checks that the screen's marker element exists (all runs: yes).
- **Painted:** read after two `requestAnimationFrame` callbacks, i.e. after the browser has laid out and painted the new screen.
- **Runs:** 1 warm-up run, then 10 measured runs per screen. The table shows the median and the maximum.
- **What each route change includes:** the full router path.
  - The System Clock expiry check (`expireOverdue`, a transaction that also saves the database).
  - The header and navigation.
  - The screen itself. The weekly summary also recomputes and stores the week's WeeklySummary rows for all 20 workers (`recomputeWeek`) and saves the database.

## Results

| Screen | Route | Items on screen | Route change → DOM, median | max | Route change → painted, median | max |
|---|---|---|---|---|---|---|
| Weekly board (owner) | `#/schedule/2026-09-28` | 49 shift blocks | 9.2 ms | 9.5 ms | 26.6 ms | 29.5 ms |
| Weekly summary | `#/weekly/2026-09-21` | 20 worker rows | 11.3 ms | 12.6 ms | 27.3 ms | 28.7 ms |
| Payroll (existing draft) | `#/payroll/2026-09` | 20 worker rows + 1 warning row | 10.3 ms | 15.4 ms | 27.3 ms | 30.9 ms |

Additional measurements on the same data set:

| Operation | Measured | Median | Range |
|---|---|---|---|
| "Generate draft" for September 2026: 4 weeks recomputed, 20 payroll rows, database saved | 5 runs | 11.8 ms | 11.6–12.3 ms |
| Cold start: page reload → sql.js initialised → saved database loaded → weekly board rendered | 5 reloads, warm HTTP cache | 19 ms | 16–21 ms |

An earlier run of the same script gave the same picture: route change → DOM at most 16.6 ms, painted at most 36.7 ms. There were no console errors in either run.

## Limits of this measurement

- The machine is an Apple M2, which is faster than many mid-range laptops. Even a 20-fold slowdown would keep every screen under 1 second.
- Chrome ran headless. Paint times in a visible window can be somewhat higher; DOM times are unaffected.
- The cold-start figure uses the HTTP cache, so `sql-wasm.wasm` (about 650 KB) was already local. A first visit over the network also includes the download time.
