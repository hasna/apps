// Synthetic ui.sh content mirror.
//
// The real mirror is ui.sh proprietary material and is deliberately not
// committed (see .gitignore), which made every mirror-dependent test skip in
// a fresh checkout. These helpers build a disposable mirror with the same
// SHAPE the harvest produces (ui.md + index.json + one markdown file per
// indexed uidotsh URI, contentDir-relative paths) so the mirror-gated
// assertions run everywhere, deterministically, without proprietary content.
// The root document carries the semantic markers the real root carries
// (Subskills, design) so contract assertions stay meaningful.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { uidotshUriToRelativePath } from "../../src/content.ts";

export interface SyntheticMirror {
  /** Temporary content directory holding ui.md, index.json and the tree. */
  dir: string;
  /** All indexed uidotsh URIs, root first. */
  uris: string[];
  /** Body of the root document (uidotsh://ui). */
  root: string;
}

export const ROOT_URI = "uidotsh://ui";

/** Same marker the real ui.sh root carries, so existing assertions stay real. */
export const ROOT_BODY = [
  "# UI Design Skill",
  "",
  "## Subskills",
  "",
  "- design",
  "- development",
  "- typography",
  "",
  "Synthetic mirror content used by the tests; not ui.sh material.",
].join("\n");

const SECTIONS = [
  "design-guidelines/typography",
  "design-guidelines/colors",
  "design-guidelines/spacing",
  "design-guidelines/forms",
  "design-guidelines/buttons",
  "design-guidelines/icons",
  "design-guidelines/layout",
  "design-guidelines/motion",
  "design-guidelines/dark-mode",
  "design-guidelines/accessibility",
  "ideas",
  "componentize",
];

function bodyFor(uri: string, index: number): string {
  const name = uri.slice("uidotsh://".length);
  return [
    `# ${name}`,
    "",
    `Synthetic body for ${uri}.`,
    "",
    "This is deterministic test content: a paragraph long enough to be a",
    "plausible guideline document, repeated words that the assertions can",
    "match on, and a trailing line. It is deliberately not ui.sh material.",
    "",
    `marker-${index}`,
  ].join("\n");
}

/**
 * Build a disposable mirror with `count` indexed resources (must be >= 40 so
 * the full-population contract assertions are meaningful). Caller removes the
 * directory via `rm(mirror.dir, { recursive: true, force: true })` or uses
 * `withMirror`, which always cleans up in a finally block.
 */
export async function createSyntheticMirror(count = 45): Promise<SyntheticMirror> {
  if (count < 40) throw new Error("createSyntheticMirror: count must be >= 40");
  const dir = await mkdtemp(join(tmpdir(), "hasna-ui-mirror-"));
  const uris = [ROOT_URI, ...SECTIONS.map((s) => `uidotsh://ui/${s}`)];
  for (let i = uris.length; i < count; i++) {
    uris.push(`uidotsh://ui/synthetic/k${String(i - 1).padStart(2, "0")}`);
  }

  const index: Record<string, string> = {};
  try {
    for (const [i, uri] of uris.entries()) {
      const rel = uidotshUriToRelativePath(uri);
      await mkdir(dirname(join(dir, rel)), { recursive: true });
      await writeFile(join(dir, rel), i === 0 ? ROOT_BODY : bodyFor(uri, i));
      index[uri] = rel;
    }
    await writeFile(join(dir, "index.json"), JSON.stringify(index, null, 2));
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
  return { dir, uris, root: ROOT_BODY };
}

/** Delete one indexed resource's markdown file (the negative arm). */
export async function removeMirrorFile(mirror: SyntheticMirror, uri: string): Promise<void> {
  const rel = uidotshUriToRelativePath(uri);
  await rm(join(mirror.dir, rel), { force: true });
}

/** Overwrite index.json with invalid JSON (the corruption arm). */
export async function corruptIndex(mirror: SyntheticMirror): Promise<void> {
  await writeFile(join(mirror.dir, "index.json"), "{not valid json!!");
}

/** Run fn with a fresh synthetic mirror and always clean it up. */
export async function withMirror<T>(
  count: number,
  fn: (mirror: SyntheticMirror) => Promise<T>,
): Promise<T> {
  const mirror = await createSyntheticMirror(count);
  try {
    return await fn(mirror);
  } finally {
    await rm(mirror.dir, { recursive: true, force: true });
  }
}
