import { describe, expect, it } from "bun:test";
import { verifyFleet } from "../src/core/verification";
import { assertNoNumeratorKeys } from "../src/core/fraction";

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
});
