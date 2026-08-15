import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { resolve, sep } from "node:path";
import {
  isPackedTextContent,
  validatePackedBinaryFile,
  validatePublicTextSurfaces,
  type ReleaseGateFailure,
  type TextFile,
} from "./public-release-gate.js";

export interface PackedFileDescriptor {
  path: string;
}

/**
 * Scan every npm-reported packed entry from an already-extracted tarball.
 * Reading files directly avoids subprocess output limits for multi-megabyte
 * bundles while retaining content-based text detection and the strict binary
 * allowlist.
 */
export function scanExtractedPackedFiles(
  packedFiles: readonly PackedFileDescriptor[],
  extractedRoot: string,
  sourceLogo: Buffer,
): ReleaseGateFailure[] {
  const root = resolve(extractedRoot);
  const rootPrefix = `${root}${sep}`;
  const files: TextFile[] = [];
  const failures: ReleaseGateFailure[] = [];

  for (const file of packedFiles) {
    const archivePath = `package/${file.path}`;
    const absolute = resolve(root, archivePath);
    if (!absolute.startsWith(rootPrefix)) {
      failures.push({ check: "pack-read", message: `Refusing unsafe packed path ${archivePath}` });
      continue;
    }

    let content: Buffer;
    try {
      const stats = lstatSync(absolute);
      if (stats.isSymbolicLink()) content = Buffer.from(readlinkSync(absolute), "utf8");
      else if (stats.isFile()) content = readFileSync(absolute);
      else {
        failures.push({ check: "pack-read", message: `Packed entry is not a file: ${archivePath}` });
        continue;
      }
    } catch {
      failures.push({ check: "pack-read", message: `Could not read ${archivePath}` });
      continue;
    }

    if (isPackedTextContent(content)) {
      files.push({ path: archivePath, text: content.toString("utf8") });
    } else {
      failures.push(...validatePackedBinaryFile(archivePath, content, sourceLogo));
      files.push({ path: archivePath, text: content.toString("latin1") });
    }
  }

  return [...failures, ...validatePublicTextSurfaces(files)];
}
