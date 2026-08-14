import { describe, expect, test } from "bun:test";
import { normalizeConfig } from "../src/config";
import { resolveRoute } from "../src/router";
import type { GatewayConfig, GatewayModelConfig, GatewayRoutingMode } from "../src/types";

// Regression for todos 7dd67da6-9ede-483a-ac3f-acd21cecd7f5: session affinity
// (sticky_session_id / session_id) never ran in any shipped routing mode.
// 'cheapest', 'fallback' and 'explicit' returned before the sticky component
// was ever computed, and the scored modes consulted it only on EXACT float
// score equality, which no realistic pair of candidates produces. These tests
// drive every shipped routing mode and assert (a) the affinity code path
// executed — decision.session_affinity is reported — and (b) in a tied or
// materially-equal configuration the session id actually determines the
// selection, deterministically per session.

const SHIPPED_MODES: readonly GatewayRoutingMode[] = [
  "explicit",
  "fallback",
  "cheapest",
  "lowest-latency",
  "highest-throughput",
  "balanced",
  "smart",
];

const DATA_POLICY = {
  allowTraining: false,
  allowLogging: false,
  byokOnly: true,
  zeroDataRetentionAvailable: false,
};

function affinityModel(
  id: string,
  providerId: string,
  overrides: Partial<GatewayModelConfig> = {},
): GatewayModelConfig {
  return {
    id,
    providerId,
    providerModel: `${providerId}-model`,
    aliases: ["team"],
    capabilities: ["chat", "streaming"],
    contextWindow: 128_000,
    inputUsdPerMillionTokens: 1,
    outputUsdPerMillionTokens: 2,
    averageLatencyMs: 500,
    successRate: 0.9,
    throughputTokensPerSecond: 100,
    ...overrides,
  } as GatewayModelConfig;
}

function affinityProvider(id: string, envName: string) {
  return {
    id,
    displayName: `Provider ${id}`,
    kind: "openai-compatible" as const,
    baseUrl: `https://${id}.example/v1`,
    apiKeyEnv: envName,
    enabled: true,
    regions: ["us"],
    dataPolicy: DATA_POLICY,
  };
}

function affinityConfig(
  aOverrides: Partial<GatewayModelConfig> = {},
  bOverrides: Partial<GatewayModelConfig> = {},
  cOverrides?: Partial<GatewayModelConfig>,
): GatewayConfig {
  return normalizeConfig({
    server: { host: "127.0.0.1", port: 8787, includeGatewayMetadata: true },
    auth: { apiKeyEnv: "GATEWAY_API_KEY", required: false },
    policy: { allowTraining: false, allowChineseProviders: false },
    providers: [
      affinityProvider("prov-a", "A_KEY"),
      affinityProvider("prov-b", "B_KEY"),
      ...(cOverrides === undefined ? [] : [affinityProvider("prov-c", "C_KEY")]),
    ],
    models: [
      affinityModel("prov-a/team", "prov-a", aOverrides),
      affinityModel("prov-b/team", "prov-b", bOverrides),
      ...(cOverrides === undefined ? [] : [affinityModel("prov-c/team", "prov-c", cOverrides)]),
    ],
    routes: [],
  });
}

const ENV = { A_KEY: "key-a", B_KEY: "key-b", C_KEY: "key-c" };

function route(config: GatewayConfig, mode: GatewayRoutingMode, sessionId?: string) {
  return resolveRoute(
    { config, env: ENV },
    {
      model: "team",
      messages: [{ role: "user" as const, content: "hi" }],
      gateway: {
        routing: mode,
        // 'fallback' and 'explicit' only rank ties among candidates a
        // provider_order hint leaves unranked; an order naming neither
        // provider leaves both tied.
        ...(mode === "fallback" || mode === "explicit"
          ? { provider_order: ["prov-unlisted"] }
          : {}),
        ...(sessionId === undefined ? {} : { sticky_session_id: sessionId }),
      },
    },
  );
}

/**
 * Session ids proven (deterministically, by the FNV-1a hash the router uses)
 * to prefer different candidates in a two-way tie. If the hash ever changes,
 * re-derive a disagreeing pair here rather than weakening the assertions.
 */
function disagreeingSessions(
  config: GatewayConfig,
  mode: GatewayRoutingMode,
): [string, string] | undefined {
  const winners = new Map<string, string>();
  for (let index = 0; index < 64; index += 1) {
    const sessionId = `probe-session-${index}`;
    const selected = route(config, mode, sessionId).decision.selected!;
    for (const [otherSession, otherWinner] of winners) {
      if (otherWinner !== selected) return [otherSession, sessionId];
    }
    winners.set(sessionId, selected);
  }
  return undefined;
}

