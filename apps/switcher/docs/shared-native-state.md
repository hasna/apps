# Shared native state and private authentication

Decision date: 2026-09-18. Status: owner-required product contract; release
acceptance remains separate.

For Codex/ChatGPT and Claude, the default is one native workspace per tool family
and OS user. Sessions, history,
skills, instructions and compatible workspace capabilities remain available
when the user selects another provider, model or subscription account. Account
selection changes authentication and quota ownership; it does not select a
different conversation corpus.

This decision supersedes the opt-in sharing and account-private capability
defaults introduced in PR #2363. Restoring those defaults would violate the
required behavior: switching accounts must still allow resuming the original
conversation with the same skills and instructions. This is an intentional
architecture change requiring review, not a claim that #2363 had this contract.

## State ownership

| State | Ownership |
| --- | --- |
| Native sessions, transcript indexes, history and writer locks | Shared canonical workspace |
| User skills, agents, rules, prompts, commands and memories supported by the native tool | Shared canonical workspace |
| Provider/subscription OAuth tokens, API credentials and Keychain items | Private authentication binding |
| Desktop cookies and authentication-bearing Electron state | Private invocation |
| Provider routing, models and account-bound settings | Selected launch binding |
| Plugin credentials and external-service authentication | Not included by the capability-sharing projection or migrated automatically; existing native ownership remains |

Shared capabilities are executable user configuration. A skill or rule edited
through a shared path changes what later accounts and providers can load. The
native tool's permission checks still apply; sharing does not grant new OS,
provider or external-service permissions. Credential files must never be
included merely because they sit beside a shared capability.
Canonical native configuration can already contain external-service auth. This
decision does not establish per-subscription isolation for every existing MCP or
plugin credential; that remains a separate native integration boundary.

## Provider selection and nested launches

Selecting a provider makes that provider available for the chosen native
workspace. The launcher itself does not submit existing transcripts. When the
user resumes a conversation and submits a turn, the native client can send the
conversation context to the selected provider. Automatic account handoff must
retain the same conversation and satisfy the broker's account and policy checks.

`HASNA_CODEX_STATE_HOME` and `HASNA_CLAUDE_STATE_HOME` identify the selected
workspace. They are location settings, not credentials or a grant of authority.
Nested launches preserve that workspace instead of silently switching corpus
because a different account authenticates the child. Native root, ownership and
configuration checks still apply at each launch.

An operator who needs a separate workspace can select a distinct supported state
root before launching. That root remains shared across the accounts used in
that workspace. There is no implicit workspace derived from a provider name or
credential identifier, and no automatic copying of credentials into shared
state.

## Existing data and acceptance

Changing the default does not authorize discarding old account-specific data.
Unreconciled catalogs, history databases or conflicting settings are preserved
and refused until a supported reconciliation can retain their contents.
Copying a settled test fixture is not proof of safe migration of live profiles.

Release evidence must separately establish shared conversation continuity,
private authentication, native process cleanup, supported installed-client
behavior, package publication and installation. Offline helper acceptance does
not establish GUI, real OAuth or automatic quota-handoff acceptance.
