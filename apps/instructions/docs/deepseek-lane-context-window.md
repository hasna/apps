# Declaring the deepseek-lane context window to Claude Code

Canonical fleet reference for the spawn-context fix (2026-08-24). Owns the
declaration of the model context window for the unrecognized deepseek lane
model on Claude Code, so workflow subagent spawns survive a second turn.

## Incident (2026-08-21)

Workflow subagent spawns on the harness-shaped path injected ~185K input
tokens on request 1 and died on request 2:

- 24/24 subagents died on request 2; 26/26 `invalid_request` "Prompt is too
  long" records in the sumi-rename lane transcripts at 190,599-191,263 input
  totals (Aug 21).
- Cap measured on the harness-shaped subagent path: passes at 185,104, fails
  at 185,931 — the cap sat just above 185K.
- Working room at the then-current injection was under 1K tokens, so any tool
  use killed the agent.

## Root cause

Claude Code 2.1.241 does not recognize the lane model
(`stealth/ox-alpha[1m]` in settings.json, `deepseek-v4-flash[1m]` via
`ANTHROPIC_MODEL`). For unrecognized models it enforces a client-side assumed
window, and the enforced budget was the binding limit at incident time.

Measured 2026-08-24 (after the incident):

- Raw API probes to `api.deepseek.com/anthropic` pass at 372,033 input tokens
  (max_tokens=1), 194,816 system + 131,072 max_tokens, and 192,768 system +
  tools + cache_control + 65,536 max_tokens.
- The actual client (Claude Code 2.1.241, headless, same endpoint and model)
  sends and receives a 384,514-input-token first request successfully.
- A second request (tool-result continuation — the exact failing shape) at
  186,793 input tokens + 197,632 cache-read tokens succeeds.

So the endpoint itself accepts far beyond the incident boundary; the wall was
the client-side unknown-model window enforcement. The binary's own remedy text
for the unrecognized-model path: "set CLAUDE_CODE_MAX_CONTEXT_TOKENS to its
real window", and "CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1
restores the previous wait-for-the-API behavior".

## The fix

Declare the model's real window in the fleet Claude Code settings, managed
through the instructions pipeline (`claude-settings` config, target
`~/.claude/settings.json`):

```json
{
  "env": {
    "CLAUDE_CODE_MAX_CONTEXT_TOKENS": "1048576",
    "CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT": "1"
  }
}
```

- `CLAUDE_CODE_MAX_CONTEXT_TOKENS=1048576` — the `[1m]` lane model's real
  window; the client no longer assumes a ~200K window for it.
- `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1` — restores
  wait-for-the-API behavior for unrecognized models, as the belt-and-
  suspenders half.

The `env` block of settings.json is applied by Claude Code to every session
process at startup (verified 2026-08-24 with a SessionStart-hook probe in an
isolated `CLAUDE_CONFIG_DIR`), so interactive sessions, headless runs, and
in-process workflow subagent spawns all inherit the declaration. Full
doctrine stays available to interactive sessions — nothing in the render
pipeline is trimmed.

## Landing

On any machine running the deepseek lane:

```bash
# 1. write the settings content (env block + existing hooks) to the target
# 2. update the managed config row in place
instructions add ~/.claude/settings.json -n claude-settings -c agent -a claude -k file --update
# 3. apply through the pipeline (resolves {{VAR}} placeholders)
instructions apply claude-settings
# 4. verify
instructions diff claude-settings   # only placeholder-resolution drift expected
instructions scan claude-settings   # zero findings
```

Landing record: `claude-settings` v34 (was v33), 2026-08-24.

## Verification (the failing case)

Same instrument, two requests in one headless run with the full rendered
instruction corpus appended (771,140 B corpus; first request 384,514 input
tokens, second request 186,793 + 197,632 cache-read):

```
request 1: input 384,514  -> assistant tool_use (Bash)   rc=0
request 2: input 186,793  -> assistant text              rc=0
           (cache_read 197,632)
```

The second request is the exact shape that killed 24/24 subagents on
2026-08-21 (any total above ~185,931 was rejected). It now succeeds.

Session env pick-up from the settings.json `env` block was proven with an
isolated `CLAUDE_CONFIG_DIR` probe: a SessionStart hook read
`CLAUDE_CODE_MAX_CONTEXT_TOKENS=1048576` and
`CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1` from the process
environment.
