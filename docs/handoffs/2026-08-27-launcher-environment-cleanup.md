# Handoff — Launcher environment cleanup

Changed: Hardened `orcha-v1-starter-kit/scripts/start-orcha-api.ps1` so
private provider values are inherited by the child API only, then restored in
the caller on success or failure. Hardened the worker and combined local
wrappers so their temporary Windows `PATH` isolation also restores on every
exit path. Documented the boundary in `docs/operations/LOCAL_RUNTIME.md`.

Discovered: Cursor’s repeatable pilot launcher and login-time supervisor are
now the shared operational path. The API wrapper still needs process
environment inheritance for Windows PowerShell compatibility, so cleanup is
implemented explicitly rather than moving secrets into command-line
arguments.

Validated: All three modified PowerShell scripts parse with zero parser errors.
A failure-path run using the safe `orcha.local.env.example` and an occupied UI
port restored both `ORCHA_AGENT_PROVIDER` and `PYTHONPATH` to an absent state.
The live API remained healthy after the check.

Open: The current local runtime still requires the PC/API host to remain
available; a hosted supervisor and secret store remain future work.

Preview: `http://127.0.0.1:5175/`
