---
"@hasna/hooks": minor
---

Every command works in ANY transport — hosted registry API or the local store — by removing the last transport-conditional command blocks (owner directive 2026-08-15: the storage-mode axis is retired).

The CLI transport gate is gone. Previously, a run without a resolved registry credential (or the `HASNA_HOOKS_LOCAL=1` opt-in) failed closed for every command outside a hardcoded API-independent whitelist; `hooks list`, `hooks log`, `hooks storage status`, `hooks doctor` and the rest refused to run in an unconfigured environment. There is no gate and no whitelist anymore: commands resolve the registry at call time, and when no authority resolves they use the bundled registry + on-box SQLite store — the baseline, not a gated fallback. `HASNA_HOOKS_LOCAL=1` (alias `HOOKS_LOCAL=1`) is still accepted as an explicit local selection and short-circuits the credential chain (hermetic promise); a one-line stderr notice says where the store lives. The only refusals left are credential validation for DECLARED intent: an env URL without a key (or another named tier that cannot be honoured) is still a strict-pair refusal — a named tier never falls through to a different dataset.

Pinned requests (`hooks install <name>@<version>` / `hooks update <name>@<version>`) are no longer refused on the local transport: they resolve the exact version from the bundled registry when no remote authority resolves, with a data error naming the available version when the version is not bundled — the same shape as a remote pin miss.

What this removes (breaking, hence minor):

- The CLI fail-closed gate (`enforceTransportGate`, `API_INDEPENDENT_COMMANDS`, `failClosedForMissingApiEnv`) and all "local mode is opt-in only / failing closed" messaging.
- `HooksTransportMode` and `HooksTransportResolution.mode` — renamed to `HooksTransportKind` and `resolution.kind` so no mode vocabulary survives the retired axis.
- The once-per-process "LOCAL mode" stderr announcement (replaced by a transport-neutral notice naming the store location).

What this adds:

- `installPinnedFromBundled(name, version)` on the package root: pins an exact bundled-registry version (lock + DB record) for local-transport pinned installs.
- Baseline-local resolution: `resolveHooksTransport` returns `{ kind: "local", source: "local", authority: null }` when nothing resolves and the environment declared no authority — local is the default transport, never a refusal.
- Hermetic tests for the removed guards: no-transport-gating CLI suite, bundled pinned install/update, baseline-local transport resolution, strict-pair refusals for declared-but-unresolvable authorities.