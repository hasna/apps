---
"@hasna/trash": patch
---

Recovery is owner-scoped, which ends the parallel-`put` flake (hasna/apps CI
publish-guard, 2026-09-11).

- Every process ran `recover()` in `init()` and completed whatever capture
  intent it found. Two `put`s starting together therefore had the second one
  publish the first one's metadata from the first one's payload, and the first
  one's own publish collided (`PublishCollisionError` → `refused` → exit 2):
  19 refusals in 36 runs under 3x parallel load, and a red publish guard on
  pull requests that never touched `apps/trash`.
- A capture intent now records its owner (`pid`, `host`, `startedAt`).
  Recovery leaves an intent alone while its owner is a live process on the
  same host (`kill(pid, 0)`; EPERM counts as alive) and reports it under the
  new `RecoveryReport.inFlight`. The current pid is never in flight: the
  capture path is synchronous, so an intent from this pid still on disk can
  only be an aborted one. Intents without an owner (older writers) or from
  another host are recovered as before.
- The owner tolerates a recoverer that completed its intent anyway: a metadata
  publish that collides with byte-identical metadata is completion, not a
  collision. Different content at that path is still refused.
- An intent listed by recovery but gone before it is read (its owner finished)
  is no longer reported as unresolvable.
- Regression tests: eight cold-start processes for three rounds; a live
  sibling's intent left alone until that sibling exits; same-pid, ownerless and
  foreign-host intents recovered; the tolerant publish and the still-refused
  genuine collision.
