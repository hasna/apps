import { expect, test } from "bun:test";
import { assertSendBodyUrlBoundary, findSendBodyUrlBoundary } from "./send-body-boundary.js";

test("finds raw n/r escapes anywhere inside HTTP(S) tokens without exposing content", () => {
  for (const body of [
    String.raw`https://example.test/a\n\nRegards`,
    String.raw`HTTP://example.test/a\r\nThanks`,
    String.raw`Https://example.test/a\nThanks`,
    String.raw`https://example.test/a\n`,
    String.raw`https://example.test/\report`,
    String.raw`<a href="https://example.test/a\n">Download</a>`,
    String.raw`[Download](https://example.test/a\r)`,
    'safe https://example.test/one\n' + String.raw`https://example.test/two\n`,
  ]) {
    const finding = findSendBodyUrlBoundary(body);
    expect(finding?.code).toBe("invalid_body_url_boundary");
    expect(JSON.stringify(finding)).not.toContain("example.test");
    expect(() => assertSendBodyUrlBoundary("safe", body)).toThrow("invalid_body_url_boundary");
  }
});

test("leaves real line breaks, encoded data, delimiters and prose backslashes valid", () => {
  for (const body of [
    "https://example.test/a\n\nRegards", "https://example.test/a\r\nThanks",
    "https://example.test/%5Cn/%5Cr?n=%5cn", String.raw`C:\notes\new.txt`,
    String.raw`Prose or regex \n and \r`, String.raw`https://example.test/a ordinary \n`,
    String.raw`<a href="https://example.test/a">literal \n</a>`,
    String.raw`'https://example.test/a'\n`, String.raw`<https://example.test/a>\n`,
    '`https://example.test/a`' + String.raw`\n`, String.raw`ftp://example.test/a\n`,
    "", null, undefined,
  ]) {
    expect(findSendBodyUrlBoundary(body, body)).toBeNull();
    expect(() => assertSendBodyUrlBoundary(body, body)).not.toThrow();
  }
});


test("API send and enqueue publish the same body refusal contract, without restricting stored message imports", async () => {
  const { emailsSelfHostedOpenApi } = await import("../server/self-hosted/openapi.js");
  for (const path of ["/v1/messages/send", "/v1/scheduled/enqueue"]) {
    const post = emailsSelfHostedOpenApi.paths![path]!.post as any;
    expect(post.requestBody.content["application/json"].schema.properties.text.description).toContain("invalid_body_url_boundary");
    expect(post.responses["400"].description).toContain("invalid_body_url_boundary");
  }
  for (const path of ["/v1/messages", "/v1/messages/record"]) {
    const post = emailsSelfHostedOpenApi.paths![path]!.post as any;
    expect(post.requestBody.content["application/json"].schema.properties.text.description ?? "").not.toContain("invalid_body_url_boundary");
  }
});
