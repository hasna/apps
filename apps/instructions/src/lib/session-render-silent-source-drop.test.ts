import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  planSessionRender,
  sourcesFromIdentityExport,
  type SessionInstructionSource,
} from "./session-render";

/**
 * Regression cover for todos 0c7ffd33 — `session plan` / `session apply` discarded
 * instruction sources with NO trace: exit 0, `warnings: []`, `skippedSources: []`.
 *
 * The reported symptom was "more than 15 sources loses one", and the count was a red
 * herring. Two independent code paths drop sources by design, and BOTH were silent:
 *
 *  1. `deduplicateSemanticPolicySources` collapses every payload carrying the
 *     `hasna:agent-operating-rules` sentinel down to one.
 *  2. `composeSources` drops every non-`nonOverridable` source that precedes a
 *     `merge: "replace"` source.
 *
 * Collapsing is CORRECT — one instruction home must not be stamped with two
 * contradictory rule-set versions. Doing it invisibly is the defect: an operator
 * comparing the slugs they passed against `manifest.sources` sees a source vanish and
 * has no surface that says so. These tests assert the loss is REPORTED, not that it
 * stops happening.
 */

/**
 * Both fixtures sit ABOVE the embedded baseline version on purpose. Below-baseline
 * content is rewritten by the currency floor, which also stamps it with the
 * agent-operating-rules role — that changes the collapse's priority tie-break and would
 * couple this regression to selection semantics it is not testing. Above the baseline
 * both payloads pass through untouched, so the survivor is decided by version alone and
 * these tests assert only what they are about: that the loser is REPORTED.
 */
const OLDER = "9.9.8";
const NEWER = "9.9.9";
const OLDER_ID = `rules-${OLDER}`;
const NEWER_ID = `rules-${NEWER}`;

const OPERATING_RULES_SENTINEL = (version: string) => `<!-- hasna:agent-operating-rules v=${version} -->`;

function rulesPayload(version: string, body: string): string {
  return [
    `# Hasna Agent Operating Rules — v${version} (2026-08-02)`,
    OPERATING_RULES_SENTINEL(version),
    body,
  ].join("\n");
}

