import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("CLI JSON contract", () => {
  it("emits parseable JSON for share/list/status", async () => {
    const home = mkdtempSync(join(tmpdir(), "clip-cli-"));
    try {
      const env = { ...process.env, HASNA_CLIP_HOME: home, CLIP_BASE_URL: "http://127.0.0.1:3741" };
      const share = Bun.spawn(["bun", "run", "src/cli/index.ts", "--json", "share", "text", "hello"], {
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const shareOut = await new Response(share.stdout).text();
      expect(await share.exited).toBe(0);
      const record = JSON.parse(shareOut) as { id: string; slug: string };
      expect(record.id).toBeTruthy();
      expect(record.slug).toBeTruthy();

      const list = Bun.spawn(["bun", "run", "src/cli/index.ts", "--json", "list"], {
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const listOut = await new Response(list.stdout).text();
      expect(await list.exited).toBe(0);
      expect(JSON.parse(listOut)).toHaveLength(1);

      const status = Bun.spawn(["bun", "run", "src/cli/index.ts", "--json", "status"], {
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const statusOut = await new Response(status.stdout).text();
      expect(await status.exited).toBe(0);
      expect((JSON.parse(statusOut) as { storage: { totalActive: number } }).storage.totalActive).toBe(1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
