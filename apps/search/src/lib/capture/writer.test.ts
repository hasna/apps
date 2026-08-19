import { describe, expect, test, beforeEach } from "bun:test";
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { REDACTION_PLACEHOLDER } from "../redaction.js";
import type { Search, SearchResult } from "../../types/index.js";
import {
  SearchCaptureWriter,
  captureConfigFromEnv,
  isCaptureConfigured,
  type SearchCaptureInput,
} from "./writer.js";
import { parseCaptureDocument } from "./frontmatter.js";

/**
 * Credential-shaped sentinel built fully dynamically — no credential-shaped
 * literal may exist in this source, or the added-lines scan flags the
 * fixture itself (measured: CI's anthropic-key detector matches the static
 * prefix).
 */
function sentinel(): string {
  const prefix = ["sk", "ant", "api03"].join("-");
  return prefix + "-" + "abcdef0123456789abcdef0123456789abcdef01";
}

/**
 * Private-key-block sentinel — the redactor does not touch it, the scanner
 * must. Built fully dynamically so no credential-shaped literal exists in
 * this source (the staged scan would refuse the fixture itself).
 */
function keyBlockSentinel(): string {
  const header = ["-----BEGIN", "PRIVATE", "KEY-----"].join(" ");
  const footer = ["-----END", "PRIVATE", "KEY-----"].join(" ");
  const body = "MIIEowIBAAKCAQEA" + "abcdefghijklmnopqrstuvwxyz0123456789";
  return `${header}\n${body}\n${footer}`;
}

function sampleSearch(): Search {
  return {
    id: "capture-abc123",
    query: "bun sqlite fts5",
    providers: ["google", "exa"],
    profileId: null,
    resultCount: 2,
    duration: 1234,
    createdAt: "2026-08-19T12:00:00.000Z",
  };
}

function sampleResults(): SearchResult[] {
  return [
    {
      id: "r1",
      searchId: "capture-abc123",
      title: "Result One",
      url: "https://one.com",
      snippet: "First result",
      source: "google",
      provider: "Google",
      rank: 1,
      score: 0.9,
      publishedAt: null,
      thumbnail: null,
      metadata: {},
      createdAt: "2026-08-19T12:00:00.000Z",
    },
    {
      id: "r2",
      searchId: "capture-abc123",
      title: "Result Two",
      url: "https://two.com",
      snippet: "Second result",
      source: "exa",
      provider: "Exa",
      rank: 2,
      score: 0.7,
      publishedAt: "2026-08-18T10:00:00.000Z",
      thumbnail: null,
      metadata: {},
      createdAt: "2026-08-19T12:00:00.000Z",
    },
  ];
}

function sampleInput(overrides: Partial<SearchCaptureInput> = {}): SearchCaptureInput {
  return {
    search: sampleSearch(),
    results: sampleResults(),
    capturePoint: "cli",
    ...overrides,
  };
}

/**
 * Fake S3 client over the REAL SDK Command contract: it refuses anything
 * that is not an instance of an @aws-sdk/client-s3 Command class, mirroring
 * the real S3Client which calls `command.resolveMiddleware(...)` on every
 * send.
 */
class FakeS3 {
  objects = new Map<string, { body: string }>();
  failNextPut: Error | null = null;
  failNextHead: Error | null = null;
  wrongHeadLengthOnce = false;
  deletes: string[] = [];
  sent: Array<{ cmd: string; input: Record<string, unknown> }> = [];

