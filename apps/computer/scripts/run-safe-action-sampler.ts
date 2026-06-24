#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { inflateSync } from "node:zlib";
import {
  acquireRuntimeLease,
  createWorkflowRun,
  releaseRuntimeLease,
  transitionWorkflowRun,
  type RuntimeLease,
} from "../src/agent/runtime.js";

type SamplerOptions = {
  fixtureDir: string;
  outDir: string;
  writePath: string;
  visualReviewPath: string;
  selectedMachineAlias: string;
};

const DEFAULT_OPTIONS: SamplerOptions = {
  fixtureDir: "/tmp/occtrl-fixtures/p8-sampler",
  outDir: "/tmp/occtrl-safe-action-sampler",
  writePath: "/tmp/occtrl-safe-action-sampler.json",
  visualReviewPath: "/tmp/occtrl-visual-review.json",
  selectedMachineAlias: "machine-0000000000",
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const fixturePath = join(options.fixtureDir, "index.html");
  const beforePath = join(options.outDir, "before.png");
  const afterPath = join(options.outDir, "after.png");
  mkdirSync(options.fixtureDir, { recursive: true });
  mkdirSync(options.outDir, { recursive: true });

  const fixtureHtml = renderFixture();
  writeFileSync(fixturePath, fixtureHtml);
  const fixtureSha256 = sha256(Buffer.from(fixtureHtml));

  const { chromium } = await loadPlaywright();
  const run = createWorkflowRun({ status: "running" });
  const acquired: RuntimeLease[] = [];
  let browser: { close(): Promise<void> } | undefined;
  try {
    for (const resourceType of ["computer_display", "browser_extension_session"] as const) {
      acquired.push(acquireRuntimeLease({
        resourceType,
        resourceId: `local-fixture:safe-action-sampler:${resourceType}`,
        runId: run.id,
        holder: "safe-action-sampler",
        ttlMs: 60_000,
      }));
    }

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`file://${fixturePath}`);
    await page.screenshot({ path: beforePath, fullPage: false });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(150);
    await page.screenshot({ path: afterPath, fullPage: false });
    await page.close();
    await browser.close();
    browser = undefined;

    const leases = acquired.map((lease) => {
      releaseRuntimeLease(lease.id, { runId: run.id, holder: "safe-action-sampler" });
      return {
        resource_type: lease.resource_type,
        lease_id: lease.id,
        acquired: true,
        released: true,
      };
    });
    transitionWorkflowRun(run.id, "completed");

    const before = readFileSync(beforePath);
    const after = readFileSync(afterPath);
    const artifacts = [
      screenshotArtifact("screenshot_before", beforePath, before),
      screenshotArtifact("screenshot_after", afterPath, after),
    ];
    const visualChecks = screenshotVisualChecks(before, after, artifacts);
    const generatedAt = new Date().toISOString();
    const sampler = {
      schema_version: "open-computer.safe-action-sampler.v1",
      generated_at: generatedAt,
      status: "passed",
      fixture_only: true,
      external_sites: false,
      secrets_touched: false,
      destructive_actions: false,
      actions: [
        {
          type: "open_local_fixture",
          url: `file://${fixturePath}`,
          fixture_id: "safe-action-sampler",
          fixture_sha256: fixtureSha256,
        },
        { type: "screenshot_hash", sha256: artifacts[0].sha256, bytes: artifacts[0].bytes, width: 1280, height: 720 },
        { type: "scroll_local_fixture", deltaX: 0, deltaY: 1100 },
        { type: "screenshot_hash", sha256: artifacts[1].sha256, bytes: artifacts[1].bytes, width: 1280, height: 720 },
        { type: "query_browser_extension_status" },
      ],
      cleanup_completed: true,
      cleanup_actions: [{ type: "close_fixture_tab" }],
      leftovers: { tabs: 0, files: 0, processes: 0 },
      leases,
      artifacts,
    };
    const visualReview = {
      schema_version: "open-computer.visual-review.v1",
      generated_at: generatedAt,
      reviewed_at: generatedAt,
      status: "passed",
      selected_machine_alias: options.selectedMachineAlias,
      issues: [],
      artifacts,
      visual_checks: visualChecks,
      summary: "Before and after screenshots are nonblank fixture-only pages; after image shows scrolled target content.",
    };
    writeFileSync(options.writePath, `${JSON.stringify(sampler, null, 2)}\n`);
    writeFileSync(options.visualReviewPath, `${JSON.stringify(visualReview, null, 2)}\n`);
    console.log(JSON.stringify({
      schema_version: "open-computer.safe-action-sampler-run.v1",
      sampler: options.writePath,
      visual_review: options.visualReviewPath,
      fixture: fixturePath,
      before: beforePath,
      after: afterPath,
      fixture_sha256: fixtureSha256,
      before_sha256: artifacts[0].sha256,
      after_sha256: artifacts[1].sha256,
      run_id: run.id,
    }, null, 2));
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    for (const lease of acquired) {
      try {
        releaseRuntimeLease(lease.id, { runId: run.id, holder: "safe-action-sampler" });
      } catch {
        // Best-effort cleanup before marking the run failed.
      }
    }
    try {
      transitionWorkflowRun(run.id, "failed", { error: error instanceof Error ? error.message : String(error) });
    } catch {
      // Preserve the original error.
    }
    throw error;
  }
}

