import chalk from "chalk";

/**
 * Render inline markdown formatting for terminal output.
 * Handles: inline code, bold+italic, bold, italic, strikethrough.
 */
export const renderInline = (text: string): string => {
  return text
    .replace(/`([^`]+)`/g, (_, code) => chalk.bgGray.white(` ${code} `))
    .replace(/\*\*\*(.+?)\*\*\*/g, (_, t) => chalk.bold.italic(t))
    .replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t))
    .replace(/\*(.+?)\*/g, (_, t) => chalk.italic(t))
    .replace(/~~(.+?)~~/g, (_, t) => chalk.strikethrough(t));
};

/**
 * Render markdown content for terminal output.
 * Handles: headings, bullet lists, ordered lists, blockquotes,
 * code block markers, inline formatting.
 */
export const renderContent = (content: string): string => {
  const lines = content.split("\n");
  const rendered: string[] = [];

  for (const line of lines) {
    let l = line;
    // Headings
    const h = l.match(/^(#{1,3})\s+(.+)/);
    if (h) { rendered.push(chalk.bold(h[2])); continue; }
    // Unordered list
    if (/^\s*[-*+]\s/.test(l)) {
      rendered.push("  " + chalk.dim("•") + " " + renderInline(l.replace(/^\s*[-*+]\s/, "")));
      continue;
    }
    // Ordered list
    const ol = l.match(/^\s*(\d+)[.)]\s(.*)/);
    if (ol) { rendered.push("  " + chalk.dim(ol[1] + ".") + " " + renderInline(ol[2])); continue; }
    // Blockquote
    if (l.startsWith(">")) {
      rendered.push(chalk.dim("  │ ") + chalk.italic(renderInline(l.replace(/^>\s?/, ""))));
      continue;
    }
    // Code block markers
    if (l.trimStart().startsWith("```")) continue;
    // Empty line
    if (l.trim() === "") { rendered.push(""); continue; }
    // Regular text
    rendered.push(renderInline(l));
  }
  return rendered.join("\n");
};