describe("session affinity runs in every shipped routing mode", () => {
  for (const mode of SHIPPED_MODES) {
    test(`${mode}: affinity path executes and the session id decides a tie`, () => {
      // Identical candidates: tied on price (cheapest), unranked by the
      // provider_order hint (fallback/explicit), and score-tied (scored modes).
      const config = affinityConfig();

      const withSession = route(config, mode, "session-affinity-1");
      // The affinity code path executed and is disclosed on the decision.
      expect(withSession.decision.session_affinity).toEqual({
        session_id_present: true,
        applied: true,
      });

      // Deterministic: the same session always lands on the same candidate.
      const first = withSession.decision.selected;
      for (let repeat = 0; repeat < 5; repeat += 1) {
        expect(route(config, mode, "session-affinity-1").decision.selected).toBe(first);
      }

      // The session id is what decides the tie: two sessions exist whose
      // winners differ, so the selection is a function of the session rather
      // than of declaration order.
      const pair = disagreeingSessions(config, mode);
      expect(pair).toBeDefined();
      const [sessionA, sessionB] = pair!;
      expect(route(config, mode, sessionA).decision.selected).not.toBe(
        route(config, mode, sessionB).decision.selected,
      );
    });

    test(`${mode}: without a session id the decision is unchanged and disclosed`, () => {
      const config = affinityConfig();
      const result = route(config, mode);
      expect(result.decision.session_affinity).toEqual({
        session_id_present: false,
        applied: false,
      });
      // Declaration order remains the deterministic tie-break without a session.
      expect(result.decision.selected).toBe("prov-a/team");
    });
  }

  test("scored modes: a pooled identical model is session-stable and a worse candidate never joins the pool", () => {
    // The subscription-pool shape this feature exists for: the SAME model
    // served through two providers (identical stats, identical score) plus a
    // clearly worse third. Affinity orders the tied pair per session; the
    // worse candidate sits outside the tie group and is never selected.
    const pooled = affinityConfig({}, {}, { averageLatencyMs: 3_000, inputUsdPerMillionTokens: 50 });
    for (const mode of ["smart", "balanced", "lowest-latency", "highest-throughput"] as const) {
      const pair = disagreeingSessions(pooled, mode);
      expect(pair).toBeDefined();
      for (const sessionId of pair!) {
        const result = route(pooled, mode, sessionId);
        expect(result.decision.session_affinity).toEqual({
          session_id_present: true,
          applied: true,
        });
        expect(["prov-a/team", "prov-b/team"]).toContain(result.decision.selected!);
      }
    }

    // A clearly better candidate is never sacrificed to affinity: prov-b is
    // far slower and far more expensive, so every session gets prov-a.
    const clearWinner = affinityConfig(
      { averageLatencyMs: 300, inputUsdPerMillionTokens: 0.5 },
      { averageLatencyMs: 3_000, inputUsdPerMillionTokens: 50 },
    );
    for (let index = 0; index < 16; index += 1) {
      const result = route(clearWinner, "smart", `clear-winner-session-${index}`);
      expect(result.decision.selected).toBe("prov-a/team");
      expect(result.decision.session_affinity?.applied).toBe(false);
    }
  });

  test("cheapest: price ties are session-stable, a cheaper candidate still wins", () => {
    const cheaper = affinityConfig(
      { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2 },
      { inputUsdPerMillionTokens: 0.5, outputUsdPerMillionTokens: 1 },
    );
    for (let index = 0; index < 16; index += 1) {
      const result = route(cheaper, "cheapest", `cheapest-session-${index}`);
      expect(result.decision.selected).toBe("prov-b/team");
      expect(result.decision.session_affinity?.applied).toBe(false);
    }
  });

  test("fallback: a configured provider_order rank beats affinity; ranked candidates are not shuffled", () => {
    const config = affinityConfig();
    for (let index = 0; index < 16; index += 1) {
      const result = resolveRoute(
        { config, env: ENV },
        {
          model: "team",
          messages: [{ role: "user" as const, content: "hi" }],
          gateway: {
            routing: "fallback",
            provider_order: ["prov-b", "prov-a"],
            sticky_session_id: `ranked-session-${index}`,
          },
        },
      );
      expect(result.decision.selected).toBe("prov-b/team");
      expect(result.decision.session_affinity?.applied).toBe(false);
    }
  });

  test("fallback and explicit: ordered models within a ranked provider are not shuffled", () => {
    const config = affinityConfig();
    config.models.push(affinityModel("prov-a/team-secondary", "prov-a"));
    config.routes = [
      {
        id: "team",
        mode: "fallback",
        modelAliases: ["team"],
        fallbackModelIds: ["prov-a/team", "prov-a/team-secondary", "prov-b/team"],
      },
    ];

    for (const mode of ["fallback", "explicit"] as const) {
      for (let index = 0; index < 64; index += 1) {
        const result = resolveRoute(
          { config, env: ENV },
          {
            model: "team",
            messages: [{ role: "user" as const, content: "hi" }],
            gateway: {
              routing: mode,
              provider_order: ["prov-a"],
              sticky_session_id: `ranked-same-provider-${mode}-${index}`,
            },
          },
        );

        expect(result.candidates.slice(0, 2).map((candidate) => candidate.model.id)).toEqual([
          "prov-a/team",
          "prov-a/team-secondary",
        ]);
        expect(result.decision.selected).toBe("prov-a/team");
        expect(result.decision.session_affinity?.applied).toBe(false);
      }
    }
  });
});
