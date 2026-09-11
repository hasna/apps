---
"@hasna/contacts": minor
---

`add_email_to_contact` and `add_phone_to_contact` now use the hosted `/v1` API
instead of failing.

Both MCP tools used to reach store methods that threw
`ApiUnavailableError: 'addEmailToContact' is not available through the
canonical /v1 API` — the local implementation was retired and no hosted one
was ever added, so every call died. They now append the address or number
through the contact route the server already serves,
`PATCH /v1/contacts/:id` with `emails_add` / `phones_add`, which inserts into
`emails` / `phones` duplicate-safely on the server and echoes the contact back.
Each tool returns the newly stored record, as before.

No new endpoint, no local store, no SQLite: the client still refuses to run
without a hosted credential, and a new test drives the real tool handlers over
a stubbed transport to assert the exact method, path and body, and that nothing
is written under the process HOME.
