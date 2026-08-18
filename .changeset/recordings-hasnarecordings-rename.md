---
"@hasna/recordings": patch
---

Rename the macOS app bundle to HasnaRecordings.app per the fleet naming convention (knowledge k_msxd5rz3_jfvl3i): the full app now builds, signs, notarizes, installs, and updates as `/Applications/HasnaRecordings.app` (display name "Hasna Recordings") for both the full and bar variants — the previous bundle name `Recordings.app` is retained only in install/status discovery and journal recovery so legacy installs are found and cleaned up. The bundle identifier stays `com.hasna.recordings` and the executable inside the bundle stays `Recordings`, so TCC grants and update-client wiring keep keying on the same identity.

The release artifact basename follows the bundle name (`HasnaRecordings-<version>-macos-...`), consistent with the bar variant.

Also hardens install-lifecycle tests whose sentinel `sleep 30` children expired naturally during install cycles that run longer than 30 seconds under load (pre-existing ESRCH flake, reproduced on the base checkout), widens one smoke-timeout budget for the same reason, and teaches the install-journal validator to accept the data-dir `HasnaRecordings.app` install site alongside the legacy `Recordings.app` one.
