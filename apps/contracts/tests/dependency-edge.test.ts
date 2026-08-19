// Agent-authored test-gap analysis (no SOL spec): the SOL consult (gpt-5.6-sol,
// max reasoning) was admitted but produced no answer within its bounds, so this
// file was authored by the writing agent and must not be attributed to SOL.
//
// Target: src/dependency-edge.ts — the retired-cloud-runtime edge detector.
// The gate's whole claim is "this package has no edge to the retired shared
// cloud runtime". These tests pin the discriminators the module exists for:
// JSONC tolerance, pin/name-list sections, scoped-name parsing, alias
// resolution, and the hoisted-vs-isolated install semantics measured on bun.
// Every case is deterministic; no network, no fixtures, no mocks.

import { describe, expect, test } from "bun:test";
import {
  isLinkedResolution,
  lockfileEdges,
  lockfileWalk,
  manifestEdges,
  nameFromResolutionId,
  parseLooseJson,
  resolutionTarget,
  type DependencyEdge,
} from "../src/dependency-edge";

const CLOUD = "@hasna/cloud";
const FORBIDDEN = [CLOUD, "cloud-shim"];

describe("parseLooseJson", () => {
  test("parses plain JSON", () => {
    expect(parseLooseJson('{"a": 1}')).toEqual({ a: 1 });
  });

  test("accepts trailing commas after the last object member", () => {
    expect(parseLooseJson('{"a": 1,}')).toEqual({ a: 1 });
  });

  test("accepts trailing commas after the last array element", () => {
    expect(parseLooseJson('["a", "b",]')).toEqual(["a", "b"]);
  });

  test("accepts trailing commas at nested depth", () => {
    const text = '{"dependencies": {"pg": "8.22.0",},}';
    expect(parseLooseJson(text)).toEqual({ dependencies: { pg: "8.22.0" } });
  });

  test("does NOT strip a comma inside a string value", () => {
    // A `file:../cloud-shim,` specifier must survive the tolerant path.
    const text = '{"a": "file:../cloud-shim,",}';
    expect(parseLooseJson(text)).toEqual({ a: "file:../cloud-shim," });
  });

  test("does NOT strip a comma inside an escaped-quote string", () => {
    const text = '{"a": "x\\",y",}';
    expect(parseLooseJson(text)).toEqual({ a: 'x",y' });
  });

  test("returns null for genuinely malformed JSON", () => {
    expect(parseLooseJson('{"a": }')).toBeNull();
    expect(parseLooseJson("")).toBeNull();
    expect(parseLooseJson("not json at all")).toBeNull();
  });
});

