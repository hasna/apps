import { describe, expect, test } from "bun:test";
import {
  type CaptureFrontmatter,
  CAPTURE_KIND,
  CAPTURE_SCHEMA_VERSION,
  CaptureFrontmatterSchema,
  parseCaptureDocument,
  parseFrontmatter,
  renderFrontmatter,
  renderFrontmatterBlock,
} from "./frontmatter.js";

function sampleFm(overrides: Partial<CaptureFrontmatter> = {}): CaptureFrontmatter {
  return {
    schema_version: CAPTURE_SCHEMA_VERSION,
    capture_id: "capture-abc123",
    kind: CAPTURE_KIND,
    query: "bun sqlite fts5",
    providers: ["google", "exa"],
    profile_id: null,
    result_count: 2,
    duration_ms: 1234,
    captured_at: "2026-08-19T12:00:00.000Z",
    capture_point: "cli",
    redacted: false,
    ...overrides,
  };
}

describe("renderFrontmatter", () => {
  test("renders scalars, lists, booleans and null in YAML shape", () => {
    const yaml = renderFrontmatter(sampleFm());
    expect(yaml).toContain("schema_version: 1");
    expect(yaml).toContain("capture_id: capture-abc123");
    expect(yaml).toContain("kind: search-capture");
    expect(yaml).toContain("query: bun sqlite fts5");
    expect(yaml).toContain("providers:");
    expect(yaml).toContain("  - google");
    expect(yaml).toContain("  - exa");
    expect(yaml).toContain("profile_id: null");
    expect(yaml).toContain("result_count: 2");
    expect(yaml).toContain("duration_ms: 1234");
    expect(yaml).toContain("captured_at: 2026-08-19T12:00:00.000Z");
    expect(yaml).toContain("capture_point: cli");
    expect(yaml).toContain("redacted: false");
  });

  test("quotes values that would be ambiguous in plain YAML", () => {
    const yaml = renderFrontmatter(sampleFm({ query: "token: value" }));
    expect(yaml).toContain('query: "token: value"');
  });
});

describe("parseFrontmatter", () => {
  test("round-trips a rendered block", () => {
    const fm = sampleFm();
    const parsed = parseFrontmatter(renderFrontmatter(fm));
    expect(parsed).toEqual({
      schema_version: 1,
      capture_id: "capture-abc123",
      kind: "search-capture",
      query: "bun sqlite fts5",
      providers: ["google", "exa"],
      profile_id: null,
      result_count: 2,
      duration_ms: 1234,
      captured_at: "2026-08-19T12:00:00.000Z",
      capture_point: "cli",
      redacted: false,
    });
  });

  test("preserves unknown keys so newer captures stay readable", () => {
    const parsed = parseFrontmatter("schema_version: 9\nfuture_key: hello");
    expect(parsed["future_key"]).toBe("hello");
  });

  test("rejects a malformed line", () => {
    expect(() => parseFrontmatter("no colon here")).toThrow(/malformed frontmatter/);
  });
});

describe("parseCaptureDocument", () => {
  test("parses and validates a full document", () => {
    const fm = sampleFm();
    const doc = `${renderFrontmatterBlock(fm)}\n\n# bun sqlite fts5\n\n*2 results*`;
    const parsed = parseCaptureDocument(doc);
    expect(CaptureFrontmatterSchema.parse(parsed)).toEqual(fm);
  });

  test("throws when the frontmatter fence is missing", () => {
    expect(() => parseCaptureDocument("# no frontmatter")).toThrow(
      /missing its frontmatter fence/,
    );
  });

  test("throws when the frontmatter is not closed", () => {
    expect(() => parseCaptureDocument("---\nschema_version: 1")).toThrow(
      /not closed/,
    );
  });
});

describe("schema validation", () => {
  test("rejects a wrong schema version", () => {
    expect(() => CaptureFrontmatterSchema.parse(sampleFm({ schema_version: 2 }))).toThrow();
  });

  test("rejects an invalid provider", () => {
    expect(() =>
      CaptureFrontmatterSchema.parse(
        sampleFm({ providers: ["not-a-provider"] as never }),
      ),
    ).toThrow();
  });

  test("rejects a non-datetime captured_at", () => {
    expect(() =>
      CaptureFrontmatterSchema.parse(sampleFm({ captured_at: "2026-08-19" })),
    ).toThrow();
  });
});
