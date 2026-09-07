import { afterEach, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { testRender, type TestRendererSetup } from "@opentui/solid";
import { ImageRenderable, type Renderable } from "@opentui/core";
import { ThemeProvider } from "../context/theme.js";
import { MailImagePreview, MessageImages } from "./message-images.js";

function png() {
  const crc = (data: Buffer) => {
    let value = 0xffffffff;
    for (const byte of data) {
      value ^= byte;
      for (let j = 0; j < 8; j++)
        value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const payload = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length);
    payload.copy(out, 4);
    out.writeUInt32BE(crc(payload), out.length - 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(8);
  header.writeUInt32BE(4, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc(4 * (1 + 8 * 4));
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 8; x++) {
      const at = y * 33 + 1 + x * 4;
      raw[at] = x < 4 ? 255 : 0;
      raw[at + 1] = y < 2 ? 180 : 40;
      raw[at + 2] = x >= 4 ? 255 : 0;
      raw[at + 3] = 255;
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
let setup: TestRendererSetup | undefined;
afterEach(() => {
  setup?.renderer.destroy();
  setup = undefined;
});
const nodes = (root: Renderable): Renderable[] => [
  root,
  ...root.getChildren().flatMap(nodes),
];
async function flush() {
  await setup!.flush();
  await new Promise((resolve) => setTimeout(resolve, 15));
  await setup!.flush();
}

test("native image preview renders with automatic Unicode-block fallback", async () => {
  setup = await testRender(
    () => (
      <ThemeProvider mode="light">
        <MailImagePreview
          source={{
            kind: "embedded",
            data: `data:image/png;base64,${png().toString("base64")}`,
            label: "Fixture",
            inline: true,
          }}
        />
      </ThemeProvider>
    ),
    { width: 70, height: 22 },
  );
  await flush();
  const image = nodes(setup.renderer.root).find(
    (node) => node instanceof ImageRenderable,
  ) as ImageRenderable;
  expect(image).toBeDefined();
  await image.loadPromise;
  await setup.flush();
  expect(image.image?.width).toBe(8);
  expect(image.effectiveProtocol).toBe("blocks");
  expect(setup.captureCharFrame().trim().length).toBeGreaterThan(0);
});
test("remote image stays blocked until a deliberate click, then renders", async () => {
  let loads = 0;
  setup = await testRender(
    () => (
      <ThemeProvider mode="dark">
        <MailImagePreview
          source={{
            kind: "remote",
            url: "https://images.example/fixture.png",
            label: "Fixture",
            inline: true,
          }}
          load={async (_source, options) => {
            expect(options.allowRemote).toBe(true);
            loads++;
            return png();
          }}
        />
      </ThemeProvider>
    ),
    { width: 70, height: 22 },
  );
  await flush();
  expect(loads).toBe(0);
  expect(setup.captureCharFrame()).toContain("External image blocked");
  const lines = setup.captureCharFrame().split("\n");
  const y = lines.findIndex((line) => line.includes("Load external image"));
  await setup.mockMouse.click(lines[y]!.indexOf("Load external image"), y);
  await flush();
  expect(loads).toBe(1);
  expect(
    nodes(setup.renderer.root).some((node) => node instanceof ImageRenderable),
  ).toBe(true);
});
test("GitHub table badge disclosures expand and collapse without loading remote content", async () => {
  setup = await testRender(
    () => (
      <ThemeProvider mode="light">
        <MessageImages
          html={
            '<table><tr><td><img alt="publish guard" src="https://images.example/guard.png"></td><td><img alt="test-suites" src="https://images.example/tests.png"></td></tr></table>'
          }
        />
      </ThemeProvider>
    ),
    { width: 70, height: 22 },
  );
  await flush();
  expect(setup.captureCharFrame()).toContain("Image: publish guard");
  expect(setup.captureCharFrame()).toContain("Image: test-suites");
  expect(setup.captureCharFrame()).not.toContain("Load external image");
  const click = async () => {
    const lines = setup!.captureCharFrame().split("\n");
    const y = lines.findIndex((line) => line.includes("Image: publish guard"));
    await setup!.mockMouse.click(lines[y]!.indexOf("Image: publish guard"), y);
    await flush();
  };
  await click();
  expect(setup.captureCharFrame()).toContain("Load external image");
  const y = setup
    .captureCharFrame()
    .split("\n")
    .findIndex((line) => line.includes("Image: publish guard"));
  await setup.mockMouse.click(67, y);
  await flush();
  expect(setup.captureCharFrame()).not.toContain("Load external image");
});
