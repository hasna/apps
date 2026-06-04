// Harvester: crawl the ui.sh MCP from the root `uidotsh://ui` resource, follow
// every `uidotsh://` reference, and mirror the full content tree to ./content
// as markdown. Writes content/index.json mapping uri -> relative file path.
//
// Run: bun run src/harvest.ts   (reads UIDOTSH_TOKEN / UIDOTSH_MCP_URL from env)

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { McpHttpClient } from "./mcp-client.ts";

const ROOT = "uidotsh://ui";
const URI_RE = /uidotsh:\/\/[A-Za-z0-9._\/-]+/g;

const CONTENT_DIR = join(import.meta.dir, "..", "content");

function uriToPath(uri: string): string {
  const rel = uri.replace(/^uidotsh:\/\//, "");
  return join(CONTENT_DIR, rel + ".md");
}

async function main() {
  const url = process.env.UIDOTSH_MCP_URL;
  const token = process.env.UIDOTSH_TOKEN;
  if (!url) throw new Error("UIDOTSH_MCP_URL not set");

  const client = new McpHttpClient({ url: `${url}?agent=ui-local`, token });
  await client.initialize();
  const tools = await client.listTools();
  const fetchTool = tools.find((t) => /fetch/.test(t.name))?.name ?? "uidotsh_fetch";
  console.log(`[harvest] using tool: ${fetchTool}; tools: ${tools.map((t) => t.name).join(", ")}`);

  const seen = new Set<string>();
  const queue: string[] = [ROOT];
  const index: Record<string, string> = {};
  let count = 0;

  while (queue.length) {
    const uri = queue.shift()!;
    if (seen.has(uri)) continue;
    seen.add(uri);

    let text: string;
    try {
      text = await client.callToolText(fetchTool, { uri });
    } catch (err) {
      console.warn(`[harvest] FAILED ${uri}: ${(err as Error).message}`);
      continue;
    }

    // A batch/single fetch may prepend headers; strip a leading "## uidotsh://..." banner
    // only matters for batch — single fetch returns the raw doc, keep as-is.
    const outPath = uriToPath(uri);
    await mkdir(dirname(outPath), { recursive: true });
    await Bun.write(outPath, text);
    index[uri] = outPath.replace(CONTENT_DIR + "/", "");
    count++;
    console.log(`[harvest] (${count}) ${uri} -> ${index[uri]} (${text.length}b)`);

    for (const found of text.match(URI_RE) ?? []) {
      // normalize trailing punctuation
      const clean = found.replace(/[).,]+$/, "");
      if (!seen.has(clean) && !queue.includes(clean)) queue.push(clean);
    }
  }

  await Bun.write(join(CONTENT_DIR, "index.json"), JSON.stringify(index, null, 2));
  console.log(`[harvest] done: ${count} resources mirrored to content/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
