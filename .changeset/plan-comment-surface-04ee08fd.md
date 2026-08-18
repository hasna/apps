---
"@hasna/todos": patch
---

Fix `todos comment <plan-id>` returning 404 "task not found": plans now have a comment surface end to end — `plan_comments` table (local sqlite) and `plan_comments` records (postgres), `/v1/plans/:id/comments` GET/POST, CLI `comment` task-first/plan-fallback (local + hosted), and `plans --show` listing plan comments. Plan-level outcomes can now be recorded on the plan row (todos task 04ee08fd).
