import { describe, expect, test } from "bun:test";
import {
  accountedGlobalSourceSlugs,
  computeGlobalSourceCoverage,
  expectedGlobalSourceSlugs,
  formatGlobalSourceCoverageWarnings,
  RETIRED_GLOBAL_SOURCE_TAG,
} from "./global-source-coverage.js";
import { planSessionRender } from "./session-render.js";

// Regression fixture for todos 102d6d0a / 5dcd60ec: 29 registered `global-*`
// sources on station01, 16 of them in the hand-maintained GLOBAL_CONFIGS array,
// 13 silently unrendered (1 deliberately retired, 2 fossils feeding another
// render path, 10 live gaps). This fixture mirrors that exact shape at reduced
// scale so the test documents the real incident rather than a synthetic one.
const prose = { format: "markdown" as const, is_template: false, content: "Reviewed synthetic instruction.", target_path: null };
const REGISTRY = [
  { ...prose, slug: "global-fix-on-sight", category: "rules" as const, tags: [] },
  { ...prose, slug: "global-credential-exposure-hygiene", category: "rules" as const, tags: [] },
  { ...prose, slug: "global-mementos-discipline", category: "rules" as const, tags: [] },
  // Deliberately withdrawn (owner ruling, 2026-07-29) — tagged so the checker
  // does not perpetually flag an intentional omission as a defect.
  { ...prose, slug: "global-hasna-deployment-terms", category: "rules" as const, tags: [RETIRED_GLOBAL_SOURCE_TAG] },
  // Registered today, never added to any render's config list — the live gap.
  { ...prose, slug: "global-capture-path-command-instrument", category: "rules" as const, tags: [] },
  { ...prose, slug: "global-paste-the-control-output", category: "rules" as const, tags: [] },
  // Not a global-* slug at all — must never enter the expected set.
  { ...prose, slug: "agent-ceo-charter-codewith", category: "rules" as const, tags: [] },
];

describe("expectedGlobalSourceSlugs", () => {
  test("uses compiler eligibility so settings, templates and retired sources cannot make coverage impossible", () => {
    const base = { ...prose, slug: "global-reviewed-rule", category: "rules" as const, tags: [] as string[] };
    const registry = [
      base,
      { ...base, slug: "global-agent-settings", category: "agent" as const },
      { ...base, slug: "global-tool-settings", category: "tools" as const },
      { ...base, slug: "global-json", format: "json" as const },
      { ...base, slug: "global-template", is_template: true },
      { ...base, slug: "global-empty", content: "" },
      { ...base, slug: "global-binary", content: "bytes\0binary" },
      { ...base, slug: "global-shell", target_path: "/synthetic/setup.sh" },
      { ...base, slug: "global-retired", tags: ["retired-instruction-source"] },
      { ...base, slug: "global-config", tags: ["config-only"] },
    ];
    expect(expectedGlobalSourceSlugs(registry)).toEqual([base.slug]);
    const result = computeGlobalSourceCoverage(registry, [base.slug]);
    expect(result.complete).toBe(true);
    expect(result.excludedSources).toHaveLength(9);
    expect(result.excludedSources.find((source) => source.slug === "global-agent-settings")?.reason).toContain("category agent");
    expect(computeGlobalSourceCoverage(registry, []).missingSlugs).toEqual([base.slug]);
  });

  test("includes only slug-prefixed, non-retired sources", () => {
    const expected = expectedGlobalSourceSlugs(REGISTRY);
    expect(expected).toEqual([
      "global-capture-path-command-instrument",
      "global-credential-exposure-hygiene",
      "global-fix-on-sight",
      "global-mementos-discipline",
      "global-paste-the-control-output",
    ].sort());
  });

  test("retired sources are excluded even though they carry the global- prefix", () => {
    const expected = expectedGlobalSourceSlugs(REGISTRY);
    expect(expected).not.toContain("global-hasna-deployment-terms");
  });
});

