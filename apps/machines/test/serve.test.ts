import { describe, expect, test } from "bun:test";
import { getServeInfo, renderDashboardHtml } from "../src/commands/serve.js";

describe("serve", () => {
  test("returns default serve info", () => {
    const info = getServeInfo();
    expect(info.host).toBe("0.0.0.0");
    expect(info.port).toBe(7676);
    expect(info.routes).toContain("/api/status");
  });

  test("renders dashboard html", () => {
    const html = renderDashboardHtml();
    expect(html).toContain("<title>Machines Dashboard</title>");
    expect(html).toContain("<h1>Machines Dashboard</h1>");
  });
});
