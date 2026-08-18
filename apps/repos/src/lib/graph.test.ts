import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, getDb } from "../db/database.js";
import { upsertRepo } from "../db/repos.js";
import { buildGraph, getDeps, queryRelated } from "./graph.js";

const tempDirs: string[] = [];

beforeEach(() => {
  closeDb();
  process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
  getDb(":memory:");
});

afterAll(() => {
  closeDb();
  delete process.env["HASNA_REPOS_DB_PATH"];
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function insertEdge(sourceId: string, relation: string, targetId: string, weight = 1.0): void {
  getDb()
    .query(
      `INSERT INTO edges (source_type, source_id, relation, target_type, target_id, weight)
       VALUES ('repo', ?, ?, 'repo', ?, ?)`
    )
    .run(sourceId, relation, targetId, weight);
}

// Regression for todos f3c7ecb6: queryRelated()/getDeps() resolve a bare name
// to a repo id with the same unfiltered `WHERE name = ?` pattern getRepo()
// used to have before todos c357a1f3 / PR #59 -- so a bare name whose only
// exact match is a `_factory_src` scratch clone silently attributes graph
// results to the WRONG repo id instead of refusing, exactly the bug #59 fixed
// for the exact-lookup path and left open here.
describe("graph name resolution does not resolve to a factory scratch clone", () => {
  test("queryRelated does not attribute results to a factory scratch clone that is the only exact-name match", () => {
    upsertRepo({
      path: "/ws/hasna/opensource/open-loops",
      name: "open-loops",
      org: "hasna",
      remote_url: "github.com/hasna/loops",
    });
    const mirror = upsertRepo({
      path: "/ws/hasna/opensource/_factory_src/loops",
      name: "loops",
      org: "hasna",
      remote_url: "github.com/hasna/loops",
    });
    const other = upsertRepo({ path: "/ws/hasna/opensource/other", name: "other", org: "hasna" });

    // A relationship recorded against the MIRROR's id -- the wrong node. The
    // whole point of the fix is that a bare-name query must not surface it.
    insertEdge(String(mirror.id), "similar_to", String(other.id), 2.0);

    // Bug: queryRelated("loops") used to resolve repoId to the mirror's id
    // (the only exact `name` match) and return the mirror's edges under the
    // bare name a caller typed.
    expect(queryRelated("loops")).toEqual([]);
  });

  test("queryRelated still resolves and returns edges for a name that is not ambiguous with a scratch clone", () => {
    const canonical = upsertRepo({ path: "/ws/canonical", name: "canonical", org: "hasna" });
    const other = upsertRepo({ path: "/ws/other2", name: "other2", org: "hasna" });
    insertEdge(String(canonical.id), "similar_to", String(other.id), 3.0);

    const related = queryRelated("canonical");
    expect(related.length).toBe(1);
    expect(related[0]!.repo_id).toBe(String(other.id));
    expect(related[0]!.weight).toBe(3.0);
  });

  test("getDeps does not attribute a dependency walk to a factory scratch clone that is the only exact-name match", () => {
    upsertRepo({
      path: "/ws/hasna/opensource/open-loops",
      name: "open-loops",
      org: "hasna",
      remote_url: "github.com/hasna/loops",
    });
    const mirror = upsertRepo({
      path: "/ws/hasna/opensource/_factory_src/loops",
      name: "loops",
      org: "hasna",
      remote_url: "github.com/hasna/loops",
    });
    const dep = upsertRepo({ path: "/ws/hasna/opensource/dep", name: "dep", org: "hasna" });

    insertEdge(String(mirror.id), "depends_on", String(dep.id));

    // Bug: getDeps("loops") used to resolve repoId to the mirror's id and
    // walk ITS depends_on edges instead of refusing.
    expect(getDeps("loops")).toEqual([]);
  });

  test("getDeps still walks real depends_on edges for an unambiguous name", () => {
    const consumer = upsertRepo({ path: "/ws/consumer", name: "consumer", org: "hasna" });
    const dep = upsertRepo({ path: "/ws/real-dep", name: "real-dep", org: "hasna" });
    insertEdge(String(consumer.id), "depends_on", String(dep.id));

    const deps = getDeps("consumer");
    expect(deps.length).toBe(1);
    expect(deps[0]!.repo_id).toBe(String(dep.id));
  });

  test("buildGraph does not create a depends_on edge to a factory scratch clone when a package.json dependency name is only an exact match for it", () => {
    const consumerDir = mkdtempSync(join(tmpdir(), "graph-consumer-"));
    tempDirs.push(consumerDir);
    mkdirSync(consumerDir, { recursive: true });
    // A raw (non-@hasna-scoped) dependency name is passed through by
    // extractDeps() unchanged, so a package literally depending on a package
    // named "loops" is the realistic trigger for this: the canonical checkout
    // and the factory scratch clone are both indexed under the bare "loops",
    // and the derived-checkout filter is what excludes the mirror.
    writeFileSync(
      join(consumerDir, "package.json"),
      JSON.stringify({ name: "consumer", dependencies: { loops: "*" } })
    );

    const consumer = upsertRepo({ path: consumerDir, name: "consumer-fixture", org: "hasna" });
    upsertRepo({
      path: "/ws/hasna/opensource/loops",
      name: "loops",
      org: "hasna",
      remote_url: "github.com/hasna/loops",
    });
    const mirror = upsertRepo({
      path: "/ws/hasna/opensource/_factory_src/loops",
      name: "loops",
      org: "hasna",
      remote_url: "github.com/hasna/loops",
    });

    buildGraph();

    const edges = getDb()
      .query(
        "SELECT * FROM edges WHERE source_type = 'repo' AND source_id = ? AND relation = 'depends_on'"
      )
      .all(String(consumer.id)) as Array<{ target_id: string }>;
    // Bug: this used to contain an edge from the consumer to the mirror's id.
    expect(edges.find((e) => e.target_id === String(mirror.id))).toBeUndefined();
  });
});
