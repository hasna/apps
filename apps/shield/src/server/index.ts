#!/usr/bin/env node
import { startServer } from "./serve.js";
import { PACKAGE_VERSION } from "../lib/version.js";
import { parseServerArgs, resolveServerHost } from "./args.js";

export { startServer };

const parsedArgs = parseServerArgs(process.argv.slice(2), PACKAGE_VERSION);
if (parsedArgs) {
  console.log(parsedArgs.text);
  process.exit(0);
}

const port = parseInt(process.env.PORT || "19428");
const host = resolveServerHost(process.argv.slice(2));
// Loopback by default; a remote bind requires SECURITY_API_KEY (enforced
// inside startServer — it refuses to start otherwise).
startServer(port, host || undefined);
