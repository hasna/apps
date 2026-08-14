#!/usr/bin/env bun
/**
 * skill-siteanalyze — Analyze website design systems via Playwright + Claude Vision
 */

import { writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DetectedFrameworks {
  tailwind: boolean;
  shadcn: boolean;
  materialUI: boolean;
  bootstrap: boolean;
  chakra: boolean;
  antDesign: boolean;
  radixUI: boolean;
  other: string[];
}

export interface ExtractedTypography {
  bodyFont: string;
  headingFont: string;
  monoFont: string | null;
  baseFontSize: string;
  baseLineHeight: string;
  fontWeights: string[];
}

export interface ExtractedColors {
  cssVariables: Record<string, string>; // all --color-* and --* CSS vars from :root
  computed: {
    background: string;
    text: string;
    primary: string | null;
    border: string | null;
  };
  palette: string[]; // top 8 most distinct colors found
  isShadcnPalette: boolean; // has --primary, --secondary, --muted, --card vars
}

export interface DetectedComponents {
  shadcn: string[]; // shadcn component names found (Button, Card, Dialog, etc.)
  other: string[];
}

export interface SiteAnalysisResult {
  url: string;
  analyzedAt: string;
  screenshot: string | null; // base64 or file path
  frameworks: DetectedFrameworks;
  colors: ExtractedColors;
  typography: ExtractedTypography;
  components: DetectedComponents;
  styleCategory: string | null; // matched open-styles category
  styleConfidence: number; // 0-1
  aiAnalysis: string | null; // Claude's full analysis text
  openStylesProfile: {
    name: string;
    displayName: string;
    category: string;
    description: string;
    colors: Record<string, string>;
    typography: Record<string, string>;
    componentRules: Record<string, unknown>;
    principles: string[];
    tags: string[];
  };
}

// ─── Core Analysis ───────────────────────────────────────────────────────────

export async function analyzeSite(
  url: string,
  options?: {
    quick?: boolean;
    screenshotPath?: string;
    timeout?: number;
  }
): Promise<SiteAnalysisResult> {
  let browser: import("playwright").Browser | null = null;

  try {
    // Step 1: Launch Playwright and navigate
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });

    try {
      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: options?.timeout ?? 30000,
      });
    } catch {
      // If networkidle times out, try domcontentloaded as fallback
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: options?.timeout ?? 30000,
      });
    }

    // Step 2: Extract CSS variables from :root
    const cssVars = await page.evaluate(() => {
      const vars: Record<string, string> = {};
      try {
        for (const sheet of document.styleSheets) {
          try {
            for (const rule of sheet.cssRules) {
              if (
                rule instanceof CSSStyleRule &&
                rule.selectorText === ":root"
              ) {
                const text = rule.cssText;
                const matches = text.matchAll(/(-{2}[\w-]+):\s*([^;]+)/g);
                for (const m of matches) vars[m[1].trim()] = m[2].trim();
              }
            }
          } catch {
            // cross-origin stylesheets — skip
          }
        }
      } catch {
        // ignore sheet access errors
      }
      return vars;
    });

    // Step 3: Detect shadcn — check for specific CSS vars
    const shadcnVars = [
      "--primary",
      "--secondary",
      "--muted",
      "--card",
      "--popover",
      "--accent",
      "--destructive",
      "--border",
      "--input",
      "--ring",
      "--background",
      "--foreground",
    ];
    const shadcnVarCount = shadcnVars.filter((v) => v in cssVars).length;
    const isShadcn = shadcnVarCount >= 5;
    const isShadcnPalette = shadcnVarCount >= 5;

    // Step 4: Detect Tailwind — check for Tailwind utility classes in the DOM
    const hasTailwind = await page.evaluate(() => {
      const classes = Array.from(document.querySelectorAll("[class]")).flatMap(
        (el) => Array.from(el.classList)
      );
      const tailwindPatterns =
        /^(flex|grid|p-|m-|text-|bg-|border-|rounded|shadow|w-|h-|gap-|items-|justify-)/;
      return classes.filter((c) => tailwindPatterns.test(c)).length > 10;
    });

    // Step 5: Detect other frameworks
    const otherFrameworks = await page.evaluate(() => {
      const detected: {
        materialUI: boolean;
        bootstrap: boolean;
        chakra: boolean;
        antDesign: boolean;
        radixUI: boolean;
        other: string[];
      } = {
        materialUI: false,
        bootstrap: false,
        chakra: false,
        antDesign: false,
        radixUI: false,
        other: [],
      };

      // Material UI
      detected.materialUI = !!(
        document.querySelector(".MuiButton-root") ||
        document.querySelector(".MuiCard-root") ||
        document.querySelector("[class*='Mui']")
      );

      // Bootstrap
      detected.bootstrap = !!(
        document.querySelector(".btn") &&
        (document.querySelector(".container") ||
          document.querySelector(".row") ||
          document.querySelector('[class*="col-"]'))
      );

      // Chakra UI
      detected.chakra = !!document.querySelector("[data-chakra-component]");

      // Ant Design
      detected.antDesign = !!(
        document.querySelector(".ant-btn") || document.querySelector(".ant-card")
      );

      // Radix UI
      detected.radixUI = !!document.querySelector("[data-radix-popper-content-wrapper], [data-radix-collection-item]");

      return detected;
    });

    const frameworks: DetectedFrameworks = {
      tailwind: hasTailwind,
      shadcn: isShadcn,
      materialUI: otherFrameworks.materialUI,
      bootstrap: otherFrameworks.bootstrap,
      chakra: otherFrameworks.chakra,
      antDesign: otherFrameworks.antDesign,
      radixUI: otherFrameworks.radixUI,
      other: otherFrameworks.other,
    };

    // Step 6: Detect shadcn component names
    const shadcnComponents = await page.evaluate(() => {
      const found = new Set<string>();
      const componentPatterns: Record<string, string> = {
        Button:
          '[class*="inline-flex"][class*="items-center"][class*="justify-center"][class*="rounded"]',
        Card: '[class*="rounded-lg"][class*="border"][class*="bg-card"]',
        Dialog: '[role="dialog"]',
        Sheet: "[data-vaul-drawer]",
        Tabs: '[role="tablist"]',
        Badge:
          '[class*="inline-flex"][class*="rounded-full"][class*="px-2"]',
        Alert: '[role="alert"]',
        Avatar: '[class*="rounded-full"][class*="overflow-hidden"]',
        Input: 'input[class*="border"][class*="rounded"]',
        Label: 'label[class*="text-sm"][class*="font-medium"]',
        Select: '[role="combobox"]',
        Separator: '[role="separator"]',
        Skeleton: '[class*="animate-pulse"]',
        Switch: '[role="switch"]',
        Textarea: 'textarea[class*="border"][class*="rounded"]',
        Toast: '[data-sonner-toast], [class*="toast"]',
        Tooltip: '[role="tooltip"]',
      };
      for (const [name, selector] of Object.entries(componentPatterns)) {
        try {
          if (document.querySelector(selector)) found.add(name);
        } catch {
          // invalid selector — skip
        }
      }
      return Array.from(found);
    });

    // Step 7: Extract computed typography
    const typography = await page.evaluate((): ExtractedTypography => {
      const body = getComputedStyle(document.body);
      const h1 = document.querySelector("h1");
      const h1Style = h1 ? getComputedStyle(h1) : body;
      const pre = document.querySelector("pre, code");
      const monoStyle = pre ? getComputedStyle(pre) : null;
      return {
        bodyFont: body.fontFamily,
        headingFont: h1Style.fontFamily,
        monoFont: monoStyle?.fontFamily ?? null,
        baseFontSize: body.fontSize,
        baseLineHeight: body.lineHeight,
        fontWeights: [...new Set([body.fontWeight, h1Style.fontWeight])],
      };
    });

    // Step 8: Extract computed colors
    const computedColors = await page.evaluate(() => {
      const bodyStyle = getComputedStyle(document.body);
      const background = bodyStyle.backgroundColor;
      const text = bodyStyle.color;

      // Try to find primary color from common interactive elements
      const primaryEl =
        document.querySelector("button:not([disabled])") ||
        document.querySelector("a[class]") ||
        document.querySelector("[class*='primary']");
      const primaryStyle = primaryEl ? getComputedStyle(primaryEl) : null;
      const primary =
        primaryStyle?.backgroundColor &&
        primaryStyle.backgroundColor !== "rgba(0, 0, 0, 0)" &&
        primaryStyle.backgroundColor !== background
          ? primaryStyle.backgroundColor
          : null;

      // Try to find border color
      const borderEl =
        document.querySelector("input") || document.querySelector("[class*='border']");
      const borderStyle = borderEl ? getComputedStyle(borderEl) : null;
      const border =
        borderStyle?.borderColor &&
        borderStyle.borderColor !== "rgba(0, 0, 0, 0)"
          ? borderStyle.borderColor
          : null;

      // Collect palette from various elements
      const colorSet = new Set<string>();
      const selectors = [
        "header",
        "nav",
        "main",
        "footer",
        "section",
        "article",
        "aside",
        "button",
        "a",
        "h1",
        "h2",
        "p",
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const style = getComputedStyle(el);
        if (
          style.backgroundColor &&
          style.backgroundColor !== "rgba(0, 0, 0, 0)"
        )
          colorSet.add(style.backgroundColor);
        if (style.color && style.color !== "rgba(0, 0, 0, 0)")
          colorSet.add(style.color);
      }

      return {
        background,
        text,
        primary,
        border,
        palette: Array.from(colorSet).slice(0, 8),
      };
    });

    const colors: ExtractedColors = {
      cssVariables: cssVars,
      computed: {
        background: computedColors.background,
        text: computedColors.text,
        primary: computedColors.primary,
        border: computedColors.border,
      },
      palette: computedColors.palette,
      isShadcnPalette,
    };

    // Step 9: Take screenshot (always, for AI analysis)
    const screenshotBuffer = await page.screenshot({
      fullPage: false,
      type: "png",
    });
    const screenshotBase64 = screenshotBuffer.toString("base64");
    if (options?.screenshotPath) {
      writeFileSync(options.screenshotPath, screenshotBuffer);
    }

    await browser.close();
    browser = null;

    // Step 10: Claude Vision analysis (skip if options.quick)
    let styleCategory: string | null = null;
    let styleConfidence = 0;
    let aiAnalysis: string | null = null;
    let aiPrinciples: string[] = [];
    let aiDescription = "";

    if (!options?.quick) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (apiKey) {
        try {
          const client = new Anthropic({ apiKey });
          const response = await client.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 1024,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: "image/png",
                      data: screenshotBase64,
                    },
                  },
                  {
                    type: "text",
                    text: `Analyze this website screenshot. Given these detected facts:
- Frameworks: ${JSON.stringify(frameworks)}
- CSS variables found: ${Object.keys(cssVars).slice(0, 20).join(", ")}
- Body font: ${typography.bodyFont}

Determine:
1. Which open-styles category best matches (minimalist/brutalist/corporate/startup/glassmorphism/editorial/retro/material/neubrutalism/neumorphic)
2. Confidence 0-1
3. 3 key design principles you observe
4. Primary color intent

Respond ONLY as JSON: { "category": "...", "confidence": 0.9, "principles": ["...","...","..."], "description": "..." }`,
                  },
                ],
              },
            ],
          });

          const rawText =
            response.content[0]?.type === "text" ? response.content[0].text : "";
          aiAnalysis = rawText;

          try {
            // Extract JSON from the response (may have markdown code fences)
            const jsonMatch = rawText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              styleCategory = parsed.category ?? null;
              styleConfidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
              aiPrinciples = Array.isArray(parsed.principles) ? parsed.principles : [];
              aiDescription = typeof parsed.description === "string" ? parsed.description : "";
            }
          } catch {
            // JSON parse failed — keep raw text as aiAnalysis
          }
        } catch (err) {
          // Anthropic call failed — proceed without AI analysis
          aiAnalysis = `AI analysis unavailable: ${err instanceof Error ? err.message : String(err)}`;
        }
      } else {
        aiAnalysis = "AI analysis skipped: ANTHROPIC_API_KEY not set";
      }
    }

    // Step 11: Build openStylesProfile combining all extracted data
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const profileName = hostname.replace(/\./g, "-");
    const detectedFrameworkTags: string[] = [];
    if (frameworks.tailwind) detectedFrameworkTags.push("tailwind");
    if (frameworks.shadcn) detectedFrameworkTags.push("shadcn");
    if (frameworks.materialUI) detectedFrameworkTags.push("material-ui");
    if (frameworks.bootstrap) detectedFrameworkTags.push("bootstrap");
    if (frameworks.radixUI) detectedFrameworkTags.push("radix-ui");

    const profileColors: Record<string, string> = {
      background: colors.computed.background,
      foreground: colors.computed.text,
    };
    if (colors.computed.primary) profileColors.primary = colors.computed.primary;
    if (colors.computed.border) profileColors.border = colors.computed.border;
    // Include top CSS variables
    for (const [k, v] of Object.entries(colors.cssVariables).slice(0, 20)) {
      profileColors[k] = v;
    }

    const profileTypography: Record<string, string> = {
      bodyFont: typography.bodyFont,
      headingFont: typography.headingFont,
      baseFontSize: typography.baseFontSize,
      baseLineHeight: typography.baseLineHeight,
    };
    if (typography.monoFont) profileTypography.monoFont = typography.monoFont;
    if (typography.fontWeights.length > 0) {
      profileTypography.fontWeights = typography.fontWeights.join(", ");
    }

    const componentRules: Record<string, unknown> = {};
    if (frameworks.shadcn) {
      componentRules.useShadcn = true;
      componentRules.detectedComponents = shadcnComponents;
    }
    if (frameworks.tailwind) componentRules.useTailwind = true;

    const openStylesProfile: SiteAnalysisResult["openStylesProfile"] = {
      name: profileName,
      displayName: hostname,
      category: styleCategory ?? "minimalist",
      description:
        aiDescription ||
        `Design system extracted from ${url}. Detected frameworks: ${detectedFrameworkTags.join(", ") || "none"}.`,
      colors: profileColors,
      typography: profileTypography,
      componentRules,
      principles: aiPrinciples.length > 0 ? aiPrinciples : ["clean", "consistent", "accessible"],
      tags: [
        ...detectedFrameworkTags,
        styleCategory ?? "minimalist",
        "extracted",
      ],
    };

    return {
      url,
      analyzedAt: new Date().toISOString(),
      screenshot: options?.screenshotPath ? options.screenshotPath : screenshotBase64,
      frameworks,
      colors,
      typography,
      components: {
        shadcn: shadcnComponents,
        other: [],
      },
      styleCategory,
      styleConfidence,
      aiAnalysis,
      openStylesProfile,
    };
  } catch (err) {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore close errors
      }
    }
    throw err;
  }
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
skill-siteanalyze — Analyze website design systems via Playwright + Claude Vision

