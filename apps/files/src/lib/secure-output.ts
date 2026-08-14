import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, parse, resolve } from "node:path";

export interface SecureOutput {
  readonly path: string;
  write(data: string | Uint8Array): void;
  commit(): void;
  abort(): void;
}

/**
 * Create a new regular output file without following symlinks or overwriting an
 * existing path. Parent symlinks are rejected before the file is created, and
 * the resulting file is forced to owner read/write mode before callers can
 * request or write private content.
 */
export function openSecureOutput(destination: string): SecureOutput {
  if (!destination || destination === "-") {
    throw new Error("An explicit output file is required; stdout is not a safe private-content destination.");
  }

  const outputPath = resolve(destination);
  assertSafeParent(outputPath);

  const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  let descriptor: number;
  try {
    descriptor = openSync(
      outputPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      0o600,
    );
  } catch (error) {
    throw new Error(`Output file must not already exist and must not be a symlink: ${outputPath}`, {
      cause: error,
    });
  }

  let closed = false;
  let committed = false;
  try {
    fchmodSync(descriptor, 0o600);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) {
      throw new Error("Output must be a regular owner-only file.");
    }
  } catch (error) {
    closeSync(descriptor);
    unlinkSync(outputPath);
    throw error;
  }

  return {
    path: outputPath,
    write(data) {
      if (closed) throw new Error("Output file is already closed.");
      const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
      let offset = 0;
      while (offset < bytes.length) {
        offset += writeSync(descriptor, bytes, offset, bytes.length - offset);
      }
    },
    commit() {
      if (closed) return;
      fsyncSync(descriptor);
      closeSync(descriptor);
      closed = true;
      committed = true;
    },
    abort() {
      if (!closed) {
        closeSync(descriptor);
        closed = true;
      }
      if (!committed) {
        try {
          unlinkSync(outputPath);
        } catch {
          // The file may already be absent after an earlier cleanup.
        }
      }
    },
  };
}

function assertSafeParent(outputPath: string): void {
  const parent = dirname(outputPath);
  const { root } = parse(parent);
  const segments = parent.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`Output parent must not contain symlinks: ${current}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`Output parent is not a directory: ${current}`);
    }
  }
}
