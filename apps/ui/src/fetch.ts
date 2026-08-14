// Local equivalent of the ui.sh MCP `uidotsh_fetch` tool. Reads the mirrored
// content/ tree instead of hitting the network. Same URI contract:
//   uidotsh://ui                      -> content/ui.md
//   uidotsh://ui/design-guidelines/x  -> content/ui/design-guidelines/x.md
// Supports a single uri or a list (concatenated, matching the MCP's batch shape).

import {
  MissingContentMirrorError,
  assertContentMirror,
  resolveContentDir,
  uriToContentFile,
} from "./content.ts";

export function uriToFile(uri: string, contentDir = resolveContentDir()): string {
  return uriToContentFile(uri, contentDir);
}

export async function fetchOne(uri: string, opts: { contentDir?: string } = {}): Promise<string> {
  const contentDir = resolveContentDir(opts.contentDir);
  const file = uriToFile(uri, contentDir);
  await assertContentMirror(contentDir);
  const f = Bun.file(file);
  if (!(await f.exists())) throw new Error(`No mirrored resource for ${uri} (expected ${file})`);
  return await f.text();
}

export async function fetchMany(uris: string[], opts: { contentDir?: string } = {}): Promise<string> {
  const contentDir = resolveContentDir(opts.contentDir);
  await assertContentMirror(contentDir);
  const parts: string[] = ["# Batch Fetch", ""];
  for (const uri of uris) {
    parts.push("---", "", `## ${uri}`, "");
    try {
      parts.push(await fetchOne(uri, { contentDir }));
    } catch (e) {
      if (e instanceof MissingContentMirrorError) throw e;
      parts.push(`> ERROR: ${(e as Error).message}`);
    }
    parts.push("");
  }
  return parts.join("\n");
}

export async function fetchResource(opts: { uri?: string; uris?: string[]; contentDir?: string }): Promise<string> {
  if (opts.uris && opts.uris.length) return fetchMany(opts.uris, { contentDir: opts.contentDir });
  if (opts.uri) return fetchOne(opts.uri, { contentDir: opts.contentDir });
  throw new Error("Provide `uri` or `uris`");
}
