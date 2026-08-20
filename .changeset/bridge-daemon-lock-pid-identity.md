---
"@hasna/bridge": patch
---

fix(bridge): daemon lock recovery verifies process identity, so a recycled pid can never wedge the daemon. A crashed daemon's recorded pid can be re-used by an unrelated process; bare pid liveness then read that process as the owner and the stale lock became permanently unbreakable ("already running" forever). Ownership is now confirmed by the owner's command line (bridge bin / dist / dev entry) before a live pid protects the lock, and a stale lock whose pid belongs to an unrelated process is recovered normally. Regression test added.
