// agent-authored (no SOL consult available)

import { describe, expect, test, mock } from "bun:test";
import { gatherFromResearcher } from "./researcher.js";

// Per-test SDK fixture state, read at call time by the mocked module.
const sdkState: {
  projects: unknown[];
  results: unknown[];
  throwOnProjects?: boolean;
} = { projects: [], results: [] };

describe("gatherFromResearcher", () => {
  test("returns an empty result when the SDK package is not installed", async () => {
    mock.module("@hasna/researcher", () => {
      throw new Error("module not found");
    });
    const result = await gatherFromResearcher();
    expect(result.source).toBe("researcher");
    expect(result.examples).toEqual([]);
    expect(result.count).toBe(0);
  });

  test("builds project and result examples, splitting the limit evenly", async () => {
    mock.module("@hasna/researcher", () => ({
      listProjects: async () => {
        if (sdkState.throwOnProjects) throw new Error("boom");
        return sdkState.projects;
      },
      listResults: async () => sdkState.results,
    }));
    sdkState.throwOnProjects = false;
    sdkState.projects = [
      { id: "p1", name: "Project One", description: "Studies things" },
      { id: "p2" },
    ];
    sdkState.results = [{ id: "r1", name: "Exp A", summary: "No effect found" }];

    const result = await gatherFromResearcher({ limit: 4 });
    // floor(4/2) = 2 projects, floor(4/2) = 2 results → sliced to limit
    expect(result.count).toBe(3);

    const projectExample = result.examples[0]!;
    expect(projectExample.messages[0]?.content).toContain("scientific research");
    expect(projectExample.messages[1]?.content).toBe('Summarize the research project "Project One"');
    expect(projectExample.messages[2]?.content).toBe('Project "Project One": Studies things');

    const resultExample = result.examples[2]!;
    expect(resultExample.messages[1]?.content).toBe('What were the results of experiment "Exp A"?');
    expect(resultExample.messages[2]?.content).toBe("Result: No effect found");
  });

  test("projects without a description fall back to JSON.stringify", async () => {
    sdkState.projects = [{ id: "p2" }];
    sdkState.results = [];
    const result = await gatherFromResearcher({ limit: 10 });
    expect(result.count).toBe(1);
    const example = result.examples[0]!;
    expect(example.messages[1]?.content).toBe('Summarize the research project "p2"');
    expect(example.messages[2]?.content).toContain('"id":"p2"');
  });

  test("a throwing listProjects discards the results examples too", async () => {
    // Both source loops share one try block: a throw from listProjects aborts
    // the results loop as well, despite the "partial results ok" comment.
    sdkState.throwOnProjects = true;
    sdkState.projects = [];
    sdkState.results = [{ id: "r1", name: "Exp", summary: "s" }];
    const result = await gatherFromResearcher();
    expect(result.source).toBe("researcher");
    expect(result.count).toBe(0);
  });
});
