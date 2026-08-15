# Local Audit Ledger

The local audit ledger builds a deterministic SHA-256 hash chain over existing
local evidence:

- task history rows
- task verification records
- run events, commands, and artifacts
- approval gate checkpoints
- handoff records that reference the scoped task or run

Create and verify checkpoints:

```bash
todos audit-ledger show --task <task-id> --entries --json
todos audit-ledger seal release-checkpoint --task <task-id> --json
todos audit-ledger verify release-checkpoint --json
todos audit-ledger list --json
```

MCP clients use `get_audit_ledger`, `seal_audit_ledger`,
`list_audit_ledger_checkpoints`, and `verify_audit_ledger`.

## Threat Model

This feature is tamper-evident, not tamper-proof. A sealed checkpoint lets an
agent detect that local evidence changed after the checkpoint was created. It
does not prevent a local user from deleting both the database evidence and the
checkpoint config. For stronger guarantees, export or back up the checkpoint
outside the workspace after sealing it.

The ledger is local-only. It does not call hosted services, upload evidence, or
store secrets. Evidence payloads pass through the existing redaction layer before
hash metadata is returned.
