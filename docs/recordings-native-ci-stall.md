# Native CI stall sampling

This is diagnostic instrumentation, not a fix for the native test timeout.
The test selection, concurrency, assertions, 12-minute deadline, observational
`continue-on-error` policy, and `STDBUF1=L swift test ... | tee swift-test.log`
pipeline are unchanged. No package or native source is changed.

## Observed failure

At source `8545222e5bf22e2db3383651d4256294d6acfbea`, the
[native CI job](https://github.com/hasna/apps/actions/runs/34223476897/job/102051865204)
compiled successfully but its test step timed out. The retained log contains
414 test starts, one existing benchmark skip, 318 test completion lines, and
no final run summary. Three intentional expectation-integrity issues were
recorded; no unexpected assertion issue was recorded. A green observational
job does not make this a passing native run.

All 312 non-MainActor tests have completion lines. Of 102 MainActor tests, six
synchronous ProjectStore tests have completion lines; 96 do not. Those six
completed after 2.875–2.876 seconds. The final output is a non-MainActor CLI
reaper test completion after 14.958 seconds. This establishes initial actor
progress and a later shared boundary; it does not identify the blocking call.

## Sampling boundary

`tooling/ci/watch-recordings-native-stall.py` runs only with the macOS GitHub
Actions environment and as a direct child of the test-step Bash shell. It
uses Darwin process metadata to enumerate only that shell's descendants.
It requires a unique helper with all of the following:

- Exact `swiftpm-testing-helper` executable in the selected Xcode toolchain.
- Exact argument vector for the existing workflow command, including the
  current compiled `RecordingsPackageTests.xctest` binary twice as SwiftPM
  supplies it. Additional options, filters, or another bundle are refused.
- Matching user, parent chain, PID and microsecond process birth time,
  revalidated across discovery and immediately before sampling.
- At least 90 seconds without log growth while that same helper remains alive.

Only one three-second `/usr/bin/sample` invocation is admitted. Its output
is captured through an owned pipe and capped at 2 MiB. The sampler has a
nine-second execution/output deadline plus one second reserved to reap it.
Only that owned sampler subprocess can be terminated by the watcher. The
watcher never sends a signal to the test helper or its other descendants.
The PID-based system sampler cannot atomically bind a birth identity, so the
full identity is checked again afterward; changed or unavailable identity
causes the captured output to be discarded.

The preceding `verify:ci-native` step runs `swift build --build-tests` and
publishes `compiled=true` only after success. The observed run linked
`RecordingsPackageTests` before starting the test step. The watcher resolves
that already-built `.build/debug` bundle; it does not build or discover tests.
The current workflow does not set `DEVELOPER_DIR`; `/usr/bin/xcrun` uses the
runner's selected default toolchain (observed CI: Xcode 26.6, Swift 6.3.3).
A future selection or helper-argument mismatch is refused, never guessed.

The test shell uses an owned stop file and waits for its watcher on exit;
there is no normal-exit PID kill. Missing or ambiguous ownership, unavailable
platform metadata, or sampling failure produces a diagnostic status rather
than a guessed target. The watcher ends after 11 minutes even without a
sample. It does not extend the test step's deadline or determine its result.

Only `sample.txt` (bounded stack output) and `status.json` (constant status
codes, timing, process identity numbers and binary hashes) join the existing
log artifact, with the existing 14-day retention. No process environment or
argument dump is retained. Raw stacks may contain CI checkout/toolchain
paths and source symbols. Sampling adds small observational overhead and
may affect timing; absence of a sample does not establish test completion.

## Verification

- `python3 -I -B tooling/ci/tests/recordings-native-stall.test.py`: 17 tests
  passed, covering exact identity/arguments, foreign and ambiguous refusal,
  birth/ancestor replacement, 90-second admission, progress reset, exit and
  stop behavior, output/deadline bounds, FIFO/symlink/overwrite refusal, and
  success/failure shell cleanup without changing the pipeline exit status.
- An owned fictional Python child verified actual Darwin process identity,
  microsecond birth time, child enumeration and argument decoding. A
  separate newly created fictional child was sampled in 3.325 seconds;
  66,361 bytes were captured and the exact child remained alive afterward.
  Both fixture children were subsequently reaped by their own supervisor.
- The existing confined, fictional SwiftPM output probe passed one test and
  exposed its actual helper arguments. The observed layout matches the
  watcher contract; the probe's extra fixture-only options are intentionally
  not admitted by the CI watcher.
- Workflow YAML, Bash syntax and Python syntax were checked. No Recordings
  test, app, microphone, clipboard, permission, or existing process was
  executed or sampled for this change. CI has not yet run this instrumentation.

The argument layout is based on the maintained
[SwiftPM test runner](https://github.com/swiftlang/swift-package-manager/blob/swift-6.3.3-RELEASE/Sources/Commands/SwiftTestCommand.swift),
and the metadata adapter follows Apple's
[Darwin process interfaces](https://github.com/apple-oss-distributions/xnu/blob/main/libsyscall/wrappers/libproc/libproc.c).
In particular, `proc_listchildpids` returns a PID count, unlike the byte-count
return of `proc_listpids`; the regression covers this distinction.
