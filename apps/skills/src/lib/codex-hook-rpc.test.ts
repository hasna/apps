import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { connectCodexHookRpc } from "./codex-hook-rpc.js";

for (const version of ["0.999.0", "0.154.0", "0.155.1"]) test(`native transport refuses ${version === "0.999.0" ? "unknown versions" : "malformed response envelopes"}`, async () => {
  const home = mkdtempSync(join(tmpdir(), "skills-rpc-refusal-")), command = join(home, "codex");
  try {
    writeFileSync(command, `#!/bin/sh\nif [ "$1" = "--version" ]; then printf 'codex-cli ${version}\\n'; exit 0; fi\nprintf 'null\\n'\n`, { mode: 0o700 });
    await expect(connectCodexHookRpc({ command, home, codexHome: home })).rejects.toThrow(version === "0.999.0" ? "NATIVE_UNSUPPORTED_VERSION" : "NATIVE_UNSUPPORTED");
  } finally { rmSync(home, { recursive: true, force: true }); }
});
