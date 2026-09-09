# Recordings native CI output visibility

The macOS workflow sets `STDBUF1=L` on its `swift test` command so newline-terminated progress reaches `tee` promptly. The full native timeout remains **unresolved**; this change improves the evidence available to diagnose it.

At source `d8dc67f65d8aa7783896bd86b9b466f05cb64415`, [run 34217490831](https://github.com/hasna/apps/actions/runs/34217490831/job/102032597401) compiled successfully, but the observational Swift test step timed out after 12 minutes. Its retained log contains 119 bytes of build prelude and exactly 65,536 bytes of test output, ending midline. Output arrived at 10:52:15–10:52:21 UTC, before cancellation at 11:04:19. The log records 414 test starts, one skipped benchmark, 236 test completions, and three intentional integrity-test issues. The other 178 started tests have **no recorded completion**; buffering can hide later progress, so they are not proven to be individually stuck. No final Swift summary exists.

The preceding [run 34213594629](https://github.com/hasna/apps/actions/runs/34213594629/job/102020039486) retained 88,610 bytes of test output after the same 119-byte prelude and a complete 413-test summary. Thus 64 KiB is not a hard capture limit.

## Independent output-only experiment

A fictional SwiftPM package with one Swift Testing test wrote 196,625 `V` bytes followed by a newline and a tail marker. Only after the stdout write returned did it create an independent `writer-completed` file. The supervisor observed that file, waited two seconds while the test deliberately paused, captured the forwarded output, and then created a release file. The test's own wait was bounded at 10 seconds and the supervisor at 45 seconds. This package neither linked nor executed Recordings. Both runs used Apple Swift 6.3.3 and the pinned Swift Testing revision `3fdabe5392108d874abae1c1e58e1328ab46f681` under an owned macOS sandbox; network and host-tool denial probes passed.

| Observation | Default stdout | `STDBUF1=L` |
| --- | ---: | ---: |
| Independent writer marker present while test alive | yes | yes |
| Test bytes forwarded while paused, excluding 1,088-byte planning prelude | 196,608 (3 × 65,536) | 196,778 |
| Non-aligned tail visible while paused | no | yes |
| Final test result | 1 passed, 2.067 s | 1 passed, 2.083 s |

The [default receipt](evidence/recordings-native-output-default-20260908.json) and [line-buffered receipt](evidence/recordings-native-output-line-buffered-20260908.json) retain the measured results and source/log hashes, with absolute local paths removed. The planning prelude included harmless compiler-target warnings and blocked dependency-refresh attempts; both tests ran against the already copied, pinned dependencies. This experiment proves forwarding buffering, not the cause of the Recordings timeout.

## Mechanism and scope

[Apple libc](https://github.com/apple-oss-distributions/Libc/blob/71bbe350ab79eef58113991d817ccc6165061a64/stdio/FreeBSD/makebuf.c#L80-L112) reads `STDBUF1` for stdout and [maps `L` to line buffering](https://github.com/apple-oss-distributions/Libc/blob/71bbe350ab79eef58113991d817ccc6165061a64/stdio/FreeBSD/makebuf.c#L143-L146). [SwiftPM 6.3.3](https://github.com/swiftlang/swift-package-manager/blob/swift-6.3.3-RELEASE/Sources/Commands/SwiftTestCommand.swift#L547-L550) forwards child output through `print(..., terminator: "")` without an explicit flush. The [upstream piped-output issue](https://github.com/swiftlang/swift-package-manager/issues/6592) describes the same visibility problem; it is not evidence that this run's tests completed.

The assignment is local to the `swift test` invocation, not the job, compiler step, or `tee`. Descendants inherit it, so libc stdout flushing can occur earlier and use more writes. It changes no test selection, concurrency, assertion, deadline, exit-status handling, or production code. `pipefail`, the 12-minute limit, existing observational policy, and retained-log upload remain intact. The missing-summary warning counts recorded completion lines, including suite lines, rather than claiming a number of completed tests. Incomplete lines can still remain buffered, and a future runner/libc change may require revisiting the setting. This is macOS-specific CI configuration, not a portable application setting.

Validation covers the paired pure experiment, workflow YAML parsing, shell syntax, and structural comparison with the parent workflow. No Recordings tests, apps, permissions, or release artifacts were changed or executed for this observability patch. A subsequent CI run must expose the actual tail before any claim that the native timeout is resolved.
