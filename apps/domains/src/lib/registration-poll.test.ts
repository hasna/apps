import { describe, it, expect } from "bun:test";
import { classifyRegistrationStatus, pollRegistrationUntilDone } from "./registration-poll.js";

describe("classifyRegistrationStatus", () => {
  it("classifies in-flight states as pending", () => {
    for (const s of ["SUBMITTED", "IN_PROGRESS", "PENDING"]) {
      expect(classifyRegistrationStatus(s)).toBe("pending");
    }
  });
  it("classifies SUCCESSFUL as success", () => {
    expect(classifyRegistrationStatus("SUCCESSFUL")).toBe("success");
  });
  it("classifies ERROR/FAILED as failed", () => {
    for (const s of ["ERROR", "FAILED"]) expect(classifyRegistrationStatus(s)).toBe("failed");
  });
});

describe("pollRegistrationUntilDone", () => {
  const noSleep = async () => {};

  it("returns success once the op reaches SUCCESSFUL", async () => {
    const seq = ["IN_PROGRESS", "IN_PROGRESS", "SUCCESSFUL"];
    let i = 0;
    const res = await pollRegistrationUntilDone("op", {
      getStatus: async () => ({ status: seq[i++]! }),
      sleep: noSleep,
      maxAttempts: 5,
    });
    expect(res.status).toBe("success");
    expect(res.attempts).toBe(3);
  });

  it("returns failed on an ERROR status", async () => {
    const res = await pollRegistrationUntilDone("op", {
      getStatus: async () => ({ status: "ERROR", message: "domain taken" }),
      sleep: noSleep,
    });
    expect(res.status).toBe("failed");
    expect(res.message).toBe("domain taken");
  });

  it("times out after maxAttempts while still pending", async () => {
    const res = await pollRegistrationUntilDone("op", {
      getStatus: async () => ({ status: "IN_PROGRESS" }),
      sleep: noSleep,
      maxAttempts: 3,
    });
    expect(res.status).toBe("timeout");
    expect(res.attempts).toBe(3);
  });
});
