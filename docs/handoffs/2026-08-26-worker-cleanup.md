# Orcha handoff — worker cleanup bookkeeping

## Changed

- `orcha-v1-starter-kit/src/orcha/worker/app.py` now removes stopped preview
  processes and stale child entries during company or global Stop All.
- Stop counts now represent currently running children only, and preview
  bookkeeping is cleaned without relying on a worker thread's `finally` block.
- Added a regression covering global preview teardown and repeated Stop All.
- `orcha-v1-starter-kit/src/orcha/api/app.py` now preserves an owner Stop All
  that wins while a provider-backed plan is still being prepared; planned tasks
  are persisted as cancelled and the run cannot resurrect the company.
- Added an API regression for the planning/stop race.

## Discovered

- The worker remains localhost-only and keeps previews inside the company
  workspace boundary; this is a lifecycle correction, not a new execution
  capability.

## Validated

- Full backend suite: 85 passed, 1 existing httpx/Starlette deprecation warning.
- The new preview cleanup regression passed with the worker tests.
- Previously validated frontend: 30 passed; TypeScript and production build
  passed.
- Live WSL/API verification passed: the installed `orcha-worker` was healthy,
  `/workspace-check` emitted a durable `task.completed` event, and the physical
  file contained exactly `hello from orcha`. The temporary verification
  workspace was then removed.

## Open

- The WSL bridge prints host-PATH translation warnings when invoked directly;
  the managed bridge captures them and the runtime result remains correct.
