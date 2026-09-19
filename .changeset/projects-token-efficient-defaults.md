---
"@hasna/projects": minor
---

Default Projects CLI and MCP discovery to compact bounded output. `projects list --json`, `--meta`, and `projects_list` now return minified 25-row pages under a 32 KiB ceiling with truthful totals and opaque collection/filter-bound continuation metadata that refuses insert/delete/reorder drift; explicit `--full`, `full=true`, or full detail preserve complete record access. Add a 20-tool default MCP core profile with bounded `search_tools`/`describe_tools`, while the explicit full profile preserves the complete compatibility inventory. Root, recipe, agent, tmux-profile, location, doctor, event, and lock collections now default to compact snapshot-fingerprinted paged responses with explicit full compatibility switches.
