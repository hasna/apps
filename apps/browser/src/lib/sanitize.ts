/**
 * Prompt injection guard — strips hidden/suspicious content from page text
 * before it reaches the LLM. Defends against indirect prompt injection attacks
 * hidden in web pages.
 */

export interface SanitizeResult {
  text: string;
  stripped: number;      // number of suspicious elements stripped
  warnings: string[];    // what was found and removed
}

// Patterns that indicate prompt injection attempts
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/gi,
  /ignore\s+(all\s+)?prior\s+instructions/gi,
  /disregard\s+(all\s+)?previous/gi,
  /forget\s+(all\s+)?previous/gi,
  /you\s+are\s+now\s+/gi,
  /new\s+instructions?\s*:/gi,
  /system\s+prompt\s*:/gi,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /<<SYS>>/gi,
  /<<\/SYS>>/gi,
  /IMPORTANT:\s*ignore/gi,
  /CRITICAL:\s*override/gi,
  /assistant:\s/gi,
  /human:\s/gi,
];

/**
 * Sanitize text content for safe LLM consumption.
 * Strips known injection patterns and flags suspicious content.
 */
export function sanitizeText(text: string): SanitizeResult {
  let stripped = 0;
  const warnings: string[] = [];
  let clean = text;

  for (const pattern of INJECTION_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    const matches = clean.match(pattern);
    if (matches) {
      stripped += matches.length;
      warnings.push(`Stripped ${matches.length}x: ${pattern.source}`);
      pattern.lastIndex = 0;
      clean = clean.replace(pattern, "[STRIPPED]");
    }
  }

  return { text: clean, stripped, warnings };
}

/**
 * Sanitize HTML by removing hidden elements that could contain injected prompts.
 * Returns cleaned text content.
 */
export function sanitizeHTML(html: string): SanitizeResult {
  let stripped = 0;
  const warnings: string[] = [];
  let clean = html;

  // Remove HTML comments (common injection vector)
  const commentMatches = clean.match(/<!--[\s\S]*?-->/g);
  if (commentMatches) {
    for (const comment of commentMatches) {
      // Only strip comments that look suspicious (contain text, not just whitespace)
      if (comment.replace(/<!--\s*-->/g, "").trim().length > 20) {
        stripped++;
        warnings.push(`Stripped HTML comment (${comment.length} chars)`);
      }
    }
    clean = clean.replace(/<!--[\s\S]*?-->/g, "");
  }

  // Remove elements with display:none, visibility:hidden, opacity:0
  const hiddenPatterns = [
    /style\s*=\s*"[^"]*display\s*:\s*none[^"]*"[^>]*>[\s\S]*?<\//gi,
    /style\s*=\s*"[^"]*visibility\s*:\s*hidden[^"]*"[^>]*>[\s\S]*?<\//gi,
    /style\s*=\s*"[^"]*opacity\s*:\s*0[^"]*"[^>]*>[\s\S]*?<\//gi,
    /style\s*=\s*"[^"]*font-size\s*:\s*0[^"]*"[^>]*>[\s\S]*?<\//gi,
    /style\s*=\s*"[^"]*position\s*:\s*absolute[^"]*left\s*:\s*-\d{4,}[^"]*"[^>]*>[\s\S]*?<\//gi,
  ];

  for (const pattern of hiddenPatterns) {
    pattern.lastIndex = 0;
    const matches = clean.match(pattern);
    if (matches) {
      stripped += matches.length;
      warnings.push(`Stripped ${matches.length} hidden elements`);
      pattern.lastIndex = 0;
      clean = clean.replace(pattern, "");
    }
  }

  // Remove aria-hidden elements
  const ariaHiddenPattern = /aria-hidden\s*=\s*"true"[^>]*>[\s\S]*?<\//gi;
  const ariaHidden = clean.match(ariaHiddenPattern);
  if (ariaHidden) {
    stripped += ariaHidden.length;
    warnings.push(`Stripped ${ariaHidden.length} aria-hidden elements`);
    ariaHiddenPattern.lastIndex = 0;
    clean = clean.replace(ariaHiddenPattern, "");
  }

  // Now sanitize the remaining text content
  const textResult = sanitizeText(clean);
  return {
    text: textResult.text,
    stripped: stripped + textResult.stripped,
    warnings: [...warnings, ...textResult.warnings],
  };
}
