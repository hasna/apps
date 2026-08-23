/**
 * Minimal block-YAML parser (GitHub Actions subset) and node type guards.
 *
 * Shared by the deploy-lane gates (check-deploy-lanes.ts,
 * check-todos-deploy.ts): the monorepo has no direct YAML dependency and a
 * transitive one is not a supported import, so the lanes parse workflows with
 * this one implementation rather than duplicating a parser per check.
 *
 * Only the subset a workflow file needs is supported: mappings, sequences,
 * block scalars (`|`/`>`), inline lists and inline scalars. Comments are
 * skipped at line level and stripped from inline scalars.
 */
export type YamlNode = string | YamlNode[] | { [key: string]: YamlNode };

/** Strip a trailing `#` comment that begins outside quotes at a word boundary. */
export function stripInlineComment(line: string): string {
  let single = false;
  let double = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && double) {
      escaped = true;
      continue;
    }
    if (character === "'" && !double) {
      single = !single;
      continue;
    }
    if (character === '"' && !single) {
      double = !double;
      continue;
    }
    if (character === "#" && !single && !double && (index === 0 || /\s/.test(line[index - 1] ?? ""))) {
      return line.slice(0, index).trimEnd();
    }
  }
  return line;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
}

function scalarValue(raw: string): YamlNode {
  const trimmed = raw.trim();
  if (trimmed === "{}") return {};
  if (trimmed === "[]") return [];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((entry) => unquote(entry));
  }
  return unquote(trimmed);
}

const MAP_KEY = /^("[^"]*"|'[^']*'|[^:\s][^:]*?)\s*:(?:\s+(.*))?$/;

export function parseYaml(source: string): YamlNode {
  const lines = source.split("\n");
  let cursor = 0;

  const indentOf = (line: string): number => line.length - line.trimStart().length;

  const skipBlank = (): void => {
    while (cursor < lines.length && (lines[cursor].trim() === "" || /^\s*#/.test(lines[cursor]))) cursor += 1;
  };

  function parseBlockScalar(parentIndent: number): string {
    const collected: string[] = [];
    let contentIndent = -1;
    while (cursor < lines.length) {
      const line = lines[cursor];
      if (line.trim() === "") {
        collected.push("");
        cursor += 1;
        continue;
      }
      const indent = indentOf(line);
      if (indent <= parentIndent) break;
      if (contentIndent < 0) contentIndent = indent;
      collected.push(line.slice(contentIndent));
      cursor += 1;
    }
    while (collected.length > 0 && collected[collected.length - 1] === "") collected.pop();
    return collected.join("\n");
  }

  function parseNode(minIndent: number): YamlNode | null {
    skipBlank();
    if (cursor >= lines.length) return null;
    const indent = indentOf(lines[cursor]);
    if (indent < minIndent) return null;
    const head = lines[cursor].trimStart();
    if (head === "-" || head.startsWith("- ")) return parseSequence(indent);
    return parseMapping(indent);
  }

  function parseSequence(indent: number): YamlNode[] {
    const items: YamlNode[] = [];
    for (;;) {
      skipBlank();
      if (cursor >= lines.length) break;
      if (indentOf(lines[cursor]) !== indent) break;
      const head = lines[cursor].trimStart();
      if (head !== "-" && !head.startsWith("- ")) break;
      const rest = head === "-" ? "" : head.slice(2);
      if (rest === "") {
        cursor += 1;
        items.push(parseNode(indent + 1) ?? "");
        continue;
      }
      if (MAP_KEY.test(stripInlineComment(rest))) {
        // Re-anchor the inline entry so the mapping parser sees it at its own column.
        lines[cursor] = " ".repeat(indent + 2) + rest;
        items.push(parseMapping(indent + 2));
        continue;
      }
      cursor += 1;
      items.push(scalarValue(stripInlineComment(rest)));
    }
    return items;
  }

  function parseMapping(indent: number): Record<string, YamlNode> {
    const map: Record<string, YamlNode> = {};
    for (;;) {
      skipBlank();
      if (cursor >= lines.length) break;
      if (indentOf(lines[cursor]) !== indent) break;
      const head = lines[cursor].trimStart();
      const match = MAP_KEY.exec(head);
      if (!match) break;
      const key = unquote(match[1]);
      const inline = (match[2] ?? "").trim();
      cursor += 1;
      if (/^[|>][-+]?\d*$/.test(inline)) {
        map[key] = parseBlockScalar(indent);
      } else if (inline === "") {
        map[key] = parseNode(indent + 1) ?? "";
      } else {
        map[key] = scalarValue(stripInlineComment(inline));
      }
    }
    return map;
  }

  return parseNode(0) ?? {};
}

export function asMap(node: YamlNode | undefined): Record<string, YamlNode> {
  return node && typeof node === "object" && !Array.isArray(node) ? (node as Record<string, YamlNode>) : {};
}

export function asArray(node: YamlNode | undefined): YamlNode[] {
  return Array.isArray(node) ? node : [];
}

export function asText(node: YamlNode | undefined): string {
  return typeof node === "string" ? node : "";
}
