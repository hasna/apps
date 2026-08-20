import { describe, expect, test } from "bun:test";
import { hasCapabilityQuery, projectDestinationUrl, projectForOutput } from "./projection.js";

// Incident 716957 (todos b03cc058): a stored destination that is itself a
// signed capability URL (S3 presigned read) was emitted verbatim by the CLI
// into a probe file and reproduced in a session transcript. These tests pin
// the projection: output carries the plain unsigned reference, never the
// bearer capability.

describe("projectDestinationUrl", () => {
  test("projects an S3 V4 presigned URL to its plain unsigned reference", () => {
    const url =
      "https://s3.amazonaws.com/bucket/object?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
      "&X-Amz-Credential=fleettestkey%2F20260820%2Fus-east-1%2Fs3%2Faws4_request" +
      "&X-Amz-Date=20260820T000000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host" +
      "&X-Amz-Signature=abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    expect(projectDestinationUrl(url)).toBe("https://s3.amazonaws.com/bucket/object");
  });

  test("keeps a plain destination URL unchanged", () => {
    const url = "https://example.com/page?utm_source=fleet&ref=1";
    expect(projectDestinationUrl(url)).toBe(url);
  });

  test("strips capability params and keeps non-capability params", () => {
    const url = "https://s3.amazonaws.com/bucket/key?X-Amz-Signature=sigvalue&download=1";
    const projected = projectDestinationUrl(url);
    expect(projected).not.toContain("X-Amz-Signature");
    expect(projected).toContain("download=1");
  });

  test("matches capability parameter names case-insensitively", () => {
    const url = "https://s3.amazonaws.com/bucket/key?x-amz-signature=sigvalue";
    expect(projectDestinationUrl(url)).toBe("https://s3.amazonaws.com/bucket/key");
  });

  test("projects CloudFront-style signed URLs (Policy/Signature/Key-Pair-Id)", () => {
    const url = "https://d111.cloudfront.net/path?Policy=policyvalue&Signature=sigvalue&Key-Pair-Id=KPEXAMPLE";
    expect(projectDestinationUrl(url)).toBe("https://d111.cloudfront.net/path");
  });

  test("projects GCS V4 presigned URLs (X-Goog-*)", () => {
    const url =
      "https://storage.googleapis.com/bucket/key?X-Goog-Algorithm=GOOG4-RSA-SHA256" +
      "&X-Goog-Credential=acct&X-Goog-Date=20260820T000000Z&X-Goog-Expires=3600" +
      "&X-Goog-SignedHeaders=host&X-Goog-Signature=sigvalue";
    expect(projectDestinationUrl(url)).toBe("https://storage.googleapis.com/bucket/key");
  });

  test("projects S3 V2 presigned URLs (AWSAccessKeyId/Signature/Expires)", () => {
    const url = "https://s3.amazonaws.com/bucket/key?AWSAccessKeyId=fleettestkey&Expires=1724184000&Signature=sigvalue";
    expect(projectDestinationUrl(url)).toBe("https://s3.amazonaws.com/bucket/key");
  });

  test("returns non-http values unchanged", () => {
    expect(projectDestinationUrl("not a url")).toBe("not a url");
    expect(projectDestinationUrl("")).toBe("");
  });

  test("returns malformed http URLs unchanged rather than throwing", () => {
    const bad = "https://[";
    expect(projectDestinationUrl(bad)).toBe(bad);
  });

  test("does not flag URLs whose query merely resembles a capability name", () => {
    const url = "https://example.com/page?signature_of_the_day=morning";
    expect(hasCapabilityQuery(url)).toBe(false);
    expect(projectDestinationUrl(url)).toBe(url);
  });
});

describe("projectForOutput", () => {
  test("projects a Link record's destination_url", () => {
    const link = {
      id: "1",
      destination_url: "https://s3.amazonaws.com/bucket/key?X-Amz-Signature=sigvalue",
      short_url: "https://has.na/x",
    };
    const out = projectForOutput(link) as typeof link;
    expect(out.destination_url).toBe("https://s3.amazonaws.com/bucket/key");
    expect(out.short_url).toBe("https://has.na/x");
  });

  test("projects the nested link of a LinkStats record", () => {
    const stats = {
      link: { destination_url: "https://s3.amazonaws.com/bucket/key?X-Amz-Signature=sigvalue" },
      clicks: 1,
    };
    const out = projectForOutput(stats) as typeof stats;
    expect(out.link.destination_url).toBe("https://s3.amazonaws.com/bucket/key");
  });

  test("projects every row of an array of Links", () => {
    const rows = [
      { destination_url: "https://s3.amazonaws.com/bucket/key?X-Amz-Signature=sigvalue" },
      { destination_url: "https://example.com/plain" },
    ];
    const out = projectForOutput(rows) as typeof rows;
    expect(out[0].destination_url).toBe("https://s3.amazonaws.com/bucket/key");
    expect(out[1].destination_url).toBe("https://example.com/plain");
  });

  test("leaves non-link payloads untouched (same object reference)", () => {
    const payload = { ok: true, domains: 1 };
    expect(projectForOutput(payload)).toBe(payload);
  });
});
