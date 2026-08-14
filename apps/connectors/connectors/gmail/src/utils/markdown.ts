/**
 * Simple markdown to HTML converter for emails
 * Supports: headers, bold, italic, links, code, lists, blockquotes, hr
 */

export function markdownToHtml(markdown: string): string {
  let html = markdown;

  // Escape HTML entities first (but preserve intentional HTML)
  html = html
    .replace(/&(?!amp;|lt;|gt;|quot;|#)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Headers (must be at start of line)
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Horizontal rule
  html = html.replace(/^(-{3,}|\*{3,}|_{3,})$/gm, '<hr>');

  // Bold and italic (order matters)
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code style="background:#f4f4f4;padding:2px 4px;border-radius:3px;">$1</code>');

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre style="background:#f4f4f4;padding:12px;border-radius:4px;overflow-x:auto;"><code>${code.trim()}</code></pre>`;
  });

  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#1a73e8;">$1</a>');

  // Images ![alt](url)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;">');

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote style="border-left:4px solid #ddd;margin:0;padding-left:16px;color:#666;">$1</blockquote>');

  // Unordered lists
  html = html.replace(/^[\*\-] (.+)$/gm, '<li style="margin:0;padding:0;">$1</li>');
  html = html.replace(/(<li style[^>]*>.*?<\/li>\n?)+/g, '<ul style="margin:4px 0;padding-left:20px;">$&</ul>');

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li style="margin:0;padding:0;">$1</li>');

  // Paragraphs (double newlines)
  html = html.replace(/\n\n+/g, '</p><p>');
  html = `<p>${html}</p>`;

  // Remove newlines between list items (prevent <br> between <li> elements)
  html = html.replace(/<\/li>\n<li/g, '</li><li');
  html = html.replace(/<\/li>\n<\/ul>/g, '</li></ul>');

  // Single line breaks to <br>
  html = html.replace(/\n/g, '<br>');

  // Clean up empty paragraphs
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>(<h[1-6]>)/g, '$1');
  html = html.replace(/(<\/h[1-6]>)<\/p>/g, '$1');
  html = html.replace(/<p>(<ul)/g, '$1');
  html = html.replace(/(<\/ul>)<\/p>/g, '$1');
  html = html.replace(/<p>(<pre)/g, '$1');
  html = html.replace(/(<\/pre>)<\/p>/g, '$1');
  html = html.replace(/<p>(<blockquote)/g, '$1');
  html = html.replace(/(<\/blockquote>)<\/p>/g, '$1');
  html = html.replace(/<p><hr><\/p>/g, '<hr>');

  return html;
}

/**
 * Wrap HTML content in a basic email template (no custom fonts - uses Gmail defaults)
 */
export function wrapInEmailTemplate(html: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    ul, ol { margin: 4px 0; padding-left: 20px; }
    li { margin: 0; padding: 0; line-height: 1.5; }
    p { margin: 0 0 8px 0; }
  </style>
</head>
<body style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#202124;">
${html}
</body>
</html>`;
}

/**
 * Check if text appears to be markdown (has markdown syntax)
 */
export function looksLikeMarkdown(text: string): boolean {
  const markdownPatterns = [
    /^#{1,6} /m,           // Headers
    /\*\*.+\*\*/,          // Bold
    /\[.+\]\(.+\)/,        // Links
    /^[\*\-] /m,           // Unordered lists
    /^\d+\. /m,            // Ordered lists
    /```/,                 // Code blocks
    /^> /m,                // Blockquotes
  ];

  return markdownPatterns.some(pattern => pattern.test(text));
}
