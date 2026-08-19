// Test-gap lane: agent-authored analysis (SOL consult refused — gpt-5.6-sol consult timed out twice within the 2x600s protocol bound; no answer delivered). Authored by Paulinus.
import { afterEach, describe, expect, test } from "bun:test";
import {
  detectProtocol,
  renderInlineImage,
  supportsInlineImages,
} from "../src/lib/terminal-image.js";

const ENV_KEYS = ["TERM_PROGRAM", "TERM", "KITTY_PID"] as const;

let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function isolateTerminal(env: Record<string, string>): void {
  for (const key of ENV_KEYS) {
    if (!(key in saved)) saved[key] = process.env[key];
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved = {};
});

describe("detectProtocol", () => {
  test("iTerm.app TERM_PROGRAM selects iterm2", () => {
    isolateTerminal({ TERM_PROGRAM: "iTerm.app" });
    expect(detectProtocol()).toBe("iterm2");
  });

  test("WezTerm TERM_PROGRAM selects iterm2 (OSC 1337 compatible)", () => {
    isolateTerminal({ TERM_PROGRAM: "WezTerm" });
    expect(detectProtocol()).toBe("iterm2");
  });

  test("kitty TERM selects kitty", () => {
    isolateTerminal({ TERM: "xterm-kitty" });
    expect(detectProtocol()).toBe("kitty");
  });

  test("KITTY_PID env alone selects kitty", () => {
    isolateTerminal({ KITTY_PID: "1234" });
    expect(detectProtocol()).toBe("kitty");
  });

  test("no terminal env selects none", () => {
    isolateTerminal({});
    expect(detectProtocol()).toBe("none");
  });

  test("unrelated TERM (xterm) selects none", () => {
    isolateTerminal({ TERM: "xterm-256color" });
    expect(detectProtocol()).toBe("none");
  });
});

describe("supportsInlineImages", () => {
  test("true for kitty", () => {
    isolateTerminal({ TERM: "xterm-kitty" });
    expect(supportsInlineImages()).toBe(true);
  });

  test("false for a plain terminal", () => {
    isolateTerminal({});
    expect(supportsInlineImages()).toBe(false);
  });
});

describe("renderInlineImage", () => {
  test("iterm2: exact OSC 1337 envelope with width/height/preserveAspectRatio", () => {
    isolateTerminal({ TERM_PROGRAM: "iTerm.app" });
    const out = renderInlineImage("QUJD", { width: 60, height: 20, preserveAspectRatio: false });
    expect(out).toBe("\x1b]1337;File=width=60;height=20;preserveAspectRatio=0;inline=1:QUJD\x07\n");
  });

  test("iterm2: defaults width 40, height 15, preserveAspectRatio 1", () => {
    isolateTerminal({ TERM_PROGRAM: "iTerm.app" });
    const out = renderInlineImage("QUJD");
    expect(out).toBe("\x1b]1337;File=width=40;height=15;preserveAspectRatio=1;inline=1:QUJD\x07\n");
  });

  test("kitty: single small chunk terminates with m=0", () => {
    isolateTerminal({ TERM: "xterm-kitty" });
    const out = renderInlineImage("QUJD", { width: 5, height: 3 });
    // f=100 (PNG), a=T (transmit), m=0 (last chunk), c/r geometry
    expect(out).toBe("\x1b_Gf=100,a=T,m=0,c=5,r=3;QUJD\x1b\\\n");
  });

  test("kitty: payload over 4096 bytes chunks with m=1 until the final m=0 chunk", () => {
    isolateTerminal({ TERM: "xterm-kitty" });
    const big = "A".repeat(10000);
    const out = renderInlineImage(big);
    const chunks = out.split("\x1b\\").slice(0, -1); // drop trailing newline split
    expect(chunks.length).toBe(3);
    // first chunk carries the header; m is followed by ",c=" here
    expect(chunks[0]).toContain("a=T,m=1,c=");
    expect(chunks[1]).toContain("m=1;");
    expect(chunks[2]).toContain("m=0;");
    // continuation chunks omit f/a/c/r
    expect(chunks[1].startsWith("\x1b_Gm=1;")).toBe(true);
    expect(chunks[2].startsWith("\x1b_Gm=0;")).toBe(true);
    // payload reassembles losslessly
    const payload = chunks.map((c) => c.slice(c.indexOf(";") + 1)).join("");
    expect(payload).toBe(big);
  });

  test("kitty: exactly 4096 bytes is one final chunk", () => {
    isolateTerminal({ TERM: "xterm-kitty" });
    const exact = "B".repeat(4096);
    const out = renderInlineImage(exact);
    expect(out.split("\x1b\\").length - 1).toBe(1);
    // single chunk: m=0 appears in the header, followed by ",c="
    expect(out).toContain("a=T,m=0,c=");
  });

  test("none: returns empty string", () => {
    isolateTerminal({});
    expect(renderInlineImage("QUJD")).toBe("");
  });
});
