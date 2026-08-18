#!/usr/bin/env bash
# terminal Claude Code PostToolUse hook
# Compresses Bash tool output through terminal processing pipeline
# Install: t hook install --claude

# Only process Bash tool results
if [ "$TOOL_NAME" != "Bash" ]; then
  exit 0
fi

# Read the tool output from stdin
OUTPUT=$(cat)

# Skip if output is small (< 500 chars)
if [ ${#OUTPUT} -lt 500 ]; then
  echo "$OUTPUT"
  exit 0
fi

# Count lines
LINE_COUNT=$(echo "$OUTPUT" | wc -l | tr -d ' ')

# For large outputs, compress through terminal
if [ "$LINE_COUNT" -gt 15 ]; then
  # Try to use bun for speed, fall back to node
  if command -v bun &> /dev/null; then
    COMPRESSED=$(echo "$OUTPUT" | bun -e "
      import { compress, stripAnsi } from '$(dirname "$0")/../dist/compression.js';
      import { stripNoise } from '$(dirname "$0")/../dist/noise-filter.js';
      let input = '';
      process.stdin.on('data', d => input += d);
      process.stdin.on('end', () => {
        const cleaned = stripNoise(stripAnsi(input)).cleaned;
        const result = compress('bash', cleaned, { maxTokens: 500 });
        if (result.tokensSaved > 50) {
          console.log(result.content);
          console.error('[terminal] saved ' + result.tokensSaved + ' tokens (' + result.savingsPercent + '%)');
        } else {
          console.log(cleaned);
        }
      });
    " 2>/dev/null)

    if [ $? -eq 0 ] && [ -n "$COMPRESSED" ]; then
      echo "$COMPRESSED"
      exit 0
    fi
  fi
fi

# Fallback: return original output
echo "$OUTPUT"