describe("manifestEdges", () => {
  test("finds a direct production dependency", () => {
    const edges = manifestEdges({ dependencies: { [CLOUD]: "0.1.41" } }, FORBIDDEN);
    expect(edges).toEqual([
      { packageName: CLOUD, scope: "production", path: [CLOUD], source: "package.json", section: "dependencies" },
    ]);
  });

  test("classifies devDependencies as development", () => {
    const edges = manifestEdges({ devDependencies: { [CLOUD]: "0.1.41" } }, FORBIDDEN);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.scope).toBe("development");
    expect(edges[0]!.section).toBe("devDependencies");
  });

  test("treats optional and peer dependencies as production", () => {
    for (const section of ["optionalDependencies", "peerDependencies"] as const) {
      const edges = manifestEdges({ [section]: { [CLOUD]: "0.1.41" } }, FORBIDDEN);
      expect(edges).toHaveLength(1);
      expect(edges[0]!.scope).toBe("production");
      expect(edges[0]!.section).toBe(section);
    }
  });

  test("never matches a substring of the forbidden name", () => {
    // `@hasna/cloudflare` is not `@hasna/cloud` — confusing the two is the
    // exact failure the module's comment says it exists to stop.
    expect(manifestEdges({ dependencies: { "@hasna/cloudflare": "1.0.0" } }, FORBIDDEN)).toEqual([]);
  });

  test("returns no edges for an unrelated manifest", () => {
    expect(manifestEdges({ dependencies: { pg: "8.22.0" } }, FORBIDDEN)).toEqual([]);
  });

  test("finds a flat overrides pin", () => {
    const edges = manifestEdges({ overrides: { [CLOUD]: "0.1.41" } }, FORBIDDEN);
    expect(edges).toEqual([
      { packageName: CLOUD, scope: "production", path: [CLOUD], source: "package.json", section: "overrides" },
    ]);
  });

  test("finds a nested npm-style overrides pin two levels deep", () => {
    // `"overrides": { "left-pad": { "@hasna/cloud": "0.1.41" } }` — reading
    // one level of keys misses the pinned package entirely.
    const edges = manifestEdges({ overrides: { "left-pad": { [CLOUD]: "0.1.41" } } }, FORBIDDEN);
    expect(edges.map((edge) => edge.packageName)).toContain(CLOUD);
  });

  test("finds a yarn-style resolutions path key", () => {
    // `"resolutions": { "left-pad/@hasna/cloud": "0.1.41" }` — the path key
    // carries the pinned package after a slash.
    const edges = manifestEdges({ resolutions: { "left-pad/@hasna/cloud": "0.1.41" } }, FORBIDDEN);
    expect(edges.map((edge) => edge.packageName)).toContain(CLOUD);
  });

  test("finds names in bundle and trusted name-list sections", () => {
    for (const section of ["bundleDependencies", "bundledDependencies", "trustedDependencies"] as const) {
      const edges = manifestEdges({ [section]: [CLOUD] }, FORBIDDEN);
      expect(edges, section).toHaveLength(1);
      expect(edges[0]!.scope).toBe("production");
    }
  });

  test("ignores non-object manifests", () => {
    expect(manifestEdges(null, FORBIDDEN)).toEqual([]);
    expect(manifestEdges("string", FORBIDDEN)).toEqual([]);
    expect(manifestEdges([], FORBIDDEN)).toEqual([]);
  });
});

describe("nameFromResolutionId", () => {
  test("parses an unscoped id", () => {
    expect(nameFromResolutionId("pg@8.22.0")).toBe("pg");
  });

  test("parses a scoped id where the separating @ is not the first character", () => {
    expect(nameFromResolutionId(`${CLOUD}@file:../cloud-shim`)).toBe(CLOUD);
    expect(nameFromResolutionId(`${CLOUD}@0.1.41`)).toBe(CLOUD);
  });

  test("returns the prefix up to the next scope sigil in a nested id", () => {
    // Measured behavior: `@a/b/@c/d` slices up to the second `@`, keeping the
    // separator that precedes it. Not a real resolution-id shape, but the
    // slicing contract is load-bearing for scoped names, so it is pinned.
    expect(nameFromResolutionId("@a/b/@c/d")).toBe("@a/b/");
  });

  test("returns null for an id with no version separator", () => {
    expect(nameFromResolutionId("pg")).toBeNull();
    expect(nameFromResolutionId("")).toBeNull();
    expect(nameFromResolutionId("@hasna/cloud")).toBeNull();
  });
});

describe("isLinkedResolution", () => {
  test("registry ids are not linked", () => {
    expect(isLinkedResolution("pg@8.22.0")).toBe(false);
    expect(isLinkedResolution(`${CLOUD}@npm:@hasna/other@1.0.0`)).toBe(false);
  });

  test("file, link, and workspace resolutions are linked", () => {
    expect(isLinkedResolution(`${CLOUD}@file:../cloud-shim`)).toBe(true);
    expect(isLinkedResolution(`${CLOUD}@link:../cloud-shim`)).toBe(true);
    expect(isLinkedResolution(`${CLOUD}@workspace:packages/x`)).toBe(true);
  });
});

