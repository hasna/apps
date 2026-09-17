import { describe, expect, test } from "bun:test";
import { readPublishedVersions, requireRegistryEvidence, type RegistryQueryResult } from "../../published-versions";

const success = (value: unknown): RegistryQueryResult => ({ exitCode: 0, stdout: JSON.stringify(value), stderr: "" });

describe("published version registry evidence", () => {
  test("accepts npm's single-version and multi-version response forms", async () => {
    for (const value of ["1.0.0", ["1.0.0", "1.1.0-beta.1+build.2"]]) {
      expect(await readPublishedVersions(async () => success(value))).toEqual(typeof value === "string" ? [value] : value);
    }
  });

  test("a repeatedly missing package remains a violation", async () => {
    for (const result of [
      { exitCode: 1, stdout: '{"error":{"code":"E404"}}', stderr: "" },
      { exitCode: 1, stdout: "", stderr: "npm error code E404" },
    ]) {
      let calls = 0;
      expect(await readPublishedVersions(async () => { calls++; return result; }, async () => {})).toEqual([]);
      expect(calls).toBe(3);
      expect(requireRegistryEvidence("@hasna/example", [], true)).toEqual([]);
    }
  });

  test("rate limits, server and transport failures can recover within three attempts", async () => {
    for (const code of ["E404", "E429", "E503", "ECONNRESET", "ETIMEDOUT"]) {
      let calls = 0;
      const delays: number[] = [];
      const result = await readPublishedVersions(async () => ++calls < 3
        ? { exitCode: 1, stdout: "", stderr: `npm error code ${code}` } : success(["0.1.18"]),
      async delay => { delays.push(delay); });
      expect(result).toEqual(["0.1.18"]);
      expect(calls).toBe(3);
      expect(delays).toEqual([250, 500]);
    }
  });

  test("failed, empty, mixed and malformed responses never become unpublished or a CI pass", async () => {
    const responses = [
      { exitCode: 1, stdout: "", stderr: "E401 owned-credential-canary" },
      { exitCode: 1, stdout: "", stderr: "unknown npm failure" },
      { exitCode: 0, stdout: "not json", stderr: "" },
      { exitCode: 1, stdout: '{"error":{"code":"E503"}}', stderr: "npm error code E404" },
      success([]), success(["1.0.0", null]), success({ versions: ["1.0.0"] }),
    ];
    for (const response of responses) {
      let calls = 0;
      const result = await readPublishedVersions(async () => { calls++; return response; }, async () => {});
      expect(calls).toBe(3);
      expect(result).toBeNull();
      expect(() => requireRegistryEvidence("@hasna/example", result, true)).toThrow("publication state is unverified");
      expect(() => requireRegistryEvidence("@hasna/example", result, true)).not.toThrow("owned-credential-canary");
      expect(requireRegistryEvidence("@hasna/example", result, false)).toBeNull();
    }
  });

  test("spawn and read exceptions exhaust the same retry bound", async () => {
    let calls = 0;
    expect(await readPublishedVersions(async () => { calls++; throw new Error("owned-credential-canary"); }, async () => {})).toBeNull();
    expect(calls).toBe(3);
  });

  test("a missing response followed by unavailable reads does not prove absence", async () => {
    let calls = 0;
    const result = await readPublishedVersions(async () => ({
      exitCode: 1, stdout: "", stderr: ++calls === 1 ? "npm error code E404" : "npm error code E503",
    }), async () => {});
    expect(calls).toBe(3);
    expect(result).toBeNull();
    expect(() => requireRegistryEvidence("@hasna/example", result, true)).toThrow("unverified");
  });
});
