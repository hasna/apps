/**
 * Changeset frontmatter contract for generated members.
 *
 * A pending changeset must OPEN with `---` and close with `---`:
 * `test/versioning/helpers.ts#parseChangesetFrontmatter` throws
 * `"<file>: missing opening frontmatter delimiter"` on anything else, and
 * `bun run test:versioning` is a hard gate.
 *
 * MEASURED DEFECT (fixed here, regression-gated in
 * `tooling/ci/tests/standard/member-scaffold.test.ts`): the generator emitted
 * the package entry ABOVE the opening delimiter —
 *
 *     "@hasna/<name>": minor
 *     ---
 *
 * — so every generated member shipped a changeset the versioning suite
 * rejects with "missing opening frontmatter delimiter". The generator now
 * asserts before it writes, so the malformed shape is refused loudly instead
 * of being emitted silently.
 *
 * This module is deliberately side-effect free: `generate-member.ts` is a
 * script whose top-level code runs on import, so the assertion lives in its
 * own module to stay importable from a test.
 */
export function assertChangesetFrontmatter(text: string, file: string): void {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    throw new Error(`${file}: generated changeset is missing its opening '---' frontmatter delimiter`);
  }
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closing < 0) {
    throw new Error(`${file}: generated changeset is missing its closing '---' frontmatter delimiter`);
  }
  if (lines.slice(1, closing).every((line) => line.trim().length === 0)) {
    throw new Error(`${file}: generated changeset declares no package entries`);
  }
  if (lines.slice(closing + 1).join("\n").trim().length === 0) {
    throw new Error(`${file}: generated changeset has an empty description`);
  }
}
