import { describe, expect, it } from "bun:test";
import { EmailsApiClient } from "./api.js";

describe("EmailsApiClient transport policy", () => {
  it("accepts HTTPS and loopback HTTP", () => {
    expect(() => new EmailsApiClient({ baseUrl: "https://emails.example" })).not.toThrow();
    expect(() => new EmailsApiClient({ baseUrl: "http://localhost:8080" })).not.toThrow();
    expect(() => new EmailsApiClient({ baseUrl: "http://127.0.0.1:8080" })).not.toThrow();
    expect(() => new EmailsApiClient({ baseUrl: "http://[::1]:8080" })).not.toThrow();
  });

  it("rejects plaintext remote and malformed URLs before retaining credentials", () => {
    expect(() => new EmailsApiClient({ baseUrl: "http://emails.example", apiKey: "must-not-appear" }))
      .toThrow(/requires HTTPS/);
    expect(() => new EmailsApiClient({ baseUrl: "not-a-url" })).toThrow();
  });
});
