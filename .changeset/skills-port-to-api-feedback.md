---
"@hasna/skills": minor
---

`skills feedback` and the MCP `send_feedback` tool now reach the instance
(hosted `/api/v1/feedback`).

- New hosted route `POST /api/v1/feedback` (stores the report and answers it
  with its id) and `GET /api/v1/feedback?limit=` (the organization's reports,
  newest first). Both sit behind the same bearer-key gate and org scoping as
  every other `/api/v1` surface, and are backed by a real `skills_feedback`
  table in both dialects (migration `0007_hosted_feedback`), so a report is a
  row that reads back rather than a local file.
- `skills feedback` and `send_feedback` POST to that route on any install with
  a resolved Skills credential. They used to have no hosted path at all: a
  keyed station appended the report to `~/.hasna/skills/feedback.jsonl` and a
  local install inserted it into `~/.hasna/skills/skills.db`, and both printed
  "saved" for a message nobody who could act on it would ever read.
- An instance too old for the route is reported as version skew, never as a
  successful send, and an unconfigured install fails closed rather than writing
  this machine. The SQLite arm remains reachable only under the explicit local
  opt-in (`HASNA_SKILLS_LOCAL=1`), and `bun:sqlite` is now loaded lazily by that
  arm alone instead of being imported at module scope by the CLI and MCP bins.
- New `RemoteSkillsClient.sendFeedback()` / `.listFeedback()`.
