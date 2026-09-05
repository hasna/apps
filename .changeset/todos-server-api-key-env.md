---
"@hasna/todos": patch
---

`todos serve` / `todos-serve` now read their accepted key from the server's own
variable, `HASNA_TODOS_SERVER_API_KEY`, instead of the client credential names
(`HASNA_TODOS_API_KEY` / `TODOS_API_KEY`). One name no longer plays both roles
on opposite sides of the same trust boundary: exporting the fleet client key on
a workstation can no longer silently become the local server's accepted key,
and rotating the client key no longer changes what the local server accepts.

The client names remain a documented silent fallback for one release, so an env
written before 2026-09-05 keeps working. `todos serve` prints one line at
startup naming which variable supplied its accepted key, flagging the
deprecated spelling when a fallback name was used.
