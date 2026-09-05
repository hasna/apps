import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../db/schema.js";
import { createWorkspace } from "../db/workspaces.js";
import { computeProjectContextBundleHash } from "../lib/project-context-bundle.js";
import { testSpawnEnv, withoutUnhostedNotice } from "../testing/spawn-env.js";
import type { JsonObject } from "../types/workspace.js";

const CLI_PATH = join(process.cwd(), "src/cli/index.ts");
type ContextBundle = Parameters<typeof computeProjectContextBundleHash>[0];

function runProjects(args: string[], env: Record<string, string> = {}) {
  return Bun.spawnSync({
    cmd: ["bun", "run", CLI_PATH, ...args],
    stdout: "pipe",
    stderr: "pipe",
    env: testSpawnEnv({ WORKSPACES_AGENT_MOCK: "1", ...env }),
  });
}

function text(bytes: Uint8Array): string {
  // The unhosted-mode notice is a required, deliberate line; it is not part of
  // what any command under test writes, so it is stripped here and asserted
  // directly where it IS the subject.
  return withoutUnhostedNotice(Buffer.from(bytes).toString("utf-8"));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function expectedHash(bundle: Record<string, unknown>): string {
  const { generated_at: _generatedAt, hash: _hash, ...allowlisted } = bundle;
  return `sha256:${createHash("sha256").update(stableStringify(allowlisted)).digest("hex")}`;
}

function fixture(options: { name?: string; slug?: string; metadata?: JsonObject } = {}) {
  const root = mkdtempSync(join(tmpdir(), "projects-context-bundle-"));
  const dbPath = join(root, "projects.db");
  const projectPath = join(root, "canonical-project");
  mkdirSync(projectPath, { recursive: true });

  const db = new Database(dbPath);
  db.run("PRAGMA foreign_keys=ON");
  runMigrations(db);
  const project = createWorkspace({
    id: "wks_context_bundle_fixture",
    name: options.name ?? "Context Bundle Fixture",
    slug: options.slug ?? "context-bundle-fixture",
    kind: "project",
    primary_path: projectPath,
    metadata: options.metadata,
    integrations: {
      todos_project_id: "todos-project-123",
      todos_task_list_id: "todos-list-456",
      conversations_channel: "context-bundle-fixture",
      mementos_project_id: "mementos-project-789",
      mementos_scope: "context-bundle-fixture",
    },
  }, db);
  db.run(
    "UPDATE workspaces SET canonical_machine = ?, updated_at = ? WHERE id = ?",
    ["station02", "2026-08-08 09:10:11.123", project.id],
  );
  db.close();

  return {
    root,
    dbPath,
    projectId: project.id,
    projectSlug: project.slug,
    projectPath,
    env: {
      HASNA_PROJECTS_DB_PATH: dbPath,
      HASNA_MACHINE_ID: "machine-test-123",
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe("projects context-bundle", () => {
  test("emits the strict Instructions v3 bundle for an exact project id", () => {
    const fx = fixture();
    try {
      const result = runProjects(["context-bundle", fx.projectId, "--json"], fx.env);
      expect(result.exitCode).toBe(0);
      expect(text(result.stderr)).toBe("");

      const bundle = JSON.parse(text(result.stdout)) as Record<string, unknown> & {
        hash: string;
        commands: Array<{ name: string; argv: string[] }>;
      };
      expect(Object.keys(bundle).sort()).toEqual([
        "authority",
        "commands",
        "freshness",
        "generated_at",
        "hash",
        "links",
        "project",
        "resolution",
        "revision",
        "schema",
        "station",
      ]);
      expect(bundle.schema).toBe("hasna.projects.project_context_bundle.v3");
      expect(bundle.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(bundle.revision).toBe("2026-08-08T09:10:11.123Z");
      expect(bundle.freshness).toBe("fresh");
      expect(bundle.resolution).toEqual({
        source: "id-or-slug",
        conflict: false,
        create_allowed: false,
      });
      expect(bundle.authority).toEqual({
        owner: "projects",
        transport: "local",
        availability: "available",
      });
      expect(bundle.project).toEqual({
        id: fx.projectId,
        slug: fx.projectSlug,
        name: "Context Bundle Fixture",
        kind: "project",
        status: "active",
        path: fx.projectPath,
        updated_at: "2026-08-08T09:10:11.123Z",
      });
      expect(bundle.links).toEqual({
        todos: {
          state: "linked",
          project_id: "todos-project-123",
          task_list_id: "todos-list-456",
        },
        conversations: {
          state: "linked",
          channel: "context-bundle-fixture",
        },
        mementos: {
          state: "linked",
          project_id: "mementos-project-789",
          scope: "context-bundle-fixture",
        },
      });
      expect(bundle.station).toEqual({
        station_id: "station02",
        machine_id: "machine-test-123",
      });
      expect(bundle.commands).toEqual(
        ["show", "context", "why", "context-bundle"].map((name) => ({
          name,
          argv: ["projects", name, fx.projectId, "--json"],
        })),
      );
      expect(bundle.hash).toBe(expectedHash(bundle));
    } finally {
      fx.cleanup();
    }
  });

  test("exposes the synthetic Monthly Filing finance authority contract on exact-id readback", () => {
    const fx = fixture({
      name: "Monthly Filing",
      slug: "monthly-filing",
      metadata: {
        business_area: "finance",
        jurisdiction: "RO",
        legal_entities: ["Example Alpha SRL"],
        fiscal_cycle: "monthly",
        data_classification: "restricted",
        retention_policy: "knowledge:finance-retention-v1",
        ledger_authority: "@hasna/accounting",
        evidence_store: "@hasna/files",
        approver: "role:finance-controller",
        external_recipient_policy: "@hasna/invoices:approved-recipient-only",
      },
    });
    try {
      const result = runProjects(["context-bundle", fx.projectId, "--json"], fx.env);
      expect(result.exitCode).toBe(0);
      expect(text(result.stderr)).toBe("");

      const bundle = JSON.parse(text(result.stdout)) as {
        schema: string;
        project: Record<string, unknown>;
      };
      expect(bundle.schema).toBe("hasna.projects.project_context_bundle.v3");
      expect(bundle.project["id"]).toBe(fx.projectId);
      expect(bundle.project["slug"]).toBe("monthly-filing");
      expect(bundle.project["finance"]).toEqual({
        schema: "hasna.projects.finance_project_metadata.v1",
        business_area: "finance",
        jurisdiction: "RO",
        legal_entities: ["Example Alpha SRL"],
        fiscal_cycle: "monthly",
        data_classification: "restricted",
        retention_policy: "knowledge:finance-retention-v1",
        ledger_authority: "@hasna/accounting",
        evidence_store: "@hasna/files",
        approver: "role:finance-controller",
        external_recipient_policy: "@hasna/invoices:approved-recipient-only",
      });
    } finally {
      fx.cleanup();
    }
  });

  test("emits generic authority-like metadata without activating finance validation", () => {
    const fx = fixture({
      metadata: {
        approver: "role:release-manager",
        evidence_store: "shared-project-files",
        jurisdiction: "global",
        retention_policy: "standard-project-retention",
        data_classification: "internal",
      },
    });
    try {
      const result = runProjects(["context-bundle", fx.projectId, "--json"], fx.env);
      expect(result.exitCode).toBe(0);
      expect(text(result.stderr)).toBe("");
      const bundle = JSON.parse(text(result.stdout)) as {
        project: Record<string, unknown>;
      };
      expect(bundle.project["finance"]).toBeUndefined();
    } finally {
      fx.cleanup();
    }
  });

  test("keeps every accepted boundary finance profile within the bundle byte limit", () => {
    const fx = fixture({
      metadata: {
        business_area: "finance",
        jurisdiction: "RO",
        legal_entities: Array.from(
          { length: 8 },
          (_, index) => `${String(index).padStart(3, "0")}-${"e".repeat(252)}`,
        ),
        fiscal_cycle: "monthly",
        data_classification: "restricted",
        retention_policy: `knowledge:${"r".repeat(288)}`,
        ledger_authority: `authority:${"l".repeat(288)}`,
        evidence_store: `store:${"e".repeat(292)}`,
        approver: `role:${"a".repeat(294)}`,
        external_recipient_policy: `policy:${"p".repeat(292)}`,
      },
    });
    try {
      const result = runProjects(["context-bundle", fx.projectId, "--json"], fx.env);
      expect(result.exitCode).toBe(0);
      expect(text(result.stderr)).toBe("");
      const bundle = JSON.parse(text(result.stdout)) as {
        project: { finance: Record<string, unknown> };
      };
      expect(Buffer.byteLength(JSON.stringify(bundle.project.finance), "utf8")).toBeGreaterThan(3_800);
      expect(Buffer.byteLength(text(result.stdout), "utf8")).toBeLessThanOrEqual(8 * 1024);
    } finally {
      fx.cleanup();
    }
  });

  test("rejects the reviewer maximum-size finance profile before context readback", () => {
    const legalEntities = Array.from(
      { length: 100 },
      (_, index) => `${String(index).padStart(3, "0")}-${"x".repeat(252)}`,
    );
    expect(() => fixture({
      metadata: {
        business_area: "finance",
        jurisdiction: "RO",
        legal_entities: legalEntities,
        fiscal_cycle: "monthly",
        data_classification: "restricted",
        retention_policy: "knowledge:finance-retention-v1",
        ledger_authority: "@hasna/accounting",
        evidence_store: "@hasna/files",
        approver: "role:finance-controller",
        external_recipient_policy: "@hasna/invoices:approved-recipient-only",
      },
    })).toThrow(/exceeds .* context budget/i);
  });

  test("rejects a slug even when it resolves to the same project", () => {
    const fx = fixture();
    try {
      const result = runProjects(["context-bundle", fx.projectSlug, "--json"], fx.env);
      expect(result.exitCode).toBe(1);
      expect(text(result.stdout)).toBe("");
      expect(text(result.stderr)).toContain("context-bundle requires an exact project id");
    } finally {
      fx.cleanup();
    }
  });

  test("keeps the hash stable across generation times but changes it for durable payload changes", () => {
    const fx = fixture();
    try {
      const result = runProjects(["context-bundle", fx.projectId, "--json"], fx.env);
      expect(result.exitCode).toBe(0);
      expect(text(result.stderr)).toBe("");

      const original = JSON.parse(text(result.stdout)) as ContextBundle;
      const regenerated: ContextBundle = {
        ...original,
        generated_at: "2026-08-08T00:00:00.000Z",
      };
      const changed: ContextBundle = {
        ...regenerated,
        project: {
          ...regenerated.project,
          name: "Changed Durable Project Name",
        },
      };

      expect(computeProjectContextBundleHash(regenerated)).toBe(
        computeProjectContextBundleHash(original),
      );
      expect(computeProjectContextBundleHash(changed)).not.toBe(
        computeProjectContextBundleHash(original),
      );
    } finally {
      fx.cleanup();
    }
  });

  test("rejects credential-like project data before hashing or output", () => {
    const fx = fixture({ name: `Unsafe ${"api" + "_key"}=fixture` });
    try {
      const result = runProjects(["context-bundle", fx.projectId, "--json"], fx.env);
      expect(result.exitCode).toBe(1);
      expect(text(result.stdout)).toBe("");
      expect(text(result.stderr)).toContain("credential-like or URL content is forbidden");
    } finally {
      fx.cleanup();
    }
  });
});
