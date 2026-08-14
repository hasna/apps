import { describe, expect, mock, test } from "bun:test";
import type { MementosProjectResourcePage } from "./types.js";

const projectId = "bounded-project";
let readPage: (path: string) => MementosProjectResourcePage;

mock.module("../db/api-mode.js", () => ({
  apiJson: (_method: string, path: string) => ({
    status: 200,
    data: readPage(path),
  }),
  isApiMode: () => true,
  toQuery: (params: Record<string, unknown>) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        query.set(key, String(value));
      }
    }
    const encoded = query.toString();
    return encoded ? `?${encoded}` : "";
  },
}));

const { readAllMementosProjectResources } = await import(
  "./project-resources.js"
);

function syntheticPage(
  cursor: string | null,
  nextCursor: string | null,
): MementosProjectResourcePage {
  return {
    schema: "mementos.project-resources.v1",
    authority: {
      authority: "mementos",
      authority_id: "mementos-pagination-guard-test",
      tenant_id: "tenant-pagination-guard-test",
      corpus_id: "corpus-pagination-guard-test",
      package_version: "0.14.82-test",
    },
    project_id: projectId,
    project_revision: "2026-08-11T12:00:00.000Z",
    collection_revision: "a".repeat(64),
    resource_kinds: ["project"],
    resources: [],
    count: 0,
    total: 2,
    limit: 1,
    cursor,
    next_cursor: nextCursor,
    has_more: nextCursor !== null,
    complete: true,
    truncated: false,
  };
}

describe("readAllMementosProjectResources pagination termination", () => {
  test("rejects a repeated continuation cursor even when pages are empty", () => {
    let calls = 0;
    readPage = () => {
      calls += 1;
      if (calls > 2) {
        throw new Error("sentinel: repeated-cursor traversal attempted a third page");
      }
      return syntheticPage(calls === 1 ? null : "repeat", "repeat");
    };

    expect(() => readAllMementosProjectResources(
      projectId,
      { page_size: 1, resource_kinds: ["project"] },
    )).toThrow(/repeated a continuation cursor/i);
    expect(calls).toBe(2);
  });

  test("stops a changing cursor chain at the total-derived page bound", () => {
    let calls = 0;
    readPage = () => {
      calls += 1;
      if (calls > 2) {
        throw new Error("sentinel: changing-cursor traversal exceeded two pages");
      }
      return syntheticPage(
        calls === 1 ? null : `cursor-${calls - 1}`,
        `cursor-${calls}`,
      );
    };

    expect(() => readAllMementosProjectResources(
      projectId,
      { page_size: 1, resource_kinds: ["project"] },
    )).toThrow(/exceeded its bounded 2-page population/i);
    expect(calls).toBe(2);
  });

  test("rejects a continuation cursor when the page claims no more results", () => {
    let calls = 0;
    readPage = () => {
      calls += 1;
      if (calls > 2) {
        throw new Error("sentinel: false-has-more traversal exceeded two pages");
      }
      return {
        ...syntheticPage(
          calls === 1 ? null : `cursor-${calls - 1}`,
          `cursor-${calls}`,
        ),
        has_more: false,
      };
    };

    expect(() => readAllMementosProjectResources(
      projectId,
      { page_size: 1, resource_kinds: ["project"] },
    )).toThrow(/continuation cursor while claiming no more results/i);
    expect(calls).toBe(1);
  });
});
