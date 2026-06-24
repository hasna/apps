# Non-Destructive Machine Validation Plan

This plan is the only approved P8 sampler shape until the live lab gate reports
`lab_ready=true` and `live_smoke_ready=true`.

## Preconditions

- Use a selected machine only by redacted alias in evidence.
- Require the live gate to pass route, Screen Sharing or resident GUI access,
  remote desktop capabilities, remote screenshot hash and dimensions, visible
  browser, and browser extension binding to the selected machine.
- Acquire the relevant runtime leases before live control: `fleet_machine`,
  `computer_display`, `browser_extension_session`, and `terminal_session` when
  Ghostty is opened.
- Use only generated fixture pages served from the live loopback browser fixture
  origin (`/occtrl-fixture/`) or generated files under `/tmp/occtrl-fixtures/`.
  Do not use production services, arbitrary localhost services, arbitrary local
  files, or real external websites.

## Allowed Actions

- Capture screen size and a screenshot hash with dimensions.
- Open a local browser fixture page in an existing visible browser profile.
- Scroll the local fixture page and capture before/after screenshot hashes.
- Query browser extension status and browser snapshot metadata for the fixture.
- Open one empty Ghostty window only when the app driver reports available and no
  command, path, clipboard, credential, payment, or secret fields are present.
- Close the fixture tab/window and the empty Ghostty window during cleanup.

## Denied Actions

- Do not enter, request, reveal, or store credentials, passwords, tokens, cookies,
  keychain data, payment data, or account recovery data.
- Do not visit real external sites, payment pages, inboxes, admin consoles, or
  social accounts.
- Do not run destructive shell commands, package installers, download-and-run
  commands, privileged commands, broad file deletion, disk operations, or network
  scanners.
- Do not dump the clipboard or read arbitrary local files.
- Do not continue if a login, payment, permission, or unknown-system prompt
  appears.

## Evidence

The sampler result must use `open-computer.safe-action-sampler.v1` and include:

- `fixture_only=true`, `external_sites=false`, `secrets_touched=false`, and
  `destructive_actions=false`.
- A non-empty `actions` list and non-empty `cleanup_actions` list.
- Only approved action types and fields. Unknown fields are denied, especially
  command-like, credential-like, payment-like, clipboard-like, and arbitrary path
  fields.
- Screenshot hashes or redacted screenshot artifact references.
- Lease proof for `computer_display` and `browser_extension_session`, and
  `terminal_session` when Ghostty is opened. Each lease entry must show acquired
  and released state.
- `cleanup_completed=true`.
- `leftovers.tabs=0`, `leftovers.files=0`, and `leftovers.processes=0`.

P8 remains incomplete until the live gate also ingests passing visual review and
installed-package machine smoke evidence.
