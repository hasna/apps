import { expect, test } from "bun:test";
import { parseScheduledSendTime } from "./scheduled-send-time.js";
test("schedule timestamps reject ambiguous, malformed, impossible and nonfuture dates", () => {
  for (const value of [
    "2030-01-01T10:00",
    "2030-02-30T10:00:00Z",
    "2030-13-01T10:00:00Z",
    "2030-01-01T25:00:00Z",
    "invalid",
    "2000-01-01T00:00:00Z",
  ])
    expect(() => parseScheduledSendTime(value)).toThrow();
  expect(parseScheduledSendTime("2030-01-01T10:00:00+02:00")).toBe(
    "2030-01-01T08:00:00.000Z",
  );
  expect(
    parseScheduledSendTime("2000-01-01T00:00:00Z", Number.NEGATIVE_INFINITY),
  ).toBe("2000-01-01T00:00:00.000Z");
});
