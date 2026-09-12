---
"@hasna/mementos": minor
---

`checkPermission` now denies by default.

The ACL check answered `true` whenever the agent had no rules at all
("no ACLs = full access, backward compat"), and propagated a store failure as
an exception a caller could catch into a grant. A permissive default on an
authorization primitive conflates two states with opposite correct answers:
"this agent is deliberately unrestricted" and "this agent's rules are missing,
not written yet, or not readable from here".

- No rules for the agent now returns `false` unless the caller explicitly opts
  in with `checkPermission(..., { allowWhenUnconfigured: true })`, so the
  permissive reading has to be chosen in code review rather than inherited.
- A rule set that cannot be read (no store configured, transport failure, store
  error) returns `false` outright. An unreadable ACL table is not a grant, and
  the opt-in does not override it — an unreadable table does not prove the
  agent is unconfigured.
- Deleting an agent's last rule therefore no longer hands that agent access to
  everything.

No caller changes: nothing in the CLI, the MCP server or `mementos-serve`
invokes `checkPermission` today, so this sets the default correctly before the
check is wired to a read or write path.
