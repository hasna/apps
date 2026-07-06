import { Command } from "commander";
import { runAndEmit } from "./context.js";
import type { OperationInput } from "../services/registry.js";

/**
 * One command namespace per domain resource. Every CLI subcommand maps to a
 * registry op, so CLI parity with MCP/API holds by construction.
 */

interface OptSpec {
  flag: string;
  key: string;
  /** parse comma list into array */
  list?: boolean;
  /** parse into number */
  num?: boolean;
}

interface CliOp {
  name: string;
  op: string;
  description: string;
  options: OptSpec[];
}

interface Namespace {
  name: string;
  description: string;
  ops: CliOp[];
}

const ID: OptSpec = { flag: "--id <id>", key: "id" };
const REASON: OptSpec = { flag: "--reason <text>", key: "reason" };
const ENTITY: OptSpec = { flag: "--entity-id <uuid>", key: "entity_id" };
const IDENTITY: OptSpec = { flag: "--identity-id <id>", key: "identity_id" };
const LIMIT: OptSpec = { flag: "--limit <n>", key: "limit", num: true };
const STATUS: OptSpec = { flag: "--status <status>", key: "status" };

const NAMESPACES: Namespace[] = [
  {
    name: "identity",
    description: "Manage non-human identities",
    ops: [
      { name: "create", op: "identity.create", description: "Register an identity", options: [ENTITY, { flag: "--kind <kind>", key: "kind" }, { flag: "--name <name>", key: "name" }, { flag: "--owner-ref <ref>", key: "owner_ref" }, { flag: "--entity-slug <slug>", key: "entity_slug" }] },
      { name: "get", op: "identity.get", description: "Get an identity", options: [ID] },
      { name: "list", op: "identity.list", description: "List identities", options: [ENTITY, { flag: "--kind <kind>", key: "kind" }, STATUS, LIMIT] },
      { name: "update", op: "identity.update", description: "Update an identity", options: [ID, { flag: "--name <name>", key: "name" }, { flag: "--owner-ref <ref>", key: "owner_ref" }] },
      { name: "suspend", op: "identity.suspend", description: "Suspend an identity", options: [ID] },
      { name: "retire", op: "identity.retire", description: "Retire an identity", options: [ID] },
    ],
  },
  {
    name: "credential",
    description: "Manage credential references (never values)",
    ops: [
      { name: "register", op: "credential.register", description: "Register a credential reference", options: [IDENTITY, { flag: "--name <name>", key: "name" }, { flag: "--kind <kind>", key: "kind" }, { flag: "--secret-ref <ref>", key: "secret_ref" }] },
      { name: "get", op: "credential.get", description: "Get a credential", options: [ID] },
      { name: "list", op: "credential.list", description: "List credentials", options: [IDENTITY, ENTITY, STATUS, LIMIT] },
      { name: "revoke", op: "credential.revoke", description: "Revoke a credential", options: [ID, REASON] },
    ],
  },
  {
    name: "scope",
    description: "Manage MCP tool scope grants",
    ops: [
      { name: "grant", op: "scope.grant", description: "Grant an MCP tool scope", options: [IDENTITY, { flag: "--scope <scope>", key: "scope" }] },
      { name: "get", op: "scope.get", description: "Get a scope grant", options: [ID] },
      { name: "list", op: "scope.list", description: "List scope grants", options: [IDENTITY, ENTITY, STATUS, LIMIT] },
      { name: "revoke", op: "scope.revoke", description: "Revoke a scope grant", options: [ID, REASON] },
      { name: "effective", op: "scope.effective", description: "Effective scopes for an identity", options: [IDENTITY] },
    ],
  },
  {
    name: "elevation",
    description: "Manage just-in-time elevations",
    ops: [
      { name: "request", op: "elevation.request", description: "Request a JIT elevation", options: [IDENTITY, { flag: "--scope <scope>", key: "scope" }, REASON, { flag: "--ttl-minutes <n>", key: "ttl_minutes", num: true }] },
      { name: "approve", op: "elevation.approve", description: "Approve an elevation", options: [ID, { flag: "--approver <who>", key: "approver" }] },
      { name: "get", op: "elevation.get", description: "Get an elevation", options: [ID] },
      { name: "list", op: "elevation.list", description: "List elevations", options: [IDENTITY, ENTITY, STATUS, LIMIT] },
      { name: "revoke", op: "elevation.revoke", description: "Revoke an elevation", options: [ID, REASON] },
      { name: "expire", op: "elevation.expire", description: "Sweep expired elevations", options: [] },
    ],
  },
  {
    name: "review",
    description: "Manage access recertification reviews",
    ops: [
      { name: "schedule", op: "review.schedule", description: "Schedule a review", options: [ENTITY, { flag: "--name <name>", key: "name" }, { flag: "--scheduled-at <iso>", key: "scheduled_at" }, { flag: "--due-at <iso>", key: "due_at" }, { flag: "--scope-filter <f>", key: "scope_filter" }] },
      { name: "get", op: "review.get", description: "Get a review", options: [ID] },
      { name: "list", op: "review.list", description: "List reviews", options: [ENTITY, STATUS, LIMIT] },
      { name: "start", op: "review.start", description: "Start a review", options: [ID] },
      { name: "complete", op: "review.complete", description: "Complete a review", options: [ID, { flag: "--completed-by <who>", key: "completed_by" }] },
      { name: "cancel", op: "review.cancel", description: "Cancel a review", options: [ID] },
    ],
  },
  {
    name: "revocation",
    description: "One-click, audited revocation",
    ops: [
      { name: "execute", op: "revocation.execute", description: "Execute a revocation", options: [IDENTITY, { flag: "--target-type <type>", key: "target_type" }, { flag: "--target-id <id>", key: "target_id" }, REASON] },
      { name: "list", op: "revocation.list", description: "List revocations", options: [IDENTITY, ENTITY, LIMIT] },
    ],
  },
  {
    name: "token",
    description: "Issue and verify MCP bearer tokens",
    ops: [
      { name: "issue", op: "token.issue", description: "Issue a bearer token", options: [IDENTITY, { flag: "--scopes <list>", key: "scopes", list: true }, { flag: "--entity-ids <list>", key: "entity_ids", list: true }, { flag: "--credential-id <id>", key: "credential_id" }, { flag: "--ttl-minutes <n>", key: "ttl_minutes", num: true }] },
      { name: "verify", op: "token.verify", description: "Verify a bearer token", options: [{ flag: "--token <token>", key: "token" }] },
      { name: "get", op: "token.get", description: "Get an issued token record", options: [ID] },
      { name: "list", op: "token.list", description: "List issued tokens", options: [IDENTITY, ENTITY, STATUS, LIMIT] },
      { name: "revoke", op: "token.revoke", description: "Revoke an issued token", options: [ID, REASON] },
    ],
  },
  {
    name: "audit",
    description: "Inspect the append-only audit log",
    ops: [
      { name: "list", op: "audit.list", description: "List audit events", options: [ENTITY, LIMIT] },
      { name: "verify", op: "audit.verify", description: "Verify the audit hash chain", options: [] },
    ],
  },
];

function buildInput(op: CliOp, opts: Record<string, unknown>): OperationInput {
  const input: OperationInput = {};
  for (const spec of op.options) {
    const camel = spec.key.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
    const value = opts[camel];
    if (value === undefined) continue;
    if (spec.list) input[spec.key] = String(value).split(",").map((s) => s.trim()).filter(Boolean);
    else if (spec.num) input[spec.key] = Number(value);
    else input[spec.key] = value;
  }
  return input;
}

export function registerNamespaces(program: Command): void {
  for (const ns of NAMESPACES) {
    const nsCommand = new Command(ns.name).description(ns.description);
    for (const op of ns.ops) {
      const sub = new Command(op.name).description(op.description);
      for (const spec of op.options) sub.option(spec.flag);
      sub.option("--json", "Output JSON");
      sub.action((opts: Record<string, unknown>) => {
        runAndEmit(op.op, buildInput(op, opts));
      });
      nsCommand.addCommand(sub);
    }
    program.addCommand(nsCommand);
  }
}
