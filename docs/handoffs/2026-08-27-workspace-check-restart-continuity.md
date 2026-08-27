# Workspace-check restart continuity — 2026-08-27

## Changed

- `orcha-v1-starter-kit/src/orcha/runtime/local_runtime.py`
  - Added the shared workspace-check title constant.
  - Reuses one durable `queued` runtime check after an API restart instead of
    creating a parallel writer when the phone/tunnel retries the request.
  - Keeps `running` runtime tasks fail-closed; the scheduler cancels those on
    restart because there is no safe continuation point.
- `orcha-v1-starter-kit/tests/test_worker_and_runtime.py`
  - Added coverage proving a queued check is rehydrated, emits no duplicate
    `task.created`, and completes the verified file write.
- `orcha-v1-starter-kit/docs/api/API_CONTRACTS.md`
- `orcha-v1-starter-kit/docs/operations/LOCAL_RUNTIME.md`
  - Documented the retry and restart semantics.

## Discovered

- Cursor’s active consumer chat and Agent Grid remain the correct entrypoint;
  no dormant dev-mode view was reconnected.
- The local runtime is still PC-bound. Hosted cloud execution, multi-user
  identity, and provider credential vaulting remain future work.

## Validated

- Focused workspace tests: 3 passed.
- Full Python suite: 97 passed, 1 warning.
- UI direct tests: 51 passed.
- TypeScript no-emit check passed.
- Vite production build passed.

## Open

- A runtime task that was already running during process loss still requires an
  explicit retry; automatic continuation needs a durable worker lease/checkpoint
  protocol before it is safe.