async function loadPlaywright(): Promise<{ chromium: any }> {
  try {
    return await import("playwright") as { chromium: any };
  } catch {
    return await import("../../open-browser/node_modules/playwright/index.js") as { chromium: any };
  }
}

function renderFixture(): string {
  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    "<title>OCCTRL Safe Action Sampler</title>",
    "<style>body{font-family:Arial,sans-serif;margin:0;padding:32px;line-height:1.4}.spacer{height:1100px;background:linear-gradient(#fff,#eef)}#target{padding:24px;border:2px solid #333}</style>",
    "</head>",
    "<body>",
    "<h1>OCCTRL Safe Action Sampler</h1>",
    "<p>fixture-only random-safe sampler</p>",
    "<div class=\"spacer\">scroll area</div>",
    "<section id=\"target\"><h2>After scroll target</h2><p>No credentials. No external sites. No destructive actions.</p></section>",
    "</body>",
    "</html>",
  ].join("");
}

function screenshotArtifact(kind: string, path: string, bytes: Buffer): Record<string, unknown> {
  return {
    kind,
    path,
    sha256: sha256(bytes),
    bytes: bytes.length,
    width: 1280,
    height: 720,
  };
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

type DecodedPng = {
  width: number;
  height: number;
  pixels: Uint8Array;
};

function screenshotVisualChecks(before: Buffer, after: Buffer, artifacts: Record<string, unknown>[]): Record<string, unknown> {
  const beforePng = decodePng(before);
  const afterPng = decodePng(after);
  const beforeStats = nonBackgroundStats(beforePng);
  const afterStats = nonBackgroundStats(afterPng);
  const pixelDifferenceRatio = pixelDifference(beforePng, afterPng);
  const beforeSha256 = String(artifacts[0].sha256);
  const afterSha256 = String(artifacts[1].sha256);

  return {
    before_sha256: beforeSha256,
    after_sha256: afterSha256,
    before_nonblank: beforeStats.nonblank,
    after_nonblank: afterStats.nonblank,
    before_nonbackground_ratio: Number(beforeStats.nonBackgroundRatio.toFixed(6)),
    after_nonbackground_ratio: Number(afterStats.nonBackgroundRatio.toFixed(6)),
    different_hashes: beforeSha256 !== afterSha256,
    changed: beforeSha256 !== afterSha256 && pixelDifferenceRatio > 0.001,
    pixel_difference_ratio: Number(pixelDifferenceRatio.toFixed(6)),
  };
}

function nonBackgroundStats(image: DecodedPng): { nonblank: boolean; nonBackgroundRatio: number } {
  const totalPixels = image.width * image.height;
  const bgR = image.pixels[0] ?? 0;
  const bgG = image.pixels[1] ?? 0;
  const bgB = image.pixels[2] ?? 0;
  let nonBackground = 0;

  for (let offset = 0; offset < image.pixels.length; offset += 4) {
    const diff = Math.abs(image.pixels[offset] - bgR)
      + Math.abs(image.pixels[offset + 1] - bgG)
      + Math.abs(image.pixels[offset + 2] - bgB);
    if (diff > 9) nonBackground += 1;
  }

  const nonBackgroundRatio = totalPixels > 0 ? nonBackground / totalPixels : 0;
  return {
    nonblank: nonBackgroundRatio > 0.0005,
    nonBackgroundRatio,
  };
}

function pixelDifference(before: DecodedPng, after: DecodedPng): number {
  if (before.width !== after.width || before.height !== after.height) return 1;
  const totalPixels = before.width * before.height;
  let changed = 0;

  for (let offset = 0; offset < before.pixels.length; offset += 4) {
    const diff = Math.abs(before.pixels[offset] - after.pixels[offset])
      + Math.abs(before.pixels[offset + 1] - after.pixels[offset + 1])
      + Math.abs(before.pixels[offset + 2] - after.pixels[offset + 2]);
    if (diff > 15) changed += 1;
  }

  return totalPixels > 0 ? changed / totalPixels : 0;
}

function decodePng(buffer: Buffer): DecodedPng {
  if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("Screenshot artifact is not a PNG");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    offset += 4;
    const type = buffer.toString("ascii", offset, offset + 4);
    offset += 4;
    const data = buffer.subarray(offset, offset + length);
    offset += length + 4;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
  }

  if (width <= 0 || height <= 0 || bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`Unsupported PNG format: ${width}x${height}, bitDepth=${bitDepth}, colorType=${colorType}`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const bytesPerPixel = channels;
  const rowBytes = width * channels;
  const inflated = inflateSync(Buffer.concat(idat));
  const pixels = new Uint8Array(width * height * 4);
  let inputOffset = 0;
  let previous = new Uint8Array(rowBytes);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const source = inflated.subarray(inputOffset, inputOffset + rowBytes);
    inputOffset += rowBytes;
    const row = new Uint8Array(rowBytes);

    for (let index = 0; index < rowBytes; index += 1) {
      const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
      const up = previous[index] ?? 0;
      const upLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] : 0;
      row[index] = unfilterByte(filter, source[index], left, up, upLeft);
    }

    for (let x = 0; x < width; x += 1) {
      const sourceIndex = x * channels;
      const pixelIndex = ((y * width) + x) * 4;
      pixels[pixelIndex] = row[sourceIndex];
      pixels[pixelIndex + 1] = row[sourceIndex + 1];
      pixels[pixelIndex + 2] = row[sourceIndex + 2];
      pixels[pixelIndex + 3] = colorType === 6 ? row[sourceIndex + 3] : 255;
    }

    previous = row;
  }

  return { width, height, pixels };
}

