// Local equivalent of the ui.sh MCP `uidotsh_fetch` tool. Reads the mirrored
// content/ tree instead of hitting the network. Same URI contract:
//   uidotsh://ui                      -> content/ui.md
//   uidotsh://ui/design-guidelines/x  -> content/ui/design-guidelines/x.md
// Supports a single uri or a list (concatenated, matching the MCP's batch shape).

import { join } from "node:path";

const CONTENT_DIR = join(import.meta.dir, "..", "content");

export function uriToFile(uri: string): string {
  if (!uri.startsWith("uidotsh://")) throw new Error(`Not a uidotsh URI: ${uri}`);
  const rel = uri.replace(/^uidotsh:\/\//, "").replace(/[).,]+$/, "");
  return join(CONTENT_DIR, rel + ".md");
}

export async function fetchOne(uri: string): Promise<string> {
  const file = uriToFile(uri);
  const f = Bun.file(file);
  if (!(await f.exists())) throw new Error(`No mirrored resource for ${uri} (expected ${file})`);
  return await f.text();
}

export async function fetchMany(uris: string[]): Promise<string> {
  const parts: string[] = ["# Batch Fetch", ""];
  for (const uri of uris) {
    parts.push("---", "", `## ${uri}`, "");
    try {
      parts.push(await fetchOne(uri));
    } catch (e) {
      parts.push(`> ERROR: ${(e as Error).message}`);
    }
    parts.push("");
  }
  return parts.join("\n");
}

export async function fetchResource(opts: { uri?: string; uris?: string[] }): Promise<string> {
  if (opts.uris && opts.uris.length) return fetchMany(opts.uris);
  if (opts.uri) return fetchOne(opts.uri);
  throw new Error("Provide `uri` or `uris`");
}
