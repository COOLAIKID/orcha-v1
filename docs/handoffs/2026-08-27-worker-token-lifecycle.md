# Worker token lifecycle — 2026-08-27

## Changed

- `orcha-v1-starter-kit/scripts/setup-orcha-worker.ps1`
  - Configures the systemd service to read a root-owned private worker env
    file.
- `orcha-v1-starter-kit/scripts/start-orcha-worker.ps1`
  - Reads only `ORCHA_WORKER_AUTH_TOKEN` from the private environment file.
  - Writes the token inside the dedicated distro through a child environment,
    never a visible `wsl.exe` argument, then restarts the service.
- `orcha-v1-starter-kit/scripts/start-orcha-local.ps1`
- `orcha-v1-starter-kit/scripts/watch-orcha-local.ps1`
- `orcha-v1-starter-kit/scripts/stop-orcha-local.ps1`
  - Pass the same private environment file through the local lifecycle.
- `orcha-v1-starter-kit/scripts/stop-orcha-worker.ps1`
  - Forwards the token in the worker request header before terminating the
    distro, with host environment restoration in `finally`.
- `orcha-v1-starter-kit/tests/test_script_contracts.py`
  - Added regression checks for env-file propagation and argument redaction.
- `orcha-v1-starter-kit/docs/operations/LOCAL_RUNTIME.md`
- `orcha-v1-starter-kit/docs/security/SECURITY_BOUNDARIES.md`
  - Documented the private token lifecycle.

## Discovered

- The active consumer chat and Agent Grid remain unchanged and continue to use
  the provider-neutral runtime boundary.
- Worker request authentication was already implemented in the service, but
  the Windows lifecycle wrappers were not previously configuring both ends.

## Validated

- PowerShell parser: 6 touched scripts, zero errors.
- Full Python suite: 100 passed, 1 warning.
- UI direct tests: 51 passed.
- TypeScript no-emit check passed.
- Vite production build passed.
- API runtime health returned `ready` with scheduler `ready` and no provider
  credentials configured.

## Open

- Hosted worker identity, mutual TLS/workload identity, and managed cloud
  storage/queue remain future production controls beyond the local pilot.
