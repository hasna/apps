import { describe, expect, test } from "bun:test";
import { maybeNpmVersions, type Runner } from "../scripts/registry-versions.ts";

function fakeRunner(results: Array<{ stdout: string; stderr: string; exitCode: number }>): Runner {
  let calls = 0;
  return async (cmd: string[]) => {
    expect(cmd[0]).toBe("npm");
    const result = results[Math.min(calls, results.length - 1)];
    calls += 1;
    return result;
  };
}

describe("maybeNpmVersions (release-verifier registry lookup)", () => {
  test("returns published versions on a successful npm view", async () => {
    const run = fakeRunner([{ stdout: '["0.5.16","0.5.23"]', stderr: "", exitCode: 0 }]);
    expect(await maybeNpmVersions("@hasna/browser", run)).toEqual(["0.5.16", "0.5.23"]);
  });

  test("returns a single string version as a one-element list", async () => {
    const run = fakeRunner([{ stdout: '"0.5.16"', stderr: "", exitCode: 0 }]);
    expect(await maybeNpmVersions("@hasna/browser", run)).toEqual(["0.5.16"]);
  });

  test("returns [] only for a genuinely unpublished package (npm E404)", async () => {
    const run = fakeRunner([
      { stdout: "", stderr: "npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/@hasna%2fnever-published - Not found", exitCode: 1 },
    ]);
    expect(await maybeNpmVersions("@hasna/never-published", run)).toEqual([]);
  });

  test("FAILS CLOSED on a nonzero exit that is not E404 (regression: previously returned [])", async () => {
    const run = fakeRunner([
      { stdout: "", stderr: "npm error code ENOTFOUND\nrequest to https://registry.npmjs.org/@hasna%2fbrowser failed", exitCode: 1 },
    ]);
    expect(maybeNpmVersions("@hasna/browser", run)).rejects.toThrow(/npm view @hasna\/browser versions failed/);
  });

  test("FAILS CLOSED on an empty versions array", async () => {
    const run = fakeRunner([{ stdout: "[]", stderr: "", exitCode: 0 }]);
    expect(maybeNpmVersions("@hasna/browser", run)).rejects.toThrow(/empty array/);
  });

  test("FAILS CLOSED on malformed JSON", async () => {
    const run = fakeRunner([{ stdout: "{not json", stderr: "", exitCode: 0 }]);
    expect(maybeNpmVersions("@hasna/browser", run)).rejects.toThrow(/malformed JSON/);
  });

  test("FAILS CLOSED on non-array, non-string JSON", async () => {
    const run = fakeRunner([{ stdout: "null", stderr: "", exitCode: 0 }]);
    expect(maybeNpmVersions("@hasna/browser", run)).rejects.toThrow(/unexpected JSON/);
  });
});
