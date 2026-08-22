// Stub cloud server for memories-list-api-filter.test.ts.
//
// It MUST run in its own process: the api-mode transport is a blocking
// Bun.spawnSync(curl), so an in-process Bun.serve() can never answer — the
// event loop is held by the spawnSync for the whole request and every call
// times out (same constraint as fail-closed-stub-server.ts).
//
// Every request line "METHOD url" is appended to the file named by
// CAPTURE_FILE, and every answer is a valid bounded-page body
// ({"memories":[],"has_more":false,"next_cursor":null}) so the client parse
// succeeds. The test then asserts on the captured request URLs.
//
// Prints "READY <port>" on stdout once listening.

const captureFile = process.env["CAPTURE_FILE"];
if (!captureFile) throw new Error("CAPTURE_FILE is required");

import { appendFileSync } from "node:fs";

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    const line = `${req.method} ${req.url}\n`;
    appendFileSync(captureFile, line);
    return Response.json({ memories: [], has_more: false, next_cursor: null });
  },
});

console.log(`READY ${server.port}`);
