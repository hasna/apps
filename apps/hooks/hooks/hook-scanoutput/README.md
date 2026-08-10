# hook-scanoutput

Scans tool output for credential shapes and writes a warning. **Detection, not prevention.**

## What it does, and what it cannot do

`scanoutput` is a `PostToolUse` hook. It reads the tool result, hands the text to
`scanInputExposures` from `@hasna/secrets`, and writes a warning to stderr when a
credential shape is present. It always answers `{ "continue": true }` and never
blocks anything.

**It cannot redact or prevent anything, and it must never be described as though it
can.** PostToolUse fires after the tool has run and after its result exists.
Measured across the 48-hook catalog at `@hasna/hooks` 0.5.0, no output-rewriting
field exists on any event — `continue`, `decision`, `hookSpecificOutput`,
`additionalContext`, `suppressOutput` and `permissionDecision` are the entire
surface, and `suppressOutput` hides the hook's own stdout rather than the tool's.
By the time this hook sees a credential, that credential is already in the
transcript.

It is worth running because today nothing notices at all. A credential emitted by a
third-party tool into ordinary output is indistinguishable from ordinary output
until a human happens to look. This turns a silent exposure into a recorded one
with a named blast radius.

A guard advertised as preventing a leak it only reports afterwards retires the
worry without retiring the exposure. That is worse than no guard, which is why the
wording above is load-bearing rather than modesty.

## The field name is `tool_response`, and reading the wrong one makes this silent

This hook reads `tool_response`, falling back to `tool_output`. That is not defensive
padding — it is the difference between a working guard and one that reports clean
forever.

Verified against the Claude Code 2.1.226 binary on 2026-08-10. Its embedded schema:

```json
"tool_input": { "file_path": "/path/to/file.txt", "content": "..." },
"tool_response": { "success": true }  // PostToolUse only
```

and its implementation builds the hook input as:

```js
hook_event_name:"PostToolUse", tool_name:e, tool_input:r, tool_response:n, tool_use_id:t, duration_ms:l
```

Counted in the same binary: `tool_response` 21 occurrences, `tool_output` 2 — and both
of those are the telemetry event name `tengu_dead_probe_hook_updated_mcp_tool_output`,
neither adjacent to `PostToolUse`. Control: a deliberately absent string returns 0.

**Every other hook in this catalog reads `tool_output` only.** On Claude Code they
receive `undefined`. For a scanner that means an empty input, and an empty input scores
as clean — a guard that has never looked at anything and says so in the voice of a
guard that has. This hook was written that way first and the self-review caught it
before merge; the demonstration is one line:

```
PRE-FIX  reads tool_output   -> undefined  => scans NOTHING, reports clean
POST-FIX reads tool_response -> got 131 chars => scans it
```

Tests lock both field names and the preference order.

## Install

```bash
hooks install scanoutput
```

Never hand-edit `settings.json`. The package owns the wiring; a hand-edit reverts
on the next managed render and looks done while silently not being.

## Behaviour

| Situation | Outcome | Warning |
|---|---|---|
| Credential shape found | `found` | detector, severity, location, redacted preview |
| Output read whole, nothing found | `clean` | silent |
| Output empty | `empty` | silent |
| Output truncated, skipped, or 0 bytes read | `unscanned` | says UNSCANNED explicitly |
| Scanner missing or throws | `error` | says it could not scan |

`unscanned` exists so that "I looked at all of it and it was clean" and "I could not
look" do not share an answer. A guard that reports those identically is the defect
this hook was built to notice.

Findings carry only the scanner's own redacted preview. Values never appear.

## It reports every severity, deliberately

The obvious way to cut false positives is to drop `severity: medium` and keep only
`high`. **Do not.** Measured on station01, 2026-08-10: a `bash -x` trace emitted 25
live fleet API keys into ordinary tool output, and all 25 were
`detector=credential_assignment severity=medium`. A high-only filter sees none of
them. On the same corpora, `severity=high` matched zero findings — true or false.

## Measured false-positive rate

155 streams of real tool output, 1.67 MB, from 78 commands on station01,
2026-08-10. Scanned in-process with the same scanner the hook uses.

| Corpus | Streams | Bytes | Findings |
|---|---|---|---|
| A — ordinary commands (git, ls, npm, gh, Hasna CLIs, curl, source, manifests) | 80 | 771,142 | 0 |
| B — high-entropy non-credential (lockfiles, minified bundles, base64, UUIDs, hex tokens, SHAs) | 36 | 712,640 | 0 |
| C — credential-shaped docs (READMEs, `.env.example`, `--help`, shell traces) | 39 | 181,803 | 6 |

**6 false positives, all `credential_assignment`, all `severity: medium`:**

- 2 × `*_DATABASE_URL` with a connection-string value in a README — documentation
- 3 × from `.env.example` files — example values, 9 and 23 characters
- 1 × `PWD=` with an absolute path — `PWD` is in the detector's variable-name list

That is 4 of 155 streams firing (2.6%), and zero on the 116 streams of ordinary and
high-entropy output. The concentration is the useful part: false positives cluster
in documentation and help text, not in command output.

Controls, both directions, on the same harness: three synthetic credential shapes
injected into three of corpus A's streams were detected on exactly those three and
nowhere else; the un-injected copy of the same corpus returned zero.

The scanner already suppresses obvious placeholders — values starting `$` or `<`,
containing `...`, all-`*x_-`, or containing `example`/`placeholder`/`redacted`/
`changeme`/`dummy`. The 6 above are what survives that.

**The axis this corpus does not vary:** sustained output from CI systems, container
runtimes and orchestrators, which print `NAME=value` environment blocks as a matter
of course. `PWD=` firing once here suggests that population would fire much more
often, and it is not represented above. Measure the fire rate there before anyone
proposes escalating this hook from warn to block.

## Cost

The scan runs in-process. Measured on station01, 2026-08-10:

| Path | Cost |
|---|---|
| `secrets scan input` as a CLI spawn | 1.28–1.81 s for 11 KB; 1.35–1.65 s for 2.2 MB |
| In-process `scanInputExposures` | 25 ms import, then 1.4–7.3 ms for 11 KB, 64–90 ms for 2.2 MB |

The CLI cost is process startup and is flat in payload — 198× the input costs the
same. Removing the spawn removes that term, after which cost becomes roughly linear
in payload, so the `MAX_SCAN_BYTES` ceiling does buy something in-process where it
would have bought nothing via the CLI.

The dominant remaining cost is not this hook: dispatching any hook through
`hooks run <name>` measured 2.38–2.99 s on this box. That is a property of hook
dispatch, paid by every installed hook, and it is the number to look at before
installing this on a hot matcher.
