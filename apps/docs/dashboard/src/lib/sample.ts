/** A neutral sample document used to seed the demo editor. */
export const SAMPLE_MARKDOWN = `# Product Requirements

A short document that shows what the **@hasna/docs** SDK can round-trip.

## Goals

- Headless document model over ProseMirror/TipTap JSON
- Import and export **Markdown**, *HTML*, and JSON
- Extract an outline and ~~guess~~ compute word counts

## Notes

Inline formatting includes \`code\`, [links](https://github.com/hasna/docs), and
line breaks.

> Everything you type on the left is parsed by the SDK on the right.

### Example snippet

\`\`\`ts
import { createDocument } from "@hasna/docs";

const doc = createDocument().append(/* ... */);
\`\`\`
`;
