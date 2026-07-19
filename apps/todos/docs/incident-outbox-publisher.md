# Incident outbox publisher

`todos incidents outbox-publish` is an explicit, bounded, one-shot operator command. It is not a daemon, scheduler, watcher, or agent launcher. Each invocation claims one event at a time, fully settles it, and only then claims the next event up to `--limit`.

The command requires the canonical remote Todos authority selected with `HASNA_TODOS_STORAGE_MODE=remote` (or another supported remote mode), `HASNA_TODOS_API_URL`, and `HASNA_TODOS_API_KEY`. Publishing and status inspection use the narrow `todos:incident-project` scope; dead-letter inspection and requeue use `todos:incident-recover`. These two-segment scopes are the canonical forms accepted by the shared API-key minting and verification contract. Delivery additionally requires `HASNA_CONVERSATIONS_API_URL` and a narrowly scoped `HASNA_CONVERSATIONS_API_KEY` with `conversations:incident-project`. The publisher never requires Conversations read permission: ambiguous delivery is reconciled by replaying the same idempotent POST.

Inspect without claiming or resolving Conversations credentials:

```sh
todos --json incidents outbox-publish --dry-run
todos --json incidents outbox-status
todos --json incidents outbox-dead --limit 10
```

Run one bounded delivery pass:

```sh
todos --json incidents outbox-publish \
  --limit 10 \
  --lease-seconds 60 \
  --timeout-ms 10000
```

The lease must cover two projector POST windows, two idempotent Todos ACK windows, and a safety margin. Configuration is rejected before claim when that budget is unsafe. The claimed event's actual remaining server lease is checked again before any projector POST.

Exit status is zero only for a successful inspection, no work, or a pass in which every claimed event was acknowledged. Projector failure, malformed responses, unsettled fail/ACK state, insufficient remaining lease, timeout, and transport uncertainty exit nonzero with a structured secret-safe result. The command never emits lease tokens, API keys, response bodies, or raw transport errors.

Recovery remains explicit. Three identical recorded failure classes are dead-lettered by the Todos outbox contract. Inspect with `outbox-dead` or `outbox-show`, then use `outbox-requeue` with the exact attempt count, an idempotency key, and an audit reason. A replayed Conversations projection is accepted only when its immutable identity, canonical payload, payload hash, and message identity match exactly.
