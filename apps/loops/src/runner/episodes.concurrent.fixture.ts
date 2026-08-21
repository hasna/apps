/**
 * Test fixture for the concurrent-firings acceptance probe (todos b3d57dd3,
 * reviewer verdict 3 finding 2/5): a standalone process that records a fixed
 * number of failures or successes against a SHARED state dir, with jittered
 * delays so parallel instances genuinely contend for the episode lock.
 *
 * Invoked as: bun episodes.concurrent.fixture.ts <dir> <fail|succeed> <count> <maxJitterMs>
 * Exits 0 when every record call returned without throwing.
 */
import { createRunnerEpisodeRecorder } from "./episodes.js";

const [dir, mode, countRaw, jitterRaw] = process.argv.slice(2);
const count = Number(countRaw ?? 1);
const jitterMs = Number(jitterRaw ?? 0);
const recorder = createRunnerEpisodeRecorder({
  dataDir: dir,
  runnerId: "concurrent-probe",
  journal: () => {},
  spawnNotifier: () => {},
});

for (let i = 0; i < count; i++) {
  if (jitterMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, Math.random() * jitterMs));
  }
  if (mode === "succeed") {
    recorder.recordSuccess();
  } else {
    recorder.recordFailure(new TypeError("fetch failed: connection refused"));
  }
}
process.exit(0);
