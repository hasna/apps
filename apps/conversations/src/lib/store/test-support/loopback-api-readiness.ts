import { randomUUID } from "node:crypto";
import { renameSync, rmSync, writeFileSync } from "node:fs";

type ReadyWriter = (path: string, content: string, options: { mode: number; flag: "wx" }) => void;

/** Publish the test-only handoff only after its complete JSON is written. */
export function publishLoopbackReadiness(
  path: string,
  payload: { url: string },
  write: ReadyWriter = writeFileSync,
): void {
  const staging = `${path}.${randomUUID()}.tmp`;
  try {
    write(staging, JSON.stringify(payload), { mode: 0o600, flag: "wx" });
    renameSync(staging, path);
  } finally {
    rmSync(staging, { force: true });
  }
}
