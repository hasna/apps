import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Keep test runs hermetic: the default feedback event sink emits through
// `@hasna/events`, which would otherwise write to ~/.hasna/events.
process.env["HASNA_EVENTS_DIR"] = mkdtempSync(join(tmpdir(), "feedback-events-test-"));
