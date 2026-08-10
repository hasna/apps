import { describe, expect, test } from "bun:test";
import {
  MementosClient,
  type MementosProjectResourcePage,
} from "./index.js";

const projectId = "7c6a379c-c40a-4740-a680-41b402004c03";
const page: MementosProjectResourcePage = {
  schema: "mementos.project-resources.v1",
  authority: {
    authority: "mementos",
    authority_id: "mementos-sdk-test",
    tenant_id: "tenant-sdk-test",
    corpus_id: "corpus-sdk-test",
    package_version: "0.14.81-test",
  },
  project_id: projectId,
  project_revision: "2026-08-10T12:00:00.000Z",
  collection_revision: "a".repeat(64),
  resource_kinds: ["project", "knowledge", "memory", "session"],
  resources: [{
    authority: "mementos",
    source_package: "@hasna/mementos",
    project_id: projectId,
    resource_kind: "project",
    stable_id: projectId,
    revision: "2026-08-10T12:00:00.000Z",
    digest: "b".repeat(64),
    membership: "project_aggregate",
  }],
  count: 1,
  total: 1,
  limit: 2,
  cursor: null,
  next_cursor: null,
  has_more: false,
  complete: true,
  truncated: false,
};

describe("MementosClient project resources", () => {
  test("lists pages, exhausts them, and reads one exact stable ID", async () => {
    const calls: string[] = [];
    const client = new MementosClient({
      baseUrl: "https://mementos.example.test",
      fetch: (async (url: string | URL | Request) => {
        calls.push(String(url));
        return new Response(JSON.stringify(
          String(url).includes(`/resources/project/${projectId}`)
            ? { ...page, resource: page.resources[0] }
            : page,
        ), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch,
    });

    await expect(client.listProjectResources(projectId, {
      limit: 2,
      resource_kinds: ["project", "memory"],
    })).resolves.toEqual(page);
    await expect(client.listAllProjectResources(projectId, {
      page_size: 2,
      resource_kinds: ["project", "memory"],
    })).resolves.toMatchObject({
      resources: page.resources,
      count: 1,
      total: 1,
      has_more: false,
      next_cursor: null,
    });
    await expect(client.getProjectResource(
      projectId,
      "project",
      projectId,
    )).resolves.toMatchObject({ resource: page.resources[0] });

    expect(calls).toEqual([
      `https://mementos.example.test/v1/projects/${projectId}/resources?limit=2&resource_kinds=project%2Cmemory`,
      `https://mementos.example.test/v1/projects/${projectId}/resources?limit=2&resource_kinds=project%2Cmemory`,
      `https://mementos.example.test/v1/projects/${projectId}/resources/project/${projectId}`,
    ]);
  });
});
