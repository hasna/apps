# Scheduling fixture admission and observation phases

The complete native suite at
[`f9227e694f7c5c0a61a3bd227c71bd8694069cdb`](https://github.com/hasna/apps/actions/runs/34234288941/job/102087899675)
finished in 11.546 seconds: 417 tests in 60 suites, one existing skipped
benchmark, and seven issues including three intentional integrity controls.
The four unexpected issues belonged to the two cases of the new blocking-work
fixture. Both reported `entered: false, peerBeforeRelease: false`; their value
and cancellation checks passed. The Swift process exited 1. The job's green
observational conclusion did not mean the suite passed.

The fixture started a two-second admission stopwatch immediately after creating
an async task. Under suite load, that timer could expire before the task had
submitted its synchronous operation. The subsequent peer check then measured
startup delay rather than executor progress while an operation was held.

Only `BlockingOperationTests.swift` changes in this follow-up. A single buffered
`AsyncStream` hands the work task its own cancellation handle. The caller yields
and finishes the stream synchronously before awaiting the task, and the task
receives the handle before entering the blocking adapter. This handoff suspends
asynchronously; it does not block a cooperative worker. The independent observer
thread now starts inside the entered operation. It enqueues the peer and uses the
same one-second observation window, with an unconditional deferred gate release.
The task/observer handoff is consumed and finished; no unfinished stream retains
its task after completion.

The parameterized test also delays submission asynchronously for three seconds,
covering both immediate and delayed admission with and without cancellation.
Cancellation still occurs after operation entry, and the value, exact error,
cancellation flag, and peer-before-release assertions remain intact. No
production code, CLI budget, suite concurrency, test selection policy, or CI
deadline changes.

## Controls and focused verification

- **Original fixture plus delayed submission:** exactly four admission/peer
  issues on the delayed cases, in 3.196 seconds. This reproduces the phase error
  using the working production queue adapter.
- **Corrected fixture plus production adapter:** 2 registrations / 5 cases pass
  in 3.019 seconds with the strict cooperative pool.
- **Corrected fixture plus old detached behavior:** exactly four peer-progress
  issues in 5.028 seconds; every operation reports `entered: true`. Values,
  cancellation flags and exact-error behavior remain correct. Independent rescue
  threads drain the test and it exits with failure rather than hanging.
- **Final interaction selection:** the actual app/test bundle builds, and the
  same 47-test selection passes under normal and strict cooperative scheduling.
  It includes the existing frozen-target, warm-up, rewrite cancellation, project,
  PCM and CLI deadline cases. Exact results and input hashes are retained in the
  [evidence receipt](evidence/recordings-blocking-fixture-phase-20260908.json).

The detached-adapter replacement was diagnostic only and was restored exactly
before final compilation. The final production source tree and package manifest
match `f9227e6`. All runtime checks used the owned profiles and bounded supervisor
from the preceding scheduling investigation: no network, owner state, microphone,
Accessibility target, clipboard or installed app execution. The supervisor's
post-timeout drain/reap is bounded and reports uncertain cleanup explicitly.

This follow-up has focused validation only. The full native suite must pass at
the corrected revision in CI; the completed-but-failing `f9227e6` run is retained
as historical evidence. Existing prepared archives remain immutable. Since
native test sources ship in the package, this correction requires a newly packed
candidate rather than reusing those archive bytes.
