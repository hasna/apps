process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { beforeEach, describe, expect, test } from "bun:test";
import { resetDatabase } from "../db/database.js";
import { createMemory } from "../db/memories.js";
import { registerProject } from "../db/projects.js";
import { createSessionJob } from "../db/session-jobs.js";
import {
  MementosProjectResourceError,
  getMementosProjectResourceExact,
  readAllMementosProjectResources,
  readMementosProjectResourcePage,
} from "./project-resources.js";

const identity = {
  authorityId: "mementos-test-authority",
  tenantId: "tenant-test",
  corpusId: "corpus-test",
};

beforeEach(() => {
  resetDatabase();
});

describe("Mementos project resource producer", () => {
  test("pages a complete stable-ID population without duplicates and excludes unrelated rows", () => {
    const project = registerProject("Dubai Fraud", "/projects/dubai-fraud");
    const knowledge = createMemory({
      key: "dubai-knowledge",
      value: "Knowledge row",
      category: "knowledge",
      project_id: project.id,
    });
    const memory = createMemory({
      key: "dubai-history",
      value: "History row",
      category: "history",
      project_id: project.id,
    });
    createMemory({
      key: "unrelated",
      value: "Must stay outside the project collection",
      category: "knowledge",
    });
    const session = createSessionJob({
      session_id: "dubai-session",
      transcript: "session transcript",
      project_id: project.id,
    });

    const first = readMementosProjectResourcePage(
      project.id,
      { limit: 2 },
      undefined,
      identity,
    );
    expect(first.authority).toMatchObject({
      authority_id: identity.authorityId,
      tenant_id: identity.tenantId,
      corpus_id: identity.corpusId,
    });
    expect(first).toMatchObject({
      schema: "mementos.project-resources.v1",
      project_id: project.id,
      count: 2,
      total: 4,
      has_more: true,
      complete: true,
      truncated: false,
    });
    expect(first.next_cursor).toEqual(expect.any(String));

    const second = readMementosProjectResourcePage(
      project.id,
      { limit: 2, cursor: first.next_cursor! },
      undefined,
      identity,
    );
    expect(second).toMatchObject({
      count: 2,
      total: 4,
      has_more: false,
      next_cursor: null,
      complete: true,
      truncated: false,
      collection_revision: first.collection_revision,
    });

    const resources = [...first.resources, ...second.resources];
    expect(new Set(resources.map((resource) =>
      `${resource.resource_kind}:${resource.stable_id}`,
    )).size).toBe(4);
    expect(resources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resource_kind: "project",
        stable_id: project.id,
        membership: "project_aggregate",
      }),
      expect.objectContaining({
        resource_kind: "knowledge",
        stable_id: knowledge.id,
        membership: "explicit_project_id_or_focus",
      }),
      expect.objectContaining({
        resource_kind: "memory",
        stable_id: memory.id,
        membership: "explicit_project_id_or_focus",
      }),
      expect.objectContaining({
        resource_kind: "session",
        stable_id: session.id,
        membership: "explicit_project_id_or_focus",
      }),
    ]));
  });

  test("fresh traversal includes later explicit children and keeps global rows out", () => {
    const project = registerProject("Later Children", "/projects/later-children");
    const before = readAllMementosProjectResources(
      project.id,
      { page_size: 1 },
      undefined,
      identity,
    );
    expect(before.resources.map((resource) => resource.resource_kind)).toEqual([
      "project",
    ]);

    const later = createMemory({
      key: "later-project-memory",
      value: "Joined by explicit project_id",
      category: "fact",
      project_id: project.id,
    });
    createMemory({
      key: "later-global-memory",
      value: "No project_id means no membership",
      category: "fact",
    });

    const after = readAllMementosProjectResources(
      project.id,
      { page_size: 1 },
      undefined,
      identity,
    );
    expect(after.resources.map((resource) => resource.stable_id)).toEqual([
      project.id,
      later.id,
    ]);
    expect(after).toMatchObject({
      count: 2,
      total: 2,
      has_more: false,
      next_cursor: null,
      complete: true,
      truncated: false,
    });
  });

  test("a cursor refuses a changed collection instead of silently losing a child", () => {
    const project = registerProject("Cursor Guard", "/projects/cursor-guard");
    createMemory({
      key: "first",
      value: "first",
      category: "knowledge",
      project_id: project.id,
    });
    const first = readMementosProjectResourcePage(
      project.id,
      { limit: 1 },
      undefined,
      identity,
    );

    createMemory({
      key: "later",
      value: "later",
      category: "knowledge",
      project_id: project.id,
    });

    expect(() => readMementosProjectResourcePage(
      project.id,
      { limit: 1, cursor: first.next_cursor! },
      undefined,
      identity,
    )).toThrow(MementosProjectResourceError);
    expect(() => readMementosProjectResourcePage(
      project.id,
      { limit: 1, cursor: first.next_cursor! },
      undefined,
      identity,
    )).toThrow(/collection changed/i);
  });

  test("exact readback round-trips the stable ID and fails across projects", () => {
    const project = registerProject("Exact Read", "/projects/exact-read");
    const other = registerProject("Other", "/projects/other");
    const memory = createMemory({
      key: "exact-memory",
      value: "exact",
      category: "procedural",
      project_id: project.id,
    });

    expect(getMementosProjectResourceExact(
      project.id,
      "memory",
      memory.id,
      undefined,
      identity,
    )).toMatchObject({
      project_id: project.id,
      resource: {
        resource_kind: "memory",
        stable_id: memory.id,
      },
    });

    expect(() => getMementosProjectResourceExact(
      other.id,
      "memory",
      memory.id,
      undefined,
      identity,
    )).toThrow(/not found/i);
  });
});
