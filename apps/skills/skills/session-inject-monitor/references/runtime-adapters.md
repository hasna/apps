# Runtime adapters — injector matrix

Every row states the exact command shape and whether it was MEASURED on this fleet
(2026-08-19, station01, opencode2 beta-17595, opencode 1.18.18, claude 2.1.235,
codewith 0.1.95, codex-cli 0.147.0) or is UNVERIFIED. A row that is unverified must
never be presented as working: the injector script refuses with a clear message
unless `SESSION_INJECT_UNVERIFIED_OK=1` is set, at which point it prints a warning
and runs the best-documented shape.

## Rule of the matrix

Injection into a LIVE interactive client is only measured for opencode2. For every
other runtime the scripts refuse by default; reroute to opencode2 when the target
is an opencode2 session, or use the headless resume shape with the warning that it
is a NEW process, not a push into the running TUI. Do not fabricate a working
command for a runtime nobody has measured.

## opencode2 — PRIMARY, [measured]

```
opencode2 api v2.session.prompt --param sessionID=<session-id> -d '{"text":"..."}'
```

- Operation: `v2.session.prompt`, `POST /api/session/{sessionID}/prompt`.
- Measured: yes, 2026-08-19 — streams a real user turn to the attached client.
- The opencode-scheduler npm plugin does NOT load on opencode2 (SchemaError) — do
  not route through it; this API is the supported path.
- Script: `scripts/inject-opencode2.sh --session <id> --text "<prompt>"`.

## opencode (classic) — [unverified]

```
opencode run --attach <server-url> --session <id> -- "TEXT"
```

- Best documented shape for a running server; NOT measured as a live-client
  injector on this fleet.
- `opencode run -c/--continue` or `-s/--session` WITHOUT `--attach` starts a NEW
  headless server + session — that is a fresh run, not an injection. There is no
  `--prompt` flag; the prompt is the positional message.
- Script refuses by default; opt in with `SESSION_INJECT_UNVERIFIED_OK=1` (then
  the server URL comes from `--server`, `SIM_OPCODE_SERVER`, or manifest
  `target.args.server`).

## Claude Code — [unverified]

```
claude -p --session-id <uuid> --resume <uuid> -- "TEXT"
```

- Flags verified to exist in claude 2.1.235 help (`-p/--print`, `--session-id`,
  `-r/--resume`, `--bg/--background`, `--remote-control`) but the live-injection
  behavior was NOT measured. This shape resumes the conversation in a NEW headless
  process; it does not push into a running TUI. `--remote-control`/`--bg` are the
  plausible live channels and remain unmeasured.
- Script refuses by default; opt in with `SESSION_INJECT_UNVERIFIED_OK=1`; set
  `SIM_CLAUDE_RESUME=0` to rely on `--session-id` alone.

## Codewith — [unverified]

```
codewith exec resume <session-id>    # prompt via stdin
codewith exec resume --last
```

- `codewith exec resume` exists in 0.1.95 help; the resume shape is a NEW process
  continuing a previous session. Durable background agents (`codewith agent
  start|attach|logs|stop`) exist, but `codewith agent attach` only delivers
  pending interactions — it does not inject an arbitrary prompt. Native loops/goals
  run their own scheduler; they cannot be prompted externally without a new loop
  firing. All of this is unmeasured as a live injector.
- Script refuses by default; opt in with `SESSION_INJECT_UNVERIFIED_OK=1`.

## Codex — [unverified]

```
codex exec resume <session-id>    # prompt via stdin
codex exec resume --last
```

- `codex exec resume` exists in 0.147.0 help; same caveats as Codewith. The
  `--remote` / `remote-control` app-server surface is experimental and unmeasured.
- Script refuses by default; opt in with `SESSION_INJECT_UNVERIFIED_OK=1`; set
  `SIM_CODEX_LAST=1` to resume the most recent session without an id.

## Injector common contract

Every `inject-*.sh` script:

- accepts `--session <id> --text "<prompt>"` (or `SIM_TARGET_SESSION` /
  `SIM_PROMPT_TEXT` env), prints usage on `--help`, and is `set -euo pipefail`.
- JSON-encodes the prompt body with python3 (quotes/newlines safe; the prompt is
  content, never a credential).
- captures stdout/stderr to scratch files before acting on the rc — capture-path
  discipline applies to injectors too.
- prints a refusal (exit 2) instead of pretending when its runtime is unverified
  and `SESSION_INJECT_UNVERIFIED_OK` is unset.
- never contains, prints, or logs a credential value in any encoding.