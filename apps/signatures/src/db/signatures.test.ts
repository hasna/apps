import { describe, test, expect, beforeEach } from "bun:test";

process.env["SIGNATURES_DB_PATH"] = ":memory:";

import { closeDatabase } from "./database.js";
import {
  createSignature,
  getSignatureById,
  listSignatures,
  updateSignature,
  deleteSignature,
} from "./signatures.js";
import { NotFoundError } from "../types/index.js";

beforeEach(() => { closeDatabase(); });

describe("signatures", () => {
  test("creates text signature", () => {
    const sig = createSignature({ name: "John Doe", type: "text", text_value: "John Doe" });
    expect(sig.id).toMatch(/^sig-/);
    expect(sig.type).toBe("text");
    expect(sig.text_value).toBe("John Doe");
  });

  test("creates image signature", () => {
    const sig = createSignature({ name: "Jane", type: "image", image_path: "/tmp/sig.png" });
    expect(sig.image_path).toBe("/tmp/sig.png");
  });

  test("creates drawing signature with prompt", () => {
    const sig = createSignature({ name: "Art", type: "drawing", image_prompt: "cursive art" });
    expect(sig.image_prompt).toBe("cursive art");
  });

  test("defaults font_size to 48", () => {
    const sig = createSignature({ name: "Test", type: "text" });
    expect(sig.font_size).toBe(48);
  });

  test("defaults color to #000000", () => {
    const sig = createSignature({ name: "Test", type: "text" });
    expect(sig.color).toBe("#000000");
  });

  test("gets signature by ID", () => {
    const sig = createSignature({ name: "Get", type: "text" });
    expect(getSignatureById(sig.id).id).toBe(sig.id);
  });

  test("throws NotFoundError for missing ID", () => {
    expect(() => getSignatureById("sig-missing")).toThrow(NotFoundError);
  });

  test("lists all signatures", () => {
    createSignature({ name: "S1", type: "text" });
    createSignature({ name: "S2", type: "image" });
    expect(listSignatures().length).toBeGreaterThanOrEqual(2);
  });

  test("filters signatures by type", () => {
    createSignature({ name: "T", type: "text" });
    createSignature({ name: "I", type: "image" });
    const texts = listSignatures("text");
    expect(texts.every(s => s.type === "text")).toBe(true);
  });

  test("updates signature name", () => {
    const sig = createSignature({ name: "Old", type: "text" });
    const updated = updateSignature(sig.id, { name: "New Name" });
    expect(updated.name).toBe("New Name");
  });

  test("updates signature color", () => {
    const sig = createSignature({ name: "Color", type: "text" });
    const updated = updateSignature(sig.id, { color: "#ff0000" });
    expect(updated.color).toBe("#ff0000");
  });

  test("throws on update of missing signature", () => {
    expect(() => updateSignature("sig-missing", { name: "x" })).toThrow(NotFoundError);
  });

  test("deletes signature", () => {
    const sig = createSignature({ name: "Del", type: "text" });
    deleteSignature(sig.id);
    expect(() => getSignatureById(sig.id)).toThrow(NotFoundError);
  });
});