  async send(command: unknown): Promise<unknown> {
    if (
      !(command instanceof PutObjectCommand) &&
      !(command instanceof HeadObjectCommand) &&
      !(command instanceof DeleteObjectCommand)
    ) {
      throw new Error(
        "fake S3 client only accepts real AWS SDK Command instances " +
          "(the real S3Client calls command.resolveMiddleware, which plain objects lack)",
      );
    }
    const name = command.constructor.name;
    this.sent.push({ cmd: name, input: command.input as unknown as Record<string, unknown> });
    const input = command.input as { Bucket: string; Key: string; Body?: string };
    if (name === "PutObjectCommand") {
      if (this.failNextPut) {
        const err = this.failNextPut;
        this.failNextPut = null;
        throw err;
      }
      if (this.objects.has(input.Key)) {
        const err = new Error("The specified key does not exist") as Error & { name: string };
        err.name = "PreconditionFailed"; // real S3Client surfaces 412 as this name
        throw err;
      }
      this.objects.set(input.Key, { body: input.Body ?? "" });
      return {};
    }
    if (name === "HeadObjectCommand") {
      if (this.failNextHead) {
        const err = this.failNextHead;
        this.failNextHead = null;
        throw err;
      }
      const obj = this.objects.get(input.Key);
      if (!obj) throw new Error("Not Found");
      if (this.wrongHeadLengthOnce) {
        this.wrongHeadLengthOnce = false;
        return { ContentLength: obj.body.length + 1 };
      }
      return { ContentLength: obj.body.length };
    }
    if (name === "DeleteObjectCommand") {
      this.deletes.push(input.Key);
      this.objects.delete(input.Key);
      return {};
    }
    throw new Error(`unexpected command: ${name}`);
  }
}

let client: FakeS3;
let writer: SearchCaptureWriter;

beforeEach(() => {
  client = new FakeS3();
  writer = new SearchCaptureWriter(
    { bucket: "hasna-search-corpus", layout: { prefix: "search" }, region: "us-east-1" },
    client,
  );
});

describe("renderCapture", () => {
  test("renders frontmatter + body with the capture metadata", () => {
    const { markdown } = writer.renderCapture(sampleInput());
    expect(markdown.startsWith("---\n")).toBe(true);
    expect(markdown).toContain("capture_id: capture-abc123");
    expect(markdown).toContain("kind: search-capture");
    expect(markdown).toContain("capture_point: cli");
    expect(markdown).toContain("# bun sqlite fts5");
    expect(markdown).toContain("Result One");
    expect(markdown).toContain("https://one.com");
  });

  test("redacts credential-shaped query text and flags the capture", () => {
    const input = sampleInput({
      search: { ...sampleSearch(), query: `search for token=${sentinel()}` },
    });
    const { markdown, redacted } = writer.renderCapture(input);
    expect(redacted).toBe(true);
    expect(markdown).not.toContain(sentinel());
    expect(markdown).toContain(REDACTION_PLACEHOLDER);
    expect(markdown).toContain("redacted: true");
  });

  test("redacts credential-shaped text in NON-content results (no bypass)", () => {
    // redactContentSearchResult leaves non-content results unchanged; the
    // capture writer must still redact their free-text fields, or a
    // credential-shaped value in a web result's snippet reaches the corpus.
    const input = sampleInput({
      results: [
        {
          ...sampleResults()[0]!,
          snippet: `password=${sentinel()}`,
        },
      ],
    });
    const { markdown, redacted } = writer.renderCapture(input);
    expect(redacted).toBe(true);
    expect(markdown).not.toContain(sentinel());
    expect(markdown).toContain(REDACTION_PLACEHOLDER);
  });

  test("marks redacted false when nothing changed", () => {
    const { redacted } = writer.renderCapture(sampleInput());
    expect(redacted).toBe(false);
  });
});

