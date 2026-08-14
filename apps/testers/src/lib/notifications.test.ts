import { describe, test, expect } from "bun:test";
import { formatSlackPayload, formatDiscordPayload, signPayload, WebhookPayload } from "./webhooks.js";

describe("notification integrations (OPE9-00260)", () => {
  const samplePayload: WebhookPayload = {
    event: "run:complete",
    run: {
      id: "run-123",
      url: "http://test.example",
      status: "failed",
      passed: 5,
      failed: 2,
      total: 7,
    },
    timestamp: "2026-04-04T12:00:00.000Z",
  };

  describe("formatSlackPayload", () => {
    test("formats failed run payload", () => {
      const result = formatSlackPayload(samplePayload);
      expect(result.attachments).toBeDefined();
      expect(Array.isArray(result.attachments)).toBe(true);
      const attachment = result.attachments[0] as Record<string, unknown>;
      expect(attachment.color).toBe("#ef4444");
      expect(attachment.blocks).toBeDefined();
    });

    test("formats passed run payload", () => {
      const passed: WebhookPayload = {
        event: "run:complete",
        run: { id: "run-456", url: "http://ok.example", status: "passed", passed: 10, failed: 0, total: 10 },
        timestamp: "2026-04-04T12:00:00.000Z",
      };
      const result = formatSlackPayload(passed);
      const attachment = result.attachments[0] as Record<string, unknown>;
      expect(attachment.color).toBe("#22c55e");
    });

    test("includes schedule info when present", () => {
      const withSchedule: WebhookPayload = {
        ...samplePayload,
        schedule: { name: "Nightly smoke test", cronExpression: "0 0 * * *" },
      };
      const result = formatSlackPayload(withSchedule);
      const text = JSON.stringify(result);
      expect(text).toContain("Nightly smoke test");
    });
  });

  describe("formatDiscordPayload", () => {
    test("formats failed run as Discord embed", () => {
      const result = formatDiscordPayload(samplePayload);
      expect(result.username).toBe("open-testers");
      expect(result.embeds).toBeDefined();
      expect(Array.isArray(result.embeds)).toBe(true);
      const embed = result.embeds[0] as Record<string, unknown>;
      expect(embed.title).toBe("Test Run FAILED");
      expect(embed.color).toBe(0xef4444);
    });

    test("formats passed run with green embed", () => {
      const passed: WebhookPayload = {
        event: "run:complete",
        run: { id: "run-456", url: "http://ok.example", status: "passed", passed: 10, failed: 0, total: 10 },
        timestamp: "2026-04-04T12:00:00.000Z",
      };
      const result = formatDiscordPayload(passed);
      const embed = result.embeds[0] as Record<string, unknown>;
      expect(embed.title).toBe("Test Run PASSED");
      expect(embed.color).toBe(0x22c55e);
    });

    test("includes footer and timestamp", () => {
      const result = formatDiscordPayload(samplePayload);
      const embed = result.embeds[0] as Record<string, unknown>;
      expect(embed.timestamp).toBe("2026-04-04T12:00:00.000Z");
      const footer = embed.footer as Record<string, unknown>;
      expect(footer.text).toBe("open-testers");
    });
  });

  describe("signPayload", () => {
    test("returns consistent signature for same input", () => {
      const body = '{"test": true}';
      const sig1 = signPayload(body, "secret123");
      const sig2 = signPayload(body, "secret123");
      expect(sig1).toBe(sig2);
      expect(sig1).toMatch(/^sha256=/);
    });

    test("different secrets produce different signatures", () => {
      const body = '{"test": true}';
      const sig1 = signPayload(body, "secret-a");
      const sig2 = signPayload(body, "secret-b");
      expect(sig1).not.toBe(sig2);
    });
  });
});