USAGE:
  skill-siteanalyze analyze --url <url> [options]
  skill-siteanalyze help

OPTIONS:
  --url <url>           URL to analyze (required)
  --quick               Skip AI vision analysis (faster, no ANTHROPIC_API_KEY needed)
  --format <type>       Output format: full | profile | colors | frameworks (default: full)
  --output <file>       Save JSON output to file
  --screenshot <file>   Save screenshot to PNG file
  --timeout <ms>        Page load timeout in milliseconds (default: 30000)

EXAMPLES:
  skill-siteanalyze analyze --url https://example.com
  skill-siteanalyze analyze --url https://example.com --quick
  skill-siteanalyze analyze --url https://example.com --format profile --output ./profile.json
  skill-siteanalyze analyze --url https://example.com --screenshot ./screenshot.png

ENVIRONMENT:
  ANTHROPIC_API_KEY     Required for AI vision analysis (skipped with --quick)
`);
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args["_command"] = arg;
    }
  }
  return args;
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    printHelp();
    process.exit(0);
  }

  const command = argv[0];
  if (command !== "analyze") {
    console.error(`Unknown command: ${command}`);
    console.error('Run "skill-siteanalyze help" for usage.');
    process.exit(1);
  }

  const args = parseArgs(argv.slice(1));

  const url = args["url"] as string | undefined;
  if (!url) {
    console.error("Error: --url is required.");
    console.error('Run "skill-siteanalyze help" for usage.');
    process.exit(1);
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    console.error(`Error: Invalid URL: ${url}`);
    process.exit(1);
  }

  const quick = Boolean(args["quick"]);
  const format = (args["format"] as string) || "full";
  const outputFile = args["output"] as string | undefined;
  const screenshotPath = args["screenshot"] as string | undefined;
  const timeout = args["timeout"] ? Number(args["timeout"]) : undefined;

  console.error(`Analyzing ${url}...`);
  if (quick) console.error("(quick mode — AI analysis skipped)");

  let result: SiteAnalysisResult;
  try {
    result = await analyzeSite(url, { quick, screenshotPath, timeout });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes("browserType.launch") || msg.includes("Executable doesn't exist")) {
      console.error(`
