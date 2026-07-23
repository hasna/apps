import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  CONTROL_METADATA_KEY,
  canonicalJson,
  validateControlMetadataV1,
  type ControlEventV1,
  type TrustedControlEnvelopeV1,
} from "./control-contract";
import {
  evaluateControlsV1,
  type ControlEvaluationInputV1,
  type ControlObservationV1,
} from "./control-evaluator";

interface ConformanceFixture {
  fixture_version: string;
  fixture_id: string;
  expected: {
    freeze_event_id: string;
    unfreeze_event_id: string;
    canonical_event_sequence_sha256: string;
    decision: "allow";
    enforced: false;
  };
  config: ControlEvaluationInputV1["config"];
  target: ControlEvaluationInputV1["target"];
  observations: ControlObservationV1[];
}

interface LegacyFixture {
  fixture_version: string;
  fixture_id: string;
  config: ControlEvaluationInputV1["config"];
  target: ControlEvaluationInputV1["target"];
  records: Array<{
    vector_id: string;
    content: string;
    metadata: unknown;
    blocking: boolean;
  }>;
  expected: {
    decision: "allow";
    enforced: false;
    active_control_ids: string[];
  };
}

async function readFixture<T>(name: string): Promise<T> {
  const url = new URL(`../../fixtures/hasna-control-v1/${name}`, import.meta.url);
  return JSON.parse(await Bun.file(url).text()) as T;
}

describe("hasna.control/v1 conformance fixtures", () => {
  test("pins canonical event ids, sequence hash, and observe-only release result", async () => {
    const fixture = await readFixture<ConformanceFixture>("conformance.json");
    expect(fixture.fixture_version).toBe("hasna.control/conformance-v1");
    expect(fixture.fixture_id).toBe("project-freeze-unfreeze");

    const events = fixture.observations.map((observation) =>
      (observation.metadata as Record<string, ControlEventV1>)[CONTROL_METADATA_KEY]!,
    );
    expect(events.map((event) => event.event_id)).toEqual([
      fixture.expected.freeze_event_id,
      fixture.expected.unfreeze_event_id,
    ]);
    const sequenceHash = `sha256:${createHash("sha256")
      .update(canonicalJson(events), "utf8")
      .digest("hex")}`;
    expect(sequenceHash).toBe(fixture.expected.canonical_event_sequence_sha256);

    for (const observation of fixture.observations) {
      expect(
        validateControlMetadataV1(observation.metadata, {
          trusted_envelope: observation.trusted_envelope,
          activation_timestamp: fixture.config.activation_timestamp,
        }).status,
      ).toBe("valid");
    }

    const forward = evaluateControlsV1({
      config: fixture.config,
      target: fixture.target,
      backend: { status: "available", observations: fixture.observations },
    });
    const reverse = evaluateControlsV1({
      config: fixture.config,
      target: fixture.target,
      backend: { status: "available", observations: [...fixture.observations].reverse() },
    });
    expect(forward).toEqual(reverse);
    expect(forward).toMatchObject({
      decision: fixture.expected.decision,
      enforced: fixture.expected.enforced,
      active_control_ids: [],
      accepted_event_count: 2,
      rejected_event_count: 0,
    });
  });

  test("keeps legacy blocker rows and literal control text non-semantic", async () => {
    const fixture = await readFixture<LegacyFixture>("legacy-blockers.json");
    expect(fixture.fixture_version).toBe("hasna.control/legacy-compatibility-v1");
    expect(fixture.fixture_id).toBe("legacy-blocker-text-is-inert");

    for (const record of fixture.records) {
      const trusted: TrustedControlEnvelopeV1 = {
        authenticated_principal: "agent:legacy",
        tenant: "tenant:hasna",
        authority_domain: "hasna/control-operators",
        permitted_surface: "announcements",
        policy_version: "1.0.1",
        server_time: "2026-07-23T00:00:01.000Z",
        blocking: record.blocking,
      };
      const result = evaluateControlsV1({
        config: fixture.config,
        target: fixture.target,
        backend: {
          status: "available",
          observations: [{ content: record.content, metadata: record.metadata, trusted_envelope: trusted }],
        },
      });
      expect(result).toMatchObject(fixture.expected);
      if (record.blocking) {
        expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("ordinary_blocker_ignored");
      }
    }
  });
});