describe("writeCapture", () => {
  test("writes an object at the corpus key with verified size", async () => {
    const input = sampleInput();
    const result = await writer.writeCapture(input);
    expect(result.key).toBe("search/2026-08-19/capture-abc123.md");
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.redacted).toBe(false);

    const put = client.sent.find((s) => s.cmd === "PutObjectCommand");
    expect(put?.input["Bucket"]).toBe("hasna-search-corpus");
    expect(put?.input["Key"]).toBe("search/2026-08-19/capture-abc123.md");
    expect(put?.input["IfNoneMatch"]).toBe("*");
    expect(put?.input["ContentType"]).toBe("text/markdown; charset=utf-8");
  });

  test("is deterministic: same capture rewrites the same hash", async () => {
    const a = await writer.writeCapture(sampleInput());
    const b = await writer.writeCapture(sampleInput());
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.key).toBe(b.key);
  });

  test("refuses credential-shaped content before any PUT", async () => {
    // A private-key block in a NON-content result: redactContentSearchResult
    // leaves non-content results untouched, so the write-time scanner is the
    // only layer that can catch it — the backstop this test exists for.
    const input = sampleInput({
      results: [
        {
          ...sampleResults()[0]!,
          snippet: keyBlockSentinel(),
        },
      ],
    });
    await expect(writer.writeCapture(input)).rejects.toThrow(/secret scan found/);
    expect(client.sent.filter((s) => s.cmd === "PutObjectCommand")).toHaveLength(0);
  });

  test("fails closed when the bucket is not configured", async () => {
    const bare = new SearchCaptureWriter({ bucket: "", layout: { prefix: "search" } }, client);
    await expect(bare.writeCapture(sampleInput())).rejects.toThrow(
      /HASNA_SEARCH_S3_BUCKET is not configured/,
    );
  });

  test("refuses an oversized capture", async () => {
    const input = sampleInput({
      search: { ...sampleSearch(), query: "x".repeat(2 * 1024 * 1024 + 10) },
    });
    await expect(writer.writeCapture(input)).rejects.toThrow(/exceeds the/);
  });

  test("skips (does not fail) when the key already exists", async () => {
    await writer.writeCapture(sampleInput());
    const err = new Error("The specified key does not exist") as Error & { name: string };
    err.name = "PreconditionFailed"; // real S3Client surfaces 412 as this name
    client.failNextPut = err;
    const again = await writer.writeCapture(sampleInput());
    expect(again.key).toBe("search/2026-08-19/capture-abc123.md");
  });

  test("removes the object again when HEAD verification fails", async () => {
    client.wrongHeadLengthOnce = true;
    await expect(writer.writeCapture(sampleInput())).rejects.toThrow(/landed with/);
    expect(client.deletes).toContain("search/2026-08-19/capture-abc123.md");
  });

  test("removes the object again when HEAD throws", async () => {
    client.failNextHead = new Error("Network timeout");
    await expect(writer.writeCapture(sampleInput())).rejects.toThrow(/Network timeout/);
    expect(client.deletes).toContain("search/2026-08-19/capture-abc123.md");
  });
});

describe("captureConfigFromEnv / isCaptureConfigured", () => {
  test("reads bucket, prefix and region from env", () => {
    const cfg = captureConfigFromEnv({
      HASNA_SEARCH_S3_BUCKET: "b",
      HASNA_SEARCH_S3_PREFIX: "corpus",
      HASNA_SEARCH_S3_REGION: "eu-central-1",
    } as NodeJS.ProcessEnv);
    expect(cfg.bucket).toBe("b");
    expect(cfg.layout?.prefix).toBe("corpus");
    expect(cfg.region).toBe("eu-central-1");
  });

  test("isCaptureConfigured is false without a bucket", () => {
    expect(isCaptureConfigured({ bucket: "" })).toBe(false);
    expect(isCaptureConfigured({ bucket: "b" })).toBe(true);
  });
});

describe("round-trip", () => {
  test("the written document parses back to its frontmatter", async () => {
    const input = sampleInput();
    const { markdown } = writer.renderCapture(input);
    const parsed = parseCaptureDocument(markdown);
    expect(parsed.capture_id).toBe("capture-abc123");
    expect(parsed.query).toBe("bun sqlite fts5");
    expect(parsed.providers).toEqual(["google", "exa"]);
    expect(parsed.result_count).toBe(2);
  });
});
