# Blocking native operations and cooperative executor progress

The native job at `0068f36a4143a2d1880517d9b9f2c33cda2162be` timed out after
12 minutes. Its observational job status was green, but the Swift suite did not
complete. The [retained CI sample](https://github.com/hasna/apps/actions/runs/34227774235/job/102066032394)
showed the main run loop servicing recording timer callbacks while cooperative
workers were inside three deliberately blocked selection fixtures, a blocked
rewrite fixture, and synchronous project CLI registration. The log recorded
332 test completion lines out of 414 starts, with 82 starts lacking a recorded
completion. This identifies blocked cooperative workers; it does not establish
that a real Accessibility request waits indefinitely.

A pure Swift probe with `LIBDISPATCH_COOPERATIVE_POOL_STRICT=1` held a synchronous
callback behind a semaphore. A separate thread queued an async peer after the
callback entered, and an independent supervisor released the callback after two
seconds. With the callback inside `Task.detached`, the peer ran only after that
release. Dispatching the identical callback to a concurrent queue and awaiting a
checked continuation let the peer run while the callback remained held. Both
processes drained and exited successfully. This is a scheduling mechanism probe,
not execution of Recordings or a complete reproduction of its CI suite.

## Change and preserved behavior

`BlockingOperation` bridges Sendable synchronous operations to a private
concurrent Dispatch queue. The four callers are the recording-start selection
and window-title snapshot, command rewrite, project reconciliation, and project
addition. The separately started snapshot task and its frozen per-generation
context remain in place, so starting audio does not wait for the snapshot and
stopping still awaits that exact context. A stalled earlier snapshot does not
serialize later snapshots behind it.

The synchronous routines do not read Swift task cancellation, task-local values,
or caller thread-local state. The previous detached operations did not inherit
caller cancellation or task-local values either. The new adapter returns the
same value or error after submitted work drains; it does not forcibly interrupt
that work. Outer cancellation and generation checks still reject stale delivery
and state publication. Existing AX messaging limits, CLI process termination,
pipe cleanup, and the 10-second interactive rewrite ceiling remain unchanged.

The three CLI deadline tests now exercise the same adapter as production. Their
10-second upper bounds and 8.4-second exhaustion lower bounds are unchanged.
Those fixture engines and the shared delivery fixture disable global handlers
from initialization. Project and deadline fixture directories use the maintained
isolated-home helper, which honors `RECORDINGS_TEST_TMP_ROOT`; explicit cleanup
and all behavioral assertions remain. Tests specifically exercising global
shortcut behavior are unchanged.

## Validation

The actual adapter regression was first compiled with its body using the old
`Task.detached` behavior. Under the strict cooperative pool, both normal and
cancelled cases failed their peer-progress assertion in 2.011 seconds; their
independent rescue threads released the gates, and the process exited with the
expected failure. The exact-error case passed. With the queue bridge, the same
2 registrations / 3 cases passed in 0.002 seconds. The cancelled case still
received its result and observed cancellation after the await.

The actual app and test bundle compiled with Apple Swift 6.3.3. A focused
47-test selection across 7 suites passed with normal scheduling in 9.432 seconds
and with the strict cooperative pool in 9.598 seconds. It includes all start and
warm-up tests, the rewrite cancellation test, native PCM fixture tests, project
store tests, the adapter tests, and the three CLI deadline cases. The frozen
start-context test retains its 150 ms finalizing/pending assertion. Normal CLI
case durations were 8.853, 9.238 and 9.431 seconds; strict durations were 8.620,
9.432 and 9.595 seconds.

Runtime profiles denied network, microphone, owner-home/application reads,
preferences and security services, outside writes, and unrelated execution.
Only the owned test helper, bundle, exact fictional child executable patterns,
and required pinned shell/compiler tools were executable; signals were confined
to the same sandbox. An owned child preflight and network/outside-write/host-tool
negative controls passed. Initial fixture refusals were retained: Foundation
ignored `TMPDIR`, and the shell launcher required its actual `/bin/bash` variant.
The fixture root fix and exact tool allowance resolved those harness failures;
generic global temporary writes were never allowed. The successful runs exited
before their supervisor deadline. Review then found an unbounded final pipe
drain on the supervisor's timeout path; the retained runners now bound that drain
and reap, report uncertain cleanup, and never signal a reaped leader. Four
synthetic process-table controls cover that failure path. The evidence preserves
the original successful-run supervisor hashes separately from this correction.

[Input and result hashes](evidence/recordings-blocking-operations-20260908.json)
bind the changed sources, build logs, test logs, profiles and compiled binaries.
No installed app, real microphone, target Accessibility operation, clipboard,
or provider was used. The full native suite and monorepo gates must still
complete in required CI; focused success does not establish that the previous
full-suite timeout is resolved. Production native bytes changed, so an earlier
prepared release archive cannot serve as the candidate for this revision.
