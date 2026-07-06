import { z } from "zod";
import { verifyAuditChain } from "../../db/audit.js";
import { seedDemo } from "../fixtures-seed.js";
import type { OpDef } from "../op-types.js";
import { storagePull, storagePush, storageStatus, storageSync } from "../storage-ops.js";

export const platformOps: OpDef[] = [
  {
    op: "demo.seed",
    summary: "Seed the demo consolidation group (entities, FX, GL imports, COA mappings).",
    action: "write",
    scope: "consolidations:write",
    input: z.object({ period: z.string().optional() }).strip(),
    http: { method: "POST", pathTemplate: "/v1/demo/seed", toPath: () => "/v1/demo/seed", bodyKeys: ["period"] },
    cli: { path: ["demo", "seed"], toArgs: (i) => (i.period ? ["--period", String(i.period)] : []) },
    mcpTool: "seed_demo",
    parity: false,
    profiles: ["standard", "full"],
    mutating: true,
    async handler(ctx, input) {
      return seedDemo(ctx.store, input.period ? String(input.period) : undefined);
    },
  },
  {
    op: "audit.list",
    summary: "List the append-only audit chain and verify its integrity.",
    action: "export",
    scope: "consolidations:export",
    input: z.object({}).strip(),
    http: { method: "GET", pathTemplate: "/v1/audit", toPath: () => "/v1/audit" },
    cli: { path: ["audit", "list"], toArgs: () => [] },
    mcpTool: "list_audit",
    profiles: ["standard", "full"],
    mutating: false,
    async handler(ctx) {
      const events = await ctx.store.listAudit();
      return { events, verification: verifyAuditChain(events) };
    },
  },
  {
    op: "audit.verify",
    summary: "Verify the append-only audit hash chain has not been tampered with.",
    action: "export",
    scope: "consolidations:export",
    input: z.object({}).strip(),
    http: { method: "GET", pathTemplate: "/v1/audit/verify", toPath: () => "/v1/audit/verify" },
    cli: { path: ["audit", "verify"], toArgs: () => [] },
    mcpTool: "verify_audit",
    profiles: ["full"],
    mutating: false,
    async handler(ctx) {
      const events = await ctx.store.listAudit();
      return verifyAuditChain(events);
    },
  },
  {
    op: "storage.status",
    summary: "Redacted storage status (no DSN/secret material).",
    action: "read",
    scope: "storage:admin",
    input: z.object({}).strip(),
    http: { method: "GET", pathTemplate: "/v1/storage/status", toPath: () => "/v1/storage/status" },
    cli: { path: ["storage", "status"], toArgs: () => [] },
    mcpTool: "consolidations_storage_status",
    profiles: ["minimal", "standard", "full"],
    mutating: false,
    async handler(ctx) {
      return storageStatus(ctx.store);
    },
  },
  {
    op: "storage.push",
    summary: "Push local rows to cloud Postgres (audit tables excluded).",
    action: "admin",
    scope: "storage:admin",
    input: z.object({}).strip(),
    http: { method: "POST", pathTemplate: "/v1/storage/push", toPath: () => "/v1/storage/push" },
    cli: { path: ["storage", "push"], toArgs: () => [] },
    mcpTool: "consolidations_storage_push",
    parity: false,
    profiles: ["standard", "full"],
    mutating: true,
    async handler() {
      return storagePush();
    },
  },
  {
    op: "storage.pull",
    summary: "Pull cloud Postgres rows into local SQLite (audit tables excluded).",
    action: "admin",
    scope: "storage:admin",
    input: z.object({}).strip(),
    http: { method: "POST", pathTemplate: "/v1/storage/pull", toPath: () => "/v1/storage/pull" },
    cli: { path: ["storage", "pull"], toArgs: () => [] },
    mcpTool: "consolidations_storage_pull",
    parity: false,
    profiles: ["standard", "full"],
    mutating: true,
    async handler() {
      return storagePull();
    },
  },
  {
    op: "storage.sync",
    summary: "Push then pull between local SQLite and cloud Postgres (audit excluded).",
    action: "admin",
    scope: "storage:admin",
    input: z.object({}).strip(),
    http: { method: "POST", pathTemplate: "/v1/storage/sync", toPath: () => "/v1/storage/sync" },
    cli: { path: ["storage", "sync"], toArgs: () => [] },
    mcpTool: "consolidations_storage_sync",
    parity: false,
    profiles: ["standard", "full"],
    mutating: true,
    async handler() {
      return storageSync();
    },
  },
];
