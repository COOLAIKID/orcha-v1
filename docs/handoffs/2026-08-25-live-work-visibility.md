Changed:
- Latest chat company owns this PC’s two workers. Starting or resuming a run pauses other always-on companies; runnable tasks are only the newest running company.
- Chat live object stays glowing while a specialist is actually working (not only on heartbeat). Real QA check rows render under test lines. Onboard field PNG encodes on idle, same as the landing cube.
- Demo stays labeled Demo. No invented files, checks, or metrics.

Discovered:
- Leftover StudyFlow queues were filling the 20-task dispatch window, so a new sentence could wait behind old always-on work.
- API and WSL worker can be ready while specialists still block without `orcha.local.env`.

Validated:
- pytest newest-company dispatch + latest-run pause (plus existing runtime tests)
- node workLog / runtimeEvents / agentGrid tests
- `npx tsc --pretty false --noEmit`
- Preview `http://127.0.0.1:5175/`

Open:
- Server provider key still required for files, +/−, checks, and preview iframe.
- Browser click-through of chat + Agent Grid still pending in this pass.

Preview: http://127.0.0.1:5175/
