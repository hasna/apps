import { describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { annotatePng, decodePng, encodePng } from "./annotate.js";
import { captureScreenshot } from "./index.js";

function solidImage(width: number, height: number, rgba: [number, number, number, number]): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.byteLength; i += 4) {
    data[i] = rgba[0];
    data[i + 1] = rgba[1];
    data[i + 2] = rgba[2];
    data[i + 3] = rgba[3];
  }
  return encodePng({ width, height, data });
}

function pixel(image: ReturnType<typeof decodePng>, x: number, y: number): [number, number, number, number] {
  const index = (y * image.width + x) * 4;
  return [
    image.data[index]!,
    image.data[index + 1]!,
    image.data[index + 2]!,
    image.data[index + 3]!,
  ];
}

describe("capture annotation transform", () => {
  it("passes through PNG bytes when no annotations are provided", () => {
    const png = solidImage(3, 2, [255, 255, 255, 255]);
    expect(Buffer.from(annotatePng(png, [])).equals(Buffer.from(png))).toBe(true);
  });

  it("applies crop before drawing a box", () => {
    const png = solidImage(6, 6, [255, 255, 255, 255]);
    const annotated = decodePng(annotatePng(png, [
      { type: "crop", x: 1, y: 1, width: 4, height: 4 },
      { type: "box", x: 0, y: 0, width: 4, height: 4, color: "#ff0000", lineWidth: 1 },
    ]));

    expect(annotated.width).toBe(4);
    expect(annotated.height).toBe(4);
    expect(pixel(annotated, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(annotated, 2, 2)).toEqual([255, 255, 255, 255]);
  });

  it("draws arrows onto the image", () => {
    const png = solidImage(10, 5, [255, 255, 255, 255]);
    const annotated = decodePng(annotatePng(png, [
      { type: "arrow", from: { x: 1, y: 2 }, to: { x: 8, y: 2 }, color: "#0000ff", lineWidth: 1 },
    ]));

    expect(pixel(annotated, 1, 2)).toEqual([0, 0, 255, 255]);
    expect(pixel(annotated, 8, 2)).toEqual([0, 0, 255, 255]);
  });

  it("blurs only the requested redaction region", () => {
    const data = new Uint8Array([
      0, 0, 0, 255,
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 255, 255,
    ]);
    const png = encodePng({ width: 5, height: 1, data });
    const annotated = decodePng(annotatePng(png, [
      { type: "blur", x: 1, y: 0, width: 3, height: 1, radius: 1 },
    ]));

    expect(pixel(annotated, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(pixel(annotated, 2, 0)).toEqual([85, 85, 85, 255]);
    expect(pixel(annotated, 4, 0)).toEqual([255, 255, 255, 255]);
  });
});

describe("capture screenshot annotation storage", () => {
  it("stores the edited screenshot artifact and leaves unannotated capture bytes unchanged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-capture-annotate-"));
    const originalPath = join(dir, "fixture.png");
    const toolDir = join(dir, "bin");
    const toolPath = join(toolDir, "gnome-screenshot");
    const originalPathForShell = originalPath.replaceAll("'", "'\\''");
    const previousPath = process.env["PATH"];
    const previousDisplay = process.env["DISPLAY"];

    try {
      writeFileSync(originalPath, solidImage(6, 6, [255, 255, 255, 255]));
      await Bun.$`mkdir -p ${toolDir}`;
      writeFileSync(toolPath, `#!/usr/bin/env bash
set -euo pipefail
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-f" ]; then
    shift
    out="$1"
  fi
  shift || true
done
if [ -z "$out" ]; then
  echo "missing -f output path" >&2
  exit 2
fi
cp '${originalPathForShell}' "$out"
`);
      chmodSync(toolPath, 0o755);
      process.env["PATH"] = `${toolDir}:${previousPath ?? ""}`;
      process.env["DISPLAY"] = ":99";

      const unannotated = await captureScreenshot("full", { homeDir: dir, title: "Plain" });
      expect(readFileSync(unannotated.artifactPath!).equals(readFileSync(originalPath))).toBe(true);
      expect(unannotated.metadata.annotations).toBeUndefined();

      const annotated = await captureScreenshot("full", {
        homeDir: dir,
        title: "Annotated",
        annotations: [
          { type: "crop", x: 1, y: 1, width: 4, height: 4 },
          { type: "box", x: 0, y: 0, width: 4, height: 4, color: "#ff0000", lineWidth: 1 },
        ],
      });
      const stored = decodePng(readFileSync(annotated.artifactPath!));
      expect(stored.width).toBe(4);
      expect(stored.height).toBe(4);
      expect(pixel(stored, 0, 0)).toEqual([255, 0, 0, 255]);
      expect(annotated.metadata.annotations).toMatchObject({
        applied: true,
        originalWidth: 6,
        originalHeight: 6,
        width: 4,
        height: 4,
      });
    } finally {
      if (previousPath === undefined) delete process.env["PATH"];
      else process.env["PATH"] = previousPath;
      if (previousDisplay === undefined) delete process.env["DISPLAY"];
      else process.env["DISPLAY"] = previousDisplay;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves CLI shorthand annotation order", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-capture-cli-annotate-"));
    const originalPath = join(dir, "fixture.png");
    const toolDir = join(dir, "bin");
    const toolPath = join(toolDir, "gnome-screenshot");
    const originalPathForShell = originalPath.replaceAll("'", "'\\''");

    try {
      writeFileSync(originalPath, solidImage(10, 10, [255, 255, 255, 255]));
      await Bun.$`mkdir -p ${toolDir}`;
      writeFileSync(toolPath, `#!/usr/bin/env bash
set -euo pipefail
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-f" ]; then
    shift
    out="$1"
  fi
  shift || true
done
if [ -z "$out" ]; then
  echo "missing -f output path" >&2
  exit 2
fi
cp '${originalPathForShell}' "$out"
`);
      chmodSync(toolPath, 0o755);

      const env = {
        ...process.env,
        PATH: `${toolDir}:${process.env["PATH"] ?? ""}`,
        DISPLAY: ":99",
      };
      const proc = Bun.spawn([
        "bun",
        "run",
        "src/cli/index.ts",
        "--json",
        "--home",
        dir,
        "capture",
        "full",
        "--box",
        "0,0,6,6",
        "--crop",
        "3,3,4,4",
      ], {
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      expect(await proc.exited).toBe(0);
      expect(stderr).toBe("");
      const record = JSON.parse(stdout) as { artifactPath: string };
      const stored = decodePng(readFileSync(record.artifactPath));

      expect(stored.width).toBe(4);
      expect(stored.height).toBe(4);
      expect(pixel(stored, 0, 0)).toEqual([255, 255, 255, 255]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