describe("computeGlobalSourceCoverage — the constructed-shortfall requirement", () => {
  // This is the acceptance test fabricius/Maecenas specified: the denominator
  // (registry) and numerator (render) must be independent enough that removing
  // one configured source measurably moves the fraction. A checker that derives
  // both sides from the same list cannot fail this test — it always reports
  // full coverage, because there is nothing else to compare against.

  const fullRenderSlugs = [
    "global-fix-on-sight",
    "global-credential-exposure-hygiene",
    "global-mementos-discipline",
    "global-capture-path-command-instrument",
    "global-paste-the-control-output",
  ];

  test("a render carrying every expected source reports complete coverage", () => {
    const result = computeGlobalSourceCoverage(REGISTRY, fullRenderSlugs);
    expect(result.complete).toBe(true);
    expect(result.missingSlugs).toEqual([]);
    expect(formatGlobalSourceCoverageWarnings(result)).toEqual([]);
  });

  test("removing ONE --config entry from the render moves the fraction: 0 missing -> 1 missing", () => {
    const before = computeGlobalSourceCoverage(REGISTRY, fullRenderSlugs);
    expect(before.missingSlugs.length).toBe(0);

    // Simulate exactly the real defect: a source registered in the DB (the
    // registry) but never added to a render's --config list (the array).
    const shortRenderSlugs = fullRenderSlugs.filter(
      (slug) => slug !== "global-capture-path-command-instrument",
    );
    const after = computeGlobalSourceCoverage(REGISTRY, shortRenderSlugs);

    expect(after.missingSlugs.length).toBe(1);
    expect(after.missingSlugs).toEqual(["global-capture-path-command-instrument"]);
    expect(after.complete).toBe(false);
    expect(before.missingSlugs.length).not.toBe(after.missingSlugs.length);

    const warnings = formatGlobalSourceCoverageWarnings(after);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("global-capture-path-command-instrument");
    expect(warnings[0]).toContain("4/5");
  });

  test("removing all configured sources reports every expected slug missing", () => {
    const result = computeGlobalSourceCoverage(REGISTRY, []);
    expect(result.missingSlugs).toEqual(expectedGlobalSourceSlugs(REGISTRY));
    expect(result.complete).toBe(false);
  });

  test("a render source that is not in the registry (renamed/removed) is reported as unexpected, not swallowed", () => {
    const result = computeGlobalSourceCoverage(REGISTRY, [
      ...fullRenderSlugs,
      "global-some-renamed-or-deleted-source",
    ]);
    expect(result.unexpectedSlugs).toEqual(["global-some-renamed-or-deleted-source"]);
    // Being unexpected must never mask a real omission elsewhere.
    expect(result.complete).toBe(true);
  });

  test("a retired source configured accidentally does not count against completeness or as unexpected non-global noise", () => {
    // Deployment-terms is retired; if some stale render still lists it that is
    // not this checker's concern (it does not appear in `expected`, and since
    // it IS a global-* slug it is reported as unexpected, which is correct: the
    // render is carrying a source the registry no longer wants rendered).
    const result = computeGlobalSourceCoverage(REGISTRY, [
      ...fullRenderSlugs,
      "global-hasna-deployment-terms",
    ]);
    expect(result.complete).toBe(true);
    expect(result.unexpectedSlugs).toEqual(["global-hasna-deployment-terms"]);
  });

  test("a configured global source intentionally collapsed by the real render plan remains accounted for", () => {
    const olderId = "global-rules-9-9-8";
    const newerId = "global-rules-9-9-9";
    const rulesPayload = (version: string, body: string) => [
      `# Hasna Agent Operating Rules — v${version} (2026-08-02)`,
      `<!-- hasna:agent-operating-rules v=${version} -->`,
      body,
    ].join("\n");
    const plan = planSessionRender({
      tool: "claude",
      profile: "global-coverage-regression",
      targetHome: "/tmp/global-coverage-regression-home",
      generatedAt: "2026-08-02T00:00:00.000Z",
      sources: [
        { id: olderId, label: "Older rules", layer: "global", order: 0, content: rulesPayload("9.9.8", "Older policy body.") },
        { id: newerId, label: "Newer rules", layer: "global", order: 1, content: rulesPayload("9.9.9", "Newer policy body.") },
      ],
    });

    expect(plan.manifest.sources.map((source) => source.id)).toEqual([newerId]);
    expect(plan.manifest.skippedSources.map((source) => source.id)).toEqual([olderId]);

    const result = computeGlobalSourceCoverage(
      [
        { ...prose, slug: olderId, category: "rules" as const, tags: [] },
        { ...prose, slug: newerId, category: "rules" as const, tags: [] },
      ],
      accountedGlobalSourceSlugs(plan.manifest),
    );

    expect(result.configuredSlugs).toEqual([newerId, olderId].sort());
    expect(result.missingSlugs).toEqual([]);
    expect(result.complete).toBe(true);
  });
});

