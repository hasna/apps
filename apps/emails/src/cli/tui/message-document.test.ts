import { describe, expect, it } from "bun:test";
import { messageDocument } from "./message-document.js";

describe("message document", () => {
  it("renders deeply nested tables and lists within a bounded subprocess", () => {
    // The old traversal rendered children once eagerly, then again for each
    // table cell/list item. A sub-kilobyte email could block the UI for minutes.
    // Isolate the deadline so a regression cannot hang the entire test runner.
    const probe = Bun.spawnSync([process.execPath, "--eval", `
      import { messageDocument } from ${JSON.stringify(new URL("./message-document.ts", import.meta.url).href)};
      const table = '<table><tr><th>'.repeat(25) + 'nested-table-leaf' + '</th></tr></table>'.repeat(25);
      const list = '<ul><li>'.repeat(25) + 'nested-list-leaf' + '</li></ul>'.repeat(25);
      process.stdout.write(JSON.stringify({
        table: JSON.stringify(messageDocument(null, table)).includes('nested-table-leaf'),
        list: JSON.stringify(messageDocument(null, list)).includes('nested-list-leaf'),
      }));
    `], { timeout: 3000 });
    expect(probe.exitCode).toBe(0);
    expect(JSON.parse(probe.stdout.toString())).toEqual({ table: true, list: true });
  });

  it("keeps Markdown structure and code indentation without displaying fence markers", () => {
    const blocks = messageDocument("# Release\n\n**Ready** and `inline`\n\n```ts\nfunction build() {\n  return 42;\n}\n```\n\nDone.");
    expect(blocks).toEqual([
      { kind: "markdown", content: "# Release\n\n**Ready** and `inline`" },
      { kind: "code", content: "function build() {\n  return 42;\n}", language: "ts" },
      { kind: "markdown", content: "Done." },
    ]);
  });

  it("does not mistake HTML examples inside Markdown code fences for an HTML email", () => {
    const blocks = messageDocument("# Example\n\n```html\n<div>Hello</div>\n```\n\nDone.");
    expect(blocks).toContainEqual({ kind: "code", content: "<div>Hello</div>", language: "html" });
    expect(messageDocument(null, "<p>Hello <b>Sam </b>and <em> Pat</em></p>")[0]).toEqual({ kind: "markdown", content: "Hello **Sam** and  *Pat*" });
  });

  it("prefers structured HTML, removes invisible mail chrome and preserves code, links and tables", () => {
    const blocks = messageDocument("flattened fallback", `
      <head><style>body { color: red }</style></head><body>
      <div hidden>hidden preview</div><div style="display: none !important">tracking</div>
      <h1>Release &amp; status</h1><p><strong>Ready</strong> for <a href="https://example.com/review">review</a>.</p>
      <pre><code class="language-js">if (ready) {\n  deploy();\n}</code></pre>
      <table><tr><th>Service</th><th>Status</th></tr><tr><td>API</td><td>OK</td></tr></table>
      <blockquote><p>Older reply</p></blockquote><img src="https://example.com/pixel" width="1" height="1">
      <script>bad()</script></body>`);
    const document = JSON.stringify(blocks);
    expect(document).toContain("# Release & status");
    expect(document).toContain("**Ready**");
    expect(document).toContain("[review](https://example.com/review)");
    expect(blocks).toContainEqual({ kind: "code", content: "if (ready) {\n  deploy();\n}", language: "js" });
    expect(document).toContain("| Service | Status |");
    expect(blocks.some((block) => block.kind === "quote")).toBe(true);
    for (const hidden of ["flattened fallback", "hidden preview", "tracking", "bad()", "pixel", "color: red"]) {
      expect(document).not.toContain(hidden);
    }
  });

  it("recognizes Gmail quote containers and plain reply history", () => {
    expect(messageDocument(null, '<p>New reply</p><div class="gmail_quote"><p>On Monday, Alex wrote:</p><p>Old message</p></div>')
      .map((block) => block.kind)).toEqual(["markdown", "quote"]);
    expect(messageDocument("New reply\n\nOn Monday, Alex wrote:\n> Old message\n> Thanks")
      .map((block) => block.kind)).toEqual(["markdown", "quote"]);
  });

  it("keeps nested list code collapsible and reference links resolvable", () => {
    const blocks = messageDocument("1. Run this:\n\n   ```sh\n   cd project\n   ```\n\n[Review][pr]\n\n[pr]: https://example.com/pr");
    expect(blocks[0]?.kind).toBe("list");
    expect(JSON.stringify(blocks[0])).toContain('"kind":"code"');
    expect(JSON.stringify(blocks)).toContain("https://example.com/pr");
  });

  it("does not truncate normal long messages at a fixed number of lines", () => {
    const text = Array.from({ length: 300 }, (_, i) => `Paragraph ${i}.`).join("\n\n");
    expect(JSON.stringify(messageDocument(text))).toContain("Paragraph 299.");
  });

  it("strips terminal controls and unsafe links while retaining the visible label", () => {
    const blocks = messageDocument(null, '<p>safe\u001b[31mtext</p><a href="javascript:alert(1)">Review</a><a href="file:///tmp/a">file</a>');
    expect(JSON.stringify(blocks)).toContain("safetext");
    expect(JSON.stringify(blocks)).toContain("Review");
    expect(JSON.stringify(blocks)).not.toMatch(/javascript:|file:\/\/|\\u001b/);
  });

  it("bounds oversized sources with an explicit notice and falls back from empty HTML", () => {
    expect(messageDocument("Actual message", "<head><style>ignored</style></head>")).toEqual([{ kind: "markdown", content: "Actual message" }]);
    expect(JSON.stringify(messageDocument("x".repeat(230_000)))).toContain("Message clipped");
  });
});
