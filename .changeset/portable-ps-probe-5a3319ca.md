---
"@hasna/dispatch": patch
---

portable process-group ps probe — replace the GNU-only `--forest` flag with `ps -g` process-group selection so bun/secrets-exec-wrapped Claude Code panes are recognized on BSD/macOS hosts too (bug 5a3319ca). BSD ps rejects `--forest` ("illegal option"), the fallback `-p` showed only the wrapper row, and dispatch refused the pane ("target is not a recognized agent composer (bun)").
