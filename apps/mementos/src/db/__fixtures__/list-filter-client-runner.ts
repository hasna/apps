// Child-process runner for memories-list-api-filter.test.ts.
//
// The listMemoriesPage API branch is exercised in ITS OWN process so the
// shared bun-test process environment is never mutated: api-mode tests in the
// suite configure HASNA_MEMENTOS_API_URL / HASNA_MEMENTOS_API_KEY in
// beforeEach/afterEach, and a sibling file re-pointing those vars mid-suite
// breaks their fixtures (a shared-process env write is invisible to the other
// file and lands at the wrong moment).
//
// The test harness spawns this script with a clean env (STUB_BASE_URL +
// CAPTURE_FILE + SCENARIO), it points the client at the loopback capture
// server, runs one listMemoriesPage call, and writes a "done" marker when the
// request has been captured. The harness then asserts on the captured line.

import { writeFileSync } from "node:fs";
import { listMemoriesPage } from "../memories.js";

const baseUrl = process.env["STUB_BASE_URL"];
const captureFile = process.env["CAPTURE_FILE"];
const scenario = process.env["SCENARIO"];
if (!baseUrl || !captureFile || !scenario) {
  throw new Error("missing STUB_BASE_URL / CAPTURE_FILE / SCENARIO");
}

process.env["HASNA_MEMENTOS_API_URL"] = baseUrl;
process.env["HASNA_MEMENTOS_API_KEY"] = "sk-test";
process.env["HASNA_MEMENTOS_API_TIMEOUT"] = "10";

const scenarios: Record<string, () => void> = {
  "all-five": () =>
    listMemoriesPage({
      machine_id: "machine-abc",
      visible_to_machine_id: "machine-abc",
      search: "invoice",
      source: "user",
      flag: "important",
    }),
  "array-source": () =>
    listMemoriesPage({
      visible_to_machine_id: "machine-abc",
      source: ["user", "agent"],
    }),
  empty: () => listMemoriesPage({}),
};

const run = scenarios[scenario];
if (!run) throw new Error(`unknown scenario: ${scenario}`);
run();
writeFileSync(`${captureFile}.done`, "ok");
