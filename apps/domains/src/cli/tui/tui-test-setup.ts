import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tempDir = mkdtempSync(join(tmpdir(), "open-domains-tui-test-"));
process.env["DOMAINS_DIR"] = tempDir;

export const tuiTestTempDir = tempDir;