function plan(sources: SessionInstructionSource[]) {
  return planSessionRender({
    tool: "claude",
    profile: "octavia-regression",
    targetHome: "/tmp/octavia-regression-home",
    generatedAt: "2026-08-02T00:00:00.000Z",
    sources,
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("session render reports every source it discards (todos 0c7ffd33)", () => {
  /**
   * The PASSING state of the whole probe. Two ordinary sources must survive untouched
   * with both reporting surfaces empty — without this, a fix that simply appended a
   * warning to every render would look green while telling operators nothing.
   */
  test("negative control — nothing is dropped, so nothing is reported", () => {
    const result = plan([
      { id: "plain-a", label: "Plain A", layer: "global", order: 0, content: "Alpha guidance." },
      { id: "plain-b", label: "Plain B", layer: "global", order: 1, content: "Beta guidance." },
    ]);

    expect(result.manifest.sources.map((source) => source.id)).toEqual(["plain-a", "plain-b"]);
    expect(result.manifest.skippedSources).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.manifest.warnings).toEqual([]);
  });

  test("a semantic-policy collapse names the discarded source in skippedSources", () => {
    const result = plan([
      { id: OLDER_ID, label: `Rules v${OLDER}`, layer: "global", order: 0, content: rulesPayload(OLDER, "Older policy body.") },
      { id: NEWER_ID, label: `Rules v${NEWER}`, layer: "global", order: 1, content: rulesPayload(NEWER, "Newer policy body.") },
    ]);

    // The collapse itself is intended and is preserved: exactly one policy survives.
    expect(result.manifest.sources.map((source) => source.id)).toEqual([NEWER_ID]);

    // ...and the loser is now visible instead of vanishing.
    const skipped = result.manifest.skippedSources;
    expect(skipped.map((entry) => entry.id)).toEqual([OLDER_ID]);
    expect(skipped[0]!.label).toBe(`Rules v${OLDER}`);
    expect(skipped[0]!.reason).toContain("hasna:agent-operating-rules");
  });

  test("a semantic-policy collapse also raises a warning an operator can see", () => {
    const result = plan([
      { id: OLDER_ID, label: `Rules v${OLDER}`, layer: "global", order: 0, content: rulesPayload(OLDER, "Older policy body.") },
      { id: NEWER_ID, label: `Rules v${NEWER}`, layer: "global", order: 1, content: rulesPayload(NEWER, "Newer policy body.") },
    ]);

    // `warnings` is the surface the human CLI output prints; the manifest copy is what
    // an automated consumer reads. A fix that populated only one of them would leave
    // half the fleet's callers still blind.
    expect(result.warnings.some((warning) => warning.includes(OLDER_ID))).toBe(true);
    expect(result.manifest.warnings.some((warning) => warning.includes(OLDER_ID))).toBe(true);
  });

  test("the collapse is reported whichever source wins, so the report is not position-keyed", () => {
    // Reversed argument order: the newer payload now comes FIRST, so the discarded
    // source is not the last one passed. The originally reported symptom included
    // exactly this ("lost a config that was NOT the last"), which is why the reporter
    // could not steer it by appending a sacrificial slug.
    const result = plan([
      { id: NEWER_ID, label: `Rules v${NEWER}`, layer: "global", order: 0, content: rulesPayload(NEWER, "Newer policy body.") },
      { id: OLDER_ID, label: `Rules v${OLDER}`, layer: "global", order: 1, content: rulesPayload(OLDER, "Older policy body.") },
    ]);

    expect(result.manifest.sources.map((source) => source.id)).toEqual([NEWER_ID]);
    expect(result.manifest.skippedSources.map((entry) => entry.id)).toEqual([OLDER_ID]);
  });

  test("a replace-merge source reports the earlier sources it supersedes", () => {
    const result = plan([
      { id: "superseded", label: "Superseded", layer: "global", order: 0, content: "Replaced guidance." },
      { id: "protected", label: "Protected", layer: "global", order: 1, content: "Kept guidance.", nonOverridable: true },
      { id: "replacer", label: "Replacer", layer: "global", order: 2, merge: "replace", content: "Authoritative guidance." },
    ]);

    // `nonOverridable` sources survive a replace; ordinary earlier ones do not.
    expect(result.manifest.sources.map((source) => source.id)).toEqual(["protected", "replacer"]);

    const skipped = result.manifest.skippedSources;
    expect(skipped.map((entry) => entry.id)).toEqual(["superseded"]);
    expect(skipped[0]!.reason).toContain("replace");
    expect(result.warnings.some((warning) => warning.includes("superseded"))).toBe(true);
  });

  test("caller-supplied skipped sources survive alongside render-time ones", () => {
    // `instructions session apply --profile` feeds provider-filtered configs in through
    // `input.skippedSources`. Those entries predate this fix and must not be clobbered
    // by the render-time list.
    const result = planSessionRender({
      tool: "claude",
      profile: "octavia-regression",
      targetHome: "/tmp/octavia-regression-home",
      generatedAt: "2026-08-02T00:00:00.000Z",
      skippedSources: [
        { id: "provider-filtered", label: "Provider Filtered", targetProviders: ["opencode"], reason: "rule targets a different provider" },
      ],
      sources: [
        { id: OLDER_ID, label: `Rules v${OLDER}`, layer: "global", order: 0, content: rulesPayload(OLDER, "Older policy body.") },
        { id: NEWER_ID, label: `Rules v${NEWER}`, layer: "global", order: 1, content: rulesPayload(NEWER, "Newer policy body.") },
      ],
    });

    expect(result.manifest.skippedSources.map((entry) => entry.id)).toEqual(["provider-filtered", OLDER_ID]);
  });

  test("many sources are not themselves a cause of loss", () => {
    // The bug was reported as a cap at 15. It is not a cap: 24 ordinary sources all
    // survive. This asserts the count is irrelevant so the false diagnosis cannot
    // quietly return.
    const sources: SessionInstructionSource[] = Array.from({ length: 24 }, (_, index) => ({
      id: `bulk-${String(index).padStart(2, "0")}`,
      label: `Bulk ${index}`,
      layer: "global" as const,
      order: index,
      content: `Guidance number ${index}.`,
    }));

    const result = plan(sources);

    expect(result.manifest.sources).toHaveLength(24);
    expect(result.manifest.skippedSources).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe("targeted source replacement (goal 36dd6ed8)", () => {
  const sharedReview = "Shared review requires two reviewers.";
  const r11 = "R11 recording eagerness remains byte-for-byte present.";
  const r12 = "R12 session self-scheduling remains byte-for-byte present.";
  const protectedSafety = "Non-overridable safety remains byte-for-byte present.";
  const codewithReview = "Codewith review requires one reviewer.";

  function targetedSources(): SessionInstructionSource[] {
    return [
      { id: "shared-review", layer: "global", order: 0, content: sharedReview },
      { id: "r11-recording", layer: "global", order: 1, content: r11 },
      { id: "r12-scheduling", layer: "global", order: 2, content: r12 },
      {
        id: "protected-safety",
        layer: "global",
        order: 3,
        content: protectedSafety,
        nonOverridable: true,
      },
      {
        id: "codewith-review",
        layer: "global",
        order: 4,
        merge: "replace",
        replacementScope: "source:shared-review",
        content: codewithReview,
        provenance: { source: "identity-export" },
      },
    ];
  }

  test("removes only the named earlier overridable source and preserves unrelated bytes", () => {
    const result = plan(targetedSources());
    const rendered = result.allFiles.map((file) => file.content).join("\n");

    expect(result.manifest.sources.map((source) => source.id)).toEqual([
      "r11-recording",
      "r12-scheduling",
      "protected-safety",
      "codewith-review",
    ]);
    expect(rendered).not.toContain(sharedReview);
    expect(rendered).toContain(r11);
    expect(rendered).toContain(r12);
    expect(rendered).toContain(protectedSafety);
    expect(rendered).toContain(codewithReview);

    const r11Manifest = result.manifest.sources.find((source) => source.id === "r11-recording");
    const r12Manifest = result.manifest.sources.find((source) => source.id === "r12-scheduling");
    const protectedManifest = result.manifest.sources.find((source) => source.id === "protected-safety");
    expect(r11Manifest?.renderedPayloadSha256).toBe(sha256(r11));
    expect(r12Manifest?.renderedPayloadSha256).toBe(sha256(r12));
    expect(protectedManifest?.renderedPayloadSha256).toBe(sha256(protectedSafety));
  });

  test("records the targeted relation in skipped sources and replacer provenance", () => {
    const result = plan(targetedSources());
    const replacer = result.manifest.sources.find((source) => source.id === "codewith-review");

    expect(result.manifest.skippedSources).toHaveLength(1);
    expect(result.manifest.skippedSources[0]).toMatchObject({ id: "shared-review" });
    expect(result.manifest.skippedSources[0]!.reason).toContain("source:shared-review");
    expect(replacer?.replacementScope).toBe("source:shared-review");
    expect(replacer?.provenance).toMatchObject({
      source: "identity-export",
      targetedReplacement: {
        scope: "source:shared-review",
        targetSourceId: "shared-review",
        targetNormalizedSourceId: "shared-review",
      },
    });
  });

  test("targeted replacement changes the source hash", () => {
    const appended = targetedSources().map((source) =>
      source.id === "codewith-review"
        ? { ...source, merge: "append" as const, replacementScope: undefined }
        : source
    );

    expect(plan(targetedSources()).manifest.sourceHash).not.toBe(plan(appended).manifest.sourceHash);
  });

  test("identity-exported replacementScope follows the same composition contract", () => {
    const sources = sourcesFromIdentityExport({
      contract: "hasna.identities.configs-instructions/v1",
      validation: { valid: true },
      sources: targetedSources().map((source) => ({
        id: source.id,
        title: source.id,
        kind: "global-rules",
        precedence: source.order,
        mergePolicy: source.merge ?? "append",
        content: source.content,
        nonOverridable: source.nonOverridable ?? false,
        replacementScope: source.replacementScope,
        provenance: source.provenance,
      })),
    }, { tool: "claude" });

    const result = plan(sources);
    expect(result.manifest.sources.map((source) => source.id)).toEqual([
      "r11-recording",
      "r12-scheduling",
      "protected-safety",
      "codewith-review",
    ]);
    expect(result.manifest.skippedSources.map((source) => source.id)).toEqual(["shared-review"]);
  });

  test("two targeted replacers compose left to right without deleting unrelated sources", () => {
    const result = plan([
      { id: "target-a", layer: "global", order: 0, content: "Target A." },
      { id: "unrelated", layer: "global", order: 1, content: "Unrelated." },
      { id: "target-b", layer: "global", order: 2, content: "Target B." },
      {
        id: "replacer-a",
        layer: "global",
        order: 3,
        merge: "replace",
        replacementScope: "source:target-a",
        content: "Replacer A.",
      },
      {
        id: "replacer-b",
        layer: "global",
        order: 4,
        merge: "replace",
        replacementScope: "source:target-b",
        content: "Replacer B.",
      },
    ]);

    expect(result.manifest.sources.map((source) => source.id)).toEqual([
      "unrelated",
      "replacer-a",
      "replacer-b",
    ]);
    expect(result.manifest.skippedSources.map((source) => source.id)).toEqual(["target-a", "target-b"]);
  });

  test("fails closed when the targeted source is missing", () => {
    expect(() => plan([
      {
        id: "replacer",
        layer: "global",
        order: 0,
        merge: "replace",
        replacementScope: "source:missing",
        content: "Replacer.",
      },
    ])).toThrow("missing");
  });

  test("fails closed when the targeted source appears later", () => {
    expect(() => plan([
      {
        id: "replacer",
        layer: "global",
        order: 0,
        merge: "replace",
        replacementScope: "source:later-target",
        content: "Replacer.",
      },
      { id: "later-target", layer: "global", order: 1, content: "Later target." },
    ])).toThrow("later");
  });

  test("fails closed when an earlier replacer already removed the target", () => {
    expect(() => plan([
      { id: "target", layer: "global", order: 0, content: "Target." },
      {
        id: "first-replacer",
        layer: "global",
        order: 1,
        merge: "replace",
        replacementScope: "source:target",
        content: "First replacer.",
      },
      {
        id: "second-replacer",
        layer: "global",
        order: 2,
        merge: "replace",
        replacementScope: "source:target",
        content: "Second replacer.",
      },
    ])).toThrow("already removed");
  });

  test("fails closed when the target is ambiguous after normalization", () => {
    expect(() => plan([
      { id: "shared_review", layer: "global", order: 0, content: "First target." },
      { id: "shared-review", layer: "global", order: 1, content: "Second target." },
      {
        id: "replacer",
        layer: "global",
        order: 2,
        merge: "replace",
        replacementScope: "source:shared-review",
        content: "Replacer.",
      },
    ])).toThrow("ambiguous");
  });

  test("fails closed on unknown replacement scope syntax", () => {
    expect(() => plan([
      { id: "target", layer: "global", order: 0, content: "Target." },
      {
        id: "replacer",
        layer: "global",
        order: 1,
        merge: "replace",
        replacementScope: "rule:target",
        content: "Replacer.",
      },
    ])).toThrow("replacement scope");
  });

  test("fails closed when append mode carries a replacement scope", () => {
    expect(() => plan([
      { id: "target", layer: "global", order: 0, content: "Target." },
      {
        id: "replacer",
        layer: "global",
        order: 1,
        merge: "append",
        replacementScope: "source:target",
        content: "Replacer.",
      },
    ])).toThrow("append");
  });

  test("fails closed when the targeted source is non-overridable", () => {
    expect(() => plan([
      {
        id: "protected-target",
        layer: "global",
        order: 0,
        content: "Protected target.",
        nonOverridable: true,
      },
      {
        id: "replacer",
        layer: "global",
        order: 1,
        merge: "replace",
        replacementScope: "source:protected-target",
        content: "Replacer.",
      },
    ])).toThrow("non-overridable");
  });

  test("unscoped replace remains broad for compatibility", () => {
    const result = plan([
      { id: "ordinary-a", layer: "global", order: 0, content: "Ordinary A." },
      { id: "ordinary-b", layer: "global", order: 1, content: "Ordinary B." },
      {
        id: "protected",
        layer: "global",
        order: 2,
        content: "Protected.",
        nonOverridable: true,
      },
      { id: "broad-replacer", layer: "global", order: 3, merge: "replace", content: "Broad." },
    ]);

    expect(result.manifest.sources.map((source) => source.id)).toEqual(["protected", "broad-replacer"]);
    expect(result.manifest.skippedSources.map((source) => source.id)).toEqual(["ordinary-a", "ordinary-b"]);
  });

  test("fails when semantic-policy deduplication removed the target before replacement", () => {
    expect(() => plan([
      {
        id: OLDER_ID,
        label: `Rules v${OLDER}`,
        layer: "global",
        order: 0,
        content: rulesPayload(OLDER, "Older policy body."),
      },
      {
        id: NEWER_ID,
        label: `Rules v${NEWER}`,
        layer: "global",
        order: 1,
        content: rulesPayload(NEWER, "Newer policy body."),
      },
      {
        id: "replacer",
        layer: "global",
        order: 2,
        merge: "replace",
        replacementScope: "source:rules-9-9-8",
        content: "Replacer.",
      },
    ])).toThrow("deduplication");
  });
});
