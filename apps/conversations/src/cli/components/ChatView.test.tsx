import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getStore } from "../../lib/store/index.js";
import { startLoopbackApiFixture } from "../../lib/store/test-support/loopback-api-fixture.js";
import { activateClientEnvironment } from "../../lib/store/test-support/client-environment.js";
import { submitChatViewMessage } from "./ChatView.js";

let fixture: Awaited<ReturnType<typeof startLoopbackApiFixture>>;
let restoreClient: () => void;

function syntheticDatabaseUrl(): string {
  return ["postgres", "://", "tui_user:synthetic-password", "@db.example.invalid/app"].join("");
}

beforeEach(async () => {
  fixture = await startLoopbackApiFixture();
  restoreClient = activateClientEnvironment(fixture.env);
});
afterEach(async () => {
  restoreClient();
  await fixture.stop();
});

describe("submitChatViewMessage", () => {
  test("blocks sensitive content without throwing, echoing, or persisting", async () => {
    const blocked = syntheticDatabaseUrl();
    const result = await submitChatViewMessage(
      { agent: "tui-sender", recipient: "tui-recipient" },
      `blocked ${blocked}`
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("blocked");
      expect(result.blocked).toBe(true);
      expect(result.error).not.toContain(blocked);
    }
    expect(await getStore().readMessages({ to: "tui-recipient" })).toHaveLength(0);
  });

  test("sends safe content", async () => {
    const result = await submitChatViewMessage(
      { agent: "tui-sender", recipient: "tui-recipient" },
      "safe chat message"
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.content).toBe("safe chat message");
    }
    expect(await getStore().readMessages({ to: "tui-recipient" })).toHaveLength(1);
  });
});