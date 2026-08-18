import { describe, expect, it } from "bun:test";

describe("repo conformance (Hasna Service Contract v1)", () => {
  it("hits exactly the transitional mode-era manifest gate", async () => {
    const contracts = (await import("@hasna/contracts")) as {
      runRepoConformance?: (root: string) => { ok: boolean; checks: { id: string; status: string; detail: string }[] };
    };
    expect(typeof contracts.runRepoConformance).toBe("function");
    const report = contracts.runRepoConformance!(process.cwd());
    // Transitional gate (modes-removal lane): the pinned @hasna/contracts 0.4.1
    // validator is mode-era (it REQUIRES storage.mode and rejects
    // storage.backend), while this manifest is backend-era — the mode vocabulary
    // is removed and storage.backend declares the sqlite backend. Measured: the
    // in-process validator short-circuits to the manifest check alone when the
    // manifest is invalid, so the failure is asserted exactly. When the contracts
    // lane ships the two-backend validator (published 0.8.7+ already carries
    // storage.backend and rejects storage.mode) and controls re-pins, this
    // assertion fails loudly in BOTH directions and must be updated to the
    // all-pass shape.
    expect(report.checks.map((c) => c.id)).toEqual(["manifest_valid"]);
    expect(report.checks[0]?.status).toBe("fail");
    expect(report.checks[0]?.detail).toContain("storage.mode Required");
    expect(report.ok).toBe(false);
  });
});
