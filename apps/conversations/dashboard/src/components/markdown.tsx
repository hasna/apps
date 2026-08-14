import * as React from "react";

interface MarkdownProps {
  children: string;
  className?: string;
}

/**
 * Lightweight markdown renderer for message content.
 * Handles: bold, italic, code, code blocks, links, lists, headings, hr, strikethrough.
 * No external dependencies — pure React.
 */
export function Markdown({ children, className }: MarkdownProps) {
  const html = markdownToHtml(children);
  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function markdownToHtml(md: string): string {
  // Split into blocks by double newline
  const lines = md.split("\n");
  const result: string[] = [];
  let i = 0;
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code blocks
    if (line.trimStart().startsWith("```")) {
      if (inCodeBlock) {
        result.push(
          `<code class="block bg-muted rounded-md px-3 py-2 text-xs font-mono my-1 overflow-x-auto whitespace-pre">${escapeHtml(codeBlockContent.join("\n"))}</code>`
        );
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      i++;
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line.trim())) {
      result.push('<hr class="my-2 border-muted" />');
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = inlineMarkdown(headingMatch[2]);
      const classes = level === 1 ? "text-base font-bold mb-1" : level === 2 ? "text-sm font-bold mb-1" : "text-sm font-semibold mb-1";
      result.push(`<h${level} class="${classes}">${text}</h${level}>`);
      i++;
      continue;
    }

    // Unordered list
    if (/^[\s]*[-*+]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*[-*+]\s/.test(lines[i])) {
        items.push(inlineMarkdown(lines[i].replace(/^[\s]*[-*+]\s/, "")));
        i++;
      }
      result.push(
        `<ul class="list-disc pl-4 mb-1 space-y-0.5">${items.map((item) => `<li class="text-sm">${item}</li>`).join("")}</ul>`
      );
      continue;
    }

    // Ordered list
    if (/^[\s]*\d+[.)]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*\d+[.)]\s/.test(lines[i])) {
        items.push(inlineMarkdown(lines[i].replace(/^[\s]*\d+[.)]\s/, "")));
        i++;
      }
      result.push(
        `<ol class="list-decimal pl-4 mb-1 space-y-0.5">${items.map((item) => `<li class="text-sm">${item}</li>`).join("")}</ol>`
      );
      continue;
    }

    // Blockquote
    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      result.push(
        `<blockquote class="border-l-2 border-muted-foreground/30 pl-3 my-1 text-muted-foreground italic">${inlineMarkdown(quoteLines.join(" "))}</blockquote>`
      );
      continue;
    }

    // Regular paragraph
    result.push(`<p class="mb-1 last:mb-0">${inlineMarkdown(line)}</p>`);
    i++;
  }

  // Close unclosed code block
  if (inCodeBlock && codeBlockContent.length > 0) {
    result.push(
      `<code class="block bg-muted rounded-md px-3 py-2 text-xs font-mono my-1 overflow-x-auto whitespace-pre">${escapeHtml(codeBlockContent.join("\n"))}</code>`
    );
  }

  return result.join("");
}

function inlineMarkdown(text: string): string {
  let html = escapeHtml(text);

  // Inline code (must come before bold/italic to avoid conflicts)
  html = html.replace(/`([^`]+)`/g, '<code class="bg-muted rounded px-1 py-0.5 text-xs font-mono">$1</code>');

  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong class=\"font-semibold\">$1</strong>");
  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, "<del>$1</del>");

  // Links [text](url)
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 underline">$1</a>'
  );

  return html;
}
