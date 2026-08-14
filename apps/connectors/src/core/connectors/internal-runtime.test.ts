import { describe, test, expect } from "bun:test";
import { stripeConnector } from "./stripe.js";
import { githubConnector } from "./github.js";

async function runStripe(args: string[]) {
  const runtime = stripeConnector.commandRuntime;
  if (!runtime?.run) throw new Error("Stripe command runtime unavailable");
  return runtime.run(args);
}

async function runGithub(args: string[]) {
  const runtime = githubConnector.commandRuntime;
  if (!runtime?.run) throw new Error("GitHub command runtime unavailable");
  return runtime.run(args);
}

describe("internal connector command runtimes", () => {
  test("stripe runtime returns root help", async () => {
    const result = await runStripe(["--help"]);
    expect(result?.success).toBe(true);
    expect(result?.stdout).toContain("connect-stripe");
    expect(result?.stdout).toContain("products");
  });

  test("stripe runtime returns config show JSON without requiring network", async () => {
    const result = await runStripe(["config", "show", "--format", "json"]);
    expect(result?.success).toBe(true);

    const payload = JSON.parse(result!.stdout);
    expect(payload).toHaveProperty("profile");
    expect(payload).toHaveProperty("configDir");
    expect(typeof payload.apiKeyConfigured).toBe("boolean");
  });

  test("stripe runtime returns subcommand help", async () => {
    const result = await runStripe(["products", "--help"]);
    expect(result?.success).toBe(true);
    expect(result?.stdout.toLowerCase()).toContain("product");
  });

  test("github runtime returns config show JSON without requiring network", async () => {
    const result = await runGithub(["config", "show", "--format", "json"]);
    expect(result?.success).toBe(true);

    const payload = JSON.parse(result!.stdout);
    expect(payload).toHaveProperty("profile");
    expect(payload).toHaveProperty("configDir");
    expect(typeof payload.tokenConfigured).toBe("boolean");
  });

  test("github runtime returns repo help", async () => {
    const result = await runGithub(["repo", "--help"]);
    expect(result?.success).toBe(true);
    expect(result?.stdout.toLowerCase()).toContain("repo");
  });

  test("github runtime returns null for unknown command", async () => {
    const result = await runGithub(["definitely-not-a-command"]);
    expect(result).toBeNull();
  });
});
