/** A finding contains no body fragments, URLs, or offsets suitable for echoing. */
export interface SendBodyBoundaryFinding {
  code: "invalid_body_url_boundary";
  message: string;
}

/**
 * Preserve authored body bytes. HTTP(S) tokens end at whitespace or markup/string
 * delimiters; a raw backslash followed by n/r inside such a token is refused.
 * This intentionally also rejects literal malformed-URL teaching examples.
 * It does not decode percent escapes, rewrite prose, or validate all URL syntax.
 */
export function findSendBodyUrlBoundary(text: unknown, html?: unknown): SendBodyBoundaryFinding | null {
  for (const body of [text, html]) {
    if (typeof body !== "string") continue;
    for (const token of body.matchAll(/https?:\/\/[^\s<>"'`]*/gi)) {
      if (/\\[nr]/.test(token[0])) return {
        code: "invalid_body_url_boundary",
        message: "Message body contains a literal newline escape inside an HTTP(S) URL. Use actual line breaks in a --body-file (or text_file/html_file descriptor); body bytes were not changed.",
      };
    }
  }
  return null;
}

export function assertSendBodyUrlBoundary(text: unknown, html?: unknown): void {
  const finding = findSendBodyUrlBoundary(text, html);
  if (finding) throw new Error(`${finding.code}: ${finding.message}`);
}
