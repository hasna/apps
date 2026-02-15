import { describe, test, expect } from "bun:test";
import { getDashboardHtml } from "./dashboard.js";

describe("getDashboardHtml", () => {
  test("returns valid HTML string", () => {
    const html = getDashboardHtml(19426);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
    expect(html).toContain("<head>");
    expect(html).toContain("</head>");
    expect(html).toContain("<body>");
    expect(html).toContain("</body>");
  });

  test("includes the port in the header", () => {
    const html = getDashboardHtml(3000);
    expect(html).toContain("localhost:3000");
  });

  test("includes page title", () => {
    const html = getDashboardHtml(19426);
    expect(html).toContain("<title>Connectors Dashboard</title>");
  });

  test("includes dashboard header", () => {
    const html = getDashboardHtml(19426);
    expect(html).toContain("Connectors");
    expect(html).toContain("Dashboard");
  });

  test("includes stats section", () => {
    const html = getDashboardHtml(19426);
    expect(html).toContain("stat-installed");
    expect(html).toContain("stat-configured");
    expect(html).toContain("stat-needs-auth");
    expect(html).toContain("Installed");
    expect(html).toContain("Configured");
    expect(html).toContain("Needs Auth");
  });

  test("includes search bar", () => {
    const html = getDashboardHtml(19426);
    expect(html).toContain("search-bar");
    expect(html).toContain("Filter connectors...");
  });

  test("includes table with correct columns", () => {
    const html = getDashboardHtml(19426);
    expect(html).toContain("<table>");
    expect(html).toContain("Connector");
    expect(html).toContain("Category");
    expect(html).toContain("Auth Type");
    expect(html).toContain("Status");
    expect(html).toContain("Token");
  });

  test("includes modal for API key configuration", () => {
    const html = getDashboardHtml(19426);
    expect(html).toContain("modal-overlay");
    expect(html).toContain("modal");
    expect(html).toContain("key-input");
  });

  test("includes toast notification element", () => {
    const html = getDashboardHtml(19426);
    expect(html).toContain("toast");
  });

  test("includes JavaScript for API interaction", () => {
    const html = getDashboardHtml(19426);
    expect(html).toContain("<script>");
    expect(html).toContain("/api/connectors");
    expect(html).toContain("fetch(");
    expect(html).toContain("function load()");
    expect(html).toContain("function render(");
  });

  test("includes CSS styling", () => {
    const html = getDashboardHtml(19426);
    expect(html).toContain("<style>");
    expect(html).toContain("font-family");
    expect(html).toContain("badge-oauth");
    expect(html).toContain("badge-apikey");
    expect(html).toContain("badge-bearer");
  });

  test("includes OAuth and key management functions", () => {
    const html = getDashboardHtml(19426);
    expect(html).toContain("startOAuth");
    expect(html).toContain("saveKey");
    expect(html).toContain("refreshToken");
    expect(html).toContain("showKeyModal");
    expect(html).toContain("closeModal");
  });

  test("includes event listeners", () => {
    const html = getDashboardHtml(19426);
    expect(html).toContain("addEventListener");
    expect(html).toContain("Escape");
    expect(html).toContain("oauth-complete");
  });

  test("different ports produce different HTML", () => {
    const html1 = getDashboardHtml(3000);
    const html2 = getDashboardHtml(8080);
    expect(html1).toContain("localhost:3000");
    expect(html2).toContain("localhost:8080");
    expect(html1).not.toContain("localhost:8080");
    expect(html2).not.toContain("localhost:3000");
  });

  test("includes timeAgo function", () => {
    const html = getDashboardHtml(19426);
    expect(html).toContain("function timeAgo(");
  });

  test("includes status indicators", () => {
    const html = getDashboardHtml(19426);
    expect(html).toContain("status-ok");
    expect(html).toContain("status-no");
    expect(html).toContain("Configured");
    expect(html).toContain("Not configured");
  });

  test("includes loading state", () => {
    const html = getDashboardHtml(19426);
    expect(html).toContain("Loading connectors...");
  });
});
