import { describe, it, expect } from "bun:test";
import { findCaseVariantRows } from "./commands/agent-commands.js";

/**
 * Regression coverage for todos task 1170f87b.
 *
 * `todos init` has two branches. The LOCAL one runs `validateAgentName`, which
 * returns the lower-cased name, so a case variant cannot be minted there. The
 * CLOUD one posted the raw argument to `/v1/agents`, and every station on this
 * fleet is cloud-routed — so the shared normaliser that
 * `lib/agent-name-normalize.ts` calls "the single source of truth" for
 * `fabricius`/`Fabricius`/`FABRICIUS` being ONE agent was never consulted on
 * the only path anyone actually uses.
 *
 * Measured on the live roster 2026-08-02: 1291 rows, 1026 distinct once
 * lower-cased, 75 names held in two or more capitalisations, 7 of those
 * clashes minted since 07-29 (Ariadne, Silvanus, Fabricius, Frontinus, appius,
 * Seneca, mamercus). The user-visible cost is that the two spellings address
 * DISJOINT queues: `todos list --assigned silvanus` returned 29 rows and
 * `--assigned Silvanus` returned 28, intersection 0, while
 * `--assigned Fabricius` returned 0 at rc=0 — indistinguishable at the call
 * site from an agent that does not exist.
 *
 * Pure in-memory tests, matching assignee-validation.test.ts: a subprocess
 * test in this suite was previously measured taking it from 104s to 227s with
 * five unrelated failures.
 */

interface Row {
  id: string;
  name: string;
}

/** Shaped after the real rows measured on the live roster. */
const ROSTER: Row[] = [
  { id: "01d4cc12", name: "fabricius" },
  { id: "4d77b218", name: "Fabricius" },
  { id: "8f4a4700", name: "silvanus" },
  { id: "e1a3a977", name: "Silvanus" },
  { id: "aa8ce15f", name: "zoilus" },
  { id: "5624d10b", name: "agent-chief-harness" },
  { id: "a7d3bbb5", name: "a2-investigator-codewith" },
];

describe("findCaseVariantRows", () => {
  it("REFUSES a spelling that would mint a new case variant", () => {
    // `MAMERCUS` does not exist in any spelling below, so use a name that does.
    const rows = findCaseVariantRows([{ id: "aa8ce15f", name: "zoilus" }], "Zoilus");
    expect(rows.map((r) => r.id)).toEqual(["aa8ce15f"]);
  });

  it("reports EVERY clashing row, so the message can name them all", () => {
    const rows = findCaseVariantRows(ROSTER, "FABRICIUS");
    expect(rows.map((r) => r.id).sort()).toEqual(["01d4cc12", "4d77b218"]);
  });

  it("ALLOWS re-registering an exact existing spelling — the ordinary restart path", () => {
    // This is the control that keeps the guard from breaking the whole fleet.
    // `silvanus` exists exactly, so a restart under that name must proceed even
    // though `Silvanus` also exists and the name is therefore ambiguous.
    expect(findCaseVariantRows(ROSTER, "silvanus")).toEqual([]);
    expect(findCaseVariantRows(ROSTER, "Silvanus")).toEqual([]);
  });

  it("ALLOWS a genuinely new name", () => {
    expect(findCaseVariantRows(ROSTER, "brutus")).toEqual([]);
  });

  it("does NOT import the letters-only rule that would reject 22% of the fleet", () => {
    // validateAgentName enforces /^[a-z]+$/. 283 of 1291 live names fail it,
    // including every seat slug. This guard must be indifferent to shape and
    // care only about case, so seat slugs and hyphen/digit names still pass.
    expect(findCaseVariantRows(ROSTER, "agent-chief-harness")).toEqual([]);
    expect(findCaseVariantRows(ROSTER, "a2-investigator-codewith")).toEqual([]);
    expect(findCaseVariantRows(ROSTER, "agent-chief-staff")).toEqual([]);
    // ...but a case variant of a seat slug is still caught.
    expect(findCaseVariantRows(ROSTER, "Agent-Chief-Harness").map((r) => r.id)).toEqual(["5624d10b"]);
  });

  it("treats surrounding whitespace as the same identity", () => {
    expect(findCaseVariantRows(ROSTER, "  Zoilus  ").map((r) => r.id)).toEqual(["aa8ce15f"]);
    // Trimmed-exact is still the restart path, not a clash.
    expect(findCaseVariantRows(ROSTER, "  zoilus  ")).toEqual([]);
  });

  it("stays out of the way of the existing empty-name validation", () => {
    expect(findCaseVariantRows(ROSTER, "")).toEqual([]);
    expect(findCaseVariantRows(ROSTER, "   ")).toEqual([]);
  });

  it("returns nothing against an empty roster", () => {
    expect(findCaseVariantRows([], "Fabricius")).toEqual([]);
  });
});
