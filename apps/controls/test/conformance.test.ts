import { describe, expect, it } from "bun:test";

describe("repo conformance (Hasna Service Contract v1)", () => {
  it("passes every required repo-conformance check at the pinned contracts kit", async () => {
    const contracts = (await import("@hasna/contracts")) as {
      runRepoConformance?: (root: string) => {
        ok: boolean;
        checks: { id: string; status: string; detail: string }[];
      };
    };
    expect(typeof contracts.runRepoConformance).toBe("function");
    const report = contracts.runRepoConformance!(process.cwd());
    // The transitional mode-era expected-failure gate is retired: controls now
    // pins the two-backend contracts kit (0.13.1, storage.backend era; 0.13.3's
    // registry package declares an unpublished @hasna/secrets@0.3.4 peer, so a
    // standalone app-lock install cannot resolve it). Every
    // required check must pass; `skip` is a legitimate non-blocking outcome
    // (e.g. health_shape without a supplied sample). Any `fail` blocks loudly.
    for (const check of report.checks) {
      if (check.status === "fail") {
        throw new Error(`repo-conformance ${check.id} failed: ${check.detail}`);
      }
    }
    expect(report.ok).toBe(true);
  });
});
