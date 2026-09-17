import { describe, expect, test } from "bun:test";
import {
  buildBoundedProjectListOutput,
  buildProjectListEnvelope,
  projectListRow,
  resolveProjectListFields,
  stringifyProjectListOutput,
} from "./project-list-output.js";
import type { Workspace } from "../types/workspace.js";

const project: Workspace = {
  id: "wks_compact1",
  slug: "compact-project",
  name: "Compact Project",
  description: "A project with deliberately large fields outside the compact projection.",
  kind: "project",
  status: "active",
  root_id: "root_1",
  recipe_id: null,
  canonical_machine: "machine001",
  primary_path: "/srv/projects/compact-project",
  git_remote: "git@example.test:compact-project.git",
  s3_bucket: null,
  s3_prefix: null,
  tags: ["alpha", "beta"],
  integrations: { large: "x".repeat(2_000) },
  metadata: { large: "y".repeat(2_000) },
  last_opened_at: null,
  created_at: "2026-09-17T00:00:00.000Z",
  updated_at: "2026-09-17T01:00:00.000Z",
  synced_at: null,
};

describe("project list machine output", () => {
  test("maps primary_path to path and keeps the default compact row small", () => {
    const row = projectListRow(project);
    expect(row).toEqual({
      id: project.id,
      slug: project.slug,
      name: project.name,
      status: project.status,
      kind: project.kind,
      path: project.primary_path,
    });
    expect(Buffer.byteLength(JSON.stringify(row))).toBeLessThan(256);
  });

  test("validates fields and always retains the stable id", () => {
    expect(resolveProjectListFields("slug,status")).toEqual(["id", "slug", "status"]);
    expect(() => resolveProjectListFields([])).toThrow(/at least one field/);
    expect(() => resolveProjectListFields("slug,secrets")).toThrow(/Unknown project list field: secrets/);
    expect(projectListRow(project, ["slug"])).toEqual({ id: project.id, slug: project.slug });
  });

  test("builds truthful continuation metadata and compact JSON by default", () => {
    const envelope = buildProjectListEnvelope({
      projects: [projectListRow(project)],
      total: 3,
      offset: 1,
      limit: 1,
      detail: "compact",
      fields: resolveProjectListFields(undefined),
      queryScope: "discovery",
      nextArguments: { query: "compact", query_scope: "discovery" },
    });
    expect(envelope).toMatchObject({
      count: 1,
      total: 3,
      offset: 1,
      limit: 1,
      next_offset: 2,
      has_more: true,
      complete: false,
      detail: "compact",
      query_scope: "discovery",
      next_arguments: {
        query: "compact",
        query_scope: "discovery",
        offset: 2,
        limit: 1,
      },
    });
    const compact = stringifyProjectListOutput(envelope);
    const pretty = stringifyProjectListOutput(envelope, true);
    expect(compact).not.toContain("\n  ");
    expect(pretty).toContain("\n  ");
    expect(Buffer.byteLength(compact)).toBeLessThan(Buffer.byteLength(pretty));
  });

  test("keeps a default 25-row agent page below the byte budget despite large source records", () => {
    const rows = Array.from({ length: 25 }, (_, index) => projectListRow({
      ...project,
      id: `wks_compact${String(index).padStart(2, "0")}`,
      slug: `compact-project-${index}`,
      name: `Compact Project ${index}`,
      primary_path: `/srv/projects/compact-project-${index}`,
      metadata: { large: "m".repeat(20_000) },
      integrations: { large: "i".repeat(20_000) },
    }));
    const output = buildBoundedProjectListOutput({
      projects: rows,
      total: 50,
      offset: 0,
      limit: 25,
      detail: "compact",
      fields: resolveProjectListFields(undefined),
      queryScope: "discovery",
    }, { maxBytes: 8_192 });
    expect(output.envelope.count).toBe(25);
    expect(output.envelope.truncated).toBe(false);
    expect(output.envelope.response_bytes).toBe(Buffer.byteLength(output.text));
    expect(output.envelope.response_bytes).toBeLessThan(8_192);
  });

  test("clips rows at a byte ceiling and advances from the last emitted row", () => {
    const rows = Array.from({ length: 8 }, (_, index) => projectListRow({
      ...project,
      id: `wks_bounded${index}`,
      slug: `bounded-${index}-${"s".repeat(80)}`,
      name: `Bounded ${index} ${"n".repeat(160)}`,
      primary_path: `/srv/${"p".repeat(180)}/${index}`,
    }));
    const output = buildBoundedProjectListOutput({
      projects: rows,
      total: 20,
      offset: 5,
      limit: 8,
      detail: "compact",
      fields: resolveProjectListFields(undefined),
      queryScope: "discovery",
      hasMore: true,
      complete: false,
      nextOffset: 13,
      nextArguments: { query: "bounded" },
    }, { maxBytes: 2_048 });
    expect(output.envelope.count).toBeGreaterThan(0);
    expect(output.envelope.count).toBeLessThan(8);
    expect(output.envelope.truncated).toBe(true);
    expect(output.envelope.truncation_reason).toBe("max_bytes");
    expect(output.envelope.next_offset).toBe(5 + output.envelope.count);
    expect(output.envelope.response_bytes).toBe(Buffer.byteLength(output.text));
    expect(output.envelope.response_bytes).toBeLessThanOrEqual(2_048);
  });

  test("refuses a single row that cannot fit instead of returning a non-advancing cursor", () => {
    const oversized = projectListRow({
      ...project,
      name: "n".repeat(4_000),
      primary_path: `/srv/${"p".repeat(4_000)}`,
    });
    expect(() => buildBoundedProjectListOutput({
      projects: [oversized],
      total: 1,
      offset: 0,
      limit: 1,
      detail: "compact",
      fields: resolveProjectListFields(undefined),
      queryScope: "discovery",
    }, { maxBytes: 1_024 })).toThrow(/One project list row exceeds/);
  });
});
