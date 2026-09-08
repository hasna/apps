# CLI tmux fixture lifecycle — 2026-09-08

Aggregate CI run [34223476891, job 102051864352](https://github.com/hasna/apps/actions/runs/34223476891/job/102051864352)
failed in `beforeEach`: `new-session` returned `server exited unexpectedly`.
The missing-target assertion never ran. Dispatch reported 541 passed, 3 skipped,
and 1 failed. Its source was unchanged by the Recordings release branch.

The fixture previously killed its last session before starting another. tmux
normally exits when no sessions remain; `kill-session` does not join the server
process. See the [tmux 3.7c server loop](https://github.com/tmux/tmux/blob/3.7c/server.c)
and [kill-session implementation](https://github.com/tmux/tmux/blob/3.7c/cmd-kill-session.c).
An owned macOS probe performed 400 such resets and observed 400 different server
PIDs, but did **not** reproduce the exact Linux error. CI scheduling remains
unproven; this change removes the teardown boundary rather than claiming a crash
diagnosis.

The CLI suite now uses a private child `TMUX_TMPDIR`, clears inherited `TMUX`,
uses owned HOME/XDG directories, and starts tmux with `-f /dev/null`. Reset uses
`respawn-pane -k`. A checked real startup replaces the disposable availability
probe; startup failure still fails the suite. Teardown stops the exact private
socket, including after partial startup, and confirms the server PID has exited
before deleting its directory. An uncertain exit fails and retains the directory.

The actual-tmux regression first moves the fake agent into Working, then requires
the same server/session/pane, a different agent PID, and fresh idle contents.
Restoring kill/new made this fail deterministically (server PID 30895 → 30907).
The final focused run passed **14 tests, 81 assertions**, including real CLI
delivery, durable status/list reads, long input, nonexistent targets, open stdin,
and a real server that starts successfully before its client reports failure.
Existing readiness waits, delivery timeouts, and assertions remain unchanged.

Validation used Bun 1.3.14 and actual tmux 3.7c under a macOS OS sandbox. Only
owned UNIX sockets and fixture writes were allowed; negative controls verified
network, outside-socket, owner-preferences, foreign-signal, and SSH/app-tool
refusals. The harness used a hash-identical Bun copy named `codewith` because
Darwin tmux reports the executable basename, plus GNU tail and profile-free Bash
to match the Linux open-pipe fixture. No production detection logic changed.

Package and focused fixture typechecks passed; affected build reported
`1 successful, 1 total`. The confined root check stopped at 14 manifest validators
without verdicts; it was not green. The full package suite was not repeated
locally. Required CI remains the broader validation gate.

Retained operator artifact directory: `dispatch-tmux-fixture-20260908`.
`evidence.json` SHA-256:
`bca9af2d2ab06e32084571446591384d155d81a9ef432a1949ca23570fa88cc1`.
Key logs are `reset-private-before.log`, `teardown-final.log`, and
`controls-final.log`; the receipt binds their hashes and launcher/profile hashes.
