---
"@hasna/sheets": patch
---

Remove unused install-time home-directory creation and scan the actual npm
artifact through the pinned release gate. Preserve explicit-file CLI behavior,
the headless SDK, optional XLSX support, React editor, and browser demo.

Normalize the optional ExcelJS namespace and use the spreadsheet component's
named export so the existing Node-shebang CLI and external ESM consumers can
use XLSX and React rendering, while preserving lazy peers and Bun behavior.
