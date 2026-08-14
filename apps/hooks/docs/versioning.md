# @hasna/hooks — Versioning Model

> **Status: implemented.** This document describes the versioning, lock, and
> trust model as merged on main (src/lib/store.ts, src/config.ts).

This document describes how hook versions are pinned, trusted, updated, and
kept consistent across machines.

## 1. Versions are semver

Every hook version is a strict semver `MAJOR.MINOR.PATCH` (`0.1.0`). The
semantics follow the usual contract:

- **MAJOR** — breaking change (different events, different output contract,
  removed behaviour).
- **MINOR** — backward-compatible feature.
- **PATCH** — backward-compatible fix.

A manifest with an invalid or missing version is rejected at install time
(the manifest schema requires `^\d+\.\d+\.\d+`).

## 2. The lockfile (`hooks.lock`)

`hooks.lock` pins every installed hook to an exact version **and** an exact
digest. Format — a `hooks` map keyed by name, each entry carrying `version`,
`sha256`, and `source`:

```json
{
  "hooks": {
    "pre-bash": { "version": "0.1.0", "sha256": "9f2c…", "source": "bundled" },
    "ci-guard": { "version": "1.0.0", "sha256": "3ab7…", "source": "custom" },
    "stop-sync": { "version": "0.1.0", "sha256": "e51d…", "source": "bundled" }
  }
}
```

Rules:

- **`sha256`** is the script digest recorded when the pin was written. It is
  the trust anchor — see §3.
- **`source`** records where the hook came from (`bundled`, `custom`,
  `remote`).
- The lockfile is the source of truth for *what is installed and what must
  run*. The `hooks` table mirrors it.

The lockfile lives at `~/.hasna/hooks/hooks.lock` by default (overridable
via `HASNA_HOOKS_LOCK_PATH` / `HOOKS_LOCK_PATH`), and is mirrored
server-side via `GET /api/v1/lock` when a remote registry is configured —
the server derives it from the store; there is no write path for it.

## 3. The trust model

Trust is bound to a digest, never to a name or a version string.

- **First run pins.** The first time a hook runs, `checkScriptHash` records
  the current script sha256 in the `hooks` table and in `hooks.lock` and
  lets the hook run — the digest you received is the digest that runs, pinned
  from that moment. `hooks sync`, `hooks update`, and `hooks trust` also
  write pins explicitly.
- **Verification at run time.** Every `hooks run` re-checks the script bytes
  against the pinned digest — the verified bytes are the executed bytes
  (TOCTOU-safe: the path is never re-opened after the trust check). A
  mismatch refuses execution and reports both digests (expected vs actual).
- **Accepting a new digest is explicit:**

  ```bash
  hooks trust <name>
  ```

  This re-pins the sha256 of the script currently on disk. It mirrors
  Codewith's `trusted_hash` model: the runtime stores the trusted hash for a
  hook name, and any artifact whose hash differs refuses to run.
- A mismatch you did not initiate is an incident, not a routine approval.
  Re-trusting without understanding the mismatch gives the new digest the
  authority of the old one.

## 4. Upgrade flow

```bash
hooks update [name...]     # defaults to all installed hooks
```

`hooks update` is a **re-registration**, not a version resolver:

1. Re-registers each installed hook (picking up a new `@hasna/hooks` package
   version — this is how bundled hook updates land).
2. Refreshes the lock pins: the current script's sha256 is pinned for each
   updated hook.

There is no `--major` option, no semver-range resolution, and no `--all`
flag: `hooks update` with no arguments updates every installed hook, and the
new pin applies immediately (no staging, no separate approval step — `hooks
trust` remains for the case where content changed without an update).

`hooks update` output always names the result per hook:

```
✓ pre-bash updated (pinned 0.1.0)
```

## 5. Rollback

A rollback is a lockfile-plus-files restore, not a delete:

1. Keep a dated copy of `hooks.lock` (and, for custom hooks, the hook files)
   before every upgrade — the rollback input is the file you saved, not
   memory.
2. Restore the previous `hooks.lock` and the previous hook files.
3. Verify: `hooks list` shows the previous pins, and the restored files
   match the restored pin (the run-time trust check enforces it).

Because the trust check verifies the restored bytes against the restored
pin, a restored state runs exactly the bytes that previously ran — rollback
does not re-trust anything. With a remote registry, restoring the server-side
lock state (what `GET /api/v1/lock` serves) and running `hooks sync`
converges machines to that pinned state; local-only hooks are never touched.

## 6. Multi-machine consistency

`hooks sync` is the reconciliation mechanism (see `docs/architecture.md` §8):

1. Pull the catalog and the server-side lock state (when a remote registry
   is configured; otherwise pin the bundled catalog).
2. Compute the diff against the local lockfile and the local `hooks` table.
3. Verify every artifact's sha256 against the lock before installing
   anything.
4. Apply the diff; report the plan with `--dry-run` first.

Consistency properties:

- **Remote pins win.** If the remote lock pins `pre-bash@0.1.0` and a machine
  has `0.2.0`, sync reinstalls the pinned version — but only after verifying
  the artifact digest. The lock, not "whatever is installed", defines the
  target state.
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
