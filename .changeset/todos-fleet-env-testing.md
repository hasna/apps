---
"@hasna/todos": patch
---

`@hasna/todos/testing`'s `deliverTodosApiKeyViaDisk` now delivers fixture keys
through the PRIMARY disk tier (`$HOME/.hasna/fleet-env/todos.env`) instead of
the legacy `~/.hasna/cloud` fallback. Forced by @hasna/contracts 0.14.2, which
demotes the cloud tier to a NOISY deprecated fallback: a CLI subprocess test
delivering via cloud would print the DEPRECATED notice to stderr and break
stderr-exact assertions. Consumers of the exported helper that rely on the
cloud path must migrate to fleet-env.
