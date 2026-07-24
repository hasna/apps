import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { isPublicReleaseTextSurface, type TextFile } from "./public-release-gate.js";

export interface PublicTextTraversalLimits {
  maxDepth: number;
  maxEntries: number;
  maxFileBytes: number;
  maxAggregateBytes: number;
}

export const DEFAULT_PUBLIC_TEXT_TRAVERSAL_LIMITS: Readonly<PublicTextTraversalLimits> = Object.freeze({
  maxDepth: 32,
  maxEntries: 50_000,
  maxFileBytes: 4 * 1024 * 1024,
  maxAggregateBytes: 64 * 1024 * 1024,
});

const EXCLUDED_NAMES = new Set([
  ".git",
  ".codewith",
  ".hasna",
  ".takumi",
  "node_modules",
  "dist",
  "coverage",
  ".tmp",
]);

function byteSort(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function validateLimits(limits: PublicTextTraversalLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`public text traversal ${name} must be a non-negative safe integer`);
    }
  }
}

function openAnchoredEntry(parentDescriptor: number, name: string, path: string): number {
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\0")) {
    throw new Error(`public text traversal rejected unsafe entry name at ${path}`);
  }
  try {
    return openSync(
      `/proc/self/fd/${parentDescriptor}/${name}`,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP") throw new Error(`public text traversal rejected symlink at ${path}`);
    throw new Error(`public text traversal could not descriptor-open ${path}: ${code ?? "unknown error"}`);
  }
}

/**
 * Collect public release text through stable directory/file descriptors only.
 * No path selected during traversal is followed after validation.
 */
export function collectPublicTextSurfaces(
  rootPath: string,
  overrides: Partial<PublicTextTraversalLimits> = {},
): TextFile[] {
  if (!isAbsolute(rootPath)) throw new Error("public text traversal root must be absolute");
  const limits = { ...DEFAULT_PUBLIC_TEXT_TRAVERSAL_LIMITS, ...overrides };
  validateLimits(limits);

  const root = resolve(rootPath);
  let rootDescriptor: number;
  try {
    rootDescriptor = openSync(
      root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP") throw new Error("public text traversal rejected a symlink root");
    throw error;
  }

  const files: TextFile[] = [];
  let entries = 0;
  let aggregateBytes = 0;

  const visit = (directoryDescriptor: number, relativeDirectory: string, depth: number): void => {
    const names = readdirSync(`/proc/self/fd/${directoryDescriptor}`, { encoding: "utf8" })
      .sort(byteSort);
    for (const name of names) {
      entries += 1;
      if (entries > limits.maxEntries) {
        throw new Error(`public text traversal exceeds ${limits.maxEntries} entries`);
      }
      const relativePath = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      const descriptor = openAnchoredEntry(directoryDescriptor, name, relativePath);
      try {
        const before = fstatSync(descriptor);
        if (before.isSymbolicLink()) {
          throw new Error(`public text traversal rejected symlink at ${relativePath}`);
        }
        if (!before.isDirectory() && !before.isFile()) {
          throw new Error(`public text traversal rejected special file at ${relativePath}`);
        }
        if (EXCLUDED_NAMES.has(name)) continue;
        if (before.isDirectory()) {
          const childDepth = depth + 1;
          if (childDepth > limits.maxDepth) {
            throw new Error(`public text traversal exceeds depth ${limits.maxDepth} at ${relativePath}`);
          }
          visit(descriptor, relativePath, childDepth);
          continue;
        }
        if (!/\.(md|json|ya?ml|sh|ts|tsx)$/.test(name)) continue;
        if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
        if (!isPublicReleaseTextSurface(relativePath)) continue;
        if (before.size > limits.maxFileBytes) {
          throw new Error(`public text traversal file ${relativePath} exceeds ${limits.maxFileBytes} bytes`);
        }
        if (aggregateBytes + before.size > limits.maxAggregateBytes) {
          throw new Error(`public text traversal exceeds ${limits.maxAggregateBytes} aggregate bytes`);
        }
        const bytes = readFileSync(descriptor);
        const after = fstatSync(descriptor);
        if (
          before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
          || bytes.byteLength !== after.size
        ) {
          throw new Error(`public text traversal file changed while read: ${relativePath}`);
        }
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          throw new Error(`public text traversal rejected non-UTF-8 text at ${relativePath}`);
        }
        aggregateBytes += bytes.byteLength;
        files.push({ path: relativePath, text });
      } finally {
        closeSync(descriptor);
      }
    }
  };

  try {
    const rootStat = fstatSync(rootDescriptor);
    if (!rootStat.isDirectory()) throw new Error("public text traversal root is not a directory");
    visit(rootDescriptor, "", 0);
    return files;
  } finally {
    closeSync(rootDescriptor);
  }
}
