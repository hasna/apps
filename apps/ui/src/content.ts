import { isAbsolute, join, relative, resolve } from "node:path";

export const CONTENT_DIR_ENV = "HASNA_UI_CONTENT_DIR";

export function resolveContentDir(contentDir?: string): string {
  const configured = contentDir ?? process.env[CONTENT_DIR_ENV];
  if (configured) return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
  return resolve(process.cwd(), "content");
}

export function uidotshUriToRelativePath(uri: string): string {
  if (!uri.startsWith("uidotsh://")) throw new Error(`Not a uidotsh URI: ${uri}`);
  const rel = uri.replace(/^uidotsh:\/\//, "").replace(/[).,]+$/, "");
  if (rel !== "ui" && !rel.startsWith("ui/")) throw new Error(`Unsupported uidotsh URI: ${uri}`);
  if (rel.includes("\\") || rel.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Unsafe uidotsh URI path: ${uri}`);
  }
  return rel + ".md";
}

export function uriToContentFile(uri: string, contentDir = resolveContentDir()): string {
  const root = resolve(contentDir);
  const file = resolve(root, uidotshUriToRelativePath(uri));
  const rel = relative(root, file);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Unsafe uidotsh URI path: ${uri}`);
  return file;
}

export function contentSetupMessage(contentDir = resolveContentDir()): string {
  return [
    `No ui.sh content mirror found at ${contentDir}.`,
    "",
    "@hasna/ui does not redistribute ui.sh content. Create a local mirror with your ui.sh MCP credentials:",
    "  UIDOTSH_MCP_URL=... UIDOTSH_TOKEN=... ui harvest",
    "",
    `Then rerun the command from the same project directory, or set ${CONTENT_DIR_ENV}=/path/to/content if the mirror lives elsewhere.`,
    "A valid mirror must contain ui.md and index.json inside that directory.",
  ].join("\n");
}

export class MissingContentMirrorError extends Error {
  constructor(readonly contentDir: string) {
    super(contentSetupMessage(contentDir));
    this.name = "MissingContentMirrorError";
  }
}

export async function hasContentMirror(contentDir = resolveContentDir()): Promise<boolean> {
  return (await Bun.file(join(contentDir, "ui.md")).exists()) && (await Bun.file(join(contentDir, "index.json")).exists());
}

export async function assertContentMirror(contentDir = resolveContentDir()): Promise<void> {
  if (!(await hasContentMirror(contentDir))) throw new MissingContentMirrorError(contentDir);
}