describe("computeGlobalSourceCoverage — production-shaped reconciliation (P1 #1)", () => {
  // Live production shape measured 2026-08-02. IMPORTANT CORRECTION mid-remediation
  // (fabricius, relaying a second agent's measurement): global-agent-rules-standard-1/
  // -2/-3 are NOT a static, intentionally-excluded "backstop family". They are
  // byte-identical (sha256 8b236086b82e) output of a LIVE, currently-unfixed defect
  // (`43d0c1c0`: `instructions add` mints a duplicate row for an existing target_path)
  // that fired twice in the 40 minutes before this test was written. Tagging them
  // `retired-global-source` would mark the OUTPUT OF AN ACTIVE BUG as intentional
  // design — hiding it from exactly the surface this checker exists to surface it on
  // — and the family is unbounded (a `-4`, `-5`, ... will keep minting untagged).
  //
  // The claim this task's original brief carried — "the base slug
  // global-agent-rules-standard feeds the embedded-baseline fallback via a different
  // render path, so it never needs to be in --config" — was checked against
  // `ensureGlobalAgentRulesStandardConfig` (global-agent-rules-standard.ts) and does
  // NOT hold: that function only maintains the STORED row's content (seed/repair on
  // publish), it does not inject the row into any render bypassing the --config list.
  // A sibling claim that it renders via three homes' rendered fragments was
  // independently refuted. So the base slug's exclusion from GLOBAL_CONFIGS is an
  // UNVERIFIED design choice, not a confirmed one — it is left as a visible gap
  // rather than silently exempted, so a human resolves it instead of this checker
  // guessing.
  //
  // Only ONE row in this family gets the tag: global-hasna-deployment-terms, which is
  // a genuine, dated, owner-ruled withdrawal (knowledge k_ms5a5hmy_hllrbg) — the exact
  // case RETIRED_GLOBAL_SOURCE_TAG's own doc comment describes, and the only row in
  // this whole set with a real justification behind it rather than an inherited,
  // unverified assumption. It was applied against the live production registry via
  // the new `instructions tag` command (src/cli/index.tsx), not asserted here as a
  // fait accompli.
  const PROD_SHAPED_REGISTRY = [
    { ...prose, slug: "global-hasna-deployment-terms", category: "rules" as const, tags: [RETIRED_GLOBAL_SOURCE_TAG] },
    { ...prose, slug: "global-agent-rules-standard", category: "rules" as const, tags: ["global", "mandatory"] },
    { ...prose, slug: "global-agent-rules-standard-1", category: "rules" as const, tags: [] },
    { ...prose, slug: "global-agent-rules-standard-2", category: "rules" as const, tags: [] },
    { ...prose, slug: "global-agent-rules-standard-3", category: "rules" as const, tags: [] },
    { ...prose, slug: "global-fix-once", category: "rules" as const, tags: [] },
    { ...prose, slug: "global-no-mcp-use-clis", category: "rules" as const, tags: [] },
  ];
  const liveArrayConfiguredSlugs = ["global-fix-once", "global-no-mcp-use-clis"];

  test("the owner-withdrawn source alone is excluded from expected; the mint-bug family and base slug remain VISIBLE GAPS", () => {
    const result = computeGlobalSourceCoverage(PROD_SHAPED_REGISTRY, liveArrayConfiguredSlugs);
    expect(result.expectedSlugs).not.toContain("global-hasna-deployment-terms");
    // These four are deliberately NOT suppressed: they are either active-bug output
    // or an unverified exclusion, and this checker's job is to surface them, not
    // hide them behind a tag nobody can justify.
    expect(result.missingSlugs.sort()).toEqual([
      "global-agent-rules-standard",
      "global-agent-rules-standard-1",
      "global-agent-rules-standard-2",
      "global-agent-rules-standard-3",
    ].sort());
    expect(result.complete).toBe(false);
  });

  test("a NEWLY MINTED duplicate (-4, from the same live defect) shows up as a gap with zero code changes here", () => {
    // This is the property that rules out a hardcoded slug list as a fix: the
    // checker must not need to know the family's membership to correctly report
    // an as-yet-unseen member as missing. Registering -4 and re-running proves it.
    const registryWithMint = [
      ...PROD_SHAPED_REGISTRY,
      { ...prose, slug: "global-agent-rules-standard-4", category: "rules" as const, tags: [] },
    ];
    const result = computeGlobalSourceCoverage(registryWithMint, liveArrayConfiguredSlugs);
    expect(result.missingSlugs).toContain("global-agent-rules-standard-4");
  });

  test("an unrelated genuine gap in the same registry still reports missing (the check has not gone vacuous)", () => {
    const registryWithGenuineGap = [
      ...PROD_SHAPED_REGISTRY,
      { ...prose, slug: "global-a-tenth-genuine-gap", category: "rules" as const, tags: [] },
    ];
    const result = computeGlobalSourceCoverage(registryWithGenuineGap, liveArrayConfiguredSlugs);
    expect(result.missingSlugs).toContain("global-a-tenth-genuine-gap");
    expect(result.complete).toBe(false);
  });
});