describe("resolutionTarget", () => {
  test("ordinary registry ids resolve to themselves (null)", () => {
    expect(resolutionTarget("pg@8.22.0")).toBeNull();
  });

  test("npm: aliases resolve to the real package", () => {
    expect(resolutionTarget(`@hasna/legacy@npm:${CLOUD}@0.1.41`)).toBe(CLOUD);
  });

  test("an npm: alias of itself resolves to null", () => {
    expect(resolutionTarget(`${CLOUD}@npm:${CLOUD}@0.1.41`)).toBeNull();
  });

  test("a file: link resolves to the directory name", () => {
    expect(resolutionTarget("@hasna/legacy@file:../cloud-shim")).toBe("cloud-shim");
  });

  test("a scoped directory link resolves to its final segment", () => {
    expect(resolutionTarget("@hasna/legacy@file:../@hasna/cloud")).toBe("cloud");
  });

  test("a workspace: link resolves to the member name", () => {
    expect(resolutionTarget("@hasna/legacy@workspace:packages/pkg-a")).toBe("pkg-a");
  });

  test("a link whose directory name equals its own name resolves to null", () => {
    expect(resolutionTarget("legacy@file:../legacy")).toBeNull();
  });
});

describe("lockfileWalk", () => {
  test("a clean single-workspace lockfile reports no edges and no clearances", () => {
    const lock = JSON.stringify({
      lockfileVersion: 6,
      workspaces: { "": { name: "root", dependencies: { pg: "8.22.0" } } },
      packages: {
        "pg@8.22.0": ["pg@8.22.0", {}],
      },
    });
    const result = lockfileWalk(lock, FORBIDDEN);
    expect(result).not.toBeNull();
    expect(result!.edges).toEqual([]);
    expect(result!.clearedByLayout).toEqual([]);
  });

  test("a direct aliased file: dependency is an edge naming the resolution target", () => {
    // `bun install` records a dependency on ../cloud-shim declared as
    // @hasna/legacy as `@hasna/legacy@file:../cloud-shim` — the key alone
    // says nothing, the target does.
    const lock = JSON.stringify({
      lockfileVersion: 6,
      workspaces: { "": { name: "root", dependencies: { "@hasna/legacy": "file:../cloud-shim" } } },
      packages: {
        "@hasna/legacy@file:../cloud-shim": ["@hasna/legacy@file:../cloud-shim", {}],
      },
    });
    const result = lockfileWalk(lock, FORBIDDEN);
    expect(result).not.toBeNull();
    const edge = result!.edges.find((entry) => entry.packageName === "cloud-shim");
    expect(edge).toBeDefined();
    expect(edge!.path).toEqual(["@hasna/legacy", "cloud-shim"]);
    expect(edge!.scope).toBe("production");
    expect(edge!.source).toBe("bun.lock");
  });

  test("hoisted install: a transitive linked resolution is cleared by layout, not reported", () => {
    // The measured `hasna/logs` shape: single-workspace (hoisted) lockfile
    // where a transitive file: resolution lands nowhere on disk. The walk
    // must record a clearance for BOTH identities the dropped node stands for.
    const lock = JSON.stringify({
      lockfileVersion: 6,
      workspaces: { "": { name: "root", dependencies: { "pkg-a": "file:../pkg-a" } } },
      packages: {
        "pkg-a@file:../pkg-a": ["pkg-a@file:../pkg-a", { dependencies: { [CLOUD]: "file:../cloud-shim" } }],
        [`${CLOUD}@file:../cloud-shim`]: [`${CLOUD}@file:../cloud-shim`, {}],
      },
    });
    const result = lockfileWalk(lock, FORBIDDEN);
    expect(result).not.toBeNull();
    expect(result!.edges).toEqual([]);
    expect(result!.clearedByLayout.sort()).toEqual([CLOUD, "cloud-shim"].sort());
  });

  test("isolated multi-workspace install: the same chain IS an edge", () => {
    // The monorepo shape: more than one workspace entry means bun uses the
    // isolated layout and the transitive linked package IS on disk.
    const lock = JSON.stringify({
      lockfileVersion: 6,
      workspaces: {
        "": { name: "mono-root" },
        "packages/b": { name: "pkg-b", dependencies: { [CLOUD]: "file:../cloud-shim" } },
      },
      packages: {
        [`${CLOUD}@file:../cloud-shim`]: [`${CLOUD}@file:../cloud-shim`, {}],
      },
    });
    const result = lockfileWalk(lock, FORBIDDEN);
    expect(result).not.toBeNull();
    const edge = result!.edges.find((entry) => entry.packageName === CLOUD);
    expect(edge).toBeDefined();
    expect(edge!.path).toEqual(["pkg-b", CLOUD]);
    expect(edge!.scope).toBe("production");
    expect(result!.clearedByLayout).toEqual([]);
  });

  test("a linked package's dev edges are followed (linked dev deps are installed)", () => {
    // Measured on bun 1.3.14: a linked package is built from source, so its
    // dev edges land in the tree. A registry package's dev edges do not.
    const lock = JSON.stringify({
      lockfileVersion: 6,
      workspaces: { "": { name: "root", dependencies: { "pkg-a": "file:../pkg-a" } } },
      packages: {
        "pkg-a@file:../pkg-a": ["pkg-a@file:../pkg-a", { devDependencies: { [CLOUD]: "0.1.41" } }],
        [`${CLOUD}@0.1.41`]: [`${CLOUD}@0.1.41`, {}],
      },
    });
    const result = lockfileWalk(lock, FORBIDDEN);
    expect(result).not.toBeNull();
    const edge = result!.edges.find((entry) => entry.packageName === CLOUD);
    expect(edge).toBeDefined();
    expect(edge!.scope).toBe("development");
  });

  test("top-level overrides in bun.lock are install-bearing", () => {
    // `bun install` with an overrides block writes it at the top level of the
    // lockfile, outside any workspace record. Reading only `workspaces` made
    // every one of these invisible.
    const lock = JSON.stringify({
      lockfileVersion: 6,
      overrides: { [CLOUD]: "0.1.41" },
      workspaces: { "": { name: "root" } },
    });
    const result = lockfileWalk(lock, FORBIDDEN);
    expect(result).not.toBeNull();
    const edge = result!.edges.find((entry) => entry.packageName === CLOUD);
    expect(edge).toBeDefined();
    expect(edge!.section).toBe("overrides");
  });

  test("an alias KEY files the entry under the name dependents write", () => {
    // `"mycloud": ["@hasna/cloud@0.1.41", ...]` — the KEY is the alias and the
    // id carries the real package; dependents look up `mycloud`.
    const lock = JSON.stringify({
      lockfileVersion: 6,
      workspaces: { "": { name: "root", dependencies: { mycloud: "0.1.41" } } },
      packages: {
        mycloud: [`${CLOUD}@0.1.41`, {}],
      },
    });
    const result = lockfileWalk(lock, FORBIDDEN);
    expect(result).not.toBeNull();
    const edge = result!.edges.find((entry) => entry.packageName === CLOUD);
    expect(edge).toBeDefined();
    expect(edge!.path[edge!.path.length - 1]).toBe(CLOUD);
  });

  test("unparseable lockfiles return null so the caller can fall back", () => {
    expect(lockfileEdges("not a lockfile", FORBIDDEN)).toBeNull();
    expect(lockfileEdges('{"packages": []}', FORBIDDEN)).toBeNull();
  });
});

describe("manifestEdges + lockfileWalk agreement", () => {
  test("the same forbidden package is found through both surfaces", () => {
    const manifest = { dependencies: { [CLOUD]: "0.1.41" } };
    const lock = JSON.stringify({
      lockfileVersion: 6,
      workspaces: { "": { name: "root", dependencies: { [CLOUD]: "0.1.41" } } },
      packages: {
        [`${CLOUD}@0.1.41`]: [`${CLOUD}@0.1.41`, {}],
      },
    });
    const fromManifest: DependencyEdge[] = manifestEdges(manifest, FORBIDDEN);
    const fromLock = lockfileWalk(lock, FORBIDDEN);
    expect(fromManifest).toHaveLength(1);
    expect(fromLock!.edges).toHaveLength(1);
    expect(fromManifest[0]!.packageName).toBe(fromLock!.edges[0]!.packageName);
    expect(fromManifest[0]!.source).toBe("package.json");
    expect(fromLock!.edges[0]!.source).toBe("bun.lock");
  });
});
