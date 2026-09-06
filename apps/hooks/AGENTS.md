# AGENTS.md

Guidance for AI agents working with this repository.

## Overview

This is `@hasna/hooks`, an open-source monorepo of Claude Code hooks providing CLI installation and management of 15+ lifecycle hooks.

## Credential chain (2026-09-04 adoption, hasna/apps#1720)

The registry authority and its credential resolve through the ONE
`@hasna/contracts` client resolver (`src/lib/transport.ts` / `local-opt-in.ts`),
fresh on every call, as a STRICT pair — a URL without a key is a refusal, and a
key alone resolves the fleet gateway. Order: an explicit argument, then
`HASNA_HOOKS_API_KEY_OVERRIDE` / `HASNA_PROFILE` / `HASNA_HOOKS_API_KEY_REF`,
the macOS Keychain `hasna.credentials.hooks.api-key` / `.api-url`, disk
`~/.hasna/hooks/config/credentials`, then `HASNA_HOOKS_API_URL` /
`HASNA_HOOKS_API_KEY`. Retired and never read: `~/.hasna/fleet-env`,
`~/.hasna/cloud`, `~/.config/hasna`, `$XDG_CONFIG_HOME`,
`~/.hasna/hooks/config.json`, `HASNA_HOOKS_REGISTRY_URL` / `HOOKS_REGISTRY_URL`,
and any `*_MODE` switch. Local mode is opt-in only (`HASNA_HOOKS_LOCAL=1`,
alias `HOOKS_LOCAL=1`) and prints "LOCAL mode" on stderr once per process;
without it, an unconfigured run fails closed. When touching resolution code,
add hermetic tests (fake HOME / injected `security` runner) — see
`src/lib/transport.test.ts`.

## Quick Commands

```bash
bun install          # Install dependencies
bun run dev          # Run CLI
bun run build        # Build
bun run typecheck    # Type check
bun test             # Run tests
```

A test that spawns a subprocess more than twice, or that asserts on its own elapsed time,
declares an explicit per-test budget — see the Tests section in `CONTRIBUTING.md`.

## Adding Hooks

1. Copy to `hooks/hook-{name}/`
2. Ensure it follows the standard hook pattern (stdin JSON → stdout JSON)
3. Remove any internal references (hasna, etc.)
4. Verify no secrets or API keys are committed
5. Update `src/lib/registry.ts` to include the hook

## Structure

```
hooks/hook-{name}/
├── src/
│   ├── hook.ts      # Main hook logic
│   ├── cli.ts       # CLI commands
│   └── index.ts     # Exports
├── package.json
├── CLAUDE.md
└── README.md
```

## Hook Events

| Event | Timing | Can Block | Use Case |
|-------|--------|-----------|----------|
| PreToolUse | Before tool | Yes | Security, safety guards |
| PostToolUse | After tool | No | Quality checks, async tasks |
| Stop | Session end | No | Notifications, cleanup |
| Notification | On notify | No | Context management |

## Security Checks

Before committing any hook:
- [ ] No hardcoded API keys/tokens
- [ ] No internal references (hasna)
- [ ] Uses `@hasna` namespace for public packages
- [ ] .env.example has placeholders only
