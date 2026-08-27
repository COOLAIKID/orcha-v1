# Orcha handoff — live local runtime proof

## Changed

- No product code changed in this verification pass; this records the first
  successful physical execution of the current local runtime.

## Discovered

- The dedicated `orcha-worker` WSL distro is installed and healthy on
  `127.0.0.1:8765` under the unprivileged `orcha` user.
- The live API on `127.0.0.1:8080` created a temporary company and accepted
  `/v1/companies/{id}/runtime/workspace-check`.

## Validated

- The API returned a terminal `task.completed` event with the expected bounded
  company/task/agent metadata.
- `/home/orcha/workspaces/{temporary-company-id}/test.txt` physically existed
  and contained exactly `hello from orcha`.
- Only the temporary verification company/workspace was removed afterward.

## Open

- Model providers remain unconfigured on the local API, so autonomous
  specialist planning is still truthfully blocked until the operator supplies
  server-side provider configuration.
- This local runtime remains PC-bound; CloudSandboxManager is the future hosted
  replacement path.
