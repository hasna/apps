---
"@hasna/economy": patch
---

Remove the bundled cost web dashboard (dashboard/) and all of its wiring: the shipped `dashboard/dist` files entry, the dashboard build step, the `build:dashboard` script, the Dockerfile/CI dashboard steps, the `economy dashboard` CLI command, and the serve server's static-file/SPA fallback — unknown non-API routes now 404. CLI, MCP, REST API, SDK, and menubar surfaces are unchanged.