# Contacts status CLI fixtures

`src/cli/status.test.ts` runs the real CLI and the published
`@hasna/contracts` credential resolver. The test preload replaces only process
and transport boundaries; it never supplies a resolved credential or overwrites
the CLI's configuration.

- Each child has an owned, canonical private temporary HOME, an allowlisted
  environment, empty PATH directory, a 2.5-second deadline and 128 KiB output
  limit. Every temporary HOME is removed after the test.
- The only allowed credential command is the exact Contacts Keychain lookup
  for the fictional station account. It returns item-absent (44). Other
  `child_process` entry points and Bun process/network entry points refuse.
  macOS still exercises the real Darwin resolver branch.
- Fetch accepts only the two expected GET paths, normalized authority, query,
  manual redirect policy and fictional authentication headers. It has no
  ambient network fallback. HTTP 403 replaces the former real `.invalid` DNS
  request, whose normal transport retries could exceed the test deadline.
- JSON and text status retain their disk/environment source assertions. The
  403 body deliberately echoes the fictional key; neither CLI output stream
  nor the metadata-only fixture audit may expose it. Each expected resource
  is requested exactly once per invocation. Successful counts and
  unconfigured startup remain covered, including absence of configuration in
  success-fixture mode.
- On macOS every CLI child also runs under `sandbox-exec`: no network, host
  command execution, outside writes, owner credential/preferences reads or
  outside-process signals. A separate control without the preload proves
  denied host tools/socket creation/outside writes and successful owned writes.
  Do not place the suite inside a second macOS sandbox.

Run from `apps/contacts` with the repository's Bun 1.3.14:

```sh
bun test src/cli/status.test.ts
bun run typecheck
bun run build
```

Validation on macOS arm64 with Bun 1.3.14: six tests, 68 assertions, zero
failures; 444 ms total and 103 ms for the disk JSON/text case in the first
complete passing run. The four existing test deadlines remain unchanged.
Dependencies were reused from a provisioned checkout, without installing or
downloading packages. Linux uses the same explicit process/fetch fixtures;
the macOS-only OS backstop control is skipped there. This change was not
executed on Linux locally.

An attempted aggregate build in the fresh worktree expanded beyond Contacts
because dependency-directory symlinks were untracked, then an unrelated Repos
provenance check refused a dirty tree. The first aggregate check attempt lacked
per-package dependencies. These are incomplete aggregate results, separate from
the focused Contacts validation; generated outputs from those attempts were
restored and no unrelated source was changed.
