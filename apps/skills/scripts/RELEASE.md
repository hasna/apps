# Skills producer checks

Build release archives with the package's standalone `bun.lock`. Install the exact
`package.json` and lock in a separate directory with
`bun install --frozen-lockfile --ignore-scripts`, using a clean HOME and cache.
Use that complete `node_modules` graph for the package in its isolated versioned
worktree; retain the repository metadata used by the existing consumer type
check. Do not substitute or mix older workspace dependency folders.

Run `bun run verify:producer` before building and before packing a release.
`prepublishOnly` also enforces this gate before an actual npm publication.
Ordinary `npm pack` retains the workspace build/release/consumer checks; it does
not establish standalone producer attestation by itself.
It checks declared root dependencies, actual resolved package versions and
recursive dependency edges against the selected lock, including optional-peer
absence. Every resolved package must remain inside the selected `node_modules`
graph. An intentional `zod/v3` import from the locked Zod4 package and a separately
locked nested Zod3 dependency are valid.

The result binds package/lock hashes and resolved package manifest hashes. It is
not a package payload integrity attestation: retain the clean frozen-install
receipt, build evidence and installed-archive acceptance separately. Recheck the
graph before packing and verify the actual published archive after publication.

After installing the selected archive in an isolated consumer directory, run
`bun scripts/checkout-consumer.ts /absolute/consumer/directory`. It imports the
installed SDK and verifies explicit 503/409 recovery and connection-loss recovery
with exactly one checkout POST per call. It intercepts every HTTP request with
synthetic responses and performs no provider operation. This does not replace
the standalone producer graph or live server acceptance checks.
