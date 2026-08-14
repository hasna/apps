/**
 * Inline image display for terminals that support it.
 * Supports iTerm2 (OSC 1337) and Kitty (graphics protocol).
 * Falls back to a text placeholder when unsupported.
 */

/** Detected terminal protocol */
export type TerminalProtocol = "iterm2" | "kitty" | "none";

/** Detect which image protocol the terminal supports */
export function detectProtocol(): TerminalProtocol {
  const term = process.env.TERM_PROGRAM ?? "";
  const termInfo = process.env.TERM ?? "";

  if (term === "iTerm.app" || term === "WezTerm") {
    return "iterm2";
  }
  if (termInfo.includes("kitty") || process.env.KITTY_PID) {
    return "kitty";
  }
  return "none";
}

/**
 * Render a base64 PNG image inline in the terminal.
 * Returns the escape sequence string, or empty string if unsupported.
 *
 * @param base64 - Base64-encoded PNG data
 * @param opts - Display options
 */
export function renderInlineImage(
  base64: string,
  opts?: {
    /** Max width in terminal columns (default: 40) */
    width?: number;
    /** Max height in terminal rows (default: 15) */
    height?: number;
    /** Whether to preserve aspect ratio (default: true) */
    preserveAspectRatio?: boolean;
  }
): string {
  const protocol = detectProtocol();
  const width = opts?.width ?? 40;
  const height = opts?.height ?? 15;

  switch (protocol) {
    case "iterm2":
      return renderIterm2(base64, width, height, opts?.preserveAspectRatio ?? true);
    case "kitty":
      return renderKitty(base64, width, height);
    case "none":
      return "";
  }
}

/**
 * Check if the terminal supports inline images.
 */
export function supportsInlineImages(): boolean {
  return detectProtocol() !== "none";
}

/**
 * iTerm2 inline image protocol (OSC 1337).
 * https://iterm2.com/documentation-images.html
 */
function renderIterm2(
  base64: string,
  width: number,
  height: number,
  preserveAspectRatio: boolean
): string {
  const params = [
    `width=${width}`,
    `height=${height}`,
    `preserveAspectRatio=${preserveAspectRatio ? 1 : 0}`,
    "inline=1",
  ].join(";");

  // OSC 1337 ; File=[params]:base64data ST
  return `\x1b]1337;File=${params}:${base64}\x07\n`;
}

/**
 * Kitty graphics protocol.
 * https://sw.kovidgoyal.net/kitty/graphics-protocol/
 *
 * Sends the image in chunks of 4096 bytes.
 */
function renderKitty(base64: string, width: number, height: number): string {
  const chunkSize = 4096;
  const chunks: string[] = [];

  for (let i = 0; i < base64.length; i += chunkSize) {
    const chunk = base64.slice(i, i + chunkSize);
    const isLast = i + chunkSize >= base64.length;
    const more = isLast ? 0 : 1;

    if (i === 0) {
      // First chunk: include format and action
      chunks.push(
        `\x1b_Gf=100,a=T,m=${more},c=${width},r=${height};${chunk}\x1b\\`
      );
    } else {
      // Continuation chunks
      chunks.push(`\x1b_Gm=${more};${chunk}\x1b\\`);
    }
  }

  return chunks.join("") + "\n";
}
