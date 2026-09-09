# Freezing a host application's paste destination

Create one `RecordingPasteTargetTracker` before presenting the host app's window.
Keep it for the application's lifetime, including when a provider change creates a
new `RecordingEngine`. On each start, pass its current snapshot explicitly:

```swift
let target = tracker.snapshot()
engine.startRecording(pasteTarget: .frozen(target))
```

The tracker seeds itself from the actual frontmost application and observes
workspace activation and termination. It remembers only external regular apps
with a PID, bundle ID and launch date. It ignores the recorder and helper apps;
it never activates an app, installs a global input handler, reads app documents,
queries Accessibility or accesses the clipboard. Snapshot revalidation discards
terminated/replaced processes rather than searching older apps as substitutes.

`RecordingPasteTarget` is an immutable observation. The engine checks the exact
identity at start, freezes it for that recording generation, and requires that
same identity during target selection and pre-keystroke focus checks. A missing
or reused PID, different bundle/launch date, or nonregular target cannot receive
the paste. A later foreground app is never a substitute for `.frozen`, including
`.frozen(nil)`. Omitting this parameter preserves existing engine behavior.

An explicitly empty target completes transcription normally. If auto-paste is on,
ordinary dictation uses the existing copy fallback and adds a `RecentPaste`
receipt with `deliveryStatus: .notDelivered` and `verified: false`. Its location is
`Clipboard only` only when the clipboard write succeeded. No app is invented for
an empty target. Permission and target-unavailable early exits also retain an
undelivered receipt. Command rewrites retain their no-copy fallback policy.
The host should present transcription/persistence separately from this delivery
outcome; a copied transcript is not a confirmed paste.

Headless validation on Darwin: 45 tests in the tracker, frozen-target, provider and
existing paste-target suites passed. Fixtures use fabricated process observations,
a fake PCM recorder/provider, and an injected copy writer; no real microphone,
Accessibility operation, clipboard write or app activation occurs. This evidence
does not replace live host-app recording-to-paste acceptance.
