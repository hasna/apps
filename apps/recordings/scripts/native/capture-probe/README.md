# Isolated native microphone check

This small AppKit app compiles the same `NativePCMRecorder.swift` used by Recordings. It compares the current input-scope tap format with an explicitly selected output-bus format. Both choices use the current recorder conversion code. To compare a correction with the original behavior, retain separately identified builds and their source receipts.

Build on an Apple Silicon Mac:

```sh
python3 scripts/native/capture-probe/build.py --output /tmp/recordings-capture-check
```

Sign the resulting bundle using an authorized local signing identity before testing on another Mac. Launch the separate **Recordings Microphone Check** app, grant its own microphone permission, select a format, and click **Start microphone check**. Speak normally during the eight-second capture. Run each format separately with the same input route. A 25-second independent watchdog exits the probe if capture startup or shutdown hangs. The watchdog does not wait for report locks or disk I/O; an interrupted check may leave no completed report.

The probe creates no account, reads no Recordings preferences, credentials, library, or control socket, and makes no network requests. Audio is discarded in memory. Only aggregate signal counts, levels, audio formats, conversion results and engine state are written to `~/Library/Application Support/Recordings Capture Probe/reports/`. Reports contain no microphone name or device identifier.

Interpretation:
- Nonzero raw signal and zero converted output point to conversion or channel handling.
- Zero raw buffer or sample counts mean no input was measured; they are not evidence of silent samples.
- With nonzero sample counts, raw and converted zeros mean the signal was absent before conversion; investigate device route, microphone mode and the app's permission state.
- A format mismatch, conversion error or engine configuration event provides a separate concrete failure signal.
- Success in this separate bundle does not establish that the installed Recordings app has the same permission or microphone mode.
- Do not infer speech detection or transcription quality from signal levels alone.

Keep the installed working app and its recordings intact. This is an instrumented capture check, not a replacement app or provider test.
