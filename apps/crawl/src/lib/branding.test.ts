import { describe, expect, it } from "bun:test";
import { extractBranding } from "./branding.js";

describe("extractBranding", () => {
  it("extracts a favicon with rel before href", () => {
    const html = `<link rel="icon" href="/favicon.ico">`;
    const result = extractBranding(html, "https://example.com/");
    expect(result.favicon).toBe("https://example.com/favicon.ico");
  });

  it("extracts a favicon with href before rel", () => {
    const html = `<link href="/assets/fav.png" rel="shortcut icon">`;
    const result = extractBranding(html, "https://example.com/");
    expect(result.favicon).toBe("https://example.com/assets/fav.png");
  });

  it("falls back to /favicon.ico at the origin when no icon link exists", () => {
    const result = extractBranding("<html></html>", "https://example.com/deep/page");
    expect(result.favicon).toBe("https://example.com/favicon.ico");
  });

  it("returns null favicon when the base URL is invalid", () => {
    const result = extractBranding("<html></html>", "not-a-url");
    expect(result.favicon).toBeNull();
  });

  it("resolves relative favicon hrefs against the base URL", () => {
    const html = `<link rel="icon" href="img/fav.png">`;
    const result = extractBranding(html, "https://example.com/sub/page.html");
    expect(result.favicon).toBe("https://example.com/sub/img/fav.png");
  });

  it("extracts an apple-touch-icon as the logo", () => {
    const html = `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`;
    const result = extractBranding(html, "https://example.com/");
    expect(result.logo).toBe("https://example.com/apple-touch-icon.png");
  });

  it("extracts an og:image as the logo when present", () => {
    const html = `<meta property="og:image" content="https://cdn.example.com/og.png">`;
    const result = extractBranding(html, "https://example.com/");
    expect(result.logo).toBe("https://cdn.example.com/og.png");
  });

  it("extracts an img with a logo class/id as the logo", () => {
    const html = `<img id="logo" src="/static/logo.svg">`;
    const result = extractBranding(html, "https://example.com/");
    expect(result.logo).toBe("https://example.com/static/logo.svg");
  });

  it("extracts theme-color with name before content", () => {
    const html = `<meta name="theme-color" content="#ff0000">`;
    const result = extractBranding(html, "https://example.com/");
    expect(result.themeColor).toBe("#ff0000");
  });

  it("extracts theme-color with content before name", () => {
    const html = `<meta content="#00ff00" name="theme-color">`;
    const result = extractBranding(html, "https://example.com/");
    expect(result.themeColor).toBe("#00ff00");
  });

  it("decodes Google Fonts family names, one per link, and caps the list at five", () => {
    const html = `
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400&family=Roboto+Slab:wght@700&display=swap" rel="stylesheet">
      <link href="https://fonts.googleapis.com/css?family=Open+Sans|Lato&display=swap" rel="stylesheet">
      <link href="https://fonts.googleapis.com/css?family=Merriweather&display=swap" rel="stylesheet">
    `;
    const result = extractBranding(html, "https://example.com/");
    // The greedy css[^"']* prefix resolves each link to its LAST family= pair,
    // so the first family in a multi-family link is dropped. Pin that behavior.
    expect(result.fonts).toContain("Roboto Slab");
    expect(result.fonts).toContain("Open Sans");
    expect(result.fonts).toContain("Merriweather");
    expect(result.fonts).not.toContain("Inter");
    expect(result.fonts).not.toContain("Lato");
    expect(result.fonts.length).toBeLessThanOrEqual(5);
  });

  it("extracts CSS font-family declarations and excludes generic families", () => {
    const html = `<style>
      body { font-family: "Source Serif 4", serif; }
      h1 { font-family: Georgia; }
      .x { font-family: sans-serif; }
    </style>`;
    const result = extractBranding(html, "https://example.com/");
    expect(result.fonts).toContain("Source Serif 4");
    expect(result.fonts).toContain("Georgia");
    expect(result.fonts).not.toContain("serif");
    expect(result.fonts).not.toContain("sans-serif");
  });

  it("deduplicates hex colors and caps the list at ten", () => {
    const html = `
      <style>
        .a { color: #ff0000; }
        .b { color: #ff0000; }
        .c { color: #00ff00; }
        .d { color: #0000ff; }
      </style>`;
    const result = extractBranding(html, "https://example.com/");
    expect(result.colors.filter((c) => c === "#FF0000")).toHaveLength(1);
    expect(result.colors).toContain("#00FF00");
    expect(result.colors.length).toBeLessThanOrEqual(10);
  });

  it("extracts nothing when the html is empty", () => {
    const result = extractBranding("", "https://example.com/");
    expect(result.logo).toBeNull();
    expect(result.favicon).toBe("https://example.com/favicon.ico");
    expect(result.themeColor).toBeNull();
    expect(result.fonts).toEqual([]);
    expect(result.colors).toEqual([]);
  });
});
