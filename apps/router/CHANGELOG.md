# Changelog

All notable changes to `@hasna/router` are documented in this file.

## 0.1.0 - 2026-07-24

First published release.

- `routePrompt()` library API: deterministic, inspectable route decisions for
  prompts and chat messages across configured providers, models, routes, and
  policy.
- Decision output includes the selected candidate reference, eligible scores,
  skipped candidates with reasons, prompt analysis, source hints, and safety
  notes. Candidate references are redacted so responses never expose provider
  keys, auth headers, or private base URLs.
- `open-router` CLI with `route`, `analyze`, `validate`, `smoke`, `serve`, and
  `help` commands.
- Router service (`GET /health`, `POST /v1/route`), bound to `127.0.0.1` by
  default.
- Gateway adapters and provider references for open-gateway, OpenRouter,
  Vercel AI Gateway, LiteLLM, Portkey, Cloudflare AI Gateway, and Kong AI
  Gateway.
- Shipped `router.config.example.json`, docs, and library example.
