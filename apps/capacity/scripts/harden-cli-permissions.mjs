import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  openSync,
} from "node:fs";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const launcherPath = fileURLToPath(new URL("./capacity-launcher.mjs", import.meta.url));
const sourceCliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const scriptPath = fileURLToPath(import.meta.url);

if (!existsSync(cliPath)) {
  if (existsSync(sourceCliPath)) {
    process.exit(0);
  }
  throw new Error("The installed @hasna/capacity CLI artifact is missing");
}

if (process.platform !== "win32") {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const hardenRegularFile = (path, mode, label) => {
    const descriptor = openSync(path, constants.O_RDONLY | noFollow);
    try {
      if (!fstatSync(descriptor).isFile()) {
        throw new Error(`${label} is not a regular file`);
      }
      fchmodSync(descriptor, mode);
      if ((fstatSync(descriptor).mode & 0o022) !== 0) {
        throw new Error(`${label} remains writable by others`);
      }
    } finally {
      closeSync(descriptor);
    }
  };

  hardenRegularFile(cliPath, 0o755, "The installed @hasna/capacity CLI artifact");
  hardenRegularFile(launcherPath, 0o755, "The @hasna/capacity CLI launcher");
  hardenRegularFile(scriptPath, 0o644, "The @hasna/capacity permission hardener");
}
