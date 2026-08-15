---
"@hasna/hooks": patch
---

Deep-QA hardening (task efcad315, PR #151):

- **Security (P1):** registry fetches refuse redirects (`redirect: "error"`) so the `x-api-key` header can never follow a 3xx to another origin (QA-3 P1, measured live).
- **`hooks remove` (P1):** resolves custom + registry-synced + bundled hooks and removes the settings registration, store dir, lock pin and DB record; non-zero + clear error when the hook exists nowhere (QA-1 BUG-A / QA-4).
- **`hooks log` (P1):** every execution (CLI run, SDK runHook, MCP run tools) writes a `hook_events` row — name, event, result, exit, ts, version+sha metadata (QA-5/QA-2, bug ef58dcb7).
- **SQLITE_BUSY (P2):** `getDb` opens with `PRAGMA busy_timeout=5000` (QA-4 bug 09094299).
- **MCP run tools (P2):** custom+registry hooks reachable; manifest `timeout_ms` honored; timeout kills the whole process group — no orphaned children; bounded pipe drain so a backgrounded child cannot hang a run (QA-4 bug 4d4c8f0b).
- **Install fail-closed (P2):** non-zero + "Nothing was registered" when every hook was refused (QA-3 P2 / QA-1 BUG-C / QA-4).
- **Pinned install/update (P2):** `hooks install/update <name>@<version>` fetches that exact version, verifies the sha against the remote lock (QA-2).
- **Install-time pinning (P2):** custom installs pin the actual installed version+sha immediately (QA-1 P3).
- **`hooks list` (P2):** surfaces custom/registry hooks with versions alongside the bundled catalog (QA-4 A1, bug e8461f89).
- **`hooks init --cloudflare` (P3):** writes `api_key_ref` (vault key NAME) into config.json (QA-3 deviation).
