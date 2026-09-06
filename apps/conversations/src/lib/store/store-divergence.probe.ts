// Test fixture for store-divergence.e2e.test.ts. NOT part of the shipped CLI —
// nothing imports it, so it never enters a bundle (see `files` in package.json).
//
// Runs in a child process so each case gets a pristine environment: the local
// SQLite handle and the resolved store are both process-level singletons, so
// resolution cannot be exercised honestly inside one test process.
//
//   seed <n>     — create <n> channels in the local SQLite store
//   count        — resolve the store from the env and report how many channels it holds
//   resolve      — resolve the store from the env and report transport + base URL WITHOUT
//                  issuing a request (no network), for the resolution-only assertions
//
// Prints one JSON line to stdout. Exits non-zero when store resolution refuses.

import { getStore } from "./index.js";
import { resolveConversationsCloud } from "./index.js";
import { createChannel } from "../channels.js";

const [mode, arg] = process.argv.slice(2);

if (mode === "seed") {
  const total = Number(arg);
  for (let i = 0; i < total; i++) createChannel(`fixture-channel-${i}`, "fixture-agent");
  console.log(JSON.stringify({ seeded: total }));
} else if (mode === "count") {
  let store;
  try {
    store = getStore(process.env);
  } catch (error) {
    // The refusal path. Report it as data so the test can assert on the message
    // without depending on how the CLI happens to format errors.
    console.log(
      JSON.stringify({
        refused: true,
        name: (error as Error).name,
        message: (error as Error).message,
      }),
    );
    process.exit(3);
  }
  const channels = await store.listChannels();
  console.log(JSON.stringify({ refused: false, transport: store.transport, channels: channels.length }));
} else if (mode === "resolve") {
  let client;
  try {
    client = resolveConversationsCloud(process.env);
  } catch (error) {
    console.log(
      JSON.stringify({
        refused: true,
        name: (error as Error).name,
        message: (error as Error).message,
      }),
    );
    process.exit(3);
  }
  // Resolution only: never call a method, so no request is issued.
  console.log(
    JSON.stringify({
      refused: false,
      transport: client ? "cloud-http" : "local",
      baseUrl: client?.baseUrl ?? null,
    }),
  );
} else {
  console.error(`unknown probe mode: ${mode}`);
  process.exit(64);
}