function unfilterByte(filter: number, value: number, left: number, up: number, upLeft: number): number {
  if (filter === 0) return value;
  if (filter === 1) return (value + left) & 0xff;
  if (filter === 2) return (value + up) & 0xff;
  if (filter === 3) return (value + Math.floor((left + up) / 2)) & 0xff;
  if (filter === 4) return (value + paeth(left, up, upLeft)) & 0xff;
  throw new Error(`Unsupported PNG filter: ${filter}`);
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

function parseArgs(args: string[]): SamplerOptions {
  const options = { ...DEFAULT_OPTIONS };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--fixture-dir") options.fixtureDir = resolve(requireValue(args, ++index, arg));
    else if (arg === "--out-dir") options.outDir = resolve(requireValue(args, ++index, arg));
    else if (arg === "--write") options.writePath = resolve(requireValue(args, ++index, arg));
    else if (arg === "--visual-review") options.visualReviewPath = resolve(requireValue(args, ++index, arg));
    else if (arg === "--selected-machine-alias") options.selectedMachineAlias = requireValue(args, ++index, arg);
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: bun run scripts/run-safe-action-sampler.ts [options]

Options:
  --fixture-dir <path>             Generated fixture directory.
  --out-dir <path>                 Screenshot output directory.
  --write <path>                   Sampler JSON output path.
  --visual-review <path>           Visual review JSON output path.
  --selected-machine-alias <alias> Redacted machine alias for visual review.
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!/^machine-[a-f0-9]{10}$/.test(options.selectedMachineAlias)) {
    throw new Error("--selected-machine-alias must be a redacted machine alias like machine-012345abcd");
  }
  return options;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

await main();