Error: Playwright browser not installed.
Run: bunx playwright install chromium
Then retry.`);
    } else if (msg.includes("net::ERR_NAME_NOT_RESOLVED") || msg.includes("ENOTFOUND")) {
      console.error(`Error: Could not resolve URL: ${url}`);
      console.error("Make sure the URL is correct and you have an internet connection.");
    } else {
      console.error(`Error: ${msg}`);
    }
    process.exit(1);
  }

  // Format output
  let output: unknown;
  switch (format) {
    case "frameworks":
      output = result.frameworks;
      break;
    case "colors":
      output = result.colors;
      break;
    case "profile":
      output = result.openStylesProfile;
      break;
    case "full":
    default: {
      // In full mode, replace screenshot base64 with a summary to avoid giant output
      const { screenshot, ...rest } = result;
      output = {
        ...rest,
        screenshot: screenshot
          ? screenshotPath
            ? screenshotPath
            : "[base64 — use --screenshot to save to file]"
          : null,
      };
      break;
    }
  }

  const json = JSON.stringify(output, null, 2);

  if (outputFile) {
    writeFileSync(outputFile, json, "utf-8");
    console.error(`Output saved to ${outputFile}`);
  } else {
    console.log(json);
  }

  if (screenshotPath) {
    console.error(`Screenshot saved to ${screenshotPath}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
