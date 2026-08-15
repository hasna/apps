# Local Review Queues

Review queues are local task review workflows for agents and humans. They add a
queue, reviewer, claim holder, requested changes, and approval history around
the existing task review contract without requiring hosted accounts or cloud
routing.

## CLI

Create a local routing rule:

```bash
todos reviews rules set security \
  --queue security-review \
  --reviewers reviewer \
  --tags security \
  --priorities high \
  --json
```

Request, claim, return, reopen, and approve review:

```bash
todos reviews request <task-id> --requester codex --reason "security-sensitive change" --json
todos reviews claim <task-id> --reviewer reviewer --json
todos reviews return <task-id> --reviewer reviewer --changes "Add tests;Record verification" --json
todos reviews reopen <task-id> --reviewer reviewer --json
todos reviews approve <task-id> --reviewer reviewer --json
```

List queue items and rules:

```bash
todos reviews list --queue security-review --json
todos reviews rules list --json
todos reviews rules remove security --json
```

## MCP

The MCP server exposes matching local tools:

- `list_review_queue`
- `request_review_queue`
- `claim_review_item`
- `return_review_item`
- `approve_review_item`
- `reopen_review_item`
- `set_review_routing_rule`
- `list_review_routing_rules`
- `remove_review_routing_rule`

The JSON outputs validate against `local_review_queue_item` and
`review_routing_rule`.

## Routing

Rules are stored in local config under `review_routing_rules`. A rule can match
task tags, priorities, and an optional project. The first matching rule supplies
the default queue and reviewer. Explicit CLI or MCP arguments can still override
the queue or reviewer for one request.

Completed tasks that require approval and completed tasks with low confidence
also appear in queue views, so agents can discover review work even when a task
was not explicitly requested.

## Events

Queue transitions are written to task audit history and delivered through local
event hooks:

- `review.requested`
- `review.claimed`
- `review.returned`
- `review.approved`
- `review.reopened`

Hook delivery uses the local event hook system. It does not call hosted
webhooks, hosted queues, or cloud automation.
