#!/usr/bin/env bun
import { runMcpStdio } from "../mcp";
try { await runMcpStdio(); }
catch { process.stderr.write(`${JSON.stringify({ error: { code: "configuration_error", message: "MCP controller configuration is invalid" } })}\n`); process.exitCode = 1; }
