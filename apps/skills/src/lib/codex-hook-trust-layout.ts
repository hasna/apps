import { isDeepStrictEqual } from "node:util";

const fail = () => new Error("CODEX_HOOK_TRUST_UNSUPPORTED_LAYOUT: preserve and convert hook trust to ordinary [hooks.state.\"<key>\"] tables before enrollment");
const prune = (value: any) => { if (value.hooks?.state && !Object.keys(value.hooks.state).length) delete value.hooks.state; if (value.hooks && !Object.keys(value.hooks).length) delete value.hooks; return value; };

// Codex's native TOML writer may move complete, unrelated table blocks while
// inserting hook state. TOML table order is not semantic, so compare those
// blocks canonically while retaining every byte within each block.
const canonicalizeTableOrder = (text: string): string => {
  const headers = [...text.matchAll(/^[ \t]*(\[\[?[^\r\n]+\]\]?)[ \t]*(#[^\r\n]*)?(?:\r?\n|$)/gm)];
  if (!headers.length) return text;
  // Array-of-tables and parent/child table ordering carry parser-sensitive
  // structure. The native writer is admitted only for the simple unrelated
  // table reorder observed in Codex 0.154; all other layouts remain fail-closed
  // under the ordinary preservation witness.
  const keys = headers.map(header => header[1]!.trim());
  if (keys.some(key => key.startsWith("[[") || keys.filter(other => other === key).length > 1)) return text;
  const plain = keys.map(key => key.slice(1, -1).trim());
  if (plain.some((key, index) => plain.some((other, otherIndex) => index !== otherIndex && (other.startsWith(`${key}.`) || key.startsWith(`${other}.`))))) return text;
  const first = headers[0]!.index!;
  const prefix = text.slice(0, first);
  const blocks = headers.map((header, index) => ({
    key: header[1]!,
    order: index,
    text: text.slice(header.index!, headers[index + 1]?.index ?? text.length),
  }));
  blocks.sort((a, b) => a.key.localeCompare(b.key) || a.order - b.order);
  return prefix + blocks.map(block => block.text).join("");
};

/** Conservative admission and text witness, never a TOML writer. Native Codex
 * performs the versioned write; unrecognized inline/dotted trust shapes refuse. */
export function codexTrustTextWitness(text: string, keys: string[]): string {
  const parsed: any = Bun.TOML.parse(text), wanted = new Set(keys);
  const headers = [...text.matchAll(/^[ \t]*(\[[^\r\n]+\])[ \t]*(#[^\r\n]*)?(?:\r?\n|$)/gm)];
  if (headers.length > 512) throw fail();
  let root = parsed;
  for (const header of headers) { try { root = Bun.TOML.parse(text.slice(0, header.index)); break; } catch { /* Header-like string content. */ } }
  if (root.hooks !== undefined) throw fail();
  const replacements: Array<{ start: number; end: number; comments: string }> = [];
  const stateSections: Array<{ start: number; end: number }> = [];
  for (const [index, header] of headers.entries()) {
    let shape: any; try { shape = Bun.TOML.parse(header[1]!); } catch { continue; }
    const state = shape.hooks?.state;
    if (!state || Object.keys(shape).length !== 1 || Object.keys(shape.hooks).length !== 1) continue;
    const names = Object.keys(state), start = header.index!, end = headers[index + 1]?.index ?? text.length;
    if (names.length === 0) {
      // An optional parent header may be inserted by native toml_edit.
      replacements.push({ start, end: start + header[0].length, comments: header[2] ? header[2] + "\n" : "" });
      stateSections.push({ start, end: start + header[0].length });
    } else if (names.length === 1 && !Object.keys(state[names[0]!]).length) {
      stateSections.push({ start, end });
      if (!wanted.has(names[0]!)) {
        // Native toml_edit may remove unnecessary quotes from unrelated table
        // names. Normalize only that spelling; retain all body and comment bytes.
        replacements.push({ start, end: start + header[0].length, comments: `[hooks.state.${JSON.stringify(names[0])}]${header[2] ? " " + header[2] : ""}\n` });
        continue;
      }
      const comments = header[2] ? [header[2]] : [];
      for (const line of text.slice(start + header[0].length, end).split(/\r?\n/)) {
        if (!line.trim()) continue;
        if (/^[ \t]*#/.test(line)) { comments.push(line); continue; }
        const field = /^[ \t]*(?:enabled|trusted_hash)[ \t]*=[ \t]*(?:true|false|"(?:[^"\\]|\\.)*"|'[^']*')[ \t]*(#[^\r\n]*)?$/.exec(line);
        if (!field) throw fail();
        if (field[1]) comments.push(field[1]);
      }
      replacements.push({ start, end, comments: comments.join("\n") + "\n" });
    }
  }
  let noState = text;
  for (const span of [...stateSections].reverse()) noState = noState.slice(0, span.start) + noState.slice(span.end);
  const expected = structuredClone(parsed); if (expected.hooks) delete expected.hooks.state;
  try { if (!isDeepStrictEqual(prune(Bun.TOML.parse(noState)), prune(expected))) throw fail(); } catch { throw fail(); }
  let result = text;
  for (const span of replacements.reverse()) result = result.slice(0, span.start) + span.comments + result.slice(span.end);
  // Native Codex may insert blank lines around newly explicit parent tables.
  // Every nonblank unrelated line and every comment must survive exactly.
  return canonicalizeTableOrder(result).split(/\r?\n/).filter(line => line.trim()).join("\n");
}
