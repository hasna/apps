import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const dir = join(homedir(), ".hasna", "banking");
mkdirSync(dir, { recursive: true, mode: 0o700 });
