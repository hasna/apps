# @hasna/hooks — Versioning Model

> **Status: implementation in progress — lane L1 (PR pending). These docs describe the target state.**

This document describes how hook versions are pinned, trusted, upgraded,
rolled back, and kept consistent across machines.

## 1. Versions are semver

Every hook version is a strict semver `MAJOR.MINOR.PATCH` (`1.4.0`). The
semantics follow the usual contract:

- **MAJOR** — breaking change (different events, different output contract,
  removed behaviour).
- **MINOR** — backward-compatible feature.
- **PATCH** — backward-compatible fix.

A manifest with an invalid or missing version is rejected at install and
publish time.

## 2. The lockfile (`hooks.lock`)

`hooks.lock` pins every installed hook to an exact version **and** an exact
digest. Format:

```json
{
  "version": 1,
  "hooks": [
    { "name": "pre-bash", "version": "1.4.0", "sha256": "9f2c…" },
    { "name": "ci-guard", "version": "1.0.0", "sha256": "3ab7…" },
    { "name": "stop-sync", "version": "0.9.1", "sha256": "e51d…" }
  ]
}
```

Rules:

- **`version`** at the top is the lockfile format version (currently `1`),
  not a hook version.
- **`sha256`** is the bundle digest recorded at install time. It is the
  trust anchor — see §3.
- The lockfile is the source of truth for *what is installed and what must
  run*. The `hooks` table mirrors it; the lockfile is what is synced,
  reverted, and replayed.

The lockfile lives at `~/.hasna/hooks/lock/hooks.lock` locally, and is
mirrored server-side via `GET|PUT /api/v1/lock` when a remote backend is
configured.

## 3. The trust model

Trust is bound to a digest, never to a name or a version string.

- **Install** trusts the digest you received, implicitly and deliberately:
  the act of installing records the pin. The hook runs from that digest until
  the pin changes.
- **Update** to a new digest is never silent. The new digest is reported and
  the hook is not considered trusted until you approve it:

  ```bash
  hooks trust <name>
  ```

  This mirrors Codewith's `trusted_hash` model: the runtime stores the
  trusted hash for a hook name, and any artifact whose hash differs refuses
  to run.
- **Verification at every boundary.** Install, `hooks sync`, and `hooks run`
  all re-check the artifact against the pinned digest. A mismatch refuses
  execution and reports both digests (expected vs actual).
- A mismatch you did not initiate is an incident, not a routine approval.
  Re-trusting without understanding the mismatch gives the new digest the
  authority of the old one.

## 4. Upgrade flow

```bash
hooks update <name>          # resolve and apply the next semver-compatible version
hooks update --all           # update every hook
hooks trust <name>           # approve the new digest if the update introduced one
```

Step by step:

1. `hooks update <name>` resolves the newest version allowed by the current
   pin's semver range (default: latest compatible; `--major` opts into
   MAJOR bumps).
2. The artifact is fetched and its digest computed.
3. If the digest differs from the pinned one, the update **stages** the new
   version but does not run it: the lockfile entry is not rewritten until
   `hooks trust <name>` records the new digest.
4. `hooks trust <name>` rewrites the pin to `name@newversion#newsha256`.
5. Until step 4 happens, the old pinned version keeps running — the update is
   visible in the catalog but the working set is unchanged.

`hooks update` output always names the before and after pins:

```
pre-bash: 1.4.0#9f2c… -> 1.5.0#77aa…  (digest changed — run: hooks trust pre-bash)
stop-sync: 0.9.1#e51d… -> 0.9.1#e51d… (unchanged)
```

## 5. Rollback

A rollback is a lockfile operation, not a delete:

1. Revert `hooks.lock` to the previous known-good state (keep a dated copy of
   the lockfile before every upgrade — the rollback input is the file you
   saved, not memory).
2. Reinstall the pinned versions:

   ```bash
   hooks install <name>@<previous-version>   # or: hooks sync after restoring the lockfile
   ```

3. Verify: `hooks run <name> --event <EVENT>` (see `docs/custom-hooks.md` §5)
   and `hooks list` must show the previous pins restored.

Because installs are digest-verified against the lockfile, a restored
lockfile reinstalls exactly the bytes that previously ran — the artifact is
immutable (`hook_artifacts/<name>/<version>.json` server-side, versioned
directories locally), so rollback does not re-trust anything.

## 6. Multi-machine consistency

`hooks sync` is the reconciliation mechanism (see `docs/architecture.md` §8):

1. Pull the catalog and the server-side lock state (when a remote backend is
   configured).
2. Compute the diff against the local lockfile and the local `hooks` table.
3. Verify every artifact's sha256 before installing anything.
4. Apply the diff; report the plan with `--dry-run` first.

Consistency properties:

- **Pins win.** If the remote lock pins `pre-bash@1.4.0` and a machine has
  `1.5.0`, sync downgrades the pin back — but only after verifying the
  `1.4.0` artifact digest. The lockfile, not "whatever is installed", defines
  the target state.
- **Fail-closed offline.** If the API is unreachable, sync changes nothing
  and exits non-zero. A machine never half-reconciles against a stale view.
- **Local-only hooks survive.** A hook present locally but absent from the
  remote catalog or lock is never deleted by a sync. If you want it gone,
  remove it explicitly (`hooks remove <name>`).
- **Trust is per-machine.** `hooks trust` records a digest on the machine
  where you ran it. A freshly provisioned machine that syncs an untrusted
  digest must approve it once, on that machine, before the hook runs. This is
  deliberate: trust is a local decision about what runs locally.

## 7. Interaction with event history

Version changes never rewrite `hook_events` rows. Event history records the
`hook_name` and timestamps; the lockfile records which digest was current at
any moment. To attribute a historical event to a version, resolve the
lockfile state from the event's timestamp.
