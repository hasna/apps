import { describe, it, expect } from "bun:test";
import {
  FEATURE_MANIFEST_SCHEMA,
  FEATURE_AREAS,
  ALL_MCP_TOOLS,
  buildFeatureManifest,
  buildMcpToolGroups,
  getCapabilityDiscovery,
  normalizeFeatureManifest,
  formatFeatureManifestReport,
  getFeatureManifestDocs,
  validateFeatureManifest,
  listMcpToolNames,
  categorizeMcpTool,
} from "./feature-manifest.js";

const FIXED_AT = "2026-01-01T00:00:00.000Z";

describe("feature manifest", () => {
  it("lists a stable sorted MCP tool catalog", () => {
    const tools = listMcpToolNames();
    expect(tools.length).toBeGreaterThanOrEqual(290);
    expect(tools).toEqual([...tools].sort());
    expect(new Set(tools).size).toBe(tools.length);
    expect(tools).toContain("get_feature_manifest");
    expect(tools).toContain("get_capability_discovery");
  });

  it("builds manifest with CLI, MCP, profiles, and env vars", () => {
    const manifest = buildFeatureManifest({ profile: "minimal", generated_at: FIXED_AT });

    expect(manifest.schema_version).toBe(FEATURE_MANIFEST_SCHEMA);
    expect(manifest.local_only).toBe(true);
    expect(manifest.generated_at).toBe(FIXED_AT);
    expect(manifest.active_profile).toBe("minimal");
    expect(manifest.cli.command_count).toBeGreaterThan(20);
    expect(manifest.mcp.total_tools).toBe(ALL_MCP_TOOLS.length);
    expect(manifest.mcp.tools_for_profile_count).toBeGreaterThan(0);
    expect(manifest.mcp.tools_for_profile_count).toBeLessThan(manifest.mcp.total_tools);
    expect(manifest.profiles.length).toBe(6);
    expect(manifest.env_vars.length).toBeGreaterThan(5);
    expect(manifest.feature_areas).toEqual(FEATURE_AREAS);
  });

  it("validates manifest structure", () => {
    const manifest = buildFeatureManifest({ generated_at: FIXED_AT });
    expect(validateFeatureManifest(manifest)).toEqual([]);
  });

  it("groups every MCP tool exactly once", () => {
    const groups = buildMcpToolGroups();
    const grouped = groups.flatMap((g) => g.tools);
    expect(grouped.length).toBe(listMcpToolNames().length);
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("categorizes tools deterministically", () => {
    expect(categorizeMcpTool("create_task")).toBe("tasks");
    expect(categorizeMcpTool("get_feature_manifest")).toBe("meta");
    expect(categorizeMcpTool("todos_cloud_push")).toBe("cloud");
  });

  it("normalizes manifest for deterministic snapshots", () => {
    const manifest = buildFeatureManifest({ profile: "standard", generated_at: FIXED_AT });
    const normalized = normalizeFeatureManifest(manifest, FIXED_AT);

    expect(normalized).toMatchSnapshot();
    expect(normalized.generated_at).toBe(FIXED_AT);
    expect(normalized.active_profile).toBe("standard");
  });

  it("discovers capabilities by query and surface", () => {
    const discovery = getCapabilityDiscovery({
      query: "claim",
      surface: "all",
      profile: "agent_safe",
      generated_at: FIXED_AT,
      limit: 20,
    });

    expect(discovery.query).toBe("claim");
    expect(discovery.matches.length).toBeGreaterThan(0);
    expect(discovery.matches.some((m) => m.name.includes("claim") || m.description.includes("claim"))).toBe(true);
    expect(discovery.totals.mcp).toBeGreaterThan(0);
  });

  it("returns feature areas when query is empty", () => {
    const discovery = getCapabilityDiscovery({ generated_at: FIXED_AT, limit: 100 });
    expect(discovery.matches.some((m) => m.kind === "feature_area")).toBe(true);
    expect(discovery.totals.areas).toBe(FEATURE_AREAS.length);
  });

  it("formats human-readable report with fixed timestamp", () => {
    const manifest = buildFeatureManifest({ profile: "minimal", generated_at: FIXED_AT });
    const report = formatFeatureManifestReport(manifest, { deterministic: true });

    expect(report).toContain("=== Todos Feature Manifest (local-only) ===");
    expect(report).toContain(FEATURE_MANIFEST_SCHEMA);
    expect(report).toContain(`Generated: ${FIXED_AT}`);
    expect(report).toContain("Feature areas:");
    expect(report).toMatchSnapshot();
  });

  it("documents discovery locally without hosted URLs", () => {
    const docs = getFeatureManifestDocs();
    expect(docs).toContain(FEATURE_MANIFEST_SCHEMA);
    expect(docs).toContain("todos features list");
    expect(docs).toContain("get_feature_manifest");
    expect(docs).not.toContain("https://");
  });
});
