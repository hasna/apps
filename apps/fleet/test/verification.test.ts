import { describe, expect, it } from "bun:test";
import { exitCodeForResult, normalizeHostId, verifyFleet } from "../src/core/verification";
import { assertNoNumeratorKeys, formatFraction } from "../src/core/fraction";

describe("fleet verification", () => {
  it("reports the measured 14/21 failure shape without hiding unsampled hosts", () => {
    const manifestHosts = Array.from({ length: 19 }, (_, index) => ({ id: `station${index + 1}` }));
    const awsHosts = [...manifestHosts, { id: "station20" }];
    const tailscaleHosts = [...manifestHosts, { id: "apple07" }];
    const probes = manifestHosts.slice(0, 14).map((host) => ({ host: host.id, ok: true }));

    const result = verifyFleet({
      observedAt: "2026-08-01T09:00:00.000Z",
      sources: [
        { name: "manifest", hosts: manifestHosts },
        { name: "aws-ec2", hosts: awsHosts },
        { name: "tailscale", hosts: tailscaleHosts },
      ],
      probes,
    });

    expect(result.fraction).toBe("14/21");
    expect(result.status).toBe("incomplete");
    expect(result.missingHosts).toContain("station20");
    expect(result.missingHosts).toContain("apple07");
    expect(result.provenance.axes).toContain("inventory source");
    expect(result.provenance.omittedAxis).toBe("credential state between observations");
    expect(() => assertNoNumeratorKeys(result)).not.toThrow();
  });

  it("fails a zero source unless an observed positive control is supplied", () => {
    const result = verifyFleet({
      sources: [
        { name: "manifest", hosts: [{ id: "station01", reachable: true }] },
        { name: "aws-ec2", hosts: [] },
        { name: "tailscale", hosts: [{ id: "station01", reachable: true }] },
      ],
    });

    expect(result.status).toBe("control_failed");
    expect(result.controlFailures).toEqual([
      "aws-ec2 returned zero hosts without an observed positive control",
    ]);
  });

  it("accepts a named zero only when the positive control is observed", () => {
    const result = verifyFleet({
      sources: [
        { name: "manifest", hosts: [{ id: "station01", reachable: true }] },
        { name: "aws-ec2", hosts: [] },
        { name: "tailscale", hosts: [{ id: "station01", reachable: true }] },
      ],
      positiveControls: [{ source: "aws-ec2", observed: true, evidence: "fixture asserts empty" }],
    });

    expect(result.status).toBe("pass");
    expect(result.fraction).toBe("1/1");
  });

  it("normalizes host identity and de-duplicates inventory across sources", () => {
    const result = verifyFleet({
      observedAt: "2026-08-01T09:00:00.000Z",
      sources: [
        { name: "manifest", hosts: [{ id: " Station01 " }, { id: "station02" }] },
        { name: "aws-ec2", hosts: [{ id: "station01" }] },
        { name: "tailscale", hosts: [{ id: "STATION01" }] },
      ],
      probes: [{ host: " STATION01 ", ok: true }],
    });

    expect(normalizeHostId("  Station01 ")).toBe("station01");
    expect(result.totalHosts).toEqual(["station01", "station02"]);
    expect(result.coveredHosts).toEqual(["station01"]);
    expect(result.missingHosts).toEqual(["station02"]);
    expect(result.fraction).toBe("1/2");
  });

  it("maps every terminal verification status to its documented exit code", () => {
    const base = {
      sources: [
        { name: "manifest", hosts: [{ id: "station01", reachable: true }] },
        { name: "aws-ec2", hosts: [{ id: "station01", reachable: true }] },
        { name: "tailscale", hosts: [{ id: "station01", reachable: true }] },
      ],
    };
    const pass = verifyFleet(base);
    const incomplete = verifyFleet({ ...base, probes: [{ host: "missing", ok: true }] });
    const controlFailed = verifyFleet({ ...base, sources: [{ name: "manifest", hosts: [] }, ...base.sources.slice(1)] });
    const invalid = verifyFleet({
      sources: [],
      requiredSources: [],
      positiveControls: [{ source: "fleet-union", observed: true, evidence: "empty fixture" }],
    });

    expect(exitCodeForResult(pass)).toBe(0);
    expect(exitCodeForResult(incomplete)).toBe(1);
    expect(exitCodeForResult(invalid)).toBe(2);
    expect(exitCodeForResult(controlFailed)).toBe(3);
  });

  it("rejects impossible fractions before formatting provenance", () => {
    expect(() => formatFraction({ numerator: 2, denominator: 1, source: "test", observedAt: "now", axes: [], omittedAxis: "none" })).toThrow(
      /cannot exceed/,
    );
    expect(() => formatFraction({ numerator: -1, denominator: 1, source: "test", observedAt: "now", axes: [], omittedAxis: "none" })).toThrow(
      /non-negative integer/,
    );
  });
});
