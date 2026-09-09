# Native provider finalization

`RecordingTranscriptionSession.inputEnded()` is an optional early notification
with a default no-op implementation. Existing and file-based providers retain
their behavior without changing their conformance.

The engine stops capture, drains converter callbacks and the final short PCM
chunk, then calls `inputEnded()` exactly once. A streaming adapter may close its
remote input immediately and cache an authoritative result while the engine
writes the fallback WAV. The hook returns promptly; it does not receive a file
URL and must not publish, paste, or claim persistence. Implementations must bound
their finalization deadline starting at this notification and respect cancellation.

`finish(request)` still runs only after the complete WAV has been written
successfully. It may return the cached final. The engine publishes text and
attempts paste only after that call succeeds and the capture generation is still
current. A failed write cancels the session. Cancellation while writing prevents
any later result from being delivered. Local file recognition remains on the
existing complete-file path.

The existing monotonic `pipeline_timing` log adds these provider-path stages:

- `pcm_drain_complete`: recorder shutdown and all tail PCM have completed.
- `provider_input_ended`: the early notification has returned.
- `wav_write_complete`: fallback-file writing has succeeded.
- `provider_finish_complete`: final text has returned after the file barrier.

Each stage reports elapsed milliseconds from the same `release` timestamp. Their
differences separate drain, file writing, and the remaining provider wait. The
timestamps are captured at each boundary and written in one batch when the
completion task exits; timing-file I/O does not precede early input close or WAV
writing. Log order can therefore differ from the captured elapsed-time order. The
existing `paste_requested` and delivery-result stages continue to measure paste
separately. These entries contain phase names, durations, a generated pipeline
identifier and PCM byte count, never audio, transcript content or credentials.

Overlapping file writing removes that serialization from the streaming critical
path. It does not remove recorder shutdown, model/network finalization, durable
storage or paste verification, and is not a measured production latency claim.

Validation on 2026-09-07 used Swift 6.3.3: the package's test build passed and
`RecordingProviderTests|NativePCMRecorderTests` passed all 15 tests. Capture was
injected, including converter-tail cases. The run used an OS sandbox denying
network, microphone, legacy application/state/preferences/Keychain access,
clipboard/AX/TCC service lookups, unrelated process signals and outside writes.
Atomic Foundation writes were allowed only inside the fixture root and a fresh,
task-specific `TemporaryItems/NSIRD_<processName>_*` namespace. These are fictional
source tests, separate from live microphone, provider, paste and release acceptance.
