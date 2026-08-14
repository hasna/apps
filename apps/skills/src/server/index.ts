#!/usr/bin/env bun
// Thin adapter: the server is built and started through the SDK surface.
import { resolveServerConfig, startSkillsServer } from "../sdk/server.js";
import { resolveDatabaseTarget } from "../sdk/storage.js";

const config = resolveServerConfig();
const server = await startSkillsServer({ config });

console.log(`open-skills API listening on http://${config.host}:${server.port}`);
// Name the backend and, for SQLite, the file. An operator should never have to guess
// where their runs are being written - and if this line ever says "memory", it now took
// an explicit opt-in to get there rather than a forgotten environment variable.
console.log(`storage: ${resolveDatabaseTarget(config.databaseUrl).label}`);
