Changed:
- Chat company runs are always-on for this PC. After a slice completes, the scheduler plans the next improvement from the same goal plus company memory.
- Stop All / `/stop` turns always-on off. Pause still pauses. Daily run/cost limits still apply.
- On Windows the API asks the PC not to sleep while an always-on company is running. Display may still sleep. This is not a cloud VM.
- Chat and Agent Grid stay on live events across cycles (heartbeat, cycle_started, cycle_scheduled).

Validated:
- pytest runtime + contracts — 33 passed
- `npx tsc --pretty false --noEmit`
- runtimeEvents node tests — 5 passed

Open:
- API + worker must stay running on this machine. Closing the laptop still stops the company.
