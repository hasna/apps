import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Keep test runs hermetic: the default feedback event sink emits through
// `@hasna/events`, which would otherwise write to ~/.hasna/events.
process.env["HASNA_EVENTS_DIR"] = mkdtempSync(join(tmpdir(), "feedback-events-test-"));

// Likewise for the task sink: `auto` would find the real `todos` binary on a
// developer machine and file a real task for every fixture. Tests that
// exercise the sink inject their own config and command runner.
process.env["FEEDBACK_TASK_SINK"] = "none";
